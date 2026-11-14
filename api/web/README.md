# Browser view

The real Path of Building UI in the browser, kept in step with the API server's build store. It is a self-hosted build
of [pob-web](https://github.com/atty303/pob-web): the unmodified Path of Building Lua runs on a Lua 5.2 VM compiled to
WebAssembly and draws its own UI through WebGL2. The Lua it runs is this repository's own `src/` at one commit, the same
tree the API server's workers run, so the page and the API calculate the same numbers.

- `/` lists the builds the server stores.
- `/?build=<id>` opens one. The page loads the build's code and revision from the server, follows the build's event
  stream and reloads when another client (the HTTP API, an MCP client) makes a newer revision. Changes made in the page
  are written back with the revision they were based on; if the server moved on in the meantime the page shows the
  conflict and offers to load the server's version or overwrite it. Logic and tests: `src/sync.ts`.

Path of Building's own network features (import from a link, character import) are off in the page; import through the
API instead. Builds saved with Path of Building's own Save button stay in the browser's storage.

## Build

Requirements: git, gcc, cmake, ninja, python3 (for emsdk) and [Deno](https://deno.com) 2.9 or later. No root access: the
toolchain (Emscripten through emsdk) and pob-web's dependencies are installed into `api/web/.build` (about 5 GB plus
about 1 GB per packed commit, gitignored).

```sh
api/web/build-web.sh            # packs the sources at HEAD
api/web/build-web.sh <commit>   # or at another commit: use the commit the API server runs
```

Output: `api/web/dist` (about 620 MB, mostly tree and item art), a static site. The packed sources live under
`dist/pob/<version>/`, where `<version>` is the first ten characters of the commit; `pack-manifest.json` there lists the
source commit, the pob-web commit, every rewrite and every packed file with its SHA-256.

The pack step:

1. stages `src/`, `runtime/lua/` and the root metadata files with `git archive` at the commit (never the working tree);
2. rewrites LuaJIT compound assignment (`x += 1`, `s ..= t`), which the browser VM does not parse, into plain assignment
   (`tools/transform.ts`); upstream files are never edited;
3. parses every packed Lua file with the browser VM's own parser built natively (`tools/parse-check.c`) and fails on any
   file that does not parse;
4. packs with pob-web's packer and writes the manifest;
5. builds the page (`src/`) inside pob-web's workspace with Vite, after a type check against the driver.

Checks for this directory: `cd api/web && deno task check` (format, lint, type check, unit tests).

## Serve contract

Serve `dist/` at the root of the same origin as the API (`/v1/...`), so the page reaches the API without CORS and its
session cookie applies. GET and HEAD only; `/` serves `index.html`; no directory listings. Every response from `dist/`
needs these headers, because the driver shares memory between workers (`SharedArrayBuffer`), which browsers allow only
on a cross-origin isolated page:

| Header                         | Value                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `Cross-Origin-Opener-Policy`   | `same-origin`                                                                            |
| `Cross-Origin-Embedder-Policy` | `require-corp`                                                                           |
| `Cross-Origin-Resource-Policy` | `same-origin`                                                                            |
| `X-Content-Type-Options`       | `nosniff`                                                                                |
| `Cache-Control`                | `public, max-age=31536000, immutable` under `/assets/` and `/pob/`; `no-cache` elsewhere |

Content types by extension: `.html` `text/html; charset=utf-8`, `.js` `text/javascript`, `.css` `text/css`, `.wasm`
`application/wasm` (required for streaming compilation), `.woff` `font/woff`, `.json` `application/json`, `.zip`
`application/zip`, `.png` `image/png`, `.jpg` `image/jpeg`, anything else (the `.dds.zst` textures)
`application/octet-stream`.

The page calls these API routes, all same-origin: `POST /v1/session` (exchanges the API token for a session cookie once,
when a call answers 401), `GET /v1/builds`, `GET /v1/builds/:id`, `GET /v1/builds/:id/code`, `PUT /v1/builds/:id/code`
with `{ code, baseRevision }` (409 `stale_revision` when the base is old) and the event stream
`GET /v1/builds/:id/events` (`hello`, `change` and `deleted` events carrying `revision`).

## Development

`tools/dev-server.ts` (development only) serves `dist/` with the headers above on a loopback port and proxies `/v1` to a
running API server, adding the API token, so no session is needed:

```sh
POB_API_URL=http://127.0.0.1:8730 POB_API_TOKEN=<token> \
  deno run --allow-net --allow-read --allow-env api/web/tools/dev-server.ts 8740
```

## Browsers

Needs WebAssembly, WebGL2, module workers and `SharedArrayBuffer` (cross-origin isolation): current Chrome, Edge,
Firefox, and Safari 15.2 or later (the first Safari with `SharedArrayBuffer` under cross-origin isolation; not tested by
this package). A GPU is not needed for correct numbers (all calculation is Lua); without one the browser draws with its
software renderer, more slowly. The UI is drawn for at least 1550 by 800 pixels; on smaller windows the driver scales it
and offers pan and zoom controls.

Keyboard: the canvas takes every key, Tab included, because Path of Building uses them. F6 moves focus from the canvas
to the page's bar.

## Licences

MIT, like Path of Building. Third-party components and their pinned versions: `THIRD-PARTY.md`. This project is not
affiliated with or endorsed by Grinding Gear Games.
