// Worker tests for loadouts (the Loadouts dropdown: tree, item set, skill set and config set by one title), on tree 3_30,
// through HTTP. Switching a loadout moves exact output numbers.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startServer, type TestServer } from "./helpers.js";

type Reply<T> = { status: number; body: { ok: boolean; result: T; error?: { code: string; message: string } } };
type Sets = { tree: string; items: string; skills: string; config: string };
type List = { loadouts: string[]; active: string | null; sets: Sets };
type Made = { result: { name: string; sets: Sets; dropped: string[] }; revision: number };

let srv: TestServer;

const ok = <T>(r: Reply<T>) => {
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  return r.body.result;
};
const fails = (r: Reply<unknown>, status: number, code: string) => assert.deepEqual([r.status, r.body.error?.code], [status, code], r.body.error?.message);
const list = async (id: string) => ok(await srv.call<List>("GET", `/v1/loadouts/${id}/list`));
const post = <T = Record<string, unknown>>(id: string, path: string, body: Record<string, unknown>) => srv.call<T>("POST", `/v1/${path.replace(":id", id)}`, body);
const dps = async (id: string) => ok(await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${id}/output?fields=TotalDPS`)).output.TotalDPS;
const gemLevel = async (id: string) => ok(await srv.call<{ groups: Array<{ gems: Array<{ level: number }> }> }>("GET", `/v1/skills/${id}/get`)).groups[0]?.gems[0]?.level;

/** A level 90 Witch / Elementalist on tree 3_30 with Fireball. */
async function witch(): Promise<string> {
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_30" })).build.id;
  ok(await post(id, "skills/:id/add-group", { gems: [{ name: "Fireball" }] }));
  return id;
}

before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv?.close();
});

void test("loadout_new copies the active sets; loadout_activate switches all four back and forth", async () => {
  const id = await witch();
  const all = { tree: "Default", items: "Default", skills: "Default", config: "Default" };
  assert.deepEqual(await list(id), { loadouts: ["Default"], active: "Default", sets: all });
  const base = await dps(id);
  assert.equal(base, 1608.5666666667);

  const made = ok(await post<Made>(id, "loadouts/:id/new", { name: "Two" }));
  const two = { tree: "Two", items: "Two", skills: "Two", config: "Two" };
  assert.deepEqual(made.result, { name: "Two", sets: two, dropped: [] });
  assert.deepEqual(await list(id), { loadouts: ["Default", "Two"], active: "Two", sets: two });
  assert.equal(await dps(id), base); // copies: nothing changed yet

  ok(await post(id, "skills/:id/set-gem", { group: 1, gem: 1, level: 10 }));
  ok(await post(id, "tree/:id/allocate", { nodes: [44983] }));
  const changed = await dps(id);
  assert.equal(changed, 276.2375);

  const back = ok(await post<{ result: { active: string; sets: Sets } }>(id, "loadouts/:id/activate", { name: "Default" }));
  assert.deepEqual(back.result, { active: "Default", sets: all });
  assert.deepEqual([await dps(id), await gemLevel(id)], [base, 20]);
  ok(await post(id, "loadouts/:id/activate", { name: "Two" }));
  assert.deepEqual([await dps(id), await gemLevel(id), (await list(id)).sets], [changed, 10, two]);

  fails(await post(id, "loadouts/:id/activate", { name: "Three" }), 404, "not_found");
  fails(await post(id, "loadouts/:id/new", { name: "Two" }), 400, "invalid_input");
  fails(await post(id, "loadouts/:id/new", { name: "Odd {x}" }), 400, "invalid_input");
});

void test("loadout_new empty makes four new sets; loadouts that relied on a tab's single set are reported dropped", async () => {
  const id = await witch();
  ok(await post(id, "tree/:id/spec-rename", { index: 1, title: "Plan" }));
  assert.deepEqual((await list(id)).loadouts, ["Plan"]); // the other tabs have one set each, so they match

  const made = ok(await post<Made>(id, "loadouts/:id/new", { name: "Blank", empty: true }));
  assert.deepEqual(made.result, { name: "Blank", sets: { tree: "Blank", items: "Blank", skills: "Blank", config: "Blank" }, dropped: ["Plan"] });
  assert.deepEqual(await list(id), { loadouts: ["Blank"], active: "Blank", sets: made.result.sets });
  assert.equal(await gemLevel(id), undefined); // the new skill set has no groups
});

void test("loadout_stats: each loadout's figures without switching to it; add_group's includeInFullDPS", async () => {
  const id = await witch();
  ok(await post(id, "loadouts/:id/new", { name: "Two" }));
  ok(await post(id, "skills/:id/set-gem", { group: 1, gem: 1, level: 10 }));
  const revision = async () => ok(await srv.call<{ build: { revision: number } }>("GET", `/v1/builds/${id}`)).build.revision;
  const r0 = await revision();
  type Stats = { loadouts: Array<{ name: string; sets: Sets; fullDpsGroups: number; output: Record<string, number> }> };
  const s = ok(await srv.call<Stats>("GET", `/v1/loadouts/${id}/stats?fields=TotalDPS,FullDPS`));
  assert.deepEqual(s.loadouts.map((l) => [l.name, l.sets.skills, l.output.TotalDPS]), [["Default", "Default", 1608.5666666667], ["Two", "Two", await dps(id)]]);
  assert.deepEqual([await revision(), (await list(id)).active, await gemLevel(id)], [r0, "Two", 10], "the build is as it was");
  fails(await srv.call("GET", `/v1/loadouts/${id}/stats?names=Nope`), 404, "not_found");

  // A new group is not in Full DPS unless asked; fullDpsGroups shows it.
  const blank = await witch();
  ok(await post(blank, "loadouts/:id/new", { name: "Blank", empty: true }));
  const full = async () => ok(await srv.call<Stats>("GET", `/v1/loadouts/${blank}/stats?names=Blank&fields=FullDPS,TotalDPS`)).loadouts[0];
  ok(await post(blank, "skills/:id/add-group", { gems: [{ name: "Fireball" }] }));
  const off = await full();
  assert.deepEqual([off?.fullDpsGroups, off?.output.FullDPS], [0, 0]);
  ok(await post(blank, "skills/:id/add-group", { gems: [{ name: "Fireball" }], includeInFullDPS: true }));
  const on = await full();
  assert.equal(on?.fullDpsGroups, 1);
  assert.ok((on?.output.FullDPS ?? 0) > 0, JSON.stringify(on?.output));
});

void test("loadouts match on an older tree version, through colour codes and doubled spaces, and by {n} links", async () => {
  const id = ok(await srv.call<{ build: { id: string } }>("POST", "/v1/builds", { className: "Witch", ascendancy: "Elementalist", level: 90, treeVersion: "3_29" })).build.id;
  ok(await post(id, "skills/:id/add-group", { gems: [{ name: "Fireball" }] }));
  // Path of Building lists this tree as "[3.29] ^3Map  Set", which equals no set title, so its own dropdown has none.
  ok(await post(id, "tree/:id/spec-rename", { index: 1, title: "^3Map  Set" }));
  ok(await post(id, "items/:id/set-rename", { index: 1, title: "Map Set" }));
  ok(await post(id, "skills/:id/set-rename", { index: 1, title: "^xFF0000Map Set" }));
  ok(await post(id, "config/:id/set-rename", { index: 1, title: "Map Set " }));
  ok(await post(id, "tree/:id/spec-copy", { index: 1, title: "Boss {2}" }));
  for (const tab of ["items", "skills", "config"]) {
    ok(await post(id, `${tab}/:id/set-copy`, { index: 1, title: "Bossing {2}" }));
  }
  assert.deepEqual((await list(id)).loadouts, ["Map Set", "Boss {2}"]);
  assert.equal((await list(id)).active, "Map Set");

  const boss = ok(await post<{ result: { active: string; sets: Sets } }>(id, "loadouts/:id/activate", { name: "Boss {2}" }));
  assert.deepEqual(boss.result, { active: "Boss {2}", sets: { tree: "Boss {2}", items: "Bossing {2}", skills: "Bossing {2}", config: "Bossing {2}" } });
  // the raw title also finds it
  const map = ok(await post<{ result: { active: string } }>(id, "loadouts/:id/activate", { name: "^3Map  Set" }));
  assert.equal(map.result.active, "Map Set");
  const rows = ok(await srv.call<{ loadouts: Array<{ name: string }> }>("GET", `/v1/loadouts/${id}/stats`)).loadouts;
  assert.deepEqual(rows.map((r) => r.name), ["Map Set", "Boss {2}"]);
});
