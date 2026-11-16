// Worker tests for the Skills tab (socket groups, gems, main skill, skill sets, gem options), on tree 3_30, through HTTP and MCP.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { FIXTURES, startServer, TOKEN, type TestServer } from "./helpers.js";

type Change = Record<string, { before: number | null; after: number | null }>;
type Mutated<T = Record<string, unknown>> = { result: T; changed: Change; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Gem = { index: number; name: string; level: number; quality: number; enabled: boolean; count: number; support: boolean };
type Group = { index: number; label: string; slot?: string; enabled: boolean; includeInFullDPS: boolean; gems: Gem[]; activeSkills: string[]; mainActiveSkill?: number; main: boolean };
type Skills = {
  mainSocketGroup: number;
  groups: Group[];
  sets: Array<{ index: number; title: string; active: boolean }>;
  options: { defaultGemLevel: string; defaultGemQuality?: number; showSupportGemTypes: string; showLegacyGems: boolean };
};

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);

/** A new level 90 Witch / Elementalist on tree 3_30 with no socket groups (Default Attack, TotalDPS 0.231). */
async function newWitch(): Promise<string> {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" }));
  return r.build.id;
}
const output = async (id: string, fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
const skills = async (id: string) => ok(await srv.call<Skills>("GET", `/v1/skills/${id}/get`));
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const post = <T = Record<string, unknown>>(id: string, action: string, body: Record<string, unknown>) => srv.call<Mutated<T>>("POST", `/v1/skills/${id}/${action}`, body);
const fireball = { gems: [{ name: "Fireball" }, { name: "Fire Penetration" }] };
const frost = { text: "Label: Ice\nFreezing Pulse 20/0  1" };

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("add_group by gems and by copy text, set_main, group_text round trip", async () => {
  const id = await newWitch();
  assert.deepEqual(await output(id, "TotalDPS,FullDPS"), { TotalDPS: 0.231, FullDPS: 0 });

  const a = ok(await post(id, "add-group", { ...fireball, baseRevision: 1 }));
  assert.deepEqual([a.revision, a.result, a.changed.TotalDPS, a.changed.AverageHit], [2, { group: 1 }, { before: 0.231, after: 2702.392 }, { before: null, after: 2026.794 }]);
  let s = await skills(id);
  assert.deepEqual([s.mainSocketGroup, s.groups.length], [1, 1]);
  const g = s.groups[0];
  assert.deepEqual(
    [g?.label, g?.activeSkills, g?.main, g?.enabled, g?.gems.map((x) => [x.name, x.support, x.level, x.quality, x.count])],
    ["Fireball", ["Fireball"], true, true, [["Fireball", false, 20, 0, 1], ["Fire Penetration", true, 20, 0, 1]]],
  );
  assert.equal(ok(await srv.call<{ text: string }>("GET", `/v1/skills/${id}/group-text?group=1`)).text, "Fireball 20/0  1\nFire Penetration 20/0  1\n");

  // Copy text: label, a disabled gem and a count; group_text gives back what add_group got.
  const text = "Label: Ice\nFrostbolt 20/0  1\nSpell Echo 20/0 DISABLED 1\n";
  assert.deepEqual(ok(await post(id, "add-group", { text })).result, { group: 2 });
  assert.equal(ok(await srv.call<{ text: string }>("GET", `/v1/skills/${id}/group-text?group=2`)).text, text);
  const by = ok(await post(id, "add-group", { gems: [{ name: "Freezing Pulse", level: 15, quality: 10 }, { name: "Spell Echo", enabled: false, count: 2 }], label: "Pulse" }));
  assert.equal(by.result.group, 3);
  assert.equal(ok(await srv.call<{ text: string }>("GET", `/v1/skills/${id}/group-text?group=3`)).text, "Label: Pulse\nFreezing Pulse 15/10  1\nSpell Echo 20/0 DISABLED 2\n");

  // The first group is main until set_main moves it; the pulse group's numbers then drive the output.
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 2702.392);
  const frostId = ok(await post(id, "add-group", frost)).result.group;
  const m = ok(await post<{ mainSocketGroup: number; mainSkill: string }>(id, "set-main", { group: frostId }));
  assert.deepEqual([m.result, m.changed.TotalDPS], [{ mainSocketGroup: 4, mainSkill: "Freezing Pulse" }, { before: 2702.392, after: 1108.9278846154 }]);
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 1108.9278846154);
  s = await skills(id);
  assert.deepEqual([s.mainSocketGroup, s.groups.map((x) => x.main)], [4, [false, false, false, true]]);
  fails(await post(id, "set-main", { group: 4, skill: 2 }), 404, "not_found");
  fails(await post(id, "set-main", { group: 9 }), 404, "not_found");
  fails(await post(id, "add-group", { gems: [{ name: "Fireball" }, { name: "No Such Gem" }] }), 400, "invalid_input");
  fails(await post(id, "add-group", {}), 400, "invalid_input");
  fails(await srv.call("GET", `/v1/skills/${id}/group-text?group=9`), 404, "not_found");
});

