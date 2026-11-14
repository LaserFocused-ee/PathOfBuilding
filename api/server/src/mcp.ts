// MCP tools generated from the route table: one tool per domain, an `action` enum over its routes,
// the routes' inputs merged as optional parameters and validated again per action.
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { reportError } from "./log.js";
import { action, parseInput, routes, TOOLS, type Domain, type Route } from "./routes.js";
import type { Service } from "./service.js";

export const SERVER_NAME = "path-of-building";
export const SERVER_VERSION = "0.1.0";

interface ToolDef {
  name: string;
  domain: Domain;
  routes: Route[];
  input: z.ZodObject<z.core.$ZodShape>;
  description: string;
  readOnly: boolean;
}

/** The tools that have at least one routed action, in spec order. */
export function toolDefs(): ToolDef[] {
  const defs: ToolDef[] = [];
  for (const [domain, toolName] of Object.entries(TOOLS) as Array<[Domain, string]>) {
    const rs = routes.filter((r) => r.domain === domain && !r.stream);
    if (rs.length === 0) continue;
    // A parameter several actions share takes whatever any of them accepts (each action validates
    // its own again in callTool); identical schemas are listed once.
    const variants = new Map<string, Map<string, z.ZodType>>();
    for (const r of rs) {
      for (const [k, v] of Object.entries(r.input.shape) as Array<[string, z.ZodType]>) {
        const seen = variants.get(k) ?? new Map<string, z.ZodType>();
        seen.set(JSON.stringify(z.toJSONSchema(v, { unrepresentable: "any" })), v);
        variants.set(k, seen);
      }
    }
    const shape: Record<string, z.ZodType> = {};
    for (const [k, seen] of variants) {
      const list = [...seen.values()];
      shape[k] = z.optional(list.length === 1 ? (list[0] as z.ZodType) : z.union(list as [z.ZodType, z.ZodType, ...z.ZodType[]]));
    }
    const actions = rs.map(action) as [string, ...string[]];
    const lines = rs.map((r) => `- ${action(r)}: ${r.summary} Params: ${Object.keys(r.input.shape).join(", ") || "none"}.`);
    defs.push({
      name: toolName,
      domain,
      routes: rs,
      input: z.object({ action: z.enum(actions).describe("Which operation to run"), ...shape }),
      description: `Path of Building ${domain} operations. Pick one action:\n${lines.join("\n")}`,
      readOnly: rs.every((r) => r.readOnly),
    });
  }
  return defs;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown>; isError?: boolean };

const reply = (body: Record<string, unknown>, isError = false): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(body) }],
  structuredContent: body,
  ...(isError ? { isError: true } : {}),
});

/** Runs one tool call; failures come back as isError results, never as protocol errors. */
export async function callTool(svc: Service, def: ToolDef, args: Record<string, unknown>): Promise<ToolResult> {
  const started = Date.now();
  const act = String(args.action);
  const route = def.routes.find((r) => action(r) === act);
  let code: string | undefined;
  try {
    if (!route) throw new ApiError("invalid_input", `unknown action ${act}`);
    const rest = { ...args };
    delete rest.action;
    const out = await route.run(svc, parseInput(route, rest));
    const body = { ok: true, result: out.result, warnings: out.warnings };
    const size = JSON.stringify(body).length;
    if (size > svc.cfg.mcpMaxResultChars) {
      const r = out.result;
      const keys = r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r).slice(0, 2000) : undefined;
      return reply({ ok: true, truncated: true, size, limit: svc.cfg.mcpMaxResultChars, keys, hint: "Result too large: narrow it with `fields`, `limit` or a more specific query." });
    }
    return reply(body);
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError("worker_error", "internal error");
    code = err.code;
    if (err.status >= 500) reportError(svc.log, e, ["mcp", def.name, err.code], { action: act });
    return reply({ ok: false, error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, true);
  } finally {
    svc.log.info({ event: "mcp.tool", tool: def.name, action: act, ok: code === undefined, code, duration_ms: Date.now() - started });
  }
}

/** A fresh MCP server instance with every tool registered (the HTTP handler makes one per request). */
export function mcpServer(svc: Service): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  for (const def of toolDefs()) {
    server.registerTool(
      def.name,
      {
        title: `Path of Building: ${def.domain}`,
        description: def.description,
        inputSchema: def.input,
        annotations: { readOnlyHint: def.readOnly, destructiveHint: !def.readOnly, openWorldHint: def.domain === "build" },
      },
      (args) => callTool(svc, def, args),
    );
  }
  return server;
}
