// Worker tests for node_power at the damage over time cap, on a 3.13 Toxic Rain build. Its own file: each node_power
// call on this build takes several seconds, and a file's tests share the 60 s cap.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FIXTURES, startServer, type TestServer } from "./helpers.js";

type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type NodePower = { id: number; name: string; type: string; allocated: boolean; pathDist: number; power: number; pathPower?: number; perPoint?: number; defence?: number };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const ev = async <T>(id: string, action: string, body: Record<string, unknown>) => ok(await srv.call<T>("POST", `/v1/evaluate/${id}/${action}`, body));

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("node_power at the damage over time cap names the capped keys; a per-type DoT key still ranks", async () => {
  const xml = await readFile(join(FIXTURES, "../../../../spec/TestBuilds/3.13/Mirage Archer Toxic Rain.xml"), "utf8");
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).build.id;
  // depth 1: the nodes next to the tree are enough to show the cap; each depth step costs seconds on this build
  const below = await ev<{ dotCap?: unknown }>(id, "node-power", { stat: "TotalDotDPS", depth: 1, limit: 3 });
  assert.equal(below.dotCap, undefined, "below the cap nothing is named");
  ok(await srv.call("POST", `/v1/items/${id}/add`, { text: "Rarity: RARE\nCap Ring\nAmethyst Ring\n+90000% to Damage over Time Multiplier", equip: "Ring 2" }));
  type Capped = { dotCap?: { cap: number; at: string[]; uncapped: string[] }; nodes: NodePower[] };
  const capped = await ev<Capped>(id, "node-power", { stat: "TotalDotDPS", depth: 1, limit: 3 });
  assert.deepEqual(capped.dotCap, { cap: 35791394, at: ["TotalDot", "TotalDotDPS"], uncapped: ["ChaosDot"] });
  assert.ok(capped.nodes.every((n) => n.power === 0), "the capped stat measures nothing");
  const chaos = await ev<Capped>(id, "node-power", { stat: "ChaosDot", depth: 1, limit: 3 });
  assert.ok((chaos.nodes[0]?.power ?? 0) > 0, "ChaosDot still ranks");
  const whatIf = await ev<Capped>(id, "what-if", { addNodes: [chaos.nodes[0]?.id], fields: ["ChaosDot"] });
  assert.deepEqual(whatIf.dotCap?.at, ["TotalDot", "TotalDotDPS"]);
});
