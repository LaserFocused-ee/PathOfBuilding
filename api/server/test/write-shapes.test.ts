// Every write route is called once with valid arguments on a real build, and its answer must match the output it declares.
// A write route that is added without a call here fails the last test.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { routes } from "../src/routes.js";
import { FIXTURES, ROOT, startServer, type TestServer } from "./helpers.js";

type Body = Record<string, unknown>;
type Reply = { status: number; body: { ok: boolean; result: Record<string, unknown>; error?: { code: string; message: string } } };

let srv: TestServer;
let freshXml: string;
const called = new Set<string>();

before(async () => {
  freshXml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const sample = (JSON.parse(await readFile(join(ROOT, "spec/System/SampleCharacter.json"), "utf8")) as { character: { name: string; realm: string; class: string; league: string; level: number; equipment: unknown[]; jewels: unknown[]; passives: Record<string, unknown> } }).character;
  const entry = { name: sample.name, realm: sample.realm, class: sample.class, league: sample.league, level: sample.level };
  const bodies: Record<string, string> = {
    "get-characters": JSON.stringify([entry]),
    "get-passive-skills": JSON.stringify({ ...sample.passives, items: sample.jewels }),
    "get-items": JSON.stringify({ items: sample.equipment, character: entry }),
  };
  // No live calls: the game site answers from the recording, a share link's download answers with the fixture build.
  const recorded = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.host === "pobb.in") return Promise.resolve(new Response(freshXml));
    const body = bodies[url.pathname.replace("/character-window/", "")];
    return Promise.resolve(body ? new Response(body, { headers: { "content-type": "application/json" } }) : new Response("", { status: 404 }));
  };
  srv = await startServer({}, { fetch: recorded });
});
after(async () => {
  await srv?.close();
});

const route = (name: string) => {
  const r = routes.find((x) => x.name === name);
  assert.ok(r, `no route ${name}`);
  return r;
};

/** Calls a write route by name, checks the answer against the route's declared output, and returns the answer's `result`. */
async function write(name: string, id: string | null, body: Body = {}): Promise<Record<string, unknown>> {
  const r = route(name);
  assert.ok(!r.readOnly, `${name} is not a write route`);
  const path = r.path.replace(":id", id ?? "");
  const res = (await srv.call(r.method, r.method === "DELETE" ? `${path}${Object.keys(body).length ? `?${new URLSearchParams(body as Record<string, string>)}` : ""}` : path, r.method === "DELETE" ? undefined : body)) as Reply;
  assert.equal(res.status, 200, `${name}: ${JSON.stringify(res.body.error)}`);
  const parsed = r.output.safeParse(res.body.result);
  assert.ok(parsed.success, `${name} answer does not match its declared output: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))} in ${JSON.stringify(res.body.result).slice(0, 400)}`);
  called.add(name);
  return res.body.result;
}

