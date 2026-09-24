# Child reclamation, wave 1 — the marker and containment (AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a dispatched workspace a CHILD at the one moment that fact is known — the server passes `--child <runId>` on the `ws-add` it composes, ccd records it as `$REG/<id>.child` before the first spawn, and every spawn of a marked workspace runs with `TMPDIR=$HOME/.cc-tmp/<id>` while that leaf is, or was just made, a real directory (not a symlink) owned by this user at mode 0700 — and otherwise spawns WITHOUT `TMPDIR`, warned on stderr, which contract §7 R1 rules the accepted behaviour (see "Ruled: an unusable temp root spawns uncontained") — behind a `child-argv-v1` capability token, so an older box keeps receiving the argv it always did. Plus the two measurements later waves size from: where Claude Code's scratchpad lands when `TMPDIR` is set, and how many workspaces exist with no marker when this ccd ships.

**Architecture:** Five mechanisms, each with a test that reds when it is deleted or mutated. (1) `_child_tmpdir <id>` in `ccd/ccd` — three answers (contained / not a child / child whose leaf is not a real, private directory of this user's, R1) — called ONCE from `_spawn_start`, the function every spawn path funnels through, and spliced into the one `env` string both spawn lines use. (2) `ws-add --child <runId>` parsed in `cmd_ws_add`'s existing strip-then-bind loop, refused above every mint unless it is a run id (`_child_runid_valid`, ASCII under `LC_ALL=C` — THE run-id grammar in ccd, which every later wave calls and none re-spells, contract §7 R2), and written with `_reg_set` beside `rc`. (3) `cmd_caps` echoes `child-argv-v1`, held equal to `CHILD_ARGV_CAP` and `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` in the SAME commit, because that parity test reads the real `ccd/ccd`. (4) `CCD_ARGV.wsAddWorker` gains a fourth parameter, `child: number | null = null`, composing `'--child', String(child)` immediately after `'--no-rc'` through a `childFlags` helper. (5) `dispatchRun`'s fresh-spawn arm sends `run.id` when `capSupported(state, CHILD_ARGV_CAP)` and otherwise journals `child-omitted:no-child-argv-cap` on the run.

**Tech Stack:** bash 5.2 (`ccd/ccd`, `set -uo pipefail`, no `-e`), TypeScript (server), vitest 4.1, python 3.12 (two measurement tools run from the scratchpad, never committed), Claude Code's own CLI (Task 1's measurement only).

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` — §5.1 (the marker), §5.2 (containment, children only, the measured prerequisite), §6 "Wire and capability" and "Deploy", §7 item 4 (the pre-policy stock), §8 wave 1's row, §9 (testing discipline). Cross-wave names come from the programme's interface contract, §1 and §6, as amended by its §7 "Rulings, 2026-09-23" — R1, R2, R9 and R10 bear on this wave and are built here as settled, never as open questions; programme ledger: `docs/superpowers/programs/child-reclamation.md`.

**Contract:** `docs/superpowers/programs/child-reclamation-contract.md` (cross-wave names and types; §7–§8 rulings)

---

## Global Constraints

Copied from `CLAUDE.md`, the spec and the contract. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST.** `ccd/` ships to the fleet box before the server moves. Under the release lane that is `ccrc rollout`'s DEFAULT order ("fleet box first because the server reads what the hook writes and the agent caches `ccd caps` at boot") — so this wave NEVER uses `--server-first`. The deploy order is restated as Task 6's post-merge steps.
- **One PR carries both halves** (contract §1): `server/test/ccd-archive.test.ts` runs the real `cmd_caps` and partitions its output into verbs and tokens by membership of `KNOWN_CAPABILITY_TOKENS`, so ccd's `echo child-argv-v1` and the list entry that names it cannot land in different commits without a red suite (Task 3 lands both).
- **Two authorities, always** (programme ledger, carried constraint 1). Child-ness is the box marker AND (from wave 3) the server's `--child-of` argv. Nothing in this wave may infer child-ness from anything else — not `--no-rc`, not a dec string, not a run row alone. `ccd-child-tmpdir.test.ts` pins that a `rc=off` row with no marker gets no `TMPDIR`.
- **Every new surface is capability-gated and read with `capSupported`, never `verbSupported`** (carried constraint 3). `verbSupported` permits on no evidence, which is right for verbs that always existed and exactly wrong for a FLAG on a verb every box has: an older `cmd_ws_add` binds an unknown flag as a positional and the slug check refuses — D-410, one flag to the left.
- **The PWA's ordinary add stays `CCD_ARGV.wsAdd` and never carries `--child`.** Only `dispatchRun` mints children; an operator's workspace, the coordinator's, and every workspace that exists before this ships is not a child and never becomes one (spec §4, §7 item 4).
- **Children only for `TMPDIR`** (spec §5.2). Fleet-wide containment is a different spec: it would move uncollected scratch out of an OS-reclaimed `/tmp` into `$HOME` for the sessions with no collector.
- **SAFETY — sacred.** NEVER run destructive `ccd` verbs against the live host (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`). NEVER touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly — this wave's two measurements READ the live registry with `ls`/`cat` and write nothing there — including through a hook: Task 1's nested `claude` runs with this pane's session variables stripped, because `ccd/session-hook.sh` would otherwise take it for THIS worker and rewrite its `hookstate.json`, and the step measures that it did not. NEVER print secret file CONTENTS.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`). **Every `bash` spawn in a `ccd-*.test.ts` file goes through `ghContainedEnv(home, env, { systemd: true, tmux: true })`** — including a spawn that runs no ccd at all: `ccd-workspaces.test.ts`'s scan ("routes EVERY bash call site in every ccd test file through ALL THREE poisons") reads the source, not the intent. Measured on this plan's prototype: a module-scope locale probe that skipped it redded that scan.
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in:

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`.**
- **Run suites in the FOREGROUND, timeout ≥600000ms.** The server suite no longer fits one 600 s call on the loaded fleet box — Task 6 runs it as twelve sequential shards whose union is every file once. Never background a suite.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`; measured during this plan's prototype also `boot.test.ts` (two p95 timing cases, red on the unedited base too) and `ccd-auto-swap-pool`'s "strands an UNTAGGED project too" (red under a 22-file batch, green alone).
- **Rings:** L0 `shared/*.ts` imports nothing; this wave adds nothing to `shared/`. **No overloaded null at a seam:** `_child_tmpdir` answers three codes because its caller acts on three conditions; `wsAddWorker`'s `child` is `number | null` where `null` means exactly "compose the old argv".
- **Wire discipline — additive-only.** This wave adds no frame field and does NOT bump `FLEET_PROTO`. The only wire change is an argv FLAG, gated on its own token.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated, measured before/after. Every mutation row in this plan was run on a prototype of exactly these edits and its red is quoted — including the two guards the 2026-09-23 rulings added (Task 2's foreign-owner case under row 3, Task 3's row 9), measured on a prototype at this branch's tip after the `507aefe9` merge.
- **`ccd/ccd` is a provenance-STAMPED file** (line 2 is `# ccrc:generated 1 sha256=…`). **Every task that edits `ccd/ccd` re-stamps before running any suite**, or `server/test/ownership.test.ts` reds:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **The citation tax is owed by every CITED file (contract §7 R9), not by `ccd/ccd` alone:** any insertion into a file the README or the frozen compaction-card corpus cites by line pays S6-R11 (`server/test/session-hook.test.ts`) in the same task — see "The citation tax, mechanised" below. The cited set is the census's to name; measured for THIS wave's files at planning (`grep -oE '(<file>)?:[0-9]+'` over the two corpus documents and `README.md` — the file prefix must be OPTIONAL: the corpus names a file once and continues citing it with bare `` `:N` `` anchors, and a file-prefixed-only grep undercounts the boundary below at `:19109` instead of the true `:19131`), exactly two are cited: `ccd/ccd` (Tasks 2 and 3 pay it) and `server/test/session-hook.test.ts` itself (cited up to `:7043-7056`; Task 3's edits there sit at the `byFile` map and the two ref arrays, ≈line 8180 and below, so they move no anchor — Task 3 Step 9's citation run is the measurement). `shared/api.ts`, the other cited file today, is not touched by this wave; no other file in the File Structure table is cited. **Edit length above the corpus's frozen anchors is a DECISION, not style (R9 makes it every wave's rule):** the two corpus documents cite `ccd/ccd` by line number up to `:19131` and may not be re-pointed by this branch, so every line added above that is a permanent move of their anchors. This plan therefore keeps every prose edit above line ~19131 LENGTH-NEUTRAL, adds only the code lines that cannot go anywhere else there (eight, all in Task 3), and puts every long argument below the lowest frozen anchor, beside `_child_tmpdir`.
- **The `_reg_get` census (contract §7 R10).** Every task that adds `_reg_get` calls to `ccd/ccd` re-measures `server/test/ccd-reg-get-census.test.ts`'s header sentence in THAT task, by the procedure Task 2 Step 5 writes down — the header's own two commands, the sentence rewritten in place with no new cardinal near it, the last-move line naming the mover. In this wave only Task 2 adds one (`_child_tmpdir`'s marker read, 155/131 → 156/132); Task 3 adds none, and its Step 9 runs the census test to prove it.
- **One run-id grammar (contract §7 R2).** `^[1-9][0-9]{0,9}$`, ASCII only — at most ten digits, no leading zero. ccd checks it ONLY through `_child_runid_valid` (Task 3), which shadows `LC_ALL=C`; wave 3 calls it at every parse (`--child-of`, the marker read on the fresh arm and on resume) and never re-spells the pattern, and wave 2's `ChildMark` reader accepts exactly the same set. Task 3 pins the single spelling with a literal-absence test: it counts verbatim copies of the pattern, so a second copy of it reds, while a differently spelled equivalent grammar passes undetected.
- **Single-definition:** `CHILD_ARGV_CAP` is spelled once in `server/src` (`capsupported.test.ts` scans for a second quoted copy); ccd's `echo child-argv-v1` and the test list are the other two spellings, held equal by `ccd-archive.test.ts`'s `toContain` line.
- **Locate code by CONTENT.** Line numbers in this plan are "as of `origin/main` `507aefe9` plus this branch at planning" and are hints, never addresses. Two other programmes (centralised-update-management W2–W5, gpt-lane 2b/3) are live against the same files.
- **Every forecast number is "at `507aefe9`".** The spec branch's tip at planning (`62d9c485`) did NOT contain `507aefe9` (`git merge-base --is-ancestor 507aefe9 HEAD` answered no there; it carried 21 fewer `ccd/ccd` lines and a different `ccd-route-argv` suite), which is why Task 2 opens with Step 0's merge — **the branch this wave ships from now CONTAINS `507aefe9`** (`git merge-base --is-ancestor 507aefe9 HEAD` answers yes), so Step 0's merge is a NO-OP SAFETY STEP: it still runs, still proves the citation cases are green before any edit, and still catches a `origin/main` that has moved further since, but on this branch it reports `Already up to date.` rather than doing any work. Where `origin/main` has moved on since, a different line number or test total with every case PASSING is not a red — the instrument's output is the authority and the difference goes in the commit message. Stop only on a FAILING case or a moved census composition you cannot explain.
- **Shell state does not survive between Bash calls.** Every code block in this plan that names `$SCRATCH` (or any other variable) sets it itself; `SCRATCH=<…>` lines mean "paste your own session's scratchpad, as an ABSOLUTE path". Never run half a block, and never rely on a variable an earlier block set — an empty `$SCRATCH` points every path at `/`.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`). One commit per task.
- **Commit trailers:** end every commit message with the attribution line your own session is given. The heredocs below end at the body for that reason.
- **No hostnames, IPs, tailnet names, docserver URLs or account names** anywhere in a committed file (`topology-clean.test.ts`).
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `ccd/ccd` | Modify — `_child_tmpdir` + `_child_runid_valid` inserted directly above `_spawn_start() {` (below every frozen corpus anchor); one line in `_spawn_start` becomes the `TMPDIR` splice; `cmd_ws_add`'s strip loop, refusal and marker write; `cmd_caps`'s token echo; two length-neutral prose edits (`_reg_get`'s census sentence, `_reg_purge`'s field inventory) | The box half: the marker, the containment, the token |
| `README.md` | Modify — the two `ccd/ccd:` anchors in the compaction-lifecycle bullet, re-pointed by the bytes their sentences quote (Tasks 2 and 3) | Operator anchors that must keep resolving |
| `server/test/session-hook.test.ts` | Modify — only the census literals the instrument moves, plus the S6-R11 composition comments (Task 3) | The citation debt, re-measured |
| `server/test/ccd-child-tmpdir.test.ts` | Create (Task 2) | `_child_tmpdir`'s three answers, a leaf another user owns refused among them (R1); `TMPDIR` on both spawn lines for a child and on neither for a non-child; the one-reader census |
| `server/test/ccd-ws-add-child.test.ts` | Create (Task 3) | `--child` parsed positionless, refused before any mint, ASCII in every locale, the run-id grammar spelled once (R2), written before the spawn, loud when it cannot land, purged with the row, advertised |
| `server/src/ccdargv.ts` | Modify — `CHILD_ARGV_CAP` directly after `ROUTE_ARGV_CAP`, the other `ws-add` argv-parsing token, as contract §1 places it (Task 3); `childFlags` after `routeFlags`, and `wsAddWorker`'s fourth parameter (Task 4) | The one place a run id becomes argv tokens, and the token that gates it |
| `server/test/ccd-archive.test.ts` | Modify — `KNOWN_CAPABILITY_TOKENS`, its import, one `toContain` (Task 3) | caps↔dispatcher parity, and the third spelling held equal |
| `server/test/capsupported.test.ts` | Modify — one `it` after the win-size one, one import (Task 3) | The token is spelled once and read with the refusing default |
| `server/test/whitelist-subset.test.ts` | Modify — `SAMPLES.wsAddWorker`, layer 2c `EXPECTED.wsAddWorker`, one new layer-2c `it` (Task 4) | The flagged argv crosses the agent's bare `['ws-add']` grant, token for token, in this order |
| `server/test/ccdargv-dec-parity.test.ts` | Modify — one appended `describe` (Task 4) | The argv the server composes is one the real binary records as a marker |
| `server/src/coord/dispatch.ts` | Modify — the fresh-spawn arm and its import (Task 5) | Sends `run.id`, or journals why it did not |
| `server/test/dispatch-child-argv.test.ts` | Create (Task 5) | Dispatch's gate, both polarities, the review kind, the resume arm |
| `server/test/run-routes.test.ts` | Modify — two exact event pins (Task 5) | The new omission row on a fixture box with no token |
| `server/test/coord-decide.test.ts` | Modify — one exact event count (Task 5) | Same |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | Modify — one paragraph in §2, directly after the `route` paragraph (Task 5) | The coordinator's reference names the new run event before a run trail shows it one — the `route-omitted` precedent |
| `server/test/coordinator-skill.test.ts` | Modify — one `it` in the linkage `describe` (Task 5) | Pins that paragraph, as `route-omitted`'s two events are pinned |

**Not modified, deliberately:** `agent/src/whitelist.ts` (the bare `['ws-add']` grant already carries every token after the prefix — `whitelist-subset.test.ts` layer 2 proves the flagged sample crosses it), `shared/api.ts` (wave 2 owns `ChildMark`), every PWA file, `ccd/ccrc`, the `ws-*` destructive verbs.

---

## Pre-flight findings (measured while planning; not deviations)

Each was measured on a prototype of this plan's exact edits, in a scratch clone at `origin/main` `507aefe9` merged with this branch (`62d9c485`). They are the reasons the tasks below look the way they do.

1. **`wsAddWorker`'s `--child` pair MUST come from a helper, not an inline ternary.** `ccdargv-dec-parity.test.ts`'s `decAppendingVerbs()` walks each `argv([…])` literal in `CCD_ARGV` up to its first `])`. The inline form `...(child === null ? [] : ['--child', String(child)])` closes a `])` inside the literal, the walk stops before `decFlags(`, and `ws-add` drops out of the derived set: `expected [ 'ws-archive', 'ws-hold', …(3) ] to deeply equal [ 'ws-add', 'ws-archive', …(4) ]`. Hence `childFlags` (Task 4) — and it is Task 4's mutation row 2.
2. **The omission event reds three existing exact pins.** Unlike `route-omitted:…`, which fires only when the caller asked for routing, `child-omitted:no-child-argv-cap` fires on EVERY fresh dispatch to a box without the token — and every existing dispatch fixture advertises none. Measured: `run-routes.test.ts` "records the transition with causedBy=coordinator" (exact `runEvents` list) and "refuses a second dispatch before touching the fleet at all" (`length` 2), and `coord-decide.test.ts` "dispatching the same run twice…" (`length` 2). Of the 42 server files that dispatch or read `runEvents`, these three are the only reds. Task 5 updates them.
3. **bash's `=~ ^[1-9][0-9]{0,9}$` is NOT ASCII under a UTF-8 locale.** Measured on bash 5.2.21 / glibc 2.39 with `LC_ALL=en_US.UTF-8`: it ACCEPTS `²`, `1²`, `٣`, `1٣`, `½`, `१`; with `local LC_ALL=C` it rejects all of them. `_child_runid_valid` shadows the locale exactly as `_pool_name_valid` does (D-2522's idiom).
4. **`ccd-auto-swap-pool.test.ts` reads a fixed 2400-character window** from the head of `_reg_purge`'s inventory paragraph and must find `` `stranded` `` inside it; measured headroom at base: `` `strandnotify` `` starts at 2249. A first draft that added a sentence ABOVE the list pushed `stranded` out of the window. Task 3's inventory edit is length-neutral and in place.
5. **The `_reg_get` census moves by one.** `ccd-reg-get-census.test.ts` compares the sentence "this file makes 155 invocations across 131 non-comment lines" with the live count; `_child_tmpdir`'s marker read makes it 156/132. Its second case refuses any other cardinal within 25 of those in that block, so the rewrite names no new number. Task 2 Step 5 is the procedure contract §7 R10 makes every later wave's: whichever task adds a `_reg_get` call re-measures this sentence in that task.
6. **Citation corpus:** with this plan's layout, Task 2 moves NO census literal (its only additions sit below `:19131`); README's two anchors move by the bytes they quote. Task 3's eight above-anchor lines leave `byFile['ccd/ccd']` at 147 with its composition moved two for two, keep the `|`-row array at 53 entries with two entering and two leaving, and take the site-level array 36 → 35. A first draft that put ~50 lines above the anchors instead also tripped the "nothing anchored by shortness alone" assertion (`ccd/ccd:19131` landed on `ccd/ccclip`), which has no re-measure path — the reason for the length discipline.
7. **`origin/main` itself carries a green-but-stale README anchor.** `507aefe9` (#169) re-pointed the `genrc == 1` anchor it saw red (`:19758-19760` → `:19776-19778`) and not `` `cmd_ensure` ``'s `:20970`, which `session-hook`'s sub-rule A keeps green through `cmd_ensure`'s function body while it points 19 lines above the call it quotes. This plan's re-pointer locates both anchors by the bytes their sentences quote, so Task 2 repairs that one too. **That repair is OUTSIDE this wave's scope** — no wave-1 requirement asks for it; the tool makes it because it works by content. It is named in the wave-done mail (Task 6, Step 6) as an unrelated repair, so the reviewer and the coordinators of the two other programmes live against README see it, and it is never presented as part of the wave.
8. **The wrapper chain preserves `TMPDIR`.** `shared/wrapper.mjs` generates each account wrapper as exactly: `export CLAUDE_CONFIG_DIR=…`, an optional secrets-file source, `exec "$HOME/.local/bin/<target>" "$@"` (`grep -c TMPDIR shared/wrapper.mjs` → `0`), and the launcher at `~/.local/bin/claude` does not mention it either. Task 1 still measures the whole chain end to end, because a secrets file is not something this plan may read.

---

## Ruled: an unusable temp root spawns uncontained (contract §7 R1)

Contract §1 as first written said `_spawn_start` composes `TMPDIR=$HOME/.cc-tmp/<id>` "**iff** `_reg_get "$id" child` is non-empty, after `mkdir -p -m 0700` of that directory", with no arm for a `mkdir`/`chmod` that fails or for a leaf that is already a symlink or a regular file. Contract §7 R1 ACCEPTS this plan's arm for those cases, and §1 now reads: `_spawn_start` composes `TMPDIR` iff the marker is non-empty AND the leaf is, or was just made, a real directory (not a symlink) owned by this user with mode 0700; otherwise the session spawns WITHOUT `TMPDIR` and ccd warns on stderr. That is `_child_tmpdir`'s rc 2, and this wave builds it as settled behaviour. So the implication runs one way only, by ruling — `TMPDIR` is composed ONLY for a marked row, but NOT for every marked row.

The argument stands at `_child_tmpdir`'s header (Task 2, Step 3): a refusal there would leave a swap or a supervisor restart with no session at all, which is strictly worse than scratch in `/tmp`; and following a planted leaf symlink would aim wave 3's removal somewhere else. Ownership needs no clause of its own: `chmod` by a user who does not own the leaf fails `EPERM`, so the `chmod` arm that re-privatises the leaf is also the ownership check, and Task 2 pins it with a leaf another user owns. Task 2's mutation row 7 (refuse on rc 2) is kept as the pin that holds the ruled form: it reds the moment a spawn refuses there.

**What the ruling obliges wave 3:** its reclaim tail must expect `$HOME/.cc-tmp/<id>` to be absent, a directory, a SYMLINK or a regular FILE — rc 2 leaves the last two shapes exactly where it found them — and it unlinks a symlink or regular-file leaf at exactly that path with `rm -f --`, never following it and never `-rf` (R1).

---

## The citation tax, mechanised (S6-R11)

`server/test/session-hook.test.ts` audits every `file:line` citation in two FROZEN corpus documents (`docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md`, `docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md`) and in `README.md`. Any line inserted into `ccd/ccd` moves every anchor below it — and so does an insertion into ANY file those documents cite by line, which is why contract §7 R9 makes the tax every cited file's (Global Constraints names the two this wave touches). The standing rule S6-R11: **README is REPAIRED, by content, never counted; everything else is RE-MEASURED from the instrument, with the composition stated; no rule is widened and no D-number is spent.**

Two tools do the mechanical half. Write both into your scratchpad once (they are measurement instruments — never committed), and use them in every task that edits `ccd/ccd`. `$SCRATCH` below is your session's scratchpad directory, as an ABSOLUTE path: write the two files to that absolute path, and open every shell block that runs them with `SCRATCH=<that path>` (Global Constraints — shell state does not survive between Bash calls).

- [ ] **Write the README re-pointer** to `$SCRATCH/repoint-readme.py`:

```python
#!/usr/bin/env python3
"""Re-point README.md's two `ccd/ccd:` anchors BY THE BYTES THEIR SENTENCES QUOTE.

README carries exactly two anchors into ccd/ccd, and each sentence names what it
points at: `cmd_ensure`'s `_reg_generation_init "$id"`, and the contended arm
`genrc == 1` (cited as the three lines around its `elif`, the convention every
earlier re-anchor of it used). Both are located in the working ccd/ccd by that
content — never by adding a shift to a number — and a README that carries any
OTHER ccd/ccd anchor is refused, so a third one can never be skipped silently.
Run from the repo root after every ccd/ccd edit, before re-measuring the census.
"""
import re
ccd = open('ccd/ccd', encoding='utf8').read().split('\n')
readme = open('README.md', encoding='utf8').read()
anchors = re.findall(r'ccd/ccd:\d+(?:-\d+)?', readme)
assert len(anchors) == 2, f'README carries {len(anchors)} ccd/ccd anchors, not the two this tool knows: {anchors}'
start = [i for i, l in enumerate(ccd) if l.startswith('cmd_ensure() {')]
assert len(start) == 1, 'cmd_ensure() is not defined exactly once'
nxt = next(i for i in range(start[0] + 1, len(ccd)) if re.match(r'^[A-Za-z_][A-Za-z0-9_]*\(\) \{', ccd[i]))
E = [i + 1 for i in range(start[0], nxt) if '_reg_generation_init "$id"' in ccd[i] and not ccd[i].lstrip().startswith('#')]
assert len(E) == 1, f'cmd_ensure calls _reg_generation_init "$id" {len(E)} times'
L = [i + 1 for i, l in enumerate(ccd) if l.strip() == 'elif (( genrc == 1 )); then']
assert len(L) == 1, 'the genrc == 1 arm is not unique'
e, l = E[0], L[0]
new, n1 = re.subn(r'(`_reg_generation_init "\$id"`, `ccd/ccd:)(\d+)(`)', lambda m: f'{m.group(1)}{e}{m.group(3)}', readme)
new, n2 = re.subn(r'(the contended arm \(`ccd/ccd:)(\d+-\d+)(`, `genrc == 1`\))', lambda m: f'{m.group(1)}{l - 1}-{l + 1}{m.group(3)}', new)
assert n1 == 1 and n2 == 1, 'a README anchor sentence changed shape; re-point it by hand'
print(f'cmd_ensure mint   -> ccd/ccd:{e}      ({ccd[e - 1].strip()})')
print(f'genrc == 1 arm    -> ccd/ccd:{l - 1}-{l + 1}  (elif at {l})')
open('README.md', 'w', encoding='utf8').write(new)
```

- [ ] **Write the census re-measurer** to `$SCRATCH/cite-remeasure.py`:

```python
#!/usr/bin/env python3
"""Re-measure session-hook.test.ts's citation census FROM THE INSTRUMENT (S6-R11).

Run from the repo root AFTER ccd/ccd is re-stamped and README.md is re-pointed.
It runs ONLY the citation cases twice — once with ccd/ccd and README.md as they
stand at <base-ref>, once as they stand in the working tree — each time with
four dump probes inserted above the assertions they feed, and restores every
file it touched byte-for-byte (asserted). It prints what the test STATES, what
the instrument MEASURES, and the COMPOSITION (which references entered and
which left, base -> tree), which is what the S6-R11 comment must state.
With --write it rewrites exactly four literals in the test — `'ccd/ccd': N` in
the byFile map, `.toBe(N)` on `total`, and the two ref arrays of the `|`-row
case — in the instrument's own order. It never edits a comment.
usage: python3 cite-remeasure.py <scratch-dir> <base-ref> [--write]
"""
import collections, json, os, re, shutil, subprocess, sys
scratch, base = sys.argv[1], sys.argv[2]; write = '--write' in sys.argv
T = 'server/test/session-hook.test.ts'
out = os.path.join(scratch, 'cite'); os.makedirs(out, exist_ok=True)
src = open(T, encoding='utf8').read()
SITE_EXPR = ("      `${f.doc}:${f.line} ${refKey(f)}`;",
             "    const seen = new Set([...audit(realCorpus()).failures, ...filesAudit(realCorpus()).failures].map(site));")
for expr in SITE_EXPR:
    assert src.count(expr) == 1, f'the site-level expression changed in the test; update this probe: {expr}'
ROW_ANCHOR = "    expect(r.failures.map(refKey), 'a `|` row stopped naming what the ROW quotes — re-measure')"
BYFILE_ANCHOR = "    expect(byFile, 'the citation debt moved"

def probed(dump):
    """The test with the probes in. The site-level list is computed ABOVE the
    row array's expect, because that expect reds first and would stop the `it`
    before the site-level one ran; the two expression lines are asserted above
    to be the test's own, so this copy cannot drift from what it copies."""
    t = src
    for a in (ROW_ANCHOR, BYFILE_ANCHOR):
        assert t.count(a) == 1, f'probe anchor not unique: {a[:50]}'
    t = t.replace(BYFILE_ANCHOR,
        f"    fs.writeFileSync({json.dumps(dump + '/byfile.json')}, JSON.stringify({{ byFile, "
        "sites: r.failures.map((f) => `${f.doc}:${f.line} ${refKey(f)}`) }));\n" + BYFILE_ANCHOR)
    t = t.replace(ROW_ANCHOR,
        f"    fs.writeFileSync({json.dumps(dump + '/rows.json')}, JSON.stringify(r.failures.map(refKey)));\n"
        "    { const site = (f: { doc: string; line: number; file: string; from: number; to: number }): string =>\n"
        f"{SITE_EXPR[0]}\n{SITE_EXPR[1]}\n"
        f"    fs.writeFileSync({json.dumps(dump + '/sites.json')}, "
        "JSON.stringify(r.failures.map(site).filter((k) => seen.has(k)))); }\n" + ROW_ANCHOR)
    return t

def measure(label):
    dump = os.path.join(out, label); os.makedirs(dump, exist_ok=True)
    for f in ('byfile.json', 'rows.json', 'sites.json'):
        if os.path.exists(os.path.join(dump, f)): os.remove(os.path.join(dump, f))
    open(T, 'w', encoding='utf8').write(probed(dump))
    try:
        subprocess.run(['./node_modules/.bin/vitest', 'run', 'test/session-hook.test.ts', '-t',
                        'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND'],
                       cwd='server', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=580)
    finally:
        open(T, 'w', encoding='utf8').write(src)
    b = json.load(open(os.path.join(dump, 'byfile.json')))
    return (b['byFile'], b['sites'], json.load(open(os.path.join(dump, 'rows.json'))),
            json.load(open(os.path.join(dump, 'sites.json'))))

saved = {p: open(p, encoding='utf8').read() for p in ('ccd/ccd', 'README.md')}
try:
    for p in saved:
        open(p, 'w', encoding='utf8').write(
            subprocess.run(['git', 'show', f'{base}:{p}'], capture_output=True, text=True, check=True).stdout)
    B = measure('base')
finally:
    for p, body in saved.items(): open(p, 'w', encoding='utf8').write(body)
for p, body in saved.items():
    assert open(p, encoding='utf8').read() == body, f'{p} was not restored byte-for-byte'
N = measure('tree')
assert open(T, encoding='utf8').read() == src, 'the test file was not restored byte-for-byte'

ENTRY = re.compile(r"^        '[^']*',$")
def array_block(text, head):
    """[start, end) of the CONTIGUOUS run of `        '<ref>',` lines in this
    expect's array. Comments above the first entry lie outside it and are never
    touched; a non-entry line INSIDE the run is refused."""
    i = text.index(head); j = text.index('.toEqual([', i); k = text.index('\n      ]);', j)
    lines = text[j:k].split('\n')
    idx = [n for n, l in enumerate(lines) if ENTRY.match(l)]
    assert idx and idx == list(range(idx[0], idx[-1] + 1)), f'the array under {head[:40]} is not one contiguous run; edit by hand'
    s = j + sum(len(l) + 1 for l in lines[:idx[0]])
    return s, s + sum(len(l) + 1 for l in lines[idx[0]:idx[-1] + 1]) - 1
def stated(head):
    s, e = array_block(src, head)
    return re.findall(r"^\s+'([^']*)',$", src[s:e], re.M)
def moved(a, b):
    ca, cb = collections.Counter(a), collections.Counter(b)
    return sorted((cb - ca).elements()), sorted((ca - cb).elements())

ROW_HEAD = "expect(r.failures.map(refKey), 'a `|` row stopped naming"
SITE_HEAD = "expect(r.failures.map(site).filter((k) => seen.has(k)),"
by, total = N[0], sum(N[0].values())
stated_cc = re.search(r"^      'ccd/ccd': (\d+),$", src, re.M).group(1)
stated_total = re.search(r"this is it'\)\.toBe\((\d+)\);", src).group(1)
print(f"byFile['ccd/ccd']  stated {stated_cc}  base {B[0].get('ccd/ccd')}  tree {by.get('ccd/ccd')}")
print(f"total              stated {stated_total}  base {sum(B[0].values())}  tree {total}")
print(f"other byFile keys moved: {sorted(k for k in set(B[0]) | set(by) if k != 'ccd/ccd' and B[0].get(k) != by.get(k)) or 'none'}")
e, l = moved(B[1], N[1]); print(f"byFile composition  ENTERED {e}\n                    LEFT    {l}")
for name, head, bv, nv in (('row array', ROW_HEAD, B[2], N[2]), ('site array', SITE_HEAD, B[3], N[3])):
    e, l = moved(bv, nv)
    print(f"{name}: stated {len(stated(head))}  base {len(bv)}  tree {len(nv)}\n    ENTERED {e}\n    LEFT    {l}")
if write:
    t = src
    t = re.sub(r"^(      'ccd/ccd': )\d+,$", lambda m: f"{m.group(1)}{by['ccd/ccd']},", t, count=1, flags=re.M)
    t = re.sub(r"(this is it'\)\.toBe\()\d+(\);)", lambda m: f"{m.group(1)}{total}{m.group(2)}", t, count=1)
    for head, got in ((ROW_HEAD, N[2]), (SITE_HEAD, N[3])):
        s, e2 = array_block(t, head)
        t = t[:s] + '\n'.join(f"        '{v}'," for v in got) + t[e2:]
    open(T, 'w', encoding='utf8').write(t)
    print('rewrote the four literals from the instrument; now write the S6-R11 composition comment by hand')
```

**The procedure, per `ccd/ccd`-editing task** (each task restates it as numbered steps):

1. Re-stamp `ccd/ccd`.
2. `SCRATCH=<abs path>; python3 "$SCRATCH/repoint-readme.py"` — README first, because the census describes a tree about to change if it is measured before the README repair lands.
3. `SCRATCH=<abs path>; python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD` — read-only. **If any `base` value differs from its `stated` value, the tree was red before your edit: stop and report it; it is not this task's to fix.** Then compare the `tree` values and the composition with the forecast the task gives.
4. Only if something moved: re-run with `--write`, then write the S6-R11 composition comment the task gives (or your own measured one), then run the citation cases green.
5. **Both corpus documents must be byte-identical to `origin/main`** — measure it, because it is the premise that makes every move "drift" rather than "repair":

       git fetch origin main && git diff --quiet origin/main -- \
         docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
         docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen

   Expected: `corpus-frozen`.

The forecasts in Tasks 2 and 3 were measured on `origin/main` `507aefe9` + this branch. If `ccd/ccd` on your base differs above the 13xxx region, the composition will differ — the instrument's output is then the only authority, and the difference goes in your commit message. (Measured by review on the spec branch's tip WITHOUT `507aefe9` — the case Task 2's Step 0 exists to prevent — the composition matched the forecast exactly while the README line numbers differed: 21025 / 19812-19814 after Task 2 and 21061 / 19848-19850 after Task 3.)

---

### Task 1: Measure where Claude Code's scratchpad lands when `TMPDIR` is set

**Model routing:** `sonnet`, effort `medium`. One headless turn on this worker's own account, a `find`, and a verdict. **No code, no commit, no fleet mutation.**

**Files:** none in the repo. Evidence lands in `$SCRATCH/tmpdir-probe/` and in the wave-done mail.

**Interfaces:**
- Consumes: this worktree's own registry row, READ ONLY (`$HOME/.cc-sessions/<id>.wrapper`, and `<id>.hookstate.json`'s timestamp as the no-write proof), to run the probe through the same wrapper chain a child's pane runs.
- Produces: one verdict word — `follows`, `does-not-follow` or `not-created` — plus the raw evidence, for the coordinator to write into the programme ledger (contract §1, measurement (a)). Nothing in this wave consumes it; spec §5.2 says what each answer means for wave 3.

Why it is measured and not assumed (spec §5.2): whether Claude Code's harness scratchpad follows `TMPDIR` is a claim about another program. `ccd-tmp-sweep` states its root as `${TMPDIR:-/tmp}/claude-<uid>/`, which is the same claim, and nothing has measured it.

Every block below is SELF-CONTAINED — it re-derives what it needs, because shell state does not survive between Bash calls (Global Constraints). Paste your own absolute scratchpad path into each `SCRATCH=` line.

- [ ] **Step 1: Resolve this session's wrapper, read-only**

```bash
SCRATCH=<your scratchpad, absolute>
TOP=$(git rev-parse --show-toplevel)
SID="$(basename "$(dirname "$TOP")")-$(basename "$TOP")"
test -f "$HOME/.cc-sessions/$SID.uuid" && echo "row: $SID" || echo "NO ROW for $SID"
W=$(cat "$HOME/.cc-sessions/$SID.wrapper") && test -x "$HOME/.local/bin/$W" && echo "wrapper resolved"
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] && echo "scratch ok" || echo "STOP: SCRATCH is not an absolute directory"
```

Expected: `row: <project>-<slug>`, `wrapper resolved` and `scratch ok`. Do not print `$W` into anything committed (account names are topology). If there is no row, stop and report — the probe must run through a real wrapper.

- [ ] **Step 2: Run one headless turn with `TMPDIR` pointed at an empty private directory — as a CHILD's pane would, not as this pane is**

The prompt asks for a FILE in the scratchpad, so the scratchpad has to exist for the answer to be anything but a refusal. `--dangerously-skip-permissions` is the flag a child's pane runs with (`_spawn_start`'s spawn line).

**The probe must NOT inherit this session's identity.** Run bare from this pane, the nested `claude` would inherit `TMUX`, `TMUX_PANE`, `CCRC_SESSION_GENERATION` and the parent's `CLAUDECODE`/`CLAUDE_CODE_*` variables. Every account home installs `ccd/session-hook.sh`, which finds its session from `TMUX_PANE` plus `tmux display-message -p '#S'` and authorises its write with the inherited generation — so the probe's SessionStart/PostToolUse/Stop events would rewrite THIS worker's own `$REG/<id>.hookstate.json` (`done`, `working`, `done`) mid-turn: a write to the live registry this wave promises not to make, and a flip of the state idle-gated mail delivery reads. A real child's pane carries none of those variables either, so stripping them is also what makes the probe faithful. `TMPDIR` is the ONLY variable deliberately set. The hookstate file's timestamp is read before and after, in the SAME block (this pane's own hooks fire only around the whole Bash call, never inside it), to prove nothing was written.

```bash
SCRATCH=<your scratchpad, absolute>
TOP=$(git rev-parse --show-toplevel); SID="$(basename "$(dirname "$TOP")")-$(basename "$TOP")"
W=$(cat "$HOME/.cc-sessions/$SID.wrapper" 2>/dev/null); P="$SCRATCH/tmpdir-probe"
HS="$HOME/.cc-sessions/$SID.hookstate.json"
if [[ "$SCRATCH" != /* || ! -d "$SCRATCH" || -z "$W" || ! -x "$HOME/.local/bin/$W" ]]; then
  echo "STOP: SCRATCH or the wrapper did not resolve — nothing was run"
else
  before=$(stat -c %y "$HS" 2>/dev/null || echo absent)
  rm -rf "$P" && mkdir -p "$P/tmp" "$P/cwd" && chmod 0700 "$P/tmp"
  # -u for every inherited session variable; names only, never values.
  STRIP=$(env | sed -n 's/^\(TMUX\|TMUX_PANE\|CLAUDECODE\|CLAUDE_CODE_[A-Z0-9_]*\|CCRC_[A-Z0-9_]*\)=.*/-u \1/p' | sort -u)
  ( cd "$P/cwd" && env $STRIP TMPDIR="$P/tmp" timeout 300 "$HOME/.local/bin/$W" -p \
      'Create a file named probe.txt containing the word ok inside your scratchpad directory, then reply with only the absolute path of that file.' \
      --dangerously-skip-permissions > "$P/answer.txt" 2> "$P/stderr.txt"; echo "rc=$?" )
  after=$(stat -c %y "$HS" 2>/dev/null || echo absent)
  [[ "$before" == "$after" ]] && echo "registry untouched (hookstate $before)" || echo "REGISTRY WRITTEN: hookstate $before -> $after"
  echo "--- answer";            cat "$P/answer.txt"
  echo "--- under TMPDIR";      find "$P/tmp" -mindepth 1 -maxdepth 6 | sort
  echo "--- under /tmp (this cwd's slug only, with its tree)"
  find "/tmp/claude-$(id -u)" -maxdepth 1 -name '*tmpdir-probe-cwd*' -exec find {} -maxdepth 3 \; 2>/dev/null | sort
fi
```

Expected: `rc=0`, `registry untouched (hookstate …)`, an absolute path in the answer, and EITHER the first listing (under `TMPDIR`) OR the second (the `…tmpdir-probe-cwd…` directory under `/tmp/claude-<uid>/` and its tree) showing a `…/scratchpad/probe.txt`. **`REGISTRY WRITTEN` is a stop:** report it with both timestamps, and do not re-run the probe until the strip list is fixed — a second run would write again.

- [ ] **Step 3: Classify, from the evidence and nothing else**

- `follows` — the answered path starts with `$P/tmp/` AND `test -f` on it succeeds.
- `does-not-follow` — the answered path starts with `/tmp/claude-$(id -u)/` AND `test -f` on it succeeds.
- `not-created` — neither (no path, a path that does not exist, or a refusal). Then also report what `find "$P/tmp"` listed, because a `claude-<uid>/` directory there without a scratchpad still says the per-uid root follows `TMPDIR`.

```bash
SCRATCH=<your scratchpad, absolute>; P="$SCRATCH/tmpdir-probe"
if [[ "$SCRATCH" != /* || ! -f "$P/answer.txt" ]]; then echo "STOP: no probe answer at $P — Step 2 did not run"; else
A=$(tr -d '\r\n' < "$P/answer.txt")
case "$A" in
  "$P/tmp/"*)                [ -f "$A" ] && echo "VERDICT follows"         || echo "VERDICT not-created (path given, file absent)" ;;
  "/tmp/claude-$(id -u)/"*)  [ -f "$A" ] && echo "VERDICT does-not-follow" || echo "VERDICT not-created (path given, file absent)" ;;
  *)                                          echo "VERDICT not-created (no usable path)" ;;
esac
fi
```

- [ ] **Step 4: Keep the evidence, clean the probe**

Copy `answer.txt`, both `find` listings, the `registry untouched` line and the verdict line into your wave-done notes, then (one block) `SCRATCH=<your scratchpad, absolute>; [[ "$SCRATCH" == /* ]] && rm -rf "$SCRATCH/tmpdir-probe"`. A probe directory left under `/tmp/claude-<uid>/` is `ccd-tmp-sweep`'s to collect; do not delete anything there by hand.

**What each verdict means, stated so the coordinator does not have to re-derive it (spec §5.2):** `follows` — a child's scratchpad lands inside `~/.cc-tmp/<id>` and wave 3's reclaim removes it with the child. `does-not-follow` — it stays under `/tmp/claude-<uid>/`, where `ccd-tmp-sweep` already collects it by session id; nothing may ever delete a directory keyed on the workspace path there. `not-created` — re-measure interactively in wave 3 before its tail relies on either.

---

### Task 2: A child's `TMPDIR`, driven by the marker, on every spawn path

**Model routing:** `sonnet`, effort `high` — `ccd`'s spawn neighbourhood, and the corpus tax.

**Files:**
- Modify: `ccd/ccd` — insert `_child_tmpdir` directly above `_spawn_start() {` (after `_resume_env`'s closing brace); replace ONE line inside `_spawn_start` (`resenv="$resenv${routeenv:+ $routeenv}"`); rewrite `_reg_get`'s census sentence in place (same line count)
- Modify: `README.md` (by the re-pointer)
- Test: `server/test/ccd-child-tmpdir.test.ts` (new)

**Interfaces:**
- Consumes: `_reg_get "$id" child` (`$REG/<id>.child`, written by Task 3; planted with `_reg_set` in this task's tests).
- Produces: the bash function `_child_tmpdir <id>` → rc 0 with the path `$HOME/.cc-tmp/<id>` on stdout (a real directory, not a symlink, owned by this user, mode 0700) | rc 1 not a child (nothing created) | rc 2 a child whose leaf is not, and could not be made, that (one `ccd: warn:` line on stderr). `_spawn_start` exports `TMPDIR='$HOME/.cc-tmp/<id>'` in the launch `env` iff rc 0, on BOTH spawn lines — so a MARKED row whose leaf is unusable (rc 2) spawns without it, as contract §7 R1 rules ("Ruled: an unusable temp root spawns uncontained"). Wave 3's reclaim tail removes `$HOME/.cc-tmp/<id>` (contract §3) and must expect it to be a symlink or a file, the two shapes rc 2 leaves in place — which it unlinks with `rm -f --`, never following it and never `-rf` (R1).

- [ ] **Step 0: Confirm the branch already carries the base the forecasts were measured on (no-op safety step)**

The forecasts in Tasks 2–4 were measured at `origin/main` `507aefe9` plus the spec branch. This branch already CONTAINS `507aefe9` (measured at planning: `git merge-base --is-ancestor 507aefe9 HEAD` answers yes), so this step is a NO-OP on it — the merge below is expected to report `Already up to date.` It still runs, and stays in the plan, as a safety net: it also catches `origin/main` having moved PAST `507aefe9` since planning, which the merge would then bring in for real. Prove the citation cases are green on the tree BEFORE any edit either way — a red here is the base's, not this wave's.

```bash
git fetch origin main && git merge --no-edit origin/main && git log -1 --format='%h %s'
git merge-base --is-ancestor 507aefe9 HEAD && echo "base carries 507aefe9"
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: `Already up to date.` (the ordinary case on this branch), `base carries 507aefe9`, and `7 passed | 326 skipped`. If the merge instead does real work — `origin/main` moved past `507aefe9` since planning — it should still succeed cleanly; if it conflicts, stop and report — do not resolve a conflict in `ccd/ccd` or `README.md` by hand in this task. Either way, if `origin/main` has moved past `507aefe9`, every forecast below is a hint and the instrument is the authority (Global Constraints).

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-child-tmpdir.test.ts`:

```ts
// A CHILD's temp root (child-workspace reclamation, spec §5.2, wave 1).
//
// ccd exports `TMPDIR=$HOME/.cc-tmp/<id>` into the launch environment of a
// session whose registry row carries `$REG/<id>.child`, and of no other
// session. Three properties, each pinned here because each is a way the
// containment could quietly stop meaning anything:
//   1. It is driven by the MARKER, never by a flag or a string — so every
//      respawn keeps it, and nothing that is not a child ever gets it.
//   2. It is composed ONCE, into the `env` string BOTH spawn lines splice, so
//      the `--resume` retry cannot spawn a differently-contained pane.
//   3. It never refuses a spawn. A child whose root cannot be made private is
//      warned about and spawned with the box's own TMPDIR — a supervisor
//      restart that died here would leave no session at all.
//
// Everything runs in the isolated fixture HOME (`makeCcdHarness`) with a bash
// `tmux()` stub that RECORDS instead of running; `claude` is never launched —
// the composed command line is read off the recorded `tmux new-session` argv.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, WIDE_PANE_IF_UP, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-child-tmpdir-'); });
afterEach(() => { h.cleanup(); });

/** `h.sh` without its two blind spots: it throws on non-zero and returns no
 *  status. `exec 2>&1` merges the streams in the CURRENT shell, so nothing
 *  wraps the snippet (`ccd-spawn-split.test.ts`'s rule). */
const shStatus = (snippet: string): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

/** `ccd-spawn-split.test.ts`'s two substrates: one where every spawn makes a
 *  pane, and one where the `--resume` spawn leaves none, so `_spawn_start`
 *  emits BOTH of its spawn lines. */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    ${WIDE_PANE_IF_UP}
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
    esac
  };`;
const RESUME_DIES = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    ${WIDE_PANE_IF_UP}
    case "$1" in
      new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
    esac
  };`;

const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const tmpRoot = (): string => path.join(h.home, '.cc-tmp');
const leaf = (id: string): string => path.join(tmpRoot(), id);
const mode = (p: string): number => fs.statSync(p).mode & 0o777;

/** The three fields `_spawn_start` refuses without, plus the marker when given. */
const seed = (id: string, child: string | null): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  if (child !== null) h.sh(`_reg_set ${id} child '${child}'`);
};

/** A real directory some OTHER user owns, found by MEASURING, never by name
 *  alone: `/usr` qualifies iff it is a directory whose owner is not the running
 *  uid. Never under uid 0 — root owns it, and root's `chmod` succeeds on
 *  anything; the fleet runs ccd as one unprivileged user. */
const RUN_UID = process.getuid?.() ?? 0;
const FOREIGN_DIR: string | null = (() => {
  try {
    const st = fs.statSync('/usr');
    return RUN_UID !== 0 && st.isDirectory() && st.uid !== RUN_UID ? '/usr' : null;
  } catch { return null; }
})();

describe('_child_tmpdir — three answers, told apart', () => {
  it('rc 1 for a row with no marker, and creates NOTHING', () => {
    seed('demo-quiet-mesa', null);
    const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
    expect(r.out).toBe('[rc=1]\n');
    expect(fs.existsSync(tmpRoot()), 'a non-child must not even create the parent').toBe(false);
  });

  it('rc 0 for a child: prints the path, and both directories exist at 0700', () => {
    seed('demo-quiet-mesa', '7');
    const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
    expect(r.out).toBe(`${leaf('demo-quiet-mesa')}[rc=0]\n`);
    expect(mode(leaf('demo-quiet-mesa'))).toBe(0o700);
    expect(mode(tmpRoot()), 'a root this function CREATED is private too').toBe(0o700);
  });

  it('re-privatises a leaf that already exists wider — a respawn does not inherit a loosened mode', () => {
    seed('demo-quiet-mesa', '7');
    fs.mkdirSync(leaf('demo-quiet-mesa'), { recursive: true, mode: 0o755 });
    fs.chmodSync(leaf('demo-quiet-mesa'), 0o755);
    expect(shStatus('_child_tmpdir demo-quiet-mesa >/dev/null; echo "[rc=$?]"').out).toBe('[rc=0]\n');
    expect(mode(leaf('demo-quiet-mesa'))).toBe(0o700);
  });

  it('rc 2 for a child whose leaf is a SYMLINK — refused, warned, and the target untouched', () => {
    seed('demo-quiet-mesa', '7');
    const target = path.join(h.home, 'elsewhere');
    fs.mkdirSync(target, { mode: 0o755 });
    fs.chmodSync(target, 0o755);
    fs.mkdirSync(tmpRoot(), { mode: 0o700 });
    fs.symlinkSync(target, leaf('demo-quiet-mesa'));
    const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
    expect(r.out).toContain('[rc=2]');
    expect(r.out).toContain('ccd: warn: demo-quiet-mesa is a child but');
    expect(r.out, 'rc 2 prints no path on stdout').not.toContain(`${leaf('demo-quiet-mesa')}[rc`);
    expect(mode(target), 'the link was followed and its target re-moded').toBe(0o755);
  });

  it('rc 2 for a child whose leaf is a regular FILE', () => {
    seed('demo-quiet-mesa', '7');
    fs.mkdirSync(tmpRoot(), { mode: 0o700 });
    fs.writeFileSync(leaf('demo-quiet-mesa'), 'x');
    expect(shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"').out).toContain('[rc=2]');
  });

  it.skipIf(FOREIGN_DIR === null)('rc 2 for a child whose leaf is a real directory this user does NOT own — the chmod is the ownership check', () => {
    // Spec §5.2 as ruled: rc 0 only for a leaf that is a real directory, not a
    // symlink, OWNED BY THIS USER, at 0700. The root may be a symlink (the case
    // below), so aim it at `/` and name the child `usr`: its leaf is then a
    // real, non-symlink directory another user owns. chmod(2) by a non-owner
    // fails EPERM, so the chmod arm refuses it — and changes nothing there.
    h.sh(`_reg_set usr child '7'`);
    const before = mode(FOREIGN_DIR!);
    fs.symlinkSync('/', tmpRoot());
    try {
      const r = shStatus('_child_tmpdir usr; echo "[rc=$?]"');
      expect(r.out).toContain('[rc=2]');
      expect(r.out).toContain('ccd: warn: usr is a child but');
      expect(mode(FOREIGN_DIR!), 'a foreign directory was re-moded').toBe(before);
    } finally {
      // Never leave a link to `/` for the harness's recursive cleanup to meet.
      fs.unlinkSync(tmpRoot());
    }
  });

  it('FOLLOWS a symlinked ROOT — `$HOME/.cc-tmp` on a data volume is the `$HOME/projects` shape', () => {
    seed('demo-quiet-mesa', '7');
    const vol = path.join(h.home, 'data-cc-tmp');
    fs.mkdirSync(vol, { mode: 0o700 });
    fs.symlinkSync(vol, tmpRoot());
    const r = shStatus('_child_tmpdir demo-quiet-mesa; echo "[rc=$?]"');
    expect(r.out).toBe(`${leaf('demo-quiet-mesa')}[rc=0]\n`);
    expect(fs.statSync(path.join(vol, 'demo-quiet-mesa')).isDirectory()).toBe(true);
  });
});

describe('_spawn_start exports TMPDIR for a child, and only for a child', () => {
  it('a child spawns with TMPDIR at its own root, spliced into the env string exactly once', () => {
    seed('demo-quiet-mesa', '7');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new`);
    const news = newSessions();
    expect(news).toHaveLength(1);
    const want = `TMPDIR='${leaf('demo-quiet-mesa')}'`;
    expect(news[0]!.split(want).length - 1, news[0]).toBe(1);
    // Inside the `env` prefix, before the wrapper — not trailing after the
    // claude argv, where it would be an argument rather than an environment.
    expect(news[0]!.indexOf(want)).toBeLessThan(news[0]!.indexOf(`/.local/bin/claude'`));
    expect(news[0]!.indexOf('exec env ')).toBeLessThan(news[0]!.indexOf(want));
  });

  it('a row with NO marker spawns with no TMPDIR at all — byte-identical to before', () => {
    seed('demo-quiet-mesa', null);
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new`);
    expect(newSessions()[0]).not.toContain('TMPDIR=');
    expect(fs.existsSync(tmpRoot())).toBe(false);
  });

  it('a dispatched worker WITHOUT a marker (`rc=off`) is not a child — nothing infers it from --no-rc', () => {
    // The carried constraint "two authorities, always": `--no-rc` is the
    // dispatch path's OTHER declaration, and it must not stand in for this one.
    seed('demo-quiet-mesa', null);
    h.sh('_reg_set demo-quiet-mesa rc off');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new`);
    expect(newSessions()[0]).not.toContain('TMPDIR=');
  });

  it('BOTH spawn lines carry it when the --resume attempt dies and the retry runs', () => {
    seed('demo-quiet-mesa', '7');
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa resume 2>/dev/null`);
    const news = newSessions();
    expect(news).toHaveLength(2);
    expect(news[0]).toContain('--resume');
    expect(news[1]).toContain('--session-id');
    for (const line of news) expect(line).toContain(`TMPDIR='${leaf('demo-quiet-mesa')}'`);
  });

  it('a child whose root is unusable STILL SPAWNS — uncontained, warned, never refused', () => {
    seed('demo-quiet-mesa', '7');
    fs.mkdirSync(tmpRoot(), { mode: 0o700 });
    fs.writeFileSync(leaf('demo-quiet-mesa'), 'x');
    const r = shStatus(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start demo-quiet-mesa new; echo "[rc=$?]"`);
    expect(r.out).toContain('[rc=0]');
    expect(r.out).toContain('could not be made a private directory');
    const news = newSessions();
    expect(news).toHaveLength(1);
    expect(news[0]).not.toContain('TMPDIR=');
  });

  it('the decision lives in _spawn_start and NOWHERE else — one reader, every spawn path', () => {
    // Every launcher funnels through `_spawn_start` (`ccd-spawn-split.test.ts`
    // pins that caller list), so one call there covers ws-add, ws-restore,
    // start, ensure, swap and both `_supervised_start` fallbacks. A second
    // call site would be a second decision free to disagree with the first.
    const out = h.sh(
      'fns=$(declare -F | sed "s/^declare -f //");'
      + ' printf "COUNT=%s\\n" "$(printf %s "$fns" | grep -c .)";'
      + ' while read -r f; do [[ "$f" == _child_tmpdir ]] && continue;'
      + ' type "$f" 2>/dev/null | grep -q "_child_tmpdir" && echo "$f"; done'
      + ' <<< "$fns" | sort; :');
    const lines = out.split('\n').filter(Boolean);
    const count = Number((lines.shift() ?? '').replace('COUNT=', ''));
    expect(count, 'the function walk was truncated — a failed measurement, not a short list')
      .toBeGreaterThan(100);
    expect(lines).toEqual(['_spawn_start']);
    // And its ONE input is the marker.
    expect(h.sh('type _child_tmpdir')).toContain('_reg_get "$id" child');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-child-tmpdir.test.ts`

Expected: FAIL — `Tests 11 failed | 2 passed (13)` (measured at this branch's tip after the `507aefe9` merge). The two that pass are the regression controls "a row with NO marker spawns with no TMPDIR at all" and "a dispatched worker WITHOUT a marker (`rc=off`) is not a child" (true of today's ccd, and they must stay true). The other eleven fail on `_child_tmpdir: command not found` (the `_child_tmpdir` cases see `[rc=127]`) or on the absent `TMPDIR='…'`. The foreign-owner case RUNS on any box where `/usr` is a directory another uid owns and the suite is not root — the fleet box, measured, and any CI runner that does not run as root; it is skipped only under uid 0, where `chmod` succeeds on anything and the property it pins does not hold.

- [ ] **Step 3: Insert `_child_tmpdir` directly above `_spawn_start`**

Locate: `grep -n '^_spawn_start() {' ccd/ccd` (≈19429 at planning; it is preceded by `_resume_env`'s closing `}` and one blank line). Insert this block immediately above that line — below every frozen corpus anchor, which is why the whole argument lives here:

```bash
# ── A CHILD'S TEMP ROOT (child-workspace reclamation, spec §5.2) ─────────────
# A workspace minted by `ws-add --child <runId>` carries `$REG/<id>.child`, and
# ONLY such a workspace spawns with TMPDIR pointed at `$HOME/.cc-tmp/<id>` — a
# directory the reclaim tail removes, so tool scratch that follows TMPDIR
# (`cdk.out` foremost) dies with the child by construction instead of by a
# second collector chasing paths. Every other session keeps the box's own
# TMPDIR: exporting this fleet-wide would move uncollected scratch out of an
# OS-reclaimed /tmp into $HOME for sessions that have no collector, which is a
# different spec (§5.2, "Children only").
#
# DRIVEN BY THE MARKER, NEVER BY ws-add's ARGV, and read in the one function
# every spawn path funnels through — `cmd_ws_add`, `cmd_ws_restore`,
# `cmd_start`, `cmd_ensure` (so every `Restart=always` respawn), `_spawn` (swap
# and friends) and both `_supervised_start` fallbacks. A decision taken in
# `cmd_ws_add` alone would be lost at the first respawn.
#
# WHETHER CLAUDE CODE'S OWN SCRATCHPAD FOLLOWS TMPDIR is a claim about another
# program; it is measured by the wave that shipped this and recorded in the
# programme ledger, never assumed here. If it does not, that scratchpad stays
# under `/tmp/claude-<uid>/`, where `ccd-tmp-sweep` already collects it.
#
# THREE ANSWERS, NOT TWO, because the caller acts on two of them differently
# and must be able to tell the third apart:
#   0  a child, and its leaf is a real directory, ours, at 0700 — path on stdout;
#   1  not a child (no marker) — spawn exactly as before this existed;
#   2  a child whose leaf is not that — warned on stderr, and the caller spawns
#      WITHOUT TMPDIR rather than refusing (spec §5.2, a ruled arm): a refusal
#      would leave a swap or a supervisor restart with no session at all.
# THE LEAF MUST NOT BE A SYMLINK: wave 3's tail removes it, and a planted link
# would aim that removal elsewhere — so that tail unlinks a link or file leaf
# with `rm -f --`, never following it. OWNERSHIP is the `chmod`: it fails EPERM
# on a leaf another user owns. `$HOME/.cc-tmp` itself MAY be a symlink (a data
# volume, `$HOME/projects`'s shape) — the root is followed, only the leaf refused.
_child_tmpdir() {   # id -> rc 0 + path on stdout | 1 not a child | 2 child, leaf unusable (warned)
  local id="$1" root="$HOME/.cc-tmp" dir
  [[ -n "$(_reg_get "$id" child)" ]] || return 1
  dir="$root/$id"
  if [[ -L "$dir" ]] || ! mkdir -p -m 0700 -- "$root" "$dir" 2>/dev/null \
     || [[ ! -d "$dir" ]] || ! chmod 0700 -- "$dir" 2>/dev/null; then
    echo "ccd: warn: $id is a child but $dir could not be made a private directory — spawning with the box's own TMPDIR, so this session's scratch is not contained" >&2
    return 2
  fi
  printf '%s' "$dir"
}

```

(The block ends with one blank line, so `_spawn_start() {` keeps its blank separator.)

- [ ] **Step 4: Splice `TMPDIR` into the one `env` string both spawn lines use**

Locate the single line inside `_spawn_start` (`grep -n 'resenv="$resenv${routeenv:+ $routeenv}"' ccd/ccd` — exactly one hit, ≈19713 before Step 3's insertion) and replace it with:

```bash
  # THE CHILD'S TEMP ROOT (spec §5.2), composed ONCE, here, into the one `env`
  # string BOTH spawn lines below splice — for `$rcflag`'s reason: the resume
  # retry may not spawn a differently-contained pane than the attempt it
  # replaces. EMPTY for every non-child, so a non-child's spawn line is
  # byte-identical to what it was before (`ccd-spawn-split.test.ts` pins it).
  # `_child_tmpdir`'s rc 2 has already said on stderr why a child spawns
  # uncontained; the spawn proceeds either way.
  local tmpenv="" ctmp
  ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR='$ctmp'"
  resenv="$resenv${routeenv:+ $routeenv}${tmpenv:+ $tmpenv}"
```

Neither `_tmux_new_session` line is edited: both already splice `$resenv`, which is what makes the retry line impossible to forget. `$ctmp` is single-quoted inside the composed command exactly as `cd '$workdir'` is; ids are `<project>-<slug>`, and neither grammar admits a quote.

- [ ] **Step 5: Rewrite `_reg_get`'s census sentence IN PLACE — same five lines**

This step is the census procedure contract §7 R10 names: every task, in any wave, that adds `_reg_get` calls to `ccd/ccd` repeats it in that same task — measure with the header's two commands, rewrite the sentence in place, name the mover in the last-move line, add no new cardinal near the census. `_child_tmpdir`'s `_reg_get "$id" child` is one more invocation on one more non-comment line. Locate `grep -n 'this file makes 155' ccd/ccd` (≈2888). Replace these five lines:

```bash
# and the reason is a count rather than a preference: this file makes 155
# invocations across 131 non-comment lines.
#
# THE LAST MOVE WAS `_spawn_start`'s archive check (CCR-10): two reads of the
# archive fields, so the next reader is not hunting a refactor for the +2.
```

with these five:

```bash
# and the reason is a count rather than a preference: this file makes 156
# invocations across 132 non-comment lines.
#
# THE LAST MOVE WAS `_child_tmpdir`'s `.child` read (CCR-15), the +1; before it
# `_spawn_start`'s archive check (CCR-10), two archive-field reads, the +2.
```

Confirm the numbers with the header's own commands rather than trusting this plan:

```bash
grep -v '^[[:space:]]*#' ccd/ccd | grep -o '_reg_get "' | wc -l    # expect 156
grep -v '^[[:space:]]*#' ccd/ccd | grep -c '_reg_get "'             # expect 132
```

If your base already moved the census (the first command answers other than 156), write what the two commands print, and name the other mover in the commit. The block's dated history list ("It has moved six times…") is NOT extended: `ccd-reg-get-census.test.ts` locates it by that literal, and CCR-10's move is not in it either — it is a record of the pin's own era.

The guard this step answers, measured on the prototype with Steps 3–4 in and this sentence untouched: `./node_modules/.bin/vitest run test/ccd-reg-get-census.test.ts` reds "ccd/ccd now makes 156 … calls, but the census still claims 155. Re-measure the sentence, do not re-measure this test." (`1 failed | 2 passed (3)`). Step 7 runs it green.

- [ ] **Step 6: Re-stamp, then pay the corpus tax (S6-R11)**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git diff --numstat -- ccd/ccd                  # expect: 60	6	ccd/ccd
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
```

Expected (measured on the prototype): `60	6	ccd/ccd` (54 net lines, all of them below `:19131` except the stamp and the two in-place census lines); the re-pointer prints `cmd_ensure mint -> ccd/ccd:<n>` and `genrc == 1 arm -> ccd/ccd:<a>-<b>` (21043 and 19830-19832 at `507aefe9`; 21025 and 19812-19814 on a base without it — the instrument's value is the authority); the re-measurer prints `stated == base == tree` on all four lines (`147 / 195 / 53 / 36`) and EMPTY `ENTERED`/`LEFT` everywhere. **Nothing in `session-hook.test.ts` changes in this task.** If the re-measurer shows any movement, your insertion landed above a frozen anchor — find out why before going on.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-tmpdir.test.ts test/ownership.test.ts \
  test/ccd-reg-get-census.test.ts test/ccd-spawn-split.test.ts test/ccd-auto-swap-pool.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: first run PASS, `ccd-child-tmpdir` 18/18 and 128 in total (the foreign-owner case added by R1 is the thirteenth; the five invalid-marker cases D-3336 added make eighteen); second run `7 passed | 326 skipped`. (`ownership` proves the re-stamp landed; `ccd-spawn-split` proves a non-child's spawn line is unchanged and the caller list still closes; `ccd-auto-swap-pool` is the inventory window this task does not touch but Task 3 does.)

- [ ] **Step 8: Mutation check, then commit**

Seven mutations, each restored and re-stamped before the next; every expected red below was measured on a prototype (rows 6 and 7 on Task 2's edits applied to the spec branch's tip, the census walk's order following that box's `sort` collation; row 3's second red, the R1 ownership case, at this branch's tip after the `507aefe9` merge). Row 7 is the pin that holds contract §7 R1's ruled form — a refusal on rc 2 is exactly what the ruling rejected:

| # | Exact edit in `ccd/ccd` | Command | Expected red |
|---|---|---|---|
| 1 | `${routeenv:+ $routeenv}${tmpenv:+ $tmpenv}"` → `${routeenv:+ $routeenv}"` | `./node_modules/.bin/vitest run test/ccd-child-tmpdir.test.ts` | "a child spawns with TMPDIR at its own root…" and "BOTH spawn lines carry it…" (2 failed) |
| 2 | `if [[ -L "$dir" ]] \|\| ! mkdir` → `if ! mkdir` | same | "rc 2 for a child whose leaf is a SYMLINK…" — the link was followed and its target re-moded to 0700 |
| 3 | delete ` \|\| ! chmod 0700 -- "$dir" 2>/dev/null` (keep `; then`) | same | "re-privatises a leaf that already exists wider…" (`expected 493 to be 448`) AND "rc 2 for a child whose leaf is a real directory this user does NOT own…" (2 failed) — the `chmod` is both the re-privatiser and the ownership check R1 names |
| 4 | `_child_runid_valid "$(_reg_get "$id" child)" \|\| return 1` → `{ _child_runid_valid "$(_reg_get "$id" child)" \|\| [[ "$(_reg_get "$id" rc)" == off ]]; } \|\| return 1` (the OR-inference form, inferring child-ness from `--no-rc`) | same | "a dispatched worker WITHOUT a marker (`rc=off`) is not a child…" (1 failed) — the `rc=off`-without-marker case reds ALONE, 17/18 otherwise green |
| 5 | in the RETRY spawn line only (the one ending `--session-id '$uuid' --dangerously-skip-permissions"`), `$resenv` → `${resenv%% TMPDIR=*}` | same | "BOTH spawn lines carry it when the --resume attempt dies…" — the retry is the line that gets forgotten |
| 6 | a SECOND caller: directly under `cmd_ensure() {`'s header line, add `  _child_tmpdir "$id" >/dev/null` | same | "the decision lives in _spawn_start and NOWHERE else…" only (1 failed) — `expected [ 'cmd_ensure', '_spawn_start' ] to deeply equal [ '_spawn_start' ]` |
| 7 | refuse on rc 2 (the form R1 rejected): `  ctmp=$(_child_tmpdir "$id") && tmpenv="TMPDIR='$ctmp'"` → `  ctmp=$(_child_tmpdir "$id"); case $? in 0) tmpenv="TMPDIR='$ctmp'" ;; 2) return 1 ;; esac` | same | "a child whose root is unusable STILL SPAWNS…" only (1 failed) — `expected 'ccd: warn: demo-quiet-mesa is a child…' to contain '[rc=0]'` |

```bash
git add ccd/ccd README.md server/test/ccd-child-tmpdir.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): a child's TMPDIR, driven by the marker, on every spawn path

_child_tmpdir answers three ways — contained (0, path on stdout), not a child
(1, nothing created), a child whose root cannot be made private (2, warned) —
and _spawn_start splices TMPDIR='$HOME/.cc-tmp/<id>' into the one env string
both spawn lines use, so the --resume retry cannot come back uncontained. The
marker is the only input: a --no-rc row with no marker gets nothing. rc 2
spawns uncontained rather than refusing — a supervisor restart must never die
here — as the programme contract's ruling R1 settles. The leaf must be a real
directory this user owns (the chmod is the ownership check, pinned with a
foreign-owned leaf); it may not be a symlink (wave 3 removes it); the root may
be. Spec §5.2.

_reg_get's census moves 155/131 -> 156/132, rewritten in the same five lines.
S6-R11: the new code sits below the corpus's lowest frozen ccd/ccd anchor
(:19131), so the citation census did not move (147 / 195 / 53 / 36, measured
base and tree). README's two anchors re-pointed by the bytes their sentences
quote.

UNRELATED REPAIR, outside this wave's scope: the re-pointer also moved
cmd_ensure's mint anchor, which main left green-but-stale (pointing above its
quote; sub-rule A kept it green). The tool works by content, so it repaired it;
no wave-1 requirement asked for it.
MSG
)"
```

---

### Task 3: `ws-add --child <runId>`, the marker, and the token that advertises both

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `ccd/ccd` — `cmd_ws_add`'s header comment, locals, strip loop, four usage strings, refusal, marker write; `cmd_caps`; `_reg_purge`'s inventory (two in-place line edits); `_child_runid_valid` inserted directly above `_spawn_start() {`
- Modify: `README.md` (re-pointer), `server/test/session-hook.test.ts` (instrument + comments)
- Modify: `server/src/ccdargv.ts` — `CHILD_ARGV_CAP` only (the builder is Task 4)
- Modify: `server/test/ccd-archive.test.ts`, `server/test/capsupported.test.ts`
- Test: `server/test/ccd-ws-add-child.test.ts` (new)

**Interfaces:**
- Consumes: Task 2's `_child_tmpdir` (reads the marker this task writes).
- Produces:
  - `ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]` — `--child <v>` and `--child=<v>`, positionless, arity-checked; `<runId>` must match `^[1-9][0-9]{0,9}$` under `LC_ALL=C`, else `die "--child needs a run id (a positive integer), got: <v>"` before any worktree, row or pane exists (contract §1).
  - `$REG/<id>.child` holding the decimal run id with no terminator (`_reg_set "$id" child "$lc_child"`), written before `_spawn_start "$id" new`. Wave 2 reads it through `fieldMeasured` as `ChildMark` (contract §2).
  - `_child_runid_valid <value>` → rc 0 iff a legal run id — THE run-id grammar in ccd (contract §7 R2): `^[1-9][0-9]{0,9}$` under a shadowed `LC_ALL=C`. Every later wave calls it at every parse — wave 3's `--child-of`, and the marker read on the fresh arm and on resume — and never re-spells the pattern; wave 2's server-side `ChildMark` reader accepts exactly the same set and answers `unreadable` for anything else. `ccd-ws-add-child.test.ts` pins this as a literal-absence check: it reds on a verbatim second copy of the spelling, not on a differently spelled equivalent grammar.
  - `cmd_caps` echoes `child-argv-v1`; `export const CHILD_ARGV_CAP = 'child-argv-v1';` in `server/src/ccdargv.ts`.

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/ccd-ws-add-child.test.ts`:

```ts
// `ccd ws-add --child <runId>` (child-workspace reclamation, spec §5.1, wave 1).
//
// The flag is the box half of the two authorities that make a workspace a
// CHILD: `cmd_ws_add` strips it in the same loop as `--no-rc`/`--surface`/
// `--actor`/`--route`, refuses anything that is not a run id before a worktree,
// a row or a pane exists, and stamps `$REG/<id>.child` before the first spawn
// so `_spawn_start` already contains that pane (`ccd-child-tmpdir.test.ts`).
//
// Fixture HOMEs only (`makeCcdHarness`); `WS_ADD_REAL_SPAWN` keeps
// `_spawn_start` real and records `tmux` instead of running it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, WS_ADD_REAL_SPAWN, type CcdHarness } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-ws-add-child-'); h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
/** `ccd-lifecycle-sites.test.ts`'s spelling: macOS ships coreutils' `timeout` as `gtimeout`. */
const TIMEOUT_BIN = process.platform === 'darwin' ? 'gtimeout' : 'timeout';

/** `ccd-route-argv.test.ts`'s `shStatus`: status and both streams, with an
 *  optional wall clock for the one case that is about the loop terminating. */
const shStatus = (snippet: string, boundSec?: number, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  const bash = ['bash', '-c', `source "${CCD}"; exec 2>&1; ${snippet}`];
  const argv = boundSec === undefined ? bash : [TIMEOUT_BIN, String(boundSec), ...bash];
  try {
    const out = execFileSync(argv[0]!, argv.slice(1),
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const wsAdd = (args: string): { status: number; out: string } =>
  shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add ${args}`, 30);
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const nothingCreated = (): void => {
  expect(h.reg(ID, 'uuid'), 'the refusal must precede the registry row').toBeNull();
  expect(h.reg(ID, 'child'), 'and the marker').toBeNull();
  expect(fs.existsSync(path.join(h.home, 'worktrees', 'demo')), 'and the worktree').toBe(false);
  expect(newSessions(), 'and the pane').toEqual([]);
};

describe('--child on ws-add writes the marker the first spawn reads', () => {
  it('ws-add --no-rc --child 7 demo: the marker holds the run id, and the first pane is contained', () => {
    const r = wsAdd('--no-rc --child 7 demo');
    expect(r.status, r.out).toBe(0);
    expect(h.reg(ID, 'child')).toBe('7');
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${ID}.child`), 'utf8'),
      'the run id and nothing else — no newline a string-exact reader would trip on').toBe('7');
    expect(h.reg(ID, 'rc'), '--no-rc still means what it meant').toBe('off');
    expect(newSessions()).toHaveLength(1);
    expect(newSessions()[0]).toContain(`TMPDIR='${path.join(h.home, '.cc-tmp', ID)}'`);
  });

  it('the equals form binds the same value', () => {
    expect(wsAdd('--no-rc --child=42 demo').status).toBe(0);
    expect(h.reg(ID, 'child')).toBe('42');
  });

  it('--child AFTER the positional binds the same row — the strip loop is positionless (D-410)', () => {
    const r = wsAdd(`--no-rc demo --child 7 --surface agent --actor 'run:7 dispatch'`);
    expect(r.status, r.out).toBe(0);
    expect(h.reg(ID, 'child')).toBe('7');
    expect(h.reg(ID, 'project')).toBe('demo');
    expect(h.reg(ID, 'workspace')).toBe('quiet-mesa');
  });

  it('WITHOUT --child there is no marker and no TMPDIR — every workspace minted before this is not a child', () => {
    const r = wsAdd('--no-rc demo');
    expect(r.status, r.out).toBe(0);
    expect(h.reg(ID, 'child')).toBeNull();
    expect(newSessions()[0]).not.toContain('TMPDIR=');
  });
});

describe('--child refuses anything but a run id, before anything exists', () => {
  it('as the FINAL token it refuses with the usage line rather than hanging', () => {
    const r = wsAdd('--no-rc demo --child');
    expect(r.status, 'a valueless --child never terminated — the arity check is gone').not.toBe(124);
    expect(r.status).toBe(1);
    expect(r.out).toContain('usage: ccd ws-add [--no-rc] [--child <runId>]');
    nothingCreated();
  });

  it.each([
    ['abc'], ['0'], ['07'], ['-1'], ['+7'], ['7x'], ['12345678901'], [''], ['7 8'],
  ])('refuses %j with the run-id sentence and leaves the box as it found it', (bad) => {
    const r = wsAdd(`--no-rc --child '${bad}' demo`);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`ccd: --child needs a run id (a positive integer), got: ${bad}`);
    nothingCreated();
  });

  it('accepts the largest ten-digit id — the bound is on length, not on a guessed maximum', () => {
    expect(wsAdd('--no-rc --child 9999999999 demo').status).toBe(0);
    expect(h.reg(ID, 'child')).toBe('9999999999');
  });
});

