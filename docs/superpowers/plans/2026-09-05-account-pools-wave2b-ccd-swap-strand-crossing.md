# Account pools — wave 2b: the tick moves, the empty pool strands loudly, the crossing sticks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ccd`'s automatic account machinery pool-aware — the 5-second auto-swap tick re-seeds a wrong-pool home and moves the session, an empty pool strands loudly instead of crossing, and a deliberate `--cross-pool` crossing leaves a marker that the tick honours until a retag or a move ends it.

**Architecture:** Everything in this wave is `ccd/ccd` bash plus two new vitest suites under `server/test/`. It consumes wave 2a's reader (`_project_pool_state`), predicate (`_pool_ok`), placement (`_ws_least_loaded [project]`) and lifecycle act (`rehome`), and adds: three strand helpers beside `_swap_refuse`; two crossing-marker helpers; three insertions into `_swap_target`; five into `_auto_swap_check`; and the `--cross-pool` flag on the four manual verbs. No server, agent, shared or PWA file is touched. **Every change is under `ccd/`, so this wave is AGENT-FIRST at deploy time** — `bash deploy/deploy.sh agent` ships the fleet host before `bash deploy/deploy.sh` ships the server (Task 8 states the order; the deploy itself is run by the operator or the coordinator, never by this plan's implementer).

**Tech Stack:** bash 5.2 (`set -uo pipefail`, no `-e`), vitest + `makeCcdHarness` fixture HOMEs, `node:sqlite`-free.

**Spec:** docs/superpowers/specs/2026-09-04-account-pools-design.md

**Base:** origin/main 2b15144e; branch ws/amber-summit. **This wave's branch is cut from wave 2a's merged tip** — every test below calls `_project_pool_state`, `_pool_ok`, `_acct_pool`, `POOLS_DIR` and `_ws_least_loaded <project>`, and none of them exists before 2a merges.

## Global Constraints

