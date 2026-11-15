// lookup.mods_for_base, skills.support_compatible, lookup.parse_mod, lookup.describe_stats: what Path of Building computes, pinned from a real run.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { routes } from "../src/routes.js";
import { startServer, type TestServer } from "./helpers.js";

type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);
const declared = (name: string) => {
  const r = routes.find((x) => x.name === name);
  assert.ok(r, name);
  return r;
};

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

type Mods = { base: string; ilvl: number; total: number; offset: number; mods: Array<Record<string, unknown>> };
const mods = async (query: string) => ok(await srv.call<Mods>("GET", `/v1/lookup/mods-for-base?base=Vaal%20Regalia${query}`));

void test("mods_for_base: the prefixes Vaal Regalia rolls at item level 86, paged, narrowed, by influence", async () => {
  const at86 = await mods("&ilvl=86&type=Prefix&limit=3");
  assert.deepEqual(
    { total: at86.total, offset: at86.offset, ilvl: at86.ilvl, mods: at86.mods },
    {
      total: 62,
      offset: 0,
      ilvl: 86,
      mods: [
        { affix: "Thorny", group: "AttackerTakesDamageNoRange", id: "AttackerTakesDamage1", level: 1, lines: ["Reflects (1-4) Physical Damage to Melee Attackers"], name: "Reflects (1-4) Physical Damage to Melee Attackers", type: "Prefix", weight: 1000 },
        { affix: "Spiny", group: "AttackerTakesDamageNoRange", id: "AttackerTakesDamage2", level: 10, lines: ["Reflects (5-10) Physical Damage to Melee Attackers"], name: "Reflects (5-10) Physical Damage to Melee Attackers", type: "Prefix", weight: 1000 },
        { affix: "Barbed", group: "AttackerTakesDamageNoRange", id: "AttackerTakesDamage3", level: 20, lines: ["Reflects (11-24) Physical Damage to Melee Attackers"], name: "Reflects (11-24) Physical Damage to Melee Attackers", type: "Prefix", weight: 1000 },
      ],
    },
  );
  assert.ok(declared("lookup.mods_for_base").output.safeParse(at86).success);

  const at1 = await mods("&ilvl=1&type=Prefix&limit=1");
  assert.deepEqual([at1.total, at1.mods.map((m) => m.id)], [3, ["AttackerTakesDamage1"]]);

  // The mod text narrows: the life prefixes, then the energy shield and life ones; the last has a lower weight.
  const life = await mods("&ilvl=86&type=Prefix&query=maximum%20Life&limit=200");
  assert.equal(life.total, 17);
  assert.deepEqual(life.mods.map((m) => m.id).filter((id, i) => i === 0 || i >= 13), ["IncreasedLife0", "LocalBaseEnergyShieldAndLife1", "LocalBaseEnergyShieldAndLife2", "LocalBaseEnergyShieldAndLife3_", "LocalBaseEnergyShieldAndLife4_"]);
  assert.deepEqual(life.mods.at(-1), { affix: "Exarch's", group: "LocalBaseEnergyShieldAndLife", id: "LocalBaseEnergyShieldAndLife4_", level: 78, lines: ["+(26-30) to maximum Energy Shield", "+(34-38) to maximum Life"], name: "+(26-30) to maximum Energy Shield/+(34-38) to maximum Life", type: "Prefix", weight: 500 });

  // Paging walks the same order, and an influence the base can take adds mods.
  const second = await mods("&ilvl=86&type=Prefix&limit=1&offset=1");
  assert.deepEqual([second.offset, second.mods.map((m) => m.id)], [1, ["AttackerTakesDamage2"]]);
  assert.equal((await mods("&ilvl=86&type=Prefix&influence=Shaper")).total, 73);
  fails(await srv.call("GET", "/v1/lookup/mods-for-base?base=Vaal%20Regalia&influence=Nope"), 400, "invalid_input");
});

void test("mods_for_base: an unknown base is 404", async () => {
  fails(await srv.call("GET", "/v1/lookup/mods-for-base?base=Nope"), 404, "not_found");
});

type Supports = { group: number; skill: string; total: number; offset: number; gems: Array<{ name: string; id: string; tags: string[] }> };
const buildWith = async (className: string, ascendancy: string | undefined, gem: string): Promise<string> => {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: className, ...(ascendancy ? { ascendancy } : {}), level: 90, treeVersion: "3_30" }));
  ok(await srv.call("POST", `/v1/skills/${r.build.id}/add-group`, { gems: [{ name: gem }] }));
  return r.build.id;
};
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const supports = async (id: string, query: string) => ok(await srv.call<Supports>("GET", `/v1/skills/${id}/support-compatible?${query}`));

