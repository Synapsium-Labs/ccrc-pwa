# Session continuity, wave 4 — wave 3's residue, then dead pane scopes reported and the inert ones stopped, shadowed (AGENT-FIRST) Implementation Plan

> **Status: PLANNED 2026-10-05 on `main` `d12b5aba0` — ready for dispatch** (programme session-continuity, CCR-18;
> wave 4 = run 274, planned). The prototype was built on `77f8d63a5` (#250, wave 3's merge); `main` then took #282 and
> #283, which touch `README.md`, `CLAUDE.md` and child-reclamation documents only, so the prototype merged them, every
> README anchor was re-cut, and every block below was replayed onto an export of `d12b5aba0`.
>
> 1. **Prototype-first.** Every block below marked `<!-- replay: … -->` is the prototype's bytes. A replay of this
>    document onto an export of `d12b5aba0` (each `replace` anchor asserted to match exactly once in its file at its
>    turn) followed by `ccrc restamp ccd/ccd` is byte-identical to the prototype on all 25 files it touches. Each task's
>    tests were measured red on the previous task's tree and green on its own, and every mutation row was measured on
>    the full prototype, each mutation applied to a saved copy of the file and restored from that copy (`cmp`-checked).
> 2. **Task 1 is wave 3's residue and this wave's FIRST commit** — review 272 (run 272 of run 248, at `f6faff4c`), F1–F11,
>    as the coordinator ruled them (programme ledger, 2026-10-05 17:03). Tasks 2–7 are spec §5.6's first part MINUS the
>    spawn variable — item 2 (the sweep, its record and its doctor reader), item 3 (the limit-banner harness) — plus §9's
>    reap-class count, with the coordinator's safety ruling: **the stop ships SHADOWED**. Task 8 is the whole branch, the
>    PR and the AGENT-FIRST deploy.
> 3. **Deviation numbers are the coordinator's.** The block issued for this wave's WORKER is 4012 to 4021, written bare;
>    this plan defines none. Departures are named below as slugs only.
> 4. **Not in this wave** (the coordinator's rulings B and E): `CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP=1` in the
>    spawn environment (wave 4b, after the baseline week this wave's deploy starts), ccd stopping a pane's scope when it
>    ends the pane (needs stage 3), and the `/clear` fix wave 3 deferred (wave 4b, beside the spawn variable).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close review 272's residue — a failed kill keeps the operator-choice marker only on tmux's own "no server
running", never on a deleted socket; a command older than its route field is neither written nor logged; cmd_swap's two
guarded lines, the argless drift arm and ws-restore after ws-archive are pinned by behaviour; comments, prose, the
instrument's key note and wave 3's mutation cells say what the code does — and then give the fleet box the collector
spec §1.3 found missing: `ccd-scope-sweep`, a one-minute oneshot beside `ccd-cap-scopes` that records every dead ccd
pane scope with the stop predicates it passes or fails, issues `systemctl --user stop --no-block` on an inert one ONLY
when the operator has armed it, and never touches a scope that is not a ccd pane's; `ccrc doctor` reading that record;
`deploy/measure-continuity.py --stage 6` counting the OOM stops of the pressure reap's own class, so the week after this
deploy is baseline B; and the limit-banner test harness killing its child's whole process group on timeout.

**Architecture:** Task 1 edits wave 3's section of `ccd/ccd` in place (`_operator_choice_keep`'s loop and reader,
`_operator_choice_unmark`, the section's header comments — all below the frozen citation corpus's last cited line, so
the census does not move), one line of `measure-continuity-stage7.test.ts`'s binding case, and prose in the instrument,
README, the spec and wave 3's own plan. The sweep is a NEW script, `ccd/ccd-scope-sweep` (bash, Linux-only by product
shape, fixture-portable), with its own `deploy/systemd/ccd-scope-sweep.{service,timer}`; it touches no line of
`ccd/ccd`. It ships through every path `ccd-tmp-sweep` ships through — `ccrc`'s install spine (`_inst_bins`,
`_inst_units`, `_inst_enable`, the uninstall lists, the orphan scan's own-binary case), `deploy.sh`'s agent lane,
`gen-wrappers.mjs`'s `TOOLCHAIN_EXECUTABLES`, the lifecycle registry — gated off `--role server` like the reaper. Doctor
gains ONE check, `scope-sweep`, appended at the END of `ccrc-doctor-checks` with its table entry sharing `scopes`'
line (lines above are cited by number), and `ccd-scope-sweep.timer` joins `_check_services`' `known`. The instrument
gains `stage6` and one `--journal` flag.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `ccd/ccd-scope-sweep`, `ccd/ccrc`, `ccd/ccrc-doctor-checks`; `set -uo pipefail`,
no `-e`), python 3 (`deploy/measure-continuity.py`, read-only), TypeScript + vitest 4.1 (tests), systemd user units.
Measured on bash 5.2.21, Python 3.12.3, systemd 255, tmux 3.4.

**Spec:** `docs/superpowers/specs/2026-09-23-session-continuity-design.md` — §1.3 (the measurement), §5.6 items 2 and 3
(this wave; item 1 is wave 4b), §5.7 (the residue), §6's invariants (the new, named, bounded stop authority; ccd is the
authority; mutation-table discipline), §8's two sweep failure modes, §9's stage-6 row and baseline B, §10 (stage 6's
first part needs nothing from stages 1–5), §11 item 4 (C11). Programme ledger: `docs/superpowers/programs/session-continuity.md`
(Carried constraints; Next-wave brief; the 2026-10-05 17:03 entry, on the coordinator's branch until its docs PR lands).
Review 272's report was `~/.cc-clips/ccrc-pwa-amber-harbor/review-272-f6faff4c.md` on the fleet box; that workspace is
reclaimed, so its findings are restated in Task 1 (recovered byte-exact, 18,027 bytes, from the reviewer's own
transcript while planning).

---

## Global Constraints

Copied from `CLAUDE.md`, the spec, the programme ledger and the coordinator's brief. Every task's requirements
implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST, through ccrc's own updater.** The fleet box takes the new `ccd`, the sweep,
  its units and doctor first; the server box takes the same tree (its installer skips the sweep's units on `--role
  server`). Nothing here touches `server/src`, `agent/src`, `shared/api.ts` or the PWA; `shared/lifecycle.ts` gains one
  declaration. Nobody runs `ccrc rollout` or `ccrc update` by hand (operator ruling 2026-09-30); Task 8 Step 7 measures
  the move, read-only.
- **SAFETY — sacred, and sharper this wave: THE SWEEP STOPS SYSTEMD SCOPES, WHICH KILLS PROCESSES.**
  - NEVER run `ccd-scope-sweep`, its timer, or any `systemctl --user stop` against the live user manager — not in
    shadow mode, not "just to see". Every test drives a FIXTURE root (`CCRC_PROC_ROOT`, `CCRC_CGROUP_ROOT`,
    `XDG_RUNTIME_DIR`, `HOME`) with `systemctl`, `tmux` and `getconf` STUBBED on `PATH`. Never install its units on
    the fleet box by hand; the updater installs them at the deploy, shadowed.
  - NEVER create `~/.cc-sessions/scope-sweep-live` (or `scope-sweep-paused`) on any real box. Arming is the operator's
    act, after the shadow week (Open question 1).
  - NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`,
    `ws-archive`/`ws-restore`, `ws-reclaim`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or
    `claude-session@*.service` directly. The only live reads this wave makes are read-only: the instrument over the
    user journal, the lifecycle journal and transcripts (Task 2 Step 6, Task 8 Step 7), and the planning census's
    `systemctl --user show` (Pre-flight 6). NEVER print secret file CONTENTS, and never a transcript's content (the F2
    census printed counts only).
- **In tests, FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** `ccd-*.test.ts` files go through
  `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`), whose `sh()` routes every bash spawn through
  `ghContainedEnv`. `scope-sweep.test.ts` and `measure-continuity-stage6.test.ts` spawn `bash`/`python3` directly with
  a fixture environment, as `tmp-sweep.test.ts` and the stage-4/7 instrument tests do.
- **No root `package.json`, no root runner.** `cd server && npm ci && npm run test`; `cd agent && npm ci && npm run
  test`; `cd pwa && npm ci && npm run test`. `typecheck-tests` needs `agent/node_modules` AND `pwa/node_modules`.
- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **The fleet box is under load (30–40 on 16 CPUs while planning; other workers run suites).** Run vitest in the
  FOREGROUND, timeout ≥ 600000 ms, ONE vitest process at a time, ONE test file per process for every ccd, hook,
  doctor and install suite, `--maxWorkers=1` there (`--maxWorkers=2` at most for shards). `TMPDIR` on
  the fleet box's data volume, OUTSIDE every git checkout; delete only fixtures you created. `CCD_DISK_FLOOR_GB=1` for
  test runs. A run killed by the memory reaper, or anything else, is restored from its snapshot and reported in a
  status mail; never end a turn waiting on a word typed at your own pane (programme ledger, run 237).
- **Three server files do not fit one 600 s call**, so they run as `-t` slices (landing-order wave 3's partition, each
  union checked there): `ccrc-doctor.test.ts` in FIVE, `ccrc-install.test.ts` in FOUR, `ccrc-update.test.ts` in TWO.
  Task 8 Step 2 spells the patterns.
- **Known load flakes** (re-run IN ISOLATION, `--maxWorkers=1`, before calling a real break): `ccd-ws-gc`, `pr-sweep`,
  `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`; and, measured on this prototype at load
  25–40: `ccrc-install`'s six caps/floor/version cases in its third slice ("ccrc-caps: line 1 is the os…", "floor:
  written by the LAST step…", "ccrc version says when the install was placed unsigned", …) — red once in a slice run,
  each green alone. **Known red not caused by this work:** `tmp-sweep`'s "FAILS CLOSED…" is red on `main` on the fleet
  box.
- **Rings / no overloaded null.** `ccd-scope-sweep`'s record keeps distinct words for distinct states, never folded:
  a scope it could not measure is NOT recorded anew (its previous line is carried unchanged), a dead scope is `report`
  (with every failing predicate named in `why=`), `would-stop` (inert, shadowed), `stopped` or `stop-failed` (armed);
  a recycled server pid is `server=reused`, a vanished one `server=gone`, ccd's live one `server=ccd`. Doctor's
  `scope-sweep` keeps "no record" (SKIP), "a record it cannot read" (WARN), "a stale record" (WARN) and "dead scopes"
  (WARN) apart. `_operator_choice_keep` stays rc 0 on every path.
- **Wire discipline.** No frame changes; `FLEET_PROTO` untouched; no server or agent code reads the sweep's record or
  its journal lines (measured at `d12b5aba0`: `grep -rn 'scope-sweep' server/src agent/src shared pwa/src` → only the
  `shared/lifecycle.ts` declaration Task 4 adds).
- **Mutation-table discipline:** every new guard ships WITH a test that goes RED when the guard is deleted or mutated,
  measured before/after on the full prototype; restore from a saved copy, never `git checkout -- <path>`. Where a row
  reds a case a LATER task adds, re-measure at your own commit and quote what you get.
- **`ccd/ccd` is provenance-STAMPED.** Task 1 is the only task that edits it; it re-stamps before running any suite, or
  `ownership.test.ts` reds: `~/.local/bin/ccrc restamp ccd/ccd` (on a box without it: `node --input-type=module -e
  "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs');
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"`). The stamp line is never replayed.
- **The citation tax (S6-R11).** `session-hook.test.ts` audits every `file:line` in the two frozen corpus documents and
  `README.md`. Measured at `d12b5aba0`: `147 / 197 / 55 / 35` (stated = base = tree), `corpus-frozen`. The corpus cites
  `ccd/ccd` below wave 3's section (every Task 1 edit sits below its last cited line), `ccd/ccrc` up to `:11635` (Task
  4's edits start at ≈14134), `deploy/deploy.sh` up to `:648` (Task 4's start at ≈739), and
  `server/test/single-definition.test.ts` up to `:1303` (Task 3 appends). README carries **zero** `ccd/ccd:N` anchors,
  so `repoint-readme.py` is never run. Measured on the prototype after Task 1 and after Task 7: `147 / 197 / 55 / 35`,
  every `ENTERED`/`LEFT` empty.
- **The `_reg_get` census does not move:** no task adds a `_reg_get` call (`grep -v '^[[:space:]]*#' ccd/ccd | grep -o
  '_reg_get "' | wc -l` → `182`, `grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'` → `153`, at `d12b5aba0`
  and on the tip; `ccd-reg-get-census.test.ts` green).
- **Locate code by CONTENT.** Line numbers are "at `d12b5aba0`" and are hints, never addresses. Every edit below is an
  "In `<file>`, find:" block whose anchor matches exactly once on `origin/main` at `d12b5aba0` at its turn.
- **Shell state does not survive between Bash calls.** Every block that names `$SCRATCH` sets it itself
  (`SCRATCH=<your scratchpad, absolute>`, a directory of YOUR OWN).
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch. One commit per
  task. **Commit trailers:** end every commit message with the attribution line your own session is given.
- **No hostnames, IPs, tailnet names, docserver URLs or account names** in a committed file (`topology-clean.test.ts`).
- **`## Deviations found` numbers are ISSUED, never chosen.** Write no `D-<number>` token for a departure; name it by
  its slug in the wave-done mail, and the coordinator defines it from 4012 to 4021.
