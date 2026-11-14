// The only module that makes outbound requests. Host allowlist, https only, a timeout, a size cap,
// a descriptive User-Agent, and redirects followed by hand only to allowlisted hosts.
import { unzipSync } from "node:zlib";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import type { Logger } from "./log.js";

/** Download hosts of the build sites in src/Modules/BuildSiteTools.lua. */
export const SHARE_HOSTS = ["maxroll.gg", "api.pob.codes", "pobb.in", "poe.ninja", "pastebin.com", "pastebinp.com", "rentry.co", "poedb.tw"] as const;

const MAX_REDIRECTS = 3;

export class Fetcher {
  constructor(
    private readonly cfg: Pick<Config, "fetchUserAgent" | "fetchTimeoutMs" | "fetchMaxBytes">,
    private readonly log: Logger,
    private readonly allow: readonly string[] = SHARE_HOSTS,
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

  /** GETs text from an allowlisted host. Errors are upstream_fetch_failed with the status, never the body. */
  async text(raw: string, purpose: string): Promise<string> {
    let url = this.check(raw);
    const started = Date.now();
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await fetch(url, {
          redirect: "manual",
          headers: { "user-agent": this.cfg.fetchUserAgent, accept: "text/plain, */*" },
          signal: AbortSignal.timeout(this.cfg.fetchTimeoutMs),
        });
      } catch (e) {
        this.log.warn({ event: "fetch.done", purpose, host: url.hostname, ok: false, duration_ms: Date.now() - started, reason: (e as Error).name });
        throw new ApiError("upstream_fetch_failed", `request to ${url.hostname} failed: ${(e as Error).name}`);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel();
        if (hop >= MAX_REDIRECTS) throw new ApiError("upstream_fetch_failed", `too many redirects from ${url.hostname}`);
        url = this.check(new URL(res.headers.get("location") ?? "", url).toString());
        continue;
      }
      this.log.info({ event: "fetch.done", purpose, host: url.hostname, status: res.status, ok: res.ok, duration_ms: Date.now() - started });
      if (!res.ok) {
        await res.body?.cancel();
        throw new ApiError("upstream_fetch_failed", `${url.hostname} answered ${res.status}`, { status: res.status });
      }
      return readCapped(res, this.cfg.fetchMaxBytes, url.hostname);
    }
  }
}

async function readCapped(res: Response, max: number, host: string): Promise<string> {
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
