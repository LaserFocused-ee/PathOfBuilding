# Progress

## Coverage of the Path of Building operations

This file lists every one of the 187 operations of the Path of Building feature inventory and says what this API does with it. The states are kept current with the route table (`server/src/routes.ts`, listed in `API.md`). A few rows name several operations that share one state; they count as one row. Tests are in `server/test/`.

| State | Meaning |
| --- | --- |
| `done` | A named route and MCP action exist, and a worker test calls the route. |
| `ui` | Reachable only through the generic control driver `build.ui_invoke` for now (the tab and control are named); to be replaced by a named route. |
| `store` | Covered by the server's own build store instead of Path of Building's file handling (open, save, folders, undo map to the store, revisions, history, revert). |
| `not needed` | Has no meaning for a server. The reason is given. |
| `F3` | Planned for the trade and data stage: `trade.*` operations and data lookups not yet routed. |
| `open` | Not covered yet. The reason is given. |
| `denied` | Refused by the server: outbound or account sign-in not offered; the reason is given. |

Tier is the inventory's tier: H (a direct call of Path of Building's own code), S (small glue on top of it), X (new code).

### builds

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `builds.new` | H | done | `build.new`; engine.test.ts |
| `builds.load_xml` | H | done | `build.import_xml`; engine.test.ts |
| `builds.open_file` | H | store | Builds are opened by id from the store: `build.get`, `build.list` |
| `builds.save` | H | store | Every change is stored as a revision; `build.save_point` keeps one past pruning |
| `builds.save_as` | S | store | `build.duplicate` |
| `builds.export_xml` | H | done | `build.export_xml`; edit.test.ts |
| `builds.close` | H | not needed | The server opens and recycles build sessions itself; `build.delete` removes a build |
| `builds.status` | S | store | `build.get` (revision, summary), `stats.versions`; there is no unsaved state |
| `builds.convert_version` | S | done | `tree.convert`; edit.test.ts |
| `builds.list` | S | store | `build.list`, `build.trash` |
| `builds.search` / `sort` | S | done | `build.list` with `query` (name contains) and `sort` (updated, created, name); engine.test.ts |
| `builds.rename` | S | store | `build.rename` |
| `builds.copy` | S | store | `build.duplicate` |
| `builds.delete` | S | store | `build.delete`, `build.restore` (kept 7 days) |
| `builds.move` / `new_folder` | S | not needed | The store is flat; there are no folders |
| `builds.set_level` | S | done | `build.settings`; edit.test.ts |
| `builds.set_level_auto` | S | done | `build.settings` (`autoLevel`); edit.test.ts |
| `builds.set_class` | S | done | `tree.set_class`; edit.test.ts |
| `builds.set_ascendancy` | H | done | `tree.set_ascendancy`; edit.test.ts |
| `builds.set_bloodline` | H | done | `tree.set_bloodline`; edit.test.ts |
| `builds.loadouts.list` | S | done | `build.loadout_list` (Build.lua SyncLoadouts) |
| `builds.loadouts.switch` | X | done | `build.loadout_activate` (the Loadouts dropdown) |
| `builds.loadouts.new` | X | done | `build.loadout_new`: copies of the active sets, or `empty` (New Loadout) |
| `builds.set_main_skill` | S | done | `skills.set_main`, `skills.set_skill_options`; skills.test.ts, skills2.test.ts |
| `builds.spectre_library` | S | done | `skills.set_spectres`; skills2.test.ts |
| `builds.progress_estimate` | X | done | `stats.points` (points, ascendancy, required level, act); engine.test.ts |
| `builds.xp_multiplier` | X | done | `stats.xp`; engine.test.ts |
| `builds.similar` | S | denied | Outbound or account sign-in not offered by the server: calls a third-party recommendation service; not routed. No tab control opens the popup (settings.test.ts) |
| `builds.public_latest_trending` | S | denied | Outbound or account sign-in not offered by the server: calls a third-party build archive; not routed. No tab control opens the list (settings.test.ts) |
| `builds.undo` / `redo` | H | store | `build.history`, `build.revert`; edit.test.ts |

