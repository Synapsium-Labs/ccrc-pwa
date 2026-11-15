// The push outbox deciders' oracles and mutant sets (Overlord W1, the push outbox, Task 2:
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md). Their cases are written ONCE here, as suite cases over
// the module: `push-outbox-decide.test.ts` runs them against the real module, and `mutation-floors.test.ts` runs them
// against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { PushSendVerdict } from '../../../shared/push-outbox.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/pushOutbox.ts');

export type PushOutboxModule = typeof import('../../src/pushOutbox.js');
type Facts = Parameters<PushOutboxModule['pushDue']>[0];

// Literal on purpose, never read back from shared/push-outbox.ts: a value change is a behaviour change.
const BASE = 30_000;
const HORIZON = 600_000;
const ARMED = 1_000_000;

/** Today's payloads, as Task 1's characterization pins them (`push-outbox-characterization.test.ts`). */
export function noticeTitleCases(m: PushOutboxModule): Record<string, SuiteCase> {
  return {
    'one active project: the title as it is': () => {
      expect(m.noticeTitle('❓ Question', 'project-a', new Set(['project-a']))).toBe('❓ Question');
    },
    'two active projects: " · <project>" appended': () => {
      expect(m.noticeTitle('❓ Question', 'project-a', new Set(['project-a', 'project-b']))).toBe('❓ Question · project-a');
    },
    'no active project: no suffix': () => {
      expect(m.noticeTitle('✓ Finished', 'project-a', new Set())).toBe('✓ Finished');
    },
    'an empty project never gets a dangling " · "': () => {
      expect(m.noticeTitle('✉ Mail', '', new Set(['project-a', 'project-b']))).toBe('✉ Mail');
    },
  };
}

export function noticePayloadCases(m: PushOutboxModule): Record<string, SuiteCase> {
  const e = { kind: 'ask', sessionId: 'lane-a-project-a', title: '❓ Question', body: 'Proceed?' };
  return {
    'the default tag is `${kind}-${sessionId}`, with no url and no actions': () => {
      expect(JSON.stringify(m.noticePayload(e, {}))).toBe(JSON.stringify(
        { title: '❓ Question', body: 'Proceed?', sessionId: 'lane-a-project-a', tag: 'ask-lane-a-project-a' }));
    },
    "a caller's tag replaces the default": () => {
      expect(m.noticePayload({ ...e, kind: 'coord' }, { tag: 'item-7' }).tag).toBe('item-7');
    },
    'actions and url ride after the tag, in that order, byte for byte': () => {
      const actions = [{ action: 'a0', title: 'Yes' }, { action: 'a1', title: 'No' }];
      expect(JSON.stringify(m.noticePayload(e, { tag: 't', actions, url: '/waiting' }))).toBe(JSON.stringify({
        title: '❓ Question', body: 'Proceed?', sessionId: 'lane-a-project-a', tag: 't', actions, url: '/waiting' }));
    },
    'an empty url is still a url (only an absent one is left out)': () => {
      expect(m.noticePayload(e, { url: '' })).toHaveProperty('url', '');
    },
    'an absent url and absent actions leave no key': () => {
      const p = m.noticePayload(e, { tag: 't' });
      expect(Object.keys(p)).toEqual(['title', 'body', 'sessionId', 'tag']);
    },
    'an empty session id gives the bare default tag': () => {
      expect(m.noticePayload({ ...e, kind: 'coord', sessionId: '' }, {}).tag).toBe('coord-');
    },
    'an already suffixed title is left as it is: noticePayload never suffixes': () => {
      const suffixed = m.noticeTitle('❓ Question', 'project-a', new Set(['project-a', 'project-b']));
      expect(m.noticePayload({ ...e, title: suffixed }, {}).title).toBe('❓ Question · project-a');
    },
  };
}

const sub = (verdict: string, status: number | null = null, endpointHash = 'ab'): unknown => ({ endpointHash, verdict, status });

