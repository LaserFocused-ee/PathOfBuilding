// HTTP server entry point: `node dist/src/index.js` (npm start).
import type { Server } from "node:http";
import { loadConfig } from "./config.js";
import { createApp } from "./http.js";
import { createLogger, initErrorTracking, reportError } from "./log.js";
import { openRuntime, type Runtime } from "./runtime.js";

export interface Started {
  server: Server;
  port: number;
  runtime: Runtime;
  stop: () => Promise<void>;
}

/** Starts the HTTP server on cfg.host:cfg.port (port 0 picks a free one). Tests call this too. */
export async function start(cfg = loadConfig(), log = createLogger(cfg)): Promise<Started> {
  await initErrorTracking(cfg, log);
  const runtime = await openRuntime(cfg, log);
  const app = createApp(runtime.svc, log);
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(cfg.port, cfg.host, () => resolve(s));
    s.once("error", reject);
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : cfg.port;
  log.info({ event: "server.listening", host: cfg.host, port, pool_size: cfg.poolSize }, "listening");
  const stop = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  };
  return { server, port, runtime, stop };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(2);
  }
  const log = createLogger(cfg);
  start(cfg, log).then(
    (s) => {
      for (const sig of ["SIGTERM", "SIGINT"] as const) {
        process.once(sig, () => {
          log.info({ event: "server.stopping", signal: sig });
          void s.stop().then(() => process.exit(0));
        });
      }
    },
    (e) => {
      reportError(log, e, ["server", "start"]);
      process.exitCode = 1;
    },
  );
}
