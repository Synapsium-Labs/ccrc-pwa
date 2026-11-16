// Overlord W1, authority journal plan Task 4 (PR A): boot coherence of the Overlord authority journal (Table 7.6a) and its heal
// rule (`server/src/coord/overlordAuthorityCoherence.ts`, L1). Every row of the table with a fixture; totality and monotonicity
// over a generated domain (a fixed seed, 1,000 cases).
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildChainedRecord, chainNext, type ChainedJournalRecord, type ChainedPosition, type ChainedTail } from '../src/chainedJournal.js';
import { OVERLORD_AUTHORITY_FORMAT, type OverlordAuthorityEntry } from '../src/coord/overlordAuthority.js';
import {
  authorityCoherence, authorityTailHeal, type AuthorityFileSeen, type AuthorityRowsSeen, type CoherenceVerdict,
} from '../src/coord/overlordAuthorityCoherence.js';
import { mulberry32 } from './fakeTime.js';

type Rec = ChainedJournalRecord<OverlordAuthorityEntry>;
const RUNGS = ['off', 'chat', 'advise', 'full'] as const;
/** `n` records chained from 1; `fork` changes every entry, so two forks of equal length differ at every sequence. */
function chain(n: number, fork = 0): Rec[] {
  const out: Rec[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(buildChainedRecord(OVERLORD_AUTHORITY_FORMAT, {
      ...chainNext(out[i - 2] ?? null), acceptedAt: `2026-11-16T10:00:0${i}.000Z`,
      entry: { kind: 'authority-rung', opKey: `op-${fork}-${i}`, from: RUNGS[i % 4]!, to: RUNGS[(i + 1) % 4]! },
    }));
  }
  return out;
}
const pos = (r: Rec): ChainedPosition => ({ sequence: r.sequence, journalId: r.journalId, digest: r.digest });
const tail = (offset: number): ChainedTail => {
  const bytes = new TextEncoder().encode('{"v":1,"seq');
  return { offset, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), code: 'torn-tail' };
};
const recs = (r: Rec[], t: ChainedTail | null = null): AuthorityFileSeen<OverlordAuthorityEntry> => ({ kind: 'records', records: r, tail: t });
const ABSENT = { kind: 'absent' } as const;
const UNREADABLE = { kind: 'unmeasured', why: 'unreadable' } as const;
const MALFORMED = { kind: 'malformed', code: 'digest-mismatch', detail: 'x', lines: 3 } as const;
const rows = (head: ChainedPosition | null, anyAuthorityRow = false): AuthorityRowsSeen => ({ kind: 'measured', head, anyAuthorityRow });
const ROWS_UNMEASURED = { kind: 'unmeasured' } as const;
const rb = (cause: string): CoherenceVerdict => ({ kind: 'rolled-back', cause } as CoherenceVerdict);

describe('authorityCoherence: Table 7.6a, row by row', () => {
  const three = chain(3);
  it('1: an unreadable file reads unmeasured (journal), whatever the rows', () => {
    expect(authorityCoherence(UNREADABLE, rows(pos(three[2]!)))).toEqual({ kind: 'unmeasured', why: 'journal' });
    expect(authorityCoherence(UNREADABLE, ROWS_UNMEASURED)).toEqual({ kind: 'unmeasured', why: 'journal' });
  });
  it('2: an unreadable head row reads unmeasured (rows), never missing', () => {
    expect(authorityCoherence(recs(three), ROWS_UNMEASURED)).toEqual({ kind: 'unmeasured', why: 'rows' });
    expect(authorityCoherence(ABSENT, ROWS_UNMEASURED)).toEqual({ kind: 'unmeasured', why: 'rows' });
  });
  it('3: a malformed file, or a tail the heal did not take, reads malformed', () => {
    expect(authorityCoherence(MALFORMED, rows(null))).toEqual(rb('malformed'));
    expect(authorityCoherence(recs(three, tail(99)), rows(pos(three[2]!)))).toEqual(rb('malformed'));
  });
  it('4: no file, no head row and no Overlord row is a fresh box: coherent', () => {
    expect(authorityCoherence(ABSENT, rows(null))).toEqual({ kind: 'coherent' });
    expect(authorityCoherence(recs([]), rows(null))).toEqual({ kind: 'coherent' });
  });
  it('5: no file beside a head row or any Overlord row reads missing', () => {
    expect(authorityCoherence(ABSENT, rows(pos(three[0]!)))).toEqual(rb('missing'));
    expect(authorityCoherence(ABSENT, rows(null, true))).toEqual(rb('missing'));
  });
  it('6: the head row equal to the file\'s head is coherent', () => {
    expect(authorityCoherence(recs(three), rows(pos(three[2]!)))).toEqual({ kind: 'coherent' });
  });
  it('7: another record at the row\'s sequence reads diverged', () => {
    expect(authorityCoherence(recs(three), rows(pos(chain(2, 1)[1]!)))).toEqual(rb('diverged'));
    expect(authorityCoherence(recs(three), rows({ ...pos(three[2]!), digest: 'f'.repeat(64) }))).toEqual(rb('diverged'));
  });
  it('8: the file one record past the row reads trailing, and a first record with no head row too', () => {
    expect(authorityCoherence(recs(three), rows(pos(three[1]!)))).toEqual(rb('trailing'));
    expect(authorityCoherence(recs(chain(1)), rows(null))).toEqual(rb('trailing'));
  });
  it('9: the file further past the row reads ahead', () => {
    expect(authorityCoherence(recs(three), rows(pos(three[0]!)))).toEqual(rb('ahead'));
    expect(authorityCoherence(recs(three), rows(null))).toEqual(rb('ahead'));
  });
  it('10: the file\'s head below the row reads behind', () => {
    expect(authorityCoherence(recs(chain(2)), rows(pos(three[2]!)))).toEqual(rb('behind'));
  });
});

