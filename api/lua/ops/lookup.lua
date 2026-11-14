-- lookup.* ops: read-only game data (gems, uniques, bases, tree nodes, config options).
return function(W)
	local ops = {}
	local strip = W.strip

	local function limitOf(args, default)
		local n = tonumber(args.limit) or default
		return math.max(1, math.min(200, math.floor(n)))
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
		local out, limit = {}, limitOf(args, 20)
		for i = 1, math.min(#list, limit) do
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
		return { total = #list, gems = out }
	end

	-- args: query? (name), text? (any line of the item text), limit?
	function ops.uniques(args)
		local list = {}
		for name, item in pairs(W.main.uniqueDB.list) do
			if has(name, args.query) and has(item.raw, args.text) then list[#list + 1] = item end
		end
		table.sort(list, function(a, b) return a.name < b.name end)
		local out, limit = {}, limitOf(args, 10)
		for i = 1, math.min(#list, limit) do
			local it = list[i]
			out[#out + 1] = { name = it.name, title = it.title, base = it.baseName, type = it.type, variants = it.variantList and #it.variantList or nil, text = strip(it.raw) }
		end
		return { total = #list, uniques = out }
	end

	-- args: query?, type?, limit?
	function ops.bases(args)
		local list = {}
		for name, base in pairs(data.itemBases) do
			if has(name, args.query) and (args.type == nil or base.type == args.type) then list[#list + 1] = { name = name, base = base } end
		end
		table.sort(list, function(a, b) return a.name < b.name end)
		local out, limit = {}, limitOf(args, 20)
		for i = 1, math.min(#list, limit) do
			local base = W.plain(list[i].base)
			base.name = list[i].name
			out[#out + 1] = base
		end
		return { total = #list, bases = out }
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
		local out, limit = {}, limitOf(args, 25)
		for i = 1, math.min(#list, limit) do out[#out + 1] = nodeBrief(spec, list[i]) end
		return { total = #list, treeVersion = spec.treeVersion, nodes = out }
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

	-- args: section?, query? (var or label), var? (one option, with tooltip), relevantOnly?
	function ops.config(args)
		local b = W.build()
		local varList = require("Modules.ConfigOptions")
		local okVis, vis = pcall(require, "Modules.ConfigVisibility")
		local section
		local out = {}
		for _, v in ipairs(varList) do
			if v.section then section = v.section end
			if v.var and (args.var == nil or v.var == args.var) and (args.section == nil or section == args.section)
				and (has(v.var, args.query) or has(v.label, args.query)) then
				local relevant = nil
				if okVis and vis.isRelevantForBuild then
					local okRel, r = pcall(vis.isRelevantForBuild, v, b)
					relevant = okRel and r and true or false
				end
				if not args.relevantOnly or relevant then
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
		return { total = #out, options = out }
	end

	return ops
end
