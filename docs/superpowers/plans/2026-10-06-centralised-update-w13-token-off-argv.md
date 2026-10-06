# Centralised update management, wave 13: the box token off curl's argv (ccrc-api, notify.sh, the test curl front), the cleanup hook spread per test, wave 12's As-built bullet (R16, R20): Implementation Plan

The coordinator scoped wave 13 on 2026-10-06 at 07:07 UTC (programme ledger, "wave 13 re-scoped, and the residue mapped to waves 13–19"), after #291 merged as `9221416a` at 06:40 and run 287 opened with deviation block 4094 to 4113. A workflow drafted this plan on 2026-10-06 (a scout, then a prototyping drafter), from `main` at `9221416aa88756864fba1bb859cd14531c2531bb`. Three attack lenses then read the draft (security, blast radius, pins). This is the revision. Every changed row was re-measured in a fresh worktree at `9221416a`. Its file is `docs/superpowers/plans/2026-10-06-centralised-update-w13-token-off-argv.md`.

**`main` has moved since drafting.** At revision it is `77c11245a` (#286, workspace-lifecycle wave 3). That merge touches none of this wave's files. Its one hit in this area is two line references in README, far from the `ccrc-api` passage. Claim 1044 has ended. The live claims are 1040, 1041, 1045 and 1046. Task 6 Step 1 merges `main`.

**Wave 13 changes two shipped files, `ccd/ccrc-api` and `deploy/notify.sh`.** Both stop putting the box token on curl's argv. Everything else is test code, one comment re-cite and one plan bullet. R16 comes first (Tasks 1–3), then R20 (Tasks 4–5).

One line per task:
- **Task 1.** The test curl front (`loopbackCurlFront`, `server/test/containedTools.ts`) admits `-K -` only with a stdin config of `header = "<name>: <value>"` lines. Each line must start with `header = "`, the name must be `[A-Za-z0-9-]+`, and the value must hold no `"`, no `\` and no control character. The front also admits the three options the senders use that it refused before: `-m`, `-X` (capitals only) and `-d`/`--data-binary` (no `@`). `ccrc-containment.test.ts` gains 39 cases (D-4095). Each config refusal row is now refused for its own reason (the key rows carry header-shaped values). There is also a row that smuggles a `url` directive onto one line, and a case for the proxy variables on the `-K -` path.
- **Task 2.** R16, `ccd/ccrc-api`. The token rides curl's stdin, `printf 'header = "x-ccrc-mail-token: %s"\n' "$TOKEN" | curl … -K - …`, which is the spelling `ccd-pool-sync` and `ccd-update-sync` ship. Then `TOKEN=""`. Line 57 becomes `set +x; set -uo pipefail`, the siblings' secrets control folded onto that line so no cited line moves. New pins:
  - three argv-scan cases, one of them the `--json -` stdin collision;
  - a case with hostile stdin from the caller (the other direction of the collision);
  - an argv scan on the transport-failure path;
  - an inherited-xtrace case;
  - a drive-through behind the Task 1 front;
  - a source pin in `ccrc-api-closed.test.ts`.

  `update-catalogue.test.ts:7` is re-cited, because the new import line moves the listener block it cites.
- **Task 3.** R16, `deploy/notify.sh`. The same idiom, with the config line still guarded by `[ -n "$tok" ]`, and `curl` and `"$BASE/api/notify"` kept on one line. `coord-token.test.ts`'s literal pin is rewritten. `notify-addr.test.ts` gains six cases: an argv scan, the no-token tolerance, two hostile-stdin cases and two drive-throughs to a listener.
- **Task 4.** R20(a). `tmpHelpers.ts` gains an opt-in `removeTmpFixturesEachTest()`. `ccrc-update.test.ts` calls it on the last line of the file, so no cited line moves. Each test's homes are removed in a root `afterEach`, and the `afterAll` is left with nothing to remove (measured: 648 homes and 2.47 GB before, 0 after). The timeout is not widened.
- **Task 5.** R20(b). One As-built bullet in the wave-12 plan, naming the worker's two citation corrections (review 286 F2).
- **Task 6.** The gate and the PR.

**Live effect: notify.sh moves on the release; ccrc-api moves on the release only on boxes where it is a link (D-4094).**
- `deploy/notify.sh` reaches every rostered home through `ccrc update`'s install spine, on the first release after the merge, about 30–50 min later. `_inst_files` places it at `~/.cc-sessions/notify.sh`.
- **The spine places `ccd/ccrc-api` on no box.** `_inst_bins` in `ccd/ccrc` has no line for it. Two documented placements put it at `~/.local/bin/ccrc-api`, and they behave differently:
  - **README's link.** The install block has `ln -sfn ~/ccrc/ccd/ccrc-api ~/.local/bin/ccrc-api`, with the comment "a link follows every update". On a box placed this way the new client is live on the first release flip of `~/ccrc -> ~/ccrc-versions/<tag>` after the merge, the same 30–50 min as notify.sh.
  - **`deploy.sh agent`'s copy.** `install_atomic ccd/ccrc-api .local/bin/ccrc-api 755` copies a regular file. A box placed this way keeps the argv-leaking client until someone re-places it. The drafting box is one of these: its client is a regular file, byte-identical to `main`'s, dated 2026-09-17.
- **So `ccrc-api` is live code at the release**, on every linked box. A wrong merged `ccrc-api` breaks every session's mail, claims, runs and ledger calls there within the hour. Every header-arrival proof in Review Focus 1 is part of the merge gate for that reason.
- The cheapest way to close the copied population is a one-time operator step that touches no claimed file: replace the copy with README's link (Reading 1(b)).
- Fleet-first ordering does not matter for either file, because the server is unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ] `) syntax for tracking.

**Goal:**
- no process listing on a box shows the box token while either sender runs, and neither sender prints it, on success, on failure or under an inherited xtrace;
- the header still reaches the server on every call shape, including a `--json -` body;
- the caller's own stdin never reaches curl's config parser;
- the test curl front can carry both senders' real calls, and refuses any other config;
- `ccrc-update.test.ts` stops losing a CI shard to its own cleanup hook.

**Architecture:**
- No ring changes. Shipped code changes in only `ccd/ccrc-api` (line 57, folded in place, and one hunk after line 440) and `deploy/notify.sh` (one hunk after line 88). `server/src`, `agent/src`, `pwa/`, `shared/`, the units and the install paths are untouched.
- `ccd/ccrc-api` keeps every exit code and envelope. curl's stderr is still discarded, and the transport refusal still prints only `curl rc N`.
- **Tests:**
  - `server/test/containedTools.ts` and `server/test/ccrc-containment.test.ts` (Task 1);
  - `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts` and `server/test/update-catalogue.test.ts` (a one-line comment re-cite) (Task 2);
  - `server/test/coord-token.test.ts` and `server/test/notify-addr.test.ts` (Task 3);
  - `server/test/tmpHelpers.ts`, `server/test/tmpfixtures.test.ts` and `server/test/ccrc-update.test.ts` (Task 4).
- **Prose:** the wave-12 plan (Task 5) and this plan.

