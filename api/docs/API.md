# Path of Building API

Generated from `server/src/routes.ts` by `npm run docs`; do not edit by hand.

Every `/v1` route and `POST /mcp` need `Authorization: Bearer <POB_API_TOKEN>`. `GET /health` is open; `GET /health/deep` needs the bearer token, or `POB_HEALTH_TOKEN` in `x-health-token` when that is set. After `POB_AUTH_FAILURES_PER_MINUTE` (default 30) failed credential checks in a minute, requests without a valid credential get 429 with `Retry-After`.

Replies are `{ "ok": true, "result": ..., "warnings": [...] }` or `{ "ok": false, "error": { "code", "message" } }`. Error codes: `not_found` 404, `invalid_input` 400, `unauthorized` 401, `stale_revision` 409, `payload_too_large` 413, `rate_limited` 429, `worker_error` 500, `unsupported` 501, `upstream_fetch_failed` 502, `worker_timeout` 504.

GET inputs go in the query string (lists comma-separated); POST and PUT inputs are a JSON body only (a query string on them is refused); path parameters are part of the input.

## MCP tools

| Tool | Read-only | Actions |
| --- | --- | --- |
| `pob_build` | no | `list`, `new`, `import_xml`, `import_code`, `import_link`, `characters`, `import_character`, `reimport`, `trash`, `get`, `rename`, `duplicate`, `delete`, `restore`, `revert`, `settings`, `loadout_list`, `loadout_activate`, `loadout_new`, `ui_controls`, `ui_invoke`, `export_xml`, `replace_code`, `export_code`, `save_point`, `history` |
| `pob_stats` | yes | `sidebar`, `output`, `skills`, `breakdown`, `warnings`, `defences`, `points`, `xp`, `sections`, `versions` |
| `pob_tree` | no | `get`, `set_class`, `set_ascendancy`, `set_bloodline`, `allocate`, `deallocate`, `reset`, `mastery_options`, `set_mastery`, `remove_tattoos`, `copy_from`, `tattoo_options`, `tattoo`, `untattoo`, `export_url`, `import_url`, `radius_nodes`, `path`, `spec_new`, `spec_copy`, `spec_rename`, `spec_delete`, `spec_activate`, `spec_move`, `convert`, `convert_all` |
| `pob_skills` | no | `get`, `group_text`, `group_tooltip`, `gem_tooltip`, `add_group`, `update_group`, `delete_group`, `move_group`, `set_main`, `set_gem`, `delete_gem`, `set_imbued`, `optimise_sockets`, `set_options`, `set_skill_options`, `set_spectres`, `set_new`, `set_copy`, `set_rename`, `set_delete`, `set_activate` |
| `pob_items` | no | `list`, `get`, `add`, `add_unique`, `add_rare`, `modify`, `edit`, `anoint`, `enchant`, `copy_from`, `craft`, `affix_options`, `influence`, `corrupt`, `add_implicit`, `custom_mod`, `crucible_mod`, `cluster_jewel`, `equip`, `unequip`, `set_active`, `delete`, `weapon_set`, `set_new`, `set_copy`, `set_rename`, `set_delete`, `set_activate` |
| `pob_config` | no | `get`, `set`, `set_new`, `set_copy`, `set_rename`, `set_delete`, `set_activate`, `custom_mods`, `set_custom_mods`, `copy_from`, `party_export`, `notes`, `set_notes`, `party_get`, `party_import`, `party_clear`, `party_set`, `party_effects` |
| `pob_evaluate` | yes | `what_if`, `passives`, `node_power`, `compare_item`, `jewel_mods`, `timeless`, `gem_rank`, `anoint_rank`, `unique_rank`, `compare_specs`, `compare_item_sets`, `compare_builds`, `compare_power` |
| `pob_lookup` | yes | `gems`, `uniques`, `bases`, `nodes`, `node`, `config`, `data` |
| `pob_trade` | yes | `search` |

## Routes

### `GET /v1/builds`

List stored builds, most recently changed first; `query` keeps builds whose name contains the text, `sort` orders them.

- Name: `build.list` (MCP `pob_build` action `list`)
- Read-only: yes; worker: `(store)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"description":"Case-insensitive text the build name contains","type":"string","minLength":1,"maxLength":100},"sort":{"default":"updated","description":"updated and created: newest first; name: A to Z","type":"string","enum":["updated","name","created"]}}}`
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

### `POST /v1/builds/import/characters`

Characters on a public Path of Exile profile (name, league, class, level). The profile's Characters tab must be public. POST so the account name travels in the body, not in a URL that proxies log.

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

### `POST /v1/builds/:id/reimport`