### import / export

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `import.decode_code` | X | done | `build.import_code` (decoded on the server); engine.test.ts |
| `import.from_url` | S | done | `build.import_link`; engine.test.ts tests link resolution and refusal of an unsupported site, not the download |
| `import.apply` (current, new, comparison) | X | done | New: `build.import_code`, `build.import_xml`. Current: `build.replace_code` (web.test.ts). Comparison: `evaluate.compare_builds` |
| `import.character_json` | H | done | `build.import_character`; character.test.ts |
| `import.characters.list_oauth` | S | denied | Outbound or account sign-in not offered by the server: needs a game-site login the server does not have. `import.accountRealmFetchButton` is refused (settings.test.ts) |
| `import.characters.get_oauth` | S | denied | Same. `import.charImportItems` and `import.charImportTree` are refused (settings.test.ts) |
| `import.characters.list_by_account` | S | done | `build.characters`; character.test.ts |
| `import.characters.tree_by_account` | S | done | Part of `build.import_character`; character.test.ts |
| `import.characters.items_by_account` | S | done | Part of `build.import_character`; character.test.ts |
| `import.oauth.login` | X | denied | Outbound or account sign-in not offered by the server: needs the server to hold its own login client. `import.authenticateButton` is refused (settings.test.ts) |
| `export.code` | S | done | `build.export_code`; engine.test.ts |
| `export.share_link` | S | denied | Outbound or account sign-in not offered by the server: uploads to a third-party site; not routed. `import.generateCodeByLink` is refused (settings.test.ts) |
| `export.support_buffs_toggle` | H | ui | Import tab, control `enablePartyExportBuffs` (`set_state`); settings.test.ts |
| `export.reimport_primary` | S | done | `build.reimport`; character.test.ts |

### tree

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `tree.get` | H | done | `tree.get`; edit.test.ts |
| `tree.allocate` | H | done | `tree.allocate`; edit.test.ts |
| `tree.allocate_any` | X | done | `tree.allocate` with `ascendancy: "switch"`; tree-ascendancy.test.ts |
| `tree.deallocate` | H | done | `tree.deallocate`; edit.test.ts |
| `tree.reset` | H | done | `tree.reset`; edit.test.ts |
| `tree.connect_to_class` | H | done | `tree.set_class` with `onDisconnected: connect`; edit.test.ts |
| `tree.path_to` / `path_between` | H, X | done | `tree.path` (with `from` for a route between two nodes); edit.test.ts |
| `tree.mastery.options` | H | done | `tree.mastery_options`; edit.test.ts |
| `tree.mastery.set` | X | done | `tree.set_mastery`; edit.test.ts |
| `tree.tattoo.options` / `apply` / `remove` | X | done | `tree.tattoo_options`, `tree.tattoo`, `tree.untattoo` (the Replace Modifier of Node dialog); edit.test.ts |
| `tree.tattoo.remove_all` | S | done | `tree.remove_tattoos`; edit.test.ts |
| `tree.specs.list` / `new` / `copy` / `rename` / `delete` | S | done | `tree.get` (list), `tree.spec_new`, `tree.spec_copy`, `tree.spec_rename`, `tree.spec_delete`; edit.test.ts |
| `tree.specs.reorder` | S | done | `tree.spec_move`; edit.test.ts |
| `tree.specs.switch` | H | done | `tree.spec_activate`; edit.test.ts |
| `tree.specs.compare_preview` / `compare_spec` | X, H | done | `evaluate.compare_specs` (stat differences; no refunds or gold); evaluate.test.ts |
| `tree.version.list` / `convert` | H | done | `stats.versions` (list), `tree.convert`; edit.test.ts, engine.test.ts |
| `tree.version.convert_all` | H | done | `tree.convert_all`; edit.test.ts |
| `tree.import_url` | S | done | `tree.import_url`; edit.test.ts |
| `tree.export_url` | H | done | `tree.export_url`; edit.test.ts |
| `tree.search` | S | done | `lookup.nodes`; engine.test.ts |
| `tree.node_info` / `node_text` | S, H | done | `lookup.node` (stats, links, path length, mastery effects); engine.test.ts. Differences: `evaluate.what_if` |
| `tree.node_power` | S | done | `evaluate.node_power`; evaluate.test.ts |
| `tree.power_report` | H | done | `evaluate.node_power` (ranked, paged list); per-candidate stat differences with paths: `evaluate.passives`; evaluate.test.ts |
| `tree.timeless.search` | S | done | `evaluate.timeless` (the Find Timeless Jewel dialog driven through its controls, league list given so it fetches nothing); evaluate-jewels.test.ts |
| `tree.timeless.read_seed` | H | done | `tree.timeless_nodes` (what a seed and conqueror do around a socket, read through the same PassiveSpec rebuild as a socketed jewel, the build left as it was); tree-timeless.test.ts |
| `tree.timeless.trade_url` | S | done | `evaluate.timeless` `search` / `link` (Open Trade URL captured, not opened); run it with `trade.search` |
| `tree.radius_nodes` | H | done | `tree.radius_nodes`; evaluate-jewels.test.ts |

