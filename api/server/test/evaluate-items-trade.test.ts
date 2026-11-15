// Worker tests for evaluate item_mods (Path of Building's trade weighting for gear slots, the Trade tab's "Find best"), on tree 3_30.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { routes } from "../src/routes.js";
import { FIXTURES, startServer, type TestServer } from "./helpers.js";

type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Mod = { id: string; text: string | null; weight: number; gain: number; invert: boolean; kind: string | null; range?: { min: number; max: number } };
type Group = { type: string; value?: { min: number }; filters: Array<{ id: string; value?: { weight?: number; min?: number } }> };
type Filters = Record<string, { disabled?: boolean; filters: Record<string, unknown> }>;
type Items = {
  slot: string; item: string; base: string; category: string; quality: number; total: number; mods: Mod[]; link: string | null; queryError: string | null;
  weights: Array<{ stat: string; weight: number }>; options: Record<string, unknown>;
  query: { stats: Group[]; filters: Filters; status: { option: string } } | null;
  search: { query: unknown; sort: unknown; engine: string } | null;
};

let srv: TestServer;
/** The Elementalist fixture with a rare in each of Weapon 1, Body Armour, Ring 1, Amulet and Belt, and a magic flask; Gloves stay empty. */
let base: string;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const post = <T>(path: string, body: Record<string, unknown>) => srv.call<T>("POST", path, body);
const route = (name: string) => routes.find((r) => r.name === name);
/** Every answer is also checked against the route's declared output, and its `search` against what trade.search takes for one search. */
const items = async (id: string, body: Record<string, unknown>) => {
  const result = ok(await post<Items>(`/v1/evaluate/${id}/item-mods`, body));
  const parsed = route("evaluate.item_mods")?.output.safeParse(result);
  assert.ok(parsed?.success, JSON.stringify(parsed?.error?.issues.slice(0, 3)));
  if (result.search) {
    const search = route("trade.search")?.input.safeParse({ league: "Standard", searches: [result.search] });
    assert.ok(search?.success, JSON.stringify(search?.error?.issues.slice(0, 3)));
  }
  return result;
};
const dup = async (id: string) => ok(await post<{ build: { id: string } }>(`/v1/builds/${id}/duplicate`, {})).build.id;
const state = async (id: string) =>
  JSON.stringify([ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code, ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision, ok(await srv.call<{ stats: unknown[] }>("GET", `/v1/stats/${id}/sidebar`)).stats]);
