// Trade searches on the official trade site, on request only (spec F3, "Trade search from the server").
// Path of Building's own request shapes (src/Classes/TradeQueryRequests.lua) and client string; the host is fixed;
// one limiter for the whole process, reading the site's rate-limit headers as TradeQueryRateLimiter.lua does, pacing
// at half of every stated window (a quarter for background callers). No account, no cookies, no retries: a 429 or
// any 4xx stops the call. Nothing here repeats a search by itself.
import { z } from "zod";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import { readCapped } from "./fetch.js";
import type { Logger } from "./log.js";

export const TRADE_HOST = "www.pathofexile.com";
const ORIGIN = `https://${TRADE_HOST}/`;

export type Priority = "interactive" | "background";
export type TradeRealm = "pc" | "xbox" | "sony";
type Policy = "search" | "fetch" | "leagues";
const POLICIES: readonly Policy[] = ["search", "fetch", "leagues"];

/** Share of each stated window a caller may use. */
const SHARE: Record<Priority, number> = { interactive: 0.5, background: 0.25 };
/** Before the site has stated its windows: one request at a time, at most 1 per 10 s. */
const FIRST_RULES = [{ limit: 2, period: 10, hits: 0 }];
const CACHE_MS = 10 * 60_000;
const LEAGUES_CACHE_MS = 60 * 60_000; // leagues change at league start only

const CACHE_ENTRIES = 100; // ponytail: oldest-first eviction; an LRU only if repeated asks show it matters
const FETCH_BLOCK = 10;
const ID = /^[A-Za-z0-9]{1,128}$/;
/** A league name as the trade routes take it. */
export const LEAGUE_NAME = /^[A-Za-z0-9][A-Za-z0-9 '-]*$/;
/** The leagues that last, in the order Path of Building lists them after the current ones (TradeQuery.lua). */
const PERMANENT = ["Standard", "Hardcore", "Ruthless", "Hardcore Ruthless"];
/** A league that is not the softcore trade league being played. */
const VARIANT = /\b(Hardcore|HC|Ruthless|SSF)\b/;

interface Window {
  limit: number;
  /** Seconds. */
  period: number;
  /** Hits the site reported in this window at `siteAt`. */
  hits: number;
}

interface PolicyState {
  rules: Window[];
  siteAt: number;
  sent: number[];
  holdUntil: number;
  queued: number;
  lock: Promise<void>;
}

export interface LimiterState {
  policy: Policy;
  /** Requests a caller of each priority may still send now. */
  remaining: Record<Priority, number>;
  /** Seconds until a caller of each priority may send (0 = now). */
  retryAfterSeconds: Record<Priority, number>;
  windows: Array<{ limit: number; periodSeconds: number; used: number }>;
}

/** "a:b:c,d:e:f" -> [[a,b,c],[d,e,f]] (the X-Rate-Limit-* header form). */
const triples = (v: string | null): number[][] => (v ?? "").split(",").filter(Boolean).map((t) => t.split(":").map(Number));

const limited = (policy: Policy, ms: number): ApiError =>
  new ApiError("rate_limited", `the trade ${policy} budget is used up for now; try again in ${Math.ceil(ms / 1000)}s`, { retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) });

