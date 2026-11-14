// Worker tests for the main skill's sidebar choices (skill part, stages, active mines, minion, minion skill) and the spectre
// library, on tree 3_30, through HTTP. Each choice moves an exact output number.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startServer, type TestServer } from "./helpers.js";

type Change = Record<string, { before: number | null; after: number | null }>;
type Mutated<T = Record<string, unknown>> = { result: T; changed: Change; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Options = { part?: number; parts?: string[]; stages?: number; mines?: number; minion?: number; minions?: string[]; minionSkill?: number; minionSkills?: string[] };
type Skills = { mainSocketGroup: number; mainOptions: Options; spectres: Array<{ id: string; name: string }> };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);

/** A new level 90 Witch / Elementalist on tree 3_30 with one socket group per skill (the first is the main one). */
async function witch(...skills: string[]): Promise<string> {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" }));
  for (const name of skills) ok(await srv.call("POST", `/v1/skills/${r.build.id}/add-group`, { gems: [{ name }] }));
  return r.build.id;
}
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const options = async (id: string) => ok(await srv.call<Skills>("GET", `/v1/skills/${id}/get`)).mainOptions;
const setOptions = (id: string, body: Record<string, unknown>) => srv.call<Mutated<Options>>("POST", `/v1/skills/${id}/set-skill-options`, body);
const output = async (id: string, fields: string, actor = "player") => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?actor=${actor}&fields=${fields}`)).output;

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("skill part: by number and by label, each moves the damage and speed exactly", async () => {
  const id = await witch("Blade Vortex");
  assert.deepEqual(await options(id), { part: 1, parts: ["0 Blades", "5 Blades", "10 Blades"] });
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 76.78125);

  const rev = await revisionOf(id);
  const byLabel = ok(await setOptions(id, { part: "5 Blades", baseRevision: rev }));
  assert.equal(byLabel.revision, rev + 1);
  assert.deepEqual(byLabel.result, { part: 2, parts: ["0 Blades", "5 Blades", "10 Blades"] });
  assert.deepEqual([byLabel.changed.TotalDPS, byLabel.changed.HitSpeed, byLabel.changed.AverageHit], [{ before: 76.78125, after: 480.15625 }, { before: 1.6666666666667, after: 4.1666666666667 }, { before: 46.06875, after: 115.2375 }]);
  const byNumber = ok(await setOptions(id, { part: 3 }));
  assert.deepEqual([byNumber.revision, byNumber.changed.TotalDPS, byNumber.changed.HitSpeed], [rev + 2, { before: 480.15625, after: 1228.5 }, { before: 4.1666666666667, after: 6.6666666666667 }]);
  assert.equal((await options(id)).part, 3);
  assert.equal((await output(id, "TotalDPS")).TotalDPS, 1228.5);
  // The choice is saved with the build: a skill part attribute on the gem.
  assert.match(ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${id}/xml`)).xml, /skillPart="3"/);
});

void test("stages: a multi-stage skill's stage count moves its damage over time exactly", async () => {
  const id = await witch("Scorching Ray");
  assert.deepEqual(await options(id), { part: 1, parts: ["Manual Stages", "Maximum Stages"], stages: 8 });
  assert.equal((await output(id, "TotalDot")).TotalDot, 4524.465);
  const three = ok(await setOptions(id, { stages: 3 }));
  assert.deepEqual([three.result.stages, three.changed.TotalDot], [3, { before: 4524.465, after: 1188.2433333333 }]);
  const seven = ok(await setOptions(id, { stages: 7 }));
  assert.deepEqual([seven.result.stages, seven.changed.TotalDot], [7, { before: 1188.2433333333, after: 2650.6966666667 }]);
  assert.equal((await options(id)).stages, 7);
  // Part and stages in one call: the part goes first, so the stage box exists for what follows.
  const both = ok(await setOptions(id, { part: "Manual Stages", stages: 3 }));
  assert.deepEqual([both.result.stages, both.changed.TotalDot], [3, { before: 2650.6966666667, after: 1188.2433333333 }]);
});

