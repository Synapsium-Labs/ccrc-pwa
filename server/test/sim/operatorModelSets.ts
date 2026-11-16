// Overlord W1, the private store (plan w1-private-store.md, Tasks 2 and 3; the floors rule is D-8217's): the cases over the
// Operator Model's deciders, written once here as suite cases over a module. `operator-messages-moves.test.ts` and
// `privacy-journal.test.ts` run them against the real modules, and `mutation-floors.test.ts` runs them against each named
// mutant. The expected words are written out, never read from the code the cases judge.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MESSAGES_TS = path.join(ROOT, 'server/src/operatorModel/messages.ts');

export type OperatorModelDeciders = typeof import('../../src/operatorModel/messages.js');
export type PrivacyJournalModule = typeof import('../../src/operatorModel/privacyJournal.js');
const PRIVACY_TS = path.join(ROOT, 'server/src/operatorModel/privacyJournal.ts');
export const COHERENCE_KEY = 'server/src/operatorModel/privacyJournal.ts#privacyCoherence';
export const PRIVACY_ENTRY_KEY = 'server/src/operatorModel/privacyJournal.ts#privacyJournalEntry';

export const MESSAGE_MOVE_KEY = 'server/src/operatorModel/messages.ts#messageMove';
export const DELIVERY_STAGE_KEY = 'server/src/operatorModel/messages.ts#deliveryStageOf';
export const CAP_TEXT_KEY = 'server/src/operatorModel/messages.ts#capMessageText';
export const NEXT_ID_KEY = 'server/src/operatorModel/messages.ts#nextMessageId';

type State = 'recorded' | 'queued' | 'delivered' | 'picked-up' | 'settled' | 'spent';
type Event = 'queue' | 'deliver' | 'pick-up' | 'settle' | 'spend' | 'unsettle';
type Actor = 'route' | 'mail-lane' | 'hook' | 'acknowledge' | 'citing-door' | 'boot-pass';
const STATES: State[] = ['recorded', 'queued', 'delivered', 'picked-up', 'settled', 'spent'];
const EVENTS: Event[] = ['queue', 'deliver', 'pick-up', 'settle', 'spend', 'unsettle'];
const ACTORS: Actor[] = ['route', 'mail-lane', 'hook', 'acknowledge', 'citing-door', 'boot-pass'];

