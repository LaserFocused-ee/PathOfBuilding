// Character import from a public profile, against recorded game-site responses (no live calls).
// The recordings are built from upstream's spec/System/SampleCharacter.json in the site's response shapes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { callTool, toolDefs } from "../src/mcp.js";
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
  const list = await srv.call<{ characters: Array<{ name: string; league: string; class: string; level: number }> }>("POST", "/v1/builds/import/characters", { account: "Test#0000" });
  assert.equal(list.status, 200, JSON.stringify(list.body.error));
  const before = requested.length;
  const inUrl = await srv.call("GET", "/v1/builds/import/characters?account=Test%230000");
  assert.deepEqual([inUrl.status, requested.length - before], [404, 0], "the account name is not taken from a URL");
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
  const noTag = await srv.call("POST", "/v1/builds/import/characters", { account: "Test" });
  assert.deepEqual([noTag.status, noTag.body.error?.code], [400, "invalid_input"]);
  assert.match(noTag.body.error?.message ?? "", /discriminator/);
  assert.equal(requested.length, before, "no request without a discriminator");
  const hidden = await srv.call("POST", "/v1/builds/import/characters", { account: "Hidden#0001" });
  assert.deepEqual([hidden.status, hidden.body.error?.code], [403, "profile_private"]);
  const gone = await srv.call("POST", "/v1/builds/import/character", { account: "Gone#0002", character: "x" });
  assert.deepEqual([gone.status, gone.body.error?.code], [404, "not_found"]);
  const nobody = await srv.call<unknown>("POST", "/v1/builds/import/character", { account: "Test#0000", character: "nobody" });
  assert.deepEqual([nobody.status, nobody.body.error?.code], [404, "not_found"]);
  assert.match(nobody.body.error?.message ?? "", /no character named nobody/);
  const wrongCase = await srv.call("POST", "/v1/builds/import/character", { account: "test#0000", character: "testCharacter" });
  assert.deepEqual([wrongCase.status, wrongCase.body.error?.code], [404, "not_found"]);
  assert.match(wrongCase.body.error?.message ?? "", /case-sensitive/);
  const busy = await fetch(`http://127.0.0.1:${srv.port}/v1/builds/import/characters`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ account: "Busy#0003" }) });
  assert.deepEqual([busy.status, busy.headers.get("retry-after")], [429, "30"]);
  const asked = requested.length;
  const held = await fetch(`http://127.0.0.1:${srv.port}/v1/builds/import/characters`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ account: "Test#0000" }) });
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
    await call({ url: "https://pobb.in/pob/", body: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.deepEqual([seen[1]?.method, seen[1]?.body, seen[1]?.headers["content-type"]], ["POST", "x=1", "application/x-www-form-urlencoded"]);
    // each site's download (and upload) URL as BuildSiteTools.lua builds it
    for (const url of ["https://maxroll.gg/poe/api/pob/abc", "https://api.pob.codes/abc/raw", "https://poe.ninja/poe1/pob/raw/abc", "https://pastebin.com/raw/abc", "https://pastebinp.com/raw/abc", "https://rentry.co/paste/abc/raw", "https://poedb.tw/pob/abc/raw"]) {
      assert.equal((await call({ url })).status, 200, url);
    }
    for (const url of ["https://maxroll.gg/poe/api/pob", "https://api.pob.codes/pob/plain", "https://poe.ninja/poe1/pob/api/upload", "https://poedb.tw/pob/api/gen"]) {
      assert.equal((await call({ url, body: "x=1" })).status, 200, url);
    }

    reply = () => new Response("", { status: 403 });
    const priv = await call({ url: "https://www.pathofexile.com/character-window/get-items?accountName=Some%231234&character=a" });
    assert.deepEqual([priv.status, priv.body.result.status], [200, 403], "the site's own status, for Path of Building to read");

    const before = seen.length;
    for (const url of ["https://api.pathofexile.com/profile", "https://www.pathofexile.com/oauth/authorize", "https://www.pathofexile.com/character-window/get-stash-items", "https://www.pathofexile.com/character-window/get-itemsX", "https://www.pathofexile.com/character-window/get-items/../get-stash-items", "https://www.pathofexile.com/account/view-profile", "https://www.pathofexile.com/account/view-profile/Some-1234/characters", "http://pobb.in/abc", "https://example.com/", "not a url"]) {
      const r = await call({ url });
      assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], url);
    }
    for (const url of ["https://poe.ninja/builds", "https://poe.ninja/poe1/api/data/x", "https://pobb.in/abc", "https://maxroll.gg/poe/build-guides", "https://pastebin.com/abc", "https://rentry.co/abc", "https://poedb.tw/us/Glimpse_of_Chaos"]) {
      const r = await call({ url });
      assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], `${url}: only the download and upload paths Path of Building uses`);
    }
    for (const url of ["https://pastebin.com/raw/abc", "https://rentry.co/paste/abc/raw"]) {
      const r = await call({ url, body: "x=1" });
      assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], `${url}: a download-only site takes no POST`);
    }
    const post = await call({ url: "https://www.pathofexile.com/character-window/get-items", body: "character=a" });
    assert.deepEqual([post.status, post.body.error?.code], [400, "invalid_input"], "the game site is GET only");
    const extra = await call({ url: "https://pobb.in/pob/abc", method: "DELETE" });
    assert.match(extra.body.error?.message ?? "", /unknown parameter\(s\) method; fetch takes url, headers, body/);
    assert.equal(seen.length, before, "nothing off the allowlist is requested");

    // An encoded separator or dot in the path is refused in any case, before any request.
    for (const seg of ["%2f", "%2F", "%5c", "%5C", "%2e", "%2E"]) {
      for (const url of [`https://www.pathofexile.com/character-window/get-items/${seg}${seg}oauth`, `https://pobb.in/pob/abc${seg}raw`, `https://www.pathofexile.com/character-window/get-items${seg}x`]) {
        const r = await call({ url });
        assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], url);
      }
    }
    assert.equal(seen.length, before, "no encoded path reached the upstream");

    reply = () => new Response("{}", { headers: { "content-type": "application/json", "cf-mitigated": "challenge" } });
    const challenged = await call({ url: "https://www.pathofexile.com/character-window/get-items?character=a" });
    assert.equal(challenged.body.result.headers["cf-mitigated"], "challenge", "the page sees a challenge");

    reply = () => new Response(null, { status: 302, headers: { location: "https://www.pathofexile.com/oauth/authorize" } });
    const redirectFrom = seen.length;
    const off = await call({ url: "https://www.pathofexile.com/character-window/get-items?character=a" });
    assert.deepEqual([off.status, off.body.error?.code], [502, "upstream_fetch_failed"], "a redirect off the allowlist");
    assert.equal(seen.length - redirectFrom, 1, "refused at the hop, not at the redirect limit");
    const fromShare = seen.length;
    const hop = await call({ url: "https://pobb.in/pob/abc" });
    assert.deepEqual([hop.status, hop.body.error?.code], [502, "upstream_fetch_failed"], "a share host sending the page to a game-site path off its list");
    assert.equal(seen.length - fromShare, 1, "one upstream request, the game-site hop is never made");
    assert.match(hop.body.error?.message ?? "", /off the allowlist/);
    // A share host's fetcher never leaves the share hosts: a 307 (method and body kept) or a 302 to a listed game-site path is refused at the hop.
    for (const status of [307, 302]) {
      reply = () => new Response(null, { status, headers: { location: "https://www.pathofexile.com/character-window/get-items?character=a" } });
      const from = seen.length;
      const posted = await call({ url: "https://pobb.in/pob/abc", body: "x=1" });
      assert.deepEqual([posted.status, posted.body.error?.code, seen.length - from], [502, "upstream_fetch_failed", 1], String(status));
    }

    reply = () => new Response("[]", { headers: { "x-rate-limit-rules": "Ip", "x-rate-limit-ip": "5:10:60", "x-rate-limit-ip-state": "5:10:0" } });
    assert.equal((await call({ url: "https://www.pathofexile.com/character-window/get-characters?accountName=Some%231234" })).body.result.status, 200);
    const asked = seen.length;
    const held = await call({ url: "https://www.pathofexile.com/character-window/get-characters?accountName=Some%231234" });
    assert.deepEqual([held.status, held.body.error?.code], [429, "rate_limited"], "at the site's limit, the next request waits");
    assert.equal(seen.length, asked);
    assert.equal((await call({ url: "https://pobb.in/pob/abc" })).status, 200, "other hosts are not held");

    const logs = relay.lines.filter((l) => l.event === "fetch.done");
    assert.ok(logs.some((l) => l.purpose === "relay:/character-window/get-items" && l.status === 403));
    assert.ok(!JSON.stringify(relay.lines).includes("Some"), "no account name in the logs");
  } finally {
    await relay.close();
  }
});