export class TradeLimiter {
  private readonly p: Record<Policy, PolicyState>;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    const fresh = (): PolicyState => ({ rules: FIRST_RULES.map((r) => ({ ...r })), siteAt: 0, sent: [], holdUntil: 0, queued: 0, lock: Promise.resolve() });
    this.p = { search: fresh(), fetch: fresh(), leagues: fresh() };
  }

  /** Milliseconds until a request of this priority may go. */
  private wait(policy: Policy, priority: Priority): number {
    const p = this.p[policy];
    const now = this.now();
    let wait = Math.max(0, p.holdUntil - now);
    for (const r of p.rules) {
      const allowed = Math.max(1, Math.floor(r.limit * SHARE[priority]));
      const span = r.period * 1000;
      const ours = p.sent.filter((t) => t > now - span);
      if (ours.length >= allowed) wait = Math.max(wait, (ours[ours.length - allowed] ?? now) + span - now);
      if (p.siteAt > now - span && r.hits >= allowed) wait = Math.max(wait, p.siteAt + span - now);
    }
    return wait;
  }

  /**
   * Sends one request under the policy's lock (one in flight per policy), after waiting for its pace. A background caller
   * never waits: it is refused when anyone is queued or the pace says wait. An interactive caller waits until `deadline`.
   */
  async run(policy: Policy, priority: Priority, deadline: number, send: () => Promise<Response>): Promise<Response> {
    const p = this.p[policy];
    if (priority === "background" && (p.queued > 0 || this.wait(policy, priority) > 0)) throw limited(policy, Math.max(1000, this.wait(policy, priority)));
    const prev = p.lock;
    let release = (): void => undefined;
    p.lock = new Promise<void>((r) => (release = r));
    p.queued++;
    try {
      await prev;
      if (this.now() > deadline) throw limited(policy, 1000); // the request ahead took the time
      for (;;) {
        const wait = this.wait(policy, priority);
        if (wait <= 0) break;
        if (priority === "background" || this.now() + wait > deadline) throw limited(policy, wait);
        await this.sleep(wait);
      }
      const now = this.now();
      p.sent = [...p.sent.filter((t) => t > now - 3_600_000), now];
      const res = await send();
      this.learn(policy, res);
      return res;
    } finally {
      p.queued--;
      release();
    }
  }

  /** The site's stated windows and hits (X-Rate-Limit-Rules, X-Rate-Limit-<rule>, -state), and Retry-After on any 4xx. */
  private learn(policy: Policy, res: Response): void {
    const p = this.p[policy];
    const now = this.now();
    const rules: Window[] = [];
    for (const rule of (res.headers.get("x-rate-limit-rules") ?? "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean)) {
      const state = triples(res.headers.get(`x-rate-limit-${rule}-state`));
      triples(res.headers.get(`x-rate-limit-${rule}`)).forEach(([limit = 0, period = 0], i) => {
        const [hits = 0, , restricted = 0] = state[i] ?? [];
        if (limit > 0 && period > 0) rules.push({ limit, period, hits });
        if (restricted > 0) p.holdUntil = Math.max(p.holdUntil, now + restricted * 1000);
      });
    }
    if (rules.length > 0) {
      p.rules = rules;
      p.siteAt = now;
    }
    if (res.status >= 400 && res.status < 500) {
      const retry = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retry) && retry > 0) p.holdUntil = Math.max(p.holdUntil, now + retry * 1000);
      else if (res.status === 429) p.holdUntil = Math.max(p.holdUntil, now + 60_000);
    }
  }

  state(): LimiterState[] {
    const now = this.now();
    return POLICIES.map((policy) => {
      const p = this.p[policy];
      const windows = p.rules.map((r) => ({
        limit: r.limit,
        periodSeconds: r.period,
        used: Math.max(p.sent.filter((t) => t > now - r.period * 1000).length, p.siteAt > now - r.period * 1000 ? r.hits : 0),
      }));
      const per = (priority: Priority) => {
        const wait = this.wait(policy, priority);
        const left = Math.min(...windows.map((w) => Math.max(1, Math.floor(w.limit * SHARE[priority])) - w.used));
        return { left: wait > 0 ? 0 : Math.max(0, left), wait: Math.ceil(wait / 1000) };
      };
      const [i, b] = [per("interactive"), per("background")];
      return { policy, remaining: { interactive: i.left, background: b.left }, retryAfterSeconds: { interactive: i.wait, background: b.wait }, windows };
    });
  }
}

/** One fetched listing: what the answer shows, and the entry Path of Building's conversion reads (no seller fields). */
export interface TradeEntry {
  id: string;
  indexed: string | null;
  price: { amount: number; currency: string; type: string } | null;
  /** `{ id, item, listing: { price, account: { name: "" } } }`: the shape TradeQueryRequests:FetchResultBlock reads. */
  entry: Record<string, unknown>;
}

export interface TradeResult {
  searchId: string;
  total: number;
  entries: TradeEntry[];
  /** Fetched entries the site sent that were not listings (delisted, or not in the shape). */
  dropped: number;
}

/** What every request to the trade site carries from its caller. */
export interface TradeAsk {
  priority: Priority;
  /** ms since epoch: an interactive caller waits for the pace until then. */
  deadline: number;
  userAgent: string;
}

export interface TradeSearch extends TradeAsk {
  realm: TradeRealm;
  league: string;
  body: Record<string, unknown>;
  listings: number;
}

export interface TradeLeagues {
  /** Not permanent ones first in the site's order, then Standard, Hardcore, Ruthless, Hardcore Ruthless (those the site lists). */
  leagues: string[];
  /** The first league that is not permanent and is not a Hardcore, HC, Ruthless or SSF one; null when the site lists none. */
  current: string | null;
}

