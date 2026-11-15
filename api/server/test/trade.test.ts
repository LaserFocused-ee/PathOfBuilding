// Trade search from the server (spec F3): the process-wide limiter, the trade client's request shapes and stops, and the
// route's listing conversion and scoring on tree 3_30. Recorded responses only; nothing here reaches the trade site.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ApiError } from "../src/errors.js";
import { toolDefs } from "../src/mcp.js";
import { routes } from "../src/routes.js";
import { TradeClient, TradeLimiter, type TradeSearch } from "../src/trade.js";
import { FIXTURES, memoryLogger, startServer, type TestServer } from "./helpers.js";

type Sent = { method: string; url: string; headers: Record<string, string>; body?: string; redirect?: string };
type Reply = { status?: number; headers?: Record<string, string>; body?: unknown };

/** A recorded trade site: `answer` picks the reply for each request; every request is kept in `sent`. */
function site(answer: (s: Sent) => Reply): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const s: Sent = { method: init?.method ?? "GET", url: input instanceof Request ? input.url : input.toString(), headers: { ...(init?.headers as Record<string, string>) }, ...(typeof init?.body === "string" ? { body: init.body } : {}), ...(init?.redirect ? { redirect: init.redirect } : {}) };
    sent.push(s);
    const r = answer(s);
    return Promise.resolve(new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers ?? {} }));
  };
  return { fetch: fake, sent };
}

const hex = (c: string) => c.repeat(64);
const ids = (n: number) => Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, "0"));
const rules = (search: string, state: string) => ({ "x-rate-limit-rules": "Ip", "x-rate-limit-ip": search, "x-rate-limit-ip-state": state });
const entry = (id: string) => ({ id, listing: { indexed: "2026-11-14T20:00:00Z", whisper: "@Seller hi", account: { name: "Seller#1234" }, price: { type: "~price", amount: 5, currency: "chaos" } }, item: { rarity: "Rare", name: "Gale Spark", typeLine: "Cobalt Jewel", explicitMods: [{ description: "15% increased Fire Damage" }] } });

/** A clock the limiter reads and its sleeps move forward. */
function clock() {
  const c = { t: 1_000_000, slept: [] as number[] };
  return { c, now: () => c.t, sleep: (ms: number) => { c.slept.push(ms); c.t += ms; return Promise.resolve(); } };
}
const ok200 = (headers: Record<string, string> = {}) => () => Promise.resolve(new Response("{}", { headers }));

void test("limiter: paces at half of the stated window for interactive callers, a quarter for background, which never waits", async () => {
  const { c, now, sleep } = clock();
  const l = new TradeLimiter(now, sleep);
  const far = c.t + 600_000;
  await l.run("search", "interactive", far, ok200(rules("8:10:60", "1:10:0")));
  assert.deepEqual(c.slept, [], "the first request goes at once");
  for (let i = 0; i < 3; i++) await l.run("search", "interactive", far, ok200(rules("8:10:60", `${i + 2}:10:0`)));
  assert.deepEqual(c.slept, [], "4 of 8 per 10 s go at once");
  const state = l.state().find((s) => s.policy === "search");
  assert.deepEqual(state, { policy: "search", remaining: { interactive: 0, background: 0 }, retryAfterSeconds: { interactive: 10, background: 10 }, windows: [{ limit: 8, periodSeconds: 10, used: 4 }] });
  await assert.rejects(l.run("search", "background", far, ok200()), (e: ApiError) => e.code === "rate_limited" && e.details?.retryAfterSeconds === 10);
  await l.run("search", "interactive", far, ok200(rules("8:10:60", "4:10:0")));
  assert.deepEqual(c.slept, [10_000], "the fifth waits until the first leaves the window");
  await assert.rejects(l.run("search", "interactive", c.t + 5_000, ok200()), (e: ApiError) => e.code === "rate_limited", "an interactive caller does not wait past its deadline");
  c.t += 20_000;
  await l.run("search", "background", far, ok200(rules("8:10:60", "1:10:0")));
  await l.run("search", "background", far, ok200(rules("8:10:60", "2:10:0")));
  await assert.rejects(l.run("search", "background", far, ok200()), (e: ApiError) => e.code === "rate_limited", "background has 2 of 8");
  await l.run("search", "interactive", far, ok200(rules("8:10:60", "3:10:0")));
  assert.deepEqual(c.slept, [10_000], "interactive still had budget when background had none");
});

