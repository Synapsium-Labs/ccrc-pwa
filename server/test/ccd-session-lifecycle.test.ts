/**
 * The bash half of §4.3's one classification — ccd's `_session_state`, EXECUTED
 * for real against a fixture HOME, driven from the same `LIFECYCLE_FIXTURE` the
 * TypeScript ladder is driven from.
 *
 * Harness: `makeCcdHarness` (ccdWsHelpers.ts), the isolated-HOME idiom every ccd
 * test file uses — HOME is the ONLY isolation boundary ccd has, and `$REG` is
 * `$HOME/.cc-sessions`, so planting stamps there is planting them where the real
 * function reads. THE LIVE HOME IS NEVER TOUCHED.
 *
 * Two stubs, both structural rather than convenient:
 *   - `_alive` — tmux does not exist under test, and the pane's liveness is a
 *     fixture INPUT, not something to measure.
 *   - `date` — stubbed for `+%s` only (everything else falls through to
 *     `command date`), so the 120-second freshness boundary is an exact
 *     assertion. A wall-clock read would make the 119s/120s rows race the
 *     second hand and flake roughly one run in a thousand, which is how a
 *     boundary case gets marked skipped and the boundary stops being tested.
 *
 * THIS FILE IS NOT RED-THEN-GREEN ON THE BASH SIDE. `_session_state` already
 * exists (ccd D3 task); this file is red only on the missing `shared/` imports
 * until Step 3 lands. After that it either confirms the twin agrees row for row,
 * or it names the row where the two implementations already disagree — which is
 * the entire reason the fixture exists. If it goes red on a ROW, fix ccd. Never
 * the fixture.
 */
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SESSION_LIFECYCLES } from '../../shared/api.js';
import {
  FIXTURE_NOW_SEC, LIFECYCLE_FIXTURE, type LifecycleFixtureRow,
} from './sessionLifecycleFixture.js';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-lifecycle-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-basin';

/** The fixed-clock preamble every snippet opens with. `${1:-}` rather than `$1`
 *  because ccd runs under `set -uo pipefail`: a bare `$1` in a function called
 *  with no arguments is an unbound-variable error, and with no `-e` the script
 *  would sail past it having answered nothing.
 *
 *  DEVIATION FROM THE BRIEF (see task-8-report.md): the brief's draft had the
 *  `date` stub echo `"$now"` — a reference to the top-level `now=…` variable
 *  set on the previous line. That is a real bug, found by running it (exactly
 *  the class DISPATCH-CONTEXT §2 warns about): `_session_state` itself
 *  declares `local id="$1" sup fresh=0 now`, and bash's DYNAMIC scoping for
 *  locals means that when `_session_state` calls `date +%s`, our `date`
 *  function sees `_session_state`'s own (as-yet-unassigned) local `now`
 *  instead of the top-level fixture clock — under `set -u` that is an
 *  unbound-variable error, `now=$(date +%s)` silently assigns an empty
 *  string, and every row misclassifies (a fresh heartbeat reads stale).
 *  Reproduced directly against real ccd before this file existed. The fix:
 *  the stub echoes the LITERAL epoch instead of a variable, so it cannot be
 *  shadowed by any callee's `local` of the same name. `now=…` stays, because
 *  the snippets below still use `$((now-N))` at TOP level (this test file's
 *  own scope, never inside `_session_state`) to compute stamp ages. */
const CLOCK = [
  `now=${FIXTURE_NOW_SEC}`,
  `date() { if [[ "\${1:-}" == "+%s" ]]; then echo ${FIXTURE_NOW_SEC}; else command date "$@"; fi; }`,
].join('\n');

/** One fixture row → a bash snippet that plants the registry stamps the row
 *  describes and then asks ccd for its verdict. */
const plantAndAsk = (row: LifecycleFixtureRow): string => {
  const lines = [
    CLOCK,
    `rm -f "$REG/${ID}".*`,
    row.alive ? '_alive() { return 0; }' : '_alive() { return 1; }',
  ];
  // Parenthesized, not `now-${age}`: a NEGATIVE age (a future-dated stamp,
  // clock skew) renders as `$((now--60))`, which bash parses as a decrement
  // operator and rejects with a syntax error — so the stamp silently never
  // gets written, `_reg_get` reads "no stamp", and ccd answers `unsupervised`
  // for BOTH a correct and a mutated freshness guard, proving nothing. Fix
  // found and confirmed by review round 1 (task-8-report.md): `$((now -
  // (-60)))` parses as `now + 60` as intended, and a positive age is
  // unaffected by the added parens.
  if (row.supervisedAgoSec !== null) {
    lines.push(`printf '%s' "$((now - (${row.supervisedAgoSec})))" > "$REG/${ID}.supervised"`);
  }
  if (row.stoppedAgoSec !== null) {
    lines.push(`printf '%s %s' "$((now - (${row.stoppedAgoSec})))" '${row.stopSurface ?? 'ccd'}' > "$REG/${ID}.stopped"`);
  }
  if (row.started) lines.push(`printf 1 > "$REG/${ID}.started"`);
  lines.push(`_session_state ${ID}`);
  return lines.join('\n');
};

