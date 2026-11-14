// Worker tests for the evaluate domain (what-if, node power, item comparison, gem / anoint / unique ranking, comparisons), on tree 3_30,
// through HTTP and MCP. Each answer is checked against doing the same thing for real on a duplicate build, and every route
// leaves the build (its code and revision) untouched.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { FIXTURES, startServer, TOKEN, type TestServer } from "./helpers.js";

type Value = number | string | boolean | null;
type Changed = Record<string, { before: Value; after: Value }>;
type Mutated = { result: Record<string, unknown>; changed: Changed; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type SlotChange = { slot: string; equipped: string | null; changed: Changed };
type NodePower = { id: number; name: string; type: string; allocated: boolean; pathDist: number; power: number; pathPower?: number; defence?: number };

let srv: TestServer;
/** The Elementalist fixture (Fireball, Spell Echo, Added Lightning Damage, 15 nodes) with an amulet and a flask equipped, an unequipped helmet, a second tree and a second item set. */
let base: string;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);

const amulet = "Rarity: RARE\nTest Amulet\nOnyx Amulet\nImplicits: 1\n+16 to all Attributes\n+50 to maximum Life\n+20% to Fire Resistance";
const helmet = "Rarity: RARE\nTest Helm\nHubris Circlet\nImplicits: 0\n+80 to maximum Energy Shield\n+30% to Fire Resistance\n25% increased Spell Damage";
const ring = "Rarity: RARE\nTest Ring\nRuby Ring\nImplicits: 1\n+30% to Fire Resistance\n+40 to maximum Life";

const evaluate = (id: string, action: string, body: Record<string, unknown>) => srv.call<Record<string, unknown>>("POST", `/v1/evaluate/${id}/${action}`, body);
const ev = async <T>(id: string, action: string, body: Record<string, unknown>) => ok(await srv.call<T>("POST", `/v1/evaluate/${id}/${action}`, body));
const mutate = async (area: string, id: string, action: string, body: Record<string, unknown>) => ok(await srv.call<Mutated>("POST", `/v1/${area}/${id}/${action}`, body));
const dup = async (id: string) => ok(await srv.call<{ build: { id: string } }>("POST", `/v1/builds/${id}/duplicate`, {})).build.id;
const output = async (id: string, fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
const stat = async (id: string, key: string) => {
  const v = (await output(id, key))[key];
  assert.equal(typeof v, "number", key);
  return Number(v);
};
const code = async (id: string) => ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code;
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const sidebar = async (id: string) => ok(await srv.call<{ stats: unknown[] }>("GET", `/v1/stats/${id}/sidebar`)).stats;

before(async () => {
  srv = await startServer();
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  base = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).build.id;
  await mutate("items", base, "add", { text: amulet, equip: "auto" }); // item 1
  await mutate("items", base, "add", { text: "Rarity: MAGIC\nQuicksilver Flask", equip: "auto" }); // item 2, Flask 1
  await mutate("items", base, "add", { text: helmet, equip: "none" }); // item 3
  await mutate("tree", base, "spec-copy", { index: 1 });
  await mutate("tree", base, "spec-activate", { index: 2 });
  await mutate("tree", base, "allocate", { nodes: [44983] }); // tree 2: Fire Damage on top of tree 1
  await mutate("tree", base, "spec-activate", { index: 1 });
  await mutate("items", base, "set-new", { title: "Two" }); // item set 2, empty
});
after(async () => {
  await srv?.close();
});

