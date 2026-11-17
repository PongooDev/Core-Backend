---
name: add-build-gamedata
description: Use when Core-Backend must serve a new Fortnite build (a new-build bring-up) or a build's game data is wrong - extracting gamedata/<CL> with the extractor and overlay tool, the version name and release date, the build's events, LTMs, shop and MCP commands, and its build test file.
---

# Add a build's game data

Depth: `docs/agents/gamedata.md`, `docs/agents/versions-and-calendar.md`, `docs/agents/mcp-commands.md`.

**Never** print, paste, log, write to a file or commit a pak AES key. If the extraction can't run without the key
appearing in output, stop and write it in `H:\CoreWork\HANDOFF.md` for the owner.

1. Read `H:\CoreWork\HANDOFF.md`; run `project_status` for the build folder, CL, UE version and SDK.
2. Worktree from `origin/main` under `H:\CoreWork` (see AGENTS.md section 5), `npm.cmd ci`.
3. Extract Cert and the new build with the same extractor into scratch folders under `H:\CoreWork` (never into the
   build folder):
   ```
   dotnet run -c Release --project tools/extractor -- "<Cert build folder>" <aes key> <scratch>\cert
   dotnet run -c Release --project tools/extractor -- "<build folder>" <aes key> <scratch>\<CL>
   node tools/overlay/overlay.mjs <scratch>\cert <scratch>\<CL> <CL>
   ```
   A new UE version needs its mapping in `tools/extractor` first.
4. `src/builds/detect.js`: add the CL to `buildVersions` (the name Core-Launcher's `KnownBuilds` uses) and to
   `buildReleases` (release day, UTC) when its season's events are dated; extend the season comment.
5. Patch notes of the update: for each feature the backend serves (events and calendar flags, LTMs and their
   playlists, the shop, Battle Pass, quests), check the build's paks (fmodel MCP) and add it in `src/events/` or
   `src/store/`, served only to builds whose paks have it.
6. New or changed MCP commands: diff the `UFortMcpProfile*` functions in the new SDK against the previous build's;
   add handlers for missing ones (`docs/agents/mcp-commands.md`).
7. `tests/build<ver>.test.js`, modelled on the previous build's: version, `dataBuild`, allowed builds, season, key
   cosmetics, quests, events, LTMs, shop. Assert the previous build is unchanged where you touched shared code.
8. `node --test tests/build<ver>.test.js tests/build<previous>.test.js`, then `npm.cmd test` once.
9. README status table and `.github/ISSUE_TEMPLATE/bug_report.yml` build dropdown, if the bring-up's promotion step
   hasn't done them.
10. Run `pre-commit-review`, commit only your paths (the pre-commit hook runs; never `--no-verify`; the per-build
    `upgrades.json` is exempt from its 5 MB limit), rebase on `origin/main`, push.
11. Restart the owner's 5595 backend on the new main: `restart_backend` (core MCP), else the `restart-live-backend`
    skill.

Done when: the new build's test file passes, the full suite passes once, 5595 runs the new main, and the report lists
which patch-note features are served, which aren't, and what was only checked statically.
