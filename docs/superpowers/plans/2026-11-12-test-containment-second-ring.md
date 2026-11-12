# Test containment: the second ring, the poison teardown, and residue R35(f)

- **D-8394 (2026-11-12)** — The test suite's containment carried past the centralised-update programme (residue R35(a), (e) and (f), issue #2083): the update suites and the thin `ccrc-*` builders start from `ccrcContainedEnv` or ask `net`; every shared poison logs its hit in a per-file ledger and the suite's teardown fails a test whose poison record nothing took, with one standing allowance for a manager's read-only state query; a bus path is judged physically; `loginctl` is a contained tool; every `ghContainedEnv` caller gets the fixture user bus; `ccd-version.test.ts` keeps its builder's bus pair.

## Why

The centralised-update programme closed with three test-containment items carried in #2083 ("Tests and
containment"), all written in `docs/superpowers/programs/centralised-update-management.md` under R35:

- **(a)** the second ring: direct `ghContainedEnv` callers kept the real ssh, scp and curl, and ten `ccrc-*` files
  with thin builders (`ghContainedEnv(process.env)`, no `systemd`) kept the real user bus too (wave 18, D-5253);
- **(e)** from review 535: a harness cleanup that reports any poison record left behind, so a test that meets a
  poison and stays green is a standing red rather than a one-time log; also the symlinked bus value;
- **(f)** from review 577: a bus path through `sym/..` resolved inside HOME lexically but not physically;
  `ccd-version.test.ts` overwrote its builder's bus pair; `loginctl` was not in `CONTAINED_TOOLS`; a thin builder
  without `systemd` kept the caller's bus pair.

## What changed

### (a) The second ring, in the update suites and the thin `ccrc-*` builders

R35(a) measured more than 25 files (114 files and 195 call sites remain below), so this change does the update
suites and the thin `ccrc-*` builders, file by file:

| File | Builder now |
|---|---|
| `updateIntentFixtures.ts` (`nodeEnv`), `update-intent-cross-side.test.ts` (`envWithoutJq`) | `ccrcContainedEnv(…, { managers: true, curl: 'poison' })`; the fixture curl stubs are planted in `~/.local/bin` and kept |
| `ccd-update-sync.test.ts` (six spawns) | `ghContainedEnv(…, { systemd: true, tmux: true, net: true })`; its three curl stubs moved from `~/bin` to `stubContainedTool` (the reason `net` measured 91 reds in wave 18) |
| `ccrc-restamp`, `ccrc-approval-key`, `ccrc-versioned-audit`, `ccrc-passwd`, `ccrc-rollout` | `ccrcContainedEnv(…, { managers: true, curl: 'poison' })` |
| `ccrc-uninstall` (a spine builder: it fronts its own manager pair) | `ccrcContainedEnv(…, { managers: false, curl: 'poison' })` |
| `ccrc-account`, `ccrc-expose` | `ghContainedEnv(…, { net: true })` and their own poisons; not `ccrcContainedEnv`, whose tmux records into `tmux-calls` (the log `ccrc-account` keeps apart from its tmux poison) and whose launchctl poison `ccrc-expose` must not have. `ccrc-account` plants a `loginctl` poison too, and its bin-listing census admits ssh, scp and loginctl |
| `ccrc-doctor-fleet-box` | unchanged builder, gh-only (now with the fixture bus). Measured: `net` or `ccrcContainedEnv` plants into `~/.local/bin`, which `doctorEnv`'s PATH puts ahead of the doctor fixture's own stub dir, and the doctor run after the remedy met a curl poison instead of its stub (two reds) |

`ccrc-containment.test.ts` gains a census of the second ring: every `ghContainedEnv(` call in those eleven files asks
`net: true`, or the file has no such call and builds from `ccrcContainedEnv`.

### (e) The poison teardown

- `containedTools.ts` keeps a ledger per test file under the run's TMPDIR. Every shared poison (`plantPoison`,
  `ghContainedEnv`'s gh, the loopback curl front's refusals, and the hand-written poisons of `ccrc-cli` and
  `ccrc-expose`) appends `hit <record>\t<argv>` beside its record, so a HOME a test removes itself cannot take the
  hit with it.
- `tmpHelpers.ts` checks the ledger after every test, and scans each `mkTmp` directory for any `*-poison` file before
  removing it; `makeCcdHarness`'s `cleanup` scans its HOME first. A record nothing took fails that test, naming the
  record and its first argv; it is then marked, so one leak reds once.
