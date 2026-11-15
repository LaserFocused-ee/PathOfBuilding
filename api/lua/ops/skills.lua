-- skills.* ops: socket groups, gems, the main skill, skill sets and gem options, through the Skills tab's
-- own controls and functions (SkillsTab.lua, SkillListControl.lua, SkillSetListControl.lua, Build.lua).
return function(W)
	local main = W.main
	local ops = {}

	local function groupOf(tab, index)
		local g = tab.socketGroupList[index]
		if not g then W.fail("not_found", "no socket group " .. tostring(index)) end
		return g
	end
	local function editable(g)
		if g.source then W.fail("invalid_input", "this socket group comes from an item and cannot be edited") end
	end

	local function sets(tab)
		local out = {}
		for i, id in ipairs(tab.skillSetOrderList) do
			out[#out + 1] = { index = i, title = tab.skillSets[id].title or "Default", active = id == tab.activeSkillSetId }
		end
		return out
	end

	local function labels(ctrl)
		local out = {}
		for i, v in ipairs(ctrl.list) do out[i] = W.strip(type(v) == "table" and v.label or v) end
		return out
	end

	-- The sidebar's main skill choices (Build.lua:480-560), those the main skill shows; a control that is hidden is absent.
	local function mainOptions(b)
		local c, out = b.controls, {}
		if c.mainSkillPart:IsShown() then out.part, out.parts = c.mainSkillPart.selIndex, labels(c.mainSkillPart) end
		if c.mainSkillStageCount:IsShown() then out.stages = tonumber(c.mainSkillStageCount.buf) end
		if c.mainSkillMineCount:IsShown() then out.mines = tonumber(c.mainSkillMineCount.buf) or 0 end -- empty box = no count entered
		if c.mainSkillMinion:IsShown() then out.minion, out.minions = c.mainSkillMinion.selIndex, labels(c.mainSkillMinion) end
		if c.mainSkillMinionSkill:IsShown() then out.minionSkill, out.minionSkills = c.mainSkillMinionSkill.selIndex, labels(c.mainSkillMinionSkill) end
		return out
	end

	local function spectres(b)
		local out = {}
		for i, id in ipairs(b.spectreList) do out[i] = { id = id, name = b.data.minions[id].name } end
		return out
	end

	-- Socket groups as the Skills tab lists them, gems with what Path of Building resolved them to.
	function ops.get()
		local b = W.build()
		local tab = b.skillsTab
		local groups = {}
		for i, g in ipairs(tab.socketGroupList) do
			local gems = {}
			for j, gem in ipairs(g.gemList) do
				gems[#gems + 1] = {
					index = j, name = gem.gemData and gem.gemData.name or gem.nameSpec, level = gem.level, quality = gem.quality,
					enabled = gem.enabled ~= false, count = gem.count or 1, support = gem.gemData and gem.gemData.grantedEffect.support or false,
					error = gem.errMsg and W.strip(gem.errMsg) or nil,
				}
			end
			local skills = {}
			for _, s in ipairs(g.displaySkillList or {}) do
				skills[#skills + 1] = s.activeEffect.grantedEffect.name
			end
			groups[#groups + 1] = {
				index = i, label = W.strip(g.displayLabel or g.label or ""), slot = g.slot, enabled = g.enabled ~= false,
				includeInFullDPS = g.includeInFullDPS == true, source = g.source, imbuedSupport = g.imbuedSupport,
				gems = gems, activeSkills = skills, mainActiveSkill = g.mainActiveSkill, main = i == b.mainSocketGroup,
			}
		end
		return {
			mainSocketGroup = b.mainSocketGroup, groups = groups, sets = sets(tab), mainOptions = mainOptions(b), spectres = spectres(b),
			options = { defaultGemLevel = tab.defaultGemLevel, defaultGemQuality = tab.defaultGemQuality, showSupportGemTypes = tab.showSupportGemTypes, showLegacyGems = tab.showLegacyGems == true },
		}
	end

	-- The group as Path of Building copies it (Ctrl+C on the group list).
	function ops.group_text(args)
		local tab = W.build().skillsTab
		local g = groupOf(tab, args.group)
		editable(g)
		tab:CopySocketGroup(g)
		return { text = (W.takeCopied() or ""):gsub("\r\n", "\n") }
	end

	-- The hover text of the group list (SkillsTab:AddSocketGroupTooltip).
	function ops.group_tooltip(args)
		local tab = W.build().skillsTab
		local g = groupOf(tab, args.group)
		return { group = args.group, label = g.label or "", lines = W.tooltip(function(t) tab:AddSocketGroupTooltip(t, g) end) }
	end

	-- args: group, skill? (position in the group's active skills; default its main one), query?, offset?, limit?
	-- The support gems the gem box offers for an active skill: those calcLib says can support it, without the gems the box
	-- hides (hideFromGemList; legacy and exceptional ones as the Skills tab's options show them; GemSelectControl:FilterSupport).
	function ops.support_compatible(args)
		local tab = W.build().skillsTab
		local g = groupOf(tab, args.group)
		local skills = g.displaySkillList or {}
		local active = skills[args.skill or g.mainActiveSkill or 1]
		if not active then W.fail("not_found", "group " .. args.group .. " has no active skill " .. tostring(args.skill or g.mainActiveSkill or 1)) end
		local show = tab.showSupportGemTypes
		local list = {}
		for id, gem in pairs(data.gems) do
			local ge = gem.grantedEffect
			local exceptional = (ge.legacy and ge.plusVersionOf) or gem.tagString:match("Exceptional")
			if ge.support and not ge.hideFromGemList and (tab.showLegacyGems or not ge.legacy)
				and (show == "ALL" or (show == "NORMAL" and not exceptional) or (show == "EXCEPTIONAL" and exceptional))
				and (args.query == nil or args.query == "" or gem.name:lower():find(args.query:lower(), 1, true))
				and calcLib.canGrantedEffectSupportActiveSkill(ge, active) then
				local tags = {}
				for t in pairs(gem.tags or {}) do tags[#tags + 1] = t end
				table.sort(tags)
				list[#list + 1] = { name = gem.name, id = id, tags = tags }
			end
		end
		table.sort(list, function(a, b)
			if a.name ~= b.name then return a.name < b.name end
			return a.id < b.id
		end)
		local out, offset = {}, math.max(0, math.floor(tonumber(args.offset) or 0))
		local limit = math.max(1, math.min(200, math.floor(tonumber(args.limit) or 20)))
		for i = offset + 1, math.min(#list, offset + limit) do out[#out + 1] = list[i] end
		return { group = args.group, skill = active.activeEffect.grantedEffect.name, total = #list, offset = offset, gems = out }
	end

	-- The hover text of a gem name box (GemTooltip.AddGemTooltip).
	function ops.gem_tooltip(args)
		local b = W.build()
		local g = groupOf(b.skillsTab, args.group)
		local gem = g.gemList[args.gem]
		if not gem then W.fail("not_found", "no gem " .. tostring(args.gem)) end
		if not gem.gemData then W.fail("invalid_input", "gem " .. args.gem .. " of group " .. args.group .. " is not a known gem") end
		return { group = args.group, gem = args.gem, name = gem.gemData.name, lines = W.tooltip(function(t) require("Classes.GemTooltip").AddGemTooltip(t, b, gem) end) }
	end

	-- args: text (the copy format: optional "Label: ..." and "Slot: ..." lines, then "<gem> <level>/<quality> [DISABLED] <count>"
	-- lines), or gems ({ name, level?, quality?, enabled?, count? }) with label? and slot?. Ctrl+V on the group list.
	ops.add_group = W.mutation(function(args, b)
		local tab = b.skillsTab
		local text = args.text
		if text == nil then
			if type(args.gems) ~= "table" or #args.gems == 0 then W.fail("invalid_input", "text or gems is required") end
			local lines = {}
			if args.label then lines[#lines + 1] = "Label: " .. args.label end
			if args.slot then lines[#lines + 1] = "Slot: " .. args.slot end
			for _, g in ipairs(args.gems) do
				lines[#lines + 1] = string.format("%s %d/%d %s %d", g.name, g.level or 20, g.quality or 0, g.enabled == false and "DISABLED" or "", g.count or 1)
			end
			text = table.concat(lines, "\n")
		end
		local before = #tab.socketGroupList
		tab:PasteSocketGroup(text)
		if #tab.socketGroupList ~= before + 1 then W.fail("invalid_input", "no gems found in the text") end
		local g = tab.socketGroupList[#tab.socketGroupList]
		tab:ProcessSocketGroup(g)
		for _, gem in ipairs(g.gemList) do
			if not gem.gemData then W.fail("invalid_input", "unknown gem " .. tostring(gem.nameSpec)) end
		end
		-- A gem given without a level gets the one the Default gem level box picks, as a gem added by hand does.
		if args.text == nil then
			for i, given in ipairs(args.gems) do
				if given.level == nil and g.gemList[i] then g.gemList[i].level = tab:ProcessGemLevel(g.gemList[i].gemData) end
			end
			tab:ProcessSocketGroup(g)
		end
		return { group = #tab.socketGroupList }
	end)

	local function setCheck(ctrl, state)
		ctrl.state = state
		ctrl.changeFunc(state)
	end

	-- args: group, label?, slot? (an item slot name, or "None"), enabled?, includeInFullDPS?, count? (item-granted groups).
	ops.update_group = W.mutation(function(args, b)
		local tab = b.skillsTab
		local g = groupOf(tab, args.group)
		tab:SetDisplayGroup(g)
		local c = tab.controls
		if args.label ~= nil then editable(g); c.groupLabel:SetText(args.label, true) end
		if args.slot ~= nil then
			editable(g)
			local done = false
			for i, v in ipairs(c.groupSlot.list) do
				if (args.slot == "None" and v.slotName == nil) or v.slotName == args.slot then
					c.groupSlot.selIndex = i
					c.groupSlot.selFunc(i, v)
					done = true
					break
				end
			end
			if not done then W.fail("invalid_input", "no item slot " .. tostring(args.slot)) end
		end
		if args.enabled ~= nil then setCheck(c.groupEnabled, args.enabled) end
		if args.includeInFullDPS ~= nil then setCheck(c.includeInFullDPS, args.includeInFullDPS) end
		if args.count ~= nil then
			if not g.source then W.fail("invalid_input", "count applies to groups granted by items") end
			c.groupCount:SetText(tostring(args.count), true)
		end
		return { group = args.group }
	end)

	-- args: group. The group list's Delete button.
	ops.delete_group = W.mutation(function(args, b)
		local tab = b.skillsTab
		local g = groupOf(tab, args.group)
		editable(g)
		local list = tab.controls.groupList
		list.selIndex, list.selValue = args.group, g
		list.controls.delete:Click()
		if main.popups[1] then W.clickPopup("confirm") end
		return { groups = #tab.socketGroupList }
	end)

	-- args: group, to. A drag in the group list (ListControl.lua:441), main skill index kept.
	ops.move_group = W.mutation(function(args, b)
		local tab = b.skillsTab
		local g = groupOf(tab, args.group)
		if type(args.to) ~= "number" or not tab.socketGroupList[args.to] then W.fail("not_found", "no socket group position " .. tostring(args.to)) end
		if args.to == args.group then return { group = args.to } end
		local list = tab.controls.groupList
		table.remove(list.list, args.group)
		table.insert(list.list, args.to, g)
		list:OnOrderChange(args.group, args.to)
		return { group = args.to }
	end)

	-- args: group, skill? (index into the group's active skills). The sidebar's main skill dropdowns.
	ops.set_main = W.mutation(function(args, b)
		local tab = b.skillsTab
		local g = groupOf(tab, args.group)
		b.controls.mainSocketGroup.selFunc(args.group)
		if args.skill ~= nil then
			tab:ProcessSocketGroup(g)
			if not (g.displaySkillList or {})[args.skill] then W.fail("not_found", "group " .. args.group .. " has no active skill " .. tostring(args.skill)) end
			b.controls.mainSkill.selFunc(args.skill)
		end
		return function(built)
			local mg = built.skillsTab.socketGroupList[built.mainSocketGroup]
			local s = mg and mg.displaySkillList and mg.displaySkillList[mg.mainActiveSkill or 1]
			return { mainSocketGroup = built.mainSocketGroup, mainSkill = s and s.activeEffect.grantedEffect.name or nil }
		end
	end)

	-- Picks a dropdown entry by 1-based number or by its label (or minion id).
	local function choose(ctrl, want, what)
		local i
		if type(want) == "number" then
			i = ctrl.list[want] and want
		else
			for n, v in ipairs(ctrl.list) do
				if type(v) == "table" and (v.label == want or v.minionId == want) or v == want then i = n; break end
			end
		end
		if not i then W.fail("invalid_input", "no " .. what .. " " .. tostring(want) .. "; choices: " .. table.concat(labels(ctrl), ", ")) end
		ctrl.selIndex = i
		ctrl.selFunc(i, ctrl.list[i])
	end
	local function number(v, what)
		if type(v) ~= "number" or v ~= math.floor(v) or v < 0 then W.fail("invalid_input", what .. " is a whole number, 0 or more") end
		return tostring(v)
	end
	-- A sidebar control of the main skill, which must be shown (the skill has that choice).
	local function shown(b, name, what)
		local ctrl = b.controls[name]
		if not ctrl:IsShown() then W.fail("invalid_input", "the main skill has no " .. what .. " choice") end
		return ctrl
	end

	-- args: part?, stages?, mines?, minion?, minionSkill?: the main skill's sidebar controls (Skill part, Stages, Active
	-- Mines, the minion and minion skill dropdowns), for the main socket group (`set_main` first to change it). Dropdowns
	-- take a 1-based number or the label; the controls show after a recalculation, so part and minion go first.
	ops.set_skill_options = W.mutation(function(args, b)
		if args.part == nil and args.stages == nil and args.mines == nil and args.minion == nil and args.minionSkill == nil then
			W.fail("invalid_input", "part, stages, mines, minion or minionSkill is required")
		end
		local function settle()
			b.buildFlag = true
			W.pump()
		end
		if args.part ~= nil then choose(shown(b, "mainSkillPart", "part"), args.part, "part"); settle() end
		if args.minion ~= nil then choose(shown(b, "mainSkillMinion", "minion"), args.minion, "minion"); settle() end
		if args.stages ~= nil then shown(b, "mainSkillStageCount", "stages"):SetText(number(args.stages, "stages"), true) end
		if args.mines ~= nil then shown(b, "mainSkillMineCount", "active mines"):SetText(number(args.mines, "mines"), true) end
		if args.minionSkill ~= nil then choose(shown(b, "mainSkillMinionSkill", "minion skill"), args.minionSkill, "minion skill") end
		settle()
		return mainOptions(b)
	end)

	-- args: add? (spectres to put in the library, by name or id), remove? (by name or id). The Manage Spectres... popup:
	-- pick in the source list and Add, pick in the library and Remove, Save.
	ops.set_spectres = W.mutation(function(args, b)
		local add, remove = args.add or {}, args.remove or {}
		if type(add) ~= "table" or type(remove) ~= "table" or #add + #remove == 0 then W.fail("invalid_input", "add or remove is required") end
		b:OpenSpectreLibrary()
		local popup = main.popups[1]
		local ok, err = pcall(function()
			local list, source = popup.controls.list, popup.controls.source
			local function find(ctrl, want)
				for i, id in ipairs(ctrl.list) do
					if id == want or b.data.minions[id].name == want then return i, id end
				end
				W.fail("invalid_input", "no spectre " .. tostring(want))
			end
			for _, want in ipairs(remove) do
				list.selIndex, list.selValue = find(list, want)
				list.controls.delete:Click()
			end
			for _, want in ipairs(add) do
				source.selIndex, source.selValue = find(source, want)
				if source.controls.add:IsEnabled() then source.controls.add:Click() end
			end
			popup.controls.save:Click()
		end)
		while main.popups[1] do main:ClosePopup() end
		if not ok then error(err, 0) end
		return { spectres = spectres(b) }
	end)

	-- Selects a gem in a gem name box the way picking it from the dropdown does (GemSelectControl:UpdateGem).
	local function pickGem(ctrl, name)
		local want = tostring(name):lower():gsub(" support$", "")
		local found
		for gemId, gem in pairs(ctrl.gems) do
			local n = gem.name:lower()
			if n == want or n:gsub(" support$", "") == want then found = gemId end
		end
		if not found then W.fail("invalid_input", "unknown gem " .. tostring(name)) end
		ctrl:SetText(ctrl.gems[found].name)
		ctrl.list = { found }
		ctrl.selIndex = 1
		ctrl:UpdateGem(false, true)
	end

	-- args: group, gem (position; one past the last adds a gem), name?, level?, quality?, enabled?, count?. The gem row controls.
	ops.set_gem = W.mutation(function(args, b)
		local tab = b.skillsTab
		local g = groupOf(tab, args.group)
		editable(g)
		tab:SetDisplayGroup(g)
		local i = args.gem
		if type(i) ~= "number" or i < 1 or i > #g.gemList + 1 then W.fail("not_found", "no gem position " .. tostring(i)) end
		if i == #g.gemList + 1 and args.name == nil then W.fail("invalid_input", "a new gem needs a name") end
		local slot = tab.gemSlots[i]
		if args.name ~= nil then pickGem(slot.nameSpec, args.name) end
		if args.level ~= nil then slot.level:SetText(tostring(args.level), true) end
		if args.quality ~= nil then slot.quality:SetText(tostring(args.quality), true) end
		if args.enabled ~= nil then setCheck(slot.enabled, args.enabled) end
		if args.count ~= nil then slot.count:SetText(tostring(args.count), true) end
		local gem = g.gemList[i]
		return { group = args.group, gem = i, name = gem.gemData and gem.gemData.name or gem.nameSpec, level = gem.level, quality = gem.quality }
	end)

	-- args: group, gem. The gem row's x button.
	ops.delete_gem = W.mutation(function(args, b)
		local tab = b.skillsTab
		local g = groupOf(tab, args.group)
		editable(g)
		tab:SetDisplayGroup(g)
		if not g.gemList[args.gem] then W.fail("not_found", "no gem " .. tostring(args.gem)) end
		tab.gemSlots[args.gem].delete:Click()
		return { gems = #g.gemList }
	end)

	-- args: group, name (a support gem, or "None"). The Imbued Support box (needs the group socketed in an item slot).
	ops.set_imbued = W.mutation(function(args, b)
		local tab = b.skillsTab
		local g = groupOf(tab, args.group)
		editable(g)
		tab:SetDisplayGroup(g)
		local ctrl = tab.controls.imbuedSupport
		if not ctrl:IsEnabled() then W.fail("invalid_input", "socket the group in an item slot first (one imbued support per slot)") end
		if args.name == "None" then
			tab.controls.imbuedSupportClear:Click()
		else
			pickGem(ctrl, args.name)
		end
		return { imbuedSupport = g.imbuedSupport }
	end)

	-- args: group. The Optimise Sockets button: reorders gems to match the socketed item's colours.
	ops.optimise_sockets = W.mutation(function(args, b)
		local tab = b.skillsTab
		local g = groupOf(tab, args.group)
		editable(g)
		tab:SetDisplayGroup(g)
		if not tab.controls.optimiseSockets:IsShown() or not tab.controls.optimiseSockets:IsEnabled() then
			W.fail("invalid_input", "the group is not socketed in an item with sockets")
		end
		tab.controls.optimiseSockets:Click()
		local names = {}
		for _, gem in ipairs(g.gemList) do names[#names + 1] = gem.gemData and gem.gemData.name or gem.nameSpec end
		return { gems = names }
	end)

	-- args: defaultGemLevel? (a choice of the Default gem level box), defaultGemQuality?, showSupportGemTypes?, showLegacyGems?.
	ops.set_options = W.mutation(function(args, b)
		local tab = b.skillsTab
		local c = tab.controls
		if args.defaultGemLevel ~= nil then
			if not W.choose(c.defaultLevel, function(v) return v.gemLevel == args.defaultGemLevel end) then W.fail("invalid_input", "unknown default gem level " .. tostring(args.defaultGemLevel)) end
		end
		if args.defaultGemQuality ~= nil then c.defaultQuality:SetText(tostring(args.defaultGemQuality), true) end
		if args.showSupportGemTypes ~= nil then
			if not W.choose(c.showSupportGemTypes, function(v) return v.show == args.showSupportGemTypes end) then W.fail("invalid_input", "showSupportGemTypes is ALL, NORMAL or EXCEPTIONAL") end
		end
		if args.showLegacyGems ~= nil then setCheck(c.showLegacyGems, args.showLegacyGems) end
		return { defaultGemLevel = tab.defaultGemLevel, defaultGemQuality = tab.defaultGemQuality, showSupportGemTypes = tab.showSupportGemTypes, showLegacyGems = tab.showLegacyGems == true }
	end)

	-- Skill sets: the manager's buttons (SkillSetListControl.lua) and the set dropdown (SkillsTab.lua:99).
	local function manage(b, button, index, title)
		b.skillsTab:OpenSkillSetManagePopup()
		local manager = main.popups[1]
		local ok, err = pcall(W.listAction, manager.controls[1], button, index, title)
		while main.popups[1] and main.popups[1] ~= manager do main:ClosePopup() end
		main:ClosePopup()
		if not ok then error(err, 0) end
	end
	ops.set_new = W.mutation(function(args, b)
		manage(b, "new", nil, args.title or "New skill set")
		return { sets = sets(b.skillsTab) }
	end)
	ops.set_copy = W.mutation(function(args, b)
		local id = b.skillsTab.skillSetOrderList[args.index]
		manage(b, "copy", args.index, args.title or ((id and b.skillsTab.skillSets[id].title) or "Default") .. " copy")
		return { sets = sets(b.skillsTab) }
	end)
	ops.set_rename = W.mutation(function(args, b)
		manage(b, "rename", args.index, args.title)
		return { sets = sets(b.skillsTab) }
	end)
	ops.set_delete = W.mutation(function(args, b)
		manage(b, "delete", args.index)
		return { sets = sets(b.skillsTab) }
	end)
	ops.set_activate = W.mutation(function(args, b)
		local tab = b.skillsTab
		if not tab.skillSetOrderList[args.index] then W.fail("not_found", "no skill set " .. tostring(args.index)) end
		tab.controls.setSelect.selFunc(args.index)
		return { sets = sets(tab) }
	end)

	return ops
end
