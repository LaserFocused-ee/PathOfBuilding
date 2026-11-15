-- stats.* ops: read the calculated build. Nothing here changes the build.
return function(W)
	local ops = {}
	local strip = W.strip

	local function object(t) return setmetatable(t, { __jsontype = "object" }) end

	-- The sidebar exactly as Path of Building draws it: RefreshStatList fills controls.statBox.list
	-- (Build.lua:2078). FormatStat is wrapped while it runs to learn each row's stat key and raw value.
	local function sidebar(b)
		local records, actorName = {}, "player"
		local origFormat, origAdd = b.FormatStat, b.AddDisplayStatList
		b.FormatStat = function(self, statData, statVal, ...)
			local s = origFormat(self, statData, statVal, ...)
			records[#records + 1] = { str = s, stat = statData.stat, value = statVal, actor = actorName }
			return s
		end
		b.AddDisplayStatList = function(self, list, actor, name)
			actorName = name or "player"
			return origAdd(self, list, actor, name)
		end
		local ok, err = pcall(b.RefreshStatList, b)
		b.FormatStat, b.AddDisplayStatList = origFormat, origAdd
		if not ok then error(err, 0) end
		local rows, p = {}, 1
		for _, row in ipairs(b.controls.statBox.list) do
			if type(row[1]) == "string" and type(row[2]) == "string" then
				local label = strip(row[1]):gsub(":$", "")
				local entry = { label = label, text = strip(row[2]) }
				local rec = records[p]
				if rec and row[2]:sub(1, #rec.str) == rec.str then
					p = p + 1
					local stat = rec.stat or ("SkillDPS:" .. label)
					entry.key = rec.actor == "minion" and ("Minion." .. stat) or stat
					entry.stat, entry.actor = stat, rec.actor
					entry.value = type(rec.value) == "number" and rec.value or nil
				end
				rows[#rows + 1] = entry
			end
		end
		local warnings = {}
		for _, line in ipairs(b.controls.warnings.lines or {}) do warnings[#warnings + 1] = strip(line) end
		return rows, warnings
	end
	W.sidebar = sidebar

	-- key -> number map of the sidebar, used for before/after diffs.
	function W.sidebarValues(b)
		local values = {}
		for _, row in ipairs((sidebar(b))) do
			if row.key and row.value then values[row.key] = row.value end
		end
		return values
	end

	function ops.sidebar()
		local rows, warnings = sidebar(W.build())
		return { stats = rows, warnings = warnings }
	end

	function ops.warnings()
		local _, warnings = sidebar(W.build())
		return { warnings = warnings }
	end

	-- args: fields? (list of output keys), actor? ("player"|"minion"), mode? ("main"|"calcs")
	function ops.output(args)
		local b = W.build()
		local env = args.mode == "calcs" and b.calcsTab.calcsEnv or b.calcsTab.mainEnv
		local actor = env and env[args.actor == "minion" and "minion" or "player"]
		if not actor then W.fail("not_found", "no " .. tostring(args.actor) .. " output for this build") end
		local out = object({})
		if type(args.fields) == "table" and #args.fields > 0 then
			for _, k in ipairs(args.fields) do
				if type(k) == "string" and actor.output[k] ~= nil then out[k] = W.plain(actor.output[k]) end
			end
		else
			for k, v in pairs(actor.output) do
				local t = type(v)
				if type(k) == "string" and (t == "number" or t == "boolean" or t == "string") then out[k] = W.plain(v) end
			end
		end
		local ms = actor.mainSkill
		return { mainSkill = ms and ms.activeEffect and ms.activeEffect.grantedEffect.name or nil, output = out }
	end

	local skillKeys = { "TotalDPS", "TotalDot", "CombinedDPS", "AverageHit", "AverageDamage", "Speed", "HitChance", "CritChance",
		"CritMultiplier", "TotalDotDPS", "BleedDPS", "IgniteDPS", "PoisonDPS", "ImpaleDPS", "WithPoisonDPS", "CullingDPS",
		"ManaCost", "LifeCost", "ESCost", "ManaPerSecondCost" }

	-- Every socket group with its outputs when it is the main skill, plus FullDPS. Each group is calculated
	-- in a throwaway CALCULATOR env (as Calcs.getMiscCalculator does), which never writes the build's own
	-- state; only build.mainSocketGroup is pointed at the group for the env setup and put back.
	function ops.skills()
		local b = W.build()
		local calcs = b.calcsTab.calcs
		local origGroup = b.mainSocketGroup
		local groups = {}
		local ok, err = pcall(function()
			for i, g in ipairs(b.skillsTab.socketGroupList) do
				local entry = { index = i, label = g.label, slot = g.slot, enabled = g.enabled ~= false,
					includeInFullDPS = g.includeInFullDPS == true, mainActiveSkill = g.mainActiveSkill, activeSkills = {}, gems = {} }
				for _, gem in ipairs(g.gemList or {}) do
					entry.gems[#entry.gems + 1] = { name = gem.nameSpec, level = gem.level, quality = gem.quality, enabled = gem.enabled ~= false, count = gem.count }
				end
				for _, s in ipairs(g.displaySkillList or {}) do
					entry.activeSkills[#entry.activeSkills + 1] = s.activeEffect.grantedEffect.name
				end
				if entry.enabled and #entry.activeSkills > 0 then
					b.mainSocketGroup = i
					local env = calcs.initEnv(b, "CALCULATOR")
					calcs.perform(env)
					b.mainSocketGroup = origGroup
					local o = env.player.output
					entry.output = object({})
					for _, k in ipairs(skillKeys) do
						if type(o[k]) == "number" then entry.output[k] = o[k] end
					end
					local ms = env.player.mainSkill
					entry.mainSkill = ms and ms.activeEffect and ms.activeEffect.grantedEffect.name or nil
				end
				groups[#groups + 1] = entry
			end
		end)
		b.mainSocketGroup = origGroup
		if not ok then error(err, 0) end
		local o = b.calcsTab.mainOutput
		local full = {}
		for _, s in ipairs(type(o.SkillDPS) == "table" and o.SkillDPS or {}) do
			full[#full + 1] = { name = s.name, dps = s.dps, count = s.count, trigger = strip(s.trigger), skillPart = strip(s.skillPart), source = strip(s.source) }
		end
		return { mainSocketGroup = origGroup, groups = groups, fullDPS = { FullDPS = o.FullDPS, FullDotDPS = o.FullDotDPS, skills = full } }
	end

	-- args: key, actor? Breakdown rows from the Calcs-mode environment (what the Calcs tab shows).
	function ops.breakdown(args)
		if type(args.key) ~= "string" then W.fail("invalid_input", "key is required") end
		local b = W.build()
		local actor = b.calcsTab.calcsEnv and b.calcsTab.calcsEnv[args.actor == "minion" and "minion" or "player"]
		local bd = actor and actor.breakdown and actor.breakdown[args.key]
		if bd == nil then W.fail("not_found", "no breakdown for " .. args.key) end
		return { key = args.key, value = W.plain(actor.output[args.key]), breakdown = W.plain(bd) }
	end

	-- The experience multiplier table of the character level box's hover (Build.lua characterLevel.tooltipFunc).
	function ops.xp()
		local b = W.build()
		local areas = setmetatable({}, { __jsontype = "array" })
		for _, line in ipairs(W.tooltip(function(t) b.controls.characterLevel.tooltipFunc(t) end)) do
			local level, tier, pct = line:match("^(%d+) %(Tier (%d+)%): ([%d%.]+)%%$")
			if not level then level, pct = line:match("^(%d+): ([%d%.]+)%%$") end
			if level then areas[#areas + 1] = { areaLevel = tonumber(level), tier = tonumber(tier), percent = tonumber(pct) } end
		end
		return { level = b.characterLevel, areas = areas }
	end

	-- The Calcs tab's sections with the rows and cells it draws (CalcSectionControl:DrawContent): the same visibility
	-- checks and cell text, for the actor the tab shows. Collapsed state is a view setting and is ignored.
	-- args: section? (a section id, else part of a subsection label, any case)
	function ops.sections(args)
		local b = W.build()
		local tab = b.calcsTab
		local actor = tab.input.showMinion and tab.calcsEnv.minion or tab.calcsEnv.player
		local want = type(args.section) == "string" and args.section:lower() or nil
		local labels, sections = {}, setmetatable({}, { __jsontype = "array" })
		local byId = false -- a section id wins over label matches
		for _, sec in ipairs(tab.sectionList) do
			if tostring(sec.id):lower() == want then byId = true end
		end
		for _, sec in ipairs(tab.sectionList) do
			local first = sec.subSection[1].label or ""
			labels[#labels + 1] = strip(first)
			local match = want == nil or tostring(sec.id):lower() == want
			if not byId then
				for _, subSec in ipairs(sec.subSection) do
					if (subSec.label or ""):lower():find(want or "", 1, true) then match = true end
				end
			end
			if match and tab:CheckFlag(sec) then
				local subs = setmetatable({}, { __jsontype = "array" })
				for _, subSec in ipairs(sec.subSection) do
					local rows = setmetatable({}, { __jsontype = "array" })
					for _, rowData in ipairs(subSec.data) do
						if tab:CheckFlag(rowData) then
							local values = setmetatable({}, { __jsontype = "array" })
							for _, colData in ipairs(rowData) do
								if colData.format and tab:CheckFlag(colData) then
									local ok, str = pcall(formatCalcStr, colData.format, actor, colData)
									values[#values + 1] = ok and strip(tostring(str)) or ""
								end
							end
							if #values > 0 then rows[#rows + 1] = { label = strip(rowData.label or ""), values = values } end
						end
					end
					if #rows > 0 then
						local sub = { label = strip(subSec.label or ""), rows = rows }
						if subSec.data.extra then
							local ok, str = pcall(formatCalcStr, subSec.data.extra, actor)
							if ok and str ~= "" then sub.extra = strip(str) end
						end
						subs[#subs + 1] = sub
					end
				end
				if #subs > 0 then sections[#sections + 1] = { id = sec.id, label = strip(first), subsections = subs } end
			end
		end
		if want and #sections == 0 then
			local shown = {}
			for i = 1, math.min(#labels, 30) do shown[i] = labels[i] end
			W.fail("not_found", "no Calcs section matches " .. args.section .. "; sections: " .. table.concat(shown, ", "))
		end
		return { sections = sections }
	end

	-- Attribute requirements and resistances from the main output.
	function ops.defences()
		local o = W.build().calcsTab.mainOutput
		local function pick(keys)
			local t = object({})
			for _, k in ipairs(keys) do if o[k] ~= nil then t[k] = W.plain(o[k]) end end
			return t
		end
		local resist = {}
		for _, e in ipairs({ "Fire", "Cold", "Lightning", "Chaos" }) do
			resist[e] = pick({ e .. "Resist", e .. "ResistTotal", e .. "ResistOverCap", e .. "ResistMax" })
		end
		return {
			attributes = pick({ "Str", "Dex", "Int", "Omni", "ReqStr", "ReqDex", "ReqInt", "ReqOmni" }),
			resistances = resist,
		}
	end

	-- Passive point budget as the top bar shows it (Build.lua:929 pointDisplay, from EstimatePlayerProgress).
	function ops.points()
		local b = W.build()
		sidebar(b) -- RefreshStatList runs EstimatePlayerProgress, which fills pointDisplay
		local used, max, ascUsed, ascMax = strip(b.controls.pointDisplay.str):match("(%d+)%s*/%s*(%d+)%s+(%d+)%s*/%s*(%d+)")
		local req = strip(b.controls.pointDisplay.req or "")
		local _, _, secondaryUsed, sockets = b.spec:CountAllocNodes()
		return {
			used = tonumber(used), max = tonumber(max), ascendancyUsed = tonumber(ascUsed), ascendancyMax = tonumber(ascMax),
			secondaryAscendancyUsed = secondaryUsed, jewelSockets = sockets,
			requiredLevel = tonumber(req:match("Required Level: (%d+)")), act = req:match("Act: (%S+)"),
		}
	end

	-- The build-quality levers a player checks: jewel sockets (filled, empty, reachable within `within` points), cluster jewels,
	-- flasks, config options (set, and the ones the Configuration tab shows for this build still at default), anoints, tattoos,
	-- masteries, gems under their top level or 20 quality, empty gem sockets and open affixes on equipped rares, each as Path of
	-- Building holds it, and `unused` naming the levers left unpulled. Sockets are tree nodes of type Socket, cluster subgraphs
	-- included; `points` is PassiveSpec's pathDist, the passive points to allocate it.
	function ops.levers(args)
		local within = tonumber(args and args.within) or 10
		local json = W.json
		local function arr(t) return setmetatable(t, { __jsontype = "array" }) end
		local b = W.build()
		local spec, tab = b.spec, b.itemsTab
		local function itemIn(id) return id and id > 0 and tab.items[id] or nil end
		local sizes = { [0] = "small cluster", [1] = "medium cluster", [2] = "large cluster" }
		local sockets, reachable, clusters, empty = {}, {}, {}, 0
		for id, node in pairs(spec.nodes) do
			if node.type == "Socket" then -- tree sockets and the ones cluster jewels add
				local kind = node.expansionJewel and sizes[node.expansionJewel.size] or "basic"
				local item = itemIn(spec.jewels[id])
				if spec.allocNodes[id] then
					sockets[#sockets + 1] = { nodeId = id, name = node.dn, kind = kind, item = item and item.id or json.null, itemName = item and item.name or json.null }
					if not item then empty = empty + 1 end
					if item and item.clusterJewel then clusters[#clusters + 1] = { nodeId = id, item = item.id, name = item.name, base = item.baseName } end
				elseif node.pathDist and node.pathDist <= within then
					reachable[#reachable + 1] = { nodeId = id, name = node.dn, kind = kind, points = node.pathDist }
				end
			end
		end
		table.sort(sockets, function(x, y) return x.nodeId < y.nodeId end)
		table.sort(clusters, function(x, y) return x.nodeId < y.nodeId end)
		table.sort(reachable, function(x, y) if x.points ~= y.points then return x.points < y.points end return x.nodeId < y.nodeId end)

		local flasks, abyss, anoints, gear = {}, {}, {}, {}
		for _, slot in ipairs(tab.orderedSlots) do
			local name = slot.slotName
			if not slot.nodeId and slot:IsShown() then
				local item = itemIn(slot.selItemId)
				if name:match("^Flask %d$") then
					flasks[#flasks + 1] = { slot = name, item = item and item.id or json.null, name = item and item.name or json.null, active = item ~= nil and slot.active == true }
				elseif name:match("Abyssal Socket") then
					abyss[#abyss + 1] = { slot = name, item = item and item.id or json.null, name = item and item.name or json.null }
				elseif item then
					if item.base and not item.base.cannotBeAnointed and item.base.subType ~= "Talisman" and (item.canBeAnointed or item.base.type == "Amulet") then
						local allocates = {} -- ItemsTab's isAnointable test; the anoint is an enchant line "Allocates <notable>"
						for _, line in ipairs(item.enchantModLines or {}) do
							local notable = line.line:match("^Allocates (.+)$")
							if notable then allocates[#allocates + 1] = notable end
						end
						anoints[#anoints + 1] = { slot = name, item = item.id, name = item.name, allocates = arr(allocates) }
					end
					gear[#gear + 1] = { slot = name, item = item }
				end
			end
		end

		local tattoos = {}
		for id, node in pairs(spec.hashOverrides) do
			if node.isTattoo then tattoos[#tattoos + 1] = { nodeId = id, name = node.dn } end
		end
		table.sort(tattoos, function(x, y) return x.nodeId < y.nodeId end)
		local masteries, unselected = 0, {}
		for id, node in pairs(spec.allocNodes) do
			if node.type == "Mastery" then
				masteries = masteries + 1
				if not spec.masterySelections[id] then unselected[#unselected + 1] = { nodeId = id, name = node.dn } end
			end
		end
		table.sort(unselected, function(x, y) return x.nodeId < y.nodeId end)
		local config = W.configValues(b)
		local configCount = 0
		for _ in pairs(config) do configCount = configCount + 1 end
		local atDefault = {} -- the options the Configuration tab shows for this build (ConfigTab's own shown tests) left at default
		for _, v in ipairs(require("Modules.ConfigOptions")) do
			local control = v.var and b.configTab.varControls[v.var]
			if control and config[v.var] == nil and control:IsShown() then atDefault[#atDefault + 1] = { var = v.var, label = strip(v.label or v.var):gsub(":$", "") } end
		end

		-- Gems in the socket groups the player made (not ones an item grants): below the gem's top natural level or 20 quality.
		local gems, gemsBySlot = {}, {}
		for i, g in ipairs(b.skillsTab.socketGroupList) do
			if not g.source then
				for _, gem in ipairs(g.gemList) do
					if gem.gemData then
						if g.slot then gemsBySlot[g.slot] = (gemsBySlot[g.slot] or 0) + 1 end
						local top = gem.gemData.naturalMaxLevel or 20
						if gem.enabled ~= false and g.enabled ~= false and ((gem.level or 0) < top or (gem.quality or 0) < 20) then
							gems[#gems + 1] = { group = i, slot = g.slot or json.null, name = gem.gemData.name, level = gem.level, maxLevel = top, quality = gem.quality or 0 }
						end
					end
				end
			end
		end

		-- Equipped gear: gem sockets against the gems the slot's groups hold; open affixes on rares. Path of Building knows the
		-- prefix/suffix split only for items with affix data (crafted in it, or pasted with the game's advanced mod text);
		-- otherwise explicit lines bound the affixes used from above (a hybrid mod has two lines), so 6 - lines is a lower bound.
		local gemSockets, affixes = {}, {}
		for _, e in ipairs(gear) do
			local item, slotName = e.item, e.slot
			local n = 0
			for _, sk in ipairs(item.sockets or {}) do if sk.color ~= "A" then n = n + 1 end end
			if n > 0 then
				local held = gemsBySlot[slotName] or 0
				gemSockets[#gemSockets + 1] = { slot = slotName, name = item.name, sockets = n, gems = held, empty = math.max(0, n - held) }
			end
			if item.rarity == "RARE" and item.type ~= "Jewel" and item.type ~= "Flask" then
				local row = { slot = slotName, name = item.name, corrupted = item.corrupted == true }
				if item.crafted and item.affixLimit and item.affixLimit > 0 then
					local function used(list) local c = 0; for _, a in ipairs(list) do if a.modId and a.modId ~= "None" then c = c + 1 end end; return c end
					local pl, sl = item.prefixes.limit or item.affixLimit / 2, item.suffixes.limit or item.affixLimit / 2
					row.known, row.prefixes, row.suffixes, row.prefixLimit, row.suffixLimit = true, used(item.prefixes), used(item.suffixes), pl, sl
					row.open = (pl - row.prefixes) + (sl - row.suffixes)
				else
					local lines = 0
					for _, l in ipairs(item.explicitModLines or {}) do if l.line and l.line:match("%S") then lines = lines + 1 end end
					row.known, row.explicitLines, row.open = false, lines, math.max(0, 6 - lines)
				end
				affixes[#affixes + 1] = row
			end
		end

		local bySize, filled, active = { ["large cluster"] = 0, ["medium cluster"] = 0, ["small cluster"] = 0 }, 0, 0
		for _, c in ipairs(clusters) do
			local size = c.base:match("^(%a+) Cluster Jewel$")
			if size then bySize[size:lower() .. " cluster"] = bySize[size:lower() .. " cluster"] + 1 end
		end
		for _, f in ipairs(flasks) do
			if f.item ~= json.null then filled = filled + 1 end
			if f.active then active = active + 1 end
		end
		local unused = {}
		local function say(s) unused[#unused + 1] = s end
		if empty > 0 then say(empty .. " allocated jewel socket" .. (empty == 1 and " is" or "s are") .. " empty") end
		if #reachable > 0 then say(#reachable .. " unallocated jewel socket" .. (#reachable == 1 and "" or "s") .. " within " .. within .. " points, the nearest " .. reachable[1].points .. " point" .. (reachable[1].points == 1 and "" or "s") .. " away") end
		if #clusters == 0 then say("no cluster jewel") end
		for _, f in ipairs(flasks) do
			if f.item == json.null then say(f.slot .. " is empty") elseif not f.active then say(f.slot .. " (" .. f.name .. ") is not active") end
		end
		for _, a in ipairs(abyss) do if a.item == json.null then say(a.slot .. " is empty") end end
		for _, a in ipairs(anoints) do if #a.allocates == 0 then say(a.slot .. " (" .. a.name .. ") has no anoint") end end
		if #tattoos == 0 then say("no tattoo") end
		if #unselected > 0 then say(#unselected .. " allocated master" .. (#unselected == 1 and "y has" or "ies have") .. " no effect chosen") end
		if configCount == 0 then say("no config option set") end
		if #atDefault > 0 then say(#atDefault .. " config option" .. (#atDefault == 1 and " this build shows is" or "s this build shows are") .. " at default") end
		if #gems > 0 then say(#gems .. " gem" .. (#gems == 1 and " is" or "s are") .. " below top level or 20 quality") end
		for _, g in ipairs(gemSockets) do if g.empty > 0 then say(g.slot .. " (" .. g.name .. ") has " .. g.empty .. " empty gem socket" .. (g.empty == 1 and "" or "s")) end end
		for _, a in ipairs(affixes) do
			if a.open > 0 then say(a.slot .. " (" .. a.name .. ") has " .. (a.known and "" or "at least ") .. a.open .. " open affix" .. (a.open == 1 and "" or "es") .. (a.corrupted and " (corrupted)" or "")) end
		end

		return {
			jewelSockets = { allocated = arr(sockets), empty = empty, within = within, reachable = arr(reachable) },
			clusterJewels = { large = bySize["large cluster"], medium = bySize["medium cluster"], small = bySize["small cluster"], jewels = arr(clusters) },
			flasks = { filled = filled, active = active, slots = arr(flasks) }, abyssalSockets = arr(abyss), anoints = arr(anoints),
			tattoos = { count = #tattoos, nodes = arr(tattoos) },
			masteries = { allocated = masteries, selected = masteries - #unselected, unselected = arr(unselected) },
			config = { count = configCount, values = config, atDefault = arr(atDefault) },
			gems = arr(gems), gemSockets = arr(gemSockets), affixes = arr(affixes),
			unused = arr(unused),
		}
	end

	function ops.versions()
		local b = W.build()
		local tv = b.spec.treeVersion
		return {
			pobVersion = W.launch.versionNumber,
			latestTreeVersion = latestTreeVersion,
			treeVersion = tv,
			treeVersionDisplay = treeVersions[tv] and treeVersions[tv].display,
			targetVersion = b.targetVersion,
		}
	end

	return ops
end
