-- config.* ops: Configuration tab values and config sets, the Notes tab, and the level controls on the top bar.
-- Values are set through each option's own control callback (ConfigTab.lua:296), so the tab's undo, mod list
-- rebuild and recalculation run exactly as for a click or keystroke.
return function(W)
	local main = W.main
	local ops = {}
	local varList = require("Modules.ConfigOptions")
	local byVar = {}
	for _, v in ipairs(varList) do
		if v.var then byVar[v.var] = v end
	end

	local function sets(tab)
		local out = {}
		for i, id in ipairs(tab.configSetOrderList) do
			out[#out + 1] = { index = i, title = tab.configSets[id].title or "Default", active = id == tab.activeConfigSetId }
		end
		return out
	end

	-- Values on the active config set that differ from their default, plus the set list and level settings.
	function ops.get()
		local b = W.build()
		local tab = b.configTab
		local values = {}
		for var, value in pairs(tab.input) do
			if byVar[var] and value ~= tab.defaultState[var] and not (value == false and tab.defaultState[var] == nil) then
				values[var] = W.plain(value)
			end
		end
		return {
			values = setmetatable(values, { __jsontype = "object" }), sets = sets(tab),
			level = b.characterLevel, autoLevel = b.characterLevelAutoMode == true,
		}
	end

	local function setOne(tab, var, value)
		local v = byVar[var]
		local control = tab.varControls[var]
		if not v or not control then W.fail("invalid_input", "unknown config option " .. tostring(var)) end
		if v.type == "check" then
			if type(value) ~= "boolean" then W.fail("invalid_input", var .. " takes true or false") end
			control.state = value
			control.changeFunc(value)
		elseif v.type == "list" then
			for i, item in ipairs(v.list) do
				if item.val == value then
					control.selIndex = i
					control.selFunc(i, item)
					return
				end
			end
			W.fail("invalid_input", var .. " has no choice " .. tostring(value))
		elseif v.type == "text" then
			if type(value) ~= "string" then W.fail("invalid_input", var .. " takes text") end
			control:SetText(value, true)
		elseif v.type == "count" or v.type == "integer" or v.type == "countAllowZero" or v.type == "float" then
			if type(value) ~= "number" then W.fail("invalid_input", var .. " takes a number") end
			if v.type ~= "float" and value ~= math.floor(value) then W.fail("invalid_input", var .. " takes a whole number") end
			if v.type == "count" and value < 0 then W.fail("invalid_input", var .. " cannot be negative") end
			control:SetText(tostring(value), true)
		else
			W.fail("invalid_input", var .. " cannot be set")
		end
	end

	-- args: values? ({ var = value }), reset? (vars to put back to their default).
	ops.set = W.mutation(function(args, b)
		local values, reset = args.values or {}, args.reset or {}
		if type(values) ~= "table" or type(reset) ~= "table" or (next(values) == nil and #reset == 0) then W.fail("invalid_input", "values or reset is required") end
		local tab = b.configTab
		for _, var in ipairs(reset) do
			if not byVar[var] then W.fail("invalid_input", "unknown config option " .. tostring(var)) end
			setOne(tab, var, tab.defaultState[var])
		end
		for var, value in pairs(values) do setOne(tab, var, value) end
		local out = {}
		for var in pairs(values) do out[var] = W.plain(tab.input[var]) end
		for _, var in ipairs(reset) do out[var] = W.plain(tab.input[var]) end
		return { values = out }
	end)

	-- Runs one button of the config set manager (ConfigSetListControl.lua), then closes it.
	local function manage(b, button, index, title)
		b.configTab:OpenConfigSetManagePopup()
		local manager = main.popups[1]
		local ok, err = pcall(W.listAction, manager.controls[1], button, index, title)
		while main.popups[1] and main.popups[1] ~= manager do main:ClosePopup() end
		main:ClosePopup()
		if not ok then error(err, 0) end
		b.configTab:UpdateControls()
	end

	ops.set_new = W.mutation(function(args, b)
		manage(b, "new", nil, args.title or "New config")
		return { sets = sets(b.configTab) }
	end)
	ops.set_copy = W.mutation(function(args, b)
		local id = b.configTab.configSetOrderList[args.index]
		manage(b, "copy", args.index, args.title or ((id and b.configTab.configSets[id].title) or "Default") .. " copy")
		return { sets = sets(b.configTab) }
	end)
	ops.set_rename = W.mutation(function(args, b)
		manage(b, "rename", args.index, args.title)
		return { sets = sets(b.configTab) }
	end)
	ops.set_delete = W.mutation(function(args, b)
		manage(b, "delete", args.index)
		return { sets = sets(b.configTab) }
	end)
	-- args: index. The config set dropdown's handler (ConfigTab.lua:166).
	ops.set_activate = W.mutation(function(args, b)
		local tab = b.configTab
		if not tab.configSetOrderList[args.index] then W.fail("not_found", "no config set " .. tostring(args.index)) end
		tab.controls.setSelect.selFunc(args.index)
		return { sets = sets(tab) }
	end)

	-- The Notes tab text, colour codes as written (^1 .. ^9, ^xRRGGBB).
	function ops.notes()
		return { text = W.build().notesTab.controls.edit.buf }
	end
	-- args: text
	ops.set_notes = W.mutation(function(args, b)
		if type(args.text) ~= "string" then W.fail("invalid_input", "text is required") end
		b.notesTab.controls.edit:SetText(args.text)
		b.notesTab.modFlag = true
		return {}
	end)

	-- args: level?, autoLevel?. The level box and the Auto/Manual button (Build.lua:215).
	ops.set_level = W.mutation(function(args, b)
		if args.level ~= nil then
			if type(args.level) ~= "number" or args.level ~= math.floor(args.level) or args.level < 1 or args.level > 100 then
				W.fail("invalid_input", "level is a whole number from 1 to 100")
			end
			b.controls.characterLevel:SetText(tostring(args.level), true)
		end
		if args.autoLevel ~= nil and (b.characterLevelAutoMode == true) ~= (args.autoLevel == true) then
			b.controls.levelScalingButton:Click()
		end
		return function(built) return { level = built.characterLevel, autoLevel = built.characterLevelAutoMode == true } end
	end)

	-- The Configuration tab's custom modifier groups of the active config set, each line marked as Path of Building reads it
	-- (ConfigTab.lua: a line counts when modLib.parseMod parses it whole; the box shows the others as unsupported).
	local function customGroups(b)
		local out = {}
		for i, block in ipairs(b.configTab.configSets[b.configTab.activeConfigSetId].customModsList or {}) do
			local lines = {}
			for line in (block.text or ""):gmatch("([^\n]*)\n?") do
				local stripped = StripEscapes(line):match("^%s*(.-)%s*$")
				if stripped ~= "" then
					local mods, extra = modLib.parseMod(stripped)
					lines[#lines + 1] = { text = stripped, supported = (mods and not extra) and true or false }
				end
			end
			out[i] = { title = block.title or "Default", enabled = block.enabled ~= false, text = block.text or "", lines = setmetatable(lines, { __jsontype = "array" }) }
		end
		return out
	end
	function ops.custom_mods()
		local b = W.build()
		return { configSet = b.configTab.activeConfigSetId, groups = customGroups(b) }
	end
	-- args: groups (1-20 of { title, enabled?, text }). Replaces the active config set's groups, as editing the boxes does.
	ops.set_custom_mods = W.mutation(function(args, b)
		if type(args.groups) ~= "table" or #args.groups == 0 then W.fail("invalid_input", "groups is a list of { title, enabled?, text }") end
		local list = {}
		for i, g in ipairs(args.groups) do
			if type(g) ~= "table" or type(g.text) ~= "string" then W.fail("invalid_input", "group " .. i .. " needs its text") end
			list[i] = { title = type(g.title) == "string" and g.title or ("Group " .. i), enabled = g.enabled ~= false, text = g.text }
		end
		local tab = b.configTab
		tab.configSets[tab.activeConfigSetId].customModsList = list
		tab:UpdateCustomModsControls()
		tab:AddUndoState()
		tab:BuildModList()
		b.buildFlag = true
		return function(built) return { configSet = built.configTab.activeConfigSetId, groups = customGroups(built) } end
	end)

	return ops
end
