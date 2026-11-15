// lookup.data: every game-data table is paged through one route; the first row of each is pinned exactly, so a change in how a table is read fails here.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { routes } from "../src/routes.js";
import { startServer, type TestServer } from "./helpers.js";

type Row = { name: string } & Record<string, unknown>;
type Page = { table: string; total: number; offset: number; rows: Row[] };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);
const page = async (table: string, query = ""): Promise<Page> => ok(await srv.call<Page>("GET", `/v1/lookup/data/${table}${query}`));

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv?.close();
});

/** The first row of each table (rows sorted by name), as read from the engine. */
const firstRows: Record<string, Row> = {
  rare_templates: {
    "base": "Thicket Bow",
    "lines": [
      "+1 to Level of Socketed Gems",
      "+2 to Level of Socketed Bow Gems",
      "9% increased Attack Speed"
    ],
    "name": "+3 Bow, Thicket Bow",
    "type": "Bow"
  },
  bench_crafts: {
    "affix": "of Craft",
    "group": "LifeLeechPermyriad",
    "level": 30,
    "lines": [
      "(0.3-0.5)% of Physical Attack Damage Leeched as Life"
    ],
    "name": "(0.3-0.5)% of Physical Attack Damage Leeched as Life",
    "tags": [
      "resource",
      "life",
      "physical",
      "attack"
    ],
    "type": "Suffix",
    "types": [
      "Amulet",
      "Gloves",
      "Quiver",
      "Ring"
    ]
  },
  essences: {
    "id": "Metadata/Items/Currency/CurrencyEssenceAnger6",
    "lines": [
      "Amulet: (31-34)% increased Fire Damage",
      "Belt: +(46-48)% to Fire Resistance",
      "Body Armour: +(46-48)% to Fire Resistance",
      "Boots: +(46-48)% to Fire Resistance",
      "Bow: Adds (149-203) to (302-351) Fire Damage",
      "Claw: Adds (80-109) to (162-189) Fire Damage",
      "Dagger: Adds (80-109) to (162-189) Fire Damage",
      "Gloves: +(46-48)% to Fire Resistance",
      "Helmet: +(46-48)% to Fire Resistance",
      "One Handed Axe: Adds (80-109) to (162-189) Fire Damage",
      "One Handed Mace: Adds (80-109) to (162-189) Fire Damage",
      "One Handed Sword: Adds (80-109) to (162-189) Fire Damage",
      "Quiver: +(46-48)% to Fire Resistance",
      "Ring: (31-34)% increased Fire Damage",
      "Sceptre: Adds (80-109) to (162-189) Fire Damage",
      "Shield: +(46-48)% to Fire Resistance",
      "Staff: Adds (149-203) to (302-351) Fire Damage",
      "Thrusting One Handed Sword: Adds (80-109) to (162-189) Fire Damage",
      "Two Handed Axe: Adds (149-203) to (302-351) Fire Damage",
      "Two Handed Mace: Adds (149-203) to (302-351) Fire Damage",
      "Two Handed Sword: Adds (149-203) to (302-351) Fire Damage",
      "Wand: Adds (80-109) to (162-189) Fire Damage"
    ],
    "name": "Deafening Essence of Anger",
    "tier": 7,
    "type": 5
  },
  veiled: {
    "affix": "of Catarina",
    "group": "VeiledJewelAttackSpeedCloseRange",
    "id": "JunMasterVeiledJewelAttackSpeedCloseRange",
    "level": 68,
    "lines": [
      "(1-2)% increased Attack Speed per Enemy in Close Range"
    ],
    "name": "(1-2)% increased Attack Speed per Enemy in Close Range",
    "tags": [
      "attack"
    ],
    "type": "Suffix"
  },
  necropolis: {
    "affix": "of Haunting",
    "group": "ManaReservationEfficiency",
    "id": "NecropolisCraftingManaReservationEfficiency",
    "level": 24,
    "lines": [
      "(10-15)% increased Mana Reservation Efficiency of Skills"
    ],
    "name": "(10-15)% increased Mana Reservation Efficiency of Skills",
    "tags": [
      "resource",
      "necropolis_exclusive_mod",
      "mana"
    ],
    "type": "Suffix"
  },
  beastcraft: {
    "affix": "of Arakaali",
    "group": "GrantsArakaaliAspect",
    "id": "GrantsArakaaliAspectCrafted",
    "level": 20,
    "lines": [
      "Grants Aspect of Arakaali"
    ],
    "name": "Grants Aspect of Arakaali",
    "tags": [
      "skill"
    ],
    "type": "Suffix"
  },
  delve: {
    "affix": "Subterranean",
    "categories": [
      "Amulet"
    ],
    "group": "MaximumManaIncreasePercent",
    "id": "MaximumManaIncreasePercentDelve_",
    "level": 60,
    "lines": [
      "(10-15)% increased maximum Mana"
    ],
    "name": "(10-15)% increased maximum Mana",
    "tags": [
      "resource",
      "mana"
    ],
    "type": "Prefix"
  },
  incursion: {
    "affix": "Tacati's",
    "categories": [
      "Staff"
    ],
    "group": "WeaponSpellDamageAddedAsChaos",
    "id": "SpellDamageOnTwoHandWeaponEnhancedLevel50Mod",
    "level": 50,
    "lines": [
      "(123-130)% increased Spell Damage",
      "Gain 5% of Non-Chaos Damage as extra Chaos Damage"
    ],
    "name": "(123-130)% increased Spell Damage/Gain 5% of Non-Chaos Damage as extra Chaos Damage",
    "tags": [
      "caster_damage",
      "chaos_damage",
      "damage",
      "chaos",
      "caster"
    ],
    "type": "Prefix"
  },
  fossil: {
    "affix": "Subterranean",
    "group": "PhysicalDamageOverTimeTaken",
    "id": "DelveJewelPhysicalDamageOverTimeTaken1",
    "level": 1,
    "lines": [
      "(1-2)% reduced Physical Damage taken over time"
    ],
    "name": "(1-2)% reduced Physical Damage taken over time",
    "tags": [
      "physical"
    ],
    "type": "Prefix"
  },
  enchantments: {
    "name": "(25-35)% reduced Charges per use/Gains no Charges during Effect",
    "slot": "UtilityFlask",
    "source": "ENKINDLING",
    "text": "(25-35)% reduced Charges per use/Gains no Charges during Effect"
  },
  cluster_notables: {
    "name": "Adrenaline",
    "sizes": [
      "Small Cluster Jewel"
    ],
    "skills": [
      "Life"
    ]
  },
  anoint_recipes: {
    "id": 25970,
    "lines": [
      "+15% to Damage over Time Multiplier"
    ],
    "name": "Acrimony",
    "recipe": [
      "ClearOil",
      "BlackOil",
      "BlackOil"
    ]
  },
  keystones: {
    "id": 54307,
    "lines": [
      "Modifiers to Chance to Suppress Spell Damage instead apply to Chance to Dodge Spell Hits at 50% of their value",
      "Maximum Chance to Dodge Spell Hits is 75%"
    ],
    "name": "Acrobatics"
  },
  pantheons: {
    "lines": [
      "Soul of Abberath: 60% less Duration of Ignite on You",
      "Mephod, the Earth Scorcher: Unaffected by Burning Ground",
      "Mephod, the Earth Scorcher: 10% increased Movement Speed while on Burning Ground"
    ],
    "major": false,
    "name": "Abberath"
  },
  map_mods: {
    "lines": [],
    "name": "Abhorrent"
  },
  minions: {
    "accuracy": 3.4,
    "attackRange": 12,
    "attackTime": 1.3,
    "chaosResist": 0,
    "coldResist": 0,
    "damage": 1.5,
    "damageSpread": 0.2,
    "fireResist": 0,
    "id": "HeraldOfAgonySpiderPlated",
    "life": 1.5,
    "lightningResist": 0,
    "name": "Agony Crawler",
    "skills": [
      "HeraldOfAgonyMinionMortar",
      "HeraldOfAgonyMinionTailSpike",
      "HeraldOfAgonyMinionCleave",
      "Melee"
    ],
    "tags": [
      "animal_claw_weapon",
      "beast",
      "flesh_armour",
      "has_one_hand_sword",
      "has_one_handed_melee",
      "insect",
      "insect_blood",
      "medium_height",
      "melee",
      "physical_affinity",
      "very_fast_movement"
    ]
  },
  spectres: {
    "accuracy": 1,
    "armour": 0.25,
    "attackRange": 40,
    "attackTime": 1.995,
    "chaosResist": 0,
    "coldResist": 0,
    "damage": 1.44,
    "damageSpread": 0.2,
    "fireResist": 0,
    "id": "Metadata/Monsters/Bandits/BanditBowPoisonArrow",
    "life": 1.08,
    "lightningResist": 0,
    "limit": "ActiveSpectreLimit",
    "name": "Alira's Deadeye",
    "skills": [
      "MeleeAtAnimationSpeed",
      "MonsterCausticArrowAtAnimationSpeed",
      "EASBanditTauntBow"
    ],
    "tags": [
      "bandit",
      "chaos_affinity",
      "flesh_armour",
      "has_bow",
      "human",
      "humanoid",
      "medium_height",
      "not_int",
      "physical_affinity",
      "puncturing_weapon",
      "ranged",
      "red_blood",
      "very_slow_movement"
    ]
  },
  bosses: {
    "armourMult": 100,
    "evasionMult": 0,
    "isUber": false,
    "name": "AlHezmin"
  },
  timeless: {
    "base": "Hypnotic Eye Jewel",
    "conquerors": [
      "Kurgal"
    ],
    "keystones": {},
    "name": "Baleful Dominion",
    "seedMax": 8000,
    "seedMin": 100
  },
};

