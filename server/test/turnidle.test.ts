// Worker stall watch (spec §4.1 wave 1, §5.1 wave 2): the mail gate's turn-idle decision. It is pure, so every rule
// is a table row here. The golden fixtures are the measured timestamps from spec §1:
// - S3 and run 129's mail 2407, both held at `shell` behind an orphaned background wait loop;
// - 09-28's five coordinator rulings, held at `busy` while the worker's subagents ran. Wave 1 could not release them.
//   Wave 2's turn marker does, under `busy`, a quiet window after each of the worker's next Stops (14:34, 14:51).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAIL_GATE_BUSY_MARKER, MAIL_GATE_BUSY_SHADOW_MARKER, MAIL_GATE_STRICT_MARKER, mailTurnIdle, mailTurnModeOf,
  mailTurnReadsMark, type MailTurnMode, type TurnLive, type TurnMarkFact,
} from '../src/turnidle.js';
import type { TurnMarkRead } from '../src/coord/stall.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
// watch.ts's two quiet windows, mirrored (they are private there). The pure
// function takes the window as an argument, so these only name the cases.
const MAIL_QUIET_MS = 60_000;
const COORD_QUIET_MS = 15_000;
const T = 1_800_000_000_000;
const live = (status: string, statusUpdatedAt: number | null = T): TurnLive => ({ status, statusUpdatedAt });
/** Every mode, derived from a Record keyed by the type: a mode added to `MailTurnMode` is a compile error here
 *  (`tsc -p test/tsconfig.tests.json`) until this file places it, and every "under every mode" loop then runs it. */
const MODE_MAP: Record<MailTurnMode, true> = { shell: true, strict: true, 'busy-shadow': true, busy: true };
const MODES = Object.keys(MODE_MAP) as MailTurnMode[];
/** The modes under which `shell` may deliver: the positive list. */
const SHELL_MODES: readonly MailTurnMode[] = ['shell', 'busy-shadow', 'busy'];
/** The two modes that read `busy` at all. */
const BUSY_MODES: readonly MailTurnMode[] = ['busy-shadow', 'busy'];

// The marker as the gate reads it. `null` is "not read", which the caller does under strict and shell: sweepMail
// reads the marker only under busy-shadow and busy (shell-mode-ignores-the-marker).
const ABSENT: TurnMarkFact = { ok: false, reason: 'absent' };
const unread = (reason: 'absent' | 'unmeasured' | 'malformed' | 'foreign' | 'stale'): TurnMarkFact => ({ ok: false, reason });
const working = (at: number): TurnMarkFact => ({ ok: true, state: 'working', at, stopAt: null, graceUntil: null });
const ended = (state: 'done' | 'failed', stopAt: number | null, graceUntil: number | null = null): TurnMarkFact =>
  ({ ok: true, state, at: stopAt ?? T, stopAt, graceUntil });
const done = (stopAt: number | null, graceUntil: number | null = null): TurnMarkFact => ended('done', stopAt, graceUntil);
/** What a wave-1 row passes now: nothing read under strict and shell, an absent marker (an older fleet build) under
 *  the busy modes. */
const markFor = (mode: MailTurnMode): TurnMarkFact | null => (mode === 'strict' || mode === 'shell' ? null : ABSENT);

// turnidle-declares-its-mark-shape: what `readTurnMarkMeasured` answers must stay assignable to the shape this pure
// module declares for itself. `tsc -p test/tsconfig.tests.json` checks this line; vitest never does.
const _f: TurnMarkFact = null as unknown as TurnMarkRead;

