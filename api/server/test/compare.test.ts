// Worker tests for the Compare tab against another stored build: evaluate compare_power and tree/items/config copy_from, on tree 3_30.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { routes } from "../src/routes.js";
import { startServer, type TestServer } from "./helpers.js";

type Value = number | string | boolean | null;
type Changed = Record<string, { before: Value; after: Value }>;
type Mutated<T = Record<string, unknown>> = { result: T; changed: Changed; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Power = { other: string; stat: string; total: number; results: Array<{ category: string; name: string; impact: number; percent: number; nodeId?: number; slot?: string; pathDist?: number; perPoint?: number }> };

let srv: TestServer;
/** A level 90 Elementalist with nothing allocated, equipped or set. */
let base: string;
/** The same, plus Arcane Potency (13 points), an amulet and "always on Low Life" and Onslaught set. */
let other: string;

const amulet = "Rarity: RARE\nTest Amulet\nOnyx Amulet\nImplicits: 1\n+16 to all Attributes\n+50 to maximum Life\n+20% to Fire Resistance";

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);
const post = <T>(path: string, body: Record<string, unknown>) => srv.call<T>("POST", path, body);
const declared = (name: string) => routes.find((r) => r.name === name)?.output;
const witch = async () => ok(await post<{ build: { id: string } }>("/v1/builds", { name: "Other", className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" })).build.id;
const power = async (id: string, body: Record<string, unknown>) => {
  const result = ok(await post<Power>(`/v1/evaluate/${id}/compare-power`, body));
  const parsed = declared("evaluate.compare_power")?.safeParse(result);
  assert.ok(parsed?.success, JSON.stringify(parsed?.error?.issues.slice(0, 3)));
  return result;
};
const code = async (id: string) => ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code;
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;

before(async () => {
  srv = await startServer();
  base = await witch();
  other = await witch();
  ok(await post(`/v1/tree/${other}/allocate`, { nodes: ["Arcane Potency"] }));
  ok(await post(`/v1/items/${other}/add`, { text: amulet, equip: "auto" }));
  ok(await post(`/v1/config/${other}/set`, { values: { conditionLowLife: true, buffOnslaught: true } }));
});
after(async () => {
  await srv?.close();
});

void test("compare_power measures the other build's passives, items and config on this one and leaves both builds as they were", async () => {
  const [c0, r0, co, ro] = [await code(base), await revisionOf(base), await code(other), await revisionOf(other)];
  const mana = await power(base, { other, stat: "Mana", limit: 3 });
  assert.deepEqual([mana.other, mana.stat, mana.total], ["Other", "Mana", 11]);
  assert.deepEqual(mana.results, [
    { category: "Tree", impact: 16, name: "Spell Damage and Mana", nodeId: 57264, pathDist: 1, perPoint: 16, percent: 2.7118644067797 },
    { category: "Item", impact: 8, name: "Test Amulet, Onyx Amulet, Amulet", slot: "Amulet", percent: 1.3559322033898 },
    { category: "Tree", impact: 5, name: "Intelligence", nodeId: 36678, pathDist: 9, perPoint: 0.55555555555556, percent: 0.84745762711864 },
  ]);
  const ehp = await power(base, { other, stat: "Effective Hit Pool", categories: { config: true, items: true } });
  assert.deepEqual(ehp.results.map((r) => [r.category, r.name, Math.round(r.impact)]), [
    ["Item", "Test Amulet, Onyx Amulet, Amulet", 63],
    ["Config", "Are you always on Low Life?  ((not set) -> Yes)", -374],
  ]);
  assert.deepEqual((await power(base, { other, stat: "Mana", limit: 3 })).results, mana.results, "a second report is the same (no compared build is left behind)");
  assert.deepEqual([await code(base), await revisionOf(base), await code(other), await revisionOf(other)], [c0, r0, co, ro]);
});

void test("copy_from brings the other build's tree, an item and its config over; then nothing is left to gain", async () => {
  const id = await witch();
  const ro = await revisionOf(other);
  const tree = ok(await post<Mutated<{ index: number; title: string; active: number }>>(`/v1/tree/${id}/copy-from`, { other, use: true }));
  assert.deepEqual([tree.result, tree.changed.Int, tree.revision], [{ index: 2, title: "Default (Compared)", active: 2 }, { before: 32, after: 122 }, 2]);
  const kept = ok(await post<Mutated<{ index: number; active: number }>>(`/v1/tree/${id}/copy-from`, { other }));
  assert.deepEqual([kept.result.index, kept.result.active, kept.changed], [3, 2, {}], "without use the copy is listed, not made active");

  const item = ok(await post<Mutated<{ id: number; name: string; equipped: string[] }>>(`/v1/items/${id}/copy-from`, { other, slot: "Amulet", use: true }));
  assert.deepEqual([item.result.name, item.result.equipped, item.changed.Life], ["Test Amulet, Onyx Amulet", ["Amulet"], { before: 1125, after: 1183 }]);
  const parsed = declared("items.copy_from")?.safeParse(item);
  assert.ok(parsed?.success, JSON.stringify(parsed?.error?.issues.slice(0, 3)));

  const config = ok(await post<Mutated<{ copied: number }>>(`/v1/config/${id}/copy-from`, { other }));
  assert.deepEqual([config.result.copied, config.changed.TotalEHP, config.revision], [30, { before: 808.55763522211, after: 403.13629301521 }, 5]);

  assert.equal((await power(id, { other, stat: "Mana" })).total, 0);
  assert.equal(await revisionOf(other), ro, "the other build is only read");
});

void test("otherSets compares and copies another of the other build's sets, as the Compare tab's set dropdowns pick it", async () => {
  const two = await witch();
  ok(await post(`/v1/tree/${two}/allocate`, { nodes: ["Arcane Potency"] }));
  ok(await post(`/v1/tree/${two}/spec-new`, { title: "Blank" })); // tree 2, empty; tree 1 stays active
  assert.equal((await power(base, { other: two, stat: "Mana", categories: { tree: true } })).total, 10);
  assert.equal((await power(base, { other: two, stat: "Mana", categories: { tree: true }, otherSets: { tree: 2 } })).total, 0);
  const id = await witch();
  const copied = ok(await post<Mutated<{ title: string }>>(`/v1/tree/${id}/copy-from`, { other: two, otherSets: { tree: 2 } }));
  assert.equal(copied.result.title, "Blank (Compared)");
  fails(await post(`/v1/evaluate/${base}/compare-power`, { other: two, otherSets: { tree: 3 } }), 400, "invalid_input");
  fails(await post(`/v1/evaluate/${base}/compare-power`, { other: two, otherSets: { items: 0 } }), 400, "invalid_input");
});

void test("bad compares are refused and change nothing", async () => {
  const r0 = await revisionOf(base);
  fails(await post(`/v1/evaluate/${base}/compare-power`, { other: base }), 400, "invalid_input");
  fails(await post(`/v1/evaluate/${base}/compare-power`, { other: "0123456789abcdef" }), 404, "not_found");
  fails(await post(`/v1/evaluate/${base}/compare-power`, { other, stat: "Banana" }), 400, "invalid_input");
  fails(await post(`/v1/evaluate/${base}/compare-power`, {}), 400, "invalid_input");
  fails(await post(`/v1/items/${base}/copy-from`, { other, slot: "Weapon 1" }), 400, "invalid_input");
  fails(await post(`/v1/tree/${base}/copy-from`, { other: base }), 400, "invalid_input");
  fails(await post(`/v1/config/${base}/copy-from`, { other: "0123456789abcdef" }), 404, "not_found");
  assert.equal(await revisionOf(base), r0);
});
