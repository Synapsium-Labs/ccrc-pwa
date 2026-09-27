# Wave 2 — the un-pin verb and the readers stand down (AGENT-FIRST) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the fleet box the two halves that must ship in one `ccd` inode — a `win-size` verb the server can un-pin a session's tmux window through, and a `_pane_measurable` stand-down that makes every reader which would TYPE into a pane refuse when that pane is narrower than the phrases it matches on — so that a server which sees the `win-size-v1` capability knows both are present.

**Architecture:** Three mechanisms, each with a test that reds when it is deleted. (1) `ccd win-size --session <id> --mode smallest|canonical` — a fleet-control verb in `ccd/ccd`, scoped to `-t cc-<id>`, advertised in `cmd_caps` as the capability token `win-size-v1`. (2) The agent grant: `['win-size','--session']` in `EXEC_WHITELIST.ccd` plus enrolment in `REQUIRED_VERB_FLAG`, so a bare `['win-size']` is a TS2322 on the `LawfulGrants` proof line and a boot refusal — proven by a negative type fixture; the server side gains one `CCD_ARGV` builder and the `WIN_SIZE_CAP` token (`capSupported`, never `verbSupported`). (3) `_pane_measurable <id>` in `ccd/ccd`, called by every function that decides to type on the strength of a phrase match, with `READER_MIN_COLS` derived by measurement and held equal to `shared/api.ts`'s copy by a test.

**Tech Stack:** bash 5 (`ccd/ccd`, `set -uo pipefail`, no `-e`), TypeScript 7.0.2 (server, agent) / 6.0.3 (pwa), vitest 4, tmux 3.4, `wrap-ansi` 9 (measurement only, in the scratchpad — never a runtime dependency).

**Spec:** `docs/superpowers/specs/2026-09-14-terminal-drawer-history-and-fit-design.md` (§6 in full; §3 for the invariant, §9 for routing)

---

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Deploy class for THIS wave: AGENT-FIRST.** `ccd/`, `session-hook.sh` and `ccd/coordinator-skill/` ship to the FLEET HOST before the server: `bash deploy/deploy.sh agent <host>` **before** `bash deploy/deploy.sh`. The server reads what the hook writes and the agent caches `ccd caps` at boot. Get it backwards and a dispatched verb reaches an agent that does not grant it yet (the `ws-add`/`actor-flags-v1` D-410 cautionary tale). The deploy order is restated as Task 6's final steps.
- **Wave 3 does NOTHING until this wave is on the box.** Wave 3 un-pins only through this verb, gated on `capSupported(state, 'win-size-v1')` (null → false). An un-upgraded agent simply leaves the window pinned: wave 1 behaviour, no fallback path, no second mechanism.
- **Node floor `>=22.13.0`, identical across the three engines**, pinned by `server/test/node-floor.test.ts`. If node-floor's absolute assertion (3) is red while (1–2) are green, **RAISE engines — never lower them to make it green.**
- **No root `package.json`, no root runner.** Four packages, each `"type":"module"`, run cd'd in: `server/` `agent/` `pwa/` `shared/`.

      cd server && npm ci && npm run test    # vitest run — hermetic
      cd agent  && npm ci && npm run test
      cd pwa    && npm ci && npm run test

- **Single suite: `./node_modules/.bin/vitest run test/foo.test.ts` from inside the package. NEVER bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Run suites in the FOREGROUND, timeout ≥600000ms.** Backgrounding hides a hang; the suites are load-sensitive.
- **Known load flakes** (re-run IN ISOLATION before calling a real break): `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`. CI on the quiet box is the arbiter.
- **In tests, use FIXTURE HOMEs only — never run `ccd` against the live `$HOME`.** `HOME` is the single isolation boundary the whole ccd suite relies on. Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`). A test that builds its own env via `execFileSync` must pass `ghContainedEnv(h.home, {...}, { systemd: true, tmux: true })` explicitly — without `{tmux: true}` an uncontained `tmux` call reads the operator's LIVE server.
- **NEVER run destructive `ccd` verbs against the live host** (`ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`/`ws-restore`), **never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `claude-session@*.service` directly**, and never print secret file CONTENTS.
- **Rings / bounded contexts:** ring membership is a property of a file's IMPORTS, not its path. L0 `shared/*.ts` imports NOTHING (not even `node:*`). L3 adapters — **an adapter may not narrow a distinction it received**. L5 = `index.ts` only.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to the same value; that's a defect, not style. `win-size`'s refusals are distinct sentences; `_pane_measurable`'s single rc-1 is deliberate and argued in Task 4 (there is only ONE caller decision behind it — stand down).
- **Single-source-of-truth values are enumerated once and derived.** `server/test/single-definition.test.ts` text-scans four roots (`shared`, `server/src`, `pwa/src`, `agent/src`) and fails the build on a 2nd copy. `READER_MIN_COLS` and `win-size-v1` each have exactly one home inside those roots; the bash copies live in `ccd/ccd`, which is outside them, and a test holds each pair equal.
- **Wire discipline — additive-only, absence-permits:** frames are ADDITIVE; do NOT bump `FLEET_PROTO` (=1) for a new field. This wave adds no frame.
- **Mutation-table discipline:** a new guard ships WITH a test that goes RED when the guard is deleted/mutated (measured before/after, not a comment). Doctrine: "A comment is a request; a red suite is a mechanism." TDD red-first.
- **`ccd/ccd` is a provenance-STAMPED file.** Line 1 is the shebang, line 2 is `# ccrc:generated 1 sha256=…`. **Every task that edits `ccd/ccd` must re-stamp before committing**, or `server/test/ownership.test.ts` goes red:

      node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
        const { markGenerated } = await import('./shared/mark.mjs'); \
        writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"

- **Zero new ccd verbs for coordination mutation** — `win-size` is explicitly OUTSIDE that rule: it is **fleet control**, not the coord surface (spec §6.2). The argument is written down where the code is, in `agent/src/whitelist.ts`'s grant comment (Task 3 Step 3). **This wave writes NO README prose** — spec §8 gives the whole documentation pass to wave 4, which already writes the paragraph covering this verb (`2026-09-14-drawer-wave4-pass-and-docs.md`, the "Narrowing the window is deliberate, gated, and reversible" block and the route paragraph ending "it is fleet control, not coordination"). An earlier draft of this plan had a Task 3 step inserting a near-identical paragraph into README anchored on a sentence that **does not exist** — measured today, `grep -icF` over `README.md` returns 0 for each of `zero new ccd verbs`, `coordination mutation`, `fleet control` and `fleet-control`; that rule lives only in `CLAUDE.md`. Do not re-add it: the same sentence in two waves is the second copy `single-definition`'s doctrine exists to prevent, and wave 4 owns it.
- **`gh` has NO exec-whitelist entry, deliberately.** Never add one. `EXEC_COMMANDS` stays exactly `['tmux','ccd']` — `win-size` is a new PREFIX inside the existing `ccd:` array, not a new top-level key.
- **`tmux set-option` is NOT granted to the agent and must not become granted.** That is the whole reason the un-pin is a `ccd` verb: a `['tmux','set-option']` prefix would permit setting ANY tmux option (prefix matching leaves every later token unconstrained).
- **NOT in this wave, deliberately (spec §6.4): raising `history-limit`.** Do NOT touch `ccd/tmux.conf`, and do not add a `set -g history-limit N` anywhere. F12's census says every live pane fits at 43 columns under today's 2000 (25 of 31 panes hold zero stored lines, max 11), and wave 3's fit guard refuses the rare full pane with a reason rather than shedding it. A raise costs tmux memory and a whole-server stall (F10) for a case the census says does not occur.
- **Branch discipline:** commit on this workspace's own branch only; never a separate feature branch (a feature branch wedges every close with `stale-tip`).
- **`## Deviations found` numbers are ISSUED, never chosen** — see that section at the foot of this plan.

---

## File Structure

| File | Created / Modified | Its one responsibility |
|---|---|---|
| `shared/api.ts` | Modify (**append at the END of the file**, beside wave 1's `PANE_HISTORY_LINES` / `PaneProbe` / `PaneHistoryReply` block — see Task 1 Step 4 for why, NOT beside `FLEET_PROTO_MIN` at line 3511) | L0 home of `READER_MIN_COLS` — the single spelling every server-side reader will import (wave 3) |
| `ccd/ccd` | Modify (constants ~line 999; `cmd_caps` 5927–6076; new `cmd_win_size`; `_pane_measurable`; the reader functions §6.3 enumerates; dispatcher) | The fleet box's own copy: the bash `READER_MIN_COLS`, the `win-size` verb, the `_pane_measurable` helper, and the stand-down at every typing site |
| `agent/src/whitelist.ts` | Modify (`REQUIRED_VERB_FLAG` 252–255; the `ccd:` array inside `EXEC_WHITELIST` 335–397) | The grant — two tokens wide, and enrolled so it can never narrow to one |
| `agent/test/types/bypasses/g11-win-size-without-session.ts` | Create | Negative type fixture: the bare `['win-size']` shape MUST NOT COMPILE |
| `agent/test/types/ok/legit-whitelist.ts` | Modify (type asserts block, ~line 72) | Positive control gains `WinSizeNeedsSession` — the enrolment is pinned as a type, not only as a fixture |
| `agent/test/whitelist-structural.test.ts` | Modify (`EXPECTED` map, ~line 104) | Declares g11's expected TS code, and its "fixture for every expectation" check stays exhaustive |
| `server/src/ccdargv.ts` | Modify (`CCD_ARGV` object, after `projectPoolClear` ~line 347; cap constants after `POOLS_CAP` ~line 397) | The one place a `string[]` becomes a `CcdArgv` for this verb, plus the `WIN_SIZE_CAP` token. **No `winSizeSupported` wrapper** — wave 3 calls `capSupported(state, WIN_SIZE_CAP)` at its own seam (see Task 3 Step 4) |
| `server/test/whitelist-subset.test.ts` | Modify (`SAMPLES` ~line 18; layer 2c `EXPECTED` ~line 326; new layer-3 case after the `ws-rename` one ~line 222) | The cross-package proof that the argv the server builds is exactly what the agent grants |
| `server/test/capsupported.test.ts` | Modify (add one `it` beside the `spells the actor-flags token exactly once` case, line 47) | `WIN_SIZE_CAP`'s literal value, the same shape `ACTOR_FLAGS_CAP` already has there |
| `server/test/ccd-archive.test.ts` | Modify (`KNOWN_CAPABILITY_TOKENS` line 154; the `toContain` asserts ~line 163) | caps↔dispatcher parity, and the third spelling of `win-size-v1` held equal to the other two |
| `server/test/ccd-win-size.test.ts` | Create | The verb's own suite: both modes, every refusal, the caps advertisement, the dispatcher arm, and the scoping to `-t cc-<id>` |
| `server/test/reader-min-cols.test.ts` | Create | Holds `ccd/ccd`'s `READER_MIN_COLS=` equal to `shared/api.ts`'s, and re-runs the derivation's own bound |
| `server/test/ccd-reader-standdown.test.ts` | Create | `_pane_measurable`'s behaviour; the two stand-downs (edits 4g, 4h) that sit in functions with no phrase grep and so are invisible to the scan; and the whole-population mutation scan: every phrase-grep line has a `_pane_measurable` guard ahead of it in the same function |

---

### Task 1: Measure `READER_MIN_COLS` and give it two homes held equal

**Model routing (§9):** `sonnet`, effort `high` — the routing table's own row: "`READER_MIN_COLS` measurement (wave 2 task 1) | sonnet | high | `wrap-ansi` over known status shapes, no live session". **No live session, no fleet contact, no tmux at all.**

**Files:**
- Create: `<scratchpad>/rmc/derive.mjs` — the derivation, run once, NOT committed
- Modify: `shared/api.ts` — append at the **END of the file**, after wave 1's `PANE_HISTORY_LINES` / `PaneProbe` / `PaneHistoryReply` block (Step 4 says why)
- Modify: `ccd/ccd` — append after `STALE_PRESS_COOLDOWN=120` (line 999)
- Test: `server/test/reader-min-cols.test.ts` (new)

**Interfaces:**
- Produces: `export const READER_MIN_COLS = 120;` in `shared/api.ts` (L0, a plain `number`); the bash global `READER_MIN_COLS=120` in `ccd/ccd`. Task 4 consumes the bash one; wave 3 consumes the TS one (`fitFloor`, `sendPrompt`).
- Consumes: nothing.

- [ ] **Step 1: Run the derivation in the scratchpad**

`wrap-ansi` is a MEASUREMENT tool only — it never becomes a dependency of any of the four packages. Install it in the scratchpad:

```bash
mkdir -p "$SCRATCHPAD/rmc" && cd "$SCRATCHPAD/rmc" && npm install wrap-ansi@9
```

Write `$SCRATCHPAD/rmc/derive.mjs` exactly:

```js
// READER_MIN_COLS derivation — spec §6.3, wave 2 task 1. No live session, no fleet contact.
//
// Claude Code's TUI is Ink. Ink wraps its own status line at the terminal width
// BEFORE tmux ever stores the row, so Ink's wrapper is the model to measure with:
// wrap-ansi, hard:false (Ink <Text>'s default). For each carrier shape that
// actually carries one of the four reader phrases, find the widest column count
// at which wrap-ansi still splits the phrase across two lines; the carrier is
// safe from one more than that upward.
import wrapAnsi from 'wrap-ansi';

// The four phrases every typing site matches on (ccd/ccd's greps).
const PHRASES = ['esc to interrupt', 'continuing automatically', 'continuing shortly', 'Enter to confirm'];

// Claude Code status-line shapes that carry them. Every one is attested in this
// repo — server/test/fixtures/panes/*.txt, send.test.ts, auto-continue-armed.test.ts —
// except the long-spinner row, which is the same shape at its widest plausible
// segment values (long verb, hours elapsed, six-figure token count).
const CARRIERS = [
  '✳ Cerebrating… (12s · ↑ 1.2k tokens · esc to interrupt)',   // fixtures/panes/busy.txt
  'Reading files… (esc to interrupt)',                                            // send.test.ts
  '  ⏵ esc to interrupt',                                                         // send.test.ts ctx-bar row
  '✳ Procrastinating… (2h 14m 52s · ↑ 128.4k tokens · esc to interrupt)', // same shape, widest
  'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel',   // auto-continue-armed.test.ts
  'Usage limit reached · Continuing automatically at 11:50am',                     // auto-continue-armed.test.ts
  'Usage limit reached · continuing shortly · esc to cancel',                 // auto-continue-armed.test.ts
  'Enter to confirm · Esc to cancel',                                             // fixtures/panes/trust-folder.txt
];

const LO = 40, HI = 220;
const intact = (c, p, w) => wrapAnsi(c, w, { hard: false }).split('\n').some((l) => l.includes(p));

const rows = [];
for (const carrier of CARRIERS) {
  for (const phrase of PHRASES) {
    if (!carrier.includes(phrase)) continue;
    const broken = [];
    for (let w = LO; w <= HI; w++) if (!intact(carrier, phrase, w)) broken.push(w);
    rows.push({ phrase, carrier, need: (broken.at(-1) ?? LO - 1) + 1, broken });
  }
}
for (const r of rows) {
  console.log(`need >= ${String(r.need).padStart(3)}  "${r.phrase}"  breaks at [${r.broken.join(',') || 'none'}]`);
}
const need = Math.max(...rows.map((r) => r.need));

// `need` is the carrier's own display width: once the whole carrier fits on one
// line, no break can land inside a phrase. So the margin has to cover carriers
// WIDER than this sample, and Claude Code widens a status line one
// "· <segment>" at a time. Measure the widest segment present and require
// room for one more.
const seg = Math.max(...CARRIERS.flatMap((c) => (c.match(/·[^·()]+/g) ?? []).map((s) => s.trim().length)));

const CHOSEN = 120;   // spec §6.3's value; this script's job is to prove it is sound
console.log(`\nwidest carrier needs         ${need} columns`);
console.log(`widest "· <segment>"         ${seg} columns`);
console.log(`floor + one more segment      ${need + seg} columns`);
console.log(`READER_MIN_COLS               ${CHOSEN}`);
console.log(`  headroom (>= floor+segment) ${CHOSEN >= need + seg ? 'OK' : 'FAILS'}`);
console.log(`  a phone (43) stands down    ${43 < CHOSEN ? 'OK' : 'FAILS'}`);
console.log(`  a desktop (171) measurable  ${171 >= CHOSEN ? 'OK' : 'FAILS'}`);
```

Run it: `node "$SCRATCHPAD/rmc/derive.mjs"`

Expected output (measured 2026-09-14 on wrap-ansi 9):

```
need >=  56  "esc to interrupt"  breaks at [42,43,44,45,46,47,48,49,50,51,52,53,54,55]
need >=  40  "esc to interrupt"  breaks at [none]
need >=  40  "esc to interrupt"  breaks at [none]
need >=  69  "esc to interrupt"  breaks at [55,56,57,58,59,60,61,62,63,64,65,66,67,68]
need >=  46  "continuing automatically"  breaks at [40,41,42,43,44,45]
need >=  40  "continuing shortly"  breaks at [none]
need >=  40  "Enter to confirm"  breaks at [none]

widest carrier needs         69 columns
widest "· <segment>"         37 columns
floor + one more segment      106 columns
READER_MIN_COLS               120
  headroom (>= floor+segment) OK
  a phone (43) stands down    OK
  a desktop (171) measurable  OK
```

If the three verdict lines do not all read `OK`, STOP and report — do not adjust `CHOSEN` to make them pass. Three numbers go into the comments below: the **69** floor, the **37** segment, the **120** constant.

- [ ] **Step 2: Write the failing test**

Create `server/test/reader-min-cols.test.ts`:

```ts
// READER_MIN_COLS exists TWICE by construction — `shared/api.ts` for the server
// and a bash global in `ccd/ccd` — because bash cannot import TypeScript. This
// file is the mechanism that keeps the two one number, exactly as
// `auto-continue-armed.test.ts` keeps the auto-continue regex one literal
// (spec §6.3). It also re-asserts the derivation's own bound, so a constant
// lowered under the widest measured carrier reds here rather than shipping.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD } from './ccdWsHelpers.js';
import { READER_MIN_COLS } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = path.resolve(here, '..', '..', 'shared', 'api.ts');

/** The bash copy, read off its own assignment line. A `READER_MIN_COLS=` that
 *  is interpolated, conditional, or written twice is a drift shape this cannot
 *  see — so the count is asserted, not just the first hit. */
