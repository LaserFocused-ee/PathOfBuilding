// The single route table. HTTP routes, the MCP tools and docs/API.md are all generated from it.
import { z } from "zod";
import { ApiError } from "./errors.js";
import type { Output, Service } from "./service.js";

/** MCP tool names (fixed by the spec); a tool appears once it has routes. */
export const TOOLS = {
  build: "pob_build",
  stats: "pob_stats",
  tree: "pob_tree",
  skills: "pob_skills",
  items: "pob_items",
  config: "pob_config",
  evaluate: "pob_evaluate",
  lookup: "pob_lookup",
  trade: "pob_trade",
} as const;
export type Domain = keyof typeof TOOLS;

export interface Route {
  /** `<domain>.<action>`; the action is the MCP `action` value. */
  name: string;
  domain: Domain;
  method: "GET" | "POST" | "DELETE";
  /** Express path; `:id` and other params are merged into the input. */
  path: string;
  summary: string;
  input: z.ZodObject<z.core.$ZodShape>;
  output: z.ZodType;
  readOnly: boolean;
  /** Worker op it reaches, for the docs (service-only routes say so). */
  workerOp: string;
  /** Server-sent event stream: HTTP only, not an MCP action. */
  stream?: boolean;
  run: (svc: Service, input: Record<string, unknown>) => Promise<Output>;
}

const buildId = z.string().regex(/^[a-f0-9]{16}$/, "a build id is 16 lowercase hex characters").describe("Build id");
const revision = z.number().int().min(1);
const name = z.string().trim().min(1).max(200);
const limit = z.number().int().min(1).max(200).optional().describe("Result cap (1-200)");
const any = z.unknown();
const meta = z.looseObject({ id: z.string(), name: z.string(), revision: z.number(), createdAt: z.string(), updatedAt: z.string(), source: z.looseObject({ kind: z.string() }) });
const summary = z.looseObject({ name: z.string(), className: z.string(), ascendancy: z.string().optional(), level: z.number(), treeVersion: z.string(), mainSkill: z.string().optional() });
const created = z.object({ build: meta, summary });

const str = (v: unknown) => v as string;
const pick = (input: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));

/** A read-only worker op on a build's session. */
const statRoute = (action: string, summaryText: string, input: z.ZodObject<z.core.$ZodShape>, output: z.ZodType, args: string[] = []): Route => ({
  name: `stats.${action}`,
  domain: "stats",
  method: "GET",
  path: `/v1/stats/:id/${action}`,
  summary: summaryText,
  input: input.extend({ id: buildId }),
  output,
  readOnly: true,
  workerOp: `stats.${action}`,
  run: (svc, i) => svc.read(str(i.id), `stats.${action}`, pick(i, ...args)),
});

/** A read-only lookup; runs on the named build's session or on the shared lookup session. */
const lookupRoute = (action: string, path: string, summaryText: string, input: z.ZodObject<z.core.$ZodShape>, args: string[] | ((i: Record<string, unknown>) => Record<string, unknown>)): Route => ({
  name: `lookup.${action}`,
  domain: "lookup",
  method: "GET",
  path,
  summary: summaryText,
  input: input.extend({ buildId: buildId.optional().describe("Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree") }),
  output: any,
  readOnly: true,
  workerOp: `lookup.${action}`,
  run: (svc, i) => svc.read(i.buildId as string | undefined, `lookup.${action}`, typeof args === "function" ? args(i) : pick(i, ...args)),
});

/** A read-only worker op on a build's session, at GET /v1/<area>/:id/<action>. */
const readRoute = (domain: Domain, area: string, action: string, summaryText: string, input: z.ZodObject<z.core.$ZodShape>, args: string[] = [], op = `${domain}.${action}`): Route => ({
  name: `${domain}.${action}`,
  domain,
  method: "GET",
  path: `/v1/${area}/:id/${action.replaceAll("_", "-")}`,
  summary: summaryText,
  input: input.extend({ id: buildId }),
  output: any,
  readOnly: true,
  workerOp: op,
  run: (svc, i) => svc.read(str(i.id), op, pick(i, ...args)),
});

