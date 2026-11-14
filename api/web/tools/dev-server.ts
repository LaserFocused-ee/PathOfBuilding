// Development only (not shipped): serves api/web/dist with the headers in README.md "Serve contract"
// and proxies /v1 to a running API server, adding its bearer token so the page needs no session.
// Usage: POB_API_URL=http://127.0.0.1:<port> POB_API_TOKEN=... deno run --allow-net --allow-read --allow-env \
//          tools/dev-server.ts [port]
import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";

const dist = Deno.env.get("POB_WEB_DIST") ?? fromFileUrl(new URL("../dist", import.meta.url));
const api = Deno.env.get("POB_API_URL") ?? "http://127.0.0.1:8080";
const token = Deno.env.get("POB_API_TOKEN") ?? "";

/** Same origin only; WebAssembly compilation allowed; inline styles for the page and the driver's overlay. */
export const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; " +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** The headers every static response needs (cross-origin isolation for SharedArrayBuffer). */
export function staticHeaders(path: string, headers: Headers): Headers {
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-embedder-policy", "require-corp");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", CSP);
  if (path.endsWith(".wasm")) headers.set("content-type", "application/wasm");
  const immutable = path.startsWith("/assets/") || path.startsWith("/pob/");
  headers.set("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  return headers;
}

Deno.serve({ hostname: "127.0.0.1", port: Number(Deno.args[0] ?? 0) }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/v1/")) {
    const headers = new Headers(req.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.delete("cookie");
    return await fetch(api + url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual",
    });
  }
  const res = await serveDir(req, { fsRoot: dist, quiet: true });
  return new Response(res.body, { status: res.status, headers: staticHeaders(url.pathname, new Headers(res.headers)) });
});