Re-import this build from the character it was imported from (the Compare tab's Re-import): tree, jewels, items and skills are replaced; fails for builds not imported from a character.

- Name: `build.reimport` (MCP `pob_build` action `reimport`)
- Read-only: no; worker: `builds.reimport`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991},"ignoreWeaponSwap":{"description":"Skip the character's weapon swap (the Import tab's box)","type":"boolean"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"name":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"level":{"type":"number"},"treeVersion":{"type":"string"},"mainSkill":{"type":"string"}},"required":["name","className","level","treeVersion"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

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
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"level":{"type":"number"},"autoLevel":{"type":"boolean"}},"required":["level","autoLevel"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/loadouts/:id/list`

The Loadouts dropdown: trees whose title matches an item set, a skill set and a config set (or share a `{id}` link), the one in use, and the active set of each tab. A tab with a single set matches every tree.

- Name: `build.loadout_list` (MCP `pob_build` action `loadout_list`)
- Read-only: yes; worker: `loadouts.list`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"loadouts":{"type":"array","items":{"type":"string"}},"active":{"type":["string","null"]},"sets":{"type":"object","properties":{"tree":{"type":"string"},"items":{"type":"string"},"skills":{"type":"string"},"config":{"type":"string"}},"required":["tree","items","skills","config"],"additionalProperties":{}}},"required":["loadouts","active","sets"],"additionalProperties":{}}`

### `POST /v1/loadouts/:id/activate`

Switch tree, item set, skill set and config set to a loadout in one step, as picking it in the Loadouts dropdown does.

- Name: `build.loadout_activate` (MCP `pob_build` action `loadout_activate`)
- Read-only: no; worker: `loadouts.activate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":100,"description":"Loadout as `loadout_list` gives it"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["name","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"active":{"type":"string"},"sets":{"type":"object","properties":{"tree":{"type":"string"},"items":{"type":"string"},"skills":{"type":"string"},"config":{"type":"string"}},"required":["tree","items","skills","config"],"additionalProperties":{}}},"required":["active","sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/loadouts/:id/new`

Make a loadout and switch to it: copies of the active tree, item set, skill set and config set under one title, or with `empty` four new empty sets (New Loadout). The answer lists loadouts that stopped matching (a tab that had one set now has two).

- Name: `build.loadout_new` (MCP `pob_build` action `loadout_new`)
- Read-only: no; worker: `loadouts.new`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":100,"description":"Title for the four sets; no braces"},"empty":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["name","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"name":{"type":"string"},"sets":{"type":"object","properties":{"tree":{"type":"string"},"items":{"type":"string"},"skills":{"type":"string"},"config":{"type":"string"}},"required":["tree","items","skills","config"],"additionalProperties":{}},"dropped":{"type":"array","items":{"type":"string"}}},"required":["name","sets","dropped"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/ui/:id/controls`

The controls of a tab by name (name, type, label or text, state, shown, enabled, a dropdown's choices, and the `ui_invoke` actions each takes now).

- Name: `build.ui_controls` (MCP `pob_build` action `ui_controls`)
- Read-only: yes; worker: `ui.controls`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"tab":{"type":"string","enum":["build","tree","skills","items","calcs","config","notes","party","import"],"description":"build = the build's own top bar and sidebar controls"},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["tab","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"tab":{"type":"string"},"total":{"type":"number"},"offset":{"type":"number"},"controls":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"type":{"type":"string"},"shown":{"type":"boolean"},"enabled":{"type":"boolean"},"actions":{"type":"array","items":{"type":"string"}},"label":{"type":"string"},"text":{"type":"string"},"state":{"type":"boolean"},"selected":{"type":"number"},"choices":{"type":"array","items":{"type":"string"}},"choiceCount":{"type":"number"}},"required":["name","type","shown","enabled","actions"],"additionalProperties":{}}}},"required":["tab","total","offset","controls"],"additionalProperties":{}}`

### `POST /v1/ui/:id/invoke`

A stopgap for actions that have no named op: click a button, type in a box, tick a checkbox or pick a dropdown entry on a tab's control, as `ui_controls` lists them. Hidden or disabled controls, actions the control does not take, and controls that save to a file, reach the network or leave the build are refused.

- Name: `build.ui_invoke` (MCP `pob_build` action `ui_invoke`)
- Read-only: no; worker: `ui.invoke`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"tab":{"type":"string","enum":["build","tree","skills","items","calcs","config","notes","party","import"],"description":"build = the build's own top bar and sidebar controls"},"control":{"type":"string","minLength":1,"maxLength":100,"description":"Control name, from `ui_controls`"},"operation":{"type":"string","enum":["click","set_text","set_state","select"]},"value":{"description":"set_text: the text; set_state: true or false; select: the choice number (from 1) or its label","anyOf":[{"type":"boolean"},{"type":"number"},{"type":"string","maxLength":20000}]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["tab","control","operation","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"tab":{"type":"string"},"control":{"type":"string"},"operation":{"type":"string"},"text":{"type":"string"},"state":{"type":"boolean"},"selected":{"type":"number"}},"required":["tab","control","operation"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

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

The sidebar stat list as Path of Building shows it: label, value, formatted text. Labels are not unique (the player's and the minion's `Hit DPS` share one); `key` and `actor` tell them apart.

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

### `GET /v1/stats/:id/xp`

The experience multiplier table of the character level box's hover: for each area level (with its map tier from 68) the percent of experience earned at the build's level.

- Name: `stats.xp` (MCP `pob_stats` action `xp`)
- Read-only: yes; worker: `stats.xp`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"level":{"type":"number"},"areas":{"type":"array","items":{"type":"object","properties":{"areaLevel":{"type":"number"},"tier":{"type":"number"},"percent":{"type":"number"}},"required":["areaLevel","percent"],"additionalProperties":{}}}},"required":["level","areas"],"additionalProperties":{}}`

### `GET /v1/stats/:id/sections`

The Calcs tab's sections as displayed for the shown actor: subsections with their visible rows and cell texts; `section` keeps the section with that id, else the sections whose subsection label contains it.

- Name: `stats.sections` (MCP `pob_stats` action `sections`)
- Read-only: yes; worker: `stats.sections`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"section":{"description":"Section id (e.g. Life), else part of a subsection label (any case)","type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"sections":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"label":{"type":"string"},"subsections":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string"},"extra":{"type":"string"},"rows":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string"},"values":{"type":"array","items":{"type":"string"}}},"required":["label","values"],"additionalProperties":{}}}},"required":["label","rows"],"additionalProperties":{}}}},"required":["id","label","subsections"],"additionalProperties":{}}}},"required":["sections"],"additionalProperties":{}}`

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
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"className":{"type":"string","minLength":1,"maxLength":50,"description":"e.g. Shadow"},"onDisconnected":{"description":"When the tree is not connected to the other class's start: fail, reset the tree, or connect it by the shortest path","type":"string","enum":["fail","reset","connect"]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["className","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"className":{"type":"string"}},"required":["className"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/set-ascendancy`

Change ascendancy (of the current class), or None.

- Name: `tree.set_ascendancy` (MCP `pob_tree` action `set_ascendancy`)
- Read-only: no; worker: `tree.set_ascendancy`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"ascendancy":{"type":"string","minLength":1,"maxLength":50},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["ascendancy","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"ascendancy":{"type":"string"}},"required":["ascendancy"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/set-bloodline`

Change the secondary ascendancy (bloodline), or None.

- Name: `tree.set_bloodline` (MCP `pob_tree` action `set_bloodline`)
- Read-only: no; worker: `tree.set_bloodline`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"bloodline":{"type":"string","minLength":1,"maxLength":50},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["bloodline","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"bloodline":{"type":"string"}},"required":["bloodline"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/allocate`

Allocate nodes, each with the shortest path to it, as clicking them does. A node of another ascendancy or bloodline is refused unless `ascendancy` is "switch", which switches to that ascendancy, bloodline or class first, as clicking the node does (`onDisconnected` as in set_class).

- Name: `tree.allocate` (MCP `pob_tree` action `allocate`)
- Read-only: no; worker: `tree.allocate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodes":{"minItems":1,"maxItems":200,"type":"array","items":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"}},"ascendancy":{"description":"switch: change to the node's ascendancy, bloodline or class first","type":"string","enum":["fail","switch"]},"onDisconnected":{"description":"When the tree is not connected to the other class's start: fail, reset the tree, or connect it by the shortest path","type":"string","enum":["fail","reset","connect"]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["nodes","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"allocated":{"type":"array","items":{"type":"number"}},"className":{"type":"string"},"ascendancy":{"type":"string"},"bloodline":{"type":"string"}},"required":["allocated"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/deallocate`

Deallocate nodes and every node that depended on them.

- Name: `tree.deallocate` (MCP `pob_tree` action `deallocate`)
- Read-only: no; worker: `tree.deallocate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"nodes":{"minItems":1,"maxItems":200,"type":"array","items":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["nodes","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/reset`

Reset the tree (the Reset Tree button).

- Name: `tree.reset` (MCP `pob_tree` action `reset`)
- Read-only: no; worker: `tree.reset`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

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
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"nodeId":{"type":"number"},"effectId":{"type":"number"}},"required":["nodeId","effectId"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/remove-tattoos`

Remove every tattoo from the tree.

- Name: `tree.remove_tattoos` (MCP `pob_tree` action `remove_tattoos`)
- Read-only: no; worker: `tree.remove_tattoos`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"removed":{"type":"number"}},"required":["removed"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/copy-from`

Copy another build's active tree into this build's tree list, as the Compare tab's copy does (titled "(Compared)"; jewels stay behind, they are the other build's items); `use` makes it the active tree.

- Name: `tree.copy_from` (MCP `pob_tree` action `copy_from`)
- Read-only: no; worker: `tree.copy_from, with the other build in the Compare tab`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"use":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991},"other":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"The other build, loaded as the Compare tab's compared build"},"otherSets":{"description":"The other build's tree, skill, item and config sets to compare (1-based, in list order), as the Compare tab's set dropdowns pick them; default the active ones","type":"object","properties":{"tree":{"type":"integer","minimum":1,"maximum":500},"skills":{"type":"integer","minimum":1,"maximum":500},"items":{"type":"integer","minimum":1,"maximum":500},"config":{"type":"integer","minimum":1,"maximum":500}}}},"required":["id","other"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"number"}},"required":["index","title","active"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/tree/:id/tattoo-options`

The tattoos a node can take, as the Replace Modifier of Node dialog lists them (right-click a small attribute, a +30 attribute notable, a keystone or an unallocated mastery): id, name, stats, legacy; with the node's current tattoo and the tree's tattoo count against the limit of 50. `legacy` shows legacy tattoos too.

- Name: `tree.tattoo_options` (MCP `pob_tree` action `tattoo_options`)
- Read-only: yes; worker: `tree.tattoo_options`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"node":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"},"legacy":{"description":"Show Legacy Tattoos","type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["node","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"node":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":{}},"current":{"type":["string","null"]},"tattoos":{"type":"number"},"limit":{"type":"number"},"options":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"stats":{"type":"array","items":{"type":"string"}},"legacy":{"type":"boolean"}},"required":["id","name","stats","legacy"],"additionalProperties":{}}}},"required":["node","current","tattoos","limit","options"],"additionalProperties":{}}`

### `POST /v1/tree/:id/tattoo`

Tattoo a node, as the dialog's Add button does: the tattoo by name or id (exact, or one unique part). Over 50 tattoos is allowed, as in the application; `tattoos` says how many there are.

- Name: `tree.tattoo` (MCP `pob_tree` action `tattoo`)
- Read-only: no; worker: `tree.tattoo`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"node":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"},"tattoo":{"type":"string","minLength":1,"maxLength":100},"legacy":{"description":"Allow legacy tattoos","type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["node","tattoo","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"nodeId":{"type":"number"},"tattoo":{"type":["string","null"]},"tattoos":{"type":"number"},"limit":{"type":"number"}},"required":["nodeId","tattoo","tattoos","limit"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/untattoo`

Remove one node's tattoo (the dialog's Reset Node button): the node's own passive comes back.

- Name: `tree.untattoo` (MCP `pob_tree` action `untattoo`)
- Read-only: no; worker: `tree.untattoo`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"node":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["node","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"nodeId":{"type":"number"},"name":{"type":"string"},"tattoos":{"type":"number"},"limit":{"type":"number"}},"required":["nodeId","name","tattoos","limit"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

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
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"treeVersion":{"type":"string"},"className":{"type":"string"},"ascendancy":{"type":"string"},"points":{"type":"number"},"ascendancyPoints":{"type":"number"},"active":{"type":"boolean"}},"required":["index","title","treeVersion","className","points","ascendancyPoints","active"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/tree/:id/radius-nodes`

The passives within a jewel socket's radius (as radius jewels such as timeless jewels, Thread of Hope and Unnatural Instinct see them): per radius its index, label, inner and outer distance, the nodes and how many are allocated. Default the named radii (Small, Medium, Large, Very Large, Massive); `radius` picks one, including the Variable rings.

- Name: `tree.radius_nodes` (MCP `pob_tree` action `radius_nodes`)
- Read-only: yes; worker: `tree.radius_nodes`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"socket":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Socket node id, or Jewel <id>"},"radius":{"description":"Radius index from 1, or its label","anyOf":[{"type":"integer","minimum":1,"maximum":20},{"type":"string","minLength":1,"maxLength":20}]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["socket","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"socket":{"type":"number"},"allocated":{"type":"boolean"},"radii":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"label":{"type":"string"},"inner":{"type":"number"},"outer":{"type":"number"},"total":{"type":"number"},"allocated":{"type":"number"},"nodes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"type":{"type":"string"},"allocated":{"type":"boolean"}},"required":["id","name","type","allocated"],"additionalProperties":{}}}},"required":["index","label","inner","outer","total","allocated","nodes"],"additionalProperties":{}}}},"required":["socket","allocated","radii"],"additionalProperties":{}}`

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
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"count":{"type":"number"}},"required":["count"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-copy`

Copy a tree in the tree list.

- Name: `tree.spec_copy` (MCP `pob_tree` action `spec_copy`)
- Read-only: no; worker: `tree.spec_copy`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"count":{"type":"number"}},"required":["count"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-rename`

Rename a tree in the tree list.

- Name: `tree.spec_rename` (MCP `pob_tree` action `spec_rename`)
- Read-only: no; worker: `tree.spec_rename`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","title","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-delete`

Delete a tree from the tree list (not the last one).

- Name: `tree.spec_delete` (MCP `pob_tree` action `spec_delete`)
- Read-only: no; worker: `tree.spec_delete`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"count":{"type":"number"}},"required":["count"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-activate`

Make a tree in the tree list the active one.

- Name: `tree.spec_activate` (MCP `pob_tree` action `spec_activate`)
- Read-only: no; worker: `tree.spec_activate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"active":{"type":"number"}},"required":["active"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/spec-move`

Move a tree to another position in the tree list.

- Name: `tree.spec_move` (MCP `pob_tree` action `spec_move`)
- Read-only: no; worker: `tree.spec_move`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"to":{"type":"integer","minimum":1,"maximum":500,"description":"New position, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","to","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"index":{"type":"number"},"active":{"type":"number"}},"required":["index","active"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/convert`

Convert the active tree to another tree version (default the latest); `keepOld` converts a copy.

- Name: `tree.convert` (MCP `pob_tree` action `convert`)
- Read-only: no; worker: `tree.convert`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"version":{"type":"string","pattern":"^\\d+_\\d+(_[a-z]+)?$","description":"e.g. 3_30"},"keepOld":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"treeVersion":{"type":"string"}},"required":["treeVersion"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/tree/:id/convert-all`

Convert every tree in the tree list that is not on a tree version to it (default the latest); the trees are replaced.

- Name: `tree.convert_all` (MCP `pob_tree` action `convert_all`)
- Read-only: no; worker: `tree.convert_all`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"version":{"type":"string","pattern":"^\\d+_\\d+(_[a-z]+)?$","description":"e.g. 3_30"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"converted":{"type":"number"},"specs":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"treeVersion":{"type":"string"}},"required":["index","title","treeVersion"],"additionalProperties":{}}}},"required":["converted","specs"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/skills/:id/get`

The Skills tab: socket groups with their gems and active skills, the main socket group, skill sets and gem options. `mainSocketGroup` is one group number for the whole build, not per skill set (as in Path of Building): it points at the same position in every set.

- Name: `skills.get` (MCP `pob_skills` action `get`)
- Read-only: yes; worker: `skills.get`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"mainSocketGroup":{"type":"number"},"groups":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"label":{"type":"string"},"slot":{"type":"string"},"enabled":{"type":"boolean"},"includeInFullDPS":{"type":"boolean"},"gems":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"name":{"type":"string"},"level":{"type":"number"},"quality":{"type":"number"},"enabled":{"type":"boolean"},"count":{"type":"number"},"support":{"type":"boolean"},"error":{"type":"string"}},"required":["index","name","level","quality","enabled","count","support"],"additionalProperties":{}}},"activeSkills":{"type":"array","items":{"type":"string"}},"mainActiveSkill":{"type":"number"},"main":{"type":"boolean"}},"required":["index","label","enabled","includeInFullDPS","gems","activeSkills","main"],"additionalProperties":{}}},"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}},"options":{"type":"object","properties":{"defaultGemLevel":{"type":"string"},"defaultGemQuality":{"type":"number"},"showSupportGemTypes":{"type":"string"},"showLegacyGems":{"type":"boolean"}},"required":["defaultGemLevel","showSupportGemTypes","showLegacyGems"]},"mainOptions":{"type":"object","properties":{"part":{"type":"number"},"parts":{"type":"array","items":{"type":"string"}},"stages":{"type":"number"},"mines":{"type":"number"},"minion":{"type":"number"},"minions":{"type":"array","items":{"type":"string"}},"minionSkill":{"type":"number"},"minionSkills":{"type":"array","items":{"type":"string"}}},"additionalProperties":{}},"spectres":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":{}}}},"required":["mainSocketGroup","groups","sets","options","mainOptions","spectres"],"additionalProperties":{}}`

### `GET /v1/skills/:id/group-text`

A socket group as Path of Building copies it (paste it back with `add_group`).

- Name: `skills.group_text` (MCP `pob_skills` action `group_text`)
- Read-only: yes; worker: `skills.group_text`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["group","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":{}}`

