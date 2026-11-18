// Overlord W1, authority journal plan Task 3 (PR A): the Overlord authority journal's grammar on the chained kernel, its
// direction rule and its fold (`server/src/coord/overlordAuthority.ts`, L1). Pure: no file, no clock.
import { describe, expect, it } from 'vitest';
import { buildChainedRecord, chainNext, decodeChainedLine, encodeChainedRecord, type ChainedJournalRecord } from '../src/chainedJournal.js';
import { isOverlordAuthorityKebab } from '../src/coord/overlordAuthorityJournal.js';
import { DELEGATION_JOURNAL_FORMAT, DelegationJournalError } from '../src/coord/delegation-journal.js';
import type { DecisionRowSide } from '../../shared/decisionModel.js';
import {
  OVERLORD_AUTHORITY_FORMAT, OVERLORD_AUTHORITY_KINDS, OverlordAuthorityError, authorityAgainstFold, authorityDirection, authorityEntry,
  authorityFold, canonicalAuthorityMove,
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
  'authority-decision-row': {
    kind: 'authority-decision-row', opKey: 'op-10', row: 'scope.widens', gate: true,
    from: { mode: 'shadow', ceiling: 600, armedLine: null, held: false },
    to: { mode: 'armed', ceiling: 600, armedLine: { id: 3, line: 0.9 }, held: false },
  },
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

  describe('authority-decision-row (Overlord W2, decision model B)', () => {
    const S = SAMPLES['authority-decision-row'];
    const side = (o: Partial<DecisionRowSide> = {}): DecisionRowSide => ({ mode: 'shadow', ceiling: 600, armedLine: null, held: false, ...o });

    it('takes its sample and returns it whole', () => {
      expect(authorityEntry({ ...S })).toEqual(S);
    });
    it('refuses a missing key and an extra key at the top, in a side and in an armed line', () => {
      for (const key of ['row', 'gate', 'from', 'to', 'opKey']) {
        const o = { ...S } as Record<string, unknown>;
        delete o[key];
        expect(refusal(o).code, `missing ${key}`).toBe('bad-field');
      }
      expect(refusal({ ...S, extra: 1 }).code).toBe('unknown-key');
      for (const key of ['mode', 'ceiling', 'armedLine', 'held']) {
        const f = { ...S.to } as unknown as Record<string, unknown>;
        delete f[key];
        expect(refusal({ ...S, to: f }).code, `side missing ${key}`).toBe('bad-field');
      }
      expect(refusal({ ...S, from: { ...S.from, extra: 1 } }).code).toBe('unknown-key');
      expect(refusal({ ...S, to: { ...S.to, armedLine: { id: 3, line: 0.9, extra: 1 } } }).code).toBe('unknown-key');
      expect(refusal({ ...S, to: { ...S.to, armedLine: { id: 3 } } }).code).toBe('bad-field');
      expect(refusal({ ...S, to: { ...S.to, armedLine: { line: 0.9 } } }).code).toBe('bad-field');
    });
    it('refuses a row the catalogue does not hold', () => {
      expect(refusal({ ...S, row: 'scope.narrows' }).message).toMatch(/not a decision-model row/);
      expect(refusal({ ...S, row: '__proto__' }).code).toBe('bad-field');
      expect(refusal({ ...S, row: 'toString' }).code).toBe('bad-field');
    });
    it('checks gate against the catalogue: scope.widens is the one gate, every other row is advice', () => {
      expect(refusal({ ...S, gate: false }).message).toMatch(/gate is not scope\.widens's direction/);
      for (const row of ['programme.pick', 'programme.any', 'relay.method', 'readback.omits', 'readback.adds', 'goals.conflict']) {
        expect(authorityEntry({ ...S, row, gate: false }), row).toMatchObject({ row, gate: false });
        expect(refusal({ ...S, row, gate: true }).message, row).toMatch(/gate is not/);
      }
    });
    it('takes a ceiling of 50 and of 5000 and refuses 49, 5001, a fraction, a string and NaN', () => {
      for (const ceiling of [50, 5000, 600]) {
        expect(authorityEntry({ ...S, from: side({ ceiling }), to: side({ ceiling }) })).toMatchObject({ from: { ceiling }, to: { ceiling } });
      }
      for (const ceiling of [49, 5001, 0, -50, 60.5, '600', Number.NaN, Infinity, null]) {
        expect(refusal({ ...S, to: side({ ceiling: ceiling as number }) }).code, `to ${String(ceiling)}`).toBe('bad-field');
        expect(refusal({ ...S, from: side({ ceiling: ceiling as number }) }).code, `from ${String(ceiling)}`).toBe('bad-field');
      }
    });
    it('refuses a mode outside the three, and takes each of the three', () => {
      for (const mode of ['off', 'shadow', 'armed']) expect(authorityEntry({ ...S, to: side({ mode: mode as never }) })).toMatchObject({ to: { mode } });
      for (const mode of ['on', 'ARMED', '', 7, null, 'toString']) {
        expect(refusal({ ...S, to: side({ mode: mode as never }) }).message, String(mode)).toMatch(/mode is not off, shadow or armed/);
      }
    });
    it('refuses an armedLine without a line, or with a line outside 0 to 1 or not a number; takes the ends', () => {
      expect(refusal({ ...S, to: side({ armedLine: { id: 3 } as never }) }).code).toBe('bad-field');
      expect(refusal({ ...S, to: side({ armedLine: { id: 3, line: undefined } as never }) }).code).toBe('bad-field');
      for (const line of [1.5, -0.1, Number.NaN, Infinity, '0.9', null]) {
        expect(refusal({ ...S, to: side({ armedLine: { id: 3, line: line as number } }) }).message, String(line)).toMatch(/line is not from 0 to 1/);
      }
      for (const line of [0, 1, 0.5]) expect(authorityEntry({ ...S, to: side({ armedLine: { id: 3, line } }) })).toMatchObject({ to: { armedLine: { line } } });
      expect(authorityEntry({ ...S, to: side({ armedLine: null }) })).toMatchObject({ to: { armedLine: null } });
    });
    it('refuses an armedLine id that is not a positive safe integer, and an armedLine that is not null or an object', () => {
      for (const id of [0, -1, 1.5, '3', null, Number.MAX_SAFE_INTEGER + 2]) {
        expect(refusal({ ...S, to: side({ armedLine: { id: id as number, line: 0.9 } }) }).code, String(id)).toBe('bad-field');
      }
      for (const l of [undefined, 0.9, 'x', [1]]) expect(refusal({ ...S, to: side({ armedLine: l as never }) }).code, String(l)).toBe('bad-field');
    });
    it('refuses held that is not a boolean', () => {
      for (const held of [0, 'false', null, undefined]) expect(refusal({ ...S, to: side({ held: held as never }) }).code, String(held)).toBe('bad-field');
    });
    it('the kind is in the format\'s table, and no other journal\'s grammar takes it', () => {
      expect(OVERLORD_AUTHORITY_FORMAT.kinds).toContain('authority-decision-row');
      expect(() => DELEGATION_JOURNAL_FORMAT.entry({ ...S })).toThrow(DelegationJournalError);
    });
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
  it('a decision-model row reads its direction by decisionRowDirection from the entry alone (the full table is decision-model-lines)', () => {
    const S = SAMPLES['authority-decision-row'];
    const side = (o: Partial<DecisionRowSide> = {}): DecisionRowSide => ({ mode: 'shadow', ceiling: 600, armedLine: null, held: false, ...o });
    // spend: off to shadow, or a higher ceiling, widens, gate or advice
    expect(d({ ...S, row: 'relay.method', gate: false, from: side({ mode: 'off' }), to: side({ mode: 'shadow' }) })).toBe('widens');
    expect(d({ ...S, row: 'relay.method', gate: false, from: side(), to: side({ ceiling: 601 }) })).toBe('widens');
    expect(d({ ...S, row: 'relay.method', gate: false, from: side(), to: side({ ceiling: 599 }) })).toBe('narrows');
    expect(d({ ...S, row: 'relay.method', gate: false, from: side({ mode: 'shadow' }), to: side({ mode: 'off' }) })).toBe('narrows');
    // a gate that stops shutting widens; an advice row going the same way narrows
    const armed = side({ mode: 'armed', armedLine: { id: 1, line: 0.9 } });
    expect(d({ ...S, from: armed, to: side({ mode: 'shadow' }) })).toBe('widens');
    expect(d({ ...S, gate: false, row: 'relay.method', from: armed, to: side({ mode: 'shadow' }) })).toBe('narrows');
    // a stricter line narrows, an equal id and value is no move, a looser or unrelated one widens
    expect(d({ ...S, from: armed, to: side({ mode: 'armed', armedLine: { id: 2, line: 0.95 } }) })).toBe('narrows');
    expect(d({ ...S, from: armed, to: side({ mode: 'armed', armedLine: { id: 2, line: 0.8 } }) })).toBe('widens');
    expect(d({ ...S, from: armed, to: armed })).toBe('narrows');
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
  it('decision rows: none before a record; two moves on one row keep the last to; two rows are kept apart', () => {
    const S = SAMPLES['authority-decision-row'];
    expect([...authorityFold([]).decisionRows]).toEqual([]);
    const second = { ...S, opKey: 'op-10b', from: S.to, to: { ...S.to, ceiling: 300 } };
    const other = { ...S, opKey: 'op-10c', row: 'relay.method' as const, gate: false, from: S.from, to: { ...S.from, mode: 'off' as const } };
    const one = authorityFold(chain([S, second])).decisionRows;
    expect([...one.keys()]).toEqual(['scope.widens']);
    expect(one.get('scope.widens')).toEqual(second.to);
    const two = authorityFold(chain([S, other, second])).decisionRows;
    expect([...two.keys()].sort()).toEqual(['relay.method', 'scope.widens']);
    expect(two.get('scope.widens')).toEqual(second.to);
    expect(two.get('relay.method')).toEqual(other.to);
  });
  it('a Confirm record leaves decisionRows as it stood (the stricter of a restored row is restoreStricter\'s, question 12)', () => {
    const S = SAMPLES['authority-decision-row'];
    const v = authorityFold(chain([S, CONFIRM]));
    expect(v.decisionRows.get('scope.widens')).toEqual(S.to);
    expect(v.lastConfirm).not.toBeNull();
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

// Review 2219, fix round 1: the two deciders the writer runs before the grammar and on a coherent journal.
describe('canonicalAuthorityMove (F1, the-writer-canonicalises)', () => {
  it('sorts and de-duplicates both pool lists of an account set, and the grammar then takes it', () => {
    const raw = { ...SAMPLES['authority-account-set'], from: { pools: ['pool-b', 'pool-a', 'pool-a'], untagged: true }, to: { pools: ['pool-a'], untagged: false } };
    const c = canonicalAuthorityMove(raw);
    expect(c).toEqual({ ...raw, from: { pools: ['pool-a', 'pool-b'], untagged: true } });
    expect(authorityEntry(c)).toEqual(c);
    expect(() => authorityEntry(raw)).toThrow(/sorted and unique/);
  });
  it('returns any other kind, and a list that is not all strings, as it came, for the grammar to judge', () => {
    const rung = SAMPLES['authority-rung'];
    expect(canonicalAuthorityMove(rung)).toBe(rung);
    const odd = { ...SAMPLES['authority-account-set'], from: { pools: ['pool-a', 7], untagged: true } };
    expect(canonicalAuthorityMove(odd)).toEqual(odd);
    expect(() => authorityEntry(canonicalAuthorityMove(odd))).toThrow(/pool name/);
  });
});

describe('authorityAgainstFold (F2, stated-from-against-the-fold)', () => {
  const view = (over: Partial<ReturnType<typeof authorityFold>>) => ({ ...authorityFold([]), ...over });
  it('null when the fold holds no value for the field, or the move states no from', () => {
    expect(authorityAgainstFold(SAMPLES['authority-rung'], authorityFold([]))).toBeNull();
    expect(authorityAgainstFold(SAMPLES['authority-latch-raise'], view({ operatorRung: 'chat' }))).toBeNull();
  });
  it('a rung: matches, or the direction from the fold\'s value', () => {
    expect(authorityAgainstFold({ ...SAMPLES['authority-rung'], from: 'chat', to: 'advise' }, view({ operatorRung: 'chat' })))
      .toEqual({ matches: true, direction: 'widens' });
    expect(authorityAgainstFold({ ...SAMPLES['authority-rung'], from: 'full', to: 'advise' }, view({ operatorRung: 'chat' })))
      .toEqual({ matches: false, direction: 'widens' });
    expect(authorityAgainstFold({ ...SAMPLES['authority-rung'], from: 'advise', to: 'chat' }, view({ operatorRung: 'full' })))
      .toEqual({ matches: false, direction: 'narrows' });
  });
  it('a decision-model row: null with no fold value; matches on every field of from; else the direction read from the fold\'s side', () => {
    const S = SAMPLES['authority-decision-row'];
    const rows = (side: DecisionRowSide | null) => view({ decisionRows: new Map(side === null ? [] : [['scope.widens' as const, side]]) });
    expect(authorityAgainstFold(S, rows(null))).toBeNull();
    // the fold holds another row only
    expect(authorityAgainstFold(S, view({ decisionRows: new Map([['relay.method' as const, S.from]]) }))).toBeNull();
    expect(authorityAgainstFold(S, rows(S.from))).toEqual({ matches: true, direction: 'narrows' });
    // each field of from is compared
    expect(authorityAgainstFold(S, rows({ ...S.from, mode: 'off' }))).toMatchObject({ matches: false });
    expect(authorityAgainstFold(S, rows({ ...S.from, ceiling: 601 }))).toMatchObject({ matches: false });
    expect(authorityAgainstFold(S, rows({ ...S.from, held: true }))).toMatchObject({ matches: false });
    expect(authorityAgainstFold(S, rows({ ...S.from, armedLine: { id: 1, line: 0.9 } }))).toMatchObject({ matches: false });
    // armedLine: both null match; an id or a value that differs does not; equal ones match
    const armed = { ...S.from, mode: 'armed' as const, armedLine: { id: 3, line: 0.9 } };
    expect(authorityAgainstFold({ ...S, from: armed, to: { ...armed, mode: 'shadow' } }, rows(armed))).toEqual({ matches: true, direction: 'widens' });
    expect(authorityAgainstFold({ ...S, from: armed, to: { ...armed, mode: 'shadow' } }, rows({ ...armed, armedLine: { id: 4, line: 0.9 } })))
      .toMatchObject({ matches: false });
    expect(authorityAgainstFold({ ...S, from: armed, to: { ...armed, mode: 'shadow' } }, rows({ ...armed, armedLine: { id: 3, line: 0.8 } })))
      .toMatchObject({ matches: false });
    expect(authorityAgainstFold({ ...S, from: armed, to: { ...armed, mode: 'shadow' } }, rows({ ...armed, armedLine: null })))
      .toMatchObject({ matches: false });
  });
  it('a decision-model row that differs reads its direction from the fold\'s side, not from the stated from', () => {
    const S = SAMPLES['authority-decision-row'];
    const off: DecisionRowSide = { mode: 'off', ceiling: 600, armedLine: null, held: false };
    // stated from shadow to shadow narrows on its own; the fold holds off, so shadow is new spend: widens
    const stated = { ...S, from: S.from, to: S.from };
    expect(authorityDirection(stated)).toBe('narrows');
    expect(authorityAgainstFold(stated, view({ decisionRows: new Map([['scope.widens' as const, off]]) }))).toEqual({ matches: false, direction: 'widens' });
    // the other way: stated off to shadow widens on its own; the fold holds shadow, so the same move is no new spend
    const statedWide = { ...S, from: off, to: S.from };
    expect(authorityDirection(statedWide)).toBe('widens');
    expect(authorityAgainstFold(statedWide, view({ decisionRows: new Map([['scope.widens' as const, S.from]]) }))).toEqual({ matches: false, direction: 'narrows' });
  });
  it('an account set compares pools and untagged; a model class its word', () => {
    const set = SAMPLES['authority-account-set'];
    expect(authorityAgainstFold(set, view({ accountSet: { pools: ['pool-a', 'pool-b'], untagged: true } })))
      .toEqual({ matches: true, direction: 'narrows' });
    expect(authorityAgainstFold(set, view({ accountSet: { pools: ['pool-a', 'pool-b'], untagged: false } })))
      .toEqual({ matches: false, direction: 'narrows' });
    expect(authorityAgainstFold(set, view({ accountSet: { pools: ['pool-a'], untagged: true } })))
      .toEqual({ matches: false, direction: 'narrows' });
    expect(authorityAgainstFold({ ...set, to: { pools: ['pool-c'], untagged: false } }, view({ accountSet: { pools: ['pool-a'], untagged: false } })))
      .toEqual({ matches: false, direction: 'widens' });
    expect(authorityAgainstFold(SAMPLES['authority-model-class'], view({ modelClass: 'opus' })))
      .toEqual({ matches: false, direction: 'narrows' });
  });
});
