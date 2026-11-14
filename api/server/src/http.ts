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

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time comparison of a presented secret against the configured one. */
export function secretMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

const bearer = (req: Request) => /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];

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
  app.set("query parser", "simple");

  // Boundary log line per request (route pattern, never the URL's query or body).
  app.use((req, res, next) => {
    const started = Date.now();
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    res.on("finish", () => {
      const route = (req.route as { path?: string } | undefined)?.path ?? (req.path.startsWith("/v1") ? "(unmatched)" : req.path);
      log.info({ event: "http.request", request_id: requestId, method: req.method, route, status: res.statusCode, duration_ms: Date.now() - started });
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/health/deep", async (req, res) => {
    if (cfg.healthToken && !secretMatches(req.headers["x-health-token"] as string | undefined, cfg.healthToken)) {
      res.status(401).json({ ok: false, error: { code: "unauthorized", message: "x-health-token required" } });
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

  // Everything below needs the bearer token.
  const auth = (req: Request, res: Response, next: NextFunction) => {
    if (secretMatches(bearer(req), cfg.token)) return next();
    res.setHeader("www-authenticate", "Bearer");
    res.status(401).json({ ok: false, error: { code: "unauthorized", message: "a valid bearer token is required" } });
  };
  app.use("/v1", auth);
  app.use("/mcp", auth);

  // JSON bodies: room for the largest accepted build XML plus JSON escaping.
  const bodyLimit = cfg.maxXmlBytes * 2;
  app.use("/v1", express.json({ limit: bodyLimit }));

  for (const route of routes) {
    const method = route.method.toLowerCase() as "get" | "post" | "delete";
    if (route.stream) {
      app.get(route.path, async (req, res, next) => {
        try {
          const input = parseInput(route, { ...req.params });
          const meta = await svc.store.get(String(input.id));
          svc.events.serve(meta.id, meta.revision, req, res);
        } catch (e) {
          next(e);
        }
      });
      continue;
    }
    const coerce = queryCoercer(route);
    app[method](route.path, async (req, res, next) => {
      try {
        const fromQuery = coerce(req.query);
        const params = coerce(req.params);
        const body = route.method === "POST" && req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
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

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const e = toApiError(err);
    if (e.status >= 500) reportError(log, err, ["http", e.code], { route: String((req.route as { path?: string } | undefined)?.path ?? req.path) });
    if (res.headersSent) return;
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
