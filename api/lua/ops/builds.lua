-- builds.* ops: create, load, export and describe the one build this worker holds.
return function(W)
	local main = W.main
	local dkjson = require("dkjson")
	local ops = {}

	local function summary(b)
		local spec = b.spec
		local ms = b.calcsTab.mainEnv and b.calcsTab.mainEnv.player.mainSkill
		return {
			name = b.buildName,
			className = spec.curClassName,
			ascendancy = spec.curAscendClassName ~= "None" and spec.curAscendClassName or nil,
			secondaryAscendancy = spec.curSecondaryAscendClassName ~= "None" and spec.curSecondaryAscendClassName or nil,
			level = b.characterLevel,
			levelAuto = b.characterLevelAutoMode,
			treeVersion = spec.treeVersion,
			mainSkill = ms and ms.activeEffect and ms.activeEffect.grantedEffect.name or nil,
		}
	end
	W.summary = summary

	-- Fails the command when Path of Building raised an error prompt or left BUILD mode (bad XML).
	local function settledOrFail(code)
		W.pump()
		local prompt = W.launch.promptMsg
		if prompt then
			W.launch.promptMsg = nil
			W.fail(code, StripEscapes(prompt):gsub("^Error:%s*", ""):gsub("\n.*Press Enter/Escape.*$", ""))
		end
		return W.build()
	end

	-- args: name?, className?, ascendancy?, level?, treeVersion?
	function ops.new(args)
		main:SetMode("BUILD", false, args.name or "New build")
		local b = settledOrFail("worker_error")
		if args.treeVersion and args.treeVersion ~= b.spec.treeVersion then
			if not treeVersions[args.treeVersion] then W.fail("invalid_input", "unknown tree version " .. tostring(args.treeVersion)) end
			b.treeTab:ConvertToVersion(args.treeVersion, true, false)
		end
		local tree, spec = b.spec.tree, b.spec
		local classId
		if args.className then
			classId = tree.classNameMap[args.className]
			if not classId then W.fail("invalid_input", "unknown class " .. tostring(args.className)) end
		end
		local asc
		if args.ascendancy then
			asc = tree.ascendNameMap[args.ascendancy]
			if not asc or asc.ascendClassId == 0 then W.fail("invalid_input", "unknown ascendancy " .. tostring(args.ascendancy)) end
			if classId and asc.classId ~= classId then W.fail("invalid_input", args.ascendancy .. " is not an ascendancy of " .. args.className) end
			classId = asc.classId
		end
		-- Same calls as the class and ascendancy dropdowns (Build.lua:259-282) on an empty tree.
		if classId and classId ~= spec.curClassId then spec:SelectClass(classId) end
		if asc then spec:SelectAscendClass(asc.ascendClassId) end
		if classId or asc then spec:AddUndoState() end
		if args.level then
			-- The level box's own change handler (Build.lua:222): sets the level, manual mode, BuildModList.
			b.controls.characterLevel:SetText(tostring(math.floor(args.level)), true)
		end
		b.buildFlag = true
		b = settledOrFail("worker_error")
		return summary(b)
	end

	-- args: xml, name?
	-- args: character (its character-window/get-characters entry), passives and items (the get-passive-skills
	-- and get-items response bodies), name?, clearJewels?, clearItems?, clearSkills?, ignoreWeaponSwap? (default:
	-- the Import tab's boxes). A new build on the latest tree, then the Import tab's two account imports in the
	-- order a user clicks them, with the charData their download callbacks build (ImportTab.lua:838-884).
	function ops.import_character(args)
		local char = args.character
		if type(char) ~= "table" or type(char.name) ~= "string" or type(char.class) ~= "string" or type(char.league) ~= "string" then
			W.fail("invalid_input", "character is a get-characters entry (name, class, league)")
		end
		local passives = type(args.passives) == "string" and dkjson.decode(args.passives)
		local items = type(args.items) == "string" and dkjson.decode(args.items)
		if type(passives) ~= "table" or type(items) ~= "table" then W.fail("upstream_fetch_failed", "the character data could not be read") end
		main:SetMode("BUILD", false, args.name or char.name)
		local b = settledOrFail("worker_error")
		local tab = b.importTab
		local function opt(v, box) if v == nil then return tab.controls[box].state end return v == true end
		-- Account-name imports omit quest choices, so keep the build's current values.
		passives.bandit_choice = passives.bandit_choice or b.configTab.input.bandit
		passives.pantheon_major = passives.pantheon_major or b.configTab.input.pantheonMajorGod
		passives.pantheon_minor = passives.pantheon_minor or b.configTab.input.pantheonMinorGod
		local treeData = copyTable(char)
		treeData.passives = passives
		treeData.jewels = passives.items
		tab:ImportPassiveTreeAndJewels(treeData, opt(args.clearJewels, "siteCharImportTreeClearJewels"))
		local itemData = copyTable(char)
		itemData.equipment = items.items or {}
		itemData.guardian = items.guardian
		tab:ImportItemsAndSkills(itemData, opt(args.clearItems, "siteCharImportItemsClearItems"), opt(args.clearSkills, "siteCharImportItemsClearSkills"),
			opt(args.ignoreWeaponSwap, "siteCharImportItemsIgnoreWeaponSwap"))
		b = settledOrFail("worker_error")
		return summary(b)
	end

	-- args: xml. Replaces the held build's content with this build (the name stays), as a mutation, so the
	-- server stores it as the next revision with the sidebar stats that changed.
	ops.replace = W.mutation(function(args, b)
		if type(args.xml) ~= "string" or args.xml == "" then W.fail("invalid_input", "xml is required") end
		main:SetMode("BUILD", false, b.buildName, args.xml, true)
		local ok, err = pcall(settledOrFail, "invalid_input")
		if not ok then
			if type(err) == "table" and err.notLoaded then W.fail("invalid_input", "the code is not a Path of Building build") end
			error(err, 0)
		end
		return {}
	end)

	function ops.load(args)
		if type(args.xml) ~= "string" or args.xml == "" then W.fail("invalid_input", "xml is required") end
		-- convertBuild=true: legacy builds convert instead of waiting on the conversion popup (Build.lua:103).
		main:SetMode("BUILD", false, args.name or "Imported build", args.xml, true)
		local ok, b = pcall(settledOrFail, "invalid_input")
		if not ok then
			if type(b) == "table" and b.notLoaded then W.fail("invalid_input", "the XML is not a Path of Building build") end
			error(b, 0)
		end
		return summary(b)
	end

	-- args: code? (also return the build code). Same transform as ImportTab.lua:505.
	function ops.export(args)
		local b = W.build()
		local xml = b:SaveDB("code")
		if not xml then W.fail("worker_error", "SaveDB returned nothing") end
		local out = { xml = xml }
		if args.code then
			out.code = common.base64.encode(Deflate(xml)):gsub("+", "-"):gsub("/", "_")
		end
		return out
	end

	-- args: url. Maps a share link to its raw-code download URL with upstream's site table
	-- (BuildSiteTools.lua:19, applied as ImportTab does). The host fetches it.
	function ops.resolve_link(args)
		local url = type(args.url) == "string" and args.url:match("^%s*(.-)%s*$") or ""
		for _, site in ipairs(buildSites.websiteList) do
			if url:match(site.matchURL) then
				return { site = site.label, downloadUrl = (url:gsub(site.regexURL, site.downloadURL)) }
			end
		end
		W.fail("invalid_input", "not a link to a supported build site")
	end

	function ops.summary()
		return summary(W.build())
	end

	return ops
end
