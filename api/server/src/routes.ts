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
const itemBrief = z.looseObject({ id: z.number(), name: z.string(), baseName: z.string(), rarity: z.string(), type: z.string().optional(), title: z.string().optional(), quality: z.number().optional(), sockets: z.string().optional(), equipped: strings, corrupted: z.boolean() });
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
const configValue = z.union([z.boolean(), z.number(), z.string().max(20000)]);

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
const ascendancyResult = z.looseObject({ ascendancy: z.string() }); // tree set_ascendancy
const bloodlineResult = z.looseObject({ bloodline: z.string() }); // tree set_bloodline
const allocatedResult = z.looseObject({ allocated: z.array(z.number()) }); // tree allocate: the ids asked for, in order
const masteryResult = z.looseObject({ nodeId: z.number(), effectId: z.number() }); // tree set_mastery
const tattoosResult = z.looseObject({ removed: z.number() }); // tree remove_tattoos
const specCount = z.looseObject({ count: z.number() }); // tree spec_new, spec_copy, spec_delete: trees in the list
const activeSpecResult = z.looseObject({ active: z.number() }); // tree spec_activate
const convertResult = z.looseObject({ treeVersion: z.string() }); // tree convert
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
const evalFields = z.array(z.string().trim().min(1).max(100)).max(100).optional().describe("Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats");
const powerStatName = z.string().trim().min(1).max(60).describe("A stat of Path of Building's power stat list, e.g. CombinedDPS, FullDPS, TotalDPS, Life, TotalEHP, Armour, MinionLife (`OffenceDefence` where noted)");
const tradeWeights = z.array(z.object({ stat: powerStatName, weight: z.number().min(0.01).max(1) })).min(1).max(20).optional().describe("Stat weights as the trade popup's list sets them (0.01 to 1 each; default Full DPS 1, Effective Hit Pool 0.5)");
const tradeLeague = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9 '-]*$/, "a league name is letters, digits, spaces, ' and -").max(64);
const tradeQuery = z.looseObject({}).refine((q) => JSON.stringify(q).length <= 32_768, "a query is at most 32 KB of JSON");
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
  route({ name: "build.trash", domain: "build", method: "GET", path: "/v1/builds/trash", summary: "Deleted builds that can still be restored (kept 7 days after deletion).", input: z.object({}), output: z.object({ builds: z.array(meta.extend({ deletedAt: z.string(), purgeAfter: z.string() })) }), readOnly: true, workerOp: "(store)", run: (s) => s.trash() }),
  route({ name: "build.get", domain: "build", method: "GET", path: "/v1/builds/:id", summary: "A build's metadata and summary (class, ascendancy, level, tree version, main skill).", input: z.object({ id: buildId }), output: created, readOnly: true, workerOp: "builds.summary", run: (s, i) => s.get(i.id) }),
  route({ name: "build.rename", domain: "build", method: "POST", path: "/v1/builds/:id/rename", summary: "Rename a build (a new revision).", input: z.object({ id: buildId, name, baseRevision: revision.optional() }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.rename(i.id, { name: i.name, baseRevision: i.baseRevision }) }),
  route({ name: "build.duplicate", domain: "build", method: "POST", path: "/v1/builds/:id/duplicate", summary: "Copy a build into a new build.", input: z.object({ id: buildId, name: name.optional() }), output: created, readOnly: false, workerOp: "builds.load, builds.export", run: (s, i) => s.duplicate(i.id, { name: i.name }) }),
  route({ name: "build.delete", domain: "build", method: "DELETE", path: "/v1/builds/:id", summary: "Delete a build. It stays restorable for 7 days (`restore`), then it and its history are removed.", input: z.object({ id: buildId, baseRevision: revision.optional() }), output: z.object({ deleted: z.string(), restorableDays: z.number() }), readOnly: false, workerOp: "(store)", run: (s, i) => s.delete(i.id, { baseRevision: i.baseRevision }) }),
  route({ name: "build.restore", domain: "build", method: "POST", path: "/v1/builds/:id/restore", summary: "Restore a deleted build with its history.", input: z.object({ id: buildId }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.restore(i.id) }),
  route({ name: "build.revert", domain: "build", method: "POST", path: "/v1/builds/:id/revert", summary: "Make a kept revision current again (as a new revision).", input: z.object({ id: buildId, revision, baseRevision: revision.optional() }), output: z.object({ build: meta }), readOnly: false, workerOp: "(store)", run: (s, i) => s.revert(i.id, { revision: i.revision, baseRevision: i.baseRevision }) }),
  mutateRoute("build", "builds", "settings", "Character level and the Auto/Manual level mode (auto follows points spent).", z.object({ level: z.number().int().min(1).max(100).optional(), autoLevel: z.boolean().optional() }), levelResult, ["level", "autoLevel"], "config.set_level"),
  at(readRoute("build", "loadouts", "loadout_list", "The Loadouts dropdown: trees whose title matches an item set, a skill set and a config set (or share a `{id}` link), the one in use, and the active set of each tab. A tab with a single set matches every tree.", z.object({}), z.looseObject({ loadouts: strings, active: z.string().nullable(), sets: loadoutSets }), [], "loadouts.list"), "/v1/loadouts/:id/list"),
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
  statRoute("warnings", "Build warnings (unmet requirements, over-allocated points, and the like).", z.object({}), z.object({ warnings: z.array(z.string()) })),
  statRoute("defences", "Attribute totals and requirements; resistances with total, overcap and maximum.", z.object({}), z.looseObject({ attributes: z.record(z.string(), z.number()), resistances: z.record(z.string(), z.record(z.string(), z.number())) })),
  statRoute("points", "Passive and ascendancy points used and available, required level.", z.object({}), z.looseObject({ used: z.number().optional(), max: z.number().optional(), ascendancyUsed: z.number().optional(), ascendancyMax: z.number().optional(), secondaryAscendancyUsed: z.number().optional(), jewelSockets: z.number().optional(), requiredLevel: z.number().optional(), act: z.string().optional() })),
  statRoute("versions", "Path of Building version, the build's tree version and the latest tree version.", z.object({}), z.looseObject({ pobVersion: z.string().optional(), latestTreeVersion: z.string().optional(), treeVersion: z.string(), treeVersionDisplay: z.string().optional(), targetVersion: z.string().optional() })),

  // tree
  readRoute("tree", "tree", "get", "The allocated tree: class, ascendancy, bloodline, nodes, masteries, tattoos, jewel sockets, tree list.", z.object({}), z.looseObject({ treeVersion: z.string(), className: z.string(), ascendancy: z.string().optional(), bloodline: z.string().optional(), points: z.number(), ascendancyPoints: z.number(), bloodlinePoints: z.number().optional(), nodes: z.array(nodeBrief), masteries: z.array(z.looseObject({ nodeId: z.number(), effectId: z.number(), stats: strings })), tattoos: z.array(z.looseObject({ nodeId: z.number(), name: z.string(), stats: strings })), jewelSockets: z.array(z.looseObject({ nodeId: z.number(), itemId: z.number() })), specs: z.array(specSummary) })),
  mutateRoute("tree", "tree", "set_class", "Change class. If the tree is not connected to the new start, `onDisconnected` decides: fail (default), reset the tree, or connect it by the shortest path.", z.object({ className: z.string().min(1).max(50).describe("e.g. Shadow"), onDisconnected: z.enum(["fail", "reset", "connect"]).optional() }), classResult, ["className", "onDisconnected"]),
  mutateRoute("tree", "tree", "set_ascendancy", "Change ascendancy (of the current class), or None.", z.object({ ascendancy: z.string().min(1).max(50) }), ascendancyResult, ["ascendancy"]),
  mutateRoute("tree", "tree", "set_bloodline", "Change the secondary ascendancy (bloodline), or None.", z.object({ bloodline: z.string().min(1).max(50) }), bloodlineResult, ["bloodline"]),
  mutateRoute("tree", "tree", "allocate", "Allocate nodes, each with the shortest path to it, as clicking them does.", z.object({ nodes: nodeList }), allocatedResult, ["nodes"]),
  mutateRoute("tree", "tree", "deallocate", "Deallocate nodes and every node that depended on them.", z.object({ nodes: nodeList }), nothing, ["nodes"]),
  mutateRoute("tree", "tree", "reset", "Reset the tree (the Reset Tree button).", z.object({}), nothing),
  readRoute("tree", "tree", "mastery_options", "The effects a mastery node offers and which is selected.", z.object({ nodeId: nodeRef }), z.looseObject({ nodeId: z.number(), name: z.string(), allocated: z.boolean(), effects: z.array(z.looseObject({ effectId: z.number(), stats: strings, selected: z.boolean() })) }), ["nodeId"]),
  mutateRoute("tree", "tree", "set_mastery", "Choose a mastery effect; allocates the mastery if needed.", z.object({ nodeId: nodeRef, effectId: z.number().int().min(0) }), masteryResult, ["nodeId", "effectId"]),
  mutateRoute("tree", "tree", "remove_tattoos", "Remove every tattoo from the tree.", z.object({}), tattoosResult),
  readRoute("tree", "tree", "export_url", "The tree as a passive tree link (pathofexile.com).", z.object({}), z.looseObject({ url: z.string() })),
  mutateRoute("tree", "tree", "import_url", "Add a tree from a passive tree link as a new tree in the list and make it active.", z.object({ url: z.string().url().max(4000), title: title.optional() }), specSummary, ["url", "title"]),
  readRoute("tree", "tree", "path", "Shortest path: without `from`, the nodes allocating `to` would add; with it, the fewest-node route between two nodes.", z.object({ to: nodeRef, from: nodeRef.optional() }), z.looseObject({ length: z.number(), nodes: z.array(nodeBrief) }), ["to", "from"]),
  mutateRoute("tree", "tree", "spec_new", "Add an empty tree to the tree list.", z.object({ title: title.optional() }), specCount, ["title"]),
  mutateRoute("tree", "tree", "spec_copy", "Copy a tree in the tree list.", z.object({ index: specIndex, title: title.optional() }), specCount, ["index", "title"]),
  mutateRoute("tree", "tree", "spec_rename", "Rename a tree in the tree list.", z.object({ index: specIndex, title }), nothing, ["index", "title"]),
  mutateRoute("tree", "tree", "spec_delete", "Delete a tree from the tree list (not the last one).", z.object({ index: specIndex }), specCount, ["index"]),
  mutateRoute("tree", "tree", "spec_activate", "Make a tree in the tree list the active one.", z.object({ index: specIndex }), activeSpecResult, ["index"]),
  mutateRoute("tree", "tree", "convert", "Convert the active tree to another tree version (default the latest); `keepOld` converts a copy.", z.object({ version: treeVersion.optional(), keepOld: z.boolean().optional() }), convertResult, ["version", "keepOld"]),

  // skills
  readRoute("skills", "skills", "get", "The Skills tab: socket groups with their gems and active skills, the main socket group, skill sets and gem options. `mainSocketGroup` is one group number for the whole build, not per skill set (as in Path of Building): it points at the same position in every set.", z.object({}), z.looseObject({ mainSocketGroup: z.number(), groups: z.array(z.looseObject({ index: z.number(), label: z.string(), slot: z.string().optional(), enabled: z.boolean(), includeInFullDPS: z.boolean(), gems: z.array(z.looseObject({ index: z.number(), name: z.string(), level: z.number(), quality: z.number(), enabled: z.boolean(), count: z.number(), support: z.boolean(), error: z.string().optional() })), activeSkills: strings, mainActiveSkill: z.number().optional(), main: z.boolean() })), sets: setList, options: gemOptions, mainOptions: mainOptions, spectres: spectreList })),
  readRoute("skills", "skills", "group_text", "A socket group as Path of Building copies it (paste it back with `add_group`).", z.object({ group: groupRef }), z.looseObject({ text: z.string() }), ["group"]),
  mutateRoute("skills", "skills", "add_group", "Add a socket group from gems or from copy text (the Paste button). Gem names resolve as the gem box does; unknown names fail.", z.object({ text: z.string().min(1).max(20000).optional().describe("Copy format: optional `Label:` and `Slot:` lines, then `<gem> <level>/<quality> [DISABLED] <count>` per line"), gems: z.array(skillGem).min(1).max(12).optional().describe("Gems of the group, in order; a gem without `level` gets the level the `defaultGemLevel` option picks (as a gem added by hand); copy text carries its own levels"), label: groupLabel.optional(), slot: groupSlot.optional() }), groupResult, ["text", "gems", "label", "slot"]),
  mutateRoute("skills", "skills", "update_group", "Change a socket group's label, item slot, enabled and Full DPS flags (and the count of an item-granted group).", z.object({ group: groupRef, label: groupLabel.optional(), slot: groupSlot.optional(), enabled: z.boolean().optional(), includeInFullDPS: z.boolean().optional(), count: gemCount.optional() }), groupResult, ["group", "label", "slot", "enabled", "includeInFullDPS", "count"]),
  mutateRoute("skills", "skills", "delete_group", "Delete a socket group.", z.object({ group: groupRef }), groupsResult, ["group"]),
  mutateRoute("skills", "skills", "move_group", "Move a socket group to another position in the list; the main skill stays the same group.", z.object({ group: groupRef, to: groupRef.describe("New position, from 1") }), groupResult, ["group", "to"]),
  mutateRoute("skills", "skills", "set_main", "Make a socket group the main one, and optionally pick which of its active skills is the main skill. The main group is one number for the whole build, not per skill set: setting it in one set changes the main group of every set to the group at that position.", z.object({ group: groupRef, skill: z.number().int().min(1).max(50).optional().describe("Active skill number in the group's `activeSkills`, from 1") }), mainGroupResult, ["group", "skill"]),
  mutateRoute("skills", "skills", "set_gem", "Change a gem of a group (name, level, quality, enabled, count); a position one past the last gem adds one (name required), at the level the `defaultGemLevel` option picks unless `level` is given.", z.object({ group: groupRef, gem: gemRef, name: z.string().trim().min(1).max(100).optional().describe("Gem name; the ` Support` suffix is optional"), level: gemLevel.optional(), quality: gemQuality.optional(), enabled: z.boolean().optional(), count: gemCount.optional() }), gemResult, ["group", "gem", "name", "level", "quality", "enabled", "count"]),
  mutateRoute("skills", "skills", "delete_gem", "Remove a gem from a group.", z.object({ group: groupRef, gem: gemRef }), gemsResult, ["group", "gem"]),
  mutateRoute("skills", "skills", "set_imbued", "Set a group's Imbued Support (needs the group socketed in an item slot), or None to clear it.", z.object({ group: groupRef, name: z.string().trim().min(1).max(100).describe("A support gem name, or None") }), imbuedResult, ["group", "name"]),
  mutateRoute("skills", "skills", "optimise_sockets", "Reorder a socketed group's gems to match the item's socket colours (the Optimise Sockets button).", z.object({ group: groupRef }), socketOrderResult, ["group"]),
  mutateRoute("skills", "skills", "set_options", "Skills tab gem options: default gem level and quality, which support gems the gem box shows, legacy gems.", z.object({ defaultGemLevel: z.enum(["normalMaximum", "corruptedMaximum", "awakenedMaximum", "characterLevel", "levelOne"]).optional(), defaultGemQuality: gemQuality.optional(), showSupportGemTypes: z.enum(["ALL", "NORMAL", "EXCEPTIONAL"]).optional().describe("NORMAL = non-exceptional"), showLegacyGems: z.boolean().optional() }), gemOptions, ["defaultGemLevel", "defaultGemQuality", "showSupportGemTypes", "showLegacyGems"]),
  mutateRoute("skills", "skills", "set_skill_options", "The main skill's sidebar choices: skill part, stages, active mines, minion and minion skill (only those the skill shows; see `get` mainOptions). Dropdowns take their number or label; set part and minion before stages and minion skill (done in that order).", z.object({ part: choiceOf.optional(), stages: z.number().int().min(0).max(1000).optional(), mines: z.number().int().min(0).max(1000).optional(), minion: choiceOf.optional().describe("Minion name (or id), or its number in the list"), minionSkill: choiceOf.optional() }), mainOptions, ["part", "stages", "mines", "minion", "minionSkill"]),
  mutateRoute("skills", "skills", "set_spectres", "Add or remove spectres in the build's spectre library (Manage Spectres...), by spectre name or id; spectres are then choices of a Raise Spectre skill's `minion`.", z.object({ add: z.array(z.string().trim().min(1).max(200)).max(50).optional(), remove: z.array(z.string().trim().min(1).max(200)).max(50).optional() }), spectresResult, ["add", "remove"]),
  mutateRoute("skills", "skills", "set_new", "Add a skill set.", z.object({ title: title.optional() }), setsResult, ["title"]),
  mutateRoute("skills", "skills", "set_copy", "Copy a skill set.", z.object({ index: setIndex.describe("Skill set number in the set list, from 1"), title: title.optional() }), setsResult, ["index", "title"]),
  mutateRoute("skills", "skills", "set_rename", "Rename a skill set.", z.object({ index: setIndex.describe("Skill set number in the set list, from 1"), title }), setsResult, ["index", "title"]),
  mutateRoute("skills", "skills", "set_delete", "Delete a skill set (not the last one).", z.object({ index: setIndex.describe("Skill set number in the set list, from 1") }), setsResult, ["index"]),
  mutateRoute("skills", "skills", "set_activate", "Make a skill set the active one.", z.object({ index: setIndex.describe("Skill set number in the set list, from 1") }), setsResult, ["index"]),

  // items
  readRoute("items", "items", "list", "The Items tab: every item in the list, every slot with the item in it (and flask active state), item sets, the active weapon set.", z.object({}), z.looseObject({ items: z.array(itemBrief), slots: z.array(z.looseObject({ slot: z.string(), item: z.number().optional(), active: z.boolean().optional() })), sets: setList, weaponSet: z.number() })),
  readRoute("items", "items", "get", "One item: its text, mods in force for its selected variant, roll ranges, anoints, variants and the slots it fits.", z.object({ item: itemRef }), itemDetail, ["item"]),
  mutateRoute("items", "items", "add", "Add an item from its text (copied in game or from Path of Building), as Ctrl+V on the item list does. Text Path of Building cannot read fails.", z.object({ text: z.string().min(1).max(20000), equip: itemEquip }), itemBrief, ["text", "equip"]),
  mutateRoute("items", "items", "add_unique", "Add a unique from the unique database by name (a `lookup uniques` name or title), optionally with a variant.", z.object({ name: itemName, variant: z.number().int().min(1).max(100).optional().describe("Variant number, from 1, for uniques that have variants"), equip: itemEquip }), itemBrief, ["name", "variant", "equip"]),
  mutateRoute("items", "items", "add_rare", "Add a rare from the rare template database by name (e.g. `Armour Helmet`).", z.object({ name: itemName, equip: itemEquip }), itemBrief, ["name", "equip"]),
  mutateRoute("items", "items", "modify", "Change an item as its editor does: variant, quality, sockets and links, mod roll ranges, catalyst. Saved over the item.", z.object({ item: itemRef, variant: z.number().int().min(1).max(100).optional(), altVariant: z.number().int().min(1).max(100).optional().describe("Second variant, for items that have one"), quality: z.number().int().min(0).max(99).optional(), sockets: z.string().trim().min(1).max(40).optional().describe("Socket colours R G B W A with - for links and a space between groups, e.g. `R-G-B B`; only adds sockets"), ranges: z.array(z.object({ index: z.number().int().min(1).max(100).describe("Position in the item's `ranges`, from 1"), value: z.number().min(0).max(1) })).max(20).optional(), catalyst: z.number().int().min(0).max(12).optional().describe("Crafted rings, amulets and belts: 0 none, 1 Abrasive, 2 Accelerating, 3 Dextral, 4 Fertile, 5 Imbued, 6 Intrinsic, 7 Noxious, 8 Prismatic, 9 Sinistral, 10 Tempering, 11 Turbulent, 12 Unstable"), catalystQuality: z.number().int().min(0).max(99).optional() }), itemDetail, ["item", "variant", "altVariant", "quality", "sockets", "ranges", "catalyst", "catalystQuality"]),
  mutateRoute("items", "items", "edit", "Replace an item's text (the Edit... button); the item keeps its id and slot. Text Path of Building cannot read fails.", z.object({ item: itemRef, text: z.string().min(1).max(20000) }), itemDetail, ["item", "text"]),
  mutateRoute("items", "items", "anoint", "Anoint an amulet (or another anointable item) with notables, one per anoint slot, in order; an empty list removes the anoints.", z.object({ item: itemRef, notables: z.array(itemName).max(4) }), itemDetail, ["item", "notables"]),
  mutateRoute("items", "items", "enchant", "Enchant an item from the Enchant popup (helmet, gloves, boots, weapon and similar). The enchantment is matched by its text, exactly or by one unique part of it.", z.object({ item: itemRef, enchantment: z.string().trim().min(1).max(300), source: z.string().trim().min(1).max(100).optional().describe("Where it comes from, e.g. Eternal Labyrinth (the default is the first listed)"), skill: z.string().trim().min(1).max(100).optional().describe("For skill enchantments (helmets), the skill") }), itemDetail, ["item", "enchantment", "source", "skill"]),
  mutateRoute("items", "items", "craft", "Craft a new item from a base (the Craft item... popup), pick crafting bench mods in its affix boxes, and add it. A mod is matched by the text of its affix box entry, e.g. `+# to maximum Life`.", z.object({ base: z.string().trim().min(1).max(200).describe("Base type name, e.g. Astral Plate"), rarity: z.enum(["NORMAL", "MAGIC", "RARE"]).optional().describe("Default RARE"), title: z.string().trim().min(1).max(100).optional(), affixes: z.array(z.object({ slot: z.number().int().min(1).max(6).describe("Affix box, from 1 (prefixes first)"), mod: z.string().trim().min(1).max(300), roll: z.number().min(0).max(1).optional().describe("0 to 1 across the mod's tiers and range; default 1") })).max(6).optional(), equip: itemEquip }), itemDetail, ["base", "rarity", "title", "affixes", "equip"]),
  mutateRoute("items", "items", "influence", "Set an item's influences from its Influence dropdowns (Shaper, Elder, Warlord, Hunter, Crusader, Redeemer; helmets, gloves, boots and body armour also Searing Exarch and Eater of Worlds). An empty list removes them. Items without Influence dropdowns (flasks, jewels) and unknown names fail.", z.object({ item: itemRef, influences: z.array(z.string().trim().min(1).max(50)).max(2).describe("Up to two influence names, as the dropdowns list them") }), itemDetail, ["item", "influences"]),
  mutateRoute("items", "items", "corrupt", "Corrupt an item with the Corrupt... popup (Corrupted source), choosing up to two implicits from its lists; an empty list corrupts with no new implicit. An implicit is matched by its text, exactly or by one unique part. Items that cannot be corrupted and implicits the lists do not offer fail.", z.object({ item: itemRef, implicits: z.array(z.string().trim().min(1).max(300)).max(2).describe("Text of each implicit, one per Implicit box") }), itemDetail, ["item", "implicits"]),
  mutateRoute("items", "items", "add_implicit", "Add an implicit with the Add Implicit... popup. Sources: Custom (give `text`), and where the item allows them Vestigial, Searing Exarch and Eater of Worlds (give `mod`: the text of a choice, exactly or by one unique part). Items that take no added implicit and unknown or ambiguous choices fail.", z.object({ item: itemRef, source: z.string().trim().min(1).max(50).optional().describe("Source in the popup; Custom when `text` is given, else the first listed"), mod: z.string().trim().min(1).max(300).optional().describe("Text of the choice, for the listed sources"), text: z.string().trim().min(1).max(300).optional().describe("The implicit line, for the Custom source") }), itemDetail, ["item", "source", "mod", "text"]),
  mutateRoute("items", "items", "custom_mod", "Add a modifier to a magic or rare item with the Add modifier... popup: pick a source (Crafting Bench, Essence, Veiled, Beastcraft, Necropolis, Fossil, drop-restricted, Prefix, Suffix; only those the item has) and the choice by text, or Custom with `text`. Unknown sources and choices fail.", z.object({ item: itemRef, source: z.string().trim().min(1).max(50).describe("Source in the popup, e.g. Crafting Bench or Custom"), mod: z.string().trim().min(1).max(300).optional().describe("Text of the choice, exact or one unique part"), text: z.string().trim().min(1).max(300).optional().describe("The modifier line, for the Custom source") }), itemDetail, ["item", "source", "mod", "text"]),
  mutateRoute("items", "items", "crucible_mod", "Set the crucible modifiers of a weapon or shield with the Add Crucible mod... popup: each entry names a node box and the text of its choice (None empties the box); boxes not named keep their choice. Items without a crucible tree and unknown choices fail.", z.object({ item: itemRef, mods: z.array(z.object({ node: z.number().int().min(1).max(5).describe("Node box, 1 to 5"), mod: z.string().trim().min(1).max(300).describe("Text of the choice, or None") })).min(1).max(5) }), itemDetail, ["item", "mods"]),
  mutateRoute("items", "items", "cluster_jewel", "Change a crafted cluster jewel with its own controls: the skill, the added passive count (within the jewel's range) and notables, one per affix box in order (as `craft` picks affixes). Only jewels made with `craft` from a cluster jewel base have them.", z.object({ item: itemRef, skill: z.string().trim().min(1).max(100).optional().describe("Jewel skill, e.g. Fire Damage"), nodes: z.number().int().min(1).max(12).optional().describe("Added passive skills"), notables: z.array(z.string().trim().min(1).max(300)).max(4).optional().describe("Text of the notable in affix box 1, 2, ...") }), itemDetail, ["item", "skill", "nodes", "notables"]),
  mutateRoute("items", "items", "equip", "Put an item in a slot, as the slot's dropdown does. An item the slot does not take fails.", z.object({ item: itemRef, slot: itemSlot }), equipResult, ["item", "slot"]),
  mutateRoute("items", "items", "unequip", "Empty a slot (the item stays in the list).", z.object({ slot: itemSlot }), unequipResult, ["slot"]),
  mutateRoute("items", "items", "set_active", "Switch a flask's or tincture's Active box on or off.", z.object({ slot: itemSlot, active: z.boolean() }), activeResult, ["slot", "active"]),
  mutateRoute("items", "items", "delete", "Delete an item from the list (it leaves every slot that held it).", z.object({ item: itemRef }), deletedItemResult, ["item"]),
  mutateRoute("items", "items", "weapon_set", "Switch between weapon set 1 and the swap set (the weapon swap buttons).", z.object({ set: z.number().int().min(1).max(2) }), weaponSetResult, ["set"]),
  mutateRoute("items", "items", "set_new", "Add an item set (an empty set of slots).", z.object({ title: title.optional() }), setsResult, ["title"]),
  mutateRoute("items", "items", "set_copy", "Copy an item set.", z.object({ index: setIndex.describe("Item set number in the set list, from 1"), title: title.optional() }), setsResult, ["index", "title"]),
  mutateRoute("items", "items", "set_rename", "Rename an item set.", z.object({ index: setIndex.describe("Item set number in the set list, from 1"), title }), setsResult, ["index", "title"]),
  mutateRoute("items", "items", "set_delete", "Delete an item set (not the last one); its items stay in the list.", z.object({ index: setIndex.describe("Item set number in the set list, from 1") }), setsResult, ["index"]),
  mutateRoute("items", "items", "set_activate", "Make an item set the active one.", z.object({ index: setIndex.describe("Item set number in the set list, from 1") }), setsResult, ["index"]),

  // config
  readRoute("config", "config", "get", "Configuration values that differ from default on the active config set, the config set list, level settings.", z.object({}), z.looseObject({ values: z.record(z.string(), z.unknown()), sets: setList, level: z.number().optional(), autoLevel: z.boolean() })),
  mutateRoute("config", "config", "set", "Set configuration options (see lookup `config` for names and allowed values); `reset` puts options back to their default.", z.object({ values: z.record(z.string().min(1).max(100), configValue).optional(), reset: z.array(z.string().min(1).max(100)).max(500).optional() }), configSetResult, ["values", "reset"]),
  mutateRoute("config", "config", "set_new", "Add a config set.", z.object({ title: title.optional() }), setsResult, ["title"]),
  mutateRoute("config", "config", "set_copy", "Copy a config set.", z.object({ index: setIndex, title: title.optional() }), setsResult, ["index", "title"]),
  mutateRoute("config", "config", "set_rename", "Rename a config set.", z.object({ index: setIndex, title }), setsResult, ["index", "title"]),
  mutateRoute("config", "config", "set_delete", "Delete a config set (not the last one).", z.object({ index: setIndex }), setsResult, ["index"]),
  mutateRoute("config", "config", "set_activate", "Make a config set the active one.", z.object({ index: setIndex }), setsResult, ["index"]),
  readRoute("config", "config", "notes", "The build notes (Notes tab), with colour codes.", z.object({}), z.looseObject({ text: z.string() })),
  mutateRoute("config", "config", "set_notes", "Replace the build notes.", z.object({ text: z.string().max(100000) }), nothing, ["text"]),

  // party (config domain): the Party tab's inputs
  at(readRoute("config", "party", "party_get", "The Party tab inputs: the import destination and toggles, the text boxes (auras, curses, warcries, links, party member stats, enemy conditions, enemy modifiers) and what Path of Building parsed from them.", z.object({}), partyState, [], "party.get"), "/v1/party/:id/get"),
  at(mutateRoute("config", "party", "party_import", "Import a party member's build code (exported with Export support on) into a destination, as the Party tab's Import button does; Append keeps what is there. Links are not fetched.", z.object({ code: z.string().min(1).max(2000000), destination: partyDestination.optional(), append: z.boolean().optional() }), nothing, ["code", "destination", "append"], "party.import"), "/v1/party/:id/import"),
  at(mutateRoute("config", "party", "party_clear", "Clear imported party data for a destination (default the tab's current one), as the Clear button does.", z.object({ destination: partyDestination.optional() }), nothing, ["destination"], "party.clear"), "/v1/party/:id/clear"),
  at(mutateRoute("config", "party", "party_set", "Set party text boxes and toggles; text is parsed (Rebuild All), as when typed in the advanced boxes.", z.object({ auras: partyText.optional(), curses: partyText.optional(), warcries: partyText.optional(), links: partyText.optional(), partyMemberStats: partyText.optional(), enemyConditions: partyText.optional(), enemyMods: partyText.optional(), showAdvanced: z.boolean().optional(), append: z.boolean().optional(), destination: partyDestination.optional() }), nothing, ["auras", "curses", "warcries", "links", "partyMemberStats", "enemyConditions", "enemyMods", "showAdvanced", "append", "destination"], "party.set"), "/v1/party/:id/set"),
  at(mutateRoute("config", "party", "party_effects", "Turn party effects off (Disable Party Effects; the data stays) or back on (Rebuild All parses the boxes again).", z.object({ enabled: z.boolean() }), nothing, ["enabled"], "party.set_effects"), "/v1/party/:id/effects"),

  // evaluate
  evalRoute("what_if", "What the build would be with changes, without making them: nodes added or removed, an item in a slot, a flask or tincture toggled, conditions on. Answers only the stats that differ.", z.object({ addNodes: nodeList.optional(), removeNodes: nodeList.optional(), slot: itemSlot.optional(), item: evalItemRef, text: evalItemText, toggleFlask: itemSlot.optional().describe("Flask slot whose active state flips"), toggleTincture: itemSlot.optional().describe("Tincture slot whose active state flips"), conditions: z.array(z.string().trim().min(1).max(100)).max(50).optional().describe("Condition names switched on, as the calculator knows them"), fields: evalFields }), changedStats, ["addNodes", "removeNodes", "slot", "item", "text", "toggleFlask", "toggleTincture", "conditions", "fields"]),
  evalRoute("passives", "Score candidate passives one at a time without allocating them: each with the path that reaches it, through the calculator. Answers the stats that differ per candidate. Default candidates: every unallocated passive next to the allocated tree (ascendancy nodes and masteries left out).", z.object({ candidates: nodeList.optional().describe("Node ids or exact names; each is scored with its path from the allocated tree"), fields: evalFields, sortBy: z.string().trim().min(1).max(100).optional().describe("Output key; candidates sorted by its gain, largest first (otherwise by node id)"), limit, offset }), z.looseObject({ total: z.number(), offset: z.number(), sortBy: z.string().optional(), candidates: z.array(z.looseObject({ id: z.number(), name: z.string(), type: z.string(), points: z.number().describe("Points the candidate and its path cost"), gain: z.number().optional(), changed: changedStats.shape.changed })) }), ["candidates", "fields", "sortBy", "limit", "offset"]),
  evalRoute("node_power", "Passive node power for a stat, from the tree's heat map calculation: unallocated nodes show what allocating gains, allocated nodes what removing changes. Masteries are listed once per effect; cluster notables and ascendancy nodes are left out. Sorted by power, highest first.", z.object({ stat: powerStatName, depth: z.number().int().min(1).max(100).optional().describe("Largest path distance (default 10; a whole tree can outlast the worker timeout)"), limit, offset }), z.looseObject({ stat: z.string(), total: z.number(), offset: z.number(), nodes: z.array(z.looseObject({ id: z.number(), name: z.string(), type: z.string(), allocated: z.boolean(), pathDist: z.number(), power: z.number(), pathPower: z.number().optional(), defence: z.number().optional() })) }), ["stat", "depth", "limit", "offset"]),
  evalRoute("compare_item", "What an item would change in each slot it fits (default all equipment slots in use), as the Items tab's comparison shows. A jewel is compared in the socket named by `slot` (Jewel <node id>, or an item's abyssal socket), against the jewel in it now: paste a listing's text to rank it against the current jewel. Radius jewels count what is in their radius. Cluster jewels and jewels that change the tree (timeless, Thread of Hope, Impossible Escape) are equipped for real for the measurement, a cluster with all its passives allocated (`points` is the passive points that costs beyond the current tree), and the build is then loaded back as it was.", z.object({ item: evalItemRef, text: evalItemText, slot: itemSlot.optional(), fields: evalFields }), z.looseObject({ slots: z.array(changedStats.extend({ slot: z.string(), equipped: z.string().nullable(), points: z.number().optional().describe("Passive points spent beyond the current tree (equipped-for-real comparisons)") })) }), ["item", "text", "slot", "fields"]),
  evalRoute(
    "jewel_mods",
    "Rank the mods a jewel can have for this build, the way Path of Building's trade search weighs them (TradeQueryGenerator): each mod alone on a blank jewel in the socket, weighed by the stat weights (default Full DPS 1, Effective Hit Pool 0.5); `gain` is that weighted change x1000 against the socket empty and `weight` is gain per point of the mod's value, which is what the search sums. Each mod is tested at min + (max - min) x quality over its range across all tiers (Path of Building's Item Affix Quality, default 0.5). Where Path of Building's mod data has more than one entry for a trade stat, the one a base of the family rolls is used (then the widest range), so the answer is the same on every run; mods no base of the family rolls are listed with `rollable: false` and kept out of sets. Families: base and abyss (explicit mods, plus corrupted implicits unless includeCorrupted is false), watchers_eye, and cluster (the notables a cluster of that size and enchant can roll, each added to the tree alone, as the generator weighs Megalomaniac's). Unique jewels: unique_rank with a Jewel slot. `combinations` are the best legal sets (at most two prefixes and two suffixes, distinct mod groups, a base that rolls them all; clusters: up to 1, 2 or 3 notables for small, medium and large), each measured together on one test jewel (`estimate` is the sum of the parts). `query` is the trade search Path of Building builds (weighted sum group with its minimum, league status, mirrored and price filters; for clusters its base, the enchant and item level), `search` the body the trade API takes. `link` (with `league`) is Path of Building's own link form, https://www.pathofexile.com/trade/search/<league>/<gzip+base64url query>: it is made with no request, and it is unverified until someone opens one by hand. Calculation only; nothing is sent anywhere (`trade.search` runs `search` on request).",
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
      league: tradeLeague.optional().describe("Trade league for the link (the league being played)"),
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
  ),
  evalRoute("gem_rank", "Rank gems for a socket group with the gem box's own calculation: the stat with each candidate in that position, highest first (value is the stat itself, `base` is without the gem).", z.object({ group: groupRef, gem: gemRef.optional().describe("Position the candidate goes into (default one past the last gem)"), stat: powerStatName.describe("FullDPS, CombinedDPS, TotalDPS, AverageDamage, TotalDot, BleedDPS, IgniteDPS, TotalPoisonDPS or TotalEHP"), support: z.boolean().optional().describe("Only support gems (default true); false adds active gems with global effects"), limit }), z.looseObject({ stat: z.string(), base: z.number(), total: z.number(), gems: z.array(z.looseObject({ name: z.string(), value: z.number() })) }), ["group", "gem", "stat", "support", "limit"]),
  evalRoute("anoint_rank", "Rank notables to anoint an item with, by the stat gained (the Anoint popup's sort). Name the item by id or by the slot it is in.", z.object({ item: evalItemRef, slot: itemSlot.optional(), stat: powerStatName, limit }), z.looseObject({ stat: z.string(), total: z.number(), notables: z.array(z.looseObject({ name: z.string(), power: z.number() })) }), ["item", "slot", "stat", "limit"]),
  evalRoute("unique_rank", "Rank the uniques that fit a slot by the stat with the unique equipped (the unique list's sort by stat; power is the stat's value, best slot).", z.object({ slot: itemSlot, stat: powerStatName, limit }), z.looseObject({ stat: z.string(), total: z.number(), uniques: z.array(z.looseObject({ name: z.string(), power: z.number() })) }), ["slot", "stat", "limit"]),
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

  // trade
  route({
    name: "trade.search",
    domain: "trade",
    method: "POST",
    path: "/v1/trade/search",
    summary: "Run trade searches on the official trade site now and answer their first listings, each read by Path of Building's own trade conversion and, with `buildId`, scored for the build in its slot (`score.gain`: the weighted change x1000 against what is there now, as jewel_mods and the trade search weigh; sorted by it). Takes complete search definitions (the `search` of jewel_mods, or any query the trade site takes). Limits: Path of Building's own request shapes (search, then fetch in blocks of 10) and client string, the host fixed, no account, session or cookie; at most 8 searches per call and 30 listings per search; nothing repeats a search by itself (a caller may call again, reading `limiter`); one limiter for the whole server paces at half of every window the site states, a quarter for `priority: background`, which is refused rather than kept waiting; a 429 or any 4xx stops the call (`stopped`, with the site's Retry-After) and nothing is retried; the same search within 10 minutes is answered from a cache and sends nothing. No seller names or whispers are answered; nothing is sent to a seller. `link` is the search on the trade site (PoB's own link form; unverified until someone opens one by hand).",
    input: z.object({
      league: tradeLeague.describe("Trade league, the one being played"),
      realm,
      priority: z.enum(["interactive", "background"]).optional().describe("interactive (default): a person asking now, waits for the pace up to 60 s; background: a watched search, refused at once when the budget is short"),
      searches: z.array(z.object({
        query: tradeQuery.describe("The trade site's `query` object (status, stats, filters)"),
        sort: z.record(z.string().min(1).max(60), z.enum(["asc", "desc"])).refine((r) => Object.keys(r).length <= 4, "at most 4 sort keys").optional().describe("Default { price: asc }; jewel_mods' search sorts by its weight group"),
        engine: z.literal("new").optional().describe("Accepted so jewel_mods' search can be passed as is"),
        slot: itemSlot.optional().describe("Slot each listing is scored in (default: the first slot in use it fits; a jewel the first empty socket)"),
        listings: z.number().int().min(1).max(30).optional().describe("Listings to fetch (1-30, default 10)"),
      })).min(1).max(8),
      buildId: buildId.optional().describe("Score each listing for this build"),
      weights: tradeWeights,
      fields: evalFields,
    }),
    output: z.looseObject({
      searches: z.array(z.looseObject({
        searchId: z.string(),
        total: z.number(),
        cached: z.boolean(),
        link: z.string(),
        listings: z.array(z.looseObject({
          id: z.string().describe("Listing id, stable across searches"),
          price: z.looseObject({ amount: z.number(), currency: z.string(), type: z.string() }).nullable(),
          indexed: z.string().nullable().describe("When the listing was posted or last changed"),
          text: z.string().nullable(),
          score: changedStats.extend({ slot: z.string(), gain: z.number(), points: z.number().optional() }).nullable(),
          error: z.string().optional(),
        })),
      })),
      notRun: z.number().describe("Searches not run because the call stopped"),
      stopped: z.looseObject({ code: z.string(), message: z.string(), status: z.number().optional(), retryAfterSeconds: z.number().optional() }).nullable(),
      limiter: limiterState,
    }),
    readOnly: true,
    workerOp: "evaluate.listings (after the trade site's search and fetch)",
    run: (s, i) => s.tradeSearch({ ...i, realm: i.realm ?? "pc", priority: i.priority ?? "interactive", searches: i.searches.map((q) => ({ query: q.query, sort: q.sort, slot: q.slot, listings: q.listings ?? 10 })) }),
  }),

  // lookup
  lookupRoute("gems", "/v1/lookup/gems", "Search gems by name and tag, with requirements at a level (`level` defaults to each gem's natural maximum). `requirements` is absent at a `level` the game data has no row for: some gems list levels only up to `naturalMaxLevel` (Convocation stops at 1).", z.object({ query: z.string().max(100).optional(), tag: z.string().max(50).optional(), support: z.boolean().optional(), level: z.number().int().min(1).max(40).optional(), limit, offset }), pageOf("gems", z.looseObject({ id: z.string(), name: z.string(), support: z.boolean(), tags: strings, tagString: z.string().optional(), naturalMaxLevel: z.number().optional(), description: z.string().optional(), requirements: z.looseObject({ gemLevel: z.number(), level: z.number(), str: z.number(), dex: z.number(), int: z.number() }).optional() })), ["query", "tag", "support", "level", "limit", "offset"]),
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