void test("what_if nodes: adding a node equals allocating it; removing a leaf equals deallocating it; by id or exact name", async () => {
  const added = await ev<{ changed: Changed }>(base, "what-if", { addNodes: [44983] });
  assert.deepEqual(added.changed, {
    AverageBurstDamage: { before: 5177.7875, after: 5563.7 },
    AverageHit: { before: 2588.89375, after: 2781.85 },
    IgniteDPS: { before: 1839.1067471265, after: 2057.0230233591 },
    TotalDPS: { before: 5833.6405833333, after: 6268.4353333333 },
    WithIgniteDPS: { before: 7672.7473304598, after: 8325.4583566924 },
  });
  const real = await mutate("tree", await dup(base), "allocate", { nodes: [44983] });
  assert.deepEqual(added.changed, real.changed, "the what-if is the engine's own change");
  const keystone = await ev<{ changed: Changed }>(base, "what-if", { addNodes: ["Elemental Overload"], fields: ["CombinedDPS"] });
  assert.deepEqual(keystone.changed, (await ev<{ changed: Changed }>(base, "what-if", { addNodes: [22088], fields: ["CombinedDPS"] })).changed, "a name and its id are the same node");
});

void test("what_if nodes by name, removal and fields", async () => {
  const removed = await ev<{ changed: Changed }>(base, "what-if", { removeNodes: ["Fire Walker"] });
  assert.deepEqual(removed.changed, {
    AverageBurstDamage: { before: 5177.7875, after: 4574.575 },
    AverageHit: { before: 2588.89375, after: 2287.2875 },
    FireMaximumHitTaken: { before: 1120, after: 1003 },
    FireResist: { before: -25, after: -40 },
    IgniteDPS: { before: 1839.1067471265, after: 1487.3273240261 },
    ManaPerSecondCost: { before: 37.18, after: 35.64 },
    Speed: { before: 2.2533333333333, after: 2.16 },
    TotalDPS: { before: 5833.6405833333, after: 4940.541 },
    TotalEHP: { before: 1055.0637436429, after: 1028.955343551 },
    WithIgniteDPS: { before: 7672.7473304598, after: 6427.8683240261 },
  });
  const real = await mutate("tree", await dup(base), "deallocate", { nodes: ["Fire Walker"] });
  assert.deepEqual(removed.changed, real.changed);
  const byId = await ev<{ changed: Changed }>(base, "what-if", { removeNodes: [34661], fields: ["CombinedDPS", "Life"] });
  assert.deepEqual(byId.changed, { CombinedDPS: { before: 7672.7473304598, after: 6427.8683240261 } });
  const both = await ev<{ changed: Changed }>(base, "what-if", { addNodes: [44983], removeNodes: [30225], fields: ["CombinedDPS"] });
  assert.deepEqual(both.changed, { CombinedDPS: { before: 7672.7473304598, after: 8064.4660233591 } });
  const d = await dup(base);
  await mutate("tree", d, "allocate", { nodes: [44983] });
  await mutate("tree", d, "deallocate", { nodes: [30225] });
  assert.equal(await stat(d, "CombinedDPS"), 8064.4660233591, "both changes at once equal making them one after the other");
});

void test("what_if conditions equal the configuration option; a flask toggle equals its Active box", async () => {
  const onslaught = await ev<{ changed: Changed }>(base, "what-if", { conditions: ["Onslaught"] });
  assert.deepEqual(onslaught.changed, {
    EffectiveMovementSpeedMod: { before: 1, after: 1.2 },
    IgniteDPS: { before: 1839.1067471265, after: 1894.7923642368 },
    ManaPerSecondCost: { before: 37.18, after: 44 },
    Speed: { before: 2.2533333333333, after: 2.6666666666667 },
    TotalDPS: { before: 5833.6405833333, after: 6903.7166666667 },
    WithIgniteDPS: { before: 7672.7473304598, after: 8798.5090309034 },
  });
  assert.deepEqual(onslaught.changed, (await mutate("config", await dup(base), "set", { values: { buffOnslaught: true } })).changed);

  const flask = await ev<{ changed: Changed }>(base, "what-if", { toggleFlask: "Flask 1" });
  assert.deepEqual(flask.changed, { EffectiveMovementSpeedMod: { before: 1, after: 1.4 } });
  assert.deepEqual(flask.changed, (await mutate("items", await dup(base), "set-active", { slot: "Flask 1", active: true })).changed);
});

