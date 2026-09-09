// `_auto_compact_check` — the proactive compactor's HONESTY, D-2013 and D-2014.
//
// Two defects, one function:
//
//   D-2013 — the compactor collapsed "the pane could not be read at all" and
//   "the pane was read and carries no `ctx` segment" into the same silent
//   `return 0`, and said nothing at all about the refusals BELOW the pct gate
//   (mid-turn / not-idle / not-quiet / drafting). Measured live 2026-09-08:
//   3 of 19 panes render no `ctx` segment, so they are permanently invisible
//   to the compactor and nothing anywhere says so.
//
//   D-2014 — the lastswap gate ASSERTED that "a swap landing already compacted
//   from summary" and suppressed for COMPACT_COOLDOWN on that assertion. On
//   2026-09-08 nine sessions landed on the gpt lane at 12:12:59 and no landing
//   compaction happened for `calm-river`: it sat at 98% for thirty minutes on
//   a premise that measurably did not hold.
//
// FIX ROUND B — four of this file's guards were COMMENTS until an adversarial
// reviewer deleted each and this suite stayed green. What that measured:
//
//   • the marker's "the field follows the truth" half was only ever exercised
//     by ticks whose reason never CHANGED, so the first, un-floored write had
//     already put the expected value there;
//   • `_compact_note_clear` on the SUCCESS path was asserted nowhere;
//   • `no-prompt` was the one reason of five with no case at all;
//   • the rate limit itself fell to the likeliest flap (an overlay hides the
//     statusline for a tick), because the clear erased the floor's own anchor.
//
// Every one of those now has a case that goes red when the mechanism is put
// back to a comment.
//
// FIXTURE HOME ONLY (`makeCcdHarness`) — HOME is ccd's single isolation
// boundary; nothing here may reach the live registry, tmux or systemd. The
// `tmux` stub RECORDS `send-keys` instead of sending it, which is what makes
// "no /compact fired" an assertion rather than an assumption.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-auto-compact-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const PANE_PID = '4242';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const skipLines = (): string[] =>
  swapLog().split('\n').filter((l) => l.includes(' compact-skip '));
const sendKeys = (): string[] => h.calls().filter((l) => l.includes('send-keys'));
/** The refusal slug alone — the marker's epoch half is `<when this reason
 *  became current>`, which no assertion here is about. */
const reason = (): string | null => {
  const rec = h.reg(ID, 'compactskip');
  return rec === null ? null : rec.replace(/^\d+ /, '');
};

/** A live-looking session on `claude`. `lastcompact`/`lastswap` deliberately
 *  absent so both cooldown gates start open — each case plants the one it is
 *  about. */
const seed = (): void => {
  h.sh(`_reg_set ${ID} uuid 11111111-1111-4111-8111-111111111111
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir "$HOME/projects/demo"
    _reg_set ${ID} wrapper claude
    _reg_set ${ID} started 1`);
};

const sessionsDir = (): string => path.join(h.home, '.claude', 'sessions');

/** `<config>/sessions/<pane pid>.json`, the file the idle and quiet gates read.
 *  `claude`'s configDirSuffix in the test roster is `.claude`. */
const sessionJson = (status: string, quietSeconds: number): void => {
  fs.mkdirSync(sessionsDir(), { recursive: true });
  fs.writeFileSync(path.join(sessionsDir(), `${PANE_PID}.json`), JSON.stringify({
    status, statusUpdatedAt: (Math.floor(Date.now() / 1000) - quietSeconds) * 1000,
  }));
};

/** The same file with a `status` and NO `statusUpdatedAt` — the quiet gate's
 *  unmeasurable case, which is not the same thing as "just touched". */
const sessionJsonNoStamp = (status: string): void => {
  fs.mkdirSync(sessionsDir(), { recursive: true });
  fs.writeFileSync(path.join(sessionsDir(), `${PANE_PID}.json`), JSON.stringify({ status }));
};

