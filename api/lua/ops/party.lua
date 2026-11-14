-- party.* ops: the Party tab's own controls and buttons (PartyTab.lua), so imports, clears and text edits parse and
-- recalculate exactly as a click does. The tab never fetches: a link import is refused here.
return function(W)
	local ops = {}

	-- The tab's text boxes, by the name this API uses; each box feeds one list that "Rebuild All" parses.
	local boxes = {
		partyMemberStats = "editPartyMemberStats", auras = "editAuras", curses = "editCurses", warcries = "editWarcries",
		links = "editLinks", enemyConditions = "enemyCond", enemyMods = "enemyMods",
	}
	-- The destination dropdown (it has no select function; the buttons read its selection).
	local function destination(tab, name)
		local ctrl = tab.controls.importCodeDestination
		for i, v in ipairs(ctrl.list) do
			if v == name then ctrl.selIndex = i; return end
		end
		W.fail("invalid_input", "destination is one of " .. table.concat(ctrl.list, ", "))
	end
	local function check(ctrl, state)
		ctrl.state = state == true
		ctrl.changeFunc(ctrl.state)
	end

	-- The party inputs as the tab holds them: the text boxes, the parsed summaries (what Path of Building read from
	-- them), the import destination and the toggles.
	function ops.get()
		local b = W.build()
		local tab = b.partyTab
		local c = tab.controls
		local out = {
			destination = c.importCodeDestination.list[c.importCodeDestination.selIndex], append = c.appendNotReplace.state == true,
			showAdvanced = c.ShowAdvanceTools.state == true, exportSupport = tab.enableExportBuffs == true,
		}
		for key, name in pairs(boxes) do out[key] = c[name].buf end
		out.summary = {
			auras = W.strip(c.simpleAuras.label), curses = W.strip(c.simpleCurses.label), warcries = W.strip(c.simpleWarcries.label),
			links = W.strip(c.simpleLinks.label), enemyMods = W.strip(c.simpleEnemyMods.label),
		}
		return out
	end

	-- args: code (a build code exported with "Export support" on), destination? (default: the tab's current one; All, Party
	-- Member Stats, Aura, Curse, Warcry Skills, Link Skills, EnemyConditions, EnemyMods), append? (the Append box).
	-- Types the code in the import box and clicks Import.
	ops.import = W.mutation(function(args, b)
		local tab = b.partyTab
		local c = tab.controls
		if type(args.code) ~= "string" or args.code == "" then W.fail("invalid_input", "code is required") end
		if args.destination ~= nil then destination(tab, args.destination) end
		if args.append ~= nil then check(c.appendNotReplace, args.append) end
		c.importCodeIn:SetText(args.code, true)
		if not tab.importCodeValid then W.fail("invalid_input", "not a build code (" .. W.strip(tab.importCodeDetail or "") .. ")") end
		if not tab.importCodeXML then W.fail("invalid_input", "a link cannot be fetched here; give the build code") end
		if not tab.importCodeXML:find("<ExportedBuffs", 1, true) then
			W.fail("invalid_input", "the code has no exported support data (the sender turns on Export support on the Import/Export tab)")
		end
		c.importCodeGo:Click()
		return {}
	end)

	-- args: destination? (as for import). The Clear button: empties the destination's boxes and parsed effects.
	ops.clear = W.mutation(function(args, b)
		if args.destination ~= nil then destination(b.partyTab, args.destination) end
		b.partyTab.controls.clear:Click()
		return {}
	end)

	-- args: auras?, curses?, warcries?, links?, partyMemberStats?, enemyConditions?, enemyMods? (the boxes' text, as typed in
	-- the Show Advanced Info boxes), showAdvanced?, append?, destination?. Text is parsed with Rebuild All, as the tab says to.
	ops.set = W.mutation(function(args, b)
		local tab = b.partyTab
		local c = tab.controls
		local text = false
		for key, name in pairs(boxes) do
			if args[key] ~= nil then
				if type(args[key]) ~= "string" then W.fail("invalid_input", key .. " takes text") end
				c[name]:SetText(args[key])
				text = true
			end
		end
		if args.showAdvanced ~= nil then check(c.ShowAdvanceTools, args.showAdvanced) end
		if args.append ~= nil then check(c.appendNotReplace, args.append) end
		if args.destination ~= nil then destination(tab, args.destination) end
		if not text and args.showAdvanced == nil and args.append == nil and args.destination == nil then W.fail("invalid_input", "nothing to set") end
		if text then c.rebuild:Click() end
		return {}
	end)

	-- args: enabled. false = the Disable Party Effects button (the data stays); true = Rebuild All (parses the boxes again).
	ops.set_effects = W.mutation(function(args, b)
		if type(args.enabled) ~= "boolean" then W.fail("invalid_input", "enabled is true or false") end
		local c = b.partyTab.controls
		if args.enabled then c.rebuild:Click() else c.removeEffects:Click() end
		return {}
	end)

	return ops
end