const bashCopy = (): number => {
  const hits = readFileSync(CCD, 'utf8').split('\n')
    .map((l) => /^READER_MIN_COLS=(\d+)\b/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null);
  expect(hits.length, 'ccd/ccd must assign READER_MIN_COLS exactly once, at column 0').toBe(1);
  return Number(hits[0]![1]);
};

describe('READER_MIN_COLS is one number in two languages', () => {
  it('ccd/ccd assigns exactly what shared/api.ts exports', () => {
    expect(bashCopy()).toBe(READER_MIN_COLS);
  });

  it('is the derived value, and both copies carry the derivation', () => {
    // 120, derived in the plan's Task 1: the widest measured carrier needs 69
    // columns and the widest status segment is 37, so 120 leaves room for one
    // more segment (69 + 37 = 106) while staying under a 171-column desktop.
    // A HARDCODED literal on purpose — this repo's mutation-table control.
    expect(READER_MIN_COLS).toBe(120);
    expect(readFileSync(API, 'utf8'), 'shared/api.ts must carry the derivation, not just the number')
      .toContain('wrap-ansi');
    expect(readFileSync(CCD, 'utf8'), 'ccd/ccd must carry the derivation, not just the number')
      .toContain('wrap-ansi');
  });

  it('stands a phone down and leaves a desktop measurable — the two-sided constraint', () => {
    // The constant's JOB, stated as a test rather than as prose: a 43-column
    // phone attach must be below it (the readers stand down) and a 171-column
    // desktop above it (automation keeps running). F12's census and §6.3.
    expect(43).toBeLessThan(READER_MIN_COLS);
    expect(171).toBeGreaterThanOrEqual(READER_MIN_COLS);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/reader-min-cols.test.ts`

Expected: FAIL — the import of `READER_MIN_COLS` from `../../shared/api.js` does not resolve, reported as `SyntaxError: The requested module '../../shared/api.js' does not provide an export named 'READER_MIN_COLS'` (all three cases fail at collection).

- [ ] **Step 4: Add the L0 constant**

**Append to the END of `shared/api.ts`** — directly after the block wave 1 appended there
(`PANE_HISTORY_LINES`, `PaneProbe`, `PaneHistoryReply`; find it with
`grep -n 'PANE_HISTORY_LINES' shared/api.ts`). **Not beside `FLEET_PROTO_MIN`** (line 3511,
verified exact today), which is where an earlier draft of this plan put it.

The reason is wave 3, not tidiness: wave 3 Task 1 anchors its own five definitions on *"directly
after the `READER_MIN_COLS` / `PANE_HISTORY_LINES` block"* and its Step 0 locates the block with a
single `grep -n 'PaneProbe\|PANE_HISTORY_LINES\|READER_MIN_COLS' shared/api.ts`. Wave 1 appends at
the end of a 6734-line file; a `READER_MIN_COLS` at 3511 would put the two ~3200 lines apart, so the
"block" wave 3 is told to append after would not exist and its worker would have to guess which half
to follow. Spec §7.2's "beside `READER_MIN_COLS`" is satisfied either way; only one placement leaves
wave 3 an anchor it can find.

If wave 1 has not merged here yet, append at the end of the file regardless — wave 1's block lands
after it and the two are still one block, in the other order.

```ts
/**
 * The narrowest pane width at which the fleet's phrase-matching readers may be
 * trusted (spec §6.3). Below it, `ccd`'s typing sites stand down — a narrow pane
 * is UNMEASURED, not idle. THE MAIL LANE DOES NOT HOLD: nothing shipped ever made
 * that true: there is no width measurement anywhere on the path this constant guards.
 * (`inject/send.ts` does measure a pane width for its OWN purposes — `paneWidth` and
 * `visualRows` — so the claim is about this hold, not about that file being width-blind.)
 * Teaching the mail lane this floor is a deliberate later widening, not something to
 * infer from this constant's existence.
 *
 * DERIVED, not chosen. Claude Code's TUI is Ink, which wraps its own status
 * line at the terminal width before tmux ever stores the row, so the derivation
 * runs `wrap-ansi` (Ink's wrapper, `hard: false`) over Claude Code's known
 * status-line carriers at every width in 40–220 and asks at which widths a
 * phrase is still on ONE line. Measured 2026-09-14: the widest carrier
 * (`✳ Procrastinating… (2h 14m 52s · ↑ 128.4k tokens · esc to interrupt)`)
 * needs 69 columns, and the widest `· <segment>` in the sample is 37 — so 120
 * carries room for one whole extra segment (69 + 37 = 106) and still leaves a
 * 171-column desktop client measurable while every phone is below it.
 *
 * `ccd/ccd` carries the same number as a bash global, because bash cannot
 * import this file; `server/test/reader-min-cols.test.ts` holds the two equal.
 */
export const READER_MIN_COLS = 120;
```

- [ ] **Step 5: Add the bash copy**

In `ccd/ccd`, directly after the `STALE_PRESS_COOLDOWN=120` line (line 999), insert:

```bash
# The narrowest pane width at which THIS FILE'S phrase-matching readers may be
# trusted (spec §6.3). Below it `_pane_measurable` answers 1 and every site that
# would type stands down: a narrow pane cannot be RELIED ON to keep
# "esc to interrupt" on one line,
# and a wrapped phrase reads as SILENCE to grep, which is the 2026-09-08
# five-session incident's shape.
#
# DERIVED with `wrap-ansi` (Ink's own wrapper, hard:false) over Claude Code's
# known status-line carriers at widths 40-220: the widest carrier needs 69
# columns and the widest "· <segment>" is 37, so 120 leaves room for one more
# segment and still keeps a 171-column desktop measurable.
#
# THE SECOND COPY of `shared/api.ts`'s READER_MIN_COLS, by construction — bash
# cannot import TypeScript. `server/test/reader-min-cols.test.ts` holds them
# equal; change one and change the other in the same commit.
READER_MIN_COLS=120
```

- [ ] **Step 6: Re-stamp ccd, run the test to verify it passes**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd server && ./node_modules/.bin/vitest run test/reader-min-cols.test.ts
```

Expected: PASS, 3/3.

Then the two suites the edits can reach:

```bash
cd server && ./node_modules/.bin/vitest run test/ownership.test.ts test/single-definition.test.ts
```

Expected: PASS. (`ownership` proves the re-stamp landed; `single-definition` proves the new constant collides with no existing enumeration guard. If `single-definition` reds on `READER_MIN_COLS`, do NOT weaken the scan — record it as a deviation and report.)

- [ ] **Step 7: Mutation check, then commit**

Temporarily change `READER_MIN_COLS=120` in `ccd/ccd` to `READER_MIN_COLS=100`, re-stamp, and run `cd server && ./node_modules/.bin/vitest run test/reader-min-cols.test.ts`: the first case must FAIL with `expected 100 to be 120`. Restore 120 and re-stamp.

```bash
git add shared/api.ts ccd/ccd server/test/reader-min-cols.test.ts
git commit -m "$(cat <<'MSG'
feat(readers): derive READER_MIN_COLS and give it two homes held equal

wrap-ansi (Ink's wrapper, hard:false) over Claude Code's known status-line
carriers at widths 40-220: the widest carrier needs 69 columns and the widest
segment is 37, so 120 leaves a whole segment of margin while keeping a
171-column desktop measurable and every phone below it (spec §6.3).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: `ccd win-size --session <id> --mode smallest|canonical`

**Model routing (§9):** **`opus`, effort `high`** — this is the first of the three named opus tasks: "the `win-size` verb body and its validation, in `ccd`'s spawn neighbourhood".

**Files:**
- Modify: `ccd/ccd` — new `cmd_win_size` inserted directly after `cmd_coord_pause`'s closing brace (~line 6390, before `cmd_account_pane` at 6394); `cmd_caps`'s verb heredoc (5941–5975) and its token echoes (tail of `cmd_caps`, ~line 6076); the dispatcher `case` (17525–17561) and its `*)` usage string (17559)
- Modify: `server/test/ccd-archive.test.ts:154` — `KNOWN_CAPABILITY_TOKENS`
- Test: `server/test/ccd-win-size.test.ts` (new)

**Interfaces:**
- Consumes: `_tmux()` (`ccd/ccd:1744`, `id -> cc-<id>`), `die()` (`ccd/ccd:1072`, prints `ccd: $*` on stderr and exits 1).
- Produces: the bash function `cmd_win_size()` (argv `--session <id> --mode smallest|canonical`; prints `smallest` or `canonical` on stdout, exit 0; every refusal is `die`, exit 1). The dispatcher verb `win-size`. The `cmd_caps` lines `win-size` (verb) and `win-size-v1` (capability token). Task 3 consumes the token; wave 3 calls the verb through `CCD_ARGV.winSize`.

- [ ] **Step 1: Write the failing test**

Create `server/test/ccd-win-size.test.ts`:

```ts
// `ccd win-size --session <id> --mode smallest|canonical` — the fleet-control
// verb the terminal drawer un-pins a session's tmux window through (spec §6.1).
//
// Why a ccd verb and not a tmux grant: the un-pin is `set-option -t <s>
// window-size smallest`, and `agent/src/whitelist.ts` grants tmux exactly five
// verbs, `set-option` not among them. A `['tmux','set-option']` prefix would
// permit setting ANY tmux option on any target, because prefix matching leaves
// every later token unconstrained. Wrapping the one option in a ccd verb keeps
// the grant two tokens wide and puts the validation on the box.
//
// Everything runs against the isolated fixture HOME (`makeCcdHarness`) with a
// bash `tmux()` function stub that RECORDS instead of running — the harness's
// own PATH poison cannot answer `has-session`, and an uncontained tmux call
// would reach the operator's LIVE server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-win-size-'); });
afterEach(() => { h.cleanup(); });

/** A tmux that records every argv and succeeds. `has-session` must succeed too,
 *  or every case would stop at the liveness refusal. */
const TMUX_OK = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };';
/** The same recorder, refusing — the shape a vanished session or a tmux that
 *  cannot answer produces. */
const TMUX_FAIL = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };';
/** Alive, but the mutation itself fails: `has-session` 0, everything else 1. */
const TMUX_MUTATE_FAIL =
  'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; *) return 1 ;; esac; };';

const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** The dispatcher, not the function — the agent invokes `ccd win-size …`, so
 *  the `case` arm is production surface (`ccd-coord-pause.test.ts`'s runCcd). */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

const calls = (): string[] => {
  const p = path.join(h.home, 'ccd-calls');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : [];
};

describe('ccd win-size', () => {
  it('smallest UN-LATCHES the window, scoped to this session only', () => {
    expect(h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode smallest`)).toBe('smallest');
    expect(calls()).toContain('tmux set-option -t cc-demo-quiet-basin window-size smallest');
    // NEVER `latest`: F4 measured a keystroke-driven reflow flip at +6 MB RSS
    // per flip, shedding 50 history lines per flip from about flip 17.
    expect(calls().join('\n')).not.toContain('window-size latest');
    // NEVER GLOBAL. `set-option` with no `-t` writes the server-wide default and
    // resizes all ~20 live sessions at once.
    for (const c of calls()) {
      if (c.includes('set-option')) expect(c).toContain('-t cc-demo-quiet-basin');
    }
  });

  it('canonical re-pins the grid ccd spawns with, and re-latches manual', () => {
    expect(h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode canonical`)).toBe('canonical');
    expect(calls()).toContain('tmux resize-window -t cc-demo-quiet-basin -x 220 -y 50');
    // `resize-window` is what latches `manual` (F3) — an arm that used
    // `set-option window-size manual` would latch the option without setting
    // the size, leaving the window wherever the last client left it.
    expect(calls().join('\n')).not.toContain('window-size manual');
  });

  it('refuses a malformed argv by its own sentence, and runs nothing', () => {
    for (const argv of [
      '', '--session demo', '--session demo --mode', '--mode smallest',
      '--session demo --mode smallest extra', '--sess demo --mode smallest',
      '--session demo --style smallest',
    ]) {
      const r = shFail(`${TMUX_OK} cmd_win_size ${argv}`);
      expect(r.code, `argv: ${argv}`).not.toBe(0);
      expect(r.stderr, `argv: ${argv}`)
        .toContain('usage: ccd win-size --session <id> --mode smallest|canonical');
    }
    expect(calls(), 'a refused argv must run no tmux at all').toEqual([]);
  });

  it('refuses an id outside ccd\'s own id class BEFORE any target is built from it', () => {
    // The roster's ID_RE (`shared/roster.ts`), which is `cmd_account_pane`'s
    // precedent and the class spec §6.1 names — not the looser
    // `^[A-Za-z0-9._-]+$` most workspace verbs use. The id is about to be
    // interpolated into a tmux target, so the gate runs first.
    for (const id of ['', '-leading', '1leading', 'Upper', 'has space', '../escape',
                      'semi;colon', 'dollar$sign', 'a'.repeat(33)]) {
      const r = shFail(`${TMUX_OK} cmd_win_size --session '${id}' --mode smallest`);
      expect(r.code, `id: ${id}`).not.toBe(0);
      expect(r.stderr, `id: ${id}`).toContain('bad id:');
    }
    expect(calls(), 'a refused id must run no tmux at all').toEqual([]);
  });

  it('refuses an unknown mode with a DIFFERENT sentence, and runs nothing', () => {
    // A caller who got the shape right and the vocabulary wrong is not a caller
    // who got the usage wrong — folding the two answers "usage" to someone
    // whose usage was fine (`cmd_coord_pause`'s bad-state precedent).
    const r = shFail(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode latest`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('bad mode: latest (want smallest|canonical)');
    expect(r.stderr).not.toContain('usage: ccd win-size');
    expect(calls(), 'an unknown mode must run no tmux at all').toEqual([]);
  });

  it('refuses an absent session, and mutates nothing', () => {
    const r = shFail(`${TMUX_FAIL} cmd_win_size --session demo-quiet-basin --mode smallest`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no such session: cc-demo-quiet-basin');
    expect(r.stdout).not.toContain('smallest');
    expect(calls(), 'only the liveness probe ran').toEqual(['tmux has-session -t cc-demo-quiet-basin']);
  });

  it('refuses LOUDLY when the mutation itself fails — never a false success', () => {
    // ccd runs `set -uo pipefail` with NO `-e`: unguarded, a failed `set-option`
    // falls straight through to the `echo` and the caller — wave 3's route,
    // which keys on the exit code — is told the window is FOLLOWING when it is
    // still pinned, and un-pins nothing while reporting that it did.
    const un = shFail(`${TMUX_MUTATE_FAIL} cmd_win_size --session demo-quiet-basin --mode smallest`);
    expect(un.code).not.toBe(0);
    expect(un.stderr).toContain('STILL at its pinned size');
    expect(un.stdout).not.toContain('smallest');

    const pin = shFail(`${TMUX_MUTATE_FAIL} cmd_win_size --session demo-quiet-basin --mode canonical`);
    expect(pin.code).not.toBe(0);
    expect(pin.stderr).toContain('NOT at the canonical grid');
    expect(pin.stdout).not.toContain('canonical');
  });

  it('advertises BOTH the verb and its capability token in ccd caps', () => {
    // Two mechanisms, two lines. The VERB name is what `verbSupported` and the
    // dispatcher parity check read; the TOKEN is what wave 3's
    // `capSupported(state,'win-size-v1')` reads, and it is the proof of BOTH
    // halves of this wave — the verb and the readers' stand-down ship in one
    // ccd inode, so a server that sees the token knows the readers yield.
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('win-size');
    expect(advertised).toContain('win-size-v1');
  });

  it('is reachable through the dispatcher, with argv shifted, and is named in the usage line', () => {
    // The harness's PATH tmux poison exits 97, so the dispatcher path lands on
    // the liveness refusal — which is exactly what proves the `case` arm runs:
    // a missing arm answers the `*)` usage line instead.
    const r = runCcd('win-size', '--session', 'demo-quiet-basin', '--mode', 'smallest');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no such session: cc-demo-quiet-basin');
    expect(r.stderr).not.toContain('usage: ccd {start|');

    const usage = runCcd('no-such-verb');
    expect(usage.code).not.toBe(0);
    expect(usage.stderr).toContain('win-size');
  });

  it('touches nothing in $REG — the window is the whole effect', () => {
    // Unlike `coord-pause`, this verb writes no marker. A registry file here
    // would be a second fact for the fleet lane to read.
    h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode smallest`);
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-win-size.test.ts`

Expected: FAIL, 10/10 — each case dies with `bash: line …: cmd_win_size: command not found` (exit 127), reported by vitest as the `h.sh` call throwing / `shFail` returning a code with empty stderr for the positive cases.

- [ ] **Step 3: Write the verb**

In `ccd/ccd`, insert directly after `cmd_coord_pause`'s closing brace (~line 6390) and before `cmd_account_pane` (line 6394):

```bash
cmd_win_size() {   # ccd win-size --session <id> --mode smallest|canonical — pin or un-pin ONE session's window.
  # THE FLEET-CONTROL VERB the terminal drawer un-pins through (spec §6.1). Two
  # modes and nothing else:
  #   • smallest  — `set-option window-size smallest` UN-LATCHES `manual` (F3);
  #     tmux then sizes the window to the NARROWEST attached client (F5):
  #     deterministic, keystroke-stable, and self-healing when that client
  #     leaves. NEVER `latest` — F4 measured a keystroke-driven reflow flip at
  #     +6 MB tmux RSS per flip, never returned, shedding 50 history lines per
  #     flip from about the seventeenth.
  #   • canonical — `resize-window -x 220 -y 50` restores the grid `_spawn_start`
  #     spawns with AND re-latches `manual`, which IS the pinned state §3 wants.
  #     The server does NOT depend on this arm: its own pin is the already-granted
  #     `tmux resize-window`, which works against an agent of any age. Its callers
  #     are an operator typing the verb on the box and the agent's
  #     `win-size` grant — NOT ccd itself. Measured 2026-09-16: `cmd_win_size`
  #     appears at three lines (this definition, the dispatcher's `win-size)` arm,
  #     and this sentence's own quotation) and no fourth; no ccd function calls it.
  #
  # ALWAYS PASS `-t`. The claim that stood here — that `set-option` with no `-t`
  # "writes the SERVER-WIDE default and re-sizes every live session at once" — is
  # false in BOTH halves. Re-measured 2026-09-16, tmux 3.4, private `-L` socket,
  # three detached sessions: `tmux set-option window-size smallest` → rc 0;
  # `show-options -g window-size` STILL reads `latest`, so the server default is
  # NOT written; the other two sessions keep `window-size latest`; NO session is
  # resized. Exactly one window took the option — whichever tmux calls current.
  # That is a mutation of a target nobody named, the same class the `=` anchor
  # closes, which is reason enough to always pass `-t`.
  #
  # `aggressive-resize` is deliberately left alone — measured a no-op for a
  # one-window session, which every cc-* session is.
  [[ $# -eq 4 && $1 == --session && $3 == --mode ]] \
    || die "usage: ccd win-size --session <id> --mode smallest|canonical"
  local id="$2" mode="$4" t
  # BEFORE ANY TARGET IS BUILT FROM IT. `cc-$id` is handed to tmux, which hands
  # the target on to its own parser; `shared/roster.ts`'s ID_RE is where every
  # rostered id comes from, and it is the class `cmd_account_pane` validates
  # against for this same reason. NOT the looser `^[A-Za-z0-9._-]+$` most
  # workspace verbs use: this one is reached from a route the PWA hits.
  [[ "$id" =~ ^[a-z][a-z0-9-]{0,31}$ ]] || die "bad id: $id"
  # The vocabulary check runs BEFORE tmux is touched at all, so an unknown mode
  # runs nothing — and it is its OWN sentence, not the usage line: the caller
  # got the shape right and the word wrong.
  case "$mode" in
    smallest|canonical) ;;
    *) die "bad mode: $mode (want smallest|canonical)" ;;
  esac
  t=$(_tmux "$id")
  tmux has-session -t "$t" 2>/dev/null || die "no such session: $t"
  # `set -uo pipefail` with NO `-e`: an unguarded failure would fall straight
  # through to the echo and report a size change that did not happen. Wave 3's
  # `sizer.unpin` keys on this exit code to tell 'ok' from 'failed'.
  if [[ "$mode" == smallest ]]; then
    tmux set-option -t "$t" window-size smallest \
      || die "could not un-pin $t — the window is STILL at its pinned size"
    echo "smallest"
  else
    tmux resize-window -t "$t" -x 220 -y 50 \
      || die "could not pin $t — the window is NOT at the canonical grid"
    echo "canonical"
  fi
}
```

- [ ] **Step 4: Advertise it, and wire the dispatcher**

In `cmd_caps`'s verb heredoc, insert `win-size` on its own line directly after `version` and before `ls` (the list is not strictly alphabetical; what matters is that it is inside the `cat <<'EOF' … EOF` block):

```
version
win-size
ls
EOF
```

At the tail of `cmd_caps`, directly after the `echo pools-v1` line and before the closing `}`, add:

```bash
  # The capability token for wave 2 of the terminal-drawer program, and it is
  # the proof of BOTH halves of that wave rather than of the verb alone: the
  # `win-size` verb and `_pane_measurable`'s stand-down at every typing site
  # ship in ONE ccd inode, so a server that sees this token knows the readers on
  # this box already yield to a narrow pane. The server gates the un-pin on
  # `capSupported(state,'win-size-v1')` — null → REFUSE — never `verbSupported`,
  # whose null → PERMIT default is right for verbs that have always existed and
  # wrong for one that never did. An un-upgraded agent simply leaves the window
  # pinned: wave 1 behaviour, no fallback path, no second mechanism.
  echo win-size-v1
```

In the dispatcher `case` block, insert an arm with EXACTLY two leading spaces (the parity check in `ccd-archive.test.ts` matches `/^ {2}([a-z][a-z|-]*)\)/gm`), directly after the `coord-pause)` arm:

```bash
  win-size)  shift; cmd_win_size "$@" ;;