- **OVERLAP — who lands second merges.** Landing-order wave 3 (#248) edits `ccd/ccd`'s pr-state lines,
  `ccd/session-hook.sh`, `ccd/ccrc-doctor-checks` and `server/test/ccrc-doctor.test.ts`; workspace-lifecycle wave 3
  (run 245) edits `ccd/ccd`'s RECLAIM/EXPIRE regions and the spawn paths; delegation-broker's run 271 edits
  `ccd/session-hook.sh`. This wave edits `ccd/ccd` (wave 3's section only), `ccd/ccrc-doctor-checks` (the table line
  holding `scopes`, `_check_services`' `known` line and one `why` case, and an appended function) and
  `ccrc-doctor.test.ts` (`doctorEnv`, `healthy()`, `HEALTHY_SKIPS`, an appended describe). Whichever lands SECOND runs
  `git merge origin/main` (NEVER a rebase), keeps both sides of any hunk in those files (a `known` list holds both
  sides' names; `HEALTHY_SKIPS` counts both sides' skips), re-stamps `ccd/ccd`, and re-runs the citation cases,
  `cite-remeasure.py` and the `_reg_get` census before its final gate (Task 8 Step 1).

---

## Review Focus

Inputs and failure modes the spec and the rulings imply that no task's happy path exercises, most likely to bite
first; each is a named case in its owning task and red when its guard is removed (the mutation tables measure it).

1. **The sweep stopping something it must never stop** (ruling D). ccd's own `ccrc-tmux-server.scope` listed with a
   pane-shaped Description; a Description that does not parse (a vanished unit's `show` answers `Description=<its own
   name>`, measured); a scope of a LIVE tmux server that is not ccd's (one ran on the fleet box while planning, since
   2026-09-14); a scope with a live pane of ccd's server; a server pid now naming another process, or a tmux server
   started after the scope (ccd's own pid recycled included). → Task 3, six cases (rows 3.4, 3.6–3.10, 3.24).
2. **A stop issued in shadow** (ruling C). No `scope-sweep-live` → never a stop call even when every predicate holds;
   `scope-sweep-live` → exactly one `--no-block` stop; `scope-sweep-paused` → nothing at all, record untouched. → Task 3
   (rows 3.1–3.3b), and the no-writer pin (row 3.25).
3. **A predicate measured wrong in the safe-looking direction.** A `listen` bit read off the wrong `/proc/net/unix`
   column, UDP left out, a child "elsewhere" by a cgroup-path comparison that can never differ, an fd directory it
   cannot read counted as "no sockets". → Task 3, rows 3.14–3.19.
4. **Integer seconds deciding pid reuse.** ccd's tmux server and its FIRST pane scope start in the same second (measured:
   server at 225,148,844 ticks, scope at 2,251,488,475,320 µs); seconds would read ccd's own server as recycled, and
   ticks vs `ActiveEnterTimestampMonotonic` microseconds is the comparison that holds. → Task 3, rows 3.8, 3.11.
5. **"Records nothing" read as "drops the entry".** An unmeasurable tick that dropped a scope's line would restart its
   six-hour clock and lose `cpu0`; the sweep carries the line unchanged, and a never-seen scope gets none. → Task 3,
   rows 3.20, 3.19.
6. **A deleted tmux socket read as "no server"** (F1). → Task 1, row 1.1, with "no server running" kept (row 1.2).
7. **A drift or out-of-vocabulary line about a command the record has since superseded** (F6). → Task 1, row 1.3.
8. **The reap-class count mis-mapping a scope to a session.** The spawn event comes 2–6 s AFTER its scope's start
   (measured on 4,638 scopes); a symmetric window maps the previous spawn; two sessions spawned together are
   `unmapped`, never guessed. → Task 2, rows 2.4, 2.6.
9. **Doctor re-deriving instead of reading.** Every unit in the doctor cases is absent from the fixture's own
   `systemctl list-units`, so a check that asked the box would list none of them; a test reading a REAL box's record.
   → Task 5, rows 5.4, 5.5, 5.7.
10. **A harness that kills bash and leaves `tail`.** → Task 6, rows 6.1, 6.2.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `ccd/ccd` | Modify (Task 1) — `_operator_choice_keep`'s reader and loop, `_operator_choice_unmark`, wave 3's header comments | The residue |
| `server/test/ccd-operator-choice.test.ts` | Modify (Task 1) — one describe appended | The residue's eight cases |
| `server/test/measure-continuity-stage7.test.ts` | Modify (Task 1) — one line | The binding case dates its field before its command |
| `deploy/measure-continuity.py` | Modify — Task 1 (stage 7's comment), Task 2 (`stage6`, `--journal`) | §9's rows, read-only |
| `server/test/measure-continuity-stage6.test.ts` | Create (Task 2) | The stage-6 row, and its lifecycle reader bound to ccd's |
| `ccd/ccd-scope-sweep` | Create (Task 3), mode 755 | The sweep: record every dead ccd pane scope, stop an inert one only when armed |
| `server/test/scope-sweep.test.ts` | Create (Task 3) | Every predicate, the shadow, and what must never be stopped |
| `server/test/single-definition.test.ts` | Modify (Task 3) — one describe appended | `scope-sweep-live` has no writer |
| `deploy/systemd/ccd-scope-sweep.{service,timer}` | Create (Task 4) | Its oneshot and its one-minute timer |
| `ccd/ccrc`, `deploy/deploy.sh`, `deploy/gen-wrappers.mjs`, `shared/lifecycle.ts` | Modify (Task 4) | Install, uninstall, the agent lane, the toolchain set, the lifecycle class |
| `server/test/{ccrc-install,ccrc-uninstall,lifecycle}.test.ts`, `server/test/installTreeFixture.ts`, `agent/test/deploy-verify.test.ts` | Modify (Task 4; `ccrc-install` again in Task 5) | Their pins, on the reaper's pattern |
| `ccd/ccrc-doctor-checks` | Modify (Task 5) — the table line, `known`, one `why`, one appended check | Doctor reads the record |
| `server/test/ccrc-doctor.test.ts` | Modify (Task 5) | The check's cases, its fixture seam, `HEALTHY_SKIPS` on macOS |
| `server/test/ccd-limit-banner.test.ts` | Modify (Task 6) | The timed harness kills its child's process group |
| `README.md` | Modify — Task 1 (two sentences), Task 7 (a table row, an uninstall name, one subsection) | The canonical description |
| `docs/superpowers/specs/2026-09-23-session-continuity-design.md` | Modify — Task 1 (§5.7's two sentences), Task 7 (rev 8: §5.6's shadow, §9's B) | The spec stays true to what ships |
| `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md` | Modify (Task 1) — six table cells, three departure entries' text | Wave 3's record reproduces at its tip |

**Not modified, deliberately:** `server/src/**`, `agent/src/**`, `shared/api.ts`, `pwa/**`; `ccd/session-hook.sh`;
`ccd/ccd-cap-scopes` (spec §7: unchanged); `ccd/ccd`'s spawn environment (wave 4b); every destructive verb.

---

## Pre-flight findings (measured while planning; not deviations)

Measured 2026-10-05 on `77f8d63a5`, `d12b5aba0` and the prototype; live reads are read-only.

1. **Review 272's eleven findings** (all minor; the coordinator's ruling on each is Task 1's own text):
   F1 `_operator_choice_unmark` keeps the marker on `PROBE_SUBSTRATE == absent`, which admits a deleted socket (R1) and
   makes it a second reader of `PROBE_SUBSTRATE`; F2 the dismissed `/effort` slider's drift noise is stated but not
   ledgered; F3 six of wave 3's mutation cells do not reproduce at its tip; F4 cmd_swap's two guarded lines are
   pinned only by the census's text; F5 comment drift (the keep "for cmd_ensure", "before a stop", "never read", the
   one-read list without ws-restore, the silent list without the interrupted stop — R3); F6 the out-of-vocabulary and
   drift lines are logged BEFORE the record-newer check; F7 the refused-command prose omits that a later write of
   the field also stops its line; F8 the `not given` arm of the drift reader's journal match is unpinned; F9 no case
   drives ws-restore after ws-archive; F10 two commit messages' red-first counts cite no commit's state; F11 the
   `restarts_that_reverted_an_operator_model` key's note sits by the other key.
2. **F2's census, counts only** (the 6,794 fleet transcripts under 150 MB modified in the last 40 days; the script
   printed classes and counts, never content): after an operator `/effort` — `Set effort level to …` 6,034 rows (16
   argless), `Ultracode on …` 22, `Invalid argument …` 18 (in 18 transcripts); after `/model` — `Set model to …` 454
   (110 argless); `Kept effort level as …` and `Kept model as …` **0**; an envelope with no acknowledgement row **0**.
   So the slider's dismissal writes nothing the reader sees; the only unrecognised wording is a refusal. Ruling A: not
   found → state the noise in the departure entry (Task 1).
3. **F10, re-measured:** 6db10976's test file against `b00849ee`'s ccd → `4 failed | 46 passed (50)`; 2aed328c's against
   6db10976's ccd → `5 failed | 50 passed (55)`.
4. **F3, wave 3's cells at its merged tip `77f8d63a` (64 cases):** 3.4 → 7, 3.28 → 6, 3.29 → 4 (anchored on
   `_spawn_start`'s line: the bare guard matches four lines), 3.30 → 4, 3.35 → 2, 3.37 → 3.
5. **The pane scopes, as systemd reports them** (read-only): a pane scope's `Description` is `tmux child pane <pid>
   launched by process <pid>`, its `Slice` `app-claude\x2dsession.slice`, `ControlGroup` the full path, `CPUUsageNSec`
   and `ActiveEnterTimestampMonotonic` (µs since boot) set; ccd's `ccrc-tmux-server.scope` is in the same slice. A unit
   that vanished between `list-units` and `show` answers `Description=<its own name>` and an empty `ControlGroup` —
   unparseable, so unmeasurable. `/proc/<pid>/stat`'s `comm` for a tmux server is `tmux: server` (a space: the fields
   are read after the LAST `) `), and its start (field 22, ticks of `CLK_TCK` 100) compares with the scope's
   monotonic microseconds: ccd's server 225,148,844 ticks, its first pane's scope 2,251,488,475,320 µs — the same
   second, 35 ms apart.
6. **The live census of the sweep's predicates** (read-only; not the sweep — a separate script that asked
   `systemctl --user list-units/show` and read `/proc`, writing nothing; 2026-10-05 19:18 UTC): 45 pane scopes listed;
   41 live ccd pane scopes; 1 scope of another live tmux server (a test server's, `tmux -S /tmp/tmuxtest_verify`,
   since 2026-09-14 — never touched by design); 3 dead ccd scopes holding 4 processes and 2 MiB, of which 1 has a
   process started under six hours and 2 hold a socket — so **0** would pass predicates 3–5 today.
7. **The user journal records what stage 6 needs:** a pane scope's start (`JOB_TYPE=start`, `JOB_RESULT=done`,
   `USER_UNIT=tmux-spawn-…`) and its OOM stop (`UNIT_RESULT=oom-kill`, "Failed with result 'oom-kill'."); ccd's
   lifecycle journal records each `spawn` (`act=spawn`, `outcome=done`, `id`, `at` ms). Over the 4,638 scopes started
   after the lifecycle journal's first event, the nearest spawn event came 2–6 s AFTER the scope's start for most
   (+2 s: 592, +4 s: 640, +6 s: 156), and 2,322 scopes had none within two minutes (test and probe panes).
8. **Stage 6's readings before the deploy** (`TZ=UTC`, the exported journal): the whole retention → 63 pane-scope OOM
   stops, 1 reap-class, 26 busy, 10 idle without a live shell, 12 unmapped (7 no spawn, 5 two sessions spawned
   together), 14 unmeasured (no transcript any more); `--since 2026-09-16 --until 2026-09-24` → **16** stops, which
   reproduces spec §1.3's "16 session deaths … 2026-09-16..23", 0 reap-class; `--since 2026-09-28 --until '2026-10-05
   17:00'` → 19 stops, 1 reap-class, 12 busy, 3 idle without a shell, 2 unmapped, 1 unmeasured.
9. **Where the reaper ships, the sweep ships:** `ccd-tmp-sweep` (#168) touched 16 files; the sweep follows it file for
   file (`_inst_bins`' non-Darwin arm, `_inst_units`' `!= server` gate, `_inst_enable_timer`'s degrade, both uninstall
   lists, the orphan scan's case, `TOOLCHAIN_EXECUTABLES`, `deploy.sh`'s agent lane, the lifecycle registry, and each
   test that pins them). `install-census.test.ts` requires `_inst_bins`' id-shaped placements, `TOOLCHAIN_EXECUTABLES`
   and the orphan case list to be EQUAL, and every `$tree/<path>` the installer reads to be TRACKED (so `git add` the
   new files before running it).
10. **`macos-platform.test.ts` scans every shebang'd file in `ccd/`** for GNU-only spellings: the sweep spells no
    `stat -c`, `date -d`, bare `timeout` or template-less `mktemp`, and takes no `flock`.
11. **Doctor's live shape is a golden** (`BASE_LIVE_SHAPE`, `ccrc-install.test.ts`): a new check moves it. Its three
    maps each gain `"scope-sweep": "SKIP"` (the install fixture's runtime dir holds no record) and nothing else moves.
12. **`main` moved while planning** (#282, #283: README, CLAUDE.md, child-reclamation documents); README's anchors were
    re-cut on `d12b5aba0` and the whole document replayed there. `CLAUDE.md`'s README size claim now reads ~5700, and
    the prototype's README is 5,762 lines (inside `pools-prose.test.ts`'s ±100).
13. **The full suite on the prototype:** the server in 24 shards (the three large files excluded) `2 failed | 21321 passed | 45 skipped (21368)` — `boot`'s "a hung ccd … does not delay listen" (a known load flake: 3 of 3 alone) and `session-hook`'s "skips a scratch slug — /tmp work accumulates no durable memory", which reds whenever `TMPDIR` is not a `/tmp` shape (the volume TMPDIR this box's rules require; 1 of 1 with `TMPDIR=/tmp`) — then `ccrc-doctor` in its five slices 74 / 183 / 141 / 109 / 168, `ccrc-install` in its four 57 / 70 / 62 / 105, `ccrc-update` in its two 298 / 196, all green; agent `453 passed (453)`; pwa `3237 passed (3237)`. `tmp-sweep`'s known red passed in this run. Load 18–65 throughout.

---

## How the replay markers read

A block is applied in document order. `replace <file>`: the fenced text after the marker must occur exactly once in
the file as it stands at that turn; the next fenced block replaces it. `create`: one fenced block, a new file. `append`:
one fenced block, appended at the end of the file. A fenced block's text is every line between its fences, each ending
in a newline; a block whose text holds a line of three backticks is fenced with four. `ccd/ccd`'s line-2 stamp is never
replayed: re-stamp after every `ccd/ccd` edit. Measured: this document, replayed onto an export of `d12b5aba0` and
re-stamped, is byte-identical to the prototype on all 25 files it touches.

## The citation tax, mechanised (S6-R11)

The two instruments are the exemplar's, VERBATIM — `docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md`,
"The citation tax, mechanised". Extract them by CONTENT with this script, `$SCRATCH/extract-tools.py`:

```python
import re, sys
text = open(sys.argv[1], encoding='utf8').read()
blocks = re.findall(r"```python\n(#!/usr/bin/env python3\n.*?)```", text, re.S)
want = {'repoint-readme.py': '"""Re-point README.md', 'cite-remeasure.py': '"""Re-measure session-hook.test.ts'}
for name, head in want.items():
    hits = [b for b in blocks if b.split('\n')[1].startswith(head)]
    assert len(hits) == 1, (name, len(hits))
    open(f'{sys.argv[2]}/{name}', 'w', encoding='utf8').write(hits[0])
    print(name, len(hits[0].splitlines()), 'lines')
```

```bash
SCRATCH=<your scratchpad, absolute>
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] || echo "STOP: SCRATCH is not an absolute directory"
python3 "$SCRATCH/extract-tools.py" docs/superpowers/plans/2026-09-22-child-reclamation-wave1-marker-and-containment.md "$SCRATCH"
grep -c 'ccd/ccd:[0-9]' README.md
```

Expected: `repoint-readme.py 30 lines`, `cite-remeasure.py 113 lines`, then `0`. **The procedure, after Task 1 and after
Task 7:**

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" origin/main
git fetch origin main && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected (measured on `d12b5aba0` and on the prototype): `byFile['ccd/ccd'] stated 147 base 147 tree 147`, `total
197/197/197`, `other byFile keys moved: none`, row array `55/55/55`, site array `35/35/35`, every `ENTERED`/`LEFT`
empty, the tree clean afterwards, and `corpus-frozen`. If any `base` differs from its `stated`, the tree was red before
your edit: stop and report it. If `tree` moves, an edit above a cited line was not line-neutral — find it; never
`--write` the census for this wave.

---
### Task 1: Wave 3's residue (review 272) — the FIRST commit

**Model routing:** `opus`, effort `high` — it changes when a stop's marker survives a failed kill and the order of the
keep's checks.

**Files:**
- Modify: `ccd/ccd` — `_operator_choice_keep`'s reader (≈19485) and loop (≈19503), `_operator_choice_unmark` (≈19530),
  wave 3's header comments (≈19338, ≈19350, ≈19361, ≈19365) and two doc comments (≈19423, ≈19427), at `d12b5aba0`
- Modify: `deploy/measure-continuity.py` (stage 7's comment only), `README.md` (≈2315, ≈2321), the spec (§5.7, two
  sentences), `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md` (six table cells, three
  departure entries' text)
- Test: `server/test/ccd-operator-choice.test.ts` (one describe appended), `server/test/measure-continuity-stage7.test.ts`
  (one line)

**Interfaces:**
- Consumes: wave 3's `_operator_choice_keep`, `_operator_choice_unmark`, `_session_probe` (its `PROBE_DETAIL`, as
  ws-reclaim reads it), `cmd_swap`/`cmd_stop`/`cmd_ws_archive`/`cmd_ws_restore`, `_spawn_start`; all unchanged in shape.
- Produces: `_operator_choice_unmark` keeps `$REG/<id>.choicekept` on `PROBE_VERDICT == gone` or tmux's own
  `no server running` (never `PROBE_SUBSTRATE == absent`); the reader prints one `drift-<kind> x <epoch> 0` row per kind
  whose newest command is unacknowledged (was `drift x 0 0`); the loop asks "is the field newer than the command?"
  FIRST for every row, the drift rows included, and says the drift line at most once per keep.

**The coordinator's rulings, each this task's text** (programme ledger, 2026-10-05 17:03):

- **F1** — narrow the absent arm to tmux's "no server running", as ws-reclaim matches it, so a deleted socket no longer
  reads as gone; pinned by a missing-socket case and a row. (With `PROBE_SUBSTRATE` no longer read here, the two
  comments that say "exactly one caller reads it" are true again and the bare `set -u` read is gone: F1(a)(b).)
- **F2** — counts-only census (Pre-flight 2): no `Kept effort level as …` row exists, so nothing is recognised; the
  noise is stated in the drift departure's entry in wave 3's plan, and README and the spec stop claiming a dismissed
  slider logs drift.
- **F3** — wave 3's cells restated as measured at its tip (Pre-flight 4); **F4** — cmd_swap's two guarded lines pinned
  by behaviour (a failing kill on a live session; a pre-marked session); **F5** — the comment drift, R3 among it;
  **F6** — the record-newer check asked first (wave 3's header already listed "a field newer than the keystroke" as
  silent; the loop now makes it true for the logged lines too); **F7** — the refused-command prose; **F8** — the
  `not given` arm pinned (ccd's own argless keystroke whose acknowledgement drifted); **F9** — ws-restore after
  ws-archive driven end to end; **F10** — the two red-first claims restated in their departure entries
  (Pre-flight 3); **F11** — one sentence beside the revert key.

- [ ] **Step 0: Merge current `main`, prove the citation cases green, and check the claims**

Every `ccd/ccd` edit rewrites line 2, so once another wave's `ccd/ccd` edit has landed a merge ALWAYS conflicts on that
line. This block resolves exactly that hunk and stops on anything else:

```bash
if ! git fetch origin main; then
  echo 'STOP: the fetch failed — nothing merged; report it'
elif ! git -c merge.conflictStyle=merge merge --no-edit origin/main; then
  if [ "$(git diff --name-only --diff-filter=U)" = ccd/ccd ] && [ "$(grep -c '^<<<<<<< ' ccd/ccd)" = 1 ] \
     && sed -n 2p ccd/ccd | grep -q '^<<<<<<< ' && sed -n 4p ccd/ccd | grep -q '^=======$' \
     && sed -n 6p ccd/ccd | grep -q '^>>>>>>> ' \
     && sed -n 3p ccd/ccd | grep -q '^# ccrc:generated 1 sha256=' && sed -n 5p ccd/ccd | grep -q '^# ccrc:generated 1 sha256='; then
    sed -i '2,6d' ccd/ccd && ~/.local/bin/ccrc restamp ccd/ccd
    git add ccd/ccd && git commit --no-edit && echo 'merged: the stamp hunk resolved by re-stamping'
  else
    echo 'STOP: a conflict other than the ccd/ccd stamp line — report it'; git merge --abort
  fi
fi
git log -1 --format='%h %s'
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: `Already up to date.` (or `merged: the stamp hunk resolved by re-stamping`) and `7 passed | 328 skipped
(335)`. On `STOP`, stop and report. Then ask the coordinator (or read `GET /api/claims` if your box token reaches it)
whether `README.md`, the spec or wave 3's plan file is claimed by another programme; if one is, write this task's code
and test hunks now and hold that file's hunks for the coordinator's word, reported in a status mail.

- [ ] **Step 1: Write the failing tests**

Eight cases, one describe appended (F1, F4 ×2, F6 ×2 and its control, F8, F9), and the stage-7 binding case re-dates
its class field before its second keep — that case's second command was older than the field its first keep had just
written, which the record-newer check now (rightly) keeps silent:

In `server/test/ccd-operator-choice.test.ts`, append at the end of the file:

<!-- replay: append server/test/ccd-operator-choice.test.ts -->
```ts

// ── WAVE 3'S RESIDUE (review 272, carried to wave 4's first commit) ───────────
// F1: a failed kill keeps the marker only on `gone` or on tmux's own words "no
// server running" — never on a missing socket, which a server can outlive. F4:
// cmd_swap's two guarded lines are pinned by behaviour, not only by the census's
// text. F6: the record-newer check comes FIRST, so a command older than its field
// is not logged either. F8: ccd's own ARGLESS keystroke (the picker) whose
// acknowledgement drifted is explained by its journal row. F9: ws-restore after
// ws-archive is one restart — its spawn does not read again, and ends the marker.
describe('wave 3\'s residue: the marker, the order of the checks, and the swap and restore pins', () => {
  const OOV = (id = ID): number => swapLog().split('\n').filter((l) => l.includes(`operator-choice ${id}: /model gpt-5.6-sol is outside the class vocabulary`)).length;
  const marked = (id = ID): boolean => fs.existsSync(regFile(`${id}.choicekept`));

  it('a stop whose kill failed with tmux\'s socket DELETED unmarks: a missing socket is not proof that no server runs', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    // the REAL probe over a tmux whose socket file is gone: verdict `unknown`, substrate `absent`, and no "no server running"
    const NO_SOCKET = '_ws_unsupervise() { :; }; tmux() { echo "error connecting to /tmp/tmux-1000/default (No such file or directory)" >&2; return 1; };';
    h.sh(`${NO_SOCKET} cmd_stop ${ID}`);
    expect(OOV(), 'the stop read').toBe(1);
    expect(marked(), 'a server may still run with its socket deleted: its next revival must read').toBe(false);
  });

  it('a swap whose kill failed on a session that is still there leaves no marker', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    h.sh(`systemctl() { :; }; launchctl() { :; }; sleep() { :; };
      tmux() { [[ "\${1:-}" == kill-session ]] && return 1; return 0; };
      _session_probe() { PROBE_VERDICT=live; PROBE_DETAIL=""; PROBE_SUBSTRATE=present; };
      cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(OOV(), 'the swap\'s keep read').toBe(1);
    expect(marked(), 'a live session is never left marked by a swap').toBe(false);
  });

  it('a swap of a session already stopped and read (marked) does not read again', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    h.sh(`_reg_set ${ID} choicekept "$(date +%s)"`);
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(OOV(), 'the marker gates the swap\'s keep').toBe(0);
  });

  it('an out-of-vocabulary /model older than its field is not logged: the later write is the operator\'s choice', () => {
    seed(); record({ class: 'opus' }, ID, 60); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))]);
    expect(keep()).toContain('rc=0');
    expect(OOV(), 'nothing was reverted: the field was written after the command').toBe(0);
    expect(h.reg(ID, 'class')).toBe('opus');
  });

  it('an unrecognised acknowledgement older than its field is not logged as drift', () => {
    seed(); record({ class: 'opus' }, ID, 60); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, 'Model switched to Opus 5.5')]);
    keep();
    expect(driftLines()).toEqual([]);
  });

  it('control: the same unrecognised acknowledgement newer than its field is logged once', () => {
    seed(); record({ class: 'opus' }, ID, 3600); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'opus'), ack(t, 'Model switched to Opus 5.5')]);
    keep();
    expect(driftLines()).toHaveLength(1);
  });

  it('ccd\'s own ARGLESS keystroke (the picker) whose acknowledgement drifted is explained by its journal row: no line', () => {
    seed(); record({ class: 'fable' }); const t = now() - 600;
    fs.writeFileSync(regFile(`${ID}.typed`), `${now() - 2 * DAY} since\n${t} model opus\n`);
    writeTranscript([cmd(t, 'model', ''), ack(t, 'Model switched to Opus 5.5')]);
    keep();
    expect(driftLines()).toEqual([]);
  });

  it('ccd ws-restore after ws-archive is one restart: the restore\'s spawn does not read again, and ends the marker', () => {
    h.makeRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const WS = 'demo-quiet-basin';
    journal(WS); record({ class: 'fable' }, WS); const t = now() - 600;
    writeTranscript([cmd(t, 'model', 'gpt-5.6-sol'), ack(t, MODEL_ACK('gpt-5.6-sol'))], WS);
    const STUBS = `_ws_unsupervise() { :; }; _ws_supervise() { :; }; _spawn_settle() { :; }; _session_verdict() { echo gone; };
      _session_probe() { PROBE_VERDICT=gone; PROBE_DETAIL=""; PROBE_SUBSTRATE=present; };
      tmux() { ${WIDE_PANE} case "\${1:-}" in new-session) echo "spawn $*" >> "$HOME/ccd-calls"; return 0 ;; kill-session|has-session) return 1 ;; esac; return 0; };`;
    expect(h.sh(`${STUBS} cmd_ws_archive --session ${WS}`)).toMatch(/^archived /);
    expect(OOV(WS), 'the archive read').toBe(1);
    expect(marked(WS), 'the archived session is dead and read').toBe(true);
    expect(h.sh(`${STUBS} cmd_ws_restore --session ${WS}`)).toMatch(/^restored /);
    expect(h.calls().join('\n'), 'the restore spawned through _spawn_start').toContain('spawn new-session');
    expect(OOV(WS), 'the restore\'s spawn did not read again').toBe(1);
    expect(marked(WS), 'the restore\'s spawn ended the marker').toBe(false);
  });
});
```

In `server/test/measure-continuity-stage7.test.ts`, find:

<!-- replay: replace server/test/measure-continuity-stage7.test.ts -->
```ts
    h.sh(`_operator_choice_keep ${ID}`);
    transcript('model', 'gpt-5.6-sol', 'Set model to `gpt-5.6-sol` for this session only');
```

and replace it with:

```ts
    h.sh(`_operator_choice_keep ${ID}`);
    field('class', 'opus');   // dated before the next command again: the record-newer check is asked first (review 272 F6)
    transcript('model', 'gpt-5.6-sol', 'Set model to `gpt-5.6-sol` for this session only');
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/measure-continuity-stage7.test.ts --maxWorkers=1
```

Expected (measured on `d12b5aba0`'s `ccd/ccd`): `3 failed | 69 passed (72)` — "a stop whose kill failed with tmux's
socket DELETED unmarks…", "an out-of-vocabulary /model older than its field is not logged…" and "an unrecognised
acknowledgement older than its field is not logged as drift". The other five new cases pin guards `main` already has
(cmd_swap's unmark and guard, the `not given` arm, the restore's marker) and pass there; each is measured red by its
mutation row (1.5–1.8). Stage 7: `2 passed (2)` on `d12b5aba0`'s code too (the re-dated field changes nothing there; it is what lets the case stay green once Step 3 asks the record first — measured red without it on the prototype).

- [ ] **Step 3: The `ccd/ccd` edits, then re-stamp**

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
# acknowledgement after it changed nothing and is never read, nor is a row a
```

and replace it with:

```bash
# acknowledgement after it changed nothing and is never promoted — though, when it
# is the newest of its kind, it is said as `unmeasured` (below) — nor is a row a
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
# command, a non-Anthropic lane (skipped), a value already held, a field newer than the keystroke. Logged as
```

and replace it with:

```bash
# command, a non-Anthropic lane (skipped), a value already held, a field newer than the keystroke (asked
# FIRST, so an out-of-vocabulary or unacknowledged command older than its field is not logged either). Logged as
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
# /model whose journal a `route --apply` keystroke opened first, and a route field
# whose mtime cannot be read.
```

and replace it with:

```bash
# /model whose journal a `route --apply` keystroke opened first, a route field
# whose mtime cannot be read, and an INTERRUPTED stop (one that died between its
# keep, which leaves the marker, and its kill: the pane survives marked, so its
# next stop or revival does not read again).
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
# a refusal's restart) does not read — and log — a second time.
```

and replace it with:

```bash
# `ws-restore` after `ws-archive`, a refusal's restart) does not read — and log —
# a second time.
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
_operator_choice_keep() {   # id — before a stop that a spawn follows: the operator's own /model and /effort, written to the route record (§5.7). Always 0.
  local id="$1" f typed why="" out kind val at n field want fm shown
  local -a sets=() kinds=()
  [[ -f "$REG/$id.uuid" ]] || return 0
  _reg_set "$id" choicekept "$(date +%s)" 2>/dev/null || true   # a keep ran since the last spawn: the supervised spawn that follows a stop's keep does not read again (cmd_ensure, §5.7)
```

and replace it with:

```bash
_operator_choice_keep() {   # id — before a stop that a spawn follows, and at every spawn (`_spawn_start`, unless a stop's keep already read): the operator's own /model and /effort, written to the route record (§5.7). Always 0.
  local id="$1" f typed why="" out kind val at n field want fm shown drift=0
  local -a sets=() kinds=()
  [[ -f "$REG/$id.uuid" ]] || return 0
  _reg_set "$id" choicekept "$(date +%s)" 2>/dev/null || true   # a keep ran since the last spawn: the supervised spawn that follows a stop's keep does not read again (`_spawn_start`, §5.7)
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
            unack[kind] = True
```

and replace it with:

```bash
            unack[kind] = at
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
    unack[kind] = False
for kind, (val, at) in sorted(newest.items()):
    print(kind, val if SAFE.fullmatch(val) else "?", at, len(val.encode()))
if any(unack.values()):
    print("drift x 0 0")
```

and replace it with:

```bash
    unack[kind] = None
for kind, (val, at) in sorted(newest.items()):
    print(kind, val if SAFE.fullmatch(val) else "?", at, len(val.encode()))
for kind, at in sorted(unack.items()):
    if at is not None:
        print("drift-" + kind, "x", at, 0)
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
      model)  field=class;  want=$(_model_class_of "$val") || want="" ;;
      effort) field=effort; want="${val,,}"; _route_word_in "$want" "$ROUTE_EFFORTS" || want="" ;;
      drift)  _operator_choice_say "$id" "unmeasured (a /model or /effort command with no acknowledgement this ccd recognises)"; continue ;;
      *)      continue ;;
```

and replace it with:

```bash
      model|drift-model)   field=class ;;
      effort|drift-effort) field=effort ;;
      *)                   continue ;;
    esac
    if [[ -e "$REG/$id.$field" ]]; then   # THE RECORD WINS WHEN IT IS NEWER, asked FIRST: a command older than its field is neither written nor logged (review 272 F6)
      fm=$(_plat_mtime "$REG/$id.$field" 2>/dev/null) && [[ "$fm" =~ ^[0-9]+$ ]] || continue
      (( 10#$fm >= 10#$at )) && continue
    fi
    case "$kind" in
      drift-*) (( drift++ )) || _operator_choice_say "$id" "unmeasured (a /model or /effort command with no acknowledgement this ccd recognises)"; continue ;;   # once per keep, both kinds or one
      model)   want=$(_model_class_of "$val") || want="" ;;
      effort)  want="${val,,}"; _route_word_in "$want" "$ROUTE_EFFORTS" || want="" ;;
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
    if [[ -e "$REG/$id.$field" ]]; then
      fm=$(_plat_mtime "$REG/$id.$field" 2>/dev/null) && [[ "$fm" =~ ^[0-9]+$ ]] || continue
      (( 10#$fm >= 10#$at )) && continue
    fi
```

and replace it with:

```bash
```

In `ccd/ccd`, find:

<!-- replay: replace ccd/ccd -->
```bash
  _session_probe "$1" 2>/dev/null; [[ "$PROBE_VERDICT" == gone || "$PROBE_SUBSTRATE" == absent ]] || rm -f "$REG/$1.choicekept" 2>/dev/null   # no tmux server means no pane: the session is dead whatever the verdict says
```

and replace it with:

```bash
  _session_probe "$1" 2>/dev/null; [[ "$PROBE_VERDICT" == gone || "${PROBE_DETAIL:-}" == *"no server running"* ]] || rm -f "$REG/$1.choicekept" 2>/dev/null   # tmux's own "no server running" means no pane: the session is dead whatever the verdict says. Read from PROBE_DETAIL as ws-reclaim reads it, never PROBE_SUBSTRATE: a MISSING socket is not proof, since a server may still run with its socket deleted (review 272 F1)
```

```bash
~/.local/bin/ccrc restamp ccd/ccd && bash -n ccd/ccd && echo ok
```

- [ ] **Step 4: The instrument's note, README, the spec and wave 3's record**

F11 and F7 in `deploy/measure-continuity.py` (comment lines only):

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python
# command replaces it (it reverts again at each). The writes are reported
# beside the row, and so are the stops where ccd could not read at all
# (`operator-choice <id>: unmeasured (…)`), which MAY have reverted one — never
# folded into the row, never dropped. The field `stops_that_could_not_read_the_transcript`
# counts KEEPS that could not measure, one per such line: keeps at a spawn count,
# so does the acknowledgement-drift line, and a refused command repeats at every
# keep until a later operator command of its kind is acknowledged. (The key keeps its name.) Named cost: a
```

and replace it with:

```python
# command replaces it or its field is written after it (it reverts again at each).
# The row's key, `restarts_that_reverted_an_operator_model`, keeps its wave-3 name
# although what it counts is those keep-time STOPS. The writes are reported
# beside the row, and so are the stops where ccd could not read at all
# (`operator-choice <id>: unmeasured (…)`), which MAY have reverted one — never
# folded into the row, never dropped. The field `stops_that_could_not_read_the_transcript`
# (its name kept too) counts KEEPS that could not measure, one per such line: keeps at a spawn count,
# so does the acknowledgement-drift line, and a refused command repeats at every
# keep until a later operator command of its kind is acknowledged or its field is
# written after it. Named cost: a
```

F2 and F7 in README's stage-7 subsection:

In `README.md`, find:

<!-- replay: replace README.md -->
```markdown
  refused the command, or the operator dismissed the `/effort` slider: `Kept effort level as …`), logs `operator-choice <id>: unmeasured (…)`, once per keep. A field written after the keystroke (the PWA picker, a coordinator's
  route, this step's last write) is the later choice and wins. `python3 deploy/measure-continuity.py --stage 7`
  counts the writes, the stops that logged a `/model` ccd could not keep, and, in
  `stops_that_could_not_read_the_transcript`, the KEEPS that could not measure: one per `unmeasured (…)` line, so a keep at a
  spawn counts and so does the acknowledgement-drift line (a successful read of a command with no recognised acknowledgement).
  A refused command repeats at every keep until a later operator command of its kind is acknowledged (a ccd keystroke
  does not clear it). The row
```

and replace it with:

```markdown
  refused the command — `/effort`'s `Invalid argument …`, 18 rows in the 6,794 fleet transcripts counted on
  2026-10-05; a dismissed `/effort` slider wrote no row there, no `Kept effort level as …` at all), logs `operator-choice <id>: unmeasured (…)`, once per keep. A field written after the keystroke (the PWA picker, a coordinator's
  route, this step's last write) is the later choice and wins, and is asked first, so an older command is not logged either. `python3 deploy/measure-continuity.py --stage 7`
  counts the writes, the stops that logged a `/model` ccd could not keep, and, in
  `stops_that_could_not_read_the_transcript`, the KEEPS that could not measure: one per `unmeasured (…)` line, so a keep at a
  spawn counts and so does the acknowledgement-drift line (a successful read of a command with no recognised acknowledgement).
  A refused command, and the drift line, repeat at every keep until a later operator command of its kind is
  acknowledged or its field is written after it (a `route --set`, the PWA picker; a ccd keystroke does not clear it). The row
```

The same two in the spec's §5.7:

In `docs/superpowers/specs/2026-09-23-session-continuity-design.md`, find:

<!-- replay: replace docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```markdown
Code itself refused, or a dismissed `/effort` slider: `Kept effort level as …`), logs `unmeasured`, once per keep. §9's stage-7 row counts the keep-time stops whose `/model` ccd
logged as outside the vocabulary or refused, with `stops_that_could_not_read_the_transcript` beside it (it counts KEEPS that
could not measure, one per `unmeasured` line, keeps at a spawn and the acknowledgement-drift line included, and a refused
command repeats at every keep until a later operator command of its kind is acknowledged, a ccd keystroke not clearing it); it counts those STOPS, not
```

and replace it with:

```markdown
Code itself refused — `/effort`'s `Invalid argument …`, 18 rows in 6,794 fleet transcripts counted on 2026-10-05, where
a dismissed `/effort` slider wrote no row at all), logs `unmeasured`, once per keep, unless the field was written after
the command (that check is asked first). §9's stage-7 row counts the keep-time stops whose `/model` ccd
logged as outside the vocabulary or refused, with `stops_that_could_not_read_the_transcript` beside it (it counts KEEPS that
could not measure, one per `unmeasured` line, keeps at a spawn and the acknowledgement-drift line included, and a refused
command repeats at every keep until a later operator command of its kind is acknowledged or its field is written after
it, a ccd keystroke not clearing it); it counts those STOPS, not
```

Wave 3's plan: F10's two restated red-first counts and F1's narrowing in their entries, F2's measured noise in the drift
entry, and F3's six cells restated at the tip (`77f8d63a`, 64 cases — each row's names as measured):

In `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md`, find:

<!-- replay: replace docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md -->
```markdown
| 3.4 | `ccd/ccd` | `` [[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # `ccd start`/`enable` respawn from the record: the operator's own /model and /effort reach it first; a session already stopped and read is not read again (§5.7) `` → (nothing) | ccd-operator-choice.test.ts | 6 failed \| 49 passed (55): “ccd stop: `ccd start`/`enable` respawn from the record”; “a stop and then a ws-archive of the same dead session read once and log once”; “two stops in a row of the same dead session read once and log once”; “a kill that failed on a session that is still there leaves no marker”; “control: a kill that failed because the session was already gone keeps the marker”; “every stop in ccd is classified …” |
```

and replace it with:

```markdown
| 3.4 | `ccd/ccd` | `` [[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # `ccd start`/`enable` respawn from the record: the operator's own /model and /effort reach it first; a session already stopped and read is not read again (§5.7) `` → (nothing) | ccd-operator-choice.test.ts | 7 failed \| 57 passed (64) (re-measured by wave 4 at `77f8d63a`, the merged tip: review 272, F3): “ccd stop: `ccd start`/`enable` respawn from the record”; “a stop and then a ws-archive of the same dead session read once and log once”; “two stops in a row of the same dead session read once and log once”; “a kill that failed on a session that is still there leaves no marker”; “control: a kill that failed because the session was already gone keeps the marker”; “a stop whose kill failed because no tmux server is running keeps the marker …”; “every stop in ccd is classified …” |
```

In `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md`, find:

<!-- replay: replace docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md -->
```markdown
| 3.28 | `ccd/ccd` | `` [[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # EVERY spawn reads, here at the one choke point: a revival (Claude Code exited — a pane-scope OOM kill, /exit — and `_supervised_start`'s two unsupervised fallbacks) reads; a spawn that a stop's keep already read for (swap landing, start after stop, ws-restore after ws-archive, refusal restart) does not read again (§5.7). BEFORE the floor line below, or an older ccd's session would open its journal first and the keep read nothing `` → (nothing) | ccd-operator-choice.test.ts | 6 failed \| 44 passed (50): “a supervisor revival: cmd_ensure in the unit keeps the operator's /model before its spawn”; “after a stop's keep and a spawn the marker is gone, so a later revival reads again”; both “_supervised_start's fallback revival keeps the operator's /model opus” cases; “the keep runs BEFORE the spawn opens the journal …”; “every stop in ccd is classified …” |
| 3.29 | `ccd/ccd` | `[[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"` → `_operator_choice_keep "$id"` | ccd-operator-choice.test.ts | 4 failed \| 46 passed (50): “a swap logs an out-of-vocabulary /model once: the landing's cmd_ensure does not read again”; “after a stop's keep and a spawn the marker is gone, so a later revival reads again”; “a spawn after a stop's keep does not read again (the marker gates the choke point)”; “every stop in ccd is classified …” |
| 3.30 | `ccd/ccd` | `rm -f "$REG/$id.choicekept"   # every spawn ends the marker: it means "a keep ran since the last spawn" (§5.7)` → (nothing) | ccd-operator-choice.test.ts | 5 failed \| 45 passed (50): “after a stop's keep and a spawn the marker is gone, so a later revival reads again”; “ccd ws-archive: ws-restore respawns from the record”; both “_supervised_start's fallback revival keeps the operator's /model opus” cases; “every stop in ccd is classified …” |
```

and replace it with:

```markdown
| 3.28 | `ccd/ccd` | `` [[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # EVERY spawn reads, here at the one choke point: a revival (Claude Code exited — a pane-scope OOM kill, /exit — and `_supervised_start`'s two unsupervised fallbacks) reads; a spawn that a stop's keep already read for (swap landing, start after stop, ws-restore after ws-archive, refusal restart) does not read again (§5.7). BEFORE the floor line below, or an older ccd's session would open its journal first and the keep read nothing `` → (nothing) | ccd-operator-choice.test.ts | 6 failed \| 58 passed (64) (re-measured by wave 4 at `77f8d63a`, the merged tip: review 272, F3): “a supervisor revival: cmd_ensure in the unit keeps the operator's /model before its spawn”; “after a stop's keep and a spawn the marker is gone, so a later revival reads again”; both “_supervised_start's fallback revival keeps the operator's /model opus” cases; “the keep runs BEFORE the spawn opens the journal …”; “every stop in ccd is classified …” |
| 3.29 | `ccd/ccd` | `` [[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # EVERY spawn reads `` → `` _operator_choice_keep "$id"   # EVERY spawn reads `` (the line in `_spawn_start`: the bare guard matches four lines, review 272 F3) | ccd-operator-choice.test.ts | 4 failed \| 60 passed (64) (re-measured by wave 4 at `77f8d63a`, the merged tip: review 272, F3): “a swap logs an out-of-vocabulary /model once: the landing's cmd_ensure does not read again”; “after a stop's keep and a spawn the marker is gone, so a later revival reads again”; “a spawn after a stop's keep does not read again (the marker gates the choke point)”; “every stop in ccd is classified …” |
| 3.30 | `ccd/ccd` | `rm -f "$REG/$id.choicekept"   # every spawn ends the marker: it means "a keep ran since the last spawn" (§5.7)` → (nothing) | ccd-operator-choice.test.ts | 4 failed \| 60 passed (64) (re-measured by wave 4 at `77f8d63a`, the merged tip: review 272, F3): “after a stop's keep and a spawn the marker is gone, so a later revival reads again”; both “_supervised_start's fallback revival keeps the operator's /model opus” cases; “every stop in ccd is classified …” — not “ccd ws-archive: ws-restore respawns from the record”, which never reaches `_spawn_start`; wave 4 adds the ws-restore case this row also reds |
```

In `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md`, find:

<!-- replay: replace docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md -->
```markdown
| 3.35 | `ccd/ccd` | `[[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # EVERY spawn reads / _typed_note "$id" since   # the operator-choice journal` → `_typed_note "$id" since   # the floor first / [[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # the operator-choice journal` | ccd-operator-choice.test.ts | 3 failed \| 47 passed (50): “the keep runs BEFORE the spawn opens the journal: a session an older ccd spawned says unmeasured once”; “a FIFO where the transcript should be is never opened …”; “every stop in ccd is classified …” |
| 3.36 | `ccd/ccd` | `_route_apply_now() {   # id -> 0 everything wanted is applied` → `_revive_session() { local id="$1"; _tmux_new_session -d -s "cc-$id" claude; }; _route_apply_now() {   # id -> 0 everything wanted is applied` | ccd-operator-choice.test.ts | 1 failed \| 49 passed (50): “every spawn primitive in ccd sits in _spawn_start, or in a named exception” |
| 3.37 | `ccd/ccd` | `[[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"; _ws_unsupervise "$id"` → `_operator_choice_keep "$id"; _ws_unsupervise "$id"` | ccd-operator-choice.test.ts | 2 failed \| 53 passed (55): “a stop and then a ws-archive of the same dead session read once and log once”; “every stop in ccd is classified …” |
```

and replace it with:

```markdown
| 3.35 | `ccd/ccd` | `[[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # EVERY spawn reads / _typed_note "$id" since   # the operator-choice journal` → `_typed_note "$id" since   # the floor first / [[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"   # the operator-choice journal` | ccd-operator-choice.test.ts | 2 failed \| 62 passed (64) (re-measured by wave 4 at `77f8d63a`, the merged tip: review 272, F3): “the keep runs BEFORE the spawn opens the journal: a session an older ccd spawned says unmeasured once”; “every stop in ccd is classified …” — not the FIFO case, which calls the keep directly (its third red was a load timeout) |
| 3.36 | `ccd/ccd` | `_route_apply_now() {   # id -> 0 everything wanted is applied` → `_revive_session() { local id="$1"; _tmux_new_session -d -s "cc-$id" claude; }; _route_apply_now() {   # id -> 0 everything wanted is applied` | ccd-operator-choice.test.ts | 1 failed \| 49 passed (50): “every spawn primitive in ccd sits in _spawn_start, or in a named exception” |
| 3.37 | `ccd/ccd` | `[[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"; _ws_unsupervise "$id"` → `_operator_choice_keep "$id"; _ws_unsupervise "$id"` | ccd-operator-choice.test.ts | 3 failed \| 61 passed (64) (re-measured by wave 4 at `77f8d63a`, the merged tip: review 272, F3): “a stop and then a ws-archive of the same dead session read once and log once”; “a stop whose kill failed because no tmux server is running keeps the marker …”; “every stop in ccd is classified …” |
```

In `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md`, find:

<!-- replay: replace docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md -->
```markdown
  removed), 3.29, 3.30, 3.35, 3.36.
```

and replace it with:

```markdown
  removed), 3.29, 3.30, 3.35, 3.36. Red-first, re-measured by wave 4 (review 272, F10): this commit's test file against
  `b00849ee`'s ccd is `4 failed | 46 passed (50)` — the spawn census is the fourth — where the commit message says
  `3 failed | 46 passed (49)`, a state no commit holds.
```

In `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md`, find:

<!-- replay: replace docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md -->
```markdown
  move). Rows 3.3, 3.4, 3.5 (rebased to the guarded lines), 3.37–3.43, 3.51.
```

and replace it with:

```markdown
  move). Rows 3.3, 3.4, 3.5 (rebased to the guarded lines), 3.37–3.43, 3.51. Red-first, re-measured by wave 4 (review 272,
  F10): this commit's test file against `6db10976`'s ccd is `5 failed | 50 passed (55)` — "two stops in a row…" and the
  census are the two the commit message's `3 failed | 51 passed (54)` leaves out. Narrowed by wave 4 (review 272, F1): a
  failed kill keeps the marker on `gone` or on tmux's own `no server running` (read from `PROBE_DETAIL`, as ws-reclaim
  reads it), no longer on `PROBE_SUBSTRATE == absent`, which also admitted a deleted socket that a live server outlives.
```

In `docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md`, find:

<!-- replay: replace docs/superpowers/plans/2026-10-04-session-continuity-wave3-operator-choice.md -->
```markdown
  (rebased to the split `if`), 3.46–3.50.
```

and replace it with:

```markdown
  (rebased to the split `if`), 3.46–3.50. THE NOISE, measured by wave 4 (review 272, F2; a counts-only census on
  2026-10-05 of the 6,794 fleet transcripts under 150 MB modified in the last 40 days, which printed no content): the
  only unrecognised acknowledgement after an operator `/model` or `/effort` is `/effort`'s `Invalid argument …` (18 rows
  in 18 transcripts; 6,034 `Set effort level to …`, 22 `Ultracode on …`, 454 `Set model to …`, no envelope without an
  acknowledgement row) — a command Claude Code refused, the cost above. A dismissed `/effort` slider wrote no row at all:
  `Kept effort level as …` appears 0 times, so it is never drift and the reader is not taught it (`_pane_effort_ack`
  reads it from the PANE, where Claude Code prints it). Each such refusal repeats its line at every keep until a later
  command of its kind is acknowledged or its field is written after it (wave 4 asks the field first, review 272 F6).
```

- [ ] **Step 5: Pay the citation tax, then run the tests to verify they pass**

Run the S6-R11 procedure (expected unchanged: `147 / 197 / 55 / 35`, `corpus-frozen`; the `_reg_get` census `182` /
`153`, unchanged). Then:

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/measure-continuity-stage7.test.ts test/measure-continuity-stage4.test.ts test/measure-continuity.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-swap.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-archive.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-die-containment.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/readme-holds.test.ts test/pools-prose.test.ts test/deviation-refs.test.ts --maxWorkers=1
```

Expected: `72 passed (72)`; then `19 passed (19)` (2 + 12 + 5); `ccd-swap` `16 passed (16)`; `ccd-archive` `77 passed (77)`; `29 passed (29)` (die-containment, ownership, reg-get-census); `readme-holds` + `pools-prose` `44 passed (44)`; `deviation-refs` green after `git fetch origin main`.

- [ ] **Step 6: Mutation check, then commit**

Each row applied to a saved copy of the file, `ccd/ccd` re-stamped, `ccd-operator-choice.test.ts` run alone at
`--maxWorkers=1`, and the file restored from the copy (`cmp`). Multi-line edits show their lines joined by ` / `;
`(nothing)` is a deletion.

| # | File | Exact edit (old → new) | Measured red on the full prototype (of 72) |
|---|---|---|---|
| 1.1 | `ccd/ccd` | in `_operator_choice_unmark`: `"${PROBE_DETAIL:-}" == *"no server running"*` → `"$PROBE_SUBSTRATE" == absent` | 1 failed: “a stop whose kill failed with tmux's socket DELETED unmarks: a missing socket is not proof that no server runs” |
| 1.2 | `ccd/ccd` | in `_operator_choice_unmark`: ` \|\| "${PROBE_DETAIL:-}" == *"no server running"*` → (nothing) | 1 failed: “a stop whose kill failed because no tmux server is running keeps the marker: a following ws-archive reads once and logs once” |
| 1.3 | `ccd/ccd` | the record-newer `if [[ -e "$REG/$id.$field" ]]; then … fi` block moved back BELOW the `case` and the out-of-vocabulary block (wave 3's order) | 2 failed: “an out-of-vocabulary /model older than its field is not logged…”; “an unrecognised acknowledgement older than its field is not logged as drift” |
| 1.4 | `ccd/ccd` | `drift-*) (( drift++ )) \|\| _operator_choice_say "$id"` → `drift-*) _operator_choice_say "$id"` | 1 failed: “a /model and an /effort both unrecognised log ONE line for the keep” |
| 1.5 | `ccd/ccd` | `(not given or v == given)` → `(v == given)` | 1 failed: “ccd's own ARGLESS keystroke (the picker) whose acknowledgement drifted is explained by its journal row: no line” |
| 1.6 | `ccd/ccd` | cmd_swap's `tmux kill-session … \|\| _operator_choice_unmark "$id"` → `… \|\| true` (anchored with its `_svc_stop` line above) | 2 failed: “every stop in ccd is classified…”; “a swap whose kill failed on a session that is still there leaves no marker” |
| 1.7 | `ccd/ccd` | cmd_swap's `[[ -e "$REG/$id.choicekept" ]] \|\| _operator_choice_keep "$id"` → `_operator_choice_keep "$id"` | 2 failed: “every stop in ccd is classified…”; “a swap of a session already stopped and read (marked) does not read again” |
| 1.8 | `ccd/ccd` | `_spawn_start`'s `rm -f "$REG/$id.choicekept"   # every spawn ends the marker…` → (nothing) | 5 failed: “after a stop's keep and a spawn the marker is gone…”; both “_supervised_start's fallback revival…”; “every stop in ccd is classified…”; “ccd ws-restore after ws-archive is one restart: the restore's spawn does not read again, and ends the marker” |

Then `git add -A && git commit` — "continuity wave 4: wave 3's residue (review 272 F1–F11)".

---

### Task 2: The reap-class OOM count (spec §9's stage-6 row, baseline B)

**Model routing:** `sonnet`, effort `high` — a read-only instrument, bound by its tests.

**Files:**
- Modify: `deploy/measure-continuity.py` — one `stage6` block above stage 7's, `import subprocess`, one `--journal` flag,
  `"journal"` in `ctx`, the registry entry, one header sentence
- Create: `server/test/measure-continuity-stage6.test.ts`

**Interfaces:**
- Consumes: the user journal (`journalctl --user -o json` records of `tmux-spawn-*.scope`: `JOB_TYPE`, `JOB_RESULT`,
  `UNIT_RESULT`, `__REALTIME_TIMESTAMP`), or `--journal FILE` holding those lines; `<home>/.cc-sessions/.lifecycle/
  journal-*.ndjson`'s `spawn`/`done` events; `<home>/.cc-sessions/<id>.uuid`; the largest copy of
  `<home>/.claude*/projects/*/<uuid>.jsonl` (every copy with `--all-copies`).
- Produces: `--stage 6` → `stage6.reap_class_oom` = `{pane_scope_oom_stops, reap_class, idle_without_a_live_background_shell,
  busy_within_the_idle_window, unmapped, unmapped_by_reason, unmeasured, reap_class_by_session}`, or `{journal:
  "unreadable"}`. `S6_IDLE = 1800`, `S6_SPAWN_SLOP = 10`.

**What it counts, and why this way.** Spec §9's B is "OOM stops of pane scopes whose session had been idle 30 minutes
or more with a live background shell": the class Claude Code's pressure reap chooses by (§1.3), counted the week the
reap is still on, so wave 4b's variable can be judged against it. The journal has the stops but no session; ccd's
lifecycle journal has every spawn but no scope; a scope's start and its session's `spawn` event are seconds apart
(Pre-flight 7), so a scope maps to the ONE session whose spawn event landed in the ten seconds after its start —
anything else is `unmapped`, never guessed. The transcript then decides idle (no user or assistant row in the 30
minutes before the stop; a `system` row is not input) and live (a `run_in_background` start since that spawn — a
shell of an earlier process died with it — with no `<task-notification>` for its id by the stop).

- [ ] **Step 1: Write the failing test**

Create `server/test/measure-continuity-stage6.test.ts`:

<!-- replay: create server/test/measure-continuity-stage6.test.ts -->
```ts
// `deploy/measure-continuity.py`'s stage-6 row (session-continuity spec §9;
// wave 4): OOM stops of pane scopes whose session had been idle 30 minutes or
// more with a live background shell — the class Claude Code's pressure reap
// chooses by — beside every pane-scope OOM stop. Its week after wave 4's deploy
// is baseline B. The instrument is READ-ONLY; this suite feeds it a hand-built
// journal export (`--journal`), a fixture HOME's lifecycle journal and
// transcripts, and binds the lifecycle reader to an event the REAL ccd wrote.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/measure-continuity.py');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-measure-continuity-s6-'); });
afterEach(() => { h.cleanup(); });

type Row = Record<string, number | string | Record<string, number>>;
const run = (extra: string[] = []): Row => {
  const out = execFileSync('python3', [TOOL, '--home', h.home, '--stage', '6', '--journal', path.join(h.home, 'journal.json'), ...extra, '--json'],
    { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
  return (JSON.parse(out) as { stage6: { reap_class_oom: Row } }).stage6.reap_class_oom;
};

const T = Date.parse('2026-10-06T12:00:00Z') / 1000;            // the hour every stop below happens in
const iso = (t: number): string => new Date(t * 1000).toISOString();
const unit = (n: number): string => `tmux-spawn-0000000${n}-0000-4000-8000-000000000000.scope`;
const uuidOf = (sid: string): string => `${Buffer.from(sid).toString('hex').padEnd(8, '0').slice(0, 8)}-0000-4000-8000-000000000000`;

/** `journalctl --user -o json` lines, as the instrument asks for them: a scope's start and its OOM stop. */
const journal: string[] = [];
const started = (n: number, t: number): void => {
  journal.push(JSON.stringify({ __REALTIME_TIMESTAMP: String(Math.round(t * 1e6)), USER_UNIT: unit(n), JOB_TYPE: 'start', JOB_RESULT: 'done' }));
};
const oom = (n: number, t: number): void => {
  journal.push(JSON.stringify({ __REALTIME_TIMESTAMP: String(Math.round(t * 1e6)), USER_UNIT: unit(n), UNIT_RESULT: 'oom-kill' }));
};
/** ccd's lifecycle `spawn` event, in the shape `_lc_emit` writes (bound to the real writer below). */
const spawned = (sid: string, t: number): void => {
  const d = path.join(h.home, '.cc-sessions', '.lifecycle');
  fs.mkdirSync(d, { recursive: true });
  fs.appendFileSync(path.join(d, 'journal-1.ndjson'), JSON.stringify({ v: 1, at: Math.round(t * 1000), act: 'spawn', outcome: 'done', id: sid }) + '\n');
};
/** Claude Code's rows, in the shapes measured on the fleet box: a Bash `run_in_background` start
 *  (its tool_result), the `<task-notification>` that ends one, and an ordinary turn. */
const rows = {
  turn: (t: number): string => JSON.stringify({ type: 'assistant', timestamp: iso(t), message: { role: 'assistant', content: [{ type: 'text', text: 'Working.' }] } }),
  bg: (t: number, task: string): string => JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `Command running in background with ID: ${task}. Output is being written to: /tmp/x/${task}.output` }] } }),
  note: (t: number, task: string): string => JSON.stringify({ type: 'user', timestamp: iso(t), message: { role: 'user', content: `<task-notification>\n<task-id>${task}</task-id>\n<status>completed</status>\n</task-notification>` } }),
  system: (t: number): string => JSON.stringify({ type: 'system', timestamp: iso(t), content: 'Remote Control disconnected' }),
};
const session = (sid: string, lines: string[]): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', `${sid}.uuid`), uuidOf(sid));
  const d = path.join(h.home, '.claude', 'projects', `-p-${sid}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, `${uuidOf(sid)}.jsonl`), lines.join('\n') + '\n');
};
const flush = (): void => { fs.writeFileSync(path.join(h.home, 'journal.json'), journal.join('\n') + '\n'); journal.length = 0; };

describe('stage 6 counts what its row says (TZ=UTC, a hand-built journal)', () => {
  it('the reap\'s class, the idle and the busy stops, and every stop it cannot map or measure', () => {
    fs.mkdirSync(path.join(h.home, '.cc-sessions'), { recursive: true });
    // 1 — idle for an hour with a background shell no notification ended: THE REAP'S CLASS
    started(1, T - 7200); spawned('reap', T - 7196); oom(1, T);
    session('reap', [rows.turn(T - 7000), rows.bg(T - 6000, 'b1'), rows.turn(T - 3600)]);
    // 2 — a turn ten minutes before the stop: busy
    started(2, T - 7300); spawned('busy', T - 7295); oom(2, T + 1);
    session('busy', [rows.bg(T - 6000, 'b2'), rows.turn(T - 600)]);
    // 3 — idle, but its one background shell was ended by a notification: idle with no live shell
    started(3, T - 7400); spawned('done', T - 7394); oom(3, T + 2);
    session('done', [rows.bg(T - 6000, 'b3'), rows.note(T - 5000, 'b3'), rows.turn(T - 4000)]);
    // 4 — idle; its shell was started BEFORE this process's spawn, so it died with the old one
    started(4, T - 7500); spawned('old', T - 7493); oom(4, T + 3);
    session('old', [rows.bg(T - 8000, 'b4'), rows.turn(T - 4000)]);
    // 5 — a system row inside the window is no input: still the reap's class
    started(5, T - 7600); spawned('sys', T - 7592); oom(5, T + 4);
    session('sys', [rows.bg(T - 6000, 'b5'), rows.turn(T - 4000), rows.system(T - 60)]);
    // 6 — two sessions spawned in the same window: unmapped
    started(6, T - 9000); spawned('twin-a', T - 8998); spawned('twin-b', T - 8996); oom(6, T + 5);
    // 7 — a scope whose start the journal no longer holds: unmapped
    oom(7, T + 6);
    // 8 — mapped, but the session's row has no uuid any more: unmeasured
    started(8, T - 9500); spawned('gone', T - 9497); oom(8, T + 7);
    // 9 — another session's spawn 3 s BEFORE this scope's start is not this scope's: mapped to the one after it
    started(9, T - 9900); spawned('early', T - 9903); spawned('late', T - 9897); oom(9, T + 8);
    session('late', [rows.bg(T - 6000, 'b9'), rows.turn(T - 3600)]);
    // 10 — an OOM stop before --since is not counted
    started(10, T - 100000); spawned('before', T - 99998); oom(10, T - 90000);
    session('before', [rows.bg(T - 95000, 'b10')]);
    // 11 — a scope that ended for any other reason is not an OOM stop
    started(11, T - 7700); spawned('clean', T - 7699);
    journal.push(JSON.stringify({ __REALTIME_TIMESTAMP: String((T + 9) * 1e6), USER_UNIT: unit(11), UNIT_RESULT: 'exit-code' }));
    flush();
    const r = run(['--since', '2026-10-06']);
    expect(r.pane_scope_oom_stops).toBe(9);
    expect(r.reap_class).toBe(3);
    expect(r.reap_class_by_session).toEqual({ late: 1, reap: 1, sys: 1 });
    expect(r.busy_within_the_idle_window).toBe(1);
    expect(r.idle_without_a_live_background_shell).toBe(2);
    expect(r.unmapped).toBe(2);
    expect(r.unmapped_by_reason).toEqual({ 'no start record': 1, 'two sessions spawned together': 1 });
    expect(r.unmeasured).toBe(1);
  });

  it('a journal it cannot read is said, never counted as zero', () => {
    expect(run()).toEqual({ journal: 'unreadable' });
  });
});

describe('the lifecycle reader is bound to the event the real ccd writes', () => {
  it('a spawn ccd journalled maps the scope that started in the seconds before it', () => {
    h.sh('_lc_done spawn s-real "" meas.rc 0 meas.wrapper claude');
    const files = fs.readdirSync(path.join(h.home, '.cc-sessions', '.lifecycle')).filter((f) => f.startsWith('journal-'));
    expect(files.length, 'ccd wrote its lifecycle journal').toBeGreaterThan(0);
    const ev = JSON.parse(fs.readFileSync(path.join(h.home, '.cc-sessions', '.lifecycle', files[0]!), 'utf8').trim().split('\n').pop()!) as { at: number };
    const t0 = ev.at / 1000 - 3;
    started(1, t0); oom(1, t0 + 7200);
    session('s-real', [rows.bg(t0 + 100, 'b1'), rows.turn(t0 + 200)]);
    flush();
    const r = run();
    expect(r.reap_class_by_session).toEqual({ 's-real': 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage6.test.ts --maxWorkers=1
```

Expected: `3 failed (3)` (`--stage 6` is not a choice yet, so the tool exits 2 under each).

- [ ] **Step 3: The stage-6 block**

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python
unit. It grows with the programme: each wave adds the §9 rows it owns as one
```

and replace it with:

```python
unit (`--stage 6` reads the user journal by one read-only `journalctl --user`
run, unless `--journal` names an export of it). It grows with the programme: each wave adds the §9 rows it owns as one
```

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python
import re
```

and replace it with:

```python
import re
import subprocess
```

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python

# ── stage 7 (wave 3): the operator's choice survives a restart ──────────────
```

and replace it with:

```python

# ── stage 6 (wave 4): the OOM stops of the pressure reap's own class ─────────
# §9's stage-6 row, baseline B: OOM stops of pane scopes whose session had been
# idle 30 minutes or more with a live background shell — the class Claude Code's
# background-shell pressure reap chooses by (spec §1.3) — with every pane-scope
# OOM stop beside it. B is the count over the week that starts at wave 4's
# deploy, with the reap still on (wave 4b ships the variable that disables it).
# Four sources, all read-only:
#   the user journal  every `tmux-spawn-*.scope` record: its start (JOB_TYPE
#                     start, JOB_RESULT done) and its OOM stop (UNIT_RESULT
#                     oom-kill — under OOMPolicy=stop the kill of any process in
#                     a pane scope ends the scope and its session). Read from
#                     `--journal FILE` (`journalctl -o json` lines) when given,
#                     else by ONE read-only `journalctl --user` run.
#   .lifecycle/       ccd's own `spawn` events: a scope is the session whose
#                     spawn event landed in the S6_SPAWN_SLOP seconds AFTER the
#                     scope's start (the event follows the settle: measured on
#                     the fleet box, 2–6 s after the scope for most spawns) —
#                     exactly one session, or the stop is `unmapped`. The same
#                     event dates that Claude Code's process.
#   <id>.uuid         the session's transcript (the largest copy, as stage 1).
#   the transcript    idle: no user or assistant row in the S6_IDLE seconds
#                     before the stop; a live background shell: a Bash
#                     `run_in_background` start ("Command running in background
#                     with ID: X") after the spawn and at or before the stop,
#                     with no `<task-notification>` for X at or before it.
# Named costs: a scope whose start fell out of the journal's retention, or whose
# spawn shared its window with another session's, is `unmapped`; a session whose
# transcript changed uuid since the stop (a /clear) reads the newer file, which
# holds no row before the stop, so it reads as idle with no shell; a background
# shell ended by Claude Code without a notification row reads as live.
S6_IDLE = 1800
S6_SPAWN_SLOP = 10
S6_TS = re.compile(rb'"timestamp":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)')
S6_ROW = re.compile(rb'"type":"(?:user|assistant)"')
S6_BG = re.compile(rb"Command running in background with ID: ([A-Za-z0-9_-]+)")
S6_NOTE = re.compile(rb"<task-notification>(?:\\n|\s)*<task-id>([A-Za-z0-9_-]+)</task-id>")


def s6_iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)).encode()