void test("limiter: one request at a time per policy; background is refused while anyone is queued", async () => {
  const l = new TradeLimiter();
  let release = (): void => undefined;
  const order: string[] = [];
  const first = l.run("fetch", "interactive", Date.now() + 60_000, () => new Promise<Response>((r) => { order.push("first sent"); release = () => r(new Response("{}", { headers: rules("100:10:0", "1:10:0") })); }));
  const second = l.run("fetch", "interactive", Date.now() + 60_000, () => { order.push("second sent"); return Promise.resolve(new Response("{}")); });
  await assert.rejects(l.run("fetch", "background", Date.now() + 60_000, ok200()), (e: ApiError) => e.code === "rate_limited");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ["first sent"], "the second waits for the first answer");
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first sent", "second sent"]);
});

void test("limiter: Retry-After on a 4xx and a restricted window hold every caller", async () => {
  const { c, now, sleep } = clock();
  const l = new TradeLimiter(now, sleep);
  await l.run("search", "interactive", c.t + 1000, () => Promise.resolve(new Response("", { status: 429, headers: { "retry-after": "30" } })));
  assert.deepEqual(l.state()[0]?.retryAfterSeconds, { interactive: 30, background: 30 });
  let sent = 0;
  await assert.rejects(l.run("search", "interactive", c.t + 10_000, () => { sent++; return Promise.resolve(new Response("{}")); }), (e: ApiError) => e.code === "rate_limited" && e.details?.retryAfterSeconds === 30);
  assert.equal(sent, 0);
  await l.run("fetch", "interactive", c.t + 1000, ok200(rules("12:4:10", "13:4:60")));
  assert.equal(l.state()[1]?.retryAfterSeconds.interactive, 60, "a restricted window holds for its stated time");
});

const search = (over: Partial<TradeSearch> = {}): TradeSearch => ({ realm: "pc", league: "Keepers of the Flame", body: { query: { status: { option: "securable" } }, sort: { price: "asc" }, engine: "new" }, listings: 10, priority: "interactive", deadline: Date.now() + 60_000, userAgent: "Path of Building/2.67.2", ...over });
const generous = rules("100:10:0", "1:10:0");

void test("trade client: Path of Building's request shapes, fetch blocks of 10, seller fields left out, mod lines as the conversion reads them", async () => {
  const many = ids(35);
  const { fetch, sent } = site((s) => {
    if (s.method === "POST") return { headers: generous, body: { id: "AbC123", result: many, total: 35 } };
    const block = new URL(s.url).pathname.split("/").pop()?.split(",") ?? [];
    return { headers: generous, body: { result: block.map((id, i) => (i === 1 ? null : { ...entry(id), item: { rarity: "Rare", name: "", typeLine: "Cobalt Jewel", explicitMods: ["9% increased Damage"], craftedMods: ["+10 to Intelligence"], fracturedMods: ["15% increased Fire Damage"] } })) } };
  });
  const client = new TradeClient({ fetchTimeoutMs: 1000, fetchMaxBytes: 1_000_000 }, memoryLogger().log, fetch);
  const r = await client.search(search({ realm: "xbox", league: "Hardcore Keepers' Flame", listings: 25 }));
  assert.deepEqual(sent.map((s) => [s.method, s.url.replace(/[0-9a-f]{64}/g, "<id>").replace(/(<id>,?)+/g, (m) => `${m.split("<id>").length - 1}ids`)]), [
    ["POST", "https://www.pathofexile.com/api/trade/search/xbox/Hardcore%20Keepers%27%20Flame"],
    ["GET", "https://www.pathofexile.com/api/trade/fetch/10ids?query=AbC123"],
    ["GET", "https://www.pathofexile.com/api/trade/fetch/10ids?query=AbC123"],
    ["GET", "https://www.pathofexile.com/api/trade/fetch/5ids?query=AbC123"],
  ]);
  for (const s of sent) {
    assert.deepEqual(s.headers, { "content-type": "application/json", "user-agent": "Path of Building/2.67.2" }, "no cookie, no authorization, nothing else");
    assert.equal(s.redirect, "manual");
  }
  assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), { query: { status: { option: "securable" } }, sort: { price: "asc" }, engine: "new" });
  await client.search(search({ listings: 1 }));
  assert.equal(sent[4]?.url, "https://www.pathofexile.com/api/trade/search/Keepers%20of%20the%20Flame", "realm pc is left out of the path");
  assert.deepEqual([r.searchId, r.total, r.entries.length, r.dropped], ["AbC123", 35, 22, 3], "a null entry per block is dropped");
  assert.doesNotMatch(JSON.stringify(r.entries), /Seller|whisper/);
  assert.deepEqual(r.entries[0]?.entry, {
    id: many[0],
    item: { rarity: "Rare", name: "", typeLine: "Cobalt Jewel", explicitMods: [{ flags: { fractured: true }, description: "15% increased Fire Damage" }, { description: "9% increased Damage" }, { flags: { crafted: true }, description: "+10 to Intelligence" }] },
    listing: { price: { type: "~price", amount: 5, currency: "chaos" }, account: { name: "" } },
  });
  assert.deepEqual([r.entries[0]?.indexed, r.entries[0]?.price], ["2026-11-14T20:00:00Z", { type: "~price", amount: 5, currency: "chaos" }]);
});