### `GET /v1/skills/:id/group-tooltip`

The hover text of a socket group in the Skills tab's group list, as lines of text.

- Name: `skills.group_tooltip` (MCP `pob_skills` action `group_tooltip`)
- Read-only: yes; worker: `skills.group_tooltip`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["group","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"number"},"label":{"type":"string"},"lines":{"type":"array","items":{"type":"string"}}},"required":["group","label","lines"],"additionalProperties":{}}`

### `GET /v1/skills/:id/gem-tooltip`

The hover text of a gem's name box in the Skills tab, as lines of text.

- Name: `skills.gem_tooltip` (MCP `pob_skills` action `gem_tooltip`)
- Read-only: yes; worker: `skills.gem_tooltip`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"gem":{"type":"integer","minimum":1,"maximum":100,"description":"Gem position in the group, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["group","gem","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"number"},"gem":{"type":"number"},"name":{"type":"string"},"lines":{"type":"array","items":{"type":"string"}}},"required":["group","gem","name","lines"],"additionalProperties":{}}`

### `POST /v1/skills/:id/add-group`

Add a socket group from gems or from copy text (the Paste button). Gem names resolve as the gem box does; unknown names fail.

- Name: `skills.add_group` (MCP `pob_skills` action `add_group`)
- Read-only: no; worker: `skills.add_group`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"text":{"description":"Copy format: optional `Label:` and `Slot:` lines, then `<gem> <level>/<quality> [DISABLED] <count>` per line","type":"string","minLength":1,"maxLength":20000},"gems":{"description":"Gems of the group, in order; a gem without `level` gets the level the `defaultGemLevel` option picks (as a gem added by hand); copy text carries its own levels","minItems":1,"maxItems":12,"type":"array","items":{"type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":100},"level":{"type":"integer","minimum":1,"maximum":40,"description":"Gem level (1-40)"},"quality":{"type":"integer","minimum":0,"maximum":23,"description":"Gem quality (0-23)"},"enabled":{"type":"boolean"},"count":{"type":"integer","minimum":1,"maximum":99,"description":"Gem count"}},"required":["name"]}},"label":{"type":"string","maxLength":50,"description":"Group label (up to 50 characters)"},"slot":{"type":"string","minLength":1,"maxLength":50,"description":"Item slot name such as Body Armour or Weapon 1, or None"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"group":{"type":"number"}},"required":["group"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/update-group`

Change a socket group's label, item slot, enabled and Full DPS flags (and the count of an item-granted group).