void test("the fixture's own socket group: get, group_text, set_main, delete_group", async () => {
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).build.id;
  const s = await skills(id);
  assert.deepEqual(s.groups.map((g) => [g.label, g.slot, g.main, g.gems.map((x) => [x.name, x.level, x.quality])]), [["Main", "Body Armour", true, [["Fireball", 20, 20], ["Spell Echo", 20, 0], ["Added Lightning Damage", 20, 0]]]]);
  assert.deepEqual(s.sets, [{ index: 1, title: "Default", active: true }]);
  assert.equal(ok(await srv.call<{ text: string }>("GET", `/v1/skills/${id}/group-text?group=1`)).text, "Label: Main\nSlot: Body Armour\nFireball 20/20  1\nSpell Echo 20/0  1\nAdded Lightning Damage 20/0  1\n");
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 5833.6405833333);
  assert.deepEqual(ok(await post(id, "set-main", { group: 1, skill: 1 })).result, { mainSocketGroup: 1, mainSkill: "Fireball" });
  const d = ok(await post(id, "delete-group", { group: 1 }));
  assert.deepEqual([d.result, d.changed.TotalDPS], [{ groups: 0 }, { before: 5833.6405833333, after: 0.231 }]);
});

void test("set_gem: level, quality, enabled, a gem past the end; unknown names change nothing", async () => {
  const id = await newWitch();
  ok(await post(id, "add-group", fireball));
  const q = ok(await post(id, "set-gem", { group: 1, gem: 2, quality: 20 }));
  assert.deepEqual([q.result, q.changed.AverageHit, q.changed.TotalDPS], [{ group: 1, gem: 2, name: "Fire Penetration", level: 20, quality: 20 }, { before: 2026.794, after: 2229.5595 }, { before: 2702.392, after: 2972.746 }]);
  const fq = ok(await post(id, "set-gem", { group: 1, gem: 1, quality: 20 }));
  assert.deepEqual(fq.changed, { AreaOfEffectRadiusMetres: { before: 1.8, after: 2.1 } }, "Fireball quality widens the area, not the damage");
  const l = ok(await post(id, "set-gem", { group: 1, gem: 2, level: 10 }));
  assert.deepEqual([l.changed.AverageHit, l.changed.TotalDPS], [{ before: 2229.5595, after: 2017.2205 }, { before: 2972.746, after: 2689.6273333333 }]);
  const off = ok(await post(id, "set-gem", { group: 1, gem: 2, enabled: false }));
  assert.deepEqual([off.changed.TotalDPS, off.changed.ManaCost], [{ before: 2689.6273333333, after: 1608.5666666667 }, { before: 26, after: 20 }]);
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 1608.5666666667);
  const on = ok(await post(id, "set-gem", { group: 1, gem: 2, enabled: true }));
  assert.deepEqual(on.changed.TotalDPS, { before: 1608.5666666667, after: 2689.6273333333 });

  const add = ok(await post(id, "set-gem", { group: 1, gem: 3, name: "Spell Echo" }));
  assert.deepEqual([add.result, add.changed.Speed, add.changed.TotalDPS], [{ group: 1, gem: 3, name: "Spell Echo", level: 20, quality: 0 }, { before: 1.3333333333333, after: 2.0533333333333 }, { before: 2689.6273333333, after: 4142.0260933333 }]);
  assert.deepEqual((await skills(id)).groups[0]?.gems.map((x) => [x.name, x.level, x.quality, x.enabled]), [["Fireball", 20, 20, true], ["Fire Penetration", 10, 20, true], ["Spell Echo", 20, 0, true]]);

  const rev = await revisionOf(id);
  fails(await post(id, "set-gem", { group: 1, gem: 4, name: "No Such Gem" }), 400, "invalid_input");
  fails(await post(id, "set-gem", { group: 1, gem: 2, name: "No Such Gem" }), 400, "invalid_input");
  fails(await post(id, "set-gem", { group: 1, gem: 4 }), 400, "invalid_input"); // a new gem needs a name
  fails(await post(id, "set-gem", { group: 1, gem: 6, name: "Spell Echo" }), 404, "not_found");
  fails(await post(id, "set-gem", { group: 1, gem: 1, level: 41 }), 400, "invalid_input");
  fails(await post(id, "set-gem", { group: 1, gem: 1, quality: 24 }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
  assert.equal((await skills(id)).groups[0]?.gems[1]?.name, "Fire Penetration", "the failed rename left the gem alone");

  // A legacy gem the gem box hides is named with the option that lists it, then taken once the option is on.
  const hidden = await post(id, "set-gem", { group: 1, gem: 4, name: "Awakened Spell Echo" });
  assert.deepEqual([hidden.status, hidden.body.error?.message], [400, "Awakened Spell Echo is a legacy gem the gem box hides with this build's options (Show legacy gems, Show support gems): skills.set_options showLegacyGems true and showSupportGemTypes ALL list it"]);
  ok(await post(id, "set-options", { showLegacyGems: true }));
  assert.equal(ok(await post(id, "set-gem", { group: 1, gem: 4, name: "Awakened Spell Echo Support" })).result.name, "Awakened Spell Echo");
});

void test("update_group, move_group, delete_gem, delete_group", async () => {
  const id = await newWitch();
  ok(await post(id, "add-group", fireball));
  ok(await post(id, "add-group", frost));

  const p = ok(await post(id, "update-group", { group: 2, label: "Frost", includeInFullDPS: true }));
  assert.deepEqual(p.changed.FullDPS, { before: 0, after: 1108.9278846154 }); // FullDPS is always diffed, 0 while the sidebar hides it
  assert.deepEqual((await skills(id)).groups.map((g) => [g.label, g.includeInFullDPS, g.enabled]), [["Fireball", false, true], ["Frost", true, true]]);
  const both = ok(await post(id, "update-group", { group: 1, includeInFullDPS: true }));
  assert.deepEqual(both.changed.FullDPS, { before: 1108.9278846154, after: 5051.349728746 });
  assert.equal((await output(id, "FullDPS")).FullDPS, 5051.349728746);
  const off = ok(await post(id, "update-group", { group: 2, enabled: false }));
  assert.deepEqual(off.changed.FullDPS, { before: 5051.349728746, after: 3942.4218441306 });
  assert.equal((await skills(id)).groups[1]?.enabled, false);
  fails(await post(id, "update-group", { group: 1, slot: "No Such Slot" }), 400, "invalid_input");
  fails(await post(id, "update-group", { group: 1, count: 2 }), 400, "invalid_input"); // count is for groups an item grants
  fails(await post(id, "update-group", { group: 7, label: "x" }), 404, "not_found");

  // The main skill stays the same group when its position changes.
  ok(await post(id, "set-main", { group: 2 }));
  const mv = ok(await post(id, "move-group", { group: 2, to: 1 }));
  assert.deepEqual([mv.result, mv.changed], [{ group: 1 }, {}]);
  const s = await skills(id);
  assert.deepEqual([s.mainSocketGroup, s.groups.map((g) => [g.label, g.main])], [1, [["Frost", true], ["Fireball", false]]]);
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 1108.9278846154);
  fails(await post(id, "move-group", { group: 1, to: 5 }), 404, "not_found");

  const dg = ok(await post(id, "delete-gem", { group: 2, gem: 2 }));
  assert.deepEqual(dg.result, { gems: 1 });
  assert.deepEqual((await skills(id)).groups[1]?.gems.map((x) => x.name), ["Fireball"]);
  fails(await post(id, "delete-gem", { group: 2, gem: 2 }), 404, "not_found");

  const dgp = ok(await post(id, "delete-group", { group: 1 }));
  assert.deepEqual([dgp.result, dgp.changed.TotalDPS], [{ groups: 1 }, { before: 1108.9278846154, after: 1608.5666666667 }]);
  const after = await skills(id);
  assert.deepEqual([after.mainSocketGroup, after.groups.map((g) => [g.label, g.main])], [1, [["Fireball", true]]]);
  fails(await post(id, "delete-group", { group: 2 }), 404, "not_found");
});

