# Path of Building co-pilot: spec and queue

Set 14 Nov 2026. Owner of this file: the orchestrating session. Features are built in the order listed; each is one pull request into `lf/main`.

## Goal

An AI model controls Path of Building programmatically (HTTP API and MCP), with no computer use, and Justin watches and edits the same build in a browser. One portable package: engine, API, MCP and web view ship together from this repository and run on any Linux host (native or container). Justin plays Path of Exile 1 (patch 3.30, PC) on his Mac; the package runs on the LaserFocused server.

Later goals this must not block: import Justin's characters, theorycraft variants, price items, watch the economy for deals, crafting and farming profit away from the most popular strategies.

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
copilot/
  runtime/      build-runtime.sh: LuaJIT pinned to the upstream Dockerfile commit, lua-utf8; output gitignored
  lua/          worker.lua (boot + JSON-lines loop) and ops/<domain>.lua; runs inside the Path of Building Lua state
  server/       Node 22 + TypeScript: worker pool, build store, HTTP API, MCP, events, static web view mount
  web/          browser view (feature 4)
  deploy/       systemd units, deploy script, observability files, Dockerfile
  docs/         this spec, PROGRESS.md, API.md (generated from the route table), UPSTREAM-PATCHES.md
```

- **Worker** (`copilot/lua/worker.lua`): replaces `src/HeadlessWrapper.lua` without editing it. Loads `src/_SimpleGraphic.def.lua`, then overrides: `Inflate`/`Deflate` (zlib through LuaJIT FFI), `GetTime` (real clock), `GetUserPath`/`GetScriptPath`/`GetRuntimePath` (a state directory outside the checkout), `Copy` (captured), `Paste` (stays nil), `LaunchSubScript`/`OpenURL` (nil; the host does all network). Sets `main.disableDevAutoSave = true`. All `print`/`ConPrintf` go to stderr; stdout carries only protocol lines. Reads one JSON object per line `{id, op, args}` and answers `{id, ok, result}` or `{id, ok:false, error:{code,message}}`. Every command runs under `pcall`; after it, `launch.promptMsg` and `main.popups` are drained into `warnings` on the response. A mutating command sets `build.buildFlag` and pumps `OnFrame` until the build is calculated before answering, and returns the changed sidebar stats (before and after) unless `diff:false`.
- **Server** (`copilot/server`): owns everything outside the Lua state: HTTP, MCP, auth, the build store, network fetches, worker lifecycle. One worker process per open build session; pool size from config; idle workers are recycled least-recently-used; a worker over its memory ceiling or past a command timeout is killed and its session reloaded from the store on next use (cold start is about 2 s). Commands to one worker are queued one at a time.
- **Build store**: the server is the source of truth. Each build is `{id, name, revision, xml, updatedAt, source}` on disk under the data directory (one XML file plus one JSON metadata file per build; no database). Every successful mutation exports XML from the worker, increments `revision` and emits an event. Writes that carry a `baseRevision` older than the current one are refused with `409 stale_revision`.
- **Events**: `GET /v1/builds/:id/events` (server-sent events) emits `{revision, cause, changedStats}` after each change. The web view and any other client use it to stay in step.
- **HTTP API**: `/v1/<domain>/...` routes, one per operation, declared in a single route table (name, domain, method, path, input schema, output schema, read-only flag, worker op). `docs/API.md` and the MCP tools are generated from that table, so the three cannot drift. Errors use registered codes (`not_found`, `invalid_input`, `stale_revision`, `worker_error`, `worker_timeout`, `unsupported`, `upstream_fetch_failed`, `rate_limited`).
- **MCP**: 9 tools, each with an `action` enum over the routes of its domain: `pob_build`, `pob_stats`, `pob_tree`, `pob_skills`, `pob_items`, `pob_config`, `pob_evaluate`, `pob_lookup`, `pob_trade`. Underscore names, accurate `readOnlyHint`, `structuredContent` plus a text mirror, failures as `isError: true`, results kept under 25,000 tokens by default with paging or a `fields` selector. Served two ways from the same code: Streamable HTTP at `POST /mcp` (stateless, legacy protocol era) and a stdio entry point. Follow `~/.claude/skills/mcp-connector-build/SKILL.md` section 1 and 4; OAuth is out of scope (single user, bearer token).
- **Auth**: single user. A bearer token from config guards `/v1` and `/mcp`. `/health` and `/health/deep` are open. The browser view gets a cookie session issued by exchanging the same token once (feature 4). Token compare is constant-time. No tool or route takes a user id.
- **Network fetches** (host only): build imports from links Justin supplies (pobb.in, pastebin, Maxroll, poe.ninja share links, the hosts in `src/Modules/BuildSiteTools.lua`), public-profile character import, price data. Fetches go through one module with a host allowlist, a timeout, a size cap, a descriptive User-Agent from config, and no redirects to hosts off the allowlist. No credentials for the game publisher's site are stored.
- **House rules that apply to `copilot/server`**: no bare `console.*` (one logger module, JSON lines to stdout for journald); environment read and validated in one config module; `/health` and `/health/deep` (deep boots or pings a worker and reports Path of Building version, tree version and pool state); a boundary log line per request and per worker command; errors captured with an explicit fingerprint when the error-tracking variable is configured; `deploy/observability/manifest.yaml` rows for each unit.

## Features (the queue)

### F1. Engine and read path (first pull request)

Runtime build script; worker boot; JSON-lines protocol; server skeleton with config, logger, health, auth, worker pool, build store, events; route table and generated `API.md`; MCP over HTTP and stdio; these operations:

- builds: new (class, ascendancy, level, tree version defaulting to latest), load from XML, load from build code, load from a supported share link, list, get metadata, rename, duplicate, delete, export XML, export build code, save point (store revision), history of revisions (keep the last 50).
- stats: sidebar stats (the `displayStats` list with labels and formatted values), full output table for the main skill with a `fields` filter, per-skill outputs and FullDPS, calculation breakdown for one output key, warnings, requirement and resistance summary, passive point budget, game and tree version.
- lookup (read-only data): gems (search, tags, requirements), uniques (search, text), bases, tree nodes (search by name or stat text, node detail), config option catalogue (all options with type, section, allowed values, current value).

Done when: from a clean checkout, `copilot/runtime/build-runtime.sh` then `npm ci && npm run build && npm test` in `copilot/server` pass; the worker test loads a fixture build and a build made on tree 3_30 and asserts concrete stat values; a build code round-trips byte-exact; an MCP client can list tools and read a loaded build's stats; a second build loads in a second session while the first stays open; killing a worker mid-session is recovered from the store.

### F2. Full edit path

Every mutation the application offers, each returning the stat diff:

- tree: class and ascendancy (including secondary/Bloodline), allocate and deallocate nodes (single, list, and by path to a target), masteries, jewel sockets, tattoos or current overrides, import and export tree URL, tree specs (list, new, copy, rename, delete, activate), convert to latest tree version, shortest path between two nodes.
- skills: socket groups (add, edit, remove, reorder, enable, slot), gems (add, set level, quality, quality type or variant, enabled, count), main group and main active skill, skill part, stages, mines, minion and spectre choice, skill sets, paste a group from text, default gem level and quality settings.
- items: create from pasted item text, list, get (parsed mods and tooltip), edit variant, ranges, quality, sockets and links, anoint, enchant, craft (add or remove bench and custom modifiers, influences, corrupt implicit choice where the application offers it), equip and unequip by slot (including weapon swap, flasks, tinctures, jewels into tree sockets, abyss sockets), activate flasks, item sets, delete, add a unique from the database by name with variant, add a rare from the template database.
- config: set and clear any of the config options, enemy presets, bandit, pantheon, custom modifiers, config sets.
- notes, party tab inputs, build-level settings (level, auto level, character name, target version).
- evaluate: what-if without changing the build (add or remove nodes, replace an item in a slot, toggle a flask or tincture, change conditions), node power ranking for a stat with a depth limit, item comparison against the equipped item, gem ranking for a link (support gem DPS sort), compare two builds or two specs or two item sets (stat diff), best-anoint ranking.
- A generic control driver (`ui.invoke`) that sets a named control's value or clicks a named button in the live control tree, for any action not yet mapped; listed in `PROGRESS.md` when used so it can be replaced by a named operation.

Done when: every operation in the inventory report marked headless-today or small-shim for these domains has a route, an MCP action, and a worker test that asserts a real stat change (or, for reads, real content); operations needing extraction are implemented in `copilot/lua` by calling the same upstream functions the closures call, not by copying upstream logic where a call can reach it; `PROGRESS.md` lists each of the 187 inventory operations with its state.

### F3. Import, trade query and prices

- Character import from a public profile (account name, realm, character) through the host fetch module and `ImportTab` functions; clear errors for private profiles.
- Trade: generate the weighted-sum search for a slot (query JSON and the trade-site URL for Justin to open); on explicit request run one search and fetch through a limiter that obeys the response rate-limit headers and stops on 429; score returned listings against the build. No live search, no whispers, no hideout travel.
- Prices: poe.ninja documented economy endpoints and the publisher's currency-exchange hourly files, cached with ETag on a schedule inside the server (in-process timers declared in `docs/SCHEDULED-JOBS.md`); a price lookup operation that returns value in divines and chaos with listing count and a low-liquidity flag.
- Timeless jewel lookup and search through the worker.

### F4. Browser view

Self-hosted build of pob-web (https://github.com/atty303/pob-web, MIT) under `copilot/web`, packed from this repository's own Path of Building sources at the same commit as the worker, served by the server with the cross-origin isolation headers it needs. The page loads a build from the store by id, follows the build's event stream and reloads on a new revision; edits made in the page are sent back with their base revision. The three compound-assignment sites in upstream Lua (`src/Modules/Main.lua:342`, `src/Classes/CompareBuySimilar.lua:199-200`) are handled in the pack step or the Lua parser, not by editing upstream files. A build list page and a non-affiliation notice.

### F5. Deploy and package

`copilot/deploy`: systemd user unit, deploy script with health poll, observability files, and a Dockerfile that produces the same package for any host. Hosted on the LaserFocused server per `~/.claude/skills/backend-box-deploy/SKILL.md` (loopback port 7480, tunnel hostname `app-pob.laserfocused.ee`). The orchestrator does the tunnel and first install; the owner supplies the files with F1.

### F6. Market watch (own area: `copilot/market`, own owner)

Justin, 14 Nov 2026: trade is not about sniping; "we are looking for trends and patterns and for you to try to flag them and get on them as early as we can". History that is not collected cannot be recovered, so collection starts before anything else in this feature.

- **Collector** (`copilot/market`, Node 22, no framework): a long-running process with its own schedule, declared in `copilot/docs/SCHEDULED-JOBS.md`. Sources, all documented and unauthenticated, each fetched with ETag, a descriptive User-Agent from config and back-off on any 4xx or 429: poe.ninja economy overviews for every item type of the current trade league every 30 minutes; the publisher's currency-exchange hourly files at five past each hour, with a one-time backfill from league start; the league list daily. No trade-site calls, no stash stream, no build or profile endpoints.
- **Store**: one SQLite file in the data directory (portable with the package). Raw responses are kept compressed for 14 days; normalised rows are kept for the league: `item(id, type, name, variant, first_seen)`, `price_point(item, ts, chaos, divine, listing_count, source)`, `exchange_hour(pair, hour, volume, ratio_low, ratio_high, stock)`, `signal(ts, item, kind, score, detail)`. The schema file `copilot/market/SCHEMA.md` is the contract with the engine server, which opens the file read-only.
- **Signals**, computed by code after each collection and stored with their inputs so each can be checked: price change over 6, 24 and 72 hours against the item's own volatility; listing count falling while price holds or rises (supply squeeze); listing count rising while price falls (dump); first appearance of an item or variant; exchange volume spikes and widening or closing spread between exchange ratio and poe.ninja price; items whose price trend differs from their group (one gem, one unique, one Thread against its class); low-liquidity flag (few listings) on everything. Each signal carries a plain statement of why it fired. Popularity is used in reverse: the largest, most-traded items are down-ranked so thin and unusual markets surface first.
- **Read side** (served by the engine server in F3 from the same file): movers, active signals ranked by score, one item's history, a watch list Justin or the AI can edit, and a daily digest. MCP tool `pob_market` (the tenth tool).
- **Live flags view** (Justin, 14 Nov 2026: "we will build a little ui that my mac can run and show me in real time"): a page in the package's web view, served from the same origin as the build view, that Justin keeps open on his Mac (installable to the Dock as a web app). It follows a server-sent event stream of new signals and shows: the live feed of flags, newest first, each with its reason, the item's price and listing chart, and a link to the trade-site search for Justin to open by hand; filters by kind and item class; the watch list; mute and dismiss per item (stored server-side); a browser notification for flags above a score Justin sets. States: empty (collector has no history yet, with the time of the next collection), loading, stream disconnected with automatic reconnect, source stale (a collection failed, with the last good time). Keyboard: arrow keys move through the feed, Enter opens the item, `m` mutes. Narrow width: single column, chart below the reason. The signal stream is `GET /v1/market/events`. This page belongs to the web-view owner (F4 area) and reads only through the server's market routes.
- **Checks**: parser tests on recorded responses, signal tests on synthetic series (each signal has a series that fires it and one that must not), and a dry-run mode that fetches once and prints row counts.

Done when: the collector has run unattended for 24 hours on the server with no gaps in its schedule log; signals fire on recorded data; a restart resumes without duplicate rows.

## Not in scope

Path of Exile 2. Multi-user accounts or OAuth. Any automation of game or trade actions. A rewrite of the calculation engine.

## Checks

`npm run build`, `npm run lint`, `npm run typecheck`, `npm test` in `copilot/server` (unit tests plus worker tests that spawn the real engine; the whole run stays under 2 minutes). Upstream's own busted suite is not part of our checks. No end-to-end browser suites.
