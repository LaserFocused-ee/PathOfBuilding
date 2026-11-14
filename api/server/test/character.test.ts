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
  const wrongCase = await srv.call("POST", "/v1/builds/import/character", { account: "test#0000", character: "testCharacter" });
  assert.deepEqual([wrongCase.status, wrongCase.body.error?.code], [404, "not_found"]);
  assert.match(wrongCase.body.error?.message ?? "", /case-sensitive/);
  const busy = await fetch(`http://127.0.0.1:${srv.port}/v1/builds/import/characters?account=Busy%230003`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.deepEqual([busy.status, busy.headers.get("retry-after")], [429, "30"]);
  const asked = requested.length;
  const held = await fetch(`http://127.0.0.1:${srv.port}/v1/builds/import/characters?account=Test%230000`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(held.status, 429, "the site's pause holds for every account");
  assert.ok(Number(held.headers.get("retry-after")) >= 29);
  assert.equal(requested.length, asked, "no request to the site during its pause");
  assert.ok(requested.every((u) => u.host === "www.pathofexile.com"), "only the game site is contacted");
});

void test("POST /v1/fetch relays the page's imports: allowlisted paths only, its headers stripped, the site's status and limits passed back and obeyed", async () => {
  const seen: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  let reply = (): Response => new Response('[{"name":"a"}]', { headers: { "content-type": "application/json", "set-cookie": "POESESSID=x", "x-rate-limit-rules": "Ip", "x-rate-limit-ip": "5:10:60", "x-rate-limit-ip-state": "1:10:0", server: "x" } });
  const relay = await startServer({}, {
    fetch: (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: input instanceof Request ? input.url : input.toString(), method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body });
      return Promise.resolve(reply());
    },
  });
  try {
    const call = (body: unknown) => relay.call<{ status: number; headers: Record<string, string>; body: string }>("POST", "/v1/fetch", body);
    const got = await call({ url: "https://www.pathofexile.com/character-window/get-characters?accountName=Some%231234&realm=pc", headers: { Accept: "application/json", Cookie: "POESESSID=secret", Authorization: "Bearer x", "X-Other": "1" } });
    assert.equal(got.status, 200, JSON.stringify(got.body.error));
    assert.deepEqual(got.body.result, { status: 200, headers: { "content-type": "application/json", "x-rate-limit-rules": "Ip", "x-rate-limit-ip": "5:10:60", "x-rate-limit-ip-state": "1:10:0" }, body: '[{"name":"a"}]' });
    assert.deepEqual(seen[0], { url: "https://www.pathofexile.com/character-window/get-characters?accountName=Some%231234&realm=pc", method: "GET", headers: { accept: "application/json", "user-agent": "pob-api/0.1 (Path of Building API; build imports on request)" }, body: undefined });
    await call({ url: "https://pobb.in/abc/raw", body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.deepEqual([seen[1]?.method, seen[1]?.body, seen[1]?.headers["content-type"]], ["POST", "x=1", "application/x-www-form-urlencoded"]);

    reply = () => new Response("", { status: 403 });
    const priv = await call({ url: "https://www.pathofexile.com/account/view-profile/Some-1234/characters" });
    assert.deepEqual([priv.status, priv.body.result.status], [200, 403], "the site's own status, for Path of Building to read");

    const before = seen.length;
    for (const url of ["https://api.pathofexile.com/profile", "https://www.pathofexile.com/oauth/authorize", "https://www.pathofexile.com/character-window/get-stash-items", "http://pobb.in/abc", "https://example.com/", "not a url"]) {
      const r = await call({ url });
      assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], url);
    }
    const extra = await call({ url: "https://pobb.in/abc", method: "DELETE" });
    assert.match(extra.body.error?.message ?? "", /unknown parameter\(s\) method; fetch takes url, headers, body/);
    assert.equal(seen.length, before, "nothing off the allowlist is requested");

    reply = () => new Response(null, { status: 302, headers: { location: "https://www.pathofexile.com/oauth/authorize" } });
    const off = await call({ url: "https://www.pathofexile.com/character-window/get-items?character=a" });
    assert.deepEqual([off.status, off.body.error?.code], [502, "upstream_fetch_failed"], "a redirect off the allowlist");

    reply = () => new Response("[]", { headers: { "x-rate-limit-rules": "Ip", "x-rate-limit-ip": "5:10:60", "x-rate-limit-ip-state": "5:10:0" } });
    assert.equal((await call({ url: "https://www.pathofexile.com/character-window/get-characters?accountName=Some%231234" })).body.result.status, 200);
    const asked = seen.length;
    const held = await call({ url: "https://www.pathofexile.com/character-window/get-characters?accountName=Some%231234" });
    assert.deepEqual([held.status, held.body.error?.code], [429, "rate_limited"], "at the site's limit, the next request waits");
    assert.equal(seen.length, asked);
    assert.equal((await call({ url: "https://pobb.in/abc/raw" })).status, 200, "other hosts are not held");

    const logs = relay.lines.filter((l) => l.event === "fetch.done");
    assert.ok(logs.some((l) => l.purpose === "relay:/account/view-profile/" && l.status === 403));
    assert.ok(!JSON.stringify(relay.lines).includes("Some"), "no account name in the logs");
  } finally {
    await relay.close();
  }
});