void test("skill sets: new, copy, rename, activate, delete; the last set stays", async () => {
  const id = await newWitch();
  ok(await post(id, "add-group", fireball));
  const titles = async () => (await skills(id)).sets.map((x) => [x.title, x.active]);
  ok(await post(id, "set-new", { title: "Empty" }));
  assert.deepEqual(await titles(), [["Default", true], ["Empty", false]]);
  const to = ok(await post(id, "set-activate", { index: 2 }));
  assert.deepEqual([to.changed.TotalDPS, to.changed.AverageHit], [{ before: 2702.392, after: 0.231 }, { before: 2026.794, after: null }]);
  assert.deepEqual([await output(id, "TotalDPS"), (await skills(id)).groups.length], [{ TotalDPS: 0.231 }, 0]);
  ok(await post(id, "add-group", frost));
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 1108.9278846154);
  const back = ok(await post(id, "set-activate", { index: 1 }));
  assert.deepEqual(back.changed.TotalDPS, { before: 1108.9278846154, after: 2702.392 });
  assert.deepEqual((await skills(id)).groups.map((g) => g.label), ["Fireball"]);

  ok(await post(id, "set-copy", { index: 1 }));
  ok(await post(id, "set-rename", { index: 3, title: "Third" }));
  ok(await post(id, "set-copy", { index: 2, title: "Frost copy" }));
  assert.deepEqual(await titles(), [["Default", true], ["Empty", false], ["Third", false], ["Frost copy", false]]);
  ok(await post(id, "set-activate", { index: 3 }));
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 2702.392, "the copy carries the groups");
  const d = ok(await post<{ sets: Array<{ title: string }> }>(id, "set-delete", { index: 4 }));
  assert.deepEqual(d.result.sets.map((x) => x.title), ["Default", "Empty", "Third"]);
  ok(await post(id, "set-delete", { index: 2 }));
  ok(await post(id, "set-delete", { index: 1 }));
  assert.deepEqual(await titles(), [["Third", true]]);
  fails(await post(id, "set-delete", { index: 1 }), 400, "invalid_input");
  fails(await post(id, "set-activate", { index: 2 }), 404, "not_found");
  fails(await post(id, "set-rename", { index: 1, title: "" }), 400, "invalid_input");
  assert.deepEqual(await titles(), [["Third", true]]);
});