/** tmux, RECORDING. `capture-pane` answers `$PANE_TEXT` (both the plain and the
 *  `-e` capture) and exits `$CAPTURE_RC` — its own status is now load-bearing,
 *  because "tmux could not be asked" and "tmux answered blank" are two
 *  conditions. `list-panes` answers `$PANE_PID_OUT` so a case can make tmux
 *  name no pane pid. `send-keys` is logged and never sent; `_pane_box_draft` is
 *  stubbed empty except where a case is about the draft gate. */
const STUBS = `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in
      capture-pane) printf '%s\\n' "\${PANE_TEXT:-}"; return \${CAPTURE_RC:-0} ;;
      list-panes)   echo "\${PANE_PID_OUT-${PANE_PID}}" ;;
    esac; return 0; };
  _pane_box_draft() { :; };
  sleep() { :; };
`;

/** One supervisor tick of the compactor, n times, with `$PANE_TEXT` in scope. */
const tick = (pane: string, n = 1, extra = ''): string =>
  h.sh(`${STUBS} ${extra} PANE_TEXT=${JSON.stringify(pane)}
    for ((i=0;i<${n};i++)); do _auto_compact_check ${ID}; done`);

const AT_PROMPT = '▓ ctx ████████░░ 88%\n❯ ';
const MODEST = '▓ ctx ███░░░░░░░ 55%\n❯ ';
const LEAN = '▓ ctx █░░░░░░░░░ 12%\n❯ ';
const NO_CTX = '? for shortcuts\n❯ ';

// ── D-2013, the pane read ─────────────────────────────────────────────────

describe('D-2013: the pane read has THREE conditions and three recorded reasons', () => {
  it('tmux refusing to answer records `pane-unreadable` and says so with its rc', () => {
    // MEASURED, not named. `pane=$(tmux capture-pane … | tail -8)` reports
    // TAIL's status, so this condition was indistinguishable from a blank pane
    // and the slug pointed at a wedged tmux server that need not exist.
    seed();
    tick('', 1, 'CAPTURE_RC=1;');
    expect(reason()).toBe('pane-unreadable');
    expect(skipLines().join('\n')).toContain(`compact-skip ${ID}: pane-unreadable (tmux capture-pane rc=1)`);
  });

  it('tmux answering with a blank pane records `pane-blank`, the LIKELIER of the two', () => {
    // `_auto_compact_check` runs only under `PROBE_VERDICT == live`, so a live
    // pane that captured empty is the ordinary reading and a wedged server is
    // the exotic one.
    seed();
    tick('');
    expect(reason()).toBe('pane-blank');
    expect(skipLines().join('\n')).toContain(`compact-skip ${ID}: pane-blank (tmux capture-pane rc=0, empty capture)`);
  });

  it('a pane that WAS read but carries no ctx segment records `no-ctx-segment`', () => {
    seed();
    tick(NO_CTX);
    expect(reason()).toBe('no-ctx-segment');
  });

  it('the three are three values — the collapse is the defect', () => {
    // The mutation that must put this back to red is the shipped code before
    // D-2013 and before fix round B: one `[[ -n "$pane" ]] || return 0` over a
    // pipeline whose rc belongs to `tail`, plus a silent `[[ -n "$pct" ]]`.
    seed();
    const seen: (string | null)[] = [];
    for (const [pane, extra] of [['', 'CAPTURE_RC=1;'], ['', ''], [NO_CTX, '']] as const) {
      h.sh(`rm -f "$HOME/.cc-sessions/${ID}.compactskip" "$HOME/.cc-sessions/${ID}.compactnote"`);
      tick(pane, 1, extra);
      seen.push(reason());
    }
    expect(seen).toEqual(['pane-unreadable', 'pane-blank', 'no-ctx-segment']);
    expect(new Set(seen).size, 'two of the three collapsed to one reason').toBe(3);
  });
});

// ── D-2013, the refusals below the pct gate ───────────────────────────────

