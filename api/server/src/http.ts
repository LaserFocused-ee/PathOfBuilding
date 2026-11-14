// HTTP: health, the bearer check, one handler per route-table entry, and MCP at POST /mcp.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { ApiError } from "./errors.js";
import type { Logger } from "./log.js";
import { reportError } from "./log.js";
import { mcpServer } from "./mcp.js";
import { LOOKUP_SESSION } from "./pool.js";
import { parseInput, routes, type Route } from "./routes.js";
import type { Service } from "./service.js";
import { cookie, mountWeb, SESSION_SECONDS, sessionCookie, sessionCookieName, Sessions } from "./web.js";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison of a presented secret against the configured one. */
export function secretMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

/** Timestamps of recent failures in a sliding window. */
export class FailureWindow {
  private times: number[] = [];
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  private prune(now: number): void {
    while (this.times.length > 0 && now - (this.times[0] ?? 0) >= this.windowMs) this.times.shift();
  }
  /** Seconds until another failure is allowed (0 = allowed now). */
  retryAfterSeconds(now: number): number {
    this.prune(now);
    if (this.times.length < this.limit) return 0;
    return Math.max(1, Math.ceil(((this.times[0] ?? now) + this.windowMs - now) / 1000));
  }
  /** Records a failure; true when this one reaches the limit. */
  add(now: number): boolean {
    this.times.push(now);
    return this.times.length === this.limit;
  }
}

const bearer = (req: Request) => /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1]; // the scheme is case-insensitive (RFC 9110)

/** The route pattern for logs: never a raw path, which can carry build ids. */
const FIXED_PATHS = ["/health", "/health/deep", "/mcp", "/v1/fetch", "/v1/session"];
const routeLabel = (req: Request): string => {
  const pattern = (req.route as { path?: string } | undefined)?.path;
  if (pattern) return pattern;
  const path = req.originalUrl.split("?")[0] ?? "";
  return FIXED_PATHS.includes(path) ? path : "(unmatched)";
};

/** Turns query-string values into the types a route's input schema declares (number, boolean, list). */
function queryCoercer(route: Route): (q: Record<string, unknown>) => Record<string, unknown> {
  const props = (z.toJSONSchema(route.input, { io: "input", unrepresentable: "any" }).properties ?? {}) as Record<string, { type?: string }>;
  return (q) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(q)) {
      const raw = Array.isArray(v) ? v.join(",") : v;
      const t = props[k]?.type;
      if (typeof raw !== "string") out[k] = raw;
      else if (t === "number" || t === "integer") out[k] = raw.trim() === "" ? raw : Number(raw);
      else if (t === "boolean") out[k] = raw === "true" ? true : raw === "false" ? false : raw;
      else if (t === "array") out[k] = raw.split(",").map((s) => s.trim()).filter(Boolean);
      else out[k] = raw;
    }
    return out;
  };
}