```

And in the `*)` arm's usage string (the single long line at ~17559), insert `win-size` after `coord-pause`, so the list reads `…|ws-release|coord-pause|win-size|account-pane|project-pool|…`.

- [ ] **Step 5: Teach the caps parity test about the new token**

In `server/test/ccd-archive.test.ts`, line 154, extend the array:

```ts
  const KNOWN_CAPABILITY_TOKENS = ['account-v1', 'actor-flags-v1', 'lifecycle-v1', 'pools-v1', 'stop-surface', 'win-size-v1'];
```

- [ ] **Step 6: Re-stamp ccd, run the tests to verify they pass**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd server && ./node_modules/.bin/vitest run test/ccd-win-size.test.ts test/ccd-archive.test.ts test/caps-token-shape.test.ts test/ownership.test.ts
```

Expected: PASS — `ccd-win-size` 10/10, and the three neighbours green (`ccd-archive`'s caps↔dispatcher parity now sees `win-size` on both sides; `caps-token-shape` picks up `echo win-size-v1` automatically through `parseCcdCaps`).

- [ ] **Step 7: Mutation check, then commit**

Three mutations, each restored before the next:

1. Delete the `case "$mode" in … esac` block's `*)` arm (leave `smallest|canonical) ;;`). Run `./node_modules/.bin/vitest run test/ccd-win-size.test.ts`: *refuses an unknown mode* must FAIL — with `--mode latest` the function falls to the `else` branch and prints `canonical`. Restore.
2. Delete the `|| die "could not un-pin …"` tail from the `set-option` line. Run the same suite: *refuses LOUDLY when the mutation itself fails* must FAIL with `expected 0 not to be 0`. Restore.
3. Delete the `win-size)` dispatcher arm. Run the same suite: *is reachable through the dispatcher* must FAIL — stderr carries `usage: ccd {start|` instead of the liveness refusal. Restore.

Re-stamp after restoring, then:

```bash
git add ccd/ccd server/test/ccd-win-size.test.ts server/test/ccd-archive.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): win-size — pin or un-pin ONE session's tmux window

`ccd win-size --session <id> --mode smallest|canonical`, validated against the
roster id class before any target is built from it, scoped to `-t cc-<id>` and
never global, refusing loudly rather than reporting a size change that did not
happen. `smallest` un-latches `manual` so tmux follows the narrowest client
(F5) — never `latest` (F4). Advertised as `win-size-v1`, the token that proves
both halves of wave 2 shipped in one ccd inode (spec §6.1).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: The grant — two tokens wide, and enrolled so it cannot narrow

**Model routing (§9):** **`opus`, effort `high`** — the second named opus task: "the whitelist entry + `REQUIRED_VERB_FLAG` + bypass fixtures — proof-by-typecheck against an adversarial type". This task's diff is also the subject of wave 2's mandatory `opus`/`xhigh` security lens (§6.5 item 1).

**Files:**
- Modify: `agent/src/whitelist.ts:252-255` (`REQUIRED_VERB_FLAG`) and `agent/src/whitelist.ts:335-397` (the `ccd:` array inside `EXEC_WHITELIST`, which opens at 335 and closes at 397 — the enclosing object is 319-398 — after the `ws-rename` entry at 396)
- Create: `agent/test/types/bypasses/g11-win-size-without-session.ts`
- Modify: `agent/test/types/ok/legit-whitelist.ts` (type-assert block, ~line 72)
- Modify: `agent/test/whitelist-structural.test.ts` (`EXPECTED` map, after the `g10` entry ~line 107)
- Modify: `server/src/ccdargv.ts` (`CCD_ARGV`, after `projectPoolClear` ~line 347; `WIN_SIZE_CAP` after `POOLS_CAP` ~line 397)
- Modify: `server/test/whitelist-subset.test.ts` (`SAMPLES` ~line 73; a new layer-3 case after the `ws-rename` one ~line 222; layer 2c `EXPECTED` ~line 326)
- Modify: `server/test/capsupported.test.ts` (one new `it` after `spells the actor-flags token exactly once in server/src`, line 47)
- Modify: `server/test/ccd-archive.test.ts` (the `toContain` asserts ~line 163)
- **NOT modified: `README.md`.** Wave 4 owns the documentation pass (spec §8) and already writes the paragraph that covers this verb; see the Global Constraints note above for the measurement that killed this wave's version of it.

**Interfaces:**
- Consumes: the `cmd_caps` token `win-size-v1` and the verb `win-size` from Task 2.
- Produces:
  - `EXEC_WHITELIST.ccd` gains `['win-size', '--session']`; `REQUIRED_VERB_FLAG` gains `'win-size': '--session'`.
  - `server/src/ccdargv.ts`: `winSize: (id: string, mode: 'smallest' | 'canonical') => CcdArgv`, and `export const WIN_SIZE_CAP = 'win-size-v1'`. **Two exports, not three.**
  - Wave 3's `WindowSizer.unpin` is implemented over exactly these two plus the EXISTING `capSupported` — `if (!capSupported(d.fleetState, WIN_SIZE_CAP)) return 'unsupported';` (`2026-09-14-drawer-wave3-deliberate-unpin.md` Task 2, and spec §6.1 asks for `capSupported` by name). There is deliberately **no `winSizeSupported` wrapper**: nothing in this tree greps for orphan exports, so a wrapper wave 3 never names would land as an export whose only caller is its own test. `stopSurfaceSupported` is not the precedent it looks like — it has a real production caller (`server/src/server.ts:2133`, verified today). If a later wave wants the wrapper, it is that wave's call to make at the same commit as its caller.

- [ ] **Step 1: Write the failing tests**

(a) Create `agent/test/types/bypasses/g11-win-size-without-session.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// TERMINAL DRAWER, wave 2: `['win-size', '--session']` -> `['win-size']`, i.e.
// a grant that keeps the verb and drops the flag that is its entire argument
// surface.
//
// This is g9/g10's shape one verb over, and it is here because the two halves
// of the mechanism are separable and only one of them is visible to a subset
// test. `isExecAllowed` is PREFIX-matching — its own comment says "tokens after
// the prefix are unconstrained" — so `['win-size']` admits
// `ccd win-size --session demo --mode smallest` exactly as the two-token grant
// does, and `server/test/whitelist-subset.test.ts` stays green on the narrowed
// grant. What refuses is the ENROLMENT in `REQUIRED_VERB_FLAG`: it makes this
// edit a TS2322 on the proof line here, and a boot refusal at module load.
//
// A bare `win-size` is not a narrower grant. It permits every positional form
// the verb might ever grow, and the session id it carries arrives off a
// JSON-parsed websocket frame — ccd's own id class is the whole gate behind it.
// The verb MUTATES a shared tmux server's window options, reached (wave 3) from
// a route the PWA hits with no box token of any kind.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['win-size']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

(b) In `agent/test/whitelist-structural.test.ts`, directly after the `'g10-project-pool-without-project.ts'` entry and before the closing `};` of `EXPECTED`:

```ts
  // TERMINAL DRAWER wave 2, g9's finding two verbs over: a two-token grant is
  // only two tokens wide while its verb is ENROLLED in `REQUIRED_VERB_FLAG`.
  'g11-win-size-without-session.ts': {
    what: 'the window-size verb granted without the flag that is its whole argument surface',
    codes: ['TS2322'],
  },
```

(c) In `agent/test/types/ok/legit-whitelist.ts`, directly after the `RenameNeedsSession` line (~line 72):

```ts
export type WinSizeNeedsSession = Assert<Equals<(typeof REQUIRED_VERB_FLAG)['win-size'], '--session'>>;
```

(d) In `server/test/whitelist-subset.test.ts`, add to `SAMPLES` after `projectPoolClear` (~line 73):

```ts
  // TERMINAL DRAWER wave 2. The mode is part of the argv, not a parameter the
  // route may omit: `cmd_win_size` asserts exactly four tokens.
  winSize: ['demo-quiet-basin', 'smallest'],
```

…add a layer-3 case directly after the `ws-rename is grantable ONLY with --session` case (~line 222):

```ts
  // The THIRD entry in REQUIRED_VERB_FLAG that is there for its argument
  // surface rather than for a confirmation token, and the one reached from the
  // widest-open door: `GET /ws/pty/:id` (wave 3) carries no box token at all,
  // and the `:id` it hands down arrives off a JSON-parsed frame. A bare
  // `['win-size']` would permit `ccd win-size <anything> <anything…>` — every
  // positional form the verb might ever grow — and it would stay green in
  // layer 2 and layer 3's reachability check, because `['win-size']` is a
  // genuine prefix of the argv `CCD_ARGV.winSize` builds. Cross-PACKAGE and
  // object-reading, for the reasons the ws-reap assertion above states.
  it('win-size is grantable ONLY with --session', () => {
    const ws = EXEC_WHITELIST.ccd.filter((p) => p[0] === 'win-size');
    expect(ws.length, 'exactly one win-size grant').toBe(1);
    expect(ws[0]).toEqual(['win-size', '--session']);
    expect(isExecAllowed('ccd', ['win-size', 'demo-quiet-basin', '--mode', 'smallest'])).toBe(false);
    expect(isExecAllowed('ccd', ['win-size'])).toBe(false);
    expect(isExecAllowed('ccd', [...CCD_ARGV.winSize('demo-quiet-basin', 'smallest')])).toBe(true);
    expect(isExecAllowed('ccd', [...CCD_ARGV.winSize('demo-quiet-basin', 'canonical')])).toBe(true);
    // And `tmux set-option` is STILL not granted — the whole reason the un-pin
    // is a ccd verb rather than a tmux one.
    expect(EXEC_WHITELIST.tmux.map((p) => p[0])).not.toContain('set-option');
    expect(isExecAllowed('tmux', ['set-option', '-t', 'cc-demo', 'window-size', 'smallest'])).toBe(false);
  });
```

…and add to layer 2c's `EXPECTED` map, after `projectPoolClear`:

```ts
    winSize: ['win-size', '--session', 'demo-quiet-basin', '--mode', 'smallest'],
```

(e) In `server/test/capsupported.test.ts`, after the `spells the actor-flags token exactly once in server/src` case (line 47) — the case this one is modelled on, because `WIN_SIZE_CAP` is a token, not a function:

```ts
  it('spells the win-size token exactly once in server/src', () => {
    // The other two spellings are deliberate and elsewhere: ccd's own `echo
    // win-size-v1` and `ccd-archive.test.ts`'s KNOWN_CAPABILITY_TOKENS, which
    // is the pin that holds all three equal. ACTOR_FLAGS_CAP's case above is
    // the shape this copies.
    expect(WIN_SIZE_CAP).toBe('win-size-v1');
    // AND THE POLARITY THE TOKEN IS READ WITH, asserted here rather than left
    // in a docstring, because the function that will read it lives in wave 3.
    // No evidence REFUSES for this token, where `verbSupported` on the VERB
    // permits — and the verb's presence is not the token's presence.
    expect(capSupported(state(null), WIN_SIZE_CAP)).toBe(false);
    expect(capSupported(undefined, WIN_SIZE_CAP)).toBe(false);
    expect(capSupported(state(['win-size']), WIN_SIZE_CAP)).toBe(false);
    expect(capSupported(state([WIN_SIZE_CAP]), WIN_SIZE_CAP)).toBe(true);
    expect(verbSupported(state(null), ['win-size'])).toBe(true);
  });
