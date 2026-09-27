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
import { execFileSync } from 'node:child_process';
import { makeCcdHarness, CCD, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

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
 *  `-e` capture) — through `%b`, so the `\n` JSON.stringify leaves in it is a
 *  real row break, as in a real capture, and not one long line — and exits `$CAPTURE_RC` — its own status is now load-bearing,
 *  because "tmux could not be asked" and "tmux answered blank" are two
 *  conditions. `list-panes` answers `$PANE_PID_OUT` so a case can make tmux
 *  name no pane pid. `send-keys` is logged and never sent; `_pane_box_draft` is
 *  stubbed empty except where a case is about the draft gate. */
const STUBS = `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE}
    case "\${1:-}" in
      capture-pane) printf '%b\\n' "\${PANE_TEXT:-}"; return \${CAPTURE_RC:-0} ;;
      list-panes)   echo "\${PANE_PID_OUT-${PANE_PID}}" ;;
    esac; return 0; };
  _pane_box_draft() { :; };
  sleep() { :; };
`;

/** One supervisor tick of the compactor, n times, with `$PANE_TEXT` in scope. */
const tick = (pane: string, n = 1, extra = ''): string =>
  h.sh(`${STUBS} ${extra} PANE_TEXT=${JSON.stringify(pane)}
    for ((i=0;i<${n};i++)); do _auto_compact_check ${ID}; done`);

/** The statusline ROW as statusline-command.sh draws it, `👤` first — the
 *  only line `_pane_ctx_pct` reads ctx from. Real Claude Code layout: the row
 *  sits BELOW the prompt box, so every pane below puts it after the `❯` row. */
const SL = (bar: string, pct: number): string => `  👤 acct-a │ 🤖 Opus 5 · high │ ⎇ ws/quiet-mesa │ ▓ ctx ${bar} ${pct}%`;
/** The prompt box as Claude Code draws it, row under it: top rule, `❯`, bottom
 *  rule, statusline. The bottom rule is load-bearing — without it the draft
 *  guard reads the statusline row as text typed into the box. */
const RULE = '─'.repeat(40);
const BOX = (row: string): string => `${RULE}\n❯ \n${RULE}\n${row}`;
const AT_PROMPT = BOX(SL('████████░░', 88));
const MODEST = BOX(SL('███░░░░░░░', 55));
/** Below COMPACT_THRESHOLD (50) and above the worker's own 40 — the one
 *  reading that tells a per-session threshold from the default. */
const BELOW_DEFAULT = BOX(SL('██░░░░░░░░', 45));
const LEAN = BOX(SL('█░░░░░░░░░', 12));
const NO_CTX = '? for shortcuts\n❯ ';
/** Older than COMPACT_COOLDOWN and than SWAP_COOLDOWN's post-swap window, so a
 *  planted `lastcompact` opens the cooldown gate instead of closing it. */
