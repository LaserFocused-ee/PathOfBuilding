# Patches to upstream files

Everything under `api/` reaches Path of Building through wrappers in `api/lua/`. A patch to an upstream file gets an
entry here: which file, what and why, its upstream status and how to drop it.

## Carried patches (fork only)

### 3.30 Covens uniques: `src/Data/Uniques/Special/New.lua`, `src/Data/ModCache.lua`, `src/Data/Bases/jewel.lua`, `src/Export/Bases/jewel.txt`

- What: the eleven uniques added in 3.30, in Path of Building's unique text format. Mod lines and ranges from the
  item pages on poedb.tw (read 15 Nov 2026), worded as the exported mods in `src/Data/ModItemExclusive.lua` where those
  exist; implicits as the base items carry them. `ModCache.lua` regenerated in upstream's test image (see "Regenerating
  ModCache" below); a separate commit first regenerates it for the 3.30 data already merged, so the uniques' own cache
  lines stand alone.
- Why: no upstream branch or pull request carries these items yet, so they cannot be simulated.
- Upstream status: not offered. Drop when upstream adds the 3.30 uniques (their lists then win).
- Wording checked against the game files' unique text (15 Nov 2026); Bane of the Apostate's "+2 to maximum
  Witchhunter's Pyres" was added from them. Bane's last two lines (the Witchhunter's Pyre grant and the +2 maximum
  Pyres) follow the game text, which words them differently from the item's public page; both are unparsed and
  unverified in game.
- Putrid Seed sits on a new jewel base, Mycelium Core (`Metadata/Items/Jewels/JewelBlighted`: tags jewel and
  not_for_sale, no implicit, no attribute requirement), added to the base export list and the generated base file. Its
  effect (grows four random passives when anointed) is not something Path of Building can simulate; the item is there
  so it can be equipped and imported.
- Not added: Broken Elegy, Lash of Retribution, Kitava's Hunger and Arohongui's Tending. The game files name them, but
  at old row numbers, with only an item class and no link to their mods; poedb.tw has no page for any of them (15 Nov
  2026), so there is no text to add and no sign they drop in 3.30.
- Checked, not changed: ten existing unique lines whose values no game mod carries (Hyperboreus, Martyr's Crown, Ngamahu
  Tiki, Replica Dragonfang's Flight, Thirst for Horrors twice, Timetwist, Vivinsect twice, Wall of Brambles). None is in
  the 3.30 patch notes' unique changes; most are no-longer-obtainable or variant lines, and the same-shaped game mods
  belong to other versions. Path of Building's values stay.

Which lines Path of Building turns into numbers (from its own parser; "not used" lines show red in the item and change
nothing):

| Item (base) | Used in calculations | Not used |
|---|---|---|
| Veil of Flesh (Callous Mask) | crit chance, Evasion and ES, maximum Life, skills cost Life instead of 100% of Mana | Bitterblood (both lines) |
| The Covetous Dark (Eye Gouger) | Life per enemy hit, physical damage (increased and added), Blind effect | Blind you inflict is permanent; the Pinnacle boss modifier steal |
| The Sword of Ages (Exquisite Blade) | crit multiplier, Movement gem levels, physical damage, attack speed, damage with Movement skills | Temporal Mirage trigger (no skill data for Temporal Mirage) |
| Mantle of Dreams (Twilight Regalia) | Energy Shield, level 30 Unleash support, 20% more damage per socketed skill gem (support gems not counted), socketed support gems have no effect | none |
| Ordered Fate (Walnut Spirit Shield) | spell damage, cast speed, maximum ES | every 2nd / 4th / 6th cast lines and their exclusion line |
| Corpse Rose (Imbued Wand) | spell damage, cast speed, skills cost Life instead of 50% of Mana | Goreblossom trigger and its Bloom count (no skill data for Goreblossom). The trigger line parses to an empty modifier list, so it shows as used but changes nothing |
| Bane of the Apostate (Judgement Staff) | block, fire damage, area of effect, skill effect duration | Witchhunter's Pyre grant and +2 maximum Pyres (no skill data for Witchhunter's Pyre) |
| Hide of the Vendigo (Exquisite Leather) | spell suppression, Evasion, cold resistance, added cold damage with unarmed attacks, attack speed after a movement skill (the "used a Movement Skill recently" setting; Path of Building has no separate attack-movement setting), claw-only attack skills usable with an empty main hand, "with Claws" modifiers on those attacks | none |
| Unwilling Embrace (Bone Ring) | minion resistances, suppression, Dexterity, Evasion, minion damage | minions gain your suppression; minions have no Armour or ES |
| Dreadmaidens' Sacrament (Basalt Flask) | (flask lines are not player stats) | taunt, charges when hit, Life removed on use, Retaliation chance |
| Putrid Seed (Mycelium Core) | none | both lines (passives grown when anointed) |

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
- Open reading, not changed: Hide of the Vendigo with Hollow Palm Technique disables every claw-only skill. Hollow Palm
  makes the off hand a virtual unarmed weapon (`CalcActiveSkill.lua` dual-wield check), and the claw allowance is set
  on the main hand only (`CalcSetup.lua`, after `weaponData1`). Whether the game allows claw skills in that case is
  unverified.
