-- ui.* ops: list and drive any control of a tab by name, as a click or keystroke would. A stopgap for actions that have no
-- named op: it calls the control's own handlers (Click, SetText, changeFunc, selFunc), never anything of its own.
return function(W)
	local ops = {}

	local tabs = {
		build = function(b) return b end, tree = function(b) return b.treeTab end, skills = function(b) return b.skillsTab end,
		items = function(b) return b.itemsTab end, calcs = function(b) return b.calcsTab end, config = function(b) return b.configTab end,
		notes = function(b) return b.notesTab end, party = function(b) return b.partyTab end, import = function(b) return b.importTab end,
	}

	-- Buttons that are refused because they reach outside the build: the file system (a save or open dialog), the network
	-- (character fetch, login, sharing, trade, opening a link) or the session (leaving the build). "<tab>.<control>".
	local denied = {
		["build.back"] = "leaves the build", ["build.save"] = "saves to a file", ["build.saveAs"] = "saves to a file",
		["import.accountRealmFetchButton"] = "fetches characters from the game site", ["import.authenticateButton"] = "signs in to the game site",
		["import.logoutApiButton"] = "signs out of the game site", ["import.siteAccountNameGo"] = "fetches characters from the game site",
		["import.charImportItems"] = "imports from the game site", ["import.charImportTree"] = "imports from the game site",
		["import.siteCharImportItems"] = "imports from the game site", ["import.siteCharImportTree"] = "imports from the game site",
		["import.importCodeGo"] = "may download from a link (use the build import routes)", ["import.generateCodeByLink"] = "uploads the build to a share site",
		["items.priceDisplayItem"] = "opens the trade site", ["items.displayItemBuySimilar"] = "opens the trade site",
		["party.importCodeGo"] = "may download from a link (use party import)",
	}
	-- A button labelled like this is refused too, whatever it is called (popups and dynamic buttons).
	local deniedLabel = { "^save", "^open", "close", "^exit", "^quit", "^back", "^<< ", "fetch", "download", "upload", "authori[sz]e", "log ?out", "^share", "^buy", "^trade" }

	local function isA(ctrl, name)
		return ctrl._className == name or (ctrl._superParents ~= nil and ctrl._superParents[common.classes[name]] == true)
	end
	-- A property that may be a function reading state only the draw pass sets up; an error counts as absent.
	local function prop(ctrl, name)
		local ok, v = pcall(ctrl.GetProperty, ctrl, name)
		if ok then return v end
	end
	local function flag(fn, ctrl)
		local ok, v = pcall(fn, ctrl)
		return ok and v == true
	end
	local function labelOf(ctrl)
		local l = prop(ctrl, "label")
		return type(l) == "string" and W.strip(l) or nil
	end
	local function choices(ctrl)
		local out = {}
		for i, v in ipairs(ctrl.list) do
			if i > 40 then break end
			out[i] = W.strip(type(v) == "table" and (v.label or v.name) or v)
		end
		return out
	end

	-- The controls a tab names: its `controls` table by name, and for the Configuration tab each option's own control by variable.
	local function named(b, tab)
		local host = tabs[tab](b)
		local out = {}
		for name, c in pairs(host.controls) do
			if type(name) == "string" and type(c) == "table" and c._className then out[name] = c end
		end
		for var, c in pairs(host.varControls or {}) do
			if out[var] == nil then out[var] = c end
		end
		return out
	end

	-- Which actions a control takes, by its class.
	local function kinds(ctrl)
		local out = {}
		if type(ctrl.Click) == "function" then out[#out + 1] = "click" end
		if isA(ctrl, "EditControl") then out[#out + 1] = "set_text" end
		if isA(ctrl, "CheckBoxControl") then out[#out + 1] = "set_state" end
		if isA(ctrl, "DropDownControl") then out[#out + 1] = "select" end
		return out
	end
	-- Why a control cannot be driven, or nil.
	local function refusal(tab, name, ctrl)
		if denied[tab .. "." .. name] then return denied[tab .. "." .. name] end
		local label = (labelOf(ctrl) or ""):lower()
		if type(ctrl.Click) == "function" then
			for _, p in ipairs(deniedLabel) do
				if label:find(p) then return "its label (" .. label .. ") says it opens a file, reaches the network or leaves the build" end
			end
		end
		if not flag(ctrl.IsShown, ctrl) then return "it is not shown" end
		if not flag(ctrl.IsEnabled, ctrl) then return "it is disabled" end
	end

	local function describe(tab, name, ctrl)
		local d = { name = name, type = ctrl._className, label = labelOf(ctrl), shown = flag(ctrl.IsShown, ctrl), enabled = flag(ctrl.IsEnabled, ctrl) }
		if isA(ctrl, "EditControl") then d.text = W.strip(ctrl.buf:sub(1, 200)) end
		if isA(ctrl, "CheckBoxControl") then d.state = ctrl.state == true end
		if isA(ctrl, "DropDownControl") then
			d.selected, d.choices, d.choiceCount = ctrl.selIndex, choices(ctrl), #ctrl.list
		end
		d.actions = refusal(tab, name, ctrl) and {} or kinds(ctrl)
		if #d.actions == 0 then d.actions = setmetatable({}, { __jsontype = "array" }) end
		return d
	end

	-- args: tab, limit? (default 50), offset?. The tab's controls by name, with type, label or text, state, shown, enabled,
	-- a dropdown's choices (first 40) and the actions `invoke` takes on it now.
	function ops.controls(args)
		local b = W.build()
		if not tabs[args.tab] then W.fail("invalid_input", "tab is one of build, tree, skills, items, calcs, config, notes, party, import") end
		local all = named(b, args.tab)
		local names = {}
		for name in pairs(all) do names[#names + 1] = name end
		table.sort(names)
		local limit, offset = args.limit or 50, args.offset or 0
		local list = {}
		for i = offset + 1, math.min(#names, offset + limit) do list[#list + 1] = describe(args.tab, names[i], all[names[i]]) end
		return { tab = args.tab, total = #names, offset = offset, controls = setmetatable(list, { __jsontype = "array" }) }
	end

	-- args: tab, control, action (click | set_text | set_state | select), value? (text; true or false; a dropdown's 1-based
	-- number or label). Refused: unknown tab or control, an action the control does not take, a hidden or disabled control, the
	-- deny list above.
	ops.invoke = W.mutation(function(args, b)
		if not tabs[args.tab] then W.fail("invalid_input", "tab is one of build, tree, skills, items, calcs, config, notes, party, import") end
		local ctrl = named(b, args.tab)[args.control]
		if not ctrl then W.fail("invalid_input", "no control " .. tostring(args.control) .. " on the " .. args.tab .. " tab (see ui controls)") end
		local action, value = args.action, args.value
		local can = kinds(ctrl)
		local takes = false
		for _, k in ipairs(can) do if k == action then takes = true end end
		if not takes then
			W.fail("invalid_input", args.control .. " is a " .. ctrl._className .. "; it takes " .. (#can > 0 and table.concat(can, ", ") or "no action") .. ", not " .. tostring(action))
		end
		local why = refusal(args.tab, args.control, ctrl)
		if why then W.fail("invalid_input", args.control .. " cannot be driven: " .. why) end
		if action == "click" then
			ctrl:Click()
		elseif action == "set_text" then
			if type(value) ~= "string" and type(value) ~= "number" then W.fail("invalid_input", "set_text takes a text value") end
			ctrl:SetText(tostring(value), true)
		elseif action == "set_state" then
			if type(value) ~= "boolean" then W.fail("invalid_input", "set_state takes true or false") end
			ctrl.state = value
			if ctrl.changeFunc then ctrl.changeFunc(value) end
		else
			local want, index = value, nil
			if type(want) == "number" then
				index = ctrl.list[want] ~= nil and want == math.floor(want) and want or nil
			elseif type(want) == "string" then
				for i, v in ipairs(ctrl.list) do
					local label = type(v) == "table" and (v.label or v.name) or v
					if label == want or W.strip(label) == want then index = i; break end
				end
			else
				W.fail("invalid_input", "select takes a choice number or label")
			end
			if not index then W.fail("invalid_input", "no choice " .. tostring(value) .. " in " .. args.control .. "; choices: " .. table.concat(choices(ctrl), ", ")) end
			ctrl.selIndex = index
			if ctrl.selFunc then ctrl.selFunc(index, ctrl.list[index]) end
		end
		return function()
			local d = describe(args.tab, args.control, ctrl)
			return { tab = args.tab, control = args.control, action = action, text = d.text, state = d.state, selected = d.selected }
		end
	end)

	return ops
end
