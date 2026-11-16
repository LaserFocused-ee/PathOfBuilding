// Worker tests for evaluate what_if and compare_item (the answer is the same as doing it for real on a duplicate build), on tree 3_30.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { routes } from "../src/routes.js";
import { FIXTURES, startServer, type TestServer } from "./helpers.js";

type Value = number | string | boolean | null;
type Changed = Record<string, { before: Value; after: Value }>;
type Mutated = { result: Record<string, unknown>; changed: Changed; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type SlotChange = { slot: string; equipped: string | null; changed: Changed; gain: number };

let srv: TestServer;
/** The Elementalist fixture (Fireball, Spell Echo, Added Lightning Damage, 15 nodes) with an amulet and a flask equipped, an unequipped helmet, a second tree and a second item set. */
let base: string;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};

const amulet = "Rarity: RARE\nTest Amulet\nOnyx Amulet\nImplicits: 1\n+16 to all Attributes\n+50 to maximum Life\n+20% to Fire Resistance";
const helmet = "Rarity: RARE\nTest Helm\nHubris Circlet\nImplicits: 0\n+80 to maximum Energy Shield\n+30% to Fire Resistance\n25% increased Spell Damage";
const ring = "Rarity: RARE\nTest Ring\nRuby Ring\nImplicits: 1\n+30% to Fire Resistance\n+40 to maximum Life";

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


void test("what_if nodes: adding a node equals allocating it; removing a leaf equals deallocating it; by id or exact name", async () => {
  const added = await ev<{ changed: Changed }>(base, "what-if", { addNodes: [44983] });
  assert.deepEqual(added.changed, {
    AverageBurstDamage: { before: 5177.7875, after: 5563.7 },
    AverageHit: { before: 2588.89375, after: 2781.85 },
    CombinedDPS: { before: 7672.7473304598, after: 8325.4583566924 },
    IgniteDPS: { before: 1839.1067471265, after: 2057.0230233591 },
    TotalDPS: { before: 5833.6405833333, after: 6268.4353333333 },
    TotalDotDPS: { before: 1839.1067471265, after: 2057.0230233591 },
    WithIgniteDPS: { before: 7672.7473304598, after: 8325.4583566924 },
  });
  const real = await mutate("tree", await dup(base), "allocate", { nodes: [44983] });
  assert.deepEqual(added.changed, real.changed, "the what-if is the engine's own change");
  // a mastery with no effect chosen would read the calculator's own pick: refused, naming set_mastery
  const mastery = await srv.call("POST", `/v1/evaluate/${base}/what-if`, { addNodes: [16123] });
  assert.deepEqual([mastery.status, mastery.body.error?.code], [400, "invalid_input"]);
  assert.match(mastery.body.error?.message ?? "", /is a mastery: pick its effect with tree set_mastery/);
  const keystone = await ev<{ changed: Changed }>(base, "what-if", { addNodes: ["Elemental Overload"], fields: ["CombinedDPS"] });
  assert.deepEqual(keystone.changed, (await ev<{ changed: Changed }>(base, "what-if", { addNodes: [22088], fields: ["CombinedDPS"] })).changed, "a name and its id are the same node");
});