void test("what_if an item in a slot equals equipping it for real, by text and by item id", async () => {
  const wi = await ev<{ changed: Changed }>(base, "what-if", { slot: "Helmet", text: helmet });
  assert.deepEqual(wi.changed, {
    AverageBurstDamage: { before: 5177.7875, after: 6012.1375 },
    AverageHit: { before: 2588.89375, after: 3006.06875 },
    ColdMaximumHitTaken: { before: 969, after: 1123 },
    EnergyShield: { before: 38, after: 266 },
    FireMaximumHitTaken: { before: 1120, after: 1696 },
    FireResist: { before: -25, after: 5 },
    LightningMaximumHitTaken: { before: 969, after: 1123 },
    PhysicalMaximumHitTaken: { before: 1434, after: 1662 },
    TotalDPS: { before: 5833.6405833333, after: 6773.6749166667 },
    TotalEHP: { before: 1055.0637436429, after: 1288.6216976366 },
    WithIgniteDPS: { before: 7672.7473304598, after: 8612.7816637931 },
  });
  assert.deepEqual(wi.changed, (await mutate("items", await dup(base), "add", { text: helmet, equip: "Helmet" })).changed);
  assert.deepEqual((await ev<{ changed: Changed }>(base, "what-if", { slot: "Helmet", item: 3 })).changed, wi.changed);
});

void test("compare_item: every slot the item fits, against equipping it on a duplicate", async () => {
  const byId = await ev<{ slots: SlotChange[] }>(base, "compare-item", { item: 3 });
  assert.deepEqual(byId.slots.map((s) => [s.slot, s.equipped]), [["Helmet", null]]);
  const real = await mutate("items", await dup(base), "equip", { item: 3, slot: "Helmet" });
  assert.deepEqual(byId.slots[0]?.changed, real.changed);
  assert.equal(byId.slots[0]?.changed.EnergyShield?.after, 266);

  const rings = await ev<{ slots: SlotChange[] }>(base, "compare-item", { text: ring });
  assert.deepEqual(rings.slots.map((s) => s.slot), ["Ring 1", "Ring 2"]);
  assert.deepEqual(rings.slots[0]?.changed, {
    ChaosMaximumHitTaken: { before: 873, after: 902 },
    ColdMaximumHitTaken: { before: 969, after: 1001 },
    FireMaximumHitTaken: { before: 1120, after: 1511 },
    FireResist: { before: -25, after: 5 },
    Life: { before: 1396, after: 1443 },
    LightningMaximumHitTaken: { before: 969, after: 1001 },
    PhysicalMaximumHitTaken: { before: 1434, after: 1481 },
    TotalEHP: { before: 1055.0637436429, after: 1148.0054126073 },
  });
  assert.deepEqual(rings.slots[1]?.changed, rings.slots[0]?.changed);
  const one = await ev<{ slots: SlotChange[] }>(base, "compare-item", { text: ring, slot: "Ring 2", fields: ["Life"] });
  assert.deepEqual(one.slots, [{ slot: "Ring 2", equipped: null, changed: { Life: { before: 1396, after: 1443 } } }]);

  // An item already in its slot changes nothing, and the slot reports what it holds.
  assert.deepEqual((await ev<{ slots: SlotChange[] }>(base, "compare-item", { item: 1 })).slots, [{ slot: "Amulet", equipped: "Test Amulet, Onyx Amulet", changed: {} }]);
});

