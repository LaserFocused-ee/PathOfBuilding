// Worker tests for evaluate jewel_mods (Path of Building's trade weighting for jewels) and compare_item in jewel sockets, on tree 3_30.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { routes } from "../src/routes.js";
import { FIXTURES, ROOT, startServer, type TestServer } from "./helpers.js";

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
  srv = await startServer({ tradeLeague: "Covens" });
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  base = ok(await post<{ build: { id: string } }>("/v1/builds/import/xml", { xml })).build.id;
  ok(await post("/v1/tree/" + base + "/allocate", { nodes: [41263, 21984] }));
});
after(async () => {
  await srv?.close();
});

void test("jewel_mods base: mods weighed one at a time in the regular socket, the best legal set measured together, Path of Building's search and link", async () => {
  const before0 = await state(base);
  const r = await jewels(base, { family: "base", league: "Covens", limit: 3, combinations: 1 });
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
  const prefix = "https://www.pathofexile.com/trade/search/Covens/";
  assert.ok(r.link?.startsWith(prefix), r.link ?? "no link");
  const seg = (r.link ?? "").slice(prefix.length);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8")), r.query);
  assert.ok((await jewels(base, { family: "base", limit: 1, combinations: 0 })).link?.startsWith(prefix), "no league: the link is for the server's configured one");

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

void test("jewel_mods abyss: only mods an abyss base rolls; every set is legal", async () => {
  const r = await jewels(base, { family: "abyss", limit: 200, combinations: 5 });
  assert.deepEqual([r.socket, r.category, r.total], ["Jewel 41263", "jewel.abyss", 36]);
  assert.deepEqual(r.mods.slice(0, 3).map((m) => [m.text, m.gain, m.affix, m.rollable]), [
    ["Adds 23 to 23 Fire Damage to Spells", 36.06, "Suffix", true],
    ["5% increased Damage", 33.32, null, undefined], // a corrupted implicit: no affix, rolled by corruption
    ["18% increased Damage with Ailments", 31.934, "Suffix", true],
  ]);
  // The abyss list holds only mods an abyss base rolls since lf-src-fixes-3 (weapon delve mods with weight 0 on every abyss base are gone).
  assert.equal(r.mods.filter((m) => m.rollable === false).length, 0);
  assert.deepEqual(r.combinations.slice(0, 2).map((c) => [c.mods, c.gain, c.base]), [
    [["explicit.stat_2101383955", "explicit.stat_3299347043", "explicit.stat_1133016593", "explicit.stat_690707482"], 98.297, "Assembled Eye Jewel"],
    [["explicit.stat_2101383955", "explicit.stat_3489782002", "explicit.stat_1133016593", "explicit.stat_690707482"], 98.297, "Assembled Eye Jewel"],
  ]);
  const byId = new Map(r.mods.map((m) => [m.id, m]));
  for (const c of r.combinations) {
    const ms = c.mods.map((id) => byId.get(id));
    assert.ok(ms.every((m) => m?.bases?.includes(c.base ?? "")), "every mod rolls on the set's base");
    assert.ok(ms.filter((m) => m?.affix === "Prefix").length <= 2 && ms.filter((m) => m?.affix === "Suffix").length <= 2, "two prefixes and two suffixes at most");
    assert.equal(new Set(ms.map((m) => m?.group)).size, ms.length, "distinct mod groups");
  }
  const life = await jewels(base, { family: "abyss", weights: [{ stat: "Life", weight: 1 }], limit: 2, combinations: 0 });
  assert.deepEqual(life.mods.map((m) => [m.text, m.gain]), [["+31 to maximum Life", 27.108], ["+14 to Strength", 6.024]]);
});

void test("jewel_mods cluster: the enchant's notables weighed alone, sets of up to three, a search for that base and enchant", async () => {
  const r = await jewels(base, { family: "cluster", size: "Large", enchant: "Fire Damage", limit: 3, combinations: 2, minItemLevel: 75, league: "Covens" });
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
  assert.ok(r.link?.startsWith("https://www.pathofexile.com/trade/search/Covens/"));
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
  // A timeless jewel whose seed line names no conqueror Path of Building knows: refused, the worker keeps running (was a 500).
  const pride = (leader: string) => `Rarity: Unique\nLethal Pride\nTimeless Jewel\nLimited to: 1 Historic\nRadius: Large\nCommanded leadership over 10000 warriors under ${leader}\nPassives in radius are Conquered by the Karui\nHistoric`;
  const unknown = await post<unknown>(`/v1/evaluate/${base}/compare-item`, { slot: "Jewel 41263", text: pride("Nobody") });
  assert.deepEqual([unknown.status, unknown.body.error?.message], [400, "Path of Building reads no conqueror on this timeless jewel (its seed line names none it knows), so it would change nothing"]);
  assert.equal((await compare(base, { slot: "Jewel 41263", text: jewel, fields: ["CombinedDPS"] }))[0]?.changed.CombinedDPS?.after, 9465.7168820134, "the same worker answers the next compare");
  assert.equal(await state(base), s0, "compare_item changed the build");
});

void test("unique_rank for jewels: one socket measured, the first allocated empty one or the one named", async () => {
  type Rank = { total: number; socket: string | null; uniques: Array<{ name: string; power: number }> };
  const now = ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${base}/output?fields=CombinedDPS`)).output.CombinedDPS ?? 0;
  const r = ok(await post<Rank>(`/v1/evaluate/${base}/unique-rank`, { slot: "Jewel", stat: "CombinedDPS", limit: 200 }));
  assert.equal(r.socket, "Jewel 41263");
  assert.ok((r.uniques[0]?.power ?? 0) > now, "the best jewel adds to the build in the empty socket");
  assert.ok(new Set(r.uniques.map((u) => u.power)).size > 10, "jewels are told apart");
  assert.equal(ok(await post<Rank>(`/v1/evaluate/${base}/unique-rank`, { slot: "Jewel", stat: "CombinedDPS", limit: 1, socket: 41263 })).socket, "Jewel 41263");
  const off = await post<unknown>(`/v1/evaluate/${base}/unique-rank`, { slot: "Helmet", stat: "CombinedDPS", socket: 41263 });
  assert.deepEqual([off.status, off.body.error?.message], [400, "socket is for slot Jewel"]);
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

void test("timeless: the Find Timeless Jewel dialog's search, seeds scored for the build, its trade search; the build is left as it was", async () => {
  type Timeless = { jewel: string; conqueror: string | null; count: number; results: Array<{ seed: number; total: number; socket: { id: number; label: string }; nodes: Array<{ id: string; name: string; targets: string[] }> }>; query: { stats: Stats; status: { option: string } } | null; search: { query: unknown; sort: unknown } | null; link: string | null };
  const timeless = async (body: Record<string, unknown>) => {
    const result = ok(await post<Timeless>(`/v1/evaluate/${base}/timeless`, body));
    assert.ok(declared("evaluate.timeless")?.safeParse(result).success, "timeless answer matches its declared output");
    return result;
  };
  const pool = srv.runtime.svc.pool;
  const before = await state(base);
  await pool.run(base, "worker.reach");
  // Generate: every passive Lethal Pride gives, weighed by Full DPS for this build.
  const dps = await timeless({ jewel: "Lethal Pride", socket: 41263, fallback: "Full DPS", limit: 3 });
  assert.deepEqual([dps.jewel, dps.conqueror, dps.count], ["Lethal Pride", "Any", 4860]);
  assert.ok(dps.link?.startsWith("https://www.pathofexile.com/trade/search/Covens/"), "no league: the link is for the server's configured one");
  assert.deepEqual(dps.results.map((r) => [r.total, r.socket.id]), [[18.51, 41263], [18.01, 41263], [18.01, 41263]]);
  assert.deepEqual([dps.results[0]?.seed, dps.results[0]?.nodes.map((n) => [n.id, n.targets])], [12663, [
    ["karui_notable_add_burning_damage", ["Dark Arts", "Melding"]], ["karui_notable_add_double_damage", ["Grave Intentions", "Steeped in the Profane", "Tolerance"]],
  ]]);
  // Open Trade URL: the best 4 seeds, each under the three conquerors' stats, count at least 1.
  const filters = dps.query?.stats[0]?.filters ?? [];
  assert.deepEqual([dps.query?.stats[0]?.type, filters.length, filters[0]], ["count", 12, { id: "explicit.pseudo_timeless_jewel_kaom", value: { min: 12663, max: 12663 } }]);
  assert.deepEqual(dps.search, { query: dps.query, sort: { price: "asc" } });
  // A named conqueror and wanted passive, by name, counting allocated nodes only; the link in the league played.
  const str = await timeless({ jewel: "lethal", conqueror: "Kaom", socket: "Jewel 41263", nodes: [{ node: "Total Strength", weight: 1 }], allocatedOnly: true, limit: 3, league: "Covens" });
  assert.deepEqual([str.conqueror, str.count, str.results.map((r) => r.total), str.results[0]?.nodes], ["Kaom (Strength of Blood)", 8001, [34, 34, 34], [{ id: "totalStat", name: "Strength", targets: ["Deep Wisdom"] }]]);
  assert.equal(str.query?.stats[0]?.filters.length, 11, "one seed per filter with one conqueror");
  assert.ok(str.query?.stats[0]?.filters.every((f) => f.id === "explicit.pseudo_timeless_jewel_kaom"));
  const seg = (str.link ?? "").match(/^https:\/\/www\.pathofexile\.com\/trade\/search\/Covens\/([\w-]+=*)$/)?.[1] ?? "";
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(seg.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8")), str.query, "the link carries the same search");
  // The seed table's unpacked cache is refused outside the state dir; the link is captured, never opened anywhere.
  assert.deepEqual(await pool.run(base, "worker.reach").then((r) => r.result), { subScripts: 0, urls: 2, writes: ["./Data/TimelessJewelData/LethalPride.bin", "./Data/TimelessJewelData/LethalPride.bin"] });
  assert.equal(existsSync(join(ROOT, "src/Data/TimelessJewelData/LethalPride.bin")), false, "nothing written next to the sources");
  assert.equal(await state(base), before, "code, revision and stats unchanged");
  for (const [body, message] of [
    [{ jewel: "a" }, /jewel "a" matches \d+ of: /],
    [{ jewel: "Lethal Pride" }, /give nodes, a fallback stat, or both/],
    [{ jewel: "Lethal Pride", nodes: [{ node: "Might of the Vaal" }] }, /nodes\[1\]: Might of the Vaal is not a passive Lethal Pride can give/],
    [{ jewel: "Lethal Pride", socket: 1, fallback: "Full DPS" }, /socket 1 is not a jewel socket/],
    [{ jewel: "Lethal Pride", fallback: "Nothing" }, /fallback "Sort by Nothing" matches 0 of: /],
    [{ jewel: "Lethal Pride", fallback: "Full DPS", league: "Standard" }, /^league Standard is refused: this server's trade league is Covens/],
  ] as const) {
    const r = await post<unknown>(`/v1/evaluate/${base}/timeless`, body);
    assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], JSON.stringify(body));
    assert.match(r.body.error?.message ?? "", message);
  }
  assert.equal(await state(base), before, "refusals leave the build as it was");
});
