describe("TestNewUniques", function()
	before_each(function()
		newBuild()
	end)

	local function findSkill(name)
		for _, skill in ipairs(build.calcsTab.mainEnv.player.activeSkillList) do
			if skill.activeEffect.grantedEffect.name == name then
				return skill
			end
		end
	end

	local function hasSupport(skill, name)
		for _, effect in ipairs(skill.effectList) do
			if effect.grantedEffect.support and effect.grantedEffect.name == name then
				return true
			end
		end
		return false
	end

	it("Mantle of Dreams scales per socketed skill gem and turns off socketed supports", function()
		build.itemsTab:CreateDisplayItemFromRaw([[Mantle of Dreams
			Twilight Regalia
			Sockets: B-B-B
			Implicits: 0
			Socketed Gems deal 20% more damage per Socketed Skill Gem
			Socketed Support Gems have no effect
			Socketed Gems are Supported by Level 30 Unleash Support]])
		build.itemsTab:AddDisplayItem()
		build.skillsTab:PasteSocketGroup("Slot: Body Armour\nFireball 20/0  1\nArc 20/0  1\nAdded Lightning Damage 20/0  1\n")
		runCallback("OnFrame")

		local fireball = findSkill("Fireball")
		assert.is_truthy(fireball)
		-- Two skill gems socketed (the support does not count): 20% more twice
		assert.are.equals(1.4, fireball.skillModList:More(fireball.skillCfg, "Damage"))
		assert.is_false(hasSupport(fireball, "Added Lightning Damage"))
		assert.is_true(hasSupport(fireball, "Unleash"))
	end)

	it("socketed supports still apply in an item without the no-effect line", function()
		build.itemsTab:CreateDisplayItemFromRaw([[Test Armour
			Twilight Regalia
			Sockets: B-B-B
			Implicits: 0]])
		build.itemsTab:AddDisplayItem()
		build.skillsTab:PasteSocketGroup("Slot: Body Armour\nFireball 20/0  1\nAdded Lightning Damage 20/0  1\n")
		runCallback("OnFrame")

		assert.is_true(hasSupport(findSkill("Fireball"), "Added Lightning Damage"))
	end)

	it("Hide of the Vendigo lets claw attacks be used with an empty main hand", function()
		build.skillsTab:PasteSocketGroup("Double Strike 20/0  1\n")
		runCallback("OnFrame")
		assert.is_true(findSkill("Double Strike").skillFlags.disable)

		build.itemsTab:CreateDisplayItemFromRaw([[Hide of the Vendigo
			Exquisite Leather
			Implicits: 0
			200 to 300 Added Cold Damage with Unarmed Attacks
			20% increased Attack Speed if you've used an Attack Movement Skill Recently
			Can Attack as though using a Claw while main hand is empty]])
		build.itemsTab:AddDisplayItem()
		runCallback("OnFrame")
		local doubleStrike = findSkill("Double Strike")
		assert.is_falsy(doubleStrike.skillFlags.disable)
		assert.is_true(doubleStrike.skillFlags.weapon1Attack)
		assert.are.equals(ModFlag.Unarmed, bit.band(doubleStrike.weapon1Flags, ModFlag.Unarmed))
		assert.are.equals(0, bit.band(doubleStrike.weapon1Flags, ModFlag.Claw))

		local speedBefore = build.calcsTab.mainOutput.Speed
		build.configTab.input.conditionUsedMovementSkillRecently = true
		build.configTab:BuildModList()
		runCallback("OnFrame")
		assert.is_true(build.calcsTab.mainOutput.Speed > speedBefore)
	end)
end)