export function asSendVerdictCases(m: PushOutboxModule): Record<string, SuiteCase> {
  return {
    'a no-subscription verdict reads as itself': () => {
      expect(m.asSendVerdict({ kind: 'no-subscription' })).toEqual({ kind: 'no-subscription' });
    },
    'a sent verdict reads as itself': () => {
      const v = { kind: 'sent', subs: [sub('accepted', 201), sub('refused', 429, 'cd'), sub('no-answer')] };
      expect(m.asSendVerdict(v)).toEqual(v);
    },
    'undefined (a double that answers void) reads null': () => {
      expect(m.asSendVerdict(undefined)).toBeNull();
    },
    'null, a string and an array read null': () => {
      for (const x of [null, 'sent', [], 0]) expect(m.asSendVerdict(x), String(x)).toBeNull();
    },
    'a malformed object reads null': () => {
      for (const x of [
        { kind: 'other' }, { kind: 'other', subs: [] }, { kind: 'sent' }, { kind: 'sent', subs: 'x' }, { kind: 'sent', subs: [null] },
        { kind: 'sent', subs: [sub('maybe')] }, { kind: 'sent', subs: [{ verdict: 'accepted', status: 201 }] },
        { kind: 'sent', subs: [sub('accepted', '201' as unknown as number)] },
        { kind: 'sent', subs: [{ endpointHash: 'ab', verdict: 'accepted' }] },
      ]) expect(m.asSendVerdict(x), JSON.stringify(x)).toBeNull();
    },
  };
}

/** The oracle: the plan's seven rules, first match, written as a list of [when, answer]. */
const RULES: readonly [(f: Facts) => boolean, string][] = [
  [(f) => !f.service, 'silent:no-service'],
  [(f) => !f.payload, 'silent:no-payload'],
  [(f) => f.settled, 'silent:settled'],
  [(f) => f.source === 'item' && !f.blocking, 'silent:level'],
  [(f) => f.event === 'held', 'silent:older-build'],
  [(f) => f.viewing && f.event !== 'claim', 'silent:viewing'],
  [() => true, 'now'],
];
const expected = (f: Facts): string => RULES.find(([when]) => when(f))![1];
const word = (d: ReturnType<PushOutboxModule['pushDue']>): string => (d.due === 'now' ? 'now' : `silent:${d.why}`);
const B = [false, true] as const;
function* everyFact(): Generator<Facts> {
  for (const event of ['reach', 'arm', 'claim', 'held'] as const) for (const source of ['ask', 'item', 'none'] as const)
    for (const service of B) for (const blocking of B) for (const viewing of B) for (const settled of B) for (const payload of B)
      yield { event, source, service, blocking, viewing, settled, payload };
}
const DUE: Facts = { event: 'reach', service: true, source: 'item', blocking: true, viewing: false, settled: false, payload: true };

export function pushDueCases(m: PushOutboxModule): Record<string, SuiteCase> {
  return {
    'total: every one of the 384 fact combinations answers its rule': () => {
      let n = 0;
      for (const f of everyFact()) { n++; expect(word(m.pushDue(f)), JSON.stringify(f)).toBe(expected(f)); }
      expect(n).toBe(384);
    },
    'a blocking item reaching the operator pushes now': () => { expect(m.pushDue(DUE)).toEqual({ due: 'now' }); },
    'no push service is silent no-service, even for a due item': () => {
      expect(m.pushDue({ ...DUE, service: false })).toEqual({ due: 'silent', why: 'no-service' });
    },
    'a non-blocking item is silent level': () => {
      expect(m.pushDue({ ...DUE, blocking: false })).toEqual({ due: 'silent', why: 'level' });
    },
    'an ask ignores the level': () => {
      expect(m.pushDue({ ...DUE, source: 'ask', blocking: false })).toEqual({ due: 'now' });
    },
    'the held drain never pushes': () => {
      expect(m.pushDue({ ...DUE, event: 'held' })).toEqual({ due: 'silent', why: 'older-build' });
    },
    'presence is not asked again on a claim': () => {
      expect(m.pushDue({ ...DUE, event: 'claim', viewing: true })).toEqual({ due: 'now' });
      expect(m.pushDue({ ...DUE, event: 'reach', viewing: true })).toEqual({ due: 'silent', why: 'viewing' });
      expect(m.pushDue({ ...DUE, event: 'arm', viewing: true })).toEqual({ due: 'silent', why: 'viewing' });
    },
    'a settled source is silent settled, before the level': () => {
      expect(m.pushDue({ ...DUE, settled: true, blocking: false })).toEqual({ due: 'silent', why: 'settled' });
    },
    'no payload is silent no-payload, before settled': () => {
      expect(m.pushDue({ ...DUE, payload: false, settled: true })).toEqual({ due: 'silent', why: 'no-payload' });
    },
  };
}