- Name: `skills.update_group` (MCP `pob_skills` action `update_group`)
- Read-only: no; worker: `skills.update_group`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"label":{"type":"string","maxLength":50,"description":"Group label (up to 50 characters)"},"slot":{"type":"string","minLength":1,"maxLength":50,"description":"Item slot name such as Body Armour or Weapon 1, or None"},"enabled":{"type":"boolean"},"includeInFullDPS":{"type":"boolean"},"count":{"type":"integer","minimum":1,"maximum":99,"description":"Gem count"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["group","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"group":{"type":"number"}},"required":["group"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/delete-group`

Delete a socket group.

- Name: `skills.delete_group` (MCP `pob_skills` action `delete_group`)
- Read-only: no; worker: `skills.delete_group`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["group","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"groups":{"type":"number"}},"required":["groups"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/move-group`

Move a socket group to another position in the list; the main skill stays the same group.

- Name: `skills.move_group` (MCP `pob_skills` action `move_group`)
- Read-only: no; worker: `skills.move_group`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"to":{"type":"integer","minimum":1,"maximum":500,"description":"New position, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["group","to","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"group":{"type":"number"}},"required":["group"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-main`

Make a socket group the main one, and optionally pick which of its active skills is the main skill. The main group is one number for the whole build, not per skill set: setting it in one set changes the main group of every set to the group at that position.

- Name: `skills.set_main` (MCP `pob_skills` action `set_main`)
- Read-only: no; worker: `skills.set_main`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"skill":{"description":"Active skill number in the group's `activeSkills`, from 1","type":"integer","minimum":1,"maximum":50},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["group","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"mainSocketGroup":{"type":"number"},"mainSkill":{"type":"string"}},"required":["mainSocketGroup"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-gem`

Change a gem of a group (name, level, quality, enabled, count); a position one past the last gem adds one (name required), at the level the `defaultGemLevel` option picks unless `level` is given.

- Name: `skills.set_gem` (MCP `pob_skills` action `set_gem`)
- Read-only: no; worker: `skills.set_gem`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"gem":{"type":"integer","minimum":1,"maximum":100,"description":"Gem position in the group, from 1"},"name":{"description":"Gem name; the ` Support` suffix is optional","type":"string","minLength":1,"maxLength":100},"level":{"type":"integer","minimum":1,"maximum":40,"description":"Gem level (1-40)"},"quality":{"type":"integer","minimum":0,"maximum":23,"description":"Gem quality (0-23)"},"enabled":{"type":"boolean"},"count":{"type":"integer","minimum":1,"maximum":99,"description":"Gem count"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["group","gem","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"group":{"type":"number"},"gem":{"type":"number"},"name":{"type":"string"},"level":{"type":"number"},"quality":{"type":"number"}},"required":["group","gem","level","quality"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/delete-gem`

Remove a gem from a group.

- Name: `skills.delete_gem` (MCP `pob_skills` action `delete_gem`)
- Read-only: no; worker: `skills.delete_gem`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"gem":{"type":"integer","minimum":1,"maximum":100,"description":"Gem position in the group, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["group","gem","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"gems":{"type":"number"}},"required":["gems"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-imbued`

Set a group's Imbued Support (needs the group socketed in an item slot), or None to clear it.

- Name: `skills.set_imbued` (MCP `pob_skills` action `set_imbued`)
- Read-only: no; worker: `skills.set_imbued`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"name":{"type":"string","minLength":1,"maxLength":100,"description":"A support gem name, or None"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["group","name","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"imbuedSupport":{"type":"string"}},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/optimise-sockets`

Reorder a socketed group's gems to match the item's socket colours (the Optimise Sockets button).

- Name: `skills.optimise_sockets` (MCP `pob_skills` action `optimise_sockets`)
- Read-only: no; worker: `skills.optimise_sockets`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["group","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"gems":{"type":"array","items":{"type":"string"}}},"required":["gems"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-options`

Skills tab gem options: default gem level and quality, which support gems the gem box shows, legacy gems.

- Name: `skills.set_options` (MCP `pob_skills` action `set_options`)
- Read-only: no; worker: `skills.set_options`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"defaultGemLevel":{"type":"string","enum":["normalMaximum","corruptedMaximum","awakenedMaximum","characterLevel","levelOne"]},"defaultGemQuality":{"type":"integer","minimum":0,"maximum":23,"description":"Gem quality (0-23)"},"showSupportGemTypes":{"description":"NORMAL = non-exceptional","type":"string","enum":["ALL","NORMAL","EXCEPTIONAL"]},"showLegacyGems":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"defaultGemLevel":{"type":"string"},"defaultGemQuality":{"type":"number"},"showSupportGemTypes":{"type":"string"},"showLegacyGems":{"type":"boolean"}},"required":["defaultGemLevel","showSupportGemTypes","showLegacyGems"]},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-skill-options`

The main skill's sidebar choices: skill part, stages, active mines, minion and minion skill (only those the skill shows; see `get` mainOptions). Dropdowns take their number or label; set part and minion before stages and minion skill (done in that order).

- Name: `skills.set_skill_options` (MCP `pob_skills` action `set_skill_options`)
- Read-only: no; worker: `skills.set_skill_options`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"part":{"anyOf":[{"type":"integer","minimum":1,"maximum":500},{"type":"string","minLength":1,"maxLength":200}]},"stages":{"type":"integer","minimum":0,"maximum":1000},"mines":{"type":"integer","minimum":0,"maximum":1000},"minion":{"description":"Minion name (or id), or its number in the list","anyOf":[{"type":"integer","minimum":1,"maximum":500},{"type":"string","minLength":1,"maxLength":200}]},"minionSkill":{"anyOf":[{"type":"integer","minimum":1,"maximum":500},{"type":"string","minLength":1,"maxLength":200}]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"part":{"type":"number"},"parts":{"type":"array","items":{"type":"string"}},"stages":{"type":"number"},"mines":{"type":"number"},"minion":{"type":"number"},"minions":{"type":"array","items":{"type":"string"}},"minionSkill":{"type":"number"},"minionSkills":{"type":"array","items":{"type":"string"}}},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-spectres`

Add or remove spectres in the build's spectre library (Manage Spectres...), by spectre name or id; spectres are then choices of a Raise Spectre skill's `minion`.

- Name: `skills.set_spectres` (MCP `pob_skills` action `set_spectres`)
- Read-only: no; worker: `skills.set_spectres`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"add":{"maxItems":50,"type":"array","items":{"type":"string","minLength":1,"maxLength":200}},"remove":{"maxItems":50,"type":"array","items":{"type":"string","minLength":1,"maxLength":200}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"spectres":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"}},"required":["id","name"],"additionalProperties":{}}}},"required":["spectres"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-new`

Add a skill set.

- Name: `skills.set_new` (MCP `pob_skills` action `set_new`)
- Read-only: no; worker: `skills.set_new`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-copy`

Copy a skill set.

- Name: `skills.set_copy` (MCP `pob_skills` action `set_copy`)
- Read-only: no; worker: `skills.set_copy`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Skill set number in the set list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-rename`

Rename a skill set.

- Name: `skills.set_rename` (MCP `pob_skills` action `set_rename`)
- Read-only: no; worker: `skills.set_rename`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Skill set number in the set list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","title","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-delete`

Delete a skill set (not the last one).

- Name: `skills.set_delete` (MCP `pob_skills` action `set_delete`)
- Read-only: no; worker: `skills.set_delete`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Skill set number in the set list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/skills/:id/set-activate`

Make a skill set the active one.

- Name: `skills.set_activate` (MCP `pob_skills` action `set_activate`)
- Read-only: no; worker: `skills.set_activate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Skill set number in the set list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/items/:id/list`

The Items tab: every item in the list, every slot with the item in it (and flask active state), item sets, the active weapon set.

- Name: `items.list` (MCP `pob_items` action `list`)
- Read-only: yes; worker: `items.list`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"items":{"type":"array","items":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"}},"required":["id","name","baseName","rarity","equipped","corrupted"],"additionalProperties":{}}},"slots":{"type":"array","items":{"type":"object","properties":{"slot":{"type":"string"},"item":{"type":"number"},"active":{"type":"boolean"}},"required":["slot"],"additionalProperties":{}}},"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}},"weaponSet":{"type":"number"}},"required":["items","slots","sets","weaponSet"],"additionalProperties":{}}`

### `GET /v1/items/:id/get`

One item: its text, mods in force for its selected variant, roll ranges, anoints, variants and the slots it fits.

- Name: `items.get` (MCP `pob_items` action `get`)
- Read-only: yes; worker: `items.get`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["item","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}}`

### `POST /v1/items/:id/add`

Add an item from its text (copied in game or from Path of Building), as Ctrl+V on the item list does. Text Path of Building cannot read fails.

- Name: `items.add` (MCP `pob_items` action `add`)
- Read-only: no; worker: `items.add`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"text":{"type":"string","minLength":1,"maxLength":20000},"equip":{"description":"Where a new item goes: `auto` (default; its own slot, if empty), `none`, or a slot name","type":"string","minLength":1,"maxLength":60},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["text","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"}},"required":["id","name","baseName","rarity","equipped","corrupted"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/add-unique`

Add a unique from the unique database by name (a `lookup uniques` name or title), optionally with a variant.

- Name: `items.add_unique` (MCP `pob_items` action `add_unique`)
- Read-only: no; worker: `items.add_unique`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":200},"variant":{"description":"Variant number, from 1, for uniques that have variants","type":"integer","minimum":1,"maximum":100},"equip":{"description":"Where a new item goes: `auto` (default; its own slot, if empty), `none`, or a slot name","type":"string","minLength":1,"maxLength":60},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["name","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"}},"required":["id","name","baseName","rarity","equipped","corrupted"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/add-rare`

Add a rare from the rare template database by name (e.g. `Armour Helmet`).

- Name: `items.add_rare` (MCP `pob_items` action `add_rare`)
- Read-only: no; worker: `items.add_rare`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"name":{"type":"string","minLength":1,"maxLength":200},"equip":{"description":"Where a new item goes: `auto` (default; its own slot, if empty), `none`, or a slot name","type":"string","minLength":1,"maxLength":60},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["name","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"}},"required":["id","name","baseName","rarity","equipped","corrupted"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/modify`

Change an item as its editor does: variant, quality, sockets and links, mod roll ranges, catalyst. Saved over the item.

- Name: `items.modify` (MCP `pob_items` action `modify`)
- Read-only: no; worker: `items.modify`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"variant":{"type":"integer","minimum":1,"maximum":100},"altVariant":{"description":"Second variant, for items that have one","type":"integer","minimum":1,"maximum":100},"quality":{"type":"integer","minimum":0,"maximum":99},"sockets":{"description":"Socket colours R G B W A with - for links and a space between groups, e.g. `R-G-B B`; only adds sockets","type":"string","minLength":1,"maxLength":40},"ranges":{"maxItems":20,"type":"array","items":{"type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":100,"description":"Position in the item's `ranges`, from 1"},"value":{"type":"number","minimum":0,"maximum":1}},"required":["index","value"]}},"catalyst":{"description":"Crafted rings, amulets and belts: 0 none, 1 Abrasive, 2 Accelerating, 3 Dextral, 4 Fertile, 5 Imbued, 6 Intrinsic, 7 Noxious, 8 Prismatic, 9 Sinistral, 10 Tempering, 11 Turbulent, 12 Unstable","type":"integer","minimum":0,"maximum":12},"catalystQuality":{"type":"integer","minimum":0,"maximum":99},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/edit`

Replace an item's text (the Edit... button); the item keeps its id and slot. Text Path of Building cannot read fails.

- Name: `items.edit` (MCP `pob_items` action `edit`)
- Read-only: no; worker: `items.edit`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"text":{"type":"string","minLength":1,"maxLength":20000},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","text","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/anoint`

Anoint an amulet (or another anointable item) with notables, one per anoint slot, in order; an empty list removes the anoints.

- Name: `items.anoint` (MCP `pob_items` action `anoint`)
- Read-only: no; worker: `items.anoint`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"notables":{"maxItems":4,"type":"array","items":{"type":"string","minLength":1,"maxLength":200}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","notables","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/enchant`

Enchant an item from the Enchant popup (helmet, gloves, boots, weapon and similar). The enchantment is matched by its text, exactly or by one unique part of it.

- Name: `items.enchant` (MCP `pob_items` action `enchant`)
- Read-only: no; worker: `items.enchant`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"enchantment":{"type":"string","minLength":1,"maxLength":300},"source":{"description":"Where it comes from, e.g. Eternal Labyrinth (the default is the first listed)","type":"string","minLength":1,"maxLength":100},"skill":{"description":"For skill enchantments (helmets), the skill","type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","enchantment","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/copy-from`

Copy the item another build has in a slot into this build's items, as the Compare tab's copy does; `use` equips it in the same slot.

- Name: `items.copy_from` (MCP `pob_items` action `copy_from`)
- Read-only: no; worker: `items.copy_from, with the other build in the Compare tab`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"slot":{"type":"string","minLength":1,"maxLength":60,"description":"Slot in the other build, e.g. Body Armour, Ring 1"},"use":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991},"other":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"The other build, loaded as the Compare tab's compared build"},"otherSets":{"description":"The other build's tree, skill, item and config sets to compare (1-based, in list order), as the Compare tab's set dropdowns pick them; default the active ones","type":"object","properties":{"tree":{"type":"integer","minimum":1,"maximum":500},"skills":{"type":"integer","minimum":1,"maximum":500},"items":{"type":"integer","minimum":1,"maximum":500},"config":{"type":"integer","minimum":1,"maximum":500}}}},"required":["slot","id","other"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/craft`

Craft a new item from a base (the Craft item... popup), pick crafting bench mods in its affix boxes, and add it. A mod is matched by the text of its affix box entry, e.g. `+# to maximum Life`.

- Name: `items.craft` (MCP `pob_items` action `craft`)
- Read-only: no; worker: `items.craft`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"base":{"type":"string","minLength":1,"maxLength":200,"description":"Base type name, e.g. Astral Plate"},"rarity":{"description":"Default RARE","type":"string","enum":["NORMAL","MAGIC","RARE"]},"title":{"type":"string","minLength":1,"maxLength":100},"affixes":{"maxItems":6,"type":"array","items":{"type":"object","properties":{"slot":{"type":"integer","minimum":1,"maximum":6,"description":"Affix box, from 1 (prefixes first)"},"mod":{"type":"string","minLength":1,"maxLength":300},"roll":{"description":"0 to 1 across the mod's tiers and range; default 1","type":"number","minimum":0,"maximum":1}},"required":["slot","mod"]}},"equip":{"description":"Where a new item goes: `auto` (default; its own slot, if empty), `none`, or a slot name","type":"string","minLength":1,"maxLength":60},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["base","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/affix-options`

The choices in each affix box of a base crafted on the Items tab (Craft item...), without adding it: per box its type and the choices in the box's order, each with its tiers (mod id, text, level). `affixes` fill boxes first, so their mod groups drop out of the others as in the application; `slots` picks the empty boxes to list (default all empty ones). With `sort` (a Modifier sorting entry, e.g. Full DPS, Life, Effective Hit Pool) the choices are best first for this build, the mid tier of each measured in the item's slot, and `value` is that stat with it. Nothing is added to the build.

- Name: `items.affix_options` (MCP `pob_items` action `affix_options`)
- Read-only: yes; worker: `items.affix_options`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"base":{"type":"string","minLength":1,"maxLength":200,"description":"Base type name, e.g. Astral Plate"},"rarity":{"description":"Default RARE","type":"string","enum":["MAGIC","RARE"]},"affixes":{"maxItems":6,"type":"array","items":{"type":"object","properties":{"slot":{"type":"integer","minimum":1,"maximum":6,"description":"Affix box, from 1 (prefixes first)"},"mod":{"type":"string","minLength":1,"maxLength":300},"roll":{"type":"number","minimum":0,"maximum":1}},"required":["slot","mod"]}},"slots":{"description":"Empty affix boxes to list","minItems":1,"maxItems":6,"type":"array","items":{"type":"integer","minimum":1,"maximum":6}},"sort":{"description":"Modifier sorting entry by its label, e.g. Full DPS","type":"string","minLength":1,"maxLength":60},"limit":{"description":"Choices per box","type":"integer","minimum":1,"maximum":500},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["base","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"base":{"type":"string"},"rarity":{"type":"string"},"sort":{"type":"string"},"boxes":{"type":"array","items":{"type":"object","properties":{"slot":{"type":"number"},"type":{"type":"string"},"choices":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string"},"value":{"type":["number","null"]},"tiers":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"text":{"type":"string"},"level":{"type":"number"}},"required":["id","text","level"],"additionalProperties":{}}}},"required":["text","value","tiers"],"additionalProperties":{}}}},"required":["slot","type","choices"],"additionalProperties":{}}}},"required":["base","rarity","sort","boxes"],"additionalProperties":{}}`

### `POST /v1/items/:id/influence`

Set an item's influences from its Influence dropdowns (Shaper, Elder, Warlord, Hunter, Crusader, Redeemer; helmets, gloves, boots and body armour also Searing Exarch and Eater of Worlds). An empty list removes them. Items without Influence dropdowns (flasks, jewels) and unknown names fail.

- Name: `items.influence` (MCP `pob_items` action `influence`)
- Read-only: no; worker: `items.influence`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"influences":{"maxItems":2,"type":"array","items":{"type":"string","minLength":1,"maxLength":50},"description":"Up to two influence names, as the dropdowns list them"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","influences","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/corrupt`

Corrupt an item with the Corrupt... popup (Corrupted source), choosing up to two implicits from its lists; an empty list corrupts with no new implicit. An implicit is matched by its text, exactly or by one unique part. Items that cannot be corrupted and implicits the lists do not offer fail.

