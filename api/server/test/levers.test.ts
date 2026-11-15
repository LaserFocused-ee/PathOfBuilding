// stats.levers: the build-quality levers a build leaves unpulled, on a cluster build (3_13) and a new 3_30 build.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, test } from "node:test";
import { ROOT, startServer, type TestServer } from "./helpers.js";

type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Levers = {
  jewelSockets: { allocated: Array<{ nodeId: number; kind: string; itemName: string | null }>; empty: number; reachable: Array<{ nodeId: number; kind: string; points: number }> };
  clusterJewels: Array<{ nodeId: number; base: string }>;
  flasks: Array<{ slot: string; name: string | null; active: boolean }>;
  abyssalSockets: unknown[];
  anoints: Array<{ slot: string; allocates: string[] }>;
  tattoos: Array<{ nodeId: number; name: string }>;
  masteries: { allocated: number; selected: number; unselected: unknown[] };
  config: { count: number; values: Record<string, unknown> };
  unused: string[];
};

let srv: TestServer;
const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const levers = async (id: string) => ok(await srv.call<Levers>("GET", `/v1/stats/${id}/levers`));

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("levers of a cluster build: sockets filled (cluster subgraph sockets included), reachable ones nearest first, flasks, anoint", async () => {
  const xml = await readFile(resolve(ROOT, "spec/TestBuilds/3.13/Mirage Archer Toxic Rain.xml"), "utf8");
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).build.id;
  const l = await levers(id);
  assert.deepEqual(l.jewelSockets.allocated.map((s) => s.kind), ["medium cluster", "medium cluster", "large cluster", "large cluster", "medium cluster", "basic", "medium cluster"]);
  assert.deepEqual([l.jewelSockets.empty, l.jewelSockets.reachable.length, l.jewelSockets.reachable[0]?.points, l.clusterJewels.length], [0, 18, 2, 6]);
  const points = l.jewelSockets.reachable.map((s) => s.points);
  assert.deepEqual(points, [...points].sort((a, b) => a - b), "nearest first");
  assert.deepEqual(l.flasks.map((f) => [f.slot, f.active]), [["Flask 1", true], ["Flask 2", true], ["Flask 3", true], ["Flask 4", false], ["Flask 5", false]]);
  assert.deepEqual(l.anoints.map((a) => [a.slot, a.allocates]), [["Amulet", ["Corruption"]]]);
  assert.deepEqual(l.unused, ["18 unallocated jewel sockets are reachable, the nearest 2 points away", "Flask 4 (The Writhing Jar, Hallowed Hybrid Flask) is not active", "Flask 5 is empty", "no tattoo"]);
});

void test("levers of a new build, then a mastery, a tattoo and a config option pulled", async () => {
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" })).build.id;
  const l = await levers(id);
  assert.deepEqual([l.jewelSockets.allocated, l.clusterJewels, l.anoints, l.tattoos, l.masteries, l.config], [[], [], [], [], { allocated: 0, selected: 0, unselected: [] }, { count: 0, values: {} }]);
  assert.deepEqual(l.unused, [
    `${l.jewelSockets.reachable.length} unallocated jewel sockets are reachable, the nearest 8 points away`,
    "no cluster jewel", "Flask 1 is empty", "Flask 2 is empty", "Flask 3 is empty", "Flask 4 is empty", "Flask 5 is empty", "no tattoo", "no config option set",
  ]);
  ok(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: ["Arcane Potency", 37671] }));
  ok(await srv.call("POST", `/v1/tree/${id}/set-mastery`, { nodeId: 16123, effectId: 61534 }));
  ok(await srv.call("POST", `/v1/tree/${id}/tattoo`, { node: 37671, tattoo: "valako stormrider" }));
  ok(await srv.call("POST", `/v1/config/${id}/set`, { values: { buffOnslaught: true } }));
  const p = await levers(id);
  assert.deepEqual([p.masteries, p.tattoos.map((t) => [t.nodeId, t.name]), p.config], [{ allocated: 1, selected: 1, unselected: [] }, [[37671, "Tattoo of the Valako Stormrider"]], { count: 1, values: { buffOnslaught: true } }]);
  assert.ok(!p.unused.includes("no tattoo") && !p.unused.includes("no config option set"));
});
