# Game data per build (gamedata/)

## Layout

- `gamedata/<name>.json`: **Cert's** data, extracted from Fortnite 1.1 (CL-3532353, `certBuild` in
  `src/builds/detect.js`). Every build starts from these.
- `gamedata/<CL>/<name>.json`: a build's **overlay**: only the files whose data differs from Cert's, each stored as the
  merge patch that turns Cert's file into that build's (`src/gamedata/patch.js`). Example: `gamedata/4727874/` is 7.20.
- `src/gamedata/read.js` decides which data a request gets:
  - a build with its own folder gets Cert's data with its overlay applied;
  - a build listed in `laterData` (builds whose paks Core has no copy of, such as 4.4.0, 4.4.1, 4.5.0, 5.0.0, 5.10.0,
    6.00.0, 6.01.0, 6.02.0) plays on the later build of the same update;
  - any other build gets the closest **earlier** build that has a folder (data only moves forward);
  - a request with no CL, or older than Cert, gets Cert's.
- Some names always read as Cert's whatever the build (tests check no overlay has one). `theaters.json` isn't
  extracted (`tools/theaters`) and is the same for every build.

The files (details in `tools/extractor/README.md`): `quests.json`, `items.json`, `athena.json` (Battle Royale
cosmetics, display assets, quests, season levels and Battle Pass, from 1.8), `world.json`, `dailyrewards.json`,
`homebasenodes.json`, `squads.json`, `banners.json`, `characters.json`, `cardpacks.json`, `objectivestats.json`,
`fabricator.json`, `collectionbook.json`, `inventory.json`, `upgrades.json`, `research.json`, `accountlevels.json`,
`alterations.json`, `expeditions.json`, `transmog.json`.

## Making a build's data

The extractor reads a build's paks with CUE4Parse; the overlay tool diffs it against Cert's extraction.

```
dotnet run -c Release --project tools/extractor -- "<Cert build folder>" <aes key> <cert output folder>
dotnet run -c Release --project tools/extractor -- "<build folder>" <aes key> <build output folder> [<UE version string>]
node tools/overlay/overlay.mjs <cert output folder> <build output folder> <CL>
```

- The engine version and CL come from the build's `Engine/Build/Build.version`; a build without one takes them as
  the fourth argument in its User-Agent form (`4.19.0-3790078+++Fortnite+Release-Cert`).
- **AES keys:** the extractor needs the build's pak key. **Never** print, paste into chat, log, write to a file or
  commit a key, and never put one in a commit message or issue. If you can't run the extraction without the key
  appearing in output, stop and leave the extraction to the owner (write it in `D:\CoreWork\HANDOFF.md`).
- Both builds must be extracted by the same extractor version, so only the build's own differences land in the
  overlay. Extraction output goes in your scratch folder under `D:\CoreWork`, never in a build folder.
- Read only from the installed build folders; never copy or change them.
- A new UE version needs its mapping in the extractor (`Program.cs`) first.

## After adding a build's data

1. `src/builds/detect.js`: the CL in `buildVersions` (as Core-Launcher's `KnownBuilds` names it), its release date in
   `buildReleases` where the season's events are dated, and the season comment.
2. `src/gamedata/read.js`: a `laterData` entry only for a build whose paks Core has no copy of.
3. `tests/build<ver>.test.js`, following the previous build's file: `versionOf`, `dataBuild` (on its own data),
   allowed builds, the season, key cosmetics, quests and events of the update (patch notes), the item shop.
4. Patch-note features that need the backend: events and their calendar flags (`src/events/`), LTMs
   (`src/events/ltms.js`), new MCP commands (`docs/agents/mcp-commands.md`), shop and Battle Pass.
5. Run the new test file and the previous build's, then `npm.cmd test` once.

## Rules

- Data comes from the build's own paks. Don't copy another build's data across because it "should be the same";
  if two builds really have identical data, say how it was checked.
- Keep the extractor's notes in its README current when it learns a new shape.
- Game data that a gameserver needs at runtime (loot tables, server-only Blueprints) isn't here: that is
  Core-ServerAssets' paks.
