// One LuaJIT process running api/lua/worker.lua. Commands are sent one at a time; a command past
// its timeout kills the process. The process gets a minimal environment (never the server's token).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Config } from "./config.js";
import { ApiError, isErrorCode } from "./errors.js";
import type { Logger } from "./log.js";

export interface WorkerReply<T = unknown> {
  result: T;
  warnings: string[];
  ms: number;
}

interface Pending {
  id: number;
  op: string;
  resolve: (r: WorkerReply) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  started: number;
}

export interface WorkerInfo {
  pobVersion: string;
  latestTreeVersion: string;
  bootMs: number;
}

export class Worker {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly ready: Promise<WorkerInfo>;
  info: WorkerInfo | undefined;
  alive = true;
  /** Build this worker currently holds, and the store revision it was last synced to. */
  buildId: string | undefined;
  revision = 0;
  private nextId = 1;
  private pending: Pending | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private gcTimer: NodeJS.Timeout | undefined;
  private readonly exitListeners: Array<() => void> = [];

  private constructor(
    private readonly cfg: Config,
    private readonly log: Logger,
    private readonly stateDir: string,
  ) {
    const src = join(cfg.pobRoot, "src");
    this.proc = spawn(join(cfg.runtimeDir, "bin/luajit"), [join(cfg.pobRoot, "api/lua/worker.lua")], {
      cwd: src,
      env: { LUA_CPATH: join(cfg.runtimeDir, "?.so"), POB_STATE_DIR: stateDir, PATH: "/usr/bin:/bin", HOME: stateDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    let onReady: ((i: WorkerInfo) => void) | undefined;
    let onBootFail: ((e: Error) => void) | undefined;
    this.ready = new Promise<WorkerInfo>((res, rej) => {
      onReady = res;
      onBootFail = rej;
    });
    const bootTimer = setTimeout(() => {
      onBootFail?.(new ApiError("worker_timeout", `worker did not boot in ${cfg.workerBootTimeoutMs} ms`));
      this.kill("boot_timeout");
    }, cfg.workerBootTimeoutMs);
    lines.on("line", (line) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        this.log.warn({ event: "worker.bad_line", pid: this.proc.pid }, "worker wrote a non-JSON line");
        return;
      }
      if ("ready" in msg) {
        clearTimeout(bootTimer);
        if (msg.ready === true) {
          this.info = { pobVersion: String(msg.pobVersion), latestTreeVersion: String(msg.latestTreeVersion), bootMs: Number(msg.bootMs) };
          this.log.info({ event: "worker.ready", pid: this.proc.pid, boot_ms: this.info.bootMs }, "worker ready");
          onReady?.(this.info);
        } else {
          const err = msg.error as { message?: string } | undefined;
          onBootFail?.(new ApiError("worker_error", `worker failed to boot: ${err?.message ?? "unknown"}`));
        }
        return;
      }
      this.settle(msg);
    });
    // Path of Building's own console output; kept at debug level, never parsed.
    createInterface({ input: this.proc.stderr }).on("line", (line) => this.log.debug({ event: "worker.stderr", pid: this.proc.pid, line: line.slice(0, 500) }));
    let ended = false;
    const end = (code: number | null, signal: string | null) => {
      if (ended) return;
      ended = true;
      this.alive = false;
      clearTimeout(bootTimer);
      clearTimeout(this.gcTimer);
      onBootFail?.(new ApiError("worker_error", `worker exited during boot (code ${code}, signal ${signal})`));
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(new ApiError("worker_error", `worker exited (code ${code}, signal ${signal}) during ${this.pending.op}`));
        this.pending = undefined;
      }
      this.log.info({ event: "worker.exit", pid: this.proc.pid, code, signal, build_id: this.buildId }, "worker exited");
      void rm(this.stateDir, { recursive: true, force: true });
      for (const l of this.exitListeners) l();
    };
    this.proc.on("exit", end);
    // A spawn failure emits only "error"; a write to a process that already died fails on stdin (EPIPE).
    // Both end the worker the same way an exit does, so a pending command rejects and nothing is left uncaught.
    this.proc.on("error", (e) => {
      this.log.warn({ event: "worker.process_error", pid: this.proc.pid, error: e.message }, "worker process error");
      this.proc.kill("SIGKILL");
      end(null, null);
    });
    this.proc.stdin.on("error", (e) => {
      this.log.warn({ event: "worker.stdin_error", pid: this.proc.pid, error: e.message }, "worker input closed");
      this.proc.kill("SIGKILL");
      end(null, null);
    });
  }

