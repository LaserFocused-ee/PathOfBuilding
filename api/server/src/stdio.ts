#!/usr/bin/env node
// MCP over stdio (`pob-api-mcp`): the same tools as POST /mcp, in-process. stdout carries the
// protocol, so logs go to stderr. No bearer token: whoever starts the process owns it.
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadStdioConfig } from "./config.js";
import { createLogger, initErrorTracking, reportError } from "./log.js";
import { mcpServer } from "./mcp.js";
import { openRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const cfg = loadStdioConfig();
  const log = createLogger(cfg, process.stderr);
  await initErrorTracking(cfg, log);
  const runtime = await openRuntime(cfg, log);
  const handle = serveStdio(() => mcpServer(runtime.svc), { onerror: (e) => log.warn({ event: "mcp.error", err: e.message }) });
  log.info({ event: "mcp.stdio_ready" }, "MCP on stdio");
  const stop = () => {
    void handle.close().then(() => runtime.close()).then(() => process.exit(0));
  };
  process.stdin.once("end", stop);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

main().catch((e: unknown) => {
  process.stderr.write(`${(e as Error).message}\n`);
  reportError(createLogger({ logLevel: "error" }, process.stderr), e, ["mcp", "stdio_start"]);
  process.exit(1);
});