void test("gems added without a level follow the Default gem level option (character level 25)", async () => {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", level: 25, treeVersion: "3_30" }));
  const id = r.build.id;
  ok(await post(id, "set-options", { defaultGemLevel: "characterLevel" }));
  // Game data: Fireball level 8 needs character level 24 (level 9: 28); Added Cold Damage 6 needs 25; Controlled Destruction 2 needs 22.
  ok(await post(id, "add-group", { gems: [{ name: "Fireball" }, { name: "Added Cold Damage" }, { name: "Spell Echo", level: 3 }] }));
  const added = ok(await post(id, "set-gem", { group: 1, gem: 4, name: "Controlled Destruction" }));
  assert.equal(added.result.level, 2);
  assert.deepEqual((await skills(id)).groups[0]?.gems.map((x) => [x.name, x.level]), [["Fireball", 8], ["Added Cold Damage", 6], ["Spell Echo", 3], ["Controlled Destruction", 2]]);
  // Copy text keeps its own levels.
  ok(await post(id, "add-group", { text: "Fireball 20/0  1" }));
  assert.equal((await skills(id)).groups[1]?.gems[0]?.level, 20);
});

void test("set_options changes the defaults get reports; imbued and socket tools need a socketed group", async () => {
  const id = await newWitch();
  ok(await post(id, "add-group", fireball));
  assert.deepEqual((await skills(id)).options, { defaultGemLevel: "normalMaximum", showSupportGemTypes: "ALL", showLegacyGems: false });
  const o = ok(await post(id, "set-options", { defaultGemLevel: "levelOne", defaultGemQuality: 20, showSupportGemTypes: "EXCEPTIONAL", showLegacyGems: true }));
  assert.deepEqual(o.result, { defaultGemLevel: "levelOne", defaultGemQuality: 20, showSupportGemTypes: "EXCEPTIONAL", showLegacyGems: true });
  assert.deepEqual((await skills(id)).options, o.result);
  ok(await post(id, "set-options", { showSupportGemTypes: "NORMAL" }));
  assert.deepEqual((await skills(id)).options, { ...o.result, showSupportGemTypes: "NORMAL" });
  fails(await post(id, "set-options", { defaultGemLevel: "bogus" }), 400, "invalid_input");
  fails(await post(id, "set-options", { defaultGemQuality: 24 }), 400, "invalid_input");

  const rev = await revisionOf(id);
  fails(await post(id, "set-imbued", { group: 1, name: "Spell Echo" }), 400, "invalid_input");
  fails(await post(id, "optimise-sockets", { group: 1 }), 400, "invalid_input");
  fails(await post(id, "set-imbued", { group: 4, name: "Spell Echo" }), 404, "not_found");
  assert.equal(await revisionOf(id), rev);
});