  static async start(cfg: Config, log: Logger): Promise<Worker> {
    const stateDir = await mkdtemp(join(cfg.dataDir, "worker-state", "w-"));
    const w = new Worker(cfg, log, stateDir);
    try {
      await w.ready;
    } catch (e) {
      w.kill("boot_failed");
      throw e;
    }
    return w;
  }

  onExit(fn: () => void): void {
    if (!this.alive) fn();
    else this.exitListeners.push(fn);
  }

  get busy(): boolean {
    return this.queued > 0;
  }

  /** Resolves when every queued command has finished. */
  async idle(): Promise<void> {
    while (this.queued > 0) await this.queue.catch(() => undefined);
  }

  /** Queues one command; commands run strictly one after another. */
  call<T = unknown>(op: string, args: Record<string, unknown> = {}, meta: { buildId?: string } = {}): Promise<WorkerReply<T>> {
    clearTimeout(this.gcTimer);
    this.queued += 1;
    const run = this.queue.then(() => this.send<T>(op, args, meta));
    this.queue = run.catch(() => undefined);
    void run.finally(() => {
      this.queued -= 1;
      if (this.queued === 0 && this.alive && op !== "worker.gc") this.scheduleGc();
    }).catch(() => undefined);
    return run;
  }

  private send<T>(op: string, args: Record<string, unknown>, meta: { buildId?: string }): Promise<WorkerReply<T>> {
    if (!this.alive) return Promise.reject(new ApiError("worker_error", "worker is not running"));
    const id = this.nextId++;
    return new Promise<WorkerReply<T>>((resolve, reject) => {
      const started = Date.now();
      const timer = setTimeout(() => {
        this.log.warn({ event: "worker.command", op, build_id: meta.buildId, pid: this.proc.pid, duration_ms: Date.now() - started, ok: false, code: "worker_timeout" });
        this.pending = undefined;
        reject(new ApiError("worker_timeout", `${op} took longer than ${this.cfg.workerTimeoutMs} ms`));
        this.kill("command_timeout");
      }, this.cfg.workerTimeoutMs);
      const done = (ok: boolean, code?: string) =>
        this.log.info({ event: "worker.command", op, build_id: meta.buildId, pid: this.proc.pid, duration_ms: Date.now() - started, ok, code });
      this.pending = {
        id,
        op,
        started,
        timer,
        resolve: (r) => {
          done(true);
          resolve(r as WorkerReply<T>);
        },
        reject: (e) => {
          done(false, e instanceof ApiError ? e.code : "worker_error");
          reject(e);
        },
      };
      this.proc.stdin.write(`${JSON.stringify({ id, op, args })}\n`);
    });
  }

  private settle(msg: Record<string, unknown>): void {
    const p = this.pending;
    if (!p || msg.id !== p.id) {
      this.log.warn({ event: "worker.unexpected_reply", pid: this.proc.pid, id: msg.id }, "reply with no pending command");
      return;
    }
    this.pending = undefined;
    clearTimeout(p.timer);
    const warnings = Array.isArray(msg.warnings) ? (msg.warnings as string[]) : [];
    if (msg.ok === true) {
      p.resolve({ result: msg.result, warnings, ms: Number(msg.ms ?? 0) });
    } else {
      const err = (msg.error ?? {}) as { code?: unknown; message?: unknown };
      const code = isErrorCode(err.code) ? err.code : "worker_error";
      p.reject(new ApiError(code, typeof err.message === "string" ? err.message : "worker command failed", warnings.length ? { warnings } : undefined));
    }
  }

  private scheduleGc(): void {
    this.gcTimer = setTimeout(() => {
      if (this.alive && !this.busy) void this.call("worker.gc").catch(() => undefined);
    }, this.cfg.idleGcMs);
    this.gcTimer.unref();
  }

  async rssMb(): Promise<number | undefined> {
    try {
      const status = await readFile(`/proc/${this.proc.pid}/status`, "utf8");
      const kb = /VmRSS:\s+(\d+)/.exec(status)?.[1];
      return kb ? Number(kb) / 1024 : undefined;
    } catch {
      return undefined;
    }
  }

  kill(reason: string): void {
    if (!this.alive) return;
    this.log.info({ event: "worker.kill", pid: this.proc.pid, reason, build_id: this.buildId }, "killing worker");
    this.proc.kill("SIGKILL");
  }
}