const searchReply = z.object({ id: z.string().regex(ID), result: z.array(z.string().regex(ID)), total: z.number().int().min(0) });
const fetchReply = z.object({ result: z.array(z.unknown()) });
const leaguesReply = z.object({ result: z.array(z.unknown()) });
const leagueShape = z.object({ id: z.string().max(64).regex(LEAGUE_NAME), realm: z.string() });
/**
 * A mod line as FetchResultBlock reads it ({ description, flags }); a plain string (the older answer shape, which also keeps
 * crafted and fractured mods in their own lists) is read as its description. Which shape the site sends without an account
 * is checked by the live check after deploy.
 */
const modLine = z.union([z.string().max(500).transform((description) => ({ description })), z.looseObject({ description: z.string().max(500) })]);
const mods = z.array(modLine).max(80).optional();
const listingShape = z.object({
  id: z.string().regex(ID),
  listing: z.object({
    indexed: z.string().max(40).optional(),
    price: z.object({ amount: z.number(), currency: z.string().max(40), type: z.string().max(10) }).optional(),
  }),
  item: z.looseObject({
    rarity: z.string().max(20),
    typeLine: z.string().max(200),
    name: z.string().max(200).optional(),
    enchantMods: mods,
    implicitMods: mods,
    scourgeMods: mods,
    explicitMods: mods,
    craftedMods: mods,
    fracturedMods: mods,
  }),
});

/** The client string of every trade request: the desktop app's, marked as this fork's API, with the operator's contact when one is set. The one place it is built. */
export const tradeClientString = (version: string, contact?: string): string => `Path of Building/${version} (api; fork${contact ? ` +${contact}` : ""})`;

/** The response headers that say when to retry or how the site counts requests, short, for a stop's details. */
const limitHeaders = (res: Response): Record<string, string> =>
  Object.fromEntries([...res.headers].filter(([k]) => /^(retry-after|x-rate-limit-[a-z0-9-]+)$/.test(k)).map(([k, v]) => [k, v.slice(0, 200)]));