### skills

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `skills.groups.list` | H | done | `skills.get`; skills.test.ts |
| `skills.groups.add_text` | H | done | `skills.add_group` (copy text); skills.test.ts |
| `skills.groups.to_text` | S | done | `skills.group_text`; skills.test.ts |
| `skills.groups.update` | S | done | `skills.update_group`; skills.test.ts |
| `skills.groups.delete` / `copy` / `reorder` | S | done | `skills.delete_group`, `skills.move_group`; copy is `skills.group_text` then `skills.add_group`; skills.test.ts |
| `skills.gems.set` | S | done | `skills.set_gem`; skills.test.ts |
| `skills.gems.delete` | S | done | `skills.delete_gem`; skills.test.ts |
| `skills.imbued_support` | S | done | `skills.set_imbued`; skills.test.ts |
| `skills.optimise_sockets` | X | done | `skills.optimise_sockets`; skills.test.ts |
| `skills.sets.*` | S | done | `skills.set_new`, `set_copy`, `set_rename`, `set_delete`, `set_activate` (list in `skills.get`); skills.test.ts |
| `skills.options` | H | done | `skills.set_options`; skills.test.ts |
| `skills.group_tooltip` | S | done | `skills.group_tooltip`; skills2.test.ts |
| `skills.gem_tooltip` | S | done | `skills.gem_tooltip`; skills2.test.ts |
| `skills.gems.find` | H | done | `lookup.gems`; engine.test.ts |
| `skills.gems.search` | S | done | `lookup.gems`; engine.test.ts |
| `skills.support_compatible` | H | done | `skills.support_compatible` (on a build holding the skill); lookup-computed.test.ts |
| `skills.gems.rank` | X | done | `evaluate.gem_rank`; evaluate.test.ts |

