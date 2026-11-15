// Worker tests for tree.allocate with ascendancy "switch" (the tree click's switch to another ascendancy, bloodline or class), on tree 3_30.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { routes } from "../src/routes.js";
import { startServer, type TestServer } from "./helpers.js";

type Allocated = { allocated: number[]; className: string; ascendancy?: string; bloodline?: string };
type Mutated = { result: Allocated; changed: Record<string, unknown>; revision: number };
type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Tree = { className: string; ascendancy?: string; bloodline?: string; points: number; nodes: Array<{ id: number; name: string }> };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => {
  assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);
  return r.body.error?.message ?? "";
};

/** A new level 90 Witch / Elementalist on tree 3_30. */
async function newWitch(): Promise<string> {
  const r = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" }));
  return r.build.id;
}
const tree = async (id: string) => ok(await srv.call<Tree>("GET", `/v1/tree/${id}/get`));
const revisionOf = async (id: string) => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
const hasNode = (t: Tree, name: string) => t.nodes.some((n) => n.name === name);
const allocate = async (id: string, body: Record<string, unknown>) => {
  const r = await srv.call<Mutated>("POST", `/v1/tree/${id}/allocate`, body);
  if (r.status === 200) {
    const parsed = routes.find((x) => x.name === "tree.allocate")?.output.safeParse(r.body.result);
    assert.ok(parsed?.success, JSON.stringify(parsed?.error));
  }
  return r;
};
const witchWithPotency = async () => {
  const id = await newWitch();
  ok(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: ["Arcane Potency"] }));
  return id;
};

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("tree.allocate: ascendancy switch to another ascendancy of the class", async () => {
  const id = await newWitch();
  ok(await srv.call("POST", `/v1/tree/${id}/allocate`, { nodes: ["Shaper of Storms"] }));
  assert.ok(hasNode(await tree(id), "Shaper of Storms"));
  const r = ok(await allocate(id, { nodes: ["Commander of Darkness"], ascendancy: "switch" })).result;
  assert.deepEqual([r.className, r.ascendancy, r.bloodline], ["Witch", "Necromancer", undefined]);
  const t = await tree(id);
  assert.deepEqual([t.className, t.ascendancy, t.bloodline], ["Witch", "Necromancer", undefined]);
  assert.ok(hasNode(t, "Commander of Darkness"));
  assert.ok(!t.nodes.some((n) => ["Shaper of Storms", "Bringer of Ruin"].includes(n.name)));
});

void test("tree.allocate: ascendancy switch to a bloodline", async () => {
  const id = await newWitch();
  const r = ok(await allocate(id, { nodes: ["The Wild Bear"], ascendancy: "switch" })).result;
  assert.deepEqual([r.className, r.ascendancy, r.bloodline], ["Witch", "Elementalist", "Oshabi Bloodline"]);
  const t = await tree(id);
  assert.deepEqual([t.className, t.ascendancy, t.bloodline], ["Witch", "Elementalist", "Oshabi Bloodline"]);
  assert.ok(hasNode(t, "The Wild Bear"));
});

void test("tree.allocate: ascendancy switch to another class's ascendancy on an empty tree", async () => {
  const id = await newWitch();
  assert.equal((await tree(id)).points, 0);
  const r = ok(await allocate(id, { nodes: ["Unflinching"], ascendancy: "switch" })).result;
  assert.deepEqual([r.className, r.ascendancy], ["Marauder", "Juggernaut"]);
  const t = await tree(id);
  assert.deepEqual([t.className, t.ascendancy], ["Marauder", "Juggernaut"]);
  assert.ok(hasNode(t, "Unflinching"));
});

void test("tree.allocate: another class's ascendancy on a tree not connected to that class", async () => {
  const id = await witchWithPotency();
  const before = await tree(id);
  assert.equal(before.points, 13);
  const revision = await revisionOf(id);

  const message = fails(await allocate(id, { nodes: ["Unflinching"], ascendancy: "switch", onDisconnected: "fail" }), 400, "invalid_input");
  assert.match(message, /Marauder/);
  assert.match(message, /reset or connect/);
  assert.deepEqual(await tree(id), before);
  assert.equal(await revisionOf(id), revision);

  const copy = await witchWithPotency();
  const reset = ok(await allocate(copy, { nodes: ["Unflinching"], ascendancy: "switch", onDisconnected: "reset" })).result;
  assert.deepEqual([reset.className, reset.ascendancy], ["Marauder", "Juggernaut"]);
  const t = await tree(copy);
  assert.ok(hasNode(t, "Unflinching") && !hasNode(t, "Arcane Potency"));
  assert.equal(t.points, 0);

  const joined = await witchWithPotency();
  const connect = ok(await allocate(joined, { nodes: ["Unflinching"], ascendancy: "switch", onDisconnected: "connect" })).result;
  assert.deepEqual([connect.className, connect.ascendancy], ["Marauder", "Juggernaut"]);
  const c = await tree(joined);
  assert.ok(hasNode(c, "Unflinching") && hasNode(c, "Arcane Potency"));
  assert.equal(c.points, 27);
});

void test("tree.allocate: without ascendancy switch another ascendancy's node is refused", async () => {
  const id = await newWitch();
  const before = await tree(id);
  const message = fails(await allocate(id, { nodes: ["Commander of Darkness"] }), 400, "invalid_input");
  assert.match(message, /switch/);
  assert.deepEqual(await tree(id), before);
  fails(await allocate(id, { nodes: ["Commander of Darkness"], ascendancy: "bogus" }), 400, "invalid_input");
});