const COOLDOWN_PAST = 2000;

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
    tick(`  ⏵ esc to interrupt\n${BOX(SL('█████████░', 91))}`);
    expect(reason()).toBe('mid-turn');
    expect(skipLines().join('\n')).toContain(`compact-skip ${ID}: mid-turn (ctx 91%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('a pane with no prompt marker records `no-prompt`', () => {
    // The fifth reason, and the one the first cut of this suite never
    // exercised: over threshold, not mid-turn, and not at a `❯` either — a
    // dialog, a pager, a `/`-menu. Mutation that must put this back to red:
    // the bare `echo "$pane" | grep -q "❯" || return 0` this replaced.
    //
    // SYNTHETIC LAYOUT, deliberately: a real 2.1.280 menu HIDES the statusline
    // row (every one of 74 menu captures), so the row-scoped ctx reader stops
    // a real menu at `no-ctx-segment` first — the case below. This keeps the
    // row under the menu only so the tick reaches the `no-prompt` arm itself.
    seed(); sessionJson('idle', 600);
    tick(`  Do you want to proceed?\n  1. Yes\n${SL('████████░░', 88)}\n`);
    expect(reason()).toBe('no-prompt');
    expect(skipLines().join('\n')).toContain(`compact-skip ${ID}: no-prompt (ctx 88%)`);
    expect(sendKeys()).toEqual([]);
  });

  it('a REAL menu — which hides the statusline row — records `no-ctx-segment`, and types nothing', () => {
    // The permission prompt as captured: no prompt box, no `👤` row, footer last.
    seed(); sessionJson('idle', 600);
    tick('  ⎿  $ touch rigfile.txt\n' + '─'.repeat(40) + '\n Bash command\n   touch rigfile.txt\n'
      + ' Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel · Tab to amend\n');
    expect(reason()).toBe('no-ctx-segment');
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
    tick(`  ⏵ esc to interrupt\n${BOX(SL('█████████░', 91))}`);
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
    tick(BOX(SL('█████████░', 95)));
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
    tick(BOX(SL('█████████░', 95)));
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
// outside the other. PANE_TEXT could not express this when it was written
// (`JSON.stringify`'s `\n` stayed a literal backslash-n inside bash double
// quotes, invisible while every case only substring-matched — the STUBS above
// now print it through `%b`, since the row-scoped ctx reader needs real rows),
// and trailing BLANK rows are still easier to state as a file, so this stub
// cats one.
describe('the capture window is the last 8 pane ROWS, not 8 lines of content', () => {
  const PANE_FILE = (): string => path.join(h.home, 'pane-rows.txt');

  /** tmux, recording, answering `capture-pane` from a real file so blank rows
   *  survive into the pipeline. */
  const FILE_STUBS = `
    tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE}
      case "\${1:-}" in
        capture-pane) cat "$HOME/pane-rows.txt" ;;
        list-panes)   echo "${PANE_PID}" ;;
      esac; return 0; };
    _pane_box_draft() { :; };
    sleep() { :; };
  `;

  /** 16 rows: a stale `esc to interrupt` at row 5, the prompt box at rows
   *  9-11, the statusline row under it at row 12, then four blank rows. */
  const writePane = (): void => {
    const rows = [
      'row1', 'row2', 'row3', 'row4',
      '  esc to interrupt',
      'row6', 'row7', 'row8',
      RULE, '❯ ', RULE,
      SL('████████░░', 88),
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
    // The other direction: the same gate must keep working. A banner at row 9
    // is inside the last 8 rows under either shape, so this pins that the case
    // above passes by WINDOW POSITION and not because the gate stopped firing.
    seed(); sessionJson('idle', 600);
    fs.writeFileSync(PANE_FILE(), [
      'row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7', 'row8',
      '  esc to interrupt',
      RULE, '❯ ', RULE,
      SL('████████░░', 88),
      '', '', '',
    ].join('\n'));
    h.sh(`${FILE_STUBS} _auto_compact_check ${ID}`);
    expect(reason()).toBe('mid-turn');
    expect(sendKeys()).toEqual([]);
  });
});

describe('an armed auto-continue is never cancelled by /compact (D-2229)', () => {
  const ARMED = [
    'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel',
    BOX(SL('████████░░', 61)),
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

// ── The per-session `compact` field (routing spec §5.1; slice 6, Task 5) ──
//
// `COMPACT_THRESHOLD` was the ONLY threshold: one number for every session on
// the box. The routing record's `compact` field makes it per session — the
// coordinator's matrix gives a worker 40 (S6-R9) so a dependent chain comes
// back under the wall between tasks, while a coordinator keeps the default.
//
// The field is read through `_route_get` (controller ruling S6-R12), so its
// vocabulary here is `_route_valid`'s `compact` arm and nothing looser: two or
// three digits in 10–100. `5`, `0`, `007`, `120` and `99999` are all digits
// and none of them is a threshold, so a raw `=~ ^[0-9]+$` read would have given
// the field a second, wider vocabulary than the one the writer enforces — the
// cases below walk both edges of that gap.
//
// The field is a registry FILE, so a value the writer would refuse is still
// reachable (a torn write, a hand edit). It falls back to the default rather
// than dying, and it SAYS so — silently compacting at a threshold the record
// does not name is exactly the collapse D-2013 exists to prevent — but the
// sentence is `_route_get`'s OWN (`route-reject … field compact …`), carried on
// the routing reader's per-field floor marker. It is NOT a `compact-skip` note:
// `compactskip` is the compactor's marker and `_compact_note_clear` erases it
// on the very next below-threshold tick, which is where the first cut of this
// read put a routing refusal and lost it.
describe('routing slice 6: `compact` is this session’s threshold, absent means COMPACT_THRESHOLD', () => {
  it('a session at `compact=40` compacts at 45%, where the default would not', () => {
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} compact 40`);
    tick(BELOW_DEFAULT);
    expect(sendKeys().join('\n')).toContain('/compact');
    // The log line names the threshold that actually decided — `>= 50%` beside
    // `ctx 45%` would be a record of a comparison nothing made.
    expect(swapLog()).toContain(`auto-compact ${ID}: ctx 45% >= 40%`);
  });

  it('with no `compact` field the default decides: 45% is left alone, 55% compacts', () => {
    // The control for the case above, and the absent-field half of the §5.1
    // row. Mutation that must put this back to red: none — this is what goes
    // red if the field read replaces the default instead of defaulting to it.
    seed(); sessionJson('idle', 600);
    tick(BELOW_DEFAULT);
    expect(sendKeys()).toEqual([]);
    expect(swapLog(),
      'an ABSENT field is not a refused one — `_route_get` is silent on absence')
      .not.toContain('field compact');
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
    expect(swapLog()).toContain(`auto-compact ${ID}: ctx 55% >= 50%`);
  });

  it('a `compact` field that is not digits falls back to the default AND says so', () => {
    // Mutation that must put this back to red: drop the `=~ ^[0-9]+$` guard.
    // Without it `[[ "$pct" -ge "$thr" ]]` evaluates `abc` as an unset name,
    // i.e. 0, so EVERY session with a torn field compacts on every tick.
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} compact abc`);
    tick(BELOW_DEFAULT);
    expect(sendKeys(), '45% is under the default the torn field falls back to').toEqual([]);
    // The refusal's journal is `_route_reject_note`'s own sentence, subject-bound
    // to this field: it names the FIELD and a BYTE COUNT and never the bytes.
    expect(swapLog()).toContain(
      `route-reject ${ID}: field compact holds an unrecognised value (3 bytes) — treated as absent`);
    // And `compactskip` does NOT carry it. This is the half that reds if the
    // refusal is moved back onto `_compact_note`: that marker rides the
    // compactor's shared floor, and this very tick's `_compact_note_clear`
    // (45% is below the threshold) would have erased the refusal it just wrote.
    expect(reason(), 'a routing refusal must not wear the compactor’s marker').toBeNull();
    expect(skipLines().join('\n')).not.toContain('compact-field-invalid');
  });

  it('a `compact` field of 5 is refused by the field’s vocabulary, not admitted as digits', () => {
    // The LOW edge of the gap between `^[0-9]+$` and `_route_valid`'s compact
    // arm (`^[0-9]{2,3}$` and 10–100). Mutation, measured: read the field with
    // `_reg_get` instead of `_route_get` and 45% compacts against a threshold
    // of 5 — a session that compacts on every tick forever.
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} compact 5`);
    tick(BELOW_DEFAULT);
    expect(sendKeys(), '5 is not a threshold; the default 50 decides and 45% is under it').toEqual([]);
    expect(swapLog()).toContain(`route-reject ${ID}: field compact`);
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
    expect(swapLog()).toContain(`auto-compact ${ID}: ctx 55% >= 50%`);
  });

  it('a `compact` field of 120 is refused by the same arm — above the ceiling is not a threshold', () => {
    // The HIGH edge. `120` passes `^[0-9]{2,3}$` and fails the 10–100 bound, so
    // only the validated reader tells it from a real value. Mutation, measured:
    // `_reg_get` in place of `_route_get` and 55% stops compacting — the session
    // goes silent at a ceiling the writer never admitted.
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} compact 120`);
    tick(BELOW_DEFAULT);
    expect(sendKeys()).toEqual([]);
    expect(swapLog()).toContain(`route-reject ${ID}: field compact`);
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
    expect(swapLog()).toContain(`auto-compact ${ID}: ctx 55% >= 50%`);
  });

  it('a `compact` field of 100 is a session that never auto-compacts below the wall', () => {
    // The other direction of the same read: the ceiling `_route_valid` admits
    // (10–100) must actually hold the compactor off, or the field is decorative.
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} compact 100`);
    tick(BOX(SL('█████████░', 91)));
    expect(sendKeys()).toEqual([]);
    expect(h.reg(ID, 'lastcompact')).toBeNull();
  });
});

