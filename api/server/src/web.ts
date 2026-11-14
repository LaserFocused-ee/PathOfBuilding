// The browser view's server side: cookie sessions (the page's EventSource cannot send an Authorization
// header) and the static mount of the built page (api/web/dist).
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import express, { type Request } from "express";
import type { Logger } from "./log.js";

/** On an https public origin the cookie takes the __Host- prefix (Secure, host-only, Path=/). */
export const sessionCookieName = (publicOrigin: string | undefined) => (publicOrigin?.startsWith("https:") ? "__Host-pob_session" : "pob_session");
export const SESSION_SECONDS = 30 * 24 * 3600;
const MAX_SESSIONS = 1000; // ponytail: in-memory sessions for one user; a restart signs the page out

const hash = (id: string) => createHash("sha256").update(id).digest("hex");

/** Sessions held in memory by the hash of their id, each with an expiry. */
export class Sessions {
  private readonly expiry = new Map<string, number>(); // insertion order = oldest first

  create(now = Date.now()): string {
    for (const [k, t] of this.expiry) if (t <= now) this.expiry.delete(k);
    while (this.expiry.size >= MAX_SESSIONS) {
      const oldest = this.expiry.keys().next().value;
      if (oldest === undefined) break;
      this.expiry.delete(oldest);
    }
    const id = randomBytes(32).toString("base64url");
    this.expiry.set(hash(id), now + SESSION_SECONDS * 1000);
    return id;
  }

  valid(id: string | undefined, now = Date.now()): boolean {
    if (!id) return false;
    const t = this.expiry.get(hash(id));
    return t !== undefined && t > now;
  }

  delete(id: string | undefined): void {
    if (id) this.expiry.delete(hash(id));
  }
}

/** One cookie's value from the Cookie header. */
export function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export const sessionCookie = (name: string, value: string, maxAge: number, secure: boolean) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

/** The page's policy (the browser view's serve contract, api/web/README.md). */
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".json": "application/json",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

/** Serves the built page from dir at / (GET and HEAD, no listing, no fallback); a missing dir is not mounted. */
export function mountWeb(app: express.Express, dir: string, log: Logger): void {
  if (!existsSync(dir)) {
    log.info({ event: "web.not_mounted", dir }, "browser view not built; nothing served at /");
    return;
  }
  const root = resolve(dir);
  app.use(
    express.static(root, {
      index: "index.html",
      redirect: false,
      dotfiles: "ignore",
      fallthrough: true,
      setHeaders: (res, path) => {
        // Cross-origin isolation, which the page's threads (SharedArrayBuffer) need.
        res.setHeader("cross-origin-opener-policy", "same-origin");
        res.setHeader("cross-origin-embedder-policy", "require-corp");
        res.setHeader("cross-origin-resource-policy", "same-origin");
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("content-security-policy", CSP);
        res.setHeader("content-type", TYPES[extname(path).toLowerCase()] ?? "application/octet-stream");
        const rel = `/${relative(root, path).split(sep).join("/")}`;
        res.setHeader("cache-control", rel.startsWith("/assets/") || rel.startsWith("/pob/") ? "public, max-age=31536000, immutable" : "no-cache");
      },
    }),
  );
  log.info({ event: "web.mounted" }, "browser view served at /");
}
