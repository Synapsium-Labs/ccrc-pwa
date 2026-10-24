// `ws-reclaim --stale` — the stale arm of child reclaim (fleet disk retention DR-26, D-6638; spec §2.7.3).
// A kept child (held, or a keep the server alone owned) is reclaimed after seven idle days, and the box's half of
// "idle" is measured here: the newest of the transcript, `.lastend`, `.spawn`, `.woke`, `.supervised` and a live
// pane's activity. Every case builds the real child in a fixture HOME (`makeChild`) with the unit and pane calls
// RECORDED, never made; what is asserted is the ladder's answer and what is left on disk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { CHILD_BRANCH, CHILD_ID, CHILD_STUBS, evalOf, makeChild, type Child } from './childReclaimFixture.js';

let h: PrHarness;
let c: Child;
beforeEach(() => { h = makePrHarness('ccrc-reclaim-stale-'); c = makeChild(h); });
afterEach(() => { h.cleanup(); });

const reg = (f: string): string => path.join(h.home, '.cc-sessions', `${CHILD_ID}.${f}`);

describe('characterization (green on the code before DR-26)', () => {
  it('a held child refuses `held` and the hold is left standing', () => {
    fs.writeFileSync(reg('hold'), 'waiting on a design call\n');
    const a = evalOf(h);
    expect(a.verdict).toBe('held');
    expect(a.detail).toContain('waiting on a design call');
    expect(fs.existsSync(reg('hold'))).toBe(true);
    expect(h.git(c.main, 'branch', '--list', CHILD_BRANCH)).not.toBe('');
  });
});
