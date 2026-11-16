-- items.* ops: the item list, slots, item sets and item editing, through the Items tab's own controls.
-- Edits work as in the application: the item is opened as the display item (a double click on the item
-- list), changed with the display item's controls and popups, then saved with the Save / Add to build button.
return function(W)
	local main = W.main
	local ops = {}

	local function itemOf(tab, id)
		local item = tab.items[id]
		if not item then W.fail("not_found", "no item " .. tostring(id)) end
		return item
	end
	local function slotOf(tab, name)
		local slot = tab.slots[name]
		if not slot then W.fail("invalid_input", "no item slot " .. tostring(name)) end
		return slot
	end

	local function equippedIn(tab, id)
		local out = {}
		for name, slot in pairs(tab.slots) do
			if slot.selItemId == id then out[#out + 1] = name end
		end
		table.sort(out)
		return out
	end

	-- The lines in force for the item's selected variant (a unique lists every variant's lines).
	local function lines(item, list)
		local out = {}
		for _, l in ipairs(list or {}) do
			if item:CheckModLineVariant(l) then out[#out + 1] = W.strip(l.line) end
		end
		return out
	end

	local function sockets(item)
		local parts, prev = {}, nil
		for _, s in ipairs(item.sockets or {}) do
			if prev then parts[#parts + 1] = s.group == prev and "-" or " " end
			parts[#parts + 1] = s.color
			prev = s.group
		end
		return table.concat(parts)
	end

	-- Items the game cannot make, which Path of Building reads without a word. Prefixes and suffixes are Path of Building's
	-- own split when it has one (crafted in it); otherwise each explicit line is matched, numbers aside, to the mods the base
	-- rolls (a mod of two lines counts once when both are there; crafted lines are matched to the bench crafts first), and
	-- lines no mod or both kinds match are left out, so the count is a lower bound. ponytail: text match on the base's pool; a mod the pool lacks (veiled, essence-only) is not counted.
	local conquerors = { "shaper", "elder", "adjudicator", "basilisk", "crusader", "eyrie" }
	local function norm(line) return (W.strip(line):gsub("%([%-%d%.]+%-[%-%d%.]+%)", "0"):gsub("[%-+]?[%d%.]+", "#")) end
	local function warningsOf(item)
		local out = {}
		if item.rarity ~= "MAGIC" and item.rarity ~= "RARE" and item.rarity ~= "NORMAL" then return out end
		local eldritch = item.cleansing or item.tangle
		for _, l in ipairs(item.implicitModLines or {}) do if l.exarch or l.eater then eldritch = true end end
		if eldritch then
			for _, key in ipairs(conquerors) do
				if item[key] then
					out[#out + 1] = "an item with eldritch implicits (Searing Exarch / Eater of Worlds) cannot also have Shaper, Elder or conqueror influence"
					break
				end
			end
		end
		if item.rarity == "NORMAL" then return out end
		local half = item.rarity == "MAGIC" and 1 or ((item.type == "Jewel" or item.type == "Graft") and 2 or 3)
		local prefixLimit, suffixLimit = item.prefixes and item.prefixes.limit or half, item.suffixes and item.suffixes.limit or half
		local counts = { Prefix = 0, Suffix = 0 }
		if item.crafted and item.affixLimit and item.affixLimit > 0 then
			for kind, list in pairs({ Prefix = item.prefixes, Suffix = item.suffixes }) do
				for _, a in ipairs(list) do if a.modId and a.modId ~= "None" then counts[kind] = counts[kind] + 1 end end
			end
		elseif item.affixes then
			local left, crafted = {}, {}
			for _, l in ipairs(item.explicitModLines or {}) do
				if l.line and l.line:match("%S") then
					local pool, k = l.crafted and crafted or left, norm(l.line)
					pool[k] = (pool[k] or 0) + 1
				end
			end
			-- a mod of several lines counts once when all its lines are left in `pool`
			local function takeMulti(mods, pool)
				for _, mod in ipairs(mods) do
					local keys, all = {}, true
					for i, line in ipairs(mod) do keys[i] = norm(line); if (pool[keys[i]] or 0) == 0 then all = false end end
					if all then
						for _, k in ipairs(keys) do pool[k] = pool[k] - 1 end
						counts[mod.type] = counts[mod.type] + 1
					end
				end
			end
			local single, multi = {}, {}
			-- a cluster jewel's notables weigh by its enchant's tags, not the base's: the whole cluster pool counts
			local cluster = item.base and item.base.subType == "Cluster"
			for id, mod in pairs(item.affixes) do
				if (mod.type == "Prefix" or mod.type == "Suffix") and (cluster or item:GetModSpawnWeight(mod) > 0) then
					if #mod == 1 then
						local k = norm(mod[1]); single[k] = (single[k] == nil or single[k] == mod.type) and mod.type or false
					elseif #mod > 1 then
						multi[#multi + 1] = { id = id, mod = mod }
					end
				end
			end
			table.sort(multi, function(x, y) return x.id < y.id end)
			for i, entry in ipairs(multi) do multi[i] = entry.mod end
			-- Bench crafts (ModMaster, no spawn weights) for the item's type: crafted lines are matched to them first, so a
			-- two-line craft (+# to Armour, +# to maximum Energy Shield) is one prefix; what is left joins the other lines.
			local bench = {}
			for _, mod in ipairs(data.masterMods) do
				if (mod.type == "Prefix" or mod.type == "Suffix") and mod.types and mod.types[item.type] then
					if #mod > 1 then
						bench[#bench + 1] = mod
					elseif #mod == 1 then
						local k = norm(mod[1])
						if single[k] == nil then single[k] = mod.type end
					end
				end
			end
			takeMulti(bench, crafted)
			for k, n in pairs(crafted) do left[k] = (left[k] or 0) + n end
			takeMulti(multi, left)
			for k, n in pairs(left) do
				if n > 0 and single[k] then counts[single[k]] = counts[single[k]] + n end
			end
		end
		if counts.Prefix > prefixLimit then out[#out + 1] = string.format("%d prefixes, more than the %d a %s %s can have", counts.Prefix, prefixLimit, item.rarity:lower(), item.type) end
		if counts.Suffix > suffixLimit then out[#out + 1] = string.format("%d suffixes, more than the %d a %s %s can have", counts.Suffix, suffixLimit, item.rarity:lower(), item.type) end
		return out
	end

	local function describe(tab, item, full)
		local out = {
			id = item.id, name = W.strip(item.name or ""), title = item.title, baseName = item.baseName, rarity = item.rarity,
			type = item.type, quality = item.quality, sockets = item.sockets and #item.sockets > 0 and sockets(item) or nil,
			equipped = equippedIn(tab, item.id), corrupted = item.corrupted == true,
		}
		local warnings = warningsOf(item)
		if #warnings > 0 then out.warnings = warnings end
		if full then
			out.raw = item:BuildRaw()
			out.enchants, out.implicits, out.explicits = lines(item, item.enchantModLines), lines(item, item.implicitModLines), lines(item, item.explicitModLines)
			out.anoints = tab:getAnoint(item)
			if item.variantList and #item.variantList > 1 then
				out.variant, out.altVariant, out.variants = item.variant, item.hasAltVariant and item.variantAlt or nil, {}
				for i, v in ipairs(item.variantList) do out.variants[i] = v end
			end
			out.ranges = {}
			for i, l in ipairs(item.rangeLineList or {}) do
				if l.range then out.ranges[#out.ranges + 1] = { index = i, line = W.strip(l.line), range = l.range } end
			end
			out.validSlots = {}
			for _, slot in ipairs(tab.orderedSlots) do
				if not slot.nodeId and tab:IsItemValidForSlot(item, slot.slotName) then out.validSlots[#out.validSlots + 1] = slot.slotName end
			end
		end
		return out
	end

	local function sets(tab)
		local out = {}
		for i, id in ipairs(tab.itemSetOrderList) do
			out[#out + 1] = { index = i, title = tab.itemSets[id].title or "Default", active = id == tab.activeItemSetId }
		end
		return out
	end

	-- The item list in order, every slot with what it holds, item sets. args: itemSet? (index): the slots as that set holds
	-- them (each set keeps its own slot items and flask state, ItemsTab itemSets[id][slotName]), without switching to it.
	function ops.list(args)
		local tab = W.build().itemsTab
		local items = {}
		for _, id in ipairs(tab.itemOrderList) do items[#items + 1] = describe(tab, tab.items[id]) end
		local set = tab.activeItemSet
		if args and args.itemSet ~= nil then
			local id = tab.itemSetOrderList[tonumber(args.itemSet)]
			if not id then W.fail("not_found", "no item set " .. tostring(args.itemSet)) end
			set = tab.itemSets[id]
		end
		local slots = {}
		for _, slot in ipairs(tab.orderedSlots) do
			if not slot.nodeId and slot:IsShown() then
				local held = set[slot.slotName] or {}
				local active
				if slot.controls.activate then active = held.active == true end -- flask and tincture slots
				slots[#slots + 1] = { slot = slot.slotName, item = (held.selItemId or 0) ~= 0 and held.selItemId or nil, active = active }
			end
		end
		return { items = items, slots = slots, sets = sets(tab), weaponSet = set.useSecondWeaponSet and 2 or 1 }
	end

	-- args: item. The item's text and parsed lines, variants, roll ranges and the slots it fits.
	function ops.get(args)
		local tab = W.build().itemsTab
		return describe(tab, itemOf(tab, args.item), true)
	end

	-- The hover text of an item in the Items tab's list (AddItemTooltip): its lines, a flask's effective stats with its
	-- uptime, and what equipping it in each slot it fits would change.
	-- Our estimate (not Path of Building's) of a utility flask's uptime with charges gained on critical strike or on being
	-- hit, which the tooltip leaves out: crits per second (main skill's Speed x HitChance x CritChance, one target) x the
	-- chance per crit (the flask's own mods plus the build's, capped at 100%) plus the flask's own charges per crit
	-- (Surgeon's "Recharges N Charges"), plus hits taken per second (one enemy skill use per enemy attack / cast time,
	-- each one a hit) x the flask's charges when hit (Masochist's, Flagellant's; Path of Building parses neither line),
	-- all x the charge gain modifier, plus the charges the tooltip counts per second, against charges used per second
	-- (charges per use x the chance to consume / duration). The terms are the tooltip's (ItemsTab:AddItemTooltip).
	-- ponytail: no in-game cooldown on charge gain, one target, no avoided hits, no per-empty-flask or ward-break charges;
	-- add them when a build needs them.
	local function flaskEstimate(b, item)
		local fd, base = item.flaskData, item.base.flask
		if not fd or not base or base.life or base.mana or not fd.duration or fd.duration <= 0 then return nil end
		local modDB, out = b.calcsTab.mainEnv.modDB, b.calcsTab.mainOutput
		local own, perCritCharges, perHitCharges = 0, 0, 0
		for _, lines in ipairs({ item.enchantModLines, item.implicitModLines, item.explicitModLines, item.crucibleModLines }) do
			for _, line in ipairs(lines or {}) do
				local text = W.strip(line.line or ""):lower()
				perHitCharges = perHitCharges + (tonumber(text:match("^gains? (%d+) charges? when you are hit by an enemy$")) or 0)
				perCritCharges = perCritCharges + (tonumber(text:match("^recharges? (%d+) charges? when you deal a critical strike$")) or 0)
				for _, mod in ipairs(line.modList or {}) do
					if mod.name == "FlaskChargeOnCritChance" and mod.type == "BASE" then own = own + mod.value end
				end
			end
		end
		-- an active flask's mods join the build's (Path of Building applies them all globally); the crit charge mod of a flask
		-- is local to it in the game, so flask sources are left out of the build's chance
		local global = 0
		for _, t in ipairs(modDB:Tabulate("BASE", nil, "FlaskChargeOnCritChance")) do
			local id = tostring(t.mod.source):match("^Item:(%d+):")
			local from = id and b.itemsTab.items[tonumber(id)]
			if not (from and from.base and from.base.flask) then global = global + t.value end
		end
		local perCrit = math.min(own + global, 100) / 100
		local gainMod = fd.gainMod * (1 + modDB:Sum("INC", nil, "FlaskChargesGained") / 100)
		local generated = (modDB:Sum("BASE", nil, "FlaskChargesGenerated") + modDB:Sum("BASE", nil, "UtilityFlaskChargesGenerated")) * gainMod
		local speed, hit, crit = out.Speed or 0, (out.HitChance or 100) / 100, (out.CritChance or 0) / 100
		local critsPerSecond = speed * hit * crit
		local hitsTakenPerSecond = (out.enemySkillTime or 0) > 0 and 1 / out.enemySkillTime or 0
		local gained = (critsPerSecond * (perCrit + perCritCharges) + hitsTakenPerSecond * perHitCharges) * gainMod + generated
		local duration = fd.duration * (1 + modDB:Sum("INC", nil, "FlaskDuration") / 100)
		local used = fd.chargesUsed * (1 + modDB:Sum("INC", nil, "FlaskChargesUsed") / 100)
		local consume = 1 - math.min(modDB:Sum("BASE", nil, "FlaskChanceNotConsumeCharges"), 100) / 100
		local needed = used * consume / duration
		return {
			source = "estimate by this API, not Path of Building; any in-game cooldown on charge gain is not modelled, and every enemy attack or cast counts as a hit taken",
			chargesGainedPerSecond = gained, chargesNeededPerSecond = needed,
			estimatedUptime = needed > 0 and math.min(gained / needed, 1) or 1,
			inputs = { speed = speed, hitChance = hit, critChance = crit, critsPerSecond = critsPerSecond, flaskChanceOnCrit = own,
				buildChanceOnCrit = global, flaskChargesPerCrit = perCritCharges, hitsTakenPerSecond = hitsTakenPerSecond,
				flaskChargesWhenHit = perHitCharges, gainModifier = gainMod, generatedPerSecond = generated, chargesPerUse = used,
				chanceToConsume = consume, duration = duration },
		}
	end

	function ops.tooltip(args)
		local b = W.build()
		local tab = b.itemsTab
		local id = args.item
		if args.slot ~= nil then
			id = slotOf(tab, args.slot).selItemId
			if not id or id == 0 then W.fail("not_found", args.slot .. " holds no item") end
		end
		local item = itemOf(tab, id)
		return { item = item.id, name = W.strip(item.name), lines = W.tooltip(function(t) tab:AddItemTooltip(t, item) end), uptime = flaskEstimate(b, item) }
	end

	-- Saves the display item with the Save / Add to build button; a new item goes where `equip` says.
	local function save(tab, equip)
		local item = tab.displayItem
		local isNew = not (item.id and tab.items[item.id])
		if not isNew or equip == nil or equip == "auto" then
			tab.controls.addDisplayItem:Click()
		else
			tab:AddDisplayItem(true)
			if equip ~= "none" then
				local slot = slotOf(tab, equip)
				if not tab:IsItemValidForSlot(item, equip) then W.fail("invalid_input", "this item does not fit " .. equip) end
				slot:SetSelItemId(item.id)
				tab:PopulateSlots()
				tab:AddUndoState()
			end
		end
		if tab.displayItem then W.fail("worker_error", "the item was not saved") end
		return item
	end

	local function fromRaw(tab, raw)
		tab:SetDisplayItem()
		tab:CreateDisplayItemFromRaw(W.withUniqueRadius(raw), true)
		if not tab.displayItem then W.fail("invalid_input", "Path of Building could not read this item (unknown base?)") end
		return tab.displayItem
	end

	-- args: text (item text as copied in game or from Path of Building), equip? ("auto", "none" or a slot).
	ops.add = W.mutation(function(args, b)
		if type(args.text) ~= "string" or not args.text:match("%S") then W.fail("invalid_input", "text is required") end
		local tab = b.itemsTab
		fromRaw(tab, args.text)
		return describe(tab, save(tab, args.equip))
	end)

	local function fromDB(db, name, kind)
		if db.loading then W.fail("worker_error", "the " .. kind .. " list is still loading") end
		local want = tostring(name):lower()
		local found
		for key, item in pairs(db.list) do -- keyed by "<title>, <base>"
			if key:lower() == want or (item.title or ""):lower() == want then
				if found and found ~= item then W.fail("invalid_input", "more than one " .. kind .. " is named " .. tostring(name) .. "; give the full name") end
				found = item
			end
		end
		if not found then W.fail("not_found", "no " .. kind .. " named " .. tostring(name)) end
		return found
	end

	-- The variant dropdown's choice (the second one, displayItemAltVariant, only on items that have one).
	local function setVariant(tab, control, index)
		local item, drop = tab.displayItem, tab.controls[control]
		if item.usesVariantGroups then W.fail("invalid_input", "this item picks its variants by version; change them with edit") end
		if not (drop:IsShown() and item.variantList[index]) then W.fail("invalid_input", "this item has no " .. (control == "displayItemVariant" and "variant " or "second variant ") .. tostring(index)) end
		drop.selIndex = index
		drop.selFunc(index, item.variantList[index])
	end

	-- args: name, variant? (index into its variants), equip?. From the unique database.
	ops.add_unique = W.mutation(function(args, b)
		local tab = b.itemsTab
		local item = fromRaw(tab, fromDB(main.uniqueDB, args.name, "unique").raw)
		if args.variant ~= nil then setVariant(tab, "displayItemVariant", args.variant) end
		return describe(tab, save(tab, args.equip))
	end)

	-- args: name, equip?. From the rare template database.
	ops.add_rare = W.mutation(function(args, b)
		local tab = b.itemsTab
		fromRaw(tab, fromDB(main.rareDB, args.name, "rare template").raw)
		return describe(tab, save(tab, args.equip))
	end)

	-- Opens an item for editing, as a double click on the item list does (ItemListControl.lua:327).
	local function open(tab, id)
		local item = itemOf(tab, id)
		local copy = new("Item"):Item(item:BuildRaw())
		copy.id = item.id
		tab:SetDisplayItem(copy)
		return copy
	end

	local function pick(drop, match, what)
		for i, v in ipairs(drop.list) do
			if match(v, i) then
				drop.selIndex = i
				if drop.selFunc then drop.selFunc(i, v) end
				return v
			end
		end
		W.fail("invalid_input", "no " .. what)
	end

	-- The index of the entry whose text is `text` (exact, else the one entry containing it) in a dropdown's list.
	local function choose(list, text, what)
		local want, found, seen = tostring(text):lower(), nil, {}
		for i, v in ipairs(list) do
			local label = W.strip(type(v) == "table" and (v.label or "") or v):lower()
			if label == want then return i end
			if label:find(want, 1, true) then
				found = found or i
				seen[#seen + 1] = W.strip(type(v) == "table" and v.label or v)
			end
		end
		if #seen > 1 then W.fail("invalid_input", "more than one " .. what .. " matches " .. tostring(text) .. ": " .. table.concat(seen, " | ", 1, math.min(#seen, 6))) end
		if not found then W.fail("invalid_input", "no " .. what .. " matches " .. tostring(text)) end
		return found
	end

	-- Runs fn(controls) on the popup a button just opened, then closes it if fn left it open; errors pass through.
	local function inPopup(fn)
		local p = main.popups[1]
		if not p then W.fail("worker_error", "expected a dialog, none is open") end
		local ok, err = pcall(fn, p.controls)
		if main.popups[1] == p then main:ClosePopup() end
		if not ok then error(err, 0) end
	end

	-- One affix box of a crafted item: the choice by text and its roll (0..1 across the tiers), as the box's own selection does.
	local function setAffix(tab, slot, text, roll)
		local drop = tab.controls["displayItemAffix" .. tostring(slot)]
		if not drop or not drop:IsShown() then W.fail("invalid_input", "no affix box " .. tostring(slot)) end
		local found = choose(drop.list, text, "choice in affix box " .. slot)
		if drop.slider then drop.slider.val = roll or 1 end
		drop.selIndex = found
		drop.selFunc(found, drop.list[found])
	end

	-- Sockets like "R-G-B W": colours R G B W A, "-" links. Uses the socket dropdowns, link boxes and + button.
	local function setSockets(tab, item, spec)
		if type(spec) ~= "string" or not spec:match("^[RGBWA]") or spec:sub(2):gsub("[ %-][RGBWA]", "") ~= "" then W.fail("invalid_input", "sockets look like R-G-B B") end
		local colors, links = {}, {}
		for c, sep in spec:gmatch("([RGBWA])([ %-]?)") do
			colors[#colors + 1] = c
			links[#links + 1] = sep == "-"
		end
		local want = #colors - item.abyssalSocketCount
		if want > item.selectableSocketCount then W.fail("invalid_input", "this item takes at most " .. item.selectableSocketCount .. " sockets") end
		if want < #item.sockets - item.abyssalSocketCount then W.fail("invalid_input", "to remove sockets, edit the item text") end
		while #item.sockets - item.abyssalSocketCount < want do tab.controls.displayItemAddSocket:Click() end
		for i = 1, want do
			pick(tab.controls["displayItemSocket" .. i], function(v) return v.color == colors[i] end, "socket colour " .. colors[i])
			if i < want then
				local box = tab.controls["displayItemLink" .. i]
				box.state = links[i]
				box.changeFunc(links[i])
			end
		end
	end

	-- args: item, plus any of: variant, altVariant (index), quality, sockets, ranges ([{ index, value 0..1 }]),
	-- catalyst (index of the catalyst list, 0 = none), catalystQuality. Display item controls, then Save.
	ops.modify = W.mutation(function(args, b)
		local tab = b.itemsTab
		local item = open(tab, args.item)
		local c = tab.controls
		if args.variant ~= nil then setVariant(tab, "displayItemVariant", args.variant) end
		if args.altVariant ~= nil then setVariant(tab, "displayItemAltVariant", args.altVariant) end
		if args.quality ~= nil then
			if not c.displayItemQualityEdit:IsShown() then W.fail("invalid_input", "this item has no quality") end
			c.displayItemQualityEdit:SetText(tostring(args.quality), true)
		end
		if args.catalyst ~= nil then
			if not c.displayItemCatalyst:IsShown() then W.fail("invalid_input", "catalysts apply to crafted rings, amulets and belts") end
			pick(c.displayItemCatalyst, function(_, i) return i == args.catalyst + 1 end, "catalyst " .. tostring(args.catalyst))
		end
		if args.catalystQuality ~= nil then c.displayItemCatalystQualityEdit:SetText(tostring(args.catalystQuality), true) end
		if args.sockets ~= nil then setSockets(tab, tab.displayItem, args.sockets) end
		for _, r in ipairs(args.ranges or {}) do
			local found
			for i, entry in ipairs(c.displayItemRangeLine.list) do
				if entry.modLine == tab.displayItem.rangeLineList[r.index] then found = i end
			end
			if not found then W.fail("invalid_input", "line " .. tostring(r.index) .. " has no roll range") end
			c.displayItemRangeLine.selIndex = found
			c.displayItemRangeLine.selFunc(found, c.displayItemRangeLine.list[found])
			c.displayItemRangeSlider:SetVal(r.value)
		end
		return describe(tab, save(tab), true)
	end)

	-- args: item, text. The Edit... popup's text, saved over the item.
	ops.edit = W.mutation(function(args, b)
		local tab = b.itemsTab
		itemOf(tab, args.item)
		local item = fromRaw(tab, args.text)
		item.id = args.item
		return describe(tab, save(tab), true)
	end)

	-- args: item, notables ([name]; one per anoint slot, in order; [] removes the anoints). The item's Anoint... buttons and popup.
	ops.anoint = W.mutation(function(args, b)
		local tab = b.itemsTab
		if type(args.notables) ~= "table" then W.fail("invalid_input", "notables is required") end
		open(tab, args.item)
		local c = tab.controls
		if not c.displayItemAnoint:IsShown() then W.fail("invalid_input", "this item cannot be anointed") end
		local nodes = {}
		for i, name in ipairs(args.notables) do
			local node = b.spec.tree.notableMap[tostring(name):lower()]
			if not (node and node.recipe and #node.recipe >= 1) then W.fail("invalid_input", tostring(name) .. " is not a notable that can be anointed") end
			nodes[i] = node
		end
		-- The popup's Anoint / Remove button for one slot (the slot's button only shows once the slot before it holds an anoint).
		local function anointSlot(i, node)
			local button = c[i == 1 and "displayItemAnoint" or "displayItemAnoint" .. i]
			if not (button and button:IsShown()) then W.fail("invalid_input", "this item has no anoint slot " .. i) end
			button:Click()
			main.popups[1].controls.notableDB.selValue = node
			W.clickPopup("save")
		end
		for i = #tab.displayItem.enchantModLines, #nodes + 1, -1 do anointSlot(i) end
		for i, node in ipairs(nodes) do anointSlot(i, node) end
		return describe(tab, save(tab), true)
	end)

	-- args: item, enchantment (text of one entry, exact or a unique part), source? (e.g. "Normal", "Eternal"), skill?. The enchant popup.
	ops.enchant = W.mutation(function(args, b)
		local tab = b.itemsTab
		local item = open(tab, args.item)
		if not item.enchantments then W.fail("invalid_input", "this item has no enchantments to choose from") end
		tab:EnchantDisplayItem(1)
		local p = main.popups[1]
		local ok, err = pcall(function()
			local c = p.controls
			if args.skill ~= nil then
				if not c.skill then W.fail("invalid_input", "this item's enchantments are not per skill") end
				if c.allSkills and not c.allSkills.state and c.allSkills:IsEnabled() then c.allSkills.state = true; c.allSkills.changeFunc(true) end
				pick(c.skill, function(v) return (type(v) == "table" and (v.label or v.name) or v) == args.skill end, "skill " .. tostring(args.skill))
			end
			if args.source ~= nil then
				pick(c.enchantmentSource, function(v) return (type(v) == "table" and (v.label or v.name) or v) == args.source end, "enchantment source " .. tostring(args.source))
			end
			local want, found = tostring(args.enchantment):lower(), nil
			for i, v in ipairs(c.enchantment.list) do
				local label = W.strip(type(v) == "table" and (v.label or "") or v):lower()
				if label == want then found = i break end
				if label:find(want, 1, true) then
					if found then W.fail("invalid_input", "more than one enchantment matches " .. tostring(args.enchantment)) end
					found = i
				end
			end
			if not found then W.fail("invalid_input", "no enchantment matches " .. tostring(args.enchantment)) end
			c.enchantment:SetSel(found)
			c.save:Click()
		end)
		if main.popups[1] == p then main:ClosePopup() end
		if not ok then error(err, 0) end
		return describe(tab, save(tab), true)
	end)

	-- args: base (base type name), rarity? ("NORMAL" | "MAGIC" | "RARE"; default RARE), title?, affixes? ([{ slot (1-based affix box),
	-- mod (text of the choice), roll? 0..1 across its tiers }]), equip?. The Craft item... popup, then the affix boxes.
	-- The Craft item... popup on a base, then the affix boxes: the display item, not yet added.
	local function craftBase(b, args)
		local tab = b.itemsTab
		local base = b.data.itemBases[args.base]
		if not base then W.fail("invalid_input", "unknown item base " .. tostring(args.base)) end
		tab:SetDisplayItem()
		tab:CraftItem()
		local p = main.popups[1]
		local ok, err = pcall(function()
			local c = p.controls
			local rarity = args.rarity or "RARE"
			pick(c.rarity, function(v) return v.rarity == rarity end, "rarity " .. rarity)
			if c.title:IsShown() and args.title then c.title:SetText(args.title) end
			local typeName = base.type .. (base.subType and (": " .. base.subType) or "") -- the type list's entries
			pick(c.type, function(v) return v == typeName end, "item type " .. typeName)
			pick(c.base, function(v) return v.name == args.base end, "base " .. args.base)
			c.save:Click()
		end)
		if not ok then
			while main.popups[1] do main:ClosePopup() end
			error(err, 0)
		end
		while main.popups[1] do main:ClosePopup() end -- magic and rare bases without affix boxes open the text editor; keep the base
		local item = tab.displayItem
		if not item then W.fail("worker_error", "craft made no item") end
		for _, a in ipairs(args.affixes or {}) do
			if not item.crafted then W.fail("invalid_input", "this base has no affix boxes") end
			setAffix(tab, a.slot, a.mod, a.roll)
		end
		return item
	end

	-- args: xml, label (the other build, filled in by the server), slot, use?. The Compare tab's copy of the item the compared
	-- build has in a slot into this build's items; `use` equips it in the same slot.
	ops.copy_from = W.mutation(function(args, b)
		local tab = b.itemsTab
		local before = {}
		for id in pairs(tab.items) do before[id] = true end
		W.compared(args, function(ctab, entry) ctab:CopyCompareItemToPrimary(args.slot, entry, args.use == true) end)
		local added
		for id in pairs(tab.items) do if not before[id] then added = id end end
		if not added then W.fail("invalid_input", "the other build has no item in " .. tostring(args.slot)) end
		return function(nb) return describe(nb.itemsTab, nb.itemsTab.items[added], true) end
	end)

	-- args: item | slot (the item in it), league, realm?, listed? (the popup's Listed status by its api value), baseType? (the "Use
	-- specific base" box), itemLevel? ({ min, max }), select? and defences? (lists of { index, selected?, min?, max? }: a row listed
	-- is ticked unless selected is false; the popup ticks none), and, for another build's item, xml, label and otherSets (W.compared).
	-- The Buy similar popup (CompareBuySimilar.openPopup) driven through its controls: realm, league and listed dropdowns set, the
	-- rows' boxes and edits filled, then its Open URL button pressed; the link it copies is answered, with the search it carries.
	-- The popup asks the trade site for its league list when it opens and builds "Standard" while that is empty: its request is
	-- replaced by one that sends nothing, and the league list is exactly the given league before any link is built.
	local realmLabels = { pc = "PC", sony = "PS4", xbox = "Xbox" }
	function ops.buy_similar(args)
		local similar, helpers, null = require("Classes.CompareBuySimilar"), require("Classes.TradeHelpers"), W.json.null
		local function bad(message) W.fail("invalid_input", message) end
		if (args.item == nil) == (args.slot == nil) then bad("name the item or the slot, one of them") end
		if type(args.league) ~= "string" then bad("league is the trade league being played") end
		local function run(tab)
			local item, slotName
			if args.item then
				item = itemOf(tab, args.item)
				slotName = tab:GetComparisonSlotNameForItem(item)
			else
				slotName = slotOf(tab, args.slot).slotName
				item = tab.items[tab.slots[slotName].selItemId]
				if not item then W.fail("not_found", slotName .. " holds no item") end
			end
			local entries = similar.addModEntries(item, { { list = item.enchantModLines, type = "enchant" }, { list = item.implicitModLines, type = "implicit" },
				{ list = item.explicitModLines, type = "explicit" }, { list = item.scourgeModLines, type = "scourge" } })
			-- the popup keeps its last choices between openings; it starts from its own defaults here and leaves them as found
			local keep = { realm = similar.lastRealmIdx, listed = similar.lastListedIndex, leagues = similar.lastLeagueByRealm, openURL = OpenURL }
			similar.lastRealmIdx, similar.lastListedIndex, similar.lastLeagueByRealm = nil, nil, nil
			OpenURL = function() end -- Open URL copies the link, then hands it to the browser seam; nothing here opens it
			local popups = #main.popups
			local ok, out = pcall(function()
				similar.openPopup(item, slotName, { itemsTab = { tradeQuery = { tradeQueryRequests = { FetchLeagues = function() end } } } })
				local c = main.popups[1].controls
				local rows = 0
				while c["mod" .. (rows + 1) .. "Check"] do rows = rows + 1 end
				if rows ~= #entries then W.fail("worker_error", "the Buy similar popup lists " .. rows .. " mod rows, not " .. #entries) end
				local function search()
					W.takeCopied()
					W.clickPopup("Open URL")
					local url = W.takeCopied()
					local text = url and url:match("/([^/]+)$") and helpers.B64GzipDecode(url:match("/([^/]+)$"))
					if not text then W.fail("worker_error", "Buy similar made no search link") end
					return url, W.json.decode(text)
				end
				local function tick(box, on) box.state = on; box.changeFunc(on) end
				local function fill(edit, number) edit:SetText(number == nil and "" or tostring(number), true) end
				local function choose(drop, value)
					return W.choose(drop, function(v) return v == value end) or bad("the popup has no " .. tostring(value))
				end
				choose(c.realmDrop, realmLabels[args.realm or "pc"])
				c.leagueDrop:SetList({ args.league })
				choose(c.leagueDrop, args.league)
				if args.listed then
					local found
					for i, label in ipairs(c.listedDrop.list) do
						c.listedDrop.selIndex = i
						c.listedDrop.selFunc(i, label)
						if select(2, search()).status.option == args.listed then found = true break end
					end
					if not found then bad("listed " .. tostring(args.listed) .. " is not one of the popup's Listed choices") end
				end
				if args.baseType ~= nil or args.itemLevel ~= nil then
					if not c.baseTypeCheck then bad("baseType and itemLevel are not in the popup for a unique (it searches by name)") end
					if args.baseType ~= nil then tick(c.baseTypeCheck, args.baseType == true) end
					if args.itemLevel ~= nil then
						fill(c.ilvlMin, args.itemLevel.min)
						fill(c.ilvlMax, args.itemLevel.max)
					end
				end
				local defences = setmetatable({}, { __jsontype = "array" })
				while c["def" .. (#defences + 1) .. "Check"] do
					local pre = "def" .. (#defences + 1)
					defences[#defences + 1] = { index = #defences + 1, label = W.strip(c[pre .. "Label"].label), value = tonumber(c[pre .. "Min"].buf) }
				end
				-- one list of rows to set: the popup's boxes by name prefix (mod<i>, def<i>)
				local function setRows(list, prefix, count, what)
					for _, s in ipairs(list or {}) do
						local i, pre, on = s.index, prefix .. s.index, s.selected ~= false
						if i > count then bad(("%s: the popup has %d %s rows, not %d"):format(prefix == "mod" and "select" or "defences", count, what, i)) end
						if on and prefix == "mod" and #entries[i].tradeIds == 0 then bad(("select: mod row %d has no trade stat (canSearch is false)"):format(i)) end
						if (s.min ~= nil or s.max ~= nil) and (not on or not c[pre .. "Min"]) then
							bad(("%s row %d takes no min or max: %s"):format(what, i, on and "the trade site takes a choice for it, not a number" or "it is not selected")) end
						tick(c[pre .. "Check"], on)
						if s.min ~= nil then fill(c[pre .. "Min"], s.min) end
						if s.max ~= nil then fill(c[pre .. "Max"], s.max) end
					end
				end
				setRows(args.select, "mod", #entries, "mod")
				setRows(args.defences, "def", #defences, "defence")
				local url, query = search()
				local mods = setmetatable({}, { __jsontype = "array" })
				for i, e in ipairs(entries) do
					local pre = "mod" .. i
					local ids = setmetatable({}, { __jsontype = "array" })
					for j, id in ipairs(e.tradeIds) do ids[j] = id end
					local timeless = e.isOption and ids[1]:find("timeless", 1, true)
					local min, max = c[pre .. "Min"], c[pre .. "Max"]
					mods[i] = { index = i, type = e.type, line = W.strip(table.concat(e.formattedLines, "\n")), tradeId = #ids == 1 and ids[1] or null, tradeIds = ids,
						value = (timeless or not e.isOption) and e.value or null, option = e.isOption and not timeless and e.value or null, inverted = e.invert == true,
						selected = c[pre .. "Check"].state == true, min = min and tonumber(min.buf) or null, max = max and tonumber(max.buf) or null, canSearch = #ids > 0 }
				end
				for i, d in ipairs(defences) do
					local pre = "def" .. i
					d.selected, d.min, d.max = c[pre .. "Check"].state == true, tonumber(c[pre .. "Min"].buf) or null, tonumber(c[pre .. "Max"].buf) or null
				end
				return { item = { id = item.id, name = W.strip(item.name or ""), title = item.title, baseName = item.baseName, rarity = item.rarity, type = item.type },
					slot = slotName or null, league = args.league, realm = args.realm or "pc", listed = query.status.option, mods = mods, defences = defences,
					query = query, search = { query = query }, link = url }
			end)
			while #main.popups > popups do main:ClosePopup() end
			OpenURL = keep.openURL
			similar.lastRealmIdx, similar.lastListedIndex, similar.lastLeagueByRealm = keep.realm, keep.listed, keep.leagues
			if not ok then error(out, 0) end
			return out
		end
		if args.xml then return W.compared(args, function(_, entry) return run(entry.itemsTab) end) end
		return run(W.build().itemsTab)
	end

	ops.craft = W.mutation(function(args, b)
		craftBase(b, args)
		return describe(b.itemsTab, save(b.itemsTab, args.equip), true)
	end)

	-- args: base, rarity?, affixes? (as craft: filled first, so their groups are excluded as the boxes do), slots? (affix boxes to
	-- list; default every empty one), sort? (a Modifier sorting entry, e.g. Full DPS), limit? (choices per box). The choices in
	-- each affix box of a base crafted on the Items tab, in the box's order; with `sort`, best first by that stat for the build
	-- (UpdateAffixControl's power sort, the mid tier of each choice measured in its slot) and `value` is that stat with it.
	-- Nothing is added to the build.
	function ops.affix_options(args)
		local b = W.build()
		local tab = b.itemsTab
		local sorting = tab.controls.craftingSorting
		local keep = { item = tab.displayItem, sort = sorting.selIndex }
		local ok, out = pcall(function()
			local item = craftBase(b, args)
			if not item.crafted then W.fail("invalid_input", args.base .. " has no affix boxes at this rarity") end
			if args.sort ~= nil then
				if tab.controls.craftingSortingLabel.shown() ~= true then W.fail("invalid_input", "this base has no modifier sorting (cluster jewels)") end
				sorting.selIndex = choose(sorting.list, args.sort, "modifier sorting")
			end
			local stat = sorting.list[sorting.selIndex]
			local prefixLimit = item.prefixes.limit or (item.affixLimit / 2)
			local wanted = {}
			for _, i in ipairs(args.slots or {}) do wanted[i] = true end
			local cache, boxes = {}, {}
			for i = 1, item.affixLimit do
				local isPrefix = i <= prefixLimit
				local list, index = isPrefix and "prefixes" or "suffixes", isPrefix and i or i - prefixLimit
				local current = item[list][index] and item[list][index].modId or "None"
				if (args.slots and wanted[i]) or (not args.slots and current == "None") then
					if current ~= "None" then W.fail("invalid_input", "affix box " .. i .. " is filled; list only empty boxes") end
					local control = tab.controls["displayItemAffix" .. i]
					local modType = (isPrefix and not (item.rareLikeUnique and item.rareLikeUnique.ignoreModType)) and "Prefix" or (not isPrefix and "Suffix" or nil)
					tab:UpdateAffixControl(control, item, modType, list, index, cache)
					local choices = {}
					for j = 2, #control.list do
						if args.limit and #choices >= args.limit then break end
						local e = control.list[j]
						local mid = e.modList[#e.modList == 1 and 1 or 1 + round((#e.modList - 1) * main.defaultItemAffixQuality)] -- the tier the sort measures
						local tiers = {}
						for _, id in ipairs(e.modList) do
							local mod = item.affixes[id]
							tiers[#tiers + 1] = { id = id, text = table.concat(mod, " / "), level = mod.level }
						end
						choices[#choices + 1] = { text = W.strip(e.label), value = stat.stat and cache[mid] or W.json.null, tiers = tiers }
					end
					boxes[#boxes + 1] = { slot = i, type = isPrefix and "Prefix" or "Suffix", choices = setmetatable(choices, { __jsontype = "array" }) }
				end
			end
			if args.slots then
				for _, i in ipairs(args.slots) do
					if i < 1 or i > item.affixLimit then W.fail("invalid_input", "no affix box " .. i .. "; this base has " .. item.affixLimit) end
				end
			end
			return { base = item.baseName, rarity = item.rarity, sort = stat.label, boxes = setmetatable(boxes, { __jsontype = "array" }) }
		end)
		sorting.selIndex = keep.sort
		tab:SetDisplayItem(keep.item)
		if not ok then error(out, 0) end
		return out
	end

	-- args: item, influences ([name]: 0 to 2 of the Influence dropdowns' entries, e.g. Shaper, Elder, Searing Exarch; [] clears).
	ops.influence = W.mutation(function(args, b)
		local tab = b.itemsTab
		open(tab, args.item)
		local drops = { tab.controls.displayItemInfluence, tab.controls.displayItemInfluence2 }
		if not drops[1]:IsShown() then W.fail("invalid_input", "this item cannot have an influence") end
		if type(args.influences) ~= "table" or #args.influences > 2 then W.fail("invalid_input", "influences takes up to two names") end
		local want, wanted = {}, {}
		for i = 1, 2 do
			local name = args.influences[i]
			want[i] = name == nil and 1 or choose(drops[i].list, name, "influence") -- entry 1 is the empty "Influence"
			if want[i] > 1 and wanted[want[i]] then W.fail("invalid_input", "an influence can be given once") end
			wanted[want[i]] = true
		end
		for i = 1, 2 do drops[i]:SetSel(want[i]) end
		return describe(tab, save(tab), true)
	end)

	-- args: item, implicits ([text]: up to 2 entries of the popup's implicit lists, exact or one unique part; [] corrupts as is). The Corrupt... popup, Corrupted source.
	ops.corrupt = W.mutation(function(args, b)
		local tab = b.itemsTab
		open(tab, args.item)
		if not tab.controls.displayItemCorrupt:IsShown() then W.fail("invalid_input", "this item cannot be corrupted") end
		if type(args.implicits) ~= "table" then W.fail("invalid_input", "implicits is required") end
		tab:CorruptDisplayItem()
		inPopup(function(c)
			for i, text in ipairs(args.implicits) do
				local drop = c["implicit" .. i]
				if not (drop and drop:IsShown()) then W.fail("invalid_input", "this item takes " .. (i - 1) .. " corruption implicits at most") end
				drop:SetSel(choose(drop.list, text, "implicit"))
			end
			c.save:Click()
		end)
		return describe(tab, save(tab), true)
	end)

	-- args: item, source? (Vestigial, Searing Exarch, Eater of Worlds or Custom; default Custom with `text`, else the first listed),
	-- mod (text of a choice, exact or one unique part), text (for Custom). The Add Implicit... popup.
	ops.add_implicit = W.mutation(function(args, b)
		local tab = b.itemsTab
		open(tab, args.item)
		if not tab.controls.displayItemAddImplicit:IsShown() then W.fail("invalid_input", "this item takes no added implicit") end
		tab.controls.displayItemAddImplicit:Click()
		inPopup(function(c)
			local source = args.source or (args.text and "Custom") or nil
			if source then c.source:SetSel(choose(c.source.list, source, "source")) end
			if c.custom:IsShown() then
				if type(args.text) ~= "string" or not args.text:match("%S") then W.fail("invalid_input", "the Custom source needs text") end
				c.custom:SetText(args.text)
			else
				if type(args.mod) ~= "string" then W.fail("invalid_input", "mod is required for this source") end
				-- The Type box picks a group whose Modifier box lists the tiers (Vestigial lists one mod per Type entry).
				local entries, groups = {}, c.modGroupSelect
				for gi, group in ipairs(groups.list) do
					groups.selIndex = gi
					groups.selFunc(gi, group)
					if c.modSelect:IsShown() then
						for mi, entry in ipairs(c.modSelect.list) do entries[#entries + 1] = { label = entry.label, group = gi, mod = mi } end
					else
						entries[#entries + 1] = { label = group.label, group = gi }
					end
				end
				local hit = entries[choose(entries, args.mod, "modifier")]
				groups.selIndex = hit.group
				groups.selFunc(hit.group, groups.list[hit.group])
				if hit.mod then c.modSelect.selIndex = hit.mod end
			end
			c.save:Click()
		end)
		return describe(tab, save(tab), true)
	end)

	-- args: item, source (a listed source: Crafting Bench, Essence, Veiled, Beastcraft, Necropolis, Fossil, Prefix, Suffix, Custom ...),
	-- mod (text of a choice, exact or one unique part), text (for Custom). The Add modifier... popup.
	ops.custom_mod = W.mutation(function(args, b)
		local tab = b.itemsTab
		open(tab, args.item)
		if not tab.controls.displayItemAddCustom:IsShown() then W.fail("invalid_input", "this item takes no added modifiers (magic and rare items do)") end
		tab.controls.displayItemAddCustom:Click()
		inPopup(function(c)
			c.source:SetSel(choose(c.source.list, args.source, "source"))
			if c.custom:IsShown() then
				if type(args.text) ~= "string" or not args.text:match("%S") then W.fail("invalid_input", "the Custom source needs text") end
				c.custom:SetText(args.text)
			else
				if type(args.mod) ~= "string" then W.fail("invalid_input", "mod is required for this source") end
				c.modSelect:SetSel(choose(c.modSelect.list, args.mod, "modifier"))
			end
			c.save:Click()
		end)
		return describe(tab, save(tab), true)
	end)

	-- args: item, mods ([{ node (box 1 to 5), mod (text of its choice, "None" empties the box) }]). The Add Crucible mod... popup; boxes not named keep their choice.
	ops.crucible_mod = W.mutation(function(args, b)
		local tab = b.itemsTab
		open(tab, args.item)
		if not tab.controls.displayItemAddCrucible:IsShown() then W.fail("invalid_input", "this item takes no crucible modifiers (weapons and shields do)") end
		tab.controls.displayItemAddCrucible:Click()
		inPopup(function(c)
			for _, m in ipairs(args.mods or {}) do
				local drop = c["modSelectNode" .. tostring(m.node)]
				if not drop then W.fail("invalid_input", "no crucible node box " .. tostring(m.node)) end
				drop:SetSel(choose(drop.list, m.mod, "choice in node box " .. m.node))
			end
			c.save:Click()
		end)
		return describe(tab, save(tab), true)
	end)

	-- args: item (a crafted cluster jewel), skill? (the skill dropdown), nodes? (Added Passives slider, in its range),
	-- notables? ([text]: affix boxes 1 to n, as `craft` picks them). A change of skill resets the affix boxes, so it comes first.
	ops.cluster_jewel = W.mutation(function(args, b)
		local tab = b.itemsTab
		local item = open(tab, args.item)
		local c = tab.controls
		if not (item.crafted and item.clusterJewel) then W.fail("invalid_input", "this is not a crafted cluster jewel (craft one from a cluster jewel base)") end
		if args.skill ~= nil then
			local drop = c.displayItemClusterJewelSkill
			drop:SetSel(choose(drop.list, args.skill, "cluster jewel skill"))
		end
		if args.nodes ~= nil then
			local lo, hi = item.clusterJewel.minNodes, item.clusterJewel.maxNodes
			if args.nodes < lo or args.nodes > hi then W.fail("invalid_input", "this jewel adds " .. lo .. " to " .. hi .. " passives") end
			c.displayItemClusterJewelNodeCount:SetVal((args.nodes - lo) / (hi - lo))
		end
		for i, text in ipairs(args.notables or {}) do setAffix(tab, i, text) end
		return describe(tab, save(tab), true)
	end)

	-- args: item, slot. A slot dropdown's choice.
	ops.equip = W.mutation(function(args, b)
		local tab = b.itemsTab
		local item = itemOf(tab, args.item)
		local slot = slotOf(tab, args.slot)
		if not slot:IsShown() then W.fail("invalid_input", args.slot .. " is not in use (weapon set or socket not active)") end
		if not tab:IsItemValidForSlot(item, args.slot) then W.fail("invalid_input", "this item does not fit " .. args.slot) end
		for i, id in ipairs(slot.items) do
			if id == item.id then
				slot.selIndex = i
				slot.selFunc(i)
				return { slot = args.slot, item = slot.selItemId }
			end
		end
		W.fail("invalid_input", "this item cannot go in " .. args.slot)
	end)

	-- args: slot.
	ops.unequip = W.mutation(function(args, b)
		local tab = b.itemsTab
		local slot = slotOf(tab, args.slot)
		slot.selIndex = 1
		slot.selFunc(1)
		return { slot = args.slot }
	end)

	-- args: slot (a flask or tincture slot), active. The slot's activate box.
	ops.set_active = W.mutation(function(args, b)
		local slot = slotOf(b.itemsTab, args.slot)
		local box = slot.controls.activate
		if not box then W.fail("invalid_input", args.slot .. " has no activate box") end
		if not box:IsEnabled() then W.fail("invalid_input", "nothing is equipped in " .. args.slot) end
		box.state = args.active == true
		box.changeFunc(box.state)
		return { slot = args.slot, active = slot.active == true }
	end)

	-- args: item. The item list's Delete (confirmed when equipped).
	ops.delete = W.mutation(function(args, b)
		local tab = b.itemsTab
		itemOf(tab, args.item)
		local list = tab.controls.itemList
		list:OnSelDelete(nil, args.item)
		if main.popups[1] then W.clickPopup("confirm") end
		if tab.items[args.item] then W.fail("worker_error", "the item was not deleted") end
		return { deleted = args.item }
	end)

	-- args: set (1 or 2). The weapon swap buttons.
	ops.weapon_set = W.mutation(function(args, b)
		local tab = b.itemsTab
		if args.set ~= 1 and args.set ~= 2 then W.fail("invalid_input", "set is 1 or 2") end
		local want = args.set == 2
		if (tab.activeItemSet.useSecondWeaponSet == true) ~= want then
			tab.controls[want and "weaponSwap2" or "weaponSwap1"]:Click()
		end
		return { weaponSet = tab.activeItemSet.useSecondWeaponSet and 2 or 1 }
	end)

	-- Item sets: the manager's buttons (ItemSetListControl.lua) and the set dropdown (ItemsTab.lua:111).
	local function manage(b, button, index, title)
		b.itemsTab:OpenItemSetManagePopup()
		local manager = main.popups[1]
		local ok, err = pcall(W.listAction, manager.controls.setList, button, index, title)
		while main.popups[1] and main.popups[1] ~= manager do main:ClosePopup() end
		main:ClosePopup()
		if not ok then error(err, 0) end
	end
	ops.set_new = W.mutation(function(args, b)
		manage(b, "new", nil, args.title or "New item set")
		return { sets = sets(b.itemsTab) }
	end)
	ops.set_copy = W.mutation(function(args, b)
		local id = b.itemsTab.itemSetOrderList[args.index]
		manage(b, "copy", args.index, args.title or ((id and b.itemsTab.itemSets[id].title) or "Default") .. " copy")
		return { sets = sets(b.itemsTab) }
	end)
	ops.set_rename = W.mutation(function(args, b)
		manage(b, "rename", args.index, args.title)
		return { sets = sets(b.itemsTab) }
	end)
	ops.set_delete = W.mutation(function(args, b)
		manage(b, "delete", args.index)
		return { sets = sets(b.itemsTab) }
	end)
	ops.set_activate = W.mutation(function(args, b)
		local tab = b.itemsTab
		if not tab.itemSetOrderList[args.index] then W.fail("not_found", "no item set " .. tostring(args.index)) end
		tab.controls.setSelect.selFunc(args.index)
		return { sets = sets(tab) }
	end)

	return ops
end