void test("trade client: a 429, any 4xx, a redirect or a malformed answer stops at once and nothing is retried", async () => {
  const cases: Array<[Reply, string, RegExp, Record<string, unknown>]> = [
    [{ status: 429, headers: { "retry-after": "45" } }, "rate_limited", /limiting/, { status: 429, retryAfterSeconds: 45 }],
    [{ status: 400, body: { error: { code: 2, message: "Invalid query\u0007" } } }, "invalid_input", /answered 400: Invalid query$/, { status: 400 }],
    [{ status: 403 }, "upstream_fetch_failed", /answered 403$/, { status: 403 }],
    [{ status: 302, headers: { location: "https://elsewhere.example/" } }, "upstream_fetch_failed", /redirects are not followed/, { status: 302 }],
    [{ body: { id: "a/b", result: [], total: 0 } }, "upstream_fetch_failed", /expected shape/, {}],
    [{ body: { id: "ok", result: ["../x"], total: 1 } }, "upstream_fetch_failed", /expected shape/, {}],
  ];
  for (const [reply, code, message, details] of cases) {
    const { fetch, sent } = site(() => reply);
    const client = new TradeClient({ fetchTimeoutMs: 1000, fetchMaxBytes: 1_000_000 }, memoryLogger().log, fetch);
    await assert.rejects(client.search(search()), (e: ApiError) => {
      assert.equal(e.code, code, JSON.stringify(reply));
      assert.match(e.message, message);
      assert.deepEqual(e.details ?? {}, details);
      return true;
    });
    assert.equal(sent.length, 1, `one request for ${JSON.stringify(reply)}`);
  }
});

let srv: TestServer;
let build: string;
let requests: Sent[] = [];
let mode: "ok" | "refuse second" = "ok";
const jewel = { ...entry(hex("a")), item: { rarity: "Rare", name: "Gale Spark", typeLine: "Cobalt Jewel", ilvl: 84, explicitMods: [{ description: "15% increased Fire Damage" }, { description: "9% increased Damage" }, { description: "4% increased Cast Speed with Fire Skills" }, { description: "11% increased Projectile Damage" }] } };
const weak = { ...entry(hex("e")), item: { rarity: "Rare", name: "Dull Spark", typeLine: "Cobalt Jewel", ilvl: 84, explicitMods: [{ description: "+10 to Strength" }] } };
const cluster = { id: hex("b"), listing: { indexed: "2026-11-13T10:00:00Z", account: { name: "Other#1" }, price: { type: "~b/o", amount: 1, currency: "divine" } }, item: { rarity: "Rare", name: "Test Cluster", typeLine: "Large Cluster Jewel", ilvl: 84, enchantMods: ["Adds 8 Passive Skills", "2 Added Passive Skills are Jewel Sockets", "Added Small Passive Skills grant: 12% increased Fire Damage"], explicitMods: ["1 Added Passive Skill is Burning Bright", "1 Added Passive Skill is Prodigious Defence"] } };
const unreadable = { id: hex("f"), listing: {}, item: { rarity: "Rare", name: "", typeLine: "Not An Item Base" } };

