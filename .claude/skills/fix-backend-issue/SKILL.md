---
name: fix-backend-issue
description: Use when fixing a Core-Backend GitHub issue or a reported lobby, profile, shop, calendar, event, matchmaking or login bug, from reading the issue to pushing the fix and closing the issue. Covers the worktree, checking the reporter's own build, tests, committing and commenting.
---

# Fix a Core-Backend issue

Rules: AGENTS.md sections 1 and 2. Depth: `docs/agents/*.md`.

1. Read `H:\CoreWork\HANDOFF.md`. If the issue is listed, continue from it; don't redo or undo listed work.
2. Run the core MCP's `project_status` (if available).
3. Read the issue and every comment: `gh issue view <n> -R PongooDev/Core-Backend --comments`. Note the reporter's
   build and CL, the backend log, and `logs/unknown/<CL>.jsonl` if attached. If the issue gives a list (dates,
   items, modes), copy it into your notes item by item.
4. If it's the build's own behaviour or needs a client change: comment why, close as not planned. Stop.
5. Worktree from a fresh `origin/main`:
   ```
   git -C C:\Users\tkenn\Documents\GitHub\Core-Backend fetch origin
   git -C C:\Users\tkenn\Documents\GitHub\Core-Backend worktree add -b fix-<n> H:\CoreWork\be-<n> origin/main
   cd H:\CoreWork\be-<n>
   npm.cmd ci
   ```
6. Find what **the reporter's build** sends and expects: its SDK (`sdk_find`), its exe (IDA MCP, read-only), its
   paks (fmodel MCP). Enums, event names and data differ between builds; never assume another build's.
7. Change the code; put the source of each fact in a comment (build, CL, address, asset, patch notes; `🟡` for
   Core's own choices).
8. Add tests: the reporter's build gets the new behaviour; a neighbouring build is unchanged.
9. Run the touched tests: `backend_tests` (files), else `node --test tests/<file>.test.js ...`. Then `npm.cmd test`
   once. Rerun a single flaky file instead of the suite.
10. Run the `pre-commit-review` skill.
11. Stage only your paths (never `git add -A`) and commit: cause, evidence, change, builds affected, what was
    verified. Freebuff/Codebuff commits end with `Agent: Freebuff` (no Claude Co-Authored-By line); Claude uses its
    own Co-Authored-By line.
12. `git fetch origin`, `git rebase origin/main`, rerun the touched tests if needed, `git push origin HEAD:main`.
13. `gh issue close <n> -R PongooDev/Core-Backend --comment "Fixed in <commit>: <cause, change, verified how>"`.
14. Write in `H:\CoreWork\HANDOFF.md` that the 5595 backend needs a restart (never restart it yourself).
15. Clean up: if `node_modules` is a junction, remove it with `cmd /c rmdir node_modules` (never `/s`); then
    `git worktree remove H:\CoreWork\be-<n>`, `git branch -D fix-<n>`; no process of yours left running.

Done when: AGENTS.md section 6 is all ticked.
