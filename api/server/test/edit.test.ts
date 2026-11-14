// Worker tests for build edits (tree, config, notes, level settings, revert), on tree 3_30, through HTTP and MCP.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startServer, TOKEN, type TestServer } from "./helpers.js";

type Change = Record<string, { before: number | null; after: number | null }>;
type Mutated<T = Record<string, unknown>> = { result: T; changed: Change; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Tree = {
  className: string;
  ascendancy?: string;
  bloodline?: string;
  treeVersion: string;
  points: number;
  nodes: Array<{ id: number; name: string }>;
  masteries: Array<{ nodeId: number; effectId: number; stats: string[] }>;
  specs: Array<{ index: number; title: string; points: number; active: boolean; treeVersion: string }>;
};

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);

/** A new level 90 Witch / Elementalist on tree 3_30: Life 1125, Mana 590, Int 32. */
async function newWitch(): Promise<string> {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" }));
  return r.build.id;
}
const output = async (id: string, fields: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=${fields}`)).output;
const tree = async (id: string) => ok(await srv.call<Tree>("GET", `/v1/tree/${id}/get`));
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("tree: path, allocate by name, deallocate; stale and failed edits change nothing", async () => {
  const id = await newWitch();
  const path = ok(await srv.call<{ length: number; nodes: Array<{ id: number; name: string }> }>("GET", `/v1/tree/${id}/path?to=Arcane%20Potency`));
  assert.equal(path.length, 13);
  assert.deepEqual([path.nodes[0]?.id, path.nodes.at(-1)?.name], [57264, "Arcane Potency"]);

  const m = ok(await srv.call<Mutated<{ allocated: number[] }>>("POST", `/v1/tree/${id}/allocate`, { nodes: ["Arcane Potency"], baseRevision: 1 }));
  assert.deepEqual([m.revision, m.result.allocated, m.changed.Int, m.changed.Mana], [2, [46842], { before: 32, after: 122 }, { before: 590, after: 651 }]);
  const t = await tree(id);
  assert.equal(t.points, 13);
  assert.ok(t.nodes.some((n) => n.id === 46842 && n.name === "Arcane Potency"));
  assert.deepEqual(await output(id, "Int,Mana"), { Int: 122, Mana: 651 });
  const route = ok(await srv.call<{ length: number }>("GET", `/v1/tree/${id}/path?from=Arcane%20Potency&to=Elemental%20Overload`));
  assert.ok(route.length > 0);

  fails(await srv.call("POST", `/v1/tree/${id}/deallocate`, { nodes: [57264], baseRevision: 1 }), 409, "stale_revision");
  fails(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: ["No Such Node"] }), 404, "not_found");
  assert.equal(await revisionOf(id), 2);

  const d = ok(await srv.call<Mutated>("POST", `/v1/tree/${id}/deallocate`, { nodes: [57264], baseRevision: 2 }));
  assert.deepEqual([d.revision, d.changed.Int], [3, { before: 122, after: 32 }]);
  assert.equal((await tree(id)).points, 0, "everything past the first path node went with it");

  // A list that fails part way is not half-applied: the first node was allocated in the worker, then dropped.
  const other = await newWitch();
  fails(await srv.call("POST", `/v1/tree/${other}/allocate`, { nodes: ["Arcane Potency", 4_000_000] }), 404, "not_found");
  assert.deepEqual([await revisionOf(other), (await output(other, "Int")).Int], [1, 32]);
});

void test("tree: class change keeps or connects the tree; ascendancy and bloodline", async () => {
  const id = await newWitch();
  ok(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: ["Arcane Potency"] }));
  fails(await srv.call("POST", `/v1/tree/${id}/set-class`, { className: "Marauder" }), 400, "invalid_input");
  fails(await srv.call("POST", `/v1/tree/${id}/set-class`, { className: "Gladiator" }), 400, "invalid_input");
  assert.equal((await tree(id)).className, "Witch");
  const c = ok(await srv.call<Mutated>("POST", `/v1/tree/${id}/set-class`, { className: "Shadow", onDisconnected: "connect" }));
  assert.deepEqual([c.changed.Dex, c.changed.Int], [{ before: 14, after: 33 }, { before: 122, after: 203 }]);
  const t = await tree(id);
  assert.deepEqual([t.className, t.ascendancy, t.points > 13], ["Shadow", undefined, true]);

  fails(await srv.call("POST", `/v1/tree/${id}/set-ascendancy`, { ascendancy: "Elementalist" }), 400, "invalid_input");
  ok(await srv.call("POST", `/v1/tree/${id}/set-ascendancy`, { ascendancy: "Trickster" }));
  assert.equal((await tree(id)).ascendancy, "Trickster");
  assert.equal(ok(await srv.call<{ summary: { ascendancy: string } }>("GET", `/v1/builds/${id}`)).summary.ascendancy, "Trickster");

  ok(await srv.call("POST", `/v1/tree/${id}/set-bloodline`, { bloodline: "Oshabi" }));
  assert.equal((await tree(id)).bloodline, "Oshabi Bloodline");
  fails(await srv.call("POST", `/v1/tree/${id}/set-bloodline`, { bloodline: "Warden" }), 400, "invalid_input"); // legacy, removed from 3_30
  ok(await srv.call("POST", `/v1/tree/${id}/set-bloodline`, { bloodline: "None" }));
  assert.equal((await tree(id)).bloodline, undefined);

  ok(await srv.call<Mutated>("POST", `/v1/tree/${id}/set-class`, { className: "Witch" }));
  assert.equal((await tree(id)).points, t.points, "the tree still touches the Witch start, so it is kept");
  ok(await srv.call<Mutated>("POST", `/v1/tree/${id}/set-class`, { className: "Marauder", onDisconnected: "reset" }));
  const m = await tree(id);
  assert.deepEqual([m.className, m.points], ["Marauder", 0]);
});

void test("tree: masteries and the tree list (new, copy, rename, activate, delete, convert, links)", async () => {
  const id = await newWitch();
  ok(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: ["Arcane Potency"] }));
  const opts = ok(await srv.call<{ name: string; effects: Array<{ effectId: number; stats: string[] }> }>("GET", `/v1/tree/${id}/mastery-options?nodeId=16123`));
  assert.equal(opts.name, "Critical Mastery");
  assert.deepEqual(opts.effects.find((e) => e.effectId === 61534)?.stats, ["You take 30% reduced Extra Damage from Critical Strikes"]);
  fails(await srv.call("POST", `/v1/tree/${id}/set-mastery`, { nodeId: 46842, effectId: 61534 }), 400, "invalid_input");
  fails(await srv.call("POST", `/v1/tree/${id}/set-mastery`, { nodeId: 16123, effectId: 1 }), 400, "invalid_input");
  const ms = ok(await srv.call<Mutated>("POST", `/v1/tree/${id}/set-mastery`, { nodeId: 16123, effectId: 61534 }));
  assert.ok((ms.changed.TotalEHP?.after ?? 0) > (ms.changed.TotalEHP?.before ?? Infinity), "less crit damage taken raises effective hit pool");
  let t = await tree(id);
  assert.deepEqual([t.points, t.masteries.map((x) => [x.nodeId, x.effectId])], [14, [[16123, 61534]]]);

  const url = ok(await srv.call<{ url: string }>("GET", `/v1/tree/${id}/export-url`)).url;
  assert.match(url, /^https:\/\/www\.pathofexile\.com\/passive-skill-tree\/3\.30\.0\//);
  ok(await srv.call("POST", `/v1/tree/${id}/spec-copy`, { index: 1 }));
  ok(await srv.call("POST", `/v1/tree/${id}/spec-rename`, { index: 2, title: "Second" }));
  ok(await srv.call("POST", `/v1/tree/${id}/spec-activate`, { index: 2 }));
  const r = ok(await srv.call<Mutated>("POST", `/v1/tree/${id}/reset`, {}));
  assert.equal(r.changed.Int?.after, 32);
  ok(await srv.call("POST", `/v1/tree/${id}/spec-new`, { title: "Blank" }));
  t = await tree(id);
  assert.deepEqual(t.specs.map((s) => [s.title, s.points, s.active]), [["Default", 14, false], ["Second", 0, true], ["Blank", 0, false]]);
  fails(await srv.call("POST", `/v1/tree/${id}/spec-rename`, { index: 9, title: "x" }), 404, "not_found");

  const imp = ok(await srv.call<Mutated<{ title: string; points: number; index: number }>>("POST", `/v1/tree/${id}/import-url`, { url, title: "From link" }));
  assert.deepEqual([imp.result.title, imp.result.points, imp.result.index, imp.changed.Int?.after], ["From link", 14, 4, 122]);
  t = await tree(id);
  assert.deepEqual(t.masteries.map((x) => [x.nodeId, x.effectId]), [[16123, 61534]], "the link carries the mastery choice");
  fails(await srv.call("POST", `/v1/tree/${id}/import-url`, { url: "https://www.pathofexile.com/passive-skill-tree/3.30.0/AAAA" }), 400, "invalid_input");

  ok(await srv.call("POST", `/v1/tree/${id}/spec-delete`, { index: 1 }));
  ok(await srv.call("POST", `/v1/tree/${id}/spec-delete`, { index: 1 }));
  ok(await srv.call("POST", `/v1/tree/${id}/spec-delete`, { index: 1 }));
  t = await tree(id);
  assert.deepEqual(t.specs.map((s) => s.title), ["From link"]);
  fails(await srv.call("POST", `/v1/tree/${id}/spec-delete`, { index: 1 }), 400, "invalid_input"); // the last tree stays

  ok(await srv.call("POST", `/v1/tree/${id}/convert`, { version: "3_28", keepOld: true }));
  t = await tree(id);
  assert.deepEqual(t.specs.map((s) => s.treeVersion), ["3_30", "3_28"]);
  assert.equal(t.treeVersion, "3_28");
  fails(await srv.call("POST", `/v1/tree/${id}/convert`, { version: "3_28" }), 400, "invalid_input");
});

void test("config: options by their controls, config sets, notes, level settings", async () => {
  const id = await newWitch();
  const low = ok(await srv.call<Mutated<{ values: Record<string, unknown> }>>("POST", `/v1/config/${id}/set`, { values: { conditionLowLife: true, enemyIsBoss: "Pinnacle" } }));
  assert.deepEqual(low.changed.LifeRecoverable, { before: null, after: 562.5 });
  assert.deepEqual(low.result.values, { conditionLowLife: true, enemyIsBoss: "Pinnacle" });
  let cfg = ok(await srv.call<{ values: Record<string, unknown>; sets: Array<{ title: string; active: boolean }>; level: number; autoLevel: boolean }>("GET", `/v1/config/${id}/get`));
  assert.equal(cfg.values.conditionLowLife, true);
  fails(await srv.call("POST", `/v1/config/${id}/set`, { values: { conditionLowLife: 3 } }), 400, "invalid_input");
  fails(await srv.call("POST", `/v1/config/${id}/set`, { values: { enemyIsBoss: "Nonsense" } }), 400, "invalid_input");
  fails(await srv.call("POST", `/v1/config/${id}/set`, { values: { noSuchOption: true } }), 400, "invalid_input");
  const back = ok(await srv.call<Mutated>("POST", `/v1/config/${id}/set`, { reset: ["conditionLowLife"] }));
  assert.deepEqual(back.changed.LifeRecoverable, { before: 562.5, after: null });

  ok(await srv.call("POST", `/v1/config/${id}/set-new`, { title: "Boss" }));
  ok(await srv.call("POST", `/v1/config/${id}/set-activate`, { index: 2 }));
  ok(await srv.call("POST", `/v1/config/${id}/set`, { values: { conditionLowLife: true } }));
  ok(await srv.call("POST", `/v1/config/${id}/set-rename`, { index: 2, title: "Low life" }));
  ok(await srv.call("POST", `/v1/config/${id}/set-copy`, { index: 2 }));
  cfg = ok(await srv.call("GET", `/v1/config/${id}/get`));
  assert.deepEqual(cfg.sets.map((s) => [s.title, s.active]), [["Default", false], ["Low life", true], ["Low life copy", false]]);
  const toDefault = ok(await srv.call<Mutated>("POST", `/v1/config/${id}/set-activate`, { index: 1 }));
  assert.deepEqual(toDefault.changed.LifeRecoverable, { before: 562.5, after: null }, "the default set is not on low life");
  ok(await srv.call("POST", `/v1/config/${id}/set-delete`, { index: 3 }));
  assert.equal(ok(await srv.call<{ sets: unknown[] }>("GET", `/v1/config/${id}/get`)).sets.length, 2);

  ok(await srv.call("POST", `/v1/config/${id}/set-notes`, { text: "Plan: ^1fire^7 first" }));
  assert.equal(ok(await srv.call<{ text: string }>("GET", `/v1/config/${id}/notes`)).text, "Plan: ^1fire^7 first");
  assert.ok(ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${id}/xml`)).xml.includes("Plan: ^1fire^7 first"));

  const lvl = ok(await srv.call<Mutated<{ level: number; autoLevel: boolean }>>("POST", `/v1/builds/${id}/settings`, { level: 70 }));
  assert.deepEqual([lvl.result.level, lvl.changed.Life], [70, { before: 1125, after: 885 }]);
  fails(await srv.call("POST", `/v1/builds/${id}/settings`, { level: 101 }), 400, "invalid_input");
  const auto = ok(await srv.call<Mutated<{ level: number; autoLevel: boolean }>>("POST", `/v1/builds/${id}/settings`, { autoLevel: true }));
  assert.deepEqual([auto.result.autoLevel, auto.result.level], [true, 1], "auto level follows points spent (none)");
  assert.equal(ok(await srv.call<{ summary: { level: number } }>("GET", `/v1/builds/${id}`)).summary.level, 1);
});