const output = async (id: string, field: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${field}`)).output[field] ?? Number.NaN;
const whatIf = async (id: string, slot: string, text: string, field: string) =>
  ok(await post<{ changed: Record<string, { before: number; after: number }> }>(`/v1/evaluate/${id}/what-if`, { slot, text, fields: [field] })).changed[field];
const fail = async (body: Record<string, unknown>, message: RegExp, id = base) => {
  const r = await post<unknown>(`/v1/evaluate/${id}/item-mods`, body);
  assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], JSON.stringify(body));
  assert.match(r.body.error?.message ?? "", message);
};

const gear: Record<string, string> = {
  "Weapon 1": "Rarity: RARE\nTest Wand\nCarved Wand\nImplicits: 0\n+10 to Intelligence",
  "Body Armour": "Rarity: RARE\nTest Robe\nVaal Regalia\nImplicits: 0\n+30 to maximum Life",
  "Ring 1": "Rarity: RARE\nTest Ring\nPrismatic Ring\nImplicits: 1\n+10% to all Elemental Resistances\n+20 to maximum Life",
  Amulet: "Rarity: RARE\nTest Amulet\nOnyx Amulet\nImplicits: 1\n+20 to all Attributes\n+20 to maximum Life",
  Belt: "Rarity: RARE\nTest Belt\nHeavy Belt\nImplicits: 0\n+20 to maximum Life",
  "Flask 1": "Rarity: MAGIC\nTest Flask\nDivine Life Flask",
};

before(async () => {
  srv = await startServer({ tradeLeague: "Standard" });
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  base = ok(await post<{ build: { id: string } }>("/v1/builds/import/xml", { xml })).build.id;
  for (const [slot, text] of Object.entries(gear)) ok(await post(`/v1/items/${base}/add`, { text, equip: slot }));
});
after(async () => {
  await srv?.close();
});

void test("item_mods Body Armour: the generator's weights for the slot's base, its search and link", async () => {
  const before0 = await state(base);
  const r = await items(base, { slot: "Body Armour", league: "Standard", limit: 4 });
  assert.equal(await state(base), before0, "item_mods changed the build");
  assert.deepEqual([r.slot, r.item, r.base, r.category, r.total, r.quality], ["Body Armour", "Test Robe", "Vaal Regalia", "armour.chest", 63, 0.5]);
  assert.deepEqual(r.weights, [{ stat: "FullDPS", weight: 1 }, { stat: "TotalEHP", weight: 0.5 }]);
  assert.deepEqual(r.mods.map((m) => [m.id, m.weight, m.gain, m.kind, m.text, m.range]), [
    ["implicit.stat_2154246560", 6.479, 291.568, "Corrupted", "45% increased Damage", { min: 40, max: 50 }],
    ["explicit.effect_3438910899", 275.132, 275.132, "Explicit", "Socketed Gems are Supported by Level 1 Arcane Surge Support", { min: 1, max: 1 }],
    ["implicit.stat_2176571093", 107.122, 214.245, "Corrupted", "+2 to Level of Socketed Projectile Gems", { min: 2, max: 2 }], // a tie in gain and weight: by trade id
    ["implicit.stat_2551600084", 107.122, 214.245, "Corrupted", "+2 to Level of Socketed AoE Gems", { min: 2, max: 2 }],
  ]);
  assert.ok(r.query);
  const [weight, and, not] = r.query.stats;
  assert.deepEqual([weight?.type, weight?.value, weight?.filters.length, and?.type, and?.filters, not?.type, not?.filters], ["weight", { min: 5.1439591258721 }, 33, "and", [], "not", []]);
  assert.deepEqual(r.query.filters, { type_filters: { filters: { category: { option: "armour.chest" }, rarity: { option: "nonunique" } } } });
  assert.deepEqual(r.query.status, { option: "securable" });
  // the weighted group is the weighed mods best first, each with its weight
  // (the generator's own sort leaves the two equal ones in its order, the answer lists them by trade id)
  assert.deepEqual(weight?.filters.slice(0, 4).map((f) => f.id).sort(), r.mods.map((m) => m.id).sort(), "the search weighs the mods the answer lists first");
  assert.equal(weight?.filters[0]?.id, "implicit.stat_2154246560");
  assert.ok(Math.abs((weight?.filters[0]?.value?.weight ?? 0) - 6.479) < 0.001);
  assert.deepEqual([r.search?.query, r.search?.sort, r.search?.engine], [r.query, { "statgroup.0": "desc" }, "new"]);
  const prefix = "https://www.pathofexile.com/trade/search/Standard/";
  assert.ok(r.link?.startsWith(prefix), r.link ?? "no link");
  const seg = (r.link ?? "").slice(prefix.length);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8")), r.query);
  assert.ok((await items(base, { slot: "Body Armour", limit: 1 })).link?.startsWith(prefix), "no league: the link is for the server's configured one");
});

void test("item_mods Weapon 1: the category follows the weapon's base; Ring 1: equal gains are ordered by trade id", async () => {
  const w = await items(base, { slot: "Weapon 1", limit: 3 });
  assert.deepEqual([w.category, w.base, w.total, w.query?.stats[0]?.value, w.query?.stats[0]?.filters.length], ["weapon.wand", "Carved Wand", 45, { min: 0.42866326048932 }, 33]);
  assert.deepEqual(w.query?.filters.type_filters?.filters, { category: { option: "weapon.wand" }, rarity: { option: "nonunique" } });
  assert.deepEqual(w.mods.map((m) => [m.id, m.weight, m.gain, m.text]), [
    ["explicit.stat_3962278098", 5.158, 309.461, "60% increased Fire Damage"],
    ["explicit.stat_2974417149", 4.757, 285.411, "60% increased Spell Damage"],
    ["explicit.stat_3141070085", 6.479, 220.296, "34% increased Elemental Damage"],
  ]);
  const ring = await items(base, { slot: "Ring 1", limit: 3 });
  assert.deepEqual([ring.category, ring.total, ring.query?.stats[0]?.value, ring.query?.stats[0]?.filters.length], ["accessory.ring", 63, { min: 15.815639452785 }, 33]);
  assert.deepEqual(ring.mods.map((m) => [m.id, m.weight, m.gain, m.kind]), [
    ["explicit.stat_3141070085", 6.481, 181.457, "Explicit"],
    ["implicit.stat_2154246560", 6.48, 129.602, "Corrupted"],
    ["implicit.stat_3141070085", 6.48, 129.602, "Implicit"],
  ]);
  const belt = await items(base, { slot: "Belt", limit: 200 });
  assert.equal(belt.category, "accessory.belt");
  // fewer mods than the search can hold: every weighed mod is in it, but the resistance and attribute ones (the generator leaves hybrids out and folds the rest into pseudo totals)
  const ids = new Set(belt.query?.stats[0]?.filters.map((f) => f.id));
  assert.equal(ids.size, 26);
  assert.ok(belt.total > ids.size);
  for (const m of belt.mods) if (!ids.has(m.id)) assert.match(m.text ?? "", /Resistance|Strength|Dexterity|Intelligence|Attributes/, m.id);
  assert.ok(belt.mods.every((m) => m.weight !== 0 && m.gain > 0));
});

void test("item_mods ground truth: a rare of the slot's base with only the mod measures the gain the answer gives, and the order holds", async () => {
  // one stat weighed (Combined DPS), so the gain is 1000 x (mod item - blank item) / the build now
  for (const [slot, baseName] of [["Body Armour", "Vaal Regalia"], ["Ring 1", "Prismatic Ring"], ["Weapon 1", "Carved Wand"]] as const) {
    const r = await items(base, { slot, weights: [{ stat: "CombinedDPS", weight: 1 }], limit: 10 });
    assert.equal(r.mods.length, 10);
    const now = await output(base, "CombinedDPS");
    const blank = (await whatIf(base, slot, `Rarity: RARE\nBlank\n${baseName}`, "CombinedDPS"))?.after ?? now;
    const measured: number[] = [];
    for (const m of r.mods) {
      const line = m.text ?? assert.fail(`no text for ${m.id}`);
      const withMod = (await whatIf(base, slot, `Rarity: RARE\nProbe\n${baseName}\nImplicits: 0\n${line}`, "CombinedDPS"))?.after ?? now;
      measured.push((1000 * (withMod - blank)) / now);
    }
    r.mods.forEach((m, i) => assert.ok(Math.abs((measured[i] ?? Number.NaN) - m.gain) < 0.05, `${slot} ${m.text}: measured ${measured[i]}, answered ${m.gain}`));
    const [top, tenth] = [measured[0] ?? Number.NaN, measured[9] ?? Number.NaN];
    assert.ok(top > 0 && top > tenth, `${slot}: the top mod gains more than the tenth (${top} > ${tenth})`);
    assert.ok(measured.every((v, i) => i === 0 || (measured[i - 1] ?? 0) >= v - 0.05), `${slot}: measured gains fall down the list`);
  }
});

void test("item_mods options change the query as the popup's do", async () => {
  const all = await items(base, { slot: "Body Armour", limit: 200 });
  const corrupted = all.mods.filter((m) => m.kind === "Corrupted").map((m) => m.id);
  assert.ok(corrupted.length > 0);
  const none = await items(base, { slot: "Body Armour", includeCorrupted: false, limit: 200 });
  assert.ok(none.total < all.total && none.mods.every((m) => m.kind !== "Corrupted"));
  for (const id of corrupted) assert.ok(!none.mods.some((m) => m.id === id) && !JSON.stringify(none.query).includes(id), `${id} is gone with includeCorrupted false`);
  assert.equal(none.options.includeCorrupted, false);

  const q = await items(base, { slot: "Body Armour", includeMirrored: false, sockets: 4, links: 4, maxLevel: 70, maxPrice: 25, priceCurrency: "divine", tradeType: "any", limit: 1 });
  assert.deepEqual(q.query?.filters, {
    type_filters: { filters: { category: { option: "armour.chest" }, rarity: { option: "nonunique" } } },
    misc_filters: { disabled: false, filters: { mirrored: false } },
    trade_filters: { filters: { price: { option: "divine", max: 25 } } },
    req_filters: { disabled: false, filters: { lvl: { max: 70 } } },
    socket_filters: { disabled: false, filters: { sockets: { min: 4, max: 4 }, links: { min: 4, max: 4 } } },
  });
  assert.deepEqual(q.query?.status, { option: "any" });
  // the search holds (200 - 62 points) minus 3 for each of the five filters, 4 per weight, while 8 points remain: 29 weights
  assert.equal(q.query?.stats[0]?.filters.length, 29);
  assert.deepEqual([q.options.sockets, q.options.links, q.options.maxLevel, q.options.maxPrice, q.options.priceCurrency], [4, 4, 70, 25, "divine"]);

  const req = await items(base, {
    slot: "Body Armour",
    requiredMods: [{ id: "explicit.stat_3299347043", min: 20 }],
    blockedMods: [{ id: "pseudo.pseudo_total_fire_resistance", min: 1 }],
    limit: 1,
  });
  assert.deepEqual(req.query?.stats[1], { type: "and", filters: [{ id: "explicit.stat_3299347043", value: { min: 20 } }] });
  assert.deepEqual(req.query?.stats[2], { type: "not", filters: [{ id: "pseudo.pseudo_total_fire_resistance", value: { min: 1 } }] });
  assert.equal(req.query?.stats[0]?.filters.length, 31, "the two stat rows cost 8 points: 31 weights");

  // the popup's per-slot controls
  const amulet = await items(base, { slot: "Amulet", limit: 200 });
  assert.ok(amulet.mods.every((m) => m.kind !== "Enchant" && m.kind !== "Eater" && m.kind !== "Exarch"), "talisman and eldritch off by default");
  const talisman = await items(base, { slot: "Amulet", includeTalisman: true, limit: 200 });
  assert.ok(talisman.mods.some((m) => m.kind === "Enchant"), "includeTalisman weighs talisman enchants");
  const eldritch = await items(base, { slot: "Body Armour", includeEldritch: "Keep regular", limit: 200 });
  assert.ok(eldritch.mods.some((m) => m.kind === "Eater" || m.kind === "Exarch"), "Keep regular weighs eldritch implicits");
  assert.ok(eldritch.total > all.total);
  assert.equal((await items(base, { slot: "Body Armour", includeEldritch: "Remove", limit: 200 })).total, all.total);
  // this version's mod data has no scourge mods for gear: the box changes the options the generator is given, and nothing else
  const scourge = await items(base, { slot: "Body Armour", league: "Standard", limit: 200 });
  assert.deepEqual([scourge.options.includeScourge, scourge.total], [true, all.total]);
  assert.equal((await items(base, { slot: "Body Armour", league: "Standard", includeScourge: false, limit: 200 })).options.includeScourge, false);

  const weightsOf = (r: Items) => r.mods.map((m) => m.gain);
  const heavy = await items(base, { slot: "Body Armour", weights: [{ stat: "Life", weight: 1 }], quality: 1, limit: 5 });
  assert.deepEqual(heavy.weights, [{ stat: "Life", weight: 1 }]);
  assert.equal(heavy.quality, 1);
  assert.notDeepEqual(weightsOf(heavy), weightsOf(await items(base, { slot: "Body Armour", limit: 5 })));
  assert.ok(heavy.mods.every((m) => m.range && m.text?.includes(String(m.range.max))), "quality 1 tests each mod at the top of its range");
});

void test("item_mods refuses an option the slot's popup does not show, naming the slot", async () => {
  await fail({ slot: "Body Armour", includeTalisman: true }, /includeTalisman.*Body Armour/);
  await fail({ slot: "Ring 1", includeEldritch: "Remove" }, /includeEldritch.*Ring 1/);
  await fail({ slot: "Weapon 1", includeEldritch: "Keep regular" }, /includeEldritch.*Weapon 1/);
  await fail({ slot: "Belt", links: 4 }, /links.*Belt/);
  await fail({ slot: "Ring 1", links: 4 }, /links.*Ring 1/);
  await fail({ slot: "Amulet", links: 4 }, /links.*Amulet/);
  await fail({ slot: "Flask 1", sockets: 2 }, /sockets.*Flask 1/);
  // the popup shows scourge mods only in Standard or Hardcore: a server whose league is another one refuses the option (the main server's is Standard)
  await fail({ slot: "Body Armour", includeScourge: true, league: "Settlers" }, /league Settlers is refused.*Standard/);
  const other = await startServer({ tradeLeague: "Settlers" });
  try {
    const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
    const id = ok(await other.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).build.id;
    ok(await other.call("POST", `/v1/items/${id}/add`, { text: gear["Body Armour"], equip: "Body Armour" }));
    for (const body of [{ slot: "Body Armour", includeScourge: true }, { slot: "Body Armour", includeScourge: true, league: "Settlers" }]) {
      const r = await other.call("POST", `/v1/evaluate/${id}/item-mods`, body);
      assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], JSON.stringify(body));
      assert.match(r.body.error?.message ?? "", /includeScourge.*Body Armour.*Standard/);
    }
  } finally {
    await other.close();
  }
  // and shows it where it does
  assert.equal((await items(base, { slot: "Belt", sockets: 1, limit: 1 })).query?.filters.socket_filters?.filters.sockets !== undefined, true);
  assert.equal((await items(base, { slot: "Amulet", includeTalisman: false, limit: 1 })).options.includeTalisman, false);
});

void test("item_mods refuses what it cannot answer: unknown or empty slots, bad weights, quality and stat rows; an unknown build is 404", async () => {
  await fail({ slot: "Weapon 1 Swap" }, /slot/);
  await fail({ slot: "Jewel 41263" }, /slot/);
  await fail({}, /slot/);
  await fail({ slot: "Gloves" }, /Gloves holds no item/);
  await fail({ slot: "Ring 2" }, /Ring 2 holds no item/);
  await fail({ slot: "Ring 3" }, /Ring 3 is not in use/);
  await fail({ slot: "Body Armour", weights: [] }, /weights/);
  await fail({ slot: "Body Armour", weights: [{ stat: "NoSuchStat", weight: 1 }] }, /unknown stat NoSuchStat/);
  await fail({ slot: "Body Armour", weights: [{ stat: "Life", weight: 2 }] }, /weight/);
  await fail({ slot: "Body Armour", quality: 1.5 }, /quality/);
  await fail({ slot: "Body Armour", quality: -0.1 }, /quality/);
  await fail({ slot: "Body Armour", tradeType: "offline" }, /tradeType/);
  await fail({ slot: "Body Armour", requiredMods: [{ id: "explicit.stat_0", min: 1 }] }, /requiredMods id explicit.stat_0/);
  await fail({ slot: "Body Armour", blockedMods: [{ id: "implicit.stat_1", min: 1 }] }, /blockedMods id implicit.stat_1/);
  await fail({ slot: "Body Armour", requiredMods: [{ id: "explicit.stat_3299347043" }] }, /min/);
  await fail({ slot: "Body Armour", requiredMods: [{ id: "explicit.stat_3299347043", min: 1 }, { id: "explicit.stat_3299347043", min: 1 }, { id: "explicit.stat_3299347043", min: 1 }, { id: "explicit.stat_3299347043", min: 1 }, { id: "explicit.stat_3299347043", min: 1 }, { id: "explicit.stat_3299347043", min: 1 }] }, /requiredMods/);
  await fail({ slot: "Body Armour", sockets: 7 }, /sockets/);
  const missing = await post<unknown>("/v1/evaluate/0123456789abcdef/item-mods", { slot: "Body Armour" });
  assert.deepEqual([missing.status, missing.body.error?.code], [404, "not_found"]);
});

void test("item_mods answers the same twice; the build's code and revision are unchanged; flasks answer what the generator has for them", async () => {
  const id = await dup(base);
  const before0 = await state(id);
  const pool = srv.runtime.svc.pool;
  await pool.run(id, "worker.reach"); // from zero
  const a = await items(id, { slot: "Body Armour", league: "Standard", limit: 200 });
  const b = await items(id, { slot: "Body Armour", league: "Standard", limit: 200 });
  assert.deepEqual(a, b);
  assert.deepEqual(await items(id, { slot: "Ring 1", limit: 200 }), await items(id, { slot: "Ring 1", limit: 200 }));
  assert.equal(await state(id), before0);
  // the search is only built: no sub-script, link or file outside the state dir
  assert.deepEqual(await pool.run(id, "worker.reach").then((x) => x.result), { subScripts: 0, urls: 0, writes: [] });
  // a flask: Path of Building weighs flask mods and finds none that gain here, and says so
  const flask = await items(id, { slot: "Flask 1" });
  assert.deepEqual([flask.category, flask.total, flask.query, flask.search, flask.link], ["flask", 0, null, null, null]);
  assert.match(flask.queryError ?? "", /no mods/);
  // a two-hander in Weapon 1: its category is the staff's
  ok(await post(`/v1/items/${id}/add`, { text: "Rarity: RARE\nTest Staff\nPrimordial Staff\nImplicits: 0", equip: "Weapon 1" }));
  const staff = await items(id, { slot: "Weapon 1", limit: 1 });
  assert.equal(staff.category, "weapon.staff");
});