void test("what_if nodes with their paths, as the tree's hover: the path an added node needs, the nodes a removal cuts", async () => {
  type Paths = { changed: Changed; paths: Array<{ node: number; kind: string; points: number; nodes: Array<{ id: number }> }>; withPaths?: { changed: Changed; points: number } };
  const far = await ev<Paths>(base, "what-if", { addNodes: ["Elemental Overload"] });
  const path = far.paths[0];
  assert.ok(path && path.kind === "path" && path.points > 1 && path.nodes.some((n) => n.id === 22088), JSON.stringify(far.paths));
  assert.equal(far.withPaths?.points, path.points);
  const real = await mutate("tree", await dup(base), "allocate", { nodes: ["Elemental Overload"] });
  assert.deepEqual(far.withPaths?.changed, real.changed, "with its path the what-if is the engine's own allocation");
  // a removal that cuts the branch behind it (4184: 4 nodes), and a leaf (30225) that cuts only itself
  const cut = await ev<Paths>(base, "what-if", { removeNodes: [4184] });
  assert.deepEqual([cut.paths[0]?.kind, cut.paths[0]?.points, cut.withPaths?.points], ["depends", 4, 4]);
  const cutting = await dup(base);
  const refused = await srv.call("POST", `/v1/tree/${cutting}/deallocate`, { nodes: [4184] });
  assert.deepEqual([refused.status, refused.body.error?.code], [400, "invalid_input"], "a deallocation that takes nodes it does not name needs force");
  assert.match(refused.body.error?.message ?? "", /would also remove 3 other nodes that hang from it \(4 in all\)/);
  const gone = await mutate("tree", cutting, "deallocate", { nodes: [4184], force: true });
  assert.deepEqual(cut.withPaths?.changed, gone.changed, "with its dependents the what-if is the engine's own deallocation");
  assert.deepEqual(cut.changed, gone.changed, "the top-level figure takes the dependents along too");
  assert.deepEqual([(gone.result as { count?: number }).count, (gone.result as { removed?: Array<{ id: number }> }).removed?.map((n) => n.id).sort()], [4, cut.paths[0]?.nodes.map((n) => n.id).sort()], "the answer lists what went, the what-if's dependents");
  const leaf = await ev<Paths>(base, "what-if", { removeNodes: [30225] });
  assert.deepEqual([leaf.paths[0]?.points, leaf.withPaths], [1, undefined]);
});

void test("what_if nodes by name, removal and fields", async () => {
  const removed = await ev<{ changed: Changed }>(base, "what-if", { removeNodes: ["Fire Walker"] });
  assert.deepEqual(removed.changed, {
    AverageBurstDamage: { before: 5177.7875, after: 4574.575 },
    AverageHit: { before: 2588.89375, after: 2287.2875 },
    CombinedDPS: { before: 7672.7473304598, after: 6427.8683240261 },
    FireMaximumHitTaken: { before: 1120, after: 1003 },
    FireResist: { before: -25, after: -40 },
    IgniteDPS: { before: 1839.1067471265, after: 1487.3273240261 },
    ManaPerSecondCost: { before: 37.18, after: 35.64 },
    Speed: { before: 2.2533333333333, after: 2.16 },
    TotalDPS: { before: 5833.6405833333, after: 4940.541 },
    TotalDotDPS: { before: 1839.1067471265, after: 1487.3273240261 },
    TotalEHP: { before: 1055.0637436429, after: 1028.955343551 },
    WithIgniteDPS: { before: 7672.7473304598, after: 6427.8683240261 },
  });
  const real = await mutate("tree", await dup(base), "deallocate", { nodes: ["Fire Walker"] });
  assert.deepEqual(removed.changed, real.changed);
  const byId = await ev<{ changed: Changed }>(base, "what-if", { removeNodes: [34661], fields: ["CombinedDPS", "Life"] });
  assert.deepEqual(byId.changed, { CombinedDPS: { before: 7672.7473304598, after: 6427.8683240261 } });
  const both = await ev<{ changed: Changed }>(base, "what-if", { addNodes: [44983], removeNodes: [30225], fields: ["CombinedDPS"] });
  assert.deepEqual(both.changed, { CombinedDPS: { before: 7672.7473304598, after: 8064.4660233591 } });
  const d = await dup(base);
  await mutate("tree", d, "allocate", { nodes: [44983] });
  await mutate("tree", d, "deallocate", { nodes: [30225] });
  assert.equal(await stat(d, "CombinedDPS"), 8064.4660233591, "both changes at once equal making them one after the other");
});

