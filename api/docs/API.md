# Path of Building API

Generated from `server/src/routes.ts` by `npm run docs`; do not edit by hand.

Every `/v1` route and `POST /mcp` need `Authorization: Bearer <POB_API_TOKEN>`. `GET /health` is open; `GET /health/deep` needs the bearer token, or `POB_HEALTH_TOKEN` in `x-health-token` when that is set. After `POB_AUTH_FAILURES_PER_MINUTE` (default 30) failed credential checks in a minute, requests without a valid credential get 429 with `Retry-After`.

Replies are `{ "ok": true, "result": ..., "warnings": [...] }` or `{ "ok": false, "error": { "code", "message" } }`. Error codes: `not_found` 404, `invalid_input` 400, `unauthorized` 401, `stale_revision` 409, `payload_too_large` 413, `rate_limited` 429, `worker_error` 500, `unsupported` 501, `upstream_fetch_failed` 502, `worker_timeout` 504.

GET inputs go in the query string (lists comma-separated); POST inputs are a JSON body; path parameters are part of the input.

## MCP tools

| Tool | Read-only | Actions |
| --- | --- | --- |
| `pob_build` | no | `list`, `new`, `import_xml`, `import_code`, `import_link`, `characters`, `import_character`, `trash`, `get`, `rename`, `duplicate`, `delete`, `restore`, `revert`, `settings`, `export_xml`, `replace_code`, `export_code`, `save_point`, `history` |
| `pob_stats` | yes | `sidebar`, `output`, `skills`, `breakdown`, `warnings`, `defences`, `points`, `versions` |
| `pob_tree` | no | `get`, `set_class`, `set_ascendancy`, `set_bloodline`, `allocate`, `deallocate`, `reset`, `mastery_options`, `set_mastery`, `remove_tattoos`, `export_url`, `import_url`, `path`, `spec_new`, `spec_copy`, `spec_rename`, `spec_delete`, `spec_activate`, `convert` |
| `pob_config` | no | `get`, `set`, `set_new`, `set_copy`, `set_rename`, `set_delete`, `set_activate`, `notes`, `set_notes` |
| `pob_lookup` | yes | `gems`, `uniques`, `bases`, `nodes`, `node`, `config` |

Not yet routed (no actions, so not listed by the server): `pob_skills`, `pob_items`, `pob_evaluate`, `pob_trade`.

## Routes

### `GET /v1/builds`

List stored builds, most recently changed first.

- Name: `build.list` (MCP `pob_build` action `list`)
- Read-only: yes; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"builds":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}}}},"required":["builds"]}`

### `POST /v1/builds`

Create an empty build. Tree version defaults to the latest.

- Name: `build.new` (MCP `pob_build` action `new`)
- Read-only: no; worker: `builds.new, builds.export`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":200},"className":{"description":"e.g. Witch","type":"string"},"ascendancy":{"description":"e.g. Elementalist","type":"string"},"level":{"type":"integer","minimum":1,"maximum":100},"treeVersion":{"description":"e.g. 3_30","type":"string","pattern":"^\\d+_\\d+(_[a-z]+)?$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}},"summary":{"type":"object","properties":{"name":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"level":{"type":"number"},"treeVersion":{"type":"string"},"mainSkill":{"type":"string"}},"required":["name","className","level","treeVersion"],"additionalProperties":{}}},"required":["build","summary"]}`

### `POST /v1/builds/import/xml`

Load a build from Path of Building XML.

