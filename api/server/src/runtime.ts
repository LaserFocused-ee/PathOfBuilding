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

async function lock(dir: string): Promise<string> {
  const path = join(dir, "server.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, String(process.pid), { flag: "wx", mode: 0o600 });
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = Number(await readFile(path, "utf8").catch(() => "0"));
      if (holder > 0 && alive(holder)) throw new Error(`data directory ${dir} is in use by process ${holder}`, { cause: e });
      await rm(path, { force: true }); // stale lock from a process that is gone
    }
  }
  throw new Error(`could not lock data directory ${dir}`);
}

/** Outside services the runtime uses; tests pass a recorded fetch. */
export interface RuntimeDeps {
  fetch?: typeof fetch;
}

export async function openRuntime(cfg: Config, log: Logger, deps: RuntimeDeps = {}): Promise<Runtime> {
  await mkdir(cfg.dataDir, { recursive: true, mode: 0o700 });
  const lockPath = await lock(cfg.dataDir);
  const store = new BuildStore(cfg.dataDir, cfg.historyKeep);
  await store.init();
  const pool = new Pool(cfg, log, store);
  await pool.init();
  const svc = new Service(cfg, store, pool, new Events(), new Fetcher(cfg, log, SHARE_HOSTS, deps.fetch), new Fetcher(cfg, log, [GAME_HOST], deps.fetch), log);
  await svc.purgeTrash();
  return {
    svc,
    close: async () => {
      await pool.shutdown();
      await rm(lockPath, { force: true });
    },
  };
}