void test("what_if conditions equal the configuration option; a flask toggle equals its Active box", async () => {
  const onslaught = await ev<{ changed: Changed }>(base, "what-if", { conditions: ["Onslaught"] });
  assert.deepEqual(onslaught.changed, {
    CombinedDPS: { before: 7672.7473304598, after: 8798.5090309034 },
    EffectiveMovementSpeedMod: { before: 1, after: 1.2 },
    IgniteDPS: { before: 1839.1067471265, after: 1894.7923642368 },
    ManaPerSecondCost: { before: 37.18, after: 44 },
    Speed: { before: 2.2533333333333, after: 2.6666666666667 },
    TotalDPS: { before: 5833.6405833333, after: 6903.7166666667 },
    TotalDotDPS: { before: 1839.1067471265, after: 1894.7923642368 },
    WithIgniteDPS: { before: 7672.7473304598, after: 8798.5090309034 },
  });
  assert.deepEqual(onslaught.changed, (await mutate("config", await dup(base), "set", { values: { buffOnslaught: true } })).changed);

  const flask = await ev<{ changed: Changed }>(base, "what-if", { toggleFlask: "Flask 1" });
  assert.deepEqual(flask.changed, { EffectiveMovementSpeedMod: { before: 1, after: 1.4 } });
  assert.deepEqual(flask.changed, (await mutate("items", await dup(base), "set-active", { slot: "Flask 1", active: true })).changed);
});

void test("what_if a socket and its jewel in one call equals allocating the socket and socketing the jewel for real", async () => {
  const jewel = "Rarity: RARE\nTest Jewel\nCobalt Jewel\nImplicits: 0\n15% increased Fire Damage\n9% increased Damage\n4% increased Cast Speed with Fire Skills\n11% increased Projectile Damage";
  const wi = await ev<{ withPaths: { changed: Changed; points: number } }>(base, "what-if", { addNodes: [41263], slot: "Jewel 41263", text: jewel, fields: ["CombinedDPS", "Life"] });
  const real = await dup(base);
  await mutate("tree", real, "allocate", { nodes: [41263] });
  await mutate("items", real, "add", { text: jewel, equip: "Jewel 41263" });
  const now = await output(real, "CombinedDPS,Life");
  assert.deepEqual([wi.withPaths.points, wi.withPaths.changed.CombinedDPS?.after, wi.withPaths.changed.Life?.after ?? now.Life], [4, now.CombinedDPS, now.Life]);
  const off = await srv.call("POST", `/v1/evaluate/${base}/what-if`, { slot: "Jewel 41263", text: jewel });
  assert.deepEqual([off.status, off.body.error?.code], [400, "invalid_input"], "the socket is not allocated");
  const foreign = await srv.call("POST", `/v1/evaluate/${base}/what-if`, { addNodes: ["Unflinching"] });
  assert.deepEqual([foreign.status, foreign.body.error?.message], [400, "Unflinching (1734) cannot be reached from the tree: it is a node of Juggernaut, not of this build's ascendancy"]);
});

void test("what_if an item in a slot equals equipping it for real, by text and by item id", async () => {
  const wi = await ev<{ changed: Changed }>(base, "what-if", { slot: "Helmet", text: helmet });
  assert.deepEqual(wi.changed, {
    AverageBurstDamage: { before: 5177.7875, after: 6012.1375 },
    AverageHit: { before: 2588.89375, after: 3006.06875 },
    ColdMaximumHitTaken: { before: 969, after: 1123 },
    CombinedDPS: { before: 7672.7473304598, after: 8612.7816637931 },
    EnergyShield: { before: 38, after: 266 },
    FireMaximumHitTaken: { before: 1120, after: 1696 },
    FireResist: { before: -25, after: 5 },
    LightningMaximumHitTaken: { before: 969, after: 1123 },
    PhysicalMaximumHitTaken: { before: 1434, after: 1662 },
    TotalDPS: { before: 5833.6405833333, after: 6773.6749166667 },
    TotalEHP: { before: 1055.0637436429, after: 1288.6216976366 },
    WithIgniteDPS: { before: 7672.7473304598, after: 8612.7816637931 },
  });
  assert.deepEqual(wi.changed, (await mutate("items", await dup(base), "add", { text: helmet, equip: "Helmet" })).changed);
  assert.deepEqual((await ev<{ changed: Changed }>(base, "what-if", { slot: "Helmet", item: 3 })).changed, wi.changed);
});

