# Accounts connect A13: check records the identity and runs the seed; enable needs a ready lane

**Goal:** plan Task A13 of `2026-10-18-accounts-connect.md` (spec §6.2 steps 8 and 9, §3.4, §10; G1, G19; D-5518). A lane's sessions must not stall on Claude Code's first-run wizard, and `enable` must not switch on a lane whose sign-in, seed or last check is missing. OA1a's record (`2026-11-01-accounts-oa1-record.md`) decides the order: for the sign-in method, `.claude.json` exists before the first check and the probe does not add `hasCompletedOnboarding`, so the seed runs in-verb after the probe and writes the flag itself. The decisions this task makes are numbered D-7731 below.

**Before this change:** `check` recorded only `check: {verdict, at}`. Nothing set `hasCompletedOnboarding` or copied trust flags, and `enable` removed the marker for any rostered lane.

**Change:**
- `deploy/account-op.mjs`:
  - `lane-state` takes `--identity` with `--identity-source` (`measured` or `stated`, held to the server reader's grammar), `--last-run-at` (a time or `now`) and `--seed-verified-at`.
  - A new `seed` op finds the lane's `.claude.json` from the roster, seeds it, reads it back, and records `seedVerifiedAt`. It records through `laneStateWrite`, the write half of `lane-state`, which is cut out of `opLaneState` so the file keeps one writer.
  - A new read-only `ready` op answers `enable`'s readiness question from the roster and the lane-state file.
  - `health` takes the seed op's answer (`--seed-answer`) and carries `seed: {verifiedAt, trustCopied}`, or `seed: {verifiedAt: null, error}` when the seed refused.
- `ccd/ccrc`:
  - `check` keeps the `auth status` body. After the probe turn it records `lastRunAt`, then runs the seed op. For a sign-in lane it records the identity `auth status` names.
  - `ccrc account seed --id` is a CLI verb and joins `ACCT_SUBS`. It is not an agent sub.
  - `enable` asks `ready` under the lane lock, before the placement lock, unless `--force` is given. `--force` is accepted on the CLI only.
  - `_inst_lane_state`, the step `ccrc install` and `ccrc update` share, ends with a seed of every lane, under its lock, with `--when unseeded`.
- `README.md` documents `seed`, the seed inside `check`, and `enable`'s readiness and `--force`.

**Tests:**
- New: `server/test/ccrc-account-check-seed.test.ts` and `server/test/ccrc-account-enable-ready.test.ts`.
- Extended: `server/test/ccrc-account-backfill.test.ts`, which holds the update case.
- `ccrc-account.test.ts`, `account-markers-pin.test.ts`, `ccrc-account-lane-state.test.ts` and `ccrc-account-lock.test.ts` are adjusted where they enable a lane that is not ready: their marker cases pass `--force`, and the lock-order case marks the lane ready with `laneStateFixture.ts`'s new `markReady`. The malformed-argv case's unknown flag is no longer `--force`, and the credential case's expected lane state keeps `check`'s run and seed times.
- Every new row was run red against `main`'s `ccd/ccrc` and `deploy/account-op.mjs` before it was run green.

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| seed before the probe | ccrc-account-check-seed | "after check the flag reads true and `seedVerifiedAt > lastRunAt`", and the trust case |
| `ccrc update` skips the seed (the shared step's seed loop counts nothing as seeded) | ccrc-account-backfill | "`ccrc update` seeds a lane whose `.claude.json` lacks the onboarding flag…" |
| copy every trust flag the upstream has (any value, not only `true`) | ccrc-account-check-seed | "only trust flags accepted upstream are copied…" |
| enable without the seed clause | ccrc-account-enable-ready | the no-seed case |
| `>=` for `>` between seed and run | ccrc-account-enable-ready | the same-instant case of "a seed older than the last run" |

**Per width × skin × mode:** no UI, so "no UI" in all sixteen cells. A14 shows the readiness reason.

## Decisions

- **D-7731 (2026-11-01)** — `check-seed-and-enable-ready-as-built` (accounts plan Task A13; spec §6.2 step 9, §10; G1, G19): the as-built decisions of A13, and where it departs from the plan's wording.
  1. **The order follows OA1a.** The seed runs in-verb after the probe turn. There is no headless first run, because the sign-in method's file exists before the check and the probe never writes the flag. The token methods were not measured, so an absent `.claude.json` is created (0600) in a config directory that exists. A missing directory is refused with `seed-no-config-dir` and is never made.
  2. **Which file.** The upstream lane's `.claude.json` is `$HOME/.claude.json`, because its plain `claude` sets no `CLAUDE_CONFIG_DIR`. Every other lane's file is `<config dir>/.claude.json`. Trust is copied from the upstream lane's file only. This is the spec's "upstream or home lane", read as the upstream, because no other lane is a fixed source.
  3. **What the seed writes.** It always writes `hasCompletedOnboarding: true`. It writes `theme` only when the file has none: the upstream lane's theme, or else `dark`. It writes only the trust flags (`hasTrustDialogAccepted`, `hasClaudeMdExternalIncludes*`) that the upstream holds as `true`, project by project, creating a minimal project entry where the lane has none. No other project field is copied. `trustCopied` counts the projects this run changed, so a re-verify answers 0. A file that already holds every value is not rewritten.
  4. **No lost update.** The write is a temp file renamed over the file. The file's bytes are compared with the ones read just before the rename. If a Claude Code run wrote the file meanwhile, the seed starts over, up to three times, and then refuses with `seed-raced`. A file that is not a JSON object is refused with `seed-unreadable` and left byte for byte.
  5. **Times.** `lastRunAt` is stamped right after the probe, before the seed, so a seed that refuses leaves the lane reading "not verified after its last run". `seedVerifiedAt` is the seed op's own clock, read after its read-back, and the op records it itself. Both are milliseconds, so a seed in the same second as its run still reads as after it. `seedVerifiedAt > lastRunAt` is strict: an equal time is not ready.
  6. **The identity.** The identity is the `email` of an `auth status --json` that says `loggedIn: true`. It is recorded on a sign-in lane only (Anthropic, no secrets file), with `identitySource: measured`, the server reader's word. It is written separately, so an identity the writer refuses costs only itself. A token lane's identity is never recorded, because its `auth status` cannot name the approving account (spec §3.4).
  7. **"A credential present"** is read where the lane keeps one. For a lane whose roster names a secrets file, that file is measured as present and non-empty at `enable`. For a sign-in lane, the lane state must record a `measured` identity, which `check` writes only when the lane's own `auth status` said it was signed in. For a lane whose credential ccrc does not read (codex, a declared launcher), the passing last check is the record.
  8. **The reasons.** The first reason that applies wins, in this order: `no-lane-state`, `not-checked`, `check-failed`, `no-credential`, `seed-unverified`. They ride the `not-ready` envelope as `reason`, beside the sentence. A backfilled legacy lane reads "Check it once to turn it on". The words extend the server's display-only `LANE_NOT_READY_REASONS`, which stays as it is until A14.
  9. **A seed refusal inside `check`** is `seed: {verifiedAt: null, error}`. Its sentence is the op's own stderr line, not a note. The check's verdict stands, and `enable` stays not-ready.
  10. **Install and update.** The seed runs at the end of `_inst_lane_state`, not as a new spine step, so `CCRC_INST_SPINE` is unchanged. Each lane is seeded under its own lock. It is seeded only when its `.claude.json` exists without the flag, and `seedVerifiedAt` is recorded. A lane with no file has never run, and its first check seeds it. The step prints one line only when it seeded something; a busy lane or a refusal is left to the lane's next check. The plan names `server/test/ccrc-update.test.ts`, which does not exist. The update case is in `ccrc-account-backfill.test.ts`, which drives the spine step `ccrc update` runs and pins its place.
  11. **`credential` keeps the run and seed times.** They describe the lane's `.claude.json`, not its secret, so only `check` is dropped on a rotation (D-5755 (12)).
  12. **The logic lives in `deploy/account-op.mjs`, not in `ccd/ccrc`.** This keeps the net growth of `ccd/ccrc` under the growth check's limit (D-5848). The paths, the trust copy, the credential question and the reasons are node's, and bash only orders the steps and holds the locks. The identity's C0 and DEL check is the imported `LABEL_UNSAFE_RE` (D-2022). The roster-writer census in `ccrc-account.test.ts` now cuts out both `laneStateWrite` and `opSeed`, because neither writes the roster.
