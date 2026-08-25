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

- [ ] **Step 1: read the model in full.** `cmd_ws_hold`'s loop and its givenness handling
  (`ccd:3711-3745` — `lc_gs`/`lc_ga`, the blank-`--actor` refusal, why `_lc_surface_norm ''`
  prints empty and what `${lc_w:-unknown}` is for), then `cmd_ws_add:2534-2560` and its
  `_lc_done create` at `:2705`, then `cmd_ws_hold`'s emit at `:3809` for the pair shape.

- [ ] **Step 2: red-first — the parse.** In the chosen suite, against the REAL ccd in a
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

- [ ] **Step 3: red-first — the journal row.** After a flagged `ws-add`, the `create` row in
  `$REG/.lifecycle/` carries the declared surface and actor; after an UNflagged `ws-add` it
  carries neither (absence permits — the row must not gain a blank `dec.actor`). Expect RED.

- [ ] **Step 4: implement.** In `cmd_ws_add`, replace the single `--no-rc` line with the
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

- [ ] **Step 5: green — and the regression gate.** Run the new suite, then
  `server/test/ccd-rc-flag.test.ts` and `server/test/ccd-spawn-split.test.ts` **unedited**
  (this is the load-bearing check: `--no-rc` moved into a loop and its behaviour must not
  have), then `test/ccd-workspaces.test.ts`, `test/single-definition.test.ts`,
  `test/topology-clean.test.ts`, `test/ccd-lifecycle-sites.test.ts`.

- [ ] **Step 6: mutation ceremonies, each planted alone, measured, reverted:**
  1. Delete the `--actor` arm from the loop → the parse test reds.
  2. Drop the `[[ $# -ge 2 ]]` arity check on `--surface` → the no-value test reds (or hangs
     — if it hangs, say so and treat the hang as the red, with a timeout).
  3. Emit `dec.actor` unconditionally (blank when undeclared) → the absence test reds.
  4. Move the loop AFTER the positional binding → the composed-order test reds.

- [ ] **Step 7: commit** with measured counts.

### Task 2: the dispatch path declares itself again

**Files:**
- Modify: `server/src/ccdargv.ts` (`wsAddWorker`), `server/src/coord/dispatch.ts`
- Test: `server/test/ccdargv-dec-parity.test.ts` (ws-add moves from negative control to a
  real probe), plus the argv pins in `server/test/run-routes.test.ts` and
  `server/test/whitelist-subset.test.ts`

- [ ] **Step 1: read what was reverted.** `git show 83fbdd0a` — the revert commit carries the
  exact shape and the reasoning; re-land it against a ccd that now parses. Read
  `ccdargv-dec-parity.test.ts` in full: it DERIVES the dec-appending verbs from the builder
  table and requires a probe per verb, so adding the dec to `wsAddWorker` moves `ws-add` into
  the derived set automatically and the suite will demand its probe.

- [ ] **Step 2: red-first.** The parity suite's `ws-add` negative control ("is NOT in the
  derived set", "real ccd binds the dec's first token as the SLUG") becomes a positive probe
  in the same shape as the other five: real ccd in a fixture HOME refuses IDENTICALLY with
  and without the dec — the flags are parsed, not bound. Expect RED until Step 3 lands (and
  confirm the derived-set test reds too — that is the mechanism proving itself).

- [ ] **Step 3: implement.** `wsAddWorker: (p: string, dec: ActorFlags | null) => argv(['ws-add', '--no-rc', p, ...decFlags(dec)])`
  with a docstring naming D-410 and stating that ccd's parse landed in the same programme.
  At the call site pass the dec the `ws-hold` call already measures — reuse that value, do
  not take a second measurement.

- [ ] **Step 4: green.** The parity suite, `run-routes`, `whitelist-subset`, `verb-gate`,
  `unattended-actor`, `typecheck-tests`, plus the full server package.

- [ ] **Step 5: mutation.** Drop the `...decFlags(dec)` spread → the caps-supporting argv pin
  reds AND the derived-set membership test reds (two mechanisms, state both counts).

- [ ] **Step 6: commit.**

## Deviations found

(minted through `POST /api/ledger/deviations` at close — executors nominate prose-only)
