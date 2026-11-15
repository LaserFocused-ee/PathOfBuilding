// Worker tests for evaluate jewel_mods (Path of Building's trade weighting for jewels) and compare_item in jewel sockets, on tree 3_30.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { routes } from "../src/routes.js";
import { FIXTURES, startServer, type TestServer } from "./helpers.js";

type Value = number | string | boolean | null;
type Changed = Record<string, { before: Value; after: Value }>;
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Mod = { id: string; text: string | null; weight: number; gain: number; affix?: string | null; group?: string | null; kind?: string; bases?: string[]; rollable?: boolean; notable?: string; level?: number };
type Combo = { mods: string[]; gain: number; estimate: number; base?: string; text?: string; changed: Changed };
type Stats = Array<{ type: string; value?: { min: number }; filters: Array<{ id: string; value?: { weight: number } }> }>;
type Jewels = {
  family: string; socket?: string; category: string; total: number; mods: Mod[]; combinations: Combo[]; link: string | null; enchantId?: string;
  query: { stats: Stats; filters: Record<string, { filters: Record<string, unknown> }>; status: { option: string }; type?: string; name?: string };
  search: { query: unknown; sort: unknown; engine: string };
};

let srv: TestServer;
/** The Elementalist fixture with a Basic Jewel Socket (41263, 4 points) and a Large Jewel Socket (21984, 8 points) allocated, both empty. */
let base: string;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const post = <T>(path: string, body: Record<string, unknown>) => srv.call<T>("POST", path, body);
const declared = (name: string) => routes.find((r) => r.name === name)?.output;
/** Every answer is also checked against the route's declared output. */
const jewels = async (id: string, body: Record<string, unknown>) => {
  const result = ok(await post<Jewels>(`/v1/evaluate/${id}/jewel-mods`, body));
  const parsed = declared("evaluate.jewel_mods")?.safeParse(result);
  assert.ok(parsed?.success, JSON.stringify(parsed?.error?.issues.slice(0, 3)));
  return result;
};
const compare = async (id: string, body: Record<string, unknown>) => {
  const result = ok(await post<{ slots: Array<{ slot: string; equipped: string | null; changed: Changed; points?: number }> }>(`/v1/evaluate/${id}/compare-item`, body));
  assert.ok(declared("evaluate.compare_item")?.safeParse(result).success, "compare_item answer matches its declared output");
  return result.slots;
};
const dup = async (id: string) => ok(await post<{ build: { id: string } }>(`/v1/builds/${id}/duplicate`, {})).build.id;
const output = async (id: string, fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
const state = async (id: string) =>
  JSON.stringify([ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code, ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision, ok(await srv.call<{ stats: unknown[] }>("GET", `/v1/stats/${id}/sidebar`)).stats]);

const jewel = "Rarity: RARE\nTest Jewel\nCobalt Jewel\nImplicits: 0\n15% increased Fire Damage\n9% increased Damage\n4% increased Cast Speed with Fire Skills\n11% increased Projectile Damage";
const cluster = "Rarity: RARE\nTest Cluster\nLarge Cluster Jewel\nItem Level: 84\nImplicits: 3\nAdds 8 Passive Skills\n2 Added Passive Skills are Jewel Sockets\nAdded Small Passive Skills grant: 12% increased Fire Damage\n1 Added Passive Skill is Burning Bright\n1 Added Passive Skill is Prodigious Defence";
const fail = async (body: Record<string, unknown>, message: RegExp) => {
  const r = await post<unknown>(`/v1/evaluate/${base}/jewel-mods`, body);
  assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], JSON.stringify(body));
  assert.match(r.body.error?.message ?? "", message);
};

before(async () => {
  srv = await startServer();
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  base = ok(await post<{ build: { id: string } }>("/v1/builds/import/xml", { xml })).build.id;
  ok(await post("/v1/tree/" + base + "/allocate", { nodes: [41263, 21984] }));
});
after(async () => {
  await srv?.close();
});

