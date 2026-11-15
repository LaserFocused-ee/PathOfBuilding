// Trade requests through one signed-in tab of a browser on this server (POB_API_TRADE_BROWSER_CDP and _TAB), for trade.search's
// search and fetch: the trade site gives a signed-in search a larger complexity budget. The tab's own page runs a same-origin
// `fetch`, so the browser adds its session by itself. This process never reads, logs or keeps a cookie, a credential or a
// request header: it sends one DevTools command (Runtime.evaluate) to that one tab, and reads back the status, the body and
// the rate-limit headers (x-rate-limit-*, retry-after) only. It never opens, closes or navigates a tab, and never uses
// another one; a tab that is gone or not on the trade site fails the request.
import { ApiError } from "./errors.js";

export interface BrowserTab {
  /** The browser's DevTools HTTP endpoint, loopback only, e.g. http://127.0.0.1:9223. */
  cdp: string;
  /** The DevTools target id of the signed-in tab. */
  tab: string;
}

/** The part of a WebSocket the transport uses (the global one; a fake in tests). */
export interface CdpSocket {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface BrowserDeps {
  /** GET of the DevTools target list. */
  fetch: typeof fetch;
  openSocket: (url: string) => CdpSocket;
}

const SITE = "https://www.pathofexile.com";
export const SIGN_IN = "sign in again in the server browser";
/** The only paths the tab is asked to fetch: trade.search's search and listing fetch. */
const PATHS = /^\/api\/trade\/(search|fetch)\//;

/** What the page answers; `text` is null when the body is over the cap. */
interface PageAnswer {
  origin: string;
  status?: number;
  headers?: Record<string, string>;
  text?: string | null;
}

// Runs in the tab: refuses off the trade site before anything is sent, does not follow a redirect, and copies only the
// rate-limit headers. Arguments are passed as JSON literals, never spliced as code.
const PAGE = `async (site, path, method, body, max) => {
  if (location.origin !== site) return { origin: location.origin };
  const init = { method, credentials: "same-origin", redirect: "manual", headers: body === null ? {} : { "content-type": "application/json" } };
  if (body !== null) init.body = body;
  const r = await fetch(path, init);
  const headers = {};
  r.headers.forEach((v, k) => { if (k.startsWith("x-rate-limit-") || k === "retry-after") headers[k] = v; });
  const text = await r.text();
  return { origin: location.origin, status: r.status, headers, text: text.length > max ? null : text };
}`;

/** The tab's target, read from the DevTools list (no other tab is looked at beyond its id). */
async function target(t: BrowserTab, deps: BrowserDeps, timeoutMs: number): Promise<{ ws: string; url: string }> {
  let list: unknown;
  try {
    const res = await deps.fetch(new URL("/json/list", t.cdp), { signal: AbortSignal.timeout(timeoutMs) });
    list = await res.json();
  } catch (e) {
    throw new ApiError("upstream_fetch_failed", `the server browser does not answer at ${t.cdp} (${(e as Error).name}); start it and ${SIGN_IN}`);
  }
  const found = Array.isArray(list) ? (list as Array<Record<string, unknown>>).find((x) => x.id === t.tab && x.type === "page") : undefined;
  if (!found) throw new ApiError("upstream_fetch_failed", `the server browser's trade tab (${t.tab}) is gone; open the trade site there, ${SIGN_IN}, and set POB_API_TRADE_BROWSER_TAB to its tab`);
  const ws = typeof found.webSocketDebuggerUrl === "string" ? found.webSocketDebuggerUrl : "";
  const url = typeof found.url === "string" ? found.url : "";
  // the socket must be this tab's on the configured endpoint
  const want = new URL(t.cdp);
  let wsUrl: URL;
  try {
    wsUrl = new URL(ws);
  } catch {
    throw new ApiError("upstream_fetch_failed", "the server browser gave no DevTools socket for the trade tab");
  }
  if (wsUrl.host !== want.host || wsUrl.pathname !== `/devtools/page/${t.tab}`) throw new ApiError("upstream_fetch_failed", "the server browser's DevTools socket for the trade tab is not on the configured endpoint");
  return { ws, url };
}

/** One Runtime.evaluate on the tab's socket, answered by value; the socket is closed after. */
function evaluate(deps: BrowserDeps, ws: string, expression: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = deps.openSocket(ws);
    let done = false;
    const finish = (f: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
      f();
    };
    const timer = setTimeout(() => finish(() => reject(new ApiError("upstream_fetch_failed", "the server browser's trade tab did not answer in time"))), timeoutMs);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    socket.onerror = () => finish(() => reject(new ApiError("upstream_fetch_failed", "the server browser's DevTools socket failed")));
    socket.onclose = () => finish(() => reject(new ApiError("upstream_fetch_failed", "the server browser closed its DevTools socket")));
    socket.onmessage = (ev) => {
      let msg: { id?: unknown; result?: { result?: { value?: unknown }; exceptionDetails?: unknown }; error?: unknown };
      try {
        msg = JSON.parse(String(ev.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.id !== 1) return; // events the tab sends meanwhile
      if (msg.error || msg.result?.exceptionDetails) finish(() => reject(new ApiError("upstream_fetch_failed", "the request in the server browser's trade tab failed (network or page error)")));
      else finish(() => resolve(msg.result?.result?.value));
    };
  });
}

/**
 * A `fetch` for trade.search's requests that runs in the signed-in tab. The answer is a Response with the status, the
 * rate-limit headers and the body, so the limiter and the stop rules read it as they read a direct one (TradeClient names a
 * 401 or 403 as a session that is gone).
 */
export function browserFetch(t: BrowserTab, cfg: { fetchTimeoutMs: number; fetchMaxBytes: number }, deps: BrowserDeps): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== SITE || !PATHS.test(url.pathname)) throw new ApiError("worker_error", `refused a browser trade request to ${url.origin}${url.pathname.split("/").slice(0, 4).join("/")}: only trade searches and listing fetches go through the server browser`);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    const { ws, url: at } = await target(t, deps, cfg.fetchTimeoutMs);
    if (!at.startsWith(`${SITE}/`)) throw new ApiError("upstream_fetch_failed", `the server browser's trade tab is not on ${SITE}; open the trade site in that tab and ${SIGN_IN}`);
    const args = [SITE, url.pathname + url.search, method, body, cfg.fetchMaxBytes].map((a) => JSON.stringify(a)).join(", ");
    const answer = (await evaluate(deps, ws, `(${PAGE})(${args})`, cfg.fetchTimeoutMs)) as PageAnswer | undefined;
    if (!answer || typeof answer.origin !== "string") throw new ApiError("upstream_fetch_failed", "the server browser's trade tab gave no answer");
    if (answer.origin !== SITE) throw new ApiError("upstream_fetch_failed", `the server browser's trade tab is not on ${SITE}; open the trade site in that tab and ${SIGN_IN}`);
    const status = Number(answer.status);
    if (status === 0 || (status >= 300 && status < 400)) throw new ApiError("upstream_fetch_failed", "the trade site answered the server browser with a redirect; redirects are not followed");
    if (!Number.isInteger(status) || status < 200 || status > 599) throw new ApiError("upstream_fetch_failed", "the server browser's trade tab gave no status");
    if (answer.text === null || answer.text === undefined) throw new ApiError("payload_too_large", `the trade site's answer in the server browser is over ${cfg.fetchMaxBytes} bytes`);
    const headers = Object.entries(answer.headers ?? {}).filter(([k, v]) => /^(x-rate-limit-[a-z-]+|retry-after)$/.test(k) && typeof v === "string");
    return new Response(answer.text, { status, headers });
  };
}

/** The default sockets: Node's own WebSocket. */
export const nodeSocket = (url: string): CdpSocket => new WebSocket(url) as unknown as CdpSocket;
