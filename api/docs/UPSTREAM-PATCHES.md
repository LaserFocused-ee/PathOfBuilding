# Patches to upstream files

Everything under `api/` reaches Path of Building through wrappers in `api/lua/`. A patch to an upstream file gets an
entry here: which file, what and why, its upstream status and how to drop it.

## Carried patches (fork only)

### 3.30 Covens uniques: `src/Data/Uniques/Special/New.lua`, `src/Data/ModCache.lua`

- What: ten of the eleven uniques added in 3.30, in Path of Building's unique text format. Mod lines and ranges from the
  item pages on poedb.tw (read 15 Nov 2026), worded as the exported mods in `src/Data/ModItemExclusive.lua` where those
  exist; implicits as the base items carry them. `ModCache.lua` regenerated the way upstream's check does it
  (`REGENERATE_MOD_CACHE=1 luajit HeadlessWrapper.lua` in `src/`); a separate commit first regenerates it for the
  3.30 data already merged, so the uniques' own cache lines stand alone.
- Why: no upstream branch or pull request carries these items yet, so they cannot be simulated.
- Upstream status: not offered. Drop when upstream adds the 3.30 uniques (their lists then win).
- Wording checked against the game files' unique text (15 Nov 2026); Bane of the Apostate's "+2 to maximum
  Witchhunter's Pyres" was added from them.
- Not added: Putrid Seed. Its base, Mycelium Core, is not in Path of Building's base data, and its effect (grows four
  random passives when anointed) is not something Path of Building can simulate.

Which lines Path of Building turns into numbers (from its own parser; "not used" lines show red in the item and change
nothing):

| Item (base) | Used in calculations | Not used |
|---|---|---|
| Veil of Flesh (Callous Mask) | crit chance, Evasion and ES, maximum Life, skills cost Life instead of 100% of Mana | Bitterblood (both lines) |
| The Covetous Dark (Eye Gouger) | Life per enemy hit, physical damage (increased and added), Blind effect | Blind you inflict is permanent; the Pinnacle boss modifier steal |
| The Sword of Ages (Exquisite Blade) | crit multiplier, Movement gem levels, physical damage, attack speed, damage with Movement skills | Temporal Mirage trigger (no skill data for Temporal Mirage) |
| Mantle of Dreams (Twilight Regalia) | Energy Shield, level 30 Unleash support, 20% more damage per socketed skill gem (support gems not counted), socketed support gems have no effect | none |
| Ordered Fate (Walnut Spirit Shield) | spell damage, cast speed, maximum ES | every 2nd / 4th / 6th cast lines and their exclusion line |
| Corpse Rose (Imbued Wand) | spell damage, cast speed, skills cost Life instead of 50% of Mana | Goreblossom trigger and its Bloom count (no skill data for Goreblossom) |
| Bane of the Apostate (Judgement Staff) | block, fire damage, area of effect, skill effect duration | Witchhunter's Pyre grant and +2 maximum Pyres (no skill data for Witchhunter's Pyre) |
| Hide of the Vendigo (Exquisite Leather) | spell suppression, Evasion, cold resistance, added cold damage with unarmed attacks, attack speed after a movement skill (the "used a Movement Skill recently" setting; Path of Building has no separate attack-movement setting), claw-only attack skills usable with an empty main hand, "with Claws" modifiers on those attacks | none |
| Unwilling Embrace (Bone Ring) | minion resistances, suppression, Dexterity, Evasion, minion damage | minions gain your suppression; minions have no Armour or ES |
| Dreadmaidens' Sacrament (Basalt Flask) | (flask lines are not player stats) | taunt, charges when hit, Life removed on use, Retaliation chance |

### Parser support for the 3.30 uniques: `src/Modules/ModParser.lua`, `src/Modules/CalcSetup.lua`, `src/Modules/CalcActiveSkill.lua`

- What: four lines from Mantle of Dreams and Hide of the Vendigo now count.
  - "Socketed Gems deal N% more damage per Socketed Skill Gem": a new `SocketedSkillGemsIn<slot>` multiplier, counted
    next to the existing socket-colour multipliers, skipping support gems.
  - "Socketed Support Gems have no effect": a `SocketedSupportGemsHaveNoEffect` flag on the slot; support gems
    socketed there are not added to any skill. Supports granted by the item ("Supported by Level 30 Unleash") still
    apply.
  - "if you've used an Attack Movement Skill Recently": reads the existing movement-skill-recently setting.
  - "Can Attack as though using a Claw while main hand is empty": with no main-hand weapon, skills that allow claws
    pass the weapon check, and the hit carries both the Claw and Unarmed flags.
