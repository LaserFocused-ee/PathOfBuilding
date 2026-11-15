// Worker tests for items buy_similar (Path of Building's Buy similar popup, driven through its controls) and lookup trade_stats
// (TradeHelpers' mod line to trade stat id matching), on tree 3_30. Offline: nothing here may reach the trade site.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { routes } from "../src/routes.js";
import { FIXTURES, startServer, type TestServer } from "./helpers.js";

type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Row = {
  index: number; type: string; line: string; tradeId: string | null; tradeIds: string[]; value: number | null; option: number | string | null;
  inverted: boolean; selected: boolean; min: number | null; max: number | null; canSearch: boolean;
};
type Def = { index: number; label: string; value: number; selected: boolean; min: number | null; max: number | null };
type Filter = { id: string; value?: { min?: number; max?: number; option?: number } };
type Query = {
  status: { option: string }; name?: string; type?: string;
  stats: Array<{ type: string; value?: { min: number }; filters: Filter[] }>;
  filters?: { type_filters?: { filters: { category?: { option: string } } }; [group: string]: unknown };
};
type Similar = {
  item: { id: number; name: string; title?: string; baseName: string; rarity: string; type: string }; slot: string | null; league: string; realm: string; listed: string;
  mods: Row[]; defences: Def[]; query: Query; search: { query: Query }; link: string;
};
type StatRow = { line: string; ids: string[]; value: number | null; option?: number | string; inverted: boolean; found: boolean };

let srv: TestServer;
let base: string;
let other: string;
/** Item ids in `base`. */
const at: Record<string, number> = {};

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const post = <T>(path: string, body: Record<string, unknown>) => srv.call<T>("POST", path, body);
const route = (name: string) => routes.find((r) => r.name === name);
const state = async (id: string) =>
  JSON.stringify([ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code, ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision]);
