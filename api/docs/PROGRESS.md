# Progress

Features are numbered as in `SPEC.md`. Checks for every entry: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` in `api/server`.

## F1. Engine, API skeleton, MCP, builds, stats, lookup: built

- Runtime: `runtime/build-runtime.sh` (LuaJIT at 2460b3ff, lua-utf8 0.1.6, system zlib through the FFI).
- Worker: `lua/worker.lua` plus `lua/ops/{builds,stats,lookup}.lua`; JSON lines; boots in about 1.8 s.
- Server: config, logger, `/health`, `/health/deep`, bearer auth, worker pool (one process per open build, LRU recycling, kill on timeout or memory ceiling, reload from the store), file build store with revisions, stale-write refusal, history of the last 50 plus save points, server-sent events, share-link fetch module.
- Route table (`server/src/routes.ts`) generates the HTTP routes, the MCP tools and `docs/API.md`.
- MCP: Streamable HTTP at `POST /mcp` (stateless) and stdio (`server/dist/src/stdio.js`). Tools with routes today: `pob_build`, `pob_stats`, `pob_lookup`. The other six (`pob_tree`, `pob_skills`, `pob_items`, `pob_config`, `pob_evaluate`, `pob_trade`) appear once F2 and F3 give them actions.
- Operations: builds (new, import XML, code, share link, list, get, rename, duplicate, delete, export XML, export code, save point, history), stats (sidebar, output with `fields`, per-skill and Full DPS, breakdown, warnings, defences, points, versions), lookup (gems, uniques, bases, node search, node detail, config catalogue).
- Tests: OccVortex (tree 3_13) and a Witch/Elementalist fixture made on tree 3_30 with concrete stat values; build-code round trip; two sessions open at once; worker kill recovered from the store; MCP over HTTP and stdio; auth, health, log lines.

Deviations from the spec text, with reasons:

- `GetScriptPath` is not redirected to the state directory: data loaders build relative paths from it (for example `DataLegionLookUpTableHelper.lua` joins it without a separator), so it stays `""` and the worker runs with `src/` as its working directory. `GetUserPath` and `GetRuntimePath` point at a per-worker state directory.
- Build codes are decoded on the server (Node zlib with an output cap) rather than in the worker, so an oversized code is refused before it reaches the Lua state. Encoding stays in the worker, using the same expression as `ImportTab.lua`.
- The MCP SDK is the v2 split package (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/node` 2.1.2); `createMcpHandler` serves the stateless legacy protocol and the current one from one factory.

## F2. Tree, skills, items, config, notes, evaluate: not started

## F3. Import and trade query: not started

## F4. Web view: separate owner

## F5. Package: README, Dockerfile and example systemd unit ship with F1
