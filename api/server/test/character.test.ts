// Character import from a public profile, against recorded game-site responses (no live calls).
// The recordings are built from upstream's spec/System/SampleCharacter.json in the site's response shapes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ROOT, startServer, TOKEN, type TestServer } from "./helpers.js";

type Sample = { name: string; realm: string; class: string; league: string; level: number; equipment: unknown[]; jewels: unknown[]; passives: Record<string, unknown> };
type Stat = { stat: string; value: number };
type Created = { build: { id: string; source: Record<string, string> }; summary: { className: string; ascendancy?: string; secondaryAscendancy?: string; level: number; treeVersion: string; mainSkill?: string } };

let srv: TestServer;
const requested: URL[] = [];

before(async () => {
  const sample = (JSON.parse(await readFile(join(ROOT, "spec/System/SampleCharacter.json"), "utf8")) as { character: Sample }).character;
  const entry = (c: Sample) => ({ name: c.name, realm: c.realm, class: c.class, league: c.league, level: c.level });
  const characters = [entry(sample), { name: "smallWitch", realm: "pc", class: "Witch", league: "Standard", level: 5 }, { name: "onXbox", realm: "xbox", class: "Duelist", league: "Standard", level: 40 }];
  const bodies: Record<string, string> = {
    "get-characters": JSON.stringify(characters),
    "get-passive-skills": JSON.stringify({ ...sample.passives, items: sample.jewels }),
    "get-items": JSON.stringify({ items: sample.equipment, character: entry(sample) }),
  };
  const recorded = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    requested.push(url);
    const account = url.searchParams.get("accountName");
    const endpoint = url.pathname.replace("/character-window/", "");
    if (account === "Hidden#0001") return Promise.resolve(new Response("", { status: 403 }));
    if (account === "Gone#0002") return Promise.resolve(new Response("", { status: 404 }));
    if (account === "Busy#0003") return Promise.resolve(new Response("", { status: 429, headers: { "retry-after": "30" } }));
    if (account === "test#0000" && endpoint !== "get-characters") return Promise.resolve(new Response("false")); // names are case-sensitive here
    const body = bodies[endpoint];
    return Promise.resolve(body ? new Response(body, { headers: { "content-type": "application/json" } }) : new Response("", { status: 404 }));
  };
  srv = await startServer({}, { fetch: recorded });
});

after(async () => {
  await srv?.close();
});

void test("characters on a public profile: list, then import one with its tree, jewels, items and skills", async () => {
  const list = await srv.call<{ characters: Array<{ name: string; league: string; class: string; level: number }> }>("GET", "/v1/builds/import/characters?account=Test%230000");
  assert.equal(list.status, 200, JSON.stringify(list.body.error));
  assert.deepEqual(list.body.result.characters, [
    { name: "testCharacter", league: "Mirage", class: "Hierophant", level: 99 },
    { name: "smallWitch", league: "Standard", class: "Witch", level: 5 },
  ]);
  const got = await srv.call<Created>("POST", "/v1/builds/import/character", { account: "Test-0000", character: "testCharacter" });
  assert.equal(got.status, 200, JSON.stringify(got.body.error));
  const { build, summary } = got.body.result;
  assert.deepEqual([summary.className, summary.ascendancy, summary.secondaryAscendancy, summary.level, summary.treeVersion], ["Templar", "Hierophant", "Farrul Bloodline", 99, "3_30"]);
  assert.equal(summary.mainSkill, "Kinetic Blast of Clustering", "skills came with the items");
  assert.deepEqual(build.source, { kind: "character", account: "Test#0000", realm: "pc", character: "testCharacter" });
  const calls = requested.slice(-3).map((u) => `${u.host}${u.pathname}?${u.search.slice(1)}`);
  assert.deepEqual(calls, [
    "www.pathofexile.com/character-window/get-characters?accountName=Test%230000&realm=pc",
    "www.pathofexile.com/character-window/get-passive-skills?accountName=Test%230000&character=testCharacter&realm=pc",
    "www.pathofexile.com/character-window/get-items?accountName=Test%230000&character=testCharacter&realm=pc",
  ]);
  const tree = await srv.call<{ masteries: Array<{ nodeId: number; effectId: number }>; tattoos: unknown[] }>("GET", `/v1/tree/${build.id}/get`);
  assert.equal(tree.status, 200);
  assert.equal(tree.body.result.masteries.length, 7);
  assert.equal(tree.body.result.masteries.find((m) => m.nodeId === 4492)?.effectId, 5356);
  const side = await srv.call<{ stats: Stat[] }>("GET", `/v1/stats/${build.id}/sidebar`);
  const stat = (k: string) => side.body.result.stats.find((s) => s.stat === k)?.value;
  assert.deepEqual([stat("Life"), stat("EnergyShield"), stat("Mana")], [1, 8385, 8614]);
});

void test("character import errors: no discriminator, private profile, unknown account, unknown character, rate limit, wrong case", async () => {
  const before = requested.length;
  const noTag = await srv.call("GET", "/v1/builds/import/characters?account=Test");
  assert.deepEqual([noTag.status, noTag.body.error?.code], [400, "invalid_input"]);
  assert.match(noTag.body.error?.message ?? "", /discriminator/);
  assert.equal(requested.length, before, "no request without a discriminator");
  const hidden = await srv.call("GET", "/v1/builds/import/characters?account=Hidden%230001");
  assert.deepEqual([hidden.status, hidden.body.error?.code], [403, "profile_private"]);
  const gone = await srv.call("POST", "/v1/builds/import/character", { account: "Gone#0002", character: "x" });
  assert.deepEqual([gone.status, gone.body.error?.code], [404, "not_found"]);
  const nobody = await srv.call<unknown>("POST", "/v1/builds/import/character", { account: "Test#0000", character: "nobody" });
  assert.deepEqual([nobody.status, nobody.body.error?.code], [404, "not_found"]);
  assert.match(nobody.body.error?.message ?? "", /no character named nobody/);
  const busy = await fetch(`http://127.0.0.1:${srv.port}/v1/builds/import/characters?account=Busy%230003`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.deepEqual([busy.status, busy.headers.get("retry-after")], [429, "30"]);
  const wrongCase = await srv.call("POST", "/v1/builds/import/character", { account: "test#0000", character: "testCharacter" });
  assert.deepEqual([wrongCase.status, wrongCase.body.error?.code], [404, "not_found"]);
  assert.match(wrongCase.body.error?.message ?? "", /case-sensitive/);
  assert.ok(requested.every((u) => u.host === "www.pathofexile.com"), "only the game site is contacted");
});