const sent = (...verdicts: string[]): PushSendVerdict =>
  ({ kind: 'sent', subs: verdicts.map((v) => ({ endpointHash: 'ab', verdict: v, status: null })) }) as PushSendVerdict;
const ROW = { attempts: 1, armedAt: ARMED };

export function outboxNextStateCases(m: PushOutboxModule): Record<string, SuiteCase> {
  const at = ARMED + 1_000;
  return {
    'no subscription is unsent': () => { expect(m.outboxNextState({ kind: 'no-subscription' }, ROW, at)).toEqual({ to: 'unsent' }); },
    'one accepted is sent': () => { expect(m.outboxNextState(sent('accepted'), ROW, at)).toEqual({ to: 'sent' }); },
    'accepted beside refused, gone and no-answer is sent': () => {
      expect(m.outboxNextState(sent('refused', 'accepted', 'gone', 'no-answer'), ROW, at)).toEqual({ to: 'sent' });
    },
    'a null verdict (deadline or rejection) is unknown': () => { expect(m.outboxNextState(null, ROW, at)).toEqual({ to: 'unknown' }); },
    'no-answer is unknown, never retried (never twice)': () => {
      expect(m.outboxNextState(sent('no-answer'), ROW, at)).toEqual({ to: 'unknown' });
      expect(m.outboxNextState(sent('refused', 'no-answer'), ROW, at)).toEqual({ to: 'unknown' });
    },
    'every subscription gone is unsent': () => {
      expect(m.outboxNextState(sent('gone', 'gone'), ROW, at)).toEqual({ to: 'unsent' });
    },
    'refused is retrying at the backoff': () => {
      expect(m.outboxNextState(sent('refused'), ROW, at)).toEqual({ to: 'retrying', nextAttemptAt: at + BASE });
      expect(m.outboxNextState(sent('gone', 'refused'), { attempts: 2, armedAt: ARMED }, at))
        .toEqual({ to: 'retrying', nextAttemptAt: at + 2 * BASE });
    },
    'refused-for-good beside refused is retrying (some refusal can pass)': () => {
      expect(m.outboxNextState(sent('refused-for-good', 'refused'), ROW, at)).toEqual({ to: 'retrying', nextAttemptAt: at + BASE });
    },
    'unsendable (refused on this box, F10) is failed alone and beside gone, retrying beside refused, unknown beside no-answer': () => {
      expect(m.outboxNextState(sent('unsendable'), ROW, at)).toEqual({ to: 'failed' });
      expect(m.outboxNextState(sent('gone', 'unsendable'), ROW, at)).toEqual({ to: 'failed' });
      expect(m.outboxNextState(sent('unsendable', 'refused'), ROW, at)).toEqual({ to: 'retrying', nextAttemptAt: at + BASE });
      expect(m.outboxNextState(sent('unsendable', 'no-answer'), ROW, at)).toEqual({ to: 'unknown' });
    },
    'refused-for-good alone, or beside gone, is failed': () => {
      expect(m.outboxNextState(sent('refused-for-good'), ROW, at)).toEqual({ to: 'failed' });
      expect(m.outboxNextState(sent('gone', 'refused-for-good'), ROW, at)).toEqual({ to: 'failed' });
    },
    'a retry just inside the horizon is retrying; just past it is failed': () => {
      const inside = ARMED + HORIZON - BASE;
      expect(m.outboxNextState(sent('refused'), ROW, inside)).toEqual({ to: 'retrying', nextAttemptAt: ARMED + HORIZON });
      expect(m.outboxNextState(sent('refused'), ROW, inside + 1)).toEqual({ to: 'failed' });
    },
  };
}