- **Fixture HOMEs only.** Every ccd test goes through `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`); `HOME` is ccd's single isolation boundary. Never run a `ccd` verb against the live `$HOME`; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or a `claude-session@*` unit.
- **No account name, pool name, label, host or IP in any shipped source file or test.** Pool fixture names are `pool-a` and `pool-b`; project fixture names are `demo` and `quiet-basin`; account ids are `DEFAULT_TEST_ROSTER`'s (`server/test/helpers.ts:60`): `claude`, `claude-a`, `claude-b`, `gpt`, `claude-d`. `single-definition.test.ts` and `topology-clean.test.ts` scan the whole tree, docs included.
- **`FLEET_PROTO` stays 1; the wire is additive-only.** This wave adds no wire field at all — the three new registry fields reach the server in wave 3.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to one value. `_pool_ok` answers 0/1/2; `_project_pool_state` answers four words; `_swap_target`'s pre-existing stdout overload is resolved at the caller on `$hard_blocked` and is deliberately **not** widened here.
- **Agent-first for `ccd/`:** `bash deploy/deploy.sh agent` (fleet host) precedes `bash deploy/deploy.sh` (server). Coordinates come from `~/.ccrc/deploy.env`; no host argument is needed on this fleet.
- **`EXEC_COMMANDS = ['tmux','ccd']` stays closed; no `gh` grant is added.** This wave adds no whitelist entry at all.
- **L0 `shared/*.ts` imports nothing** — untouched by this wave.
- **Mutation-table discipline:** every guard ships WITH a test that goes RED when the guard is deleted or mutated. Each task's `**Mutation table:**` block names the exact mutation and the expected red, measured before and after.
- **Deviation numbers come only from the ledger allocator.** This plan's plan-time numbers, D-1671–D-1678, were minted in ONE allocator call and defined in `## Deviations found` at plan commit; the `LEDGER:` lines in Tasks 1–6 REFERENCE them. A deviation found during execution is allocated in its own call at the moment it is found, never taken from a gap in that block.
- **Run suites in the FOREGROUND with a timeout of at least 600000 ms**, from inside the package: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`.

## Wave map

The spec's five waves (§15 "Plan shape"), with wave 2 split in two at plan time — six PRs, each merged before the next is cut, all under `docs/superpowers/plans/`.

| Wave | Plan file | Scope |
|---|---|---|
| 1 | `2026-09-05-account-pools-wave1-roster.md` | `shared/roster.ts` `POOL_NAME_RE` + `AccountDef.pool`, `shared/roster-json.mjs` mirror (+ the missing `hidden` check), `shared/generate.mjs` `_ccrc_pool()`, `shared/api.ts` pool wire types, `shared/poolrule.ts`, `server/test/fixtures/poolRule.ts` |
| 2a | `2026-09-05-account-pools-wave2a-ccd-tag-placement.md` | `ccd` reader/predicate/verb, agent grant, `_ws_least_loaded [project]`, `rehome` in every vocabulary, `pools-v1`, doctor |
| **2b (this plan)** | `2026-09-05-account-pools-wave2b-ccd-swap-strand-crossing.md` | the auto-swap tick, the strand, the crossing marker, the four manual verbs |
| 3 | `2026-09-05-account-pools-wave3-server.md` | server L1/L3, `SessionRecord.stranded`, routes, watcher frame, health |
| 4 | `2026-09-05-account-pools-wave4-pwa.md` | PWA |
| 5 | `2026-09-05-account-pools-wave5-docs.md` | README, CLAUDE.md, `config.ts` and `ccd` comment corrections |

Wave 2a's plan names this wave's surfaces in its own "explicitly NOT this wave" list — `_strand_mark`/`_strand_clear`/`_strand_why`, `$REG/<id>.crosspool`, `--cross-pool` on any verb, `CCD_SWAP_AUTO`, and both `_swap_target`'s and `_auto_swap_check`'s insertions — so the two waves touch disjoint regions of `ccd/ccd` and share only the names below.

**CONSUMED from wave 2a — do not redefine any of these:**

- `POOLS_DIR="$REG/pools"` — one bash literal in `ccd/ccd`, beside `REG=` (`ccd/ccd:765`).
- `_project_pool_state <project>` → stdout exactly one of `named <n>` | `untagged` | `unreadable` | `malformed`; **always rc 0**; never `die`s. Beside `_lane_enabled` (`ccd/ccd:1024`).
- `_acct_pool <wrapper>` → the account's pool name on stdout, empty for untagged/unknown, rc 0.
- `_pool_ok <wrapper> <pool-state-word>` → **rc 0 serve / 1 mismatch / 2 undecidable**. Beside `_is_home_able` (`ccd/ccd:1090`).
- `_ws_least_loaded [project]` — optional positional; zero-arg keeps today's meaning; with a project it filters candidates by `_pool_ok` and returns `""` when no in-pool account is placeable.
- `rehome` in `_LC_ACTS` (`ccd/ccd:1670`), in `LifecycleAct`/`LIFECYCLE_ACT_MAP` (`shared/api.ts`) and in `ACT_WORD` (`pwa/src/session/journalWords.ts`).
- `server/test/fixtures/poolRule.ts` → `POOLED_TEST_ROSTER` (`DEFAULT_TEST_ROSTER` with `claude`→`pool-a`, `claude-a`→`pool-a`, `claude-b`→`pool-b`, `gpt`→`null`, `claude-d`→`null`).

**PRODUCED by this wave, for waves 3–5:**

- `_strand_mark <id> <wrapper> <project>`, `_strand_clear <id>`, `_strand_why <id> <project>`.
- Registry fields `$REG/<id>.stranded` = `"<epoch> <reason>"`, `$REG/<id>.strandnotify` = `<epoch>`, `$REG/<id>.crosspool` = `"<epoch> <project-pool-at-crossing> <account>"`.
- `_crosspool_valid <id> <pool-state> <account>…` → rc 0 iff a valid crossing marker names one of those accounts; `_crosspool_tick <id> <wrapper> <home> <pool-state>` → same, and **ends** an invalid crossing; `_crosspool_mark <id> <project-pool> <account>`.
- `swap.log` verbs `rehome`, `auto-pool`, `stranded`, `unstranded`, `cross-pool`, `crosspool-ended`.
- notify text prefix `cc swap STRANDED: ` (deliberately not matching `server/src/server.ts:1305`'s `/^cc swap: (\S+) moved …/`).
- Journalled `_lc_done rehome "$id" "" meas.from <old> meas.home <new> meas.reason <pool|prefer> [meas.pool <name>] [dec.crosspool 1]`, and `dec.crosspool 1` on the `swap` row.
- `--cross-pool` accepted (and stripped) by `cmd_swap`, `cmd_start`, `cmd_enable`, `cmd_prefer`; `CCD_SWAP_AUTO=1` in `_dispatch_swap`'s transient unit environment.
- Die-text prefixes `pool-mismatch: ` and `pool tag for <p> is <unreadable|malformed>: ` — wave 3's 409/503 copy nothing from them, but wave 3's 502 pass-through carries them verbatim.

---

### Task 1: the strand — `_strand_mark`, `_strand_clear`, `_strand_why`, and the banner floor

**Files:**
- Modify: `ccd/ccd:12962` — insert three functions between `_swap_refuse`'s closing brace (`ccd/ccd:12962`) and `cmd_swap` (`ccd/ccd:12964`).
- Modify: `server/test/ccd-arith-containment.test.ts:118-125` — the `SITES` table gains one row.
- Test: `server/test/ccd-auto-swap-pool.test.ts` (Create)
- Test: `server/test/ccd-arith-containment.test.ts` (Modify)

**Interfaces:**
- Consumes: `_project_pool_state <project>` (wave 2a, four words, rc 0), `_pool_ok <w> <word>` (wave 2a, rc 0/1/2), `_acct_pool <w>` (wave 2a), `POOLS_DIR` (wave 2a), `_pool_for <id>` (`ccd/ccd:10984`), `_account_ok <w>` (`ccd/ccd:1028`), `_avail <w>` (`ccd/ccd:11099`), `_reg_set`/`_reg_get` (`ccd/ccd:1263`/`:1270`), `SWAPBLOCK_COOLDOWN=1800` (`ccd/ccd:806`), `WRAPPER_DIR` (`ccd/ccd:766`).
- Produces:
  - `_strand_clear <id>` → rc 0. Removes `$REG/<id>.stranded` **only if it exists** and appends one `swap.log` line `<date> unstranded <id>`.
  - `_strand_why <id> <project>` → one line on stdout: space-joined `<cand>:pool=<name>` / `<cand>:disabled` / `<cand>:missing` / `<cand>:limit` annotations over `$(_pool_for "$id")` minus the current wrapper, or the single token `tag:<unreadable|malformed> <POOLS_DIR>/<project>`, or `no candidate`.
  - `_strand_mark <id> <wrapper> <project>` → rc 0. Writes `$REG/<id>.stranded` = `"<epoch> <reason>"` and one `swap.log` line `<date> stranded <id>: <w> (blocked) -> nowhere [pool=<p|->] (<why>)` **only when the marker is absent**; writes `$REG/<id>.strandnotify` = `<epoch>` and fires `notify.sh` with `cc swap STRANDED: <id> is blocked on <w> and no account in pool <p|(untagged)> can take it — <why>` **only when the last banner is older than `SWAPBLOCK_COOLDOWN`**.

**Spec:** §5.8.1, §5.8.2, §5.8.4 (the `_strand_mark` half), §9 (`session-stranded`, `session-strandnotify`).

**Mutation table:** rows 34 (partially — the marker's write-once debounce and the reason), 35 (the `-e` test in `_strand_clear`), 36 (the `.strandnotify` floor), 38 (`_strand_why` walks `_pool_for`).
- Delete the `[[ -e "$REG/$1.stranded" ]] || return 0` line in `_strand_clear` → **red**: "ten healthy ticks leave swap.log byte-identical" (Task 3) fails with ten `unstranded` lines, and this task's own `_strand_clear` unit case fails.
- Delete the `[[ ! -e "$REG/$id.stranded" ]]` guard around the write in `_strand_mark` → **red**: "marks once over ten calls" fails with ten `stranded` lines.
- Delete the `.strandnotify` `[[ … -lt "$SWAPBLOCK_COOLDOWN" ]]` line → **red**: "banners once over ten calls" fails with ten notify lines.
- Change `for cand in $(_pool_for "$id")` to `for cand in "${CCRC_ACCOUNTS[@]}"` → **red**: the reason names `gpt`, which was never a candidate.

`LEDGER: the tick discarded the one fact worth keeping — a hard-blocked session with no destination returned at ccd:11243 with no marker, no log line and no cooldown stamp, and retried every five seconds for ever; the strand helpers are what make it sayable (D-1671 — spec §12 P-3).`

`LEDGER: _avail is left REAL in ccd-auto-swap-pool.test.ts and ccd-crosspool.test.ts and steered through ~/.cc-limits/<w>.json — the strand cases need it to answer false, and a stub cannot carry the limit annotation or the untagged all-at-ceiling case; only tmux, _dispatch_swap and notify.sh are stubbed (D-1672 — plan-time deviation from spec §11's stub list).`

- [ ] **Step 1: Write the failing test — the three helpers, called directly**

Create `server/test/ccd-auto-swap-pool.test.ts`:

```ts
// The pool half of the 5-second auto-swap tick (spec §5.5.3-§5.5.4, §5.8).
//
// `_auto_swap_check` and `_swap_target` stay REAL here — that is the whole
// point of the file, and it is what separates it from
// `ccd-auto-swap-hold.test.ts`, which stubs `_swap_target` because its subject
// is the hold rung and not the decision. Only `tmux`, `_dispatch_swap` and
// `notify.sh` are stubbed; `_avail` is left real and steered through
// `~/.cc-limits/<w>.json`, because half of these cases are about which
// predicate failed first and a stubbed `_avail` cannot answer that.
//
// FIXTURE HOME ONLY (`makeCcdHarness`) — HOME is ccd's single isolation
// boundary and nothing here may reach the live registry, tmux, or systemd.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { eventsOf, measOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-auto-swap-pool-');
  // claude, claude-a -> pool-a ; claude-b -> pool-b ; gpt, claude-d untagged.
  // Re-seeded rather than hand-written: a fixture accounts.sh typed out here
  // would be a fourth copy of the roster.
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
});
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const PANE_PID = '4242';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const notices = (): string =>
  fs.existsSync(path.join(h.home, 'notify-log'))
    ? fs.readFileSync(path.join(h.home, 'notify-log'), 'utf8') : '';
const noticeLines = (): string[] => notices().split('\n').filter(Boolean);
const logLines = (verb: string): string[] =>
  swapLog().split('\n').filter((l) => l.includes(` ${verb} `));

const plantNotify = (): void => {
  fs.writeFileSync(reg('notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const tagPool = (project: string, pool: string): void => {
  fs.mkdirSync(reg('pools'), { recursive: true });
  fs.writeFileSync(path.join(reg('pools'), project), pool);
};
const disable = (w: string): void => { fs.writeFileSync(reg(`${w}-disabled`), ''); };
const writeLimits = (w: string, five: number, seven: number): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));
};

/** A live-looking session on `claude`, written with `_reg_set` — the same
 *  writer ccd uses. `lastswap`/`swapblocked` are deliberately absent so both
 *  cooldown gates are open, and NO `.home` file is written, so `_home_for`
 *  falls back to the id prefix exactly as a pre-2026-07-28 row does. */
const seed = (): void => {
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  h.sh(`_reg_set ${ID} uuid 11111111-1111-4111-8111-111111111111
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir "$HOME/projects/demo"
    _reg_set ${ID} wrapper claude
    _reg_set ${ID} started 1`);
};

describe('_strand_clear', () => {
  it('writes NOTHING when there is no strand — the `-e` test is what stops the spam', () => {
    seed();
    h.sh('for ((i=0;i<10;i++)); do _strand_clear ' + ID + '; done');
    expect(swapLog()).toBe('');
  });

  it('removes the marker and says so once when there IS one', () => {
    seed();
    h.sh(`_reg_set ${ID} stranded "1700000000 nowhere"; _strand_clear ${ID}; _strand_clear ${ID}`);
    expect(h.reg(ID, 'stranded')).toBeNull();
    expect(logLines('unstranded')).toHaveLength(1);
  });
});

describe('_strand_why names the candidates the decision was actually about', () => {
  it('annotates each `_pool_for` member with the FIRST predicate it failed', () => {
    seed(); tagPool('demo', 'pool-b');
    disable('claude-b');                 // in pool, but the lane is switched off
    writeLimits('claude-d', 99, 99);     // untagged, so in pool, but at the ceiling
    // claude-a fails the POOL first and must be annotated `pool=`, not `limit`,
    // even though it is also unmeasured.
    expect(h.sh(`_strand_why ${ID} demo`))
      .toBe('claude-a:pool=pool-a claude-b:disabled claude-d:limit');
  });

  it('never names an account `_pool_for` did not offer', () => {
    seed(); tagPool('demo', 'pool-b'); disable('claude-b'); disable('claude-d');
    const why = h.sh(`_strand_why ${ID} demo`);
    expect(why, 'gpt is not home-able: it was never a candidate').not.toContain('gpt');
    expect(why, 'the account it is already stuck on is not a destination').not.toContain('claude:');
  });

  it('answers ONE undecidable token rather than inventing a reason per candidate', () => {
    seed(); tagPool('demo', 'Pool Orate');
    expect(h.sh(`_strand_why ${ID} demo`))
      .toBe(`tag:malformed ${h.home}/.cc-sessions/pools/demo`);
  });
});

describe('_strand_mark', () => {
  it('marks once, logs once and banners once across ten calls', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    h.sh(`for ((i=0;i<10;i++)); do _strand_mark ${ID} claude demo; done`);
    expect(h.reg(ID, 'stranded'))
      .toMatch(/^\d{10} claude-a:pool=pool-a claude-b:disabled claude-d:disabled$/);
    expect(logLines('stranded')).toHaveLength(1);
    expect(noticeLines()).toHaveLength(1);
    expect(noticeLines()[0])
      .toBe(`cc swap STRANDED: ${ID} is blocked on claude and no account in pool pool-b can take it`
        + ' — claude-a:pool=pool-a claude-b:disabled claude-d:disabled');
    expect(h.reg(ID, 'strandnotify')).toMatch(/^\d{10}$/);
  });

  it('re-marks after a clear but does NOT re-banner inside the floor', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    h.sh(`_strand_mark ${ID} claude demo; _strand_clear ${ID}; _strand_mark ${ID} claude demo`);
    expect(logLines('stranded'), 'the marker follows the truth').toHaveLength(2);
    expect(logLines('unstranded')).toHaveLength(1);
    expect(noticeLines(), 'only the BANNER is floored').toHaveLength(1);
  });

  it('banners again once the floor has passed', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    h.sh(`_strand_mark ${ID} claude demo`);
    // SWAPBLOCK_COOLDOWN is 1800s; back-date the stamp past it.
    h.sh(`_reg_set ${ID} strandnotify $(( $(date +%s) - 1801 ))`);
    h.sh(`_strand_clear ${ID}; _strand_mark ${ID} claude demo`);
    expect(noticeLines()).toHaveLength(2);
  });

  it('says `(untagged)` in the banner and `[pool=-]` in the log for an untagged project', () => {
    seed(); plantNotify();
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    h.sh(`_strand_mark ${ID} claude demo`);
    expect(swapLog()).toContain(`stranded ${ID}: claude (blocked) -> nowhere [pool=-]`);
    expect(notices()).toContain('no account in pool (untagged) can take it');
  });
});
```

- [ ] **Step 2: Run it and read the failure**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts`
Expected: FAIL — every case errors out of `execFileSync` with ccd's stderr carrying `_strand_clear: command not found` / `_strand_why: command not found` / `_strand_mark: command not found`.

- [ ] **Step 3: Write the three helpers**

In `ccd/ccd`, immediately after `_swap_refuse`'s closing `}` (currently line 12962) and before `cmd_swap() {` (currently line 12964), insert:

```bash
_strand_clear() {   # id — the strand is over; say so exactly once per strand.
  # THE `-e` TEST IS LOAD-BEARING, and it is not a micro-optimisation.
  # `_auto_swap_check` calls this on EVERY healthy tick of EVERY session, so
  # without it ~20 sessions write ~240 `unstranded` lines a minute into
  # swap.log — the forensic trail beside every swap decision — and the file
  # stops being readable by the human it exists for.
  [[ -e "$REG/$1.stranded" ]] || return 0
  rm -f -- "$REG/$1.stranded"
  echo "$(date '+%F %T') unstranded $1" >> "$REG/swap.log"
}

_strand_why() {   # id project -> one line naming why no candidate could take this session
  # WALKS `_pool_for`, NOT `CCRC_ACCOUNTS`. The candidate set is the thing the
  # decision was actually about: a reason naming a non-home-able lane, or one a
  # hand-set registry `pool` list excluded, sends the operator to enable an
  # account that would not have been used anyway.
  #
  # PREDICATE ORDER MIRRORS `_swap_target`'s OWN LOOP — pool, then _account_ok,
  # then _avail — so the annotation is the FIRST thing that failed, which is
  # the thing to fix. An account in the wrong pool reads `pool=`, never
  # `limit`, even when both are true.
  local id="$1" p="$2" pps cand ap cur out=""
  pps=$(_project_pool_state "$p")
  # Undecidable is NOT a per-candidate fact: nobody decides, so annotating five
  # accounts would invent five reasons for one condition. One token, with the
  # path, because the remedy is a permission or a rewrite and not an account.
  [[ "$pps" == untagged || "$pps" == "named "* ]] \
    || { echo "tag:$pps $POOLS_DIR/$p"; return 0; }
  cur=$(_reg_get "$id" wrapper)
  for cand in $(_pool_for "$id"); do
    [[ "$cand" == "$cur" ]] && continue
    if ! _pool_ok "$cand" "$pps"; then
      ap=$(_acct_pool "$cand"); out+=" $cand:pool=${ap:-none}"
    elif ! _account_ok "$cand"; then
      if [[ -x "$WRAPPER_DIR/$cand" ]]; then out+=" $cand:disabled"; else out+=" $cand:missing"; fi
    elif ! _avail "$cand"; then
      out+=" $cand:limit"
    fi
  done
  [[ -n "$out" ]] || out=" no candidate"
  echo "${out# }"
}

_strand_mark() {   # id wrapper project — a hard-blocked session with nowhere to go.
  # RULING 6: an empty pool STAYS IN POOL and says so. Never cross.
  #
  # TWO FLOORS, and they are floors on different things. The MARKER is the
  # debounce for the log line — presence means "this strand has already been
  # announced" — so the 5-second tick cannot spam swap.log. The BANNER carries
  # its own floor on top, because `_pane_hard_blocked` greps the last eight
  # pane lines and a scrolling limit banner can flip the verdict every tick:
  # each flip is a legitimate mark -> clear -> mark, and the marker must follow
  # the truth, but 720 banners an hour is the storm SWAPBLOCK_COOLDOWN was
  # introduced for on the refusal channel (see _auto_swap_check's gate).
  # Suppressing the MARKER instead would hide the truth; only the banner waits.
  local id="$1" w="$2" p="$3" now pps pool pdesc why nts banner=1
  now=$(date +%s)
  pps=$(_project_pool_state "$p")
  pool='-'; pdesc='(untagged)'
  [[ "$pps" == "named "* ]] && { pool="${pps#named }"; pdesc="$pool"; }
  why=$(_strand_why "$id" "$p")
  if [[ ! -e "$REG/$id.stranded" ]]; then
    _reg_set "$id" stranded "$now $why"
    echo "$(date '+%F %T') stranded $id: $w (blocked) -> nowhere [pool=$pool] ($why)" >> "$REG/swap.log"
  fi
  # THE DIGIT VALIDATION IS FIRST inside the same `[[ ]]`, so `&&`
  # short-circuits before the arithmetic ever sees a torn or hand-edited field
  # (D-299's class; the same shape as the `swapblocked` gate above).
  nts=$(_reg_get "$id" strandnotify)
  [[ "$nts" =~ ^[0-9]+$ && $((now - nts)) -lt "$SWAPBLOCK_COOLDOWN" ]] && banner=""
  if [[ -n "$banner" ]]; then
    _reg_set "$id" strandnotify "$now"
    # DELIBERATELY NOT `cc swap: <id> moved …`: server/src/server.ts:1305 parses
    # that exact prefix into a per-session chat line about an account CHANGE,
    # and nothing changed here.
    [[ -x "$REG/notify.sh" ]] \
      && "$REG/notify.sh" "cc swap STRANDED: $id is blocked on $w and no account in pool $pdesc can take it — $why" >/dev/null 2>&1
  fi
  return 0
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Write the failing arithmetic-containment row**

`_strand_mark` adds a SIXTH arithmetic site reading a registry field, and `ccd-arith-containment.test.ts`'s population is hand-enumerated, so it cannot see it. Add the payload case and the structural row.

In `server/test/ccd-arith-containment.test.ts`, inside the first `describe`, after the `_dispatch_swap` case (before the `ccd assigns SWAP_JITTER unconditionally` case), add:

```ts
  it('_strand_mark does not evaluate a payload planted in strandnotify', () => {
    const h = makeCcdHarness('arith-strand');
    // The banner floor reads `strandnotify` as an arithmetic operand. A torn or
    // hand-edited field is the threat model, exactly as `lastswap` is.
    h.sh(
      '_reg_set myid wrapper claude;'
      + " _reg_set myid strandnotify 'REG[$(touch \"$HOME/PWNED-strand\")]';"
      + ' _strand_mark myid claude demo');
    expect(existsSync(path.join(h.home, 'PWNED-strand'))).toBe(false);
    h.cleanup();
  });
```

and in the `SITES` table add the row:

```ts
    { fn: '_strand_mark (strandnotify floor)', anchors: ['$((now - nts))', 'SWAPBLOCK_COOLDOWN'], arith: '$((' },
```

- [ ] **Step 6: Run it to verify the guard is real**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-arith-containment.test.ts`
Expected: PASS. Then measure the mutation: remove `"$nts" =~ ^[0-9]+$ && ` from `_strand_mark`'s guard line and re-run — expect FAIL on both the payload case (`expected true to be false`) and the structural row naming `_strand_mark (strandnotify floor)`. Restore the guard and re-run — PASS.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-auto-swap-pool.test.ts server/test/ccd-arith-containment.test.ts
git commit -m "feat(ccd): an empty pool strands loudly — a marker that debounces the log and a floor that debounces the banner"
```

---

### Task 2: `_swap_target` — the three pool insertions, and the crossing marker that exempts a row

**Files:**
- Modify: `ccd/ccd:11155-11169` (`_swap_target`'s locals, the two "stay" shortcuts, the home-recovered branch, and the candidate loop).
- Modify: `ccd/ccd:12962` — one more helper beside the strand ones.
- Test: `server/test/ccd-auto-swap-pool.test.ts` (Modify)

**Interfaces:**
- Consumes: `_project_pool_state`, `_pool_ok`, `_pool_for` (`ccd/ccd:10984`), `_default_pool` (`ccd/ccd:10960`), `_account_ok`, `_avail`, `_reg_get`.
- Produces: `_crosspool_valid <id> <pool-state-word> <account>…` → rc 0 iff `$REG/<id>.crosspool` exists, its stored pool `<p>` makes the state read exactly `named <p>`, and its stored account equals one of the accounts given; rc 1 otherwise. `_swap_target <id> <cur> <home> [force]` keeps its exact stdout contract (destination, or nothing) and its `force` semantics; the pool rule sets `force=pool` internally.

**Spec:** §5.5.3, §5.7.2 (the `_swap_target` half), §6 (the `_swap_target` stdout row).

**Mutation table:** row 30 (all three insertions), row 44 (the loop filter is not relaxed; the marker exempts the row).
- Delete `[[ "$prc" -eq 1 && -z "$cross_cur" ]] && force=pool` → **red**: "treats a wrong-pool current account as a MUST-LEAVE" fails with `expected '' to be 'claude-b'`.
- Delete `{ [[ -n "$cross_home" ]] || _pool_ok "$home" "$pps"; } &&` from the home-recovered branch → **red**: "never returns to a wrong-pool home" fails with `expected 'claude' to be ''`.
- Move `_pool_ok "$cand" "$pps" || continue` out of `_swap_target`'s loop and into `_default_pool` → **red**: "filters the candidate loop AFTER `_pool_for`" fails with `expected 'claude-a' to be 'claude-b'`, because a hand-set registry `pool` list bypasses `_default_pool` entirely (`ccd/ccd:10984`).
- Delete `[[ -n "$a" && "$a" == "${acct:-}" ]] && return 0` from `_crosspool_valid` (i.e. make any marker valid) → **red**: "is false once the session moved off the crossed account".

`LEDGER: _swap_target's stdout still folds "stay, fine" into "must leave, nowhere"; the pool rule adds a third producer of the empty answer (an undecidable tag) and the caller still disambiguates on $hard_blocked rather than the callee widening its seam (D-1673 — spec §12 P-10).`

`LEDGER: ruling 4 (a manual crossing sticks) and ruling 5 (a retag is a must-leave) contradict each other on the same row until something records which of the two the operator meant; the .crosspool marker is that record, and _crosspool_valid is where the pool machinery asks (D-1674 — spec §12 P-15).`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-auto-swap-pool.test.ts`:

```ts
describe('_crosspool_valid', () => {
  const valid = (pps: string, ...accts: string[]): string =>
    h.sh(`_crosspool_valid ${ID} "${pps}" ${accts.join(' ')} && echo yes || echo no`);
  const marker = (): void => { h.sh(`_reg_set ${ID} crosspool "1700000000 pool-a claude-b"`); };

  it('is false with no marker at all — one stat, no `cat`', () => {
    seed();
    expect(valid('named pool-a', 'claude-b')).toBe('no');
  });

  it('is true while the project pool AND the account both still match', () => {
    seed(); marker();
    expect(valid('named pool-a', 'claude-b')).toBe('yes');
    // The `home` clause: a `prefer --cross-pool` puts the marker on the home,
    // so callers pass both and either may satisfy it.
    expect(valid('named pool-a', 'claude', 'claude-b')).toBe('yes');
  });

  it('is false once the project was retagged or untagged', () => {
    seed(); marker();
    expect(valid('named pool-b', 'claude-b')).toBe('no');
    expect(valid('untagged', 'claude-b')).toBe('no');
    expect(valid('unreadable', 'claude-b')).toBe('no');
  });

  it('is false once the session moved off the crossed account', () => {
    seed(); marker();
    expect(valid('named pool-a', 'claude-a')).toBe('no');
  });
});

describe('_swap_target and the pool', () => {
  const target = (cur: string, home: string, force = ''): string =>
    h.sh(`_swap_target ${ID} ${cur} ${home} ${force} || true`);

  it('treats a wrong-pool current account as a MUST-LEAVE (force=pool skips both stay shortcuts)', () => {
    seed(); tagPool('demo', 'pool-b');
    writeLimits('claude', 1, 1);        // telemetry says home is fine: pre-pool, the answer was ""
    writeLimits('claude-b', 50, 50);
    expect(target('claude', 'claude')).toBe('claude-b');
  });

  it('never returns to a wrong-pool home', () => {
    seed(); tagPool('demo', 'pool-b');
    h.sh(`_reg_set ${ID} home claude`);
    // cur is IN pool and home is not: the home-recovered branch must not fire,
    // so the answer is "stay put" rather than a move onto the wrong pool.
    expect(target('claude-b', 'claude')).toBe('');
    // …and under force, the loop answers with an IN-POOL account, never home.
    expect(target('claude-b', 'claude', '1')).toBe('claude-d');
  });

  it('filters the candidate loop AFTER _pool_for — a hand-set registry `pool` list cannot land out of pool', () => {
    seed(); tagPool('demo', 'pool-b');
    h.sh(`_reg_set ${ID} pool "claude-a claude-b"`);
    writeLimits('claude-a', 1, 1);      // by far the cheapest, and in the WRONG pool
    writeLimits('claude-b', 90, 90);
    expect(target('claude', 'claude', '1')).toBe('claude-b');
  });

  it('answers NOTHING when the tag cannot be read — nobody decides', () => {
    seed(); tagPool('demo', 'Pool Orate');   // two tokens and a capital: malformed
    writeLimits('claude', 99, 99);
    expect(target('claude', 'claude', '1')).toBe('');
  });

  it('a VALID crossing marker suppresses the must-leave force and admits the crossed home', () => {
    seed(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} home claude-b; _reg_set ${ID} crosspool "1700000000 pool-a claude-b"`);
    // cur == home == the crossed account: without the marker this is a
    // must-leave and the loop moves it back into pool-a.
    expect(target('claude-b', 'claude-b')).toBe('');
  });
});
```

- [ ] **Step 2: Run it and read the failure**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts -t 'crosspool_valid'`
Expected: FAIL — `_crosspool_valid: command not found` on stderr, so `h.sh` throws.

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts -t '_swap_target and the pool'`
Expected: FAIL — `expected '' to be 'claude-b'` (must-leave), `expected 'claude' to be ''` (home guard), `expected 'claude-a' to be 'claude-b'` (loop filter), `expected 'claude-a' to be ''` (undecidable), `expected 'claude' to be ''` (marker).

- [ ] **Step 3: Write `_crosspool_valid`**

In `ccd/ccd`, immediately after `_strand_mark`'s closing `}` (Task 1's last insertion), before `cmd_swap`, insert:

```bash
_crosspool_valid() {   # id pool-state account... -> 0 iff a VALID crossing marker names one of them
  # RULING 8. `$REG/<id>.crosspool` records a DELIBERATE crossing and switches
  # off the POOL machinery's reaction to it — the must-leave force, the home
  # re-seed, the home guard, the in-unit refusal — for exactly as long as two
  # things hold:
  #   - the project is still in the pool it was in when the operator crossed
  #     (a retag or an untag is a new instruction and outranks the old one), and
  #   - the session is still on the account they crossed TO: `wrapper` for a
  #     `swap`/`start` crossing, `home` for a `prefer` one. Callers pass both
  #     and either satisfies it.
  # It does NOT switch off the pre-existing home affinity (§2, O1): a
  # `swap --cross-pool` session still returns home when home recovers, and that
  # return is a move off the account, which ends the crossing.
  #
  # The `-e` test is FIRST so the steady state of an uncrossed row — every row,
  # on every 5-second tick — costs one stat and not a `cat`.
  local id="$1" pps="$2" raw ts pool acct a
  shift 2
  [[ -e "$REG/$id.crosspool" ]] || return 1
  raw=$(_reg_get "$id" crosspool)
  read -r ts pool acct <<<"$raw" || :
  [[ -n "${pool:-}" && "$pps" == "named $pool" ]] || return 1
  for a in "$@"; do [[ -n "$a" && "$a" == "${acct:-}" ]] && return 0; done
  return 1
}
```

- [ ] **Step 4: Write the three `_swap_target` insertions**

In `ccd/ccd`, replace the block from the `local id="$1" cur=…` line (currently `:11155`) through the `_avail "$cand" || continue` line (currently `:11169`) with:

```bash
  local id="$1" cur="$2" home="$3" force="${4:-}" cand best="" best_score=999 sc
  # ── POOLS (§5.5.3) ───────────────────────────────────────────────────────
  # The project's tag is read ONCE per decision and the WORD is passed down, so
  # a loop over five candidates costs one `cat`, not five. `_project_pool_state`
  # never dies — it runs inside the long-lived supervise loop.
  local project pps prc cross_cur="" cross_home=""
  project=$(_reg_get "$id" project); pps=$(_project_pool_state "$project")
  _crosspool_valid "$id" "$pps" "$cur"  && cross_cur=1
  _crosspool_valid "$id" "$pps" "$home" && cross_home=1
  # UNDECIDABLE IS NOT A DECISION. An unreadable or malformed tag means nobody
  # decides: answer nothing and let the caller mark a strand if the pane is
  # hard-blocked (_auto_swap_check step 4). Folding it into "stay" would be
  # right by accident; folding it into "untagged" would silently lift the
  # constraint, which is the overloaded-null defect this tree names.
  _pool_ok "$cur" "$pps"; prc=$?
  [[ "$prc" -eq 2 ]] && return 0
  # A WRONG-POOL CURRENT ACCOUNT IS A MUST-LEAVE (ruling 5): `force=pool` skips
  # both "stay" shortcuts exactly as a hard block does, so a retag relocates the
  # session at its next idle boundary instead of waiting for telemetry to turn
  # against an account that is perfectly healthy and simply in the wrong pool.
  [[ "$prc" -eq 1 && -z "$cross_cur" ]] && force=pool
  if [[ "$cur" == "$home" ]]; then
    [[ -z "$force" ]] && { _avail "$home" && return 0; }                     # home is fine: stay
  else
    # disabled excludes home as a DESTINATION only — it never evacuates a
    # session already sitting on it, which is why the two "stay" branches
    # here and below carry no _account_ok check.
    #
    # NEVER RETURN TO A WRONG-POOL HOME. Without this the affinity arm would
    # undo the re-seed every time home recovered. The CROSSED home is admitted,
    # and only the crossed one: `_crosspool_valid` was asked about `$home`
    # specifically, so a marker written for `wrapper` cannot admit it.
    _account_ok "$home" && { [[ -n "$cross_home" ]] || _pool_ok "$home" "$pps"; } \
      && _avail "$home" && { echo "$home"; return 0; }                       # home recovered: go back
    [[ -z "$force" ]] && { _avail "$cur" && return 0; }                      # cur still works, home down: stay put
  fi
  # must leave cur (home-but-down, away-and-cur-down, or forced with no recovered home): pick the least-loaded AVAILABLE account
  for cand in $(_pool_for "$id"); do
    [[ "$cand" == "$cur" ]] && continue
    # THE FILTER LIVES HERE, AFTER `_pool_for`, AND NEVER INSIDE `_default_pool`:
    # a hand-set `$REG/<id>.pool` candidate list bypasses `_default_pool`
    # entirely (ccd:10984), so a filter placed there would let an other-pool
    # wrapper land. AUTOMATIC MOVES NEVER CROSS — marker or no marker: the
    # marker exempts the row from being MOVED, it does not license a new
    # crossing, so any automatic move lands in pool and, by the account clause
    # above, ends the crossing.
    _pool_ok "$cand" "$pps" || continue
    _account_ok "$cand" || continue
    _avail "$cand" || continue
```

Everything from the `# UNMEASURED RANKS LAST` comment (currently `:11170`) to the end of the function is unchanged.

- [ ] **Step 5: Run the suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 6: Prove the untouched arms are untouched**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-account-ok.test.ts test/ccd-limits.test.ts test/ccd-login-screen.test.ts test/ccd-auto-swap-hold.test.ts`
Expected: PASS — these four suites drive `_swap_target`'s force matrix, its rescue arm and the hold rung against an UNTAGGED fixture, where `_pool_ok` answers 0 for every account and this task changes no answer.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-auto-swap-pool.test.ts
git commit -m "feat(ccd): the swap target asks which pool the project is in, and a deliberate crossing exempts the row"
```

---

### Task 3: the tick — the home re-seed, the strand branch, and the `auto-pool` verb

**Files:**
- Modify: `ccd/ccd:11213-11214` (locals + the pool reads), `ccd/ccd:11241-11243` (the strand branch), `ccd/ccd:11294` (the affinity arm's log verb).
- Test: `server/test/ccd-auto-swap-pool.test.ts` (Modify)

**Interfaces:**
- Consumes: `_project_pool_state`, `_pool_ok`, `_ws_least_loaded <project>` (all wave 2a); `_crosspool_valid` (Task 2); `_strand_mark`, `_strand_clear` (Task 1); `_home_for` (`ccd/ccd:11097`), `_pane_hard_blocked` (`ccd/ccd:11200`), `_swap_target` (`ccd/ccd:11142`), `_lc_done` (`ccd/ccd:2305`), `_reg_set`.
- Produces: `_auto_swap_check <id>` keeps its signature and rc; it now additionally writes `$REG/<id>.home` (re-seed), a `rehome` journal row, and the `rehome` / `auto-pool` / `stranded` / `unstranded` `swap.log` verbs.

**Spec:** §5.5.4 (insertions 1, 3, 4, 5; insertion 2 is Task 4), §5.8.1-§5.8.2 (the call sites), §12 P-3 (D-1671), P-8 (D-1675).

**Mutation table:** rows 31, 33, 34, 35, 36 (integration half), 44 (the re-seed honours the marker).
- Delete the re-seed block → **red**: "re-seeds a wrong-pool home inside one tick" fails with `expected null to be 'claude-b'`.
- Replace `_reg_set "$id" home "$new"` with `_ws_seed_home "$id" "$new"` → **red**: the same case fails on any row that already has a `.home`, because `_ws_seed_home` never clobbers and clobbering is the point.
- Delete the `_lc_done rehome …` line → **red**: `expected [] to have a length of 1`.
- Delete `[[ -z "$crossed" ]]` from the re-seed's guard → **red**: `ccd-crosspool.test.ts`'s "`prefer --cross-pool` survives the re-seed".
- Delete `[[ -n "$hard_blocked" ]] || _strand_clear "$id"` → **red**: "CLEARS the strand when the pane recovers".
- Turn the strand branch back into `[[ -n "$target" && "$target" != "$wrapper" ]] || return 0` → **red**: "STRANDS loudly when the pool is empty" fails with `expected null to match /…/`.
- Gate `_strand_mark` on a tagged project (`[[ "$pps" == "named "* ]] &&`) → **red**: "strands an UNTAGGED project too".
- Leave the affinity verb as the literal `auto-home` → **red**: "moves on the AFFINITY arm with the verb `auto-pool`".
- Move `[[ -e "$REG/$id.hold" ]] && return 0` above the rescue arm → **red**: `ccd-auto-swap-hold.test.ts`'s "STILL RESCUES a held session that is hard-blocked", and this task's "RESCUES a hard-blocked wrong-pool session at once".

`LEDGER: the retag's move rides SWAP_COOLDOWN and SWAPBLOCK_COOLDOWN like any other relocation, so a session that swapped in the last 15 minutes or was refused in the last 30 keeps running on the wrong-pool account until its gate opens; the alternative — clearing lastswap on a retag — reopens the storm the gate exists for, and a dispatched unit's jitter can widen the same window by up to 120 s (D-1675 — spec §12 P-8).`

- [ ] **Step 1: Write the failing tests**

First add the tick fixtures to the helper block of `server/test/ccd-auto-swap-pool.test.ts`, immediately after `seed`:

```ts
/** `ccd-auto-swap-hold.test.ts`'s AFFINITY fixture, with `_swap_target` and
 *  `_avail` left REAL: a pane at a clean prompt, a pane pid, and a dispatch
 *  that logs instead of running systemd-run. */
const AFFINITY = `
  tmux() { case "\${1:-}" in
             capture-pane) printf '%s\\n' "❯ " ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** The RESCUE fixture: a real limit banner, matched by the REAL
 *  `_pane_hard_blocked` — the classifier IS the discriminator here. */
const BLOCKED = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;

/** The status file the affinity arm's idle gate reads, under the CURRENT
 *  account's config dir (`_cfg_dir claude` -> `$HOME/.claude`). */
const idleStatus = (cfg = '.claude'): void => {
  const dir = path.join(h.home, cfg, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PANE_PID}.json`),
    JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
};

const tick = (stubs: string, n = 1): string =>
  h.sh(`${stubs} for ((i=0;i<${n};i++)); do _auto_swap_check ${ID}; done`);
```

Then append the cases:

```ts
describe('the tick re-seeds a wrong-pool home (§5.5.4 step 1)', () => {
  it('re-seeds inside ONE tick, journals `rehome`, and writes a FIRST .home for a row that had none', () => {
    seed(); tagPool('demo', 'pool-b'); idleStatus();
    writeLimits('claude-b', 10, 10); writeLimits('claude-d', 60, 60);
    expect(h.reg(ID, 'home'), 'the fixture must start with no .home at all').toBeNull();
    tick(AFFINITY);
    expect(h.reg(ID, 'home')).toBe('claude-b');
    const rows = eventsOf(h.home, 'rehome');
    expect(rows).toHaveLength(1);
    expect(measOf(rows[0]!))
      .toMatchObject({ from: 'claude', home: 'claude-b', reason: 'pool', pool: 'pool-b' });
    expect(swapLog()).toContain(`rehome ${ID}: home claude -> claude-b [pool=pool-b]`);
  });

  it('is IDEMPOTENT: a second tick leaves .home byte-identical and writes no second row', () => {
    seed(); tagPool('demo', 'pool-b'); idleStatus(); writeLimits('claude-b', 10, 10);
    tick(AFFINITY);
    const first = fs.readFileSync(reg(`${ID}.home`));
    tick(AFFINITY);
    expect(fs.readFileSync(reg(`${ID}.home`))).toEqual(first);
    expect(eventsOf(h.home, 'rehome')).toHaveLength(1);
    expect(logLines('rehome')).toHaveLength(1);
  });

  it('re-seeds ABOVE the cooldown gates — a session inside SWAP_COOLDOWN still gets its home fixed', () => {
    // The move waits for the gate (D-1675); the pinned home does not, because a
    // wrong-pool `.home` is what the affinity arm would pull the session BACK to.
    seed(); tagPool('demo', 'pool-b'); writeLimits('claude-b', 10, 10);
    h.sh(`_reg_set ${ID} lastswap "$(date +%s)"`);
    tick(AFFINITY);
    expect(h.reg(ID, 'home')).toBe('claude-b');
    expect(h.calls().join('\n'), 'the MOVE is still gated').not.toContain('dispatch');
  });
});

describe('the tick moves a retagged session (§5.5.4 step 5)', () => {
  it('moves on the AFFINITY arm with the verb `auto-pool` — the cause was a retag, not the ceiling', () => {
    seed(); tagPool('demo', 'pool-b'); idleStatus(); writeLimits('claude-b', 10, 10);
    tick(AFFINITY);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-b`);
    expect(swapLog()).toContain(`auto-pool ${ID}: claude -> claude-b [home=claude-b]`);
    expect(swapLog(), 'the ceiling did not cause this move').not.toContain('auto-home');
  });

  it('DEFERS the move while a hold stands — but still re-seeds the home', () => {
    // The hold rung must not move (§14 O3): a retag is an affinity-class
    // relocation and a mid-wave worker stays put until release. The re-seed
    // sits ABOVE the rung, so the deferral is visible rather than invisible.
    seed(); tagPool('demo', 'pool-b'); idleStatus(); writeLimits('claude-b', 10, 10);
    fs.writeFileSync(reg(`${ID}.hold`), 'program:demo wave:2/4 run:17');
    tick(AFFINITY);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(ID, 'lastswap'), 'a deferred tick stamps nothing').toBeNull();
    expect(h.reg(ID, 'home'), 'the re-seed runs above the hold rung').toBe('claude-b');
  });

  it('RESCUES a hard-blocked wrong-pool session at once, IN POOL, past the hold rung', () => {
    // claude-a is by far the cheapest lane and in the WRONG pool: a rescue that
    // ignored the filter would land there, which is the crossing ruling 6 forbids.
    seed(); tagPool('demo', 'pool-b');
    writeLimits('claude-a', 1, 1); writeLimits('claude-b', 10, 10);
    fs.writeFileSync(reg(`${ID}.hold`), 'held');
    tick(BLOCKED);
    expect(h.calls().join('\n')).toContain(`dispatch ${ID} -> claude-b`);
    expect(swapLog()).toContain(`auto-rescue ${ID}: claude (blocked) -> claude-b`);
    expect(fs.existsSync(reg(`${ID}.stranded`)), 'a rescue is not a strand').toBe(false);
  });
});

describe('the tick strands rather than crossing (§5.5.4 steps 3-4, ruling 6)', () => {
  it('marks ONCE over ten ticks, with one log line and one banner', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');   // nothing in pool-b, nothing untagged, is placeable
    tick(BLOCKED, 10);
    expect(h.calls().join('\n'), 'never cross').not.toContain('dispatch');
    expect(h.reg(ID, 'stranded'))
      .toMatch(/^\d{10} claude-a:pool=pool-a claude-b:disabled claude-d:disabled$/);
    expect(logLines('stranded')).toHaveLength(1);
    expect(noticeLines()).toHaveLength(1);
    expect(h.reg(ID, 'lastswap'), 'no stamp, so the first recovery tick rescues at once').toBeNull();
  });

  it('CLEARS the strand when the pane recovers, and says so', () => {
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    tick(BLOCKED);
    expect(fs.existsSync(reg(`${ID}.stranded`))).toBe(true);
    tick(AFFINITY);
    expect(fs.existsSync(reg(`${ID}.stranded`))).toBe(false);
    expect(logLines('unstranded')).toHaveLength(1);
  });

  it('strands an UNTAGGED project too — the pre-existing SILENT strand, made loud', () => {
    // ccd:11243 reached this state today with every account at the ceiling and
    // returned with no marker, no line and no stamp, retrying every 5 s for ever.
    seed(); plantNotify();                       // deliberately no tag at all
    for (const w of ['claude', 'claude-a', 'claude-b', 'claude-d']) writeLimits(w, 99, 99);
    tick(BLOCKED, 10);
    expect(h.calls().join('\n')).not.toContain('dispatch');
    expect(h.reg(ID, 'stranded')).toMatch(/^\d{10} claude-a:limit claude-b:limit claude-d:limit$/);
    expect(swapLog()).toContain(`stranded ${ID}: claude (blocked) -> nowhere [pool=-]`);
    expect(notices()).toContain('no account in pool (untagged) can take it');
  });

  it('writes NOTHING to swap.log across ten healthy ticks on a never-stranded session', () => {
    // The `-e` test inside `_strand_clear`, measured at the tick rather than at
    // the helper: ~20 live sessions x 12 ticks a minute is the real load.
    seed(); idleStatus();
    h.sh(`echo sentinel >> "$HOME/.cc-sessions/swap.log"`);
    const before = fs.readFileSync(reg('swap.log'));
    tick(AFFINITY, 10);
    expect(fs.readFileSync(reg('swap.log'))).toEqual(before);
  });

  it('the marker toggles on every flip while the BANNER is floored', () => {
    // `_pane_hard_blocked` greps the last eight pane lines, so a scrolling limit
    // banner flips the verdict tick by tick. Each flip is a legitimate
    // mark -> clear -> mark; only the banner waits out SWAPBLOCK_COOLDOWN.
    seed(); tagPool('demo', 'pool-b'); plantNotify();
    disable('claude-b'); disable('claude-d');
    for (let i = 0; i < 5; i++) {
      tick(BLOCKED);
      expect(fs.existsSync(reg(`${ID}.stranded`)), `blocked tick ${i}`).toBe(true);
      tick(AFFINITY);
      expect(fs.existsSync(reg(`${ID}.stranded`)), `clear tick ${i}`).toBe(false);
    }
    expect(logLines('stranded')).toHaveLength(5);
    expect(logLines('unstranded')).toHaveLength(5);
    expect(noticeLines(), 'one banner, not five').toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it and read the failure**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts`
Expected: FAIL — 10 failures (the tenth case, "writes NOTHING to swap.log across ten healthy ticks", passes vacuously before the change and is a regression guard afterwards). Representative texts: `expected null to be 'claude-b'` (re-seed), `expected [] to have a length of 1` (`rehome` rows), `expected '…auto-home claude-demo…' to contain 'auto-pool claude-demo'`, `expected null to match /^\d{10} claude-a:pool=pool-a…/` (strand), `expected false to be true` (marker present after a blocked tick). The 18 tests from Tasks 1-2 stay green.

- [ ] **Step 3: Write the tick insertions**

In `ccd/ccd`, replace the two lines that open `_auto_swap_check`'s body (currently `:11213-11214`):

```bash
  local id="$1" wrapper home now last pane target hard_blocked="" blocked bts
  wrapper=$(_reg_get "$id" wrapper); home=$(_home_for "$id")
```

with:

```bash
  local id="$1" wrapper home now last pane target hard_blocked="" blocked bts
  local project pps prc crossed="" new aff_verb=auto-home
  wrapper=$(_reg_get "$id" wrapper); home=$(_home_for "$id")
  # ── POOLS (§5.5.4) ───────────────────────────────────────────────────────
  # Read ONCE per tick and BEFORE the cooldown gates below. The re-seed is not
  # a relocation — nothing restarts, no transcript moves — so it must not wait
  # 900 s behind a gate that exists to stop swap storms, and it is idempotent
  # the moment `.home` is back in pool.
  project=$(_reg_get "$id" project); pps=$(_project_pool_state "$project")
  _crosspool_valid "$id" "$pps" "$wrapper" "$home" && crossed=1
  # HOME RE-SEED (ruling 5). A retag makes a pinned wrong-pool home a lie: the
  # affinity arm would keep pulling the session back onto it for ever. NOT
  # `_ws_seed_home` — that never clobbers, and clobbering is the entire point.
  # A row with no `.home` file at all (pre-2026-07-28) gets one written here
  # for the first time.
  if [[ -z "$crossed" ]]; then
    _pool_ok "$home" "$pps"; prc=$?
    if [[ "$prc" -eq 1 ]]; then
      new=$(_ws_least_loaded "$project")
      if [[ -n "$new" && "$new" != "$home" ]]; then
        _reg_set "$id" home "$new"
        _lc_done rehome "$id" "" meas.from "$home" meas.home "$new" \
          meas.reason pool meas.pool "${pps#named }"
        echo "$(date '+%F %T') rehome $id: home $home -> $new [pool=${pps#named }]" >> "$REG/swap.log"
        home="$new"
      fi
    fi
  fi
  # THE AFFINITY ARM'S LOG VERB, decided here because `wrapper` cannot change
  # inside a tick: when the CURRENT account is the thing that failed the pool
  # rule, the move's cause was a retag and the line must say so. An undecidable
  # tag is not a cause — rc 2 leaves the verb alone.
  _pool_ok "$wrapper" "$pps"; prc=$?
  [[ "$prc" -eq 1 && -z "$crossed" ]] && aff_verb=auto-pool
```

Then replace the three lines currently at `:11241-11243`:

```bash
  _pane_hard_blocked "$pane" && hard_blocked=1
  target=$(_swap_target "$id" "$wrapper" "$home" "$hard_blocked")
  [[ -n "$target" && "$target" != "$wrapper" ]] || return 0
```

with:

```bash
  _pane_hard_blocked "$pane" && hard_blocked=1
  # A HEALTHY PANE IS NOT STRANDED. `_strand_clear` tests `-e` first, so the
  # steady state of a healthy session writes nothing at all.
  [[ -n "$hard_blocked" ]] || _strand_clear "$id"
  target=$(_swap_target "$id" "$wrapper" "$home" "$hard_blocked")
  # RULING 6, AND THE LINE THAT USED TO SIT HERE IS WHY. `|| return 0`
  # discarded the one fact worth keeping: a hard-blocked session with nowhere
  # to go, retried every five seconds with no marker, no log line and no
  # cooldown stamp. It fires for an UNTAGGED project too — every account at the
  # ceiling reaches exactly this state — which is the pre-existing silent
  # strand made loud, not a new behaviour for tagged projects only.
  if [[ -z "$target" || "$target" == "$wrapper" ]]; then
    [[ -z "$target" && -n "$hard_blocked" ]] && _strand_mark "$id" "$wrapper" "$project"
    return 0
  fi
  # A destination exists: whatever the pane says, this row is not stranded.
  _strand_clear "$id"
```

Finally, in the affinity arm's log line (currently `:11294`), replace the literal `auto-home` with `$aff_verb`:

```bash
  echo "$(date '+%F %T') $aff_verb $id: $wrapper -> $target [home=$home]" >> "$REG/swap.log"
```

The rescue arm's `auto-rescue` line (`:11260`) and the hold rung (`:11278`) are **not** touched.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts`
Expected: PASS — 29 tests.

- [ ] **Step 5: Prove the hold rung and the rescue arm still answer as they did**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-hold.test.ts test/ccd-swap-refuse.test.ts test/ccd-arith-containment.test.ts`
Expected: PASS. `ccd-auto-swap-hold.test.ts` stubs `_swap_target`, so its five cases exercise the tick's new code with an untagged project and an unchanged answer; `ccd-swap-refuse.test.ts` drives the same tick through `AUTO_TICK_STUBS`.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-auto-swap-pool.test.ts
git commit -m "feat(ccd): the tick re-seeds a wrong-pool home, says auto-pool when a retag caused the move, and stops strands from being silent"
```

---

### Task 4: the crossing expires — `_crosspool_tick` and the `crosspool-ended` line

**Files:**
- Modify: `ccd/ccd` — one helper beside `_crosspool_valid`; one call swapped inside `_auto_swap_check`.
- Test: `server/test/ccd-crosspool.test.ts` (Create)

**Interfaces:**
- Consumes: `_crosspool_valid` (Task 2), `_project_pool_state` (wave 2a), `_reg_get`.
- Produces: `_crosspool_tick <id> <wrapper> <home> <pool-state-word>` → rc 0 iff a valid crossing stands; otherwise, when a marker exists but is no longer valid, removes `$REG/<id>.crosspool`, appends one `swap.log` line `<date> crosspool-ended <id>: <reason>` (`project pool is now <state-word>` or `moved off <account>`), and returns 1.

**Spec:** §5.5.4 (insertion 2), §5.7.2, §6 (the `.crosspool` validity row).

**Mutation table:** row 44 (the marker is invalidated by a retag or a move).
- Delete the `rm -f -- "$REG/$id.crosspool"` line → **red**: "a retag ENDS the crossing" fails with `expected '1700000000 pool-a claude-b' to be null`.
- Delete the account clause from `_crosspool_valid`'s call here (pass only `$cur`) → **red**: "`prefer --cross-pool` survives the re-seed" (Task 6) fails, because a prefer crossing lives on `home`.
- Keep the marker but drop the log line → **red**: "a retag ENDS the crossing" fails on `expected '…' to contain 'crosspool-ended claude-demo: project pool is now named pool-b'`.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-crosspool.test.ts` with the header and the fixtures the rest of this wave's manual-verb cases also use (Tasks 5 and 6 append to this file):

```ts
/**
 * `--cross-pool` — the deliberate crossing, and the marker that makes it stick
 * (spec §5.7, ruling 8).
 *
 * Without the marker the design undoes every crossing within one 5-second
 * tick: the re-seed rewrites `.home`, `_swap_target`'s `force=pool` treats the
 * crossed account as a must-leave, and the affinity arm moves the session back
 * at the next idle boundary. `prefer --cross-pool` would be a no-op.
 *
 * FIXTURE HOME ONLY (`makeCcdHarness`). systemd and tmux log instead of
 * acting; `sleep` is stubbed because cmd_swap's flush wait is a second of real
 * time per case. TMUX is emptied at the call site so the detached self-swap
 * branch is never taken from a suite that may itself be running inside tmux —
 * except in the two cases that are ABOUT that branch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { eventsOf, measOf, decOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-crosspool-');
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
});
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const ID = 'claude-demo';
const PANE_PID = '4242';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const logLines = (verb: string): string[] =>
  swapLog().split('\n').filter((l) => l.includes(` ${verb} `));
const notices = (): string =>
  fs.existsSync(path.join(h.home, 'notify-log'))
    ? fs.readFileSync(path.join(h.home, 'notify-log'), 'utf8') : '';
const noticeLines = (): string[] => notices().split('\n').filter(Boolean);

const plantNotify = (): void => {
  fs.writeFileSync(reg('notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const tagPool = (project: string, pool: string): void => {
  fs.mkdirSync(reg('pools'), { recursive: true });
  fs.writeFileSync(path.join(reg('pools'), project), pool);
};
const writeLimits = (w: string, five: number, seven: number): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));
};

const SWAP_STUBS = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 0; }; sleep() { :; };';

/** The registry row cmd_swap reads. Returns `mdir` — the munge of the resolved
 *  workdir, computed here exactly as ccd's `tr '/._' '---'` computes it. */
const seedRow = (wrapper = 'claude'): string => {
  const wd = path.join(h.home, 'projects', 'demo');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}
    _reg_set ${ID} wrapper ${wrapper}
    _reg_set ${ID} home ${wrapper}
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir ${wd}
    _reg_set ${ID} started 1`);
  return fs.realpathSync(wd).replace(/[/._]/g, '-');
};

const plant = (cfg: string, pdir: string, body: string): void => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), body);
};

const shFail = (snippet: string, env: NodeJS.ProcessEnv = {}):
{ code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

/** The tick, with `_swap_target` and `_auto_swap_check` REAL. */
const BLOCKED = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;
const QUIET = `
  tmux() { case "\${1:-}" in
             capture-pane) printf '%s\\n' "❯ " ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;
const tick = (stubs: string, n = 1): string =>
  h.sh(`${stubs} for ((i=0;i<${n};i++)); do _auto_swap_check ${ID}; done`);

/** A landed crossing, written the way `cmd_swap --cross-pool` writes it, so
 *  the marker cases do not depend on Task 5's verb changes. `lastswap` is
 *  removed because a real crossing stamps it and every gate below would then
 *  close before the tick reached anything worth measuring. */
const crossed = (pool: string, acct: string): void => {
  h.sh(`_reg_set ${ID} crosspool "$(date +%s) ${pool} ${acct}"; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
};

describe('the crossing marker expires', () => {
  it('survives ten ticks while the project pool and the account both hold', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);       // crossed onto pool-b
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 99, 99);                 // home is at the ceiling: no return-home
    writeLimits('claude-b', 5, 5);
    tick(QUIET, 10);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    expect(h.reg(ID, 'home')).toBe('claude');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
    expect(h.calls().join('\n'), 'the pool machinery left the row alone').not.toContain('dispatch');
  });

  it('a RETAG ends it, and swap.log says why', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    writeLimits('claude-b', 5, 5);
    tagPool('demo', 'pool-b');                     // the operator changed their mind
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: project pool is now named pool-b`);
  });

  it('an UNTAG ends it too', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    fs.rmSync(path.join(reg('pools'), 'demo'));
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: project pool is now untagged`);
  });

  it('an automatic RESCUE lands IN POOL, and the move itself ends the crossing', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 99, 99);                 // home at the ceiling, so no return-home
    writeLimits('claude-a', 5, 5);
    tick(BLOCKED);
    expect(h.calls().join('\n'), 'automatic moves never cross').toContain(`dispatch ${ID} -> claude-a`);
    // The landing is what ends it. `_dispatch_swap` is a stub here, so do what
    // the dispatched `cmd_swap` would have done to the row.
    h.sh(`_reg_set ${ID} wrapper claude-a; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
    tick(BLOCKED);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: moved off claude-b`);
  });
});
```

- [ ] **Step 2: Run it and read the failure**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-crosspool.test.ts`
Expected: FAIL — the first case passes (Task 2's `_crosspool_valid` already exempts the row), the other three fail with `expected '<epoch> pool-a claude-b' to be null`, because nothing removes an invalid marker yet.

- [ ] **Step 3: Write `_crosspool_tick` and swap the tick's call**

In `ccd/ccd`, immediately after `_crosspool_valid`'s closing `}`, insert:

```bash
_crosspool_tick() {   # id wrapper home pool-state -> 0 iff a valid crossing stands; else END it
  # THE MARKER MUST EXPIRE, or a stale crossing is indistinguishable from a
  # live one and the pool machinery stays switched off on that row for ever.
  # Evaluated once per tick, BEFORE the re-seed consults it. The reason names
  # which of the two clauses failed, because the remedies differ: a retag is
  # the operator's own newer instruction, a move off the account is the
  # affinity arm doing what §2's ruling-8 interpretation says it should.
  local id="$1" cur="$2" home="$3" pps="$4" raw ts pool acct reason
  [[ -e "$REG/$id.crosspool" ]] || return 1
  _crosspool_valid "$id" "$pps" "$cur" "$home" && return 0
  raw=$(_reg_get "$id" crosspool)
  read -r ts pool acct <<<"$raw" || :
  if [[ "$pps" != "named ${pool:-}" ]]; then
    reason="project pool is now $pps"
  else
    reason="moved off ${acct:-<unrecorded>}"
  fi
  rm -f -- "$REG/$id.crosspool"
  echo "$(date '+%F %T') crosspool-ended $id: $reason" >> "$REG/swap.log"
  return 1
}
```

In `_auto_swap_check`, replace the line Task 3 added:

```bash
  _crosspool_valid "$id" "$pps" "$wrapper" "$home" && crossed=1
```

with:

```bash
  _crosspool_tick "$id" "$wrapper" "$home" "$pps" && crossed=1
```

`_swap_target` keeps calling `_crosspool_valid` and never `_crosspool_tick`: the tick is the one place allowed to remove the marker, and `_swap_target` is also called directly by tests and by a future caller that must not have a side effect.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-crosspool.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add ccd/ccd server/test/ccd-crosspool.test.ts
git commit -m "feat(ccd): a crossing lasts until the project is retagged or the session moves, and the log says which"
```

---

### Task 5: `cmd_swap` — the guard, the flag, the detached retry, the success tail, and `CCD_SWAP_AUTO`

**Files:**
- Modify: `ccd/ccd:10986-11003` (`_dispatch_swap`'s unit environment), `ccd/ccd:12964-12990` (the flag loop and the guard slot), `ccd/ccd:13013-13015` (the detach arm), `ccd/ccd:13138-13142` (the success tail).
- Modify: `ccd/ccd` — one more helper beside `_crosspool_tick`.
- Test: `server/test/ccd-crosspool.test.ts` (Modify)

**Interfaces:**
- Consumes: `_project_pool_state`, `_pool_ok`, `_acct_pool`, `POOLS_DIR` (wave 2a); `_crosspool_valid` (Task 2); `_strand_mark`, `_strand_clear` (Task 1); `_svc_run_detached` (`ccd/ccd:742`), `_lc_done` (`ccd/ccd:2305`).
- Produces: `_crosspool_mark <id> <project-pool> <account>` → writes `$REG/<id>.crosspool` = `"<epoch> <project-pool> <account>"` through `_reg_set`. `cmd_swap [--force] [--cross-pool] <id> <target>` — the flag is stripped anywhere in argv, rides the detached retry, and is journalled as `dec.crosspool 1`. `_dispatch_swap <id> <target>` sets `CCD_SWAP_AUTO=1` in the transient unit's `bash -c` environment.

**Spec:** §5.5.5 (`cmd_swap`), §5.7.1, §5.7.2 (the write site), §5.8.2 (the clear site), §5.8.4 (the whole of it), §14 O6.

**Mutation table:** rows 37 (the success-tail clear), 41, 42, 45.
- Move the guard below the detach arm (i.e. after `ccd/ccd:13020`'s `fi`) → **red**: "refuses BEFORE the detach arm" fails, because `h.calls()` now contains a `systemd-run` line and the die never reaches the caller's stderr.
- Drop `${cross:+--cross-pool}` from the detach arm → **red**: "the detached retry keeps the operator's decision" fails with `expected '…swap …' to contain '--cross-pool'`.
- Log the `cross-pool` line at the guard instead of at the success tail → **red**: "one `cross-pool` line" fails with `expected [ …, … ] to have a length of 1` on the self-swap path, which runs the guard twice.
- Change the guard's `-z "$cross"` to `-z "$force"` → **red**: "`--force` is NOT the override" passes a swap that must die.
- Remove `_strand_mark` from the guard, or drop `CCD_SWAP_AUTO=1` from `_dispatch_swap` → **red**: "the deploy window" fails with `expected null to match /^\d{10} /`.
- Delete `_strand_clear "$id"` from the success tail → **red**: "a landed swap clears the strand".
- Change `dec.crosspool` to `meas.crosspool` → **red**: "`dec.crosspool 1` on the lifecycle row" fails with `expected undefined to be '1'`.

`LEDGER: _dispatch_swap runs the ON-DISK ccd while the supervisor that chose the target keeps the pre-deploy inode, so between install_atomic and the unit sweep an old pool-blind _swap_target picks a wrong-pool account every SWAP_COOLDOWN and the new cmd_swap in the unit refuses it with no marker, no banner and no cleared stamp — for as long as that supervisor lives, which deploy.sh says can be days; CCD_SWAP_AUTO=1 plus _strand_mark in the guard is what makes that window audible (D-1676 — spec §12 P-14).`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-crosspool.test.ts`:

```ts
/** The self-swap fixture: `tmux display-message` answers with this session's
 *  own name and TMUX is set, so `cmd_swap` takes the detach arm. The SEAM is
 *  shadowed rather than the tool — `_svc_run_detached` is what ccd calls, and
 *  only its Linux arm is systemd-run. */
const SELF = `
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };
  tmux() { case "\${1:-}" in display-message) echo "cc-${ID}";; esac;
    echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };
  _svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };
`;

describe('cmd_swap refuses a crossing that was not asked for', () => {
  it('dies BEFORE the detach arm — synchronously, with nothing dispatched', () => {
    // The guard slot matters: below the detach arm this refusal would happen in
    // a process nobody is waiting for, and the PWA's 502 would carry nothing.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    const r = shFail(`${SELF} cmd_swap ${ID} claude-b`, { TMUX: '/tmp/x,1,0' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(
      "pool-mismatch: claude-b is in pool 'pool-b' and project 'demo' is in pool 'pool-a'");
    expect(r.stderr).toContain(`ccd swap --cross-pool ${ID} claude-b`);
    expect(h.calls().join('\n'), 'the detach arm was never reached').not.toContain('detached');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });

  it('`--force` is NOT the override — it means transcript loss and nothing else', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    const r = shFail(`${SWAP_STUBS} cmd_swap --force ${ID} claude-b`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('pool-mismatch: claude-b is in pool');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });

  it('refuses on an UNDECIDABLE tag even with the flag — nobody decides, so nobody crosses', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'Pool Orate');
    const r = shFail(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(
      `pool tag for demo is malformed: ${h.home}/.cc-sessions/pools/demo`);
    expect(r.stderr).toContain('nothing was touched');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });
});

describe('cmd_swap crosses on purpose', () => {
  it('writes the marker, ONE `cross-pool` line and `dec.crosspool 1`', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    expect(h.sh(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '' }))
      .toContain(`swapped ${ID}: claude -> claude-b`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
    expect(logLines('cross-pool')).toHaveLength(1);
    expect(swapLog()).toContain(
      `cross-pool ${ID}: claude -> claude-b [project=demo pool=pool-a target-pool=pool-b]`);
    const rows = eventsOf(h.home, 'swap');
    expect(rows).toHaveLength(1);
    expect(decOf(rows[0]!)['crosspool']).toBe('1');
    expect(measOf(rows[0]!)).toMatchObject({ from: 'claude', wrapper: 'claude-b' });
  });

  it('writes NO marker and no crossing flag for an ordinary in-pool swap', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-a`, { TMUX: '' });
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(logLines('cross-pool')).toHaveLength(0);
    expect(decOf(eventsOf(h.home, 'swap')[0]!)['crosspool']).toBeUndefined();
  });

  it('the detached retry keeps the operator`s decision — the flag rides the unit argv', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    h.sh(`${SELF} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '/tmp/x,1,0' });
    const argv = h.calls().filter((c) => c.startsWith('detached ')).join('\n');
    expect(argv, 'the detach really happened').toContain(`swap`);
    expect(argv).toContain('--cross-pool');
    // Logged ONCE, at the success tail: this arm re-execs and runs the guard a
    // second time, so a line written at the guard would be written twice.
    expect(logLines('cross-pool')).toHaveLength(0);
  });

  it('a landed swap CLEARS a standing strand', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n');
    h.sh(`_reg_set ${ID} stranded "1700000000 no candidate"`);
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-a`, { TMUX: '' });
    expect(h.reg(ID, 'stranded')).toBeNull();
    expect(logLines('unstranded')).toHaveLength(1);
  });
});

describe('the deploy window (§5.8.4)', () => {
  it('an old supervisor`s pool-blind choice is refused LOUDLY inside the unit', () => {
    // The pre-deploy inode is modelled by stubbing `_swap_target` to the
    // pool-blind answer it used to give; `_dispatch_swap` runs the NEW
    // `cmd_swap` in-process with the environment the real one sets.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n');
    tagPool('demo', 'pool-a'); plantNotify();
    const OLD_SUPERVISOR = `
      systemctl() { :; }; launchctl() { :; }; sleep() { :; };
      tmux() { case "\${1:-}" in capture-pane) echo "API Error: 429 Too Many Requests";; esac; return 0; };
      _swap_target() { echo claude-b; };
      # A SUBSHELL, because that is what the real one is: _dispatch_swap runs
      # cmd_swap in a transient systemd unit, and cmd_swap's guard reaches
      # \`die\` (echo + exit 1). In-process that would exit the whole test shell.
      _dispatch_swap() { ( CCD_SWAP_AUTO=1 cmd_swap "$1" "$2" ) >/dev/null 2>&1 || true; };`;
    h.sh(`${OLD_SUPERVISOR} _auto_swap_check ${ID}`);
    expect(h.reg(ID, 'wrapper'), 'nothing moved').toBe('claude');
    expect(h.reg(ID, 'stranded')).toMatch(/^\d{10} /);
    expect(noticeLines()).toHaveLength(1);
    expect(noticeLines()[0]).toContain(`cc swap STRANDED: ${ID} is blocked on claude`);
    expect(h.reg(ID, 'lastswap'),
      'the stamp stays: retracting it would re-dispatch the same choice every 5 s')
      .toMatch(/^\d{10}$/);
  });

  it('_dispatch_swap really sets CCD_SWAP_AUTO in the unit it launches', () => {
    seedRow();
    h.sh('_svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };'
      + ` _dispatch_swap ${ID} claude-a`);
    const argv = h.calls().filter((c) => c.startsWith('detached ')).join('\n');
    expect(argv).toContain('CCD_SWAP_AUTO=1');
  });
});
```

- [ ] **Step 2: Run it and read the failure**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-crosspool.test.ts`
Expected: FAIL — 8 of the 9 new cases fail (the ninth, "writes NO marker … for an ordinary in-pool swap", passes vacuously before the change). Representative texts: `expected '' to contain "pool-mismatch: claude-b is in pool 'pool-b'…"` (no guard yet), `expected null to match /^\d{10} pool-a claude-b$/` (no marker), `expected [] to have a length of 1` (no `cross-pool` line), `expected undefined to be '1'` (no `dec.crosspool`), `expected '…' to contain '--cross-pool'` (detach arm), `expected null to match /^\d{10} /` (no in-unit strand), `expected '…' to contain 'CCD_SWAP_AUTO=1'`. The four Task 4 cases stay green.

- [ ] **Step 3: Write `_crosspool_mark`**

In `ccd/ccd`, immediately after `_crosspool_tick`'s closing `}`, insert:

```bash
_crosspool_mark() {   # id project-pool account — record a DELIBERATE crossing
  # One dot-free registry field, so `_reg_purge`'s one-dot rule (ccd:1294)
  # purges it with the row. Three writers — cmd_swap's success tail,
  # cmd_start's creating form and cmd_prefer — one spelling.
  _reg_set "$1" crosspool "$(date +%s) $2 $3"
}
```

- [ ] **Step 4: Set `CCD_SWAP_AUTO=1` in `_dispatch_swap`'s unit**

In `ccd/ccd`, replace `_dispatch_swap`'s `bash -c` line (currently `:11001`):

```bash
    bash -c "sleep $jitter; exec '$HOME/.local/bin/ccd' swap '$1' '$2' >>'$REG/swap.log' 2>&1" \
```

with:

```bash
    bash -c "sleep $jitter; CCD_SWAP_AUTO=1 exec '$HOME/.local/bin/ccd' swap '$1' '$2' >>'$REG/swap.log' 2>&1" \
```

and add above the `_svc_run_detached` call, inside the function's comment block:

```bash
  # CCD_SWAP_AUTO=1 SAYS WHO CHOSE THIS TARGET, and it exists for the deploy
  # window alone (§5.8.4). This function runs the ON-DISK ccd while the
  # supervisor that chose the target keeps the pre-deploy inode, so a pool-blind
  # `_swap_target` can hand a wrong-pool account to a pool-aware `cmd_swap`.
  # The refusal there must be LOUD — a marker and a banner — because nothing is
  # reading this unit's exit code. Set inside the `bash -c` string, dynamically
  # visible to the re-exec, exactly as CCD_SWAP_DETACHED is at ccd:13013.
```

- [ ] **Step 5: Write the flag loop, the guard, the detach arm and the success tail**

In `cmd_swap`, replace the flag loop's first line (currently `:12975`):

```bash
  local force="" args=()
```

with:

```bash
  local force="" cross="" args=()
```

and add the arm inside the `case` (after `--force)`):

```bash
      --cross-pool) cross=1; shift ;;
```

Extend the flag-loop comment above it with:

```bash
  # `--cross-pool` IS A SECOND, SEPARATE TOKEN and never an alias of --force.
  # --force means "accept transcript loss"; overloading it would make a
  # transcript-loss acceptance also a pool crossing, or the reverse. Stripped
  # here so it can never land in $1 or $2, and rejected by _is_valid_wrapper as
  # a second lock on the target slot.
```

Then, immediately after the `wrapper missing` check (currently `:12990`) and **before** the detach arm's `if` (currently `:12997`), insert:

```bash
  # ── POOL POLICY (§5.5.5) ─────────────────────────────────────────────────
  # HERE, above the detach arm, so this dies SYNCHRONOUSLY: the PWA gets a 502
  # carrying this sentence, a shell gets stderr, and the transient unit's
  # stderr lands in swap.log. Below the detach arm it would refuse in a process
  # nobody is waiting for.
  local project pps prc crossing=""
  project=$(_reg_get "$id" project); pps=$(_project_pool_state "$project")
  _pool_ok "$target" "$pps"; prc=$?
  # UNDECIDABLE REFUSES EVEN WITH THE FLAG. `--cross-pool` says "cross from
  # pool X to pool Y on purpose"; when the tag cannot be read there is no X to
  # name, so there is no decision to override.
  [[ "$prc" -eq 2 ]] \
    && die "pool tag for $project is $pps: $POOLS_DIR/$project — fix or clear it; nothing was touched"
  if [[ "$prc" -eq 1 ]]; then
    if _crosspool_valid "$id" "$pps" "$target"; then
      : # the operator already crossed to this account and the crossing stands
    elif [[ -n "$cross" ]]; then
      crossing=1
    else
      # §5.8.4: inside `_dispatch_swap`'s transient unit nobody reads this exit
      # code, and an old supervisor will repeat the same choice every
      # SWAP_COOLDOWN. Mark and banner (both floor-debounced) so the deploy
      # window is audible instead of being a silent strand for days.
      [[ "${CCD_SWAP_AUTO:-}" == 1 ]] && _strand_mark "$id" "$cur" "$project"
      die "pool-mismatch: $target is in pool '$(_acct_pool "$target")' and project '$project' is in pool '${pps#named }' — to cross on purpose: ccd swap --cross-pool $id $target"
    fi
  fi
```

In the detach arm, replace the two lines (currently `:13013` and `:13015`):

```bash
    if ! _svc_run_detached bash -c "sleep 2; CCD_SWAP_DETACHED=1 exec '$HOME/.local/bin/ccd' swap ${force:+--force} '$id' '$target' >>'$REG/swap.log' 2>&1"; then
```
```bash
      echo "ccd: could not detach the swap of $id ($cur -> $target): systemd-run failed. Nothing was moved and this session is untouched — retry from OUTSIDE the session: ccd swap ${force:+--force }$id $target" >&2
```

with:

```bash
    if ! _svc_run_detached bash -c "sleep 2; CCD_SWAP_DETACHED=1 exec '$HOME/.local/bin/ccd' swap ${force:+--force} ${cross:+--cross-pool} '$id' '$target' >>'$REG/swap.log' 2>&1"; then
```
```bash
      echo "ccd: could not detach the swap of $id ($cur -> $target): systemd-run failed. Nothing was moved and this session is untouched — retry from OUTSIDE the session: ccd swap ${force:+--force }${cross:+--cross-pool }$id $target" >&2
```

Finally the success tail. Replace the block currently at `:13138-13142`:

```bash
  _lc_done swap "$id" "" meas.from "$cur" meas.wrapper "$target" meas.uuid "$uuid"
  rm -f "$REG/$id.swapblocked"   # a completed swap supersedes an earlier refusal: a
                                 # banner left standing on a row that just worked teaches
                                 # the operator to ignore banners.
  echo "$(date '+%F %T') swap $id: $cur -> $target (uuid $uuid)" >> "$REG/swap.log"
```

with:

```bash
  # `dec.*`, not `meas.*` (§14 O6): the dec namespace is for a DECLARED
  # operator choice, and a crossing is declared — the flag is the declaration.
  # The array form is the `cmd_ws_add` idiom (ccd:3876): an empty array under
  # `set -u` needs bash >= 4.4, which this file already requires.
  local lc_cross=()
  [[ -n "$crossing" ]] && lc_cross=(dec.crosspool 1)
  _lc_done swap "$id" "" meas.from "$cur" meas.wrapper "$target" meas.uuid "$uuid" "${lc_cross[@]}"
  rm -f "$REG/$id.swapblocked"   # a completed swap supersedes an earlier refusal: a
                                 # banner left standing on a row that just worked teaches
                                 # the operator to ignore banners.
  # …and it supersedes a STRAND for the same reason: "no account can take it"
  # is falsified by the session having just moved.
  _strand_clear "$id"
  # ONCE, AT THE TAIL. The guard above runs a SECOND time when the swap
  # re-execs itself detached, so a line written there would tell the operator
  # they crossed twice.
  if [[ -n "$crossing" ]]; then
    _crosspool_mark "$id" "${pps#named }" "$target"
    echo "$(date '+%F %T') cross-pool $id: $cur -> $target [project=$project pool=${pps#named } target-pool=$(_acct_pool "$target")]" >> "$REG/swap.log"
  fi
  echo "$(date '+%F %T') swap $id: $cur -> $target (uuid $uuid)" >> "$REG/swap.log"
```

`cmd_swap_self` (`ccd/ccd:13152`) is deliberately unchanged: it forwards no flags, so it cannot cross by accident.

- [ ] **Step 6: Run the suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-crosspool.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 7: Prove the untouched swap behaviour is untouched**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-lifecycle-emit.test.ts test/ccd-lifecycle-sites.test.ts test/ccd-die-containment.test.ts test/ccd-refusal-scan.test.ts test/wsaudit.test.ts`
Expected: PASS. `ccd-swap.test.ts` drives the detach arm at both `systemd-run` exit codes and the whole carry against an untagged fixture, where the guard's `_pool_ok` answers 0 and nothing changes.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-crosspool.test.ts
git commit -m "feat(ccd): a manual swap refuses a crossing nobody asked for, and the deploy window says so out loud"
```

---

### Task 6: `cmd_start`, `cmd_enable`, `cmd_prefer`, `cmd_ensure`

**Files:**
- Modify: `ccd/ccd:12123-12136` (the flag loop), `ccd/ccd:12186` (the guard slot), `ccd/ccd:12215` (the marker), `ccd/ccd:12222` (the revival clear), `ccd/ccd:12324-12326` (`cmd_ensure`'s two-guard block), `ccd/ccd:13161-13168` (`cmd_prefer`), `ccd/ccd:13170-13190` (`cmd_enable`).
- Test: `server/test/ccd-crosspool.test.ts` (Modify)

**Interfaces:**
- Consumes: `_project_pool_state`, `_pool_ok`, `_acct_pool`, `POOLS_DIR` (wave 2a); `_crosspool_mark` (Task 5); `_strand_clear` (Task 1); `rehome` in `_LC_ACTS` (wave 2a); `_id` (`ccd/ccd:1091`), `_home_for` (`ccd/ccd:11097`), `_ws_seed_home` (`ccd/ccd:1449`).
- Produces: `cmd_start [--cross-pool] …`, `cmd_enable [--cross-pool] …`, `cmd_prefer [--cross-pool] <id> <wrapper>` — each strips the flag anywhere in argv. `cmd_prefer` journals `_lc_done rehome "$id" "" meas.from <old> meas.home <w> meas.reason prefer [dec.crosspool 1]`. `cmd_ensure` clears `.stranded` inside the existing two-guard block.

**Spec:** §5.5.5 (`cmd_start`, `cmd_enable`, `cmd_prefer`, `cmd_ensure`), §5.7.2 (two more write sites), §5.8.2 (two more clear sites), §12 P-2 (D-1677), P-17 (D-1678).

**Mutation table:** rows 37 (`cmd_start` revival, `cmd_ensure`, the `CCD_IN_UNIT` case), 43, 44 (the `prefer` crossing survives the re-seed).
- Move `cmd_start`'s guard above the registry-wins block (`ccd/ccd:12160`) → **red**: "warns rather than refusing on a REVIVAL" fails with a non-zero exit, because `wrapper` there is still the argument the registry is about to overwrite.
- Drop `-z "$regw"` from the guard → same red.
- Move `cmd_enable`'s strip below `id=$(_id "$1" "$2")` → **red**: "journals for the real id" fails with `expected '--cross-pool-claude' to be 'claude-b-demo'`.
- Delete `cmd_prefer`'s `_lc_done rehome …` line → **red**: "`prefer` journals a rehome" fails with `expected [] to have a length of 1`.
- Move `_strand_clear "$id"` in `cmd_ensure` outside the `[[ "${CCD_IN_UNIT:-}" != 1 && … ]]` block → **red**: "a supervisor re-entering its own unit keeps the strand" fails with `expected null not to be null`.
- Delete `_strand_clear "$id"` from `cmd_start`'s revival → **red**: "a revival clears the strand".

`LEDGER: cmd_prefer is the only unconditional writer of a session's .home in the file and it wrote nothing to the lifecycle journal, so the one account decision an operator makes by hand was the one decision the record could not show; it now journals rehome with meas.reason prefer (D-1677 — spec §12 P-2).`

`LEDGER: cmd_ensure's strand clear belongs INSIDE the existing CCD_IN_UNIT / CCD_KEEP_SWAPBLOCK block, sharing swapblocked's argument verbatim — a supervisor re-entering its own unit is not a revival, and clearing there would re-mark and re-banner within one 5-second tick (D-1678 — spec §12 P-17).`

- [ ] **Step 1: Write the failing tests**

Append to `server/test/ccd-crosspool.test.ts`:

```ts
/** Everything `cmd_start`/`cmd_ensure` reach that must not leave the fixture.
 *  `_alive` is forced false: WS_ADD's `tmux() { :; }` returns 0 for
 *  `has-session`, which would send every case down the already-running no-op. */
const START_STUBS = `${WS_ADD} _alive() { return 1; }; _have_systemctl() { return 1; };`;

describe('cmd_start and the pool', () => {
  it('refuses to CREATE out of pool, and touches nothing', () => {
    tagPool('demo', 'pool-a');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const r = shFail(`${START_STUBS} cmd_start claude-b demo`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("pool-mismatch: claude-b is in pool 'pool-b'");
    expect(r.stderr).toContain('ccd start --cross-pool claude-b demo');
    expect(fs.existsSync(reg('claude-b-demo.uuid')), 'nothing was created').toBe(false);
  });

  it('WARNS rather than refusing on a REVIVAL — the registry already won the account', () => {
    // Ruling 5's auto path owns this move; refusing here would refuse to
    // restart a session the retag put in the wrong pool.
    tagPool('demo', 'pool-a');
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set claude-b-demo uuid ${UUID}
      _reg_set claude-b-demo wrapper claude-b
      _reg_set claude-b-demo project demo
      _reg_set claude-b-demo workdir ${wd}`);
    const r = shFail(`${START_STUBS} cmd_start claude-b demo`);
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("which is not in project 'demo''s pool 'pool-a'");
    expect(h.reg('claude-b-demo', 'wrapper')).toBe('claude-b');
  });

  it('creates WITH the flag, seeds the crossed home, and writes the marker', () => {
    tagPool('demo', 'pool-a');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    h.sh(`${START_STUBS} cmd_start --cross-pool claude-b demo`);
    expect(h.reg('claude-b-demo', 'wrapper')).toBe('claude-b');
    expect(h.reg('claude-b-demo', 'home')).toBe('claude-b');
    expect(h.reg('claude-b-demo', 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
  });

  it('a REVIVAL clears a standing strand', () => {
    seedRow();
    h.sh(`_reg_set ${ID} stranded "1700000000 no candidate"`);
    h.sh(`${START_STUBS} cmd_start ${ID}`);
    expect(h.reg(ID, 'stranded')).toBeNull();
  });
});

