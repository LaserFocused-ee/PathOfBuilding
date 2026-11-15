// Walks over the route table against the real engine: authentication, unknown parameters, read-only routes and their declared outputs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { routes } from "../src/routes.js";
import { FIXTURES, ROOT, startServer, TOKEN, type TestServer } from "./helpers.js";

type Created = { build: { id: string; revision: number }; summary: { className: string; ascendancy?: string; level: number; treeVersion: string; mainSkill?: string } };

let srv: TestServer;
let occ: string; // spec/TestBuilds/3.13/OccVortex.xml
let fresh: string; // fixture made on tree 3_30

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

void test("every route in the table refuses a request without the bearer token", async () => {
  const base = `http://127.0.0.1:${srv.port}`;
  for (const r of routes) {
    const path = r.path.replace(":id", fresh).replace(":nodeId", "1");
    for (const auth of [undefined, `Bearer ${TOKEN}x`, TOKEN]) {
      const res = await fetch(base + path, { method: r.method, headers: auth ? { authorization: auth } : {} });
      assert.equal(res.status, 401, `${r.method} ${r.path} with ${auth ? "a wrong" : "no"} token`);
      await res.body?.cancel();
    }
  }
  assert.ok(!srv.lines.some((l) => l.event === "http.request" && String(l.route).includes(fresh)), "refusals log the route pattern, not the path");
  assert.equal((await fetch(`${base}/v1/builds/${fresh}`, { headers: { authorization: `bearer ${TOKEN}` } })).status, 200, "the scheme is case-insensitive");
});

void test("lookups page with offset and limit; the whole config catalogue fits an MCP result in pages", async () => {
  type Page = { total: number; offset: number; gems?: Array<{ name: string }>; options?: Array<{ var: string }> };
  const p1 = ok(await srv.call<Page>("GET", "/v1/lookup/gems?query=Fire&limit=3"));
  const p2 = ok(await srv.call<Page>("GET", "/v1/lookup/gems?query=Fire&limit=3&offset=3"));
  const all = ok(await srv.call<Page>("GET", "/v1/lookup/gems?query=Fire&limit=6"));
  assert.equal(p2.offset, 3);
  assert.deepEqual([...(p1.gems ?? []), ...(p2.gems ?? [])].map((g) => g.name), (all.gems ?? []).map((g) => g.name));
  const c1 = ok(await srv.call<Page>("GET", "/v1/lookup/config"));
  assert.ok(c1.total > 100 && c1.options?.length === 100, `total ${c1.total}`);
  assert.ok(JSON.stringify(c1).length < srv.runtime.svc.cfg.mcpMaxResultChars, "a default page fits one MCP result");
  const seen = new Set<string>();
  for (let off = 0; off < c1.total; off += 100) {
    for (const o of ok(await srv.call<Page>("GET", `/v1/lookup/config?offset=${off}`)).options ?? []) seen.add(o.var);
  }
  assert.equal(seen.size, c1.total, "pages cover every option once");
});

void test("every route refuses an unknown parameter, naming the ones it takes", async () => {
  for (const r of routes) {
    const path = r.path.replace(":id", fresh).replace(":nodeId", "1");
    const res = r.method === "POST" || r.method === "PUT" ? await srv.call(r.method, path, { zzUnknown: 1 }) : await srv.call(r.method, `${path}?zzUnknown=1`);
    assert.deepEqual([res.status, res.body.error?.code], [400, "invalid_input"], `${r.method} ${r.path}`);
    assert.match(res.body.error?.message ?? "", /unknown parameter zzUnknown; .* takes /, r.name);
  }
  const gems = await srv.call("GET", "/v1/lookup/gems?q=Pact");
  assert.match(gems.body.error?.message ?? "", /unknown parameter q; lookup\.gems takes query, /);
});

// Query values for routes that need them, per build (OccVortex is on tree 3_13, before masteries).
const readParams = (id: string): Record<string, string> => ({ key: "Life", query: "Life", nodeId: id === fresh ? "16123" : "46842", to: "Arcane Potency", group: "1", item: "1", tab: "config", socket: "41263", node: "37671" });