- Name: `items.corrupt` (MCP `pob_items` action `corrupt`)
- Read-only: no; worker: `items.corrupt`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"implicits":{"maxItems":2,"type":"array","items":{"type":"string","minLength":1,"maxLength":300},"description":"Text of each implicit, one per Implicit box"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","implicits","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/add-implicit`

Add an implicit with the Add Implicit... popup. Sources: Custom (give `text`), and where the item allows them Vestigial, Searing Exarch and Eater of Worlds (give `mod`: the text of a choice, exactly or by one unique part). Items that take no added implicit and unknown or ambiguous choices fail.

- Name: `items.add_implicit` (MCP `pob_items` action `add_implicit`)
- Read-only: no; worker: `items.add_implicit`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"source":{"description":"Source in the popup; Custom when `text` is given, else the first listed","type":"string","minLength":1,"maxLength":50},"mod":{"description":"Text of the choice, for the listed sources","type":"string","minLength":1,"maxLength":300},"text":{"description":"The implicit line, for the Custom source","type":"string","minLength":1,"maxLength":300},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/custom-mod`

Add a modifier to a magic or rare item with the Add modifier... popup: pick a source (Crafting Bench, Essence, Veiled, Beastcraft, Necropolis, Fossil, drop-restricted, Prefix, Suffix; only those the item has) and the choice by text, or Custom with `text`. Unknown sources and choices fail.

- Name: `items.custom_mod` (MCP `pob_items` action `custom_mod`)
- Read-only: no; worker: `items.custom_mod`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"source":{"type":"string","minLength":1,"maxLength":50,"description":"Source in the popup, e.g. Crafting Bench or Custom"},"mod":{"description":"Text of the choice, exact or one unique part","type":"string","minLength":1,"maxLength":300},"text":{"description":"The modifier line, for the Custom source","type":"string","minLength":1,"maxLength":300},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","source","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/crucible-mod`

Set the crucible modifiers of a weapon or shield with the Add Crucible mod... popup: each entry names a node box and the text of its choice (None empties the box); boxes not named keep their choice. Items without a crucible tree and unknown choices fail.

- Name: `items.crucible_mod` (MCP `pob_items` action `crucible_mod`)
- Read-only: no; worker: `items.crucible_mod`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"mods":{"minItems":1,"maxItems":5,"type":"array","items":{"type":"object","properties":{"node":{"type":"integer","minimum":1,"maximum":5,"description":"Node box, 1 to 5"},"mod":{"type":"string","minLength":1,"maxLength":300,"description":"Text of the choice, or None"}},"required":["node","mod"]}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","mods","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/cluster-jewel`

Change a crafted cluster jewel with its own controls: the skill, the added passive count (within the jewel's range) and notables, one per affix box in order (as `craft` picks affixes). Only jewels made with `craft` from a cluster jewel base have them.

- Name: `items.cluster_jewel` (MCP `pob_items` action `cluster_jewel`)
- Read-only: no; worker: `items.cluster_jewel`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"skill":{"description":"Jewel skill, e.g. Fire Damage","type":"string","minLength":1,"maxLength":100},"nodes":{"description":"Added passive skills","type":"integer","minimum":1,"maximum":12},"notables":{"description":"Text of the notable in affix box 1, 2, ...","maxItems":4,"type":"array","items":{"type":"string","minLength":1,"maxLength":300}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"baseName":{"type":"string"},"rarity":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"quality":{"type":"number"},"sockets":{"type":"string"},"equipped":{"type":"array","items":{"type":"string"}},"corrupted":{"type":"boolean"},"raw":{"type":"string"},"enchants":{"type":"array","items":{"type":"string"}},"implicits":{"type":"array","items":{"type":"string"}},"explicits":{"type":"array","items":{"type":"string"}},"anoints":{"type":"array","items":{"type":"string"}},"variant":{"type":"number"},"altVariant":{"type":"number"},"variants":{"type":"array","items":{"type":"string"}},"ranges":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"line":{"type":"string"},"range":{"type":"number"}},"required":["index","line","range"],"additionalProperties":{}}},"validSlots":{"type":"array","items":{"type":"string"}}},"required":["id","name","baseName","rarity","equipped","corrupted","raw","enchants","implicits","explicits","anoints","ranges","validSlots"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/equip`

Put an item in a slot, as the slot's dropdown does. An item the slot does not take fails.

- Name: `items.equip` (MCP `pob_items` action `equip`)
- Read-only: no; worker: `items.equip`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"slot":{"type":"string","minLength":1,"maxLength":60,"description":"Item slot as Path of Building names it: Weapon 1, Weapon 2, Weapon 1 Swap, Weapon 2 Swap, Helmet, Body Armour, Gloves, Boots, Amulet, Ring 1, Ring 2, Belt, Flask 1 to Flask 5, or Jewel <node id> for a passive tree socket"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","slot","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"slot":{"type":"string"},"item":{"type":"number"}},"required":["slot","item"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/unequip`

Empty a slot (the item stays in the list).

- Name: `items.unequip` (MCP `pob_items` action `unequip`)
- Read-only: no; worker: `items.unequip`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"slot":{"type":"string","minLength":1,"maxLength":60,"description":"Item slot as Path of Building names it: Weapon 1, Weapon 2, Weapon 1 Swap, Weapon 2 Swap, Helmet, Body Armour, Gloves, Boots, Amulet, Ring 1, Ring 2, Belt, Flask 1 to Flask 5, or Jewel <node id> for a passive tree socket"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["slot","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"slot":{"type":"string"}},"required":["slot"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/set-active`

Switch a flask's or tincture's Active box on or off.

- Name: `items.set_active` (MCP `pob_items` action `set_active`)
- Read-only: no; worker: `items.set_active`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"slot":{"type":"string","minLength":1,"maxLength":60,"description":"Item slot as Path of Building names it: Weapon 1, Weapon 2, Weapon 1 Swap, Weapon 2 Swap, Helmet, Body Armour, Gloves, Boots, Amulet, Ring 1, Ring 2, Belt, Flask 1 to Flask 5, or Jewel <node id> for a passive tree socket"},"active":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["slot","active","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"slot":{"type":"string"},"active":{"type":"boolean"}},"required":["slot","active"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/delete`

Delete an item from the list (it leaves every slot that held it).

- Name: `items.delete` (MCP `pob_items` action `delete`)
- Read-only: no; worker: `items.delete`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"type":"integer","minimum":1,"maximum":1000000,"description":"Item id from `items list`"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["item","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"deleted":{"type":"number"}},"required":["deleted"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/weapon-set`

Switch between weapon set 1 and the swap set (the weapon swap buttons).

- Name: `items.weapon_set` (MCP `pob_items` action `weapon_set`)
- Read-only: no; worker: `items.weapon_set`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"set":{"type":"integer","minimum":1,"maximum":2},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["set","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"weaponSet":{"type":"number"}},"required":["weaponSet"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/set-new`

Add an item set (an empty set of slots).

- Name: `items.set_new` (MCP `pob_items` action `set_new`)
- Read-only: no; worker: `items.set_new`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/set-copy`

Copy an item set.

- Name: `items.set_copy` (MCP `pob_items` action `set_copy`)
- Read-only: no; worker: `items.set_copy`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Item set number in the set list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/set-rename`

Rename an item set.

- Name: `items.set_rename` (MCP `pob_items` action `set_rename`)
- Read-only: no; worker: `items.set_rename`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Item set number in the set list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","title","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/set-delete`

Delete an item set (not the last one); its items stay in the list.

- Name: `items.set_delete` (MCP `pob_items` action `set_delete`)
- Read-only: no; worker: `items.set_delete`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Item set number in the set list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/items/:id/set-activate`

Make an item set the active one.

- Name: `items.set_activate` (MCP `pob_items` action `set_activate`)
- Read-only: no; worker: `items.set_activate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Item set number in the set list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

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
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"values":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"anyOf":[{"type":"boolean"},{"type":"number"},{"type":"string","maxLength":20000}]}}},"required":["values"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-new`

Add a config set.

- Name: `config.set_new` (MCP `pob_config` action `set_new`)
- Read-only: no; worker: `config.set_new`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-copy`

Copy a config set.

- Name: `config.set_copy` (MCP `pob_config` action `set_copy`)
- Read-only: no; worker: `config.set_copy`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Config set number in the set list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-rename`

Rename a config set.

- Name: `config.set_rename` (MCP `pob_config` action `set_rename`)
- Read-only: no; worker: `config.set_rename`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Config set number in the set list, from 1"},"title":{"type":"string","minLength":1,"maxLength":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","title","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-delete`

Delete a config set (not the last one).

- Name: `config.set_delete` (MCP `pob_config` action `set_delete`)
- Read-only: no; worker: `config.set_delete`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Config set number in the set list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/set-activate`

Make a config set the active one.

- Name: `config.set_activate` (MCP `pob_config` action `set_activate`)
- Read-only: no; worker: `config.set_activate`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"index":{"type":"integer","minimum":1,"maximum":500,"description":"Config set number in the set list, from 1"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["index","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"sets":{"type":"array","items":{"type":"object","properties":{"index":{"type":"number"},"title":{"type":"string"},"active":{"type":"boolean"}},"required":["index","title","active"],"additionalProperties":{}}}},"required":["sets"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/config/:id/custom-mods`

The custom modifier groups of the active config set (Configuration tab, Custom Modifiers): title, enabled, text, and each line with `supported` (Path of Building parses it whole; other lines are ignored by the calculation, as the box shows them in red).

- Name: `config.custom_mods` (MCP `pob_config` action `custom_mods`)
- Read-only: yes; worker: `config.custom_mods`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"configSet":{"type":"number"},"groups":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"enabled":{"type":"boolean"},"text":{"type":"string"},"lines":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string"},"supported":{"type":"boolean"}},"required":["text","supported"]}}},"required":["title","enabled","text","lines"]}}},"required":["configSet","groups"]}`

### `POST /v1/config/:id/set-custom-mods`

Replace the custom modifier groups of the active config set, as editing the boxes does: each group's lines add to the build's calculation while it is enabled. Answers the groups with each line's `supported`.

- Name: `config.set_custom_mods` (MCP `pob_config` action `set_custom_mods`)
- Read-only: no; worker: `config.set_custom_mods`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"groups":{"minItems":1,"maxItems":20,"type":"array","items":{"type":"object","properties":{"title":{"type":"string","minLength":1,"maxLength":100},"enabled":{"description":"Default true","type":"boolean"},"text":{"type":"string","maxLength":20000,"description":"One modifier per line, as the item text writes it"}},"required":["text"]}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["groups","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"configSet":{"type":"number"},"groups":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"enabled":{"type":"boolean"},"text":{"type":"string"},"lines":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string"},"supported":{"type":"boolean"}},"required":["text","supported"]}}},"required":["title","enabled","text","lines"]}}},"required":["configSet","groups"]},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/config/:id/copy-from`

Copy another build's Configuration tab inputs onto this build, as the Compare tab's Copy config does (inputs only this build has stay).

- Name: `config.copy_from` (MCP `pob_config` action `copy_from`)
- Read-only: no; worker: `config.copy_from, with the other build in the Compare tab`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991},"other":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"The other build, loaded as the Compare tab's compared build"},"otherSets":{"description":"The other build's tree, skill, item and config sets to compare (1-based, in list order), as the Compare tab's set dropdowns pick them; default the active ones","type":"object","properties":{"tree":{"type":"integer","minimum":1,"maximum":500},"skills":{"type":"integer","minimum":1,"maximum":500},"items":{"type":"integer","minimum":1,"maximum":500},"config":{"type":"integer","minimum":1,"maximum":500}}}},"required":["id","other"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{"copied":{"type":"number"}},"required":["copied"],"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/config/:id/party-export`

What the build would export for party play with the Import tab's Export Support box on, as the Party tab shows it (own modifiers, auras, curses, warcries, links, enemy conditions and modifiers); `enabled` is the box's current state. The build does not change.

- Name: `config.party_export` (MCP `pob_config` action `party_export`)
- Read-only: yes; worker: `config.party_export`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"enabled":{"type":"boolean"},"exports":{"type":"object","properties":{"PlayerMods":{"type":"string"},"Aura":{"type":"string"},"Curse":{"type":"string"},"Warcry":{"type":"string"},"Link":{"type":"string"},"EnemyConditions":{"type":"string"},"EnemyMods":{"type":"string"}},"required":["PlayerMods","Aura","Curse","Warcry","Link","EnemyConditions","EnemyMods"],"additionalProperties":{}}},"required":["enabled","exports"],"additionalProperties":{}}`

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
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `GET /v1/party/:id/get`

The Party tab inputs: the import destination and toggles, the text boxes (auras, curses, warcries, links, party member stats, enemy conditions, enemy modifiers) and what Path of Building parsed from them.

- Name: `config.party_get` (MCP `pob_config` action `party_get`)
- Read-only: yes; worker: `party.get`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"destination":{"type":"string"},"append":{"type":"boolean"},"showAdvanced":{"type":"boolean"},"exportSupport":{"type":"boolean"},"auras":{"type":"string"},"curses":{"type":"string"},"warcries":{"type":"string"},"links":{"type":"string"},"partyMemberStats":{"type":"string"},"enemyConditions":{"type":"string"},"enemyMods":{"type":"string"},"summary":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"string"}}},"required":["destination","append","showAdvanced","exportSupport","auras","curses","warcries","links","partyMemberStats","enemyConditions","enemyMods","summary"],"additionalProperties":{}}`