void test("revert makes an older revision current; edits stream change events", async () => {
  const id = await newWitch();
  const events: string[] = [];
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${srv.port}/v1/builds/${id}/events`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: ac.signal });
  const reader = res.body?.getReader();
  const reading = (async () => {
    const dec = new TextDecoder();
    for (;;) {
      const chunk = await reader?.read().catch(() => undefined);
      if (!chunk || chunk.done) return;
      events.push(dec.decode(chunk.value));
    }
  })();
  ok(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: ["Arcane Potency"] }));
  assert.equal((await output(id, "Int")).Int, 122);
  const rv = ok(await srv.call<{ build: { revision: number } }>("POST", `/v1/builds/${id}/revert`, { revision: 1, baseRevision: 2 }));
  assert.equal(rv.build.revision, 3);
  assert.equal((await output(id, "Int")).Int, 32);
  fails(await srv.call("POST", `/v1/builds/${id}/revert`, { revision: 99 }), 404, "not_found");
  const hist = ok(await srv.call<{ history: Array<{ cause: string }> }>("GET", `/v1/builds/${id}/history`));
  assert.deepEqual(hist.history.map((h) => h.cause), ["revert:1", "tree.allocate", "create:new"]);
  ok(await srv.call("POST", `/v1/builds/${id}/rename`, { name: "Renamed" }));
  ok(await srv.call("DELETE", `/v1/builds/${id}`));
  for (let i = 0; i < 50 && !events.join("").includes("event: deleted"); i++) await new Promise((r) => setTimeout(r, 20));
  ac.abort();
  await reading;
  const text = events.join("");
  const order = [...text.matchAll(/event: (\w+)\ndata: (\{[^\n]*\})/g)].map((m) => `${m[1]}:${(JSON.parse(m[2] ?? "{}") as { revision: number; cause?: string }).revision}:${(JSON.parse(m[2] ?? "{}") as { cause?: string }).cause ?? ""}`);
  assert.deepEqual(order, ["hello:1:", "change:2:tree.allocate", "change:3:revert", "change:4:rename", "deleted:4:delete"]);
  assert.match(text, /"Int":\{[^}]*"after":122/);
});

void test("MCP: pob_tree and pob_config edit a build and report changed stats", async () => {
  const id = await newWitch();
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.find((t) => t.name === "pob_tree")?.annotations?.readOnlyHint, false);
    const a = await client.callTool({ name: "pob_tree", arguments: { action: "allocate", id, nodes: ["Arcane Potency"] } });
    assert.ok(!a.isError, JSON.stringify(a.content));
    assert.deepEqual((a.structuredContent as { result: Mutated }).result.changed.Int, { before: 32, after: 122 });
    const c = await client.callTool({ name: "pob_config", arguments: { action: "set", id, values: { conditionLowLife: true } } });
    assert.equal((c.structuredContent as { result: Mutated }).result.changed.LifeRecoverable?.after, 562.5);
    const bad = await client.callTool({ name: "pob_tree", arguments: { action: "allocate", id, nodes: [] } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
  }
});
