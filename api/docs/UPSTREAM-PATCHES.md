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
- Not added: Putrid Seed. Its base, Mycelium Core, is not in Path of Building's base data, and its effect (grows four
  random passives when anointed) is not something Path of Building can simulate.

Which lines Path of Building turns into numbers (from its own parser; "not used" lines show red in the item and change
nothing):

| Item (base) | Used in calculations | Not used |
|---|---|---|
| Veil of Flesh (Callous Mask) | crit chance, Evasion and ES, maximum Life, skills cost Life instead of 100% of Mana | Bitterblood (both lines) |
| The Covetous Dark (Eye Gouger) | Life per enemy hit, physical damage (increased and added), Blind effect | Blind you inflict is permanent; the Pinnacle boss modifier steal |
| The Sword of Ages (Exquisite Blade) | crit multiplier, Movement gem levels, physical damage, attack speed, damage with Movement skills | Temporal Mirage trigger (no skill data for Temporal Mirage) |
| Mantle of Dreams (Twilight Regalia) | Energy Shield, level 30 Unleash support | 20% more damage per socketed skill gem; socketed supports have no effect |
| Ordered Fate (Walnut Spirit Shield) | spell damage, cast speed, maximum ES | every 2nd / 4th / 6th cast lines and their exclusion line |
| Corpse Rose (Imbued Wand) | spell damage, cast speed, skills cost Life instead of 50% of Mana | Goreblossom trigger and its Bloom count (no skill data for Goreblossom) |
| Bane of the Apostate (Judgement Staff) | block, fire damage, area of effect, skill effect duration | Witchhunter's Pyre grant (no skill data for Witchhunter's Pyre) |
| Hide of the Vendigo (Exquisite Leather) | spell suppression, Evasion, cold resistance, added cold damage with unarmed attacks | attack speed after an attack movement skill; attack as though using a claw while the main hand is empty |
| Unwilling Embrace (Bone Ring) | minion resistances, suppression, Dexterity, Evasion, minion damage | minions gain your suppression; minions have no Armour or ES |
| Dreadmaidens' Sacrament (Basalt Flask) | (flask lines are not player stats) | taunt, charges when hit, Life removed on use, Retaliation chance |
