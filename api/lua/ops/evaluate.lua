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

	local function slotOf(tab, name)
		local slot = tab.slots[name]
		if not slot then bad("no item slot " .. tostring(name)) end
		if slot.nodeId then bad("jewel sockets are not evaluated (a jewel can change the tree)") end
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

	-- args: item (id) or text, slot? (default every slot it fits), fields?. The item in each slot in place of what it holds.
	function ops.compare_item(args)
		local b = W.build()
		local tab = b.itemsTab
		local item = itemOf(tab, args)
		if item.base.flask or item.base.tincture then bad("flasks and tinctures are compared with what_if (toggleFlask / toggleTincture)") end
		local slots = {}
		if args.slot ~= nil then
			local slot = slotOf(tab, args.slot)
			if not tab:IsItemValidForSlot(item, args.slot) then bad("this item does not fit " .. args.slot) end
			if not slotInUse(tab, slot) then bad(args.slot .. " is not in use (weapon set or socket not active)") end
			slots[1] = slot
		else
			for _, slot in ipairs(tab.orderedSlots) do
				if not slot.nodeId and tab:IsItemValidForSlot(item, slot.slotName) and slotInUse(tab, slot) then slots[#slots + 1] = slot end
			end
			if #slots == 0 then bad("this item fits no equipment slot in use (jewel sockets are not compared)") end
		end
		local fields = fieldsOf(args)
		local calcFunc, calcBase = calculator(b)
		local before = values(b, calcBase, fields)
		local out = {}
		for _, slot in ipairs(slots) do
			out[#out + 1] = { slot = slot.slotName, equipped = equippedIn(tab, slot),
				changed = diff(before, values(b, calcFunc({ repSlotName = slot.slotName, repItem = item }), fields)) }
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

	return ops
end