### `POST /v1/party/:id/import`

Import a party member's build code (exported with Export support on) into a destination, as the Party tab's Import button does; Append keeps what is there. Links are not fetched.

- Name: `config.party_import` (MCP `pob_config` action `party_import`)
- Read-only: no; worker: `party.import`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"code":{"type":"string","minLength":1,"maxLength":2000000},"destination":{"type":"string","enum":["All","Party Member Stats","Aura","Curse","Warcry Skills","Link Skills","EnemyConditions","EnemyMods"],"description":"Which party inputs it applies to"},"append":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["code","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/party/:id/clear`

Clear imported party data for a destination (default the tab's current one), as the Clear button does.

- Name: `config.party_clear` (MCP `pob_config` action `party_clear`)
- Read-only: no; worker: `party.clear`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"destination":{"type":"string","enum":["All","Party Member Stats","Aura","Curse","Warcry Skills","Link Skills","EnemyConditions","EnemyMods"],"description":"Which party inputs it applies to"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/party/:id/set`

Set party text boxes and toggles; text is parsed (Rebuild All), as when typed in the advanced boxes.

- Name: `config.party_set` (MCP `pob_config` action `party_set`)
- Read-only: no; worker: `party.set`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"auras":{"type":"string","maxLength":200000},"curses":{"type":"string","maxLength":200000},"warcries":{"type":"string","maxLength":200000},"links":{"type":"string","maxLength":200000},"partyMemberStats":{"type":"string","maxLength":200000},"enemyConditions":{"type":"string","maxLength":200000},"enemyMods":{"type":"string","maxLength":200000},"showAdvanced":{"type":"boolean"},"append":{"type":"boolean"},"destination":{"type":"string","enum":["All","Party Member Stats","Aura","Curse","Warcry Skills","Link Skills","EnemyConditions","EnemyMods"],"description":"Which party inputs it applies to"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/party/:id/effects`

Turn party effects off (Disable Party Effects; the data stays) or back on (Rebuild All parses the boxes again).

- Name: `config.party_effects` (MCP `pob_config` action `party_effects`)
- Read-only: no; worker: `party.set_effects`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"enabled":{"type":"boolean"},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"baseRevision":{"description":"Refuse the change unless the build is at this revision","type":"integer","minimum":1,"maximum":9007199254740991}},"required":["enabled","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"object","properties":{},"additionalProperties":{}},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","null"]},"after":{"type":["number","null"]}},"required":["before","after"]},"description":"Sidebar stats that changed"},"revision":{"type":"number"}},"required":["result","changed","revision"]}`

### `POST /v1/evaluate/:id/what-if`

What the build would be with changes, without making them: nodes added or removed, an item in a slot, a flask or tincture toggled, conditions on. Answers only the stats that differ.

- Name: `evaluate.what_if` (MCP `pob_evaluate` action `what_if`)
- Read-only: yes; worker: `evaluate.what_if`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"addNodes":{"minItems":1,"maxItems":200,"type":"array","items":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"}},"removeNodes":{"minItems":1,"maxItems":200,"type":"array","items":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"}},"slot":{"type":"string","minLength":1,"maxLength":60,"description":"Item slot as Path of Building names it: Weapon 1, Weapon 2, Weapon 1 Swap, Weapon 2 Swap, Helmet, Body Armour, Gloves, Boots, Amulet, Ring 1, Ring 2, Belt, Flask 1 to Flask 5, or Jewel <node id> for a passive tree socket"},"item":{"description":"Item id from `items list` (or give `text`)","type":"integer","minimum":1,"maximum":1000000},"text":{"description":"Item text as copied in game or from Path of Building (instead of `item`)","type":"string","minLength":1,"maxLength":20000},"toggleFlask":{"description":"Flask slot whose active state flips","type":"string","minLength":1,"maxLength":60},"toggleTincture":{"description":"Tincture slot whose active state flips","type":"string","minLength":1,"maxLength":60},"conditions":{"description":"Condition names switched on, as the calculator knows them","maxItems":50,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}},"fields":{"description":"Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats","maxItems":100,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","boolean","string","null"]},"after":{"type":["number","boolean","string","null"]}},"required":["before","after"]},"description":"Only the stats that differ; null = not shown / absent"}},"required":["changed"]}`

### `POST /v1/evaluate/:id/passives`

Score candidate passives one at a time without allocating them: each with the path that reaches it, through the calculator. Answers the stats that differ per candidate. Default candidates: every unallocated passive next to the allocated tree (ascendancy nodes and masteries left out).

- Name: `evaluate.passives` (MCP `pob_evaluate` action `passives`)
- Read-only: yes; worker: `evaluate.passives`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"candidates":{"description":"Node ids or exact names; each is scored with its path from the allocated tree","minItems":1,"maxItems":200,"type":"array","items":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":200}],"description":"Node id, or its exact name"}},"fields":{"description":"Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats","maxItems":100,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}},"sortBy":{"description":"Output key; candidates sorted by its gain, largest first (otherwise by node id)","type":"string","minLength":1,"maxLength":100},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"total":{"type":"number"},"offset":{"type":"number"},"sortBy":{"type":"string"},"candidates":{"type":"array","items":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"type":{"type":"string"},"points":{"type":"number","description":"Points the candidate and its path cost"},"gain":{"type":"number"},"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","boolean","string","null"]},"after":{"type":["number","boolean","string","null"]}},"required":["before","after"]},"description":"Only the stats that differ; null = not shown / absent"}},"required":["id","name","type","points","changed"],"additionalProperties":{}}}},"required":["total","offset","candidates"],"additionalProperties":{}}`

### `POST /v1/evaluate/:id/node-power`

Passive node power for a stat, from the tree's heat map calculation: unallocated nodes show what allocating gains, allocated nodes what removing changes. Masteries are listed once per effect; cluster notables and ascendancy nodes are left out. Sorted by power, highest first.

- Name: `evaluate.node_power` (MCP `pob_evaluate` action `node_power`)
- Read-only: yes; worker: `evaluate.node_power`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stat":{"type":"string","minLength":1,"maxLength":60,"description":"A stat of Path of Building's power stat list, e.g. CombinedDPS, FullDPS, TotalDPS, Life, TotalEHP, Armour, MinionLife (`OffenceDefence` where noted)"},"depth":{"description":"Largest path distance (default 10; a whole tree can outlast the worker timeout)","type":"integer","minimum":1,"maximum":100},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["stat","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stat":{"type":"string"},"total":{"type":"number"},"offset":{"type":"number"},"nodes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"number"},"name":{"type":"string"},"type":{"type":"string"},"allocated":{"type":"boolean"},"pathDist":{"type":"number"},"power":{"type":"number"},"pathPower":{"type":"number"},"defence":{"type":"number"}},"required":["id","name","type","allocated","pathDist","power"],"additionalProperties":{}}}},"required":["stat","total","offset","nodes"],"additionalProperties":{}}`

### `POST /v1/evaluate/:id/compare-item`

What an item would change in each slot it fits (default all equipment slots in use), as the Items tab's comparison shows. A jewel is compared in the socket named by `slot` (Jewel <node id>, or an item's abyssal socket), against the jewel in it now: paste a listing's text to rank it against the current jewel. Radius jewels count what is in their radius. Cluster jewels and jewels that change the tree (timeless, Thread of Hope, Impossible Escape) are equipped for real for the measurement, a cluster with all its passives allocated (`points` is the passive points that costs beyond the current tree), and the build is then loaded back as it was.

- Name: `evaluate.compare_item` (MCP `pob_evaluate` action `compare_item`)
- Read-only: yes; worker: `evaluate.compare_item`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"description":"Item id from `items list` (or give `text`)","type":"integer","minimum":1,"maximum":1000000},"text":{"description":"Item text as copied in game or from Path of Building (instead of `item`)","type":"string","minLength":1,"maxLength":20000},"slot":{"type":"string","minLength":1,"maxLength":60,"description":"Item slot as Path of Building names it: Weapon 1, Weapon 2, Weapon 1 Swap, Weapon 2 Swap, Helmet, Body Armour, Gloves, Boots, Amulet, Ring 1, Ring 2, Belt, Flask 1 to Flask 5, or Jewel <node id> for a passive tree socket"},"fields":{"description":"Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats","maxItems":100,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"slots":{"type":"array","items":{"type":"object","properties":{"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","boolean","string","null"]},"after":{"type":["number","boolean","string","null"]}},"required":["before","after"]},"description":"Only the stats that differ; null = not shown / absent"},"slot":{"type":"string"},"equipped":{"type":["string","null"]},"points":{"description":"Passive points spent beyond the current tree (equipped-for-real comparisons)","type":"number"}},"required":["changed","slot","equipped"]}}},"required":["slots"],"additionalProperties":{}}`

### `POST /v1/evaluate/:id/jewel-mods`

Rank the mods a jewel can have for this build, the way Path of Building's trade search weighs them (TradeQueryGenerator): each mod alone on a blank jewel in the socket, weighed by the stat weights (default Full DPS 1, Effective Hit Pool 0.5); `gain` is that weighted change x1000 against the socket empty and `weight` is gain per point of the mod's value, which is what the search sums. Each mod is tested at min + (max - min) x quality over its range across all tiers (Path of Building's Item Affix Quality, default 0.5). Where Path of Building's mod data has more than one entry for a trade stat, the one a base of the family rolls is used (then the widest range), so the answer is the same on every run; mods no base of the family rolls are listed with `rollable: false` and kept out of sets. Families: base and abyss (explicit mods, plus corrupted implicits unless includeCorrupted is false), watchers_eye, and cluster (the notables a cluster of that size and enchant can roll, each added to the tree alone, as the generator weighs Megalomaniac's). Unique jewels: unique_rank with a Jewel slot. `combinations` are the best legal sets (at most two prefixes and two suffixes, distinct mod groups, a base that rolls them all; clusters: up to 1, 2 or 3 notables for small, medium and large), each measured together on one test jewel (`estimate` is the sum of the parts). `query` is the trade search Path of Building builds (weighted sum group with its minimum, league status, mirrored and price filters; for clusters its base, the enchant and item level), `search` the body the trade API takes. `link` (with `league`) is Path of Building's own link form, https://www.pathofexile.com/trade/search/<league>/<gzip+base64url query>: it is made with no request, and it is unverified until someone opens one by hand. Calculation only; nothing is sent anywhere (`trade.search` runs `search` on request).

- Name: `evaluate.jewel_mods` (MCP `pob_evaluate` action `jewel_mods`)
- Read-only: yes; worker: `evaluate.jewel_mods`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"family":{"type":"string","enum":["base","abyss","watchers_eye","cluster"],"description":"Jewel family"},"socket":{"description":"Tree socket node id or slot name (Jewel <node id>, or an item's abyssal socket slot); default the first allocated empty tree socket the jewel fits. Not used for cluster","anyOf":[{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":60}]},"size":{"description":"Cluster size (cluster only)","type":"string","enum":["Small","Medium","Large"]},"enchant":{"description":"Cluster enchant by its name in the Items tab, e.g. Fire Damage, Life (cluster only)","type":"string","minLength":1,"maxLength":100},"weights":{"description":"Stat weights as the trade popup's list sets them (0.01 to 1 each; default Full DPS 1, Effective Hit Pool 0.5)","minItems":1,"maxItems":20,"type":"array","items":{"type":"object","properties":{"stat":{"type":"string","minLength":1,"maxLength":60,"description":"A stat of Path of Building's power stat list, e.g. CombinedDPS, FullDPS, TotalDPS, Life, TotalEHP, Armour, MinionLife (`OffenceDefence` where noted)"},"weight":{"type":"number","minimum":0.01,"maximum":1}},"required":["stat","weight"]}},"quality":{"description":"Where in each mod's range it is tested (default the Item Affix Quality, 0.5)","type":"number","minimum":0,"maximum":1},"includeCorrupted":{"description":"Weigh corrupted implicits too (default true, as the popup)","type":"boolean"},"includeMirrored":{"description":"Allow mirrored items in the search (default true, as the popup)","type":"boolean"},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"combinations":{"description":"How many mod sets (default 5)","type":"integer","minimum":0,"maximum":20},"league":{"description":"Trade league for the link (the league being played)","type":"string","maxLength":64,"pattern":"^[A-Za-z0-9][A-Za-z0-9 '-]*$"},"realm":{"description":"Default pc","type":"string","enum":["pc","xbox","sony"]},"tradeType":{"description":"Listing status, the popup's list: securable = instant buyout (default), available = instant buyout and in person, onlineleague = in person (online in league), online = in person (online), any = includes offline","type":"string","enum":["securable","available","onlineleague","online","any"]},"maxPrice":{"description":"Price cap","type":"number","exclusiveMinimum":0,"maximum":1000000},"priceCurrency":{"description":"Currency of maxPrice (default chaos equivalent)","type":"string","enum":["chaos","divine","alch","alt","chrome","exalted","blessed","chisel","gcp","jewellers","scour","regret","fusing","chance","regal","vaal"]},"minItemLevel":{"description":"Cluster only: lowest item level (notables need their `level`)","type":"integer","minimum":1,"maximum":100},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["family","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"family":{"type":"string"},"socket":{"type":"string"},"size":{"type":"string"},"enchant":{"type":"string"},"category":{"type":"string"},"total":{"type":"number"},"mods":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"Trade stat id"},"text":{"type":["string","null"]},"weight":{"type":"number"},"gain":{"type":"number"},"affix":{"type":["string","null"]}},"required":["id","text","weight","gain"],"additionalProperties":{}}},"combinations":{"type":"array","items":{"type":"object","properties":{"mods":{"type":"array","items":{"type":"string"}},"gain":{"type":"number"},"estimate":{"type":"number"}},"required":["mods","gain","estimate"],"additionalProperties":{}}},"query":{"anyOf":[{"type":"object","properties":{"stats":{"type":"array","items":{}}},"required":["stats"],"additionalProperties":{}},{"type":"null"}]},"search":{"anyOf":[{"type":"object","properties":{"query":{},"sort":{}},"required":["query","sort"],"additionalProperties":{}},{"type":"null"}]},"link":{"type":["string","null"]},"queryError":{"type":["string","null"]}},"required":["family","category","total","mods","combinations","query","search","link","queryError"],"additionalProperties":{}}`

