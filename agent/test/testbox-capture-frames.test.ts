// The box frames recipe's pure decisions (Desktop polish wave 187): every part's worst case against the fleet agent's
// deadline, the late check from both sides, and the box's own private strings. The stand-in's reply rule is pinned in
// `testbox-capture-stub-hold.test.ts`; the drive is `testbox-capture-frames-run.test.ts`'s.
import { describe, expect, it } from 'vitest';
import { TESTBOX_CAPTURE_DEADLINE_MS, UPDATE_SPAWN_DRAIN_MS } from '../../shared/agent-protocol.js';
import { framesDriveSteps } from '../../shared/framesCapture.js';
import { FRAMES_PARTS, framesPartOfId } from '../../shared/framesResult.js';
import { CAPTURE_DEADLINE_MARGIN_MS, CAPTURE_TIMINGS, captureWorstCaseMs, type CaptureTimings } from '../src/testbox/capture.js';
import { framesLongestMs, framesStartsLate, framesWorstCaseMs } from '../src/testbox/captureFrames.js';
import { boxPrivates } from '../src/testbox/main.js';

const t = CAPTURE_TIMINGS;
const partOf = (id: string): number => {
  const p = framesPartOfId(id);
  if (p === null) throw new Error(`no part ${id}`);
  return p;
};

describe('every part\'s worst case fits the fleet agent\'s deadline', () => {
  it('there are 52 parts', () => {
    expect(FRAMES_PARTS).toHaveLength(52);
  });

  it('each part, behind or ahead of build trust, the longest part or itself, with the margin, ends before the agent stops waiting', () => {
    const trust = captureWorstCaseMs(t);
    const longest = framesLongestMs(t);
    for (let i = 0; i < FRAMES_PARTS.length; i++) {
      const own = framesWorstCaseMs(t, i);
      expect(own, `part ${i}`).toBeLessThanOrEqual(longest);
      for (const [ahead, mine] of [[trust, own], [own, trust], [longest, own], [own, longest]] as const) {
        expect(ahead + mine + CAPTURE_DEADLINE_MARGIN_MS, `part ${i}: ${ahead} then ${mine}`).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
      }
    }
    expect(longest + longest + CAPTURE_DEADLINE_MARGIN_MS).toBeLessThanOrEqual(TESTBOX_CAPTURE_DEADLINE_MS);
  });

  it('the figures today: a plain case 257.5 s, a -turns case 349.5 s, the person with two turns 414.5 s (the longest), trust 399.5 s', () => {
    expect(UPDATE_SPAWN_DRAIN_MS).toBe(2_000);
    expect(framesWorstCaseMs(t, partOf('rows-3@220x50'))).toBe(257_500);
    expect(framesWorstCaseMs(t, partOf('rows-3-turns@220x50'))).toBe(349_500);
    expect(framesWorstCaseMs(t, partOf('person-turns@220x50'))).toBe(414_500);
    expect(framesLongestMs(t)).toBe(414_500);
    expect(captureWorstCaseMs(t)).toBe(399_500);
    expect(414_500 + 414_500 + CAPTURE_DEADLINE_MARGIN_MS).toBe(859_000);
  });

  it('the figures are the formula: the fixed steps, then each drive step\'s driver bound, kill grace and drain, and its settle and quiet', () => {
    const call = t.tmuxCallMs + UPDATE_SPAWN_DRAIN_MS;
    const fixed = (t.setupMs + call) + (t.stepMs + t.pollMs) + (2 * call + t.stepMs + t.pollMs) + (2 * call + t.stepMs + t.pollMs)
      + (t.exitMs + t.pollMs) + (call + t.stopWaitMs + t.pollMs + t.standInCloseMs + t.removeMs);
    expect(fixed).toBe(201_500);
    const run = t.framesDriveMs + t.deliveryKillGraceMs + UPDATE_SPAWN_DRAIN_MS;
    const personRun = t.framesPersonDriveMs + t.deliveryKillGraceMs + UPDATE_SPAWN_DRAIN_MS;
    const ended = t.deliverySettleMs + t.pollMs + t.deliveryQuietMs + t.pollMs;
    expect(framesWorstCaseMs(t, partOf('rows-3@220x50'))).toBe(fixed + 2 * run);
    expect(framesWorstCaseMs(t, partOf('rows-3-turns@220x50'))).toBe(fixed + 2 * run + 2 * (run + ended));
    expect(framesWorstCaseMs(t, partOf('person-turns@220x50'))).toBe(fixed + run + personRun + 2 * (run + ended));
    // The held turn waits for its prompt only; the queued send waits for nothing.
    expect(framesWorstCaseMs(t, partOf('queued@220x50'))).toBe(fixed + 3 * run + (t.deliverySettleMs + t.pollMs));
  });

  it('a part\'s worst case counts every one of its drive steps: one more step would add its bound', () => {
    for (const i of [0, partOf('person-turns@220x50'), partOf('queued@220x40')]) {
      const steps = framesDriveSteps(i);
      expect(framesWorstCaseMs(t, i)).toBeGreaterThanOrEqual(201_500 + steps.length * (t.framesDriveMs + t.deliveryKillGraceMs + UPDATE_SPAWN_DRAIN_MS));
    }
  });

  it('grows with each frames bound', () => {
    const p = partOf('person-turns@220x50');
    const base = framesWorstCaseMs(t, p);
    for (const k of ['framesDriveMs', 'framesPersonDriveMs'] as const) {
      expect(framesWorstCaseMs({ ...t, [k]: t[k] + 1 } as CaptureTimings, p), k).toBe(base + 1 * (k === 'framesDriveMs' ? 3 : 1));
    }
  });
});

