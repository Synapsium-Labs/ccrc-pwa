# Upstream-launcher decision brief — `ccrc adopt` hard-fail and the lost write-path lock

*Drafted 2026-08-21. Read-only analysis; no code changed. Produced by a 12-agent review (4 subsystem readers, 4 design angles, 3 adversarial critiques, 1 synthesis), every citation re-verified in-tree and every dynamic claim reproduced against fixture HOMEs.*

---


*Read-only analysis. Repo untouched. Every citation below re-verified in this worktree; live `$HOME` was read only, never written. Claims I could not re-measure myself are marked UNVERIFIED and attributed.*

---

## 1. WHAT ACTUALLY BROKE

**Defect 1 — `ccrc adopt` hard-fails, exit 1, writes nothing.** The deciding line is `ccd/ccrc-adopt:311`, `if _wrap_is_script "$UPSTREAM_PATH"; then`. `_wrap_is_script` (`ccd/ccrc-wrapper-shape:84-89`) reads exactly two bytes and answers yes on `#!`. The launcher starts `#!/usr/bin/env bash` (verified: 2741 bytes, mode 0755), so adopt elects `claude` correctly by exec-target vote and then refuses it. Verified reproduction against a fixture HOME holding byte copies of the real `~/.local/bin/{claude,claude2,claude-corp,claude-dev0}`:

```
$ HOME=$FIXHOME bash ccd/ccrc-adopt --out $FIXHOME/.ccrc/accounts.json
ccrc-adopt: claude is exec'd by claude-corp claude-dev0 claude2 as the upstream binary,
            but it is itself a script — refusing to guess an upstream account
exit=1     stdout: 0 bytes     accounts.json: not created
```

The premise that stopped being true is stated in adopt's own header (`ccd/ccrc-adopt:21-25`, `:41-48`): *"A non-script file that some OTHER candidate `exec`s -> the upstream account"* and *"It never reads a candidate whole … the one file in play here that matters is 300+ MB."* Both are now false on this box. Note also that `is itself a script` appears **exactly once in the entire repo** — at `ccd/ccrc-adopt:312`. No test asserts the refusal fires, and no test asserts a script upstream is accepted; the adopt reader measured that deleting the block leaves 501/501 tests green across the six relevant suites.

**Defect 2 — the write-path lock on the upstream path lost its only absolute arm.** The deciding line is `deploy/gen-wrappers.mjs:233`, `if (st.size > OVERSIZE_BYTES) return { classify: 'oversize', equal: 'no' }` with `OVERSIZE_BYTES = 1024 * 1024` at `:222`. At ~334 MB the path classified `oversize`, and `ccd/ccrc:1540-1548` refuses that under **every** flag ("No flag overrides this one"). At 2741 bytes the file is read (`:236`), carries no ccrc marker, and classifies `foreign` (`:240`) — and the `foreign` arm's non-equivalent branch has a `--force` escape at `ccd/ccrc:1523-1524` (`action="rewrite"; why="ccrc did not write it and it says something else (--force)"`). The premise that stopped being true was never written down anywhere: `oversize` is documented as a *read-safety* gate (D-81, `deploy/gen-wrappers.mjs:159-168`), and nobody recorded that it was simultaneously the only thing preventing `ccrc wrappers --force` from overwriting `~/.local/bin/claude` under a mis-edited roster. A 334 MB → 2741 B change deleted a lock nobody knew existed.

**Severity correction — two findings from the review passes that change how Defect 2 should be weighted.**

- *It is not "a lost file".* `~/.local/bin/claude-corp` and `~/.local/bin/claude2` both end `exec "$HOME/.local/bin/claude" "$@"` (verified this session). In the mis-edit, `claude` becomes a generated wrapper exec'ing the newly-elected upstream, which is itself `protected` and never rewritten — so the box acquires a `claude → claude-corp → claude → …` **exec loop on every lane at once**. The safety reader measured `claude2 --version` going from rc=127 to rc=124 (never terminates) across the clobber. This is the exact hazard `ccd/ccrc:1160-1164` names as the reason lock 4 exists, one hop out of lock 4's reach (`ccd/ccrc:1466` tests only self-reference). UNVERIFIED by me: the rc=124 run itself; verified by me: both ingredients (the two exec lines, and the `--force` rewrite arm).
- *`--force` is not the only route.* Obeying ccrc's own printed remedy — `ccd/ccrc:1530`, the one branch deliberately kept `--force`-free — moves the launcher aside, which makes the path `absent`, and `ccd/ccrc:1483-1484` then writes with **no flag at all**. Once ccrc owns the path, `ccrc-unmodified` + `equal=no` rewrites it on every roster change forever (`ccd/ccrc:1485-1490`). `ccrc install` reaches both, since `_inst_wrappers` calls `cmd_wrappers` with no arguments (`ccd/ccrc:2894-2895`). Any option scored on "`--force` only" is mis-scored.