describe('D-2013: a session measured OVER threshold and then refused says so', () => {
  it('mid-turn records a reason and fires no send-keys', () => {
    seed(); sessionJson('idle', 600);
    tick(`▓ ctx █████████░ 91%\n  ⏵ esc to interrupt\n❯ `);
    expect(reason()).toBe('mid-turn');
    expect(skipLines().join('\n')).toContain(`compact-skip ${ID}: mid-turn (ctx 91%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('a pane with no prompt marker records `no-prompt`', () => {
    // The fifth reason, and the one the first cut of this suite never
    // exercised: over threshold, not mid-turn, and not at a `❯` either — a
    // dialog, a pager, a `/`-menu. Mutation that must put this back to red:
    // the bare `echo "$pane" | grep -q "❯" || return 0` this replaced.
    seed(); sessionJson('idle', 600);
    tick('▓ ctx ████████░░ 88%\n  Do you want to proceed?\n  1. Yes\n');
    expect(reason()).toBe('no-prompt');
    expect(skipLines().join('\n')).toContain(`compact-skip ${ID}: no-prompt (ctx 88%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('a MEASURED busy status records `not-idle` and names the status it read', () => {
    seed(); sessionJson('busy', 600);
    tick(AT_PROMPT);
    expect(reason()).toBe('not-idle');
    expect(skipLines().join('\n')).toContain(`compact-skip ${ID}: not-idle (status=busy ctx 88%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('an UNREADABLE sessions JSON is NOT `not-idle` — it records `status-unreadable`', () => {
    // The D-2013 defect at its narrowest seam. "The session is busy, wait" and
    // "the status could not be measured at all, go look at the box" are
    // different remedies, and the FIELD is all a reader has once the log line
    // is floored away. Mutation that must put this back to red:
    // `[[ "$st" == "idle" ]] || { _compact_note "$id" not-idle "status=${st:-unreadable} …"; }`.
    seed();   // no sessions JSON written at all
    tick(AT_PROMPT);
    expect(reason()).toBe('status-unreadable');
    expect(skipLines().join('\n'))
      .toContain(`compact-skip ${ID}: status-unreadable (no status in ${sessionsDir()}/${PANE_PID}.json, ctx 88%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('tmux naming no pane pid records `no-pane-pid`, not a status verdict', () => {
    // The third flavour of "$st is empty": there was never a pid to look a
    // session file up by, so `_cfg_dir`/`sessions/.json` is not the place to
    // send the operator.
    seed(); sessionJson('idle', 600);
    tick(AT_PROMPT, 1, "PANE_PID_OUT='';");
    expect(reason()).toBe('no-pane-pid');
    expect(skipLines().join('\n'))
      .toContain(`compact-skip ${ID}: no-pane-pid (tmux list-panes named no pane pid, ctx 88%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('an idle session someone just touched records `not-quiet`', () => {
    seed(); sessionJson('idle', 0);
    tick(AT_PROMPT);
    expect(reason()).toBe('not-quiet');
    expect(skipLines().join('\n')).toContain(`compact-skip ${ID}: not-quiet (ctx 88%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('a MISSING statusUpdatedAt is not "just touched" — it records `quiet-unmeasured`', () => {
    // Same split, one gate lower: the old `[[ -n "$sua" && … ]]` folded "the
    // quiet window could not be measured" into `not-quiet`, which claims
    // somebody touched the session. Both still refuse — the difference is what
    // the registry tells the operator to do about it.
    seed(); sessionJsonNoStamp('idle');
    tick(AT_PROMPT);
    expect(reason()).toBe('quiet-unmeasured');
    expect(skipLines().join('\n'))
      .toContain(`compact-skip ${ID}: quiet-unmeasured (no statusUpdatedAt in ${sessionsDir()}/${PANE_PID}.json, ctx 88%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('a half-typed draft records `drafting`', () => {
    seed(); sessionJson('idle', 600);
    tick(AT_PROMPT, 1, '_pane_box_draft() { echo "> half a thought"; };');
    expect(reason()).toBe('drafting');
    expect(sendKeys()).toEqual([]);
  });

  it('a measured, healthy, below-threshold session clears a stale reason', () => {
    // The field must not outlive the condition it describes: a stale
    // `mid-turn` read as current is the same class of lie D-2012 names on the
    // server side.
    seed(); sessionJson('idle', 600);
    tick(`▓ ctx █████████░ 91%\n  ⏵ esc to interrupt\n❯ `);
    expect(h.reg(ID, 'compactskip')).not.toBeNull();
    tick(LEAN);
    expect(h.reg(ID, 'compactskip')).toBeNull();
  });

  it('a session that goes on to COMPACT clears the reason it was refused for', () => {
    // The success path's own clear, which nothing asserted. The live
    // consequence of dropping it: refuse `not-quiet` at 88%, next tick the
    // session goes quiet and compacts — and because `lastcompact` then
    // short-circuits this function for COMPACT_COOLDOWN (1800s), the registry
    // goes on claiming `not-quiet` for half an hour after the compaction
    // actually fired. Mutation that must put this back to red: delete the
    // `_compact_note_clear "$id"` above `_reg_set "$id" lastcompact "$now"`.
    seed(); sessionJson('idle', 0);
    tick(AT_PROMPT);
    expect(reason()).toBe('not-quiet');
    sessionJson('idle', 600);
    tick(AT_PROMPT);
    expect(sendKeys().join('\n')).toContain('/compact');
    expect(h.reg(ID, 'compactskip'),
      'the compaction fired and the refusal marker outlived it').toBeNull();
    expect(h.reg(ID, 'lastcompact')).toMatch(/^\d{10}$/);
  });
});

// ── D-2013, the rate limit ────────────────────────────────────────────────

describe('D-2013: the rate limit actually limits', () => {
  it('twelve ticks of ONE unchanged refusal write ONE swap.log line', () => {
    // The loop ticks every 5s and swap.log is ~4,700 lines read by humans:
    // twelve ticks is one minute of one session. The MARKER follows the truth
    // every tick; only the LOG waits — `_strand_mark`'s two-fields shape.
    seed();
    tick(NO_CTX, 12);
    expect(skipLines()).toHaveLength(1);
    expect(reason()).toBe('no-ctx-segment');
  });

  it('the MARKER follows a reason that CHANGES inside the floor window, and the log still waits', () => {
    // The half of the design that justifies two fields, and the half nothing
    // measured: with one un-floored write per condition, a suite that never
    // changes the reason inside the window cannot tell "the field follows the
    // truth" from "the first tick happened to write the right thing".
    // Mutation that must put this back to red: make the marker write only when
    // the field is absent (`[[ -n "$rec" ]] ||`), or drop it entirely.
    seed();
    tick('', 1, 'CAPTURE_RC=1;');
    expect(reason()).toBe('pane-unreadable');
    expect(skipLines()).toHaveLength(1);
    const spokeAt = h.reg(ID, 'compactnote');
    tick(NO_CTX);                       // same floor window, DIFFERENT reason
    expect(reason(), 'the registry still names last tick’s refusal').toBe('no-ctx-segment');
    expect(skipLines(), 'the log spoke twice inside one floor window').toHaveLength(1);
    expect(h.reg(ID, 'compactnote'), 'the floor’s anchor moved without a line').toBe(spokeAt);
  });

  it('a FLAPPING reason does not defeat the floor — 10 alternations, one line', () => {
    // The shape that beat the rate limit when the floor's anchor lived inside
    // the marker: `_compact_note_clear` erased the stamp on every
    // below-threshold tick, so the next refusal fell through the digit guard
    // and logged again — measured at 10 lines for 10 alternations, i.e. 6 a
    // minute per session at the 5s tick. It is the LIKELY shape, not a
    // contrived one: D-2012's overlay hides the statusline for a tick, and
    // 3 of 19 live panes render no `ctx` segment at all. Mutation that must
    // put this back to red: `rm -f -- "$REG/$1.compactnote"` inside
    // `_compact_note_clear`.
    seed();
    h.sh(`${STUBS}
      for ((i=0;i<10;i++)); do
        PANE_TEXT=${JSON.stringify(LEAN)}; _auto_compact_check ${ID}
        PANE_TEXT=${JSON.stringify(NO_CTX)}; _auto_compact_check ${ID}
      done`);
    expect(skipLines()).toHaveLength(1);
    expect(reason()).toBe('no-ctx-segment');
    expect(h.reg(ID, 'compactnote'), 'the clear took the floor’s anchor with it').toMatch(/^\d{10}$/);
  });

  it('the floor is what holds it back, not a one-shot latch', () => {
    // Age the recorded stamp past COMPACT_NOTE_FLOOR and the next tick speaks
    // again: the mechanism is a window, so a condition that persists for days
    // stays visible in the log without ever being per-tick.
    seed();
    tick(NO_CTX);
    expect(skipLines()).toHaveLength(1);
    h.sh(`_reg_set ${ID} compactnote "$(( $(date +%s) - 99999 ))"`);
    tick(NO_CTX);
    expect(skipLines()).toHaveLength(2);
  });
});

// ── D-2014 ────────────────────────────────────────────────────────────────

describe('D-2014: the lastswap gate MEASURES the session instead of asserting the landing', () => {
  it('a freshly-landed session near its wall is compacted — the veto is not worth taking', () => {
    // NOT "95% proves no landing compaction happened": the plan that issued
    // D-2014 measures a session climbing 45% -> 91.5% in nine minutes, well
    // inside this window, so a landed-and-compacted session can be here too.
    // What 95% establishes is that this session is near its wall NOW, which is
    // the only fact the decision needs — a redundant compaction costs ~500s on
    // the gpt lane against a wedge measured at 80.7 minutes. Mutation that must
    // put this back to red: restore the bare
    // `[[ "$lastswap" =~ ^[0-9]+$ && $((now - lastswap)) -lt "$COMPACT_COOLDOWN" ]] && return 0`.
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastswap "$(date +%s)"`);
    tick('▓ ctx █████████░ 95%\n❯ ');
    expect(sendKeys().join('\n')).toContain('/compact');
    expect(h.reg(ID, 'lastcompact')).toMatch(/^\d{10}$/);
    expect(swapLog()).toContain(`auto-compact ${ID}: ctx 95%`);
  });

  it('a freshly-landed session at a modest context is still left alone', () => {
    // The conservative half survives: 55% is over COMPACT_THRESHOLD but well
    // under the wall, so "the landing already compacted" is still the best
    // available reading and the double-compaction it exists to prevent stays
    // prevented — and nothing is at risk while that reading is wrong.
    // Refusing is now SAID rather than silent.
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastswap "$(date +%s)"`);
    tick(MODEST);
    expect(sendKeys()).toEqual([]);
    expect(h.reg(ID, 'lastcompact')).toBeNull();
    expect(reason()).toBe('post-swap');
  });

  it('a STALE lastswap is no gate at all — the cooldown still bounds the window', () => {
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastswap "$(( $(date +%s) - 99999 ))"`);
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
  });

  it('the lastcompact cooldown is untouched — this wave widened one gate, not two', () => {
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastcompact "$(date +%s)"`);
    tick('▓ ctx █████████░ 95%\n❯ ');
    expect(sendKeys()).toEqual([]);
  });
});

// ── The capture WINDOW — fix round 2 ──────────────────────────────────────
//
// A fix-round cut of the pane read split the capture across two statements to
// "recover" tmux's exit status:
//
//     cap=$(tmux capture-pane … -p); prc=$?
//     pane=$(printf '%s\n' "$cap" | tail -8)
//
// The status never needed recovering — ccd sets `pipefail` on line 9, so `$?`
// after `tmux … | tail -8` is already tmux's. What the reshaping DID do was
// silently widen the window every gate below reads: `$( )` strips trailing
// newlines, so capturing first and piping second makes `tail -8` take 8 lines
// of CONTENT where it used to take the last 8 pane ROWS.
//
// That is a behaviour change on a live gate, not a refactor. `esc to interrupt`
// scrolls up the pane as a turn ends; a window that reaches further back sees a
// STALE banner and refuses `mid-turn` forever, and `❯` matched further back
// means an older prompt line satisfies the at-a-prompt gate while a dialog owns
// the screen — which is how `/compact` gets typed into a menu.
//
// The pane below is the reviewer's measured shape: 12 content rows then 4 blank
// rows. Last-8-ROWS sees rows 9-16 (four content lines); last-8-CONTENT-lines
// sees rows 5-12 — and the stale banner sits at row 5, inside one window and
// outside the other. PANE_TEXT cannot express this (`JSON.stringify`'s `\n`
// stays a literal backslash-n inside bash double quotes, which is invisible to
// every other case here because they only ever substring-match), so this stub
// cats a real file.
describe('the capture window is the last 8 pane ROWS, not 8 lines of content', () => {
  const PANE_FILE = (): string => path.join(h.home, 'pane-rows.txt');

  /** tmux, recording, answering `capture-pane` from a real file so blank rows
   *  survive into the pipeline. */
  const FILE_STUBS = `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
      case "\${1:-}" in
        capture-pane) cat "$HOME/pane-rows.txt" ;;
        list-panes)   echo "${PANE_PID}" ;;
      esac; return 0; };
    _pane_box_draft() { :; };
    sleep() { :; };
  `;

  /** 16 rows: a stale `esc to interrupt` at row 5, the statusline at row 11,
   *  the prompt at row 12, then four blank rows. */
  const writePane = (): void => {
    const rows = [
      'row1', 'row2', 'row3', 'row4',
      '  esc to interrupt',
      'row6', 'row7', 'row8', 'row9', 'row10',
      '▓ ctx ████████░░ 88%',
      '❯ ',
      '', '', '', '',
    ];
    fs.writeFileSync(PANE_FILE(), rows.join('\n'));
  };

  it('does not see a stale `esc to interrupt` four rows above the window', () => {
    seed(); sessionJson('idle', 600);
    writePane();
    h.sh(`${FILE_STUBS} _auto_compact_check ${ID}`);
    // The banner is outside the last 8 ROWS, so the session is at a clean
    // prompt and compacts. Under the widened window it reads `mid-turn` and
    // never compacts again.
    expect(reason()).toBeNull();
    expect(sendKeys().join('\n')).toContain('/compact');
  });

  it('still sees a banner that is genuinely inside the window', () => {
    // The other direction: the same gate must keep working. A banner at row 12
    // is inside the last 8 rows under either shape, so this pins that the case
    // above passes by WINDOW POSITION and not because the gate stopped firing.
    seed(); sessionJson('idle', 600);
    fs.writeFileSync(PANE_FILE(), [
      'row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7', 'row8', 'row9', 'row10',
      '▓ ctx ████████░░ 88%',
      '  esc to interrupt',
      '', '', '', '',
    ].join('\n'));
    h.sh(`${FILE_STUBS} _auto_compact_check ${ID}`);
    expect(reason()).toBe('mid-turn');
    expect(sendKeys()).toEqual([]);
  });
});

describe('an armed auto-continue is never cancelled by /compact (D-2229)', () => {
  const ARMED = [
    '  ▓ ctx ████████░░ 61%',
    'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel',
    '❯ ',
  ].join('\n');
  it('a pane waiting out a limit gets no keystroke, and the note says why', () => {
    seed(); sessionJson('idle', 120);
    tick(ARMED);
    expect(sendKeys()).toEqual([]);
    expect(reason()).toBe('auto-continue');
    expect(skipLines().at(-1)).toContain('compact-skip demo-quiet-mesa: auto-continue');
  });
  it('the "continuing shortly" variant is the same wait', () => {
    seed(); sessionJson('idle', 120);
    tick(ARMED.replace('continuing automatically at 11:50am', 'continuing shortly'));
    expect(sendKeys()).toEqual([]);
    expect(reason()).toBe('auto-continue');
  });
  it('control: the same pane without the wait line compacts', () => {
    seed(); sessionJson('idle', 120);
    tick(ARMED.split('\n').filter((l) => !l.includes('Usage limit')).join('\n'));
    expect(sendKeys().some((k) => k.includes('/compact'))).toBe(true);
  });
});
