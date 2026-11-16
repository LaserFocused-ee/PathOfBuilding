-- loadouts.* ops: the Loadouts dropdown at the top of the build (Build.lua buildLoadouts / SyncLoadouts). A loadout is a
-- tree whose title matches an item set, a skill set and a config set (or a "{id}" link in the titles); a tab with only
-- one set matches every tree. Choosing one switches all four.
return function(W)
	local main = W.main
	local ops = {}

	-- Our own matching of Build.lua SyncLoadouts: PoB's dropdown misses loadouts whose tree is on an older tree version
	-- (it shows "[3.29] Title", which no set title equals), titles that differ only in colour codes or spacing
	-- ("Lvl 100  Ring" against "Lvl 100 Ring"), and its own handler fails to switch some it lists. Titles are compared
	-- with colour codes taken out and spaces collapsed; "{id}" links pair sets as PoB pairs them.
	local function norm(t)
		return ((t or "Default"):gsub("%^x%x%x%x%x%x%x", ""):gsub("%^%d", ""):gsub("%s+", " "):match("^%s*(.-)%s*$"))
	end
	local function linkOf(title)
		local ids = (title or ""):match("%{([%w,]+)%}")
		if not ids then return nil end
		local name = norm((title:gsub("%{[%w,]+%}", "")))
		return ids, name == "" and "Default" or name
	end

	-- name -> { spec index, item set id, skill set id, config set id }, in the order the trees are listed.
	local function loadouts(b)
		local tabs = {
			{ b.itemsTab.itemSetOrderList, b.itemsTab.itemSets },
			{ b.skillsTab.skillSetOrderList, b.skillsTab.skillSets },
			{ b.configTab.configSetOrderList, b.configTab.configSets },
		}
		local byTitle, byLink = {}, {}
		for t, tab in ipairs(tabs) do
			byTitle[t], byLink[t] = {}, {}
			for _, id in ipairs(tab[1]) do
				local title = tab[2][id].title
				local ids = linkOf(title)
				if ids then
					for l in ids:gmatch("[^,]+") do byLink[t][l] = byLink[t][l] or id end
				else
					local k = norm(title)
					byTitle[t][k] = byTitle[t][k] or id
				end
			end
		end
		local function pick(t, map, key)
			if #tabs[t][1] == 1 then return tabs[t][1][1] end
			return map[t][key]
		end
		local list, sets = {}, {}
		local function add(name, spec, map, key)
			if sets[name] then return end
			local i, s, c = pick(1, map, key), pick(2, map, key), pick(3, map, key)
			if i and s and c then
				list[#list + 1] = name
				sets[name] = { spec, i, s, c }
			end
		end
		for spec, s in ipairs(b.treeTab.specList) do
			local ids, name = linkOf(s.title)
			if ids then
				for l in ids:gmatch("[^,]+") do add(name .. " {" .. l .. "}", spec, byLink, l) end
			else
				add(norm(s.title), spec, byTitle, norm(s.title))
			end
		end
		local cur = { b.treeTab.activeSpec, b.itemsTab.activeItemSetId, b.skillsTab.activeSkillSetId, b.configTab.activeConfigSetId }
		local selected
		for _, n in ipairs(list) do
			local v = sets[n]
			if not selected and v[1] == cur[1] and v[2] == cur[2] and v[3] == cur[3] and v[4] == cur[4] then selected = n end
		end
		return list, selected, sets
	end

	-- Switches each tab to its set, as the dropdown's handler does.
	local function switch(b, v)
		if b.treeTab.activeSpec ~= v[1] then b.treeTab:SetActiveSpec(v[1]) end
		if b.itemsTab.activeItemSetId ~= v[2] then b.itemsTab:SetActiveItemSet(v[2]) end
		if b.skillsTab.activeSkillSetId ~= v[3] then b.skillsTab:SetActiveSkillSet(v[3]) end
		if b.configTab.activeConfigSetId ~= v[4] then b.configTab:SetActiveConfigSet(v[4]) end
		b:SyncLoadouts()
	end

	local function find(b, name)
		local list, _, sets = loadouts(b)
		local v = sets[name] or sets[norm(name)]
		if not v then W.fail("not_found", "no loadout " .. tostring(name) .. "; loadouts: " .. (#list > 0 and table.concat(list, ", ") or "none")) end
		return v, sets[name] and name or norm(name)
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

	-- args: name (as `list` gives it). Switches the tree, item set, skill set and config set.
	ops.activate = W.mutation(function(args, b)
		local v, name = find(b, args.name)
		switch(b, v)
		return { active = name, sets = active(b) }
	end)

	-- args: names? (default every loadout), fields? (output keys; default below). Each loadout is picked in the dropdown and
	-- calculated, then each tab's set is switched back: no revision. fullDpsGroups counts the enabled skill groups
	-- ticked Include in Full DPS (0: FullDPS reads 0).
	local defaultFields = { "FullDPS", "CombinedDPS", "Life", "EnergyShield", "Mana", "TotalEHP" }
	function ops.stats(args)
		local b = W.build()
		local list = loadouts(b)
		local names = type(args.names) == "table" and #args.names > 0 and args.names or list
		local picks = {}
		for i, n in ipairs(names) do picks[i] = { find(b, n) } end
		local fields = type(args.fields) == "table" and #args.fields > 0 and args.fields or defaultFields
		local prev = { b.treeTab.activeSpec, b.itemsTab.activeItemSetId, b.skillsTab.activeSkillSetId, b.configTab.activeConfigSetId }
		local rows = setmetatable({}, { __jsontype = "array" })
		local ok, err = pcall(function()
			for _, p in ipairs(picks) do
				local n = p[2]
				switch(b, p[1])
				b.buildFlag = true
				W.pump()
				b = W.build()
				local output, groups = setmetatable({}, { __jsontype = "object" }), 0
				for _, k in ipairs(fields) do
					local v = nil
					if type(k) == "string" then v = W.outputField(b.calcsTab.mainOutput, k) end
					if v ~= nil then output[k] = W.plain(v) end
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
		local after, _, sets = loadouts(b)
		local entry = sets[norm(name)] and norm(name)
		if not entry then W.fail("worker_error", "the new loadout " .. name .. " is not listed") end
		switch(b, sets[entry])
		-- A tab that had one set matched every tree; with two it no longer does, and loadouts that relied on it drop out.
		local still, dropped = {}, {}
		for _, v in ipairs(after) do still[v] = true end
		for _, v in ipairs(before) do if not still[v] then dropped[#dropped + 1] = v end end
		return { name = entry, sets = active(b), dropped = dropped }
	end)

	return ops
end