def s6_journal(ctx):
    """The journal's pane-scope records as dicts, or None when they cannot be read."""
    try:
        if ctx.get("journal"):
            with open(ctx["journal"], "rb") as fh:
                raw = fh.read()
        else:
            p = subprocess.run(["journalctl", "--user", "--no-pager", "-o", "json",
                                "--output-fields=USER_UNIT,UNIT_RESULT,JOB_TYPE,JOB_RESULT",
                                "-u", "tmux-spawn-*.scope"], capture_output=True, timeout=600)
            if p.returncode != 0:
                return None
            raw = p.stdout
    except (OSError, subprocess.SubprocessError):
        return None
    out = []
    for line in raw.decode("utf-8", "replace").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict) and str(e.get("USER_UNIT", "")).startswith("tmux-spawn-"):
            out.append(e)
    return out


def s6_spawns(ctx):
    """ccd's lifecycle `spawn` events: (epoch seconds, session id), oldest first."""
    out = []
    for f in sorted(glob.glob(os.path.join(ctx["home"], ".cc-sessions", ".lifecycle", "journal-*.ndjson"))):
        try:
            lines = read_lines(f)
        except OSError:
            continue
        for line in lines:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if isinstance(e, dict) and e.get("act") == "spawn" and e.get("outcome") == "done" \
                    and isinstance(e.get("at"), int) and isinstance(e.get("id"), str):
                out.append((e["at"] / 1000.0, e["id"]))
    return sorted(out)


def s6_transcript(ctx, sid):
    try:
        with open(os.path.join(ctx["home"], ".cc-sessions", sid + ".uuid"), "rb") as fh:
            uuid = fh.read().decode("utf-8", "replace").strip()
    except OSError:
        return []
    if not re.fullmatch(r"[0-9a-f-]{36}", uuid):
        return []
    best = []
    for p in glob.glob(os.path.join(ctx["home"], ".claude*", "projects", "*", uuid + ".jsonl")):
        try:
            best.append((os.path.getsize(p), p))
        except OSError:
            pass
    best.sort(reverse=True)
    return [p for _, p in best] if ctx["all_copies"] else [p for _, p in best[:1]]


def s6_classify(paths, born, at):
    """-> busy | idle-no-shell | reap-class, read off the transcript's own rows."""
    lo, hi, born_iso = s6_iso(at - S6_IDLE), s6_iso(at), s6_iso(born)
    started, ended, busy = set(), set(), False
    for p in paths:
        with open(p, "rb") as fh:
            if os.fstat(fh.fileno()).st_size == 0:
                continue
            mm = mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ)
            try:
                def row_at(pos):
                    a = mm.rfind(b"\n", 0, pos) + 1
                    b = mm.find(b"\n", pos)
                    line = mm[a:b if b >= 0 else len(mm)]
                    m = S6_TS.search(line)
                    return line, (m.group(1) if m else None)
                for m in S6_TS.finditer(mm):
                    ts = m.group(1)
                    if lo < ts <= hi and not busy:
                        line, _ = row_at(m.start())
                        busy = bool(S6_ROW.search(line))
                for m in S6_BG.finditer(mm):
                    _, ts = row_at(m.start())
                    if ts is not None and born_iso <= ts <= hi:
                        started.add(m.group(1))
                for m in S6_NOTE.finditer(mm):
                    _, ts = row_at(m.start())
                    if ts is not None and ts <= hi:
                        ended.add(m.group(1))
            finally:
                mm.close()
    if busy:
        return "busy"
    return "reap-class" if started - ended else "idle-no-shell"


def stage6(ctx):
    recs = s6_journal(ctx)
    if recs is None:
        return {"reap_class_oom": {"journal": "unreadable"}}
    born, stops = {}, []
    for e in recs:
        try:
            t = int(e["__REALTIME_TIMESTAMP"]) / 1e6
        except (KeyError, TypeError, ValueError):
            continue
        u = e["USER_UNIT"]
        if e.get("JOB_TYPE") == "start" and e.get("JOB_RESULT") == "done":
            born[u] = t
        elif e.get("UNIT_RESULT") == "oom-kill" and in_window(int(t), ctx):
            stops.append((t, u))
    spawns = s6_spawns(ctx)
    counts, unmapped, sessions = collections.Counter(), collections.Counter(), collections.Counter()
    for at, unit in sorted(stops):
        t0 = born.get(unit)
        if t0 is None:
            unmapped["no start record"] += 1
            continue
        near = [(s, sid) for s, sid in spawns if t0 <= s <= t0 + S6_SPAWN_SLOP]
        if len({sid for _, sid in near}) != 1:
            unmapped["no spawn" if not near else "two sessions spawned together"] += 1
            continue
        spawned, sid = near[-1]
        paths = s6_transcript(ctx, sid)
        if not paths:
            counts["unmeasured"] += 1
            continue
        try:
            cls = s6_classify(paths, spawned, at)
        except (OSError, ValueError):
            counts["unmeasured"] += 1
            continue
        counts[cls] += 1
        if cls == "reap-class":
            sessions[sid] += 1
    return {"reap_class_oom": {
        "pane_scope_oom_stops": len(stops),
        "reap_class": counts["reap-class"],
        "idle_without_a_live_background_shell": counts["idle-no-shell"],
        "busy_within_the_idle_window": counts["busy"],
        "unmapped": sum(unmapped.values()),
        "unmapped_by_reason": dict(sorted(unmapped.items())),
        "unmeasured": counts["unmeasured"],
        "reap_class_by_session": dict(sorted(sessions.items())),
    }}


# ── stage 7 (wave 3): the operator's choice survives a restart ──────────────
```

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python
STAGES = {1: stage1, 4: stage4, 7: stage7}
```

and replace it with:

```python
STAGES = {1: stage1, 4: stage4, 6: stage6, 7: stage7}
```

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python
    ap.add_argument("--all-copies", action="store_true", help="read every transcript copy, not the largest per uuid")
```

and replace it with:

```python
    ap.add_argument("--all-copies", action="store_true", help="read every transcript copy, not the largest per uuid")
    ap.add_argument("--journal", help="stage 6: a `journalctl --user -o json` export to read instead of running journalctl")
```

In `deploy/measure-continuity.py`, find:

<!-- replay: replace deploy/measure-continuity.py -->
```python
        "all_copies": a.all_copies,