void test("jewel_mods base: mods weighed one at a time in the regular socket, the best legal set measured together, Path of Building's search and link", async () => {
  const before0 = await state(base);
  const r = await jewels(base, { family: "base", league: "Standard", limit: 3, combinations: 1 });
  assert.equal(await state(base), before0, "jewel_mods changed the build");
  assert.deepEqual([r.socket, r.category, r.total], ["Jewel 41263", "jewel.base", 48]); // the regular socket before the Large one
  assert.deepEqual(r.mods.map((m) => [m.id, m.text, m.weight, m.gain, m.affix, m.group, m.rollable]), [
    ["explicit.stat_3962278098", "15% increased Fire Damage", 5.319, 79.785, "Prefix", "FireDamageForJewel", true],
    ["explicit.stat_2154246560", "9% increased Damage", 6.675, 60.076, "Suffix", "DamageForJewel", true],
    ["explicit.stat_1839076647", "11% increased Projectile Damage", 4.905, 53.958, "Suffix", "ProjectileDamageForJewel", true],
  ]);
  const [c] = r.combinations;
  assert.ok(c);
  assert.deepEqual([c.mods, c.gain, c.estimate, c.base], [["explicit.stat_3962278098", "explicit.stat_1476643878", "explicit.stat_2154246560", "explicit.stat_1839076647"], 233.68, 227.05, "Cobalt Jewel"]);
  assert.equal(c.text, "15% increased Fire Damage\n4% increased Cast Speed with Fire Skills\n9% increased Damage\n11% increased Projectile Damage");
  assert.deepEqual(c.changed.WithIgniteDPS, { before: 7672.7473304598, after: 9465.7168820134 });

  // the trade search: a weighted sum of 33 mods, minimum half the current jewel's value (none here), category and status as the popup sets them
  assert.deepEqual([r.query.stats[0]?.type, r.query.stats[0]?.value, r.query.stats[0]?.filters.length], ["weight", { min: 0 }, 33]);
  assert.deepEqual(r.query.filters.type_filters?.filters, { category: { option: "jewel.base" }, rarity: { option: "nonunique" } });
  assert.deepEqual(r.query.status, { option: "securable" });
  assert.deepEqual(r.query.stats[0]?.filters[0], { id: "explicit.stat_3962278098", value: { weight: 5.3189885091069 } });
  assert.deepEqual([r.search.query, r.search.sort, r.search.engine], [r.query, { "statgroup.0": "desc" }, "new"]);
  const prefix = "https://www.pathofexile.com/trade/search/Standard/";
  assert.ok(r.link?.startsWith(prefix), r.link ?? "no link");
  const seg = (r.link ?? "").slice(prefix.length);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8")), r.query);
  assert.equal((await jewels(base, { family: "base", limit: 1, combinations: 0 })).link, null, "no league, no link");

  // the set equals that jewel compared in the socket and equipped for real
  assert.deepEqual((await compare(base, { slot: "Jewel 41263", text: `Rarity: RARE\nSet\n${c.base}\n${c.text}`, fields: ["CombinedDPS"] }))[0]?.changed.CombinedDPS, { before: 7672.7473304598, after: 9465.7168820134 });
  const real = await dup(base);
  ok(await post(`/v1/items/${real}/add`, { text: `Rarity: RARE\nSet\n${c.base}\n${c.text}`, equip: "Jewel 41263" }));
  assert.equal((await output(real, "CombinedDPS")).CombinedDPS, 9465.7168820134);
});

void test("jewel_mods with a jewel in the socket: the search minimum is half that jewel's value; the default socket moves to the next empty one", async () => {
  const id = await dup(base);
  ok(await post(`/v1/items/${id}/add`, { text: jewel, equip: "Jewel 41263" }));
  const r = await jewels(id, { family: "base", socket: "Jewel 41263", limit: 1, combinations: 0 });
  assert.deepEqual([r.socket, r.query.stats[0]?.value, r.mods[0]?.id, r.mods[0]?.gain], ["Jewel 41263", { min: 94.708598086244 }, "explicit.stat_3962278098", 64.672]);
  assert.equal((await jewels(id, { family: "base", limit: 1, combinations: 0 })).socket, "Jewel 21984");
  assert.equal((await jewels(id, { family: "base", socket: 41263, limit: 1, combinations: 0 })).socket, "Jewel 41263", "a node id names the socket too");
});