/** A UTF-8 locale on this box in which bash's `[1-9]` range admits `²` — found
 *  by MEASURING that property, never by name (`pool-tag-parity.test.ts`'s rule:
 *  `C.utf8` collates by codepoint and could not show the defect). The probe
 *  runs no ccd, but it is a bash spawn in a `ccd-*` file, so it goes through
 *  `ghContainedEnv` like every other (`ccd-workspaces.test.ts`'s scan), under a
 *  throwaway HOME of its own because no harness exists yet at module scope. */
const PROBE_HOME = mkTmp('ccrc-child-locale-probe-');
const WIDE_DIGIT_LOCALE: string | null = (() => {
  let list: string[] = [];
  try {
    list = execFileSync('locale', ['-a'], { encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter((l) => /utf-?8$/i.test(l));
  } catch { return null; }
  for (const loc of list) {
    try {
      const out = execFileSync('bash', ['-c', '[[ "²" =~ ^[1-9]$ ]] && echo yes || echo no'],
        { encoding: 'utf8', cwd: PROBE_HOME,
          env: ghContainedEnv(PROBE_HOME, { ...process.env, HOME: PROBE_HOME, LC_ALL: loc }, { systemd: true, tmux: true }) }).trim();
      if (out === 'yes') return loc;
    } catch { /* this locale is unusable for the probe; try the next */ }
  }
  return null;
})();

describe('the run-id grammar is ASCII in every locale (D-2522\'s shape)', () => {
  it('spells the literal run-id pattern once in ccd/ccd — in _child_runid_valid', () => {
    // Wave 3's `--child-of` parse and its marker reads call the helper; none
    // re-spells the pattern, whose ten-digit bound `{0,9}` is its fingerprint.
    // A second spelling would be a second grammar free to drift — and the
    // first place it would drift is the `LC_ALL=C` shadow above.
    const code = fs.readFileSync(CCD, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l));
    const spelled = code.filter((l) => l.includes('[0-9]{0,9}'));
    expect(spelled, 'the run-id pattern must be spelled exactly once — in _child_runid_valid').toHaveLength(1);
    expect(spelled[0]).toMatch(/^_child_runid_valid\(\) \{/);
  });

  it.skipIf(WIDE_DIGIT_LOCALE === null)('refuses a superscript digit under a locale whose ranges admit it', () => {
    const r = shStatus(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --child '1²' demo`,
      30, { LC_ALL: WIDE_DIGIT_LOCALE! });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('--child needs a run id');
    nothingCreated();
  });
});

describe('the marker is loud when it cannot land, and dies with the row', () => {
  it('a marker write that fails WARNS and still spawns — the workspace is simply not a child', () => {
    const r = shStatus(`${WS_ADD_REAL_SPAWN}
      eval "$(declare -f _reg_set | sed '1s/^_reg_set/_reg_set_real/')"
      _reg_set() { [[ "$2" == child ]] && return 1; _reg_set_real "$@"; }
      CCD_WS_SLUG=quiet-mesa cmd_ws_add --no-rc --child 7 demo`, 30);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`ccd: warn: could not write ${path.join(h.home, '.cc-sessions', `${ID}.child`)}`);
    expect(h.reg(ID, 'child')).toBeNull();
    expect(h.reg(ID, 'uuid'), 'the workspace was still created').not.toBeNull();
    expect(newSessions()[0], 'and, being no child, it is not contained').not.toContain('TMPDIR=');
  });

  it('_reg_purge takes the marker with the rest of the row — measured on the file, not the inventory', () => {
    expect(wsAdd('--no-rc --child 7 demo').status).toBe(0);
    expect(h.reg(ID, 'child')).toBe('7');
    h.sh(`_reg_purge ${ID}`);
    expect(h.reg(ID, 'child')).toBeNull();
    expect(h.reg(ID, 'uuid')).toBeNull();
  });

  it('cmd_caps advertises child-argv-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('child-argv-v1');
  });
});
```

(b) In `server/test/ccd-archive.test.ts`, extend the `ccdargv.js` import (≈line 12) to

```ts
import { ACCOUNT_POOLS_CAP, ACTOR_FLAGS_CAP, CHILD_ARGV_CAP, POOLS_CAP, ROUTE_APPLY_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, WIN_SIZE_CAP } from '../src/ccdargv.js';
```

change `KNOWN_CAPABILITY_TOKENS` (≈line 154) by ADDING one entry and keeping all ten, alphabetical as it stands:

```ts
  const KNOWN_CAPABILITY_TOKENS = ['account-pools', 'account-v1', 'actor-flags-v1', 'child-argv-v1', 'lifecycle-v1', 'pools-v1', 'route-apply-v1', 'route-argv-v1', 'route-v1', 'stop-surface', 'win-size-v1'];
```

and directly after `expect(KNOWN_CAPABILITY_TOKENS).toContain(WIN_SIZE_CAP);` add:

```ts
    // Child-workspace reclamation wave 1's token, landed in the SAME commit as
    // ccd's `echo child-argv-v1` — this test reads the real `ccd/ccd`, so the
    // string here and the echo there cannot ship apart without a red suite.
    expect(KNOWN_CAPABILITY_TOKENS).toContain(CHILD_ARGV_CAP);
```

(c) In `server/test/capsupported.test.ts`, add `CHILD_ARGV_CAP` to the `ccdargv.js` import (`ACTOR_FLAGS_CAP, CCD_ARGV, CHILD_ARGV_CAP, WIN_SIZE_CAP, capSupported, stopSurfaceSupported, verbSupported,`) and, directly after the `spells the win-size token exactly once in server/src` case's closing `});` and before the `describe`'s own `});`, add:

```ts

  it('spells the child-argv token exactly once in server/src', () => {
    // The win-size case above is the shape this copies, scan included. The
    // polarity matters more here than for any token before it: `--child` is a
    // FLAG on a verb every box has, so `verbSupported(['ws-add'])` answers
    // TRUE on every box — including the ones whose `cmd_ws_add` would bind
    // `--child` as the project (D-410, one flag to the left). The verb's
    // presence is not the token's presence.
    expect(CHILD_ARGV_CAP).toBe('child-argv-v1');
    expect(literalSpellings(CHILD_ARGV_CAP)).toBe(1);
    expect(capSupported(state(null), CHILD_ARGV_CAP)).toBe(false);
    expect(capSupported(undefined, CHILD_ARGV_CAP)).toBe(false);
    expect(capSupported(state(['ws-add']), CHILD_ARGV_CAP)).toBe(false);
    expect(capSupported(state([CHILD_ARGV_CAP]), CHILD_ARGV_CAP)).toBe(true);
    expect(verbSupported(state(null), ['ws-add'])).toBe(true);
    expect(verbSupported(state(['ws-add']), ['ws-add', '--no-rc', '--child', '7', 'demo'])).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-ws-add-child.test.ts test/capsupported.test.ts test/ccd-archive.test.ts
```

Expected, measured:
- `ccd-ws-add-child`: `19 failed | 1 passed (20)` — only "WITHOUT --child there is no marker and no TMPDIR" passes (a regression control). The grammar census fails on `the run-id pattern must be spelled exactly once — in _child_runid_valid: expected [] to have a length of 1 but got +0`: no line spells the pattern yet. The composed-argv cases fail the way D-410 did: today's `cmd_ws_add` binds `--child` as the PROJECT (`not a git repo: …/projects/--child`).
- `capsupported` and `ccd-archive`: `2 failed | 94 passed (96)` — NOT a collection failure: vitest's transform turns the missing named export into `undefined`, so both files load and exactly two cases fail, "spells the child-argv token exactly once in server/src" (`expected undefined to be 'child-argv-v1'`) and "advertises exactly the verbs the dispatcher implements, plus the known capability tokens" (`expected [ 'account-pools', 'account-v1', …(9) ] to include undefined`). Every other case in the two files passes.

- [ ] **Step 3: Edit `cmd_ws_add` — eight lines added above the frozen anchors, everything else in place**

Locate the function with `grep -n '^cmd_ws_add() {' ccd/ccd` (≈6657). Make exactly these edits and no others inside it.

(3a) The header line, in place:

```bash
cmd_ws_add() {   # [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] project [slug] — new worktree + session for an existing project
```

(3b) The locals line, in place — `grep -n "local norc=0 lc_surface=none" ccd/ccd`:

```bash
  local norc=0 lc_child='' lc_gc=0 lc_surface=none lc_actor='' lc_gs=0 lc_ga=0 lc_args=() lc_route=()
```

(3c) The FOUR usage strings, in place — every occurrence of `usage: ccd ws-add [--no-rc] [--surface <word>]` becomes `usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>]` (the `--surface`, `--actor` and `--route` arms, and the `local project="${1:?usage: …}"` line). Verify: `grep -c 'usage: ccd ws-add \[--no-rc\] \[--child <runId>\]' ccd/ccd` → `4` now, `5` after (3d).

(3d) The two new arms, between `--route=*)` and the catch-all `*)` — the strip loop's `case` (+4 lines):

```bash
      --route=*)   lc_route+=("${1#--route=}"); shift ;;
      # The minting run (spec §5.1) — what makes this workspace a CHILD; see `_child_runid_valid`.
      --child)     [[ $# -ge 2 ]] || die "usage: ccd ws-add [--no-rc] [--child <runId>] [--surface <word>] [--actor <text>] [--route <field>=<value>]... <project> [slug]"
                   lc_gc=1; lc_child="$2"; shift 2 ;;
      --child=*)   lc_gc=1; lc_child="${1#--child=}"; shift ;;
      *)           lc_args+=("$1"); shift ;;
```

(the first and last lines shown are the existing ones, for placement).

(3e) The refusal, directly under `(( ${#lc_route[@]} )) && _route_argv_check "${lc_route[@]}"` — above the project positional, the disk floor, the lock and every mint (+1 line):

```bash
  (( ${#lc_route[@]} )) && _route_argv_check "${lc_route[@]}"
  (( lc_gc )) && ! _child_runid_valid "$lc_child" && die "--child needs a run id (a positive integer), got: $lc_child"
```

(3f) The marker, directly under `(( norc )) && _reg_set "$id" rc off` — after `$id` exists, before the routing record and long before `_spawn_start "$id" new` (+1 line):

```bash
  (( norc )) && _reg_set "$id" rc off
  (( lc_gc )) && { _reg_set "$id" child "$lc_child" || echo "ccd: warn: could not write $REG/$id.child — $id is NOT a child of run $lc_child and nothing will ever reclaim it as one" >&2; }
```

Every argument for these lines lives in `_child_runid_valid`'s header (Step 5), below the frozen anchors; the lines here stay one-liners on purpose (Global Constraints, edit length).

- [ ] **Step 4: Advertise the token (+2 lines) and extend the purge inventory in place**

(4a) In `cmd_caps`, directly after `  echo win-size-v1` and before the function's closing `}`:

```bash
  echo win-size-v1
  # child-argv-v1 — `ws-add --child` and a child's own TMPDIR, one inode; argued at `_child_tmpdir`.
  echo child-argv-v1
}
```

(4b) In `_reg_purge`'s inventory comment (`grep -n '# The 38:' ccd/ccd`, ≈3646), TWO in-place replacements and no added line — `ccd-auto-swap-pool.test.ts` reads a 2400-character window from this paragraph's head and must still find `` `stranded` `` (Pre-flight finding 4). Replace

```bash
  # floors): 38, by that same addition — NOT a fresh census of every
  # per-session field, which this list still is not. `ROUTE_FIELDS` (`class`,
```

with

```bash
  # floors): 38; CCR-15's `child` made 39 — by addition, NOT a fresh census of
  # every per-session field, which this list still is not. `ROUTE_FIELDS` (`class`,
```

and replace

```bash
  # The 38: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
  # `compactnote`, `compactskip`, `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`, `lastswap`,
```

with

```bash
  # The 39: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
  # `child`, `compactnote`, `compactskip`, `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`, `lastswap`,
```

`_reg_purge` itself is NOT edited: its loop globs `"$REG/$id".*` and skips only suffixes with a second dot plus `archived`/`reaping`/`generation`, so `child` is purged with the row — which the new test proves on the file.

- [ ] **Step 5: Insert `_child_runid_valid` and the flag's argument, directly above `_spawn_start`**

Locate `grep -n '^_spawn_start() {' ccd/ccd` again (it now follows Task 2's `_child_tmpdir` block) and insert immediately above it:

```bash
# ── `ws-add --child <runId>` (child-workspace reclamation, spec §5.1) ────────
# The dispatch path declares, at creation — the only moment it is known — which
# run minted this workspace, and `cmd_ws_add` stamps it into `$REG/<id>.child`
# before the first spawn (so `_child_tmpdir` above already contains that pane).
# That marker is what makes a workspace a CHILD, and it is never inferred from
# anything else: not `--no-rc`, not a dec string, not a run row alone.
#
# The flag is parsed in `cmd_ws_add`'s strip-then-bind loop, positionless like
# its siblings, and REFUSED above every mint — for `--route`'s reason: nothing
# exists yet, so a bad value leaves the box exactly as it found it. A marker
# that fails to LAND is the opposite case: the worktree and the row exist by
# then, so a `die` would strand both with no pane; it WARNS instead, and the
# workspace is simply not a child — the fallback every pre-policy workspace
# already takes. The marker holds the run id and nothing else (`_reg_set`
# writes no newline), because every later reader compares it string-exact.
#
# `cmd_ws_add` carries one-line pointers only: it sits above line-cited corpus
# anchors, and every comment line added there would move them.
#
# THE ONE RUN-ID GRAMMAR IN ccd, by programme ruling: the `--child-of` parse and the
# marker reads of wave 3 call THIS, never a re-spelt pattern (a test counts it),
# and the server's marker reader accepts exactly this set: a positive decimal of
# at most ten digits, no sign, no leading zero — `String(run.id)` of a rowid.
# ASCII BY `LC_ALL=C` (D-2522, see `_pool_name_valid`): `=~` bracket ranges are
# COLLATION ranges; under en_US.UTF-8 (bash 5.2.21 / glibc 2.39, measured) the
# bare pattern ACCEPTS `²`, `½`, `٣` and `१` — none a run id any server composed.
_child_runid_valid() { local LC_ALL=C; [[ "${1-}" =~ ^[1-9][0-9]{0,9}$ ]]; }   # value -> 0 iff it is a legal --child run id

```

- [ ] **Step 6: Add the server's spelling of the token**

In `server/src/ccdargv.ts`, directly after `export const ROUTE_ARGV_CAP = 'route-argv-v1';` (≈line 616) — beside the other `ws-add` argv-parsing token whose flag-on-`ws-add` gating this one copies, which is where contract §1 places it — and before `ROUTE_APPLY_CAP`'s docstring:

```ts

/** The `ccd caps` token that says this box parses `--child <runId>` on
 *  `ws-add`, stamps `$REG/<id>.child` before the first spawn, and exports a
 *  child's own TMPDIR on every spawn path (child-workspace reclamation, spec
 *  §5.1–§5.2, wave 1). One token for both halves, because they ship in one ccd
 *  inode. Spelled ONCE in `server/src`, for `ACTOR_FLAGS_CAP`'s reason; ccd's
 *  own `echo child-argv-v1` and `ccd-archive.test.ts`'s
 *  `KNOWN_CAPABILITY_TOKENS` are the other two spellings, and that test's
 *  `toContain` line holds this one equal to them.
 *
 *  IT GATES THE D-410 HAZARD, ONE FLAG TO THE LEFT. An older `cmd_ws_add` has
 *  no `--child` arm, so its strip loop hands the flag to the positionals: the
 *  argv `wsAddWorker` composes would bind `--child` as the PROJECT and every
 *  dispatched spawn on that box would refuse before a worktree existed. So the
 *  flag is OMITTED, and the omission journalled on the run
 *  (`child-omitted:no-child-argv-cap`), unless this token is advertised — and
 *  read with `capSupported` (null → REFUSE), never `verbSupported`, whose
 *  null → PERMIT is the right default for a verb that always existed and the
 *  wrong one for a flag that never did. What an omission costs is stated
 *  rather than hidden: the workspace is minted WITHOUT the marker and is
 *  therefore simply not a child — the same thing every workspace minted before
 *  this token existed already is (spec §6, "Deploy"). */
export const CHILD_ARGV_CAP = 'child-argv-v1';
```

Every mention of the token in that docstring is in BACKTICKS: `capsupported.test.ts`'s `literalSpellings` counts single- or double-quoted spellings only, and a quoted one in prose would make it answer 2.

- [ ] **Step 7: Re-stamp, then pay the corpus tax (S6-R11)**

```bash
SCRATCH=<your scratchpad, absolute>
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
git diff --numstat -- ccd/ccd                  # expect: 47	11	ccd/ccd
python3 "$SCRATCH/repoint-readme.py"
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD
```

Expected (measured on the prototype, against Task 2's commit):

```
byFile['ccd/ccd']  stated 147  base 147  tree 147
total              stated 195  base 195  tree 195
other byFile keys moved: none
byFile composition  ENTERED ['spec:2125 ccd/ccd:13567', 'spec:2230 ccd/ccd:13567']
                    LEFT    ['spec:1210 ccd/ccd:13602', 'spec:2123 ccd/ccd:13573-13575']
row array: stated 53  base 53  tree 53
    ENTERED ['ccd/ccd:13567', 'ccd/ccd:13650-13652']
    LEFT    ['ccd/ccd:13573-13575', 'ccd/ccd:13573-13575']
site array: stated 36  base 36  tree 35
    ENTERED ['spec:2125 ccd/ccd:13567']
    LEFT    ['spec:2123 ccd/ccd:13573-13575', 'spec:2210 ccd/ccd:13573-13575']
```

and the re-pointer moves both README anchors by +36 from Task 2's values (21079 and 19866-19868 at `507aefe9`; 21061 and 19848-19850 on a base without it, measured by review — the instrument is the authority). Then write the literals from the instrument:

```bash
SCRATCH=<your scratchpad, absolute>
python3 "$SCRATCH/cite-remeasure.py" "$SCRATCH" HEAD --write
git diff --numstat -- server/test/session-hook.test.ts     # expect: 3	4	server/test/session-hook.test.ts
```

- [ ] **Step 8: State the composition beside the literals it moved (S6-R11)**

In `server/test/session-hook.test.ts`, three comment insertions (all below the corpus's highest anchor into this file, `:7043-7056`, so they move nothing). If Step 7 printed a different composition, write YOUR measured one in the same shape.

(8a) Directly above `      'ccd/ccd': 147,` in the `byFile` map:

```ts
      // CHILD-RECLAMATION WAVE 1 (Task 3) left this at 147 with its COMPOSITION
      // moved two for two: `spec:2125`/`spec:2230` `:13567` enter, `spec:1210
      // :13602` and `spec:2123 :13573-13575` leave — Task 3's eight lines above
      // them, measured by the plan's `cite-remeasure.py` against the pre-task
      // tree. An unchanged count is not an unchanged debt. S6-R11, no D-number.
```

(8b) Directly above the row array's first entry `        'ccd/ccd:203',`:

```ts
        // RE-MEASURED at child-reclamation wave 1 (Task 3), 53 -> 53, FROM THE
        // SAME RUN as the site-level set below. Task 3 adds EIGHT lines to
        // `ccd/ccd` above every entry that moved — four in `cmd_ws_add`'s strip
        // loop, one refusal, one marker write, two in `cmd_caps` — and nothing
        // else above them (its long argument sits below the corpus's lowest
        // anchor on purpose). Two ENTER (`:13567`, `:13650-13652`) and two LEAVE
        // (`:13573-13575` x2). Both corpus documents are byte-identical to
        // `origin/main` at this tree, so nothing was re-pointed and every move is
        // that shift. A coincidental pass is not a green anchor. S6-R11 covers
        // the re-measurement, so no D-number.
```

(8c) Directly above the site-level array's first entry `        'spec:308 server/test/single-definition.test.ts:1274',` (6-space `//`, the indentation of the comment already there):

```ts
      // RE-MEASURED at child-reclamation wave 1 (Task 3), 36 -> 35, FROM THE
      // SAME RUN as the row-pass set above, and every move mirrors one there:
      // `spec:2125 ccd/ccd:13567` enters; `spec:2123` and `spec:2210`
      // `ccd/ccd:13573-13575` leave. One cause — Task 3's eight lines above
      // them — and nothing re-pointed. S6-R11 covers it, so no D-number.
```

Then run the corpus-frozen check from "The citation tax, mechanised", step 5.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-ws-add-child.test.ts test/ccd-child-tmpdir.test.ts \
  test/ccd-archive.test.ts test/capsupported.test.ts test/caps-token-shape.test.ts test/ownership.test.ts \
  test/ccd-reg-get-census.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-route-argv.test.ts \
  test/ccd-lifecycle-sites.test.ts test/ccd-spawn-split.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
./node_modules/.bin/vitest run test/ccd-workspaces.test.ts -t 'ALL THREE'
```

Expected: first run PASS, 292 tests at `507aefe9` (291 on a base without it, which carries one fewer `ccd-route-argv` case — a different total with every case passing is not a red; the two over the first round's 290 are the R1 ownership case and the R2 grammar census) (`ccd-ws-add-child` 20/20 with the locale case RUN, not skipped, on the fleet box, which lists `en_US.utf8`; `ccd-child-tmpdir` 18/18 (the totals above predate D-3336's five added cases); `ccd-reg-get-census` 3/3 — Task 3 adds no `_reg_get` call, so under contract §7 R10 it owes no census rewrite, and this green run is the proof; `capsupported` 19; `ccd-archive` 77; `caps-token-shape` picks `echo child-argv-v1` up through `parseCcdCaps` with no edit, being derived from `cmd_caps`'s own text); second `7 passed | 326 skipped`; third `1 passed | 78 skipped` — every bash spawn in the two new `ccd-*` files is contained.

- [ ] **Step 10: Mutation check, then commit**

Nine mutations, each restored (and `ccd/ccd` re-stamped) before the next, measured on the prototype (row 9, contract §7 R2's single-grammar pin, and row 2's red re-checked beside it, at this branch's tip after the `507aefe9` merge):

| # | Exact edit | Command (from `server/`) | Expected red |
|---|---|---|---|
| 1 | delete the refusal line `(( lc_gc )) && ! _child_runid_valid …` | `./node_modules/.bin/vitest run test/ccd-ws-add-child.test.ts` | all nine `refuses %j…` rows and the superscript case (10 failed) — each mints a workspace and a marker |
| 2 | `_child_runid_valid() { local LC_ALL=C; [[` → `_child_runid_valid() { [[` | same | "refuses a superscript digit under a locale whose ranges admit it" only |
| 3 | delete the `--child=*)` arm | same | "the equals form binds the same value" |
| 4 | `(( lc_gc )) && { _reg_set "$id" child …` → `(( lc_gc )) && false && { _reg_set "$id" child …` | same | six cases, starting "ws-add --no-rc --child 7 demo: the marker holds the run id…" |
| 5 | in the `--child)` arm, delete `[[ $# -ge 2 ]] \|\| die "usage: …"` and its line break (the arm becomes `--child)     lc_gc=1; lc_child="$2"; shift 2 ;;`) | same | "as the FINAL token it refuses with the usage line…" — `set -u` aborts on `$2` with no usage line |
| 6 | delete `  echo child-argv-v1` | `./node_modules/.bin/vitest run test/ccd-ws-add-child.test.ts test/ccd-archive.test.ts` | "cmd_caps advertises child-argv-v1" AND "advertises exactly the verbs the dispatcher implements, plus the known capability tokens" |
| 7 | in the marker line, `echo "ccd: warn: could not write` → `: "ccd: warn: could not write` | `./node_modules/.bin/vitest run test/ccd-ws-add-child.test.ts` | "a marker write that fails WARNS and still spawns…" |
| 8 | `server/src/ccdargv.ts`: `'child-argv-v1'` → `'child-argv-v2'` in `CHILD_ARGV_CAP` | `./node_modules/.bin/vitest run test/capsupported.test.ts test/ccd-archive.test.ts` | "spells the child-argv token exactly once in server/src" and ccd-archive's parity case |
| 9 | a second spelling of the grammar (R2): in the refusal line, `! _child_runid_valid "$lc_child"` → `! [[ "$lc_child" =~ ^[1-9][0-9]{0,9}$ ]]` | `./node_modules/.bin/vitest run test/ccd-ws-add-child.test.ts` | "spells the literal run-id pattern once in ccd/ccd — in _child_runid_valid…" (`expected [ …(2) ] to have a length of 1 but got 2`) AND "refuses a superscript digit…" — the re-spelt copy lost the `LC_ALL=C` shadow, which is the drift the single spelling exists to prevent (2 failed) |

And one on the list itself: remove `'child-argv-v1', ` from `KNOWN_CAPABILITY_TOKENS` → `./node_modules/.bin/vitest run test/ccd-archive.test.ts` reds "advertises exactly the verbs…" (the echoed token is re-classified as a VERB with no dispatcher arm). Restore.

```bash
git add ccd/ccd README.md server/src/ccdargv.ts server/test/ccd-ws-add-child.test.ts \
        server/test/ccd-archive.test.ts server/test/capsupported.test.ts server/test/session-hook.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): ws-add --child <runId> writes the child marker, advertised as child-argv-v1

cmd_ws_add strips --child/--child= in its existing loop, refuses anything but a
run id (^[1-9][0-9]{0,9}$ under LC_ALL=C — the bare pattern accepts ², ½, ٣
and १ under en_US.UTF-8, measured) above every mint, and writes
$REG/<id>.child beside rc before the first spawn, so _child_tmpdir contains
the very first pane. A marker that cannot land warns and leaves a workspace
that is simply not a child. cmd_caps echoes child-argv-v1, landed with its
server spelling and ccd-archive's list in one commit because that parity test
reads the real ccd. _child_runid_valid is the one run-id grammar in ccd
(the programme contract's ruling R2): every later parse calls it, and a test
counts the pattern's spelling so a second copy reds. Spec §5.1, §6.

Length was chosen, not incidental: eight lines above the corpus's frozen
anchors, two prose edits in place (the purge inventory keeps
ccd-auto-swap-pool's 2400-character window), every argument below :19131.
S6-R11, measured by cite-remeasure against the pre-task tree: byFile 147
unchanged with its composition moved 2-for-2 (:13567 x2 in; :13602 and
:13573-13575 out), row array 53 -> 53 (:13567, :13650-13652 in;
:13573-13575 x2 out), site array 36 -> 35. Both corpus documents are
byte-identical to origin/main. README's two anchors re-pointed by quote.
MSG
)"
```

---

### Task 4: `wsAddWorker` composes `--child <runId>`

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/ccdargv.ts` — `childFlags` after `routeFlags` (≈line 133); `wsAddWorker` (≈line 351)
- Modify: `server/test/whitelist-subset.test.ts` — `SAMPLES.wsAddWorker` (≈line 51), layer 2c `EXPECTED.wsAddWorker` (≈line 428), one new `it` before `prOpen maps a real boolean draft…`
- Modify: `server/test/ccdargv-dec-parity.test.ts` — one `describe` appended at the end of the file

**Interfaces:**
- Consumes: Task 3's ccd parse (the real-binary crossing below runs it).
- Produces: `CCD_ARGV.wsAddWorker(p: string, dec: ActorFlags | null, route: RouteFields | null = null, child: number | null = null): CcdArgv` — when `child !== null` the argv is `['ws-add', '--no-rc', '--child', String(child), ...routeFlags(route), p, ...decFlags(dec)]`; `null` composes the previous argv token for token (contract §1). Task 5 consumes it.

- [ ] **Step 1: Write the failing tests**

(a) `server/test/whitelist-subset.test.ts`, `SAMPLES` — replace the `wsAddWorker` entry with:

```ts
  // AND IT CARRIES A CHILD (child-workspace reclamation wave 1), for the dec's
  // reason: the shape the dispatch path sends to a box advertising
  // `child-argv-v1` is the one layer 2 must prove crosses the bare grant.
  wsAddWorker: ['demo', { surface: 'agent', actor: 'run:7 dispatch', reason: null }, null, 7],
```

(b) Same file, layer 2c `EXPECTED` — replace the `wsAddWorker` entry with:

```ts
    // `--child <runId>` IMMEDIATELY after `--no-rc`: both are declarations of
    // what this spawn IS, both are parsed by the same strip loop, and neither
    // may trail the dec, where an old ccd's positional binding would eat it.
    wsAddWorker: ['ws-add', '--no-rc', '--child', '7', 'demo', '--surface', 'agent', '--actor', 'run:7 dispatch'],
```

(c) Same file, layer 2c — insert directly above `  it('prOpen maps a real boolean draft to --draft true/false unambiguously', () => {`:

```ts
  // CHILD-RECLAMATION WAVE 1. The exact-argv row above carries a child but no
  // route (its sample's route is `null`), so it cannot see the ORDER of the two
  // leading groups. This can: `--child` first, then `--route`, both before the
  // project — and a `null` child adds nothing at all.
  it('wsAddWorker leads with --child, then --route, both before the project — and null adds nothing', () => {
    expect(CCD_ARGV.wsAddWorker('demo', null, { class: 'opus' }, 7))
      .toEqual(['ws-add', '--no-rc', '--child', '7', '--route', 'class=opus', 'demo']);
    expect(CCD_ARGV.wsAddWorker('demo', null, { class: 'opus' }, null))
      .toEqual(['ws-add', '--no-rc', '--route', 'class=opus', 'demo']);
    expect(CCD_ARGV.wsAddWorker('demo', null, null, null)).toEqual(CCD_ARGV.wsAddWorker('demo', null));
  });

```

(d) Append to the END of `server/test/ccdargv-dec-parity.test.ts`:

```ts

describe('the child the server composes is the child real ccd records (child-workspace reclamation wave 1)', () => {
  it('wsAddWorker with a run id: the marker holds exactly that id, beside the declared dec', () => {
    // THE SAME CROSSING as the describe above, for the flag that makes a
    // workspace a CHILD. `whitelist-subset.test.ts` proves the tokens cross the
    // agent's bare `['ws-add']` grant, which they would whatever ccd made of
    // them; this proves the binary on the fleet box READS them — as the marker,
    // and not as a slug or a project (D-410, one flag to the left).
    h.makeRepo(PROJECT);
    runCcd(CCD_ARGV.wsAddWorker(PROJECT, PROBE_DEC, null, 7));
    const rows = uuidRows();
    expect(rows, 'the child-marked ws-add created no workspace — the flag was bound as a positional')
      .toHaveLength(1);
    const id = rows[0]!.replace(/\.uuid$/, '');
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', `${id}.child`), 'utf8')).toBe('7');
    const created = eventsOf(h.home, 'create');
    expect(created).toHaveLength(1);
    expect(decOf(created[0]!)).toEqual({ surface: 'agent', actor: 'probe:dec parity' });
    // And the first spawn already made its root: `_spawn_start` ran before the
    // fixture's contained tmux refused, and the root is made before the pane.
    const root = path.join(h.home, '.cc-tmp', id);
    expect(fs.statSync(root).isDirectory()).toBe(true);
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
  });

  it('and handed no child it writes no marker — absence permits, byte for byte the old argv', () => {
    h.makeRepo(PROJECT);
    expect(CCD_ARGV.wsAddWorker(PROJECT, PROBE_DEC, null, null))
      .toEqual(CCD_ARGV.wsAddWorker(PROJECT, PROBE_DEC));
    runCcd(CCD_ARGV.wsAddWorker(PROJECT, PROBE_DEC, null, null));
    const rows = uuidRows();
    expect(rows).toHaveLength(1);
    const id = rows[0]!.replace(/\.uuid$/, '');
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', `${id}.child`))).toBe(false);
    expect(fs.existsSync(path.join(h.home, '.cc-tmp'))).toBe(false);
  });
});
```

(`runCcd`, `uuidRows`, `PROJECT`, `PROBE_DEC`, `h`, `eventsOf` and `decOf` are all the file's own; nothing new is imported.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/ccdargv-dec-parity.test.ts
```

Expected, measured: `wsAddWorker builds the exact argv, token for token` FAILS (no `--child` in the composed argv — the fourth sample argument is ignored at runtime), the new order case FAILS on its first `toEqual`, and "wsAddWorker with a run id: the marker holds exactly that id…" FAILS with `ENOENT` on `<id>.child`. "…handed no child it writes no marker" passes (it is the absence control).

- [ ] **Step 3: Add the helper and the parameter**

(3a) In `server/src/ccdargv.ts`, directly after `routeFlags`'s two lines (`const routeFlags = (r: RouteFields | null): string[] =>` and its body), insert:

```ts

/**
 * The `--child <runId>` pair for a dispatched spawn (child-workspace
 * reclamation, spec §5.1). `null` contributes NOTHING — `routeFlags`' own
 * contract, for the same reason: a box that does not advertise `child-argv-v1`
 * must receive the argv it always did, byte for byte.
 *
 * A HELPER RATHER THAN AN INLINE TERNARY, and that is measured, not taste:
 * `ccdargv-dec-parity.test.ts` derives which verbs carry a dec by walking each
 * `argv([…])` literal in `CCD_ARGV` up to its first `])`, and an inline
 * `[...(child === null ? [] : ['--child', String(child)]), …]` closes a `])`
 * INSIDE the literal — so the walk stops short of `decFlags(`, `ws-add` drops
 * out of the derived set, and that suite reds on a builder that still declares.
 */
const childFlags = (child: number | null): string[] =>
  child === null ? [] : ['--child', String(child)];
```

(3b) Replace

```ts
  wsAddWorker: (p: string, dec: ActorFlags | null, route: RouteFields | null = null) =>
                 argv(['ws-add', '--no-rc', ...routeFlags(route), p, ...decFlags(dec)]),
```

with

```ts
  /**
   * `child`, the minting run's id (child-workspace reclamation, spec §5.1): the
   * BOX half of the two authorities that make a workspace a child. It goes
   * IMMEDIATELY AFTER `--no-rc`, in the leading-flag group `cmd_ws_add`'s strip
   * loop parses — never trailing after `decFlags`, for `route`'s reason above —
   * and ahead of `--route`, so the two declarations the dispatch path makes
   * about WHAT this spawn is (`--no-rc`, `--child`) sit together and the one
   * about how it RUNS follows them. `null` — the default, and what dispatch
   * passes to a box without `child-argv-v1` — composes this builder's previous
   * argv token for token. A NUMBER, not a string: the run id is a SQLite rowid
   * everywhere in the coordination store, and stringifying it here, once, means
   * no caller can hand ccd a padded or signed spelling its grammar would refuse.
   */
  wsAddWorker: (p: string, dec: ActorFlags | null, route: RouteFields | null = null, child: number | null = null) =>
                 argv(['ws-add', '--no-rc', ...childFlags(child), ...routeFlags(route), p, ...decFlags(dec)]),
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && npx tsc --noEmit -p . && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts \
  test/ccdargv-dec-parity.test.ts test/capsupported.test.ts test/ccdargv-brand.test.ts \
  test/unattended-actor.test.ts test/dispatch-route.test.ts test/dispatch-adopt.test.ts
```

Expected: tsc clean; PASS, 177 tests at `507aefe9` (178 measured by review on a base without it — a different total with every case passing is not a red) (`whitelist-subset` 76, `ccdargv-dec-parity` 12 — the derived set still finds SIX dec-appending verbs, `ws-add` among them). Every existing dispatch fixture still composes the old argv, because nothing passes a child yet.

- [ ] **Step 5: Mutation check, then commit**

| # | Exact edit in `server/src/ccdargv.ts` | Command (from `server/`) | Expected red |
|---|---|---|---|
| 1 | `child === null ? [] : ['--child', String(child)];` → `child === null ? [] : [];` | `./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/ccdargv-dec-parity.test.ts` | "wsAddWorker builds the exact argv…", the order case, and "wsAddWorker with a run id: the marker holds exactly that id…" (3 failed) |
| 2 | the builder's body → `argv(['ws-add', '--no-rc', ...(child === null ? [] : ['--child', String(child)]), ...routeFlags(route), p, ...decFlags(dec)])` (the inline form Pre-flight finding 1 refuses) | `./node_modules/.bin/vitest run test/ccdargv-dec-parity.test.ts` | "derives the dec-appending verbs from the table, and finds six…" |
| 3 | swap the two spreads: `...routeFlags(route), ...childFlags(child),` | `./node_modules/.bin/vitest run test/whitelist-subset.test.ts` | "wsAddWorker leads with --child, then --route…" only — the reason that case exists |

```bash
git add server/src/ccdargv.ts server/test/whitelist-subset.test.ts server/test/ccdargv-dec-parity.test.ts
git commit -m "$(cat <<'MSG'
feat(server): wsAddWorker composes --child <runId> after --no-rc

A fourth parameter, child: number | null = null. childFlags puts
'--child', String(child) immediately after '--no-rc' and ahead of --route;
null composes the previous argv token for token. A helper rather than an
inline ternary, because ccdargv-dec-parity's derivation walks each argv([…])
literal to its first ']' + ')' and an inline array closes one early (measured:
ws-add drops out of the derived set). The flagged sample crosses the agent's
bare ['ws-add'] grant (layer 2) and real ccd records it as the marker
(ccdargv-dec-parity's new crossing). Spec §5.1.
MSG
)"
```

---

### Task 5: Dispatch sends the run id, or journals why it did not

**Model routing:** `sonnet`, effort `high`.

**Files:**
- Modify: `server/src/coord/dispatch.ts` — the `ccdargv.js` import (line 10) and the fresh-spawn arm (`if (run.sessionId === null) {`, the `wsAddWorker` call ≈line 459)
- Test: `server/test/dispatch-child-argv.test.ts` (new)
- Modify: `server/test/run-routes.test.ts` (two cases), `server/test/coord-decide.test.ts` (one case)
- Modify: `ccd/coordinator-skill/references/wave-lifecycle.md` — one paragraph in §2, directly after the `route` paragraph; `server/test/coordinator-skill.test.ts` — one `it` pinning it

**Interfaces:**
- Consumes: `CHILD_ARGV_CAP` (Task 3), `CCD_ARGV.wsAddWorker`'s fourth parameter (Task 4), `capSupported`.
- Produces: on the fresh-spawn arm, `const child = capSupported(deps.fleetState, CHILD_ARGV_CAP) ? run.id : null;` passed to `wsAddWorker`; when `null`, `coord.recordRunEvent(id, 'coordinator', 'child-omitted:no-child-argv-cap')` before `markDispatchStarted` — the `route-omitted:no-route-argv-cap` precedent, same placement (contract §1). Review runs are dispatched through this same arm and are children too. The resume arm is untouched (wave 2 gates it).

- [ ] **Step 1: Write the failing tests**

(a) Create `server/test/dispatch-child-argv.test.ts`:

```ts
// Child-workspace reclamation, spec §5.1 and §6 "Deploy", wave 1: dispatch is
// the server's ONE writer of the `--child <runId>` flag — the server half of
// the two authorities that make a workspace a child. It rides the fresh-spawn
// `ws-add` only, gated on the `child-argv-v1` capability read with
// `capSupported` (no evidence REFUSES), and its omission is journalled on the
// run exactly as `--route`'s is.
//
// The harness is `dispatch-route.test.ts`'s, trimmed: a direct `dispatchRun`
// over a real `CoordStore`, with one recording `Runner` shared by `runCcd` and
// `tmux` so every ccd call is observable in order.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun, type DispatchRunDeps } from '../src/coord/dispatch.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, CHILD_ARGV_CAP, ROUTE_ARGV_CAP, ROUTE_CAP } from '../src/ccdargv.js';
import { configDirFor } from '../src/config.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const OMITTED = 'child-omitted:no-child-argv-cap';

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];

function makeRunner(home: string, creates: string): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (verb === 'ws-add') { seed(home, creates); return { code: 0, stdout: '', stderr: '' }; }
    if (verb === 'capture-pane') {
      const p = CLEAR_PANES[Math.min(capIdx, CLEAR_PANES.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

const WITH_CHILD = ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, CHILD_ARGV_CAP];
const WITHOUT_CHILD = ['ws-add', 'ensure', 'ws-hold', ACTOR_FLAGS_CAP, ROUTE_ARGV_CAP, ROUTE_CAP];

interface HarnessCfg {
  /** `null` is "the agent sent no caps list at all" — no evidence. */
  ccdVerbs: string[] | null;
  kind?: 'work' | 'review';
  /** Bind the run to an existing session first: the resume arm. */
  sessionId?: string;
}

const harness = (cfg: HarnessCfg) => {
  const home = mkTmp('ccrc-dispatch-child-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  let reviews: number | null = null;
  if (cfg.kind === 'review') {
    const work = coord.openRun({ program: 'p', title: 'w', project: PROJECT, wave: 1, waveOf: 1, claimedBy: 'c' });
    if (!('id' in work)) throw new Error(`fixture openRun refused: ${JSON.stringify(work)}`);
    reviews = work.id;
  }
  const opened = coord.openRun({
    program: 'p', title: 't', project: PROJECT, wave: 1, waveOf: 2, claimedBy: 'c',
    ...(cfg.kind === 'review' ? { kind: 'review' as const, reviews } : {}),
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  if (cfg.sessionId !== undefined) {
    seed(home, cfg.sessionId);
    coord.setSession(opened.id, cfg.sessionId);
  }
  const { run, calls } = makeRunner(home, 'demo-quiet-mesa');
  const base = testDeps(home, run);
  const deps: DispatchRunDeps = {
    ...base, coord,
    fleetState: { connected: true, downSince: null, ccdVerbs: cfg.ccdVerbs, rosterFp: null, build: null },
    configDir: (w: string) => configDirFor(base.cfg, w),
  };
  return {
    runId: opened.id, calls,
    dispatch: (route?: unknown) => dispatchRun(deps, opened.id, 'go', undefined, route),
    wsAdds: (): string[][] => calls.filter((c) => c[0] === 'ws-add'),
    events: (): string[] =>
      coord.runEvents(opened.id).map((e) => e.detail).filter((d): d is string => d !== null),
  };
};

describe('dispatch marks the workspace it mints as a child of the run (spec §5.1)', () => {
  it('with child-argv-v1: --child <run id> rides IMMEDIATELY after --no-rc, and nothing is journalled', async () => {
    const h = harness({ ccdVerbs: WITH_CHILD });
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.wsAdds()).toEqual([
      ['ws-add', '--no-rc', '--child', String(h.runId), PROJECT, '--surface', 'agent', '--actor', `run:${h.runId} dispatch`],
    ]);
    expect(h.events()).not.toContain(OMITTED);
  });

  it('with --route too: the two declarations of WHAT the spawn is lead, then how it RUNS', async () => {
    const h = harness({ ccdVerbs: WITH_CHILD });
    expect(await h.dispatch({ class: 'opus' })).toMatchObject({ ok: true });
    expect(h.wsAdds()).toEqual([
      ['ws-add', '--no-rc', '--child', String(h.runId), '--route', 'class=opus', PROJECT,
       '--surface', 'agent', '--actor', `run:${h.runId} dispatch`],
    ]);
  });

  it('a REVIEW run is dispatched through the same arm, and its workspace is a child too', async () => {
    const h = harness({ ccdVerbs: WITH_CHILD, kind: 'review' });
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.wsAdds()[0]!.slice(0, 4)).toEqual(['ws-add', '--no-rc', '--child', String(h.runId)]);
  });

  it('without the token: the argv is byte-identical to the pre-wave one, and the omission is journalled once', async () => {
    const h = harness({ ccdVerbs: WITHOUT_CHILD });
    expect(await h.dispatch()).toMatchObject({ ok: true });
    expect(h.wsAdds()).toEqual([
      ['ws-add', '--no-rc', PROJECT, '--surface', 'agent', '--actor', `run:${h.runId} dispatch`],
    ]);
    expect(h.events().filter((d) => d === OMITTED)).toHaveLength(1);
  });

  it('with NO caps list at all (no evidence): refused, exactly as an absent token — never PERMITTED', async () => {
    // `verbSupported` would permit here ("an absent list must never grey out
    // the fleet"). For a FLAG on a verb every box has, that default is the
    // D-410 wedge; `capSupported` is what refuses it.
    const h = harness({ ccdVerbs: null });
    await h.dispatch();
    const wsAdd = h.wsAdds()[0];
    expect(wsAdd, 'no ws-add call recorded').toBeDefined();
    expect(wsAdd).not.toContain('--child');
    expect(h.events()).toContain(OMITTED);
  });

  it('the RESUME arm mints nothing, so it neither sends --child nor journals an omission', async () => {
    const h = harness({ ccdVerbs: WITHOUT_CHILD, sessionId: 'demo-existing' });
    expect(await h.dispatch(), 'the resume arm must really have run').toMatchObject({ ok: true, resumed: true });
    expect(h.wsAdds()).toEqual([]);
    expect(h.events()).not.toContain(OMITTED);
  });
});
```

(b) `server/test/run-routes.test.ts`, the case `records the transition with causedBy=coordinator` — its fixture advertises no `child-argv-v1`, so the fresh spawn now journals the omission FIRST, while the run still rests at `planned`. Replace

```ts
    await postDispatch(app, opened.id);
    expect(w.coord.runEvents(opened.id)).toEqual([
      { at: expect.any(Number), fromState: 'planned', toState: 'dispatched', causedBy: 'coordinator', detail: null },
```

with

```ts
    await postDispatch(app, opened.id);
    expect(w.coord.runEvents(opened.id)).toEqual([
      // Child-workspace reclamation wave 1: this fixture's fleet advertises no
      // `child-argv-v1`, so the fresh spawn omits `--child` and says so on the
      // run, BEFORE the transition — recorded while the run still rests at
      // `planned`, which is why both states read `planned`.
      { at: expect.any(Number), fromState: 'planned', toState: 'planned', causedBy: 'coordinator',
        detail: 'child-omitted:no-child-argv-cap' },
      { at: expect.any(Number), fromState: 'planned', toState: 'dispatched', causedBy: 'coordinator', detail: null },
```

(c) Same file, case `refuses a second dispatch before touching the fleet at all — the transition guard runs FIRST (D-46)` — replace

```ts
    // Two rows from the FIRST dispatch (its transition plus its skill
    // preflight, wave 2 F2), and none from the refused second.
    expect(w.coord.runEvents(opened.id).length).toBe(2);
```

with

```ts
    // Three rows from the FIRST dispatch (its `child-omitted` row — this
    // fixture advertises no `child-argv-v1` — its transition, and its skill
    // preflight, wave 2 F2), and none from the refused second.
    expect(w.coord.runEvents(opened.id).length).toBe(3);
```

(d) `server/test/coord-decide.test.ts`, case `dispatching the same run twice, back to back, leaves the fleet call log UNCHANGED on the second call` — replace

```ts
    // Still only the FIRST dispatch's own rows: its transition, plus the skill
    // preflight every successful dispatch records (wave 2, F2).
    expect(coord.runEvents(opened.id).length).toBe(2);
```

with

```ts
    // Still only the FIRST dispatch's own rows: its transition, plus the skill
    // preflight every successful dispatch records (wave 2, F2), plus the
    // `child-omitted:no-child-argv-cap` row a fresh spawn journals on a box
    // with no `child-argv-v1` (`fleetState: undefined` is no evidence, so
    // `capSupported` refuses — child-workspace reclamation wave 1).
    expect(coord.runEvents(opened.id).length).toBe(3);
```

(e) The coordinator's reference must name the new run event before a run trail shows it one — the `route-omitted` precedent, whose two events `coordinator-skill.test.ts` pins in `wave-lifecycle.md`. This one matters MORE: it fires on every fresh dispatch to a box without the token, not only when the coordinator asked for routing. In `server/test/coordinator-skill.test.ts`, insert directly above `  it('names POST /api/runs/:id/items after the re-measurement, never before', () => {` (inside the linkage `describe`, where `refs` is in scope):

```ts
  it('names the child-omitted run event a fresh dispatch journals on a box without child-argv-v1', () => {
    // Child-workspace reclamation wave 1. `dispatchRun` journals this row on
    // EVERY fresh dispatch to a box whose ccd predates `child-argv-v1` — far
    // more often than either `route-omitted` event — so the coordinator's
    // reference must say what it means before a run trail shows it one.
    const lifecycle = refs('wave-lifecycle.md');
    expect(lifecycle).toContain('`child-omitted:no-child-argv-cap`');
    expect(lifecycle).toContain('that workspace is simply not a child');
  });

```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/dispatch-child-argv.test.ts test/coord-decide.test.ts test/run-routes.test.ts
```

Expected, measured: `8 failed | 224 passed (232)` — five of the six new cases (all but the resume arm), plus the three updated pins (they now expect a row the old dispatch does not write).

```bash
cd server && ./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t 'child-omitted'
```

Expected, measured: `1 failed | 145 skipped (146)` — `expected '# The wave lifecycle, in full\n\nEver…' to contain '`child-omitted:no-child-argv-cap`'`.

- [ ] **Step 3: Gate the flag and journal its omission**

(3a) Line 10 of `server/src/coord/dispatch.ts` becomes:

```ts
import { CCD_ARGV, CHILD_ARGV_CAP, ROUTE_ARGV_CAP, ROUTE_CAP, capSupported, verbSupported, sweepDec } from '../ccdargv.js';
```

(3b) In the fresh-spawn arm, replace

```ts
    const argv = CCD_ARGV.wsAddWorker(run.project, dispatchDec,
      capSupported(deps.fleetState, ROUTE_ARGV_CAP) ? routeFields : null);
```

(it sits directly under the `route-omitted:no-route-argv-cap` block; exactly one hit for `CCD_ARGV.wsAddWorker(` in `server/src`) with

```ts
    // THE CHILD (child-workspace reclamation, spec §5.1): every workspace this
    // arm mints is a child of THIS run — review runs included, since they are
    // dispatched through this same arm — so `--child <run.id>` is sent
    // unconditionally, EXCEPT to a box that has not said it parses the flag.
    // Gated on `CHILD_ARGV_CAP` with `capSupported` (no evidence REFUSES): an
    // older `cmd_ws_add` would bind `--child` as the project and refuse the
    // spawn outright (D-410, one flag to the left). Unlike `--route` there is
    // no "the caller asked for nothing" arm, so a box without the token ALWAYS
    // journals the omission — a workspace minted without the marker is simply
    // not a child, and the run's own trail is where a reader learns why.
    const child = capSupported(deps.fleetState, CHILD_ARGV_CAP) ? run.id : null;
    if (child === null) {
      coord.recordRunEvent(id, 'coordinator', 'child-omitted:no-child-argv-cap');
    }
    const argv = CCD_ARGV.wsAddWorker(run.project, dispatchDec,
      capSupported(deps.fleetState, ROUTE_ARGV_CAP) ? routeFields : null, child);
```

The argv is built BEFORE `runCcd`, so an adopted spawn (a `ws-add` killed mid-flight, `dispatch-adopt.test.ts`) carries the same flag with no extra code — the `--route` gate's own property.

(3c) In `ccd/coordinator-skill/references/wave-lifecycle.md` §2, directly after the `route` paragraph's last line (`for saying so.`, which follows `object is what carries that placement to the fleet, never a replacement`) and before `**The ledger is fixed at dispatch.**`, insert one blank line and this paragraph (the file's own ~76-column wrap):

```markdown
**`child-omitted:no-child-argv-cap` — a fresh workspace that is not a
child.** Every workspace a fresh dispatch mints is a CHILD of its run: the
server sends `--child <run id>` on the `ws-add` argv and `ccd` records it as
the workspace's child marker before the first launch. A box whose `ccd`
predates the `child-argv-v1` capability cannot parse that flag, so the
server omits it and journals `child-omitted:no-child-argv-cap` on the run —
on EVERY fresh dispatch to that box, not only when you asked for something,
unlike the two `route-omitted` events. It is not an error and asks nothing
of you: that workspace is simply not a child, exactly like every workspace
minted before the token existed, and nothing will ever reclaim it as one. A
resumed workspace mints nothing and never carries the row.
```

It names the event, says it fires on every fresh dispatch to such a box, and says what it costs — nothing to do, the workspace is simply not a child — so a coordinator never reads it as a failed dispatch.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && npx tsc --noEmit -p . && ./node_modules/.bin/vitest run test/dispatch-child-argv.test.ts \
  test/coord-decide.test.ts test/run-routes.test.ts test/dispatch-route.test.ts test/dispatch-adopt.test.ts \
  test/dispatch-hold-order.test.ts test/dispatch-skillstate.test.ts test/dispatch-mutex-gate.test.ts
./node_modules/.bin/vitest run test/coordinator-skill.test.ts test/install-coordinator-skill.test.ts \
  test/worker-skill.test.ts test/reviewer-skill.test.ts test/ccrc-api-closed.test.ts
```

Expected: tsc clean; PASS, 289 tests (`dispatch-child-argv` 6/6, `run-routes` 221, `coord-decide` 5); the second run PASS (every suite that reads `wave-lifecycle.md`, the new `child-omitted` case among them). Then the whole population that dispatches or reads run events — measured on the prototype as 42 files, of which only the three updated in Step 1 needed an edit:

```bash
./node_modules/.bin/vitest run $(grep -rlE 'dispatchRun|postDispatch|/dispatch|wsAddWorker|runEvents' test/*.test.ts \
  | grep -v session-hook | tr '\n' ' ')
```

Expected: PASS (2090 tests on the prototype). If any OTHER file reds on an unexpected `child-omitted:no-child-argv-cap` row, it asserts an exact event list this plan did not find: update it the same way, and name it in the commit.

- [ ] **Step 5: Mutation check, then commit**

| # | Exact edit in `server/src/coord/dispatch.ts` | Command (from `server/`) | Expected red |
|---|---|---|---|
| 1 | `const child = capSupported(deps.fleetState, CHILD_ARGV_CAP) ? run.id : null;` → `const child = run.id as number \| null;` (the permissive default) | `./node_modules/.bin/vitest run test/dispatch-child-argv.test.ts` | "without the token…" and "with NO caps list at all…" (2 failed) |
| 2 | delete the `coord.recordRunEvent(id, 'coordinator', 'child-omitted:no-child-argv-cap');` line | `./node_modules/.bin/vitest run test/dispatch-child-argv.test.ts test/coord-decide.test.ts test/run-routes.test.ts` | the two omission cases here plus the three updated pins (5 failed; a sixth, run-routes' 31-second "failed+archive with NO sibling still archives", is a load timeout — re-run it alone) |
| 3 | drop `, child` from the `wsAddWorker(` call | `./node_modules/.bin/vitest run test/dispatch-child-argv.test.ts` | the three with-token cases — work, `--route`, review (3 failed) |
| 4 | `wave-lifecycle.md`: delete the (3c) paragraph | `./node_modules/.bin/vitest run test/coordinator-skill.test.ts -t 'child-omitted'` | "names the child-omitted run event…" (`1 failed \| 145 skipped`) |

```bash
git add server/src/coord/dispatch.ts server/test/dispatch-child-argv.test.ts \
        server/test/run-routes.test.ts server/test/coord-decide.test.ts \
        ccd/coordinator-skill/references/wave-lifecycle.md server/test/coordinator-skill.test.ts
git commit -m "$(cat <<'MSG'
feat(dispatch): mark every minted workspace a child of its run, or say why not

dispatchRun's fresh-spawn arm sends run.id as --child when the box advertises
child-argv-v1 (capSupported: no evidence refuses), review runs included. A box
without the token gets the pre-wave argv byte for byte and the run journals
child-omitted:no-child-argv-cap — unconditionally, unlike route-omitted, since
every dispatch wants a child. That new row lands in three existing exact event
pins (run-routes x2, coord-decide), updated here; of the 42 files that dispatch
or read run events they are the only ones it reached. wave-lifecycle.md §2
names the new event and what it costs, pinned in coordinator-skill.test.ts as
route-omitted's two events are. Spec §5.1, §6 "Deploy".
MSG
)"
```

---

### Task 6: Whole-branch verification, the pre-policy count, the PR — and the AGENT-FIRST deploy

**Model routing:** `sonnet`, effort `high`.

**Files:** none modified — this task runs, measures, opens the PR and hands over the deploy.

**Interfaces:**
- Consumes: everything Tasks 1–5 produced, and Task 1's verdict.
- Produces: the wave-1 PR on this workspace's own branch, and a wave-done report carrying both measurements. Wave 2 consumes `$REG/<id>.child` (via `fieldMeasured`), `CHILD_ARGV_CAP` and the `child-argv-v1` a deployed ccd advertises; wave 3 consumes `$HOME/.cc-tmp/<id>` (unlinking a symlink or regular-file leaf with `rm -f --`, never following it, contract §7 R1) and calls `_child_runid_valid` at every run-id parse, never re-spelling it (R2). None of it does anything until this is on the fleet box.

- [ ] **Step 1: Run all three package suites, in the foreground**

The server suite no longer fits one 600 s call on the loaded fleet box, so it runs as twelve SEQUENTIAL shards (each its own foreground call, timeout 600000 ms) whose union is every file exactly once — never in parallel, which reds the timing tests:

```bash
cd server && npm ci
./node_modules/.bin/vitest run --shard=1/12     # … then 2/12, 3/12, … 12/12, one call each
cd ../agent && npm ci && npm run test
cd ../pwa   && npm ci && npm run test
```

Expected: PASS everywhere. `agent` and `pwa` are untouched by this wave and must be green unchanged. Report the twelve shard summaries and their sum. At planning (378 files) the whole `ccd-tmux-server` … `ccd-ws-reap` family falls in shard 4/12, and `ccd-ws-audit` alone measured ~490 s under load: if ANY shard is killed by the 600 s ceiling, do not background it and do not trust its tail — re-run the WHOLE suite as `--shard=k/24`, k = 1…24, whose union is again every file exactly once. Re-run any known load flake (Global Constraints list, including `boot.test.ts`'s two timing cases) IN ISOLATION before calling it a break.

- [ ] **Step 2: Cross-tree deviation check, and the corpus premise**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts
cd .. && git diff --quiet origin/main -- \
  docs/superpowers/specs/2026-09-09-graphify-compaction-card-design.md \
  docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md && echo corpus-frozen
```

Expected: PASS, and `corpus-frozen`. If `origin/main` moved `ccd/ccd` or `README.md` since Task 3, merge it, re-run Tasks 2–3's tax steps (re-pointer, then `cite-remeasure.py` against the merge's first parent) and re-run the citation cases — an assertion over the merge is only true on the merged tree.

- [ ] **Step 3: The wave's own surface in one run**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-child-tmpdir.test.ts test/ccd-ws-add-child.test.ts \
  test/dispatch-child-argv.test.ts test/ccdargv-dec-parity.test.ts test/whitelist-subset.test.ts \
  test/capsupported.test.ts test/ccd-archive.test.ts test/caps-token-shape.test.ts test/ownership.test.ts \
  test/ccd-reg-get-census.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-spawn-split.test.ts
./node_modules/.bin/vitest run test/session-hook.test.ts \
  -t 'CITATION DEBT|README HAS|LOCATION INDEXES|ROW PASS|RANGE BOUND|TWO CORPUS|whole corpus'
```

Expected: PASS. If `ownership` reds, `ccd/ccd` was edited after the last re-stamp.

- [ ] **Step 4: The pre-policy count, measured read-only now (measurement (b), pre-merge snapshot)**

```bash
SCRATCH=<your scratchpad, absolute>   # on the fleet box after the rollout: any private absolute directory
[[ "$SCRATCH" == /* && -d "$SCRATCH" ]] || echo "STOP: SCRATCH is not an absolute directory — the lines below would write under /"
M="$SCRATCH/prepolicy"; mkdir -p "$M"
ls -1 "$HOME/.cc-sessions" | sed -n 's/\.workspace$//p' | sort > "$M/ws.txt"
ls -1 "$HOME/.cc-sessions" | sed -n 's/\.child$//p'     | sort > "$M/child.txt"
ls -1 "$HOME/.cc-sessions" | sed -n 's/\.archived$//p'  | sort > "$M/archived.txt"
echo "at: $(date -u +%FT%TZ)"
echo "workspaces:            $(wc -l < "$M/ws.txt")"
echo "with a .child marker:  $(comm -12 "$M/ws.txt" "$M/child.txt" | wc -l)"
echo "pre-policy (no marker): $(comm -23 "$M/ws.txt" "$M/child.txt" | wc -l)"
echo "  of which archived:   $(comm -23 "$M/ws.txt" "$M/child.txt" | comm -12 - "$M/archived.txt" | wc -l)"
```

Expected: `with a .child marker: 0` (no deployed ccd writes one yet) and a pre-policy figure equal to the workspace count. This is `ls` of the live registry and nothing else — no file there is opened for writing. The SHIPPING figure is taken again by whoever deploys, immediately after the rollout (Step 7, (d)), because "the moment the ccd ships" is after this PR merges; report this snapshot beside it so the two can be told apart.

- [ ] **Step 5: Confirm the author, push, and open the PR**

```bash
git log --format='%an <%ae>' "$(git merge-base origin/main HEAD)"..HEAD | sort -u
```

Expected: exactly one line, the identity this workspace is configured to commit as — not a placeholder. The pre-push hook refuses identity residue; if it does, fix the author, do not bypass the hook.

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Child reclamation wave 1: the --child marker and a child's own TMPDIR (AGENT-FIRST)" --body-file - <<'EOF'
Wave 1 of the child-reclamation programme (CCR-15; spec `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` §5.1, §5.2, §6). **AGENT-FIRST.** Nothing here destroys anything.

What it does:

1. **`ccd ws-add --child <runId>`** — parsed in `cmd_ws_add`'s existing strip loop, positionless; refused above every mint unless it is a run id (`^[1-9][0-9]{0,9}$` under `LC_ALL=C` — the bare pattern accepts `²`, `½`, `٣`, `१` under `en_US.UTF-8`, measured), checked through `_child_runid_valid`, the one run-id grammar in ccd that every later wave calls (programme contract §7 R2, its single spelling pinned by a test); written as `$REG/<id>.child` before the first spawn. A marker that cannot land warns and leaves a workspace that is simply not a child.
2. **A child's own `TMPDIR`** — `_child_tmpdir` (three answers: contained / not a child / leaf unusable) is called once from `_spawn_start`, the function every spawn path funnels through, and spliced into the one `env` string both spawn lines use. Driven by the marker only; a `--no-rc` row with no marker gets nothing; a leaf that is not a real directory this user owns at 0700 spawns uncontained, warned, rather than refusing.
3. **`child-argv-v1`** — echoed by `cmd_caps`, spelled once as `CHILD_ARGV_CAP`, held equal by `ccd-archive.test.ts` in the same commit.
4. **`wsAddWorker(p, dec, route, child)`** — `'--child', String(child)` immediately after `'--no-rc'` via a `childFlags` helper (an inline ternary breaks `ccdargv-dec-parity`'s derivation, measured).
5. **Dispatch** sends `run.id` when the box advertises the token (`capSupported`, no evidence refuses) and otherwise journals `child-omitted:no-child-argv-cap`; three existing exact event pins updated for that row, and `wave-lifecycle.md` §2 tells a coordinator what the row means (pinned in `coordinator-skill.test.ts`).

Ruled behaviour (programme contract §7 R1, accepted): a MARKED child whose temp-root leaf is not, and cannot be made, a real directory (not a symlink) owned by this user at 0700 — the leaf is a symlink or a file, another user owns it, or `mkdir`/`chmod` fails — spawns WITHOUT `TMPDIR`, warned on stderr, rather than refusing. Wave 3's tail unlinks such a leaf with `rm -f --`, never following it.

Citation corpus (S6-R11): every long argument sits below the corpus's lowest frozen `ccd/ccd` anchor; eight code lines above it moved the `|`-row and site-level sets (composition stated in the test), `byFile` unchanged at 147. README's two anchors re-pointed by the bytes their sentences quote. Unrelated to this wave's scope: that re-pointer also repaired one anchor `main` left green-but-stale (`cmd_ensure`'s mint).

Measurements (the coordinator records them in the programme ledger): (a) where Claude Code's scratchpad lands when `TMPDIR` is set — see the wave-done report; (b) the pre-policy workspace count — a pre-merge snapshot in the report, and the shipping figure taken right after the rollout.

**Deploy: `ccrc rollout --to <this merge's tag>` in its default order — fleet box first. Never `--server-first` for this wave.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 6: Report (the wave-done mail)**

Report to the coordinator, per the worker skill: the branch tip sha; the three suites' results (the twelve server shard summaries and their sum); Task 1's verdict word with `answer.txt`, both `find` listings and its `registry untouched` line; Step 4's snapshot with its timestamp; the citation-tax outputs of Tasks 2 and 3 (the re-pointer's two lines and `cite-remeasure.py`'s composition, each task); every mutation row's measured red; every departure from this plan, named by what it is (the coordinator assigns numbers — see `## Deviations found`); and, SEPARATELY and labelled as outside the wave's scope, **the unrelated README repair** the re-pointer made (`cmd_ensure`'s mint anchor, green-but-stale on `main`; Pre-flight finding 7), so the reviewer and the other programmes' coordinators see it. Then stop: the deploy below runs after the merge, by whoever merges.

- [ ] **Step 7: Deploy — AGENT LANE FIRST (post-merge, from a machine holding `~/.ccrc/deploy.env`)**

**This wave is AGENT-FIRST, and the order matters even though the capability gate makes either order SAFE.** A new server under an old ccd sees no `child-argv-v1`, omits the flag and journals it; a new ccd under an old server never receives the flag. Neither order breaks a dispatch — which is the point of the token. What fleet-box-first buys is that the first dispatch after the server lands already mints a child, rather than journalling an omission for a box that has the parse. And `ccrc rollout` pins this order by default, so the rule is simply: no `--server-first`.

(a)+(b) Find the release THIS PR's merge produced, and roll the fleet to exactly that build, fleet box first (the default) — ONE block, because the tag must be computed in the same shell that uses it. The tag is resolved from the PR's own merge commit, never from wherever `origin/main` stands: two other programmes merge against the same files, and `git tag --points-at origin/main` answers another merge's tag (or nothing) the moment one lands after this one. `release-main.yml` cuts a prerelease per merge in about a minute.

```bash
PR=<this wave's PR number>
git fetch origin main --tags
M=$(gh pr view "$PR" --json mergeCommit -q .mergeCommit.oid)
TAG=$(git tag --points-at "$M" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
echo "merge: $M  tag: ${TAG:-<none yet>}"
if [ -n "$M" ] && [ -n "$TAG" ]; then
  ccrc rollout --to "$TAG"
  echo "rollout rc=$?"
  ccrc rollout --check
else
  echo "STOP: no release tag on this PR's merge commit yet — wait for release-main.yml and re-run this block"
fi
```

Expected: `merge: <sha>  tag: vX.Y.Z`, then both boxes report that tag, converged. An empty tag means the release has not landed yet — wait and re-run the block; never roll a working tree with `deploy.sh` for this wave. A rollout exits 3 when a box moved but its doctor has FAIL lines — the box IS on the new build; read the FAIL lines before anything else.

(c) Prove the fleet box advertises the token (a shell on the fleet box):

```bash
ccd caps | grep -x child-argv-v1
```

Expected: `child-argv-v1`. If it prints nothing, the fleet box did not take the new ccd — stop; the server is harmless without it, but no child will be minted.

(d) Measurement (b), the SHIPPING figure, on the fleet box, now — Step 4's commands verbatim, run again, and reported to the coordinator with their timestamp for the programme ledger.

(e) Verify the first child, right after wave 2's dispatch (the coordinator opens wave 2 WITHOUT `sessionId`, the programme's own rule) — read-only, on the fleet box:

```bash
f=$(ls -t "$HOME"/.cc-sessions/*.child 2>/dev/null | head -1); ID=$(basename "$f" .child)
echo "newest child: $ID, minted by run $(cat "$f")"
ls -ld "$HOME/.cc-tmp/$ID"
```

Expected: the newest child is the workspace wave 2's dispatch just minted, the run id printed is wave 2's run id (as `GET /api/runs` reports it), and the directory reads `drwx------`. The run's events must carry no `child-omitted:no-child-argv-cap`. That is spec §8's wave-1 row, measured: "a dispatched child carries the marker and its temp root".

Rolling back, if ever needed: `ccrc update --to <the previous tag> --downgrade` on each box — either order is safe here, for the reason in the first paragraph of this step.

---

## Deviations found

Numbers are ISSUED, never chosen. This programme's deviation block is allocated ONCE, by the programme coordinator, at run-open, and every wave draws from it; **a worker never calls the allocator** (worker clause 11). A departure from this plan found while executing it is named in the wave-done mail — what departed, where, and why — and the coordinator assigns its number from the block and defines it here in the same act. A session that cannot reach the coordinator writes `D-TBD-<slug>` in its report and nowhere in a committed file (`dtbd.test.ts` reds the concrete form).

Two deliberate absences: no block is written as a range, and no headroom accounting lives in this plan. Both have been falsified by the next commit in every wave that tried them.

The pre-flight findings above are not deviations: they were measured before this plan existed and shaped it. They are recorded there, with their tools, so a reviewer comparing the diff against the contract can see why each departure from the obvious shape was taken.

- **D-3330** — Task 1's probe directory moved from `$SCRATCH/tmpdir-probe` to `mktemp -d /tmp/ccrc-tmpdir-probe.XXXXXX`, because a probe directory under a path containing `/scratchpad/` confounds the answer the probe is measuring. The prompt and the env strip stayed otherwise verbatim.
- **D-3331** — Task 1's plan text names `REGISTRY WRITTEN` a stop, not to be re-run until the strip list is fixed. The worker re-ran once with the strip list unchanged, because run 1's registry write came from a concurrent subagent in this session, not from the probe; the re-run proved it — the registry was untouched.
- **D-3332** — `ccd-child-tmpdir.test.ts`'s foreign-owner case (plan-verbatim otherwise) now restores the foreign directory's mode in `finally` if it changed, because a runner holding `CAP_FOWNER` could otherwise leave `/usr` re-moded to 0700 behind it.
- **D-3333** — `ccd-ws-add-child.test.ts`'s `not.toBe(124)` message was reworded to name only what rc 124 detects; the assertion itself is unchanged.
- **D-3334** — task6-stops-at-step-6: the wave brief (mail 2196) moved Step 7 (rollout) to the coordinator, so this worker's wave-done stops at Step 6 with no merge. This agrees with the plan's own text, "by whoever merges".
- **D-3335** — the out-of-scope README repair (wave-done report §8): the citation re-pointer locates its two anchors by the bytes their sentences quote, so it also moved `cmd_ensure`'s `_reg_generation_init "$id"` anchor, which `main` had left green-but-stale (pointing 19 lines above the call it quotes, kept green through the function body by session-hook's sub-rule A). No wave-1 requirement asked for this repair; it is kept because it is correct and recorded because no task asked for it.
- **D-3336** — `_child_tmpdir` judged the `.child` marker by non-emptiness alone, while wave 3's rung 2 and wave 2's `ChildMark` reader — both planned, neither shipped yet — will treat a marker that fails `_child_runid_valid` as unreadable / not-a-child, so a hand-corrupted marker got a temp root nothing downstream would ever reclaim. Coordinator ruling 2026-09-23: replace `[[ -n "$(_reg_get "$id" child)" ]] || return 1` with `_child_runid_valid "$(_reg_get "$id" child)" || return 1`, so every reader of the marker speaks the one grammar R2 gave it. Fix-round-2 ruling 2026-09-23: Task 2 Step 8's mutation row 4 went stale with this ruling (its old edit target no longer exists), so it was re-spelled against the shipped line as the OR-inference form `{ _child_runid_valid "$(_reg_get "$id" child)" || [[ "$(_reg_get "$id" rc)" == off ]]; } || return 1`; measured on this tree, it reds exactly the `rc=off`-without-marker case, 17/18 otherwise green. Wave 2 (review run 136): the five invalid-marker cases this ruling required ship as one `it.each` title, `'rc 1 for a marker that is not a run id (%j) — creates nothing, and _spawn_start exports no TMPDIR'`, parameterized over `'0'`, `'abc'`, `'٣'`, `'07'`, and `'1²'` — the bare-zero, non-numeric, non-ASCII-digit, leading-zero and superscript-digit shapes `_child_runid_valid` refuses — bringing `ccd-child-tmpdir.test.ts` from 13/13 to 18/18.
- **D-3337** — orphaned child temp roots: a workspace disposed of by a human verb (`ws-rm`, `ws-reap`, `ws-gc --prune`, `forget`) loses its `.child` marker but keeps `$HOME/.cc-tmp/<id>`, which no later wave can find again — a permanent leak until reclaimed. Coordinator ruling 2026-09-23: the owner is wave 4's sweep, which will collect any `$HOME/.cc-tmp/<leaf>` with no registry row, observed twice, honouring `reclaim-paused`, and unlinking a link or file leaf with `rm -f --`, never following it; the coordinator amends wave 4's plan before that wave is dispatched. No code lands in this wave, and the interim leak between now and wave 4's deploy is accepted.
- **D-3338** — `wave-lifecycle.md` §2's `child-omitted:no-child-argv-cap` paragraph named one cause only (a box whose `ccd` predates `child-argv-v1`), while the same event also fires when the server held no capability list for the box at all — the local-mode boot window, an unmeasured failed local caps probe, or a remote ready frame with no usable list — a different condition with a different remedy (reconnect the agent or restart the server, not a ccd deploy). Coordinator ruling 2026-09-23 (review run 135, F2): two sentences added directly after the paragraph's statement of its cause, naming the unmeasured cause and how `ccd caps` tells the two apart; this departs from Task 5's prescribed §2 text. Wave 2 (review run 136) rewrote those two sentences again to give each cause its own remedy, matching the shipped §2 `child-omitted` paragraph: the local-mode boot window clears on its own within seconds, once the box's one bounded boot-time probe resolves; a remote ready frame with no usable list clears the same way with no action from you, inside about a minute, on the watcher's own 60 s caps lane — that lane is remote-only, so it never resolves a local box's window; a failed local caps probe needs a server restart to re-probe; an agent whose caps stay list-less past the 60 s lane needs its ccd or the agent process itself looked at; and (shipped in 4b6bdaa7, right after this review-136 leftovers fix; review run 144's F10 found only that it carried no departure slug) a `ccd caps` that fails outright is NOT evidence of an old ccd — the same top-level check that kills every other invocation on a broken box kills it too, before it ever reaches its capability list, so the remedy is to look at the ccd and, on a local box, restart the server afterward to re-probe; only a list that omits `child-argv-v1` outright names the old-ccd cause — the paragraph still ends in agreement with "not an error".
- **D-3339** — `ccd-ws-add-child.test.ts`'s run-id-census case title read "every run-id parse calls _child_runid_valid", but the case is a LITERAL-ABSENCE pin: it reds on a verbatim second copy of the spelling and passes a differently spelled grammar undetected. Coordinator ruling 2026-09-23 (review run 135, F3): the title narrowed to claim only what it detects ("spells the literal run-id pattern once in ccd/ccd — in _child_runid_valid"), with a comment naming what passes it; the plan's lens-1 sentence "the census case reds on a second copy" holds only for a verbatim copy. Assertions unchanged. Wave 2 (review run 136): the plan's own four over-claiming statements of this same census — at :49, :843, :984 (the shown test title) and :1344 (mutation row 9's quoted title) — were narrowed the same way, to name the literal-absence pin the case actually is.

---

## Review lenses

Three lenses for this wave, all `opus`, effort `high` — a sixteen-file diff (the File Structure table: five shipped files — `ccd/ccd`, `server/src/ccdargv.ts`, `server/src/coord/dispatch.ts`, `README.md`, `wave-lifecycle.md` — and eleven test files), sized per the fleet policy, whose example is 3–5 reviewers for a 4-file PR: three concerns cover this diff because most of it is tests that each lens reads against its own concern, so the panel sits at the low end of that band rather than scaling per file (one lens per concern, one `sonnet` refute pass per finding). Wave 1 destroys nothing, so the mandatory `xhigh` safety lens is wave 3's, not this one's; the lenses below are still asked to read the destructive future this wave's names feed.

1. **ccd parse and spawn (opus, high).** The strip loop stays positionless and binds `project` only after every flag is stripped (the D-410 shape, both token orders); the refusal fires above the disk floor, the lock and every mint; the marker is written before `_spawn_start "$id" new`; `TMPDIR` is spliced once and reaches BOTH spawn lines; rc 2 spawns uncontained and never refuses (contract §7 R1's ruled form, held by Task 2's row 7); the leaf may not be a symlink and the root may; a leaf another user owns is refused by the `chmod` arm (R1's ownership clause); nothing infers child-ness from anything but `$REG/<id>.child`; the composed command stays quote-safe (ids admit no `'`); `_child_runid_valid`'s `LC_ALL=C` shadow is really in the function that decides, and it is the ONE spelling of the run-id grammar in ccd (R2) — its header tells wave 3 to call it, and the census case reds on a second copy.
2. **Wire, capability and deploy (opus, high).** `child-argv-v1` is read with `capSupported` everywhere and `verbSupported` nowhere; the three spellings are held equal by a test that reads the real ccd; a box without the token receives the pre-wave argv byte for byte (`dispatch-child-argv`'s "without the token" row); review runs are children; the resume arm is untouched; the omission row is journalled exactly once per fresh dispatch and never on resume, and `wave-lifecycle.md` §2 tells a coordinator what it means; the PWA's `wsAdd` gained nothing; Task 6's deploy order is the rollout default and never `--server-first`.
3. **Guard fidelity and the citation tax (opus, high).** Every mutation row really mutates the guard it names and reds for the stated reason, not an adjacent one; the two new `ccd-*` files pass `ccd-workspaces`' containment scan; every census literal in `session-hook.test.ts` came from `cite-remeasure.py`'s instrument output, on this tree, and its composition comment matches that output; README's anchors point at the bytes their sentences quote; the length discipline above `:19131` held (eight code lines, two in-place prose edits), and the R1/R2 header rewrites below it stayed line-neutral so Tasks 2–3's forecasts still hold; the tax was paid for every CITED file this diff touches — `ccd/ccd`, and `session-hook.test.ts` whose own edits sit below its highest cited line (R9); `ccd-reg-get-census`'s sentence was re-measured in the task that added the `_reg_get` call and names no new cardinal near the census (R10).
