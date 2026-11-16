// Currency rates (spec F3, "Trade search from the server" item 8): Path of Building's two downloads, its own conversion in the
// worker, each host at most once an hour, and the Trade tab's price orders and Total Price on trade.search. Recorded responses
// only; nothing here reaches either host.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ApiError } from "../src/errors.js";
import { routes } from "../src/routes.js";
import { exchangeHour, STATIC_URL, TRADE_HOSTS, TradeClient, TradeLimiter, type ExchangeHour, type StaticData } from "../src/trade.js";
import { FIXTURES, memoryLogger, startServer, TOKEN } from "./helpers.js";

type Sent = { method: string; url: string; headers: Record<string, string>; body?: string };
type Reply = { status?: number; headers?: Record<string, string>; body?: unknown };

function site(answer: (s: Sent) => Reply): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const s: Sent = { method: init?.method ?? "GET", url: input instanceof Request ? input.url : input.toString(), headers: { ...(init?.headers as Record<string, string>) }, ...(typeof init?.body === "string" ? { body: init.body } : {}) };
    sent.push(s);
    const r = answer(s);
    return Promise.resolve(new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers ?? {} }));
  };
  return { fetch: fake, sent };
}

const LEAGUE = "Covens";
const [DIV, CHAOS, EXALT, MIRROR, ALCH, ALT] = ["CurrencyModValues", "CurrencyRerollRare", "CurrencyAddModToRare", "CurrencyDuplicate", "CurrencyUpgradeToRare", "CurrencyRerollMagic"].map((n) => `Metadata/Items/Currency/${n}`) as [string, string, string, string, string, string];
/** One exchange market as the hour's answer has it: `volume_traded` is how many of each changed hands in the hour; the order ratios are one outlying 1:1 order. */
const market = (league: string, [a, ra, sa]: [string, number, number], [b, rb, sb]: [string, number, number]) => ({
  league, market_id: `${a}|${b}`, market_pair: [a, b], volume_traded: { [a]: ra * 7, [b]: rb * 7 }, lowest_stock: { [a]: 1, [b]: 1 }, highest_stock: { [a]: sa, [b]: sb }, lowest_ratio: { [a]: 1, [b]: 1 }, highest_ratio: { [a]: ra, [b]: rb },
});
const exchange = {
  next_change_id: 1,
  markets: [
    market(LEAGUE, [DIV, 1, 40], [CHAOS, 200, 9000]), // 200 chaos a divine
    market(LEAGUE, [EXALT, 1, 300], [CHAOS, 15, 5000]), // 15 chaos an exalted
    market(LEAGUE, [MIRROR, 1, 2], [DIV, 300, 900]), // 300 divines a mirror
    market(LEAGUE, [ALCH, 2, 500], [CHAOS, 1, 100]), // 2 alchemy a chaos, the most stock
    market(LEAGUE, [ALCH, 500, 50], [DIV, 1, 3]), // less stock: not used
    market(LEAGUE, [ALT, 4, 900], [CHAOS, 1, 100]), // alteration: not in the static data, so not priced
    { ...market(LEAGUE, [EXALT, 1, 9000], [DIV, 1, 9000]), volume_traded: { [EXALT]: 0, [DIV]: 0 } }, // the most stock, but nothing traded in the hour: not used
    market("Standard", [DIV, 1, 10], [CHAOS, 150, 100]),
    market("Standard", [EXALT, 1, 10], [CHAOS, 9, 100]),
  ],
};
const staticData = {
  result: [
    { id: "Currency", label: "Currency", entries: [{ id: "chaos", text: "Chaos Orb", image: "/c.png" }, { id: "divine", text: "Divine Orb" }, { id: "exalted", text: "Exalted Orb" }, { id: "mirror", text: "Mirror of Kalandra" }, { id: "alch", text: "Orb of Alchemy" }, { id: "sep", text: "" }] },
    { id: "Fragments", label: "Fragments", entries: [{ id: "sacrifice-at-dusk", text: "Sacrifice at Dusk" }] },
  ],
};
/** Divines per one, by Path of Building's conversion of the hour above for Covens. */
const covens = { chaos: 0.005, divine: 1, exalted: 0.075, mirror: 300, alch: 0.0025 };
const EXCHANGE = /^https:\/\/web\.poecdn\.com\/api\/currency-exchange\/(\d+)$/;

