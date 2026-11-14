// Worker tests for evaluate gem_rank, anoint_rank and unique_rank, on tree 3_30.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FIXTURES, startServer, type TestServer } from "./helpers.js";

type Value = number | string | boolean | null;
type Changed = Record<string, { before: Value; after: Value }>;
type Mutated = { result: Record<string, unknown>; changed: Changed; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };

let srv: TestServer;
/** The Elementalist fixture (Fireball, Spell Echo, Added Lightning Damage, 15 nodes) with an amulet and a flask equipped, an unequipped helmet, a second tree and a second item set. */
let base: string;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};

const amulet = "Rarity: RARE\nTest Amulet\nOnyx Amulet\nImplicits: 1\n+16 to all Attributes\n+50 to maximum Life\n+20% to Fire Resistance";
const helmet = "Rarity: RARE\nTest Helm\nHubris Circlet\nImplicits: 0\n+80 to maximum Energy Shield\n+30% to Fire Resistance\n25% increased Spell Damage";

const ev = async <T>(id: string, action: string, body: Record<string, unknown>) => ok(await srv.call<T>("POST", `/v1/evaluate/${id}/${action}`, body));
const mutate = async (area: string, id: string, action: string, body: Record<string, unknown>) => ok(await srv.call<Mutated>("POST", `/v1/${area}/${id}/${action}`, body));
const dup = async (id: string) => ok(await srv.call<{ build: { id: string } }>("POST", `/v1/builds/${id}/duplicate`, {})).build.id;
const output = async (id: string, fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
const stat = async (id: string, key: string) => {
  const v = (await output(id, key))[key];
  assert.equal(typeof v, "number", key);
  return Number(v);
};

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