void test("what_if replacing an item that grants a skill leaves the skill out, as equipping for real does", async () => {
  const id = await dup(base);
  await mutate("items", id, "add", { text: "Rarity: RARE\nGranted\nIron Ring\nGrants Level 20 Anger Skill", equip: "Ring 1" });
  const plain = "Rarity: NORMAL\nIron Ring";
  const wi = await ev<{ changed: Changed }>(id, "what-if", { slot: "Ring 1", text: plain, fields: ["CombinedDPS"] });
  const dps = wi.changed.CombinedDPS;
  assert.ok(dps && Number(dps.after) < Number(dps.before), JSON.stringify(wi.changed));
  const real = await mutate("items", await dup(id), "add", { text: plain, equip: "Ring 1" });
  assert.deepEqual(wi.changed.CombinedDPS, real.changed.CombinedDPS);
});

void test("compare_item: every slot the item fits, against equipping it on a duplicate", async () => {
  const byId = await ev<{ slots: SlotChange[] }>(base, "compare-item", { item: 3 });
  assert.deepEqual(byId.slots.map((s) => [s.slot, s.equipped]), [["Helmet", null]]);
  const real = await mutate("items", await dup(base), "equip", { item: 3, slot: "Helmet" });
  assert.deepEqual(byId.slots[0]?.changed, real.changed);
  assert.equal(byId.slots[0]?.changed.EnergyShield?.after, 266);

  const rings = await ev<{ slots: SlotChange[] }>(base, "compare-item", { text: ring });
  assert.deepEqual(rings.slots.map((s) => s.slot), ["Ring 1", "Ring 2"]);
  assert.deepEqual(rings.slots[0]?.changed, {
    ChaosMaximumHitTaken: { before: 873, after: 902 },
    ColdMaximumHitTaken: { before: 969, after: 1001 },
    FireMaximumHitTaken: { before: 1120, after: 1511 },
    FireResist: { before: -25, after: 5 },
    Life: { before: 1396, after: 1443 },
    LightningMaximumHitTaken: { before: 969, after: 1001 },
    PhysicalMaximumHitTaken: { before: 1434, after: 1481 },
    TotalEHP: { before: 1055.0637436429, after: 1148.0054126073 },
  });
  assert.deepEqual(rings.slots[1]?.changed, rings.slots[0]?.changed);
  const one = await ev<{ slots: SlotChange[] }>(base, "compare-item", { text: ring, slot: "Ring 2", fields: ["Life"] });
  assert.deepEqual(one.slots, [{ slot: "Ring 2", equipped: null, changed: { Life: { before: 1396, after: 1443 } }, gain: 44.046 }]);

  // An item already in its slot changes nothing, and the slot reports what it holds.
  assert.deepEqual((await ev<{ slots: SlotChange[] }>(base, "compare-item", { item: 1 })).slots, [{ slot: "Amulet", equipped: "Test Amulet, Onyx Amulet", changed: {}, gain: 0 }]);
});


