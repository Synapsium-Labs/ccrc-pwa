# The grandfathered D-number collisions: who keeps each number, and what moves

- **D-8562 (2026-11-12)** — `dnumber-collisions-resolution`: the 16 numbers in `deviation-refs.test.ts`'s `GRANDFATHERED` set (72, 128–135, 137–141, 145, 171) are resolved by one rule, the earlier merged definition keeps the number; every later definition gets a number ISSUED by the ledger (`POST /api/ledger/deviations`) and carries a `was D-<old>` alias, and every citation of it moves with it. A line that only cites a number in the definition shape is reworded so it no longer reads as a definition, and needs no number. This plan is the table; the numbers are issued and the renumbering is run as a follow-up, which also shrinks `GRANDFATHERED` in the same change.

## Why

`deviation-refs.test.ts` grandfathers 16 pre-allocator numbers that two plans define with two different subjects.
The set may only shrink, and every member must still collide. Resolving the collisions is what shrinks it. This
plan measures both sides of each one and names every citation the renumbering must change, so the follow-up is
mechanical once the numbers are issued.

Measured at `origin/main` `ab89d6ff5`. File:line references below are snapshots of that commit.

## How the keeper was chosen

The order is the order the definitions reached `main`'s first-parent history (`git log --first-parent origin/main
-S '<the definition line>' -- <plan>`):

| Plan | Merged by | Reached `main` |
|---|---|---|
| `2026-08-15-stage2b-ccrc-cli-and-doctor.md` | #51 | 2026-08-16 17:54 +01:00 |
| `2026-08-18-stage2d-installer.md` | #62 | 2026-08-19 15:16 +01:00 |
| `2026-08-20-stage3a-auth.md` | #72 | 2026-08-20 23:33 +01:00 |
| `2026-08-20-regset-atomic-write.md` | #73 | 2026-08-21 03:16 +01:00 |
| `2026-08-21-stage3b-exposure.md` | #78 | 2026-08-21 20:06 +01:00 |
| `2026-08-21-stage4-release.md` | #83 | 2026-08-21 21:57 +01:00 |
| `2026-08-22-ws-reap-containment-and-drift.md` | #94 | 2026-08-23 01:04 +01:00 |
| `2026-08-23-stage5-oss-polish.md` | #97 | 2026-08-23 10:14 +01:00 |

So `stage3a-auth` keeps every number from 128 to 145 that it defines, and `regset-atomic-write`, `stage3b-exposure`
and `stage4-release` move theirs. The stage-4 plan said so itself (its ledger header: "renumber against 3b's ledger at
review time if it merges first"); it never happened.

## What the scanner sees, and what it does not

`ENTRY` in `deviation-refs.test.ts` needs an em-dash on the definition's first line. The stage-3b and stage-4 ledgers
spell most entries `- **D-<n>** (Task k): …` with no em-dash on that line, so `ENTRY` sees only some of them. The
allocator's `definitionsIn` (`server/src/coord/ledger.ts`) sees all of them, and the era-scoping test in
`deviation-refs.test.ts` already derives the rest as the sub-211 set `{73, 142, 143, 144}` (the
`SUB-211 COLLISIONS:` marker line in `ledger-crosstree.test.ts`). The table below covers both, because they are the
same three plans colliding over the same block:

- **Scanner-visible (the 16):** 72, 128–135, 137–141, 145, 171.
- **Same block, `ENTRY`-blind:** stage-3b's 139, 142, 143 and stage-4's 139–144 (all four of 139, 140, 141 are
  three- or four-way collisions, not two-way).
- **Same block, not a definition anywhere:** 136. `regset-atomic-write` defines it (`mv -fT` is GNU-only);
  `stage3a-auth`'s code claims it with no ledger entry (`stage3a-auth.md:126`: "D-136 is claimed by
  `server/src/auth/credentials.ts` from Task 8 and has no ledger entry here"). Neither scan can see a code-only
  claim. The written definition keeps the number; the code-only claim moves, and the follow-up adds its definition.
- **Not collisions at all:** 72, 73 and 171. The second "definition" is a citation in the definition shape: stage-2d's
  deferred-items list restates 72 and 73, and stage 5's note records that 171 was landed twice and was already
  renumbered then. These need a rewording, not a number.

## The table

`Nk` is the k-th number of one block the follow-up has issued by the ledger, in table order. "Keep" lines are
unchanged. Citations not listed are citations of the keeper and stay as they are (checked one by one: every
auth, passkey, doctor, `ccrc passwd`/`token`/`expose`, gate, cookie, config and "a fresh install ends green"
citation in `server/`, `pwa/`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/` and the later plans and specs is
`stage3a-auth`'s).

### Rewordings (no number)

