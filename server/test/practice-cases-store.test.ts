// Overlord §10.5 (W1a, Task 5): `practice_cases`, its one writer (a compare-and-set insert) and its newest-per-signature read.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { CaseDue } from '../src/coord/practiceCases.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-cases-'), '.ccrc', 'coord.db')));
const NOW = 1_800_000_000_000;
const FROM = NOW - 14 * 86_400_000;
const due = (signature = 'stall-arm:quiet'): CaseDue =>
  ({ signature, cause: 'count', occurrences: 3, programmes: ['prog-a'], evidence: [11, 12, 13], windowFrom: FROM });
const rows = (s: CoordStore): unknown[] => s.db.prepare('SELECT * FROM practice_cases ORDER BY id').all();

describe('practice_cases', () => {
  it('opens one row with every field', () => {
    const s = store();
    const r = s.openPracticeCase(due(), null, NOW);
    expect(r).toEqual({ opened: true, id: 1 });
    expect(rows(s)).toEqual([{ id: 1, signature: 'stall-arm:quiet', state: 'open', mode: 'shadow', cause: 'count', occurrences: 3,
      programmes: '["prog-a"]', evidence: '[11,12,13]', windowFrom: FROM, openedAt: NOW }]);
  });

  it('practiceCaseNewest answers each signature\'s newest openedAt', () => {
    const s = store();
    s.openPracticeCase(due('stall-arm:quiet'), null, NOW);
    s.openPracticeCase(due('stall-arm:quiet'), NOW, NOW + 5);
    s.openPracticeCase(due('stall-arm:dead'), null, NOW + 1);
    expect(s.practiceCaseNewest()).toEqual({ ok: true, newest: new Map([['stall-arm:quiet', NOW + 5], ['stall-arm:dead', NOW + 1]]) });
  });

  it('a stale reader is refused superseded and writes nothing', () => {
    const s = store();
    s.openPracticeCase(due(), null, NOW);
    expect(s.openPracticeCase(due(), null, NOW + 10)).toEqual({ opened: false, why: 'superseded' });
    expect(rows(s)).toHaveLength(1);
  });

  it('a row in a state this build cannot name still counts as newest', () => {
    const s = store();
    s.db.prepare("INSERT INTO practice_cases (signature, state, mode, cause, occurrences, programmes, evidence, windowFrom, openedAt) VALUES ('stall-arm:quiet', 'reviewed', 'shadow', 'count', 3, '[]', '[]', 1, ?)").run(NOW);
    expect(s.practiceCaseNewest()).toEqual({ ok: true, newest: new Map([['stall-arm:quiet', NOW]]) });
    expect(s.openPracticeCase(due(), null, NOW + 1)).toEqual({ opened: false, why: 'superseded' });
  });

  it('an openedAt that is not a positive safe integer refuses the whole read', () => {
    const s = store();
    s.openPracticeCase(due('stall-arm:dead'), null, NOW);
    s.db.prepare("INSERT INTO practice_cases (signature, state, mode, cause, occurrences, programmes, evidence, windowFrom, openedAt) VALUES ('stall-arm:quiet', 'open', 'shadow', 'count', 3, '[]', '[]', 1, 'abc')").run();
    expect(s.practiceCaseNewest()).toEqual({ ok: false, detail: 'practice_cases openedAt is not a positive safe integer' });
  });

  it('a thrown statement answers ok: false, never a throw', () => {
    const s = store();
    s.db.exec('DROP TABLE practice_cases');
    const r = s.practiceCaseNewest();
    expect(r.ok).toBe(false);
  });
});