/** Path and query for one read-only GET route on a build. */
const readUrl = (r: (typeof routes)[number], id: string): string => {
  const p = readParams(id);
  const shape = Object.keys(r.input.shape);
  const q = new URLSearchParams(Object.fromEntries(shape.filter((k) => k in p && !r.path.includes(`:${k}`) && (k !== "query" || r.name !== "lookup.config")).map((k) => [k, p[k] ?? ""])));
  if (r.domain === "lookup") q.set("buildId", id);
  const path = r.path.replace(":id", id).replace(":nodeId", p.nodeId ?? "");
  return `${path}${q.size ? `?${q}` : ""}`;
};

const readRoutes = () => routes.filter((r) => r.readOnly && r.method === "GET" && r.name !== "build.events" && (r.path.includes(":id") || r.domain === "lookup"));

void test("no read-only route changes the build: the session's code is the same before and after each", async () => {
  const reads = readRoutes();
  assert.ok(reads.length >= 24, `${reads.length} read routes walked`);
  for (const id of [occ, fresh]) {
    const before = ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code;
    for (const r of reads) {
      const res = await srv.call("GET", readUrl(r, id));
      if (!(id === occ && r.name === "tree.mastery_options") && !(id === fresh && r.name === "items.get")) assert.equal(res.status, 200, `${r.name} on ${id}: ${JSON.stringify(res.body.error)}`);
      const after = ok(await srv.call<{ code: string }>("GET", `/v1/builds/${id}/code`)).code;
      assert.equal(after, before, `${r.name} changed the build`);
    }
  }
});

void test("every read-only route's output matches its declared schema, and none is declared as unknown", async () => {
  for (const r of routes.filter((x) => !x.stream)) assert.ok(!["unknown", "any"].includes(r.output.def.type), `${r.name} declares no output shape`);
  // build.characters asks the game site, which a test must not.
  for (const r of routes.filter((x) => x.method === "GET" && x.readOnly && !x.stream && x.name !== "build.characters")) {
    const res = await srv.call("GET", readUrl(r, r.name === "items.get" ? occ : fresh)); // the fresh build has no items
    assert.equal(res.status, 200, `${r.name}: ${JSON.stringify(res.body.error)}`);
    const parsed = r.output.safeParse(res.body.result);
    assert.ok(parsed.success, `${r.name} output does not match its schema: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))}`);
  }
});


void test("the path's build id wins over an id in the body or the query: another build never moves", async () => {
  const freshXml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const mine = ok(await srv.call<Created>("POST", "/v1/builds/import/xml", { xml: freshXml, name: "path-owner" })).build.id;
  const other = ok(await srv.call<Created>("POST", "/v1/builds/import/xml", { xml: freshXml, name: "other-build" })).build.id;
  const revisionOf = async () => ok(await srv.call<Created>("GET", `/v1/builds/${other}`)).build.revision;
  const startRevision = await revisionOf();
  // Every route that changes a build and names it in the path. A route that needs more than the id
  // answers 400 and is not exercised here; those that take the id alone are, and the walk finds new ones.
  const writes = routes.filter((r) => r.path.includes(":id") && r.method !== "GET" && !r.stream);
  assert.ok(writes.length >= 80, `${writes.length} write routes walked`);
  const last = ["build.delete", "build.restore"]; // the build itself goes away: after the others
  const ordered = [...writes.filter((r) => !last.includes(r.name)), ...last.map((n) => writes.find((r) => r.name === n)).filter((r) => r !== undefined)];
  let accepted = 0;
  for (const r of ordered) {
    const path = r.path.replace(":id", mine).replace(":nodeId", "1");
    for (const how of ["body", "query"]) {
      const res = how === "body" && r.method !== "DELETE" ? await srv.call(r.method, path, { id: other }) : await srv.call(r.method, `${path}?id=${other}`, r.method === "DELETE" ? undefined : {});
      if (how === "query" && r.method !== "DELETE") assert.deepEqual([res.status, res.body.error?.code], [400, "invalid_input"], `${r.name}: a POST or PUT refuses a query string`);
      else if (res.status === 200) accepted++;
      else assert.ok(res.status === 400 || res.status === 404 || res.status === 409, `${r.name} by ${how}: ${res.status} ${JSON.stringify(res.body.error)}`);
      assert.equal(await revisionOf(), startRevision, `${r.name} with the other build's id in the ${how} moved that build`);
    }
  }
  assert.ok(accepted >= 14, `${accepted} calls reached the build (the rest were refused for missing parameters; a POST or PUT with a query string is refused above)`);
  assert.equal(ok(await srv.call<Created>("GET", `/v1/builds/${other}`)).build.id, other);
});