void test("node_power: PowerBuilder's numbers, in order, paged; the top node's power is its what-if", async () => {
  const p = await ev<{ stat: string; total: number; offset: number; nodes: NodePower[] }>(base, "node-power", { stat: "CombinedDPS", depth: 2, limit: 5 });
  assert.deepEqual([p.stat, p.total, p.offset], ["CombinedDPS", 60, 0]);
  assert.deepEqual(p.nodes.map((n) => [n.id, n.name, n.type, n.allocated, n.pathDist, n.power, n.pathPower]), [
    [44983, "Fire Damage", "Normal", false, 1, 652.71102623259, 652.71102623259],
    [57264, "Spell Damage and Mana", "Normal", false, 1, 601.66816666667, 601.66816666667],
    [12852, "Elemental Damage", "Normal", false, 2, 511.308229517, 1164.1672682754],
    [33296, "Spell Damage", "Normal", false, 2, 451.53983333333, 1053.7854166667],
    [17579, "Spell Damage", "Normal", false, 2, 375.32083333333, 752.37391666667],
  ]);
  const top = p.nodes[0];
  assert.ok(top);
  const wi = (await ev<{ changed: Changed }>(base, "what-if", { addNodes: [top.id], fields: ["CombinedDPS"] })).changed.CombinedDPS;
  assert.ok(wi && typeof wi.before === "number" && typeof wi.after === "number");
  assert.ok(Math.abs(top.power - (wi.after - wi.before)) < 1e-9, "power is the what-if's change");

  const next = await ev<{ offset: number; nodes: NodePower[] }>(base, "node-power", { stat: "CombinedDPS", depth: 2, limit: 3, offset: 3 });
  assert.deepEqual([next.offset, next.nodes.map((n) => n.id)], [3, [33296, 17579, 21934]]);
});

void test("node_power: allocated nodes show their removal, masteries one entry per effect, the combined stat adds defence", async () => {
  const p = await ev<{ total: number; nodes: NodePower[] }>(base, "node-power", { stat: "CombinedDPS", depth: 10, limit: 200 });
  assert.equal(p.total, 1122);
  const alloc = p.nodes.find((n) => n.id === 2292);
  assert.deepEqual([alloc?.name, alloc?.allocated, alloc?.pathDist, alloc?.power, alloc?.pathPower], ["Mana and Life", true, 8, 0, -2903.9329713618]);
  const mastery = p.nodes.find((n) => n.id === 5726);
  assert.deepEqual([mastery?.type, mastery?.name, mastery?.pathDist, mastery?.power, mastery?.pathPower], ["Mastery", "Elemental Mastery: Hits have 15% chance to treat Enemy Monster Elemental Resistance values as inverted", 10, 1750.092175, 2198.22525]);
  assert.deepEqual(p.nodes.find((n) => n.type === "Keystone")?.name, "Elemental Overload");

  const od = await ev<{ nodes: NodePower[] }>(base, "node-power", { stat: "OffenceDefence", depth: 1, limit: 2 });
  assert.deepEqual(od.nodes.map((n) => [n.id, n.power, n.defence, n.pathPower]), [[44983, 0.085068750229975, 0, undefined], [57264, 0.078416262226976, 0, undefined]]);
  const full = await ev<{ nodes: NodePower[] }>(base, "node-power", { stat: "FullDPS", depth: 5, limit: 2 });
  assert.deepEqual(full.nodes.map((n) => [n.name, n.pathDist, n.power]), [["Elemental Overload", 5, 2450.8169864801], ["Trickery", 5, 1109.8215415379]]);
});