Both defects descend from one root premise: **`~/.local/bin/<upstreamId>` is the binary** — a premise six prose sites assert, no code measures, no roster records, and no test pins.

---

## 2. THE OPTION SPACE FOR DEFECT 1 (adopt hard-fails)

After dedup across the four design passes, there are six distinct mechanisms plus the null option.

### D1-A — Re-key the refusal onto the hazard it was a proxy for
*Proposed in some form by all four angles (minimal-1/2, identity-B, roster-1/2/3, contract-A/B/C).*

**Mechanism.** Refuse a script upstream only when it is *an account wrapper* — i.e. it declares its own `CLAUDE_CONFIG_DIR` — because that, not `#!`, is what makes an elected upstream an exec cycle.

**What changes.** `ccd/ccrc-adopt:311`'s predicate; the refusal wording at `:312`; the literal `non-script` in the success echo at `:316` (which becomes a measured falsehood the moment the gate moves, and is pinned only by prefix at `server/test/ccrc-cli.test.ts:285`); the wrong-but-conservative comment at `:330`. Bash only, agent lane only.

**Cost.** Roughly one predicate. `_wrap_declares_config_dir` (`ccd/ccrc-wrapper-shape:95-102`) is already called on every candidate at `:204`, so the fact is in hand. Nothing goes red — which is uninformative, since the site is unpinned.

**Two spellings, and they are not equivalent.** Call `_wrap_declares_config_dir` **directly**, or test membership of the winner in `CFG_SCRIPTS`/`SHAPE_OK`. The safety reader measured them diverging on a textbook generated-shape wrapper parked at `bin/claude` whose only anomaly is `chmod 0644`: direct predicate → refused (exit 1); membership → **accepted, roster written**. Membership additionally requires surviving pass 0 (`-f`, `-x`, `WRAPPER_ID_RE`) and pass 0.5, so it answers "no" for reasons unrelated to the file's content — replacing one proxy with another. Also, `ccd/ccrc-adopt:49` is `set -euo pipefail`, so a bare associative-array lookup on a missing key is fatal; the membership spelling has to be written defensively or it crashes on exactly the box it is for.

**What it does not cover.** The predicate is one regex, `^[[:space:]]*export[[:space:]]+CLAUDE_CONFIG_DIR=` (`ccd/ccrc-wrapper-shape:99`), applied line-wise. A file that exports the variable in the two-statement form (`CLAUDE_CONFIG_DIR=…` then `export CLAUDE_CONFIG_DIR`) does not match it. The safety reader built exactly that as a 2-cycle and measured the relaxed gate exiting **0** and writing `{"id":"claude","configDirSuffix":".claude","exec":{"kind":"upstream"}}` for a box where `claude2 --version` never terminates — i.e. adopt certifying an infinite exec loop as healthy, with a fabricated `.claude` suffix (hardcoded at `ccd/ccrc-adopt:324`, never read off disk).

**Critique verdicts.** *Tests:* provable in both directions, two-line shell fixtures, zero new constants, zero cross-language copies — the cheapest provable fix in the whole set, but only in the direct-predicate spelling. *Operator:* rank 1 — zero operator action on any box, and it is the only option that also unblocks stock third-party installs (verified: `~/.local/bin/pnpm` and `yarn` are `#!` shims; an `npm i -g` install symlinked into `~/.local/bin` resolves to a node-shebang script, which today hard-fails adopt identically). *Safety:* dissents — calls this a genuine regression, because today's gate fails **closed** on this box and the relaxed gate fails **open** on the cycle case above; argues against trading a closed failure for an open one to fix the less dangerous defect.

