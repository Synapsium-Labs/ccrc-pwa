// The act row's deciders' cases (Overlord W2, act rows A, Tasks A2 and A3). Written ONCE here, as suite cases over a module:
// `overlord-acts.test.ts` runs them against the real module, and `sim/overlordActsSets.ts` runs them against each textual mutant
// (the every-run floors of D-8217). The expectations are spelled out here, independently of the module's own lists.
import { expect } from 'vitest';
import type { ActAnswer } from '../../shared/overlordActs.js';
import type { SuiteCase } from './sim/mutate.js';

export type ActsModule = typeof import('../src/coord/overlordActs.js');
type M = ActsModule;
type Facts = Parameters<M['actWriteVerdict']>[0];

const holder = (id: number): ActAnswer => ({ id, kind: 'relay', state: 'done', outcome: null, naturalKey: 'k', targets: [], requestId: null });
const PASS = { pass: true } as const;
const facts = (m: M, over: Partial<Facts> = {}): Facts => ({
  inTransaction: true, state: 'done', natural: m.actNaturalKey('relay', { kind: 'request', id: 7, revision: 2 }), fault: null,
  opKeyHolder: null, naturalKeyHolder: null, ceiling: PASS, ...over,
});
const errorOf = (v: ReturnType<M['actWriteVerdict']>): string => (v.ok ? 'ok' : v.error);

export function actNaturalKeyCases(m: M): Record<string, SuiteCase> {
  const key = (act: string, kind: 'message' | 'delivery' | 'request' | 'note', id: number, revision: number) => m.actNaturalKey(act, { kind, id, revision })?.key;
  return {
    'the act kind, the target kind, its id and its revision each change the key': () => {
      const base = key('relay', 'request', 7, 2);
      expect(base).toBe('["relay","request",7,2]');
      expect(key('escalate-request', 'request', 7, 2)).not.toBe(base);
      expect(key('relay', 'message', 7, 2)).not.toBe(base);
      expect(key('relay', 'request', 8, 2)).not.toBe(base);
      expect(key('relay', 'request', 7, 3)).not.toBe(base);
    },
    'the three parts are kept beside the text': () => {
      expect(m.actNaturalKey('acknowledge', { kind: 'delivery', id: 41, revision: 0 }))
        .toEqual({ key: '["acknowledge","delivery",41,0]', kind: 'delivery', id: 41, revision: 0 });
    },
    'a start is keyed by its request alone, so two starts on one request share it': () => {
      const a = m.actNaturalKey('start-programme', { kind: 'start', requestId: 12 });
      expect(a).toEqual({ key: '["start",12]', kind: 'start', id: 12, revision: 0 });
      expect(m.actNaturalKey('rekick-coordinator', { kind: 'start', requestId: 12 })?.key).toBe(a?.key);
      expect(m.actNaturalKey('start-programme', { kind: 'start', requestId: 13 })?.key).not.toBe(a?.key);
      expect(key('start-programme', 'request', 12, 0)).not.toBe(a?.key);
    },
    'the text is canonical: the order of the target\'s keys cannot change it': () => {
      const a = m.actNaturalKey('relay', { kind: 'request', id: 7, revision: 2 });
      const b = m.actNaturalKey('relay', JSON.parse('{"revision":2,"id":7,"kind":"request"}'));
      expect(b?.key).toBe(a?.key);
    },
    'a target with no key answers null: a bad id, a bad revision, a kind no list has': () => {
      expect(key('relay', 'request', -1, 0)).toBeUndefined();
      expect(key('relay', 'request', 1.5, 0)).toBeUndefined();
      expect(key('relay', 'request', 7, -1)).toBeUndefined();
      expect(key('relay', 'request', 7, Number.NaN)).toBeUndefined();
      expect(m.actNaturalKey('relay', JSON.parse('{"kind":"programme","id":1,"revision":0}'))).toBeNull();
      expect(m.actNaturalKey('start-programme', { kind: 'start', requestId: -3 })).toBeNull();
      expect(key('acknowledge', 'message', 0, 0)).toBe('["acknowledge","message",0,0]');
    },
  };
}