void test("a stale baseRevision is refused with 409 and changes nothing", async () => {
  const id = await newWitch();
  ok(await post(id, "add-group", fireball));
  fails(await post(id, "add-group", { ...frost, baseRevision: 1 }), 409, "stale_revision");
  fails(await post(id, "set-gem", { group: 1, gem: 2, level: 5, baseRevision: 1 }), 409, "stale_revision");
  fails(await post(id, "delete-group", { group: 1, baseRevision: 1 }), 409, "stale_revision");
  fails(await post(id, "set-new", { baseRevision: 1 }), 409, "stale_revision");
  assert.equal(await revisionOf(id), 2);
  const s = await skills(id);
  assert.deepEqual([s.groups.length, s.sets.length, s.groups[0]?.gems[1]?.level, (await output(id, "TotalDPS")).TotalDPS], [1, 1, 20, 2702.392]);
  assert.equal(ok(await post(id, "set-gem", { group: 1, gem: 2, level: 5, baseRevision: 2 })).revision, 3);
});

void test("MCP: pob_skills is listed and reads the socket groups", async () => {
  const id = await newWitch();
  ok(await post(id, "add-group", fireball));
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.find((t) => t.name === "pob_skills")?.annotations?.readOnlyHint, false);
    const r = await client.callTool({ name: "pob_skills", arguments: { action: "get", id } });
    assert.ok(!r.isError, JSON.stringify(r.content));
    const s = (r.structuredContent as { result: Skills }).result;
    assert.deepEqual(s.groups.map((g) => [g.label, g.gems.map((x) => x.name)]), [["Fireball", ["Fireball", "Fire Penetration"]]]);
    const m = await client.callTool({ name: "pob_skills", arguments: { action: "set_gem", id, group: 1, gem: 2, enabled: false } });
    assert.ok(!m.isError, JSON.stringify(m.content));
    assert.deepEqual((m.structuredContent as { result: Mutated }).result.changed.TotalDPS, { before: 2702.392, after: 1608.5666666667 });
    const bad = await client.callTool({ name: "pob_skills", arguments: { action: "set_gem", id, group: 0, gem: 1 } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
});

void test("add_group takes a gem line without the copy format's count", async () => {
  const id = await newWitch();
  assert.deepEqual(ok(await post(id, "add-group", { text: "Slot: Gloves\nEnfeeble 20/20" })).result, { group: 1 });
  assert.equal(ok(await srv.call<{ text: string }>("GET", `/v1/skills/${id}/group-text?group=1`)).text, "Slot: Gloves\nEnfeeble 20/20  1\n");
});