| Number | Definition A (keeps) | Line B (a citation in definition shape) | Change |
|---|---|---|---|
| 72 | `2026-08-15-stage2b-ccrc-cli-and-doctor.md:54` (the roster-divergence detector is blind to D-69's class) | `2026-08-18-stage2d-installer.md:538` (deferred list: "roster fingerprint blind to `secretsFile` semantics") | Reword so the line does not open with the number, e.g. `- Still open, own blast radius: **D-72** (…) and **D-76** (…).` |
| 73 | `2026-08-15-stage2b-ccrc-cli-and-doctor.md:56` (the fleet host has no `ccrc.env`) | `2026-08-18-stage2d-installer.md:539` (deferred list) | Same: `- Still open: **D-73** (…)`. Not in `GRANDFATHERED`; it is in the sub-211 marker. |
| 171 | `2026-08-22-ws-reap-containment-and-drift.md:206` (containment is no longer selected by `@{upstream}`) | `2026-08-23-stage5-oss-polish.md:46` ("D-171 was landed twice", the note recording that the gitignore deviation became D-196) | Reword so the line does not open with the number, e.g. `- **Landed twice: D-171**, by PRs …`. |

### Renumbered definitions

| New | Number | Definition A (keeps) | Definition B (moves) | Citations of B that change |
|---|---|---|---|---|
| N1 | 128 | `stage3a-auth.md:129` (the Origin check stopped at the socket, leaving CSRF open) | `regset-atomic-write.md:1146` (m1's second half, `server/test/` outside single-definition's ROOTS) | `programs/registry-durability.md:67` |
| N2 | 129 | `stage3a-auth.md:140` (the cost of D-128) | `regset-atomic-write.md:1156` (the wave's smallest change produced its only Critical) | `regset-atomic-write.md:1242`, `:1243`, `:1245`, `:1332` (the template comment); `programs/registry-durability.md:69` |
| N3 | 130 | `stage3a-auth.md:144` (`CCRC_PORT` never got the empty-string rule) | `regset-atomic-write.md:1169` (a defect in this plan, ruled in the implementer's favour) | none outside its entry |
| N4 | 131 | `stage3a-auth.md:150` (`assert/start` was unmetered) | `regset-atomic-write.md:1176` (moving `_pr_py`'s lock off `.uuid` broke a test) | none outside its entry |
| N5 | 132 | `stage3a-auth.md:158` (absent and unreadable were one state) | `regset-atomic-write.md:1184` (`put()` re-raises `OSError`; a `$REG` directory without write) | `regset-atomic-write.md:1318`; `ccd/ccd:6536` |
| N6 | 133 | `stage3a-auth.md:165` (`add()` returned an overloaded boolean) | `regset-atomic-write.md:1190` (`_reg_set`'s `printf` silences its own stderr) | none outside its entry |
| N7 | 134 | `stage3a-auth.md:169` (`decodeB64url`'s alphabet test was unmeasurable) | `regset-atomic-write.md:1197` (a residual overstatement in `watch.ts`'s sentence) | none outside its entry |
| N8 | 135 | `stage3a-auth.md:173` (`passkeySupported()` probed Level 1 for a Level 2 need) | `regset-atomic-write.md:1206` (`_reg_set` now succeeds where it refused, and rewrites the mode) | `programs/registry-durability.md:69` (`D-122/D-135`) |
| N9 | 137 | `stage3a-auth.md:180` (the `hashLine` pair fails earlier than the parser) | `regset-atomic-write.md:1242` (D-129 recurred) | `programs/registry-durability.md:69` (`D-129/D-137`) |
| N10 | 138 | `stage3a-auth.md:191` (`ccrc passwd` refuses to overwrite a secret file it cannot read) | `regset-atomic-write.md:1261` (a dot-leading project id aliases ccd's hidden registry files) | `regset-atomic-write.md:1311` (the D-139 entry's opening); `programs/registry-durability.md:65` (the range `D-121..D-138`, which is no longer contiguous: reword as a list) |
| N11 | 139 | `stage3a-auth.md:201` (the `auth` check passes an un-armed box; a fresh install ends green) | `regset-atomic-write.md:1311` (`_pr_py`'s pr-state lock residual, disclosed not closed) | `ccd/ccd:6544`; `server/test/ccd-bounded-reads.test.ts:530` |
| N12 | 139 | (as above) | `stage3b-exposure.md:369` (the tty refusal is the `cmd_passwd` sentence's shape) | `stage3b-exposure.md:367` (`(D-139 onward; …)`, becomes the new range) and `:30` (`continues from D-138`) |
| N13 | 140 | `stage3a-auth.md:212` (doctor measures the secret with the server's parser, prints no byte) | `stage3b-exposure.md:378` (the timer enable is degraded, not fatal) | none outside its entry |
| N14 | 141 | `stage3a-auth.md:222` (the trap broke the abort) | `stage3b-exposure.md:388` (the D-149 sweep's parenthetical is stale) | `stage3b-exposure.md:302` |
| N15 | 142 | `stage3a-auth.md:233` (`read` without `IFS=` trims the passphrase) | `stage3b-exposure.md:395` (the rename condition needs the box's current rpId) | `stage3b-exposure.md:293` |
| N16 | 143 | `stage3a-auth.md:240` (`CCRC_AUTH_SECRET_PATH` was a silent no-op) | `stage3b-exposure.md:403` (the `:508-516` region held one bullet) | `stage3b-exposure.md:343`, `:348` |
| N17 | 139 | (as above) | `stage4-release.md:267` (`ccd version`'s python3 reader of `build.json`) | `stage4-release.md:78`; the ledger headers `:30` and `:264` (`D-139 onward`) |
| N18 | 140 | (as above) | `stage4-release.md:287` (the "SKIPS `ccrc.service` …" clause) | none outside its entry |
| N19 | 141 | (as above) | `stage4-release.md:334` (the release artifact must carry the identity it installs) | `stage4-release.md:186`, `:372` |
| N20 | 142 | (as above) | `stage4-release.md:352` (spine-then-report) | none outside its entry |
| N21 | 143 | (as above) | `stage4-release.md:395` (the `settings.json` predicate stays defined once) | none outside its entry |
| N22 | 144 | `stage3a-auth.md:250` (the boot refusal was the last path for a byte of `auth.scrypt`) | `stage4-release.md:407` (`ccd-cap-scopes` is in the remove set) | none outside its entry |
| N23 | 145 | `stage3a-auth.md:270` (a shipped auth feature with no way to sign out) | `stage4-release.md:465` (`deploy-verify.test.ts` red at a bare `indexOf('else')`) | `agent/test/deploy-verify.test.ts:1205`, `:1569`, `:2475` |
| N24 | 136 | `regset-atomic-write.md:1226` (`mv -fT` is GNU-only), the only written definition | `stage3a-auth`'s code-only claim (the failed write rolls the row back, so the answer is true) | `server/src/auth/credentials.ts:112`, `:304`; `server/test/auth-passkey.test.ts:1192`; `stage3a-auth.md:126` (replace the "claimed … has no ledger entry" note with the N24 definition) |

All plan paths in the table are under `docs/superpowers/plans/`; `programs/` is `docs/superpowers/programs/`.

Left as they are, because they are dated history about the collision or a range, not citations of a moved entry:
`2026-08-23-stage5-oss-polish.md:57-58` (records that 128 was defined twice), `2026-09-02-program-leverage-wave8-f8.md`
(the `SUB-211 COLLISIONS` lines and the `D-108..D-140` renumber) and `specs/2026-08-21-account-provisioning-design.md:896`.

## Numbers needed

- **24 issued numbers** for the whole block: 11 for `regset-atomic-write` (128–135, 137–139), 5 for
  `stage3b-exposure` (139–143), 7 for `stage4-release` (139–145) and 1 for `stage3a-auth`'s code-only 136.
- **18 is the floor** for emptying `GRANDFATHERED` with the tests green: rows N1–N14, N17–N19 and N23.
  Moving only the `ENTRY`-visible lines is not enough: the era-scoping test derives its set from `definitionsIn`
  minus `GRANDFATHERED`, so once 139, 140 and 141 leave the set, stage-3b's 139 and stage-4's 139–141 would join the
  derived sub-211 set and red it. Rows N15, N16, N20–N22 and N24 clear the rest of the block's real collisions.
- **0 numbers** for 72, 73 and 171: rewordings.

## What the follow-up changes besides the plans

- `server/test/deviation-refs.test.ts`: `GRANDFATHERED` shrinks to empty in the same change (its "still collides"
  test reds on any member that no longer collides).
- `server/test/ledger-crosstree.test.ts`: the `SUB-211 COLLISIONS:` marker loses 142, 143, 144 (rows N15, N16,
  N20–N22) and 73 (the rewording), and the comment above it is updated.
- The era-scoping test in `deviation-refs.test.ts` asserts the derived set is non-empty ("a scan that finds none
  asserts nothing"). With every collision resolved, the derived set is empty, so that premise must be restated in
  the same change, for example as a pin that the marker and the derivation agree and are both empty.
- Every new definition line keeps its original date and adds the alias, e.g. `(2026-08-20, survey; was D-128)`, so
  the old number still finds its entry.
- The numbers are issued by the ledger before they are written: a number written without being issued raises the
  floor and never enters the ledger.

## Deviations found

- The task named a 2026-12-19 date after which `deviation-refs.test.ts` turns red. At `ab89d6ff5` the test has no
  date gate: `GRANDFATHERED` is checked only for "still collides" and "below 211". The deadline is not in this tree.
- The grandfathered set undercounts the block: three of its numbers (139, 140, 141) are three- or four-way
  collisions, and 136, 142, 143 and 144 collide too (136 through a code-only claim neither scan can see).