export function createApp(svc: Service, log: Logger): express.Express {
  const { cfg } = svc;
  const app = express();
  app.disable("x-powered-by");
  // A proxy on this host (a tunnel, say) tells us the request came over HTTPS (Secure cookie, own origin).
  app.set("trust proxy", "loopback");
  app.set("query parser", "simple");

  // Boundary log line per request (route pattern, never the URL's query or body).
  app.use((req, res, next) => {
    const started = Date.now();
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    res.on("finish", () => {
      log.info({ event: "http.request", request_id: requestId, method: req.method, route: routeLabel(req), status: res.statusCode, duration_ms: Date.now() - started });
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Failed credential checks share one budget; past it, unauthenticated requests get 429 until the
  // window clears. A valid credential always passes, so the owner is never locked out.
  const failures = new FailureWindow(cfg.authFailuresPerMinute, 60_000);
  const refuse = (res: Response, header: string) => {
    const wait = failures.retryAfterSeconds(Date.now());
    if (wait > 0) {
      res.setHeader("retry-after", String(wait));
      res.status(429).json({ ok: false, error: { code: "rate_limited", message: "too many failed credential checks; retry later" } });
      return;
    }
    if (failures.add(Date.now())) log.warn({ event: "http.auth_limited", window_s: 60, limit: cfg.authFailuresPerMinute }, "failed credential checks over the limit");
    if (header === "bearer") res.setHeader("www-authenticate", "Bearer");
    res.status(401).json({ ok: false, error: { code: "unauthorized", message: header === "bearer" ? "a valid bearer token is required" : "x-health-token or a bearer token is required" } });
  };

  // Deep health runs a worker, so it needs a credential: the health token when one is set, or the bearer token.
  app.get("/health/deep", async (req, res) => {
    const healthOk = cfg.healthToken !== undefined && secretMatches(req.headers["x-health-token"] as string | undefined, cfg.healthToken);
    if (!healthOk && !secretMatches(bearer(req), cfg.token)) {
      refuse(res, "health");
      return;
    }
    try {
      const ping = await svc.pool.run<{ pobVersion: string; latestTreeVersion: string }>(LOOKUP_SESSION, "worker.ping");
      res.json({ ok: true, pobVersion: ping.result.pobVersion, latestTreeVersion: ping.result.latestTreeVersion, pool: svc.pool.stats() });
    } catch (e) {
      reportError(log, e, ["health", "deep"]);
      res.status(503).json({ ok: false, error: { code: e instanceof ApiError ? e.code : "worker_error", message: "worker check failed" }, pool: svc.pool.stats() });
    }
  });

  // The browser view signs in once with the token and then holds a session cookie (POST needs the token itself).
  const sessions = new Sessions();
  const cookieName = sessionCookieName(cfg.publicOrigin);
  const secureCookie = (req: Request) => cookieName.startsWith("__Host-") || req.secure;
  app.post("/v1/session", (req, res) => {
    if (!secretMatches(bearer(req), cfg.token)) {
      refuse(res, "bearer");
      return;
    }
    res.setHeader("set-cookie", sessionCookie(cookieName, sessions.create(), SESSION_SECONDS, secureCookie(req)));
    log.info({ event: "http.session_created" }, "browser session created");
    res.status(204).end();
  });

  // Everything below needs the bearer token; /v1 also takes a session cookie. A cookie-authenticated
  // request that can change something must come from this server's own origin (on top of SameSite=Strict):
  // POB_PUBLIC_ORIGIN when set, else the origin the request was addressed to.
  const auth = (allowCookie: boolean) => (req: Request, res: Response, next: NextFunction) => {
    if (secretMatches(bearer(req), cfg.token)) return next();
    if (allowCookie && sessions.valid(cookie(req, cookieName))) {
      const origin = req.headers.origin;
      const own = origin !== undefined && origin === (cfg.publicOrigin ?? `${req.protocol}://${req.get("host") ?? ""}`);
      if (req.method === "GET" || req.method === "HEAD" || own) return next();
      log.warn({ event: "http.cross_origin_refused", method: req.method, route: routeLabel(req) }, "cookie request from another origin");
      res.status(403).json({ ok: false, error: { code: "forbidden", message: "a cookie-authenticated change must come from this server's own page" } });
      return;
    }
    refuse(res, "bearer");
  };
  app.use("/v1", auth(true));
  app.use("/mcp", auth(false));
  app.delete("/v1/session", (req, res) => {
    sessions.delete(cookie(req, cookieName));
    res.setHeader("set-cookie", sessionCookie(cookieName, "", 0, secureCookie(req)));
    res.status(204).end();
  });

  // JSON bodies: room for the largest accepted build XML plus JSON escaping.
  const bodyLimit = cfg.maxXmlBytes * 2;
  app.use("/v1", express.json({ limit: bodyLimit }));

  // The browser view's own imports (Path of Building's import code), fetched here because the page cannot
  // reach other origins. Not an MCP action: agents import through the build routes.
  const relayInput = z.strictObject({
    url: z.string().max(4000),
    headers: z.record(z.string().max(100), z.string().max(1000)).optional(),
    body: z.string().max(100_000).optional(),
  });
  app.post("/v1/fetch", async (req, res, next) => {
    try {
      const parsed = relayInput.safeParse(req.body ?? {});
      if (!parsed.success) throw new ApiError("invalid_input", parsed.error.issues.map((i) => (i.code === "unrecognized_keys" ? `unknown parameter(s) ${i.keys.join(", ")}; fetch takes url, headers, body` : `${i.path.join(".")}: ${i.message}`)).join("; "));
      res.json({ ok: true, result: await svc.relay(parsed.data), warnings: [] });
    } catch (e) {
      next(e);
    }
  });

  for (const route of routes) {
    const method = route.method.toLowerCase() as "get" | "post" | "put" | "delete";
    const coerce = queryCoercer(route);
    if (route.stream) {
      app.get(route.path, async (req, res, next) => {
        try {
          const input = parseInput(route, { ...coerce(req.query), ...req.params });
          const meta = await svc.store.get(String(input.id));
          svc.events.serve(meta.id, meta.revision, req, res);
        } catch (e) {
          next(e);
        }
      });
      continue;
    }
    app[method](route.path, async (req, res, next) => {
      try {
        const fromQuery = coerce(req.query);
        const params = coerce(req.params);
        const body = (route.method === "POST" || route.method === "PUT") && req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
        const input = parseInput(route, { ...fromQuery, ...body, ...params });
        const out = await route.run(svc, input);
        res.json({ ok: true, result: out.result, warnings: out.warnings });
      } catch (e) {
        next(e);
      }
    });
  }

  const mcp = toNodeHandler(createMcpHandler(() => mcpServer(svc), { maxRequestBodySize: bodyLimit, onerror: (e) => log.warn({ event: "mcp.error", err: e.message }) }), { maxRequestBodySize: bodyLimit });
  app.post("/mcp", (req, res) => {
    void mcp(req, res);
  });
  app.all("/mcp", (_req, res) => {
    res.status(405).json({ ok: false, error: { code: "unsupported", message: "MCP is served stateless at POST /mcp" } });
  });

  app.use("/v1", (_req, res) => {
    res.status(404).json({ ok: false, error: { code: "not_found", message: "no such route" } });
  });

  mountWeb(app, cfg.webDir, log);
  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: "not_found", message: "not found" } });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const e = toApiError(err);
    if (e.status >= 500) reportError(log, err, ["http", e.code], { route: routeLabel(req) });
    if (res.headersSent) return;
    if (typeof e.details?.retryAfterSeconds === "number") res.setHeader("retry-after", String(e.details.retryAfterSeconds));
    res.status(e.status).json({ ok: false, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
  });

  return app;
}

/** Maps anything thrown to a registered error; unknown errors become worker_error without their text. */
function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const type = (err as { type?: unknown }).type;
  if (type === "entity.too.large") return new ApiError("payload_too_large", "request body is too large");
  if (type === "entity.parse.failed") return new ApiError("invalid_input", "request body is not valid JSON");
  return new ApiError("worker_error", "internal error");
}
