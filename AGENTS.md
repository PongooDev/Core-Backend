# Core-Backend: instructions for coding agents

Core-Backend is the Node.js backend for Core V2: accounts and OAuth, MCP profiles (Save the World and Battle Royale),
the item shop, the event calendar and hotfixes, matchmaking for Core's gameservers, XMPP, a Vivox stand-in, and an
admin panel. It answers every Fortnite build Core supports (1.1 onwards), each by its changelist (CL). This file is
for any coding agent working here (Freebuff, Codebuff, Claude Code or another). Read all of it before the first
change, and open the linked `docs/agents/*.md` files when a task touches their topic.

Paths: `%USERPROFILE%` is the owner's Windows user folder. In PowerShell write it as `$env:USERPROFILE`, as the
command examples do.

## 0. Start of every session

1. Read `H:\CoreWork\HANDOFF.md` (local, shared by every agent, not committed). Don't redo or undo work listed in it.
2. Run the core MCP's `project_status` tool (if available): build in development, supported range, installed
   builds, SDKs, IDA ports. Without it: the README status table and Core-Launcher's `KnownBuilds.cs`.
3. Work in your own git worktree under `H:\CoreWork` (section 5). Never edit files in the main checkout at
   `%USERPROFILE%\Documents\GitHub\Core-Backend`: the owner's live backend runs from it. The only things done there
   are `git pull --ff-only` and the 5595 restart (section 2).
4. If you can't finish in this session, update `H:\CoreWork\HANDOFF.md`: what is in progress, the branch or
   worktree, what was verified, what's next.

Per-build facts (paths, IDA ports, CLs, past findings) are in the read-only knowledge base
`%USERPROFILE%\.claude\projects\<the CoreV2 project folder>\memory\MEMORY.md` and the files it links. The folder name
is the CoreV2 checkout's path with `\` and `:` turned into `-`. Read it; **never edit it**.

## 1. Project rules

- **Each build gets what its own client sends and expects.** Base routes, profile data, enum numbers and events on
  that build's exe, SDK and paks, never on another build's. Enums renumber between builds (`ERewardSource`).
- **Don't break older builds.** A change for one build must leave every other build's answers as they were, unless
  the change is meant for them too. Gate by CL, by data the build has, or by what its client sends.
- **Epic's names and shapes.** Commands, routes, error codes and JSON fields as Epic's services had them. Where Epic's
  behaviour isn't recorded and Core has to choose, say so in a comment (`🟡` marks Core's own choices in the code).
- **Evidence in comments.** Note where a fact comes from: the build and CL, an exe address (`6.31 0xD3C1B0`), an SDK
  struct, an asset path, the patch notes. Follow the existing comment style.
- **Prefer the backend over the client.** Fix on the gameserver or here, not in CoreClient.dll. If only a client
  change would fix it, say so on the issue. Behaviour that is the build's own (the game did it that way then) is
  rejected, not fixed.
- **Report honestly.** Tests passing is static. Say what was seen with a real client or server and what wasn't.

## 2. Operating rules on the owner's PC

