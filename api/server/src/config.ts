// The one place that reads the environment. Everything else receives a Config.
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LEAGUE_NAME } from "./trade.js";

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
  POB_WEB_DIR: z.string().optional(),
  POB_PUBLIC_ORIGIN: z.url().optional(),
  POB_POOL_SIZE: int(4),
  POB_WORKER_TIMEOUT_MS: int(30_000),
  POB_WORKER_BOOT_TIMEOUT_MS: int(60_000),
  POB_WORKER_RSS_MB: int(900),
  POB_IDLE_GC_MS: int(2_000),
  POB_HISTORY_KEEP: int(50),
  POB_MAX_XML_BYTES: int(5_000_000),
  POB_FETCH_USER_AGENT: z.string().min(1).default("pob-api/0.1 (Path of Building API; build imports on request)"),
  POB_API_TRADE_CONTACT: z
    .string()
    .max(120)
    .regex(/^[\x20-\x7e]+$/, "printable ASCII only")
    .optional()
    .describe("Contact for the trade site's operator (an email address or URL), added to the client string as `(api; fork +<contact>)`; unset: `(api; fork)`"),
  POB_API_TRADE_LEAGUE: z
    .string()
    .trim()
    .max(64)
    .regex(LEAGUE_NAME, "a league name is letters, digits, spaces, ' and -")
    .optional()
    .describe("The trade league being played, e.g. the current challenge league; the only league trade searches and trade links are made for. Unset: those calls are refused"),
  POB_API_TRADE_BROWSER_CDP: z
    .string()
    .url()
    .refine((u) => {
      const x = new URL(u);
      return x.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(x.hostname) && x.pathname === "/";
    }, "a loopback http origin, e.g. http://127.0.0.1:9223")
    .optional()
    .describe("DevTools endpoint of a browser on this server with a tab signed in to the trade site; with POB_API_TRADE_BROWSER_TAB, trade.search's searches and fetches run in that tab (the site's signed-in limits). Unset: straight to the site, without login"),
  POB_API_TRADE_BROWSER_TAB: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,64}$/, "a DevTools target id")
    .optional()
    .describe("DevTools target id of the signed-in trade tab (set with POB_API_TRADE_BROWSER_CDP)"),
  POB_FETCH_TIMEOUT_MS: int(10_000),
  POB_FETCH_MAX_BYTES: int(2_000_000),
  MCP_MAX_RESULT_CHARS: int(90_000),
  POB_AUTH_FAILURES_PER_MINUTE: int(30),
  POB_HEALTH_TOKEN: z.string().min(16, "POB_HEALTH_TOKEN must be at least 16 characters").optional(),
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
  /** The built browser view (api/web/dist), served at /; absent = not served. */
  webDir: string;
  /** The origin the page is opened at behind a proxy (e.g. https://pob.example.org), when Host and X-Forwarded-Proto do not give it. */
  publicOrigin: string | undefined;
  poolSize: number;
  workerTimeoutMs: number;
  workerBootTimeoutMs: number;
  workerRssMb: number;
  idleGcMs: number;
  historyKeep: number;
  maxXmlBytes: number;
  fetchUserAgent: string;
  fetchTimeoutMs: number;
  /** Contact added to the trade client string; absent = none. */
  tradeContact: string | undefined;
  /** The league being played; absent = trade searches and links are refused. */
  tradeLeague: string | undefined;
  /** The signed-in server browser tab trade searches run in; absent = straight to the site. */
  tradeBrowser: { cdp: string; tab: string } | undefined;
  fetchMaxBytes: number;
  mcpMaxResultChars: number;
  healthToken: string | undefined;
  /** Failed credential checks per minute (all clients together) before unauthenticated requests get 429. */
  authFailuresPerMinute: number;
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
  if ((e.POB_API_TRADE_BROWSER_CDP === undefined) !== (e.POB_API_TRADE_BROWSER_TAB === undefined)) {
    throw new Error("invalid configuration: POB_API_TRADE_BROWSER_CDP and POB_API_TRADE_BROWSER_TAB are set together or not at all");
  }
  return {
    token: e.POB_API_TOKEN,
    host: e.HOST,
    port: e.PORT,
    pobRoot: e.POB_ROOT,
    dataDir: e.POB_DATA_DIR ?? join(e.XDG_DATA_HOME ?? join(e.HOME ?? homedir(), ".local/share"), "pob-api"),
    runtimeDir: e.POB_RUNTIME_DIR ?? join(e.POB_ROOT, "api/runtime/rt"),
    webDir: e.POB_WEB_DIR ?? join(e.POB_ROOT, "api/web/dist"),
    publicOrigin: e.POB_PUBLIC_ORIGIN === undefined ? undefined : new URL(e.POB_PUBLIC_ORIGIN).origin,
    poolSize: e.POB_POOL_SIZE,
    workerTimeoutMs: e.POB_WORKER_TIMEOUT_MS,
    workerBootTimeoutMs: e.POB_WORKER_BOOT_TIMEOUT_MS,
    workerRssMb: e.POB_WORKER_RSS_MB,
    idleGcMs: e.POB_IDLE_GC_MS,
    historyKeep: e.POB_HISTORY_KEEP,
    maxXmlBytes: e.POB_MAX_XML_BYTES,
    fetchUserAgent: e.POB_FETCH_USER_AGENT,
    fetchTimeoutMs: e.POB_FETCH_TIMEOUT_MS,
    tradeContact: e.POB_API_TRADE_CONTACT,
    tradeLeague: e.POB_API_TRADE_LEAGUE,
    tradeBrowser: e.POB_API_TRADE_BROWSER_CDP && e.POB_API_TRADE_BROWSER_TAB ? { cdp: new URL(e.POB_API_TRADE_BROWSER_CDP).origin, tab: e.POB_API_TRADE_BROWSER_TAB } : undefined,
    fetchMaxBytes: e.POB_FETCH_MAX_BYTES,
    mcpMaxResultChars: e.MCP_MAX_RESULT_CHARS,
    healthToken: e.POB_HEALTH_TOKEN,
    authFailuresPerMinute: e.POB_AUTH_FAILURES_PER_MINUTE,
    sentryDsn: e.SENTRY_DSN,
    sentryEnvironment: e.SENTRY_ENVIRONMENT,
    release: e.RELEASE,
    logLevel: e.LOG_LEVEL,
    ...overrides,
  };
}

/** Config for the stdio transport: the token guards HTTP only, so stdio needs none and a placeholder fills it. */
export function loadStdioConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return loadConfig({ POB_API_TOKEN: "stdio-transport-has-no-network-listener", ...env });
}
