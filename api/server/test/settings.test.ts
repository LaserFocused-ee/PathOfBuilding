// Worker tests for the Party tab inputs (import, clear, text boxes, effects) and the generic control driver (`ui_controls`,
// `ui_invoke`), on tree 3_30, through HTTP. Character name and target version are not settings of this Path of Building
// version (the build keeps only a hash of the last imported character's name, and a fixed target version), so build_settings
// is unchanged.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FIXTURES, startServer, type TestServer } from "./helpers.js";

type Change = Record<string, { before: number | null; after: number | null }>;
type Mutated<T = Record<string, unknown>> = { result: T; changed: Change; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Party = { destination: string; append: boolean; showAdvanced: boolean; exportSupport: boolean; auras: string; curses: string; warcries: string; links: string; partyMemberStats: string; enemyConditions: string; enemyMods: string; summary: Record<string, string> };
type UiControl = { name: string; type: string; label?: string; text?: string; state?: boolean; selected?: number; choices?: string[]; choiceCount?: number; shown: boolean; enabled: boolean; actions: string[] };
type UiList = { tab: string; total: number; offset: number; controls: UiControl[] };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const xmlOf = async (id: string) => ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${id}/xml`)).xml;

/** A new level 90 Witch / Elementalist on tree 3_30 with the given socket groups, each one active skill and its supports. */
async function witch(groups: Array<Array<{ name: string }>>): Promise<string> {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" }));
  for (const gems of groups) ok(await srv.call("POST", `/v1/skills/${r.build.id}/add-group`, { gems }));
  return r.build.id;
}
const party = (id: string, action: string, body: Record<string, unknown>) => srv.call<Mutated>("POST", `/v1/party/${id}/${action}`, body);
const partyGet = async (id: string) => ok(await srv.call<Party>("GET", `/v1/party/${id}/get`));
const invoke = (id: string, body: Record<string, unknown>) => srv.call<Mutated<{ tab: string; control: string; operation: string; text?: string; state?: boolean; selected?: number }>>("POST", `/v1/ui/${id}/invoke`, body);
const controls = async (id: string, tab: string, q = "") => ok(await srv.call<UiList>("GET", `/v1/ui/${id}/controls?tab=${tab}${q}`));

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

const haste = "Haste\n100\n24|Skill:Haste|Speed|INC|Cast|-|type=GlobalEffect/effectType=Aura\n24|Skill:Haste|Speed|INC|Attack|-|type=GlobalEffect/effectType=Aura\n16|Skill:Haste|MovementSpeed|INC|-|-|type=GlobalEffect/effectType=Aura\n---";

void test("party: import a member's code into a destination, clear it, edit the aura box, switch effects off and on", async () => {
  // The member: three auras/curses, with Export support switched on through the Import/Export tab's own checkbox.
  const member = await witch([[{ name: "Determination" }], [{ name: "Haste" }], [{ name: "Vulnerability" }]]);
  ok(await invoke(member, { tab: "import", control: "enablePartyExportBuffs", operation: "set_state", value: true }));
  const exported = ok(await srv.call<{ code: string }>("GET", `/v1/builds/${member}/code`)).code;

  const id = await witch([[{ name: "Fireball" }]]);
  const base = { TotalDPS: 1608.5666666667, Speed: 1.3333333333333 };
  const sidebar = async () => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=TotalDPS,Speed`)).output;
  assert.deepEqual(await sidebar(), base);
  assert.deepEqual(await partyGet(id), { destination: "All", append: false, showAdvanced: false, exportSupport: false, auras: "", curses: "", warcries: "", links: "", partyMemberStats: "", enemyConditions: "", enemyMods: "", summary: { auras: "", curses: "", enemyMods: "\n", links: "", warcries: "" } });

  // Import as Aura: the auras move Armour, cast speed and DPS by exact amounts; curses stay empty.
  const rev = await revisionOf(id);
  const imp = ok(await party(id, "import", { code: exported, destination: "Aura", baseRevision: rev }));
  assert.equal(imp.revision, rev + 1);
  assert.deepEqual([imp.changed.Armour, imp.changed.Speed, imp.changed.TotalDPS, imp.changed.PhysicalMaximumHitTaken], [{ before: null, after: 1529 }, { before: 1.3333333333333, after: 1.6533333333333 }, { before: 1608.5666666667, after: 1994.6226666667 }, { before: 1125, after: 1375 }]);
  let p = await partyGet(id);
  assert.deepEqual([p.destination, p.summary.auras, p.curses, p.auras.startsWith("Determination\n100\n") && p.auras.includes("|Armour|MORE|")], ["Aura", "---------------------------\nDetermination: 100%\nHaste: 100%\n---------------------------\n", "", true]);
  // It is saved with the build.
  assert.match(await xmlOf(id), /<ImportedBuffs name="Aura">\s*Determination\n100\n/);

  // A curse import does not move the player's stats; the curse box and its summary fill in.
  assert.deepEqual(ok(await party(id, "import", { code: exported, destination: "Curse" })).changed, {});
  p = await partyGet(id);
  assert.deepEqual([p.curses.startsWith("--- Curse Limit ---\n1\nVulnerability\n100\nfalse"), p.summary.curses], [true, "---------------------------\nVulnerability: 100%\n---------------------------\n"]);

  // Effects off keeps the data and drops the numbers; Rebuild All brings them back.
  const off = ok(await party(id, "effects", { enabled: false }));
  assert.deepEqual([off.changed.Armour, off.changed.TotalDPS], [{ before: 1529, after: null }, { before: 1994.6226666667, after: 1608.5666666667 }]);
  assert.deepEqual(await sidebar(), base);
  assert.match((await partyGet(id)).auras, /^Determination\n100/);
  assert.deepEqual(ok(await party(id, "effects", { enabled: true })).changed.TotalDPS, { before: 1608.5666666667, after: 1994.6226666667 });

  // Clear Aura: the box empties and the numbers go; the curse box is left alone.
  const cleared = ok(await party(id, "clear", { destination: "Aura" }));
  assert.deepEqual([cleared.changed.Armour, cleared.changed.TotalDPS], [{ before: 1529, after: null }, { before: 1994.6226666667, after: 1608.5666666667 }]);
  p = await partyGet(id);
  assert.deepEqual([p.auras, p.curses.startsWith("--- Curse Limit"), (await sidebar()).TotalDPS], ["", true, 1608.5666666667]);

  // Editing the aura box (as in the advanced view): Haste alone gives 24% more cast speed, no armour.
  const typed = ok(await party(id, "set", { auras: haste, showAdvanced: true }));
  assert.deepEqual([typed.changed.Speed, typed.changed.TotalDPS, typed.changed.Armour], [{ before: 1.3333333333333, after: 1.6533333333333 }, { before: 1608.5666666667, after: 1994.6226666667 }, undefined]);
  p = await partyGet(id);
  assert.deepEqual([p.auras, p.showAdvanced, p.summary.auras], [haste, true, "---------------------------\nHaste: 100%\n---------------------------\n"]);
  // Append keeps the Haste box and adds the member's auras (the boxes are not replaced).
  ok(await party(id, "import", { code: exported, destination: "Aura", append: true }));
  p = await partyGet(id);
  assert.deepEqual([p.append, p.auras.startsWith("Haste\n100\n24|") && p.auras.includes("\nDetermination\n100\n")], [true, true]);
  // Clear All empties every box and the numbers go.
  assert.deepEqual(ok(await party(id, "clear", { destination: "All" })).changed.TotalDPS, { before: 1994.6226666667, after: 1608.5666666667 });
  assert.deepEqual([(await partyGet(id)).curses, (await sidebar()).TotalDPS], ["", 1608.5666666667]);
});