### D1-B — Positive termination test
*Not proposed by any design angle; raised by the safety reader as its counter-proposal.*

**Mechanism.** Accept the elected script as upstream only on positive evidence that it is not a cycle — its exec terminus resolves outside `~/.local/bin`.

**What changes.** Adopt needs a terminus reader it does not have. `_wrap_parse_shape` only captures targets matching the literal prefix `exec "$HOME/.local/bin/` (`ccd/ccrc-wrapper-shape:202`), and the launcher's terminus is a computed `$_bin` under `~/.local/share/claude/versions` — so a new, bounded reader would be required.

**Cost / not covered.** UNVERIFIED as implementable within the existing readers; a terminus that is a computed shell variable cannot be resolved without either executing the script or a new heuristic, and a heuristic here is a third proxy. It is the only proposal that answers the safety objection to D1-A head-on, and the only one with no worked design behind it.

### D1-C — The file declares itself (launcher marker)
*identity-A, roster-4.*

**Mechanism.** A non-hashed provenance line (`# ccrc:launcher 1`) in the same slot ccrc uses for its own marker; a file carrying it, and declaring no config dir, is positively identified as the upstream launcher by adopt, the writer, and doctor.

**What changes.** `shared/mark.mjs` gains a second vocabulary (its header explicitly forbids scope creep); `ccd/ccrc-wrapper-shape` gains a bounded two-line reader; adopt's gate becomes three-way; doctor gains a real bucket. Touches node and bash.

**Cost.** One line the operator types once, in `~/.local/bin/claude`. Two new duplicated facts (the marker literal, and the "which line is the marker slot" rule from `shared/mark.mjs:66`), the second of which is a behaviour, not a needle, so it needs new differential-test machinery rather than a `holdersOf` case.

**What it does not cover.** Every box where nobody has edited the file — which, for an OSS project, is all of them by default. Protection is opt-in and silently absent when unclaimed, with no verdict from any tool: the same silence that produced this incident.

**Critique verdicts.** *Tests:* mechanism is sound where it applies; corrects one stated fear — `MARKER_RE` (`shared/mark.mjs:44`) is anchored at both ends, so a launcher marker **cannot** be misread as `ccrc-unmodified`, and the "no-flag rewrite" worst case is not reachable. *Safety:* the real objection is that a marker is a claim a file makes about itself, and D1-C makes it an **accept** signal for adopt (on the write side it only ever refuses, which is fine). *Operator:* rejects for Stage 5 — asks the operator to hand-add a magic line two lines above an all-caps comment forbidding a *different* magic line, in the file whose misconfiguration takes down every lane.

### D1-D — The operator states it (`ccrc adopt --upstream <id>`)
*minimal-3, contract-D adopt half.*

**Mechanism.** Stop inferring: a flag names the upstream and bypasses the gate for that id.

**What changes.** Adopt's usage line and flag loop; the four doctor remedies that name adopt (`ccd/ccrc-doctor-checks:1502`, `:1574`, `:1579`, `:1586`) would have to carry it. `ccd/ccrc`'s `cmd_adopt` is argv-transparent and needs nothing.

**Cost / not covered.** Any unattended re-bootstrap. The four FAILs that name adopt fire on a box whose roster is *already lost* — telling that operator to pass the id they no longer have a roster to look up is a remedy that presumes the answer.

**Critique verdicts.** *Tests:* the flag is provable; the option's central promise ("the id named is really the upstream") has no mutation and cannot be pinned — it is a bypass, and bypasses have no test. *Safety:* refuse as specified — it creates a capability that does not exist today; naming a generated wrapper writes a cycle by fiat, and a typo naming an id nothing execs silently demotes every real wrapper to `external` with `homeAble=false, telemetry=none` (`ccd/ccrc-adopt:369`). *Operator:* acceptable as a belt-and-braces addition *after* D1-A, never as the fix.

### D1-E — Keep the refusal; declare launchers unsupported
*contract-D.*

**Mechanism.** The premise stays, but stops being a premise: README states the contract, doctor FAILs *any* script at the upstream path, and adopt's refusal is reworded to be actionable.