before(async () => {
  const recorded = site((s) => {
    if (s.method === "POST") {
      const q = (JSON.parse(s.body ?? "{}") as { query: { name?: string; type?: string } }).query;
      if (mode === "refuse second" && q.type === "second") return { status: 400, body: { error: { code: 2, message: "Unknown stat provided" } } };
      return { headers: generous, body: q.name === "cluster" ? { id: "Clu5ter", result: [hex("b")], total: 1 } : { id: "J3wel", result: [hex("e"), hex("a"), hex("c"), hex("f")], total: 4 } };
    }
    return { headers: generous, body: { result: s.url.includes(hex("b")) ? [cluster] : [weak, jewel, null, unreadable] } };
  });
  requests = recorded.sent;
  srv = await startServer({}, { fetch: recorded.fetch });
  const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
  build = (await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).body.result.build.id;
  assert.equal((await srv.call("POST", `/v1/tree/${build}/allocate`, { nodes: [41263, 21984] })).status, 200);
});
after(() => srv.close());

type Listing = { id: string; price: unknown; indexed: string | null; text: string | null; score: { slot: string; gain: number; points?: number; changed: Record<string, { before: number; after: number }> } | null; error?: string };
type Answer = { searches: Array<{ searchId: string; total: number; cached: boolean; link: string; listings: Listing[] }>; notRun: number; stopped: Record<string, unknown> | null; limiter: Array<{ policy: string; remaining: Record<string, number> }> };
const trade = async (body: Record<string, unknown>) => {
  const r = await srv.call<Answer>("POST", "/v1/trade/search", body);
  assert.equal(r.status, 200, JSON.stringify(r.body.error));
  const parsed = routes.find((x) => x.name === "trade.search")?.output.safeParse(r.body.result);
  assert.ok(parsed?.success, JSON.stringify(parsed?.error?.issues.slice(0, 3)));
  return r.body;
};
const league = "Keepers of the Flame";
const fields = ["CombinedDPS", "TotalEHP"];

