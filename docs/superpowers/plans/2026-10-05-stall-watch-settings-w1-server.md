# Stall watch settings wave 1: the server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: dispatched as a wave, `ccrc-worker`; to execute,
> `superpowers:subagent-driven-development` with `superpowers:test-driven-development` for every test step. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Programme:** `stall-watch-settings`, **wave 1 of 2** (ledger `docs/superpowers/programs/stall-watch-settings.md`,
opened by the coordinator at its first run). Deploy class: **server**. One PR from a fresh child workspace. W2 (the PWA
section) depends on this wave being merged.

**Goal:** Put the stall watch's arming and its quiet time under one stored choice that the server owns, and apply it
through one resolver that never throws. The choice is one ladder level, or "Follow the fleet box's files", plus one
quiet time from 30 min to 12 h. The resolver feeds both the stall sweep and the mail gate. The choice is exposed
behind a session-only door, `GET`/`POST /api/coord/stall-watch`. The server decides whether a write needs a confirm
and records every change in the activity feed. W1 ships no PWA. The door can be reached with a session-gated `curl`,
and a write that needs a confirm answers 409 with its effect and key. The migration's seed is today's behaviour
(`follow`, built-in quiet time). So nothing changes on deploy until a level or a quiet time is written, with one
named exception: the busy clock's grace when the mail gate moves into busy delivery while the server runs (spec goal
4, D-4024).

**Architecture:** Rings by imports, as `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` defines them.
- **L0, `shared/api.ts`.** Literals, types and one guard, appended as ONE hunk at the end of the file after
  `MAIL_REPLAY_MS`: the level texts, the stage texts, the view and request types, and every section string. It
  imports nothing.
- **L1, `server/src/coord/stallsettings.ts`, new and pure.**
  - The ladder, the bounds, the step and the window.
  - The parse, which takes the whole row or none of it.
  - The resolver, `stallLevelOf`, the stages, the Next step, files-exceed and the held flags.
  - The write path: decide, the projection, the effect, its key and the feed body.
  - The notice counts and the busy clock.
  - Its value imports are only `shared/api.js`, `./stall.js` and `../turnidle.js`.
- **L1, `stall.ts`.** It gains the quiet-time reader (`stallQuietMs`, used at r1, the dialog cap and the backoff
  base), the backoff ceiling, `StallArming.busySince` with the bounded `stallIdleStart` change, and `stallArmHasRung`.
  It spells no marker.
- **L3, `schema.ts` and `store.ts`.**
  - One migration at the measured next slot. It creates `stall_settings`, seeds the row `(1, 'follow', NULL, 0)` and
    adds `run_events_by_at`.
  - Three store methods. Each read is non-throwing and runs under `setReadBigInts(true)`. The write is one
    synchronous transaction that writes only over the row the route measured.
- **L4, `watch.ts` and `coord/routes.ts`.**
  - `watch.ts`: both sweeps call one `stallResolveNow`, which never throws. The mail sweep applies the resolved mode
    and moves `lastApplied` and `busySince`. The stall sweep threads the quiet time into `judgeStall`, and
    `stallFallback()` reports a fallback.
  - `coord/routes.ts`: the view builder never answers 500. The POST refuses an unreadable pre-read, measures the
    effect against the listing it just took, answers 409 with the key, re-measures once on `conflict`, and writes the
    feed row with its actor. The routes decide nothing that L1 does not answer.
- **Docs:** README, `CLAUDE.md` and the parent stall-watch spec say that a level chosen in Settings overrides the
  arming markers, but never `stall-watch-disabled`, `mail-disabled` or `mail-gate-strict`. A prose suite pins those
  sentences.
- **Unchanged:** the PWA, agent, `ccd`, installer, `FLEET_PROTO`, `CoordStatus`, marker writers and arming. No
  marker gains a writer.

**Tech Stack:**
- TypeScript (ESM).
- Fastify with `logger: false`, so a server log is `console.warn('ccrc-server: …')`.
- `node:sqlite` `DatabaseSync`, synchronous, with `setReadBigInts`.
- vitest under `server/test/`.
- Node `>=22.13.0`.
- python3 or bash for scratch mutation runners, which are never committed.

**Spec:** `docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md`, rev 3.2, **APPROVED by the operator
2026-10-05 17:46 UTC** ("Spec is good"; the §19 defaults stand as written), at `51aa5f0d8`. The sections that govern
this wave:
- §5–§12 (the ladder, the resolver, the quiet time, storage, wiring, the routes, the counts, the wire);
- §14 (invariants), §15 (failure modes), §16 (departures), §17 (the mutation table);
- §18 W1 (scope), and §20 (residue, settled below).

**Measured at `origin/main` `77f8d63a5`** (2026-10-05). Every line number below and in the tasks is a HINT at that
commit. Every edit quotes the text it replaces, and each quoted text occurs exactly once in its file (measured), so
find each edit by content.
- **The prototype.** Every task was built and measured in a scratch worktree of `77f8d63a5` (branch `proto/sws-w1`,
  gitignored under `.superpowers/sdd/stall-watch-settings/proto`), one commit per task:

  | Task | Commit |
  |---|---|
  | 1 | `2fb0123f7` |
  | 2 | `bb5bee7b4` |
  | 3 | `bc80d266d` |
  | 4 | `8d40b4552` |
  | 5 | `65b4c6c84` |
  | 6 | `fa1241e6e` |
  | 7 | `ad2155ff4` |

- **What the counts are.** The red and green counts and every mutation table are MEASURED on that chain, not
  derived. The prototype's diff against `77f8d63a5` is 28 files, +3,365 / −87.
- **Main has moved since then** (measured 2026-10-05). `origin/main` is now `d12b5aba0`, two commits later:
  - `6f6923cd8` touches only child-reclamation docs.
  - `d12b5aba0` (#283) re-measures README (5684 → 5729 lines) and already moves `CLAUDE.md`'s README size claim from
    "~5600" to "~5700".
- **The merge onto `d12b5aba0`.** `git merge-tree --write-tree origin/main ad2155ff4` exits 0. The merged README is
  5743 lines and `CLAUDE.md` reads "~5700". Task 7's size-claim hunk is therefore already on `main`: skip it when its
  quoted "~5600" text is absent. Every other quoted README and `CLAUDE.md` line still occurs exactly once on
  `d12b5aba0`.

## Preconditions (check before the baseline; stop and report if one fails)

1. **The spec is on `origin/main`.** `git ls-tree origin/main docs/superpowers/specs/2026-10-05-stall-watch-settings-design.md`
   prints one line. At planning it printed nothing: the spec sits on the coordinator's branch at `51aa5f0d8`.
2. **This plan is on `origin/main`.**
   - `git ls-tree origin/main docs/superpowers/plans/2026-10-05-stall-watch-settings-w1-server.md` prints one line.
   - Why it matters: this plan alone defines the thirteen numbers in its `## Deviations found`, and Tasks 1–6 cite
     them in tracked comments. Until it lands, `deviation-refs.test.ts`'s floor row is red: a tracked file names a
     D-ref above the definition-derived high-water. The prototype showed that red, with "routes.ts names D-4034" as its evidence.
3. **The migration slot is 16 → 17, measured.**
   - `git show origin/main:server/src/coord/schema.ts | grep -cE '^  // ── [0-9]+: user_version [0-9]+ -> [0-9]+ ─'`
     prints `16`.
   - The last banner is `// ── 16: user_version 15 -> 16`.
   - At planning, no branch on `origin` carried a `user_version 16 -> 17` entry (every remote head was scanned).
   - If the count is not 16, the entry moves to the next free slot, and the slot is re-measured before the PR and
     again before merge. See "If this PR is overtaken".
4. **The claims (worker clause 11).** `POST /api/claims` with every path in the File Structure table below, all or
   nothing.
   - A 409 names the holder: mail them through its `mailHint`, and work only what is uncontested.
   - Open PRs that touched these paths at planning:
     - #284 (delegation broker W1): `README.md`.
     - #248 (landing-order W3): `README.md` and `server/test/coordinator-skill.test.ts`.
     - #190 and #152: `shared/api.ts`.
     - #40 (automations, stale since 2026-09-11, on a branch that already took slot 11): `schema.ts`, `store.ts`,
       `watch.ts`, `auth/gate.ts`, `auth-gate.test.ts`, `coord-db.test.ts`, `asks-store.test.ts`, `mail-routes.test.ts`
       and `CLAUDE.md`.
   - None of these blocks the start. They are named so that a 409 is expected rather than a surprise.
5. **This workspace's branch starts from current `origin/main`** (a fresh child does). Run the probe
   `git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD`; it exits 0. Then take the baseline.

## Baseline (the step before Task 1)

Run each suite alone, in the FOREGROUND, from `server/`, with a timeout of at least 600000 ms. Keep only the `Tests`
line.

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/single-definition.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/stall-vocabulary.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/turnidle.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/topology-clean.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/mail-routes.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/stall-verdict.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/stall-backoff.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/stall-session.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/stall-sweep.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/mail-sweep.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/stall-store.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/coord-store.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/coord-db.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/asks-store.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/auth-gate.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/coord-pause-route.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/box-token-census.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/coordinator-skill.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/worker-skill.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/reviewer-skill.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/pools-prose.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/readme-holds.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/typecheck-tests.test.ts | grep -E '^ +Tests '
git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo tsc-ok
```

Expected counts. "Base" is `77f8d63a5`, measured in the prototype unless marked *derived*. A derived count is the
measured after-wave total minus the rows the prototype added. "After W1" is measured on `ad2155ff4`.

| Suite | Base | After W1 |
|---|---|---|
| single-definition | 274 | 274 (unedited) |
| stall-vocabulary | 179 | 179 (unedited) |
| turnidle | 54 | 54 (unedited) |
| topology-clean | 55 | 55 |
| mail-routes | 59 | 59 (union edited, no row added) |
| stall-verdict | 301 | 309 |
| stall-backoff | 17 *derived* | 33 |
| stall-session | 93 *derived* | 98 |
| stall-sweep | 109 | 117 |
| mail-sweep | 104 | 115 |
| stall-store | 68 | 68 |
| coord-store | 186 | 186 |
| coord-db | 68 *derived* | 71 |
| asks-store | 28 | 28 (version pin moved) |
| auth-gate | 158 | 160 |
| coord-pause-route | 20 *derived* | 20 |
| box-token-census | 23 | 23 (unedited; green after the `CLAUDE.md` edit) |
| coordinator-skill | 160 | 161 |
| worker-skill | 51 | 52 |
| reviewer-skill | 14 *derived* | 15 |
| pools-prose | 27 | 27 |
| readme-holds | 17 | 17 |
| typecheck-tests | 12 | 12 |
| deviation-refs | 31 *derived*, green | 31, green once precondition 2 holds |
| the citation instrument | `7 passed \| 328 skipped (335)` | the same |
| new: stall-settings | — | 114 |
| new: stall-settings-store | — | 40 |
| new: stall-settings-route | — | 37 |
| new: stall-settings-prose | — | 15 |

Record every Base line in the wave-done mail.
- If `main` has landed rows in any of these suites since `77f8d63a5`, the totals here are that commit's. Measure
  `main`'s, and expect every After total to rise by the same amount.
- A red at base in a known load flake (`session-hook`, `typecheck-tests`, `pr-sweep`, `ccd-ws-gc`,
  `ccd-session-state` or `ccd-bounded-reads`) is re-run in isolation before it is called a break.

Mutation instruments live outside the tree, in `INSTR = <repo>/.superpowers/sdd/2026-10-05-stall-watch-settings-w1-server/`
(gitignored), and are never committed. A mutation is applied to a COMMITTED tree, measured, and restored from `HEAD`.
After each one, `git status` must be clean.

## Global Constraints

- **The seed is today's behaviour** (`follow`, `quietMs NULL`). W1 changes nothing until a level or a quiet time is
  written. The one exception is the busy clock's grace (goal 4, §14 item 14).
- **No marker gains a writer.** The server creates and removes no registry file, and the no-writer pins in
  `single-definition.test.ts` stay unedited and green (§14 item 1).
- **No new ccd verb and no agent change.** `EXEC_COMMANDS` stays `['tmux','ccd']` (§14 item 2).
- **The mail-gate marker names stay spelled in `turnidle.ts` alone.** `stall.ts` and `stallsettings.ts` spell no
  marker on a code line, and assemble none from pieces (§14 item 3).
- **L0 imports nothing.** The new `shared/api.ts` members are ONE hunk appended after `MAIL_REPLAY_MS` at the end of
  the file, so README's `api.ts` anchors do not move (§12, §17).
- **`stallsettings.ts` is L1.** It has no `node:` import, no `require` or dynamic import, and no `Date.now` or
  `new Date`. Its value imports come only from `shared/api.js`, `./stall.js` and `../turnidle.js` (§14 item 5).
- **The kill switches fail shut.** `stall-watch-disabled` restores the box arming wholesale. `mail-disabled` passes
  through. `mail-gate-strict` keeps its precedence and holds the wave-2 step (§6.3, §14 items 6–7).
- **A stored row applies whole or not at all** (§14 item 19).
- **Absent and unreadable stay separate words from the store to the wire.** `'default'`, never `null`, means the
  built-in. `{measured: false}` is never `off` (§14 item 11).
- **`coord.db` stays synchronous.** The migration refuses to start rather than open empty, and its slot is measured,
  never assumed (§14 item 8).
- **The door is session-only.** It has one `SESSION_ONLY` member, takes no box token, and leaves `UNGATED`
  unchanged. No skill names the door (§10, §14 item 9).
- **`setStallSettings(` appears on a code line only at its definition and in the POST handler.** SQL that writes
  `stall_settings` appears only in `schema.ts` and `store.ts` (§14 item 18).
- **`stallResolveNow` never throws**, and its catch calls nothing that can throw. The view builder never answers 500
  (§14 item 20).
- **The confirm is the server's.** It is decided at the write and keyed to the effect and `updatedAt`. Nothing here
  gives the PWA a ladder (§14 item 21).
- **The wire is additive.** `FLEET_PROTO`, `CoordStatus` and every frame are untouched, and no WebSocket frame is added
  (§4, §14 item 10).
- **No other timing becomes configurable.** `STALL_QUIET_MS` stays the one built-in, and its constants pin is
  unedited (§4, §14 item 12).
- **No install-time configuration.** No `CCRC_STALL_*` key, and no `deploy/ccrc.env.example` or `loadConfig` change
  (§4).
- **Server logs** go through `console.warn('ccrc-server: …')`, never `req.log` (§14 item 16).
- **No device word and no device branch** in new server code, comments or prose (§2, M29).
- **Mutation-table discipline.** Every guard ships with a row measured red when it is deleted or mutated. A comment
  is not a guard (§14 item 17).
- **How tests run.** From `server/`, in the FOREGROUND, with a timeout of at least 600000 ms, one file per command:
  `./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`.
- **Deviation numbers.** Only the thirteen defined under "Deviations found" are written with their `D-` prefix.
  Never write a range or a placeholder. The coordinator numbers any further departure at wave-done.
- **Commit on this workspace's own branch** (`ws/<slug>`), never a feature branch. Absorb `origin/main` only on
  worker clause 16's triggers, with `git merge`.
- **This repo is public.** No account label, host name, live session id, real pool name or docserver URL goes into
  code, tests, commits or prose.
- **Out of scope:** `pwa/` (W2), the Notifications row's label (W2), arming or disarming any marker, and every other
  stall constant.

## Review Focus

1. **A chosen level never beats the fleet box's kill switches or strict gate, and Follow is exactly today.**
   - Under `stall-watch-disabled` the box arming comes back whole (M1). Off is never read while busy delivery is on
     (M1b). `mail-disabled` passes through every chosen arm (M2).
   - Strict wins the mail gate and holds the wave-2 step (M3, M3b, D-4023).
   - `follow` returns the box arming object itself, over all 2^8 file combinations (M4).
   - Pinned by: Task 1, `stall-settings.test.ts` (M1, M1b, M2, M3, M3b, M4, M23); Task 5, `stall-sweep.test.ts` (M2's
     held rung, M4 at boot with `mail-disabled`) and `mail-sweep.test.ts` (M3: strict plus a chosen `deliver`
     delivers no `busy`).
2. **A write that turns a stage on cannot land unconfirmed, including a stage the box holds.** The server measures
   the effect at the write, on two readings: as the box resolves now, and with the kill switch and strict gate
   removed (`heldByBox`). It also confirms leaving the further checks and lowering the quiet time. The key carries
   `updatedAt`, so a stale sheet gets 409 again, and the store writes only over the row the route measured.
   - Pinned by: Task 2, `stall-settings.test.ts` (M26 in every arm, M27's digest, M28, M15b).
   - Task 4, `stall-settings-store.test.ts` (M27b).
   - Task 6, `stall-settings-route.test.ts` (M26 answering 409 and writing nothing, M27a–e).
3. **A lost, unreadable, oversize or rolled-back row falls back whole to the files and the built-in, and says so.**
   A row applies whole or not at all (M25). Any level or quiet value out of vocabulary, prototype names included,
   reads `unreadable`; it is never clamped (M10, M11, M11b). An oversize integer survives the read through
   `setReadBigInts` (M11c). Files-exceed warns beforehand that losing a choice would re-arm more (M28).
   - Pinned by: Task 1, `stall-settings.test.ts` (M25, M11, M11b, M28).
   - Task 2, `stall-settings.test.ts` (M10 and M14 in decide).
   - Task 4, `stall-settings-store.test.ts` (M11c, M12, M12b–d).
4. **No false stuck-mail push when busy delivery begins, and today's clock at boot.**
   - `stallBusyClock` judges busy as the busy gate until the mail sweep has applied busy once after a non-busy mode.
     After that, mail-stuck's clock is `max(stop, busySince)`. A failed listing or the `mail-disabled` return moves
     neither field, and a restart starts both at `null` (D-4024).
   - Pinned by: Task 3, `stall-session.test.ts` (M8's three answers) and `stall-settings.test.ts` (`stallBusyClock`'s
     answers, M4 at boot).
   - Task 5, `stall-sweep.test.ts` (the three M8 raises, M8a's shared fixture, M4 at boot) and `mail-sweep.test.ts`
     (M8b's field moves).
5. **The settings path cannot stop a sweep, and the view still answers.** `stallResolveNow` catches a throwing store,
   resolver, latch or `message` getter, and falls back to today's expression with the built-in quiet time. Its catch
   calls nothing that can throw. The fallback clears on the next success, and the warn latch fires once per standing
   fault. The view builder's two `try`s keep the GET at 200, and a counting throw gives `notices.ok: false`.
   - Pinned by: Task 5, `mail-sweep.test.ts` (M20, M20b, M21).
   - Task 6, `stall-settings-route.test.ts` (M20a–g, M17b, M6a and M6b).

## File Structure

| File | Change | Task |
|---|---|---|
| `shared/api.ts` | one hunk appended after `MAIL_REPLAY_MS` at EOF (≈9097, +232): level, stage and section texts, view, effect and request types, `isStallLevelChoice`, `STALL_STORED_STATES` | 1 |
| `server/src/coord/stallsettings.ts` | **new**, L1 (535 lines at `ad2155ff4`): ladder, bounds, parse, resolver, stages, Next step, files-exceed, kebab guard (T1); decide, seed, no-op predicate, projection, effect, key, feed body, counts (T2); the busy clock (T3); `stallBoxHeld` (T6) | 1, 2, 3, 6 |
| `server/src/coord/stall.ts` | `stallArmHasRung` beside `STALL_RUNG_RECIPIENTS` (≈734–750) (T2); `StallInput.quietMs`, `stallQuietMs` at r1, the dialog cap and `stallBackoff`; `STALL_BACKOFF_CEILING_MS` after `BACKLOG_HORIZON_MS` (≈345); `StallArming.busySince`; `stallIdleStart`'s bound; §7's "2 h" comments (T3) | 2, 3 |
| `server/src/coord/schema.ts` | `MIGRATIONS[16]`, banner `17: user_version 16 -> 17`, after entry 16 (≈1163) | 4 |
| `server/src/coord/store.ts` | `StallSettingsWrite`, `StallObservationsRead`; `stallSettings()`, `setStallSettings()`, `stallObservationsSince()` | 4 |
| `server/src/watch.ts` | `STALL_SWEEP_MS`'s comment (≈192); `stallResolveNow`, `stallFallback()`, `lastApplied`, `busySince`, `lastFallback`, the warn latch and boot trace; both sweeps; `judgeStall`'s `quietMs` | 5 |
| `server/src/coord/routes.ts` | `GET`/`POST /api/coord/stall-watch` after the caps POST; the view builder, its latch and fault reason; the feed row with its actor; the `SESSION_ONLY` docstring | 6 |
| `server/src/auth/gate.ts` | the route-count numeral (≈8, 86 → 88) | 6 |
| `CLAUDE.md` | the box-token sentence (T6); the mail-gate bullet's override sentence and the `coord.db` loss list (T7); the README size claim is already on `main` (T7, skip) | 6, 7 |
| `README.md` | mail-gate paragraph (≈3825–3845), stall-watch paragraph (≈4074–4136), backoff sentence, busy and wave-2 runbooks (≈4261), strict runbook; +14 lines | 7 |
| `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md` | status-block pointer; §4.2's override clause (≈474); §10's "the PWA renders none" (≈839) and kill rules (≈874–876) | 7 |
| `server/test/stall-settings.test.ts` | **new**: 62 rows (T1), 106 (T2), 112 (T3), 114 (T6) | 1, 2, 3, 6 |
| `server/test/stall-settings-store.test.ts` | **new**, 40 rows | 4 |
| `server/test/stall-settings-route.test.ts` | **new**, 37 rows, including the M16b single-writer pin and the M29 device scan | 6 |
| `server/test/stall-settings-prose.test.ts` | **new**, 15 rows | 7 |
| `server/test/mail-routes.test.ts` | the kebab scan's thirteenth union, `isStallSettingsKebab`, and its failure message | 1 |
| `server/test/stall-verdict.test.ts`, `stall-backoff.test.ts`, `stall-session.test.ts` | the quiet-time sites, the ceiling and relation pins, the busy clock | 3 |
| `server/test/coord-db.test.ts`, `asks-store.test.ts` | version pins; the two whole-diff tests narrowed to their own entries; the new entry's own diff test | 4 |
| `server/test/stall-sweep.test.ts`, `mail-sweep.test.ts` | M4, M2, M8, M8a, M9c, M12; M3, M7, M8b, M20, M20b, M21, and a hoisted `vi.mock` of `stallsettings.js` | 5 |
| `server/test/coord-pause-route.test.ts`, `auth-gate.test.ts`, `coordinator-skill.test.ts`, `worker-skill.test.ts`, `reviewer-skill.test.ts` | the census edits (§14 item 9) | 6 |

**Deliberately unchanged** (each must stay green, unedited):
- the test suites `single-definition.test.ts`, `box-token-census.test.ts`, `stall-vocabulary.test.ts`,
  `turnidle.test.ts`, `pools-prose.test.ts` and `session-hook.test.ts`;
- `server/src/turnidle.ts`;
- everything under `agent/`, `ccd/` and `pwa/`;
- `deploy/`;
- `FLEET_PROTO` and `CoordStatus` in `shared/api.ts`;
- `UNGATED` and every count site's `FOUR`.

---

## Tasks

### Task 1: L0 wire types and texts, and the L1 settings core

**Model routing:** `sonnet`, effort `high`: transcription of a measured prototype (`proto/sws-w1` 2fb0123f7), plus a
mutation table.

**Files:**
- Modify: `shared/api.ts`: append one block at end of file, below `export const MAIL_REPLAY_MS = 600_000;` (≈9096, the
  last line). Nothing above that line moves (§12). The block holds `STALL_LEVEL_TEXT`, `StallLevel`, `STALL_LEVELS`,
  `StallLevelChoice`, `isStallLevelChoice`, `STALL_STAGE_TEXT`, `StallStage`, `STALL_STAGES`, `StallWatchStages`,
  `StallHeld`, `StallNextStep`, `StallWatchEffective`, `StallWriteEffect`, `StallConfirmRequired`,
  `STALL_NOTICE_TEXT`, `StallNoticeCount`, `STALL_STORED_STATES`, `StallStored`, `StallWatchView`,
  `StallWatchRequest`, and every text constant in §12's table (`STALL_FOLLOW_LABEL` … `STALL_SECTION_TEXT`).
- Create: `server/src/coord/stallsettings.ts` (L1). It holds `StallLadderRow`, `STALL_LADDER`, `STALL_QUIET_MIN_MS`,
  `STALL_QUIET_MAX_MS`, `STALL_QUIET_STEP_MS`, `STALL_NOTICE_WINDOW_MS`, `isStallQuietMs`, `StallSettingsRow`,
  `StallSettingsRead`, `StallSettingsParsed`, `parseStallSettings`, `StallBoxArming`, `stallBoxArmingOf`,
  `stallUnheldBoxOf`, `stallStages`, `armedStages`, `stallLevelOf`, `StallResolved`, `resolveStallWatch`,
  `stallNextStep`, `stallFilesExceed` and `isStallSettingsKebab`.
- Modify: `server/test/mail-routes.test.ts`: the `isStallKebab` import (≈20), the twelfth union's last line (≈831) and
  the failure message (≈832), in `it('every quoted kebab token in server/src/coord that looks like a code is
  declared')` (≈571).
- Test: `server/test/stall-settings.test.ts` (new): M1, M1b, M2 (L1 half), M3 and M3b, M4's property over all 2^8
  file combinations, M5, M11 and M11b (parse half), M11c (parse half), M19 control, M19b, M22, M23, M25, M28 (L1
  half), M30, the ladder and text pins, and the kebab rows.

**Interfaces:**
- Consumes, from `server/src/coord/stall.ts`: `STALL_QUIET_MS = 2 * 3_600_000` (≈302);
  `stallArmingOf(names: readonly string[]): StallArming` (≈129); `StallArming` (≈126); `STALL_MARKERS` (≈109, the
  test only).
- Consumes, from `server/src/turnidle.ts`: `type MailTurnMode = 'strict' | 'shell' | 'busy-shadow' | 'busy'` (≈61);
  `mailTurnModeOf(listing: readonly string[]): MailTurnMode` (≈78); `mailTurnReadsMark(mode: MailTurnMode): boolean`
  (≈89); and, in the test only, `MAIL_GATE_STRICT_MARKER`, `MAIL_GATE_BUSY_MARKER` and `MAIL_GATE_BUSY_SHADOW_MARKER`
  (≈67–74).
- Consumes, in the test only: `MAIL_DISABLED_MARKER` from `server/src/coord/rundefs.ts` (≈50), and the type
  `ReadFailure = 'absent' | 'unreadable'` from `shared/agent-protocol.ts` (≈650).
- Produces, L0 (`shared/api.ts`):
  ```ts
  export type StallLevel = 'off' | 'log' | 'check' | 'alert' | 'deliver' | 'all';   // keyof typeof STALL_LEVEL_TEXT
  export const STALL_LEVELS: StallLevel[];
  export type StallLevelChoice = StallLevel | 'follow';
  export function isStallLevelChoice(v: unknown): v is StallLevelChoice;
  export type StallStage = 'checks' | 'alerts' | 'busyDelivery' | 'busyGate' | 'wave2';  // keyof typeof STALL_STAGE_TEXT
  export const STALL_STAGES: StallStage[];
  export const STALL_STORED_STATES: readonly ['row', 'absent', 'unreadable'];
  export type StallStored = 'row' | 'absent' | 'unreadable';
  ```
  and the interfaces and text constants exactly as Step 4 spells them.
- Produces, L1 (`server/src/coord/stallsettings.ts`):
  ```ts
  export type StallLadderRow =
    | { readonly disabled: true }
    | { readonly disabled: false; readonly live: boolean; readonly escalate: boolean; readonly w2Live: boolean; readonly mailMode: 'busy-shadow' | 'busy' };
  export const STALL_LADDER: Readonly<Record<StallLevel, StallLadderRow>>;
  export const STALL_QUIET_MIN_MS: number;     // 30 min
  export const STALL_QUIET_MAX_MS: number;     // 12 h
  export const STALL_QUIET_STEP_MS: number;    // 30 min
  export const STALL_NOTICE_WINDOW_MS: number; // 48 h
  export function isStallQuietMs(v: unknown): v is number;
  export interface StallSettingsRow { readonly level: unknown; readonly quietMs: unknown; readonly updatedAt: unknown }
  export type StallSettingsRead =
    | { readonly kind: 'row'; readonly row: StallSettingsRow }
    | { readonly kind: 'absent' }
    | { readonly kind: 'unreadable'; readonly detail: string };
  export interface StallSettingsParsed {
    readonly stored: StallStored;
    readonly level: { readonly kind: 'follow' } | { readonly kind: 'chosen'; readonly level: StallLevel } | { readonly kind: 'unreadable'; readonly token: unknown };
    readonly quiet: { readonly kind: 'default' } | { readonly kind: 'set'; readonly ms: number } | { readonly kind: 'unreadable'; readonly value: unknown };
    readonly updatedAt: number | null;
  }
  export function parseStallSettings(read: StallSettingsRead): StallSettingsParsed;
  export type StallBoxArming = StallArming & { readonly mailDisabled: boolean; readonly mailMode: MailTurnMode };
  export function stallBoxArmingOf(names: readonly string[], mailDisabled: boolean): StallBoxArming;
  export function stallUnheldBoxOf(names: readonly string[]): StallBoxArming;
  export function stallStages(a: StallArming): StallWatchStages;
  export function armedStages(a: StallArming): StallWatchStages;
  export function stallLevelOf(a: StallArming): StallLevel | 'custom';
  export interface StallResolved {
    readonly arming: StallBoxArming; readonly quietMs: number; readonly quietSource: 'chosen' | 'default';
    readonly chosen: StallLevel | null; readonly levelSource: 'chosen' | 'files' | 'held';
    readonly effective: StallLevel | 'custom'; readonly files: StallLevel | 'custom'; readonly held: StallHeld;
  }
  export function resolveStallWatch(box: StallBoxArming, settings: StallSettingsParsed): StallResolved;
  export function stallNextStep(arming: StallArming, chosen: StallLevel | null): StallNextStep;
  export function stallFilesExceed(box: StallArming, resolved: StallResolved): boolean;
  export function isStallSettingsKebab(token: string): boolean;
  ```
  Later tasks of this wave add `stallSettingsAfter`, `stallWriteEffect`, `stallNeedsConfirm`, `stallEffectKey`,
  `stallBusyClock`, `stallSettingsChange`, `decideStallSettings` and `stallNoticeCounts` to the same file, and append
  their rows to the same suite.

**Decisions this task takes (each measured in the prototype):**
- **`stored` is derived, never spelled as a pair.** §12 writes `stored: 'row' | 'absent' | 'unreadable'` inline. Spelled
  that way, `single-definition.test.ts` reds twice (measured: `does not respell io.ts read-failure pair as the skill
  vocabulary` and `is declared in exactly one file, and that file is shared/agent-protocol.ts`), because the pair is
  `ReadFailure`'s and lives in `shared/agent-protocol.ts` alone. `shared/api.ts` cannot import it: its three type
  imports are pinned (`peers-claims-l0.test.ts`), and an import at the top would also move every README anchor into
  the file. So the block follows `STAMP_READS`' precedent: `STALL_STORED_STATES = ['row', 'absent', 'unreadable']`,
  `StallStored` derived from it, and a compile-time equality `Exclude<StallStored, 'row'>` = `ReadFailure` in the
  suite. The wire type is unchanged.
- **The kebab union lands here, not later.** `STALL_LADDER` spells `'busy-shadow'` in `server/src/coord`, which
  `mail-routes.test.ts`'s scan reads, so the suite reds at this commit without it. `isStallSettingsKebab` ships now
  with all three §10 words (`busy-shadow`, `confirm-required`, `flag-off`), and the scan gains its thirteenth union.
  The later tasks that spell `'confirm-required'` and `'flag-off'` need no scan edit.
- **One conversion from a ladder row to an arming** (§20 residue: "`stallNextStep` … needs a `StallLadderRow` turned
  into an arming; no conversion is named"). The private `stallRowArming(run)` builds
  `{ disabled: false, live, escalate, w2Live, mailDisabled: false, mailMode }`. The resolver's `free` and
  `stallNextStep`'s next level both read through it, so the two cannot disagree. A next row that is `off` cannot
  occur (`off` is first in ladder order); the narrowing answers it `waitsOn: []`.
- **The Next step under a held reading stays as §10 states it** (§20 residue: Follow under the kill file offers Log
  only; Check chosen under strict offers Alert). The Next step describes the ladder from the effective reading. The
  POST's confirm already names held stages (`heldByBox`). This is the simplest correct answer, and it needs no new
  rule. Pinned: a chosen `check` under strict steps to `alert`, waiting on `alerts`.
- **An absent or unreadable read parses both fields `unreadable`**, with `undefined` as the raw value, because there
  is none. `stored` tells the two apart (§6.1). This settles the L1 half of the §20 residue about an absent row and
  the radio. The view and the PWA map it to `'unreadable'` on the wire, and no radio is checked.
- **`STALL_STAGES`** is an extra L0 constant §12 does not list. It is derived from `STALL_STAGE_TEXT` with
  `Object.keys`, and it is the one §5.1 order every stage list uses.
- **Text keys §12 names without wording.** `STALL_SECTION_TEXT.level` reads 'Level'. `builtIn` reads
  '{value} (built-in)', `chosenHere` '{value} (chosen here)', `sent` '{count} sent', `shadow` '{count} shadow', and
  `custom` 'Custom'. `countsFailed` reads 'The notice counts could not be read.' (§13). Two keys are added, because
  §13 renders two strings no listed key holds: `builtInOption`, 'Built-in ({value})', which is the select's first
  option, and `theySayUnknown`, 'they say: unknown', for the Follow option while the registry cannot be read.
- **`STALL_CONFIRM_TEXT.dueFromOff` keeps §13's wording verbatim, "Off recorded nothing. …".** It names the Off level
  by its full label, not a short form, so it was not turned into a `{label}` slot.
- **`STALL_CONFIRM_TEXT.refused` keeps its `{detail}` slot.** How W2 fills it when a body carries no `detail` is W2's
  decision (§20 residue).

- [ ] **Step 1: Re-anchor**

```bash
cd "$(git rev-parse --show-toplevel)"
wc -l shared/api.ts
tail -1 shared/api.ts
grep -c '^export const MAIL_REPLAY_MS = 600_000;$' shared/api.ts
grep -c "^import { isStallKebab } from '../src/coord/stall.js';$" server/test/mail-routes.test.ts
grep -c '^        || isStallKebab(tok),$' server/test/mail-routes.test.ts
grep -c 'UpdateStoreRefuseCode, child-reclaim word or stall-watch word`).toBe(true);$' server/test/mail-routes.test.ts
ls server/src/coord/stallsettings.ts server/test/stall-settings.test.ts 2>&1 | grep -c 'No such file'
```

Expected (measured at 77f8d63a5): `9096 shared/api.ts`; `export const MAIL_REPLAY_MS = 600_000;`; `1`, `1`, `1`, `1`;
`2`. If the last line of `shared/api.ts` is not `MAIL_REPLAY_MS`, append below whatever the last line now is. Never
insert above it: README ≈:4586 cites `shared/api.ts:7684-7686`, `:7726`, `:7734` and `:7747`.

- [ ] **Step 2: Write the failing test**

Create `server/test/stall-settings.test.ts` with exactly this content:

```ts
/**
 * STALL WATCH SETTINGS, the L1 suite (design 2026-10-05, §5, §6, §12, §14, §17). W1 Task 1 lands its first half: the
 * L0 ladder texts in `shared/api.ts` and the settings core in `server/src/coord/stallsettings.ts` (the ladder, the
 * bounds, the two validity predicates, the parse, the box arming and its unheld reading, the resolver, and the four
 * readers `stallLevelOf`, `stallStages`, `stallNextStep` and `stallFilesExceed`). Later tasks append their rows here.
 *
 * No marker name is spelled in this file. The four lane markers come from `STALL_MARKERS` in its Record order, which a
 * CONTROL row proves against `stallArmingOf`; the mail-gate markers and `mail-disabled` come from their definers'
 * exports. So this suite never becomes a second holder that a no-writer pin would have to reason about.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STALL_LEVELS, STALL_LEVEL_TEXT, STALL_STAGES, STALL_STAGE_TEXT, STALL_STORED_STATES, isStallLevelChoice } from '../../shared/api.js';
import type { StallLevel, StallLevelChoice, StallStored } from '../../shared/api.js';
import type { ReadFailure } from '../../shared/agent-protocol.js';
import {
  STALL_LADDER, STALL_NOTICE_WINDOW_MS, STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS, STALL_QUIET_STEP_MS,
  armedStages, isStallQuietMs, isStallSettingsKebab, parseStallSettings, resolveStallWatch, stallBoxArmingOf,
  stallFilesExceed, stallLevelOf, stallNextStep, stallStages, stallUnheldBoxOf,
} from '../src/coord/stallsettings.js';
import type { StallBoxArming, StallSettingsParsed, StallSettingsRead } from '../src/coord/stallsettings.js';
import { STALL_MARKERS, STALL_QUIET_MS, stallArmingOf } from '../src/coord/stall.js';
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER, mailTurnModeOf } from '../src/turnidle.js';
import { MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The lane's four markers, in `STALL_MARKER_MAP`'s order: the kill file, live, escalate, the wave-2 step. */
const [KILL, LIVE, ESCALATE, W2LIVE] = STALL_MARKERS as [string, string, string, string];
const STRICT = MAIL_GATE_STRICT_MARKER;
const BUSY = MAIL_GATE_BUSY_MARKER;
const SHADOW = MAIL_GATE_BUSY_SHADOW_MARKER;
const MAIL_OFF = MAIL_DISABLED_MARKER;
/** The seven arming files plus `mail-disabled`: the 2^8 combinations M4's property walks. */
const EIGHT = [KILL, LIVE, ESCALATE, W2LIVE, STRICT, BUSY, SHADOW, MAIL_OFF] as const;

/** One registry listing's box arming, `mail-disabled` read the way `sweepStalls` reads it. */
const box = (...names: string[]): StallBoxArming => stallBoxArmingOf(names, names.includes(MAIL_OFF));
/** Today's expression (`watch.ts` ≈:3788), written out independently of `stallBoxArmingOf`. */
const today = (names: readonly string[]) =>
  ({ ...stallArmingOf(names), mailDisabled: names.includes(MAIL_OFF), mailMode: mailTurnModeOf(names) });

const rowRead = (level: unknown, quietMs: unknown = null, updatedAt: unknown = 1_790_000_000_000): StallSettingsRead =>
  ({ kind: 'row', row: { level, quietMs, updatedAt } });
const chosen = (level: StallLevelChoice | string, quietMs: unknown = null): StallSettingsParsed =>
  parseStallSettings(rowRead(level, quietMs));
const FOLLOW = chosen('follow');
const ABSENT = parseStallSettings({ kind: 'absent' });
const UNREADABLE = parseStallSettings({ kind: 'unreadable', detail: 'no such table: stall_settings' });

const MIN = 60_000;
const H = 3_600_000;

describe('CONTROL: the fixtures name the markers they claim to', () => {
  it('STALL_MARKERS is in Record order: kill file, live, escalate, the wave-2 step', () => {
    expect(stallArmingOf([KILL])).toEqual({ disabled: true, live: false, escalate: false, w2Live: false });
    expect(stallArmingOf([LIVE])).toEqual({ disabled: false, live: true, escalate: false, w2Live: false });
    expect(stallArmingOf([ESCALATE])).toEqual({ disabled: false, live: false, escalate: true, w2Live: false });
    expect(stallArmingOf([W2LIVE])).toEqual({ disabled: false, live: false, escalate: false, w2Live: true });
    expect([STRICT, BUSY, SHADOW].map((n) => mailTurnModeOf([n]))).toEqual(['strict', 'busy', 'busy-shadow']);
    expect(new Set(EIGHT).size).toBe(8);
  });
});

// ── L0 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('L0: the ladder and stage texts are one total Record each, in ladder and §5.1 order', () => {
  it('STALL_LEVELS is derived from STALL_LEVEL_TEXT, in ladder order', () => {
    expect(STALL_LEVELS).toEqual(['off', 'log', 'check', 'alert', 'deliver', 'all']);
    expect(STALL_LEVELS).toEqual(Object.keys(STALL_LEVEL_TEXT));
    expect(STALL_LEVELS.map((l) => STALL_LEVEL_TEXT[l].label))
      .toEqual(['Off', 'Log only', 'Check silent workers', 'Alert coordinator and you', 'Deliver mail to busy sessions', 'Everything']);
  });
  it('STALL_STAGES is derived from STALL_STAGE_TEXT, in §5.1 order, and only the busy gate has no gate', () => {
    expect(STALL_STAGES).toEqual(['checks', 'alerts', 'busyDelivery', 'busyGate', 'wave2']);
    expect(STALL_STAGES).toEqual(Object.keys(STALL_STAGE_TEXT));
    expect(STALL_STAGES.filter((s) => STALL_STAGE_TEXT[s].gate === null)).toEqual(['busyGate']);
  });
  it('StallStored is a row or ReadFailure\'s two words, derived from STALL_STORED_STATES', () => {
    expect(STALL_STORED_STATES).toEqual(['row', 'absent', 'unreadable']);
    const failures: ReadFailure[] = STALL_STORED_STATES.filter((s): s is Exclude<StallStored, 'row'> => s !== 'row');
    expect(failures).toEqual(['absent', 'unreadable']);
  });
  it('no does text, stops text or gate carries a duration, a rung code or a wave number (§5)', () => {
    const texts = [
      ...STALL_LEVELS.map((l) => STALL_LEVEL_TEXT[l].does),
      ...STALL_STAGES.flatMap((s) => [STALL_STAGE_TEXT[s].stops, STALL_STAGE_TEXT[s].gate ?? '']),
    ];
    expect(texts.length).toBe(16);
    for (const t of texts) {
      expect(t, t).not.toMatch(/\b\d+\s*(?:h|hours?|min|minutes?|s|seconds?|d|days?)\b|\br[1-3]\b|\bwave\s*\d/i);
    }
  });
});

describe('isStallLevelChoice: its own keys only, with the pinned body (M11b)', () => {
  it('accepts follow and the six levels, and nothing else', () => {
    for (const v of ['follow', ...STALL_LEVELS]) expect(isStallLevelChoice(v), v).toBe(true);
    for (const v of ['custom', 'unknown', 'Follow', 'OFF', '', ' log', 1, null, undefined, {}, ['log']]) {
      expect(isStallLevelChoice(v), String(v)).toBe(false);
    }
  });
  it('refuses the prototype names that an `in` or `MAP[v]` test would accept', () => {
    for (const v of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(isStallLevelChoice(v), v).toBe(false);
    }
  });
  it('has the pinned body (§6.1): a string, then follow or an includes over STALL_LEVELS', () => {
    const src = readFileSync(path.join(ccrcRoot, 'shared', 'api.ts'), 'utf8');
    const body = /export function isStallLevelChoice\(v: unknown\): v is StallLevelChoice \{\n([\s\S]*?)\n\}/.exec(src)?.[1];
    expect(body).toBe("  return typeof v === 'string' && (v === 'follow' || (STALL_LEVELS as readonly string[]).includes(v));");
  });
});

describe('isStallQuietMs: whole 30-minute steps from 30 min to 12 h, inclusive (§7)', () => {
  it('the bounds, step and window carry the spec values', () => {
    expect([STALL_QUIET_MIN_MS, STALL_QUIET_MAX_MS, STALL_QUIET_STEP_MS, STALL_NOTICE_WINDOW_MS])
      .toEqual([30 * MIN, 12 * H, 30 * MIN, 48 * H]);
    expect(STALL_QUIET_MS % STALL_QUIET_STEP_MS).toBe(0);
    expect(isStallQuietMs(STALL_QUIET_MS)).toBe(true);
  });
  it('accepts the bounds and every step between, and refuses everything else, never clamping', () => {
    for (let v = STALL_QUIET_MIN_MS; v <= STALL_QUIET_MAX_MS; v += STALL_QUIET_STEP_MS) expect(isStallQuietMs(v), String(v)).toBe(true);
    for (const v of [29 * MIN, 45 * MIN, 12 * H + 30 * MIN, 0, -30 * MIN, 30 * MIN + 1, 1_800_000.5, NaN, Infinity]) {
      expect(isStallQuietMs(v), String(v)).toBe(false);
    }
    for (const v of ['1800000', 1_800_000n, null, undefined, {}, [1_800_000]]) expect(isStallQuietMs(v), String(v)).toBe(false);
  });
});

// ── the parse ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('parseStallSettings: each field on its own; absent and unreadable kept apart', () => {
  it('a missing row and an unreadable read are their own words, and neither is follow or default', () => {
    expect(ABSENT).toEqual({ stored: 'absent', level: { kind: 'unreadable', token: undefined }, quiet: { kind: 'unreadable', value: undefined }, updatedAt: null });
    expect(UNREADABLE).toEqual({ stored: 'unreadable', level: { kind: 'unreadable', token: undefined }, quiet: { kind: 'unreadable', value: undefined }, updatedAt: null });
  });
  it('reads the seed as follow and the built-in, and a chosen row as chosen', () => {
    expect(parseStallSettings(rowRead('follow', null, 0)))
      .toEqual({ stored: 'row', level: { kind: 'follow' }, quiet: { kind: 'default' }, updatedAt: 0 });
    expect(parseStallSettings(rowRead('check', 3 * H, 5)))
      .toEqual({ stored: 'row', level: { kind: 'chosen', level: 'check' }, quiet: { kind: 'set', ms: 3 * H }, updatedAt: 5 });
  });
  it('M11: one predicate for write and read: the parse sets a quiet time exactly when isStallQuietMs accepts it', () => {
    const table: unknown[] = [30 * MIN, 45 * MIN, 12 * H, 12 * H + 30 * MIN, 29 * MIN, 1_800_000.5, '1800000', 0, -30 * MIN, NaN];
    for (const v of table) {
      const q = chosen('log', v).quiet;
      expect(q.kind === 'set', String(v)).toBe(isStallQuietMs(v));
      expect(q, String(v)).toEqual(isStallQuietMs(v) ? { kind: 'set', ms: v } : { kind: 'unreadable', value: v });
    }
    expect(chosen('log', 1_800_000.5).quiet.kind).toBe('unreadable');
    expect(chosen('log', '1800000').quiet.kind).toBe('unreadable');
  });
  it('M11b: a prototype name stored as the level reads unreadable, never a level', () => {
    for (const v of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(chosen(v).level, v).toEqual({ kind: 'unreadable', token: v });
    }
    expect(chosen('custom').level).toEqual({ kind: 'unreadable', token: 'custom' });
    expect(chosen(3 as unknown as string).level).toEqual({ kind: 'unreadable', token: 3 });
  });
  it('M11c (parse half): a bigint inside the safe range converts, an oversize one reads unreadable per field', () => {
    expect(chosen('check', 1_800_000n).quiet).toEqual({ kind: 'set', ms: 1_800_000 });
    const big = 9_223_372_036_854_775_807n;
    const p = chosen('check', big);
    expect(p.quiet).toEqual({ kind: 'unreadable', value: big });
    expect(p.level, 'one bad field costs only that field').toEqual({ kind: 'chosen', level: 'check' });
    expect(parseStallSettings(rowRead('check', null, 1_790_000_000_000n)).updatedAt).toBe(1_790_000_000_000);
    for (const v of ['abc', 1.5, big, null, NaN]) {
      expect(parseStallSettings(rowRead('check', null, v)).updatedAt, String(v)).toBeNull();
    }
  });
});

// ── the box arming ───────────────────────────────────────────────────────────────────────────────────────────────

describe('stallBoxArmingOf and stallUnheldBoxOf', () => {
  it('stallBoxArmingOf is today\'s expression over the same listing', () => {
    const names = [LIVE, SHADOW, 'demo-quiet-mesa.json'];
    expect(stallBoxArmingOf(names, false)).toEqual(today(names));
    expect(stallBoxArmingOf(names, true)).toEqual({ ...today(names), mailDisabled: true });
  });
  it('the unheld reading clears the kill file, the mail kill file and strict, and keeps the busy mode below strict', () => {
    expect(stallUnheldBoxOf([KILL, LIVE, STRICT, BUSY, MAIL_OFF]))
      .toEqual({ disabled: false, live: true, escalate: false, w2Live: false, mailDisabled: false, mailMode: 'busy' });
    expect(stallUnheldBoxOf([STRICT, SHADOW]).mailMode).toBe('busy-shadow');
    expect(stallUnheldBoxOf([STRICT]).mailMode).toBe('shell');
    expect(stallUnheldBoxOf([LIVE, ESCALATE])).toEqual(box(LIVE, ESCALATE));
  });
});

// ── the resolver ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Every subset of the eight files, as a listing. */
const SUBSETS: string[][] = Array.from({ length: 2 ** EIGHT.length }, (_, bits) => EIGHT.filter((_, i) => (bits >> i) & 1));

describe('M4: Follow, and a row that does not apply whole, is today\'s behaviour exactly', () => {
  const settings: ReadonlyArray<readonly [string, StallSettingsParsed]> = [
    ['follow', FOLLOW],
    ['the seed', parseStallSettings(rowRead('follow', null, 0))],
    ['an absent row', ABSENT],
    ['an unreadable read', UNREADABLE],
    ['a chosen level beside an unreadable quiet time', chosen('all', 45 * MIN)],
    ['an unreadable level beside a chosen quiet time', chosen('constructor', 3 * H)],
  ];
  it('walks all 256 combinations of the seven arming files and mail-disabled', () => {
    expect(SUBSETS.length).toBe(256);
    expect(new Set(SUBSETS.map((s) => s.join('|'))).size).toBe(256);
  });
  for (const [what, s] of settings) {
    it(`${what}: the resolved arming IS the box object, equal to today's expression, with the built-in quiet time`, () => {
      for (const names of SUBSETS) {
        const b = box(...names);
        const r = resolveStallWatch(b, s);
        expect(r.arming, names.join(',')).toBe(b);
        expect(r.arming, names.join(',')).toStrictEqual(today(names));
        expect(r.quietMs).toBe(STALL_QUIET_MS);
        expect(r.quietSource).toBe('default');
        expect(r.chosen).toBeNull();
        expect(r.levelSource).toBe('files');
        expect(r.effective).toBe(r.files);
      }
    });
  }
});

describe('M1: the lane\'s kill file restores the box wholesale', () => {
  it('a chosen deliver over the kill file keeps the box\'s mail mode, never busy, and reads held', () => {
    for (const mode of [[], [SHADOW], [STRICT]]) {
      const b = box(KILL, LIVE, ...mode);
      const r = resolveStallWatch(b, chosen('deliver'));
      expect(r.arming).toBe(b);
      expect(r.arming.mailMode).toBe(mailTurnModeOf(mode));
      expect(r.arming.disabled).toBe(true);
      expect(r.levelSource).toBe('held');
      expect(r.held.watchOff).toBe(true);
      expect(r.effective).toBe('off');
    }
  });
});

describe('M1b: off is never read while busy delivery is on', () => {
  it('a chosen off, or the kill file, over a box busy file reads custom', () => {
    const r = resolveStallWatch(box(BUSY), chosen('off'));
    expect(r.arming).toEqual({ ...box(BUSY), disabled: true });
    expect(r.effective).toBe('custom');
    expect(r.levelSource).toBe('chosen');
    expect(stallLevelOf(box(KILL, BUSY))).toBe('custom');
    expect(stallLevelOf(box(KILL, SHADOW))).toBe('off');
    expect(stallLevelOf(box(KILL))).toBe('off');
  });
});

describe('M2: mail-disabled passes through a chosen level (L1 half)', () => {
  it('every running level carries the box\'s mailDisabled, and mailOff is held', () => {
    for (const level of STALL_LEVELS.filter((l) => l !== 'off')) {
      const r = resolveStallWatch(box(MAIL_OFF), chosen(level));
      expect(r.arming.mailDisabled, level).toBe(true);
      expect(r.held.mailOff, level).toBe(true);
      expect(r.levelSource, `${level}: mail off changes what a level does nowhere the confirm reads`).toBe('chosen');
    }
    expect(resolveStallWatch(box(), chosen('check')).arming.mailDisabled).toBe(false);
  });
});

describe('M3 and M3b: strict keeps the mail gate, and holds the wave-2 step', () => {
  it('a chosen deliver or all under strict keeps strict, and reads alert, held', () => {
    for (const level of ['deliver', 'all'] as const) {
      const r = resolveStallWatch(box(STRICT), chosen(level));
      expect(r.arming.mailMode, level).toBe('strict');
      expect(r.effective, level).toBe('alert');
      expect(r.levelSource, level).toBe('held');
      expect(r.held.gateStrict, level).toBe(true);
    }
  });
  it('M3b: a chosen all under strict has w2Live false and wave2HeldByStrict; deliver does not', () => {
    const all = resolveStallWatch(box(STRICT), chosen('all'));
    expect(all.arming.w2Live).toBe(false);
    expect(all.held.wave2HeldByStrict).toBe(true);
    const deliver = resolveStallWatch(box(STRICT), chosen('deliver'));
    expect(deliver.held.wave2HeldByStrict).toBe(false);
    expect(resolveStallWatch(box(), chosen('all')).arming.w2Live).toBe(true);
    expect(resolveStallWatch(box(), chosen('all')).held.wave2HeldByStrict).toBe(false);
  });
});

describe('the chosen arm decides every other flag and the mail mode (§6.3 item 4)', () => {
  it('each running level resolves to its own ladder row over a box with no files', () => {
    for (const level of STALL_LEVELS) {
      const row = STALL_LADDER[level];
      const r = resolveStallWatch(box(), chosen(level));
      expect(r.chosen, level).toBe(level);
      expect(r.effective, level).toBe(level);
      expect(r.levelSource, level).toBe('chosen');
      if (row.disabled) { expect(r.arming).toEqual({ ...box(), disabled: true }); continue; }
      expect(r.arming, level).toEqual({ disabled: false, live: row.live, escalate: row.escalate, w2Live: row.w2Live, mailDisabled: false, mailMode: row.mailMode });
    }
  });
  it('a chosen check turns off a busy mode the files set, and overrides every lane file but the kill file', () => {
    const r = resolveStallWatch(box(LIVE, ESCALATE, W2LIVE, BUSY), chosen('check'));
    expect(r.arming).toEqual({ disabled: false, live: true, escalate: false, w2Live: false, mailDisabled: false, mailMode: 'busy-shadow' });
    expect(r.files).toBe('all');
    expect(r.effective).toBe('check');
  });
  it('a chosen quiet time applies with its row, and the ladder table is §5\'s', () => {
    const r = resolveStallWatch(box(), chosen('follow', 3 * H));
    expect([r.quietMs, r.quietSource]).toEqual([3 * H, 'chosen']);
    expect(STALL_LADDER).toEqual({
      off: { disabled: true },
      log: { disabled: false, live: false, escalate: false, w2Live: false, mailMode: 'busy-shadow' },
      check: { disabled: false, live: true, escalate: false, w2Live: false, mailMode: 'busy-shadow' },
      alert: { disabled: false, live: true, escalate: true, w2Live: false, mailMode: 'busy-shadow' },
      deliver: { disabled: false, live: true, escalate: true, w2Live: false, mailMode: 'busy' },
      all: { disabled: false, live: true, escalate: true, w2Live: true, mailMode: 'busy' },
    });
  });
});

describe('M23: the held flags, and held only when a flag changed what the choice does', () => {
  it('each flag alone', () => {
    expect(resolveStallWatch(box(KILL), FOLLOW).held).toEqual({ watchOff: true, mailOff: false, gateStrict: false, wave2HeldByStrict: false });
    expect(resolveStallWatch(box(MAIL_OFF), FOLLOW).held).toEqual({ watchOff: false, mailOff: true, gateStrict: false, wave2HeldByStrict: false });
    expect(resolveStallWatch(box(STRICT), FOLLOW).held).toEqual({ watchOff: false, mailOff: false, gateStrict: true, wave2HeldByStrict: false });
    expect(resolveStallWatch(box(), FOLLOW).held).toEqual({ watchOff: false, mailOff: false, gateStrict: false, wave2HeldByStrict: false });
  });
  it('a chosen deliver under strict reads alert, held; a chosen check under strict reads check, held', () => {
    const d = resolveStallWatch(box(STRICT), chosen('deliver'));
    expect([d.effective, d.levelSource]).toEqual(['alert', 'held']);
    const c = resolveStallWatch(box(STRICT), chosen('check'));
    expect([c.effective, c.levelSource]).toEqual(['check', 'held']);
  });
  it('a chosen off under the kill file, with and without a box busy file, stays chosen', () => {
    const plain = resolveStallWatch(box(KILL), chosen('off'));
    expect([plain.effective, plain.levelSource]).toEqual(['off', 'chosen']);
    const busy = resolveStallWatch(box(KILL, BUSY), chosen('off'));
    expect([busy.effective, busy.levelSource]).toEqual(['custom', 'chosen']);
    const strict = resolveStallWatch(box(STRICT), chosen('off'));
    expect([strict.effective, strict.levelSource], 'off leaves the mail gate as the files set it, strict included').toEqual(['off', 'chosen']);
  });
  it('a flag that merely stands beside the choice sets nothing', () => {
    const r = resolveStallWatch(box(LIVE, ESCALATE, MAIL_OFF), chosen('alert'));
    expect([r.effective, r.levelSource, r.held.mailOff]).toEqual(['alert', 'chosen', true]);
  });
});

describe('M25: a row applies whole, or not at all (§6.2, §19 Q11)', () => {
  it('an unreadable level beside a set quiet time: the files and the built-in quiet time', () => {
    const r = resolveStallWatch(box(LIVE, SHADOW), chosen('toString', 30 * MIN));
    expect(r.quietMs).toBe(STALL_QUIET_MS);
    expect(r.quietSource).toBe('default');
    expect(r.levelSource).toBe('files');
    expect(r.effective).toBe('check');
  });
  it('a chosen level beside an unreadable quiet time: the files, not the level', () => {
    const b = box(LIVE, SHADOW);
    const r = resolveStallWatch(b, chosen('all', 45 * MIN));
    expect(r.arming).toBe(b);
    expect(r.chosen).toBeNull();
    expect(r.levelSource).toBe('files');
    expect(r.effective).toBe('check');
    expect(r.quietMs).toBe(STALL_QUIET_MS);
  });
});

// ── the readers ──────────────────────────────────────────────────────────────────────────────────────────────────

describe('M5: stallLevelOf reads custom for a combination no step names, and never off for a running arming', () => {
  it('escalate without live, and w2-live without escalate, read custom', () => {
    expect(stallLevelOf(box(ESCALATE))).toBe('custom');
    expect(stallLevelOf(box(LIVE, W2LIVE))).toBe('custom');
    expect(stallLevelOf(box(W2LIVE))).toBe('custom');
    expect(stallLevelOf(box(LIVE, ESCALATE, W2LIVE))).toBe('custom');
    expect(stallLevelOf(box(LIVE, BUSY)), 'busy delivery without escalation is no step').toBe('custom');
  });
  it('a running arming with no flags reads log, never off; the busy gate never splits a level (Q1)', () => {
    expect(stallLevelOf(box())).toBe('log');
    expect(stallLevelOf(box(SHADOW))).toBe('log');
    expect(stallLevelOf(box(STRICT))).toBe('log');
    expect(stallLevelOf(box(LIVE, SHADOW)), 'today\'s fleet').toBe('check');
    expect(stallLevelOf(box(LIVE, ESCALATE))).toBe('alert');
    expect(stallLevelOf(box(LIVE, ESCALATE, BUSY))).toBe('deliver');
    expect(stallLevelOf(box(LIVE, ESCALATE, W2LIVE, BUSY))).toBe('all');
  });
  it('an arming with no mailMode reads as shell', () => {
    expect(stallLevelOf({ disabled: false, live: true, escalate: false })).toBe('check');
    expect(stallLevelOf({ disabled: true, live: false, escalate: false })).toBe('off');
  });
});

describe('M22: stallStages derives the six booleans from a resolved arming', () => {
  it('the busy gate is on under busy and busy-shadow, and busy delivery under busy alone', () => {
    expect(stallStages(box(LIVE, SHADOW))).toEqual({ runs: true, checks: true, alerts: false, busyDelivery: false, busyGate: true, wave2: false });
    expect(stallStages(box(LIVE, ESCALATE, W2LIVE, BUSY))).toEqual({ runs: true, checks: true, alerts: true, busyDelivery: true, busyGate: true, wave2: true });
    expect(stallStages(box())).toEqual({ runs: true, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false });
  });
  it('with mail switched off both mail-gate stages read false; under strict both read false', () => {
    expect(stallStages(box(BUSY, MAIL_OFF))).toMatchObject({ busyDelivery: false, busyGate: false });
    expect(stallStages(box(SHADOW, MAIL_OFF))).toMatchObject({ busyGate: false });
    expect(stallStages(box(STRICT, BUSY))).toMatchObject({ busyDelivery: false, busyGate: false });
  });
  it('the lane stages need the lane running; armedStages reads mail switched off as on', () => {
    expect(stallStages(box(KILL, LIVE, ESCALATE, W2LIVE, BUSY))).toEqual({ runs: false, checks: false, alerts: false, busyDelivery: true, busyGate: true, wave2: false });
    expect(stallStages(box(ESCALATE))).toMatchObject({ checks: false, alerts: false });
    expect(armedStages(box(BUSY, MAIL_OFF))).toMatchObject({ busyDelivery: true, busyGate: true });
  });
});

describe('M30: stallNextStep answers none, top or the next step with the gated stages it waits on', () => {
  it('files with no gate file reading log: a step to check, waiting on checks alone', () => {
    const r = resolveStallWatch(box(), FOLLOW);
    expect(stallNextStep(r.arming, r.chosen)).toEqual({ kind: 'step', level: 'check', waitsOn: ['checks'] });
  });
  it('alert steps to deliver, waiting on busy delivery and never on the busy gate', () => {
    const r = resolveStallWatch(box(LIVE, ESCALATE), FOLLOW);
    expect(stallNextStep(r.arming, r.chosen)).toEqual({ kind: 'step', level: 'deliver', waitsOn: ['busyDelivery'] });
    const off = resolveStallWatch(box(), chosen('off'));
    expect(stallNextStep(off.arming, off.chosen), 'log turns on only the busy gate, which nothing waits on')
      .toEqual({ kind: 'step', level: 'log', waitsOn: [] });
  });
  it('a chosen deliver under strict: none; custom: none; all: top', () => {
    const held = resolveStallWatch(box(STRICT), chosen('deliver'));
    expect(stallNextStep(held.arming, held.chosen)).toEqual({ kind: 'none' });
    const custom = resolveStallWatch(box(ESCALATE), FOLLOW);
    expect(stallNextStep(custom.arming, custom.chosen)).toEqual({ kind: 'none' });
    const all = resolveStallWatch(box(), chosen('all'));
    expect(stallNextStep(all.arming, all.chosen)).toEqual({ kind: 'top' });
  });
  it('a chosen check under strict keeps its reading, so its Next step stands', () => {
    const r = resolveStallWatch(box(STRICT), chosen('check'));
    expect(stallNextStep(r.arming, r.chosen)).toEqual({ kind: 'step', level: 'alert', waitsOn: ['alerts'] });
  });
  it('mail switched off reads as on: a files-read deliver under mail-disabled still steps to all', () => {
    const r = resolveStallWatch(box(LIVE, ESCALATE, BUSY, MAIL_OFF), FOLLOW);
    expect(stallNextStep(r.arming, r.chosen)).toEqual({ kind: 'step', level: 'all', waitsOn: ['wave2'] });
  });
});

describe('M28 (L1 half): files-exceed compares the sending stages only', () => {
  it('today\'s fleet with a chosen deliver does not exceed; files at alert with a chosen check do', () => {
    const fleet = box(LIVE, SHADOW);
    expect(stallFilesExceed(fleet, resolveStallWatch(fleet, chosen('deliver')))).toBe(false);
    expect(stallFilesExceed(fleet, resolveStallWatch(fleet, chosen('all')))).toBe(false);
    const alert = box(LIVE, ESCALATE);
    expect(stallFilesExceed(alert, resolveStallWatch(alert, chosen('check')))).toBe(true);
    expect(stallFilesExceed(alert, resolveStallWatch(alert, chosen('off')))).toBe(true);
  });
  it('false whenever the files decide', () => {
    for (const names of SUBSETS) {
      const b = box(...names);
      expect(stallFilesExceed(b, resolveStallWatch(b, FOLLOW)), names.join(',')).toBe(false);
    }
  });
  it('reads mail switched off as on: busy files under mail-disabled exceed a chosen alert', () => {
    const b = box(LIVE, ESCALATE, BUSY, MAIL_OFF);
    expect(stallFilesExceed(b, resolveStallWatch(b, chosen('alert')))).toBe(true);
  });
  it('the busy gate is never compared, even in a resolution where only it differs', () => {
    const b = box(LIVE, SHADOW);
    const r = resolveStallWatch(b, chosen('check'));
    expect(stallFilesExceed(b, { ...r, arming: { ...r.arming, mailMode: 'shell' } })).toBe(false);
  });
});

// ── source scans ─────────────────────────────────────────────────────────────────────────────────────────────────

const L1_FILE = path.join(ccrcRoot, 'server', 'src', 'coord', 'stallsettings.ts');

describe('M19 control: the new files sit inside single-definition.test.ts\'s four walked roots', () => {
  // `ROOTS` there is module-local, so this row re-walks the same four roots the same way, `__`-prefixed transients
  // skipped as that walk skips them, and asserts every file this programme adds is found.
  const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    if (e.startsWith('__')) return [];
    const p = path.join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
  it('finds shared/api.ts and server/src/coord/stallsettings.ts', () => {
    const all = ROOTS.flatMap(walk).map((f) => path.relative(ccrcRoot, f).split(path.sep).join('/'));
    expect(all.length).toBeGreaterThan(100);
    for (const f of ['shared/api.ts', 'server/src/coord/stallsettings.ts']) expect(all, f).toContain(f);
  });
});

describe('M19b: stallsettings.ts is the pure L1 module its docstring says it is', () => {
  const SRC = readFileSync(L1_FILE, 'utf8');
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  // `stall-vocabulary.test.ts`'s shapes, copied with its CONTROL: either quote, a second import behind a first.
  const NODE_BUILTIN = /\bfrom\s*['"]node:/;
  const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]/m;
  const RE_EXPORT = /^\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\b/m;
  const valueImportSpecifiers = (c: string): string[] =>
    [...c.matchAll(/^\s*import\s+(type\s+)?[^'"]*?\bfrom\s*(['"])([^'"]+)\2/gm)]
      .filter((m) => m[1] === undefined).map((m) => m[3]!);
  const ALLOWED = ['../../../shared/api.js', './stall.js', '../turnidle.js'];

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function resolveStallWatch');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });
  it('CONTROL: the scans see either quote, a db.js value import and a second import behind a first', () => {
    expect(NODE_BUILTIN.test(`import { readFileSync } from "node:fs";`)).toBe(true);
    expect(NODE_BUILTIN.test(`import { x } from '../../../shared/api.js';`)).toBe(false);
    expect(SIDE_EFFECT_IMPORT.test(`import "./db.js";`)).toBe(true);
    expect(RE_EXPORT.test(`export * from './db.js';`)).toBe(true);
    expect(valueImportSpecifiers(`import { openCoordDb } from "./db.js";\nimport { x } from './stall.js';`)).toEqual(['./db.js', './stall.js']);
    expect(valueImportSpecifiers(`import type { CoordDb } from './db.js';`)).toEqual([]);
  });
  it('has no clock', () => {
    expect(code()).not.toMatch(/\bDate\s*\.\s*now\s*\(|performance\s*\.\s*now|\bnew\s+Date\b|(?<!\bnew\s+)\bDate\s*\(/);
  });
  it('has no fs, no node builtin, no require and no dynamic import', () => {
    expect(code()).not.toMatch(NODE_BUILTIN);
    expect(code()).not.toMatch(/\bfs\s*\.|\brequire\s*\(|\bimport\s*\(/);
  });
  it('has no fastify, no reply and no store handle', () => {
    expect(code()).not.toMatch(/\breply\s*\.|\bFastify|\bapp\s*\./);
    expect(code()).not.toMatch(/\bcoord\s*\.|\bstore\s*\.|\bdb\s*\.|\.prepare\s*\(/);
  });
  it('takes value imports only from L0, stall.ts and turnidle.ts; anything else is a type import', () => {
    const c = code();
    expect(c).not.toMatch(SIDE_EFFECT_IMPORT);
    expect(c).not.toMatch(RE_EXPORT);
    const specs = valueImportSpecifiers(c);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(ALLOWED, `stallsettings.ts takes a value import from ${spec}`).toContain(spec);
  });
});

describe('the kebab words stallsettings.ts spells are declared through isStallSettingsKebab (§10, M18)', () => {
  it('declares its three words, and only those', () => {
    for (const w of ['busy-shadow', 'confirm-required', 'flag-off']) expect(isStallSettingsKebab(w), w).toBe(true);
    for (const w of ['busy', 'stall-shadow', 'not-configured', 'flag-on']) expect(isStallSettingsKebab(w), w).toBe(false);
  });
  it('every quoted kebab word on a code line of stallsettings.ts is one of them', () => {
    const lines = readFileSync(L1_FILE, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    const words = [...lines.matchAll(/'([a-z]+(?:-[a-z]+)+)'/g)].map((m) => m[1]!);
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) expect(isStallSettingsKebab(w), w).toBe(true);
  });
});

// Type-level: the ladder and the texts are one key set (a level added to one Record and not the other is a compile
// error, §5). This line fails `tsc -p test/tsconfig.tests.json` if the two key sets ever differ.
const _ladderKeys: Record<StallLevel, true> = Object.fromEntries(Object.keys(STALL_LADDER).map((k) => [k, true])) as Record<keyof typeof STALL_LADDER, true>;
void _ladderKeys;
// Type-level: `StallStored`'s failure words are exactly `ReadFailure`, in both directions (the `STAMP_READS` idiom).
// A third read-failure word added in `shared/agent-protocol.ts`, or a word dropped here, fails the typecheck.
type _Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _storedIsReadFailure: _Same<Exclude<StallStored, 'row'>, ReadFailure> = true;
void _storedIsReadFailure;
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-settings.test.ts`

Expected (measured on the prototype): `Test Files  1 failed (1)`, `Tests  no tests`, with
`Error: Cannot find module '../src/coord/stallsettings.js' imported from …/server/test/stall-settings.test.ts`.

- [ ] **Step 4: Append the L0 block to `shared/api.ts`**

Append the block below at the end of `shared/api.ts`, after its last line, `export const MAIL_REPLAY_MS = 600_000;`
(≈9096). `grep -c` measures that line once (Step 1). The block begins with one blank line. Use straight ASCII
apostrophes inside the double-quoted strings, as shown.

```ts

// ── Stall watch settings (design 2026-10-05, §5, §5.1, §12) ────────────────────────────────────────────────────────
// The whole block stands at the END of this file, below `MAIL_REPLAY_MS`, for that constant's own reason: README and
// the compaction card cite this file by line, and an insertion above them moves every anchor under it. Every string
// the Settings page's Stall watch section shows is one of the constants below, and no other file spells one. A
// `{name}` slot is filled by the PWA's one helper, `fillStallText`. No text spells a registry marker name, a rung
// code, a wave number or a duration: the durations live in code alone, and the window reaches the counts heading
// from the wire. The ladder's flag and mail-mode columns are L1's (`STALL_LADDER`, `server/src/coord/stallsettings.ts`),
// keyed by the same `StallLevel`, so a level added to one Record and not the other is a compile error.

/** The six ladder levels, in ladder order, each with its label and what it does (§5). Each includes the ones below it
 *  in what it sends. `STALL_LEVELS` is derived from this Record, and `stall-settings.test.ts` pins its order. */
export const STALL_LEVEL_TEXT = {
  off: {
    label: 'Off',
    does: "The stall watch does not run: nothing is checked, recorded or sent. The mail gate stays as the fleet box's files set it. For a stop that survives a rollback or a lost setting, use the fleet box's kill switch (README: Fleet coordination, The stall watch).",
  },
  log: {
    label: 'Log only',
    does: 'Every notice the watch would send is recorded, and nothing is sent.',
  },
  check: {
    label: 'Check silent workers',
    does: 'Adds a check mail to a worker that has been quiet past the quiet time. No one else is told.',
  },
  alert: {
    label: 'Alert coordinator and you',
    does: "Adds a report to the worker's coordinator after an unanswered check, then a push to you, and pushes to you about a long usage limit, a dialog left open, and a coordinator that has held a run too long. Pushes arrive wherever push notifications are switched on in Settings.",
  },
  deliver: {
    label: 'Deliver mail to busy sessions',
    does: "Adds delivery to a busy session whose main turn has ended, so mail stops waiting for that session's background work.",
  },
  all: {
    label: 'Everything',
    does: "Adds the further checks: a worker that died, froze or failed, lost background work, a coordinator not reading its mail, mail stuck in the queue, and a turn record that cannot be read. A worker's quiet time then follows its turn record, backs off for a worker that keeps answering 'working', and holds while its subagents run.",
  },
} as const;
export type StallLevel = keyof typeof STALL_LEVEL_TEXT;
/** Ladder order, derived; never a hand list. */
export const STALL_LEVELS = Object.keys(STALL_LEVEL_TEXT) as StallLevel[];
/** What a write may choose: a level, or `follow`, the default, which lets the fleet box's files decide. */
export type StallLevelChoice = StallLevel | 'follow';
/** The one level guard, for the write and the read. Its body is pinned (§6.1): never `in` and never `MAP[v]`, because
 *  `'toString' in` any object literal is true, the trap `isReclaimRefuseCode` records. */
export function isStallLevelChoice(v: unknown): v is StallLevelChoice {
  return typeof v === 'string' && (v === 'follow' || (STALL_LEVELS as readonly string[]).includes(v));
}

/** The five confirm stages, in §5.1's order: each one thing the watch or the mail gate does that the operator is told
 *  about before it starts, with its name, the line a confirm shows when it stops, and the gate it waits on. `gate` is
 *  `null` for the busy gate alone, and that `null` has one meaning: it adds no delivery, so nothing waits on it. */
export const STALL_STAGE_TEXT = {
  checks: {
    name: 'Checks on quiet workers',
    stops: 'Checks on quiet workers stop.',
    gate: 'A review of the notices recorded in shadow finds the would-be checks true or harmless.',
  },
  alerts: {
    name: 'Reports to coordinators and pushes to you',
    stops: 'Reports to coordinators and pushes to you stop.',
    gate: 'Checks have run live for a while, and the reports and pushes recorded in shadow look right. A known limit: a dialog left open can be pushed to you again, at most once each quiet time.',
  },
  busyDelivery: {
    name: 'Busy delivery',
    stops: 'Busy delivery stops.',
    gate: 'The busy-gate log has been reviewed (it is in the server log, not on this page), and a pane still showing a running turn has been seen to refuse the delivery.',
  },
  busyGate: {
    name: 'The busy gate',
    stops: 'The busy gate stops.',
    gate: null,
  },
  wave2: {
    name: 'The further checks',
    stops: "The further checks stop, and a worker's quiet time goes back to the plain clock: no back-off, and no hold while its subagents run or just after a restart. Some checks, and while reports to coordinators are on some reports, can fall due at the next sweep.",
    gate: "Busy delivery is on and its log has been reviewed (in the server log, not on this page); the stuck-mail and coordinator-not-reading checks have been re-measured in shadow; and repeated pushes about sessions on no run have been counted while alerts were on. This step also moves each worker's quiet time onto its turn record, which shadow never measured.",
  },
} as const satisfies Record<string, { readonly name: string; readonly stops: string; readonly gate: string | null }>;
export type StallStage = keyof typeof STALL_STAGE_TEXT;
/** §5.1's order, derived; every list of stages on the wire (`waitsOn`, `turnsOn`, `turnsOff`) is in it. */
export const STALL_STAGES = Object.keys(STALL_STAGE_TEXT) as StallStage[];

/** The stages a resolved arming has on, derived server-side (`stallStages`), so no mail-mode word crosses the wire.
 *  `runs` is the lane running: the Now block reads it, and it is not a confirm stage. */
export interface StallWatchStages { runs: boolean; checks: boolean; alerts: boolean; busyDelivery: boolean; busyGate: boolean; wave2: boolean }
/** What the fleet box holds, as camelCase booleans, never file names. */
export interface StallHeld { watchOff: boolean; mailOff: boolean; gateStrict: boolean; wave2HeldByStrict: boolean }
/** The Next step, as three words, so "no Next step" and "the top" are never one `null`. */
export type StallNextStep =
  | { kind: 'none' }                                                 // custom, or the reading differs from the choice
  | { kind: 'top' }                                                  // at Everything
  | { kind: 'step'; level: StallLevel; waitsOn: StallStage[] };      // §5.1 order, gated stages only
export type StallWatchEffective =
  | { measured: false }                                              // unlistable registry: "unknown", never "off"
  | { measured: true; level: StallLevel | 'custom'; files: StallLevel | 'custom';
      source: 'chosen' | 'files' | 'held'; stages: StallWatchStages; held: StallHeld;
      next?: StallNextStep; filesExceed?: boolean };                 // left out only if the view's second try caught
export type StallWriteEffect =
  | { measured: false }                                              // unlistable registry: cannot be shown
  | { measured: true; turnsOn: StallStage[]; turnsOff: StallStage[]; leavesWave2: boolean;
      heldByBox: boolean;                                            // a turn-on held by the kill switch or strict gate
      quietLowered: boolean; filesExceed: boolean;                   // filesExceed: for the state after the write
      before: StallWatchStages; after: StallWatchStages;             // the resolved reading, mail off read as on
      quietMs: { before: number; after: number }; mailOff: boolean };
/** The POST's 409 body: the effect the server measured at the write, and the key a re-POST sends back as `confirm`. */
export interface StallConfirmRequired { ok: false; error: 'confirm-required'; effect: StallWriteEffect; effectKey: string }

/** The four notice-count rows, by role (§11), in this key order on the wire, zeros included. */
export const STALL_NOTICE_TEXT = {
  checks: 'Stall checks to quiet workers',
  wakes: 'Notices to a session about its own failed turn or lost background work',
  reports: 'Reports to a coordinator, or pushes to you when the run has no coordinator or coordination is paused',
  pushes: 'Pushes to you',
} as const;
export interface StallNoticeCount { row: keyof typeof STALL_NOTICE_TEXT; sent: number; shadow: number }

/** How the read of the settings row went: a row, no row, or a read that failed. Its two failure words are
 *  `ReadFailure`'s (`shared/agent-protocol.ts`), widened by `row`. This file cannot import that type (its three
 *  type-only imports are pinned, `peers-claims-l0.test.ts`), so the union is DERIVED from this array, as `STAMP_READS`
 *  does, and `stall-settings.test.ts` holds `Exclude<StallStored, 'row'>` EQUAL to `ReadFailure` at compile time. */
export const STALL_STORED_STATES = ['row', 'absent', 'unreadable'] as const;
export type StallStored = (typeof STALL_STORED_STATES)[number];

/** `GET`/`POST /api/coord/stall-watch`'s answer (§10, §12). `chosen` reports each stored field's own state, and
 *  `stored` tells an absent row from an unreadable one: no absent row is ever sent as `follow` or `'default'`. */
export interface StallWatchView {
  chosen: { level: StallLevelChoice | 'unreadable'; quietMs: number | 'default' | 'unreadable';
            updatedAt: number | null; stored: StallStored };
  effective: StallWatchEffective;
  quiet: { effectiveMs: number; builtInMs: number; minMs: number; maxMs: number; stepMs: number;
           source: 'chosen' | 'default' };
  notices: { ok: true; since: number; windowMs: number; counts: StallNoticeCount[] } | { ok: false };
  fallback: { at: number; reason: string } | null;                   // the builder's own catch, or stallFallback()
}
/** A partial write: an omitted field keeps its stored value; `'default'` returns to the built-in. No `null` crosses. */
export interface StallWatchRequest { level?: StallLevelChoice; quietMs?: number | 'default'; confirm?: string }

/** The default choice's label: the fleet box's files decide, as they did before this section existed. */
export const STALL_FOLLOW_LABEL = "Follow the fleet box's files";
/** The source line, from `effective.source`. `held`'s `{reason}` is one of `STALL_HELD_REASON`. */
export const STALL_SOURCE_TEXT = {
  files: "Following the fleet box's files",
  chosen: 'Chosen here',
  held: 'Chosen: {label}, held back by the fleet box ({reason})',
} as const;
export const STALL_HELD_REASON = {
  watchOff: 'its kill switch is on',
  gateStrict: 'its mail gate is set to strict',
} as const;
/** One line per `StallHeld` flag, worded without file names (§13). */
export const STALL_HELD_TEXT = {
  watchOff: 'A kill switch on the fleet box has the watch off, whatever is chosen here.',
  mailOff: 'Mail is switched off on the fleet box: no mail is delivered, and checks and reports are held. Pushes to you still go.',
  gateStrict: 'The mail gate is set to strict on the fleet box: busy delivery and the busy gate are off.',
  wave2HeldByStrict: 'The strict mail gate also holds the further checks off, because they need busy delivery.',
} as const satisfies Record<keyof StallHeld, string>;
/** The busy gate's Now sentence: `holds` always while `stages.busyGate`, then `logs` while busy delivery is off. */
export const STALL_BUSY_GATE_TEXT = {
  holds: 'The mail gate also holds mail for a session whose main turn is running.',
  logs: 'It also logs what busy delivery would do.',
} as const;
export const STALL_BUSY_GATE_OFF_TEXT = "The busy gate is off: the fleet box's files do not turn it on.";
/** §6.4's warning, shown while alerts and the further checks are on with busy delivery off, and mail is not off. */
export const STALL_HAZARD_TEXT = 'Alerts and the further checks are on while busy delivery is off: the stuck-mail and coordinator-not-reading pushes will mistake a busy session for a deaf one.';
export const STALL_FILES_EXCEED_TEXT = "The fleet box's files arm more than this choice. If the choice stops applying (a rollback, a lost setting), they apply again, and notices recorded in shadow meanwhile go out.";
/** The five stored-choice lines (§13): exactly one shows whenever the stored row does not apply whole. `both` is both
 *  fields unreadable in a row that reads; `level` and `quiet` are one field alone. */
export const STALL_STORED_TEXT = {
  absent: "No stored choice was found: following the fleet box's files and the built-in quiet time.",
  unreadable: "The stored choice could not be read: following the fleet box's files and the built-in quiet time.",
  level: "The stored level could not be read, so neither stored choice applies: following the fleet box's files and the built-in quiet time.",
  quiet: "The stored quiet time could not be read, so neither stored choice applies: following the fleet box's files and the built-in quiet time.",
  both: "The stored level and quiet time could not be read, so neither applies: following the fleet box's files and the built-in quiet time.",
} as const;
export const STALL_FALLBACK_TEXT = "Your choice is not being applied ({reason}); the watch is following the fleet box's files and the built-in quiet time.";
export const STALL_NOT_AVAILABLE_TEXT = "Stall-watch settings are not available on this server. Any choice shown before is no longer applied; the watch follows the fleet box's files.";
export const STALL_NEXT_TEXT = { lead: 'Next step:', waitsOn: 'Waits on:', top: 'Top of the ladder.' } as const;
/** §7's note under the quiet-time control: no number and no level label in it. */
export const STALL_QUIET_NOTE = "This also sets when a dialog left open is pushed to you, how far apart repeat pushes about one open dialog can be, and, while the further checks are on, the base of the back-off for a worker that keeps answering 'working'. While they are off there is no back-off and no hold while subagents run, so a worker that keeps waiting is checked once every quiet time.";
/** The confirm sheet's lines (§13), chosen by the PWA's `stallConfirmLines` from the server's `StallWriteEffect`.
 *  Slots: `{label}` a level's label or `STALL_FOLLOW_LABEL`, `{value}` a formatted quiet time, `{name}` and `{gate}` a
 *  stage's, `{detail}` the server's refusal detail. */
export const STALL_CONFIRM_TEXT = {
  title: 'Set the stall watch to {label}?',
  followTitle: '{label}?',
  quietTitle: 'Set the quiet time to {value}?',
  confirm: 'Set',
  turnsOn: '{name} turns on. Waits on: {gate}',
  turnsOnFree: '{name} turns on.',
  backOn: "{name} turns back on: the fleet box's files arm it.",
  heldByBox: 'Held by the fleet box until its kill switch or strict gate is removed; it applies then without asking again.',
  due: 'At the next sweep every notice now due is sent, including ones recorded in shadow; later rungs follow on their own clocks.',
  dueFromOff: 'Off recorded nothing. At the next sweep every worker already quiet past the quiet time is checked, and a worker whose check went out before Off gets the next notice now due.',
  dueMail: 'Mail held for a busy session whose main turn has ended is delivered at the next mail sweep.',
  dueMailOff: 'Pushes to you now due go out at the next sweep, including ones recorded in shadow; checks and reports wait until mail is back.',
  dueMailOffHeld: 'Checks and reports now due wait until mail is back.',
  dueMailBack: 'Mail held for a busy session whose main turn has ended is delivered once mail is back.',
  quietDue: 'Every worker already quiet past {value} is checked at the next sweep.',
  quietDueAll: "At the next sweep every worker whose turn record has been quiet past {value} is checked, unless it is backed off for answering 'working' or its subagents are running.",
  quietDueMailOff: 'Every worker already quiet past {value} falls due for a check at the next sweep, and is held until mail is back.',
  quietDueAllMailOff: "Every worker whose turn record has been quiet past {value} falls due for a check, unless it is backed off for answering 'working' or its subagents are running, and is held until mail is back.",
  quietRecorded: 'Every worker already quiet past {value} has a check recorded in shadow at the next sweep; nothing is sent.',
  quietOff: 'The watch is off, so nothing falls due until it runs.',
  quietRepeat: 'While the further checks are off, a worker that keeps waiting is checked every {value}, because no back-off applies.',
  quietRepeatMailOff: 'While the further checks are off, a worker that keeps waiting falls due for a check every {value}, because no back-off applies, and is held until mail is back.',
  quietDialogs: 'A dialog left open longer than {value} is pushed to you from the next sweep, and repeat pushes about one open dialog can come {value} apart.',
  unknown: "The fleet box's files could not be read, so what this choice turns on cannot be shown.",
  refused: 'Nothing was changed: {detail}',
} as const;
export const STALL_RUNLESS_FOOTNOTE = 'Counts notices on runs only. Notices about a session on no run, or about a coordinator itself, sent or shadow, are not counted here; shadow ones appear only in the server log.';
/** The section's headings and small words. `counts` takes the window from the reply's `windowMs`, so no text copies
 *  it. `builtIn` and `chosenHere` follow a quiet value; `builtInOption` is the select's first option. */
export const STALL_SECTION_TEXT = {
  title: 'Stall watch',
  level: 'Level',
  quiet: 'Quiet time before a worker check',
  builtIn: '{value} (built-in)',
  builtInOption: 'Built-in ({value})',
  chosenHere: '{value} (chosen here)',
  range: '{min} to {max}',
  counts: 'Last {window}',
  sent: '{count} sent',
  shadow: '{count} shadow',
  countsFailed: 'The notice counts could not be read.',
  custom: 'Custom',
  unknown: 'Unknown — the fleet registry could not be read',
  theySay: 'they say: {level}',
  theySayUnknown: 'they say: unknown',
  stale: 'The latest read failed — this is the last answer that landed.',
  unread: 'The stall watch settings could not be read — the screen tries again every minute.',
} as const;
```

Check that the file only grew: `git diff -U0 shared/api.ts | grep '^@@'` prints exactly one hunk,
`@@ -9096,0 +9097,232 @@ export const MAIL_REPLAY_MS = 600_000;`, and `wc -l shared/api.ts` reads `9328`.

- [ ] **Step 5: Create `server/src/coord/stallsettings.ts`**

```ts
import { STALL_LEVELS, STALL_STAGES, isStallLevelChoice } from '../../../shared/api.js';
import type { StallHeld, StallLevel, StallNextStep, StallStage, StallStored, StallWatchStages } from '../../../shared/api.js';
import { STALL_QUIET_MS, stallArmingOf } from './stall.js';
import type { StallArming } from './stall.js';
import { mailTurnModeOf, mailTurnReadsMark } from '../turnidle.js';
import type { MailTurnMode } from '../turnidle.js';
/**
 * STALL WATCH SETTINGS, the pure half (design 2026-10-05 §5, §6, §7, §10, §12). L1: no clock, no I/O, no `node:`
 * import, no fastify, no store handle and no `db.js`. `stall-settings.test.ts` pins that, in `stall-vocabulary.test.ts`'s
 * idiom: value imports come only from L0 (`shared/api.ts`), `./stall.js` and `../turnidle.js`.
 *
 * What lives here, once:
 * - the ladder's flag and mail-mode columns (`STALL_LADDER`), keyed by L0's `StallLevel`, whose labels and texts are
 *   L0's (`STALL_LEVEL_TEXT`), so a level added to one Record and not the other is a compile error;
 * - the quiet time's bounds and step, and the notice-count window, shipped on the reply so the PWA has no copy;
 * - `isStallQuietMs`, the one validity predicate for the write and the read (L0's `isStallLevelChoice` is the level's);
 * - the settings row's port (`StallSettingsRow`, `StallSettingsRead`), declared BY THE CONSUMER as `stall.ts` declares
 *   `StallRunRow`; `store.ts` implements it, and `parseStallSettings` decides what every stored value means;
 * - the resolver both sweeps and the view call, and the readers the view composes.
 *
 * No marker name is spelled here. The box arming composes `stall.ts`'s `stallArmingOf` and `turnidle.ts`'s
 * `mailTurnModeOf`, each of which spells its own names, and `mail-disabled` arrives as a boolean the caller measured
 * with its own constant. `stallUnheldBoxOf` finds the strict file by asking `mailTurnModeOf` about each name alone.
 *
 * `mail-routes.test.ts` scans `server/src/coord` for quoted kebab words: every one this file, the settings store and
 * the settings routes spell is declared through `isStallSettingsKebab`, one more union beside `isStallKebab`.
 */

// ── the ladder ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One ladder row. `off` carries no flags and no mode: the resolver reads it as "stop the lane, leave the box's
 *  mode". Narrowing the key does not narrow the value, so every reader narrows on `row.disabled` before it reads a
 *  flag or the mode. */
export type StallLadderRow =
  | { readonly disabled: true }
  | { readonly disabled: false; readonly live: boolean; readonly escalate: boolean; readonly w2Live: boolean; readonly mailMode: 'busy-shadow' | 'busy' };
type StallRunningRow = Extract<StallLadderRow, { readonly disabled: false }>;

/** §5's table. Log only, Check and Alert keep the busy gate (`busy-shadow`), as approved (§19 Q6); Deliver and
 *  Everything deliver on busy. */
export const STALL_LADDER: Readonly<Record<StallLevel, StallLadderRow>> = {
  off: { disabled: true },
  log: { disabled: false, live: false, escalate: false, w2Live: false, mailMode: 'busy-shadow' },
  check: { disabled: false, live: true, escalate: false, w2Live: false, mailMode: 'busy-shadow' },
  alert: { disabled: false, live: true, escalate: true, w2Live: false, mailMode: 'busy-shadow' },
  deliver: { disabled: false, live: true, escalate: true, w2Live: false, mailMode: 'busy' },
  all: { disabled: false, live: true, escalate: true, w2Live: true, mailMode: 'busy' },
};

/** A running row as an arming with no held flag: what the level does on a box with no kill file, no strict gate and
 *  mail on. The resolver's `free` and `stallNextStep`'s next level both read a row through it (§20's conversion). */
function stallRowArming(run: StallRunningRow): StallBoxArming {
  return { disabled: false, live: run.live, escalate: run.escalate, w2Live: run.w2Live, mailDisabled: false, mailMode: run.mailMode };
}

// ── the quiet time and the window ────────────────────────────────────────────────────────────────────────────────

/** The quiet time's range, inclusive, and its step (§7, departure `quiet-half-hour-steps` (D-4026)). The built-in,
 *  `STALL_QUIET_MS`, stays in `stall.ts` and is one of the steps. */
export const STALL_QUIET_MIN_MS = 30 * 60_000;
export const STALL_QUIET_MAX_MS = 12 * 3_600_000;
export const STALL_QUIET_STEP_MS = 30 * 60_000;
/** The notice-count window (§11). The reply carries it, and the counts heading takes it from there. */
export const STALL_NOTICE_WINDOW_MS = 48 * 3_600_000;

/** The one validity predicate for a quiet time, called by the write's decision and by the read's parse, so the read
 *  never accepts a value the write would refuse. A value outside it is refused, or read unreadable, never clamped. */
export function isStallQuietMs(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v % STALL_QUIET_STEP_MS === 0
    && v >= STALL_QUIET_MIN_MS && v <= STALL_QUIET_MAX_MS;
}

// ── the stored row: port and parse ───────────────────────────────────────────────────────────────────────────────

/** The settings row as the store reads it, every value `unknown`: the parse decides what each means, `updatedAt`
 *  included. The store reads with `setReadBigInts(true)`, so an INTEGER column may arrive as a `bigint`. */
export interface StallSettingsRow { readonly level: unknown; readonly quietMs: unknown; readonly updatedAt: unknown }
/** The store's read: a row, no row, or a read that failed (a missing table, a driver throw). Three words, never one
 *  `null`. */
export type StallSettingsRead =
  | { readonly kind: 'row'; readonly row: StallSettingsRow }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** Each field parsed on its own, so the wire can report each field's own state. When `stored` is not `'row'`, both
 *  fields parse `unreadable` (with `undefined` as the raw value: there is none) and `updatedAt` parses `null`;
 *  `stored` tells the two cases apart. Neither absent nor unreadable ever folds into `follow` or `default`. */
export interface StallSettingsParsed {
  readonly stored: StallStored;
  readonly level: { readonly kind: 'follow' } | { readonly kind: 'chosen'; readonly level: StallLevel } | { readonly kind: 'unreadable'; readonly token: unknown };
  readonly quiet: { readonly kind: 'default' } | { readonly kind: 'set'; readonly ms: number } | { readonly kind: 'unreadable'; readonly value: unknown };
  readonly updatedAt: number | null;
}

const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
/** A `bigint` inside the safe-integer range becomes a `number`; any other `bigint` stays one, which every predicate
 *  below refuses, so it reads unreadable. Every other value passes through as read. */
function fromStore(v: unknown): unknown {
  if (typeof v !== 'bigint') return v;
  return v >= SAFE_MIN && v <= SAFE_MAX ? Number(v) : v;
}

/** The read's one parse (§6.1). The level goes through `isStallLevelChoice` before anything indexes `STALL_LADDER`;
 *  the quiet time through `isStallQuietMs` after the `bigint` conversion, with SQL `NULL` the built-in; `updatedAt` is
 *  a safe integer or `null`. A field that fails is `unreadable`, carrying the raw value, never clamped or guessed. */
export function parseStallSettings(read: StallSettingsRead): StallSettingsParsed {
  if (read.kind !== 'row') {
    return { stored: read.kind, level: { kind: 'unreadable', token: undefined }, quiet: { kind: 'unreadable', value: undefined }, updatedAt: null };
  }
  const { level: rawLevel, quietMs: rawQuiet, updatedAt: rawAt } = read.row;
  const level: StallSettingsParsed['level'] = !isStallLevelChoice(rawLevel) ? { kind: 'unreadable', token: rawLevel }
    : rawLevel === 'follow' ? { kind: 'follow' } : { kind: 'chosen', level: rawLevel };
  const q = fromStore(rawQuiet);
  const quiet: StallSettingsParsed['quiet'] = rawQuiet === null ? { kind: 'default' }
    : isStallQuietMs(q) ? { kind: 'set', ms: q } : { kind: 'unreadable', value: rawQuiet };
  const at = fromStore(rawAt);
  return { stored: 'row', level, quiet, updatedAt: typeof at === 'number' && Number.isSafeInteger(at) ? at : null };
}

// ── the box arming ───────────────────────────────────────────────────────────────────────────────────────────────

/** A resolved arming: `StallArming` with `mailDisabled` and `mailMode` always set. Every branch of the resolver keeps
 *  or sets both. */
export type StallBoxArming = StallArming & { readonly mailDisabled: boolean; readonly mailMode: MailTurnMode };

/** The fleet box's files alone, from one registry listing: exactly the expression `sweepStalls` builds inline today.
 *  `mailDisabled` is the caller's measurement with its own constant, so this file never spells that name. */
export function stallBoxArmingOf(names: readonly string[], mailDisabled: boolean): StallBoxArming {
  return { ...stallArmingOf(names), mailDisabled, mailMode: mailTurnModeOf(names) };
}

/** What a stored choice arms with no kill file, no strict gate and mail on (§10's unheld reading): the files with
 *  those three cleared, so the mail mode is the one the files give below strict. The strict file is found by asking
 *  `mailTurnModeOf` about each name alone; the two kill files are cleared as flags. */
export function stallUnheldBoxOf(names: readonly string[]): StallBoxArming {
  return { ...stallBoxArmingOf(names.filter((n) => mailTurnModeOf([n]) !== 'strict'), false), disabled: false };
}

// ── the readers ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The stages a resolved arming has on (§12). `busyDelivery` and `busyGate` read false while mail is switched off,
 *  because the mail gate does not run then; `busyGate` is the turn-marker read `busy` and `busy-shadow` share, asked
 *  of `mailTurnReadsMark` so the rule is the gate's own (departure `stages-on-the-wire-not-modes` (D-4032)). */
export function stallStages(a: StallArming): StallWatchStages {
  const runs = !a.disabled;
  const mode = a.mailMode ?? 'shell';
  const mailOn = a.mailDisabled !== true;
  return {
    runs,
    checks: runs && a.live,
    alerts: runs && a.live && a.escalate,
    busyDelivery: mode === 'busy' && mailOn,
    busyGate: mailTurnReadsMark(mode) && mailOn,
    wave2: runs && a.w2Live === true,
  };
}

/** The stages with mail switched off read as on: a stored choice arms them for the moment mail returns (§5.1). Every
 *  comparison of two readings goes through this, never through `stallStages`. */
export function armedStages(a: StallArming): StallWatchStages {
  return stallStages({ ...a, mailDisabled: false });
}

/** `runs` and the five confirm stages, compared one by one. */
function sameStages(a: StallWatchStages, b: StallWatchStages): boolean {
  return a.runs === b.runs && STALL_STAGES.every((s) => a[s] === b[s]);
}

/** Reading a level back (§6.4). The kill file with busy delivery on is `custom`, because `off` must not stand for
 *  both. Otherwise the one step, among the levels other than `off`, whose flags match and whose "delivers on busy"
 *  matches; `shell`, `busy-shadow` and `strict` all count as not delivering on busy, so the busy gate never splits a
 *  level (departure `files-level-match-ignores-the-busy-gate` (D-4022)). Anything else is `custom`. */
export function stallLevelOf(a: StallArming): StallLevel | 'custom' {
  const deliversOnBusy = (a.mailMode ?? 'shell') === 'busy';
  if (a.disabled) return deliversOnBusy ? 'custom' : 'off';
  for (const level of STALL_LEVELS) {
    const row = STALL_LADDER[level];
    if (row.disabled) continue;
    if (row.live === a.live && row.escalate === a.escalate && row.w2Live === (a.w2Live === true)
      && (row.mailMode === 'busy') === deliversOnBusy) return level;
  }
  return 'custom';
}

// ── the resolver ─────────────────────────────────────────────────────────────────────────────────────────────────

/** One resolution: what the sweeps apply (`arming`, `quietMs`) and what the view reads. `chosen` is the level that
 *  applies, or `null` under Follow or a row that does not apply whole. `effective` is what the watch actually does,
 *  `files` what the fleet box's files alone say. */
export interface StallResolved {
  readonly arming: StallBoxArming;
  readonly quietMs: number;
  readonly quietSource: 'chosen' | 'default';
  readonly chosen: StallLevel | null;
  readonly levelSource: 'chosen' | 'files' | 'held';
  readonly effective: StallLevel | 'custom';
  readonly files: StallLevel | 'custom';
  readonly held: StallHeld;
}

/** The one resolver both sweeps and the view call (§6.2), over flags only.
 *  - **Whole-row fallback** (§19 Q11): a row that is absent or unreadable, or has either field unreadable, applies
 *    nothing; then the arming is the box object ITSELF, today's behaviour exactly, and the quiet time the built-in.
 *  - **Precedence** (§6.3): the lane's kill file returns the box wholesale, mail mode included; a chosen `off` stops
 *    the lane and keeps the box's mode; otherwise the chosen row decides every flag and the mode, except that
 *    `mail-disabled` passes through untouched and strict keeps the mail gate and holds the wave-2 step off, because
 *    that step needs busy delivery (departure `strict-holds-the-wave-2-step` (D-4023)).
 *  - **`held` is causal:** set only when a held flag changed what the chosen running level does, judged by comparing
 *    its stages with no held flag (`free`) against the resolved ones, both with mail off read as on. A chosen `off`
 *    is never `held`. */
export function resolveStallWatch(box: StallBoxArming, settings: StallSettingsParsed): StallResolved {
  const applies = settings.stored === 'row' && settings.level.kind !== 'unreadable' && settings.quiet.kind !== 'unreadable';
  const quietMs = applies && settings.quiet.kind === 'set' ? settings.quiet.ms : STALL_QUIET_MS;
  const quietSource = applies && settings.quiet.kind === 'set' ? 'chosen' : 'default';
  const chosen = applies && settings.level.kind === 'chosen' ? settings.level.level : null;
  const strict = box.mailMode === 'strict';
  const row = chosen === null ? null : STALL_LADDER[chosen];
  const run = row !== null && row.disabled === false ? row : null;
  let arming: StallBoxArming;
  if (chosen === null) arming = box;
  else if (box.disabled) arming = box;
  else if (run === null) arming = { ...box, disabled: true };
  else {
    arming = {
      disabled: false,
      live: run.live,
      escalate: run.escalate,
      w2Live: run.w2Live && !strict,
      mailDisabled: box.mailDisabled,
      mailMode: strict ? 'strict' : run.mailMode,
    };
  }
  const free = run === null ? null : stallRowArming(run);
  const heldBack = free !== null && !sameStages(armedStages(arming), armedStages(free));
  return {
    arming,
    quietMs,
    quietSource,
    chosen,
    levelSource: chosen === null ? 'files' : heldBack ? 'held' : 'chosen',
    effective: stallLevelOf(arming),
    files: stallLevelOf(box),
    held: { watchOff: box.disabled, mailOff: box.mailDisabled === true, gateStrict: strict, wave2HeldByStrict: run !== null && run.w2Live && strict },
  };
}

/** The Next step (§10). `none` for `custom`, and whenever a chosen level reads as something else (held lower, or a
 *  chosen `off` over a busy file); `top` at Everything; otherwise the next level, waiting on the stages its own row
 *  turns on that the current arming has off, both read through `armedStages`, in §5.1's order, leaving out the busy
 *  gate, which has no gate. */
export function stallNextStep(arming: StallArming, chosen: StallLevel | null): StallNextStep {
  const level = stallLevelOf(arming);
  if (level === 'custom' || (chosen !== null && level !== chosen)) return { kind: 'none' };
  const next = STALL_LEVELS[STALL_LEVELS.indexOf(level) + 1];
  if (next === undefined) return { kind: 'top' };
  const row = STALL_LADDER[next];
  if (row.disabled) return { kind: 'step', level: next, waitsOn: [] };
  const now = armedStages(arming);
  const then = armedStages(stallRowArming(row));
  return { kind: 'step', level: next, waitsOn: STALL_STAGES.filter((s) => then[s] && !now[s] && s !== 'busyGate') };
}

/** The stages that send something or deliver mail. The busy gate only holds mail longer, so it is never compared. */
const STALL_SENDING_STAGES: readonly StallStage[] = STALL_STAGES.filter((s) => s !== 'busyGate');

/** Whether the fleet box's files arm more than the choice (§10): never while the files decide; otherwise true when a
 *  sending stage is on in the box's own stages and off in the resolved ones, both read through `armedStages`. */
export function stallFilesExceed(box: StallArming, resolved: StallResolved): boolean {
  if (resolved.levelSource === 'files') return false;
  const files = armedStages(box);
  const now = armedStages(resolved.arming);
  return STALL_SENDING_STAGES.some((s) => files[s] && !now[s]);
}

// ── the kebab words ──────────────────────────────────────────────────────────────────────────────────────────────

/** Every quoted kebab word this file, the settings store and the settings routes spell: a mail-gate mode in the
 *  ladder, the POST's refusal code, and the feed actor when the auth gate is unarmed. None is a mail rejection or a
 *  run refusal. `mail-routes.test.ts`'s scan admits them through this guard, never through its allowlist. */
const STALL_SETTINGS_KEBABS: readonly string[] = ['busy-shadow', 'confirm-required', 'flag-off'];
export function isStallSettingsKebab(token: string): boolean {
  return STALL_SETTINGS_KEBABS.includes(token);
}
```

- [ ] **Step 6: Declare the new kebab words to `mail-routes.test.ts`'s scan**

Without this, `STALL_LADDER`'s `'busy-shadow'` reds the scan. Measured on the prototype with the edit (b) below left
out:
`./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'the rejection table is total'` gives `Tests  1 failed |
3 passed | 55 skipped (59)`, and the failing row is `every quoted kebab token in server/src/coord that looks like a
code is declared`.

All three edits are in `server/test/mail-routes.test.ts`. Step 1 measured each before-text once.

(a) ≈20, the import:
`import { isStallKebab } from '../src/coord/stall.js';` →

```ts
import { isStallKebab } from '../src/coord/stall.js';
import { isStallSettingsKebab } from '../src/coord/stallsettings.js';
```

(b) ≈831, the twelfth union's last line, `        || isStallKebab(tok),` →

```ts
        || isStallKebab(tok)
        // STALL WATCH SETTINGS, W1: the THIRTEENTH union, checked together and
        // never merged, on the standing rule `enter-ignored` above states.
        // `coord/stallsettings.ts` spells a mail-gate mode in its ladder, and
        // the settings routes spell the POST's refusal code and the feed actor
        // of an unarmed gate. None is a mail rejection or a run refusal: they
        // are admitted through the exported guard, never NOT_CODES, for the
        // reason every union above gives.
        || isStallSettingsKebab(tok),
```

(c) ≈832, in the failure message: `UpdateStoreRefuseCode, child-reclaim word or stall-watch word`).toBe(true);` →
`UpdateStoreRefuseCode, child-reclaim word, stall-watch word or stall-watch settings word`).toBe(true);`

- [ ] **Step 7: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/stall-settings.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/mail-routes.test.ts | grep -E '^ +Tests '
```

Expected (measured): `Tests  62 passed (62)` and `Tests  59 passed (59)`.

- [ ] **Step 8: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/tsc --noEmit -p . ; echo rc=$?
./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json ; echo rc=$?
cd ../pwa && ./node_modules/.bin/tsc --noEmit -p . ; echo rc=$?
```

Expected (measured): `rc=0` three times. The PWA bundles `shared/api.ts`, so its typecheck covers the L0 block too.

- [ ] **Step 9: The regression suites, and the README citation instrument**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in single-definition stall-vocabulary turnidle topology-clean peers-claims-l0; do
  ./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests '; done
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/typecheck-tests.test.ts | grep -E '^ +Tests '
```

Expected (measured, foreground, timeout 600000 ms): `274 passed (274)`, `179 passed (179)`, `54 passed (54)`,
`55 passed (55)` and `19 passed (19)`; then `7 passed | 328 skipped (335)`; then `12 passed (12)`. The instrument's
`THE CITATION DEBT` row holds the per-file census (`'shared/api.ts': 1`) and `README HAS ITS OWN CENSUS ENTRY` holds
the empty README entry, so the append is proven anchor-neutral. `session-hook` and `typecheck-tests` are known load
flakes: re-run a red one alone, with `--testTimeout=240000`, before calling it real.

- [ ] **Step 10: The mutation table**

Apply each mutation alone to the committed tree, run the named suite
(`./node_modules/.bin/vitest run test/<file>` from `server/`), record the count, restore, and finish with
`git status --porcelain` empty. "before → after" is exact text, each before-text occurring once in its file.
Unmutated: stall-settings `62 passed (62)`, single-definition `274 passed (274)`, mail-routes `59 passed (59)`.

| # | Guard | Mutation (file: before → after) | Red in | Measured |
|---|---|---|---|---|
| M1 | the lane's kill file restores the box wholesale | `stallsettings.ts`: delete the line `  else if (box.disabled) arming = box;` | stall-settings | `1 failed \| 61 passed`: a chosen deliver over the kill file keeps the box's mail mode, never busy, and reads held |
| M1b | `off` is never read while busy delivery is on | `if (a.disabled) return deliversOnBusy ? 'custom' : 'off';` → `if (a.disabled) return 'off';` | stall-settings | `2 failed \| 60 passed`: a chosen off, or the kill file, over a box busy file reads custom; a chosen off under the kill file, with and without a box busy file, stays chosen |
| M2 | `mail-disabled` passes through (L1 half) | `      mailDisabled: box.mailDisabled,` → `      mailDisabled: false,` | stall-settings | `1 failed \| 61 passed`: every running level carries the box's mailDisabled, and mailOff is held |
| M3 | strict keeps its precedence (L1 half) | `      mailMode: strict ? 'strict' : run.mailMode,` → `      mailMode: run.mailMode,` | stall-settings | `3 failed \| 59 passed`: a chosen deliver or all under strict keeps strict, and reads alert, held; a chosen deliver under strict reads alert, held; a chosen check under strict reads check, held; a chosen deliver under strict: none; custom: none; all: top |
| M3b | strict holds the wave-2 step | `      w2Live: run.w2Live && !strict,` → `      w2Live: run.w2Live,` | stall-settings | `2 failed \| 60 passed`: M3b: a chosen all under strict has w2Live false and wave2HeldByStrict; deliver does not; a chosen deliver or all under strict keeps strict, and reads alert, held |
| M4a | Follow is the box object itself | `  if (chosen === null) arming = box;` → `  if (chosen === null) arming = { ...box };` | stall-settings | `7 failed \| 55 passed`: the six M4 property rows (follow, the seed, an absent row, an unreadable read, and the two mixed rows), and M25's "a chosen level beside an unreadable quiet time: the files, not the level" |
| M4b | Follow alters no field | `  if (chosen === null) arming = box;` → `  if (chosen === null) arming = { ...box, w2Live: box.w2Live === true && box.live };` | stall-settings | `7 failed \| 55 passed`: the same seven rows as M4a |
| M4c | the box arming is today's expression | `return { ...stallArmingOf(names), mailDisabled, mailMode: mailTurnModeOf(names) };` → `return { ...stallArmingOf(names), mailDisabled: false, mailMode: mailTurnModeOf(names) };` | stall-settings | `11 failed \| 51 passed`: the six M4 property rows, stallBoxArmingOf is today's expression over the same listing, each flag alone, every running level carries the box's mailDisabled, a flag that merely stands beside the choice sets nothing, with mail switched off both mail-gate stages read false |
| M5a | no-match reads `custom` | the end of `stallLevelOf`, `  return 'custom';\n}\n\n// ── the resolver` → `  return 'log';\n}\n\n// ── the resolver` | stall-settings | `2 failed \| 60 passed`: escalate without live, and w2-live without escalate, read custom; a chosen deliver under strict: none; custom: none; all: top |
| M5b | `off` never takes part in step matching | `    if (row.disabled) continue;` → `    if (row.disabled) return level;` | stall-settings | `15 failed \| 47 passed`, among them: a running arming with no flags reads log, never off; escalate without live …; each running level resolves to its own ladder row |
| Q1 | the quiet time is a whole step | `&& v % STALL_QUIET_STEP_MS === 0` removed from `isStallQuietMs` | stall-settings | `3 failed \| 59 passed`: accepts the bounds and every step between, and refuses everything else, never clamping; both "a chosen level beside an unreadable quiet time" rows |
| Q2 | the floor is never widened | `v >= STALL_QUIET_MIN_MS && v <= STALL_QUIET_MAX_MS;` → `v >= STALL_QUIET_MIN_MS - STALL_QUIET_STEP_MS && v <= STALL_QUIET_MAX_MS;` | stall-settings | `1 failed \| 61 passed`: accepts the bounds and every step between … |
| Q3 | the ceiling is never widened | the same line → `v >= STALL_QUIET_MIN_MS && v <= STALL_QUIET_MAX_MS + STALL_QUIET_STEP_MS;` | stall-settings | `1 failed \| 61 passed`: accepts the bounds and every step between … |
| M11 | one predicate for write and read (parse half) | `    : isStallQuietMs(q) ? { kind: 'set', ms: q }` → `    : typeof q === 'number' && q >= STALL_QUIET_MIN_MS && q <= STALL_QUIET_MAX_MS ? { kind: 'set', ms: q }` | stall-settings | `3 failed \| 59 passed`: M11: one predicate for write and read …; both "a chosen level beside an unreadable quiet time" rows |
| M11b | one level guard, own keys only | `shared/api.ts`: `  return typeof v === 'string' && (v === 'follow' \|\| (STALL_LEVELS as readonly string[]).includes(v));` → `  return typeof v === 'string' && (v === 'follow' \|\| v in STALL_LEVEL_TEXT);` | stall-settings | `5 failed \| 57 passed`: refuses the prototype names …; has the pinned body (§6.1) …; M11b: a prototype name stored as the level reads unreadable …; an unreadable level beside a set quiet time …; an unreadable level beside a chosen quiet time (M4) |
| M11c-q | a `bigint` quiet time is converted, an oversize one reads unreadable | `  const q = fromStore(rawQuiet);` → `  const q = rawQuiet;` | stall-settings | `1 failed \| 61 passed`: M11c (parse half) … |
| M11c-at | `updatedAt` is a safe integer or `null` | `updatedAt: typeof at === 'number' && Number.isSafeInteger(at) ? at : null };` → `updatedAt: at as number };` | stall-settings | `1 failed \| 61 passed`: M11c (parse half) … |
| M19 | no marker name in new code | `shared/api.ts`: the `checks` gate `… true or harmless.',` → `… true or harmless (stall-watch-live).',` | single-definition | `1 failed \| 273 passed`: stall-watch-live: no shell line names it, and its one TS holder is its definer (server/src/coord/stall.ts) |
| M19-ctl | the new files sit inside the four walked roots | the test's `const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src']` → `const ROOTS = ['shared', 'pwa/src', 'agent/src']` | stall-settings | `1 failed \| 61 passed`: finds shared/api.ts and server/src/coord/stallsettings.ts |
| M19b-fs | L1 purity: no builtin | after `import type { MailTurnMode } from '../turnidle.js';` add `import { readFileSync } from 'node:fs';` and `void readFileSync;` | stall-settings | `2 failed \| 60 passed`: has no fs, no node builtin …; takes value imports only from L0, stall.ts and turnidle.ts … |
| M19b-clock | L1 purity: no clock | `const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);` → `const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER + 0 * Date.now());` | stall-settings | `1 failed \| 61 passed`: has no clock |
| M19b-db | L1 purity: no `db.js` | after the same import add `import { openCoordDb } from './db.js';` and `void openCoordDb;` | stall-settings | `2 failed \| 60 passed`: has no fastify, no reply and no store handle; takes value imports only from … |
| M22a | `busyDelivery` needs mail on | `    busyDelivery: mode === 'busy' && mailOn,` → `    busyDelivery: mode === 'busy',` | stall-settings | `1 failed \| 61 passed`: with mail switched off both mail-gate stages read false; under strict both read false |
| M22b | `busyGate` needs mail on | `    busyGate: mailTurnReadsMark(mode) && mailOn,` → `    busyGate: mailTurnReadsMark(mode),` | stall-settings | `1 failed \| 61 passed`: the same row |
| M22c | `busyGate` is busy and busy-shadow alike | the same line → `    busyGate: mode === 'busy-shadow' && mailOn,` | stall-settings | `2 failed \| 60 passed`: the busy gate is on under busy and busy-shadow …; the lane stages need the lane running … |
| M23a | `watchOff` | `held: { watchOff: box.disabled,` → `held: { watchOff: false,` | stall-settings | `2 failed \| 60 passed`: each flag alone; a chosen deliver over the kill file … |
| M23b | `mailOff` | `mailOff: box.mailDisabled === true,` → `mailOff: false,` | stall-settings | `3 failed \| 59 passed`: each flag alone; a flag that merely stands beside the choice sets nothing; every running level carries the box's mailDisabled … |
| M23c | `gateStrict` | `gateStrict: strict,` → `gateStrict: false,` | stall-settings | `2 failed \| 60 passed`: each flag alone; a chosen deliver or all under strict … |
| M23d | `held` under strict | `levelSource: chosen === null ? 'files' : heldBack ? 'held' : 'chosen',` → `levelSource: chosen === null ? 'files' : box.disabled && run !== null ? 'held' : 'chosen',` | stall-settings | `2 failed \| 60 passed`: a chosen deliver or all under strict …; a chosen deliver under strict reads alert, held … |
| M23e | `held` only when a flag changed the choice | the same line → `levelSource: chosen === null ? 'files' : box.disabled \|\| strict \|\| box.mailDisabled ? 'held' : 'chosen',` | stall-settings | `3 failed \| 59 passed`: a chosen off under the kill file … stays chosen; a flag that merely stands beside the choice sets nothing; every running level carries the box's mailDisabled … |
| M25 | a row applies whole | `const applies = settings.stored === 'row' && settings.level.kind !== 'unreadable' && settings.quiet.kind !== 'unreadable';` → `const applies = settings.stored === 'row';` | stall-settings | `4 failed \| 58 passed`: both M25 rows and both mixed-row M4 rows |
| M28a | files-exceed compares every sending stage | `STALL_STAGES.filter((s) => s !== 'busyGate');` → `STALL_STAGES.filter((s) => s !== 'busyGate' && s !== 'alerts');` | stall-settings | `1 failed \| 61 passed`: today's fleet with a chosen deliver does not exceed; files at alert with a chosen check do |
| M28b | the busy gate is never compared | the same line → `STALL_STAGES;` | stall-settings | `1 failed \| 61 passed`: the busy gate is never compared, even in a resolution where only it differs |
| M28c | files-exceed reads mail off as on | `  const files = armedStages(box);` → `  const files = stallStages(box);` | stall-settings | `1 failed \| 61 passed`: reads mail switched off as on … |
| M28d | files-exceed's direction | `  return STALL_SENDING_STAGES.some((s) => files[s] && !now[s]);` → `  return STALL_SENDING_STAGES.some((s) => now[s] && !files[s]);` | stall-settings | `2 failed \| 60 passed`: today's fleet …; reads mail switched off as on … |
| M30a | `waitsOn` never lists the busy gate | `then[s] && !now[s] && s !== 'busyGate'` → `then[s] && !now[s]` | stall-settings | `3 failed \| 59 passed`: files with no gate file reading log …; alert steps to deliver …; a chosen check under strict keeps its reading … |
| M30b | no step when the reading differs from the choice | `  if (level === 'custom' \|\| (chosen !== null && level !== chosen)) return { kind: 'none' };` → `  if (level === 'custom') return { kind: 'none' };` | stall-settings | `1 failed \| 61 passed`: a chosen deliver under strict: none; custom: none; all: top |
| M30c | the Next step reads mail off as on | `  const now = armedStages(arming);\n  const then` → `  const now = stallStages(arming);\n  const then` | stall-settings | `1 failed \| 61 passed`: mail switched off reads as on: a files-read deliver under mail-disabled still steps to all |
| U1 | the unheld reading clears strict | `names.filter((n) => mailTurnModeOf([n]) !== 'strict')` → `names` | stall-settings | `1 failed \| 61 passed`: the unheld reading clears the kill file, the mail kill file and strict … |
| U2 | the unheld reading clears the kill file | `'strict'), false), disabled: false };` → `'strict'), false) };` | stall-settings | `1 failed \| 61 passed`: the same row |
| M18a | the scan admits the union | `mail-routes.test.ts`: `        \|\| isStallSettingsKebab(tok),` → `        ,` | mail-routes (`-t 'the rejection table is total'`) | `1 failed \| 3 passed \| 55 skipped`: every quoted kebab token in server/src/coord that looks like a code is declared |
| M18b | the union holds `busy-shadow` | `stallsettings.ts`: `['busy-shadow', 'confirm-required', 'flag-off']` → `['confirm-required', 'flag-off']` | mail-routes; stall-settings | `1 failed \| 58 passed` (the same row); `2 failed \| 60 passed`: declares its three words, and only those; every quoted kebab word on a code line … |
| T1 | no duration in a level, stage or gate text | `shared/api.ts`: `… and nothing is sent.',` (Log only's `does`) → `… and nothing is sent for 2 h.',` | stall-settings | `1 failed \| 61 passed`: no does text, stops text or gate carries a duration … |
| T2 | the busy gate alone has no gate | the `busyGate` stage's `    gate: null,` → `    gate: 'Nothing.',` | stall-settings | `1 failed \| 61 passed`: STALL_STAGES is derived from STALL_STAGE_TEXT … only the busy gate has no gate |
| S1 | `StallStored`'s failures are `ReadFailure` | `['row', 'absent', 'unreadable'] as const;` → `['row', 'absent', 'unreadable', 'gone'] as const;` | stall-settings; `tsc -p test/tsconfig.tests.json` | `1 failed \| 61 passed`: StallStored is a row or ReadFailure's two words …; tsc: two `TS2322` errors in `test/stall-settings.test.ts` (the filter row, and `_storedIsReadFailure`: "Type 'true' is not assignable to type 'false'") |
| S2 | the pair is never respelt | `            updatedAt: number \| null; stored: StallStored };` → `            updatedAt: number \| null; stored: 'row' \| 'absent' \| 'unreadable' };` | single-definition | `2 failed \| 272 passed`: does not respell io.ts read-failure pair as the skill vocabulary; is declared in exactly one file, and that file is shared/agent-protocol.ts |

Every row was measured red on the prototype, and the tree was clean after each restore. Two of §17's mutations have
no reachable red at L1, and the table says so rather than inventing one:
- M28's "compare all five stages" equals "include `busyGate`". No resolution `resolveStallWatch` produces has the
  busy gate on in the box and off in the resolved arming. Every running level sets `busy-shadow` or `busy`; Off, the
  kill file and a non-applying row keep the box's mode; and strict is the box's own. So M28b pins it with a hand-built
  resolution, and the property row "false whenever the files decide" covers the `files` guard.
- M4's `stallBusyClock` half and its stall-sweep row, and M11's and M11b's decide halves, belong to the tasks that
  add `stallBusyClock` and `decideStallSettings`.

- [ ] **Step 11: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add shared/api.ts server/src/coord/stallsettings.ts server/test/stall-settings.test.ts server/test/mail-routes.test.ts
git commit -m "$(cat <<'MSG'
feat(stall-watch): settings L0 wire types and texts, and the L1 settings core

Stall watch settings W1 Task 1 (design 2026-10-05 §5, §6, §12). The
whole L0 block is appended at the end of shared/api.ts, so no README
anchor into that file moves: the six ladder levels and five stages with
their texts, the view, effect and confirm types, and every section
string. STALL_LEVELS and STALL_STAGES are derived from their Records.
StallStored is derived from an array, as STAMP_READS is, because the
'absent' | 'unreadable' pair is ReadFailure's and lives in
shared/agent-protocol.ts alone.

server/src/coord/stallsettings.ts (L1, pure) holds the ladder's flag
and mode columns, the quiet-time bounds and step (D-4026) and the notice
window, isStallQuietMs, the settings row's port and its parse (each
field on its own, bigint-safe, prototype names unreadable), the box
arming and its unheld reading, the resolver (whole-row fallback, the
kill file wholesale, strict keeping the mail gate and holding the
wave-2 step, D-4023, and a causal held), stallLevelOf (the busy gate
never splits a level, D-4022), stallStages (D-4032), stallNextStep and
stallFilesExceed. isStallSettingsKebab declares its three kebab words to
mail-routes' scan as the thirteenth union.
MSG
)"
```

---

### Task 2: L1 write path: decide, the write effect and its key, the feed change, and the notice counts

**Model routing:** `sonnet`, effort `high`: pure L1 functions transcribed from this section, their rows, and a
mutation table.

**Files:**
- Modify: `server/src/coord/stall.ts`: add `stallArmHasRung` directly under `rungRecipient` (≈744–748 at 77f8d63a5,
  unchanged by Task 1), beside `STALL_RUNG_RECIPIENTS` (≈734).
- Modify: `server/src/coord/stallsettings.ts` (Task 1's file): the import block (≈1–4), one module-docstring bullet
  (≈19), and a new block above `// ── the kebab words ──` (≈276): `StallSettingsPatch`, `StallSettingsDecision`,
  `STALL_REQUEST_KEYS` (private), `decideStallSettings`, `STALL_SETTINGS_SEED`, `stallPatchIsNoOp`,
  `stallSettingsAfter`, `StallMeasuredEffect`, `stallWriteEffect`, `stallNeedsConfirm`, `stallEffectKey`,
  `stallQuietWords`/`stallLevelChangeWords`/`stallQuietChangeWords` (private), `stallSettingsChange`,
  `StallObservationRow`, `STALL_NOTICE_ROWS` and `STALL_ROLE_ROW` (private), and `stallNoticeCounts`.
- Modify: `server/test/stall-settings.test.ts` (Task 1's file): the import block (≈15–26) and a new block above
  `// ── source scans ──` (≈468).
- Test: `server/test/stall-settings.test.ts`.

`isStallSettingsKebab` needs no change: Task 1 shipped it over `['busy-shadow', 'confirm-required', 'flag-off']`, and
this task spells no quoted kebab word (its existing code-line scan row stays green and is re-run below).

**Interfaces:**
- Consumes, from `shared/api.ts` (Task 1's L0 block): `STALL_FOLLOW_LABEL`, `STALL_LEVELS`, `STALL_LEVEL_TEXT`,
  `STALL_NOTICE_TEXT`, `STALL_SECTION_TEXT` (its `builtIn`, `'{value} (built-in)'`), `STALL_STAGES`,
  `isStallLevelChoice`; types `StallLevelChoice`, `StallNoticeCount`, `StallStage`, `StallWatchRequest`,
  `StallWriteEffect`.
- Consumes, from `server/src/coord/stall.ts`: `STALL_QUIET_MS`, `parseStallDetail(detail: string | null):
  Omit<StallNotice, 'at'> | null` (≈165), `rungRecipient(arm: StallArm, rung: 1 | 2 | 3): StallRecipient` (≈744),
  type `StallRecipient` (≈134).
- Consumes, from Task 1 in `stallsettings.ts`: `isStallQuietMs`, `STALL_QUIET_MIN_MS`, `STALL_QUIET_MAX_MS`,
  `STALL_QUIET_STEP_MS`, `StallSettingsRow`, `StallSettingsRead`, `StallSettingsParsed`, `parseStallSettings`,
  `fromStore` (private), `StallBoxArming`, `resolveStallWatch`, `armedStages`, `stallFilesExceed`.
- Produces, in `server/src/coord/stall.ts`:
  - `export function stallArmHasRung(arm: StallArm, rung: 1 | 2 | 3): boolean`
- Produces, in `server/src/coord/stallsettings.ts`:
  - `export interface StallSettingsPatch { readonly level?: StallLevelChoice; readonly quiet?: { readonly kind: 'default' } | { readonly kind: 'set'; readonly ms: number } }`
  - `export type StallSettingsDecision = { readonly ok: true; readonly patch: StallSettingsPatch; readonly confirm: string | null } | { readonly ok: false; readonly detail: string }`
  - `export function decideStallSettings(body: unknown): StallSettingsDecision`
  - `export const STALL_SETTINGS_SEED: { readonly level: 'follow'; readonly quietMs: null }` (the store's insert arm
    starts from it)
  - `export function stallPatchIsNoOp(row: StallSettingsRow, patch: StallSettingsPatch): boolean` (the store's
    no-op skip calls it too, so the compare is defined once)
  - `export function stallSettingsAfter(before: StallSettingsRead, patch: StallSettingsPatch, at: number): StallSettingsRead`
  - `export type StallMeasuredEffect = Extract<StallWriteEffect, { readonly measured: true }>`
  - `export function stallWriteEffect(box: StallBoxArming, unheld: StallBoxArming, beforeRead: StallSettingsRead, afterRead: StallSettingsRead): StallMeasuredEffect`
  - `export function stallNeedsConfirm(effect: StallWriteEffect): boolean`
  - `export function stallEffectKey(effect: StallWriteEffect, updatedAt: number | null): string`
  - `export function stallSettingsChange(before: StallSettingsRead, after: StallSettingsRead): string | null`
  - `export interface StallObservationRow { readonly at: number; readonly detail: string | null }`
  - `export function stallNoticeCounts(rows: readonly StallObservationRow[]): StallNoticeCount[]`

The route (a later task) composes them exactly as the test helper `effectOf` does: `stored = coord.stallSettings()`;
`projected = stallSettingsAfter(stored, patch, at)`; `effect = names === null ? { measured: false } :
stallWriteEffect(stallBoxArmingOf(names, mailDisabled), stallUnheldBoxOf(names), stored, projected)`;
`key = stallEffectKey(effect, parseStallSettings(stored).updatedAt)`; then `stallNeedsConfirm(effect)`, and after the
write `stallSettingsChange(w.before, w.after)`. The `at` it passes here is the same `at` it passes to
`setStallSettings`.

**What this task settles** (spec §20 and gaps; each is pinned by a row below):
- `stallSettingsAfter` takes the write's `at` as a third argument (§8 names two). A written arm then projects the same
  `updatedAt` the store stamps, so M12d's store row can compare the parsed `after` and the parsed projection whole.
  The projection applies the no-op skip itself, through `stallPatchIsNoOp`, which is exported for the store's own
  skip: one compare, after `fromStore`'s `bigint` conversion, with `NULL` for `default`.
- `decideStallSettings` checks unknown keys before the "neither field" refusal, so `{ foo: 1 }` names `foo`. A key is
  present when it is an own property (`hasOwnProperty`), so a JSON `"__proto__"` key is an unknown key, named.
- The refusal details, plain and derived from the constants: `body must be an object`; `unknown key <k>: a write
  names only level, quietMs and confirm`; `at least one of level or quietMs must be given`; `level must be follow or
  one of off, log, check, alert, deliver, all`; `quietMs must be 'default' or a whole number of milliseconds from
  1800000 to 43200000 in steps of 1800000`; `confirm must be a string`.
- §20, "`stallEffectKey` uses a fixed word for a `null` `updatedAt`": kept (`none`). Every write through the door
  stamps a safe integer, so after any such write the key changes; only a hand edit can leave a non-integer
  `updatedAt`, and the store's expected-state compare, over raw values, still refuses to write over a changed row.
- §20, the R18-order row of §15: `turnsOff` is in §5.1's order (a row pins `['checks', 'alerts', 'busyDelivery']`),
  so `alerts` sorts before `busyDelivery`; the sheet's line order (the target's `does`, then `turnsOn`, then
  `turnsOff`) is W2's, and §15's "first" is loose wording. No L1 change.
- §20, "a quiet-time raise that stays below the built-in sets `quietLowered`": kept as §10 defines it (a row pins
  30 min → 1 h as `quietLowered` and needing a confirm). Which line such a sheet shows at Log is W2's.
- §20, "a row with both fields unreadable takes two writes to repair": kept; the update arm writes only the named
  fields, as §8 says.
- §13's sheet lines are the PWA's (`stallConfirmLines`, W2), so no §13 line is composed in L1. The feed body's three
  non-row words (`no stored choice`, `unreadable stored level`, `unreadable stored quiet time`) are a feed body, not
  section strings, and live in L1; the built-in's `(built-in)` comes from L0's `STALL_SECTION_TEXT.builtIn`.
- `stallNoticeCounts` takes the store's rows through an L1 port, `StallObservationRow`, declared by the consumer.
- `stallArmHasRung` lives in `stall.ts` beside the rung table (§11, §14 item 3); it spells no marker.

- [ ] **Step 1: Re-anchor**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -cF 'if (to === undefined) throw new RangeError(`rungRecipient: ${arm} has no rung ${rung}`);' server/src/coord/stall.ts
grep -cF "import { STALL_LEVELS, STALL_STAGES, isStallLevelChoice } from '../../../shared/api.js';" server/src/coord/stallsettings.ts
grep -cF ' * - the resolver both sweeps and the view call, and the readers the view composes.' server/src/coord/stallsettings.ts
grep -cF '// ── the kebab words ──' server/src/coord/stallsettings.ts
grep -cF "import { STALL_LEVELS, STALL_LEVEL_TEXT, STALL_STAGES, STALL_STAGE_TEXT, STALL_STORED_STATES, isStallLevelChoice } from '../../shared/api.js';" server/test/stall-settings.test.ts
grep -cF "  armedStages, isStallQuietMs, isStallSettingsKebab, parseStallSettings, resolveStallWatch, stallBoxArmingOf," server/test/stall-settings.test.ts
grep -cF '// ── source scans ──' server/test/stall-settings.test.ts
```

Expected: `1` from each (measured at Task 1's commit). If any differs, find the text by content and say so.

- [ ] **Step 2: Write the failing tests**

All edits are in `server/test/stall-settings.test.ts`.

(a) The import block (≈15–26). Each "before" occurs exactly once in the file (measured with `grep -cF`: 1 each).

`import { STALL_LEVELS, STALL_LEVEL_TEXT, STALL_STAGES, STALL_STAGE_TEXT, STALL_STORED_STATES, isStallLevelChoice } from '../../shared/api.js';`
and the line under it,
`import type { StallLevel, StallLevelChoice, StallStored } from '../../shared/api.js';`, become:

```ts
import { STALL_FOLLOW_LABEL, STALL_LEVELS, STALL_LEVEL_TEXT, STALL_NOTICE_TEXT, STALL_STAGES, STALL_STAGE_TEXT, STALL_STORED_STATES, isStallLevelChoice } from '../../shared/api.js';
import type { StallLevel, StallLevelChoice, StallStored, StallWriteEffect } from '../../shared/api.js';
```

The five lines that run from `  armedStages, isStallQuietMs, isStallSettingsKebab, parseStallSettings, resolveStallWatch, stallBoxArmingOf,`
through `import { STALL_MARKERS, STALL_QUIET_MS, stallArmingOf } from '../src/coord/stall.js';` (the stallsettings
import's two member lines, its closing line, the type import, and the stall import) become, keeping the opening
`import {` and the `  STALL_LADDER, …` member line above them as they are:

```ts
  armedStages, decideStallSettings, isStallQuietMs, isStallSettingsKebab, parseStallSettings, resolveStallWatch,
  stallBoxArmingOf, stallEffectKey, stallFilesExceed, stallLevelOf, stallNeedsConfirm, stallNextStep, stallNoticeCounts,
  stallPatchIsNoOp, stallSettingsAfter, stallSettingsChange, stallStages, stallUnheldBoxOf, stallWriteEffect,
} from '../src/coord/stallsettings.js';
import type { StallBoxArming, StallSettingsParsed, StallSettingsPatch, StallSettingsRead } from '../src/coord/stallsettings.js';
import { STALL_ARMS, STALL_MARKERS, STALL_QUIET_MS, rungRecipient, stallArmHasRung, stallArmingOf, stallDetail } from '../src/coord/stall.js';
import type { StallArm } from '../src/coord/stall.js';
```

So `before` is exactly these lines at Task 1's commit:

```ts
  armedStages, isStallQuietMs, isStallSettingsKebab, parseStallSettings, resolveStallWatch, stallBoxArmingOf,
  stallFilesExceed, stallLevelOf, stallNextStep, stallStages, stallUnheldBoxOf,
} from '../src/coord/stallsettings.js';
import type { StallBoxArming, StallSettingsParsed, StallSettingsRead } from '../src/coord/stallsettings.js';
import { STALL_MARKERS, STALL_QUIET_MS, stallArmingOf } from '../src/coord/stall.js';
```

(b) Directly above the line `// ── source scans ──…` (≈468), insert this block. It ends with one blank line, so the
`// ── source scans ──` line keeps a blank line above it.

```ts
// ── the write path: decide, the projection, the effect and its key, the feed change ──────────────────────────────

describe('decideStallSettings: refuses, never clamps (§10 step 2; the decide halves of M10, M11b and M14)', () => {
  const refused = (body: unknown): string => {
    const d = decideStallSettings(body);
    if (d.ok) throw new Error(`accepted ${JSON.stringify(body)}`);
    return d.detail;
  };
  it('a body that is not an object is refused', () => {
    for (const b of [null, undefined, 'log', 3, [], ['level']]) expect(refused(b), String(b)).toBe('body must be an object');
  });
  it('M14: an unknown key is refused and named in the detail, even beside a valid field (departure unknown-keys-refused)', () => {
    expect(refused({ level: 'check', quietTime: 3 * H })).toBe('unknown key quietTime: a write names only level, quietMs and confirm');
    expect(refused({ foo: 1 })).toContain('foo');
    expect(refused(JSON.parse('{"__proto__": 1, "level": "log"}'))).toContain('__proto__');
  });
  it('M14: a body naming neither level nor quietMs is refused, a confirm alone included', () => {
    expect(refused({})).toBe('at least one of level or quietMs must be given');
    expect(refused({ confirm: '0badc0de' })).toBe('at least one of level or quietMs must be given');
  });
  it('M11b: a level that is not a StallLevelChoice is refused, the prototype names included', () => {
    for (const v of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'custom', 'Follow', '', 3, null]) {
      expect(refused({ level: v }), String(v)).toBe('level must be follow or one of off, log, check, alert, deliver, all');
    }
  });
  it('M10: a quiet time off the range or off the step is refused, naming the field, the range and the step', () => {
    for (const v of [29 * MIN, 45 * MIN, 12 * H + 30 * MIN, 0, 1_800_000.5, '1800000', null, 'built-in', 1_800_000n]) {
      expect(refused({ quietMs: v }), String(v))
        .toBe("quietMs must be 'default' or a whole number of milliseconds from 1800000 to 43200000 in steps of 1800000");
    }
  });
  it('M10: the bounds and every step between are accepted exactly as sent; default is the built-in', () => {
    for (let v = STALL_QUIET_MIN_MS; v <= STALL_QUIET_MAX_MS; v += STALL_QUIET_STEP_MS) {
      expect(decideStallSettings({ quietMs: v }), String(v)).toEqual({ ok: true, patch: { quiet: { kind: 'set', ms: v } }, confirm: null });
    }
    expect(decideStallSettings({ quietMs: 'default' })).toEqual({ ok: true, patch: { quiet: { kind: 'default' } }, confirm: null });
  });
  it('a confirm must be a string; it passes through, and reads null when the body carries none', () => {
    expect(refused({ level: 'log', confirm: 1 })).toBe('confirm must be a string');
    expect(refused({ level: 'log', confirm: null })).toBe('confirm must be a string');
    expect(decideStallSettings({ level: 'all', quietMs: 'default', confirm: '0badc0de' }))
      .toEqual({ ok: true, patch: { level: 'all', quiet: { kind: 'default' } }, confirm: '0badc0de' });
    for (const level of ['follow', ...STALL_LEVELS]) {
      expect(decideStallSettings({ level }), level).toEqual({ ok: true, patch: { level }, confirm: null });
    }
  });
});

const AT = 1_790_000_100_000;

describe('stallSettingsAfter: the read the store\'s write will leave (§8; the L1 half of M12d)', () => {
  it('an absent row takes the insert arm: the seed, overridden by the named fields, stamped at the write', () => {
    expect(stallSettingsAfter({ kind: 'absent' }, { quiet: { kind: 'set', ms: 3 * H } }, AT)).toEqual(rowRead('follow', 3 * H, AT));
    expect(stallSettingsAfter({ kind: 'absent' }, { level: 'check' }, AT)).toEqual(rowRead('check', null, AT));
    expect(stallSettingsAfter({ kind: 'absent' }, { level: 'follow', quiet: { kind: 'default' } }, AT)).toEqual(rowRead('follow', null, AT));
  });
  it('a row takes the update arm: the named fields over the stored ones, the other kept as stored, unreadable included', () => {
    expect(stallSettingsAfter(rowRead('constructor', 1_800_000n, 5), { quiet: { kind: 'default' } }, AT)).toEqual(rowRead('constructor', null, AT));
    expect(stallSettingsAfter(rowRead('all', 45 * MIN, 5), { level: 'log' }, AT)).toEqual(rowRead('log', 45 * MIN, AT));
    expect(stallSettingsAfter(rowRead('all', 45 * MIN, 5), { level: 'off', quiet: { kind: 'set', ms: 12 * H } }, AT)).toEqual(rowRead('off', 12 * H, AT));
  });
  it('a no-op leaves the read as it is, updatedAt included; a stored bigint quiet time compares as a number', () => {
    const before = rowRead('check', 3_600_000n, 5);
    expect(stallSettingsAfter(before, { level: 'check', quiet: { kind: 'set', ms: H } }, AT)).toBe(before);
    const seed = rowRead('follow', null, 0);
    expect(stallSettingsAfter(seed, { level: 'follow', quiet: { kind: 'default' } }, AT)).toBe(seed);
    expect(stallSettingsAfter(seed, { quiet: { kind: 'default' } }, AT)).toBe(seed);
  });
  it('an unreadable read is returned unchanged: nothing is written over it', () => {
    const u: StallSettingsRead = { kind: 'unreadable', detail: 'no such table: stall_settings' };
    expect(stallSettingsAfter(u, { level: 'all' }, AT)).toBe(u);
  });
  it('stallPatchIsNoOp compares the named fields only, after the bigint conversion, with NULL for default', () => {
    const row = { level: 'check', quietMs: 3_600_000n, updatedAt: 5 };
    expect(stallPatchIsNoOp(row, { level: 'check' })).toBe(true);
    expect(stallPatchIsNoOp(row, { quiet: { kind: 'set', ms: H } })).toBe(true);
    expect(stallPatchIsNoOp(row, { level: 'check', quiet: { kind: 'set', ms: H } })).toBe(true);
    expect(stallPatchIsNoOp(row, { quiet: { kind: 'default' } })).toBe(false);
    expect(stallPatchIsNoOp(row, { level: 'follow' })).toBe(false);
    expect(stallPatchIsNoOp(row, { quiet: { kind: 'set', ms: 2 * H } })).toBe(false);
    expect(stallPatchIsNoOp({ level: 'follow', quietMs: null, updatedAt: 0 }, { quiet: { kind: 'default' } })).toBe(true);
    expect(stallPatchIsNoOp({ level: 'toString', quietMs: 'x', updatedAt: 0 }, { level: 'log' })).toBe(false);
  });
});

/** The effect of writing `patch` over `before` on the box `names` lists, composed as the route composes it (§10 step 4). */
const effectOf = (names: string[], before: StallSettingsRead, patch: StallSettingsPatch) =>
  stallWriteEffect(box(...names), stallUnheldBoxOf(names), before, stallSettingsAfter(before, patch, AT));
const STAGES_OFF = { runs: true, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false };

describe('M26: stallWriteEffect and stallNeedsConfirm, the server deciding the confirm (§10)', () => {
  it('a stage turning on: Follow on today\'s fleet to Everything, the whole effect', () => {
    const e = effectOf([LIVE, SHADOW], rowRead('follow'), { level: 'all' });
    expect(e).toEqual({
      measured: true, turnsOn: ['alerts', 'busyDelivery', 'wave2'], turnsOff: [], leavesWave2: false, heldByBox: false,
      quietLowered: false, filesExceed: false,
      before: { ...STAGES_OFF, checks: true, busyGate: true },
      after: { runs: true, checks: true, alerts: true, busyDelivery: true, busyGate: true, wave2: true },
      quietMs: { before: STALL_QUIET_MS, after: STALL_QUIET_MS }, mailOff: false,
    });
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('the busy gate turning on counts: Follow over a box with no files to Check', () => {
    const e = effectOf([], rowRead('follow'), { level: 'check' });
    expect(e.turnsOn).toEqual(['checks', 'busyGate']);
    expect(stallNeedsConfirm(e)).toBe(true);
    expect(stallNeedsConfirm(effectOf([], rowRead('follow'), { level: 'log' }))).toBe(true);
  });
  it('leaving the further checks: Everything to Alert stops busy delivery and the further checks', () => {
    const e = effectOf([], rowRead('all'), { level: 'alert' });
    expect([e.turnsOn, e.turnsOff, e.leavesWave2, e.heldByBox]).toEqual([[], ['busyDelivery', 'wave2'], true, false]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('a quiet time brought below the current one, or below the built-in, needs one; a raise above both does not', () => {
    const lower = effectOf([], rowRead('check', 4 * H), { quiet: { kind: 'set', ms: 3 * H } });
    expect([lower.quietLowered, lower.quietMs]).toEqual([true, { before: 4 * H, after: 3 * H }]);
    expect(stallNeedsConfirm(lower)).toBe(true);
    const underBuiltIn = effectOf([], rowRead('check', 30 * MIN), { quiet: { kind: 'set', ms: H } });
    expect([underBuiltIn.quietLowered, stallNeedsConfirm(underBuiltIn)], 'a raise that stays below the built-in').toEqual([true, true]);
    expect(effectOf([], rowRead('check'), { quiet: { kind: 'set', ms: H } }).quietLowered).toBe(true);
    const raise = effectOf([], rowRead('check', 3 * H), { quiet: { kind: 'set', ms: 4 * H } });
    expect([raise.quietLowered, stallNeedsConfirm(raise)]).toEqual([false, false]);
    expect(effectOf([], rowRead('check', 30 * MIN), { quiet: { kind: 'set', ms: 30 * MIN } }).quietLowered, 'the same value').toBe(false);
    expect(effectOf([], rowRead('check', 30 * MIN), { quiet: { kind: 'default' } }).quietLowered, 'back to the built-in').toBe(false);
  });
  it('an absent row with the files at Check and a write of all: measured against the files', () => {
    const e = effectOf([LIVE, SHADOW], { kind: 'absent' }, { level: 'all' });
    expect(e.turnsOn).toEqual(['alerts', 'busyDelivery', 'wave2']);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('a stored all with an unreadable quiet time and a quiet write of 3 h: the stored level comes into force', () => {
    const e = effectOf([LIVE, SHADOW], rowRead('all', 45 * MIN), { quiet: { kind: 'set', ms: 3 * H } });
    expect([e.turnsOn, e.quietLowered]).toEqual([['alerts', 'busyDelivery', 'wave2'], false]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('an unreadable level with a stored 30 min and a write of Follow: the stored quiet time comes into force', () => {
    const e = effectOf([LIVE, SHADOW], rowRead('constructor', 30 * MIN), { level: 'follow' });
    expect([e.turnsOn, e.quietLowered, e.quietMs]).toEqual([[], true, { before: STALL_QUIET_MS, after: 30 * MIN }]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('mail-disabled is ignored for the diff: Alert to Deliver turns busy delivery on, and mailOff is reported', () => {
    const e = effectOf([MAIL_OFF], rowRead('alert'), { level: 'deliver' });
    expect([e.turnsOn, e.heldByBox, e.mailOff]).toEqual([['busyDelivery'], false, true]);
    expect(e.after.busyDelivery, 'the resolved reading with mail off read as on').toBe(true);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('the kill file with Check chosen and a write of all: confirmed through the unheld reading, heldByBox', () => {
    const e = effectOf([KILL, LIVE, SHADOW], rowRead('check'), { level: 'all' });
    expect([e.turnsOn, e.turnsOff, e.heldByBox]).toEqual([['alerts', 'busyDelivery', 'wave2'], [], true]);
    expect(e.before).toEqual(e.after);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('strict with Alert chosen and a write of deliver: busy delivery turns on through the unheld reading, heldByBox', () => {
    const e = effectOf([STRICT], rowRead('alert'), { level: 'deliver' });
    expect([e.turnsOn, e.turnsOff, e.heldByBox]).toEqual([['busyDelivery'], [], true]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('leaving the further checks under the kill file is held too: leavesWave2 from the unheld reading alone', () => {
    const e = effectOf([KILL], rowRead('all'), { level: 'alert' });
    expect([e.turnsOn, e.turnsOff, e.leavesWave2, e.heldByBox]).toEqual([[], [], true, true]);
    expect(stallNeedsConfirm(e)).toBe(true);
  });
  it('neither needs one: a pure lowering, and Deliver to Alert over a box busy-shadow file', () => {
    const lower = effectOf([], rowRead('alert'), { level: 'check' });
    expect([lower.turnsOn, lower.turnsOff, lower.leavesWave2, lower.quietLowered]).toEqual([[], ['alerts'], false, false]);
    expect(stallNeedsConfirm(lower)).toBe(false);
    const deliver = effectOf([SHADOW], rowRead('deliver'), { level: 'alert' });
    expect([deliver.turnsOn, deliver.turnsOff]).toEqual([[], ['busyDelivery']]);
    expect(stallNeedsConfirm(deliver)).toBe(false);
  });
  it('Off over a box busy file hands busy delivery back: it turns on in the resolved reading with the watch off (§15)', () => {
    const e = effectOf([LIVE, BUSY], rowRead('check'), { level: 'off' });
    expect([e.turnsOn, e.turnsOff, e.heldByBox, e.after.runs]).toEqual([['busyDelivery'], ['checks'], false, false]);
  });
  it('a level below Deliver over busy files armed by hand stops busy delivery; turnsOff is in §5.1 order (§20)', () => {
    const e = effectOf([LIVE, BUSY], rowRead('follow'), { level: 'alert' });
    expect([e.turnsOn, e.turnsOff]).toEqual([['alerts'], ['busyDelivery']]);
    const down = effectOf([LIVE, ESCALATE, BUSY], rowRead('follow'), { level: 'log' });
    expect(down.turnsOff).toEqual(['checks', 'alerts', 'busyDelivery']);
  });
  it('M28 (the effect\'s after state): filesExceed is read over the resolution the write leaves', () => {
    expect(effectOf([LIVE, ESCALATE], rowRead('follow'), { level: 'check' }).filesExceed).toBe(true);
    expect(effectOf([LIVE, SHADOW], rowRead('follow'), { level: 'deliver' }).filesExceed).toBe(false);
    expect(effectOf([LIVE, ESCALATE], rowRead('check'), { level: 'follow' }).filesExceed).toBe(false);
  });
  it('the unmeasured effect always needs the confirm', () => {
    expect(stallNeedsConfirm({ measured: false })).toBe(true);
  });
});

describe('the L1 half of M27: stallEffectKey ties the confirm to the effect and the row', () => {
  /** A reference FNV-1a, 32-bit, over UTF-16 code units, written apart from the shipped one; its CONTROL row pins
   *  the published test vectors. */
  const fnv = (s: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  const effect = () => effectOf([LIVE, SHADOW], rowRead('follow'), { level: 'all' });
  it('CONTROL: the reference hash answers the published FNV-1a vectors', () => {
    expect([fnv(''), fnv('a'), fnv('foobar')]).toEqual(['811c9dc5', 'e40c292c', 'bf9cf968']);
  });
  it('is eight hex characters of FNV-1a over the effect\'s JSON and the before-row\'s updatedAt', () => {
    const e = effect();
    expect(stallEffectKey(e, 5)).toMatch(/^[0-9a-f]{8}$/);
    expect(stallEffectKey(e, 5)).toBe(fnv(`${JSON.stringify(e)}@5`));
    expect(stallEffectKey({ measured: false }, null)).toBe(fnv('{"measured":false}@none'));
  });
  it('a write between the 409 and the re-POST changes the key even when the effect reads the same', () => {
    const e = effect();
    expect(stallEffectKey(e, 5)).not.toBe(stallEffectKey(e, 6));
    expect(stallEffectKey(e, null)).not.toBe(stallEffectKey(e, 0));
    expect(stallEffectKey(e, 5)).toBe(stallEffectKey(effect(), 5));
  });
  it('a different effect gives a different key over the same row', () => {
    const e = effect();
    const other: StallWriteEffect = effectOf([LIVE, SHADOW], rowRead('follow'), { level: 'deliver' });
    expect(stallEffectKey(other, 5)).not.toBe(stallEffectKey(e, 5));
  });
});

describe('stallSettingsChange: the feed body, level and quiet time only, from L0 labels (§10 step 6)', () => {
  const after = (level: unknown, quietMs: unknown = null) => rowRead(level, quietMs, AT);
  it('names both fields when both change', () => {
    expect(stallSettingsChange(rowRead('follow'), after('check', 3 * H)))
      .toBe("level: Follow the fleet box's files → Check silent workers; quiet time: 2 h (built-in) → 3 h");
    expect(STALL_FOLLOW_LABEL).toBe("Follow the fleet box's files");
  });
  it('names only what changed, and formats half hours', () => {
    expect(stallSettingsChange(rowRead('check', 3 * H), after('check', 150 * MIN))).toBe('quiet time: 3 h → 2 h 30 min');
    expect(stallSettingsChange(rowRead('check', 3 * H), after('check', 30 * MIN))).toBe('quiet time: 3 h → 30 min');
    expect(stallSettingsChange(rowRead('check', 3 * H), after('all', 3 * H))).toBe('level: Check silent workers → Everything');
  });
  it('a no-op is null: updatedAt alone never counts, and a bigint meets its number', () => {
    expect(stallSettingsChange(rowRead('check', 3 * H, 5), after('check', 3 * H))).toBeNull();
    expect(stallSettingsChange(rowRead('check', 10_800_000n, 5n), after('check', 3 * H))).toBeNull();
    expect(stallSettingsChange(rowRead('follow', null, 0), rowRead('follow', null, 0))).toBeNull();
  });
  it('M15b: a non-row before is named, never undefined: a lost row restored by a quiet-only write', () => {
    expect(stallSettingsChange({ kind: 'absent' }, stallSettingsAfter({ kind: 'absent' }, { quiet: { kind: 'set', ms: 3 * H } }, AT)))
      .toBe("level: no stored choice → Follow the fleet box's files; quiet time: no stored choice → 3 h");
  });
  it('an unreadable stored field is named as unreadable', () => {
    expect(stallSettingsChange(rowRead('constructor', 3 * H), after('all', 3 * H))).toBe('level: unreadable stored level → Everything');
    expect(stallSettingsChange(rowRead('all', 45 * MIN), after('all', null))).toBe('quiet time: unreadable stored quiet time → 2 h (built-in)');
    expect(stallSettingsChange({ kind: 'unreadable', detail: 'x' }, after('off')))
      .toBe('level: unreadable stored level → Off; quiet time: unreadable stored quiet time → 2 h (built-in)');
  });
  it('never prints undefined, null or NaN over every level, quiet time and before kind', () => {
    const befores: StallSettingsRead[] = [{ kind: 'absent' }, { kind: 'unreadable', detail: 'x' }, rowRead('toString', 1.5)];
    for (const b of befores) {
      for (const level of ['follow', ...STALL_LEVELS]) {
        for (const q of [null, 30 * MIN, 12 * H]) {
          const body = stallSettingsChange(b, after(level, q));
          expect(body, `${b.kind} ${level} ${String(q)}`).not.toBeNull();
          expect(body!).not.toMatch(/undefined|null|NaN|\[object/);
        }
      }
    }
  });
});

describe('M17 and M17b: stallNoticeCounts tallies by role, live and shadow apart, skipping what it cannot name', () => {
  /** The spec's role table (§11), written out by hand, apart from the shipped derivation. */
  const ROLE: Record<StallArm, readonly (keyof typeof STALL_NOTICE_TEXT)[]> = {
    quiet: ['checks', 'reports', 'pushes'],
    'limit-cap': ['pushes'], 'dialog-cap': ['pushes'], 'coord-ball': ['pushes'],
    'coord-deaf': ['pushes'], 'mail-stuck': ['pushes'], 'marker-unreadable': ['pushes'],
    'orphan-d': ['wakes', 'pushes'],
    'orphan-e': ['wakes'],
    failed: ['wakes', 'reports'],
    frozen: ['reports'], dead: ['reports'],
  };
  const row = (mode: 'live' | 'shadow', arm: StallArm, rung: 1 | 2 | 3, key = 7) => ({ at: AT, detail: stallDetail(mode, arm, rung, key) });
  const zero = Object.keys(STALL_NOTICE_TEXT).map((r) => ({ row: r, sent: 0, shadow: 0 }));
  it('no rows: the four rows in L0 key order, zeros included', () => {
    expect(stallNoticeCounts([])).toEqual(zero);
    expect(zero.map((z) => z.row)).toEqual(['checks', 'wakes', 'reports', 'pushes']);
  });
  it('the spec examples: quiet rung 1 is checks, orphan E rung 1 wakes, frozen rung 1 reports, dialog cap pushes', () => {
    const counts = stallNoticeCounts([row('live', 'quiet', 1), row('shadow', 'quiet', 1), row('shadow', 'quiet', 1, 8),
      row('live', 'orphan-e', 1), row('shadow', 'frozen', 1), row('live', 'dialog-cap', 1)]);
    expect(counts).toEqual([
      { row: 'checks', sent: 1, shadow: 2 }, { row: 'wakes', sent: 1, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 1 }, { row: 'pushes', sent: 1, shadow: 0 },
    ]);
  });
  it('every rung of every arm lands in its role\'s row, in its mode\'s column', () => {
    expect(Object.keys(ROLE).sort()).toEqual([...STALL_ARMS].sort());
    for (const arm of STALL_ARMS) {
      ROLE[arm].forEach((role, i) => {
        const rung = (i + 1) as 1 | 2 | 3;
        for (const mode of ['live', 'shadow'] as const) {
          const got = stallNoticeCounts([row(mode, arm, rung)]);
          const want = zero.map((z) => z.row === role ? { ...z, [mode === 'live' ? 'sent' : 'shadow']: 1 } : z);
          expect(got, `${mode} ${arm} ${rung}`).toEqual(want);
        }
      });
    }
  });
  it('a row that is not a stall detail of this build is skipped: transitions, routing, malformed, null', () => {
    const three = stallDetail('live', 'quiet', 1, 5).split(':').slice(0, 3).join(':');
    const rows = [{ at: AT, detail: 'dispatched->working' }, { at: AT, detail: null }, { at: AT, detail: three },
      { at: AT, detail: `${three}:x` }, { at: AT, detail: stallDetail('live', 'quiet', 1, 5).replace('quiet', 'quieter') }];
    expect(stallNoticeCounts(rows)).toEqual(zero);
  });
  it('M17b: a rung the arm lacks is skipped, never thrown on', () => {
    const planted = [row('live', 'dialog-cap', 2), row('shadow', 'orphan-e', 3), row('live', 'frozen', 2)];
    expect(() => stallNoticeCounts(planted)).not.toThrow();
    expect(stallNoticeCounts([...planted, row('live', 'dialog-cap', 1)])).toEqual(zero.map((z) => z.row === 'pushes' ? { ...z, sent: 1 } : z));
  });
  it('stallArmHasRung is total, and answers exactly where rungRecipient does not throw', () => {
    for (const arm of STALL_ARMS) {
      for (const rung of [1, 2, 3] as const) {
        let throws = false;
        try { rungRecipient(arm, rung); } catch { throws = true; }
        expect(stallArmHasRung(arm, rung), `${arm} ${rung}`).toBe(!throws);
        expect(stallArmHasRung(arm, rung), `${arm} ${rung}`).toBe(ROLE[arm][rung - 1] !== undefined);
      }
    }
    expect([stallArmHasRung('dialog-cap', 2), stallArmHasRung('quiet', 3), stallArmHasRung('orphan-d', 2)]).toEqual([false, true, true]);
  });
});
```

- [ ] **Step 3: Run the suite to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-settings.test.ts`

Expected (measured on the prototype): `Tests  43 failed | 63 passed (106)`. Every new row fails with
`TypeError: … is not a function` (`decideStallSettings`, `stallSettingsAfter`, `stallNoticeCounts`,
`stallArmHasRung`, …): the 7 decide rows, the 5 projection rows, the 16 effect rows, the 3 key rows past their
CONTROL, the 6 feed-body rows and the 6 count rows. Task 1's 62 rows stay green, and so does the new
`CONTROL: the reference hash answers the published FNV-1a vectors` (62 + 1 = 63), by design: it pins the test's own
reference hash, not the shipped one.

- [ ] **Step 4: Implement**

(a) `server/src/coord/stall.ts`. The "before" is the end of `rungRecipient` (≈746–748), whose throw line occurs
exactly once (measured with `grep -cF`: 1):

```ts
  if (to === undefined) throw new RangeError(`rungRecipient: ${arm} has no rung ${rung}`);
  return to;
}
```

After: the same three lines, then one blank line and this function:

```ts
/** Whether an arm has that rung at all: total and never throwing, over the same table, for a reader whose pair did
 *  not come from a verdict. `parseStallDetail` checks the arm and a rung of 1 to 3, not that the arm has that rung,
 *  so a newer build's row read after a rollback, or a hand edit, can name a pair `rungRecipient` throws on. The
 *  notice counts ask this first (stall-watch settings, design 2026-10-05 §11). */
export function stallArmHasRung(arm: StallArm, rung: 1 | 2 | 3): boolean {
  return STALL_RUNG_RECIPIENTS[arm][rung - 1] !== undefined;
}
```

(b) `server/src/coord/stallsettings.ts`, the import block (≈1–4). Before (each line occurs exactly once, measured with
`grep -cF`: 1 each):

```ts
import { STALL_LEVELS, STALL_STAGES, isStallLevelChoice } from '../../../shared/api.js';
import type { StallHeld, StallLevel, StallNextStep, StallStage, StallStored, StallWatchStages } from '../../../shared/api.js';
import { STALL_QUIET_MS, stallArmingOf } from './stall.js';
import type { StallArming } from './stall.js';
```

After:

```ts
import {
  STALL_FOLLOW_LABEL, STALL_LEVELS, STALL_LEVEL_TEXT, STALL_NOTICE_TEXT, STALL_SECTION_TEXT, STALL_STAGES, isStallLevelChoice,
} from '../../../shared/api.js';
import type {
  StallHeld, StallLevel, StallLevelChoice, StallNextStep, StallNoticeCount, StallStage, StallStored, StallWatchRequest,
  StallWatchStages, StallWriteEffect,
} from '../../../shared/api.js';
import { STALL_QUIET_MS, parseStallDetail, rungRecipient, stallArmHasRung, stallArmingOf } from './stall.js';
import type { StallArming, StallRecipient } from './stall.js';
```

(c) The module docstring (≈19). Before (occurs exactly once, `grep -cF`: 1):

```ts
 * - the resolver both sweeps and the view call, and the readers the view composes.
```

After:

```ts
 * - the resolver both sweeps and the view call, and the readers the view composes;
 * - the write path the POST composes: the body's decision, the projection of the row a write leaves, the write's
 *   effect, the confirm and its key, and the feed body; and the notice counts by role.
```

(d) Directly above the line `// ── the kebab words ──…` (≈276; occurs exactly once, `grep -cF`: 1), insert this block.
It ends with one blank line.

```ts
// ── the write path ───────────────────────────────────────────────────────────────────────────────────────────────

/** What a write asks the store to change. An omitted field keeps its stored value; `quiet` `default` is SQL `NULL`,
 *  the built-in. The store takes it as decided and validates nothing (the `setCaps` division of labour). */
export interface StallSettingsPatch {
  readonly level?: StallLevelChoice;
  readonly quiet?: { readonly kind: 'default' } | { readonly kind: 'set'; readonly ms: number };
}
/** The POST body, decided: the patch and the confirm key it carried (`null` when it carried none), or a refusal whose
 *  detail names the field. Two shapes, never one nullable field. */
export type StallSettingsDecision =
  | { readonly ok: true; readonly patch: StallSettingsPatch; readonly confirm: string | null }
  | { readonly ok: false; readonly detail: string };

/** The keys a write may name, each a `StallWatchRequest` field, enumerated once. */
const STALL_REQUEST_KEYS = ['level', 'quietMs', 'confirm'] as const satisfies readonly (keyof StallWatchRequest)[];
const listed = (words: readonly string[]): string =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** §10 step 2. Refuses, never clamps: a body that is not an object; an unknown key, named, so a newer page sending a
 *  knob this server lacks hears that it was not applied (departure `unknown-keys-refused` (D-4029), the update-intent
 *  rule over the caps one); a body naming neither field; a level that is not a `StallLevelChoice`; a quiet time that is
 *  neither `'default'` nor whole 30-minute steps in range (`isStallQuietMs`, departure `quiet-half-hour-steps`
 *  (D-4026)); a confirm that is not a string. */
export function decideStallSettings(body: unknown): StallSettingsDecision {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, detail: 'body must be an object' };
  const o = body as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(STALL_REQUEST_KEYS as readonly string[]).includes(k)) {
      return { ok: false, detail: `unknown key ${k}: a write names only ${listed(STALL_REQUEST_KEYS)}` };
    }
  }
  const has = (k: (typeof STALL_REQUEST_KEYS)[number]): boolean => Object.prototype.hasOwnProperty.call(o, k);
  if (!has('level') && !has('quietMs')) return { ok: false, detail: 'at least one of level or quietMs must be given' };
  const patch: { level?: StallLevelChoice; quiet?: StallSettingsPatch['quiet'] } = {};
  if (has('level')) {
    const level = o.level;
    if (!isStallLevelChoice(level)) return { ok: false, detail: `level must be follow or one of ${STALL_LEVELS.join(', ')}` };
    patch.level = level;
  }
  if (has('quietMs')) {
    const q = o.quietMs;
    if (q === 'default') patch.quiet = { kind: 'default' };
    else if (isStallQuietMs(q)) patch.quiet = { kind: 'set', ms: q };
    else {
      return { ok: false,
        detail: `quietMs must be 'default' or a whole number of milliseconds from ${STALL_QUIET_MIN_MS} to ${STALL_QUIET_MAX_MS} in steps of ${STALL_QUIET_STEP_MS}` };
    }
  }
  const confirm = o.confirm;
  if (has('confirm') && typeof confirm !== 'string') return { ok: false, detail: 'confirm must be a string' };
  return { ok: true, patch, confirm: typeof confirm === 'string' ? confirm : null };
}

/** The migration's seed: today's behaviour. The insert arm of the store's write starts from it. */
export const STALL_SETTINGS_SEED = { level: 'follow', quietMs: null } as const;

/** Whether a patch changes nothing in a stored row: every named field already equals its stored value, the level
 *  token as stored and the quiet time after the parse's `bigint` conversion, with SQL `NULL` for `default`. A plain
 *  `===` against a stored `bigint` never matches, so the conversion is not optional. The store's no-op skip and the
 *  projection below both ask this (departure `no-op-write-records-no-feed-event` (D-4031)). */
export function stallPatchIsNoOp(row: StallSettingsRow, patch: StallSettingsPatch): boolean {
  const levelSame = patch.level === undefined || row.level === patch.level;
  const quietSame = patch.quiet === undefined
    || (patch.quiet.kind === 'default' ? row.quietMs === null : fromStore(row.quietMs) === patch.quiet.ms);
  return levelSame && quietSame;
}

/** The read the store's write will leave (§8), so the route can measure what a write does before it writes:
 *  - an unreadable read is returned as it is, because nothing is written over it;
 *  - a row the patch does not change is returned as it is, `updatedAt` included (the no-op skip);
 *  - an absent row takes the insert arm: the seed, overridden by the named fields;
 *  - a row takes the update arm: the named fields over the stored ones, the other kept as stored, an unreadable
 *    value included, so a quiet-only write leaves an unreadable level unreadable.
 *  Both written arms stamp `updatedAt` with the write's `at`. */
export function stallSettingsAfter(before: StallSettingsRead, patch: StallSettingsPatch, at: number): StallSettingsRead {
  if (before.kind === 'unreadable') return before;
  if (before.kind === 'row' && stallPatchIsNoOp(before.row, patch)) return before;
  const base: StallSettingsRow = before.kind === 'row' ? before.row : { ...STALL_SETTINGS_SEED, updatedAt: at };
  return {
    kind: 'row',
    row: {
      level: patch.level ?? base.level,
      quietMs: patch.quiet === undefined ? base.quietMs : patch.quiet.kind === 'default' ? null : patch.quiet.ms,
      updatedAt: at,
    },
  };
}

/** A measured write effect: what the route computes once the registry listed. */
export type StallMeasuredEffect = Extract<StallWriteEffect, { readonly measured: true }>;

/** What a write does (§10; departures `server-decides-the-confirm` (D-4033) and `confirm-on-stage-diff` (D-4034)).
 *  Each read is parsed and resolved against the same box, so each side gets the whole-row fallback. Stages are
 *  compared through `armedStages`, so `mail-disabled` never enters the diff (a stored choice arms its stages for the
 *  moment mail returns), and in two readings: the resolved one, and the unheld one, against `unheld` (no kill file, no
 *  strict gate, mail on), so a stage the fleet box holds is confirmed when the write arms it, not when the hold lifts.
 *  - `turnsOn`: off before and on after in either reading; `turnsOff`: on before and off after in the resolved one;
 *    both in §5.1's order.
 *  - `leavesWave2`: the further checks on before and off after, in either reading.
 *  - `heldByBox`: a stage in `turnsOn`, or `leavesWave2`, comes from the unheld reading alone.
 *  - `quietLowered`: the effective quiet time changes, and lands below the one before or below the built-in.
 *  - `filesExceed`: over the resolution the write leaves. */
export function stallWriteEffect(box: StallBoxArming, unheld: StallBoxArming, beforeRead: StallSettingsRead, afterRead: StallSettingsRead): StallMeasuredEffect {
  const beforeSettings = parseStallSettings(beforeRead);
  const afterSettings = parseStallSettings(afterRead);
  const was = resolveStallWatch(box, beforeSettings);
  const now = resolveStallWatch(box, afterSettings);
  const before = armedStages(was.arming);
  const after = armedStages(now.arming);
  const freeBefore = armedStages(resolveStallWatch(unheld, beforeSettings).arming);
  const freeAfter = armedStages(resolveStallWatch(unheld, afterSettings).arming);
  const onNow = (s: StallStage): boolean => !before[s] && after[s];
  const turnsOn = STALL_STAGES.filter((s) => onNow(s) || (!freeBefore[s] && freeAfter[s]));
  const turnsOff = STALL_STAGES.filter((s) => before[s] && !after[s]);
  const leavesNow = before.wave2 && !after.wave2;
  const leavesWave2 = leavesNow || (freeBefore.wave2 && !freeAfter.wave2);
  const heldByBox = turnsOn.some((s) => !onNow(s)) || (leavesWave2 && !leavesNow);
  const quietLowered = now.quietMs !== was.quietMs && (now.quietMs < was.quietMs || now.quietMs < STALL_QUIET_MS);
  return {
    measured: true,
    turnsOn,
    turnsOff,
    leavesWave2,
    heldByBox,
    quietLowered,
    filesExceed: stallFilesExceed(box, now),
    before,
    after,
    quietMs: { before: was.quietMs, after: now.quietMs },
    mailOff: box.mailDisabled,
  };
}

/** Whether a write needs the operator's confirm: always for the unmeasured effect; otherwise exactly when a stage
 *  turns on in either reading, the further checks are left, or the quiet time is brought lower. A pure lowering of
 *  the level needs none. */
export function stallNeedsConfirm(effect: StallWriteEffect): boolean {
  if (!effect.measured) return true;
  return effect.turnsOn.length > 0 || effect.leavesWave2 || effect.quietLowered;
}

/** The confirm key: eight hex characters of a 32-bit FNV-1a over the effect's JSON and the before-row's `updatedAt`
 *  (`none` when it parsed `null`), in plain JavaScript, so no `node:crypto`. The builders return literals, so the key
 *  order is fixed. A staleness check, not a credential: the session gate guards the door. Because `updatedAt` is in
 *  it, a write between the 409 and the re-POST fails the match even when the effect reads the same. */
export function stallEffectKey(effect: StallWriteEffect, updatedAt: number | null): string {
  const s = `${JSON.stringify(effect)}@${updatedAt === null ? 'none' : String(updatedAt)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A quiet time as the feed body writes it: `30 min`, `2 h`, `2 h 30 min`. */
function stallQuietWords(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
function stallLevelChangeWords(p: StallSettingsParsed): string {
  if (p.level.kind === 'follow') return STALL_FOLLOW_LABEL;
  if (p.level.kind === 'chosen') return STALL_LEVEL_TEXT[p.level.level].label;
  return p.stored === 'absent' ? 'no stored choice' : 'unreadable stored level';
}
function stallQuietChangeWords(p: StallSettingsParsed): string {
  if (p.quiet.kind === 'default') return STALL_SECTION_TEXT.builtIn.replace('{value}', stallQuietWords(STALL_QUIET_MS));
  if (p.quiet.kind === 'set') return stallQuietWords(p.quiet.ms);
  return p.stored === 'absent' ? 'no stored choice' : 'unreadable stored quiet time';
}

/** The feed body for a write (§10 step 6), or `null` when the level and the quiet time read the same before and
 *  after; `updatedAt` never counts, so a no-op records nothing (D-4031). It names only what changed, with the L0
 *  labels, and names a `before` that was not a readable row explicitly, so a write that restores a lost row is
 *  recorded and never prints `undefined`. The route appends the actor. */
export function stallSettingsChange(before: StallSettingsRead, after: StallSettingsRead): string | null {
  const was = parseStallSettings(before);
  const now = parseStallSettings(after);
  const parts: string[] = [];
  const levelWas = stallLevelChangeWords(was);
  const levelNow = stallLevelChangeWords(now);
  if (levelWas !== levelNow) parts.push(`level: ${levelWas} → ${levelNow}`);
  const quietWas = stallQuietChangeWords(was);
  const quietNow = stallQuietChangeWords(now);
  if (quietWas !== quietNow) parts.push(`quiet time: ${quietWas} → ${quietNow}`);
  return parts.length === 0 ? null : parts.join('; ');
}

// ── the notice counts ────────────────────────────────────────────────────────────────────────────────────────────

/** One `run_events` row as the count reads it (§11): the store returns the window's rows and spells no detail head;
 *  the classification happens here, in L1. */
export interface StallObservationRow { readonly at: number; readonly detail: string | null }
type StallNoticeRow = StallNoticeCount['row'];
/** The four rows, in L0 key order, derived. */
const STALL_NOTICE_ROWS = Object.keys(STALL_NOTICE_TEXT) as StallNoticeRow[];
/** Each rung's row from its table recipient, with one arm named: `quiet` rung 1, the checks the kill rule reads. The
 *  observation records no recipient and the verdict can override the table, so no row claims a recipient (departure
 *  `counts-by-role` (D-4027)). */
const STALL_ROLE_ROW: Readonly<Record<StallRecipient, StallNoticeRow>> = { worker: 'wakes', coordinator: 'reports', operator: 'pushes' };

/** The notice counts by role, live (`sent`) and shadow apart, over rows the store already windowed. A row that is not
 *  exactly a stall detail of this build is skipped, and so is a rung its arm does not have (`stallArmHasRung` asks
 *  before `rungRecipient` would throw). Always the four rows, zeros included, in L0 key order. */
export function stallNoticeCounts(rows: readonly StallObservationRow[]): StallNoticeCount[] {
  const sent = new Map<StallNoticeRow, number>();
  const shadow = new Map<StallNoticeRow, number>();
  for (const r of rows) {
    const n = parseStallDetail(r.detail);
    if (n === null || !stallArmHasRung(n.arm, n.rung)) continue;
    const row = n.arm === 'quiet' && n.rung === 1 ? 'checks' : STALL_ROLE_ROW[rungRecipient(n.arm, n.rung)];
    const column = n.mode === 'live' ? sent : shadow;
    column.set(row, (column.get(row) ?? 0) + 1);
  }
  return STALL_NOTICE_ROWS.map((row) => ({ row, sent: sent.get(row) ?? 0, shadow: shadow.get(row) ?? 0 }));
}
```

- [ ] **Step 5: Run the suite to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-settings.test.ts`

Expected (measured): `Tests  106 passed (106)`. That includes Task 1's purity rows (M19b: the new code adds value
imports from `../../../shared/api.js` and `./stall.js` only, no clock, no `node:`), the M19 control row, and the kebab
code-line row.

- [ ] **Step 6: The mutation table**

Each row: apply the mutation to the named file, run `./node_modules/.bin/vitest run test/stall-settings.test.ts` from
`server/`, record the count, restore the file, and check `git status --short` lists only this task's three files.
Measured on the prototype (each red count is out of 106):

| Guard | Mutation | Red in | Failing (measured) |
|---|---|---|---|
| M10: refused, never clamped | `else if (isStallQuietMs(q))` → `else if (typeof q === 'number' && q >= STALL_QUIET_MIN_MS && q <= STALL_QUIET_MAX_MS)` (accepts a non-step) | stall-settings | 1: `M10: a quiet time off the range or off the step is refused, …` |
| M10: never clamped | the same line → `else if (typeof q === 'number') patch.quiet = { kind: 'set', ms: Math.min(Math.max(q, STALL_QUIET_MIN_MS), STALL_QUIET_MAX_MS) };` | stall-settings | 1: the same row |
| M14: unknown key refused (D-4029) | the unknown-key `return { ok: false, … }` → `continue;` | stall-settings | 1: `M14: an unknown key is refused and named in the detail, …` |
| M14: empty body refused | delete the `if (!has('level') && !has('quietMs')) return …` line | stall-settings | 1: `M14: a body naming neither level nor quietMs is refused, …` |
| M11b (decide half) | `if (!isStallLevelChoice(level)) return` → `if (!(typeof level === 'string' && (level === 'follow' \|\| level in STALL_LADDER))) return` | stall-settings | 1: `M11b: a level that is not a StallLevelChoice is refused, …` |
| confirm is a string | delete the `if (has('confirm') && typeof confirm !== 'string') return …` line | stall-settings | 1: `a confirm must be a string; …` |
| M12d: the seed is today's | `STALL_SETTINGS_SEED`'s `level: 'follow'` → `level: 'log'` | stall-settings | 2: `an absent row takes the insert arm: …`, `M15b: a non-row before is named, …` |
| M12d: the other field is kept | `quietMs: patch.quiet === undefined ? base.quietMs : …` → `… ? null : …` | stall-settings | 2: `a row takes the update arm: …`, `an unreadable level with a stored 30 min and a write of Follow: …` |
| M12d: nothing over an unreadable read | `if (before.kind === 'unreadable') return before;` → return a seeded row | stall-settings | 1: `an unreadable read is returned unchanged: …` |
| M12b: compared after the bigint conversion | `fromStore(row.quietMs) === patch.quiet.ms` → `row.quietMs === patch.quiet.ms` | stall-settings | 2: `a no-op leaves the read as it is, …`, `stallPatchIsNoOp compares the named fields only, …` |
| M12b: the no-op skip (D-4031) | delete `if (before.kind === 'row' && stallPatchIsNoOp(before.row, patch)) return before;` | stall-settings | 1: `a no-op leaves the read as it is, …` |
| M26: a stage turning on | `stallNeedsConfirm` without `effect.turnsOn.length > 0 \|\|` | stall-settings | 7: the full-effect row, the busy-gate row, the absent-row row, the stored-`all` row, the mail-disabled row, the kill-file row, the strict row |
| M26: leaving the further checks | `stallNeedsConfirm` without `effect.leavesWave2 \|\|` | stall-settings | 2: `leaving the further checks: …`, `leaving the further checks under the kill file is held too: …` |
| M26: a quiet time brought lower | `stallNeedsConfirm` without `\|\| effect.quietLowered` | stall-settings | 2: `a quiet time brought below the current one, …`, `an unreadable level with a stored 30 min …` |
| M26: the unmeasured effect | `if (!effect.measured) return true;` → `return false;` | stall-settings | 1: `the unmeasured effect always needs the confirm` |
| M26: mail-disabled kept out of the diff | `before`/`after` from `stallStages` instead of `armedStages` | stall-settings | 1: `mail-disabled is ignored for the diff: …` |
| M26: the unheld reading (D-4033, D-4034) | `turnsOn` from `onNow(s)` alone | stall-settings | 2: the kill-file row, the strict row |
| M26: leaving the further checks, unheld | `leavesWave2 = leavesNow` | stall-settings | 1: `leaving the further checks under the kill file is held too: …` |
| M26: below the built-in | `quietLowered`'s `(… \|\| now.quietMs < STALL_QUIET_MS)` → `now.quietMs < was.quietMs` | stall-settings | 1: `a quiet time brought below the current one, …` |
| heldByBox, the wave-2 half | drop `\|\| (leavesWave2 && !leavesNow)` | stall-settings | 1: `leaving the further checks under the kill file is held too: …` |
| heldByBox, the turn-on half | `heldByBox = leavesWave2 && !leavesNow` | stall-settings | 2: the kill-file row, the strict row |
| M28: the effect's after state | `filesExceed: stallFilesExceed(box, now)` → `(box, was)` | stall-settings | 1: `M28 (the effect's after state): …` |
| M27 (L1 half): `updatedAt` in the digest | the digest string → `` `${JSON.stringify(effect)}@none` `` | stall-settings | 2: `is eight hex characters of FNV-1a …`, `a write between the 409 and the re-POST changes the key …` |
| M15b: a non-row before is named | `stallLevelChangeWords`' last line → `return String(p.level.token);` | stall-settings | 3: `M15b: …`, `an unreadable stored field is named as unreadable`, `never prints undefined, null or NaN …` |
| M15 (L1 half): `updatedAt` never counts | `return parts.length === 0 ? null : …` → `parts.length === 0 && was.updatedAt === now.updatedAt ? null : …` | stall-settings | 1: `a no-op is null: …` |
| M17: live and shadow apart | `n.mode === 'live' ? sent : shadow` → `? shadow : sent` | stall-settings | 3: the spec-examples row, the every-rung row, `M17b: …` |
| M17: quiet rung 1 is checks (D-4027) | `const row = STALL_ROLE_ROW[rungRecipient(n.arm, n.rung)];` | stall-settings | 2: the spec-examples row, the every-rung row |
| M17: by role, not by rung | `const row = STALL_NOTICE_ROWS[n.rung - 1]!;` | stall-settings | 3: the spec-examples row, the every-rung row, `M17b: …` |
| M17b: a rung the arm lacks | `if (n === null \|\| !stallArmHasRung(n.arm, n.rung)) continue;` → `if (n === null) continue;` | stall-settings | 1: `M17b: a rung the arm lacks is skipped, never thrown on` (RangeError) |
| `stallArmHasRung` is the table | its body → `return true;` (in `stall.ts`) | stall-settings | 2: `M17b: …`, `stallArmHasRung is total, …` |

M17d (the index) and M22 (`stallStages`) need no row here: M17d is the migration's (the store task's), and M22's
stage rows are Task 1's; this task's half of M22 is the "mail-disabled kept out of the diff" row above.

- [ ] **Step 7: The regression suites**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in single-definition mail-routes stall-vocabulary stall-verdict typecheck-tests; do
  ./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests '
done
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'census|citation' | grep -E '^ +Tests '
```

Expected (measured): `Tests  274 passed (274)`, `Tests  59 passed (59)`, `Tests  179 passed (179)`,
`Tests  301 passed (301)`, `Tests  12 passed (12)`, and `Tests  15 passed | 320 skipped (335)`. `mail-routes`
stays green because this task spells no new quoted kebab word in `server/src/coord`. The `stall.ts` insert sits at
≈750, below every line citation of that file (the one found is `stall.ts:104`, in a spec), so no anchor moves.
`typecheck-tests` and `session-hook` are known load flakes: re-run a red one alone with `--testTimeout=240000`.

- [ ] **Step 8: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo ok
```

Expected (measured): `ok`, both exit 0.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/stall.ts server/src/coord/stallsettings.ts server/test/stall-settings.test.ts
git commit -m "feat(stall-watch-settings): L1 write path: decide, the write effect and its key, the feed change, and the notice counts" \
  -m "Cites D-4026, D-4027, D-4029, D-4031, D-4033 and D-4034."
```

---

### Task 3: stall.ts: the chosen quiet time, the backoff ceiling, and the busy clock

**Model routing:** `sonnet`, effort `high`. The work is a transcription of pinned bytes, plus rows and a mutation table.

**Files:**
- Modify: `server/src/coord/stall.ts`
  - `StallArming` (≈120–126): docstring plus the `busySince?` field.
  - `STALL_QUIET_MS` docstring (≈301).
  - `STALL_BACKOFF_CEILING_MS`, new, after `BACKLOG_HORIZON_MS` (≈345).
  - The `stallReactivation` docstring (≈499).
  - `StallInput` (≈518), plus the new `stallQuietMs` after it.
  - `STALL_WORKING_BACKOFF_CAP` docstring (≈679–681).
  - `stallBackoff`: docstring (≈687, ≈696) and return (≈709).
  - `stallWaveOneLadder`'s r1 line (≈918).
  - `stallVerdictInner`'s dialog-cap line (≈1038).
  - `stallQuietFrom` docstring (≈1162).
  - `stallIdleStart`: docstring (≈1729) and its busy line (≈1735).
- Modify: `server/src/coord/stallsettings.ts`. A new `stallBusyClock` goes after `stallFilesExceed` (≈276–281 at Task 2's tip).
- Test:
  - `server/test/stall-verdict.test.ts`: the import (≈7), `Over` (≈70), `stallInput` (≈82), and a new describe at EOF (≈1941).
  - `server/test/stall-backoff.test.ts`: the import (≈6–9), `input` (≈51, ≈56), and two new describes at EOF (≈152).
  - `server/test/stall-session.test.ts`: a new describe at EOF (≈820), right after the `gate-held-mail-is-not-stuck (D-3798)` describe.
  - `server/test/stall-settings.test.ts`: the imports (≈20–27 at Task 2's tip) and a new describe at EOF.

**Interfaces:**
- Consumes:
  - From `stall.ts`: `STALL_QUIET_MS`, `BACKLOG_HORIZON_MS`, `STALL_BOUND_MS`, `STALL_OPERATOR_MS`, `STALL_WORKING_BACKOFF_CAP`, `DELEGATE_CAP_MS` and `MAIL_STUCK_MS`.
  - From `stallsettings.ts` (Task 1): `STALL_QUIET_MIN_MS` and `STALL_QUIET_MAX_MS` (tests only), and `stallBoxArmingOf` (tests, through `box`).
  - From `turnidle.ts`: `type MailTurnMode`.
- Produces (`stall.ts`):
  - `StallInput.quietMs?: number`.
  - `export function stallQuietMs(input: StallInput): number`.
  - `export const STALL_BACKOFF_CEILING_MS: number` (16 h).
  - `StallArming.busySince?: number`.
  - `stallBackoff(input).quietMs`, capped at `STALL_BACKOFF_CEILING_MS`.
  - `stallIdleStart`'s busy bound, `Math.max(stopAt, busySince)`, applied under `busy` only.
- Produces (`stallsettings.ts`): `export function stallBusyClock(resolvedMode: MailTurnMode, lastApplied: MailTurnMode | null, busySince: number | null): { readonly mailMode: MailTurnMode; readonly busySince?: number }`.

**Decisions taken** (spec §7, §9, §20):
- **One reader for the quiet time.** `stallQuietMs(input)` is the only reader, and it is exported so a row can pin it.
- **Where the ceiling goes.** It is defined right after `BACKLOG_HORIZON_MS`, the constant it derives from.
- **Where `stallBusyClock` goes.** It gets its own `── the busy clock` section between the view readers and the write path.
- **What this task does not touch.** The `watch.ts` ≈:192 comment belongs to the `watch.ts` task.
- **Two §20 residue items, both kept as specified.**
  - The ≈10 s busy-shadow window before the first applied busy is kept.
  - `busySince` restarting on a busy → non-busy → busy flap is a property of the watcher's fields, not of this L1 function.

- [ ] **Step 1: Re-anchor**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -c 'STALL_QUIET_MS' server/src/coord/stall.ts
grep -n "^export const BACKLOG_HORIZON_MS = 24 \* 3_600_000;$" server/src/coord/stall.ts
grep -n "^export function stallFilesExceed" server/src/coord/stallsettings.ts
tail -2 server/test/stall-session.test.ts server/test/stall-backoff.test.ts server/test/stall-verdict.test.ts server/test/stall-settings.test.ts
```

Expected:
- `6`: the constant, the ≈499 comment, ≈696, ≈709, ≈918 and ≈1038.
- One line each for the two `grep -n`.
- Each test file ends with `});`. The exception is `stall-settings.test.ts`, which ends with `void _storedIsReadFailure;`.

If anything differs, find the text by content and say so.

- [ ] **Step 2: Write the failing tests**

(a) `server/test/stall-verdict.test.ts`. There are three in-place edits, then an append.

≈7, before:
```ts
  stallVerdict, stallFacts, stallSubjects, isStallKebab,
```
after:
```ts
  stallVerdict, stallFacts, stallSubjects, isStallKebab, stallQuietMs,
```
≈70, before:
```ts
  coordinationPaused?: boolean; coordinator?: CoordinatorState | null; activation?: StallActivation;
}
```
after:
```ts
  coordinationPaused?: boolean; coordinator?: CoordinatorState | null; activation?: StallActivation; quietMs?: number;
}
```
≈82, before:
```ts
    activation: over.activation ?? { kind: 'none' },
  };
}
```
after:
```ts
    activation: over.activation ?? { kind: 'none' },
    ...(over.quietMs !== undefined ? { quietMs: over.quietMs } : {}),
  };
}
```
Append at EOF:
```ts

// ── stall-watch settings (design 2026-10-05 §7, M9): the chosen quiet time reaches r1 and the dialog cap ─────────────
// `StallInput.quietMs` is optional: absent reads the built-in `STALL_QUIET_MS`, so every literal above keeps its meaning.
describe('the chosen quiet time: wave 1\'s r1 and the dialog cap read input.quietMs (stall-watch settings §7, M9)', () => {
  const S = t('2026-09-27T00:00:00Z');   // chosen: the live word turned idle (or waiting) here, after the dispatch
  const idle = workerAt({ live: liveWord('idle', S) });
  const menu = workerAt({ live: liveWord('waiting', S) });

  it('stallQuietMs reads the chosen value, and the built-in when none is given', () => {
    expect(stallQuietMs(stallInput())).toBe(STALL_QUIET_MS);
    expect(stallQuietMs(stallInput({ quietMs: 30 * MIN }))).toBe(30 * MIN);
    expect(stallQuietMs(stallInput({ quietMs: 12 * H }))).toBe(12 * H);
  });

  it.each([
    ['the built-in (absent)', undefined, STALL_QUIET_MS],
    ['a chosen 30 min', 30 * MIN, 30 * MIN],
    ['a chosen 12 h', 12 * H, 12 * H],
  ] as const)('r1 under wave 1\'s ladder falls due at %s of quiet, not a millisecond sooner', (_name, quietMs, due) => {
    const over: Over = quietMs === undefined ? { worker: idle } : { worker: idle, quietMs };
    expect(stallVerdict(stallInput(over), S + due - 1)).toEqual(NONE);
    expect(stallVerdict(stallInput(over), S + due)).toEqual(r1(RUN67_DISPATCHED));
  });

  it.each([
    ['the built-in (absent)', undefined, STALL_QUIET_MS],
    ['a chosen 30 min', 30 * MIN, 30 * MIN],
    ['a chosen 12 h', 12 * H, 12 * H],
  ] as const)('the dialog cap pushes once a dialog has stood %s, and holds before', (_name, quietMs, due) => {
    const over: Over = quietMs === undefined ? { worker: menu } : { worker: menu, quietMs };
    expect(stallVerdict(stallInput(over), S + due - 1)).toEqual(hold('dialog'));
    expect(stallVerdict(stallInput(over), S + due)).toEqual(capOf('dialog-cap', S));
  });

  it('CONTROL: the two chosen values differ from the built-in on both sides, so no row above is the default in disguise', () => {
    expect(30 * MIN).toBeLessThan(STALL_QUIET_MS);
    expect(12 * H).toBeGreaterThan(STALL_QUIET_MS);
    expect(stallVerdict(stallInput({ worker: idle }), S + 30 * MIN)).toEqual(NONE);
    expect(stallVerdict(stallInput({ worker: idle, quietMs: 12 * H }), S + STALL_QUIET_MS)).toEqual(NONE);
  });
});
```

(b) `server/test/stall-backoff.test.ts`. There are three in-place edits, then an append.

≈6–9, before:
```ts
  STALL_CHECK_PREFIX, STALL_REPLY_PREFIX, STALL_REPLY_WAITING_PREFIX,
} from '../src/coord/stall.js';
```
after:
```ts
  STALL_CHECK_PREFIX, STALL_REPLY_PREFIX, STALL_REPLY_WAITING_PREFIX,
  STALL_BACKOFF_CEILING_MS, BACKLOG_HORIZON_MS, STALL_BOUND_MS, STALL_OPERATOR_MS, STALL_ESCALATE_MS,
} from '../src/coord/stall.js';
import { STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS } from '../src/coord/stallsettings.js';
```
≈51, before:
```ts
function input(mail: readonly StallMailRow[], over: { arming?: StallArming; w2?: StallW2Facts } = {}): StallInput {
```
after:
```ts
function input(mail: readonly StallMailRow[], over: { arming?: StallArming; w2?: StallW2Facts; quietMs?: number } = {}): StallInput {
```
≈56, before:
```ts
    ...(over.w2 !== undefined ? { w2: over.w2 } : {}),
  };
```
after:
```ts
    ...(over.w2 !== undefined ? { w2: over.w2 } : {}),
    ...(over.quietMs !== undefined ? { quietMs: over.quietMs } : {}),
  };
```
Append at EOF:
```ts

// ── stall-watch settings (design 2026-10-05 §7): the chosen quiet time is the base (M9), under the ceiling (M9b) ─────
// `backoff-ceiling-from-the-horizon` (D-4025): the computed threshold never passes STALL_BACKOFF_CEILING_MS, derived from
// the mail read's horizon, so a 12 h quiet time cannot push the ladder out of the read that keys its episode.
describe('the back-off base is the chosen quiet time: times 1, 2 and 4 (M9)', () => {
  const ladder = [[], [check(1), working(2)], [check(1), working(2), check(3), working(4)],
    [check(1), working(2), check(3), working(4), check(5), working(6)]] as const;

  it.each([
    ['a chosen 30 min', 30 * MIN, [30 * MIN, 60 * MIN, 120 * MIN, 120 * MIN]],
    ['a chosen 3 h', 3 * H, [3 * H, 6 * H, 12 * H, 12 * H]],
    ['the built-in (absent)', undefined, [2 * H, 4 * H, 8 * H, 8 * H]],
  ] as const)('%s: streaks 0 to 3', (_name, quietMs, want) => {
    const got = ladder.map((mail) => stallBackoff(input(mail, quietMs === undefined ? {} : { quietMs })).quietMs);
    expect(got).toEqual(want);
  });

  it('on the marker branch a chosen 30 min with one working-answered check sends r1 at 1 h of quiet, not 4 h', () => {
    const quiet3h = { w2: w2(doneMark(NOW - 3 * H)), arming: W2_LIVE, quietMs: 30 * MIN };
    expect(stallVerdict(input([check(1), working(2)], quiet3h), NOW - 2 * H - 1)).toEqual(NONE);
    expect(stallVerdict(input([check(1), working(2)], quiet3h), NOW - 2 * H)).toEqual(r1(NOW - 3 * H));
  });
});

describe('the back-off ceiling (backoff-ceiling-from-the-horizon (D-4025), M9b)', () => {
  it('is 16 h, derived from the horizon less twice the marker ladder\'s span after r1', () => {
    expect(STALL_BACKOFF_CEILING_MS).toBe(16 * H);
    expect(STALL_BACKOFF_CEILING_MS).toBe(BACKLOG_HORIZON_MS - 2 * (STALL_BOUND_MS + STALL_OPERATOR_MS));
  });

  it('relation 1: the built-in\'s peak sits under it, so the default is byte-for-byte unchanged', () => {
    expect(STALL_QUIET_MS * 2 ** STALL_WORKING_BACKOFF_CAP).toBeLessThanOrEqual(STALL_BACKOFF_CEILING_MS);
  });
  it('relation 2: the largest quiet time a write may store sits under it, so a stored value is never what is capped', () => {
    expect(STALL_QUIET_MAX_MS).toBeLessThanOrEqual(STALL_BACKOFF_CEILING_MS);
  });
  it('relation 3: the marker ladder after a capped r1 (r2 by the bound, r3 an hour on) ends inside the mail read', () => {
    expect(STALL_BACKOFF_CEILING_MS + STALL_BOUND_MS + STALL_OPERATOR_MS).toBeLessThan(BACKLOG_HORIZON_MS);
  });
  it('relation 4: wave 1\'s ladder at the largest quiet time (r1, r2 an hour on, r3 an hour after) ends inside it too', () => {
    expect(STALL_QUIET_MAX_MS + STALL_ESCALATE_MS + STALL_OPERATOR_MS).toBeLessThan(BACKLOG_HORIZON_MS);
  });

  it.each([
    ['12 h, streak 0', 12 * H, 0, 12 * H],
    ['12 h, streak 1 (24 h computed)', 12 * H, 1, 16 * H],
    ['12 h, streak 2 (48 h computed)', 12 * H, 2, 16 * H],
    ['8 h, streak 1 (exactly the ceiling)', 8 * H, 1, 16 * H],
    ['6 h, streak 2 (24 h computed)', 6 * H, 2, 16 * H],
    ['the smallest quiet time, streak 2', STALL_QUIET_MIN_MS, 2, 4 * STALL_QUIET_MIN_MS],
  ] as const)('caps only the computed threshold: %s', (_name, quietMs, streak, want) => {
    const mail = [[], [check(1), working(2)], [check(1), working(2), check(3), working(4)]][streak]!;
    expect(stallBackoff(input(mail, { quietMs }))).toEqual({ streak, quietMs: want });
  });

  it('on the marker branch a 12 h quiet time with a streak of 2 sends r1 at 16 h of quiet, not 48 h', () => {
    const mail = [check(1), working(2), check(3), working(4)];
    const quiet3h = { w2: w2(doneMark(NOW - 3 * H)), arming: W2_LIVE, quietMs: 12 * H };
    expect(stallVerdict(input(mail, quiet3h), NOW + 13 * H - 1)).toEqual(NONE);
    expect(stallVerdict(input(mail, quiet3h), NOW + 13 * H)).toEqual(r1(NOW - 3 * H));
  });
});
```

(c) `server/test/stall-session.test.ts`. Append at EOF, after the `gate-held-mail-is-not-stuck (D-3798)` describe:
```ts

// ── busy-clock-starts-when-busy-delivery-starts (D-4024): under `busy`, mail-stuck's idle clock is bounded by busySince ──
// stall-watch settings §9. `StallArming.busySince` is when the mail sweep first applied busy delivery after a non-busy
// mode in this server's life. Absent, the clock is today's (the stop). A number bounds it: max(stop, busySince), so held
// mail gets the full MAIL_STUCK_MS from the moment busy delivery began. The busy-shadow line is untouched.
describe('mail-stuck under busy delivery is timed from when it began (busy-clock-starts-when-busy-delivery-starts (D-4024))', () => {
  const doneAt = (stopAt: number): TurnMarkRead => mark({ at: stopAt, turnAt: stopAt - 10 * MIN, stopAt });
  /** A worker whose turn ended at `stopAt`, live `busy` since five minutes later; one mail queued at `mailAt`, still queued. */
  const busyOver = (stopAt: number, mailAt: number, arming: StallArming): StallSessionInput => sessionInput({
    worker: workerAt('busy', stopAt + 5 * MIN), mark: doneAt(stopAt), arming,
    mail: [mailRow(501, mailAt, COORD, WORKER, 'brief', 67)], deliveries: [delivery(901, 501)],
  });
  const stuck: StallVerdict = { act: 'notify', arm: 'mail-stuck', rung: 1, key: 901, to: 'operator' };
  const STOP = NOW - 2 * H;
  const MAIL_AT = NOW - 3 * H;

  it('busySince absent under busy: the stop, exactly today\'s clock', () => {
    expect(stallMailStuckVerdicts(busyOver(STOP, MAIL_AT, { ...W2, mailMode: 'busy' }), NOW)).toEqual([stuck]);
  });

  it('busySince after the stop bounds the clock: nothing reads stuck until MAIL_STUCK_MS after busy delivery began', () => {
    const since = NOW - 30 * MIN;
    const a: StallArming = { ...W2, mailMode: 'busy', busySince: since };
    expect(stallMailStuckVerdicts(busyOver(STOP, MAIL_AT, a), NOW), 'half an hour into busy delivery').toEqual([NONE]);
    expect(stallMailStuckVerdicts(busyOver(STOP, MAIL_AT, a), since + MAIL_STUCK_MS - 1), 'a millisecond short').toEqual([NONE]);
    expect(stallMailStuckVerdicts(busyOver(STOP, MAIL_AT, a), since + MAIL_STUCK_MS), 'at the bound').toEqual([stuck]);
  });

  it('busySince before the stop: the stop still bounds it (max, not busySince alone)', () => {
    const stop = NOW - 60 * MIN;   // an hour ago: inside MAIL_STUCK_MS, so nothing is stuck yet on the stop's clock
    const a: StallArming = { ...W2, mailMode: 'busy', busySince: NOW - 2 * H };
    expect(stallMailStuckVerdicts(busyOver(stop, MAIL_AT, a), NOW)).toEqual([NONE]);
    expect(stallMailStuckVerdicts(busyOver(stop, MAIL_AT, a), stop + MAIL_STUCK_MS)).toEqual([stuck]);
  });

  it('busy-shadow ignores busySince: the clock starts DELEGATE_CAP_MS after the stop, as the gate holds that mail', () => {
    const a: StallArming = { ...W2, mailMode: 'busy-shadow', busySince: NOW - 3 * H };
    expect(stallMailStuckVerdicts(busyOver(STOP, MAIL_AT, a), NOW)).toEqual([NONE]);
    expect(stallMailStuckVerdicts(busyOver(STOP, MAIL_AT, a), STOP + DELEGATE_CAP_MS + MAIL_STUCK_MS - 1)).toEqual([NONE]);
    expect(stallMailStuckVerdicts(busyOver(STOP, MAIL_AT, a), STOP + DELEGATE_CAP_MS + MAIL_STUCK_MS)).toEqual([stuck]);
  });

  it('an idle or shell word is untouched by busySince: the live stamp, as today', () => {
    const a: StallArming = { ...W2, mailMode: 'busy', busySince: NOW - 10 * MIN };
    const idle = sessionInput({ worker: workerAt('idle', STOP), mark: doneAt(STOP), arming: a,
      mail: [mailRow(501, MAIL_AT, COORD, WORKER, 'brief', 67)], deliveries: [delivery(901, 501)] });
    expect(stallMailStuckVerdicts(idle, NOW)).toEqual([stuck]);
  });
});
```

(d) `server/test/stall-settings.test.ts`. There are two in-place edits, then an append.

Before:
```ts
  stallPatchIsNoOp, stallSettingsAfter, stallSettingsChange, stallStages, stallUnheldBoxOf, stallWriteEffect,
} from '../src/coord/stallsettings.js';
```
after:
```ts
  stallPatchIsNoOp, stallSettingsAfter, stallSettingsChange, stallStages, stallUnheldBoxOf, stallWriteEffect,
  stallBusyClock,
} from '../src/coord/stallsettings.js';
```
Before:
```ts
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER, mailTurnModeOf } from '../src/turnidle.js';
```
after:
```ts
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER, mailTurnModeOf } from '../src/turnidle.js';
import type { MailTurnMode } from '../src/turnidle.js';
```
Append at EOF:
```ts

// ── the busy clock (§9, busy-clock-starts-when-busy-delivery-starts (D-4024), M8 and M4's stallBusyClock arm) ─────
describe('stallBusyClock: the judged mail mode and when busy delivery began (§9, D-4024)', () => {
  const NON_BUSY: readonly MailTurnMode[] = ['strict', 'shell', 'busy-shadow'];
  const T = 1_790_000_000_000;

  it('answer 1: busy resolved over a known non-busy applied mode is judged as the busy gate, whatever busySince says', () => {
    for (const last of NON_BUSY) {
      expect(stallBusyClock('busy', last, null), last).toStrictEqual({ mailMode: 'busy-shadow' });
      expect(stallBusyClock('busy', last, T), last).toStrictEqual({ mailMode: 'busy-shadow' });
    }
  });

  it('answer 2: busy resolved, busy applied and a measured start bounds the clock from it', () => {
    expect(stallBusyClock('busy', 'busy', T)).toStrictEqual({ mailMode: 'busy', busySince: T });
  });

  it('answer 3: busy applied with no measured start (the first busy after a restart) is today\'s expression, no busySince key', () => {
    expect(stallBusyClock('busy', 'busy', null)).toStrictEqual({ mailMode: 'busy' });
  });

  it('M4: at boot (nothing applied yet) it neither substitutes nor bounds', () => {
    const r = stallBusyClock('busy', null, null);
    expect(r).toStrictEqual({ mailMode: 'busy' });
    expect(Object.keys(r)).toEqual(['mailMode']);
  });

  it('answer 3: every non-busy resolved mode passes through unchanged, whatever was applied and whenever', () => {
    for (const mode of NON_BUSY) {
      for (const last of [null, 'busy', ...NON_BUSY] as const) {
        for (const since of [null, T]) {
          expect(stallBusyClock(mode, last, since), `${mode} over ${String(last)} at ${String(since)}`).toStrictEqual({ mailMode: mode });
        }
      }
    }
  });

  it('spread over a box arming, it replaces only mailMode and adds busySince only when it bounds', () => {
    const a = box(LIVE, ESCALATE, BUSY);
    expect(a.mailMode, 'CONTROL: the box delivers on busy').toBe('busy');
    expect({ ...a, ...stallBusyClock(a.mailMode, null, null) }).toStrictEqual(a);
    expect({ ...a, ...stallBusyClock(a.mailMode, 'shell', null) }).toStrictEqual({ ...a, mailMode: 'busy-shadow' });
    expect({ ...a, ...stallBusyClock(a.mailMode, 'busy', T) }).toStrictEqual({ ...a, busySince: T });
  });
});
```

Every quoted "before" above occurs exactly once in its file. This was measured with a count over the file as Task 2 left it: `grep -c` style, `1` each.

- [ ] **Step 3: Run the suites to verify they fail**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-verdict stall-backoff stall-session stall-settings; do ./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests '; done
```

Expected (measured on the prototype):
- `stall-verdict`: `Tests 6 failed | 303 passed (309)`.
  - Failing: `stallQuietMs reads the chosen value…` (`stallQuietMs is not a function`), r1 at a chosen 30 min and at a chosen 12 h, the dialog cap at a chosen 30 min and at a chosen 12 h, and the CONTROL row.
  - The two built-in rows pass.
- `stall-backoff`: `Tests 14 failed | 19 passed (33)`. Every new row fails except the built-in streak row and relation 4, which needs no new constant.
- `stall-session`: `Tests 1 failed | 97 passed (98)`. Failing: `busySince after the stop bounds the clock…` (half an hour into busy delivery: expected `[notify]` to equal `[none]`). The other four new rows pin today's clock and pass.
- `stall-settings`: `Tests 6 failed | 106 passed (112)`. Every new row fails: `stallBusyClock is not a function`.

- [ ] **Step 4: Implement**

(a) `server/src/coord/stall.ts`, `StallArming` (≈124–126). Before:
```ts
 *  `mailMode` from `turnidle.ts`'s `mailTurnModeOf` over the same listing, which mail-stuck's idle clock reads. */
export interface StallArming { readonly disabled: boolean; readonly live: boolean; readonly escalate: boolean; readonly w2Live?: boolean; readonly mailDisabled?: boolean; readonly mailMode?: MailTurnMode }
```
after:
```ts
 *  `mailMode` from `turnidle.ts`'s `mailTurnModeOf` over the same listing, which mail-stuck's idle clock reads.
 *  `busySince` is `mailMode`'s companion on that same clock (`busy-clock-starts-when-busy-delivery-starts` (D-4024)):
 *  when the mail sweep began busy delivery after a non-busy mode, in this server's life. Absent means today's clock,
 *  on the `w2-arming-optional` precedent; it has no `null`, because a gate that has not delivered on busy yet is judged
 *  through its `mailMode` instead (`stallsettings.ts`' `stallBusyClock` decides both). */
export interface StallArming { readonly disabled: boolean; readonly live: boolean; readonly escalate: boolean; readonly w2Live?: boolean; readonly mailDisabled?: boolean; readonly mailMode?: MailTurnMode; readonly busySince?: number }
```

(b) ≈301. Before:
```ts
/** r1 falls due after this much quiet. Spec §10: the census replay; the 1–2 h band is almost all legit. */
```
after:
```ts
/** The built-in quiet time: r1 falls due after this much quiet unless Settings chose another (stall-watch settings
 *  §7; `stallQuietMs` reads the choice). Spec §10: the census replay; the 1–2 h band is almost all legit. The one
 *  built-in default: the constants pin keeps it at 2 h. */
```

(c) ≈345. Before:
```ts
export const BACKLOG_HORIZON_MS = 24 * 3_600_000;
```
after:
```ts
export const BACKLOG_HORIZON_MS = 24 * 3_600_000;
/** The working-reply back-off's ceiling (`backoff-ceiling-from-the-horizon` (D-4025)): 16 h. The streak, the episode key
 *  and the quiet clock all come from a mail read that looks back BACKLOG_HORIZON_MS, so the computed threshold must
 *  leave the marker ladder's span after r1 (r2 by STALL_BOUND_MS, r3 STALL_OPERATOR_MS later), twice over, inside it.
 *  Only the computed threshold is capped; a stored quiet time never is. `stall-backoff.test.ts` pins its relations. */
export const STALL_BACKOFF_CEILING_MS = BACKLOG_HORIZON_MS - 2 * (STALL_BOUND_MS + STALL_OPERATOR_MS);
```

(d) ≈499. Before:
```ts
 *  active state, IS one: the clock restarts once, which defers r1 by at most `STALL_QUIET_MS`, where refusing it
```
after:
```ts
 *  active state, IS one: the clock restarts once, which defers r1 by at most the quiet time, where refusing it
```

(e) ≈518, the last field of `StallInput`. Before:
```ts
  readonly w2?: StallW2Facts;                   // wave 2's facts; absent = the lane read none, and wave 1's verdict stands
}
```
after:
```ts
  readonly w2?: StallW2Facts;                   // wave 2's facts; absent = the lane read none, and wave 1's verdict stands
  readonly quietMs?: number;                    // the resolved quiet time (stall-watch settings §7); absent = STALL_QUIET_MS
}
/** The quiet time this input is judged on: the one reader of `StallInput.quietMs` (stall-watch settings §7), at its
 *  three uses (wave 1's r1, the dialog cap, the working-reply back-off's base). Absent reads the built-in, so every
 *  literal that leaves it out keeps its meaning (the `w2-arming-optional` precedent). */
export function stallQuietMs(input: StallInput): number {
  return input.quietMs ?? STALL_QUIET_MS;
}
```

(f) ≈679–681. Before:
```ts
 *  threshold is 2 h, then 4 h, then 8 h from the second answered check on. CHOSEN, not measured: the operator has
 *  not ruled on I2, and 8 h keeps a worker that only ever says "still working" inside one working day between
 *  checks. */
```
after:
```ts
 *  threshold is the quiet time, then twice it, then four times it from the second answered check on, under
 *  STALL_BACKOFF_CEILING_MS (2 h, 4 h and 8 h at the built-in). CHOSEN, not measured: the operator has not ruled on I2,
 *  and 8 h keeps a worker that only ever says "still working" inside one working day between checks. */
```

(g) ≈687. Before:
```ts
 * worker is not silent, and a 2 h check on every episode would teach it to ignore them.
```
after:
```ts
 * worker is not silent, and a check one quiet time into every episode would teach it to ignore them.
```

(h) ≈696. Before:
```ts
 * Wave 1's ladder never calls this. Without the marker rules r1 stays at `STALL_QUIET_MS`, so dark means dark.
```
after:
```ts
 * Wave 1's ladder never calls this. Without the marker rules r1 stays at the quiet time, so dark means dark.
 *
 * The computed threshold never passes STALL_BACKOFF_CEILING_MS (`backoff-ceiling-from-the-horizon` (D-4025)): at a 12 h
 * quiet time the doubled waits would outrun the mail read that keys the episode, and re-send r1.
```

(i) ≈709. Before:
```ts
  return { streak, quietMs: STALL_QUIET_MS * 2 ** Math.min(streak, STALL_WORKING_BACKOFF_CAP) };
```
after:
```ts
  return { streak, quietMs: Math.min(stallQuietMs(input) * 2 ** Math.min(streak, STALL_WORKING_BACKOFF_CAP), STALL_BACKOFF_CEILING_MS) };
```

(j) ≈918, `stallWaveOneLadder`. Before:
```ts
  if (r1At === null) return now - since >= STALL_QUIET_MS ? { act: 'notify', arm: 'quiet', rung: 1, key, to: 'worker' } : VERDICT_NONE;
```
after:
```ts
  if (r1At === null) return now - since >= stallQuietMs(input) ? { act: 'notify', arm: 'quiet', rung: 1, key, to: 'worker' } : VERDICT_NONE;
```

(k) ≈1038, `stallVerdictInner`. Before:
```ts
  if (dialogShaped) return capQuiet >= STALL_QUIET_MS && !stallDialogCapDone(input, live.since) ? capVerdict('dialog-cap', dialogKey) : holdVerdict('dialog');
```
after:
```ts
  if (dialogShaped) return capQuiet >= stallQuietMs(input) && !stallDialogCapDone(input, live.since) ? capVerdict('dialog-cap', dialogKey) : holdVerdict('dialog');
```

(l) ≈1162. Before:
```ts
/** When the worker's live status last turned idle: wave 1's r1 clock (r1 is sent when that stamp is two hours old).
```
after:
```ts
/** When the worker's live status last turned idle: wave 1's r1 clock (r1 is sent when that stamp is one quiet time old).
```

(m) ≈1729, `stallIdleStart`'s docstring. Before:
```ts
 *  subagent-covered main silence, past which a delivery still queued cannot reach its recipient. Else null. */
```
after:
```ts
 *  subagent-covered main silence, past which a delivery still queued cannot reach its recipient. Under `busy` with a
 *  measured `busySince` it starts at the later of the stop and that moment (`busy-clock-starts-when-busy-delivery-starts`
 *  (D-4024)): held mail gets the full MAIL_STUCK_MS from when busy delivery began, never from a stop that came while
 *  the busy gate held it. Else null. */
```

(n) ≈1735, `stallIdleStart`'s busy line. Before:
```ts
  if (live !== null && live.word === 'busy' && (input.arming.mailMode ?? 'shell') !== 'busy') return m.stopAt + DELEGATE_CAP_MS;
```
after:
```ts
  if (live !== null && live.word === 'busy') {
    if ((input.arming.mailMode ?? 'shell') !== 'busy') return m.stopAt + DELEGATE_CAP_MS;
    if (input.arming.busySince !== undefined) return Math.max(m.stopAt, input.arming.busySince);
  }
```

(o) `server/src/coord/stallsettings.ts`, the end of `stallFilesExceed`. Before:
```ts
  return STALL_SENDING_STAGES.some((s) => files[s] && !now[s]);
}
```
after:
```ts
  return STALL_SENDING_STAGES.some((s) => files[s] && !now[s]);
}

// ── the busy clock ───────────────────────────────────────────────────────────────────────────────────────────────

/** The stall sweep's judged mail mode and mail-stuck's busy start (§9, `busy-clock-starts-when-busy-delivery-starts`
 *  (D-4024)). `lastApplied` and `busySince` are the watcher's two fields, written only by the mail sweep: the mode it
 *  last applied (`null` before its first), and when it moved into busy delivery from a known non-busy mode (`null`
 *  when no such move has been seen since the server started). Three answers:
 *  - `busy` resolved over a known non-busy applied mode: busy delivery has not happened yet, so busy is judged as the
 *    busy gate is (`busy-shadow`), and nothing reads stuck during the first busy pass;
 *  - `busy` resolved with a measured `busySince`: `busy`, bounded from that moment (`stallIdleStart`'s max);
 *  - otherwise the resolved mode as it stands: today's expression, with no `busySince` key. At boot `lastApplied` is
 *    `null`, so this is what the stall sweep judges until busy delivery begins again while the server runs. */
export function stallBusyClock(resolvedMode: MailTurnMode, lastApplied: MailTurnMode | null, busySince: number | null): { readonly mailMode: MailTurnMode; readonly busySince?: number } {
  if (resolvedMode !== 'busy') return { mailMode: resolvedMode };
  if (lastApplied !== null && lastApplied !== 'busy') return { mailMode: 'busy-shadow' };
  if (busySince !== null) return { mailMode: 'busy', busySince };
  return { mailMode: resolvedMode };
}
```

Notes on this step:
- `stallsettings.ts` already imports `type MailTurnMode` from `../turnidle.js`, and `'busy-shadow'` is already declared through `isStallSettingsKebab`, so neither import nor kebab list changes.
- `stall.ts` spells no marker name and keeps its one L0 value import.
- After the edit, `grep -c 'STALL_QUIET_MS' server/src/coord/stall.ts` reads `3`: the constant, the `StallInput` field comment and `stallQuietMs`'s body.

- [ ] **Step 5: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-verdict stall-backoff stall-session stall-settings; do ./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests '; done
```

Expected (measured):
- `stall-verdict`: `Tests 309 passed (309)`
- `stall-backoff`: `Tests 33 passed (33)`
- `stall-session`: `Tests 98 passed (98)`
- `stall-settings`: `Tests 112 passed (112)`

- [ ] **Step 6: The mutation table**

For each row: apply the mutation, run the named suite, record the result, then restore. `git status` then shows only the six files of this task.

| # | Guard | Mutation | Red in | Measured |
|---|---|---|---|---|
| M9-a | r1 reads the quiet time | `stallWaveOneLadder`: `stallQuietMs(input)` → `STALL_QUIET_MS` | stall-verdict | 3 failed: r1 at a chosen 30 min, r1 at a chosen 12 h, CONTROL |
| M9-b | The dialog cap reads it | `stallVerdictInner`: `capQuiet >= stallQuietMs(input)` → `capQuiet >= STALL_QUIET_MS` | stall-verdict | 2 failed: the dialog cap at 30 min and at 12 h |
| M9-c | The back-off base reads it | `stallBackoff`: `stallQuietMs(input) * 2 **` → `STALL_QUIET_MS * 2 **` | stall-backoff | 10 failed: 30 min, 3 h, marker-branch 1 h, and the six ceiling `it.each` rows plus the 16 h marker row, except the 12 h / 6 h rows that match by value |
| M9b-a | The ceiling caps | Drop the `Math.min(…, STALL_BACKOFF_CEILING_MS)` | stall-backoff | 4 failed: 12 h streak 1, 12 h streak 2, 6 h streak 2, the marker-branch 16 h row |
| M9b-b | The ceiling's relation | Raise it to `BACKLOG_HORIZON_MS - (STALL_BOUND_MS + STALL_OPERATOR_MS)` (20 h) | stall-backoff | 6 failed: `is 16 h…`, relation 3, 12 h streak 1, 12 h streak 2, 6 h streak 2, the marker-branch 16 h row |
| M8-s1 | The busy bound | Delete the `busySince !== undefined` line | stall-session | 1 failed: `busySince after the stop bounds the clock…` |
| M8-s2 | max, not busySince alone | `Math.max(m.stopAt, input.arming.busySince)` → `input.arming.busySince` | stall-session | 1 failed: `busySince before the stop: the stop still bounds it…` |
| M8-s3 | The bound applies under `busy` only | Move the `busySince` line above the `!== 'busy'` line | stall-session | 1 failed: `busy-shadow ignores busySince…` |
| M8-c1 | `stallBusyClock`'s busy-gate substitution | Delete the `lastApplied !== null && lastApplied !== 'busy'` line | stall-settings | 2 failed: answer 1, and the spread row |
| M4-c | It does not substitute at boot | `lastApplied !== null && lastApplied !== 'busy'` → `lastApplied !== 'busy'` | stall-settings | 2 failed: `M4: at boot…`, and the spread row |
| M8-c2 | `stallBusyClock` bounds | Delete the `busySince !== null` line | stall-settings | 2 failed: answer 2, and the spread row |
| M4-c2 | It does not bound at boot | The last return → `{ mailMode: resolvedMode, busySince: 0 }` | stall-settings | 3 failed: `M4: at boot…`, answer 3 (no `busySince` key), and the spread row |

- [ ] **Step 7: The regression suites**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-vocabulary stall-bodies stall-verdict stall-session stall-backoff stall-settings stall-sweep single-definition mail-routes mail-sweep turnidle; do echo "$f $(./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests ')"; done
```

Expected (measured):

| Suite | Result |
|---|---|
| `stall-vocabulary` | `179 passed (179)` |
| `stall-bodies` | `165 passed (165)` |
| `stall-verdict` | `309 passed (309)` |
| `stall-session` | `98 passed (98)` |
| `stall-backoff` | `33 passed (33)` |
| `stall-settings` | `112 passed (112)` |
| `stall-sweep` | `109 passed (109)` (still unwired: no `StallInput` sets `quietMs`, no arming carries `busySince`) |
| `single-definition` | `274 passed (274)` |
| `mail-routes` | `59 passed (59)` |
| `mail-sweep` | `104 passed (104)` |
| `turnidle` | `54 passed (54)` |

A red suite from the known-flake list is re-run alone with `--testTimeout=240000` before it is called real.

- [ ] **Step 8: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo TSC-OK
```

Expected (measured): both exit 0, so the command prints `TSC-OK`.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/stall.ts server/src/coord/stallsettings.ts server/test/stall-verdict.test.ts server/test/stall-backoff.test.ts server/test/stall-session.test.ts server/test/stall-settings.test.ts
git commit -m "feat(stall-watch-settings): W1 T3 — the chosen quiet time, the backoff ceiling, and the busy clock

StallInput.quietMs with its one reader stallQuietMs at r1, the dialog cap and the
back-off base; STALL_BACKOFF_CEILING_MS, 16 h from the mail read's horizon
(backoff-ceiling-from-the-horizon, D-4025); StallArming.busySince, stallIdleStart's
busy bound max(stop, busySince), and stallBusyClock in stallsettings.ts
(busy-clock-starts-when-busy-delivery-starts, D-4024). Stale '2 h' comments reworded."
```

---

### Task 4: Storage: the migration, the run_events_by_at index, and the store methods

**Model routing:** `sonnet`, effort `high`: one migration entry, three store methods transcribed from this plan, a new suite, and a mutation table.

**Files:**
- Modify: `server/src/coord/schema.ts`: append `MIGRATIONS[16]` (banner `17: user_version 16 -> 17`) after the last entry, before the closing `];` (≈1232).
- Modify: `server/src/coord/store.ts`:
  - the L1 import, after the `./stall.js` type import (≈14);
  - module level, before `/** The four persisted integers every run-shaped read carries, proven. */` (≈866): `StallSettingsWrite`, `StallObservationsRead`, `sameStallSettingsRead`;
  - `CoordStore`, a new section before `// ── work items` (≈4076): `stallSettings`, `setStallSettings`, `stallObservationsSince`.
- Modify: `server/test/coord-db.test.ts`:
  - the version pins (≈663, ≈670, ≈729);
  - the two whole-diff tests narrowed to their own entries (≈1019, ≈1230);
  - a new describe at EOF (≈1389).
- Modify: `server/test/asks-store.test.ts`: the version pin (≈18, ≈24).
- Create: `server/test/stall-settings-store.test.ts`.
- Test: `server/test/stall-settings-store.test.ts`, `server/test/coord-db.test.ts`, `server/test/asks-store.test.ts`.

**Interfaces:**
- Consumes, from `server/src/coord/stallsettings.ts` (Tasks 1–2):
  - `export interface StallSettingsRow { readonly level: unknown; readonly quietMs: unknown; readonly updatedAt: unknown }`
  - `export type StallSettingsRead = { kind: 'row'; row: StallSettingsRow } | { kind: 'absent' } | { kind: 'unreadable'; detail: string }`
  - `export interface StallSettingsPatch { readonly level?: StallLevelChoice; readonly quiet?: { readonly kind: 'default' } | { readonly kind: 'set'; readonly ms: number } }`
  - `export const STALL_SETTINGS_SEED = { level: 'follow', quietMs: null } as const`
  - `export function stallPatchIsNoOp(row: StallSettingsRow, patch: StallSettingsPatch): boolean`
  - `export interface StallObservationRow { readonly at: number; readonly detail: string | null }`
  - tests only: `parseStallSettings(read)` and `stallSettingsAfter(before, patch, at)`.
- Consumes, from `server/src/coord/db.ts`: `tx<T>(db: DatabaseSync, fn: () => T): T`. From `store.ts` itself: the module-private `persistedInt(text: string, column: string)` (≈859).
- Produces, in `server/src/coord/schema.ts`: `MIGRATIONS[16]`, so `COORD_SCHEMA_VERSION` derives to `17`. The entry holds:
  - the `stall_settings` table and its seed row `(1, 'follow', NULL, 0)`;
  - `run_events_by_at ON run_events(at)`.
- Produces, in `server/src/coord/store.ts`:

```ts
export type StallSettingsWrite =
  | { kind: 'written'; before: StallSettingsRead; after: StallSettingsRead }
  | { kind: 'conflict'; before: StallSettingsRead };
export type StallObservationsRead = { ok: true; rows: StallObservationRow[] } | { ok: false; detail: string };
// CoordStore:
stallSettings(): StallSettingsRead                       // never throws
setStallSettings(patch: StallSettingsPatch, at: number, expected: StallSettingsRead): StallSettingsWrite
  // one tx(); throws Error(`stall settings unreadable inside the write: ${detail}`) when its own read is unreadable
stallObservationsSince(since: number): StallObservationsRead   // never throws; rows unordered
```

**Settled here:**
- **The slot.** It was measured at origin/main 6f6923cd8: 16 banners, so this entry is `16 -> 17`.
- **`setReadBigInts(true)` on `.get()`.** It was measured on the floor itself, node v22.13.0, and on v24.14.1. Without it, a `quietMs` of `9223372036854775807` throws `ERR_OUT_OF_RANGE`. With it, that field reads `9223372036854775807n` and a TEXT `updatedAt` reads `'abc'`.
- **The plan of `stallObservationsSince`' statement** is `SEARCH run_events USING INDEX run_events_by_at (at>?)` on both versions.
- **`stallObservationsSince` CASTs `at` and proves it with `persistedInt`** (the D-2545 idiom: all or failure, the detail names the column and no value).
  - The spec writes the SELECT as plain `at, detail`. A TEXT `at` sorts above every number, so it would enter every window as a non-number.
  - `detail` is CAST too, so a non-text value arrives as its text, and no stall detail matches it.
  - The plan is unchanged by the projection.
- **The order inside `setStallSettings`.** The throw on its own `unreadable` read comes before the expected-state compare, so a `conflict` never carries an unreadable `before`.

- [ ] **Step 1: Re-anchor, and re-measure the slot**

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin main
git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'
grep -cxF "      AND NOT EXISTS (SELECT 1 FROM run_events e WHERE e.runId = runs.id AND e.detail LIKE 'spawn-adopted:%');" server/src/coord/schema.ts
grep -cxF "import type { StallDeliveryRow, StallMailRow, StallReadFailure, StallRunRow, StallWriteMiss } from './stall.js';" server/src/coord/store.ts
grep -cxF "/** The four persisted integers every run-shaped read carries, proven. */" server/src/coord/store.ts
grep -cxF "  // ── work items ─────────────────────────────────────────────────────────────" server/src/coord/store.ts
grep -cxF "  it('COORD_SCHEMA_VERSION derives to 16 — never hand-edited beside a growing array', () => {" server/test/coord-db.test.ts
grep -cxF "    // indexes, worker stall watch wave 5) and MIGRATIONS[15]" server/test/coord-db.test.ts
grep -cxF "    // 16 since MIGRATIONS[14] (the stall read's indexes) and MIGRATIONS[15]" server/test/coord-db.test.ts
grep -cxF "    const added = tableNames(db).filter((t) => !had.includes(t)).sort();" server/test/coord-db.test.ts
grep -cxF "    expect(indexNames(db).filter((n) => !had.includes(n)).sort()).toEqual(INDEXES);" server/test/coord-db.test.ts
grep -cxF "    // SIX migrations have landed since this test's own version: MIGRATIONS[10]" server/test/asks-store.test.ts
grep -cxF "    // read's indexes, worker stall watch wave 5) and MIGRATIONS[15]" server/test/asks-store.test.ts
```

Expected (measured at 77f8d63a5 and at origin/main 6f6923cd8):
- the slot count is `16`, so this entry is `17: user_version 16 -> 17`;
- every `grep -cxF` answers `1`. Each is the first (or only) line of a 'before' text below, so each before text occurs exactly once in its file.

If the slot count is not 16, another branch took 17 first:
- renumber this entry's banner and its `MIGRATIONS[0..15] are frozen` / `SLOT 17` sentences;
- move the version pins below to the measured total.

The new-entry tests find their slot by DDL and need no edit. If an anchor answers `0`, `main` moved: find the text by content and say so.

- [ ] **Step 2: Write the failing tests**

(a) Create `server/test/stall-settings-store.test.ts`:

```ts
// Stall watch settings W1 (design 2026-10-05 §8, §11, §17): the settings row's migration and seed, its read and its
// write, and the notice-count read's window and plan. Fixture coord.db only (mkTmp), never a live one.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { parseStallSettings, stallSettingsAfter } from '../src/coord/stallsettings.js';
import type { StallSettingsPatch, StallSettingsRead } from '../src/coord/stallsettings.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const MIN = 60_000;
const H = 60 * MIN;
const AT = Date.parse('2026-10-05T18:00:00Z');

/** A store on a fresh fixture database, and the database's path, for a second connection. */
const opened = (): { s: CoordStore; file: string } => {
  const file = path.join(mkTmp('ccrc-stall-settings-store-'), 'coord.db');
  return { s: new CoordStore(openCoordDb(file)), file };
};
const store = (): CoordStore => opened().s;
/** The row exactly as SQLite holds it, read without the store, every INTEGER as a bigint. */
const rawRow = (s: CoordStore): unknown => {
  const st = s.db.prepare('SELECT id, level, quietMs, updatedAt FROM stall_settings');
  st.setReadBigInts(true);
  return st.all();
};
const rowRead = (level: unknown, quietMs: unknown, updatedAt: unknown): StallSettingsRead =>
  ({ kind: 'row', row: { level, quietMs, updatedAt } });

describe('the migration: one seeded row that is today\'s behaviour (M12)', () => {
  it('a fresh database holds exactly one row: follow, NULL, 0', () => {
    expect(rawRow(store())).toEqual([{ id: 1n, level: 'follow', quietMs: null, updatedAt: 0n }]);
  });

  it('the table has the four columns §8 names, with their nullability and key', () => {
    const s = store();
    const cols = (s.db.prepare('PRAGMA table_info(stall_settings)').all() as
      { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[])
      .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]);
    expect(cols).toEqual([
      ['id', 'INTEGER', 0, null, 1], ['level', 'TEXT', 1, null, 0],
      ['quietMs', 'INTEGER', 0, null, 0], ['updatedAt', 'INTEGER', 1, null, 0],
    ]);
  });

  it('is a singleton: a second row is refused by the CHECK', () => {
    const s = store();
    expect(() => s.db.exec("INSERT INTO stall_settings (id, level, quietMs, updatedAt) VALUES (2, 'follow', NULL, 0)"))
      .toThrow(/CHECK constraint failed/);
  });

  it('run_events_by_at indexes run_events on at alone', () => {
    const s = store();
    expect((s.db.prepare('PRAGMA index_info(run_events_by_at)').all() as { name: string }[]).map((r) => r.name))
      .toEqual(['at']);
  });
});

describe('stallSettings: three words, every value as read (M11c)', () => {
  it('reads the seed as a row, every INTEGER a bigint, and parses it as follow with the built-in quiet time', () => {
    const s = store();
    const read = s.stallSettings();
    expect(read).toEqual(rowRead('follow', null, 0n));
    expect(parseStallSettings(read)).toEqual({
      stored: 'row', level: { kind: 'follow' }, quiet: { kind: 'default' }, updatedAt: 0,
    });
  });

  it('reads a lost row as absent', () => {
    const s = store();
    s.db.exec('DELETE FROM stall_settings');
    expect(s.stallSettings()).toEqual({ kind: 'absent' });
  });

  it('reads a missing table as unreadable, with the driver\'s detail, and never throws', () => {
    const s = store();
    s.db.exec('DROP TABLE stall_settings');
    const read = s.stallSettings();
    expect(read.kind).toBe('unreadable');
    expect(read.kind === 'unreadable' ? read.detail : '').toMatch(/no such table: stall_settings/);
  });

  it('an oversize quietMs reads that field unreadable alone: the level is still read', () => {
    const s = store();
    s.db.exec("UPDATE stall_settings SET level = 'check', quietMs = 9223372036854775807, updatedAt = 7");
    const read = s.stallSettings();
    expect(read).toEqual(rowRead('check', 9223372036854775807n, 7n));
    expect(parseStallSettings(read)).toEqual({
      stored: 'row', level: { kind: 'chosen', level: 'check' },
      quiet: { kind: 'unreadable', value: 9223372036854775807n }, updatedAt: 7,
    });
  });

  it('a TEXT updatedAt reads as the string it is, and parses null with both fields still read', () => {
    const s = store();
    s.db.exec("UPDATE stall_settings SET level = 'alert', quietMs = 3600000, updatedAt = 'abc'");
    const read = s.stallSettings();
    expect(read).toEqual(rowRead('alert', 3_600_000n, 'abc'));
    expect(parseStallSettings(read)).toEqual({
      stored: 'row', level: { kind: 'chosen', level: 'alert' }, quiet: { kind: 'set', ms: H }, updatedAt: null,
    });
  });
});

describe('setStallSettings: the update arm, the insert arm and the no-op (§8; M12, M12b, M12c)', () => {
  it('the update arm sets the named field and updatedAt, and keeps the other', () => {
    const s = store();
    const before = s.stallSettings();
    const w = s.setStallSettings({ level: 'check' }, AT, before);
    expect(w).toEqual({ kind: 'written', before: rowRead('follow', null, 0n), after: rowRead('check', null, BigInt(AT)) });
    expect(rawRow(s)).toEqual([{ id: 1n, level: 'check', quietMs: null, updatedAt: BigInt(AT) }]);
  });

  it('M12: the insert arm takes the seed\'s level and quiet time, overridden only by the named field', () => {
    const quietOnly = store();
    quietOnly.db.exec('DELETE FROM stall_settings');
    const w = quietOnly.setStallSettings({ quiet: { kind: 'set', ms: 3 * H } }, AT, quietOnly.stallSettings());
    expect(w).toEqual({ kind: 'written', before: { kind: 'absent' }, after: rowRead('follow', 10_800_000n, BigInt(AT)) });

    const levelOnly = store();
    levelOnly.db.exec('DELETE FROM stall_settings');
    levelOnly.setStallSettings({ level: 'deliver' }, AT, levelOnly.stallSettings());
    expect(rawRow(levelOnly)).toEqual([{ id: 1n, level: 'deliver', quietMs: null, updatedAt: BigInt(AT) }]);
  });

  it('M12c: a quiet-only write keeps an unreadable stored level as it is', () => {
    const s = store();
    s.db.exec("UPDATE stall_settings SET level = 'banana', updatedAt = 5");
    const w = s.setStallSettings({ quiet: { kind: 'set', ms: H } }, AT, s.stallSettings());
    expect(w.kind === 'written' ? w.after : null).toEqual(rowRead('banana', 3_600_000n, BigInt(AT)));
    expect(parseStallSettings(s.stallSettings()).level).toEqual({ kind: 'unreadable', token: 'banana' });
  });

  it.each<[string, StallSettingsPatch]>([
    ['a level and a quiet time', { level: 'alert', quiet: { kind: 'set', ms: H } }],
    ['a quiet time alone, stored as a bigint', { quiet: { kind: 'set', ms: 90 * MIN } }],
    ['the built-in quiet time, stored as NULL', { quiet: { kind: 'default' } }],
    ['a level alone', { level: 'log' }],
  ])('M12b: the same patch twice (%s) moves nothing the second time', (_name, patch) => {
    const s = store();
    s.setStallSettings(patch, AT, s.stallSettings());
    const stored = rawRow(s);
    const again = s.setStallSettings(patch, AT + H, s.stallSettings());
    expect(again.kind).toBe('written');
    if (again.kind !== 'written') return;
    expect(again.after).toEqual(again.before);
    expect(rawRow(s)).toEqual(stored);
  });
});

describe('setStallSettings writes only over the row the route measured (§8; the store half of M27b)', () => {
  it('a level a second connection changed, updatedAt kept, answers conflict with the row it found and writes nothing', () => {
    const { s, file } = opened();
    const expected = s.stallSettings();
    const other = new DatabaseSync(file);
    other.exec("UPDATE stall_settings SET level = 'check'");
    other.close();
    const w = s.setStallSettings({ quiet: { kind: 'set', ms: 2 * H } }, AT, expected);
    expect(w).toEqual({ kind: 'conflict', before: rowRead('check', null, 0n) });
    expect(rawRow(s)).toEqual([{ id: 1n, level: 'check', quietMs: null, updatedAt: 0n }]);
  });

  it('a row lost since the route read answers conflict with absent, and inserts nothing', () => {
    const s = store();
    const expected = s.stallSettings();
    s.db.exec('DELETE FROM stall_settings');
    expect(s.setStallSettings({ level: 'all' }, AT, expected)).toEqual({ kind: 'conflict', before: { kind: 'absent' } });
    expect(rawRow(s)).toEqual([]);
  });

  it('a read that failed once and then succeeded answers conflict, and writes nothing', () => {
    const s = store();
    const failed: StallSettingsRead = { kind: 'unreadable', detail: 'database is locked' };
    expect(s.setStallSettings({ level: 'all' }, AT, failed)).toEqual({ kind: 'conflict', before: rowRead('follow', null, 0n) });
    expect(rawRow(s)).toEqual([{ id: 1n, level: 'follow', quietMs: null, updatedAt: 0n }]);
  });
});

describe('M12d: the projection is the store\'s write', () => {
  const befores: [string, (s: CoordStore) => void][] = [
    ['an absent row', (s) => s.db.exec('DELETE FROM stall_settings')],
    ['the seed row', () => {}],
    ['a row with an unreadable level', (s) => s.db.exec("UPDATE stall_settings SET level = 'banana', quietMs = 1800000, updatedAt = 5")],
    ['a row with an unreadable quiet time', (s) => s.db.exec("UPDATE stall_settings SET level = 'all', quietMs = 7, updatedAt = 5")],
  ];
  const patches: [string, StallSettingsPatch][] = [
    ['a level', { level: 'deliver' }],
    ['a quiet time', { quiet: { kind: 'set', ms: 2 * H } }],
    ['the built-in quiet time', { quiet: { kind: 'default' } }],
    ['both', { level: 'follow', quiet: { kind: 'set', ms: 30 * MIN } }],
  ];
  const cases = befores.flatMap(([b, plant]) => patches.map(([p, patch]) => [b, p, plant, patch] as const));

  it.each(cases)('%s, written with %s: the written after parses equal to the parsed projection', (_b, _p, plant, patch) => {
    const s = store();
    plant(s);
    const before = s.stallSettings();
    const w = s.setStallSettings(patch, AT, before);
    expect(w.kind).toBe('written');
    if (w.kind !== 'written') return;
    expect(w.before).toEqual(before);
    expect(parseStallSettings(w.after)).toEqual(parseStallSettings(stallSettingsAfter(before, patch, AT)));
    expect(w.after).toEqual(s.stallSettings());
  });

  it('a read inside the write that is itself unreadable takes neither arm: the write throws and the row is unchanged', () => {
    const s = store();
    s.db.exec("UPDATE stall_settings SET level = 'alert', updatedAt = 5");
    const unreadable: StallSettingsRead = { kind: 'unreadable', detail: 'disk I/O error' };
    const spy = vi.spyOn(s, 'stallSettings').mockReturnValue(unreadable);
    try {
      expect(() => s.setStallSettings({ level: 'all' }, AT, unreadable)).toThrow(/stall settings unreadable inside the write: disk I\/O error/);
    } finally {
      spy.mockRestore();
    }
    expect(rawRow(s)).toEqual([{ id: 1n, level: 'alert', quietMs: null, updatedAt: 5n }]);
    // The transaction rolled back: the next write opens its own.
    expect(s.setStallSettings({ level: 'all' }, AT, s.stallSettings()).kind).toBe('written');
  });
});

describe('stallObservationsSince: the window, the plan and the failure (§11; M17c, M17d)', () => {
  const SINCE = AT - 48 * H;
  const withRun = (s: CoordStore): void => {
    s.db.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('p', 'P', 1, 'active')");
    s.db.exec("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) VALUES ('p', 1, 1, 'demo', 'working', 'c', 1)");
  };
  const event = (s: CoordStore, at: number | string, detail: string | null): void => {
    s.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (1, ?, 'working', 'working', 'operator', ?)")
      .run(at, detail);
  };
  const byAt = (r: ReturnType<CoordStore['stallObservationsSince']>): unknown =>
    r.ok ? [...r.rows].sort((a, b) => a.at - b.at) : r;

  it('M17c: a row at since comes back and a row at since - 1 does not', () => {
    const s = store();
    withRun(s);
    event(s, SINCE - 1, 'stall:quiet:1:a');
    event(s, SINCE, 'stall:quiet:1:b');
    event(s, SINCE + 5, null);
    expect(byAt(s.stallObservationsSince(SINCE))).toEqual([
      { at: SINCE, detail: 'stall:quiet:1:b' }, { at: SINCE + 5, detail: null },
    ]);
  });

  it('M17d: the read plans a SEARCH on run_events_by_at', () => {
    const s = store();
    const spy = vi.spyOn(s.db, 'prepare');
    let sql: string[];
    try { s.stallObservationsSince(SINCE); sql = spy.mock.calls.map((c) => String(c[0])); } finally { spy.mockRestore(); }
    expect(sql).toHaveLength(1);
    const plan = (s.db.prepare(`EXPLAIN QUERY PLAN ${sql[0]}`).all() as { detail: string }[]).map((r) => r.detail);
    expect(plan).toEqual(['SEARCH run_events USING INDEX run_events_by_at (at>?)']);
  });

  it('a thrown statement answers ok: false with its detail, never a throw', () => {
    const s = store();
    s.db.exec('DROP TABLE run_events');
    const r = s.stallObservationsSince(SINCE);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.detail).toMatch(/no such table: run_events/);
  });

  it('an at that is not a positive safe integer refuses the whole read, naming the column and no value', () => {
    const s = store();
    withRun(s);
    event(s, SINCE, 'stall:quiet:1:b');
    event(s, 'abc', 'stall:quiet:1:c');
    expect(s.stallObservationsSince(SINCE)).toEqual({ ok: false, detail: 'run_events at is not a positive safe integer' });
  });
});
```

(b) `server/test/coord-db.test.ts`, the version pin at ≈663 (its first line measured once in Step 1). Before:

```ts
  it('COORD_SCHEMA_VERSION derives to 16 — never hand-edited beside a growing array', () => {
    // Bumped to 16 by six migrations: MIGRATIONS[10] (runs.kind/runs.reviews,
```

After:

```ts
  it('COORD_SCHEMA_VERSION derives to 17 — never hand-edited beside a growing array', () => {
    // Bumped to 17 by seven migrations: MIGRATIONS[10] (runs.kind/runs.reviews,
```

(c) The same test's tail, ≈670 (first line measured once). Before:

```ts
    // indexes, worker stall watch wave 5) and MIGRATIONS[15]
    // (runs.sessionBornAt / runs.sessionBornFor — child-reclamation spec §5.1,
    // §5.3).
    expect(COORD_SCHEMA_VERSION).toBe(16);
    expect(MIGRATIONS.length).toBe(16);
```

After:

```ts
    // indexes, worker stall watch wave 5), MIGRATIONS[15]
    // (runs.sessionBornAt / runs.sessionBornFor — child-reclamation spec §5.1,
    // §5.3) and MIGRATIONS[16] (stall_settings and run_events_by_at — stall
    // watch settings design 2026-10-05 §8).
    expect(COORD_SCHEMA_VERSION).toBe(17);
    expect(MIGRATIONS.length).toBe(17);
```

(d) ≈729 (first line measured once). Before:

```ts
    // 16 since MIGRATIONS[14] (the stall read's indexes) and MIGRATIONS[15]
    // (runs.sessionBornAt/sessionBornFor, child-reclamation spec §5.1, §5.3);
    // the migration above is still entry 11.
    expect(COORD_SCHEMA_VERSION).toBe(16);
```

After:

```ts
    // 17 since MIGRATIONS[14] (the stall read's indexes), MIGRATIONS[15]
    // (runs.sessionBornAt/sessionBornFor, child-reclamation spec §5.1, §5.3)
    // and MIGRATIONS[16] (stall_settings and run_events_by_at, stall watch
    // settings §8); the migration above is still entry 11.
    expect(COORD_SCHEMA_VERSION).toBe(17);
```

(e) Migration 14's table diff, ≈1019. The first line is measured once; the before is two lines. Before:

```ts
    const added = tableNames(db).filter((t) => !had.includes(t)).sort();
    expect(added).toEqual(UPDATE_TABLES);
```

After:

```ts
    // Narrowed to this entry's own tables, as the fresh-database case below already is: a later entry's table
    // (stall_settings, MIGRATIONS[16]) joins the whole diff from 13, and must not have to edit this case.
    const added = tableNames(db).filter((t) => !had.includes(t) && UPDATE_TABLES.includes(t)).sort();
    expect(added).toEqual(UPDATE_TABLES);
```

(f) The stall mail indexes' diff, ≈1230 (one line, measured once). Before:

```ts
    expect(indexNames(db).filter((n) => !had.includes(n)).sort()).toEqual(INDEXES);
```

After:

```ts
    // Narrowed to this entry's own indexes: a later entry's index (run_events_by_at, MIGRATIONS[16]) joins the
    // whole diff from SLOT - 1, and must not have to edit this case.
    expect(indexNames(db).filter((n) => !had.includes(n) && INDEXES.includes(n)).sort()).toEqual(INDEXES);
```

(g) Append at the end of `server/test/coord-db.test.ts`. It begins with one blank line, after the file's final `});`.

The entry's exact diff is measured by applying `MIGRATIONS[SLOT - 1]` raw. A later entry then never edits this case, which an exact diff through `openCoordDb` to the current version could not promise. `openCoordDb`'s own path is checked with `arrayContaining`.

```ts

describe('coord.db: stall_settings and run_events_by_at (stall watch settings W1, design 2026-10-05 §8)', () => {
  /** This entry's slot, found by its DDL and never hard-coded (the stall mail indexes' rule above): whichever of two
   *  branches holding one slot merges second moves up, and that renumber must not have to edit a line here. */
  const SLOT = MIGRATIONS.findIndex((m) => m.includes('stall_settings')) + 1;
  const NAMES = ['run_events_by_at', 'stall_settings'];
  const objectNames = (db: DatabaseSync): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'").all() as
      { name: string }[]).map((r) => r.name);
  /** A database at exactly the version before this entry, carrying one run and one run event. */
  const plantedBefore = (prefix: string): string => {
    const p = dbPathIn(mkTmp(prefix));
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
      raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('p', 'P', 1, 'active')");
      raw.exec("INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) " +
               "VALUES ('p', 1, 1, 'demo', 'working', 'c', 1)");
      raw.exec("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) " +
               "VALUES (1, 5, 'working', 'working', 'operator', 'x')");
    });
    raw.close();
    return p;
  };

  it('is its own entry, after every entry main carried when it was written', () => {
    expect(SLOT, 'no MIGRATIONS entry creates stall_settings').toBeGreaterThanOrEqual(17);
    expect(MIGRATIONS.slice(0, SLOT - 1).some((m) => NAMES.some((n) => m.includes(n))),
      'a name of this entry was amended into a frozen one').toBe(false);
  });

  it('the entry alone adds exactly stall_settings and run_events_by_at, and seeds one follow/NULL row', () => {
    // The entry's own diff, applied raw, so a later entry never edits this case.
    const p = plantedBefore('ccrc-mig-stallsettings-');
    const raw = new DatabaseSync(p);
    const had = objectNames(raw);
    raw.exec(MIGRATIONS[SLOT - 1]!);
    expect(objectNames(raw).filter((n) => !had.includes(n)).sort()).toEqual(NAMES);
    expect(raw.prepare('SELECT id, level, quietMs, updatedAt FROM stall_settings').all())
      .toEqual([{ id: 1, level: 'follow', quietMs: null, updatedAt: 0 }]);
    raw.close();
  });

  it('openCoordDb reaches a database ALREADY at the version before it, seeds the row and keeps its rows', () => {
    const db = openCoordDb(plantedBefore('ccrc-mig-stallsettings-open-'));
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: COORD_SCHEMA_VERSION });
    expect(objectNames(db)).toEqual(expect.arrayContaining(NAMES));
    expect(db.prepare('SELECT id, level, quietMs, updatedAt FROM stall_settings').all())
      .toEqual([{ id: 1, level: 'follow', quietMs: null, updatedAt: 0 }]);
    expect(db.prepare('SELECT runId, at, detail FROM run_events').all()).toEqual([{ runId: 1, at: 5, detail: 'x' }]);
    db.close();
  });
});
```

(h) `server/test/asks-store.test.ts`, ≈18 (one line, measured once). Before:

```ts
    // SIX migrations have landed since this test's own version: MIGRATIONS[10]
```

After:

```ts
    // SEVEN migrations have landed since this test's own version: MIGRATIONS[10]
```

(i) The same test, ≈24 (first line measured once). Before:

```ts
    // read's indexes, worker stall watch wave 5) and MIGRATIONS[15]
    // (`runs.sessionBornAt`/`sessionBornFor`, child-reclamation spec §5.1,
    // §5.3). None touches the asks table. This pin only needs the CURRENT
    // total — it asserts "no migration after the one this test knows about
    // has changed the asks table's columns", not anything about any of the six.
    expect(COORD_SCHEMA_VERSION).toBe(16);
```

After:

```ts
    // read's indexes, worker stall watch wave 5), MIGRATIONS[15]
    // (`runs.sessionBornAt`/`sessionBornFor`, child-reclamation spec §5.1,
    // §5.3) and MIGRATIONS[16] (`stall_settings` and `run_events_by_at`, stall
    // watch settings §8). None touches the asks table. This pin only needs the
    // CURRENT total — it asserts "no migration after the one this test knows
    // about has changed the asks table's columns", not anything about any of
    // the seven.
    expect(COORD_SCHEMA_VERSION).toBe(17);
```

- [ ] **Step 3: Run the suites to verify they fail**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-settings-store.test.ts test/coord-db.test.ts test/asks-store.test.ts`

Expected (measured on the prototype): `Test Files 3 failed (3)` and `Tests 46 failed | 93 passed (139)`:
- `stall-settings-store.test.ts`: 40 of 40. The errors are `no such table: stall_settings`, `s.stallSettings is not a function`, `s.setStallSettings is not a function` and `s.stallObservationsSince is not a function`. The index row reads `expected [] to deeply equal [ 'at' ]`.
- `coord-db.test.ts`: 5:
  - `COORD_SCHEMA_VERSION derives to 17 …`;
  - `reaches a database ALREADY at user_version 10 …`;
  - the new describe's three rows (`SLOT` is `0`).
- `asks-store.test.ts`: 1, `the cross-repo columns added at schema version 10 are still present at the current version`.

Steps 2(e) and 2(f) do not red here. They red only once the entry lands; row N0 of Step 9 measures that.

- [ ] **Step 4: Add the migration**

In `server/src/coord/schema.ts`, the end of entry 16 (≈1232; its first line measured once in Step 1). Before:

```ts
      AND NOT EXISTS (SELECT 1 FROM run_events e WHERE e.runId = runs.id AND e.detail LIKE 'spawn-adopted:%');
  `,
];
```

After:

```ts
      AND NOT EXISTS (SELECT 1 FROM run_events e WHERE e.runId = runs.id AND e.detail LIKE 'spawn-adopted:%');
  `,
  // ── 17: user_version 16 -> 17 ─────────────────────────────────────────────
  // Stall watch settings (design 2026-10-05 §8): the operator's stall-watch level and quiet time, chosen in Settings.
  // ONE ROW, `CHECK (id = 1)`, the `coordinator_state` idiom. Its writer is `CoordStore.setStallSettings`, called only
  // by the settings POST; its reader is `CoordStore.stallSettings`, whose values `parseStallSettings` (`stallsettings.ts`)
  // decides: `level` through `isStallLevelChoice` and `quietMs` through `isStallQuietMs`, never cast. `quietMs` NULL is
  // the built-in quiet time, and has no other meaning.
  //
  // THE SEED IS TODAY'S BEHAVIOUR: `follow` (the fleet box's files decide) and NULL (the built-in quiet time), so this
  // entry changes nothing on deploy. `STALL_SETTINGS_SEED` (`stallsettings.ts`) carries the same two values for the
  // store's insert arm, which a lost row takes.
  //
  // `run_events_by_at` serves the notice-count read, `CoordStore.stallObservationsSince` (§11): `run_events` had only
  // `run_events_by_run(runId, at)`, whose leading column is `runId`, so a window on `at` alone scanned the table. This
  // server never runs ANALYZE, so the planner's choice for a one-sided range is fixed, and
  // `stall-settings-store.test.ts` pins the plan (departure `run-events-at-index` (D-4028)). `IF NOT EXISTS`, so a
  // database where an operator made it by hand still starts.
  //
  // MIGRATIONS[0..15] are frozen. THIS ENTRY IS SLOT 17 AS WRITTEN, measured against origin/main at the wave's first
  // step; whichever branch holding the same slot merges second moves up. RE-MEASURE immediately before the PR and
  // before merge:
  //     git fetch origin main
  //     git show origin/main:server/src/coord/schema.ts | grep -c '^  // ── [0-9]*: user_version'
  `
  CREATE TABLE stall_settings (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    level     TEXT NOT NULL,
    quietMs   INTEGER,
    updatedAt INTEGER NOT NULL
  );
  INSERT INTO stall_settings (id, level, quietMs, updatedAt) VALUES (1, 'follow', NULL, 0);
  CREATE INDEX IF NOT EXISTS run_events_by_at ON run_events(at);
  `,
];
```

- [ ] **Step 5: Add the store methods**

(a) `server/src/coord/store.ts` ≈14 (one line, measured once). Before:

```ts
import type { StallDeliveryRow, StallMailRow, StallReadFailure, StallRunRow, StallWriteMiss } from './stall.js';
```

After:

```ts
import type { StallDeliveryRow, StallMailRow, StallReadFailure, StallRunRow, StallWriteMiss } from './stall.js';
// Stall watch settings (design 2026-10-05 §8, §11): the settings row's port and the notice-count row are declared by
// their consumer, the L1 `stallsettings.ts`; the insert arm starts from its seed, and the no-op skip asks its compare.
import { STALL_SETTINGS_SEED, stallPatchIsNoOp } from './stallsettings.js';
import type { StallObservationRow, StallSettingsPatch, StallSettingsRead } from './stallsettings.js';
```

(b) ≈866 (one line, measured once). Before:

```ts
/** The four persisted integers every run-shaped read carries, proven. */
```

After:

```ts
/** `setStallSettings`' answer: written, with the read before and the read after (equal on a no-op), or a conflict
 *  carrying the read it found and wrote nothing over. */
export type StallSettingsWrite =
  | { kind: 'written'; before: StallSettingsRead; after: StallSettingsRead }
  | { kind: 'conflict'; before: StallSettingsRead };

/** `stallObservationsSince`' answer: the window's rows, or a read that failed, with its detail. */
export type StallObservationsRead = { ok: true; rows: StallObservationRow[] } | { ok: false; detail: string };

/** Whether two settings reads are the same state, compared as read, before any parse, so a `bigint` meets a `bigint`:
 *  the same kind and, for a row, the same three values, `updatedAt` included. Two unreadable reads are the same
 *  kind; `setStallSettings` throws on its own unreadable read before it asks. */
const sameStallSettingsRead = (a: StallSettingsRead, b: StallSettingsRead): boolean => {
  if (a.kind === 'row' && b.kind === 'row') {
    return a.row.level === b.row.level && a.row.quietMs === b.row.quietMs && a.row.updatedAt === b.row.updatedAt;
  }
  return a.kind === b.kind;
};

/** The four persisted integers every run-shaped read carries, proven. */
```

(c) ≈4076 (one line, measured once). Before:

```ts
  // ── work items ─────────────────────────────────────────────────────────────
```

After:

```ts
  // ── stall watch settings (design 2026-10-05 §8, §11) ───────────────────────

  /** The settings row, every value as read: a row, no row, or a read that failed, three words and never one `null`.
   *  The statement is prepared AND run inside the `try`, so a missing table or a driver throw is `unreadable` with the
   *  driver's detail, never a throw. `setReadBigInts(true)`: without it an oversize INTEGER makes `.get()` throw
   *  `ERR_OUT_OF_RANGE`, so one bad field would cost every field's own state; with it, that field arrives as a `bigint`
   *  and only it parses unreadable (measured on node 22.13.0 and 24.14.1). Nothing is decided here:
   *  `parseStallSettings` (L1) decides what each value means, `updatedAt` included. */
  stallSettings(): StallSettingsRead {
    try {
      const st = this.db.prepare('SELECT level, quietMs, updatedAt FROM stall_settings WHERE id = 1');
      st.setReadBigInts(true);
      const r = st.get() as { level: unknown; quietMs: unknown; updatedAt: unknown } | undefined;
      return r === undefined ? { kind: 'absent' } : { kind: 'row', row: { level: r.level, quietMs: r.quietMs, updatedAt: r.updatedAt } };
    } catch (err) {
      return { kind: 'unreadable', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The settings write, in ONE `tx()`: read, compare, write, read again. It validates nothing; the route has decided
   *  (the `setCaps` division of labour).
   *  - A read that is itself unreadable takes neither arm: the store cannot tell an insert from an update, so it
   *    THROWS inside the `tx()`, which rolls back. The route refuses on its own unreadable read first; this is the
   *    second guard.
   *  - It writes only over the row the route measured: a read that differs from `expected` (another kind, or any of a
   *    row's three values as read, `updatedAt` included, since a hand edit need not move it) writes nothing and answers
   *    `conflict` with the read it found (departure `server-decides-the-confirm` (D-4033)).
   *  - A lost row takes the insert arm: `STALL_SETTINGS_SEED`, overridden only by the named fields.
   *  - A patch that changes nothing in a stored row (`stallPatchIsNoOp`, after the `bigint` conversion) runs no
   *    `UPDATE`, so `updatedAt` stays and `before` is `after` (departure `no-op-write-records-no-feed-event` (D-4031)).
   *  - Otherwise the update arm sets only the named fields and `updatedAt`, so a quiet-only write keeps a stored level
   *    as it is, an unreadable one included.
   *  `stallSettingsAfter` (L1) is the projection of these arms; `stall-settings-store.test.ts` pins that they agree. */
  setStallSettings(patch: StallSettingsPatch, at: number, expected: StallSettingsRead): StallSettingsWrite {
    return tx(this.db, () => {
      const before = this.stallSettings();
      if (before.kind === 'unreadable') throw new Error(`stall settings unreadable inside the write: ${before.detail}`);
      if (!sameStallSettingsRead(before, expected)) return { kind: 'conflict', before };
      const quietMs = (q: NonNullable<StallSettingsPatch['quiet']>): number | null => (q.kind === 'default' ? null : q.ms);
      if (before.kind === 'absent') {
        this.db.prepare('INSERT INTO stall_settings (id, level, quietMs, updatedAt) VALUES (1, ?, ?, ?)').run(
          patch.level ?? STALL_SETTINGS_SEED.level,
          patch.quiet === undefined ? STALL_SETTINGS_SEED.quietMs : quietMs(patch.quiet),
          at,
        );
      } else if (stallPatchIsNoOp(before.row, patch)) {
        return { kind: 'written', before, after: before };
      } else {
        const sets: string[] = [];
        const binds: (string | number | null)[] = [];
        if (patch.level !== undefined) { sets.push('level = ?'); binds.push(patch.level); }
        if (patch.quiet !== undefined) { sets.push('quietMs = ?'); binds.push(quietMs(patch.quiet)); }
        sets.push('updatedAt = ?');
        binds.push(at);
        this.db.prepare(`UPDATE stall_settings SET ${sets.join(', ')} WHERE id = 1`).run(...binds);
      }
      return { kind: 'written', before, after: this.stallSettings() };
    });
  }

  /** The notice-count read (§11): every `run_events` row at or after `since`, unordered (the counts are order-free,
   *  and an `ORDER BY id` would invite a rowid scan on a database that never sees ANALYZE). It plans a SEARCH on
   *  `run_events_by_at`, which `stall-settings-store.test.ts` pins. It spells no detail head: L1's
   *  `stallNoticeCounts` classifies (`mail-stuck-decided-in-l1`'s discipline). `at` is CAST and proven (D-2545's
   *  idiom), ALL-OR-FAILURE, the detail naming the column and no value; `detail` is CAST so a hand-edited non-text
   *  value arrives as its text, which no stall detail matches. A thrown statement is `{ ok: false }`, never a throw. */
  stallObservationsSince(since: number): StallObservationsRead {
    try {
      const rows = this.db.prepare(
        'SELECT CAST(at AS TEXT) AS atText, CAST(detail AS TEXT) AS detail FROM run_events WHERE at >= ?',
      ).all(since) as unknown as { atText: string; detail: string | null }[];
      const out: StallObservationRow[] = [];
      for (const r of rows) {
        const at = persistedInt(r.atText, 'run_events at');
        if (!at.ok) return { ok: false, detail: at.detail };
        out.push({ at: at.value, detail: r.detail });
      }
      return { ok: true, rows: out };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── work items ─────────────────────────────────────────────────────────────
```

The store spells `INSERT INTO stall_settings` once and `UPDATE stall_settings SET` once, and `setStallSettings(` only at its definition. The routes task's single-writer pin (M16b) counts these. No marker name and no quoted kebab word is spelled in any of the three files.

- [ ] **Step 6: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/stall-settings-store.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/coord-db.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/asks-store.test.ts | grep -E '^ +Tests '
```

Expected (measured): `Tests 40 passed (40)`, `Tests 71 passed (71)`, `Tests 28 passed (28)`.

- [ ] **Step 7: The regression suites and tsc**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-store stall-settings single-definition mail-routes mail-hardening update-writer-groups coord-store \
         claims claims-advisory child-reclaim-generation crossrepo-prose kickoff-route peers-claims-l0 \
         coordinator-skill worker-skill fleet ledger-sweep stall-vocabulary stall-sweep mail-sweep run-signals \
         node-floor typecheck-tests session-hook deviation-refs; do
  echo "$f: $(./node_modules/.bin/vitest run test/$f.test.ts 2>&1 | grep -E '^ +Tests ')"
done
./node_modules/.bin/tsc --noEmit -p . ; echo "rc=$?"
./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json ; echo "rc=$?"
```

Expected (measured on the prototype):

| suite | tests |
|---|---|
| stall-store | 68 passed (68) |
| stall-settings | 112 passed (112) |
| single-definition | 274 passed (274) |
| mail-routes | 59 passed (59) |
| mail-hardening | 18 passed (18) |
| update-writer-groups | 20 passed (20) |
| coord-store | 186 passed (186) |
| claims | 22 passed (22) |
| claims-advisory | 2 passed (2) |
| child-reclaim-generation | 23 passed (23) |
| crossrepo-prose | 17 passed (17) |
| kickoff-route | 50 passed (50) |
| peers-claims-l0 | 19 passed (19) |
| coordinator-skill | 160 passed (160) |
| worker-skill | 51 passed (51) |
| fleet | 94 passed (94) |
| ledger-sweep | 20 passed (20) |
| stall-vocabulary | 179 passed (179) |
| stall-sweep | 109 passed (109) |
| mail-sweep | 104 passed (104) |
| run-signals | 19 passed (19) |
| node-floor | 3 passed (3) |
| typecheck-tests | 12 passed (12) |
| session-hook | 335 passed (335) |
| deviation-refs | 1 failed, 30 passed (31). The failure was there before this task and is not from it (see below). |

- **stall-sweep** is green with the migrated database: the seed is today's behaviour.
- **session-hook** is green, so no README anchor into `store.ts` or `schema.ts` moved.
- **deviation-refs** reds on `floorFromScan … seeds from the ledger high-water`. Its evidence is `server/src/coord/stallsettings.ts names D-4034`, which was already true at Task 2's commit. It clears when this wave's plan, which defines the numbers it cites, is on the tree. This task cites D-4028, D-4031 and D-4033 only.
- **tsc:** `rc=0` twice.

A known load flake (`session-hook`, `typecheck-tests`) that reds is re-run alone with `--testTimeout=240000` before it is called real.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/coord/schema.ts server/src/coord/store.ts server/test/stall-settings-store.test.ts \
        server/test/coord-db.test.ts server/test/asks-store.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): stall watch settings storage — the migration, run_events_by_at, and the store methods

MIGRATIONS[16] (user_version 16 -> 17): stall_settings, its follow/NULL
seed row (today's behaviour), and run_events_by_at for the notice-count
read (run-events-at-index (D-4028)). CoordStore.stallSettings reads the
row with setReadBigInts inside its own try, three words never one null.
setStallSettings writes in one tx: a throw on its own unreadable read,
a conflict when the row differs from the one the route measured
(server-decides-the-confirm (D-4033)), the insert arm from
STALL_SETTINGS_SEED, the no-op skip (no-op-write-records-no-feed-event
(D-4031)), and an update arm that sets only the named fields.
stallObservationsSince reads the window on run_events_by_at.

coord-db and asks-store version pins move to 17; the two whole-diff
tests are narrowed to their own entries; the new entry's diff test finds
its slot by DDL.
MSG
)"
```

- [ ] **Step 9: The mutation table, on the committed tree**

Apply each row's edits to the committed tree, run its tests, then restore with `git checkout -- <file>`. Each `old` occurs exactly once in its file. The runner may be any old/new replacer that refuses a count other than one. The JSON is the input:

```json
[
 {"id": "M17d", "edits": [{"file": "server/src/coord/schema.ts", "old": "  CREATE INDEX IF NOT EXISTS run_events_by_at ON run_events(at);\n", "new": ""}], "tests": ["test/stall-settings-store.test.ts", "test/coord-db.test.ts"]},
 {"id": "M17c", "edits": [{"file": "server/src/coord/store.ts", "old": "WHERE at >= ?'", "new": "WHERE at > ?'"}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "M11c-a", "edits": [{"file": "server/src/coord/store.ts", "old": "      st.setReadBigInts(true);\n", "new": ""}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "M11c-b", "edits": [{"file": "server/src/coord/stallsettings.ts", "old": "updatedAt: typeof at === 'number' && Number.isSafeInteger(at) ? at : null };", "new": "updatedAt: at as number };"}], "tests": ["test/stall-settings-store.test.ts", "test/stall-settings.test.ts"]},
 {"id": "M12-a", "edits": [{"file": "server/src/coord/schema.ts", "old": "VALUES (1, 'follow', NULL, 0);", "new": "VALUES (1, 'check', NULL, 0);"}], "tests": ["test/stall-settings-store.test.ts", "test/coord-db.test.ts"]},
 {"id": "M12-a2", "edits": [{"file": "server/src/coord/schema.ts", "old": "VALUES (1, 'follow', NULL, 0);", "new": "VALUES (1, 'follow', 7200000, 0);"}], "tests": ["test/stall-settings-store.test.ts", "test/coord-db.test.ts"]},
 {"id": "M12-b", "edits": [{"file": "server/src/coord/store.ts", "old": "patch.level ?? STALL_SETTINGS_SEED.level,", "new": "patch.level ?? 'check',"}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "M12-b2", "edits": [{"file": "server/src/coord/store.ts", "old": "patch.quiet === undefined ? STALL_SETTINGS_SEED.quietMs : quietMs(patch.quiet),", "new": "patch.quiet === undefined ? 7_200_000 : quietMs(patch.quiet),"}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "M12b-a", "edits": [{"file": "server/src/coord/store.ts", "old": "      } else if (stallPatchIsNoOp(before.row, patch)) {\n        return { kind: 'written', before, after: before };\n      } else {", "new": "      } else {"}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "M12b-b", "edits": [{"file": "server/src/coord/stallsettings.ts", "old": "fromStore(row.quietMs) === patch.quiet.ms", "new": "row.quietMs === patch.quiet.ms"}], "tests": ["test/stall-settings-store.test.ts", "test/stall-settings.test.ts"]},
 {"id": "M12c", "edits": [{"file": "server/src/coord/store.ts", "old": "if (patch.level !== undefined) { sets.push('level = ?'); binds.push(patch.level); }", "new": "sets.push('level = ?'); binds.push(patch.level ?? STALL_SETTINGS_SEED.level);"}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "M12d-a", "edits": [{"file": "server/src/coord/stallsettings.ts", "old": "{ ...STALL_SETTINGS_SEED, updatedAt: at }", "new": "{ level: 'check', quietMs: null, updatedAt: at }"}], "tests": ["test/stall-settings-store.test.ts", "test/stall-settings.test.ts"]},
 {"id": "M12d-b", "edits": [{"file": "server/src/coord/stallsettings.ts", "old": "level: patch.level ?? base.level,", "new": "level: patch.level ?? 'follow',"}], "tests": ["test/stall-settings-store.test.ts", "test/stall-settings.test.ts"]},
 {"id": "M12d-c", "edits": [{"file": "server/src/coord/store.ts", "old": "      if (before.kind === 'unreadable') throw new Error(`stall settings unreadable inside the write: ${before.detail}`);\n", "new": ""}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "M27b-a", "edits": [{"file": "server/src/coord/store.ts", "old": "      if (!sameStallSettingsRead(before, expected)) return { kind: 'conflict', before };\n", "new": ""}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "M27b-b", "edits": [{"file": "server/src/coord/store.ts", "old": "return a.row.level === b.row.level && a.row.quietMs === b.row.quietMs && a.row.updatedAt === b.row.updatedAt;", "new": "return a.row.updatedAt === b.row.updatedAt;"}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "R1", "edits": [{"file": "server/src/coord/store.ts", "old": "    try {\n      const st = this.db.prepare('SELECT level, quietMs, updatedAt FROM stall_settings WHERE id = 1');", "new": "    const st = this.db.prepare('SELECT level, quietMs, updatedAt FROM stall_settings WHERE id = 1');\n    try {"}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "R2", "edits": [{"file": "server/src/coord/store.ts", "old": "        const at = persistedInt(r.atText, 'run_events at');\n        if (!at.ok) return { ok: false, detail: at.detail };\n        out.push({ at: at.value, detail: r.detail });", "new": "        out.push({ at: Number(r.atText), detail: r.detail });"}], "tests": ["test/stall-settings-store.test.ts"]},
 {"id": "R3", "edits": [{"file": "server/src/coord/store.ts", "old": "      return { ok: false, detail: err instanceof Error ? err.message : String(err) };\n    }\n  }\n\n  // ── work items", "new": "      throw err;\n    }\n  }\n\n  // ── work items"}], "tests": ["test/stall-settings-store.test.ts"]}
]
```

N0 is a measurement, not a guard. Revert Step 2(e) and 2(f)'s `&& UPDATE_TABLES.includes(t)` / `&& INDEXES.includes(n)` and run `test/coord-db.test.ts`. That shows why the narrowing is needed now the entry exists.

The control is Step 6's green: 40, 71 and 28 passed. Store-suite counts are out of 40; `coord-db` out of 71; `stall-settings` out of 112.

| # | Guard | Mutation | Red in (measured) |
|---|---|---|---|
| N0 | the two whole-diff tests are narrowed | un-narrow both | coord-db `2 failed`: `reaches a database ALREADY at user_version 13 and adds exactly the five tables`; `… keeps its rows, and adds exactly its three indexes` |
| M17d | the index serves the count read | drop `run_events_by_at` from the entry | store `2 failed`: `M17d: the read plans a SEARCH on run_events_by_at`, `run_events_by_at indexes run_events on at alone`; coord-db `2 failed`: the new entry's raw diff and `openCoordDb reaches …` |
| M17c | the window boundary | `>=` → `>` | store `1 failed`: `M17c: a row at since comes back and a row at since - 1 does not` |
| M11c (bigint half) | oversize values read per field | drop `setReadBigInts(true)` | store `8 failed`: the seed, oversize and TEXT-`updatedAt` reads, the update arm, M12, M12c, and two conflict rows |
| M11c (parse half) | `updatedAt` is never passed through | type `updatedAt` as a number in `parseStallSettings` | store `1 failed`: `a TEXT updatedAt reads as the string it is …`; stall-settings `1 failed`: `M11c (parse half) …` |
| M12 (seed level) | the seed is today's behaviour | seed `'check'` | store `5 failed` (the fresh row, the seed read, the update arm, two conflict rows); coord-db `2 failed` |
| M12 (seed quiet) | the same | seed `7200000` | store `6 failed`; coord-db `2 failed` |
| M12 (insert level) | the insert arm is the seed | insert `'check'` for an unnamed level | store `3 failed`: M12, and M12d's absent row with a quiet time and with the built-in |
| M12 (insert quiet) | the same | insert 2 h for an unnamed quiet time | store `2 failed`: M12, and M12d's absent row with a level |
| M12b (always UPDATE) | a no-op write moves nothing | drop the no-op arm | store `5 failed`: the four M12b rows, and M12d's seed row with the built-in quiet time |
| M12b (as read) | the no-op compares after the `bigint` conversion | `row.quietMs === patch.quiet.ms` in `stallPatchIsNoOp` | store `2 failed`: M12b `a level and a quiet time`, `a quiet time alone, stored as a bigint`; stall-settings `2 failed` |
| M12c | the update arm keeps a level it was not asked to write | always `SET level`, the seed when unnamed | store `5 failed`: M12c, and four M12d quiet-only rows |
| M12d (seed) | the projection is the store's write | `stallSettingsAfter` seeds `'check'` | store `2 failed`: M12d's absent row with a quiet time and with the built-in; stall-settings `2 failed` |
| M12d (other field) | the same | `stallSettingsAfter` rewrites an unnamed level to `follow` | store `4 failed`: M12d's unreadable-level and unreadable-quiet rows with a quiet-only patch; stall-settings `2 failed` |
| M12d (unreadable) | the store never writes over an unreadable read | delete the throw | store `1 failed`: `a read inside the write that is itself unreadable takes neither arm …` |
| M27b (store, compare) | it writes only over the row the route measured | drop the expected-state compare | store `3 failed`: the three conflict rows |
| M27b (store, updatedAt alone) | the same | compare `updatedAt` alone | store `1 failed`: `a level a second connection changed, updatedAt kept, …` |
| R1 | the read never throws | prepare outside the `try` | store `1 failed`: `reads a missing table as unreadable …` |
| R2 | `at` is proven, all or failure | push `Number(r.atText)` | store `1 failed`: `an at that is not a positive safe integer refuses the whole read …` |
| R3 | the count read never throws | rethrow from its catch | store `1 failed`: `a thrown statement answers ok: false …` |

Finish with `git status --short` empty: every row restored.

---

### Task 5: watch.ts: one never-throwing resolution for both sweeps, the busy clock, and the quiet time threaded

**Model routing:** `sonnet`, effort `high`: transcription of a measured prototype, plus two suites' rows and a mutation
table. No judgment call is left open in it.

**Files:**
- Modify: `server/src/watch.ts`:
  - ≈18 (`turnidle.js` import), ≈39 (the one-line `shared/api.js` import), ≈56 and ≈64–65 (the `./coord/stall.js`
    import, then a new `./coord/stallsettings.js` import);
  - ≈191–194, `STALL_SWEEP_MS`'s docstring; ≈196, the module-private `interface StallResolution` after
    `STALL_CLOCK_GAP_MS`;
  - ≈845–847, after `stallWarned`: the fields `lastApplied`, `busySince`, `lastFallback`, `stallSettingsWarned`,
    `stallSettingsTraced`;
  - ≈3786–3789 and ≈3816, `sweepStalls`: its arming, and `judgeStall`'s call;
  - ≈3847, in front of `judgeStall`: the new methods `stallResolveNow`, `stallSettingsNotes`, `stallSettingsWarn` and
    the public `stallFallback()`; ≈3847–3852 and ≈3878, `judgeStall`'s docstring, signature (`quietMs`) and its
    `StallInput` literal;
  - ≈4542–4546, `sweepMail`'s mode line and the busy clock's writes.
- Modify: `server/test/stall-sweep.test.ts` (imports ≈12, ≈28–29, ≈31, ≈36; one describe appended at EOF, ≈2126).
- Modify: `server/test/mail-sweep.test.ts` (imports ≈13, ≈30, ≈32 plus a `vi.mock` of `stallsettings.js`; one describe
  appended at EOF, ≈3187).
- Test: `server/test/stall-sweep.test.ts`, `server/test/mail-sweep.test.ts`.

**Interfaces:**
- Consumes, from `server/src/coord/stallsettings.ts` (Tasks 1 and 3):
  - `stallBoxArmingOf(names: readonly string[], mailDisabled: boolean): StallBoxArming`
  - `parseStallSettings(read: StallSettingsRead): StallSettingsParsed`
  - `resolveStallWatch(box: StallBoxArming, settings: StallSettingsParsed): StallResolved` (its `chosen`, `quietMs`,
    `quietSource`, `levelSource`, `arming`)
  - `stallBusyClock(resolvedMode: MailTurnMode, lastApplied: MailTurnMode | null, busySince: number | null): { readonly mailMode: MailTurnMode; readonly busySince?: number }`
  - types `StallBoxArming`, `StallResolved`, `StallSettingsParsed`, `StallSettingsRead`; the tests also take
    `StallSettingsPatch`.
- Consumes, from `server/src/coord/store.ts` (Task 4): `CoordStore.stallSettings(): StallSettingsRead` (never throws);
  the tests write rows with `CoordStore.setStallSettings(patch: StallSettingsPatch, at: number, expected: StallSettingsRead): StallSettingsWrite`.
- Consumes, from `server/src/coord/stall.ts` (Task 3): `StallInput.quietMs?: number`, `StallArming.busySince?: number`,
  `STALL_QUIET_MS`, `stallArmingOf`.
- Consumes, from `shared/api.ts` (Task 1): `STALL_FOLLOW_LABEL`, `STALL_LEVEL_TEXT` (and `STALL_LEVELS` in the tests);
  from `server/src/turnidle.ts`: `type MailTurnMode`, `mailTurnModeOf`.
- Produces, on `FleetWatcher` (`server/src/watch.ts`):
  - `stallFallback(): { readonly at: number; readonly reason: string } | null` — PUBLIC, the routes task's seam (§9,
    §10): the last resolution that fell back on a throw, `null` once one succeeds.
  - `private stallResolveNow(store: CoordStore, names: readonly string[], mailDisabled: boolean): StallResolution`,
    with the module-private
    `interface StallResolution { readonly arming: StallBoxArming; readonly quietMs: number; readonly levelSource: StallResolved['levelSource'] }`.
    Never throws.
  - `private lastApplied: MailTurnMode | null`, `private busySince: number | null`,
    `private lastFallback: { readonly at: number; readonly reason: string } | null`,
    `private stallSettingsWarned: Set<string>`, `private stallSettingsTraced: boolean`.
  - `private stallSettingsNotes(read: StallSettingsRead, parsed: StallSettingsParsed, r: StallResolved): void` and
    `private stallSettingsWarn(state: string, words: string): void` (the latch; the resolver's catch never calls it).
  - `private async judgeStall(store, subject, sessions, tick, arming: StallArming, paused: boolean, now: number, quietMs: number): Promise<void>`.
  - Log lines, each through `console.warn`:
    - `ccrc-server: stall-watch settings not applied (<words>) — following the box files and the built-in quiet time`,
      where `<words>` is `no stored choice`, `stored choice unreadable: <detail>`, `stored level unreadable`,
      `stored quiet time unreadable` (the latch, once per state until a read applies), or the thrown reason (the
      catch, once while a fallback stands);
    - `ccrc-server: stall-watch level <label> / quiet time <n> min[ (built-in)] chosen in Settings overrides the box files`
      (the boot trace, once).

**Settled here (spec §20 residue that touches this task, and the details §8–§9 leave open):**
- The warn latch has four states, `absent`, `unreadable`, `level` and `quiet`. A row with both fields unreadable warns
  two lines, once each. Every latch re-arms when a read applies.
- The boot trace runs on the first read that is not `unreadable`, and prints only when the read applies a chosen level
  or a chosen quiet time. Its value is minutes, with ` (built-in)` when the quiet time is the default.
- `lastFallback.at` is the time of the latest throw, and its warn prints only when no fallback stood before it.
- An `unreadable` or absent row is not a fallback: the resolver ran, so `stallFallback()` stays `null` and the view's
  stored line says it (M21's row pins that).
- The latch is extracted as `stallSettingsWarn`, so §17's M20 mutation "call the latch from the catch" is literal.
- §20, "`busySince` restarts on every busy → non-busy → busy move": kept as specified. Only a resolver fault can flap
  the mode like that, and that fault warns once and shows on `stallFallback()`.
- §20, "`lastFallback` is written by whichever sweep resolved last": kept as one field. The resolver passes
  `mailDisabled` through untouched, so no shipped path can fault on that argument alone.
- §20, "a stall sweep between a raise into `busy` and the first mail sweep that applies it judges `busy-shadow`": kept.
  That is `stallBusyClock`'s substitution, which M8 pins.
- §17 lists M8b under `mail-sweep.test.ts`, so its rows are there. The task list's "M24" for `stall-sweep.test.ts` is
  read as M4: M24 is the PWA hazard line, in W2. M4's stall-sweep row is written here.

- [ ] **Step 1: Re-anchor**

```bash
cd "$(git rev-parse --show-toplevel)"
for t in "import { mailTurnIdle, mailTurnModeOf, mailTurnReadsMark } from './turnidle.js';" \
  "  BACKLOG_HORIZON_MS, STALL_CHECK_PREFIX, STALL_REPLY_PREFIX, parseStallDetail, stallArmingOf," \
  "  type StallVerdict, type StallWorker, type TurnMarkRead," \
  " *  constant's reason: a 2 h threshold does not need the 2 s tick. EXPORTED for its suite, as \`LC_SWEEP_MS\`" \
  "const STALL_CLOCK_GAP_MS = STALL_SWEEP_MS * 5 / 2;" \
  "  private stallWarned = new Set<string>();" \
  "      const arming: StallArming = { ...stallArmingOf(names), mailDisabled: names.includes(MAIL_DISABLED_MARKER), mailMode: mailTurnModeOf(names) };" \
  "          await this.judgeStall(store, subject, sessions, tick, arming, paused, now);" \
  "  /** One run worker: read, decide, apply — the run verdict first, then its session verdicts in the spec's order" \
  "    arming: StallArming, paused: boolean, now: number," \
  "      subject, worker, mail: stallRunMail(read.mail, runIds), notices, arming, coordinationPaused: paused," \
  "    const mode = mailTurnModeOf(listing);"; do grep -cF -- "$t" server/src/watch.ts; done
grep -cF "import { FLEET_SCOPE, LEDGER_STALE_MS, MAIL_MAX_ATTEMPTS, MAIL_REPLAY_MS, TERMINAL_DELIVERY_STATES, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';" server/src/watch.ts
for t in "import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';" "  parseStallDetail, stallDetail, COORD_DEAF_MS," \
  "import { MAIL_REPLAY_MS, WAVE_DONE_SUBJECT, type FleetSession } from '../../shared/api.js';" \
  "import { MAIL_GATE_BUSY_MARKER } from '../src/turnidle.js';"; do grep -cxF -- "$t" server/test/stall-sweep.test.ts; done
for t in "import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';" "import { MAIL_GATES } from '../../shared/api.js';" \
  "import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER } from '../src/turnidle.js';"; do grep -cxF -- "$t" server/test/mail-sweep.test.ts; done
grep -cE '^export function (stallBusyClock|resolveStallWatch|parseStallSettings|stallBoxArmingOf)\(' server/src/coord/stallsettings.ts
grep -cE '^  (stallSettings|setStallSettings)\(' server/src/coord/store.ts
grep -cE 'readonly (quietMs|busySince)\?: number' server/src/coord/stall.ts
```

Expected (measured at 77f8d63a5 plus Tasks 1–4): `1` for every watch.ts line except the tenth, `2` (≈3851 and ≈3948:
the signature line alone is not unique, so W10 quotes from the docstring above it); `1` for the `shared/api.js` line;
`1 1 1 1` for stall-sweep's four lines and `1 1 1` for mail-sweep's three; `4`, `2` and `2` for the earlier tasks'
exports. Every multi-line "before" block below was measured to occur exactly once in its file, with Python's
`str.count`. If any count differs, `main` moved: find the text by content and say so.

- [ ] **Step 2: Write the failing tests**

`server/test/stall-sweep.test.ts`, four import edits, each replacing one exact text, then the appended describe.

(SS1) ≈12: replace

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
```

with

```ts
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
```

(SS2) ≈28–29, the end of the `../src/coord/stall.js` import: the settings import follows it: replace

```ts
  parseStallDetail, stallDetail, COORD_DEAF_MS,
} from '../src/coord/stall.js';
```

with

```ts
  parseStallDetail, stallArmingOf, stallDetail, COORD_DEAF_MS, type StallArming,
} from '../src/coord/stall.js';
import { parseStallSettings, stallBusyClock, type StallBoxArming, type StallSettingsPatch } from '../src/coord/stallsettings.js';
```

(SS3) ≈31: replace

```ts
import { MAIL_REPLAY_MS, WAVE_DONE_SUBJECT, type FleetSession } from '../../shared/api.js';
```

with

```ts
import { MAIL_REPLAY_MS, STALL_LEVELS, WAVE_DONE_SUBJECT, type FleetSession } from '../../shared/api.js';
```

(SS4) ≈36: replace

```ts
import { MAIL_GATE_BUSY_MARKER } from '../src/turnidle.js';
```

with

```ts
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, mailTurnModeOf } from '../src/turnidle.js';
```

(SS5) Append at the end of the file (it starts with one blank line):

```ts

// ── stall watch settings (design 2026-10-05 §9): one resolution for both sweeps, the busy clock, the quiet time ─────────
describe('sweepStalls: the stall-watch settings (stall watch settings §9)', () => {
  type Resolution = { readonly arming: StallBoxArming; readonly quietMs: number; readonly levelSource: string };
  const touch = (h: Harness, name: string): void => { writeFileSync(path.join(h.home, '.cc-sessions', name), ''); };
  /** The registry listing as `tick()` hands it to both sweeps: the box files and the session field files. */
  const listing = (h: Harness): string[] => readdirSync(path.join(h.home, '.cc-sessions'));
  /** A stored choice, written through the store's one write as the route writes it. */
  const choose = (coord: CoordStore, patch: StallSettingsPatch): void => {
    const r = coord.setStallSettings(patch, Date.now(), coord.stallSettings());
    if (r.kind !== 'written') throw new Error(`fixture write refused: ${JSON.stringify(r)}`);
  };
  /** The watcher's two busy-clock fields. A rename reads `undefined`, so the rows that read it red, never pass. */
  const clock = (w: FleetWatcher): { lastApplied: string | null; busySince: number | null } => {
    const f = w as unknown as { lastApplied: string | null; busySince: number | null };
    return { lastApplied: f.lastApplied, busySince: f.busySince };
  };
  /** Wraps the private resolver and `judgeStall`, passing through: every answer the resolver gave, and the arming
   *  every worker verdict received. A renamed method makes `.bind` throw, so the rows red. */
  const tap = (w: FleetWatcher): { answers: Resolution[]; armings: StallArming[] } => {
    const answers: Resolution[] = [];
    const armings: StallArming[] = [];
    const f = w as unknown as {
      stallResolveNow: (...a: unknown[]) => Resolution; judgeStall: (...a: unknown[]) => Promise<void>;
    };
    const resolve = f.stallResolveNow.bind(w);
    f.stallResolveNow = (...a) => { const r = resolve(...a); answers.push(r); return r; };
    const judge = f.judgeStall.bind(w);
    f.judgeStall = (...a) => { armings.push(a[4] as StallArming); return judge(...a); };
    return { answers, armings };
  };

  it('the migrated database seeds Follow and the built-in quiet time, so the S4 verdicts are today\'s (M12)', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    at(R1_AT - STALL_SWEEP_MS);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord)).toEqual([]);
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], LIVE, tickOf());
    expect(operatorMail(coord).map((m) => m.at)).toEqual([R1_AT]);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'quiet', 1, KEY)]);
    expect(parseStallSettings(coord.stallSettings()))
      .toMatchObject({ stored: 'row', level: { kind: 'follow' }, quiet: { kind: 'default' } });
  });

  it('at boot the verdicts receive today\'s exact arming, with no busySince key: the box files on busy delivery, and with mail-disabled (M4)', async () => {
    for (const extra of [[], ['mail-disabled']]) {
      const { h, coord, w } = await rig();
      seedRun(coord, { program: 'demo-program' });
      for (const n of [...W2, MAIL_GATE_BUSY_MARKER, ...extra]) touch(h, n);
      const t = tap(w);
      const names = listing(h);
      at(R1_AT);
      await w.sweepStalls([fleetRow(WORKER)], names, tickOf());
      const today = { ...stallArmingOf(names), mailDisabled: names.includes('mail-disabled'), mailMode: mailTurnModeOf(names) };
      expect(today.mailMode, 'premise: the box files deliver on busy').toBe('busy');
      expect(t.armings, extra.join()).toHaveLength(1);
      expect(t.armings[0], extra.join()).toStrictEqual(today);
      expect(Object.keys(t.armings[0]!), extra.join()).not.toContain('busySince');
    }
  });

  it('a chosen level keeps mail-disabled: r1 is held, while the chosen wave-2 step pushes mail-stuck (M2)', async () => {
    const { coord, w, sent } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    choose(coord, { level: 'all' });
    // Queued at 21:19:17Z and never delivered: 2 h past the worker's idle start at r1's time.
    const m = coord.insertMail({ fromId: 'demo-boss', fromUuid: 'u', toId: WORKER, runId: null, kind: 'finding', subject: 'hi', body: 'b', artifacts: [] });
    const d = coord.queueDelivery(m.id, WORKER, 'envelope');
    at(R1_AT);
    await w.sweepStalls([fleetRow(WORKER)], ['mail-disabled'], tickOf());
    expect(operatorMail(coord)).toEqual([]);          // r1 would send under the chosen level: held `mail-disabled`
    expect(sent.map((p) => p.tag)).toEqual([`stall-${runId}-mail-stuck-1-${d.id}`]);
    expect(stallRows(coord, runId)).toEqual([stallDetail('live', 'mail-stuck', 1, d.id)]);
  });

  it('a stored quiet time reaches the verdict: 30 min chosen, a worker quiet 31 min draws its r1 under Log (M9c)', async () => {
    const { coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    choose(coord, { quiet: { kind: 'set', ms: 30 * 60_000 } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(IDLE_AT + 31 * 60_000);
    await w.sweepStalls([fleetRow(WORKER)], [], tickOf());
    expect(stallRows(coord, runId)).toEqual([stallDetail('shadow', 'quiet', 1, KEY)]);
  });

  it('one resolution for both sweeps: for every choice the two answers agree, the mail gate applies its mode, and the verdicts differ only by the busy clock (M8a)', async () => {
    for (const level of ['follow', ...STALL_LEVELS] as const) {
      const { h, coord, w } = await rig();
      seedRun(coord, { program: 'demo-program' });
      for (const n of [...ARMED, MAIL_GATE_BUSY_SHADOW_MARKER]) touch(h, n);
      choose(coord, { level });
      const t = tap(w);
      at(R1_AT);
      await w.sweepMail();
      const applied = clock(w);
      await w.sweepStalls([fleetRow(WORKER)], listing(h), tickOf());
      expect(t.answers, level).toHaveLength(2);
      expect(t.answers[1], level).toEqual(t.answers[0]);
      const answer = t.answers[0]!;
      expect(applied.lastApplied, level).toBe(answer.arming.mailMode);
      if (answer.arming.disabled) {
        expect(t.armings, level).toEqual([]);
        continue;
      }
      expect(t.armings, level).toHaveLength(1);
      const { mailMode, busySince, ...rest } = t.armings[0]!;
      const { mailMode: answerMode, ...answerRest } = answer.arming;
      expect(rest, level).toStrictEqual(answerRest);
      expect({ mailMode, ...(busySince === undefined ? {} : { busySince }) }, level)
        .toStrictEqual(stallBusyClock(answerMode, applied.lastApplied as typeof answerMode | null, applied.busySince));
    }
  });

  /** One raise into busy delivery while a mail has been held past MAIL_STUCK_MS (M8). The mail sweep applies the
   *  pre-raise mode, the raise lands, a stall sweep runs before the mail sweep applies busy at T, and two run after. */
  const raise = async (label: string, before: (h: Harness, coord: CoordStore) => void, after: (h: Harness, coord: CoordStore) => void): Promise<void> => {
    const { h, coord, w } = await rig();
    const runId = seedRun(coord, { program: 'demo-program' });
    seedLiveState(h.home, { status: 'busy', statusUpdatedAt: IDLE_AT + 300_000, startedAt: STARTED_AT });
    seedTurnMark(h.home, WORKER);                     // done, its Stop at IDLE_AT
    const m = coord.insertMail({ fromId: 'demo-boss', fromUuid: 'u', toId: WORKER, runId: null, kind: 'finding', subject: 'hi', body: 'b', artifacts: [] });
    const d = coord.queueDelivery(m.id, WORKER, 'envelope');
    const T = IDLE_AT + MAIL_STUCK_MS + 600_000;     // the mail has been held 82 min past the turn's Stop
    // Never due to the mail sweep, so it stays undelivered throughout; the mail sweep still applies its mode.
    coord.backOff(d.id, 'held by the fixture', T + 2 * MAIL_STUCK_MS, false);
    const stuck = (): string[] => stallRows(coord, runId).filter((x) => x.includes('mail-stuck'));
    const sweep = async (): Promise<void> => { await w.sweepStalls([fleetRow(WORKER, { status: 'busy' })], listing(h), tickOf()); };
    before(h, coord);
    at(T - 70_000);
    await w.sweepMail();                              // applies the pre-raise mode
    after(h, coord);                                  // the raise
    at(T - 59_000);
    await sweep();
    expect(stuck(), `${label}: a stall sweep before the mail sweep applies busy`).toEqual([]);
    at(T);
    await w.sweepMail();                              // busy delivery begins
    expect(clock(w), label).toEqual({ lastApplied: 'busy', busySince: T });
    at(T + 1_000);
    await sweep();
    expect(stuck(), `${label}: T + 1 s`).toEqual([]);
    at(T + MAIL_STUCK_MS);
    await sweep();
    expect(stuck(), `${label}: T + MAIL_STUCK_MS`).toEqual([stallDetail('live', 'mail-stuck', 1, d.id)]);
    expect(coord.delivery(d.id)?.state, `${label}: premise, still undelivered`).toBe('queued');
  };

  it('the busy clock: a chosen Alert raised to Everything waits MAIL_STUCK_MS from the start of busy delivery (M8)', async () => {
    await raise('alert -> all', (_h, coord) => choose(coord, { level: 'alert' }), (_h, coord) => choose(coord, { level: 'all' }));
  });

  it('the busy clock: Follow over files armed for Everything, from a chosen Alert, gets the same grace (M8)', async () => {
    await raise('alert -> follow',
      (h, coord) => { for (const n of [...W2, MAIL_GATE_BUSY_MARKER]) touch(h, n); choose(coord, { level: 'alert' }); },
      (_h, coord) => choose(coord, { level: 'follow' }));
  });

  it('the busy clock: mail-gate-busy touched by hand under Follow gets the same grace (M8)', async () => {
    await raise('touched busy', (h) => { for (const n of W2) touch(h, n); }, (h) => touch(h, MAIL_GATE_BUSY_MARKER));
  });
});
```

`server/test/mail-sweep.test.ts`, three import edits, then the appended describe.

(MS1) ≈13: replace

```ts
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
```

with

```ts
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
```

(MS2) ≈30: replace

```ts
import { MAIL_GATES } from '../../shared/api.js';
```

with

```ts
import { MAIL_GATES, STALL_LEVEL_TEXT } from '../../shared/api.js';
```

(MS3) ≈32, the last import: the settings type import and the resolver mock follow it: replace

```ts
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER } from '../src/turnidle.js';
```

with

```ts
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER } from '../src/turnidle.js';
import type { StallSettingsPatch } from '../src/coord/stallsettings.js';

// Stall watch settings (design 2026-10-05 §9, M20): a resolver that really throws, switched on by one row at a time.
// Every other row runs the real `resolveStallWatch`; the mock passes straight through while `fault.resolve` is null.
const settingsFault = vi.hoisted(() => ({ resolve: null as Error | null }));
vi.mock('../src/coord/stallsettings.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/coord/stallsettings.js')>();
  return {
    ...real,
    resolveStallWatch: (...a: Parameters<typeof real.resolveStallWatch>): ReturnType<typeof real.resolveStallWatch> => {
      if (settingsFault.resolve !== null) throw settingsFault.resolve;
      return real.resolveStallWatch(...a);
    },
  };
});
```

(MS4) Append at the end of the file (it starts with one blank line):

```ts

// ── stall watch settings (design 2026-10-05 §9): the mail gate's mode comes from the one resolution ──────────────────────
describe('sweepMail: the mail gate mode comes from the stall-watch resolution (stall watch settings §9)', () => {
  const STARTED = NOW - 3_600_000;              // the live process started an hour ago
  const STOP = NOW - MAIL_QUIET_MS - 1_000;     // the marker's Stop: one quiet window and a second ago
  const NOT_APPLIED = 'ccrc-server: stall-watch settings not applied (';
  const TAIL = ') — following the box files and the built-in quiet time';
  /** The busy-modes describe's marker line: all 15 keys in the writer's order, current, `done`. */
  const seedTurnMark = (home: string, over: Record<string, unknown> = {}): void => {
    writeFileSync(path.join(home, '.cc-sessions', `${ID}.turn.json`), JSON.stringify({
      v: 1, sessionId: UUID, state: 'done', event: 'Stop', at: STOP, turnAt: NOW - 600_000, stopAt: STOP,
      bg: 1, bgKinds: 'subagent', bgIds: 'task-1', err: null, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '',
      ...over,
    }));
  };
  /** The recipient and a resolvable sender, with a live file that carries `startedAt`. */
  const seedAll = (h: Harness, live: Record<string, unknown>): void => {
    seedRegistry(h.home, ID); seedHookState(h.home, ID);
    seedLiveState(h.home, { startedAt: STARTED, ...live });
    seedRegistry(h.home, FROM_ID, FROM_UUID);
  };
  /** Busy over a current `done` marker: delivered under `busy` alone, not-idle under every other mode. */
  const seedBusy = (h: Harness): void => { seedAll(h, { status: 'busy', statusUpdatedAt: NOW - 1_000 }); seedTurnMark(h.home); };
  const touch = (h: Harness, name: string): void => { writeFileSync(path.join(h.home, '.cc-sessions', name), ''); };
  /** A stored choice, written through the store's one write as the route writes it. */
  const choose = (coord: CoordStore, patch: StallSettingsPatch): void => {
    const r = coord.setStallSettings(patch, Date.now(), coord.stallSettings());
    if (r.kind !== 'written') throw new Error(`fixture write refused: ${JSON.stringify(r)}`);
  };
  /** The watcher's two busy-clock fields. A rename reads `undefined`, so the rows that read it red, never pass. */
  const clock = (w: FleetWatcher): { lastApplied: string | null; busySince: number | null } => {
    const f = w as unknown as { lastApplied: string | null; busySince: number | null };
    return { lastApplied: f.lastApplied, busySince: f.busySince };
  };
  const warnLines = (warn: { mock: { calls: unknown[][] } }, head: string): string[] =>
    warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith(head));
  /** One sweep over a busy recipient, a delivery queued to it: did it deliver, and with which gate if not. */
  const outcome = async (h: Harness, coord: CoordStore, w: FleetWatcher, id: number): Promise<string> => {
    await expect(w.sweepMail()).resolves.toBeUndefined();
    const row = deliveryRow(coord, id);
    return row.state === 'delivered' && literalSends(h.calls).length === 1 ? 'delivered' : `${row.state}:${row.lastGate}`;
  };

  it('a chosen Deliver delivers on busy with no busy file; Follow on the same box holds it (M7)', async () => {
    for (const [level, want] of [['deliver', 'delivered'], ['follow', 'queued:not-idle']] as const) {
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedBusy(h);
      choose(coord, { level });
      const { id } = queueTestDelivery(coord, ID, ENVELOPE);
      expect(await outcome(h, coord, w, id), level).toBe(want);
    }
  });

  it('a chosen Off leaves the mail gate as the box files set it; a chosen Log over the same busy file holds (M7)', async () => {
    for (const [level, want] of [['off', 'delivered'], ['log', 'queued:not-idle']] as const) {
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedBusy(h);
      touch(h, MAIL_GATE_BUSY_MARKER);
      choose(coord, { level });
      const { id } = queueTestDelivery(coord, ID, ENVELOPE);
      expect(await outcome(h, coord, w, id), level).toBe(want);
    }
  });

  it('on a box with no gate file, a chosen Log holds a live shell over a current working marker; Follow delivers it (M7)', async () => {
    const S = NOW - MAIL_QUIET_MS - 1_000;
    for (const [level, want] of [['log', 'queued:not-idle'], ['follow', 'delivered']] as const) {
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedAll(h, { status: 'shell', statusUpdatedAt: S });
      seedTurnMark(h.home, { state: 'working', event: 'PostToolUse', at: S, turnAt: S, stopAt: null, bg: -1, bgKinds: '', bgIds: '' });
      choose(coord, { level });
      const { id } = queueTestDelivery(coord, ID, ENVELOPE);
      expect(await outcome(h, coord, w, id), level).toBe(want);
    }
  });

  it('mail-gate-strict keeps its precedence under a chosen Deliver: the busy recipient is not-idle (M3)', async () => {
    const h = harness({ panes: HAPPY_PANES });
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    seedBusy(h);
    touch(h, MAIL_GATE_STRICT_MARKER);
    choose(coord, { level: 'deliver' });
    const { id } = queueTestDelivery(coord, ID, ENVELOPE);
    expect(await outcome(h, coord, w, id)).toBe('queued:not-idle');
    expect(clock(w).lastApplied).toBe('strict');
  });

  it('the busy clock moves only on an applied mode: a null listing and the mail-disabled return leave it, and busy over busy keeps it (M8b)', async () => {
    const h = harness();
    const coord = store(h.home);
    const unl = onceUnlistableIO();
    const { w } = await primedWatcher(h, coord, { io: unl.io });
    expect(clock(w), 'at start').toEqual({ lastApplied: null, busySince: null });
    await w.sweepMail();
    expect(clock(w), 'no gate file').toEqual({ lastApplied: 'shell', busySince: null });
    touch(h, MAIL_GATE_BUSY_MARKER);
    advance(PAST_SWEEP_MS);
    const T1 = Date.now();
    await w.sweepMail();
    expect(clock(w), 'busy over shell').toEqual({ lastApplied: 'busy', busySince: T1 });
    unl.failNext();
    advance(PAST_SWEEP_MS);
    await w.sweepMail();
    expect(clock(w), 'a null listing').toEqual({ lastApplied: 'busy', busySince: T1 });
    touch(h, 'mail-disabled');
    advance(PAST_SWEEP_MS);
    await w.sweepMail();
    expect(clock(w), 'the mail-disabled return').toEqual({ lastApplied: 'busy', busySince: T1 });
    rmSync(path.join(h.home, '.cc-sessions', 'mail-disabled'));
    advance(PAST_SWEEP_MS);
    await w.sweepMail();
    expect(clock(w), 'busy over busy').toEqual({ lastApplied: 'busy', busySince: T1 });
  });

  it('the busy clock restarts on a move back into busy, clears on a non-busy mode, and a restart starts it null (M8b)', async () => {
    const h = harness();
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    await w.sweepMail();                                    // shell
    touch(h, MAIL_GATE_BUSY_MARKER);
    advance(PAST_SWEEP_MS);
    const T1 = Date.now();
    await w.sweepMail();
    expect(clock(w)).toEqual({ lastApplied: 'busy', busySince: T1 });
    choose(coord, { level: 'log' });                       // busy-shadow, whatever the busy file says
    advance(PAST_SWEEP_MS);
    await w.sweepMail();
    expect(clock(w), 'a non-busy mode clears it').toEqual({ lastApplied: 'busy-shadow', busySince: null });
    choose(coord, { level: 'follow' });
    advance(PAST_SWEEP_MS);
    const T2 = Date.now();
    await w.sweepMail();
    expect(clock(w), 'busy again').toEqual({ lastApplied: 'busy', busySince: T2 });
    const { w: again } = await primedWatcher(h, coord);    // a server restart, the busy file still there
    expect(clock(again), 'a restart').toEqual({ lastApplied: null, busySince: null });
    advance(PAST_SWEEP_MS);
    await again.sweepMail();
    expect(clock(again), 'the first busy after a restart').toEqual({ lastApplied: 'busy', busySince: null });
  });

  it('a throwing store, resolver or latch, or an error whose message cannot be read, still delivers at the listing\'s mode (M20)', async () => {
    const getterless = new Error('unused');
    Object.defineProperty(getterless, 'message', { get: () => { throw new Error('the message getter throws'); } });
    const cases: [string, string, (coord: CoordStore) => () => void][] = [
      ['store', 'store bug', (coord) => {
        const spy = vi.spyOn(coord, 'stallSettings').mockImplementation(() => { throw new Error('store bug'); });
        return () => spy.mockRestore();
      }],
      ['resolver', 'resolver bug', () => {
        settingsFault.resolve = new Error('resolver bug');
        return () => { settingsFault.resolve = null; };
      }],
      ['latch', 'warn sink down', (coord) => {
        coord.db.exec('DELETE FROM stall_settings');        // absent: the latch warns, and its warn throws
        const spy = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => {
          if (String(m).startsWith(NOT_APPLIED)) throw new Error('warn sink down');
        });
        return () => spy.mockRestore();
      }],
      ['message', 'an unreadable fault', (coord) => {
        const spy = vi.spyOn(coord, 'stallSettings').mockImplementation(() => { throw getterless; });
        return () => spy.mockRestore();
      }],
    ];
    for (const [name, reason, plant] of cases) {
      const h = harness({ panes: HAPPY_PANES });
      const coord = store(h.home);
      const { w } = await primedWatcher(h, coord);
      seedBusy(h);
      touch(h, MAIL_GATE_BUSY_MARKER);                       // the listing's mode: busy
      choose(coord, { level: 'log' });                       // applied, it would hold the busy recipient
      const { id } = queueTestDelivery(coord, ID, ENVELOPE);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const restore = plant(coord);
      try {
        expect(await outcome(h, coord, w, id), name).toBe('delivered');
        expect(w.stallFallback(), name).toEqual({ at: NOW, reason });
        expect(clock(w).lastApplied, name).toBe('busy');
      } finally {
        restore();
        warn.mockRestore();
      }
    }
  });

  it('the fallback warns once while it stands, and clears when a resolution succeeds (M20, M20b)', async () => {
    const h = harness();
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(coord, 'stallSettings').mockImplementation(() => { throw new Error('store bug'); });
    try {
      expect(w.stallFallback(), 'before any sweep').toBeNull();
      await w.sweepMail();
      advance(PAST_SWEEP_MS);
      await w.sweepMail();
      expect(warnLines(warn, NOT_APPLIED), 'one line while the fault stands').toEqual([`${NOT_APPLIED}store bug${TAIL}`]);
      expect(w.stallFallback()).toEqual({ at: Date.now(), reason: 'store bug' });
      spy.mockRestore();
      advance(PAST_SWEEP_MS);
      await w.sweepMail();
      expect(w.stallFallback(), 'a resolution that succeeds').toBeNull();
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });

  it('the warn latch: an unreadable row warns once across sweeps, and again after a read that applies (M21)', async () => {
    const h = harness();
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const line = `${NOT_APPLIED}stored choice unreadable: disk I/O error${TAIL}`;
    let spy = vi.spyOn(coord, 'stallSettings').mockReturnValue({ kind: 'unreadable', detail: 'disk I/O error' });
    try {
      for (let k = 0; k < 3; k++) { await w.sweepMail(); advance(PAST_SWEEP_MS); }
      expect(warnLines(warn, NOT_APPLIED), 'once across three sweeps').toEqual([line]);
      expect(w.stallFallback(), 'an unreadable row is no fallback: the resolver read it').toBeNull();
      spy.mockRestore();
      await w.sweepMail();                                   // the seed row reads and applies: the latch re-arms
      advance(PAST_SWEEP_MS);
      spy = vi.spyOn(coord, 'stallSettings').mockReturnValue({ kind: 'unreadable', detail: 'disk I/O error' });
      await w.sweepMail();
      expect(warnLines(warn, NOT_APPLIED), 'again after a read that applied').toEqual([line, line]);
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });

  it('the warn latch is per read state: an absent row, and a row whose two fields are unreadable, each warn once', async () => {
    const h = harness();
    const coord = store(h.home);
    const { w } = await primedWatcher(h, coord);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      coord.db.exec('DELETE FROM stall_settings');
      await w.sweepMail();
      advance(PAST_SWEEP_MS);
      await w.sweepMail();
      coord.db.exec("INSERT INTO stall_settings (id, level, quietMs, updatedAt) VALUES (1, 'bogus', 7, 0)");
      advance(PAST_SWEEP_MS);
      await w.sweepMail();
      advance(PAST_SWEEP_MS);
      await w.sweepMail();
      expect(warnLines(warn, NOT_APPLIED)).toEqual([
        `${NOT_APPLIED}no stored choice${TAIL}`,
        `${NOT_APPLIED}stored level unreadable${TAIL}`,
        `${NOT_APPLIED}stored quiet time unreadable${TAIL}`,
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('the boot trace: the first read that applies a choice says so once; Follow with the built-in says nothing', async () => {
    const TRACE = 'ccrc-server: stall-watch level ';
    for (const [patch, want] of [
      [{ level: 'check', quiet: { kind: 'set', ms: 1_800_000 } },
        [`${TRACE}${STALL_LEVEL_TEXT.check.label} / quiet time 30 min chosen in Settings overrides the box files`]],
      [{ level: 'follow' }, []],
    ] as const) {
      const h = harness();
      const coord = store(h.home);
      choose(coord, patch as StallSettingsPatch);
      const { w } = await primedWatcher(h, coord);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await w.sweepMail();
        advance(PAST_SWEEP_MS);
        await w.sweepMail();
        expect(warnLines(warn, TRACE), JSON.stringify(patch)).toEqual(want);
      } finally {
        warn.mockRestore();
      }
    }
  });
});
```

- [ ] **Step 3: Run the suites to verify they fail**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/stall-sweep.test.ts
./node_modules/.bin/vitest run test/mail-sweep.test.ts
```

Expected (measured on the prototype, against `watch.ts` as Task 4 left it):

`stall-sweep.test.ts` gives `Tests 7 failed | 110 passed (117)`. Its failing rows:
- `at boot the verdicts receive today's exact arming, with no busySince key: … (M4)`
- `a chosen level keeps mail-disabled: … (M2)`
- `a stored quiet time reaches the verdict: … (M9c)`
- `one resolution for both sweeps: … (M8a)`
- the three `the busy clock: … (M8)` rows

`mail-sweep.test.ts` gives `Tests 11 failed | 104 passed (115)`: every row of the new describe.

`the migrated database seeds Follow and the built-in quiet time … (M12)` is GREEN here, by design. It pins today's
verdicts on the migrated database, and its red is the seed mutation (M12 in Step 6).

- [ ] **Step 4: Implement**

Each edit below replaces one exact text in `server/src/watch.ts`. Each text occurs exactly once at Step 1's anchor.
Apply them in order.

(W1) ≈18, the `turnidle.js` import: replace

```ts
import { mailTurnIdle, mailTurnModeOf, mailTurnReadsMark } from './turnidle.js';
```

with

```ts
import { mailTurnIdle, mailTurnModeOf, mailTurnReadsMark, type MailTurnMode } from './turnidle.js';
```

(W2) ≈39, the ONE-LINE `shared/api.js` import (it stays one line: `single-definition.test.ts` scans it for `UNCHECKED_PR`): replace

```ts
import { FLEET_SCOPE, LEDGER_STALE_MS, MAIL_MAX_ATTEMPTS, MAIL_REPLAY_MS, TERMINAL_DELIVERY_STATES, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';
```

with

```ts
import { FLEET_SCOPE, LEDGER_STALE_MS, MAIL_MAX_ATTEMPTS, MAIL_REPLAY_MS, STALL_FOLLOW_LABEL, STALL_LEVEL_TEXT, TERMINAL_DELIVERY_STATES, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';
```

(W3) ≈56, the first member line of the `./coord/stall.js` import: replace

```ts
  BACKLOG_HORIZON_MS, STALL_CHECK_PREFIX, STALL_REPLY_PREFIX, parseStallDetail, stallArmingOf,
```

with

```ts
  BACKLOG_HORIZON_MS, STALL_CHECK_PREFIX, STALL_QUIET_MS, STALL_REPLY_PREFIX, parseStallDetail, stallArmingOf,
```

(W4) ≈64–65, the end of the `./coord/stall.js` import: the settings import follows it: replace

```ts
  type StallVerdict, type StallWorker, type TurnMarkRead,
} from './coord/stall.js';
```

with

```ts
  type StallVerdict, type StallWorker, type TurnMarkRead,
} from './coord/stall.js';
import {
  parseStallSettings, resolveStallWatch, stallBoxArmingOf, stallBusyClock,
  type StallBoxArming, type StallResolved, type StallSettingsParsed, type StallSettingsRead,
} from './coord/stallsettings.js';
```

(W5) ≈191–194, `STALL_SWEEP_MS`'s docstring (spec §7's rewording of "a 2 h threshold"): replace

```ts
/** The stall watch's lane (spec 2026-09-29 §4.2, §10). It runs at `CLAIM_SWEEP_MS`'s cadence, for that
 *  constant's reason: a 2 h threshold does not need the 2 s tick. EXPORTED for its suite, as `LC_SWEEP_MS`
 *  and `READINESS_SWEEP_MS` are. */
export const STALL_SWEEP_MS = CLAIM_SWEEP_MS;
```

with

```ts
/** The stall watch's lane (spec 2026-09-29 §4.2, §10). It runs at `CLAIM_SWEEP_MS`'s cadence, for that
 *  constant's reason: a threshold of the quiet time (2 h built-in, 30 min at the least, stall watch settings §7)
 *  does not need the 2 s tick. EXPORTED for its suite, as `LC_SWEEP_MS` and `READINESS_SWEEP_MS` are. */
export const STALL_SWEEP_MS = CLAIM_SWEEP_MS;
```

(W6) ≈196, after `STALL_CLOCK_GAP_MS`: the module-private `StallResolution`: replace

```ts
const STALL_CLOCK_GAP_MS = STALL_SWEEP_MS * 5 / 2;
```

with

```ts
const STALL_CLOCK_GAP_MS = STALL_SWEEP_MS * 5 / 2;

/** What `FleetWatcher.stallResolveNow` answers each sweep (stall watch settings §9): the arming, which always carries
 *  a `mailMode`; the quiet time that r1, the dialog cap and the backoff base read; and where the level came from. */
interface StallResolution {
  readonly arming: StallBoxArming;
  readonly quietMs: number;
  readonly levelSource: StallResolved['levelSource'];
}
```

(W7) ≈845–847, after `stallWarned`: the busy clock, `lastFallback` and the latch fields: replace

```ts
  /** Warn-once keys, `<sessionId>|<what>`: a run-less shadow rung, `failed-unknown`, and the defensive r2-with-no-r1
   *  line (`applyStall`; no real input reaches it today). */
  private stallWarned = new Set<string>();
```

with

```ts
  /** Warn-once keys, `<sessionId>|<what>`: a run-less shadow rung, `failed-unknown`, and the defensive r2-with-no-r1
   *  line (`applyStall`; no real input reaches it today). */
  private stallWarned = new Set<string>();
  /** The busy clock (stall watch settings §9, `busy-clock-starts-when-busy-delivery-starts` (D-4024)). Written by
   *  `sweepMail` alone, on a mode it applies, and read by `sweepStalls` through `stallBusyClock`. `lastApplied` is the
   *  mail gate mode last applied, `null` before the first. `busySince` is when the mail sweep moved into busy delivery
   *  from a known non-busy mode, and `null` whenever no such move has been seen since the server started. The
   *  unlistable return and the `MAIL_DISABLED_MARKER` return write neither: neither says anything about the mode, so
   *  a passing listing failure never restarts the clock. IN MEMORY: after a restart the stall sweep judges exactly as
   *  before this clock existed, until busy delivery begins again while the server runs. */
  private lastApplied: MailTurnMode | null = null;
  private busySince: number | null = null;
  /** The last settings resolution that fell back on a throw (§9): when, and why. `null` once a resolution succeeds.
   *  Read only through `stallFallback()`. */
  private lastFallback: { readonly at: number; readonly reason: string } | null = null;
  /** The settings row's warn latch (§8): the read states already warned (`absent`, `unreadable`, `level`, `quiet`),
   *  cleared when a read applies again, so a row that stays unusable warns once, not every 10 s. */
  private stallSettingsWarned = new Set<string>();
  /** Set by the first settings read that is not unreadable: the boot trace runs once (§8). */
  private stallSettingsTraced = false;
```

(W8) ≈3786–3789, `sweepStalls`' arming: replace

```ts
      // `mail-disabled` reaches L1 as a fact, and `stallMailDisabledHold` decides what it holds (slug
      // `lane-honours-mail-disabled` (D-3636)). The module-local literal, never rundefs' export: see the import note.
      const arming: StallArming = { ...stallArmingOf(names), mailDisabled: names.includes(MAIL_DISABLED_MARKER), mailMode: mailTurnModeOf(names) };
      if (arming.disabled) return;
```

with

```ts
      // `mail-disabled` reaches L1 as a fact, and `stallMailDisabledHold` decides what it holds (slug
      // `lane-honours-mail-disabled` (D-3636)). The module-local literal, never rundefs' export: see the import note.
      // The arming is the one settings resolution the mail sweep also calls (stall watch settings §9). The busy clock
      // then decides the mode the verdicts judge, and when mail-stuck's busy idle start begins (D-4024).
      const r = this.stallResolveNow(store, names, names.includes(MAIL_DISABLED_MARKER));
      const arming: StallArming = { ...r.arming, ...stallBusyClock(r.arming.mailMode, this.lastApplied, this.busySince) };
      if (arming.disabled) return;
```

(W9) ≈3816, `sweepStalls`' worker loop: replace

```ts
          await this.judgeStall(store, subject, sessions, tick, arming, paused, now);
```

with

```ts
          await this.judgeStall(store, subject, sessions, tick, arming, paused, now, r.quietMs);
```

(W10) ≈3847–3852, `judgeStall`'s docstring and signature: the new methods go in front of it. (Its signature line `    arming: StallArming, paused: boolean, now: number,` alone occurs twice, ≈3851 and ≈3948, so the quoted text starts at the docstring.): replace

```ts
  /** One run worker: read, decide, apply — the run verdict first, then its session verdicts in the spec's order
   *  (orphan E, failed, each mail stuck, orphan D). Its throws are the caller's to catch. */
  private async judgeStall(
    store: CoordStore, subject: StallSubject, sessions: readonly FleetSession[], tick: StallTick,
    arming: StallArming, paused: boolean, now: number,
  ): Promise<void> {
```

with

```ts
  /**
   * The stall-watch settings, resolved once for one sweep over that sweep's own listing (stall watch settings §9):
   * the box arming (`stallBoxArmingOf`), the stored row (`store.stallSettings()`), its parse and the one resolver, then
   * the warn latch and the boot trace (§8). Both sweeps call it and nothing else reads the row, so the two cannot
   * read it differently.
   *
   * It NEVER THROWS. `sweepMail` runs under `void this.sweepMail().catch(() => {})`, so a throw here would stop all
   * mail delivery fleet-wide with no line. On any throw (a store, parse or resolver bug, or a fault in the latch or
   * the trace) it answers the expression both sweeps ran before settings existed, over the same listing, with the
   * built-in quiet time and `files`, so the fallback adds nothing that can throw where that did not. The catch calls
   * nothing that can throw: `reason` is composed in its own `try`, keeping a fixed word when even reading the error
   * throws, and its one warn is a bare `console.warn` in its own `try`, printed only when no fallback stood, and never
   * through the latch, which may be the fault. It records `lastFallback`; a resolution that succeeds clears it.
   */
  private stallResolveNow(store: CoordStore, names: readonly string[], mailDisabled: boolean): StallResolution {
    try {
      const box = stallBoxArmingOf(names, mailDisabled);
      const read = store.stallSettings();
      const parsed = parseStallSettings(read);
      const r = resolveStallWatch(box, parsed);
      this.stallSettingsNotes(read, parsed, r);
      this.lastFallback = null;
      return { arming: r.arming, quietMs: r.quietMs, levelSource: r.levelSource };
    } catch (err) {
      let reason = 'an unreadable fault';
      try {
        reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
      } catch { /* even reading the error threw: the fixed word stands */ }
      if (this.lastFallback === null) {
        try {
          console.warn(`ccrc-server: stall-watch settings not applied (${reason}) — following the box files and the built-in quiet time`);
        } catch { /* a log line must not stop a sweep */ }
      }
      this.lastFallback = { at: Date.now(), reason };
      return { arming: { ...stallArmingOf(names), mailDisabled, mailMode: mailTurnModeOf(names) }, quietMs: STALL_QUIET_MS, levelSource: 'files' };
    }
  }

  /** The warn latch and the boot trace (§8), for one read that resolved. A read that does not apply warns once per
   *  read state, in its own words, and a read that applies re-arms every latch. The first read that is not
   *  unreadable traces a stored choice that applies, once, so a roll-forward or a restored `coord.db` leaves a line. */
  private stallSettingsNotes(read: StallSettingsRead, parsed: StallSettingsParsed, r: StallResolved): void {
    const states: (readonly [string, string])[] = read.kind === 'absent' ? [['absent', 'no stored choice']]
      : read.kind === 'unreadable' ? [['unreadable', `stored choice unreadable: ${read.detail.slice(0, 200)}`]]
      : [
        ...(parsed.level.kind === 'unreadable' ? [['level', 'stored level unreadable'] as const] : []),
        ...(parsed.quiet.kind === 'unreadable' ? [['quiet', 'stored quiet time unreadable'] as const] : []),
      ];
    if (states.length === 0) this.stallSettingsWarned.clear();
    for (const [state, words] of states) this.stallSettingsWarn(state, words);
    if (this.stallSettingsTraced || read.kind === 'unreadable') return;
    this.stallSettingsTraced = true;
    if (r.chosen === null && r.quietSource !== 'chosen') return;
    const level = r.chosen === null ? STALL_FOLLOW_LABEL : STALL_LEVEL_TEXT[r.chosen].label;
    const quiet = `${r.quietMs / 60_000} min${r.quietSource === 'chosen' ? '' : ' (built-in)'}`;
    console.warn(`ccrc-server: stall-watch level ${level} / quiet time ${quiet} chosen in Settings overrides the box files`);
  }

  /** The latch itself: one line per read state until a read applies again. `stallResolveNow`'s catch never calls it. */
  private stallSettingsWarn(state: string, words: string): void {
    if (this.stallSettingsWarned.has(state)) return;
    this.stallSettingsWarned.add(state);
    console.warn(`ccrc-server: stall-watch settings not applied (${words}) — following the box files and the built-in quiet time`);
  }

  /** The settings view's seam (stall watch settings §9, §10): the last resolution that fell back on a throw, or
   *  `null` once one succeeds. PUBLIC for `registerCoordRoutes`' optional watcher, as `releaseHeldAsk` is. */
  stallFallback(): { readonly at: number; readonly reason: string } | null {
    return this.lastFallback;
  }

  /** One run worker: read, decide, apply — the run verdict first, then its session verdicts in the spec's order
   *  (orphan E, failed, each mail stuck, orphan D). Its throws are the caller's to catch. `quietMs` is the resolved
   *  quiet time (stall watch settings §7), set on the run verdict's input; the session verdicts use fixed constants. */
  private async judgeStall(
    store: CoordStore, subject: StallSubject, sessions: readonly FleetSession[], tick: StallTick,
    arming: StallArming, paused: boolean, now: number, quietMs: number,
  ): Promise<void> {
```

(W11) ≈3878, `judgeStall`'s `StallInput` literal: replace

```ts
      subject, worker, mail: stallRunMail(read.mail, runIds), notices, arming, coordinationPaused: paused,
```

with

```ts
      subject, worker, mail: stallRunMail(read.mail, runIds), notices, arming, quietMs, coordinationPaused: paused,
```

(W12) ≈4542–4546, `sweepMail`'s mode line: replace

```ts
    // The gate's mode comes from this SAME listing (worker stall watch §4.1,
    // `turnidle.ts`). An unlistable registry has already returned above, so a
    // mode is never read from a listing that failed: the strict marker fails
    // shut at no extra cost.
    const mode = mailTurnModeOf(listing);
```

with

```ts
    // The gate's mode comes from this SAME listing (worker stall watch §4.1,
    // `turnidle.ts`), through the one settings resolution the stall sweep also
    // calls (stall watch settings §9): a chosen level can set it, and strict
    // still wins. An unlistable registry has already returned above, so a
    // mode is never read from a listing that failed: the strict marker fails
    // shut at no extra cost. `false` is measured, not assumed: the return
    // above proved `MAIL_DISABLED_MARKER` absent from this listing.
    const mode = this.stallResolveNow(store, listing, false).arming.mailMode;
    // The busy clock (D-4024), on the mode just applied: a move into busy from
    // a known non-busy mode starts it, busy over busy keeps it, and any other
    // mode clears it. The first busy after a start leaves it null.
    if (mode !== 'busy') this.busySince = null;
    else if (this.lastApplied !== null && this.lastApplied !== 'busy') this.busySince = now;
    this.lastApplied = mode;
```

No other file changes. `stall.ts`, `stallsettings.ts` and `store.ts` are the earlier tasks' and are not touched.

- [ ] **Step 5: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/stall-sweep.test.ts | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/mail-sweep.test.ts | grep -E '^ +Tests '
```

Expected (measured): `Tests 117 passed (117)` and `Tests 115 passed (115)`. Before this task the two files had
109 and 104 rows, so this task adds 8 and 11.

- [ ] **Step 6: The mutation table**

Write `$INSTR/mut-task5.json`, then run
`cd "$(git rev-parse --show-toplevel)" && python3 "$INSTR/mutate.py" . "$INSTR/mut-task5.json"`. Each entry replaces one
exact text, runs its suites from `server/`, and restores the file. Afterwards `git status --short` lists exactly this
task's three files, unchanged from Step 5.

```json
[
 {"id": "M2", "edits": [{"file": "server/src/coord/stallsettings.ts", "old": "      mailDisabled: box.mailDisabled,\n", "new": "      mailDisabled: false,\n"}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M3", "edits": [{"file": "server/src/coord/stallsettings.ts", "old": "      mailMode: strict ? 'strict' : run.mailMode,\n", "new": "      mailMode: run.mailMode,\n"}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M4", "edits": [{"file": "server/src/coord/stallsettings.ts", "old": "  if (lastApplied !== null && lastApplied !== 'busy') return { mailMode: 'busy-shadow' };\n", "new": "  if (lastApplied !== 'busy') return { mailMode: 'busy-shadow' };\n"}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M7", "edits": [{"file": "server/src/watch.ts", "old": "    const mode = this.stallResolveNow(store, listing, false).arming.mailMode;\n", "new": "    const mode = mailTurnModeOf(listing);\n"}], "tests": ["test/mail-sweep.test.ts", "test/stall-sweep.test.ts"]},
 {"id": "M8-bound", "edits": [{"file": "server/src/coord/stall.ts", "old": "    if (input.arming.busySince !== undefined) return Math.max(m.stopAt, input.arming.busySince);\n", "new": ""}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M8-subst", "edits": [{"file": "server/src/coord/stallsettings.ts", "old": "  if (lastApplied !== null && lastApplied !== 'busy') return { mailMode: 'busy-shadow' };\n", "new": ""}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M8-chosen-only", "edits": [{"file": "server/src/watch.ts", "old": "      const arming: StallArming = { ...r.arming, ...stallBusyClock(r.arming.mailMode, this.lastApplied, this.busySince) };\n", "new": "      const arming: StallArming = { ...r.arming, ...(r.levelSource === 'files' ? {} : stallBusyClock(r.arming.mailMode, this.lastApplied, this.busySince)) };\n"}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M8a-stall", "edits": [{"file": "server/src/watch.ts", "old": "      const r = this.stallResolveNow(store, names, names.includes(MAIL_DISABLED_MARKER));\n", "new": "      const r = { arming: stallBoxArmingOf(names, names.includes(MAIL_DISABLED_MARKER)), quietMs: STALL_QUIET_MS };\n"}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M8a-mail", "edits": [{"file": "server/src/watch.ts", "old": "    const mode = this.stallResolveNow(store, listing, false).arming.mailMode;\n", "new": "    const mode = this.stallResolveNow(store, listing, true).arming.mailMode;\n"}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M8b-null", "edits": [{"file": "server/src/watch.ts", "old": "    if (listing === null || listing.includes(MAIL_DISABLED_MARKER)) return;\n", "new": "    if (listing === null || listing.includes(MAIL_DISABLED_MARKER)) { this.busySince = null; return; }\n"}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M8b-restart", "edits": [{"file": "server/src/watch.ts", "old": "    else if (this.lastApplied !== null && this.lastApplied !== 'busy') this.busySince = now;\n", "new": "    else if (this.lastApplied !== null) this.busySince = now;\n"}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M8b-keep", "edits": [{"file": "server/src/watch.ts", "old": "    if (mode !== 'busy') this.busySince = null;\n    else if", "new": "    if (mode !== 'busy') { /* kept */ }\n    else if"}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M9c", "edits": [{"file": "server/src/watch.ts", "old": "notices, arming, quietMs, coordinationPaused: paused,\n", "new": "notices, arming, coordinationPaused: paused,\n"}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M12-quiet", "edits": [{"file": "server/src/coord/schema.ts", "old": "VALUES (1, 'follow', NULL, 0);", "new": "VALUES (1, 'follow', 1800000, 0);"}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M12-level", "edits": [{"file": "server/src/coord/schema.ts", "old": "VALUES (1, 'follow', NULL, 0);", "new": "VALUES (1, 'off', NULL, 0);"}], "tests": ["test/stall-sweep.test.ts"]},
 {"id": "M20-try", "edits": [{"file": "server/src/watch.ts", "old": "    } catch (err) {\n      let reason = 'an unreadable fault';\n      try {\n        reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);\n      } catch { /* even reading the error threw: the fixed word stands */ }\n", "new": "    } catch (err) {\n      throw err;\n      let reason = 'an unreadable fault';\n      try {\n        reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);\n      } catch { /* even reading the error threw: the fixed word stands */ }\n"}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M20-latch", "edits": [{"file": "server/src/watch.ts", "old": "      if (this.lastFallback === null) {\n        try {\n          console.warn(`ccrc-server: stall-watch settings not applied (${reason}) — following the box files and the built-in quiet time`);\n        } catch { /* a log line must not stop a sweep */ }\n      }\n", "new": "      this.stallSettingsWarn('fallback', reason);\n"}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M20-reason", "edits": [{"file": "server/src/watch.ts", "old": "      let reason = 'an unreadable fault';\n      try {\n        reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);\n      } catch { /* even reading the error threw: the fixed word stands */ }\n", "new": "      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);\n"}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M20b", "edits": [{"file": "server/src/watch.ts", "old": "      this.lastFallback = null;\n", "new": ""}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M21-every", "edits": [{"file": "server/src/watch.ts", "old": "    if (this.stallSettingsWarned.has(state)) return;\n", "new": ""}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "M21-rearm", "edits": [{"file": "server/src/watch.ts", "old": "    if (states.length === 0) this.stallSettingsWarned.clear();\n", "new": ""}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "T-every", "edits": [{"file": "server/src/watch.ts", "old": "    if (this.stallSettingsTraced || read.kind === 'unreadable') return;\n", "new": "    if (read.kind === 'unreadable') return;\n"}], "tests": ["test/mail-sweep.test.ts"]},
 {"id": "T-follow", "edits": [{"file": "server/src/watch.ts", "old": "    if (r.chosen === null && r.quietSource !== 'chosen') return;\n", "new": ""}], "tests": ["test/mail-sweep.test.ts"]}
]
```

The control is Step 5's green: 117 and 115 passed on the unmutated tree.

| # | Guard | Mutation | Red in | Measured |
|---|---|---|---|---|
| M2 | `mail-disabled` passes through a chosen level | the resolver's chosen arm sets `mailDisabled: false` | stall-sweep | `1 failed \| 116 passed`: `a chosen level keeps mail-disabled … (M2)` |
| M3 | strict keeps the mail gate under a chosen level | `mailMode: run.mailMode` unconditionally | mail-sweep | `1 failed \| 114 passed`: `mail-gate-strict keeps its precedence … (M3)` |
| M4 | at boot the verdicts receive today's exact arming | `stallBusyClock` substitutes while `lastApplied` is `null` | stall-sweep | `2 failed \| 115 passed`: `at boot … (M4)` and D-3798's `… mail-stuck under mail-gate-busy only` |
| M7 | `sweepMail` uses the resolved mode | revert to `mailTurnModeOf(listing)` | mail-sweep; stall-sweep | `9 failed \| 106 passed`: the three M7 rows, then M8b's restart row, M20, M20/M20b, both latch rows and the boot trace; and `3 failed \| 114 passed`: M8a and the alert → all and alert → follow M8 rows |
| M8 | the bound | delete `stallIdleStart`'s `busySince` line (`stall.ts`) | stall-sweep | `3 failed \| 114 passed`: the three M8 raises |
| M8 | the busy-gate substitution | delete `stallBusyClock`'s `busy-shadow` line | stall-sweep | `3 failed \| 114 passed`: the three M8 raises |
| M8 | the grace for every source | grant it only when `levelSource` is not `files` | stall-sweep | `2 failed \| 115 passed`: the Follow raise and the touched-file raise |
| M8a | one resolver, stall side | `sweepStalls` builds its own box arming and the built-in quiet time | stall-sweep | `4 failed \| 113 passed`: M2, M9c, M8a, and the alert → all M8 row |
| M8a | one resolver, mail side | the mail sweep passes `mailDisabled: true` | stall-sweep | `1 failed \| 116 passed`: M8a |
| M8b | a null listing leaves the clock | clear `busySince` on the unlistable or kill-switch return | mail-sweep | `1 failed \| 114 passed`: `the busy clock moves only on an applied mode … (M8b)` |
| M8b | busy over busy keeps it | restart `busySince` whenever `lastApplied` is not `null` | mail-sweep | `1 failed \| 114 passed`: the same row |
| M8b | a non-busy mode clears it | leave `busySince` set after a non-busy mode | mail-sweep | `1 failed \| 114 passed`: `the busy clock restarts on a move back into busy … (M8b)` |
| M9c | `quietMs` reaches the verdict | delete `quietMs` from `judgeStall`'s `StallInput` literal | stall-sweep | `1 failed \| 116 passed`: `a stored quiet time reaches the verdict … (M9c)` |
| M12 | the seed is today's behaviour, by quiet time | seed `quietMs` 1800000 (`schema.ts`) | stall-sweep | `12 failed \| 105 passed`, the M12 row among them |
| M12 | the seed is today's behaviour, by level | seed level `off` | stall-sweep | `107 failed \| 10 passed`, the M12 row among them |
| M20 | `stallResolveNow` never throws | its catch rethrows (the try/catch removed, in effect) | mail-sweep | `2 failed \| 113 passed`: M20, and M20/M20b |
| M20 | the catch never calls the latch | the catch calls `this.stallSettingsWarn('fallback', reason)` | mail-sweep | `1 failed \| 114 passed`: M20, its latch case (`promise rejected "Error: warn sink down"`) |
| M20 | `reason` is composed inside its own `try` | compose it unguarded | mail-sweep | `1 failed \| 114 passed`: M20, its message-getter case (`promise rejected "Error: the message getter throws"`) |
| M20b | the fallback clears | never reset `lastFallback` | mail-sweep | `1 failed \| 114 passed`: `the fallback warns once … (M20, M20b)` |
| M21 | the latch warns once | warn on every read | mail-sweep | `2 failed \| 113 passed`: M21 and the per-state row |
| M21 | the latch re-arms | never clear it | mail-sweep | `1 failed \| 114 passed`: M21 |
| — | the boot trace, once | trace on every read | mail-sweep | `1 failed \| 114 passed`: the boot trace row |
| — | the boot trace, only a choice | trace under Follow with the built-in | mail-sweep | `1 failed \| 114 passed`: the boot trace row |

Every run printed `restored`, and `git status --short` afterwards listed only the three files of Step 2 and Step 4.

- [ ] **Step 7: The regression suites**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in child-reclaim-sweep turnidle single-definition typecheck-tests stall-settings stall-settings-store \
  stall-vocabulary mail-routes worker-skill claims-advisory lifecycle-sweep divergence-sweep stall-session \
  stall-verdict stall-backoff readiness-sweep ledger-sweep push-copy pr-queue-lane deliverability-parity \
  claims-no-hold fleetws asks-routes usage-sweep-lane caps-refresh asks-sweep update-apply-routes claim-sweep \
  hold-gate asks-mint update-catalogue fleet-health name-sweep dialog pr-sweep update-converge update-routes \
  ctx-pressure update-inventory update-auto-dispatch update-projection session-hook; do
  printf '%s: ' "$f"; ./node_modules/.bin/vitest run "test/$f.test.ts" | grep -E '^ +Tests '; done
```

Expected (measured, all green). These are the suites that scan `watch.ts`'s text and every other suite that builds a
`FleetWatcher`:

| Suite | Count |
|---|---|
| `child-reclaim-sweep` | 74 |
| `turnidle` | 54 |
| `single-definition` | 274 |
| `typecheck-tests` | 12 |
| `stall-settings` | 112 |
| `stall-settings-store` | 40 |
| `stall-vocabulary` | 179 |
| `mail-routes` | 59 |
| `worker-skill` | 51 |
| `claims-advisory` | 2 |
| `lifecycle-sweep` | 8 |
| `divergence-sweep` | 43 |
| `stall-session` | 98 |
| `stall-verdict` | 309 |
| `stall-backoff` | 33 |
| `readiness-sweep` | 17 |
| `ledger-sweep` | 20 |
| `push-copy` | 79 |
| `pr-queue-lane` | 18 |
| `deliverability-parity` | 10 |
| `claims-no-hold` | 1 |
| `fleetws` | 54 |
| `asks-routes` | 34 |
| `usage-sweep-lane` | 4 |
| `caps-refresh` | 8 |
| `asks-sweep` | 14 |
| `update-apply-routes` | 53 |
| `claim-sweep` | 14 |
| `hold-gate` | 15 |
| `asks-mint` | 16 |
| `update-catalogue` | 114 |
| `fleet-health` | 26 |
| `name-sweep` | 34 |
| `dialog` | 63 |
| `pr-sweep` | 37 |
| `update-converge` | 85 |
| `update-routes` | 38 |
| `ctx-pressure` | 9 |
| `update-inventory` | 90 |
| `update-auto-dispatch` | 15 |
| `update-projection` | 21 |
| `session-hook` | 335 (2 min 6 s; a known load flake, so re-run it alone if it reds) |

`session-hook`'s README citation instrument
(`-t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'`) gives
`Tests 7 passed | 328 skipped (335)`. Nothing in the README cites the `watch.ts` lines this task moves.

- [ ] **Step 8: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo tsc-clean
```

Expected (measured): `tsc-clean`, with both exits at 0.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add server/src/watch.ts server/test/stall-sweep.test.ts server/test/mail-sweep.test.ts
git commit -m "$(cat <<'MSG'
feat(stall-watch): one never-throwing settings resolution for both sweeps, the busy clock, and the chosen quiet time

Stall watch settings W1 Task 5 (design 2026-10-05 §9). FleetWatcher's
private stallResolveNow is the only reader of the stall-watch settings
row, and both sweeps call it over their own listing. It never throws: on
any fault it answers the files-only expression the sweeps ran before,
with the built-in quiet time, warns once with a bare guarded warn, and
records lastFallback, read through the public stallFallback(). A warn
latch per read state and a one-line boot trace (§8) ride the success
path.

sweepMail applies its mail gate mode from the resolution, then keeps
the busy clock: lastApplied, and busySince when it moves into busy
delivery from a known non-busy mode. A null listing and the mail kill
switch's return write neither field. sweepStalls judges through
stallBusyClock (busy-clock-starts-when-busy-delivery-starts (D-4024))
and threads the resolved quiet time into judgeStall's StallInput.
STALL_SWEEP_MS's comment now names the quiet time, not "a 2 h
threshold".

Rows: stall-sweep M2, M4, M8 (three raises), M8a, M9c and M12;
mail-sweep M3, M7, M8b, M20, M20b and M21, plus the latch states and
the boot trace.
MSG
)"
```

---

### Task 6: The routes: `GET` and `POST /api/coord/stall-watch`, and the censuses

**Model routing:** `sonnet`, effort `high`: transcription of a measured prototype (proto `fa1241e6e`) plus a mutation
table. The view builder's three `try`s and the POST's re-measure are the parts to read twice.

**Files:**
- Create: `server/test/stall-settings-route.test.ts` (both halves, the 409 flow, the key, the conflict re-measure, the
  refusals, the feed, the re-read, and M6, M10, M13, M14, M15, M16b, M17b, M20, M26, M27, M27b, M29).
- Modify: `server/src/coord/routes.ts`:
  - imports: ≈14 `../ccdargv.js` gains `deviceActor`; ≈22 `./store.js` gains `type StallSettingsWrite`; ≈32
    `./rundefs.js` gains `MAIL_DISABLED_MARKER`, followed by two new imports (`./stall.js`, `./stallsettings.js`); ≈44
    the `shared/api.js` type list gains four types;
  - below the caps POST handler (≈2499, `return reply.code(200).send({ ok: true, ...view });`), inside
    `registerCoordRoutes`: the docstring, `stallViewWarned`, `stallViewNote`, `stallFaultReason`, `stallWatchView`,
    `app.get('/api/coord/stall-watch')` and `app.post('/api/coord/stall-watch')`.
- Modify: `server/src/coord/stallsettings.ts` (line hints at proto `65b4c6c84`, since the file is new in this wave):
  ≈147, below `stallUnheldBoxOf`, the new `stallBoxHeld`; ≈251, `resolveStallWatch`'s `held` builds on it.
- Modify: `server/src/auth/gate.ts` ≈8, the module docstring's route numeral (86 → 88).
- Modify: `CLAUDE.md` ≈277 and ≈281, the box-token bullet's session-only sentence. The other `CLAUDE.md` edits are
  Task 7's.
- Modify (tests): `server/test/coord-pause-route.test.ts` (≈208, ≈212, ≈221), `server/test/auth-gate.test.ts` (≈242,
  ≈313, ≈335, ≈451, ≈901, ≈965), `server/test/coordinator-skill.test.ts` (≈533, ≈1586),
  `server/test/worker-skill.test.ts` (≈679), `server/test/reviewer-skill.test.ts` (≈211),
  `server/test/stall-settings.test.ts` (≈23 and EOF; line hints at proto `65b4c6c84`).
- Test: all of the above, plus `server/test/mail-routes.test.ts` and `server/test/box-token-census.test.ts`, which need
  no edit. Task 1 already added `isStallSettingsKebab` to the kebab scan as its thirteenth union, and the census
  harvests `SESSION_ONLY` from `coord-pause-route.test.ts`.

**Interfaces:**
- Consumes (L1, `server/src/coord/stallsettings.ts`, Tasks 1 and 2):
  - `STALL_NOTICE_WINDOW_MS`, `STALL_QUIET_MIN_MS`, `STALL_QUIET_MAX_MS`, `STALL_QUIET_STEP_MS`;
  - `decideStallSettings(body: unknown): StallSettingsDecision`;
  - `parseStallSettings(read: StallSettingsRead): StallSettingsParsed`;
  - `resolveStallWatch(box: StallBoxArming, settings: StallSettingsParsed): StallResolved`;
  - `stallBoxArmingOf(names: readonly string[], mailDisabled: boolean): StallBoxArming`;
  - `stallUnheldBoxOf(names: readonly string[]): StallBoxArming`;
  - `stallLevelOf(a: StallArming): StallLevel | 'custom'`, `stallStages(a: StallArming): StallWatchStages`;
  - `stallNextStep(arming: StallArming, chosen: StallLevel | null): StallNextStep`;
  - `stallFilesExceed(box: StallArming, resolved: StallResolved): boolean`;
  - `stallSettingsAfter(before: StallSettingsRead, patch: StallSettingsPatch, at: number): StallSettingsRead`;
  - `stallWriteEffect(box: StallBoxArming, unheld: StallBoxArming, beforeRead: StallSettingsRead, afterRead: StallSettingsRead): StallMeasuredEffect`;
  - `stallNeedsConfirm(effect: StallWriteEffect): boolean`;
  - `stallEffectKey(effect: StallWriteEffect, updatedAt: number | null): string`;
  - `stallSettingsChange(before: StallSettingsRead, after: StallSettingsRead): string | null`;
  - `stallNoticeCounts(rows: readonly StallObservationRow[]): StallNoticeCount[]`.
- Consumes: `STALL_QUIET_MS` (`server/src/coord/stall.ts`); `MAIL_DISABLED_MARKER` (`server/src/coord/rundefs.ts`);
  `deviceActor(device: string | null): string` (`server/src/ccdargv.ts` ≈195).
- Consumes (Task 4, `CoordStore`): `stallSettings(): StallSettingsRead` (never throws);
  `setStallSettings(patch: StallSettingsPatch, at: number, expected: StallSettingsRead): StallSettingsWrite`;
  `stallObservationsSince(since: number): StallObservationsRead`; and `export type StallSettingsWrite`.
- Consumes (Task 5, `FleetWatcher`): `stallFallback(): { readonly at: number; readonly reason: string } | null`, through
  `registerCoordRoutes`' existing optional `watcher?: FleetWatcher` parameter.
- Consumes (L0, `shared/api.ts`, Task 1): `StallWatchView`, `StallWatchEffective`, `StallWriteEffect`,
  `StallConfirmRequired`.
- Produces (L1, `server/src/coord/stallsettings.ts`):
  `export function stallBoxHeld(box: StallBoxArming): StallHeld`. It answers the files-only reading's held flags,
  equal to `resolveStallWatch(box, <follow>).held` for every box, with `wave2HeldByStrict` always `false`.
- Produces (L4, inside `registerCoordRoutes`, `server/src/coord/routes.ts`):
  - `GET /api/coord/stall-watch` → `200 { ok: true } & StallWatchView` or `501 { ok: false, error: 'not-configured' }`.
  - `POST /api/coord/stall-watch`, body `StallWatchRequest` → `200 { ok: true } & StallWatchView`;
    `400 { ok: false, error: 'bad-request', detail: string }`; `409 StallConfirmRequired`; Fastify's `500` on an
    unreadable pre-read or a second conflict, with nothing written; `501 not-configured`.
  - `const stallWatchView: (store: CoordStore, names: readonly string[] | null, now: number, watcherFallback: { readonly at: number; readonly reason: string } | null) => StallWatchView`.
  - `const stallViewNote: (part: string, fault: string | null) => void`. It prints
    `ccrc-server: stall-watch view: <part> failed (<fault>)` once per standing fault per part, for the parts
    `the resolution`, `a view reader` and `the notice counts`, and re-arms when that part next succeeds.
  - `const stallFaultReason: (err: unknown) => string`. It answers the message cut to 200 characters, or
    `'an unreadable fault'`.
  - The feed row: `{ kind: 'coord', sessionId: '', title: 'stall watch changed', body: '<change>; by <actor>', runId: null }`,
    where `<actor>` is `deviceActor(sessionAuth(req).device)` when `deps.cfg.authEnabled`, and `flag-off` otherwise.

**Residue settled here (§20, and one item §20 does not list):**
- *What `effective` carries when `stallLevelOf` or `stallStages` throws in the second `try`:* `{ measured: false }`.
  The second `try` assigns `effective` twice, first the base literal and then the literal with `next` and
  `filesExceed`. A throw in `stallNextStep` or `stallFilesExceed` keeps the base. A throw in `stallStages`,
  `stallLevelOf` or `stallBoxHeld` keeps the initial `{ measured: false }`. Neither claims a `fallback` or sends a 500,
  and the log names the fault.
- *Whether the builder's own catch warns:* yes, once per standing fault per part (`stallViewNote`), re-armed when that
  part next succeeds, inside its own `try`. A count read that answers `{ ok: false, detail }` warns through the same
  latch.
- *`held` and `source` of the files-only reading:* `source: 'files'`. `held` is the new L1 `stallBoxHeld(box)`, which
  the resolver now builds its own `held` from, so the files-only flags are exactly what Follow reports. `level` and
  `files` are both `stallLevelOf(box)`, `next` is `stallNextStep(box, null)`, and `filesExceed` is `false`.
- *The quiet time with an unlistable registry* (decided here; §10 is silent): the resolution is still taken, over the
  empty listing's box, for the quiet time alone. `resolveStallWatch`'s quiet half reads no box flag (§6.2). So a stored
  3 h reads `effectiveMs: 3 h, source: 'chosen'` beside `effective: { measured: false }`.
- *A remote `readdir` that alternates between `null` and a listing:* no change. Each 409 carries the effect it
  measured, so the sheet shows the unknown line or the stages, never a stale one.

- [ ] **Step 1: Re-anchor, and re-measure the route numerals**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -cF '    return reply.code(200).send({ ok: true, ...view });' server/src/coord/routes.ts
grep -cF "import { CCD_ARGV, RECLAIM_PAUSE_CAP, ROUTE_CAP, capSupported, verbSupported, sweepDec } from '../ccdargv.js';" server/src/coord/routes.ts
grep -cF "import { toRunSummary, type ClaimEndResult, type CoordStore } from './store.js';" server/src/coord/routes.ts
grep -cF "import { queueSystemMail } from './rundefs.js';" server/src/coord/routes.ts
grep -cF '  type FailureKind, type RouteField, type RunRouteBody, type RouteMode,' server/src/coord/routes.ts
grep -cF "  return { ...stallBoxArmingOf(names.filter((n) => mailTurnModeOf([n]) !== 'strict'), false), disabled: false };" server/src/coord/stallsettings.ts
grep -cF '    held: { watchOff: box.disabled, mailOff: box.mailDisabled === true, gateStrict: strict, wave2HeldByStrict: run !== null && run.w2Live && strict },' server/src/coord/stallsettings.ts
grep -cF ' * THE GATE. One `onRequest` hook stands in front of all 86 routes, the static' server/src/auth/gate.ts
grep -cF "    expect(scanRoutes('coord/routes.ts').length).toBe(31);" server/test/auth-gate.test.ts
grep -cF '    expect(ROUTES.length).toBe(89);' server/test/auth-gate.test.ts
grep -cF "      'POST /api/coord/reclaim-pause'," server/test/auth-gate.test.ts
grep -cF '    // 89 scanned + the static wildcard when the bundle is built.' server/test/auth-gate.test.ts
grep -cF '    // THE PROPERTY, in one loop over all 86 HTTP routes, with THREE probes each:' server/test/auth-gate.test.ts
grep -cF 'the assertion that covers all 86 HTTP routes, not the 32 exempt.' server/test/auth-gate.test.ts
grep -cF "  const SESSION_ONLY = new Set(['/api/coord/caps', '/api/coord/reclaim-pause']);" server/test/coord-pause-route.test.ts
grep -cF "   *  operator's act from the phone, not a machine lane's." server/test/coord-pause-route.test.ts
grep -cF '   *  kickoff` is the natural next member — SESSION_ONLY already holds two' server/test/coord-pause-route.test.ts
grep -cF "      'POST /api/coord/reclaim-pause'," server/test/coordinator-skill.test.ts
grep -cF "    expect(allSkillText).not.toContain('reclaim-pause');" server/test/coordinator-skill.test.ts
grep -cF "  it('never names the reclaim switch — neither the route nor the bare ccd verb', () => {" server/test/worker-skill.test.ts server/test/reviewer-skill.test.ts
grep -cF '  stallBusyClock,' server/test/stall-settings.test.ts
grep -cF '  `POST /api/coord/caps` (wave 6) and `POST /api/coord/reclaim-pause` (child-reclamation wave 4) are' CLAUDE.md
grep -cF "  that one file is invisible to the set that pins the doors. The other two are in that file's \`SESSION_ONLY\`" CLAUDE.md
grep -c "app\.\(get\|post\)('" server/src/coord/routes.ts
cd server && ./node_modules/.bin/vitest run test/auth-gate.test.ts | grep -E '^ +Tests '
```

Expected (measured on the prototype's parent, `65b4c6c84`): `1` for every `grep -cF` (the worker and reviewer line
prints `:1` for each file); `31` registrations in `coord/routes.ts`; and `Tests 158 passed (158)`, which proves the
pins read 31 and 89, and the needle numerals 86, 86, 89 and `gate.ts`'s 86. If another branch's route moved any of
them, every numeral this task writes moves by the same amount: 31 → 33, 89 → 91, 86 → 88 at three sites, 89 → 91 at
≈451. The 32 exempt stays.

- [ ] **Step 2: Write the failing tests**

(a) Create `server/test/stall-settings-route.test.ts`, complete:

```ts
/**
 * STALL WATCH SETTINGS, the routes (design 2026-10-05 §10, §11, §14, §15, §17): `GET` and `POST
 * /api/coord/stall-watch`, registered in `coord/routes.ts` beside the caps dial.
 *
 * The routes are registered on a bare Fastify, the `archive-coord-handle.test.ts` idiom, so a row can hand
 * `registerCoordRoutes` its own `sessionAuth` (the actor when the gate is armed) and its own watcher (the reported
 * fallback). `resolveStallWatch`, `parseStallSettings`, `stallNextStep` and `stallNoticeCounts` are mocked to pass
 * straight through until a row switches one on to really throw (M20, M17b).
 *
 * No marker name is spelled here: the lane's markers come from `STALL_MARKERS`, `mail-disabled` from its definer.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Deps } from '../src/server.js';
import { registerCoordRoutes } from '../src/coord/routes.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import type { GateDecision } from '../src/auth/gate.js';
import type { FleetWatcher } from '../src/watch.js';
import { STALL_FOLLOW_LABEL, STALL_LEVEL_TEXT } from '../../shared/api.js';
import type { StallWatchView, StallWriteEffect } from '../../shared/api.js';
import {
  STALL_NOTICE_WINDOW_MS, STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS, STALL_QUIET_STEP_MS, stallEffectKey,
} from '../src/coord/stallsettings.js';
import type { StallSettingsRead } from '../src/coord/stallsettings.js';
import { STALL_MARKERS, STALL_QUIET_MS, stallDetail } from '../src/coord/stall.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const settingsFault = vi.hoisted(() => ({
  resolve: null as Error | null, parse: null as Error | null, next: null as Error | null, counts: null as Error | null,
}));
vi.mock('../src/coord/stallsettings.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/coord/stallsettings.js')>();
  return {
    ...real,
    resolveStallWatch: (...a: Parameters<typeof real.resolveStallWatch>): ReturnType<typeof real.resolveStallWatch> => {
      if (settingsFault.resolve !== null) throw settingsFault.resolve;
      return real.resolveStallWatch(...a);
    },
    parseStallSettings: (...a: Parameters<typeof real.parseStallSettings>): ReturnType<typeof real.parseStallSettings> => {
      if (settingsFault.parse !== null) throw settingsFault.parse;
      return real.parseStallSettings(...a);
    },
    stallNextStep: (...a: Parameters<typeof real.stallNextStep>): ReturnType<typeof real.stallNextStep> => {
      if (settingsFault.next !== null) throw settingsFault.next;
      return real.stallNextStep(...a);
    },
    stallNoticeCounts: (...a: Parameters<typeof real.stallNoticeCounts>): ReturnType<typeof real.stallNoticeCounts> => {
      if (settingsFault.counts !== null) throw settingsFault.counts;
      return real.stallNoticeCounts(...a);
    },
  };
});

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

const [, LIVE, ESCALATE, W2LIVE] = STALL_MARKERS as [string, string, string, string];
const MIN = 60_000;
const H = 3_600_000;

const apps: FastifyInstance[] = [];
afterEach(async () => {
  settingsFault.resolve = null; settingsFault.parse = null; settingsFault.next = null; settingsFault.counts = null;
  vi.restoreAllMocks();
  while (apps.length) await apps.pop()!.close();
});

interface Setup {
  /** The registry listing: names planted as files, or `null` for a registry that cannot be listed. */
  names?: readonly string[] | null;
  authEnabled?: boolean;
  device?: string | null;
  /** What the watcher's `stallFallback()` answers; `undefined` registers no watcher at all. */
  watcherFallback?: { readonly at: number; readonly reason: string } | null;
  coord?: boolean;
}
const setup = async (o: Setup = {}) => {
  const home = mkTmp('ccrc-stall-route-');
  const reg = path.join(home, '.cc-sessions');
  if (o.names !== null) {
    mkdirSync(reg, { recursive: true });
    for (const n of o.names ?? []) writeFileSync(path.join(reg, n), '');
  }
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const base = testDeps(home);
  const deps: Deps = { ...base, cfg: { ...base.cfg, authEnabled: o.authEnabled ?? false }, notifyLog,
    ...(o.coord === false ? {} : { coord }) };
  const sessionAuth = (): GateDecision => ({ allow: true, verdict: 'ok', reason: 'session', device: o.device ?? null });
  const watcher = o.watcherFallback === undefined ? undefined
    : ({ stallFallback: () => o.watcherFallback } as unknown as FleetWatcher);
  const app = Fastify();
  registerCoordRoutes(app, deps, new Bus(), sessionAuth,
    { tmux: deps.tmux, queue: deps.queue, readAsk: async () => null }, watcher);
  apps.push(app);
  return { app, coord, db, notifyLog };
};

const getView = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/coord/stall-watch' });
const post = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/coord/stall-watch', payload: payload as Record<string, unknown> });
/** A direct store write, for a row's starting state: the store validates nothing, so this is the fixture's door. */
const store = (coord: CoordStore, level: string, quietMs: number | null = null, at = 1_790_000_000_000): void => {
  const w = coord.setStallSettings({ level: level as 'follow',
    quiet: quietMs === null ? { kind: 'default' } : { kind: 'set', ms: quietMs } }, at, coord.stallSettings());
  expect(w.kind).toBe('written');
};
const storedLevel = (coord: CoordStore): unknown => {
  const r = coord.stallSettings();
  return r.kind === 'row' ? r.row.level : r.kind;
};
const STAGES_OFF = { runs: true, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false };
const HELD_NONE = { watchOff: false, mailOff: false, gateStrict: false, wave2HeldByStrict: false };
const QUIET_BOUNDS = { builtInMs: STALL_QUIET_MS, minMs: STALL_QUIET_MIN_MS, maxMs: STALL_QUIET_MAX_MS, stepMs: STALL_QUIET_STEP_MS };

describe('GET /api/coord/stall-watch', () => {
  it('answers the whole view on a fresh box: Follow, the built-in quiet time, the files reading Log only', async () => {
    const { app } = await setup();
    const t0 = Date.now();
    const res = await getView(app);
    const t1 = Date.now();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: true } & StallWatchView;
    expect(body).toEqual({
      ok: true,
      chosen: { level: 'follow', quietMs: 'default', updatedAt: 0, stored: 'row' },
      effective: { measured: true, level: 'log', files: 'log', source: 'files', stages: STAGES_OFF, held: HELD_NONE,
        next: { kind: 'step', level: 'check', waitsOn: ['checks'] }, filesExceed: false },
      quiet: { effectiveMs: STALL_QUIET_MS, ...QUIET_BOUNDS, source: 'default' },
      notices: { ok: true, since: expect.any(Number), windowMs: STALL_NOTICE_WINDOW_MS, counts: [
        { row: 'checks', sent: 0, shadow: 0 }, { row: 'wakes', sent: 0, shadow: 0 },
        { row: 'reports', sent: 0, shadow: 0 }, { row: 'pushes', sent: 0, shadow: 0 },
      ] },
      fallback: null,
    });
    if (!body.notices.ok) throw new Error('unreachable');
    expect(body.notices.since).toBeGreaterThanOrEqual(t0 - STALL_NOTICE_WINDOW_MS);
    expect(body.notices.since).toBeLessThanOrEqual(t1 - STALL_NOTICE_WINDOW_MS);
  });

  it('answers 501 not-configured, on both verbs, on a box with no coordination database', async () => {
    const { app } = await setup({ coord: false });
    for (const res of [await getView(app), await post(app, { level: 'off' })]) {
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
    }
  });

  it('M6: a registry that cannot be listed answers 200 with effective unmeasured, never off, and the chosen values still shown', async () => {
    const { app, coord } = await setup({ names: null });
    store(coord, 'check', 3 * H);
    const body = (await getView(app)).json() as StallWatchView;
    expect(body.effective).toEqual({ measured: false });
    expect(body.chosen).toEqual({ level: 'check', quietMs: 3 * H, updatedAt: 1_790_000_000_000, stored: 'row' });
    expect(body.quiet).toEqual({ effectiveMs: 3 * H, ...QUIET_BOUNDS, source: 'chosen' });
    expect(body.fallback).toBeNull();
  });

  it('an absent row and an unreadable row are told apart, never sent as follow or default, and both answer 200', async () => {
    const a = await setup();
    a.db.prepare('DELETE FROM stall_settings WHERE id = 1').run();
    const absent = await getView(a.app);
    expect(absent.statusCode).toBe(200);
    expect((absent.json() as StallWatchView).chosen)
      .toEqual({ level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'absent' });
    const u = await setup();
    u.db.prepare('DROP TABLE stall_settings').run();
    const unreadable = await getView(u.app);
    expect(unreadable.statusCode).toBe(200);
    const v = unreadable.json() as StallWatchView;
    expect(v.chosen).toEqual({ level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'unreadable' });
    expect(v.fallback, 'an unreadable row is not a fallback: the resolution did not throw').toBeNull();
  });

  it('a chosen level reads as chosen, with the files reading beside it, and the files-exceed reading', async () => {
    const { app, coord } = await setup({ names: [LIVE, ESCALATE] });
    store(coord, 'check');
    const v = (await getView(app)).json() as StallWatchView;
    expect(v.effective).toEqual({ measured: true, level: 'check', files: 'alert', source: 'chosen',
      stages: { ...STAGES_OFF, checks: true, busyGate: true }, held: HELD_NONE,
      next: { kind: 'step', level: 'alert', waitsOn: ['alerts'] }, filesExceed: true });
  });

  it('counts the window\'s observations by role, live and shadow apart', async () => {
    const { app, coord } = await setup();
    const r = coord.openRun({ program: 'p', title: 'P', project: 'demo', wave: 1, waveOf: 2, claimedBy: 'demo-coordinator' }) as
      { id: number };
    coord.markDispatched(r.id, 'demo-worker', 'ws', 'ws/ws', false);
    expect(coord.advance(r.id, 'dispatched', 'test').ok).toBe(true);
    expect(coord.insertStallObservation(r.id, stallDetail('live', 'quiet', 1, 0), Date.now()).recorded).toBe(true);
    expect(coord.insertStallObservation(r.id, stallDetail('shadow', 'quiet', 2, 0), Date.now()).recorded).toBe(true);
    const v = (await getView(app)).json() as StallWatchView;
    expect(v.notices).toMatchObject({ ok: true, counts: [
      { row: 'checks', sent: 1, shadow: 0 }, { row: 'wakes', sent: 0, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 1 }, { row: 'pushes', sent: 0, shadow: 0 },
    ] });
  });

  it('M17b: a throw from L1 counting answers notices {ok:false}, never a 500, and the rest of the view stands', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = await setup();
    settingsFault.counts = new Error('count bug');
    const res = await getView(app);
    expect(res.statusCode).toBe(200);
    const v = res.json() as StallWatchView;
    expect(v.notices).toEqual({ ok: false });
    expect(v.effective).toMatchObject({ measured: true, level: 'log' });
    expect(warn.mock.calls.flat().join(' ')).toContain('count bug');
  });

  it('M20: a resolver that really throws for a chosen row answers 200 with the builder\'s own fallback, the files reading and the built-in quiet time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord } = await setup({ names: [LIVE] });
    store(coord, 'deliver', 30 * MIN);
    settingsFault.resolve = new Error('resolver bug');
    const t0 = Date.now();
    const res = await getView(app);
    expect(res.statusCode).toBe(200);
    const v = res.json() as StallWatchView;
    expect(v.fallback).toEqual({ at: expect.any(Number), reason: 'resolver bug' });
    expect(v.fallback!.at).toBeGreaterThanOrEqual(t0);
    expect(v.effective).toEqual({ measured: true, level: 'check', files: 'check', source: 'files',
      stages: { ...STAGES_OFF, checks: true }, held: HELD_NONE,
      next: { kind: 'step', level: 'alert', waitsOn: ['alerts'] }, filesExceed: false });
    expect(v.quiet).toEqual({ effectiveMs: STALL_QUIET_MS, ...QUIET_BOUNDS, source: 'default' });
    expect(v.chosen, 'chosen comes from the builder\'s own parse, which returned')
      .toEqual({ level: 'deliver', quietMs: 30 * MIN, updatedAt: 1_790_000_000_000, stored: 'row' });
    expect(warn.mock.calls.flat().join(' ')).toContain('resolver bug');
  });

  it('M20: the view warns once for a standing fault, and again after a resolution that succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = await setup();
    const lines = (): number => warn.mock.calls.flat().filter((l) => String(l).includes('resolver bug')).length;
    settingsFault.resolve = new Error('resolver bug');
    await getView(app); await getView(app); await getView(app);
    expect(lines()).toBe(1);
    settingsFault.resolve = null;
    await getView(app);
    settingsFault.resolve = new Error('resolver bug');
    await getView(app);
    expect(lines()).toBe(2);
  });

  it('M20: a parse that throws reports chosen unreadable, with a fallback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord } = await setup();
    store(coord, 'alert');
    settingsFault.parse = new Error('parse bug');
    const v = (await getView(app)).json() as StallWatchView;
    expect(v.chosen).toEqual({ level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'unreadable' });
    expect(v.fallback).toEqual({ at: expect.any(Number), reason: 'parse bug' });
    expect(v.effective).toMatchObject({ measured: true, level: 'log', source: 'files' });
  });

  it('M20: a watcher fallback is reported even when the builder\'s own resolution succeeded, with the built-in quiet time', async () => {
    const fb = { at: 1_790_000_000_123, reason: 'the sweep fell back' };
    const { app, coord } = await setup({ names: [LIVE], watcherFallback: fb });
    store(coord, 'alert', 30 * MIN);
    const v = (await getView(app)).json() as StallWatchView;
    expect(v.fallback).toEqual(fb);
    expect(v.quiet).toEqual({ effectiveMs: STALL_QUIET_MS, ...QUIET_BOUNDS, source: 'default' });
    expect(v.effective).toMatchObject({ measured: true, level: 'check', files: 'check', source: 'files', filesExceed: false });
    expect(v.chosen).toMatchObject({ level: 'alert', quietMs: 30 * MIN, stored: 'row' });
  });

  it('M20: a watcher whose stallFallback() reads null reports no fallback', async () => {
    const { app } = await setup({ watcherFallback: null });
    expect(((await getView(app)).json() as StallWatchView).fallback).toBeNull();
  });

  it('M20: a throwing view-only reader answers 200 with no fallback, and next and filesExceed left out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord } = await setup();
    store(coord, 'check');
    settingsFault.next = new Error('next bug');
    const res = await getView(app);
    expect(res.statusCode).toBe(200);
    const v = res.json() as StallWatchView;
    expect(v.fallback).toBeNull();
    expect(v.effective).toEqual({ measured: true, level: 'check', files: 'log', source: 'chosen',
      stages: { ...STAGES_OFF, checks: true, busyGate: true }, held: HELD_NONE });
    expect(v.quiet.source).toBe('default');
    expect(warn.mock.calls.flat().join(' ')).toContain('next bug');
  });
});

describe('POST /api/coord/stall-watch', () => {
  it('a write that needs no confirm is written at once, and the reply is the stored view', async () => {
    const { app, coord } = await setup();
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(200);
    const v = res.json() as { ok: true } & StallWatchView;
    expect(v.ok).toBe(true);
    expect(v.chosen).toMatchObject({ level: 'off', quietMs: 'default', stored: 'row' });
    expect(v.effective).toMatchObject({ measured: true, level: 'off', source: 'chosen' });
    expect(storedLevel(coord)).toBe('off');
  });

  it('M26: a write that turns a stage on answers 409 confirm-required with the effect and its key, and writes nothing', async () => {
    const { app, coord } = await setup();
    const before = coord.stallSettings();
    const res = await post(app, { level: 'check' });
    expect(res.statusCode).toBe(409);
    const b = res.json() as { ok: false; error: string; effect: StallWriteEffect; effectKey: string };
    expect(b.ok).toBe(false);
    expect(b.error).toBe('confirm-required');
    expect(b.effect).toMatchObject({ measured: true, turnsOn: ['checks', 'busyGate'], turnsOff: [], leavesWave2: false });
    expect(b.effectKey).toMatch(/^[0-9a-f]{8}$/);
    expect(b.effectKey, 'the key is the digest of the effect and the before-row\'s updatedAt').toBe(stallEffectKey(b.effect, 0));
    expect(coord.stallSettings()).toEqual(before);
    expect(coord.feedEvents(10)).toEqual([]);
    const ok = await post(app, { level: 'check', confirm: b.effectKey });
    expect(ok.statusCode).toBe(200);
    expect(storedLevel(coord)).toBe('check');
  });

  it('M26: leaving the further checks, and a lowered quiet time, each answer 409 and write nothing', async () => {
    const { app, coord } = await setup();
    store(coord, 'all');
    const before = coord.stallSettings();
    const leaves = await post(app, { level: 'deliver' });
    expect(leaves.statusCode).toBe(409);
    expect(leaves.json().effect).toMatchObject({ leavesWave2: true, turnsOn: [] });
    const lowered = await post(app, { quietMs: 30 * MIN });
    expect(lowered.statusCode).toBe(409);
    expect(lowered.json().effect).toMatchObject({ quietLowered: true, quietMs: { before: STALL_QUIET_MS, after: 30 * MIN } });
    expect(coord.stallSettings()).toEqual(before);
  });

  it('M6 / M26: with the registry unlistable every write answers 409 with the unmeasured effect, and its key writes', async () => {
    const { app, coord } = await setup({ names: null });
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(409);
    expect(res.json().effect).toEqual({ measured: false });
    expect(storedLevel(coord)).toBe('follow');
    const ok = await post(app, { level: 'off', confirm: res.json().effectKey });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as StallWatchView).effective).toEqual({ measured: false });
    expect(storedLevel(coord)).toBe('off');
  });

  it('M27: a key that does not match answers 409 again and writes nothing', async () => {
    const { app, coord } = await setup();
    const first = await post(app, { level: 'all' });
    expect(first.statusCode).toBe(409);
    const again = await post(app, { level: 'all', confirm: 'deadbeef' });
    expect(again.statusCode).toBe(409);
    expect(again.json().effectKey).toBe(first.json().effectKey);
    expect(storedLevel(coord)).toBe('follow');
  });

  it('M27: another page\'s write between the 409 and the re-POST makes the old key stale, even when the effect reads the same', async () => {
    const { app, coord } = await setup();
    const sheet = await post(app, { level: 'all' });
    expect(sheet.statusCode).toBe(409);
    // Another page writes Off, then Follow: the row reads as it did, but its updatedAt moved.
    expect((await post(app, { level: 'off' })).statusCode).toBe(200);
    expect((await post(app, { level: 'follow' })).statusCode).toBe(200);
    const stale = await post(app, { level: 'all', confirm: sheet.json().effectKey });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().effect, 'the premise: the effect itself is unchanged').toEqual(sheet.json().effect);
    expect(stale.json().effectKey).not.toBe(sheet.json().effectKey);
    expect(storedLevel(coord)).toBe('follow');
    const fresh = await post(app, { level: 'all', confirm: stale.json().effectKey });
    expect(fresh.statusCode).toBe(200);
    expect(storedLevel(coord)).toBe('all');
  });

  it('M10: the stored value is the sent value, at both bounds, never clamped', async () => {
    const { app, coord } = await setup();
    expect((await post(app, { quietMs: STALL_QUIET_MAX_MS })).statusCode).toBe(200);
    expect(coord.stallSettings()).toMatchObject({ kind: 'row', row: { quietMs: BigInt(STALL_QUIET_MAX_MS) } });
    const low = await post(app, { quietMs: STALL_QUIET_MIN_MS });
    expect(low.statusCode).toBe(409);
    expect((await post(app, { quietMs: STALL_QUIET_MIN_MS, confirm: low.json().effectKey })).statusCode).toBe(200);
    expect(coord.stallSettings()).toMatchObject({ kind: 'row', row: { quietMs: BigInt(STALL_QUIET_MIN_MS) } });
    expect((await post(app, { quietMs: 'default' })).statusCode).toBe(200);
    expect(coord.stallSettings()).toMatchObject({ kind: 'row', row: { quietMs: null } });
  });

  it('M14: refuses with 400 and the detail, writes nothing and records nothing', async () => {
    const { app, coord } = await setup();
    const before = coord.stallSettings();
    const cases: [unknown, string][] = [
      [{ level: 'off', bogus: 1 }, 'unknown key bogus: a write names only level, quietMs and confirm'],
      [{}, 'at least one of level or quietMs must be given'],
      [[], 'body must be an object'],
      [{ level: 'constructor' }, 'level must be follow or one of off, log, check, alert, deliver, all'],
      [{ quietMs: 45 * MIN },
        "quietMs must be 'default' or a whole number of milliseconds from 1800000 to 43200000 in steps of 1800000"],
      [{ level: 'off', confirm: 7 }, 'confirm must be a string'],
    ];
    for (const [payload, detail] of cases) {
      const res = await post(app, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request', detail });
    }
    expect(coord.stallSettings()).toEqual(before);
    expect(coord.feedEvents(10)).toEqual([]);
  });

  it('M27b: a pre-read that answers unreadable is refused with a 500, and nothing is written', async () => {
    const { app, coord } = await setup();
    const before = coord.stallSettings();
    vi.spyOn(coord, 'stallSettings').mockReturnValueOnce({ kind: 'unreadable', detail: 'disk gone' });
    const write = vi.spyOn(coord, 'setStallSettings');
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(500);
    expect(write).not.toHaveBeenCalled();
    expect(coord.stallSettings()).toEqual(before);
  });

  /** Make the store's reads answer `fakes[n]` on the listed call numbers, and the real read otherwise. The store's
   *  own write reads through `this.stallSettings()`, so the spy reaches it too. */
  const fakeReads = (coord: CoordStore, fakes: Record<number, StallSettingsRead>): void => {
    const real = coord.stallSettings.bind(coord);
    let n = 0;
    vi.spyOn(coord, 'stallSettings').mockImplementation(() => { n += 1; return fakes[n] ?? real(); });
  };
  const fakeRow = (level: string, updatedAt: bigint): StallSettingsRead =>
    ({ kind: 'row', row: { level, quietMs: null, updatedAt } });

  it('M27b: a conflict whose fresh effect needs a confirm answers 409 with that effect and its key', async () => {
    const { app, coord } = await setup();
    // The route reads Everything (so writing Everything is a no-op that needs no confirm); the store finds Follow.
    fakeReads(coord, { 1: fakeRow('all', 5n) });
    const res = await post(app, { level: 'all' });
    expect(res.statusCode).toBe(409);
    const b = res.json() as { effect: StallWriteEffect; effectKey: string };
    expect(b.effect).toMatchObject({ measured: true, turnsOn: ['checks', 'alerts', 'busyDelivery', 'busyGate', 'wave2'] });
    expect(b.effectKey).toBe(stallEffectKey(b.effect, 0));
    vi.restoreAllMocks();
    expect(storedLevel(coord)).toBe('follow');
  });

  it('M27b: a conflict whose fresh effect needs none is written over the row the store found', async () => {
    const { app, coord } = await setup();
    store(coord, 'check');
    fakeReads(coord, { 1: fakeRow('check', 5n) });
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(200);
    vi.restoreAllMocks();
    expect(storedLevel(coord)).toBe('off');
  });

  it('M27b: a second conflict is refused with a 500, and nothing is written', async () => {
    const { app, coord } = await setup();
    store(coord, 'check');
    const before = coord.stallSettings();
    // Call 1 is the route's read, call 2 the store's first write's read (the real row: a conflict), call 3 the
    // store's second write's read (another stranger: a second conflict).
    fakeReads(coord, { 1: fakeRow('check', 5n), 3: fakeRow('check', 6n) });
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(coord.stallSettings()).toEqual(before);
  });

  it('M13: the reply re-reads the store, never echoing the body', async () => {
    const { app, coord, db } = await setup();
    const realWrite = coord.setStallSettings.bind(coord);
    vi.spyOn(coord, 'setStallSettings').mockImplementation((...a) => {
      const w = realWrite(...a);
      // A second write lands between this write and the reply.
      db.prepare("UPDATE stall_settings SET level = 'log' WHERE id = 1").run();
      return w;
    });
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as StallWatchView).chosen.level).toBe('log');
  });
});

describe('M15: the feed event, on a change only, with its actor, flushed in finally', () => {
  it('names what changed and ends "by flag-off" when the gate is unarmed', async () => {
    const { app, coord } = await setup();
    expect((await post(app, { level: 'off' })).statusCode).toBe(200);
    const ev = coord.feedEvents(10).at(-1)!;
    expect(ev.kind).toBe('coord');
    expect(ev.title).toBe('stall watch changed');
    expect(ev.body).toBe(`level: ${STALL_FOLLOW_LABEL} → ${STALL_LEVEL_TEXT.off.label}; by flag-off`);
  });

  it('ends "by device:<label>" when the gate is armed', async () => {
    const { app, coord } = await setup({ authEnabled: true, device: 'probe-browser' });
    expect((await post(app, { quietMs: 3 * H })).statusCode).toBe(200);
    expect(coord.feedEvents(10).at(-1)!.body).toBe('quiet time: 2 h (built-in) → 3 h; by device:probe-browser');
  });

  it('the same body POSTed twice records one feed row: a no-op records nothing', async () => {
    const { app, coord } = await setup();
    expect((await post(app, { level: 'off' })).statusCode).toBe(200);
    expect((await post(app, { level: 'off' })).statusCode).toBe(200);
    expect(coord.feedEvents(10).length).toBe(1);
  });

  it('a throwing feed archive still writes the setting, warns, and still flushes the minted seq', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, coord, db, notifyLog } = await setup();
    const flush = vi.spyOn(notifyLog, 'flush');
    db.prepare('DROP TABLE feed_events').run();
    const res = await post(app, { level: 'off' });
    expect(res.statusCode).toBe(200);
    expect(storedLevel(coord)).toBe('off');
    expect(warn.mock.calls.flat().join(' '), 'the premise: the archive threw').toContain('recordFeedEvent failed');
    expect(flush, 'the archive throw skipped the flush').toHaveBeenCalled();
  });
});

// ── source scans ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Blank out comments and string/template bodies, preserving byte positions and newlines:
 *  `coord-caps-route.test.ts`'s helper, copied unchanged, so a call mentioned only in prose is invisible. */
function blankCommentsAndStrings(text: string): string {
  const out = text.split('');
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const j = text.indexOf('\n', i);
      const e = j < 0 ? text.length : j;
      blank(i, e); i = e;
    } else if (c === '/' && d === '*') {
      const j = text.indexOf('*/', i + 2);
      const e = j < 0 ? text.length : j + 2;
      blank(i, e); i = e;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === c) break;
        else j++;
      }
      blank(i + 1, Math.min(j, text.length));
      i = Math.min(j + 1, text.length);
    } else i++;
  }
  return out.join('');
}
/** `auth-gate.test.ts`'s comment strip, unchanged. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });

const ROUTES_SRC = (): string => readFileSync(path.join(srcRoot, 'coord', 'routes.ts'), 'utf8');
const POST_DECL = "app.post('/api/coord/stall-watch'";
const DOC_ANCHOR = '/** `GET`/`POST /api/coord/stall-watch`';
/** From `from` to the next route registration after `decl`. Fails loudly on a missing anchor. */
const sliceTo = (raw: string, from: number, decl: string): string => {
  const at = raw.indexOf(decl);
  expect(at, `${decl} is gone — this scan is over nothing`).toBeGreaterThan(-1);
  expect(from, 'the slice starts after the registration it must cover').toBeLessThanOrEqual(at);
  const next = /app\.(?:get|post)\('/.exec(raw.slice(at + decl.length));
  return raw.slice(from, next === null ? raw.length : at + decl.length + next.index);
};
const postHandler = (raw: string): string => sliceTo(raw, raw.indexOf(POST_DECL), POST_DECL);
const stallWatchBlock = (raw: string): string => {
  const from = raw.indexOf(DOC_ANCHOR);
  expect(from, 'the stall-watch docstring anchor is gone').toBeGreaterThan(-1);
  return sliceTo(raw, from, POST_DECL);
};
/** The word the old Notifications row label began with. */
const DEVICE_WORD = /phone/i;

describe('M29: the handler never branches on the device label, and the new prose names no device', () => {
  it('CONTROL: the POST slice is the handler, and it hands the label to deviceActor exactly once', () => {
    const body = stripComments(postHandler(ROUTES_SRC()));
    expect(body.length).toBeGreaterThan(400);
    expect(body.split('deviceActor(sessionAuth(req).device)').length - 1).toBe(1);
  });

  it('with that one call removed, no device token is left in the POST handler', () => {
    const stripped = stripComments(postHandler(ROUTES_SRC())).replace(/deviceActor\(sessionAuth\(req\)\.device\)/g, '');
    expect(stripped, 'the stall-watch POST must not branch on device').not.toMatch(/\bdevice\b/);
  });

  it('CONTROL: the device-word scan sees the word where it is (the caps docstring)', () => {
    const raw = ROUTES_SRC();
    expect(raw.slice(raw.indexOf('/** `GET`/`POST /api/coord/caps`'), raw.indexOf("app.get('/api/coord/caps'")))
      .toMatch(DEVICE_WORD);
  });

  it('the stall-watch block, docstring included, and stallsettings.ts hold no device word', () => {
    const block = stallWatchBlock(ROUTES_SRC());
    expect(block).toContain("app.get('/api/coord/stall-watch'");
    expect(block, 'the stall-watch routes\' prose names a device').not.toMatch(DEVICE_WORD);
    expect(readFileSync(path.join(srcRoot, 'coord', 'stallsettings.ts'), 'utf8')).not.toMatch(DEVICE_WORD);
  });
});

describe('M16b: the arming row has one writer, the session-only door', () => {
  const files = (): string[] => sourcesUnder(srcRoot);

  it('CONTROL: the scanner sees the definition in store.ts', () => {
    expect(files().length).toBeGreaterThan(30);
    const storeSrc = blankCommentsAndStrings(readFileSync(path.join(srcRoot, 'coord', 'store.ts'), 'utf8'));
    expect([...storeSrc.matchAll(/\bsetStallSettings\s*\(/g)].length).toBe(1);
  });

  it('setStallSettings( is spelled on a code line only at its definition and inside the POST handler', () => {
    const sites = files().flatMap((f) => {
      const n = [...blankCommentsAndStrings(readFileSync(f, 'utf8')).matchAll(/\bsetStallSettings\s*\(/g)].length;
      return n === 0 ? [] : [`${path.relative(srcRoot, f)}:${n}`];
    }).sort();
    expect(sites).toEqual([path.join('coord', 'routes.ts') + ':1', path.join('coord', 'store.ts') + ':1']);
    const handler = blankCommentsAndStrings(postHandler(ROUTES_SRC()));
    expect([...handler.matchAll(/\bsetStallSettings\s*\(/g)].length, 'the routes.ts call is not in the POST handler')
      .toBe(1);
  });

  it('SQL that writes stall_settings appears only in schema.ts (the seed) and store.ts', () => {
    const sites = files()
      .filter((f) => /\b(?:INSERT\s+INTO|UPDATE)\s+stall_settings\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(srcRoot, f)).sort();
    expect(sites).toEqual([path.join('coord', 'schema.ts'), path.join('coord', 'store.ts')]);
  });
});
```

(b) `server/test/stall-settings.test.ts`, ≈23, the last member line of the `stallsettings.js` import. Replace

```ts
  stallBusyClock,
```

with

```ts
  stallBusyClock, stallBoxHeld,
```

and append at the end of the file (the block begins with one blank line):

```ts

describe('stallBoxHeld: the held flags of the files-only reading are the resolver\'s under Follow (§10, §20)', () => {
  it('over all 256 combinations, it equals what resolveStallWatch reports for Follow', () => {
    for (const names of SUBSETS) {
      const b = box(...names);
      expect(stallBoxHeld(b), names.join(',')).toStrictEqual(resolveStallWatch(b, FOLLOW).held);
    }
  });

  it('nothing is chosen, so strict never holds the wave-2 step, even over a box that arms it', () => {
    expect(stallBoxHeld(box(LIVE, ESCALATE, W2LIVE, STRICT)))
      .toStrictEqual({ watchOff: false, mailOff: false, gateStrict: true, wave2HeldByStrict: false });
    expect(stallBoxHeld(box(KILL, MAIL_OFF)))
      .toStrictEqual({ watchOff: true, mailOff: true, gateStrict: false, wave2HeldByStrict: false });
  });
});
```

(c) `server/test/coord-pause-route.test.ts`, three edits.

≈208: below the line

```ts
   *  operator's act from the phone, not a machine lane's.
```

insert these lines, so they sit above the existing `   *` line that precedes `A BLIND SPOT`:

```ts
   *
   *  `/api/coord/stall-watch` (stall-watch settings wave 1): the operator's
   *  dial on the stall watch's level and quiet time, chosen on the Settings
   *  page. Raising it releases no wedge either, and caps' argument holds: the
   *  box token gates machine lanes, and the PWA holds no such key. Its GET half
   *  rides this entry as the caps read does, because this scan reads `app.post`
   *  handlers and the two verbs share the path.
```

≈212: replace the three lines that begin with the unique line Step 1 counted

```ts
   *  kickoff` is the natural next member — SESSION_ONLY already holds two
   *  (`/api/coord/caps`, `/api/coord/reclaim-pause`), so kickoff would be its
   *  third — a coordination WRITE that is session-gated only — and it is
```

with

```ts
   *  kickoff` is the natural next member — SESSION_ONLY already holds three
   *  (`/api/coord/caps`, `/api/coord/reclaim-pause`, `/api/coord/stall-watch`),
   *  so kickoff would be its fourth — a coordination WRITE that is session-gated only — and it is
```

"three" and "fourth" are lower case, so `CARD_RE`, which scans capitalised counts, is unaffected.

≈221: replace

```ts
  const SESSION_ONLY = new Set(['/api/coord/caps', '/api/coord/reclaim-pause']);
```

with

```ts
  const SESSION_ONLY = new Set(['/api/coord/caps', '/api/coord/reclaim-pause', '/api/coord/stall-watch']);
```

(d) `server/test/auth-gate.test.ts`, six edits.

≈242: replace `    expect(scanRoutes('coord/routes.ts').length).toBe(31);` with

```ts
    // 33 since `GET`/`POST /api/coord/stall-watch` (stall-watch settings W1):
    // SESSION_ONLY like the caps dial, NOT EXEMPT, no box token.
    expect(scanRoutes('coord/routes.ts').length).toBe(33);
```

≈313: replace `    expect(ROUTES.length).toBe(89);` with

```ts
    //
    // 91 since `GET`/`POST /api/coord/stall-watch` (stall-watch settings W1):
    // SESSION_ONLY like the caps dial, NOT EXEMPT, no box token — `coord/routes.ts`
    // 31 -> 33, so 51 + 33 + 7 = 91.
    expect(ROUTES.length).toBe(91);
```

≈335: below the line `      'POST /api/coord/reclaim-pause',` insert

```ts
      'GET /api/coord/stall-watch', 'POST /api/coord/stall-watch',
```

≈451: `    // 89 scanned + the static wildcard when the bundle is built.` becomes
`    // 91 scanned + the static wildcard when the bundle is built.`

≈901: `    // THE PROPERTY, in one loop over all 86 HTTP routes, with THREE probes each:` becomes
`    // THE PROPERTY, in one loop over all 88 HTTP routes, with THREE probes each:`

≈965: in the line that ends `the assertion that covers all 86 HTTP routes, not the 32 exempt.`, `86` becomes `88`.
The 32 stays, because no EXEMPT row is added.

(e) `server/src/auth/gate.ts` ≈8. It moves with the pins because its numeral is a needle `auth-gate.test.ts` reads:
` * THE GATE. One `onRequest` hook stands in front of all 86 routes, the static` becomes
` * THE GATE. One `onRequest` hook stands in front of all 88 routes, the static`.

(f) `server/test/coordinator-skill.test.ts`, two edits.

≈533: below `      'POST /api/coord/reclaim-pause',`, the last member of the route-corpus `EXEMPT` set, insert

```ts
      // STALL-WATCH SETTINGS wave 1 — the operator-dial shape a third time. A
      // coordinator told about this door would be told how to lower the watch
      // on its own workers, or stretch their quiet time, which is the watch's
      // own defeat. Neither half is named, for the caps reason: the read is the
      // first half of the invitation. The forbid-mention case below forbids it.
      'GET /api/coord/stall-watch',
      'POST /api/coord/stall-watch',
```

≈1586: the reclaim-switch case ends with `    expect(allSkillText).not.toContain('reclaim-pause');` and then `  });`. Below
that `  });`, insert (the block begins with one blank line):

```ts

  it('never names the stall-watch settings door — a door that would tell a coordinator how to lower the watch on its own workers or stretch their quiet time', () => {
    // Stall-watch settings wave 1, the caps dial's accounting: EXEMPT above
    // only PERMITS the omission; this is what FORBIDS the mention.
    expect(allSkillText).not.toContain('/api/coord/stall-watch');
  });
```

(g) `server/test/worker-skill.test.ts` (≈679) and `server/test/reviewer-skill.test.ts` (≈211). Each has the case that
opens `  it('never names the reclaim switch — neither the route nor the bare ccd verb', () => {`, whose body is
`    expect(skill).not.toContain('reclaim-pause');` and then `  });`. Below that `  });`, in each file, insert (the block
begins with one blank line):

```ts

  // The stall watch's level and quiet time are the operator's alone (stall-watch
  // settings design 2026-10-05 §10). The skill never names the door that sets
  // them.
  it('never names the stall-watch settings door — the worker a check is about is the session most motivated to lower the watch', () => {
    expect(skill).not.toContain('/api/coord/stall-watch');
  });
```

- [ ] **Step 3: Run the suites to verify they fail**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-settings-route stall-settings coord-pause-route auth-gate box-token-census coordinator-skill worker-skill reviewer-skill; do
  echo "== $f"; ./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests '
done
```

Expected (measured on the prototype):
- `stall-settings-route`: `Tests 34 failed | 3 passed (37)`. The three that pass are the scanner controls that need
  no route: `CONTROL: the device-word scan sees the word where it is (the caps docstring)`, `CONTROL: the scanner sees
  the definition in store.ts`, and `SQL that writes stall_settings appears only in schema.ts (the seed) and store.ts`.
  Every HTTP row reds on a 404, and the scans red on `app.post('/api/coord/stall-watch' is gone`.
- `stall-settings`: `Tests 2 failed | 112 passed (114)`: the two `stallBoxHeld` rows (`stallBoxHeld is not a function`).
- `coord-pause-route`: `Tests 1 failed | 19 passed (20)`: `every SESSION_ONLY route really IS ungated, and really EXISTS`.
- `auth-gate`: `Tests 6 failed | 152 passed (158)`:
  - `found all three files, and EXACTLY the route count the surface has`;
  - `found the specific registrations this file reasons about`;
  - `the property loop names the HTTP-route count`;
  - `the third probe names the whole and the exempt part`;
  - `gate.ts's own docstring names the HTTP-route count it stands in front of`;
  - `the scanner-meta comment names the scanned route count`.
- `box-token-census`: `Tests 1 failed | 22 passed (23)`: `CLAUDE.md's box-token bullet is TRUE, not merely present`.
  The census harvests the new `SESSION_ONLY` member, and this red drives Step 4 (d).
- `coordinator-skill` `Tests 161 passed (161)`, `worker-skill` `Tests 52 passed (52)`, `reviewer-skill`
  `Tests 15 passed (15)`. They are green by design, because no skill names the door today; their reds are the M16 rows
  in Step 6.

- [ ] **Step 4: Implement**

(a) `server/src/coord/stallsettings.ts`. Below `stallUnheldBoxOf` (≈144: the line
`  return { ...stallBoxArmingOf(names.filter((n) => mailTurnModeOf([n]) !== 'strict'), false), disabled: false };` and
its closing `}`), insert (the block begins with one blank line):

```ts

/** The held flags the fleet box's files set, as the resolver reports them when nothing is chosen: the view's
 *  files-only reading (§10, §20) reports these, and the resolver builds its own `held` from them. With no chosen level
 *  there is no wave-2 step for strict to hold, so that flag is false here. */
export function stallBoxHeld(box: StallBoxArming): StallHeld {
  return { watchOff: box.disabled, mailOff: box.mailDisabled === true, gateStrict: box.mailMode === 'strict', wave2HeldByStrict: false };
}
```

In `resolveStallWatch` (≈251), replace

```ts
    held: { watchOff: box.disabled, mailOff: box.mailDisabled === true, gateStrict: strict, wave2HeldByStrict: run !== null && run.w2Live && strict },
```

with

```ts
    held: { ...stallBoxHeld(box), wave2HeldByStrict: run !== null && run.w2Live && strict },
```

(b) `server/src/coord/routes.ts`, the imports.

≈14: replace

```ts
import { CCD_ARGV, RECLAIM_PAUSE_CAP, ROUTE_CAP, capSupported, verbSupported, sweepDec } from '../ccdargv.js';
```

with

```ts
import { CCD_ARGV, RECLAIM_PAUSE_CAP, ROUTE_CAP, capSupported, deviceActor, verbSupported, sweepDec } from '../ccdargv.js';
```

≈22: replace

```ts
import { toRunSummary, type ClaimEndResult, type CoordStore } from './store.js';
```

with

```ts
import { toRunSummary, type ClaimEndResult, type CoordStore, type StallSettingsWrite } from './store.js';
```

≈32: replace

```ts
import { queueSystemMail } from './rundefs.js';
```

with

```ts
import { MAIL_DISABLED_MARKER, queueSystemMail } from './rundefs.js';
import { STALL_QUIET_MS } from './stall.js';
import {
  STALL_NOTICE_WINDOW_MS, STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS, STALL_QUIET_STEP_MS, decideStallSettings,
  parseStallSettings, resolveStallWatch, stallBoxArmingOf, stallBoxHeld, stallEffectKey, stallFilesExceed,
  stallLevelOf, stallNeedsConfirm, stallNextStep, stallNoticeCounts, stallSettingsAfter, stallSettingsChange,
  stallStages, stallUnheldBoxOf, stallWriteEffect, type StallBoxArming, type StallResolved,
} from './stallsettings.js';
```

≈44, inside the `shared/api.js` import: replace

```ts
  type FailureKind, type RouteField, type RunRouteBody, type RouteMode,
```

with

```ts
  type FailureKind, type RouteField, type RunRouteBody, type RouteMode,
  type StallConfirmRequired, type StallWatchEffective, type StallWatchView, type StallWriteEffect,
```

(c) `server/src/coord/routes.ts`, the routes. The caps POST handler ends (≈2499) with the line
`    return reply.code(200).send({ ok: true, ...view });` and then `  });`. Below that `  });`, and above the `  /**` that
opens the docstring of `GET /api/runs?closed=1`, insert this block. It begins with one blank line.

```ts

  /** `GET`/`POST /api/coord/stall-watch` — the stall watch's level and quiet time become a choice the operator makes
   *  on the Settings page (stall watch settings, design 2026-10-05 §10). One path serves both verbs, as caps does, so
   *  one `SESSION_ONLY` entry covers the door.
   *
   *  NOT BOX-TOKEN, AND NOT `UNGATED`, for the caps dial's two reasons. The box token gates machine lanes, and an
   *  operator choosing a level in the PWA is not one; gating it on the fleet's shared secret would put it behind a key
   *  the PWA does not hold. Nor is it a release valve: raising the level releases no wedge, so `UNGATED`'s argument
   *  (D-282) does not apply. It is an ordinary same-origin PWA write: session-gated when `CCRC_AUTH` is armed (no row
   *  in `auth/gate.ts`'s EXEMPT table), open dark otherwise. `coord-pause-route.test.ts`'s `SESSION_ONLY` holds both
   *  halves against this file.
   *
   *  THE UNARMED BOX, said plainly, as the caps door's "open dark, like every other write the console makes" says it.
   *  With the gate unarmed, any process that reaches this server, a fleet session included, can change the level or
   *  the quiet time, as it can the caps. What stands against that is three things: no skill names this door (the
   *  forbid-mention cases in the coordinator, worker and reviewer suites); every change leaves a feed row naming its
   *  actor, `flag-off` when unarmed; and arming the gate. The worker a check is about is the session most motivated to
   *  lower the watch, which is why none of the three skills may name the path.
   *
   *  THE VIEW IS BUILT ONCE, by `stallWatchView`, and both halves send it (the `capsView` precedent). It composes and
   *  decides nothing: the resolver and the readers are L1's (`stallsettings.ts`). It never throws.
   *  - The resolution runs in its own `try`, and only that `try` claims a fallback. On a throw the reply carries what
   *    the sweeps' own catch runs: the fleet box's files and the built-in quiet time, with the fallback line's reason.
   *    A fallback the watcher reports (`watcher.stallFallback()`) is reported even when this one succeeded.
   *  - The view-only readers run in a second `try`, which claims no fallback: a throw there leaves `next` and
   *    `filesExceed` out (or, when the stages themselves cannot be read, answers the reading unmeasured), and the sweeps
   *    are not affected, because they never call those readers.
   *  - The notice counts run in a third, so a count that fails answers `notices: { ok: false }`, never a 500.
   *  Each `try` warns once per standing fault and re-arms when it next succeeds, so a page polling every minute does
   *  not repeat the line.
   *
   *  THE WRITE IS DECIDED BY THE SERVER (departure `server-decides-the-confirm` (D-4033)). The body is decided by L1
   *  (`decideStallSettings`; unknown keys are refused, departure `unknown-keys-refused` (D-4029)). The route then
   *  measures what the write would do, from the row as it stands and the row the write will leave, against the
   *  listing it just took, and refuses a write that needs a confirm with 409 `confirm-required` until the body carries
   *  the effect's key (departure `confirm-on-stage-diff` (D-4034)). From the listing to the write there is no `await`,
   *  so no other request moves the row in between; the store still writes only over the row measured here, and a
   *  conflict is measured once more on the row it found. One synchronous transaction, so no `coordMutex` (departure
   *  `no-coord-mutex-for-stall-settings` (D-4030)). The reply re-reads the store, never the body.
   *
   *  THE FEED ROW names only what changed, and a write that changed nothing records nothing (departure
   *  `no-op-write-records-no-feed-event` (D-4031)). The actor is `deviceActor(sessionAuth(req).device)` when the gate
   *  is armed, the same call `server.ts`'s `pwaDec` makes; unarmed it is `flag-off`, the gate's own word, because the
   *  session reading does not consult the flag and would record a session nobody presented. The label is only ever
   *  handed to `deviceActor`, never branched on; `stall-settings-route.test.ts` holds that (M29). */
  const stallViewWarned = new Set<string>();
  /** One line per standing fault in one part of the view, re-armed when that part next succeeds. */
  const stallViewNote = (part: string, fault: string | null): void => {
    if (fault === null) { stallViewWarned.delete(part); return; }
    if (stallViewWarned.has(part)) return;
    stallViewWarned.add(part);
    try {
      console.warn(`ccrc-server: stall-watch view: ${part} failed (${fault})`);
    } catch { /* a log line must not fail the view */ }
  };
  /** A thrown value's message, cut to 200 characters, composed as the sweeps' catch composes its own: a fixed word
   *  stands when even reading the error throws. */
  const stallFaultReason = (err: unknown): string => {
    try {
      return (err instanceof Error ? err.message : String(err)).slice(0, 200);
    } catch {
      return 'an unreadable fault';
    }
  };

  const stallWatchView = (
    store: CoordStore, names: readonly string[] | null, now: number,
    watcherFallback: { readonly at: number; readonly reason: string } | null,
  ): StallWatchView => {
    // The resolution, as `stallResolveNow` runs it. With no listing it is still taken, over an empty one, for the
    // quiet time alone, which reads no flag of the box (§6.2); `effective` then stays unmeasured.
    let chosen: StallWatchView['chosen'] = { level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'unreadable' };
    let resolution: { readonly box: StallBoxArming; readonly r: StallResolved } | null = null;
    let ownFault: string | null = null;
    try {
      const parsed = parseStallSettings(store.stallSettings());
      chosen = {
        level: parsed.level.kind === 'follow' ? 'follow' : parsed.level.kind === 'chosen' ? parsed.level.level : 'unreadable',
        quietMs: parsed.quiet.kind === 'default' ? 'default' : parsed.quiet.kind === 'set' ? parsed.quiet.ms : 'unreadable',
        updatedAt: parsed.updatedAt,
        stored: parsed.stored,
      };
      const box = stallBoxArmingOf(names ?? [], names !== null && names.includes(MAIL_DISABLED_MARKER));
      resolution = { box, r: resolveStallWatch(box, parsed) };
    } catch (err) {
      ownFault = stallFaultReason(err);
    }
    stallViewNote('the resolution', ownFault);
    const fallback = watcherFallback ?? (ownFault === null ? null : { at: now, reason: ownFault });
    // Under any fallback the reply shows what the sweeps' catch runs: the files alone and the built-in quiet time.
    const applied = fallback === null ? resolution : null;

    let effective: StallWatchEffective = { measured: false };
    let readerFault: string | null = null;
    if (names !== null) {
      try {
        if (applied !== null) {
          const { box, r } = applied;
          const stages = stallStages(r.arming);
          effective = { measured: true, level: r.effective, files: r.files, source: r.levelSource, stages, held: r.held };
          effective = { measured: true, level: r.effective, files: r.files, source: r.levelSource, stages, held: r.held,
            next: stallNextStep(r.arming, r.chosen), filesExceed: stallFilesExceed(box, r) };
        } else {
          // The files-only reading: neither the parse nor the resolver, so neither fault can reach it.
          const box = stallBoxArmingOf(names, names.includes(MAIL_DISABLED_MARKER));
          const level = stallLevelOf(box);
          const stages = stallStages(box);
          const held = stallBoxHeld(box);
          effective = { measured: true, level, files: level, source: 'files', stages, held };
          effective = { measured: true, level, files: level, source: 'files', stages, held,
            next: stallNextStep(box, null), filesExceed: false };
        }
      } catch (err) {
        readerFault = stallFaultReason(err);
      }
    }
    stallViewNote('a view reader', readerFault);

    let notices: StallWatchView['notices'] = { ok: false };
    let countFault: string | null = null;
    try {
      const since = now - STALL_NOTICE_WINDOW_MS;
      const read = store.stallObservationsSince(since);
      if (read.ok) notices = { ok: true, since, windowMs: STALL_NOTICE_WINDOW_MS, counts: stallNoticeCounts(read.rows) };
      else countFault = read.detail.slice(0, 200);
    } catch (err) {
      countFault = stallFaultReason(err);
    }
    stallViewNote('the notice counts', countFault);

    return {
      chosen,
      effective,
      quiet: {
        effectiveMs: applied === null ? STALL_QUIET_MS : applied.r.quietMs,
        builtInMs: STALL_QUIET_MS,
        minMs: STALL_QUIET_MIN_MS,
        maxMs: STALL_QUIET_MAX_MS,
        stepMs: STALL_QUIET_STEP_MS,
        source: applied === null ? 'default' : applied.r.quietSource,
      },
      notices,
      fallback,
    };
  };

  app.get('/api/coord/stall-watch', async (_req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const names = await deps.io.readdir(deps.cfg.registryDir);
    return reply.code(200).send({ ok: true, ...stallWatchView(coord, names, Date.now(), watcher?.stallFallback() ?? null) });
  });

  app.post('/api/coord/stall-watch', async (req, reply) => {
    if (!deps.coord) return notConfigured(reply);
    const coord = deps.coord;
    const decided = decideStallSettings(req.body);
    if (!decided.ok) return reply.code(400).send({ ok: false, error: 'bad-request', detail: decided.detail });
    const names = await deps.io.readdir(deps.cfg.registryDir);
    // From here to the write there is no `await`.
    const at = Date.now();
    let expected = coord.stallSettings();
    let written: Extract<StallSettingsWrite, { kind: 'written' }> | null = null;
    // Measured at most twice: on the row read here, and once more on the row a conflict found.
    for (let measure = 0; measure < 2 && written === null; measure++) {
      // An effect measured on a row that could not be read would be measured on the wrong row: refused, Fastify's
      // 500, and nothing written.
      if (expected.kind === 'unreadable') throw new Error(`stall settings unreadable, nothing written: ${expected.detail}`);
      const effect: StallWriteEffect = names === null ? { measured: false } : stallWriteEffect(
        stallBoxArmingOf(names, names.includes(MAIL_DISABLED_MARKER)), stallUnheldBoxOf(names),
        expected, stallSettingsAfter(expected, decided.patch, at));
      const effectKey = stallEffectKey(effect, parseStallSettings(expected).updatedAt);
      if (stallNeedsConfirm(effect) && decided.confirm !== effectKey) {
        const refusal: StallConfirmRequired = { ok: false, error: 'confirm-required', effect, effectKey };
        return reply.code(409).send(refusal);
      }
      const w = coord.setStallSettings(decided.patch, at, expected);
      if (w.kind === 'written') written = w;
      else expected = w.before;
    }
    if (written === null) throw new Error('stall settings changed outside the server twice during one write; nothing written');
    const change = stallSettingsChange(written.before, written.after);
    const log = deps.notifyLog;
    if (change !== null && log) {
      const actor = deps.cfg.authEnabled ? deviceActor(sessionAuth(req).device) : 'flag-off';
      try {
        const ev = log.record({ kind: 'coord', sessionId: '', title: 'stall watch changed', body: `${change}; by ${actor}`, runId: null });
        coord.recordFeedEvent(log.epoch, ev);
      } catch (err) {
        console.warn('ccrc-server: recordFeedEvent failed ' +
          `(${err instanceof Error ? err.message : String(err)}) — stall watch settings written, feed archive degraded`);
      } finally {
        // The caps door's reason (D-1213): `record()` minted the seq, so its persistence follows `record()`.
        void log.flush();
      }
    }
    return reply.code(200).send({ ok: true, ...stallWatchView(coord, names, Date.now(), watcher?.stallFallback() ?? null) });
  });
```

Its decisions, in the order the code takes them:
- **GET.** `notConfigured` without a store; the listing (`deps.io.readdir`); then the shared builder.
- **The builder's first `try`** reads, parses and resolves, as `stallResolveNow` does. It alone sets the builder's own
  fallback, and `chosen` comes from its parse whenever the parse returned. A watcher fallback wins when one stands.
  Under any fallback, `applied` is `null`, so the reply shows the files-only reading and the built-in quiet time.
- **The second `try`** holds the view-only readers. It claims no fallback, and a throw leaves `next` and `filesExceed`
  out (see the residue above).
- **The third `try`** holds the counts. A failed read or a throwing count answers `{ ok: false }`.
- **POST.** The decision first, then the listing, then no `await` to the write. The route refuses its own unreadable
  pre-read with a throw (Fastify's 500). It measures the effect over the projection, answers 409 when the confirm is
  needed and the key does not match, and writes with `expected`. On a conflict it measures once more on the row the
  store found; a second conflict throws. The feed row is recorded only when `stallSettingsChange` answers a body, and
  the flush runs in `finally`. The reply re-reads the store through the builder.

(d) `CLAUDE.md`, the box-token bullet, two edits. This is what Step 3's `box-token-census` red asks for. The other
`CLAUDE.md` edits are Task 7's.

≈277: replace the line

```
  `POST /api/coord/caps` (wave 6) and `POST /api/coord/reclaim-pause` (child-reclamation wave 4) are
```

with the two lines

```
  `POST /api/coord/caps` (wave 6), `POST /api/coord/reclaim-pause` (child-reclamation wave 4) and
  `POST /api/coord/stall-watch` (stall-watch settings wave 1) are
```

≈281: in the line `  that one file is invisible to the set that pins the doors. The other two are in that file's `SESSION_ONLY``,
`The other two` becomes `The other three`. It stays lower case, so no count-word scan reads it. The bullet's opening
and closing anchors are unchanged.

- [ ] **Step 5: Run the suites to verify they pass**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in stall-settings-route stall-settings coord-pause-route auth-gate box-token-census coordinator-skill worker-skill reviewer-skill mail-routes; do
  echo "== $f"; ./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests '
done
```

Expected (measured): `stall-settings-route` `Tests 37 passed (37)`; `stall-settings` `Tests 114 passed (114)`;
`coord-pause-route` `Tests 20 passed (20)`; `auth-gate` `Tests 160 passed (160)` (the per-route sweep gained one case
per new route); `box-token-census` `Tests 23 passed (23)`; `coordinator-skill` `Tests 161 passed (161)`;
`worker-skill` `Tests 52 passed (52)`; `reviewer-skill` `Tests 15 passed (15)`; `mail-routes` `Tests 59 passed (59)`.

- [ ] **Step 6: The mutation table**

Apply each mutation alone, run the named suite, record the failing count and names, and restore. Each "old" text
occurs exactly once at the commit. `git status` must show only this task's files when the table is done.

| # | Guard | Mutation | Red in | Measured |
|---|---|---|---|---|
| M13 | The reply re-reads | The POST answers `{ ...view, chosen: { ...view.chosen, level: decided.patch.level ?? view.chosen.level } }` | stall-settings-route | `1 failed`: `M13: the reply re-reads the store, never echoing the body` |
| M14 | Unknown keys refused | In `decideStallSettings`, `if (!(STALL_REQUEST_KEYS …).includes(k))` → `if (false && …)` | stall-settings-route | `1 failed`: `M14: refuses with 400 and the detail, writes nothing and records nothing` |
| M15a | A no-op records nothing | `if (change !== null && log)` → `if (log)` | stall-settings-route | `1 failed`: `the same body POSTed twice records one feed row: a no-op records nothing` |
| M15b | Flush in `finally` | `void log.flush();` moved into the `try`, after `recordFeedEvent`, `finally` removed | stall-settings-route | `1 failed`: `a throwing feed archive still writes the setting, warns, and still flushes the minted seq` |
| M15c | The actor named | `` body: `${change}; by ${actor}` `` → `body: change` | stall-settings-route | `2 failed`: `names what changed and ends "by flag-off" when the gate is unarmed`; `ends "by device:<label>" when the gate is armed` |
| M15d | The armed actor is the session's | `const actor = 'flag-off';` | stall-settings-route | `2 failed`: `ends "by device:<label>" when the gate is armed`; M29 `CONTROL: the POST slice is the handler, and it hands the label to deviceActor exactly once` |
| M16-1 | `SESSION_ONLY` member | Drop `'/api/coord/stall-watch'` from the set | coord-pause-route | `1 failed`: `every app.post handler in coord/routes.ts checks the box token, except the named ones` |
| M16-2 | `CLAUDE.md` names the path | `` `POST /api/coord/stall-watch` (stall-watch settings wave 1) are `` → `the stall-watch door (stall-watch settings wave 1) are` | box-token-census | `1 failed`: `CLAUDE.md's box-token bullet is TRUE, not merely present` |
| M16-3 | Coordinator `EXEMPT` | Drop the two `EXEMPT` entries | coordinator-skill | `1 failed`: `names every coordinator-domain route the server registers, method included (fix, review finding 9)` |
| M16-4 | Coordinator forbid-mention | Append a line naming `` `POST /api/coord/stall-watch` `` to `ccd/coordinator-skill/SKILL.md` | coordinator-skill | `1 failed`: `never names the stall-watch settings door — a door that would tell a coordinator how to lower the watch on its own workers or stretch their quiet time` |
| M16-5 | Worker forbid-mention | Name `` `/api/coord/stall-watch` `` in `ccd/worker-skill/SKILL.md` | worker-skill | `1 failed`: `never names the stall-watch settings door — the worker a check is about is the session most motivated to lower the watch` |
| M16-6 | Reviewer forbid-mention | Name `` `/api/coord/stall-watch` `` in `ccd/reviewer-skill/SKILL.md` | reviewer-skill | `1 failed`: the same case name |
| M16-7 | `coord/routes.ts` pin | `toBe(33)` → `toBe(31)` | auth-gate | `1 failed`: `found all three files, and EXACTLY the route count the surface has` |
| M16-8 | `ROUTES` pin | `toBe(91)` → `toBe(89)` | auth-gate | `1 failed`: the same case |
| M16-9 | `gate.ts` ≈8 | `all 88 routes` → `all 86 routes` | auth-gate | `1 failed`: `gate.ts's own docstring names the HTTP-route count it stands in front of` |
| M16-10 | Needle ≈901 | `all 88 HTTP routes, with THREE` → `all 86 …` | auth-gate | `1 failed`: `the property loop names the HTTP-route count` |
| M16-11 | Needle ≈965 | `covers all 88 HTTP routes` → `covers all 86 …` | auth-gate | `1 failed`: `the third probe names the whole and the exempt part` |
| M16-12 | Needle ≈451 | `// 91 scanned` → `// 89 scanned` | auth-gate | `1 failed`: `the scanner-meta comment names the scanned route count` |
| M16b-1 | One writer of the row | In the GET handler, `if (names === null) coord.setStallSettings({ level: 'off' }, Date.now(), coord.stallSettings());` | stall-settings-route | `2 failed`: `setStallSettings( is spelled on a code line only at its definition and inside the POST handler`; `M6: a registry that cannot be listed …` (the planted write runs) |
| M16b-2 | One writer, another file | A `this.coord?.setStallSettings(…)` call planted in `watch.ts`'s `stallFallback()` | stall-settings-route | `1 failed`: `setStallSettings( is spelled on a code line only …` |
| M16b-3 | One SQL writer | `coord.db.prepare('UPDATE stall_settings SET level = ? WHERE id = 1')` planted in the GET handler | stall-settings-route | `1 failed`: `SQL that writes stall_settings appears only in schema.ts (the seed) and store.ts` |
| M17b | Counting never fails the reply | The count `try`'s `catch` removed (`try … finally {}`) | stall-settings-route | `1 failed`: `M17b: a throw from L1 counting answers notices {ok:false}, never a 500, and the rest of the view stands` |
| M18a | Kebab declared | Drop `'flag-off'` from `STALL_SETTINGS_KEBABS` | mail-routes | `1 failed`: `every quoted kebab token in server/src/coord that looks like a code is declared` |
| M18b | Kebab declared | Drop `'confirm-required'` from `STALL_SETTINGS_KEBABS` | mail-routes | `1 failed`: the same case |
| M18c | Kebab union read | The scan's `isStallSettingsKebab(tok)` term replaced by `false` | mail-routes | `1 failed`: the same case |
| M20a | The first `try` | Remove it (the resolution throws through) | stall-settings-route | `3 failed`: `M20: a resolver that really throws …`; `M20: the view warns once …`; `M20: a parse that throws …` |
| M20b | View readers not in the first `try` | Call `stallNextStep(resolution.r.arming, resolution.r.chosen)` inside the first `try` | stall-settings-route | `1 failed`: `M20: a throwing view-only reader answers 200 with no fallback, and next and filesExceed left out` |
| M20c | The second `try` | Its `catch` removed | stall-settings-route | `1 failed`: the same case |
| M20d | Built-in quiet under a fallback | `effectiveMs: resolution === null ? STALL_QUIET_MS : resolution.r.quietMs` | stall-settings-route | `1 failed`: `M20: a watcher fallback is reported even when the builder's own resolution succeeded, with the built-in quiet time` |
| M20e | Files-only under a watcher fallback | `const applied = ownFault === null ? resolution : null;` | stall-settings-route | `1 failed`: the same case |
| M20f | The latch | Delete `if (stallViewWarned.has(part)) return;` | stall-settings-route | `1 failed`: `M20: the view warns once for a standing fault, and again after a resolution that succeeds` |
| M20g | The latch re-arms | `if (fault === null) { stallViewWarned.delete(part); return; }` → `if (fault === null) return;` | stall-settings-route | `1 failed`: the same case |
| M26 | The server decides the confirm (route arm) | `if (false && stallNeedsConfirm(effect) && …)` | stall-settings-route | `7 failed`: the two M26 rows, M6/M26, both M27 rows, M10, and `M27b: a conflict whose fresh effect needs a confirm …` |
| M27a | The key is checked | `decided.confirm !== effectKey` → `decided.confirm === null` | stall-settings-route | `2 failed`: `M27: a key that does not match …`; `M27: another page's write between the 409 and the re-POST …` |
| M27b | `updatedAt` in the key | `stallEffectKey(effect, null)` | stall-settings-route | `3 failed`: `M26: a write that turns a stage on …`; `M27: another page's write …`; `M27b: a conflict whose fresh effect needs a confirm …` |
| M27c | The route's own unreadable refusal | Delete the `if (expected.kind === 'unreadable') throw …` line | stall-settings-route | `1 failed`: `M27b: a pre-read that answers unreadable is refused with a 500, and nothing is written` |
| M27d | One re-measure on a conflict | `measure < 2` → `measure < 1` | stall-settings-route | `2 failed`: `M27b: a conflict whose fresh effect needs a confirm …`; `M27b: a conflict whose fresh effect needs none …` |
| M27e | Re-measure on the row the store found | `else expected = w.before;` → `else expected = { ...expected };` | stall-settings-route | `2 failed`: the same two |
| M29a | No branch on the label | Insert `if (sessionAuth(req).device === 'blocked') return reply.code(403).send({ ok: false });` before the actor line | stall-settings-route | `1 failed`: `with that one call removed, no device token is left in the POST handler` |
| M29b | No device word | Add ", from a phone" to the docstring's first sentence | stall-settings-route | `1 failed`: `the stall-watch block, docstring included, and stallsettings.ts hold no device word` |
| M29c | No device word in L1 | Add "(shown on the phone)" to `stallBoxHeld`'s docstring | stall-settings-route | `1 failed`: the same case |
| M6a | Unknown is never off (POST) | Measure a `null` listing as `[]` | stall-settings-route | `1 failed`: `M6 / M26: with the registry unlistable every write answers 409 with the unmeasured effect, and its key writes` |
| M6b | Unknown is never off (GET) | `if (names !== null)` → `if (true)` in the builder | stall-settings-route | `2 failed`: `M6: a registry that cannot be listed …`; `M6 / M26: …` |
| H1 | Files-only held: strict holds no wave-2 step | `wave2HeldByStrict: box.mailMode === 'strict'` in `stallBoxHeld` | stall-settings | `2 failed`: both `stallBoxHeld` rows |
| H2 | Files-only held: `mailOff` | `mailOff: false` in `stallBoxHeld` | stall-settings | `4 failed`: `M2: … every running level carries the box's mailDisabled, and mailOff is held`; `M23: … each flag alone`; `M23: … a flag that merely stands beside the choice sets nothing`; `nothing is chosen, so strict never holds the wave-2 step …` |

The control is Step 5's green on the unmutated tree.

- [ ] **Step 7: Regression suites**

```bash
cd "$(git rev-parse --show-toplevel)/server"
for f in routes coord-routes-single-file single-definition coord-caps-route archive-coord-handle stall-vocabulary pools-prose \
         session-hook mail-sweep stall-sweep stall-settings-store coord-db typecheck-tests child-reclaim-pause-route \
         child-reclaim-prose topology-clean mail-hardening ledger-instruction oss-metadata ccrc-install-graphify; do
  echo "== $f"; ./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests '
done
ls test/ | grep -E '^(coord-|stall-|auth-|run-routes|mail-|box-token|single-def|typecheck)' | sed 's#^#test/#' \
  | xargs ./node_modules/.bin/vitest run | grep -E '^ +(Tests|Test Files) '
```

Expected (measured): `routes` 80, `coord-routes-single-file` 3, `single-definition` 274 (unedited), `coord-caps-route`
26, `archive-coord-handle` 6, `stall-vocabulary` 179, `pools-prose` 27 (the `CLAUDE.md` size ratchet, +1 line),
`session-hook` 335 (the citation instrument, `CLAUDE.md` edited and README untouched), `mail-sweep` 115, `stall-sweep`
117, `stall-settings-store` 40, `coord-db` 71, `typecheck-tests` 12, and the seven `CLAUDE.md` and reclaim readers
from `child-reclaim-pause-route` to `ccrc-install-graphify` 169 between them, all passed. The batch:
`Test Files 43 passed (43)`, `Tests 2996 passed (2996)`.

`deviation-refs.test.ts` is red, `1 failed | 30 passed (31)`: `floorFromScan over the real tracked tree seeds from the
ledger high-water, not a fixture`. It was already red at the parent `65b4c6c84`, where `stallsettings.ts` cites
D-4034 above the ledger high-water D-3969. This task's citations move only the evidence file it names. It goes green
when this plan's `## Deviations found` entries land, which is the coordinator's step, not this
task's.

- [ ] **Step 8: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo tsc-clean
```

Expected (measured): `tsc-clean`, both exit 0.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add CLAUDE.md server/src/auth/gate.ts server/src/coord/routes.ts server/src/coord/stallsettings.ts \
  server/test/auth-gate.test.ts server/test/coord-pause-route.test.ts server/test/coordinator-skill.test.ts \
  server/test/reviewer-skill.test.ts server/test/stall-settings.test.ts server/test/worker-skill.test.ts \
  server/test/stall-settings-route.test.ts
git commit -m "$(cat <<'MSG'
feat(coord): GET and POST /api/coord/stall-watch, and the censuses

The Settings page's door onto the stall watch's level and quiet time
(design 2026-10-05 §10). One view builder serves both halves and never
throws: the resolution in its own try (the only one that claims a
fallback, which then shows the files-only reading and the built-in quiet
time), the view-only readers in a second, the notice counts in a third.
The POST decides the body (unknown keys refused, D-4029), measures the
write's effect against the listing it just took, answers 409
confirm-required until the body carries the effect's key
(server-decides-the-confirm, D-4033; confirm-on-stage-diff, D-4034),
writes over the row it measured in one transaction with no coordMutex
(D-4030), re-measures once on a conflict, and records a feed row only on
a change (D-4031), naming its actor. stallBoxHeld gives the files-only
reading the held flags Follow reports.

Censuses: SESSION_ONLY, the auth-gate pins and needle numerals, the
coordinator EXEMPT entries and the three forbid-mention cases, and
CLAUDE.md's session-only sentence.
MSG
)"
```

---

### Task 7: Docs: README, CLAUDE.md and the parent stall-watch spec

**Model routing:** `sonnet`, effort `medium`: transcription of exact prose edits, one new prose suite, and a mutation table.

**Files:**
- Create: `server/test/stall-settings-prose.test.ts` (160 lines).
- Modify: `README.md`, in place, eight edits:
  - the mail gate paragraph: strict's runbook and "two more markers" (≈3825–3828), the precedence sentence and the busy runbook (≈3842–3845);
  - "**The stall watch.**": r1's quiet time (≈4080–4081), the dialog cap (≈4097–4098), the override sentence (≈4109), the check-rate sentences (≈4111, ≈4121), the backoff (≈4124–4125);
  - "**The stall watch, wave 2.**": the wave-2 runbook (≈4261–4262).
  - Left as they are, by §18: ≈4209 ("a second within 2 h", `FAILED_REPEAT_MS`) and ≈4226 ("the check sits undelivered for 2 h", `CHECK_UNDELIVERED_MS`).
- Modify: `CLAUDE.md`: the README size claim (≈10), the `coord.db` bullet's loss list (≈255–256), the mail-gate bullet's last line (≈316 at `77f8d63a5`; ≈317 once Task 6's box-token sentence has landed). Task 6's box-token sentence (≈277–282) is not touched.
- Modify: `docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md`: the status block (≈3), §4.2's marker paragraph (≈474–476), §10's constants line (≈839) and kill rules (≈874–876).
- Test: `server/test/stall-settings-prose.test.ts`.

**Interfaces:**
- Consumes, from `server/src/coord/stall.ts`:
  - `export const STALL_QUIET_MS = 2 * 3_600_000;` (≈308)
  - `export const FAILED_REPEAT_MS = 2 * 3_600_000;` (≈346)
  - `export const CHECK_UNDELIVERED_MS = 2 * 3_600_000;` (≈348)
  - `export const STALL_BACKOFF_CEILING_MS = BACKLOG_HORIZON_MS - 2 * (STALL_BOUND_MS + STALL_OPERATOR_MS);` (Task 3, ≈356; 16 h)
  - `STALL_MARKERS: readonly string[]`, in `STALL_MARKER_MAP`'s order: the kill file, live, escalate, the wave-2 step.
- Consumes, from `server/src/coord/stallsettings.ts` (Task 1): `export const STALL_QUIET_MIN_MS = 30 * 60_000;`, `export const STALL_QUIET_MAX_MS = 12 * 3_600_000;`.
- Consumes, from `server/src/turnidle.ts`: `MAIL_GATE_STRICT_MARKER: string` and `MAIL_GATE_BUSY_MARKER: string`. From `server/src/coord/rundefs.ts`: `MAIL_DISABLED_MARKER: string`.
- Produces: no code. The documents say what a level and a quiet time chosen in Settings (`/api/coord/stall-watch`, Task 6) do to the markers they describe, and fifteen prose rows pin it. Every number in a pinned sentence is derived from the constant it names. Every marker name comes from its definer's export, so the new suite never becomes a second holder of a marker spelling.

**Residue settled here (§18, §20):**
- **The strict runbook** (§20, coordinator). "`rm` it to go back" becomes "`rm` it to lift it: under a level chosen in Settings, whatever of that level it held back (busy delivery, the further checks) then applies." Strict wins under every level, so removing it never goes back on its own. Under a chosen Deliver or Everything, removing it applies the stages the operator confirmed (`strict-holds-the-wave-2-step` (D-4023)).
- **"Wherever it says 2 h"** (§18). The full parenthetical "(2 h unless Settings sets another, 30 min to 12 h)" appears once, at r1, where the quiet time is first used. The dialog cap and the two check-rate sentences say "the quiet time". A row pins that the stall-watch paragraph spells the built-in 2 h exactly once.
- **The README size ratchet.** README grows 5684 → 5698. That is 98 from CLAUDE.md's "~5600", inside `pools-prose`' ±100 but leaving W2's Settings sentence no room. CLAUDE.md's claim moves to "~5700" in the same commit, which is the ratchet's own rule.

- [ ] **Step 1: Re-anchor**

```bash
cd "$(git rev-parse --show-toplevel)"
grep -cF '`touch $REG/mail-gate-strict` on the fleet host restores the idle-only gate;' README.md
grep -cF '`mail-gate-busy` and `rm` the shadow marker. `rm mail-gate-busy` goes back.' README.md
grep -cF "ball is the worker's and its main loop has sat \`idle\` or \`shell\` for 2 h with" README.md
grep -cF 'after 2 h), a usage limit' README.md
grep -cF 'coordinator mails and the operator pushes too. The quiet clock restarts on ANY' README.md
grep -cF 'mails the worker there at least every 2 h keeps r1' README.md
grep -cF 'draws a check about every 2 h, and' README.md
grep -cF 'it, to 4 h and then 8 h at most, and any other mail' README.md
grep -cF "re-times); \`rm\` it to go back to wave 1's" README.md
grep -c '^ladder\.$' README.md
grep -cF 'README.md` (~5600 lines)' CLAUDE.md
grep -cF 'update intents — is gone without the snapshot' CLAUDE.md
grep -cF 'have **no writer in the tree** — `single-definition.test.ts` pins that.' CLAUDE.md
P=docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md
grep -cF '**Status:** rev 3.1, APPROVED' $P
grep -cF 'Every marker is touched and removed by hand on the fleet box' $P
grep -c '^tick\.$' $P
grep -cF '`MAIL_ARMED_HOLD_MS`; the PWA renders none):' $P
grep -cF 'exceed 10 a day for two days, `rm stall-watch-live`;' $P
wc -l README.md CLAUDE.md $P
```

Expected (measured on the prototype before this task): `1` for every `grep -c`. Line counts: `5684 README.md`, `383 CLAUDE.md` (`384` once Task 6's sentence is in), `992` for the parent spec. If a count differs, `main` moved: find the text by content and say so. Each multi-line "before" in Step 4 was also measured once as a whole, with Python `str.count`.

- [ ] **Step 2: Write the failing test**

Create `server/test/stall-settings-prose.test.ts`:

```ts
/**
 * STALL WATCH SETTINGS, the documents (design 2026-10-05, §1's Related block, §18's W1 edit lists, §20). W1 Task 7.
 *
 * README, CLAUDE.md and the parent stall-watch spec each say what a level and a quiet time chosen in Settings do to the
 * markers they describe. Every number below is derived from the constant it names, never typed, so a change to the
 * constant reds the sentence that states it (`readme-holds.test.ts`'s founding lesson). Every marker name comes from
 * its definer's export, as in `stall-settings.test.ts`, so this file is never a second holder of a marker spelling.
 *
 * The helpers are local, for the reason `crossrepo-prose.test.ts` gives: `server/test` is not one of
 * `single-definition.test.ts`'s four roots, and a shared slicer would couple unrelated ratchets.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_UNDELIVERED_MS, FAILED_REPEAT_MS, STALL_BACKOFF_CEILING_MS, STALL_MARKERS, STALL_QUIET_MS } from '../src/coord/stall.js';
import { STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS } from '../src/coord/stallsettings.js';
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_STRICT_MARKER } from '../src/turnidle.js';
import { MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

/** Hard-wrapped prose read as one line, so a re-wrap never reds a row and a row never depends on a wrap. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');

/** A named window of a document, from one distinctive marker to the next, so a match elsewhere in a long file cannot
 *  satisfy a row about this passage. Both anchors are asserted with their own message. */
const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  return flat(text.slice(a, b));
};

const [KILL, LIVE, ESCALATE, W2LIVE] = STALL_MARKERS as [string, string, string, string];
const STRICT = MAIL_GATE_STRICT_MARKER;
const BUSY = MAIL_GATE_BUSY_MARKER;
const MAIL_OFF = MAIL_DISABLED_MARKER;

const hours = (ms: number): string => {
  expect(ms % 3_600_000, `${ms} ms is not a whole number of hours`).toBe(0);
  return `${ms / 3_600_000} h`;
};
const minutes = (ms: number): string => {
  expect(ms % 60_000, `${ms} ms is not a whole number of minutes`).toBe(0);
  return `${ms / 60_000} min`;
};

/** The quiet time's one definition in prose: the built-in, then the range the server accepts. */
const QUIET_DEFINED = `for the quiet time (${hours(STALL_QUIET_MS)} unless Settings sets another, `
  + `${minutes(STALL_QUIET_MIN_MS)} to ${hours(STALL_QUIET_MAX_MS)})`;
/** The precedence the resolver keeps (§6.3), stated once for the documents. */
const NEVER_OVER = `never \`${KILL}\`, \`${MAIL_OFF}\` or \`${STRICT}\``;
/** §18's qualifying clause for a runbook `rm` whose marker a chosen level overrides. */
const WHILE_FOLLOWING = 'while Settings follows the fleet box\'s files; otherwise lower the level in Settings, or on the '
  + `fleet box touch \`${STRICT}\` (busy delivery) or \`${KILL}\` (the whole lane)`;
/** The built-in quiet time, standing alone: not the tail of `12 h` or of `12.5 h`. */
const BUILT_IN_ALONE = new RegExp(`(?<![\\d.])${hours(STALL_QUIET_MS)}\\b`, 'g');

const README = read('README.md');
const STALL = passage('README, the stall watch', README, '**The stall watch.**', '**What the skills do with the watch');
const GATE = passage('README, the mail gate', README, `\`touch $REG/${STRICT}\` on the fleet host`, '`/api/mail` (and its ack route)');
const WAVE2 = passage('README, the stall watch wave 2', README, '**The stall watch, wave 2.**', '**The honest boundary.**');

describe('README: the stall watch paragraph says the quiet time is chosen in Settings (§7, §18)', () => {
  it('r1 names the quiet time once, with the built-in and the range derived from the constants', () => {
    expect(STALL).toContain(`its main loop has sat \`idle\` or \`shell\` ${QUIET_DEFINED} with no mail either way`);
  });

  it('the dialog cap and the two check-rate sentences say the quiet time, and no other built-in 2 h is left', () => {
    expect(STALL).toContain('push per dialog after the quiet time)');
    expect(STALL).toContain('at least once per quiet time keeps r1 from ever falling due');
    expect(STALL).toContain('draws a check about once per quiet time');
    expect(STALL.match(BUILT_IN_ALONE), 'the built-in quiet time is spelled only inside its definition').toHaveLength(1);
  });

  it('the backoff names its peak, the ceiling, and no longer the old 8 h', () => {
    expect(STALL).toContain(`doubles it, then doubles it again, never past ${hours(STALL_BACKOFF_CEILING_MS)},`);
    expect(STALL).not.toContain('8 h at most');
  });

  it('a level chosen in Settings overrides the arming markers, never the three that win over it', () => {
    expect(STALL).toContain('A level chosen in Settings (`/api/coord/stall-watch`) overrides the arming markers (');
    expect(STALL).toContain(NEVER_OVER);
  });
});

describe('README: the mail gate paragraph and the runbooks say a chosen level can stand behind a marker (§18, §20)', () => {
  it('strict\'s runbook says removing it lets a held choice apply, not merely that it goes back', () => {
    expect(GATE).not.toContain(`\`touch $REG/${STRICT}\` on the fleet host restores the idle-only gate; \`rm\` it to go back.`);
    expect(GATE).toContain('`rm` it to lift it: under a level chosen in Settings, whatever of that level it held back');
  });

  it('the busy gate sits behind two more markers or a level chosen in Settings', () => {
    expect(GATE).toContain('only behind two more markers, touched and removed by hand and written by nothing in the '
      + 'tree, or a level chosen in Settings.');
  });

  it('the override sentence names the busy markers it overrides and the three it never does', () => {
    expect(GATE).toContain('A level chosen in Settings (`/api/coord/stall-watch`) overrides both busy markers');
    expect(GATE).toContain(NEVER_OVER);
  });

  it('the busy runbook\'s rm is qualified with §18\'s clause', () => {
    expect(GATE).toContain(`\`rm ${BUSY}\` goes back ${WHILE_FOLLOWING}.`);
  });

  it('the wave-2 runbook\'s rm is qualified with the same clause', () => {
    expect(WAVE2).toContain(`before touching \`${W2LIVE}\``);
    expect(WAVE2).toContain(`\`rm\` it to go back to wave 1's ladder ${WHILE_FOLLOWING}.`);
  });

  it('CONTROL: the two fixed 2 h constants stay fixed sentences, untouched by the quiet time', () => {
    expect(WAVE2).toContain(`a second within ${hours(FAILED_REPEAT_MS)} goes to the coordinator`);
    expect(WAVE2).toContain(`the check sits undelivered for ${hours(CHECK_UNDELIVERED_MS)};`);
  });
});

describe('CLAUDE.md: the override and the loss list (§18)', () => {
  const CLAUDE = read('CLAUDE.md');

  it('the mail-gate bullet says a level chosen in Settings overrides the arming markers, and the markers keep no writer', () => {
    const bullet = passage('CLAUDE.md, the mail-gate bullet', CLAUDE,
      "- **The mail gate's idle includes `shell`, and a stall watch backs it**", '- **Done-fingerprint re-measures');
    expect(bullet).toContain('A level chosen in Settings (`/api/coord/stall-watch`, the operator\'s control) overrides the '
      + `arming markers, but ${NEVER_OVER}; the markers still have no writer.`);
  });

  it('the coord.db bullet lists the stall-watch settings choice among what a lost database loses', () => {
    const bullet = passage('CLAUDE.md, the coord.db bullet', CLAUDE, '- `~/.ccrc/coord.db`:', '- **Zero new ccd verbs');
    expect(bullet).toContain('mail, claims, asks, central pool edges, update intents, the stall-watch settings choice — is '
      + 'gone without the snapshot');
  });
});

describe('the parent stall-watch spec: the pointer and the three amended passages (§1 Related, §18)', () => {
  const PARENT = read('docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md');
  const STATUS = passage('the parent spec, its status block', PARENT, '**Status:**', '**Date:**');

  it('the status block points at the settings design', () => {
    expect(STATUS).toContain('Amended 2026-10-05 by `2026-10-05-stall-watch-settings-design.md`');
  });

  it('§4.2: no marker gains a writer, and a level chosen in Settings can override the arming markers', () => {
    const s42 = passage('the parent spec §4.2', PARENT, '### 4.2 The run-worker stall lane', '## 5. Wave 2');
    expect(s42).toContain(`Every marker is touched and removed by hand on the fleet box, the \`${MAIL_OFF}\` precedent`);
    expect(s42).toContain('No marker gains a writer, but a level chosen in Settings can now override the arming markers');
    expect(s42).toContain(NEVER_OVER);
  });

  it('§10: the PWA renders none of the constants but the quiet time, and both kill rules are qualified', () => {
    const s10 = passage('the parent spec §10', PARENT, '## 10. Measurement, targets, and sequencing', '## 11. Decisions');
    expect(s10).not.toContain('`MAIL_ARMED_HOLD_MS`; the PWA renders none):');
    expect(s10).toContain('the PWA renders none of them but the quiet time, which Settings shows and sets');
    expect(s10).toContain(`\`rm ${LIVE}\` ${WHILE_FOLLOWING}`);
    expect(s10).toContain(`\`rm ${ESCALATE}\` ${WHILE_FOLLOWING}`);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)/server" && ./node_modules/.bin/vitest run test/stall-settings-prose.test.ts`

Expected (measured on the prototype, against the unedited documents): `Tests 14 failed | 1 passed (15)`. The one that passes is `CONTROL: the two fixed 2 h constants stay fixed sentences, untouched by the quiet time`. Every other row is red, each on its own missing sentence.

- [ ] **Step 4: Edit the three documents**

Each "before" below is whole lines and occurs exactly once in its file (Step 1's `grep -c`, and `str.count == 1` for the whole block). Replace it with the "after" exactly. Some "after" lines run past 80 columns; README already carries longer lines, and the suite reads prose flattened.

**README.md (a), strict's runbook and the busy gate's markers (≈3825–3828).** Before:

```text
`touch $REG/mail-gate-strict` on the fleet host restores the idle-only gate;
`rm` it to go back. The stall watch's turn marker (below) can sharpen the
gate, but only behind two more markers, touched and removed by hand and
written by nothing in the tree. Under the default (and under
```

After:

```text
`touch $REG/mail-gate-strict` on the fleet host restores the idle-only gate;
`rm` it to lift it: under a level chosen in Settings, whatever of that level it
held back (busy delivery, the further checks) then applies. The stall watch's
turn marker (below) can sharpen the gate, but only behind two more markers,
touched and removed by hand and written by nothing in the tree, or a level
chosen in Settings. Under the default (and under
```

**README.md (b), the override sentence and the busy runbook (≈3842–3845).** Before:

```text
`mail-gate-strict`, then `mail-gate-busy`, then `mail-gate-busy-shadow`, then
the default. Runbook: touch `mail-gate-busy-shadow` and read 48 h of its
lines, each checked against its session's transcript; then touch
`mail-gate-busy` and `rm` the shadow marker. `rm mail-gate-busy` goes back.
```

After:

```text
`mail-gate-strict`, then `mail-gate-busy`, then `mail-gate-busy-shadow`, then
the default. A level chosen in Settings (`/api/coord/stall-watch`) overrides
both busy markers (Log only, Check and Alert give busy-shadow, Deliver and
Everything give busy, Off leaves the markers' mode), but never
`stall-watch-disabled`, `mail-disabled` or `mail-gate-strict`. Runbook: touch
`mail-gate-busy-shadow` and read 48 h of its lines, each checked against its
session's transcript; then touch `mail-gate-busy` and `rm` the shadow marker.
`rm mail-gate-busy` goes back while Settings follows the fleet box's files;
otherwise lower the level in Settings, or on the fleet box touch
`mail-gate-strict` (busy delivery) or `stall-watch-disabled` (the whole lane).
```

**README.md (c), r1's quiet time (≈4080–4081).** Before:

```text
ball is the worker's and its main loop has sat `idle` or `shell` for 2 h with
no mail either way, it mails the worker a `stall-check:` from `operator` (r1:
```

After:

```text
ball is the worker's and its main loop has sat `idle` or `shell` for the quiet
time (2 h unless Settings sets another, 30 min to 12 h) with no mail either way, it mails the worker a `stall-check:` from `operator` (r1:
```

**README.md (d), the dialog cap (≈4098).** Before:

```text
after 2 h), a usage limit (one `⚠ limit` push after 12.5 h) and a `busy`
```

After:

```text
after the quiet time), a usage limit (one `⚠ limit` push after 12.5 h) and a `busy`
```

**README.md (e), the override sentence in the stall-watch paragraph (≈4109).** Before:

```text
coordinator mails and the operator pushes too. The quiet clock restarts on ANY
```

After:

```text
coordinator mails and the operator pushes too. A level chosen in Settings
(`/api/coord/stall-watch`) overrides the arming markers (`stall-watch-live`,
`stall-watch-escalate`, the wave-2 one below and the mail gate's busy pair), but
never `stall-watch-disabled`, `mail-disabled` or `mail-gate-strict`; the markers
still have no writer, and the choice lives in `coord.db`. The quiet clock restarts on ANY
```

**README.md (f), the first check-rate sentence (≈4111).** Before:

```text
mails the worker there at least every 2 h keeps r1 from ever falling due. Time
```

After:

```text
mails the worker there at least once per quiet time keeps r1 from ever falling due. Time
```

**README.md (g), the second check-rate sentence (≈4121).** Before:

```text
episode: a worker in a long legitimate wait draws a check about every 2 h, and
```

After:

```text
episode: a worker in a long legitimate wait draws a check about once per quiet time, and
```

**README.md (h), the backoff (≈4125), for the 16 h ceiling (`backoff-ceiling-from-the-horizon` (D-4025)).** Before:

```text
it, to 4 h and then 8 h at most, and any other mail from the worker resets it.
```

After:

```text
it, then doubles it again, never past 16 h, and any other mail from the worker resets it.
```

**README.md (i), the wave-2 runbook (≈4262).** The line before it ends `` `rm` it to go back to wave 1's ``. Before (one line, `grep -c '^ladder\.$'` is `1`):

```text
ladder.
```

After:

```text
ladder while Settings follows the fleet box's files; otherwise lower the level
in Settings, or on the fleet box touch `mail-gate-strict` (busy delivery) or
`stall-watch-disabled` (the whole lane).
```

README ≈4209 ("a second within 2 h") and ≈4226 ("the check sits undelivered for 2 h") are fixed constants (`FAILED_REPEAT_MS`, `CHECK_UNDELIVERED_MS`), not the quiet time. They stay as they are; the suite's CONTROL row holds them.

**CLAUDE.md (a), the README size claim (≈10).** Before: `**`README.md` (~5600 lines) is the canonical system overview.` After: `**`README.md` (~5700 lines) is the canonical system overview.` The rest of the line is unchanged.

**CLAUDE.md (b), the `coord.db` loss list (≈255–256).** Before:

```text
  what it adds on top — mail, claims, asks, central pool edges, update intents — is gone without the snapshot
  every `ccrc update` (and `ccrc backup`) takes into `~/ccrc-backups/<ts>/` (`pool-edges.log` is never replayed).
```

After:

```text
  what it adds on top — mail, claims, asks, central pool edges, update intents, the stall-watch settings choice —
  is gone without the snapshot every `ccrc update` (and `ccrc backup`) takes into `~/ccrc-backups/<ts>/`
  (`pool-edges.log` is never replayed).
```

**CLAUDE.md (c), the mail-gate bullet's last line (≈316 at `77f8d63a5`, ≈317 after Task 6).** Before:

```text
  like `mail-gate-strict`, have **no writer in the tree** — `single-definition.test.ts` pins that.
```

After:

```text
  like `mail-gate-strict`, have **no writer in the tree** — `single-definition.test.ts` pins that. A level chosen in
  Settings (`/api/coord/stall-watch`, the operator's control) overrides the arming markers, but never
  `stall-watch-disabled`, `mail-disabled` or `mail-gate-strict`; the markers still have no writer.
```

Task 6's box-token sentence (≈277–282) and the session-only list stay byte for byte.

**The parent spec (a), the status pointer (≈3).** Before (one line):

```text
**Status:** rev 3.1, APPROVED by the operator 2026-09-29 11:58 UTC (§11 records the rulings). Wave 1 is being planned. Amended by the operator 2026-10-04: §6.1's coordinator clause only (§11 decision 13).
```

After (the same line, then three new lines):

```text
**Status:** rev 3.1, APPROVED by the operator 2026-09-29 11:58 UTC (§11 records the rulings). Wave 1 is being planned. Amended by the operator 2026-10-04: §6.1's coordinator clause only (§11 decision 13).
- **Amended 2026-10-05 by `2026-10-05-stall-watch-settings-design.md`** (stall-watch settings): a level and a quiet
  time chosen in Settings can override the arming markers and `STALL_QUIET_MS`; §4.2's marker paragraph and §10's
  constants line and kill rules say so.
```

**The parent spec (b), §4.2's marker paragraph (≈474–476).** Before:

```text
Every marker is touched and removed by hand on the fleet box, the `mail-disabled` precedent:
`ssh <fleet-host> 'touch ~/.cc-sessions/stall-watch-live'`, and `rm -f` to remove. The lane reads it at its next 60 s
tick.
```

After:

```text
Every marker is touched and removed by hand on the fleet box, the `mail-disabled` precedent:
`ssh <fleet-host> 'touch ~/.cc-sessions/stall-watch-live'`, and `rm -f` to remove. The lane reads it at its next 60 s
tick. No marker gains a writer, but a level chosen in Settings can now override the arming markers, though
never `stall-watch-disabled`, `mail-disabled` or `mail-gate-strict` (stall-watch settings design 2026-10-05, §6.3).
```

**The parent spec (c), §10's constants line (≈839).** Before:

```text
`MAIL_ARMED_HOLD_MS`; the PWA renders none):
```

After:

```text
`MAIL_ARMED_HOLD_MS`; the PWA renders none of them but the quiet time, which Settings shows and sets, stall-watch
settings design 2026-10-05 §7):
```

**The parent spec (d), §10's kill rules (≈874–876).** Before:

```text
precision (strict 0.48, loose 0.69 at 2 h). The kill rules (proposed, not measured, §11 decision 12): if armed r1 fires
exceed 10 a day for two days, `rm stall-watch-live`; if more than half of a week's hand-classified r2 fires are
legitimate waits, `rm stall-watch-escalate`; then re-derive.
```

After:

```text
precision (strict 0.48, loose 0.69 at 2 h). The kill rules (proposed, not measured, §11 decision 12): if armed r1 fires
exceed 10 a day for two days, `rm stall-watch-live` while Settings follows the fleet box's files; otherwise lower the
level in Settings, or on the fleet box touch `mail-gate-strict` (busy delivery) or `stall-watch-disabled` (the whole
lane). If more than half of a week's hand-classified r2 fires are legitimate waits, `rm stall-watch-escalate` while
Settings follows the fleet box's files; otherwise lower the level in Settings, or on the fleet box touch
`mail-gate-strict` (busy delivery) or `stall-watch-disabled` (the whole lane). Then re-derive.
```

No D-number is written into any document: the ledger floor is seeded from prose (CLAUDE.md), so the numbers ride the commit message only.

- [ ] **Step 5: Run it to verify it passes, and measure the edit's shape**

```bash
cd "$(git rev-parse --show-toplevel)"
(cd server && ./node_modules/.bin/vitest run test/stall-settings-prose.test.ts | grep -E '^ +Tests ')
git diff --numstat -- README.md CLAUDE.md docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md
wc -l README.md CLAUDE.md docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md
```

Expected (measured): `Tests 15 passed (15)`. Numstat: `7	4	CLAUDE.md`, `28	14	README.md`, `12	4	docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md`. Line counts: `5698 README.md`, `386 CLAUDE.md` (with Task 6's sentence), `1000` for the parent spec.

- [ ] **Step 6: The mutation table**

Apply each mutation alone to the edited tree, run `./node_modules/.bin/vitest run test/stall-settings-prose.test.ts` from `server/`, then restore the file byte for byte. When the table is done, `git status --short` lists only this task's four files. The control is Step 5's green, `15 passed (15)`.

| # | Guard | Mutation (old → new, in the file named) | Red in | Measured |
|---|---|---|---|---|
| MP1 | r1 names the quiet time and its range | README: "for the quiet⏎time (2 h unless Settings sets another, 30 min to 12 h) with" → "for 2 h with" | `r1 names the quiet time once…` | `1 failed \| 14 passed (15)` |
| MP2 | the dialog cap says the quiet time | README: "dialog⏎after the quiet time)," → "dialog⏎after 2 h)," | `the dialog cap and the two check-rate sentences…` | `1 failed \| 14 passed (15)` |
| MP3 | the backoff names the 16 h ceiling | README: "it, then doubles it again, never past 16 h," → "it, to 4 h and then 8 h at most," | `the backoff names its peak…` | `1 failed \| 14 passed (15)` |
| MP4 | the stall paragraph names all three that win | README: "but⏎never `stall-watch-disabled`, `mail-disabled` or `mail-gate-strict`; the markers" → "but⏎never `stall-watch-disabled`; the markers" | `a level chosen in Settings overrides the arming markers…` | `1 failed \| 14 passed (15)` |
| MP5 | strict's runbook (§20) | README: the two-line "`rm` it to lift it: … then applies." → "`rm` it to go back." | `strict's runbook says removing it lets a held choice apply…` | `1 failed \| 14 passed (15)` |
| MP6 | "or a level chosen in Settings" | README: "tree, or a level⏎chosen in Settings. Under" → "tree. Under" | `the busy gate sits behind two more markers…` | `1 failed \| 14 passed (15)` |
| MP7 | the busy runbook's clause | README: "`rm mail-gate-busy` goes back while Settings follows" → "`rm mail-gate-busy` goes back. While Settings follows" | `the busy runbook's rm is qualified…` | `1 failed \| 14 passed (15)` |
| MP8 | the wave-2 runbook's clause | README: the three-line "ladder while Settings follows … (the whole lane)." → "ladder." | `the wave-2 runbook's rm is qualified…` | `1 failed \| 14 passed (15)` |
| MP9 | CLAUDE.md's override sentence | CLAUDE.md: delete " A level chosen in⏎  Settings (…) … the markers still have no writer." | `the mail-gate bullet says a level chosen in Settings…` | `1 failed \| 14 passed (15)` |
| MP10 | CLAUDE.md's loss list | CLAUDE.md: "update intents, the stall-watch settings choice —" → "update intents —" | `the coord.db bullet lists the stall-watch settings choice…` | `1 failed \| 14 passed (15)` |
| MP11 | the parent spec's escalate kill rule | parent spec: "`rm stall-watch-escalate` while⏎Settings follows" → "`rm stall-watch-escalate`; while⏎Settings follows" | `§10: the PWA renders none of the constants…` | `1 failed \| 14 passed (15)` |
| MP12 | the parent spec's §4.2 amendment | parent spec: "No marker gains a writer, but a level chosen in Settings can now override the arming markers, though" → "No marker gains a writer, though" | `§4.2: no marker gains a writer…` | `1 failed \| 14 passed (15)` |
| MP13 | the prose is grounded in the constant | `server/src/coord/stallsettings.ts`: `export const STALL_QUIET_MAX_MS = 12 * 3_600_000;` → `export const STALL_QUIET_MAX_MS = 11 * 3_600_000;` | `r1 names the quiet time once…` | `1 failed \| 14 passed (15)` |

`⏎` marks a line break in the file.

- [ ] **Step 7: The regression suites**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus' | grep -E '^ +Tests '
for f in readme-holds pools-prose box-token-census topology-clean crossrepo-prose dtbd oss-metadata child-reclaim-prose \
         readme-roster-mirror coord-pause-route coordinator-skill worker-skill reviewer-skill license \
         ccrc-install-graphify single-definition auth-gate; do
  echo "$f: $(./node_modules/.bin/vitest run test/$f.test.ts | grep -E '^ +Tests ')"; done
./node_modules/.bin/vitest run test/ccrc-update.test.ts -t README | grep -E '^ +Tests '
./node_modules/.bin/vitest run test/session-hook.test.ts | grep -E '^ +Tests '
git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts | grep -E '^ +Tests '
```

Expected (measured on the prototype):
- The citation instrument: `7 passed | 328 skipped (335)`, unchanged. README's new text spells no `file:line`.
- Per suite: `readme-holds` 17, `pools-prose` 27 (the README size claim: 5698 against "~5700"), `box-token-census` 23, `topology-clean` 55, `crossrepo-prose` 17, `dtbd` 1, `oss-metadata` 22, `child-reclaim-prose` 4, `readme-roster-mirror` 5, `coord-pause-route` 20, `coordinator-skill` 161, `worker-skill` 52, `reviewer-skill` 15, `license` 15, `ccrc-install-graphify` 58, `single-definition` 274, `auth-gate` 160, all passed.
- `ccrc-update -t README`: `1 passed | 504 skipped (505)`. `session-hook` whole: `335 passed (335)`.
- `deviation-refs`: `31 passed` on the branch that carries this plan. In the prototype it measured `1 failed | 30 passed (31)`, before and after this task alike: `floorFromScan over the real tracked tree` names `server/src/coord/routes.ts names D-4034` (Task 6's citation). The prototype carries no plan defining the wave's numbers; this plan does. This task writes no D-number into any tracked file.

`session-hook` is a known load flake: re-run a red one alone, with `--testTimeout=240000`, before calling it real.

- [ ] **Step 8: Typecheck**

```bash
cd "$(git rev-parse --show-toplevel)/server"
./node_modules/.bin/tsc --noEmit -p . && ./node_modules/.bin/tsc --noEmit -p test/tsconfig.tests.json && echo tsc-clean
```

Expected: `tsc-clean`.

- [ ] **Step 9: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add README.md CLAUDE.md docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md server/test/stall-settings-prose.test.ts
git commit -m "$(cat <<'MSG'
docs(stall-watch): README, CLAUDE.md and the parent spec say what a level and a quiet time chosen in Settings do

README: the quiet time is defined once, at r1 (2 h unless Settings sets
another, 30 min to 12 h: quiet-half-hour-steps (D-4026)), and named at the
dialog cap and in both check-rate sentences. The backoff names its 16 h
ceiling (backoff-ceiling-from-the-horizon (D-4025)). The stall-watch and
mail-gate paragraphs carry the override sentence, and the busy gate sits
"behind two more markers, or a level chosen in Settings". The busy and
wave-2 runbooks' rm are qualified with the spec's clause. Strict's runbook
says that lifting it lets a held choice apply (strict-holds-the-wave-2-step
(D-4023)). The two fixed 2 h constants stay as they are.

CLAUDE.md: the override sentence, the coord.db loss list, and the README
size claim moved to ~5700. The parent spec: its status pointer, §4.2's
marker paragraph, and §10's constants line and kill rules.

stall-settings-prose.test.ts pins each sentence, its numbers derived from
their constants and its marker names from their definers.
MSG
)"
```

---

## Deviations found

The coordinator issued this programme's block on 2026-10-05 at 17:47, through `POST /api/ledger/deviations`. This plan
defines the thirteen numbers wave 1 owns, one per slug, and no other.
- **W2's numbers are not defined here.** The W2 plan defines its own two (`older-server-404-reads-not-configured`,
  `notifications-label-says-push`), so `deviation-refs.test.ts` never reads one as defined in two plans.
- **D-4034 is defined here once.** W2's plan cites it for the sheet, and does not define it again.

- **D-4022** — `files-level-match-ignores-the-busy-gate` (Task 1, `stallLevelOf`):
  - *Departs from:* §2 decision 1, approved: "A box-file combination that matches no step reads 'custom (box files)'".
  - *Why:* reading a level back treats `shell`, `busy-shadow` and `strict` alike, so the busy gate alone never splits
    a level (§6.4, §19 Q1). With that rule, a box with no files reads "Log only" with the busy gate off, and today's
    fleet (`stall-watch-live` plus `mail-gate-busy-shadow`) reads Check exactly. `stages.busyGate` reports the gate
    separately.
  - *Cost if wrong:* a box running a level without its busy gate reads as that level. The operator could then think
    the busy-shadow evidence is being gathered when it is not. W2's busy-gate-off note discloses this.
  - *Pinned by:* M5 and M22.
- **D-4023** — `strict-holds-the-wave-2-step` (Task 1, `resolveStallWatch`; Task 7, README's strict runbook):
  - *Departs from:* §2 decision 1, approved: "otherwise a chosen level decides".
  - *Why:* under `mail-gate-strict`, a chosen level's wave-2 step is held off, because strict has switched busy
    delivery off and the arming track runs the wave-2 step only with busy delivery (R38; §5, §6.2).
  - *Cost if wrong:* a chosen Everything under strict runs as Alert and reads `held`, so the further checks do not
    run until strict is removed. The held line and `wave2HeldByStrict` say so.
  - *Pinned by:* M3b and M23.
- **D-4024** — `busy-clock-starts-when-busy-delivery-starts` (Tasks 3 and 5):
  - *Departs from:* goal 4 and §2 decision 1's "otherwise the box files decide, as today". Rev 3 promised that W1
    changes nothing until a value is written.
  - *What changes:* when the mail gate moves into busy delivery while the server runs, under `follow` or a chosen
    level, the stall sweep judges busy as the busy gate until the mail sweep has applied busy once. After that,
    mail-stuck's clock is `max(stop, busySince)`. At boot the clock is today's.
  - *Why:* today a raise into busy delivery, by any path, can push a false stuck-mail notice on the first busy pass.
  - *Cost if wrong:* a genuinely stuck mail under busy delivery reads stuck up to `MAIL_STUCK_MS` later than today,
    after each move into busy. A flapping fault restarts that grace on a bug path only (§20, settled below).
  - *Pinned by:* M4, M8, M8a and M8b.
- **D-4025** — `backoff-ceiling-from-the-horizon` (Task 3, `stallBackoff`):
  - *Departs from:* §2 decision 3, approved: "All other timings stay fixed in code".
  - *What changes:* the computed working-reply backoff is capped at
    `STALL_BACKOFF_CEILING_MS = BACKLOG_HORIZON_MS - 2 * (STALL_BOUND_MS + STALL_OPERATOR_MS)`, which is 16 h.
  - *Why:* at a 12 h quiet time the uncapped backoff reaches 24 h and 48 h, past the lane's 24 h mail read. The
    replies that justified the backoff would then fall out of the read, the episode would re-key, and r1 would be
    sent again (§7).
  - *Cost if wrong:* above an 8 h quiet time the backoff stops doubling at 16 h. The default's 8 h peak is unchanged,
    as the first relation pin proves.
  - *Pinned by:* M9b and the four relation pins.
- **D-4026** — `quiet-half-hour-steps` (Task 1, `isStallQuietMs`; Task 2, `decideStallSettings`):
  - *Departs from:* §2 decision 3, approved: "adjustable from 30 min to 12 h". The approved text names no step.
  - *What changes:* the server accepts only multiples of 30 min within the range, inclusive, and refuses anything
    else with 400, never clamping it.
  - *Why:* the PWA's list and the server's rule are one rule, and a stored value is always the value sent (§7).
  - *Cost if wrong:* a hand `curl` of, say, 45 min is refused.
  - *Pinned by:* M10 and M11.
- **D-4027** — `counts-by-role` (Task 2, `stallNoticeCounts`; `stall.ts`'s `stallArmHasRung`):
  - *Departs from:* §2 decision 4, approved: "48 h notice counts per rung, sent versus shadow".
  - *What changes:* there are four rows by role: checks to quiet workers, notices a session gets about its own work,
    reports that may reach you instead, and pushes to you.
  - *Why:* the observation detail records no recipient, and the verdicts can override the rung table (`stallW2Notify`,
    `stallFailedInner`), so no row may claim a recipient (§11).
  - *Cost if wrong:* the operator cannot read a per-rung count. The `checks` row is still the figure the parent
    spec's kill rule reads.
  - *Pinned by:* M17 and M17b.
- **D-4028** — `run-events-at-index` (Task 4, `schema.ts`):
  - *Departs from:* §2 decision 5, approved: "Storage in `~/.ccrc/coord.db`, through one migration". The approved
    shape named only the settings table.
  - *What changes:* the same migration also adds `run_events_by_at`, unconditionally.
  - *Why:* the existing index leads on `runId`, so the 48 h window read on `at` would scan the table. Measured on Node
    v22.13.0 and v24.14.1, `EXPLAIN QUERY PLAN` gives `SEARCH run_events USING INDEX run_events_by_at (at>?)`.
  - *Cost if wrong:* one more index write on each `run_events` insert.
  - *Pinned by:* M17d.
- **D-4029** — `unknown-keys-refused` (Task 2, `decideStallSettings`; Task 6, the POST):
  - *Departs from:* §2 decision 5, approved: "behind a caps-style door". The caps door ignores unknown keys.
  - *What changes:* the POST refuses an unknown key with 400 and names it.
  - *Why:* this follows the update-intent precedent: a newer PWA that sends a knob this server lacks must hear that
    it was not applied (§10).
  - *Cost if wrong:* a newer client gets a 400 rather than a silently partial write.
  - *Pinned by:* M14.
- **D-4030** — `no-coord-mutex-for-stall-settings` (Task 6, the POST; Task 4, the store's expected-state compare):
  - *Departs from:* §2 decision 5, approved: "caps-style door". The caps door runs under `coordMutex`.
  - *What changes:* the write is one synchronous transaction, with no `await` from the route's read to the write.
  - *Why:* nothing decides a dispatch on these values, and the sweeps read them synchronously too (§10).
  - *Cost if wrong:* a later edit that puts an `await` between the effect and the write would let a concurrent write
    slip in. The store's expected-state compare would then answer `conflict` and write nothing (M27b). If review
    prefers the mutex, wrapping the one call costs nothing.
- **D-4031** — `no-op-write-records-no-feed-event` (Task 2, `stallPatchIsNoOp` and `stallSettingsChange`; Task 4, the
  store's skip; Task 6, the feed row):
  - *Departs from:* §2 decision 5, approved: "Every change is logged to the activity feed".
  - *What changes:* a write that changes no named field skips its `UPDATE`, so `updatedAt` does not move, and it
    records no feed event (§8, §19 Q4).
  - *Cost if wrong:* a repeated identical write leaves no trace in the feed.
  - *Pinned by:* M12b and M15a.
- **D-4032** — `stages-on-the-wire-not-modes` (Task 1, `stallStages` and L0's `StallWatchStages`):
  - *Departs from:* §2 decision 4's read-only part, approved: "the current level, what it does, and where it comes
    from". The view would otherwise ship the box's own mail-mode words.
  - *What changes:* the reply carries five derived stage booleans and the held flags, never a `MailTurnMode` word.
  - *Why:* `MailTurnMode` gains no second definition in L0, and the PWA keeps no mode knowledge (§12).
  - *Cost if wrong:* the PWA cannot print the raw mode. Strict shows only as `held.gateStrict`.
  - *Pinned by:* M22.
- **D-4033** — `server-decides-the-confirm` (Tasks 2, 4 and 6):
  - *Departs from:* §2 decision 2, approved: "Raising the level asks for a confirm that shows the gate text". The
    approved text left open who decides.
  - *What changes:* the POST measures what a write does, from the row as it stands and the row the write will leave
    (`stallSettingsAfter`), against the listing it just took. It refuses with 409 `confirm-required` until the body
    carries the matching `effectKey`. The store writes only over the row the route measured.
  - *Why:* the PWA holds no ladder, and a confirm decided in a browser would be decided on a stale row (§10).
  - *Cost if wrong:* every write that needs a confirm takes two round trips. A registry whose `readdir` alternates
    between `null` and a listing reopens the sheet (§20, accepted).
  - *Pinned by:* M26, M27 and M27b.
- **D-4034** — `confirm-on-stage-diff` (W1: the effect, Task 2's `stallWriteEffect` and `stallNeedsConfirm`; W2: the
  sheet, which cites this number):
  - *Departs from:* §2 decision 2, approved: "Raising the level asks for a confirm", by rank.
  - *What changes:* a confirm is asked for a write that turns a stage on, now or once the fleet box's kill switch or
    strict gate is removed (`heldByBox`). It is also asked on leaving the further checks, and on a quiet time brought
    below the current one or the built-in. Each gate belongs to the stage it guards.
  - *Why:* rank misses writes that arm more without raising: Follow over files that arm more, Off over a busy file
    turning busy delivery back on, held stages, and a lowered quiet time (§5.1, §13).
  - *Cost if wrong:* more confirms than a rank rule would ask for. A quiet-time raise that stays below the built-in
    also confirms (§20; W2 needs a sheet line for it).
  - *Pinned by:* M26 and M28.

**Departures found during execution** are numbered by the coordinator, from the programme's reserve.
- None is written here, as a number or otherwise.
- Name any departure in the wave-done mail by its slug only.
- The coordinator assigns its number at wave-done and adds its `D-` entry to this section. Never take one yourself.
- Candidates the prototype already raised for a ruling: the derived `StallStored` in place of §12's inline spelling
  (Task 1); `stallSettingsAfter`'s third argument `at` (Task 2); `stallBoxHeld` added to L1 (Task 6); the M16b pin
  placed in `stall-settings-route.test.ts` (Task 6); and the new prose suite (Task 7).

## Residue settled by this plan

The spec's §20 items, and the open readings the tasks closed, are settled as follows. A residue item that belongs to
W2 is carried to W2's plan, under "After the merge".

- **Task 1.**
  - **The Next step's row conversion.** The private `stallRowArming(run)` turns a ladder row into an arming (with
    `disabled: false` and `mailDisabled: false`). The resolver's free arm and `stallNextStep` share it. An `off` next
    row answers `waitsOn: []`.
  - **The Next step under Follow with the kill file, or Alert chosen under strict.** Kept as §10 states. The Next
    step reads the ladder from the effective reading, and the POST's confirm discloses held stages through
    `heldByBox`. Pinned: a chosen `check` under strict steps to `alert`, waiting on alerts.
  - **An absent row, L1 half.** `parseStallSettings` answers both fields `unreadable` and `updatedAt: null` whenever
    `stored` is not `'row'`, and `stored` tells absent from unreadable. The wire mapping and the unchecked radio are
    W2's.
- **Task 2.**
  - **`stallEffectKey`'s word for a `null` `updatedAt`** stays `none`. Every write through the door stamps a
    safe-integer `updatedAt`, and the store's raw compare still refuses to write over a row changed by hand.
  - **"Busy delivery stops" listed first (§15).** L1 answers `turnsOn` and `turnsOff` in §5.1 order. The sheet's line
    order is W2's.
  - **A quiet-time raise that stays below the built-in** keeps §10's definition: it is `quietLowered` and needs a
    confirm. W2's `stallConfirmLines` needs a line for it.
  - **A row with both fields unreadable.** The projection, like the store's update arm, writes only the named fields.
    A patch that names both repairs both in one write.
  - **The projection.** `stallSettingsAfter(before, patch, at)` stamps the store's `updatedAt`, and applies the no-op
    skip through the exported `stallPatchIsNoOp`, the one compare the store reuses.
  - **Decide's order.** Unknown keys are checked before the "neither field" refusal. Key presence is an own property,
    so a JSON `__proto__` key is refused as unknown, by name.
- **Task 3.**
  - **A stall sweep between a raise into busy and the first mail sweep that applies it** judges `busy-shadow`, as
    specified. In that window of 10 s or less, only a turn stopped more than `DELEGATE_CAP_MS` plus `MAIL_STUCK_MS`
    ago can read stuck, which today would push too.
  - **`busySince` restarting on every busy → non-busy → busy move.** `stallBusyClock` is pure and stores nothing. The
    restart rule is the watcher's own field writes (Task 5).
- **Task 4.**
  - **A table missing for good.** It reads `unreadable`, and a write throws, which is the route's 500. The repair is
    the migration, never Settings.
  - **`setReadBigInts` on the Node floor.** Measured on v22.13.0 (a scratch tarball) and on v24.14.1: without it,
    `ERR_OUT_OF_RANGE`; with it, the `bigint` and `'abc'` reads; and the same `EXPLAIN` plan on both.
  - **The slot** was re-measured as 16 at `6f6923cd8`, so this entry is 16 → 17.
  - **The write's order.** The write throws on its own unreadable read BEFORE the expected-state compare, so a
    `conflict` never carries an unreadable `before`.
- **Task 5.**
  - **The restart rule is kept.** `busySince` restarts on every applied busy → non-busy → busy move, with no
    hysteresis. That only matters on a bug path, and the fault itself warns once and is reported.
  - **`lastFallback` is one field.** Shipped code cannot produce a fault that depends on `mailDisabled` alone.
  - **The warn latch** has four states (absent, unreadable, level, quiet). Each warns once in its own words, and all
    of them re-arm when a read applies.
  - **The boot trace** prints only when the first readable read applies a chosen level or a chosen quiet time.
  - **`lastFallback.at`** is the latest throw. An unreadable or absent row is not a fallback.
- **Task 6.**
  - **A throw in the view's second `try`.** `effective` stays `{ measured: false }`, and a throw in `stallNextStep`
    or `stallFilesExceed` leaves `next` and `filesExceed` out. No fallback is claimed, and no 500 is answered.
  - **The view builder's catch warns** once per standing fault for each of three parts, and re-arms when that part
    next succeeds.
  - **The files-only fallback reading.** Its source is `'files'`. Its `held` comes from the new L1 `stallBoxHeld(box)`,
    which the resolver also builds on.
  - **A `readdir` that alternates between `null` and a listing** gets no change. Each 409 carries the effect it
    measured.
  - **Fastify's 500** is kept, and its `message` names the cause.
  - **With a `null` listing,** the quiet time still reports the stored choice.
- **Task 7.**
  - **The strict runbook** now reads "`rm` it to lift it: under a level chosen in Settings, whatever of that level it
    held back … then applies", as §20's coordinator item asks (D-4023).
  - **The "2 h" sites.** "(2 h unless Settings sets another, 30 min to 12 h)" appears once, at r1. The dialog cap and
    the check rates say "the quiet time", and the backoff sentence names its 16 h peak. The fixed
    `FAILED_REPEAT_MS` and `CHECK_UNDELIVERED_MS` sites stay as they are, held by a CONTROL row.

## If this PR is overtaken before it merges

**When to absorb.** Only on worker clause 16's measured triggers, each read after one `git fetch origin`:
- your probe exits 1 with a tree id;
- a required check is red while `main` passes the same tests;
- or a `fix-round` mail names this PR as ejected or next to land.

Absorb with `git merge origin/main`, never a rebase and never a force-push, and keep BOTH sides of every hunk. Then
re-run the named suites below, and send a fresh wave-done fingerprint.

**The migration slot moves up if another branch takes it.** If `main` gains a `user_version 16 -> 17` entry first:
- renumber this entry to the next free slot: its banner, and `COORD_SCHEMA_VERSION`, which derives from it;
- update the version pins in `coord-db.test.ts` and `asks-store.test.ts`, and the new entry's own diff test, which is
  written against `SLOT - 1`;
- add the one-line comment recording the move, as entries 12, 15 and 16 do;
- re-measure the slot before the PR and again before merge.

Re-run `coord-db`, `asks-store`, `stall-settings-store`, `stall-store` and `coord-store`.

**Census numerals move with the route count.** If `main` gains a route, move each of these by the same amount, and
re-run `auth-gate`, `coord-pause-route` and `box-token-census`:
- `auth-gate.test.ts`'s two pins, which this wave leaves at 33 and 91;
- its needle numerals at ≈:451, ≈:901 and ≈:965;
- `auth/gate.ts` ≈:8, which this wave leaves at 88.

If `main` gains another `SESSION_ONLY` member, keep both, and the `CLAUDE.md` sentence names every member ("The other
three" moves with them).

**`shared/api.ts`.** If another PR has also appended at EOF, keep both blocks whole. Re-run `session-hook` in full, and
check that the per-file census `'shared/api.ts': 1` holds.

**`mail-routes.test.ts`.** If `main` has added a kebab union, `isStallSettingsKebab` keeps its own place and its failure
message. Re-run `mail-routes`.

**README and `CLAUDE.md`.** At planning, #284 and #248 also edit README, and #248 also edits
`coordinator-skill.test.ts`. On a README merge:
- re-run the citation instrument (`7 passed | 328 skipped (335)`, or `main`'s count, measured on `main` first);
- re-run `stall-settings-prose`, `readme-holds` and `pools-prose`;
- if README then sits more than 100 lines from `CLAUDE.md`'s "~5700", move the claim in the same merge commit, as the
  ratchet asks. At planning the merged README is 5743 lines.

**Always, after any absorption:**
- `git fetch origin main`, then `deviation-refs`, which must read 31 passed with no number defined in two plans;
- `single-definition`, `stall-vocabulary`, `turnidle`, `stall-settings`, `stall-sweep`, `mail-sweep`,
  `stall-settings-route` and `typecheck-tests`;
- both `tsc` runs.

Judge each mutation table by its `failed` count and the names of the failing rows. A shift in the `passed (N)` total
from `main`'s rows is not a finding.

**A co-edit of the same text.** If a landed change edits the same sentence this wave edits, stop and name the
conflict by slug in the wave-done mail, quoting both texts. The coordinator rules on the text first. The sentences
are the mail-gate bullet, a README runbook, the parent spec's kill rules, or `stallIdleStart`. Never resolve two edits
of the same sentence mechanically.

## After the merge (orchestrator, read-only)

The release lane carries the server, and nothing rolls a box by hand.
1. **The merge becomes a prerelease** within about a minute (`release-main.yml`). Confirm that
   `gh release view <tag> --json targetCommitish,tagName` names the merge commit.
2. **Moving the boxes is the update control plane's job.** It is done by the operator's tap (`POST
   /api/updates/apply`), or by `ccrc rollout --to <tag>`, fleet box first. The orchestrator measures and never
   rolls out. When the server box's `/health` `version` names the tag, read `~/.ccrc/update.json`'s phase report on
   that box: the health gate passed, and the run exited 0, not 4.
3. **The deploy changed nothing,** because the seed is `follow` plus the built-in. Check the server journal since the
   restart:
   - no `ccrc-server: stall-watch settings not applied` line;
   - no `… chosen in Settings overrides the box files` boot trace;
   - no `ccrc-server: stall-watch view:` line.

   Any one of those means the migration or the read did not land as planned: report it, and change nothing.
4. **The operator's read, through a session (W1 has no section).** `GET /api/coord/stall-watch` answers 200 with:
   - `chosen` `{ level: 'follow', quietMs: 'default', stored: 'row' }`;
   - `effective.source: 'files'`, and on today's fleet (`stall-watch-live` plus `mail-gate-busy-shadow`)
     `effective.level: 'check'`;
   - `quiet.effectiveMs` 7200000 with source `default`;
   - `fallback: null` and `notices.ok: true`.

   The orchestrator writes nothing through this door. Every write and every arming is the operator's, and R38's
   gates are unchanged.
5. **Record and dispatch.** Record W1's merge, the release tag and the view reading in the programme ledger. Then
   dispatch W2, which depends on W1 being merged. W2 defines 4035 and 4036, cites D-4034, and carries the residue
   left to it:
   - `stallConfirmLines`' line for a quiet time raised but still below the built-in;
   - the `refused` toast's `{detail}`, when the body has none or Fastify's 500 puts the cause in `message`;
   - the label wordings Task 1 chose;
   - whether `dueFromOff` takes a `{label}` slot;
   - `chosen.level: 'unreadable'` on an absent row, which checks no radio.
6. **A rollback to a pre-W1 build is safe.** It ignores the table, and with the seed still in place nothing re-arms.
   The confirm and files-exceed warnings matter only once a choice has been written.
