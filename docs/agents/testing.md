# Testing Core-Backend

## Commands

Prefer the core MCP's `backend_tests` (files) if available. Fallback, from your worktree, in PowerShell:

```
node --test tests/build720.test.js tests/athena.test.js     # while iterating: only the files you touched or that cover your change
npm.cmd test                                               # once, right before committing (node --test over ~230 files, about a minute)
npm.cmd run test:stress                                    # only when you changed concurrency, locking or matchmaking load paths
```

- Use `npm.cmd` in PowerShell (`npm.ps1` may be blocked by the execution policy).
- A full run can fail one unrelated file under load (`stacking`, `cloudstorage`, `quests` are known to be flaky).
  Rerun just that file; if it passes alone, note it in the commit message. If it fails alone, it isn't flaky:
  find out why.
- Don't run the full suite repeatedly while iterating: it was the main reason agent tasks took too long.

## Conventions

- `node:test` and `node:assert/strict`, ES modules.
- Tests that need HTTP start their own backend: `startBackend(config)` in `tests/helpers.js` (temp data folder, port 0,
  no waits) and `close()` it at the end. Never point a test at port 5595 or the real `data` folder.
- Tests that need a build's context run inside `inBuild("<CL>", () => ...)`; profile tests open a session on a temp
  profile store (see `tests/build720.test.js`'s `withSession`). Clean up temp folders with retries
  (`fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })`): Windows can hold files briefly.
- One `tests/build<ver>.test.js` per build pins that build's facts: its version name, its data, its season, its
  events and LTMs, its shop. Add to it when a change is build-specific.
- Area files (`athena`, `quests`, `cloudstorage`, `admin-*`, ...) pin behaviour shared across builds.
- When a change is for one build, also assert that a neighbouring build is unchanged.

## A test backend for gameserver boots

Gameserver boots (CoreV2) need a backend on a test port:

```
node src/main.js --port 5711 --data H:\CoreWork\<task>-data --local-only --qos-ping-port 0 --vivox-sip-port 0
```

Start it from your worktree so it runs your commit, wait for `Listening on port 5711`, and stop it when done. Never
use port 5595 or the main checkout's `data` folder for tests, and never stop a backend you didn't start. (The owner's
5595 backend is restarted after changes on main, by `restarting-the-live-backend.md` only.)

## node_modules in a worktree

`npm.cmd ci` in the worktree, or a junction to the main checkout's folder:

```
cmd /c mklink /J node_modules $env:USERPROFILE\Documents\GitHub\Core-Backend\node_modules
cmd /c rmdir node_modules        # remove it before `git worktree remove`; never rmdir /s through a junction
```