**What changes.** Doctor's `upstream)` arm (`ccd/ccrc-doctor-checks:1716-1745`, today existence-only) gains a two-byte shape test; the new sentence must sit *beside* `:1470`'s, never replace it, or `server/test/ccrc-doctor.test.ts:2686` reds.

**Cost.** Verified chain: a `FAIL wrappers` line → `cmd_doctor` returns 1 (`ccd/ccrc:1128`) → `cmd_install` ends with `cmd_doctor` (`:2066`) → **every `ccrc install` on this box exits 1** until the launcher is dismantled.

**What it does not cover.** Defect 2, at all.

**Critique verdicts.** *Operator:* veto. It breaks stock npm/mise installs on fresh boxes for users who did nothing wrong, and the prescribed replacement (a hand-maintained `claude-bin` symlink) goes stale the next time `claude-prune-versions` runs — verified: `~/.local/share/claude/versions/` holds 5 builds / 1.6 GB, the prune timer fires daily at 00:01, and `ccd` execs the wrapper path with only an `-x` test, so a stale symlink kills every lane simultaneously. *Safety:* concurs on the fleet risk; notes the one salvageable half is the **message**, not the FAIL.

### D1-F — Do nothing
Defect 1 bites only on re-bootstrap. The operator's `accounts.json` backup is a working stopgap. Cost: the recovery path four doctor FAILs name stays broken, and it is broken for a class of installs beyond this box.

---

## 3. THE OPTION SPACE FOR DEFECT 2 (`--force`, and the no-flag paths, can overwrite the launcher)

### D2-A — Write-side byte predicate, in bash
*minimal-1 (`dok = ok`), minimal-2 (delete the arm), contract-C / identity-B-bash-placement (split `foreign`).*

**Mechanism.** The `foreign` arm currently collapses two conditions `--force` treats differently — "a wrapper ccrc did not write" and "not an account wrapper at all"; split them and make the second absolute, like `unreadable` and `oversize`.

**Three cut points, differing in what they refuse:**

| cut point | refuses under every flag | keeps force-able |
|---|---|---|
| **split on "declares no config dir"** (contract-C) | scripts that are not account wrappers | bespoke *account* launchers (the `ccgpt` shape, which does export a config dir) |
| **require `[ "$dok" = ok ]`** (minimal-1) | anything the reader cannot parse as a wrapper — strictly broader | only well-formed foreign wrappers |
| **delete the `--force` arm** (minimal-2) | all non-equivalent `foreign` | nothing |

**Cost.** Bash only, agent lane only, no wire change. `dok` is already computed at `ccd/ccrc:1509`, so the middle cut point costs zero new reads; the split costs a second read of a file `_wrap_parse_shape` just `mapfile`'d whole, hence a **third** spelling of the 1 MiB threshold (verified: `deploy/gen-wrappers.mjs:222` `1024 * 1024`, `ccd/ccrc-doctor-checks:1804` bare `1048576` — no agreement test today).

**What it does not cover.** Both no-flag paths from §1: `absent` → write (`ccd/ccrc:1483-1484`), reached by obeying ccrc's own remedy, and `ccrc-unmodified` → rewrite (`:1485-1490`). Also, per the safety reader's measurement, a launcher that *does* declare a config dir (one operator edit away) walks straight past the split cut point and is rewritten under `--force`, loop and all.

**Critique verdicts.** *Tests:* provable, two-line fixtures, zero new copies of any fact, nothing red — verified that both existing `foreign` fixtures in `server/test/ccrc-wrappers.test.ts` declare a config dir, so the split reds nothing. Also verified: `ccd/ccrc:1523-1524` is exercised by **zero tests** (every `--force` case in that suite is `ccrc-edited`, `unreadable`, `oversize`, the untouchable matrix, or a stub manifest), so this is a live write capability nothing pins — which is a strong argument that deleting it removes a power nobody designed for. *Operator:* prefers the split over `dok = ok`, because `dok = ok` also strips `--force`'s documented ability to take over a bespoke account launcher. *Tests* prefers `dok = ok` for the opposite reason: broader and cheaper. **This is a genuine disagreement between two reviewers, and it is a policy question, not a technical one** (see §7).

### D2-B — Same predicate, node placement (a new `classify()` value)
*identity-B as originally proposed.*

