// Worker tests against the real Path of Building engine: build code round trips, build id in the path, no-op edits, health, rate limit and MCP.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { decodeBuildCode } from "../src/fetch.js";
import { FIXTURES, ROOT, startServer, TOKEN, type TestServer } from "./helpers.js";

type Stat = { stat: string; value: number; text: string };
type Created = { build: { id: string; revision: number }; summary: { className: string; ascendancy?: string; level: number; treeVersion: string; mainSkill?: string } };

let srv: TestServer;
let occ: string; // spec/TestBuilds/3.13/OccVortex.xml
let fresh: string; // fixture made on tree 3_30

const statOf = (stats: Stat[], key: string) => stats.find((s) => s.stat === key)?.value;
const ok = <T>(r: { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } }) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};

before(async () => {
  srv = await startServer();
  const [occXml, freshXml] = await Promise.all([
    readFile(join(ROOT, "spec/TestBuilds/3.13/OccVortex.xml"), "utf8"),
    readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8"),
  ]);
  const [a, b] = await Promise.all([
    srv.call<Created>("POST", "/v1/builds/import/xml", { xml: occXml, name: "OccVortex" }),
    srv.call<Created>("POST", "/v1/builds/import/xml", { xml: freshXml }),
  ]);
  occ = ok(a).build.id;
  fresh = ok(b).build.id;
});

after(async () => {
  await srv?.close();
});

void test("a build code round-trips byte-exact", async () => {
  const c1 = ok(await srv.call<{ code: string }>("GET", `/v1/builds/${fresh}/code`)).code;
  const xml = ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${fresh}/xml`)).xml;
  assert.equal(decodeBuildCode(c1, 5_000_000), xml, "the code decodes to the stored XML");
  const copy = ok(await srv.call<Created>("POST", "/v1/builds/import/code", { code: c1 }));
  const c2 = ok(await srv.call<{ code: string }>("GET", `/v1/builds/${copy.build.id}/code`)).code;
  assert.equal(c2, c1);
  ok(await srv.call("DELETE", `/v1/builds/${copy.build.id}`));
});

void test("a legacy build's code is byte-stable from its second save on", async () => {
  // Upstream's first save of a build with no includeInFullDPS attribute writes "nil" (SkillsTab.lua:448
  // and :591); loading that reads false, so one save normalises it and every later trip is exact.
  const codes: string[] = [];
  let id = occ;
  const made: string[] = [];
  for (let i = 0; i < 3; i++) {
    codes.push(ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code);
    id = ok(await srv.call<Created>("POST", "/v1/builds/import/code", { code: codes[i] })).build.id;
    made.push(id);
  }
  const stored = ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${occ}/xml`)).xml;
  assert.ok(stored.includes('includeInFullDPS="nil"'), "the first save carries upstream's nil");
  assert.equal(codes[2], codes[1]);
  for (const m of made) ok(await srv.call("DELETE", `/v1/builds/${m}`));
});

void test("an edit that changes nothing writes no revision and adds no history entry", async () => {
  const freshXml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const id = ok(await srv.call<Created>("POST", "/v1/builds/import/xml", { xml: freshXml, name: "no-op" })).build.id;
  const state = async () => ({ revision: ok(await srv.call<Created>("GET", `/v1/builds/${id}`)).build.revision, history: ok(await srv.call<{ history: unknown[] }>("GET", `/v1/builds/${id}/history`)).history.length });
  const first = ok(await srv.call<{ revision: number }>("POST", `/v1/config/${id}/set-notes`, { text: "a note" }));
  const afterFirst = await state();
  assert.equal(first.revision, afterFirst.revision, "a real change is a revision");
  const again = ok(await srv.call<{ revision: number }>("POST", `/v1/config/${id}/set-notes`, { text: "a note" }));
  assert.equal(again.revision, afterFirst.revision, "the same notes again answer the current revision");
  assert.deepEqual(await state(), afterFirst, "revision and history length are unchanged");
  assert.ok(afterFirst.revision > 1 && afterFirst.history >= 2);
});

void test("MCP over HTTP: list tools, read a loaded build's stats, failures are isError", async () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.port}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["pob_build", "pob_config", "pob_evaluate", "pob_items", "pob_lookup", "pob_skills", "pob_stats", "pob_trade", "pob_tree"]);
    assert.equal(tools.find((t) => t.name === "pob_stats")?.annotations?.readOnlyHint, true);
    const res = await client.callTool({ name: "pob_stats", arguments: { action: "sidebar", id: fresh } });
    assert.ok(!res.isError);
    const body = res.structuredContent as { ok: boolean; result: { stats: Stat[] } };
    assert.equal(statOf(body.result.stats, "Life"), 1328);
    const fail = await client.callTool({ name: "pob_stats", arguments: { action: "breakdown", id: fresh } });
    assert.equal(fail.isError, true);
    assert.equal((fail.structuredContent as { error: { code: string } }).error.code, "invalid_input");
    // A stale write carries the build's current revision, as the HTTP error does.
    const current = ok(await srv.call<Created>("GET", `/v1/builds/${fresh}`)).build.revision;
    const stale = await client.callTool({ name: "pob_tree", arguments: { action: "deallocate", id: fresh, nodes: [57264], baseRevision: current + 7 } });
    assert.equal(stale.isError, true);
    assert.deepEqual((stale.structuredContent as { error: { code: string; details?: unknown } }).error, { code: "stale_revision", message: `build ${fresh} is at revision ${current}, not ${current + 7}`, details: { revision: current } });
    const http = await srv.call("POST", `/v1/tree/${fresh}/deallocate`, { nodes: [57264], baseRevision: current + 7 });
    assert.deepEqual([http.status, (http.body.error as { details?: unknown }).details], [409, { revision: current }], "HTTP and MCP carry the same details");
    assert.equal(ok(await srv.call<Created>("GET", `/v1/builds/${fresh}`)).build.revision, current, "the stale write stored nothing");
  } finally {
    await client.close();
  }
});