export function nextActIdCases(m: M): Record<string, SuiteCase> {
  return {
    'one past the larger of the store\'s highest and the journal\'s': () => {
      expect(m.nextActId(null, null)).toBe(1);
      expect(m.nextActId(4, null)).toBe(5);
      expect(m.nextActId(null, 9)).toBe(10);
      expect(m.nextActId(4, 9)).toBe(10);
      expect(m.nextActId(12, 9)).toBe(13);
      expect(m.nextActId(3, 3)).toBe(4);
    },
  };
}

export function actWriteVerdictCases(m: M): Record<string, SuiteCase> {
  return {
    'outside a transaction: not-in-transaction, whatever else is wrong': () => {
      expect(errorOf(m.actWriteVerdict(facts(m, { inTransaction: false, state: 'x', natural: null, fault: 'f', opKeyHolder: holder(1) })))).toBe('not-in-transaction');
    },
    'the door enters pending and done only': () => {
      for (const s of ['pending', 'done']) expect(m.actWriteVerdict(facts(m, { state: s })), s).toEqual({ ok: true });
      for (const s of ['refused', 'unknown', 'staged', 'shadow', 'effective', 'settled', '']) {
        expect(m.actWriteVerdict(facts(m, { state: s })), s).toEqual({ ok: false, error: 'bad-row', detail: `state ${s}` });
      }
    },
    'a target with no key, then a field out of shape, is bad-row, before any key is read': () => {
      expect(m.actWriteVerdict(facts(m, { natural: null, fault: 'op.key', opKeyHolder: holder(1) }))).toEqual({ ok: false, error: 'bad-row', detail: 'target' });
      expect(m.actWriteVerdict(facts(m, { fault: 'op.key', opKeyHolder: holder(1) }))).toEqual({ ok: false, error: 'bad-row', detail: 'op.key' });
    },
    'the operation key is read before the natural key: its holder is the replay': () => {
      expect(m.actWriteVerdict(facts(m, { opKeyHolder: holder(3), naturalKeyHolder: holder(4) })))
        .toEqual({ ok: false, error: 'op-key-taken', detail: 'act 3', holder: holder(3) });
      expect(m.actWriteVerdict(facts(m, { opKeyHolder: { unmeasured: 'disk' }, naturalKeyHolder: holder(4) })))
        .toEqual({ ok: false, error: 'unmeasured', detail: 'operation key: disk' });
    },
    'the natural key\'s holder refuses natural-key-taken, and an unread key is unmeasured': () => {
      expect(m.actWriteVerdict(facts(m, { naturalKeyHolder: holder(4) }))).toEqual({ ok: false, error: 'natural-key-taken', detail: 'act 4', holder: holder(4) });
      expect(m.actWriteVerdict(facts(m, { naturalKeyHolder: { unmeasured: 'locked' } }))).toEqual({ ok: false, error: 'unmeasured', detail: 'natural key: locked' });
    },
    'the keys are read before the ceilings': () => {
      const over = { pass: false, word: 'act-ceiling', group: 'relay', scope: 'all', limit: 30, latch: 'act-ceiling-hit' } as const;
      expect(errorOf(m.actWriteVerdict(facts(m, { naturalKeyHolder: holder(4), ceiling: over })))).toBe('natural-key-taken');
      expect(errorOf(m.actWriteVerdict(facts(m, { opKeyHolder: holder(4), ceiling: over })))).toBe('op-key-taken');
    },
    'a ceiling refusal is act-ceiling naming its group, and an unavailable count is unmeasured, never a pass': () => {
      expect(m.actWriteVerdict(facts(m, { ceiling: { pass: false, word: 'act-ceiling', group: 'o3-effect', scope: 'programme', limit: 1, latch: 'act-ceiling-hit' } })))
        .toEqual({ ok: false, error: 'act-ceiling', detail: 'o3-effect programme 1', group: 'o3-effect' });
      expect(m.actWriteVerdict(facts(m, { ceiling: { pass: false, word: 'unavailable', group: 'relay', why: 'not-wired', latch: null } })))
        .toEqual({ ok: false, error: 'unmeasured', detail: 'count relay: not-wired' });
    },
    'every fact clear: a pass': () => {
      expect(m.actWriteVerdict(facts(m))).toEqual({ ok: true });
    },
  };
}

