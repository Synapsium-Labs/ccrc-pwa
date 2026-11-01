# Centralised update management, wave 33: the bootstrap installer gets the updater's release-host defences, and the {own, fleet} health pair is retired: Implementation Plan

This is the programme's last engineering wave. On 2026-11-01 the operator asked for the remaining engineering to be finished and the programme closed. A read-only audit of the design spec against `main` found three gaps. This wave closes two of them:

- **R48.** `install.sh`, the bootstrap installer, has none of the release-host defences wave 24 gave the updater.
- **Spec §14's last step.** `FleetHealth.builds`, the `{own, fleet}` pair, is still declared and sent, though no reader is left.

The third gap is out of this wave, along with two related items:

- **Node floor.** The `@sigstore/*` majors declare `engines.node` `^22.22.2 || ^24.15.0 || >=26`, wider than the repo's `>=22.16.0`. #1612 decided and measured this (`deploy/verify-provenance.mjs:38-52`), so it is not a gap (Reading 1).
- **The `stable` ruleset.** It lacks "Require linear history". The operator ruled on 2026-11-01 that the narrower rule stands (Reading 2).
- **R48's two related gaps** go to the programme's follow-up issue (Reading 3).

The deviation block is the numbers 7719 to 7726. Every citation below is `path:line` at `origin/main` `19bfcd704`, read with `git show 19bfcd704:<path>` (the audit read `6ad9d0f60`; every cited file is unchanged between the two except `server/src/server.ts`, whose cited lines did not move). The worker re-reads each one in the landed text before the task that edits it.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. The dispatched worker runs it under the `ccrc-worker` skill.

**Goal:** a first install over `install.sh` refuses a hostile release host's terminal escapes, unbounded checksum file and globbing URL the way `ccrc update` already does; and `/api/fleet/health` stops sending the two-box `builds` pair, while its `build` agreement word stays exactly as it is.

**Architecture:** two independent tasks and one gate, in one PR on this workspace's own branch. Task 1 edits `install.sh` and its tests only. `install.sh` is a bootstrap that sources nothing, so it carries its own copies of five updater defaults and one redaction rule, and a test holds those copies equal to `ccd/ccrc`'s. Task 2 removes a wire field under absence-permits: no reader of it is left (`pwa/test/build-line.test.tsx:270` already scans the PWA for one), `FLEET_PROTO` does not move, and the `build` word is still derived from the inventory rows.