export function outboxRetryAtCases(m: PushOutboxModule): Record<string, SuiteCase> {
  return {
    'attempts 1 to 6 double from 30 s': () => {
      const got = [1, 2, 3, 4, 5, 6].map((a) => m.outboxRetryAt(a, ARMED, ARMED));
      expect(got).toEqual([ARMED + 30_000, ARMED + 60_000, ARMED + 120_000, ARMED + 240_000, ARMED + 480_000, null]);
    },
    'the delay counts from now, not from armedAt': () => {
      expect(m.outboxRetryAt(1, ARMED, ARMED + 5_000)).toBe(ARMED + 35_000);
    },
    'a retry landing exactly on the horizon is kept; one millisecond past is null': () => {
      expect(m.outboxRetryAt(1, ARMED, ARMED + HORIZON - BASE)).toBe(ARMED + HORIZON);
      expect(m.outboxRetryAt(1, ARMED, ARMED + HORIZON - BASE + 1)).toBeNull();
    },
    'attempts 0 (no claim yet) waits the base delay': () => {
      expect(m.outboxRetryAt(0, ARMED, ARMED)).toBe(ARMED + BASE);
    },
  };
}

export function outboxBootVerdictCases(m: PushOutboxModule): Record<string, SuiteCase> {
  return {
    'a sending row is sealed unknown, inside or past the horizon': () => {
      expect(m.outboxBootVerdict({ state: 'sending', armedAt: ARMED }, ARMED + 1)).toBe('seal-unknown');
      expect(m.outboxBootVerdict({ state: 'sending', armedAt: ARMED }, ARMED + HORIZON + 1)).toBe('seal-unknown');
    },
    'a fresh pending or retrying row is sent': () => {
      for (const state of ['pending', 'retrying'] as const) {
        expect(m.outboxBootVerdict({ state, armedAt: ARMED }, ARMED + 1), state).toBe('send');
        expect(m.outboxBootVerdict({ state, armedAt: ARMED }, ARMED + HORIZON), state).toBe('send');
      }
    },
    'a pending or retrying row past the horizon fails stale': () => {
      for (const state of ['pending', 'retrying'] as const)
        expect(m.outboxBootVerdict({ state, armedAt: ARMED }, ARMED + HORIZON + 1), state).toBe('fail-stale');
    },
  };
}

