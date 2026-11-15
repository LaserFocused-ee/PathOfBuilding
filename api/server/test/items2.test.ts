// Worker tests for the crafting ops of the Items tab (influence, corrupt, add_implicit, custom_mod, crucible_mod, cluster_jewel), on tree 3_30.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startServer, type TestServer } from "./helpers.js";

type Change = Record<string, { before: number | null; after: number | null }>;
type Mutated<T = Record<string, unknown>> = { result: T; changed: Change; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Detail = { id: number; rarity: string; corrupted: boolean; raw: string; enchants: string[]; implicits: string[]; explicits: string[]; equipped: string[] };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);

/** A new level 90 Witch / Elementalist on tree 3_30 with no items (Life 1125). */
async function newWitch(): Promise<string> {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" }));
  return r.build.id;
}
const output = async (id: string, fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
const get = async (id: string, item: number) => ok(await srv.call<Detail>("GET", `/v1/items/${id}/get?item=${item}`));
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const post = <T = Detail>(id: string, action: string, body: Record<string, unknown>) => srv.call<Mutated<T>>("POST", `/v1/items/${id}/${action}`, body);
/** Adds item text and equips it in the slot (the first valid one by default). */
const addItem = async (id: string, text: string, equip = "auto") => ok(await post(id, "add", { text, equip })).result.id;

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("influence sets the Influence dropdowns: Shaper and Elder items counted by their own mods, [] clears", async () => {
  const id = await newWitch();
  const coat = await addItem(id, "Rarity: RARE\nInfluenced Coat\nAstral Plate\n+10 to maximum Life per Shaper Item Equipped\n+7 to maximum Life per Elder Item Equipped");
  assert.equal((await output(id, "Life")).Life, 1125);

  const s = ok(await post(id, "influence", { item: coat, influences: ["Shaper"] }));
  assert.match(s.result.raw, /\nShaper Item\n/);
  assert.doesNotMatch(s.result.raw, /Elder Item\n/);
  assert.deepEqual(s.changed.Life, { before: 1125, after: 1135 }); // +10 for one Shaper item

  const both = ok(await post(id, "influence", { item: coat, influences: ["Shaper", "elder"] }));
  assert.match(both.result.raw, /\nShaper Item\nElder Item\n/);
  assert.deepEqual(both.changed.Life, { before: 1135, after: 1142 }); // 1125 + 10 + 7

  const none = ok(await post(id, "influence", { item: coat, influences: [] }));
  assert.doesNotMatch(none.result.raw, /(Shaper|Elder) Item\n/);
  assert.deepEqual(none.changed.Life, { before: 1142, after: 1125 });

  const exarch = ok(await post(id, "influence", { item: coat, influences: ["Searing Exarch"] }));
  assert.match(exarch.result.raw, /\nSearing Exarch Item\n/);

  const flask = await addItem(id, "Rarity: NORMAL\nQuicksilver Flask", "none");
  const rev = await revisionOf(id);
  fails(await post(id, "influence", { item: coat, influences: ["Nonsense"] }), 400, "invalid_input");
  fails(await post(id, "influence", { item: coat, influences: ["Shaper", "Shaper"] }), 400, "invalid_input");
  fails(await post(id, "influence", { item: coat, influences: ["Shaper", "Elder", "Hunter"] }), 400, "invalid_input");
  fails(await post(id, "influence", { item: flask, influences: ["Shaper"] }), 400, "invalid_input");
  fails(await post(id, "influence", { item: 99, influences: [] }), 404, "not_found");
  assert.equal(await revisionOf(id), rev);
});

void test("corrupt picks implicits in the Corrupt popup: +5% maximum Life moves Life by exactly 5%", async () => {
  const id = await newWitch();
  const coat = await addItem(id, "Rarity: RARE\nCorrupt Coat\nAstral Plate\n+10 to maximum Life");
  assert.equal((await output(id, "Life")).Life, 1135);
  const c = ok(await post(id, "corrupt", { item: coat, implicits: ["(4-6)% increased maximum Life"] }));
  assert.deepEqual([c.result.corrupted, c.result.implicits], [true, ["(4-6)% increased maximum Life"]]);
  assert.match(c.result.raw, /\nCorrupted$/);
  assert.deepEqual(c.changed.Life, { before: 1135, after: 1192 }); // (1125 + 10) x 1.05 at the default roll of the 4-6% range
  assert.equal((await output(id, "Life")).Life, 1192);

  const boots = await addItem(id, "Rarity: RARE\nCorrupt Boots\nIron Greaves", "none");
  const two = ok(await post(id, "corrupt", { item: boots, implicits: ["(4-6)% increased maximum Life", "(4-6)% increased maximum Energy Shield"] }));
  assert.deepEqual([two.result.corrupted, two.result.implicits], [true, ["(4-6)% increased maximum Life", "(4-6)% increased maximum Energy Shield"]]);
  const plain = await addItem(id, "Rarity: RARE\nPlain Gloves\nIron Gauntlets", "none");
  const empty = ok(await post(id, "corrupt", { item: plain, implicits: [] }));
  assert.deepEqual([empty.result.corrupted, empty.result.implicits], [true, []]);

  const fresh = await addItem(id, "Rarity: RARE\nFresh Coat\nAstral Plate", "none");
  const flask = await addItem(id, "Rarity: NORMAL\nQuicksilver Flask", "none");
  const rev = await revisionOf(id);
  fails(await post(id, "corrupt", { item: fresh, implicits: ["no such implicit"] }), 400, "invalid_input");
  fails(await post(id, "corrupt", { item: fresh, implicits: ["(4-6)% increased maximum Life", "(4-6)% increased maximum Life"] }), 400, "invalid_input");
  fails(await post(id, "corrupt", { item: flask, implicits: [] }), 400, "invalid_input");
  fails(await post(id, "corrupt", { item: fresh, implicits: ["a", "b", "c"] }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
  assert.equal((await get(id, fresh)).corrupted, false);
});

void test("add_implicit: a custom implicit and a Searing Exarch implicit change Life and movement speed", async () => {
  const id = await newWitch();
  const coat = await addItem(id, "Rarity: RARE\nImplicit Coat\nAstral Plate");
  const c = ok(await post(id, "add-implicit", { item: coat, text: "+25 to maximum Life" }));
  assert.deepEqual(c.result.implicits, ["+25 to maximum Life"]);
  assert.deepEqual(c.changed.Life, { before: 1125, after: 1150 });

  const boots = await addItem(id, "Rarity: RARE\nExarch Boots\nIron Greaves\nSearing Exarch Item");
  assert.equal((await output(id, "EffectiveMovementSpeedMod")).EffectiveMovementSpeedMod, 0.95); // Astral Plate slows by 5%
  const e = ok(await post(id, "add-implicit", { item: boots, source: "Searing Exarch", mod: "10% increased Movement Speed" }));
  assert.deepEqual(e.result.implicits, ["10% increased Movement Speed"]);
  assert.match(e.result.raw, /\{exarch\}10% increased Movement Speed/);
  assert.deepEqual(e.changed.EffectiveMovementSpeedMod, { before: 0.95, after: 1.05 }); // +10% increased, added to the -5%

  const flask = await addItem(id, "Rarity: NORMAL\nQuicksilver Flask", "none");
  const rev = await revisionOf(id);
  fails(await post(id, "add-implicit", { item: boots, source: "Vestigial", mod: "x" }), 400, "invalid_input");
  fails(await post(id, "add-implicit", { item: boots, source: "Searing Exarch", mod: "no such modifier" }), 400, "invalid_input");
  fails(await post(id, "add-implicit", { item: boots, source: "Searing Exarch" }), 400, "invalid_input");
  fails(await post(id, "add-implicit", { item: coat, source: "Custom" }), 400, "invalid_input");
  fails(await post(id, "add-implicit", { item: flask, text: "+1 to maximum Life" }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
});

void test("custom_mod adds a crafting bench mod or a custom line from the Add modifier popup", async () => {
  const id = await newWitch();
  const gloves = await addItem(id, "Rarity: RARE\nBench Gloves\nIron Gauntlets");
  const b = ok(await post(id, "custom-mod", { item: gloves, source: "Crafting Bench", mod: "+(41-55) to maximum Life (Prefix)" }));
  assert.deepEqual(b.result.explicits, ["+(41-55) to maximum Life"]);
  assert.deepEqual(b.changed.Life, { before: 1125, after: 1173 }); // the middle of 41-55 is 48
  const c = ok(await post(id, "custom-mod", { item: gloves, source: "Custom", text: "+30 to maximum Life" }));
  assert.deepEqual(c.result.explicits, ["+(41-55) to maximum Life", "+30 to maximum Life"]);
  assert.deepEqual(c.changed.Life, { before: 1173, after: 1203 });

  const normal = await addItem(id, "Rarity: NORMAL\nIron Hat", "none");
  const rev = await revisionOf(id);
  fails(await post(id, "custom-mod", { item: gloves, source: "No Such Source", mod: "x" }), 400, "invalid_input");
  fails(await post(id, "custom-mod", { item: gloves, source: "Crafting Bench", mod: "no such mod" }), 400, "invalid_input");
  fails(await post(id, "custom-mod", { item: gloves, source: "Crafting Bench", mod: "maximum Life" }), 400, "invalid_input"); // several tiers match
  fails(await post(id, "custom-mod", { item: gloves, source: "Custom" }), 400, "invalid_input");
  fails(await post(id, "custom-mod", { item: normal, source: "Custom", text: "+1 to maximum Life" }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
});

void test("crucible_mod: a crucible node mod on a sword takes 5% off maximum Life, None puts it back", async () => {
  const id = await newWitch();
  const sword = await addItem(id, "Rarity: RARE\nCrucible Sword\nRusted Sword\n+10 to maximum Life");
  const coat = await addItem(id, "Rarity: RARE\nPlain Coat\nAstral Plate", "none");
  assert.equal((await output(id, "Life")).Life, 1135);
  const mod = "Adds 19 to 31 Chaos Damage/5% reduced maximum Life - Tier: 4";
  const m = ok(await post(id, "crucible-mod", { item: sword, mods: [{ node: 1, mod }] }));
  assert.match(m.result.raw, /5% reduced maximum Life/);
  assert.deepEqual(m.changed.Life, { before: 1135, after: 1078 }); // 1135 x 0.95 = 1078.25
  const rev = await revisionOf(id);
  fails(await post(id, "crucible-mod", { item: sword, mods: [{ node: 1, mod: "no such crucible mod" }] }), 400, "invalid_input");
  fails(await post(id, "crucible-mod", { item: sword, mods: [{ node: 6, mod: "None" }] }), 400, "invalid_input");
  fails(await post(id, "crucible-mod", { item: coat, mods: [{ node: 1, mod: "None" }] }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
  const none = ok(await post(id, "crucible-mod", { item: sword, mods: [{ node: 1, mod: "None" }] }));
  assert.doesNotMatch(none.result.raw, /5% reduced maximum Life/);
  assert.deepEqual(none.changed.Life, { before: 1078, after: 1135 });
});

void test("cluster_jewel: skill and passive count set on a socketed Small Cluster Jewel give 3 x 4% increased maximum Life", async () => {
  const id = await newWitch();
  ok(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: [2491] })); // a Large Jewel Socket
  assert.equal((await output(id, "Life")).Life, 1180);
  const jewel = ok(await post(id, "craft", { base: "Small Cluster Jewel", rarity: "RARE", equip: "none" })).result.id;
  ok(await post(id, "equip", { item: jewel, slot: "Jewel 2491" }));
  const j = ok(await post(id, "cluster-jewel", { item: jewel, skill: "Life", nodes: 3 }));
  assert.deepEqual(j.result.enchants, ["Adds 3 Passive Skills", "Added Small Passive Skills grant: 4% increased maximum Life"]);
  // The jewel's three added passives are nodes 65728, 65730 and 65732 under that socket.
  for (const n of [65728, 65730, 65732]) ok(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: [n] }));
  assert.equal((await output(id, "Life")).Life, 1322); // 1180 x (1 + 3 x 4%) = 1321.6

  const two = ok(await post(id, "cluster-jewel", { item: jewel, nodes: 2 }));
  assert.deepEqual(two.result.enchants[0], "Adds 2 Passive Skills");

  const large = ok(await post(id, "craft", { base: "Large Cluster Jewel", rarity: "RARE", equip: "none" })).result.id;
  const l = ok(await post(id, "cluster-jewel", { item: large, skill: "Fire Damage", nodes: 8, notables: ["Added Small Passive Skills also grant: +# to Maximum Life", "Burning Bright"] }));
  assert.deepEqual(l.result.enchants, ["Adds 8 Passive Skills", "2 Added Passive Skills are Jewel Sockets", "Added Small Passive Skills grant: 12% increased Fire Damage"]);
  assert.deepEqual(l.result.explicits, ["Added Small Passive Skills also grant: +10 to Maximum Life", "1 Added Passive Skill is Burning Bright"]);

  const plain = await addItem(id, "Rarity: RARE\nPlain Coat\nAstral Plate", "none");
  const rev = await revisionOf(id);
  fails(await post(id, "cluster-jewel", { item: large, skill: "No Such Skill" }), 400, "invalid_input");
  fails(await post(id, "cluster-jewel", { item: large, nodes: 7 }), 400, "invalid_input"); // Large jewels add 8 to 12
  fails(await post(id, "cluster-jewel", { item: large, notables: ["no such notable"] }), 400, "invalid_input");
  fails(await post(id, "cluster-jewel", { item: plain, nodes: 3 }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
});

void test("affix_options lists each affix box's choices for a base; sorted by a stat, best first with the stat's value; nothing is added", async () => {
  type Options = { base: string; rarity: string; sort: string; boxes: Array<{ slot: number; type: string; choices: Array<{ text: string; value: number | null; tiers: Array<{ id: string; text: string; level: number }> }> }> };
  const id = await newWitch();
  const rev = await revisionOf(id);
  assert.equal((await output(id, "Life")).Life, 1125);
  const all = ok(await srv.call<Options>("POST", `/v1/items/${id}/affix-options`, { base: "Vaal Regalia", limit: 3 }));
  assert.deepEqual([all.base, all.rarity, all.sort, all.boxes.map((b) => [b.slot, b.type, b.choices.length])], ["Vaal Regalia", "RARE", "Default", [[1, "Prefix", 3], [2, "Prefix", 3], [3, "Prefix", 3], [4, "Suffix", 3], [5, "Suffix", 3], [6, "Suffix", 3]]]);
  assert.deepEqual(all.boxes[0]?.choices[0]?.tiers.slice(0, 2), [{ id: "LocalIncreasedEnergyShield1", text: "+(3-5) to maximum Energy Shield", level: 3 }, { id: "LocalIncreasedEnergyShield2", text: "+(6-11) to maximum Energy Shield", level: 11 }]);
  assert.ok(all.boxes.every((b) => b.choices.every((c) => c.value === null)), "no value without a sort");
  // Flat Energy Shield in box 2 takes its group out of box 1; by Life, flat Life is the best prefix. Each choice is measured
  // at its mid tier (Item Affix Quality 0.5): +(85-99) Life is +92, the hybrid's +(29-33) Life is +31.
  const byLife = ok(await srv.call<Options>("POST", `/v1/items/${id}/affix-options`, { base: "Vaal Regalia", sort: "Life", slots: [1, 4], affixes: [{ slot: 2, mod: "+# to maximum Energy Shield" }], limit: 4 }));
  assert.deepEqual([byLife.sort, byLife.boxes.map((b) => b.slot)], ["Life", [1, 4]]);
  const prefixes = byLife.boxes[0]?.choices ?? [];
  assert.deepEqual(prefixes.slice(0, 2).map((c) => [c.text, c.value, c.tiers.length]), [["+# to maximum Life", 1125 + 92, 13], ["+# to maximum Energy Shield/+# to maximum Life", 1125 + 31, 4]]);
  assert.ok(!prefixes.some((c) => c.text === "+# to maximum Energy Shield"), "box 2's group is not offered again");
  assert.ok(prefixes.every((c, i) => i === 0 || (c.value ?? 0) <= (prefixes[i - 1]?.value ?? 0)), "best first");
  for (const body of [
    { base: "Vaal Regalia", slots: [2], affixes: [{ slot: 2, mod: "+# to maximum Energy Shield" }] },
    { base: "Vaal Regalia", sort: "No Such Stat" },
    { base: "No Such Base" },
  ]) fails(await srv.call("POST", `/v1/items/${id}/affix-options`, body), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev, "nothing added to the build");
  assert.deepEqual((await srv.call<{ items: unknown[] }>("GET", `/v1/items/${id}/list`)).body.result.items, []);
});
