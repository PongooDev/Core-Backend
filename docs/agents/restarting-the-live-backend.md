# Restarting the owner's live backend (port 5595)

The owner plays against the Core-Backend running from the main checkout on port 5595. The owner's launcher reuses a
backend already listening there, so a change on main reaches the owner only when that backend is restarted.

**Rule (the owner's):** after every backend change lands on main (a fix, a merged PR, new game data), restart it.
This is allowed at any time, even while the owner is in a game. Test backends on other ports are unaffected by this
and follow `testing.md`.

## Preferred: the core MCP

`restart_backend` (if available) does exactly the steps below. Use it, then check its result says the backend is
listening on 5595 again.

## Fallback: by hand (PowerShell)

Run these steps in order. Stop at the first one that fails and report it; never improvise around a failed check.

1. Update the main checkout (fast-forward only; it must have no local changes):
   ```
   $repo = "$env:USERPROFILE\Documents\GitHub\Core-Backend"
   git -C $repo pull --ff-only
   ```
   If the pull fails, stop and report. Don't reset, stash or edit anything there.
2. Find what listens on 5595, and check **every** listener before stopping anything:
   ```
   $owners = @(Get-NetTCPConnection -LocalPort 5595 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
   foreach ($id in $owners) {
     $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
     "{0} {1} | {2}" -f $p.ProcessId, $p.Name, $p.CommandLine
     if (-not ($p.Name -eq 'node.exe' -and $p.CommandLine -match 'Core-Backend' -and $p.CommandLine -match 'src[\\/]main\.js')) { throw "5595 is held by something that isn't Core-Backend: stop and report" }
   }
   ```
   Stop a listener **only** if it is `node.exe` and its command line contains `Core-Backend` and `src\main.js`. Never
   stop anything else. If anything else holds 5595, stop here and report it.
   A backend started with a bare relative `node src/main.js` (as older sessions did) has no `Core-Backend` in its
   command line, so this check refuses it: report it and let the owner restart it once. Step 4 starts it with the full
   path, so every later check passes.
3. Stop it and wait for the port to free:
   ```
   foreach ($id in $owners) { Stop-Process -Id $id }
   $deadline = (Get-Date).AddSeconds(20)
   while ((Get-Date) -lt $deadline -and (Get-NetTCPConnection -LocalPort 5595 -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 500 }
   ```
   (No listener at all is fine: the backend wasn't running. Start it.)
4. Start it detached, hidden, from the main checkout, with the full path to `src\main.js`:
   ```
   $log = "$repo\data\logs\backend-console.log"
   Start-Process -FilePath node -ArgumentList "`"$repo\src\main.js`"" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$repo\data\logs\backend-console.err.log"
   ```
   It uses the checkout's own `data` folder and `config.json`, as the owner's backend always has. Don't add `--port`
   or `--data`.
5. Wait until it is listening:
   ```
   $deadline = (Get-Date).AddSeconds(60)
   while ((Get-Date) -lt $deadline -and -not (Select-String -Path $log -Pattern 'Listening on port 5595' -Quiet)) { Start-Sleep -Milliseconds 500 }
   Select-String -Path $log -Pattern 'Listening on port 5595'
   ```
   If the line doesn't appear, read `backend-console.log` and `backend-console.err.log` (exit code 1 means the port
   was still taken, 2 bad options) and report. Don't leave the owner without a backend: fix the cause or say plainly
   that 5595 is down.
6. Say in your report (and the issue or PR comment) that 5595 was restarted on commit `<sha>`.

This restarted backend is the one process you leave running; don't stop it at the end of your session.
