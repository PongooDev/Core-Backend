---
name: pre-commit-review
description: Use before every Core-Backend commit (and before pushing) to self-review the staged change against the project rules and the past mistakes - right build, per-build data, older builds unchanged, evidence comments, tests, scope, secrets, commit message and trailer.
---

# Pre-commit self-review (Core-Backend)

Run `git diff --cached` (and `git diff`) and answer every question. Any "no" blocks the commit until fixed or
explained in the message. Rules: AGENTS.md sections 1, 2 and 8.

**Scope**
1. Only this change's files staged? (Never `git add -A`; no other agent's files, no `data/`, logs, scratch output,
   `.claude/settings.local.json` or `.freebuff/`.)
2. Was `H:\CoreWork\HANDOFF.md` read, and does this commit not undo work listed there?

**Right build, right data**
3. Was the reporter's own build checked, by its CL (its paks, SDK or exe), not a neighbouring build's?
4. If the issue gave a list (dates, items, modes), is every item implemented as listed, or the difference explained?
5. Are enum numbers, event names and data taken per build, not from one table for all builds?
6. Do all other builds answer exactly as before, unless the change is meant for them? Is that pinned in a test?

**Code**
7. Does each new fact have its source in a comment (build, CL, address, asset, patch notes; `🟡` for Core's choices)?
8. Are hotfix ini URL values quoted (`Key="http://..."`)?
9. No pak AES key anywhere (code, tests, fixtures, messages)? No tokens, passwords or personal data?
10. Nothing that only a client change could make work, presented as a fix?

**Testing**
11. Did the test files covering the change pass? (No full local run; CI runs the suite on push, check it is green.)
12. Did no test or test backend use port 5595 or the main checkout's `data` folder?
13. Does the message say what was verified (tests, a test backend, a real client) and what not?

**Message**
14. Subject `<area or build> (#<issue>): <change>`; body: cause, evidence, change, builds affected, verification.
15. Trailer: Freebuff/Codebuff end with `Agent: Freebuff` and no Claude Co-Authored-By line; Claude uses its own.

**The hook.** `tools/githooks/pre-commit` runs on `git commit` (`git config core.hooksPath tools/githooks` turns it on
in a clone that lacks it). It blocks keys, secrets, files over 5 MB, `node_modules` and other build output, binaries,
game files and agent-local files, and syntax-checks staged `.js`/`.mjs`. Never commit with `--no-verify`; fix what it
reports and commit again.

After the commit: rebase on `origin/main`, push, comment on the issue naming the commit, restart the owner's 5595
backend on the new main (`restart_backend`, or the `restart-live-backend` skill), and record anything unfinished in
`H:\CoreWork\HANDOFF.md`.