const get = async (path: string) => ((await srv.call("GET", path)) as Reply).body.result;
const idOf = (created: Record<string, unknown>): string => (created.build as { id: string }).id;
/** A new level 90 Witch / Elementalist on tree 3_30 with no groups and no items. */
const newWitch = async (): Promise<string> => idOf(await write("build.new", null, { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" }));
const revisionOf = async (id: string) => ((await get(`/v1/builds/${id}`)).build as { revision: number }).revision;
/** The id of the item a write answered with (the op's `result` sits inside the answer). */
const idItem = (answer: Record<string, unknown>) => Number((answer.result as { id: number }).id);

void test("tree writes", async () => {
  const id = await newWitch();
  await write("tree.set_class", id, { className: "Marauder", onDisconnected: "reset" });
  await write("tree.set_class", id, { className: "Witch", onDisconnected: "reset" });
  await write("tree.set_ascendancy", id, { ascendancy: "Necromancer" });
  await write("tree.set_bloodline", id, { bloodline: "Oshabi" });
  await write("tree.allocate", id, { nodes: ["Arcane Potency"] });
  await write("tree.set_mastery", id, { nodeId: 16123, effectId: 61534 });
  const url = (await get(`/v1/tree/${id}/export-url`)).url as string;
  await write("tree.spec_copy", id, { index: 1 });
  await write("tree.spec_rename", id, { index: 2, title: "Second" });
  await write("tree.spec_activate", id, { index: 2 });
  await write("tree.deallocate", id, { nodes: ["Arcane Potency"] });
  await write("tree.reset", id);
  await write("tree.allocate", id, { nodes: [37671] });
  await write("tree.tattoo", id, { node: 37671, tattoo: "Tattoo of the Valako Stormrider" });
  await write("tree.untattoo", id, { node: 37671 });
  await write("tree.remove_tattoos", id);
  await write("tree.spec_new", id, { title: "Blank" });
  await write("tree.import_url", id, { url, title: "From link" });
  await write("tree.spec_delete", id, { index: 1 });
  await write("tree.convert", id, { version: "3_28", keepOld: true });
});

void test("skills writes", async () => {
  const id = await newWitch();
  // A body armour with sockets, for the groups that need an item.
  const coat = idItem(await write("items.add", id, { text: "Rarity: RARE\nTest Coat\nAstral Plate\nSockets: R-R-G-B-B-B\n+80 to maximum Life", equip: "auto" }));
  assert.ok(coat >= 1);
  await write("skills.add_group", id, { gems: [{ name: "Fireball" }, { name: "Fire Penetration" }] });
  await write("skills.add_group", id, { text: "Label: Ice\nFreezing Pulse 20/0  1\n" });
  await write("skills.add_group", id, { gems: [{ name: "Raise Spectre" }], slot: "Body Armour", label: "Socketed" });
  await write("skills.update_group", id, { group: 2, label: "Frost", includeInFullDPS: true });
  await write("skills.move_group", id, { group: 2, to: 1 });
  await write("skills.set_main", id, { group: 2, skill: 1 });
  await write("skills.set_gem", id, { group: 1, gem: 1, level: 15 });
  await write("skills.set_gem", id, { group: 1, gem: 2, name: "Spell Echo" });
  await write("skills.delete_gem", id, { group: 1, gem: 2 });
  await write("skills.set_options", id, { defaultGemLevel: "characterLevel", defaultGemQuality: 10 });
  await write("skills.set_skill_options", id, { part: 1 });
  await write("skills.set_spectres", id, { add: ["Blackguard Mage"] });
  await write("skills.set_imbued", id, { group: 3, name: "None" });
  await write("skills.optimise_sockets", id, { group: 3 });
  await write("skills.delete_group", id, { group: 3 });
  await write("skills.set_new", id, { title: "Two" });
  await write("skills.set_copy", id, { index: 1 });
  await write("skills.set_rename", id, { index: 2, title: "Renamed" });
  await write("skills.set_activate", id, { index: 2 });
  await write("skills.set_delete", id, { index: 2 });
});

void test("items writes", async () => {
  const id = await newWitch();
  const coat = idItem(await write("items.add", id, { text: "Rarity: RARE\nTest Coat\nAstral Plate\n+80 to maximum Life", equip: "none" }));
  const goldrim = idItem(await write("items.add_unique", id, { name: "Goldrim", equip: "none" }));
  const helmet = idItem(await write("items.add_rare", id, { name: "Armour Helmet", equip: "none" }));
  await write("items.modify", id, { item: coat, quality: 20 });
  await write("items.edit", id, { item: coat, text: "Rarity: RARE\nTest Coat\nAstral Plate\n+90 to maximum Life" });
  const amulet = idItem(await write("items.add", id, { text: "Rarity: RARE\nTest Amulet\nOnyx Amulet\n+50 to maximum Life", equip: "auto" }));
  await write("items.anoint", id, { item: amulet, notables: ["Heart of Oak"] });
  const boots = idItem(await write("items.add", id, { text: "Rarity: RARE\nTest Boots\nIron Greaves", equip: "auto" }));
  await write("items.enchant", id, { item: boots, enchantment: "10% increased Movement Speed if you haven't been Hit Recently", source: "Eternal Labyrinth" });
  const jewel = idItem(await write("items.craft", id, { base: "Small Cluster Jewel", rarity: "RARE", equip: "none" }));
  await write("items.cluster_jewel", id, { item: jewel, skill: "Life", nodes: 3 });
  await write("items.influence", id, { item: coat, influences: ["Shaper"] });
  await write("items.add_implicit", id, { item: coat, text: "+25 to maximum Life" });
  const gloves = idItem(await write("items.add", id, { text: "Rarity: RARE\nBench Gloves\nIron Gauntlets", equip: "none" }));
  await write("items.custom_mod", id, { item: gloves, source: "Custom", text: "+30 to maximum Life" });
  await write("items.corrupt", id, { item: gloves, implicits: [] });
  const sword = idItem(await write("items.add", id, { text: "Rarity: RARE\nCrucible Sword\nRusted Sword\n+10 to maximum Life", equip: "none" }));
  await write("items.crucible_mod", id, { item: sword, mods: [{ node: 1, mod: "None" }] });
  const flask = idItem(await write("items.add", id, { text: "Rarity: MAGIC\nQuicksilver Flask", equip: "auto" }));
  await write("items.equip", id, { item: helmet, slot: "Helmet" });
  await write("items.unequip", id, { slot: "Helmet" });
  await write("items.set_active", id, { slot: "Flask 1", active: true });
  await write("items.weapon_set", id, { set: 2 });
  await write("items.delete", id, { item: flask });
  assert.ok(goldrim >= 1);
  await write("items.set_new", id, { title: "Two" });
  await write("items.set_copy", id, { index: 1 });
  await write("items.set_rename", id, { index: 2, title: "Renamed" });
  await write("items.set_activate", id, { index: 2 });
  await write("items.set_delete", id, { index: 2 });
});

void test("config and party writes", async () => {
  const id = await newWitch();
  await write("config.set", id, { values: { buffOnslaught: true } });
  await write("config.set_notes", id, { text: "a note" });
  await write("config.set_new", id, { title: "Two" });
  await write("config.set_copy", id, { index: 1 });
  await write("config.set_rename", id, { index: 2, title: "Renamed" });
  await write("config.set_activate", id, { index: 2 });
  await write("config.set_delete", id, { index: 3 });
  await write("config.set_custom_mods", id, { groups: [{ title: "Extra", enabled: true, text: "+10 to maximum Life" }] });
  // A party member's code, exported with Export support on.
  const member = await newWitch();
  await write("skills.add_group", member, { gems: [{ name: "Determination" }] });
  await write("build.ui_invoke", member, { tab: "import", control: "enablePartyExportBuffs", operation: "set_state", value: true });
  const code = (await get(`/v1/builds/${member}/code`)).code as string;
  await write("config.party_import", id, { code, destination: "Aura" });
  await write("config.party_set", id, { showAdvanced: true });
  await write("config.party_effects", id, { enabled: false });
  await write("config.party_clear", id, { destination: "Aura" });
});

void test("build writes: imports, loadouts, settings, history; delete and restore last", async () => {
  const id = await newWitch();
  await write("build.settings", id, { level: 70 });
  await write("build.loadout_new", id, { name: "Two" });
  await write("build.loadout_activate", id, { name: "Default" });
  await write("build.ui_invoke", id, { tab: "config", control: "buffOnslaught", operation: "set_state", value: true });
  await write("build.rename", id, { name: "Renamed" });
  await write("build.save_point", id, { label: "here" });
  const copy = idOf(await write("build.duplicate", id, { name: "Copy" }));
  await write("build.revert", id, { revision: 1 });
  const code = (await get(`/v1/builds/${id}/code`)).code as string;
  await write("build.replace_code", id, { code, baseRevision: await revisionOf(id) });
  await write("build.import_xml", null, { xml: freshXml });
  await write("build.import_code", null, { code });
  await write("build.import_link", null, { url: "https://pobb.in/AbC123xyz" });
  await write("build.import_character", null, { account: "Test#0000", character: "testCharacter" });
  await write("build.delete", copy);
  await write("build.restore", copy);
});

void test("every write route was called, and none is declared without a result shape", () => {
  const writes = routes.filter((r) => !r.readOnly).map((r) => r.name).sort();
  assert.deepEqual([...called].sort(), writes, "a write route has no call in this file");
  assert.equal(called.size, 86);
});
