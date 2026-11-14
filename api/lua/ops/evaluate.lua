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
	local function powerStat(name)
		for _, entry in ipairs(data.powerStatList) do
			if (name == "OffenceDefence" and entry.combinedOffDef) or (entry.stat and entry.stat == name) then return entry end
		end
		bad("unknown stat " .. tostring(name) .. "; use a stat of the power stat list, e.g. CombinedDPS, FullDPS, TotalEHP, Life")
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

	local function calculator(b)
		return b.calcsTab:GetMiscCalculator()
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

	-- An item by id (item list) or from its text, as Add from the Items tab reads it.
	local function itemOf(tab, args)
		if args.text ~= nil then
			if type(args.text) ~= "string" or not args.text:match("%S") then bad("text is the item's text") end
			local item = new("Item"):Item(args.text)
			if not item.base then bad("Path of Building could not read this item (unknown base?)") end
			item:NormaliseQuality()
			item:BuildModList()
			return item
		end
		if args.item == nil then bad("an item (id) or its text is required") end
		return tab.items[tonumber(args.item)] or bad("no item " .. tostring(args.item))
	end

	local function equippedIn(tab, slot)
		local item = slot.selItemId and tab.items[slot.selItemId]
		return item and W.strip(item.name) or json.null
	end

	-- args: addNodes?, removeNodes? (node ids or exact names), slot? with item? (id) or text?, toggleFlask? / toggleTincture? (slot),
	-- conditions? (names), fields?. The calculator's override with all of them at once.
	function ops.what_if(args)
		local b = W.build()
		local tab = b.itemsTab
		local override = {}
		if args.addNodes ~= nil then override.addNodes = nodeSet(b.spec, args.addNodes) end
		if args.removeNodes ~= nil then override.removeNodes = nodeSet(b.spec, args.removeNodes) end
		if args.slot ~= nil then
			local slot = slotOf(tab, args.slot)
			local item = itemOf(tab, args)
			if not tab:IsItemValidForSlot(item, args.slot) then bad("this item does not fit " .. args.slot) end
			if not slotInUse(tab, slot) then bad(args.slot .. " is not in use (weapon set or socket not active)") end
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
		local calcFunc, calcBase = calculator(b)
		return { changed = diff(values(b, calcBase, fields), values(b, calcFunc(override), fields)) }
	end

	-- args: stat, depth? (largest path distance; default 10, the whole tree can outlast the worker timeout), limit?, offset?.
	-- PowerBuilder fills node.power for every node; allocated nodes report what removing them changes. A mastery
	-- is listed once per effect it can take. Cluster jewel notables are not listed.
	function ops.node_power(args)
		local b = W.build()
		local tab = b.calcsTab
		local stat = powerStat(args.stat)
		local depth = args.depth == nil and 10 or tonumber(args.depth)
		if not depth or depth < 1 then bad("depth is a path distance of 1 or more") end
		local limit, offset = math.min(tonumber(args.limit) or 20, 200), math.max(tonumber(args.offset) or 0, 0)
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
				power = p.singleStat, pathPower = p.pathPower, defence = combined and p.defence or nil }
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
		return { stat = args.stat, total = #list, offset = offset, nodes = page }
	end

	-- args: candidates? (node ids or exact names; default every unallocated passive next to the allocated tree), fields?,
	-- sortBy? (an output key: largest gain first), limit?, offset?. Each candidate is scored on its own with the path
	-- that reaches it (as the tree's hover does), through the calculator; the build is not changed.
	local maxCandidates = 200 -- ponytail: one full calculation each, within the worker's time for a call
	function ops.passives(args)
		local b = W.build()
		local spec = b.spec
		local list = {}
		if args.candidates ~= nil then
			if type(args.candidates) ~= "table" or #args.candidates == 0 then bad("candidates is a list of node ids or exact names") end
			for _, ref in ipairs(args.candidates) do
				local node = nodeOf(spec, ref)
				if node.alloc then bad(W.strip(node.dn) .. " is allocated already") end
				if node.type == "Mastery" then bad(W.strip(node.dn) .. " is a mastery: score its effects with node_power or what_if") end
				if not node.path or #node.path == 0 then bad(W.strip(node.dn) .. " cannot be reached from the allocated tree") end
				list[#list + 1] = node
			end
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
			for _, n in ipairs(node.path) do add[n] = true end
			local changed = diff(base, values(b, calcFunc({ addNodes = add }), fields))
			local gain = 0
			local c = sortBy and changed[sortBy]
			if c and type(c.after) == "number" then gain = c.after - (type(c.before) == "number" and c.before or 0) end
			scored[#scored + 1] = { id = node.id, name = W.strip(node.dn), type = node.type, points = #node.path, changed = changed, gain = sortBy and gain or nil }
		end
		table.sort(scored, function(x, y)
			if sortBy and x.gain ~= y.gain then return x.gain > y.gain end
			return x.id < y.id
		end)
		local limit, offset = math.min(tonumber(args.limit) or 50, maxCandidates), math.max(tonumber(args.offset) or 0, 0)
		local page = {}
		for i = offset + 1, math.min(offset + limit, #scored) do page[#page + 1] = scored[i] end
		return { total = #scored, offset = offset, sortBy = sortBy, candidates = page }
	end

	-- args: item (id) or text, slot? (default every slot it fits), fields?. The item in each slot in place of what it holds.
	-- ItemsTab.lua itemChangesPassiveTree (the tooltip then rebuilds the tree to compare), and cluster jewels, whose passives are
	-- a part of the tree the calculator's override does not build.
	local function changesTree(item)
		return item and item.type == "Jewel" and (item.clusterJewel or (item.jewelData and (item.jewelData.conqueredBy
			or item.jewelRadiusIndex and (item.jewelData.intuitiveLeapLike or item.jewelData.impossibleEscapeKeystone)))) and true or false
	end

	-- Equips a copy of `item` in the socket for real (a cluster jewel's passives built and all allocated, the path to them too),
	-- recalculates, and loads the build back from its own XML so it is left as it was.
	local function inSocket(b, slot, item, fields)
		local xml, name = b:SaveDB("code"), b.buildName
		local before = values(b, b.calcsTab.mainOutput, fields)
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
			return { changed = diff(before, values(b, b.calcsTab.mainOutput, fields)), points = b.spec:CountAllocNodes() - used }
		end)
		main:SetMode("BUILD", false, name, xml, true)
		W.pump()
		if not ok then error(res, 0) end
		return res
	end

	function ops.compare_item(args)
		local b = W.build()
		local tab = b.itemsTab
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
		local out = {}
		for _, slot in ipairs(slots) do
			if slot.nodeId and (changesTree(item) or changesTree(slot.selItemId and tab.items[slot.selItemId])) then
				local equipped = equippedIn(tab, slot)
				local r = inSocket(b, slot, item, fields)
				out[#out + 1] = { slot = slot.slotName, equipped = equipped, changed = r.changed, points = r.points }
				b = W.build()
				tab = b.itemsTab
			else
				out[#out + 1] = { slot = slot.slotName, equipped = equippedIn(tab, slot),
					changed = diff(before, values(b, calcFunc({ repSlotName = slot.slotName, repItem = item }), fields)) }
			end
		end
		return { slots = out }
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
		return { stat = args.stat, total = total, notables = out }
	end

	-- args: slot, stat, limit?. The unique database list filtered to the slot and sorted by the stat the unique gives (its best
	-- slot; power is the stat's value with the unique equipped).
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
		slotDrop.selIndex = prevSel
		control:SetSortMode(prevMode)
		control.list = prevList
		if not ok then error(err, 0) end
		return { stat = args.stat, total = total, uniques = out }
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

	local function statWeightsOf(args)
		if args.weights == nil then return { { stat = "FullDPS", weightMult = 1.0 }, { stat = "TotalEHP", weightMult = 0.5 } } end
		if type(args.weights) ~= "table" or #args.weights == 0 then bad("weights is a list of { stat, weight }") end
		local out = {}
		for _, w in ipairs(args.weights) do
			local entry = powerStat(type(w) == "table" and w.stat or nil)
			if not entry.stat or entry.ignoreForItems then bad("stat " .. tostring(w.stat) .. " cannot weigh items") end
			local mult = tonumber(w.weight)
			if not mult or mult < 0.01 or mult > 1 then bad("a weight is from 0.01 to 1 (the popup's slider)") end
			out[#out + 1] = { stat = entry.stat, label = entry.label, transform = entry.transform, weightMult = mult }
		end
		return out
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

	-- Trade search link in Path of Building's own form (TradeQuery.lua "Find best" without a session; buildUrl + B64GzipEncode).
	local function tradeLink(realm, league, query)
		if league == nil then return json.null end
		local requests = new("TradeQueryRequests"):TradeQueryRequests({})
		local helpers = require("Classes.TradeHelpers")
		return requests:buildUrl(tradeHost .. "trade/search", realm, league) .. "/" .. helpers.B64GzipEncode(json.encode(query))
	end

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

	local function rounded(v) return math.floor(v * 1000 + 0.5) / 1000 end
	local function weightsOut(list)
		local out = {}
		for i, w in ipairs(list) do out[i] = { stat = w.stat, weight = w.weightMult } end
		return out
	end
	-- ExecuteQuery's order: a trade id weighed under the first of these is the one it reports
	local modTypeOrder = { "WatchersEye", "Explicit", "Implicit", "Corrupted", "Enchant", "Scourge", "Eater", "Exarch" }

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
		local calcFunc, baseOutput = b.calcsTab:GetMiscCalculator()
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
				local nodes, ids, sum = {}, {}, 0
				for _, m in ipairs(set) do nodes[spec.tree.clusterNodeMap[m.notable]] = true; ids[#ids + 1] = m.id; sum = sum + m.gain end
				local output = calcFunc({ addNodes = nodes })
				combos[#combos + 1] = { mods = ids, estimate = rounded(sum),
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
			search = query ~= json.null and { query = query, sort = { ["statgroup.0"] = "desc" }, engine = "new" } or json.null,
			queryError = query == json.null and "no notable of this enchant gains anything for this build" or json.null,
			link = query ~= json.null and tradeLink(realm, args.league, query) or json.null }
	end

	-- args: family ("base" | "abyss" | "watchers_eye" | "cluster"), socket?, size? and enchant? (cluster), weights?, quality?,
	-- includeCorrupted?, includeMirrored?, limit?, combinations?, league?, realm?, tradeType?, maxPrice?, priceCurrency?, minItemLevel?.
	function ops.jewel_mods(args)
		local b = W.build()
		local tab = b.itemsTab
		local family = args.family
		local statWeights = statWeightsOf(args)
		local limit = math.min(tonumber(args.limit) or 30, 200)
		local wantCombos = math.min(tonumber(args.combinations) or 5, 20)
		local quality = args.quality == nil and (main.defaultItemAffixQuality or 0.5) or tonumber(args.quality)
		if not quality or quality < 0 or quality > 1 then bad("quality is from 0 to 1") end
		local realm = args.realm or "pc"
		if not realms[realm] then bad("realm is pc, xbox or sony") end
		if args.league ~= nil and (type(args.league) ~= "string" or not args.league:match("^[%w][%w '%-]*$") or #args.league > 64) then bad("league is a league name, e.g. Standard") end
		local tradeType = args.tradeType or tradeTypeList[1]
		local tradeIndex = indexOf(tradeTypeList, tradeType) or bad("tradeType is one of " .. table.concat(tradeTypeList, ", "))
		if args.priceCurrency ~= nil and not currencyIds[args.priceCurrency] then bad("priceCurrency is a trade currency id, e.g. chaos or divine") end
		local maxPrice = args.maxPrice ~= nil and (tonumber(args.maxPrice) or bad("maxPrice is a number")) or nil

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
			affixCache[key] = { group = group, bases = on, rollable = next(on) ~= nil,
				affix = (types.Prefix and types.Suffix) and "Either" or types.Prefix and "Prefix" or types.Suffix and "Suffix" or json.null }
			return affixCache[key]
		end
		-- One entry per trade id and mod type for the category: the generator takes whichever its pairs() meets first, which
		-- changes from process to process; here the one a base of the family rolls, then the widest range, then the key.
		local function oneEach(modData, category)
			local out = {}
			for modType, entries in pairs(modData) do
				local best = {}
				for key, entry in pairs(entries) do
					if entry.tradeMod and entry[category] then
						local id, cur = entry.tradeMod.id, best[entry.tradeMod.id]
						local function rank(k)
							local e = entries[k]
							return (listName and modType == "Explicit" and affixOf(k).rollable) and 1 or 0, e[category].max, k
						end
						if not cur then best[id] = key else
							local r1, m1, k1 = rank(key)
							local r2, m2, k2 = rank(cur)
							if r1 > r2 or (r1 == r2 and (m1 > m2 or (m1 == m2 and k1 < k2))) then best[id] = key end
						end
					end
				end
				local kept = {}
				for _, key in pairs(best) do kept[key] = entries[key] end
				out[modType] = kept
			end
			return out
		end

		local prevQuality, popups = main.defaultItemAffixQuality, #main.popups
		local query, queryErr
		gen.requesterCallback = function(_, q, e) query, queryErr = q, e end
		main.defaultItemAffixQuality = quality
		local ok, err = pcall(function()
			gen:StartQuery(slot, options)
			if not gen.calcContext.co then bad("Path of Building does not generate a weighted search for " .. slot.slotName) end
			gen.calcContext.co = nil
			gen.modData = oneEach(gen.modData, gen.calcContext.itemCategory) -- a copy: the loaded QueryMods table is shared
			drain(gen.ExecuteQuery, gen)
			gen:FinishQuery()
		end)
		main.defaultItemAffixQuality = prevQuality
		while #main.popups > popups do main:ClosePopup() end
		if not ok then error(err, 0) end

		-- trade id -> where the generator found it (QueryMods entry), for text, range, affix and group
		local ctx = gen.calcContext
		local found = {}
		for _, modType in ipairs(modTypeOrder) do
			for key, entry in pairs(gen.modData[modType] or {}) do
				if entry.tradeMod and entry[ctx.itemCategory] and not found[entry.tradeMod.id] then found[entry.tradeMod.id] = { key = key, entry = entry, modType = modType } end
			end
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
			local m = { id = w.tradeModId, weight = rounded(w.weight), gain = rounded(w.meanStatDiff), invert = w.invert, kind = f and f.modType or json.null,
				affix = json.null, group = json.null, text = json.null, bases = {} }
			if f then
				local range = f.entry[ctx.itemCategory]
				local value = math.ceil((range.max - range.min) * quality + range.min)
				local line = (value == 1 and f.entry.specialCaseData.overrideModLineSingular) or f.entry.specialCaseData.overrideModLine or f.entry.tradeMod.text
				m.text = line:gsub("#", (f.entry.sign or "") .. tostring(value))
				m.range = { min = range.min, max = range.max }
				if listName and f.modType == "Explicit" then
					local a = affixOf(f.key)
					m.group, m.affix = a.group, a.affix
					for name in pairs(a.bases) do m.bases[name] = true end
				end
			end
			mods[#mods + 1] = m
		end

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
		if queryErr or query == nil then query = json.null end
		local search = query ~= json.null and { query = query, sort = { ["statgroup.0"] = "desc" }, engine = "new" } or json.null
		return { family = family, socket = slot.slotName, category = ctx.itemCategoryQueryStr, quality = quality, weights = weightsOut(statWeights),
			total = #mods, mods = out, combinations = combos, query = query, search = search, queryError = queryErr or json.null,
			link = query ~= json.null and tradeLink(realm, args.league, query) or json.null }
	end

	return ops
end
