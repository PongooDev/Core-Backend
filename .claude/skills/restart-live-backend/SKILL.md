---
name: restart-live-backend
description: Use after every Core-Backend change lands on main (a fix, a merged PR, new game data) to restart the owner's live backend on port 5595 from the main checkout, safely - pull, stop only the node.exe running Core-Backend's src\main.js, start it hidden, wait for "Listening on port 5595". Allowed at any time, even mid-game.
---

# Restart the owner's live backend (5595)

Depth: `docs/agents/restarting-the-live-backend.md` (the exact commands).

1. Preferred: the core MCP's `restart_backend` (if available). Check its result says `Listening on port 5595`. Done.
2. Fallback, PowerShell, in order; stop at the first failure and report it:
   1. `git -C $env:USERPROFILE\Documents\GitHub\Core-Backend pull --ff-only`. If it fails, stop: never reset, stash
      or edit the main checkout.
   2. List the 5595 listeners: `Get-NetTCPConnection -LocalPort 5595 -State Listen`, and each owner's
      `Get-CimInstance Win32_Process -Filter "ProcessId = <pid>"`.
   3. Check every listener first: it must be `node.exe` with `Core-Backend` and `src\main.js` (or `src/main.js`) in
      its command line. Anything else holding 5595: **stop and report; kill nothing.** A bare relative
      `node src/main.js` can't be confirmed: report it for the owner.
   4. `Stop-Process -Id <pid>` for those listeners only; wait until nothing listens on 5595.
   5. Start it hidden from the main checkout with the full path, output to `data\logs\backend-console.log`:
      ```
      $repo = "$env:USERPROFILE\Documents\GitHub\Core-Backend"
      Start-Process -FilePath node -ArgumentList "`"$repo\src\main.js`"" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput "$repo\data\logs\backend-console.log" -RedirectStandardError "$repo\data\logs\backend-console.err.log"
      ```
   6. Wait (up to a minute) for `Listening on port 5595` in `backend-console.log`. If it doesn't come, read both logs
      and report that 5595 is down.
3. Say in the report and the issue or PR comment: restarted on commit `<sha>`.

Never use 5595 for tests. Leave the restarted backend running.
