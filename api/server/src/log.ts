// The one logger: JSON lines to stdout (journald), plus deliberate error capture when SENTRY_DSN is set.
// Never log build XML, item text, request bodies or the bearer token.
import { pino, type Logger } from "pino";
import type { Config } from "./config.js";

export type { Logger };

export function createLogger(cfg: Pick<Config, "logLevel">, destination?: NodeJS.WritableStream): Logger {
  return pino(
    {
      level: cfg.logLevel,
      base: { service: "pob-api" },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: ["authorization", "*.authorization", "token", "*.token", "xml", "*.xml"], censor: "[redacted]" },
    },
    destination ?? pino.destination({ fd: 1, sync: false }),
  );
}

type Capture = (err: unknown, fingerprint: string[], tags: Record<string, string>) => string | undefined;
let capture: Capture | undefined;

/** Starts error tracking only when a DSN is configured; the gate is shut otherwise. */
export async function initErrorTracking(cfg: Config, log: Logger): Promise<void> {
  if (!cfg.sentryDsn) {
    log.info({ event: "errors.gate_shut" }, "SENTRY_DSN not set; error capture disabled");
    return;
  }
  // Optional peer dependency (its tree carries a non-permissive licence), installed only by those who opt in.
  let Sentry: typeof import("@sentry/node");
  try {
    Sentry = await import("@sentry/node");
  } catch {
    log.error({ event: "errors.unavailable" }, "SENTRY_DSN is set but @sentry/node is not installed (npm install --no-save @sentry/node@11.12.0); error capture disabled");
    return;
  }
  Sentry.init({ dsn: cfg.sentryDsn, environment: cfg.sentryEnvironment, release: cfg.release, tracesSampleRate: 0,
    // Build XML, item text and the token must never leave the box: collect no headers, bodies, query or user data.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, mcp: { inputs: false, outputs: false }, stackFrameVariables: false },
  });
  capture = (err, fingerprint, tags) =>
    Sentry.withScope((scope) => {
      scope.setFingerprint(fingerprint);
      scope.setTags(tags);
      return Sentry.captureException(err);
    });
}

/** Logs an error at its decision point and captures it with an explicit fingerprint when tracking is on. */
export function reportError(log: Logger, err: unknown, fingerprint: string[], tags: Record<string, string> = {}): void {
  const sentryEventId = capture?.(err, fingerprint, tags);
  const e = err instanceof Error ? err : new Error(String(err));
  log.error({ event: "error.captured", fingerprint: fingerprint.join("/"), ...tags, sentry_event_id: sentryEventId, err: { message: e.message, stack: e.stack } });
}