const mutationOutput = z.object({
  result: any,
  changed: z.record(z.string(), z.object({ before: z.number().nullable(), after: z.number().nullable() })).describe("Sidebar stats that changed"),
  revision: z.number(),
});

/** A worker mutation at POST /v1/<area>/:id/<action>: stored as a new revision, answered with the stats it changed. */
const mutateRoute = (domain: Domain, area: string, action: string, summaryText: string, input: z.ZodObject<z.core.$ZodShape>, args: string[] = [], op = `${domain}.${action}`): Route => ({
  name: `${domain}.${action}`,
  domain,
  method: "POST",
  path: `/v1/${area}/:id/${action.replaceAll("_", "-")}`,
  summary: summaryText,
  input: input.extend({ id: buildId, baseRevision: revision.optional().describe("Refuse the change unless the build is at this revision") }),
  output: mutationOutput,
  readOnly: false,
  workerOp: op,
  run: (svc, i) => svc.mutate(str(i.id), op, pick(i, ...args), i.baseRevision as number | undefined),
});

const nodeRef = z.union([z.number().int().min(0), z.string().trim().min(1).max(200)]).describe("Node id, or its exact name");
const nodeList = z.array(nodeRef).min(1).max(200);
const specIndex = z.number().int().min(1).max(500).describe("Tree number in the tree list, from 1");
const setIndex = z.number().int().min(1).max(500).describe("Config set number in the set list, from 1");
const title = z.string().trim().min(1).max(100);
const treeVersion = z.string().regex(/^\d+_\d+(_[a-z]+)?$/).describe("e.g. 3_30");
const configValue = z.union([z.boolean(), z.number(), z.string().max(20000)]);

