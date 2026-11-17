---
name: review-and-merge-pr
description: Use for every open Core-Backend pull request - check it out in a worktree, review it against the per-build and old-build rules, rework what is wrong (on the PR branch or on main right after), run the tests, merge it, comment on what was changed, and restart the 5595 backend. Reject only what the project has ruled out.
---

# Review, fix and merge a Core-Backend pull request

The owner's rule: agents review every open PR, make it right and merge it themselves. Rules: AGENTS.md sections 1,
2, 6 and 8.

1. Read `H:\CoreWork\HANDOFF.md` (skip PRs someone is already on). `gh pr list -R PongooDev/Core-Backend --state open`.
2. Read it: `gh pr view <n> -R PongooDev/Core-Backend --comments`, `gh pr diff <n> -R PongooDev/Core-Backend`.
3. Reject only if it adds something ruled out (a client-only change without the owner's OK, a feature outside the
   project's scope): `gh pr close <n> -R PongooDev/Core-Backend --comment "<why>"`. Stop.
4. Worktree and checkout:
   ```
   git -C $env:USERPROFILE\Documents\GitHub\Core-Backend fetch origin
   git -C $env:USERPROFILE\Documents\GitHub\Core-Backend worktree add --detach H:\CoreWork\bepr-<n> origin/main
   cd H:\CoreWork\bepr-<n>
   gh pr checkout <n> -R PongooDev/Core-Backend
   npm.cmd ci
   ```
5. Review each change: answers based on the build's own exe, SDK and paks; other builds unchanged; Epic's names,
   routes, error codes and JSON shapes; evidence comments (`🟡` for Core's choices); tests that pin it; no keys,
   secrets or personal data.
6. Rework what is wrong. If `gh pr view <n> -R PongooDev/Core-Backend --json maintainerCanModify` is true, commit on
   the PR branch and `git push`. If not, merge first (step 8) and fix on main right after, in this session. Commit
   messages and trailers as AGENTS.md section 7 (Freebuff/Codebuff: `Agent: Freebuff`); the pre-commit hook runs.
7. Run the touched tests, then `npm.cmd test` once.
8. Merge with the repo's usual merge commit: `gh pr merge <n> -R PongooDev/Core-Backend --merge`.
9. Comment on the PR: what you changed and why, and what was verified.
10. Fixes still due on main: make them now (`fix-backend-issue` from step 5).
11. Restart the owner's 5595 backend on the new main (`restart_backend`, or the `restart-live-backend` skill).
12. Remove the worktree (`cmd /c rmdir node_modules` first if it is a junction). Write anything unfinished in
    `HANDOFF.md`.

Done when: the PR is merged (or rejected with a reason), every rework is on main, tests pass, 5595 runs the new main,
and the PR comment lists what changed.
