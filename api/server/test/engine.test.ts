// Worker tests against the real Path of Building engine: loading builds, sessions, worker recovery, store operations, lookups, auth and log lines.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { LOOKUP_SESSION } from "../src/pool.js";
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

void test("fixture build (OccVortex, tree 3_13) loads with its real stats", async () => {
  const got = ok(await srv.call<Created>("GET", `/v1/builds/${occ}`));
  assert.deepEqual([got.summary.className, got.summary.ascendancy, got.summary.level, got.summary.treeVersion, got.summary.mainSkill], ["Witch", "Occultist", 99, "3_13", "Vortex"]);
  const side = ok(await srv.call<{ stats: Stat[] }>("GET", `/v1/stats/${occ}/sidebar`));
  assert.equal(Math.round(statOf(side.stats, "TotalDPS") ?? 0), 211560);
  assert.equal(side.stats.find((s) => s.stat === "TotalDPS")?.text, "211,560.5");
  const out = ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${occ}/output?fields=Life,FireResist,ChaosResist,Nope`));
  assert.deepEqual(out.output, { Life: 6728, FireResist: 75, ChaosResist: 68 });
  const pts = ok(await srv.call<{ used: number; max: number; ascendancyUsed: number; ascendancyMax: number; requiredLevel: number }>("GET", `/v1/stats/${occ}/points`));
  assert.deepEqual([pts.used, pts.max, pts.ascendancyUsed, pts.ascendancyMax, pts.requiredLevel], [122, 123, 8, 8, 99]);
  const def = ok(await srv.call<{ resistances: Record<string, Record<string, number>> }>("GET", `/v1/stats/${occ}/defences`));
  assert.deepEqual([def.resistances.Fire?.FireResist, def.resistances.Fire?.FireResistOverCap], [75, 9]);
  const bd = ok(await srv.call<{ value: number; breakdown: unknown }>("GET", `/v1/stats/${occ}/breakdown?key=Life`));
  assert.equal(bd.value, 6728);
  assert.ok(JSON.stringify(bd.breakdown).includes("2109 (base)"));
  const skills = ok(await srv.call<{ mainSocketGroup: number; groups: Array<{ index: number; mainSkill?: string; output?: { TotalDPS?: number } }> }>("GET", `/v1/stats/${occ}/skills`));
  const vortex = skills.groups.find((g) => g.index === skills.mainSocketGroup);
  assert.equal(vortex?.mainSkill, "Vortex");
  assert.equal(Math.round(vortex.output?.TotalDPS ?? 0), 211560);
  assert.ok(skills.groups.length > 1, "every socket group is reported");
});

void test("a build made on tree 3_30 loads in a second session with its real stats while the first stays open", async () => {
  const got = ok(await srv.call<Created>("GET", `/v1/builds/${fresh}`));
  assert.deepEqual([got.summary.className, got.summary.ascendancy, got.summary.level, got.summary.treeVersion, got.summary.mainSkill], ["Witch", "Elementalist", 90, "3_30", "Fireball"]);
  const side = ok(await srv.call<{ stats: Stat[] }>("GET", `/v1/stats/${fresh}/sidebar`));
  assert.equal(statOf(side.stats, "Life"), 1328);
  assert.equal(statOf(side.stats, "Mana"), 846);
  assert.equal(Math.round((statOf(side.stats, "TotalDPS") ?? 0) * 100), 583364);
  const w1 = srv.runtime.svc.pool.workerFor(occ);
  const w2 = srv.runtime.svc.pool.workerFor(fresh);
  assert.ok(w1?.alive && w2?.alive, "both sessions hold a live worker");
  assert.notEqual(w1.proc.pid, w2.proc.pid);
  const ver = ok(await srv.call<{ treeVersion: string; latestTreeVersion: string }>("GET", `/v1/stats/${fresh}/versions`));
  assert.equal(ver.latestTreeVersion, "3_30");
});

void test("new build defaults to the latest tree and applies class, ascendancy and level", async () => {
  const made = ok(await srv.call<Created>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90 }));
  assert.deepEqual([made.summary.className, made.summary.ascendancy, made.summary.level, made.summary.treeVersion], ["Witch", "Elementalist", 90, "3_30"]);
  const out = ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${made.build.id}/output?fields=Life,Mana`));
  assert.deepEqual(out.output, { Life: 1125, Mana: 590 });
  const bad = await srv.call("POST", "/v1/builds", { className: "Witch", ascendancy: "Juggernaut" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error?.code, "invalid_input");
  ok(await srv.call("DELETE", `/v1/builds/${made.build.id}`));
});

