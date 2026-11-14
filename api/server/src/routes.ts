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
  method: "GET" | "POST" | "PUT" | "DELETE";
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
const offset = z.number().int().min(0).max(100000).optional().describe("Skip this many results (paging with limit)");
const any = z.unknown();
const meta = z.looseObject({ id: z.string(), name: z.string(), revision: z.number(), createdAt: z.string(), updatedAt: z.string(), source: z.looseObject({ kind: z.string() }) });
const summary = z.looseObject({ name: z.string(), className: z.string(), ascendancy: z.string().optional(), level: z.number(), treeVersion: z.string(), mainSkill: z.string().optional() });
const created = z.object({ build: meta, summary });

const account = z.string().trim().min(3).max(100).describe("Account name with its discriminator, e.g. Name#1234");
const realm = z.enum(["pc", "xbox", "sony"]).optional().describe("Default pc");
type Shape = z.core.$ZodShape;
type InputOf<Z extends z.ZodObject<Shape>> = z.output<Z>;
/** Keys of a route's own input, forwarded to the worker op. */
type Args<Z extends z.ZodObject<Shape>> = Array<keyof InputOf<Z> & string>;

const pick = (input: object, keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(input).filter(([k, v]) => keys.includes(k) && v !== undefined));

/**
 * A route whose `run` receives its input schema's inferred type (the one cast, `parseInput` having validated it, lives here).
 * `E` types the fields a helper adds to the schema afterwards (see `extended`).
 */
function route<Z extends z.ZodObject<Shape>, E extends object = object>(def: Omit<Route, "input" | "run"> & { input: Z; run: (svc: Service, input: InputOf<Z> & E) => Promise<Output> }): Route {
  return { ...def, run: (svc, i) => def.run(svc, i as InputOf<Z> & E) };
}

const extended = (r: Route, extra: Shape): Route => ({ ...r, input: r.input.extend(extra) });

/** A read-only worker op on a build's session. */
const statRoute = <Z extends z.ZodObject<Shape>>(action: string, summaryText: string, input: Z, output: z.ZodType, args: Args<Z> = []): Route =>
  extended(route<Z, { id: string }>({
    name: `stats.${action}`,
    domain: "stats",
    method: "GET",
    path: `/v1/stats/:id/${action}`,
    summary: summaryText,
    input,
    output,
    readOnly: true,
    workerOp: `stats.${action}`,
    run: (svc, i) => svc.read(i.id, `stats.${action}`, pick(i, args)),
  }), { id: buildId });

/** A read-only lookup; runs on the named build's session or on the shared lookup session. */
const lookupRoute = <Z extends z.ZodObject<Shape>>(action: string, path: string, summaryText: string, input: Z, output: z.ZodType, args: Args<Z> | ((i: InputOf<Z>) => Record<string, unknown>)): Route =>
  extended(route<Z, { buildId?: string }>({
    name: `lookup.${action}`,
    domain: "lookup",
    method: "GET",
    path,
    summary: summaryText,
    input,
    output,
    readOnly: true,
    workerOp: `lookup.${action}`,
    run: (svc, i) => svc.read(i.buildId, `lookup.${action}`, typeof args === "function" ? args(i) : pick(i, args)),
  }), { buildId: buildId.optional().describe("Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree") });

/** A read-only worker op on a build's session, at GET /v1/<area>/:id/<action>. */
const readRoute = <Z extends z.ZodObject<Shape>>(domain: Domain, area: string, action: string, summaryText: string, input: Z, output: z.ZodType, args: Args<Z> = [], op = `${domain}.${action}`): Route =>
  extended(route<Z, { id: string }>({
    name: `${domain}.${action}`,
    domain,
    method: "GET",
    path: `/v1/${area}/:id/${action.replaceAll("_", "-")}`,
    summary: summaryText,
    input,
    output,
    readOnly: true,
    workerOp: op,
    run: (svc, i) => svc.read(i.id, op, pick(i, args)),
  }), { id: buildId });

const mutationOutput = z.object({
  result: any,
  changed: z.record(z.string(), z.object({ before: z.number().nullable(), after: z.number().nullable() })).describe("Sidebar stats that changed"),
  revision: z.number(),
});