- Name: `build.import_xml` (MCP `pob_build` action `import_xml`)
- Read-only: no; worker: `builds.load, builds.export`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"xml":{"type":"string","minLength":1},"name":{"type":"string","minLength":1,"maxLength":200}},"required":["xml"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}},"summary":{"type":"object","properties":{"name":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"level":{"type":"number"},"treeVersion":{"type":"string"},"mainSkill":{"type":"string"}},"required":["name","className","level","treeVersion"],"additionalProperties":{}}},"required":["build","summary"]}`

### `POST /v1/builds/import/code`

Load a build from a build code (the text Path of Building shares).

- Name: `build.import_code` (MCP `pob_build` action `import_code`)
- Read-only: no; worker: `builds.load, builds.export`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"code":{"type":"string","minLength":1},"name":{"type":"string","minLength":1,"maxLength":200}},"required":["code"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}},"summary":{"type":"object","properties":{"name":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"level":{"type":"number"},"treeVersion":{"type":"string"},"mainSkill":{"type":"string"}},"required":["name","className","level","treeVersion"],"additionalProperties":{}}},"required":["build","summary"]}`

### `POST /v1/builds/import/link`

Load a build from a share link on a supported site (pobb.in, pastebin, Maxroll, poe.ninja, pob.codes, rentry, poedb).

- Name: `build.import_link` (MCP `pob_build` action `import_link`)
- Read-only: no; worker: `builds.resolve_link, builds.load, builds.export`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"url":{"type":"string","maxLength":2000,"format":"uri"},"name":{"type":"string","minLength":1,"maxLength":200}},"required":["url"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}},"summary":{"type":"object","properties":{"name":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"level":{"type":"number"},"treeVersion":{"type":"string"},"mainSkill":{"type":"string"}},"required":["name","className","level","treeVersion"],"additionalProperties":{}}},"required":["build","summary"]}`

### `GET /v1/builds/import/characters`

Characters on a public Path of Exile profile (name, league, class, level). The profile's Characters tab must be public.

- Name: `build.characters` (MCP `pob_build` action `characters`)
- Read-only: yes; worker: `(game site)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"account":{"type":"string","minLength":3,"maxLength":100,"description":"Account name with its discriminator, e.g. Name#1234"},"realm":{"description":"Default pc","type":"string","enum":["pc","xbox","sony"]}},"required":["account"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"characters":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"league":{"type":"string"},"class":{"type":"string"},"level":{"type":"number"}},"required":["name","league","class"]}}},"required":["characters"]}`

### `POST /v1/builds/import/character`

A new build from a character on a public profile: passive tree, jewels, items and skills, as the Import tab imports them.

- Name: `build.import_character` (MCP `pob_build` action `import_character`)
- Read-only: no; worker: `builds.import_character, builds.export`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"account":{"type":"string","minLength":3,"maxLength":100,"description":"Account name with its discriminator, e.g. Name#1234"},"realm":{"description":"Default pc","type":"string","enum":["pc","xbox","sony"]},"character":{"type":"string","minLength":1,"maxLength":100,"description":"Character name"},"name":{"type":"string","minLength":1,"maxLength":200}},"required":["account","character"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}},"summary":{"type":"object","properties":{"name":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"level":{"type":"number"},"treeVersion":{"type":"string"},"mainSkill":{"type":"string"}},"required":["name","className","level","treeVersion"],"additionalProperties":{}}},"required":["build","summary"]}`

### `GET /v1/builds/trash`

Deleted builds that can still be restored (kept 7 days after deletion).

- Name: `build.trash` (MCP `pob_build` action `trash`)
- Read-only: yes; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"builds":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}},"deletedAt":{"type":"string"},"purgeAfter":{"type":"string"}},"required":["id","name","revision","createdAt","updatedAt","source","deletedAt","purgeAfter"],"additionalProperties":{}}}},"required":["builds"]}`

### `GET /v1/builds/:id`

A build's metadata and summary (class, ascendancy, level, tree version, main skill).

- Name: `build.get` (MCP `pob_build` action `get`)
- Read-only: yes; worker: `builds.summary`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}},"summary":{"type":"object","properties":{"name":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"level":{"type":"number"},"treeVersion":{"type":"string"},"mainSkill":{"type":"string"}},"required":["name","className","level","treeVersion"],"additionalProperties":{}}},"required":["build","summary"]}`

### `POST /v1/builds/:id/rename`

Rename a build (a new revision).

