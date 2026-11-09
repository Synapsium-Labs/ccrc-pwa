// The Stuck band's words (D-8074; spec 2026-11-04 §7, §8.2.1; A35 to A39, A43, A47, A54): the time-left forms, the row line
// for every cause, the one marker, the held-back line and the group control's words.
import { describe, expect, it } from 'vitest';
import { STUCK_CAUSES, type RunStuck, type RunSummary, type StuckCause, type StuckReason } from '../../shared/api';
import {
  STUCK_HEAD_ORDER, STUCK_HEADING, cardWord, closeWhen, groupControlWords, heldBack, heldBackLine, oldestAge, oldestDays,
  programmeStuckLine, runMarker, stuckAge, stuckLine, stuckNext,
} from '../src/fleet/stuckWords';

const H = 3_600_000;
const D = 24 * H;
const now = 1_000 * H;

const stuck = (reason: StuckReason, cause: StuckCause | null, days: number, closes: RunStuck['closes'] = null): Pick<RunSummary, 'stuck'> =>
  ({ stuck: { reason, cause, since: now - days * D, closes } });
const run = (over: Partial<RunSummary>): Pick<RunSummary, 'sessionId' | 'workspace'> =>
  ({ sessionId: null, workspace: null, ...over });

describe('the time left on a close clock', () => {
  it('stuckNext says what happens next, armed or in shadow', () => {
    expect(stuckNext(null, now)).toBe('Nothing closes this on its own');
    expect(stuckNext({ at: now + 20 * H, armed: false }, now)).toBe('ccrc would close this in 20 h');
    expect(stuckNext({ at: now + 20 * H, armed: true }, now)).toBe('ccrc closes this in 20 h');
    expect(stuckNext({ at: now, armed: false }, now)).toBe('ccrc would close this now');
    expect(stuckNext({ at: now - H, armed: true }, now)).toBe('ccrc closes this soon');
  });

  it('closeWhen rounds up and never says in 0', () => {
    expect(closeWhen(now + 40 * 60_000, now)).toBe('in 40 min');
    expect(closeWhen(now + 19.2 * H, now)).toBe('in 20 h');
    expect(closeWhen(now + 60 * H, now)).toBe('in 3 days');
    expect(closeWhen(now + 1, now)).toBe('in 1 min');
    expect(closeWhen(now + 59.5 * 60_000, now)).toBe('in 1 h');
    expect(closeWhen(now + 48 * H, now)).toBe('in 48 h');
    expect(closeWhen(now + 48 * H + 1, now)).toBe('in 3 days');
  });

  it('a phone clock ahead of the server shows the zero form, never a negative time', () => {
    expect(closeWhen(now, now)).toBeNull();
    expect(closeWhen(now - 5 * H, now)).toBeNull();
    for (const armed of [true, false]) {
      const s = stuckNext({ at: now - 5 * H, armed }, now);
      expect(s).not.toMatch(/in 0|-\d/);
    }
  });
});

describe('the row line', () => {
  const N = 'Nothing closes this on its own';
  it('says each cause in its own words, with the age before the shared tail', () => {
    expect(stuckLine(stuck('owner-gone', 'coordinator-archived', 49), now)).toBe(`Coordinator archived 49 days ago · ${N}`);
    expect(stuckLine(stuck('owner-gone', 'coordinator-forgotten', 12), now)).toBe(`Coordinator forgotten 12 days ago · ${N}`);
    expect(stuckLine(stuck('owner-gone', 'coordinator-removed', 12), now)).toBe(`Coordinator removed 12 days ago · ${N}`);
    expect(stuckLine(stuck('owner-gone', 'coordinator-stopped', 8), now)).toBe(`Coordinator stopped 8 days ago. Nothing has moved since · ${N}`);
    expect(stuckLine(stuck('owner-gone', 'coordinator-gone', 8), now)).toBe(`Coordinator gone 8 days ago. Nothing has moved since · ${N}`);
    expect(stuckLine(stuck('owner-gone', 'worker-stopped', 8), now)).toBe(`Worker stopped 8 days ago. Nothing has moved since · ${N}`);
    expect(stuckLine(stuck('owner-gone', 'worker-gone', 8), now)).toBe(`Worker gone 8 days ago. Nothing has moved since · ${N}`);
    expect(stuckLine(stuck('owner-gone', 'name-reused', 3), now)).toBe(`Its session moved to a later run 3 days ago · ${N}`);
    expect(stuckLine(stuck('review-of-closed', 'later-review', 3), now)).toBe(`A later review moved on 3 days ago · ${N}`);
    expect(stuckLine(stuck('review-of-closed', 'target-closed', 30), now)).toBe(`The work it reviews closed 30 days ago · ${N}`);
  });

  it('says the three reasons that name no cause, Overtaken included (A47)', () => {
    expect(stuckLine(stuck('overtaken', null, 28), now)).toBe(`A later wave moved on 28 days ago · ${N}`);
    expect(stuckLine(stuck('never-started', null, 23), now)).toBe(`Opened 23 days ago and never started · ${N}`);
    expect(stuckLine(stuck('start-never-landed', null, 8), now)).toBe(`Started 8 days ago and never landed · ${N}`);
  });

  it('reads hours under a day, and a lane clock after the dot', () => {
    const reviewClosed5h = { stuck: { reason: 'review-of-closed' as const, cause: 'target-closed' as const, since: now - 5 * H, closes: { at: now + 20 * H, armed: false } } };
    expect(stuckLine(reviewClosed5h, now)).toBe('The work it reviews closed 5 h ago · ccrc would close this in 20 h');
    expect(stuckAge(now - D, now)).toBe('1 day');
    expect(stuckAge(now - 90_000, now)).toBe('1 min');
  });

  it('has a line for every cause (the table is a Record)', () => {
    for (const cause of STUCK_CAUSES) {
      expect(stuckLine(stuck('owner-gone', cause, 2), now), cause).toMatch(/ago/);
    }
  });

  it('is empty for a run with no verdict', () => {
    expect(stuckLine({ stuck: null }, now)).toBe('');
    expect(stuckLine({}, now)).toBe('');
  });
});