export function actSettleVerdictCases(m: M): Record<string, SuiteCase> {
  const v = (stored: string, to: string, by: 'door' | 'lane' | 'boot', inTransaction = true) => m.actSettleVerdict({ inTransaction, stored, to, by });
  return {
    'outside a transaction: not-in-transaction; no row: not-found': () => {
      expect(v('pending', 'done', 'door', false)).toEqual({ ok: false, error: 'not-in-transaction', detail: 'an act is settled only inside the transaction that holds its row' });
      expect(m.actSettleVerdict({ inTransaction: true, stored: 'absent', to: 'done', by: 'lane' })).toEqual({ ok: false, error: 'not-found', detail: 'no row' });
    },
    'pending settles to done, refused and unknown by the door, the lane and the boot pass, from pending': () => {
      for (const by of ['door', 'lane', 'boot'] as const) for (const to of ['done', 'refused', 'unknown']) {
        expect(v('pending', to, by), `${to} by ${by}`).toEqual({ ok: true, from: 'pending' });
      }
    },
    'unknown leaves by a measurement only: the lane and the boot pass, never the door': () => {
      for (const to of ['done', 'refused']) {
        expect(v('unknown', to, 'lane')).toEqual({ ok: true, from: 'unknown' });
        expect(v('unknown', to, 'boot')).toEqual({ ok: true, from: 'unknown' });
        expect(v('unknown', to, 'door')).toEqual({ ok: false, error: 'bad-row', detail: `unknown -> ${to} by door` });
      }
      expect(v('unknown', 'unknown', 'lane').ok).toBe(false);
    },
    'a terminal row, a stored word this build lacks and a target state outside the table move nowhere': () => {
      for (const [s, t] of [['done', 'refused'], ['refused', 'done'], ['shadow', 'done'], ['settled', 'done'], ['pending', 'shadow'],
        ['pending', 'staged'], ['pending', 'pending'], ['staged', 'done']]) {
        expect(v(s!, t!, 'lane'), `${s} -> ${t}`).toEqual({ ok: false, error: 'bad-row', detail: `${s} -> ${t} by lane` });
      }
    },
  };
}

export function writeCountGroupsCases(m: M): Record<string, SuiteCase> {
  return {
    'a group counts every catalogue kind counted in it': () => {
      expect([...m.groupKinds('relay')].sort()).toEqual(['nudge-owner', 'relay']);
      expect([...m.groupKinds('o3-effect')].sort()).toEqual(['approve-dod', 'approve-spec', 'widen-scope']);
      expect([...m.groupKinds('own-record')].sort()).toEqual(['model-write', 'open-request', 'seal-prediction']);
    },
    'the write reads the act\'s group and, for a counted effect, the effect\'s': () => {
      expect(m.writeCountGroups('relay', 'widen-scope')).toEqual({ act: 'relay', effect: 'o3-effect' });
      expect(m.writeCountGroups('relay', null)).toEqual({ act: 'relay', effect: null });
      expect(m.writeCountGroups('acknowledge', 'relay')).toEqual({ act: null, effect: 'relay' });
      expect(m.writeCountGroups('answer-item', 'acknowledge')).toEqual({ act: 'answer', effect: null });
      expect(m.writeCountGroups('read', 'a-kind-this-build-lacks')).toEqual({ act: null, effect: null });
    },
  };
}