- Readings chosen where the wording is open (each can be tested the other way by changing one line):
  - Mantle of Dreams counts each socketed gem without the support tag once, Vaal gems included, and only gems that fit
    the item's sockets. Supports granted by the item (Unleash) do not count.
  - The Mantle multiplier is a more-damage modifier on the socketed skills, so it applies to their hits and damage over
    time. It does not reach minions summoned by a socketed minion gem (their damage is calculated on the minion).
  - Hide of the Vendigo: "with Claws" modifiers (passives, gear) apply to these attacks, and "with Unarmed Attacks"
    ones too. "While wielding a Claw" conditions do not, as the main hand is empty. Base damage, speed and critical
    chance stay those of unarmed attacks.
- Why: these change damage numbers for builds made around the items. Other unparsed lines in the table above either
  need skill data Path of Building does not have or change no damage or defence number.
- Test: `spec/System/TestNewUniques_spec.lua` (fails without the change).
- Upstream status: not offered. Could be offered with the uniques.

### Spec suite fixes for the merged 3.30 data: `spec/System/TestTradeHelpers_spec.lua`, `src/Export/Uniques/jewel.lua`, `src/Data/Uniques/jewel.lua`

- What and why:
  - The regenerated 3.30 trade data no longer has the Bestial Snake option entry the option-matching test used; the
    test now uses a current option entry (Raised Zombies, `explicit.stat_56473917|6`).
  - That Which Was Taken lost its "Requires Level 48" line upstream in the unique export rework (https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10328),
    which left upstream's own rare-like pool test failing on `dev`. The line is back in the export source and the
    generated list; the item has no mods, so the export cannot derive the level.
- Upstream status: not offered. The jewel fix applies to upstream `dev` as is.


### Account-name import status line: `src/Classes/ImportTab.lua`

- What: the account-name path keeps the status returned by `ImportPassiveTreeAndJewels` and `ImportItemsAndSkills`
  (two lines in `DownloadPassiveTree` and `DownloadItems`). The OAuth path's two calls are left as they are: its status
  line shows the sign-in state and never reads `charImportStatus`.
- Why: after a successful import the status line stayed on "Retrieving character ..."; the bug is on upstream `dev`
  too.
- Test: `spec/System/TestImport_spec.lua`, "shows the import result after an account-name import" (fails without the
  change).
- Upstream status: not offered.

### Triple damage chance terms: `src/Modules/CalcOffence.lua`

- What: `Sum(...) or 0 + (enemy term) + (on-crit term)` parsed as `Sum(...) or (0 + ...)`, so the enemy
  `SelfTripleDamageChance` and the `TripleDamageChanceOnCrit` terms were always dropped. Now written like the double
  damage line below it.
- Why: correctness. No item, passive or skill produces either stat today, so no current result changes.
- Test: `spec/System/TestAttacks_spec.lua`, "adds triple damage chance on crit to triple damage chance" (feeds the stat
  through a cached custom modifier line; fails without the change).
- Upstream status: not offered.

### Open upstream pull requests merged ahead of upstream

Each was fetched read-only and merged with its own commit; ModCache regenerated after each; the spec suite passes after
each merge. Drop each when upstream merges it (the merge then becomes a no-op).

| Pull request | What | Conflicts and how they were resolved |
|---|---|---|
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10434 | The Living Blade tincture count, Scales of Justice ailment condition | The unique text already read "2 additional Tinctures" from the merged 3.30 export; that version kept |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10419 | Wickerman equipment slots | none |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10451 | Wickerman Viscera modifiers | Its Iron Flask effect block duplicates the one from 10443 already merged; applying both doubled Iron Flask effect, so this copy is dropped. Both PRs' new defence tests kept |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10455 | Wickerman item data, Viscera paste and character import (needs 10419 and 10451) | none |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10438 | 3.30 patch-note unique values, Steelworm projectile fix | The generated unique lists for five items carried the current 3.30 values without older variants; the PR's versioned lines taken (current values match) |