// A recorded trade site for one ring listing (made-up seller), to compare trade.search's text and score with compare_item's.
const ringEntry = { id: "ab12", listing: { indexed: "2026-11-14T20:00:00Z", whisper: "@test-seller hi", account: { name: "test-seller" }, price: { type: "~price", amount: 3, currency: "chaos" } }, item: { rarity: "Rare", name: "Test Loop", typeLine: "Ruby Ring", ilvl: 84, implicitMods: ["+30% to Fire Resistance"], explicitMods: [{ description: "+40 to maximum Life" }], craftedMods: [{ description: "+12% to Cold Resistance" }], fracturedMods: [{ description: "+9% to Lightning Resistance" }] } };
const LEAGUE = "Keepers of the Flame";
const tradeSite = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = url instanceof Request ? url.url : url.toString();
  const headers = { "x-rate-limit-rules": "Ip", "x-rate-limit-ip": "100:10:0", "x-rate-limit-ip-state": "1:10:0" };
  const body = u.endsWith("/api/trade/data/leagues") ? { result: [{ id: LEAGUE, realm: "pc" }, { id: "Standard", realm: "pc" }] } : init?.method === "POST" ? { id: "R1ng", result: ["ab12"], total: 1 } : { result: [ringEntry] };
  return Promise.resolve(new Response(JSON.stringify(body), { headers }));
};
const declared = routes.find((r) => r.name === "evaluate.compare_item")?.output;