**Tech Stack:**
- bash `set -uo pipefail` (`ccrc-api`), and plain bash with no `set` (`notify.sh`);
- POSIX `/bin/sh` for the test front;
- curl's `-K -` config syntax;
- vitest 4.1 in `server/`;
- TypeScript on node `>=22.13.0`;
- no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md`. No section changes. The inputs are the ledger's R16 and R20, and the 07:07 ruling (`docs/superpowers/programs/centralised-update-management.md` on the coordination branch).

**Producers:**
- `main` at `9221416a` (#291, wave 12).
- Review 286 (F1 → R20(a), F2 → R20(b)).
- The 07:07 scoping (workflow `wf_286a790a-7fa`).
- This plan's scout, read-only at `9221416a`.
- This plan's prototype, measured at `9221416a` on a loaded Linux box (load 17–33 on 16 cores).
- This revision's re-measurement, at `9221416a` in a fresh worktree (load about 17). Every row marked *(measured)* was run through the real file with vitest, and restored with `cp` + `cmp`. The worker re-measures each one.

**D-refs this plan cites as they stand:** D-740 and D-741 (`ccrc-api-closed`'s derived token names and its comment-stripped scans), D-199 (notify.sh's address tiers), D-3818 to D-3820 (wave 9's containment and the loopback front).

## Not in this wave

Reviewers: do not raise these.

- **Placing `ccrc-api` through `ccrc update`'s spine** (an `_inst_atomic` line in `_inst_bins`, its census pin, README's "do not" sentence). It is a `ccd/ccrc` and README change, and claim 1046 holds both (D-4094, Reading 1(a)).
- **Token rotation.** It is the operator's call (07:07 question 3). Reading 2 says what it should wait for.
- **The harness containment parity** (wave 19), and the front's existing `-H @file` admission, which is unchanged here.
- **`ccrc-api`'s body on argv.** `--data-binary "$body"` still puts the JSON body on argv. It carries no token. Bodies are ask answers, mail acks and ledger rows, which are attribution rather than secrets (Reading 7).
- **Escaping or refusing a token that holds `"` or `\`.** The two shipped `-K -` sites do neither, and the ruling says to follow their spelling and escaping (Reading 3).
- **`set +x` in `deploy/notify.sh`.** Its caller discards its stderr (`>/dev/null 2>&1`, per notify.sh's own header), and any line added above line 29 moves `notify.sh:29`, which `ccd/ccrc` cites (Reading 4).
- **Everything under claims 1040, 1041, 1045 and 1046.** That includes `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/deploy.sh`, `README.md`, `shared/lifecycle.ts`, `server/test/installTreeFixture.ts`, `server/test/ccdWsHelpers.ts`, `server/test/ccrc-install.test.ts` and `server/test/single-definition.test.ts`.
- **Every other residue item.** The 07:07 entry maps them to waves 14–19.

## Global Constraints

- **Anchors.**
  - Every anchor is measured at `9221416a` and quoted.
  - Step 1 of each task re-measures its anchors by their QUOTED TEXT (`grep -nF`) on the tip being built, after `git fetch origin main`, and after a merge if `main` moved. The quote wins over any line number.
  - Find code with graphify first (`graphify query "…"` over `graphify-out/`), then confirm with `grep -nF`.
- **Scope.**
  - Change the files in File structure, and nothing else.
  - **Never write `ccd/ccrc`, `ccd/ccd`, `deploy/deploy.sh` or `README.md`.**
  - Re-read the live claims before the first edit and again before the push: `~/.local/bin/ccrc-api claims list --project ccrc-pwa`. If a live claim names a File-structure path, stop and mail the coordinator. At revision, the live claims were 1040, 1041, 1045 and 1046, and none named a File-structure path.
  - The command below prints nothing. It lists every path claims 1040, 1041, 1044 (since ended), 1045 and 1046 held at drafting, plus the never-write and no-ring-change paths:

        git diff --stat origin/main...HEAD -- \
          ccd/ccrc ccd/ccd ccd/ccrc-doctor-checks ccd/ccd-scope-sweep deploy/deploy.sh deploy/gen-wrappers.mjs \
          deploy/measure-continuity.py deploy/systemd deploy/hook-capture-reduce.mjs deploy/delegation-census.mjs \
          deploy/measure-workspace-lifecycle.py README.md CLAUDE.md agent/CLAUDE.md install.sh .github \
          agent/src agent/test server/src pwa shared \
          server/test/ccdWsHelpers.ts server/test/ccrc-install.test.ts server/test/installTreeFixture.ts \
          server/test/single-definition.test.ts server/test/ccrc-doctor.test.ts server/test/ccrc-uninstall.test.ts \
          server/test/ccd-auto-compact.test.ts server/test/ccd-limit-banner.test.ts server/test/ccd-operator-choice.test.ts \
          server/test/lifecycle.test.ts server/test/measure-continuity-stage6.test.ts \
          server/test/measure-continuity-stage7.test.ts server/test/scope-sweep.test.ts server/test/sourceScan.ts \
          server/test/reconstruction-drill.test.ts 'server/test/child-reclaim*' server/test/coord-store.test.ts \
          'server/test/ccd-ws-expire-*' server/test/hook-capture-reduce.test.ts server/test/delegation-rig \
          server/test/delegation-rig.test.ts server/test/delegation-census.test.ts server/test/fixtures \
          docs/superpowers/specs docs/superpowers/programs \
          docs/superpowers/plans/2026-09-22-child-reclamation-wave4-sweep-and-switch.md \
          docs/superpowers/plans/2026-10-04-workspace-lifecycle-wave3-ws-expire.md \
          docs/superpowers/plans/2026-10-05-delegation-broker-wave1-measurement.md \
          docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md

  - `git diff --stat origin/main...HEAD` lists exactly File structure's files.
- **Fixture HOMEs only.**
  - Every case that runs `ccd/ccrc-api` or `deploy/notify.sh` runs under a `mkTmp` HOME. For `ccrc-api` that is `ccrc-api.test.ts`'s `beforeEach` home and `ghContainedEnv`. For `notify.sh` it is `notify-addr.test.ts`'s stub-bin-only PATH.
  - No case reads the real user's `~/.cc-secrets`, `~/.ccrc`, `~/.cc-sessions` or `~/.cc-limits`. None touches tmux or a `claude-session@*` unit.
  - Never run `ccrc update`, `rollback`, `rollout`, `install` or `deploy.sh`.
- **Poisoned tools.**
  - A curl that a case did not plant itself is the real system curl. Only the case's own loopback listeners are reachable: `ccrc-api.test.ts`'s and `notify-addr.test.ts`'s, plus the second listener the hostile-stdin case opens to prove that nothing reaches it.
  - Every new curl a case plants either dials nothing (a recorder that exits 0), or is a recorder that execs the real curl with the stdin it recorded, or is the Task 1 front. The front reaches only `127.0.0.1:<port>`, and only with the port listed in `$HOME/curl-allow-ports`.
  - **A curl stub placed in front of `ccrc-api` must read its stdin** (`cat > …`). Under `pipefail`, a stub that exits 0 without draining the pipe can let `printf` die of SIGPIPE. The client would then answer `transport` (`curl rc 141`) on a call that succeeded (Risk notes).
- **Fixture tokens only, never a real token.**
  - The token is `'z'.repeat(64)`, which is both `ccrc-api.test.ts`'s `TOKEN` and `notify-addr.test.ts`'s own constant.
  - Never read or print `~/.cc-secrets/ccrc-mail.token` or `~/.ccrc/mail.token`. Check that they exist with `ls` only.
  - If you list processes, mask `x-ccrc-mail-token` and any 64-hex run in what you print: `sed -E 's/(x-ccrc-mail-token:? *)[^ "]+/\1***/I; s/[0-9a-f]{64}/***/g'`.
  - The one live call this plan makes is `ccrc-api claims list`, a read whose output carries no token.
- **Mutation-table discipline.**
  - Before each mutation, run `cp <file> "$SCRATCH/<id>.orig"`. Never use `git checkout --`, and never a bare `git stash`.
  - Apply the mutation and check that it parses: `bash -n` for shell, `sh -n` on the generated front for Task 1.
  - Run the named command. Restore with `cp`, check with `cmp`, and then `git status --porcelain` must show only this wave's files.
  - A row is done only with a measured red count and the assertion that fired. A spawn timeout is "code -1" and a suite hang is "killed by timeout(1)", never "red".
  - Each row lists its full expected red set. If the measured set differs, report it. Never accept it silently.
  - Rows T4-2 and T4-4 each leave one `ccrc-tmpfix-since-keep-*` directory under `$TMPDIR`, because the mutant forgets it, which is what the row measures. The directory holds a `0500` subdirectory, so a plain `rm -rf` fails. Remove it by hand after the row: `chmod -R u+rwx "$TMPDIR"/ccrc-tmpfix-since-keep-* && rm -rf "$TMPDIR"/ccrc-tmpfix-since-keep-*`.
- **D-numbers.**
  - This plan defines D-4094 and D-4095, from the block issued to run 287 (4094 to 4113), in `## Deviations found`.
  - **The worker's reserve is numbers 4096 to 4100.** Take them in order. Define each one in this plan's `## Deviations found`, in the commit that first cites it. Write any other unspent number bare.
  - Never write a number outside the block. Never call the allocator. Never land a `D-TBD-` spelling.
  - The commit that first writes D-4094 or D-4095 anywhere tracked must contain this plan, or come after the commit that does.
- **Suites.**
  - Run each file in the foreground, one command per call, inside `server/`, with a timeout of at least 600000 ms and under 600 s of wall time: `./node_modules/.bin/vitest run test/<file>.test.ts [-t "<pattern>"]`. Never use bare `npx vitest`. Never split by `file:line`.
  - Run `npm ci` in `server/`, and in `agent/` and `pwa/` for `typecheck-tests`, wherever `node_modules` is absent.
  - `TMPDIR` and all scratch go on the ROOT disk, under the session's scratchpad (`$SCRATCH/tmp`; `mkdir -p` it). Never on the work volume.
  - **The `-t` gate rule.** `-t` is a JavaScript regex matched against the full name (the describe titles plus the case title).
    - A title with `(` in it selects nothing unless the paren is escaped. Use paren-free substrings, `|` for alternation (never `\|`), and a negative lookahead `^(?!.*<pattern>)` for "the rest".
    - Every part must report a non-zero `Tests N passed`, and the parts must be disjoint.
    - The parts' PASSED counts must sum to the number of lines `./node_modules/.bin/vitest list test/<file>.test.ts` prints on this runner. (`vitest list` omits `itDarwin` and `skipIf` cases.)
    - A part that reports everything skipped, or zero tests, fails the gate.
  - The box is loaded. Prefer `-t` filters while iterating, and run each whole file, or its parts, at the end of each task.
- **No residue in tracked text:** no hostname, username, absolute home path, mount path, docserver URL or org name. Run `topology-clean.test.ts` after `git add` of each new or changed file.
- **Commits.**
  - Commit on the workspace branch only, at least once per task: `fix(api): …`, `fix(notify): …`, `test(update): …` or `docs(update): …`. Never use a separate feature branch.
  - Author and committer are the noreply identity.
  - Send the wave-done in the same turn as the push. Never end a turn to wait on CI.

## Review Focus

1. **The header still arrives, on every call shape.** This matters fleet-wide, and it is live at the release on every linked box (D-4094).
   - `ccrc-api.test.ts`'s real listener sees `x-ccrc-mail-token` equal to the fixture token on:
     - a GET;
     - a POST with a `--json <file>` body;
     - a POST with a `--json -` body, which is stdin used twice, once for the body and once for curl's config. Every mail ack (`ccrc-api mail ack N --json -`) has this shape.
   - The existing 96 cases stay green. That includes "sends the value line, not the document around it", and "uses the fixture box token against an armed real feed route", which runs against the real Fastify server, armed.
   - Mutants that drop `-K -` (T2-3) or send the header twice (T2-2) red both of those cases.
2. **The two stdin readers cannot collide, in either direction.**
   - *The body still arrives.* `body=$(cat)` drains stdin before `read_token` and the printf pipe run. T2-4 makes curl read the body from stdin instead (`body='@-'`). That reds 11 cases, including the collision case, so a regression that moved the body read after the pipe cannot stay green.
   - *The caller's stdin never reaches curl's config.* If it could, a caller could add `url`, `output` or `proxy` lines, and the token header would follow them. `runs list` with hostile stdin must hand curl exactly the one config line, fetch nothing from a second listener and write no `output` file. T2-5 (`{ printf …; cat; } |`) reds it. notify.sh gets the same proof, with and without a token (T3-5).
3. **The front admits only what the senders send.**
   - Every config key but `header` is refused, and each key row carries a header-shaped value, so only the key can refuse it: `url`, `proxy`, `connect-to`, `resolve`, `output` and `config`.
   - So is every other spelling of the key: `Header`, `header=`, two spaces, a leading space, a comment line, a trailing comment, and a `url` directive smuggled ahead of a header on one line (T1-11, T1-12).
   - So is a header name outside `[A-Za-z0-9-]+` (T1-13), and a `"`, a `\` or a CR in the value (T1-7, T1-14).
   - So is an `@file` header, a blank line, `-K <file>`, `--config -`, `-K-` and a second `-K -`.
   - The config is never logged (T1-8 reds 24).
   - The empty config passes. That is what notify.sh sends with no token, and it can name nothing (T1-9).
   - The `-K -` path runs the real curl after the proxy variables are unset (T1-15).
   - The widening reaches every `ccrcContainedEnv(…, { curl: 'loopback' })` case (D-4095). None of the admitted options can move the connection.
4. **notify.sh's tolerance survives.** With no token file it still POSTs: the config curl reads is empty, and the listener sees the body but no header (T3-2 reds the empty-config cases). `curl` and `"$BASE/api/notify"` stay on one line, and T3-4 shows that `auth-passkey`'s consumer scan reds when they are split.
5. **Neither sender prints the token.** The transport-failure path is scanned: argv, stdout and stderr are clean. Under an inherited `SHELLOPTS=xtrace`, `ccrc-api`'s stderr carries no token. T2-6 drops `set +x`, and that case reds.
6. **The per-test cleanup removes everything, and never too early.**
   - A home made in a `beforeAll` survives until the `afterAll`.
   - A describe-level `afterEach` still sees the test's home. The holder and lingerer SIGKILLs in `ccrc-update.test.ts` are describe-level `afterEach` hooks.
   - A failed removal is kept for the `afterAll`, not forgotten.
   - Registering the hooks on the file's last line still covers every test, because vitest collects the whole file before it runs a test (measured with a two-case probe, and its control).
   - Measured before the change: 648 homes reach the `afterAll`. After it, `ccrc-update.test.ts`'s `afterAll` removes 0, and the per-test removal never exceeds 116 ms.

## Risk notes

- **The blast radius, and how this plan proves the header still arrives.**
  - A broken `ccrc-api` breaks every fleet session's mail, claims, runs and ledger calls. A session reads that only as a `transport` envelope with exit 3.
  - The proof runs end to end, through the REAL curl, to a real HTTP listener:
    - `ccrc-api.test.ts` asserts the header value per call shape: a GET, a file body, a `--json -` body, hostile stdin, and a GET and a `--json -` call again behind the Task 1 front;
    - its armed-server case, against the real Fastify server, keeps the 401/200 contract;
    - `notify-addr.test.ts` asserts the header and body through the front, with and without a token.
  - **This is live at the release on every box whose `~/.local/bin/ccrc-api` is README's link** (D-4094). On a box holding `deploy.sh`'s copy, nothing changes until it is re-placed.
- **D-4094 is a risk as well as a ledger entry.** The ruling's premise, "ccrc-api and notify.sh reach every rostered home through ccrc update's install spine", is false as stated for `ccrc-api`. The spine places nothing.
  - This tree records that itself. README says "deploy.sh agent installs it; ccrc install and ccrc update do not", and `_inst_bins` has no `ccrc-api` line (`grep -n ccrc-api ccd/ccrc` finds one hit, a comment).
  - Which client a box runs depends on its placement. README's own `ln -sfn` link follows every update. `deploy.sh`'s copy follows none.
  - The scout measured the drafting box read-only. Its `~/.local/bin/ccrc-api` is a regular file, byte-identical to `main`'s (24435 bytes), dated 2026-09-17, so `deploy.sh` copied it there.
  - **On every copied box, R16's leak stands for `ccrc-api` until that box is re-placed.** Rotating the token before then puts the new token in process listings on its first call (Reading 2).
- **curl config parsing.** The token sits in a double-quoted config string, where curl treats `\` and `"` as escapes. A token holding either would be silently mangled, which gives a wrong header and a 401. The shipped token is `openssl rand -hex 32` (`ccd/ccrc`'s own prompt names it), and both shipped `-K -` sites accept the same exposure. This plan follows them (Reading 3).
- **`pipefail` and a curl that does not read stdin.**
  - Under `set -o pipefail`, a pipeline's status is the RIGHTMOST NON-ZERO status, not the last element's. So `ccrc-api`'s substitution reports curl's status only while `printf` succeeds.
  - Real curl reads the whole `-K -` config while it parses its arguments, before it connects, so `printf` (one short line into a pipe buffer) cannot take SIGPIPE on a live call.
  - A test stub that exits 0 without reading its stdin could, under load, turn a success into `transport` (`curl rc 141`). Global Constraints therefore require every stub in front of `ccrc-api` to drain stdin. The plan's recorders do.
  - `notify.sh` has no `pipefail` and ends in `|| true`. The old non-reading stub in `notify-addr.test.ts` is safe for that reason (measured: all 15 old cases are green with it).
- **`ccrc-api-closed.test.ts`'s print guard was predicted to red, and it does not** (measured green).
  - The guard flags non-comment lines that START with `echo`, `printf`, `logger` or `>&2` and that name a token variable. The new line starts with `code=$(printf …`, the shape both shipped sites use.
  - So the guard is untouched. The new source pin (Task 2) catches what the guard's line-start rule cannot see.
- **`tmpHelpers.ts` is imported by 246 test files.** Editing it makes the PR's `select tests` choose all of them, which is effectively a full server run.
  - That is the cost of putting the helper in the only place that can see `made`.
  - The edit is additive. The existing `mkTmp`, `removeTmpFixtures` and single `afterAll` registration are byte-unchanged, so the `tmpHelpers.ts:38-52` citation in `ccrc-account.test.ts` still holds, and `tmpfixtures.test.ts`'s "exactly one" pin stays green.
  - Only a file that calls `removeTmpFixturesEachTest()` changes behaviour, and only `ccrc-update.test.ts` does.
- **R20(a) does not reproduce here.**
  - On this box the whole sweep took 3.2 s: 61 + 1572 + 1609 ms over the three parts, measured with a temporary timer after a `find`/`du` walk that warmed the cache.
  - The 20 s overruns were on CI shards at `670d25fd` and `7b0a5454`. Their cause there (the volume, on a slower shared disk) is inferred, not measured. The volume is measured: 648 homes, 99,710 entries and 2,465,095,930 bytes.
  - The fix takes the volume out of the hook, whatever the disk. The gate checks the PR's server shards for the hook's absence (Task 6).
- **`ccrc-update.test.ts` ran in three parts** at load 21–33: 20 in 17 s, 169 in 238 s and 313 in 456 s, with `vitest list` = 502 = 20 + 169 + 313. The third part was within 150 s of the cap at that load. If `timeout(1)` kills it, split it with the `-t` rule and report the split. At revision, with the call moved to the last line, the `supervisor sweep` part was re-run (20 passed, 502 listed). The other two parts were not re-run; the worker runs all three.
- **Per-test removal and lingering children.** A detached child that writes into its home after the test returns could make `rmSync` throw `ENOTEMPTY`. `removeTmpFixturesSince` then keeps that directory for the `afterAll`, which removes it or fails loudly. In 502 cases the prototype kept 0.
- **Line citations.**
  - The new import in `ccrc-api.test.ts` moves the listener block that `update-catalogue.test.ts:7` cites as `ccrc-api.test.ts:52-65`. It is now 53–66, and the comment is re-cited.
  - `ccrc-update.test.ts`'s call goes on the last line, so no line above it moves.
  - `ccrc-api`'s `set +x` is folded onto line 57, so `ccrc-api:100`, `:122-126` and `:206-207` hold.
  - `notify.sh` changes nothing above line 88, so `notify.sh:29` holds.
- **macOS.** The new `ccrc-api` and `notify-addr` cases run on `test-macos`, which is advisory and ruled flaky by default. They use `/bin/sh`, `printf`, `cat`, `grep -E` (with `[:cntrl:]`), `env` and curl's `-K -`, all present there. `tmpfixtures`' EACCES case skips only when run as root.

## Deviations found

These are departures from the 07:07 ruling, or from what shipped text at `9221416a` documents.

- **D-4094** — *`ccd/ccrc-api` does not reach the fleet through `ccrc update`'s install spine. It reaches a box on the release only where README's link places it, so the wave's stated live effect is corrected.*
  - **Ruled:** "LIVE EFFECT: ccrc-api and notify.sh reach every rostered home through ccrc update's install spine on the release after merge."
  - **Shipped:**
    - `_inst_bins` in `ccd/ccrc` places no `ccrc-api` (its one mention in `ccd/ccrc` is a comment);
    - README says "deploy.sh agent installs it; ccrc install and ccrc update do not";
    - README's install block places it by hand as a link, `ln -sfn ~/ccrc/ccd/ccrc-api ~/.local/bin/ccrc-api`, "a link follows every update". A box placed this way runs each release's client after the `~/ccrc` flip;
    - `deploy/deploy.sh`'s agent arm places a regular-file copy, `install_atomic ccd/ccrc-api .local/bin/ccrc-api 755`, which no release refreshes. The drafting box holds such a copy;
    - `deploy/notify.sh` IS placed by the spine (`_inst_atomic "$tree/deploy/notify.sh" "$HOME/.cc-sessions/notify.sh" 755`).
  - **Why it is not fixed here:** placing `ccrc-api` through the spine is a `ccd/ccrc` change, plus a census pin and README's sentence. Claim 1046 holds `ccd/ccrc` and `README.md`.
  - **Now:**
    - the client is fixed in the tree, and every case that runs the tree's copy pins it;
    - a linked box runs it on the release after merge, so the header-arrival proofs are the merge gate;
    - a copied box keeps the old client until it is re-placed;
    - Reading 1 asks how to close that, and Reading 2 ties the token rotation to it.
- **D-4095** — *The test curl front admits more than `-K -`: also `-m`, `-X` and `-d`/`--data-binary`, and an empty `-K -` config. The widening reaches every case that uses the front.*
  - **Ruled:** "The rule admits only `header = "…"` lines and refuses `url`, `proxy`, `connect-to` and every other key, with mutation rows; and a case that drives ccrc-api through the front."
  - **Shipped:** `loopbackCurlFront` refused every option outside ccrc's own set. So `-m`, `-X` and `--data-binary` (which `ccrc-api` uses) and `-d` (which `notify.sh` uses) all exited 97, and no case could drive either sender through it, with or without `-K -`.
  - **Now:**
    - `-m` takes a value, as `--max-time` does;
    - `-X` takes a value of capital letters only;
    - `-d` and `--data-binary` take a value that does not start with `@`, so no file is read;
    - `-K -` exactly, read once in the check pass, takes zero or more lines matching `^header = "[A-Za-z0-9-]+: [^"\[:cntrl:]]*"$`. The empty config is what notify.sh sends with no token;
    - everything else stays refused, with a row each, and the regex's four parts each have a mutation row (T1-1 to T1-15);
    - the config goes back to the real curl on its stdin, after the proxy variables are unset, and is never logged.
  - **Reach:** `ccrcContainedEnv(…, { curl: 'loopback' })` installs the same front for `ccrc-update`, `ccrc-cli`, `ccrc-install-graphify` and `sweepFixture`'s users. A ccrc curl call that used these options would now pass where it was refused before. That is safe for containment, because none of them can move the connection off the URL the front checks: a method word, a body that names no file, a time bound, and request headers only. The docstring now lists them as the senders' options, not ccrc's. `ccrc-install.test.ts` plants a poisoned curl and is unaffected.

## File structure

**New**
- `docs/superpowers/plans/2026-10-06-centralised-update-w13-token-off-argv.md` (this plan).

**Changed**
- `ccd/ccrc-api` (Task 2): line 57 (`set +x;` folded in), the `args` array, the curl call, `TOKEN=""`.
- `deploy/notify.sh` (Task 3): the curl call.
- `server/test/containedTools.ts` (Task 1): `loopbackCurlFront`, its docstring and the header note.
- `server/test/ccrc-containment.test.ts` (Task 1): `setup` takes extra env and stdin, and its fake records stdin and proxy variables; 39 new cases.
- `server/test/ccrc-api.test.ts` (Task 2): two imports; one assertion in the transport case; the new describe (7 cases).
- `server/test/ccrc-api-closed.test.ts` (Task 2): one case.
- `server/test/update-catalogue.test.ts` (Task 2): line 7's citation `ccrc-api.test.ts:52-65` → `:53-66`.
- `server/test/coord-token.test.ts` (Task 3): the notify.sh pin rewritten.
- `server/test/notify-addr.test.ts` (Task 3): three imports; `runNotify` takes an optional `input`; the new describe (6 cases).
- `server/test/tmpHelpers.ts` (Task 4): `tmpMark`, `removeTmpFixturesSince`, `removeTmpFixturesEachTest`.
- `server/test/tmpfixtures.test.ts` (Task 4): imports; 5 cases.
- `server/test/ccrc-update.test.ts` (Task 4): one import name, and the call with its comment on the file's last lines.
- `docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md` (Task 5): one As-built bullet.

**Run, not edited:** `auth-passkey`, `install-coordinator-skill`, `coordinator-skill`, `coord-pause-route`, `macos-platform`, `ccrc-api-ship`, `coord-envelope`, `notify-token`, `box-token-census`, `ccd-pool-sync`, `ccd-update-sync`, `ccrc-cli`, `ccd-tmux-anchor`, `ccrc-install-graphify`, `ccrc-sweep-deliberate-stop`, `single-definition`, `typecheck-tests`, `topology-clean`, `dtbd`, `deviation-refs`.

## Tasks

### Task 1: The test curl front admits `-K -` with `header = "…"` lines only, plus the senders' three options (D-4095)

**Files:** `server/test/containedTools.ts`, `server/test/ccrc-containment.test.ts`.

**Interfaces:**
- Produces: `loopbackCurlFront(realCurl: string): string`, with the same signature. Its script now also passes `-m <v>`, `-X <CAPS>`, `-d|--data-binary <not @…>` and `-K -`, whose stdin it validates and feeds on to the real curl.
- Consumed by: Task 2's drive-through (`ccrc-api.test.ts`), Task 3's (`notify-addr.test.ts`), and every `ccrcContainedEnv(…, { curl: 'loopback' })` case.

- [ ] **Step 1: Re-measure.**
  ```bash
  cd server
  grep -nF "    '      --connect-timeout|--max-time|--max-filesize|--speed-limit|--speed-time|-o|-w|-H) [ \$# -gt 0 ] || refuse; shift ;;'," test/containedTools.ts
  grep -nF "    '      -*) refuse ;;'," test/containedTools.ts
  grep -nF "    'unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY all_proxy ALL_PROXY'," test/containedTools.ts
  grep -nF '    `exec ${real} -q "$@"`,' test/containedTools.ts
  grep -nF ' *  - REFUSED, whatever its value: every other option. That subsumes `-K`/`--config`, `-x`/`--proxy`, `--preproxy`,' test/containedTools.ts
  grep -nF "    ['-K', ['-K', 'x', ok]]," test/ccrc-containment.test.ts
  grep -nF "  it('--url=<listed> passes the front (curl itself answers 2" test/ccrc-containment.test.ts
  grep -nF "      run: (args) => spawnSync('/bin/sh', ['-c', 'exec curl \"\$@\"', 'curl', ...args], { env, encoding: 'utf8' }).status ?? -1," test/ccrc-containment.test.ts
  grep -ln "ccrcContainedEnv" test/*.ts                                       # the front's reach (D-4095)
  ./node_modules/.bin/vitest list test/ccrc-containment.test.ts | wc -l     # 46 at 9221416a
  ```
- [ ] **Step 2: Write the cases first (red).** In `ccrc-containment.test.ts`'s "the loopback curl front parses argv" describe:
  - `setup` takes extra env and stdin. Its fake real curl records its stdin and any proxy variable it inherited:
    ```ts
      const setup = (extraEnv: NodeJS.ProcessEnv = {}): {
        run: (args: string[], input?: string) => number; fakeArgv: () => string[]; fakeStdin: () => string;
        fakeProxyEnv: () => string; poison: () => string; passed: () => string;
      } => {
        const home = mkTmp('contain-h2-');
        const bin = join(home, 'bin');
        mkdirSync(bin, { recursive: true });
        const fake = join(bin, 'fake-real-curl');
        // It also keeps what it was handed on stdin, and any proxy variable it inherited (wave 13, R16): a `-K -` config
        // must reach the real curl intact, and the `-K -` path must run it with the proxy variables unset.
        writeFileSync(fake, '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HOME/fake-curl-argv"\ncat > "$HOME/fake-curl-stdin"\n'
          + 'env | grep -i \'proxy=\' >> "$HOME/fake-curl-proxy-env"\nexit 0\n', { mode: 0o755 });
        writeFileSync(join(bin, 'curl'), loopbackCurlFront(fake), { mode: 0o755 });
        writeFileSync(join(home, 'curl-allow-ports'), `${P}\n`);
        const env: NodeJS.ProcessEnv = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, ...extraEnv };
        const read = (f: string): string => (existsSync(join(home, f)) ? readFileSync(join(home, f), 'utf8') : '');
        return {
          run: (args, input = '') => spawnSync('/bin/sh', ['-c', 'exec curl "$@"', 'curl', ...args],
            { env, encoding: 'utf8', input }).status ?? -1,
          fakeArgv: () => read('fake-curl-argv').split('\n').filter(Boolean),
          fakeStdin: () => read('fake-curl-stdin'),
          fakeProxyEnv: () => read('fake-curl-proxy-env'),
          poison: () => read('curl-poison'),
          passed: () => read('curl-front-passed'),
        };
      };
    ```
  - Insert before the `--url=<listed>` case:
    ```ts
      // `-K -` with a stdin config of `header = "…"` lines, and the three options ccrc-api and notify.sh add (wave 13, R16;
      // D-4095). A row whose subject is an option hands the front a config that would otherwise pass; a row whose subject
      // is the config changes one thing in an otherwise-valid line, so each row refuses for its own reason. The token is a
      // fixture: no row carries a real one.
      const HDR = 'header = "x-ccrc-mail-token: ' + 'z'.repeat(64) + '"\n';
      const refusedCfg: Array<[string, string[], string]> = [
        ['-K <file> (only `-K -` is admitted)', ['-K', '/tmp/x', ok], HDR],
        ['--config - (only the short spelling the senders use)', ['--config', '-', ok], HDR],
        ['-K- attached', ['-K-', ok], HDR],
        ['a second -K -', ['-K', '-', '-K', '-', ok], HDR],
        // The key rows carry a HEADER-SHAPED value, so the key is the only thing that can refuse them (wave 13, R16).
        ['a url key', ['-K', '-', ok], 'url = "x-a: b"\n'],
        ['a proxy key', ['-K', '-', ok], 'proxy = "x-a: b"\n'],
        ['a connect-to key', ['-K', '-', ok], 'connect-to = "x-a: b"\n'],
        ['a resolve key', ['-K', '-', ok], 'resolve = "x-a: b"\n'],
        ['an output key', ['-K', '-', ok], 'output = "x-a: b"\n'],
        ['a config key (curl would read a second config)', ['-K', '-', ok], 'config = "x-a: b"\n'],
        ['a capitalised key', ['-K', '-', ok], 'Header = "x-a: b"\n'],
        ['no space before the =', ['-K', '-', ok], 'header= "x-a: b"\n'],
        ['two spaces before the =', ['-K', '-', ok], 'header  = "x-a: b"\n'],
        ['a leading space', ['-K', '-', ok], ' header = "x-a: b"\n'],
        ['a comment line', ['-K', '-', ok], '# header = "x-a: b"\n'],
        ['a trailing comment', ['-K', '-', ok], 'header = "x-a: b" # c\n'],
        ['a url directive smuggled ahead of a header on one line', ['-K', '-', ok], 'url = "http://127.0.0.1:7788/" header = "x-a: b"\n'],
        ['a dot in the header name', ['-K', '-', ok], 'header = "x.y: z"\n'],
        ['an @ leading the header name', ['-K', '-', ok], 'header = "@x: y"\n'],
        ['a carriage return inside the header value', ['-K', '-', ok], 'header = "x-a: b\r"\n'],
        ['a good header line beside a url line', ['-K', '-', ok], `${HDR}url = "http://127.0.0.1:7788/"\n`],
        ['an @file header', ['-K', '-', ok], 'header = "@/etc/passwd"\n'],
        ['a quote inside the header value', ['-K', '-', ok], 'header = "x-ccrc-mail-token: a"b"\n'],
        ['a backslash inside the header value', ['-K', '-', ok], 'header = "x-ccrc-mail-token: a\\b"\n'],
        ['an unquoted header value', ['-K', '-', ok], 'header = x-ccrc-mail-token: zz\n'],
        ['the long-option config spelling', ['-K', '-', ok], '--header "x-ccrc-mail-token: zz"\n'],
        ['a blank line inside the config', ['-K', '-', ok], `${HDR}\n${HDR}`],
        ['--data-binary @file', ['--data-binary', '@/etc/passwd', ok], ''],
        ['-d @file', ['-d', '@/etc/passwd', ok], ''],
        ['-X with a URL in its value', ['-X', 'GET http://127.0.0.1:7788/', ok], ''],
        ['-X lowercase', ['-X', 'post', ok], ''],
        ['-X empty', ['-X', '', ok], ''],
      ];
      for (const [what, args, input] of refusedCfg) {
        it(`refuses ${what}: exit 97, recorded by argv alone, and nothing reaches curl (wave 13, R16)`, () => {
          const t = setup();
          expect(t.run(args, input), args.join(' ')).toBe(97);
          expect(t.fakeArgv(), 'the (fake) real curl must not have run').toEqual([]);
          expect(t.poison()).toContain(args.join(' '));
          for (const line of input.split('\n').filter(Boolean)) {
            expect(t.poison(), 'the config reached the refusal log').not.toContain(line);
          }
          expect(t.passed()).toBe('');
        });
      }
      const passesCfg: Array<[string, string[], string]> = [
        ['ccrc-api\'s POST shape (`-K -` header, a JSON body)', ['-sS', '-K', '-', '-m', '30', '-o', '/tmp/x', '-w', '%{http_code}',
          '-X', 'POST', '-H', 'content-type: application/json', '--data-binary', '{"program":"p"}', `${ok}api/runs`], HDR],
        ['ccrc-api\'s GET shape', ['-sS', '-K', '-', '-m', '30', '-o', '/tmp/x', '-w', '%{http_code}', '-X', 'GET', `${ok}api/runs`], HDR],
        ['notify.sh\'s shape', ['-fsS', '-m', '5', '-X', 'POST', `${ok}api/notify`, '-K', '-', '-H', 'content-type: application/json',
          '-d', '{"message":"m"}'], HDR],
        ['notify.sh\'s shape with no token: an empty config', ['-fsS', '-m', '5', '-X', 'POST', `${ok}api/notify`, '-K', '-',
          '-H', 'content-type: application/json', '-d', '{"message":"m"}'], ''],
        ['two header lines', ['-sS', '-K', '-', ok], `${HDR}header = "accept: application/json"\n`],
      ];
      for (const [what, args, input] of passesCfg) {
        it(`passes ${what}, to the real curl with -q first, and hands it the config on stdin (wave 13, R16)`, () => {
          const t = setup();
          expect(t.run(args, input), args.join(' ')).toBe(0);
          const argv = t.fakeArgv();
          expect(argv[0], 'the (fake) real curl ran with -q first and the argv unchanged').toBe(`-q ${args.join(' ')}`);
          expect(t.fakeStdin(), 'the config did not reach the real curl intact').toBe(input);
          expect(t.passed()).toContain(ok);
          expect(t.poison()).toBe('');
        });
      }
      it('without -K -, the real curl gets the caller\'s stdin untouched: the front reads nothing (wave 13, R16)', () => {
        const t = setup();
        expect(t.run(['-sS', ok], 'not a config\n')).toBe(0);
        expect(t.fakeStdin()).toBe('not a config\n');
      });
      it('the -K - path runs the real curl with the parent\'s proxy variables unset, as the exec path does (wave 13, R16)', () => {
        const t = setup({ http_proxy: 'http://127.0.0.1:7788', HTTPS_PROXY: 'http://127.0.0.1:7788', ALL_PROXY: 'socks5://127.0.0.1:7788' });
        expect(t.run(['-sS', '-K', '-', ok], HDR)).toBe(0);
        expect(t.fakeStdin(), 'the -K - path did not run').toBe(HDR);
        expect(t.fakeProxyEnv(), 'a proxy variable reached the real curl on the -K - path').toBe('');
      });
    ```
- [ ] **Step 3: Run, expect red:** `cd server && ./node_modules/.bin/vitest run test/ccrc-containment.test.ts -t "loopback curl front parses argv"`.
  - **Expected:** 6 of 71 red: the five pass rows, and the proxy case. Each reds with `expected 97 to be +0`, because the old front refuses `-K`, `-m`, `-X`, `-d` and `--data-binary`.
  - The refused rows and the stdin row are green already. A front that refuses all of these options refuses every refused row. *(measured: T1-0 below)*
- [ ] **Step 4: Implement.** In `containedTools.ts`:
  - In the header note, after "Everything it refuses is recorded.":
    ```ts
    //   a `-K` config file (which could name a URL this scan cannot see). Everything it refuses is recorded. Since wave 13
    //   (R16) it admits `-K -` with a stdin config of `header = "…"` lines only, because ccrc-api and notify.sh send the box
    //   token that way, and `-m`, `-X` and `-d`/`--data-binary`, so either sender can be driven through it.
    ```
  - In the docstring, add the following after the first PASSES bullet, and in REFUSED change "That subsumes `-K`/`--config`," to "That subsumes `--config`,":
    ```ts
     *  - PASSES, since wave 13 (R16, D-4095): what ccd/ccrc-api and deploy/notify.sh add, NOT what ccrc uses — `-m` with
     *    its value; `-X` with a method of capital letters only; `-d` and `--data-binary` with a value that does not start
     *    with `@` (no file read); and `-K -` exactly, whose stdin config must be `header = "<name>: <value>"` lines only,
     *    each line starting `header = "`, the name `[A-Za-z0-9-]+`, the value holding no `"`, no `\` and no control
     *    character; an EMPTY config passes too (notify.sh sends one when it has no token). Any other key (`url`, `proxy`,
     *    `connect-to`, `resolve`, `output`, `config`, …), another spelling of the key, an `@file` header, a blank or
     *    comment line, a second `-K -`, `-K <file>` and `--config` are refused. The config is read once and handed to the
     *    real curl on its stdin; it is never written to a log. Every `ccrcContainedEnv(…, { curl: 'loopback' })` case runs
     *    behind this same front, so a ccrc call using these would pass too: none of them can move the connection off the
     *    URL this scan reads (a method word, a body that names no file, a time bound, request headers).
    ```
  - In the script, between `url_ok`'s closing `'}',` and `'scan() {',`:
    ```ts
        // `-K -` (wave 13, R16): stdin is read ONCE, in the check pass, and must be nothing but `header = "<name>: <value>"`
        // lines, anchored at the line start — no other key, no `@file`, no quote, backslash or control character in the
        // value. An EMPTY config passes (notify.sh with no token sends one; it can name nothing), and a second `-K -` is
        // refused. The config is never logged: a refusal records argv only.
        'cfg=; have_cfg=',
        'cfg_ok() {',
        '  [ -n "$cfg" ] || return 0',
        '  ! printf \'%s\\n\' "$cfg" | grep -qvE \'^header = "[A-Za-z0-9-]+: [^"\\\\[:cntrl:]]*"$\'',
        '}',
    ```
  - In `scan`, the value-option line gains `-m`, and three arms follow it:
    ```ts
        '      --connect-timeout|--max-time|--max-filesize|--speed-limit|--speed-time|-m|-o|-w|-H) [ $# -gt 0 ] || refuse; shift ;;',
        '      -X) [ $# -gt 0 ] || refuse; case "$1" in ""|*[!A-Z]*) refuse ;; esac; shift ;;',
        '      -d|--data-binary) [ $# -gt 0 ] || refuse; case "$1" in @*) refuse ;; esac; shift ;;',
        '      -K) [ $# -gt 0 ] && [ "$1" = - ] || refuse',
        '          if [ "$mode" = check ]; then [ -z "$have_cfg" ] || refuse; cfg=$(cat); have_cfg=1; cfg_ok || refuse; fi; shift ;;',
    ```
  - **Immediately AFTER `'unset http_proxy HTTP_PROXY https_proxy HTTPS_PROXY all_proxy ALL_PROXY',` and before `` `exec ${real} -q "$@"`, ``**, never above the unset (T1-15):
    ```ts
        // The config read in the check pass goes back on the real curl's stdin; without `-K -`, stdin is the caller's. It
        // sits AFTER the unset above, so the `-K -` path runs the real curl with no proxy variable either.
        `[ -z "$have_cfg" ] || { { [ -z "$cfg" ] || printf '%s\\n' "$cfg"; } | ${real} -q "$@"; exit $?; }`,
    ```
    The `exit $?` is load-bearing. An `exec` inside a pipeline replaces only that pipeline's subshell, and the front would then run the real curl a second time.
  - Check that the generated script parses. Write `loopbackCurlFront('/usr/bin/curl')` to `$SCRATCH/front.sh` (for example with `node --experimental-strip-types` on a two-line `.mjs` that imports it), then run `sh -n "$SCRATCH/front.sh"`.
- [ ] **Step 5: Run:** `cd server && ./node_modules/.bin/vitest run test/ccrc-containment.test.ts`. **Expected:** `Tests 85 passed (85)` (46 + 39). The `-t "loopback curl front parses argv"` part is 71. *(measured: 85 passed)*
- [ ] **Step 6: Mutation table** *(measured)*. Mutate `containedTools.ts`, with `cp` + `cmp` around each row. Each row runs three commands:
  - `ccrc-containment -t "loopback curl front parses argv"` (71 cases);
  - `ccrc-api -t "R16"` (7);
  - `notify-addr -t "R16"` (6).

  Run the second and third commands once Tasks 2 and 3 exist. They are 0 red unless the row names them.

  | # | Guard | Mutation | Goes red (full expected set) |
  |---|---|---|---|
  | T1-0 | the change itself (revert) | the whole file replaced by `git show 9221416a:server/test/containedTools.ts` | 6 of 71: the five pass rows and the proxy case (`expected 97 to be +0`). ccrc-api 1 of 7: the drive-through (`no response from the server`). notify-addr 2 of 6: both drive-throughs (`the front refused notify.sh's call`) |
  | T1-1 | only `-K -`, never `-K <file>` | `'      -K) [ $# -gt 0 ] && [ "$1" = - ] \|\| refuse',` → `'      -K) [ $# -gt 0 ] \|\| refuse',` | 2 of 71: "refuses -K <file> (only `-K -` is admitted)", and the wave-9 "refuses -K" row (`-K x` with empty stdin now passes as an empty config) |
  | T1-2 | the config is validated | `have_cfg=1; cfg_ok \|\| refuse; fi; shift ;;',` → `have_cfg=1; fi; shift ;;',` | 23 of 71: every config-subject row. Those are the six key rows; capitalised key, no space, two spaces, leading space, comment line, trailing comment, smuggled url; dot in name, `@` in name; CR; good-header-beside-url, `@file`, quote, backslash, unquoted, long-option spelling and blank line |
  | T1-3 | a second `-K -` is refused | `then [ -z "$have_cfg" ] \|\| refuse; cfg=$(cat);` → `then cfg=$(cat);` | 1 of 71: "refuses a second -K -" |
  | T1-4 | no `@file` data | `case "$1" in @*) refuse ;; esac; shift ;;',` → `shift ;;',` | 2 of 71: `--data-binary @file` and `-d @file` |
  | T1-5 | `-X` takes capitals only | `refuse; case "$1" in ""\|*[!A-Z]*) refuse ;; esac; shift ;;` → `refuse; shift ;;` | 3 of 71: `-X` with a URL, lowercase, empty |
  | T1-6 | the config is fed on to the real curl | the `[ -z "$have_cfg" ] \|\| { … exit $?; }` line deleted | 5 of 71: the four pass rows with a non-empty config (`the config did not reach the real curl intact`), and the proxy case (`the -K - path did not run`). ccrc-api 1 of 7: the drive-through. notify-addr 1 of 6: the with-token drive-through (`auth: undefined`) |
  | T1-7 | the value class | in `cfg_ok`'s pattern, `: [^"\\\\[:cntrl:]]*"$` → `: .*"$` | 3 of 71: the CR, quote and backslash rows |
  | T1-8 | the config is never logged | `"$argv_log" >> "$HOME/curl-poison"` → `"$argv_log $cfg" >> "$HOME/curl-poison"` | 24 of 71: T1-2's 23, plus "a second -K -" (`the config reached the refusal log`) |
  | T1-9 | an empty config passes | `'  [ -n "$cfg" ] \|\| return 0',` → `… return 1',` | 1 of 71: "passes notify.sh's shape with no token". notify-addr 1 of 6: the no-token drive-through (`the front refused notify.sh's call`) |
  | T1-10 | stdin is read only for `-K -` | `'cfg=; have_cfg=',` → `'cfg=$(cat); have_cfg=',` | 29 of 71: T1-2's 23, the four non-empty pass rows, "without -K -, the real curl gets the caller's stdin untouched", and the proxy case. ccrc-api 1 of 7 and notify-addr 1 of 6: the with-token drive-throughs |
  | T1-11 | only the `header` key | `'^header = "` → `'^[a-z-]+ = "` | 6 of 71: the url, proxy, connect-to, resolve, output and config key rows |
  | T1-12 | the line-start anchor | `\'^header = ` → `\'header = ` | 3 of 71: leading space, comment line, and the url directive smuggled onto one line |
  | T1-13 | the header-name class | `"[A-Za-z0-9-]+: ` → `"[^:]+: ` | 2 of 71: a dot in the name, an `@` leading the name |
  | T1-14 | no control character in the value | `[^"\\\\[:cntrl:]]*` → `[^"\\\\]*` | 1 of 71: the CR row |
  | T1-15 | the `-K -` path runs after the proxy unset | the re-feed line and its comment moved above `'unset http_proxy …',` | 1 of 71: the proxy case (`a proxy variable reached the real curl on the -K - path`) |
- [ ] **Step 7: Commit:** `test(containment): the loopback curl front admits -K - with header lines only, and -m, -X, -d/--data-binary (wave 13, R16; D-4095)`. If this plan is not on the branch yet, commit it in the same commit.

### Task 2: R16 — `ccrc-api` hands the token to curl on stdin (`-K -`), never on argv, and never prints it

**Files:** `ccd/ccrc-api`, `server/test/ccrc-api.test.ts`, `server/test/ccrc-api-closed.test.ts`, `server/test/update-catalogue.test.ts`.

**Interfaces:**
- Consumes: Task 1's `loopbackCurlFront`.
- Produces: no new interface. Every exit code and envelope is unchanged.

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nx 'set -uo pipefail' ccd/ccrc-api                                                                # 57
  grep -nF '  local -a args=(-sS -m 30 -o "$out" -w '"'"'%{http_code}'"'"'' ccd/ccrc-api                       # ~444
  grep -nF '                 -X "$method" -H "x-ccrc-mail-token: $TOKEN")' ccd/ccrc-api                        # ~445
  grep -nF '  code=$(curl "${args[@]}" "$url" 2>/dev/null)' ccd/ccrc-api                                       # ~448
  grep -nF '      body=$(cat)' ccd/ccrc-api                                                                    # ~351, BEFORE read_token
  grep -nF 'read_token() {   # sets TOKEN, or refuses (D-2724). Never call it in $( ).' ccd/ccrc-api
  grep -nF "status=\"\$(printf 'header = \"x-ccrc-mail-token: %s\"\\n' \"\$tok\" \\" ccd/ccd-pool-sync ccd/ccd-update-sync   # the spelling copied
  grep -n '^set +x' ccd/ccd-pool-sync ccd/ccd-update-sync                                                     # the secrets control copied
  grep -n 'ccrc-api:[0-9]' ccd/ccd-pool-sync ccd/session-hook.sh ccd/ccrc deploy/account-op.mjs server/test/ccrc-account.test.ts   # :100, :122-126, :206-207 — all must hold
  git grep -nE 'ccrc-api\.test\.ts:[0-9]' -- ':!docs'                                                        # update-catalogue.test.ts:7 only
  grep -nF "  it('exits non-zero when NO response happened, and still answers in JSON', async () => {" server/test/ccrc-api.test.ts
  cd server && ./node_modules/.bin/vitest list test/ccrc-api.test.ts | wc -l          # 96
  ./node_modules/.bin/vitest list test/ccrc-api-closed.test.ts | wc -l                # 9
  ```
  Line 57 changes IN PLACE. Every other edit sits at line 440 or later. Comments elsewhere cite `ccrc-api:100`, `:122-126` and `:206-207`, and `coord-pause-route.test.ts` reads the "WHAT IS DELIBERATELY ABSENT" to "SELF-CONTAINED" passage near the top of the file.
- [ ] **Step 2: Write the cases first (red).**
  - In `ccrc-api.test.ts`:
    - `import { spawn } from 'node:child_process';` becomes `import { spawn, spawnSync } from 'node:child_process';`;
    - add `import { loopbackCurlFront } from './containedTools.js';` after the `tmpHelpers` import;
    - in "exits non-zero when NO response happened, and still answers in JSON", add after `expect(typeof body.detail).toBe('string');`:
      ```ts
          expect(r.stdout + r.stderr, 'the transport refusal echoed the token (R16)').not.toContain(TOKEN);
      ```
    - insert this describe before the `// D-2724, D-2725.` comment:
    ```ts
    // R16 (centralised-update wave 13). A `-H` header value is readable in every
    // process listing on the box (`ps`, /proc/<pid>/cmdline) for the life of the
    // call, and the box token is one shared secret. So the client hands it to curl
    // on STDIN as a `-K -` config line. A curl that RECORDS what it was given, one
    // argv word per line plus its stdin, then execs the real curl with that stdin,
    // so the listener above still measures what arrived. Asserting `-K -` in argv
    // as well as the config on stdin is what tells "sent on stdin" from "a recorder
    // that always captures stdin" (ccd-pool-sync.test.ts's warning about its stub).
    describe('the token never rides curl\'s argv (R16)', () => {
      const REAL_CURL = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/curl';
      const plantRecorder = (): void => {
        fs.writeFileSync(path.join(harnessBin(home), 'curl'),
          `#!/bin/sh\nprintf '%s\\n' "$@" > "$HOME/curl.argv"\ncat > "$HOME/curl.stdin"\n`
          + `exec '${REAL_CURL}' "$@" < "$HOME/curl.stdin"\n`, { mode: 0o755 });
      };
      const argv = (): string[] => fs.readFileSync(path.join(home, 'curl.argv'), 'utf8').split('\n');
      const stdin = (): string => fs.readFileSync(path.join(home, 'curl.stdin'), 'utf8');
      const CONFIG = `header = "x-ccrc-mail-token: ${TOKEN}"\n`;

      it.each([
        ['a GET', ['runs', 'list'], undefined, ''],
        ['a POST whose body is a --json file', ['runs', 'open', '--json', 'BODYFILE'], undefined, '{"program":"p","wave":1}'],
        // THE COLLISION CASE: stdin is the body (read by `body=$(cat)`) AND curl's
        // config (the printf pipe). The mail envelope's own ack line is this shape.
        ['a POST whose body is --json - (stdin twice: the body, then curl\'s config)', ['asks', 'answer', '7', '--json', '-'],
          '{"fromId":"parent","fromUuid":"u","optionIndexes":[0]}', '{"fromId":"parent","fromUuid":"u","optionIndexes":[0]}'],
      ])('%s: argv holds neither the token nor its header, stdin carries the config, and both arrive', async (_what, args, input, body) => {
        plantRecorder();
        if (args.includes('BODYFILE')) fs.writeFileSync(path.join(home, 'body.json'), body);
        const r = await run(args.map((a) => (a === 'BODYFILE' ? path.join(home, 'body.json') : a)), input);
        expect(r.status, r.stderr).toBe(0);
        const words = argv();
        expect(words.filter((w) => w.includes(TOKEN)), 'the token is on curl\'s argv').toEqual([]);
        expect(words.filter((w) => /x-ccrc-mail-token/i.test(w)), 'the token header is on curl\'s argv').toEqual([]);
        expect(words.some((w, i) => w === '-K' && words[i + 1] === '-'), `no \`-K -\` in argv: ${words.join(' ')}`).toBe(true);
        expect(stdin()).toBe(CONFIG);
        expect(seen).toHaveLength(1);
        expect(seen[0]!.auth).toBe(TOKEN);
        expect(seen[0]!.body).toBe(body);
      });

      it('drives the client through the loopback curl front: the front admits its exact calls, and the header arrives', async () => {
        fs.writeFileSync(path.join(harnessBin(home), 'curl'), loopbackCurlFront(REAL_CURL), { mode: 0o755 });
        fs.writeFileSync(path.join(home, 'curl-allow-ports'), `${(server.address() as AddressInfo).port}\n`);
        const body = '{"fromId":"parent","fromUuid":"u","optionIndexes":[0]}';
        const a = await run(['asks', 'answer', '7', '--json', '-'], body);
        const b = await run(['runs', 'list']);
        expect([a.status, b.status], `${a.stderr}\n${b.stderr}`).toEqual([0, 0]);
        expect(fs.existsSync(path.join(home, 'curl-poison')), 'the front refused a call the client makes').toBe(false);
        expect(seen.map((x) => [x.method, x.url, x.auth, x.body])).toEqual([
          ['POST', '/api/asks/7/answer', TOKEN, body],
          ['GET', '/api/runs', TOKEN, ''],
        ]);
      });

      // THE OTHER DIRECTION OF THE COLLISION (wave 13, R16): the CALLER's stdin must
      // never reach curl's `-K -` parser. If it could, any caller could add a `url`,
      // `output` or `proxy` line, and the box token header would follow it. `runs
      // list` reads no stdin, so a hostile stdin is still there when curl starts.
      it('a caller\'s stdin never reaches curl\'s config: hostile config lines on stdin send nothing anywhere else', async () => {
        const elsewhere: string[] = [];
        const other = createServer((req: IncomingMessage, res: ServerResponse) => {
          elsewhere.push(`${req.method} ${req.url} ${String(req.headers['x-ccrc-mail-token'] ?? '')}`);
          res.writeHead(200); res.end('{}');
        });
        await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
        try {
          plantRecorder();
          const pwn = path.join(home, 'pwn');
          const hostile = `url = "http://127.0.0.1:${(other.address() as AddressInfo).port}/stolen"\n`
            + `output = "${pwn}"\nheader = "x-evil: 1"\n`;
          const r = await run(['runs', 'list'], hostile);
          expect(r.status, r.stderr).toBe(0);
          expect(stdin(), 'curl was handed something besides the client\'s one config line').toBe(CONFIG);
          expect(elsewhere, 'a URL from the caller\'s stdin was fetched').toEqual([]);
          expect(fs.existsSync(pwn), 'an output path from the caller\'s stdin was written').toBe(false);
          expect(seen.map((x) => [x.method, x.url, x.auth])).toEqual([['GET', '/api/runs', TOKEN]]);
        } finally {
          await new Promise<void>((r) => { other.close(() => r()); });
        }
      });

      // An error path is scanned too: with the server gone, curl fails (rc 7) and
      // the client answers its `transport` envelope. The token is on no argv, and on
      // no output.
      it('the transport refusal: argv holds no token, and neither stream echoes it', async () => {
        plantRecorder();
        await new Promise<void>((r) => { server.close(() => r()); });
        const r = await run(['runs', 'list']);
        expect(r.status).toBe(3);
        expect(JSON.parse(r.stdout.trim())).toMatchObject({ ok: false, error: 'transport' });
        const words = argv();
        expect(words.filter((w) => w.includes(TOKEN) || /x-ccrc-mail-token/i.test(w)), 'the token is on curl\'s argv').toEqual([]);
        expect(stdin()).toBe(CONFIG);
        expect(r.stdout + r.stderr, 'the transport refusal echoed the token').not.toContain(TOKEN);
      });

      // `set +x` (R16): an inherited xtrace — `bash -x`, or an exported
      // SHELLOPTS=xtrace — would trace `read_token` and the printf line to stderr,
      // which the calling session reads into its transcript.
      it('an inherited xtrace prints no token: SHELLOPTS=xtrace leaves stderr clean', async () => {
        const r = await run(['runs', 'list'], undefined, { SHELLOPTS: 'xtrace' });
        expect(r.status, r.stderr).toBe(0);
        expect(r.stderr, 'an inherited xtrace printed the token').not.toContain(TOKEN);
        expect(seen.map((x) => x.auth)).toEqual([TOKEN]);
      });
    });
    ```
  - In `update-catalogue.test.ts`, line 7: `` `ccrc-api.test.ts:52-65` `` → `` `ccrc-api.test.ts:53-66` ``. The new import line moves the `createServer` … `const port` block down by one line. Confirm it with `sed -n 53,66p test/ccrc-api.test.ts`.
  - In `ccrc-api-closed.test.ts`, before `it('validates every caller-supplied fragment before it can reach a URL', …`:
    ```ts
      it('hands the token to curl on stdin, as one `-K -` config line, and on no argv (R16)', () => {
        // A `-H` value is readable in every process listing on the box for the
        // life of the call. The behaviour is pinned in ccrc-api.test.ts (a curl
        // that records its argv and stdin); this pins the one sink in the source,
        // so a second header site, or the old `-H "x-ccrc-mail-token: $TOKEN"`,
        // reds here by its line.
        const code = clientCode();
        const mentions = code.split('\n').filter((l) => /x-ccrc-mail-token/i.test(l)).map((l) => l.trim());
        expect(mentions).toEqual([`code=$(printf 'header = "x-ccrc-mail-token: %s"\\n' "$TOKEN" \\`]);
        expect(code).toContain(`\n    | curl "\${args[@]}" "$url" 2>/dev/null)\n`);
        expect(code).toMatch(/^\s*local -a args=\(-sS -K - /m);
      });
    ```
- [ ] **Step 3: Run, expect red:** `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts -t "R16|NO response happened"`.
  - **Expected:** 6 red. Those are the three argv cases (`the token is on curl's argv`), the transport scan (the same message), the hostile-stdin case (`curl was handed something besides the client's one config line`: the old client's curl inherits the caller's stdin), and the xtrace case (`an inherited xtrace printed the token`).
  - The drive-through is GREEN at this point: Task 1's front admits the old client's `-H`, `-m`, `-X` and `--data-binary`, and the header arrives on argv.
  - Then run `test/ccrc-api-closed.test.ts`. **Expected:** the new case red. *(measured: T2-1 below)*
- [ ] **Step 4: Implement.** In `ccd/ccrc-api`:
  - Line 57, in place, so no cited line moves:
    ```bash
    set +x; set -uo pipefail   # `set +x` FIRST, a SECRETS control as in ccd-pool-sync: an inherited xtrace would print the box token (R16)
    ```
  - Replace:
    ```bash
      local -a args=(-sS -m 30 -o "$out" -w '%{http_code}'
                     -X "$method" -H "x-ccrc-mail-token: $TOKEN")
      [[ -n "$body" ]] && args+=(-H 'content-type: application/json' --data-binary "$body")

      code=$(curl "${args[@]}" "$url" 2>/dev/null)
      local rc=$?
    ```
    with:
    ```bash
      local -a args=(-sS -K - -m 30 -o "$out" -w '%{http_code}' -X "$method")
      [[ -n "$body" ]] && args+=(-H 'content-type: application/json' --data-binary "$body")

      # THE TOKEN RIDES CURL'S STDIN, NEVER ITS ARGV (R16): a `-H` value is readable
      # in every process listing on the box (`ps`, /proc/<pid>/cmdline) for the life
      # of the call. `-K -` reads the header from a config line on stdin, the
      # spelling ccd-pool-sync and ccd-update-sync ship. stdin is free here because
      # `--json -` was read into $body above, before this line.
      code=$(printf 'header = "x-ccrc-mail-token: %s"\n' "$TOKEN" \
        | curl "${args[@]}" "$url" 2>/dev/null)
      local rc=$?
      TOKEN=""
    ```
  - Run `bash -n ccd/ccrc-api`.
  - The line starts with `code=$(printf`, not `printf`, so `ccrc-api-closed`'s "never hands the token to anything that prints" guard is unchanged and green (measured).
  - Under `set -uo pipefail` the substitution's status is the rightmost non-zero status. Real curl drains the config at argument parse, so that is curl's status (Risk notes).
- [ ] **Step 5: Run:**
  - `cd server && ./node_modules/.bin/vitest run test/ccrc-api.test.ts`. **Expected:** `Tests 103 passed (103)` (96 + 7).
  - `./node_modules/.bin/vitest run test/ccrc-api-closed.test.ts`. **Expected:** `Tests 10 passed (10)` (9 + 1).
  - `./node_modules/.bin/vitest run test/update-catalogue.test.ts`. **Expected:** `Tests 114 passed (114)`.
  - Then run these unedited: `ccrc-api-ship` (4), `coord-pause-route` (20), `coordinator-skill` (160), `macos-platform` (96 passed, 11 skipped), `coord-envelope` (20) and `box-token-census` (23). *(measured: all green at those counts)*
- [ ] **Step 6: Mutation table** *(measured)*. Mutate `ccd/ccrc-api`, with `cp` + `cmp` and `bash -n` around each row. Commands: `ccrc-api` whole (103), then `ccrc-api-closed` whole (10).

  | # | Guard | Mutation | Goes red (full expected set) |
  |---|---|---|---|
  | T2-1 | the change itself (revert) | the whole file replaced by `git show 9221416a:ccd/ccrc-api` | ccrc-api 6 of 103: the three argv cases and the transport scan (`the token is on curl's argv`); the hostile-stdin case (`curl was handed something besides…`); the xtrace case (`an inherited xtrace printed the token`). closed 1 of 10: the new pin. The drive-through stays green (the old shape passes the front, with the header on argv) |
  | T2-2 | one header sink | `-w '%{http_code}' -X "$method")` → `… -X "$method" -H "x-ccrc-mail-token: $TOKEN")` | ccrc-api 9 of 103: the three argv cases and the transport scan (`the token is on curl's argv`); the drive-through, the hostile-stdin case and the xtrace case (the header arrives twice, as `z…z, z…z`); "sends the value line, not the document around it"; "uses the fixture box token against an armed real feed route". closed 1 of 10 |
  | T2-3 | curl reads the config | `-sS -K - -m 30` → `-sS -m 30` | ccrc-api 8 of 103: the three argv cases (`no \`-K -\` in argv`); the drive-through, the hostile-stdin case and the xtrace case (`auth: undefined`); "sends the value line…" (`expected undefined to be 'zzz…'`); the armed route (`ok: false`). closed 1 of 10 (`to match /^\s*local -a args=\(-sS -K - /m`) |
  | T2-4 | the body still arrives | `      body=$(cat)` → `      body='@-'` (curl, not the client, reads the body from stdin, which is now the config pipe) | ccrc-api 11 of 103: the collision case and the drive-through; "reads stdin for --json -"; "carries only the declared ask answer id and JSON body" and "… ask release …"; and six "ledger allocate" cases (fills byId, empty object, leading whitespace, --by door, --by outranks, leaves byId). closed 0 of 10 |
  | T2-5 | the caller's stdin never reaches the config | `  code=$(printf '…' "$TOKEN" \` → `  code=$({ printf '…' "$TOKEN"; cat; } \` | ccrc-api 1 of 103: the hostile-stdin case (`curl was handed something besides the client's one config line`). closed 1 of 10 |
  | T2-6 | no inherited xtrace | `set +x; set -uo pipefail   #` → `set -uo pipefail   #` | ccrc-api 1 of 103: the xtrace case (`an inherited xtrace printed the token: expected '+ set -uo pipefail\n…'`). closed 0 of 10 |
- [ ] **Step 7: Commit:** `fix(api): ccrc-api hands the box token to curl on stdin (-K -), never argv, and traces nothing (wave 13, R16)`.

### Task 3: R16 — `notify.sh` hands the token to curl on stdin, never on argv

**Files:** `deploy/notify.sh`, `server/test/coord-token.test.ts`, `server/test/notify-addr.test.ts`.

**Interfaces:** consumes Task 1's `loopbackCurlFront`, and produces none.

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nF 'curl -fsS -m 5 -X POST "$BASE/api/notify" \' deploy/notify.sh                    # ~89
  grep -nF '  ${tok:+-H "x-ccrc-mail-token: $tok"} \' deploy/notify.sh                         # ~91
  grep -nF 'TOKEN_FILE="${CCRC_MAIL_TOKEN_FILE:-$HOME/.cc-secrets/ccrc-mail.token}"' deploy/notify.sh   # 29 — cited by ccd/ccrc as notify.sh:29; add nothing above it
  grep -nF "    expect(notifySh).toContain('\${tok:+-H \"x-ccrc-mail-token: \$tok\"}');" server/test/coord-token.test.ts
  grep -nF "const REAL_TOOLS = ['jq', 'grep', 'tail', 'cut', 'tr'];" server/test/notify-addr.test.ts
  grep -nF "function runNotify(home: string, extraEnv: NodeJS.ProcessEnv = {}): SpawnSyncReturns<string> {" server/test/notify-addr.test.ts
  grep -nF "  return spawnSync(BASH, [notifyShPath, 'test message'], { env, encoding: 'utf8' });" server/test/notify-addr.test.ts
  grep -nF "    const scan = ['ccd/ccrc', 'ccd/ccd', 'ccd/ccrc-doctor-checks', 'deploy/notify.sh'];" server/test/auth-passkey.test.ts
  cd server && ./node_modules/.bin/vitest list test/notify-addr.test.ts | wc -l     # 15
  ./node_modules/.bin/vitest list test/coord-token.test.ts | wc -l                  # 19
  ```
- [ ] **Step 2: Write the cases first (red).**
  - In `coord-token.test.ts`, in "still sends the header conditionally on a non-empty token", replace `expect(notifySh).toContain('${tok:+-H "x-ccrc-mail-token: $tok"}');` with:
    ```ts
        //
        // R16 (centralised-update wave 13): the header now rides curl's STDIN as a
        // `-K -` config line, never argv, so the pin is on the guarded config line
        // and the `-K -` beside the curl it feeds. `notify-addr.test.ts` RUNS the
        // script and pins the same thing by what curl was handed.
        expect(notifySh).toContain(`{ [ -n "$tok" ] && printf 'header = "x-ccrc-mail-token: %s"\\n' "$tok"; } |\n`
          + 'curl -fsS -m 5 -X POST "$BASE/api/notify" -K - \\\n');
        expect(notifySh, 'the token is back on curl\'s argv').not.toMatch(/-H\s+"x-ccrc-mail-token/);
    ```
    The describe's slice from `TOKEN_FILE=` to `ADDR="${CCRC_ADDR:-}"`, and the four pipeline pins below it, stay byte-identical.
  - In `notify-addr.test.ts`:
    - `import { spawnSync, type SpawnSyncReturns } from 'node:child_process';` becomes three lines:
      ```ts
      import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
      import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
      import type { AddressInfo } from 'node:net';
      ```
    - add `import { loopbackCurlFront } from './containedTools.js';` after the `tmpHelpers` import;
    - `runNotify` takes an optional stdin, edited in place, so its line count stays the same:
      ```ts
      function runNotify(home: string, extraEnv: NodeJS.ProcessEnv = {}, input?: string): SpawnSyncReturns<string> {
      ```
      ```ts
        return spawnSync(BASH, [notifyShPath, 'test message'], { env, encoding: 'utf8', input });
      ```
    - append this describe at the end of the file:
    ```ts
    // R16 (centralised-update wave 13): the box token rides curl's STDIN as a `-K -`
    // config line, never its argv, where every process listing on the box can read
    // it for the life of the call. The token is a fixture value, in a token DOCUMENT
    // (a `#` preamble above one value line) at `CCRC_MAIL_TOKEN_FILE`; reading it
    // takes `head`, which the address cases above never reach.
    describe('deploy/notify.sh hands the box token to curl on stdin, never on argv (R16)', () => {
      const TOKEN = 'z'.repeat(64);
      const CONFIG = `header = "x-ccrc-mail-token: ${TOKEN}"\n`;
      const tokenFile = (home: string): string => {
        const f = path.join(home, 'mail.token');
        writeFileSync(f, `# fixture token document\n\n${TOKEN}\n`, { mode: 0o600 });
        return f;
      };
      /** A curl that records one argv word per line, and its stdin, and dials nothing. */
      const recordingCurl = (home: string): void => {
        writeFileSync(path.join(stubBinDir(home), 'curl'),
          '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$HOME/curl.argv"\ncat > "$HOME/curl.stdin"\nexit 0\n', { mode: 0o755 });
        for (const t of ['head', 'cat']) symlinkSync(realPath(t), path.join(stubBinDir(home), t));
      };
      const words = (home: string): string[] => readFileSync(path.join(home, 'curl.argv'), 'utf8').split('\n');
      const fed = (home: string): string => readFileSync(path.join(home, 'curl.stdin'), 'utf8');

      it('with a token: argv holds neither the token nor its header, and stdin carries the one config line', () => {
        const home = mkTmp('ccrc-notify-tok-');
        recordingCurl(home);
        const r = runNotify(home, { CCRC_ADDR: 'http://127.0.0.1:9', CCRC_MAIL_TOKEN_FILE: tokenFile(home) });
        expect(r.status, r.stderr).toBe(0);
        const w = words(home);
        expect(w).toContain('http://127.0.0.1:9/api/notify');
        expect(w.filter((x) => x.includes(TOKEN)), 'the token is on curl\'s argv').toEqual([]);
        expect(w.filter((x) => /x-ccrc-mail-token/i.test(x)), 'the token header is on curl\'s argv').toEqual([]);
        expect(w.some((x, i) => x === '-K' && w[i + 1] === '-'), `no \`-K -\` in argv: ${w.join(' ')}`).toBe(true);
        expect(fed(home)).toBe(CONFIG);
      });

      it('with no token: it still sends (the tolerance), and the config curl reads is empty', () => {
        const home = mkTmp('ccrc-notify-notok-');
        recordingCurl(home);
        const r = runNotify(home, { CCRC_ADDR: 'http://127.0.0.1:9', CCRC_MAIL_TOKEN_FILE: path.join(home, 'absent.token') });
        expect(r.status, r.stderr).toBe(0);
        expect(words(home)).toContain('http://127.0.0.1:9/api/notify');
        expect(fed(home), 'an absent token must send no header line').toBe('');
      });

      // THE OTHER DIRECTION (wave 13, R16): the hook's own stdin, whatever ccd or a
      // caller hands it, must never reach curl's `-K -` parser — a `url` or `output`
      // line there would carry the token header somewhere else.
      it.each([
        ['with a token', true],
        ['with no token', false],
      ])('%s: the hook\'s own stdin never reaches curl\'s config', (_w, withToken) => {
        const home = mkTmp('ccrc-notify-stdin-');
        recordingCurl(home);
        const hostile = 'url = "http://127.0.0.1:7788/stolen"\noutput = "/tmp/pwn"\nheader = "x-evil: 1"\n';
        const r = runNotify(home, {
          CCRC_ADDR: 'http://127.0.0.1:9',
          CCRC_MAIL_TOKEN_FILE: withToken ? tokenFile(home) : path.join(home, 'absent.token'),
        }, hostile);
        expect(r.status, r.stderr).toBe(0);
        expect(fed(home), 'curl was handed the hook\'s stdin as config').toBe(withToken ? CONFIG : '');
      });

      // Through the REAL curl, behind the test front that admits `-K -` with
      // `header = "…"` lines only, to a listener in this process: the header still
      // ARRIVES. ASYNC, because a sync spawn would block the listener.
      it.each([
        ['with a token', true],
        ['with no token', false],
      ])('%s, through the loopback curl front to a listener: the body arrives, and the header iff there is a token', async (_w, withToken) => {
        const home = mkTmp('ccrc-notify-front-');
        const got: { auth: string | undefined; body: string }[] = [];
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
          let body = '';
          req.on('data', (c) => { body += c; });
          req.on('end', () => {
            got.push({ auth: req.headers['x-ccrc-mail-token'] as string | undefined, body });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"ok":true}');
          });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        try {
          const port = (server.address() as AddressInfo).port;
          const bin = stubBinDir(home);
          writeFileSync(path.join(bin, 'curl'), loopbackCurlFront(realPath('curl')), { mode: 0o755 });
          writeFileSync(path.join(home, 'curl-allow-ports'), `${port}\n`);
          for (const t of [...REAL_TOOLS, 'head', 'cat']) symlinkSync(realPath(t), path.join(bin, t));
          const env: NodeJS.ProcessEnv = { ...process.env };
          delete env.CCRC_ADDR;
          Object.assign(env, {
            HOME: home, PATH: bin, CCRC_ADDR: `http://127.0.0.1:${port}`,
            CCRC_MAIL_TOKEN_FILE: withToken ? tokenFile(home) : path.join(home, 'absent.token'),
          });
          const code = await new Promise<number>((resolve) => {
            const child = spawn(BASH, [notifyShPath, 'test message'], { env, stdio: ['ignore', 'ignore', 'ignore'] });
            child.on('close', (c) => resolve(c ?? -1));
          });
          expect(code).toBe(0);
          expect(existsSync(path.join(home, 'curl-poison')), 'the front refused notify.sh\'s call').toBe(false);
          expect(got).toEqual([{ auth: withToken ? TOKEN : undefined, body: '{"message":"test message"}' }]);
        } finally {
          await new Promise<void>((r) => { server.close(() => r()); });
        }
      });
    });
    ```
- [ ] **Step 3: Run, expect red:**
  - `cd server && ./node_modules/.bin/vitest run test/notify-addr.test.ts -t "R16"`. **Expected:** 3 red. "with a token: argv holds neither…" reds with `the token is on curl's argv`. Both hostile-stdin rows red with `curl was handed the hook's stdin as config`, because the old curl inherits the hook's stdin.
  - The no-token case and both drive-throughs are green at this point: the old script sends no header without a token, and the front admits its `-H`.
  - `./node_modules/.bin/vitest run test/coord-token.test.ts -t "notify"`. **Expected:** "still sends the header conditionally…" red. *(measured: T3-1 below)*
- [ ] **Step 4: Implement.** In `deploy/notify.sh`, replace the last four lines:
  ```bash
  curl -fsS -m 5 -X POST "$BASE/api/notify" \
    -H 'content-type: application/json' \
    ${tok:+-H "x-ccrc-mail-token: $tok"} \
    -d "$(jq -cn --arg m "$1" '{message:$m}')" >/dev/null 2>&1 || true
  ```
  with:
  ```bash
  # THE TOKEN RIDES CURL'S STDIN, NEVER ITS ARGV (R16): a `-H` value is readable
  # in every process listing on the box for the life of the call. `-K -` reads the
  # header from a config line on stdin, the spelling ccd-pool-sync and
  # ccd-update-sync ship. The header is still sent only for a non-empty token: an
  # absent one leaves the config empty, so the POST goes out without it (the
  # tolerance above). curl's stdin is always this pipe, never the stdin ccd hands
  # the hook.
  { [ -n "$tok" ] && printf 'header = "x-ccrc-mail-token: %s"\n' "$tok"; } |
  curl -fsS -m 5 -X POST "$BASE/api/notify" -K - \
    -H 'content-type: application/json' \
    -d "$(jq -cn --arg m "$1" '{message:$m}')" >/dev/null 2>&1 || true
  ```
  - Run `bash -n deploy/notify.sh`.
  - Nothing above line 88 changes, so `notify.sh:29` and coord-token's slice are untouched.
  - `curl` and `"$BASE/api/notify"` stay on one line (T3-4).
  - The script gains no external command: `printf` is a builtin, and `head` was already used for the token.
- [ ] **Step 5: Run:**
  - `cd server && ./node_modules/.bin/vitest run test/notify-addr.test.ts`. **Expected:** `Tests 21 passed (21)` (15 + 6).
  - `./node_modules/.bin/vitest run test/coord-token.test.ts`. **Expected:** `Tests 19 passed (19)`.
  - Run these unedited: `auth-passkey` (154), `install-coordinator-skill` (16), `coordinator-skill` (160), `notify-token` (6) and `macos-platform`.
  - Now record the `notify-addr -t "R16"` and `ccrc-api -t "R16"` arms of the T1 rows. *(measured: all green; T1 arms as listed)*
- [ ] **Step 6: Mutation table** *(measured)*. Mutate `deploy/notify.sh`, with `cp` + `cmp` and `bash -n` around each row. Commands: `notify-addr` whole (21), `coord-token -t "notify"` (8), and `auth-passkey -t "OTHER CONSUMERS"` (1).

  | # | Guard | Mutation | Goes red (full expected set) |
  |---|---|---|---|
  | T3-1 | the change itself (revert) | the whole file replaced by `git show 9221416a:deploy/notify.sh` | notify-addr 3 of 21: "with a token: argv holds neither…" (`the token is on curl's argv`), and both hostile-stdin rows (`curl was handed the hook's stdin as config`). coord-token 1 of 8. auth-passkey 0. The drive-throughs stay green |
  | T3-2 | no header line without a token | `{ [ -n "$tok" ] && printf …; } \|` → `{ printf …; } \|` | notify-addr 2 of 21: "with no token: it still sends…" (`an absent token must send no header line: expected 'header = "x-ccrc-mail-token: "\n' to be ''`), and the no-token hostile-stdin row. coord-token 1 of 8. The no-token drive-through stays green, because curl drops an empty-valued header |
  | T3-3 | curl reads the config | `"$BASE/api/notify" -K - \` → `"$BASE/api/notify" \` | notify-addr 2 of 21: "with a token: argv…" (`no \`-K -\` in argv`), and the with-token drive-through (`auth: undefined`). coord-token 1 of 8 |
  | T3-4 | `/api/notify` stays on the curl line | `curl -fsS -m 5 -X POST "$BASE/api/notify" -K - \` → `curl -fsS -m 5 -X POST -K - \`, plus a new line `  "$BASE/api/notify" \` | auth-passkey 1 of 1 (`the curl scan matched nothing — it has stopped looking: expected 1 to be greater than or equal to 2`). coord-token 1 of 8. notify-addr 0 of 21 |
  | T3-5 | the hook's stdin never reaches the config | `… "$tok"; } \|` → `… "$tok"; cat; } \|` | notify-addr 2 of 21: both hostile-stdin rows (`curl was handed the hook's stdin as config`). coord-token 1 of 8 |
- [ ] **Step 7: Commit:** `fix(notify): notify.sh hands the box token to curl on stdin (-K -), never argv; no token still sends (wave 13, R16)`.

### Task 4: R20(a) — `ccrc-update.test.ts`'s fixtures are removed per test, not in one `afterAll`

**Files:** `server/test/tmpHelpers.ts`, `server/test/tmpfixtures.test.ts`, `server/test/ccrc-update.test.ts`. Never `installTreeFixture.ts` (claim 1046).

**Interfaces:**
- Produces, in `tmpHelpers.ts`:
  - `tmpMark(): number`;
  - `removeTmpFixturesSince(mark: number): void`;
  - `removeTmpFixturesEachTest(): void`, which registers a `beforeEach` and an `afterEach` on the suite it is called in.
- `mkTmp`, `removeTmpFixtures` and the one `afterAll(removeTmpFixtures);` are unchanged.

- [ ] **Step 1: Re-measure.**
  ```bash
  cd server
  grep -nF "import { afterAll } from 'vitest';" test/tmpHelpers.ts
  grep -nF 'afterAll(removeTmpFixtures);' test/tmpHelpers.ts                # exactly 1
  grep -nF "import { mkTmp } from './tmpHelpers.js';" test/ccrc-update.test.ts
  tail -1 test/ccrc-update.test.ts                                           # '});' — the call goes after it
  grep -nE '^\s*(beforeEach|afterEach|beforeAll|afterAll)\(' test/ccrc-update.test.ts   # 3 describe-level afterEach (~4655, ~12175, ~12635), 1 beforeAll (~11098, makes no fixture)
  grep -nE '^(  )?(const|let) [A-Za-z_]+ *= *(mkTmp|freshUpdateBox|versionedBox)\(' test/ccrc-update.test.ts   # only inside functions: no collection-time fixture
  grep -l tmpHelpers test/*.ts | wc -l                                         # 246 importers (CI selection widens)
  ./node_modules/.bin/vitest list test/ccrc-update.test.ts | wc -l             # 502
  ./node_modules/.bin/vitest list test/tmpfixtures.test.ts | wc -l             # 2
  ```
- [ ] **Step 2: Measure the hook before the change** *(prototype)*.
  - Put a temporary timer in `removeTmpFixtures`. Behind `CCRC_TMPFIX_LOG`, log `made.length`, a `find | wc -l`, a `du -scb`, and the ms of the `rmSync` loop. Run the three parts. Restore with `cp` + `cmp`.
  - Prototype, at load 17–24:

    | Part | Homes | Entries | Bytes | rmSync ms |
    |---|---|---|---|---|
    | `sweep` (20) | 19 | 1,542 | 9,477,449 | 61 |
    | `rvw` (169) | 208 | 43,047 | 1,337,836,801 | 1,572 |
    | `rest` (313) | 421 | 55,121 | 1,117,781,680 | 1,609 |
    | **total (502)** | **648** | **99,710** | **2,465,095,930** | **3,242** |

    The walk ran first and warmed the cache, so the ms figures are a floor. The CI overrun does not reproduce on this box (Risk notes).
- [ ] **Step 3: Write the cases first (red).** In `tmpfixtures.test.ts`, change the imports to:
  ```ts
  import { describe, it, expect, beforeAll, afterEach } from 'vitest';
  import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
  import path from 'node:path';
  import {
    mkTmp, removeTmpFixtures, removeTmpFixturesSince, removeTmpFixturesEachTest, tmpMark,
  } from './tmpHelpers.js';
  ```
  and append:
  ```ts
  // R20a (centralised-update wave 13): a file whose one end-of-file sweep is too big for one hook removes each
  // test's homes after that test instead. `ccrc-update.test.ts` is that file: its `afterAll` overran vitest's 20 s
  // hook timeout on CI shards at 670d25fd and 7b0a5454 while every test passed.
  describe('removeTmpFixturesSince (R20a)', () => {
    it('removes what was made from the mark on, forgets it, and leaves what came before for the afterAll', () => {
      const before = mkTmp('ccrc-tmpfix-since-');
      const mark = tmpMark();
      const b = mkTmp('ccrc-tmpfix-since-');
      const c = mkTmp('ccrc-tmpfix-since-');
      writeFileSync(path.join(b, 'fixture.txt'), 'not empty\n');
      removeTmpFixturesSince(mark);
      expect(existsSync(b) || existsSync(c), 'a directory made after the mark survived').toBe(false);
      expect(existsSync(before), 'a directory made BEFORE the mark was removed').toBe(true);
      expect(tmpMark()).toBe(mark);
      // Forgotten, as `removeTmpFixtures` forgets: a directory put back at that path survives both sweeps.
      mkdirSync(b);
      removeTmpFixturesSince(mark);
      removeTmpFixtures();
      expect(existsSync(b), 'the cleaner re-removed a path it had already cleaned').toBe(true);
      expect(existsSync(before)).toBe(false);
      rmSync(b, { recursive: true, force: true });
    });

    // Root removes what it likes, so a refusal cannot be planted; CI and the dev box run unprivileged.
    it.skipIf(process.getuid?.() === 0)('keeps a directory whose removal fails, for the afterAll to remove or fail on loudly', () => {
      const mark = tmpMark();
      const d = mkTmp('ccrc-tmpfix-since-keep-');
      const locked = path.join(d, 'locked');
      mkdirSync(path.join(locked, 'inner'), { recursive: true });
      chmodSync(locked, 0o500);   // `inner` cannot be unlinked: rmSync throws EACCES
      try {
        expect(() => removeTmpFixturesSince(mark)).not.toThrow();
        expect(existsSync(d)).toBe(true);
        expect(tmpMark(), 'the failed directory was forgotten unremoved').toBe(mark + 1);
      } finally {
        chmodSync(locked, 0o700);
      }
      removeTmpFixtures();
      expect(existsSync(d), 'the kept directory was not removed by the end-of-file sweep').toBe(false);
    });
  });

  describe('removeTmpFixturesEachTest (R20a)', () => {
    let fromBeforeAll = '';
    let fromFirst = '';
    beforeAll(() => { fromBeforeAll = mkTmp('ccrc-tmpfix-each-all-'); });
    // Registered on THIS describe here; `ccrc-update.test.ts` calls it at its top level, on the root suite.
    removeTmpFixturesEachTest();

    describe('an inner describe with its own teardown', () => {
      afterEach(() => {
        // The holder/lingerer kills in ccrc-update.test.ts are describe-level afterEach hooks that still need the
        // home: an outer afterEach must run after them.
        expect(existsSync(fromFirst), 'the test\'s home was removed before an inner afterEach ran').toBe(true);
      });
      it('makes a home inside the test', () => {
        fromFirst = mkTmp('ccrc-tmpfix-each-');
        writeFileSync(path.join(fromFirst, 'fixture.txt'), 'not empty\n');
        expect(existsSync(fromBeforeAll)).toBe(true);
      });
    });

    it('the previous test\'s home is gone, and the beforeAll\'s is not', () => {
      expect(fromFirst).not.toBe('');
      expect(existsSync(fromFirst), 'a home made inside a test outlived it').toBe(false);
      expect(existsSync(fromBeforeAll), 'a home made in a beforeAll was removed after one test').toBe(true);
    });

    it('ccrc-update.test.ts opts in, at its top level, outside any comment', () => {
      const src = readFileSync(path.join(__dirname, 'ccrc-update.test.ts'), 'utf8').split('\n');
      expect(src.filter((l) => l === 'removeTmpFixturesEachTest();'),
        'ccrc-update.test.ts must call removeTmpFixturesEachTest() once, unindented').toHaveLength(1);
    });
  });
  ```
- [ ] **Step 4: Run, expect red:** `cd server && ./node_modules/.bin/vitest run test/tmpfixtures.test.ts`. **Expected:** the file fails to import `tmpMark`, `removeTmpFixturesSince` and `removeTmpFixturesEachTest`.
- [ ] **Step 5: Implement.**
  - In `tmpHelpers.ts`, `import { afterAll } from 'vitest';` becomes `import { afterAll, afterEach, beforeEach } from 'vitest';`. Insert this between `removeTmpFixtures` and `afterAll(removeTmpFixtures);`. Nothing above `removeTmpFixtures` moves, so `ccrc-account.test.ts`'s `tmpHelpers.ts:38-52` citation holds:
    ```ts
    /** How many directories this file's `mkTmp` has made and not yet removed: the mark `removeTmpFixturesSince`
     *  takes (centralised-update wave 13, R20a). */
    export function tmpMark(): number {
      return made.length;
    }

    /** Remove every directory `mkTmp` made at or after `mark` (a `tmpMark()`), and forget it. A
     *  removal that throws keeps its directory for the `afterAll` below, which removes it or fails loudly, so a
     *  directory is never forgotten unremoved (centralised-update wave 13, R20a). */
    export function removeTmpFixturesSince(mark: number): void {
      const kept: string[] = [];
      for (const dir of made.splice(mark)) {
        try { rmSync(dir, { recursive: true, force: true }); } catch { kept.push(dir); }
      }
      made.push(...kept);
    }

    /** OPT-IN, for a file whose one end-of-file sweep is too big for one hook: called at a file's top level, it
     *  registers a root `beforeEach` that marks `made.length` and a root `afterEach` that removes what the test
     *  made from that mark on. R20a measured `ccrc-update.test.ts`: about 650 directories and 2.5 GB in its one
     *  `afterAll`, which overran vitest's 20 s hook timeout on two CI shards while every test passed. A directory
     *  made BEFORE the mark (at collection time, or in a `beforeAll`) is left for the `afterAll`. A root
     *  `afterEach` runs after every describe-level one (vitest runs a test's after-hooks innermost first), so a
     *  describe's own teardown still sees its home. */
    export function removeTmpFixturesEachTest(): void {
      let mark = -1;
      beforeEach(() => { mark = tmpMark(); });
      afterEach(() => {
        if (mark >= 0) removeTmpFixturesSince(mark);
        mark = -1;
      });
    }
    ```
  - In `ccrc-update.test.ts`, `import { mkTmp } from './tmpHelpers.js';` becomes `import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';` (the same line). Append at the END of the file, after its last `});`, so no line above moves:
    ```ts

    // R20a (centralised-update wave 13): each test's fixture homes go in a root `afterEach`, not all at once in the
    // file's `afterAll`. Measured at 9221416a: the three parts of this file leave 648 homes, about 99,700 entries and
    // 2.47 GB to that one hook, which overran vitest's 20 s hook timeout on CI shards at 670d25fd and 7b0a5454. It sits
    // at the END of the file so no line above moves: a top-level hook registers on the root suite wherever it is
    // written, because vitest collects the whole file before it runs a test.
    removeTmpFixturesEachTest();
    ```
    *(measured: a scratch two-case file with this call on its last line removed test 1's home before test 2. With the call commented out, test 2 red with `end-of-file registration did not remove the home`. The probe file was deleted afterwards. The worker need not repeat it, because the Step 7 timer measures the same thing in the real file.)*
- [ ] **Step 6: Run:**
  - `cd server && ./node_modules/.bin/vitest run test/tmpfixtures.test.ts`. **Expected:** `Tests 7 passed (7)`, and `ls -A "$TMPDIR" | grep -c ccrc-tmpfix` prints 0.
  - Run `ccrc-update` in its three parts (Task 6 Step 3). **Expected:** 20, 169 and 313 passed, 502 in all. *(measured at revision: `supervisor sweep` 20 passed, `vitest list` 502)*
- [ ] **Step 7: Measure after** *(prototype, with the call at the top of the file; the position changes no registration)*. Use the same temporary timer, extended to `removeTmpFixturesSince` (per-test count, dirs, sum, max and kept). Run the three parts, then restore with `cp` + `cmp`.

  | Part | `afterAll` homes | Per-test calls | Dirs | Sum ms | Max ms | Kept |
  |---|---|---|---|---|---|---|
  | `sweep` | 0 | 20 | 19 | 61 | 14 | 0 |
  | `rvw` | 0 | 169 | 208 | 2,123 | 76 | 0 |
  | `rest` | 0 | 313 | 421 | 2,110 | 116 | 0 |

  The `sweep` and `rvw` rows were timed with `Date.now()`, and the `rest` row with `performance.now()` on a re-run (load 23–28). A first `rest` run logged the same sum and max as `rvw`, so it was re-run, and the numbers given here are the re-run's. The worker records its own.
- [ ] **Step 8: Mutation table** *(measured; each against `tmpfixtures` whole, 7 cases)*. Mutate `tmpHelpers.ts` unless the row names another file, with `cp` + `cmp` around each row.

  | # | Guard | Mutation | Goes red (full expected set) |
  |---|---|---|---|
  | T4-1 | only what came after the mark | `made.splice(mark)` → `made.splice(0)` | 2 of 7: "removes what was made from the mark on…" (`a directory made BEFORE the mark was removed`), and "the previous test's home is gone, and the beforeAll's is not" (`a home made in a beforeAll was removed after one test`) |
  | T4-2 | a failed removal is kept | `  made.push(...kept);` → `  void kept;` | 1 of 7: "keeps a directory whose removal fails…" (`the failed directory was forgotten unremoved: expected +0 to be 1`). Leaks one dir: remove it by hand, `chmod -R u+rwx` first |
  | T4-3 | the mark is taken per test | `beforeEach(() => { mark = tmpMark(); });` → `beforeEach(() => { mark = -1; });` | 1 of 7: "the previous test's home is gone…" (`a home made inside a test outlived it`) |
  | T4-4 | one failure does not throw out of the hook | `try { rmSync(…); } catch { kept.push(dir); }` → `rmSync(dir, { recursive: true, force: true });` | 1 of 7: "keeps a directory…" (`expected [Function] to not throw … EACCES`). Leaks one dir: remove it by hand, `chmod -R u+rwx` first |
  | T4-5 | ccrc-update opts in (`ccrc-update.test.ts`) | the last line `removeTmpFixturesEachTest();` → `// removeTmpFixturesEachTest();` | 1 of 7: "ccrc-update.test.ts opts in…" (`expected [] to have a length of 1`) |
  | T4-6 | an inner afterEach runs first (`tmpfixtures.test.ts`, test-side) | add `removeTmpFixturesEachTest();` inside the inner describe, after its `afterEach` | 1 of 7: "makes a home inside the test" (`the test's home was removed before an inner afterEach ran`). This shows the order assertion can red. The order itself is vitest's |
- [ ] **Step 9: Commit:** `test(update): ccrc-update's fixture homes are removed per test, so its afterAll stays inside vitest's 20 s hook timeout (wave 13, R20a)`.

### Task 5: R20(b) — wave 12's As-built bullet for the two citation corrections

**Files:** `docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md`.

- [ ] **Step 1: Re-measure.**
  ```bash
  grep -nF '## As built (the wave-12 worker'"'"'s record, 2026-10-06)' docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md     # ~1173
  grep -nF -- '- **Reserve numbers:** 4072 spent (Reading 8). 4073 to 4076 are unspent.' docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md   # the last line
  grep -nF "(run 270's wave-done, residue item 7)" docs/superpowers/plans/2026-10-05-centralised-update-w11-sweep-window.md     # 1 hit, the shipped A9 text
  grep -nF "(the worker's A2)" docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md                      # Task 4's A9 text
  grep -nF '`exit 130` would not read as an INT death to our caller' docs/superpowers/plans/2026-10-05-centralised-update-w11-sweep-window.md   # the shipped T6-RERAISE row
  grep -nF 'RE-RAISES on this shell (`exit 130` would not read as an INT death to our' ccd/ccrc                               # the comment it quotes
  grep -nF 'D-3988: "`exit 130` would not read as an INT death"' docs/superpowers/plans/2026-10-06-centralised-update-w12-wave11-residue.md   # Task 4's A19 text
  ```
- [ ] **Step 2: Edit.** Insert before the "Reserve numbers" bullet:
  ```markdown
  - **Two citations in the amended wave-11 plan differ from Task 4's replacement text, on purpose, and the shipped ones are the true sources** (review 286 F2; this bullet added 2026-10-06 by wave 13, R20b):
    - A9's sentence ends "(run 270's wave-done, residue item 7)", where Task 4's text says "(the worker's A2)".
    - A19's T6-RERAISE row quotes `_upd_sweep`'s INT-handler comment in `ccd/ccrc` ("`exit 130` would not read as an INT death to our caller"), where Task 4's text gives the words to D-3988, whose entry does not carry them.
  ```
- [ ] **Step 3: Run:** `topology-clean`, then `dtbd` and `deviation-refs` after `git fetch origin main`.
- [ ] **Step 4: Commit:** `docs(update): wave 12's As-built names the worker's two citation corrections (wave 13, R20b)`.

### Task 6: The gate and the PR

- [ ] **Step 1: Start from a merged, clean tree.**
  ```bash
  git status --porcelain
  git fetch origin main
  git merge-base --is-ancestor origin/main HEAD && echo "origin/main is in HEAD" || echo "MAIN MOVED"
  ~/.local/bin/ccrc-api claims list --project ccrc-pwa      # no live claim names a File-structure path
  ```
  - `main` had moved at revision (`77c11245a`, #286), so expect `MAIN MOVED`. Run `git merge --no-edit origin/main`, keep both sides of every hunk, and record `git show --remerge-diff HEAD`.
  - Stop and report if `main` changed any of these: `ccd/ccrc-api`, `deploy/notify.sh`, `containedTools.ts`, `tmpHelpers.ts`, `ccrc-update.test.ts`'s first 70 lines or its last test, `update-catalogue.test.ts:7`, README's `ln -sfn ~/ccrc/ccd/ccrc-api` line, or either sender's `-K -` sibling (`ccd-pool-sync`, `ccd-update-sync`). At `77c11245a` none of them had changed.
- [ ] **Step 2: Dependencies.** Run `npm ci` in `server/`, `agent/` and `pwa/`, wherever `node_modules` is absent.
- [ ] **Step 3: Server, one file per call,** in the foreground, with a timeout of at least 600000 ms. The counts are measured.
  - Edited: `ccrc-containment` (**85**), `ccrc-api` (**103**), `ccrc-api-closed` (**10**), `update-catalogue` (**114**), `coord-token` (**19**), `notify-addr` (**21**), `tmpfixtures` (**7**).
  - `ccrc-update` in three parts:
    - `-t "supervisor sweep"` (**20**);
    - `-t "ccrc (rollback|versions|watchdog)|killed-flip state|is a statement about the version"` (**169**);
    - `-t "^(?!.*(supervisor sweep|ccrc (rollback|versions|watchdog)|killed-flip state|is a statement about the version))"` (**313**).

    `vitest list test/ccrc-update.test.ts | wc -l` must print **502** = 20 + 169 + 313. After each part, `ls -A "$TMPDIR" | grep -v '^node-compile-cache$'` must print nothing.
  - Run, not edited:
    - `auth-passkey` (**154**), `install-coordinator-skill` (**16**), `coordinator-skill` (**160**), `coord-pause-route` (**20**);
    - `macos-platform` (**96** passed, 11 skipped), `ccrc-api-ship` (**4**), `coord-envelope` (**20**), `notify-token` (**6**);
    - `box-token-census` (**23**), `ccd-pool-sync` (**40**), `ccd-update-sync` (**45**);
    - `ccrc-cli` (**36**), `ccd-tmux-anchor` (**34**), `ccrc-install-graphify` (**58**, about 175 s; it runs behind the front), `ccrc-sweep-deliberate-stop` (**8**);
    - `single-definition` (**274**), `typecheck-tests` (**12**), `topology-clean` (**55**), `dtbd`.
  - `ccrc-install.test.ts` is under claim 1046 and plants a poisoned curl, never the front. CI's selection runs it.

  If a known load flake (CLAUDE.md's list, which includes `typecheck-tests`) reds, re-run it IN ISOLATION before calling it a break.
- [ ] **Step 4: The ledger and scope guards, last.**
  ```bash
  git fetch origin main
  cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
  ./node_modules/.bin/vitest run test/dtbd.test.ts
  ./node_modules/.bin/vitest run test/topology-clean.test.ts
  cd ..
  # the scope check (Global Constraints) — prints nothing
  git diff --stat origin/main...HEAD     # exactly File structure's New and Changed lists
  ```
  Then run the D-number check. Every D-token the branch adds must either already be on `origin/main`, or be one of 4094–4100 and defined in this plan. It prints nothing:
  ```bash
  PLAN=docs/superpowers/plans/2026-10-06-centralised-update-w13-token-off-argv.md
  git diff origin/main...HEAD | grep '^+' | grep -oE 'D-[0-9]{4}\b' | sort -u > "$SCRATCH/dnums"
  while read -r d; do
    git grep -qwF -e "$d" origin/main -- docs/superpowers && continue          # cited as it stands
    case "${d#D-}" in
      409[4-9]|4100) grep -qE "^- \*\*$d\*\* — " "$PLAN" || echo "UNDEFINED $d" ;;
      *) echo "OUTSIDE THE BLOCK OR THE RESERVE: $d" ;;
    esac
  done < "$SCRATCH/dnums"
  ```
- [ ] **Step 5: The PR,** from the workspace branch.
  - **Its first paragraph says:**
    - that `ccd/ccrc-api` and `deploy/notify.sh` stop putting the box token on curl's argv, and `ccrc-api` stops printing it under an inherited xtrace;
    - that notify.sh reaches every home through the spine on the next release;
    - that **ccrc-api reaches only the boxes where `~/.local/bin/ccrc-api` is README's link**, on that same release, while a box holding `deploy.sh`'s copy keeps the old client until it is re-placed (D-4094, and the coordinator's ruling on Reading 1);
    - that the operator's token rotation therefore waits until every fleet box's client resolves into the release tree (Reading 2).
  - **The body has:**
    - one section per task, carrying D-4094 and D-4095 by number;
    - the R20(a) before/after table.
  - **Links:** the plan and the files are GitHub `blob/main` URLs built from the repository's own remote (`git remote get-url origin`). Until the merge, put the PR's `/files` view beside each one. Never a docserver URL.
  - The body is hand-written, and ends with the attribution line the session's instructions give.
  - Every commit's author and committer are the noreply identity: `git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD`.
  - **After CI starts,** read the PR's `select tests` summary. Because `tmpHelpers.ts` changed, it should select every importer. It must list:
    - `ccrc-api.test.ts`, `ccrc-api-closed.test.ts`, `ccrc-containment.test.ts`, `update-catalogue.test.ts`;
    - `coord-token.test.ts`, `notify-addr.test.ts`, `auth-passkey.test.ts`;
    - `tmpfixtures.test.ts`, `ccrc-update.test.ts`.

    If one is missing, run `gh workflow run ci.yml --ref <branch> -f mode=full` and name that run in the wave-done. On the shard that runs `ccrc-update.test.ts`, no `Hook timed out` line may appear.
- [ ] **Step 6: The wave-done, in the same turn as the push.** It carries:
  - the tip sha, the PR number, and the remerge-diff result;
  - each suite's result, the `-t` parts with their counts against `vitest list`, and the load;
  - every mutation row (T1-0 … T4-6) with its measured red set against the listed set, and the assertion that fired;
  - the R20(a) before/after numbers, with your own `rest` sum and max beside the prototype's;
  - D-4094 restated in one line as the open item it is: copied boxes run the old `ccrc-api` until re-placed. Add, for the box you run on only, whether `~/.local/bin/ccrc-api` is a link or a regular file (`ls -l`, type only, never contents);
  - any reserve number spent, defined in this plan in the commit that cites it.

## Readings (for the coordinator to rule; each was chosen where no ruling decided it)

1. **How `ccrc-api` reaches the copied boxes (D-4094).** The spine does not place it, the spine fix lives in claim 1046's files, and README's link already follows every release. The options:
   - (a) a wave after claim 1046 ends adds `_inst_atomic "$tree/ccd/ccrc-api" "$HOME/.local/bin/ccrc-api" 755` to `_inst_bins`, with its census pin and README's sentence turned around;
   - (b) **the operator replaces each fleet box's copied `~/.local/bin/ccrc-api` once with README's link**, `ln -sfn ~/ccrc/ccd/ccrc-api ~/.local/bin/ccrc-api`. That is permanent, and it touches no claimed file: from then on every release, this one included, carries the client;
   - (c) the operator copies the file by hand from each release's tree. This goes stale at the next release, and is not recommended.

   This plan recommends (b) now and (a) later, and changes neither file. Until (b) or (a) happens on a box, every `ccrc-api` call there still puts the token on argv. `deploy.sh agent` writes a copy again (`install_atomic`), so a box that is later re-deployed by hand needs (b) again until (a) lands. The drafting box is a copied box.
2. **Token rotation (07:07 question 3) should wait until every fleet box's `~/.local/bin/ccrc-api` resolves into the release tree, at a release at or after this merge** (Reading 1(b)), not only for the merge itself. Rotating while an old client runs puts the NEW token in the same process listings on its first call. notify.sh alone is fixed by the merge's release.
3. **No escaping or refusal for a token that holds `"` or `\`.** The ruling says the spelling and escaping follow the two shipped sites, which do neither. The shipped token is `openssl rand -hex 32`. A token with either character would be mangled by curl's config parser into a 401, never leaked. If the coordinator wants a guard, the smallest one is a refusal in `read_token` (`refuse 'bad-token' 'the token holds a quote or a backslash, which a curl config line cannot carry'`, never echoing the token), plus a case and a mutation row. It would take reserve number 4096.
4. **`set +x` went into `ccrc-api`, but not into `notify.sh`.**
   - In `ccrc-api` it is applied without a deviation number. The ruling says "never print the token". Two lenses measured `SHELLOPTS=xtrace` printing it 4 times on stderr, which the calling session reads. The siblings whose idiom the ruling copies carry `set +x` as their secrets control. Folding it onto line 57 moves no cited line.
   - In `notify.sh` it is left out. ccd runs the hook with `>/dev/null 2>&1` (notify.sh's own header), so its trace reaches no transcript in shipped use. Adding a line above line 29 would move `notify.sh:29`. A line between 29 and `tok=""` is possible if the coordinator wants it, but it would cost coord-token's byte-identical slice pin.
   - If the coordinator rules that `ccrc-api`'s `set +x` is a departure, it takes reserve number 4096.
5. **notify.sh always passes `-K -`, and only the header line is conditional.**
   - With no token, curl reads an empty config from the pipe, so its stdin is never the hook's inherited stdin. The hostile-stdin rows pin that (T3-5).
   - The alternative, `${tok:+-K -}`, relies on unquoted word splitting, the same trick as the old `${tok:+-H …}`. It would also leave curl on the inherited stdin.
   - The front admits the empty config for this reason (D-4095).
6. **D-4095's widening reaches every case behind the front, not only the two senders.** It is stated in D-4095 and in the docstring, and is safe for containment because none of the admitted options can move the connection. The alternative is a `{ senders: true }` parameter that only `ccrc-api.test.ts` and `notify-addr.test.ts` pass. It keeps ccrc's own cases on the narrower front, at the cost of a second front shape to pin. Is the shared widening acceptable, and is the deviation number to be kept?
7. **`ccrc-api`'s body stays on argv** (`--data-binary "$body"`). It carries no token, and moving it would be a second change to live code (`-d @-` cannot share stdin with `-K -`, so it would need a temp file). Should it go on the residue list?
8. **The source pin in `ccrc-api-closed.test.ts` is new, and the old print guard is unchanged.** The scout predicted the guard would red on a printf line. Measured, it does not, because the line starts with `code=$(`. The new pin is "exactly one `x-ccrc-mail-token` mention in the code, and it is the `-K -` config line". It is the mechanism for "no second header site", and it reds on T2-1, T2-2, T2-3 and T2-5.
9. **The R20(a) helper is opt-in and lives in `tmpHelpers.ts`.**
   - A per-file wrapper in `ccrc-update.test.ts` cannot see `made`, and would miss the homes other modules make through `mkTmp` (sweepFixture, helpers and others).
   - Making it the default for all 246 importers would change the lifetime of any home a file shares across tests, so this plan does not.
   - The cost is a near-full CI selection on this PR. Is that acceptable?

## Coordinator rulings on this plan's readings (2026-10-06)

The coordinator ruled every reading on 2026-10-06 at 09:30 UTC. The plan was drafted by workflow `wf_3aff815b-3ef`:
- a Sonnet scout;
- an Opus drafter that prototyped every change in its own worktree;
- three Opus attack lenses (security and config parsing; fleet-wide blast radius and compatibility; pins, containment and the CI hook), with 14 findings;
- an Opus reviser, who applied all 14.

These rulings win over any sentence above that disagrees with them. Do not reshape one. If one cannot be done as written, stop that item and mail the coordinator the input and the result.

- **Reading 1: (b) now, as the operator's act, and (a) later.**
  - This wave changes neither `_inst_bins` nor README (claim 1046).
  - The coordinator asks the operator to replace the fleet box's copied `~/.local/bin/ccrc-api` once with README's link.
  - (a), the spine line with its census pin and README's sentence, goes on the list for the first `ccd/ccrc` wave after claim 1046 ends (wave 16).
  - The wave-done states plainly that a copied client keeps leaking until it is re-placed.
- **Reading 2: as written.** Rotation waits until the fleet box's `~/.local/bin/ccrc-api` resolves into a release tree at or after this merge. The coordinator puts that to the operator.
- **Reading 3: as written.** No escaping and no refusal: the shipped token is hex, and a mangled config fails as a 401, never as a leak.
- **Reading 4: `ccrc-api`'s `set +x` is a departure, so it spends reserve number 4096.**
  - Define it under Task 2, in the commit that first cites it.
  - It is kept, because an inherited xtrace printed the token 4 times, measured.
  - `notify.sh` gets no `set +x`, as written.
- **Reading 5: as written.** `notify.sh` always passes `-K -`; only the header line is conditional.
- **Reading 6: accept the shared widening, and keep D-4095.** No admitted option can move the connection, and every refused variant keeps its row. Do not add a `{ senders: true }` parameter.
- **Reading 7: residue.** Moving `ccrc-api`'s JSON body off argv goes on the programme's residue list. It carries no token, and the move needs a temp file.
- **Reading 8: as written.**
- **Reading 9: accept.** The near-full CI selection is the price of fixing the hook in the one module that sees every home. The full run arbitrates.