type Candidate = { id: number; name: string; type: string; points: number; gain?: number; changed: Changed };
void test("passives: each candidate scored with its path, sorted by gain; equals allocating it for real; build untouched", async () => {
  const rev = await revisionOf(base);
  const before = await code(base);
  const p = await ev<{ total: number; offset: number; sortBy: string; candidates: Candidate[] }>(base, "passives", { fields: ["CombinedDPS", "Life"], sortBy: "CombinedDPS", limit: 2 });
  assert.deepEqual([p.total, p.offset, p.sortBy], [19, 0, "CombinedDPS"]);
  // The same numbers as node_power's next-to-the-tree nodes.
  assert.deepEqual(p.candidates.map((c) => [c.id, c.name, c.points, c.gain]), [[44983, "Fire Damage", 1, 652.71102623259], [57264, "Spell Damage and Mana", 1, 601.66816666667]]);

  // A node two points away is scored with its path (node_power's pathPower), and that is what allocating it gives.
  const far = await ev<{ candidates: Candidate[] }>(base, "passives", { candidates: [12852, "Spell Damage and Mana"], fields: ["CombinedDPS"] });
  assert.deepEqual(far.candidates.map((c) => [c.id, c.points, c.changed.CombinedDPS?.before, c.changed.CombinedDPS?.after]), [[12852, 2, 7672.7473304598, 8836.9145987352], [57264, 1, 7672.7473304598, 8274.4154971265]]);
  const copy = await dup(base);
  await mutate("tree", copy, "allocate", { nodes: [12852] });
  assert.equal(await stat(copy, "CombinedDPS"), far.candidates[0]?.changed.CombinedDPS?.after);

  assert.deepEqual([await revisionOf(base), await code(base)], [rev, before]);
  fails(await evaluate(base, "passives", { candidates: [2292] }), 400, "invalid_input"); // allocated
  fails(await evaluate(base, "passives", { candidates: [5726] }), 400, "invalid_input"); // a mastery
  fails(await evaluate(base, "passives", { fields: ["Life"], sortBy: "CombinedDPS" }), 400, "invalid_input");
});

void test("gem_rank: the gem box's values; the top support really added, and one swapped in at a position", async () => {
  const r = await ev<{ stat: string; base: number; total: number; gems: Array<{ name: string; value: number }> }>(base, "gem-rank", { group: 1, stat: "CombinedDPS", limit: 3 });
  assert.deepEqual([r.stat, r.base, r.total], ["CombinedDPS", 7672.7473304598, 108]);
  assert.deepEqual(r.gems, [
    { name: "Cast when Stunned", value: 21844.184718925 },
    { name: "Invert the Rules", value: 12456.332608793 },
    { name: "Arcane Surge", value: 11214.092364237 },
  ]);
  for (const g of r.gems.slice(0, 2)) {
    const d = await dup(base);
    await mutate("skills", d, "set-gem", { group: 1, gem: 4, name: g.name });
    assert.equal(await stat(d, "CombinedDPS"), g.value, g.name);
  }
  const swap = await ev<{ gems: Array<{ name: string; value: number }> }>(base, "gem-rank", { group: 1, gem: 2, stat: "TotalDPS", support: false, limit: 2 });
  assert.deepEqual(swap.gems, [{ name: "Cast when Stunned", value: 19612.831439394 }, { name: "Cast when Damage Taken", value: 7157.5284090909 }]);
  const d = await dup(base);
  await mutate("skills", d, "set-gem", { group: 1, gem: 2, name: "Cast when Stunned" });
  assert.equal(await stat(d, "TotalDPS"), 19612.831439394);
});

void test("anoint_rank: the Anoint popup's notable power is the change anointing causes", async () => {
  const r = await ev<{ stat: string; total: number; notables: Array<{ name: string; power: number }> }>(base, "anoint-rank", { slot: "Amulet", stat: "CombinedDPS", limit: 3 });
  assert.deepEqual([r.stat, r.total], ["CombinedDPS", 472]);
  assert.deepEqual(r.notables, [
    { name: "Divine Judgement", power: 2562.2236055539 },
    { name: "Heart of Flame", power: 1827.3219842021 },
    { name: "Ash, Frost and Storm", power: 1575.2754378948 },
  ]);
  const before = await stat(base, "CombinedDPS");
  for (const n of r.notables.slice(0, 2)) {
    const d = await dup(base);
    await mutate("items", d, "anoint", { item: 1, notables: [n.name] });
    assert.ok(Math.abs(await stat(d, "CombinedDPS") - before - n.power) < 1e-6, n.name);
  }
  assert.deepEqual((await ev<{ notables: unknown[] }>(base, "anoint-rank", { item: 1, stat: "Life", limit: 2 })).notables, [{ name: "Discipline and Training", power: 157 }, { name: "Heart of the Warrior", power: 150 }]);
});