describe('cmd_enable strips the flag BEFORE it computes the id', () => {
  it('journals `enable` for `<wrapper>-<project>`, never for the flag', () => {
    tagPool('demo', 'pool-a');
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    h.sh(`${START_STUBS} cmd_enable --cross-pool claude-b demo`);
    const rows = eventsOf(h.home, 'enable');
    expect(rows).toHaveLength(1);
    expect(rows[0]!['id']).toBe('claude-b-demo');
    expect(h.reg('claude-b-demo', 'crosspool'), 'the flag reached cmd_start too')
      .toMatch(/^\d{10} pool-a claude-b$/);
  });
});

describe('cmd_prefer', () => {
  it('journals a `rehome` for the first time (D-1677)', () => {
    seedRow(); tagPool('demo', 'pool-a');
    expect(h.sh(`cmd_prefer ${ID} claude-a`)).toContain(`home for ${ID} set to claude-a`);
    expect(h.reg(ID, 'home')).toBe('claude-a');
    const rows = eventsOf(h.home, 'rehome');
    expect(rows).toHaveLength(1);
    expect(measOf(rows[0]!)).toMatchObject({ from: 'claude', home: 'claude-a', reason: 'prefer' });
    expect(decOf(rows[0]!)['crosspool'], 'nothing was crossed').toBeUndefined();
    expect(h.reg(ID, 'crosspool')).toBeNull();
  });

  it('refuses a crossing that was not asked for', () => {
    seedRow(); tagPool('demo', 'pool-a');
    const r = shFail(`cmd_prefer ${ID} claude-b`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('pool-mismatch: claude-b is in pool');
    expect(r.stderr).toContain(`ccd prefer --cross-pool ${ID} claude-b`);
    expect(h.reg(ID, 'home'), 'nothing was touched').toBe('claude');
  });

  it('`--cross-pool` moves the HOME, marks it, and the re-seed leaves it alone', () => {
    // Without the marker this is a no-op within 5 s: the re-seed would rewrite
    // `.home` back into pool-a on the very next tick.
    seedRow(); tagPool('demo', 'pool-a'); writeLimits('claude-a', 5, 5);
    h.sh(`cmd_prefer --cross-pool ${ID} claude-b`);
    expect(h.reg(ID, 'home')).toBe('claude-b');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
    expect(decOf(eventsOf(h.home, 'rehome')[0]!)['crosspool']).toBe('1');
    tick(QUIET, 10);
    expect(h.reg(ID, 'home'), 'the re-seed must not undo a deliberate crossing').toBe('claude-b');
    expect(eventsOf(h.home, 'rehome'), 'and it must not journal one either').toHaveLength(1);
  });
});

describe('cmd_ensure clears the strand only for a human act', () => {
  const strand = (): void => { h.sh(`_reg_set ${ID} stranded "1700000000 no candidate"`); };

  it('an operator `ccd ensure` clears it', () => {
    seedRow(); strand();
    h.sh(`${START_STUBS} cmd_ensure ${ID}`);
    expect(h.reg(ID, 'stranded')).toBeNull();
  });

  it('a supervisor re-entering its OWN unit keeps it', () => {
    // CCD_IN_UNIT is `cmd_supervise`'s own marker. Clearing there would erase
    // the marker `_auto_swap_check` wrote seconds earlier, in a different
    // process, and the next tick would re-mark and re-banner.
    seedRow(); strand();
    h.sh(`${START_STUBS} cmd_ensure ${ID}`, { CCD_IN_UNIT: '1' });
    expect(h.reg(ID, 'stranded')).not.toBeNull();
  });

  it('`_swap_refuse`s in-process fallback keeps it too — the second guard', () => {
    seedRow(); strand();
    h.sh(`${START_STUBS} CCD_KEEP_SWAPBLOCK=1 cmd_ensure ${ID}`);
    expect(h.reg(ID, 'stranded')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and read the failure**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-crosspool.test.ts`
Expected: FAIL — 9 of the 11 new cases fail (the two `cmd_ensure` "keeps it" cases pass vacuously before the change, because nothing clears `.stranded` there yet). Representative texts: `expected 0 not to be 0` (the creating form does not refuse), `expected '' to contain "which is not in project 'demo''s pool 'pool-a'"`, `expected null to match /^\d{10} pool-a claude-b$/` (no marker), `expected [] to have a length of 1` (`rehome` from `prefer`), `expected null not to be null` (`CCD_IN_UNIT` clear). The 12 cases from Tasks 4-5 stay green.

- [ ] **Step 3: `cmd_start` — the flag loop, the creation-only guard, the marker and the revival clear**

In `ccd/ccd`, insert at the very top of `cmd_start`'s body, above the `local id wrapper="" project="" workdir=""` line (currently `:12136`):

```bash
  # `--cross-pool` IS STRIPPED BEFORE THE ARITY RULE, exactly as `cmd_stop`
  # strips `--surface`: `$# -ge 2` is what distinguishes the creating form from
  # the id form, so a flag left in argv would make `ccd start --cross-pool <id>`
  # read as a creation and mint `--cross-pool-<id>`.
  local cross="" args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cross-pool) cross=1; shift ;;
      --)           shift; args+=("$@"); break ;;
      *)            args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"    # bash >= 4.4: an empty array here is not an unbound-
                         # variable error under `set -u`, as in cmd_swap.
```

The two `usage:` strings stay **byte-identical** — `ccd-start-id.test.ts:79` and `:151` pin them, and the flag is discovered through the `pool-mismatch` die's own remedy sentence, not through usage.

Then, immediately after the workdir block's last line (currently `:12186`, `[[ -d "$workdir" ]] || die "workdir missing: $workdir"`), insert:

```bash
  # ── POOL POLICY (§5.5.5), CREATION ONLY ──────────────────────────────────
  # Placed here rather than at ccd:12160 because `project` is only resolved on
  # BOTH forms by the block above; `regw` is what makes it creation-only, and
  # that is the whole correctness argument. With a registry row the registry's
  # account has already WON (ccd:12160) and `wrapper` is no longer the caller's
  # argument, so a refusal here would refuse a REVIVAL of a session a retag put
  # in the wrong pool — which ruling 5 moves at the next idle boundary instead.
  # At most a warning.
  local pps prc
  pps=$(_project_pool_state "$project")
  _pool_ok "$wrapper" "$pps"; prc=$?
  if [[ -z "$regw" ]]; then
    [[ "$prc" -eq 2 ]] \
      && die "pool tag for $project is $pps: $POOLS_DIR/$project — fix or clear it; nothing was touched"
    [[ "$prc" -eq 1 && -z "$cross" ]] \
      && die "pool-mismatch: $wrapper is in pool '$(_acct_pool "$wrapper")' and project '$project' is in pool '${pps#named }' — to cross on purpose: ccd start --cross-pool $wrapper $project"
  elif [[ "$prc" -eq 1 ]]; then
    echo "ccd: warn: $id lives on $wrapper, which is not in project '$project''s pool '${pps#named }' — the auto-swapper relocates it at the next idle boundary" >&2
  fi
```

Then, immediately after `_ws_seed_home "$id" "$wrapper"` (currently `:12215`), insert:

```bash
  # The crossing marker for a creating `--cross-pool`. `_ws_seed_home` above
  # already pinned home to this wrapper, so the marker's account clause is
  # satisfied by BOTH `wrapper` and `home` from the first tick onward.
  [[ "$prc" -eq 1 && -n "$cross" && -z "$regw" ]] && _crosspool_mark "$id" "${pps#named }" "$wrapper"
```

And immediately after the revival's `rm -f "$REG/$id.swapblocked"` (currently `:12222`), insert:

```bash
  # …and a stale strand, at the same altitude and for the same reason: `ccd
  # start <id>` is the human act §4.4 names as "what would bring this back".
  _strand_clear "$id"
```

- [ ] **Step 4: `cmd_ensure` — the clear, inside the two-guard block**

In `ccd/ccd`, replace the two-guard block (currently `:12324-12326`):

```bash
  if [[ "${CCD_IN_UNIT:-}" != 1 && "${CCD_KEEP_SWAPBLOCK:-}" != 1 ]]; then
    rm -f "$REG/$id.swapblocked"
  fi
```

with:

```bash
  if [[ "${CCD_IN_UNIT:-}" != 1 && "${CCD_KEEP_SWAPBLOCK:-}" != 1 ]]; then
    rm -f "$REG/$id.swapblocked"
    # THE STRAND SHARES `swapblocked`'s ARGUMENT VERBATIM, both guards
    # included. `_auto_swap_check` writes `.stranded` and, seconds later in a
    # DIFFERENT process, `cmd_supervise` re-enters this function — clearing
    # there would erase the marker and the next tick would re-mark and
    # re-banner. Outside this block it would also be erased by `_swap_refuse`'s
    # in-process `|| cmd_ensure` fallback.
    _strand_clear "$id"
  fi
```

- [ ] **Step 5: `cmd_prefer` — the flag, the guard, the marker and the journal**

In `ccd/ccd`, replace `cmd_prefer`'s body (currently `:13163-13167`) with:

```bash
  local cross="" args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cross-pool) cross=1; shift ;;
      --)           shift; args+=("$@"); break ;;
      *)            args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"
  local id="${1:?usage: ccd prefer <id> <wrapper>}" w="${2:?usage: ccd prefer <id> <wrapper>}"
  _is_valid_wrapper "$w" || die "unknown wrapper '$w' (valid: ${CCRC_ACCOUNTS[*]})"
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id'"
  # Shell-only: no whitelist entry and no CCD_ARGV builder, so no route can
  # reach this. The pool rule still applies — the auto-swapper would otherwise
  # re-seed this home away on the next tick and the operator would watch their
  # own choice evaporate.
  local project pps prc old
  project=$(_reg_get "$id" project); pps=$(_project_pool_state "$project")
  _pool_ok "$w" "$pps"; prc=$?
  [[ "$prc" -eq 2 ]] \
    && die "pool tag for $project is $pps: $POOLS_DIR/$project — fix or clear it; nothing was touched"
  [[ "$prc" -eq 1 && -z "$cross" ]] \
    && die "pool-mismatch: $w is in pool '$(_acct_pool "$w")' and project '$project' is in pool '${pps#named }' — to cross on purpose: ccd prefer --cross-pool $id $w"
  old=$(_home_for "$id")
  _reg_set "$id" home "$w"
  local lc_cross=()
  [[ "$prc" -eq 1 && -n "$cross" ]] \
    && { lc_cross=(dec.crosspool 1); _crosspool_mark "$id" "${pps#named }" "$w"; }
  # THE ONE UNCONDITIONAL `.home` WRITER IN THIS FILE, and until now the only
  # account decision that left no record at all — so the one move an operator
  # makes by hand was the one the journal could not show.
  _lc_done rehome "$id" "" meas.from "$old" meas.home "$w" meas.reason prefer "${lc_cross[@]}"
  echo "home for $id set to $w"