/** A worker mutation at POST /v1/<area>/:id/<action>: stored as a new revision, answered with the stats it changed. */
const mutateRoute = <Z extends z.ZodObject<Shape>>(domain: Domain, area: string, action: string, summaryText: string, input: Z, args: Args<Z> = [], op = `${domain}.${action}`): Route =>
  extended(route<Z, { id: string; baseRevision?: number }>({
    name: `${domain}.${action}`,
    domain,
    method: "POST",
    path: `/v1/${area}/:id/${action.replaceAll("_", "-")}`,
    summary: summaryText,
    input,
    output: mutationOutput,
    readOnly: false,
    workerOp: op,
    run: (svc, i) => svc.mutate(i.id, op, pick(i, args), i.baseRevision),
  }), { id: buildId, baseRevision: revision.optional().describe("Refuse the change unless the build is at this revision") });

// Output schemas of the read routes: top-level keys of what the Lua op returns; nested detail stays loose.
const strings = z.array(z.string());
const nodeBrief = z.looseObject({ id: z.number(), name: z.string(), type: z.string(), ascendancy: z.string().optional(), allocated: z.boolean() });
const nodeDetail = nodeBrief.extend({ stats: strings });
const pageOf = <K extends string, T extends z.ZodType>(key: K, item: T) => z.looseObject({ total: z.number(), offset: z.number(), [key]: z.array(item) });
const specSummary = z.looseObject({ index: z.number(), title: z.string(), treeVersion: z.string(), className: z.string(), ascendancy: z.string().optional(), points: z.number(), ascendancyPoints: z.number(), active: z.boolean() });
const setList = z.array(z.looseObject({ index: z.number(), title: z.string(), active: z.boolean() }));
const skillOutput = z.record(z.string(), z.number());

const groupRef = z.number().int().min(1).max(500).describe("Socket group number in the group list, from 1");
const gemRef = z.number().int().min(1).max(100).describe("Gem position in the group, from 1");
const gemLevel = z.number().int().min(1).max(40).describe("Gem level (1-40)");
const gemQuality = z.number().int().min(0).max(23).describe("Gem quality (0-23)");
const gemCount = z.number().int().min(1).max(99).describe("Gem count");
const groupLabel = z.string().trim().max(50).describe("Group label (up to 50 characters)");
const groupSlot = z.string().min(1).max(50).describe("Item slot name such as Body Armour or Weapon 1, or None");
const skillGem = z.object({ name: z.string().trim().min(1).max(100), level: gemLevel.optional(), quality: gemQuality.optional(), enabled: z.boolean().optional(), count: gemCount.optional() });
const gemOptions = z.object({ defaultGemLevel: z.string(), defaultGemQuality: z.number().optional(), showSupportGemTypes: z.string(), showLegacyGems: z.boolean() });

const nodeRef = z.union([z.number().int().min(0), z.string().trim().min(1).max(200)]).describe("Node id, or its exact name");
const nodeList = z.array(nodeRef).min(1).max(200);
const specIndex = z.number().int().min(1).max(500).describe("Tree number in the tree list, from 1");
const setIndex = z.number().int().min(1).max(500).describe("Config set number in the set list, from 1");
const title = z.string().trim().min(1).max(100);
const treeVersion = z.string().regex(/^\d+_\d+(_[a-z]+)?$/).describe("e.g. 3_30");
const configValue = z.union([z.boolean(), z.number(), z.string().max(20000)]);

