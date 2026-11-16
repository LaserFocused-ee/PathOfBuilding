// Worker tests for evaluate node_power and passives, on tree 3_30.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FIXTURES, startServer, type TestServer } from "./helpers.js";

type Value = number | string | boolean | null;
type Changed = Record<string, { before: Value; after: Value }>;
type Mutated = { result: Record<string, unknown>; changed: Changed; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type NodePower = { id: number; name: string; type: string; allocated: boolean; pathDist: number; power: number; pathPower?: number; perPoint?: number; defence?: number };

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
  assert.equal(alloc?.perPoint, -362.99162142023);
  // pathPower of an allocated node is what cutting it with everything hanging from it changes.
  const cut = await dup(base);
  const before = (await output(cut, "CombinedDPS")).CombinedDPS ?? 0;
  assert.equal((await mutate("tree", cut, "deallocate", { nodes: [2292], force: true })).result.count, 8);
  assert.ok(Math.abs(((await output(cut, "CombinedDPS")).CombinedDPS ?? 0) - before + 2903.9329713618) < 1e-6);
  const mastery = p.nodes.find((n) => n.id === 5726);
  assert.deepEqual([mastery?.type, mastery?.name, mastery?.pathDist, mastery?.power, mastery?.pathPower], ["Mastery", "Elemental Mastery: Hits have 15% chance to treat Enemy Monster Elemental Resistance values as inverted", 10, 1750.092175, 2198.22525]);
  assert.deepEqual(p.nodes.find((n) => n.type === "Keystone")?.name, "Elemental Overload");

  const od = await ev<{ nodes: NodePower[] }>(base, "node-power", { stat: "OffenceDefence", depth: 1, limit: 2 });
  assert.deepEqual(od.nodes.map((n) => [n.id, n.power, n.defence, n.pathPower]), [[44983, 0.085068750229975, 0, undefined], [57264, 0.078416262226976, 0, undefined]]);
  const full = await ev<{ nodes: NodePower[] }>(base, "node-power", { stat: "FullDPS", depth: 5, limit: 2 });
  assert.deepEqual(full.nodes.map((n) => [n.name, n.pathDist, n.power]), [["Elemental Overload", 5, 2450.8169864801], ["Trickery", 5, 1109.8215415379]]);
  // Any number of the output: TotalDotDPS, which the power stat list does not carry; above 200 results.
  const dot = await ev<{ stat: string; total: number; nodes: NodePower[] }>(base, "node-power", { stat: "TotalDotDPS", depth: 10, limit: 1000 });
  assert.deepEqual([dot.stat, dot.total, dot.nodes.length], ["TotalDotDPS", 1122, 1000]);
  assert.ok(dot.nodes.some((n) => n.power !== 0), "damage over time moves with some node");
  const unknown = await evaluate(base, "node-power", { stat: "NoSuchOutput" });
  assert.deepEqual([unknown.status, unknown.body.error?.message], [400, "unknown stat NoSuchOutput; use a stat of the power stat list, e.g. CombinedDPS, FullDPS, TotalEHP, Life, or a number of the build's output (e.g. TotalDotDPS)"]);
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
  fails(await evaluate(base, "passives", { candidates: [2292] }), 400, "invalid_input"); // allocated, and nothing else to score
  fails(await evaluate(base, "passives", { candidates: [5726] }), 400, "invalid_input"); // a mastery
  // one candidate that cannot be scored does not fail the others
  const mixed = await ev<{ total: number; candidates: Candidate[]; skipped: Array<{ id: number; reason: string }> }>(base, "passives", { candidates: [12852, 2292, 5726], fields: ["CombinedDPS"] });
  assert.deepEqual([mixed.total, mixed.candidates.map((c) => c.id), mixed.skipped.map((x) => [x.id, x.reason.split(":")[0]])], [1, [12852], [[2292, "allocated already"], [5726, "a mastery"]]]);
  fails(await evaluate(base, "passives", { fields: ["Life"], sortBy: "CombinedDPS" }), 400, "invalid_input");
});