void test("active mines: the mine count moves the reservation exactly", async () => {
  const id = await witch("Pyroclast Mine");
  assert.deepEqual(await options(id), { mines: 0 });
  assert.equal((await output(id, "ManaUnreserved")).ManaUnreserved, 584);
  const five = ok(await setOptions(id, { mines: 5 }));
  assert.deepEqual([five.result, five.changed.ManaUnreserved, five.changed.ManaUnreservedPercent], [{ mines: 5 }, { before: 584, after: 560 }, { before: 98.983050847458, after: 94.915254237288 }]);
  const three = ok(await setOptions(id, { mines: 3 }));
  assert.deepEqual(three.changed.ManaUnreserved, { before: 560, after: 572 });
  assert.equal((await options(id)).mines, 3);
  assert.match(ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${id}/xml`)).xml, /skillMineCount="3"/);
});

void test("minion, minion skill and the spectre library", async () => {
  const id = await witch("Raise Spectre");
  assert.deepEqual(await options(id), { minion: 1, minions: ["<No spectres in build>"] });
  const rev = await revisionOf(id);

  // Manage Spectres...: add three to the library; the first becomes the minion.
  const add = ok(await srv.call<Mutated<{ spectres: Array<{ name: string }> }>>("POST", `/v1/skills/${id}/set-spectres`, { add: ["Blackguard Mage", "Flesh Sculptor", "Foreman"], baseRevision: rev }));
  assert.equal(add.revision, rev + 1);
  assert.deepEqual(add.result.spectres.map((s) => s.name), ["Blackguard Mage", "Flesh Sculptor", "Foreman"]);
  assert.deepEqual([add.changed["Minion.Life"], add.changed["Minion.TotalDPS"], add.changed.ActiveMinionLimit], [{ before: null, after: 6243 }, { before: null, after: 63.486111111111 }, { before: null, after: 2 }]);
  assert.deepEqual(await options(id), { minion: 1, minions: ["Blackguard Mage", "Flesh Sculptor", "Foreman"], minionSkill: 1, minionSkills: ["Default Attack", "Lightning Thorns"] });
  assert.equal(ok(await srv.call<Skills>("GET", `/v1/skills/${id}/get`)).spectres.length, 3);
  assert.match(ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${id}/xml`)).xml, /<Spectre id="Metadata\/Monsters\/Axis\/AxisExperimenter2"\/>/);

  // The minion, by label: its own life, speed and skills.
  const fs = ok(await setOptions(id, { minion: "Flesh Sculptor" }));
  assert.deepEqual([fs.result.minion, fs.result.minionSkills], [2, ["Default Attack", "Enfeeble", "Projectile Weakness"]]);
  assert.deepEqual([fs.changed["Minion.Life"], fs.changed["Minion.Speed"], fs.changed["Minion.AverageDamage"]], [{ before: 6243, after: 6659 }, { before: 0.76628352490421, after: 0.50125313283208 }, { before: 82.849375, after: 125.733125 }]);
  assert.deepEqual(await output(id, "Life,Speed", "minion"), { Life: 6659, Speed: 0.50125313283208 });

  // The minion's skill, by number: Enfeeble has a cooldown and no damage.
  const enfeeble = ok(await setOptions(id, { minionSkill: 2 }));
  assert.deepEqual([enfeeble.result.minionSkill, enfeeble.changed["Minion.Cooldown"], enfeeble.changed["Minion.TotalDPS"]], [2, { before: null, after: 10.032 }, { before: 63.024122807018, after: null }]);
  assert.equal((await output(id, "Speed", "minion")).Speed, 0.099681020733652);

  // Remove one from the library: the choice falls back to the first minion that is left.
  const rm = ok(await srv.call<Mutated<{ spectres: Array<{ name: string }> }>>("POST", `/v1/skills/${id}/set-spectres`, { remove: ["Flesh Sculptor"] }));
  assert.deepEqual(rm.result.spectres.map((s) => s.name), ["Blackguard Mage", "Foreman"]);
  assert.deepEqual(rm.changed["Minion.Life"], { before: 6659, after: 6243 });
  assert.deepEqual((await options(id)).minions, ["Blackguard Mage", "Foreman"]);
});

void test("set_skill_options and set_spectres refusals answer 400 and keep the revision", async () => {
  const id = await witch("Blade Vortex", "Raise Spectre");
  const rev = await revisionOf(id);
  const refused = async (r: Reply<unknown>, text: RegExp) => {
    fails(r, 400, "invalid_input");
    assert.match(r.body.error?.message ?? "", text);
    assert.equal(await revisionOf(id), rev);
  };
  await refused(await setOptions(id, {}), /is required/);
  await refused(await setOptions(id, { stages: 3 }), /no stages choice/); // Blade Vortex has parts, not stages
  await refused(await setOptions(id, { mines: 3 }), /no active mines choice/);
  await refused(await setOptions(id, { minion: 1 }), /no minion choice/);
  await refused(await setOptions(id, { minionSkill: 1 }), /no minion skill choice/);
  await refused(await setOptions(id, { part: 9 }), /no part 9; choices: 0 Blades, 5 Blades, 10 Blades/);
  await refused(await setOptions(id, { part: "20 Blades" }), /no part 20 Blades/);
  fails(await setOptions(id, { stages: -1 }), 400, "invalid_input");
  fails(await setOptions(id, { part: 0 }), 400, "invalid_input");
  await refused(await srv.call("POST", `/v1/skills/${id}/set-spectres`, {}), /add or remove is required/);
  await refused(await srv.call("POST", `/v1/skills/${id}/set-spectres`, { add: ["Nonesuch"] }), /no spectre Nonesuch/);
  await refused(await srv.call("POST", `/v1/skills/${id}/set-spectres`, { remove: ["Blackguard Mage"] }), /no spectre Blackguard Mage/);
  // A refused call leaves the choices where they were.
  assert.deepEqual(await options(id), { part: 1, parts: ["0 Blades", "5 Blades", "10 Blades"] });
});