export const routes: Route[] = [
  // builds
  route({ name: "build.list", domain: "build", method: "GET", path: "/v1/builds", summary: "List stored builds, most recently changed first.", input: z.object({}), output: z.object({ builds: z.array(meta) }), readOnly: true, workerOp: "(store)", run: (s) => s.list() }),
  route({
    name: "build.new", domain: "build", method: "POST", path: "/v1/builds", summary: "Create an empty build. Tree version defaults to the latest.",
    input: z.object({ name: name.optional(), className: z.string().optional().describe("e.g. Witch"), ascendancy: z.string().optional().describe("e.g. Elementalist"), level: z.number().int().min(1).max(100).optional(), treeVersion: z.string().regex(/^\d+_\d+(_[a-z]+)?$/).optional().describe("e.g. 3_30") }),
    output: created, readOnly: false, workerOp: "builds.new, builds.export",
    run: (s, i) => s.newBuild(i),
  }),
  route({ name: "build.import_xml", domain: "build", method: "POST", path: "/v1/builds/import/xml", summary: "Load a build from Path of Building XML.", input: z.object({ xml: z.string().min(1), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.importXml({ xml: i.xml, name: i.name }) }),
  route({ name: "build.import_code", domain: "build", method: "POST", path: "/v1/builds/import/code", summary: "Load a build from a build code (the text Path of Building shares).", input: z.object({ code: z.string().min(1), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.importCode({ code: i.code, name: i.name }) }),
  route({
    name: "build.import_link", domain: "build", method: "POST", path: "/v1/builds/import/link", summary: "Load a build from a share link on a supported site (pobb.in, pastebin, Maxroll, poe.ninja, pob.codes, rentry, poedb).",
    input: z.object({ url: z.string().url().max(2000), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.resolve_link, builds.load, builds.export",
    run: (s, i) => s.importLink({ url: i.url, name: i.name }),
  }),
  route({
    name: "build.characters", domain: "build", method: "GET", path: "/v1/builds/import/characters", summary: "Characters on a public Path of Exile profile (name, league, class, level). The profile's Characters tab must be public.",
    input: z.object({ account, realm }), output: z.object({ characters: z.array(z.object({ name: z.string(), league: z.string(), class: z.string(), level: z.number().optional() })) }),
    readOnly: true, workerOp: "(game site)", run: (s, i) => s.characters({ account: i.account, realm: i.realm }),
  }),
  route({
    name: "build.import_character", domain: "build", method: "POST", path: "/v1/builds/import/character", summary: "A new build from a character on a public profile: passive tree, jewels, items and skills, as the Import tab imports them.",
    input: z.object({ account, realm, character: z.string().trim().min(1).max(100).describe("Character name"), name: name.optional() }), output: created, readOnly: false,
    workerOp: "builds.import_character, builds.export",
    run: (s, i) => s.importCharacter({ account: i.account, realm: i.realm, character: i.character, name: i.name }),
  }),
  route({ name: "build.trash", domain: "build", method: "GET", path: "/v1/builds/trash", summary: "Deleted builds that can still be restored (kept 7 days after deletion).", input: z.object({}), output: z.object({ builds: z.array(meta.extend({ deletedAt: z.string(), purgeAfter: z.string() })) }), readOnly: true, workerOp: "(store)", run: (s) => s.trash() }),
  route({ name: "build.get", domain: "build", method: "GET", path: "/v1/builds/:id", summary: "A build's metadata and summary (class, ascendancy, level, tree version, main skill).", input: z.object({ id: buildId }), output: created, readOnly: true, workerOp: "builds.summary", run: (s, i) => s.get(i.id) }),
  route({ name: "build.rename", domain: "build", method: "POST", path: "/v1/builds/:id/rename", summary: "Rename a build (a new revision).", input: z.object({ id: buildId, name, baseRevision: revision.optional() }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.rename(i.id, { name: i.name, baseRevision: i.baseRevision }) }),
  route({ name: "build.duplicate", domain: "build", method: "POST", path: "/v1/builds/:id/duplicate", summary: "Copy a build into a new build.", input: z.object({ id: buildId, name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.duplicate(i.id, { name: i.name }) }),
  route({ name: "build.delete", domain: "build", method: "DELETE", path: "/v1/builds/:id", summary: "Delete a build. It stays restorable for 7 days (`restore`), then it and its history are removed.", input: z.object({ id: buildId, baseRevision: revision.optional() }), output: z.object({ deleted: z.string(), restorableDays: z.number() }), readOnly: false, workerOp: "(store)", run: (s, i) => s.delete(i.id, { baseRevision: i.baseRevision }) }),
  route({ name: "build.restore", domain: "build", method: "POST", path: "/v1/builds/:id/restore", summary: "Restore a deleted build with its history.", input: z.object({ id: buildId }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.restore(i.id) }),
  route({ name: "build.revert", domain: "build", method: "POST", path: "/v1/builds/:id/revert", summary: "Make a kept revision current again (as a new revision).", input: z.object({ id: buildId, revision, baseRevision: revision.optional() }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.revert(i.id, { revision: i.revision, baseRevision: i.baseRevision }) }),
  mutateRoute("build", "builds", "settings", "Character level and the Auto/Manual level mode (auto follows points spent).", z.object({ level: z.number().int().min(1).max(100).optional(), autoLevel: z.boolean().optional() }), ["level", "autoLevel"], "config.set_level"),
  route({ name: "build.export_xml", domain: "build", method: "GET", path: "/v1/builds/:id/xml", summary: "A build's XML at the current or a kept revision.", input: z.object({ id: buildId, revision: revision.optional() }), output: z.object({ id: z.string(), revision: z.number(), xml: z.string() }), readOnly: true, workerOp: "(store)", run: (s, i) => s.exportXml(i.id, { revision: i.revision }) }),
  route({
    name: "build.replace_code", domain: "build", method: "PUT", path: "/v1/builds/:id/code", summary: "Replace a build's content with a build code (the same decode as import/code); id and name stay, the revision moves on. The browser view saves through this.",
    input: z.object({ id: buildId, code: z.string().min(1), baseRevision: revision.describe("Refuse the change unless the build is at this revision") }),
    output: z.object({ build: meta, changed: mutationOutput.shape.changed }), readOnly: false, workerOp: "builds.replace",
    run: (s, i) => s.replaceCode(i.id, { code: i.code, baseRevision: i.baseRevision }),
  }),
  route({ name: "build.export_code", domain: "build", method: "GET", path: "/v1/builds/:id/code", summary: "A build code for the current revision, importable by Path of Building.", input: z.object({ id: buildId }), output: z.object({ id: z.string(), revision: z.number(), code: z.string() }), readOnly: true, workerOp: "builds.export", run: (s, i) => s.exportCode(i.id) }),
  route({ name: "build.save_point", domain: "build", method: "POST", path: "/v1/builds/:id/save-points", summary: "Mark the current revision as a save point (kept past history pruning).", input: z.object({ id: buildId, label: z.string().trim().min(1).max(200).optional() }), output: z.object({ id: z.string(), revision: z.number(), label: z.string().optional() }), readOnly: false, workerOp: "(store)", run: (s, i) => s.savePoint(i.id, { label: i.label }) }),
  route({ name: "build.history", domain: "build", method: "GET", path: "/v1/builds/:id/history", summary: "Revisions kept for a build, newest first (last 50 plus save points).", input: z.object({ id: buildId }), output: z.object({ id: z.string(), revision: z.number(), history: z.array(z.looseObject({ revision: z.number(), at: z.string(), cause: z.string() })) }), readOnly: true, workerOp: "(store)", run: (s, i) => s.history(i.id) }),
  route({
    name: "build.events", domain: "build", method: "GET", path: "/v1/builds/:id/events", summary: "Server-sent events: `hello` with the current revision, then `change` (revision, cause, changed stats) and `deleted`.",
    input: z.object({ id: buildId }), output: any, readOnly: true, workerOp: "(events)", stream: true,
    run: () => Promise.reject(new Error("stream route")),
  }),

  // stats
  statRoute("sidebar", "The sidebar stat list as Path of Building shows it: label, value, formatted text.", z.object({}), z.object({ stats: z.array(z.looseObject({ label: z.string(), text: z.string(), stat: z.string().optional(), key: z.string().optional(), actor: z.string().optional(), value: z.number().optional() })), warnings: z.array(z.string()) })),
  statRoute("output", "The full calculated output table; `fields` selects keys.", z.object({ fields: z.array(z.string()).max(500).optional().describe("Output keys, e.g. TotalDPS,Life"), actor: z.enum(["player", "minion"]).optional(), mode: z.enum(["main", "calcs"]).optional().describe("main = sidebar environment, calcs = Calcs tab environment") }), z.object({ mainSkill: z.string().optional(), output: z.record(z.string(), any) }), ["fields", "actor", "mode"]),
  statRoute("skills", "Per-skill outputs for every socket group and the Full DPS total.", z.object({}), z.looseObject({ mainSocketGroup: z.number().optional(), groups: z.array(z.looseObject({ index: z.number(), label: z.string().optional(), slot: z.string().optional(), enabled: z.boolean(), includeInFullDPS: z.boolean(), mainActiveSkill: z.number().optional(), activeSkills: strings, gems: z.array(z.looseObject({ name: z.string().optional(), level: z.number().optional(), quality: z.number().optional(), enabled: z.boolean(), count: z.number().optional() })), mainSkill: z.string().optional(), output: skillOutput.optional() })), fullDPS: z.looseObject({ FullDPS: z.number().optional(), FullDotDPS: z.number().optional(), skills: z.array(z.looseObject({ name: z.string().optional(), dps: z.number().optional(), count: z.number().optional() })) }) })),
  statRoute("breakdown", "How one output value is built (the Calcs tab breakdown).", z.object({ key: z.string().min(1).max(100).describe("Output key, e.g. Life"), actor: z.enum(["player", "minion"]).optional() }), z.looseObject({ key: z.string(), value: z.unknown().optional(), breakdown: z.unknown() }), ["key", "actor"]),
  statRoute("warnings", "Build warnings (unmet requirements, over-allocated points, and the like).", z.object({}), z.object({ warnings: z.array(z.string()) })),
  statRoute("defences", "Attribute totals and requirements; resistances with total, overcap and maximum.", z.object({}), z.looseObject({ attributes: z.record(z.string(), z.number()), resistances: z.record(z.string(), z.record(z.string(), z.number())) })),
  statRoute("points", "Passive and ascendancy points used and available, required level.", z.object({}), z.looseObject({ used: z.number().optional(), max: z.number().optional(), ascendancyUsed: z.number().optional(), ascendancyMax: z.number().optional(), secondaryAscendancyUsed: z.number().optional(), jewelSockets: z.number().optional(), requiredLevel: z.number().optional(), act: z.string().optional() })),
  statRoute("versions", "Path of Building version, the build's tree version and the latest tree version.", z.object({}), z.looseObject({ pobVersion: z.string().optional(), latestTreeVersion: z.string().optional(), treeVersion: z.string(), treeVersionDisplay: z.string().optional(), targetVersion: z.string().optional() })),

  // tree
  readRoute("tree", "tree", "get", "The allocated tree: class, ascendancy, bloodline, nodes, masteries, tattoos, jewel sockets, tree list.", z.object({}), z.looseObject({ treeVersion: z.string(), className: z.string(), ascendancy: z.string().optional(), bloodline: z.string().optional(), points: z.number(), ascendancyPoints: z.number(), bloodlinePoints: z.number().optional(), nodes: z.array(nodeBrief), masteries: z.array(z.looseObject({ nodeId: z.number(), effectId: z.number(), stats: strings })), tattoos: z.array(z.looseObject({ nodeId: z.number(), name: z.string(), stats: strings })), jewelSockets: z.array(z.looseObject({ nodeId: z.number(), itemId: z.number() })), specs: z.array(specSummary) })),
  mutateRoute("tree", "tree", "set_class", "Change class. If the tree is not connected to the new start, `onDisconnected` decides: fail (default), reset the tree, or connect it by the shortest path.", z.object({ className: z.string().min(1).max(50).describe("e.g. Shadow"), onDisconnected: z.enum(["fail", "reset", "connect"]).optional() }), ["className", "onDisconnected"]),
  mutateRoute("tree", "tree", "set_ascendancy", "Change ascendancy (of the current class), or None.", z.object({ ascendancy: z.string().min(1).max(50) }), ["ascendancy"]),
  mutateRoute("tree", "tree", "set_bloodline", "Change the secondary ascendancy (bloodline), or None.", z.object({ bloodline: z.string().min(1).max(50) }), ["bloodline"]),
  mutateRoute("tree", "tree", "allocate", "Allocate nodes, each with the shortest path to it, as clicking them does.", z.object({ nodes: nodeList }), ["nodes"]),
  mutateRoute("tree", "tree", "deallocate", "Deallocate nodes and every node that depended on them.", z.object({ nodes: nodeList }), ["nodes"]),
  mutateRoute("tree", "tree", "reset", "Reset the tree (the Reset Tree button).", z.object({})),
  readRoute("tree", "tree", "mastery_options", "The effects a mastery node offers and which is selected.", z.object({ nodeId: nodeRef }), z.looseObject({ nodeId: z.number(), name: z.string(), allocated: z.boolean(), effects: z.array(z.looseObject({ effectId: z.number(), stats: strings, selected: z.boolean() })) }), ["nodeId"]),
  mutateRoute("tree", "tree", "set_mastery", "Choose a mastery effect; allocates the mastery if needed.", z.object({ nodeId: nodeRef, effectId: z.number().int().min(0) }), ["nodeId", "effectId"]),
  mutateRoute("tree", "tree", "remove_tattoos", "Remove every tattoo from the tree.", z.object({})),
  readRoute("tree", "tree", "export_url", "The tree as a passive tree link (pathofexile.com).", z.object({}), z.looseObject({ url: z.string() })),
  mutateRoute("tree", "tree", "import_url", "Add a tree from a passive tree link as a new tree in the list and make it active.", z.object({ url: z.string().url().max(4000), title: title.optional() }), ["url", "title"]),
  readRoute("tree", "tree", "path", "Shortest path: without `from`, the nodes allocating `to` would add; with it, the fewest-node route between two nodes.", z.object({ to: nodeRef, from: nodeRef.optional() }), z.looseObject({ length: z.number(), nodes: z.array(nodeBrief) }), ["to", "from"]),
  mutateRoute("tree", "tree", "spec_new", "Add an empty tree to the tree list.", z.object({ title: title.optional() }), ["title"]),
  mutateRoute("tree", "tree", "spec_copy", "Copy a tree in the tree list.", z.object({ index: specIndex, title: title.optional() }), ["index", "title"]),
  mutateRoute("tree", "tree", "spec_rename", "Rename a tree in the tree list.", z.object({ index: specIndex, title }), ["index", "title"]),
  mutateRoute("tree", "tree", "spec_delete", "Delete a tree from the tree list (not the last one).", z.object({ index: specIndex }), ["index"]),
  mutateRoute("tree", "tree", "spec_activate", "Make a tree in the tree list the active one.", z.object({ index: specIndex }), ["index"]),
  mutateRoute("tree", "tree", "convert", "Convert the active tree to another tree version (default the latest); `keepOld` converts a copy.", z.object({ version: treeVersion.optional(), keepOld: z.boolean().optional() }), ["version", "keepOld"]),

  // skills
  readRoute("skills", "skills", "get", "The Skills tab: socket groups with their gems and active skills, the main socket group, skill sets and gem options.", z.object({}), z.looseObject({ mainSocketGroup: z.number(), groups: z.array(z.looseObject({ index: z.number(), label: z.string(), slot: z.string().optional(), enabled: z.boolean(), includeInFullDPS: z.boolean(), gems: z.array(z.looseObject({ index: z.number(), name: z.string(), level: z.number(), quality: z.number(), enabled: z.boolean(), count: z.number(), support: z.boolean(), error: z.string().optional() })), activeSkills: strings, mainActiveSkill: z.number().optional(), main: z.boolean() })), sets: setList, options: gemOptions })),
  readRoute("skills", "skills", "group_text", "A socket group as Path of Building copies it (paste it back with `add_group`).", z.object({ group: groupRef }), z.looseObject({ text: z.string() }), ["group"]),
  mutateRoute("skills", "skills", "add_group", "Add a socket group from gems or from copy text (the Paste button). Gem names resolve as the gem box does; unknown names fail.", z.object({ text: z.string().min(1).max(20000).optional().describe("Copy format: optional `Label:` and `Slot:` lines, then `<gem> <level>/<quality> [DISABLED] <count>` per line"), gems: z.array(skillGem).min(1).max(12).optional().describe("Gems of the group, in order; level defaults to 20"), label: groupLabel.optional(), slot: groupSlot.optional() }), ["text", "gems", "label", "slot"]),
  mutateRoute("skills", "skills", "update_group", "Change a socket group's label, item slot, enabled and Full DPS flags (and the count of an item-granted group).", z.object({ group: groupRef, label: groupLabel.optional(), slot: groupSlot.optional(), enabled: z.boolean().optional(), includeInFullDPS: z.boolean().optional(), count: gemCount.optional() }), ["group", "label", "slot", "enabled", "includeInFullDPS", "count"]),
  mutateRoute("skills", "skills", "delete_group", "Delete a socket group.", z.object({ group: groupRef }), ["group"]),
  mutateRoute("skills", "skills", "move_group", "Move a socket group to another position in the list; the main skill stays the same group.", z.object({ group: groupRef, to: groupRef.describe("New position, from 1") }), ["group", "to"]),
  mutateRoute("skills", "skills", "set_main", "Make a socket group the main one, and optionally pick which of its active skills is the main skill.", z.object({ group: groupRef, skill: z.number().int().min(1).max(50).optional().describe("Active skill number in the group's `activeSkills`, from 1") }), ["group", "skill"]),
  mutateRoute("skills", "skills", "set_gem", "Change a gem of a group (name, level, quality, enabled, count); a position one past the last gem adds one (name required).", z.object({ group: groupRef, gem: gemRef, name: z.string().trim().min(1).max(100).optional().describe("Gem name; the ` Support` suffix is optional"), level: gemLevel.optional(), quality: gemQuality.optional(), enabled: z.boolean().optional(), count: gemCount.optional() }), ["group", "gem", "name", "level", "quality", "enabled", "count"]),
  mutateRoute("skills", "skills", "delete_gem", "Remove a gem from a group.", z.object({ group: groupRef, gem: gemRef }), ["group", "gem"]),
  mutateRoute("skills", "skills", "set_imbued", "Set a group's Imbued Support (needs the group socketed in an item slot), or None to clear it.", z.object({ group: groupRef, name: z.string().trim().min(1).max(100).describe("A support gem name, or None") }), ["group", "name"]),
  mutateRoute("skills", "skills", "optimise_sockets", "Reorder a socketed group's gems to match the item's socket colours (the Optimise Sockets button).", z.object({ group: groupRef }), ["group"]),
  mutateRoute("skills", "skills", "set_options", "Skills tab gem options: default gem level and quality, which support gems the gem box shows, legacy gems.", z.object({ defaultGemLevel: z.enum(["normalMaximum", "corruptedMaximum", "awakenedMaximum", "characterLevel", "levelOne"]).optional(), defaultGemQuality: gemQuality.optional(), showSupportGemTypes: z.enum(["ALL", "NORMAL", "EXCEPTIONAL"]).optional().describe("NORMAL = non-exceptional"), showLegacyGems: z.boolean().optional() }), ["defaultGemLevel", "defaultGemQuality", "showSupportGemTypes", "showLegacyGems"]),
  mutateRoute("skills", "skills", "set_new", "Add a skill set.", z.object({ title: title.optional() }), ["title"]),
  mutateRoute("skills", "skills", "set_copy", "Copy a skill set.", z.object({ index: setIndex.describe("Skill set number in the set list, from 1"), title: title.optional() }), ["index", "title"]),
  mutateRoute("skills", "skills", "set_rename", "Rename a skill set.", z.object({ index: setIndex.describe("Skill set number in the set list, from 1"), title }), ["index", "title"]),
  mutateRoute("skills", "skills", "set_delete", "Delete a skill set (not the last one).", z.object({ index: setIndex.describe("Skill set number in the set list, from 1") }), ["index"]),
  mutateRoute("skills", "skills", "set_activate", "Make a skill set the active one.", z.object({ index: setIndex.describe("Skill set number in the set list, from 1") }), ["index"]),

  // config
  readRoute("config", "config", "get", "Configuration values that differ from default on the active config set, the config set list, level settings.", z.object({}), z.looseObject({ values: z.record(z.string(), z.unknown()), sets: setList, level: z.number().optional(), autoLevel: z.boolean() })),
  mutateRoute("config", "config", "set", "Set configuration options (see lookup `config` for names and allowed values); `reset` puts options back to their default.", z.object({ values: z.record(z.string().min(1).max(100), configValue).optional(), reset: z.array(z.string().min(1).max(100)).max(500).optional() }), ["values", "reset"]),
  mutateRoute("config", "config", "set_new", "Add a config set.", z.object({ title: title.optional() }), ["title"]),
  mutateRoute("config", "config", "set_copy", "Copy a config set.", z.object({ index: setIndex, title: title.optional() }), ["index", "title"]),
  mutateRoute("config", "config", "set_rename", "Rename a config set.", z.object({ index: setIndex, title }), ["index", "title"]),
  mutateRoute("config", "config", "set_delete", "Delete a config set (not the last one).", z.object({ index: setIndex }), ["index"]),
  mutateRoute("config", "config", "set_activate", "Make a config set the active one.", z.object({ index: setIndex }), ["index"]),
  readRoute("config", "config", "notes", "The build notes (Notes tab), with colour codes.", z.object({}), z.looseObject({ text: z.string() })),
  mutateRoute("config", "config", "set_notes", "Replace the build notes.", z.object({ text: z.string().max(100000) }), ["text"]),

  // lookup
  lookupRoute("gems", "/v1/lookup/gems", "Search gems by name and tag, with requirements at a level.", z.object({ query: z.string().max(100).optional(), tag: z.string().max(50).optional(), support: z.boolean().optional(), level: z.number().int().min(1).max(40).optional(), limit, offset }), pageOf("gems", z.looseObject({ id: z.string(), name: z.string(), support: z.boolean(), tags: strings, tagString: z.string().optional(), naturalMaxLevel: z.number().optional(), description: z.string().optional(), requirements: z.looseObject({ gemLevel: z.number(), level: z.number(), str: z.number(), dex: z.number(), int: z.number() }).optional() })), ["query", "tag", "support", "level", "limit", "offset"]),
  lookupRoute("uniques", "/v1/lookup/uniques", "Search uniques by name or by a line of their text.", z.object({ query: z.string().max(100).optional(), text: z.string().max(200).optional(), limit, offset }), pageOf("uniques", z.looseObject({ name: z.string(), title: z.string().optional(), base: z.string().optional(), type: z.string().optional(), variants: z.number().optional(), text: z.string() })), ["query", "text", "limit", "offset"]),
  lookupRoute("bases", "/v1/lookup/bases", "Search item bases by name and type.", z.object({ query: z.string().max(100).optional(), type: z.string().max(50).optional(), limit, offset }), pageOf("bases", z.looseObject({ name: z.string() })), ["query", "type", "limit", "offset"]),
  lookupRoute("nodes", "/v1/lookup/nodes", "Search passive tree nodes by name or stat text (the tree search box).", z.object({ query: z.string().min(1).max(200), type: z.string().max(30).optional().describe("Normal, Notable, Keystone, Mastery, Socket, ..."), limit, offset }), z.looseObject({ total: z.number(), offset: z.number(), treeVersion: z.string(), nodes: z.array(nodeDetail) }), ["query", "type", "limit", "offset"]),
  lookupRoute("node", "/v1/lookup/nodes/:nodeId", "One passive node: stats, links, path length from the current tree, mastery effects.", z.object({ nodeId: z.number().int().min(0) }), nodeDetail.extend({ linked: z.array(z.number()), pathLength: z.number().optional(), reminderText: z.unknown().optional(), flavourText: z.unknown().optional(), masteryEffects: z.array(z.looseObject({ effect: z.number(), stats: strings })).optional(), selectedMasteryEffect: z.number().optional() }), (i) => ({ id: i.nodeId })),
  lookupRoute("config", "/v1/lookup/config", "The configuration option catalogue: type, section, allowed values, current value; `var` adds the tooltip.", z.object({ section: z.string().max(100).optional(), query: z.string().max(100).optional(), var: z.string().max(100).optional(), relevantOnly: z.boolean().optional().describe("Only options that apply to this build"), offset, limit }), pageOf("options", z.looseObject({ var: z.string(), type: z.string().optional(), label: z.string(), section: z.string().optional(), current: z.unknown().optional(), placeholder: z.unknown().optional(), relevant: z.boolean().optional(), allowed: z.array(z.looseObject({ value: z.unknown(), label: z.string() })).optional(), default: z.unknown().optional(), tooltip: z.string().optional() })), ["section", "query", "var", "relevantOnly", "offset", "limit"]),
];

export const action = (r: Route): string => r.name.slice(r.name.indexOf(".") + 1);

/** Validates a route's input; failures are invalid_input naming each bad field. */
export function parseInput(route: Route, raw: Record<string, unknown>): Record<string, unknown> {
  const allowed = Object.keys(route.input.shape);
  const unknown = Object.keys(raw).filter((k) => raw[k] !== undefined && !allowed.includes(k));
  if (unknown.length > 0) {
    throw new ApiError("invalid_input", `unknown parameter${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}; ${route.name} takes ${allowed.join(", ") || "no parameters"}`);
  }
  const parsed = route.input.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_input", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