```

and replace it with:

```python
        "all_copies": a.all_copies, "journal": a.journal,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/measure-continuity-stage6.test.ts test/measure-continuity-stage7.test.ts test/measure-continuity-stage4.test.ts test/measure-continuity.test.ts --maxWorkers=1
```

Expected: `22 passed (22)` (3 + 2 + 12 + 5).

- [ ] **Step 5: Mutation check**

| # | File | Exact edit (old → new) | Measured red (of 3) |
|---|---|---|---|
| 2.1 | `deploy/measure-continuity.py` | `if lo < ts <= hi and not busy:` → `if False:` | 1 failed: “the reap's class, the idle and the busy stops, and every stop it cannot map or measure” |
| 2.2 | ″ | `ended.add(m.group(1))` → `pass` | 1 failed: ″ |
| 2.3 | ″ | `if ts is not None and born_iso <= ts <= hi:` → `if ts is not None and ts <= hi:` | 1 failed: ″ |
| 2.4 | ″ | `if len({sid for _, sid in near}) != 1:` → `if not near:` | 1 failed: ″ |
| 2.5 | ″ | `elif e.get("UNIT_RESULT") == "oom-kill" and in_window(int(t), ctx):` → `elif e.get("UNIT_RESULT") == "oom-kill":` | 1 failed: ″ |
| 2.6 | ″ | `if t0 <= s <= t0 + S6_SPAWN_SLOP]` → `if abs(s - t0) <= S6_SPAWN_SLOP]` | 1 failed: ″ |
| 2.7 | ″ | `busy = bool(S6_ROW.search(line))` → `busy = True` | 1 failed: ″ |
| 2.8 | ″ | `s6_journal`'s `except (OSError, subprocess.SubprocessError): / return None` → `… / return []` | 1 failed: “a journal it cannot read is said, never counted as zero” |

One hand-built journal carries eleven scopes, each guarding one reading, so seven of the eight rows red the same case;
each row was measured on its own.

- [ ] **Step 6: The pre-deploy reading (read-only), then commit**

```bash
python3 deploy/measure-continuity.py --stage 6 --since 2026-09-16 --until 2026-09-24 --json
python3 deploy/measure-continuity.py --stage 6 --since 2026-09-28 --json
```

Expected (on the fleet box, `TZ=UTC`): the first reads `"pane_scope_oom_stops": 16` (spec §1.3's sixteen) with
`"reap_class": 0`; the second, about 19 stops and 1 reap-class through 2026-10-05 17:00 (Pre-flight 8; later stops
add). Report both in the wave-done mail. Then commit — "continuity wave 4: --stage 6, the pressure reap's OOM class".

---

### Task 3: `ccd-scope-sweep` — every dead ccd pane scope recorded, an inert one stopped only when armed

**Model routing:** `opus`, effort `xhigh` — the one new process-stop authority in the tree (spec §6).

**Files:**
- Create: `ccd/ccd-scope-sweep` (mode 755), `server/test/scope-sweep.test.ts`
- Modify: `server/test/single-definition.test.ts` (one describe appended — the file is cited by line)

**Interfaces:**
- Consumes: `systemctl --user list-units --no-legend --plain 'tmux-spawn-*.scope'`; `systemctl --user show <unit> -p Id
  -p Slice -p Description -p ControlGroup -p CPUUsageNSec -p MemoryCurrent -p ActiveEnterTimestampMonotonic`;
  `tmux list-panes -a -F '#{pid} #{pane_pid}'` on the default socket (ccd's server); `$CCRC_CGROUP_ROOT<ControlGroup>/
  cgroup.procs`; `$CCRC_PROC_ROOT/{uptime,<pid>/stat,<pid>/comm,<pid>/fd/*,net/tcp,net/tcp6,net/udp,net/udp6,net/unix}`;
  `$REG/scope-sweep-paused`, `$REG/scope-sweep-live` (`$REG` = `$HOME/.cc-sessions`); its own previous record.
- Produces: `$XDG_RUNTIME_DIR/ccd-scope-sweep.state`, rewritten by rename every tick — `# ccd-scope-sweep v1 tick=<epoch>
  mode=<shadow|live>`, then `dead <unit> first=<epoch> cpu0=<nsec> verdict=<report|would-stop|stopped|stop-failed>
  why=<none|predicate,…> server=<ccd|gone|reused> procs=<n> mem=<bytes|?> sockets=<n> youngest=<s> pids=<p,…>` per dead
  ccd scope and `old <unit> pid=<p> age=<s> comm=<word>` per long-lived process in a live one; at most one
  `systemctl --user stop --no-block <unit>` per inert scope per tick, and only when armed; a stdout line when a scope
  is first seen dead, first reaches `would-stop`, or is stopped; exit 1 with a named refusal on stderr when there is no
  runtime dir, no `/proc`, or no answer from `systemctl`.

**How it decides** (the script's header states each rule, and each is a red row below):
- **Whose scope.** Only units whose NAME is `tmux-spawn-*.scope` (re-checked after the list: `ccrc-tmux-server.scope`
  never passes), whose `Slice` is the session slice, and whose `Description` parses; a parse failure, an unreadable
  value or an unreadable `cgroup.procs` is UNMEASURABLE: the scope's previous line is carried unchanged and a scope
  never seen before gets none.
- **Whose server.** The server pid in the Description is `gone` when `/proc/<pid>` is absent; `reused` when that pid
  is not a `tmux: server` or started at or after the scope (ticks against `ActiveEnterTimestampMonotonic`
  microseconds — Pre-flight 5); `ccd` when it is the server `tmux list-panes -a` answers from; and any other live tmux
  server's scope is skipped outright, never recorded. When tmux answers nothing at all, no live server is ccd's, so
  only the scopes of a server that no longer runs are judged.
- **Dead.** A ccd scope is LIVE when any of its processes is a live pane of ccd's server (its line drops; its
  long-lived processes are listed instead); a `gone` or `reused` scope is dead.
- **Inert, then stopped.** First seen dead six hours ago or more, its `CPUUsageNSec` equal to the value then, its
  youngest process six hours old or more, no TCP/UDP socket and no listening Unix socket (`__SO_ACCEPTCON`, `0x10000`,
  in `/proc/net/unix`'s flags), and no child that its `cgroup.procs` does not hold. A `reused` scope is `report
  why=server-pid-reused`, never stopped. The stop needs `$REG/scope-sweep-live`; without it the verdict is
  `would-stop`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/scope-sweep.test.ts`:

<!-- replay: create server/test/scope-sweep.test.ts -->
```ts
// ccd-scope-sweep — dead ccd pane scopes reported, the inert ones stopped, and
// the stop SHADOWED until the operator arms it (session-continuity spec §5.6
// item 2; wave 4). Every run is a FIXTURE: CCRC_PROC_ROOT and CCRC_CGROUP_ROOT
// point at trees this file writes, `systemctl`, `tmux` and `getconf` are stubs
// on PATH that log what they are asked, and HOME and XDG_RUNTIME_DIR are
// fixture directories. No case reaches the live user manager, a real /proc or a
// real tmux server, so the suite runs on any platform. Each case is red when
// its guard is removed (the plan's mutation table is the measurement).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const SWEEP = path.resolve(__dirname, '../../ccd/ccd-scope-sweep');
const SLICE = 'app-claude\\x2dsession.slice';
const UP = 100 * 86400;                  // the fixture box has been up 100 days
const HOUR = 3600;
const CCD_SERVER = 2000;

interface Fx { base: string; home: string; xdg: string; proc: string; cg: string; bin: string }
let fx: Fx;

beforeEach(() => {
  const base = mkTmp('ccrc-scope-sweep-');
  fx = { base, home: path.join(base, 'home'), xdg: path.join(base, 'xdg'), proc: path.join(base, 'proc'), cg: path.join(base, 'cg'), bin: path.join(base, 'bin') };
  for (const d of [path.join(fx.home, '.cc-sessions'), fx.xdg, path.join(fx.proc, 'net'), fx.cg, fx.bin, path.join(base, 'show')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(fx.proc, 'uptime'), `${UP}.25 1234.00\n`);
  fs.writeFileSync(path.join(fx.proc, 'net', 'tcp'), '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n');
  for (const f of ['tcp6', 'udp', 'udp6']) fs.copyFileSync(path.join(fx.proc, 'net', 'tcp'), path.join(fx.proc, 'net', f));
  fs.writeFileSync(path.join(fx.proc, 'net', 'unix'), 'Num       RefCount Protocol Flags    Type St Inode Path\n');
  fs.writeFileSync(path.join(base, 'units'), '');
  const stub = (name: string, body: string): void => { fs.writeFileSync(path.join(fx.bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 }); };
  stub('systemctl', [
    `F=${JSON.stringify(base)}`,
    'echo "$*" >> "$F/calls"',
    '[ "$1" = --user ] || { echo "fixture systemctl: not --user: $*" >&2; exit 90; }',
    'case "$2" in',
    '  list-units) cat "$F/units"; exit 0 ;;',
    '  show) if [ -f "$F/show/$3" ]; then cat "$F/show/$3"; else printf "Id=%s\\nDescription=%s\\nSlice=\\nControlGroup=\\n" "$3" "$3"; fi; exit 0 ;;',
    '  stop) [ "$3" = --no-block ] || exit 91; [ -f "$F/stop-rc" ] && exit "$(cat "$F/stop-rc")"; exit 0 ;;',
    'esac',
    'echo "fixture systemctl: unexpected argv: $*" >&2; exit 90',
  ].join('\n'));
  stub('tmux', [
    `F=${JSON.stringify(base)}`,
    '[ "$1 $2" = "list-panes -a" ] || { echo "fixture tmux: unexpected argv: $*" >&2; exit 90; }',
    'if [ -f "$F/panes" ]; then cat "$F/panes"; exit 0; fi',
    'echo "no server running on /tmp/tmux-1000/default" >&2; exit 1',
  ].join('\n'));
  stub('getconf', '[ "$1" = CLK_TCK ] && { echo 100; exit 0; }; exit 1');
  server(CCD_SERVER, 10 * 86400);
  fs.writeFileSync(path.join(base, 'panes'), `${CCD_SERVER} 4242\n`);   // ccd's server is up, serving some other session's pane
});
afterEach(() => { removeTmpFixtures(); });

/** A process in the fixture /proc: started `age` seconds ago, in cgroup `cg`, holding `sockets` (inode numbers). */
function proc(pid: number, o: { age: number; comm?: string; ppid?: number; cg?: string; sockets?: number[]; fdUnreadable?: boolean }): void {
  const d = path.join(fx.proc, String(pid));
  fs.mkdirSync(path.join(d, 'fd'), { recursive: true });
  const comm = o.comm ?? 'node';
  const ticks = (UP - o.age) * 100;
  // `pid (comm) state ppid …` with the start time as field 22 — the comm carries a space and a paren, as real ones can
  fs.writeFileSync(path.join(d, 'stat'), `${pid} (${comm}) S ${o.ppid ?? 1} ${pid} ${pid} 0 -1 4194560 0 0 0 0 0 0 0 0 20 0 1 0 ${ticks} 1000 10 0\n`);
  fs.writeFileSync(path.join(d, 'comm'), `${comm}\n`);
  fs.writeFileSync(path.join(d, 'cgroup'), `0::${o.cg ?? '/elsewhere.scope'}\n`);
  (o.sockets ?? []).forEach((ino, i) => fs.symlinkSync(`socket:[${ino}]`, path.join(d, 'fd', String(10 + i))));
  fs.symlinkSync('/dev/null', path.join(d, 'fd', '0'));
  if (o.fdUnreadable) fs.chmodSync(path.join(d, 'fd'), 0o000);
}
function server(pid: number, age: number, comm = 'tmux: server'): void { proc(pid, { age, comm, cg: '/ccrc-tmux-server.scope' }); }
const cgOf = (unit: string): string => `/user.slice/user-1000.slice/user@1000.service/app.slice/${SLICE}/${unit}`;
const unitName = (n: number): string => `tmux-spawn-0000000${n}-0000-4000-8000-000000000000.scope`;

/** A pane scope: listed, shown, its cgroup holding `procs`. `bornAgo` dates its ActiveEnterTimestampMonotonic. */
function scope(n: number, o: {
  pane: number; server?: number; procs: number[]; cpu?: number; mem?: number; bornAgo?: number;
  slice?: string; desc?: string; unit?: string; noProcsFile?: boolean;
}): string {
  const u = o.unit ?? unitName(n);
  const cg = cgOf(u);
  fs.appendFileSync(path.join(fx.base, 'units'), `${u} loaded active running tmux child pane\n`);
  const mono = (UP - (o.bornAgo ?? 9 * 86400)) * 1_000_000 + 475_320;
  fs.writeFileSync(path.join(fx.base, 'show', u), [
    `Id=${u}`, `Slice=${o.slice ?? SLICE}`,
    `Description=${o.desc ?? `tmux child pane ${o.pane} launched by process ${o.server ?? CCD_SERVER}`}`,
    `ControlGroup=${cg}`, `CPUUsageNSec=${o.cpu ?? 7255660000}`, `MemoryCurrent=${o.mem ?? 20 * 2 ** 20}`,
    `ActiveEnterTimestampMonotonic=${mono}`,
  ].join('\n') + '\n');
  if (!o.noProcsFile) {
    fs.mkdirSync(path.join(fx.cg, cg), { recursive: true });
    fs.writeFileSync(path.join(fx.cg, cg, 'cgroup.procs'), o.procs.map((p) => `${p}\n`).join(''));
  }
  return u;
}
/** A dead ccd scope that passes every predicate, first seen seven hours ago with the same CPU it reads now. */
function inert(n: number, pid = 3000 + n): string {
  proc(pid, { age: 2 * 86400, cg: cgOf(unitName(n)) });
  const u = scope(n, { pane: pid, procs: [pid] });
  seen(u, 7 * HOUR, 7255660000);
  return u;
}
const STATE = (): string => path.join(fx.xdg, 'ccd-scope-sweep.state');
const seenLines: string[] = [];
function seen(u: string, ago: number, cpu: number, verdict = 'report'): void {
  const now = Math.floor(Date.now() / 1000);
  seenLines.push(`dead ${u} first=${now - ago} cpu0=${cpu} verdict=${verdict} why=dead-under-6h server=ccd procs=1 mem=1 sockets=0 youngest=1 pids=1`);
  fs.writeFileSync(STATE(), ['# ccd-scope-sweep v1 tick=1 mode=shadow', ...seenLines].join('\n') + '\n');
}
beforeEach(() => { seenLines.length = 0; });
const arm = (): void => fs.writeFileSync(path.join(fx.home, '.cc-sessions', 'scope-sweep-live'), '');
const livePanes = (...panes: number[]): void => fs.writeFileSync(path.join(fx.base, 'panes'), [4242, ...panes].map((p) => `${CCD_SERVER} ${p}\n`).join(''));

function run(env: Record<string, string | undefined> = {}): { code: number; out: string; err: string } {
  const r = spawnSync('bash', [SWEEP], {
    encoding: 'utf8',
    env: { PATH: `${fx.bin}:${process.env['PATH'] ?? ''}`, HOME: fx.home, XDG_RUNTIME_DIR: fx.xdg,
      CCRC_PROC_ROOT: fx.proc, CCRC_CGROUP_ROOT: fx.cg, LC_ALL: 'C', ...env },
  });
  return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const stops = (): string[] => (fs.existsSync(path.join(fx.base, 'calls')) ? fs.readFileSync(path.join(fx.base, 'calls'), 'utf8') : '')
  .split('\n').filter((l) => l.startsWith('--user stop'));
const rows = (kind: 'dead' | 'old'): Record<string, Record<string, string>> => {
  const out: Record<string, Record<string, string>> = {};
  if (!fs.existsSync(STATE())) return out;
  for (const l of fs.readFileSync(STATE(), 'utf8').split('\n')) {
    const p = l.split(' ');
    if (p[0] !== kind) continue;
    out[kind === 'dead' ? p[1]! : `${p[1]} ${p[2]}`] = Object.fromEntries(p.slice(2).map((kv) => kv.split('=') as [string, string]));
  }
  return out;
};

// ── THE STOP SHIPS SHADOWED ─────────────────────────────────────────────────

describe('the stop is shadowed: recorded `would-stop` until the operator arms scope-sweep-live', () => {
  it('a dead ccd scope inert for six hours, with no scope-sweep-live: would-stop, and NEVER a stop call', () => {
    const u = inert(1);
    const r = run();
    expect(r.code, r.err).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ verdict: 'would-stop', why: 'none', server: 'ccd', sockets: '0' });
    expect(stops()).toEqual([]);
    expect(fs.readFileSync(STATE(), 'utf8').split('\n')[0]).toMatch(/^# ccd-scope-sweep v1 tick=\d+ mode=shadow$/);
  });

  it('the same scope with scope-sweep-live: one `systemctl --user stop --no-block`, recorded `stopped`', () => {
    const u = inert(1); arm();
    expect(run().code).toBe(0);
    expect(stops()).toEqual([`--user stop --no-block ${u}`]);
    expect(rows('dead')[u]!['verdict']).toBe('stopped');
    expect(fs.readFileSync(STATE(), 'utf8').split('\n')[0]).toMatch(/ mode=live$/);
  });

  it('a stop systemd refuses is recorded `stop-failed`', () => {
    const u = inert(1); arm(); fs.writeFileSync(path.join(fx.base, 'stop-rc'), '1');
    run();
    expect(rows('dead')[u]!['verdict']).toBe('stop-failed');
  });

  it('scope-sweep-paused stops EVERYTHING: nothing measured, recorded or stopped, armed or not', () => {
    inert(1); arm();
    fs.writeFileSync(path.join(fx.home, '.cc-sessions', 'scope-sweep-paused'), '');
    const before = fs.readFileSync(STATE(), 'utf8');
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/paused/);
    expect(stops()).toEqual([]);
    expect(fs.existsSync(path.join(fx.base, 'calls')), 'not even a list-units').toBe(false);
    expect(fs.readFileSync(STATE(), 'utf8')).toBe(before);
  });
});

// ── EACH PREDICATE ──────────────────────────────────────────────────────────

describe('each stop predicate, one at a time — the scope is reported, never stopped', () => {
  const reportedFor = (u: string, why: string): void => {
    arm();
    expect(run().code).toBe(0);
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report' });
    expect(rows('dead')[u]!['why']!.split(',')).toContain(why);
    expect(stops()).toEqual([]);
  };

  it('first seen dead NOW: its clock starts, and it says so once', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] });
    arm();
    const r = run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'dead-under-6h' });
    expect(Number(rows('dead')[u]!['first'])).toBeGreaterThan(Date.now() / 1000 - 60);
    expect(r.out).toContain(`${u} is dead`);
    expect(stops()).toEqual([]);
  });

  it('dead for five hours, not six', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 5 * HOUR, 7255660000);
    reportedFor(u, 'dead-under-6h');
  });

  it('its CPU moved since it was first seen dead', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001], cpu: 7255660001 }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'cpu-moved');
  });

  it('a process in it started in the last six hours', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) }); proc(3002, { age: 5 * HOUR, cg: cgOf(unitName(1)), ppid: 3001 });
    const u = scope(1, { pane: 3001, procs: [3001, 3002] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'process-started-under-6h');
  });

  it('a process in it holds a TCP socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'tcp'), '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 424242 1 0000000000000000 100 0 0 10 0\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [424242] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'socket');
  });

  it('a process in it holds a UDP socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'udp6'), '   0: 00000000000000000000000000000000:14E9 00000000000000000000000000000000:0000 07 00000000:00000000 00:00000000 00000000  1000        0 525252 2 0000000000000000 0\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [525252] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'socket');
  });

  it('a process in it holds a LISTENING Unix socket', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'unix'), '0000000000000000: 00000002 00000000 00010000 0001 01 626262 /tmp/server.sock\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [626262] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'socket');
  });

  it('control: a CONNECTED Unix socket (a client of something) does not hold it — would-stop', () => {
    fs.appendFileSync(path.join(fx.proc, 'net', 'unix'), '0000000000000000: 00000003 00000000 00000000 0001 03 727272\n');
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), sockets: [727272] });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'would-stop', sockets: '0' });
  });

  it('a process in it is the parent of a process in another cgroup', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    proc(3999, { age: 2 * 86400, ppid: 3001, cg: '/user.slice/user-1000.slice/user@1000.service/app.slice/mekwar-ddb.service' });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    reportedFor(u, 'parent-of-a-process-elsewhere');
  });

  it('control: a child in the SAME scope is not elsewhere — would-stop', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) }); proc(3002, { age: 2 * 86400, ppid: 3001, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001, 3002] }); seen(u, 7 * HOUR, 7255660000);
    run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'would-stop' });
  });
});

// ── WHAT THE SWEEP MUST NEVER STOP (the coordinator's ruling D) ─────────────

describe('what the sweep never stops, armed and inert or not', () => {
  it('ccd\'s own ccrc-tmux-server.scope, even listed with a pane Description: never recorded, never stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf('ccrc-tmux-server.scope') });
    const u = scope(1, { pane: 3001, procs: [3001], unit: 'ccrc-tmux-server.scope' }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(Object.keys(rows('dead'))).toEqual([]);
    expect(stops()).toEqual([]);
  });

  it('a scope whose Description does not parse is unmeasurable: its old line is carried, nothing stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001], desc: `${unitName(1)}` }); seen(u, 7 * HOUR, 7255660000);
    const line = seenLines[0]!;
    arm(); run();
    expect(fs.readFileSync(STATE(), 'utf8').split('\n')).toContain(line);
    expect(stops()).toEqual([]);
  });

  it('a scope of a LIVE tmux server that is not ccd\'s: never recorded, never stopped', () => {
    server(5000, 30 * 86400);
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, server: 5000, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it('a scope with a live pane of ccd\'s server is LIVE: its old entry drops, nothing stopped', () => {
    const u = inert(1); livePanes(3001);
    arm(); run();
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it('a scope whose server pid now names a process that started AFTER the scope: reported server-pid-reused, never stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    server(5000, 3 * 86400);                                        // a tmux server — but younger than the scope (born 9 days ago)
    const u = scope(1, { pane: 3001, server: 5000, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'server-pid-reused', server: 'reused' });
    expect(stops()).toEqual([]);
  });

  it('a scope whose server pid now names a process that is not a tmux server: reported, never stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    proc(5000, { age: 30 * 86400, comm: 'node' });
    const u = scope(1, { pane: 3001, server: 5000, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'server-pid-reused' });
    expect(stops()).toEqual([]);
  });

  it('ccd\'s server pid itself, recycled after the scope was born: reported, never stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001], bornAgo: 20 * 86400 }); seen(u, 7 * HOUR, 7255660000);
    livePanes(4242);                                                // ccd's server (born 10 days ago) is up, with other panes
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'server-pid-reused' });
    expect(stops()).toEqual([]);
  });

  it('a scope outside the session slice is not the sweep\'s', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, procs: [3001], slice: 'app.slice' }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it('with no ccd server answering (tmux: no server running), a scope of a server that still RUNS is not ccd\'s to judge', () => {
    fs.rmSync(path.join(fx.base, 'panes'));
    const u = inert(1);
    arm(); run();
    expect(rows('dead')[u]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it('control: a scope of a server that no longer runs IS ccd\'s, and an inert one is stopped when armed', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)) });
    const u = scope(1, { pane: 3001, server: 7777, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'stopped', server: 'gone' });
    expect(stops()).toEqual([`--user stop --no-block ${u}`]);
  });
});

// ── UNMEASURABLE SKIPS; LIVE RESETS ─────────────────────────────────────────

describe('a predicate it cannot measure skips the scope for the tick; a live scope resets its clock', () => {
  it('an fd directory it cannot read: the old line is carried unchanged, and nothing is stopped', () => {
    proc(3001, { age: 2 * 86400, cg: cgOf(unitName(1)), fdUnreadable: true });
    const u = scope(1, { pane: 3001, procs: [3001] }); seen(u, 7 * HOUR, 7255660000);
    const line = seenLines[0]!;
    arm();
    try { run(); } finally { fs.chmodSync(path.join(fx.proc, '3001', 'fd'), 0o755); }
    expect(fs.readFileSync(STATE(), 'utf8').split('\n')).toContain(line);
    expect(stops()).toEqual([]);
  });

  it('a cgroup.procs it cannot read: carried, nothing stopped — and a scope never seen before records nothing', () => {
    const u = scope(1, { pane: 3001, procs: [3001], noProcsFile: true }); seen(u, 7 * HOUR, 7255660000);
    const v = scope(2, { pane: 3002, procs: [3002], noProcsFile: true });
    const line = seenLines[0]!;
    arm(); run();
    expect(fs.readFileSync(STATE(), 'utf8').split('\n')).toContain(line);
    expect(rows('dead')[v]).toBeUndefined();
    expect(stops()).toEqual([]);
  });

  it('a scope seen live drops its entry, so it dies again from zero', () => {
    const u = inert(1);
    livePanes(3001); run();
    expect(rows('dead')[u]).toBeUndefined();
    fs.writeFileSync(path.join(fx.base, 'panes'), `${CCD_SERVER} 9999\n`);   // the pane is gone again
    arm(); run();
    expect(rows('dead')[u]).toMatchObject({ verdict: 'report', why: 'dead-under-6h' });
    expect(stops()).toEqual([]);
  });

  it('with no XDG_RUNTIME_DIR it refuses: no clock can run, nothing is stopped', () => {
    inert(1); arm();
    const r = run({ XDG_RUNTIME_DIR: undefined });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/no-runtime-dir/);
    expect(stops()).toEqual([]);
  });
});

// ── DOCTOR'S LONG-LIVED PROCESSES IN A LIVE PANE SCOPE ──────────────────────

describe('the record lists every process older than a day in a live pane scope, but the pane\'s own and its MCP servers', () => {
  it('a background shell two hours after the pane, older than a day: listed; the pane and an MCP server (and its child) are not', () => {
    const u = unitName(1); const cg = cgOf(u);
    proc(3001, { age: 3 * 86400, comm: 'claude', cg });                         // the pane's own process
    proc(3002, { age: 3 * 86400 - 30, ppid: 3001, comm: 'npm exec mcp', cg });  // an MCP server: 30 s after the pane
    proc(3003, { age: 3 * 86400 - 30, ppid: 3002, comm: 'node', cg });          // its child
    proc(3004, { age: 3 * 86400 - 2 * HOUR, ppid: 3001, comm: 'bash', cg });    // a background shell, 2 h later
    proc(3005, { age: 3 * HOUR, ppid: 3001, comm: 'sleep', cg });               // younger than a day
    scope(1, { pane: 3001, procs: [3001, 3002, 3003, 3004, 3005] });
    livePanes(3001);
    run();
    expect(Object.keys(rows('old'))).toEqual([`${u} pid=3004`]);
    expect(rows('old')[`${u} pid=3004`]).toMatchObject({ comm: 'bash' });
    expect(rows('dead')[u]).toBeUndefined();
  });
});
```

And the no-writer pin for the arming file (ruling C), appended:

In `server/test/single-definition.test.ts`, append at the end of the file:

<!-- replay: append server/test/single-definition.test.ts -->
```ts

