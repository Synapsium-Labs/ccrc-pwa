// Overlord W1, authority journal plan Task 3 (PR A): the Overlord authority journal's grammar on the chained kernel, its
// direction rule and its fold (`server/src/coord/overlordAuthority.ts`, L1). Pure: no file, no clock.
import { describe, expect, it } from 'vitest';
import { buildChainedRecord, chainNext, decodeChainedLine, encodeChainedRecord, type ChainedJournalRecord } from '../src/chainedJournal.js';
import { isOverlordAuthorityKebab } from '../src/coord/overlordAuthorityJournal.js';
import { DELEGATION_JOURNAL_FORMAT, DelegationJournalError } from '../src/coord/delegation-journal.js';
import {
  OVERLORD_AUTHORITY_FORMAT, OVERLORD_AUTHORITY_KINDS, OverlordAuthorityError, authorityDirection, authorityEntry, authorityFold,
  type OverlordAuthorityEntry, type OverlordAuthorityKind, type OverlordAuthorityMove,
} from '../src/coord/overlordAuthority.js';

const GEN = '0f0e0d0c-0b0a-4908-8706-050403020100';
const CONFIRM: Extract<OverlordAuthorityEntry, { kind: 'authority-restore-confirmed' }> = {
  kind: 'authority-restore-confirmed', opKey: 'op-9', term: 4, epochAtConfirm: 7, privacySequenceAtConfirm: null, restoreGeneration: 1,
  newChain: false, binding: { kind: 'kept', sessionId: 'lane-a-project-a', generation: GEN }, operatorRung: 'advise',
  latches: [{ cause: 'probes-failed-twice', cap: 'chat' }, { cause: 'restore-detected', cap: 'chat' }],
  accountSet: { pools: ['pool-a'], untagged: false }, modelClass: 'opus',
};
/** One well-formed sample of each kind. */
const SAMPLES: { readonly [K in OverlordAuthorityKind]: Extract<OverlordAuthorityEntry, { kind: K }> } = {
  'authority-designate': { kind: 'authority-designate', opKey: 'op-1', term: 1, sessionId: 'lane-a-project-a', generation: GEN },
  'authority-rebind': { kind: 'authority-rebind', opKey: 'op-2', term: 2, sessionId: 'lane-b-project-a', generation: GEN, previousSessionId: 'lane-a-project-a' },
  'authority-retire': { kind: 'authority-retire', opKey: 'op-3', term: 3, previousSessionId: 'lane-b-project-a' },
  'authority-rung': { kind: 'authority-rung', opKey: 'op-4', from: 'full', to: 'advise' },
  'authority-latch-raise': { kind: 'authority-latch-raise', opKey: 'op-5', cause: 'restore-detected', cap: 'chat' },
  'authority-latch-clear': { kind: 'authority-latch-clear', opKey: 'op-6', cause: 'restore-detected' },
  'authority-account-set': { kind: 'authority-account-set', opKey: 'op-7', from: { pools: ['pool-a', 'pool-b'], untagged: true }, to: { pools: ['pool-a'], untagged: false } },
  'authority-model-class': { kind: 'authority-model-class', opKey: 'op-8', from: 'fable', to: 'opus' },
  'authority-restore-confirmed': CONFIRM,
};
const KINDS = Object.keys(OVERLORD_AUTHORITY_KINDS) as OverlordAuthorityKind[];
const at = (n: number): string => `2026-11-16T10:00:${String(n).padStart(2, '0')}.000Z`;