void test("trade client: the two downloads, the league's markets only, an hour's cache, each host at most once an hour (a failure included), stops reported", async () => {
  const c = { t: 1_794_675_600_000 + 30 * 60_000 };
  const now = () => c.t;
  let cx: Reply = { body: exchange };
  const recorded = site((s) => (s.url === STATIC_URL ? { body: staticData } : cx));
  const client = new TradeClient({ fetchTimeoutMs: 1000, fetchMaxBytes: 1_000_000 }, memoryLogger().log, recorded.fetch, new TradeLimiter(now, () => Promise.resolve()), now);
  const userAgent = "Path of Building/test (api; fork)";
  const ask = () => ({ priority: "interactive" as const, deadline: c.t + 600_000, userAgent });
  const given: Array<[StaticData, ExchangeHour]> = [];
  const convert = (d: StaticData, h: ExchangeHour) => {
    given.push([d, h]);
    return Promise.resolve({ divine: 1 });
  };
  const first = await client.currencyRates("pc", LEAGUE, ask(), convert);
  assert.deepEqual(first, { hour: 1_794_672_000, rates: { divine: 1 }, cached: false }, "the last complete hour");
  assert.deepEqual(recorded.sent.map((s) => [s.method, s.url, s.headers]), [
    ["GET", STATIC_URL, { "user-agent": userAgent }],
    ["GET", "https://web.poecdn.com/api/currency-exchange/1794672000", { "user-agent": userAgent }],
  ], "launch:DownloadPage's requests: the client string only");
  assert.deepEqual(given[0]?.[0], { result: [{ id: "Currency", entries: staticData.result[0]?.entries.map(({ id, text }) => ({ id, text })) }] }, "the static group PullCXData reads, its fields only");
  assert.deepEqual(given[0]?.[1].markets.map((m) => m.league), Array(6).fill(LEAGUE), "the configured league's markets only");
  assert.deepEqual(await client.currencyRates("pc", LEAGUE, ask(), convert), { ...first, cached: true });
  assert.equal(recorded.sent.length, 2, "the hour's cache sends nothing");

  // Another realm inside the hour: the static data is reused, the exchange host is not asked again.
  await assert.rejects(client.currencyRates("xbox", LEAGUE, ask(), convert), (e: ApiError) => e.code === "rate_limited" && /exchange data was asked less than an hour ago/.test(e.message) && e.details?.retryAfterSeconds === 3600);
  assert.equal(recorded.sent.length, 2, "nothing sent");

  // An hour on: both again, for the new hour; the exchange without the league fails naming it, and is not asked again.
  c.t += 61 * 60_000;
  cx = { body: { markets: exchange.markets.filter((m) => m.league === "Standard") } };
  await assert.rejects(client.currencyRates("xbox", LEAGUE, ask(), convert), (e: ApiError) => e.code === "upstream_fetch_failed" && e.message === "the currency exchange has no traded markets for Covens in the hour 1794675600 (xbox)");
  assert.deepEqual(recorded.sent.slice(2).map((s) => s.url), [STATIC_URL, "https://web.poecdn.com/api/currency-exchange/xbox/1794675600"]);
  await assert.rejects(client.currencyRates("xbox", LEAGUE, ask(), convert), (e: ApiError) => e.code === "rate_limited");
  assert.equal(recorded.sent.length, 4, "a failed hour is not asked again");

  // A 4xx stops with its status and rate-limit headers and is not retried.
  c.t += 61 * 60_000;
  cx = { status: 403, headers: { "x-rate-limit-rules": "Ip", "x-rate-limit-ip": "5:60:60" }, body: { error: { message: "go away" } } };
  await assert.rejects(client.currencyRates("pc", LEAGUE, ask(), convert), (e: ApiError) =>
    e.code === "upstream_fetch_failed" && e.message === "web.poecdn.com answered 403" && JSON.stringify(e.details) === JSON.stringify({ status: 403, headers: { "x-rate-limit-ip": "5:60:60", "x-rate-limit-rules": "Ip" } }));
  assert.equal(recorded.sent.filter((s) => EXCHANGE.test(s.url) || s.url.includes("/xbox/")).length, 3, "one exchange request per hour");
  assert.ok(recorded.sent.every((s) => (TRADE_HOSTS as readonly string[]).includes(new URL(s.url).hostname)));
});