// ── D-3102 / D-3103 / D-3104 — the compactor stops summarising its own summary ──
//
// THE DEFECT, MEASURED ON THE FLEET BEFORE IT WAS NAMED. `_auto_compact_check`
// decided on exactly two numbers — the `lastcompact` cooldown and `ctx%` against
// the threshold — and neither of them is a fact about whether the CONVERSATION
// changed. A session whose post-compaction floor sits at or above its own
// threshold therefore re-compacts every `COMPACT_COOLDOWN`, for ever,
// summarising a summary it has already summarised and throwing away real
// context each time.
//
// From `$REG/swap.log` on the fleet host, read 2026-09-19: of 622 `auto-compact`
// lines, 163 came within 40 minutes of the previous compaction OF THE SAME
// SESSION — and all 163 read the IDENTICAL `ctx%` as the line before them. The
// identical percentage is the signature: nothing had changed, and compacting
// changed nothing. ONE workspace alone took 25 consecutive compactions at
// exactly 1800-second spacing, every one reading `ctx 51%`, from 20:39 on
// 2026-09-10 to 08:40 the next morning.
//
// THE GUARD FAILS OPEN, and that is its whole shape. It refuses only on a
// POSITIVE measurement that nothing happened; an unreadable or unresolvable
// transcript, a window with no real turn in it, or a session that has never been
// compacted all behave exactly as they did before. A guard that silenced the
// compactor on a transcript it could not read would trade a wasteful compaction
// for a session that never compacts at all — the #67 R1 shape this file's own
// subject forbids.

