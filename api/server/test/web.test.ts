// What the browser view needs from the server: the static mount, cookie sessions, and saving a build code.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FIXTURES, startServer, tempDir, TOKEN, type TestServer } from "./helpers.js";

let srv: TestServer;
let base: string;
let web: { path: string; remove: () => Promise<void> };

before(async () => {
  web = await tempDir("web");
  await mkdir(join(web.path, "assets"), { recursive: true });
  await mkdir(join(web.path, "pob"), { recursive: true });
  await writeFile(join(web.path, "index.html"), "<!doctype html><title>pob</title>");
  await writeFile(join(web.path, "assets", "app.js"), "export {};");
  await writeFile(join(web.path, "pob", "engine.wasm"), Buffer.from([0, 97, 115, 109]));
  await writeFile(join(web.path, "manifest.json"), "{}");
  srv = await startServer({ webDir: web.path });
  base = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  await srv?.close();
  await web?.remove();
});

void test("the built page is served at / with isolation headers, exact types and cache rules; nothing else falls back to it", async () => {
  const isolated = (r: Response) => [r.headers.get("cross-origin-opener-policy"), r.headers.get("cross-origin-embedder-policy"), r.headers.get("cross-origin-resource-policy"), r.headers.get("x-content-type-options")];
  assert.equal((await fetch(`${base}/`)).headers.get("content-security-policy"), "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.equal(await index.text(), "<!doctype html><title>pob</title>");
  assert.deepEqual(isolated(index), ["same-origin", "require-corp", "same-origin", "nosniff"]);
  assert.deepEqual([index.headers.get("content-type"), index.headers.get("cache-control")], ["text/html; charset=utf-8", "no-cache"]);
  const js = await fetch(`${base}/assets/app.js`);
  assert.deepEqual([js.status, js.headers.get("content-type"), js.headers.get("cache-control")], [200, "text/javascript", "public, max-age=31536000, immutable"]);
  const wasm = await fetch(`${base}/pob/engine.wasm`, { method: "HEAD" });
  assert.deepEqual([wasm.status, wasm.headers.get("content-type"), wasm.headers.get("cache-control")], [200, "application/wasm", "public, max-age=31536000, immutable"]);
  assert.deepEqual(isolated(wasm), ["same-origin", "require-corp", "same-origin", "nosniff"]);
  const json = await fetch(`${base}/manifest.json`);
  assert.deepEqual([json.headers.get("content-type"), json.headers.get("cache-control")], ["application/json", "no-cache"]);
  for (const path of ["/nope", "/assets/", "/assets", "/builds/abc", "/x?build=1"]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 404, path);
    await r.body?.cancel();
  }
  assert.equal((await fetch(`${base}/?build=0123456789abcdef`)).status, 200, "the page's own query string");
  assert.equal((await fetch(`${base}/index.html`, { method: "POST" })).status, 404);
  assert.equal((await fetch(`${base}/v1/nope`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 404, "/v1 keeps its JSON 404");

  const bare = await startServer({ webDir: join(web.path, "missing") });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${bare.port}/`)).status, 404);
    assert.ok(bare.lines.some((l) => l.event === "web.not_mounted"));
  } finally {
    await bare.close();
  }
});

void test("a session cookie from POST /v1/session authenticates /v1 (events too) but not /mcp; changes need the page's own origin", async () => {
  assert.equal((await fetch(`${base}/v1/session`, { method: "POST" })).status, 401);
  const made = await fetch(`${base}/v1/session`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(made.status, 204);
  const set = made.headers.get("set-cookie") ?? "";
  assert.match(set, /^pob_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000$/);
  const jar = set.split(";")[0] ?? "";
  const secure = await fetch(`${base}/v1/session`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "x-forwarded-proto": "https" } });
  assert.match(secure.headers.get("set-cookie") ?? "", /; Secure$/, "Secure behind a TLS proxy on this host");

  const list = await fetch(`${base}/v1/builds`, { headers: { cookie: jar } });
  assert.equal(list.status, 200);
  const create = (headers: Record<string, string>) => fetch(`${base}/v1/builds`, { method: "POST", headers: { cookie: jar, "content-type": "application/json", ...headers }, body: JSON.stringify({ name: "from the page" }) });
  const noOrigin = await create({});
  assert.deepEqual([noOrigin.status, ((await noOrigin.json()) as { error: { code: string } }).error.code], [403, "forbidden"]);
  assert.equal((await create({ origin: "https://elsewhere.example" })).status, 403);
  const made2 = await create({ origin: base });
  assert.equal(made2.status, 200);
  const id = ((await made2.json()) as { result: { build: { id: string } } }).result.build.id;
  const ac = new AbortController();
  const events = await fetch(`${base}/v1/builds/${id}/events`, { headers: { cookie: jar }, signal: ac.signal });
  assert.equal(events.status, 200);
  ac.abort();
  const mcp = await fetch(`${base}/mcp`, { method: "POST", headers: { cookie: jar, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(mcp.status, 401, "MCP takes only the bearer token");

  const out = await fetch(`${base}/v1/session`, { method: "DELETE", headers: { cookie: jar, origin: base } });
  assert.equal(out.status, 204);
  assert.match(out.headers.get("set-cookie") ?? "", /^pob_session=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/);
  assert.equal((await fetch(`${base}/v1/builds`, { headers: { cookie: jar } })).status, 401, "the session is gone");
  assert.equal((await fetch(`${base}/v1/builds`, { headers: { cookie: "pob_session=forged" } })).status, 401);

  // Behind a TLS proxy with POB_PUBLIC_ORIGIN set: a __Host- cookie, always Secure, and only that origin may change things.
  const pub = await startServer({ publicOrigin: "https://pob.example" });
  try {
    const at = `http://127.0.0.1:${pub.port}`;
    const signed = await fetch(`${at}/v1/session`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
    const hostCookie = signed.headers.get("set-cookie") ?? "";
    assert.match(hostCookie, /^__Host-pob_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
    const jar2 = hostCookie.split(";")[0] ?? "";
    assert.equal((await fetch(`${at}/v1/builds`, { headers: { cookie: jar2.replace("__Host-", "") } })).status, 401, "the plain name is not read");
    const change = (origin: string) => fetch(`${at}/v1/builds`, { method: "POST", headers: { cookie: jar2, origin, "content-type": "application/json" }, body: "{}" });
    assert.equal((await change(at)).status, 403, "the address it was reached at is not the public origin");
    assert.equal((await change("https://pob.example")).status, 200);
  } finally {
    await pub.close();
  }
});

void test("PUT /v1/builds/:id/code replaces the content, keeps id and name, moves the revision, emits replace", async () => {
  const created = await srv.call<{ build: { id: string; revision: number } }>("POST", "/v1/builds", { name: "Kept name" });
  const id = created.body.result.build.id;
  const other = await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml: await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8") });
  const code = (await srv.call<{ code: string }>("GET", `/v1/builds/${other.body.result.build.id}/code`)).body.result.code;
  const stale = await srv.call("PUT", `/v1/builds/${id}/code`, { code, baseRevision: 2 });
  assert.deepEqual([stale.status, stale.body.error?.code], [409, "stale_revision"]);
  assert.deepEqual([(await srv.call("PUT", `/v1/builds/${id}/code`, { code })).status], [400], "baseRevision is required");
  const bad = await srv.call("PUT", `/v1/builds/${id}/code`, { code: "not-a-code!", baseRevision: 1 });
  assert.deepEqual([bad.status, bad.body.error?.code], [400, "invalid_input"]);
  const put = await srv.call<{ build: { id: string; name: string; revision: number }; changed: Record<string, { before: number | null; after: number | null }> }>("PUT", `/v1/builds/${id}/code`, { code, baseRevision: 1 });
  assert.equal(put.status, 200, JSON.stringify(put.body.error));
  assert.deepEqual([put.body.result.build.id, put.body.result.build.name, put.body.result.build.revision], [id, "Kept name", 2]);
  assert.equal(put.body.result.changed.Life?.after, 1328);
  const side = await srv.call<{ stats: Array<{ stat: string; value: number }> }>("GET", `/v1/stats/${id}/sidebar`);
  assert.equal(side.body.result.stats.find((s) => s.stat === "Life")?.value, 1328);
  const hist = await srv.call<{ history: Array<{ cause: string }> }>("GET", `/v1/builds/${id}/history`);
  assert.equal(hist.body.result.history[0]?.cause, "replace");
  const summary = await srv.call<{ summary: { className: string; ascendancy: string } }>("GET", `/v1/builds/${id}`);
  assert.deepEqual([summary.body.result.summary.className, summary.body.result.summary.ascendancy], ["Witch", "Elementalist"]);
});
