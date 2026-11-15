// trade.search through a signed-in browser tab (trade-browser.ts), against a fake DevTools endpoint: the target list, and a
// socket that runs the page's code in a sandbox with a recorded trade site. Nothing here reaches a browser or the site.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { loadConfig } from "../src/config.js";
import { ApiError } from "../src/errors.js";
import { routes } from "../src/routes.js";
import { TradeClient, TradeLimiter, type TradeSearch } from "../src/trade.js";
import type { CdpSocket } from "../src/trade-browser.js";
import { memoryLogger, startServer, TOKEN } from "./helpers.js";

const SITE = "https://www.pathofexile.com";
const CDP = "http://127.0.0.1:9223";
const TAB = "A9A6A7A3F25B28E213BDC30AB6A73BCE";
const OTHER = "0000OTHERTAB0000"; // another tab of the same browser (a person's own trade tab): never used
const target = (id: string, url: string) => ({ id, type: "page", url, webSocketDebuggerUrl: `ws://127.0.0.1:9223/devtools/page/${id}` });
const ids = (n: number) => Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, "0"));
const account = { "x-rate-limit-rules": "Account,Ip", "x-rate-limit-account": "3:5:60", "x-rate-limit-account-state": "1:5:0", "x-rate-limit-ip": "8:10:60,15:60:120,60:300:1800", "x-rate-limit-ip-state": "1:10:0,1:60:0,1:300:0" };
const entry = (id: string) => ({ id, listing: { indexed: "2026-11-15T10:00:00Z", account: { name: "Seller#1234" }, price: { type: "~b/o", amount: 2, currency: "chaos" } }, item: { rarity: "Rare", name: "Gale Spark", typeLine: "Cobalt Jewel", explicitMods: [{ description: "15% increased Fire Damage" }] } });

type PageRequest = { path: string; init: RequestInit };
type SiteReply = { status?: number; headers?: Record<string, string>; body?: unknown };

/**
 * A browser on the fake endpoint: `targets` is its tab list; the socket of a tab runs the expression it is sent in a sandbox
 * whose `location` is `origin` and whose `fetch` is the recorded site `answer`.
 */
function browser(opts: { targets?: unknown[]; origin?: string; answer?: (r: PageRequest) => SiteReply } = {}) {
  const opened: string[] = [];
  const expressions: string[] = [];
  const page: PageRequest[] = [];
  const direct: string[] = [];
  const targets = opts.targets ?? [target(OTHER, `${SITE}/trade/search/Covens/abc`), target(TAB, `${SITE}/trade/search/Covens`)];
  const answer = opts.answer ?? ((r: PageRequest): SiteReply =>
    r.init.method === "POST"
      ? { headers: { ...account, "set-cookie": "session=never-read" }, body: { id: `Ab-3_${"x".repeat(890)}`, result: ids(12), total: 10000, complexity: 191 } }
      : { headers: account, body: { result: (r.path.split("/").pop()?.split("?")[0]?.split(",") ?? []).map(entry) } });
  const fetchImpl = (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === `${CDP}/json/list`) return Promise.resolve(new Response(JSON.stringify(targets)));
    direct.push(url);
    if (url.endsWith("/api/trade/data/leagues")) return Promise.resolve(new Response(JSON.stringify({ result: [{ id: "Covens", realm: "pc" }, { id: "Standard", realm: "pc" }] })));
    return Promise.reject(new Error(`a test reached for the network: ${url}`));
  };
  const openSocket = (url: string): CdpSocket => {
    opened.push(url);
    const socket: CdpSocket = {
      onopen: null, onmessage: null, onerror: null, onclose: null,
      close: () => undefined,
      send: (data: string) => {
        const msg = JSON.parse(data) as { id: number; method: string; params: { expression: string; awaitPromise: boolean; returnByValue: boolean } };
        assert.deepEqual([msg.method, msg.params.awaitPromise, msg.params.returnByValue], ["Runtime.evaluate", true, true]);
        expressions.push(msg.params.expression);
        const sandbox = {
          location: { origin: opts.origin ?? SITE },
          fetch: (path: string, init: RequestInit) => {
            page.push({ path, init });
            const r = answer({ path, init });
            return Promise.resolve(new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers ?? {} }));
          },
        };
        void (runInNewContext(msg.params.expression, sandbox) as Promise<unknown>).then(
          (value) => socket.onmessage?.({ data: JSON.stringify({ id: 1, result: { result: { type: "object", value } } }) }),
          () => socket.onmessage?.({ data: JSON.stringify({ id: 1, result: { result: {}, exceptionDetails: { text: "Uncaught" } } }) }),
        );
      },
    };
    queueMicrotask(() => socket.onopen?.({}));
    return socket;
  };
  return { fetch: fetchImpl, openSocket, opened, expressions, page, direct };
}

