describe("TestAttacks", function()
	before_each(function()
		newBuild()
	end)

	teardown(function()
		-- newBuild() takes care of resetting everything in setup()
	end)

	it("creates an item and has the correct crit chance", function()
		assert.are.equals(build.calcsTab.mainOutput.CritChance, 0)
		build.itemsTab:CreateDisplayItemFromRaw("New Item\nMaraketh Bow\nCrafted: true\nPrefix: None\nPrefix: None\nPrefix: None\nSuffix: None\nSuffix: None\nSuffix: None\nQuality: 20\nSockets: G-G-G-G-G-G\nLevelReq: 71\nImplicits: 1\n{tags:speed}10% increased Movement Speed")
		build.itemsTab:AddDisplayItem()
		runCallback("OnFrame")
		assert.are.equals(build.calcsTab.mainOutput.CritChance, 5.5 * build.calcsTab.mainOutput.HitChance / 100)
	end)

	it("adds triple damage chance on crit to triple damage chance", function()
		-- No item or passive grants this stat yet, so feed it through a cached custom modifier line.
		local line = "Test: 50% chance to deal Triple Damage on Critical Strike"
		modLib.parseModCache[line] = { { modLib.createMod("TripleDamageChanceOnCrit", "BASE", 50, "Test") } }
		build.configTab.input.customMods = "+50% to Critical Strike Chance\n" .. line
		build.configTab:BuildModList()
		runCallback("OnFrame")
		modLib.parseModCache[line] = nil

		-- Per-hand attack values live under MainHand
		local output = build.calcsTab.mainOutput.MainHand
		assert.is_true(output.CritChance > 0)
		assert.are.equals(50, output.TripleDamageChanceOnCrit)
		assert.are.equals(50 * output.CritChance / 100, output.TripleDamageChance)
	end)

	it("creates an item and has the correct crit multi", function()
		assert.are.equals(1.5, build.calcsTab.mainOutput.CritMultiplier)
		build.itemsTab:CreateDisplayItemFromRaw("New Item\nAssassin Bow\nCrafted: true\nPrefix: None\nPrefix: None\nPrefix: None\nSuffix: None\nSuffix: None\nSuffix: None\nQuality: 20\nSockets: G-G-G-G-G-G\nLevelReq: 62\nImplicits: 1\n{tags:damage,critical}{range:0.5}+(15-25)% to Global Critical Strike Multiplier")
		build.itemsTab:AddDisplayItem()
		runCallback("OnFrame")
		assert.are.equals(1.5 + 0.2, build.calcsTab.mainOutput.CritMultiplier)
	end)

	it("correctly converts spell damage per stat to attack damage", function()
		assert.are.equals(0, build.calcsTab.mainEnv.player.modDB:Sum("INC", { flags = ModFlag.Attack }, "Damage"))
		build.itemsTab:CreateDisplayItemFromRaw([[
		New Item
		Coral Amulet
		10% increased attack damage
		10% increased spell damage
		1% increased spell damage per 10 intelligence
		]])
		build.itemsTab:AddDisplayItem()
		runCallback("OnFrame")
		assert.are.equals(10, build.calcsTab.mainEnv.player.modDB:Sum("INC", { flags = ModFlag.Attack }, "Damage"))
		-- Scion starts with 20 Intelligence
		assert.are.equals(12, build.calcsTab.mainEnv.player.modDB:Sum("INC", { flags = ModFlag.Spell }, "Damage"))

		build.itemsTab:CreateDisplayItemFromRaw([[
		New Item
		Coral Ring
		increases and reductions to spell damage also apply to attacks
		]])
		build.itemsTab:AddDisplayItem()
		runCallback("OnFrame")
		assert.are.equals(22, build.calcsTab.mainEnv.player.mainSkill.skillModList:Sum("INC", { flags = ModFlag.Attack }, "Damage"))

	end)
end)