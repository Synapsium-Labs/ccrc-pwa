// Overlord W2, act journal plan question 12 (slug `guard-names-the-journal`), the coordinator's point 4: the guard's failure call
// gains an optional second argument naming the journal. CHARACTERISATION FIRST: the table below is today's behaviour of
// `writerFailed(cause)` with one argument, from every state the guard can hold, as exact objects (an added key on today's path is
// a red), and the restore latch's detail for each state. It was green on `main`'s code before the change, and stays green after.
import { describe, expect, it } from 'vitest';
import type { AuthorityState, CoherenceVerdict } from '../src/coord/overlordAuthorityCoherence.js';
import { OverlordAuthorityGuard } from '../src/coord/overlordAuthorityGuard.js';
import type { AuthorityWriterFailure } from '../src/coord/overlordAuthorityJournal.js';
import { restoreDetail } from '../src/coord/overlordRestoreLatch.js';

/** A guard whose boot verdict put it in `from`; its port is never asked (no remeasure here). */
function guardAt(from: AuthorityState): OverlordAuthorityGuard {
  const g = new OverlordAuthorityGuard({ healTornTail: () => ({ kind: 'no-tail' }), measure: () => ({ kind: 'coherent' }) });
  if (from.kind === 'rolled-back' && (from.cause === 'witness-epoch' || from.cause === 'witness-heads')) {
    g.bootVerdict({ kind: 'coherent' });
    g.witnessRefused(from.cause);
  } else if (from.kind === 'unmeasured' && from.why === 'privacy-head') {
    g.bootVerdict({ kind: 'coherent' });
    g.witnessUnmeasured('privacy-head');
  } else {
    g.bootVerdict(from as CoherenceVerdict);
  }
  expect(g.state()).toEqual(from);
  return g;
}

const STATES: readonly AuthorityState[] = [
  { kind: 'coherent' },
  { kind: 'unmeasured', why: 'journal' }, { kind: 'unmeasured', why: 'rows' }, { kind: 'unmeasured', why: 'privacy-head' },
  { kind: 'rolled-back', cause: 'behind' }, { kind: 'rolled-back', cause: 'witness-epoch' },
];
const CAUSES: readonly AuthorityWriterFailure[] = ['missing', 'behind', 'ahead', 'trailing', 'malformed', 'diverged', 'journal-unreadable', 'rows-unreadable'];

/** Today's rule, written out: an unreadable cause moves only a coherent guard, to `unmeasured` with its word; any other cause moves
 *  a coherent or unmeasured guard to `rolled-back` with that cause; a rollback stays. */
function expected(from: AuthorityState, cause: AuthorityWriterFailure): AuthorityState {
  if (cause === 'journal-unreadable' || cause === 'rows-unreadable') {
    return from.kind === 'coherent' ? { kind: 'unmeasured', why: cause === 'journal-unreadable' ? 'journal' : 'rows' } : from;
  }
  return from.kind === 'rolled-back' ? from : { kind: 'rolled-back', cause } as AuthorityState;
}

describe('characterisation: writerFailed(cause), one argument, from every state', () => {
  for (const from of STATES) {
    for (const cause of CAUSES) {
      it(`${JSON.stringify(from)} + ${cause}`, () => {
        const g = guardAt(from);
        g.writerFailed(cause);
        expect(g.state()).toStrictEqual(expected(from, cause));
      });
    }
  }
});

describe('characterisation: the restore latch\'s detail names the authority journal', () => {
  it('for each state', () => {
    expect(restoreDetail({ kind: 'coherent' })).toBe('the authority journal reads coherent');
    expect(restoreDetail({ kind: 'rolled-back', cause: 'trailing' })).toBe('the authority journal reads rolled-back: trailing');
    expect(restoreDetail({ kind: 'unmeasured', why: 'rows' })).toBe('the authority journal reads unmeasured: rows');
  });
});