**Tech Stack:** POSIX/bash shell (`install.sh`), TypeScript (server, shared, PWA tests), vitest.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` (§14, the `FleetHealth.builds` bullet at :1189-1193; §5 and wave 24's release-host defences for the installer).

## Global Constraints

- Branch discipline: commit on this workspace's own branch, never a separate feature branch.
- Every test and typecheck runs through `ccrc test -- <command>`, with `--maxWorkers=2` on vitest runs. Never bare, never under a `systemd-run` of your own.
- `install.sh` (`#!/usr/bin/env bash`) sources nothing: read its existing portability notes (the `SUM` shim at :84-99) before editing, and keep macOS working.
- The updater's release-host defaults are `CCRC_RELEASE_CONNECT_TIMEOUT=10` (`ccd/ccrc:2158`), `CCRC_RELEASE_SPEED_LIMIT=1024` and `CCRC_RELEASE_SPEED_TIME=30` (:2190-2191), `CCRC_RELEASE_SUMS_MAX_TIME=20` and `CCRC_RELEASE_SUMS_MAX_FILESIZE=4096` (:2205-2206). `install.sh` uses the same five values, honours the same five environment names when set, and a test reds when any of its copies differs from `ccd/ccrc`'s. That test is what makes the second copy a derived one (`server/test/single-definition.test.ts`'s rule); run that file too.
- The redaction rule is `_upd_redact` (`ccd/ccrc:2773`). `install.sh` carries a copy whose output a test compares with `_upd_redact`'s on the same inputs.
- Wire discipline: dropping `builds` is additive-only's other half, absence-permits. `FLEET_PROTO` and `FLEET_PROTO_MIN` stay 1. `build?: BuildAgreement` (`shared/api.ts:3702`) and its values are unchanged.
- Mutation-table discipline: every new guard ships with a test that reds when the guard is deleted or mutated, measured before and after, and recorded in As built.
- Never edit `ccd/ccd`, `ccd/ccd-entry*.py` or `ccd/contexts.tsv`. Never run `ccd` or `ccrc` against the live `$HOME`; fixture HOMEs only.
- Specs are historical: do not edit `docs/superpowers/specs/*`. README and `CLAUDE.md` text that describes `builds` is updated in this PR (Task 2).
- Nothing private in this public repo: no host, account, lane or other-project names in code, tests, commits or the PR text.

## Review Focus

1. A tarball name in SHA256SUMS that holds a `/`, a `..`, a control or other non-printable byte, or more than 128 bytes: refused before any `curl -o` writes it, with the name printed escaped or not at all.
2. A SHA256SUMS larger than 4096 bytes, or a host that trickles it forever: refused within the bounds, with the URL printed redacted.
3. A base URL carrying userinfo, a query or a fragment: every line `install.sh` prints (fetching, refusal, success) shows it redacted exactly as `_upd_redact` would.
4. A base URL holding `[`, `]`, `{` or `}`: curl fetches it literally (`-g`) on both release fetches.
5. Remote-mode `/api/fleet/health` carries no `builds` key, and its `build` word is still `agreed`, `skewed` or `unknown` for the same inventory rows as before; `ccrc update`'s `_upd_fleet_warn` (`ccd/ccrc:21522-21528`) still warns on `skewed`.

## File structure

| File | Task | Change |
|---|---|---|
| `install.sh` | 1 | `-g` and bounds on both release curls; redacted URL in every printed line; the tarball-name rule |
| an `install.sh` test file under `server/test/` (find the existing coverage first: `git grep -l install.sh server/test`; extend the closest file, or add `server/test/install-sh-release-host.test.ts`) | 1 | the five Review Focus rows for the installer, plus the equality pins |
| `shared/api.ts` | 2 | remove `builds?` (:3712) and fix its docstring |
| `server/src/server.ts` | 2 | stop emitting `builds` (:1287-1296); the comment at :300-312 says what is left |
| `server/src/fleetstate.ts` | 2 | `derivedBuilds` stays only if something still calls it; otherwise remove it and its tests |
| `server/test/fleet-health.test.ts` | 2 | :182 asserts `builds` is absent in remote mode |
| `pwa/test/build-line.test.tsx`, `fleet-host-banner.test.tsx`, `fleet-screen.test.tsx`, `use-fleet-health.test.tsx` | 2 | drop the `builds` decoys that no longer typecheck; keep the source scan at `build-line.test.tsx:270` |
| `README.md` (:938, :3739), `CLAUDE.md` (:354) | 2 | say the pair is gone, not that it is a view |

## Tasks

### Task 1: the bootstrap installer gets the updater's release-host defences (R48, W33-a)

R48's own text is in the programme ledger's residue section. In short, `install.sh`:
- has no `-g` on its two release curls (:72, :82);
- prints the base URL unredacted (:71, :81, and the refusal lines at :73 and :83);
- prints the host-supplied tarball name raw, with no length bound, no printable-ASCII rule and no refusal of a `/`, and that name reaches `curl -o` (:82) before any checksum check;
- fetches SHA256SUMS with no time or size bound (:72).

- [ ] **Step 1: write the failing tests.** Drive `install.sh` against a fixture release host. Reuse the fixture harness the existing install tests use (`server/test/ccrc-installFixture.ts`) if it can serve a release directory. If not, use a local HTTP server started by the test on a loopback port. Rows:
  - a `SHA256SUMS` naming `ccrc-../x.tar.gz`, `ccrc-a/b.tar.gz`, a name with an ESC byte, and a 129-byte name: each refused, exit 1, no file written outside the staging directory, and the raw name absent from stderr;
  - a 4097-byte `SHA256SUMS`: refused;
  - a host that sends `SHA256SUMS` slower than the speed floor: refused within `CCRC_RELEASE_SPEED_TIME` plus a margin (set the bounds small through their environment names so the row is fast);
  - `CCRC_RELEASE_BASE_URL` (`install.sh:51`, which builds `URL_DIR` at :52) carrying `user:pass@`, `?token=x` and `#frag`: no stdout or stderr line contains `pass`, `token=x` or `frag`;
  - a base path containing `[1]`: fetched literally;
  - the equality pins: `install.sh`'s five defaults equal `ccd/ccrc`'s five `: "${…:=…}"` lines, and its redaction gives byte-equal output to `_upd_redact` on at least eight inputs (plain, userinfo, query, fragment, all three, IPv6 literal, no scheme, empty).
- [ ] **Step 2: run them and watch them fail** for the expected reason: `ccrc test -- ./node_modules/.bin/vitest run --maxWorkers=2 test/<file>` from `server/`.
- [ ] **Step 3: implement in `install.sh`.**
  - the five defaults as `: "${NAME:=value}"` lines;
  - `-g` and the updater's flag set on both curls: connect timeout and the speed floor on both, and the total time and file-size bounds on SHA256SUMS only, as the updater does (:22347-22349);
  - a redaction function copied from `_upd_redact`, used on every printed URL;
  - the tarball-name rule before the second curl: `ccrc-` prefix and `.tar.gz` suffix as today, plus no `/`, no `..`, printable ASCII only, and at most 128 bytes. A refusal names the rule broken, never the raw name.
- [ ] **Step 4: run them and watch them pass**, then run every existing `install.sh` test file found in Step 1 and `server/test/single-definition.test.ts`.
- [ ] **Step 5: mutation rows.** Delete or weaken each defence in turn (the `-g`, the size bound, the speed floor, the redaction call, each name rule). Watch its row red, restore the defence from a saved copy, and record each pair in As built.
- [ ] **Step 6: commit** on this workspace's branch.

### Task 2: retire `FleetHealth.builds` (spec §14, W33-b)

Waves 2 and 3 made `builds` a view derived from the inventory rows and moved the PWA onto `NodeWire[]`. The last step, dropping the pair, was never cut into a wave.

- [ ] **Step 1: write the failing test.** Change `server/test/fleet-health.test.ts:182`'s remote-mode row to expect no `builds` key, and keep its `build: 'unknown'` expectation. Add a row with two inventory rows on different commits that still answers `build: 'skewed'` and has no `builds` key.
- [ ] **Step 2: watch it fail**, through `ccrc test`.
- [ ] **Step 3: implement.**
  - Remove `builds?` from `FleetHealth` (`shared/api.ts:3712`) and fix the docstring.
  - In `server/src/server.ts:1287-1296`, keep `const builds = …inventoryBuilds(…)` only as the input to `buildAgreement`, and stop spreading it into the answer.
  - Update the comment at :300-312.
  - Remove `derivedBuilds` from `server/src/fleetstate.ts` only if nothing else calls it (grep first).
- [ ] **Step 4: the PWA tests.** Remove the `builds` decoys that no longer typecheck (`build-line.test.tsx:215,237`, `fleet-host-banner.test.tsx:231,264`, `fleet-screen.test.tsx:2926`, `use-fleet-health.test.tsx:16`). Keep each test's assertion about what the PWA renders, and keep the source scan at `build-line.test.tsx:270` as the guard against a reader coming back.
- [ ] **Step 5: confirm the shell readers.** `ccd/ccrc`'s `_box_health` must read the `build` word, not `builds` (read the function; `_upd_fleet_warn` at :21522-21528 uses `BOX_HEALTH[2]`). If it reads `builds`, stop and mail the coordinator before going on.
- [ ] **Step 6: docs.** Change `README.md:938` and `:3739` and `CLAUDE.md:354` so they no longer say `builds` is a view; they say the pair was retired in this wave. Run the docs and citation suites that pin README and `CLAUDE.md` lines: `docs-parity`, the README API citation pins, and any suite that reds on a moved README line. Find them with `git grep -l "README.md" server/test | head`.
- [ ] **Step 7: run** `server/test/fleet-health.test.ts`, the four PWA files, the server and PWA typechecks (`npx tsc --noEmit -p test/tsconfig.tests.json` in `server/`, and the PWA's own typecheck script), and the doc suites, all through `ccrc test`.
- [ ] **Step 8: mutation row.** Put `builds` back into the answer and watch the server row red; remove it again. Record the pair.
- [ ] **Step 9: commit.**

### Task 3: the gate and the PR (W33-c)

- [ ] Copy this plan into the branch at its own path (`docs/superpowers/plans/2026-11-01-centralised-update-w33-installer-defences-and-pair-retired.md`) as the first commit, and append an `## As built` section at the end of the wave.
- [ ] Run `server/test/deviation-refs.test.ts` after `git fetch origin main`, through `ccrc test`. It must pass.
- [ ] Run the private-name scans on every changed file and on the PR title and body before pushing.
- [ ] Open one PR titled `fix(update): the bootstrap installer's release-host defences; the {own, fleet} health pair retired (wave 33)`. In its body, list each Review Focus row with the test that pins it, and the mutation table.
- [ ] Wait for the PR's CI run on the exact tip, then send wave-done.

## Readings (ruled by the coordinator before dispatch)

1. **The Node floor stays where it is.** #1612 (`8425f7566`) took `@sigstore/verify` to 4.1.2 knowing its declared range, and re-measured every verifier case on node 22.16.0, 24.14.1 and 26.5.0 (`deploy/verify-provenance.mjs:38-52`). A load failure is exit 3, never a verdict. Raising `engines` would red the doctor on boxes the verifier was measured to work on. Not in this wave.
2. **The `stable` ruleset stays as it is**, by the operator's ruling of 2026-11-01. It refuses deletion and non-fast-forward, and `release-stable.sh` refuses an untagged head. No coordinator writes a ruleset (coordinator clause 15).
3. **R48's two related gaps** go to the programme's follow-up issue, not to this wave: the contained curl front's macOS `-g` admission with no refused row for `-gK` or `-gx`, and the verifier's exit-3 dependency-load sentence printed unfiltered.

## Deviations found

Block 7719 to 7726, issued 2026-11-01 for this wave. Define a number only where this plan's text is departed from, and only from this block.

## As built

Commits on this workspace's branch, in order: the plan copy; Task 2 (W33-b); Task 1 (W33-a) and its fix round; this section; the unused block's rewording; the final review's fix wave (the installer's knob validation, a test title, one more compatibility pin); this section's last update.

**README lines carried to the coordinator's close-out docs PR (mail 13684).** Task 2 Step 6's two `README.md` sentences (`:938` and `:3739`) are not in this PR: `README.md` stayed under another programme's live claim for the whole wave, and the coordinator ruled that this PR lands without them and that its close-out docs PR, opened under its own claim once that one is released, changes them with `docs-parity` and the README pins in its gate. The File structure row for `README.md` is deviated by that ruling, with no deviation number. `CLAUDE.md`'s sentence is changed here.

### Rulings during the wave

- **Ask 280 (Task 1, URL redaction): userinfo only.** Measured on `main`: `_upd_redact` masks a URL's userinfo and this box's home directory, and passes a query (`?token=x`) and a fragment (`#frag`) through whole, as its own OUT OF SCOPE note says. So Step 1's row "no line contains `token=x` or `frag`" contradicted the Global Constraint that `install.sh`'s copy is byte-equal to `_upd_redact`. The operator and the coordinator ruled the same way: the Global Constraint and Review Focus row 3 govern; the query and fragment rows are dropped; the userinfo row stays; no refusal of a base URL carrying `?` or `#` is added. The coordinator carries that gap, and the updater's matching one, to the programme's follow-up issue. No deviation number: the plan's governing text is unchanged.
- **The redactor copy is held equal by OUTPUT, not by text.** `install.sh --release` runs before the script's macOS bash-3.2 refusal, and bash up to 4.2 keeps the quotes of a quoted `${s/pat/"rep"}` replacement literally (measured with `BASH_COMPAT=42` and `=40`: `https"://"h/r/...`; the userinfo was still removed). The copy's replacements are written as a first-occurrence replace with no pattern substitution (`s="${s%%"$m"*}$r${s#*"$m"}"`), which also avoids bash 5.2's `&` expansion in an unquoted replacement. Four pins hold it to `_upd_redact` byte for byte: under the default bash, under `BASH_COMPAT=42`, `=40` and `=32`, each over the eight named shapes and the log-line redaction corpus. No real bash 3.2 binary was run; the compatibility levels stand in for its quoting rule.
- **The five knobs are validated as the updater validates them** (the final review's fix wave). curl reads `0` as no limit for `--max-filesize`, `--max-time`, `--connect-timeout` and `--speed-limit` (measured: `--max-filesize 0` let a 10000-byte file through, exit 0), so honouring the five names without the updater's `_upd_validate_timeout` rule would let a `0` in the operator's environment switch a bound off. `install.sh` now uses a value only when it is a whole number from 1 to that knob's ceiling (3600 for the three time knobs, 100000000 for `CCRC_RELEASE_SPEED_LIMIT`, 1048576 for `CCRC_RELEASE_SUMS_MAX_FILESIZE`); anything else falls back to the default with one `install.sh: WARN:` line. A pin holds its defaults and ceilings equal to the ones `ccd/ccrc`'s `_upd_resolve` passes.
- **`derivedBuilds` stays.** It is still called by `inventoryBuilds`, whose pair is now only the input `buildAgreement` decides from; its comments no longer call that pair `FleetHealth.builds`.
- **Task 2, Step 5:** `ccd/ccrc`'s `_box_health` reads `j.build`, never `builds`, so nothing in the shell had to change and `_upd_fleet_warn` still warns on `skewed`.
- **`server/test/single-definition.test.ts`** is the directory `server/test/single-definition/` on `main`; all of it was run. No allowlist entry was needed for the installer's copies.
- **`server/test/fleet-build-skew.test.ts`** asserted the `builds` pair in about ten places and is changed with Task 2. `fleet-health.test.ts`'s two other remote rows (connected and disconnected) changed with its `:182` row.

### What pins each Review Focus row

| Row | Pinned by (`server/test/`) |
|---|---|
| 1. A tarball name with `/`, `..`, a control or non-printable byte, or over 128 bytes: refused before any `curl -o`, never printed | `install-sh.test.ts`: the name-rule rows (path separator, traversal, `..`, ESC, non-ASCII, UTF-8 caller locale, 129 bytes refused and 128 bytes installed, not a ccrc tarball, the `*` marker); each asserts exit 1, that the second fetch never ran, and that the raw name is on neither stream |
| 2. SHA256SUMS over 4096 bytes, or trickled forever: refused within the bounds, URL redacted | `install-sh.test.ts`: the 4097-byte row, the below-the-floor rows (SHA256SUMS and tarball), the above-the-floor trickle row ended by `--max-time`, the flag-set row, the five-defaults pin, the knob-validation rows (`0`, `abc` and the ceiling plus one, per knob) and the ceilings pin |
| 3. A base URL with userinfo: every printed line redacted exactly as `_upd_redact` would | `install-sh.test.ts`: the userinfo rows (a good run, a failed SHA256SUMS fetch, a failed tarball fetch) and the four redactor equality pins |
| 4. A base URL with `[`, `]`, `{` or `}`: fetched literally on both fetches | `install-sh.test.ts`: the `[1]` base path row (real curl) and the flag-set row (`-g` on both fetches) |
| 5. No `builds` key in remote mode; `build` unchanged; `_upd_fleet_warn` still warns on `skewed` | `fleet-health.test.ts` (the remote rows and the new two-rows-skewed row), `fleet-build-skew.test.ts`, `pwa/test/build-line.test.tsx`'s source scan for a `.builds` reader |

### Mutation table

Each mutant was applied to a saved, sha-checked copy, run against its covering tests, and restored from that copy.

| # | Mutation | Red |
|---|---|---|
| 0 | no `-g` on the SHA256SUMS fetch | `[1]` base path row; flag-set row |
| 1 | no `-g` on the tarball fetch | `[1]` base path row; flag-set row |
| 2 | no `--max-filesize` | 4097-byte row; flag-set; defaults |
| 3 | no `--max-time` | above-the-floor trickle row; flag-set; defaults |
| 4 | no speed floor on SHA256SUMS | below-the-floor SHA256SUMS row; flag-set; defaults |
| 5 | no speed floor on the tarball | below-the-floor tarball row; flag-set; defaults |
| 6 | no connect bound on the tarball | flag-set; defaults |
| 7 | SHA256SUMS "fetching" line unredacted | userinfo good-run row |
| 8 | tarball "fetching" line unredacted | userinfo good-run row |
| 9 | SHA256SUMS "download failed" line unredacted | userinfo SHA256SUMS-failed row |
| 10 | tarball "download failed" line unredacted | userinfo tarball-failed row |
| 11 | `/` rule removed | path separator row; traversal row |
| 12 | `..` rule removed | `..` row |
| 13 | printable-ASCII rule removed | ESC row; non-ASCII row |
| 14 | length bound removed | 129-byte row |
| 15 | length bound 127 | 128-byte-installs row |
| 16 | `ccrc-*.tar.gz` shape removed | not-a-ccrc-tarball row |
| 17 | `LC_ALL=C` dropped from the name rule | UTF-8 caller locale row |
| 18 | the whole name refusal skipped | every name row |
| 19 | the raw name printed again | every name row with a name to print |
| 20 | the `*` marker strip removed | marker row |
| 21 | `CCRC_RELEASE_SPEED_LIMIT` default 1024 to 2048 | defaults pin; flag-set |
| 22 | `CCRC_RELEASE_SUMS_MAX_FILESIZE` default to 1048576 | defaults pin; 4097-byte row; flag-set |
| 23 | redactor: trailing-slash HOME strip removed | the four redactor equality pins |
| 24 | redactor: userinfo rule weakened | the four redactor equality pins; the userinfo rows |
| 25 | redactor: the cut note reworded | the four redactor equality pins |
| 26 | redactor: the quoted `${s/…/"…"}` replacement put back (the copy before the fix round) | the `BASH_COMPAT=42`, `=40` and `=32` equality pins |
| 27 | `builds` put back into `/api/fleet/health`'s remote answer | `fleet-health.test.ts`: connected, disconnected, unreadable inventory, two-rows-skewed (4 of 51) |
| 28 | knob validation dropped | every knob-validation row; the ESC-value row |
| 29 | `CCRC_RELEASE_SUMS_MAX_FILESIZE` ceiling 1048576 to 1048577 | its knob row; the ceilings pin |
| 30 | `CCRC_RELEASE_SPEED_LIMIT` ceiling 100000000 to 100000001 | its knob row; the ceilings pin |
| 31 | `CCRC_RELEASE_CONNECT_TIMEOUT` ceiling 3600 to 3601 | its knob row; the ceilings pin |
| 32 | a refused value is warned about but not replaced by its default | every knob-validation row |

Two first choices were weak and were replaced: row 17 first survived because the fixture's sums file was written in latin1, so its byte was invalid UTF-8 under either locale; it now writes UTF-8. Row 25's first form (`4001` to `4002`) was an equivalent mutant.

### Deviations

None of the block 7719 to 7726 was used. Its three mentions in this plan are written without the `D-` prefix (ask 281, answered by the operator and confirmed by the coordinator): `server/test/deviation-refs.test.ts` reds on any D-ref above the highest defined entry, and this wave defines none.