/** The trade search a link carries: the last path segment, gzip + base64url. */
const queryOf = (link: string) => JSON.parse(gunzipSync(Buffer.from((link.split("/").pop() ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8")) as unknown;

/** Every answer is also checked against the route's declared output, its `search` against what trade.search takes, and its link against its query. */
const similar = async (body: Record<string, unknown>, id = base) => {
  const result = ok(await post<Similar>(`/v1/items/${id}/buy-similar`, body));
  const parsed = route("items.buy_similar")?.output.safeParse(result);
  assert.ok(parsed?.success, JSON.stringify(parsed?.error?.issues.slice(0, 3)));
  const search = route("trade.search")?.input.safeParse({ league: "Standard", searches: [result.search] });
  assert.ok(search?.success, JSON.stringify(search?.error?.issues.slice(0, 3)));
  assert.deepEqual(queryOf(result.link), result.query, "the link carries the query");
  assert.deepEqual(result.search, { query: result.query });
  return result;
};
const stats = async (lines: string[], type?: string) => {
  const result = ok(await post<{ type: string; lines: StatRow[] }>("/v1/lookup/trade-stats", { lines, ...(type ? { type } : {}) }));
  const parsed = route("lookup.trade_stats")?.output.safeParse(result);
  assert.ok(parsed?.success, JSON.stringify(parsed?.error?.issues.slice(0, 3)));
  return result.lines;
};
const refused = async (path: string, body: Record<string, unknown>, status: number, code: string, message: RegExp) => {
  const r = await post<unknown>(path, body);
  assert.deepEqual([r.status, r.body.error?.code], [status, code], JSON.stringify(body));
  assert.match(r.body.error?.message ?? "", message);
};
const filtersOf = (q: Query) => q.stats.map((g) => [g.type, g.value, g.filters.map((f) => [f.id, f.value])]);
const category = (q: Query) => q.filters?.type_filters?.filters.category;
const SEARCH = "https://www.pathofexile.com/trade/search";

const gear: Record<string, string> = {
  "Body Armour": "Rarity: RARE\nTest Robe\nVaal Regalia\nItem Level: 84\nImplicits: 0\n+30 to maximum Life\n+10 to maximum Life\n+40% to Fire Resistance\n10% reduced Attribute Requirements\n20% increased Spell Damage\nAdds 5 to 10 Fire Damage\nFrobnicate the widgets by 5",
  Helmet: "Rarity: RARE\nTest Helm\nHunter Hood\nItem Level: 80\nImplicits: 1\nAllocates Heart of the Warrior (enchant)\n+20 to maximum Life",
};

before(async () => {
  srv = await startServer({ tradeLeague: "Settlers" });
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  base = ok(await post<{ build: { id: string } }>("/v1/builds/import/xml", { xml })).build.id;
  for (const [slot, text] of Object.entries(gear)) at[slot] = ok(await post<{ result: { id: number } }>(`/v1/items/${base}/add`, { text, equip: slot })).result.id;
  at.Belt = ok(await post<{ result: { id: number } }>(`/v1/items/${base}/add-unique`, { name: "Headhunter", equip: "Belt" })).result.id;
  at.Jewel = ok(await post<{ result: { id: number } }>(`/v1/items/${base}/add-unique`, { name: "Lethal Pride", equip: "none" })).result.id;
  other = ok(await post<{ build: { id: string } }>(`/v1/builds/${base}/duplicate`, {})).build.id;
  ok(await post(`/v1/items/${other}/add`, { text: "Rarity: RARE\nOther Ring\nPrismatic Ring\nItem Level: 75\nImplicits: 0\n+25 to maximum Life\n+12% to Cold Resistance", equip: "Ring 1" }));
});
after(async () => {
  await srv?.close();
});

void test("buy_similar on a rare: the popup's rows and a category-only search until rows are ticked; read-only; nothing leaves the worker", async () => {
  const pool = srv.runtime.svc.pool;
  await pool.run(base, "worker.reach");
  const before0 = await state(base);
  const r = await similar({ slot: "Body Armour", league: "Settlers" });
  assert.deepEqual([r.item.id, r.item.name, r.item.baseName, r.item.rarity, r.slot, r.league, r.realm, r.listed], [at["Body Armour"], "Test Robe, Vaal Regalia", "Vaal Regalia", "RARE", "Body Armour", "Settlers", "pc", "securable"]);
  // 2 life lines are one row (the popup adds mods of one stat and type together); the line the trade site has no stat for cannot be searched
  assert.deepEqual(r.mods.map((m) => [m.index, m.type, m.line, m.tradeIds, m.value, m.inverted, m.min, m.max, m.selected, m.canSearch]), [
    [1, "explicit", "+30 to maximum Life\n+10 to maximum Life", ["explicit.stat_3299347043"], 40, false, 40, null, false, true],
    [2, "explicit", "+40% to Fire Resistance", ["explicit.stat_3372524247"], 40, false, 40, null, false, true],
    [3, "explicit", "10% reduced Attribute Requirements", ["explicit.stat_3639275092"], 10, true, 10, null, false, true],
    [4, "explicit", "20% increased Spell Damage", ["explicit.stat_2974417149"], 20, false, 20, null, false, true],
    [5, "explicit", "Adds 5 to 10 Fire Damage", ["explicit.stat_321077055", "explicit.stat_709508406"], 7.5, false, 7.5, null, false, true],
    [6, "explicit", "Frobnicate the widgets by 5", [], null, false, null, null, false, false],
  ]);
  assert.deepEqual(r.mods.map((m) => m.tradeId), ["explicit.stat_3299347043", "explicit.stat_3372524247", "explicit.stat_3639275092", "explicit.stat_2974417149", null, null]);
  assert.deepEqual(r.defences, [{ index: 1, label: "Energy Shield", value: 236, selected: false, min: 236, max: null }]);
  // the popup ticks nothing: the query is the status and the category
  assert.deepEqual(r.query, { status: { option: "securable" }, stats: [{ type: "and", filters: [] }], filters: { type_filters: { filters: { category: { option: "armour.chest" } } } } });
  assert.match(r.link, /^https:\/\/www\.pathofexile\.com\/trade\/search\/Settlers\/[\w-]+$/);
  assert.equal(await state(base), before0, "buy_similar changed the build");
  // the popup asks the trade site for its leagues when it opens, and Open URL hands the link to the browser: neither went anywhere
  assert.deepEqual(await pool.run(base, "worker.reach").then((x) => x.result), { subScripts: 0, urls: 0, writes: [] });
});

void test("buy_similar select: ticked rows become stat filters, min and max land in them, a row listed with selected false is dropped", async () => {
  const all = await similar({ slot: "Body Armour", league: "Settlers", select: [{ index: 1 }, { index: 2, min: 35, max: 45 }, { index: 3 }, { index: 4 }, { index: 5 }] });
  assert.deepEqual(all.mods.map((m) => [m.selected, m.min, m.max]), [[true, 40, null], [true, 35, 45], [true, 10, null], [true, 20, null], [true, 7.5, null], [false, null, null]]);
  // the reduced line is searched as an inverted stat: the filter takes the value negated, with min and max swapped
  assert.deepEqual(filtersOf(all.query), [
    ["and", undefined, [
      ["explicit.stat_3299347043", { min: 40 }], ["explicit.stat_3372524247", { min: 35, max: 45 }], ["explicit.stat_3639275092", { max: -10 }], ["explicit.stat_2974417149", { min: 20 }],
    ]],
    // the line two stats fit is a count filter: at least one of them
    ["count", { min: 1 }, [["explicit.stat_321077055", { min: 7.5 }], ["explicit.stat_709508406", { min: 7.5 }]]],
  ]);
  const less = await similar({ slot: "Body Armour", league: "Settlers", select: [{ index: 1, min: 45 }, { index: 2 }, { index: 3, selected: false }, { index: 4, selected: false }, { index: 5, selected: false }] });
  assert.deepEqual(filtersOf(less.query), [["and", undefined, [["explicit.stat_3299347043", { min: 45 }], ["explicit.stat_3372524247", { min: 40 }]]]]);
  assert.deepEqual(less.mods.map((m) => m.selected), [true, true, false, false, false, false]);
  // the base, the item level boxes and a defence row
  const gearBox = await similar({ slot: "Body Armour", league: "Settlers", baseType: true, itemLevel: { min: 80, max: 90 }, defences: [{ index: 1, min: 200, max: 300 }] });
  assert.deepEqual([gearBox.query.type, gearBox.query.filters], ["Vaal Regalia", {
    type_filters: { filters: { category: { option: "armour.chest" } } }, misc_filters: { filters: { ilvl: { min: 80, max: 90 } } }, armour_filters: { filters: { es: { min: 200, max: 300 } } },
  }]);
  assert.deepEqual(gearBox.defences, [{ index: 1, label: "Energy Shield", value: 236, selected: true, min: 200, max: 300 }]);
});

void test("buy_similar option stats and uniques: an enchant by its option, a unique by its name and base, a timeless jewel by its seed range", async () => {
  const helm = await similar({ item: at.Helmet, league: "Settlers", select: [{ index: 1 }, { index: 2, min: 50 }] });
  assert.equal(helm.slot, "Helmet");
  assert.deepEqual(helm.mods.map((m) => [m.type, m.line, m.tradeId, m.value, m.option, m.min, m.selected]), [
    ["enchant", "Allocates Heart of the Warrior", "enchant.stat_2954116742", null, 61198, null, true],
    ["explicit", "+20 to maximum Life", "explicit.stat_3299347043", 20, null, 50, true],
  ]);
  assert.deepEqual(filtersOf(helm.query), [["and", undefined, [["enchant.stat_2954116742", { option: 61198 }], ["explicit.stat_3299347043", { min: 50 }]]]]);
  assert.equal(category(helm.query)?.option, "armour.helmet");
  // a choice takes no number
  await refused(`/v1/items/${base}/buy-similar`, { item: at.Helmet, league: "Settlers", select: [{ index: 1, min: 3 }] }, 400, "invalid_input", /takes no min or max/);

  // a unique: searched by name and base (the popup has no category, base or item level boxes for it); no row is ticked by default
  const belt = await similar({ slot: "Belt", league: "Settlers" });
  assert.deepEqual([belt.query.name, belt.query.type, belt.query.filters, belt.mods.length, belt.mods.some((m) => m.selected), belt.item.title, belt.defences], ["Headhunter", "Leather Belt", undefined, 6, false, "Headhunter", []]);
  assert.deepEqual(belt.mods.slice(0, 2).map((m) => [m.type, m.line, m.tradeId]), [["implicit", "+33 to maximum Life", "implicit.stat_3299347043"], ["explicit", "+48 to Strength", "explicit.stat_4080418644"]]);
  const picked = await similar({ slot: "Belt", league: "Settlers", select: [{ index: 1 }, { index: 4 }] });
  assert.deepEqual(filtersOf(picked.query), [["and", undefined, [["implicit.stat_3299347043", { min: 33 }], ["explicit.stat_3299347043", { min: 55 }]]]]);

  // a timeless jewel that is not equipped (item id): its seed line is a min = max range under the conqueror's pseudo stat
  const jewel = await similar({ item: at.Jewel, league: "Settlers", select: [{ index: 1 }] });
  assert.deepEqual([jewel.query.name, jewel.query.type, jewel.slot], ["Lethal Pride", "Timeless Jewel", "Jewel"]);
  assert.deepEqual(jewel.mods[0], { index: 1, type: "explicit", line: "Commanded leadership over 14000 warriors under Akoya", tradeId: "explicit.pseudo_timeless_jewel_akoya", tradeIds: ["explicit.pseudo_timeless_jewel_akoya"], value: 14000, option: null, inverted: false, selected: true, min: null, max: null, canSearch: true });
  assert.deepEqual(filtersOf(jewel.query), [["and", undefined, [["explicit.pseudo_timeless_jewel_akoya", { min: 14000, max: 14000 }]]]]);
});

void test("buy_similar league, realm and listed: the link is for the server's configured league, never another, in the realm's path; nothing is sent", async () => {
  const pool = srv.runtime.svc.pool;
  await pool.run(base, "worker.reach");
  const a = await similar({ slot: "Body Armour" });
  assert.equal(a.league, "Settlers", "left out: the configured league");
  assert.match(a.link, /^https:\/\/www\.pathofexile\.com\/trade\/search\/Settlers\/[\w-]+$/);
  for (const league of ["Standard", "Hardcore Settlers"]) await refused(`/v1/items/${base}/buy-similar`, { slot: "Body Armour", league }, 400, "invalid_input", new RegExp(`league ${league} is refused.*Settlers`));
  const xbox = await similar({ slot: "Body Armour", league: "Settlers", realm: "xbox", listed: "any" });
  assert.equal(xbox.link.startsWith(`${SEARCH}/xbox/Settlers/`), true);
  assert.deepEqual([xbox.realm, xbox.listed, xbox.query.status], ["xbox", "any", { option: "any" }]);
  const sony = await similar({ slot: "Body Armour", league: "Settlers", realm: "sony", listed: "online" });
  assert.equal(sony.link.startsWith(`${SEARCH}/sony/Settlers/`), true);
  // every one of the popup's Listed choices, by api value; the popup's choices do not carry over between calls
  for (const listed of ["securable", "available", "online", "any"]) assert.equal((await similar({ slot: "Body Armour", league: "Settlers", listed })).query.status.option, listed);
  const fresh = await similar({ slot: "Body Armour", league: "Settlers" });
  assert.deepEqual([fresh.realm, fresh.listed, fresh.link.startsWith(`${SEARCH}/Settlers/`)], ["pc", "securable", true]);
  assert.deepEqual(await pool.run(base, "worker.reach").then((x) => x.result), { subScripts: 0, urls: 0, writes: [] });
  // a league that is not a league name is refused
  await refused(`/v1/items/${base}/buy-similar`, { slot: "Body Armour", league: "" }, 400, "invalid_input", /league/);
  await refused(`/v1/items/${base}/buy-similar`, { slot: "Body Armour", league: "Loading..." }, 400, "invalid_input", /league/);
});

void test("buy_similar other: the item is the other build's; neither build changes", async () => {
  const before0 = [await state(base), await state(other)];
  const bySlot = await similar({ slot: "Ring 1", league: "Settlers", other, select: [{ index: 1 }, { index: 2, min: 10 }] }, base);
  assert.deepEqual([bySlot.item.name, bySlot.item.baseName, bySlot.slot, category(bySlot.query)?.option], ["Other Ring, Prismatic Ring", "Prismatic Ring", "Ring 1", "accessory.ring"]);
  assert.deepEqual(bySlot.mods.map((m) => [m.line, m.tradeId, m.value]), [["+25 to maximum Life", "explicit.stat_3299347043", 25], ["+12% to Cold Resistance", "explicit.stat_4220027924", 12]]);
  assert.deepEqual(filtersOf(bySlot.query), [["and", undefined, [["explicit.stat_3299347043", { min: 25 }], ["explicit.stat_4220027924", { min: 10 }]]]]);
  // by the other build's item id
  const otherId = ok(await srv.call<{ slots: Array<{ slot: string; item?: number }> }>("GET", `/v1/items/${other}/list`)).slots.find((s) => s.slot === "Ring 1")?.item;
  const byId = await similar({ item: otherId, league: "Settlers", other }, base);
  assert.deepEqual([byId.item.name, byId.item.id], ["Other Ring, Prismatic Ring", otherId]);
  // this build has no ring in Ring 1: the same slot without `other` is refused
  await refused(`/v1/items/${base}/buy-similar`, { slot: "Ring 1", league: "Settlers" }, 404, "not_found", /Ring 1 holds no item/);
  assert.deepEqual([await state(base), await state(other)], before0, "code and revision of both builds unchanged");
  // the other build's item sets are picked as everywhere else; this build is not the other one
  await refused(`/v1/items/${base}/buy-similar`, { slot: "Ring 1", league: "Settlers", other, otherSets: { items: 9 } }, 400, "invalid_input", /no items set 9/);
  await refused(`/v1/items/${base}/buy-similar`, { slot: "Ring 1", league: "Settlers", other: base }, 400, "invalid_input", /other is this build/);
  await refused(`/v1/items/${base}/buy-similar`, { slot: "Ring 1", league: "Settlers", otherSets: { items: 1 } }, 400, "invalid_input", /otherSets needs other/);
  await refused(`/v1/items/${base}/buy-similar`, { slot: "Ring 1", league: "Settlers", other: "0123456789abcdef" }, 404, "not_found", /./);
});

void test("buy_similar on eldritch implicits: the presence lines no stat description words get their trade ids from QueryMods", async () => {
  const id = ok(await post<{ build: { id: string } }>("/v1/builds", { name: "eldritch", className: "Witch" })).build.id;
  const text = "Rarity: RARE\nT Helm\nHubris Circlet\nSearing Exarch Item\nEater of Worlds Item\nImplicits: 2\n{exarch}While a Pinnacle Atlas Boss is in your Presence, 48% increased Spell Damage\n{eater}While a Unique Enemy is in your Presence, 10% increased Cast Speed\n+80 to maximum Energy Shield";
  ok(await post(`/v1/items/${id}/add`, { text, equip: "Helmet" }));
  const r = await similar({ slot: "Helmet", league: "Settlers", select: [{ index: 1 }] }, id);
  assert.deepEqual(r.mods.slice(0, 2).map((m) => [m.type, m.tradeId, m.value, m.canSearch]), [["implicit", "implicit.stat_817495383", 48, true], ["implicit", "implicit.stat_2016247664", 10, true]]);
  assert.deepEqual(filtersOf(r.query), [["and", undefined, [["implicit.stat_817495383", { min: 48 }]]]]);
});

void test("buy_similar refusals", async () => {
  const path = `/v1/items/${base}/buy-similar`;
  const ask = { slot: "Body Armour", league: "Settlers" };
  await refused(path, { league: "Settlers" }, 400, "invalid_input", /the item or the slot/);
  await refused(path, { ...ask, item: at["Body Armour"] }, 400, "invalid_input", /the item or the slot/);
  await refused(path, { item: 999, league: "Settlers" }, 404, "not_found", /no item 999/);
  await refused(path, { slot: "Nowhere", league: "Settlers" }, 400, "invalid_input", /no item slot Nowhere/);
  await refused(path, { slot: "Ring 2", league: "Settlers" }, 404, "not_found", /Ring 2 holds no item/);
  await refused(path, { ...ask, select: [{ index: 7 }] }, 400, "invalid_input", /select: the popup has 6 mod rows, not 7/);
  await refused(path, { ...ask, select: [{ index: 6 }] }, 400, "invalid_input", /mod row 6 has no trade stat/);
  await refused(path, { ...ask, select: [{ index: 1, selected: false, min: 3 }] }, 400, "invalid_input", /not selected/);
  await refused(path, { ...ask, select: [{ index: 0 }] }, 400, "invalid_input", /select\.0\.index/);
  await refused(path, { ...ask, defences: [{ index: 2 }] }, 400, "invalid_input", /defences: the popup has 1 defence rows, not 2/);
  await refused(path, { slot: "Belt", league: "Settlers", defences: [{ index: 1 }] }, 400, "invalid_input", /defences: the popup has 0 defence rows/);
  await refused(path, { slot: "Belt", league: "Settlers", baseType: true }, 400, "invalid_input", /not in the popup for a unique/);
  await refused(path, { slot: "Belt", league: "Settlers", itemLevel: { min: 5 } }, 400, "invalid_input", /not in the popup for a unique/);
  await refused(path, { ...ask, listed: "everything" }, 400, "invalid_input", /listed/);
  await refused(path, { ...ask, realm: "switch" }, 400, "invalid_input", /realm/);
  await refused(path, { ...ask, extra: 1 }, 400, "invalid_input", /unknown parameter extra/);
  await refused(`/v1/items/0123456789abcdef/buy-similar`, ask, 404, "not_found", /./);
  assert.equal((await srv.call("GET", path)).status, 404, "the route takes POST only");
});

void test("trade_stats: ids, values, options, inverted lines and timeless jewels, as the popup finds them", async () => {
  const before0 = await state(base);
  const rows = await stats([
    "+30 to maximum Life", "+40% to Fire Resistance", "10% reduced Attribute Requirements", "10% increased Mana Cost of Skills", "20% reduced Movement Speed",
    "Adds 5 to 10 Fire Damage", "Bathed in the Blood of 7000 Sacrificed in the Name of Kaom", "Frobnicate the widgets by 5", "You have Onslaught while at maximum Endurance Charges",
  ]);
  assert.deepEqual(rows.map((r) => [r.line, r.ids, r.value, r.inverted, r.found, r.option]), [
    ["+30 to maximum Life", ["explicit.stat_3299347043"], 30, false, true, undefined],
    ["+40% to Fire Resistance", ["explicit.stat_3372524247"], 40, false, true, undefined],
    ["10% reduced Attribute Requirements", ["explicit.stat_3639275092"], 10, true, true, undefined],
    ["10% increased Mana Cost of Skills", ["explicit.stat_474294393"], 10, true, true, undefined],
    ["20% reduced Movement Speed", ["explicit.stat_2250533757"], 20, true, true, undefined],
    ["Adds 5 to 10 Fire Damage", ["explicit.stat_321077055", "explicit.stat_709508406"], 7.5, false, true, undefined],
    ["Bathed in the Blood of 7000 Sacrificed in the Name of Kaom", ["explicit.pseudo_timeless_jewel_kaom"], 7000, false, true, undefined],
    ["Frobnicate the widgets by 5", [], null, false, false, undefined],
    ["You have Onslaught while at maximum Endurance Charges", ["explicit.stat_3101915418"], null, false, true, undefined],
  ]);
  // the stat group is the id's prefix; a choice stat (an enchant) gives its option
  const enchant = await stats(["Allocates Heart of the Warrior", "+30 to maximum Life"], "enchant");
  assert.deepEqual(enchant.map((r) => [r.ids, r.option, r.value, r.found]), [[["enchant.stat_2954116742"], 61198, null, true], [[], undefined, 30, false]]);
  assert.deepEqual((await stats(["+30 to maximum Life"], "implicit"))[0]?.ids, ["implicit.stat_3299347043"]);
  assert.deepEqual((await stats(["Allocates Heart of the Warrior"]))[0], { line: "Allocates Heart of the Warrior", ids: [], value: null, inverted: false, found: false });
  assert.equal(await state(base), before0);
  // refusals
  const path = "/v1/lookup/trade-stats";
  await refused(path, { lines: [] }, 400, "invalid_input", /lines/);
  await refused(path, { lines: Array.from({ length: 51 }, () => "x") }, 400, "invalid_input", /lines/);
  await refused(path, { lines: ["x".repeat(501)] }, 400, "invalid_input", /lines\.0/);
  await refused(path, { lines: ["+1 to maximum Life"], type: "monster" }, 400, "invalid_input", /type/);
  assert.equal((await srv.call("GET", path)).status, 404, "the route takes POST only");
});

void test("trade_stats gives the ids the Buy similar rows hold, for every line of every row", async () => {
  for (const [slot, id] of [["Body Armour", base], ["Helmet", base], ["Belt", base], ["Ring 1", other]] as const) {
    const r = await similar({ slot, league: "Settlers", ...(id === other ? { other } : {}) });
    for (const row of r.mods) {
      for (const [i, line] of row.line.split("\n").entries()) {
        const [s] = await stats([line], row.type);
        assert.deepEqual(s?.ids, row.tradeIds, `${slot} row ${row.index} line ${i + 1}`);
        assert.equal(s?.found, row.canSearch, `${slot} row ${row.index}`);
        if (row.option !== null) assert.equal(s?.option, row.option);
        if (i === 0 && row.line.indexOf("\n") < 0 && row.option === null) assert.equal(s?.value, row.value, `${slot} row ${row.index} value`);
      }
    }
  }
  const jewel = await similar({ item: at.Jewel, league: "Settlers" });
  const [s] = await stats([jewel.mods[0]?.line ?? ""]);
  assert.deepEqual([s?.ids, s?.value], [jewel.mods[0]?.tradeIds, jewel.mods[0]?.value]);
});
