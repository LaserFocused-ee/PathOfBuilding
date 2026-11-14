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

Needs Linux with `git`, `gcc`, `make`, the system zlib (`libz.so.1`) and Node 22.

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

## Browser view

Build it with `api/web/build-web.sh <commit>` (needs Deno 2.9+, gcc, cmake, ninja, python3; no root); the server serves `api/web/dist` at `/`; open `/` and sign in with the API token. Details: `api/web/README.md`.

Signing in is `POST /v1/session` with the bearer token: the answer sets an `HttpOnly`, `SameSite=Strict` session cookie (30 days, kept in memory, so a restart signs the page out) that authenticates every `/v1` route, the event stream included, but not `/mcp`. A cookie-authenticated request that changes something must carry an `Origin` equal to the server's own origin: `POB_PUBLIC_ORIGIN` when set, else the address the request was sent to. Behind a TLS proxy, set `POB_PUBLIC_ORIGIN` to the https origin: the cookie is then `__Host-pob_session` and always `Secure`. `DELETE /v1/session` signs out.

Path of Building's own import code (character import, build links) runs in the page and fetches through `POST /v1/fetch` with `{ url, headers?, body? }` (GET, or POST when `body` is given). Only the character-window and profile pages of www.pathofexile.com and the build-link sites are allowed; only `accept` and `content-type` are forwarded, and the site's status and `content-type`, `retry-after` and `x-rate-limit-*` headers come back as they are. While a site signals a pause (`Retry-After`, or an `X-Rate-Limit-*` rule at its limit) every request to it, from the page or the import routes, is answered `rate_limited` without contacting it. This route is not an MCP action.

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
| `POB_WEB_DIR` | `api/web/dist` | The built browser view, served at `/`; not served when the directory is missing |
| `POB_PUBLIC_ORIGIN` | unset | The origin the browser view is opened at (e.g. `https://pob.example.org` behind a TLS proxy); when set, cookie-authenticated changes must come from exactly this origin, and an https origin gives the `__Host-` cookie |
| `POB_POOL_SIZE` | `4` | Worker processes (open builds kept warm; the least recently used is recycled) |
| `POB_WORKER_TIMEOUT_MS`, `POB_WORKER_BOOT_TIMEOUT_MS` | `30000`, `60000` | A command or boot past this is killed; the build reloads from the store |
| `POB_WORKER_RSS_MB` | `900` | A worker above this memory is replaced after its command |
| `POB_HISTORY_KEEP` | `50` | Revisions kept per build (save points are always kept) |
| `POB_MAX_XML_BYTES` | `5000000` | Largest build accepted |
| `POB_FETCH_USER_AGENT`, `POB_FETCH_TIMEOUT_MS`, `POB_FETCH_MAX_BYTES` | see `server/src/config.ts` | Share-link imports |
| `MCP_MAX_RESULT_CHARS` | `90000` | Larger MCP results are replaced by their keys and a hint to narrow the request |
| `POB_AUTH_FAILURES_PER_MINUTE` | 30 | Failed credential checks per minute, all clients together, before requests without a valid credential get 429 (a valid token always passes) |
| `POB_HEALTH_TOKEN` | unset | A second secret (16+ characters) for monitors: `/health/deep` accepts it in `x-health-token`; without it, `/health/deep` needs the bearer token |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `RELEASE` | unset | Optional error tracking (no request data is sent). Opt-in install: `npm install --no-save @sentry/node@11.12.0`; it is not in the default install because its dependency tree is not permissively licensed |
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
| `GET /v1/builds/import/characters` | `pob_build` `characters` | Characters on a public Path of Exile profile (name, league, class, level). The profile's Characters tab must be public. |
| `POST /v1/builds/import/character` | `pob_build` `import_character` | A new build from a character on a public profile: passive tree, jewels, items and skills, as the Import tab imports them. |
| `GET /v1/builds/trash` | `pob_build` `trash` | Deleted builds that can still be restored (kept 7 days after deletion). |
| `GET /v1/builds/:id` | `pob_build` `get` | A build's metadata and summary (class, ascendancy, level, tree version, main skill). |
| `POST /v1/builds/:id/rename` | `pob_build` `rename` | Rename a build (a new revision). |
| `POST /v1/builds/:id/duplicate` | `pob_build` `duplicate` | Copy a build into a new build. |
| `DELETE /v1/builds/:id` | `pob_build` `delete` | Delete a build. It stays restorable for 7 days (`restore`), then it and its history are removed. |
| `POST /v1/builds/:id/restore` | `pob_build` `restore` | Restore a deleted build with its history. |
| `POST /v1/builds/:id/revert` | `pob_build` `revert` | Make a kept revision current again (as a new revision). |
| `POST /v1/builds/:id/settings` | `pob_build` `settings` | Character level and the Auto/Manual level mode (auto follows points spent). |
| `GET /v1/builds/:id/xml` | `pob_build` `export_xml` | A build's XML at the current or a kept revision. |
| `PUT /v1/builds/:id/code` | `pob_build` `replace_code` | Replace a build's content with a build code (the same decode as import/code); id and name stay, the revision moves on. The browser view saves through this. |
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
| `GET /v1/tree/:id/get` | `pob_tree` `get` | The allocated tree: class, ascendancy, bloodline, nodes, masteries, tattoos, jewel sockets, tree list. |
| `POST /v1/tree/:id/set-class` | `pob_tree` `set_class` | Change class. If the tree is not connected to the new start, `onDisconnected` decides: fail (default), reset the tree, or connect it by the shortest path. |
| `POST /v1/tree/:id/set-ascendancy` | `pob_tree` `set_ascendancy` | Change ascendancy (of the current class), or None. |
| `POST /v1/tree/:id/set-bloodline` | `pob_tree` `set_bloodline` | Change the secondary ascendancy (bloodline), or None. |
| `POST /v1/tree/:id/allocate` | `pob_tree` `allocate` | Allocate nodes, each with the shortest path to it, as clicking them does. |
| `POST /v1/tree/:id/deallocate` | `pob_tree` `deallocate` | Deallocate nodes and every node that depended on them. |
| `POST /v1/tree/:id/reset` | `pob_tree` `reset` | Reset the tree (the Reset Tree button). |
| `GET /v1/tree/:id/mastery-options` | `pob_tree` `mastery_options` | The effects a mastery node offers and which is selected. |
| `POST /v1/tree/:id/set-mastery` | `pob_tree` `set_mastery` | Choose a mastery effect; allocates the mastery if needed. |
| `POST /v1/tree/:id/remove-tattoos` | `pob_tree` `remove_tattoos` | Remove every tattoo from the tree. |
| `GET /v1/tree/:id/export-url` | `pob_tree` `export_url` | The tree as a passive tree link (pathofexile.com). |
| `POST /v1/tree/:id/import-url` | `pob_tree` `import_url` | Add a tree from a passive tree link as a new tree in the list and make it active. |
| `GET /v1/tree/:id/path` | `pob_tree` `path` | Shortest path: without `from`, the nodes allocating `to` would add; with it, the fewest-node route between two nodes. |
| `POST /v1/tree/:id/spec-new` | `pob_tree` `spec_new` | Add an empty tree to the tree list. |
| `POST /v1/tree/:id/spec-copy` | `pob_tree` `spec_copy` | Copy a tree in the tree list. |
| `POST /v1/tree/:id/spec-rename` | `pob_tree` `spec_rename` | Rename a tree in the tree list. |
| `POST /v1/tree/:id/spec-delete` | `pob_tree` `spec_delete` | Delete a tree from the tree list (not the last one). |
| `POST /v1/tree/:id/spec-activate` | `pob_tree` `spec_activate` | Make a tree in the tree list the active one. |
| `POST /v1/tree/:id/convert` | `pob_tree` `convert` | Convert the active tree to another tree version (default the latest); `keepOld` converts a copy. |
| `GET /v1/skills/:id/get` | `pob_skills` `get` | The Skills tab: socket groups with their gems and active skills, the main socket group, skill sets and gem options. |
| `GET /v1/skills/:id/group-text` | `pob_skills` `group_text` | A socket group as Path of Building copies it (paste it back with `add_group`). |
| `POST /v1/skills/:id/add-group` | `pob_skills` `add_group` | Add a socket group from gems or from copy text (the Paste button). Gem names resolve as the gem box does; unknown names fail. |
| `POST /v1/skills/:id/update-group` | `pob_skills` `update_group` | Change a socket group's label, item slot, enabled and Full DPS flags (and the count of an item-granted group). |
| `POST /v1/skills/:id/delete-group` | `pob_skills` `delete_group` | Delete a socket group. |
| `POST /v1/skills/:id/move-group` | `pob_skills` `move_group` | Move a socket group to another position in the list; the main skill stays the same group. |
| `POST /v1/skills/:id/set-main` | `pob_skills` `set_main` | Make a socket group the main one, and optionally pick which of its active skills is the main skill. |
| `POST /v1/skills/:id/set-gem` | `pob_skills` `set_gem` | Change a gem of a group (name, level, quality, enabled, count); a position one past the last gem adds one (name required). |
| `POST /v1/skills/:id/delete-gem` | `pob_skills` `delete_gem` | Remove a gem from a group. |
| `POST /v1/skills/:id/set-imbued` | `pob_skills` `set_imbued` | Set a group's Imbued Support (needs the group socketed in an item slot), or None to clear it. |
| `POST /v1/skills/:id/optimise-sockets` | `pob_skills` `optimise_sockets` | Reorder a socketed group's gems to match the item's socket colours (the Optimise Sockets button). |
| `POST /v1/skills/:id/set-options` | `pob_skills` `set_options` | Skills tab gem options: default gem level and quality, which support gems the gem box shows, legacy gems. |
| `POST /v1/skills/:id/set-new` | `pob_skills` `set_new` | Add a skill set. |
| `POST /v1/skills/:id/set-copy` | `pob_skills` `set_copy` | Copy a skill set. |
| `POST /v1/skills/:id/set-rename` | `pob_skills` `set_rename` | Rename a skill set. |
| `POST /v1/skills/:id/set-delete` | `pob_skills` `set_delete` | Delete a skill set (not the last one). |
| `POST /v1/skills/:id/set-activate` | `pob_skills` `set_activate` | Make a skill set the active one. |
| `GET /v1/config/:id/get` | `pob_config` `get` | Configuration values that differ from default on the active config set, the config set list, level settings. |
| `POST /v1/config/:id/set` | `pob_config` `set` | Set configuration options (see lookup `config` for names and allowed values); `reset` puts options back to their default. |
| `POST /v1/config/:id/set-new` | `pob_config` `set_new` | Add a config set. |
| `POST /v1/config/:id/set-copy` | `pob_config` `set_copy` | Copy a config set. |
| `POST /v1/config/:id/set-rename` | `pob_config` `set_rename` | Rename a config set. |
| `POST /v1/config/:id/set-delete` | `pob_config` `set_delete` | Delete a config set (not the last one). |
| `POST /v1/config/:id/set-activate` | `pob_config` `set_activate` | Make a config set the active one. |
| `GET /v1/config/:id/notes` | `pob_config` `notes` | The build notes (Notes tab), with colour codes. |
| `POST /v1/config/:id/set-notes` | `pob_config` `set_notes` | Replace the build notes. |
| `GET /v1/lookup/gems` | `pob_lookup` `gems` | Search gems by name and tag, with requirements at a level. |
| `GET /v1/lookup/uniques` | `pob_lookup` `uniques` | Search uniques by name or by a line of their text. |
| `GET /v1/lookup/bases` | `pob_lookup` `bases` | Search item bases by name and type. |
| `GET /v1/lookup/nodes` | `pob_lookup` `nodes` | Search passive tree nodes by name or stat text (the tree search box). |
| `GET /v1/lookup/nodes/:nodeId` | `pob_lookup` `node` | One passive node: stats, links, path length from the current tree, mastery effects. |
| `GET /v1/lookup/config` | `pob_lookup` `config` | The configuration option catalogue: type, section, allowed values, current value; `var` adds the tooltip. |
<!-- routes:end -->