/** Records chained from sequence 1 over the given entries. */
function chain(entries: readonly OverlordAuthorityEntry[]): ChainedJournalRecord<OverlordAuthorityEntry>[] {
  const out: ChainedJournalRecord<OverlordAuthorityEntry>[] = [];
  entries.forEach((entry, i) => {
    const prev = out[i - 1];
    out.push(buildChainedRecord(OVERLORD_AUTHORITY_FORMAT, { ...chainNext(prev ?? null), acceptedAt: at(i + 1), entry }));
  });
  return out;
}
const refusal = (raw: unknown): OverlordAuthorityError => {
  try { authorityEntry(raw); } catch (err) { if (err instanceof OverlordAuthorityError) return err; throw err; }
  throw new Error(`accepted ${JSON.stringify(raw)}`);
};
/** A value of the wrong type for whatever a key holds. */
const wrong = (v: unknown): unknown => (typeof v === 'string' ? 7 : typeof v === 'number' ? 'seven' : typeof v === 'boolean' ? 'no' : 'x');

describe('the Overlord authority grammar (Task 3)', () => {
  it.each(KINDS)('%s round-trips through the kernel', (kind) => {
    const [rec] = chain([SAMPLES[kind]]);
    const line = encodeChainedRecord(OVERLORD_AUTHORITY_FORMAT, rec!);
    expect(line[line.length - 1]).toBe(0x0a);
    const back = decodeChainedLine(OVERLORD_AUTHORITY_FORMAT, line.subarray(0, line.length - 1));
    expect(back).toEqual(rec);
  });

  it.each(KINDS)('%s refuses a missing key, an unknown key and a wrong value for every key', (kind) => {
    const sample = SAMPLES[kind] as unknown as Record<string, unknown>;
    for (const key of Object.keys(sample)) {
      const missing = { ...sample };
      delete missing[key];
      expect(refusal(missing).code, `missing ${key}`).toBe('bad-field');
      if (key !== 'kind') expect(refusal({ ...sample, [key]: wrong(sample[key]) }).code, `wrong ${key}`).toBe('bad-field');
    }
    expect(refusal({ ...sample, extra: 1 }).code).toBe('unknown-key');
  });

  it('refuses a wrong word: a rung, a cap, a model class, a pool, a cause, an unsorted set, a binding', () => {
    expect(refusal({ ...SAMPLES['authority-rung'], to: 'max' }).message).toMatch(/to is not one of off, chat, advise, full/);
    expect(refusal({ ...SAMPLES['authority-latch-raise'], cap: 'high' }).code).toBe('bad-field');
    expect(refusal({ ...SAMPLES['authority-model-class'], to: 'sonnet' }).code).toBe('bad-field');
    expect(refusal({ ...SAMPLES['authority-account-set'], to: { pools: ['Pool A'], untagged: false } }).code).toBe('bad-field');
    expect(refusal({ ...SAMPLES['authority-account-set'], to: { pools: ['pool-b', 'pool-a'], untagged: false } }).message).toMatch(/sorted and unique/);
    expect(refusal({ ...SAMPLES['authority-account-set'], to: { pools: ['pool-a', 'pool-a'], untagged: false } }).message).toMatch(/sorted and unique/);
    expect(refusal({ ...SAMPLES['authority-latch-clear'], cause: 'Restore Detected' }).code).toBe('bad-field');
    expect(refusal({ ...CONFIRM, binding: { kind: 'kept', sessionId: 'lane-a-project-a' } }).code).toBe('bad-field');
    expect(refusal({ ...CONFIRM, binding: { kind: 'gone' } }).code).toBe('bad-field');
    expect(refusal({ ...SAMPLES['authority-designate'], opKey: 'has a space' }).code).toBe('bad-field');
  });

  it('a generation is a string, the UUID ccd records, never a number (X2)', () => {
    expect(refusal({ ...SAMPLES['authority-designate'], generation: 3 }).code).toBe('bad-field');
    expect(refusal({ ...SAMPLES['authority-rebind'], generation: 3 }).code).toBe('bad-field');
    expect(refusal({ ...CONFIRM, binding: { kind: 'kept', sessionId: 'lane-a-project-a', generation: 3 } }).code).toBe('bad-field');
  });

  it('a Confirm record refuses a bare cause string, a cap outside the rung words and one cause twice (F5)', () => {
    expect(refusal({ ...CONFIRM, latches: ['restore-detected'] }).code).toBe('bad-field');
    expect(refusal({ ...CONFIRM, latches: [{ cause: 'restore-detected', cap: 'low' }] }).code).toBe('bad-field');
    expect(refusal({ ...CONFIRM, latches: [{ cause: 'restore-detected', cap: 'chat' }, { cause: 'restore-detected', cap: 'off' }] }).message)
      .toMatch(/one per cause/);
    expect(refusal({ ...CONFIRM, latches: [{ cause: 'restore-detected', cap: 'chat' }, { cause: 'probes-failed-twice', cap: 'chat' }] }).code)
      .toBe('bad-field');
  });

  it('a latch cause a later build names still reads (checked by shape, never by a closed list)', () => {
    expect(authorityEntry({ ...SAMPLES['authority-latch-raise'], cause: 'a-cause-from-a-newer-build' })).toMatchObject({ cause: 'a-cause-from-a-newer-build' });
  });

  it('the census row: this grammar refuses the delegation journal\'s kinds, and the delegation grammar refuses these', () => {
    for (const k of DELEGATION_JOURNAL_FORMAT.kinds) {
      const e = refusal({ ...SAMPLES['authority-rung'], kind: k });
      expect(e.message).toContain(JSON.stringify(k));
    }
    for (const k of KINDS) expect(() => DELEGATION_JOURNAL_FORMAT.entry({ ...SAMPLES[k] })).toThrow(DelegationJournalError);
    expect(OVERLORD_AUTHORITY_FORMAT.kinds.filter((k) => DELEGATION_JOURNAL_FORMAT.kinds.includes(k))).toEqual([]);
  });

  it('every kind is a kebab word the coordination scan admits, and nothing else is', () => {
    for (const k of KINDS) expect(isOverlordAuthorityKebab(k)).toBe(true);
    expect(isOverlordAuthorityKebab('authority-nothing')).toBe(false);
    for (const w of ['row-only', 'journal-append', 'not-healable', 'witness-epoch', 'privacy-head', 'overlord-authority-torn']) expect(isOverlordAuthorityKebab(w), w).toBe(true);
  });
});