describe('mailTurnModeOf: the mode, from the registry listing sweepMail already takes', () => {
  it('the markers are named mail-gate-strict, mail-gate-busy and mail-gate-busy-shadow', () => {
    expect(MAIL_GATE_STRICT_MARKER).toBe('mail-gate-strict');
    expect(MAIL_GATE_BUSY_MARKER).toBe('mail-gate-busy');
    expect(MAIL_GATE_BUSY_SHADOW_MARKER).toBe('mail-gate-busy-shadow');
  });

  it('shell by default: an empty listing, or one without a marker', () => {
    expect(mailTurnModeOf([])).toBe('shell');
    expect(mailTurnModeOf(['demo-quiet-mesa.wrapper', 'mail-disabled', 'coordinator-paused'])).toBe('shell');
  });

  it('strict while $REG/mail-gate-strict is listed', () => {
    expect(mailTurnModeOf(['demo-quiet-mesa.wrapper', MAIL_GATE_STRICT_MARKER])).toBe('strict');
  });

  it('strict > busy > busy-shadow > shell: every subset of the three markers, in either listing order', () => {
    const S = MAIL_GATE_STRICT_MARKER, B = MAIL_GATE_BUSY_MARKER, H = MAIL_GATE_BUSY_SHADOW_MARKER;
    const rows: [string[], MailTurnMode][] = [
      [[], 'shell'], [[S], 'strict'], [[B], 'busy'], [[H], 'busy-shadow'],
      [[S, B], 'strict'], [[S, H], 'strict'], [[B, H], 'busy'], [[S, B, H], 'strict'],
    ];
    for (const [markers, mode] of rows) {
      const listing = ['demo-quiet-mesa.wrapper', ...markers];
      expect(mailTurnModeOf(listing), listing.join(' ')).toBe(mode);
      expect(mailTurnModeOf([...listing].reverse()), `reversed: ${listing.join(' ')}`).toBe(mode);
    }
  });

  it('an exact name, not a substring: a near-miss file is not a marker', () => {
    expect(mailTurnModeOf(['mail-gate-strict.bak', 'mail-gate-strictly', 'x.mail-gate-strict'])).toBe('shell');
    expect(mailTurnModeOf(['mail-gate-busy.bak', 'mail-gate-busyy', 'x.mail-gate-busy'])).toBe('shell');
    expect(mailTurnModeOf(['mail-gate-busy-shadow.bak', 'mail-gate-busy-shadow2', 'x.mail-gate-busy-shadow'])).toBe('shell');
  });
});

describe('mailTurnReadsMark: the one rule for which modes consult the marker, shared by the gate and sweepMail', () => {
  it('only busy-shadow and busy read the marker: shell and strict never do, and a mode added later does not either', () => {
    // Keyed by the type: a fifth mode is a compile error here until this row places it.
    const READS: Record<MailTurnMode, boolean> = { shell: false, strict: false, 'busy-shadow': true, busy: true };
    for (const mode of MODES) expect(mailTurnReadsMark(mode), mode).toBe(READS[mode]);
    expect(mailTurnReadsMark('future' as MailTurnMode)).toBe(false);
  });
});

