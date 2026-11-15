// Outbound requests for build imports and the browser view's relay (trade.ts is the other outbound module). Host allowlist, https only, a timeout, a size cap,
// a descriptive User-Agent, redirects followed by hand only to allowlisted hosts, and a per-host pause
// whenever a host signals one (Retry-After, X-Rate-Limit-* state).
import { unzipSync } from "node:zlib";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import type { Logger } from "./log.js";

/** Download hosts of the build sites in src/Modules/BuildSiteTools.lua. */
export const SHARE_HOSTS = ["maxroll.gg", "api.pob.codes", "pobb.in", "poe.ninja", "pastebin.com", "pastebinp.com", "rentry.co", "poedb.tw"] as const;

/** The game site: character import (character-window endpoints, as src/Classes/ImportTab.lua uses). */
export const GAME_HOST = "www.pathofexile.com";

/**
 * What the browser view may fetch through the server (POST /v1/fetch): host -> allowed path prefixes
 * (a prefix not ending in "/" is a whole segment) and whether POST is allowed (build sites take shared
 * builds; the game site is read only).
 */
export const RELAY_PATHS: Readonly<Record<string, { paths: readonly string[]; post: boolean }>> = {
  [GAME_HOST]: { paths: ["/character-window/get-characters", "/character-window/get-passive-skills", "/character-window/get-items"], post: false },
  ...Object.fromEntries(SHARE_HOSTS.map((h) => [h, { paths: ["/"], post: true }])),
};

const relayEntry = (url: URL): string | undefined =>
  RELAY_PATHS[url.hostname]?.paths.find((p) => (p.endsWith("/") ? url.pathname.startsWith(p) : url.pathname === p || url.pathname.startsWith(`${p}/`)));

/** Response headers handed back to the page from a relayed request. */
const RELAY_HEADERS = /^(content-type|retry-after|cf-mitigated|x-rate-limit-[a-z0-9-]+)$/;

export interface Relayed {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const MAX_REDIRECTS = 3;

/** "a:b:c,d:e:f" -> [[a,b,c],[d,e,f]] (the publisher's X-Rate-Limit-* header form). */
const triples = (v: string | null): number[][] => (v ?? "").split(",").filter(Boolean).map((t) => t.split(":").map(Number));

export class Fetcher {
  /** Per host: no request before this time (ms), set from the host's own Retry-After and rate-limit state. */
  private readonly holdUntil = new Map<string, number>();

  constructor(
    private readonly cfg: Pick<Config, "fetchUserAgent" | "fetchTimeoutMs" | "fetchMaxBytes">,
    private readonly log: Logger,
    private readonly allow: readonly string[] = SHARE_HOSTS,
    private readonly fetchImpl?: typeof fetch, // default: the global fetch at call time
  ) {}

  private check(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ApiError("invalid_input", "not a valid URL");
    }
    if (url.protocol !== "https:" || url.username || url.password || (url.port !== "" && url.port !== "443")) {
      throw new ApiError("invalid_input", "only plain https URLs are fetched");
    }
    if (!this.allow.includes(url.hostname)) throw new ApiError("invalid_input", `host ${url.hostname} is not on the allowlist`);
    return url;
  }

  private relayCheck(raw: string): URL {
    const url = this.check(raw);
    if (/%(2f|5c|2e)/i.test(url.pathname)) throw new ApiError("invalid_input", "an encoded separator or dot is not relayed");
    if (relayEntry(url) === undefined) throw new ApiError("invalid_input", `that path on ${url.hostname} is not on the allowlist`);
    return url;
  }

  /** Refuses a request while the host has asked us to wait. */
  private waitCheck(host: string): void {
    const wait = Math.ceil(((this.holdUntil.get(host) ?? 0) - Date.now()) / 1000);
    if (wait > 0) throw new ApiError("rate_limited", `${host} asked for a pause; try again in ${wait}s`, { retryAfterSeconds: wait });
  }