void test("jewel_mods abyss: mods no abyss base rolls are flagged and kept out of sets; every set is legal", async () => {
  const r = await jewels(base, { family: "abyss", limit: 200, combinations: 5 });
  assert.deepEqual([r.socket, r.category, r.total], ["Jewel 41263", "jewel.abyss", 58]);
  assert.deepEqual(r.mods.slice(0, 3).map((m) => [m.text, m.gain, m.affix, m.rollable]), [
    ["70% increased Elemental Damage", 467.493, "Either", false], // a weapon delve mod in the abyss list (weight 0 on every abyss base)
    ["25% increased Fire Damage", 132.878, "Prefix", false],
    ["Damage Penetrates 8% Fire Resistance", 87.874, "Prefix", true],
  ]);
  assert.deepEqual(r.combinations.slice(0, 2).map((c) => [c.mods, c.gain, c.base]), [
    [["explicit.stat_2653955271", "explicit.stat_2101383955", "explicit.stat_690707482", "explicit.stat_1133016593"], 227.07, "Assembled Eye Jewel"],
    [["explicit.stat_2653955271", "explicit.stat_818778753", "explicit.stat_690707482", "explicit.stat_1133016593"], 213.682, "Assembled Eye Jewel"],
  ]);
  const byId = new Map(r.mods.map((m) => [m.id, m]));
  for (const c of r.combinations) {
    const ms = c.mods.map((id) => byId.get(id));
    assert.ok(ms.every((m) => m?.bases?.includes(c.base ?? "")), "every mod rolls on the set's base");
    assert.ok(ms.filter((m) => m?.affix === "Prefix").length <= 2 && ms.filter((m) => m?.affix === "Suffix").length <= 2, "two prefixes and two suffixes at most");
    assert.equal(new Set(ms.map((m) => m?.group)).size, ms.length, "distinct mod groups");
  }
  const life = await jewels(base, { family: "abyss", weights: [{ stat: "Life", weight: 1 }], limit: 2, combinations: 0 });
  assert.deepEqual(life.mods.map((m) => [m.text, m.gain]), [["4% increased maximum Life", 33.886], ["+31 to maximum Life", 27.108]]);
});

void test("jewel_mods cluster: the enchant's notables weighed alone, sets of up to three, a search for that base and enchant", async () => {
  const r = await jewels(base, { family: "cluster", size: "Large", enchant: "Fire Damage", limit: 3, combinations: 2, minItemLevel: 75, league: "Standard" });
  assert.deepEqual([r.category, r.total, r.enchantId], ["jewel.cluster", 9, "enchant.stat_3948993189|13"]);
  assert.deepEqual(r.mods.map((m) => [m.notable, m.weight, m.gain, m.affix, m.level]), [
    ["Prismatic Heart", 226.94, 226.94, "Prefix", 1],
    ["Smoking Remains", 186.172, 186.172, "Prefix", 50],
    ["Doryani's Lesson", 166.894, 166.894, "Suffix", 68],
  ]);
  assert.deepEqual(r.combinations.map((c) => [c.mods, c.gain, c.estimate]), [
    [["explicit.stat_2342448236", "explicit.stat_228455793", "explicit.stat_1462135249"], 610.317, 551.616],
    [["explicit.stat_2342448236", "explicit.stat_3206911230", "explicit.stat_1462135249"], 610.317, 551.616],
  ]);
  assert.deepEqual([r.query.type, r.query.stats[0]?.value, r.query.stats[0]?.filters.length, r.query.stats[1]?.filters], ["Large Cluster Jewel", { min: 226.94 }, 9, [{ id: "enchant.stat_3948993189|13" }]]);
  assert.deepEqual(r.query.filters.misc_filters?.filters.ilvl, { min: 75 });
  assert.ok(r.link?.startsWith("https://www.pathofexile.com/trade/search/Standard/"));
  const medium = await jewels(base, { family: "cluster", size: "Small", enchant: "Fire Resistance", limit: 1, combinations: 3 });
  assert.ok(medium.combinations.every((c) => c.mods.length === 1), "a small cluster holds one notable");
});

void test("jewel_mods watchers_eye: the unique's search by name", async () => {
  const r = await jewels(base, { family: "watchers_eye", limit: 1, combinations: 3 });
  assert.deepEqual([r.socket, r.category, r.query.name, r.query.filters.type_filters?.filters.rarity, r.combinations], ["Jewel 41263", "jewel", "Watcher's Eye", { option: "unique" }, []]);
});