- Name: `build.rename` (MCP `pob_build` action `rename`)
- Read-only: no; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"name":{"type":"string","minLength":1,"maxLength":200},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id","name"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}}},"required":["build"]}`

### `POST /v1/builds/:id/duplicate`

Copy a build into a new build.

- Name: `build.duplicate` (MCP `pob_build` action `duplicate`)
- Read-only: no; worker: `builds.load, builds.export`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"name":{"type":"string","minLength":1,"maxLength":200}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}},"summary":{"type":"object","properties":{"name":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"level":{"type":"number"},"treeVersion":{"type":"string"},"mainSkill":{"type":"string"}},"required":["name","className","level","treeVersion"],"additionalProperties":{}}},"required":["build","summary"]}`

### `DELETE /v1/builds/:id`

Delete a build. It stays restorable for 7 days (`restore`), then it and its history are removed.

- Name: `build.delete` (MCP `pob_build` action `delete`)
- Read-only: no; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"deleted":{"type":"string"},"restorableDays":{"type":"number"}},"required":["deleted","restorableDays"]}`

### `POST /v1/builds/:id/restore`

Restore a deleted build with its history.

- Name: `build.restore` (MCP `pob_build` action `restore`)
- Read-only: no; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}}},"required":["build"]}`

### `POST /v1/builds/:id/revert`

Make a kept revision current again (as a new revision).

- Name: `build.revert` (MCP `pob_build` action `revert`)
- Read-only: no; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"revision":{"type":"integer","minimum":1,"maximum":9007199254740991},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id","revision"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}}},"required":["build"]}`

### `POST /v1/builds/:id/settings`

Character level and the Auto/Manual level mode (auto follows points spent).

- Name: `build.settings` (MCP `pob_build` action `settings`)
- Read-only: no; worker: `config.set_level`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"level":{"type":"integer","minimum":1,"maximum":100},"autoLevel":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/builds/:id/xml`

A build's XML at the current or a kept revision.

- Name: `build.export_xml` (MCP `pob_build` action `export_xml`)
- Read-only: yes; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"revision":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string"},"revision":{"type":"number"},"xml":{"type":"string"}},"required":["id","revision","xml"]}`

### `PUT /v1/builds/:id/code`

Replace a build's content with a build code (the same decode as import/code); id and name stay, the revision moves on. The browser view saves through this.

- Name: `build.replace_code` (MCP `pob_build` action `replace_code`)
- Read-only: no; worker: `builds.replace`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"code":{"type":"string","minLength":1},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991,"description":"Refuse the change unless the build is at this revision"}},"required":["id","code","baseRevision"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"build":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"revision":{"type":"number"},"createdAt":{"type":"string"},"updatedAt":{"type":"string"},"source":{"type":"object","properties":{"kind":{"type":"string"}},"required":["kind"],"additionalProperties":{}}},"required":["id","name","revision","createdAt","updatedAt","source"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"}},"required":["build","changed"]}`

### `GET /v1/builds/:id/code`

A build code for the current revision, importable by Path of Building.

- Name: `build.export_code` (MCP `pob_build` action `export_code`)
- Read-only: yes; worker: `builds.export`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string"},"revision":{"type":"number"},"code":{"type":"string"}},"required":["id","revision","code"]}`

### `POST /v1/builds/:id/save-points`

Mark the current revision as a save point (kept past history pruning).

- Name: `build.save_point` (MCP `pob_build` action `save_point`)
- Read-only: no; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"label":{"type":"string","minLength":1,"maxLength":200}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string"},"revision":{"type":"number"},"label":{"type":"string"}},"required":["id","revision"]}`

### `GET /v1/builds/:id/history`

Revisions kept for a build, newest first (last 50 plus save points).

- Name: `build.history` (MCP `pob_build` action `history`)
- Read-only: yes; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string"},"revision":{"type":"number"},"history":{"type":"array","items":{"type":"object","properties":{"revision":{"type":"number"},"at":{"type":"string"},"cause":{"type":"string"}},"required":["revision","at","cause"],"additionalProperties":{}}}},"required":["id","revision","history"]}`

### `GET /v1/builds/:id/events`

Server-sent events: `hello` with the current revision, then `change` (revision, cause, changed stats) and `deleted`.

- Name: `build.events` (event stream, HTTP only)
- Read-only: yes; worker: `(events)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/stats/:id/sidebar`

The sidebar stat list as Path of Building shows it: label, value, formatted text.

- Name: `stats.sidebar` (MCP `pob_stats` action `sidebar`)
- Read-only: yes; worker: `stats.sidebar`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stats":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string"},"text":{"type":"string"},"stat":{"type":"string"},"key":{"type":"string"},"actor":{"type":"string"},"value":{"type":"number"}},"required":["label","text"],"additionalProperties":{}}},"warnings":{"type":"array","items":{"type":"string"}}},"required":["stats","warnings"]}`

### `GET /v1/stats/:id/output`

The full calculated output table; `fields` selects keys.

- Name: `stats.output` (MCP `pob_stats` action `output`)
- Read-only: yes; worker: `stats.output`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"fields":{"description":"Output keys, e.g. TotalDPS,Life","maxItems":500,"type":"array","items":{"type":"string"}},"actor":{"type":"string","enum":["player","minion"]},"mode":{"description":"main = sidebar environment, calcs = Calcs tab environment","type":"string","enum":["main","calcs"]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"mainSkill":{"type":"string"},"output":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}}},"required":["output"]}`