/** Table 1 of the plan, written out: the next state, `stage` for `unsettle`'s delivery stage, or absent when refused. */
export const TABLE_1: Record<State, Partial<Record<Event, State | 'stage'>>> = {
  recorded: { queue: 'queued', deliver: 'delivered', 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  queued: { deliver: 'delivered', 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  delivered: { 'pick-up': 'picked-up', settle: 'settled', spend: 'spent' },
  'picked-up': { deliver: 'picked-up', settle: 'settled', spend: 'spent' },
  settled: { queue: 'settled', deliver: 'settled', 'pick-up': 'settled', spend: 'spent', unsettle: 'stage' },
  spent: { queue: 'spent', deliver: 'spent', 'pick-up': 'spent' },
};
/** Who may send each event, written out. */
export const EVENT_ACTORS: Record<Event, Actor[]> = {
  queue: ['route', 'boot-pass'], deliver: ['mail-lane'], 'pick-up': ['hook'], settle: ['route', 'acknowledge', 'citing-door'],
  spend: ['citing-door', 'boot-pass'], unsettle: ['boot-pass'],
};
const STAMP: Record<Event, string | null> = {
  queue: 'queuedAt', deliver: 'deliveredAt', 'pick-up': 'pickedUpAt', settle: 'settledAt', spend: 'spentAt', unsettle: null,
};
const SETTLED_BY: Partial<Record<Actor, string>> = { route: 'mark', acknowledge: 'acknowledge', 'citing-door': 'cite' };
const NO_STAMPS: { queuedAt: number | null; deliveredAt: number | null; pickedUpAt: number | null } = { queuedAt: null, deliveredAt: null, pickedUpAt: null };

// ---------- messageMove ----------

export function messageMoveCases(m: Pick<OperatorModelDeciders, 'messageMove'>): Record<string, SuiteCase> {
  return {
    'every (state, event, actor) triple answers Table 1 and the actor list, and nothing else': () => {
      for (const state of STATES) for (const event of EVENTS) for (const actor of ACTORS) {
        const v = m.messageMove({ state, ...NO_STAMPS }, event, actor);
        const want = TABLE_1[state][event];
        const label = `${state} × ${event} × ${actor}`;
        if (!EVENT_ACTORS[event].includes(actor)) { expect(v, label).toEqual({ ok: false, why: 'actor' }); continue; }
        if (want === undefined) { expect(v, label).toEqual({ ok: false, why: 'move' }); continue; }
        expect(v, label).toEqual({
          ok: true, next: want === 'stage' ? 'recorded' : want, stamp: STAMP[event],
          settledBy: event === 'settle' ? SETTLED_BY[actor] : null, clearSettlement: event === 'unsettle',
        });
      }
    },
    'unsettle returns a settled row to the furthest stage its stamps prove': () => {
      const at = (s: Partial<typeof NO_STAMPS>): unknown => {
        const v = m.messageMove({ state: 'settled', ...NO_STAMPS, ...s }, 'unsettle', 'boot-pass');
        return v.ok ? v.next : v.why;
      };
      expect(at({})).toBe('recorded');
      expect(at({ queuedAt: 1 })).toBe('queued');
      expect(at({ queuedAt: 1, deliveredAt: 2 })).toBe('delivered');
      expect(at({ deliveredAt: 2 })).toBe('delivered');
      expect(at({ pickedUpAt: 3 })).toBe('picked-up');
      expect(at({ queuedAt: 1, deliveredAt: 2, pickedUpAt: 3 })).toBe('picked-up');
    },
    'a state this build does not know is never moved, by any event or actor': () => {
      for (const event of EVENTS) for (const actor of ACTORS) {
        expect(m.messageMove({ state: 'unknown', ...NO_STAMPS }, event, actor)).toEqual({ ok: false, why: 'unknown-state' });
      }
    },
  };
}

// ---------- deliveryStageOf ----------

export function deliveryStageCases(m: Pick<OperatorModelDeciders, 'deliveryStageOf'>): Record<string, SuiteCase> {
  return {
    'every subset of the three stamps answers the furthest stage set': () => {
      for (let bits = 0; bits < 8; bits++) {
        const s = { queuedAt: bits & 1 ? 10 : null, deliveredAt: bits & 2 ? 20 : null, pickedUpAt: bits & 4 ? 30 : null };
        const want = bits & 4 ? 'picked-up' : bits & 2 ? 'delivered' : bits & 1 ? 'queued' : 'recorded';
        expect(m.deliveryStageOf(s), JSON.stringify(s)).toBe(want);
      }
    },
    'a stamp of zero is a stamp': () => {
      expect(m.deliveryStageOf({ queuedAt: 0, deliveredAt: null, pickedUpAt: null })).toBe('queued');
    },
  };
}

// ---------- capMessageText ----------

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const CAP = 16_384;

export function capTextCases(m: Pick<OperatorModelDeciders, 'capMessageText'>): Record<string, SuiteCase> {
  return {
    'under and at the cap: the text unchanged, not cut, hashed as stored': () => {
      for (const t of ['hello', 'x'.repeat(CAP - 1), 'x'.repeat(CAP)]) {
        expect(m.capMessageText(t)).toEqual({ text: t, cut: false, sha256: sha(t) });
      }
    },
    'one byte over: cut, with the mark naming the dropped bytes, inside the cap': () => {
      const t = 'x'.repeat(CAP + 1);
      const r = m.capMessageText(t);
      expect(r.cut).toBe(true);
      expect(bytes(r.text)).toBeLessThanOrEqual(CAP);
      const mark = r.text.match(/ \[cut: (\d+) more bytes\]$/);
      expect(mark).not.toBeNull();
      const kept = r.text.slice(0, r.text.length - mark![0].length);
      expect(kept).toBe('x'.repeat(kept.length));
      expect(Number(mark![1])).toBe(CAP + 1 - kept.length);
      expect(r.sha256).toBe(sha(r.text));
    },
    'a cut never splits a four-byte code point': () => {
      const t = '😀'.repeat(5000);   // 20 000 bytes
      const r = m.capMessageText(t);
      expect(r.cut).toBe(true);
      expect(bytes(r.text)).toBeLessThanOrEqual(CAP);
      const kept = r.text.replace(/ \[cut: \d+ more bytes\]$/, '');
      expect(kept).toBe('😀'.repeat(kept.length / 2));
      expect(r.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(Number(r.text.match(/(\d+) more bytes/)![1])).toBe(20_000 - bytes(kept));
    },
    'a cut keeps as much as fits: kept plus mark is within the mark\'s own width of the cap': () => {
      const r = m.capMessageText('é'.repeat(CAP));   // two bytes each
      const markBytes = bytes(r.text.match(/ \[cut: \d+ more bytes\]$/)![0]);
      expect(bytes(r.text)).toBeGreaterThan(CAP - markBytes - 2);
    },
  };
}

// ---------- nextMessageId ----------

export function nextIdCases(m: Pick<OperatorModelDeciders, 'nextMessageId'>): Record<string, SuiteCase> {
  return {
    'both absent: the first id is 1': () => { expect(m.nextMessageId(null, null)).toBe(1); },
    'the store alone, the journal alone': () => {
      expect(m.nextMessageId(7, null)).toBe(8);
      expect(m.nextMessageId(null, 9)).toBe(10);
    },
    'the larger of the two wins, either way round': () => {
      expect(m.nextMessageId(7, 9)).toBe(10);
      expect(m.nextMessageId(9, 7)).toBe(10);
      expect(m.nextMessageId(5, 5)).toBe(6);
    },
  };
}

// ---------- privacyCoherence ----------

export function privacyCoherenceCases(m: Pick<PrivacyJournalModule, 'privacyCoherence'>): Record<string, SuiteCase> {
  const read = (highestId: number | null) => ({ kind: 'read' as const, highestId });
  return {
    'equal highest ids: coherent': () => {
      expect(m.privacyCoherence(read(5), 5)).toEqual({ verdict: 'coherent', highestId: 5 });
    },
    'the journal one ahead (a crash between the append and the commit, or a store restored alone): coherent': () => {
      expect(m.privacyCoherence(read(6), 5)).toEqual({ verdict: 'coherent', highestId: 6 });
      expect(m.privacyCoherence(read(6), null)).toEqual({ verdict: 'coherent', highestId: 6 });
    },
    'the journal one behind: re-anchor behind, at the store\'s highest': () => {
      expect(m.privacyCoherence(read(4), 5)).toEqual({ verdict: 're-anchor', reason: 'behind', highestId: 5 });
    },
    'a journal that names no id beside rows: re-anchor behind': () => {
      expect(m.privacyCoherence(read(null), 5)).toEqual({ verdict: 're-anchor', reason: 'behind', highestId: 5 });
    },
    'an empty journal and no rows: coherent, nothing named': () => {
      expect(m.privacyCoherence(read(null), null)).toEqual({ verdict: 'coherent', highestId: null });
    },
    'absent with no rows: fresh; absent beside rows: re-anchor missing': () => {
      expect(m.privacyCoherence({ kind: 'absent' }, null)).toEqual({ verdict: 'fresh' });
      expect(m.privacyCoherence({ kind: 'absent' }, 3)).toEqual({ verdict: 're-anchor', reason: 'missing', highestId: 3 });
    },
    'refused: refuse, with its own code and detail, whatever the store holds': () => {
      for (const s of [null, 1, 9]) {
        expect(m.privacyCoherence({ kind: 'refused', code: 'digest-mismatch', detail: 'line 2' }, s))
          .toEqual({ verdict: 'refuse', code: 'digest-mismatch', detail: 'line 2' });
      }
    },
  };
}

// ---------- privacyJournalEntry ----------

export function privacyEntryCases(m: Pick<PrivacyJournalModule, 'privacyJournalEntry' | 'PrivacyJournalError'>): Record<string, SuiteCase> {
  const refused = (raw: unknown): string => {
    try { m.privacyJournalEntry(raw); return 'accepted'; } catch (err) {
      return err instanceof m.PrivacyJournalError ? err.code : `other: ${String(err)}`;
    }
  };
  return {
    'each kind is accepted with its exact keys, rebuilt': () => {
      expect(m.privacyJournalEntry({ at: 2, id: 1, kind: 'privacy-message-issued' })).toEqual({ kind: 'privacy-message-issued', id: 1, at: 2 });
      expect(m.privacyJournalEntry({ kind: 'privacy-anchor', highestId: 4, reason: 'missing', at: 0 }))
        .toEqual({ kind: 'privacy-anchor', highestId: 4, reason: 'missing', at: 0 });
    },
    'an extra key is unknown-key, a missing one bad-field': () => {
      expect(refused({ kind: 'privacy-message-issued', id: 1, at: 2, text: 'x' })).toBe('unknown-key');
      expect(refused({ kind: 'privacy-message-issued', id: 1 })).toBe('bad-field');
      expect(refused({ kind: 'privacy-anchor', highestId: 1, at: 2 })).toBe('bad-field');
    },
    'a non-positive or non-integer id is bad-field': () => {
      for (const id of [0, -1, 1.5, '1', null]) expect(refused({ kind: 'privacy-message-issued', id, at: 2 })).toBe('bad-field');
      for (const highestId of [0, -2]) expect(refused({ kind: 'privacy-anchor', highestId, reason: 'behind', at: 2 })).toBe('bad-field');
    },
    'a negative or non-integer time is bad-field': () => {
      for (const at of [-1, 0.5, '2']) expect(refused({ kind: 'privacy-message-issued', id: 1, at })).toBe('bad-field');
    },
    'an unknown kind or reason is bad-field': () => {
      expect(refused({ kind: 'lease-carrier-seen', id: 1, at: 2 })).toBe('bad-field');
      expect(refused({ kind: 'privacy-anchor', highestId: 1, reason: 'lost', at: 2 })).toBe('bad-field');
      expect(refused(['privacy-anchor'])).toBe('bad-field');
    },
  };
}

export const MESSAGE_MOVE_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: messageMoveCases,
  mutants: [
    { id: 'MM1 actor ignored', old: 'if (!MESSAGE_EVENT_ACTORS[event].includes(actor)) return', new: 'if (false) return' },
    { id: 'MM2 unsettle to recorded always', old: "const next = target === 'delivery-stage' ? deliveryStageOf(row) : target;", new: "const next = target === 'delivery-stage' ? 'recorded' : target;" },
    { id: 'MM3 unknown moves', old: "if (row.state === 'unknown') return { ok: false, why: 'unknown-state' };", new: "if (row.state === 'unknown') return { ok: false, why: 'move' };" },
    { id: 'MM4 no settledBy', old: "const settledBy = event === 'settle' ?", new: "const settledBy = event === 'spend' ?" },
    { id: 'MM5 unsettle keeps settlement', old: "clearSettlement: event === 'unsettle'", new: 'clearSettlement: false' },
  ],
};
export const DELIVERY_STAGE_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: deliveryStageCases,
  mutants: [
    { id: 'DS1 picked-up ignored', old: "if (s.pickedUpAt !== null) return 'picked-up';", new: '' },
    { id: 'DS2 delivered read before picked-up', old: "if (s.pickedUpAt !== null) return 'picked-up';\n  if (s.deliveredAt !== null) return 'delivered';", new: "if (s.deliveredAt !== null) return 'delivered';\n  if (s.pickedUpAt !== null) return 'picked-up';" },
    { id: 'DS3 truthy stamp', old: "if (s.queuedAt !== null) return 'queued';", new: "if (s.queuedAt) return 'queued';" },
  ],
};
export const CAP_TEXT_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: capTextCases,
  mutants: [
    { id: 'CT1 cut by characters', old: 'const b = utf8Bytes(ch);', new: 'const b = ch.length;' },
    { id: 'CT2 at the cap is cut', old: 'if (total <= maxBytes) return', new: 'if (total < maxBytes) return' },
    { id: 'CT3 mark outside the cap', old: 'const budget = maxBytes - utf8Bytes(cutMark(total));', new: 'const budget = maxBytes;' },
    { id: 'CT4 hash of the input', old: 'return { text: stored, cut: true, sha256: sha256Of(stored) };', new: 'return { text: stored, cut: true, sha256: sha256Of(text) };' },
  ],
};
export const NEXT_ID_SET: MutantSet<OperatorModelDeciders> = {
  modulePath: MESSAGES_TS,
  suite: nextIdCases,
  mutants: [
    { id: 'NI1 journal ignored', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1', new: '(storeHighest ?? 0) + 1' },
    { id: 'NI2 store ignored', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1', new: '(journalHighest ?? 0) + 1' },
    { id: 'NI3 min', old: 'Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1', new: 'Math.min(storeHighest ?? 0, journalHighest ?? 0) + 1' },
  ],
};

export const COHERENCE_SET: MutantSet<PrivacyJournalModule> = {
  modulePath: PRIVACY_TS,
  suite: privacyCoherenceCases,
  mutants: [
    { id: 'PC1 behind is coherent', old: 'journal.highestId < storeHighestId', new: 'journal.highestId < storeHighestId - 1' },
    { id: 'PC2 empty beside rows is coherent', old: '(journal.highestId === null || journal.highestId < storeHighestId)', new: '(journal.highestId !== null && journal.highestId < storeHighestId)' },
    { id: 'PC3 absent beside rows is fresh', old: "return storeHighestId === null ? { verdict: 'fresh' } :", new: "return true ? { verdict: 'fresh' } :" },
    { id: 'PC4 refused folded into absent', old: "if (journal.kind === 'refused') return { verdict: 'refuse', code: journal.code, detail: journal.detail };", new: "if (journal.kind === 'refused') return { verdict: 'fresh' };" },
    { id: 'PC5 equal is behind', old: 'journal.highestId < storeHighestId)', new: 'journal.highestId <= storeHighestId)' },
  ],
};
export const PRIVACY_ENTRY_SET: MutantSet<PrivacyJournalModule> = {
  modulePath: PRIVACY_TS,
  suite: privacyEntryCases,
  mutants: [
    { id: 'PE1 zero id', old: 'Number.isSafeInteger(v) && v >= 1 ?', new: 'Number.isSafeInteger(v) && v >= 0 ?' },
    { id: 'PE2 extra keys', old: "chainedExactKeys(PRIVACY_JOURNAL_FORMAT, raw, ENTRY_KEYS[kind], `a ${kind} entry`);", new: '' },
    { id: 'PE3 any reason', old: "if (reason !== 'missing' && reason !== 'behind') return", new: 'if (false) return' },
    { id: 'PE4 negative time', old: 'Number.isSafeInteger(v) && v >= 0 ?', new: 'Number.isSafeInteger(v) ?' },
  ],
};

export const OPERATOR_MODEL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [MESSAGE_MOVE_KEY]: MESSAGE_MOVE_SET as MutantSet<never>,
  [DELIVERY_STAGE_KEY]: DELIVERY_STAGE_SET as MutantSet<never>,
  [CAP_TEXT_KEY]: CAP_TEXT_SET as MutantSet<never>,
  [NEXT_ID_KEY]: NEXT_ID_SET as MutantSet<never>,
  [COHERENCE_KEY]: COHERENCE_SET as MutantSet<never>,
  [PRIVACY_ENTRY_KEY]: PRIVACY_ENTRY_SET as MutantSet<never>,
};
