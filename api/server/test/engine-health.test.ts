// Worker tests against the real Path of Building engine: deep health, its rate limit, and MCP over stdio (each starts its own server or process).
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ROOT, startServer, tempDir, TOKEN } from "./helpers.js";

void test("health/deep takes POB_HEALTH_TOKEN or the bearer token; failed checks are limited", async (t) => {
  const s = await startServer({ healthToken: "health-token-for-tests", poolSize: 1, authFailuresPerMinute: 3 });
  t.after(s.close);
  const url = `http://127.0.0.1:${s.port}/health/deep`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { "x-health-token": "wrong" } })).status, 401);
  const good = await fetch(url, { headers: { "x-health-token": "health-token-for-tests" } });
  assert.equal(good.status, 200);
  assert.ok(!JSON.stringify(await good.json()).includes("pid"), "health output names no process ids");
  assert.equal((await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 200);
  assert.equal((await s.call("GET", "/v1/builds", undefined, "wrong")).status, 401, "third failure");
  const limited = await s.call("GET", "/v1/builds", undefined, null);
  assert.deepEqual([limited.status, limited.body.error?.code], [429, "rate_limited"]);
  const again = await fetch(url, { headers: { "x-health-token": "wrong" } });
  assert.equal(again.status, 429);
  assert.ok(Number(again.headers.get("retry-after")) >= 1);
  assert.equal((await s.call("GET", "/v1/builds")).status, 200, "a valid token still passes");
  assert.equal((await fetch(url, { headers: { "x-health-token": "health-token-for-tests" } })).status, 200);
  assert.ok(s.lines.some((l) => l.event === "http.auth_limited"));
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/health`)).status, 200);
});

void test("MCP over stdio lists the same tools", async (t) => {
  const dir = await tempDir("stdio");
  t.after(dir.remove);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, "api/server/dist/src/stdio.js")], env: { POB_DATA_DIR: dir.path, HOME: dir.path, LOG_LEVEL: "warn" }, stderr: "ignore" }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["pob_build", "pob_config", "pob_evaluate", "pob_items", "pob_lookup", "pob_skills", "pob_stats", "pob_tree"]);
  } finally {
    await client.close();
  }
});
