// Shared test setup: temporary data directories, a server on an ephemeral loopback port, a JSON client.
import { rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Writable } from "node:stream";
import { loadConfig, type Config } from "../src/config.js";
import { start, type Started } from "../src/index.js";
import { createLogger } from "../src/log.js";
import type { RuntimeDeps } from "../src/runtime.js";

export const TOKEN = "test-token-0123456789abcdef0123456789abcdef";
/** Repository root (dist/test -> four levels up). */
export const ROOT = resolve(import.meta.dirname, "../../../..");
export const FIXTURES = resolve(import.meta.dirname, "../../test/fixtures");

/** Directories this process made; a test file that is cut off or fails before `close()` still removes them when the process exits. */
const made = new Set<string>();
process.on("exit", () => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

export async function tempDir(prefix: string): Promise<{ path: string; remove: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), `pob-api-${prefix}-`));
  made.add(path);
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

/** A logger that keeps every line in memory (tests assert boundary log lines). */
export function memoryLogger(): { log: ReturnType<typeof createLogger>; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString("utf8").split("\n")) if (l) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  return { log: createLogger({ logLevel: "info" }, sink), lines };
}

export function testConfig(dataDir: string, overrides: Partial<Config> = {}): Config {
  return loadConfig({ POB_API_TOKEN: TOKEN, PORT: "0", POB_DATA_DIR: dataDir, POB_POOL_SIZE: "3", POB_AUTH_FAILURES_PER_MINUTE: "100000", HOME: dataDir }, overrides);
}

export interface TestServer extends Started {
  call: <T = unknown>(method: string, path: string, body?: unknown, token?: string | null) => Promise<{ status: number; body: { ok: boolean; result: T; warnings: string[]; error?: { code: string; message: string } } }>;
  lines: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

export async function startServer(overrides: Partial<Config> = {}, deps: RuntimeDeps = {}): Promise<TestServer> {
  const dir = await tempDir("srv");
  const { log, lines } = memoryLogger();
  const s = await start(testConfig(dir.path, overrides), log, deps);
  const base = `http://127.0.0.1:${s.port}`;
  return {
    ...s,
    lines,
    call: async (method, path, body, token = TOKEN) => {
      const res = await fetch(base + path, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: (await res.json()) as never };
    },
    close: async () => {
      await s.stop();
      await dir.remove();
    },
  };
}