describe('authorityTailHeal: the kernel\'s rule with this journal\'s prefixSound', () => {
  const two = chain(2);
  it('heals a torn tail behind a sound prefix whose head row equals the last complete record', () => {
    const plan = authorityTailHeal(recs(two, tail(500)), rows(pos(two[1]!)));
    expect(plan).toMatchObject({ offset: 500, code: 'torn-tail' });
    expect(plan!.name).toMatch(/^500-[0-9a-f]{64}\.tail$/);
    expect(authorityTailHeal(recs([], tail(0)), rows(null))).toMatchObject({ offset: 0 });
  });
  it('refuses a tail when the head row differs, is absent beside records, or is unreadable', () => {
    expect(authorityTailHeal(recs(two, tail(500)), rows(pos(two[0]!)))).toBeNull();
    expect(authorityTailHeal(recs(two, tail(500)), rows(null))).toBeNull();
    expect(authorityTailHeal(recs([], tail(0)), rows(pos(two[0]!)))).toBeNull();
    expect(authorityTailHeal(recs(two, tail(500)), ROWS_UNMEASURED)).toBeNull();
  });
  it('has nothing to heal without a tail, and never heals a malformed file', () => {
    expect(authorityTailHeal(recs(two), rows(pos(two[1]!)))).toBeNull();
    expect(authorityTailHeal(MALFORMED, rows(null))).toBeNull();
  });
});

describe('authorityCoherence over a generated domain (seed 7, 1,000 cases)', () => {
  const rnd = mulberry32(7);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const A = chain(4);
  const B = chain(4, 1);
  const genFile = (): AuthorityFileSeen<OverlordAuthorityEntry> => {
    const k = pick(['unmeasured', 'absent', 'malformed', 'records', 'records', 'records'] as const);
    if (k === 'unmeasured') return UNREADABLE;
    if (k === 'absent') return ABSENT;
    if (k === 'malformed') return MALFORMED;
    return recs(A.slice(0, Math.floor(rnd() * 5)), rnd() < 0.2 ? tail(1) : null);
  };
  const genRows = (): AuthorityRowsSeen => {
    if (rnd() < 0.15) return ROWS_UNMEASURED;
    const k = Math.floor(rnd() * 5);
    const head = k === 0 ? null : pos(pick([A, B])[k - 1]!);
    return rows(head, rnd() < 0.5);
  };
  const cases = Array.from({ length: 1000 }, () => ({ file: genFile(), rows: genRows() }));
  const WORDS = new Set(['coherent', 'rolled-back:missing', 'rolled-back:behind', 'rolled-back:ahead', 'rolled-back:trailing',
    'rolled-back:malformed', 'rolled-back:diverged', 'unmeasured:journal', 'unmeasured:rows']);
  const word = (v: CoherenceVerdict): string => (v.kind === 'coherent' ? 'coherent' : v.kind === 'rolled-back' ? `rolled-back:${v.cause}` : `unmeasured:${v.why}`);

  it('is total: every case answers one word of the table and never throws', () => {
    const seen = new Set<string>();
    for (const c of cases) {
      const w = word(authorityCoherence(c.file, c.rows));
      expect(WORDS.has(w), w).toBe(true);
      seen.add(w);
    }
    expect([...seen].sort()).toEqual([...WORDS].sort());
  });

  it('is monotone: replacing an input with unmeasured, malformed or absent never turns a refusal into coherent, but for the fresh box', () => {
    const fresh = (f: AuthorityFileSeen<OverlordAuthorityEntry>, r: AuthorityRowsSeen): boolean =>
      (f.kind === 'absent' || (f.kind === 'records' && f.records.length === 0 && f.tail === null))
      && r.kind === 'measured' && r.head === null && !r.anyAuthorityRow;
    for (const c of cases) {
      if (authorityCoherence(c.file, c.rows).kind === 'coherent') continue;
      const swaps: Array<[AuthorityFileSeen<OverlordAuthorityEntry>, AuthorityRowsSeen]> = [
        [UNREADABLE, c.rows], [MALFORMED, c.rows], [ABSENT, c.rows], [c.file, ROWS_UNMEASURED],
        [c.file, c.rows.kind === 'measured' ? rows(null, c.rows.anyAuthorityRow) : c.rows],
      ];
      for (const [f, r] of swaps) {
        if (authorityCoherence(f, r).kind === 'coherent') expect(fresh(f, r), JSON.stringify({ f: f.kind, r })).toBe(true);
      }
    }
  });
});
