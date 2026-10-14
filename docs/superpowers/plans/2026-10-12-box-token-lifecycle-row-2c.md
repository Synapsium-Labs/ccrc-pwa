# Box token lifecycle, row 2c: D-139's two edges and review 391's residue: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Provenance: this is row 2c of the programme ledger `docs/superpowers/programs/box-token-lifecycle.md`, run 398 (wave 5 of 7). It was written on 2026-10-12 from `main` at `82464a449`, which is #353 (row 2b, the arming) squash-merged. Every citation below is `path:line` at `82464a449`. Review 391 read row 2b at `250f7f318`. It was clean on nine bar classes, and it found two class-3 edges of D-139's sentence "a box that once held a value and lost it stays FAIL":
- **F1:** a server left with only its retired list, or its previous value, reads the never-minted `PASS`.
- **F2:** a fleet box that synced, then refused, then lost its token file and its generation file reads WARN, and 4553 says it reads `PASS`.

The operator ruled "merge now, fix both after" (ledger, 2026-10-12 18:42 UTC). #353 merged as it was, and this small PR fixes both edges before row 3. It also carries review 391's minor findings. The arming has been live on both boxes as v0.0.153 since 18:48 UTC, and both read `PASS` (ledger, 18:51 UTC). This plan's numbers are 4554 and 4555, from the coordinator's block (4554 to 4558). They are written bare (no `D-` prefix) until a merged branch defines them.

**Goal:** Close both edges so that a box that once held a value and lost it reads FAIL:
- On the server, a sibling trace of a held value counts as history (4554).
- On the fleet, a refusal that wrote nothing keeps the generation the box held (4555).

Then correct review 391's prose and coverage findings. Throughout, the live server and the live fleet box keep reading `PASS` at every commit, and every live rotation stays byte for byte what it is today.