void test("unique_rank: the unique list's sort for a slot; the top uniques really equipped", async () => {
  const r = await ev<{ stat: string; total: number; uniques: Array<{ name: string; power: number }> }>(base, "unique-rank", { slot: "Helmet", stat: "CombinedDPS", limit: 3 });
  assert.deepEqual([r.stat, r.total], ["CombinedDPS", 113]);
  assert.deepEqual(r.uniques, [
    { name: "Crown of the Tyrant, Magistrate Crown", power: 10031.847796552 },
    { name: "Scold's Bridle, Mind Cage", power: 9756.4434745075 },
    { name: "Galesight, Solaris Circlet", power: 9466.705745879 },
  ]);
  for (const u of r.uniques.slice(0, 2)) {
    const d = await dup(base);
    await mutate("items", d, "add-unique", { name: u.name, equip: "Helmet" });
    assert.equal(await stat(d, "CombinedDPS"), u.power, u.name);
  }
});

void test("compare_specs, compare_item_sets and compare_builds equal switching for real", async () => {
  const specs = await ev<{ changed: Changed }>(base, "compare-specs", { a: 1, b: 2 });
  assert.deepEqual(specs.changed, (await mutate("tree", await dup(base), "spec-activate", { index: 2 })).changed);
  assert.deepEqual(specs.changed.WithIgniteDPS, { before: 7672.7473304598, after: 8325.4583566924 });
  assert.deepEqual((await ev<{ changed: Changed }>(base, "compare-specs", { b: 2, fields: ["CombinedDPS"] })).changed, { CombinedDPS: { before: 7672.7473304598, after: 8325.4583566924 } });
  assert.deepEqual((await ev<{ changed: Changed }>(base, "compare-specs", { a: 2, b: 1, fields: ["CombinedDPS"] })).changed, { CombinedDPS: { before: 8325.4583566924, after: 7672.7473304598 } });

  const sets = await ev<{ changed: Changed }>(base, "compare-item-sets", { b: 2 });
  assert.deepEqual(sets.changed, (await mutate("items", await dup(base), "set-activate", { index: 2 })).changed);
  assert.deepEqual([sets.changed.Life, sets.changed.FireResist, sets.changed.ColdMaximumHitTaken], [{ before: 1396, after: 1328 }, { before: -25, after: -45 }, { before: 969, after: null }]);

  const other = await dup(base);
  const real = await mutate("tree", other, "allocate", { nodes: [44983] });
  const builds = await ev<{ changed: Changed }>(base, "compare-builds", { other });
  assert.deepEqual(builds.changed, real.changed);
  assert.deepEqual((await ev<{ changed: Changed }>(base, "compare-builds", { other, fields: ["CombinedDPS", "Life"] })).changed, { CombinedDPS: { before: 7672.7473304598, after: 8325.4583566924 } });
  assert.deepEqual((await ev<{ changed: Changed }>(base, "compare-builds", { other: base })).changed, {});
});

void test("every evaluate route leaves the build's code, revision and stats as they were", async () => {
  const other = await dup(base);
  const calls: Array<[string, Record<string, unknown>]> = [
    ["what-if", { addNodes: [44983], removeNodes: [34661], slot: "Helmet", item: 3, toggleFlask: "Flask 1", conditions: ["Onslaught"] }],
    ["node-power", { stat: "TotalEHP", depth: 3 }],
    ["compare-item", { text: ring }],
    ["gem-rank", { group: 1, stat: "FullDPS", limit: 5 }],
    ["anoint-rank", { item: 1, stat: "Life" }],
    ["unique-rank", { slot: "Amulet", stat: "TotalEHP", limit: 5 }],
    ["compare-specs", { a: 1, b: 2 }],
    ["compare-item-sets", { a: 1, b: 2 }],
    ["compare-builds", { other }],
  ];
  const [c0, r0, s0, o0] = [await code(base), await revisionOf(base), JSON.stringify(await sidebar(base)), JSON.stringify(await output(base, "CombinedDPS,Life,TotalEHP"))];
  for (const [action, body] of calls) {
    const res = await evaluate(base, action, body);
    assert.equal(res.status, 200, `${action}: ${JSON.stringify(res.body.error)}`);
    assert.equal(await code(base), c0, `${action} changed the build code`);
    assert.equal(await revisionOf(base), r0, `${action} moved the revision`);
    assert.equal(JSON.stringify(await sidebar(base)), s0, `${action} changed the stats`);
  }
  assert.equal(JSON.stringify(await output(base, "CombinedDPS,Life,TotalEHP")), o0);
});

