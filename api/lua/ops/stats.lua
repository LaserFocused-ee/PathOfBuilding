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

	-- key -> number map of the sidebar, used for before/after diffs. The sidebar hides some rows (Combined DPS when it
	-- equals Hit DPS, Full DPS with no group ticked); these headline figures are always in it.
	local headline = { "FullDPS", "CombinedDPS", "TotalDPS", "TotalDotDPS", "TotalEHP", "Life", "EnergyShield" }
	function W.sidebarValues(b)
		local values = {}
		for _, row in ipairs((sidebar(b))) do
			if row.key and row.value then values[row.key] = row.value end
		end
		local out = b.calcsTab.mainEnv and b.calcsTab.mainEnv.player.output or {}
		for _, k in ipairs(headline) do
			if values[k] == nil and type(out[k]) == "number" then values[k] = out[k] end
		end
		return values
	end

	-- Notes on figures Path of Building's own calculation is known to get wrong or leave out for this build (upstream
	-- behaviour, not changed here), added after PoB's own warnings. Each starts "Engine note:".
	local function template(t)
		return (t:gsub("%(%-?[%d%.]+%-%-?[%d%.]+%)", "#"):gsub("%-?[%d%.]+", "#"))
	end
	local function engineNotes(b)
		local notes = {}
		local function note(text) notes[#notes + 1] = "Engine note: " .. text end
		-- "Limited to 1 Runegraft of X": PoB does not enforce the limit, every copy counts
		local seen = {}
		for _, node in pairs(b.spec.allocNodes or {}) do
			for _, line in ipairs(node.isTattoo and node.sd or {}) do
				local n, what = line:match("^Limited to (%d+) (.+)$")
				if n then
					seen[what] = seen[what] or { limit = tonumber(n), count = 0 }
					seen[what].count = seen[what].count + 1
				end
			end
		end
		for what, v in pairs(seen) do
			if v.count > v.limit then
				note(string.format("%s is allocated %d times; the game allows %d, Path of Building counts every copy", what, v.count, v.limit))
			end
		end
		local env = b.calcsTab.mainEnv
		local out = b.calcsTab.mainOutput or {}
		local class = b.spec.curClass
		if b.spec.curAscendClassId == 0 and class and #(class.classes or {}) > 0 and (b.characterLevel or 1) >= 70 then
			note(string.format("level %d with no ascendancy chosen: the figures carry no ascendancy nodes (the build file holds none)", b.characterLevel))
		end
		local cfgSet = b.configTab.configSets[b.configTab.activeConfigSetId]
		for _, block in ipairs(cfgSet and cfgSet.customModsList or {}) do
			local lines = {}
			for line in W.strip(block.enabled ~= false and block.text or ""):gmatch("[^\n]+") do
				if line:match("%S") then lines[#lines + 1] = line end
			end
			if #lines > 0 then
				note("the Config tab's custom modifiers add \"" .. table.concat(lines, "; ") .. "\" with no item, node or skill behind them")
			end
		end
		-- typed minion counts (Raise Spectre's count box) above the minion limit: Full DPS counts every typed one
		local minions = {}
		for _, skill in ipairs(env and env.player.activeSkillList or {}) do
			local limitName = skill.minion and skill.minion.minionData and skill.minion.minionData.limit
			local group = skill.socketGroup
			if limitName and group and not skill.skillFlags.disable and group.includeInFullDPS then
				local count = group.groupCount
				for _, gem in ipairs(count and {} or group.gemList or {}) do
					if gem.gemData and gem.gemData.grantedEffect == skill.activeEffect.grantedEffect then count = gem.count or 1 end
				end
				local limit = math.floor(env.modDB:Override(nil, limitName) or (calcLib.val(skill.skillModList, limitName, skill.skillCfg) * skill.skillModList:More(skill.skillCfg, "ActiveMinionLimit")))
				local m = minions[limitName] or { count = 0, limit = 0, name = W.strip(skill.activeEffect.grantedEffect.name) }
				m.count, m.limit, minions[limitName] = m.count + (count or 1), math.max(m.limit, limit), m
			end
		end
		for _, m in pairs(minions) do
			if m.limit > 0 and m.count > m.limit then
				note(string.format("%s: %d minions counted in Full DPS against a limit of %d; Path of Building counts every typed one", m.name, m.count, m.limit))
			end
		end
		-- Cast when Damage Taken and the like support only skills up to a level requirement
		-- (local_support_gem_max_skill_level_requirement_to_support, which PoB does not map)
		for _, skill in ipairs(env and env.player.activeSkillList or {}) do
			local active = skill.activeEffect
			local row = active and (active.grantedEffectLevel or active.grantedEffect.levels[active.level])
			for _, sup in ipairs(skill.effectList or {}) do
				local ge = sup.grantedEffect
				if ge and ge.support and row and row.levelRequirement then
					for i, stat in ipairs(ge.stats or {}) do
						local level = stat == "local_support_gem_max_skill_level_requirement_to_support" and (sup.grantedEffectLevel or ge.levels[sup.level])
						local limit = level and level[i]
						if limit and row.levelRequirement > limit then
							note(string.format("%s level %d needs character level %d, over %s's limit of %d: the game does not trigger it, Path of Building counts it", W.strip(active.grantedEffect.name), active.level, row.levelRequirement, W.strip(ge.name), limit))
						end
					end
				end
			end
		end
		-- more enabled gems in a slot's enabled groups than its item has sockets (abyss sockets left out)
		local socketed = {}
		for _, group in ipairs(b.skillsTab.socketGroupList) do
			if group.slot and not group.source and group.enabled and group.slotEnabled ~= false then
				local n = 0
				for _, gem in ipairs(group.gemList or {}) do
					if gem.gemData and gem.enabled ~= false then n = n + 1 end
				end
				socketed[group.slot] = (socketed[group.slot] or 0) + n
			end
		end
		for slotName, n in pairs(socketed) do
			local slot = b.itemsTab.slots[slotName]
			local item = slot and b.itemsTab.items[slot.selItemId]
			local sockets = 0
			for _, sk in ipairs(item and item.sockets or {}) do
				if sk.color ~= "A" then sockets = sockets + 1 end
			end
			if sockets > 0 and n > sockets then
				note(string.format("%s %s holds %d enabled gems in %d sockets; Path of Building counts every gem", slotName, W.strip(item.name or ""), n, sockets))
			end
		end
		if (out.sharedGuardAbsorbRate or 0) > 0 or out.AnyGuard then
			note("a guard buff counts as always up in TotalEHP and maximum hit taken; disable its group for the guard-off figures")
		end
		if env and env.modDB and env.modDB:Sum("BASE", nil, "LeftActiveMagicUtilityFlasks", "RightActiveMagicUtilityFlasks") > 0 then
			note("the belt's magic utility flasks apply always, ticked Active or not; toggling them changes nothing")
		end
		for slot, item in pairs(env and env.player.itemList or {}) do
			local label = slot .. " " .. strip(item.name or "")
			for _, list in ipairs({ item.implicitModLines, item.explicitModLines, item.enchantModLines }) do
				for _, ml in ipairs(list or {}) do
					if ml.extra and item:CheckModLineVariant(ml) then
						note(label .. ": Path of Building does not model \"" .. strip(ml.line) .. "\"")
					end
				end
			end
			-- A crafted item on a magnitude base (Focused Amulet) whose stored lines already carry the magnitude: PoB
			-- scales the stored line again (Item.lua: crafted items' lines are the affix rolls before magnitude).
			if item.affixes and #(item.modMagnitudeMods or {}) > 0 then
				for _, ml in ipairs(item.explicitModLines or {}) do
					if ml.valueScalar and ml.valueScalar > 1 then
						local key = template(ml.line)
						for _, list in ipairs({ item.prefixes or {}, item.suffixes or {} }) do
							for _, affix in ipairs(list) do
								local mod = item.affixes[affix.modId]
								for _, l in ipairs(mod or {}) do
									if template(l) == key then
										local most = tonumber(itemLib.applyRange(l, 1):match("%-?[%d%.]+"))
										local stored = tonumber(ml.line:match("%-?[%d%.]+"))
										if most and stored and math.abs(stored) > math.abs(most) then
											note(string.format("%s: \"%s\" is above its affix's maximum %s, so the line already carries the item's magnitude and Path of Building scales it again (x%g); re-enter the line at the affix's roll", label, ml.line, most, ml.valueScalar))
										end
									end
								end
							end
						end
					end
				end
			end
		end
		table.sort(notes)
		return notes
	end
	W.engineNotes = engineNotes

	-- An output key, or "Minion.X": the minion's X as the player's output carries it (output.Minion).
	function W.outputField(output, k)
		if output[k] ~= nil then return output[k] end
		local m = k:match("^Minion%.(.+)$")
		if m and type(output.Minion) == "table" then return output.Minion[m] end
		return nil
	end

	local function withNotes(b, warnings)
		for _, n in ipairs(engineNotes(b)) do warnings[#warnings + 1] = n end
		return warnings
	end

	function ops.sidebar()
		local b = W.build()
		local rows, warnings = sidebar(b)
		return { stats = rows, warnings = withNotes(b, warnings) }
	end

	-- The sidebar values the mutations and evaluations diff (W.sidebarValues), for the server's compare_builds.
	function ops.values()
		return { values = object(W.sidebarValues(W.build())) }
	end

	function ops.warnings()
		local b = W.build()
		local _, warnings = sidebar(b)
		return { warnings = withNotes(b, warnings) }
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
				local v = nil
				if type(k) == "string" then v = W.outputField(actor.output, k) end
				if v ~= nil then out[k] = W.plain(v) end
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

	-- args: key, actor?, mode? ("main": the sidebar's main skill, default; "calcs": the skill picked on the Calcs tab).
	-- Breakdown rows as the Calcs tab draws them. The main env carries breakdowns too (CalcSetup buildBreakdown for
	-- MAIN and CALCS). PoB keeps a damage type's rows under the type (Cold for ColdMin/ColdMax) and an attack's under
	-- MainHand/OffHand; FullDPS has none, so its rows are the Full DPS skill list.
	local hitTypes = { Physical = true, Lightning = true, Cold = true, Fire = true, Chaos = true }
	local function findBreakdown(bd, key)
		if not bd then return nil end
		if bd[key] ~= nil then return bd[key] end
		local dt = key:match("^(%a-)M[ai][nx]$")
		if dt and hitTypes[dt] and bd[dt] ~= nil then return bd[dt] end
		local hands
		for _, h in ipairs({ "MainHand", "OffHand" }) do
			local v = type(bd[h]) == "table" and findBreakdown(bd[h], key)
			if v then hands = hands or {}; hands[h] = v end
		end
		return hands
	end
	function ops.breakdown(args)
		if type(args.key) ~= "string" then W.fail("invalid_input", "key is required") end
		local b = W.build()
		local env = args.mode == "calcs" and b.calcsTab.calcsEnv or b.calcsTab.mainEnv
		local actor = env and env[args.actor == "minion" and "minion" or "player"]
		local bd = actor and findBreakdown(actor.breakdown, args.key)
		if bd == nil and args.key == "FullDPS" and actor and type(actor.output.SkillDPS) == "table" then
			bd = {}
			for _, sk in ipairs(actor.output.SkillDPS) do
				bd[#bd + 1] = { name = sk.name, dps = sk.dps, count = sk.count, skillPart = strip(sk.skillPart), source = strip(sk.source) }
			end
		end
		local ms = actor and actor.mainSkill
		local skill = ms and ms.activeEffect and ms.activeEffect.grantedEffect.name or nil
		if bd == nil then
			-- Path of Building writes a breakdown only where the Calcs tab draws one, and some only when the figure is more
			-- than its base (Life); name the value and the breakdowns that start with the key (ManaRegen: ManaRegenRecovery).
			local value, near = actor and actor.output[args.key], {}
			for k in pairs(actor and actor.breakdown or {}) do
				-- TotalDot without a stacking DoT is the sum of the per-type DoTs (ColdDot, ...), each with its own rows
				if type(k) == "string" and k ~= args.key and (k:sub(1, #args.key) == args.key or (args.key == "TotalDot" and k:match("^%a+Dot$"))) then near[#near + 1] = k end
			end
			table.sort(near)
			W.fail("not_found", "no breakdown for " .. args.key .. (type(value) == "number" and string.format(" (its value is %s)", value) or "")
				.. (#near > 0 and ("; breakdowns that start with it" .. (args.key == "TotalDot" and " or make it up" or "") .. ": " .. table.concat(near, ", ", 1, math.min(#near, 10))) or ""))
		end
		return { key = args.key, skill = skill, value = W.plain(actor.output[args.key]), breakdown = W.plain(bd) }
	end

	-- The non-damaging ailments the main skill's hits apply to the enemy set in the config (enemyIsBoss), read from the
	-- Calcs tab's <Ailment>DPS table: its row at that enemy's ailment threshold (the one Path of Building labels with
	-- the boss type). PoB does not apply this to the build: it applies the config's conditionShockEffect (and the like).
	function ops.ailments()
		local b = W.build()
		local actor = b.calcsTab.mainEnv and b.calcsTab.mainEnv.player
		local out, bd = actor and actor.output or {}, actor and actor.breakdown or {}
		local list = setmetatable({}, { __jsontype = "array" })
		for _, name in ipairs({ "Shock", "Chill", "Scorch", "Brittle", "Sap" }) do
			local data, rows = data.nonDamagingAilment[name], bd[name .. "DPS"] and bd[name .. "DPS"].rowList
			for _, row in ipairs(rows or {}) do
				if type(row.thresh) == "string" and row.thresh:find("%^8%(") then
					local effect = tonumber(row.effect:match("^([%d%.]+)%%"))
					local maximum = out["Maximum" .. name] or data.max
					list[#list + 1] = { ailment = name, effect = math.min(effect, maximum), uncapped = effect, maximum = maximum,
						minimum = data.min, applies = effect >= data.min, threshold = tonumber(row.thresh:match("^(%d+)")),
						chanceOnHit = out[name .. "ChanceOnHit"], chanceOnCrit = out[name .. "ChanceOnCrit"], duration = out[name .. "Duration"] }
				end
			end
		end
		return { enemy = b.configTab.input.enemyIsBoss or "Pinnacle", skill = b.calcsTab.mainEnv and b.calcsTab.mainEnv.player.mainSkill
			and W.strip(b.calcsTab.mainEnv.player.mainSkill.activeEffect.grantedEffect.name), ailments = list }
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
	-- checks and cell text, for the actor the tab shows, in the sidebar's environment (mode calcs: the Calcs tab's own).
	-- Collapsed state is a view setting and is ignored.
	-- args: section? (a section id, else part of a subsection label, any case), mode? ("main"|"calcs")
	function ops.sections(args)
		local b = W.build()
		local tab = b.calcsTab
		local env = args.mode == "calcs" and tab.calcsEnv or tab.mainEnv
		local actor = tab.input.showMinion and env.minion or env.player
		local function shown(obj) return tab:CheckFlag(obj, actor, env.player) end
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
			if match and shown(sec) then
				local subs = setmetatable({}, { __jsontype = "array" })
				for _, subSec in ipairs(sec.subSection) do
					local rows = setmetatable({}, { __jsontype = "array" })
					for _, rowData in ipairs(subSec.data) do
						if shown(rowData) then
							local values = setmetatable({}, { __jsontype = "array" })
							for _, colData in ipairs(rowData) do
								if colData.format and shown(colData) then
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
		return { skill = env.player.mainSkill and W.strip(env.player.mainSkill.activeEffect.grantedEffect.name), sections = sections }
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
		-- max is Path of Building's level-100 cap (99 + 23 quest points + extra, EstimatePlayerProgress); at the build's level
		-- the cap is one point a level past 1 plus the same quest and extra points (every campaign quest done).
		local extra = b.calcsTab.mainOutput and b.calcsTab.mainOutput.ExtraPoints or 0
		return {
			used = tonumber(used), max = tonumber(max), level = b.characterLevel,
			maxAtLevel = math.min(tonumber(max) or 0, b.characterLevel - 1 + 23 + extra),
			ascendancyUsed = tonumber(ascUsed), ascendancyMax = tonumber(ascMax),
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