- Not a fault: Close Combat Support turns Double Strike off when unarmed, with or without Hollow Palm. The gem says
  "Supported Skills can only be used with Axes or Swords" (`weaponTypes` in its skill data).
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

### Stat description signs and formats: `src/Modules/StatDescriber.lua`

- What: `{:+d}` placeholders dropped their plus sign, and signed ranges were always printed with `%d`, so a range of
  values divided by one hundred came out as `+(0-0)`. Both placeholder forms now use the value's own format and keep
  the sign.
- Why: gem tooltips, the skills tab and generated trade text show these descriptions; found by the game-data builder
  comparing its own dump.
- Test: `spec/System/TestStatDescriber_spec.lua` (fails without the change).
- Upstream status: not offered.

### Open upstream pull requests merged ahead of upstream

Each was fetched read-only (`git fetch upstream pull/<n>/head`) and merged with its own commit, in the order below;
ModCache regenerated after each; the spec suite passes after each merge. Drop each when upstream merges it (the merge
then becomes a no-op). The first four were merged into `lf/3.30` (upstream `dev` at 2026-11-10 plus these) before
`api/` joined; the rest on `lf-src-fixes`.

| Pull request | Head merged | What | Conflicts and how they were resolved |
|---|---|---|---|
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10437 | e35aab933 | 3.30 data | none |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10454 | 5b08b6c63 | 3.30 data; granted effect stat descriptions | none |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10458 | e21ae0cd5 | 3.30 data | none |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10443 | 1deaeae21 | 3.30 flask modifiers | none |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10434 | b967f6192 | The Living Blade tincture count, Scales of Justice ailment condition | The unique text already read "2 additional Tinctures" from the merged 3.30 export; that version kept |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10419 | 26bfa22ac | Wickerman equipment slots | none |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10451 | 7f47b7f30 | Wickerman Viscera modifiers | Its Iron Flask effect block duplicates the one from 10443 already merged; applying both doubled Iron Flask effect, so this copy is dropped. Both PRs' new defence tests kept |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10455 | f66bc9eab | Wickerman item data, Viscera paste and character import (needs 10419 and 10451) | none |
| https://github.com/PathOfBuildingCommunity/PathOfBuilding/pull/10438 | 855d0f8d2 | 3.30 patch-note unique values, Steelworm projectile fix | The generated unique lists for five items carried the current 3.30 values without older variants; the PR's versioned lines taken (current values match) |

### Root files that differ from upstream

`AGENTS.md` and `.lf/SPEC.md` (the fork's own working notes) and `.gitignore` (adds the fork's local build output). None
is read by Path of Building.

## Regenerating ModCache

In upstream's test image, on a copy of the tree (the image mounts it read-only), from `src/`:

```sh
docker run --rm -v "$PWD":/workdir:ro -w /workdir ghcr.io/pathofbuildingcommunity/pathofbuilding-tests:latest sh -c '
  mkdir /tmp/w && tar --exclude=./api -cf - . | tar -xf - -C /tmp/w && cd /tmp/w/src &&
  LUA_PATH="../runtime/lua/?.lua;../runtime/lua/?/init.lua;;" REGENERATE_MOD_CACHE=1 luajit HeadlessWrapper.lua >&2 &&
  cat Data/ModCache.lua' > /tmp/ModCache.lua
```

Without that `LUA_PATH` the run stops with "module 'xml' not found"; with upstream's CI job settings it exits 0 and
leaves the file untouched. Proof it ran: the log (stderr) ends with "Rares loaded" and "Startup time"; then compare
`/tmp/ModCache.lua` with (or copy it over) `src/Data/ModCache.lua`. One cached line ("extra" text of a Flame/Flesh unique) depends on
table order, so commit the image's output, not a local run's.