void test("trade.search: listings read by Path of Building's conversion and scored for the build in their socket, best first", async () => {
  const before = requests.length;
  const { result: r, warnings } = await trade({ league, buildId: build, fields, searches: [{ query: { status: { option: "securable" } }, slot: "Jewel 41263" }, { query: { name: "cluster", status: { option: "securable" } }, slot: "Jewel 21984" }] });
  assert.equal(requests.length - before, 4, "two searches, one fetch block each");
  const [jewels, clusters] = r.searches;
  assert.deepEqual([jewels?.searchId, jewels?.total, jewels?.cached, jewels?.link], ["J3wel", 4, false, "https://www.pathofexile.com/trade/search/Keepers%20of%20the%20Flame/J3wel"]);
  assert.deepEqual(jewels?.listings.map((l) => [l.id, l.score?.gain ?? null, l.error ?? null]), [
    [hex("a"), 233.68, null],
    [hex("e"), 1.833, null],
    [hex("f"), null, "Path of Building could not read this listing"],
  ], "sorted by gain; the delisted entry is left out with a warning");
  assert.deepEqual(warnings, ["search 1: 1 fetched entries were not listings and were left out"]);
  const best = jewels?.listings[0];
  assert.deepEqual(best?.score, { slot: "Jewel 41263", gain: 233.68, changed: { CombinedDPS: { before: 7672.7473304598, after: 9465.7168820134 } } }, "the same values compare_item gives for this jewel");
  assert.equal(best?.text, "Rarity: Rare\nGale Spark\nCobalt Jewel\nItem Level: 84\nImplicits: 0\n15% increased Fire Damage\n9% increased Damage\n4% increased Cast Speed with Fire Skills\n11% increased Projectile Damage");
  assert.deepEqual([best?.price, best?.indexed], [{ type: "~price", amount: 5, currency: "chaos" }, "2026-11-14T20:00:00Z"]);
  assert.deepEqual(clusters?.listings[0]?.score, { slot: "Jewel 21984", gain: 321.139, points: 7, changed: { CombinedDPS: { before: 7672.7473304598, after: 9971.5284744604 }, TotalEHP: { before: 972.53057485765, after: 1014.4189686585 } } }, "a cluster is equipped for real with its passives");
  assert.doesNotMatch(JSON.stringify(r), /Seller|Other#1|whisper/, "no seller names or whispers");
  assert.deepEqual(r.limiter.find((p) => p.policy === "search")?.remaining, { interactive: 48, background: 23 });
  const now = await srv.call<{ output: Record<string, number> }>("GET", `/v1/stats/${build}/output?fields=CombinedDPS`);
  assert.deepEqual(now.body.result.output, { CombinedDPS: 7672.7473304598 }, "the build is left as it was");
});

void test("trade.search: the same search within 10 minutes sends nothing; without a build, listings are read but not scored", async () => {
  const query = { status: { option: "securable" }, type: "repeat" };
  const first = await trade({ league, searches: [{ query, listings: 4 }] });
  const sent = requests.length;
  const again = await trade({ league, searches: [{ query, listings: 4 }] });
  assert.equal(requests.length, sent, "answered from the cache");
  assert.deepEqual([first.result.searches[0]?.cached, again.result.searches[0]?.cached], [false, true]);
  assert.deepEqual(again.result.searches[0]?.listings.map((l) => [l.id, l.score, l.text?.split("\n")[1] ?? null]), [[hex("e"), null, "Dull Spark"], [hex("a"), null, "Gale Spark"], [hex("f"), null, null]], "site order kept");
});

void test("trade.search: a 4xx stops the call; the searches done are answered and the rest are not run", async () => {
  mode = "refuse second";
  try {
    const before = requests.length;
    const { result: r } = await trade({ league, priority: "background", searches: [{ query: { type: "first" } }, { query: { type: "second" } }, { query: { type: "third" } }] });
    assert.equal(requests.length - before, 3, "search, fetch, refused search; nothing retried");
    assert.deepEqual([r.searches.length, r.notRun, r.stopped], [1, 2, { code: "invalid_input", message: "the trade site answered 400: Unknown stat provided", status: 400 }]);
  } finally {
    mode = "ok";
  }
  const logged = srv.lines.filter((l) => l.event === "trade.request");
  assert.ok(logged.length > 0 && logged.every((l) => !JSON.stringify(l).includes("first") && !JSON.stringify(l).includes(league)), "the log line carries no query");
});

void test("trade.search: input limits (8 searches, 30 listings, league text, query size) and the MCP tool", async () => {
  const bad = async (body: Record<string, unknown>, message: RegExp) => {
    const before = requests.length;
    const r = await srv.call("POST", "/v1/trade/search", body);
    assert.deepEqual([r.status, r.body.error?.code], [400, "invalid_input"], JSON.stringify(body).slice(0, 200));
    assert.match(r.body.error?.message ?? "", message);
    assert.equal(requests.length, before, "nothing sent");
  };
  const q = { query: { status: { option: "securable" } } };
  await bad({ league, searches: Array.from({ length: 9 }, () => q) }, /searches/);
  await bad({ league, searches: [] }, /searches/);
  await bad({ league, searches: [{ ...q, listings: 31 }] }, /listings/);
  await bad({ league: "../../api", searches: [q] }, /league/);
  await bad({ league, searches: [{ query: { filler: "x".repeat(40_000) } }] }, /32 KB/);
  await bad({ league, searches: [q], cookie: "POESESSID=1" }, /unknown parameter cookie/);
  const tool = toolDefs().find((d) => d.name === "pob_trade");
  assert.deepEqual([tool?.readOnly, tool?.routes.map((r) => r.name)], [true, ["trade.search"]]);
});