void test("killing a worker mid-session is recovered from the store", async () => {
  const pool = srv.runtime.svc.pool;
  ok(await srv.call("GET", `/v1/stats/${occ}/versions`)); // make sure the session is open
  const w = pool.workerFor(occ);
  assert.ok(w?.alive);
  const oldPid = w.proc.pid;
  const exited = new Promise<void>((r) => w.onExit(r));
  w.proc.kill("SIGKILL");
  await exited;
  const side = ok(await srv.call<{ stats: Stat[] }>("GET", `/v1/stats/${occ}/sidebar`));
  assert.equal(Math.round(statOf(side.stats, "TotalDPS") ?? 0), 211560);
  assert.notEqual(pool.workerFor(occ)?.proc.pid, oldPid);
});

void test("metadata ops: list, rename with stale check, save point, history, duplicate, delete", async () => {
  const list = ok(await srv.call<{ builds: Array<{ id: string }> }>("GET", "/v1/builds"));
  assert.ok(list.builds.some((b) => b.id === occ) && list.builds.some((b) => b.id === fresh));
  const dup = ok(await srv.call<Created>("POST", `/v1/builds/${occ}/duplicate`, { name: "Occ copy" }));
  const id = dup.build.id;
  const renamed = ok(await srv.call<{ build: { name: string; revision: number } }>("POST", `/v1/builds/${id}/rename`, { name: "Occ two", baseRevision: 1 }));
  assert.deepEqual([renamed.build.name, renamed.build.revision], ["Occ two", 2]);
  assert.equal(ok(await srv.call<Created & { summary: { name: string } }>("GET", `/v1/builds/${id}`)).summary.name, "Occ two");
  const stale = await srv.call("POST", `/v1/builds/${id}/rename`, { name: "late", baseRevision: 1 });
  assert.deepEqual([stale.status, stale.body.error?.code], [409, "stale_revision"]);
  ok(await srv.call("POST", `/v1/builds/${id}/save-points`, { label: "before tree" }));
  const hist = ok(await srv.call<{ history: Array<{ revision: number; cause: string; savePoint?: string }> }>("GET", `/v1/builds/${id}/history`));
  assert.deepEqual(hist.history.map((h) => [h.revision, h.cause, h.savePoint]), [[2, "rename", "before tree"], [1, "create:duplicate", undefined]]);
  assert.equal(ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${id}/xml?revision=1`)).xml, ok(await srv.call<{ xml: string }>("GET", `/v1/builds/${id}/xml`)).xml);
  ok(await srv.call("DELETE", `/v1/builds/${id}?baseRevision=2`));
  const gone = await srv.call("GET", `/v1/builds/${id}`);
  assert.deepEqual([gone.status, gone.body.error?.code], [404, "not_found"]);
  const trash = ok(await srv.call<{ builds: Array<{ id: string; revision: number; purgeAfter: string }> }>("GET", "/v1/builds/trash"));
  assert.deepEqual(trash.builds.filter((b) => b.id === id).map((b) => b.revision), [2]);
  ok(await srv.call("POST", `/v1/builds/${id}/restore`));
  const back = ok(await srv.call<Created & { summary: { name: string } }>("GET", `/v1/builds/${id}`));
  assert.deepEqual([back.build.revision, back.summary.name, back.summary.mainSkill], [2, "Occ two", "Vortex"]);
  assert.equal((await srv.call("POST", `/v1/builds/${id}/restore`)).status, 404, "nothing left to restore");
  ok(await srv.call("DELETE", `/v1/builds/${id}`));
});

void test("lookup: gems, uniques, bases, tree nodes, node detail, config catalogue", async () => {
  const gems = ok(await srv.call<{ gems: Array<{ name: string; tags: unknown }> }>("GET", "/v1/lookup/gems?query=fireball&limit=5"));
  assert.ok(gems.gems.some((g) => g.name === "Fireball"));
  const uniq = ok(await srv.call<{ uniques: Array<{ name: string; text: string }> }>("GET", "/v1/lookup/uniques?query=Headhunter"));
  assert.ok(uniq.uniques[0]?.text.includes("Headhunter"));
  const bases = ok(await srv.call<{ bases: Array<{ name: string }> }>("GET", "/v1/lookup/bases?query=Vaal%20Regalia"));
  assert.equal(bases.bases[0]?.name, "Vaal Regalia");
  const nodes = ok(await srv.call<{ nodes: Array<{ id: number; name: string }> }>(`GET`, `/v1/lookup/nodes?query=Life%20and%20Chaos%20Resistance&buildId=${occ}`));
  assert.ok(nodes.nodes.some((n) => n.id === 14057));
  const node = ok(await srv.call<{ name: string; pathLength: number; linked: number[] }>("GET", `/v1/lookup/nodes/14057?buildId=${occ}`));
  assert.equal(node.name, "Life and Chaos Resistance");
  assert.equal(node.pathLength, 3);
  const cfg = ok(await srv.call<{ options: Array<{ var: string; current: unknown }> }>("GET", `/v1/lookup/config?var=enemyIsBoss&buildId=${occ}`));
  assert.equal(cfg.options[0]?.current, "Pinnacle");
  const bad = await srv.call("GET", "/v1/lookup/gems?limit=abc");
  assert.deepEqual([bad.status, bad.body.error?.code], [400, "invalid_input"]);
});

void test("share links resolve to the site's raw download URL; unsupported links are refused", async () => {
  const r = await srv.runtime.svc.pool.run<{ site: string; downloadUrl: string }>(LOOKUP_SESSION, "builds.resolve_link", { url: "https://pobb.in/AbC123xyz" });
  assert.equal(r.result.downloadUrl, "https://pobb.in/pob/AbC123xyz");
  const bad = await srv.call("POST", "/v1/builds/import/link", { url: "https://example.com/build" });
  assert.deepEqual([bad.status, bad.body.error?.code], [400, "invalid_input"]);
});

void test("auth, health, errors and boundary log lines", async () => {
  const none = await srv.call("GET", "/v1/builds", undefined, null);
  const wrong = await srv.call("GET", "/v1/builds", undefined, `${TOKEN}x`);
  assert.deepEqual([none.status, wrong.status], [401, 401]);
  const base = `http://127.0.0.1:${srv.port}`;
  assert.equal((await fetch(`${base}/mcp`, { method: "POST", body: "{}" })).status, 401);
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
  assert.equal((await fetch(`${base}/health/deep`)).status, 401, "deep health needs a credential");
  const deep = (await (await fetch(`${base}/health/deep`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()) as { ok: boolean; pobVersion: string; latestTreeVersion: string; pool: { max: number } };
  assert.deepEqual([deep.ok, deep.latestTreeVersion, deep.pool.max], [true, "3_30", 3]);
  assert.match(deep.pobVersion, /^\d+\.\d+\.\d+$/);
  const bad = await srv.call("POST", "/v1/builds/import/xml", { xml: "<NotABuild/>" });
  assert.deepEqual([bad.status, bad.body.error?.code], [400, "invalid_input"]);
  assert.ok(srv.lines.some((l) => l.event === "http.request" && l.route === "/v1/stats/:id/sidebar" && l.status === 200));
  assert.ok(srv.lines.some((l) => l.event === "worker.command" && l.op === "stats.sidebar" && l.ok === true));
  assert.ok(!JSON.stringify(srv.lines).includes(TOKEN), "the token never reaches the log");
});