```

Extend that file's import at line 11 to `ACTOR_FLAGS_CAP, CCD_ARGV, WIN_SIZE_CAP, capSupported, stopSurfaceSupported, verbSupported,` (keep the existing members). **No `winSizeSupported`** — Step 4 says why.

(f) In `server/test/ccd-archive.test.ts`, beside the two existing `toContain` asserts (~line 163):

```ts
    expect(KNOWN_CAPABILITY_TOKENS).toContain(WIN_SIZE_CAP);
```

…and extend that file's `ccdargv.js` import to include `WIN_SIZE_CAP`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd agent  && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts
cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/capsupported.test.ts test/ccd-archive.test.ts
```

Expected failures, in order:
- agent `whitelist-structural`: `g11-win-size-without-session.ts` FAILS with `expected [] to equal ['TS2322']` — the fixture compiles clean, because `win-size` is not enrolled yet. The positive control `tsconfig.ok.json` ALSO fails to compile (`WinSizeNeedsSession`: `Property 'win-size' does not exist on type …`), which surfaces as `the positive control compiles clean` FAILING.
- server `whitelist-subset`: `has a sample for every CCD_ARGV entry` FAILS with `winSize` present in `SAMPLES` and absent from `CCD_ARGV`; the new `win-size is grantable ONLY with --session` case FAILS with `expected 0 to be 1`.
- server `capsupported`: FAILS at collection — `does not provide an export named 'WIN_SIZE_CAP'`.
- server `ccd-archive`: FAILS at collection for the same reason.

- [ ] **Step 3: Add the grant and the enrolment**

In `agent/src/whitelist.ts`, `REQUIRED_VERB_FLAG` (lines 252–255) becomes:

```ts
export const REQUIRED_VERB_FLAG = {
  'ws-reap': '--expect', 'ws-rename': '--session', 'coord-pause': '--state',
  'project-pool': '--project', 'win-size': '--session',
} as const;
```

In `EXEC_WHITELIST.ccd`, directly after the `['ws-rename',  '--session'],` entry and before the closing `],`:

```ts
    // The terminal drawer's un-pin (wave 2, spec §6.1). `tmux set-option` is
    // NOT granted and must never be: prefix matching leaves every token after
    // a granted prefix unconstrained, so `['tmux','set-option']` would permit
    // setting ANY option on ANY target of the shared server. Wrapping the one
    // option this program needs in a ccd verb keeps the mutation two tokens
    // wide and puts the id validation on the box, where `shared/roster.ts`'s
    // ID_RE is enforced before a target string is built.
    //
    // This is a FLEET-CONTROL verb, which is why it is outside CLAUDE.md's
    // "zero new ccd verbs for coordination mutation" — that rule is about the
    // coord surface (mail, runs, claims), and this touches none of it.
    //
    // ENROLLED in `REQUIRED_VERB_FLAG` above, for `coord-pause`'s reason and
    // then some: `--session` is not a confirmation token, it is half the verb's
    // whole argument surface, and this is the verb reached from the widest-open
    // door in the tree — `GET /ws/pty/:id` (wave 3) carries no box token at all
    // and its `:id` arrives off a JSON-parsed frame. A bare `['win-size']`
    // would admit every positional form the verb might grow, and would stay
    // green in `whitelist-subset.test.ts` at every layer.
    ['win-size',   '--session'],
```

- [ ] **Step 4: Add the server-side builder and token — and NO wrapper**

In `server/src/ccdargv.ts`, inside `CCD_ARGV` after `projectPoolClear` (~line 347):

```ts
  /** The terminal drawer's window pin/un-pin (wave 2, spec §6.1). `mode` is a
   *  two-member union rather than a string: `cmd_win_size` asserts exactly four
   *  tokens and `die`s on any other word, so the vocabulary is ccd's and the
   *  mapping happens once, here, where no route can invent a third.
   *
   *  `id` reaches ccd UNVALIDATED by this builder on purpose — `cmd_win_size`
   *  enforces `shared/roster.ts`'s ID_RE on the box, before a tmux target is
   *  built from it, and that is the authority. What this builder guarantees is
   *  only that the tokens reach it in the shape the agent grants. */
  winSize: (id: string, mode: 'smallest' | 'canonical') =>
             argv(['win-size', '--session', id, '--mode', mode]),
```

After `export const POOLS_CAP = 'pools-v1';` (~line 397):

```ts
/** The `ccd caps` token that says this box has BOTH halves of terminal-drawer
 *  wave 2: the `win-size` verb AND `_pane_measurable`'s stand-down at every
 *  typing site. They ship in one ccd inode, so this one token is evidence for
 *  both. Spelled ONCE in `server/src`, for `ACTOR_FLAGS_CAP`'s reason; ccd's own
 *  `echo win-size-v1` and `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` are
 *  the other two spellings, and that test's `toContain` assertion keeps THIS one
 *  equal to them.
 *
 *  READ IT WITH `capSupported`, NEVER `verbSupported`, wherever wave 3 gates the
 *  un-pin. `verbSupported` PERMITS on no evidence ("an absent list must never
 *  grey out the fleet") — the right default for verbs that have always existed
 *  and the wrong one for a verb that never did: it would send `ccd win-size` to
 *  an agent that grants no such prefix, and, worse, would treat a box whose
 *  readers have NOT learned to stand down as though they had. `capSupported`
 *  refuses on no evidence, so an un-upgraded agent simply leaves the window
 *  pinned: wave 1 behaviour, no fallback path, no second mechanism (spec §6.1).
 *  This is a note on the token, not a wrapper function — the gate belongs at
 *  wave 3's own seam, where its mutation test can red on it. */
export const WIN_SIZE_CAP = 'win-size-v1';
```

**And nothing else.** In particular, do NOT add a `winSizeSupported(state)` wrapper beside
`stopSurfaceSupported` (~line 480). Wave 3 Task 2 writes
`if (!capSupported(d.fleetState, WIN_SIZE_CAP)) return 'unsupported';` inline in `sizer.ts` and
never names a wrapper; spec §6.1 asks for `capSupported` by name. Nothing in this tree greps for
orphan exports, so a wrapper would land as an export whose only caller is its own test —
`stopSurfaceSupported` is not the precedent, it has a real caller at `server/src/server.ts:2133`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd agent  && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts test/whitelist.test.ts test/whitelist-noghosts.test.ts test/whitelist-prototype.test.ts test/exec.test.ts
cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/capsupported.test.ts test/ccd-archive.test.ts test/ccdargv-brand.test.ts test/single-definition.test.ts test/typecheck-tests.test.ts
```

Expected: PASS everywhere. (`typecheck-tests` is a known load flake — re-run it in isolation before calling it a break.)

- [ ] **Step 6: Mutation check, then commit**

Three mutations, each restored before the next:

1. Delete `'win-size': '--session',` from `REQUIRED_VERB_FLAG` (leave the whitelist entry). Run `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts`: `g11-win-size-without-session.ts` must FAIL with `expected [] to equal ['TS2322']`, and `the positive control compiles clean` must FAIL. This is the measurement that proves the enrolment — not the grant — is what refuses the bare shape. Restore.
2. Narrow `['win-size', '--session']` to `['win-size']` in `EXEC_WHITELIST.ccd`. Run `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts` — the agent fails to boot the module (`auditExecWhitelist` throws) — and `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts`: `win-size is grantable ONLY with --session` must FAIL at `expected ['win-size'] to equal ['win-size','--session']`. Restore.
3. Change `WIN_SIZE_CAP` to `'win-size-v2'` in `server/src/ccdargv.ts`. Run `cd server && ./node_modules/.bin/vitest run test/capsupported.test.ts test/ccd-archive.test.ts`: `spells the win-size token exactly once in server/src` must FAIL at `expected 'win-size-v2' to be 'win-size-v1'`, and `ccd-archive`'s `toContain` must FAIL — the two together are what hold the server's spelling equal to ccd's own `echo`. Restore.

```bash
git add agent/src/whitelist.ts agent/test/types/bypasses/g11-win-size-without-session.ts \
        agent/test/types/ok/legit-whitelist.ts agent/test/whitelist-structural.test.ts \
        server/src/ccdargv.ts server/test/whitelist-subset.test.ts \
        server/test/capsupported.test.ts server/test/ccd-archive.test.ts
git commit -m "$(cat <<'MSG'
feat(agent): grant `ccd win-size --session`, enrolled so it cannot narrow

Two tokens wide in EXEC_WHITELIST.ccd and enrolled in REQUIRED_VERB_FLAG, so a
bare ['win-size'] is a TS2322 on the LawfulGrants proof line and a boot refusal
— pinned from the other side by g11, and cross-package by whitelist-subset.
`tmux set-option` stays ungranted: prefix matching would make it a licence to
set any option on any target of the shared server. Server side gains the one
CCD_ARGV builder and WIN_SIZE_CAP — read with capSupported, never verbSupported
(null must REFUSE for a verb that never existed), at wave 3's own seam rather
than through a wrapper with no production caller. Spec §6.2.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: `_pane_measurable`, and the stand-down at every typing site

**Model routing (§9):** **`opus`, effort `high`** — the third named opus task: "`_pane_measurable` and its sweep over the typing sites".

**Files:**
- Modify: `ccd/ccd` — new `_pane_measurable` inserted directly before `_pane_auto_continue_armed` (line 13351); then **nine** functions: `_pane_auto_continue_armed` (13351–13358), `_session_hard_blocked` (13360–13416), `_auto_stale_check` (13429–13454), `_auto_swap_check` (13521–14013), `_inject_spawn_effort` (14905–14926), `_auto_compact_check` (14096–14230), `_accept_first_run_prompts` (14373–14503), `_spawn_settle`'s `case "$prompt_rc"` (14832–14859), `_redrive_after_spawn` (15023–15064)
- Test: `server/test/ccd-reader-standdown.test.ts` (new — behaviour only; Task 5 adds the population scan to the same file)

**Interfaces:**
- Consumes: `READER_MIN_COLS` (bash global, Task 1); `_tmux()` (`ccd/ccd:1744`).
- Produces: `_pane_measurable <id>` — rc 0 when `cc-<id>`'s ACTIVE pane reports `#{pane_width} >= READER_MIN_COLS`, rc 1 otherwise AND on every unmeasurable condition (tmux non-zero, no active row, a non-numeric width). Also the widened signature `_pane_auto_continue_armed <pane-text> [id]` — with an id, an unmeasurable pane answers ARMED (rc 0).

**Why `_pane_measurable` is allowed ONE rc for four conditions** (it is not an overloaded null): every caller makes exactly ONE decision from it — *stand down, or proceed* — and "the pane is narrow", "tmux would not answer", "no row is active" and "the width is not a number" are the same answer to that question: **this pane is unmeasured, and an unmeasured pane is not idle** (spec §11 ruling 4). Nothing downstream branches on which one it was. The distinction that IS preserved is the one callers act on differently: `_pane_auto_continue_armed` inverts, holding rather than releasing, because a cancelled continuation cannot be un-cancelled.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-reader-standdown.test.ts`:

```ts
// The readers stand down below the calibration width (spec §6.3).
//
// A pane narrower than READER_MIN_COLS cannot be RELIED ON to keep
// "esc to interrupt" on one line,
// and grep cannot match across the newline it never presents (F11). Every ccd
// reader that decides to TYPE on the strength of a phrase match therefore fails
// OPEN on a narrow pane — a wrapped busy line reads as idle and ccd types
// /compact, a redrive, or a bare Enter into a running turn. That is the shape of
// the 2026-09-08 five-session incident, and `_pane_measurable` is the mechanism
// that closes it: measure first, and refuse to trust the phrase at all below the
// width the phrases were calibrated for.
//
// Fixture HOME only, with a bash `tmux()` function stub that shadows the
// harness's PATH poison — an uncontained `list-panes` reads the operator's LIVE
// server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { READER_MIN_COLS } from '../../shared/api.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-standdown-'); });
afterEach(() => { h.cleanup(); });

/** A `list-panes -F '#{pane_active} #{pane_width}'` that answers one line per
 *  ROW given, and refuses every other tmux verb so nothing else is silently
 *  exercised. `printf` repeats its format once per argument, which is how the
 *  rows become real lines — a single string carrying a literal `\n` would NOT,
 *  since `%s` does not interpret escapes in its argument. */
const panes = (...rows: string[]): string =>
  `tmux() { case "$1" in list-panes) printf '%s\\n' ${rows.map((r) => JSON.stringify(r)).join(' ')} ;; *) return 1 ;; esac; };`;
/** A tmux that cannot answer at all. */
const TMUX_DEAD = 'tmux() { return 1; };';
/** The same `list-panes` answer, but every OTHER verb is RECORDED to
 *  `$HOME/ccd-calls` instead of refused — so a case can assert what was, or was
 *  not, typed into the pane. `capture-pane` substitutions come back empty
 *  because the record goes to the file, not to stdout. */
