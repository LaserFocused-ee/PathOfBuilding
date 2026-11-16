// Worker tests against the real Path of Building engine: loading builds, sessions, worker recovery, store operations, lookups, auth and log lines.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { LOOKUP_SESSION } from "../src/pool.js";
import { routes } from "../src/routes.js";
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
  const at = ok(await srv.call<{ level: number; maxAtLevel: number }>("GET", `/v1/stats/${occ}/points`));
  assert.equal(at.maxAtLevel, Math.min(123, at.level - 1 + 23 + 1), `level ${at.level}`);
  const def = ok(await srv.call<{ resistances: Record<string, Record<string, number>> }>("GET", `/v1/stats/${occ}/defences`));
  assert.deepEqual([def.resistances.Fire?.FireResist, def.resistances.Fire?.FireResistOverCap], [75, 9]);
  const bd = ok(await srv.call<{ value: number; breakdown: unknown }>("GET", `/v1/stats/${occ}/breakdown?key=Life`));
  assert.equal(bd.value, 6728);
  assert.ok(JSON.stringify(bd.breakdown).includes("2109 (base)"));
  // a key with no breakdown names its value and the breakdowns that start with it
  const regen = await srv.call("GET", `/v1/stats/${occ}/breakdown?key=ManaRegen`);
  assert.equal(regen.status, 404);
  assert.match(regen.body.error?.message ?? "", /^no breakdown for ManaRegen \(its value is [\d.]+\); breakdowns that start with it: .*ManaRegenRecovery/);
  // the sidebar's main skill; a damage type's Min key gives the type's rows; FullDPS the Full DPS skill list (none ticked here)
  const cold = ok(await srv.call<{ skill: string; value: number; breakdown: Record<string, unknown> }>("GET", `/v1/stats/${occ}/breakdown?key=ColdMin`));
  assert.deepEqual([cold.skill, cold.breakdown["2"]], ["Vortex", "1376 to 2064 (base damage from skill)"]);
  assert.deepEqual(ok(await srv.call("GET", `/v1/stats/${occ}/breakdown?key=FullDPS`)), { key: "FullDPS", skill: "Vortex", value: 0, breakdown: [] });
  const dot = await srv.call("GET", `/v1/stats/${occ}/breakdown?key=TotalDot`);
  assert.match(dot.body.error?.message ?? "", /^no breakdown for TotalDot \(its value is [\d.]+\); breakdowns that start with it or make it up: .*ColdDot/);
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

void test("build.list: filter by name and sort by updated, created or name", async () => {
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const ids: string[] = [];
  for (const name of ["Zqtest Beta", "ZQTEST alpha", "zqtest Charlie"]) {
    ids.push(ok(await srv.call<Created>("POST", "/v1/builds/import/xml", { xml, name })).build.id);
    await new Promise((resolve) => setTimeout(resolve, 5)); // distinct timestamps
  }
  ok(await srv.call("POST", `/v1/builds/${ids[0]}/rename`, { name: "zqtest Bravo" }));
  const names = async (qs: string) => ok(await srv.call<{ builds: Array<{ name: string }> }>("GET", `/v1/builds?query=zqtest${qs}`)).builds.map((b) => b.name);
  assert.deepEqual(await names(""), ["zqtest Bravo", "zqtest Charlie", "ZQTEST alpha"], "default: most recently changed first");
  assert.deepEqual(await names("&sort=created"), ["zqtest Charlie", "ZQTEST alpha", "zqtest Bravo"], "created: newest first");
  assert.deepEqual(await names("&sort=name"), ["ZQTEST alpha", "zqtest Bravo", "zqtest Charlie"], "name: A to Z");
  const q = ok(await srv.call<{ builds: Array<{ name: string }> }>("GET", "/v1/builds?query=CHARLIE"));
  assert.deepEqual(q.builds.map((b) => b.name), ["zqtest Charlie"], "the filter ignores case");
  assert.deepEqual(ok(await srv.call<{ builds: unknown[] }>("GET", "/v1/builds?query=no-such-build-name")).builds, []);
  const all = ok(await srv.call<{ builds: Array<{ id: string }> }>("GET", "/v1/builds"));
  assert.ok(ids.every((id) => all.builds.some((b) => b.id === id)), "no query lists every build");
  const bad = await srv.call("GET", "/v1/builds?sort=size");
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error?.code, "invalid_input");
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
  const banner = ok(await srv.call<{ gems: Array<{ name: string; cost?: unknown; reservation?: unknown }> }>("GET", "/v1/lookup/gems?query=Defiance%20Banner&limit=1")).gems[0];
  assert.deepEqual([banner?.name, banner?.cost, banner?.reservation], ["Defiance Banner", { Mana: 19 }, undefined], "a banner costs mana and reserves nothing");
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

type Area = { areaLevel: number; tier?: number; percent: number };
const newWitch = async (level: number) => ok(await srv.call<Created>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level, treeVersion: "3_30" })).build.id;

