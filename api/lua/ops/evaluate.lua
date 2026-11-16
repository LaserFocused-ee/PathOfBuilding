-- evaluate.* ops: what-if calculations, node power, item comparison, gem / anoint / unique ranking and
-- comparisons, through Path of Building's own calculator entry points (calcsTab:GetMiscCalculator,
-- calcsTab:PowerBuilder, GemSelectControl, NotableDBControl, ItemDBControl). Every op leaves the build as it
-- found it: overrides never touch the build, and the few UI fields an entry point needs are put back.
return function(W)
	local main = W.main
	local ops = {}
	local json = W.json

	local function bad(message) W.fail("invalid_input", message) end
	local function object(t) return setmetatable(t, { __jsontype = "object" }) end

	-- Runs f(...) as the host would run a coroutine-driven builder (the item, notable and gem lists yield between
	-- slices of work); here it runs to the end.
	local function drain(f, ...)
		local co = coroutine.create(f)
		local ok, err = coroutine.resume(co, ...)
		while ok and coroutine.status(co) ~= "dead" do ok, err = coroutine.resume(co) end
		if not ok then error(err, 0) end
	end

	-- A power stat by its `stat` name in data.powerStatList ("OffenceDefence" is the combined entry).
	-- `anyOutput`: also any numeric key of the build's output (Minion<key> for the minion's), measured as the list's own entries are
	-- (data.powerStatList.GetFromOutput reads output[stat]), e.g. TotalDotDPS, which the list does not carry.
	local function powerStat(name, anyOutput)
		for _, entry in ipairs(data.powerStatList) do
			if (name == "OffenceDefence" and entry.combinedOffDef) or (entry.stat and entry.stat == name) then return entry end
		end
		if anyOutput and type(name) == "string" then
			local out = main.modes.BUILD.calcsTab.mainOutput or {}
			local minion = name:match("^Minion(.+)")
			local v = minion and out.Minion and out.Minion[minion] or out[name]
			if type(v) == "number" then return { stat = name, label = name } end
		end
		bad("unknown stat " .. tostring(name) .. "; use a stat of the power stat list, e.g. CombinedDPS, FullDPS, TotalEHP, Life" .. (anyOutput and ", or a number of the build's output (e.g. TotalDotDPS)" or ""))
	end

	-- The sidebar values (what the mutation ops diff) of an output table: the sidebar is refreshed with the
	-- calculator's output standing in for the main output, then everything is put back.
	local function sidebarOf(b, output)
		local env = b.calcsTab.mainEnv
		local player, minion = env.player.output, env.minion and env.minion.output
		env.player.output = output
		if env.minion then env.minion.output = output.Minion or {} end
		local ok, res = pcall(W.sidebarValues, b)
		env.player.output = player
		if env.minion then env.minion.output = minion end
		if not ok then error(res, 0) end
		return res
	end

	local function fieldsOf(args)
		if args.fields == nil then return nil end
		if type(args.fields) ~= "table" then bad("fields is a list of output keys") end
		return #args.fields > 0 and args.fields or nil
	end

	-- Sidebar values, or the output keys in `fields` ("Minion.<key>" reads the minion's output).
	local function values(b, output, fields)
		if not fields then return sidebarOf(b, output) end
		local out = {}
		for _, k in ipairs(fields) do
			local src, key = output, k
			local minionKey = type(k) == "string" and k:match("^Minion%.(.+)$")
			if minionKey then src, key = output.Minion or {}, minionKey end
			local v = type(key) == "string" and src[key]
			if type(v) == "number" or type(v) == "boolean" or type(v) == "string" then out[k] = v end
		end
		return out
	end

	local function diff(before, after)
		local changed = object({})
		for k, v in pairs(after) do
			if before[k] ~= v then changed[k] = { before = before[k] == nil and json.null or before[k], after = v } end
		end
		for k, v in pairs(before) do
			if after[k] == nil then changed[k] = { before = v, after = json.null } end
		end
		return changed
	end

	-- CalcSetup adds and drops the skill groups an item grants (Shattershard's skill, Asenath's curses) only in its MAIN
	-- pass, so a calculator call that swaps an item would keep the old item's granted skills: they are switched off for
	-- the call. ponytail: the new item's own granted skills are not added (PoB's calculator leaves them out too).
	local function calculator(b)
		local calcFunc, calcBase = b.calcsTab:GetMiscCalculator()
		return function(o, ...)
			local off = {}
			if o and o.repSlotName then
				for _, g in ipairs(b.skillsTab.socketGroupList) do
					if g.sourceItem and g.enabled and g.slot == o.repSlotName and g.sourceItem ~= o.repItem then
						off[#off + 1], g.enabled = g, false
					end
				end
			end
			local ok, res = pcall(calcFunc, o, ...)
			for _, g in ipairs(off) do g.enabled = true end
			if not ok then error(res, 0) end
			return res
		end, calcBase
	end

	-- The damage over time cap (data.misc.DotDpsCap): TotalDot, TotalDotDPS and the figures built on them (CombinedDPS,
	-- FullDPS) stop there, so gains past it read 0. Named when the build's output is at it; the per-type DoT figures
	-- (ChaosDot, FireDot, ...: one instance, before the skill's DPS multipliers) are not capped and still measure.
	local dotKeys = { "TotalDot", "TotalDotDPS", "FullDotDPS", "TotalPoisonDPS", "IgniteDPS", "BleedDPS" }
	local function dotCapOf(output)
		local at = {}
		for _, k in ipairs(dotKeys) do
			if type(output[k]) == "number" and output[k] >= data.misc.DotDpsCap then at[#at + 1] = k end
		end
		if #at == 0 then return nil end
		local raw = {}
		for _, t in ipairs({ "Physical", "Lightning", "Cold", "Fire", "Chaos" }) do
			if type(output[t .. "Dot"]) == "number" and output[t .. "Dot"] > 0 then raw[#raw + 1] = t .. "Dot" end
		end
		return { cap = data.misc.DotDpsCap, at = setmetatable(at, { __jsontype = "array" }), uncapped = setmetatable(raw, { __jsontype = "array" }) }
	end

	-- A passive node by id or exact name.
	local function nodeOf(spec, ref)
		if type(ref) == "string" and ref:match("^%d+$") then ref = tonumber(ref) end
		if type(ref) == "number" then
			return spec.nodes[ref] or bad("no passive node " .. ref)
		end
		if type(ref) ~= "string" or ref == "" then bad("a node is an id or an exact name") end
		local found
		for _, node in pairs(spec.nodes) do
			if node.dn == ref and node.type ~= "Mastery" then
				if found then bad("more than one node is named " .. ref .. "; use its id") end
				found = node
			end
		end
		return found or bad("no passive node named " .. ref)
	end

	local function nodeSet(spec, list)
		if type(list) ~= "table" then bad("nodes are a list of ids or exact names") end
		local set = {}
		for _, ref in ipairs(list) do set[nodeOf(spec, ref)] = true end
		return set
	end

	local function slotOf(tab, name, sockets)
		local slot = tab.slots[name]
		if not slot then bad("no item slot " .. tostring(name)) end
		if slot.nodeId and not sockets then bad("jewel sockets are not evaluated here (compare_item takes a jewel socket)") end
		if slot.nodeId then tab:UpdateSockets() end
		return slot
	end

	-- The slot as the Items tab compares in it: in the active item set and weapon set, and shown.
	local function slotInUse(tab, slot)
		return not slot.inactive and (not slot.weaponSet or slot.weaponSet == (tab.activeItemSet.useSecondWeaponSet and 2 or 1)) and slot.shown()
	end

	-- ponytail: the conquerors the Tree tab's timeless search offers per jewel (TreeTab.lua conquerorTypes), copied
	-- because that table is local to the tab; ModParser's conquerorList also reads the retired fourth of each.
	local timelessConquerors = {
		["Glorious Vanity"] = "Doryani, Xibaqua, Ahuana", ["Lethal Pride"] = "Kaom, Rakiata, Akoya",
		["Brutal Restraint"] = "Asenath, Nasima, Balbala", ["Militant Faith"] = "Avarius, Dominus, Maxarius",
		["Elegant Hubris"] = "Cadiro, Victario, Caspiro", ["Heroic Tragedy"] = "Vorana, Uhtred, Medved",
	}

	-- An item by id (item list) or from its text, as Add from the Items tab reads it.
	local function itemOf(tab, args)
		if args.text ~= nil then
			if type(args.text) ~= "string" or not args.text:match("%S") then bad("text is the item's text") end
			local text = args.text
			-- a bare base name ("Painted Tower Shield") is that base with no mods, as a Normal item
			if not text:find("\n") and not text:match("^%s*Rarity:") then text = "Rarity: NORMAL\n" .. text:match("^%s*(.-)%s*$") end
			local item = new("Item"):Item(W.withUniqueRadius(text))
			if not item.base then bad("Path of Building could not read this item (unknown base?)") end
			item:NormaliseQuality()
			item:BuildModList()
			if item.base.subType == "Timeless" and not (item.jewelData and item.jewelData.conqueredBy) then
				local names = timelessConquerors[item.title]
				bad("Path of Building reads no conqueror on this timeless jewel (its seed line names none it knows), so it would change nothing"
					.. (names and ("; " .. item.title .. " names one of " .. names) or ""))
			end
			return item
		end
		if args.item == nil then bad("an item (id) or its text is required") end
		return tab.items[tonumber(args.item)] or bad("no item " .. tostring(args.item))
	end

	local function equippedIn(tab, slot)
		local item = slot.selItemId and tab.items[slot.selItemId]
		return item and W.strip(item.name) or json.null
	end

	-- ItemsTab.lua itemChangesPassiveTree (the tooltip then rebuilds the tree to compare), and cluster jewels, whose passives are
	-- a part of the tree the calculator's override does not build.
	local function changesTree(item)
		return item and item.type == "Jewel" and (item.clusterJewel or (item.jewelData and (item.jewelData.conqueredBy
			or item.jewelRadiusIndex and (item.jewelData.intuitiveLeapLike or item.jewelData.impossibleEscapeKeystone)))) and true or false
	end

	-- args: addNodes?, removeNodes? (node ids or exact names), slot? with item? (id) or text?, toggleFlask? / toggleTincture? (slot),
	-- conditions? (names), fields?. The calculator's override with all of them at once.
	function ops.what_if(args)
		local b = W.build()
		local tab = b.itemsTab
		local override = {}
		if args.addNodes ~= nil then
			override.addNodes = nodeSet(b.spec, args.addNodes)
			-- another ascendancy's (or class's) node has no path; the calculator would leave it out and answer nothing
			for node in pairs(override.addNodes) do
				-- the calculator would apply a mastery's stats with no effect chosen (a phantom figure)
				if node.type == "Mastery" and not node.alloc then
					bad(W.strip(node.dn) .. " (" .. node.id .. ") is a mastery: pick its effect with tree set_mastery (effects: tree mastery_options) on a copy, then measure the copy")
				end
				if not node.alloc and not node.path then
					bad(W.strip(node.dn) .. " (" .. node.id .. ") cannot be reached from the tree" .. (node.ascendancyName and (": it is a node of " .. node.ascendancyName .. ", not of this build's ascendancy") or ""))
				end
			end
		end
		if args.removeNodes ~= nil then
			override.removeNodes = nodeSet(b.spec, args.removeNodes)
			local granted = b.calcsTab.mainEnv and b.calcsTab.mainEnv.grantedPassives or {}
			for node in pairs(override.removeNodes) do
				local name = W.strip(node.dn) .. " (" .. node.id .. ")"
				if not node.alloc and not granted[node.id] then bad(name .. " is not allocated, nor granted by an item") end
				local socket = node.alloc and tab.sockets[node.id]
				local jewel = socket and socket.selItemId and tab.items[socket.selItemId]
				if changesTree(jewel) then
					bad(name .. " holds a cluster, timeless or radius-changing jewel, which rebuilds the tree: the calculator would keep its effect; compare_item measures the socket without it")
				end
			end
		end
		if args.slot ~= nil then
			local slot = slotOf(tab, args.slot, true)
			local item = itemOf(tab, args)
			if not tab:IsItemValidForSlot(item, args.slot) then bad("this item does not fit " .. args.slot) end
			-- a jewel goes in an allocated socket or one addNodes allocates; one that rebuilds the tree is compare_item's
			local added = slot.nodeId and override.addNodes and override.addNodes[b.spec.nodes[slot.nodeId]]
			if not (slotInUse(tab, slot) or added) then bad(args.slot .. " is not in use (weapon set or socket not active; a socket can be allocated with addNodes)") end
			if slot.nodeId and (changesTree(item) or changesTree(slot.selItemId and tab.items[slot.selItemId])) then
				bad("a cluster, timeless or radius-changing jewel rebuilds the tree: compare_item measures it in its socket")
			end
			override.repSlotName, override.repItem = args.slot, item
		elseif args.item ~= nil or args.text ~= nil then
			bad("an item needs the slot it goes in")
		end
		for field, key in pairs({ toggleFlask = "flask", toggleTincture = "tincture" }) do
			if args[field] ~= nil then
				local slot = slotOf(tab, args[field])
				local item = slot.selItemId and tab.items[slot.selItemId]
				if not (item and item.base[key]) then bad(tostring(args[field]) .. " holds no " .. key) end
				override[field] = item
			end
		end
		if args.conditions ~= nil then
			if type(args.conditions) ~= "table" then bad("conditions is a list of condition names") end
			override.conditions = args.conditions
		end
		if next(override) == nil then bad("nothing to evaluate: give nodes, an item for a slot, a flask, a tincture or conditions") end
		local fields = fieldsOf(args)
		local rawCalc, calcBase = calculator(b)
		-- CalcSetup leaves out a node granted by an item (anoint, Forbidden Flame/Flesh) when removeNodes[node.id] is set,
		-- but an allocated node when removeNodes[node] is: the set passed on carries both keys.
		local function calcFunc(o)
			if not o.removeNodes then return rawCalc(o) end
			local c, both = {}, {}
			for k, v in pairs(o) do c[k] = v end
			for node in pairs(o.removeNodes) do both[node], both[node.id] = true, true end
			c.removeNodes = both
			return rawCalc(c)
		end
		-- a removal takes the nodes that depend on it too, as deallocating does (the tree's hover shows the same)
		local asked = override.removeNodes
		if asked then
			override.removeNodes = {}
			for node in pairs(asked) do
				for _, n in ipairs(node.alloc and node.depends or { node }) do override.removeNodes[n] = true end
				override.removeNodes[node] = true
			end
		end
		local before = values(b, calcBase, fields)
		local res = { changed = diff(before, values(b, calcFunc(override), fields)), dotCap = dotCapOf(calcBase) }
		-- As the tree's hover: a node to add brings the path that reaches it, a node to remove the nodes that depend on it.
		-- `withPaths` is the same evaluation with those, `points` the nodes it adds or removes.
		if override.addNodes or asked then
			local wide, paths, extra = {}, {}, false
			local sets = { addNodes = override.addNodes, removeNodes = asked }
			for key, list in pairs({ addNodes = "path", removeNodes = "depends" }) do
				if sets[key] then
					wide[key] = {}
					for node in pairs(sets[key]) do
						local chain = (key == "addNodes" and not node.alloc and W.allocPath(node)) or (key == "removeNodes" and node.alloc and node.depends) or { node }
						local names = {}
						for _, n in ipairs(chain) do
							wide[key][n] = true
							names[#names + 1] = { id = n.id, name = W.strip(n.dn) }
						end
						if #chain > 1 then extra = true end
						paths[#paths + 1] = { node = node.id, name = W.strip(node.dn), kind = list, points = #chain, nodes = setmetatable(names, { __jsontype = "array" }) }
					end
				end
			end
			table.sort(paths, function(x, y) return x.node < y.node end)
			res.paths = setmetatable(paths, { __jsontype = "array" })
			if extra then
				local o = {}
				for k, v in pairs(override) do o[k] = v end
				o.addNodes, o.removeNodes = wide.addNodes, wide.removeNodes
				local points = 0
				for _, set in pairs(wide) do for _ in pairs(set) do points = points + 1 end end
				res.withPaths = { changed = diff(before, values(b, calcFunc(o), fields)), points = points }
			end
		end
		return res
	end

	-- args: stat, depth? (largest path distance; default 10, the whole tree can outlast the worker timeout), limit?, offset?.
	-- PowerBuilder fills node.power for every node; allocated nodes report what removing them changes. A mastery
	-- is listed once per effect it can take. Cluster jewel notables are not listed.
	function ops.node_power(args)
		local b = W.build()
		local tab = b.calcsTab
		local stat = powerStat(args.stat, true)
		local depth = args.depth == nil and 10 or tonumber(args.depth)
		if not depth or depth < 1 then bad("depth is a path distance of 1 or more") end
		local limit, offset = math.min(tonumber(args.limit) or 20, 2000), math.max(tonumber(args.offset) or 0, 0)
		local savedStat, savedDepth, savedMax, savedInit = tab.powerStat, tab.nodePowerMaxDepth, tab.powerMax, tab.powerBuilderInitialized
		tab.powerStat, tab.nodePowerMaxDepth = stat, depth
		local ok, err = pcall(tab.PowerBuilder, tab)
		tab.powerStat, tab.nodePowerMaxDepth, tab.powerMax, tab.powerBuilderInitialized = savedStat, savedDepth, savedMax, savedInit
		if not ok then error(err, 0) end
		local combined = stat.stat == nil
		local list = {}
		local function add(node, name, p, dist)
			if p.singleStat == nil then return end
			list[#list + 1] = { id = node.id, name = W.strip(name), type = node.type, allocated = node.alloc == true, pathDist = dist,
				power = p.singleStat, pathPower = p.pathPower, perPoint = p.pathPower and p.pathPower / dist, defence = combined and p.defence or nil }
		end
		for _, node in pairs(b.spec.nodes) do
			if not node.ascendancyName and node.power then
				local dist = node.alloc and math.max(#(node.depends or {}), 1) or node.power.distance or node.pathDist or math.max(#(node.path or {}), 1)
				if node.type == "Normal" or node.type == "Keystone" or node.type == "Notable" then
					add(node, node.dn, node.power, dist)
				elseif node.type == "Mastery" and node.power.masteryEffects then
					for _, effect in ipairs(node.masteryEffects or {}) do
						local p = node.power.masteryEffects[effect.effect]
						local def = b.spec.tree.masteryEffects[effect.effect]
						if p and def then add(node, node.dn .. ": " .. table.concat(def.stats or def.sd or {}, " / "), p, dist) end
					end
				end
			end
		end
		table.sort(list, function(x, y)
			if x.power ~= y.power then return x.power > y.power end
			return x.id < y.id
		end)
		local page = {}
		for i = offset + 1, math.min(offset + limit, #list) do page[#page + 1] = list[i] end
		return { stat = args.stat, total = #list, offset = offset, nodes = page, dotCap = dotCapOf(b.calcsTab.mainOutput) }
	end

	-- args: candidates? (node ids or exact names; default every unallocated passive next to the allocated tree), fields?,
	-- sortBy? (an output key: largest gain first), limit?, offset?. Each candidate is scored on its own with the path
	-- that reaches it (as the tree's hover does), through the calculator; the build is not changed.
	local maxCandidates = 200 -- ponytail: one full calculation each, within the worker's time for a call
	function ops.passives(args)
		local b = W.build()
		local spec = b.spec
		local list, skipped = {}, setmetatable({}, { __jsontype = "array" })
		if args.candidates ~= nil then
			if type(args.candidates) ~= "table" or #args.candidates == 0 then bad("candidates is a list of node ids or exact names") end
			-- a candidate that cannot be scored is listed in skipped with the reason; the others are scored
			for _, ref in ipairs(args.candidates) do
				local node = nodeOf(spec, ref)
				local reason = (node.alloc and "allocated already") or (node.type == "Mastery" and "a mastery: score its effects with node_power or what_if")
					or ((not node.path or #node.path == 0) and "cannot be reached from the allocated tree") or nil
				if reason then skipped[#skipped + 1] = { id = node.id, name = W.strip(node.dn), reason = reason } else list[#list + 1] = node end
			end
			if #list == 0 then bad("no candidate can be scored: " .. skipped[1].name .. " is " .. skipped[1].reason .. (#skipped > 1 and (", and " .. (#skipped - 1) .. " more") or "")) end
		else
			for _, node in pairs(spec.nodes) do
				if not node.alloc and not node.ascendancyName and node.pathDist == 1 and node.path
					and (node.type == "Normal" or node.type == "Notable" or node.type == "Keystone") then
					list[#list + 1] = node
				end
			end
		end
		if #list > maxCandidates then bad(#list .. " candidates; at most " .. maxCandidates .. " per call") end
		local fields = fieldsOf(args)
		local sortBy = args.sortBy
		if sortBy ~= nil and type(sortBy) ~= "string" then bad("sortBy is an output key") end
		local calcFunc, calcBase = calculator(b)
		local base = values(b, calcBase, fields)
		if sortBy and fields and base[sortBy] == nil then bad("sortBy " .. sortBy .. " is not one of the fields") end
		local scored = {}
		for _, node in ipairs(list) do
			local add = {}
			local path = W.allocPath(node)
			for _, n in ipairs(path) do add[n] = true end
			local changed = diff(base, values(b, calcFunc({ addNodes = add }), fields))
			local gain = 0
			local c = sortBy and changed[sortBy]
			if c and type(c.after) == "number" then gain = c.after - (type(c.before) == "number" and c.before or 0) end
			scored[#scored + 1] = { id = node.id, name = W.strip(node.dn), type = node.type, points = #path, changed = changed, gain = sortBy and gain or nil }
		end
		table.sort(scored, function(x, y)
			if sortBy and x.gain ~= y.gain then return x.gain > y.gain end
			return x.id < y.id
		end)
		local limit, offset = math.min(tonumber(args.limit) or 50, maxCandidates), math.max(tonumber(args.offset) or 0, 0)
		local page = {}
		for i = offset + 1, math.min(offset + limit, #scored) do page[#page + 1] = scored[i] end
		return { total = #scored, offset = offset, sortBy = sortBy, candidates = page, skipped = #skipped > 0 and skipped or nil }
	end

	-- args: item (id) or text, slot? (default every slot it fits), fields?. The item in each slot in place of what it holds.

	-- Equips a copy of `item` in the socket for real (a cluster jewel's passives built and all allocated, the path to them too),
	-- recalculates, and loads the build back from its own XML so it is left as it was. Answers measure(build, output) and the
	-- passive points the jewel cost beyond the current tree.
	local function inSocket(b, slot, item, measure)
		local xml, name = b:SaveDB("code"), b.buildName
		local used = b.spec:CountAllocNodes()
		local ok, res = pcall(function()
			local tab = b.itemsTab
			local copy = new("Item"):Item(item:BuildRaw())
			tab:AddItem(copy, true)
			tab.slots[slot.slotName]:SetSelItemId(copy.id)
			tab:PopulateSlots()
			local spec = b.spec
			if copy.clusterJewel then
				for _, sub in pairs(spec.subGraphs) do
					if sub.parentSocket.id == slot.nodeId then
						for _, node in ipairs(sub.nodes) do
							local live = node.id and spec.nodes[node.id]
							if live and live.type ~= "Socket" and not live.alloc then spec:AllocNode(live) end
						end
					end
				end
			end
			b.buildFlag = true
			W.pump()
			b = W.build()
			return { measure(b, b.calcsTab.mainOutput), b.spec:CountAllocNodes() - used }
		end)
		main:SetMode("BUILD", false, name, xml, true)
		W.pump()
		if not ok then error(res, 0) end
		return res[1], res[2]
	end

	local function statWeightsOf(args)
		if args.weights == nil then return { { stat = "FullDPS", weightMult = 1.0 }, { stat = "TotalEHP", weightMult = 0.5 } } end
		if type(args.weights) ~= "table" or #args.weights == 0 then bad("weights is a list of { stat, weight }") end
		local out = {}
		for _, w in ipairs(args.weights) do
			-- any number of the build's output weighs (GetFromOutput reads output[stat], MinionX from output.Minion)
			local entry = powerStat(type(w) == "table" and w.stat or nil, true)
			if not entry.stat or entry.ignoreForItems then bad("stat " .. tostring(w.stat) .. " cannot weigh items") end
			local mult = tonumber(w.weight)
			if not mult or mult < 0.01 or mult > 1 then bad("a weight is from 0.01 to 1 (the popup's slider)") end
			out[#out + 1] = { stat = entry.stat, label = entry.label, transform = entry.transform, weightMult = mult }
		end
		return out
	end

	local function rounded(v) return math.floor(v * 1000 + 0.5) / 1000 end

	-- A trade fetch entry as item text, by Path of Building's own conversion (TradeQueryRequests:FetchResultBlock).
	local function listingText(entry, requests)
		requests = requests or new("TradeQueryRequests"):TradeQueryRequests({})
		local text
		requests:FetchResultBlock("", function(items) text = items and items[1] and items[1].item_string end)
		table.remove(requests.requestQueue.fetch, 1).callback(json.encode({ result = { entry } }), nil)
		return text
	end

	-- The trade search's weighing (TradeQueryGenerator.WeightedRatioOutputs, default Full DPS 1, Effective Hit Pool 0.5) of an
	-- output against the build's: gain(output) is the weighted change x1000. One place for listings and compare_item.
	local function gainOf(calcBase, statWeights)
		new("TradeQueryGenerator") -- loads the class; its WeightedRatioOutputs is a plain function of the class table
		local weigh = common.classes.TradeQueryGenerator.WeightedRatioOutputs
		local base = weigh(calcBase, calcBase, statWeights)
		return function(output) return rounded((weigh(calcBase, output, statWeights) - base) * 1000) end
	end

	-- args: item (id), text or entry (a trade fetch entry, converted by the server from a listing): exactly one; slot?, weights?, fields?.
	function ops.compare_item(args)
		local given = (args.item ~= nil and 1 or 0) + (args.text ~= nil and 1 or 0) + (args.entry ~= nil and 1 or 0)
		if given ~= 1 then bad("give exactly one of item (id), text and listing") end
		local b = W.build()
		local tab = b.itemsTab
		local text
		if args.entry ~= nil then
			if type(args.entry) ~= "table" then bad("listing is one trade listing") end
			local ok, t = pcall(listingText, args.entry)
			if not ok or not t then bad("Path of Building could not read this listing") end
			if #t > 20000 then bad("the listing's item text is longer than 20000 characters, the limit for text") end
			text = W.strip(t)
			args = { text = t, slot = args.slot, weights = args.weights, fields = args.fields }
		end
		local item = itemOf(tab, args)
		if item.base.flask or item.base.tincture then bad("flasks and tinctures are compared with what_if (toggleFlask / toggleTincture)") end
		local slots = {}
		if args.slot ~= nil then
			local slot = slotOf(tab, args.slot, true)
			if not tab:IsItemValidForSlot(item, args.slot) then bad("this item does not fit " .. args.slot) end
			if not slotInUse(tab, slot) then bad(args.slot .. " is not in use (weapon set or socket not active)") end
			slots[1] = slot
		else
			for _, slot in ipairs(tab.orderedSlots) do
				if not slot.nodeId and tab:IsItemValidForSlot(item, slot.slotName) and slotInUse(tab, slot) then slots[#slots + 1] = slot end
			end
			if #slots == 0 then bad("this item fits no equipment slot in use (a jewel is compared in the tree socket named by slot, e.g. Jewel 26725)") end
		end
		local fields = fieldsOf(args)
		local calcFunc, calcBase = calculator(b)
		local before = values(b, calcBase, fields)
		local gainOfOutput = gainOf(calcBase, statWeightsOf(args))
		local out = {}
		for _, slot in ipairs(slots) do
			if slot.nodeId and (changesTree(item) or changesTree(slot.selItemId and tab.items[slot.selItemId])) then
				local equipped = equippedIn(tab, slot)
				local now = values(b, b.calcsTab.mainOutput, fields)
				local row, points = inSocket(b, slot, item, function(nb, output) return { changed = diff(now, values(nb, output, fields)), gain = gainOfOutput(output) } end)
				out[#out + 1] = { slot = slot.slotName, equipped = equipped, changed = row.changed, gain = row.gain, points = points }
				b = W.build()
				tab = b.itemsTab
			else
				local output = calcFunc({ repSlotName = slot.slotName, repItem = item })
				out[#out + 1] = { slot = slot.slotName, equipped = equippedIn(tab, slot), changed = diff(before, values(b, output, fields)), gain = gainOfOutput(output) }
			end
		end
		for i, row in ipairs(out) do row.order = i end
		table.sort(out, function(x, y)
			if x.gain ~= y.gain then return x.gain > y.gain end
			return x.order < y.order
		end)
		for _, row in ipairs(out) do row.order = nil end
		return { text = text, slots = out, dotCap = dotCapOf(calcBase) }
	end

	-- The gem box lists these fields (SkillsTab.lua sortGemTypeList).
	local gemFields = { FullDPS = true, CombinedDPS = true, TotalDPS = true, AverageDamage = true, TotalDot = true, BleedDPS = true,
		IgniteDPS = true, TotalPoisonDPS = true, TotalEHP = true }

	-- args: group, gem? (position the candidate goes into; default one past the last), stat, limit?, support? (default true: only
	-- support gems that support the group's skills; false adds active gems with global effects). The group's gem box
	-- calculates every candidate in that position; value is the stat with that gem (the box's own number).
	function ops.gem_rank(args)
		local b = W.build()
		local tab = b.skillsTab
		local g = tab.socketGroupList[args.group] or bad("no socket group " .. tostring(args.group))
		if g.source then bad("this socket group comes from an item and cannot be edited") end
		if not gemFields[args.stat] then bad("stat is one of the gem box's fields: " .. "FullDPS, CombinedDPS, TotalDPS, AverageDamage, TotalDot, BleedDPS, IgniteDPS, TotalPoisonDPS, TotalEHP") end
		local pos = args.gem == nil and #g.gemList + 1 or tonumber(args.gem)
		if not pos or pos < 1 or pos > #g.gemList + 1 then bad("no gem position " .. tostring(args.gem)) end
		local supportOnly = args.support ~= false
		local limit = math.min(tonumber(args.limit) or 20, 200)
		local origGroup, origField = tab.displayGroup, tab.sortGemsByDPSField
		local held = g.gemList[pos]
		local heldGem, heldLevel, heldEffect = held and held.gemData, held and held.level, held and held.displayEffect
		-- Calculating a candidate writes back onto the group's gems (CalcActiveSkill.lua: skillMinion, skillPart and the like
		-- for the minion, part, stage and mine choices). The box calculates in pairs order, so the last candidate decides what is
		-- left on the real gems; each gem is put back field by field so the build code is the one it was.
		local saved = {}
		for _, group in ipairs(tab.socketGroupList) do
			for _, gem in pairs(group.gemList) do
				local copy = {}
				for k, v in pairs(gem) do copy[k] = v end
				saved[#saved + 1] = { gem, copy }
			end
		end
		local list, base
		local ok, err = pcall(function()
			tab.sortGemsByDPSField = args.stat
			tab:SetDisplayGroup(g)
			local box = tab.gemSlots[pos].nameSpec
			box:UpdateSortCache()
			box:BuildList("") -- the dropdown opening builds its list before its DPS builder runs
			if box.sortCache.pendingGems then drain(box.DPSBuilder, box) end
			box.dpsBuildFlag = false
			local cache = box.sortCache
			base, list = cache.baseDPS, {}
			for gemId, gemData in pairs(box.gems) do
				if cache.canSupport[gemId] or (not supportOnly and gemData.grantedEffect.hasGlobalEffect and not gemData.grantedEffect.support) then
					list[#list + 1] = { name = gemData.name, value = cache.dps[gemId] }
				end
			end
		end)
		if held then
			held.gemData, held.level, held.displayEffect = heldGem, heldLevel, heldEffect
		else
			g.gemList[pos] = nil
		end
		for _, entry in ipairs(saved) do
			local gem, copy = entry[1], entry[2]
			for k in pairs(gem) do gem[k] = nil end
			for k, v in pairs(copy) do gem[k] = v end
		end
		tab.sortGemsByDPSField = origField
		tab:SetDisplayGroup(origGroup)
		if not ok then error(err, 0) end
		table.sort(list, function(x, y)
			if x.value ~= y.value then return x.value > y.value end
			return x.name < y.name
		end)
		local out = {}
		for i = 1, math.min(limit, #list) do out[i] = list[i] end
		return { stat = args.stat, base = base, total = #list, gems = out }
	end

	-- Runs f(control) on a list control in the shape the Items tab uses it: sorted by the power stat through its own
	-- ListBuilder, which measures every entry with the calculator.
	local function sortedBy(control, stat)
		control:SetSortMode(stat)
		if not (control.sortDetail and control.sortDetail.stat == stat) then
			bad("stat " .. tostring(stat) .. " is not one this list sorts by (the combined Offence/Defence entry and Name are not)")
		end
		drain(control.ListBuilder, control)
		return control.list
	end

	-- args: item (id) or slot (an anointable item's slot), stat, limit?. The Anoint popup's notable list, sorted by the stat the
	-- item gains (against the item with its first anoint removed).
	function ops.anoint_rank(args)
		local b = W.build()
		local tab = b.itemsTab
		powerStat(args.stat)
		local item
		if args.slot ~= nil then
			local slot = slotOf(tab, args.slot)
			item = slot.selItemId and tab.items[slot.selItemId] or bad(args.slot .. " holds no item")
		else
			item = itemOf(tab, { item = args.item })
		end
		local limit = math.min(tonumber(args.limit) or 20, 200)
		local prevDisplay, prevSlot = tab.displayItem, tab.anointEnchantSlot
		local copy = new("Item"):Item(item:BuildRaw())
		copy.id = item.id
		tab:SetDisplayItem(copy)
		local out, total
		local ok, err = pcall(function()
			if not tab.controls.displayItemAnoint:IsShown() then bad("this item cannot be anointed") end
			tab:AnointDisplayItem(1)
			local list = sortedBy(main.popups[1].controls.notableDB, args.stat)
			total, out = #list, {}
			for i = 1, math.min(limit, #list) do out[i] = { name = W.strip(list[i].dn), power = list[i].measuredPower or 0 } end
		end)
		if main.popups[1] then main:ClosePopup() end
		tab:SetDisplayItem(prevDisplay)
		tab.anointEnchantSlot = prevSlot
		if not ok then error(err, 0) end
		local current = setmetatable({}, { __jsontype = "array" })
		for i, name in ipairs(tab:getAnoint(item) or {}) do current[i] = W.strip(name) end
		return { stat = args.stat, total = total, current = current, notables = out }
	end

	-- A jewel socket: a tree socket (node id or "Jewel <id>") or an item's abyssal socket slot; by default the first allocated tree
	-- socket that holds no jewel and takes `probe`.
	local function socketOf(tab, ref, probe)
		tab:UpdateSockets()
		local slot
		if ref ~= nil then
			slot = tab.slots[tostring(ref)] or tab.slots["Jewel " .. tostring(ref)]
			if not slot or not (slot.nodeId or slot.slotName:find("Abyssal")) then bad("no jewel socket " .. tostring(ref)) end
		else
			for pass = 1, 2 do -- regular sockets before cluster sockets
				for _, s in ipairs(tab.orderedSlots) do
					if not slot and s.nodeId and s.selItemId == 0 and slotInUse(tab, s) and tab:IsItemValidForSlot(probe, s.slotName)
						and (pass == 2 or not tab.build.spec.nodes[s.nodeId].expansionJewel) then slot = s end
				end
			end
			if not slot then bad("the tree has no allocated empty socket this jewel fits; allocate one or name a socket") end
		end
		if not slotInUse(tab, slot) then bad(slot.slotName .. " is not in use (socket not allocated or its item has no such socket)") end
		if not tab:IsItemValidForSlot(probe, slot.slotName) then bad("this jewel does not fit " .. slot.slotName) end
		return slot
	end

	-- args: slot, stat, limit?, socket? (slot Jewel). The unique database list filtered to the slot and sorted by the stat the unique
	-- gives (its best slot; power is the stat's value with the unique equipped). For jewels the list measures every allocated socket,
	-- so the best slot is often the socket whose jewel matters least and power reads close to the build's own; here only one socket
	-- is measured: `socket`, else the first allocated empty one (all sockets only when none is empty). `socket` in the answer.
	function ops.unique_rank(args)
		local b = W.build()
		local control = b.itemsTab.controls.uniqueDB
		if main.uniqueDB.loading then W.fail("worker_error", "the unique list is still loading") end
		local stat = powerStat(args.stat)
		if type(args.slot) ~= "string" then bad("slot is an item slot, e.g. Helmet, Ring 1, Weapon 1") end
		local filter
		for i, name in ipairs(control.slotList) do
			if i > 1 and (name == args.slot or name == args.slot:gsub(" %d", "")) then filter = i end
		end
		if not filter then bad("the unique list has no slot " .. args.slot .. "; use " .. table.concat(control.slotList, ", ", 2)) end
		if not stat.stat or stat.ignoreForItems then bad("stat " .. args.stat .. " cannot rank items") end
		local limit = math.min(tonumber(args.limit) or 20, 200)
		local tab = b.itemsTab
		local socket, parked = json.null, {}
		if args.slot == "Jewel" then
			local probe = new("Item"):Item("Rarity: RARE\nProbe\nCobalt Jewel")
			local found, slot = pcall(socketOf, tab, args.socket, probe)
			if not found and args.socket ~= nil then error(slot, 0) end
			if found then
				socket = slot.slotName
				for _, s in pairs(tab.slots) do
					if s.nodeId and s ~= slot and not s.inactive then s.inactive = true; parked[#parked + 1] = s end
				end
			end
		elseif args.socket ~= nil then bad("socket is for slot Jewel") end
		local slotDrop = control.controls.slot
		local prevSel, prevMode, prevList = slotDrop.selIndex, control.sortMode, control.list
		slotDrop.selIndex = filter
		local out, total
		local ok, err = pcall(function()
			local list = sortedBy(control, args.stat)
			local ranked = {}
			for _, item in ipairs(list) do
				local p = item.measuredPower
				if type(p) == "number" and p > -math.huge and p < math.huge then ranked[#ranked + 1] = { name = W.strip(item.name), power = p } end
			end
			total, out = #ranked, {}
			for i = 1, math.min(limit, #ranked) do out[i] = ranked[i] end
		end)
		for _, s in ipairs(parked) do s.inactive = false end
		slotDrop.selIndex = prevSel
		control:SetSortMode(prevMode)
		control.list = prevList
		if not ok then error(err, 0) end
		return { stat = args.stat, total = total, socket = socket, uniques = out }
	end

	-- args: a? (tree list index; default the active tree), b, fields?. b's tree against a's (the calculator's spec override).
	function ops.compare_specs(args)
		local b = W.build()
		local list = b.treeTab.specList
		local function specAt(i, name)
			if i == nil and name == "a" then return b.spec end
			return list[tonumber(i)] or bad("no tree " .. tostring(i) .. " for " .. name)
		end
		local specA, specB = specAt(args.a, "a"), specAt(args.b, "b")
		local fields = fieldsOf(args)
		local calcFunc = calculator(b)
		return { changed = diff(values(b, calcFunc({ spec = specA }), fields), values(b, calcFunc({ spec = specB }), fields)) }
	end

	-- args: a? (item set index; default the active set), b, fields?. There is no calculator override for item sets: each set is
	-- made the active one with the Items tab's own function, calculated (a fresh calculator's base output), and the active set
	-- is put back.
	function ops.compare_item_sets(args)
		local b = W.build()
		local tab = b.itemsTab
		local function setId(i, name)
			if i == nil and name == "a" then return tab.activeItemSetId end
			return tab.itemSetOrderList[tonumber(i)] or bad("no item set " .. tostring(i) .. " for " .. name)
		end
		local idA, idB = setId(args.a, "a"), setId(args.b, "b")
		local fields = fieldsOf(args)
		local prevId, prevFlag = tab.activeItemSetId, b.buildFlag
		local function outputWith(id)
			if tab.activeItemSetId ~= id then tab:SetActiveItemSet(id) end
			local _, base = b.calcsTab.calcs.getMiscCalculator(b)
			return values(b, base, fields)
		end
		local ok, a, c = pcall(function() return outputWith(idA), outputWith(idB) end)
		if tab.activeItemSetId ~= prevId then tab:SetActiveItemSet(prevId) end
		b.buildFlag = prevFlag
		if not ok then error(a, 0) end
		return { changed = diff(a, c) }
	end

	-- Jewels for this build through Path of Building's trade weighting (TradeQueryGenerator.lua). The generator is driven as its
	-- Execute button drives it, minus the popup: StartQuery sets up the calculation against the socket with a blank test item,
	-- ExecuteQuery weighs every mod the jewel can have (run to the end here), FinishQuery builds the trade search. Defaults are the
	-- popup's: weights Full DPS 1 and Effective Hit Pool 0.5 (TradeQuery.lua), corrupted and mirrored included, each mod tested at
	-- the Item Affix Quality (min + (max - min) * quality over the mod's range across tiers; the setting defaults to 0.5).
	local tradeTypeList = { "securable", "available", "onlineleague", "online", "any" } -- FinishQuery's self.tradeTypes, in order
	local currencyIds = { chaos = true, divine = true, alch = true, alt = true, chrome = true, exalted = true, blessed = true, chisel = true,
		gcp = true, jewellers = true, scour = true, regret = true, fusing = true, chance = true, regal = true, vaal = true } -- its currencyTable
	local realms = { pc = true, xbox = true, sony = true }
	local function indexOf(list, v) for i, x in ipairs(list) do if x == v then return i end end end
	local tradeHost = "https://www.pathofexile.com/"

	-- Trade search link in Path of Building's own form (TradeQuery.lua "Find best" without a session; buildUrl + B64GzipEncode).
	local function tradeLink(realm, league, query)
		if league == nil then return json.null end
		local requests = new("TradeQueryRequests"):TradeQueryRequests({})
		local helpers = require("Classes.TradeHelpers")
		return requests:buildUrl(tradeHost .. "trade/search", realm, league) .. "/" .. helpers.B64GzipEncode(json.encode(query))
	end

	W.tradeLink = tradeLink

	-- The mods of an item mod list that carry `group` and the stat order `order` (a QueryMods key is "<statOrder>_<group>").
	local function sourceMods(list, key)
		local order, group = key:match("^(%-?%d+)_(.+)$")
		local out = {}
		for _, mod in pairs(list or {}) do
			if mod.group == group then
				for _, so in ipairs(mod.statOrder or {}) do
					if tostring(so) == order then out[#out + 1] = mod break end
				end
			end
		end
		return out, group
	end

	-- Every set of at most two prefixes and two suffixes (distinct mod groups) from the best `pool` of each, with a jewel base
	-- that can roll them all; the sums of their gains, best first.
	local function combinations(mods, bases, pool)
		local pre, suf = {}, {}
		for _, m in ipairs(mods) do
			if m.affix == "Prefix" and #pre < pool then pre[#pre + 1] = m elseif m.affix == "Suffix" and #suf < pool then suf[#suf + 1] = m end
		end
		local function pairsOf(list)
			local out = { {} }
			for i = 1, #list do
				out[#out + 1] = { list[i] }
				for j = i + 1, #list do
					if list[i].group ~= list[j].group then out[#out + 1] = { list[i], list[j] } end
				end
			end
			return out
		end
		local out = {}
		for _, p in ipairs(pairsOf(pre)) do
			for _, s in ipairs(pairsOf(suf)) do
				local set, groups, ok, sum = {}, {}, true, 0
				for _, m in ipairs(p) do set[#set + 1] = m end
				for _, m in ipairs(s) do set[#set + 1] = m end
				for _, m in ipairs(set) do
					if groups[m.group] then ok = false end
					groups[m.group] = true
					sum = sum + m.gain
				end
				if ok and #set > 0 then
					local base
					for _, name in ipairs(bases) do
						local all = true
						for _, m in ipairs(set) do if not m.bases[name] then all = false break end end
						if all then base = name break end
					end
					if base then out[#out + 1] = { mods = set, base = base, estimate = sum } end
				end
			end
		end
		table.sort(out, function(x, y)
			if x.estimate ~= y.estimate then return x.estimate > y.estimate end
			local a, c = {}, {}
			for i, m in ipairs(x.mods) do a[i] = m.id end
			for i, m in ipairs(y.mods) do c[i] = m.id end
			return table.concat(a, ",") < table.concat(c, ",")
		end)
		return out
	end

	local function weightsOut(list)
		local out = {}
		for i, w in ipairs(list) do out[i] = { stat = w.stat, weight = w.weightMult } end
		return out
	end
	-- ExecuteQuery's order: a trade id weighed under the first of these is the one it reports
	local modTypeOrder = { "WatchersEye", "Explicit", "Implicit", "Corrupted", "Enchant", "Scourge", "Eater", "Exarch" }

	-- The inputs jewel_mods and item_mods share: the weights, the quality a mod is tested at, and the trade search's league, status and price.
	local function tradeOptions(args)
		local o = { statWeights = statWeightsOf(args) }
		o.quality = args.quality == nil and (main.defaultItemAffixQuality or 0.5) or tonumber(args.quality)
		if not o.quality or o.quality < 0 or o.quality > 1 then bad("quality is from 0 to 1") end
		o.realm = args.realm or "pc"
		if not realms[o.realm] then bad("realm is pc, xbox or sony") end
		if args.league ~= nil and (type(args.league) ~= "string" or not args.league:match("^[%w][%w '%-]*$") or #args.league > 64) then bad("league is a league name, e.g. Standard") end
		o.tradeIndex = indexOf(tradeTypeList, args.tradeType or tradeTypeList[1]) or bad("tradeType is one of " .. table.concat(tradeTypeList, ", "))
		if args.priceCurrency ~= nil and not currencyIds[args.priceCurrency] then bad("priceCurrency is a trade currency id, e.g. chaos or divine") end
		o.maxPrice = args.maxPrice ~= nil and (tonumber(args.maxPrice) or bad("maxPrice is a number")) or nil
		return o
	end

	-- The trade API's body for a generator query, in a shape the site takes from a search without login. The site refuses Path of
	-- Building's weighted sum group without login ("Query is too complex. Please reduce the amount of filters used.Logging in will
	-- increase this limit.": 32, 8 and 3 stats, Covens, 15 Nov 2026); TradeQueryGenerator budgets 200 with that group at 54, a
	-- logged-in limit. So the weight group becomes a count group: at least `need` of the GUEST_STATS heaviest stats (the generator's
	-- order, one stat once across explicit and implicit, stats that count against the build left out), cheapest first; trade.search
	-- with buildId ranks the listings by the full weights. Groups left empty are dropped.
	-- ponytail: 4 is the count group seen to pass (with a category and a price cap); widen it when answered searches' `complexity` shows room.
	local GUEST_STATS = 4
	local function guestSearch(query, need)
		if query == json.null then return json.null end
		local stats, picked, seen = {}, {}, {}
		for _, g in ipairs(query.stats) do
			if g.type == "weight" then
				for _, f in ipairs(g.filters) do
					local key = f.id:match("^%a+%.(.+)$") or f.id
					if #picked < GUEST_STATS and not seen[key] and (f.value.weight or 0) > 0 then
						seen[key] = true
						picked[#picked + 1] = { id = f.id }
					end
				end
			elseif #g.filters > 0 then
				stats[#stats + 1] = g
			end
		end
		if #picked > 0 then table.insert(stats, 1, { type = "count", value = { min = math.min(need, #picked) }, filters = picked }) end
		local q = copyTable(query)
		q.stats = stats
		return { query = q, sort = { price = "asc" } }
	end
	local function searchOf(query) return guestSearch(query, 2) end
	-- Path of Building's own body for the query (the popup's sort): for trade.search through a signed-in browser tab.
	local function weightedOf(query)
		return query ~= json.null and { query = query, sort = { ["statgroup.0"] = "desc" }, engine = "new" } or json.null
	end

	-- The generator run as its Execute button runs it: StartQuery against `slot`, every mod weighed (ExecuteQuery, to the end),
	-- FinishQuery's search, then the weighed mods best first with where the generator found each (text at `quality`, range, kind).
	-- `decorate(m, found)` adds a family's fields to each mod;
	-- `steady` rounds each gain and weight to 1e-9 before the search is built (the calculator's last digits differ with the order the mods were weighed in,
	-- which changes from process to process, and would order mods that gain the same differently), so equal mods are ordered by trade id on every run.
	local function weigh(gen, slot, options, quality, decorate, steady)
		local prevQuality, popups = main.defaultItemAffixQuality, #main.popups
		local query, queryErr
		gen.requesterCallback = function(_, q, e) query, queryErr = q, e end
		main.defaultItemAffixQuality = quality
		local ok, err = pcall(function()
			gen:StartQuery(slot, options)
			if not gen.calcContext.co then bad("Path of Building does not generate a weighted search for " .. slot.slotName) end
			gen.calcContext.co = nil
			drain(gen.ExecuteQuery, gen)
			if steady then
				for _, w in ipairs(gen.modWeights) do
					w.meanStatDiff, w.weight = math.floor(w.meanStatDiff * 1e9 + 0.5) / 1e9, math.floor(w.weight * 1e9 + 0.5) / 1e9
				end
			end
			gen:FinishQuery()
		end)
		main.defaultItemAffixQuality = prevQuality
		while #main.popups > popups do main:ClosePopup() end
		if not ok then error(err, 0) end

		-- trade id -> where the generator found it (QueryMods entry), for text, range and kind: its choice, the highest max, then the first key
		local ctx = gen.calcContext
		local found = {}
		for _, modType in ipairs(modTypeOrder) do
			local here = {}
			for key, entry in pairsSortByKey(gen.modData[modType] or {}) do
				local range = entry.tradeMod and entry[ctx.itemCategory]
				local cur = range and here[entry.tradeMod.id]
				if range and (not cur or range.max > cur.entry[ctx.itemCategory].max) then here[entry.tradeMod.id] = { key = key, entry = entry, modType = modType } end
			end
			for id, f in pairs(here) do found[id] = found[id] or f end
		end
		local weighed = {}
		for i, w in ipairs(gen.modWeights) do weighed[i] = w end
		table.sort(weighed, function(x, y) -- FinishQuery's order, ties by trade id (its sort leaves ties in any order)
			if x.meanStatDiff ~= y.meanStatDiff then return x.meanStatDiff > y.meanStatDiff end
			if math.abs(x.weight) ~= math.abs(y.weight) then return math.abs(x.weight) > math.abs(y.weight) end
			return x.tradeModId < y.tradeModId
		end)
		local mods = {}
		for _, w in ipairs(weighed) do
			local f = found[w.tradeModId]
			local m = { id = w.tradeModId, weight = rounded(w.weight), gain = rounded(w.meanStatDiff), invert = w.invert, kind = f and f.modType or json.null, text = json.null }
			if f then
				local range = f.entry[ctx.itemCategory]
				local value = math.ceil((range.max - range.min) * quality + range.min)
				local line = (value == 1 and f.entry.specialCaseData.overrideModLineSingular) or f.entry.specialCaseData.overrideModLine or f.entry.tradeMod.text
				m.text = line:gsub("#", (f.entry.sign or "") .. tostring(value))
				m.range = { min = range.min, max = range.max }
			end
			if decorate then decorate(m, f) end
			mods[#mods + 1] = m
		end
		if queryErr or query == nil then query = json.null end
		return { ctx = ctx, mods = mods, query = query, queryError = queryErr or json.null }
	end

	-- Cluster jewels: the notables a cluster of this size and enchant can roll, weighted the way the generator weighs Megalomaniac's
	-- notables (GeneratePassiveNodeWeights: each notable added to the tree on its own), and a weighted search for that base and
	-- enchant (Path of Building has no cluster search; this one follows FinishQuery's shape and filters).
	local function clusterNotables(args, b, gen, options, limit, wantCombos, realm)
		local size = args.size
		local jewel = type(size) == "string" and data.clusterJewels.jewels[size .. " Cluster Jewel"] or bad("size is Small, Medium or Large")
		local skill, names = nil, {}
		for id, s in pairs(jewel.skills) do
			names[#names + 1] = s.name
			if s.name == args.enchant or id == args.enchant then skill = s end
		end
		table.sort(names)
		if not skill then bad("enchant is one of the " .. size .. " cluster's: " .. table.concat(names, ", ")) end
		local sizeKey = "expansion_jewel_" .. size:lower()
		local function weightOf(keys, vals, key)
			for i, k in ipairs(keys or {}) do if k == key then return vals[i] end end
			return 0
		end
		local byGroup = {}
		for key, entry in pairs(gen.modData.PassiveNode) do
			local group = key:match("^%-?%d+_(.+)$")
			if group then byGroup[group] = entry end
		end
		local spec = b.spec
		local candidates, info = {}, {}
		for id, mod in pairs(data.itemMods.JewelCluster) do
			if id:find("^AfflictionNotable") and weightOf(mod.weightKey, mod.weightVal, skill.tag) > 0
				and weightOf(mod.weightMultiplierKey, mod.weightMultiplierVal, sizeKey) > 0 and byGroup[mod.group] then
				local entry = byGroup[mod.group]
				local name = mod[1]:match("1 Added Passive Skill is (.*)")
				if name and spec.tree.clusterNodeMap[name] then
					candidates[#candidates + 1] = entry
					info[entry.tradeMod.id] = { name = name, affix = mod.type, level = mod.level }
				end
			end
		end
		local calcFunc, baseOutput = calculator(b)
		gen.modWeights, gen.alreadyWeightedMods = {}, {}
		gen.calcContext = { calcFunc = calcFunc, baseOutput = baseOutput, options = options,
			baseStatValue = gen.WeightedRatioOutputs(baseOutput, baseOutput, options.statWeights) * 1000 }
		drain(gen.GeneratePassiveNodeWeights, gen, candidates)
		table.sort(gen.modWeights, function(x, y)
			if x.meanStatDiff ~= y.meanStatDiff then return x.meanStatDiff > y.meanStatDiff end
			return x.tradeModId < y.tradeModId
		end)
		local mods = {}
		for _, w in ipairs(gen.modWeights) do
			local i = info[w.tradeModId]
			mods[#mods + 1] = { id = w.tradeModId, text = "1 Added Passive Skill is " .. i.name, notable = i.name, affix = i.affix, level = i.level,
				weight = rounded(w.weight), gain = rounded(w.meanStatDiff) }
		end
		-- at most the notables a cluster of this size can hold (1 small, 2 medium, 3 large), two prefixes and two suffixes; measured together
		local cap = ({ Small = 1, Medium = 2, Large = 3 })[size]
		local before = values(b, baseOutput, nil)
		local sets = {}
		local top = {}
		for i = 1, math.min(#mods, 8) do top[i] = mods[i] end
		local function walk(start, set, pre, suf)
			if #set > 0 then sets[#sets + 1] = { unpack(set) } end
			if #set == cap then return end
			for i = start, #top do
				local m = top[i]
				local p, s = pre + (m.affix == "Prefix" and 1 or 0), suf + (m.affix == "Suffix" and 1 or 0)
				if p <= 2 and s <= 2 then
					set[#set + 1] = m
					walk(i + 1, set, p, s)
					set[#set] = nil
				end
			end
		end
		walk(1, {}, 0, 0)
		local combos, largest = {}, 0
		for _, set in ipairs(sets) do largest = math.max(largest, #set) end
		for _, set in ipairs(sets) do
			if #set == largest then
				local nodes, ids, lines, sum = {}, {}, {}, 0
				for _, m in ipairs(set) do nodes[spec.tree.clusterNodeMap[m.notable]] = true; ids[#ids + 1] = m.id; lines[#lines + 1] = m.text; sum = sum + m.gain end
				local output = calcFunc({ addNodes = nodes })
				combos[#combos + 1] = { mods = ids, text = table.concat(lines, "\n"), estimate = rounded(sum),
					gain = rounded(gen.WeightedRatioOutputs(baseOutput, output, options.statWeights) * 1000 - gen.calcContext.baseStatValue),
					changed = diff(before, values(b, output, nil)) }
			end
		end
		table.sort(combos, function(x, y)
			if x.gain ~= y.gain then return x.gain > y.gain end
			return table.concat(x.mods, ",") < table.concat(y.mods, ",")
		end)
		for i = #combos, wantCombos + 1, -1 do combos[i] = nil end

		-- the search: this base, unique excluded, the enchant required, the notables as a weighted sum at least the best one's weight
		local enchantId
		local text = table.concat(skill.enchant, "\n")
		for _, cat in ipairs(require("Classes.TradeHelpers").getTradeStats()) do
			if cat.id == "enchant" then
				for _, e in ipairs(cat.entries) do if e.text == text then enchantId = e.id break end end
			end
		end
		local query = json.null
		if #mods > 0 then
			local filters = { type_filters = { filters = { rarity = { option = "nonunique" } } } }
			if not options.includeMirrored then filters.misc_filters = { disabled = false, filters = { mirrored = false } } end
			if args.minItemLevel ~= nil then
				local ilvl = tonumber(args.minItemLevel) or bad("minItemLevel is a number")
				filters.misc_filters = filters.misc_filters or { disabled = false, filters = {} }
				filters.misc_filters.filters.ilvl = { min = ilvl }
			end
			if options.maxPrice and options.maxPrice > 0 then filters.trade_filters = { filters = { price = { option = options.maxPriceType, max = options.maxPrice } } } end
			local weightGroup = { type = "weight", value = { min = mods[1].weight }, filters = {} }
			for _, m in ipairs(mods) do weightGroup.filters[#weightGroup.filters + 1] = { id = m.id, value = { weight = m.weight } } end
			local andGroup = { type = "and", filters = {} }
			if enchantId then andGroup.filters[1] = { id = enchantId } end
			query = { type = size .. " Cluster Jewel", filters = filters, status = { option = tradeTypeList[gen.tradeTypeIndex] },
				stats = { weightGroup, andGroup, { type = "not", filters = {} } } }
		end
		local out = {}
		for i = 1, math.min(limit, #mods) do out[i] = mods[i] end
		return { family = "cluster", size = size, enchant = skill.name, enchantId = enchantId or json.null, notableSlots = cap,
			category = "jewel.cluster", weights = weightsOut(options.statWeights), total = #mods, mods = out, combinations = combos, query = query,
			search = guestSearch(query, 1), weightedSearch = weightedOf(query),
			queryError = query == json.null and "no notable of this enchant gains anything for this build" or json.null,
			link = query ~= json.null and tradeLink(realm, args.league, query) or json.null }
	end

	-- args: family ("base" | "abyss" | "watchers_eye" | "cluster"), socket?, size? and enchant? (cluster), weights?, quality?,
	-- includeCorrupted?, includeMirrored?, limit?, combinations?, league?, realm?, tradeType?, maxPrice?, priceCurrency?, minItemLevel?.
	function ops.jewel_mods(args)
		local b = W.build()
		local tab = b.itemsTab
		local family = args.family
		local o = tradeOptions(args)
		local statWeights, quality, realm, tradeIndex, maxPrice = o.statWeights, o.quality, o.realm, o.tradeIndex, o.maxPrice
		local limit = math.min(tonumber(args.limit) or 30, 200)
		local wantCombos = math.min(tonumber(args.combinations) or 5, 20)

		local gen = new("TradeQueryGenerator"):TradeQueryGenerator({ itemsTab = tab })
		gen.tradeTypeIndex = tradeIndex
		local options = { statWeights = statWeights, includeCorrupted = args.includeCorrupted ~= false, includeMirrored = args.includeMirrored ~= false,
			maxPrice = maxPrice, maxPriceType = args.priceCurrency }

		if family == "cluster" then return clusterNotables(args, b, gen, options, limit, wantCombos, realm) end

		local probeBase, listName, bases
		if family == "base" then
			options.jewelType, probeBase, listName = "Base", "Crimson Jewel", "Jewel"
		elseif family == "abyss" then
			options.jewelType, probeBase, listName = "Abyss", "Murderous Eye Jewel", "JewelAbyss"
		elseif family == "watchers_eye" then
			options.special, probeBase = { itemName = "Watcher's Eye" }, "Prismatic Jewel"
		else
			bad("family is base, abyss, watchers_eye or cluster (unique jewels: evaluate unique_rank with slot Jewel)")
		end
		local probe = new("Item"):Item("Rarity: RARE\nProbe\n" .. probeBase)
		local slot = socketOf(tab, args.socket, probe)
		if slot.slotName:find("Abyssal") and family ~= "abyss" then bad("an abyssal socket takes abyss jewels") end

		bases = {}
		if listName then
			for name, base in pairs(data.itemBases) do
				if base.type == "Jewel" and not base.hidden and ((listName == "Jewel" and base.subType == nil) or (listName == "JewelAbyss" and base.subType == "Abyss")) then bases[#bases + 1] = name end
			end
			table.sort(bases)
		end
		-- A QueryMods entry's mod group, affix and the bases that roll it (from the family's mod list).
		local spawn = new("Item"):Item() -- canModSpawnForItemCategory's mock item
		local affixCache = {}
		local function affixOf(key)
			if affixCache[key] then return affixCache[key] end
			local src, group = sourceMods(data.itemMods[listName], key)
			local rolled, any, on = {}, {}, {}
			for _, mod in ipairs(src) do
				if mod.type == "Prefix" or mod.type == "Suffix" then
					any[mod.type] = true
					for _, name in ipairs(bases) do
						if spawn.GetModSpawnWeight({ base = data.itemBases[name] }, mod) > 0 then on[name] = true; rolled[mod.type] = true end
					end
				end
			end
			local types = next(rolled) and rolled or any -- the affix of the tiers a base rolls, else of any tier
			affixCache[key] = { group = group, bases = on,
				affix = (types.Prefix and types.Suffix) and "Either" or types.Prefix and "Prefix" or types.Suffix and "Suffix" or json.null }
			return affixCache[key]
		end
		local weighed = weigh(gen, slot, options, quality, function(m, f)
			m.affix, m.group, m.bases = json.null, json.null, {}
			if f and listName and f.modType == "Explicit" then
				local a = affixOf(f.key)
				m.group, m.affix = a.group, a.affix
				for name in pairs(a.bases) do m.bases[name] = true end
			end
		end)
		local ctx, mods, query, queryErr = weighed.ctx, weighed.mods, weighed.query, weighed.queryError

		-- the best legal sets, measured together on one test item (their sum is only an estimate: stats multiply)
		local combos = {}
		if listName then
			local calcFunc = ctx.calcFunc
			local before = values(b, ctx.baseOutput, nil)
			for i, c in ipairs(combinations(mods, bases, 8)) do
				if i > math.max(wantCombos * 3, 12) then break end
				local lines = { "Rarity: RARE", "Stat Tester", c.base }
				for _, m in ipairs(c.mods) do lines[#lines + 1] = m.text end
				local item = new("Item"):Item(table.concat(lines, "\n"))
				local output = calcFunc({ repSlotName = slot.slotName, repItem = item })
				local gain = gen.WeightedRatioOutputs(ctx.baseOutput, output, statWeights) * 1000 - (ctx.baseStatValue or 0)
				local ids = {}
				for _, m in ipairs(c.mods) do ids[#ids + 1] = m.id end
				combos[#combos + 1] = { mods = ids, text = table.concat(lines, "\n", 4), base = c.base, estimate = rounded(c.estimate), gain = rounded(gain),
					changed = diff(before, values(b, output, nil)) }
			end
			table.sort(combos, function(x, y)
			if x.gain ~= y.gain then return x.gain > y.gain end
			return table.concat(x.mods, ",") < table.concat(y.mods, ",")
		end)
			for i = #combos, wantCombos + 1, -1 do combos[i] = nil end
		end
		local out = {}
		for i = 1, math.min(limit, #mods) do
			local m = mods[i]
			local names = {}
			for name in pairs(m.bases) do names[#names + 1] = name end
			table.sort(names)
			m.bases = names
			if m.kind == "Explicit" and listName then m.rollable = #names > 0 end -- the generator also weighs mods no base of the family rolls
			out[i] = m
		end
		return { family = family, socket = slot.slotName, category = ctx.itemCategoryQueryStr, quality = quality, weights = weightsOut(statWeights),
			total = #mods, mods = out, combinations = combos, query = query, search = searchOf(query), weightedSearch = weightedOf(query), queryError = queryErr,
			link = query ~= json.null and tradeLink(realm, args.league, query) or json.null }
	end

	-- The gear slots of the Trade tab's rows that are driven here (weapon swap sets and jewels are not: jewel_mods takes jewels), and the
	-- popup's per-slot controls (RequestQuery): eldritch implicits on armour and the amulet, talisman mods on the amulet, empty
	-- sockets on all but flasks, links on all but flasks, belts, rings and the amulet.
	local gearSlots = { "Weapon 1", "Weapon 2", "Helmet", "Body Armour", "Gloves", "Boots", "Amulet", "Ring 1", "Ring 2", "Ring 3", "Belt",
		"Flask 1", "Flask 2", "Flask 3", "Flask 4", "Flask 5" }
	local eldritchSlots = { ["Body Armour"] = true, Helmet = true, Gloves = true, Boots = true, Amulet = true }
	local eldritchChoices = { "Copy Current", "Keep regular", "Keep regular+presence", "Remove" } -- the popup's list, first is its default
	local ignoredPseudo = { "^pseudo.lake", "^pseudo.pseudo_lake", "^pseudo.pseudo_logbook", "^pseudo.pseudo_temple", "^pseudo.pseudo_map", "^pseudo.pseudo_ritual" }
	local maxSelectors = 5 -- the popup's required and blocked stat rows

	-- The popup's stat list for a category: explicit, implicit and corrupted mods the generator has for it, and the pseudo stats.
	local function selectableStats(gen, category)
		local valid = {}
		for _, modType in ipairs({ "Explicit", "Implicit", "Corrupted" }) do
			for _, entry in pairs(gen.modData[modType]) do
				if entry[category] ~= nil then valid[entry.tradeMod.id] = true end
			end
		end
		for _, cat in ipairs(require("Classes.TradeHelpers").getTradeStats()) do
			if cat.id == "pseudo" then
				for _, entry in ipairs(cat.entries) do
					local skip = false
					for _, pattern in ipairs(ignoredPseudo) do if entry.id:find(pattern) then skip = true end end
					if not skip then valid[entry.id] = true end
				end
			end
		end
		return valid
	end

	local function statRows(list, what, valid)
		if list == nil then return nil end
		if type(list) ~= "table" or #list > maxSelectors then bad(what .. " is a list of at most " .. maxSelectors .. " { id, min } (the popup's rows)") end
		local out = {}
		for _, row in ipairs(list) do
			local id = type(row) == "table" and row.id or nil
			if type(id) ~= "string" or not valid[id] then bad(what .. " id " .. tostring(id) .. " is not in the popup's stat list for this slot (an explicit, implicit or corrupted trade stat id of its category, or a pseudo stat)") end
			-- the popup's Min box may be left empty, which makes the generator write an empty value object; a row here always has a lowest value
			local min = tonumber(row.min) or bad(what .. " rows need min, the lowest value (a number)")
			out[#out + 1] = { tradeId = id, value = min }
		end
		return #out > 0 and out or nil
	end

	local function wholeNumber(v, what, lo, hi)
		local n = tonumber(v)
		if not n or n ~= math.floor(n) or n < lo or n > hi then bad(what .. " is a whole number from " .. lo .. " to " .. hi) end
		return n
	end

	-- Gear for this build through Path of Building's trade weighting (TradeQueryGenerator.lua), as "Find best" on the Trade tab's row for
	-- the slot does it: the base of the item in the slot is the test item's base (the popup's StartQuery takes it from the slot; an empty
	-- slot makes it test an amulet base in any slot, so an empty slot is refused here), each mod alone on a blank item of that base in the
	-- slot, weighed as jewel_mods weighs. Options are the popup's, and an option a slot's popup does not show is refused for that slot.
	-- args: slot, weights?, quality?, includeCorrupted?, includeMirrored?, includeScourge?, includeTalisman?, includeEldritch?, sockets?,
	-- links?, maxLevel?, requiredMods?, blockedMods?, maxPrice?, priceCurrency?, tradeType?, league?, realm?, limit?.
	function ops.item_mods(args)
		local b = W.build()
		local tab = b.itemsTab
		local name = args.slot
		if type(name) ~= "string" or not indexOf(gearSlots, name) then bad("slot is one of " .. table.concat(gearSlots, ", ") .. " (jewels: jewel_mods)") end
		local o = tradeOptions(args)
		local limit = math.min(tonumber(args.limit) or 30, 200)
		local slot = tab.slots[name]
		if not slot or not slotInUse(tab, slot) then bad(name .. " is not in use (weapon set, or no such slot in this build)") end
		local item = tab.items[slot.selItemId]
		if not item then bad(name .. " holds no item; the generator takes the base of the item in the slot (equip one first)") end

		local flask, amulet = name:find("^Flask") ~= nil, name == "Amulet"
		local scourgeShown = args.league == "Standard" or args.league == "Hardcore" -- the popup's Scourge Mods box shows in these leagues only
		if args.includeTalisman ~= nil and not amulet then bad("includeTalisman is not in the popup for " .. name .. " (Amulet only)") end
		if args.includeEldritch ~= nil and not eldritchSlots[name] then bad("includeEldritch is not in the popup for " .. name .. " (Body Armour, Helmet, Gloves, Boots, Amulet)") end
		if args.includeEldritch ~= nil and not indexOf(eldritchChoices, args.includeEldritch) then bad("includeEldritch is one of " .. table.concat(eldritchChoices, ", ")) end
		if args.includeScourge ~= nil and not scourgeShown then bad("includeScourge is not in the popup for " .. name .. " unless league is Standard or Hardcore") end
		if args.sockets ~= nil and flask then bad("sockets is not in the popup for " .. name) end
		if args.links ~= nil and (flask or name == "Belt" or name:find("^Ring") or amulet) then bad("links is not in the popup for " .. name) end

		local helpers = require("Classes.TradeHelpers")
		local _, category = helpers.getTradeCategory(name, item)
		local gen = new("TradeQueryGenerator"):TradeQueryGenerator({ itemsTab = tab })
		gen.tradeTypeIndex = o.tradeIndex
		local options = { statWeights = o.statWeights, includeCorrupted = args.includeCorrupted ~= false, includeMirrored = args.includeMirrored ~= false,
			maxPrice = o.maxPrice, maxPriceType = args.priceCurrency }
		if scourgeShown then options.includeScourge = args.includeScourge ~= false end
		if amulet then options.includeTalisman = args.includeTalisman == true end
		if eldritchSlots[name] then options.includeEldritch = args.includeEldritch or eldritchChoices[1] end
		if args.maxLevel ~= nil then options.maxLevel = wholeNumber(args.maxLevel, "maxLevel", 1, 100) end
		if args.sockets ~= nil then options.sockets = wholeNumber(args.sockets, "sockets", 1, 6) end
		if args.links ~= nil then options.links = wholeNumber(args.links, "links", 1, 6) end
		local valid = (args.requiredMods ~= nil or args.blockedMods ~= nil) and selectableStats(gen, category) or nil
		options.requiredMods = statRows(args.requiredMods, "requiredMods", valid)
		options.blockedMods = statRows(args.blockedMods, "blockedMods", valid)

		local weighed = weigh(gen, slot, options, o.quality, nil, true)
		local mods = {}
		for i = 1, math.min(limit, #weighed.mods) do mods[i] = weighed.mods[i] end
		local query = weighed.query
		return { slot = name, item = item.title or item.name, base = item.baseName, category = weighed.ctx.itemCategoryQueryStr, quality = o.quality, weights = weightsOut(o.statWeights),
			options = object({ includeCorrupted = options.includeCorrupted, includeMirrored = options.includeMirrored, includeScourge = options.includeScourge,
				includeTalisman = options.includeTalisman, includeEldritch = options.includeEldritch, sockets = options.sockets, links = options.links,
				maxLevel = options.maxLevel, maxPrice = options.maxPrice, priceCurrency = options.maxPriceType }),
			total = #weighed.mods, mods = mods, query = query, search = searchOf(query), weightedSearch = weightedOf(query), queryError = weighed.queryError,
			link = query ~= json.null and tradeLink(o.realm, args.league, query) or json.null }
	end

	-- args: entries (trade fetch entries, seller fields already left out by the server), score (a build to score against),
	-- slot?, weights?, fields?. Each entry becomes item text by Path of Building's own conversion (TradeQueryRequests
	-- FetchResultBlock); with `score`, each item is put in `slot` (default: the first slot in use it fits, a jewel the first
	-- empty socket it fits) and weighed as the trade search weighs (TradeQueryGenerator.WeightedRatioOutputs, default Full DPS 1,
	-- Effective Hit Pool 0.5): `gain` is the weighted change x1000 against what is in that slot now. Tree-changing jewels and
	-- cluster jewels are equipped for real, as compare_item does.
	function ops.listings(args)
		if type(args.entries) ~= "table" then bad("entries is a list") end
		local statWeights = args.score and statWeightsOf(args) or nil
		local fields = fieldsOf(args)
		local fixed = args.slot ~= nil and args.score and slotOf(W.build().itemsTab, args.slot, true) or nil
		local requests = new("TradeQueryRequests"):TradeQueryRequests({})
		local function textOf(entry) return listingText(entry, requests) end
		local function scoreOf(item)
			local b = W.build()
			local tab = b.itemsTab
			local slot = fixed
			if slot then
				if not tab:IsItemValidForSlot(item, slot.slotName) then bad("this item does not fit " .. slot.slotName) end
				if not slotInUse(tab, slot) then bad(slot.slotName .. " is not in use") end
			elseif item.type == "Jewel" then
				slot = socketOf(tab, nil, item)
			else
				for _, s in ipairs(tab.orderedSlots) do
					if not slot and not s.nodeId and tab:IsItemValidForSlot(item, s.slotName) and slotInUse(tab, s) then slot = s end
				end
				if not slot then bad("this item fits no slot in use") end
			end
			local calcFunc, calcBase = calculator(b)
			local gainOfOutput = gainOf(calcBase, statWeights)
			local before = values(b, calcBase, fields)
			local function measure(nb, output)
				return { slot = slot.slotName, gain = gainOfOutput(output), changed = diff(before, values(nb, output, fields)) }
			end
			if slot.nodeId and (changesTree(item) or changesTree(slot.selItemId and tab.items[slot.selItemId])) then
				local score, points = inSocket(b, slot, item, measure)
				score.points = points
				return score
			end
			return measure(b, calcFunc({ repSlotName = slot.slotName, repItem = item }))
		end
		local out = {}
		for i, entry in ipairs(args.entries) do
			local row = { id = type(entry) == "table" and entry.id or json.null, text = json.null, score = json.null }
			local ok, item, text = pcall(function()
				local t = textOf(entry)
				return t and new("Item"):Item(t), t
			end)
			if ok and item and item.base then
				row.text = W.strip(text)
				if statWeights then
					item:NormaliseQuality()
					item:BuildModList()
					local scored, score = pcall(scoreOf, item)
					if scored then row.score = score
					else row.error = type(score) == "table" and score.message or "could not score this listing" end
				end
			else
				row.error = "Path of Building could not read this listing"
			end
			out[i] = row
		end
		return { listings = out, weights = statWeights and weightsOut(statWeights) or json.null }
	end

	-- args: xml, label (the other build, filled in by the server), stat? (a power stat label, default Full DPS), categories?
	-- ({ tree, items, gems, supports, config }: default all), limit?. The Compare tab's power report: what each passive, item,
	-- skill group, support gem and config option of the compared build would change on this build, one at a time, best first.
	function ops.compare_power(args)
		return W.compared(args, function(tab, entry)
			local stat
			for _, s in ipairs(tab.controls.comparePowerStatSelect.list) do
				if s.stat and (s.label == (args.stat or "Full DPS")) then stat = s break end
			end
			if not stat then bad("stat " .. tostring(args.stat) .. " is not in the power report's list (e.g. Full DPS, Life, Effective Hit Pool)") end
			local c = args.categories or {}
			local all = next(c) == nil
			tab:ComparePowerBuilder(entry, stat, { treeNodes = all or c.tree == true, items = all or c.items == true, skillGems = all or c.gems == true,
				supportGems = all or c.supports == true, config = all or c.config == true })
			local list = {}
			for _, r in ipairs(tab.comparePowerResults or {}) do list[#list + 1] = r end
			table.sort(list, function(x, y) return x.impact > y.impact end)
			local out = {}
			for i, r in ipairs(list) do
				if args.limit and i > args.limit then break end
				out[i] = { category = r.category, name = W.strip(r.name or ""), nodeId = r.nodeId, slot = r.slotName, impact = r.impact,
					percent = r.impactPercent, pathDist = r.pathDist, perPoint = r.perPoint }
			end
			return { other = args.label, stat = stat.label, total = #list, results = setmetatable(out, { __jsontype = "array" }) }
		end)
	end

	-- args: jewel (timeless jewel type, by name or one unique part), conqueror?, socket? (node id or "Jewel <id>"; default every
	-- socket), nodes? [{node (legion passive id or exact name), weight?, weight2?, minimum?}], fallback? (a Fallback Weight Mode
	-- stat, e.g. "Full DPS": Generate weighs every other passive the jewel can give by that stat), minimumTotal?, allocatedOnly?,
	-- limit?, league?, realm?. The Tree tab's Find Timeless Jewel dialog, driven through its controls: Search scores every seed
	-- in the socket(s) against the weights; Open Trade URL makes the trade search for the best seeds (captured, not opened).
	-- The dialog keeps its settings in the build (timelessData); they are put back, so the build does not change.
	function ops.timeless(args)
		local b = W.build()
		local tab = b.treeTab
		if type(args.jewel) ~= "string" then bad("jewel is a timeless jewel type, e.g. Lethal Pride") end
		local realm = args.realm or "pc"
		local keep = { data = copyTable(b.timelessData), flag = b.modFlag, leagues = tab.tradeLeaguesList, league = tab.timelessJewelLeagueSelect,
			realm = tab.selectedRealmIndex, tradeType = tab.tradeTypeIndex, more = tab.lastSearchMore }
		-- The league list is given, so the dialog never asks the trade site for it (updateLeagues -> FetchLeagues).
		tab.tradeLeaguesList = { [realm] = { args.league or "-" } }
		tab.selectedRealmIndex = ({ pc = 1, sony = 2, xbox = 3 })[realm]
		tab.timelessJewelLeagueSelect, tab.tradeTypeIndex, tab.lastSearchMore = nil, 1, false
		local popups = #main.popups
		local ok, out = pcall(function()
			tab:FindTimelessJewel()
			local c = main.popups[1].controls
			local function pick(drop, want, what)
				local lower = want:lower()
				local exact = W.choose(drop, function(v) return v.label:lower() == lower end)
				if exact then return exact end
				local hits = {}
				for _, v in ipairs(drop.list) do
					if v.label:lower():find(lower, 1, true) then hits[#hits + 1] = v.label end
				end
				if #hits ~= 1 then
					local all = {}
					for _, v in ipairs(drop.list) do all[#all + 1] = v.label end
					bad(("%s %q matches %d of: %s"):format(what, want, #hits, table.concat(#hits > 1 and hits or all, "; ")))
				end
				return W.choose(drop, function(v) return v.label == hits[1] end)
			end
			local jewel = pick(c.jewelSelect, args.jewel, "jewel")
			local conqueror = args.conqueror and pick(c.conquerorSelect, args.conqueror, "conqueror") or c.conquerorSelect.list[c.conquerorSelect.selIndex]
			if args.socket ~= nil then
				local ref = type(args.socket) == "string" and args.socket:match("^Jewel (%d+)$") or args.socket
				local id = tonumber(ref)
				if not W.choose(c.socketSelect, function(v) return v.id == id end) then bad("socket " .. tostring(args.socket) .. " is not a jewel socket on this tree") end
			else
				W.choose(c.socketSelect, function(v) return v.id == -1 end)
			end
			c.socketFilter.state = args.allocatedOnly == true
			c.socketFilter.changeFunc(c.socketFilter.state)
			-- The search list's text form (parseSearchList): one passive per line, "id, weight, weight2, minimum".
			local lines = {}
			for i, n in ipairs(args.nodes or {}) do
				local entry
				for _, v in ipairs(c.nodeSelect.list) do
					if v.id and (v.id == n.node or v.label:match("^(.-)%s*$") == n.node or v.label:match("^(.-)  ") == n.node) then entry = v break end
				end
				if not entry then bad(("nodes[%d]: %s is not a passive %s can give (an id like %s, or its name)"):format(i, tostring(n.node), jewel.label, tostring((c.nodeSelect.list[2] or {}).id))) end
				lines[#lines + 1] = ("%s, %s, %s, %s"):format(entry.id, n.weight or 1, n.weight2 or 0, n.minimum or 0)
			end
			c.searchList:SetText(table.concat(lines, "\n"), true)
			if args.fallback ~= nil then
				pick(c.fallbackWeightsList, "Sort by " .. args.fallback, "fallback")
				c.fallbackWeightsButton:Click()
			else
				c.searchListFallback:SetText("", true)
			end
			if #lines == 0 and args.fallback == nil then bad("give nodes, a fallback stat, or both") end
			c.totalMinimumWeight:SetText(args.minimumTotal and tostring(args.minimumTotal) or "", true)
			c.searchButton:Click()
			local td = b.timelessData
			local limit = math.min(tonumber(args.limit) or 20, 200)
			local results = {}
			for i, r in ipairs(td.searchResults) do
				if i > limit then break end
				local nodes = {}
				for id, d in pairs(td.sharedResults.desiredNodes or {}) do
					if r[id] then
						local targets = copyTable(r[id].targetNodeNames or {})
						table.sort(targets)
						nodes[#nodes + 1] = { id = id, name = d.displayName, targets = setmetatable(targets, { __jsontype = "array" }) }
					end
				end
				table.sort(nodes, function(x, y) return x.id < y.id end)
				setmetatable(nodes, { __jsontype = "array" })
				local socket = r.socketId and { id = r.socketId, label = r.socketLabel } or { id = td.jewelSocket.id, label = td.jewelSocket.label }
				results[i] = { seed = r.seed, total = r.total, socket = socket, nodes = nodes }
			end
			local link, query = json.null, json.null
			if #td.searchResults > 0 then
				c.searchTradeButton:Click()
				local url = W.takeCopied()
				if url then
					local encoded = url:match("/([^/]+)$")
					link = args.league and url or json.null
					query = encoded and json.decode(require("Classes.TradeHelpers").B64GzipDecode(encoded)) or json.null
				end
			end
			return { jewel = jewel.label, conqueror = conqueror and conqueror.label or json.null, count = #td.searchResults,
				results = setmetatable(results, { __jsontype = "array" }), query = query,
				search = query ~= json.null and { query = query, sort = { price = "asc" } } or json.null, link = link }
		end)
		while #main.popups > popups do main:ClosePopup() end
		-- ponytail: the seed tables (Glorious Vanity is over 1 GB unpacked) are dropped after each call and unpacked again on
		-- the next one (a few seconds); keep them per worker if repeat searches matter more than memory.
		for k in pairs(data.timelessJewelLUTs) do data.timelessJewelLUTs[k] = nil end
		collectgarbage()
		b.timelessData, b.modFlag = keep.data, keep.flag
		tab.tradeLeaguesList, tab.timelessJewelLeagueSelect, tab.selectedRealmIndex, tab.tradeTypeIndex, tab.lastSearchMore = keep.leagues, keep.league, keep.realm, keep.tradeType, keep.more
		if not ok then error(out, 0) end
		return out
	end

	return ops
end
