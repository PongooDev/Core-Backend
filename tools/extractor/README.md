# Extractor

Maintainer tool. Reads a build's paks with [CUE4Parse](https://github.com/FabianFG/CUE4Parse) and writes the shared
game data in `gamedata/`, which is committed so users never run this.

```
dotnet run -c Release --project tools/extractor -- "<build folder with FortniteGame and Engine>" <aes key>
```

- `quests.json`: every quest's type, objectives, rewards and prerequisites.
- `items.json`: every item definition's class, the profile it lives in (`profile` for account items, `theater` for
  world items) and its stack limit (the asset's `MaxStackSize`, else the class constructor's default). World items of
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
- `dailyrewards.json`: the daily login reward schedules from `DefaultGameData`, rows in lookup order.
- `homebasenodes.json`, `squads.json`: the skill tree (nodes, pages) and squads from the homebase manager.
- `characters.json`: gameplay tags, required tags and manager flags of heroes, survivors and defenders.
- `cardpacks.json`: each card pack's loot tier group, tier, choice flag and display level.
- `objectivestats.json`: the quest objective stat table (type, target tags, condition, and source and context tags
  when a row has them).
- `fabricator.json`: the storm shield fabricator's numbers (OutpostData's FabricatorBuildingData) and each world item's
  quantum goo values (the MCP template's static_disintegration_value and static_fabrication_value).
- `world.json`: zone themes (tile class, valid difficulties), mission generators, their primary missions' MissionTags,
  the mission difficulty rows and every quest's object path.
- `collectionbook.json`: the collection book's pages (book profile, sections, rewards), sections (slots, rewards),
  slots (allowed item templates, survivor personalities, XP weight row), the slot XP weights, the rarity factor curve
  and the book levels (total XP, rewards).
- `inventory.json`: what each skill tree node and account buff adds to the item limits (FortHomebaseSet
  `InventorySizeBonus` for the account vault, `WorldInventorySizeBonus` for the backpack, `StorageInventorySizeBonus`).
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

`theaters.json` isn't extracted and is shared by every build.