const panesRecording = (...rows: string[]): string =>
  `tmux() { case "$1" in list-panes) printf '%s\\n' ${rows.map((r) => JSON.stringify(r)).join(' ')} ;;`
  + ' *) echo "tmux $*" >> "$HOME/ccd-calls" ;; esac; };';

/** The rc of a snippet, read off stdout rather than off a thrown status: `h.sh`
 *  throws on a non-zero LAST command, and the trailing `echo` makes the last
 *  command always succeed, so the rc survives as the final line. */
const rc = (snippet: string): number =>
  Number(h.sh(`${snippet}; echo $?`).trim().split('\n').at(-1));

const WIDE = String(READER_MIN_COLS);
const NARROW = String(READER_MIN_COLS - 1);

describe('_pane_measurable', () => {
  it('answers 0 at exactly READER_MIN_COLS and above — the boundary is inclusive', () => {
    expect(rc(`${panes(`1 ${WIDE}`)} _pane_measurable demo`)).toBe(0);
    expect(rc(`${panes('1 220')} _pane_measurable demo`)).toBe(0);
  });

  it('answers 1 one column below it', () => {
    expect(rc(`${panes(`1 ${NARROW}`)} _pane_measurable demo`)).toBe(1);
    expect(rc(`${panes('1 43')} _pane_measurable demo`)).toBe(1);
  });

  it('reads the ACTIVE row, not the first one (F7)', () => {
    // `list-panes -t <session>` lists EVERY pane of the current window, and
    // `capture-pane -t <session>` reads the ACTIVE one. PR #96 read row [0] and
    // mismatched on a split window; a guard that measures the wrong pane is
    // worse than no guard, because it says "measured".
    expect(rc(`${panes('0 43', `1 ${WIDE}`)} _pane_measurable demo`)).toBe(0);
    expect(rc(`${panes('0 220', `1 ${NARROW}`)} _pane_measurable demo`)).toBe(1);
  });

  it('answers 1 — stand down — on every UNMEASURABLE condition', () => {
    // Four conditions, ONE answer, and that is not an overloaded null: every
    // caller makes exactly one decision from it, and "narrow", "tmux would not
    // answer", "no active row" and "not a number" are the same answer to it.
    // An unmeasured pane is not idle (spec §11 ruling 4).
    expect(rc(`${TMUX_DEAD} _pane_measurable demo`), 'tmux refused').toBe(1);
    expect(rc(`${panes()} _pane_measurable demo`), 'no rows at all').toBe(1);
    expect(rc(`${panes('0 220')} _pane_measurable demo`), 'no active row').toBe(1);
    expect(rc(`${panes('1 wide')} _pane_measurable demo`), 'non-numeric width').toBe(1);
    expect(rc(`${panes('1')} _pane_measurable demo`), 'short row').toBe(1);
  });

  it('targets cc-<id>, through _tmux', () => {
    const out = h.sh(
      'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };'
      + ' _pane_measurable demo-quiet-basin; cat "$HOME/ccd-calls"');
    expect(out).toContain('-t cc-demo-quiet-basin');
    expect(out).toContain('#{pane_active}');
    expect(out).toContain('#{pane_width}');
  });
});

describe('_pane_auto_continue_armed holds when it cannot measure', () => {
  const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel';
  const IDLE = '? for shortcuts';

  it('with no id, it is the classifier it has always been', () => {
    // Callers that hold only pane text (and the pin in
    // `auto-continue-armed.test.ts`) must be unchanged by this wave.
    expect(rc(`${TMUX_DEAD} _pane_auto_continue_armed ${JSON.stringify(ARMED)}`)).toBe(0);
    expect(rc(`${TMUX_DEAD} _pane_auto_continue_armed ${JSON.stringify(IDLE)}`)).toBe(1);
  });

  it('with an id and a MEASURABLE pane, it still answers the pane', () => {
    expect(rc(`${panes(`1 ${WIDE}`)} _pane_auto_continue_armed ${JSON.stringify(ARMED)} demo`)).toBe(0);
    expect(rc(`${panes(`1 ${WIDE}`)} _pane_auto_continue_armed ${JSON.stringify(IDLE)} demo`)).toBe(1);
  });

  it('with an id and an UNMEASURABLE pane, it answers ARMED — the inverted direction', () => {
    // THE ONE GUARD THAT INVERTS. Everywhere else "unmeasurable" releases the
    // caller from acting; here it must HOLD, because the action this gate
    // protects is a keystroke that CANCELS Claude Code's own recovery timer,
    // and a cancelled continuation cannot be un-cancelled.
    expect(rc(`${panes(`1 ${NARROW}`)} _pane_auto_continue_armed ${JSON.stringify(IDLE)} demo`)).toBe(0);
    expect(rc(`${TMUX_DEAD} _pane_auto_continue_armed ${JSON.stringify(IDLE)} demo`)).toBe(0);
  });
});