describe('the late check', () => {
  const part = partOf('person-turns@220x50');
  const worst = framesWorstCaseMs(t, part);

  it('a capture that has waited exactly what the deadline leaves still starts, and one millisecond more does not', () => {
    const last = TESTBOX_CAPTURE_DEADLINE_MS - worst - CAPTURE_DEADLINE_MARGIN_MS;
    expect(last).toBe(900_000 - 414_500 - 30_000);
    expect(framesStartsLate(0, t, part)).toBe(false);
    expect(framesStartsLate(last, t, part)).toBe(false);
    expect(framesStartsLate(last + 1, t, part)).toBe(true);
  });

  it('is the part\'s own: a plain part may wait longer than the longest one', () => {
    const plain = partOf('rows-3@220x50');
    const waited = TESTBOX_CAPTURE_DEADLINE_MS - worst - CAPTURE_DEADLINE_MARGIN_MS + 1;
    expect(framesStartsLate(waited, t, part)).toBe(true);
    expect(framesStartsLate(waited, t, plain)).toBe(false);
  });

  it('reads the deadline it is given', () => {
    expect(framesStartsLate(1_000, t, part, worst + CAPTURE_DEADLINE_MARGIN_MS + 1_000)).toBe(false);
    expect(framesStartsLate(1_001, t, part, worst + CAPTURE_DEADLINE_MARGIN_MS + 1_000)).toBe(true);
  });
});

describe('the box\'s private strings (main.ts#boxPrivates)', () => {
  it('holds the home, the release tree without its trailing slash, the user, the host and its short form', () => {
    expect(boxPrivates('/srv/box/home', 'svcuser', 'box1.example.net', '/srv/box/tree/')).toEqual(['/srv/box/home', '/srv/box/tree', 'svcuser', 'box1.example.net', 'box1']);
  });

  it('leaves out a user name under four characters, and keeps one of four', () => {
    expect(boxPrivates('/h', 'abc', 'longhost', '/srv/tree')).toEqual(['/h', '/srv/tree', 'longhost']);
    expect(boxPrivates('/h', 'ab', 'longhost', '/srv/tree')).not.toContain('ab');
    expect(boxPrivates('/h', 'abcd', 'longhost', '/srv/tree')).toEqual(['/h', '/srv/tree', 'abcd', 'longhost']);
  });

  it('adds the host\'s short form only when it differs from the host, and only at four characters or more', () => {
    expect(boxPrivates('/h', 'abcd', 'nodot', '/srv/tree')).toEqual(['/h', '/srv/tree', 'abcd', 'nodot']);
    expect(boxPrivates('/h', 'abcd', 'box1.example.net', '/srv/tree').filter((x) => x === 'box1')).toEqual(['box1']);
    expect(boxPrivates('/h', 'abcd', 'ab.example.net', '/srv/tree')).toEqual(['/h', '/srv/tree', 'abcd', 'ab.example.net']);
    expect(boxPrivates('/h', 'abcd', 'abc', '/srv/tree')).toEqual(['/h', '/srv/tree', 'abcd']);
  });

  it('is never "/" and never empty, whichever argument would be', () => {
    expect(boxPrivates('/', 'abcd', 'nodot', '/')).toEqual(['abcd', 'nodot']);
    expect(boxPrivates('', 'abcd', 'nodot', '')).toEqual(['abcd', 'nodot']);
    for (const x of boxPrivates('/', 'ab', 'x', '/')) expect(x).not.toBe('/');
  });
});
