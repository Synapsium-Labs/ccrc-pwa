// Landing order wave 5f, Task 3: the advance's wire answer is exactly the store's `LandingWrite`, defined once in the
// import-free L0 vocabulary (`shared/landingLine.ts`) and carried by `AdvanceOk.landing`. The teeth are TYPE-level:
// a vitest run only transpiles this file, so `typecheck-tests.test.ts` (a spawned tsc over `server/test/`, run alone) is
// what turns a loose `{ kind: string; entry? }` payload red. The runtime cases below are the narrowing and the literal.
import { describe, it, expect } from 'vitest';
import type { AdvanceOk } from '../../shared/api.js';
import type { LandingEntry, LandingWrite } from '../../shared/landingLine.js';
import type { LandingWrite as StoreLandingWrite } from '../src/coord/landingEntry.js';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

type Wire = NonNullable<AdvanceOk['landing']>;
// The wire is the shared union, whole: not a loose kind string, not a subset.
type _WireIsTheUnion = Assert<Equals<Wire, LandingWrite>>;
// The store's answer is that same union (a re-export, never a second definition).
type _StoreIsTheUnion = Assert<Equals<StoreLandingWrite, LandingWrite>>;
// The field stays optional: an older server's answer carries none.
type _StaysOptional = Assert<Equals<AdvanceOk['landing'], LandingWrite | undefined>>;
type _KindsAreTheClosedList = Assert<Equals<Wire['kind'],
  'none' | 'no-pr' | 'no-episode' | 'no-entry' | 'kept' | 'pinned' | 'ejected'>>;

/** Each slot is `true` only while its assertion holds; a slot whose type is `false` does not accept the literal. */
const proofs: [_WireIsTheUnion, _StoreIsTheUnion, _StaysOptional, _KindsAreTheClosedList] = [true, true, true, true];

const entry: LandingEntry = {
  id: 3, project: 'project-a', pr: 7, pinnedSha: 'a'.repeat(40), handoffCommit: 'c'.repeat(40), runId: 11, state: 'pinned',
  baseSha: null, ejectionKind: null, ejections: 0, afterIds: [], fixesMain: false, setBy: 'coord-a', pinnedAt: 1,
};

/** Narrowing: `entry` exists on `pinned` and `ejected` only, `state` on `kept` only, `created` on `pinned` only. */
function describeWrite(w: Wire): string {
  switch (w.kind) {
    case 'pinned': return `pinned ${w.entry.pr} created=${String(w.created)}`;
    case 'ejected': return `ejected ${w.entry.pr}`;
    case 'kept': return `kept ${w.state}`;
    default: return w.kind;
  }
}

describe('AdvanceOk.landing is the one LandingWrite union (wave 5f Task 3)', () => {
  it('the type equalities hold (the spawned tsc is what checks them)', () => {
    expect(proofs).toEqual([true, true, true, true]);
  });

  it('one pinned literal is a wire answer, and narrowing reaches its entry and created flag', () => {
    const pinned: Wire = { kind: 'pinned', entry, created: true };
    const ok: Pick<AdvanceOk, 'landing'> = { landing: pinned };
    expect(ok.landing).toEqual({ kind: 'pinned', entry, created: true });
    expect(describeWrite(pinned)).toBe('pinned 7 created=true');
  });

  it('kept carries a state, ejected carries an entry, the plain words carry nothing', () => {
    expect(describeWrite({ kind: 'kept', state: 'unknown' })).toBe('kept unknown');
    expect(describeWrite({ kind: 'ejected', entry: { ...entry, state: 'ejected' } })).toBe('ejected 7');
    for (const kind of ['none', 'no-pr', 'no-episode', 'no-entry'] as const) expect(describeWrite({ kind })).toBe(kind);
  });

  it('an older server\'s answer carries no landing at all (optional undefined)', () => {
    const older: Pick<AdvanceOk, 'landing'> = { landing: undefined };
    const absent: Pick<AdvanceOk, 'landing'> = {};
    expect(older.landing).toBeUndefined();
    expect(absent.landing).toBeUndefined();
  });

  it('negative assertions: an invented kind, a pinned with no created, and a kept with no state do not compile', () => {
    // Each line below is a compile error the spawned tsc must see; at runtime they are only values.
    // @ts-expect-error an invented kind is not a LandingWrite word
    const invented: AdvanceOk['landing'] = { kind: 'invented' };
    // @ts-expect-error a pinned answer without `created` is not total
    const noCreated: AdvanceOk['landing'] = { kind: 'pinned', entry };
    // @ts-expect-error a kept answer without its `state` is not total
    const noState: AdvanceOk['landing'] = { kind: 'kept' };
    // @ts-expect-error a pinned answer without its entry is not total
    const noEntry: AdvanceOk['landing'] = { kind: 'pinned', created: false };
    expect([invented, noCreated, noState, noEntry]).toHaveLength(4);
  });
});
