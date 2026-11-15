-- loadouts.* ops: the Loadouts dropdown at the top of the build (Build.lua buildLoadouts / SyncLoadouts). A loadout is a
-- tree whose title matches an item set, a skill set and a config set (or a "{id}" link in the titles); a tab with only
-- one set matches every tree. Choosing one switches all four.
return function(W)
	local main = W.main
	local ops = {}

	local function isEntry(v) return type(v) == "string" and v ~= "No Loadouts" and not v:match("^%^7%^7") end

	local function loadouts(b)
		b:SyncLoadouts()
		local drop = b.controls.buildLoadouts
		local list = {}
		for _, v in ipairs(drop.list) do
			if isEntry(v) then list[#list + 1] = v end
		end
		local selected = drop.list[drop.selIndex]
		return list, isEntry(selected) and selected or nil
	end

	local function titleOf(set) return set and set.title or "Default" end
	local function active(b)
		return {
			tree = titleOf(b.treeTab.specList[b.treeTab.activeSpec]),
			items = titleOf(b.itemsTab.itemSets[b.itemsTab.activeItemSetId]),
			skills = titleOf(b.skillsTab.skillSets[b.skillsTab.activeSkillSetId]),
			config = titleOf(b.configTab.configSets[b.configTab.activeConfigSetId]),
		}
	end

	function ops.list()
		local b = W.build()
		local list, selected = loadouts(b)
		return { loadouts = list, active = selected or W.json.null, sets = active(b) }
	end

	-- args: name (as `list` gives it). The dropdown entry.
	ops.activate = W.mutation(function(args, b)
		local list = loadouts(b)
		local found
		for _, v in ipairs(list) do if v == args.name then found = v end end
		if not found then W.fail("not_found", "no loadout " .. tostring(args.name) .. "; loadouts: " .. table.concat(list, ", ")) end
		W.choose(b.controls.buildLoadouts, function(v) return v == found end)
		local _, selected = loadouts(b)
		if selected ~= found then W.fail("worker_error", "Path of Building did not switch to " .. found) end
		return { active = found, sets = active(b) }
	end)

	-- args: names? (default every loadout), fields? (output keys; default below). Each loadout is picked in the dropdown and
	-- calculated, then each tab's set is switched back: no revision. fullDpsGroups counts the enabled skill groups
	-- ticked Include in Full DPS (0: FullDPS reads 0).
	local defaultFields = { "FullDPS", "CombinedDPS", "Life", "EnergyShield", "Mana", "TotalEHP" }
	function ops.stats(args)
		local b = W.build()
		local list = loadouts(b)
		local names = type(args.names) == "table" and #args.names > 0 and args.names or list
		for _, n in ipairs(names) do
			local known = false
			for _, v in ipairs(list) do if v == n then known = true end end
			if not known then W.fail("not_found", "no loadout " .. tostring(n) .. "; loadouts: " .. table.concat(list, ", ")) end
		end
		local fields = type(args.fields) == "table" and #args.fields > 0 and args.fields or defaultFields
		local prev = { b.treeTab.activeSpec, b.itemsTab.activeItemSetId, b.skillsTab.activeSkillSetId, b.configTab.activeConfigSetId }
		local rows = setmetatable({}, { __jsontype = "array" })
		local ok, err = pcall(function()
			for _, n in ipairs(names) do
				W.choose(b.controls.buildLoadouts, function(v) return v == n end)
				b.buildFlag = true
				W.pump()
				b = W.build()
				local output, groups = setmetatable({}, { __jsontype = "object" }), 0
				for _, k in ipairs(fields) do
					if type(k) == "string" and b.calcsTab.mainOutput[k] ~= nil then output[k] = W.plain(b.calcsTab.mainOutput[k]) end
				end
				for _, g in ipairs(b.skillsTab.socketGroupList) do
					if g.enabled and g.includeInFullDPS then groups = groups + 1 end
				end
				rows[#rows + 1] = { name = n, sets = active(b), fullDpsGroups = groups, output = output }
			end
		end)
		-- each tab's own set switch back, as compare_item_sets does (a reload would rewrite the code's defaults)
		b = W.build()
		if b.treeTab.activeSpec ~= prev[1] then b.treeTab:SetActiveSpec(prev[1]) end
		if b.itemsTab.activeItemSetId ~= prev[2] then b.itemsTab:SetActiveItemSet(prev[2]) end
		if b.skillsTab.activeSkillSetId ~= prev[3] then b.skillsTab:SetActiveSkillSet(prev[3]) end
		if b.configTab.activeConfigSetId ~= prev[4] then b.configTab:SetActiveConfigSet(prev[4]) end
		b:SyncLoadouts()
		b.buildFlag = true
		W.pump()
		if not ok then error(err, 0) end
		return { loadouts = rows }
	end

	-- The position of the active set in a tab's order list.
	local function position(order, id)
		for i, v in ipairs(order) do if v == id then return i end end
	end

	-- Runs a list action of a tab's Manage popup (as the tree, skills, items and config ops do).
	local function manage(open, listOf, button, index, title)
		open()
		local manager = main.popups[1]
		local ok, err = pcall(W.listAction, listOf(manager), button, index, title)
		while main.popups[1] and main.popups[1] ~= manager do main:ClosePopup() end
		main:ClosePopup()
		if not ok then error(err, 0) end
	end

	-- args: name, empty? (true: Path of Building's New Loadout, four empty sets; default: copies of the active tree, item
	-- set, skill set and config set). Then switches to it.
	ops.new = W.mutation(function(args, b)
		local name = args.name
		if type(name) ~= "string" or not name:match("%S") or name:find("[{}]") or name:match("^%^7") then
			W.fail("invalid_input", "a loadout name is plain text without { or }")
		end
		local before = loadouts(b)
		local tabs = {
			{ "tree", b.treeTab.specList, function(s) return s end },
			{ "item set", b.itemsTab.itemSetOrderList, function(id) return b.itemsTab.itemSets[id] end },
			{ "skill set", b.skillsTab.skillSetOrderList, function(id) return b.skillsTab.skillSets[id] end },
			{ "config set", b.configTab.configSetOrderList, function(id) return b.configTab.configSets[id] end },
		}
		for _, t in ipairs(tabs) do
			for _, entry in ipairs(t[2]) do
				if titleOf(t[3](entry)) == name then W.fail("invalid_input", "a " .. t[1] .. " is titled " .. name .. " already") end
			end
		end
		if args.empty then
			W.choose(b.controls.buildLoadouts, function(v) return v == "^7^7New Loadout" end)
			local popup = main.popups[1]
			if not popup then W.fail("worker_error", "expected the New Loadout dialog") end
			popup.controls.edit:SetText(name, true)
			W.clickPopup("save")
		else
			local first = function(m) return m.controls[1] end
			manage(function() b.treeTab:OpenSpecManagePopup() end, first, "copy", b.treeTab.activeSpec, name)
			manage(function() b.itemsTab:OpenItemSetManagePopup() end, function(m) return m.controls.setList end, "copy",
				position(b.itemsTab.itemSetOrderList, b.itemsTab.activeItemSetId), name)
			manage(function() b.skillsTab:OpenSkillSetManagePopup() end, first, "copy",
				position(b.skillsTab.skillSetOrderList, b.skillsTab.activeSkillSetId), name)
			manage(function() b.configTab:OpenConfigSetManagePopup() end, first, "copy",
				position(b.configTab.configSetOrderList, b.configTab.activeConfigSetId), name)
		end
		local after = loadouts(b)
		local entry
		for _, v in ipairs(after) do if v == name or v:match("^%[[^%]]+%] (.*)$") == name then entry = v end end
		if not entry then W.fail("worker_error", "the new loadout " .. name .. " is not listed") end
		W.choose(b.controls.buildLoadouts, function(v) return v == entry end)
		-- A tab that had one set matched every tree; with two it no longer does, and loadouts that relied on it drop out.
		local still, dropped = {}, {}
		for _, v in ipairs(after) do still[v] = true end
		for _, v in ipairs(before) do if not still[v] then dropped[#dropped + 1] = v end end
		return { name = entry, sets = active(b), dropped = dropped }
	end)

	return ops
end