### `GET /v1/stats/:id/skills`

Per-skill outputs for every socket group and the Full DPS total.

- Name: `stats.skills` (MCP `pob_stats` action `skills`)
- Read-only: yes; worker: `stats.skills`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"mainSocketGroup":{"type":"number"},"groups":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"label":{"type":"string"},"slot":{"type":"string"},"enabled":{"type":"boolean"},"includeInFullDPS":{"type":"boolean"},"mainActiveSkill":{"type":"number"},"activeSkills":{"type":"array","items":{"type":"string"}},"gems":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"level":{"type":"number"},"quality":{"type":"number"},"enabled":{"type":"boolean"},"count":{"type":"number"}},"required":["enabled"],"additionalProperties":{}}},"mainSkill":{"type":"string"},"output":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"number"}}},"required":["index","enabled","includeInFullDPS","activeSkills","gems"],"additionalProperties":{}}},"fullDPS":{"type":"object","properties":{"FullDPS":{"type":"number"},"FullDotDPS":{"type":"number"},"skills":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"dps":{"type":"number"},"count":{"type":"number"}},"additionalProperties":{}}}},"required":["skills"],"additionalProperties":{}}},"required":["groups","fullDPS"],"additionalProperties":{}}`

### `GET /v1/stats/:id/breakdown`

How one output value is built (the Calcs tab breakdown).

- Name: `stats.breakdown` (MCP `pob_stats` action `breakdown`)
- Read-only: yes; worker: `stats.breakdown`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"key":{"type":"string","minLength":1,"maxLength":100,"description":"Output key, e.g. Life"},"actor":{"type":"string","enum":["player","minion"]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["key","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"key":{"type":"string"},"value":{},"breakdown":{}},"required":["key","breakdown"],"additionalProperties":{}}`

### `GET /v1/stats/:id/warnings`

Build warnings (unmet requirements, over-allocated points, and the like).

- Name: `stats.warnings` (MCP `pob_stats` action `warnings`)
- Read-only: yes; worker: `stats.warnings`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"warnings":{"type":"array","items":{"type":"string"}}},"required":["warnings"]}`

### `GET /v1/stats/:id/defences`

Attribute totals and requirements; resistances with total, overcap and maximum.

- Name: `stats.defences` (MCP `pob_stats` action `defences`)
- Read-only: yes; worker: `stats.defences`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"attributes":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"number"}},"resistances":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"number"}}}},"required":["attributes","resistances"],"additionalProperties":{}}`