void test("compare_item in a jewel socket: a pasted jewel against the empty socket; a cluster jewel equipped for real with its passives, build left as it was", async () => {
  const s0 = await state(base);
  const [plain] = await compare(base, { slot: "Jewel 41263", text: jewel, fields: ["CombinedDPS"] });
  assert.ok(plain);
  assert.deepEqual([plain.slot, plain.equipped, plain.changed.CombinedDPS, plain.points], ["Jewel 41263", null, { before: 7672.7473304598, after: 9465.7168820134 }, undefined]);
  const [big] = await compare(base, { slot: "Jewel 21984", text: cluster, fields: ["CombinedDPS", "TotalEHP"] });
  assert.ok(big);
  assert.deepEqual([big.points, big.changed], [7, { CombinedDPS: { before: 7672.7473304598, after: 9971.5284744604 }, TotalEHP: { before: 972.53057485765, after: 1014.4189686585 } }]);
  assert.equal(await state(base), s0, "compare_item changed the build");
  const r = await post<unknown>(`/v1/evaluate/${base}/compare-item`, { text: jewel });
  assert.equal(r.status, 400, "a jewel names its socket");
  const off = await post<unknown>(`/v1/evaluate/${base}/compare-item`, { slot: "Jewel 36634", text: jewel });
  assert.deepEqual([off.status, off.body.error?.code], [400, "invalid_input"]);
});

void test("jewel_mods refusals", async () => {
  await fail({ family: "cluster", size: "Large" }, /enchant is one of the Large cluster's: Attack Damage, /);
  await fail({ family: "cluster", enchant: "Fire Damage" }, /size/);
  await fail({ family: "base", socket: 36634 }, /Jewel 36634 is not in use/);
  await fail({ family: "base", socket: "Helmet" }, /no jewel socket Helmet/);
  await fail({ family: "unique" }, /family/);
  await fail({ family: "base", league: "x/../y" }, /league/);
  await fail({ family: "base", weights: [{ stat: "Name", weight: 1 }] }, /cannot weigh items|unknown stat/);
  await fail({ family: "base", weights: [{ stat: "Life", weight: 0 }] }, /weight/);
});

void test("tree radius_nodes: the passives in each radius of a socket, as radius jewels see them", async () => {
  type Radii = { socket: number; allocated: boolean; radii: Array<{ index: number; label: string; inner: number; outer: number; total: number; allocated: number; nodes: Array<{ id: number; name: string; type: string; allocated: boolean }> }> };
  const all = ok(await srv.call<Radii>("GET", `/v1/tree/${base}/radius-nodes?socket=Jewel%2041263`));
  assert.deepEqual([all.socket, all.allocated, all.radii.map((r) => [r.index, r.label, r.inner, r.outer, r.total, r.allocated])], [41263, true, [
    [1, "Small", 0, 960, 13, 2], [2, "Medium", 0, 1440, 29, 6], [3, "Large", 0, 1800, 50, 8], [4, "Very Large", 0, 2400, 106, 10], [5, "Massive", 0, 2880, 164, 14],
  ]]);
  assert.deepEqual(all.radii[0]?.nodes.filter((n) => n.allocated || n.type === "Notable").map((n) => [n.id, n.name, n.type, n.allocated]), [
    [11784, "Vampirism", "Notable", false], [18865, "Melding", "Notable", false], [37671, "Intelligence", "Normal", true], [48778, "Intelligence", "Normal", true],
  ]);
  const ring = ok(await srv.call<Radii>("GET", `/v1/tree/${base}/radius-nodes?socket=41263&radius=6`));
  assert.deepEqual(ring.radii.map((r) => [r.label, r.inner, r.outer, r.total]), [["Variable", 960, 1320, 12]]);
  assert.equal((await srv.call("GET", `/v1/tree/${base}/radius-nodes?socket=Elemental%20Overload`)).status, 400, "not a socket");
  assert.equal((await srv.call("GET", `/v1/tree/${base}/radius-nodes?socket=41263&radius=11`)).status, 400, "no such radius");
});