**Mechanism.** `deploy/gen-wrappers.mjs` classifies the launcher into its own bucket so the manifest — and `--dry-run` — tells the truth about it.

**Cost, and why it is the worst bargain in the set.** The tests reader measured that the config-dir predicate has **no correct JavaScript translation**: `[ \t]` under-matches `\v`/`\f` that `[[:space:]]` accepts, and `\s+` over-matches across newlines that a line-wise bash read cannot. Every disagreement is silent, and a silent disagreement here *loses* a lock. It also reds an existing pin: `server/test/gen-wrappers.test.ts:129-136`'s foreign fixture is literally `'#!/usr/bin/env bash\necho hi\n'`, which is indistinguishable from the launcher under every predicate ccrc owns (verified). Deploy skew is fail-closed but box-fatal — new node + old bash hits `ccd/ccrc:1550-1552`'s catch-all, refusing every account, and `_inst_wrappers` (`ccd/ccrc:2894-2895`) turns that into an install that cannot complete.

**Verdict.** All four reviewers land the same way: take the bash placement (D2-A), not this one. One piece of good news the tests reader verified: a new *verdict value* out of `_wrap_parse_shape` would be safe at all six existing call sites (all use `= ok` or `!= ok` polarity), but a new *field* is explicitly banned by the D-71 comment at `ccd/ccrc-adopt:251-265`.

### D2-C — Disk arithmetic: re-measure what the box says, not what the file says
*contract-B (cycle walk from the staged exec target), identity-C / roster-3 (exec-witness scan of the bin dir).*

**Mechanism.** Before writing anything, follow each staged wrapper's exec target through the files already installed and refuse — under every flag, whole run — if the walk returns to an id this run would write.

**Cost.** Bash only, no node change, no wire change: the smallest contract surface of any write-side option. It reads files the writer never opened, so it needs both the two-byte gate and a size gate — and note the precedent everyone proposes copying, `ccd/ccrc-doctor-checks:1801-1808`, **has no `else` and falls open when `stat` is missing**; copied verbatim onto the write path that is an unbounded read on every run. The operator reader adds a concrete reason to prefer the walk over the whole-bin scan: this bin dir contains `ccd`, a 608 KB shell script.

**What it uniquely covers.** It is the only mechanism that catches the exec loop as such, and (in the witness variant) the only one that also closes the **`absent` → no-flag write** hole, because a witness is a fact about *other* files and survives the launcher being moved aside.

**What it does not cover.** A fresh box (no wrappers on disk = no arithmetic — correct, but not coverage). A mis-election onto an id that does not exec back (e.g. `gpt`, whose bespoke shape parses `no`) terminates the walk and is still force-able.