### `POST /v1/evaluate/:id/timeless`

Find timeless jewel seeds for this build with the Tree tab's Find Timeless Jewel dialog, driven through its controls (no trade request: its league list is given, not fetched). Search scores every seed of the jewel in the socket (or every socket) by the weights of the passives it would put on the tree: `nodes` names the passives wanted with their weights (as the dialog's search list), `fallback` has Generate weigh every other passive by a stat (e.g. Full DPS, Life, Effective Hit Pool); with `allocatedOnly`, only allocated nodes in the radius count. Results are best first (`total`, the weighted sum), each with its seed, socket and the passives it gives. `search` is the dialog's Open Trade URL search for the best seeds (one stat filter per seed and conqueror, count at least 1), to pass to `trade.search`; `link` is that search on the trade site (with `league`). The dialog's own settings in the build are put back, so nothing changes. Calculation only; nothing is sent anywhere.

- Name: `evaluate.timeless` (MCP `pob_evaluate` action `timeless`)
- Read-only: yes; worker: `evaluate.timeless`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"jewel":{"type":"string","minLength":1,"maxLength":40,"description":"Jewel type, by name or one unique part: Glorious Vanity, Lethal Pride, Brutal Restraint, Militant Faith, Elegant Hubris, Heroic Tragedy, or an abyss timeless jewel"},"conqueror":{"description":"Conqueror (keystone), by name or one unique part; default Any","type":"string","minLength":1,"maxLength":60},"socket":{"description":"Socket node id, or Jewel <id>; default every socket","anyOf":[{"type":"integer","exclusiveMinimum":0,"maximum":9007199254740991},{"type":"string","minLength":1,"maxLength":20}]},"nodes":{"maxItems":40,"type":"array","items":{"type":"object","properties":{"node":{"type":"string","minLength":1,"maxLength":100,"description":"Passive the jewel gives, by its id (e.g. karui_notable_add_strength) or name, as the dialog's node list"},"weight":{"description":"Weight of its first stat (default 1)","type":"number","minimum":0,"maximum":1000},"weight2":{"description":"Weight of its second stat (default 0)","type":"number","minimum":0,"maximum":1000},"minimum":{"description":"Lowest total weight from this passive a seed must reach (default 0)","type":"number","minimum":0,"maximum":100000}},"required":["node"]}},"fallback":{"description":"Stat to weigh every other passive by, as the Fallback Weight Mode list names it without 'Sort by ' (e.g. Full DPS)","type":"string","minLength":1,"maxLength":60},"minimumTotal":{"description":"Lowest total weight shown","type":"number","minimum":0,"maximum":1000000000},"allocatedOnly":{"description":"Count only allocated nodes in the radius (the dialog's socket filter)","type":"boolean"},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"league":{"description":"Trade league for the link (the league being played)","type":"string","maxLength":64,"pattern":"^[A-Za-z0-9][A-Za-z0-9 '-]*$"},"realm":{"description":"Default pc","type":"string","enum":["pc","xbox","sony"]},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["jewel","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"jewel":{"type":"string"},"conqueror":{"type":["string","null"]},"count":{"type":"number"},"results":{"type":"array","items":{"type":"object","properties":{"seed":{"type":"number"},"total":{"type":"number"},"socket":{"anyOf":[{"type":"object","properties":{"id":{"type":"number"},"label":{"type":"string"}},"required":["id","label"],"additionalProperties":{}},{"type":"null"}]},"nodes":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"targets":{"type":"array","items":{"type":"string"}}},"required":["id","name","targets"],"additionalProperties":{}}}},"required":["seed","total","socket","nodes"],"additionalProperties":{}}},"query":{"anyOf":[{"type":"object","properties":{"stats":{"type":"array","items":{}}},"required":["stats"],"additionalProperties":{}},{"type":"null"}]},"search":{"anyOf":[{"type":"object","properties":{"query":{},"sort":{}},"required":["query","sort"],"additionalProperties":{}},{"type":"null"}]},"link":{"type":["string","null"]}},"required":["jewel","conqueror","count","results","query","search","link"],"additionalProperties":{}}`

### `POST /v1/evaluate/:id/gem-rank`

Rank gems for a socket group with the gem box's own calculation: the stat with each candidate in that position, highest first (value is the stat itself, `base` is without the gem).

- Name: `evaluate.gem_rank` (MCP `pob_evaluate` action `gem_rank`)
- Read-only: yes; worker: `evaluate.gem_rank`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"group":{"type":"integer","minimum":1,"maximum":500,"description":"Socket group number in the group list, from 1"},"gem":{"description":"Position the candidate goes into (default one past the last gem)","type":"integer","minimum":1,"maximum":100},"stat":{"type":"string","minLength":1,"maxLength":60,"description":"FullDPS, CombinedDPS, TotalDPS, AverageDamage, TotalDot, BleedDPS, IgniteDPS, TotalPoisonDPS or TotalEHP"},"support":{"description":"Only support gems (default true); false adds active gems with global effects","type":"boolean"},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["group","stat","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stat":{"type":"string"},"base":{"type":"number"},"total":{"type":"number"},"gems":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"value":{"type":"number"}},"required":["name","value"],"additionalProperties":{}}}},"required":["stat","base","total","gems"],"additionalProperties":{}}`

### `POST /v1/evaluate/:id/anoint-rank`

Rank notables to anoint an item with, by the stat gained (the Anoint popup's sort). Name the item by id or by the slot it is in.

- Name: `evaluate.anoint_rank` (MCP `pob_evaluate` action `anoint_rank`)
- Read-only: yes; worker: `evaluate.anoint_rank`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"item":{"description":"Item id from `items list` (or give `text`)","type":"integer","minimum":1,"maximum":1000000},"slot":{"type":"string","minLength":1,"maxLength":60,"description":"Item slot as Path of Building names it: Weapon 1, Weapon 2, Weapon 1 Swap, Weapon 2 Swap, Helmet, Body Armour, Gloves, Boots, Amulet, Ring 1, Ring 2, Belt, Flask 1 to Flask 5, or Jewel <node id> for a passive tree socket"},"stat":{"type":"string","minLength":1,"maxLength":60,"description":"A stat of Path of Building's power stat list, e.g. CombinedDPS, FullDPS, TotalDPS, Life, TotalEHP, Armour, MinionLife (`OffenceDefence` where noted)"},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["stat","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stat":{"type":"string"},"total":{"type":"number"},"notables":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"power":{"type":"number"}},"required":["name","power"],"additionalProperties":{}}}},"required":["stat","total","notables"],"additionalProperties":{}}`

### `POST /v1/evaluate/:id/unique-rank`

Rank the uniques that fit a slot by the stat with the unique equipped (the unique list's sort by stat; power is the stat's value, best slot).

- Name: `evaluate.unique_rank` (MCP `pob_evaluate` action `unique_rank`)
- Read-only: yes; worker: `evaluate.unique_rank`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"slot":{"type":"string","minLength":1,"maxLength":60,"description":"Item slot as Path of Building names it: Weapon 1, Weapon 2, Weapon 1 Swap, Weapon 2 Swap, Helmet, Body Armour, Gloves, Boots, Amulet, Ring 1, Ring 2, Belt, Flask 1 to Flask 5, or Jewel <node id> for a passive tree socket"},"stat":{"type":"string","minLength":1,"maxLength":60,"description":"A stat of Path of Building's power stat list, e.g. CombinedDPS, FullDPS, TotalDPS, Life, TotalEHP, Armour, MinionLife (`OffenceDefence` where noted)"},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["slot","stat","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stat":{"type":"string"},"total":{"type":"number"},"uniques":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"power":{"type":"number"}},"required":["name","power"],"additionalProperties":{}}}},"required":["stat","total","uniques"],"additionalProperties":{}}`

### `POST /v1/evaluate/:id/compare-specs`

What switching from one tree to another changes (b against a; a is the active tree by default).

- Name: `evaluate.compare_specs` (MCP `pob_evaluate` action `compare_specs`)
- Read-only: yes; worker: `evaluate.compare_specs`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"a":{"description":"Tree number to start from (default the active tree)","type":"integer","minimum":1,"maximum":500},"b":{"type":"integer","minimum":1,"maximum":500,"description":"Tree number in the tree list, from 1"},"fields":{"description":"Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats","maxItems":100,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["b","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","boolean","string","null"]},"after":{"type":["number","boolean","string","null"]}},"required":["before","after"]},"description":"Only the stats that differ; null = not shown / absent"}},"required":["changed"]}`