describe('mailTurnIdle: which live words deliver', () => {
  it('no live read is not-idle under every mode: an unreadable answer is never idle', () => {
    for (const mode of MODES) {
      expect(mailTurnIdle(null, markFor(mode), T + HOUR, MAIL_QUIET_MS, mode), mode).toEqual({ deliver: false, gate: 'not-idle' });
    }
  });

  it('idle delivers under every mode, via idle, since statusUpdatedAt', () => {
    for (const mode of MODES) {
      expect(mailTurnIdle(live('idle'), markFor(mode), T + MAIL_QUIET_MS, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: true, since: T, via: 'idle' });
    }
  });

  it('shell delivers under every mode on the positive list, via shell (the caller arms the pane guard on it)', () => {
    for (const mode of SHELL_MODES) {
      expect(mailTurnIdle(live('shell'), ABSENT, T + MAIL_QUIET_MS, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: true, since: T, via: 'shell' });
    }
  });

  it('shell is not-idle under strict: the old rule, restored by hand', () => {
    expect(mailTurnIdle(live('shell'), null, T + 100 * HOUR, MAIL_QUIET_MS, 'strict'))
      .toEqual({ deliver: false, gate: 'not-idle' });
  });

  it('a mode not on the positive list refuses shell and busy alike: a mode added later is never read as one of them', () => {
    const future = 'future' as MailTurnMode;
    expect(mailTurnIdle(live('shell'), ABSENT, T + HOUR, MAIL_QUIET_MS, future)).toEqual({ deliver: false, gate: 'not-idle' });
    expect(mailTurnIdle(live('busy'), done(T), T + HOUR, MAIL_QUIET_MS, future)).toEqual({ deliver: false, gate: 'not-idle' });
    expect(mailTurnIdle(live('idle'), ABSENT, T + HOUR, MAIL_QUIET_MS, future)).toEqual({ deliver: true, since: T, via: 'idle' });
  });

  it('busy, waiting, the empty word and any other word are not-idle under every mode with no marker (exact match only)', () => {
    for (const word of ['busy', 'waiting', '', 'Idle', 'idle ', 'shell\n', 'compacting']) {
      for (const mode of MODES) {
        expect(mailTurnIdle(live(word), markFor(mode), T + 100 * HOUR, MAIL_QUIET_MS, mode), `${JSON.stringify(word)} under ${mode}`)
          .toEqual({ deliver: false, gate: 'not-idle' });
      }
    }
  });

  it('waiting stays not-idle under the busy modes even behind a quiet done marker: a dialog owns the keyboard', () => {
    for (const mode of BUSY_MODES) {
      expect(mailTurnIdle(live('waiting'), done(T), T + HOUR, MAIL_QUIET_MS, mode), mode).toEqual({ deliver: false, gate: 'not-idle' });
    }
  });
});

