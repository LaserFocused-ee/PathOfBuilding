// Worker tests for the Items tab (item list, add, modify, edit, anoint, enchant, craft, slots, weapon swap, item sets), on tree 3_30, through HTTP and MCP.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startServer, TOKEN, type TestServer } from "./helpers.js";

type Change = Record<string, { before: number | null; after: number | null }>;
type Mutated<T = Record<string, unknown>> = { result: T; changed: Change; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Brief = { id: number; name: string; title?: string; baseName: string; rarity: string; type?: string; quality?: number; sockets?: string; equipped: string[]; corrupted: boolean };
type Detail = Brief & { raw: string; enchants: string[]; implicits: string[]; explicits: string[]; anoints: string[]; variant?: number; ranges: Array<{ index: number; line: string; range: number }>; validSlots: string[] };
type Sets = Array<{ index: number; title: string; active: boolean }>;
type Listing = { items: Brief[]; slots: Array<{ slot: string; item?: number; active?: boolean }>; sets: Sets; weaponSet: number };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);

/** A new level 90 Witch / Elementalist on tree 3_30 with no items (Life 1125, Mana 590). */
async function newWitch(): Promise<string> {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" }));
  return r.build.id;
}
const output = async (id: string, fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
const list = async (id: string) => ok(await srv.call<Listing>("GET", `/v1/items/${id}/list`));
const get = async (id: string, item: number) => ok(await srv.call<Detail>("GET", `/v1/items/${id}/get?item=${item}`));
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const post = <T = Record<string, unknown>>(id: string, action: string, body: Record<string, unknown>) => srv.call<Mutated<T>>("POST", `/v1/items/${id}/${action}`, body);
const COAT = "Rarity: RARE\nTest Coat\nAstral Plate\n+80 to maximum Life";
const swordA = "Rarity: RARE\nSword A\nRusted Sword\n+50 to maximum Life";
const swordB = "Rarity: RARE\nSword B\nRusted Sword\n+20 to maximum Life";

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("add from text, equip, unequip and delete move Life by exactly the item's mod", async () => {
  const id = await newWitch();
  assert.deepEqual(await output(id, "Life,Mana"), { Life: 1125, Mana: 590 });
  assert.deepEqual((await list(id)).items, []);

  const a = ok(await post(id, "add", { text: COAT, equip: "none", baseRevision: 1 }));
  assert.deepEqual([a.revision, a.result.id, a.result.equipped, a.result.baseName, a.changed], [2, 1, [], "Astral Plate", {}]);
  assert.deepEqual(await output(id, "Life"), { Life: 1125 });
  const item = await get(id, 1);
  assert.deepEqual([item.explicits, item.validSlots, item.rarity, item.title, item.sockets], [["+80 to maximum Life"], ["Body Armour"], "RARE", "Test Coat", "R-R-R-R-R-R"]);

  const e = ok(await post(id, "equip", { item: 1, slot: "Body Armour" }));
  assert.deepEqual(e.result, { item: 1, slot: "Body Armour" });
  assert.deepEqual([e.changed.Life, e.changed.Armour, e.changed.PhysicalDamageReduction], [{ before: 1125, after: 1205 }, { before: null, after: 938 }, { before: 0, after: 8 }]);
  assert.deepEqual(await output(id, "Life,Armour"), { Life: 1205, Armour: 938 });
  assert.deepEqual((await get(id, 1)).equipped, ["Body Armour"]);
  const l = await list(id);
  assert.deepEqual([l.slots.find((s) => s.slot === "Body Armour")?.item, l.items[0]?.equipped, l.weaponSet], [1, ["Body Armour"], 1]);

  const u = ok(await post(id, "unequip", { slot: "Body Armour" }));
  assert.deepEqual([u.changed.Life, u.changed.Armour], [{ before: 1205, after: 1125 }, { before: 938, after: null }]);
  assert.deepEqual((await list(id)).items.map((i) => [i.id, i.equipped]), [[1, []]]);

  ok(await post(id, "equip", { item: 1, slot: "Body Armour" }));
  const d = ok(await post(id, "delete", { item: 1 }));
  assert.deepEqual([d.result, d.changed.Life], [{ deleted: 1 }, { before: 1205, after: 1125 }]);
  assert.deepEqual((await output(id, "Life")).Life, 1125);
  const after = await list(id);
  assert.deepEqual([after.items, after.slots.find((s) => s.slot === "Body Armour")], [[], { slot: "Body Armour" }]);
  fails(await srv.call("GET", `/v1/items/${id}/get?item=1`), 404, "not_found");
});

void test("add_unique by name and by title: Goldrim's resistances and evasion, Tabula Rasa's movement penalty", async () => {
  const id = await newWitch();
  const g = ok(await post(id, "add-unique", { name: "Goldrim", equip: "auto" }));
  assert.deepEqual([g.result.name, g.result.baseName, g.result.equipped, g.result.sockets], ["Goldrim, Leather Cap", "Leather Cap", ["Helmet"], "G-G-G-G"]);
  assert.deepEqual([g.changed.FireResist, g.changed.ColdResist, g.changed.LightningResist, g.changed.Evasion], [{ before: -60, after: -25 }, { before: -60, after: -25 }, { before: -60, after: -25 }, { before: 15, after: 97 }]);
  const detail = await get(id, 1);
  assert.deepEqual([detail.explicits[1], detail.ranges.map((r) => [r.index, r.range])], ["+10% to Item Rarity", [[1, 0.5], [2, 0.5]]]);

  const t = ok(await post(id, "add-unique", { name: "tabula rasa, simple robe", equip: "auto" }));
  assert.deepEqual([t.result.equipped, t.result.sockets, t.changed], [["Body Armour"], "W-W-W-W-W-W", { EffectiveMovementSpeedMod: { before: 1, after: 0.97 } }]);
  assert.deepEqual(await output(id, "EffectiveMovementSpeedMod,FireResist"), { EffectiveMovementSpeedMod: 0.97, FireResist: -25 });
  assert.deepEqual((await list(id)).items.map((i) => i.id), [1, 2]);
});

void test("add_rare from a template; modify ranges, quality and sockets; edit replaces the text", async () => {
  const id = await newWitch();
  const r = ok(await post(id, "add-rare", { name: "Armour Helmet", equip: "auto" }));
  assert.deepEqual([r.result.name, r.result.equipped, r.changed.Life, r.changed.Armour], ["Armour Helmet, Giantslayer Helmet", ["Helmet"], { before: 1125, after: 1232 }, { before: null, after: 1501 }]);
  assert.deepEqual((await get(id, 1)).explicits, ["+50 to Armour", "74% increased Armour", "+107 to maximum Life"]);

  ok(await post(id, "add-unique", { name: "Goldrim", equip: "none" }));
  ok(await post(id, "equip", { item: 2, slot: "Helmet" }));
  assert.deepEqual(await output(id, "ColdResist,Evasion"), { ColdResist: -25, Evasion: 97 });
  const m = ok(await post<Detail>(id, "modify", { item: 2, ranges: [{ index: 2, value: 1 }] }));
  assert.deepEqual([m.changed.ColdResist, m.changed.FireResist, m.result.ranges.map((x) => x.range)], [{ before: -25, after: -20 }, { before: -25, after: -20 }, [0.5, 1]]);
  const q = ok(await post<Detail>(id, "modify", { item: 2, quality: 0 }));
  assert.deepEqual([q.changed, q.result.quality], [{ Evasion: { before: 97, after: 84 } }, 0]);
  const s = ok(await post<Detail>(id, "modify", { item: 2, sockets: "R-G-B B" }));
  assert.deepEqual([s.result.sockets, s.changed], ["R-G-B B", {}]);
  assert.match((await get(id, 2)).raw, /Sockets: R-G-B B/);

  const e = ok(await post<Detail>(id, "edit", { item: 2, text: "Rarity: UNIQUE\nGoldrim\nLeather Cap\n+10% to Item Rarity\n+30% to all Elemental Resistances" }));
  assert.deepEqual([e.result.id, e.result.explicits, e.result.equipped], [2, ["+10% to Item Rarity", "+30% to all Elemental Resistances"], ["Helmet"]]);
  assert.deepEqual(await output(id, "ColdResist,Evasion"), { ColdResist: -30, Evasion: 48 });
});

void test("modify picks a unique's variant; catalyst on a crafted amulet raises its Life", async () => {
  const id = await newWitch();
  ok(await post(id, "add-unique", { name: "Vessel of Vinktar", equip: "none" }));
  const before = await get(id, 1);
  assert.equal(before.variant, 18);
  assert.ok(before.explicits.includes("20% of Lightning Damage Leeched as Life during Effect"));
  const v = ok(await post<Detail>(id, "modify", { item: 1, variant: 2 }));
  assert.equal(v.result.variant, 2);
  assert.ok(v.result.explicits.includes("30% of Lightning Damage Leeched as Mana during Effect"));
  assert.ok(!v.result.explicits.includes("20% of Lightning Damage Leeched as Life during Effect"));
  fails(await post(id, "modify", { item: 1, variant: 99 }), 400, "invalid_input");

  const c = ok(await post<Detail>(id, "craft", { base: "Jade Amulet", affixes: [{ slot: 1, mod: "+# to maximum Life", roll: 1 }], equip: "auto" }));
  assert.deepEqual([c.result.explicits, c.result.equipped, c.changed.Life], [["+129 to maximum Life"], ["Amulet"], { before: 1125, after: 1254 }]);
  const k = ok(await post(id, "modify", { item: 2, catalyst: 4 }));
  assert.deepEqual(k.changed.Life, { before: 1254, after: 1279 });
  const k10 = ok(await post(id, "modify", { item: 2, catalystQuality: 10 }));
  assert.deepEqual(k10.changed.Life, { before: 1279, after: 1266 });
  assert.match((await get(id, 2)).raw, /Catalyst: Fertile\nCatalystQuality: 10/);
  fails(await post(id, "modify", { item: 1, catalyst: 4 }), 400, "invalid_input");
});

void test("anoint an amulet: get shows the notable and its stats move; two anoints need a second slot", async () => {
  const id = await newWitch();
  ok(await post(id, "add", { text: "Rarity: RARE\nTest Amulet\nOnyx Amulet", equip: "auto" }));
  const a = ok(await post<Detail>(id, "anoint", { item: 1, notables: ["Heart of Oak"] }));
  assert.deepEqual([a.result.anoints, a.result.enchants, a.changed.Life, a.changed["Spec:LifeInc"]], [["Heart of Oak"], ["Allocates Heart of Oak"], { before: 1125, after: 1215 }, { before: null, after: 8 }]);
  assert.deepEqual((await get(id, 1)).anoints, ["Heart of Oak"]);
  const b = ok(await post<Detail>(id, "anoint", { item: 1, notables: ["constitution"] }));
  assert.deepEqual([b.result.anoints, b.changed.Life, b.changed["Spec:LifeInc"]], [["Constitution"], { before: 1215, after: 1260 }, { before: 8, after: 10 }]);
  const rev = await revisionOf(id);
  fails(await post(id, "anoint", { item: 1, notables: ["Heart of Oak", "Constitution"] }), 400, "invalid_input");
  fails(await post(id, "anoint", { item: 1, notables: ["Not A Notable"] }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
  const r = ok(await post<Detail>(id, "anoint", { item: 1, notables: [] }));
  assert.deepEqual([r.result.anoints, r.changed.Life], [[], { before: 1260, after: 1125 }]);

  ok(await post(id, "add", { text: "Rarity: RARE\nTest Boots\nIron Greaves", equip: "auto" }));
  fails(await post(id, "anoint", { item: 2, notables: ["Heart of Oak"] }), 400, "invalid_input");
});

void test("enchant boots and a helmet; craft chooses bench mods in the affix boxes", async () => {
  const id = await newWitch();
  ok(await post(id, "add", { text: "Rarity: RARE\nTest Boots\nIron Greaves", equip: "auto" }));
  const rev = await revisionOf(id);
  fails(await post(id, "enchant", { item: 1, enchantment: "no such enchantment" }), 400, "invalid_input");
  fails(await post(id, "enchant", { item: 1, enchantment: "Movement Speed", source: "Normal Labyrinth" }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
  const e = ok(await post<Detail>(id, "enchant", { item: 1, enchantment: "10% increased Movement Speed if you haven't been Hit Recently", source: "Eternal Labyrinth" }));
  assert.deepEqual([e.result.enchants, e.changed.EffectiveMovementSpeedMod], [["10% increased Movement Speed if you haven't been Hit Recently"], { before: 1, after: 1.1 }]);

  ok(await post(id, "add", { text: "Rarity: RARE\nTest Helm\nIron Hat", equip: "auto" }));
  const h = ok(await post<Detail>(id, "enchant", { item: 2, enchantment: "Absolution Cast Speed", skill: "Absolution", source: "Eternal Labyrinth" }));
  assert.deepEqual(h.result.enchants, ["12% increased Absolution Cast Speed"]);

  const c = ok(await post<Detail>(id, "craft", { base: "Astral Plate", rarity: "RARE", title: "Bench Coat", affixes: [{ slot: 1, mod: "+# to maximum Life", roll: 1 }], equip: "auto" }));
  assert.deepEqual([c.result.explicits, c.result.title, c.result.equipped, c.changed.Life], [["+189 to maximum Life"], "Bench Coat", ["Body Armour"], { before: 1125, after: 1314 }]);
  const low = ok(await post<Detail>(id, "craft", { base: "Astral Plate", affixes: [{ slot: 1, mod: "+# to maximum Life", roll: 0 }], equip: "none" }));
  assert.deepEqual([low.result.explicits, low.changed], [["+3 to maximum Life"], {}]);
  const n = ok(await post<Detail>(id, "craft", { base: "Iron Hat", rarity: "NORMAL", equip: "none" }));
  assert.deepEqual([n.result.rarity, n.result.explicits], ["NORMAL", []]);
  fails(await post(id, "craft", { base: "No Such Base" }), 400, "invalid_input");
  fails(await post(id, "craft", { base: "Iron Hat", affixes: [{ slot: 1, mod: "no such mod" }] }), 400, "invalid_input");
  fails(await post(id, "craft", { base: "Iron Hat", rarity: "UNIQUE" }), 400, "invalid_input");
});

void test("flasks: the Active box switches the flask's effect on and off", async () => {
  const id = await newWitch();
  ok(await post(id, "add", { text: "Rarity: NORMAL\nQuicksilver Flask", equip: "auto" }));
  assert.equal((await list(id)).slots.find((s) => s.slot === "Flask 1")?.active, false);
  const on = ok(await post(id, "set-active", { slot: "Flask 1", active: true }));
  assert.deepEqual([on.result, on.changed], [{ slot: "Flask 1", active: true }, { EffectiveMovementSpeedMod: { before: 1, after: 1.4 } }]);
  assert.equal((await list(id)).slots.find((s) => s.slot === "Flask 1")?.active, true);
  const off = ok(await post(id, "set-active", { slot: "Flask 1", active: false }));
  assert.deepEqual(off.changed, { EffectiveMovementSpeedMod: { before: 1.4, after: 1 } });
  fails(await post(id, "set-active", { slot: "Flask 2", active: true }), 400, "invalid_input");
  fails(await post(id, "set-active", { slot: "Ring 1", active: true }), 400, "invalid_input");
});

void test("weapon_set swaps the weapon set; its slots and stats follow", async () => {
  const id = await newWitch();
  ok(await post(id, "add", { text: swordA, equip: "auto" }));
  const b = ok(await post(id, "add", { text: swordB, equip: "Weapon 1 Swap" }));
  assert.deepEqual([b.result.equipped, b.changed], [["Weapon 1 Swap"], {}]);
  assert.equal((await output(id, "Life")).Life, 1175);
  assert.equal((await list(id)).slots.find((s) => s.slot === "Weapon 1")?.item, 1);

  const s2 = ok(await post(id, "weapon-set", { set: 2 }));
  assert.deepEqual([s2.result, s2.changed.Life], [{ weaponSet: 2 }, { before: 1175, after: 1145 }]);
  const l = await list(id);
  assert.deepEqual([l.weaponSet, l.slots.find((s) => s.slot === "Weapon 1 Swap")?.item, l.slots.some((s) => s.slot === "Weapon 1")], [2, 2, false]);
  const again = ok(await post(id, "weapon-set", { set: 2 }));
  assert.deepEqual([again.result, again.changed], [{ weaponSet: 2 }, {}]);
  const s1 = ok(await post(id, "weapon-set", { set: 1 }));
  assert.deepEqual([s1.result, s1.changed.Life], [{ weaponSet: 1 }, { before: 1145, after: 1175 }]);
  fails(await post(id, "weapon-set", { set: 3 }), 400, "invalid_input");
});

void test("item sets: new, copy, rename, activate (stats follow the set), delete; the last one stays", async () => {
  const id = await newWitch();
  ok(await post(id, "add", { text: COAT, equip: "auto" }));
  const titles = async () => (await list(id)).sets.map((s) => [s.title, s.active]);
  assert.deepEqual(await titles(), [["Default", true]]);

  assert.deepEqual(ok(await post<{ sets: Sets }>(id, "set-copy", { index: 1, title: "Copy" })).result.sets.map((s) => s.title), ["Default", "Copy"]);
  ok(await post(id, "set-new", { title: "Empty" }));
  ok(await post(id, "set-rename", { index: 2, title: "Renamed" }));
  assert.deepEqual(await titles(), [["Default", true], ["Renamed", false], ["Empty", false]]);

  const empty = ok(await post(id, "set-activate", { index: 3 }));
  assert.deepEqual([empty.changed.Life, empty.changed.Armour], [{ before: 1205, after: 1125 }, { before: 938, after: null }]);
  assert.deepEqual((await list(id)).items.map((i) => i.equipped), [[]]);
  const copy = ok(await post(id, "set-activate", { index: 2 }));
  assert.deepEqual(copy.changed.Life, { before: 1125, after: 1205 });
  ok(await post(id, "unequip", { slot: "Body Armour" }));
  assert.equal((await output(id, "Life")).Life, 1125);
  const back = ok(await post(id, "set-activate", { index: 1 }));
  assert.deepEqual(back.changed.Life, { before: 1125, after: 1205 });
  assert.deepEqual(await titles(), [["Default", true], ["Renamed", false], ["Empty", false]]);
  // list with itemSet: the slots as another set holds them, without switching to it
  const bodyIn = async (q: string) => ok(await srv.call<Listing>("GET", `/v1/items/${id}/list${q}`)).slots.find((x) => x.slot === "Body Armour")?.item;
  assert.deepEqual([await bodyIn(""), await bodyIn("?itemSet=1"), await bodyIn("?itemSet=2"), await bodyIn("?itemSet=3")], [1, 1, undefined, undefined]);
  assert.deepEqual(await titles(), [["Default", true], ["Renamed", false], ["Empty", false]], "listing a set does not switch to it");
  fails(await srv.call("GET", `/v1/items/${id}/list?itemSet=9`), 404, "not_found");

  ok(await post(id, "set-delete", { index: 3 }));
  ok(await post(id, "set-delete", { index: 2 }));
  assert.deepEqual(await titles(), [["Default", true]]);
  const rev = await revisionOf(id);
  fails(await post(id, "set-delete", { index: 1 }), 400, "invalid_input");
  fails(await post(id, "set-activate", { index: 4 }), 404, "not_found");
  fails(await post(id, "set-rename", { index: 1, title: "" }), 400, "invalid_input");
  fails(await post(id, "set-copy", { index: 9 }), 404, "not_found");
  assert.equal(await revisionOf(id), rev);
  assert.equal((await output(id, "Life")).Life, 1205);
});

void test("failures change nothing: unknown unique or rare, unreadable text, wrong slot, unknown item or slot", async () => {
  const id = await newWitch();
  ok(await post(id, "add", { text: COAT, equip: "none" }));
  const rev = await revisionOf(id);
  const before = await list(id);
  fails(await post(id, "add-unique", { name: "No Such Unique" }), 404, "not_found");
  fails(await post(id, "add-rare", { name: "No Such Template" }), 404, "not_found");
  fails(await post(id, "add", { text: "this is not an item" }), 400, "invalid_input");
  fails(await post(id, "add", { text: COAT, equip: "Helmet" }), 400, "invalid_input");
  fails(await post(id, "edit", { item: 1, text: "this is not an item" }), 400, "invalid_input");
  fails(await post(id, "equip", { item: 1, slot: "Helmet" }), 400, "invalid_input");
  fails(await post(id, "equip", { item: 1, slot: "Ring 9" }), 400, "invalid_input");
  fails(await post(id, "equip", { item: 7, slot: "Body Armour" }), 404, "not_found");
  fails(await post(id, "delete", { item: 7 }), 404, "not_found");
  fails(await post(id, "modify", { item: 1, sockets: "R-R-R-R-R-R-R" }), 400, "invalid_input");
  fails(await post(id, "modify", { item: 1, sockets: "R-G-B" }), 400, "invalid_input");
  fails(await post(id, "modify", { item: 1, ranges: [{ index: 5, value: 1 }] }), 400, "invalid_input");
  fails(await post(id, "add", { text: "x".repeat(20001) }), 400, "invalid_input");
  fails(await post(id, "weapon-set", { set: 0 }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
  assert.deepEqual(await list(id), before);
  assert.equal((await output(id, "Life")).Life, 1125);
});

void test("a stale baseRevision is refused with 409 and changes nothing", async () => {
  const id = await newWitch();
  ok(await post(id, "add", { text: COAT, equip: "none" }));
  fails(await post(id, "equip", { item: 1, slot: "Body Armour", baseRevision: 1 }), 409, "stale_revision");
  fails(await post(id, "add-unique", { name: "Goldrim", baseRevision: 1 }), 409, "stale_revision");
  fails(await post(id, "delete", { item: 1, baseRevision: 1 }), 409, "stale_revision");
  fails(await post(id, "set-new", { baseRevision: 1 }), 409, "stale_revision");
  assert.equal(await revisionOf(id), 2);
  assert.deepEqual([(await list(id)).items.length, (await output(id, "Life")).Life], [1, 1125]);
  assert.equal(ok(await post(id, "equip", { item: 1, slot: "Body Armour", baseRevision: 2 })).revision, 3);
});

void test("MCP: pob_items is listed and reads the item list", async () => {
  const id = await newWitch();
  ok(await post(id, "add", { text: COAT, equip: "auto" }));
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.find((t) => t.name === "pob_items")?.annotations?.readOnlyHint, false);
    const r = await client.callTool({ name: "pob_items", arguments: { action: "list", id } });
    assert.ok(!r.isError, JSON.stringify(r.content));
    const l = (r.structuredContent as { result: Listing }).result;
    assert.deepEqual(l.items.map((i) => [i.id, i.name, i.equipped]), [[1, "Test Coat, Astral Plate", ["Body Armour"]]]);
    const m = await client.callTool({ name: "pob_items", arguments: { action: "unequip", id, slot: "Body Armour" } });
    assert.ok(!m.isError, JSON.stringify(m.content));
    assert.deepEqual((m.structuredContent as { result: Mutated }).result.changed.Life, { before: 1205, after: 1125 });
    const bad = await client.callTool({ name: "pob_items", arguments: { action: "equip", id, item: 0, slot: "Body Armour" } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
});

void test("warnings: more suffixes than a rare can have, eldritch implicits with conqueror influence; a legal ring with a hybrid mod has none", async () => {
  const id = await newWitch();
  const add = async (text: string) => ok(await post<Brief & { warnings?: string[] }>(id, "add", { text, equip: "none" })).result.warnings;
  const ring = (lines: string[]) => ["Rarity: RARE", "T Ring", "Amethyst Ring", "Implicits: 1", "+15% to Chaos Resistance", ...lines].join("\n");
  assert.deepEqual(await add(ring(["+40% to Fire Resistance", "+40% to Cold Resistance", "+40% to Lightning Resistance", "+30% to Chaos Resistance"])), ["4 suffixes, more than the 3 a rare Ring can have"]);
  assert.equal(await add(ring(["+70 to maximum Life", "+40% to Fire Resistance", "+40% to Cold Resistance", "+300 to Accuracy Rating", "15% increased Light Radius"])), undefined, "the accuracy and light radius hybrid is one suffix");
  assert.deepEqual(await add("Rarity: RARE\nT Gloves\nSorcerer Gloves\nHunter Item\nSearing Exarch Item\nImplicits: 1\n{exarch}+1 to Maximum Power Charges\n+80 to maximum Energy Shield"), ["an item with eldritch implicits (Searing Exarch / Eater of Worlds) cannot also have Shaper, Elder or conqueror influence"]);
  // a bench craft of two lines (ModMaster, no spawn weight) is one prefix, next to a rolled line of the same stat
  const belt = ["Rarity: RARE", "Budget Girdle", "Crystal Belt", "Item Level: 84", "Implicits: 1", "+70 to maximum Energy Shield", "+45 to maximum Energy Shield", "+60 to maximum Mana", "+53 to Strength", "+42% to Cold Resistance", "+42% to Lightning Resistance"];
  assert.equal(await add([...belt, "{crafted}+285 to Armour", "{crafted}+25 to maximum Energy Shield"].join("\n")), undefined, "the Armour and Energy Shield craft is one prefix");
  assert.deepEqual(await add([...belt, "+285 to Armour", "{crafted}+25 to maximum Energy Shield"].join("\n")), ["4 prefixes, more than the 3 a rare Belt can have"], "a rolled Armour line is not part of the craft");
  // cluster notables weigh by the enchant's tags; three prefix notables are one too many, two plus a suffix notable are legal
  const cluster = (notables: string[]) => ["Rarity: RARE", "C", "Large Cluster Jewel", "Item Level: 84", "Adds 8 Passive Skills", "2 Added Passive Skills are Jewel Sockets", "Added Small Passive Skills grant: 12% increased Lightning Damage", ...notables.map((n) => `1 Added Passive Skill is ${n}`)].join("\n");
  assert.deepEqual(await add(cluster(["Overshock", "Thunderstruck", "Prismatic Heart"])), ["3 prefixes, more than the 2 a rare Jewel can have"]);
  assert.equal(await add(cluster(["Overshock", "Thunderstruck", "Widespread Destruction"])), undefined, "Widespread Destruction is a suffix");
  assert.equal((await list(id)).items.filter((i) => (i as { warnings?: string[] }).warnings).length, 4, "the list carries them");
});

void test("tooltip: an item's hover text, a flask's effective stats and uptime", async () => {
  const id = await newWitch();
  const flask = ok(await post<Brief>(id, "add", { text: "Rarity: MAGIC\nQuicksilver Flask", equip: "Flask 1" })).result.id;
  const t = ok(await srv.call<{ item: number; name: string; lines: string[] }>("GET", `/v1/items/${id}/tooltip?item=${flask}`));
  assert.deepEqual([t.item, t.name], [flask, "Quicksilver Flask"]);
  assert.deepEqual(t.lines.slice(t.lines.indexOf("Effective flask stats:")), ["Effective flask stats:", "Flask uptime: 0% average, 0% minimum", "Activating this flask will give you:", "+39% Movement Speed Modifier"], "no charges generated per second: uptime 0");
  fails(await srv.call("GET", `/v1/items/${id}/tooltip?item=99`), 404, "not_found");
  // by slot of the active item set instead of item id
  assert.equal(ok(await srv.call<{ item: number }>("GET", `/v1/items/${id}/tooltip?slot=Flask%201`)).item, flask);
  fails(await srv.call("GET", `/v1/items/${id}/tooltip?slot=Flask%203`), 404, "not_found");
  fails(await srv.call("GET", `/v1/items/${id}/tooltip`), 400, "invalid_input");

  // Our uptime estimate with charges gained on critical strike: the flask's own 33% counts for it, not as the build's,
  // even while the flask is active (Path of Building then adds its mods to the build's).
  type Uptime = { chargesGainedPerSecond: number; chargesNeededPerSecond: number; estimatedUptime: number; source: string; inputs: { critsPerSecond: number; gainModifier: number; generatedPerSecond: number; hitsTakenPerSecond: number; [k: string]: number } };
  ok(await srv.call("POST", `/v1/skills/${id}/add-group`, { gems: [{ name: "Fireball" }], includeInFullDPS: true }));
  const surgeon = ok(await post<Brief>(id, "add", { text: "Rarity: MAGIC\nSurgeon's Silver Flask\n33% chance to gain a Flask Charge when you deal a Critical Strike", equip: "Flask 2" })).result.id;
  ok(await post(id, "set-active", { slot: "Flask 2", active: true }));
  const u = ok(await srv.call<{ uptime?: Uptime }>("GET", `/v1/items/${id}/tooltip?item=${surgeon}`)).uptime;
  assert.ok(u && u.inputs.critsPerSecond > 0, JSON.stringify(u));
  assert.deepEqual([u.inputs.flaskChanceOnCrit, u.inputs.buildChanceOnCrit, u.inputs.chargesPerUse, u.inputs.duration, u.inputs.generatedPerSecond], [33, 0, 40, 7.2, 0]);
  assert.ok(Math.abs(u.chargesNeededPerSecond - 40 / 7.2) < 1e-9);
  assert.ok(Math.abs(u.chargesGainedPerSecond - u.inputs.critsPerSecond * 0.33 * u.inputs.gainModifier) < 1e-6);
  assert.ok(Math.abs(u.estimatedUptime - Math.min(u.chargesGainedPerSecond / u.chargesNeededPerSecond, 1)) < 1e-6);
  assert.match(u.source, /not Path of Building; any in-game cooldown/);
  assert.equal(ok(await srv.call<{ uptime?: Uptime }>("GET", `/v1/items/${id}/tooltip?item=${flask}`)).uptime?.inputs.flaskChanceOnCrit, 0, "Quicksilver has no crit charge mod");
  // charges when hit (Masochist's; PoB parses the line to nothing): one hit per enemy attack or cast, 700 ms by default
  const maso = ok(await post<Brief>(id, "add", { text: "Rarity: MAGIC\nMasochist's Granite Flask\nGain 2 Charges when you are Hit by an Enemy", equip: "Flask 3" })).result.id;
  const m = ok(await srv.call<{ uptime?: Uptime }>("GET", `/v1/items/${id}/tooltip?item=${maso}`)).uptime;
  assert.ok(m, "Granite is a utility flask");
  assert.deepEqual([m.inputs.flaskChargesWhenHit, m.inputs.flaskChargesPerCrit, m.inputs.flaskChanceOnCrit], [2, 0, 0]);
  assert.ok(Math.abs(m.inputs.hitsTakenPerSecond - 1 / 0.7) < 1e-6, String(m.inputs.hitsTakenPerSecond));
  assert.ok(Math.abs(m.chargesGainedPerSecond - (m.inputs.hitsTakenPerSecond * 2 * m.inputs.gainModifier + m.inputs.generatedPerSecond)) < 1e-6);
  assert.ok(m.estimatedUptime > 0);
});

void test("warnings: engine notes for no ascendancy, custom modifiers, typed minion counts and gems over sockets", async () => {
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", level: 95, treeVersion: "3_30" })).build.id;
  ok(await srv.call("POST", `/v1/config/${id}/set-custom-mods`, { groups: [{ title: "Flat", text: "+100 to maximum Life" }, { title: "Off", enabled: false, text: "+5 to maximum Mana" }] }));
  ok(await post(id, "add", { text: "Rarity: NORMAL\nSilk Gloves\nSockets: B-B-B-B", equip: "Gloves" }));
  ok(await srv.call("POST", `/v1/skills/${id}/add-group`, { slot: "Gloves", gems: [{ name: "Raise Zombie", count: 20 }, { name: "Minion Damage" }, { name: "Melee Splash" }, { name: "Brutality" }, { name: "Feeding Frenzy" }, { name: "Elemental Army", enabled: false }], includeInFullDPS: true }));
  const w = ok(await srv.call<{ warnings: string[] }>("GET", `/v1/stats/${id}/warnings`)).warnings.filter((x) => x.startsWith("Engine note:"));
  const limit = Number(ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=ActiveMinionLimit`)).output.ActiveMinionLimit);
  assert.deepEqual(w, [
    "Engine note: Gloves Silk Gloves holds 5 enabled gems in 4 sockets; Path of Building counts every gem",
    `Engine note: Raise Zombie: 20 minions counted in Full DPS against a limit of ${limit}; Path of Building counts every typed one`,
    "Engine note: level 95 with no ascendancy chosen: the figures carry no ascendancy nodes (the build file holds none)",
    "Engine note: the Config tab's custom modifiers add \"+100 to maximum Life\" with no item, node or skill behind them",
  ]);
  assert.ok(limit > 0 && limit < 20, String(limit));
});

void test("warnings: engine notes for lines Path of Building scales twice or does not model", async () => {
  const id = await newWitch();
  // stored as the game shows it (+2, +48%), not as the affix rolls (+1, +24%): PoB applies the 100% magnitude again
  const focused = ["Rarity: RARE", "Doubled", "Focused Amulet", "Crafted: true", "Prefix: {range:0.5}GlobalSkillGemLevel1", "Suffix: {range:0.208}GlobalDamageOverTimeMultiplier1h5",
    "Implicits: 4", "-1 Prefix Modifier allowed", "-2 Suffix Modifiers allowed", "Implicit Modifiers Cannot Be Changed", "100% increased Explicit Modifier magnitudes",
    "+48% to Damage over Time Multiplier", "+2 to Level of all Skill Gems"].join("\n");
  ok(await post(id, "add", { text: focused, equip: "Amulet" }));
  ok(await post(id, "add", { text: "Rarity: UNIQUE\nHeadhunter\nLeather Belt\nImplicits: 1\n+30 to maximum Life\nWhen you Kill a Rare monster, you gain its Modifiers for 60 seconds", equip: "Belt" }));
  const w = ok(await srv.call<{ warnings: string[] }>("GET", `/v1/stats/${id}/warnings`)).warnings.filter((x) => x.startsWith("Engine note:"));
  assert.deepEqual(w, [
    "Engine note: Amulet Doubled, Focused Amulet: \"+2 to Level of all Skill Gems\" is above its affix's maximum 1, so the line already carries the item's magnitude and Path of Building scales it again (x2); re-enter the line at the affix's roll",
    "Engine note: Amulet Doubled, Focused Amulet: \"+48% to Damage over Time Multiplier\" is above its affix's maximum 26, so the line already carries the item's magnitude and Path of Building scales it again (x2); re-enter the line at the affix's roll",
    "Engine note: Belt Headhunter, Leather Belt: Path of Building does not model \"When you Kill a Rare monster, you gain its Modifiers for 60 seconds\"",
  ]);
});
