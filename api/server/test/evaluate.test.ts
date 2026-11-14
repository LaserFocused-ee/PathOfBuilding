// Worker tests for evaluate compare_specs / compare_item_sets / compare_builds, the "leaves the build untouched" walk, bad requests and MCP, on tree 3_30.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { FIXTURES, startServer, TOKEN, type TestServer } from "./helpers.js";

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
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);

const amulet = "Rarity: RARE\nTest Amulet\nOnyx Amulet\nImplicits: 1\n+16 to all Attributes\n+50 to maximum Life\n+20% to Fire Resistance";
const helmet = "Rarity: RARE\nTest Helm\nHubris Circlet\nImplicits: 0\n+80 to maximum Energy Shield\n+30% to Fire Resistance\n25% increased Spell Damage";
const ring = "Rarity: RARE\nTest Ring\nRuby Ring\nImplicits: 1\n+30% to Fire Resistance\n+40 to maximum Life";

const evaluate = (id: string, action: string, body: Record<string, unknown>) => srv.call<Record<string, unknown>>("POST", `/v1/evaluate/${id}/${action}`, body);
const ev = async <T>(id: string, action: string, body: Record<string, unknown>) => ok(await srv.call<T>("POST", `/v1/evaluate/${id}/${action}`, body));
const mutate = async (area: string, id: string, action: string, body: Record<string, unknown>) => ok(await srv.call<Mutated>("POST", `/v1/${area}/${id}/${action}`, body));
const dup = async (id: string) => ok(await srv.call<{ build: { id: string } }>("POST", `/v1/builds/${id}/duplicate`, {})).build.id;
const output = async (id: string, fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
const code = async (id: string) => ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code;
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const sidebar = async (id: string) => ok(await srv.call<{ stats: unknown[] }>("GET", `/v1/stats/${id}/sidebar`)).stats;

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


void test("compare_specs, compare_item_sets and compare_builds equal switching for real", async () => {
  const specs = await ev<{ changed: Changed }>(base, "compare-specs", { a: 1, b: 2 });
  assert.deepEqual(specs.changed, (await mutate("tree", await dup(base), "spec-activate", { index: 2 })).changed);
  assert.deepEqual(specs.changed.WithIgniteDPS, { before: 7672.7473304598, after: 8325.4583566924 });
  assert.deepEqual((await ev<{ changed: Changed }>(base, "compare-specs", { b: 2, fields: ["CombinedDPS"] })).changed, { CombinedDPS: { before: 7672.7473304598, after: 8325.4583566924 } });
  assert.deepEqual((await ev<{ changed: Changed }>(base, "compare-specs", { a: 2, b: 1, fields: ["CombinedDPS"] })).changed, { CombinedDPS: { before: 8325.4583566924, after: 7672.7473304598 } });

  const sets = await ev<{ changed: Changed }>(base, "compare-item-sets", { b: 2 });
  assert.deepEqual(sets.changed, (await mutate("items", await dup(base), "set-activate", { index: 2 })).changed);
  assert.deepEqual([sets.changed.Life, sets.changed.FireResist, sets.changed.ColdMaximumHitTaken], [{ before: 1396, after: 1328 }, { before: -25, after: -45 }, { before: 969, after: null }]);

  const other = await dup(base);
  const real = await mutate("tree", other, "allocate", { nodes: [44983] });
  const builds = await ev<{ changed: Changed }>(base, "compare-builds", { other });
  assert.deepEqual(builds.changed, real.changed);
  assert.deepEqual((await ev<{ changed: Changed }>(base, "compare-builds", { other, fields: ["CombinedDPS", "Life"] })).changed, { CombinedDPS: { before: 7672.7473304598, after: 8325.4583566924 } });
  assert.deepEqual((await ev<{ changed: Changed }>(base, "compare-builds", { other: base })).changed, {});
});

void test("every evaluate route leaves the build's code, revision and stats as they were", async () => {
  const other = await dup(base);
  const calls: Array<[string, Record<string, unknown>]> = [
    ["what-if", { addNodes: [44983], removeNodes: [34661], slot: "Helmet", item: 3, toggleFlask: "Flask 1", conditions: ["Onslaught"] }],
    ["node-power", { stat: "TotalEHP", depth: 3 }],
    ["compare-item", { text: ring }],
    ["gem-rank", { group: 1, stat: "FullDPS", limit: 5 }],
    ["anoint-rank", { item: 1, stat: "Life" }],
    ["unique-rank", { slot: "Amulet", stat: "TotalEHP", limit: 5 }],
    ["compare-specs", { a: 1, b: 2 }],
    ["compare-item-sets", { a: 1, b: 2 }],
    ["compare-builds", { other }],
  ];
  const [c0, r0, s0, o0] = [await code(base), await revisionOf(base), JSON.stringify(await sidebar(base)), JSON.stringify(await output(base, "CombinedDPS,Life,TotalEHP"))];
  for (const [action, body] of calls) {
    const res = await evaluate(base, action, body);
    assert.equal(res.status, 200, `${action}: ${JSON.stringify(res.body.error)}`);
    assert.equal(await code(base), c0, `${action} changed the build code`);
    assert.equal(await revisionOf(base), r0, `${action} moved the revision`);
    assert.equal(JSON.stringify(await sidebar(base)), s0, `${action} changed the stats`);
  }
  assert.equal(JSON.stringify(await output(base, "CombinedDPS,Life,TotalEHP")), o0);
});

void test("bad requests are 400 invalid_input (404 for a build that is not there)", async () => {
  fails(await evaluate(base, "what-if", { addNodes: [99999999] }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { addNodes: ["No Such Node"] }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { addNodes: [] }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", {}), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { slot: "Nowhere", text: helmet }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { slot: "Helmet", text: "not an item" }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { slot: "Helmet", item: 99 }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { slot: "Amulet", text: helmet }), 400, "invalid_input");
  fails(await evaluate(base, "what-if", { toggleFlask: "Flask 2" }), 400, "invalid_input");
  fails(await evaluate(base, "node-power", { stat: "NoSuchStat" }), 400, "invalid_input");
  fails(await evaluate(base, "node-power", { stat: "CombinedDPS", limit: 500 }), 400, "invalid_input");
  fails(await evaluate(base, "compare-item", { text: helmet, slot: "Amulet" }), 400, "invalid_input");
  fails(await evaluate(base, "compare-item", {}), 400, "invalid_input");
  fails(await evaluate(base, "gem-rank", { group: 9, stat: "CombinedDPS" }), 400, "invalid_input");
  fails(await evaluate(base, "gem-rank", { group: 1, stat: "Life" }), 400, "invalid_input");
  fails(await evaluate(base, "gem-rank", { group: 1, gem: 9, stat: "CombinedDPS" }), 400, "invalid_input");
  fails(await evaluate(base, "anoint-rank", { item: 3, stat: "Life" }), 400, "invalid_input");
  fails(await evaluate(base, "anoint-rank", { item: 1, stat: "OffenceDefence" }), 400, "invalid_input");
  fails(await evaluate(base, "unique-rank", { slot: "Banana", stat: "Life" }), 400, "invalid_input");
  fails(await evaluate(base, "unique-rank", { slot: "Helmet", stat: "Name" }), 400, "invalid_input");
  fails(await evaluate(base, "compare-specs", { b: 9 }), 400, "invalid_input");
  fails(await evaluate(base, "compare-item-sets", { b: 9 }), 400, "invalid_input");
  fails(await evaluate(base, "compare-builds", { other: "0123456789abcdef" }), 404, "not_found");
  fails(await evaluate("0123456789abcdef", "what-if", { conditions: ["Onslaught"] }), 404, "not_found");
  assert.equal((await srv.call("GET", `/v1/evaluate/${base}/what-if`)).status, 404, "evaluate takes POST");
});

void test("MCP: pob_evaluate is listed read-only and answers a what-if", async () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.find((t) => t.name === "pob_evaluate")?.annotations?.readOnlyHint, true);
    const res = await client.callTool({ name: "pob_evaluate", arguments: { action: "what_if", id: base, addNodes: [44983], fields: ["CombinedDPS"] } });
    assert.ok(!res.isError, JSON.stringify(res.structuredContent));
    const body = res.structuredContent as { ok: boolean; result: { changed: Changed } };
    assert.deepEqual(body.result.changed, { CombinedDPS: { before: 7672.7473304598, after: 8325.4583566924 } });
    const fail = await client.callTool({ name: "pob_evaluate", arguments: { action: "node_power", id: base, stat: "NoSuchStat" } });
    assert.equal(fail.isError, true);
  } finally {
    await client.close();
  }
});
