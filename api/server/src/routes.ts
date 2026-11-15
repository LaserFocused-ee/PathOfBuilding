// The single route table. HTTP routes, the MCP tools and docs/API.md are all generated from it.
import { z } from "zod";
import { ApiError } from "./errors.js";
import type { Output, Service } from "./service.js";
import { LEAGUE_NAME, listingEntry } from "./trade.js";

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

/** The same route at another path (the helpers derive the path from the action name; a few areas want a shorter one). */
const at = (r: Route, path: string): Route => ({ ...r, path });

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

/** A read-only worker op on a build's session that takes lists or item text: POST /v1/evaluate/:id/<action>. Nothing is stored. */
const evalRoute = <Z extends z.ZodObject<Shape>>(action: string, summaryText: string, input: Z, output: z.ZodType, args: Args<Z> = []): Route =>
  extended(route<Z, { id: string }>({
    name: `evaluate.${action}`,
    domain: "evaluate",
    method: "POST",
    path: `/v1/evaluate/:id/${action.replaceAll("_", "-")}`,
    summary: summaryText,
    input,
    output,
    readOnly: true,
    workerOp: `evaluate.${action}`,
    run: (svc, i) => svc.read(i.id, `evaluate.${action}`, pick(i, args)),
  }), { id: buildId });

const mutationBase = z.object({
  changed: z.record(z.string(), z.object({ before: z.number().nullable(), after: z.number().nullable() })).describe("Sidebar stats that changed"),
  revision: z.number(),
});

/** A worker mutation at POST /v1/<area>/:id/<action>: stored as a new revision, answered with the op's `result` (shapes below) and the stats it changed. */
const mutateRoute = <Z extends z.ZodObject<Shape>>(domain: Domain, area: string, action: string, summaryText: string, input: Z, result: z.ZodType, args: Args<Z> = [], op = `${domain}.${action}`): Route =>
  extended(route<Z, { id: string; baseRevision?: number }>({
    name: `${domain}.${action}`,
    domain,
    method: "POST",
    path: `/v1/${area}/:id/${action.replaceAll("_", "-")}`,
    summary: summaryText,
    input,
    output: z.object({ result, ...mutationBase.shape }),
    readOnly: false,
    workerOp: op,
    run: (svc, i) => svc.mutate(i.id, op, pick(i, args), i.baseRevision),
  }), { id: buildId, baseRevision: revision.optional().describe("Refuse the change unless the build is at this revision") });

/** The route's op runs with another stored build (`other`) loaded as the Compare tab's compared build (Service.withCompared). */
const otherSet = z.number().int().min(1).max(500).optional();
const withOther = (r: Route, keys: string[]): Route => ({
  ...r,
  input: r.input.extend({
    other: buildId.describe("The other build, loaded as the Compare tab's compared build"),
    otherSets: z.object({ tree: otherSet, skills: otherSet, items: otherSet, config: otherSet }).optional().describe("The other build's tree, skill, item and config sets to compare (1-based, in list order), as the Compare tab's set dropdowns pick them; default the active ones"),
  }),
  workerOp: `${r.workerOp}, with the other build in the Compare tab`,
  run: (svc, i) => svc.withCompared(String(i.id), String(i.other), r.workerOp, pick(i, [...keys, "otherSets"]), !r.readOnly, typeof i.baseRevision === "number" ? i.baseRevision : undefined),
});

/** compare_item takes a trade listing too: converted here to the fetch entry the worker reads (one conversion, shared with trade.search); the worker checks that exactly one of item, text and listing is given. */
const compareItem = (r: Route): Route => ({
  ...r,
  workerOp: "evaluate.compare_item (a listing is read by the trade conversion first)",
  run: (svc, i) => svc.read(String(i.id), "evaluate.compare_item", { ...pick(i, ["item", "text", "slot", "weights", "fields"]), ...(i.listing === undefined ? {} : { entry: listingEntry(i.listing) }) }),
});

/** `withOther` for a route that also works on this build alone: without `other` the route runs as it was, and `otherSets` is refused. */
const orOther = (r: Route, keys: string[]): Route => {
  const w = withOther(r, keys);
  return {
    ...w,
    input: w.input.extend({ other: buildId.optional().describe("Another build: the item is that build's, loaded as the Compare tab's compared build") }),
    run: (svc, i) => {
      if (i.other !== undefined) return w.run(svc, i);
      if (i.otherSets !== undefined) throw new ApiError("invalid_input", "otherSets needs other");
      return r.run(svc, i);
    },
  };
};

/**
 * A route that builds a trade link from a `league`: the league is resolved once, here (Service.tradeLeague) before the route runs,
 * so every such route defaults to the configured league and refuses another. `required`: the route answers nothing without one.
 */
const tradeLinked = (r: Route, required: boolean): Route => ({ ...r, run: (svc, i) => r.run(svc, svc.withTradeLeague(i, required)) });

// Output schemas of the read routes: top-level keys of what the Lua op returns; nested detail stays loose.
const strings = z.array(z.string());
const nodeBrief = z.looseObject({ id: z.number(), name: z.string(), type: z.string(), ascendancy: z.string().optional(), allocated: z.boolean() });
const nodeDetail = nodeBrief.extend({ stats: strings });
const pageOf = <K extends string, T extends z.ZodType>(key: K, item: T) => z.looseObject({ total: z.number(), offset: z.number(), [key]: z.array(item) });
const specSummary = z.looseObject({ index: z.number(), title: z.string(), treeVersion: z.string(), className: z.string(), ascendancy: z.string().optional(), points: z.number(), ascendancyPoints: z.number(), active: z.boolean() });
const setList = z.array(z.looseObject({ index: z.number(), title: z.string(), active: z.boolean() }));
const loadoutSets = z.looseObject({ tree: z.string(), items: z.string(), skills: z.string(), config: z.string() });
const spectreList = z.array(z.looseObject({ id: z.string(), name: z.string() }));
const skillOutput = z.record(z.string(), z.number());

const groupRef = z.number().int().min(1).max(500).describe("Socket group number in the group list, from 1");
const gemRef = z.number().int().min(1).max(100).describe("Gem position in the group, from 1");
const gemLevel = z.number().int().min(1).max(40).describe("Gem level (1-40)");
const gemQuality = z.number().int().min(0).max(23).describe("Gem quality (0-23)");
const gemCount = z.number().int().min(1).max(99).describe("Gem count");
const groupLabel = z.string().trim().max(50).describe("Group label (up to 50 characters)");
const groupSlot = z.string().min(1).max(50).describe("Item slot name such as Body Armour or Weapon 1, or None");
const skillGem = z.object({ name: z.string().trim().min(1).max(100), level: gemLevel.optional(), quality: gemQuality.optional(), enabled: z.boolean().optional(), count: gemCount.optional() });
/** The sidebar choices the main skill shows (a choice the skill lacks is absent); dropdowns come with their labels. */
const mainOptions = z.looseObject({ part: z.number().optional(), parts: strings.optional(), stages: z.number().optional(), mines: z.number().optional(), minion: z.number().optional(), minions: strings.optional(), minionSkill: z.number().optional(), minionSkills: strings.optional() });
const choiceOf = z.union([z.number().int().min(1).max(500), z.string().trim().min(1).max(200)]);
const gemOptions = z.object({ defaultGemLevel: z.string(), defaultGemQuality: z.number().optional(), showSupportGemTypes: z.string(), showLegacyGems: z.boolean() });

const itemRef = z.number().int().min(1).max(1000000).describe("Item id from `items list`");
const itemSlot = z.string().trim().min(1).max(60).describe("Item slot as Path of Building names it: Weapon 1, Weapon 2, Weapon 1 Swap, Weapon 2 Swap, Helmet, Body Armour, Gloves, Boots, Amulet, Ring 1, Ring 2, Belt, Flask 1 to Flask 5, or Jewel <node id> for a passive tree socket");
const itemEquip = z.string().trim().min(1).max(60).optional().describe("Where a new item goes: `auto` (default; its own slot, if empty), `none`, or a slot name");
const itemName = z.string().trim().min(1).max(200);
const itemBrief = z.looseObject({ id: z.number(), name: z.string(), baseName: z.string(), rarity: z.string(), type: z.string().optional(), title: z.string().optional(), quality: z.number().optional(), sockets: z.string().optional(), equipped: strings, corrupted: z.boolean(), warnings: strings.optional().describe("What the game would not allow on this item (more prefixes or suffixes than it can have; eldritch implicits with Shaper, Elder or conqueror influence), which Path of Building reads without a word") });
const itemDetail = itemBrief.extend({ raw: z.string(), enchants: strings, implicits: strings, explicits: strings, anoints: strings, variant: z.number().optional(), altVariant: z.number().optional(), variants: strings.optional(), ranges: z.array(z.looseObject({ index: z.number(), line: z.string(), range: z.number() })), validSlots: strings });

const nodeRef = z.union([z.number().int().min(0), z.string().trim().min(1).max(200)]).describe("Node id, or its exact name");
const nodeList = z.array(nodeRef).min(1).max(200);
const specIndex = z.number().int().min(1).max(500).describe("Tree number in the tree list, from 1");
const setIndex = z.number().int().min(1).max(500).describe("Config set number in the set list, from 1");
const title = z.string().trim().min(1).max(100);
const treeVersion = z.string().regex(/^\d+_\d+(_[a-z]+)?$/).describe("e.g. 3_30");
const partyDestination = z.enum(["All", "Party Member Stats", "Aura", "Curse", "Warcry Skills", "Link Skills", "EnemyConditions", "EnemyMods"]).describe("Which party inputs it applies to");
const partyText = z.string().max(200000);
const partyState = z.looseObject({ destination: z.string(), append: z.boolean(), showAdvanced: z.boolean(), exportSupport: z.boolean(), auras: z.string(), curses: z.string(), warcries: z.string(), links: z.string(), partyMemberStats: z.string(), enemyConditions: z.string(), enemyMods: z.string(), summary: z.record(z.string(), z.string()) });
const uiTab = z.enum(["build", "tree", "skills", "items", "calcs", "config", "notes", "party", "import"]).describe("build = the build's own top bar and sidebar controls");
const configValue = z.union([z.boolean(), z.number(), z.string().max(20000)], { error: "a value is true/false, a number or text; to put an option back to its default, name it in reset" });

// Result shapes of the write routes (the `result` of a mutation answer): the fields the Lua op always returns; `.optional()` marks the ones it sometimes leaves out.
/** An op that returns nothing: tree deallocate, reset, spec_rename; config set_notes; the party writes. */
const nothing = z.looseObject({});
/** The set list after the change: skills, items and config `set_new`, `set_copy`, `set_rename`, `set_delete`, `set_activate`. */
const setsResult = z.looseObject({ sets: setList });
const levelResult = z.looseObject({ level: z.number(), autoLevel: z.boolean() }); // build settings
const loadoutActivated = z.looseObject({ active: z.string(), sets: loadoutSets }); // build loadout_activate
const loadoutCreated = z.looseObject({ name: z.string(), sets: loadoutSets, dropped: strings }); // build loadout_new
const uiResult = z.looseObject({ tab: z.string(), control: z.string(), operation: z.string(), text: z.string().optional(), state: z.boolean().optional(), selected: z.number().optional() }); // build ui_invoke
const classResult = z.looseObject({ className: z.string() }); // tree set_class
const onDisconnected = z.enum(["fail", "reset", "connect"]).optional().describe("When the tree is not connected to the other class's start: fail, reset the tree, or connect it by the shortest path");
const ascendancyResult = z.looseObject({ ascendancy: z.string() }); // tree set_ascendancy
const bloodlineResult = z.looseObject({ bloodline: z.string() }); // tree set_bloodline
const nodeIdName = z.array(z.looseObject({ id: z.number(), name: z.string().optional() }));
const allocatedResult = z.looseObject({ allocated: z.array(z.number()), added: nodeIdName.describe("Every node newly allocated, the paths included, by id"), className: z.string().optional(), ascendancy: z.string().optional(), bloodline: z.string().optional() }); // tree allocate: the ids asked for, in order, and the class, ascendancy and bloodline after
const masteryResult = z.looseObject({ nodeId: z.number(), effectId: z.number(), added: nodeIdName.describe("Nodes newly allocated: the mastery and the path to it") }); // tree set_mastery
const tattoosResult = z.looseObject({ removed: z.number() }); // tree remove_tattoos
const specCount = z.looseObject({ count: z.number() }); // tree spec_new, spec_copy, spec_delete: trees in the list
const activeSpecResult = z.looseObject({ active: z.number() }); // tree spec_activate
const convertResult = z.looseObject({ treeVersion: z.string() }); // tree convert
const convertAllResult = z.looseObject({ converted: z.number(), specs: z.array(z.looseObject({ index: z.number(), title: z.string(), treeVersion: z.string() })) }); // tree convert_all
const groupResult = z.looseObject({ group: z.number() }); // skills add_group, update_group, move_group
const groupsResult = z.looseObject({ groups: z.number() }); // skills delete_group: groups left
const mainGroupResult = z.looseObject({ mainSocketGroup: z.number(), mainSkill: z.string().optional() }); // skills set_main
const gemResult = z.looseObject({ group: z.number(), gem: z.number(), name: z.string().optional(), level: z.number(), quality: z.number() }); // skills set_gem
const gemsResult = z.looseObject({ gems: z.number() }); // skills delete_gem: gems left in the group
const imbuedResult = z.looseObject({ imbuedSupport: z.string().optional() }); // skills set_imbued; absent once cleared
const socketOrderResult = z.looseObject({ gems: strings }); // skills optimise_sockets: gem names in the new order
const spectresResult = z.looseObject({ spectres: spectreList }); // skills set_spectres
const equipResult = z.looseObject({ slot: z.string(), item: z.number() }); // items equip
const unequipResult = z.looseObject({ slot: z.string() }); // items unequip
const activeResult = z.looseObject({ slot: z.string(), active: z.boolean() }); // items set_active
const deletedItemResult = z.looseObject({ deleted: z.number() }); // items delete
const weaponSetResult = z.looseObject({ weaponSet: z.number() }); // items weapon_set
const configSetResult = z.looseObject({ values: z.record(z.string(), configValue) }); // config set: each option asked for, now

// evaluate: what-if answers are stat differences; item text is Path of Building's copy format.
const statValue = z.union([z.number(), z.boolean(), z.string()]);
const changedStats = z.object({ changed: z.record(z.string(), z.object({ before: statValue.nullable(), after: statValue.nullable() })).describe("Only the stats that differ; null = not shown / absent") });
/** Present when the build is at the damage over time cap: which figures stop there and the per-type DoT figures that do not. */
const dotCap = z.object({ cap: z.number(), at: strings.describe("Output keys at the cap"), uncapped: strings.describe("Per-type DoT keys (ChaosDot...) that still measure: use one as the stat") }).optional();
const evalFields = z.array(z.string().trim().min(1).max(100)).max(100).optional().describe("Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats");
const powerStatName = z.string().trim().min(1).max(60).describe("A stat of Path of Building's power stat list, e.g. CombinedDPS, FullDPS, TotalDPS, Life, TotalEHP, Armour, MinionLife (`OffenceDefence` where noted)");
const customModsResult = z.object({
  configSet: z.number(),
  groups: z.array(z.object({ title: z.string(), enabled: z.boolean(), text: z.string(), lines: z.array(z.object({ text: z.string(), supported: z.boolean() })) })),
});
const buySimilarRow = z.object({
  index: z.number().int().min(1).max(200),
  selected: z.boolean().optional().describe("Default true for a row listed"),
  min: z.number().min(-1000000).max(1000000).optional(),
  max: z.number().min(-1000000).max(1000000).optional(),
});
const tradeWeights = z.array(z.object({ stat: powerStatName, weight: z.number().min(0.01).max(1) })).min(1).max(20).optional().describe("Stat weights as the trade popup's list sets them (0.01 to 1 each; default Full DPS 1, Effective Hit Pool 0.5)");
const tradeLeague = z.string().trim().regex(LEAGUE_NAME, "a league name is letters, digits, spaces, ' and -").max(64);
/** Any key naming a seller (the site's trade_filters `account`, or an equivalent) anywhere in a query. */
const sellerKey = (v: unknown): boolean =>
  Array.isArray(v) ? v.some(sellerKey) : typeof v === "object" && v !== null && Object.entries(v).some(([k, x]) => /account|seller/i.test(k) || sellerKey(x));