void test("compare_item with a trade listing: the text and gain are trade.search's, rows sorted by gain, weights change gain, the build is left alone", async () => {
  const trade = await startServer({ tradeLeague: LEAGUE }, { fetch: tradeSite });
  try {
    const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
    const id = ok(await trade.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).build.id;
    const state = async () => JSON.stringify([ok(await trade.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code, ok(await trade.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision, ok(await trade.call<{ stats: unknown[] }>("GET", `/v1/stats/${id}/sidebar`)).stats]);
    const s0 = await state();
    const found = async (body: Record<string, unknown>) => {
      const r = ok(await trade.call<{ searches: Array<{ listings: Array<{ text: string; score: { slot: string; gain: number; changed: Changed } }> }> }>("POST", "/v1/trade/search", { buildId: id, searches: [{ query: { status: { option: "securable" } }, slot: "Ring 1" }], ...body }));
      return r.searches[0]?.listings[0];
    };
    const call = async (body: Record<string, unknown>) => {
      const r = await trade.call<{ text?: string; slots: SlotChange[] }>("POST", `/v1/evaluate/${id}/compare-item`, body);
      assert.equal(r.status, 200, JSON.stringify(r.body.error));
      assert.ok(declared?.safeParse(r.body.result).success, "the answer matches its declared output");
      return r.body.result;
    };
    const listed = await found({});
    assert.ok(listed?.text.includes("+12% to Cold Resistance") && listed.text.includes("+9% to Lightning Resistance"), "crafted and fractured mods are in the text");
    assert.doesNotMatch(JSON.stringify(listed), /test-seller/);

    const whole = await call({ listing: ringEntry });
    assert.equal(whole.text, listed?.text, "the text is trade.search's for the same entry");
    assert.deepEqual(await call({ listing: ringEntry.item }), whole, "the fetch answer's item alone is the same listing");
    const byText = await call({ text: whole.text });
    assert.deepEqual(whole.slots, byText.slots, "the rows are compare_item's for that text");
    assert.equal(byText.text, undefined, "text is answered only for a listing");
    assert.deepEqual(whole.slots.map((r) => r.slot), ["Ring 1", "Ring 2"]);

    const ring1 = whole.slots.find((r) => r.slot === "Ring 1");
    assert.equal(ring1?.gain, listed?.score.gain, "the same gain as trade.search's score");
    assert.deepEqual(ring1?.changed, listed?.score.changed);
    assert.equal(ring1?.gain, 64.596);
    assert.ok((ring1?.changed.Life?.after ?? 0) > (ring1?.changed.Life?.before ?? 0) && (ring1?.gain ?? 0) > 0, "more Life and Effective Hit Pool: a positive gain");

    const lifeOnly = [{ stat: "Life", weight: 1 }];
    const weighed = await call({ listing: ringEntry, weights: lifeOnly });
    assert.equal(weighed.slots[0]?.gain, (await found({ weights: lifeOnly }))?.score.gain, "the weights are trade.search's too");
    assert.notEqual(weighed.slots[0]?.gain, ring1?.gain);
    assert.equal(weighed.slots[0]?.gain, 35.392);

    // Rows sorted by gain: a ring that fits both slots, one of which holds a better ring, puts the larger gain first.
    ok(await trade.call("POST", `/v1/items/${id}/add`, { text: ring, equip: "Ring 1" }));
    const sorted = await call({ listing: ringEntry });
    assert.deepEqual(sorted.slots.map((r) => r.slot), ["Ring 2", "Ring 1"], "the empty slot gains more");
    assert.ok((sorted.slots[0]?.gain ?? 0) > (sorted.slots[1]?.gain ?? 0));
    assert.equal(sorted.slots[1]?.equipped, "Test Ring, Ruby Ring");

    const s1 = await state();
    assert.notEqual(s1, s0, "the test's own add changed the build");
    await call({ listing: ringEntry, slot: "Ring 2" });
    assert.equal(await state(), s1, "compare_item left the build as it was");

    // Refusals: exactly one of item, text and listing; a listing needs its item's rarity and typeLine.
    const refuse = async (body: Record<string, unknown>, re: RegExp) => {
      const r = await trade.call<unknown>("POST", `/v1/evaluate/${id}/compare-item`, body);
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.error?.code, "invalid_input");
      assert.match(r.body.error?.message ?? "", re);
    };
    await refuse({ listing: ringEntry, text: ring }, /exactly one/);
    await refuse({ item: 1, text: ring }, /exactly one/);
    await refuse({ item: 1, listing: ringEntry }, /exactly one/);
    await refuse({}, /exactly one/);
    await refuse({ listing: { item: { rarity: "Rare", name: "x" } } }, /item\.typeLine/);
    await refuse({ listing: { item: { typeLine: "Ruby Ring", name: "x" } } }, /item\.rarity/);
    await refuse({ listing: { typeLine: "Ruby Ring" } }, /rarity/);
    await refuse({ listing: { rarity: "Rare", typeLine: "Not An Item Base" } }, /could not read this item/);
    // Size: the listing's JSON at most 64 KB, its item text no longer than pasted text may be.
    const mods = (n: number) => ({ item: { ...ringEntry.item, explicitMods: Array.from({ length: n }, () => ({ description: `+1 to maximum Life ${"x".repeat(280)}` })) } });
    await refuse({ listing: { ...mods(1), pad: "x".repeat(65_536) } }, /at most 64 KB/);
    await refuse({ listing: mods(80) }, /longer than 20000 characters/);
    assert.equal(await state(), s1, "refusals changed nothing");
  } finally {
    await trade.close();
  }
});

void test("what_if removeNodes: a node an item grants (anoint) is left out; a node neither allocated nor granted is refused", async () => {
  const id = await dup(base);
  const anointed = `${amulet}\nAllocates Heart of Flame`;
  await mutate("items", id, "add", { text: anointed, equip: "Amulet" });
  const fields = ["CombinedDPS", "Life"];
  const removed = await ev<{ changed: Changed }>(id, "what-if", { removeNodes: ["Heart of Flame"], fields });
  const plain = await ev<{ changed: Changed }>(id, "what-if", { slot: "Amulet", text: amulet, fields });
  assert.ok(removed.changed.CombinedDPS, "the anoint's damage goes");
  assert.deepEqual(removed.changed, plain.changed, "removing the granted node equals the amulet without its anoint");
  const notThere = await srv.call("POST", `/v1/evaluate/${base}/what-if`, { removeNodes: ["Heart of Flame"] });
  assert.deepEqual([notThere.status, notThere.body.error?.message], [400, "Heart of Flame (60501) is not allocated, nor granted by an item"]);
  // a bare base name is that base, Normal, with no mods
  const bare = await ev<{ changed: Changed }>(base, "what-if", { slot: "Helmet", text: "Hubris Circlet", fields: ["EnergyShield"] });
  assert.ok((bare.changed.EnergyShield?.after ?? 0) > (bare.changed.EnergyShield?.before ?? 0), JSON.stringify(bare.changed));
});