describe('D-3102/D-3103: a session with no turn since its last compaction is not compacted again', () => {
  const UUID = '11111111-1111-4111-8111-111111111111';
  const ISO = (epoch: number): string => new Date(epoch * 1000).toISOString();

  /** The four rows ONE `/compact` appends, measured on a live transcript
   *  (2026-09-18 02:30 -> 02:34): the summary itself, then the caveat, the
   *  command and its stdout. The summary lands
   *  MINUTES AFTER ccd typed the keys, which is precisely why a reader that
   *  counted it would see "a turn happened since the compaction" on every
   *  compacted session and this guard would never fire once. */
  const compactionRows = (at: number): string[] => [
    JSON.stringify({ type: 'user', isCompactSummary: true, uuid: 'cs', timestamp: ISO(at + 240),
      message: { role: 'user', content: 'This session is being continued from a previous conversation…' } }),
    JSON.stringify({ type: 'user', isMeta: true, uuid: 'cv', timestamp: ISO(at),
      message: { role: 'user', content: '<local-command-caveat>Caveat: …</local-command-caveat>' } }),
    JSON.stringify({ type: 'user', uuid: 'cn', timestamp: ISO(at),
      message: { role: 'user', content: '<command-name>/compact</command-name>' } }),
    JSON.stringify({ type: 'user', uuid: 'so', timestamp: ISO(at + 241),
      message: { role: 'user', content: '<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>' } }),
  ];
  const turn = (at: number, who: 'user' | 'assistant' = 'assistant'): string =>
    JSON.stringify({ type: who, uuid: `t${at}`, timestamp: ISO(at),
      message: { role: who, content: [{ type: 'text', text: 'real work' }] } });

  const transcript = (lines: string[]): string => {
    const p = h.sh(`_reg_set ${ID} uuid ${UUID}; _transcript_path ${ID}`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };
  const NOW = (): number => Math.floor(Date.now() / 1000);

  it('CONTROL: the same session with a real turn AFTER the compaction still compacts', () => {
    // The positive control this whole describe rests on. Every refusal below is
    // an assertion that `/compact` did NOT fire, and a fixture in which it could
    // not have fired anyway would make all of them vacuously green.
    const now = NOW();
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastcompact ${now - COOLDOWN_PAST}`);
    transcript([...compactionRows(now - COOLDOWN_PAST), turn(now - 120)]);
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
    expect(reason()).toBeNull();
  });

  it('the compaction’s OWN four rows are not a turn: it refuses and says why', () => {
    // The case the fleet log is full of. Note the `isCompactSummary` row is
    // stamped FOUR MINUTES AFTER `lastcompact` — later than the compaction it
    // belongs to — so a reader keyed on timestamps alone would call it a turn.
    const now = NOW();
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastcompact ${now - COOLDOWN_PAST}`);
    transcript([turn(now - COOLDOWN_PAST - 600), ...compactionRows(now - COOLDOWN_PAST)]);
    tick(MODEST);
    expect(sendKeys(), 'the compactor summarised a summary').toEqual([]);
    expect(reason()).toBe('no-turns-since-compact');
    expect(skipLines().join('\n')).toMatch(
      /compact-skip demo-quiet-mesa: no-turns-since-compact \(ctx 55%; newest turn \d+s before the last compaction\)/);
    // And the cooldown stamp is NOT re-armed by a refusal: `lastcompact` still
    // anchors the compaction that actually happened, so the detail's measured
    // age keeps meaning what it says.
    expect(h.reg(ID, 'lastcompact')).toBe(String(now - COOLDOWN_PAST));
  });

  it('a session that has NEVER been compacted is never refused by this guard', () => {
    // There is no compaction for the transcript to be unchanged since. Fail
    // open, and the same for every other unmeasurable condition below.
    const now = NOW();
    seed(); sessionJson('idle', 600);
    transcript([turn(now - 9000)]);
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
  });

  it('an ABSENT transcript fails open — a guard that cannot measure must not silence the compactor', () => {
    const now = NOW();
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastcompact ${now - COOLDOWN_PAST}`);
    h.sh(`_reg_set ${ID} uuid ${UUID}`);   // path resolves, file does not exist
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
    expect(reason()).toBeNull();
  });

  it('a transcript window holding no real turn at all fails open too', () => {
    // "No real turn in the window" is not "no real turn happened" — the tail is
    // bounded, and the honest answer to a question the window cannot reach is
    // the behaviour this guard is an exception to, not a refusal.
    const now = NOW();
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastcompact ${now - COOLDOWN_PAST}`);
    transcript(compactionRows(now - COOLDOWN_PAST));
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
  });

  it('a HUMAN message after the compaction is a turn', () => {
    const now = NOW();
    seed(); sessionJson('idle', 600);
    h.sh(`_reg_set ${ID} lastcompact ${now - COOLDOWN_PAST}`);
    transcript([...compactionRows(now - COOLDOWN_PAST), turn(now - 300, 'user')]);
    tick(MODEST);
    expect(sendKeys().join('\n')).toContain('/compact');
  });

  it('the guard is the LAST gate: a busy session reports not-idle, never this reason', () => {
    // Ordering is the contract. `_compact_no_turns` resolves a path and scans a
    // transcript through python — the expensive read D-2444 measured at an order
    // of magnitude over the pane classifier — so it must be paid only by a
    // session that has passed every cheaper test. A `not-idle` row here proves
    // the scan was never reached.
    const now = NOW();
    seed(); sessionJson('busy', 600);
    h.sh(`_reg_set ${ID} lastcompact ${now - COOLDOWN_PAST}`);
    transcript([turn(now - 9000), ...compactionRows(now - COOLDOWN_PAST)]);
    tick(MODEST);
    expect(reason()).toBe('not-idle');
  });
});

