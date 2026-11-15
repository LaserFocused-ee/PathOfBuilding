-- lookup.* ops: read-only game data (gems, uniques, bases, tree nodes, config options).
return function(W)
	local ops = {}
	local strip = W.strip

	local function limitOf(args, default)
		local n = tonumber(args.limit) or default
		return math.max(1, math.min(200, math.floor(n)))
	end
	-- Paging for list results: offset? (skip), limit? (1-200).
	local function pageOf(args, default)
		return math.max(0, math.floor(tonumber(args.offset) or 0)), limitOf(args, default)
	end
	local function has(hay, needle)
		return needle == nil or needle == "" or (type(hay) == "string" and hay:lower():find(needle:lower(), 1, true) ~= nil)
	end

	-- args: query?, tag?, support? (bool), level? (requirements at this gem level), limit?
	function ops.gems(args)
		local list = {}
		for id, gem in pairs(data.gems) do
			local ge = gem.grantedEffect
			local isSupport = ge and ge.support or false
			if has(gem.name, args.query) and (args.tag == nil or (gem.tags and gem.tags[args.tag:lower()]))
				and (args.support == nil or args.support == isSupport) then
				list[#list + 1] = { id = id, gem = gem, support = isSupport }
			end
		end
		table.sort(list, function(a, b) return a.gem.name < b.gem.name end)
		local out, offset, limit = {}, pageOf(args, 20)
		for i = offset + 1, math.min(#list, offset + limit) do
			local g, ge = list[i].gem, list[i].gem.grantedEffect
			local level = math.floor(tonumber(args.level) or g.naturalMaxLevel or 20)
			local lv = ge and ge.levels and ge.levels[level]
			local reqLevel = lv and lv.levelRequirement or nil
			local tags = {}
			for t in pairs(g.tags or {}) do tags[#tags + 1] = t end
			table.sort(tags)
			out[#out + 1] = {
				id = list[i].id, name = g.name, support = list[i].support, tags = tags, tagString = g.tagString,
				naturalMaxLevel = g.naturalMaxLevel, description = ge and strip(ge.description) or nil,
				requirements = reqLevel and {
					gemLevel = level, level = reqLevel,
					str = calcLib.getGemStatRequirement(reqLevel, list[i].support, g.reqStr or 0),
					dex = calcLib.getGemStatRequirement(reqLevel, list[i].support, g.reqDex or 0),
					int = calcLib.getGemStatRequirement(reqLevel, list[i].support, g.reqInt or 0),
				} or nil,
			}
		end
		return { total = #list, offset = offset, gems = out }
	end

	-- args: query? (name), text? (any line of the item text), limit?
	function ops.uniques(args)
		local list = {}
		for name, item in pairs(W.main.uniqueDB.list) do
			if has(name, args.query) and has(item.raw, args.text) then list[#list + 1] = item end
		end
		table.sort(list, function(a, b) return a.name < b.name end)
		local out, offset, limit = {}, pageOf(args, 10)
		for i = offset + 1, math.min(#list, offset + limit) do
			local it = list[i]
			out[#out + 1] = { name = it.name, title = it.title, base = it.baseName, type = it.type, variants = it.variantList and #it.variantList or nil, text = strip(it.raw) }
		end
		return { total = #list, offset = offset, uniques = out }
	end

	-- args: query?, type?, limit?
	function ops.bases(args)
		local list = {}
		for name, base in pairs(data.itemBases) do
			if has(name, args.query) and (args.type == nil or base.type == args.type) then list[#list + 1] = { name = name, base = base } end
		end
		table.sort(list, function(a, b) return a.name < b.name end)
		local out, offset, limit = {}, pageOf(args, 20)
		for i = offset + 1, math.min(#list, offset + limit) do
			local base = W.plain(list[i].base)
			base.name = list[i].name
			out[#out + 1] = base
		end
		return { total = #list, offset = offset, bases = out }
	end

	local function nodeBrief(spec, node)
		return { id = node.id, name = node.dn, type = node.type, stats = node.sd and W.plain(node.sd) or {},
			ascendancy = node.ascendancyName, allocated = spec.allocNodes[node.id] ~= nil }
	end

	-- Search words as the tree search box splits them (PassiveTreeView.lua:793): "quoted phrases" and words.
	local function searchWords(search)
		search = search:lower()
		local words = {}
		for phrase in search:gmatch('"([^"]*)"') do words[#words + 1] = phrase end
		search = search:gsub('"[^"]*"', "")
		for word in search:gmatch("%S+") do words[#words + 1] = word end
		return words
	end

	-- args: query (name, stat text, type; same matcher as the tree search box), type?, limit?
	function ops.nodes(args)
		if type(args.query) ~= "string" or args.query == "" then W.fail("invalid_input", "query is required") end
		local b = W.build()
		local viewer, spec = b.treeTab.viewer, b.spec
		local saved = viewer.searchParams
		viewer.searchParams = searchWords(args.query)
		local list = {}
		local ok, err = pcall(function()
			for _, node in pairs(spec.nodes) do
				if (args.type == nil or node.type == args.type) and viewer:DoesNodeMatchSearchParams(node) then list[#list + 1] = node end
			end
		end)
		viewer.searchParams = saved
		if not ok then error(err, 0) end
		table.sort(list, function(a, c) return a.id < c.id end)
		local out, offset, limit = {}, pageOf(args, 25)
		for i = offset + 1, math.min(#list, offset + limit) do out[#out + 1] = nodeBrief(spec, list[i]) end
		return { total = #list, offset = offset, treeVersion = spec.treeVersion, nodes = out }
	end

	-- args: id
	function ops.node(args)
		local b = W.build()
		local spec = b.spec
		local node = spec.nodes[tonumber(args.id)]
		if not node then W.fail("not_found", "no node " .. tostring(args.id) .. " on tree " .. spec.treeVersion) end
		local out = nodeBrief(spec, node)
		out.linked = {}
		for _, other in ipairs(node.linked or {}) do out.linked[#out.linked + 1] = other.id end
		if node.path and not out.allocated then out.pathLength = #node.path end
		out.reminderText = node.reminderText and W.plain(node.reminderText) or nil
		out.flavourText = node.flavourText and W.plain(node.flavourText) or nil
		if node.masteryEffects then
			out.masteryEffects = {}
			for _, me in ipairs(node.masteryEffects) do
				local effect = spec.tree.masteryEffects[me.effect]
				out.masteryEffects[#out.masteryEffects + 1] = { effect = me.effect, stats = effect and W.plain(effect.sd) or W.plain(me.stats) }
			end
			out.selectedMasteryEffect = spec.masterySelections[node.id]
		end
		return out
	end

	-- args: section?, query? (var or label), var? (one option, with tooltip), relevantOnly?, offset?, limit? (default 100)
	function ops.config(args)
		local b = W.build()
		local varList = require("Modules.ConfigOptions")
		local okVis, vis = pcall(require, "Modules.ConfigVisibility")
		local section
		local out, matched = {}, 0
		local offset, limit = pageOf(args, 100)
		for _, v in ipairs(varList) do
			if v.section then section = v.section end
			if v.var and (args.var == nil or v.var == args.var) and (args.section == nil or section == args.section)
				and (has(v.var, args.query) or has(v.label, args.query)) then
				local relevant = nil
				if okVis and vis.isRelevantForBuild then
					local okRel, r = pcall(vis.isRelevantForBuild, v, b)
					relevant = okRel and r and true or false
				end
				if not args.relevantOnly or relevant then matched = matched + 1 end
				if (not args.relevantOnly or relevant) and matched > offset and #out < limit then
					local entry = {
						var = v.var, type = v.type, label = strip(v.label or ""):gsub(":$", ""), section = section,
						current = W.plain(b.configTab.input[v.var]), placeholder = W.plain(b.configTab.placeholder[v.var]),
						relevant = relevant,
					}
					if v.list then
						entry.allowed = {}
						for _, item in ipairs(v.list) do entry.allowed[#entry.allowed + 1] = { value = item.val, label = strip(item.label) } end
						entry.default = v.list[v.defaultIndex or 1] and v.list[v.defaultIndex or 1].val
					elseif v.defaultState ~= nil then
						entry.default = v.defaultState
					end
					if args.var and type(v.tooltip) == "string" then entry.tooltip = strip(v.tooltip) end
					out[#out + 1] = entry
				end
			end
		end
		return { total = matched, offset = offset, options = out }
	end

	-- args: table (one of dataTables), query? (name or any line of a row), offset?, limit?
	-- Path of Building's own game-data tables, one flat row each: name, plus fields as plain JSON.
	local function lineList(list)
		local out = {}
		for i, line in ipairs(list or {}) do out[i] = strip(line) end
		return out
	end
	local function sortedKeys(set)
		local out = {}
		for k in pairs(set or {}) do out[#out + 1] = k end
		table.sort(out)
		return out
	end
	local function modRow(id, mod)
		local lines = lineList(mod)
		return { name = table.concat(lines, "/"), id = id, type = mod.type, affix = mod.affix, level = mod.level, group = mod.group, lines = lines, tags = lineList(mod.modTags) }
	end
	local function modsOf(mods, add)
		for id, mod in pairs(mods) do add(modRow(id, mod), id) end
	end
	-- Drop-restricted mods: the data file names each mod and the item types it drops on.
	local function dropOnly(file, mods, add)
		for id, entry in pairs(require(file)) do
			local mod = mods[id]
			if mod then
				local row = modRow(id, mod)
				row.categories = lineList(entry.categories)
				add(row, id)
			end
		end
	end
	local function numbers(src, names)
		local out = {}
		for _, k in ipairs(names) do out[k] = src[k] end
		return out
	end
	local minionFields = { "life", "energyShield", "armour", "fireResist", "coldResist", "lightningResist", "chaosResist", "damage", "damageSpread", "attackTime", "attackRange", "accuracy" }
	local function minionRow(id, minion)
		local row = numbers(minion, minionFields)
		row.name, row.id, row.limit = minion.name, id, minion.limit
		row.skills, row.tags = lineList(minion.skillList), lineList(minion.monsterTags)
		return row
	end
	local function treeNodes(add, wanted)
		local spec = W.build().spec
		for id, node in pairs(spec.nodes) do
			if wanted(node) then add({ name = node.dn, id = id, lines = lineList(node.sd), recipe = node.recipe and lineList(node.recipe) or nil }, id) end
		end
	end

	local dataTables = {
		rare_templates = function(add)
			for name, item in pairs(W.main.rareDB.list) do
				local lines = {}
				for _, list in ipairs({ item.implicitModLines, item.explicitModLines }) do
					for _, modLine in ipairs(list) do lines[#lines + 1] = strip(modLine.line) end
				end
				add({ name = name, base = item.baseName, type = item.type, lines = lines }, name)
			end
		end,
		bench_crafts = function(add)
			for i, craft in ipairs(data.masterMods) do
				local row = modRow(nil, craft)
				row.types = sortedKeys(craft.types)
				add(row, string.format("%08d", i))
			end
		end,
		essences = function(add)
			for id, essence in pairs(data.essences) do
				local lines = {}
				for _, slot in ipairs(sortedKeys(essence.mods)) do
					local mod = data.itemMods.Item[essence.mods[slot]]
					lines[#lines + 1] = slot .. ": " .. (mod and table.concat(lineList(mod), "/") or essence.mods[slot])
				end
				add({ name = essence.name, id = id, tier = essence.tier, type = essence.type, lines = lines }, id)
			end
		end,
		veiled = function(add) modsOf(data.veiledMods, add) end,
		necropolis = function(add) modsOf(data.necropolisMods, add) end,
		beastcraft = function(add) modsOf(data.beastCraft, add) end,
		delve = function(add) dropOnly("Data.DelveDropOnly", data.itemMods.Delve, add) end,
		incursion = function(add) dropOnly("Data.IncursionDropOnly", data.itemMods.Explicit, add) end,
		fossil = function(add)
			for id, mod in pairs(data.itemMods.Delve) do
				if mod.affix == "Subterranean" or mod.affix == "of the Underground" then add(modRow(id, mod), id) end
			end
		end,
		enchantments = function(add)
			-- The seven item groups Data.lua loads; its other keys (Flask, one per weapon type) repeat these.
			for _, slot in ipairs({ "Belt", "Body Armour", "Boots", "Gloves", "Helmet", "UtilityFlask", "Weapon" }) do
				local function lines(source, skill, list)
					for i, entry in ipairs(list) do
						local text = type(entry) == "table" and table.concat(lineList(entry), "/") or strip(entry)
						add({ name = text, text = text, slot = slot, source = source, skill = skill, types = type(entry) == "table" and sortedKeys(entry.types) or nil },
							string.format("%s|%s|%s|%08d", slot, skill or "", source, i))
					end
				end
				for source, list in pairs(data.enchantments[slot]) do
					if slot == "Helmet" then
						-- Helmet enchantments: skill, then tier.
						for tier, tierList in pairs(list) do lines(tier, source, tierList) end
					else
						lines(source, nil, list)
					end
				end
			end
		end,
		cluster_notables = function(add)
			for name, info in pairs(data.clusterJewelInfoForNotable) do
				local skills, seen = {}, {}
				for size in pairs(info.size) do
					for _, tag in ipairs(info.jewelTypes) do
						local skill = data.clusterJewels.jewels[size].skills[tag]
						if skill and not seen[skill.name] then seen[skill.name] = true; skills[#skills + 1] = skill.name end
					end
				end
				table.sort(skills)
				add({ name = name, sizes = sortedKeys(info.size), skills = skills }, name)
			end
		end,
		anoint_recipes = function(add) treeNodes(add, function(node) return node.recipe ~= nil end) end,
		keystones = function(add) treeNodes(add, function(node) return node.type == "Keystone" end) end,
		pantheons = function(add)
			for id, god in pairs(data.pantheons) do
				local lines = {}
				for _, soul in ipairs(god.souls) do
					for _, mod in ipairs(soul.mods) do lines[#lines + 1] = strip(soul.name .. ": " .. mod.line) end
				end
				add({ name = id, major = god.isMajorGod or false, lines = lines }, id)
			end
		end,
		map_mods = function(add)
			local kind = {}
			for _, which in ipairs({ "Prefix", "Suffix" }) do
				for _, item in ipairs(data.mapMods[which]) do kind[item.val] = which end
			end
			for name, affix in pairs(data.mapMods.AffixData) do
				add({ name = name, kind = kind[name], type = affix.type, label = strip(affix.label), lines = lineList(affix.tooltipLines), values = W.plain(affix.values) }, name)
			end
		end,
		minions = function(add)
			for id, minion in pairs(data.minions) do
				if not data.spectres[id] then add(minionRow(id, minion), id) end
			end
		end,
		spectres = function(add)
			for id, minion in pairs(data.spectres) do add(minionRow(id, minion), id) end
		end,
		-- One row per timeless jewel type: the seed range as written on the item, the conquerors and the keystone each variant line names.
		timeless = function(add)
			for _, jewel in ipairs(W.timelessJewels()) do
				local names, keystones = {}, setmetatable({}, { __jsontype = "object" })
				for i, c in ipairs(jewel.conquerors) do
					names[i] = c.name
					keystones[c.name] = c.keystone
				end
				add({ name = jewel.name, base = jewel.base, radius = jewel.radius, seedMin = jewel.seedMin, seedMax = jewel.seedMax, conquerors = names, keystones = keystones }, jewel.name)
			end
		end,
		bosses = function(add)
			for id, boss in pairs(data.bosses) do add({ name = id, armourMult = boss.armourMult, evasionMult = boss.evasionMult, isUber = boss.isUber or false }, id) end
		end,
	}

	function ops.data(args)
		local source = dataTables[args.table]
		if not source then W.fail("not_found", "no data table " .. tostring(args.table) .. "; tables: " .. table.concat(sortedKeys(dataTables), ", ")) end
		local list = {}
		source(function(row, key)
			if has(row.name, args.query) then
				list[#list + 1] = { row = row, key = key }
				return
			end
			for _, line in ipairs(row.lines or {}) do
				if has(line, args.query) then list[#list + 1] = { row = row, key = key }; return end
			end
		end)
		table.sort(list, function(a, b)
			if a.row.name ~= b.row.name then return a.row.name < b.row.name end
			return a.key < b.key
		end)
		local out, offset, limit = {}, pageOf(args, 20)
		for i = offset + 1, math.min(#list, offset + limit) do out[#out + 1] = list[i].row end
		return { table = args.table, total = #list, offset = offset, rows = out }
	end

	local function array() return setmetatable({}, { __jsontype = "array" }) end

	-- args: base, ilvl? (default 100), type? (Prefix or Suffix), influence? (an Influence dropdown entry, e.g. Shaper), query?, offset?, limit?
	-- The mods a rare of this base can roll: the affix pool the Items tab's affix boxes draw from (ItemsTab:UpdateAffixControl),
	-- in force when CanHaveMod holds and the base's spawn weight is above 0, up to the item level.
	function ops.mods_for_base(args)
		if not data.itemBases[args.base] then W.fail("not_found", "no item base " .. tostring(args.base)) end
		if args.type ~= nil and args.type ~= "Prefix" and args.type ~= "Suffix" then W.fail("invalid_input", "type is Prefix or Suffix") end
		local item = new("Item"):Item("Rarity: RARE\nX\n" .. args.base)
		if not item.base or not item.affixes then W.fail("not_found", args.base .. " has no mods to roll") end
		if args.influence ~= nil then
			-- The Influence dropdowns' entries for this item (ItemsTab.lua:2133).
			local eldritch = item.canHaveEldritchInfluence or item.type == "Helmet" or item.type == "Body Armour" or item.type == "Gloves" or item.type == "Boots"
			local key
			for _, info in ipairs(itemLib.influenceInfo[eldritch and "all" or "default"]) do
				if info.display:lower() == args.influence:lower() or info.key == args.influence:lower() then key = info.key end
			end
			if not item.canBeInfluenced or not key then W.fail("invalid_input", args.base .. " cannot take the influence " .. args.influence) end
			item[key] = true
		end
		local ilvl = tonumber(args.ilvl) or 100
		local list = {}
		for id, mod in pairs(item.affixes) do
			if (mod.type == "Prefix" or mod.type == "Suffix") and (args.type == nil or mod.type == args.type) and (mod.level or 0) <= ilvl
				and not item:CheckIfModIsDelve(mod) and item:CanHaveMod(mod) then
				local row = modRow(id, mod)
				row.weight, row.tags = item:GetModSpawnWeight(mod), nil
				if row.weight > 0 and has(row.name, args.query) then list[#list + 1] = row end
			end
		end
		table.sort(list, function(a, b)
			if a.type ~= b.type then return a.type < b.type end
			if a.group ~= b.group then return (a.group or "") < (b.group or "") end
			if a.level ~= b.level then return a.level < b.level end
			return a.id < b.id
		end)
		local out, offset, limit = {}, pageOf(args, 20)
		for i = offset + 1, math.min(#list, offset + limit) do out[#out + 1] = list[i] end
		return { base = args.base, ilvl = ilvl, total = #list, offset = offset, mods = out }
	end

	-- args: lines (the text of mod lines). Each line as the calculator reads it (modLib.parseMod): the mods it makes and the
	-- text left over that it could not read.
	function ops.parse_mod(args)
		local out = array()
		for i, line in ipairs(args.lines) do
			local modList, extra = modLib.parseMod(line)
			local mods = array()
			for _, mod in ipairs(modList or {}) do
				local tags = array()
				for j, tag in ipairs(mod) do tags[j] = W.plain(tag) end
				mods[#mods + 1] = { name = mod.name, type = mod.type, value = W.plain(mod.value), flags = mod.flags, keywordFlags = mod.keywordFlags, tags = tags }
			end
			out[i] = { line = line, mods = mods, extra = extra or W.json.null, supported = modList ~= nil and extra == nil }
		end
		return { lines = out }
	end

	-- The scopes describeStats may load: the one the application's own descriptions use and the one each skill names.
	local statScopes
	-- args: stats ([stat id]: number), scope? (default stat_descriptions). The game text for stat values (data.describeStats).
	function ops.describe_stats(args)
		if not statScopes then
			statScopes = { stat_descriptions = true }
			for _, skill in pairs(data.skills) do
				if skill.statDescriptionScope then statScopes[skill.statDescriptionScope] = true end
			end
		end
		local scope = args.scope or "stat_descriptions"
		if not statScopes[scope] then W.fail("invalid_input", "no stat description scope " .. tostring(scope) .. "; scopes: " .. table.concat(sortedKeys(statScopes), ", ")) end
		local lines = array()
		for i, line in ipairs((data.describeStats(args.stats, scope))) do lines[i] = strip(line) end
		return { scope = scope, lines = lines }
	end

	return ops
end
