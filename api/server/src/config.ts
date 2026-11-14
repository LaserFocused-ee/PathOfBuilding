// The one place that reads the environment. Everything else receives a Config.
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// dist/src/config.js -> repository root is four levels up (api/server/dist/src).
const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = resolve(here, "../../../..");

const int = (def: number, min = 1) => z.coerce.number().int().min(min).default(def);

const schema = z.object({
  POB_API_TOKEN: z.string().min(32, "POB_API_TOKEN must be at least 32 characters"),
  HOST: z.string().default("127.0.0.1"),
  PORT: int(8730, 0),
  POB_ROOT: z.string().default(defaultRoot),
  POB_DATA_DIR: z.string().optional(),
  XDG_DATA_HOME: z.string().optional(),
  HOME: z.string().optional(),
  POB_RUNTIME_DIR: z.string().optional(),
  POB_POOL_SIZE: int(4),
  POB_WORKER_TIMEOUT_MS: int(30_000),
  POB_WORKER_BOOT_TIMEOUT_MS: int(60_000),
  POB_WORKER_RSS_MB: int(900),
  POB_IDLE_GC_MS: int(2_000),
  POB_HISTORY_KEEP: int(50),
  POB_MAX_XML_BYTES: int(5_000_000),
  POB_FETCH_USER_AGENT: z.string().min(1).default("pob-api/0.1 (Path of Building API; build imports on request)"),
  POB_FETCH_TIMEOUT_MS: int(10_000),
  POB_FETCH_MAX_BYTES: int(2_000_000),
  MCP_MAX_RESULT_CHARS: int(90_000),
  POB_HEALTH_TOKEN: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().default("production"),
  RELEASE: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface Config {
  token: string;
  host: string;
  port: number;
  pobRoot: string;
  dataDir: string;
  runtimeDir: string;
  poolSize: number;
  workerTimeoutMs: number;
  workerBootTimeoutMs: number;
  workerRssMb: number;
  idleGcMs: number;
  historyKeep: number;
  maxXmlBytes: number;
  fetchUserAgent: string;
  fetchTimeoutMs: number;
  fetchMaxBytes: number;
  mcpMaxResultChars: number;
  healthToken: string | undefined;
  sentryDsn: string | undefined;
  sentryEnvironment: string;
  release: string | undefined;
  logLevel: string;
}

/** Reads and validates the environment; throws one error naming every bad variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  // Empty strings count as unset (systemd EnvironmentFile lines like `SENTRY_DSN=`).
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`invalid configuration: ${lines.join("; ")}`);
  }
  const e = parsed.data;
  return {
    token: e.POB_API_TOKEN,
    host: e.HOST,
    port: e.PORT,
    pobRoot: e.POB_ROOT,
    dataDir: e.POB_DATA_DIR ?? join(e.XDG_DATA_HOME ?? join(e.HOME ?? homedir(), ".local/share"), "pob-api"),
    runtimeDir: e.POB_RUNTIME_DIR ?? join(e.POB_ROOT, "api/runtime/rt"),
    poolSize: e.POB_POOL_SIZE,
    workerTimeoutMs: e.POB_WORKER_TIMEOUT_MS,
    workerBootTimeoutMs: e.POB_WORKER_BOOT_TIMEOUT_MS,
    workerRssMb: e.POB_WORKER_RSS_MB,
    idleGcMs: e.POB_IDLE_GC_MS,
    historyKeep: e.POB_HISTORY_KEEP,
    maxXmlBytes: e.POB_MAX_XML_BYTES,
    fetchUserAgent: e.POB_FETCH_USER_AGENT,
    fetchTimeoutMs: e.POB_FETCH_TIMEOUT_MS,
    fetchMaxBytes: e.POB_FETCH_MAX_BYTES,
    mcpMaxResultChars: e.MCP_MAX_RESULT_CHARS,
    healthToken: e.POB_HEALTH_TOKEN,
    sentryDsn: e.SENTRY_DSN,
    sentryEnvironment: e.SENTRY_ENVIRONMENT,
    release: e.RELEASE,
    logLevel: e.LOG_LEVEL,
    ...overrides,
  };
}
