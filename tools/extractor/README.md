# Extractor

Maintainer tool. Reads a build's paks with [CUE4Parse](https://github.com/FabianFG/CUE4Parse) and writes the shared
game data in `gamedata/`, which is committed so users never run this.

```
dotnet run -c Release --project tools/extractor -- "<build folder with FortniteGame and Engine>" <aes key>
```

The engine version and changelist come from the build's `Engine/Build/Build.version`. A build that ships without one
(1.10, CL 3790078) takes them as a fourth argument, after the output folder, in its User-Agent's form:
`4.19.0-3790078+++Fortnite+Release-Cert`. UE 4.16 and 4.19 builds are mapped. 4.19 writes soft references with their
object name (`/Game/Path/Asset.Asset`); zone themes' tile classes and mission generators' primary missions are kept as
packages, as 4.16 writes them, so overlays only hold the builds' own differences.

- `quests.json`: every quest's type, objectives, rewards and prerequisites.
- `items.json`: every item definition's class, the profile it lives in (`profile` for account items, `theater` for
  world items; from 1.7.2, CL 3700114, `metadata` for storm shields and deployable bases) and its stack limit (the asset's `MaxStackSize`, else the class constructor's default). World items of
  weapon definitions (weapons, traps, building pieces) that have durability (`bItemHasDurability`, unless the asset
  turns it off) carry `maxDurability`, the MCP template's static_max_durability: GetMaxDurability at level 0, from the
  definition's `WeaponStatHandle` row (`BaseLevel`, `DurabilityScale`) and its `WeaponDurabilityRarity` row
  (`DurabilityRowName`) at the item's rarity; 1 when either row is missing.
  World items the game never saves to a profile (`bNeverPersisted` on the asset, else the class constructor's: set for
  `FortNeverPersistItemDefinition`, backpacks and emotes) carry `neverPersisted: true`. Items that count toward the
  account vault or backpack limit (`bInventorySizeLimited` on the asset, else the class constructor's) carry
  `inventorySizeLimited: true`.
  Badges carry their MCP template's static_cardpack_reward (`cardPackReward`, BadgeCardPackReward) and
  static_item_rewards (`itemRewards`, ItemRewards {templateId, quantity}).

Item template ids are resolved with the build's own asset manager rules (`PrimaryAssetTypesToScan` in
`DefaultGame.ini`): an asset gets the type of the rule whose directory holds it and whose base class it derives from.
- `dailyrewards.json`: the daily login reward schedules from `DefaultGameData` (from 1.7.2, the
  `DailyRewardScheduleDefinitions` asset it points to), rows in lookup order.
- `homebasenodes.json`, `squads.json`: the skill tree (nodes, pages) and squads from the homebase manager.
- `characters.json`: gameplay tags, required tags and manager flags of heroes, survivors and defenders.
- `cardpacks.json`: each card pack's loot tier group, tier, choice flag and display level.
- `objectivestats.json`: the quest objective stat table (type, target tags, condition, and source and context tags
  when a row has them).
- `fabricator.json`: the storm shield fabricator's numbers (OutpostData's FabricatorBuildingData) and each world item's
  quantum goo values (the MCP template's static_disintegration_value and static_fabrication_value).
- `world.json`: zone themes (tile class, valid difficulties), mission generators, their primary missions' MissionTags,
  the mission difficulty rows, the mission alert rows (with their spread rows), from 1.7.2 the alert categories
  (MissionAlertCategories: enum, quota, repeatable) and storm spreads (MissionAlertSpreadDatas), every quest's object path and, when the build defines any, its `Theater.*` gameplay tags
  (`Balance/GameplayTags`; 1.7.2's `Theater.MainProgression`).
- `collectionbook.json`: the collection book's pages (book profile, sections, rewards), sections (slots, rewards),
  slots (allowed item templates, survivor personalities, XP weight row), the slot XP weights, the rarity factor curve
  and the book levels (total XP, rewards).
- `inventory.json`: what each skill tree node and account buff adds to the item limits (FortHomebaseSet
  `InventorySizeBonus` for the account vault, `WorldInventorySizeBonus` for the backpack, `StorageInventorySizeBonus`).
- `athena.json`: Battle Royale's, from 1.8 (CL 3724489; empty for earlier builds): its cosmetics (`Athena/Items/Cosmetics`
  without the test characters: class, display name, rarity), the item shop's display assets (`Catalog/DisplayAssets`
  FortMtxOfferData with Battle Royale tile art, by the cosmetic each shows, matched by name: see `Program.cs`), its quests (`Athena/Items/Quests`, as in `quests.json` plus
  their category and weight), the season levels (AthenaGameData's `SeasonXpLevelsTable`) and the objective stat rows those
  quests count. Unlike the other files, the committed `gamedata/athena.json` is 1.8's, not Cert's (empty): requests that
  name no build (CoreV2's match reports) need it (`src/gamedata/athena.js`).
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

`theaters.json` isn't extracted and is shared by every build.
