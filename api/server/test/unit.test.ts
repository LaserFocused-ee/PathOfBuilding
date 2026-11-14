// Unit tests: config, auth compare, build-code decoding, the fetch allowlist, the store, API.md drift.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { loadConfig } from "../src/config.js";
import { ApiError, isErrorCode } from "../src/errors.js";
import { decodeBuildCode, Fetcher } from "../src/fetch.js";
import { apiDoc, readmeWithRoutes } from "../src/gen-api-doc.js";
import { FailureWindow, secretMatches } from "../src/http.js";
import { toolDefs } from "../src/mcp.js";
import { parseInput, routes } from "../src/routes.js";
import { openRuntime, startTime } from "../src/runtime.js";
import { BuildStore, TRASH_DAYS } from "../src/store.js";
import { memoryLogger, ROOT, tempDir, testConfig, TOKEN } from "./helpers.js";

const code = (xml: string) => deflateSync(Buffer.from(xml)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const rejects = (code: string) => (e: unknown) => e instanceof ApiError && e.code === code;

void test("config: requires a 32+ character token, treats empty strings as unset, applies defaults", () => {
  assert.throws(() => loadConfig({}), /POB_API_TOKEN/);
  assert.throws(() => loadConfig({ POB_API_TOKEN: "short" }), /at least 32/);
  const cfg = loadConfig({ POB_API_TOKEN: TOKEN, SENTRY_DSN: "", HOME: "/srv/user" });
  assert.equal(cfg.host, "127.0.0.1");
  assert.equal(cfg.port, 8730);
  assert.equal(cfg.sentryDsn, undefined);
  assert.equal(cfg.historyKeep, 50);
  assert.equal(cfg.dataDir, "/srv/user/.local/share/pob-api");
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

void test("store: a build deleted while the list is read is left out", async (t) => {
  const dir = await tempDir("store-race");
  t.after(dir.remove);
  const store = new BuildStore(dir.path, 5);
  await store.init();
  const a = await store.create("a", "<PathOfBuilding/>", { kind: "new" });
  const b = await store.create("b", "<PathOfBuilding/>", { kind: "new" });
  const get = store.get.bind(store);
  store.get = (id: string) => (id === a.id ? Promise.reject(new ApiError("not_found", `no build ${id}`)) : get(id));
  assert.deepEqual((await store.list()).map((m) => m.id), [b.id]);
});

void test("store: delete is recoverable for 7 days, then purged with its history", async (t) => {
  const dir = await tempDir("trash");
  t.after(dir.remove);
  const store = new BuildStore(dir.path, 3);
  await store.init();
  const a = await store.create("A", "<x>1</x>", { kind: "xml" });
  await store.update(a.id, { xml: "<x>2</x>", cause: "edit" });
  await assert.rejects(store.delete(a.id, 1), rejects("stale_revision"));
  await store.delete(a.id, 2);
  await assert.rejects(store.get(a.id), rejects("not_found"));
  const trash = await store.listTrash();
  assert.deepEqual(trash.map((m) => [m.id, m.revision]), [[a.id, 2]]);
  assert.equal(Date.parse(trash[0]?.purgeAfter ?? "") - Date.parse(trash[0]?.deletedAt ?? ""), TRASH_DAYS * 86_400_000);
  const restored = await store.restore(a.id);
  assert.equal(restored.revision, 2);
  assert.deepEqual([await store.xml(a.id), await store.xml(a.id, 1)], ["<x>2</x>", "<x>1</x>"]);
  assert.deepEqual(await store.listTrash(), []);
  await store.delete(a.id);
  const now = Date.now();
  assert.deepEqual(await store.purgeTrash(now + 6 * 86_400_000), [], "kept inside the window");
  assert.deepEqual(await store.purgeTrash(now + 8 * 86_400_000), [a.id]);
  assert.deepEqual(await store.listTrash(), []);
  await assert.rejects(store.restore(a.id), rejects("not_found"));
  await assert.rejects(store.restore("../../builds/x"), rejects("not_found"));
});

void test("failed credential window: limit inside a minute, then clear", () => {
  const w = new FailureWindow(3, 60_000);
  assert.equal(w.retryAfterSeconds(0), 0);
  assert.deepEqual([w.add(0), w.add(1_000), w.add(2_000)], [false, false, true]);
  assert.equal(w.retryAfterSeconds(2_000), 58);
  assert.equal(w.retryAfterSeconds(59_999), 1);
  assert.equal(w.retryAfterSeconds(60_000), 0, "the oldest failure left the window");
});

void test("mcp: tools come from the route table with accurate read-only hints", () => {
  const defs = toolDefs();
  assert.deepEqual(defs.map((d) => d.name), ["pob_build", "pob_stats", "pob_tree", "pob_config", "pob_lookup"]);
  assert.equal(defs.find((d) => d.name === "pob_build")?.readOnly, false);
  assert.equal(defs.find((d) => d.name === "pob_stats")?.readOnly, true);
  assert.ok(!defs.some((d) => d.routes.some((r) => r.stream)), "the event stream is not an MCP action");
});

void test("mcp: a parameter shared by several actions accepts what each of them accepts; each action still checks its own", () => {
  const lookup = toolDefs().find((d) => d.name === "pob_lookup");
  assert.ok(lookup);
  const long = "x".repeat(150); // nodes takes up to 200 characters, gems up to 100
  assert.ok(lookup.input.safeParse({ action: "nodes", query: long }).success);
  const nodes = routes.find((r) => r.name === "lookup.nodes");
  const gems = routes.find((r) => r.name === "lookup.gems");
  assert.ok(nodes && gems);
  assert.equal(parseInput(nodes, { query: long }).query, long);
  assert.throws(() => parseInput(gems, { query: long }), rejects("invalid_input"));
  assert.throws(() => parseInput(gems, { q: "Pact" }), (e) => e instanceof ApiError && e.code === "invalid_input" && e.message.includes("unknown parameter q") && e.message.includes("query"));
  for (const d of toolDefs()) {
    for (const r of d.routes) {
      for (const k of Object.keys(r.input.shape)) assert.ok(k in d.input.shape, `${d.name} lists ${r.name}'s ${k}`);
    }
  }
});

void test("docs/API.md and the README route list are generated from the route table and up to date", async () => {
  assert.equal(await readFile(join(ROOT, "api/docs/API.md"), "utf8"), apiDoc(), "run `npm run docs` in api/server");
  const readme = await readFile(join(ROOT, "api/README.md"), "utf8");
  assert.equal(readme, readmeWithRoutes(readme), "run `npm run docs` in api/server");
});

void test("data directory lock: stale when it names this process, a reused pid or a dead one; held by a live one; old worker state removed", async (t) => {
  const dir = await tempDir("lock");
  t.after(dir.remove);
  const cfg = testConfig(dir.path);
  const { log } = memoryLogger();
  const lockFile = join(dir.path, "server.lock");
  const old = join(dir.path, "worker-state", "w-old");
  await mkdir(old, { recursive: true });
  await writeFile(lockFile, `${process.pid} 1`); // this process (pid 1 in a container after an unclean stop)
  let rt = await openRuntime(cfg, log);
  assert.equal(existsSync(old), false, "earlier workers' state is removed");
  assert.equal(await readFile(lockFile, "utf8"), `${process.pid} ${await startTime(process.pid)}`);
  await rt.close();
  await writeFile(lockFile, `${process.ppid} 1`); // a live process that started at another time: the pid was reused
  rt = await openRuntime(cfg, log);
  await rt.close();
  await writeFile(lockFile, "999999999 1"); // gone
  rt = await openRuntime(cfg, log);
  await rt.close();
  await writeFile(lockFile, `${process.ppid} ${await startTime(process.ppid)}`);
  await assert.rejects(openRuntime(cfg, log), /in use by process/);
});

void test("every error code the Lua worker raises is a registered code", async () => {
  const dir = join(ROOT, "api/lua");
  const files = [join(dir, "worker.lua"), ...(await readdir(join(dir, "ops"))).filter((f) => f.endsWith(".lua")).map((f) => join(dir, "ops", f))];
  const codes = new Set<string>();
  for (const f of files) {
    for (const m of (await readFile(f, "utf8")).matchAll(/W\.fail\("([^"]+)"|code = "([^"]+)"/g)) codes.add(m[1] ?? m[2] ?? "");
  }
  assert.ok(codes.size >= 4, [...codes].join(","));
  assert.deepEqual([...codes].filter((c) => !isErrorCode(c)), []);
});