// SESSION-CONTINUITY WAVE 4 (spec §5.6, the coordinator's safety ruling). APPENDED, for the reason the stall-watch
// blocks above state: `session-hook.test.ts`'s citation audit cites this file by line.
describe('the pane-scope sweep: its arming file has no writer in the tree', () => {
  // `scope-sweep-live` arms `ccd-scope-sweep`'s stop: without it every inert scope is only recorded `would-stop`.
  // Like `stall-watch-live` the operator touches and removes it by hand, so the ONE line of shell that may name
  // it is the sweep's own read, and no TypeScript names it at all. KNOWN WIDTH: a name assembled from pieces is
  // not seen; the bar is the ordinary copy.
  it('scope-sweep-live: one shell holder, ccd/ccd-scope-sweep, whose one line is a read; no TS holder', () => {
    expect(holdersOf('scope-sweep-live'), 'a line of shell other than the sweep names it — a writer in waiting').toEqual(['ccd/ccd-scope-sweep']);
    expect(codeLines(path.join(ccrcRoot, 'ccd', 'ccd-scope-sweep')).filter((l) => l.includes('scope-sweep-live')))
      .toEqual(['[ -e "$REG/scope-sweep-live" ] && MODE=live']);
    expect(ALL.filter((f) => stallCode(f).includes('scope-sweep-live')).map(rel)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/scope-sweep.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/single-definition.test.ts -t 'arming file' --maxWorkers=1
```

Expected: `26 failed | 3 passed (29)` — the three that pass assert only that nothing is recorded or stopped (outside
the slice; another live tmux server; no ccd server answering), each measured red by its row instead (3.5, 3.7, 3.24);
then `1 failed | 274 skipped (275)`.

- [ ] **Step 3: The sweep**

Create `ccd/ccd-scope-sweep`:

<!-- replay: create ccd/ccd-scope-sweep -->
```bash
#!/usr/bin/env bash
# ccd-scope-sweep — report every dead ccd pane scope, and stop only the inert
# ones (session-continuity spec §5.6 item 2, ruling C11). A oneshot on its own
# one-minute timer (ccd-scope-sweep.timer) BESIDE ccd-cap-scopes, never inside
# it: a slow stop or a fault here must never delay capping a new scope.
#
# WHY. Every ccd pane runs in its own transient `tmux-spawn-<uuid>.scope` under
# the session slice, and its processes stay there after the pane is gone — a
# test server, a probe, a watcher a session started and forgot. Measured on
# 2026-09-23: 12 scopes whose pane was gone, holding 32 processes and 1.32 GB,
# among them a DynamoDB Local server 27 days old. Nothing collected any of it.
#
# WHAT IT READS — ONLY pane scopes, and only ccd's:
#   * the `tmux-spawn-*.scope` units `systemctl --user list-units` names, each
#     name checked again here (a list that ever returned another unit — ccd's
#     own `ccrc-tmux-server.scope` sits in the same slice — must not reach the
#     rest), whose `Slice` is the session slice and whose `Description` parses
#     as `tmux child pane <pid> launched by process <pid>`. Any other scope is
#     outside the sweep: never recorded, never stopped. A Description that does
#     not parse is UNMEASURABLE.
#   * every value from `systemctl --user show` (`ControlGroup`, `CPUUsageNSec`,
#     `MemoryCurrent`, `ActiveEnterTimestampMonotonic`) — the cgroup path is
#     ASKED FOR, never built from a string: building it is what left
#     ccd-cap-scopes capping nothing for 13 days (that script's own header).
#   * the scope's `cgroup.procs`, and /proc for each process: its start, its
#     parent, its open sockets.
#
# DEAD, AND CCD'S. A scope is DEAD when none of its processes is a live pane of
# the tmux server its Description names. It is CCD'S when that server is ccd's
# current one (the server `tmux list-panes -a` on the default socket answers
# from) or a tmux server that no longer runs — checked by pid, by `comm` (`tmux:
# server`) and by a start EARLIER than the scope's, so a recycled pid never
# passes for the server that launched the pane. A scope of any OTHER live tmux
# server is never touched and never recorded (its panes are not ccd's to ask
# about). A server pid that now names another process, or a process that
# started after the scope, is `server-pid-reused`: the scope is reported, never
# stopped.
#
# THE STOP — every predicate, in order (spec §5.6):
#   1. first seen dead at least SCOPE_SWEEP_DEAD_SEC (six hours) ago;
#   2. its CPUUsageNSec has not moved since it was first seen dead;
#   3. no process in it started in the last six hours;
#   4. no process in it holds a TCP or UDP socket, or a LISTENING Unix socket;
#   5. no process in it is the parent of a process in another cgroup;
#   6. no live handoff record names one of its processes — Claude Code's native
#      adopt record, if the stage-2 spike makes native handoff primary. None
#      exists before stage 3 (the stage-3 launch record carries run and agent
#      ids, never a pid), so this predicate is satisfied by construction and has
#      no code until then;
#   7. `$REG/scope-sweep-paused` is absent — checked first of all: a paused
#      sweep does NOTHING, shadow verdicts and the record included.
# A predicate it cannot measure (a value systemd does not report, a cgroup or a
# /proc entry it cannot read) SKIPS that scope for the tick and records nothing
# new: the scope's previous verdict line is carried unchanged. A scope seen LIVE
# drops its entry, so its clock starts again from zero the next time it dies.
#
# SHADOWED (wave 4's safety ruling). A scope that passes every predicate is
# recorded `would-stop`, and `systemctl --user stop --no-block` is issued ONLY
# when `$REG/scope-sweep-live` exists. NOTHING IN THIS TREE WRITES THAT FILE —
# the operator arms the stop by hand, as with stall-watch-live, and
# `single-definition.test.ts` pins that no line of shell other than this file's
# one read names it. A reboot empties $XDG_RUNTIME_DIR and with it every
# first-seen clock, which is the safe direction.
#
# THE VERDICT RECORD, `$XDG_RUNTIME_DIR/ccd-scope-sweep.state`, rewritten whole
# by rename every tick: a header `# ccd-scope-sweep v1 tick=<epoch> mode=<shadow|live>`,
# one `dead` line per dead ccd scope (first seen, CPU then, verdict, why,
# server, processes, memory, sockets, youngest process, pids), and one `old`
# line per process older than a day in a LIVE pane scope that is neither the
# pane's own process nor one of its Claude Code's MCP servers (a direct child
# of the pane's process started within SCOPE_SWEEP_MCP_SEC of it, and that
# child's descendants). `ccrc doctor` READS this record and never re-derives it.
#
# OUTPUT. Silent on an ordinary tick; one line when a scope is first seen dead,
# first reaches `would-stop`, or is stopped. Refusals go to stderr, exit 1.
#
# FIXTURE SEAMS, the doctor's own names: CCRC_PROC_ROOT (default /proc) and
# CCRC_CGROUP_ROOT (default /sys/fs/cgroup); `systemctl` and `tmux` are found
# on PATH, so a test stubs both. No knob shortens the six hours.
#
# PORTABILITY. Linux-only by product shape — its only runner is a systemd
# timer, which `_inst_units`' Darwin arm never installs — but written to pass
# macos-platform.test.ts's GNU-spelling scan, and to run against a fixture root
# on any platform: no `stat -c`, no `date -d`, no bare `timeout`, no flock (a
# oneshot unit never runs twice at once; a manual run beside the timer can only
# issue a stop twice, which systemd treats as one, and the record lands by rename).
# A wedged tmux server would hold the `list-panes` below: the unit's
# TimeoutStartSec is the deadline.
set -uo pipefail

REG="$HOME/.cc-sessions"
PAUSE="$REG/scope-sweep-paused"
PROC="${CCRC_PROC_ROOT:-/proc}"
CGROOT="${CCRC_CGROUP_ROOT:-/sys/fs/cgroup}"
SLICE='app-claude\x2dsession.slice'
SCOPE_SWEEP_DEAD_SEC=21600    # six hours: first seen dead -> the earliest stop, and the youngest process a stop allows
SCOPE_SWEEP_OLD_SEC=86400     # a process older than a day in a LIVE pane scope is listed for doctor
SCOPE_SWEEP_MCP_SEC=120       # a direct child of the pane's Claude Code started this soon after it is one of its MCP servers
DESC_RE='^tmux child pane ([0-9]+) launched by process ([0-9]+)$'

_ss_die() { echo "scope-sweep: $*" >&2; exit 1; }

[ -e "$PAUSE" ] && { echo "scope-sweep: paused ($PAUSE exists) — nothing measured, nothing recorded, nothing stopped"; exit 0; }
[ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "$XDG_RUNTIME_DIR" ] \
  || _ss_die "no-runtime-dir: \$XDG_RUNTIME_DIR is unset or not a directory, so there is nowhere to keep the verdict record and no clock can run — nothing stopped"
STATE="$XDG_RUNTIME_DIR/ccd-scope-sweep.state"
read -r UP _ < "$PROC/uptime" 2>/dev/null || _ss_die "no-proc: $PROC/uptime is not readable, so no process can be dated"
UP="${UP%%.*}"
[[ "$UP" =~ ^[0-9]+$ ]] || _ss_die "no-proc: $PROC/uptime does not read as seconds"
TCK=$(getconf CLK_TCK 2>/dev/null) || TCK=100
[[ "$TCK" =~ ^[1-9][0-9]*$ ]] || TCK=100
NOW=$(date +%s)
MODE=shadow
# The ONE read of the arming file, here and nowhere else in the tree (single-definition.test.ts).
[ -e "$REG/scope-sweep-live" ] && MODE=live

# ── the previous record: first-seen clocks, the CPU then, lines to carry ─────
declare -A FIRST=() CPU0=() PREV=() PREVV=()
if [ -r "$STATE" ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^dead\ (tmux-spawn-[^ ]+\.scope)\ first=([0-9]+)\ cpu0=([0-9]+)\ verdict=([a-z-]+) ]] || continue
    FIRST[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}; CPU0[${BASH_REMATCH[1]}]=${BASH_REMATCH[3]}
    PREVV[${BASH_REMATCH[1]}]=${BASH_REMATCH[4]}; PREV[${BASH_REMATCH[1]}]="$line"
  done < "$STATE"
fi

# ── /proc readers: a process's start (ticks since boot), its age, its parent ──
declare -A TICKS=() PARENT=()
_ss_stat() {   # pid -> TICKS[pid], PARENT[pid]; rc 1 unreadable. Fork-free: it runs per process per tick.
  local s rest
  local -a f
  [[ -n "${TICKS[$1]+x}" ]] && return 0
  { s=$(<"$PROC/$1/stat"); } 2>/dev/null || return 1
  rest="${s##*) }"                       # past `pid (comm) `: a comm may hold spaces and parentheses
  read -r -a f <<<"$rest"
  [[ "${f[1]:-}" =~ ^[0-9]+$ && "${f[19]:-}" =~ ^[0-9]+$ ]] || return 1
  PARENT[$1]=${f[1]}; TICKS[$1]=${f[19]}
  return 0
}
_ss_age() { echo $(( UP - TICKS[$1] / TCK )); }          # seconds; the caller ran _ss_stat
_ss_comm() { local c; { IFS= read -r c < "$PROC/$1/comm"; } 2>/dev/null || return 1; printf '%s' "$c"; }

# ── ccd's tmux server and its live panes ──────────────────────────────────────
# Any failure (no server, a deleted socket, no tmux) leaves SERVER empty: then no
# LIVE server is ccd's, and only the scopes of a server that no longer runs can
# be dead and ccd's — the safe direction for every reading.
SERVER=""
declare -A PANE=()
if out=$(tmux list-panes -a -F '#{pid} #{pane_pid}' 2>/dev/null); then
  while read -r spid ppid; do
    [[ "$spid" =~ ^[0-9]+$ && "$ppid" =~ ^[0-9]+$ ]] || continue
    SERVER=$spid; PANE[$ppid]=1
  done <<<"$out"
fi

# ── sockets, read once and only when some scope is dead and ccd's ─────────────
declare -A INET=() LISTEN=()
SOCKS_READ=0
_ss_sockets() {   # rc 1 unmeasurable
  local f ino flags
  local -a a
  (( SOCKS_READ )) && return 0
  for f in tcp tcp6 udp udp6; do
    [ -r "$PROC/net/$f" ] || return 1
    while read -r -a a; do [[ "${a[9]:-}" =~ ^[0-9]+$ ]] && INET[${a[9]}]=1; done < "$PROC/net/$f"
  done
  [ -r "$PROC/net/unix" ] || return 1
  while read -r _ _ _ flags _ _ ino _; do   # Num RefCount Protocol Flags Type St Inode Path
    [[ "$ino" =~ ^[0-9]+$ && "$flags" =~ ^[0-9A-Fa-f]+$ ]] || continue
    (( (16#$flags & 0x10000) != 0 )) && LISTEN[$ino]=1    # __SO_ACCEPTCON: a LISTENING Unix socket
  done < "$PROC/net/unix"
  SOCKS_READ=1
}
_ss_socket_count() {   # pid... -> the TCP/UDP and listening Unix sockets they hold; rc 1 unmeasurable
  local p fd t n=0
  for p in "$@"; do
    [ -d "$PROC/$p/fd" ] && [ -r "$PROC/$p/fd" ] && [ -x "$PROC/$p/fd" ] || return 1
    for fd in "$PROC/$p/fd"/*; do
      t=$(readlink "$fd" 2>/dev/null) || continue
      [[ "$t" =~ ^socket:\[([0-9]+)\]$ ]] || continue
      [[ -n "${INET[${BASH_REMATCH[1]}]+x}" || -n "${LISTEN[${BASH_REMATCH[1]}]+x}" ]] && n=$((n + 1))
    done
  done
  printf '%s' "$n"
}

# ── every process on the box and its parent, read once for predicate 5 ───────
BOX_READ=0
_ss_box() { local d; (( BOX_READ )) && return 0; for d in "$PROC"/[0-9]*; do _ss_stat "${d##*/}" || :; done; BOX_READ=1; }

# ── the scopes ────────────────────────────────────────────────────────────────
units=$(systemctl --user list-units --no-legend --plain 'tmux-spawn-*.scope' 2>/dev/null) \
  || _ss_die "systemctl --user list-units did not answer, so no pane scope can be listed"
OUT=() SAID=()
declare -A P=() MINE=()
_ss_carry() { [[ -n "${PREV[$u]+x}" ]] && OUT+=("${PREV[$u]}"); return 0; }   # unmeasurable: the old line, unchanged
while read -r u _; do
  [[ "$u" == tmux-spawn-*.scope ]] || continue        # ONLY pane scopes: ccrc-tmux-server.scope never passes
  P=()
  while IFS='=' read -r k v; do [[ -n "$k" ]] && P[$k]="$v"; done < <(systemctl --user show "$u" -p Id -p Slice \
    -p Description -p ControlGroup -p CPUUsageNSec -p MemoryCurrent -p ActiveEnterTimestampMonotonic 2>/dev/null)
  [[ "${P[Slice]:-}" == "$SLICE" ]] || continue       # outside the session slice: not the sweep's
  [[ "${P[Description]:-}" =~ $DESC_RE ]] || { _ss_carry; continue; }   # a Description that does not parse: unmeasurable
  pane=${BASH_REMATCH[1]} server=${BASH_REMATCH[2]}
  cg="${P[ControlGroup]:-}" cpu="${P[CPUUsageNSec]:-}" mono="${P[ActiveEnterTimestampMonotonic]:-}"
  mem="${P[MemoryCurrent]:-}"; [[ "$mem" =~ ^[0-9]+$ ]] || mem='?'
  [[ "$cg" == /*"/$u" && "$cpu" =~ ^[0-9]+$ && "$mono" =~ ^[1-9][0-9]*$ ]] || { _ss_carry; continue; }
  procs=()
  { mapfile -t procs < "$CGROOT$cg/cgroup.procs"; } 2>/dev/null || { _ss_carry; continue; }
  (( ${#procs[@]} )) || { _ss_carry; continue; }
  # WHOSE SERVER: by pid, comm, and a start EARLIER than the scope's (microseconds since boot, both)
  if [[ ! -e "$PROC/$server" ]]; then state=gone
  else
    _ss_stat "$server" || { _ss_carry; continue; }
    comm=$(_ss_comm "$server") || { _ss_carry; continue; }
    if [[ "$comm" != "tmux: server" ]] || (( TICKS[$server] * (1000000 / TCK) >= mono )); then state=reused
    elif [[ "$server" == "$SERVER" ]]; then state=ccd
    else continue                                       # another LIVE tmux server's pane: never touched, never recorded
    fi
  fi
  live=0
  if [[ "$state" == ccd ]]; then for p in "${procs[@]}"; do [[ -n "${PANE[$p]+x}" ]] && live=1; done; fi
  if (( live )); then
    # LIVE: its dead entry drops. Doctor's listing: every process older than a day
    # but the pane's own and its Claude Code's MCP servers (a direct child of the
    # pane started within SCOPE_SWEEP_MCP_SEC of it, and that child's descendants).
    _ss_stat "$pane" || :
    for p in "${procs[@]}"; do
      [[ "$p" == "$pane" ]] && continue
      _ss_stat "$p" || continue
      x=$p mcp=0
      while _ss_stat "$x"; do
        if [[ "${PARENT[$x]}" == "$pane" ]]; then
          [[ -n "${TICKS[$pane]+x}" ]] && (( (TICKS[$x] - TICKS[$pane]) / TCK <= SCOPE_SWEEP_MCP_SEC )) && mcp=1
          break
        fi
        [[ "${PARENT[$x]}" =~ ^[1-9][0-9]*$ && "${PARENT[$x]}" != "$x" ]] || break
        x=${PARENT[$x]}
      done
      (( mcp )) && continue
      age=$(_ss_age "$p")
      (( age >= SCOPE_SWEEP_OLD_SEC )) || continue
      c=$(_ss_comm "$p") || c='?'
      OUT+=("old $u pid=$p age=$age comm=${c// /_}")
    done
    continue
  fi
  # DEAD. Every predicate measured; any one that cannot be carries the old line.
  youngest=-1 bad=0
  for p in "${procs[@]}"; do
    _ss_stat "$p" || { bad=1; break; }
    a=$(_ss_age "$p"); (( youngest < 0 || a < youngest )) && youngest=$a
  done
  (( bad )) && { _ss_carry; continue; }
  _ss_sockets || { _ss_carry; continue; }
  socks=$(_ss_socket_count "${procs[@]}") || { _ss_carry; continue; }
  _ss_box
  MINE=(); for p in "${procs[@]}"; do MINE[$p]=1; done
  elsewhere=0
  for q in "${!PARENT[@]}"; do   # a child of one of its processes that its cgroup.procs does not hold lives in another cgroup
    [[ -n "${MINE[${PARENT[$q]}]+x}" && -z "${MINE[$q]+x}" ]] && elsewhere=1
  done
  first=${FIRST[$u]:-$NOW} cpu0=${CPU0[$u]:-$cpu}
  why=()
  if [[ "$state" == reused ]]; then why+=(server-pid-reused)
  else
    (( NOW - first >= SCOPE_SWEEP_DEAD_SEC )) || why+=(dead-under-6h)
    [[ "$cpu" == "$cpu0" ]] || why+=(cpu-moved)
    (( youngest >= SCOPE_SWEEP_DEAD_SEC )) || why+=(process-started-under-6h)
    (( socks == 0 )) || why+=(socket)
    (( elsewhere == 0 )) || why+=(parent-of-a-process-elsewhere)
  fi
  if (( ${#why[@]} )); then verdict=report
  elif [[ "$MODE" == live ]]; then
    if systemctl --user stop --no-block "$u" 2>/dev/null; then verdict=stopped; else verdict=stop-failed; fi
  else verdict=would-stop
  fi
  w="${why[*]:-none}" pl="${procs[*]}"
  OUT+=("dead $u first=$first cpu0=$cpu0 verdict=$verdict why=${w// /,} server=$state procs=${#procs[@]} mem=$mem sockets=$socks youngest=$youngest pids=${pl// /,}")
  if [[ -z "${PREV[$u]+x}" ]]; then SAID+=("scope-sweep: $u is dead, its server $state, ${#procs[@]} process(es): first seen now")
  elif [[ "$verdict" != report && "$verdict" != "${PREVV[$u]:-}" ]]; then SAID+=("scope-sweep: $u $verdict — dead since $first, ${#procs[@]} process(es), its CPU unmoved, no socket, nothing elsewhere")
  fi
done <<<"$units"

tmp=$(mktemp "$STATE.XXXXXX") || _ss_die "cannot write beside $STATE"
{ echo "# ccd-scope-sweep v1 tick=$NOW mode=$MODE"; (( ${#OUT[@]} )) && printf '%s\n' "${OUT[@]}"; } > "$tmp"
mv -f "$tmp" "$STATE" || { rm -f "$tmp"; _ss_die "cannot write $STATE"; }
(( ${#SAID[@]} )) && printf '%s\n' "${SAID[@]}"
exit 0
```

```bash
chmod 755 ccd/ccd-scope-sweep && bash -n ccd/ccd-scope-sweep && git add ccd/ccd-scope-sweep && git ls-files -s ccd/ccd-scope-sweep
```

Expected: `100755 … ccd/ccd-scope-sweep` — tracked executable, as `ccd/ccd-tmp-sweep` and `ccd/ccd-cap-scopes` are
(a `create` block carries bytes, not a mode).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/scope-sweep.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/macos-platform.test.ts test/single-definition.test.ts --maxWorkers=1
```

Expected: `29 passed (29)`; then `126 passed | 11 skipped (137)` for the platform scan with the sweep suite, and `single-definition` green.

- [ ] **Step 5: Mutation check, then commit**

`scope-sweep.test.ts` run alone at `--maxWorkers=1` for every row but 3.25 (`single-definition.test.ts -t 'arming file'`).

| # | File | Exact edit (old → new) | Measured red on the full prototype (of 29) |
|---|---|---|---|
| 3.1 | `ccd/ccd-scope-sweep` | `[ -e "$REG/scope-sweep-live" ] && MODE=live` → `MODE=live` | 3 failed: “a dead ccd scope inert for six hours, with no scope-sweep-live: would-stop, and NEVER a stop call”; “control: a CONNECTED Unix socket … — would-stop”; “control: a child in the SAME scope is not elsewhere — would-stop” |
| 3.2 | `ccd/ccd-scope-sweep` | `if systemctl --user stop --no-block "$u" 2>/dev/null; then verdict=stopped;` → `if true; then verdict=stopped;` | 3 failed: “the same scope with scope-sweep-live: one `systemctl --user stop --no-block`, recorded `stopped`”; “a stop systemd refuses is recorded `stop-failed`”; “control: a scope of a server that no longer runs IS ccd's, and an inert one is stopped when armed” |
| 3.3b | `ccd/ccd-scope-sweep` | `[ -e "$PAUSE" ] && { echo` → `[ -e "$PAUSE" ] && false && { echo` | 1 failed: “scope-sweep-paused stops EVERYTHING: nothing measured, recorded or stopped, armed or not” |
| 3.4 | `ccd/ccd-scope-sweep` | `  [[ "$u" == tmux-spawn-*.scope ]] \|\| continue` → `  :` | 1 failed: “ccd's own ccrc-tmux-server.scope, even listed with a pane Description: never recorded, never stopped” |
| 3.5 | `ccd/ccd-scope-sweep` | `  [[ "${P[Slice]:-}" == "$SLICE" ]] \|\| continue` → `  :` | 1 failed: “a scope outside the session slice is not the sweep's” |
| 3.6 | `ccd/ccd-scope-sweep` | `DESC_RE='^tmux child pane ([0-9]+) launched by process ([0-9]+)$'` → `DESC_RE='([0-9]+)[^0-9]+([0-9]+)'` | 1 failed: “a scope whose Description does not parse is unmeasurable: its old line is carried, nothing stopped” |
| 3.7 | `ccd/ccd-scope-sweep` | `else continue   # another LIVE …` → `else state=gone   # another LIVE …` | 2 failed: “a scope of a LIVE tmux server that is not ccd's: never recorded, never stopped”; “with no ccd server answering (tmux: no server running), a scope of a server that still RUNS is not ccd's to judge” |
| 3.8 | `ccd/ccd-scope-sweep` | ` \|\| (( TICKS[$server] * (1000000 / TCK) >= mono )); then state=reused` → `; then state=reused` | 2 failed: “a scope whose server pid now names a process that started AFTER the scope: reported server-pid-reused, never stopped”; “ccd's server pid itself, recycled after the scope was born: reported, never stopped” |
| 3.9 | `ccd/ccd-scope-sweep` | `if [[ "$comm" != "tmux: server" ]] \|\| ` → `if ` | 1 failed: “a scope whose server pid now names a process that is not a tmux server: reported, never stopped” |
| 3.10 | `ccd/ccd-scope-sweep` | `[[ -n "${PANE[$p]+x}" ]] && live=1` → `:` | 3 failed: “a scope with a live pane of ccd's server is LIVE: its old entry drops, nothing stopped”; “a scope seen live drops its entry, so it dies again from zero”; “a background shell two hours after the pane, older than a day: listed; …” |
| 3.11 | `ccd/ccd-scope-sweep` | `(( NOW - first >= SCOPE_SWEEP_DEAD_SEC )) \|\| why+=(dead-under-6h)` → (nothing) | 3 failed: “first seen dead NOW: its clock starts, and it says so once”; “dead for five hours, not six”; “a scope seen live drops its entry, so it dies again from zero” |
| 3.12 | `ccd/ccd-scope-sweep` | `[[ "$cpu" == "$cpu0" ]] \|\| why+=(cpu-moved)` → (nothing) | 1 failed: “its CPU moved since it was first seen dead” |
| 3.13 | `ccd/ccd-scope-sweep` | `(( youngest >= SCOPE_SWEEP_DEAD_SEC )) \|\| why+=(process-started-under-6h)` → (nothing) | 1 failed: “a process in it started in the last six hours” |
| 3.14 | `ccd/ccd-scope-sweep` | `(( socks == 0 )) \|\| why+=(socket)` → (nothing) | 3 failed: “a process in it holds a TCP socket”; “… a UDP socket”; “… a LISTENING Unix socket” |
| 3.15 | `ccd/ccd-scope-sweep` | `(( (16#$flags & 0x10000) != 0 )) && LISTEN[$ino]=1` → `LISTEN[$ino]=1` | 1 failed: “control: a CONNECTED Unix socket (a client of something) does not hold it — would-stop” |
| 3.16 | `ccd/ccd-scope-sweep` | `for f in tcp tcp6 udp udp6; do` → `for f in tcp tcp6; do` | 1 failed: “a process in it holds a UDP socket” |
| 3.17 | `ccd/ccd-scope-sweep` | `(( elsewhere == 0 )) \|\| why+=(parent-of-a-process-elsewhere)` → (nothing) | 1 failed: “a process in it is the parent of a process in another cgroup” |
| 3.18 | `ccd/ccd-scope-sweep` | ` && -z "${MINE[$q]+x}" ]] && elsewhere=1` → ` ]] && elsewhere=1` | 1 failed: “control: a child in the SAME scope is not elsewhere — would-stop” |
| 3.19 | `ccd/ccd-scope-sweep` | `[ -d "$PROC/$p/fd" ] && [ -r "$PROC/$p/fd" ] && [ -x "$PROC/$p/fd" ] \|\| return 1` → `:` | 1 failed: “an fd directory it cannot read: the old line is carried unchanged, and nothing is stopped” |
| 3.20 | `ccd/ccd-scope-sweep` | `_ss_carry() { [[ -n "${PREV[$u]+x}" ]] && OUT+=("${PREV[$u]}"); return 0; }` → `_ss_carry() { return 0; }` | 3 failed: “a scope whose Description does not parse is unmeasurable…”; “an fd directory it cannot read…”; “a cgroup.procs it cannot read: carried, nothing stopped — and a scope never seen before records nothing” |
| 3.21 | `ccd/ccd-scope-sweep` | `[ -n "${XDG_RUNTIME_DIR:-}" ] && [ -d "$XDG_RUNTIME_DIR" ] \` → `: \` | 1 failed: “with no XDG_RUNTIME_DIR it refuses: no clock can run, nothing is stopped” |
| 3.22 | `ccd/ccd-scope-sweep` | `(( mcp )) && continue` → (nothing) | 1 failed: “a background shell two hours after the pane, older than a day: listed; the pane and an MCP server (and its child) are not” |
| 3.23 | `ccd/ccd-scope-sweep` | `[[ "$p" == "$pane" ]] && continue` → (nothing) | 1 failed: “″” |
| 3.24 | `ccd/ccd-scope-sweep` | `elif [[ "$server" == "$SERVER" ]]; then state=ccd` → `elif [[ -z "$SERVER" \|\| "$server" == "$SERVER" ]]; then state=ccd` | 1 failed: “with no ccd server answering (tmux: no server running), a scope of a server that still RUNS is not ccd's to judge” |
| 3.25 | `ccd/ccd-cap-scopes` | `capped=0` → `capped=0 / : > "$HOME/.cc-sessions/scope-sweep-live"` (a second shell line naming the file) | `single-definition.test.ts -t 'arming file'`: 1 failed: “scope-sweep-live: one shell holder, ccd/ccd-scope-sweep, whose one line is a read; no TS holder” |

Then commit — "continuity wave 4: ccd-scope-sweep, shadowed until the operator arms it".

---
### Task 4: The sweep ships where the temp-dir reaper ships — units, install, uninstall, the agent lane

**Model routing:** `sonnet`, effort `high` — the reaper's pattern, file for file (Pre-flight 9).

**Files:**
- Create: `deploy/systemd/ccd-scope-sweep.service`, `deploy/systemd/ccd-scope-sweep.timer`
- Modify: `ccd/ccrc` — `_inst_bins` (≈14133, and its two transcript lines ≈14156–14158), `_inst_units` (≈14742),
  `_inst_enable` (≈15178), the uninstall unit loop and `rm` (≈22509, ≈22535), the orphan scan's own-binary case
  (≈22870), `_uninst_tree_bins`' comment, `rm` and transcript line (≈23041–23090), at `d12b5aba0`
- Modify: `deploy/deploy.sh` (its agent lane: the bin, the unit pair, the enable), `deploy/gen-wrappers.mjs`
  (`TOOLCHAIN_EXECUTABLES` and its comment), `shared/lifecycle.ts` (one class)
- Test: `server/test/installTreeFixture.ts`, `server/test/ccrc-install.test.ts`, `server/test/ccrc-uninstall.test.ts`,
  `server/test/lifecycle.test.ts`, `agent/test/deploy-verify.test.ts`

**Interfaces:**
- Consumes: Task 3's `ccd/ccd-scope-sweep`; the reaper's install gates.
- Produces: `$HOME/.local/bin/ccd-scope-sweep` on every non-Darwin role; `ccd-scope-sweep.{service,timer}` in the unit
  dir and the timer enabled (degrading, never dying) on `fleet` and `both`, never on `server`; both removed by
  `ccrc uninstall`; `deploy.sh agent` installing and enabling the same; the lifecycle class `scope-sweep-verdicts`.

The unit's `TimeoutStartSec=45` is the deadline for the one call that can block (`tmux list-panes` against a wedged
server); `MemoryMax=256M` and `Nice=10` for `ccd-cap-scopes`' own reason. The timer is `OnActiveSec=2min`,
`OnUnitActiveSec=60s`: armed by a deploy on a box up for days, a boot-relative first elapse would already be past
(the reaper timer's reason).

- [ ] **Step 1: Write the failing tests**

In `server/test/installTreeFixture.ts`, find:

<!-- replay: replace server/test/installTreeFixture.ts -->
```ts
  'ccd/ccd-tmp-sweep',
```

and replace it with:

```ts
  'ccd/ccd-tmp-sweep',
  // The pane-scope sweep (session-continuity wave 4), shipped by `_inst_bins` on
  // the same non-Darwin, every-ROLE arm as the reaper above.
  'ccd/ccd-scope-sweep',
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts

  it('the launcher is BYTE FOR BYTE what deploy.sh generates', () => {
```

and replace it with:

```ts

  itLinux('ccd-scope-sweep lands beside it too (the pane-scope sweep) — every role, but not Darwin', () => {
    // Mirrors the reaper's case above: its only runner is a systemd timer and it
    // reads /proc and cgroups. Its UNIT and ENABLE are role-gated (server skips both).
    const { home } = installed;
    const bin = join(home, '.local', 'bin', 'ccd-scope-sweep');
    expect(readFileSync(bin)).toEqual(readFileSync(placed(home, 'ccd', 'ccd-scope-sweep')));
    expect(mode(bin)).toBe(0o755);
  });

  it('the launcher is BYTE FOR BYTE what deploy.sh generates', () => {
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
  ['ccd-tmp-sweep.timer', 'deploy/systemd/ccd-tmp-sweep.timer'],
```

and replace it with:

```ts
  ['ccd-tmp-sweep.timer', 'deploy/systemd/ccd-tmp-sweep.timer'],
  // The pane-scope sweep: ROLE-GATED on the reaper's terms — a server box runs no pane scopes.
  ['ccd-scope-sweep.service', 'deploy/systemd/ccd-scope-sweep.service'],
  ['ccd-scope-sweep.timer', 'deploy/systemd/ccd-scope-sweep.timer'],
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
      // degrade-rather-than-die idiom as the two sweeps above it.
      '--user enable --now ccd-tmp-sweep.timer',
      '--user enable --now ccd-account-health.timer',
```

and replace it with:

```ts
      // degrade-rather-than-die idiom as the two sweeps above it.
      '--user enable --now ccd-tmp-sweep.timer',
      '--user enable --now ccd-scope-sweep.timer',
      '--user enable --now ccd-account-health.timer',
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
           'ccd-pool-sync', 'ccd-telemetry-keepalive', 'ccd-tmp-sweep', 'ccd-update-sync', 'ccd-usage-sweep',
```

and replace it with:

```ts
           'ccd-pool-sync', 'ccd-scope-sweep', 'ccd-telemetry-keepalive', 'ccd-tmp-sweep', 'ccd-update-sync', 'ccd-usage-sweep',
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
    expect(argv).toContain('--user enable --now ccd-tmp-sweep.timer');
```

and replace it with:

```ts
    expect(argv).toContain('--user enable --now ccd-tmp-sweep.timer');
    // and the pane-scope sweep, on the reaper's gate.
    expect(argv).toContain('--user enable --now ccd-scope-sweep.timer');
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
      '--user enable --now ccd-usage-sweep.timer',
      '--user enable --now ccd-tmp-sweep.timer',
      '--user enable --now ccd-account-health.timer',
```

and replace it with:

```ts
      '--user enable --now ccd-usage-sweep.timer',
      '--user enable --now ccd-tmp-sweep.timer',
      '--user enable --now ccd-scope-sweep.timer',
      '--user enable --now ccd-account-health.timer',
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
        || dest.startsWith('ccd-tmp-sweep.') || dest.startsWith('ccrc-codex-usage@')) continue;
```

and replace it with:

```ts
        || dest.startsWith('ccd-tmp-sweep.') || dest.startsWith('ccd-scope-sweep.') || dest.startsWith('ccrc-codex-usage@')) continue;
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
    expect(existsSync(unitDir(home, 'ccd-tmp-sweep.timer'))).toBe(false);
```

and replace it with:

```ts
    expect(existsSync(unitDir(home, 'ccd-tmp-sweep.timer'))).toBe(false);
    // The pane-scope sweep: a server box runs no pane scopes.
    expect(existsSync(unitDir(home, 'ccd-scope-sweep.service'))).toBe(false);
    expect(existsSync(unitDir(home, 'ccd-scope-sweep.timer'))).toBe(false);
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-tmp-sweep');
```

and replace it with:

```ts
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-tmp-sweep');
    expect(systemctlCalls(home).map((c) => c.argv).join('\n')).not.toContain('ccd-scope-sweep');
```

In `server/test/ccrc-uninstall.test.ts`, find:

<!-- replay: replace server/test/ccrc-uninstall.test.ts -->
```ts
  writeFileSync(join(bin, 'ccd-tmp-sweep'), '#!/bin/sh\n# tmp sweep\n', { mode: 0o755 });
```

and replace it with:

```ts
  writeFileSync(join(bin, 'ccd-tmp-sweep'), '#!/bin/sh\n# tmp sweep\n', { mode: 0o755 });
  // The pane-scope sweep, placed by `_inst_bins` on the same non-Darwin arm.
  writeFileSync(join(bin, 'ccd-scope-sweep'), '#!/bin/sh\n# scope sweep\n', { mode: 0o755 });
```

In `server/test/ccrc-uninstall.test.ts`, find:

<!-- replay: replace server/test/ccrc-uninstall.test.ts -->
```ts
    'ccd-tmp-sweep.service', 'ccd-tmp-sweep.timer',
```

and replace it with:

```ts
    'ccd-tmp-sweep.service', 'ccd-tmp-sweep.timer',
    'ccd-scope-sweep.service', 'ccd-scope-sweep.timer',
```

In `server/test/ccrc-uninstall.test.ts`, find:

<!-- replay: replace server/test/ccrc-uninstall.test.ts -->
```ts
    expect(calls).toContain('--user disable --now ccd-tmp-sweep.timer');
```

and replace it with:

```ts
    expect(calls).toContain('--user disable --now ccd-tmp-sweep.timer');
    expect(calls).toContain('--user disable --now ccd-scope-sweep.timer');
```

In `server/test/ccrc-uninstall.test.ts`, find:

<!-- replay: replace server/test/ccrc-uninstall.test.ts -->
```ts
      'ccd-usage-sweep.py', 'ccd-account-health', 'ccd-tmp-sweep',
```

and replace it with:

```ts
      'ccd-usage-sweep.py', 'ccd-account-health', 'ccd-tmp-sweep', 'ccd-scope-sweep',
```

In `server/test/lifecycle.test.ts`, find:

<!-- replay: replace server/test/lifecycle.test.ts -->
```ts
  });
  it('declares project-pool-tag, and it is a collector-less class with an operator ruling', () => {
```

and replace it with:

```ts
  });
  it('declares the pane-scope sweep\'s verdict record, a rolling class its own writer rewrites', () => {
    // Session-continuity wave 4: `ccd-scope-sweep` keeps one record in the
    // runtime dir, and `ccrc doctor` reads it. An unassigned artifact class is a
    // defect (policy §1.2), so it is declared the day it ships.
    const c = LIFECYCLE.find((x) => x.name === 'scope-sweep-verdicts');
    expect(c, 'shared/lifecycle.ts declares no scope-sweep-verdicts class').toBeTruthy();
    expect(c!.pattern).toBe('R');
    expect(c!.creators).toEqual(['ccd-scope-sweep']);
    expect(c!.root).toBe('$XDG_RUNTIME_DIR/ccd-scope-sweep.state');
  });
  it('declares project-pool-tag, and it is a collector-less class with an operator ruling', () => {
```

In `agent/test/deploy-verify.test.ts`, find:

<!-- replay: replace agent/test/deploy-verify.test.ts -->
```ts
      'systemd/ccd-tmp-sweep.timer',
```

and replace it with:

```ts
      'systemd/ccd-tmp-sweep.timer',
      // The pane-scope sweep's pair (session-continuity wave 4), shipped the same way.
      'systemd/ccd-scope-sweep.service',
      'systemd/ccd-scope-sweep.timer',
```

In `agent/test/deploy-verify.test.ts`, find:

<!-- replay: replace agent/test/deploy-verify.test.ts -->
```ts
      'the temp-dir reaper is not in the repo').toBe(true);
```

and replace it with:

```ts
      'the temp-dir reaper is not in the repo').toBe(true);
    expect(existsSync(path.join(deployDir, '..', 'ccd', 'ccd-scope-sweep')),
      'the pane-scope sweep is not in the repo').toBe(true);
```

In `agent/test/deploy-verify.test.ts`, find:

<!-- replay: replace agent/test/deploy-verify.test.ts -->
```ts
      '_unit_atomic ~/ccrc/deploy/systemd/ccd-tmp-sweep.timer ~/.config/systemd/user/ccd-tmp-sweep.timer',
```

and replace it with:

```ts
      '_unit_atomic ~/ccrc/deploy/systemd/ccd-tmp-sweep.timer ~/.config/systemd/user/ccd-tmp-sweep.timer',
      // The pane-scope sweep's pair, installed the same way.
      '_unit_atomic ~/ccrc/deploy/systemd/ccd-scope-sweep.service ~/.config/systemd/user/ccd-scope-sweep.service',
      '_unit_atomic ~/ccrc/deploy/systemd/ccd-scope-sweep.timer ~/.config/systemd/user/ccd-scope-sweep.timer',
```

In `agent/test/deploy-verify.test.ts`, find:

<!-- replay: replace agent/test/deploy-verify.test.ts -->
```ts
    expect(tmpSweepTimerAt, 'the tmp-sweep timer is never enabled').toBeGreaterThan(reloadAt);
```

and replace it with:

```ts
    expect(tmpSweepTimerAt, 'the tmp-sweep timer is never enabled').toBeGreaterThan(reloadAt);
    // The pane-scope sweep's timer, on the same daemon-reload.
    const scopeSweepTimerAt = restartLinks.findIndex((l) => l.includes('enable --now ccd-scope-sweep.timer'));
    expect(scopeSweepTimerAt, 'the scope-sweep timer is never enabled').toBeGreaterThan(reloadAt);
```

In `agent/test/deploy-verify.test.ts`, find:

<!-- replay: replace agent/test/deploy-verify.test.ts -->
```ts
    expect(deploySh).toContain('install_atomic ccd/ccd-tmp-sweep .local/bin/ccd-tmp-sweep 755');
```

and replace it with:

```ts
    expect(deploySh).toContain('install_atomic ccd/ccd-tmp-sweep .local/bin/ccd-tmp-sweep 755');
    expect(deploySh).toContain('install_atomic ccd/ccd-scope-sweep .local/bin/ccd-scope-sweep 755');
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/lifecycle.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccrc-install.test.ts -t "ccd-scope-sweep lands|^ccrc install: the unit directory|^ccrc install --role" --maxWorkers=1
cd ../agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts --maxWorkers=1
```

Expected: (each test file at this task, the code at Task 3's tree) `ccrc-uninstall` `2 failed | 77 passed | 4 skipped (83)` (the unit-file census and the executables case); `lifecycle` `1 failed | 51 passed (52)`; `ccrc-install`'s three filters `6 failed | 27 passed | 281 skipped (314)` (the new bins case, the unit-file and enable-order cases, and the fleet and `--role both` units); `deploy-verify` `1 failed | 74 passed (75)`.

- [ ] **Step 3: The units, the install spine, the agent lane, the toolchain set and the lifecycle class**

Create `deploy/systemd/ccd-scope-sweep.service`:

<!-- replay: create deploy/systemd/ccd-scope-sweep.service -->
```ini
[Unit]
Description=Report dead ccd pane scopes and stop only the inert ones (shadowed until ~/.cc-sessions/scope-sweep-live)
[Service]
Type=oneshot
ExecStart=%h/.local/bin/ccd-scope-sweep
# The deadline for the one call that can block: `tmux list-panes` against a
# wedged server. A tick that outlives it is killed and the next one starts
# clean — the record lands by rename, so a killed tick leaves the last one.
TimeoutStartSec=45
# bash over /proc and the unit list: the working set is a few hundred small
# reads. Capped for ccd-cap-scopes' own reason — a reaper must never be the
# thing that OOMs the fleet host.
MemoryMax=256M
Nice=10
```

Create `deploy/systemd/ccd-scope-sweep.timer`:

<!-- replay: create deploy/systemd/ccd-scope-sweep.timer -->
```ini
[Unit]
Description=Sweep dead ccd pane scopes every minute, beside ccd-cap-scopes
[Timer]
# Its OWN timer, never ccd-cap-scopes': a slow stop or a fault here must never
# delay capping a new scope (session-continuity spec §5.6). `OnActiveSec=`, not
# `OnBootSec=`, for ccd-tmp-sweep.timer's reason: armed by a deploy on a box up
# for days, a boot-relative first elapse is already past and would fire at once,
# on top of the deploy's own supervisor sweep.
OnActiveSec=2min
OnUnitActiveSec=60s
AccuracySec=10s
[Install]
WantedBy=timers.target
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
    _inst_atomic "$tree/ccd/ccd-tmp-sweep" "$bin/ccd-tmp-sweep" 755
```

and replace it with:

```bash
    _inst_atomic "$tree/ccd/ccd-tmp-sweep" "$bin/ccd-tmp-sweep" 755
    # The pane-scope sweep (session-continuity wave 4; its own header has the
    # dead-scope census), on the temp-dir reaper's exact terms — every role,
    # systemd only: its only runner is a timer, and it reads /proc and cgroups.
    # `deploy/gen-wrappers.mjs`'s `TOOLCHAIN_EXECUTABLES` knows the name, or the
    # orphan scan in `_inst_wrappers` (every role) would report it.
    _inst_atomic "$tree/ccd/ccd-scope-sweep" "$bin/ccd-scope-sweep" 755
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
    echo "install: bins: ccd, ccd-account-auth${lane_bins} and the ccrc launcher in \$HOME/.local/bin${lane_note} (no ccd-cap-scopes — it caps cgroup scopes, and macOS has none; no ccd-graph-sweep, no ccd-account-health, no ccd-telemetry-keepalive, no ccd-usage-sweep, no ccd-tmp-sweep, no ccd-pool-sync and no ccd-update-sync — their timers are systemd-only)"
  else
    echo "install: bins: ccd, ccd-account-auth, ccd-cap-scopes, ccd-graph-sweep, ccd-account-health, ccd-telemetry-keepalive, ccd-usage-sweep, ccd-tmp-sweep, ccd-pool-sync, ccd-update-sync${lane_bins} and the ccrc launcher in \$HOME/.local/bin${lane_note}"
```

and replace it with:

```bash
    echo "install: bins: ccd, ccd-account-auth${lane_bins} and the ccrc launcher in \$HOME/.local/bin${lane_note} (no ccd-cap-scopes — it caps cgroup scopes, and macOS has none; no ccd-graph-sweep, no ccd-account-health, no ccd-telemetry-keepalive, no ccd-usage-sweep, no ccd-tmp-sweep, no ccd-scope-sweep, no ccd-pool-sync and no ccd-update-sync — their timers are systemd-only)"
  else
    echo "install: bins: ccd, ccd-account-auth, ccd-cap-scopes, ccd-graph-sweep, ccd-account-health, ccd-telemetry-keepalive, ccd-usage-sweep, ccd-tmp-sweep, ccd-scope-sweep, ccd-pool-sync, ccd-update-sync${lane_bins} and the ccrc launcher in \$HOME/.local/bin${lane_note}"
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
    _inst_atomic "$tree/deploy/systemd/ccd-tmp-sweep.timer" "$dir/ccd-tmp-sweep.timer" 644
```

and replace it with:

```bash
    _inst_atomic "$tree/deploy/systemd/ccd-tmp-sweep.timer" "$dir/ccd-tmp-sweep.timer" 644
    # The pane-scope sweep's pair, role-gated for its own reason rather than by
    # imitation: it reads the pane scopes Claude Code sessions run in, and a
    # server box runs none — there is no pane scope on it to sweep.
    _inst_atomic "$tree/deploy/systemd/ccd-scope-sweep.service" "$dir/ccd-scope-sweep.service" 644
    _inst_atomic "$tree/deploy/systemd/ccd-scope-sweep.timer" "$dir/ccd-scope-sweep.timer" 644
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
  [ "$INST_ROLE" = server ] || _inst_enable_timer tmp-sweep ccd-tmp-sweep.timer
```

and replace it with:

```bash
  [ "$INST_ROLE" = server ] || _inst_enable_timer tmp-sweep ccd-tmp-sweep.timer
  # Same gate as its unit files (a server box runs no pane scopes), and the same
  # DEGRADE-rather-than-die idiom: collecting dead scopes is housekeeping — and
  # shadowed until the operator arms it — not the guardrail `ccd-cap-scopes.timer` is.
  [ "$INST_ROLE" = server ] || _inst_enable_timer scope-sweep ccd-scope-sweep.timer
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
      ccd-tmp-sweep.timer ccd-tmp-sweep.service \
```

and replace it with:

```bash
      ccd-tmp-sweep.timer ccd-tmp-sweep.service \
      ccd-scope-sweep.timer ccd-scope-sweep.service \
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
    "$dir/ccd-tmp-sweep.service" "$dir/ccd-tmp-sweep.timer" \
```

and replace it with:

```bash
    "$dir/ccd-tmp-sweep.service" "$dir/ccd-tmp-sweep.timer" \
    "$dir/ccd-scope-sweep.service" "$dir/ccd-scope-sweep.timer" \
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
    case "$name" in ccd|ccrc|ccd-cap-scopes|ccd-graph-sweep|ccd-account-health|ccd-telemetry-keepalive|ccd-account-auth|ccd-usage-sweep|ccd-tmp-sweep|ccd-pool-sync|ccd-update-sync|ccgpt-runtime|ccrc-codex) continue ;; esac
```

and replace it with:

```bash
    case "$name" in ccd|ccrc|ccd-cap-scopes|ccd-graph-sweep|ccd-account-health|ccd-telemetry-keepalive|ccd-account-auth|ccd-usage-sweep|ccd-tmp-sweep|ccd-scope-sweep|ccd-pool-sync|ccd-update-sync|ccgpt-runtime|ccrc-codex) continue ;; esac
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
  # `ccd-tmp-sweep` (the temp-dir reaper), `ccd-pool-sync` (account-pool-membership wave 1, Task 4 fix round 1 (F4):
```

and replace it with:

```bash
  # `ccd-tmp-sweep` (the temp-dir reaper), `ccd-scope-sweep` (the pane-scope sweep), `ccd-pool-sync` (account-pool-membership wave 1, Task 4 fix round 1 (F4):
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
    "$HOME/.local/bin/ccd-tmp-sweep" "$HOME/.local/bin/ccd-pool-sync" \
```

and replace it with:

```bash
    "$HOME/.local/bin/ccd-tmp-sweep" "$HOME/.local/bin/ccd-scope-sweep" "$HOME/.local/bin/ccd-pool-sync" \
```

In `ccd/ccrc`, find:

<!-- replay: replace ccd/ccrc -->
```bash
  echo "uninstall: tree: ~/ccrc removed; ccd, ccd-cap-scopes, ccd-graph-sweep, ccd-account-health, ccd-telemetry-keepalive, ccd-account-auth, ccd-usage-sweep, ccd-usage-sweep.py, ccd-tmp-sweep, ccd-pool-sync, ccd-update-sync, ccgpt-proxy.py, ccgpt-usage.py, ccgpt-runtime, ccrc-codex and the ccrc launcher removed from \$HOME/.local/bin, and ccd's body from \$HOME/.local/libexec/ccrc; the completed-install record and the node's update state (~/.ccrc/previous, install-step, update.json, update.lock, update-intent) removed$vsaid$msaid$nsaid"
```

and replace it with:

```bash
  echo "uninstall: tree: ~/ccrc removed; ccd, ccd-cap-scopes, ccd-graph-sweep, ccd-account-health, ccd-telemetry-keepalive, ccd-account-auth, ccd-usage-sweep, ccd-usage-sweep.py, ccd-tmp-sweep, ccd-scope-sweep, ccd-pool-sync, ccd-update-sync, ccgpt-proxy.py, ccgpt-usage.py, ccgpt-runtime, ccrc-codex and the ccrc launcher removed from \$HOME/.local/bin, and ccd's body from \$HOME/.local/libexec/ccrc; the completed-install record and the node's update state (~/.ccrc/previous, install-step, update.json, update.lock, update-intent) removed$vsaid$msaid$nsaid"
```

In `deploy/deploy.sh`, find:

<!-- replay: replace deploy/deploy.sh -->
```bash
  install_atomic ccd/ccd-tmp-sweep .local/bin/ccd-tmp-sweep 755
```

and replace it with:

```bash
  install_atomic ccd/ccd-tmp-sweep .local/bin/ccd-tmp-sweep 755
  # The pane-scope sweep (session-continuity wave 4), beside the reaper and on
  # its terms; its stop is shadowed until ~/.cc-sessions/scope-sweep-live exists.
  install_atomic ccd/ccd-scope-sweep .local/bin/ccd-scope-sweep 755
```

In `deploy/deploy.sh`, find:

<!-- replay: replace deploy/deploy.sh -->
```bash
    && _unit_atomic ~/ccrc/deploy/systemd/ccd-tmp-sweep.timer ~/.config/systemd/user/ccd-tmp-sweep.timer \
```

and replace it with:

```bash
    && _unit_atomic ~/ccrc/deploy/systemd/ccd-tmp-sweep.timer ~/.config/systemd/user/ccd-tmp-sweep.timer \
    && _unit_atomic ~/ccrc/deploy/systemd/ccd-scope-sweep.service ~/.config/systemd/user/ccd-scope-sweep.service \
    && _unit_atomic ~/ccrc/deploy/systemd/ccd-scope-sweep.timer ~/.config/systemd/user/ccd-scope-sweep.timer \
```

In `deploy/deploy.sh`, find:

<!-- replay: replace deploy/deploy.sh -->
```bash
    && systemctl --user enable --now ccd-tmp-sweep.timer \
```

and replace it with:

```bash
    && systemctl --user enable --now ccd-tmp-sweep.timer \
    && systemctl --user enable --now ccd-scope-sweep.timer \
```

In `deploy/gen-wrappers.mjs`, find:

<!-- replay: replace deploy/gen-wrappers.mjs -->
```js
 *
 *  AND THE CLAUSE ORDER, stated correctly here because three paragraphs above
```

and replace it with:

```js
 *
 *  `ccd-scope-sweep`, the pane-scope sweep (session-continuity wave 4), joins
 *  on `ccd-tmp-sweep`'s terms: non-Darwin only, timer-run, no marker.
 *
 *  AND THE CLAUSE ORDER, stated correctly here because three paragraphs above
```

In `deploy/gen-wrappers.mjs`, find:

<!-- replay: replace deploy/gen-wrappers.mjs -->
```js
  'ccd-telemetry-keepalive', 'ccd-account-auth', 'ccd-usage-sweep', 'ccd-pool-sync', 'ccd-tmp-sweep', 'ccd-update-sync',
```

and replace it with:

```js
  'ccd-telemetry-keepalive', 'ccd-account-auth', 'ccd-usage-sweep', 'ccd-pool-sync', 'ccd-tmp-sweep', 'ccd-scope-sweep', 'ccd-update-sync',
```

In `shared/lifecycle.ts`, find:

<!-- replay: replace shared/lifecycle.ts -->
```ts
    bound: 'session lifetime + 7 days', tier: '138G uncollected on the fleet host 2026-09-22; single task .output files 1-4G', ruling: null },
```

and replace it with:

```ts
    bound: 'session lifetime + 7 days', tier: '138G uncollected on the fleet host 2026-09-22; single task .output files 1-4G', ruling: null },
  // Session-continuity wave 4: the pane-scope sweep's verdict record. Rolling (R):
  // rewritten whole by rename every tick, so it holds only the scopes dead NOW;
  // it lives in the runtime dir, so a reboot empties it — the safe direction for
  // the first-seen clocks it keeps.
  { name: 'scope-sweep-verdicts', root: '$XDG_RUNTIME_DIR/ccd-scope-sweep.state', pattern: 'R',
    creators: ['ccd-scope-sweep'], collector: 'ccd-scope-sweep (rewritten whole each minute; emptied by a reboot)',
    bound: 'the scopes dead at the last tick', tier: 'one line per dead pane scope and per process older than a day in a live one',
    ruling: null },
```

```bash
git add deploy/systemd/ccd-scope-sweep.service deploy/systemd/ccd-scope-sweep.timer   # install-census reads TRACKED sources only
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-uninstall.test.ts test/install-census.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/lifecycle.test.ts test/gen-wrappers.test.ts test/graph-noise-ship.test.ts test/usage-sweep-deploy-ship.test.ts --maxWorkers=1
# ccrc-install.test.ts in its four slices (Task 8 Step 2 spells them), one call each
cd ../agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts --maxWorkers=1
```

Expected: `101 passed | 4 skipped (105)`; `97 passed (97)`; the four `ccrc-install` slices green; `deploy-verify` `75 passed (75)`.

- [ ] **Step 5: Mutation check, then commit**

| # | File | Exact edit (old → new) | Suite | Measured red on the full prototype |
|---|---|---|---|---|
| 4.1 | `ccd/ccrc` | `_inst_bins`' `_inst_atomic "$tree/ccd/ccd-scope-sweep" "$bin/ccd-scope-sweep" 755` → (nothing) | `ccrc-install -t 'ccd-scope-sweep lands beside it too'` | 1 failed (of 1): “ccd-scope-sweep lands beside it too (the pane-scope sweep) — every role, but not Darwin” |
| 4.2 | `ccd/ccrc` | `_inst_units`' two `ccd-scope-sweep.{service,timer}` lines → (nothing) | `ccrc-install -t 'the units, and the one this box must not be given'` | 2 failed | 16 passed: “installs 20 unit files and 2 drop-ins, byte for byte, at 644”; “reloads and enables in that order, and only after every unit file landed” |
| 4.3 | `ccd/ccrc` | `[ "$INST_ROLE" = server ] \|\| _inst_enable_timer scope-sweep ccd-scope-sweep.timer` → (nothing) | `… -t 'the units, and the one this box must not be given\|^ccrc install --role'` | 3 failed | 29 passed: “reloads and enables in that order…”; “enables and restarts the AGENT unit, and never asks systemd about ccrc.service”; “--role both is byte-identical to a plain install — same units, same calls, no agent.env” |
| 4.4 | `ccd/ccrc` | the same line → `_inst_enable_timer scope-sweep ccd-scope-sweep.timer` (no role gate) | `… -t '^ccrc install --role'` | 1 failed | 13 passed: “--role server is today's spine minus nothing — the difference from both is reserved” |
| 4.5 | `ccd/ccrc` | the uninstall loop's `ccd-scope-sweep.timer ccd-scope-sweep.service \` → (nothing) | `ccrc-uninstall.test.ts` | 1 failed | 78 passed: “units: every unit file the box had goes — read off the fixture, which must plant all of _inst_units — …” |
| 4.6 | `ccd/ccrc` | the uninstall `rm`'s `"$dir/ccd-scope-sweep.service" "$dir/ccd-scope-sweep.timer" \` → (nothing) | ″ | 1 failed | 78 passed: ″ |
| 4.7 | `ccd/ccrc` | `_uninst_tree_bins`' ` "$HOME/.local/bin/ccd-scope-sweep"` → (nothing) | ″ | 1 failed | 78 passed: “the tree and the executables go; ~/.ccrc, worktrees and backups are PRESERVED without --purge” |
| 4.8 | `deploy/gen-wrappers.mjs` | `'ccd-tmp-sweep', 'ccd-scope-sweep', ` → `'ccd-tmp-sweep', ` | `install-census.test.ts`; `gen-wrappers.test.ts` | 1 failed | 21 passed: “every id-shaped name _inst_bins places is in TOOLCHAIN_EXECUTABLES, and the Set names nothing _inst_bins does not place”; 1 failed | 30 passed: “not an orphan: ccrc's OWN executables, which the installer puts in the same dir (…)” |
| 4.9 | `ccd/ccrc` | the orphan case's `\|ccd-tmp-sweep\|ccd-scope-sweep\|ccd-pool-sync\|` → `\|ccd-tmp-sweep\|ccd-pool-sync\|` | `install-census.test.ts` | 1 failed | 21 passed: “_uninst_wrappers' exclusion case names exactly the id-shaped names _inst_bins places” |
| 4.10 | `shared/lifecycle.ts` | `name: 'scope-sweep-verdicts'` → `name: 'scope-sweep-verdictz'` | `lifecycle.test.ts` | 1 failed | 51 passed: “declares the pane-scope sweep's verdict record, a rolling class its own writer rewrites” |
| 4.11 | `deploy/deploy.sh` | `install_atomic ccd/ccd-scope-sweep .local/bin/ccd-scope-sweep 755` → (nothing) | `agent/test/deploy-verify.test.ts` | 1 failed | 74 passed: “the agent deploy installs every systemd artifact the fleet host actually runs” |
| 4.12 | `deploy/deploy.sh` | AGENT_BUILD_CMD's `&& _unit_atomic … ccd-scope-sweep.timer … \` → (nothing) | ″ | 1 failed | 74 passed: ″ |
| 4.13 | `deploy/deploy.sh` | AGENT_CMD's `&& systemctl --user enable --now ccd-scope-sweep.timer \` → (nothing) | ″ | 1 failed | 74 passed: ″ |

Then commit — "continuity wave 4: the sweep's units, install and uninstall, on the reaper's pattern".

---

### Task 5: Doctor reads the verdict record

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `ccd/ccrc-doctor-checks` — the check table's `scopes` line (one name added, line-neutral), `_check_services`'
  `known` line (one name, line-neutral), one `why` case, one sentence in `_check_services`' design comment
  (line-neutral), and `_check_scope-sweep` APPENDED at the end of the file
- Test: `server/test/ccrc-doctor.test.ts` (`doctorEnv`'s seam, `healthy()`'s record, `HEALTHY_SKIPS` on macOS, one
  describe appended), `server/test/ccrc-install.test.ts` (`BASE_LIVE_SHAPE`, Pre-flight 11)

**Interfaces:**
- Consumes: the record Task 3 writes, at `${CCRC_SCOPE_SWEEP_STATE:-${XDG_RUNTIME_DIR:-/run/user/<uid>}/ccd-scope-sweep.state}`
  (the variable is the test seam, `CCRC_CADDY_SYSTEM_FILE`'s shape); `BOX_ENV_FILE`'s `CCRC_ROLE`.
- Produces: `scope-sweep` — SKIP on Darwin, on a `server`-role box, and with no record; WARN on a record that is not
  v1, on a tick older than `CCRC_SCOPE_SWEEP_STALE_S` (300 s), and on any `dead` or `old` line (each listed: unit, age,
  processes, MiB, sockets, its server, verdict and why — or pid, comm and hours); PASS otherwise, naming the record's
  age and mode. `services` names `ccd-scope-sweep.timer` in `known`, with its own consequence. Never FAIL: a dead scope
  is a runtime fact, and `ccrc install` ends with doctor (`_check_scopes`' argument).

It asks nothing of systemd or `/proc` about scopes: the sweep's verdict is the one its stop acts on, and two readers
deriving "dead" twice is how they come to disagree. A missing record is a SKIP, never a WARN: a fresh install arms the
timer two minutes before its first tick and a reboot empties the runtime dir — which is also why the timer joins
`known` (only `known` sees a timer that never ran again after a reboot).

- [ ] **Step 1: Write the failing tests**

In `server/test/ccrc-doctor.test.ts`, find:

<!-- replay: replace server/test/ccrc-doctor.test.ts -->
```ts
    CCRC_SCOPE_SETTLE_SEC: '1',
```

and replace it with:

```ts
    CCRC_SCOPE_SETTLE_SEC: '1',
    // `_check_scope-sweep` reads the sweep's verdict record from the runtime dir;
    // a test must never read a real box's, so the record is a fixture file.
    CCRC_SCOPE_SWEEP_STATE: join(home, 'fixture-scope-sweep.state'),
```

In `server/test/ccrc-doctor.test.ts`, find:

<!-- replay: replace server/test/ccrc-doctor.test.ts -->
```ts
  plantScope(home, { procs: [4101, 4102] });
```

and replace it with:

```ts
  plantScope(home, { procs: [4101, 4102] });
  // The pane-scope sweep's verdict record, fresh and empty: `scope-sweep` PASSes.
  writeFileSync(join(home, 'fixture-scope-sweep.state'), `# ccd-scope-sweep v1 tick=${Math.floor(Date.now() / 1000)} mode=shadow\n`);
```

In `server/test/ccrc-doctor.test.ts`, find:

<!-- replay: replace server/test/ccrc-doctor.test.ts -->
```ts
 *  mutation row). */
const HEALTHY_SKIPS = (process.platform === 'darwin' ? 1 : 0) + 4;
```

and replace it with:

```ts
 *  mutation row).
 *
 *  RAISED BY ONE ON macOS ONLY (session-continuity wave 4): `scope-sweep` SKIPs
 *  there, as `scopes` does — pane scopes are a Linux mechanism. On Linux
 *  `healthy()` plants a fresh verdict record, so it PASSes and this count is
 *  unchanged there. */
const HEALTHY_SKIPS = (process.platform === 'darwin' ? 2 : 0) + 4;
```

In `server/test/ccrc-doctor.test.ts`, append at the end of the file:

<!-- replay: append server/test/ccrc-doctor.test.ts -->
```ts

// ── scope-sweep (session-continuity wave 4) ─────────────────────────────────
// `_check_scope-sweep` READS the sweep's verdict record and never re-derives it:
// every unit below is absent from the fixture's own `systemctl list-units`, so a
// check that asked the box instead of the record would list none of them.
describeLinux('ccrc doctor: scope-sweep', () => {
  const now = (): number => Math.floor(Date.now() / 1000);
  const record = (home: string, lines: string[], ago = 0, mode = 'shadow'): void => {
    writeFileSync(join(home, 'fixture-scope-sweep.state'), [`# ccd-scope-sweep v1 tick=${now() - ago} mode=${mode}`, ...lines].join('\n') + '\n');
  };
  const DEAD = 'tmux-spawn-00000001-0000-4000-8000-000000000000.scope';
  const LIVE = 'tmux-spawn-00000002-0000-4000-8000-000000000000.scope';

  it('PASSes on a fresh record with nothing in it, and says the mode it ran in', () => {
    const home = healthy('ccrc-doctor-scope-sweep-pass-');
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^PASS scope-sweep: no dead pane scope, and no process older than a day in a live one \(the sweep's record, \d+s old, mode shadow\)$/);
  });

  it('WARNS with every dead scope: its processes, age, sockets, memory and verdict', () => {
    const home = healthy('ccrc-doctor-scope-sweep-dead-');
    record(home, [`dead ${DEAD} first=${now() - 7 * 3600} cpu0=7 verdict=would-stop why=none server=gone procs=3 mem=${20 * 2 ** 20} sockets=0 youngest=90000 pids=1,2,3`]);
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN scope-sweep: '));
    expect(i, out.join('\n')).toBeGreaterThan(-1);
    expect(out[i]).toContain(`${DEAD} dead 420 min: 3 process(es), 20 MiB, 0 socket(s), its server gone, would-stop (none)`);
    expect(out[i]).toContain('(mode shadow)');
    expect(out[i + 1]).toMatch(/^ {2}remedy: read each before acting: /);
  });

  it('WARNS with every process older than a day in a live pane scope', () => {
    const home = healthy('ccrc-doctor-scope-sweep-old-');
    record(home, [`old ${LIVE} pid=4242 age=${3 * 86400} comm=bash`]);
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toContain(`${LIVE} live: pid 4242 (bash) running 72 h`);
  });

  it('WARNS when the record is stale: the sweep has stopped running', () => {
    const home = healthy('ccrc-doctor-scope-sweep-stale-');
    record(home, [], 600);
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^WARN scope-sweep: the verdict record is \d+s old/);
  });

  it('WARNS on a record that is not a v1 record', () => {
    const home = healthy('ccrc-doctor-scope-sweep-garbled-');
    writeFileSync(join(home, 'fixture-scope-sweep.state'), `# ccd-scope-sweep v2 tick=${now()} mode=shadow\ndead something\n`);   // a later format this doctor cannot read
    expect(lineFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^WARN scope-sweep: the verdict record at .* is unreadable or not a v1 record/);
  });

  it('SKIPs with no record: not installed, or not yet run since its timer was armed or the box booted', () => {
    const home = healthy('ccrc-doctor-scope-sweep-absent-');
    rmSync(join(home, 'fixture-scope-sweep.state'));
    expect(anyVerdictFor(runDoctor(home).stdout, 'scope-sweep')).toMatch(/^SKIP scope-sweep: no verdict record at /);
  });

  it('services: an installed, stopped ccd-scope-sweep.timer WARNS — a reboot empties the record, so only `known` sees it', () => {
    const home = healthy('ccrc-doctor-services-scope-sweep-timer-');
    writeUnitFile(home, 'ccd-scope-sweep.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-scope-sweep.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-scope-sweep.timer is installed but inactive');
    expect(lines[i]).toContain('no dead pane scope is recorded or collected');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-scope-sweep\.timer$/);
  });

  it('services: an active ccd-scope-sweep.timer is named among the PASSes', () => {
    const home = healthy('ccrc-doctor-services-scope-sweep-timer-ok-');
    writeUnitFile(home, 'ccd-scope-sweep.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-scope-sweep.timer'), 'active\n');
    expect(lineFor(runDoctor(home).stdout, 'services')).toContain('ccd-scope-sweep.timer is active');
  });
});
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
 *  other class, both codes and both refreshes equal. It is a golden: nothing re-measures
```

and replace it with:

```ts
 *  other class, both codes and both refreshes equal. RE-MEASURED again when
 *  doctor gained `scope-sweep` (session-continuity wave 4): the three maps each
 *  gained `"scope-sweep": "SKIP"` (the fixture's runtime dir holds no verdict
 *  record) and nothing else moved. It is a golden: nothing re-measures
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
        "memory": "PASS",
        "models": "PASS",
        "name": "SKIP",
        "node": "PASS",
        "path": "PASS",
        "pool-sync": "WARN",
        "pools": "PASS",
        "provenance": "PASS",
        "python3": "PASS",
        "rc": "PASS",
        "routing": "PASS",
        "scopes": "SKIP",
        "services": "PASS",
        "skills": "PASS",
        "timeout": "PASS",
        "tmux": "PASS",
        "tmux_skew": "PASS",
        "update-exposure": "SKIP",
        "update-sync": "WARN",
        "wrappers": "PASS"
      }
    },
```

and replace it with:

```ts
        "memory": "PASS",
        "models": "PASS",
        "name": "SKIP",
        "node": "PASS",
        "path": "PASS",
        "pool-sync": "WARN",
        "pools": "PASS",
        "provenance": "PASS",
        "python3": "PASS",
        "rc": "PASS",
        "routing": "PASS",
        "scope-sweep": "SKIP",
        "scopes": "SKIP",
        "services": "PASS",
        "skills": "PASS",
        "timeout": "PASS",
        "tmux": "PASS",
        "tmux_skew": "PASS",
        "update-exposure": "SKIP",
        "update-sync": "WARN",
        "wrappers": "PASS"
      }
    },
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
        "memory": "PASS",
        "models": "PASS",
        "name": "SKIP",
        "node": "PASS",
        "path": "PASS",
        "pool-sync": "WARN",
        "pools": "PASS",
        "provenance": "PASS",
        "python3": "PASS",
        "rc": "PASS",
        "routing": "PASS",
        "scopes": "SKIP",
        "services": "PASS",
        "skills": "PASS",
        "timeout": "PASS",
        "tmux": "PASS",
        "tmux_skew": "PASS",
        "update-exposure": "SKIP",
        "update-sync": "WARN",
        "wrappers": "PASS"
      }
    }