describe('authorityDirection: every row of the grammar table, both ways where it has two', () => {
  const d = (e: OverlordAuthorityMove): string => authorityDirection(e);
  it('a binding widens, a retire narrows', () => {
    expect(d(SAMPLES['authority-designate'])).toBe('widens');
    expect(d(SAMPLES['authority-rebind'])).toBe('widens');
    expect(d(SAMPLES['authority-retire'])).toBe('narrows');
  });
  it('a rung narrows down and widens up; the same rung grants nothing', () => {
    expect(d({ ...SAMPLES['authority-rung'], from: 'full', to: 'advise' })).toBe('narrows');
    expect(d({ ...SAMPLES['authority-rung'], from: 'chat', to: 'off' })).toBe('narrows');
    expect(d({ ...SAMPLES['authority-rung'], from: 'advise', to: 'full' })).toBe('widens');
    expect(d({ ...SAMPLES['authority-rung'], from: 'off', to: 'chat' })).toBe('widens');
    expect(d({ ...SAMPLES['authority-rung'], from: 'chat', to: 'chat' })).toBe('narrows');
  });
  it('a latch raise narrows, a clear widens', () => {
    expect(d(SAMPLES['authority-latch-raise'])).toBe('narrows');
    expect(d(SAMPLES['authority-latch-clear'])).toBe('widens');
  });
  it('an account set narrows within its from, else widens', () => {
    const s = SAMPLES['authority-account-set'];
    expect(d(s)).toBe('narrows');
    expect(d({ ...s, from: { pools: ['pool-a'], untagged: false }, to: { pools: ['pool-a'], untagged: false } })).toBe('narrows');
    expect(d({ ...s, from: { pools: ['pool-a'], untagged: false }, to: { pools: ['pool-a', 'pool-b'], untagged: false } })).toBe('widens');
    expect(d({ ...s, from: { pools: ['pool-a'], untagged: false }, to: { pools: ['pool-a'], untagged: true } })).toBe('widens');
    expect(d({ ...s, from: { pools: [], untagged: true }, to: { pools: [], untagged: false } })).toBe('narrows');
  });
  it('a model class narrows to opus and widens to fable', () => {
    expect(d({ ...SAMPLES['authority-model-class'], from: 'fable', to: 'opus' })).toBe('narrows');
    expect(d({ ...SAMPLES['authority-model-class'], from: 'opus', to: 'fable' })).toBe('widens');
  });
});