void test("POST /v1/fetch and DELETE /v1/session sit outside the route table and still refuse a request without the bearer token, with no upstream request", async () => {
  const asked = requested.length;
  const base = `http://127.0.0.1:${srv.port}`;
  const relayBody = JSON.stringify({ url: "https://www.pathofexile.com/character-window/get-characters?accountName=Some%231234&realm=pc" });
  for (const auth of [undefined, `Bearer ${TOKEN}x`, TOKEN]) {
    const headers: Record<string, string> = auth ? { authorization: auth } : {};
    const relay = await fetch(`${base}/v1/fetch`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: relayBody });
    assert.equal(relay.status, 401, `POST /v1/fetch with ${auth ? "a wrong" : "no"} token`);
    await relay.body?.cancel();
    const session = await fetch(`${base}/v1/session`, { method: "DELETE", headers });
    assert.equal(session.status, 401, `DELETE /v1/session with ${auth ? "a wrong" : "no"} token`);
    assert.equal(session.headers.get("set-cookie"), null, "a refused request clears nothing");
    await session.body?.cancel();
  }
  assert.equal(requested.length, asked, "no upstream request for a refused relay call");
});

void test("MCP: a failing upstream (a 5xx) comes back as an isError result with its code, never a thrown error", async () => {
  const down = await startServer({ poolSize: 1 }, { fetch: () => Promise.reject(new TypeError("connection refused")) });
  try {
    // Straight into callTool: the pob_build tool's own input schema does not take this call (reported to the owner).
    const def = toolDefs().find((d) => d.name === "pob_build");
    assert.ok(def);
    const res = await callTool(down.runtime.svc, def, { action: "characters", account: "Test#0000", realm: "pc" });
    assert.equal(res.isError, true);
    assert.deepEqual(res.structuredContent, { ok: false, error: { code: "upstream_fetch_failed", message: "request to www.pathofexile.com failed: TypeError" } });
    assert.ok(down.lines.some((l) => l.event === "mcp.tool" && l.action === "characters" && l.ok === false && l.code === "upstream_fetch_failed"));
    const http = await down.call("POST", "/v1/builds/import/characters", { account: "Test#0000" });
    assert.equal(http.status, 502, "the same failure over HTTP is a 5xx");
  } finally {
    await down.close();
  }
});