void test("trade client: callers at the same time share one fetch, another realm is refused by the hour's gate, and a refusal before sending gives the gate back", async () => {
  const c = { t: 1_794_675_600_000 };
  const now = () => c.t;
  const recorded = site((s) => (s.url === STATIC_URL ? { body: staticData } : { body: exchange }));
  const sleep = (ms: number) => {
    c.t += ms;
    return Promise.resolve();
  };
  const client = new TradeClient({ fetchTimeoutMs: 1000, fetchMaxBytes: 1_000_000 }, memoryLogger().log, recorded.fetch, new TradeLimiter(now, sleep), now);
  const ask = (deadline = c.t + 600_000) => ({ priority: "interactive" as const, deadline, userAgent: "Path of Building/test (api; fork)" });
  const convert = () => Promise.resolve({ divine: 1 });
  // the limiter refuses a caller whose deadline has passed before anything is sent: the hour's gate is not used up
  await assert.rejects(client.currencyRates("pc", LEAGUE, ask(c.t - 1), convert), (e: ApiError) => e.code === "rate_limited" && /^nothing sent: the call's time ran out behind earlier trade static requests/.test(e.message));
  assert.equal(recorded.sent.length, 0);
  const [a, b, x, d] = await Promise.allSettled([client.currencyRates("pc", LEAGUE, ask(), convert), client.currencyRates("pc", LEAGUE, ask(), convert), client.currencyRates("xbox", LEAGUE, ask(), convert), client.currencyRates("pc", LEAGUE, ask(), convert)]);
  assert.deepEqual([a, b, d].map((r) => r.status === "fulfilled" && r.value.rates), [{ divine: 1 }, { divine: 1 }, { divine: 1 }], "the pc callers share the one answer");
  assert.ok(x.status === "rejected" && (x.reason as ApiError).code === "rate_limited", "xbox at the same time: the hour's gate is taken");
  assert.deepEqual(recorded.sent.map((s) => s.url), [STATIC_URL, "https://web.poecdn.com/api/currency-exchange/1794672000"], "each host once");
});

void test("trade.currency_rates and trade.search price orders: Path of Building's conversion of the hour for the configured league; Total Price; only the two hosts reached", async () => {
  const atStart = Date.now();
  const strong = ["15% increased Fire Damage", "9% increased Damage", "4% increased Cast Speed with Fire Skills", "11% increased Projectile Damage"];
  const jewel = (id: string, amount: number, currency: string, mods = strong) => ({ id, listing: { indexed: "2026-11-14T20:00:00Z", account: { name: "test-seller" }, price: { type: "~price", amount, currency } }, item: { rarity: "Rare", name: "Test Spark", typeLine: "Cobalt Jewel", ilvl: 84, explicitMods: mods.map((description) => ({ description })) } });
  const id = (c: string) => c.repeat(64);
  const listings: Record<string, ReturnType<typeof jewel>[]> = {
    many: [jewel(id("a"), 1, "mirror"), jewel(id("b"), 2, "chaos"), jewel(id("c"), 3, "exalted"), jewel(id("d"), 1, "divine")],
    two: [jewel(id("a"), 1, "mirror"), jewel(id("d"), 1, "divine")],
    unpriced: [jewel(id("e"), 7, "fusing"), jewel(id("b"), 2, "chaos"), jewel(id("9"), 1, "constructor")],
    build: [jewel(id("a"), 1, "mirror"), jewel(id("f"), 1, "chaos", ["+5 to maximum Life"]), jewel(id("b"), 2, "chaos")],
  };
  const generous = { "x-rate-limit-rules": "Ip", "x-rate-limit-ip": "100:10:0", "x-rate-limit-ip-state": "1:10:0" };
  const recorded = site((s) => {
    if (s.url === STATIC_URL) return { body: staticData };
    if (EXCHANGE.test(s.url)) return { body: exchange };
    if (s.url.endsWith("/api/trade/data/leagues")) return { headers: generous, body: { result: [{ id: "Standard", realm: "pc" }, { id: LEAGUE, realm: "pc" }] } };
    // a search answers with its query's name as the search id, and the fetch with that name's listings
    const fetched = s.url.match(/[?&]query=(\w+)/)?.[1];
    if (fetched) return { headers: generous, body: { result: listings[fetched] } };
    const name = (JSON.parse(s.body ?? "{}") as { query?: { name?: string } }).query?.name ?? "";
    return { headers: generous, body: { id: name, result: (listings[name] ?? []).map((l) => l.id), total: 4 } };
  });
  const srv = await startServer({ tradeLeague: LEAGUE }, { fetch: recorded.fetch });
  try {
    const version = ((await (await fetch(`http://127.0.0.1:${srv.port}/health/deep`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()) as { pobVersion: string }).pobVersion;
    type Rates = { realm: string; league: string; hour: number; rates: Record<string, number>; cached: boolean };
    const r = await srv.call<Rates>("GET", "/v1/trade/currency-rates");
    assert.equal(r.status, 200, JSON.stringify(r.body.error));
    assert.deepEqual([r.body.result.realm, r.body.result.league, r.body.result.rates, r.body.result.cached], ["pc", LEAGUE, covens, false]);
    const declared = (name: string) => routes.find((x) => x.name === name)?.output;
    assert.ok(declared("trade.currency_rates")?.safeParse(r.body.result).success, "the answer matches its declared output");
    assert.deepEqual(recorded.sent.map((s) => s.url), [STATIC_URL, `https://web.poecdn.com/api/currency-exchange/${r.body.result.hour}`]);
    assert.ok([exchangeHour(atStart), exchangeHour(Date.now())].includes(r.body.result.hour), "the last complete hour, as PullCXData asks");
    for (const s of recorded.sent) assert.deepEqual(s.headers, { "user-agent": `Path of Building/${version} (api; fork)` });
    assert.equal((await srv.call<Rates>("GET", "/v1/trade/currency-rates")).body.result.cached, true);
    const refused = await srv.call("GET", "/v1/trade/currency-rates?league=Standard");
    assert.deepEqual([refused.status, refused.body.error?.message], [400, "league Standard is refused: this server's trade league is Covens, the league being played"]);
    assert.equal(recorded.sent.length, 2, "the cache and the refusal send nothing");

    type Answer = { searches: Array<{ order: string; listings: Array<{ id: string; divines?: number | null; score: { gain: number } | null }> }>; total: { prices: Array<{ currency: string; amount: number }>; divines: number | null } | null; rates: { hour: number; cached: boolean } | null };
    const search = async (body: Record<string, unknown>, ...names: string[]) => {
      const a = await srv.call<Answer>("POST", "/v1/trade/search", { ...body, searches: names.map((name, n) => ({ query: { name, n }, listings: 4 })) });
      assert.equal(a.status, 200, JSON.stringify(a.body.error));
      return a.body;
    };
    // Price, cheapest first, each listing in divines; the rates come from the hour's cache.
    const { result: byPrice } = await search({ order: "price" }, "many");
    assert.deepEqual(byPrice?.searches[0]?.listings.map((l) => [l.id[0], l.divines]), [["b", 0.01], ["c", 0.225], ["d", 1], ["a", 300]]);
    assert.deepEqual([byPrice?.searches[0]?.order, byPrice?.rates?.cached, byPrice?.total], ["price", true, { prices: [{ currency: "chaos", amount: 2 }], divines: 0.01 }]);
    assert.ok(declared("trade.search")?.safeParse(byPrice).success, "trade.search's answer matches its declared output");

    // Total Price over two searches: the first listing of each, most valuable currency first.
    const both = await search({ order: "price" }, "two", "many");
    assert.deepEqual(both.result.total, { prices: [{ currency: "divine", amount: 1 }, { currency: "chaos", amount: 2 }], divines: 1.01 });

    // A listing the rates do not price: the site's order, as Path of Building falls back, and no total in divines.
    const fallback = await search({ order: "price" }, "unpriced");
    assert.deepEqual([fallback.result.searches[0]?.order, fallback.result.searches[0]?.listings.map((l) => [l.id[0], l.divines])], ["site", [["e", null], ["b", 0.01], ["9", null]]]);
    assert.deepEqual(fallback.warnings, ["search 1: no Covens rate for constructor, fusing; ordered by site instead of price"]);
    assert.deepEqual(fallback.result.total, { prices: [{ currency: "fusing", amount: 7 }], divines: null });

    // With a build: gain, and gain less 0.1 x log10(divines), on the same three listings.
    const xml = await readFile(join(FIXTURES, "witch-elementalist-3_30.xml"), "utf8");
    const buildId = (await srv.call<{ build: { id: string } }>("POST", "/v1/builds/import/xml", { xml })).body.result.build.id;
    await srv.call("POST", `/v1/tree/${buildId}/allocate`, { nodes: [41263] });
    const { result: byGain } = await search({ buildId, order: "gain", fields: ["CombinedDPS"] }, "build");
    const { result: value } = await search({ buildId, order: "gainPrice", fields: ["CombinedDPS"] }, "build");
    const gains = byGain?.searches[0]?.listings.map((l) => [l.id[0], l.score?.gain]);
    assert.deepEqual(gains?.map((g) => g[0]), ["a", "b", "f"], "gain: the two strong jewels in the site's order, then the weak one");
    assert.deepEqual(value?.searches[0]?.listings.map((l) => [l.id[0], l.divines]), [["b", 0.01], ["f", 0.005], ["a", 300]], "the strong jewel at 2 chaos, the weak one at 1 chaos, the strong one at a mirror");
    const noBuild = await srv.call("POST", "/v1/trade/search", { order: "gainPrice", searches: [{ query: {} }] });
    assert.deepEqual([noBuild.status, noBuild.body.error?.message], [400, "order gainPrice scores listings: give buildId"]);

    assert.deepEqual(new Set(recorded.sent.map((s) => new URL(s.url).hostname)), new Set(TRADE_HOSTS), "no host but the two");
    assert.equal(recorded.sent.filter((s) => s.url === STATIC_URL || EXCHANGE.test(s.url)).length, 2, "the rates were asked once");
  } finally {
    await srv.close();
  }
});