**Inputs:**
- review 391's report (F1 to F10, the bar summary, §A and §B);
- the coordinator's read-only facts workflow on row 2b's tip (F1's boot behaviour, F2's reachability, the fix shapes, the live risk);
- the fix-round-1 rulings (D-139, review 383's F1 and F12);
- the arming plan `docs/superpowers/plans/2026-10-10-box-token-lifecycle-w1-arming.md` (4552 at `:494`, 4553 at `:495`);
- the ledger's 2026-10-12 entries at 18:24, 18:42 and 18:51 UTC;
- the plan's own attack pass (live-safety and pin-teeth lenses) at `82464a449`, whose real breaks are folded in below.

**Spec:** `docs/superpowers/specs/2026-10-07-box-token-lifecycle-design.html` (§4.5 the sync verb, §4.8 doctor). It is not edited.

## The coordinator's rulings for row 2c (binding)

- **F1 (server arm).** A server whose `mail.token` is absent and whose state reads `absent` stays FAIL when any sibling trace exists: `box-token-retired.json`, `mail-previous.token`, or a set-aside copy. These are existence checks only, never contents. The both-role own-write fleet arm must agree.
- **F2 (fleet).** `ccrc-token-sync`'s refusal path carries the last held generation in a NEW report field. It is read from the generation file or the previous report, in bash only, because the two early refusals run before the `python3` check. Doctor's refusal-only rule then requires that field to be absent. These stay exactly as they are, because the verb runs on every live rotation:
  - a synced report's bytes;
  - the verb's stdout line;
  - every exit code;
  - every first stderr line.
- **Review 391's F3 and F5 to F10** (prose and coverage), plus 4553's wrong `PASS` sentence for F2's case.
- **F4 is NOT in this PR.** It would change the live driver (`server/src/token/*`). It is a named limit for row 3.
- **F3:** a failed first mint leaves the same disk as a fresh box, so doctor cannot tell them apart. Only a sentence change is in scope, and only if no pinned golden moves without being re-measured.
- **Never touch** `server/src/`, `agent/src/`, `shared/`, `ccd/ccd` or the spec. The live shape must read `PASS` at every commit:
  - server: `mail.token`, `box-token.json` at generation 3, and `box-token-retired.json`;
  - fleet: a 0600 token file, a generation file, and a synced, proved report.
- **Numbers:** define 4554 (F1's rule, amending 4553) and 4555 (F2's rule, amending 4553), each in the commit that first cites it. Write both bare. 4556 to 4558 are spare. Nothing else.
- **The plan rides in the worker's PR as its first commit,** at `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md`.
- **Red-first.** Every behaviour change ships with a pin measured red before the fix. The pin must red again when its guard is reverted (the mutation rows).

## Global Constraints

- **Scope.** Only the files in File Structure. A fix that needs any other file, above all anything under `server/src/`, `agent/src/`, `shared/`, `deploy/`, `ccd/ccd` or the spec, stops the task. Mail the coordinator about it. Tests may READ `server/src/` text and import its exports (Task 4's parity row); they never edit it.
- **The live-shape invariant, at every commit.** The live server is `mail.token` (0600) plus `box-token.json` at generation 3 (current, fleet-confirmed, counters 0 and 0 with `retiredPresentedAt: null`, no hold) plus `box-token-retired.json`. Its state read is `ok`, so doctor never reaches the branch Task 4 changes (`ccd/ccrc-doctor-checks:7807-7808`, `:7814`). The live fleet box holds its 0600 token file, so `tai` stays -1 and the history rule at `:7903` is never evaluated there. Before each commit, run these, one call each:
  - `doctor-box-token`'s PASS describe (`server/test/doctor-box-token.test.ts:149-210`), plus, from Task 3 on, its live-shape rows (Task 3 Step 1);
  - `ccrc-token-sync`'s synced-path describe (`server/test/ccrc-token-sync.test.ts:163-245`);
  - `ccrc-install`'s live-shape case: `-t 'live shape'`, then `-t 'fresh fleet box'`.

  If any of them reds, stop.
- **The live rotation path.** Every live rotation runs `ccrc token sync --from agent` through the agent's `token-sync` op. The agent maps only the exit code, the first stderr line and the exact stdout line (`agent/src/tokensync.ts:157-180`), and it never reads the report. So, for every run, these stay identical:
  - the synced report's bytes;
  - the stdout line `synced <gen> <transport>` (`ccd/ccrc-token-sync:431`);
  - every exit code (`:89-100`);
  - every first stderr line;
  - an empty stdout on a refusal.

  The new code adds no stderr line on any path, cannot block on any file it reads, and adds no `python3` call: the verb keeps exactly three `python3 -I -c` lines (`server/test/ccrc-token-sync.test.ts:755-761`). Under `set -u` (`ccd/ccrc-token-sync:71`), every new local is declared with a value.
- **Wire and state are additive only.** `token-sync.json` keeps `"v":1`. The new field is optional to every reader, and an older doctor ignores it, because its validator reads named keys only (`ccd/ccrc-doctor-checks:7612-7615`). A newer doctor reading an older report sees no field, and reads it exactly as today.
- **No overloaded null.** `held` is either absent or 16 lowercase hex, and it is never written as `null`. An absent `held` means one of two things: "this run wrote a value" (then `generation` is set, and doctor reads history), or "this box held no generation" (then `generation` is null, and doctor reads refusal-only). The `generation` field tells the two apart, so no reading folds into another. A present `held` that is not 16 hex makes the report unreadable, which fails closed.
- **Doctor's shape pins.** The box-token block must keep spelling the generation-id shape exactly three times (`server/test/doctor-box-token.test.ts:987-990`). So the fleet reader validates `held` through a helper that carries the existing third literal (`ccd/ccrc-doctor-checks:7614`), never a fourth. The proof tuple stays one `pf in (…)` (`:991-996`). Every `python3` in the block stays `python3 -I -c "$_BT_PY_…"` (`:889-898`).
- **Never a value.** `mail-previous.token` holds a value. Doctor tests it by existence and by name only (`[ -e ]`, `[ -L ]`, a glob over names, and `[ -d ]`/`[ -r ]` on its directory), and never opens it. In tests, every fixture value is minted at runtime (`randomBytes` in the doctor tests, the module's piece-built `VALUE`/`OLD`/`GEN` in the verb tests). A planted `mail-previous.token` holds `b.value`, so `runCheck`'s leak scan (`server/test/doctor-box-token.test.ts:77-84`) covers it. A planted `box-token-retired.json` holds the writer's shape, `{"v":1,"retired":[]}\n` (`server/src/token/files.ts`'s `appendRetired`), never a bare `[]`.
- **Fixture HOMEs only** (`mkTmp`, the `box(…)` helpers). Never run `ccrc`, `ccd`, `deploy.sh`, `notify.sh` or the server against the live `$HOME`. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*`. Never call the live server, and never read `~/.cc-secrets`, `~/.ccrc` or `deploy/ccrc-mail.token` on a real box.
- **Running tests.** One test file per call, in the foreground, with a timeout of at most 600000 ms. Never bare `npx vitest`. The form, from the repo root, is `mkdir -p .tmp-<task> && (cd server && TMPDIR="$PWD/../.tmp-<task>" ./node_modules/.bin/vitest run test/<f>.test.ts)`, and the agent's file is `(cd agent && … test/token-sync-op.test.ts)`. Remove `.tmp-<task>` before the commit.
  - Split `ccrc-install`, `ccrc-doctor` and `ccrc-update` by `-t`, as review 391 did.
  - Never use `pkill`, `pgrep -f` or `killall`. Kill only a PID you recorded.
  - A row that can block a child process gives `spawnSync` a `timeout`, and releases what it blocked on (the FIFO idiom at `server/test/ccrc-token-sync.test.ts:492-524`).
  - Known load flakes are re-run alone before they are called a break (`CLAUDE.md`'s list).
- **TDD red-first, with mutation discipline (the arming plan's Global Constraint, unchanged).**
  - Run each pin RED before its guard exists, then GREEN.
  - Apply each mutant in the working tree, run the file, and record the failed and passed counts in the commit message.
  - Restore from a copy saved before the mutation, and check with `cmp` that it is byte-identical. Never restore with `git checkout`, because the file may carry this task's uncommitted edit.
  - A mutant that cannot red is not listed as a pin. Name it in the commit as a limit no test can see.
  - A row that holds behaviour that does not change is green before the fix. Its red is measured under its mutant, and the commit says so.
- **Commits.** One commit per task, on the workspace branch the brief names, never on a separate feature branch. Commit only after a separately measured green run of the task's files.
- **The repo is public.** Keep hostnames, IPs, home paths, account, lane and pool names, emails and docserver URLs out of code, tests, comments, commit messages and this plan.
- **Numbers.**
  - This plan defines 4554 and 4555. Its first commit (Task 1) cites and defines both, and Task 6 settles their final text.
  - A worker who needs another number mails the coordinator, then takes the next spare in order (4556, 4557, 4558). Define it in the commit that first cites it, and report it in the wave-done. Past 4558, write `D-TBD-<slug>` and report it.
  - Never write 4554 to 4570 with the `D-` prefix.
  - Before any commit that defines or amends a number, run `git fetch origin main`, then `test/deviation-refs.test.ts` and `test/dtbd.test.ts`, one call each.
  - 4552 and 4553 are amended in prose only (Task 6).
- **Claims, open PRs and co-edits.**
  - Re-read `GET /api/claims?project=ccrc-pwa` (or `claims list --project ccrc-pwa`) before you start, before each task that edits a file new to the branch, and before you push.
  - At plan time, claims 1173 and 1172 had ended (ledger, 18:42 UTC).
  - Native docs reader wave 4 (run 367) is the second lander for four files this plan also edits: `ccd/ccrc-doctor-checks` and `server/test/{ccrc-doctor,ccrc-install,ccrc-update}.test.ts` (mails 4324, 4371 and 4373, on mail 4077's terms). If run 367's PR merges first, this branch is the second lander for those files: merge `main`, keep both sides, re-derive every count, and re-run the touched suites.
  - Open #351 (workspace lifecycle, wave 6) touches `README.md`.
  - A live claim on any file in File Structure stops that task until the coordinator mails consent.
  - If `README.md`, `ccrc-doctor.test.ts` or `ccrc-install.test.ts` cannot be edited, Task 5's F3 sentence and F8 steps and Task 6's README step are dropped, and they are recorded under "Not in this PR". Nothing else depends on them.
- **`main`.** It was `82464a449` at plan time. Before you push, probe `git merge-tree origin/main HEAD`. Merge only on a conflict, on a red on `main`'s side, or on a named ejection, and keep both sides. The plan stays the first commit.
- **Order.** Tasks 1, 2, 3, 4, 5, 6, then 7 (verification, no commit): the plan, then F2's writer, F2's reader, F1, and the prose and coverage.

## File Structure

| File | Change | Task | Sites at `82464a449` |
|---|---|---|---|
| `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md` | This plan: it defines 4554 and 4555, and Task 6 settles their text | 1, 6 | new |
| `ccd/ccrc-token-sync` | `_ts_held` (new), `_ts_report` writes `held` on a refusal that wrote nothing, and the comments | 2 | `_ts_report` `:154-173`; the `R_*` block `:115-118`; the OUTPUT CONTRACT `:22-36`; the header `:13-16`; `GEN_RE` `:78`; `GEN_FILE` `:85`; `REPORT` `:108` |
| `server/test/ccrc-token-sync.test.ts` | 4555's writer rows, the exact synced bytes, a static pin on `_ts_report`/`_ts_held` (Task 2); the writer-to-reader row (Task 3) | 2, 3 | `box(prefix, o)` `:85`; synced path `:163-192` (assertion `:176`); the FIFO idiom `:492-524`; refusals describe ends `:546`; the L0 spellings describe `:684-767` |
| `ccd/ccrc-doctor-checks` | Fleet reader: `held` (Task 3). Server arm: sibling traces, the `trace` state word, the `unlisted` sentence and remedy (Task 4). Sentence and comments (Task 5) | 3, 4, 5 | header `:7402-7409`; `_BT_PLACEHOLDER` `:7430`; `_BT_PY_FLEET` `:7612-7626`; `_bt_find` comments `:7694`, `:7760`; `_bt_server_arm` `:7791-7821`; the fleet arm's comment and rule `:7893-7907`; `BT_SERVER_STATE` `:7938` |
| `server/test/doctor-box-token.test.ts` | Live-shape rows; 4555's reader rows; 4554's rows; the trace-name parity pin; F3's `SERVER_NEVER`; F9's docstring | 3, 4, 5 | imports `:20-32`; PASS describe `:149-210`; ROWS `:216-337`; the override describe `:670-700` (the missing-directory row `:680-687`); never-handed describe `:714-825`; review 383 F5 describe (`itNonRoot` `:832`) `:831-887`; F4 docstring `:513-518`; L0 pins `:901-1032` |
| `server/test/ccrc-doctor.test.ts` | F3's sentence in the fresh-server case | 5 | `:13726-13735` (regex at `:13731`) |
| `server/test/ccrc-install.test.ts` | F3's sentence in the fresh both-role golden; F8's dead alternative | 5 | `:5372-5380`; `:8720` |
| `docs/superpowers/plans/2026-10-10-box-token-lifecycle-w1-arming.md` | F10 (`:92`); F6 (`:279`); 4552's F5 wording and F4's limit (`:494`); 4553's three Known limits (`:495`) | 6 | as listed |
| `README.md` | The `box-token` doctor row's history parenthetical | 6 | `:591` |

These are only read or run, never edited: `agent/test/token-sync-op.test.ts`, `server/test/token-rotation-real-verb.test.ts`, `server/test/macos-platform.test.ts`, `server/test/single-definition.test.ts`, `server/test/topology-clean.test.ts`, `server/test/typecheck-tests.test.ts`, `server/test/ccrc-update.test.ts`, `server/test/deviation-refs.test.ts`, `server/test/dtbd.test.ts`, `server/test/readme-holds.test.ts`, `server/test/readme-roster-mirror.test.ts`, `server/test/stall-settings-readme.test.ts`, `server/test/box-token-census.test.ts`, and `server/src/token/{boot,files}.ts` (read by Task 4's parity row).

## Tasks

### Task 1: Commit this plan (it defines 4554 and 4555)

- [ ] **Step 1:** Place this file at `docs/superpowers/plans/2026-10-12-box-token-lifecycle-row-2c.md`, byte for byte as the brief carries it. Re-read claims.
- [ ] **Step 2:** Run `git fetch origin main`, then `test/deviation-refs.test.ts` and `test/dtbd.test.ts`, one call each. Both green.
- [ ] **Step 3:** Commit (`docs(plan): box-token row 2c, D-139's two edges and review 391's residue (4554, 4555)`). Nothing else rides in this commit.

### Task 2: F2's writer: a refusal that wrote nothing keeps the generation this box held (4555)

**Files:** `ccd/ccrc-token-sync` and `server/test/ccrc-token-sync.test.ts`.

**Why:** a refusal rewrites the report with `"generation":null` (`ccd/ccrc-token-sync:159-166`, called from `_ts_refuse` at `:180`). Nothing reads the report before it is replaced. So once the token file and the generation file are gone, the last trace of a value this box held is gone too (review 391 F2). Doctor cannot fix this alone (the facts workflow's fix cost). The writer has to keep the trace.

**Interface (4555):**
- `token-sync.json` gains an optional key `held`. It is written only by a run whose `R_GEN` is empty, meaning a run that wrote no value. That is every refusal at `:348`, `:350`, `:356`, `:369`, `:372`, `:374`, `:383`, `:388`, `:389` and `:399-402`.
- It is written only when the box holds a generation at that moment, read in this order:
  1. the first line of `~/.ccrc/box-token-generation`, when that path is a regular file, not a link, and readable, and the line matches `GEN_RE`;
  2. else the previous report's `"generation":"<16 hex>"`, when the report path is a regular file, not a link, and readable;
  3. else the previous report's `"held":"<16 hex>"`, under the same test.
- Otherwise the key is absent. It is never `null`.
- The format becomes `'{"v":1,"at":%s,"result":"%s","generation":%s,"transport":%s,"proof":%s%s}\n'`. The last `%s` is either `''` or `,"held":"<gen>"`. Every report without `held` is byte-identical to today's.

- [ ] **Step 1: Write the rows** in a new describe after the refusals describe (`server/test/ccrc-token-sync.test.ts:546`): `describe('ccrc token sync: a refusal that wrote nothing keeps the generation this box held (4555)')`. It uses the existing `box`, `sync`, `runToken`, `claimAnswers`, `proofAnswers`, `reportOf`, `read`, `genFile`, `tokenFile`, `expectRefusal` and `expectNoSecret`. `box` takes a REQUIRED prefix (`:85`), so every new call names one (`box('tok-held-…-')`); a bare `box()` fails `typecheck-tests`. Let `REP = (h) => join(h, '.ccrc', 'token-sync.json')` and `rep = (h) => read(REP(h))`. Let `itNonRoot = process.getuid && process.getuid() === 0 ? it.skip : it`, declared in this describe. Let `OTHER = randomBytes(8).toString('hex')` (re-drawn until it differs from `GEN`) for the precedence row.
  - **The FIFO idiom, timed.** Every FIFO row in this describe uses `:492-524`'s unblock helper with its sleep raised to 5 s, and runs `runToken(…, { timeout: 15000 })`. It records `t0 = Date.now()` before the call and asserts `Date.now() - t0 < 4000` after it: a verb that never opens the FIFO returns in well under a second, and one that blocks on it returns only after the helper's 5 s write-open frees it. The helper's PID is recorded and killed in a `finally`, followed by the same non-blocking release from the test's side (`:518-520`).
  - **R1, bad-code after a sync.** `const home = box('tok-held-badcode-')`. `sync(home)` gives exit 0. Then `const r = sync(home, 'short\n')`.
    - `expectRefusal(r, 'bad-code')`.
    - `expect(r.stderr).toBe(\`${TOKEN_SYNC_STDERR_PREFIX}bad-code: the code on stdin is not 43 base64url characters; nothing was claimed\n\`)`: one line, exactly as before.
    - `expect(reportOf(home)).toEqual({ v: 1, at: expect.any(Number), result: 'bad-code', generation: null, transport: null, proof: null, held: GEN })`.
    - The token file is still `${PREAMBLE}${VALUE}\n`, the generation file is still `${GEN}\n`, and `expectNoSecret(home, r)` holds.
  - **R2, every other refusal that writes nothing, after a sync.** One `it.each` row per word, each with its exact full stderr as the verb spells it at `82464a449`:
    - `stale-client`: plant the argv-token `ccrc-api` from `:268-269` after the first sync. stderr is exactly `${TOKEN_SYNC_STDERR_PREFIX}stale-client: ~/.local/bin/ccrc-api cannot be shown to keep the box token off its argv (an install before wave 13, or a file this verb cannot read); replace it before a sync — nothing was claimed\n` (`ccd/ccrc-token-sync:356`);
    - `claim-refused`: `claimAnswers(home, 403, '{"ok":false,"error":"wrong-node"}')`. stderr is exactly `…claim-refused: the claim door answered 403 wrong-node\n` (`:389`);
    - `code-used`: `claimAnswers(home, 410, '{"ok":false,"error":"code-used"}')`. stderr is exactly `…code-used: the claim door answered 410 code-used: someone claimed this code first\n` (`:388`);
    - early `write-failed`, non-root only (`itNonRoot`): `chmodSync(join(home, '.cc-secrets'), 0o500)` after the first sync, restored in a `finally`. stderr is exactly `…write-failed: no temp file could be made in ~/.cc-secrets; nothing was claimed\n` (`:372`).

    For each word, run the same refusal on a FRESH `box('tok-held-fresh-…-')` too. Expect the same exit code, the identical full stderr (the literal above, on both boxes), and an empty stdout on both boxes. The literal pins "every first stderr line unchanged, and no line added" against `82464a449`'s text, not only against this branch's fresh box. The synced box's report must equal `{ …, result: word, generation: null, held: GEN }`, with `transport` as the fresh box's report has it. The fresh box's report has no `held` key.
  - **R3, the generation file lost, then a refusal.** `sync(home)`, then `rmSync(genFile(home))`, then `sync(home, 'short\n')`. The report's `held` is `GEN`, read from the previous report's `generation`.
  - **R4, a chain.** `sync(home)`, then `sync(home, 'short\n')`, then `rmSync(genFile(home))`, then `sync(home, 'short\n')`. The second refusal's report has `held: GEN`, carried from the first refusal's `held`.
  - **R4b, precedence: the generation file outranks the report.** `sync(home)` (the report carries `GEN`), then `writeFileSync(genFile(home), \`${OTHER}\n\`, { mode: 0o600 })`, then `sync(home, 'short\n')`. The report's `held` is `OTHER`, never `GEN`.
  - **R5, a fresh box carries nothing, byte for byte.** `box('tok-held-fresh5-')`, then `sync(home, 'short\n')`. Expect `rep(home)` to match `^\{"v":1,"at":\d+,"result":"bad-code","generation":null,"transport":null,"proof":null\}\n$`. Do the same with `claimAnswers(home, 403, …)`, where the transport is `"https"`.
  - **R6, a refusal after the write carries its own generation and no `held`.**
    - `sync(home)`, then `proofAnswers(home, 401)`, then `sync(home)`. `expectRefusal(r, 'proof-failed')`, and `reportOf(home)` equals `{ v: 1, at: expect.any(Number), result: 'proof-failed', generation: GEN, transport: 'https', proof: 'proof-failed' }`.
    - The generation write blocked after a sync: `sync(home)`, then `rmSync(genFile(home))`, then `mkdirSync(genFile(home))` (`:354-364`'s plant, on a box that already synced), then `sync(home)`. `expectRefusal(r, 'write-failed')`; the report has `generation: GEN` and no `held` key. (Under mutant 1 below, `held` would come from the previous synced report, so this case reds; on a fresh box it could not.)
  - **R7, a synced run after a refusal that carried `held` is byte for byte the synced report.** `sync`, then `sync('short\n')`, then `sync`. stdout is `synced ${GEN} https\n`. `rep(home)` matches `^\{"v":1,"at":\d+,"result":"synced","generation":"${GEN}","transport":"https","proof":"proved"\}\n$`.
  - **R8, what is not read as `held` at the generation path.** Each case has no report beforehand, the old token file, and the input `'short\n'`:
    - a generation file holding `xyz\n`;
    - a generation file that is a symlink to a regular file holding `${GEN}\n` (the target is unchanged after the run);
    - a FIFO at the generation path, under the timed FIFO idiom: elapsed under 4000 ms, and the FIFO is still there, with the same inode.

    Each case gives `expectRefusal(r, 'bad-code')`, and the report has no `held` key.
  - **R8r, the same at the report path.** Each case has no generation file (a fresh box), the input `'short\n'`:
    - a symlink at `REP(home)` to a regular file holding a synced report (`{"v":1,"at":1,"result":"synced","generation":"${GEN}","transport":"https","proof":"proved"}\n`). The new report has no `held`, and the link's target is unchanged (the rename replaces the link, never its target);
    - a FIFO at `REP(home)`, under the timed FIFO idiom: elapsed under 4000 ms, and the report path afterwards holds the refusal's report, a regular file with no `held` (the rename replaced the FIFO).

    Each case gives `expectRefusal(r, 'bad-code')`.
  - **R9 (non-root), an unreadable generation file is skipped silently.** `sync(home)`, then `chmodSync(genFile(home), 0o000)`, then `sync(home, 'short\n')`, then restore the mode in a `finally`. stderr is exactly R1's one line, and `held` is `GEN` (from the report).
  - **R9r (non-root), an unreadable report is skipped silently.** `sync(home)`, then `rmSync(genFile(home))`, then `chmodSync(REP(home), 0o000)`, then `sync(home, 'short\n')`, mode restored in a `finally` if the file is still the old one. stderr is exactly R1's one line; the new report has no `held` (nothing readable held a generation: a named 4555 limit).
  - **The synced path's bytes.** In the existing row at `:164-192`, after `:176`, add the exact text: `expect(read(join(home, '.ccrc', 'token-sync.json'))).toMatch(new RegExp(\`^\\{"v":1,"at":\\d+,"result":"synced","generation":"${GEN}","transport":"https","proof":"proved"\\}\\n$\`))`.
  - **Static, in the L0 spellings describe (`:684-767`).** `it('the held generation is read in bash: _ts_held and _ts_report name no python3, and the verb still has three python3 -I -c lines (4555)')`. Extract `^_ts_held\(\) \{\n([\s\S]*?)\n\}$` and `^_ts_report\(\) \{\n([\s\S]*?)\n\}$`, with `m`. Expect neither body to match `/python3/`. (`_ts_report` reaches python only through `_ts_rename`, `:150-152`, which existed before 4555.) Expect `_ts_held`'s body to contain `$GEN_RE` (as `"$GEN_RE"` or bare), and no `{16}` literal: the shape is derived from `GEN_RE` (`:78`, pinned to L0 at `:714`).
- [ ] **Step 2: Run RED.** `test/ccrc-token-sync.test.ts`. Red: R1, R2 (the `held` key on the synced box), R3, R4, R4b and the static row (no `_ts_held`). Green before the fix: R2's fresh-box half and its exact-stderr literals, R5, R6, R7, R8, R8r, R9's and R9r's stderr, and the bytes row. They hold what must not change, and their reds are measured under the mutants below.
- [ ] **Step 3: Implement.**
  - Add `_ts_held` after `_ts_rename` (`ccd/ccrc-token-sync:152`):
    ```bash
    # `_ts_held` — 4555: the generation this box holds while a run that wrote nothing refuses; sets the caller's `held`
    # (empty when none): the generation file's first line, else the previous report's `generation`, else its `held`.
    # Bash only (the two bad-code refusals run before the python3 check); bounded reads of regular files only (a link
    # or a FIFO is skipped, never opened); stderr silenced before each open; nothing printed, so a refusal's exit code,
    # first stderr line and empty stdout stay what they were. The shape is GEN_RE's, unanchored.
    _ts_held() {
      local line='' hex="${GEN_RE#^}" re=''
      hex="${hex%\$}"
      held=''
      if [ -f "$GEN_FILE" ] && [ ! -L "$GEN_FILE" ] && [ -r "$GEN_FILE" ]; then
        IFS= read -r -n 64 line 2>/dev/null < "$GEN_FILE" || :
        if [[ "$line" =~ $GEN_RE ]]; then held="$line"; return 0; fi
      fi
      line=''
      if [ -f "$REPORT" ] && [ ! -L "$REPORT" ] && [ -r "$REPORT" ]; then
        IFS= read -r -n 1024 line 2>/dev/null < "$REPORT" || :
        re="\"generation\":\"(${hex})\""
        if [[ "$line" =~ $re ]]; then held="${BASH_REMATCH[1]}"; return 0; fi
        re="\"held\":\"(${hex})\""
        if [[ "$line" =~ $re ]]; then held="${BASH_REMATCH[1]}"; return 0; fi
      fi
      return 0
    }
    ```
  - Change `_ts_report` (`:158-173`):
    - `local … proof='null' held='' carry=''`;
    - after `:163`, add `[ -n "$R_GEN" ] || _ts_held` and `[ -n "$held" ] && carry=",\"held\":\"$held\""`;
    - the printf at `:165` becomes `'{"v":1,"at":%s,"result":"%s","generation":%s,"transport":%s,"proof":%s%s}\n'`, with `"$carry"` after `"$proof"`.

    The success path (`:430`) has `R_GEN` set, so `carry` is `''` and the bytes do not change.
  - Comments:
    - The `R_*` block (`:115-118`): `R_GEN` stays "the generation id the claim answered".
    - Add one comment line for `held`: written by `_ts_report`, never by a caller, and only when `R_GEN` is empty.
    - `_ts_report`'s header (`:154-157`): the report's keys, with `held` optional (4555).
    - The OUTPUT CONTRACT (`:22-36`): one sentence saying the report is doctor's alone, that the agent never reads it, and that `held` changes no exit code, stdout line or stderr line.
    - The header (`:13-16`) is unchanged.
  - Confirm that no `NAME='…'` or `NAME="…"` assignment at column 0 is added (`:688-692`'s parity scan), and that no stderr line uses a literal prefix (`:748-753`).
- [ ] **Step 4: Run GREEN,** one call each:
  - `test/ccrc-token-sync.test.ts`
  - `test/token-rotation-real-verb.test.ts` (the live rotation path with the real verb; its report rows `:283-287`, `:338` and `:441-442` read `toMatchObject` and must stay green)
  - `(cd agent && … test/token-sync-op.test.ts)`
  - `test/macos-platform.test.ts` (it scans the verb whole: `read -n`, `[[ =~ ]]` and `BASH_REMATCH` are bash 3.2 builtins)
  - `test/single-definition.test.ts`
  - `test/topology-clean.test.ts` (after `git fetch origin main`)
  - `test/typecheck-tests.test.ts` (the new rows' `box` calls and helpers)
  - the live-shape set from Global Constraints
- [ ] **Step 5: Commit** (`fix(token-sync): a refusal that wrote nothing keeps the generation this box held (4555)`), with the measured counts.

| Mutation in `ccd/ccrc-token-sync` | Must red |
|---|---|
| 1. `[ -n "$R_GEN" ] \|\| _ts_held` becomes `_ts_held` (every run carries `held`) | `:176`'s synced `toEqual`, the synced-bytes row, R6 (both cases) and R7 |
| 2. `carry` written as `,"held":null` when `held` is empty | R5 (bytes), the synced-bytes row and R7 |
| 3. The previous-report block deleted (the generation file only) | R3 and R4 |
| 4. The `"held"` regex fallback deleted | R4 |
| 5. The two sources swapped (the report read before the generation file) | R4b |
| 6. `[ -f "$GEN_FILE" ]` dropped (only `! -L` kept) | R8's FIFO case (elapsed past 4000 ms) |
| 7. `[ ! -L "$GEN_FILE" ]` dropped | R8's symlink case |
| 8. `[ -r "$GEN_FILE" ]` and the `2>/dev/null` before `< "$GEN_FILE"` both dropped | R9 (a second stderr line) |
| 9. `[ -f "$REPORT" ]` dropped (only `! -L` kept) | R8r's FIFO case (elapsed past 4000 ms) |
| 10. `[ ! -L "$REPORT" ]` dropped | R8r's symlink case (`held` read through the link) |
| 11. `[ -r "$REPORT" ]` and the `2>/dev/null` before `< "$REPORT"` both dropped | R9r (a second stderr line) |
| 12. The held read routed through a new `python3 -I -c` line | The static row, and `:758`'s count of three |

Limits no test can see, named in the commit: dropping only the `-r` test, or only the `2>/dev/null`, at either path is an equivalent mutant (each alone keeps stderr clean); the order between the report's `generation` and its `held` is unobservable, because no report the verb writes carries both (a report with `held` has `generation: null`).

### Task 3: F2's reader: doctor's refusal-only rule needs `held` absent (4555)

**Files:** `ccd/ccrc-doctor-checks` (`_BT_PY_FLEET`, `:7612-7626`), `server/test/doctor-box-token.test.ts`, and `server/test/ccrc-token-sync.test.ts` (the writer-to-reader row only).

- [ ] **Step 1: The live-shape guard first.** It is green at `82464a449`, and every later commit keeps it green. In the PASS describe (`server/test/doctor-box-token.test.ts:149-210`, before `:210`):
  - `it('the live server shape: generation #3, counters 0 and 0 with a null stamp, and box-token-retired.json beside it, is PASS (row 2c invariant)')`:
    - `box({ role: 'server' })`;
    - `editState(b, (s) => { s.current.seq = 3; s.nextSeq = 4; s.counters = { previousPresented: 0, retiredPresented: 0, retiredPresentedAt: null }; })`;
    - `writeFileSync(dot(b, 'box-token-retired.json'), '{"v":1,"retired":[]}\n', { mode: 0o600 })`.

    Expect `PASS box-token: server: generation #3, rotated 60 min ago, fleet confirmed, retired value refused\n`, rc 0, and no stderr. Run it against `[CHECKS_SRC, disarmed()]`.
  - The same on role `both`, local (`:169-174`'s plant plus the retired file): `PASS box-token: <server part #3>; fleet: token file 0600, generation recorded, written by this box's server\n`.

  Run the file: green.
- [ ] **Step 2: Write the failing rows.**
  - A ROWS entry after `:290`: `{ arm: 'fleet', word: 'fleet-token-absent', label: 'fleet-token-absent (with history: a refusal report carrying the generation it held, no generation file; review 391 F2, 4555)', armedClass: 'FAIL', plant: (b) => { rmSync(fleetFile(b)); rmSync(dot(b, NODE_FILES.tokenGeneration)); plantReport(b, { result: 'bad-code', generation: null, transport: null, proof: null, held: ID_CUR }); } }`. It runs armed (FAIL, 2 lines) at `:550-564`, and disarmed (SKIP) at `:339-356`. The disarmed half is GREEN before the fix: pre-fix the line is the never-handed part plus `sync:bad-code`, which disarmed prints as one SKIP line that still contains `fleet: fleet-token-absent — `, rc 3. It is kept as a regression row for the kill switch, not counted as a pin of 4555.
  - In the never-handed describe, after the REFUSALS loop (`:762`): `it('review 391 F2: a box that synced, then refused, then lost its token and generation files is a FAIL, never never-handed (4555)')`. Use the same plant. Expect:
    - `^FAIL box-token: fleet: fleet-token-absent — .* does not exist, so this box's calls to the server carry no box token`;
    - the line contains `fleet: sync:bad-code — `;
    - `not.toContain(FLEET_NEVER)`;
    - a remedy line;
    - rc 1.
  - `it('both role, remote: a healthy server and a fleet side that synced, refused and lost its files is a FAIL on the fleet part (4555)')`. `box({ role: 'both', fleet: 'remote', agentEnv: true })`, then the same fleet plant. Expect `^FAIL box-token: ${SERVER_PASS}; fleet: fleet-token-absent — .* does not exist, so this box's calls`, `not.toContain(FLEET_NEVER)`, rc 1.
  - `it('a held that is not one generation id is unreadable, and the lost token stays FAIL (4555)')`, for `held: 'xyz'`, `held: null` and `held: 7`. Each gives `toContain('fleet: sync-unreadable — ')`, `^FAIL `, `not.toContain(FLEET_NEVER)` and rc 1.
  - `it('held changes nothing while the token file is there: a healthy fleet box with a refusal report reads the same with or without it (4555)')`. Run `box({ role: 'fleet' })` twice: one with `plantReport(b, { result: 'bad-code', generation: null, transport: null, proof: null })`, the other with `held: ID_CUR` added. Expect equal `stdout` (the `sync:bad-code` WARN) and equal `code`.
  - The REFUSALS loop at `:747-762` stays as it is (no `held`, WARN). It is the fresh box's first refusal.
  - **R10, the writer and the reader together** (in `server/test/ccrc-token-sync.test.ts`, at the end of Task 2's describe): `it('review 391 F2 end to end: the real verb syncs, refuses, the token and generation files are lost, and doctor reads FAIL (4555)')`. `box('tok-held-e2e-')`; write `~/.ccrc/ccrc.env` as `CCRC_ROLE=fleet\nCCRC_FLEET=local\n` (0600); `sync(home)`; `sync(home, 'short\n')`; `rmSync(tokenFile(home))`; `rmSync(genFile(home))`. Then run doctor's check as `doctor-box-token`'s `runCheck` does (`server/test/doctor-box-token.test.ts:67-76`): a `bt-bin` of `python3` and `stat` symlinks, `bash -c 'set -uo pipefail; . <ccd/ccrc>; . <ccd/ccrc-doctor-checks>; _check_box-token'` with `{ HOME: home, PATH: bin, LC_ALL: 'C', TMPDIR: <home>/tmp }`. Expect `^FAIL box-token: fleet: fleet-token-absent — `, the line containing `fleet: sync:bad-code — `, no `no value has been handed to this box yet`, rc 1, and `VALUE` in neither stdout nor stderr.
- [ ] **Step 3: Run RED,** one call each: `test/doctor-box-token.test.ts` and `test/ccrc-token-sync.test.ts`. Red: the armed ROWS row (WARN, not FAIL), the F2 describe row, the both-remote row, the `'xyz'`/`null`/`7` rows, and R10 (WARN rc 2). Green before the fix: the disarmed ROWS row, the healthy-box row and REFUSALS.
- [ ] **Step 4: Implement** in `_BT_PY_FLEET`:
  - Above `try:` (`:7609`), add the shape helper. It carries the block's existing third literal, which moves from `:7614`, so the count of three holds (`:987-990`):
    ```python
    def g16(x):
        return type(x) is str and re.fullmatch(r"[0-9a-f]{16}", x) is not None
    ```
  - `:7614` becomes `and (gen is None or g16(gen))`. Add `and ("held" not in j or g16(j["held"]))` after it.
  - `:7621-7626`: extend the comment (4555: a refusal that wrote nothing carries `held` when the box held a generation, and that is history). The rule becomes `if res not in ("synced", "proof-failed", "proof-unmeasured") and gen is None and "held" not in j:`.
  - The header comment at `:7568-7570` is unchanged. The shell parser (`:7875-7891`) is unchanged, because no new word is printed.
- [ ] **Step 5: Run GREEN,** one call each:
  - `test/doctor-box-token.test.ts`
  - `test/ccrc-token-sync.test.ts`
  - `test/ccrc-doctor.test.ts` with `-t 'box-token'`
  - `test/typecheck-tests.test.ts`
  - the live-shape set
- [ ] **Step 6: Commit** (`fix(doctor): a refusal report that carries the held generation is history (4555)`).

| Mutation in `ccd/ccrc-doctor-checks` | Must red |
|---|---|
| `and "held" not in j` dropped from the refusal-only rule | The armed ROWS F2 row, the F2 describe row, the both-remote row, and R10 |
| `and ("held" not in j or g16(j["held"]))` dropped | The `'xyz'`, `null` and `7` rows (no `sync-unreadable`) |
| `g16` inlined back as a second literal beside `:7614`'s (four spellings) | `:987-990` (shown to measure the scan, not as a pin of the guard) |

### Task 4: F1: a server's sibling trace is history, on both arms (4554)

**Files:** `ccd/ccrc-doctor-checks` (file scope after `:7430`; `_bt_server_arm` `:7791-7821`; the fleet arm's comment `:7899-7902`; the header `:7402-7409`) and `server/test/doctor-box-token.test.ts` (imports, ROWS after `:224`, the never-handed describe, the F5 describe, the L0 pins).

**Interface (4554):**
- File-scope arrays, with a comment that holds them to `tokenPaths` and `SET_ASIDE_MARK` (`server/src/token/files.ts:25-36`, `:224`) and to boot's own set-aside list (`server/src/token/boot.ts:290`):
  - `_BT_TRACES=(box-token-retired.json mail-previous.token)`;
  - `_BT_ASIDE=(box-token-retired.json.unusable- box-token.json.unusable-)`.
- `_bt_server_trace <dir>` sets the caller's `BT_TRACE`:
  - to the name of the first trace, when one exists by `-e` or `-L`, or by a name in the directory's glob;
  - to `unlisted`, when the directory EXISTS and has no read bit (search alone cannot list a set-aside copy, and an undecidable history fails closed);
  - else to empty. A directory that does not exist at all (a measured ENOENT: `_bt_value_file` already found the nearest ancestor searchable, `:7658-7663`, and python's `lstat` answered ENOENT) holds no trace: a fresh server whose override directory is not created yet stays the fresh PASS.

  It never opens a file. It works with or without `nullglob`, and `ccd/ccrc` sets no `failglob`.
- On a trace, the server arm leaves `token-absent` at FAIL (`:7694`), rewrites its sentence to name the trace, and sets `BT_SERVER_STATE=trace`. The own-write fleet rule at `:7903` reads `= absent`, so it does not lower either. On `unlisted`, the sentence and the remedy are its own, because boot refuses to start on such a directory (`server/src/token/boot.ts:85`, `:289-294`: a readdir failure other than ENOENT refuses), so "restart the server, which mints" would be false there.

- [ ] **Step 1: Write the failing rows.** Add the imports `import { SET_ASIDE_MARK, tokenPaths } from '../src/token/files.js';` (read by the test only) and `existsSync` if needed. Let `RETIRED = '{"v":1,"retired":[]}\n'`.
  - ROWS entries after `:224`, each `{ arm: 'server', word: 'token-absent', armedClass: 'FAIL' }`:
    - `'token-absent (with history: no state, but box-token-retired.json)'`: `rmSync(dot(b, 'mail.token')); rmSync(dot(b, 'box-token.json')); writeFileSync(dot(b, 'box-token-retired.json'), RETIRED, { mode: 0o600 })`;
    - `'… but mail-previous.token'`: the same, with `writeFileSync(dot(b, 'mail-previous.token'), \`${b.value}\n\`, { mode: 0o600 })` in place of the retired file. The leak scan covers it;
    - `'… but a set-aside box-token.json'`: `dot(b, 'box-token.json.unusable-1760000000000')` holding `'{}'`;
    - `'… but a set-aside box-token-retired.json'`: `dot(b, 'box-token-retired.json.unusable-1760000000000')` holding `RETIRED`.
  - In the never-handed describe, after `:733`:
    - `it('review 391 F1: a server with no token and no state but a sibling trace held a value once: FAIL naming the trace, never the never-minted sentence (4554)')`. For each of the four plants, expect:
      - `^FAIL box-token: server: token-absent — .* but .*${name} does: this server held a value once and lost it`;
      - `not.toContain('no value has been minted here yet')`;
      - a remedy line;
      - rc 1;
      - disarmed: SKIP, rc 3.
    - `it('names beside it that are not traces (box-token.json.bak, notes.txt) keep the fresh PASS (4554)')`. `dropServer(b)`, plant both names, and expect `^PASS box-token: ${never('server')}\n$` and rc 0.
  - In the review 383 F5 describe (`:831-887`, where `itNonRoot` `:832` and the `CCRC_MAIL_TOKEN_PATH` idiom `:871-886` are in scope), after its last row:
    - `itNonRoot('server: a token directory that exists and cannot be listed (search, no read) cannot rule a trace out: FAIL with its own sentence and remedy, never the never-minted PASS (4554)')`. An `alt` directory that holds neither file, `CCRC_MAIL_TOKEN_PATH=<alt>/custom.token` in `ccrc.env`, mode `0o300` during the run (restored in a `finally`). Expect `^FAIL box-token: server: token-absent — .* cannot be listed`, the line containing `refuses to boot until it can list it`, a remedy line containing `chmod u+r `, `not.toContain(SERVER_NEVER)`, rc 1. (Its state read is `absent`, because `lstat` needs only search.)
    - `itNonRoot('both role, local, own-write: the same unlistable directory is FAIL on the fleet part too (4554)')`. `box({ role: 'both' })`, the same override and mode, the fleet file, generation file and report removed. Expect the line to contain `fleet: fleet-token-absent — ` followed by `does not exist, so this box's calls to the server carry no box token`, `not.toContain(FLEET_NEVER)`, rc 1.
  - After `:809`:
    - `it('both role, local, own-write: a fresh-looking box with a server trace is FAIL on both arms: the fleet arm agrees (4554)')`. `box({ role: 'both' })`, `dropServer(b)`, `dropFleet(b)`, plant `box-token-retired.json` (`RETIRED`). Expect:
      - `^FAIL box-token: server: token-absent — .*box-token-retired\.json does: `;
      - the line contains `fleet: fleet-token-absent — `, followed by `does not exist, so this box's calls to the server carry no box token`;
      - `not.toContain(FLEET_NEVER)`;
      - rc 1.
    - The same for a set-aside trace: `box-token.json.unusable-1760000000000` in place of the retired file, with the same fleet-part assertions.
  - The missing-directory pin: the existing row at `:680-687` (`CCRC_MAIL_TOKEN_PATH` into `<home>/elsewhere/`, which is never created) expects `^PASS box-token: ` and is the pin for `_bt_server_trace`'s `[ -d "$d" ]`. Add beside it: `it('both role, local, own-write: an override into a directory that does not exist yet is the fresh PASS on both arms (4554)')`. `box({ role: 'both' })`, `dropServer(b)`, `dropFleet(b)`, `CCRC_ROLE=both\nCCRC_FLEET=local\nCCRC_MAIL_TOKEN_PATH=<home>/elsewhere/custom.token\n`. Expect `^PASS box-token: server: token-absent — .*; ${never('fleet')}\n$` and rc 0.
  - In the L0 pins describe (before `:1032`): `it('the server trace names are the server writer\'s (tokenPaths, SET_ASIDE_MARK, and boot\'s own set-aside list) (4554)')`. With `p = tokenPaths('/x/mail.token', '/h')`:
    - `arr('_BT_TRACES')` equals `[path.basename(p.retired), path.basename(p.previous)]`;
    - `arr('_BT_ASIDE')` equals `[path.basename(p.retired) + SET_ASIDE_MARK, path.basename(p.state) + SET_ASIDE_MARK]`;
    - and boot's list: read `server/src/token/boot.ts`, match `/const prefixes = \[([^\]]*)\]\.map/` (exactly one hit), split it into `paths.<key>` names, map each through `p[key]` to `path.basename(…) + SET_ASIDE_MARK`, and expect that list to equal `arr('_BT_ASIDE')`. So a file boot starts setting aside reds this row.
  - The existing fresh rows stay unchanged and green: the server role (`:723-733`), both role (`:763-771`), the remote worse-arm row (`:810-816`), and `:680-687`.
- [ ] **Step 2: Run RED:** `test/doctor-box-token.test.ts`.
  - The four ROWS rows red, armed (one PASS line, not two lines) and disarmed (PASS, not SKIP).
  - The F1 describe rows, the two unlistable rows, the two both-role trace rows and the parity row (the arrays do not exist) red.
  - Green before the fix: the not-a-trace row, `:680-687`, and the new missing-directory both-role row. Their reds are measured under the mutants below.
- [ ] **Step 3: Implement.**
  - After `_BT_PLACEHOLDER` (`:7430`), add the two arrays, with their comment.
  - Add `_bt_server_trace`, before `_bt_server_arm` (`:7791`):
    ```bash
    # `_bt_server_trace <dir>` — 4554: a trace beside the state file that only a server that once held a value can have, by
    # NAME only (never opened: mail-previous.token holds a value). Sets the caller's BT_TRACE to the first trace's name,
    # `unlisted` when the directory exists and cannot be listed (a set-aside copy cannot be ruled out: fail closed), else
    # empty. A directory that does not exist holds no trace (the caller's reads already measured that ENOENT).
    _bt_server_trace() {
      local d="$1" n f
      BT_TRACE=""
      for n in "${_BT_TRACES[@]}"; do
        if [ -e "$d/$n" ] || [ -L "$d/$n" ]; then BT_TRACE="$n"; return 0; fi
      done
      if [ -d "$d" ] && [ ! -r "$d" ]; then BT_TRACE=unlisted; return 0; fi
      for n in "${_BT_ASIDE[@]}"; do
        for f in "$d/$n"*; do
          if [ -e "$f" ] || [ -L "$f" ]; then BT_TRACE="${f##*/}"; return 0; fi
        done
      done
      return 0
    }
    ```
  - `_bt_server_arm`: add `BT_TRACE=""` to its locals (`:7792`). Replace the `absent)` arm (`:7814-7818`) with:
    ```bash
    absent) if [ "$tai" -ge 0 ]; then
              _bt_server_trace "${state%/*}"
              if [ -z "$BT_TRACE" ]; then
                BT_PART[tai]="server: token-absent — $tok does not exist, and neither does the server's state file: no value has been minted here yet, and the server mints one at boot"
                BT_CLASS[tai]=PASS; BT_FIX[tai]=""
              else
                BT_SERVER_STATE=trace   # 4554: an own-write fleet arm reads this as no `absent` read either
                if [ "$BT_TRACE" = unlisted ]; then
                  BT_PART[tai]="server: token-absent — $tok does not exist, and neither does the server's state file, and ${state%/*} cannot be listed, so a value held here once cannot be ruled out, and the server refuses to boot until it can list it"
                  BT_FIX[tai]="give ${state%/*} its read bit (chmod u+r ${state%/*}); the server then boots and mints a value"
                else
                  BT_PART[tai]="server: token-absent — $tok does not exist, and neither does the server's state file, but ${state%/*}/$BT_TRACE does: this server held a value once and lost it; the server mints a new one at its next boot, and the fleet must then be handed it"
                fi
              fi
            else _bt_find server state-absent "$state"; fi
            return 0 ;;
    ```
    For a readable trace, the FAIL's class and remedy stay `_bt_find`'s (`:7694-7696`): "restart the server (ccrc.service), which mints a value at boot; if it still has none, its log names the failed mint". That is true for a readable trace in a listable directory: boot takes the first-install mint at `server/src/token/boot.ts:165-167`. It is not true for a trace that exists and cannot be read (an unreadable `box-token-retired.json` refuses boot at `:76-77`): that case is a named 4554 limit, its verdict FAIL either way.
  - Comments:
    - `:7809-7813`: a trace of a value beside the absent state (4554) is history too.
    - `:7899-7902`: "the server arm's state read was itself `absent` with no sibling trace (it records `trace` otherwise, 4554)".
    - The header `:7407`: "on the server, a sibling trace counts as that history (4554)".
- [ ] **Step 4: Run GREEN,** one call each:
  - `test/doctor-box-token.test.ts`
  - `test/ccrc-doctor.test.ts`, split by `-t`
  - `test/ccrc-install.test.ts`, split by `-t`. The fresh both-role golden (`:5379-5380`) and the fresh fleet case (`:8713-8725`) must stay green, because a fresh install leaves no trace.
  - `test/ccrc-update.test.ts`, split by `-t`
  - `test/typecheck-tests.test.ts`
  - `test/single-definition.test.ts`
  - `test/macos-platform.test.ts`
  - the live-shape set

  If any install, update or doctor fixture moves, stop. Report it with its fixture's files, never by editing an expectation by hand.
- [ ] **Step 5: Commit** (`fix(doctor): a server's sibling trace is history, and the own-write fleet arm agrees (4554)`).

| Mutation in `ccd/ccrc-doctor-checks` | Must red |
|---|---|
| The `_bt_server_trace` call removed (the absent arm always lowers) | The four ROWS rows, the F1 describe row and the both-role trace rows |
| `mail-previous.token` dropped from `_BT_TRACES` | Its ROWS row and the parity row |
| The `_BT_ASIDE` loop deleted | The two set-aside ROWS rows and the both-role set-aside row |
| `BT_SERVER_STATE=trace` deleted | The both-role trace rows' fleet half (the line stays FAIL on the server part, so the rows assert the fleet part) |
| The `[ -d "$d" ] && [ ! -r "$d" ]` test deleted | The two unlistable rows |
| `[ -d "$d" ]` dropped (only `! -r` kept) | `:680-687` and the missing-directory both-role row (FAIL "cannot be listed", not PASS) |
| The `unlisted` remedy deleted (`_bt_find`'s restart remedy kept) | The unlistable server row (`chmod u+r`) |
| `_BT_ASIDE`'s entries lose `.unusable-` (any `box-token.json…` name counts) | The not-a-trace row (`box-token.json.bak`) |

### Task 5: The sentence, the comments and the coverage: F3, F7, F8 and F9

**Files:** `ccd/ccrc-doctor-checks` (`:7694`, `:7760`, Task 4's never-minted sentence), `server/test/doctor-box-token.test.ts` (`:513-518`, `:717`), `server/test/ccrc-doctor.test.ts` (`:13731`), `server/test/ccrc-install.test.ts` (`:5372-5380`, `:8720`).

- [ ] **Step 1 (F3: a failed first mint reads the fresh PASS).**
  - **Why:** a boot whose first mint fails writes no state (`server/src/token/boot.ts:124-128`), so the disk is a fresh box's. The verdict cannot move. The sentence "the server mints one at boot" is false while the mint keeps failing.
  - **Change:** keep D-139's words as the sentence's prefix, and append the pointer. The whole sentence becomes `no value has been minted here yet, and the server mints one at boot, or its log says why that mint failed`. It has no regex metacharacter, no `;` and no ` — `, so the tests' `never()` builder (`:722`) and doctor's part join (`:7969`) are unaffected.
  - **Red first:** update the three pins to the new text:
    - `SERVER_NEVER` (`server/test/doctor-box-token.test.ts:717`);
    - `server/test/ccrc-doctor.test.ts:13731`'s regex;
    - `server/test/ccrc-install.test.ts:5380`'s regex, with its comment at `:5372-5375`.

    Run each file (`ccrc-doctor` and `ccrc-install` by `-t`): red, one call each. Then change the sentence in `_bt_server_arm`'s `absent)` arm (Task 4's PASS branch). Run them again: green.
  - **These are the only goldens holding the sentence** (`git grep -n "mints one at boot"` at `82464a449`: those three, plus the doctor line and the arming plan's 4553). `BASE_LIVE_SHAPE` holds classes only, and it is re-measured by Task 7's install run, never edited.
  - If the coordinator rules that the appended clause reshapes D-139's sentence, drop this step and record F3 under "Not in this PR". Nothing else depends on it.
- [ ] **Step 2 (F7).** `:7694`'s comment becomes `# 4553/D-139: _bt_server_arm lowers it to PASS with its sentence when the state read is absent and no sibling trace stands (4554)`. `:7760`'s becomes `# 4553/D-139: _bt_fleet_arm lowers it to PASS with its sentence for a box never handed a value (4555: a refusal's held generation is history)`. These are prose only. Grep the file for `lowers it to WARN`: no hit.
- [ ] **Step 3 (F8: the dead alternative).**
  - `:8720`'s `/^box-token remedy|remedy:[^\n]*Box token card/m` has an alternative that can never match, because doctor prints `  remedy: …` (`ccd/ccrc-doctor-checks:223-224`).
  - Hoist the live half into `const CARD_REMEDY = /remedy:[^\n]*Box token card/` and assert `expect(r.stdout).not.toMatch(CARD_REMEDY)`.
  - Add a CONTROL beside it: `expect("  remedy: the server writes it at its next rotation (Rotate now on the console's Box token card)").toMatch(CARD_REMEDY)`, the fleet-token-absent FAIL's remedy text as `ccd/ccrc-doctor-checks:7762` builds it.
  - Run `ccrc-install` with `-t 'fresh fleet box'`. Measure the CONTROL red with the regex mutated to `/^box-token remedy/m`, then restore it.
- [ ] **Step 4 (F9: the count is wrong, not the pin).** In the docstring at `server/test/doctor-box-token.test.ts:513-518`, add one sentence: U+00A0 and U+FEFF also have hand-written rows (ROWS `:298-329` and the has-a-value describe `:479-511`), so deleting either from `_BT_UNI_WS` reds its generated row and those rows too. Re-measure the count on this branch: delete U+FEFF from `_BT_UNI_WS`, run, restore, `cmp`. Write the measured number in the commit message. (Review 391 measured 26 at `250f7f318`. The message of `d4eddd3b3` on `main` says "1 failed", and it cannot be amended, so this commit and Task 6's note are the correction of record.)
- [ ] **Step 5: Run,** one call each: `test/doctor-box-token.test.ts`, `test/ccrc-doctor.test.ts` (by `-t`), `test/ccrc-install.test.ts` (by `-t`), and the live-shape set.
- [ ] **Step 6: Commit** (`fix(doctor): the never-minted sentence names a failed mint (F3); comments and coverage (review 391 F7-F9)`).

| Mutation | Must red |
|---|---|
| The F3 sentence restored to D-139's text alone | The three pins (doctor-box-token's never-handed rows, `ccrc-doctor:13731`, `ccrc-install:5380`) |
| `CARD_REMEDY` restored to the dead `^box-token remedy` alternative alone | The F8 CONTROL |

### Task 6: The plan prose and the README: F5, F6, F10, 4552, 4553, and 4554 and 4555's final text

**Files:** `docs/superpowers/plans/2026-10-10-box-token-lifecycle-w1-arming.md`, `README.md`, and this plan. Every correction states the measured truth. A count that the worker cannot re-measure on this branch is quoted from review 391, and attributed to it.

- [ ] **Step 1 (F10, `:92`).** Replace "Task 12, the flip, is always the last commit." with "Task 12, the flip, is the last task's commit; only fix-round commits follow it (fix round 1 added 14)." The rest of the bullet is unchanged.
- [ ] **Step 2 (F6, `:279`).** Rewrite the shape-A paragraph. Re-measure both mutants on this branch's `doctor-box-token`, and write the measured counts:
  - The collapse with the trailing `elif k["retiredPresented"] > 0` kept is NOT equivalent: it reds the answered-PASS rows (review 391: 2 rows).
  - The equivalent mutant is review 383's shape A, `if rp is not None:` with its inner branches kept (review 391: 227 of 227 green). Name it as the limit no test can see.
  - Shape B (the `:276` row) is the listed pin.
- [ ] **Step 3 (4552 at `:494`: F5 and F4).**
  - **F5.** In limit (1), replace "and a second rotation, an hour later (or at once after a restart), answers it" with "and a second rotation answers it, owed no sooner than one `HOLD_REPROBE_MS` after the first owe (not after the first rotation; `server/src/token/policy.ts:184`), so it can follow a rotation the gate held within minutes (review 391 K7: 5 minutes apart), or come at once after a restart". The bound of two rotations is unchanged.
  - **F4.** The sentence "so a presentation inside the hour is answered once the hour has passed instead of being forgotten" gains the limit review 391 F4 measured: "except while the clock is behind `lastRotationAt` with no restart: such a presentation is stamped at or below `lastRotationAt`, reads answered at once, and its rotation is lost, not delayed (pre-existing, `server/src/token/driver.ts:689`, the same fact as limit (2); a named limit for row 3, never fixed outside the driver)".
- [ ] **Step 4 (4553 at `:495`).** Replace its three Known limits:
  - The failed first mint: "a fresh server whose first boot mint failed writes no state either, so it reads the fresh PASS; its sentence says the server's log names a failed mint (row 2c, F3); the verdict cannot move, because the disk is a fresh box's."
  - The sibling files: "Amended by 4554 (row 2c): a server with no `mail.token` and no state but a sibling trace (`box-token-retired.json`, `mail-previous.token`, a set-aside copy), or a token directory that exists and cannot be listed, is a FAIL, and an own-write box's fleet arm agrees."
  - The synced, refused, lost box: "Amended by 4555 (row 2c): before 4555 this box read WARN, not PASS (review 391 F2: the refusal's own `sync:<word>` WARN stays beside the never-handed part); now a refusal that wrote nothing carries the generation the box held (`held`), and the box reads FAIL. A report that a refusal overwrote on a build before 4555 still reads WARN."
- [ ] **Step 5 (README `:591`).** Replace the parenthetical with "(no fleet generation file and no sync report that records a value written or carries the generation the box held, or no server state file and none of the server's traces of a value: its retired list, its previous value, or a set-aside copy)". No other README text changes. Run, one call each: `test/readme-holds.test.ts`, `test/readme-roster-mirror.test.ts`, `test/stall-settings-readme.test.ts`, `test/box-token-census.test.ts`, `test/single-definition.test.ts`, and any file `git grep -ln "never handed a value" -- server/test` names that reads `README.md` (at `82464a449` its hits are `ccrc-install` and `doctor-box-token`, which hold doctor's own sentence, already run in Tasks 4 and 5).
- [ ] **Step 6: Settle 4554 and 4555** in this plan's Deviations found, to what Tasks 2 to 5 measured: the exact field name, the sentence texts, and any limit found on the way. Keep each entry's number and its "amends 4553" line.
- [ ] **Step 7:** Run `git fetch origin main`, then `test/deviation-refs.test.ts`, `test/dtbd.test.ts` and `test/topology-clean.test.ts`, one call each. Commit (`docs(plan): review 391's prose (F5, F6, F10); 4552 and 4553 amended; 4554 and 4555 settled`).

### Task 7: Verification and hand-off (no commit)

- [ ] **Step 1:** Re-read claims. Probe `git merge-tree origin/main HEAD`, and merge only on a ruled trigger (Global Constraints). If run 367's PR landed first, this branch is the second lander for the four co-edited files: keep both sides, re-derive every count, and re-run the touched suites.
- [ ] **Step 2: Every touched suite on the tip,** one call each, in the foreground:
  - `ccrc-token-sync`
  - `token-rotation-real-verb`
  - `(agent) token-sync-op`
  - `doctor-box-token`
  - `ccrc-doctor` (by `-t`)
  - `ccrc-install` (by `-t`), including `BASE_LIVE_SHAPE`'s live-shape case: re-measured, never hand-edited
  - `ccrc-update` (by `-t`)
  - `macos-platform`
  - `single-definition`
  - `typecheck-tests`
  - `topology-clean`
  - `deviation-refs`
  - `dtbd`
  - `readme-holds`, `readme-roster-mirror`, `stall-settings-readme`, `box-token-census`
- [ ] **Step 3: The per-commit invariant.** For each commit of the branch, make a copy with `git archive <sha> | tar -x -C <scratchpad>/c-<sha>` (never `git worktree add`, which registers in the shared worktree list and carries no `node_modules`, and never `git checkout` in this one). Symlink `server/node_modules` and `agent/node_modules` into the copy from this worktree. There, run the live-shape set (Global Constraints) and `ccrc-token-sync`'s synced-path describe, with `TMPDIR` under the scratchpad. Record one line per commit, and remove each copy afterwards.
- [ ] **Step 4: CI.**
  - Run the PR. Check that its `select tests` summary lists `ccrc-token-sync`, `token-rotation-real-verb`, `doctor-box-token`, `ccrc-doctor` and `ccrc-install`.
  - Then run `gh workflow run ci.yml --ref <branch> -f mode=full` on the tip. macOS legs are advisory.
- [ ] **Step 5: Wave-done,** as before:
  - the fingerprint (the workspace branch tip);
  - both CI runs;
  - each finding's red and green;
  - every mutation row's counts, and the named equivalent mutants;
  - Step 3's per-commit invariant lines;
  - the re-measured fresh-install and live-shape results;
  - 4554 and 4555 defined, 4552 and 4553 amended, no other number;
  - anything dropped under the claims rule.

  List mail before sending it.

## Not in this PR (owner, why)

- **F4: a retired presentation is lost while the clock is behind `lastRotationAt`** (`server/src/token/driver.ts:689`, pre-existing, class none). The fix is in the live driver (`server/src/token/*`), which row 2c must not touch. Task 6 corrects 4552's sentence and names the limit. Owner: row 3.
- **Boot's own history judgement.** With no `mail.token` and no state, boot mints as a first install (`server/src/token/boot.ts:165-167`): no rotation owed, and generation #1 again (`server/src/token/policy.ts:93-97`), even beside a retired list. After 4554, doctor calls that disk "held and lost" while boot treats it as new. That disagreement is on purpose and fails closed. Changing boot is `server/src/`. Owner: the coordinator, for row 3.
- **An unreadable trace.** A `box-token-retired.json` that exists and cannot be read refuses boot (`server/src/token/boot.ts:76-77`), so the readable-trace sentence "the server mints a new one at its next boot" and its restart remedy are wrong there; the verdict (FAIL) is right. Doctor tests traces by existence only. Owner: the coordinator, if a sentence of its own is wanted.
- **`mail-pending-<id>.token` as a trace.** The coordinator kept it out of row 2c on 2026-10-12, to hold the trace list to the two ruled names and the set-aside copies. Owner: row 3.
- **A no-role box whose only file is a sibling trace.** It reads `SKIP no-role` (`ccd/ccrc-doctor-checks:7956-7962`), not PASS, so nothing reads green. Unchanged.
- **Reports overwritten before 4555 lands.** They carry no `held` and read WARN, as today. 4555 is not retroactive.
- **Uninstall.** It removes the generation file and the report together (`ccd/ccrc:23611`), by design, so a reinstalled box's history starts afresh.
- **F3's verdict.** It cannot move, because a failed first mint and a fresh box are the same disk. Only Task 5's sentence changes, and the coordinator ruled on 2026-10-12 that it extends D-139's sentence without reshaping it, so it stays.
- **The commit message of `d4eddd3b3` (F9).** It is immutable on `main`. Task 5 and Task 6's note are the correction of record.
- **Review 391's refuted items:** the server `token-unusable` remedy's "Rotate now"; the README row's own-write omission; K7 as behaviour; limits 4(a) and 5(c) as findings. No work.
- **The arming plan's open residue** (6(b), 7, 8(b), 8(c), R-a, R-j, V3/V15, the CONTROL-noise row) stays where that plan lists it.

## Review Focus

1. **The live rotation path for the sync verb (class 1 and 2).** Every live rotation runs `ccrc token sync --from agent`. Confirm, at the tip and by reading the diff of `ccd/ccrc-token-sync`:
   - The success path is unchanged. `R_GEN` is set, so `carry` is `''`, and the report's bytes match today's. The synced-bytes row and `:176`'s `toEqual` show it. The stdout line (`:431`) and exit 0 are untouched.
   - Every refusal's exit code, full stderr and empty stdout are unchanged. R1 and R2 assert each word's exact stderr as `82464a449` spells it, on a synced box and a fresh box alike. No path gains a stderr line (R1, R2, R9, R9r).
   - `_ts_held` cannot block, print or fail the verb:
     - regular, non-link files only, at both paths (R8 and R8r: the FIFO rows measure elapsed time against a 5 s unblock, so a blocking open reds; the symlink rows);
     - bounded `read -n`;
     - stderr silenced before each open;
     - every local initialised under `set -u`;
     - no `python3` (the static row and `:758`'s count of three).
   - `token-rotation-real-verb` and `agent/test/token-sync-op.test.ts` are green. R10 runs review 391 F2's case end to end in a fixture HOME (sync, `bad-code`, then remove the token and generation files): doctor reads FAIL rc 1.
   - Bash 3.2 compatibility: `read -n`, `[[ =~ ]]` with a variable, and `BASH_REMATCH`.
2. **The live shape reads `PASS` at every commit (class 2).** Check Task 3 Step 1's two live-shape rows (generation #3 plus `box-token-retired.json` in the writer's shape), the fleet PASS rows (`:149-210`), `ccrc-install`'s live-shape case, and Task 7 Step 3's per-commit lines. The only verdict 4554 moves is PASS to FAIL, on a box with no token, no state and a trace, or a token directory that exists and cannot be listed. A token directory that does not exist yet stays the fresh PASS (`:680-687`, and its both-role twin). The only verdict 4555 moves is WARN to FAIL, on a box with no token file, no generation file, and a report carrying `held`. No live box is in either state.
3. **F1 fails closed and reads no secret.**
   - `mail-previous.token` is never opened (only `-e`, `-L` and glob names). The leak scan covers the planted `b.value`.
   - An unlistable directory is FAIL, not PASS, with a sentence and remedy that match boot's refusal there. A missing directory is not unlistable.
   - The trace names are held to `tokenPaths`, `SET_ASIDE_MARK` and boot's own set-aside list by the parity row.
   - The own-write fleet arm reads `trace` as "not absent". The both-role rows (retired, set-aside, unlistable) assert the fleet part itself, because the server part alone would keep the line FAIL.
   - On an own-write box only, the fleet token file and the generation file are traces too (review 405 F1), by existence alone (`-e`, `-L`); the fleet file is never opened for it. The agent.env, remote, server-role and fleet-role rows keep today's reading, and the server-role row pins the fresh PASS with both files present.
4. **F2's reader.**
   - `held` is validated strictly: absent, or 16 hex.
   - The block still spells the shape exactly three times (`:987-990`), through `g16`.
   - The proof tuple stays one (`:991-996`).
   - A healthy box with a refusal report reads the same with or without `held`.
   - An older doctor ignores the key (`:7612-7615`).
   - The both-role remote row shows the fleet part decides there too.
5. **D-139 kept.**
   - Every never-handed PASS row (`:723-771`) is unchanged.
   - The REFUSALS loop (`:747-762`) still reads WARN.
   - F3's sentence keeps D-139's words as its prefix, and its three goldens were changed red-first, then re-measured.
   - A fresh install still ends `0 warned, 0 failed` (the one `linger` warn on macOS).
6. **Every mutation row reds** with the counts its commit message records. Every "green before the fix" row is named as such, with its mutant's red. The named equivalent mutants (Task 2's `-r`-alone and `2>/dev/null`-alone, the report's `generation`/`held` order) are in the commit messages.
7. **Scope (class 8).** Only the File Structure's files are edited. Nothing under `server/src/`, `agent/src/`, `shared/`, `deploy/` or `ccd/ccd`, and not the spec. The README change is only the `box-token` row's parenthetical. Any step dropped under the claims rule is named in the wave-done.
8. **Numbers (class 9).**
   - Only 4554 and 4555 are defined, both bare, each first cited and defined in Task 1's commit and settled in Task 6.
   - 4552 and 4553 are amended in prose only.
   - `git grep -nE 'D-45(5[4-9]|6[0-9]|70)'` at the tip is empty.
   - `deviation-refs` is green against `origin/main`.
9. **The prose is true:** F5's K7 wording ("no sooner than"), F6's re-measured counts, F9's re-measured count, F10's sentence, and 4553's three replaced limits.
10. **Public repo (class 10).** No host, path, lane or account name in the diff, the commit messages or the PR body.

## Deviations found

- **4554** (amends 4553 rule (1); review 391 F1, ruled by the coordinator for row 2c under the operator's "merge now, fix both after" of 2026-10-12). Settled to what Tasks 4 and 5 shipped.
  - **The rule.** The server arm lowers an absent `mail.token` beside an absent state to the never-minted PASS only when nothing beside the state file shows that a value was once held there:
    - no `box-token-retired.json`;
    - no `mail-previous.token`;
    - no copy boot set aside (`box-token-retired.json.unusable-*` or `box-token.json.unusable-*`);
    - on an own-write box only (role both, `CCRC_FLEET` not remote, and no `agent.env` marking the fleet: the same test as 4553 rule (3)), neither the fleet token file nor the generation file, which that box's own server wrote (review 405 F1, ruled by the coordinator).

    Each is tested by existence and by name in a directory listing (`-e`, `-L`, a glob over names), never by content: `mail-previous.token` holds a value and the fleet file holds one, and neither is opened. A dangling link counts as present. The own-write test is passed to the trace explicitly, and the two fleet-side paths are spelled once (`_bt_fleet_paths`), which the fleet arm and the trace both read.
  - **The sentences (as `ccd/ccrc-doctor-checks` spells them).**
    - Fresh, PASS: `… does not exist, and neither does the server's state file: no value has been minted here yet, and the server mints one at boot, or its log says why that mint failed`. The tail after `at boot` is F3 (Task 5); D-139's words are its prefix.
    - A trace, FAIL: `… but <trace path> does: this server held a value once and lost it; the server mints a new one at its next boot, and the fleet must then be handed it`, with the existing restart remedy. The path is the trace's full path: `<dir>/<name>` for the server's own files (the text it always printed), and the fleet file's or the generation file's own path on an own-write box.
    - Unlistable, FAIL: `… and <dir> cannot be listed, so a value held here once cannot be ruled out, and the server refuses to boot until it can list it`, remedy `give <dir> its read bit (chmod u+r <dir>); the server then boots and mints a value`. A token directory that exists and cannot be listed (search, no read) fails closed, because boot refuses to start on it (`setAsideNames`). A directory that does not exist holds no trace: the fresh PASS stands.
  - **The fleet arm agrees.** The server arm records its state read as `trace`, not `absent`, so an own-write box's fleet arm (4553 rule (3)) does not read never-handed either. The both-role rows (retired, set-aside, unlistable) assert the fleet part itself. The agreement runs the other way too (review 405 F1): on an own-write box the fleet token file and the generation file are a trace on the server part, so a server that lost its token and state while the fleet-side files its own boot wrote survive no longer reads the never-minted sentence beside a fleet part that says "written by this box's server". The fleet-only and generation-only variants name the file that remains.
  - **The names** (`_BT_TRACES`, `_BT_ASIDE`) are held to `tokenPaths`, `SET_ASIDE_MARK` (`server/src/token/files.ts`) and boot's set-aside list (`server/src/token/boot.ts`) by a parity pin.
  - **Why:** D-139's own sentence, "a box that once held a value and lost it stays FAIL". A retired list or a previous value exists only after a rotation. Review 391 measured the PASS, and the operator ruled to fix it. Review 405 measured the reverse case on an own-write box, where the server itself writes the fleet file and the generation file, and the coordinator ruled that they count.
  - **Limits:**
    - Boot still treats this disk as a first install (`server/src/token/boot.ts:165-167`), so doctor and boot disagree by design until row 3 rules on boot. It fails closed.
    - A trace that exists and cannot be read (an unreadable `box-token-retired.json`) refuses boot; the readable-trace sentence and its restart remedy are wrong there, and the verdict (FAIL) is right. Doctor tests traces by existence only.
    - (a) A token directory that is unlistable but also holds a named trace (`box-token-retired.json` or `mail-previous.token`) reads the readable-trace sentence and the restart remedy, because named traces are tested before the unlisted test. Boot refuses there, so that remedy is wrong; the verdict is FAIL either way.
    - (b) The read bit stands in for "can be listed". An opendir failure that `[ -r ]` cannot see (an LSM denial, EIO, EMFILE or ENOMEM) globs empty and reads the fresh PASS while boot refuses on the same failure: a narrow fail-open that no shell glob can tell from "no match".
    - A pending value file (`mail-pending-<id>.token`) is not a trace. The coordinator kept it out of row 2c; row 3 decides.
    - No row runs with `nullglob` set, and the unlistable rows skip under a root runner (no mode bit stops root). The `[ -L ]` half of the existence test is pinned by two dangling-link rows (the retired list; a set-aside link), each with a mutant that reds it.
    - A no-role box whose only file is a trace still reads `SKIP no-role`, not PASS.
    - No ccrc code path reaches this state by itself. It needs files lost by hand or to the disk while no server runs. No live box changes: the live server holds a state, so this branch is never reached there.
    - **The own-write records (review 405 F1).**
      - They count only on an own-write box. A both box whose `agent.env` marks the fleet, or whose fleet mode is remote, a server-role box and a fleet-role box keep today's reading, because there the fleet files are the fleet agent's, not this server's. The live boxes are such. A both-role fleet-remote box whose server lost its token and state therefore still reads the never-minted PASS on the server part, as before.
      - Fresh boxes stay green, and no install or boot window opens the branch. Boot's first mint writes `mail.token` (`server/src/token/boot.ts:115`, `ctx.current` set at `:133`) before the both-role fleet write, which is gated on `ctx.current !== null` (`:233`, writes at `:236-237`), and the state file is written after. The only other writer is the driver's own-write promotion (`server/src/token/driver.ts:395-396` through `fileBothRoleWriter`, `server/src/token/files.ts:312-313`), which runs with a state present and replaces `mail.token` by an atomic rename afterwards (`driver.ts:426`). Wherever the fleet file or the generation file exists, `mail.token` exists, and no path writes either one while `mail.token` is absent. A failed first mint sets `ctx.current` to null, so the fleet files are not written then either.
      - The reading after a deliberate fresh start on an own-write box is FAIL until the server next boots and mints: removing `mail.token` and the state file while leaving `~/.cc-secrets/ccrc-mail.token` and the generation file looks like a lost value, and it is the same disk. The restart remedy is the right one.
      - **Uninstall.** A plain `ccrc uninstall` removes the generation file and the sync report but keeps `mail.token` and the state file (`ccd/ccrc:1380-1384`, `:23611`, `:23670`) and never touches `~/.cc-secrets`, so the absent branch is not reached after it. Only `ccrc uninstall --purge` (which removes `~/.ccrc` whole, apart from the memory and history it keeps) leaves the fleet file as the only trace.
      - **Purge, then reinstall (measured).** The only doctor run in install or update is `_inst_doctor_tail` (`ccd/ccrc:13904`), called as the last step of `cmd_install` at `:12719` (fleet role) and `:12804` (server and both). `cmd_update` runs the staged install spine and uses that doctor (`:16537`); the only other caller of `cmd_doctor` is the verb dispatch (`:24004`), and `_upd_gate` runs no doctor. That doctor comes after `_inst_enable` (step 10 of the spine order), which restarts `ccrc.service` and then requires `deploy/verify-service.sh` to see a stable MainPID across its settle and window (3 s and 5 s, `deploy/verify-service.sh:200-216`; on macOS `_ccrc_job_stayed_up`, `ccd/ccrc:14813`), with the rest of the spine after it. The server awaits `bootBoxToken` at its top level (`server/src/index.ts:56`) before anything after it runs, so the mint is the server's first act; a boot that throws crash-loops, fails that verification, and ends the install before doctor. So a successful reinstall of a purged own-write box reads PASS: `mail.token` and the state exist by the time doctor runs. The order is by elapsed time (at least 8 s after the restart, plus every later step), not by a handshake with the mint.
      - If that first mint FAILS after a purge, the server stays up (`boot.ts:123-128` warns and continues), no state is written, the fleet file survives, and the box now reads FAIL (before this round it read the never-minted PASS) and the install exits 1. This is a limit, and arguably right: the surviving fleet file is a true trace that the box held a value.
      - **An unsearchable `~/.cc-secrets`** makes `[ -e ]` and `[ -L ]` false for the fleet file, so on an own-write box with no generation file the server part prints the never-minted sentence. The verdict stays FAIL, because the fleet arm reads that file `fleet-token-unusable` (the existing fleet row `server/test/doctor-box-token.test.ts:1105`; measured on an own-write fixture with the fleet file inside a mode 0600 directory and no generation file: FAIL rc 1, server part never-minted, fleet part `fleet-token-unusable`). The server part's sentence is then wrong, though the line is not. No row pins the own-write server part there.
      - An unlistable token directory on a box whose fleet file or generation file survives gets the readable-trace sentence and the restart remedy, because the own-write traces are tested before the unlisted test. Boot refuses there, so `chmod u+r` is the right remedy and the restart remedy is wrong; the verdict is FAIL either way. The fleet file is never in the token directory (it is in `~/.cc-secrets`). The generation file is `$HOME/.ccrc/box-token-generation`, so it is in the token directory by default and outside it only when `CCRC_MAIL_TOKEN_PATH` moves the token elsewhere. Either file is found by existence (search permission alone is enough), so it is found whether or not the token directory can be listed, and it comes before the unlisted test: the restart remedy appears and the verdict stays FAIL. This is a separate case from limit (a), which is about the named traces inside the token directory.
      - The `[ -L ]` half is pinned by two dangling-link rows (the fleet file, the generation file), each with a mutant that reds it.
- **4555** (amends 4553 rule (4); review 391 F2, ruled by the coordinator for row 2c). Settled to what Tasks 2, 3 and 5 shipped.
  - **The writer.** `ccrc-token-sync`'s report gains an optional field named `held` (16 lowercase hex, never `null`). `_ts_report` writes it only for a run that wrote no value (`R_GEN` empty), and only when `_ts_held` finds a generation this box holds at that moment: the generation file's first line, else the previous report's `generation`, else its `held`. They are read in bash only (the two bad-code refusals run before the `python3` check), from regular, non-link, readable files only, with bounded `read -n`, stderr silenced before each open, and nothing printed. The key is absent otherwise.
  - **What stays byte for byte:** a synced report, every report of a run that wrote a value, and every report of a box that held nothing. The verb's stdout line, its exit codes and its first stderr lines are unchanged, no stderr line is added, and the verb keeps exactly three `python3 -I -c` lines.
  - **The reader.** Doctor's refusal-only rule requires `held` to be absent. `held` is validated strictly, through `g16` (the block's third generation-id literal, so the shape is still spelled three times): absent, or one 16-hex id. Anything else makes the report unreadable (`sync-unreadable`), which fails closed, and the lost token stays FAIL. A healthy box with a refusal report reads the same with or without `held`.
  - **Why:** a refusal rewrote the report with `generation: null`, so a box that synced, then refused, then lost its token file and its generation file read never-handed. That was WARN beside the refusal's own `sync:<word>`, though 4553 said PASS. D-139 says it stays FAIL.
  - **Limits:**
    - A report that a refusal overwrote on a build before 4555 still reads WARN. 4555 is not retroactive.
    - A refusal on a box whose generation file is gone and whose report is unreadable (or is a link or a FIFO) carries no `held`, so a later loss of the token file reads WARN.
    - After a refusal AFTER the write (a `write-failed` once the token file was replaced but the generation file was not), the generation file is stale. A later refusal's `held` then names that stale id, although the previous report's `generation` names the value in the token file. Doctor tests only `held`'s presence, so the verdict is unaffected.
    - Uninstall removes both node records (the generation file and the report) by design, so a reinstalled box's history starts afresh.
    - An older doctor ignores `held` (today's WARN).
    - The report keeps one run, so `held` carries the history forward by chain, one report at a time.
    - The `ok`-with-a-bad-generation branch at `ccd/ccrc-token-sync:432` clears `R_GEN` after the writer wrote, so its report would carry the old generation as `held`. That is still history, and review 391 measured the branch unreachable, because `_TS_WRITE_PY` validates the generation first.
    - Equivalent mutants no test can see. Three were measured fully green (92 of 92, `6969e06a4`): dropping only the `-r` test, or only the `2>/dev/null`, at either path (each alone keeps stderr clean); and the order between the report's `generation` and its `held` (no report the verb writes carries both, because a report with `held` has `generation` null). A fourth is equivalent by reading only, never run: `g16`'s `type(x) is str` guard, because the `g16` call sits inside the `try … except Exception: ok = False`, so without the guard a non-string `held` raises a TypeError in `re.fullmatch` and still reads unreadable.