describe('_transcript_last_turn_ts (D-3102, D-3104)', () => {
  const ISO = (epoch: number): string => new Date(epoch * 1000).toISOString();
  const row = (over: Record<string, unknown>): string => JSON.stringify({
    type: 'assistant', uuid: 'x', timestamp: ISO(1789000000),
    message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, ...over,
  });
  const write = (lines: string[]): string => {
    const p = path.join(h.home, 't.jsonl');
    fs.writeFileSync(p, lines.join('\n') + '\n');
    return p;
  };
  const read = (p: string): string =>
    h.sh(`out=$(_transcript_last_turn_ts ${JSON.stringify(p)}); printf '%s:%s' "$?" "$out"`);

  it('answers the NEWEST real turn, not the last line', () => {
    // Unlike the banner reader, which asks "is the banner still the last word"
    // and clears its candidate on any later row, this one asks "when did
    // anything real last happen" — so a later chatter row cannot retract it.
    expect(read(write([
      row({ timestamp: ISO(1789000000) }),
      row({ timestamp: ISO(1789000900) }),
      row({ type: 'user', message: { role: 'user', content: '<command-name>/compact</command-name>' }, timestamp: ISO(1789001800) }),
    ]))).toBe('0:1789000900');
  });
  it('skips the compact summary — the row that would defeat the whole guard', () => {
    expect(read(write([
      row({ timestamp: ISO(1789000000) }),
      row({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued…' }, timestamp: ISO(1789002000) }),
    ]))).toBe('0:1789000000');
  });
  it('skips an isMeta row — injected context is not a turn somebody took', () => {
    expect(read(write([
      row({ timestamp: ISO(1789000000) }),
      row({ type: 'user', isMeta: true, message: { role: 'user', content: 'Continue from where you left off.' }, timestamp: ISO(1789002000) }),
    ]))).toBe('0:1789000000');
  });
  it('skips system rows, which are not turns either', () => {
    expect(read(write([
      row({ timestamp: ISO(1789000000) }),
      JSON.stringify({ type: 'system', timestamp: ISO(1789002000), content: 'Remote Control disconnected' }),
    ]))).toBe('0:1789000000');
  });
  it('a row with a malformed timestamp can only make the answer OLDER, never newer', () => {
    expect(read(write([
      row({ timestamp: ISO(1789000000) }),
      row({ timestamp: 'not-a-time' }),
    ]))).toBe('0:1789000000');
  });
  it('an unparseable line is skipped rather than trusted', () => {
    expect(read(write([row({ timestamp: ISO(1789000000) }), '{"type":"assistant","mess']))).toBe('0:1789000000');
  });
  it('no real turn in the window: rc 1', () => {
    expect(read(write([
      row({ type: 'user', message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' } }),
    ]))).toBe('1:');
  });
  it('no file: rc 2', () => {
    expect(read(path.join(h.home, 'nope.jsonl'))).toBe('2:');
  });
  it('a directory: rc 2 — `-f` is what refuses it (D-2370)', () => {
    const d = path.join(h.home, 'dir.jsonl'); fs.mkdirSync(d);
    expect(read(d)).toBe('2:');
  });
  it('a FIFO: rc 2 without blocking — `-r` alone would open it and wait for ever (D-2370)', () => {
    const f = path.join(h.home, 'fifo.jsonl'); execFileSync('mkfifo', [f]);
    expect(h.sh(`perl -e 'alarm shift; exec @ARGV' 5 bash -c "$(declare -f _transcript_last_turn_ts); COMPACT_TURN_TAIL_LINES=$COMPACT_TURN_TAIL_LINES; _transcript_last_turn_ts \\"\\$1\\"" _ ${JSON.stringify(f)} >/dev/null 2>&1; echo "rc=$?"`))
      .toBe('rc=2');
  });
  it('its window is its OWN, not the redrive detector’s', () => {
    // A `/compact` writes four rows of its own and the tail is thick with
    // attachment and system rows; 60 lines is sized for a stall two turns deep,
    // not for reaching back past a compaction. Too small and the scan answers
    // "no real turn", which the caller FAILS OPEN on — the pre-D-3103
    // behaviour, never a false refusal, but also never the fix.
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain('rows=$(tail -n "$COMPACT_TURN_TAIL_LINES" "$f" 2>/dev/null) || return 2');
    expect(Number(h.sh('echo "$COMPACT_TURN_TAIL_LINES"'))).toBeGreaterThan(
      Number(h.sh('echo "$REDRIVE_TAIL_LINES"')));
  });
});