describe('authorityFold', () => {
  it('an empty journal folds to every field null', () => {
    const v = authorityFold([]);
    expect(v).toMatchObject({ designation: null, operatorRung: null, accountSet: null, modelClass: null, lastConfirm: null });
    expect([...v.latches]).toEqual([]);
  });
  it('designate, then rebind, then retire leaves no binding and the last term', () => {
    const v = authorityFold(chain([SAMPLES['authority-designate'], SAMPLES['authority-rebind'], SAMPLES['authority-retire']]));
    expect(v.designation).toEqual({ term: 3, sessionId: null, generation: null });
    expect(authorityFold(chain([SAMPLES['authority-designate'], SAMPLES['authority-rebind']])).designation)
      .toEqual({ term: 2, sessionId: 'lane-b-project-a', generation: GEN });
  });
  it('a latch raised then cleared leaves none; a raised latch keeps its cap; a second raise never raises the cap', () => {
    expect([...authorityFold(chain([SAMPLES['authority-latch-raise'], SAMPLES['authority-latch-clear']])).latches]).toEqual([]);
    expect([...authorityFold(chain([SAMPLES['authority-latch-raise']])).latches]).toEqual([['restore-detected', 'chat']]);
    const twice = authorityFold(chain([
      { ...SAMPLES['authority-latch-raise'], cap: 'off' }, { ...SAMPLES['authority-latch-raise'], opKey: 'op-5b', cap: 'advise' },
    ]));
    expect([...twice.latches]).toEqual([['restore-detected', 'off']]);
  });
  it('the rung, the account set and the model class take each record\'s to', () => {
    const v = authorityFold(chain([SAMPLES['authority-rung'], SAMPLES['authority-account-set'], SAMPLES['authority-model-class']]));
    expect(v).toMatchObject({ operatorRung: 'advise', accountSet: { pools: ['pool-a'], untagged: false }, modelClass: 'opus' });
  });
  it('a Confirm sets lastConfirm and every field to what it carries, so a widening before it is gone', () => {
    const recs = chain([
      { ...SAMPLES['authority-rung'], from: 'advise', to: 'full' },
      { ...SAMPLES['authority-latch-raise'], cause: 'invariant-violation', cap: 'advise' },
      { ...SAMPLES['authority-model-class'], from: 'opus', to: 'fable' },
      CONFIRM,
    ]);
    const v = authorityFold(recs);
    expect(v.operatorRung).toBe('advise');
    expect(v.modelClass).toBe('opus');
    expect([...v.latches]).toEqual([['probes-failed-twice', 'chat'], ['restore-detected', 'chat']]);
    expect(v.designation).toEqual({ term: 4, sessionId: 'lane-a-project-a', generation: GEN });
    expect(v.accountSet).toEqual({ pools: ['pool-a'], untagged: false });
    expect(v.lastConfirm).toEqual({ sequence: 4, epochAtConfirm: 7, privacySequenceAtConfirm: null, restoreGeneration: 1 });
    expect(authorityFold(chain([{ ...CONFIRM, binding: { kind: 'cleared' } }])).designation).toEqual({ term: 4, sessionId: null, generation: null });
  });
});
