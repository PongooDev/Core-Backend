# Extractor

Maintainer tool. Reads a build's paks with [CUE4Parse](https://github.com/FabianFG/CUE4Parse) and writes the shared
game data in `gamedata/`, which is committed so users never run this.

```
dotnet run -c Release --project tools/extractor -- "<build folder with FortniteGame and Engine>" <aes key>
```

The engine version and changelist come from the build's `Engine/Build/Build.version`. A build that ships without one
(1.10, CL 3790078) takes them as a fourth argument, after the output folder, in its User-Agent's form:
`4.19.0-3790078+++Fortnite+Release-Cert`. UE 4.16, 4.19, 4.20 (2.5, CL 3889387, the first 4.20 build) and 4.21 (5.0, CL 4214610, the
first 4.21 build; 5.10, CL 4240749; 5.21, CL 4288479; 5.30, CL 4305896) are mapped. 4.19 writes soft references with their
object name (`/Game/Path/Asset.Asset`); zone themes' tile classes and mission generators' primary missions are kept as
packages, as 4.16 writes them, so overlays only hold the builds' own differences.

- `quests.json`: every quest's type, objectives, rewards and prerequisites. 5.0 (CL 4214610) moves Save the World's quest
  rewards out of the quests into the table their `RewardsTable` names (`Quests/QuestRewards`, FortQuestRewardTableRow rows
  by QuestTemplateId: Hidden rows are hidden rewards, each Selectable row a choice of its own), which the extractor reads
  back into `rewards`, `hiddenRewards` and `selectableRewards`; a quest done by some of its objectives carries
  `objectiveCompletionCount` (5.0's HordeQuest_Hidden_0-7). 5.0's first overlay predates this and had no quest rewards
  (Core-Backend #298); earlier builds name no RewardsTable.
- `items.json`: every item definition's class, the profile it lives in (`profile` for account items, `theater` for
  world items; from 1.7.2, CL 3700114, `metadata` for storm shields and deployable bases; 3.0's Hoverboard, a FortPersonalVehicleItemDefinition, is an account item) and its stack limit (the asset's `MaxStackSize`, else the class constructor's default). World items of
  weapon definitions (weapons, traps, building pieces) that have durability (`bItemHasDurability`, unless the asset
  turns it off) carry `maxDurability`, the MCP template's static_max_durability: GetMaxDurability at level 0, from the
  definition's `WeaponStatHandle` row (`BaseLevel`, `DurabilityScale`) and its `WeaponDurabilityRarity` row
  (`DurabilityRowName`) at the item's rarity; 1 when either row is missing.
  World items the game never saves to a profile (`bNeverPersisted` on the asset, else the class constructor's: set for
  `FortNeverPersistItemDefinition`, backpacks and emotes) carry `neverPersisted: true`. Items that count toward the
  account vault or backpack limit (`bInventorySizeLimited` on the asset, else the class constructor's) carry
  `inventorySizeLimited: true`.
  World items with a `DisassembleRecipe` (what the backpack's recycle, 1.11's DisassembleWorldItems, gives back) carry
  its row (`disassembleRecipe`) and `disassembleLootPercent`, [DisassembleDurabilityDegradeMinLootPercent,
  DisassembleDurabilityDegradeMaxLootPercent] (the constructor's 0.2 and 0.8 when unset); `upgrades.json` holds those
  rows' results as `disassembleRecipes`.
  Schematics with a `CraftingRecipe` row (CraftingRecipes_New: what the backpack's Craft, 1.11's CraftWorldItem, costs
  and makes) carry it as `craftingRecipe`; `upgrades.json` holds those rows (costs, results, catalysts) as
  `craftingRecipes`. Account items with an `UpgradeRarityRecipeHandle` (from 1.10: the MetaRecipes row Flux's
  UpgradeItemRarity uses) carry it as `rarityUpgrade`. Only 2.1's and later overlays have these so far (Cert's
  committed files, 1.10's and 1.11's overlays predate them).
  Badges carry their MCP template's static_cardpack_reward (`cardPackReward`, BadgeCardPackReward) and
  static_item_rewards (`itemRewards`, ItemRewards {templateId, quantity}).
  Item caches (4.0's `FortItemCacheItemDefinition`, world items) carry the card pack they open into (`cardPackReward`,
  CardPackReward).

Item template ids are resolved with the build's own asset manager rules (`PrimaryAssetTypesToScan` in
`DefaultGame.ini`): an asset gets the type of the rule whose directory holds it and whose base class it derives from.
- `dailyrewards.json`: the daily login reward schedules from `DefaultGameData` (from 1.7.2, the
  `DailyRewardScheduleDefinitions` asset it points to), rows in lookup order.
- `homebasenodes.json`, `squads.json`: the skill tree (nodes, pages) and squads from the homebase manager.
- `banners.json`: the banner icon and color rows by category, from the homebase manager's HomebaseBannerIconData and
  HomebaseBannerColorData; 2.4.2 (CL 3870737) moved them to DefaultGameData (BannerIconData, BannerColorData).
- `characters.json`: gameplay tags, required tags and manager flags of heroes, survivors and defenders.
- `cardpacks.json`: each card pack's loot tier group, tier, choice flag and display level.
- `objectivestats.json`: the quest objective stat table (type, target tags, condition, and source and context tags
  when a row has them).
- `fabricator.json`: the storm shield fabricator's numbers (OutpostData's FabricatorBuildingData) and each world item's
  quantum goo values (the MCP template's static_disintegration_value and static_fabrication_value).
- `world.json`: zone themes (tile class, valid difficulties), mission generators, their primary missions' MissionTags,
  the mission difficulty rows, the mission alert rows (with their spread rows), from 1.7.2 the alert categories
  (MissionAlertCategories: enum, from 2.2, CL 3841827, the row's CategoryRowName; quota, repeatable) and storm spreads (MissionAlertSpreadDatas), every quest's object path and, when the build defines any, its `Theater.*` gameplay tags
  (`Balance/GameplayTags`; 1.7.2's `Theater.MainProgression`).
- `collectionbook.json`: the collection book's pages (book profile, sections, rewards), sections (slots, rewards),
  slots (allowed item templates, survivor personalities, XP weight row), the slot XP weights, the rarity factor curve
  and the book levels (total XP, rewards). From 4.5 (CL 4159770) also each slot's `purchase` (its PurchaseCosts row),
  `recipes` (those CollectionBookRecipes rows: costs, catalysts; what researching or recruiting the slot's item costs)
  and `unslotCost` (CollectionBookData's UnslotCost, 20 V-Bucks); earlier builds have none of them.
- `inventory.json`: what each skill tree node and account buff adds to the item limits (FortHomebaseSet
  `InventorySizeBonus` for the account vault, `WorldInventorySizeBonus` for the backpack, `StorageInventorySizeBonus`).
- `athena.json`: Battle Royale's, from 1.8 (CL 3724489; empty for earlier builds): its cosmetics (`Athena/Items/Cosmetics`
  without the test characters: class, display name, rarity; an outfit whose hero's specializations wear a back bling built
  in has `backpackParts`, those parts' names, and a back bling its own CharacterParts as `parts`, the link 3.0 (CL 3901517)
  broke when it made 2.5's built-in back blings items of their own; 3.0's contrails, AthenaSkyDiveContrailItemDefinition, are
  cosmetics too), the item shop's display assets (`Catalog/DisplayAssets`
  FortMtxOfferData with Battle Royale tile art or, for the emotes, their locker icon, by the cosmetic each shows, matched by name: see `Program.cs`), its quests (`Athena/Items/Quests`, as in `quests.json` plus
  their category and weight), the season levels (AthenaGameData's `SeasonXpLevelsTable`) and the objective stat rows those
  quests count. From 1.11 (CL 3807424, Season 2) AthenaGameData names no season levels table; the levels are the newest
  season's (`Athena/Items/Seasons/AthenaSeason<n>`'s SeasonXpCurve), and `season` holds that season's Battle Pass: its
  number, level and tier counts, storefront, the tiers' Battle Stars (BookXpCurve) and the rewards of each season level
  (SeasonXpScheduleFree) and tier (BookXpScheduleFree, BookXpSchedulePaid) as template ids. A season that names an
  earlier season's curves is passed over: 2.5 (CL 3889387, still Season 2) ships AthenaSeason3 ahead of Season 3, with
  AthenaSeason2's Athena_Season2_XP and _BP and a copy of its schedules; 3.0 (CL 3901517) ships the real one, with
  Athena_Season3_XP and _BP, which is its season. From 3.0 the season also names its challenges, and `season` adds them
  when it does: `challengeSchedulesAlwaysShown` (Season3_Challenge_Schedule, the Battle Pass's weekly challenges),
  `challengeSchedulePaid` when set (unset in 3.0), `firstWinRewards` (SeasonFirstWinRewards: the Paper Parasol) and
  `battlePassLevelOfferId`. `challengeSchedules` (UFortChallengeBundleScheduleDefinition: its CategoryID and bundles, each
  with its UnlockType and UnlockValue) and `challengeBundles` (UFortChallengeBundleItemDefinition: its quests and whether
  each comes with the bundle, CompletionThreshold, CompletionRewards and VisualStyle) hold the schedules the season
  grants, by its tiers' rewards (ChallengeBundleSchedule:season3_tier_2_schedule, _tier_100_) or by name, and their
  bundles. Those bundles' quests (AthenaChallengeBundleQuest) carry `objectiveCompletionCount` when only some of their
  objectives are needed (ObjectiveCompletionCount: 10 of Quest_BR_Land_Locations_Different's 18), and their objectives'
  stat rows are 3.0's own Athena/Items/Quests/AthenaObjectiveStatTable's where ObjectiveStatTable has none. A fresh 2.5
  extraction still matches the committed one file for file. 1.11's emoticons
  (AthenaEmojiItemDefinition) are cosmetics too. `loot` holds Battle Royale's loot tables whole (DefaultGameData's
  `AthenaLootTierData_Client` and `AthenaLootPackages_Client`), by object path, each row with every property in the form
  `UDataTable::CreateTableFromJSONString` reads back (soft object paths as path strings), for the content updates the
  backend serves as `[AssetHotfix]` rows; only 1.11's, 2.1's, 2.2's, 2.3's, 2.4's, 2.4.2's, 2.5's, 3.0's, 3.1's, 3.2's, 3.3's and 3.5.1's overlays carry it so far (2.2's has Season 2's content updates in already; 2.3's
  is 2.2's, the Chug Jug at weight 0; 2.4's has the Chug Jug in and the Minigun at weight 0; 2.4.2's has the Minigun in, in
  a list of its own, and the Suppressed Pistol's cut, but no Crossbow; 2.5's has the Crossbow in a list of its own and its
  notes' Impulse Grenade, vaulted SMG and Medium-ammo Revolver; 3.0's has the Hand Cannon in, Loot_AthenaFloorLoot_11 at
  0.07 and Loot_AthenaTreasure_07 at 0.08, and its notes' pistol changes; 3.1's has its notes' Hunting Rifle,
  WID_Sniper_NoScope_Athena_UC/R_Ore_T03, and drop rate changes in). `shootingModel` holds the weapon stats table Shooting
  Test #1 plays (PlayerPawn_Athena's PrototypeShootingModelPerfectAimWhenTargetingMinSpread, AthenaRangedWeapons_ShootingModel3)
  for the builds that have one, `{table, rows}` in the same import form, object references as their object path and none
  as `"None"`; only 2.4.2's, 2.5's, 3.0's and 3.1's overlays carry it, for the hotfixes that bring 2.4's and 2.4.2's tables to the next
  build's (`src/events/shootingtest.js`). 2.4 ships no
  `Build.version` either: its fourth argument is `4.19.0-3858292+++Fortnite+Release-Cert`, and 2.4.2's
  `4.19.0-3870737+++Fortnite+Release-Next`, and 2.5's `4.20.0-3889387+++Fortnite+Release-2.5`, and 3.0's
  `4.20.0-3901517+++Fortnite+Release-3.0.0`, and 3.1's `4.20.0-3915963+++Fortnite+Release-3.1` (3.1 needed no extractor
  change), and 3.2's `4.20.0-3935073+++Fortnite+Release-3.2` (its only extractor change: the Athena cosmetic `Dev_TestAsset`
  test character is left out like 00_TestAssets; the extraction finds no shooting model in 3.2's PlayerPawn_Athena, so its overlay has
  no `shootingModel`), and 3.3's `4.20.0-3942182+++Fortnite+Release-3.3` (no extractor change; its build folder has no
  `Build.version` either), and 3.5.1's `4.20.0-4000805+++Fortnite+Release-3.5` (its only extractor change: its test gliders,
  DynamicsTestGlider, Glider_ProxyTest and Glider_TestStaticParts, and the debug harvesting tool Pickaxe_ID_zzz_StatDebugger are
  left out like the test characters; its locker's Random entries, CID_Random and the rest, are kept), and 3.5.2's `4.20.0-4008490+++Fortnite+Release-3.5` (no extractor change: its extraction is
  3.5.1's byte for byte, so it has no overlay of its own and plays on `gamedata/4000805`), and 3.6's
  `4.20.0-4019403+++Fortnite+Release-3.6` (two extractor changes: its debug harvesting tool, renamed
  Dev_Test_Pickaxe_StatDebugger, is left out as 3.5's; and its client paks no longer ship most mission infos (48 of the 57
  FortMissionInfo assets its generators name: Gate_Single, DeadDrop, the Survivals... are cooked server-only), so a fifth
  argument, an earlier build's extraction folder (3.5.1's full data: Cert's files with `gamedata/4000805` applied), gives
  `world.json` those missions' tags; the extractor prints how many it took), and 4.0's `4.20.0-4039451+++Fortnite+Release-4.0`
  (a full install with Save the World's paks: every mission info its generators name is in them, so it takes no fifth
  argument; its world.json has 3.6's primary missions' tags exactly, and four more. Three extractor changes: its sprays,
  `AthenaSprayItemDefinition` (`AthenaDance:SPID_*`), are cosmetics; a cosmetic's styles (`ItemVariants`, the package's
  FortCosmetic*Variant exports) are written as `variants`, `[{channel, options, default, unlocked}]` by the tags' last
  part, and its variant tokens (`Athena/Items/CosmeticVariantTokens`, FortVariantTokenType: Carbide's and Omega's
  stages) as `variantTokens`, `{templateId: {cosmetic, channel, variant, giftBox}}`; and its test harvesting tool
  (`Dev_Test_Pickaxe`) and test spray (`SPID_000_TestSpray`) are left out), and 4.1's `4.20.0-4053532+++Fortnite+Release-4.1` with 4.0's full data (Cert's files with `gamedata/4039451`
  applied) as the fifth argument: its DefaultGameData names no `MissionAlerts` or `MissionAlertSpreadDatas` (cooked
  server-only, as 3.6's mission infos), so `world.json`'s `missionAlerts` and `missionAlertSpreads` are the earlier build's,
  whole, and the extractor prints how many it took; without a fifth argument it stops. 4.2's is `4.20.0-4072250+++Fortnite+Release-4.2` with 4.1's full data (Cert's files with
  `gamedata/4053532` applied) as the fifth argument, for the same reason (no extractor change). 4.4.2's is `4.20.0-4132537+++Fortnite+Release-4.4.x` with
  4.2's full data (Cert's files with `gamedata/4072250` applied) as the fifth argument, for the same reason, and the main key
  that FModel's settings already hold for it (its six paks, a Battle Royale only archive: pakchunk0,
  its four splits and pakchunk1; Save the World's data is still in pakchunk0). One extractor change: its MetaRecipes name
  15 item definitions whose packages aren't in those paks ("None"), which are no item. 4.4.0 (CL-4117433) and 4.4.1
  (CL-4127312) aren't extracted (Core has no copy of their paks) and play on 4.4.2's data (`src/gamedata/read.js`). 4.5's
  (CL-4166199) is `4.20.0-4166199+++Fortnite+Release-4.5` with 4.4.2's full data (Cert's files with `gamedata/4132537`
  applied) as the fifth argument, for the same reason, and the main key FModel's settings hold for its build folder (its
  six paks, a Battle Royale only archive like 4.4.2's); no extractor change. The earlier 4.5, CL-4159770, isn't extracted
  (Core has no copy of its paks) and plays on CL-4166199's data. 5.0's (CL-4214610, UE 4.21, Season 5) is
  `4.21.0-4214610+++Fortnite+Release-5.0` (the exe's own build string is ++Fortnite+Release-5.0-CL-4214610; the folder has
  no `Build.version`) with 4.5's full data (Cert's files with `gamedata/4166199` applied) as the fifth argument, for the
  same reason, and the main key FModel's settings hold for its build folder (its six paks, a Battle Royale only archive).
  Four extractor changes: UE 4.21 is mapped (`GAME_UE4_21`); its toys (`AthenaToyItemDefinition`, `AthenaDance:TOY_*`) are
  cosmetics, its test toy (`TOY_000_TestToy`) left out; its challenge bundles replace a quest's `bGrantWithBundle`
  with `QuestUnlockType` (GrantWithBundle, or RequiresBattlePass: the Battle Pass half of each week, written as
  `grantWithBundle` with `requiresBattlePass`) and CompletionThreshold/CompletionRewards with steps,
  `BundleCompletionRewards` [{CompletionCount, Rewards}], written as `completionSteps` [{count, rewards}] (count -1: every
  quest; a NonExportedFakeReward, the Road Trip bundle's Mystery Item, is only shown and left out); and AthenaSeason5 names
  what it gives every player (`SeasonGrantsToEveryone`: Season5_Free_Schedule, written as `season.grantsToEveryone`) and
  what goes at its end (`TokensToRemoveAtSeasonEnd`, written as `season.removedAtSeasonEnd`). Earlier builds' bundles have
  neither bundle property and their seasons no SeasonGrantsToEveryone; AthenaSeason4 already names
  TokensToRemoveAtSeasonEnd (its schedules), so a fresh 4.x extraction adds `removedAtSeasonEnd` to the committed 4.x
  overlays, which predate it (the schedules it names are the ones its tier rewards give, so nothing reads it differently). The earlier 5.0, CL-4204761, isn't extracted (Core has
  no copy of its paks) and plays on CL-4214610's data. 5.10's (CL-4240749, UE 4.21, Content Update v5.10's build) is
  `4.21.0-4240749+++Fortnite+Release-5.10` (the exe's own build string is ++Fortnite+Release-5.10-CL-4240749; no
  `Build.version`) with 5.0's full data (Cert's files with `gamedata/4214610` applied) as the fifth argument, for the same
  reason, and the main key FModel's settings hold for its build folder (its eight paks, a Battle Royale only archive). One
  extractor change: a challenge schedule naming the event flag it runs with (`EventName`: 5.10's Schedule_Birthday2018_BR,
  EventFlag.Anniversary2018_BR, which no tier gives) carries it as `eventName`, and such event schedules are written with
  the season's, with their bundles. Earlier builds' committed overlays have none. The earlier 5.10, CL-4225813, isn't
  extracted (Core has no copy of its paks; Core-ServerAssets' pak for it is CL-4240749's, byte for byte) and plays on
  CL-4240749's data. 5.21's (CL-4288479, UE 4.21, Update v5.21's build; Core has no 5.20) is
  `4.21.0-4288479+++Fortnite+Release-5.21` (no `Build.version`) with 5.10's full data (Cert's files with
  `gamedata/4240749` applied) as the fifth argument, for the same reason, and the main key FModel's settings hold for its
  build folder (no extractor change). Its install is a full one (Save the World with it); its two small
  `pakchunk0_94AB24604D6F33B1BDF1B4911CABA3FC` paks are encrypted with a key of their own and aren't read. 5.30's
  (CL-4305896, UE 4.21, Update v5.30's build) is `4.21.0-4305896+++Fortnite+Release-5.30` (no `Build.version`) with
  5.21's full data (Cert's files with `gamedata/4288479` applied) as the fifth argument, for the same reason, and the main
  key FModel's settings hold for its build folder (a full install, its seven paks all on that key). One extractor change:
  its FItemAndCount rows (the skill tree's costs, CCNodes; crafting recipes) name their item by `ItemPrimaryAssetId`
  ({PrimaryAssetType, PrimaryAssetName}: Token:HomebasePoints) instead of `ItemDefinition`, which is written as the template
  id the definition would give (`Token:homebasepoints`), and some name neither ("None", no item); its skill tree comes out
  as 5.21's exactly. 5.40's (CL-4352937, UE 4.21, Update v5.40's build; its paks carry Content Update v5.40's and Update
  v5.41's items too) is `4.21.0-4352937+++Fortnite+Release-5.40` (no `Build.version`; the build folder is
  `5.40-CL-4352937\Fortnite`) with 5.30's full data (Cert's files with `gamedata/4305896` applied) as the fifth argument, and
  the main key FModel's settings hold for its build folder (no extractor change). Its install has Save the World, but only
  one of the 57 mission infos its generators name (56 come from the fifth argument) and no MissionAlerts (24 alerts and 4
  storm spreads from it); its `pakchunk1000` is on a key of its own and isn't read. 5.41's (CL-4363240, UE 4.21, Update
  v5.41's build) is `4.21.0-4363240+++Fortnite+Release-5.41` (no `Build.version`; the build folder is
  `5.41-CL-4363240\Fortnite`) with 5.40's full data (Cert's files with `gamedata/4352937` applied) as the fifth argument, and
  the main key FModel's settings hold for its build folder (no extractor change). Its install is a full one: all 57 mission
  infos its generators name are in its paks (the weekly Horde ones now tagged Stat.Mission.Weekly.Horde.WeekA to WeekC), but
  its DefaultGameData still names no MissionAlerts (24 alerts and 4 storm spreads from the fifth argument); its
  `pakchunk1000` is on a key of its own and isn't read. Against 5.40 it adds 7 cosmetics (Valkyrie, Valkyrie Wings and
  Frostwing, Nite Nite, Balloon Llama and Battle Balloon, and Grill Sergeant, which 5.40's readable paks lack), their
  heroes, Battle Royale's loot tables and Season 5's cumulative quests in `season.removedAtSeasonEnd`. 6.00's (CL-4402180,
  UE 4.21, Update v6.00's build, Season 6) is `4.21.0-4402180+++Fortnite+Release-6.00` (no `Build.version`; the build folder
  is `6.00-CL-4402180\Fortnite`) with 5.41's full data (Cert's files with `gamedata/4363240` applied) as the fifth argument,
  and the main key FModel's settings hold for its build folder. A full install: every mission info is in its paks, its
  DefaultGameData still names no MissionAlerts (24 alerts and 4 storm spreads from the fifth argument); its `pakchunk1000`
  and `pakchunk1001` are on keys of their own and aren't read. One extractor change: its pets
  (`AthenaPetCarrierItemDefinition`, a UAthenaBackpackItemDefinition: `AthenaBackpack:PetCarrier_001_Dog` "Bonesy",
  `_002_Chameleon` "Camo", `_003_Dragon` "Scales") and its lobby music (`AthenaMusicPackItemDefinition`,
  `AthenaMusicPack:MusicPack_*`) are cosmetics. AthenaSeason6 has its own Battle Pass (BRSeason6, Season6_Free_Schedule's
  ten weeks, the Hunting Party's Season6_Paid_Schedule, Calamity's and Dire's progressive schedules) on Season 5's level
  and tier curves. Against 5.41 it adds 109 cosmetics (the Season 6 Battle Pass, Airheart, Ludwig and Heidi, Peekaboo, the
  Fortnitemares outfits Epic sold in October...) and drops four (BBID_PurpleBus, BBID_Random, Emoji_Birthday2018, and
  Glider_ID_TBD_ModernMilitaryRed, now Glider_ID_075 "Rotor"); Save the World adds Cram Session's AutumnQuest lines, the
  repeatable Mini-Boss quest, the Ratatat and Lead Sled. 6.01's (CL-4424678, UE 4.21, Update v6.01's build) is
  `4.21.0-4424678+++Fortnite+Release-6.01` (no `Build.version`; the build folder is `6.01-CL-4424678\Fortnite`) with 6.00's
  full data (Cert's files with `gamedata/4402180` applied) as the fifth argument, and the main key FModel's settings hold
  for its build folder (6.00's; no extractor change). A full install: every mission info is in its paks, its
  DefaultGameData still names no MissionAlerts (24 alerts and 4 storm spreads from the fifth argument); its `pakchunk1000`
  and `pakchunk1001` (Dark Bomber and her Dark Bag, each on a key of its own) aren't read. Against 6.00 only four files
  change: `athena.json` (11 cosmetics added: Maximilian and Para-Provisions, which 6.00 kept in its own two keyed paks, Hay
  Man, Straw Ops, Hay Nest, Birdhovel, Field Wraith, Harvester, T-Pose, Dark Glyph and Thunder Crash; the Birthday Bus
  dropped with the three Birthday quests and their ten cake stats; the later stages of two staged Season 6 challenges,
  Quest_BR_Land_Chain_02B to _02E and Quest_BR_Dance_ScavengerHunt_Locations_Chain_01B and _01C, and Quest_BR_Shoot_Target;
  and the loot tables, with the Chiller, TID_Context_Freeze_Athena, in), `characters.json` (the three new outfits' heroes),
  `items.json` (those heroes, two harvesting tools and the Creative Control Panel trap in; 28 items out: Battle Royale's
  Drum Gun, Revolver, Tactical and Suppressed Submachine Guns, Crossbow with its bolts and Explosive Crossbow, Quad
  Launcher, Balloons, falling ceiling trap and six decos named "Air Strike", and two gameplay modifiers; the Freeze
  Trap's floor, wall and ceiling items, which the Chiller places, lose trap.hostile, the Cozy Campfire, Launch Pad and
  Port-a-Fortress gain a tier, the notes' "star ratings to the UI elements of all trap items", and the Shadow Stone goes
  from Uncommon to Epic) and `fabricator.json` (those items' values). Save the World's quests, world and every other file
  are 6.00's. The earlier 6.01, CL-4417689, isn't extracted (Core has no copy of its paks) and plays on CL-4424678's data.
  6.02's (CL-4461277, UE 4.21, Update v6.02's later build) is `4.21.0-4461277+++Fortnite+Release-6.02` (no `Build.version`;
  the build folder is `6.02-CL-4461277\Fortnite`) with 6.01's full data (Cert's files with `gamedata/4424678` applied) as
  the fifth argument, and the main key FModel's settings hold for its build folder (6.01's). A full install: every mission
  info is in its paks, its DefaultGameData still names no MissionAlerts (24 alerts and 4 storm spreads from the fifth
  argument); its `pakchunk1000` is on a key of its own that neither FModel's settings nor the published keychain has, and
  isn't read (13 of its 14 paks mount, 337,735 files). One extractor change: the challenge schedules of category `Styles`
  (an outfit's own challenges, which no season's tier gives: 5.30's `BundleSchedule_Styles_Tomatohead` and 6.02's
  `BundleSchedule_Styles_SkullTrooper`) are written with their bundles, beside the season's and the events'; 5.30's to
  6.00's committed overlays predate it and have none (6.01's did too, until it was extracted again: below). Against 6.01 as
  it then was five files change: `athena.json` (20 cosmetics added:
  Dark Bomber and her Dark Bag, which 6.01 kept in its keyed paks, Skull Ranger, Skull Sickle and Crypt Cruiser, Plague,
  Scourge, Dismal Cape, Arcanum, Herald's Wand and Lamplight, Hollowhead, Mouldering Cloak and Carver, Jack Gourdon,
  Bullseye, and the emotes Electro Swing, Headbanger, Behold! and Sprinkler; the Skull Trooper's and the Ghost Portal's
  styles, with their two tokens, VTID_052 and VTID_053; nine quests, the Skull Trooper Challenges' five and the later
  stages of week 3's Quest_BR_Visit_TwoNamedLocs_Chain_01; week 3's doorbells swapped for Quest_BR_Eliminate_Trap, the
  tomato challenge on a stat of its own, hit_player_with_tomato_toy, and the timed trials down from five to three; every
  daily challenge's hidden Token:Athena_DailyChallenge_Token, a token with no item definition in the paks; the two
  `Styles` schedules and their bundles; and the loot tables with the Quad Launcher,
  WID_Launcher_Military_Athena_VR/SR_Ore_T03, in the chest, supply drop and vending machine rocket lists), `characters.json`
  and `items.json` (the seven new outfits' heroes, three harvesting tools, the Quad Launcher's two items and the three
  Suppressed Submachine Guns, WID_Pistol_AutoHeavySuppressed_Athena_*, back in the paks, their seven loot rows at weight 0
  as in 6.01),
  `fabricator.json` (those weapons' values) and `world.json` (one mission generator, MissionGen_AthenaEvent23, High
  Explosives'). Save the World's quests and every other file are 6.01's. The earlier 6.02, CL-4442095, isn't extracted
  (Core has no copy of its paks) and plays on CL-4461277's data. Two later extractor changes, with 6.02 extracted again
  (only `athena.json` differs, by these): a challenge schedule whose `CleanUpOnBundleCompletion` is set carries
  `cleanUpOnBundleCompletion` (Schedule_LTM_Heist, Season 6's ProgressiveA and B and the two `Styles` schedules), and a
  bundle's completion reward that names the gift box it comes in (`GiftBoxToUse`) carries its template id as `giftBox`
  (`GiftBox:gb_challengecomplete`: each Season 6 week's season XP at four challenges, Calamity's and Dire's rewards, the
  Ghost Portal and Tomatohead's Crown); 6.00's and earlier committed overlays predate both. Two more for Core-Backend #334,
  with 6.01 and 6.02 extracted again. The seasons before the build's are still in its files (6.02 has AthenaSeason3 to 5
  beside AthenaSeason6), and a challenge schedule such a season's rewards give that its `TokensToRemoveAtSeasonEnd` doesn't
  name isn't taken at that season's end: it is written with the build's own schedules, its bundles with it, and carries
  `keptPastSeason`, the season that gave it. In 6.01 and 6.02 that is `season5_progressivea_schedule` ("Drift Challenges", a
  hidden reward of AthenaSeason5's tier 1 Battle Pass rewards) and `season5_progressiveb_schedule` ("Ragnarok Challenges",
  tier 100's), both `cleanUpOnBundleCompletion`; AthenaSeason3 and AthenaSeason4 name every schedule they give (Carbide's
  bundle is in Season4_Challenge_Schedule, Omega's is Season4_ProgressiveB_Schedule), so none of theirs is kept. A season
  that names no `TokensToRemoveAtSeasonEnd` is passed over. And Core's own pak in a build's Paks folder
  (`pakchunkCoreServerAssets-WindowsClient_P.pak`, the server assets Core-Launcher installs) isn't the build's data and isn't
  read: with it 6.01's folder gave doubled files and no display assets. Against the committed overlays only `athena.json`
  differs: 6.02's by the two kept schedules and their bundles, 6.01's by those and by what the two changes before it keep,
  which its overlay predated (`bundleschedule_styles_tomatohead` and its bundle, `cleanUpOnBundleCompletion` and `giftBox`).
  6.00's and Season 5's overlays aren't refreshed (their paks aren't at hand), so they keep no earlier season's schedule.
  6.10's (CL-4480234, UE 4.21, the latest of Update v6.10's three builds) is `4.21.0-4480234+++Fortnite+Release-6.10` (no
  `Build.version`; the build folder is `6.10-CL-4480234\Fortnite`) with 6.02's full data (Cert's files with
  `gamedata/4461277` applied) as the fifth argument, and the main key FModel's settings hold for its build folder; no
  extractor change. A full install with Save the World, and all of its 8 paks mount (263,299 files: it has no keyed pak
  and none of 6.02's leftover language paks); its DefaultGameData still names no MissionAlerts (24 alerts and 4 storm
  spreads from the fifth argument). Against 6.02 nine files change: `athena.json` (13 cosmetics added: Guan Yu with
  Loyal Shield, Guandao and Divine Dragon, Spider Knight and Arachne with Spider Shield, Long Legs, Web Breaker and
  Hatchling, Moonrise, the Onesie outfit and the Fortnite Birthday! emoticon; 29 quests, weeks 4 to 7 of Season 6's
  challenges as Epic ran them, with their staged chains, and Quest_BR_Styles_SkullTrooper_GainXP, which no bundle names;
  those four weeks' bundles; the Skull Trooper Challenges eased to 300 damage and 6 chests in a single match; Hunting
  Party's fourth banner, BRSeason06Tattered, where 6.02 still named Season 5's crown; 28 objective stats; and the loot
  tables with new weights: the Quad Launcher's 0.61 and 0.085 to 0.3 and 0.1, the Grenade Launcher's 1.5 to 0.6), `items.json`,
  `characters.json`, `fabricator.json` and `upgrades.json` (the four new outfits' heroes, three harvesting tools, the Rat
  King, SID_Assault_RatRod_Slug_SR, with its weapons and recipes, the daily challenge token, Token:Athena_DailyChallenge_
  Token, an item now, the Player Jump Pads out of the armory's count, and two melee perks gone), `alterations.json` (the Rat King's and the
  Halloween weapons' explicit perk loadouts), `quests.json` and `objectivestats.json` (the Beta Storm's ten quests,
  NewMissionIntro_RtDRedux_1 to _10, and Canny Valley's reactive stats) and `world.json` (MissionAlertCategories gains
  NewMissionIntroductionCategory, quota 5; the Athena generators of Blitz, MissionGen_AthenaEvent36, 37 and 8; and
  Fortnitemares 2017's Hexsylvania is gone from the paks: eight mission generators, five primary missions and the four
  BP_ZT_TRV_HF zone themes). The Quadcrasher is in no table: the map places it (Athena/DrivableVehicles/Athena_QuadSpawner).
  The two earlier 6.10s, CL-4464155 and CL-4476098, aren't extracted (Core has no copy of their paks) and play on
  CL-4480234's data.
  6.20's (CL-4497486, UE 4.21, Update v6.20's build, its one changelist) is `4.21.0-4497486+++Fortnite+Release-6.20` (no
  `Build.version`; the build folder is `6.20-CL-4497486\Fortnite`) with 6.10's full data (Cert's files with
  `gamedata/4480234` applied) as the fifth argument, and the main key FModel's settings hold for its build folder. A full
  install with Save the World, 14 paks; its DefaultGameData still names no MissionAlerts (24 alerts and 4 storm spreads from
  the fifth argument). Two extractor changes. A pak on a key of its own is read when the backend's own keychain
  (`src/store/keychain.json`, what the storefront's keychain route serves the client) has its key: 6.20's `pakchunk1000`,
  Bunnymoon (CID_255_Athena_Commando_F_HalloweenBunny), which the client mounts with that key at login; a pak whose key
  isn't there stays unread, and nothing of a key is printed. And 6.20 gives the outfits' schedules CategoryIDs of their
  own (`Styles_SkullTrooper`, `Styles_Tomatohead`), which are kept as `Styles` was. Earlier overlays aren't refreshed (a
  fresh extraction of a build whose keyed pak is in the keychain, 6.01's Dark Bomber, would now read it). Against 6.10
  twelve files change: `athena.json` (37 cosmetics: Fortnitemares' Deadfire with Shackled Stone, Dark Shard and Dark
  Engine, Sanctum and Coven Cape, Dante, Rosa, Calavera, Spirit Cape, Spirit and Six String Striker, Brainiac, Bunnymoon,
  Patch Patroller, Summit Striker, Frostbite, the Halloween Bus, the Fortnitemares Challenges' Fiery, Deadfire spray and
  Virulent Flames, the Season 6 level 100 emoticon and spray, emotes...; the Onesie gone; Musha's and Hime's styles all
  start unlocked; the Fortnitemares Challenges, `schedule_fortnitemares` (EventName EventFlag.LTM_Fortnitemares, Part 1
  with the schedule and Parts 2 to 4 at DaysSinceEventStart 32, 34 and 36) with its four bundles, 26 quests and 70
  objective stats, all in context Athena.Playlist.Deimos; level 100's new rewards; the loot tables with the Six Shooter,
  WID_Pistol_Revolver_SingleAction_Athena_UC/R/VR, the Fiend Hunter Crossbow, WID_Special_FiendHunter_Athena_VR_Ore_T03,
  and the Port-A playsets' grenades), `items.json`, `characters.json`, `cardpacks.json`, `fabricator.json`, `upgrades.json`
  and `alterations.json` (Quickdraw Calamity, Skull Ranger Ramirez and Brainiac Jonesy, the Rat Rod set with its recipes,
  the Halloween choice packs, the new outfits' heroes), `collectionbook.json` (PageSpecial_RatRod_Weapons and _Crystal),
  `world.json` (Hexsylvania back: the four BP_ZT_TRV_HF zone themes, now under ZoneThemes/Spooky, its generators and
  primary missions, WM_PinHalloween and the NoMinRating difficulties), `quests.json` and `objectivestats.json` (the
  repeatable Mini-Boss quest pays 50 Gold, reactivequest_gathercollect_halloween_2 no longer starts HalloweenQuest_2017_
  Hidden_3, Canny Valley's pamphlets and exploration stat) and `banners.json`.
  6.21's (CL-4526925, UE 4.21, Update v6.21's build, its one changelist) is `4.21.0-4526925+++Fortnite+Release-6.21` (no
  `Build.version`; the build folder is `6.21-CL-4526925\Fortnite`) with 6.20's full data (Cert's files with
  `gamedata/4497486` applied) as the fifth argument, and the main key FModel's settings hold for its build folder; no
  extractor change. Its install has 6 paks, pakchunk0 and its s1 to s5 (219,974 files): no pakchunk1 or pakchunk1_s1
  (Save the World's mission maps and tiles, 62 of 63 primary missions' FortMissionInfo: their tags come from the fifth
  argument), no keyed pak (6.20's Bunnymoon is in pakchunk0 now) and no language paks, and no Core server-assets pak in
  its folder. Its DefaultGameData still names no MissionAlerts (24 alerts and 4 storm spreads from the fifth argument).
  Against 6.20 nine files change: `athena.json` (27 cosmetics: Shogun with Bladed Wings, Kabuto and Jawblade, Spooky Team
  Leader with Goodie Gourd, Reflex and Instinct with Response Unit, Reaction Tank, Pivot and Angular Axe, Ruckus and Mayhem
  with Spike Chamber, Puncture Pack, Junkjet and Splinterstrike, Growler and Flapjackie with Woofs, Nibbles, Poofy Parasail
  and Jackspammer, Yee-Haw!, Lil' Kev and Crazy Feet; 18 display assets, Cloaked Star's among them; the Lil' Kev challenges,
  `schedule_ltm_lilkevin` (EventName EventFlag.LTM_LilKevin) with its bundle and three quests; the Fortnitemares bundles'
  rewards in GB_FortnitemaresChallenges and quest_fnm_completequests counting the tokens held (HasItem); Season 6's weeks 6
  and 7 with one challenge each changed; three objective stats (complete_athena_deimos, outlive_athena_deimos,
  killingblow_athena_player_rarity_grey) and six changed; the loot tables with the Balloons in the gadget, chest, vending machine
  and supply drop lists, and new weights for the rocket and vending machine rows and two floor loot and chest tiers),
  `items.json`, `characters.json`, `cardpacks.json`, `fabricator.json`, `upgrades.json` and `alterations.json` (Dim Mak
  Igor, HID_Ninja_018, and Fortnitemares Part 2's two heroes, HID_Ninja_019 and HID_Outlander_018; the Candy Corn LMG and the
  Halloween hand cannon with their recipes; the Perk Caches, Cache_Perk_UC/R/VR/SR_Pickup and their CacheRoll_PerkMaterials
  packs; the Balloons; the new outfits' heroes and harvesting tools; the Oil Slick Trap gone), `quests.json` (Kill Vlad and
  two Hexsylvania fetch quests lose their visible rewards), `world.json` (MissionGen_AthenaEvent47 to 49 gone: the Deimos
  playlists use MissionGen_Athena); `banners.json`, `collectionbook.json` and the rest are 6.20's.
  6.22's (CL-4543176, UE 4.21, Update v6.22's build, its one changelist) is `4.21.0-4543176+++Fortnite+Release-6.22` (no
  `Build.version`; the build folder is `6.22-CL-4543176\Fortnite`) with 6.21's full data (Cert's files with
  `gamedata/4526925` applied) as the fifth argument, and the main key FModel's settings hold for its build folder; no
  extractor change. A full install again: 13 paks (356,175 files), pakchunk0 and its s1 to s5, pakchunk1 and pakchunk1_s1
  (Save the World's mission maps and tiles) and the language paks 2, 5, 7, 8 and 9; no keyed pak and no Core server-assets
  pak in its folder. Its DefaultGameData still names no MissionAlerts (24 alerts and 4 storm spreads from the fifth
  argument). Against 6.21 eight files change: `athena.json` (19 cosmetics: the NFL outfits End Zone, Gridiron, Spike, Strong
  Guard, Blitz, Rush, Interceptor and Juke, the referees Whistle Warrior and Striped Soldier, Upright Axe, Golden Pigskin,
  First Downer, Touchdown, Spike It and Denied, A.I.M. with E.L.I.M. and A.X.E.; 14 display assets; Season 6's cumulative
  challenges give A.I.M. and E.L.I.M. at seven; week 7's elimination quest swapped for the single-match damage chain;
  the Korean PC bang quests, quest_br_pcb_bundle1_*, which no schedule grants; nine objective stats; the loot tables with
  the Heavy Assault Rifle, WID_Assault_Heavy_Athena_R/VR/SR_Ore_T03, in floor loot, vending machines and supply drops and
  other rows' weights changed), `items.json`, `characters.json` and `fabricator.json` (the new outfits' heroes and
  harvesting tools, the Heavy Assault Rifle, two PC bang tokens; Deco_Butterfly gone), `alterations.json` (the Candy Corn
  LMG's slot loadout), `quests.json` (Fortnitemares Part 2's rewards: HalloweenQuest_KillVlad's Sanguine Dusk,
  HID_Outlander_018, and the fetch quests' Candy, Candy Corn LMG schematic and choice of heroes), `objectivestats.json` and
  `world.json` (MissionGen_AthenaEvent8, 36 and 37 gone); the rest are 6.21's.
  Unlike the other files, the committed `gamedata/athena.json` is 1.8's, not Cert's (empty): requests that
  name no build (CoreV2's match reports) need it (`src/gamedata/athena.js`).
- `alterations.json`: from 4.2 (CL 4072250), the Perk Recombobulator's tables DefaultGameData names (empty before):
  `slotLoadouts` (AlterationSlotsLoadouts: each loadout's slots, their unlock level and rarity, slot definition,
  respeccable flag and SlotInitMin/Max), `slotDefinitions` (AlterationSlotDefinitions: group, BaseRespecCosts),
  `groups` (AlterationGroups: the perks by rarity with their roll weights and exclusion names), `namedExclusions`,
  `migration` (AlterationMigrationMapping: a legacy perk's new perk and additional perk) and `intrinsic`
  (AlterationIntrinsicMapping: the element perk a damage tag gives). In `items.json`, weapons and traps with a loadout
  carry it (`alterationLoadout`, AlterationSlotsLoadoutRow) and their WeaponStatHandle row's `namedWeightRow`, and perks
  (FortAlterationItemDefinition) their upgrade row (`rarityUpgrade`, Evolve.AID.*) and AdditionalRespecCosts
  (`respecCosts`). 4.2's overlay was made with this; no earlier build's data changes.
- `research.json`: the resource collectors (research points): each CollectedResource template's payout and the
  homebase attributes its rate, capacity and wallet cap come from, what each skill tree node adds to those attributes
  (its CommandConsole_GEImporter rows) and the account buffs that multiply them (BuffEffects modifiers).

## Other builds

`gamedata/` is Cert's (CL-3532353). A build whose data differs keeps only its differences, in `gamedata/<changelist>/`:
each file there is the JSON merge patch (RFC 7396: objects merge, `null` removes a key, anything else replaces) that turns
Cert's file into that build's. The backend serves each request the data of the build its User-Agent names, Cert's for
any build without a folder (`src/gamedata/read.js`, `perBuild`). To make or refresh an overlay, extract both builds
with the same extractor and diff them (both paks are v3 with an unencrypted index; only the config `.ini` files are
encrypted, with the same key for Cert and 1.2):

```
dotnet run -c Release --project tools/extractor -- "<Cert build folder>" <aes key> <cert output folder>
dotnet run -c Release --project tools/extractor -- "<other build folder>" <aes key> <other output folder>
node tools/overlay/overlay.mjs <cert output folder> <other output folder> <changelist>
```

Without the Cert build at hand, the committed `gamedata/*.json` (all but `theaters.json`) stand in for its extraction:
they are what this extractor makes from Cert (a fresh 1.7.2 extraction is exactly Cert's files with
`gamedata/3700114` applied), and 1.8's overlay (`gamedata/3724489`) was made against them.

`theaters.json` isn't extracted and is shared by every build. From 5.10, whose data has Canny Valley's first act, the
backend redraws that act on it (`src/world/landmarks.js`, `src/world/cannyvalley.js`) from the build's `world.json`.
