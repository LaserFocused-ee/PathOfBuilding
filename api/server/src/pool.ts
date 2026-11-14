// Worker pool: one worker per open build session, at most poolSize processes. The least recently used
// idle session is recycled when a new one needs a process. A session whose worker died, timed out,
// failed, or grew past its memory ceiling is reloaded from the store on next use.
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import type { Logger } from "./log.js";
import type { BuildStore } from "./store.js";
import { Worker, type WorkerReply } from "./worker.js";

/** Session key for read-only lookups that need no particular build (holds a fresh empty build). */
export const LOOKUP_SESSION = "lookup";

export class Pool {
  private readonly sessions = new Map<string, Worker>(); // Map order is LRU order (oldest first)
  private readonly free: Worker[] = [];
  private readonly locks = new Map<string, Promise<unknown>>();
  private live = 0; // processes started and not yet exited, wherever they are (session, free, handed out)

  constructor(
    private readonly cfg: Config,
    private readonly log: Logger,
    private readonly store: BuildStore,
  ) {}

  async init(): Promise<void> {
    await mkdir(join(this.cfg.dataDir, "worker-state"), { recursive: true });
  }

  /** Serializes everything done to one session (acquire, load, command, store write). */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }

  /** Runs one worker command in the session for key (a build id, or LOOKUP_SESSION). Callers hold no lock. */
  run<T = unknown>(key: string, op: string, args: Record<string, unknown> = {}): Promise<WorkerReply<T>> {
    return this.withLock(key, () => this.runLocked<T>(key, op, args));
  }

  /** Same as run, for callers that already hold the session's lock. */
  async runLocked<T = unknown>(key: string, op: string, args: Record<string, unknown> = {}): Promise<WorkerReply<T>> {
    const w = await this.acquire(key);
    return this.command<T>(key, w, op, args);
  }

  /**
   * Creates a build in a fresh session: fn gets a worker with no build, does its commands and store
   * write, and returns the new build id, under which the session is then kept.
   */
  async create<T>(fn: (call: <R>(op: string, args?: Record<string, unknown>) => Promise<WorkerReply<R>>) => Promise<{ id: string; value: T }>): Promise<T> {
    const tmp = `new:${randomBytes(6).toString("hex")}`;
    return this.withLock(tmp, async () => {
      const w = await this.process(tmp);
      try {
        const { id, value } = await fn((op, args) => this.command(tmp, w, op, args ?? {}));
        this.register(id, w);
        return value;
      } catch (e) {
        if (w.alive && !(e instanceof ApiError && (e.code === "worker_error" || e.code === "worker_timeout"))) this.free.push(w);
        else w.kill("create_failed");
        throw e;
      }
    });
  }

  /** Drops the session for key so the next use reloads it from the store. */
  invalidate(key: string): void {
    const w = this.sessions.get(key);
    if (!w) return;
    this.sessions.delete(key);
    w.buildId = undefined;
    if (w.alive) this.free.push(w);
  }

  /** Ends the session for a deleted build. Caller holds the build's lock. */
  close(key: string): void {
    this.invalidate(key);
  }

  stats(): { max: number; live: number; sessions: number; free: number; workers: Array<{ session: string | undefined; busy: boolean }> } {
    const all = [...this.sessions.values(), ...this.free];
    return {
      max: this.cfg.poolSize,
      sessions: this.sessions.size,
      free: this.free.length,
      live: this.live,
      workers: all.map((w) => ({ session: w.buildId ? (w.buildId === LOOKUP_SESSION ? "lookup" : "build") : undefined, busy: w.busy })),
    };
  }

  /** The worker process holding key, if one is live (tests use it to kill a session's process). */
  workerFor(key: string): Worker | undefined {
    return this.sessions.get(key);
  }

  /** Kills every worker and resolves once all have exited (their state directories are then removed). */
  async shutdown(): Promise<void> {
    const all = [...this.sessions.values(), ...this.free];
    const exited = Promise.all(all.map((w) => new Promise<void>((resolve) => w.onExit(resolve))));
    for (const w of all) w.kill("shutdown");
    this.sessions.clear();
    this.free.length = 0;
    await exited;
  }

  private register(key: string, w: Worker): void {
    w.buildId = key;
    this.sessions.set(key, w);
    w.onExit(() => {
      if (this.sessions.get(key) === w) this.sessions.delete(key);
      const i = this.free.indexOf(w);
      if (i >= 0) this.free.splice(i, 1);
    });
  }

  private async acquire(key: string): Promise<Worker> {
    const live = this.sessions.get(key);
    if (live?.alive && live.buildId === key) {
      this.sessions.delete(key); // move to most recently used
      this.sessions.set(key, live);
      return live;
    }
    this.sessions.delete(key);
    // Read the store first: an unknown build fails here without taking a process from anyone.
    const load = key === LOOKUP_SESSION ? { op: "builds.new", args: { name: "lookup" } } : { op: "builds.load", args: { xml: await this.store.xml(key), name: (await this.store.get(key)).name } };
    const w = await this.process(key);
    try {
      await this.command(key, w, load.op, load.args);
    } catch (e) {
      // command() already killed a worker whose own failure this was; any other failure leaves it reusable.
      if (w.alive) this.free.push(w);
      throw e;
    }
    this.register(key, w);
    return w;
  }

  /** A process with no session: a free one, a new one, or the least recently used unlocked session's. */
  private async process(key: string): Promise<Worker> {
    for (;;) {
      const free = this.free.shift();
      if (free?.alive) return free;
      if (free) continue;
      if (this.live < this.cfg.poolSize) {
        this.live += 1;
        let w: Worker;
        try {
          w = await Worker.start(this.cfg, this.log);
        } catch (e) {
          this.live -= 1;
          throw e;
        }
        w.onExit(() => {
          this.live -= 1;
        });
        return w;
      }
      const victim = [...this.sessions.entries()].find(([k]) => k !== key && !this.locks.has(k));
      if (victim) {
        const [vk, vw] = victim;
        this.sessions.delete(vk);
        vw.buildId = undefined;
        this.log.info({ event: "pool.recycle", pid: vw.proc.pid }, "recycling least recently used session");
        await vw.idle();
        if (vw.alive) return vw;
        continue;
      }
      // Every session is in use: wait for one to finish, then look again.
      const others = [...this.locks.entries()].filter(([k]) => k !== key).map(([, p]) => p);
      if (others.length === 0) throw new ApiError("worker_error", "worker pool has no process to give");
      await Promise.race(others);
    }
  }

  private async command<T>(key: string, w: Worker, op: string, args: Record<string, unknown>): Promise<WorkerReply<T>> {
    try {
      const reply = await w.call<T>(op, args, { buildId: key });
      const rss = await w.rssMb();
      if (rss !== undefined && rss > this.cfg.workerRssMb) {
        this.log.warn({ event: "pool.rss_ceiling", pid: w.proc.pid, rss_mb: Math.round(rss) }, "worker over memory ceiling; session reloads on next use");
        if (this.sessions.get(key) === w) this.sessions.delete(key);
        w.kill("rss_ceiling");
      }
      return reply;
    } catch (e) {
      if (e instanceof ApiError && (e.code === "worker_error" || e.code === "worker_timeout")) {
        // The Lua state may be half-changed: drop it; the store still holds the last good revision.
        if (this.sessions.get(key) === w) this.sessions.delete(key);
        w.kill(e.code);
      }
      throw e;
    }
  }
}