### `GET /v1/stats/:id/points`

Passive and ascendancy points used and available, required level.

- Name: `stats.points` (MCP `pob_stats` action `points`)
- Read-only: yes; worker: `stats.points`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"used":{"type":"number"},"max":{"type":"number"},"ascendancyUsed":{"type":"number"},"ascendancyMax":{"type":"number"},"secondaryAscendancyUsed":{"type":"number"},"jewelSockets":{"type":"number"},"requiredLevel":{"type":"number"},"act":{"type":"string"}},"additionalProperties":{}}`

### `GET /v1/stats/:id/versions`

Path of Building version, the build's tree version and the latest tree version.

- Name: `stats.versions` (MCP `pob_stats` action `versions`)
- Read-only: yes; worker: `stats.versions`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"pobVersion":{"type":"string"},"latestTreeVersion":{"type":"string"},"treeVersion":{"type":"string"},"treeVersionDisplay":{"type":"string"},"targetVersion":{"type":"string"}},"required":["treeVersion"],"additionalProperties":{}}`

### `GET /v1/tree/:id/get`

The allocated tree: class, ascendancy, bloodline, nodes, masteries, tattoos, jewel sockets, tree list.

- Name: `tree.get` (MCP `pob_tree` action `get`)
- Read-only: yes; worker: `tree.get`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"treeVersion":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"bloodline":{"type":"string"},"points":{"type":"number"},"ascendancyPoints":{"type":"number"},"bloodlinePoints":{"type":"number"},"nodes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"type":{"type":"string"},"ascendancy":{"type":"string"},"allocated":{"type":"boolean"}},"required":["id","name","type","allocated"],"additionalProperties":{}}},"masteries":{"type":"array","items":{"type":"object","properties":{"nodeId":{"type":"number"},"effectId":{"type":"number"},"stats":{"type":"array","items":{"type":"string"}}},"required":["nodeId","effectId","stats"],"additionalProperties":{}}},"tattoos":{"type":"array","items":{"type":"object","properties":{"nodeId":{"type":"number"},"name":{"type":"string"},"stats":{"type":"array","items":{"type":"string"}}},"required":["nodeId","name","stats"],"additionalProperties":{}}},"jewelSockets":{"type":"array","items":{"type":"object","properties":{"nodeId":{"type":"number"},"itemId":{"type":"number"}},"required":["nodeId","itemId"],"additionalProperties":{}}},"specs":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"treeVersion":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"points":{"type":"number"},"ascendancyPoints":{"type":"number"},"active":{"type":"boolean"}},"required":["index","title","treeVersion","className","points","ascendancyPoints","active"],"additionalProperties":{}}}},"required":["treeVersion","className","points","ascendancyPoints","nodes","masteries","tattoos","jewelSockets","specs"],"additionalProperties":{}}`

### `POST /v1/tree/:id/set-class`

Change class. If the tree is not connected to the new start, `onDisconnected` decides: fail (default), reset the tree, or connect it by the shortest path.