  /** Obeys the host: Retry-After on 429, and any X-Rate-Limit-<rule> at its limit or under restriction. */
  private learn(host: string, res: Response): void {
    let wait = 0;
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after"));
      wait = Number.isFinite(retry) && retry > 0 ? retry : 60;
    }
    for (const rule of (res.headers.get("x-rate-limit-rules") ?? "").split(",").map((r) => r.trim().toLowerCase()).filter(Boolean)) {
      const policy = triples(res.headers.get(`x-rate-limit-${rule}`));
      triples(res.headers.get(`x-rate-limit-${rule}-state`)).forEach(([hits = 0, period = 0, restricted = 0], i) => {
        const max = policy[i]?.[0];
        if (restricted > 0) wait = Math.max(wait, restricted);
        else if (max !== undefined && hits >= max) wait = Math.max(wait, period);
      });
    }
    if (wait > 0) {
      this.holdUntil.set(host, Date.now() + wait * 1000);
      this.log.warn({ event: "fetch.hold", host, wait_s: wait }, "host asked for a pause");
    }
  }

  /** One request with redirects followed by hand; each hop re-checked, a hop off the allowlist is an upstream failure. */
  private async send(first: URL, init: { method: string; headers: Record<string, string>; body?: string }, purpose: string, recheck: (raw: string) => URL): Promise<{ res: Response; url: URL }> {
    let url = first;
    let req = init;
    const started = Date.now();
    for (let hop = 0; ; hop++) {
      this.waitCheck(url.hostname);
      let res: Response;
      try {
        res = await (this.fetchImpl ?? fetch)(url, { ...req, redirect: "manual", headers: { ...req.headers, "user-agent": this.cfg.fetchUserAgent }, signal: AbortSignal.timeout(this.cfg.fetchTimeoutMs) });
      } catch (e) {
        this.log.warn({ event: "fetch.done", purpose, host: url.hostname, ok: false, duration_ms: Date.now() - started, reason: (e as Error).name });
        throw new ApiError("upstream_fetch_failed", `request to ${url.hostname} failed: ${(e as Error).name}`);
      }
      this.learn(url.hostname, res);
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (hop >= MAX_REDIRECTS) throw new ApiError("upstream_fetch_failed", `too many redirects from ${url.hostname}`);
        try {
          url = recheck(new URL(location, url).toString());
        } catch {
          this.log.warn({ event: "fetch.done", purpose, host: url.hostname, status: res.status, ok: false, reason: "redirect_refused" });
          throw new ApiError("upstream_fetch_failed", `${url.hostname} redirected off the allowlist`);
        }
        if (res.status !== 307 && res.status !== 308) req = { method: "GET", headers: req.headers };
        continue;
      }
      this.log.info({ event: "fetch.done", purpose, host: url.hostname, status: res.status, ok: res.ok, duration_ms: Date.now() - started });
      return { res, url };
    }
  }

  private async body(res: Response, url: URL, purpose: string): Promise<string> {
    try {
      return await readCapped(res, this.cfg.fetchMaxBytes, url.hostname);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      this.log.warn({ event: "fetch.body_failed", purpose, host: url.hostname, reason: (e as Error).name });
      throw new ApiError("upstream_fetch_failed", `reading the response from ${url.hostname} failed: ${(e as Error).name}`);
    }
  }

  /**
   * GETs text from an allowlisted host. Errors are upstream_fetch_failed with the status, never the body;
   * a 429 is rate_limited with the host's Retry-After.
   */
  async text(raw: string, purpose: string, accept = "text/plain, */*"): Promise<string> {
    const { res, url } = await this.send(this.check(raw), { method: "GET", headers: { accept } }, purpose, (r) => this.check(r));
    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after"));
        throw new ApiError("rate_limited", `${url.hostname} is limiting requests; try again later`, Number.isFinite(retry) && retry > 0 ? { retryAfterSeconds: retry } : undefined);
      }
      throw new ApiError("upstream_fetch_failed", `${url.hostname} answered ${res.status}`, { status: res.status });
    }
    return this.body(res, url, purpose);
  }

  /**
   * Fetches for the browser view: allowlisted host and path, GET (POST with a body), only accept and
   * content-type forwarded, the upstream status passed back as is (Path of Building reads 4xx itself).
   */
  async relay(raw: string, headers: Record<string, string>, body: string | undefined): Promise<Relayed> {
    const first = this.relayCheck(raw);
    if (body !== undefined && !RELAY_PATHS[first.hostname]?.post) throw new ApiError("invalid_input", `${first.hostname} is fetched with GET only (no body)`);
    const purpose = `relay:${relayEntry(first) ?? "/"}`; // the allowlist entry, never the path: it can carry an account name
    const sent: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === "accept" || k.toLowerCase() === "content-type") sent[k.toLowerCase()] = v;
    const { res, url } = await this.send(first, { method: body === undefined ? "GET" : "POST", headers: sent, ...(body === undefined ? {} : { body }) }, purpose, (r) => this.relayCheck(r));
    const back: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (RELAY_HEADERS.test(k)) back[k] = v;
    });
    return { status: res.status, headers: back, body: await this.body(res, url, purpose) };
  }
}

export async function readCapped(res: Response, max: number, host: string): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new ApiError("upstream_fetch_failed", `${host} response is larger than ${max} bytes`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.byteLength;
    if (size > max) throw new ApiError("upstream_fetch_failed", `${host} response is larger than ${max} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Build code -> XML: base64url, then zlib or gzip (ImportTab.lua:632), inflated under a size cap. */
export function decodeBuildCode(code: string, maxXmlBytes: number): string {
  const clean = code.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_=-]+$/.test(clean)) throw new ApiError("invalid_input", "a build code is base64url text");
  let xml: Buffer;
  try {
    xml = unzipSync(Buffer.from(clean.replace(/-/g, "+").replace(/_/g, "/"), "base64"), { maxOutputLength: maxXmlBytes });
  } catch (e) {
    const tooBig = (e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE";
    throw new ApiError(tooBig ? "payload_too_large" : "invalid_input", tooBig ? `build XML is larger than ${maxXmlBytes} bytes` : "not a valid build code");
  }
  return xml.toString("utf8");
}