void test("every data table answers rows, the first one exactly, in its declared shape", async () => {
  const schema = routes.find((r) => r.name === "lookup.data")?.output;
  assert.ok(schema);
  for (const [table, first] of Object.entries(firstRows)) {
    const result = await page(table, "?limit=2");
    assert.ok(result.total > 0, table);
    assert.equal(result.table, table);
    assert.equal(result.rows.length, 2, table);
    assert.deepEqual(result.rows[0], first, table);
    assert.ok(schema.safeParse(result).success, `${table} matches the declared output`);
  }
});

void test("timeless: one row per timeless jewel type, seed range as written on the item, conquerors with the keystone their variant line names", async () => {
  const all = await page("timeless", "?limit=50");
  assert.equal(all.total, 11);
  assert.deepEqual(all.rows.map((r) => r.name), ["Baleful Dominion", "Brutal Restraint", "Destructive Aspiration", "Elegant Hubris", "Extinguishing Grasp", "Festering Vengeance", "Glorious Vanity", "Heroic Tragedy", "Lethal Pride", "Militant Faith", "Reclaimed Malevolence"]);
  const row = (name: string) => all.rows.find((r) => r.name === name);
  assert.deepEqual(row("Lethal Pride"), {
    name: "Lethal Pride", base: "Timeless Jewel", radius: "Large", seedMin: 10000, seedMax: 18000,
    conquerors: ["Kaom", "Kiloava", "Rakiata", "Akoya"],
    keystones: { Kaom: "Strength of Blood", Kiloava: "Glancing Blows", Rakiata: "Tempered by War", Akoya: "Chainbreaker" },
  });
  // Elegant Hubris is written 2000-160000 on the item (the engine's own tables hold that divided by 20)
  assert.deepEqual([row("Elegant Hubris")?.seedMin, row("Elegant Hubris")?.seedMax, row("Elegant Hubris")?.conquerors], [2000, 160000, ["Cadiro", "Chitus", "Victario", "Caspiro"]]);
  assert.deepEqual([row("Militant Faith")?.seedMin, row("Militant Faith")?.seedMax, row("Militant Faith")?.conquerors], [2000, 10000, ["Avarius", "Dominus", "Venarius", "Maxarius"]]);
  assert.deepEqual([row("Glorious Vanity")?.conquerors, row("Heroic Tragedy")?.conquerors, row("Brutal Restraint")?.conquerors], [["Doryani", "Xibaqua", "Zerphi", "Ahuana"], ["Vorana", "Uhtred", "Medved"], ["Asenath", "Deshret", "Nasima", "Balbala"]]);
  // the Abyss jewels name one conqueror, no keystone and have no radius
  assert.deepEqual(row("Reclaimed Malevolence"), { name: "Reclaimed Malevolence", base: "Assembled Eye Jewel", seedMin: 100, seedMax: 8000, conquerors: ["Zorath"], keystones: {} });
  assert.deepEqual(row("Festering Vengeance")?.conquerors, ["Tecrod"]);
});