```

and replace it with:

```ts
        "memory": "PASS",
        "models": "PASS",
        "name": "SKIP",
        "node": "PASS",
        "path": "PASS",
        "pool-sync": "WARN",
        "pools": "PASS",
        "provenance": "PASS",
        "python3": "PASS",
        "rc": "PASS",
        "routing": "PASS",
        "scope-sweep": "SKIP",
        "scopes": "SKIP",
        "services": "PASS",
        "skills": "PASS",
        "timeout": "PASS",
        "tmux": "PASS",
        "tmux_skew": "PASS",
        "update-exposure": "SKIP",
        "update-sync": "WARN",
        "wrappers": "PASS"
      }
    }
```

In `server/test/ccrc-install.test.ts`, find:

<!-- replay: replace server/test/ccrc-install.test.ts -->
```ts
      "routing": "PASS",
      "scopes": "SKIP",
```

and replace it with:

```ts
      "routing": "PASS",
      "scope-sweep": "SKIP",
      "scopes": "SKIP",
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t '^ccrc doctor: (scope-sweep|services|the check list)' --maxWorkers=1
./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'BASE_LIVE_SHAPE is its measured answer|live shape: two installs|the flip, in Plan 3b' --maxWorkers=1
```

Expected: (the tests at this task, the doctor at Task 4's tree) `8 failed | 30 passed | 651 skipped (689)` — the six `scope-sweep` cases and both `services:` cases; and `3 failed | 311 skipped (314)` — the live shape's three cases, each naming `scope-sweep` as the class that moved.

- [ ] **Step 3: The check, its table entry and `known`**

In `ccd/ccrc-doctor-checks`, find:

<!-- replay: replace ccd/ccrc-doctor-checks -->
```bash
  scopes