- Name: `tree.set_class` (MCP `pob_tree` action `set_class`)
- Read-only: no; worker: `tree.set_class`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"className":{"type":"string","minLength":1,"maxLength":50,"description":"e.g. Shadow"},"onDisconnected":{"type":"string","enum":["fail","reset","connect"]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["className","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/set-ascendancy`

Change ascendancy (of the current class), or None.

- Name: `tree.set_ascendancy` (MCP `pob_tree` action `set_ascendancy`)
- Read-only: no; worker: `tree.set_ascendancy`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"ascendancy":{"type":"string","minLength":1,"maxLength":50},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["ascendancy","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/set-bloodline`

Change the secondary ascendancy (bloodline), or None.

- Name: `tree.set_bloodline` (MCP `pob_tree` action `set_bloodline`)
- Read-only: no; worker: `tree.set_bloodline`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"bloodline":{"type":"string","minLength":1,"maxLength":50},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["bloodline","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/allocate`

Allocate nodes, each with the shortest path to it, as clicking them does.

- Name: `tree.allocate` (MCP `pob_tree` action `allocate`)
- Read-only: no; worker: `tree.allocate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodes":{"minItems":1,"maxItems":200,"type":"array","items":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["nodes","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/deallocate`

Deallocate nodes and every node that depended on them.

- Name: `tree.deallocate` (MCP `pob_tree` action `deallocate`)
- Read-only: no; worker: `tree.deallocate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodes":{"minItems":1,"maxItems":200,"type":"array","items":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["nodes","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/reset`

Reset the tree (the Reset Tree button).

- Name: `tree.reset` (MCP `pob_tree` action `reset`)
- Read-only: no; worker: `tree.reset`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/tree/:id/mastery-options`

The effects a mastery node offers and which is selected.

- Name: `tree.mastery_options` (MCP `pob_tree` action `mastery_options`)
- Read-only: yes; worker: `tree.mastery_options`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodeId":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["nodeId","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodeId":{"type":"number"},"name":{"type":"string"},"allocated":{"type":"boolean"},"effects":{"type":"array","items":{"type":"object","properties":{"effectId":{"type":"number"},"stats":{"type":"array","items":{"type":"string"}},"selected":{"type":"boolean"}},"required":["effectId","stats","selected"],"additionalProperties":{}}}},"required":["nodeId","name","allocated","effects"],"additionalProperties":{}}`

### `POST /v1/tree/:id/set-mastery`

Choose a mastery effect; allocates the mastery if needed.

- Name: `tree.set_mastery` (MCP `pob_tree` action `set_mastery`)
- Read-only: no; worker: `tree.set_mastery`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodeId":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"},"effectId":{"type":"integer","minimum":0,"maximum":9007199254740991},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["nodeId","effectId","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/remove-tattoos`

Remove every tattoo from the tree.

- Name: `tree.remove_tattoos` (MCP `pob_tree` action `remove_tattoos`)
- Read-only: no; worker: `tree.remove_tattoos`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/tree/:id/export-url`

The tree as a passive tree link (pathofexile.com).

- Name: `tree.export_url` (MCP `pob_tree` action `export_url`)
- Read-only: yes; worker: `tree.export_url`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"url":{"type":"string"}},"required":["url"],"additionalProperties":{}}`

### `POST /v1/tree/:id/import-url`

Add a tree from a passive tree link as a new tree in the list and make it active.

- Name: `tree.import_url` (MCP `pob_tree` action `import_url`)
- Read-only: no; worker: `tree.import_url`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"url":{"type":"string","maxLength":4000,"format":"uri"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["url","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/tree/:id/path`

Shortest path: without `from`, the nodes allocating `to` would add; with it, the fewest-node route between two nodes.

- Name: `tree.path` (MCP `pob_tree` action `path`)
- Read-only: yes; worker: `tree.path`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"to":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"},"from":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["to","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"length":{"type":"number"},"nodes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"type":{"type":"string"},"ascendancy":{"type":"string"},"allocated":{"type":"boolean"}},"required":["id","name","type","allocated"],"additionalProperties":{}}}},"required":["length","nodes"],"additionalProperties":{}}`

### `POST /v1/tree/:id/spec-new`

Add an empty tree to the tree list.

- Name: `tree.spec_new` (MCP `pob_tree` action `spec_new`)
- Read-only: no; worker: `tree.spec_new`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-copy`

Copy a tree in the tree list.

- Name: `tree.spec_copy` (MCP `pob_tree` action `spec_copy`)
- Read-only: no; worker: `tree.spec_copy`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-rename`

Rename a tree in the tree list.

- Name: `tree.spec_rename` (MCP `pob_tree` action `spec_rename`)
- Read-only: no; worker: `tree.spec_rename`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","title","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-delete`

Delete a tree from the tree list (not the last one).

- Name: `tree.spec_delete` (MCP `pob_tree` action `spec_delete`)
- Read-only: no; worker: `tree.spec_delete`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-activate`

Make a tree in the tree list the active one.

- Name: `tree.spec_activate` (MCP `pob_tree` action `spec_activate`)
- Read-only: no; worker: `tree.spec_activate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/convert`

Convert the active tree to another tree version (default the latest); `keepOld` converts a copy.

- Name: `tree.convert` (MCP `pob_tree` action `convert`)
- Read-only: no; worker: `tree.convert`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"version":{"type":"string","pattern":"^\\d+_\\d+(_[a-z]+)?$","description":"e.g. 3_30"},"keepOld":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/config/:id/get`

Configuration values that differ from default on the active config set, the config set list, level settings.

- Name: `config.get` (MCP `pob_config` action `get`)
- Read-only: yes; worker: `config.get`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"values":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{}},"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}},"level":{"type":"number"},"autoLevel":{"type":"boolean"}},"required":["values","sets","autoLevel"],"additionalProperties":{}}`

### `POST /v1/config/:id/set`

Set configuration options (see lookup `config` for names and allowed values); `reset` puts options back to their default.

- Name: `config.set` (MCP `pob_config` action `set`)
- Read-only: no; worker: `config.set`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"values":{"type":"object","propertyNames":{"type":"string","minLength":1,"maxLength":100},"additionalProperties":{"anyOf":[{"type":"boolean"},{"type":"number"},{"type":"string","maxLength":20000}]}},"reset":{"maxItems":500,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-new`

Add a config set.

- Name: `config.set_new` (MCP `pob_config` action `set_new`)
- Read-only: no; worker: `config.set_new`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-copy`

Copy a config set.

- Name: `config.set_copy` (MCP `pob_config` action `set_copy`)
- Read-only: no; worker: `config.set_copy`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Config set number in the set list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-rename`

Rename a config set.

- Name: `config.set_rename` (MCP `pob_config` action `set_rename`)
- Read-only: no; worker: `config.set_rename`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Config set number in the set list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","title","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-delete`

Delete a config set (not the last one).

- Name: `config.set_delete` (MCP `pob_config` action `set_delete`)
- Read-only: no; worker: `config.set_delete`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Config set number in the set list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-activate`

Make a config set the active one.

- Name: `config.set_activate` (MCP `pob_config` action `set_activate`)
- Read-only: no; worker: `config.set_activate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Config set number in the set list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/config/:id/notes`

The build notes (Notes tab), with colour codes.

- Name: `config.notes` (MCP `pob_config` action `notes`)
- Read-only: yes; worker: `config.notes`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":{}}`

### `POST /v1/config/:id/set-notes`

Replace the build notes.

- Name: `config.set_notes` (MCP `pob_config` action `set_notes`)
- Read-only: no; worker: `config.set_notes`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"text":{"type":"string","maxLength":100000},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["text","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/lookup/gems`

Search gems by name and tag, with requirements at a level.

- Name: `lookup.gems` (MCP `pob_lookup` action `gems`)
- Read-only: yes; worker: `lookup.gems`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string","maxLength":100},"tag":{"type":"string","maxLength":50},"support":{"type":"boolean"},"level":{"type":"integer","minimum":1,"maximum":40},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"total":{"type":"number"},"offset":{"type":"number"},"gems":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"support":{"type":"boolean"},"tags":{"type":"array","items":{"type":"string"}},"tagString":{"type":"string"},"naturalMaxLevel":{"type":"number"},"description":{"type":"string"},"requirements":{"type":"object","properties":{"gemLevel":{"type":"number"},"level":{"type":"number"},"str":{"type":"number"},"dex":{"type":"number"},"int":{"type":"number"}},"required":["gemLevel","level","str","dex","int"],"additionalProperties":{}}},"required":["id","name","support","tags"],"additionalProperties":{}}}},"required":["total","offset","gems"],"additionalProperties":{}}`

### `GET /v1/lookup/uniques`

Search uniques by name or by a line of their text.

- Name: `lookup.uniques` (MCP `pob_lookup` action `uniques`)
- Read-only: yes; worker: `lookup.uniques`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string","maxLength":100},"text":{"type":"string","maxLength":200},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"total":{"type":"number"},"offset":{"type":"number"},"uniques":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"title":{"type":"string"},"base":{"type":"string"},"type":{"type":"string"},"variants":{"type":"number"},"text":{"type":"string"}},"required":["name","text"],"additionalProperties":{}}}},"required":["total","offset","uniques"],"additionalProperties":{}}`

### `GET /v1/lookup/bases`

Search item bases by name and type.

- Name: `lookup.bases` (MCP `pob_lookup` action `bases`)
- Read-only: yes; worker: `lookup.bases`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string","maxLength":100},"type":{"type":"string","maxLength":50},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"total":{"type":"number"},"offset":{"type":"number"},"bases":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"],"additionalProperties":{}}}},"required":["total","offset","bases"],"additionalProperties":{}}`

### `GET /v1/lookup/nodes`

Search passive tree nodes by name or stat text (the tree search box).

- Name: `lookup.nodes` (MCP `pob_lookup` action `nodes`)
- Read-only: yes; worker: `lookup.nodes`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string","minLength":1,"maxLength":200},"type":{"description":"Normal, Notable, Keystone, Mastery, Socket, ...","type":"string","maxLength":30},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}},"required":["query"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"total":{"type":"number"},"offset":{"type":"number"},"treeVersion":{"type":"string"},"nodes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"type":{"type":"string"},"ascendancy":{"type":"string"},"allocated":{"type":"boolean"},"stats":{"type":"array","items":{"type":"string"}}},"required":["id","name","type","allocated","stats"],"additionalProperties":{}}}},"required":["total","offset","treeVersion","nodes"],"additionalProperties":{}}`

### `GET /v1/lookup/nodes/:nodeId`

One passive node: stats, links, path length from the current tree, mastery effects.

- Name: `lookup.node` (MCP `pob_lookup` action `node`)
- Read-only: yes; worker: `lookup.node`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodeId":{"type":"integer","minimum":0,"maximum":9007199254740991},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}},"required":["nodeId"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"type":{"type":"string"},"ascendancy":{"type":"string"},"allocated":{"type":"boolean"},"stats":{"type":"array","items":{"type":"string"}},"linked":{"type":"array","items":{"type":"number"}},"pathLength":{"type":"number"},"reminderText":{},"flavourText":{},"masteryEffects":{"type":"array","items":{"type":"object","properties":{"effect":{"type":"number"},"stats":{"type":"array","items":{"type":"string"}}},"required":["effect","stats"],"additionalProperties":{}}},"selectedMasteryEffect":{"type":"number"}},"required":["id","name","type","allocated","stats","linked"],"additionalProperties":{}}`

### `GET /v1/lookup/config`

The configuration option catalogue: type, section, allowed values, current value; `var` adds the tooltip.

- Name: `lookup.config` (MCP `pob_lookup` action `config`)
- Read-only: yes; worker: `lookup.config`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"section":{"type":"string","maxLength":100},"query":{"type":"string","maxLength":100},"var":{"type":"string","maxLength":100},"relevantOnly":{"description":"Only options that apply to this build","type":"boolean"},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"total":{"type":"number"},"offset":{"type":"number"},"options":{"type":"array","items":{"type":"object","properties":{"var":{"type":"string"},"type":{"type":"string"},"label":{"type":"string"},"section":{"type":"string"},"current":{},"placeholder":{},"relevant":{"type":"boolean"},"allowed":{"type":"array","items":{"type":"object","properties":{"value":{},"label":{"type":"string"}},"required":["value","label"],"additionalProperties":{}}},"default":{},"tooltip":{"type":"string"}},"required":["var","label"],"additionalProperties":{}}}},"required":["total","offset","options"],"additionalProperties":{}}`
