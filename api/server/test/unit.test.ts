// Unit tests: config, auth compare, build-code decoding, the fetch allowlist, the store, API.md drift.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { loadConfig } from "../src/config.js";
import { ApiError } from "../src/errors.js";
import { decodeBuildCode, Fetcher } from "../src/fetch.js";
import { apiDoc } from "../src/gen-api-doc.js";
import { secretMatches } from "../src/http.js";
import { toolDefs } from "../src/mcp.js";
import { BuildStore } from "../src/store.js";
import { memoryLogger, ROOT, tempDir, TOKEN } from "./helpers.js";

const code = (xml: string) => deflateSync(Buffer.from(xml)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const rejects = (code: string) => (e: unknown) => e instanceof ApiError && e.code === code;

void test("config: requires a 32+ character token, treats empty strings as unset, applies defaults", () => {
  assert.throws(() => loadConfig({}), /POB_API_TOKEN/);
  assert.throws(() => loadConfig({ POB_API_TOKEN: "short" }), /at least 32/);
  const cfg = loadConfig({ POB_API_TOKEN: TOKEN, SENTRY_DSN: "", HOME: "/home/x" });
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.port, 8730);
  assert.equal(cfg.sentryDsn, undefined);
  assert.equal(cfg.historyKeep, 50);
  assert.equal(cfg.dataDir, "/home/x/.local/share/pob-api");
  assert.equal(cfg.runtimeDir, join(ROOT, "api/runtime/rt"));
  assert.throws(() => loadConfig({ POB_API_TOKEN: TOKEN, PORT: "abc" }), /PORT/);
});

void test("auth: secret compare matches only the exact token", () => {
  assert.equal(secretMatches(TOKEN, TOKEN), true);
  assert.equal(secretMatches(`${TOKEN}x`, TOKEN), false);
  assert.equal(secretMatches("", TOKEN), false);
  assert.equal(secretMatches(undefined, TOKEN), false);
});

void test("build code: decodes zlib base64url, refuses garbage and oversized output", () => {
  const xml = '<?xml version="1.0"?><PathOfBuilding><Build level="1"/></PathOfBuilding>';
  assert.equal(decodeBuildCode(code(xml), 1000), xml);
  assert.equal(decodeBuildCode(`  ${code(xml)}\n`, 1000), xml);
  assert.throws(() => decodeBuildCode("not a code!", 1000), rejects("invalid_input"));
  assert.throws(() => decodeBuildCode("AAAA", 1000), rejects("invalid_input"));
  // 10 MB of zeros deflates to ~10 KB: the cap stops inflation instead of allocating it.
  const bomb = deflateSync(Buffer.alloc(10_000_000)).toString("base64");
  assert.throws(() => decodeBuildCode(bomb, 5_000_000), rejects("payload_too_large"));
});

void test("fetch: only https on allowlisted hosts, redirects re-checked, size capped", async (t) => {
  const { log, lines } = memoryLogger();
  const f = new Fetcher({ fetchUserAgent: "test", fetchTimeoutMs: 1000, fetchMaxBytes: 10 }, log);
  await assert.rejects(f.text("http://pobb.in/x", "t"), rejects("invalid_input"));
  await assert.rejects(f.text("https://evil.example/x", "t"), rejects("invalid_input"));
  await assert.rejects(f.text("https://user:pw@pobb.in/x", "t"), rejects("invalid_input"));
  await assert.rejects(f.text("https://pobb.in:8443/x", "t"), rejects("invalid_input"));
  await assert.rejects(f.text("https://127.0.0.1/x", "t"), rejects("invalid_input"));

  const seen: string[] = [];
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  let next: () => Response = () => new Response("ok");
  globalThis.fetch = (input) => {
    seen.push(input instanceof Request ? input.url : input.toString());
    return Promise.resolve(next());
  };
  next = () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } });
  await assert.rejects(f.text("https://pobb.in/abc/raw", "t"), rejects("invalid_input"));
  assert.deepEqual(seen, ["https://pobb.in/abc/raw"]);
  next = () => new Response("0123456789abcdef");
  await assert.rejects(f.text("https://pobb.in/abc/raw", "t"), rejects("upstream_fetch_failed"));
  next = () => new Response("gone", { status: 404 });
  await assert.rejects(f.text("https://pobb.in/abc/raw", "t"), (e) => e instanceof ApiError && e.code === "upstream_fetch_failed" && !e.message.includes("gone"));
  next = () => new Response("short");
  assert.equal(await f.text("https://pobb.in/abc/raw", "t"), "short");
  assert.ok(lines.some((l) => l.event === "fetch.done" && l.host === "pobb.in" && l.status === 200));
});

void test("store: revisions, stale writes, history pruning keeps save points, ids checked before paths", async (t) => {
  const dir = await tempDir("store");
  t.after(dir.remove);
  const store = new BuildStore(dir.path, 3);
  await store.init();
  const a = await store.create("A", "<x>1</x>", { kind: "xml" });
  assert.match(a.id, /^[a-f0-9]{16}$/);
  await store.savePoint(a.id, "start");
  for (let i = 2; i <= 6; i++) await store.update(a.id, { xml: `<x>${i}</x>`, cause: "edit", baseRevision: i - 1 });
  const meta = await store.get(a.id);
  assert.equal(meta.revision, 6);
  assert.deepEqual(meta.history.map((h) => h.revision), [1, 4, 5, 6]);
  assert.equal(await store.xml(a.id), "<x>6</x>");
  assert.equal(await store.xml(a.id, 1), "<x>1</x>");
  await assert.rejects(store.xml(a.id, 2), rejects("not_found"));
  await assert.rejects(store.update(a.id, { name: "B", cause: "rename", baseRevision: 5 }), rejects("stale_revision"));
  await assert.rejects(store.get("../../etc/passwd"), rejects("not_found"));
  await assert.rejects(store.get("ABCDEF0123456789"), rejects("not_found"));
  await store.delete(a.id, 6);
  await assert.rejects(store.get(a.id), rejects("not_found"));
  assert.deepEqual(await store.list(), []);
});

void test("mcp: tools come from the route table with accurate read-only hints", () => {
  const defs = toolDefs();
  assert.deepEqual(defs.map((d) => d.name), ["pob_build", "pob_stats", "pob_lookup"]);
  assert.equal(defs.find((d) => d.name === "pob_build")?.readOnly, false);
  assert.equal(defs.find((d) => d.name === "pob_stats")?.readOnly, true);
  assert.ok(!defs.some((d) => d.routes.some((r) => r.stream)), "the event stream is not an MCP action");
});

void test("docs/API.md is generated from the route table and up to date", async () => {
  assert.equal(await readFile(join(ROOT, "api/docs/API.md"), "utf8"), apiDoc(), "run `npm run docs` in api/server");
});
