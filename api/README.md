# Path of Building API and MCP server

An HTTP API and a Model Context Protocol (MCP) server over the real Path of Building engine. Programs and AI assistants can create and import builds, read every calculated stat the application shows, and search game data, without a screen and without reimplementing any calculation: each open build runs in its own headless Path of Building process, the same Lua code the desktop application runs.

Nothing here edits upstream Path of Building files. The worker (`lua/worker.lua`) boots `src/Launch.lua` in place of `src/HeadlessWrapper.lua` and reaches the application through the same functions its controls call.

```
api/
  lua/       worker.lua and its ops (builds, stats, lookup): one process per open build, JSON lines on stdin/stdout
  runtime/   build-runtime.sh: builds LuaJIT 2.1 and the lua-utf8 module (output in runtime/rt, gitignored)
  server/    Node 22 + TypeScript: HTTP API, MCP, worker pool, build store
  deploy/    Dockerfile and an example systemd unit
  docs/      API.md (generated route reference), SPEC.md, PROGRESS.md, UPSTREAM-PATCHES.md
```

Licence: MIT, the same as Path of Building (`LICENSE.md` at the repository root).

## Build and run

Needs Linux (or macOS) with `git`, `gcc`, `make`, the system zlib (`libz.so.1`) and Node 22.

```sh
api/runtime/build-runtime.sh               # about 10 s; prints the LuaJIT version and "lua-utf8 ok"
cd api/server
npm ci && npm run build && npm test        # unit tests plus worker tests that run the real engine
export POB_API_TOKEN="$(openssl rand -hex 32)"
npm start                                  # listens on 127.0.0.1:8730
```

Try it with a test build from the repository:

```sh
auth="Authorization: Bearer $POB_API_TOKEN"
jq -n --rawfile xml ../../spec/TestBuilds/3.13/OccVortex.xml '{xml: $xml}' \
  | curl -s -H "$auth" -H 'content-type: application/json' -d @- http://127.0.0.1:8730/v1/builds/import/xml
# -> {"ok":true,"result":{"build":{"id":"<id>",...},"summary":{"className":"Witch","ascendancy":"Occultist",...}}}
curl -s -H "$auth" http://127.0.0.1:8730/v1/stats/<id>/sidebar
curl -s -H "$auth" "http://127.0.0.1:8730/v1/stats/<id>/output?fields=TotalDPS,Life"
curl -s -H "$auth" http://127.0.0.1:8730/v1/builds/<id>/code
```

Container: `docker build -f api/deploy/Dockerfile -t pob-api .` from the repository root, then `docker run -e POB_API_TOKEN=... -p 127.0.0.1:8730:8730 -v pob-data:/data pob-api`. A systemd example is in `deploy/pob-api.service.example`.

## Connect an MCP client

Over HTTP (stateless Streamable HTTP at `POST /mcp`, same bearer token):

```sh
claude mcp add --transport http pob http://127.0.0.1:8730/mcp --header "Authorization: Bearer $POB_API_TOKEN"
```

Over stdio, in-process, no token (whoever starts the process owns it). Do not point it at the data directory of a running HTTP server; the data directory is locked to one server at a time.

```json
{ "mcpServers": { "pob": { "command": "node", "args": ["<checkout>/api/server/dist/src/stdio.js"], "env": { "POB_DATA_DIR": "<data directory>" } } } }
```

Each MCP tool covers one domain and takes an `action` plus that action's parameters; see the table below. Results carry `structuredContent` and a JSON text copy; failures come back with `isError: true` and an error code.

## Configuration

All settings are environment variables, read and checked once at start (an invalid value stops the server with a message naming it).

| Variable | Default | Meaning |
| --- | --- | --- |
| `POB_API_TOKEN` | (required) | Bearer token for `/v1` and `/mcp`, 32 characters or more |
| `HOST`, `PORT` | `127.0.0.1`, `8730` | Listen address (`PORT=0` picks a free port) |
| `POB_DATA_DIR` | `$XDG_DATA_HOME/pob-api` or `~/.local/share/pob-api` | Build store and worker state |
| `POB_ROOT` | the checkout | Path of Building checkout the worker runs from |
| `POB_RUNTIME_DIR` | `api/runtime/rt` | Output of `build-runtime.sh` |
| `POB_POOL_SIZE` | `4` | Worker processes (open builds kept warm; the least recently used is recycled) |
| `POB_WORKER_TIMEOUT_MS`, `POB_WORKER_BOOT_TIMEOUT_MS` | `30000`, `60000` | A command or boot past this is killed; the build reloads from the store |
| `POB_WORKER_RSS_MB` | `900` | A worker above this memory is replaced after its command |
| `POB_HISTORY_KEEP` | `50` | Revisions kept per build (save points are always kept) |
| `POB_MAX_XML_BYTES` | `5000000` | Largest build accepted |
| `POB_FETCH_USER_AGENT`, `POB_FETCH_TIMEOUT_MS`, `POB_FETCH_MAX_BYTES` | see `server/src/config.ts` | Share-link imports |
| `MCP_MAX_RESULT_CHARS` | `90000` | Larger MCP results are replaced by their keys and a hint to narrow the request |
| `POB_HEALTH_TOKEN` | unset | When set, `/health/deep` needs it in `x-health-token` |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `RELEASE` | unset | Optional error tracking (no request data is sent) |
| `LOG_LEVEL` | `info` | JSON log lines on stdout |

