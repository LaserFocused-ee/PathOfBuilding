// Assembles store, pool, events, fetcher and service over one data directory, which it locks so two
// servers (HTTP and stdio, say) never write the same store.
import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import { Events } from "./events.js";
import { Fetcher, GAME_HOST, SHARE_HOSTS } from "./fetch.js";
import type { Logger } from "./log.js";
import { Pool } from "./pool.js";
import { Service } from "./service.js";
import { BuildStore } from "./store.js";
import { TradeClient } from "./trade.js";
import type { CdpSocket } from "./trade-browser.js";

export interface Runtime {
  svc: Service;
  close: () => Promise<void>;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** A process's start time (clock ticks since boot, /proc/<pid>/stat field 22); undefined without /proc. */
export async function startTime(pid: number): Promise<string | undefined> {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined);
  return stat?.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
}

/**
 * The lock holds "<pid> <start time>". It is stale when it names this process (a restart that reused the
 * pid, as pid 1 in a container always does), a process that is gone, or a live process that started at a
 * different time (the pid was reused).
 */
async function lock(dir: string): Promise<string> {
  const path = join(dir, "server.lock");
  const self = `${process.pid} ${(await startTime(process.pid)) ?? "-"}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, self, { flag: "wx", mode: 0o600 });
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const [pidText, started] = (await readFile(path, "utf8").catch(() => "0")).trim().split(" ");
      const holder = Number(pidText);
      const held = holder > 0 && holder !== process.pid && alive(holder) && (started === undefined || started === "-" || started === (await startTime(holder)));
      if (held) throw new Error(`data directory ${dir} is in use by process ${holder}`, { cause: e });
      await rm(path, { force: true });
    }
  }
  throw new Error(`could not lock data directory ${dir}`);
}

/** Outside services the runtime uses; tests pass a recorded fetch. */
export interface RuntimeDeps {
  fetch?: typeof fetch;
  /** The signed-in browser tab's DevTools socket (trade-browser.ts); tests pass a fake. */
  openSocket?: (url: string) => CdpSocket;
}

export async function openRuntime(cfg: Config, log: Logger, deps: RuntimeDeps = {}): Promise<Runtime> {
  await mkdir(cfg.dataDir, { recursive: true, mode: 0o700 });
  const lockPath = await lock(cfg.dataDir);
  const store = new BuildStore(cfg.dataDir, cfg.historyKeep);
  await store.init();
  for (const id of await store.recover()) log.warn({ event: "store.recovered", build_id: id }, "finished a delete or restore a stop interrupted");
  const pool = new Pool(cfg, log, store);
  await pool.init();
  const svc = new Service(cfg, store, pool, new Events(), new Fetcher(cfg, log, SHARE_HOSTS, deps.fetch), new Fetcher(cfg, log, [GAME_HOST], deps.fetch), new TradeClient(cfg, log, deps.fetch, undefined, undefined, deps.openSocket), log);
  await svc.purgeTrash();
  return {
    svc,
    close: async () => {
      await pool.shutdown();
      await rm(lockPath, { force: true });
    },
  };
}