const set = (mutants: MutantSet<PushOutboxModule>['mutants'], suite: (m: PushOutboxModule) => Record<string, SuiteCase>):
  MutantSet<never> => ({ modulePath: MODULE, mutants, suite } as MutantSet<PushOutboxModule> as MutantSet<never>);

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const PUSH_OUTBOX_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/pushOutbox.ts#noticeTitle': set([
    { id: 'T1 one project suffixes', old: 'activeProjects.size > 1', new: 'activeProjects.size > 0' },
    { id: 'T2 empty project suffixes', old: " && project !== ''", new: '' },
    { id: 'T3 another separator', old: '`${title} · ${project}`', new: '`${title} - ${project}`' },
  ], noticeTitleCases),
  'server/src/pushOutbox.ts#noticePayload': set([
    { id: 'P1 default tag swapped', old: '`${e.kind}-${e.sessionId}`', new: '`${e.sessionId}-${e.kind}`' },
    { id: "P2 caller's tag ignored", old: 'tag: opts.tag ?? ', new: 'tag: ' },
    { id: 'P3 actions dropped', old: '...(opts.actions ? { actions: opts.actions } : {}),', new: '' },
    { id: 'P4 empty url dropped', old: 'opts.url !== undefined ?', new: 'opts.url ?' },
    { id: 'P5 the payload suffixes', old: 'title: e.title, body', new: 'title: `${e.title} · project-a`, body' },
    { id: 'P6 url before actions', old: "...(opts.actions ? { actions: opts.actions } : {}),\n    ...(opts.url !== undefined ? { url: opts.url } : {}),",
      new: "...(opts.url !== undefined ? { url: opts.url } : {}),\n    ...(opts.actions ? { actions: opts.actions } : {})," },
  ], noticePayloadCases),
  'server/src/pushOutbox.ts#asSendVerdict': set([
    { id: 'A1 no-subscription refused', old: "if (x.kind === 'no-subscription') return { kind: 'no-subscription' };", new: '' },
    { id: 'A2 any verdict word', old: ' || !SUB_VERDICTS.has(s.verdict)', new: '' },
    { id: 'A3 any status', old: "if (s.status !== null && typeof s.status !== 'number') return null;", new: '' },
    { id: 'A4 no endpoint hash', old: "typeof s.endpointHash !== 'string' || ", new: '' },
    { id: 'A5 any kind', old: "if (x.kind !== 'sent' || ", new: 'if (' },
  ], asSendVerdictCases),
  'server/src/pushOutbox.ts#pushDue': set([
    { id: 'D1 a non-blocking item pushes', old: "if (f.source === 'item' && !f.blocking) return silent('level');", new: '' },
    { id: 'D2 presence asked on a claim', old: 'claim: { heldDrain: false, asksPresence: false }', new: 'claim: { heldDrain: false, asksPresence: true }' },
    { id: 'D3 the held drain pushes', old: 'held: { heldDrain: true, asksPresence: true }', new: 'held: { heldDrain: false, asksPresence: true }' },
    { id: 'D8 the held drain check dropped', old: "if (ev.heldDrain) return silent('older-build');", new: '' },
    { id: 'D9 presence never asked', old: 'if (f.viewing && ev.asksPresence)', new: 'if (false)' },
    { id: 'D4 no no-service rule', old: "if (!f.service) return silent('no-service');", new: '' },
    { id: 'D5 no no-payload rule', old: "if (!f.payload) return silent('no-payload');", new: '' },
    { id: 'D6 no settled rule', old: "if (f.settled) return silent('settled');", new: '' },
    { id: 'D7 the level asks every source', old: "f.source === 'item' && !f.blocking", new: '!f.blocking' },
  ], pushDueCases),
  'server/src/pushOutbox.ts#outboxNextState': set([
    { id: 'N1 no-answer retried', old: "if (has('no-answer')) return { to: 'unknown' };", new: "if (has('no-answer')) return { to: 'retrying', nextAttemptAt: now };" },
    { id: 'N2 all gone retried', old: "s.verdict === 'gone')) return { to: 'unsent' };", new: "s.verdict === 'gone')) return { to: 'retrying', nextAttemptAt: now };" },
    { id: 'N3 null fails', old: "if (v === null) return { to: 'unknown' };", new: "if (v === null) return { to: 'failed' };" },
    { id: 'N4 no subscription sent', old: "if (v.kind === 'no-subscription') return { to: 'unsent' };", new: "if (v.kind === 'no-subscription') return { to: 'sent' };" },
    { id: 'N5 accepted ignored', old: "if (has('accepted')) return { to: 'sent' };", new: '' },
    { id: 'N6 past the horizon unknown', old: "at === null ? { to: 'failed' }", new: "at === null ? { to: 'unknown' }" },
    { id: 'N7 a permanent refusal unsent', old: "  return { to: 'failed' };\n}", new: "  return { to: 'unsent' };\n}" },
    { id: 'N8 a permanent refusal wins', old: "if (has('refused')) {", new: "if (has('refused') && !has('refused-for-good')) {" },
  ], outboxNextStateCases),
  'server/src/pushOutbox.ts#outboxRetryAt': set([
    { id: 'R1 doubled once too often', old: '2 ** Math.max(0, attempts - 1)', new: '2 ** Math.max(0, attempts)' },
    { id: 'R2 the horizon exclusive', old: 'at > armedAt + OUTBOX_RETRY_HORIZON_MS', new: 'at >= armedAt + OUTBOX_RETRY_HORIZON_MS' },
    { id: 'R3 no horizon', old: '? null : at', new: '? at : at' },
    { id: 'R4 counted from armedAt', old: 'const at = now + ', new: 'const at = armedAt + ' },
  ], outboxRetryAtCases),
  'server/src/pushOutbox.ts#outboxBootVerdict': set([
    { id: 'B1 a claimed row sent again', old: "if (row.state === 'sending') return 'seal-unknown';", new: "if (row.state === 'sending') return 'send';" },
    { id: 'B2 no horizon', old: "now > row.armedAt + OUTBOX_RETRY_HORIZON_MS ? 'fail-stale' : 'send'", new: "'send'" },
    { id: 'B3 the horizon inclusive', old: 'now > row.armedAt + ', new: 'now >= row.armedAt + ' },
  ], outboxBootVerdictCases),
};
