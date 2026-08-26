# `ws-add` learns the actor flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The lifecycle journal stops recording every dispatched spawn as *declared:
nothing* — `ccd ws-add` parses `--surface`/`--actor` the way the five workspace verbs
already do, threads them into its own `create` row, and the dispatch path declares itself
again.

**Architecture:** `cmd_ws_add` gains the strip-then-bind flag loop `cmd_ws_hold` already
carries (D-410's finding was that it had none — the dec's first token bound as the SLUG and
the verb died before the worktree existed). The server half is then the three lines that
were reverted. The gate that makes this safe already exists: `ccdargv-dec-parity.test.ts`
derives the dec-appending verbs FROM the builder table and demands a real-ccd probe for
each, so `ws-add` joining that set cannot go unmeasured.

**Tech Stack:** bash (`ccd/ccd`), TypeScript ESM (server), vitest.

**Spec:** No standalone spec — D-410 in `docs/superpowers/plans/2026-08-25-spawn-visibility.md`
is the decision record, and this plan is its named remedy.

## Design (the decision record)

- **What D-410 measured.** `cmd_ws_add` consumed an exact-string `--no-rc` at position 1 and
  then bound `project="$1"`, `slug="${2:-}"` with no loop between there and
  `_ws_slug_valid`'s `^[a-z0-9][a-z0-9-]{1,30}$`. So `ws-add --no-rc <project> --surface
  agent --actor '…'` died at `invalid slug '--surface'` — early, before the worktree, the
  registry row and the pane. `actor-flags-v1` never meant "this box takes the flags on every
  verb": it governs whether the FIVE WORKSPACE VERBS get them, and `ws-add` mints a
  workspace rather than acting on one.
- **The model is `cmd_ws_hold`'s loop, not a new invention** (`ccd:3711-3725`): strip flags
  into `lc_args`, `set -- "${lc_args[@]}"`, then bind positionals. It accepts a flag
  anywhere, which is what the composed argv needs (`['ws-add','--no-rc',p,…decFlags]` puts
  them last), and it is the shape three sibling verbs already use. Copy its arity check
  verbatim in spirit: an explicit `[[ $# -ge 2 ]]` before every `shift 2`, because ccd runs
  under `set -uo pipefail` with no `-e`, so a shift past the end shifts nothing and the loop
  never terminates.
- **A slug can never be ambiguous with a flag.** `_ws_slug_valid` requires a leading
  `[a-z0-9]`, so no legitimate slug begins with `-` and the loop cannot swallow one.
- **`--reason` is NOT accepted here.** `ws-add` has no reason of its own to collide with, and
  the dispatch path's reason rides `--actor` (`run:<id> dispatch`). Two flags, not three —
  the same call `cmd_ws_hold` documents at `ccd:3699-3705`, for the same reason: never put a
  second string on a verb with nothing to say which one a reader is looking at.
- **The journal is the point.** Parsing without threading would be ceremony: the parsed dec
  must reach `_lc_done create` (`ccd:2705`) as `dec.surface`/`dec.actor` pairs — the shape
  `cmd_ws_hold` uses at `ccd:3809` — or the `create` row still reads *declared: nothing*.
- **Deploy is AGENT-FIRST and the ordering is load-bearing.** A server that composes the
  flags against a fleet ccd that cannot parse them breaks every dispatch (that is D-410
  exactly). ccd ships to the fleet host FIRST; a new ccd with an old server simply never
  receives the flags, which is today's behaviour.

## Global Constraints

- Every existing `ws-add` call form keeps working BYTE-IDENTICALLY: `ws-add <project>`,
  `ws-add <project> <slug>`, `ws-add --no-rc <project>`, `ws-add --no-rc <project> <slug>`.
  `server/test/ccd-rc-flag.test.ts` and `server/test/ccd-spawn-split.test.ts` are the
  regression gate and must stay green WITHOUT being edited — if a pin needs editing to pass,
  STOP and report: that means behaviour moved.
- `ccd/ccd` edits re-stamp provenance (`shared/mark.mjs`'s `markGenerated` takes the BODY
  TEXT and returns the marked text — never a path; read the module before calling it).
- No new ccd VERB, no new grant, no agent change, no wire change, `FLEET_PROTO` untouched.
- Suites: `./node_modules/.bin/vitest run <file>` from inside the package, FOREGROUND, never
  bare `npx vitest`; canonical `/mnt` cwd. FIXTURE HOMEs only — never the live `$HOME`, the
  live registry, or a destructive verb outside a fixture.
- Every guard ships with a mutation-measured red, count in the commit body.
- Deviations nominated prose-only; the orchestrator mints numbers through the allocator.

## Wave order

Task 1 (ccd) then Task 2 (server). Task 2's parity probe cannot pass until Task 1's parse
exists, which is the ordering made mechanical. The orchestrator deploys AGENT-FIRST after
both land.

**READ THAT AS ONE RELEASE, NOT TWO: Task 1's tip is RED and must not merge or deploy
alone.** `server/test/ccdargv-dec-parity.test.ts` carries a `ws-add` NEGATIVE CONTROL that
asserts the OLD refusal, so Task 1 SUCCEEDING is what fails it. Full server package,
foreground, at Task 1's tip: `Test Files 1 failed | 223 passed (224); Tests 1 failed |
5597 passed | 3 skipped (5601)`, the one failure being `expected '' to match /invalid slug
'--surface'/`. Task 2 Step 2 converts that control into a positive probe — until it lands
beside Task 1, the merge and the AGENT-FIRST deploy stay gated. Nominated as a deviation
below, with the artefacts the fixture now writes.

**GATE SATISFIED (Task 2 landed).** The tip now runs the full server package green —
**224 files / 5599 passed + 3 skipped (5602)**, zero failures — so the merge this paragraph
gated is unblocked. The DEPLOY half is not, and does not become so by anything in the tree:
`actor-flags-v1` was deliberately not re-minted, so it now advertises two facts that ship
separately and only ORDER keeps a box safe. Deploy `ccd` to the fleet host first.

---

### Task 1: `cmd_ws_add` parses the flags, and the `create` row carries them

**Files:**
- Modify: `ccd/ccd` — `cmd_ws_add`'s head (~`:2534`) and its `_lc_done create` call (~`:2705`)
- Test: `server/test/ccd-lifecycle-sites.test.ts` (or whichever suite already exercises
  `ws-add`'s journal row end-to-end in a fixture HOME — grep for `_lc_done create` /
  `create` rows and read both candidates before choosing)

**Interfaces:**
- Produces: `ccd ws-add [--no-rc] [--surface <word>] [--actor <text>] <project> [slug]`, flags
  in any position; the `create` journal row carrying `dec.surface`/`dec.actor` when declared.
- Consumes: `_lc_surface_norm` (`ccd:1511`), `_lc_dec_ok` (`ccd:1527`), `_lc_done` (`ccd:1479`).

- [x] **Step 1: read the model in full.** `cmd_ws_hold`'s loop and its givenness handling
  (`ccd:3711-3745` — `lc_gs`/`lc_ga`, the blank-`--actor` refusal, why `_lc_surface_norm ''`
  prints empty and what `${lc_w:-unknown}` is for), then `cmd_ws_add:2534-2560` and its
  `_lc_done create` at `:2705`, then `cmd_ws_hold`'s emit at `:3809` for the pair shape.

- [x] **Step 2: red-first — the parse.** In the chosen suite, against the REAL ccd in a
  fixture HOME:
  - `ws-add --surface agent --actor 'run:7 dispatch' <project>` creates the workspace
    (assert the registry row exists) — today it dies `invalid slug '--surface'`.
  - The flags are accepted in the composed order the server actually sends:
    `ws-add --no-rc <project> --surface agent --actor 'run:7 dispatch'`.
  - `--surface=agent` / `--actor=x` equals-forms work (the sibling verbs accept both).
  - A blank `--actor` is REFUSED (`--actor must be non-blank`), matching `cmd_ws_hold`.
  - `--surface` or `--actor` as the LAST token (no value) refuses with a usage line rather
    than looping forever — the arity check, stated as a test.
  Run it; expect RED.

- [x] **Step 3: red-first — the journal row.** After a flagged `ws-add`, the `create` row in
  `$REG/.lifecycle/` carries the declared surface and actor; after an UNflagged `ws-add` it
  carries neither (absence permits — the row must not gain a blank `dec.actor`). Expect RED.

- [x] **Step 4: implement.** In `cmd_ws_add`, replace the single `--no-rc` line with the
  strip-then-bind loop, folding `--no-rc` into it so every flag is positionless:

```bash
  # PER-WORKER RC and the DECLARED ACTOR, stripped before any positional binds
  # — `cmd_ws_hold`'s shape (ccd:3711) and its reason: a run like
  # `ws-add --no-rc <project> --surface agent --actor '…'` must not bind
  # `project` from a flag-polluted argv. D-410: this verb had NO loop, so the
  # dec's first token bound as the SLUG and it died before the worktree
  # existed — every dispatched spawn would have refused.
  # TWO dec flags, not three: `--reason` is deliberately absent (this verb has
  # no reason of its own, and the dispatch path's rides `--actor`).
  local norc=0 lc_surface=none lc_actor='' lc_gs=0 lc_ga=0 lc_args=()
  while (( $# )); do
    case "$1" in
      --no-rc)     norc=1; shift ;;
      # Explicit arity, never a bare `shift 2`: under `set -uo pipefail` with
      # no `-e` a shift past the end shifts NOTHING and this loop never ends.
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd ws-add [--no-rc] [--surface <word>] [--actor <text>] <project> [slug]"
                   lc_gs=1; lc_surface="$2"; shift 2 ;;
      --surface=*) lc_gs=1; lc_surface="${1#--surface=}"; shift ;;
      --actor)     [[ $# -ge 2 ]] || die "usage: ccd ws-add [--no-rc] [--surface <word>] [--actor <text>] <project> [slug]"
                   lc_ga=1; lc_actor="$2"; shift 2 ;;
      --actor=*)   lc_ga=1; lc_actor="${1#--actor=}"; shift ;;
      *)           lc_args+=("$1"); shift ;;
    esac
  done
  set -- "${lc_args[@]}"
  if (( lc_gs )); then local lc_w; lc_w=$(_lc_surface_norm "$lc_surface"); lc_surface=${lc_w:-unknown}; fi
  if (( lc_ga )); then
    [[ -n "${lc_actor//[[:space:]]/}" ]] || die "--actor must be non-blank"
    _lc_dec_ok "$lc_actor" || die "--actor is longer than $_LC_DEC_MAX bytes"
  fi
```

  then the existing `local project="${1:?…}" slug="${2:-}"` binding follows unchanged (update
  its usage string to the new form). At `_lc_done create`, append the pair ONLY when
  declared — build the arguments so an undeclared call emits exactly today's row:

```bash
  local lc_dec=()
  (( lc_gs )) && lc_dec+=(dec.surface "$lc_surface")
  (( lc_ga )) && lc_dec+=(dec.actor "$lc_actor")
  _lc_done create "$id" "" "${lc_dec[@]}" meas.project "$project" meas.workspace "$slug" \
    meas.branch "$branch" meas.base "$base" meas.workdir "$wt" meas.wrapper "$hw"
```

  (bash ≥ 4.4 — an empty array under `set -u` is not an unbound-variable error; the fleet
  host runs 5.2 and `cmd_ws_hold` relies on the same fact. Verify the expansion is safe in
  the fixture before trusting it.)
  Then re-stamp provenance.

- [x] **Step 5: green — and the regression gate.** Run the new suite, then
  `server/test/ccd-rc-flag.test.ts` and `server/test/ccd-spawn-split.test.ts` **unedited**
  (this is the load-bearing check: `--no-rc` moved into a loop and its behaviour must not
  have), then `test/ccd-workspaces.test.ts`, `test/single-definition.test.ts`,
  `test/topology-clean.test.ts`, `test/ccd-lifecycle-sites.test.ts`.

- [x] **Step 6: mutation ceremonies, each planted alone, measured, reverted:**
  1. Delete the `--actor` arm from the loop → the parse test reds.
  2. Drop the `[[ $# -ge 2 ]]` arity check on `--surface` → the no-value test reds (or hangs
     — if it hangs, say so and treat the hang as the red, with a timeout).
  3. Emit `dec.actor` unconditionally (blank when undeclared) → the absence test reds.
  4. Move the loop AFTER the positional binding → the composed-order test reds.

  MEASURED — each planted ALONE against the real ccd in a fixture HOME and reverted between
  plants; baselines `ccd-lifecycle-sites` 29/29, `ccd-spawn-split` 50/50, `ccd-rc-flag`
  19/19:
  1. Both `--actor` arms deleted → `ccd-lifecycle-sites` **6 failed / 23 passed**.
  2. `[[ $# -ge 2 ]]` dropped from the `--surface` arm → **1 failed / 28 passed**, and the
     failure is an ABORT rather than the hang this step allowed for:
     `ccd: line 2580: $2: unbound variable`, rc 1 (deviation below).
  3. **NO RED** — the prediction that failed. 29/29, and 209/209 across all eight
     journal-reading suites, even under the stronger form that makes BOTH pairs
     unconditional. Not unguarded but JOINTLY guarded: drop the `(( lc_gs ))` normalisation
     guard as well and the undeclared row reads `surface: 'unknown'` — 1 failed / 28 passed
     (deviation below).
  4. The positional binding moved back above the loop → `ccd-lifecycle-sites` **6 failed /
     23 passed** AND `ccd-spawn-split` **2 failed / 48 passed**, while `ccd-rc-flag` stays
     19/19 — so the spawn-split pin is the one that catches D-410 one flag to the left.

- [x] **Step 7: commit** with measured counts.

### Task 2: the dispatch path declares itself again

**Files:**
- Modify: `server/src/ccdargv.ts` (`wsAddWorker`), `server/src/coord/dispatch.ts`
- Test: `server/test/ccdargv-dec-parity.test.ts` (ws-add moves from negative control to a
  real probe), plus the argv pins in `server/test/run-routes.test.ts` and
  `server/test/whitelist-subset.test.ts`

- [x] **Step 1: read what was reverted.** `git show 83fbdd0a` — the revert commit carries the
  exact shape and the reasoning; re-land it against a ccd that now parses. Read
  `ccdargv-dec-parity.test.ts` in full: it DERIVES the dec-appending verbs from the builder
  table and requires a probe per verb, so adding the dec to `wsAddWorker` moves `ws-add` into
  the derived set automatically and the suite will demand its probe.

- [x] **Step 2: red-first.** MEASURED across all three test files at once —
  **4 failed / 152 passed (156)**: the derived-set equality (`ws-add` missing from the set),
  the converted positive control (`expected { surface: 'none' } to deeply equal
  { surface: 'agent', actor: 'probe:dec parity' }` — the real binary's own `create` row),
  `run-routes`'s caps-box argv, and `whitelist-subset`'s exact argv. The `ws-add` LOOP probe
  does not exist yet at this point and cannot: it is generated FROM the derived set, which is
  the mechanism proving itself. The parity suite's `ws-add` negative control ("is NOT in the
  derived set", "real ccd binds the dec's first token as the SLUG") becomes a positive probe
  in the same shape as the other five: real ccd in a fixture HOME refuses IDENTICALLY with
  and without the dec — the flags are parsed, not bound. Expect RED until Step 3 lands (and
  confirm the derived-set test reds too — that is the mechanism proving itself).

- [x] **Step 3: implement.** `wsAddWorker: (p: string, dec: ActorFlags | null) => argv(['ws-add', '--no-rc', p, ...decFlags(dec)])`
  with a docstring naming D-410 and stating that ccd's parse landed in the same programme.
  At the call site pass the dec the `ws-hold` call already measures — reuse that value, do
  not take a second measurement.

- [x] **Step 4: green.** The parity suite, `run-routes`, `whitelist-subset`, `verb-gate`,
  `unattended-actor`, `typecheck-tests`, plus the full server package.

- [x] **Step 5: mutation.** Drop the `...decFlags(dec)` spread → the caps-supporting argv pin
  reds AND the derived-set membership test reds (two mechanisms, state both counts).

  MEASURED — five ceremonies, each planted ALONE against the real ccd in a fixture HOME and
  reverted between plants; baseline for the four argv suites (`ccdargv-dec-parity`,
  `run-routes`, `whitelist-subset`, `unattended-actor`) 173/173:
  1. `...decFlags(dec)` dropped from the BUILDER → **5 failed / 167 passed (172)**, FOUR
     files. Both mechanisms this step named — the derived-set equality and `run-routes`'s
     caps-box argv pin — plus the parity file's positive control, `whitelist-subset`'s
     exact argv, and `unattended-actor`'s same-actor assertion (`the dispatched ws-add
     declares nothing …: expected -1 to be greater than -1`). The total is 172, not 173:
     `ws-add` leaves the DERIVED SET, so its own probe stops being generated. That is the
     anti-whitelist clause working in the other direction, and it is why the equality is
     asserted separately from the probe.

     CORRECTED AT REVIEW, and the correction is the point. This ceremony was first
     recorded as **4 failed / 168 passed (172), three files** — measured before ceremony
     2's remediation existed. That remediation (`unattended-actor`'s `ws-add`-beside-
     `ws-hold` same-actor assertion) guards the BUILDER as well as the call site, so it
     reds under this plant too, and ceremony 1 was never re-run after it landed. Direction
     is favourable — one more guard than claimed, not fewer — but a number presented as a
     measurement must be one. Re-measured on the shipped tree, plant alone, reverted:
     baseline 173/173, planted 5 failed / 167 passed (172), four files.
  2. `null` at the CALL SITE, builder intact → **1 failed / 172 passed** as first written:
     one mechanism, not two (deviation below). A second was added — `unattended-actor`'s
     runtime test now reads the `ws-add` argv beside the `ws-hold` one and demands the same
     actor — and the same plant re-measured gives **2 failed / 171 passed**, two files.
  3. The PRE-D-410 ccd restored under the shipped server (`git show 3500bb22:ccd/ccd`, the
     tree the defect was found in) → parity **2 failed / 8 passed (10)**: the `ws-add` probe
     (`expected 1 to be 3` — the declared arm dies rc 1 where the control reaches rc 3) and
     the positive control. The five workspace verbs stay green, as they must.
  4. The hoist removed — two `sweepDec` calls, the literal typed twice →
     **1 failed / 109 passed**: `unattended-actor`'s SITES anchor, which reports the anchor
     as moved rather than the label as wrong. The pin this task rewrote still bites.
  5. The DRIFT the hoist exists to prevent — a second, DIFFERENT literal at the `ws-add`
     (`` `run:${run.id} spawn` ``) → **2 failed / 171 passed**: `run-routes`'s exact argv and
     `unattended-actor`'s same-actor assertion (`expected 'run:3 spawn' to be
     'run:3 dispatch'`).

- [x] **Step 6: commit.** Full server package, foreground: **224 files / 5599 passed + 3
  skipped (5602)**, zero failures — the RED that Task 1's tip carried is closed.

## Deviations found

(minted through `POST /api/ledger/deviations` at close — this batch took 463–464, floor 465)

- **D-463** (Task 1) — the emit-site givenness conditional CANNOT be pinned by any fixture, and
  the plan's ceremony 3 predicted it could. `_lc_json` drops every pair whose value is `""`
  (`ccd:1337-1338`) and backfills `dec.setdefault("surface","none")` (`ccd:1347`), while
  `lc_surface` cannot hold anything but `none` while `lc_gs` is 0 — so the conditional array and
  an unconditional `local lc_dec=(dec.surface "$lc_surface" dec.actor "$lc_actor")` are
  byte-identical BY CONSTRUCTION. Measured: `ccd-lifecycle-sites` stayed 29/29 and seven other
  journal-reading suites 180/180 under the stronger mutation. The behaviour is not unguarded, it
  is JOINTLY guarded — drop this conditional AND the `(( lc_gs ))` normalisation guard and the
  undeclared row reads `surface: 'unknown'` (1 failed / 28 passed). Kept for saying what it
  means; recorded because the first commit body advertised as a mechanism something that is an
  expression of intent standing beside one. Also under this number: ceremony 2's predicted hang
  is not a hang — under `set -u`, `lc_surface="$2"` aborts on `$2: unbound variable` (rc 1)
  before the `shift 2` is reached, so the arity check buys the honest usage line, and the
  never-terminating loop only the day an arm is reordered to shift before it reads.
- **D-464** (Tasks 1–2, the bisect window) — Task 1 alone ships `ccdargv-dec-parity.test.ts` RED
  (1 failed / 5597 passed at `49116387`): that suite's `ws-add` NEGATIVE CONTROL asserts real ccd
  binds the dec's first token as a slug and dies, which stops being true the moment Task 1's parse
  lands, and Task 2 Step 2 is what converts the control into a positive probe. The window is
  49116387..07b824bd and is closed on the branch tip (224 files / 5599 passed). Accepted rather
  than history-rewritten — the same disposition as D-212 — but the AGENT-FIRST deploy is gated on
  Task 2 being present, which it is. Also under this number: the Task 2 probe as landed differs
  from the one the plan drew, noted prose-only in its commit body.