### `POST /v1/evaluate/:id/compare-item-sets`

What switching from one item set to another changes (b against a; a is the active set by default).

- Name: `evaluate.compare_item_sets` (MCP `pob_evaluate` action `compare_item_sets`)
- Read-only: yes; worker: `evaluate.compare_item_sets`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"a":{"description":"Item set number to start from (default the active set)","type":"integer","minimum":1,"maximum":500},"b":{"type":"integer","minimum":1,"maximum":500,"description":"Item set number to compare, from 1"},"fields":{"description":"Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats","maxItems":100,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["b","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","boolean","string","null"]},"after":{"type":["number","boolean","string","null"]}},"required":["before","after"]},"description":"Only the stats that differ; null = not shown / absent"}},"required":["changed"]}`

### `POST /v1/evaluate/:id/compare-builds`

What differs between this build and another build: this build's stats as before, the other's as after.

- Name: `evaluate.compare_builds` (MCP `pob_evaluate` action `compare_builds`)
- Read-only: yes; worker: `stats.sidebar (stats.output with `fields`) on each build, diffed by the server`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"other":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"The build to compare with (its stats are the `after`)"},"fields":{"description":"Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats","maxItems":100,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"}},"required":["other","id"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","boolean","string","null"]},"after":{"type":["number","boolean","string","null"]}},"required":["before","after"]},"description":"Only the stats that differ; null = not shown / absent"}},"required":["changed"]}`

### `POST /v1/evaluate/:id/compare-power`

The Compare tab's power report against another build: what each passive the other build has and this one lacks, each item it wears, each skill group and support gem of its main skill it adds, and each config option it sets differently would change on this build, one at a time, best first. `impact` is the change in the stat (`percent` of this build's value); passives also give `pathDist` and `perPoint`.

- Name: `evaluate.compare_power` (MCP `pob_evaluate` action `compare_power`)
- Read-only: yes; worker: `evaluate.compare_power, with the other build in the Compare tab`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"stat":{"description":"Power stat by its label (default Full DPS), e.g. Life, Effective Hit Pool","type":"string","minLength":1,"maxLength":60},"categories":{"description":"Which parts to measure (default all)","type":"object","properties":{"tree":{"type":"boolean"},"items":{"type":"boolean"},"gems":{"type":"boolean"},"supports":{"type":"boolean"},"config":{"type":"boolean"}}},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"id":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"Build id"},"other":{"type":"string","pattern":"^[a-f0-9]{16}$","description":"The other build, loaded as the Compare tab's compared build"},"otherSets":{"description":"The other build's tree, skill, item and config sets to compare (1-based, in list order), as the Compare tab's set dropdowns pick them; default the active ones","type":"object","properties":{"tree":{"type":"integer","minimum":1,"maximum":500},"skills":{"type":"integer","minimum":1,"maximum":500},"items":{"type":"integer","minimum":1,"maximum":500},"config":{"type":"integer","minimum":1,"maximum":500}}}},"required":["id","other"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"other":{"type":"string"},"stat":{"type":"string"},"total":{"type":"number"},"results":{"type":"array","items":{"type":"object","properties":{"category":{"type":"string"},"name":{"type":"string"},"impact":{"type":"number"},"percent":{"type":"number"}},"required":["category","name","impact","percent"],"additionalProperties":{}}}},"required":["other","stat","total","results"],"additionalProperties":{}}`

### `POST /v1/trade/search`

Run trade searches on the official trade site now and answer their first listings, each read by Path of Building's own trade conversion and, with `buildId`, scored for the build in its slot (`score.gain`: the weighted change x1000 against what is there now, as jewel_mods and the trade search weigh; sorted by it). Takes complete search definitions (the `search` of jewel_mods, or any query the trade site takes). Limits: Path of Building's own request shapes (search, then fetch in blocks of 10) and client string, the host fixed, no account, session or cookie; at most 8 searches per call and 30 listings per search; nothing repeats a search by itself (a caller may call again, reading `limiter`); one limiter for the whole server paces at half of every window the site states, a quarter for `priority: background`, which is refused rather than kept waiting; a 429 or any 4xx stops the call (`stopped`, with the site's Retry-After) and nothing is retried; the same search within 10 minutes is answered from a cache and sends nothing. No seller names or whispers are answered; nothing is sent to a seller. `link` is the search on the trade site (PoB's own link form; unverified until someone opens one by hand).

- Name: `trade.search` (MCP `pob_trade` action `search`)
- Read-only: yes; worker: `evaluate.listings (after the trade site's search and fetch)`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"league":{"type":"string","maxLength":64,"pattern":"^[A-Za-z0-9][A-Za-z0-9 '-]*$","description":"Trade league, the one being played"},"realm":{"description":"Default pc","type":"string","enum":["pc","xbox","sony"]},"priority":{"description":"interactive (default): a person asking now, waits for the pace up to 60 s; background: a watched search, refused at once when the budget is short","type":"string","enum":["interactive","background"]},"searches":{"minItems":1,"maxItems":8,"type":"array","items":{"type":"object","properties":{"query":{"type":"object","properties":{},"additionalProperties":{},"description":"The trade site's `query` object (status, stats, filters)"},"sort":{"description":"Default { price: asc }; jewel_mods' search sorts by its weight group","type":"object","propertyNames":{"type":"string","minLength":1,"maxLength":60},"additionalProperties":{"type":"string","enum":["asc","desc"]}},"engine":{"description":"Accepted so jewel_mods' search can be passed as is","type":"string","const":"new"},"slot":{"description":"Slot each listing is scored in (default: the first slot in use it fits; a jewel the first empty socket)","type":"string","minLength":1,"maxLength":60},"listings":{"description":"Listings to fetch (1-30, default 10)","type":"integer","minimum":1,"maximum":30}},"required":["query"]}},"buildId":{"description":"Score each listing for this build","type":"string","pattern":"^[a-f0-9]{16}$"},"weights":{"description":"Stat weights as the trade popup's list sets them (0.01 to 1 each; default Full DPS 1, Effective Hit Pool 0.5)","minItems":1,"maxItems":20,"type":"array","items":{"type":"object","properties":{"stat":{"type":"string","minLength":1,"maxLength":60,"description":"A stat of Path of Building's power stat list, e.g. CombinedDPS, FullDPS, TotalDPS, Life, TotalEHP, Armour, MinionLife (`OffenceDefence` where noted)"},"weight":{"type":"number","minimum":0.01,"maximum":1}},"required":["stat","weight"]}},"fields":{"description":"Output keys to compare (`Minion.<key>` for the minion's) instead of the sidebar stats","maxItems":100,"type":"array","items":{"type":"string","minLength":1,"maxLength":100}}},"required":["league","searches"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"searches":{"type":"array","items":{"type":"object","properties":{"searchId":{"type":"string"},"total":{"type":"number"},"cached":{"type":"boolean"},"link":{"type":"string"},"listings":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"Listing id, stable across searches"},"price":{"anyOf":[{"type":"object","properties":{"amount":{"type":"number"},"currency":{"type":"string"},"type":{"type":"string"}},"required":["amount","currency","type"],"additionalProperties":{}},{"type":"null"}]},"indexed":{"description":"When the listing was posted or last changed","type":["string","null"]},"text":{"type":["string","null"]},"score":{"anyOf":[{"type":"object","properties":{"changed":{"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"object","properties":{"before":{"type":["number","boolean","string","null"]},"after":{"type":["number","boolean","string","null"]}},"required":["before","after"]},"description":"Only the stats that differ; null = not shown / absent"},"slot":{"type":"string"},"gain":{"type":"number"},"points":{"type":"number"}},"required":["changed","slot","gain"]},{"type":"null"}]},"error":{"type":"string"}},"required":["id","price","indexed","text","score"],"additionalProperties":{}}}},"required":["searchId","total","cached","link","listings"],"additionalProperties":{}}},"notRun":{"type":"number","description":"Searches not run because the call stopped"},"stopped":{"anyOf":[{"type":"object","properties":{"code":{"type":"string"},"message":{"type":"string"},"status":{"type":"number"},"retryAfterSeconds":{"type":"number"}},"required":["code","message"],"additionalProperties":{}},{"type":"null"}]},"limiter":{"type":"array","items":{"type":"object","properties":{"policy":{"type":"string"},"remaining":{"type":"object","properties":{"interactive":{"type":"number"},"background":{"type":"number"}},"required":["interactive","background"],"description":"Requests a caller of each priority may still send now"},"retryAfterSeconds":{"type":"object","properties":{"interactive":{"type":"number"},"background":{"type":"number"}},"required":["interactive","background"],"description":"Seconds until a caller of each priority may send (0 = now)"},"windows":{"type":"array","items":{"type":"object","properties":{"limit":{"type":"number"},"periodSeconds":{"type":"number"},"used":{"type":"number"}},"required":["limit","periodSeconds","used"]},"description":"The windows the trade site states, and requests counted in each"}},"required":["policy","remaining","retryAfterSeconds","windows"]}}},"required":["searches","notRun","stopped","limiter"],"additionalProperties":{}}`

### `GET /v1/lookup/gems`

Search gems by name and tag, with requirements at a level (`level` defaults to each gem's natural maximum). `requirements` is absent at a `level` the game data has no row for: some gems list levels only up to `naturalMaxLevel` (Convocation stops at 1).

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

### `GET /v1/lookup/data/:table`

Page through one of Path of Building's own game-data tables: rare_templates, bench_crafts, essences, veiled, necropolis, beastcraft, delve, incursion, fossil (the crafting lists of the Items tab), enchantments, cluster_notables, anoint_recipes, keystones, pantheons, map_mods, minions, spectres, bosses. Rows are flat and sorted by name; `query` matches a row's name or any of its text lines (case-insensitive). Tree tables (anoint_recipes, keystones) read the tree of `buildId`, else the latest.

- Name: `lookup.data` (MCP `pob_lookup` action `data`)
- Read-only: yes; worker: `lookup.data`
- Input: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"table":{"type":"string","enum":["rare_templates","bench_crafts","essences","veiled","necropolis","beastcraft","delve","incursion","fossil","enchantments","cluster_notables","anoint_recipes","keystones","pantheons","map_mods","minions","spectres","bosses"]},"query":{"type":"string","maxLength":100},"limit":{"description":"Result cap (1-200)","type":"integer","minimum":1,"maximum":200},"offset":{"description":"Skip this many results (paging with limit)","type":"integer","minimum":0,"maximum":100000},"buildId":{"description":"Answer in the context of this build (tree version, relevance); default: an empty build on the latest tree","type":"string","pattern":"^[a-f0-9]{16}$"}},"required":["table"]}`
- Result: `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"table":{"type":"string"},"total":{"type":"number"},"offset":{"type":"number"},"rows":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"],"additionalProperties":{}}}},"required":["table","total","offset","rows"],"additionalProperties":{}}`