## Behaviour worth knowing

- The server is the source of truth for every build: one XML file plus one JSON metadata file per build under the data directory, with a revision number. A write that names a `baseRevision` older than the current one is refused with `409 stale_revision`.
- Share-link imports fetch only from the build sites Path of Building itself supports (`src/Modules/BuildSiteTools.lua`), over https, with a timeout, a size cap, and redirects followed only to those hosts. Nothing else makes outbound requests; the Lua workers have no network access.
- `GET /health` answers without auth; `GET /health/deep` boots or pings a worker and reports the Path of Building version, the latest tree version and the pool.
- `GET /v1/builds/:id/events` is a server-sent event stream of revision changes for one build.

## Routes

Every route is also listed with its input and result schemas in `docs/API.md`. GET inputs go in the query string (lists comma-separated); POST inputs are a JSON body.

<!-- routes:start (generated by npm run docs) -->
| Route | MCP tool and action | What it does |
| --- | --- | --- |
| `GET /v1/builds` | `pob_build` `list` | List stored builds, most recently changed first. |
| `POST /v1/builds` | `pob_build` `new` | Create an empty build. Tree version defaults to the latest. |
| `POST /v1/builds/import/xml` | `pob_build` `import_xml` | Load a build from Path of Building XML. |
| `POST /v1/builds/import/code` | `pob_build` `import_code` | Load a build from a build code (the text Path of Building shares). |
| `POST /v1/builds/import/link` | `pob_build` `import_link` | Load a build from a share link on a supported site (pobb.in, pastebin, Maxroll, poe.ninja, pob.codes, rentry, poedb). |
| `GET /v1/builds/:id` | `pob_build` `get` | A build's metadata and summary (class, ascendancy, level, tree version, main skill). |
| `POST /v1/builds/:id/rename` | `pob_build` `rename` | Rename a build (a new revision). |
| `POST /v1/builds/:id/duplicate` | `pob_build` `duplicate` | Copy a build into a new build. |
| `DELETE /v1/builds/:id` | `pob_build` `delete` | Delete a build and its history. |
| `GET /v1/builds/:id/xml` | `pob_build` `export_xml` | A build's XML at the current or a kept revision. |
| `GET /v1/builds/:id/code` | `pob_build` `export_code` | A build code for the current revision, importable by Path of Building. |
| `POST /v1/builds/:id/save-points` | `pob_build` `save_point` | Mark the current revision as a save point (kept past history pruning). |
| `GET /v1/builds/:id/history` | `pob_build` `history` | Revisions kept for a build, newest first (last 50 plus save points). |
| `GET /v1/builds/:id/events` | HTTP only | Server-sent events: `hello` with the current revision, then `change` (revision, cause, changed stats) and `deleted`. |
| `GET /v1/stats/:id/sidebar` | `pob_stats` `sidebar` | The sidebar stat list as Path of Building shows it: label, value, formatted text. |
| `GET /v1/stats/:id/output` | `pob_stats` `output` | The full calculated output table; `fields` selects keys. |
| `GET /v1/stats/:id/skills` | `pob_stats` `skills` | Per-skill outputs for every socket group and the Full DPS total. |
| `GET /v1/stats/:id/breakdown` | `pob_stats` `breakdown` | How one output value is built (the Calcs tab breakdown). |
| `GET /v1/stats/:id/warnings` | `pob_stats` `warnings` | Build warnings (unmet requirements, over-allocated points, and the like). |
| `GET /v1/stats/:id/defences` | `pob_stats` `defences` | Attribute totals and requirements; resistances with total, overcap and maximum. |
| `GET /v1/stats/:id/points` | `pob_stats` `points` | Passive and ascendancy points used and available, required level. |
| `GET /v1/stats/:id/versions` | `pob_stats` `versions` | Path of Building version, the build's tree version and the latest tree version. |
| `GET /v1/lookup/gems` | `pob_lookup` `gems` | Search gems by name and tag, with requirements at a level. |
| `GET /v1/lookup/uniques` | `pob_lookup` `uniques` | Search uniques by name or by a line of their text. |
| `GET /v1/lookup/bases` | `pob_lookup` `bases` | Search item bases by name and type. |
| `GET /v1/lookup/nodes` | `pob_lookup` `nodes` | Search passive tree nodes by name or stat text (the tree search box). |
| `GET /v1/lookup/nodes/:nodeId` | `pob_lookup` `node` | One passive node: stats, links, path length from the current tree, mastery effects. |
| `GET /v1/lookup/config` | `pob_lookup` `config` | The configuration option catalogue: type, section, allowed values, current value; `var` adds the tooltip. |
<!-- routes:end -->
