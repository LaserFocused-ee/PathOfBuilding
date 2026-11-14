# Path of Building API and MCP: spec and queue

Set 14 Nov 2026. Owner of this file: the orchestrating session. It lives in `.lf/`, outside the shippable `api/` folder, because it names our people, server and private repository; nothing under `api/` may. Features are built in the order listed; each is one pull request into `lf/main`.

## Goal

An AI model controls Path of Building programmatically (HTTP API and MCP), with no computer use, and Justin watches and edits the same build in a browser. One portable package: engine, API, MCP and web view ship together from this repository and run on any Linux host (native or container). Justin plays Path of Exile 1 (patch 3.30, PC) on his Mac; the package runs on the LaserFocused server.

**Shippable as part of Path of Building** (Justin, 14 Nov 2026). Everything under `api/` is written so the Path of Building community could adopt it: it depends on nothing of ours, names no LaserFocused host, service or person, carries no personal tooling, keeps upstream files untouched, and is documented for a stranger (`api/README.md`: what it is, how to build the runtime, run the server, connect an MCP client, and the full route list). Licence: MIT, matching upstream. Anything personal (prices, market watch, dashboards, our server's deploy) lives in the private repository `LaserFocused-ee/poe-advisor` and reaches this package only through its HTTP API and MCP.

## Evidence this design rests on

Research bay, all dated 2026-11-14 (read the report for your area before building):

- `/home/justin/code/research/2026-11-14-pob-headless-spike/report.md` and its `scripts/` (working boot layer `pobh.lua`, runtime build script, measurements).
- `/home/justin/code/research/2026-11-14-pob-architecture-map/report.md` (boot, build model, calc engine, mutation entry points, hazards).
- `/home/justin/code/research/2026-11-14-pob-feature-inventory-and-api-surface/report.md` (187 operations by domain, each marked headless today, small shim, or needs extraction; the 9 MCP tools).
- `/home/justin/code/research/2026-11-14-pob-web-api-mcp-prior-art/report.md` (pob-web for the browser view; why no existing MCP is adopted).
- `/home/justin/code/research/2026-11-14-poe-data-sources-and-trade-apis/report.md` (what the publisher allows; sources and rate limits).

Measured: boot 0.85 s, first calculated build 2.1 s, recalculation 30 ms, about 200 to 240 MB per worker, two builds can live in one Lua state through `LoadModule("Modules/Build")`, process-global caches mean commands are serialized per process.

## Architecture

```
api/
  runtime/      build-runtime.sh: LuaJIT pinned to the upstream Dockerfile commit, lua-utf8; output gitignored
  lua/          worker.lua (boot + JSON-lines loop) and ops/<domain>.lua; runs inside the Path of Building Lua state
  server/       Node 22 + TypeScript: worker pool, build store, HTTP API, MCP, events, static web view mount
  web/          browser view (feature 4)
  deploy/       Dockerfile and an example systemd unit; nothing specific to one host
  docs/         this spec, PROGRESS.md, API.md (generated from the route table), UPSTREAM-PATCHES.md
```

- **Worker** (`api/lua/worker.lua`): replaces `src/HeadlessWrapper.lua` without editing it. Loads `src/_SimpleGraphic.def.lua`, then overrides: `Inflate`/`Deflate` (zlib through LuaJIT FFI), `GetTime` (real clock), `GetUserPath`/`GetScriptPath`/`GetRuntimePath` (a state directory outside the checkout), `Copy` (captured), `Paste` (stays nil), `LaunchSubScript`/`OpenURL` (nil; the host does all network). Sets `main.disableDevAutoSave = true`. All `print`/`ConPrintf` go to stderr; stdout carries only protocol lines. Reads one JSON object per line `{id, op, args}` and answers `{id, ok, result}` or `{id, ok:false, error:{code,message}}`. Every command runs under `pcall`; after it, `launch.promptMsg` and `main.popups` are drained into `warnings` on the response. A mutating command sets `build.buildFlag` and pumps `OnFrame` until the build is calculated before answering, and returns the changed sidebar stats (before and after) unless `diff:false`.
- **Server** (`api/server`): owns everything outside the Lua state: HTTP, MCP, auth, the build store, network fetches, worker lifecycle. One worker process per open build session; pool size from config; idle workers are recycled least-recently-used; a worker over its memory ceiling or past a command timeout is killed and its session reloaded from the store on next use (cold start is about 2 s). Commands to one worker are queued one at a time.
- **Build store**: the server is the source of truth. Each build is `{id, name, revision, xml, updatedAt, source}` on disk under the data directory (one XML file plus one JSON metadata file per build; no database). Every successful mutation exports XML from the worker, increments `revision` and emits an event. Writes that carry a `baseRevision` older than the current one are refused with `409 stale_revision`.
- **Events**: `GET /v1/builds/:id/events` (server-sent events) emits `{revision, cause, changedStats}` after each change. The web view and any other client use it to stay in step.
- **HTTP API**: `/v1/<domain>/...` routes, one per operation, declared in a single route table (name, domain, method, path, input schema, output schema, read-only flag, worker op). `docs/API.md` and the MCP tools are generated from that table, so the three cannot drift. Errors use registered codes (`not_found`, `invalid_input`, `stale_revision`, `worker_error`, `worker_timeout`, `unsupported`, `upstream_fetch_failed`, `rate_limited`).
- **MCP**: 9 tools, each listed once it has at least one action, each with an `action` enum over the routes of its domain: `pob_build`, `pob_stats`, `pob_tree`, `pob_skills`, `pob_items`, `pob_config`, `pob_evaluate`, `pob_lookup`, `pob_trade`. Underscore names, accurate `readOnlyHint`, `structuredContent` plus a text mirror, failures as `isError: true`, results kept under 25,000 tokens by default with paging or a `fields` selector. Served two ways from the same code: Streamable HTTP at `POST /mcp` (stateless, legacy protocol era) and a stdio entry point. Follow `~/.claude/skills/mcp-connector-build/SKILL.md` section 1 and 4; OAuth is out of scope (single user, bearer token).
- **Auth**: single user. A bearer token from config guards `/v1` and `/mcp`. `/health` and `/health/deep` are open. The browser view gets a cookie session issued by exchanging the same token once (feature 4). Token compare is constant-time. No tool or route takes a user id.
- **Network fetches** (host only): build imports from links Justin supplies (pobb.in, pastebin, Maxroll, poe.ninja share links, the hosts in `src/Modules/BuildSiteTools.lua`), public-profile character import, Fetches go through one module with a host allowlist, a timeout, a size cap, a descriptive User-Agent from config, and no redirects to hosts off the allowlist. No credentials for the game publisher's site are stored.
- **Server rules**: no bare `console.*` (one logger module, JSON lines to stdout for journald); environment read and validated in one config module; `/health` and `/health/deep` (deep boots or pings a worker and reports Path of Building version, tree version and pool state); a boundary log line per request and per worker command; errors captured with an explicit fingerprint when the error-tracking variable is configured. Host-specific deploy and observability files live in the private repository, not here.

## Features (the queue)

### F1. Engine and read path (first pull request)

Runtime build script; worker boot; JSON-lines protocol; server skeleton with config, logger, health, auth, worker pool, build store, events; route table and generated `API.md`; MCP over HTTP and stdio; these operations:

- builds: new (class, ascendancy, level, tree version defaulting to latest), load from XML, load from build code, load from a supported share link, list, get metadata, rename, duplicate, delete, export XML, export build code, save point (store revision), history of revisions (keep the last 50).
- stats: sidebar stats (the `displayStats` list with labels and formatted values), full output table for the main skill with a `fields` filter, per-skill outputs and FullDPS, calculation breakdown for one output key, warnings, requirement and resistance summary, passive point budget, game and tree version.
- lookup (read-only data): gems (search, tags, requirements), uniques (search, text), bases, tree nodes (search by name or stat text, node detail), config option catalogue (all options with type, section, allowed values, current value).

Done when: from a clean checkout, `api/runtime/build-runtime.sh` then `npm ci && npm run build && npm test` in `api/server` pass; the worker test loads a fixture build and a build made on tree 3_30 and asserts concrete stat values; a build code round-trips byte-exact; an MCP client can list tools and read a loaded build's stats; a second build loads in a second session while the first stays open; killing a worker mid-session is recovered from the store.

### F2. Full edit path

Every mutation the application offers, each returning the stat diff:

- tree: class and ascendancy (including secondary/Bloodline), allocate and deallocate nodes (single, list, and by path to a target), masteries, jewel sockets, tattoos or current overrides, import and export tree URL, tree specs (list, new, copy, rename, delete, activate), convert to latest tree version, shortest path between two nodes.
- skills: socket groups (add, edit, remove, reorder, enable, slot), gems (add, set level, quality, quality type or variant, enabled, count), main group and main active skill, skill part, stages, mines, minion and spectre choice, skill sets, paste a group from text, default gem level and quality settings.
- items: create from pasted item text, list, get (parsed mods and tooltip), edit variant, ranges, quality, sockets and links, anoint, enchant, craft (add or remove bench and custom modifiers, influences, corrupt implicit choice where the application offers it), equip and unequip by slot (including weapon swap, flasks, tinctures, jewels into tree sockets, abyss sockets), activate flasks, item sets, delete, add a unique from the database by name with variant, add a rare from the template database.
- config: set and clear any of the config options, enemy presets, bandit, pantheon, custom modifiers, config sets.
- notes, party tab inputs, build-level settings (level, auto level, character name, target version).
- evaluate: what-if without changing the build (add or remove nodes, replace an item in a slot, toggle a flask or tincture, change conditions), node power ranking for a stat with a depth limit, item comparison against the equipped item, gem ranking for a link (support gem DPS sort), compare two builds or two specs or two item sets (stat diff), best-anoint ranking.
- A generic control driver (`ui.invoke`) that sets a named control's value or clicks a named button in the live control tree, for any action not yet mapped; listed in `PROGRESS.md` when used so it can be replaced by a named operation.

Done when: every operation in the inventory report marked headless-today or small-shim for these domains has a route, an MCP action, and a worker test that asserts a real stat change (or, for reads, real content); operations needing extraction are implemented in `api/lua` by calling the same upstream functions the closures call, not by copying upstream logic where a call can reach it; `PROGRESS.md` lists each of the 187 inventory operations with its state.

### F3. Import and trade query

- Character import from a public profile (account name, realm, character) through the host fetch module and `ImportTab` functions; clear errors for private profiles.
- Trade: generate the weighted-sum search for a slot (query JSON and the trade-site URL for Justin to open); on explicit request run one search and fetch through a limiter that obeys the response rate-limit headers and stops on 429; score returned listings against the build. No live search, no whispers, no hideout travel.
- Timeless jewel lookup and search through the worker.

### F4. Browser view

Self-hosted build of pob-web (https://github.com/atty303/pob-web, MIT) under `api/web`, packed from this repository's own Path of Building sources at the same commit as the worker, served by the server with the cross-origin isolation headers it needs. The page loads a build from the store by id, follows the build's event stream and reloads on a new revision; edits made in the page are sent back with their base revision. The three compound-assignment sites in upstream Lua (`src/Modules/Main.lua:342`, `src/Classes/CompareBuySimilar.lua:199-200`) are handled in the pack step or the Lua parser, not by editing upstream files. A build list page and a non-affiliation notice.

### F5. Package

`api/README.md` for a stranger; `api/deploy/Dockerfile` that builds the runtime and server into one image; an example systemd unit with placeholders. Ships with F1. Hosting on the LaserFocused server (port, tunnel, observability) is done from the private repository.

### Market watch, prices and the personal dashboard: not in this repository

Justin, 14 Nov 2026: "the trade stuff is more for me, keep the pob stuff separate ... the pob additions should remain shippable as part of pob so potentially if the community likes this api and mcp can get added in". Price data, market history, trend flags, the live flags view and everything specific to the LaserFocused server live in the private repository `LaserFocused-ee/poe-advisor`, which uses this package only through its public HTTP API and MCP.

## Not in scope

Path of Exile 2. Multi-user accounts or OAuth. Any automation of game or trade actions. A rewrite of the calculation engine.

## Checks

`npm run build`, `npm run lint`, `npm run typecheck`, `npm test` in `api/server` (unit tests plus worker tests that spawn the real engine; the whole run stays under 2 minutes). Upstream's own busted suite is not part of our checks. No end-to-end browser suites.