- **Port 5595 is the owner's live backend.** Never run tests or test servers against it. **After every backend
  change lands on main, restart it**, at any time, even while the owner is in a game (the owner's rule). Use the core
  MCP's `restart_backend` (if available); otherwise follow `docs/agents/restarting-the-live-backend.md` exactly: pull
  the main checkout, stop the 5595 listener only if it is `node.exe` running Core-Backend's `src\main.js`, start it
  again hidden, and wait for `Listening on port 5595`. If anything else holds 5595, stop and report.
- Test backends: your own port (not 5595), your own data folder under `H:\CoreWork`, `--local-only`, and
  `--qos-ping-port 0 --vivox-sip-port 0` so they don't collide with the live one.
- **Pre-commit hooks:** `tools/githooks/pre-commit` runs on every commit (enabled per clone with
  `git config core.hooksPath tools/githooks`; this checkout has it on). It blocks pak AES keys, private keys, files
  over 5 MB (the per-build `gamedata/<CL>/upgrades.json` excepted), build output and dependency folders
  (`node_modules`), binaries, game files and agent-local files, and syntax-checks the staged `.js`/`.mjs` files.
  **Never** bypass it (`--no-verify`); fix what it flags.
- **Never** launch a Fortnite client and **never** run a full match. Headless gameserver boots follow CoreV2's
  `docs/agents/headless-server-testing.md` (one at a time, test port, only while no `FortniteClient` you didn't
  start is running).
- **Never** modify, copy, hard-link or overlay anything in `F:\Builds` or `D:\Fortnite Builds`.
- **Never** kill a process you didn't start, except the 5595 Core-Backend restart above. Stop everything you started
  before you finish.
- **Never** print, copy or commit a pak AES key. (`src/store/keychain.json` is LawinServer's published cosmetic
  keychain, which the owner chose to ship; it is the only exception, and even there report counts, not keys.)
- Run any Python that reads downloaded or untrusted files with `python -I`.
- Work in worktrees under `H:\CoreWork`. Rebase onto `origin/main` before pushing: other agents push here too.
- Stage only your own paths. **Never** `git add -A` (it once committed another agent's half-done files).
- No CoreClient.dll changes unless the owner explicitly OKs that specific change.
- Close an issue only with a comment naming the fixing commit (section 7).

## 3. Repo map

| Path | What lives there |
| --- | --- |
| `src/main.js`, `src/server.js`, `src/app.js`, `src/config.js` | start-up, options (`--port`, `--data`, `--local-only`...), the Express app |
| `src/services/<service>/` | routes by Epic service: `account`, `fortnite` (calendar, cloudstorage hotfix, storefront, stats, version...), `mcp`, `matchmaking`, `content`, `friends`, `lightswitch`, `core` (Core's own API: sessions, presence, tls, vivox) |
| `src/services/mcp/profile.js` | MCP routes: `client/:command`, `dedicated_server/:command`, `public/:command` |
| `src/services/mcp/commands/` | one file per MCP command, registered in `index.js` (client, admin) and `server.js` (gameserver) |
| `src/profiles/` | profile logic: `athena.js`, `common.js`, `items.js`, `quests.js`, `heroes.js`, `homebase.js`, `creative.js`... |
| `src/builds/` | `detect.js` (CL to version, release dates, seasons), `context.js` (the request's build), `allowed.js` |
| `src/gamedata/` | reading `gamedata/` per build (`read.js`, overlays via `patch.js`) |
| `src/events/` | events and limited-time modes per build and date (`events.js`, `ltms.js`, one file per event) |
| `src/store/` | item shop, keychain, currency, creators |
| `src/matchmaking/`, `src/xmpp/`, `src/stomp/`, `src/vivox/`, `src/tournaments/` | matchmaking, chat and presence, voice |
| `src/admin/` | the admin panel (`panel.html`, `routes.js`) |
| `gamedata/*.json` | Cert's (1.1, CL-3532353) extracted game data |
| `gamedata/<CL>/` | a build's overlay: merge patches of the files that differ from Cert's |
| `tools/extractor`, `tools/overlay`, `tools/questnames`, `tools/theaters`, `tools/skilltree` | maintainer tools that make `gamedata/` |
| `tests/*.test.js` | `node --test` tests (one `build<ver>.test.js` per build, plus per-area files); `tests/helpers.js` |
| `tests/stress/` | stress tests (`npm run test:stress`) |

## 4. Run and test commands

Prefer the core MCP's tools (if available): `backend_tests` (files) and `project_status`. `backend_tests` runs in a
worker: a call waits up to about 100 s, then returns a `job_id`; call it again with just `job_id` until it reports
the result. Fallback commands, from the worktree, in PowerShell (`npm.cmd`, because `npm.ps1` may be blocked):

```
node --test tests/<file>.test.js tests/<other>.test.js      # while iterating: only the touched files
npm.cmd test                                                # once, right before committing (about a minute)
node src/main.js --port 5711 --data H:\CoreWork\<task>-data --local-only --qos-ping-port 0 --vivox-sip-port 0
```

- Node 22 or newer. A new worktree needs `node_modules`: run `npm.cmd ci` in it, or junction the main checkout's
  (`cmd /c mklink /J node_modules $env:USERPROFILE\Documents\GitHub\Core-Backend\node_modules`). Remove a junction
  with `cmd /c rmdir node_modules` (no `/s`: a recursive delete goes through the junction into the main checkout).
- If one unrelated file fails in the full run, rerun just that file. `stacking`, `cloudstorage` and `quests` tests
  are flaky under load.
- Tests start their own backend (`startBackend()` in `tests/helpers.js`) on a free port with a temp data folder.
- More: `docs/agents/testing.md`.

## 5. How a change is done here

1. Read `H:\CoreWork\HANDOFF.md`; run `project_status`.
2. Read the issue and every comment (`gh issue view <n> -R PongooDev/Core-Backend --comments`): build and CL, the
   backend log, `data/logs/unknown/<CL>.jsonl` (requests nothing answered).
3. If it's the build's own behaviour or needs a client change, comment why and close as not planned.
4. Worktree from a fresh `origin/main`:
   ```
   git -C $env:USERPROFILE\Documents\GitHub\Core-Backend fetch origin
   git -C $env:USERPROFILE\Documents\GitHub\Core-Backend worktree add -b fix-<n> H:\CoreWork\be-<n> origin/main
   ```
5. Find what the reporter's build sends and expects: its exe (IDA, read-only), its SDK, its paks (FModel). Check the
   reporter's build specifically, and every other build the code path serves.
6. Make the change; add or update tests that pin the build's behaviour (`tests/build<ver>.test.js` or the area's file).
7. Run the touched test files; then `npm.cmd test` once.
8. Self-review with the `pre-commit-review` skill (or sections 6 and 8 by hand).
9. Commit only your paths, with the message rules below. `git fetch origin`, `git rebase origin/main`, rerun the
   touched tests if the rebase brought changes, `git push origin HEAD:main`.
10. Comment on the issue with the commit and what was verified; close it if fixed.
11. Restart the owner's 5595 backend so it runs the change: `restart_backend` (core MCP), else
    `docs/agents/restarting-the-live-backend.md`. Check its log says `Listening on port 5595`.
12. Remove your worktree (junction first) and branch.

## 6. Definition of done

- [ ] The reporter's build was checked, by its CL, and every other build the change touches still answers as before.
- [ ] Facts in the code have their source in a comment (build, CL, address, asset, patch notes).
- [ ] Tests pin the new behaviour for the build(s) it is for, and that other builds are unchanged where it matters.
- [ ] The touched test files pass, and one full `npm.cmd test` passed (or an unrelated flaky file passed on rerun).
- [ ] No test or run used port 5595 or the real `data` folder.
- [ ] The commit message and issue comment say what was verified (tests, a test backend, a real client) and what not.
- [ ] Rebased, pushed, issue commented, the 5595 backend restarted on the new main and listening again, worktree
      removed, nothing of yours (other than the restarted 5595 backend) still running.

## 7. Commits, issues and hand-off

- Subject: `<area or build> (#<issue>): <what changed>`, e.g.
  `Victory umbrellas (#373): answer each build's own ERewardSource numbers`.
- Body: the cause and the evidence, the change, which builds it affects, what was verified.
- **Trailer:** commits made by Freebuff or Codebuff end with the line `Agent: Freebuff` and must not use Claude's
  `Co-Authored-By` line. Each Freebuff commit is reviewed later, so say what was verified live and what statically.
- Close an issue only with a comment that names the fixing commit. Never "should work now", never without a commit.
  Reopen when the reporter says it still happens.
- **One issue, several problems** (in its body or later comments): don't ask the reporter to refile. Keep the original
  for its first problem. Open a new issue for each extra problem under the owner's account (gh is logged in as the
  owner). Start it "Split out of #N (reported by @name)" and give the build, what happened and what should happen,
  with the reporter's screenshots and log links. Comment the new numbers on the original, then fix each one (owner's
  rule, 2026-11-19).
- **MrPodge6's decisions count as the owner's** on issues and PRs, from 2026-11-17 on (not earlier ones): reopening,
  closing, approving a change. The safety rules above still apply.
- Unfinished work goes in `H:\CoreWork\HANDOFF.md`, not a pushed WIP branch.

**Pull requests: review, fix, merge.** Agents review every open PR, make it right and merge it themselves (the
owner's rule). Check it out in a worktree (`gh pr checkout`), review it against sections 1 and 6 (each build's own
data, older builds unchanged, Epic's names and shapes, evidence comments, tests), rework what is wrong (push to the
PR branch when maintainers can edit it; otherwise merge first and fix on main right after, in the same session), run
the touched tests and one full `npm.cmd test`, merge with `gh pr merge <n> --merge` (the repo's usual merge commit),
comment on the PR with what was changed and why, then restart the 5595 backend. Reject a PR only when it adds
something the project has ruled out (client-only changes without the owner's OK, features beyond the project's
scope), with a comment. Steps: the `review-and-merge-pr` skill.

## 8. Mistakes made here before (don't repeat them)

1. **Fixed the wrong build (#362).** 773d122 served 6.31's iceberg events; the reporter was on 6.30, whose map
   watches different events (`BR_S6_Approach_01/02`), so nothing changed for them. Redone in 82207ac. **Do** check
   the reporter's own build's paks and serve each build its own data.
2. **Didn't follow the reporter's list (#367).** 608f71b set Season 6 LTM dates from memory; they didn't match the
   list in the issue (Food Fight's end, Disco Domination's windows). Redone in f5bef25. **Do** implement what the
   issue specifies, item by item, and check each against the builds' paks.
3. **One table for every build (#373).** 22792f4 numbered `ERewardSource` the same on all builds; the values differ
   by build (FirstWin 6 on 1.8 to 4.5, 8 from 5.0), so umbrellas showed as a Battle Pass tier-up. And 1.10 can't
   show award groups at all. Redone in 3c0383f. **Do** read enums per build from the SDKs and exes.
4. **Closed too early.** #362, #367, #373 were closed as fixed and had to be reopened or followed up. **Do** verify
   against the reporter's build before closing, and close with the commit named.
5. **`git add -A` with another agent working.** f5d6c05 pushed another agent's half-done files. **Do** use your own
   worktree and stage only your paths.
6. **Tested old code.** A fix "didn't work" because the owner's test ran against a 5595 backend still on an older
   commit (restarting the launcher doesn't help: it reuses a backend already on 5595). **Do** restart 5595 after every
   change on main, start test backends from your worktree at your commit, and check each one's first log line.
7. **Hotfix ini text cut at `//`.** The hotfix's ini goes through a parser where an unquoted `//` starts a comment,
   so URLs were cut to `http:` (#349, #355; fbb2301, b449754). **Do** quote URL values: `Key="http://..."`.
8. **Config in the wrong place.** From 6.20 the client reads no loose `.ini` except `GameUserSettings.ini`, and the
   hotfix arrives after the login screen. Client config Core needs at login goes in Core-Launcher's config pak.
9. **Slow test loops.** Agents ran the full suite many times per task. **Do** run only the touched files while
   iterating, and the full suite once.

## 9. Tools: MCP servers

The servers are configured in `%USERPROFILE%\.agents\mcp.json`: `core`, `ida-13337` to `ida-13341`, and `fmodel`.

- **core MCP** (if available): `project_status`, `backend_tests` (files), `restart_backend` (the 5595 restart;
  `dry_run=true` shows what it would stop and start without touching anything). Prefer them over hand-typed
  commands; the docs' commands are the fallback. `backend_tests` and `restart_backend` return a `job_id` when they
  outlast a call (about 100 s): call the same tool again with just `job_id` until it reports the result. Jobs survive
  a restart of the MCP server.
- **IDA MCPs** `ida-13337` to `ida-13341`: run `project_status` first to learn which port holds which build.
  **Read-only:** decompile, disasm, xrefs, find, lookups, `py_eval` only for reading. **Never** patch, rename,
  define or `idb_save`.
- **fmodel MCP:** the build's assets (calendar event Blueprints, playlists, data tables). Read-only.

## 10. Facts that change: check, don't assume

The build in development, the supported range, build paths and IDA ports change often; one build is in development
at a time. Check with `project_status`, the README table, `src/builds/detect.js` and Core-Launcher's `KnownBuilds.cs`.

## 11. Deeper docs

| Doc | Read it when |
| --- | --- |
| [docs/agents/gamedata.md](docs/agents/gamedata.md) | game data per CL, the extractor and overlays, a new build's data |
| [docs/agents/versions-and-calendar.md](docs/agents/versions-and-calendar.md) | build versions, seasons, events, LTMs, calendar, hotfix ini |
| [docs/agents/mcp-commands.md](docs/agents/mcp-commands.md) | MCP commands and profiles |
| [docs/agents/testing.md](docs/agents/testing.md) | test conventions, test backends, flaky files |
| [docs/agents/restarting-the-live-backend.md](docs/agents/restarting-the-live-backend.md) | after every backend change on main (the 5595 restart) |

Skills in `.claude/skills/`: `fix-backend-issue`, `review-and-merge-pr`, `add-build-gamedata`,
`restart-live-backend`, `pre-commit-review`.

Related repos: [CoreV2](https://github.com/PongooDev/CoreV2) (gameserver; its `AGENTS.md` has the RE workflow and
the headless boot rules), [Core-Launcher](https://github.com/PongooDev/Core-Launcher),
[Core-ServerAssets](https://github.com/PongooDev/Core-ServerAssets).