### items and crafting

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `items.list` / `equipped` | H | done | `items.list`; items.test.ts |
| `items.add_text` | H | done | `items.add`; items.test.ts |
| `items.add` | H | done | `items.add_unique`, `items.add_rare`; items.test.ts |
| `items.delete` | H | done | `items.delete`; items.test.ts |
| `items.equip` | H | done | `items.equip`, `items.unequip`; items.test.ts |
| `items.valid_slots` | H | done | `items.get` (`validSlots`); items.test.ts |
| `items.edit_text` | S | done | `items.edit`; items.test.ts |
| `items.variant` | H | done | `items.modify`; items.test.ts |
| `items.sockets` | S | done | `items.modify` (only adds sockets); items.test.ts |
| `items.quality` | S | done | `items.modify`; items.test.ts |
| `items.catalyst` | S | done | `items.modify`; items.test.ts |
| `items.influence` | S | done | `items.influence`; items2.test.ts |
| `items.craft_new` | S | done | `items.craft`; items.test.ts |
| `items.affixes.options` | S | done | `items.affix_options` (each affix box's choices and tiers on a crafted base; with `sort`, best first for the build); items2.test.ts |
| `items.affixes.set` | S | done | `items.craft` (new items); an existing item changes through `items.edit`; items.test.ts |
| `items.custom_mod` | S | done | `items.custom_mod`; items2.test.ts |
| `items.crucible_mod` | S | done | `items.crucible_mod`; items2.test.ts |
| `items.enchant` | S | done | `items.enchant`; items.test.ts |
| `items.anoint` | H | done | `items.anoint`; items.test.ts |
| `items.corrupt` | S | done | `items.corrupt`; items2.test.ts |
| `items.add_implicit` | S | done | `items.add_implicit`; items2.test.ts |
| `items.cluster_jewel` | S | done | `items.cluster_jewel`; items2.test.ts |
| `items.range_lines` | S | done | `items.modify` (`ranges`), `items.get`; items.test.ts |
| `items.tooltip` (+ diff) | S | done | `items.get` (text, mods); differences: `evaluate.compare_item`; evaluate.test.ts |
| `items.mod_diff_tooltip` | S | done | The same measure as the tooltip (the item in its slot with the mod added, against without): `items.affix_options` with `sort` gives it per choice and tier (items2.test.ts); `evaluate.compare_item` with the item text plus the mod gives every changed stat (evaluate.test.ts) |
| `items.sets.*` | S | done | `items.set_new`, `set_copy`, `set_rename`, `set_delete`, `set_activate` (list in `items.list`); items.test.ts |
| `items.weapon_swap` / `set_tree_link` | S | done | `items.weapon_set`; the Items tab's tree box activates a tree as `tree.spec_activate` does; items.test.ts |
| `items.shared.*` | S | not needed | Path of Building keeps a shared item list beside its build files for moving items between builds; here every build is in the store and `items.copy_from` copies an item from another stored build (compare.test.ts) |
| `items.flask_toggle` / `tincture_toggle` | H | done | `items.set_active`; items.test.ts |
| `items.socket_line` | H | done | `sockets` on every item answer (`R-G-B B`: colours, `-` links, space between groups; the line's text without colour codes); items.test.ts |

### config

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `config.options.list` | H | done | `lookup.config`; engine.test.ts |
| `config.options.relevant` | H | done | `lookup.config` `relevantOnly`; settings.test.ts |
| `config.get` | H | done | `config.get`; edit.test.ts |
| `config.set` | S | done | `config.set`; edit.test.ts |
| `config.sets.*` | S | done | `config.set_new`, `set_copy`, `set_rename`, `set_delete`, `set_activate`; edit.test.ts |
| `config.custom_mods` | S | done | `config.custom_mods`, `config.set_custom_mods`; settings.test.ts |

### calcs

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `calcs.sidebar` | S | done | `stats.sidebar`; engine.test.ts |
| `calcs.output` | H | done | `stats.output`; engine.test.ts |
| `calcs.full_dps` | H | done | `stats.skills`; engine.test.ts |
| `calcs.output_for_skill` | S | done | `stats.skills`; engine.test.ts |
| `calcs.sections` | S | done | `stats.sections`; engine.test.ts |
| `calcs.breakdown` | S | done | `stats.breakdown`; engine.test.ts |
| `calcs.warnings` | S | done | `stats.warnings`; settings.test.ts |
| `calcs.requirements` | H | done | `stats.defences`; engine.test.ts |
| `calcs.resists` | H | done | `stats.defences`; engine.test.ts |
| `calcs.reservation` | H | done | `stats.output` (`fields`, for example `ManaUnreserved`); skills2.test.ts |
| `calcs.point_budget` | H | done | `stats.points`; engine.test.ts |
| `calcs.what_if` | H | done | `evaluate.what_if`; evaluate.test.ts |
| `calcs.diff` | S | done | `evaluate.what_if` (only the stats that differ), `evaluate.compare_item`; evaluate.test.ts |

### compare and power

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `compare.add` | H | done | `evaluate.compare_builds` (the other build is named by id; import it first); evaluate.test.ts |
| `compare.list` | H | not needed | No stored compare list; each call names the build to compare |
| `compare.remove` | H | not needed | Same |
| `compare.select` | H | not needed | Same |
| `compare.set_loadout` | H | done | `otherSets` (tree, skills, items, config) on every route that names an `other` build: the Compare tab's set dropdowns pick the other build's sets; compare.test.ts |
| `compare.diff.*` | X | done | Output differences: `evaluate.compare_builds`, `evaluate.compare_specs`, `evaluate.compare_item_sets`; evaluate.test.ts. The drawn side-by-side screens are not needed |
| `compare.copy_tree` / `copy_item` / `copy_config` | H | done | `tree.copy_from` (`use` makes it active), `items.copy_from` (a slot of the other build; `use` equips it), `config.copy_from`, each naming the other stored build; compare.test.ts |
| `compare.power_report` | S | done | `evaluate.compare_power`: passives, items, skill and support gems, config of the other build, one at a time on this one, best first by a power stat; compare.test.ts |
| `compare.import_folder` | S | not needed | The store is flat; there are no folders |
| `compare.buy_similar_url` | S | done | `items.buy_similar` (the Buy similar popup driven through its controls: rows, defences, listed, realm, the league given and no trade request; the Items tab's button and, with `other`, the Compare tab's Buy button for the other build's item or slot); trade-similar.test.ts |
| `power.uniques` | S | done | `evaluate.unique_rank`; evaluate.test.ts |
| `power.anoints` | S | done | `evaluate.anoint_rank`; evaluate.test.ts |

### trade

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `trade.leagues` | S | done | `trade.leagues` (on request only; the realm's leagues and the current one, cached an hour; limits in its summary); trade.test.ts |
| `trade.currency_rates` | S | F3 | `pob_trade` |
| `trade.stat_weights` | S | done | Jewel sockets: `evaluate.jewel_mods` (weights, search, link); evaluate-jewels.test.ts. Gear slots: `evaluate.item_mods` (weights, search, link); evaluate-items-trade.test.ts |
| `trade.query.generate` | S | done | Jewel sockets: `evaluate.jewel_mods` (weights, search, link); evaluate-jewels.test.ts. Gear slots: `evaluate.item_mods` (weights, search, link); evaluate-items-trade.test.ts |
| `trade.search` | S | done | `trade.search` (on request only; limits in its summary); trade.test.ts |
| `trade.search_url` | S | done | Jewel sockets: `evaluate.jewel_mods` (weights, search, link); evaluate-jewels.test.ts. Gear slots: `evaluate.item_mods` (weights, search, link); evaluate-items-trade.test.ts |
| `trade.evaluate` | S | done | `trade.search` with `buildId` scores each listing in its slot; `evaluate.compare_item` with `listing` answers the same text and `gain` for one listing in every slot it fits; trade.test.ts, evaluate-what-if.test.ts |
| `trade.sort` / `total_price` | S | F3 | `pob_trade` |
| `trade.price_all_slots` | X | F3 | `pob_trade` |
| `trade.mod_to_trade_id` | H | done | `lookup.trade_stats` (mod lines to trade stat ids, values, options, inverted lines, timeless jewel stats); trade-similar.test.ts |
| `trade.rate_limits` | H | done | `trade.search` answers the limiter state (remaining, retry-after, the site's windows); trade.test.ts |

### notes, party, settings

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `notes.get` | S | done | `config.notes`; edit.test.ts |
| `notes.set` | S | done | `config.set_notes`; edit.test.ts |
| `party.import` | X | done | `config.party_import`; settings.test.ts |
| `party.get` | S | done | `config.party_get`; settings.test.ts |
| `party.set` | S | done | `config.party_set`; settings.test.ts |
| `party.clear` / `rebuild` / `remove_effects` | S | done | `config.party_clear`, `config.party_effects`; settings.test.ts |
| `party.export` | S | done | `config.party_export`; write-shapes.test.ts |
| `settings.get` / `set` | S | not needed | Application options (display, folders, updates) have no meaning for a server; build settings are `build.settings` and `config.set` |
| `settings.user_path` | H | not needed | The server owns its data directory |
| `app.version` / `help` | H | done | `stats.versions` (version); help text is not routed; engine.test.ts |

### data

| Operation | Tier | State | Route / note |
| --- | --- | --- | --- |
| `data.uniques.search` | S | done | `lookup.uniques`; engine.test.ts |
| `data.rare_templates` | H | done | `lookup.data` (`table`: `rare_templates`); lookup-data.test.ts |
| `data.bases` | H | done | `lookup.bases`; engine.test.ts |
| `data.mods_for_base` | S | done | `lookup.mods_for_base`; lookup-computed.test.ts |
| `data.bench_crafts` | H | done | `lookup.data` (`table`: `bench_crafts`); lookup-data.test.ts |
| `data.essences` / `veiled` / `necropolis` / `beastcraft` / `delve` / `incursion` / `fossil` | H | done | `lookup.data` (`table`: `essences`, `veiled`, `necropolis`, `beastcraft`, `delve`, `incursion`, `fossil`); lookup-data.test.ts |
| `data.enchantments` | H | done | `lookup.data` (`table`: `enchantments`); lookup-data.test.ts |
| `data.gems` | H | done | `lookup.gems`; engine.test.ts |
| `data.support_compatible` | H | done | `skills.support_compatible` (on a build holding the skill); lookup-computed.test.ts |
| `data.tree.search` | S | done | `lookup.nodes`; engine.test.ts |
| `data.cluster_notables` | H | done | `lookup.data` (`table`: `cluster_notables`); lookup-data.test.ts |
| `data.timeless` | H | done | `lookup.data` (`table`: `timeless`); lookup-data.test.ts |
| `data.anoint_recipes` | S | done | `lookup.data` (`table`: `anoint_recipes`); lookup-data.test.ts |
| `data.keystones` / `pantheons` / `map_mods` / `minions` / `bosses` | H | done | `lookup.data` (`table`: `keystones`, `pantheons`, `map_mods`, `minions`, `bosses`); lookup-data.test.ts |
| `data.spectres` | H | done | `lookup.data` (`table`: `spectres`); lookup-data.test.ts |
| `data.parse_mod` | H | done | `lookup.parse_mod`; lookup-computed.test.ts |
| `data.describe_stats` | H | done | `lookup.describe_stats`; lookup-computed.test.ts |

### Counts

| Domain | Total | done | ui | store | not needed | F3 | open | denied |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| builds | 30 | 17 | 0 | 9 | 2 | 0 | 0 | 2 |
| import / export | 14 | 9 | 1 | 0 | 0 | 0 | 0 | 4 |
| tree | 27 | 27 | 0 | 0 | 0 | 0 | 0 | 0 |
| skills | 17 | 17 | 0 | 0 | 0 | 0 | 0 | 0 |
| items and crafting | 30 | 29 | 0 | 0 | 1 | 0 | 0 | 0 |
| config | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 |
| calcs | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 |
| compare and power | 12 | 8 | 0 | 0 | 4 | 0 | 0 | 0 |
| trade | 11 | 8 | 0 | 0 | 0 | 3 | 0 | 0 |
| notes, party, settings | 10 | 8 | 0 | 0 | 2 | 0 | 0 | 0 |
| data | 17 | 17 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | 187 | 159 | 1 | 9 | 9 | 3 | 0 | 6 |

## MCP tools

MCP tools with at least one route today: all 9 (`pob_build`, `pob_stats`, `pob_tree`, `pob_skills`, `pob_items`, `pob_config`, `pob_evaluate`, `pob_lookup`, `pob_trade`).

## Build stages

Features are numbered as in `SPEC.md`. Checks for every entry: `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` in `api/server`.

## F1. Engine, API skeleton, MCP, builds, stats, lookup: built

- Runtime: `runtime/build-runtime.sh` (LuaJIT at 2460b3ff, lua-utf8 0.1.6, system zlib through the FFI).
- Worker: `lua/worker.lua` plus `lua/ops/{builds,stats,lookup}.lua`; JSON lines; boots in about 1.8 s.
- Server: config, logger, `/health`, `/health/deep`, bearer auth, worker pool (one process per open build, LRU recycling, kill on timeout or memory ceiling, reload from the store), file build store with revisions, stale-write refusal, history of the last 50 plus save points, server-sent events, share-link fetch module.
- Route table (`server/src/routes.ts`) generates the HTTP routes, the MCP tools and `docs/API.md`.
- MCP: Streamable HTTP at `POST /mcp` (stateless) and stdio (`server/dist/src/stdio.js`). F1 shipped `pob_build`, `pob_stats` and `pob_lookup`; F2 added `pob_tree`, `pob_skills`, `pob_items`, `pob_config` and `pob_evaluate`; F3 added `pob_trade`.
- Operations: builds (new, import XML, code, share link, list, get, rename, duplicate, delete, export XML, export code, save point, history), stats (sidebar, output with `fields`, per-skill and Full DPS, breakdown, warnings, defences, points, versions), lookup (gems, uniques, bases, node search, node detail, config catalogue).
- Tests: OccVortex (tree 3_13) and a Witch/Elementalist fixture made on tree 3_30 with concrete stat values; build-code round trip; two sessions open at once; worker kill recovered from the store; MCP over HTTP and stdio; auth, health, log lines.

Deviations from the spec text, with reasons:

- `GetScriptPath` is not redirected to the state directory: data loaders build relative paths from it (for example `DataLegionLookUpTableHelper.lua` joins it without a separator), so it stays `""` and the worker runs with `src/` as its working directory. `GetUserPath` and `GetRuntimePath` point at a per-worker state directory.
- Build codes are decoded on the server (Node zlib with an output cap) rather than in the worker, so an oversized code is refused before it reaches the Lua state. Encoding stays in the worker, using the same expression as `ImportTab.lua`.
- The MCP SDK is the v2 split package (`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/node` 2.1.2); `createMcpHandler` serves the stateless legacy protocol and the current one from one factory.

## F2. Tree, skills, items, config, notes, evaluate: in progress

Routes for the tree, skills, items, config, party, evaluate domains, character import from a public profile, the browser view's server side, and the generic control driver are in; the operations marked `denied` in the tables above are refused by the server and none is `open`.

## F3. Import and trade query: in progress

In: character import from a public profile, jewel finding (`evaluate.jewel_mods`, jewels in `evaluate.compare_item`), gear finding for every slot (`evaluate.item_mods`), the Buy similar search for an item (`items.buy_similar`), mod lines to trade stat ids (`lookup.trade_stats`), and trade search from the server (`trade.search`) under the limits in `SPEC.md`. The one live check against the trade site after deploy is the orchestrator's; until then the link form and the site's mod-line shape without an account are unverified (both shapes are read).

## F4. Web view: separate owner

## F5. Package: README, Dockerfile and example systemd unit ship with F1
