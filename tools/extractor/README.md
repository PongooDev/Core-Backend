# Extractor

Maintainer tool. Reads a build's paks with [CUE4Parse](https://github.com/FabianFG/CUE4Parse) and writes the shared
game data in `gamedata/`, which is committed so users never run this.

```
dotnet run -c Release --project tools/extractor -- "<build folder with FortniteGame and Engine>" <aes key>
```

- `quests.json`: every quest's type, objectives, rewards and prerequisites.
- `items.json`: every item definition's class, the profile it lives in (`profile` for account items, `theater` for
  world items) and its stack limit (the asset's `MaxStackSize`, else the class constructor's default).

Item template ids are resolved with the build's own asset manager rules (`PrimaryAssetTypesToScan` in
`DefaultGame.ini`): an asset gets the type of the rule whose directory holds it and whose base class it derives from.
- `dailyrewards.json`: the daily login reward schedules from `DefaultGameData`, rows in lookup order.
- `homebasenodes.json`, `squads.json`: the skill tree (nodes, pages) and squads from the homebase manager.
- `characters.json`: gameplay tags, required tags and manager flags of heroes, survivors and defenders.
- `cardpacks.json`: each card pack's loot tier group, tier, choice flag and display level.
- `objectivestats.json`: the quest objective stat table (type, target tags, condition).