/** League as Path of Building's buildUrl encodes it: everything but [A-Za-z0-9-._~] as %XX. */
const encodeLeague = (league: string): string => league.replace(/[^A-Za-z0-9\-._~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

/** `<root>[/<realm>]/<league>`, as TradeQueryRequests:buildUrl (realm pc left out). */
export const tradeUrl = (root: string, realm: TradeRealm, league: string): string => `${ORIGIN}${root}${realm === "pc" ? "" : `/${realm}`}/${encodeLeague(league)}`;

export class TradeClient {
  private readonly cache = new Map<string, { at: number; value: TradeResult }>();
  private readonly leagueCache = new Map<TradeRealm, { at: number; value: TradeLeagues }>();

  constructor(
    private readonly cfg: Pick<Config, "fetchTimeoutMs" | "fetchMaxBytes">,
    private readonly log: Logger,
    private readonly fetchImpl?: typeof fetch, // default: the global fetch at call time
    readonly limiter = new TradeLimiter(),
    private readonly now: () => number = Date.now,
  ) {}

  /** A cached answer for this exact search, if one is younger than 10 minutes. */
  cached(s: Pick<TradeSearch, "realm" | "league" | "body" | "listings">): TradeResult | undefined {
    const hit = this.cache.get(cacheKey(s));
    return hit && this.now() - hit.at < CACHE_MS ? hit.value : undefined;
  }

  /** One search and the fetches for its first `listings` results. Throws ApiError on any stop (the caller stops its batch). */
  async search(s: TradeSearch): Promise<TradeResult> {
    const found = searchReply.safeParse(await this.send("search", s, tradeUrl("api/trade/search", s.realm, s.league), "POST", JSON.stringify(s.body)));
    if (!found.success) throw new ApiError("upstream_fetch_failed", "the trade site's search answer was not in the expected shape");
    const ids = found.data.result.slice(0, s.listings);
    const entries: TradeEntry[] = [];
    let dropped = 0;
    for (let i = 0; i < ids.length; i += FETCH_BLOCK) {
      const url = `${ORIGIN}api/trade/fetch/${ids.slice(i, i + FETCH_BLOCK).join(",")}?query=${found.data.id}`;
      const block = fetchReply.safeParse(await this.send("fetch", s, url, "GET"));
      if (!block.success) throw new ApiError("upstream_fetch_failed", "the trade site's fetch answer was not in the expected shape");
      for (const raw of block.data.result) {
        const e = listingShape.safeParse(raw);
        if (!e.success) {
          dropped++;
          continue;
        }
        const { id, listing, item: { craftedMods, fracturedMods, ...item } } = e.data;
        const explicitMods = [...(fracturedMods ?? []).map((m) => ({ flags: { fractured: true }, ...m })), ...(item.explicitMods ?? []), ...(craftedMods ?? []).map((m) => ({ flags: { crafted: true }, ...m }))];
        entries.push({ id, indexed: listing.indexed ?? null, price: listing.price ?? null, entry: { id, item: { ...item, explicitMods }, listing: { price: listing.price ?? {}, account: { name: "" } } } });
      }
    }
    const value = { searchId: found.data.id, total: found.data.total, entries, dropped };
    this.cache.set(cacheKey(s), { at: this.now(), value });
    for (const key of this.cache.keys()) {
      if (this.cache.size <= CACHE_ENTRIES) break;
      this.cache.delete(key);
    }
    return value;
  }

  /**
   * The realm's trade leagues as the Trade tab lists them (TradeQueryRequests:FetchLeagues, TradeQuery.lua), from a cache
   * younger than an hour or one request. Throws ApiError on any stop; a failed request is not cached.
   */
  async leagues(realm: TradeRealm, ask: TradeAsk): Promise<TradeLeagues & { cached: boolean }> {
    const hit = this.leagueCache.get(realm);
    if (hit && this.now() - hit.at < LEAGUES_CACHE_MS) return { ...hit.value, cached: true };
    const reply = leaguesReply.safeParse(await this.send("leagues", ask, `${ORIGIN}api/trade/data/leagues`, "GET"));
    if (!reply.success) throw new ApiError("upstream_fetch_failed", "the trade site's leagues answer was not in the expected shape");
    const listed = reply.data.result.flatMap((raw) => {
      const e = leagueShape.safeParse(raw);
      return e.success && e.data.realm === realm ? [e.data.id] : [];
    });
    const leagues = [...listed.filter((l) => !PERMANENT.includes(l)), ...PERMANENT.filter((l) => listed.includes(l))];
    const value = { leagues, current: leagues.find((l) => !PERMANENT.includes(l) && !VARIANT.test(l)) ?? null };
    this.leagueCache.set(realm, { at: this.now(), value });
    return { ...value, cached: false };
  }

  private async send(policy: Policy, s: TradeAsk, url: string, method: "GET" | "POST", body?: string): Promise<unknown> {
    const started = this.now();
    const res = await this.limiter.run(policy, s.priority, s.deadline, async () => {
      try {
        // the headers TradeQueryRequests:ProcessQueue sends, and Launch.lua's client string; no cookies, no authorization
        return await (this.fetchImpl ?? fetch)(url, {
          method,
          redirect: "manual",
          headers: { "content-type": "application/json", "user-agent": s.userAgent },
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(this.cfg.fetchTimeoutMs),
        });
      } catch (e) {
        this.log.warn({ event: "trade.request", policy, priority: s.priority, ok: false, duration_ms: this.now() - started, reason: (e as Error).name });
        throw new ApiError("upstream_fetch_failed", `request to the trade site failed: ${(e as Error).name}`);
      }
    });
    this.log.info({ event: "trade.request", policy, priority: s.priority, status: res.status, ok: res.ok, duration_ms: this.now() - started });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      throw new ApiError("upstream_fetch_failed", `the trade site answered ${res.status}; redirects are not followed`, { status: res.status });
    }
    let text: string;
    try {
      text = await readCapped(res, this.cfg.fetchMaxBytes, TRADE_HOST);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("upstream_fetch_failed", `reading the trade site's answer failed: ${(e as Error).name}`);
    }
    if (!res.ok) {
      const retry = Number(res.headers.get("retry-after"));
      const retryAfter = Number.isFinite(retry) && retry > 0 ? { retryAfterSeconds: retry } : res.status === 429 ? { retryAfterSeconds: 60 } : {};
      const headers = limitHeaders(res);
      if (res.status === 429) throw new ApiError("rate_limited", "the trade site is limiting requests; stopped", { status: 429, ...retryAfter, headers });
      // The site's own words only for a refused query (400); any other 4xx (a 403 on the client string, say) is reported by status and headers, never retried.
      const said = res.status === 400 ? siteMessage(text) : "";
      throw new ApiError(res.status === 400 ? "invalid_input" : "upstream_fetch_failed", `the trade site answered ${res.status}${said ? `: ${said}` : ""}`, { status: res.status, ...retryAfter, headers });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ApiError("upstream_fetch_failed", "the trade site's answer was not JSON");
    }
  }
}

const cacheKey = (s: Pick<TradeSearch, "realm" | "league" | "body" | "listings">): string => JSON.stringify([s.realm, s.league, s.listings, s.body]);

/** The site's own error message (`{ error: { message } }`), as plain text and short. */
function siteMessage(text: string): string {
  try {
    const m = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message;
    return typeof m === "string" ? m.replace(/[^\x20-\x7e]/g, "").slice(0, 200) : "";
  } catch {
    return "";
  }
}
