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

	local function describe(tab, item, full)
		local out = {
			id = item.id, name = W.strip(item.name or ""), title = item.title, baseName = item.baseName, rarity = item.rarity,
			type = item.type, quality = item.quality, sockets = item.sockets and #item.sockets > 0 and sockets(item) or nil,
			equipped = equippedIn(tab, item.id), corrupted = item.corrupted == true,
		}
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

	-- The item list in order, every slot with what it holds, item sets.
	function ops.list()
		local tab = W.build().itemsTab
		local items = {}
		for _, id in ipairs(tab.itemOrderList) do items[#items + 1] = describe(tab, tab.items[id]) end
		local slots = {}
		for _, slot in ipairs(tab.orderedSlots) do
			if not slot.nodeId and slot:IsShown() then
				local active
				if slot.controls.activate then active = slot.active == true end -- flask and tincture slots
				slots[#slots + 1] = { slot = slot.slotName, item = slot.selItemId ~= 0 and slot.selItemId or nil, active = active }
			end
		end
		return { items = items, slots = slots, sets = sets(tab), weaponSet = tab.activeItemSet.useSecondWeaponSet and 2 or 1 }
	end

	-- args: item. The item's text and parsed lines, variants, roll ranges and the slots it fits.
	function ops.get(args)
		local tab = W.build().itemsTab
		return describe(tab, itemOf(tab, args.item), true)
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
		tab:CreateDisplayItemFromRaw(raw, true)
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
	ops.craft = W.mutation(function(args, b)
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
			local drop = tab.controls["displayItemAffix" .. tostring(a.slot)]
			if not drop or not drop:IsShown() then W.fail("invalid_input", "no affix box " .. tostring(a.slot)) end
			local want, found, seen = tostring(a.mod):lower(), nil, {}
			for i, v in ipairs(drop.list) do
				local label = W.strip(v.label or ""):lower()
				if label == want then found = i; seen = nil break end
				if label:find(want, 1, true) then
					found = found or i
					seen[#seen + 1] = W.strip(v.label)
				end
			end
			if seen and #seen > 1 then W.fail("invalid_input", "more than one affix matches " .. tostring(a.mod) .. ": " .. table.concat(seen, " | ", 1, math.min(#seen, 6))) end
			if not found then W.fail("invalid_input", "affix box " .. a.slot .. " has no choice matching " .. tostring(a.mod)) end
			if drop.slider then drop.slider.val = a.roll or 1 end
			drop.selIndex = found
			drop.selFunc(found, drop.list[found])
		end
		return describe(tab, save(tab, args.equip), true)
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
