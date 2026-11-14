# Path of Building API

Generated from `server/src/routes.ts` by `npm run docs`; do not edit by hand.

Every `/v1` route and `POST /mcp` need `Authorization: Bearer <POB_API_TOKEN>`. `GET /health` is open; `GET /health/deep` is open unless `POB_HEALTH_TOKEN` is set (then send it as `x-health-token`).

Replies are `{ "ok": true, "result": ..., "warnings": [...] }` or `{ "ok": false, "error": { "code", "message" } }`. Error codes: `not_found` 404, `invalid_input` 400, `unauthorized` 401, `stale_revision` 409, `payload_too_large` 413, `rate_limited` 429, `worker_error` 500, `unsupported` 501, `upstream_fetch_failed` 502, `worker_timeout` 504.

GET inputs go in the query string (lists comma-separated); POST inputs are a JSON body; path parameters are part of the input.

## MCP tools

| Tool | Read-only | Actions |
| --- | --- | --- |
| `pob_build` | no | `list`, `new`, `import_xml`, `import_code`, `import_link`, `get`, `rename`, `duplicate`, `delete`, `export_xml`, `export_code`, `save_point`, `history` |
| `pob_stats` | yes | `sidebar`, `output`, `skills`, `breakdown`, `warnings`, `defences`, `points`, `versions` |
| `pob_lookup` | yes | `gems`, `uniques`, `bases`, `nodes`, `node`, `config` |

Not yet routed (no actions, so not listed by the server): `pob_tree`, `pob_skills`, `pob_items`, `pob_config`, `pob_evaluate`, `pob_trade`.

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

Delete a build and its history.

- Name: `build.delete` (MCP `pob_build` action `delete`)
- Read-only: no; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"deleted":{"type":"string"}},"required":["deleted"]}`

### `GET /v1/builds/:id/xml`

A build's XML at the current or a kept revision.

- Name: `build.export_xml` (MCP `pob_build` action `export_xml`)
- Read-only: yes; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"revision":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string"},"revision":{"type":"number"},"xml":{"type":"string"}},"required":["id","revision","xml"]}`

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
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/stats/:id/breakdown`

How one output value is built (the Calcs tab breakdown).

- Name: `stats.breakdown` (MCP `pob_stats` action `breakdown`)
- Read-only: yes; worker: `stats.breakdown`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"key":{"type":"string","minLength":1,"maxLength":100,"description":"Output key, e.g. Life"},"actor":{"type":"string","enum":["player","minion"]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["key","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/stats/:id/warnings`

Build warnings (unmet requirements, over-allocated points, and the like).

- Name: `stats.warnings` (MCP `pob_stats` action `warnings`)
- Read-only: yes; worker: `stats.warnings`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"warnings":{"type":"array","items":{"type":"string"}}},"required":["warnings"]}`

### `GET /v1/stats/:id/defences`

Attribute requirements, resistances with overcap, life, mana, energy shield.

- Name: `stats.defences` (MCP `pob_stats` action `defences`)
- Read-only: yes; worker: `stats.defences`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/stats/:id/points`

Passive and ascendancy points used and available, required level.

- Name: `stats.points` (MCP `pob_stats` action `points`)
- Read-only: yes; worker: `stats.points`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/stats/:id/versions`

Path of Building version, the build's tree version and the latest tree version.

- Name: `stats.versions` (MCP `pob_stats` action `versions`)
- Read-only: yes; worker: `stats.versions`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/lookup/gems`

Search gems by name and tag, with requirements at a level.

- Name: `lookup.gems` (MCP `pob_lookup` action `gems`)
- Read-only: yes; worker: `lookup.gems`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string","maxLength":100},"tag":{"type":"string","maxLength":50},"support":{"type":"boolean"},"level":{"type":"integer","minimum":1,"maximum":40},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/lookup/uniques`

Search uniques by name or by a line of their text.

- Name: `lookup.uniques` (MCP `pob_lookup` action `uniques`)
- Read-only: yes; worker: `lookup.uniques`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string","maxLength":100},"text":{"type":"string","maxLength":200},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/lookup/bases`

Search item bases by name and type.

- Name: `lookup.bases` (MCP `pob_lookup` action `bases`)
- Read-only: yes; worker: `lookup.bases`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string","maxLength":100},"type":{"type":"string","maxLength":50},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/lookup/nodes`

Search passive tree nodes by name or stat text (the tree search box).

- Name: `lookup.nodes` (MCP `pob_lookup` action `nodes`)
- Read-only: yes; worker: `lookup.nodes`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string","minLength":1,"maxLength":200},"type":{"description":"Normal, Notable, Keystone, Mastery, Socket, ...","type":"string","maxLength":30},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}},"required":["query"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/lookup/nodes/:nodeId`

One passive node: stats, links, path length from the current tree, mastery effects.

- Name: `lookup.node` (MCP `pob_lookup` action `node`)
- Read-only: yes; worker: `lookup.node`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodeId":{"type":"integer","minimum":0,"maximum":9007199254740991},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}},"required":["nodeId"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`

### `GET /v1/lookup/config`

The configuration option catalogue: type, section, allowed values, current value; `var` adds the tooltip.

- Name: `lookup.config` (MCP `pob_lookup` action `config`)
- Read-only: yes; worker: `lookup.config`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"section":{"type":"string","maxLength":100},"query":{"type":"string","maxLength":100},"var":{"type":"string","maxLength":100},"relevantOnly":{"description":"Only options that apply to this build","type":"boolean"},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}}}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema"}`