describe('ccd _session_state answers the §4.3 table, row for row', () => {
  for (const row of LIFECYCLE_FIXTURE) {
    if (row.serverOnly !== null) {
      // NOT silently dropped: the exemption is named, with its reason, in the
      // suite output. `session-lifecycle.test.ts` pins that this is the only
      // kind of row that may carry one.
      it.skip(`${row.name} — SERVER ONLY: ${row.serverOnly}`, () => { /* see reason */ });
      continue;
    }
    // Each row kills the bash mutant that collapses its rung into the next:
    // dropping the stop-stamp check answers `restarting`/`orphan` for a
    // deliberate stop; dropping the freshness arithmetic answers `running` for
    // a pane whose supervisor died two hours ago.
    it(row.name, () => {
      expect(h.sh(plantAndAsk(row))).toBe(row.expect);
    });
  }

  it('actually drove the bash twin — an all-skipped fixture would pass vacuously', () => {
    expect(LIFECYCLE_FIXTURE.filter((r) => r.serverOnly === null).length).toBeGreaterThan(6);
  });
});

// The OTHER direction, and the one a per-row loop cannot cover: a state ccd
// grows that `shared/` never heard of. `wrapper-roster-fixture.test.ts`'s header
// states the rule — every comparison is a SET equality over ccd's own answer
// space, "parsed or enumerated", never "each fixture row got a matching answer".
// Enumerated here rather than parsed: the full plantable input space is 24
// combinations, so ccd's complete answer space is measurable by RUNNING it,
// which is stronger than reading its source and cannot be fooled by an `echo`
// this file's regex did not anticipate.
describe("ccd -> shared: _session_state's answer space is exactly SESSION_LIFECYCLES minus unmeasurable", () => {
  const ENUMERATE = [
    CLOCK,
    'for a in 0 1; do',
    '  for s in none fresh stale; do',
    '    for k in none yes; do',
    '      for t in none yes; do',
    '        rm -f "$REG/probe".*',
    "        [[ \"$s\" == fresh ]] && printf '%s' \"$((now-5))\" > \"$REG/probe.supervised\"",
    "        [[ \"$s\" == stale ]] && printf '%s' \"$((now-600))\" > \"$REG/probe.supervised\"",
    "        [[ \"$k\" == yes ]] && printf '%s ccd' \"$((now-90))\" > \"$REG/probe.stopped\"",
    '        [[ "$t" == yes ]] && printf 1 > "$REG/probe.started"',
    '        if [[ "$a" == 1 ]]; then _alive() { return 0; }; else _alive() { return 1; }; fi',
    '        _session_state probe',
    '      done',
    '    done',
    '  done',
    'done',
  ].join('\n');

  it('enumerates every state ccd can produce, over the full plantable input space', () => {
    const answers = h.sh(ENUMERATE).split('\n').map((l) => l.trim()).filter(Boolean);
    // 2 alive x 3 heartbeat x 2 stop x 2 started — the whole space, so a state
    // ccd can reach cannot hide in a combination this test did not try.
    expect(answers).toHaveLength(24);
    const got = [...new Set(answers)].sort();
    const want = SESSION_LIFECYCLES.filter((s) => s !== 'unmeasurable').slice().sort();
    expect(got).toEqual(want);
  });
});

// §1.6 — the new rung, in the implementation that ships on the fleet box. The
// derived set-equality tail above moves 6 -> 7 on its own, because the sweep
// already plants `alive` x `started: none`; what it CANNOT state is where the
// rung sits, so that gets its own assertions here.
describe('the unclaimed rung in bash, and its POSITION', () => {
  const ask = (lines: string[]): string => h.sh([
    CLOCK, `rm -f "$REG/${ID}".*`, '_alive() { return 0; }', ...lines, `_session_state ${ID}`,
  ].join('\n'));

  it('a live pane with a FRESH heartbeat and no claim reads unclaimed, never running', () => {
    // THE ORDERING CONTRACT, in the implementation that ships on the fleet box.
    // The specimen was alive AND supervised AND unclaimed; an `unclaimed`
    // checked after `running` could never fire on it.
    expect(ask([`printf '%s' "$((now - 5))" > "$REG/${ID}.supervised"`])).toBe('unclaimed');
  });

  it('and it wins over unsupervised too', () => {
    expect(ask([])).toBe('unclaimed');
  });

  it('a claimed live pane is unaffected — running and unsupervised still answer', () => {
    expect(ask([`printf '%s' "$((now - 5))" > "$REG/${ID}.supervised"`, `printf 1 > "$REG/${ID}.started"`]))
      .toBe('running');
    expect(ask([`printf 1 > "$REG/${ID}.started"`])).toBe('unsupervised');
  });

  it('a DEAD pane with no claim is still never-started, not unclaimed', () => {
    // The rung is inside the alive branch. `unclaimed` says a process is
    // running that no registry row claims — the repair is a CLAIM. `orphan`
    // says nothing is bringing this back — the repair is a PROCESS.
    const out = h.sh([CLOCK, `rm -f "$REG/${ID}".*`, '_alive() { return 1; }', `_session_state ${ID}`].join('\n'));
    expect(out).toBe('never-started');
  });

  it('the word is in the function BODY, and the header comment names it too', () => {
    // NOT a comment assertion, though the plan's title said so: `type`
    // deparses from the parse tree and comments do not survive it (measured in
    // batch B4 against `cmd_ws_add`). So this hit is the `echo unclaimed`
    // itself — which is still worth pinning: it reds if the rung is deleted
    // wholesale, one rung earlier than a behavioural case would notice a
    // partial edit. The HEADER comment's own enumeration is pinned by reading
    // the shipped file, because that is the only place it exists.
    expect(h.sh('type _session_state')).toContain('unclaimed');
    // Through `CCD`, never a second spelling of the script's path: that is one
    // of `single-definition.test.ts`'s pins, and a `new URL(…)` relative to
    // this file turned it red (measured). Which is also why this comment does
    // not write that relative path out — the guard scans comments too.
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain(
      '_session_state() {   # id -> running|unsupervised|unclaimed|stopped|restarting|orphan|never-started');
  });
});