describe('the marker, the held-back line and the group control', () => {
  it('a run holds a workspace first, else a session, else nothing', () => {
    expect(runMarker(run({ sessionId: 's', workspace: 'w' }), false)).toBe('holds a workspace');
    expect(runMarker(run({ sessionId: 's', workspace: null }), false)).toBe('holds a session');
    expect(runMarker(run({}), false)).toBeNull();
    expect(runMarker(run({ sessionId: 's', workspace: 'w' }), true)).toBe('needs you');
  });

  it('heldBack is the run that holds either', () => {
    expect(heldBack(run({ workspace: 'w' }))).toBe(true);
    expect(heldBack(run({ sessionId: 's' }))).toBe(true);
    expect(heldBack(run({}))).toBe(false);
  });

  it('heldBackLine keeps the singular', () => {
    expect(heldBackLine(1)).toBe('1 holds a workspace or session: one at a time');
    expect(heldBackLine(3)).toBe('3 hold a workspace or session: one at a time');
  });

  it('the group control says all only from three up with none held back', () => {
    expect(groupControlWords(12, 12)).toBe('Abandon all 12…');
    expect(groupControlWords(2, 5)).toBe('Abandon 2…');
    expect(groupControlWords(2, 2)).toBe('Abandon 2…');
    expect(groupControlWords(3, 3)).toBe('Abandon all 3…');
    expect(groupControlWords(1, 1)).toBe('Abandon 1…');
    expect(groupControlWords(0, 2)).toBeNull();
  });
});

describe('the heads', () => {
  it('keep the fixed order, and name every reason', () => {
    expect([...STUCK_HEAD_ORDER]).toEqual(['review-of-closed', 'overtaken', 'owner-gone', 'start-never-landed', 'never-started']);
    for (const r of STUCK_HEAD_ORDER) expect(STUCK_HEADING[r]).not.toBe('');
  });

  it("oldest is the largest age a row shows, in whole days or in hours under a day", () => {
    const runs = [stuck('overtaken', null, 28), stuck('overtaken', null, 3)];
    expect(oldestDays(runs, now)).toBe(28);
    expect(oldestAge(runs, now)).toBe('28 days');
    expect(oldestAge([{ stuck: { reason: 'overtaken', cause: null, since: now - 5 * H, closes: null } }], now)).toBe('5 h');
    expect(oldestAge([], now)).toBeNull();
  });
});

describe('the programme card words (D-8075; spec §8.2.2, A37, o5)', () => {
  const s = (closes: RunStuck['closes']): RunStuck => ({ reason: 'owner-gone', cause: null, since: now - D, closes });
  const at20 = { at: now + 20 * H, armed: false };
  const armed20 = { at: now + 20 * H, armed: true };

  it('words a mixed programme by the runs a clock counts', () => {
    expect(programmeStuckLine([s(null), s(null), s(at20)], now)).toBe('3 stuck · ccrc would close 1 in 20 h');
    expect(programmeStuckLine([s(null), s(null), s(armed20)], now)).toBe('3 stuck · ccrc closes 1 in 20 h');
    expect(programmeStuckLine([s(null), s(null), s(null)], now)).toBe('3 stuck · nothing closes them on its own');
    expect(programmeStuckLine([s(armed20), s(armed20), s(armed20)], now)).toBe('3 stuck · ccrc closes them in 20 h');
    expect(programmeStuckLine([s(null)], now)).toBe('1 stuck · nothing closes it on its own');
    expect(programmeStuckLine([s(armed20)], now)).toBe('1 stuck · ccrc closes it in 20 h');
    expect(programmeStuckLine([s(at20)], now)).toBe('1 stuck · ccrc would close it in 20 h');
  });

  it('the soonest time shows when times differ', () => {
    const later = { at: now + 30 * H, armed: true };
    expect(programmeStuckLine([s(later), s(armed20)], now)).toBe('2 stuck · ccrc closes them in 20 h');
    expect(programmeStuckLine([s(later), s(armed20), s(null)], now)).toBe('3 stuck · ccrc closes 2 in 20 h');
  });

  it('armed wins over shadow: shadow runs are not counted beside armed ones', () => {
    expect(programmeStuckLine([s(at20), s({ at: now + 5 * H, armed: true })], now)).toBe('2 stuck · ccrc closes 1 in 5 h');
  });

  it('the zero forms read now and soon', () => {
    expect(programmeStuckLine([s(null), s({ at: now, armed: false })], now)).toBe('2 stuck · ccrc would close 1 now');
    expect(programmeStuckLine([s(null), s({ at: now - H, armed: true })], now)).toBe('2 stuck · ccrc closes 1 soon');
    expect(programmeStuckLine([s({ at: now, armed: false })], now)).toBe('1 stuck · ccrc would close it now');
  });

  it('the word keeps the motion, and stuck wins when every open run is stuck or waits behind one', () => {
    expect(cardWord('moving', false)).toBe('moving');
    expect(cardWord('stalled', false)).toBe('stalled');
    expect(cardWord('paused', false)).toBe('paused');
    expect(cardWord('moving', true)).toBe('stuck');
    expect(cardWord('stalled', true)).toBe('stuck');
    expect(cardWord('paused', true)).toBe('paused');
  });
});
