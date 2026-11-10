// D-8077 (the ruled plan's W1): the daily digest names the lane's closes in one line, per row, and nothing when the sweep closed none.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { buildDigest, digestPushCopy } from '../src/coord/digest.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-closedigest-'), '.ccrc', 'coord.db')));
const closed = (s: CoordStore, program: string, wave: number, by: string, detail: string | null, at: number): void => {
  const r = s.openRun({ program, title: 'T', project: 'demo', wave, waveOf: null, claimedBy: 'coord-a' });
  if (!('id' in r)) throw new Error('fixture openRun refused');
  s.db.prepare("UPDATE runs SET state = 'failed', closedAt = ?, closedBy = ?, closeDetail = ? WHERE id = ?").run(at, by, detail, r.id);
};

describe('the digest\'s closes line', () => {
  it('the digest names the lane\'s closes per row once a day', () => {
    const s = store();
    for (let i = 1; i <= 5; i += 1) closed(s, `programme-${i}`, 1, 'sweep', 'expired:never-started quiet-since=1', 1500);
    for (let i = 6; i <= 7; i += 1) closed(s, `programme-${i}`, 1, 'sweep', 'expired:review-orphaned target-closed', 1600);
    closed(s, 'programme-8', 1, 'operator', 'abandon:overtaken', 1700);   // a person's close is not the lane's
    closed(s, 'programme-9', 1, 'sweep', 'expired:never-started', 9000);     // outside the window
    const built = buildDigest(s, 1000, 2000);
    expect(built.ok && built.digest.closes).toEqual({ total: 7, line: 'ccrc closed 7 stuck runs (5 never started, 2 review of finished work)' });
  });

  it('a sweep close with no detail reads another reason, and one run reads the singular', () => {
    const s = store();
    closed(s, 'programme-a', 1, 'sweep', null, 1500);
    const built = buildDigest(s, 1000, 2000);
    expect(built.ok && built.digest.closes).toEqual({ total: 1, line: 'ccrc closed 1 stuck run (1 another reason)' });
  });

  it('nothing closed, no line', () => {
    const s = store();
    const built = buildDigest(s, 1000, 2000);
    expect(built.ok && built.digest.closes).toBeUndefined();
  });

  it('the push body carries the line after the decisions, and only when given', () => {
    const totals = { decisions: 2, answers: 2, allows: 0, denies: 0, handOvers: 0, lapses: 0, guardForbidden: 0 };
    expect(digestPushCopy('2026-11-09', totals).body).toBe('2 answered — tap to review and correct');
    expect(digestPushCopy('2026-11-09', totals, 0, 'ccrc closed 1 stuck run (1 never started)').body)
      .toBe('2 answered — ccrc closed 1 stuck run (1 never started) — tap to review and correct');
  });
});