- A case that meets a poison on purpose reads it through `takePoisonRecord` (or `ghPoisonAt`, which now takes).
  `takeExpectedPoison` takes a record only when every line matches a named argv: the doctor runners take the doctor's
  own `gh auth status` probe (`DOCTOR_GH_PROBE`); `ccrc-expose`'s runners take the duckdns arm's
  `--user daemon-reload` and `enable --now` against its "no session bus" systemctl poison.
- One standing allowance, in the teardown itself: a manager record holding only read-only state queries
  (`launchctl print gui/<uid>/<label>`, `systemctl --user is-active <unit>`, `loginctl show-user <uid>
  --property=Linger`). ccrc's status, removal and doctor paths ask these, a poison answers `unknown`, and nothing on a
  box can change through them. Any other argv in the same record is a leak.
- `ccrc-doctorFixture.ts`'s `ghStub` logs every argv to `gh-calls` and only an unmatched one to `gh-poison`: before,
  every healthy box left a `gh-poison` record.
- The symlinked bus value: `busUnder` and `assertNoRealTool` read the bus path physically (`physicalPath`), so a
  symlink under HOME to a runtime dir outside it is refused.

What the full local run found (macOS, every server file), tests that met a poison and stayed green:
`ccd-harness-containment` (two gh cases; H18-3's three net cases were moved to `takePoisonRecord` first),
`ccd-project-add` (ssh), `ccd-pool-sync` (curl, which had its own guard), `ccd-ws-expire-audit` (gh: the plain audit asked for the session's PRs with no stub; it now has
`GH_STUB`), `ccrc-account` (tmux, three cases), `ccrc-cli` (curl and the manager poisons, read and now taken),
`ccrc-containment`'s curl-front cases, and the doctor suites (`ccrc-doctor-*`, the gh probe on boxes without a stub).

### (f) The four smaller gaps

1. A bus path through `sym/..`: `physicalPath` walks to the deepest existing ancestor without lexical normalisation
   and takes `realpathSync.native` of it (the JS `realpathSync` resolves `..` lexically first).
2. `ccd-version.test.ts`'s `runCcdNoPython3` no longer overwrites its builder's pair with one under `/tmp`; it asserts
   `assertNoRealTool` on the env it spawns with.
3. `loginctl` joins `CONTAINED_TOOLS`. `ccrcContainedEnv` plants its poison beside ssh, scp and launchctl, and
   `ghContainedEnv` plants it with the managers (`systemd: true`), so `makeCcdHarness` still plants every contained
   name at creation.
4. A thin builder without `systemd`: `ghContainedEnv` now sets the fixture bus for every caller, the gh-only one
   included, unless the caller's own pair lies physically under HOME. The bus is an environment value, not a
   poison, so it is on by default as `containedAuthBase` is; H18-7 pins it for the gh-only, tmux-only and net-only
   callers.

## Proof by mutation (each reverted)

- `physicalPath` replaced by `path.resolve`: the `sym/..` case and the symlinked-bus case red.
- `loginctl` removed from `CONTAINED_TOOLS`, or from `ccrcContainedEnv`'s plant list: the loginctl case reds.
- The gh-only return without the bus: H18-7, the thin-builder bus case and the symlinked-bus case red.
- The read-only allowance widened to any argv: the "write beside its state query" case reds.
- `plantPoison` without its ledger line: the three ledger cases red.
- The per-test hook removed from `tmpHelpers.ts`: the wiring pin reds.
- `net: true` removed from one `ccrc-expose` builder: the second-ring census reds.
- `ccd-version`'s `/tmp` bus pair restored: its python3-absent case reds on `assertNoRealTool`.

## Verification

- `server`: `tsc --noEmit -p .` and `-p test/tsconfig.tests.json` clean (the agent half is environmental here).
- Every server test file, in sixteen shards on macOS, with `ccrc-account.test.ts` run separately in three name
  ranges: no poison record left. The remaining reds are this Mac's known environmental ones (GNU tar, Node 26 deep
  nesting, the real disk notice, `typecheck-tests`' pwa compiler path) and in-process push and question pins that
  red on the unmodified `tmpHelpers.ts` too; `deviation-refs` reds until this file defines D-8394.
- The census and ratchet tests in `server/test` and the four in `pwa/test`: green.
- Not measured here: the Linux-only cases (`itLinux`, `describeLinux`). A poison those meet and nobody takes reds on
  the Linux legs; its fix is a take at that case.

## Deviations found

- R35(a) is more than 25 files. The remaining ring, 114 files and 195 `ghContainedEnv` call sites with no `net`,
  each for a later test wave, file by file:
  `approvals-doctor`, `authAttemptFixture`, `ccd-account-auth-private-socket`, `ccd-account-auth` (12),
  `ccd-account-pane`, `ccd-archive`, `ccd-backend-vs-placement` (7), `ccd-bounded-reads`, `ccd-browser-spawn`,
  `ccd-carry-dedupe-sweep`, `ccd-ccclip` (2), `ccd-child-reclaim-audit`, `ccd-child-reclaim-entry` (9),
  `ccd-child-reclaim-hardening` (2), `ccd-child-reclaim-pause`, `ccd-child-tmpdir`, `ccd-clip`, `ccd-coord-pause`,
  `ccd-crosspool`, `ccd-crumb-parse`, `ccd-docs-helper-redactor` (4), `ccd-entry-install` (6), `ccd-fable-default`,
  `ccd-forget`, `ccd-id-cap`, `ccd-lifecycle-emit` (2), `ccd-lifecycle-gen` (6), `ccd-lifecycle-pairs`,
  `ccd-lifecycle-purge` (7), `ccd-limit-banner` (2), `ccd-limits`, `ccd-operator-choice`, `ccd-pane-box-draft`,
  `ccd-place-class`, `ccd-plat-timeout`, `ccd-pool-sync`, `ccd-pr-admin-merge`, `ccd-pr-open`, `ccd-pr-state`,
  `ccd-project-pool` (3), `ccd-restart-cause`, `ccd-roster-preamble`, `ccd-route-apply`, `ccd-route-argv`,
  `ccd-route-tick`, `ccd-route-verb`, `ccd-scratch-rescue-reach`, `ccd-session-state`, `ccd-spawn-account-settings`,
  `ccd-spawn-child-settings`, `ccd-spawn-fleet-pins`, `ccd-spawn-split`, `ccd-start-id`, `ccd-stop-argv-order`,
  `ccd-substrate`, `ccd-supervised-start`, `ccd-svc-real-home`, `ccd-sync-uuid`, `ccd-tick-budget`,
  `ccd-tick-diet-clock-seam`, `ccd-tick-diet-seams`, `ccd-tmux-anchor` (2), `ccd-tool-adj`, `ccd-version` (2),
  `ccd-win-size`, `ccd-ws-add-base`, `ccd-ws-add-child` (2), `ccd-ws-audit`, `ccd-ws-collect-reach`,
  `ccd-ws-expire-reach` (2), `ccd-ws-lease-mark-reach`, `ccd-ws-orphan-verb` (5), `ccd-ws-reap`,
  `ccd-ws-shed-deps-reach`, `ccd-ws-title` (2), `ccdDocsHelpers` (2), `ccdTickDietRunner` (3),
  `ccdargv-dash-id-parity`, `ccdargv-dec-parity`, `ccgpt-harness` (3), `ccgpt-runtime`, `ccrc-api-inbox` (2),
  `ccrc-api`, `ccrc-codex-lifecycle`, `ccrc-doctor-fleet-box` (2, by measurement above), `ccrc-doctor-graphify`,
  `ccrc-doctorFixture`, `ccrc-models-advance`, `ccrc-models-lock`, `ccrc-models`, `ccrcApiClient`,
  `ccrcCodexFixture`, `codex-bridge-backend` (4), `compact-lock-darwin-probe`, `delegation-adopt-switch`,
  `docsHelperPy`, `five-less-writer-reader`, `hook-helpers-generated` (10), `laneStateFixture`,
  `log-line-redact-corpus` (2), `models-probe`, `name-sweep`, `notify-push` (2), `pane-scope-stop-route`,
  `scope-sweep-switch`, `testbox-admin-access`, `testbox-admin-acts`, `testbox-admin-connect`,
  `testbox-admin-contract`, `testbox-admin-key-rotate`, `testbox-admin-verb`, `testbox-parity` (2),
  `testbox-remote-gate`, `testbox-routes`. Every one of them now gets the fixture user bus (f4); what they keep is the
  real ssh, scp and curl.
- R35(e)'s last clause, the census's named spellings (a script path followed by arguments, three namespace
  spellings, lexical scope and destructuring), is not in this change: it widens `raw-spawn-census.test.ts`, not the
  teardown, and stays residue.
- The doctor fixtures (`ccrc-doctorFixture.ts`, `ccrc-doctor-graphify.test.ts`) and `ccrc-doctor-fleet-box` keep
  their gh-only `ghContainedEnv`: their stub directory sits behind `~/.local/bin` on the doctor's PATH, so a `net`
  poison would answer instead of the stub.