void test("stats.xp is the character level box's multiplier table, with the level 95 penalty", async () => {
  const at90 = ok(await srv.call<{ level: number; areas: Area[] }>("GET", `/v1/stats/${await newWitch(90)}/xp`));
  assert.equal(at90.level, 90);
  assert.equal(at90.areas.length, 26);
  assert.deepEqual(at90.areas.slice(0, 3), [{ areaLevel: 62, percent: 1.1 }, { areaLevel: 63, percent: 1.4 }, { areaLevel: 64, percent: 1.6 }]);
  assert.deepEqual(at90.areas.slice(-3), [{ areaLevel: 85, tier: 18, percent: 61.6 }, { areaLevel: 86, tier: 19, percent: 62.3 }, { areaLevel: 87, tier: 20, percent: 62 }]);
  const at95 = ok(await srv.call<{ level: number; areas: Area[] }>("GET", `/v1/stats/${await newWitch(95)}/xp`));
  assert.equal(at95.level, 95);
  assert.deepEqual(at95.areas.at(-1), { areaLevel: 87, tier: 20, percent: 12.7 });
  assert.ok(at95.areas.at(-1)!.percent < at90.areas.at(-1)!.percent);
});

void test("stats.sections lists the Calcs tab's sections as displayed and filters by id or label", async () => {
  const all = ok(await srv.call<{ sections: { id: string; label: string }[] }>("GET", `/v1/stats/${fresh}/sections`));
  assert.ok(all.sections.length > 10);
  assert.ok(routes.find((r) => r.name === "stats.sections")?.output.safeParse(all).success);
  const life = ok(await srv.call("GET", `/v1/stats/${fresh}/sections?section=Life`));
  assert.deepEqual(life, {
    sections: [{ id: "Life", label: "Life", subsections: [{ label: "Life", extra: "1,328/1,328", rows: [
      { label: "Base from Gear", values: ["0"] }, { label: "Inc. from Tree", values: ["18%"] }, { label: "Total Base", values: ["1,125"] },
      { label: "Total Increased", values: ["18%"] }, { label: "Total More", values: ["0%"] }, { label: "Total", values: ["1,328"] },
      { label: "Reserved", values: ["0 (0%)"] }, { label: "Unreserved", values: ["1,328 (100%)"] }, { label: "Recovery", values: ["0 (0%)"] },
    ] }] }],
  });
  const byLabel = ok(await srv.call<{ sections: { id: string }[] }>("GET", `/v1/stats/${fresh}/sections?section=utility%20flasks`));
  assert.deepEqual(byLabel.sections.map((x) => x.id), ["Flasks"]);
  const none = await srv.call("GET", `/v1/stats/${fresh}/sections?section=zzzz`);
  assert.deepEqual([none.status, none.body.error?.code], [404, "not_found"]);
  assert.match(none.body.error?.message ?? "", /sections: View Skill Details, Skill Hit Damage/);
});

void test("stats.ailments: the shock the main skill applies to the configured enemy", async () => {
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  const id = ok(await srv.call<Created>("POST", "/v1/builds/import/xml", { xml })).build.id;
  type Ailments = { enemy: string; skill?: string; ailments: Array<{ ailment: string; effect: number; maximum: number; applies: boolean; threshold?: number }> };
  const pinnacle = ok(await srv.call<Ailments>("GET", `/v1/stats/${id}/ailments`));
  assert.deepEqual([pinnacle.enemy, pinnacle.skill, pinnacle.ailments.map((a) => [a.ailment, a.effect, a.maximum, a.applies, a.threshold])], ["Pinnacle", "Fireball", [["Shock", 1, 50, false, 6349995]]]);
  ok(await srv.call("POST", `/v1/config/${id}/set`, { values: { enemyIsBoss: "None" } }));
  const normal = ok(await srv.call<Ailments>("GET", `/v1/stats/${id}/ailments`));
  assert.equal(normal.enemy, "None");
  assert.ok((normal.ailments[0]?.effect ?? 0) > 1 && (normal.ailments[0]?.threshold ?? Infinity) < 6349995, JSON.stringify(normal.ailments));
});