describe('mailTurnIdle: the quiet rule, the same for idle and shell', () => {
  for (const word of ['idle', 'shell'] as const) {
    it(`${word}: a null statusUpdatedAt is not-quiet (no moment means no quiet)`, () => {
      expect(mailTurnIdle(live(word, null), ABSENT, T + 100 * HOUR, MAIL_QUIET_MS, 'shell'))
        .toEqual({ deliver: false, gate: 'not-quiet' });
    });

    it(`${word}: one millisecond short of the window is not-quiet; the window itself delivers`, () => {
      expect(mailTurnIdle(live(word), ABSENT, T + MAIL_QUIET_MS - 1, MAIL_QUIET_MS, 'shell'))
        .toEqual({ deliver: false, gate: 'not-quiet' });
      expect(mailTurnIdle(live(word), ABSENT, T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'shell'))
        .toEqual({ deliver: true, since: T, via: word });
    });

    it(`${word}: the caller owns the window, so a coordinator's 15 s delivers where a worker's 60 s does not`, () => {
      const now = T + COORD_QUIET_MS;
      expect(mailTurnIdle(live(word), ABSENT, now, COORD_QUIET_MS, 'shell')).toEqual({ deliver: true, since: T, via: word });
      expect(mailTurnIdle(live(word), ABSENT, now, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-quiet' });
    });
  }

  it('a statusUpdatedAt ahead of now (fleet-box clock ahead, spec §9.13) is not-quiet, never a delivery', () => {
    expect(mailTurnIdle(live('idle', T + MIN), ABSENT, T, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-quiet' });
  });

  it('the word is judged BEFORE the quiet rule: strict shell with no moment is not-idle, never not-quiet', () => {
    expect(mailTurnIdle(live('shell', null), null, T, MAIL_QUIET_MS, 'strict')).toEqual({ deliver: false, gate: 'not-idle' });
    expect(mailTurnIdle(live('busy', null), ABSENT, T, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-idle' });
  });
});

describe('mailTurnIdle: the turn marker under a live shell (§5.1, an interrupted turn), read only under the busy modes', () => {
  it('a working marker NEWER than statusUpdatedAt refuses shell as not-idle, under both busy modes', () => {
    for (const mode of BUSY_MODES) {
      expect(mailTurnIdle(live('shell'), working(T + 1), T + HOUR, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: false, gate: 'not-idle' });
    }
  });

  it('a working marker EQUAL to statusUpdatedAt refuses too: at least as new is a running turn', () => {
    for (const mode of BUSY_MODES) {
      expect(mailTurnIdle(live('shell'), working(T), T + HOUR, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: false, gate: 'not-idle' });
    }
  });

  it('shell-mode-ignores-the-marker: under shell a current working marker still delivers via shell, and strict stays not-idle, whatever the marker says', () => {
    const marks: (TurnMarkFact | null)[] = [
      null, ABSENT, unread('unmeasured'), unread('malformed'), unread('foreign'), unread('stale'),
      working(T + 1), working(T), working(T - 1), done(T + 30_000), done(null, T + HOUR), ended('failed', T),
    ];
    for (const mark of marks) {
      const m = JSON.stringify(mark);
      expect(mailTurnIdle(live('shell'), mark, T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'shell'), `shell word under shell, ${m}`)
        .toEqual({ deliver: true, since: T, via: 'shell' });
      expect(mailTurnIdle(live('shell'), mark, T + MAIL_QUIET_MS - 1, MAIL_QUIET_MS, 'shell'), `shell word under shell, 1 ms short, ${m}`)
        .toEqual({ deliver: false, gate: 'not-quiet' });
      expect(mailTurnIdle(live('busy'), mark, T + HOUR, MAIL_QUIET_MS, 'shell'), `busy word under shell, ${m}`)
        .toEqual({ deliver: false, gate: 'not-idle' });
      for (const word of ['shell', 'busy']) {
        expect(mailTurnIdle(live(word), mark, T + HOUR, MAIL_QUIET_MS, 'strict'), `${word} word under strict, ${m}`)
          .toEqual({ deliver: false, gate: 'not-idle' });
      }
    }
  });

  it('an OLDER working marker is an interrupted turn (Stop does not fire on Esc): done at statusUpdatedAt, so shell delivers', () => {
    for (const mode of BUSY_MODES) {
      expect(mailTurnIdle(live('shell'), working(T - 1), T + MAIL_QUIET_MS - 1, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: false, gate: 'not-quiet' });
      expect(mailTurnIdle(live('shell'), working(T - 1), T + MAIL_QUIET_MS, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: true, since: T, via: 'shell' });
    }
  });

  it('shell keeps its own moment: a done marker does not move the quiet rule off statusUpdatedAt', () => {
    for (const mode of SHELL_MODES) {
      expect(mailTurnIdle(live('shell'), done(T + 30_000), T + MAIL_QUIET_MS, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: true, since: T, via: 'shell' });
    }
  });

  it('a working marker with no statusUpdatedAt to compare is not-quiet: no moment means no quiet', () => {
    for (const mode of SHELL_MODES) {
      expect(mailTurnIdle(live('shell', null), working(T), T + HOUR, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: false, gate: 'not-quiet' });
    }
  });

  it('an unreadable, foreign or stale marker does not refuse shell: shell stays as wave 1 had it', () => {
    for (const mode of SHELL_MODES) {
      for (const reason of ['unmeasured', 'malformed', 'foreign', 'stale'] as const) {
        expect(mailTurnIdle(live('shell'), unread(reason), T + MAIL_QUIET_MS, MAIL_QUIET_MS, mode), `${reason} under ${mode}`)
          .toEqual({ deliver: true, since: T, via: 'shell' });
      }
    }
  });

  it('idle does not read the marker: a working marker newer than the stamp still delivers via idle, under every mode', () => {
    for (const mode of MODES) {
      expect(mailTurnIdle(live('idle'), mode === 'strict' ? null : working(T + 1), T + MAIL_QUIET_MS, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: true, since: T, via: 'idle' });
    }
  });
});

describe('mailTurnIdle: busy, read through the turn marker (§5.1)', () => {
  it('busy is not-idle under shell and strict, whatever the marker says: only the busy modes read it', () => {
    expect(mailTurnIdle(live('busy'), done(T), T + HOUR, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-idle' });
    expect(mailTurnIdle(live('busy'), null, T + HOUR, MAIL_QUIET_MS, 'strict')).toEqual({ deliver: false, gate: 'not-idle' });
  });

  it('no marker read, or one read unmeasured or malformed, is turn-mark-unreadable under busy: a fault never hides behind not-idle', () => {
    for (const mark of [null, unread('unmeasured'), unread('malformed')]) {
      expect(mailTurnIdle(live('busy'), mark, T + HOUR, MAIL_QUIET_MS, 'busy'), JSON.stringify(mark))
        .toEqual({ deliver: false, gate: 'turn-mark-unreadable' });
    }
  });

  it('…and not-idle under busy-shadow, which delivers nothing and so has no fault to report', () => {
    for (const mark of [null, unread('unmeasured'), unread('malformed')]) {
      expect(mailTurnIdle(live('busy'), mark, T + HOUR, MAIL_QUIET_MS, 'busy-shadow'), JSON.stringify(mark))
        .toEqual({ deliver: false, gate: 'not-idle' });
    }
  });

  it('absent, foreign and stale take the wave-1 answer: not-idle under both busy modes', () => {
    for (const mode of BUSY_MODES) {
      for (const reason of ['absent', 'foreign', 'stale'] as const) {
        expect(mailTurnIdle(live('busy'), unread(reason), T + HOUR, MAIL_QUIET_MS, mode), `${reason} under ${mode}`)
          .toEqual({ deliver: false, gate: 'not-idle' });
      }
    }
  });

  it('a working marker is a running turn: not-idle under both busy modes, however old', () => {
    for (const mode of BUSY_MODES) {
      expect(mailTurnIdle(live('busy'), working(T - 100 * HOUR), T, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: false, gate: 'not-idle' });
    }
  });

  it('a current done marker, quiet since stopAt: busy delivers via busy, since stopAt', () => {
    expect(mailTurnIdle(live('busy'), done(T), T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'busy'))
      .toEqual({ deliver: true, since: T, via: 'busy' });
  });

  it('…and busy-shadow holds it not-idle, carrying wouldDeliver and since for the log line', () => {
    expect(mailTurnIdle(live('busy'), done(T), T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'busy-shadow'))
      .toEqual({ deliver: false, gate: 'not-idle', wouldDeliver: true, since: T });
  });

  it('one millisecond short of the window: not-quiet under busy, a plain not-idle under busy-shadow', () => {
    expect(mailTurnIdle(live('busy'), done(T), T + MAIL_QUIET_MS - 1, MAIL_QUIET_MS, 'busy'))
      .toEqual({ deliver: false, gate: 'not-quiet' });
    expect(mailTurnIdle(live('busy'), done(T), T + MAIL_QUIET_MS - 1, MAIL_QUIET_MS, 'busy-shadow'))
      .toEqual({ deliver: false, gate: 'not-idle' });
  });

  it('failed behaves like done: a turn that ended on an API error has ended', () => {
    expect(mailTurnIdle(live('busy'), ended('failed', T), T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'busy'))
      .toEqual({ deliver: true, since: T, via: 'busy' });
    expect(mailTurnIdle(live('busy'), ended('failed', T), T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'busy-shadow'))
      .toEqual({ deliver: false, gate: 'not-idle', wouldDeliver: true, since: T });
  });

  it('stopAt null (a restart before any Stop) is never quiet: not-quiet under busy, not-idle under busy-shadow', () => {
    expect(mailTurnIdle(live('busy'), done(null), T + HOUR, MAIL_QUIET_MS, 'busy')).toEqual({ deliver: false, gate: 'not-quiet' });
    expect(mailTurnIdle(live('busy'), done(null), T + HOUR, MAIL_QUIET_MS, 'busy-shadow')).toEqual({ deliver: false, gate: 'not-idle' });
  });

  it('a stopAt ahead of now (fleet-box clock ahead, spec §9.13) is not-quiet, never a delivery', () => {
    expect(mailTurnIdle(live('busy'), done(T + MIN), T, MAIL_QUIET_MS, 'busy')).toEqual({ deliver: false, gate: 'not-quiet' });
  });

  it('quiet runs from stopAt, never statusUpdatedAt: an old stamp does not make a fresh Stop quiet', () => {
    expect(mailTurnIdle(live('busy', T - HOUR), done(T), T + MAIL_QUIET_MS - 1, MAIL_QUIET_MS, 'busy'))
      .toEqual({ deliver: false, gate: 'not-quiet' });
  });

  it('…and a stamp restamped after the Stop does not hold it', () => {
    expect(mailTurnIdle(live('busy', T + 30_000), done(T), T + MAIL_QUIET_MS, MAIL_QUIET_MS, 'busy'))
      .toEqual({ deliver: true, since: T, via: 'busy' });
  });

  it('restart grace: inside graceUntil a done marker is not-idle under both busy modes; at graceUntil the quiet rule runs', () => {
    const grace = T + 5 * MIN;
    for (const mode of BUSY_MODES) {
      expect(mailTurnIdle(live('busy'), done(T, grace), grace - 1, MAIL_QUIET_MS, mode), mode)
        .toEqual({ deliver: false, gate: 'not-idle' });
    }
    expect(mailTurnIdle(live('busy'), done(T, grace), grace, MAIL_QUIET_MS, 'busy')).toEqual({ deliver: true, since: T, via: 'busy' });
  });

  it("the caller owns the window: a coordinator's 15 s after stopAt delivers where a worker's 60 s does not", () => {
    expect(mailTurnIdle(live('busy'), done(T), T + COORD_QUIET_MS, COORD_QUIET_MS, 'busy')).toEqual({ deliver: true, since: T, via: 'busy' });
    expect(mailTurnIdle(live('busy'), done(T), T + COORD_QUIET_MS, MAIL_QUIET_MS, 'busy')).toEqual({ deliver: false, gate: 'not-quiet' });
  });
});

describe('mailTurnIdle: the measured silences (spec §1)', () => {
  // S3, run 67. The worker's turn ended 09-26 13:03:15 UTC. An orphaned
  // background wait loop then held the live word at `shell` for 48.9 h, and the
  // coordinator's mails 2443/2445 were gated not-idle the whole time. The file
  // is rewritten only on a change (§3.1), so the relabel's moment is the turn end.
  const S3_TURN_END = Date.UTC(2026, 8, 26, 13, 3, 15);
  // Run 129. Mail 2407 was queued 09-25 02:28 UTC and gated not-idle for 83.5 h
  // behind a subagent's `pgrep` wait loop that held `shell`. The census does not
  // record when the relabel happened, so the queue minute is used: it is the
  // latest the relabel can be.
  const RUN129_QUEUED = Date.UTC(2026, 8, 25, 2, 28, 0);
  // 09-28. The worker read `busy` from 14:02 to about 19:40 UTC while its subagents ran, and the coordinator's five
  // rulings were gated not-idle the whole time. The worker's next Stops, at 14:34 and 14:51, each wrote `done`.
  const RULINGS_BUSY_SINCE = Date.UTC(2026, 8, 28, 14, 2, 0);
  const RULINGS_UNTIL = Date.UTC(2026, 8, 28, 19, 40, 0);
  const STOP_1434 = Date.UTC(2026, 8, 28, 14, 34, 0);
  const STOP_1451 = Date.UTC(2026, 8, 28, 14, 51, 0);

  it('S3: the coordinator mails deliver a minute after the turn ended, not 48.9 h later', () => {
    const s3 = live('shell', S3_TURN_END);
    expect(mailTurnIdle(s3, ABSENT, S3_TURN_END + 30_000, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-quiet' });
    expect(mailTurnIdle(s3, ABSENT, S3_TURN_END + MAIL_QUIET_MS, MAIL_QUIET_MS, 'shell'))
      .toEqual({ deliver: true, since: S3_TURN_END, via: 'shell' });
    // …and strict is exactly the rule that held them.
    expect(mailTurnIdle(s3, null, S3_TURN_END + 48.9 * HOUR, MAIL_QUIET_MS, 'strict')).toEqual({ deliver: false, gate: 'not-idle' });
  });

  it('run 129: mail 2407 delivers a minute after it was queued, not 83.5 h later', () => {
    const r129 = live('shell', RUN129_QUEUED);
    expect(mailTurnIdle(r129, ABSENT, RUN129_QUEUED + MAIL_QUIET_MS, MAIL_QUIET_MS, 'shell'))
      .toEqual({ deliver: true, since: RUN129_QUEUED, via: 'shell' });
    expect(mailTurnIdle(r129, null, RUN129_QUEUED + 83.5 * HOUR, MAIL_QUIET_MS, 'strict')).toEqual({ deliver: false, gate: 'not-idle' });
  });

  it("09-28's five coordinator rulings deliver under busy, a quiet window after each of the worker's next Stops", () => {
    const b = live('busy', RULINGS_BUSY_SINCE);
    for (const stopAt of [STOP_1434, STOP_1451]) {
      expect(mailTurnIdle(b, done(stopAt), stopAt + MAIL_QUIET_MS - 1, MAIL_QUIET_MS, 'busy'))
        .toEqual({ deliver: false, gate: 'not-quiet' });
      expect(mailTurnIdle(b, done(stopAt), stopAt + MAIL_QUIET_MS, MAIL_QUIET_MS, 'busy'))
        .toEqual({ deliver: true, since: stopAt, via: 'busy' });
    }
  });

  it('…under busy-shadow the same moments would deliver, and the rulings are still held not-idle', () => {
    const b = live('busy', RULINGS_BUSY_SINCE);
    for (const stopAt of [STOP_1434, STOP_1451]) {
      expect(mailTurnIdle(b, done(stopAt), stopAt + MAIL_QUIET_MS, MAIL_QUIET_MS, 'busy-shadow'))
        .toEqual({ deliver: false, gate: 'not-idle', wouldDeliver: true, since: stopAt });
    }
  });

  it('…under shell and strict they stay held until 19:40, as wave 1 held them', () => {
    const b = live('busy', RULINGS_BUSY_SINCE);
    expect(mailTurnIdle(b, done(STOP_1451), RULINGS_UNTIL, MAIL_QUIET_MS, 'shell')).toEqual({ deliver: false, gate: 'not-idle' });
    expect(mailTurnIdle(b, null, RULINGS_UNTIL, MAIL_QUIET_MS, 'strict')).toEqual({ deliver: false, gate: 'not-idle' });
  });
});

describe('the marker shape the gate declares', () => {
  it('TurnMarkRead is assignable to TurnMarkFact: tsc checks the module-scope line, this row keeps it in the file', () => {
    expect(_f).toBeNull();
  });
});

describe('turnidle.ts is the pure module its docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'turnidle.ts'),
    'utf8');

  /** Comments blanked, positions preserved (coord-caps-policy.test.ts's helper).
   *  The docstring NAMES the things the code must not use. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    expect(code()).toContain('export function mailTurnIdle');
    expect(code()).toContain('export function mailTurnModeOf');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('imports nothing: not a type, not a value, not a re-export, not a dynamic import', () => {
    expect(code(), 'turnidle.ts has an import line').not.toMatch(/^\s*import\b/m);
    expect(code(), 'turnidle.ts re-exports from another module').not.toMatch(/\bfrom\s+['"`]/);
    expect(code(), 'turnidle.ts has a dynamic import or a require').not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
  });

  it('has no clock: now is an argument', () => {
    expect(code(), 'turnidle.ts names Date').not.toMatch(/\bDate\b/);
    expect(code(), 'turnidle.ts reads a clock').not.toMatch(/performance\s*\.\s*now|process\s*\.\s*hrtime/);
  });

  it('has no node builtin, no fs, no process', () => {
    expect(code(), 'turnidle.ts names a node builtin').not.toMatch(/node:/);
    expect(code(), 'turnidle.ts reaches fs or process').not.toMatch(/\bfs\b|\bprocess\s*\./);
  });
});