```

- [ ] **Step 6: `cmd_enable` — strip before `_id`**

In `ccd/ccd`, replace `cmd_enable`'s arity line and id line (currently `:13178` and `:13182`) and its `cmd_start` call (currently `:13188`) so the body reads:

```bash
  # STRIPPED BEFORE `_id`, and that ordering is the whole point: `_id "$1" "$2"`
  # on an unstripped argv mints `--cross-pool-<wrapper>` and this verb journals
  # `enable` against a session id that does not exist.
  local cross="" args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --cross-pool) cross=1; shift ;;
      --)           shift; args+=("$@"); break ;;
      *)            args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"
  [[ $# -ge 1 ]] || die "usage: ccd enable <id> | ccd enable <wrapper> <project> [workdir]"
  local id; if [[ $# -ge 2 ]]; then id=$(_id "$1" "$2"); else id="$1"; fi
  _lc_done enable "$id" ""
  cmd_start ${cross:+--cross-pool} "$@" || return $?
  echo "enabled boot-persistence for $id"
```

- [ ] **Step 7: Run the suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-crosspool.test.ts`
Expected: PASS — 24 tests.

- [ ] **Step 8: Prove the four verbs' existing contracts are untouched**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-start-id.test.ts test/ccd-session-lifecycle.test.ts test/ccd-lifecycle-sites.test.ts test/ccd-swap-refuse.test.ts test/ccd-reg-claim.test.ts`
Expected: PASS. `ccd-start-id.test.ts` pins both usage strings verbatim; `ccd-swap-refuse.test.ts` drives `_swap_refuse`'s `CCD_KEEP_SWAPBLOCK` fallback through the real `cmd_ensure`.

- [ ] **Step 9: Commit**

```bash
git add ccd/ccd server/test/ccd-crosspool.test.ts
git commit -m "feat(ccd): start, enable and prefer honour the pool, and prefer finally says what it did"
```

---

### Task 7: the registry field inventory, and the hold rung measured in place

**Files:**
- Modify: `ccd/ccd:1315-1320` (`_reg_purge`'s dot-free inventory comment).
- Test: `server/test/ccd-auto-swap-pool.test.ts` (Modify)

**Interfaces:**
- Consumes: `CCD` (`server/test/ccdWsHelpers.ts`).
- Produces: nothing new — this task makes an existing document honest and gives it a mechanism.

**Spec:** §9 (the three per-id fields need no manifest entry of their own because they are registry fields under the one-dot rule and purge with the row — but the inventory that states the rule must name them).

**Mutation table:** this task's own row, and a re-measurement of §11's hold assertions.
- Delete `crosspool`, `stranded` or `strandnotify` from the inventory comment → **red**: "the registry field inventory names the three fields this wave adds" fails naming the missing one.
- `ccd-auto-swap-hold.test.ts` is re-run unchanged: its five cases are the standing proof that the hold rung is still below the rescue arm and above the affinity arm after four tasks of edits inside `_auto_swap_check`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/ccd-auto-swap-pool.test.ts`:

```ts
describe('_reg_purge`s dot-free inventory', () => {
  it('names the three per-id fields this build adds', () => {
    // `_reg_purge` matches the SUFFIX SHAPE, not a list, so the purge itself is
    // already right — but ccd's own comment says an inventory that omits files
    // is one a future reader trusts and a future writer copies. These three are
    // registry fields under the one-dot rule and purge with the row; that is
    // exactly why they need no lifecycle-manifest entry of their own, and this
    // is the only place that claim is written down.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('The dot-free claim, measured against every registry file');
    expect(from, 'the inventory comment could not be found').toBeGreaterThan(-1);
    const block = src.slice(from, from + 1400);
    for (const f of ['`crosspool`', '`stranded`', '`strandnotify`']) {
      expect(block, `${f} is written by this build and missing from the inventory`).toContain(f);
    }
  });
});
```

- [ ] **Step 2: Run it and read the failure**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts -t 'dot-free inventory'`
Expected: FAIL — ``expected '…' to contain '`crosspool`'``.

- [ ] **Step 3: Update the inventory comment**

In `ccd/ccd`, replace the five comment lines currently at `:1315-1320`:

```bash
  # The dot-free claim, measured against every registry file a session has
  # today: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
  # `hold`, `home`, `hookstate`, `lastcompact`, `lastswap`, `pool`,
  # `prcheckedat`, `prhistory`, `prnumber`, `prphase`, `project`, `rc`,
  # `reaping`, `setup`, `spawn`, `started`, `stopped`, `substrate`, `supervised`,
  # `swapblocked`, `uuid`, `workdir`, `workspace`, `wrapper`. That is a WIDER
```

with:

```bash
  # The dot-free claim, measured against every registry file a session has
  # today: `archived`, `archivedreason`, `archivemanifest`, `base`, `branch`,
  # `crosspool`, `hold`, `home`, `hookstate`, `lastcompact`, `lastswap`,
  # `pool`, `prcheckedat`, `prhistory`, `prnumber`, `prphase`, `project`, `rc`,
  # `reaping`, `setup`, `spawn`, `started`, `stopped`, `stranded`,
  # `strandnotify`, `substrate`, `supervised`, `swapblocked`, `uuid`,
  # `workdir`, `workspace`, `wrapper`. Note that `pool` here is the per-session
  # CANDIDATE LIST `_pool_for` reads (ccd:10984) and NOT an account pool name —
  # two meanings of one word in one file, disclosed rather than renamed. That is a WIDER
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-pool.test.ts`
Expected: PASS — 30 tests.

- [ ] **Step 5: Re-measure the hold rung, in isolation**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-hold.test.ts`
Expected: PASS — 5 tests, unchanged and unedited. Their subject is where `[[ -e "$REG/$id.hold" ]] && return 0` sits relative to the rescue arm, and four tasks of this wave edited the function around it. If any of the five is red, the rung moved and the fix is to put it back — never to edit that file.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-auto-swap-pool.test.ts
git commit -m "docs(ccd): the registry inventory names the three fields the pool build writes, and says which `pool` it means"
```

---

### Task 8: Whole-branch gate, and the agent-first deploy order

**Files:**
- Modify: none. This task runs suites and states the order in which the finished branch reaches the fleet.

**Interfaces:**
- Consumes: everything Tasks 1-7 produced.
- Produces: a measured green branch, and the deploy order the operator or the coordinator follows.

**Spec:** §5.11 (version skew and deploy order), §15 (rollout).

**Mutation table:** none of its own. This task is where every earlier task's red-before/green-after is re-measured against the whole tree rather than one file.

- [ ] **Step 1: Run the full server suite in the foreground**

Run: `cd server && npm run test`
Expected: PASS. Timeout at least 600000 ms; do not background it — backgrounding hides a hang and these suites are load-sensitive.

Known load flakes, to be re-run **in isolation** before calling any of them a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. A flake that passes in isolation is a flake.

- [ ] **Step 2: Run the agent and pwa suites**

Run: `cd agent && npm run test`
Run: `cd pwa && npm run test`
Expected: PASS in both. Neither package is touched by this wave; they are run so the branch is green as a whole rather than green in one package.

- [ ] **Step 3: Type-check**

Run: `cd server && npm run build`
Expected: exit 0, no `tsc` diagnostics. (`server/test/typecheck-tests.test.ts`, inside `npm run test` above, is what type-checks the two new test files.)

- [ ] **Step 4: Check the branch's deviation numbers against `origin/main` without merging**

Run: `git fetch origin main`
Run: `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts`
Expected: PASS. This compares this branch's `D-N` entries against `origin/main`'s and reds on any allocator-era number defined in two plans — the parallel-branch collision, measured before the merge that would otherwise decide it rather than named afterwards.

- [ ] **Step 5: Run the three tree-wide scans**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/dtbd.test.ts`
Expected: PASS. `single-definition` reds on a second copy of a single-sourced value; `topology-clean` reds on a real operator account, pool, host or IP anywhere in the tree, this plan included; `dtbd` reds on a written-but-unissued deviation placeholder.

- [ ] **Step 6: Re-run the six suites that share `_auto_swap_check`, `cmd_swap` and `cmd_start`, in isolation**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-auto-swap-hold.test.ts test/ccd-auto-swap-pool.test.ts test/ccd-crosspool.test.ts test/ccd-swap.test.ts test/ccd-swap-refuse.test.ts test/ccd-account-ok.test.ts test/ccd-start-id.test.ts test/ccd-arith-containment.test.ts`
Expected: PASS. These are the suites whose subjects this wave edited around; running them together and alone is what separates a real break from the load flakes in Step 1.

- [ ] **Step 7: State the deploy order — AGENT-FIRST (do NOT run it here)**

Its `ccd/` changes are agent-first (Global Constraint #5: `bash deploy/deploy.sh agent` before `bash deploy/deploy.sh`) — but this wave does not change `ccd/` only (D-1890): the branch also carries `shared/api.ts`, `server/src/coord/journalparse.ts`, five `server/test` files and two `pwa/test` files, landed to fix the meas/dec key gaps Tasks 3 and 6's own emissions opened. Whether that changes the actual deploy order for this merge is the coordinator's call to make at merge time, never this plan's implementer's — no step below is run from this branch.

The order, exactly as the repo does it (README "Deploy"):

```bash
bash deploy/deploy.sh agent    # the fleet host: rsync -> ship ccd + notify.sh (backed up)
                               # + session-hook.sh -> host npm ci + build -> restart the unit
bash deploy/deploy.sh          # the server box: build the PWA here (freshness-gated) -> rsync
                               # -> box npm ci + build -> restart the unit -> health check
```

Coordinates come from `~/.ccrc/deploy.env` (`CCRC_BOX`, `CCRC_SSH_KEY`, `CCRC_SSH_PORT`, `CCRC_AGENT_BOX`) — machine-local, outside every checkout. **No host argument is needed on this fleet**; the agent lane takes its box from `CCRC_AGENT_BOX` and **never** falls back to `$CCRC_BOX`, which on a two-box fleet is the *server* box. `deploy.sh` has no default target and refuses with exit 2 rather than guessing.

The server lane's gate is `/health` reporting the shipped sha: "The post-deploy health check derives its URL from the box itself — an exposed box is probed through its public origin, a plain one at `http://<host>:7788/health`" (README "Deploy").

Two things about this wave in particular:

1. **`deploy.sh`'s supervisor sweep matters here more than usual.** Between `install_atomic` and the `try-restart claude-session@*` sweep (behind its mandatory `KillMode=process` preflight), each running supervisor's `_auto_swap_check` is the **old** inode while `_dispatch_swap`'s transient unit runs the **new** `ccd`. That window is exactly what `CCD_SWAP_AUTO=1` and `_strand_mark` in `cmd_swap`'s guard exist for (Task 5): an old supervisor's pool-blind choice is refused with a marker and a banner instead of silently, every `SWAP_COOLDOWN`, for as long as that unit lives. Do not hand-`install_atomic` this build without the sweep.
2. **Nothing changes until something is tagged.** With no `~/.cc-sessions/pools/` directory, `_project_pool_state` answers `untagged` for every project, `_pool_ok` answers 0 for every account, and every insertion in this wave is a no-op. The rollout is per-project and reversible with `ccd project-pool --project <p> --clear` (wave 2a's verb).

- [ ] **Step 8: Commit nothing**

This task adds no file. If Steps 1-6 required a fix, that fix belongs to the task that introduced it — amend there, re-run this task from Step 1.

---

## Deviations found

**Allocated and defined in one act, from the live allocator, on 2026-09-05.**
`~/.local/bin/ccrc-api ledger allocate --json -` with `project: ccrc-pwa`, `count: 26` and `byId`
filled from this pane (`ccrc-pwa-amber-summit`) answered **D-1663**–**D-1688** and moved the floor to
**1689**. The block covers all six account-pools wave plans; each number is defined in exactly ONE of
them, and this section holds the ones that belong to this wave. Where a task carries a `LEDGER:` line, it
states the same finding in that task's words and REFERENCES the number; it does not define it. A
plan-time refinement with no `LEDGER:` line is defined here alone, names the task it shapes, and is
referenced inline where that task was decided. Every deviation
FOUND during execution is allocated in its own call at the moment it is found, never taken from a gap
in this block.

The spec's `P-<n>` labels (§12) were provisional and are cited here only as provenance — a `P-` label
is never a ledger number.

- **D-1671** (Task 1) — `_auto_swap_check` returned at `ccd/ccd:11243` with no marker, no log line and no
  cooldown stamp when a hard-blocked session had nowhere to go, retrying every 5 s for ever — reachable
  today with every account at ceiling (`ccd-account-ok.test.ts:133-145`). `_strand_mark` and
  `_strand_clear` make it loud for tagged and untagged projects alike. (spec §12 P-3)
- **D-1672** (Task 1) — plan-time deviation from spec §11's stub list: `_avail` is left REAL in
  `ccd-auto-swap-pool.test.ts` and `ccd-crosspool.test.ts` and steered through `~/.cc-limits/<w>.json`,
  because the strand cases need it to answer false and a stub cannot carry the `limit` annotation or the
  untagged all-at-ceiling case; only `tmux`, `_dispatch_swap` and `notify.sh` are stubbed.
- **D-1673** (Task 2) — `_swap_target`'s stdout still folds "stay, fine" into "must leave, nowhere", and
  the pool rule adds a third producer of the empty answer (an undecidable tag); the caller disambiguates on
  `$hard_blocked` rather than the callee widening its seam. (spec §12 P-10)
- **D-1674** (Task 2) — ruling 4 (a manual crossing sticks) and ruling 5 (a wrong-pool current account is
  a must-leave) contradict each other on the same row until something records which the operator meant;
  `$REG/<id>.crosspool` is that record and `_crosspool_valid` is where the pool machinery asks.
  (spec §12 P-15)
- **D-1675** (Task 3) — a retag's move rides `SWAP_COOLDOWN` (900 s) and `SWAPBLOCK_COOLDOWN` (1800 s)
  like any relocation, and a dispatched unit's jitter can widen the window by up to 120 s; accepted rather
  than clearing `lastswap`, which would reopen the storm the gate exists for. (spec §12 P-8)
- **D-1676** (Task 5) — `_dispatch_swap` runs the ON-DISK `ccd` while the supervisor that chose the target
  keeps the pre-deploy inode, so between `install_atomic` and the unit sweep an old pool-blind
  `_swap_target` hands a wrong-pool account to a pool-aware `cmd_swap` every `SWAP_COOLDOWN`, refused
  silently for as long as that supervisor lives; `CCD_SWAP_AUTO=1` in the unit plus `_strand_mark` in the
  guard makes the window audible. (spec §12 P-14)
- **D-1677** (Task 6) — `cmd_prefer` is the only unconditional `.home` writer in `ccd` and journalled
  nothing, so the one account decision an operator makes by hand was the one the record could not show;
  it now journals `rehome … meas.reason prefer`. (spec §12 P-2)
- **D-1678** (Task 6) — the panel's design placed `cmd_ensure`'s strand clear three incompatible ways; it
  lives INSIDE the existing `CCD_IN_UNIT`/`CCD_KEEP_SWAPBLOCK` block, sharing `swapblocked`'s argument
  verbatim — a supervisor re-entering its own unit is not a revival. (spec §12 P-17)


### Found during execution (2026-09-07) — awaiting allocation

**Twenty-seven, batched into ONE `deviation-request` to the coordinator BEFORE Task 8's gate**, per the wave brief's
item 8: `dtbd.test.ts` scans tracked file CONTENTS, so the branch cannot be green while a placeholder lives, and a gate
green on a tree that still carried one proves nothing about the tree that gets pushed. Numbers are substituted here and
at every reference, and Task 8's gates then re-run on the substituted tree.

Every entry below was MEASURED, not inferred, and most are defects in this plan rather than in its execution: a fixture
that could not distinguish the shipped guard from its mutation, a dictated comment asserting a lock that does not fire,
a mutation row whose named red lives in a file three tasks away, a Global Constraint that forbids touching the file the
plan's own mandated emission requires. Three entries (`mutation-blast-radius`, `anchor-drift-within-commit`,
`wire-suites-outside-blast-radius`) are METHOD findings kept because each one let a false claim reach a ledger or a
comment before review caught it.

- **D-1868** (Task 1) — the plan dictated a `_strand_why` case whose expected string is
  reachable under ANY predicate ordering: no fixture candidate failed two predicates at once, so reversing the three
  arms left the suite 9/9 green while `ccd/ccd` asserted the order in caps. The plan's own inline comment inverted
  `_avail`'s documented "UNKNOWN IS AVAILABLE" rule, claiming an unmeasured account would otherwise read `limit`.
  Fixed by putting `claude-a` at the ceiling as well as in the wrong pool. Class: a guard claiming more than it measures.
- **D-1869** (Task 1) — two comments the plan dictated verbatim assert Task 2's and
  Task 3's machinery as present fact (`_auto_swap_check` calling the strand helpers; `_swap_target`'s loop having a
  pool predicate). Both false at Task 1's commit. Re-spelled in the obligation tense. The wave brief's item 3 names
  this class as wave 2a's most repeated defect; it was reintroduced BY the plan text.
- **D-1870** (Task 1) — `ccd-arith-containment.test.ts`'s prose counts five swept arithmetic sites
  in two places; `_strand_mark`'s `strandnotify` floor makes six, and the plan's Step 5 added the row without the prose.
- **D-1871** (Task 5, pre-flight Ruling B) — the plan dictates a `cmd_swap` comment saying
  `--cross-pool` is "rejected by `_is_valid_wrapper` as a second lock on the target slot". Measured false for `swap`:
  the flag is collected by the `*)` arm and lands in the `id` slot, which is never wrapper-validated; what
  `_is_valid_wrapper` refuses is the SHIFTED TARGET, and on a session id colliding with a roster id even that does not
  fire — the refusal is `no registry for '--cross-pool'`. **Not an inheritance from D-1798: the plan's comment is dated
  2026-09-05 and D-1798's measurement 2026-09-06, so this is an INDEPENDENT instance of the same wrong belief** (the
  coordinator measured the dating and is amending D-1798 to name this second home). D-1742's class exactly — the plan
  mandating a comment nothing holds — and it would have shipped into `ccd/ccd` as production prose asserting a lock
  that does not fire. Coordinator ruled it MUST be numbered.
> **WITHDRAWN — the D-1798 pin updates are NOT a deviation.** The coordinator ruled it explicitly: updating the
> four D-1798 pins is "expected work, and the count error is mine to fix in the ledger". Kept here only so the
> withdrawal is visible rather than the entry silently vanishing. My Rulings D and E are likewise not deviations
> (process choices about where obligations 2/3/9 get done).

- **D-1872** (Tasks 1, 5, 6) — `pools-existence-pairing.test.ts` DISCOVERS pools-relevant
  functions and `toEqual`s them against a hand-enumerated `CCD_BLOCKS`, so every new `ccd/ccd` function that
  interpolates `$POOLS_DIR` must be enrolled or the suite reds. The plan names that file in no task.
- **D-1873** (Tasks 1-7) — every `ccd/ccd` edit must re-stamp the `# ccrc:generated 1 sha256=`
  provenance marker or `ownership.test.ts` reds. The plan says so in no task, and seven tasks edit that file.
- **D-1874** (Task 7, brief obligations 2+3) — **comment claims this wave falsified**, eight sites across two
  origins (renamed from "wave2a-claims-falsified": two of the eight are not wave-2a claims at all). Origin one,
  wave-2a's own present-tense comments, false the moment this wave's tasks landed: `_project_pool_state`'s "NO
  CALLER OF `_pool_ok` BRANCHES THREE WAYS TODAY", `_pool_ok`'s "THE THIRD CODE IS KEPT FOR WAVE 2b, NOT CONSUMED
  TODAY", `cmd_caps`'s "`--cross-pool` … appears in `ccd/ccd` only as comment text … no verb parses it",
  `cmd_project_pool`'s "Until wave 2b emits them, this line's justification is a promise", and `cmd_swap`'s "Manual
  swaps may target ANY valid wrapper; the pool policy only constrains auto-swaps". Origin two, this wave's OWN
  earlier-task comments, made stale by this wave's OWN later tasks and already fixed by the time either was
  reviewed: `_crosspool_valid`'s header, which at Task 5 called `cmd_swap` the marker's only shipped writer and
  now correctly reads "THREE WRITERS now (Task 6 landed the remaining two)"; and `ccd-crosspool.test.ts`'s file
  header, which at Task 5 said Task 6 had not landed and now correctly describes Task 6 as exercising `cmd_start`,
  `cmd_enable`, `cmd_prefer` and `cmd_ensure`'s strand clear. Both verified fixed at this HEAD — no further edit
  needed for either.
- **D-1875** (Task 7, brief obligation 9) — `_check_pools`'s comment calls the `|| :` after
  `_ccrc_pool "$a"` load-bearing. Not reproducible: measured on bash 5.2.21, a non-matching `case` returns 0 and an
  EMPTY `case … esac` returns 0, and `shared/generate.mjs` emits exactly that shape unconditionally and says so in its
  own docstring. The third state is held by the unconditional `measured` sentinel. Comment softened; `|| :` kept.
  **BOUNDARY on the softening (coordinator):** the replacement must NOT say "a net against a hand-written
  `accounts.sh` whose `_ccrc_pool` ends on a failing command" — that asserts a shape nobody has measured to exist,
  since `shared/generate.mjs` is the file's only writer. It must say the net covers an OUT-OF-CONTRACT input and NAME
  it as out of contract, or one unmeasured claim is traded for another a level down. The bash-5.2.21 measurement is
  evidence about bash, not about which files exist — obligation 7's FILE axis, on the obligation that carries it.
- **D-1876** (Task 5) — spec §5.5.5 prose says `meas.crosspool 1` on the lifecycle row
  while spec §14 O6 rules `dec.crosspool` and the plan implements `dec.`. The plan and the ruling agree; the prose is
  the spec's own internal slip and is what a later reader would copy.
- **D-1877** (Task 2) — the plan's own case for the crossing marker is written with
  `cur == home`, which takes `_swap_target`'s unconditional "home is fine: stay" shortcut and is therefore green on
  pre-Task-2 code; the `[[ -n "$cross_home" ]] ||` escape in the home-recovered branch — the half the case's NAME
  claims to prove ("admits the crossed home") — is not measured by any fixture in this task. Same class as
  D-1868: a guard claiming more than its fixture can distinguish. **RESOLVED, not under review.** Task 2's fix
  round added `admits the CROSSED home through the home-recovered branch` (`server/test/ccd-auto-swap-pool.test.ts`)
  with `cur != home`, so the home-recovered branch is genuinely entered rather than short-circuited by the
  `cur == home` shortcut; the re-review independently re-applied the narrow mutation — delete only
  `[[ -n "$cross_home" ]] ||`, keep the `_pool_ok "$home" "$pps"` half — against `ccd/ccd`'s guard and measured it
  red exactly that one case on a whole-file run of the suite. The fixture now distinguishes what its name claims.
- **D-1878** (Task 2) — the plan predicted `_crosspool_valid`'s red would arrive as
  `command not found` making `h.sh` throw. Measured otherwise: the test idiom `_crosspool_valid … && echo yes || echo no`
  absorbs rc 127, so PER CALL an absent function and a function answering NO are the same observation. RESCOPED after
  review: at the SUITE level the discrimination survives — renaming `_crosspool_valid` away reds two tests — so the
  defect is the plan's unreachable red-first prediction plus the standing rule it hides, which is that a describe built
  on that idiom must carry at least one POSITIVE case or a deleted function reads green. The idiom is reused by Tasks 4-6.
- **D-1879** (Task 3, pre-flight Ruling A) — two of the plan's nine mutation rows for
  the tick could not be measured as written: the `_reg_set` -> `_ws_seed_home` row stayed GREEN against the plan's own
  fixtures (no case carried a pre-existing wrong-pool `.home`, and `_ws_seed_home` never clobbers, so the mutation was
  invisible), and row 44's named red lives in `ccd-crosspool.test.ts`, a file Tasks 4-6 create and which does not exist
  when Task 3 runs. **A mutation table that cannot execute where it is written is a defect in the plan, not a licence
  to skip** (coordinator's words). D-1741's class — a guard that would have shipped unproven. Both fixtures were
  written IN PLACE during execution rather than deferred, and Task 4's review then measured that the account-clause
  row is also covered by the same new fixture, so nothing in this wave is scheduled-but-unproven. Coordinator ruled it
  MUST be numbered. Third and fourth instances of the wave's recurring class.
- **D-1880** (Task 3) — `shared/api.ts`'s `LifecycleAct` union documents `rehome` as "RESERVED, and
  nothing emits it yet — measured, … with no `_lc_emit` naming it", and separately as a future "will move". Wave 2a
  wrote it as a promise about wave 2b; the tick's re-seed is now that emitter, so the paragraph is false in BOTH tense
  directions at once while naming the grep that refutes it. Corrected here under an explicit override of the plan's
  "no shared file is touched" constraint — comment text only, no type, value, wire field or behaviour.
  **Second site (extend, no new number):** the same file's `LifecycleMeas.from` docstring read "The wrapper a swap
  moved AWAY from; `wrapper` carries the target (`cmd_swap`, `ccd:11055`)" — silent on `rehome`'s own use of
  `meas.from` (both `rehome` emitters set it, and its destination rides `meas.home`, never `meas.wrapper`), and the
  `ccd:11055` citation is stale twice over: that line is workspace-pruning code, nowhere near `cmd_swap`. Fixed by
  naming both acts and replacing the line number with a grep, per this tree's rule against numeric self-citations.
- **D-1881** (Task 3) — the plan's mutation table has no row for the
  `_strand_clear` that fires when `_swap_target` DOES answer a destination; replacing that line with `:` leaves the
  whole 32-test file green. Not cosmetic: the marker is `_strand_mark`'s own debounce, so a surviving marker silences
  the row's NEXT genuine strand in both `swap.log` and `notify.sh` — the silent strand this wave abolishes,
  reintroduced for exactly the rows that already hit it once.
- **D-1882** (Task 3) — the tick folds `_crosspool_valid`'s `wrapper` and `home` arms into
  one `crossed` flag while `_swap_target` deliberately keeps them apart, and the plan's row-44 fixture seeds a row
  where both arms name the same account, so three separate mutations stay green. Ruled: KEEP the fold (an automatic
  re-seed during a deliberate crossing is the hazard the marker exists to prevent), pin the behaviour, and document
  the cost — a wrong-pool home stays unfixed for the life of the crossing. Operator may revisit in wave 3+.
- **D-1883** (Task 4) — the plan's `_crosspool_tick` re-derives WHY `_crosspool_valid`
  failed from `"$pps" != "named ${pool:-}"`, so every non-`named-<stored>` state takes the retag arm — `unreadable` and
  `malformed` included. Measured in a fixture HOME: `chmod 000` on the tag for one tick removes the operator's crossing
  marker irreversibly and writes `crosspool-ended <id>: project pool is now unreadable`, blaming a retag nobody
  performed. A transient permission fault on `$POOLS_DIR` would end every live crossing on the fleet box inside one
  tick. Spec §5.7.2 names three failure modes (retag, untag, move off the account); this invented a destructive fourth,
  against `_swap_target`'s own refusal of the identical fold and against `_pool_ok`'s standing obligation that the
  cross-pool machinery tell a mismatch (overridable) from an undecidable tag (not overridable). Fixed before Task 5
  lands a writer, so it was never live.
- **D-1884** (Task 4) — a `.crosspool` marker that exists but is empty or unreadable leaves
  the parsed pool empty, so the plan's retag arm emits `project pool is now named pool-a` while the project pool IS
  still `pool-a`. Given its own third reason.
- **D-1885** (Task 4, method) — "measure whole-file" is not sufficient and this wave proved it
  twice: Task 2 used a `-t` filter and missed two collateral reds; Task 4 measured whole-file on the NEW file only and
  reported a permanently-measured guard as unmeasured, which the coordinator had already carried into the ledger as an
  open debt for Task 6 before review retracted it. The rule is: measure a mutation across every suite that covers the
  CHANGED CALL SITE.
- **D-1886** (Task 5) — three guards the plan dictates shipped with NO fixture in the entire
  blast radius able to see their removal (188/188 green under each): the crossing marker's write SITE (moving
  `_crosspool_mark` from the success tail into the guard leaves a marker for a swap that later dies, so
  `_crosspool_tick` eventually logs a fabricated `moved off <account>`); the `CCD_SWAP_AUTO` gate (deleting it makes an
  operator's mistyped manual swap strand, banner, and stamp `strandnotify`, suppressing the NEXT GENUINE strand banner
  for a full `SWAPBLOCK_COOLDOWN`); and the guard's standing-crossing arm (neutering it makes the unit refuse a move
  the pool machinery itself chose). All three fixed with measured cases.
- **D-1887** (Task 5) — spec §5.8.4's prescribed in-unit `_strand_mark` call produces an
  operator-facing banner that is measurably false. In the task's own fixture an in-pool account is available and
  placeable, yet the notify line reads "no account in pool pool-a can take it": `_strand_why` walks pool-AWARE, so it
  describes the new `ccd`'s world rather than the old supervisor's mistake, and degrades to " no candidate" when the
  wrong-pool candidate is not in `_pool_for`'s list. The operator is pointed at "fix an account or a limit" when the
  remedy is "sweep the stale supervisors" — and this banner is the ENTIRE operator-facing payload of §5.8.4. The spec
  prescribes the call, not the wording; fixed by an additive optional cause parameter on `_strand_mark`, with the
  debounce and floor untouched. Coordinator holds the veto.
- **D-1888** (Task 5) — the plan's `CCD_SWAP_AUTO` assertion is `toContain` on the bare
  token, so changing `CCD_SWAP_AUTO=1 exec` to `CCD_SWAP_AUTO=1; exec` — one character — makes it a non-exported shell
  variable the re-exec'd `ccd` never sees, killing the whole deploy-window mechanism with the suite green.
- **D-1889** (Task 5, method) — a line anchor re-measured during a fix round went stale
  inside that same commit, because the round's own +24 lines shifted the cited site after the measurement was taken.
  `ccd/ccd` already argues against numeric anchors in its own D-1850 comment ("stated as a GREP rather than as line
  numbers — the numbers this sentence first carried were wrong the day they were written, and would have gone wrong
  anyway"), and the plan nevertheless dictates numeric `ccd:NNNN` citations throughout. Converted to the grep form.
- **D-1890** (Tasks 3 + 6, plus Task 8 Step 7) — the plan mandates `_lc_done rehome … meas.home … meas.reason …
  [meas.pool …]` in its PRODUCED list and in both tasks' code, while Global Constraint #3 (`FLEET_PROTO` stays 1)
  says **"This wave adds no wire field at all — the three new registry fields reach the server in wave 3."**
  *(Correcting an error of mine: I previously wrote that the plan's Global Constraints forbid touching
  `shared/api.ts`. The sentence "No server, agent, shared or PWA file is touched" is real, but it lives in the
  plan's **Architecture** paragraph, not Global Constraints, and it is not the constraint that bites here.)* That
  Global Constraint's tail is the defect, stated precisely: it enumerates the wave's forward surface as three
  REGISTRY fields and never counts a journal key as wire at all — though this same plan's Tasks 3 and 6 mandate
  four of them (`meas.home`, `meas.pool`, `meas.reason`, `dec.crosspool`) landing NOW, not in wave 3. It is the
  **wave map** table above (not a Global Constraint) that ordinarily puts server-side change in wave 3; this
  wave's own journal emissions are the case the map never accounted for. The result is a branch on which `ccd`
  emits three meas names L0 does not declare, red at `ccd-lifecycle-contain.test.ts`, and whose `rehome` rows
  would reach the server and PWA with their three most meaningful fields silently dropped at ingest — the failure
  that guard's own mutant comment names. An internally contradictory plan, not an execution slip. Fixed additively
  in its own commit; coordinator notified before push. **Second site (extend, no new number):** Task 8 Step 7
  states *"This wave changes `ccd/` only, so it is **agent-first**"* — false in the same premise: the branch also
  carries `shared/api.ts`, `server/src/coord/journalparse.ts`, five `server/test` files and two `pwa/test` files.
  The premise is corrected in the plan text; deciding the actual deploy order for a wave that touches both `ccd/`
  and shared/server source is the coordinator's call to make at merge, not restated here.
- **D-1891** (Tasks 5 + 6, CRITICAL) — `cmd_swap` and `cmd_prefer` emit `dec.crosspool 1`, which
  `LifecycleDec` does not declare and `reviveDec`'s closed literal drops at ingest. Worse than the meas gap in one
  specific way: `ccd-lifecycle-contain.test.ts` scans `meas.` keys ONLY, no suite scans `dec.` keys against any list,
  and no `LIFECYCLE_DEC_KEY_MAP` exists to scan against — so the branch is GREEN on it and nothing would ever have
  announced it. Spec §14 O6 exists so a crossing is recorded as a DECLARED operator choice; without the declaration
  every `--cross-pool` row reaches the PWA with exactly that distinction erased. Fixed with the declaration AND a new
  `dec.`-key scan, because a declaration without a scanner leaves the class live.
- **D-1892** (Task 6) — the `prc == 2` arm of BOTH new guards is unmeasured:
  deleting `cmd_start`'s undecidable `die` leaves 189 tests passing and `cmd_prefer`'s leaves 119, and with the line
  gone `ccd start <w> <p>` against a malformed or unreadable tag CREATES the session silently instead of refusing and
  naming the file. Collapsing rc 1 into rc 2 (`&& -z "$cross"`, making an undecidable tag overridable) is green in both
  verbs — a direct hit on `_pool_ok`'s reason for having three exit codes. Task 5 shipped the equivalent case for
  `cmd_swap` three describes up in the same file.
- **D-1893** (Task 6) — `cmd_start`'s marker line can drop `-z "$regw"` or
  `"$prc" -eq 1`, and `cmd_prefer`'s can drop `"$prc" -eq 1`, all green. The first turns a revival the auto path owns
  into a standing deliberate crossing; the second and third record a crossing that never happened, which
  `_crosspool_valid` then holds valid indefinitely so the next legitimate retag is silently treated as pre-authorised.
- **D-1894** (Tasks 3-6, method) — `ccd-lifecycle-contain.test.ts` guards what `ccd`
  may emit on the wire, and it is in NO task's regression list in this plan. So Task 3's three new `meas.` keys went
  unnoticed through four tasks and two reviews: the suite was never green on the widened emission, it was never RUN.
  The remedy is a suite-list rule, not a guard change — any change to what `ccd` emits must run `ccd-lifecycle-contain`
  and its new dec twin, neither of which the pool/swap blast radius includes.
- **D-1895** (Task 8, method — the fix for D-1891 shipped a false claim of exactly D-1871's and D-1880's class) —
  `shared/api.ts`'s `LifecycleDec.crosspool` docstring said "Three writers (grep `ccd/ccd` for `_crosspool_mark`,
  its one setter, and its three call sites): `cmd_swap --cross-pool`'s success tail, `cmd_start --cross-pool`'s
  creation-only marker, and `cmd_prefer --cross-pool`'s marker," and its act list read `swap`/`start`/`rehome`.
  Measured myself (`grep -n 'dec\.crosspool\|_crosspool_mark' ccd/ccd`): `dec.crosspool` has exactly TWO emit
  sites, `cmd_swap` (`_lc_done swap …`) and `cmd_prefer` (`_lc_done rehome … meas.reason prefer …`), producing a
  `swap` row and a `rehome` row — never a `start` one. `_crosspool_mark` does have three CALL SITES (`cmd_swap`,
  `cmd_start`, `cmd_prefer`), but `cmd_start`'s call (`ccd/ccd`, in the creation branch, after `_ws_seed_home`)
  writes only the on-disk `.crosspool` REGISTRY marker; `cmd_start`'s own `_lc_done start …` line carries no
  `dec.crosspool` at all, confirmed by reading it directly. The docstring enumerated the registry writer's three
  call sites as the journal key's emitters and its own cited grep is what produces the wrong answer — D-1798's
  exact shape, in the interface that is the single source. Fixed as prose only: the docstring now names the two
  emitters, the two acts, and states plainly that `_crosspool_mark`'s third call site writes the registry marker
  only. `cmd_start` was deliberately NOT changed to emit the key — that would be a `ccd` behaviour hunk at the end
  of a wave whose code is done and whose gate is about to run. The twin claim in
  `server/test/ccd-lifecycle-contain.test.ts`'s dec-key describe ("Task 6's own `cmd_start`/`cmd_prefer`" as the
  two tasks `dec.crosspool` "shipped GREEN" in) was reported to me as already fixed; measured otherwise — `git log
  -S` shows it unchanged since `dcdb1e4b` and untouched by `c7174ea4` (which fixed a different passage, the
  meas-key describe above it) — so it carried the identical false attribution and is corrected here too, in the
  same commit as this entry. **A third site cannot be corrected:** `dcdb1e4b`'s own commit message reads
  "`LifecycleDec` gains crosspool (`cmd_swap`/`cmd_start`/`cmd_prefer`'s `--cross-pool` marker)" — the same
  three-writer claim, in history. Left uncorrected: I was handed "rewriting twenty-one commits of history" as the
  cost of fixing it and did not accept that number either — measured instead (`git log --oneline dcdb1e4b^..HEAD`):
  SEVEN commits sit at or after `dcdb1e4b`, not twenty-one, but rewriting even seven to reword one message is not
  worth the risk, and the coordinator hand-writes the eventual squash body, so it will not inherit it. A
  known-and-recorded falsehood is honest; a silent one is not.