void test("party: refusals answer 400 and leave the revision alone", async () => {
  const id = await witch([[{ name: "Fireball" }]]);
  const plain = ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code; // a build code without exported support data
  const rev = await revisionOf(id);
  fails(await party(id, "import", { code: "not a code" }), 400, "invalid_input");
  fails(await party(id, "import", { code: "https://pobb.in/abcdef" }), 400, "invalid_input");
  const noSupport = await party(id, "import", { code: plain });
  fails(noSupport, 400, "invalid_input");
  assert.match(noSupport.body.error?.message ?? "", /no exported support data/);
  fails(await party(id, "import", { code: plain, destination: "Everything" }), 400, "invalid_input");
  fails(await party(id, "clear", { destination: "Everything" }), 400, "invalid_input");
  fails(await party(id, "set", {}), 400, "invalid_input");
  fails(await party(id, "set", { auras: 5 }), 400, "invalid_input");
  fails(await party(id, "effects", {}), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
  assert.equal((await partyGet(id)).auras, "");
});

void test("ui_controls lists a tab's real controls, with types, choices and what each takes", async () => {
  const id = await witch([[{ name: "Fireball" }], [{ name: "Freezing Pulse" }]]);
  const build = await controls(id, "build", "&limit=200");
  assert.ok(build.total >= 30 && build.controls.length === build.total, `${build.total} build controls`);
  const by = (l: UiList, name: string) => l.controls.find((c) => c.name === name);
  assert.deepEqual(by(build, "mainSocketGroup"), { name: "mainSocketGroup", type: "DropDownControl", selected: 1, choices: ["Fireball", "Freezing Pulse"], choiceCount: 2, shown: true, enabled: true, actions: ["select"] });
  assert.deepEqual(by(build, "characterLevel"), { name: "characterLevel", type: "EditControl", text: "90", shown: true, enabled: true, actions: ["set_text"] });
  assert.deepEqual(by(build, "mainSkill")?.actions, []); // one active skill in the group: the dropdown is disabled
  assert.deepEqual(by(build, "mainSkillStageCount")?.shown, false);
  assert.deepEqual([by(build, "save")?.type, by(build, "save")?.label, by(build, "save")?.actions], ["ButtonControl", "Save", []]); // deny-listed: no actions
  // Paging: names sort, pages do not overlap, the total holds.
  const first = await controls(id, "build", "&limit=5");
  const next = await controls(id, "build", "&limit=5&offset=5");
  assert.deepEqual([first.controls.length, next.controls.length, first.total, next.offset], [5, 5, build.total, 5]);
  assert.deepEqual([...first.controls, ...next.controls].map((c) => c.name), build.controls.slice(0, 10).map((c) => c.name));
  // The Configuration tab names each option's control by its variable.
  const config = await controls(id, "config", "&limit=200&offset=0");
  assert.ok(config.total > 400);
  for (const tab of ["tree", "skills", "items", "calcs", "notes", "party", "import"]) assert.ok((await controls(id, tab)).total > 0, tab);
  assert.equal((await srv.call("GET", `/v1/ui/${id}/controls?tab=nowhere`)).status, 400);
  assert.equal((await srv.call("GET", `/v1/ui/${id}/controls`)).status, 400);
});

void test("ui_invoke: select, set_state, set_text and click on config, build and skills controls move exact stats and the revision", async () => {
  const id = await witch([[{ name: "Fireball" }], [{ name: "Freezing Pulse" }]]);
  const out = async (fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
  let rev = await revisionOf(id);

  // select by number and by label (build tab, main socket group)
  const sel = ok(await invoke(id, { tab: "build", control: "mainSocketGroup", operation: "select", value: 2, baseRevision: rev }));
  assert.equal(sel.revision, ++rev);
  assert.deepEqual([sel.result, sel.changed.TotalDPS], [{ tab: "build", control: "mainSocketGroup", operation: "select", selected: 2 }, { before: 1608.5666666667, after: 1108.9278846154 }]);
  const back = ok(await invoke(id, { tab: "build", control: "mainSocketGroup", operation: "select", value: "Fireball" }));
  assert.deepEqual([back.revision, back.result.selected, back.changed.TotalDPS], [++rev, 1, { before: 1108.9278846154, after: 1608.5666666667 }]);

  // set_state on a config option's own checkbox
  const on = ok(await invoke(id, { tab: "config", control: "buffOnslaught", operation: "set_state", value: true }));
  assert.equal(on.revision, rev + 1);
  assert.deepEqual([on.result.state, on.changed.Speed, on.changed.TotalDPS], [true, { before: 1.3333333333333, after: 1.6 }, { before: 1608.5666666667, after: 1930.28 }]);
  assert.equal((await out("Speed")).Speed, 1.6);
  assert.deepEqual(ok(await srv.call<{ values: Record<string, unknown> }>("GET", `/v1/config/${id}/get`)).values.buffOnslaught, true);
  ok(await invoke(id, { tab: "config", control: "buffOnslaught", operation: "set_state", value: false }));

  // The Skills tab: the display group's Full DPS box (a group is displayed by the group list; update_group picks one)
  ok(await srv.call("POST", `/v1/skills/${id}/update-group`, { group: 1, label: "Fireball" }));
  rev = await revisionOf(id);
  const full = ok(await invoke(id, { tab: "skills", control: "includeInFullDPS", operation: "set_state", value: true }));
  assert.deepEqual([full.revision, full.changed.FullDPS], [++rev, { before: null, after: 2848.5965107973 }]);

  // set_text and click on the build tab: the level box, then the Auto/Manual button
  const lvl = ok(await invoke(id, { tab: "build", control: "characterLevel", operation: "set_text", value: "80" }));
  assert.equal(lvl.revision, ++rev);
  assert.deepEqual([lvl.result.text, lvl.changed.Life], ["80", { before: 1125, after: 1005 }]);
  const auto = ok(await invoke(id, { tab: "build", control: "levelScalingButton", operation: "click" }));
  assert.deepEqual([auto.revision, auto.changed.Life], [++rev, { before: 1005, after: 57 }]);
  assert.equal(ok(await srv.call<{ level: number; autoLevel: boolean }>("GET", `/v1/config/${id}/get`)).autoLevel, true);

  assert.equal(await revisionOf(id), rev);
});

void test("ui_invoke refuses unknown, denied, hidden, disabled and wrong-type controls with 400 and keeps the revision", async () => {
  const id = await witch([[{ name: "Fireball" }]]);
  const rev = await revisionOf(id);
  const refused = async (body: Record<string, unknown>, text: RegExp) => {
    const r = await invoke(id, body);
    fails(r, 400, "invalid_input");
    assert.match(r.body.error?.message ?? "", text, JSON.stringify(body));
    assert.equal(await revisionOf(id), rev, JSON.stringify(body));
  };
  await refused({ tab: "build", control: "noSuchControl", operation: "click" }, /no control noSuchControl on the build tab/);
  // The deny list: file dialogs, the network, leaving the build.
  await refused({ tab: "build", control: "save", operation: "click" }, /saves to a file/);
  await refused({ tab: "build", control: "saveAs", operation: "click" }, /saves to a file/);
  await refused({ tab: "build", control: "back", operation: "click" }, /leaves the build/);
  await refused({ tab: "import", control: "generateCodeByLink", operation: "click" }, /uploads/);
  await refused({ tab: "import", control: "siteAccountNameGo", operation: "click" }, /game site/);
  await refused({ tab: "import", control: "authenticateButton", operation: "click" }, /signs in/);
  await refused({ tab: "party", control: "importCodeGo", operation: "click" }, /link/);
  await refused({ tab: "items", control: "priceDisplayItem", operation: "click" }, /trade site/);
  // Hidden, disabled, wrong type, bad value.
  await refused({ tab: "build", control: "mainSkillStageCount", operation: "set_text", value: "3" }, /not shown/);
  await refused({ tab: "build", control: "mainSkill", operation: "select", value: 1 }, /disabled/);
  await refused({ tab: "config", control: "setSelect", operation: "select", value: 1 }, /disabled/);
  await refused({ tab: "build", control: "mainSocketGroup", operation: "click" }, /DropDownControl; it takes select, not click/);
  await refused({ tab: "build", control: "characterLevel", operation: "select", value: 1 }, /EditControl; it takes set_text/);
  await refused({ tab: "build", control: "buildName", operation: "click" }, /no action/);
  await refused({ tab: "build", control: "modeTree", operation: "set_text", value: "x" }, /ButtonControl; it takes click/);
  await refused({ tab: "config", control: "buffOnslaught", operation: "set_state", value: "yes" }, /true or false/);
  await refused({ tab: "build", control: "characterLevel", operation: "set_text" }, /text value/);
  await refused({ tab: "build", control: "mainSocketGroup", operation: "select", value: 9 }, /no choice 9.*Fireball/);
  await refused({ tab: "build", control: "mainSocketGroup", operation: "select", value: "Nothing" }, /no choice Nothing/);
  await refused({ tab: "build", control: "mainSocketGroup", operation: "select" }, /choice number or label/);
  // Schema-level refusals never reach the worker.
  fails(await invoke(id, { tab: "nowhere", control: "x", operation: "click" }), 400, "invalid_input");
  fails(await invoke(id, { tab: "build", control: "save", operation: "double_click" }), 400, "invalid_input");
  assert.equal(await revisionOf(id), rev);
});

void test("stats.warnings: an unmet gem requirement is reported, and clears when the gem goes", async () => {
  const id = await witch([[{ name: "Heavy Strike" }]]);
  const warnings = async () => ok(await srv.call<{ warnings: string[] }>("GET", `/v1/stats/${id}/warnings`)).warnings;
  assert.deepEqual(await warnings(), ["You do not meet the Strength requirement of Heavy Strike"]);
  ok(await srv.call("POST", `/v1/skills/${id}/delete-group`, { group: 1 }));
  assert.deepEqual(await warnings(), []);
});

void test("lookup.config relevantOnly keeps only the options that apply to the build", async () => {
  type Page = { total: number; options: Array<{ var: string; relevant?: boolean }> };
  const id = await witch([[{ name: "Fireball" }]]);
  const pages = async (q: string) => {
    const first = ok(await srv.call<Page>("GET", `/v1/lookup/config?buildId=${id}&limit=200${q}`));
    const options = [...first.options];
    while (options.length < first.total) options.push(...ok(await srv.call<Page>("GET", `/v1/lookup/config?buildId=${id}&limit=200&offset=${options.length}${q}`)).options);
    return { total: first.total, options };
  };
  const all = await pages("");
  const rel = await pages("&relevantOnly=true");
  assert.deepEqual([all.total, rel.total], [588, 81]); // 588 with the two options lf-src-fixes adds (Missing unreserved Life %, Consumed 8 Steel Shards Recently)
  // The filter keeps exactly the options the full list marks relevant, in the same order.
  assert.deepEqual(rel.options.map((o) => o.var), all.options.filter((o) => o.relevant === true).map((o) => o.var));
});

void test("ui_invoke: every action every control offers, on every tab, reaches no sub-script, link or file outside the state dir", async () => {
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).build.id;
  const pool = srv.runtime.svc.pool;
  const reach = async () => (await pool.run<{ subScripts: number; urls: number; writes: string[] }>(id, "worker.reach")).result;
  await reach(); // from zero
  let invoked = 0;
  for (const tab of ["build", "tree", "skills", "items", "calcs", "config", "notes", "party", "import"]) {
    const list = (await pool.run<UiList>(id, "ui.controls", { tab, limit: 5000 })).result.controls;
    for (const c of list) {
      for (const operation of c.actions) {
        const value = operation === "set_state" ? !c.state : operation === "select" ? Math.min(2, c.choiceCount ?? 1) : operation === "set_text" ? "1" : undefined;
        invoked++;
        await pool.run(id, "ui.invoke", { tab, control: c.name, operation, ...(value === undefined ? {} : { value }) }).catch(() => undefined); // a refusal is fine here
        assert.deepEqual(await reach(), { subScripts: 0, urls: 0, writes: [] }, `${tab}.${c.name} ${operation}`);
      }
    }
  }
  assert.ok(invoked > 150, `${invoked} actions offered`);
  // the one control that reached a seam before it was denied: the timeless jewel finder asks the trade site for its leagues
  const finder = await invoke(id, { tab: "tree", control: "findTimelessJewel", operation: "click" });
  fails(finder, 400, "invalid_input");
  assert.match(finder.body.error?.message ?? "", /asks the trade site for its leagues/);
});

void test("config custom_mods: groups add their supported lines to the calculation while enabled; unsupported lines are marked", async () => {
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).build.id;
  type Groups = { configSet: number; groups: Array<{ title: string; enabled: boolean; text: string; lines: Array<{ text: string; supported: boolean }> }> };
  const life = async () => ok(await srv.call<{ output: { Life: number } }>("GET", `/v1/stats/${id}/output?fields=Life`)).output.Life;
  const base = await life();
  assert.deepEqual(ok(await srv.call<Groups>("GET", `/v1/config/${id}/custom-mods`)), { configSet: 1, groups: [{ title: "Default", enabled: true, text: "", lines: [] }] });
  const rev = await revisionOf(id);
  const set = ok(await srv.call<Mutated<Groups>>("POST", `/v1/config/${id}/set-custom-mods`, { groups: [{ title: "Flat", text: "+100 to maximum Life\nthis line means nothing" }, { title: "Off", enabled: false, text: "+1000 to maximum Life" }] }));
  assert.deepEqual(set.result.groups, [
    { title: "Flat", enabled: true, text: "+100 to maximum Life\nthis line means nothing", lines: [{ text: "+100 to maximum Life", supported: true }, { text: "this line means nothing", supported: false }] },
    { title: "Off", enabled: false, text: "+1000 to maximum Life", lines: [{ text: "+1000 to maximum Life", supported: true }] },
  ]);
  assert.equal(set.revision, rev + 1);
  const withMods = await life();
  assert.deepEqual([base, withMods, set.changed.Life], [1328, 1446, { before: 1328, after: 1446 }], "+100 flat, then the build's increased life applies");
  ok(await srv.call("POST", `/v1/config/${id}/set-custom-mods`, { groups: [{ text: "" }] }));
  assert.equal(await life(), base, "cleared");
  const r = await srv.call("POST", `/v1/config/${id}/set-custom-mods`, { groups: [] });
  fails(r, 400, "invalid_input");
});