export const routes: Route[] = [
  // builds
  { name: "build.list", domain: "build", method: "GET", path: "/v1/builds", summary: "List stored builds, most recently changed first.", input: z.object({}), output: z.object({ builds: z.array(meta) }), readOnly: true, workerOp: "(store)", run: (s) => s.list() },
  {
    name: "build.new", domain: "build", method: "POST", path: "/v1/builds", summary: "Create an empty build. Tree version defaults to the latest.",
    input: z.object({ name: name.optional(), className: z.string().optional().describe("e.g. Witch"), ascendancy: z.string().optional().describe("e.g. Elementalist"), level: z.number().int().min(1).max(100).optional(), treeVersion: z.string().regex(/^\d+_\d+(_[a-z]+)?$/).optional().describe("e.g. 3_30") }),
    output: created, readOnly: false, workerOp: "builds.new, builds.export",
    run: (s, i) => s.newBuild(i),
  },
  { name: "build.import_xml", domain: "build", method: "POST", path: "/v1/builds/import/xml", summary: "Load a build from Path of Building XML.", input: z.object({ xml: z.string().min(1), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.importXml({ xml: str(i.xml), name: i.name as string | undefined }) },
  { name: "build.import_code", domain: "build", method: "POST", path: "/v1/builds/import/code", summary: "Load a build from a build code (the text Path of Building shares).", input: z.object({ code: z.string().min(1), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.importCode({ code: str(i.code), name: i.name as string | undefined }) },
  {
    name: "build.import_link", domain: "build", method: "POST", path: "/v1/builds/import/link", summary: "Load a build from a share link on a supported site (pobb.in, pastebin, Maxroll, poe.ninja, pob.codes, rentry, poedb).",
    input: z.object({ url: z.string().url().max(2000), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.resolve_link, builds.load, builds.export",
    run: (s, i) => s.importLink({ url: str(i.url), name: i.name as string | undefined }),
  },
  { name: "build.trash", domain: "build", method: "GET", path: "/v1/builds/trash", summary: "Deleted builds that can still be restored (kept 7 days after deletion).", input: z.object({}), output: z.object({ builds: z.array(meta.extend({ deletedAt: z.string(), purgeAfter: z.string() })) }), readOnly: true, workerOp: "(store)", run: (s) => s.trash() },
  { name: "build.get", domain: "build", method: "GET", path: "/v1/builds/:id", summary: "A build's metadata and summary (class, ascendancy, level, tree version, main skill).", input: z.object({ id: buildId }), output: created, readOnly: true, workerOp: "builds.summary", run: (s, i) => s.get(str(i.id)) },
  { name: "build.rename", domain: "build", method: "POST", path: "/v1/builds/:id/rename", summary: "Rename a build (a new revision).", input: z.object({ id: buildId, name, baseRevision: revision.optional() }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.rename(str(i.id), { name: str(i.name), baseRevision: i.baseRevision as number | undefined }) },
  { name: "build.duplicate", domain: "build", method: "POST", path: "/v1/builds/:id/duplicate", summary: "Copy a build into a new build.", input: z.object({ id: buildId, name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.duplicate(str(i.id), { name: i.name as string | undefined }) },
  { name: "build.delete", domain: "build", method: "DELETE", path: "/v1/builds/:id", summary: "Delete a build. It stays restorable for 7 days (`restore`), then it and its history are removed.", input: z.object({ id: buildId, baseRevision: revision.optional() }), output: z.object({ deleted: z.string(), restorableDays: z.number() }), readOnly: false, workerOp: "(store)", run: (s, i) => s.delete(str(i.id), { baseRevision: i.baseRevision as number | undefined }) },
  { name: "build.restore", domain: "build", method: "POST", path: "/v1/builds/:id/restore", summary: "Restore a deleted build with its history.", input: z.object({ id: buildId }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.restore(str(i.id)) },
  { name: "build.revert", domain: "build", method: "POST", path: "/v1/builds/:id/revert", summary: "Make a kept revision current again (as a new revision).", input: z.object({ id: buildId, revision, baseRevision: revision.optional() }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.revert(str(i.id), { revision: i.revision as number, baseRevision: i.baseRevision as number | undefined }) },
  mutateRoute("build", "builds", "settings", "Character level and the Auto/Manual level mode (auto follows points spent).", z.object({ level: z.number().int().min(1).max(100).optional(), autoLevel: z.boolean().optional() }), ["level", "autoLevel"], "config.set_level"),
  { name: "build.export_xml", domain: "build", method: "GET", path: "/v1/builds/:id/xml", summary: "A build's XML at the current or a kept revision.", input: z.object({ id: buildId, revision: revision.optional() }), output: z.object({ id: z.string(), revision: z.number(), xml: z.string() }), readOnly: true, workerOp: "(store)", run: (s, i) => s.exportXml(str(i.id), { revision: i.revision as number | undefined }) },
  { name: "build.export_code", domain: "build", method: "GET", path: "/v1/builds/:id/code", summary: "A build code for the current revision, importable by Path of Building.", input: z.object({ id: buildId }), output: z.object({ id: z.string(), revision: z.number(), code: z.string() }), readOnly: true, workerOp: "builds.export", run: (s, i) => s.exportCode(str(i.id)) },
  { name: "build.save_point", domain: "build", method: "POST", path: "/v1/builds/:id/save-points", summary: "Mark the current revision as a save point (kept past history pruning).", input: z.object({ id: buildId, label: z.string().trim().min(1).max(200).optional() }), output: z.object({ id: z.string(), revision: z.number(), label: z.string().optional() }), readOnly: false, workerOp: "(store)", run: (s, i) => s.savePoint(str(i.id), { label: i.label as string | undefined }) },
  { name: "build.history", domain: "build", method: "GET", path: "/v1/builds/:id/history", summary: "Revisions kept for a build, newest first (last 50 plus save points).", input: z.object({ id: buildId }), output: z.object({ id: z.string(), revision: z.number(), history: z.array(z.looseObject({ revision: z.number(), at: z.string(), cause: z.string() })) }), readOnly: true, workerOp: "(store)", run: (s, i) => s.history(str(i.id)) },
  {
    name: "build.events", domain: "build", method: "GET", path: "/v1/builds/:id/events", summary: "Server-sent events: `hello` with the current revision, then `change` (revision, cause, changed stats) and `deleted`.",
    input: z.object({ id: buildId }), output: any, readOnly: true, workerOp: "(events)", stream: true,
    run: () => Promise.reject(new Error("stream route")),
  },

  // stats
  statRoute("sidebar", "The sidebar stat list as Path of Building shows it: label, value, formatted text.", z.object({}), z.object({ stats: z.array(z.looseObject({ label: z.string(), text: z.string(), stat: z.string().optional(), key: z.string().optional(), actor: z.string().optional(), value: z.number().optional() })), warnings: z.array(z.string()) })),
  statRoute("output", "The full calculated output table; `fields` selects keys.", z.object({ fields: z.array(z.string()).max(500).optional().describe("Output keys, e.g. TotalDPS,Life"), actor: z.enum(["player", "minion"]).optional(), mode: z.enum(["main", "calcs"]).optional().describe("main = sidebar environment, calcs = Calcs tab environment") }), z.object({ mainSkill: z.string().optional(), output: z.record(z.string(), any) }), ["fields", "actor", "mode"]),
  statRoute("skills", "Per-skill outputs for every socket group and the Full DPS total.", z.object({}), any),
  statRoute("breakdown", "How one output value is built (the Calcs tab breakdown).", z.object({ key: z.string().min(1).max(100).describe("Output key, e.g. Life"), actor: z.enum(["player", "minion"]).optional() }), any, ["key", "actor"]),
  statRoute("warnings", "Build warnings (unmet requirements, over-allocated points, and the like).", z.object({}), z.object({ warnings: z.array(z.string()) })),
  statRoute("defences", "Attribute totals and requirements; resistances with total, overcap and maximum.", z.object({}), any),
  statRoute("points", "Passive and ascendancy points used and available, required level.", z.object({}), any),
  statRoute("versions", "Path of Building version, the build's tree version and the latest tree version.", z.object({}), any),

  // tree
  readRoute("tree", "tree", "get", "The allocated tree: class, ascendancy, bloodline, nodes, masteries, tattoos, jewel sockets, tree list.", z.object({})),
  mutateRoute("tree", "tree", "set_class", "Change class. If the tree is not connected to the new start, `onDisconnected` decides: fail (default), reset the tree, or connect it by the shortest path.", z.object({ className: z.string().min(1).max(50).describe("e.g. Shadow"), onDisconnected: z.enum(["fail", "reset", "connect"]).optional() }), ["className", "onDisconnected"]),
  mutateRoute("tree", "tree", "set_ascendancy", "Change ascendancy (of the current class), or None.", z.object({ ascendancy: z.string().min(1).max(50) }), ["ascendancy"]),
  mutateRoute("tree", "tree", "set_bloodline", "Change the secondary ascendancy (bloodline), or None.", z.object({ bloodline: z.string().min(1).max(50) }), ["bloodline"]),
  mutateRoute("tree", "tree", "allocate", "Allocate nodes, each with the shortest path to it, as clicking them does.", z.object({ nodes: nodeList }), ["nodes"]),
  mutateRoute("tree", "tree", "deallocate", "Deallocate nodes and every node that depended on them.", z.object({ nodes: nodeList }), ["nodes"]),
  mutateRoute("tree", "tree", "reset", "Reset the tree (the Reset Tree button).", z.object({})),
  readRoute("tree", "tree", "mastery_options", "The effects a mastery node offers and which is selected.", z.object({ nodeId: nodeRef }), ["nodeId"]),
  mutateRoute("tree", "tree", "set_mastery", "Choose a mastery effect; allocates the mastery if needed.", z.object({ nodeId: nodeRef, effectId: z.number().int().min(0) }), ["nodeId", "effectId"]),
  mutateRoute("tree", "tree", "remove_tattoos", "Remove every tattoo from the tree.", z.object({})),
  readRoute("tree", "tree", "export_url", "The tree as a passive tree link (pathofexile.com).", z.object({})),
  mutateRoute("tree", "tree", "import_url", "Add a tree from a passive tree link as a new tree in the list and make it active.", z.object({ url: z.string().url().max(4000), title: title.optional() }), ["url", "title"]),
  readRoute("tree", "tree", "path", "Shortest path: without `from`, the nodes allocating `to` would add; with it, the fewest-node route between two nodes.", z.object({ to: nodeRef, from: nodeRef.optional() }), ["to", "from"]),
  mutateRoute("tree", "tree", "spec_new", "Add an empty tree to the tree list.", z.object({ title: title.optional() }), ["title"]),
  mutateRoute("tree", "tree", "spec_copy", "Copy a tree in the tree list.", z.object({ index: specIndex, title: title.optional() }), ["index", "title"]),
  mutateRoute("tree", "tree", "spec_rename", "Rename a tree in the tree list.", z.object({ index: specIndex, title }), ["index", "title"]),
  mutateRoute("tree", "tree", "spec_delete", "Delete a tree from the tree list (not the last one).", z.object({ index: specIndex }), ["index"]),
  mutateRoute("tree", "tree", "spec_activate", "Make a tree in the tree list the active one.", z.object({ index: specIndex }), ["index"]),
  mutateRoute("tree", "tree", "convert", "Convert the active tree to another tree version (default the latest); `keepOld` converts a copy.", z.object({ version: treeVersion.optional(), keepOld: z.boolean().optional() }), ["version", "keepOld"]),

  // config
  readRoute("config", "config", "get", "Configuration values that differ from default on the active config set, the config set list, level settings.", z.object({})),
  mutateRoute("config", "config", "set", "Set configuration options (see lookup `config` for names and allowed values); `reset` puts options back to their default.", z.object({ values: z.record(z.string().min(1).max(100), configValue).optional(), reset: z.array(z.string().min(1).max(100)).max(500).optional() }), ["values", "reset"]),
  mutateRoute("config", "config", "set_new", "Add a config set.", z.object({ title: title.optional() }), ["title"]),
  mutateRoute("config", "config", "set_copy", "Copy a config set.", z.object({ index: setIndex, title: title.optional() }), ["index", "title"]),
  mutateRoute("config", "config", "set_rename", "Rename a config set.", z.object({ index: setIndex, title }), ["index", "title"]),
  mutateRoute("config", "config", "set_delete", "Delete a config set (not the last one).", z.object({ index: setIndex }), ["index"]),
  mutateRoute("config", "config", "set_activate", "Make a config set the active one.", z.object({ index: setIndex }), ["index"]),
  readRoute("config", "config", "notes", "The build notes (Notes tab), with colour codes.", z.object({})),
  mutateRoute("config", "config", "set_notes", "Replace the build notes.", z.object({ text: z.string().max(100000) }), ["text"]),

  // lookup
  lookupRoute("gems", "/v1/lookup/gems", "Search gems by name and tag, with requirements at a level.", z.object({ query: z.string().max(100).optional(), tag: z.string().max(50).optional(), support: z.boolean().optional(), level: z.number().int().min(1).max(40).optional(), limit }), ["query", "tag", "support", "level", "limit"]),
  lookupRoute("uniques", "/v1/lookup/uniques", "Search uniques by name or by a line of their text.", z.object({ query: z.string().max(100).optional(), text: z.string().max(200).optional(), limit }), ["query", "text", "limit"]),
  lookupRoute("bases", "/v1/lookup/bases", "Search item bases by name and type.", z.object({ query: z.string().max(100).optional(), type: z.string().max(50).optional(), limit }), ["query", "type", "limit"]),
  lookupRoute("nodes", "/v1/lookup/nodes", "Search passive tree nodes by name or stat text (the tree search box).", z.object({ query: z.string().min(1).max(200), type: z.string().max(30).optional().describe("Normal, Notable, Keystone, Mastery, Socket, ..."), limit }), ["query", "type", "limit"]),
  lookupRoute("node", "/v1/lookup/nodes/:nodeId", "One passive node: stats, links, path length from the current tree, mastery effects.", z.object({ nodeId: z.number().int().min(0) }), (i) => ({ id: i.nodeId })),
  lookupRoute("config", "/v1/lookup/config", "The configuration option catalogue: type, section, allowed values, current value; `var` adds the tooltip.", z.object({ section: z.string().max(100).optional(), query: z.string().max(100).optional(), var: z.string().max(100).optional(), relevantOnly: z.boolean().optional().describe("Only options that apply to this build") }), ["section", "query", "var", "relevantOnly"]),
];

export const action = (r: Route): string => r.name.slice(r.name.indexOf(".") + 1);

/** Validates a route's input; failures are invalid_input naming each bad field. */
export function parseInput(route: Route, raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = route.input.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_input", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