**Critique verdicts.** *Safety:* rank 1 — the only family that targets the actual hazard. *Tests:* the refusal is easy to prove red; the property that decides shippability — *"a legitimate box still converges"* — is a **negative** assertion with no mutation, so this lock ships with its dangerous half unprovable; `server/test/ccrc-wrappers.test.ts:233` (idempotence, three wrappers all exec'ing `claude`) is the rail most likely to catch an over-broad predicate. *Operator:* rank 2, with one named hazard — a legitimate upstream rename wedges the box, and because install dies on any refusal, that reads as a broken deploy.

### D2-D — Roster-level invariant: the upstream owns `.claude`
*roster-1, node half.*

**Mechanism.** State the rule the whole system already assumes — the upstream runs with `CLAUDE_CONFIG_DIR` unset, so its config dir is `$HOME/.claude` — and make a roster that says otherwise invalid, so the mis-edit never reaches a manifest.

**Cost.** Touches `shared/roster.ts` and its bare-node mirror, hence the only option with a genuine two-box deploy. A violating roster becomes **unbootable**: `parseRoster` throws inside `loadRoster`, so the server will not start and `ccrc install` dies at its roster steps.

**What it does not cover.** A *coherent* mis-edit (move `.claude` onto the new upstream and give `claude` a fresh suffix) is internally valid and walks straight through.

**Critique verdicts.** *Tests:* uniquely, its new duplication lands on an **existing** mechanism — `server/test/gen-accounts.test.ts:227-285` is the two-parser parity gate — so it is the only option whose drift is already pinned. *Safety:* refuse — the invariant is invented rather than discovered, and is contradicted by the repo's own fixtures (`.a`, `.x`, `.main`, `.one`, `.up`, `.sentinel`, and an upstream `.claude2` in `server/test/gen-wrappers.test.ts:415`); a validation rule that can brick a boot is a manufactured outage. *Operator:* rank 3, conditional on surveying both boxes' rosters first (verified: the live roster, `deploy/accounts.migration.json` and `accounts.default.json` all already comply).

### D2-E — Launcher marker refusal
The write-side half of D1-C: a marked file refuses under every flag. Same costs and same fatal gap (unprotected until a human edits the file, silently unprotected again if the line is lost). On this side the marker only ever *refuses*, which is the safe polarity — the reviewers' objection is to the accept side (D1-C).

### D2-F — Roster records the shape (`exec.shape: binary | launcher`)
*contract-A, identity-D.* Adopt measures it, doctor re-measures and compares, the PASS line names it.

**Verdict: prevents no write.** The tests reader names this the one mechanism in the set that **cannot be proven load-bearing** — mutating it away changes an output string, not an outcome. Its own author concedes it does not even *detect* the Defect-2 case, since after the clobber the roster no longer calls `claude` upstream. Additional verified cost: `shared/roster.ts:225` `EXEC_KEYS_BASE = new Set(['kind'])` plus `warnUnknownKeys` means forgetting to extend the key set ships a `console.warn` on every `parseRoster` — every server boot. And if the mismatch is a FAIL rather than a WARN, it is an unclearable alarm that breaks every install (same chain as D1-E). Value if taken: it is the only proposal that makes ccrc *record* that this path is a launcher (verified: `CCRC_CLAUDE_VERSION` appears in zero repo files — the version-pin contract is entirely private to the operator today).

### D2-G — `protected\t<id>\t<kind>` on the wire
*roster-2.* Its own author says it fixes Defect 2 **not at all** — in the mis-edit `claude` leaves the `protected` list entirely, so the new field never describes it. Costs: reds `server/test/gen-wrappers.test.ts:383-400` (exact `toEqual`), `:448` (no-empty-fields), and the stub manifest in `ccrc-wrappers.test.ts`; non-additive by construction, so node and bash must land atomically. Substrate at best. One correction worth recording: the "deploy skew" fear is smaller than stated — `deploy/deploy.sh:383` rsyncs `agent shared deploy ccd` as **one tree**, and `ccd/ccrc:1267` resolves the generator out of that same tree, so a node+bash grammar change is atomic *per box*.

### D2-H — Do nothing
Given §1's severity correction, this is worse than it looked: the residual is not "a `--force` risk with a backup", it is a fleet-wide exec loop reachable by following ccrc's own printed remedy with no flags.

---

## 4. WHICH COMBINATIONS ARE COHERENT

The two defects share one root premise, so most options come in matched adopt/writer halves.

**Natural pairings.**
- **D1-A + D2-C** — the pairing the safety and operator readers converge on. One byte-predicate lock (adopt) and one arithmetic lock (the writer), failing in disjoint places, neither trusting the other. This is the two-independent-locks property `ccd/ccrc:1167-1170` already demands and which locks 2 and 4 famously do not have.
- **D2-A + D2-C** — compose cleanly and cover different rows: the byte predicate catches the file on sight, the walk catches the loop even when the bytes look fine, and the witness variant additionally covers the `absent` no-flag hole.
- **D1-C + D2-E** are *one* mechanism with two faces; taking either implies the other.
- **D1-D** cannot stand alone — it fixes only Defect 1 and must be paired with a writer-side option.

**Redundant together.**
- **D2-A + D2-B** — the same predicate in two languages, which is exactly the drift the tests reader measured as unfixable. Pick one placement (bash).
- **D2-D + D2-C** — overlapping on the lazy mis-edit; D2-C also catches the coherent one, so D2-D adds value only as a cheap early refusal, not as coverage.
- **D2-F + anything** — records a fact the other options already act on; it adds observability, never a lock.
- **D2-G + anything** — substrate only.

**Conflicting.**
- **D1-A (or D1-C) vs D1-E** — opposite postures. One says a launcher at the upstream path is legitimate and ccrc should learn to see it; the other says it is unsupported and doctor should FAIL it. They cannot both ship.
- **D1-A + D2-A alone** is the combination the safety reader specifically warns against: both locks then key on the *same* regex (`ccd/ccrc-wrapper-shape:99`), and its failure modes are asymmetric — an under-match makes adopt fall open while the writer falls closed; an over-match silently reopens Defect 2 *and* re-breaks adopt. It is not wrong, but it is one predicate backing two locks, which is the criticism `ccd/ccrc`'s own header levels at locks 2 and 4.

---

## 5. RECOMMENDATION

**For Defect 1 — D1-A, direct predicate spelling**, shipped with two riders: fix the `non-script` literal at `ccd/ccrc-adopt:316` in the same commit (it becomes a measured falsehood the moment the gate moves, and no test catches it), and size-gate `_wrap_declares_config_dir` at both call sites (`ccd/ccrc-adopt:204`, `ccd/ccrc-doctor-checks:1670`) — that predicate is an unbounded whole-file read and became reachable on the upstream path the moment `_wrap_is_script` started saying yes, so **it is already reading the upstream whole on this box today, before any change**.

*Why it wins:* zero operator action on any box; bash-only, one agent-lane deploy, one-command rollback; it restores the recovery path four doctor FAILs name; and it fixes a class of stock third-party installs, not just this box (verified: `~/.local/bin/pnpm`, `yarn` are `#!` shims — an npm- or mise-installed Claude Code symlinked into `~/.local/bin` hard-fails adopt today for the same reason the launcher does).

*Why a reasonable reviewer picks the runner-up:* the safety reader's objection is not soft. Today's gate fails **closed**; D1-A fails **open** on the two-statement-export cycle it measured, writing a roster that certifies a non-terminating box. If the operator weights "adopt must never write a roster nobody measured" above "adopt must work unattended", the correct call is **D1-E's message half only** — keep the hard refusal, fix the wording, add the doctor sentence, and accept that re-bootstrap stays manual. That is a coherent position and it should be chosen deliberately, not defaulted into.

**For Defect 2 — D2-C (cycle walk from the staged exec target), with D2-A as the cheap companion.** D2-C is the only mechanism that targets the measured hazard (the loop) rather than today's byte shape, and it is bash-only with no wire change. Its size gate must fail **closed** — do not copy `ccd/ccrc-doctor-checks:1801-1808` as written.

*Why a reasonable reviewer picks the runner-up:* the tests reader's objection is also not soft — D2-C's no-false-positive half is a negative property with no mutation, so it ships partly unprovable, and it introduces a new way to wedge a converging box during a legitimate upstream rename. A reviewer who weights provability and blast radius above coverage should ship **D2-A alone** (two-line fixtures, fully provable in both directions, nothing red) and accept that the no-flag paths stay open.

**Best combined path.** Three commits, all agent-lane, all bash-only, in this order:
1. **Red tests for today's behaviour first.** Both defective sites are unpinned — `ccd/ccrc-adopt:311-314` by nothing, `ccd/ccrc:1523-1524` by nothing — so a green suite after any fix proves nothing at all. This is the repo's own doctrine ("a comment is a request; a red suite is a mechanism").
2. **D1-A + riders.**
3. **D2-C + D2-A**, with the mutation tests asserting the resulting wrapper *terminates* under `timeout`, not merely that bytes were preserved — the measured failure is a box that never exits, and a bytes-only assertion goes green for the wrong reason.

Keeping all three bash-only is what makes rollback a single agent-lane redeploy from an older checkout — the property that matters most on a box where every session execs through `~/.local/bin/claude`. Anything touching `shared/` (D2-D, D2-F) is a separate decision with a two-lane deploy and should not ride along.

---

## 6. WHAT IS OUT OF SCOPE / SEPARATE

- **The pre-existing `FAIL wrappers` on this box.** `claude-corp sources .cc-secrets/claude-corp-oauth.env but the roster declares none` — the D-69-era roster/disk mismatch, arm at `ccd/ccrc-doctor-checks:1819-1828`. Doctor's output was measured byte-identical with the launcher and with the old 334 MB shape, so this FAIL predates and survives the whole incident.
- **`cck3` and `claude-glm`** declare `CLAUDE_CONFIG_DIR` and are undeclared in the roster, so they are a standing `wr_soft` WARN; `ccgpt` is dropped as `gpt`'s alias. Unrelated.
- **`~/.local/bin/claude-prune-versions` is invisible to ccrc** for exactly the same reason the launcher is (id-shaped, executable, declares no config dir). Not a defect; worth knowing.
- **The 1 MiB threshold is spelled twice with no agreement test** (`deploy/gen-wrappers.mjs:222`, `ccd/ccrc-doctor-checks:1804`) — already flagged as outstanding hygiene in the Stage-2d plan. Any option adding a third spelling should single-source it instead.
- **Adopt cannot recover labels** (`ccd/ccrc-adopt` writes id-as-label). `team·max` / `alt·max` / `team·shared` / `lab·dev0` exist nowhere on disk and must be re-typed after any adopt-based rebuild. This is by design, not a defect, but it means adopt is a bootstrap, not a sync — the existing `~/.ccrc/accounts.json` and its backup stay authoritative.
- **The launcher's version pin silently un-pins.** `CCRC_CLAUDE_VERSION` falls back to "highest installed" with a silent `else`, and the prune timer keeps only 3 versions — so a pinned rollback quietly stops being pinned on the third night. Operator-side tooling, not ccrc, but it is the kind of thing D2-F would make visible if the team wants that.
- **Adopt has no self-vote exclusion** (`ccd/ccrc-adopt:283`) — reachable, cosmetic (it inflates a stderr line), cannot create a duplicate row. Verified by all three readers who looked: duplicate/self-referential roster rows are **not reachable** under any proposed gate, because the skip at `:330` sits inside a loop over `CFG_SCRIPTS`, with `parseRoster`'s exactly-one-upstream rule as a further net. Worth closing alongside, worth nothing on its own.
- **D-114** (`readFileB64` / `readFileFrom` folding every failure to one `null`, and the agent's `stat` answering EACCES as `{missing:true}`) — unrelated seam, already tracked.

---

## 7. OPEN QUESTIONS FOR THE OPERATOR

1. **Is a launcher at `~/.local/bin/<upstreamId>` a SUPPORTED shape, or a tolerated accident?** Supported → D1-A (and later, if you want it named, D2-F as a WARN). Unsupported → D1-E, and you accept dismantling the launcher plus a hand-maintained symlink into a directory your own prune timer trims. Everything else follows from this answer.
2. **Should `ccrc adopt` ever write a roster on a box it refuses today?** The safety reader's measured case is real: relaxing the gate makes adopt exit 0 and bless an exec loop for a wrapper that exports its config dir in the two-statement form. Choose: (a) relax and accept that residual, (b) relax only behind a positive termination test (D1-B — no worked design exists, would need one), or (c) keep the hard refusal and fix only the wording.
3. **Does `--force` keep its documented power to take over a bespoke *account* launcher?** This is the live disagreement between two reviewers and it is a policy call, not a technical one. Keep it → split `foreign` on the config-dir predicate. Give it up → require `dok = ok`, which is broader, cheaper and provable, but removes a capability the README currently advertises.
4. **Are you willing to hand-edit `~/.local/bin/claude` to add a marker line** — knowing the protection is silently absent on any box where nobody has, and silently gone again if the line is ever lost during a reinstall? (Decides D1-C/D2-E in or out.)
5. **Is a roster rule that can refuse to boot acceptable?** D2-D is the cheapest early lock in the set and every roster you own already complies — but a violating roster stops the server and `ccrc install`, recoverable only by hand-editing over ssh. Ship it only after surveying `~/.ccrc/accounts.json` on both boxes.
6. **What is the Stage-5 / OSS bar?** Must a third party who installed Claude Code via npm or mise — whose `~/.local/bin/claude` is a node-shebang shim, verified as the same shape as `pnpm`/`yarn` in this bin dir — be able to run `ccrc adopt` on a fresh box? Yes → D1-A is close to mandatory and D1-D/D1-E are disqualified. No → the option space widens considerably.
7. **Do you want the first commit to be red tests of today's behaviour?** Both defective sites are unpinned in both directions, so without it neither the fix nor any future regression is detectable by the suite. It costs a commit and it is the only thing that makes any of the above a mechanism rather than a request.