void test("the route names exactly the tables checked here", () => {
  const route = routes.find((r) => r.name === "lookup.data");
  assert.deepEqual(Object.keys(firstRows).sort(), [...(route?.input.shape.table as unknown as { options: string[] }).options].sort());
});

void test("a query narrows a table to the rows whose name or text line holds it, in any case", async () => {
  const byName = await page("keystones", "?query=acrobatics");
  assert.deepEqual(byName.rows.map((r) => r.name), ["Acrobatics"]);
  assert.equal(byName.total, 1);
  const byLine = await page("pantheons", "?query=burning%20GROUND");
  assert.ok(byLine.total >= 1 && byLine.rows.some((r) => r.name === "Abberath"));
  assert.equal((await page("bosses", "?query=zzz-no-such-row")).total, 0);
  // slot narrows enchantments to one item group; other tables refuse it
  const flask = await page("enchantments", "?slot=UtilityFlask&limit=100");
  assert.ok(flask.total === 21 && flask.rows.every((r) => r.slot === "UtilityFlask" && typeof r.text === "string"), `total ${flask.total}`);
  fails(await srv.call("GET", "/v1/lookup/data/keystones?slot=Helmet"), 400, "invalid_input");
  const ringCrafts = await page("bench_crafts", "?itemType=ring&limit=200");
  assert.ok(ringCrafts.total > 10 && ringCrafts.rows.every((r) => (r.types as string[]).includes("Ring")), `total ${ringCrafts.total}`);
  assert.ok(ringCrafts.total < (await page("bench_crafts")).total);
  fails(await srv.call("GET", "/v1/lookup/data/essences?itemType=Ring"), 400, "invalid_input");
});

void test("paging: offset and limit take the same rows as the whole list", async () => {
  for (const table of ["bench_crafts", "enchantments", "spectres"]) {
    const all = await page(table, "?limit=5");
    const second = await page(table, "?offset=1&limit=1");
    assert.deepEqual(second.rows, [all.rows[1]], table);
    assert.equal(second.offset, 1);
    assert.equal(second.total, all.total);
    const names = all.rows.map((r) => r.name);
    assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), `${table} sorted by name`);
  }
});

void test("an unknown table or a limit above 200 is refused", async () => {
  fails(await srv.call("GET", "/v1/lookup/data/nope"), 400, "invalid_input");
  fails(await srv.call("GET", "/v1/lookup/data/keystones?limit=201"), 400, "invalid_input");
  fails(await srv.call("GET", "/v1/lookup/data/keystones?limit=0"), 400, "invalid_input");
});