// THE TWO SITES THE POPULATION SCAN CANNOT SEE.
//
// Task 5's scan finds a guard by looking for a phrase-carrying `grep` and
// walking back through the same function. Edits 4g and 4h sit in functions that
// carry NO phrase grep — `_spawn_settle` only renders the gate loop's rc, and
// `_inject_spawn_effort` decides on an empty input box — so neither is in
// `POPULATION` and neither would red when deleted. These two cases are their
// mechanism, and the Global Constraint that every guard ships with a test that
// reds on its deletion is what requires them.
describe('the two stand-downs outside the phrase population', () => {
  it('_spawn_settle names rc 6 to the operator (edit 4g)', () => {
    // `_accept_first_run_prompts` answers 6 — "I stood down, I did not decide" —
    // and rc 6 must not be silence: without an arm of its own the `case` falls
    // through and a spawn that did nothing looks exactly like a spawn that
    // worked. The stub is the gate loop, because THIS case is about the
    // sentence, not about how the 6 was reached.
    const out = h.sh(
      `${panesRecording(`1 ${NARROW}`)} _accept_first_run_prompts() { return 6; };`
      + ' _spawn_settle demo 0 2>"$HOME/ccd-err" >/dev/null; cat "$HOME/ccd-err"');
    expect(out).toContain(`demo: pane is under ${READER_MIN_COLS} columns`);
    expect(out, 'the sentence must name the remedy, not just the refusal')
      .toContain('close the terminal drawer');
  });

  it('_inject_spawn_effort types nothing into a narrow pane (edit 4h)', () => {
    // The /effort injection is a keystroke into a pane whose state it read with
    // a phrase match one line earlier. On a narrow pane that read is worthless,
    // so the whole function stands down before the first `capture-pane`.
    const out = h.sh(
      `${panesRecording(`1 ${NARROW}`)} sleep() { :; }; SPAWN_EFFORT=ultracode;`
      + ' _inject_spawn_effort cc-demo 2>"$HOME/ccd-err";'
      + ' cat "$HOME/ccd-err"; cat "$HOME/ccd-calls" 2>/dev/null || true');
    expect(out).toContain(`pane is under ${READER_MIN_COLS} columns, skipped /effort`);
    expect(out, 'a pane too narrow to read is a pane too narrow to type into')
      .not.toContain('send-keys');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-reader-standdown.test.ts`

Expected: **FAIL 8, PASS 2, of 10.** Measured 2026-09-14 against a prototype carrying Task 1's
`READER_MIN_COLS` and nothing else. **Do not "fix" the two greens** — they are the controls, and a
red in either would mean this wave broke something that already worked:

| Case | Step 2 | Why |
|---|---|---|
| all five `_pane_measurable` cases | **FAIL** | rc `127`, `_pane_measurable: command not found`, where 0 or 1 is expected. `targets cc-<id>, through _tmux` fails differently — `$HOME/ccd-calls` is never written, so its `cat` exits non-zero and `h.sh` throws. |
| `with no id, it is the classifier it has always been` | **PASS** | The control. It must be green before AND after — that is the whole claim. |
| `with an id and a MEASURABLE pane, it still answers the pane` | **PASS** | Also green already: today's `_pane_auto_continue_armed` ignores `$2`, so on a pane it would have measured as wide it happens to give the right answers. It turns into a real assertion once Step 3 lands. |
| `with an id and an UNMEASURABLE pane, it answers ARMED` | **FAIL** | Both rows answer `1` where `0` is expected — measured: `_pane_auto_continue_armed "? for shortcuts" demo` returns 1 at a 119-column pane and 1 with tmux refusing. |
| `_spawn_settle names rc 6 to the operator` | **FAIL** | `expected '' to contain 'demo: pane is under 120 columns'` — the `case` has no `6)` arm, so rc 6 falls through in total silence (measured: stderr empty, return 6). |
| `_inject_spawn_effort types nothing into a narrow pane` | **FAIL** | Fails its first assertion; the recorded calls are `tmux capture-pane -t cc-demo -p`, `tmux capture-pane -t cc-demo -p -e`, `tmux send-keys -t cc-demo -l /effort ultracode`, `tmux send-keys -t cc-demo Enter`, `tmux capture-pane -t cc-demo -p`. |

- [ ] **Step 3: Write the helper**

In `ccd/ccd`, insert directly BEFORE `_pane_auto_continue_armed()` (line 13351):

```bash
_pane_measurable() {   # id -> rc 0 when cc-<id>'s ACTIVE pane is at least READER_MIN_COLS wide, else 1.
  # THE STAND-DOWN GATE (spec §6.3). Every site below that decides to TYPE on
  # the strength of a phrase match calls this first. Below READER_MIN_COLS,
  # Claude Code's own Ink layer has already wrapped the status line between
  # words before tmux stored it, and `grep` cannot match across the newline it
  # never presents (F11) — so a busy pane reads as SILENCE and the reader fires
  # into a running turn. That is the 2026-09-08 five-session incident.
  #
  # THE ACTIVE ROW, NOT ROW 0 (F7). `list-panes -t <session>` lists every pane
  # of the current window while `capture-pane -t <session>` reads the ACTIVE
  # one, so measuring row 0 on a split window measures a pane the readers never
  # look at — worse than no guard, because it claims to have measured.
  #
  # ONE rc FOR FOUR CONDITIONS, DELIBERATELY, and it is not an overloaded null:
  # every caller makes exactly ONE decision from this answer — stand down, or
  # proceed — and "narrow", "tmux would not answer", "no active row" and "the
  # width is not a number" are the same answer to that question. An unmeasured
  # pane is not idle.
  local rows w
  rows=$(tmux list-panes -t "$(_tmux "$1")" -F '#{pane_active} #{pane_width}' 2>/dev/null) || return 1
  w=$(awk '$1 == 1 { print $2; exit }' <<<"$rows")
  # Regex before the arithmetic test: `$w` is bytes off tmux's stdout.
  [[ "$w" =~ ^[0-9]+$ ]] || return 1
  (( w >= READER_MIN_COLS ))
}
```

- [ ] **Step 4: Sweep every typing site**

Nine edits. **`_pane_auto_continue_armed` first, and it must stay ONE line** (see the warning below it).

**(4a) `_pane_auto_continue_armed`** — widen the signature comment and insert exactly ONE line immediately before the `grep -qiE` line:

```bash
_pane_auto_continue_armed() {   # pane text [id] -> success iff Claude Code is waiting out a limit on its own (D-2229).
  # "Usage limit reached · continuing automatically at HH:MM · esc or type to cancel" (and its
  # "shortly"/"when it resets" variants) is Claude Code's OWN recovery, an in-memory timer that
  # ANY keystroke cancels. The rescue arm deliberately ignores it (a swap that re-drives beats
  # waiting, ruling R1); the three sites that TYPE into a pane — the compactor, the /effort
  # injection, and the fallback re-drive — must not.
  [[ -n "${2:-}" ]] && ! _pane_measurable "$2" && return 0   # unmeasurable -> ARMED: a cancelled continuation cannot be un-cancelled (§6.3)
  grep -qiE "continuing automatically|continuing shortly" <<<"$1"
}
```

> **DO NOT ADD A SECOND LINE HERE.** `server/test/auto-continue-armed.test.ts` finds this function by `startsWith('_pane_auto_continue_armed()')` and then regexes the `grep -qiE "…"` literal out of `lines.slice(i, i + 8)` — an 8-line window. The def line plus five comment lines plus this guard puts the `grep` at index 7, the LAST slot in that window. One more line anywhere above the grep and the pin throws `no grep -qiE literal inside _pane_auto_continue_armed`. Keep the guard's explanation as a trailing comment on the guard line, and keep the def line's literal prefix `_pane_auto_continue_armed()` exactly as written.

**(4b) `_session_hard_blocked`** — insert directly after its `local id="$1" pane="$2" …` line (line 13398) and before `_pane_hard_blocked "$pane" && return 0`:

```bash
  _pane_measurable "$id" || return 1   # unmeasurable -> NO VERDICT (§6.3): the rescue this feeds is a restart that types
```

**(4c) `_auto_stale_check`** — insert directly after `t=$(_tmux "$id")` (line 13438) and before the `pane=` capture:

```bash
  _pane_measurable "$id" || return 0   # unmeasurable -> no Enter (§6.3): a wrapped "esc to interrupt" reads as idle
```

**(4d) `_auto_swap_check`** — insert directly after its second `local …` line (line 13526), before the account-measurement comment block:

```bash
  # §6.3: a relocation is a restart that re-drives, and the only thing standing
  # between it and a running turn is the `esc to interrupt` match further down.
  _pane_measurable "$id" || return 0
```

**(4e) `_auto_compact_check`** — insert directly before the `pane=$(tmux capture-pane …| tail -8); prc=$?` line (line 14142):

```bash
  _pane_measurable "$id" || { _compact_note "$id" pane-narrow "pane is under ${READER_MIN_COLS} cols; a wrapped phrase reads as idle (§6.3)"; return 0; }
```

…and pass the id to the auto-continue classifier on line 14145, so the inverted guard applies there too:

```bash
  _pane_auto_continue_armed "$pane" "$id" && { _compact_note "$id" auto-continue "Claude Code is waiting out a limit on its own; a keystroke would cancel it (D-2229)"; return 0; }
```

**(4f) `_accept_first_run_prompts`** — this function knows only the tmux NAME, so it strips the `cc-` prefix `_tmux` added. Insert directly after its `local …` declarations and before the `for i in $(seq 1 "$SPAWN_GATE_TRIES"); do` loop (line 14425):

```bash
  # §6.3, ahead of the whole gate loop: every branch below decides on a phrase
  # match and answers with a keystroke. rc 6 is NEW and its own code — 3/4/5 are
  # load-bearing at four call sites plus _supervised_start and must not be
  # renumbered. `${1#cc-}` because this function knows the tmux NAME, and
  # `_pane_measurable` takes the id `_tmux` built it from.
  _pane_measurable "${1#cc-}" || return 6
```

**(4g) `_spawn_settle`** — give rc 6 a sentence in the `case "$prompt_rc"` block, directly after the `5)` arm:

```bash
    6) echo "ccd: $id: pane is under ${READER_MIN_COLS} columns, so the startup gates stood down — close the terminal drawer on this session and retry." >&2 ;;
```

**(4h) `_inject_spawn_effort`** — insert directly after `local t="$1"` (line 14907):

```bash
  _pane_measurable "${t#cc-}" || { echo "ccd: pane is under ${READER_MIN_COLS} columns, skipped /effort $SPAWN_EFFORT (§6.3)" >&2; return 0; }
```

…and pass the id to the auto-continue classifier on line 14908:

```bash
  if _pane_auto_continue_armed "$(tmux capture-pane -t "$t" -p 2>/dev/null)" "${t#cc-}"; then
```

**(4i) `_redrive_after_spawn`** — insert directly after its `local id="$1" t="$2" …` line (line 15041) and before `f=$(_transcript_path "$id") || return 0`:

```bash
  _pane_measurable "$id" || { echo "$(date '+%F %T') redrive-skip $id: pane is under ${READER_MIN_COLS} columns (§6.3)" >> "$REG/swap.log"; return 0; }
```

…and pass the id to the auto-continue classifier on line 15057 (line 15052 is a comment):

```bash
  _pane_auto_continue_armed "$pane" "$id" && { echo "$(date '+%F %T') redrive-skip $id: auto-continue armed" >> "$REG/swap.log"; return 0; }
```

**Not edited, and why:** `_answer_two_option_dialog` (14362) and `_pane_hard_blocked` (13456) carry no phrase grep of their own and are reached only from `_accept_first_run_prompts` / `_redrive_after_spawn`, both of which now stand down above them — a second guard there would be a second measurement of the same fact. `_spawn_start`'s `window-size latest` (line 14790) is untouched: wave 1's server-side pin overrides it before any pty client attaches (F14), and this wave does not change how sessions are spawned.

- [ ] **Step 5: Re-stamp ccd, run the tests to verify they pass**

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
cd server && ./node_modules/.bin/vitest run test/ccd-reader-standdown.test.ts test/auto-continue-armed.test.ts test/ownership.test.ts test/ccd-auto-compact.test.ts test/ccd-session-state.test.ts test/ccd-lifecycle-pairs.test.ts
```

Expected: PASS everywhere. `auto-continue-armed.test.ts` is the one to watch — if it reports `no grep -qiE literal inside _pane_auto_continue_armed`, the 8-line window was exceeded: remove a line from that function, do not widen the pin. (`ccd-session-state` is a known load flake; re-run in isolation before calling it a break.)

- [ ] **Step 6: Run the whole ccd-facing server suite**

```bash
cd server && npm run test
```

Expected: PASS. Every `ccd-*.test.ts` that drives a spawn now goes through `_pane_measurable`; a suite that reds with `command not found` means a fixture sources a stale copy, and one that reds on an unexpected stand-down means its `tmux()` stub answers `list-panes` in a shape `awk` cannot read — fix the stub, never the guard.

- [ ] **Step 7: Mutation check, then commit**

Five mutations, each restored (and re-stamped) before the next:

1. Change `(( w >= READER_MIN_COLS ))` to `(( w >= 1 ))`. Run `./node_modules/.bin/vitest run test/ccd-reader-standdown.test.ts`: *answers 1 one column below it* must FAIL with `expected 0 to be 1`. Restore.
2. Change `awk '$1 == 1 …'` to `awk 'NR == 1 …'` (PR #96's own bug). Run the same suite: *reads the ACTIVE row, not the first one* must FAIL on both rows. Restore.
3. Invert `_pane_auto_continue_armed`'s guard to `&& return 1`. Run the same suite: *with an id and an UNMEASURABLE pane, it answers ARMED* must FAIL with `expected 1 to be 0`. Restore.
4. Delete edit **4g** — the whole `6)` arm from `_spawn_settle`'s `case "$prompt_rc"`. Re-stamp, run the same suite: *_spawn_settle names rc 6 to the operator* must FAIL with `expected '' to contain 'demo: pane is under 120 columns'`. **Measured on a prototype of these edits, 2026-09-14:** with the arm, `_spawn_settle demo 0` under a 43-column `list-panes` and an `_accept_first_run_prompts` stubbed to `return 6` writes `ccd: demo: pane is under 120 columns, so the startup gates stood down — close the terminal drawer on this session and retry.` to stderr and returns 6; with the arm deleted, stderr is **empty** and it still returns 6. Restore and re-stamp.
5. Delete edit **4h** — `_inject_spawn_effort`'s `_pane_measurable "${t#cc-}" || {…}` line. Re-stamp, run the same suite: *_inject_spawn_effort types nothing into a narrow pane* must FAIL on `toContain('pane is under 120 columns, skipped /effort')`, and again on `not.toContain('send-keys')`. **Measured on the same prototype:** with the guard, the only output is `ccd: pane is under 120 columns, skipped /effort ultracode (§6.3)` and `$HOME/ccd-calls` is never created; with it deleted the recorded calls are `tmux capture-pane -t cc-demo -p`, `tmux capture-pane -t cc-demo -p -e`, `tmux send-keys -t cc-demo -l /effort ultracode`, `tmux send-keys -t cc-demo Enter`, `tmux capture-pane -t cc-demo -p` — i.e. it types into a pane it cannot read. Restore and re-stamp.

**Mutations 4 and 5 are not optional and are not covered by Task 5.** The population scan finds guards by walking back from a phrase-carrying `grep`; `_spawn_settle` and `_inject_spawn_effort` carry none, so they are absent from `POPULATION` by construction and a deleted guard there is invisible to it. These two behaviour cases are the only mechanism those two edits have.

```bash
git add ccd/ccd server/test/ccd-reader-standdown.test.ts
git commit -m "$(cat <<'MSG'
feat(ccd): _pane_measurable — every typing site stands down below the calibration width

A pane under READER_MIN_COLS has already had its status line wrapped between
words by Ink, and grep cannot match across a newline it never presents (F11),
so a busy pane reads as silence and the reader types into a running turn. Every
site that decides on a phrase match now measures the ACTIVE pane first (F7) and
stands down when it cannot: _session_hard_blocked, _auto_stale_check,
_auto_swap_check, _auto_compact_check, _accept_first_run_prompts (new rc 6),
_inject_spawn_effort and _redrive_after_spawn. _pane_auto_continue_armed
inverts — unmeasurable answers ARMED, the one direction that cannot cancel a
continuation. The regex literals are untouched. Spec §6.3.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: The population scan — a guard removed is a red suite

**Model routing (§9):** `sonnet`, effort `high` (the wave-worker default; this is mechanical test-writing against an enumerated population).

**Files:**
- Modify: `server/test/ccd-reader-standdown.test.ts` — append two `describe` blocks
- Test: the same file

**Interfaces:**
- Consumes: `_pane_measurable` and the nine edits from Task 4; `CCD` (`server/test/ccdWsHelpers.ts:22`).
- Produces: nothing importable — this is a mechanism, not an interface.

**What it pins, exactly.** Spec §6.3: *"a scan over `ccd/ccd` finds every line carrying one of the four phrases in a `grep` and asserts a `_pane_measurable` guard precedes it in the same function; removing one guard → red."* The population is ten live lines across seven functions, and the count is asserted too — otherwise deleting a guard AND its grep together would pass.

- [ ] **Step 1: Extend the file's imports, then write the failing test**

First widen the two import lines Task 4 wrote at the top of
`server/test/ccd-reader-standdown.test.ts` — the scan needs `CCD` and
`readFileSync`, neither of which the behaviour cases used:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { READER_MIN_COLS } from '../../shared/api.js';
```

Then append to the same file:

```ts
// --- THE POPULATION SCAN ---
//
// The behaviour cases above prove `_pane_measurable` works. This proves it is
// CALLED — at every site, by construction rather than by anyone remembering.
// It is this repo's whole-population mutation tripwire (`ccd-arith-containment
// .test.ts`'s shape): the population is fixed and enumerated, each entry names
// the function and how many phrase-carrying greps it holds, and dropping a
// guard turns that function's row red whether or not a payload test happens to
// walk that path.

/** The four phrases every stand-down exists for (spec §1, §6.3). */
const PHRASES = ['esc to interrupt', 'continuing automatically', 'continuing shortly', 'Enter to confirm'];

/** Function name -> how many LIVE `grep` lines in it carry one of the phrases.
 *  Measured against ccd/ccd at the wave-2 baseline. Adding a phrase grep to a
 *  new function, or to one of these, reds the census below until this table and
 *  that function's guard both move. */
const POPULATION: Record<string, number> = {
  _pane_auto_continue_armed: 1,
  _session_hard_blocked: 1,
  _auto_stale_check: 1,
  _auto_swap_check: 1,
  _auto_compact_check: 1,
  _accept_first_run_prompts: 3,
  _redrive_after_spawn: 2,
};

interface Site { fn: string; line: number; text: string }

/** Every line that MATCHES a phrase inside a grep, with the function it sits
 *  in. Whole-line comments are stripped first — `ccd/ccd` quotes
 *  `grep -q "esc to interrupt"` inside prose at lines 14134 and 15034, and a
 *  scan that counted those would demand guards for sentences. */
function sites(): Site[] {
  const lines = readFileSync(CCD, 'utf8').split('\n');
  const out: Site[] = [];
  let fn = '';
  lines.forEach((raw, i) => {
    const def = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(raw);
    if (def) fn = def[1]!;
    if (/^\s*#/.test(raw)) return;
    if (!raw.includes('grep')) return;
    if (!PHRASES.some((p) => raw.includes(p))) return;
    out.push({ fn, line: i + 1, text: raw.trim() });
  });
  return out;
}

/** The lines between a function's `name() {` and `line`, exclusive. */
function bodyBefore(fn: string, line: number): string[] {
  const lines = readFileSync(CCD, 'utf8').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^${fn}\\(\\)\\s*\\{`).test(l));
  expect(start, `ccd/ccd no longer defines ${fn}() at column 0 — re-anchor this scan`)
    .toBeGreaterThanOrEqual(0);
  return lines.slice(start + 1, line - 1);
}

describe('every phrase-matching reader stands down first (mutation tripwire)', () => {
  it('the census is exactly the enumerated population — anti-vacuity', () => {
    // Without this, deleting a guard AND its grep together would pass, and so
    // would a scan whose regex silently stopped matching anything.
    const found = sites();
    const counted: Record<string, number> = {};
    for (const s of found) counted[s.fn] = (counted[s.fn] ?? 0) + 1;
    expect(counted, 'a phrase grep moved, appeared or vanished — update POPULATION and its guard together')
      .toEqual(POPULATION);
    expect(found.length).toBe(Object.values(POPULATION).reduce((a, b) => a + b, 0));
  });

  it.each(Object.keys(POPULATION))('%s calls _pane_measurable before it matches a phrase', (fn) => {
    for (const s of sites().filter((x) => x.fn === fn)) {
      expect(
        bodyBefore(fn, s.line).some((l) => !/^\s*#/.test(l) && l.includes('_pane_measurable')),
        `${fn} (ccd/ccd:${s.line}) matches a calibration phrase with no _pane_measurable guard ahead `
        + `of it in the same function:\n    ${s.text}`,
      ).toBe(true);
    }
  });

  it('_pane_measurable is defined exactly once, and reads the width it claims to', () => {
    const src = readFileSync(CCD, 'utf8');
    expect(src.split('\n').filter((l) => /^_pane_measurable\(\)\s*\{/.test(l)))
      .toHaveLength(1);
    const body = src.slice(src.indexOf('_pane_measurable() {'));
    const end = body.indexOf('\n}\n');
    const fn = body.slice(0, end);
    expect(fn, 'the probe must select the ACTIVE pane (F7)').toContain('#{pane_active}');
    expect(fn, 'the probe must read the width, not the height').toContain('#{pane_width}');
    expect(fn, 'the comparison must be against the derived constant').toContain('READER_MIN_COLS');
  });
});

describe('the phrase literals themselves are NOT changed (F11)', () => {
  it('ccd still greps the four phrases verbatim', () => {
    // Spec §6.3 is explicit that the regexes stay as they are and the guard is
    // what changes. A "fix" that widened `esc\s+to\s+interrupt` would still not
    // match across the newline grep never presents, and it would silently break
    // `auto-continue-armed.test.ts`'s cross-copy pin.
    const src = readFileSync(CCD, 'utf8');
    expect(src).toContain('grep -qiE "continuing automatically|continuing shortly"');
    expect(src).toContain('grep -q "esc to interrupt"');
    expect(src).toContain('grep -q "Enter to confirm"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Before running, temporarily delete the `_pane_measurable "$id" || return 0` guard from `_auto_stale_check` (Task 4, edit 4c) and re-stamp `ccd/ccd`.

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-reader-standdown.test.ts`

Expected: FAIL — `_auto_stale_check calls _pane_measurable before it matches a phrase` fails with `_auto_stale_check (ccd/ccd:<line>) matches a calibration phrase with no _pane_measurable guard ahead of it in the same function`, quoting the `echo "$pane" | grep -q "esc to interrupt" && return 0` line. **Do not match `<line>` against a number written here.** On today's `origin/main` that grep is `ccd/ccd:13442`, but Tasks 1 and 4 insert ahead of it — `READER_MIN_COLS` at ~999, `_pane_measurable` before 13351, and four guards in between — so by the time this step runs it has moved down by whatever those edits weigh. The assertion message is generated from the file; read the number it prints. **This is the red the scan exists for; it must be seen before the guard is restored.**

- [ ] **Step 3: Restore the guard and re-stamp**

Put `_auto_stale_check`'s guard back exactly as Task 4 step 4c writes it, then:

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; \
  const { markGenerated } = await import('./shared/mark.mjs'); \
  writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-reader-standdown.test.ts`

Expected: **PASS — 20**: the 10 behaviour cases Task 4 wrote (five under `_pane_measurable`, three under `_pane_auto_continue_armed holds when it cannot measure`, two under `the two stand-downs outside the phrase population`) plus 10 scan cases (`the census is exactly the enumerated population`, seven `it.each` rows — one per `POPULATION` key — `_pane_measurable is defined exactly once`, `ccd still greps the four phrases verbatim`). If the run reports 18, Task 4's last `describe` was dropped; if it reports 19, one of its two cases was.

- [ ] **Step 5: Mutation check over the whole population, then commit**

Delete each of the seven guards in turn, re-stamp, run `./node_modules/.bin/vitest run test/ccd-reader-standdown.test.ts`, confirm THAT function's row is the one that reds, and restore + re-stamp before the next. All seven must red individually — a guard whose deletion leaves the suite green is a guard the scan cannot see, and the population table is what must be fixed, never the assertion.

Then one anti-vacuity mutation: change `_auto_compact_check`'s `grep -q "esc to interrupt"` to `grep -q "esc to halt"` (with its guard intact) and confirm `the census is exactly the enumerated population` reds with `_auto_compact_check` missing. Restore and re-stamp.

```bash
git add server/test/ccd-reader-standdown.test.ts
git commit -m "$(cat <<'MSG'
test(ccd): the stand-down is a mechanism, not a convention

A whole-population scan over ccd/ccd: ten live phrase-carrying grep lines in
seven functions, each asserted to have a _pane_measurable guard ahead of it in
the same function, with the census itself pinned so deleting a guard and its
grep together cannot pass. Measured: all seven guards red individually when
removed. Spec §6.3's mutation test.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: Whole-branch verification, AGENT-FIRST deploy, PR

**Model routing (§9):** `sonnet`, effort `high`.

**Files:** none modified — this task runs, deploys and reports.

**Interfaces:**
- Consumes: everything Tasks 1–5 produced.
- Produces: the merged wave-2 branch and a fleet box carrying `win-size-v1`. Wave 3 consumes exactly four things from this wave — `READER_MIN_COLS` (`shared/api.ts`), `CCD_ARGV.winSize` and `WIN_SIZE_CAP` (`server/src/ccdargv.ts`), and the `win-size-v1` capability the deployed ccd advertises — reading the token through the EXISTING `capSupported` at its own seam, never through a wrapper this wave exports. It does **nothing** until this is on the box.

- [ ] **Step 1: Run all three package suites, in the foreground**

```bash
cd server && npm ci && npm run test
cd agent  && npm ci && npm run test
cd pwa    && npm ci && npm run test
```

Expected: PASS in all three (timeout ≥600000ms each, foreground). `pwa` is untouched by this wave and must be green unchanged. Re-run `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests` and `ccd-session-state` IN ISOLATION before calling any of them a real break.

- [ ] **Step 2: Cross-tree deviation check**

```bash
git fetch origin main && cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts
```

Expected: PASS. This compares this branch's `D-N` entries against `origin/main`'s without merging, and reds on any allocator-era number defined in two plans.

- [ ] **Step 3: Prove the verb is live on a fixture box, end to end**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-win-size.test.ts test/ccd-reader-standdown.test.ts \
  test/reader-min-cols.test.ts test/ccd-archive.test.ts test/caps-token-shape.test.ts \
  test/whitelist-subset.test.ts test/capsupported.test.ts test/ownership.test.ts \
  test/auto-continue-armed.test.ts
cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts
```

Expected: PASS. This is the wave's own surface in one run; if `ownership` reds, `ccd/ccd` was edited after the last re-stamp.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
gh pr create --base main --title "Terminal drawer wave 2: the un-pin verb, its grant, and the readers' stand-down" --body-file - <<'EOF'
Wave 2 of the terminal-drawer program (spec §6), **AGENT-FIRST**.

Three mechanisms, each with a test that reds when it is deleted:

1. **`ccd win-size --session <id> --mode smallest|canonical`** — a fleet-control
   verb, validated against `shared/roster.ts`'s ID_RE before a tmux target is
   built from it, scoped to `-t cc-<id>` and never global, refusing loudly
   rather than reporting a size change that did not happen. `smallest`
   un-latches `manual` so tmux follows the narrowest attached client (F5) —
   never `latest` (F4). Advertised as `win-size-v1`.
2. **The grant** — `['win-size','--session']` plus enrolment in
   `REQUIRED_VERB_FLAG`, so the bare shape is a TS2322 on the `LawfulGrants`
   proof line and a boot refusal (fixture `g11`). `tmux set-option` stays
   ungranted, which is the whole reason the un-pin is a ccd verb. The server
   gains one `CCD_ARGV` builder and `WIN_SIZE_CAP` — read with `capSupported`,
   never `verbSupported`: null must REFUSE for a verb that never existed. The
   gate itself lands in wave 3, at the seam that decides, rather than as a
   wrapper here with no production caller.
3. **`_pane_measurable`** — every ccd site that decides to type on a phrase
   match measures the ACTIVE pane first (F7) and stands down below
   `READER_MIN_COLS`. `_pane_auto_continue_armed` inverts, answering ARMED when
   unmeasurable: the one direction that cannot cancel a continuation. The regex
   literals are untouched (F11); `auto-continue-armed.test.ts`'s pin still holds.

`READER_MIN_COLS = 120` is derived, not chosen: `wrap-ansi` (Ink's wrapper,
`hard:false`) over Claude Code's known status-line carriers at widths 40–220
puts the widest carrier at 69 columns and the widest status segment at 37, so
120 carries a whole extra segment of margin while leaving a 171-column desktop
measurable and every phone below it. Two copies exist by construction
(`shared/api.ts`, `ccd/ccd`) and `reader-min-cols.test.ts` holds them equal.

**Deploy order is not optional.** `bash deploy/deploy.sh agent <host>` FIRST,
then `bash deploy/deploy.sh`. Wave 3 does nothing until this is on the box.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 5: Deploy — AGENT LANE FIRST, then the server lane**

**This wave is AGENT-FIRST and the order is the whole point.** `ccd/ccd` and
`agent/src/whitelist.ts` carry the verb and its grant; the agent caches
`ccd caps` at boot, and the server refuses to emit a verb the agent did not
advertise. Ship the server first and a box that has not learned `win-size`
still reports the capability it never had — or, worse, the readers on that box
have not learned to stand down while a server believes they have.

```bash
# 1. FLEET HOST FIRST — ccd/ccd (the verb, _pane_measurable, READER_MIN_COLS)
#    and agent/src/whitelist.ts (the grant). Coordinates come from
#    ~/.ccrc/deploy.env's CCRC_AGENT_BOX when no <host> is passed; the agent
#    lane NEVER falls back to CCRC_BOX.
bash deploy/deploy.sh agent <host>

# 2. Confirm the fleet box advertises the token before the server lane runs.
ccd caps | grep -x win-size-v1

# 3. ONLY THEN the server lane — shared/api.ts's READER_MIN_COLS,
#    server/src/ccdargv.ts's builder and token.
bash deploy/deploy.sh
```

Expected: step 2 prints `win-size-v1`. If it prints nothing, the agent lane did
not land — **stop, and do not run step 3.** The server lane's final gate is
`/health` reporting the shipped sha.

- [ ] **Step 6: Report**

Report to the coordinator: the branch tip sha, the three suites' results, the
`ccd caps | grep -x win-size-v1` output from the fleet box, the deploy order
actually executed, and every `D-N` entry defined in this plan's `## Deviations
found` section (or every `D-TBD-<slug>` if the allocator was unreachable —
worker clause 11).

---

## Deviations found

Numbers are ISSUED, never chosen: allocate with `POST /api/ledger/deviations` and DEFINE in the same act. A session that cannot reach the allocator writes `D-TBD-<slug>` and reports (worker clause 11). **Every number defined below was ISSUED by the programme coordinator**, across three separate assignments — each requested by mail when the previous ran out, none allocated by the worker, because a worker that mints its own numbers mid-wave is the D-2338 shape. Which assignment a given number came from is recorded in run 62's mail, and is deliberately NOT restated here.

Two deliberate absences, both mechanical rather than stylistic, because both of these sentences were false at some commit of this wave:
- **No block is written as a range.** `D-A..D-B` spells B contiguously, and an unassigned B seals its band forever — the number never enters the ledger and raises this project's floor anyway. This wave hit that trap three times across two sessions, every time by someone who had just stated the rule aloud, so the rule is now to remove the construct rather than to remember the exception.
- **No headroom accounting lives in this plan.** A sentence here saying which numbers remain unspent was falsified by the very next commit that spent one — twice. The coordinator holds that state; ask it rather than reading this file.

Only the first four entries (D-2775..D-2778) are pre-flight findings, measured against `origin/main` at `7a91bcf1` BEFORE Task 1 ran; three of those four exist because this plan was written against a tree that predates the routing slices (`c5dd6e41`), which landed a fifth gated verb, a sixth capability token and an eleventh bypass fixture between the plan's drafting and its execution. **Every other entry was found during execution or after it, and each says so in its own text** — in Task 1's fix round, while fixing Task 2's shipped verb, in Task 4's fix rounds, or in one of the review panels' passes over the finished branch. That per-entry sentence is the record; this preamble deliberately carries no index of which entry is which. An enumeration here was wrong at every commit that added an entry without sweeping it back, which is the same failure as the headroom sentence above and is removed for the same reason: read the entries.

- **D-2775** — **the bypass fixture is `g12`, not `g11`.** Task 3 Step 1(a) names `agent/test/types/bypasses/g11-win-size-without-session.ts`. That file name is taken: routing slice 1 shipped `g11-route-without-session.ts`, and `agent/test/whitelist-structural.test.ts`'s `EXPECTED` already carries its row. The win-size fixture is therefore **`g12-win-size-without-session.ts`**, and its `EXPECTED` entry is appended after the g11 row rather than after the g10 one. Nothing else about the fixture changes — it is still the bare-`['win-size']` shape, still expected `TS2322`, still the proof that the ENROLMENT and not the grant is what refuses it.

- **D-2776** — **`REQUIRED_VERB_FLAG` is APPENDED to, never replaced.** Task 3 Step 3 shows the whole object rewritten with four existing entries plus `win-size`. Measured on `main`, the object has **five**: `ws-reap`, `ws-rename`, `coord-pause`, `project-pool` and `route` — the last added by routing slice 1. Writing the plan's literal would silently drop `'route': '--session'`, narrowing a live grant from two tokens to one, which is precisely the widening `g11` exists to refuse. The edit adds one entry and keeps all five. (The mutation this plan asks for in Task 3 Step 6(1) — deleting `'win-size'` — is unaffected.)

- **D-2777** — **`KNOWN_CAPABILITY_TOKENS` keeps `route-v1`.** Task 2 Step 5 shows the array rewritten as `['account-v1', 'actor-flags-v1', 'lifecycle-v1', 'pools-v1', 'stop-surface', 'win-size-v1']`. Measured on `main` it is `['account-v1', 'actor-flags-v1', 'lifecycle-v1', 'pools-v1', 'route-v1', 'stop-surface']`. Dropping `route-v1` would not merely lose a pin: `ccd-archive.test.ts` partitions `ccd caps` output into verbs and capabilities by membership of this array, so a removed token is re-classified as a VERB and the caps-to-dispatcher parity assertion fails on a dispatcher that has no `route-v1)` arm. The edit adds `win-size-v1` to the six that are there.

- **D-2778** — **every anchor in this plan is located by CONTENT; its line numbers are not addresses.** `ccd/ccd` is 18075 lines at `7a91bcf1`; this plan's citations run 20-460 lines low throughout — `die()` 1072 -> 1112, `_tmux()` 1744 -> 1824, `STALE_PRESS_COOLDOWN` 999 -> 1020, `cmd_caps` 5927 -> 6019, `cmd_account_pane` 6394 -> 6492, `_pane_auto_continue_armed` 13351 -> 13537, `_auto_stale_check` 13429 -> 13615, `_auto_swap_check` 13521 -> 13707, `_auto_compact_check` 14096 -> 14461, `_accept_first_run_prompts` 14373 -> 14738, `_spawn_settle` 14832 -> 15252, `_inject_spawn_effort` 14905 -> 15357, `_redrive_after_spawn` 15023 -> 15512, the dispatcher 17525 -> 18060s. The TS files drift too (`['ws-rename','--session']` 396 -> 404; `whitelist-subset.test.ts`'s layer-3 block 222 -> 219 and its layer 2c `EXPECTED` 326 -> 329). Each quoted literal was located by `grep` and every insertion point verified against the surrounding code the plan describes; the descriptions all held, only the numbers had rotted. Recorded because a later reader comparing this branch's diff against the plan's stated line numbers would otherwise conclude the edits landed in the wrong places.

- **D-2779** — **Task 1's three guards were pinned against deletion and not against being WRONG.** `server/test/reader-min-cols.test.ts` shipped with (a) a comment asserting that the derivation reproduced Ink's own wrapper at `hard: false`, (b) a file header claiming to "re-assert the derivation's own bound" while the body asserted only `toBe(120)`, and (c) `toContain('wrap-ansi')` as a whole-file substring search over a 6944-line `shared/api.ts` and an 18000-line `ccd/ccd`. Each reddens on deletion; none reddens on a wrong implementation. Measured: Ink's `<Text>` defaults to `wrap="wrap"`, for which Ink calls `wrapAnsi(text, w, {trim: false, hard: true})` — two options different from the derivation's — though the per-carrier needs are IDENTICAL under both option sets, so 120 was never wrong and only the fidelity claim was; `toBe(120)` reds on a raise as well as a lower and passes at 110, which is above the derived floor of 106; and the derivation comment can be deleted entirely while `toContain` stays green on the token appearing anywhere else in either file. Fixed: the comments now state what was measured under BOTH wrapping modes and name `wrap-ansi@9` (at `@10` the same carriers measure 68 and 55, so a version-less claim is not reproducible), a literal `toBeGreaterThanOrEqual(69 + 37)` bound sits beside the equality pin as its declared mutation control, and the derivation check is bound to a window around each definition rather than to the file.

- **D-2780** — **`-t cc-<id>` is a tmux fnmatch PATTERN, not a session name, so `cmd_win_size`'s liveness refusal could never fire for a prefix and the verb would mutate a DIFFERENT session.** The plan mandated the bare `-t cc-<id>` form and the task's own test was titled "scoped to this session only"; neither was true of the code. Measured on tmux 3.4 over a private `-L` socket carrying `cc-demo-quiet-basin` and `cc-other-session`: `has-session -t cc-demo` → rc 0 (the prefix resolved); `set-option -t cc-demo window-size smallest` → rc 0, with `show-options -t cc-demo-quiet-basin` reporting `smallest`; `resize-window -t cc-demo -x 200 -y 40` → rc 0, leaving the real session at 200x40; and `-t 'cc-oth*'` → rc 0 against `cc-other-session`, so the resolution is fnmatch and not merely prefix. A multi-match target refuses (`-t 'cc-*'` → rc 1), which sharpens the hazard to the UNIQUE-prefix id. This is the verb whose id arrives from a route that carries no box token and validates nothing (D-2859), so the plan lost: all three call sites are now anchored, `has-session -t "=$t"` and both mutating arms `-t "=$t:"`. Measured for the remedy: `=cc-demo` → rc 1 `can't find session`, `=cc-demo-quiet-basin` → rc 0, and `=cc-oth*:` → rc 1, so `=` defeats fnmatch as well as prefix. The id class was separately widened in the direction that matters — its hostile set was drawn from SHELL hazards and pinned the class only against being NARROWED, so a class admitting `* ? : .` passed all eleven of its cases while those characters are exactly the tmux TARGET hazards.

- **D-2781** — **The unanchored-target class is SYSTEMIC, and this wave declares it rather than fixing it.** D-2780 anchored `cmd_win_size`. The same bare `cc-${id}` construction lives at least at `server/src/exec.ts`'s `target()`, at `server/src/pty.ts`'s `attachPty`, and — added by this wave's own Task 4 — at each of `_pane_measurable`'s call sites, which pass `-t "$(_tmux "$1")"`. Patching one site would leave the rest and no guard, which is fixing the instance instead of the claim, so the repair is deferred whole: every site that builds a `cc-<id>` target, plus a guard that reds on a bare `-t cc-`.

**The worst instance is `attachPty`** (`server/src/pty.ts`), which runs `tmux attach -t cc-${id}`. Measured: the target-SESSION family prefix-resolves exactly as the option-setting family does (`display-message -t cc-demo` answers `cc-demo-quiet-basin`; `-t '=cc-demo'` is refused). Because `tmux attach` is a full interactive terminal rather than a one-shot option write, a prefix id does not merely mutate the wrong window — it attaches the console drawer's pty to a DIFFERENT session, which would then stream that session's output and accept keystrokes into it. The ids reaching `_pane_measurable` are registry-sourced rather than wire-sourced, so those sites are a prefix-collision correctness bug (measuring the wrong session's width) and not an injection path; `attachPty`'s is neither, because D-2859 establishes that its id is arbitrary from the URL.

Two things this entry exists to carry forward, because a later wave will size work from it. First, the site inventory GREW inside this wave by exactly ONE TARGET CONSTRUCTION — `_pane_measurable`'s own `list-panes -t "$(_tmux "$1")"` — which its call sites reach but do not each build. An earlier draft of this sentence said Task 4 added eight; that conflated call sites with target constructions and is corrected here because wave 3 sizes directly from it. Measured at this branch's tip: `-t "$(_tmux` constructions go 19 → 20 across Task 4, and the whole branch adds two (this one and `cmd_win_size`'s `t=$(_tmux "$id")`, which D-2780 anchors with `=`). Second, and this is the part that bites: the remedy named above — "a guard that reds on a bare `-t cc-`" — would red on NONE of these sites. Every literal `-t cc-` in `ccd/ccd` is inside a comment (measured: zero outside one); `_tmux` expands to `cc-$1` only at runtime, so the guard wave 3 builds must scan the `_tmux` CALL, not the literal. Second, `server/src/clip.ts`'s `isSafeSessionId` is not the remedy it looks like — it bars `/`, `\`, NUL, `.` and `..` but ADMITS `*`, so adopting it at the pty route would not close this; only anchoring does.

- **D-2859** — **the grant's security rationale argued against a threat model weaker than the real one.** Three files (`agent/src/whitelist.ts`, the `g12` bypass fixture, `server/test/whitelist-subset.test.ts`) said the `:id` reaching `ccd win-size` "arrives off a JSON-parsed websocket frame rather than a path the router validated". Measured false at `server/src/server.ts`, in the `app.get('/ws/pty/:id', { websocket: true }, …)` handler: the id is `const { id } = req.params`, a PATH PARAM; the only frame that handler parses carries `type`/`data`/`cols`/`rows` and no id at all; and a scan of the whole handler body for `ID_RE`, `.test(`, `roster`, `validate`, `400` or an early refusal returns NOTHING, so nothing between the route and `spawnPty(id, cols, rows)` validates it. The corrected sentence is the STRONGER hazard, which is the point of recording this rather than quietly editing: the rationale was defending against a weaker threat than the one the tree presents. Two precisions the correction keeps, because overshooting here would be the same defect one level down: the route is NOT unauthenticated — `/ws/pty/:id` is absent from `auth/gate.ts`'s `EXEMPT` table, so with `CCRC_AUTH` armed the upgrade is session-gated like any other — and the claim is scoped to THAT HANDLER's body, which is what was measured. What is true and sufficient is that the route carries no BOX TOKEN and validates the id nowhere, so ccd's own id class is the entire gate. **The mandatory security lens at PR time IS this grant's review (operator ruling), so that lens must RE-DERIVE this provenance from `server.ts` itself and must not take the corrected comment on trust** — a comment is the thing being reviewed here, not the evidence for it.

- **D-2860** — **rc 6 joins 3/4/5 in the four enumerations that test that set BY VALUE.** Task 4 introduces rc 6 from `_accept_first_run_prompts`, and the plan is explicit that 3, 4 and 5 are load-bearing and must not be renumbered. They are not renumbered. But four callers — `cmd_ws_add`, `cmd_ws_restore`, `cmd_start` and `cmd_ensure` — test the set by VALUE rather than for non-zero, so a new member that does not join them is silently treated as success. **The evidence sentence that stood here has been overtaken by this branch's own later commit and is corrected rather than deleted, because the correction is the interesting part.** As first measured — on the tree where the rc 6 guard sat at the top of `_accept_first_run_prompts`, above the liveness probe — `ccd ws-add` printed `workspace <id> …` and exited 0 over a spawn nothing had confirmed. Commit `73c27283` then moved that guard BELOW the liveness probe and gated it on `[[ "$i" == 1 ]]` (see D-2866), so the same fixture now answers **rc 3**, not rc 0 and not rc 6: a dead session is refused by the probe before the width guard is ever consulted. The join is still required and still correct — a rc 6 that reached those four callers unjoined would still read as success — but it is no longer reachable by the route the original measurement took, and a reader re-running it would otherwise conclude the entry was fabricated. That is the overloaded-null defect this programme reds on, arriving through the front door. **Joining an enumeration is not renumbering it**, and this entry exists so a later reader comparing the diff against the plan's "must not renumber" sentence does not read the join as a violation of it.

- **D-2861** — **~50 bash `tmux` stubs across 14 suites had to learn the pane-width query.** `_pane_measurable` runs `list-panes -F '#{pane_active} #{pane_width}'` at ONE source line, reached from every §6.3 stand-down site, so every fixture whose stub does not answer that query makes the guard stand down INSIDE the test that means to exercise the path under test. The alternative considered and rejected was to leave the stubs alone: it is cheaper by 50 edits and it produces a guard that cannot fail — D-2774's shape one level up, a test that is green because nothing ran, not because something worked. The arm is discriminated on `*pane_active*` over the whole argument list rather than on `$1`, which was verified not to disturb the four `#{pane_pid}` readers that share the `list-panes` verb.

- **D-2862** — **`server/src/pty.ts`'s `attachPty` builds the same unanchored tmux target, and this wave DECLARES it without fixing it.** D-2780 established by measurement that `-t cc-<id>` is an fnmatch PATTERN, not a name, and anchored `cmd_win_size`'s three call sites with `=`. `attachPty` runs `spawn('tmux', ['attach', '-t', \`cc-${id}\`], …)` — unanchored — and D-2859 establishes that the `id` it interpolates is arbitrary from the URL. Measured on a private socket: the target-session family prefix-resolves exactly as the others do (`display-message -t cc-demo` answers `cc-demo-quiet-basin`, while `-t '=cc-demo'` is refused), and a session-id prefix shared by several live sessions resolves nondeterministically among them. This is the worst instance of D-2781's class, because `tmux attach` is a full interactive terminal rather than a one-shot option write: a prefix id attaches the drawer's pty to a DIFFERENT session, so the console would stream, and accept keystrokes into, someone else's terminal.

It is deferred rather than patched because the honest repair is the systemic one D-2781 declared — every site that builds a `cc-<id>` target, plus a guard that reds on a bare `-t cc-` — and patching this one site would leave the rest and no guard, which is fixing the instance instead of the claim. It is wave 3's first item, with its own mutation table.

This entry also RECORDS A REVERSED RULING rather than silently updating one. The programme's carried constraints held that no confused-deputy risk existed at this seam, on the stated ground that "the only caller encodes a registry id". D-2859 falsifies that premise: the caller validates nothing, so the guarantee lived entirely in a caller that does not provide it. The ruling was overturned by measurement, not by argument.

- **D-2863** — **this plan's own prescribed comment text states a wrapping claim that is false over a 50-column band, and the shipped source deliberately says something else.** Two of the code blocks above told the implementer to write, verbatim, that "a narrow pane wraps `esc to interrupt` between words" — the `_pane_measurable` bash header (Task 4 Step 3) and the `ccd-reader-standdown.test.ts` file header (Task 4 Step 1). Measured against this plan's OWN Task 1 derivation, that is false for every width from 70 to 119: the widest attested carrier needs 69 columns, so across a 50-column band the phrase sits on one line and the readers stand down anyway. The constant is not wrong — 120 is deliberately conservative, buying room for one status segment more than the sample carries (69 + 37 = 106) — but the REASON given for standing down at 119 was not the true one, and it was stated three times in shipped files plus twice here.

The shipped source now says "cannot be RELIED ON to sit on one line", which is both true and the actual argument: below the calibration width the phrase is not *guaranteed* to be intact, and a reader that types on a phrase it cannot trust is the 2026-09-08 failure. Task 1's `READER_MIN_COLS` comment (`ccd/ccd`) carried the false form outright and was corrected in the same round. The plan's two blocks are corrected in place above so a later wave copying them does not re-introduce it; this entry exists because a reader diffing the shipped comments against this plan would otherwise read the divergence as the implementer ignoring its brief. It was the brief that was wrong.

- **D-2864** — **`_pane_narrow_note` is a mechanism none of this wave's six tasks authorised, and it shipped pinned by nothing.** The plan's (4c) and (4d) stand-downs each prescribe a bare `return 0`. What shipped calls `_pane_narrow_note "$id" stale` / `… swap` first, and that function brings real fleet-visible behaviour: two new per-session registry fields (`stalenarrownote`, `swapnarrownote`), a reuse of `COMPACT_NOTE_FLOOR`, and a new append lane into `$REG/swap.log` on the 5-second supervise tick, plus edits to `_reg_purge`'s field census and `_reg_get`'s invocation cardinal. The plan named none of it: measured at `53ec06a6`, before this entry existed, `_pane_narrow_note`, `narrownote` and `COMPACT_NOTE_FLOOR` did not occur in it at all. (No current count is stated. This sentence's own earlier attempt to state one — "one apiece" — was false at the moment it was written, since writing the entry put several of each on this line.) The mechanism is RIGHT and is kept: `_pane_measurable` is the first statement after `_auto_swap_check`'s locals, so without the note a wedged session on a narrow pane is neither rescued nor marked and nothing anywhere says why. What was wrong is that its header argued three properties — that both guards call it as their first statement, that it is FLOORED, and that the anchor is PER-SITE — and not one of the three was a mechanism. This programme's standard is that a new guard ships with a test that reds when it is MUTATED, and its doctrine is that a comment is a request while a red suite is a mechanism. Both wrong implementations the review named passed the whole branch: deleting both call sites, and collapsing `${site}narrownote` to a shared `narrownote` — the second being the one the header says it refused, because `_auto_stale_check`'s line would then silence `_auto_swap_check`'s for the whole floor window. All three properties are now pinned.

- **D-2865** — **four prescribed claims were measured false and rewritten in shipped source; only one of the four was ledgered.** D-2863 records one instance and states its own remedy policy — that the plan's blocks are corrected in place "so a later wave copying them does not re-introduce it". Three siblings shipped with neither an entry nor that in-place repair, which matters because spec §8 gives wave 4 a documentation pass that will copy §6.1. They are: (1) the `READER_MIN_COLS` docstring's "and the mail lane holds", which nothing shipped ever made true, there being no width measurement on the path the constant guards (`inject/send.ts` measures a pane width for its own purposes, so the correction is scoped to the hold and does not call that file width-blind); (2) `cmd_win_size`'s canonical arm being "for an operator on the box and for ccd's own use", where measurement finds no ccd caller at all, so the callers are an operator and the agent's `win-size` grant; and (3) the `SCOPED TO -t cc-<id>, NEVER GLOBAL` block's claim that a `-t`-less `set-option` "writes the SERVER-WIDE default and re-sizes every live session on this box at once", which is false in both halves — re-measured on tmux 3.4 over a private `-L` socket with three detached sessions, `show-options -g window-size` still reads `latest` and no session is resized; exactly one window takes the option. All three are corrected in place above, and (2) is corrected in spec §6.1 as well, which is the copy wave 4 will take.

- **D-2866** — **the relocated guard: rc 3 where the plan's own edit text yields rc 6.** Edit (4f) prescribes `_pane_measurable "${1#cc-}" || return 6` inserted "directly after its `local …` declarations and before the `for i in $(seq 1 "$SPAWN_GATE_TRIES"); do` loop". What shipped sits INSIDE that loop, below the `has-session` liveness debounce, and is gated: `[[ "$i" == 1 ]] && ! _pane_measurable "${1#cc-}" && return 6`. The relocation is right — rc 6 means "I could not measure a LIVE pane", and a dead session must be refused as rc 3 by the probe rather than mis-reported as unmeasurable — but it is a behaviour change from the plan's literal, it was made under D-2860/D-2861's banner by commit `73c27283` without touching either entry, and it silently falsified D-2860's evidence (corrected there). Smaller departures than this were ledgered: D-2775 is a file rename. Recorded here so the diff-against-plan reader does not read the move as a transcription error.

- **D-2879** — **plan Task 4 edits (4e) and (4h) shipped as prescribed and were then REVERTED, with the argument recorded only in an inline comment.** Both prescribe passing the id to `_pane_auto_continue_armed`, giving the literals `_pane_auto_continue_armed "$pane" "$id"` and `_pane_auto_continue_armed "$(tmux capture-pane …)" "${t#cc-}"`. Both were implemented, then reverted by commit `73c27283`, leaving only (4i)'s `_redrive_after_spawn` passing the id; `_auto_compact_check` and `_inject_spawn_effort` each call the classifier with one argument. The reversal is RIGHT and is kept: at those two sites a second measurement cannot change the DECISION, only the WORD the site logs, and `_auto_compact_check`'s own comment explains that passing the id there would make it write `auto-continue "Claude Code is waiting out a limit on its own"` for a condition that is an unmeasurable pane — naming a cause it did not detect. That argument is exactly why this belongs in the durable record and not only in a comment. **To be exact about what departed, because an entry that overstates its own subject invites the departure to be "re-applied":** edits (4e) and (4h) each prescribe TWO things, a `_pane_measurable` stand-down AND the id-passing. Both stand-downs SHIPPED — `_auto_compact_check`'s `_compact_note … pane-narrow` and `_inject_spawn_effort`'s `/effort` stderr line, the first of which is a POPULATION row and would red the census if it were missing. Only the id-passing halves were reverted. A reader diffing the sweep against the plan finds those halves absent, and this is the reason. `ccd-reader-standdown.test.ts` names `73c27283` as the remover, so the branch knows it reverted them; the ledger did not.

- **D-2880** — **`isExecAllowed` admits `;` argv chaining, and this wave DECLARES it rather than fixing it.** Measured 2026-09-16: `isExecAllowed('tmux', ['has-session','-t','x',';','set-option','-g','window-size','manual'])` returns TRUE, and on a private `-L` socket that argv really runs both commands — `show-options -g window-size` went `latest` → `manual`. tmux treats a bare `;` ARGV ELEMENT as its own command separator with no shell involved, so no quoting or escaping is in play. The cause is structural: the check is `prefixes.some((p) => p.length <= args.length && p.every((tok, i) => args[i] === tok))`, so a granted prefix such as `['has-session']` matches and **every token after the prefix is unconstrained**. This reaches past the grant table entirely — including to `set-option`, which this wave was careful never to grant. **Ruled OUT of scope for this wave, deliberately:** it is unreachable from the PWA today, it is pre-existing rather than introduced here, and `isExecAllowed` is the single function gating the whole PWA→fleet path, where a wrong edit inside a fix round is the worst blast radius in this tree. Cost if that ruling is wrong: the hole stays open one more wave. **This is a wave-3 entry condition**, and it is recorded as a number rather than as a code comment because the established form here for a hazard declared and not fixed is a numbered entry — D-2781 and D-2862 are both exactly that — and because a comment is invisible to the ledger, to `deviation-refs` and to whoever sizes the follow-up.

- **D-2881** — **the S3 re-measure orphans the very refusal D-2879 argues for.** The fix for review finding S3 inserts `_pane_measurable "$id" || { … return 0; }` into `_redrive_after_spawn` directly above its `_pane_auto_continue_armed "$pane" "$id"` call, so that an unmeasurable pane stops being logged as `auto-continue armed` — a cause that line never detected. That is right, and it is kept. But `_redrive_after_spawn` was the ONLY remaining two-argument caller of the classifier: D-2879 records that edits (4e) and (4h) were reverted precisely because this site is where a second measurement DOES change the word, and `_auto_compact_check`'s own comment names this site as where the id belongs. With the new guard directly above it, the classifier's id arm (`[[ -n "${2:-}" ]] && ! _pane_measurable "$2" && return 0`) is now reachable only when the pane goes narrow BETWEEN two back-to-back `list-panes` calls. The id is deliberately KEPT rather than dropped — that race is real, the arm is defence in depth, and dropping it would leave the classifier's whole id parameter with no caller, which is a wave-3 decision and not a fix round's. Recorded because this is the new-guard-orphans-the-downstream-refusal shape, and because a later reader comparing D-2879's argument against the shipped tree would otherwise find the argument no longer describes the code.

**THE CALL-SITE COUNT IS NOT STATED IN PROSE ANYWHERE, BY RULE.** It lives in exactly one executable place — `server/test/ccd-reader-standdown.test.ts`'s `POPULATION` table — and every mention of it, here or in a comment, names that table without a digit beside it. The reason is measured, not stylistic: inside this one wave the number was wrong four separate times, in both directions, and twice inside a commit whose own subject line was about fixing it. A count a human has to sweep is a promise, not a mechanism; `POPULATION` reds. Anyone sizing work from this ledger runs the census and reads its rows.

Two facts the scan checked and did NOT have to deviate on, recorded because a reviewer will want to know they were measured rather than assumed: Task 5's `POPULATION` table is exactly right against this tree (ten live phrase-carrying `grep` lines across the seven named functions, with the two commented `grep -q "esc to interrupt"` prose mentions correctly excluded by the `/^\s*#/` filter — re-measured at this branch's tip, where they are the ONLY two, and deliberately located by content rather than by line, because the pair this sentence first carried had already rotted when it was written), and the id class Task 2 enforces is `shared/roster.ts`'s `ID_RE` verbatim (`/^[a-z][a-z0-9-]{0,31}$/`, the same literal `cmd_account_pane` already carries, with the same `die "bad id: $id"` sentence).

---

## Review lenses

Three lenses for this wave (spec §6.5), all `opus`, effort **`xhigh`** — §9's routing table raises per-PR review lenses to xhigh for wave 2 specifically.

1. **SECURITY (opus, xhigh, MANDATORY) — the exec grant.** The untrusted-input lens, run regardless of pool level. Prefix matching leaves every token after `['win-size','--session']` unconstrained; the session id arrives off a JSON-parsed frame on a route that carries no box token; ccd's own validation is the whole gate. The lens proves the bare shape fails to typecheck (`g11`, TS2322), that `auditExecWhitelist` refuses it at module load, that the id class is enforced before any `tmux` runs, and that `tmux set-option` remains ungranted in both directions.
2. **ccd call shape.** The verb's exit codes (`die` → 1 on every refusal, 0 with a one-word stdout on success, never a false success under `set -uo pipefail` with no `-e`), the `cmd_caps` advertisement in BOTH channels (verb list and capability token) and its parity with the dispatcher, and that the shared-server option mutation is scoped to `-t cc-<id>` and never global.
3. **Reader parity.** The TS and bash phrase sets still agree — `auto-continue-armed.test.ts`'s cross-copy pin still finds its literal inside the 8-line window; `armWindow` (`server/src/inject/send.ts:512`, the 8-line slice from D-2368's final review) is untouched; and the stand-down covers every typing site, with the population scan's census matching what a fresh `grep -n` over `ccd/ccd` finds.