const tradeQuery = z
  .looseObject({})
  .refine((q) => JSON.stringify(q).length <= 32_768, "a query is at most 32 KB of JSON")
  .refine((q) => !sellerKey(q), "a query may not filter by seller account (trade_filters account or any key naming an account or seller): searches find items, never a player's listings");
const limiterState = z.array(z.object({
  policy: z.string(),
  remaining: z.object({ interactive: z.number(), background: z.number() }).describe("Requests a caller of each priority may still send now"),
  retryAfterSeconds: z.object({ interactive: z.number(), background: z.number() }).describe("Seconds until a caller of each priority may send (0 = now)"),
  windows: z.array(z.object({ limit: z.number(), periodSeconds: z.number(), used: z.number() })).describe("The windows the trade site states, and requests counted in each"),
}));
const evalItemText = z.string().min(1).max(20000).optional().describe("Item text as copied in game or from Path of Building (instead of `item`)");
const evalItemRef = itemRef.optional().describe("Item id from `items list` (or give `text`)");
const compareBuildsInput = z.object({ other: buildId.describe("The build to compare with (its stats are the `after`)"), fields: evalFields });

export const routes: Route[] = [
  // builds
  route({
    name: "build.list", domain: "build", method: "GET", path: "/v1/builds", summary: "List stored builds, most recently changed first; `query` keeps builds whose name contains the text, `sort` orders them.",
    input: z.object({ query: z.string().min(1).max(100).optional().describe("Case-insensitive text the build name contains"), sort: z.enum(["updated", "name", "created"]).default("updated").describe("updated and created: newest first; name: A to Z") }),
    output: z.object({ builds: z.array(meta) }), readOnly: true, workerOp: "(store)",
    run: async (s, i) => {
      const out = await s.list();
      const want = i.query?.toLowerCase();
      let builds = out.result.builds;
      if (want) builds = builds.filter((b) => b.name.toLowerCase().includes(want));
      // The store lists newest change first; the sorts are stable, so equal keys keep that order.
      if (i.sort === "name") builds = [...builds].sort((a, b) => a.name.localeCompare(b.name));
      if (i.sort === "created") builds = [...builds].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { ...out, result: { builds } };
    },
  }),
  route({
    name: "build.new", domain: "build", method: "POST", path: "/v1/builds", summary: "Create an empty build. Tree version defaults to the latest.",
    input: z.object({ name: name.optional(), className: z.string().optional().describe("e.g. Witch"), ascendancy: z.string().optional().describe("e.g. Elementalist"), level: z.number().int().min(1).max(100).optional(), treeVersion: z.string().regex(/^\d+_\d+(_[a-z]+)?$/).optional().describe("e.g. 3_30") }),
    output: created, readOnly: false, workerOp: "builds.new, builds.export",
    run: (s, i) => s.newBuild(i),
  }),
  route({ name: "build.import_xml", domain: "build", method: "POST", path: "/v1/builds/import/xml", summary: "Load a build from Path of Building XML.", input: z.object({ xml: z.string().min(1), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.importXml({ xml: i.xml, name: i.name }) }),
  route({ name: "build.import_code", domain: "build", method: "POST", path: "/v1/builds/import/code", summary: "Load a build from a build code (the text Path of Building shares).", input: z.object({ code: z.string().min(1), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.importCode({ code: i.code, name: i.name }) }),
  route({
    name: "build.import_link", domain: "build", method: "POST", path: "/v1/builds/import/link", summary: "Load a build from a share link on a supported site (pobb.in, pastebin, Maxroll, pob.codes, rentry, poedb).",
    input: z.object({ url: z.string().url().max(2000), name: name.optional() }), output: created, readOnly: false, workerOp: "builds.resolve_link, builds.load, builds.export",
    run: (s, i) => s.importLink({ url: i.url, name: i.name }),
  }),
  route({
    name: "build.characters", domain: "build", method: "POST", path: "/v1/builds/import/characters", summary: "Characters on a public Path of Exile profile (name, league, class, level). The profile's Characters tab must be public. POST so the account name travels in the body, not in a URL that proxies log.",
    input: z.object({ account, realm }), output: z.object({ characters: z.array(z.object({ name: z.string(), league: z.string(), class: z.string(), level: z.number().optional() })) }),
    readOnly: true, workerOp: "(game site)", run: (s, i) => s.characters({ account: i.account, realm: i.realm }),
  }),
  route({
    name: "build.import_character", domain: "build", method: "POST", path: "/v1/builds/import/character", summary: "A new build from a character on a public profile: passive tree, jewels, items and skills, as the Import tab imports them.",
    input: z.object({ account, realm, character: z.string().trim().min(1).max(100).describe("Character name"), name: name.optional() }), output: created, readOnly: false,
    workerOp: "builds.import_character, builds.export",
    run: (s, i) => s.importCharacter({ account: i.account, realm: i.realm, character: i.character, name: i.name }),
  }),
  route({
    name: "build.reimport", domain: "build", method: "POST", path: "/v1/builds/:id/reimport", summary: "Re-import this build from the character it was imported from (the Compare tab's Re-import): tree, jewels, items and skills are replaced; fails for builds not imported from a character.",
    input: z.object({ id: buildId, baseRevision: revision.optional().describe("Refuse the change unless the build is at this revision"), ignoreWeaponSwap: z.boolean().optional().describe("Skip the character's weapon swap (the Import tab's box)") }),
    output: z.object({ result: summary, ...mutationBase.shape }), readOnly: false, workerOp: "builds.reimport",
    run: (s, i) => s.reimport(i.id, { baseRevision: i.baseRevision, ignoreWeaponSwap: i.ignoreWeaponSwap }),
  }),
  route({ name: "build.trash", domain: "build", method: "GET", path: "/v1/builds/trash", summary: "Deleted builds that can still be restored (kept 7 days after deletion).", input: z.object({}), output: z.object({ builds: z.array(meta.extend({ deletedAt: z.string(), purgeAfter: z.string() })) }), readOnly: true, workerOp: "(store)", run: (s) => s.trash() }),
  route({ name: "build.get", domain: "build", method: "GET", path: "/v1/builds/:id", summary: "A build's metadata and summary (class, ascendancy, level, tree version, main skill).", input: z.object({ id: buildId }), output: created, readOnly: true, workerOp: "builds.summary", run: (s, i) => s.get(i.id) }),
  route({ name: "build.rename", domain: "build", method: "POST", path: "/v1/builds/:id/rename", summary: "Rename a build (a new revision).", input: z.object({ id: buildId, name, baseRevision: revision.optional() }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.rename(i.id, { name: i.name, baseRevision: i.baseRevision }) }),
  route({ name: "build.duplicate", domain: "build", method: "POST", path: "/v1/builds/:id/duplicate", summary: "Copy a build into a new build.", input: z.object({ id: buildId, name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.duplicate(i.id, { name: i.name }) }),
  route({ name: "build.delete", domain: "build", method: "DELETE", path: "/v1/builds/:id", summary: "Delete a build. It stays restorable for 7 days (`restore`), then it and its history are removed.", input: z.object({ id: buildId, baseRevision: revision.optional() }), output: z.object({ deleted: z.string(), restorableDays: z.number() }), readOnly: false, workerOp: "(store)", run: (s, i) => s.delete(i.id, { baseRevision: i.baseRevision }) }),
  route({ name: "build.restore", domain: "build", method: "POST", path: "/v1/builds/:id/restore", summary: "Restore a deleted build with its history.", input: z.object({ id: buildId }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.restore(i.id) }),
  route({ name: "build.revert", domain: "build", method: "POST", path: "/v1/builds/:id/revert", summary: "Make a kept revision current again (as a new revision).", input: z.object({ id: buildId, revision, baseRevision: revision.optional() }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.revert(i.id, { revision: i.revision, baseRevision: i.baseRevision }) }),
  mutateRoute("build", "builds", "settings", "Character level and the Auto/Manual level mode (auto follows points spent).", z.object({ level: z.number().int().min(1).max(100).optional(), autoLevel: z.boolean().optional() }), levelResult, ["level", "autoLevel"], "config.set_level"),
  at(readRoute("build", "loadouts", "loadout_list", "The Loadouts dropdown: trees whose title matches an item set, a skill set and a config set (or share a `{id}` link), the one in use, and the active set of each tab. A tab with a single set matches every tree.", z.object({}), z.looseObject({ loadouts: strings, active: z.string().nullable(), sets: loadoutSets }), [], "loadouts.list"), "/v1/loadouts/:id/list"),
  at(readRoute("build", "loadouts", "loadout_stats", "Output figures of each loadout without switching to it: every loadout (or `names`) is picked and calculated, then each tab is switched back to its set (no revision). `fields` are output keys (default FullDPS, CombinedDPS, Life, EnergyShield, Mana, TotalEHP). `fullDpsGroups` counts enabled skill groups ticked Include in Full DPS: 0 means FullDPS reads 0 (new groups start unticked, as in Path of Building; skills update-group includeInFullDPS ticks one).", z.object({ names: z.array(z.string().min(1).max(100)).max(30).optional(), fields: z.array(z.string().min(1).max(100)).max(50).optional() }), z.object({ loadouts: z.array(z.object({ name: z.string(), sets: loadoutSets, fullDpsGroups: z.number(), output: z.record(z.string(), any) })) }), ["names", "fields"], "loadouts.stats"), "/v1/loadouts/:id/stats"),
  at(mutateRoute("build", "loadouts", "loadout_activate", "Switch tree, item set, skill set and config set to a loadout in one step, as picking it in the Loadouts dropdown does.", z.object({ name: z.string().trim().min(1).max(100).describe("Loadout as `loadout_list` gives it") }), loadoutActivated, ["name"], "loadouts.activate"), "/v1/loadouts/:id/activate"),
  at(mutateRoute("build", "loadouts", "loadout_new", "Make a loadout and switch to it: copies of the active tree, item set, skill set and config set under one title, or with `empty` four new empty sets (New Loadout). The answer lists loadouts that stopped matching (a tab that had one set now has two).", z.object({ name: z.string().trim().min(1).max(100).describe("Title for the four sets; no braces"), empty: z.boolean().optional() }), loadoutCreated, ["name", "empty"], "loadouts.new"), "/v1/loadouts/:id/new"),
  at(readRoute("build", "ui", "ui_controls", "The controls of a tab by name (name, type, label or text, state, shown, enabled, a dropdown's choices, and the `ui_invoke` actions each takes now).", z.object({ tab: uiTab, limit, offset }), z.looseObject({ tab: z.string(), total: z.number(), offset: z.number(), controls: z.array(z.looseObject({ name: z.string(), type: z.string(), shown: z.boolean(), enabled: z.boolean(), actions: strings, label: z.string().optional(), text: z.string().optional(), state: z.boolean().optional(), selected: z.number().optional(), choices: strings.optional(), choiceCount: z.number().optional() })) }), ["tab", "limit", "offset"], "ui.controls"), "/v1/ui/:id/controls"),
  at(mutateRoute("build", "ui", "ui_invoke", "A stopgap for actions that have no named op: click a button, type in a box, tick a checkbox or pick a dropdown entry on a tab's control, as `ui_controls` lists them. Hidden or disabled controls, actions the control does not take, and controls that save to a file, reach the network or leave the build are refused.", z.object({ tab: uiTab, control: z.string().min(1).max(100).describe("Control name, from `ui_controls`"), operation: z.enum(["click", "set_text", "set_state", "select"]), value: z.union([z.boolean(), z.number(), z.string().max(20000)]).optional().describe("set_text: the text; set_state: true or false; select: the choice number (from 1) or its label") }), uiResult, ["tab", "control", "operation", "value"], "ui.invoke"), "/v1/ui/:id/invoke"),
  route({ name: "build.export_xml", domain: "build", method: "GET", path: "/v1/builds/:id/xml", summary: "A build's XML at the current or a kept revision.", input: z.object({ id: buildId, revision: revision.optional() }), output: z.object({ id: z.string(), revision: z.number(), xml: z.string() }), readOnly: true, workerOp: "(store)", run: (s, i) => s.exportXml(i.id, { revision: i.revision }) }),
  route({
    name: "build.replace_code", domain: "build", method: "PUT", path: "/v1/builds/:id/code", summary: "Replace a build's content with a build code (the same decode as import/code); id and name stay, the revision moves on. The browser view saves through this.",
    input: z.object({ id: buildId, code: z.string().min(1), baseRevision: revision.describe("Refuse the change unless the build is at this revision") }),
    output: z.object({ build: meta, changed: mutationBase.shape.changed }), readOnly: false, workerOp: "builds.replace",
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
  statRoute("sidebar", "The sidebar stat list as Path of Building shows it: label, value, formatted text. Labels are not unique (the player's and the minion's `Hit DPS` share one); `key` and `actor` tell them apart.", z.object({}), z.object({ stats: z.array(z.looseObject({ label: z.string(), text: z.string(), stat: z.string().optional(), key: z.string().optional(), actor: z.string().optional(), value: z.number().optional() })), warnings: z.array(z.string()) })),
  statRoute("output", "The full calculated output table; `fields` selects keys.", z.object({ fields: z.array(z.string()).max(500).optional().describe("Output keys, e.g. TotalDPS,Life"), actor: z.enum(["player", "minion"]).optional(), mode: z.enum(["main", "calcs"]).optional().describe("main = sidebar environment, calcs = Calcs tab environment") }), z.object({ mainSkill: z.string().optional(), output: z.record(z.string(), any) }), ["fields", "actor", "mode"]),
  statRoute("skills", "Per-skill outputs for every socket group and the Full DPS total.", z.object({}), z.looseObject({ mainSocketGroup: z.number().optional(), groups: z.array(z.looseObject({ index: z.number(), label: z.string().optional(), slot: z.string().optional(), enabled: z.boolean(), includeInFullDPS: z.boolean(), mainActiveSkill: z.number().optional(), activeSkills: strings, gems: z.array(z.looseObject({ name: z.string().optional(), level: z.number().optional(), quality: z.number().optional(), enabled: z.boolean(), count: z.number().optional() })), mainSkill: z.string().optional(), output: skillOutput.optional() })), fullDPS: z.looseObject({ FullDPS: z.number().optional(), FullDotDPS: z.number().optional(), skills: z.array(z.looseObject({ name: z.string().optional(), dps: z.number().optional(), count: z.number().optional() })) }) })),
  statRoute("breakdown", "How one output value is built (the Calcs tab breakdown).", z.object({ key: z.string().min(1).max(100).describe("Output key, e.g. Life"), actor: z.enum(["player", "minion"]).optional() }), z.looseObject({ key: z.string(), value: z.unknown().optional(), breakdown: z.unknown() }), ["key", "actor"]),
  statRoute("ailments", "Shock, chill, scorch, brittle and sap the main skill's hits apply to the enemy the config sets (`enemy`: enemyIsBoss), from the Calcs tab's ailment table at that enemy's ailment threshold. `effect` is capped at `maximum`; under `minimum` it does not apply. Path of Building does not use this figure in the build's own damage: set config conditionEnemyShocked true and conditionShockEffect to `effect` (and the like) to count the build's own shock. Empty when the skill applies none.", z.object({}), z.object({ enemy: z.string(), skill: z.string().optional(), ailments: z.array(z.object({ ailment: z.string(), effect: z.number(), uncapped: z.number(), maximum: z.number(), minimum: z.number(), applies: z.boolean(), threshold: z.number().optional(), chanceOnHit: z.number().optional(), chanceOnCrit: z.number().optional(), duration: z.number().optional() })) })),
  statRoute("warnings", "Build warnings (unmet requirements, over-allocated points, and the like).", z.object({}), z.object({ warnings: z.array(z.string()) })),
  statRoute("defences", "Attribute totals and requirements; resistances with total, overcap and maximum.", z.object({}), z.looseObject({ attributes: z.record(z.string(), z.number()), resistances: z.record(z.string(), z.record(z.string(), z.number())) })),
  statRoute("points", "Passive and ascendancy points used and available, required level. `max` is Path of Building's cap at level 100 (99 + 23 quest points + extra points); `maxAtLevel` the cap at the build's `level` (level - 1 + the same quest and extra points: every campaign quest done).", z.object({}), z.looseObject({ used: z.number().optional(), max: z.number().optional(), level: z.number(), maxAtLevel: z.number(), ascendancyUsed: z.number().optional(), ascendancyMax: z.number().optional(), secondaryAscendancyUsed: z.number().optional(), jewelSockets: z.number().optional(), requiredLevel: z.number().optional(), act: z.string().optional() })),
  statRoute(
    "levers",
    "The build-quality levers left unpulled, in one read, as Path of Building holds them: allocated jewel sockets with what each holds (`kind` basic or small/medium/large cluster, cluster subgraph sockets included) and how many are empty; unallocated sockets a path reaches within `within` points (default 10), nearest first (`points`, PassiveSpec's pathDist); socketed cluster jewels by size; the five flask slots, filled and active (active state belongs to the item set: items.set_active switches a flask on in the active set; set it again in each set you compare); abyssal sockets on gear; anointable equipped items with their anoints; tattoos; allocated masteries and those with no effect chosen; config options set (as config.get) and those the Configuration tab shows for this build still at default; gems of the player's socket groups below their top natural level or 20 quality; gem sockets of equipped items against the gems their groups hold; open affixes on equipped rares (`known`: Path of Building has the prefix/suffix split; otherwise `open` is 6 less the explicit lines, a lower bound). `unused` names each lever not used in one line. Reads only.",
    z.object({ within: z.coerce.number().int().min(1).max(100).optional().describe("Passive points within which unallocated jewel sockets are listed (default 10)") }),
    z.object({
      jewelSockets: z.object({ allocated: z.array(z.looseObject({ nodeId: z.number(), name: z.string(), kind: z.string(), item: z.number().nullable(), itemName: z.string().nullable() })), empty: z.number(), within: z.number(), reachable: z.array(z.looseObject({ nodeId: z.number(), name: z.string(), kind: z.string(), points: z.number() })) }),
      clusterJewels: z.object({ large: z.number(), medium: z.number(), small: z.number(), jewels: z.array(z.looseObject({ nodeId: z.number(), item: z.number(), name: z.string(), base: z.string() })) }),
      flasks: z.object({ filled: z.number(), active: z.number(), slots: z.array(z.looseObject({ slot: z.string(), item: z.number().nullable(), name: z.string().nullable(), active: z.boolean() })) }),
      abyssalSockets: z.array(z.looseObject({ slot: z.string(), item: z.number().nullable(), name: z.string().nullable() })),
      anoints: z.array(z.looseObject({ slot: z.string(), item: z.number(), name: z.string(), allocates: z.array(z.string()) })),
      tattoos: z.object({ count: z.number(), nodes: z.array(z.looseObject({ nodeId: z.number(), name: z.string() })) }),
      masteries: z.object({ allocated: z.number(), selected: z.number(), unselected: z.array(z.looseObject({ nodeId: z.number(), name: z.string() })) }),
      config: z.object({ count: z.number(), values: z.record(z.string(), z.unknown()), atDefault: z.array(z.object({ var: z.string(), label: z.string() })) }),
      gems: z.array(z.looseObject({ group: z.number(), slot: z.string().nullable(), name: z.string(), level: z.number(), maxLevel: z.number(), quality: z.number() })),
      gemSockets: z.array(z.looseObject({ slot: z.string(), name: z.string(), sockets: z.number(), gems: z.number(), empty: z.number() })),
      affixes: z.array(z.looseObject({ slot: z.string(), name: z.string(), corrupted: z.boolean(), known: z.boolean(), open: z.number(), prefixes: z.number().optional(), suffixes: z.number().optional(), prefixLimit: z.number().optional(), suffixLimit: z.number().optional(), explicitLines: z.number().optional() })),
      unused: z.array(z.string()),
    }),
    ["within"],
  ),
  statRoute("xp", "The experience multiplier table of the character level box's hover: for each area level (with its map tier from 68) the percent of experience earned at the build's level.", z.object({}), z.looseObject({ level: z.number(), areas: z.array(z.looseObject({ areaLevel: z.number(), tier: z.number().optional(), percent: z.number() })) })),
  statRoute("sections", "The Calcs tab's sections as displayed for the shown actor: subsections with their visible rows and cell texts; `section` keeps the section with that id, else the sections whose subsection label contains it.", z.object({ section: z.string().trim().min(1).max(100).optional().describe("Section id (e.g. Life), else part of a subsection label (any case)") }), z.looseObject({ sections: z.array(z.looseObject({ id: z.string(), label: z.string(), subsections: z.array(z.looseObject({ label: z.string(), extra: z.string().optional(), rows: z.array(z.looseObject({ label: z.string(), values: strings })) })) })) }), ["section"]),
  statRoute("versions", "Path of Building version, the build's tree version and the latest tree version.", z.object({}), z.looseObject({ pobVersion: z.string().optional(), latestTreeVersion: z.string().optional(), treeVersion: z.string(), treeVersionDisplay: z.string().optional(), targetVersion: z.string().optional() })),

  // tree
  readRoute("tree", "tree", "get", "The allocated tree: class, ascendancy, bloodline, nodes, masteries, tattoos, jewel sockets, tree list.", z.object({}), z.looseObject({ treeVersion: z.string(), className: z.string(), ascendancy: z.string().optional(), bloodline: z.string().optional(), points: z.number(), ascendancyPoints: z.number(), bloodlinePoints: z.number().optional(), nodes: z.array(nodeBrief), masteries: z.array(z.looseObject({ nodeId: z.number(), effectId: z.number(), stats: strings })), tattoos: z.array(z.looseObject({ nodeId: z.number(), name: z.string(), stats: strings })), jewelSockets: z.array(z.looseObject({ nodeId: z.number(), itemId: z.number() })), specs: z.array(specSummary) })),
  mutateRoute("tree", "tree", "set_class", "Change class. If the tree is not connected to the new start, `onDisconnected` decides: fail (default), reset the tree, or connect it by the shortest path.", z.object({ className: z.string().min(1).max(50).describe("e.g. Shadow"), onDisconnected }), classResult, ["className", "onDisconnected"]),
  mutateRoute("tree", "tree", "set_ascendancy", "Change ascendancy (of the current class), or None.", z.object({ ascendancy: z.string().min(1).max(50) }), ascendancyResult, ["ascendancy"]),
  mutateRoute("tree", "tree", "set_bloodline", "Change the secondary ascendancy (bloodline), or None.", z.object({ bloodline: z.string().min(1).max(50) }), bloodlineResult, ["bloodline"]),
  mutateRoute("tree", "tree", "allocate", "Allocate nodes, each with the shortest path to it, as clicking them does. A node of another ascendancy or bloodline is refused unless `ascendancy` is \"switch\", which switches to that ascendancy, bloodline or class first, as clicking the node does (`onDisconnected` as in set_class).", z.object({ nodes: nodeList, ascendancy: z.enum(["fail", "switch"]).optional().describe("switch: change to the node's ascendancy, bloodline or class first"), onDisconnected }), allocatedResult, ["nodes", "ascendancy", "onDisconnected"]),
  mutateRoute("tree", "tree", "deallocate", "Deallocate nodes and every node that depends on them (as a click does), answering every node removed (`removed`, `count`). A node that part of the tree hangs from takes that part with it (one next to the class start can take most of the tree): a call that would remove any node it does not name is refused (400, with the count and the first of them) unless `force` is true; evaluate what_if with removeNodes lists them (`paths`) without changing anything. Path nodes that led to a removed node stay allocated, as in Path of Building; name them to remove them.", z.object({ nodes: nodeList, force: z.boolean().optional().describe("Also remove the nodes that hang from the named ones") }), z.looseObject({ removed: nodeIdName, count: z.number() }), ["nodes", "force"]),
  mutateRoute("tree", "tree", "reset", "Reset the tree (the Reset Tree button).", z.object({}), nothing),
  readRoute("tree", "tree", "mastery_options", "The effects a mastery node offers and which is selected.", z.object({ nodeId: nodeRef }), z.looseObject({ nodeId: z.number(), name: z.string(), allocated: z.boolean(), effects: z.array(z.looseObject({ effectId: z.number(), stats: strings, selected: z.boolean() })) }), ["nodeId"]),
  mutateRoute("tree", "tree", "set_mastery", "Choose a mastery effect; allocates the mastery, with the path to it, if needed (`added` lists every node it allocated).", z.object({ nodeId: nodeRef, effectId: z.number().int().min(0) }), masteryResult, ["nodeId", "effectId"]),
  mutateRoute("tree", "tree", "remove_tattoos", "Remove every tattoo from the tree.", z.object({}), tattoosResult),
  withOther(mutateRoute("tree", "tree", "copy_from", "Copy another build's active tree into this build's tree list, as the Compare tab's copy does (titled \"(Compared)\"; jewels stay behind, they are the other build's items); `use` makes it the active tree.", z.object({ use: z.boolean().optional() }), z.looseObject({ index: z.number(), title: z.string(), active: z.number() })), ["use"]),
  readRoute("tree", "tree", "tattoo_options", "The tattoos a node can take, as the Replace Modifier of Node dialog lists them (right-click a small attribute, a +30 attribute notable, a keystone or an unallocated mastery): id, name, stats, legacy; with the node's current tattoo and the tree's tattoo count against the limit of 50. `legacy` shows legacy tattoos too.", z.object({ node: nodeRef, legacy: z.boolean().optional().describe("Show Legacy Tattoos") }), z.looseObject({ node: z.looseObject({ id: z.number(), name: z.string() }), current: z.string().nullable(), tattoos: z.number(), limit: z.number(), options: z.array(z.looseObject({ id: z.string(), name: z.string(), stats: z.array(z.string()), legacy: z.boolean() })) }), ["node", "legacy"]),
  mutateRoute("tree", "tree", "tattoo", "Tattoo a node, as the dialog's Add button does: the tattoo by name or id (exact, or one unique part). Over 50 tattoos is allowed, as in the application; `tattoos` says how many there are.", z.object({ node: nodeRef, tattoo: z.string().trim().min(1).max(100), legacy: z.boolean().optional().describe("Allow legacy tattoos") }), z.looseObject({ nodeId: z.number(), tattoo: z.string().nullable(), tattoos: z.number(), limit: z.number() }), ["node", "tattoo", "legacy"]),
  mutateRoute("tree", "tree", "untattoo", "Remove one node's tattoo (the dialog's Reset Node button): the node's own passive comes back.", z.object({ node: nodeRef }), z.looseObject({ nodeId: z.number(), name: z.string(), tattoos: z.number(), limit: z.number() }), ["node"]),
  readRoute("tree", "tree", "export_url", "The tree as a passive tree link (pathofexile.com).", z.object({}), z.looseObject({ url: z.string() })),
  mutateRoute("tree", "tree", "import_url", "Add a tree from a passive tree link as a new tree in the list and make it active.", z.object({ url: z.string().url().max(4000), title: title.optional() }), specSummary, ["url", "title"]),
  readRoute("tree", "tree", "radius_nodes", "The passives within a jewel socket's radius (as radius jewels such as timeless jewels, Thread of Hope and Unnatural Instinct see them): per radius its index, label, inner and outer distance, the nodes and how many are allocated. Default the named radii (Small, Medium, Large, Very Large, Massive); `radius` picks one, including the Variable rings.", z.object({ socket: nodeRef.describe("Socket node id, or Jewel <id>"), radius: z.union([z.number().int().min(1).max(20), z.string().trim().min(1).max(20)]).optional().describe("Radius index from 1, or its label") }), z.looseObject({ socket: z.number(), allocated: z.boolean(), radii: z.array(z.looseObject({ index: z.number(), label: z.string(), inner: z.number(), outer: z.number(), total: z.number(), allocated: z.number(), nodes: z.array(z.looseObject({ id: z.number(), name: z.string(), type: z.string(), allocated: z.boolean() })) })) }), ["socket", "radius"]),
  readRoute("tree", "tree", "path", "Shortest path: without `from`, the nodes allocating `to` would add (only `to` itself when a socketed Thread of Hope or Impossible Escape reaches it); with it, the fewest-node route between two nodes.", z.object({ to: nodeRef, from: nodeRef.optional() }), z.looseObject({ length: z.number(), nodes: z.array(nodeBrief) }), ["to", "from"]),
  readRoute("tree", "tree", "timeless_nodes", "What a timeless jewel with this seed and conqueror does to the passives around a jewel socket, without changing the build: each passive it changes, as the tree holds it now (`name`) and after (`becomes`, `stats`). Read through the same rebuild a socketed jewel goes through; an unallocated socket counts as allocated (Zorath's jewel needs its socket allocated). `jewel` is a name from lookup.data timeless, `seed` as written on the item, `conqueror` one of the jewel's.", z.object({ jewel: z.string().min(1).max(50).describe("Timeless jewel name, e.g. Lethal Pride"), seed: z.number().int().min(0).max(1000000).describe("Seed as written on the item"), conqueror: z.string().min(1).max(30).describe("Conqueror, e.g. Kaom"), socket: z.number().int().min(0).describe("Jewel socket node id") }), z.looseObject({ jewel: z.string(), seed: z.number(), conqueror: z.string(), socket: z.number(), radius: z.string().nullable(), nodes: z.array(z.looseObject({ id: z.number(), type: z.string(), name: z.string(), becomes: z.string(), stats: strings, allocated: z.boolean() })) }), ["jewel", "seed", "conqueror", "socket"]),
  mutateRoute("tree", "tree", "spec_new", "Add an empty tree to the tree list.", z.object({ title: title.optional() }), specCount, ["title"]),
  mutateRoute("tree", "tree", "spec_copy", "Copy a tree in the tree list.", z.object({ index: specIndex, title: title.optional() }), specCount, ["index", "title"]),
  mutateRoute("tree", "tree", "spec_rename", "Rename a tree in the tree list.", z.object({ index: specIndex, title }), nothing, ["index", "title"]),
  mutateRoute("tree", "tree", "spec_delete", "Delete a tree from the tree list (not the last one).", z.object({ index: specIndex }), specCount, ["index"]),
  mutateRoute("tree", "tree", "spec_activate", "Make a tree in the tree list the active one.", z.object({ index: specIndex }), activeSpecResult, ["index"]),
  mutateRoute("tree", "tree", "spec_move", "Move a tree to another position in the tree list.", z.object({ index: specIndex, to: specIndex.describe("New position, from 1") }), z.looseObject({ index: z.number(), active: z.number() }), ["index", "to"]),
  mutateRoute("tree", "tree", "convert", "Convert the active tree to another tree version (default the latest); `keepOld` converts a copy.", z.object({ version: treeVersion.optional(), keepOld: z.boolean().optional() }), convertResult, ["version", "keepOld"]),
  mutateRoute("tree", "tree", "convert_all", "Convert every tree in the tree list that is not on a tree version to it (default the latest); the trees are replaced.", z.object({ version: treeVersion.optional() }), convertAllResult, ["version"]),

  // skills
  readRoute("skills", "skills", "get", "The Skills tab: socket groups with their gems and active skills, the main socket group, skill sets and gem options. `mainSocketGroup` is one group number for the whole build, not per skill set (as in Path of Building): it points at the same position in every set.", z.object({}), z.looseObject({ mainSocketGroup: z.number(), groups: z.array(z.looseObject({ index: z.number(), label: z.string(), slot: z.string().optional(), enabled: z.boolean(), includeInFullDPS: z.boolean(), gems: z.array(z.looseObject({ index: z.number(), name: z.string(), level: z.number(), quality: z.number(), enabled: z.boolean(), count: z.number(), support: z.boolean(), error: z.string().optional() })), activeSkills: strings, mainActiveSkill: z.number().optional(), main: z.boolean() })), sets: setList, options: gemOptions, mainOptions: mainOptions, spectres: spectreList })),
  readRoute("skills", "skills", "group_text", "A socket group as Path of Building copies it (paste it back with `add_group`).", z.object({ group: groupRef }), z.looseObject({ text: z.string() }), ["group"]),
  readRoute("skills", "skills", "group_tooltip", "The hover text of a socket group in the Skills tab's group list, as lines of text.", z.object({ group: groupRef }), z.looseObject({ group: z.number(), label: z.string(), lines: z.array(z.string()) }), ["group"]),
  readRoute("skills", "skills", "gem_tooltip", "The hover text of a gem's name box in the Skills tab, as lines of text.", z.object({ group: groupRef, gem: gemRef }), z.looseObject({ group: z.number(), gem: z.number(), name: z.string(), lines: z.array(z.string()) }), ["group", "gem"]),
  readRoute("skills", "skills", "support_compatible", "The support gems the gem box offers for an active skill of a socket group, as Path of Building decides what can support it (so this reads a build holding the skill; the gem box's Skills tab options for legacy and exceptional supports apply). `skill` is a position in the group's active skills (default its main one); `query` matches gem names.", z.object({ group: groupRef, skill: z.number().int().min(1).max(100).optional().describe("Active skill position in the group, from 1"), query: z.string().max(100).optional(), limit, offset }), z.looseObject({ group: z.number(), skill: z.string(), total: z.number(), offset: z.number(), gems: z.array(z.looseObject({ name: z.string(), id: z.string(), tags: strings })) }), ["group", "skill", "query", "limit", "offset"]),
  mutateRoute("skills", "skills", "add_group", "Add a socket group from gems or from copy text (the Paste button). Gem names resolve as the gem box does; unknown names fail. The new group is not in Full DPS unless `includeInFullDPS` is true (Path of Building's default is unticked).", z.object({ text: z.string().min(1).max(20000).optional().describe("Copy format: optional `Label:` and `Slot:` lines, then `<gem> <level>/<quality> [DISABLED] <count>` per line"), gems: z.array(skillGem).min(1).max(12).optional().describe("Gems of the group, in order; a gem without `level` gets the level the `defaultGemLevel` option picks (as a gem added by hand); copy text carries its own levels"), label: groupLabel.optional(), slot: groupSlot.optional(), includeInFullDPS: z.boolean().optional() }), groupResult, ["text", "gems", "label", "slot", "includeInFullDPS"]),
  mutateRoute("skills", "skills", "update_group", "Change a socket group's label, item slot, enabled and Full DPS flags (and the count of an item-granted group).", z.object({ group: groupRef, label: groupLabel.optional(), slot: groupSlot.optional(), enabled: z.boolean().optional(), includeInFullDPS: z.boolean().optional(), count: gemCount.optional() }), groupResult, ["group", "label", "slot", "enabled", "includeInFullDPS", "count"]),
  mutateRoute("skills", "skills", "delete_group", "Delete a socket group.", z.object({ group: groupRef }), groupsResult, ["group"]),
  mutateRoute("skills", "skills", "move_group", "Move a socket group to another position in the list; the main skill stays the same group.", z.object({ group: groupRef, to: groupRef.describe("New position, from 1") }), groupResult, ["group", "to"]),
  mutateRoute("skills", "skills", "set_main", "Make a socket group the main one, and optionally pick which of its active skills is the main skill. The main group is one number for the whole build, not per skill set: setting it in one set changes the main group of every set to the group at that position.", z.object({ group: groupRef, skill: z.number().int().min(1).max(50).optional().describe("Active skill number in the group's `activeSkills`, from 1") }), mainGroupResult, ["group", "skill"]),
  mutateRoute("skills", "skills", "set_gem", "Change a gem of a group (name, level, quality, enabled, count); a position one past the last gem adds one (name required), at the level the `defaultGemLevel` option picks unless `level` is given. Names are those the gem box lists with the build's options: a legacy gem (the Awakened supports in 3.30) needs set_options showLegacyGems, and the refusal says so.", z.object({ group: groupRef, gem: gemRef, name: z.string().trim().min(1).max(100).optional().describe("Gem name; the ` Support` suffix is optional"), level: gemLevel.optional(), quality: gemQuality.optional(), enabled: z.boolean().optional(), count: gemCount.optional() }), gemResult, ["group", "gem", "name", "level", "quality", "enabled", "count"]),
  mutateRoute("skills", "skills", "delete_gem", "Remove a gem from a group.", z.object({ group: groupRef, gem: gemRef }), gemsResult, ["group", "gem"]),
  mutateRoute("skills", "skills", "set_imbued", "Set a group's Imbued Support (needs the group socketed in an item slot), or None to clear it.", z.object({ group: groupRef, name: z.string().trim().min(1).max(100).describe("A support gem name, or None") }), imbuedResult, ["group", "name"]),
  mutateRoute("skills", "skills", "optimise_sockets", "Reorder a socketed group's gems to match the item's socket colours (the Optimise Sockets button).", z.object({ group: groupRef }), socketOrderResult, ["group"]),
  mutateRoute("skills", "skills", "set_options", "Skills tab gem options: default gem level and quality, which support gems the gem box shows, legacy gems.", z.object({ defaultGemLevel: z.enum(["normalMaximum", "corruptedMaximum", "awakenedMaximum", "characterLevel", "levelOne"]).optional(), defaultGemQuality: gemQuality.optional(), showSupportGemTypes: z.enum(["ALL", "NORMAL", "EXCEPTIONAL"]).optional().describe("NORMAL = non-exceptional"), showLegacyGems: z.boolean().optional() }), gemOptions, ["defaultGemLevel", "defaultGemQuality", "showSupportGemTypes", "showLegacyGems"]),
  mutateRoute("skills", "skills", "set_skill_options", "The main skill's sidebar choices: skill part, stages, active mines, minion and minion skill (only those the skill shows; see `get` mainOptions). Dropdowns take their number or label; set part and minion before stages and minion skill (done in that order).", z.object({ part: choiceOf.optional(), stages: z.number().int().min(0).max(1000).optional(), mines: z.number().int().min(0).max(1000).optional(), minion: choiceOf.optional().describe("Minion name (or id), or its number in the list"), minionSkill: choiceOf.optional() }), mainOptions, ["part", "stages", "mines", "minion", "minionSkill"]),
  mutateRoute("skills", "skills", "set_spectres", "Add or remove spectres in the build's spectre library (Manage Spectres...), by spectre name or id; spectres are then choices of a Raise Spectre skill's `minion`.", z.object({ add: z.array(z.string().trim().min(1).max(200)).max(50).optional(), remove: z.array(z.string().trim().min(1).max(200)).max(50).optional() }), spectresResult, ["add", "remove"]),
  mutateRoute("skills", "skills", "set_new", "Add a skill set.", z.object({ title: title.optional() }), setsResult, ["title"]),
  mutateRoute("skills", "skills", "set_copy", "Copy a skill set within the build. From another build: activate the set there, read each group with group_text and paste it here with add_group (in a new set made with set_new).", z.object({ index: setIndex.describe("Skill set number in the set list, from 1"), title: title.optional() }), setsResult, ["index", "title"]),
  mutateRoute("skills", "skills", "set_rename", "Rename a skill set.", z.object({ index: setIndex.describe("Skill set number in the set list, from 1"), title }), setsResult, ["index", "title"]),
  mutateRoute("skills", "skills", "set_delete", "Delete a skill set (not the last one).", z.object({ index: setIndex.describe("Skill set number in the set list, from 1") }), setsResult, ["index"]),
  mutateRoute("skills", "skills", "set_activate", "Make a skill set the active one.", z.object({ index: setIndex.describe("Skill set number in the set list, from 1") }), setsResult, ["index"]),

  // items
  readRoute("items", "items", "list", "The Items tab: every item in the list, every slot with the item in it (and flask active state), item sets, the weapon set. `itemSet` (an index of `sets`) answers the slots, flask state and weapon set as that item set holds them, without switching to it; default the active set.", z.object({ itemSet: z.coerce.number().int().min(1).max(100).optional().describe("Item set index (default the active set)") }), z.looseObject({ items: z.array(itemBrief), slots: z.array(z.looseObject({ slot: z.string(), item: z.number().optional(), active: z.boolean().optional() })), sets: setList, weaponSet: z.number() }), ["itemSet"]),
  readRoute("items", "items", "get", "One item: its text, mods in force for its selected variant, roll ranges, anoints, variants and the slots it fits.", z.object({ item: itemRef }), itemDetail, ["item"]),
  readRoute("items", "items", "tooltip", "The hover text of an item in the Items tab's list, as lines of text: its mods, a flask's effective stats (duration, charges, `Flask uptime` average and minimum from the charges the build generates per second; Path of Building leaves charges gained on critical strike out of uptime) and what equipping it in each slot it fits would change.", z.object({ item: itemRef }), z.looseObject({ item: z.number(), name: z.string(), lines: z.array(z.string()) }), ["item"]),
  mutateRoute("items", "items", "add", "Add an item from its text (copied in game or from Path of Building), as Ctrl+V on the item list does. Text Path of Building cannot read fails. A mod line is an explicit unless the text says otherwise: an enchant (a flask's \"Used when ...\" too) ends in ` (enchant)` as the game copies it, or starts with `{enchant}`; an implicit ends in ` (implicit)`, or sits in the `Implicits: N` lines of Path of Building's own form. `warnings` lists what the game would not allow (more than 3 prefixes or 3 suffixes on a rare, 1 on a magic item, 2 on a jewel, by Path of Building's split or else by matching the lines to the base's mods, a lower bound; eldritch implicits with Shaper, Elder or conqueror influence); items/list and get carry it too.", z.object({ text: z.string().min(1).max(20000), equip: itemEquip }), itemBrief, ["text", "equip"]),
  mutateRoute("items", "items", "add_unique", "Add a unique from the unique database by name (a `lookup uniques` name or title), optionally with a variant.", z.object({ name: itemName, variant: z.number().int().min(1).max(100).optional().describe("Variant number, from 1, for uniques that have variants"), equip: itemEquip }), itemBrief, ["name", "variant", "equip"]),
  mutateRoute("items", "items", "add_rare", "Add a rare from the rare template database by name (e.g. `Armour Helmet`).", z.object({ name: itemName, equip: itemEquip }), itemBrief, ["name", "equip"]),
  mutateRoute("items", "items", "modify", "Change an item as its editor does: variant, quality, sockets and links, mod roll ranges, catalyst. Saved over the item.", z.object({ item: itemRef, variant: z.number().int().min(1).max(100).optional(), altVariant: z.number().int().min(1).max(100).optional().describe("Second variant, for items that have one"), quality: z.number().int().min(0).max(99).optional(), sockets: z.string().trim().min(1).max(40).optional().describe("Socket colours R G B W A with - for links and a space between groups, e.g. `R-G-B B`; only adds sockets"), ranges: z.array(z.object({ index: z.number().int().min(1).max(100).describe("Position in the item's `ranges`, from 1"), value: z.number().min(0).max(1) })).max(20).optional(), catalyst: z.number().int().min(0).max(12).optional().describe("Crafted rings, amulets and belts: 0 none, 1 Abrasive, 2 Accelerating, 3 Dextral, 4 Fertile, 5 Imbued, 6 Intrinsic, 7 Noxious, 8 Prismatic, 9 Sinistral, 10 Tempering, 11 Turbulent, 12 Unstable"), catalystQuality: z.number().int().min(0).max(99).optional() }), itemDetail, ["item", "variant", "altVariant", "quality", "sockets", "ranges", "catalyst", "catalystQuality"]),
  mutateRoute("items", "items", "edit", "Replace an item's text (the Edit... button); the item keeps its id and slot. Text Path of Building cannot read fails.", z.object({ item: itemRef, text: z.string().min(1).max(20000) }), itemDetail, ["item", "text"]),
  mutateRoute("items", "items", "anoint", "Anoint an amulet (or another anointable item) with notables, one per anoint slot, in order; an empty list removes the anoints.", z.object({ item: itemRef, notables: z.array(itemName).max(4) }), itemDetail, ["item", "notables"]),
  mutateRoute("items", "items", "enchant", "Enchant an item from the Enchant popup (helmet, gloves, boots, weapon and similar). The enchantment is matched by its text, exactly or by one unique part of it.", z.object({ item: itemRef, enchantment: z.string().trim().min(1).max(300), source: z.string().trim().min(1).max(100).optional().describe("Where it comes from, e.g. Eternal Labyrinth (the default is the first listed)"), skill: z.string().trim().min(1).max(100).optional().describe("For skill enchantments (helmets), the skill") }), itemDetail, ["item", "enchantment", "source", "skill"]),
  withOther(mutateRoute("items", "items", "copy_from", "Copy the item another build has in a slot into this build's items, as the Compare tab's copy does; `use` equips it in the same slot.", z.object({ slot: z.string().trim().min(1).max(60).describe("Slot in the other build, e.g. Body Armour, Ring 1"), use: z.boolean().optional() }), itemDetail), ["slot", "use"]),
  mutateRoute("items", "items", "craft", "Craft a new item from a base (the Craft item... popup), pick crafting bench mods in its affix boxes, and add it. A mod is matched by the text of its affix box entry, e.g. `+# to maximum Life`.", z.object({ base: z.string().trim().min(1).max(200).describe("Base type name, e.g. Astral Plate"), rarity: z.enum(["NORMAL", "MAGIC", "RARE"]).optional().describe("Default RARE"), title: z.string().trim().min(1).max(100).optional(), affixes: z.array(z.object({ slot: z.number().int().min(1).max(6).describe("Affix box, from 1 (prefixes first)"), mod: z.string().trim().min(1).max(300), roll: z.number().min(0).max(1).optional().describe("0 to 1 across the mod's tiers and range; default 1") })).max(6).optional(), equip: itemEquip }), itemDetail, ["base", "rarity", "title", "affixes", "equip"]),
  extended(route<z.ZodObject<Shape>, { id: string }>({
    name: "items.affix_options", domain: "items", method: "POST", path: "/v1/items/:id/affix-options",
    summary: "The choices in each affix box of a base crafted on the Items tab (Craft item...), without adding it: per box its type and the choices in the box's order, each with its tiers (mod id, text, level). `affixes` fill boxes first, so their mod groups drop out of the others as in the application; `slots` picks the empty boxes to list (default all empty ones). With `sort` (a Modifier sorting entry, e.g. Full DPS, Life, Effective Hit Pool) the choices are best first for this build, the mid tier of each measured in the item's slot, and `value` is that stat with it. Nothing is added to the build.",
    input: z.object({
      base: z.string().trim().min(1).max(200).describe("Base type name, e.g. Astral Plate"),
      rarity: z.enum(["MAGIC", "RARE"]).optional().describe("Default RARE"),
      affixes: z.array(z.object({ slot: z.number().int().min(1).max(6).describe("Affix box, from 1 (prefixes first)"), mod: z.string().trim().min(1).max(300), roll: z.number().min(0).max(1).optional() })).max(6).optional(),
      slots: z.array(z.number().int().min(1).max(6)).min(1).max(6).optional().describe("Empty affix boxes to list"),
      sort: z.string().trim().min(1).max(60).optional().describe("Modifier sorting entry by its label, e.g. Full DPS"),
      limit: z.number().int().min(1).max(500).optional().describe("Choices per box"),
    }),
    output: z.looseObject({ base: z.string(), rarity: z.string(), sort: z.string(), boxes: z.array(z.looseObject({ slot: z.number(), type: z.string(), choices: z.array(z.looseObject({ text: z.string(), value: z.number().nullable(), tiers: z.array(z.looseObject({ id: z.string(), text: z.string(), level: z.number() })) })) })) }),
    readOnly: true,
    workerOp: "items.affix_options",
    run: (svc, i) => svc.read(i.id, "items.affix_options", pick(i, ["base", "rarity", "affixes", "slots", "sort", "limit"])),
  }), { id: buildId }),
  tradeLinked(orOther(extended(route<z.ZodObject<Shape>, { id: string }>({
    name: "items.buy_similar", domain: "items", method: "POST", path: "/v1/items/:id/buy-similar",
    summary: "The trade search the Items tab's Buy similar popup (and the Compare tab's Buy button) builds for an item, answered without opening anything: the popup is driven through its own controls and its Open URL link is read. Name an `item` (id from `items list`) or a `slot` (the item in it); with `other`, the item is the other build's (its `item` id or `slot`, as the Compare tab's Buy button takes it) and neither build changes. `league` is the server's configured trade league (POB_API_TRADE_LEAGUE), the one being played: it is used when left out and any other league is refused, and with no league configured the call is refused (501 unsupported); the popup's league list is exactly that league, so the link is never built for Standard by default, and nothing is sent to the trade site (the link is made with no request, and it is unverified until someone opens one by hand). `realm` (default pc) and `listed` (the Listed status by its api value, default securable, the popup's first) are the popup's dropdowns. Like the popup, the answer ticks nothing by default: only the category filter (a unique: its name and base) is in the query. `mods` lists the popup's mod rows (enchant, implicit, explicit, scourge; `canSearch` is false for a line the trade site has no stat for); `select` ticks rows by `index` (a row listed is ticked unless `selected` is false) and sets their Min and Max (Min starts at the roll, `value`), a trade stat the site offers as a choice (`option`) takes no number. `defences` does the same for the Armour, Evasion, Energy Shield and Ward rows of a gear item; `baseType` is the \"Use specific base\" box and `itemLevel` the Item Level boxes (neither is in the popup for a unique). `query` is the search the link carries, `search` the body for `trade.search`. Calculation only; nothing is sent anywhere.",
    input: z.object({
      item: itemRef.optional().describe("Item id; with `other`, an item of the other build"),
      slot: itemSlot.optional().describe("The item in this slot instead of `item`; with `other`, the other build's slot"),
      league: tradeLeague.optional().describe("Trade league: "+"the server's configured trade league (POB_API_TRADE_LEAGUE), the one being played; another league is refused (default: that league)"),
      realm,
      listed: z.enum(["securable", "available", "online", "any"]).optional().describe("Listed status: securable (Instant Buyout, default), available (Instant Buyout & In Person), online (In Person (Online)), any"),
      baseType: z.boolean().optional().describe("Tick \"Use specific base\""),
      itemLevel: z.object({ min: z.number().int().min(1).max(100).optional(), max: z.number().int().min(1).max(100).optional() }).optional().describe("Item Level boxes"),
      select: z.array(buySimilarRow).max(60).optional().describe("Mod rows to tick, by `index` in `mods`"),
      defences: z.array(buySimilarRow).max(4).optional().describe("Defence rows to tick, by `index` in `defences`"),
    }),
    output: z.looseObject({
      item: z.looseObject({ id: z.number(), name: z.string(), baseName: z.string().optional(), rarity: z.string().optional(), type: z.string().optional(), title: z.string().optional() }),
      slot: z.string().nullable(), league: z.string(), realm: z.string(), listed: z.string(),
      mods: z.array(z.looseObject({
        index: z.number(), type: z.enum(["enchant", "implicit", "explicit", "scourge"]), line: z.string(), tradeId: z.string().nullable(), tradeIds: strings,
        value: z.number().nullable(), option: z.union([z.number(), z.string()]).nullable(), inverted: z.boolean(), selected: z.boolean(), min: z.number().nullable(), max: z.number().nullable(), canSearch: z.boolean(),
      })),
      defences: z.array(z.looseObject({ index: z.number(), label: z.string(), value: z.number(), selected: z.boolean(), min: z.number().nullable(), max: z.number().nullable() })),
      query: tradeQuery, search: z.looseObject({ query: tradeQuery }), link: z.string(),
    }),
    readOnly: true,
    workerOp: "items.buy_similar",
    run: (svc, i) => svc.read(i.id, "items.buy_similar", pick(i, ["item", "slot", "league", "realm", "listed", "baseType", "itemLevel", "select", "defences"])),
  }), { id: buildId }), ["item", "slot", "league", "realm", "listed", "baseType", "itemLevel", "select", "defences"]), true),
  mutateRoute("items", "items", "influence", "Set an item's influences from its Influence dropdowns (Shaper, Elder, Warlord, Hunter, Crusader, Redeemer; helmets, gloves, boots and body armour also Searing Exarch and Eater of Worlds). An empty list removes them. Items without Influence dropdowns (flasks, jewels) and unknown names fail.", z.object({ item: itemRef, influences: z.array(z.string().trim().min(1).max(50)).max(2).describe("Up to two influence names, as the dropdowns list them") }), itemDetail, ["item", "influences"]),
  mutateRoute("items", "items", "corrupt", "Corrupt an item with the Corrupt... popup (Corrupted source), choosing up to two implicits from its lists; an empty list corrupts with no new implicit. An implicit is matched by its text, exactly or by one unique part. Items that cannot be corrupted and implicits the lists do not offer fail.", z.object({ item: itemRef, implicits: z.array(z.string().trim().min(1).max(300)).max(2).describe("Text of each implicit, one per Implicit box") }), itemDetail, ["item", "implicits"]),
  mutateRoute("items", "items", "add_implicit", "Add an implicit with the Add Implicit... popup. Sources: Custom (give `text`), and where the item allows them Vestigial, Searing Exarch and Eater of Worlds (give `mod`: the text of a choice, exactly or by one unique part). Items that take no added implicit and unknown or ambiguous choices fail.", z.object({ item: itemRef, source: z.string().trim().min(1).max(50).optional().describe("Source in the popup; Custom when `text` is given, else the first listed"), mod: z.string().trim().min(1).max(300).optional().describe("Text of the choice, for the listed sources"), text: z.string().trim().min(1).max(300).optional().describe("The implicit line, for the Custom source") }), itemDetail, ["item", "source", "mod", "text"]),
  mutateRoute("items", "items", "custom_mod", "Add a modifier to a magic or rare item with the Add modifier... popup: pick a source (Crafting Bench, Essence, Veiled, Beastcraft, Necropolis, Fossil, drop-restricted, Prefix, Suffix; only those the item has) and the choice by text, or Custom with `text`. Unknown sources and choices fail.", z.object({ item: itemRef, source: z.string().trim().min(1).max(50).describe("Source in the popup, e.g. Crafting Bench or Custom"), mod: z.string().trim().min(1).max(300).optional().describe("Text of the choice, exact or one unique part"), text: z.string().trim().min(1).max(300).optional().describe("The modifier line, for the Custom source") }), itemDetail, ["item", "source", "mod", "text"]),
  mutateRoute("items", "items", "crucible_mod", "Set the crucible modifiers of a weapon or shield with the Add Crucible mod... popup: each entry names a node box and the text of its choice (None empties the box); boxes not named keep their choice. Items without a crucible tree and unknown choices fail.", z.object({ item: itemRef, mods: z.array(z.object({ node: z.number().int().min(1).max(5).describe("Node box, 1 to 5"), mod: z.string().trim().min(1).max(300).describe("Text of the choice, or None") })).min(1).max(5) }), itemDetail, ["item", "mods"]),
  mutateRoute("items", "items", "cluster_jewel", "Change a crafted cluster jewel with its own controls: the skill, the added passive count (within the jewel's range) and notables, one per affix box in order (as `craft` picks affixes). Only jewels made with `craft` from a cluster jewel base have them.", z.object({ item: itemRef, skill: z.string().trim().min(1).max(100).optional().describe("Jewel skill, e.g. Fire Damage"), nodes: z.number().int().min(1).max(12).optional().describe("Added passive skills"), notables: z.array(z.string().trim().min(1).max(300)).max(4).optional().describe("Text of the notable in affix box 1, 2, ...") }), itemDetail, ["item", "skill", "nodes", "notables"]),
  mutateRoute("items", "items", "equip", "Put an item in a slot, as the slot's dropdown does. An item the slot does not take fails.", z.object({ item: itemRef, slot: itemSlot }), equipResult, ["item", "slot"]),
  mutateRoute("items", "items", "unequip", "Empty a slot (the item stays in the list).", z.object({ slot: itemSlot }), unequipResult, ["slot"]),
  mutateRoute("items", "items", "set_active", "Switch a flask's or tincture's Active box on or off, as the Items tab does: in the active item set only (each item set keeps its own flask state, so after items.set_activate the other set's flasks are as that set left them).", z.object({ slot: itemSlot, active: z.boolean() }), activeResult, ["slot", "active"]),
  mutateRoute("items", "items", "delete", "Delete an item from the list (it leaves every slot that held it, in every item set; `add` with `equip` fills only the active set, so re-equip a replacement in the other sets with set-activate first).", z.object({ item: itemRef }), deletedItemResult, ["item"]),
  mutateRoute("items", "items", "weapon_set", "Switch between weapon set 1 and the swap set (the weapon swap buttons).", z.object({ set: z.number().int().min(1).max(2) }), weaponSetResult, ["set"]),
  mutateRoute("items", "items", "set_new", "Add an item set (an empty set of slots).", z.object({ title: title.optional() }), setsResult, ["title"]),
  mutateRoute("items", "items", "set_copy", "Copy an item set within the build. From another build: read each item there with items get (`raw`) and add it here with items add and `equip` (in a new set made with set_new); flask state with set_active.", z.object({ index: setIndex.describe("Item set number in the set list, from 1"), title: title.optional() }), setsResult, ["index", "title"]),
  mutateRoute("items", "items", "set_rename", "Rename an item set.", z.object({ index: setIndex.describe("Item set number in the set list, from 1"), title }), setsResult, ["index", "title"]),
  mutateRoute("items", "items", "set_delete", "Delete an item set (not the last one); its items stay in the list.", z.object({ index: setIndex.describe("Item set number in the set list, from 1") }), setsResult, ["index"]),
  mutateRoute("items", "items", "set_activate", "Make an item set the active one.", z.object({ index: setIndex.describe("Item set number in the set list, from 1") }), setsResult, ["index"]),

  // config
  readRoute("config", "config", "get", "Configuration values that differ from default on the active config set, the config set list, level settings. An option left out is at its default: a box unticked (false), a number 0 or empty, a list on its first choice; a number box where 0 applies (such as overrideInspirationCharges) is listed when set to 0. GET /v1/lookup/config?buildId= lists every option with its current value. A buff a socketed gem grants applies whatever its box says: an Arcane Surge Support in an enabled group gives Arcane Surge (CalcPerform buffs) with buffArcaneSurge false, so a 'nothing up' figure disables that group too.", z.object({}), z.looseObject({ values: z.record(z.string(), z.unknown()), sets: setList, level: z.number().optional(), autoLevel: z.boolean() })),
  mutateRoute("config", "config", "set", "Set configuration options (see lookup `config` for names and allowed values); `reset` puts options back to their default.", z.object({ values: z.record(z.string().min(1).max(100), configValue).optional(), reset: z.array(z.string().min(1).max(100)).max(500).optional() }), configSetResult, ["values", "reset"]),
  mutateRoute("config", "config", "set_new", "Add a config set.", z.object({ title: title.optional() }), setsResult, ["title"]),
  mutateRoute("config", "config", "set_copy", "Copy a config set within the build. From another build: read config get there (its values differ from default) and pass them to config set here (in a new set made with set_new).", z.object({ index: setIndex, title: title.optional() }), setsResult, ["index", "title"]),
  mutateRoute("config", "config", "set_rename", "Rename a config set.", z.object({ index: setIndex, title }), setsResult, ["index", "title"]),
  mutateRoute("config", "config", "set_delete", "Delete a config set (not the last one).", z.object({ index: setIndex }), setsResult, ["index"]),
  mutateRoute("config", "config", "set_activate", "Make a config set the active one.", z.object({ index: setIndex }), setsResult, ["index"]),
  readRoute("config", "config", "custom_mods", "The custom modifier groups of the active config set (Configuration tab, Custom Modifiers): title, enabled, text, and each line with `supported` (Path of Building parses it whole; other lines are ignored by the calculation, as the box shows them in red).", z.object({}), customModsResult),
  mutateRoute("config", "config", "set_custom_mods", "Replace the custom modifier groups of the active config set, as editing the boxes does: each group's lines add to the build's calculation while it is enabled. Answers the groups with each line's `supported`.", z.object({ groups: z.array(z.object({ title: z.string().trim().min(1).max(100).optional(), enabled: z.boolean().optional().describe("Default true"), text: z.string().max(20000).describe("One modifier per line, as the item text writes it") })).min(1).max(20) }), customModsResult, ["groups"]),
  withOther(mutateRoute("config", "config", "copy_from", "Copy another build's Configuration tab inputs onto this build, as the Compare tab's Copy config does (inputs only this build has stay).", z.object({}), z.looseObject({ copied: z.number() })), []),
  readRoute("config", "config", "party_export", "What the build would export for party play with the Import tab's Export Support box on, as the Party tab shows it (own modifiers, auras, curses, warcries, links, enemy conditions and modifiers); `enabled` is the box's current state. The build does not change.", z.object({}), z.looseObject({ enabled: z.boolean(), exports: z.looseObject({ PlayerMods: z.string(), Aura: z.string(), Curse: z.string(), Warcry: z.string(), Link: z.string(), EnemyConditions: z.string(), EnemyMods: z.string() }) })),
  readRoute("config", "config", "notes", "The build notes (Notes tab), with colour codes.", z.object({}), z.looseObject({ text: z.string() })),
  mutateRoute("config", "config", "set_notes", "Replace the build notes.", z.object({ text: z.string().max(100000) }), nothing, ["text"]),

  // party (config domain): the Party tab's inputs
  at(readRoute("config", "party", "party_get", "The Party tab inputs: the import destination and toggles, the text boxes (auras, curses, warcries, links, party member stats, enemy conditions, enemy modifiers) and what Path of Building parsed from them.", z.object({}), partyState, [], "party.get"), "/v1/party/:id/get"),
  at(mutateRoute("config", "party", "party_import", "Import a party member's build code (exported with Export support on) into a destination, as the Party tab's Import button does; Append keeps what is there. Links are not fetched.", z.object({ code: z.string().min(1).max(2000000), destination: partyDestination.optional(), append: z.boolean().optional() }), nothing, ["code", "destination", "append"], "party.import"), "/v1/party/:id/import"),
  at(mutateRoute("config", "party", "party_clear", "Clear imported party data for a destination (default the tab's current one), as the Clear button does.", z.object({ destination: partyDestination.optional() }), nothing, ["destination"], "party.clear"), "/v1/party/:id/clear"),
  at(mutateRoute("config", "party", "party_set", "Set party text boxes and toggles; text is parsed (Rebuild All), as when typed in the advanced boxes.", z.object({ auras: partyText.optional(), curses: partyText.optional(), warcries: partyText.optional(), links: partyText.optional(), partyMemberStats: partyText.optional(), enemyConditions: partyText.optional(), enemyMods: partyText.optional(), showAdvanced: z.boolean().optional(), append: z.boolean().optional(), destination: partyDestination.optional() }), nothing, ["auras", "curses", "warcries", "links", "partyMemberStats", "enemyConditions", "enemyMods", "showAdvanced", "append", "destination"], "party.set"), "/v1/party/:id/set"),
  at(mutateRoute("config", "party", "party_effects", "Turn party effects off (Disable Party Effects; the data stays) or back on (Rebuild All parses the boxes again).", z.object({ enabled: z.boolean() }), nothing, ["enabled"], "party.set_effects"), "/v1/party/:id/effects"),

  // evaluate
  evalRoute("what_if", "What the build would be with changes, without making them: nodes added or removed, an item in a slot, a flask or tincture toggled, conditions on. Answers only the stats that differ. `changed` takes the named nodes alone; as the tree's hover, `paths` lists for each node the path that reaches it (kind path) or the allocated nodes that depend on it (kind depends) with their point cost, and `withPaths` is the same evaluation with all of them (present when a path or dependents go beyond the node). A jewel goes in an allocated socket or in one named in addNodes (a socket and its jewel in one call); a cluster, timeless or radius-changing jewel rebuilds the tree, so compare_item measures it. A node another ascendancy owns is refused. `dotCap` is there when the build is at the damage over time cap.", z.object({ addNodes: nodeList.optional(), removeNodes: nodeList.optional(), slot: itemSlot.optional(), item: evalItemRef, text: evalItemText, toggleFlask: itemSlot.optional().describe("Flask slot whose active state flips"), toggleTincture: itemSlot.optional().describe("Tincture slot whose active state flips"), conditions: z.array(z.string().trim().min(1).max(100)).max(50).optional().describe("Condition names switched on, as the calculator knows them"), fields: evalFields }), changedStats.extend({ dotCap, paths: z.array(z.looseObject({ node: z.number(), name: z.string(), kind: z.enum(["path", "depends"]), points: z.number(), nodes: z.array(z.looseObject({ id: z.number(), name: z.string() })) })).optional(), withPaths: z.looseObject({ changed: changedStats.shape.changed, points: z.number() }).optional() }), ["addNodes", "removeNodes", "slot", "item", "text", "toggleFlask", "toggleTincture", "conditions", "fields"]),
  evalRoute("passives", "Score candidate passives one at a time without allocating them: each with the path that reaches it, through the calculator. Answers the stats that differ per candidate. Default candidates: every unallocated passive next to the allocated tree (ascendancy nodes and masteries left out). A named candidate that cannot be scored is listed in `skipped`; the call fails only when none can.", z.object({ candidates: nodeList.optional().describe("Node ids or exact names; each is scored with its path from the allocated tree"), fields: evalFields, sortBy: z.string().trim().min(1).max(100).optional().describe("Output key; candidates sorted by its gain, largest first (otherwise by node id)"), limit, offset }), z.looseObject({ total: z.number(), offset: z.number(), sortBy: z.string().optional(), candidates: z.array(z.looseObject({ id: z.number(), name: z.string(), type: z.string(), points: z.number().describe("Points the candidate and its path cost"), gain: z.number().optional(), changed: changedStats.shape.changed })), skipped: z.array(z.looseObject({ id: z.number(), name: z.string(), reason: z.string() })).optional().describe("Named candidates not scored (allocated, a mastery, unreachable), with the reason") }), ["candidates", "fields", "sortBy", "limit", "offset"]),
  evalRoute("node_power", "Passive node power for a stat, from the tree's heat map calculation: unallocated nodes show what allocating gains (`power` the node alone, `pathPower` with the `pathDist` points of its path), allocated nodes what removing changes (`power` the node alone, `pathPower` with the `pathDist` nodes that hang from it, as tree/deallocate with force cuts them; a jewel socket's jewel counts in the nodes leading to it). `perPoint` is pathPower / pathDist: for allocated nodes, the least negative is the cheapest cut. Masteries are listed once per effect; cluster notables and ascendancy nodes are left out. Sorted by power, highest first. `stat` is a stat of the power stat list or any number of the build's output (e.g. TotalDotDPS for damage over time alone; MinionX for the minion's). At the damage over time cap TotalDot, TotalDotDPS, CombinedDPS and FullDPS stop growing and every gain reads 0: `dotCap` then names the capped keys and the per-type DoT keys (ChaosDot, FireDot...: one instance, before the skill's DPS multipliers, not capped) to rank by instead.", z.object({ stat: powerStatName, depth: z.number().int().min(1).max(100).optional().describe("Largest path distance (default 10; a whole tree can outlast the worker timeout)"), limit: z.number().int().min(1).max(2000).optional().describe("Result cap (1-2000)"), offset }), z.looseObject({ stat: z.string(), total: z.number(), offset: z.number(), nodes: z.array(z.looseObject({ id: z.number(), name: z.string(), type: z.string(), allocated: z.boolean(), pathDist: z.number(), power: z.number(), pathPower: z.number().optional(), perPoint: z.number().optional(), defence: z.number().optional() })), dotCap }), ["stat", "depth", "limit", "offset"]),
  compareItem(evalRoute("compare_item", "Is this item an upgrade for the build: what it would change in each slot it fits (default all equipment slots in use), as the Items tab's comparison shows, and the weighted `gain` of each. The item is a stored one (`item`), pasted text (`text`) or one trade listing (`listing`: the `item` object of a trade fetch answer, or its whole result entry { id, item, listing }, read by the same conversion trade.search uses; its item text is answered as `text`); give exactly one. `gain` is the weighted change x1000 against what is in that slot now, the measure jewel_mods and trade.search's `score.gain` use (`weights`: default Full DPS 1, Effective Hit Pool 0.5); more than 0 is an upgrade by those weights. Rows are sorted by gain, best first (the slot order breaks ties). A jewel is compared in the socket named by `slot` (Jewel <node id>, or an item's abyssal socket), against the jewel in it now: paste a listing's text to rank it against the current jewel. Radius jewels count what is in their radius. Cluster jewels and jewels that change the tree (timeless, Thread of Hope, Impossible Escape) are equipped for real for the measurement, a cluster with all its passives allocated (`points` is the passive points that costs beyond the current tree), and the build is then loaded back as it was.", z.object({ item: evalItemRef, text: evalItemText, listing: z.record(z.string(), z.unknown()).refine((l) => JSON.stringify(l).length <= 65_536, "a listing is at most 64 KB of JSON").optional().describe("One trade listing: the `item` object of a trade fetch answer, or its whole result entry (instead of `item` or `text`)"), slot: itemSlot.optional(), weights: tradeWeights, fields: evalFields }), z.looseObject({ text: z.string().optional().describe("The item text that was compared (when the input was a `listing`)"), dotCap, slots: z.array(changedStats.extend({ slot: z.string(), equipped: z.string().nullable(), gain: z.number().describe("Weighted change x1000 against what is in the slot now"), points: z.number().optional().describe("Passive points spent beyond the current tree (equipped-for-real comparisons)") })) }), ["item", "text", "slot", "weights", "fields"])),
  tradeLinked(evalRoute(
    "jewel_mods",
    "Rank the mods a jewel can have for this build, the way Path of Building's trade search weighs them (TradeQueryGenerator): each mod alone on a blank jewel in the socket, weighed by the stat weights (default Full DPS 1, Effective Hit Pool 0.5); `gain` is that weighted change x1000 against the socket empty and `weight` is gain per point of the mod's value, which is what the search sums. Each mod is tested at min + (max - min) x quality over its range across all tiers (Path of Building's Item Affix Quality, default 0.5). Where Path of Building's mod data has more than one entry for a trade stat, the one a base of the family rolls is used (then the widest range), so the answer is the same on every run; mods no base of the family rolls are listed with `rollable: false` and kept out of sets. Families: base and abyss (explicit mods, plus corrupted implicits unless includeCorrupted is false), watchers_eye, and cluster (the notables a cluster of that size and enchant can roll, each added to the tree alone, as the generator weighs Megalomaniac's). Unique jewels: unique_rank with a Jewel slot. `combinations` are the best legal sets (at most two prefixes and two suffixes, distinct mod groups, a base that rolls them all; clusters: up to 1, 2 or 3 notables for small, medium and large), each measured together on one test jewel (`estimate` is the sum of the parts). `query` is the trade search Path of Building builds (weighted sum group with its minimum, league status, mirrored and price filters; for clusters its base, the enchant and item level); the trade site refuses that weighted sum group from a search without login, so `search` is the body to pass to trade.search: a count group asking for at least 2 (a cluster's notables: 1) of the 4 heaviest stats (one stat once, stats that count against the build left out) with the same filters, cheapest first; give trade.search `buildId` to rank the listings by the full weights; `weightedSearch` is Path of Building's own body for `query` (its weighted sum group, sorted by it), for trade.search when the server's signed-in browser tab is configured (transport browser). `link` (with `league`) is Path of Building's own link form, https://www.pathofexile.com/trade/search/<league>/<gzip+base64url query>: it is made with no request, and it is unverified until someone opens one by hand. Calculation only; nothing is sent anywhere (`trade.search` runs `search` on request).",
    z.object({
      family: z.enum(["base", "abyss", "watchers_eye", "cluster"]).describe("Jewel family"),
      socket: z.union([z.number().int().positive(), z.string().trim().min(1).max(60)]).optional().describe("Tree socket node id or slot name (Jewel <node id>, or an item's abyssal socket slot); default the first allocated empty tree socket the jewel fits. Not used for cluster"),
      size: z.enum(["Small", "Medium", "Large"]).optional().describe("Cluster size (cluster only)"),
      enchant: z.string().trim().min(1).max(100).optional().describe("Cluster enchant by its name in the Items tab, e.g. Fire Damage, Life (cluster only)"),
      weights: tradeWeights,
      quality: z.number().min(0).max(1).optional().describe("Where in each mod's range it is tested (default the Item Affix Quality, 0.5)"),
      includeCorrupted: z.boolean().optional().describe("Weigh corrupted implicits too (default true, as the popup)"),
      includeMirrored: z.boolean().optional().describe("Allow mirrored items in the search (default true, as the popup)"),
      limit,
      combinations: z.number().int().min(0).max(20).optional().describe("How many mod sets (default 5)"),
      league: tradeLeague.optional().describe("Trade league for the link: the server's configured trade league (POB_API_TRADE_LEAGUE), the one being played; another league is refused (default: that league; none configured and none given: no link)"),
      realm: z.enum(["pc", "xbox", "sony"]).optional().describe("Default pc"),
      tradeType: z.enum(["securable", "available", "onlineleague", "online", "any"]).optional().describe("Listing status, the popup's list: securable = instant buyout (default), available = instant buyout and in person, onlineleague = in person (online in league), online = in person (online), any = includes offline"),
      maxPrice: z.number().positive().max(1e6).optional().describe("Price cap"),
      priceCurrency: z.enum(["chaos", "divine", "alch", "alt", "chrome", "exalted", "blessed", "chisel", "gcp", "jewellers", "scour", "regret", "fusing", "chance", "regal", "vaal"]).optional().describe("Currency of maxPrice (default chaos equivalent)"),
      minItemLevel: z.number().int().min(1).max(100).optional().describe("Cluster only: lowest item level (notables need their `level`)"),
    }),
    z.looseObject({
      family: z.string(),
      socket: z.string().optional(),
      size: z.string().optional(),
      enchant: z.string().optional(),
      category: z.string(),
      total: z.number(),
      mods: z.array(z.looseObject({ id: z.string().describe("Trade stat id"), text: z.string().nullable(), weight: z.number(), gain: z.number(), affix: z.string().nullable().optional() })),
      combinations: z.array(z.looseObject({ mods: z.array(z.string()), gain: z.number(), estimate: z.number() })),
      query: z.looseObject({ stats: z.array(z.unknown()) }).nullable(),
      search: z.looseObject({ query: z.unknown(), sort: z.unknown() }).nullable(),
      link: z.string().nullable(),
      queryError: z.string().nullable(),
    }),
    ["family", "socket", "size", "enchant", "weights", "quality", "includeCorrupted", "includeMirrored", "limit", "combinations", "league", "realm", "tradeType", "maxPrice", "priceCurrency", "minItemLevel"],
  ), false),
  tradeLinked(evalRoute(
    "item_mods",
    "Rank the mods a gear slot can have for this build, the way Path of Building's Trade tab \"Find best\" weighs them for that slot (TradeQueryGenerator), the same weighing as jewel_mods: each mod alone on a blank item of the base in the slot, weighed by the stat weights (default Full DPS 1, Effective Hit Pool 0.5); `gain` is that weighted change x1000 against the slot with a blank item, `weight` is gain per point of the mod's value (what the search sums), `kind` is where the generator found the mod (Explicit, Implicit, Corrupted, Enchant, Scourge, Eater, Exarch), `text` the mod at the tested value (min + (max - min) x quality over its range for the slot's category). Where Path of Building's mod data has more than one entry for a trade stat, the widest range is used (then the key), so the answer is the same on every run. The slot must hold an item: the generator takes the item's base (and, for weapons, its category: bow, wand, shield...); an empty slot is refused, because the popup would test an amulet base there. Slots: weapons, armour, amulet, rings, belt and flasks; weapon swap sets and jewels are not (jewels: jewel_mods). Options are the popup's, and one a slot's popup does not show is refused with the slot named: includeTalisman (Amulet), includeEldritch (Body Armour, Helmet, Gloves, Boots, Amulet; Copy Current by default), includeScourge (only with league Standard or Hardcore, then on by default, as the popup), sockets (all but flasks), links (all but flasks, belt, rings, amulet), requiredMods and blockedMods (the popup's stat rows, at most 5 each). Enchant and anoint behaviour only changes the listings found, not the search, and is not offered. `query` is the trade search Path of Building builds (weighted sum group with its minimum, half what the current item gains, league status and the filters); the trade site refuses that weighted sum group from a search without login, so `search` is the body to pass to trade.search: a count group asking for at least 2 of the 4 heaviest stats (one stat once, stats that count against the build left out) with the same filters, cheapest first; give trade.search `buildId` to rank the listings by the full weights; `weightedSearch` is Path of Building's own body for `query` (its weighted sum group, sorted by it), for trade.search when the server's signed-in browser tab is configured (transport browser); `link` (with `league`) Path of Building's own link form. Calculation only; nothing is sent anywhere.",
    z.object({
      slot: z.enum(["Weapon 1", "Weapon 2", "Helmet", "Body Armour", "Gloves", "Boots", "Amulet", "Ring 1", "Ring 2", "Ring 3", "Belt", "Flask 1", "Flask 2", "Flask 3", "Flask 4", "Flask 5"]).describe("Gear slot, holding an item"),
      weights: tradeWeights,
      quality: z.number().min(0).max(1).optional().describe("Where in each mod's range it is tested (default the Item Affix Quality, 0.5)"),
      includeCorrupted: z.boolean().optional().describe("Weigh corrupted implicits too (default true, as the popup)"),
      includeMirrored: z.boolean().optional().describe("Allow mirrored items in the search (default true, as the popup)"),
      includeScourge: z.boolean().optional().describe("Weigh scourge mods (needs league Standard or Hardcore, where the popup shows it; default true there)"),
      includeTalisman: z.boolean().optional().describe("Amulet only: weigh talisman enchants (default false, as the popup)"),
      includeEldritch: z.enum(["Copy Current", "Keep regular", "Keep regular+presence", "Remove"]).optional().describe("Body Armour, Helmet, Gloves, Boots, Amulet only: eldritch implicits, as the popup's list (default Copy Current: not weighed)"),
      sockets: z.number().int().min(1).max(6).optional().describe("Empty sockets wanted (not flasks)"),
      links: z.number().int().min(1).max(6).optional().describe("Links wanted (not flasks, belt, rings, amulet)"),
      maxLevel: z.number().int().min(1).max(100).optional().describe("Highest required level"),
      requiredMods: z.array(z.object({ id: z.string().trim().min(1).max(100).describe("Trade stat id, as in `mods`, or a pseudo stat"), min: z.number().describe("Lowest value") })).max(5).optional().describe("Stats the item must have (the popup's Required Stats)"),
      blockedMods: z.array(z.object({ id: z.string().trim().min(1).max(100).describe("Trade stat id, as in `mods`, or a pseudo stat"), min: z.number().describe("Lowest value that is blocked") })).max(5).optional().describe("Stats the item must not have (the popup's Blocked Stats)"),
      limit,
      league: tradeLeague.optional().describe("Trade league for the link: the server's configured trade league (POB_API_TRADE_LEAGUE), the one being played; another league is refused (default: that league; none configured and none given: no link)"),
      realm: z.enum(["pc", "xbox", "sony"]).optional().describe("Default pc"),
      tradeType: z.enum(["securable", "available", "onlineleague", "online", "any"]).optional().describe("Listing status, the popup's list: securable = instant buyout (default), available = instant buyout and in person, onlineleague = in person (online in league), online = in person (online), any = includes offline"),
      maxPrice: z.number().positive().max(1e6).optional().describe("Price cap"),
      priceCurrency: z.enum(["chaos", "divine", "alch", "alt", "chrome", "exalted", "blessed", "chisel", "gcp", "jewellers", "scour", "regret", "fusing", "chance", "regal", "vaal"]).optional().describe("Currency of maxPrice (default chaos equivalent)"),
    }),
    z.looseObject({
      slot: z.string(),
      item: z.string().describe("Name of the item in the slot"),
      base: z.string().describe("Its base type, the test item's base"),
      category: z.string().describe("The trade category filter, e.g. armour.chest"),
      quality: z.number(),
      weights: z.array(z.looseObject({ stat: z.string(), weight: z.number() })),
      options: z.looseObject({}).describe("The popup options the generator ran with"),
      total: z.number(),
      mods: z.array(z.looseObject({ id: z.string().describe("Trade stat id"), text: z.string().nullable(), weight: z.number(), gain: z.number(), invert: z.boolean(), kind: z.string().nullable(), range: z.looseObject({ min: z.number(), max: z.number() }).optional() })),
      query: z.looseObject({ stats: z.array(z.unknown()) }).nullable(),
      search: z.looseObject({ query: z.unknown(), sort: z.unknown() }).nullable(),
      link: z.string().nullable(),
      queryError: z.string().nullable(),
    }),
    ["slot", "weights", "quality", "includeCorrupted", "includeMirrored", "includeScourge", "includeTalisman", "includeEldritch", "sockets", "links", "maxLevel", "requiredMods", "blockedMods", "limit", "league", "realm", "tradeType", "maxPrice", "priceCurrency"],
  ), false),
  tradeLinked(evalRoute(
    "timeless",
    "Find timeless jewel seeds for this build with the Tree tab's Find Timeless Jewel dialog, driven through its controls (no trade request: its league list is given, not fetched). Search scores every seed of the jewel in the socket (or every socket) by the weights of the passives it would put on the tree: `nodes` names the passives wanted with their weights (as the dialog's search list), `fallback` has Generate weigh every other passive by a stat (e.g. Full DPS, Life, Effective Hit Pool); with `allocatedOnly`, only allocated nodes in the radius count. Results are best first (`total`, the weighted sum), each with its seed, socket and the passives it gives. `search` is the dialog's Open Trade URL search for the best seeds (one stat filter per seed and conqueror, count at least 1), to pass to `trade.search`; `link` is that search on the trade site (with `league`). The dialog's own settings in the build are put back, so nothing changes. Calculation only; nothing is sent anywhere.",
    z.object({
      jewel: z.string().trim().min(1).max(40).describe("Jewel type, by name or one unique part: Glorious Vanity, Lethal Pride, Brutal Restraint, Militant Faith, Elegant Hubris, Heroic Tragedy, or an abyss timeless jewel"),
      conqueror: z.string().trim().min(1).max(60).optional().describe("Conqueror (keystone), by name or one unique part; default Any"),
      socket: z.union([z.number().int().positive(), z.string().trim().min(1).max(20)]).optional().describe("Socket node id, or Jewel <id>; default every socket"),
      nodes: z.array(z.object({
        node: z.string().trim().min(1).max(100).describe("Passive the jewel gives, by its id (e.g. karui_notable_add_strength) or name, as the dialog's node list"),
        weight: z.number().min(0).max(1000).optional().describe("Weight of its first stat (default 1)"),
        weight2: z.number().min(0).max(1000).optional().describe("Weight of its second stat (default 0)"),
        minimum: z.number().min(0).max(100000).optional().describe("Lowest total weight from this passive a seed must reach (default 0)"),
      })).max(40).optional(),
      fallback: z.string().trim().min(1).max(60).optional().describe("Stat to weigh every other passive by, as the Fallback Weight Mode list names it without 'Sort by ' (e.g. Full DPS)"),
      minimumTotal: z.number().min(0).max(1e9).optional().describe("Lowest total weight shown"),
      allocatedOnly: z.boolean().optional().describe("Count only allocated nodes in the radius (the dialog's socket filter)"),
      limit,
      league: tradeLeague.optional().describe("Trade league for the link: the server's configured trade league (POB_API_TRADE_LEAGUE), the one being played; another league is refused (default: that league; none configured and none given: no link)"),
      realm: z.enum(["pc", "xbox", "sony"]).optional().describe("Default pc"),
    }),
    z.looseObject({
      jewel: z.string(),
      conqueror: z.string().nullable(),
      count: z.number(),
      results: z.array(z.looseObject({ seed: z.number(), total: z.number(), socket: z.looseObject({ id: z.number(), label: z.string() }).nullable(), nodes: z.array(z.looseObject({ id: z.string(), name: z.string(), targets: z.array(z.string()) })) })),
      query: z.looseObject({ stats: z.array(z.unknown()) }).nullable(),
      search: z.looseObject({ query: z.unknown(), sort: z.unknown() }).nullable(),
      link: z.string().nullable(),
    }),
    ["jewel", "conqueror", "socket", "nodes", "fallback", "minimumTotal", "allocatedOnly", "limit", "league", "realm"],
  ), false),
  evalRoute("gem_rank", "Rank gems for a socket group with the gem box's own calculation: the stat with each candidate in that position, highest first (value is the stat itself, `base` is without the gem).", z.object({ group: groupRef, gem: gemRef.optional().describe("Position the candidate goes into (default one past the last gem)"), stat: powerStatName.describe("FullDPS, CombinedDPS, TotalDPS, AverageDamage, TotalDot, BleedDPS, IgniteDPS, TotalPoisonDPS or TotalEHP"), support: z.boolean().optional().describe("Only support gems (default true); false adds active gems with global effects"), limit }), z.looseObject({ stat: z.string(), base: z.number(), total: z.number(), gems: z.array(z.looseObject({ name: z.string(), value: z.number() })) }), ["group", "gem", "stat", "support", "limit"]),
  evalRoute("anoint_rank", "Rank notables to anoint an item with, by the stat gained (the Anoint popup's sort). Name the item by id or by the slot it is in. `power` is against the item with no anoint (as the popup measures), not against the build as it is: an item anointed already (`current`) shows its own anoint at full value, and equipping that anoint again gains nothing.", z.object({ item: evalItemRef, slot: itemSlot.optional(), stat: powerStatName, limit }), z.looseObject({ stat: z.string(), total: z.number(), current: strings, notables: z.array(z.looseObject({ name: z.string(), power: z.number() })) }), ["item", "slot", "stat", "limit"]),
  evalRoute("unique_rank", "Rank the uniques that fit a slot by the stat with the unique equipped (the unique list's sort by stat; power is the stat's value, best slot). Slot Jewel measures one tree socket, `socket` (node id or Jewel <id>) or by default the first allocated empty one (every socket, as the list does, only when none is empty; `socket` null then).", z.object({ slot: itemSlot, stat: powerStatName, limit, socket: z.union([z.number().int(), z.string().max(40)]).optional().describe("Slot Jewel: the tree socket to measure in") }), z.looseObject({ stat: z.string(), total: z.number(), socket: z.string().nullable(), uniques: z.array(z.looseObject({ name: z.string(), power: z.number() })) }), ["slot", "stat", "limit", "socket"]),
  evalRoute("compare_specs", "What switching from one tree to another changes (b against a; a is the active tree by default).", z.object({ a: specIndex.optional().describe("Tree number to start from (default the active tree)"), b: specIndex, fields: evalFields }), changedStats, ["a", "b", "fields"]),
  evalRoute("compare_item_sets", "What switching from one item set to another changes (b against a; a is the active set by default).", z.object({ a: setIndex.optional().describe("Item set number to start from (default the active set)"), b: setIndex.describe("Item set number to compare, from 1"), fields: evalFields }), changedStats, ["a", "b", "fields"]),
  extended(route<typeof compareBuildsInput, { id: string }>({
    name: "evaluate.compare_builds",
    domain: "evaluate",
    method: "POST",
    path: "/v1/evaluate/:id/compare-builds",
    summary: "What differs between this build and another build: this build's stats as before, the other's as after.",
    input: compareBuildsInput,
    output: changedStats,
    readOnly: true,
    workerOp: "stats.sidebar (stats.output with `fields`) on each build, diffed by the server",
    run: (svc, i) => svc.compareBuilds(i.id, i.other, i.fields),
  }), { id: buildId }),
  withOther(evalRoute("compare_power", "The Compare tab's power report against another build: what each passive the other build has and this one lacks, each item it wears, each skill group and support gem of its main skill it adds, and each config option it sets differently would change on this build, one at a time, best first. `impact` is the change in the stat (`percent` of this build's value); passives also give `pathDist` and `perPoint`.", z.object({ stat: z.string().trim().min(1).max(60).optional().describe("Power stat by its label (default Full DPS), e.g. Life, Effective Hit Pool"), categories: z.object({ tree: z.boolean().optional(), items: z.boolean().optional(), gems: z.boolean().optional(), supports: z.boolean().optional(), config: z.boolean().optional() }).optional().describe("Which parts to measure (default all)"), limit }), z.looseObject({ other: z.string(), stat: z.string(), total: z.number(), results: z.array(z.looseObject({ category: z.string(), name: z.string(), impact: z.number(), percent: z.number() })) })), ["stat", "categories", "limit"]),

  // trade
  route({
    name: "trade.search",
    domain: "trade",
    method: "POST",
    path: "/v1/trade/search",
    summary: "Run trade searches on the official trade site now and answer their first listings, each read by Path of Building's own trade conversion and, with `buildId`, scored for the build in its slot (`score.gain`: the weighted change x1000 against what is there now, as jewel_mods and the trade search weigh; sorted by it). Takes complete search definitions, never one filtering by seller account (refused, 400); on the direct transport (no login) a weighted sum group of 3 or more stats is refused too (400, before anything is sent), as the site refuses it from a search without login (the `search` of jewel_mods or item_mods, or any query the trade site takes). Each search answers the site's `complexity` for the query when the site gives it. League: the server's configured trade league (POB_API_TRADE_LEAGUE), the one being played; `league` may be left out, and another league (Standard, Hardcore, SSF, Ruthless included) is refused unless the setting names it; before the call's first search the league is checked against the trade site's list for the realm (one `leagues` request, cached an hour) and a league that is no longer listed fails the call naming it and the listed current one. Transport (`transport` in the answer): with POB_API_TRADE_BROWSER_CDP and POB_API_TRADE_BROWSER_TAB set, each search and listing fetch runs as a same-origin request in that one signed-in tab of the server's browser, which adds its session itself (the site's signed-in complexity budget and its Account limits, read and paced like the others; the browser's own client string); nothing here reads a cookie or credential, and no other tab is used, opened, closed or navigated; a tab that is gone, off the trade site, or answered 401 or 403 stops the call (`sign in again in the server browser`), never falling back to the direct path; unset: straight to the site without login. The leagues and the rates are always asked directly. Limits: Path of Building's own request shapes (search, then fetch in blocks of 10) and its client string marked as this fork's API (`Path of Building/<version> (api; fork)`, with the operator's contact when configured), the host fixed, no account, session or cookie; at most 8 searches per call and 30 listings per search; nothing repeats a search by itself (a caller may call again, reading `limiter`); one limiter for the whole server paces at half of every window the site states, a quarter for `priority: background`, which is refused rather than kept waiting; a 429 or any 4xx stops the call (`stopped`, with the status and the site's rate-limit and Retry-After headers) and nothing is retried, the client string never changed to retry; the same search within 10 minutes is answered from a cache and sends nothing. No seller names or whispers are answered; nothing is sent to a seller. `link` is the search on the trade site (PoB's own link form; unverified until someone opens one by hand). `order` is the Trade tab's sort of each search's listings: `site` (the site's order, the default without a build), `gain` (the default with `buildId`), `price` (cheapest in divines first) or `gainPrice` (gain less 0.1 x log10 of the price in divines, as Path of Building's Stat Value / Price); the price orders ask `trade.currency_rates` (its hour's cache, or its two requests) before the first search, give each listing `divines`, and a search with a listing the rates do not price falls back to gain (site without a build) with a warning, as Path of Building does. `total` is the Trade tab's Total Price: the first listing of each search summed per currency, most valuable first, and in divines when every currency has a rate (with one search per slot, the price of the best item for every slot).",
    input: z.object({
      league: tradeLeague.optional().describe("Trade league: the server's configured trade league (POB_API_TRADE_LEAGUE), the one being played; another league is refused (default: that league; unset on the server: refused with 501 unsupported)"),
      realm,
      priority: z.enum(["interactive", "background"]).optional().describe("interactive (default): a person asking now, waits for the pace up to 60 s; background: a watched search, refused at once when the budget is short"),
      searches: z.array(z.object({
        query: tradeQuery.describe("The trade site's `query` object (status, stats, filters)"),
        sort: z.record(z.string().min(1).max(60), z.enum(["asc", "desc"])).refine((r) => Object.keys(r).length <= 4, "at most 4 sort keys").optional().describe("Default { price: asc }"),
        engine: z.literal("new").optional().describe("Accepted so jewel_mods' search can be passed as is"),
        slot: itemSlot.optional().describe("Slot each listing is scored in (default: the first slot in use it fits; a jewel the first empty socket)"),
        listings: z.number().int().min(1).max(30).optional().describe("Listings to fetch (1-30, default 10)"),
      })).min(1).max(8),
      buildId: buildId.optional().describe("Score each listing for this build"),
      order: z.enum(["site", "gain", "price", "gainPrice"]).optional().describe("Sort of each search's listings (default gain with buildId, else site); gain and gainPrice need buildId"),
      weights: tradeWeights,
      fields: evalFields,
    }),
    output: z.looseObject({
      searches: z.array(z.looseObject({
        searchId: z.string().describe("Empty when the site found nothing and gave no id"),
        total: z.number(),
        complexity: z.number().nullable().describe("The site's complexity of the query, null when it gave none"),
        cached: z.boolean(),
        order: z.enum(["site", "gain", "price", "gainPrice"]).describe("The order used (a price order falls back when a listing has no rate)"),
        link: z.string().nullable().describe("null when the search has no id"),
        listings: z.array(z.looseObject({
          id: z.string().describe("Listing id, stable across searches"),
          price: z.looseObject({ amount: z.number(), currency: z.string(), type: z.string() }).nullable(),
          divines: z.number().nullable().optional().describe("The price in divines (price orders only; null when the currency has no rate)"),
          indexed: z.string().nullable().describe("When the listing was posted or last changed"),
          text: z.string().nullable(),
          score: changedStats.extend({ slot: z.string(), gain: z.number(), points: z.number().optional() }).nullable(),
          error: z.string().optional(),
        })),
      })),
      complete: z.boolean().describe("Every search ran; false when the call stopped early (notRun, stopped and a warning say how many, why and when to try again)"),
      notRun: z.number().describe("Searches not run because the call stopped"),
      transport: z.enum(["browser", "direct"]).describe("browser: the searches and fetches ran in the server's signed-in browser tab (POB_API_TRADE_BROWSER_CDP and _TAB); direct: straight to the site, without login"),
      stopped: z.looseObject({ code: z.string(), message: z.string(), status: z.number().optional(), retryAfterSeconds: z.number().optional() }).nullable(),
      total: z.object({
        prices: z.array(z.object({ currency: z.string(), amount: z.number() })).describe("The first listing of each search, summed per currency, most valuable first"),
        divines: z.number().nullable().describe("The same in divines (price orders, when every currency has a rate)"),
      }).nullable().describe("The Trade tab's Total Price (null when the call stopped before any search)"),
      rates: z.object({ hour: z.number(), cached: z.boolean() }).nullable().describe("The currency rates used (price orders): their exchange hour, and whether they came from the cache"),
      limiter: limiterState,
    }),
    readOnly: true,
    workerOp: "evaluate.listings (after the trade site's search and fetch)",
    run: (s, i) => s.tradeSearch({ ...i, realm: i.realm ?? "pc", priority: i.priority ?? "interactive", searches: i.searches.map((q) => ({ query: q.query, sort: q.sort, slot: q.slot, listings: q.listings ?? 10 })) }),
  }),
  route({
    name: "trade.currency_rates",
    domain: "trade",
    method: "GET",
    path: "/v1/trade/currency-rates",
    summary: "The currency rates of the trade league as Path of Building's Trade tab prices listings (TradeQuery:PullCXData, run in the worker on the two answers): divines per one of each currency, by the trade site's short id (chaos, exalted, ...; divine is 1), each from the currency exchange's pair with the most stock in the last complete hour, priced at that hour's traded volumes (the fork's one change to PullCXData's input: its `lowest_ratio` is one outlying order, so a pair with nothing traded is not priced), chaos pairs converted at the chaos rate. League: the server's configured trade league (POB_API_TRADE_LEAGUE) only, as `trade.search`; another is refused, none configured is 501. Limits: on request only (nothing asks by itself), exactly Path of Building's two downloads (https://www.pathofexile.com/api/trade/data/static and https://web.poecdn.com/api/currency-exchange[/<realm>]/<hour>), each host asked at most once an hour (the answer is cached an hour, `cached`; a request inside the hour, a failed one included, is refused with its retry time), the fork's client string and nothing else sent, no account or cookie, its own policies in the one limiter all trade requests share (`limiter`), a 429 or any 4xx stops with the status and the rate-limit and Retry-After headers and nothing is retried. A league the exchange has no traded markets for in that hour fails naming the league and hour.",
    input: z.object({
      league: tradeLeague.optional().describe("Trade league: the server's configured one; another is refused"),
      realm,
      priority: z.enum(["interactive", "background"]).optional().describe("interactive (default): waits for the pace up to 60 s; background: refused at once when the budget is short"),
    }),
    output: z.looseObject({
      realm: z.string(),
      league: z.string(),
      hour: z.number().describe("The exchange hour the rates are from (unix seconds)"),
      rates: z.record(z.string(), z.number()).describe("Divines per one of each currency, by the trade site's short id"),
      cached: z.boolean().describe("Served from the hour's cache: nothing was sent"),
      limiter: limiterState,
    }),
    readOnly: true,
    workerOp: "lookup.currency_rates (after the trade site's static data and the exchange hour)",
    run: (s, i) => s.currencyRates({ realm: i.realm ?? "pc", priority: i.priority ?? "interactive", ...(i.league === undefined ? {} : { league: i.league }) }),
  }),
  route({
    name: "trade.leagues",
    domain: "trade",
    method: "GET",
    path: "/v1/trade/leagues",
    summary: "The trade leagues of a realm as Path of Building's Trade tab lists them, asked of the official trade site now: the leagues that are not permanent first in the site's order, then Standard, Hardcore, Ruthless and Hardcore Ruthless (those the site lists for the realm). `current` is the softcore trade league being played: the first league that is not permanent and has none of Hardcore, HC, Ruthless or SSF as a word in its name; it is null when the site lists none. It is how to find the name to set as POB_API_TRADE_LEAGUE (searches and links are made for that league only). Limits: on request only (nothing asks by itself), the answer cached for an hour per realm (`cached`, and a failed request is not cached), the host fixed, Path of Building's client string, no account, session or cookie; it has its own policy in the one limiter all trade requests share (`limiter`), paced as `trade.search`, `priority: background` refused rather than kept waiting; a 429 or any 4xx is an error with the site's Retry-After and nothing is retried.",
    input: z.object({
      realm,
      priority: z.enum(["interactive", "background"]).optional().describe("interactive (default): a person asking now, waits for the pace up to 60 s; background: refused at once when the budget is short"),
    }),
    output: z.looseObject({
      realm: z.string(),
      leagues: strings.describe("Not permanent leagues in the site's order, then the permanent ones the site lists"),
      current: z.string().nullable().describe("The softcore trade league being played; null when the site lists none"),
      cached: z.boolean().describe("Served from the hour's cache: nothing was sent"),
      limiter: limiterState,
    }),
    readOnly: true,
    workerOp: "(trade site)",
    run: (s, i) => s.tradeLeagues({ realm: i.realm ?? "pc", priority: i.priority ?? "interactive" }),
  }),

  // lookup
  lookupRoute("gems", "/v1/lookup/gems", "Search gems by name and tag, with requirements at a level (`level` defaults to each gem's natural maximum). `requirements` is absent at a `level` the game data has no row for: some gems list levels only up to `naturalMaxLevel` (Convocation stops at 1). A query ending in \"Support\" matches without it and the gem named exactly comes first. `reservation`, `cost` and `stats` are the level's reservation, its cost per use (`Mana`, `Life`, ...; banners cost mana and reserve nothing in 3.30) and the gem's own stat lines at that level. `legacy` marks gems Path of Building keeps as legacy (the Awakened supports in 3.30): the gem box, and so skills.set_gem, takes them only with skills.set_options showLegacyGems; skills.add_group takes them as pasted text does.", z.object({ query: z.string().max(100).optional(), tag: z.string().max(50).optional(), support: z.boolean().optional(), level: z.number().int().min(1).max(40).optional(), limit, offset }), pageOf("gems", z.looseObject({ id: z.string(), name: z.string(), support: z.boolean(), tags: strings, tagString: z.string().optional(), naturalMaxLevel: z.number().optional(), legacy: z.boolean(), description: z.string().optional(), cost: z.record(z.string(), z.number()).optional().describe("At `level`: the cost per use by resource"), reservation: z.record(z.string(), z.number()).optional().describe("At `level`: manaReservationPercent, manaReservationFlat, life..., and manaMultiplier (a support's cost and reservation multiplier, %)"), stats: strings.optional().describe("The gem's own stats at `level` as the game words them (aura effects, more multipliers); stats scaled by damage effectiveness are left out"), requirements: z.looseObject({ gemLevel: z.number(), level: z.number(), str: z.number(), dex: z.number(), int: z.number() }).optional() })), ["query", "tag", "support", "level", "limit", "offset"]),
  lookupRoute("uniques", "/v1/lookup/uniques", "Search uniques by name or by a line of their text.", z.object({ query: z.string().max(100).optional(), text: z.string().max(200).optional(), limit, offset }), pageOf("uniques", z.looseObject({ name: z.string(), title: z.string().optional(), base: z.string().optional(), type: z.string().optional(), variants: z.number().optional(), text: z.string() })), ["query", "text", "limit", "offset"]),
  lookupRoute("bases", "/v1/lookup/bases", "Search item bases by name and type.", z.object({ query: z.string().max(100).optional(), type: z.string().max(50).optional(), limit, offset }), pageOf("bases", z.looseObject({ name: z.string() })), ["query", "type", "limit", "offset"]),
  lookupRoute("nodes", "/v1/lookup/nodes", "Search passive tree nodes by name or stat text (the tree search box).", z.object({ query: z.string().min(1).max(200), type: z.string().max(30).optional().describe("Normal, Notable, Keystone, Mastery, Socket, ..."), limit, offset }), z.looseObject({ total: z.number(), offset: z.number(), treeVersion: z.string(), nodes: z.array(nodeDetail) }), ["query", "type", "limit", "offset"]),
  lookupRoute("node", "/v1/lookup/nodes/:nodeId", "One passive node: stats, links, path length from the current tree, mastery effects.", z.object({ nodeId: z.number().int().min(0) }), nodeDetail.extend({ linked: z.array(z.number()), pathLength: z.number().optional(), reminderText: z.unknown().optional(), flavourText: z.unknown().optional(), masteryEffects: z.array(z.looseObject({ effect: z.number(), stats: strings })).optional(), selectedMasteryEffect: z.number().optional() }), (i) => ({ id: i.nodeId })),
  lookupRoute("config", "/v1/lookup/config", "The configuration option catalogue: type, section, allowed values, current value; `var` adds the tooltip.", z.object({ section: z.string().max(100).optional(), query: z.string().max(100).optional(), var: z.string().max(100).optional(), relevantOnly: z.boolean().optional().describe("Only options that apply to this build"), offset, limit }), pageOf("options", z.looseObject({ var: z.string(), type: z.string().optional(), label: z.string(), section: z.string().optional(), current: z.unknown().optional(), placeholder: z.unknown().optional(), relevant: z.boolean().optional(), allowed: z.array(z.looseObject({ value: z.unknown(), label: z.string() })).optional(), default: z.unknown().optional(), tooltip: z.string().optional() })), ["section", "query", "var", "relevantOnly", "offset", "limit"]),
  lookupRoute("data", "/v1/lookup/data/:table", "Page through one of Path of Building's own game-data tables: rare_templates, bench_crafts, essences, veiled, necropolis, beastcraft, delve, incursion, fossil (the crafting lists of the Items tab), enchantments, cluster_notables, anoint_recipes, keystones, pantheons, map_mods, minions, spectres, bosses, timeless (one row per timeless jewel type: seed range as written on the item, conquerors, the keystone each names, radius). Rows are flat and sorted by name; `query` matches a row's name or any of its text lines (case-insensitive); `slot` narrows enchantments to one item group (UtilityFlask for flasks); `itemType` narrows bench_crafts to the crafts an item type takes. Tree tables (anoint_recipes, keystones) read the tree of `buildId`, else the latest.", z.object({ table: z.enum(["rare_templates", "bench_crafts", "essences", "veiled", "necropolis", "beastcraft", "delve", "incursion", "fossil", "enchantments", "cluster_notables", "anoint_recipes", "keystones", "pantheons", "map_mods", "minions", "spectres", "bosses", "timeless"]), query: z.string().max(100).optional(), slot: z.enum(["Belt", "Body Armour", "Boots", "Gloves", "Helmet", "UtilityFlask", "Weapon"]).optional().describe("enchantments only: the item group a row is for"), itemType: z.string().trim().min(1).max(50).optional().describe("bench_crafts only: an item type the craft takes (a key of its `types`, e.g. Ring, Body Armour, Two Handed Sword)"), limit, offset }), z.looseObject({ table: z.string(), total: z.number(), offset: z.number(), rows: z.array(z.looseObject({ name: z.string() })) }), ["table", "query", "slot", "itemType", "limit", "offset"]),
  lookupRoute("mods_for_base", "/v1/lookup/mods-for-base", "The mods a rare item of a base can roll, as the affix boxes of the Items tab list them: those the base can have with a spawn weight above 0, at most the item level (default 100), sorted by type, group, level. `influence` adds the mods of an influence the base can take (Shaper, Elder, Warlord, Hunter, Crusader, Redeemer, Searing Exarch, Eater of Worlds); `none` is no influence; Searing Exarch and Eater of Worlds add their eldritch implicits (type Exarch or Eater, as the Add Implicit popup lists them), which `type` Prefix or Suffix leaves out; `query` matches the mod text.", z.object({ base: z.string().trim().min(1).max(200).describe("Base type name, e.g. Vaal Regalia"), ilvl: z.number().int().min(1).max(100).optional().describe("Item level (default 100)"), type: z.enum(["Prefix", "Suffix"]).optional(), influence: z.string().trim().min(1).max(50).optional(), query: z.string().max(100).optional(), limit, offset }), z.looseObject({ base: z.string(), ilvl: z.number(), total: z.number(), offset: z.number(), mods: z.array(z.looseObject({ name: z.string(), id: z.string(), type: z.string(), affix: z.string().optional(), level: z.number(), group: z.string().optional(), weight: z.number(), lines: strings })) }), ["base", "ilvl", "type", "influence", "query", "limit", "offset"]),
  route({
    name: "lookup.parse_mod",
    domain: "lookup",
    method: "POST",
    path: "/v1/lookup/parse-mod",
    summary: "What the calculator makes of mod lines: per line the mods it parses to (name, type, value, flags, keywordFlags, tags) and any text it could not read; `supported` is true when the whole line was read. Nothing is stored.",
    input: z.object({ lines: z.array(z.string().max(500)).min(1).max(50) }),
    output: z.looseObject({ lines: z.array(z.looseObject({ line: z.string(), mods: z.array(z.looseObject({ name: z.string(), type: z.string(), value: z.unknown(), flags: z.number(), keywordFlags: z.number(), tags: z.array(z.unknown()) })), extra: z.string().nullable(), supported: z.boolean() })) }),
    readOnly: true,
    workerOp: "lookup.parse_mod",
    run: (svc, i) => svc.read(undefined, "lookup.parse_mod", pick(i, ["lines"])),
  }),
  route({
    name: "lookup.trade_stats",
    domain: "lookup",
    method: "POST",
    path: "/v1/lookup/trade-stats",
    summary: "The trade site's stat ids for mod lines, as Path of Building's Buy similar popup finds them: per line `ids` (the trade stat ids, with the stat group `type` as their prefix; more than one when the text fits several stats), `value` (the number the popup puts in the filter; a timeless jewel line gives `explicit.pseudo_timeless_jewel_<conqueror>` and its count), `option` (the choice, for a stat the site offers as a choice), `inverted` (the filter takes the value negated, e.g. a `reduced` line of an `increased` stat) and `found` (false when no stat matches; the id is also dropped when the site's stat list has no such stat). Nothing is stored and nothing is sent.",
    input: z.object({ lines: z.array(z.string().max(500)).min(1).max(50), type: z.enum(["explicit", "implicit", "enchant", "crafted", "fractured", "scourge", "pseudo"]).optional().describe("The stat group, as the popup's rows name it (default explicit)") }),
    output: z.looseObject({ type: z.string(), lines: z.array(z.looseObject({ line: z.string(), ids: strings, value: z.number().nullable(), option: z.union([z.number(), z.string()]).optional(), inverted: z.boolean(), found: z.boolean() })) }),
    readOnly: true,
    workerOp: "lookup.trade_stats",
    run: (svc, i) => svc.read(undefined, "lookup.trade_stats", pick(i, ["lines", "type"])),
  }),
  route({
    name: "lookup.describe_stats",
    domain: "lookup",
    method: "POST",
    path: "/v1/lookup/describe-stats",
    summary: "The game text for raw stat values (stat id to number), as the passive tree and gem descriptions are written. `scope` names a description set (default stat_descriptions; the sets the gems use are accepted, others fail). Nothing is stored.",
    input: z.object({ stats: z.record(z.string().min(1).max(100), z.number()).refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 50, "1 to 50 stats"), scope: z.string().min(1).max(100).optional() }),
    output: z.looseObject({ scope: z.string(), lines: strings }),
    readOnly: true,
    workerOp: "lookup.describe_stats",
    run: (svc, i) => svc.read(undefined, "lookup.describe_stats", pick(i, ["stats", "scope"])),
  }),
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