void test("bad requests are 400 invalid_input (404 for a build that is not there)", async () => {
  fails(await evaluate(base, "what-if", { addNodes: [99999999] }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { addNodes: ["No Such Node"] }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { addNodes: [] }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", {}), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { slot: "Nowhere", text: helmet }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { slot: "Helmet", text: "not an item" }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { slot: "Helmet", item: 99 }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { slot: "Amulet", text: helmet }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { toggleFlask: "Flask 2" }), 400, "invalid_input");
  fails(await evaluate(base, "node-power", { stat: "NoSuchStat" }), 400, "invalid_input");
  fails(await evaluate(base, "node-power", { stat: "CombinedDPS", limit: 500 }), 400, "invalid_input");
  fails(await evaluate(base, "compare-item", { text: helmet, slot: "Amulet" }), 400, "invalid_input");
  fails(await evaluate(base, "compare-item", {}), 400, "invalid_input");
  fails(await evaluate(base, "gem-rank", { group: 9, stat: "CombinedDPS" }), 400, "invalid_input");
  fails(await evaluate(base, "gem-rank", { group: 1, stat: "Life" }), 400, "invalid_input");
  fails(await evaluate(base, "gem-rank", { group: 1, gem: 9, stat: "CombinedDPS" }), 400, "invalid_input");
  fails(await evaluate(base, "anoint-rank", { item: 3, stat: "Life" }), 400, "invalid_input");
  fails(await evaluate(base, "anoint-rank", { item: 1, stat: "OffenceDefence" }), 400, "invalid_input");
  fails(await evaluate(base, "unique-rank", { slot: "Banana", stat: "Life" }), 400, "invalid_input");
  fails(await evaluate(base, "unique-rank", { slot: "Helmet", stat: "Name" }), 400, "invalid_input");
  fails(await evaluate(base, "compare-specs", { b: 9 }), 400, "invalid_input");
  fails(await evaluate(base, "compare-item-sets", { b: 9 }), 400, "invalid_input");
  fails(await evaluate(base, "compare-builds", { other: "0123456789abcdef" }), 404, "not_found");
  fails(await evaluate("0123456789abcdef", "what-if", { conditions: ["Onslaught"] }), 404, "not_found");
  assert.equal((await srv.call("GET", `/v1/evaluate/${base}/what-if`)).status, 404, "evaluate takes POST");
});

void test("MCP: pob_evaluate is listed read-only and answers a what-if", async () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.find((t) => t.name === "pob_evaluate")?.annotations?.readOnlyHint, true);
    const res = await client.callTool({ name: "pob_evaluate", arguments: { action: "what_if", id: base, addNodes: [44983], fields: ["CombinedDPS"] } });
    assert.ok(!res.isError, JSON.stringify(res.structuredContent));
    const body = res.structuredContent as { ok: boolean; result: { changed: Changed } };
    assert.deepEqual(body.result.changed, { CombinedDPS: { before: 7672.7473304598, after: 8325.4583566924 } });
    const fail = await client.callTool({ name: "pob_evaluate", arguments: { action: "node_power", id: base, stat: "NoSuchStat" } });
    assert.equal(fail.isError, true);
  } finally {
    await client.close();
  }
});