```

and replace it with:

```bash
  scopes scope-sweep   # one line, as `flock timeout`: _check_scope-sweep is at the END of this file
```

In `ccd/ccrc-doctor-checks`, find:

<!-- replay: replace ccd/ccrc-doctor-checks -->
```bash
# output is a journal line, and a stopped reaper is silent until the disk is. The timer-fired oneshot `.service` siblings (one
```

and replace it with:

```bash
# output is a journal line, and a stopped reaper is silent until the disk is. `ccd-scope-sweep.timer` is in `known` AND in the EFFECT design: `_check_scope-sweep` reads the verdict record its service rewrites every minute and warns when it is stale, but a reboot empties that record, so only `known` sees a timer that never ran again. The timer-fired oneshot `.service` siblings (one
```

In `ccd/ccrc-doctor-checks`, find:

<!-- replay: replace ccd/ccrc-doctor-checks -->
```bash
  local -a known=(ccrc.service ccrc-agent.service ccd-cap-scopes.timer ccd-account-health.timer ccd-telemetry-keepalive.timer ccrc-models.timer ccrc-update-watchdog.timer ccd-pool-sync.timer ccd-update-sync.timer ccd-tmp-sweep.timer)
```

and replace it with:

```bash
  local -a known=(ccrc.service ccrc-agent.service ccd-cap-scopes.timer ccd-account-health.timer ccd-telemetry-keepalive.timer ccrc-models.timer ccrc-update-watchdog.timer ccd-pool-sync.timer ccd-update-sync.timer ccd-tmp-sweep.timer ccd-scope-sweep.timer)
```

In `ccd/ccrc-doctor-checks`, find:

<!-- replay: replace ccd/ccrc-doctor-checks -->
```bash
          ccd-tmp-sweep.timer) why="nothing reaps Claude Code's per-uid temp dir, which grows by gigabytes a day until / fills" ;;
```

and replace it with:

```bash
          ccd-tmp-sweep.timer) why="nothing reaps Claude Code's per-uid temp dir, which grows by gigabytes a day until / fills" ;;
          ccd-scope-sweep.timer) why="no dead pane scope is recorded or collected, and the scope-sweep check has nothing fresh to read" ;;
```

In `ccd/ccrc-doctor-checks`, append at the end of the file:

<!-- replay: append ccd/ccrc-doctor-checks -->
```bash