void test("support_compatible: Fireball takes spell supports, Cyclone attack supports; nothing is stored", async () => {
  const fire = await buildWith("Witch", "Elementalist", "Fireball");
  const rev = await revisionOf(fire);
  const all = await supports(fire, "group=1&limit=3");
  assert.deepEqual(
    { skill: all.skill, total: all.total, gems: all.gems },
    {
      skill: "Fireball",
      total: 107,
      gems: [
        { id: "Metadata/Items/Gems/SkillGemSupportAddedChaosDamage", name: "Added Chaos Damage", tags: ["chaos", "intelligence", "support"] },
        { id: "Metadata/Items/Gems/SkillGemSupportAddedColdDamage", name: "Added Cold Damage", tags: ["cold", "dexterity", "support"] },
        { id: "Metadata/Items/Gems/SkillGemSupportAddedFireDamage", name: "Added Fire Damage", tags: ["fire", "physical", "strength", "support"] },
      ],
    },
  );
  assert.ok(declared("skills.support_compatible").output.safeParse(all).success);
  const echo = await supports(fire, "group=1&skill=1&query=echo");
  assert.deepEqual(echo.gems, [
    { id: "Metadata/Items/Gems/SkillGemSupportGreaterSpellEcho", name: "Greater Spell Echo", tags: ["area", "exceptional", "intelligence", "low_max_level", "spell", "support"] },
    { id: "Metadata/Items/Gems/SkillGemSupportSpellEcho", name: "Spell Echo", tags: ["intelligence", "spell", "support"] },
  ]);
  fails(await srv.call("GET", `/v1/skills/${fire}/support-compatible?group=99`), 404, "not_found");
  fails(await srv.call("GET", `/v1/skills/${fire}/support-compatible?group=1&skill=5`), 404, "not_found");

  const cyclone = await buildWith("Marauder", undefined, "Cyclone");
  const cycloneRev = await revisionOf(cyclone);
  const cycloneAll = await supports(cyclone, "group=1&limit=1");
  assert.deepEqual([cycloneAll.skill, cycloneAll.total], ["Cyclone", 106]);
  assert.deepEqual((await supports(cyclone, "group=1&query=echo")).gems, []);
  assert.deepEqual((await supports(cyclone, "group=1&query=melee%20physical")).gems, [
    { id: "Metadata/Items/Gems/SkillGemSupportMeleePhysicalDamage", name: "Melee Physical Damage", tags: ["attack", "melee", "physical", "strength", "support"] },
  ]);
  assert.deepEqual([await revisionOf(fire), await revisionOf(cyclone)], [rev, cycloneRev]);
});

type Parsed = { lines: Array<{ line: string; mods: Array<Record<string, unknown>>; extra: string | null; supported: boolean }> };

void test("parse_mod: what the calculator reads from each line, in input order", async () => {
  const lines = ["+50 to maximum Life", "10% increased Spell Damage", "This line means nothing"];
  const r = ok(await srv.call<Parsed>("POST", "/v1/lookup/parse-mod", { lines }));
  assert.deepEqual(r.lines, [
    { line: lines[0], mods: [{ name: "Life", type: "BASE", value: 50, flags: 0, keywordFlags: 0, tags: [] }], extra: null, supported: true },
    { line: lines[1], mods: [{ name: "Damage", type: "INC", value: 10, flags: 2, keywordFlags: 0, tags: [] }], extra: null, supported: true },
    { line: lines[2], mods: [], extra: "This line means nothing ", supported: false },
  ]);
  assert.ok(declared("lookup.parse_mod").output.safeParse(r).success);
  fails(await srv.call("POST", "/v1/lookup/parse-mod", { lines: Array.from({ length: 51 }, () => "+1 to maximum Life") }), 400, "invalid_input");
  fails(await srv.call("POST", "/v1/lookup/parse-mod", { lines: [] }), 400, "invalid_input");
  fails(await srv.call("POST", "/v1/lookup/parse-mod", { lines: ["x".repeat(501)] }), 400, "invalid_input");
});

void test("describe_stats: the game text of stat values; only the scopes the gems use", async () => {
  const r = ok(await srv.call<{ scope: string; lines: string[] }>("POST", "/v1/lookup/describe-stats", { stats: { base_maximum_life: 50 } }));
  assert.deepEqual(r, { scope: "stat_descriptions", lines: ["+50 to maximum Life"] });
  assert.ok(declared("lookup.describe_stats").output.safeParse(r).success);
  const gem = ok(await srv.call<{ scope: string }>("POST", "/v1/lookup/describe-stats", { stats: { base_maximum_life: 50 }, scope: "gem_stat_descriptions" }));
  assert.equal(gem.scope, "gem_stat_descriptions");
  for (const scope of ["../../etc", "Data/StatDescriptions/stat_descriptions", "stat_descriptions.lua", "monster_stat_descriptions"]) {
    fails(await srv.call("POST", "/v1/lookup/describe-stats", { stats: { base_maximum_life: 50 }, scope }), 400, "invalid_input");
  }
  fails(await srv.call("POST", "/v1/lookup/describe-stats", { stats: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`stat_${i}`, 1])) }), 400, "invalid_input");
  fails(await srv.call("POST", "/v1/lookup/describe-stats", { stats: {} }), 400, "invalid_input");
});