const cfg = { fetchTimeoutMs: 1000, fetchMaxBytes: 1_000_000, tradeBrowser: { cdp: CDP, tab: TAB } };
const search = (over: Partial<TradeSearch> = {}): TradeSearch => ({ realm: "pc", league: "Covens", body: { query: { status: { option: "securable" }, stats: [{ type: "weight", value: { min: 1 }, filters: [] }] }, sort: { "statgroup.0": "desc" } }, listings: 12, priority: "interactive", deadline: Date.now() + 60_000, userAgent: "Path of Building/2.67.2 (api; fork)", ...over });
const client = (b: ReturnType<typeof browser>) => {
  const { log, lines } = memoryLogger();
  return { lines, client: new TradeClient(cfg, log, b.fetch, new TradeLimiter(Date.now, () => Promise.resolve()), Date.now, b.openSocket) };
};

void test("browser transport: search and fetches run in the configured tab only, no cookie or credential is touched, the Account windows are read", async () => {
  const b = browser();
  const { client: c, lines } = client(b);
  assert.equal(c.transport, "browser");
  const r = await c.search(search());
  assert.deepEqual([r.total, r.complexity, r.entries.length, r.searchId.length], [10000, 191, 12, 895]);
  assert.deepEqual(b.opened, Array.from({ length: 3 }, () => `ws://127.0.0.1:9223/devtools/page/${TAB}`), "one search and two fetch blocks, all on the configured tab");
  assert.deepEqual(b.direct, [], "nothing went straight to the site");
  assert.deepEqual(b.page.map((p) => [p.init.method, p.path.replace(/[0-9a-f]{64}/g, "<id>").replace(/(<id>,?)+/g, (m) => `${m.split("<id>").length - 1}ids`).replace(/query=.*/, "query=<id>")]), [
    ["POST", "/api/trade/search/Covens"],
    ["GET", "/api/trade/fetch/10ids?query=<id>"],
    ["GET", "/api/trade/fetch/2ids?query=<id>"],
  ]);
  for (const p of b.page) {
    assert.equal(p.init.credentials, "same-origin");
    assert.equal(p.init.redirect, "manual");
    assert.deepEqual(Object.keys(p.init.headers as Record<string, string>).filter((k) => !/^content-type$/.test(k)), [], "no header but the body's type");
  }
  for (const e of b.expressions) assert.doesNotMatch(e, /cookie|getCookies|Network\.|authorization|Storage|localStorage/i);
  const windows = c.limiter.state().find((s) => s.policy === "search")?.windows.map((w) => [w.limit, w.periodSeconds]);
  assert.deepEqual(windows, [[3, 5], [8, 10], [15, 60], [60, 300]], "the account's window is paced like the IP's");
  assert.ok(lines.filter((l) => l.event === "trade.request").every((l) => l.transport === "browser" && l.status === 200));
  assert.doesNotMatch(JSON.stringify(lines), /never-read|Seller#1234/);
});

void test("browser transport: a tab that is gone, off the site or answers 401/403 stops with a sign-in message and never falls back", async () => {
  const stops: Array<[ReturnType<typeof browser>, RegExp]> = [
    [browser({ targets: [target(OTHER, `${SITE}/trade`)] }), /trade tab \(A9A6A7A3F25B28E213BDC30AB6A73BCE\) is gone.*sign in again in the server browser/],
    [browser({ targets: [target(TAB, "https://www.example.com/")] }), /not on https:\/\/www\.pathofexile\.com.*sign in again in the server browser/],
    [browser({ origin: "https://www.example.com" }), /not on https:\/\/www\.pathofexile\.com/],
    [browser({ answer: () => ({ status: 401, headers: account, body: { error: { message: "Unauthorized" } } }) }), /answered 401 to the server browser's session; sign in again in the server browser/],
    [browser({ answer: () => ({ status: 403, headers: account }) }), /answered 403 to the server browser's session; sign in again in the server browser/],
    [browser({ targets: [{ ...target(TAB, `${SITE}/trade`), webSocketDebuggerUrl: "ws://10.0.0.1:9223/devtools/page/A9A6A7A3F25B28E213BDC30AB6A73BCE" }] }), /not on the configured endpoint/],
  ];
  for (const [b, message] of stops) {
    const { client: c } = client(b);
    await assert.rejects(c.search(search()), (e: ApiError) => {
      assert.match(e.message, message);
      return true;
    });
    assert.deepEqual(b.direct, [], "no fallback to the direct path");
    assert.ok(b.opened.every((u) => u.endsWith(`/${TAB}`)), "only the configured tab");
  }
  // the page answered off the site: nothing was requested from it
  const off = browser({ origin: "https://www.example.com" });
  await assert.rejects(client(off).client.search(search()));
  assert.deepEqual(off.page, []);
  // a 400 (query too complex) is the site's words and stops, as on the direct path
  const complex = browser({ answer: () => ({ status: 400, headers: account, body: { error: { message: "Query is too complex." } } }) });
  await assert.rejects(client(complex).client.search(search()), (e: ApiError) => e.code === "invalid_input" && /answered 400: Query is too complex/.test(e.message));
});

void test("browser transport settings: both or neither, the endpoint on loopback; trade.search answers its transport and takes a weighted group", async () => {
  const env = { POB_API_TOKEN: TOKEN, POB_ROOT: "/tmp" };
  assert.throws(() => loadConfig({ ...env, POB_API_TRADE_BROWSER_CDP: CDP }), /set together or not at all/);
  assert.throws(() => loadConfig({ ...env, POB_API_TRADE_BROWSER_TAB: TAB }), /set together or not at all/);
  assert.throws(() => loadConfig({ ...env, POB_API_TRADE_BROWSER_CDP: "http://10.1.2.3:9223", POB_API_TRADE_BROWSER_TAB: TAB }), /loopback/);
  assert.deepEqual(loadConfig({ ...env, POB_API_TRADE_BROWSER_CDP: CDP, POB_API_TRADE_BROWSER_TAB: TAB }).tradeBrowser, { cdp: CDP, tab: TAB });
  assert.equal(loadConfig(env).tradeBrowser, undefined);

  const b = browser();
  const srv = await startServer({ tradeLeague: "Covens", tradeBrowser: { cdp: CDP, tab: TAB } }, { fetch: b.fetch, openSocket: b.openSocket });
  try {
    const weight = { type: "weight", value: { min: 1 }, filters: Array.from({ length: 33 }, (_, i) => ({ id: `explicit.stat_${i + 1}`, value: { weight: 1 } })) };
    const r = await srv.call<{ transport: string; searches: Array<{ total: number; complexity: number | null; listings: unknown[] }> }>("POST", "/v1/trade/search", { searches: [{ query: { status: { option: "securable" }, stats: [weight] }, listings: 2 }] });
    assert.equal(r.status, 200, JSON.stringify(r.body.error));
    assert.ok(routes.find((x) => x.name === "trade.search")?.output.safeParse(r.body.result).success, "the answer matches the declared output");
    assert.deepEqual([r.body.result.transport, r.body.result.searches[0]?.total, r.body.result.searches[0]?.complexity, r.body.result.searches[0]?.listings.length], ["browser", 10000, 191, 2]);
    assert.deepEqual(b.direct, ["https://www.pathofexile.com/api/trade/data/leagues"], "only the leagues go direct");
  } finally {
    await srv.close();
  }
});