# ── scope-sweep ───────────────────────────────────────────────────────────
# WHAT ccd-scope-sweep RECORDED — READ, NEVER RE-DERIVED (session-continuity
# spec §5.6 item 2, wave 4). The sweep keeps one verdict record,
# `$XDG_RUNTIME_DIR/ccd-scope-sweep.state`, rewritten whole every minute: a
# `dead` line per dead ccd pane scope (first seen dead, verdict, why, server,
# processes, memory, sockets) and an `old` line per process older than a day in
# a LIVE pane scope that is neither the pane's own process nor one of its Claude
# Code's MCP servers. This check lists both, and asks nothing of systemd or
# /proc itself: two readers deriving "dead" twice is how they come to disagree,
# and the sweep's verdict is the one its stop acts on. Appended at the END of
# this file, for `_check_timeout`'s reason (lines above are cited by number).
#
# WARN, never FAIL — `_check_scopes`' argument: a dead scope is a runtime fact,
# and `ccrc install` ends with doctor. The remedy is the operator's: read the
# scope, then stop it, or move a service a session still needs into a unit of
# its own. The sweep itself stops only an INERT scope, and only once the
# operator has armed it; the record's header says which mode it ran in.
#
# TWO HALVES OF THE TIMER'S HEALTH. `_check_services` asks whether
# `ccd-scope-sweep.timer` is active (it is in `known`); this check asks whether
# its record is FRESH — a tick older than CCRC_SCOPE_SWEEP_STALE_S is a sweep
# that stopped. No record at all is a SKIP, never a WARN: a fresh install arms
# the timer two minutes before its first tick, and a reboot empties the runtime
# dir. SKIP on Darwin (no cgroup scopes) and on a `server`-role box (no sessions).
# CCRC_SCOPE_SWEEP_STATE is the test seam, CCRC_CADDY_SYSTEM_FILE's shape.
_check_scope-sweep() {
  local _srv_role="" rec hdr tick mode now age line n nd=0 no=0
  local -a found=()
  if [ "${CCD_OS:-linux}" = darwin ]; then
    _dr_skip scope-sweep "pane scopes are a Linux mechanism — no sweep runs on this box"; return 3
  fi
  [ -f "${BOX_ENV_FILE:-}" ] && [ -r "${BOX_ENV_FILE:-}" ] && _srv_role="$(_box_env_value "$BOX_ENV_FILE" CCRC_ROLE)"
  if [ "$_srv_role" = server ]; then
    _dr_skip scope-sweep "this box records CCRC_ROLE=server, so it runs no pane scope and no sweep"; return 3
  fi
  rec="${CCRC_SCOPE_SWEEP_STATE:-${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/ccd-scope-sweep.state}"
  if [ ! -e "$rec" ]; then
    _dr_skip scope-sweep "no verdict record at $rec — the sweep is not installed here, or has not run since its timer was armed or the box booted (\`services\` asks after the timer)"; return 3
  fi
  { IFS= read -r hdr < "$rec"; } 2>/dev/null || hdr=""
  if ! [[ "$hdr" =~ ^\#\ ccd-scope-sweep\ v1\ tick=([0-9]+)\ mode=(shadow|live)$ ]]; then
    _dr_warn scope-sweep "the verdict record at $rec is unreadable or not a v1 record, so its dead scopes cannot be listed" \
      "let the sweep rewrite it: systemctl --user start ccd-scope-sweep.service; then re-run doctor"
    return 2
  fi
  tick=${BASH_REMATCH[1]} mode=${BASH_REMATCH[2]}
  now=$(date +%s); age=$(( now - tick ))
  if (( age > ${CCRC_SCOPE_SWEEP_STALE_S:-300} )); then
    _dr_warn scope-sweep "the verdict record is ${age}s old — the sweep runs every minute, so it has stopped, and its dead-scope report is stale" \
      "systemctl --user status ccd-scope-sweep.timer ccd-scope-sweep.service; journalctl --user -u ccd-scope-sweep.service"
    return 2
  fi
  while IFS= read -r line; do
    if [[ "$line" =~ ^dead\ (tmux-spawn-[^ ]+\.scope)\ first=([0-9]+)\ .*verdict=([a-z-]+)\ why=([^ ]+)\ server=([a-z]+)\ procs=([0-9]+)\ mem=([0-9]+|\?)\ sockets=([0-9]+) ]]; then
      local -a m=("${BASH_REMATCH[@]}")   # copied first: the `=~` below overwrites BASH_REMATCH
      n=${m[7]}; [[ "$n" =~ ^[0-9]+$ ]] && n="$(( n / 1048576 )) MiB"
      found+=("${m[1]} dead $(( (now - m[2]) / 60 )) min: ${m[6]} process(es), $n, ${m[8]} socket(s), its server ${m[5]}, ${m[3]} (${m[4]})")
      nd=$((nd + 1))
    elif [[ "$line" =~ ^old\ (tmux-spawn-[^ ]+\.scope)\ pid=([0-9]+)\ age=([0-9]+)\ comm=([^ ]*)$ ]]; then
      found+=("${BASH_REMATCH[1]} live: pid ${BASH_REMATCH[2]} (${BASH_REMATCH[4]}) running $(( BASH_REMATCH[3] / 3600 )) h")
      no=$((no + 1))
    fi
  done < "$rec"
  if [ "${#found[@]}" -eq 0 ]; then
    _dr_pass scope-sweep "no dead pane scope, and no process older than a day in a live one (the sweep's record, ${age}s old, mode $mode)"
    return 0
  fi
  local detail="" x
  for x in "${found[@]}"; do detail="${detail}${detail:+; }${x}"; done
  _dr_warn scope-sweep "$nd dead pane scope(s) and $no long-lived process(es) in live ones, from the sweep's record (mode $mode): $detail" \
    "read each before acting: \`systemctl --user stop <unit>\` ends EVERY process in a dead scope; a service a session still needs is moved into a unit of its own (systemd-run --user --unit …); a forgotten process in a live pane is the session's to end. The sweep stops only scopes inert for six hours, and only when armed"
  return 2
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts -t '^ccrc doctor: (scope-sweep|services|the check list)' --maxWorkers=1
./node_modules/.bin/vitest run test/ccrc-install.test.ts -t 'BASE_LIVE_SHAPE is its measured answer|live shape: two installs|the flip, in Plan 3b' --maxWorkers=1
# then ccrc-doctor.test.ts in its five slices and ccrc-install.test.ts in its four (Task 8 Step 2)
```

Expected: `38 passed | 651 skipped (689)`; `3 passed | 311 skipped (314)`; then the five doctor slices 74 / 183 / 141 / 109 / 168 and the four install slices 57 / 70 / 62 / 105, all green.

- [ ] **Step 5: Mutation check, then commit**

`ccrc-doctor.test.ts -t '^ccrc doctor: (scope-sweep|services|the check list)'` alone at `--maxWorkers=1` (38 cases).

| # | File | Exact edit (old → new) | Measured red on the full prototype (of 38) |
|---|---|---|---|
| 5.1 | `ccd/ccrc-doctor-checks` | `  scopes scope-sweep   # one line…` → `  scopes   # one line…` | 7 failed: “every name in the table has a _check_<name> function, and vice versa” and the six `scope-sweep` cases |
| 5.2 | `ccd/ccrc-doctor-checks` | `if (( age > ${CCRC_SCOPE_SWEEP_STALE_S:-300} )); then` → `if false; then` | 1 failed: “WARNS when the record is stale: the sweep has stopped running” |
| 5.3 | `ccd/ccrc-doctor-checks` | `ccd-scope-sweep\ v1\ tick=` → `ccd-scope-sweep\ v[0-9]+\ tick=` (the header regex) | 1 failed: “WARNS on a record that is not a v1 record” |
| 5.4 | `ccd/ccrc-doctor-checks` | the `dead` line's `if [[ "$line" =~ ^dead\ … ]]; then` → `if false; then` | 1 failed: “WARNS with every dead scope: its processes, age, sockets, memory and verdict” |
| 5.5 | `ccd/ccrc-doctor-checks` | the `old` line's `elif [[ "$line" =~ ^old\ … ]]; then` → `elif false; then` | 1 failed: “WARNS with every process older than a day in a live pane scope” |
| 5.6 | `ccd/ccrc-doctor-checks` | `known`'s ` ccd-tmp-sweep.timer ccd-scope-sweep.timer)` → ` ccd-tmp-sweep.timer)` | 2 failed: both `services:` cases |
| 5.7 | `ccd/ccrc-doctor-checks` | `rec="${CCRC_SCOPE_SWEEP_STATE:-${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/ccd-scope-sweep.state}"` → `rec="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/ccd-scope-sweep.state"` (the real runtime dir) | 6 failed: “reports a dead service and a dead timer as TWO lines, each with its own remedy” and five `scope-sweep` cases |

Then commit — "continuity wave 4: doctor reads the sweep's verdict record".

---

### Task 6: The limit-banner harness kills its child's whole process group (spec §5.6 item 3)

**Model routing:** `sonnet`, effort `medium`.

**Files:** Modify `server/test/ccd-limit-banner.test.ts` — `detectTimed`'s bound, and one case.

**Interfaces:** `BOUNDED` — `perl -e '…' <secs> <argv…>` forks the child into a process group of its own, `exec`s it
there, and on the alarm kills the GROUP, reaps it and exits 142 (the old form's code); otherwise it exits as the child
did. `detectTimed`'s callers are unchanged.

The leak it closes: `perl -e 'alarm shift; exec @ARGV'` became the child, so the alarm killed bash alone, and a
`tail` that bash had forked — blocked opening the FIFO whenever a mutation removed the detector's guard — outlived
every timed-out run. Spec §1.3 found such `tail` processes holding dead pane scopes for weeks.

- [ ] **Step 1: The harness and its pin**

In `server/test/ccd-limit-banner.test.ts`, find:

<!-- replay: replace server/test/ccd-limit-banner.test.ts -->
```ts
 *  NOT block. Perl is available on both supported userlands; SIGALRM exits 142. */
const detectTimed = (fn: string, p: string): string =>
  h.sh(`perl -e 'alarm shift; exec @ARGV' 5 bash -c "$(declare -f ${fn}); REDRIVE_TAIL_LINES=$REDRIVE_TAIL_LINES; ${fn} \\"\\$1\\"" _ ${JSON.stringify(p)} >/dev/null 2>&1; echo "rc=$?"`);
```

and replace it with:

```ts
 *  NOT block. Perl is available on both supported userlands; the alarm exits 142.
 *  THE WHOLE PROCESS GROUP dies on the alarm (session-continuity spec §5.6 item
 *  3): the old `alarm shift; exec @ARGV` signalled bash alone, so a `tail` it had
 *  forked — blocked opening the FIFO whenever a mutation removed the guard —
 *  outlived every timed-out run, and the fleet box's dead pane scopes held them
 *  for weeks. perl now forks the child into a group of its own and, on the
 *  alarm, kills that group, reaps it, and exits 142. */
const BOUNDED = `perl -e '$t = shift; $p = fork; die "fork: $!" unless defined $p; if (!$p) { setpgrp(0, 0); exec @ARGV; exit 127 } $SIG{ALRM} = sub { kill "KILL", -$p; waitpid($p, 0); exit 142 }; alarm $t; waitpid($p, 0); exit($? & 127 ? 128 + ($? & 127) : $? >> 8)'`;
const detectTimed = (fn: string, p: string): string =>
  h.sh(`${BOUNDED} 5 bash -c "$(declare -f ${fn}); REDRIVE_TAIL_LINES=$REDRIVE_TAIL_LINES; ${fn} \\"\\$1\\"" _ ${JSON.stringify(p)} >/dev/null 2>&1; echo "rc=$?"`);
```

In `server/test/ccd-limit-banner.test.ts`, find:

<!-- replay: replace server/test/ccd-limit-banner.test.ts -->
```ts
    expect(detectTimed('_transcript_limit_banner', f)).toBe('rc=2');
```

and replace it with:

```ts
    expect(detectTimed('_transcript_limit_banner', f)).toBe('rc=2');
  });
  it('the timed harness kills its child\'s WHOLE process group on timeout: a grandchild blocked on a FIFO does not outlive it', () => {
    // A stand-in for a detector whose FIFO guard is gone: it forks `tail`, which blocks opening the FIFO for ever.
    seed(); const f = path.join(h.home, `leak-${process.pid}.fifo`); execFileSync('mkfifo', [f]);
    const holders = (): string[] => execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes(f) && !l.includes('ps -eo'));
    try {
      expect(h.sh(`_leaky() { tail -n 1 -- "$1"; }; ${BOUNDED} 1 bash -c "$(declare -f _leaky); _leaky \\"\\$1\\"" _ ${JSON.stringify(f)} >/dev/null 2>&1; echo "rc=$?"`)).toBe('rc=142');
      expect(holders(), 'a process still holds the FIFO after the harness timed out').toEqual([]);
    } finally {
      // Release any leftover reader (a writer opening the FIFO ends its `tail`), then kill what is left.
      try { fs.closeSync(fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch { /* no reader: nothing to release */ }
      for (const l of holders()) { try { process.kill(Number(l.trim().split(/\s+/)[0]), 'SIGKILL'); } catch { /* gone */ } }
    }
```

- [ ] **Step 2: Run it**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-limit-banner.test.ts --maxWorkers=1
ps -eo pid,args | grep -c '[l]eak-.*\.fifo'
```

Expected: `137 passed (137)`, then `0`. The new case cleans up after itself even when it fails: a writer opening the
FIFO ends any `tail` still reading, and whatever is left is killed by pid.

- [ ] **Step 3: Mutation check, then commit**

`ccd-limit-banner.test.ts -t FIFO` alone (3 cases), and `ps` afterwards finds nothing: the case's own cleanup ran.

| # | File | Exact edit (old → new) | Measured red (of 3) |
|---|---|---|---|
| 6.1 | `server/test/ccd-limit-banner.test.ts` | `const BOUNDED = …` (the forking bound) → ``const BOUNDED = `perl -e 'alarm shift; exec @ARGV'`;`` (the old bound) | 1 failed: “the timed harness kills its child's WHOLE process group on timeout: a grandchild blocked on a FIFO does not outlive it” |
| 6.2 | ″ | `kill "KILL", -$p;` → `kill "KILL", $p;` (the child alone, not its group) | 1 failed: ″ |

Then commit — "continuity wave 4: the limit-banner harness kills its child's process group".

---

### Task 7: README and the spec (rev 8)

**Model routing:** `sonnet`, effort `medium`.

**Files:** Modify `README.md` (the timer table's row, the uninstall list's name, a "Pane-scope sweep" subsection after
the temp-dir reaper's), `docs/superpowers/specs/2026-09-23-session-continuity-design.md` (the status line's rev 8;
§5.6 item 2 carries the shadow ruling; §5.6's named trade defines how B is counted).

- [ ] **Step 1: README**

In `README.md`, find:

<!-- replay: replace README.md -->
```markdown
| `ccd-tmp-sweep.timer` | fleet, both | 1 h | reaps Claude Code's per-uid temp dir | `~/.ccrc/tmp-sweep-paused` |
```

and replace it with:

```markdown
| `ccd-tmp-sweep.timer` | fleet, both | 1 h | reaps Claude Code's per-uid temp dir | `~/.ccrc/tmp-sweep-paused` |
| `ccd-scope-sweep.timer` | fleet, both | 60 s | records every dead ccd pane scope; stops an inert one only when armed (below) | `~/.cc-sessions/scope-sweep-paused` |
```

In `README.md`, find:

<!-- replay: replace README.md -->
```markdown

### Memory guardrails (Linux)
```

and replace it with:

```markdown

### Pane-scope sweep (ccd-scope-sweep)

Every ccd pane runs in its own transient `tmux-spawn-<uuid>.scope` under the session slice, and its
processes stay there after the pane is gone: on 2026-09-23 twelve such scopes held 32 processes and
1.32 GB, a 27-day-old DynamoDB Local server among them. `ccd-scope-sweep`, driven by its own
`ccd-scope-sweep.timer` (`OnUnitActiveSec=60s`, beside `ccd-cap-scopes.timer` and never inside it), reads
only `tmux-spawn-*.scope` units in the session slice whose `Description` parses as `tmux child pane <pid>
launched by process <pid>` — ccd's own `ccrc-tmux-server.scope` and every other scope are outside it — and
takes every value from `systemctl --user show`, never from a built cgroup path. A scope is **dead** when none
of its processes is a live pane of the server its `Description` names, and **ccd's** when that server is
ccd's current one or no longer runs (checked by pid, `comm` and a start earlier than the scope's, so a
recycled pid is reported, never trusted). A scope of another live tmux server is never touched.

A dead ccd scope passes as **inert** only when it was first seen dead six hours ago or more, its CPU has not
moved since, no process in it started in the last six hours, none holds a TCP or UDP socket or a listening
Unix socket, and none is the parent of a process in another cgroup (and no live handoff record names one of
its processes: none exists yet). A value it cannot measure skips the scope for that tick; a scope seen live
starts its clock again. **The stop ships shadowed:** an inert scope is recorded `would-stop`, and
`systemctl --user stop --no-block` is issued only while `~/.cc-sessions/scope-sweep-live` exists — nothing
writes that file; the operator touches it after reading the shadow verdicts. `~/.cc-sessions/scope-sweep-paused`
stops everything, the shadow record included.

Its verdicts live in `$XDG_RUNTIME_DIR/ccd-scope-sweep.state`, rewritten every tick (a reboot empties it,
which restarts every clock): one `dead` line per dead ccd scope and one `old` line per process older than a
day in a live pane scope, other than the pane's own and its Claude Code's MCP servers. `ccrc doctor`'s
`scope-sweep` check reads that record and never re-derives it: it lists every dead scope with its
processes, age, sockets, memory and verdict, and every such long-lived process, and warns when the record
is stale. `deploy/measure-continuity.py --stage 6` counts the OOM stops of pane scopes whose session had
been idle 30 minutes or more with a live background shell — the pressure reap's own class — beside every
pane-scope OOM stop; the week after the sweep's deploy is its baseline.

### Memory guardrails (Linux)
```

In `README.md`, find:

<!-- replay: replace README.md -->
```markdown
  `ccd-tmp-sweep`, `ccd-usage-sweep`, `ccd-account-health`,
```

and replace it with:

```markdown
  `ccd-tmp-sweep`, `ccd-scope-sweep`, `ccd-usage-sweep`, `ccd-account-health`,
```

- [ ] **Step 2: The spec**

In `docs/superpowers/specs/2026-09-23-session-continuity-design.md`, find:

<!-- replay: replace docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```markdown
and records stage 7 as planned by its wave-3 plan, 2026-10-04 ·
```

and replace it with:

```markdown
and records stage 7 as planned by its wave-3 plan, 2026-10-04 · rev 8 ships stage 6's sweep with its stop SHADOWED
until the operator arms it, and defines §9's stage-6 reap-class count as measured (wave 4, 2026-10-05) ·
```

In `docs/superpowers/specs/2026-09-23-session-continuity-design.md`, find:

<!-- replay: replace docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```markdown
     measure skips that scope for the tick and records nothing; a scope seen live drops its entry.
```

and replace it with:

```markdown
     measure skips that scope for the tick and records nothing; a scope seen live drops its entry.
   - **The stop ships SHADOWED** (the coordinator's safety ruling at wave 4's planning): a scope that passes every
     predicate is recorded `would-stop`, and the stop is issued only while `$REG/scope-sweep-live` exists. Nothing
     in the tree writes that file — the operator arms it by hand after reading the shadow verdicts, as with
     `stall-watch-live` — and `$REG/scope-sweep-paused` still stops everything, the shadow record included. A
     server pid that now names another process, or a tmux server younger than the scope, is reported and never
     stopped; the record also holds one line per process older than a day in a live pane scope, other than the
     pane's own process and the MCP servers its Claude Code started in its first two minutes, for doctor.
```

In `docs/superpowers/specs/2026-09-23-session-continuity-design.md`, find:

<!-- replay: replace docs/superpowers/specs/2026-09-23-session-continuity-design.md -->
```markdown
class exceeds B + 2 in any week after it ships, and the removal takes effect at each session's next start. An aggregate `MemoryHigh` must never return to the slice.
```

and replace it with:

```markdown
class exceeds B + 2 in any week after it ships, and the removal takes effect at each session's next start. B is
counted by `deploy/measure-continuity.py --stage 6` over the week that starts at wave 4's deploy: it reads the pane
scopes' starts and OOM stops from the user journal, maps a scope to the session whose ccd `spawn` event followed its
start within ten seconds (a stop it cannot map to exactly one session is `unmapped`), and reads that session's
transcript for no user or assistant row in the 30 minutes before the stop and a Bash `run_in_background` start since
the spawn with no `<task-notification>` for it. An aggregate `MemoryHigh` must never return to the slice.
```

- [ ] **Step 3: Run the prose pins and the tax, then commit**

```bash
cd server && ./node_modules/.bin/vitest run test/readme-holds.test.ts test/pools-prose.test.ts test/child-reclaim-prose.test.ts test/crossrepo-prose.test.ts test/oss-metadata.test.ts test/readme-roster-mirror.test.ts test/lifecycle.test.ts test/topology-clean.test.ts --maxWorkers=1
```

Expected: `199 passed (199)`; then the S6-R11 procedure (`147 / 197 / 55 / 35`, `corpus-frozen`). `pools-prose`'s
README size pin: the README is 5,762 lines against CLAUDE.md's "~5700" (inside ±100). Commit — "continuity wave 4:
README and the spec, rev 8".

---
### Task 8: Whole-branch verification, the PR — and the AGENT-FIRST deploy

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified, unless `main` moved — then only the merge's own resolution (the stamp, and the hunks of a
file another wave also edits — Global Constraints, OVERLAP).

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: the wave-4 PR on this workspace's own branch and a wave-done report.

- [ ] **Step 1: Merge current `main`, and re-measure on the merged tree**

ONE gated block. It resolves, by script, only `ccd/ccd`'s line-2 stamp hunk (this wave adds no `_reg_get` call, so the
census lines merge clean or not at all), commits only when `bash -n` passed and no conflict marker is left, and on
anything else commits nothing and aborts the merge:

```bash
if ! git fetch origin main; then
  echo 'STOP: the fetch failed — nothing merged; report it'
elif git -c merge.conflictStyle=merge merge --no-edit origin/main; then
  echo 'merged without a conflict, or already up to date'
elif [ "$(git diff --name-only --diff-filter=U)" = ccd/ccd ] && [ "$(grep -c '^<<<<<<< ' ccd/ccd)" = 1 ] \
     && sed -n 2p ccd/ccd | grep -q '^<<<<<<< ' && sed -n 4p ccd/ccd | grep -q '^=======$' \
     && sed -n 6p ccd/ccd | grep -q '^>>>>>>> '; then
  sed -i '2,6d' ccd/ccd && ~/.local/bin/ccrc restamp ccd/ccd && bash -n ccd/ccd \
    && ! grep -qE '^(<<<<<<< |=======$|>>>>>>> )' ccd/ccd \
    && git add ccd/ccd && git commit --no-edit && echo 'merged: the stamp resolved by re-stamping'
else
  echo 'STOP: a conflict this block does not resolve — report it'; git merge --abort
fi
git log -1 --format='%h %s'
```

On `STOP` — another file conflicted (`ccd/ccrc-doctor-checks`, `ccrc-doctor.test.ts`, README, the spec): the branch's
tip is unchanged and no merge is in progress. A conflict in a file the OVERLAP constraint names is resolved by hand
keeping BOTH sides (two `known` names, two describes, both skip counts), the result re-measured by the suites of the
task that owns each hunk, and reported; anything else goes to the coordinator. Never `git checkout --theirs` a file,
never rebase. Then on the merged tree: the S6-R11 procedure (`147 / 197 / 55 / 35` unless `main`'s own census moved —
then `stated = base = tree` at main's numbers), the `_reg_get` census (main's stated pair, unmoved by this wave), the
citation cases, and `corpus-frozen`.

- [ ] **Step 2: The server suite in shards on the merged tip, the three large files in their slices, then agent and pwa**

```bash
git log -1 --format='%h merged tip under test'
cd server && npm ci
X='--exclude test/ccrc-doctor.test.ts --exclude test/ccrc-install.test.ts --exclude test/ccrc-update.test.ts'
./node_modules/.bin/vitest run --maxWorkers=2 --shard=1/24 $X   # … 2/24 … 24/24, one call each, foreground
DA='the check list|node|the binaries|jq_regex|tmux_skew|gh_auth|git_email|path|services'
DB='pool-sync|update-sync|config|auth|rc |disk|skills|wrappers'
DC='credentials|pools|fleet|build|ccrc-wrapper-shape|the output contract|exposure|caddy|cert|name'
DD='provenance|update-exposure|routing|models|accounts|memory'
for T in "^ccrc doctor: ($DA)" "^ccrc doctor: ($DB)" "^ccrc doctor: ($DC)" "^ccrc doctor: ($DD)" \
         "^(?!ccrc doctor: ($DA|$DB|$DC|$DD))"; do
  ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-doctor.test.ts -t "$T" | grep -E '^ +(Tests|Duration) '
done
IA="the shipped tree|the fixture tree|a fresh box|the files the operator|a roster|a box with no node|re-running|the env file|the executables|the order"
IB="the versioned tree|the one-time migration|workspace build-artifact|the build stamp|the unit directory|linger"
IC="all three skills|the landing block|running the WHOLE|the node's three|install-step|the harness"
for T in "^ccrc install: ($IA)" "^ccrc install: ($IB)" "^(ccrc install: ($IC)|ccrc install --role|install\\.sh)" \
         "^(?!ccrc install: ($IA|$IB|$IC)|ccrc install --role|install\\.sh)"; do
  ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-install.test.ts -t "$T" | grep -E '^ +(Tests|Duration) '
done
for T in '^ccrc update' '^(?!ccrc update)'; do
  ./node_modules/.bin/vitest run --maxWorkers=2 test/ccrc-update.test.ts -t "$T" | grep -E '^ +(Tests|Duration) '
done
cd ../agent && npm ci && ./node_modules/.bin/vitest run --maxWorkers=2
cd ../pwa   && npm ci && ./node_modules/.bin/vitest run --maxWorkers=2
```

Expected: PASS everywhere but the known reds (Global Constraints). Measured on the prototype: Pre-flight 13's sums.
Re-run any load flake IN ISOLATION before calling it a break; report every summary, their sums and the merged sha.
**If `main` moves again before the PR merges, repeat Step 1 and every shard.**

- [ ] **Step 3: The wave's own surface and the repo-wide guards in named runs**

```bash
cd server && ./node_modules/.bin/vitest run test/scope-sweep.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/ccd-operator-choice.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/measure-continuity-stage6.test.ts test/measure-continuity-stage7.test.ts test/measure-continuity-stage4.test.ts test/measure-continuity.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/single-definition.test.ts test/modelenv-single-writer.test.ts test/box-token-census.test.ts test/routing-references.test.ts test/ownership.test.ts test/ccd-reg-get-census.test.ts test/macos-platform.test.ts test/update-branch-absent.test.ts test/topology-clean.test.ts --maxWorkers=2
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts test/typecheck-tests.test.ts test/ccd-die-containment.test.ts --maxWorkers=1
git fetch origin main && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts --maxWorkers=1
./node_modules/.bin/vitest run test/session-hook.test.ts -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected (measured on the prototype): `29 passed`; `72 passed`; `22 passed`; `487 passed | 11 skipped (498)`;
`105 passed (105)`; `deviation-refs` and `dtbd` green (with `topology-clean`, `87 passed (87)`, measured with this plan on the branch); `7 passed | 328 skipped (335)`; then the S6-R11 procedure (`147 / 197 / 55 / 35`,
`corpus-frozen`) and the `_reg_get` census (`182` / `153` over `d12b5aba0`'s stated pair). Then a replay of THIS
document onto an export of the merge base, re-stamped, compared with the tip on every touched file — the planning
check, re-run by the worker as a whole-branch self-check (expected: byte-identical but for main's own later changes).

- [ ] **Step 4: Confirm the author, push, open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Session continuity wave 4: wave 3's residue, then dead pane scopes recorded and the inert ones stopped, shadowed (AGENT-FIRST)" --body-file - <<'EOF'
Wave 4 of the session-continuity programme (spec `docs/superpowers/specs/2026-09-23-session-continuity-design.md` §5.6 items 2–3, §9's stage-6 row; plan `docs/superpowers/plans/2026-10-05-session-continuity-wave4-scope-sweep.md`). **AGENT-FIRST.** No wire change.

1. **Wave 3's residue (review 272, F1–F11), the first commit.** A failed kill keeps the operator-choice marker only on `gone` or tmux's own "no server running" — a deleted socket no longer reads as no server; the record-newer check is asked first, so a command older than its field is neither written nor logged; cmd_swap's two guarded lines, the argless drift arm and ws-restore after ws-archive are pinned by behaviour; the comment drift, the refused-command prose, the stage-7 key note and wave 3's six mutation cells and two red-first counts are restated as measured; the `/effort` slider's noise is measured (a counts-only census: no `Kept effort level as …` row in 6,794 transcripts) and stated.
2. **`--stage 6`:** OOM stops of pane scopes whose session had been idle 30 minutes or more with a live background shell — the pressure reap's own class — beside every pane-scope OOM stop, mapped scope → session through ccd's own spawn events. The week after this deploy is baseline B (wave 4b's variable is judged against it).
3. **`ccd-scope-sweep`**, a one-minute oneshot beside `ccd-cap-scopes`: reads only `tmux-spawn-*.scope` units in the session slice with a pane Description, records every dead ccd pane scope in `$XDG_RUNTIME_DIR/ccd-scope-sweep.state` with the stop predicates it passes or fails, and — **SHADOWED** — issues `systemctl --user stop --no-block` on an inert one ONLY when `~/.cc-sessions/scope-sweep-live` exists, a file nothing in the tree writes. `scope-sweep-paused` stops everything. Never touched: `ccrc-tmux-server.scope`, an unparseable Description, another live tmux server's scope, a scope with a live pane, a recycled server pid. Installed like `ccd-tmp-sweep` (fleet and both roles), removed by uninstall.
4. **`ccrc doctor`'s `scope-sweep`** reads that record and never re-derives it; `ccd-scope-sweep.timer` joins `services`' `known`.
5. **The limit-banner harness** kills its child's whole process group on timeout.

Citation corpus (S6-R11): unmoved (`147/197/55/35`). `_reg_get` census unmoved (182/153).

**Deploy: by ccrc's own update mechanism (no hand rollout, operator ruling 2026-09-30); AGENT-FIRST. The stop stays shadowed until the operator arms it.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Report (the wave-done mail)**

Per the worker skill: the branch tip sha; Step 1's outcome; every shard and slice summary and their sums at that merged
sha, agent and pwa; each task's S6-R11 output; every mutation row's measured red at its own commit; Task 2 Step 6's two
readings; every departure from this plan, named by a slug (the coordinator numbers it from 4012 to 4021). Then stop.

- [ ] **Step 6: Merge (the coordinator's)**

Squash, at the reviewed head, after the review run rules.

- [ ] **Step 7: Deploy — measured, never moved by hand (post-merge)**

Do NOT run `ccrc rollout` or `ccrc update` by hand: ccrc's own update mechanism moves both boxes to the new prerelease,
the fleet box first. This measures that it did, read-only:

```bash
PR=<this wave's PR number>
git fetch origin main --tags
M=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
TAG=$(git tag --points-at "$M" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "merge: $M  tag: ${TAG:-<none yet>}"
ccrc rollout --check
```

Expected: once `release-main.yml` has tagged the merge, the fleet box reports that tag (AGENT-FIRST is met once it
does). A box that does not converge is REPORTED, never moved. Then, read-only on the fleet box:

```bash
systemctl --user is-active ccd-scope-sweep.timer
head -1 "$XDG_RUNTIME_DIR/ccd-scope-sweep.state"; grep -c '^dead ' "$XDG_RUNTIME_DIR/ccd-scope-sweep.state"
ccrc doctor 2>/dev/null | grep -A1 '^[A-Z]* scope-sweep:'
journalctl --user -u ccd-scope-sweep.service --since today | grep -c 'scope-sweep: .* stopped'
python3 "$HOME/ccrc/deploy/measure-continuity.py" --stage 6 --since "<the deploy time, YYYY-MM-DD HH:MM>"
```

Expected: `active`; a header `… mode=shadow`; the dead count doctor lists; `0` stops (shadow); and stage 6 from the
deploy on — B is that reading's `reap_class` over the seven days that follow (the coordinator records the deploy time
in the ledger and reads it again a week later).

**What the deploy itself does to the fleet.** Nothing is stopped: the sweep starts recording two minutes after its
timer is armed, and with no `scope-sweep-live` every inert scope is only `would-stop`. Doctor's new check SKIPs until
the first tick, then lists the dead scopes the planning census found (three today, none inert). A rollback is the
operator's call through the same mechanism and is safe on the data: the record lives in the runtime dir, an older
`ccrc` uninstalls nothing it did not place (the units stay until an uninstall of a tree that knows them), and an
older doctor never reads the record.

**Arming the stop is the operator's act, after the shadow week** (Open question 1): read the `would-stop` lines and
doctor's report; then `touch ~/.cc-sessions/scope-sweep-live` on the fleet box, by hand. `touch
~/.cc-sessions/scope-sweep-paused` stops everything at once.

---

## Residue carried (review 272 — not departures from the spec)

Task 1 brings wave 3 into line with the spec it already had, as the coordinator ruled, so it takes no number: F1 (a
deleted socket is not "no server": the unmark reads tmux's own words, as ws-reclaim does), F2 (measured; stated in
wave 3's drift entry), F3 (cells restated at the tip), F4 (two swap cases), F5 (comments), F6 (the record-newer check
first — wave 3's header already listed "a field newer than the keystroke" among the silent cases), F7 (prose), F8 (one
case), F9 (one case), F10 (two counts restated), F11 (one sentence). Rows 1.1–1.8.

**Carried to wave 4b** (rulings B and E): the pressure-reap variable in the spawn environment, after the baseline week;
and wave 3's deferred `/clear` fix — keep the operator's choice across a `/clear` by reading the transcript the
`/clear` left, at the uuid rotation (review 268's F4 design note: `_sync_uuid` is where the new uuid is learned).
**Carried past this programme's stage 3:** ccd stopping a pane's scope when it ends the pane, and the handoff-record
predicate (satisfied by construction until a record exists).

## Deviations found

Numbers are ISSUED, never chosen: the coordinator defines each departure below from the worker's block, 4012 to 4021,
in the same act as the wave's acceptance; a worker never calls the allocator (worker clause 11). A departure found
while executing is named in the wave-done mail by a new slug. A session that cannot reach the coordinator writes
`D-TBD-<slug>` in its report and nowhere in a committed file.

Departures from the spec that this plan makes, each measured above — nine, against a block of ten:

- `scope-sweep-stop-shadowed` — the coordinator's safety ruling (C): spec §5.6 has the sweep STOP an inert scope; this
  wave records it `would-stop` and issues the stop only while `$REG/scope-sweep-live` exists, a file nothing in the
  tree writes (pinned by `single-definition.test.ts`'s appended describe, row 3.25), with `$REG/scope-sweep-paused`
  still stopping everything, the shadow record included. Carried into §5.6's text (Task 7). Rows 3.1–3.3b, 3.25.
- `scope-sweep-recycled-server-reported` — spec §5.6 checks the server "by pid, comm and a start time earlier than the
  scope's, against pid reuse" but says nothing of the scope whose check FAILS. Ruling D says never stop it; the plan
  records it dead with `server=reused`, `verdict=report`, `why=server-pid-reused`, so doctor lists it rather than
  hiding a scope whose server is certainly gone. The comparison is in ticks against monotonic microseconds, because the
  server and its first pane start in the same second (Pre-flight 5). Rows 3.8, 3.9.
- `scope-sweep-unmeasurable-carries-the-old-line` — §5.6's "skips that scope for the tick and records nothing" is read
  as: the scope's previous verdict line is carried UNCHANGED (its first-seen clock and `cpu0` kept), and a scope never
  seen before gets no line; dropping the line would restart a six-hour clock on every unreadable tick. Rows 3.19, 3.20.
- `scope-sweep-ccds-server-is-the-default-socket` — "ccd's current server" is the server `tmux list-panes -a` answers
  from on the default socket, as ccd's own `tmux` calls address it; when tmux answers nothing (no server, a deleted
  socket, no tmux), no LIVE server is ccd's, so only the scopes of a server that no longer runs are judged (safe in
  both directions). A wedged server is bounded by the unit's `TimeoutStartSec=45`, the script having no `timeout`
  (macos-platform's scan). Rows 3.7, 3.24.
- `scope-sweep-mcp-servers-are-startup-children` — §5.6 lists "every process older than a day in a live pane scope,
  other than the pane's own process and its Claude Code's MCP servers" without saying how an MCP server is told apart.
  The plan's reading: a direct child of the pane's process started within `SCOPE_SWEEP_MCP_SEC` (120 s) of it, and that
  child's descendants; a background shell started later is listed. The list is the sweep's record's (`old` lines), so
  doctor reads it rather than deriving it. Rows 3.22, 3.23, 5.5.
- `scope-sweep-children-elsewhere-by-cgroup-procs` — §5.6's "no process is the parent of one in another cgroup" is
  decided by the scope's own `cgroup.procs`: a child of one of its processes that it does not hold is elsewhere (a
  per-child cgroup-path comparison can never differ for a child it holds, which a first draft's row proved green).
  Rows 3.17, 3.18.
- `scope-sweep-installed-like-the-tmp-reaper` — spec §7 names the units, `deploy.sh`, the install spine and
  `deploy-verify`; the plan also gates the units and the enable off `--role server` (a server box runs no pane
  scope), declares the record in `shared/lifecycle.ts` and the binary in `TOOLCHAIN_EXECUTABLES`, takes no `flock` (a
  oneshot never runs twice at once; a manual run beside the timer can only issue a stop twice), and sets
  `TimeoutStartSec=45`, `MemoryMax=256M`, `OnActiveSec=2min`. Rows 4.1–4.13.
- `doctor-scope-sweep-reads-record-and-known` — §5.6 has doctor read the record; the plan also puts the timer in
  `services`' `known` (a reboot empties the record, so only `known` sees a timer that never ran again), makes a missing
  record a SKIP (a fresh install's first tick is two minutes away), warns on a record older than 300 s, and gives the
  record's path a test seam (`CCRC_SCOPE_SWEEP_STATE`) so no test reads a real box's. `BASE_LIVE_SHAPE` gains
  `"scope-sweep": "SKIP"` in its three maps. Rows 5.1–5.7.
- `stage-six-maps-scopes-through-ccd-spawns` — §9 names B but not its instrument. The plan reads the user journal (one
  read-only `journalctl --user` run — the instrument's header said it runs nothing but read-only opens — or `--journal
  FILE`, a new flag and `ctx` key the carried "one shape" constraint did not list), maps a scope to the one session
  whose ccd `spawn` event landed within ten seconds AFTER the scope's start (else `unmapped`), and reads idle and the
  live shell from that session's current transcript (a `/clear` since the stop reads as idle with no shell: named).
  Rows 2.1–2.8.

---

## Review lenses

Four lenses, all `opus` — a diff of one new process-stopping script (`ccd/ccd-scope-sweep`, 286 lines), one shipped
script's residue (`ccd/ccd`: +32 / −22), the install spine (`ccd/ccrc` +23 / −6, `deploy.sh` +6, two unit files),
doctor (+78 / −3), the instrument (+204 / −6), and tests (+405, +126, +90, +84, +29, +22, +15, …) — sized to the fleet
policy's 3–5 reviewers; one `sonnet` refute pass per finding.

1. **What the sweep can stop (opus, xhigh).** Prove `systemctl --user stop` is reachable only for a `tmux-spawn-*.scope`
   in the session slice, with a parseable Description, whose server is ccd's or gone (never reused, never another
   live server's), with no live pane, past every predicate, with `scope-sweep-live` present and `scope-sweep-paused`
   absent; that every unmeasurable value carries the old line and stops nothing; that no environment variable shortens
   six hours; that a hang in tmux is bounded; and that nothing in the tree writes `scope-sweep-live`.
2. **The predicates are measured right (opus, high).** `/proc/<pid>/stat` read past the last `) `; ticks against
   monotonic microseconds; `/proc/net/unix`'s flags column and `__SO_ACCEPTCON`; TCP/UDP inode columns in all four
   tables; `cgroup.procs` as the authority for "elsewhere"; CPU compared to the value first seen; the clock carried
   across ticks and dropped when a scope is seen live or vanishes.
3. **The residue and stage 6 (opus, high).** Review 272's eleven rulings each met and pinned; the record-newer check's
   move changes no write and only silences lines about superseded commands; stage 6's mapping window and its
   `unmapped`/`unmeasured` columns; the instrument opens nothing for writing and runs nothing but read-only
   `journalctl`.
4. **Guard fidelity, the install spine and the tax (opus, high).** Every mutation row mutates the guard it names; the
   sweep ships through every path the reaper ships through and is removed by every path that removes the reaper;
   doctor reads, never re-derives; the S6-R11 and `_reg_get` censuses came from the instruments.

---

## Open questions for the operator

1. **When to arm the stop.** The sweep ships shadowed. After its first week, read the `would-stop` lines (doctor lists
   them) and decide whether to `touch ~/.cc-sessions/scope-sweep-live`. Today's read-only census (Pre-flight 6): three
   dead ccd scopes, four processes, 2 MiB, none inert (one young process, two holding a socket) — the 2026-09-23
   measurement had five inert of twelve.
2. **A live test tmux server** (`tmux -S /tmp/tmuxtest_verify …`, alive since 2026-09-14, one pane scope) is outside the
   sweep by design (another live server's scope is never touched). It is somebody's leaked test server; stopping it is
   a hand act.
3. **The MCP-server reading** (`scope-sweep-mcp-servers-are-startup-children`): confirm the 120-second window, or name
   another rule (Claude Code's own MCP configuration is not read).
4. **Stage 6's unmapped and unmeasured columns.** Over the journal's retention, 12 of 63 stops were unmapped (5 with two
   sessions spawned together, 7 with no spawn — test panes) and 14 unmeasured (the session's workspace since reclaimed).
   B is read with those beside it, never folded in.
5. **Wave 3's plan was edited in place** (F3's six cells, F10's two counts, F2's noise, F1's narrowing in its
   entries), as the residue ruling asked; the entries keep their numbers, and no new number is written there.
6. **Wave 4b's scheduling.** B's week starts at this deploy; 4b (the pressure-reap variable, and the `/clear` fix) is
   planned against B a week later.
