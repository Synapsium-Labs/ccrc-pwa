// The Overlord's reply deciders: their oracle cases and mutant sets (Overlord W1 chat, PR B; plan `w1-chat.md` Task 5 Step 5).
// The cases are written ONCE here, over a loaded module: `operator-model-replies.test.ts` runs them against the real modules, and
// `mutation-floors.test.ts` against each textual mutant. `replyLinks` (L0) says what a reply answers and whether it is off the
// record; `replyTargetVerdict` (L1) says which session records a reply.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type ReplyLinksModule = Pick<typeof import('../../../shared/operatorMessages.js'), 'replyLinks'>;
export type ReplyTargetModule = typeof import('../../src/operatorModel/replies.js');

export function replyLinksCases(m: ReplyLinksModule): Record<string, SuiteCase> {
  const on = (id: number) => ({ id, verdict: 'on' as const });
  const off = (id: number) => ({ id, verdict: 'off' as const });
  const unverified = (id: number) => ({ id, verdict: 'unverified' as const });
  const w = (id: number, offRecord = false) => ({ id, offRecord });
  return {
    'a turn that answers no message (no id named, an empty window) is on the record with no link': () => {
      expect(m.replyLinks([], [], false)).toEqual({ inReplyTo: null, offRecord: false });
    },
    'inReplyTo is the newest verified named id, whatever the order, and beats the window': () => {
      expect(m.replyLinks([on(9), on(4), on(12)], [w(30)], false)).toEqual({ inReplyTo: 12, offRecord: false });
    },
    'with no verified named id the window\'s newest links, whatever the order': () => {
      expect(m.replyLinks([], [w(9), w(4), w(12)], false)).toEqual({ inReplyTo: 12, offRecord: false });
      expect(m.replyLinks([unverified(50)], [w(3)], false)).toEqual({ inReplyTo: 3, offRecord: true });
    },
    'one message off the record, named or in the window, makes the reply off the record, wherever it sits': () => {
      expect(m.replyLinks([on(1), off(2), on(3)], [], false)).toEqual({ inReplyTo: 3, offRecord: true });
      expect(m.replyLinks([off(5)], [], false)).toEqual({ inReplyTo: 5, offRecord: true });
      expect(m.replyLinks([on(7)], [w(1), w(2, true), w(3)], false)).toEqual({ inReplyTo: 7, offRecord: true });
      expect(m.replyLinks([on(1), on(2)], [w(3), w(4)], false).offRecord).toBe(false);
    },
    'an unverified id makes the reply off the record and is never written as what it answers': () => {
      expect(m.replyLinks([unverified(7)], [], false)).toEqual({ inReplyTo: null, offRecord: true });
      expect(m.replyLinks([on(3), unverified(70)], [], false)).toEqual({ inReplyTo: 3, offRecord: true });
    },
    'a cut list makes the reply off the record, links unchanged': () => {
      expect(m.replyLinks([on(3)], [], true)).toEqual({ inReplyTo: 3, offRecord: true });
      expect(m.replyLinks([], [], true)).toEqual({ inReplyTo: null, offRecord: true });
    },
  };
}

const VIEW = {} as never;
export function replyTargetCases(m: ReplyTargetModule): Record<string, SuiteCase> {
  const designated = (sessionId: string, term: number): DesignationRead => ({ kind: 'designated', sessionId, term, row: VIEW });
  return {
    'the designated session records at the current term': () => {
      expect(m.replyTargetVerdict(designated('lane-a-overlord', 3), 'lane-a-overlord')).toEqual({ kind: 'record', term: 3 });
    },
    'any other session, or nobody designated, is not the Overlord': () => {
      expect(m.replyTargetVerdict(designated('lane-a-overlord', 3), 'lane-b-overlord')).toMatchObject({ kind: 'refuse', word: 'not-the-overlord' });
      expect(m.replyTargetVerdict({ kind: 'not-designated', row: null }, 'lane-a-overlord')).toMatchObject({ kind: 'refuse', word: 'not-the-overlord' });
    },
    'an unreadable designation is unmeasured, never a record': () => {
      expect(m.replyTargetVerdict({ kind: 'unmeasured', why: 'fixture' }, 'lane-a-overlord')).toMatchObject({ kind: 'refuse', word: 'unmeasured' });
    },
  };
}

const set = <M>(file: string, suite: (m: M) => Record<string, SuiteCase>, mutants: MutantSet<M>['mutants']): MutantSet<never> =>
  ({ modulePath: path.join(ROOT, file), mutants, suite } as unknown as MutantSet<never>);

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const REPLY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'shared/operatorMessages.ts#replyLinks': set<ReplyLinksModule>('shared/operatorMessages.ts', replyLinksCases, [
    { id: 'L1 the window\'s offRecord ignored', old: '    if (m.offRecord) offRecord = true;\n', new: '' },
    { id: 'L2 the oldest named id links', old: '(verified === null || m.id > verified)', new: '(verified === null || m.id < verified)' },
    { id: 'L3 the window\'s last message decides offRecord', old: '    if (m.offRecord) offRecord = true;\n', new: '    offRecord = m.offRecord;\n' },
    { id: 'L4 a named off or unverified id ignored', old: "    if (m.verdict !== 'on') offRecord = true;\n", new: '' },
    { id: 'L5 only an off id counts, an unverified one does not', old: "if (m.verdict !== 'on') offRecord = true;", new: "if (m.verdict === 'off') offRecord = true;" },
    { id: 'L6 an unverified id links', old: "if (m.verdict !== 'unverified' && (verified", new: 'if ((verified' },
    { id: 'L7 the cut ignored', old: 'let offRecord = cut;', new: 'let offRecord = false;' },
    { id: 'L8 the window links before a named id', old: 'inReplyTo: verified ?? windowNewest', new: 'inReplyTo: windowNewest ?? verified' },
    { id: 'L9 the oldest window id links', old: '(windowNewest === null || m.id > windowNewest)', new: '(windowNewest === null || m.id < windowNewest)' },
  ]),
  'server/src/operatorModel/replies.ts#replyTargetVerdict': set<ReplyTargetModule>('server/src/operatorModel/replies.ts', replyTargetCases, [
    { id: 'V1 any session records', old: "designation.kind === 'designated' && designation.sessionId === sessionId", new: "designation.kind === 'designated'" },
    { id: 'V2 unmeasured records', old: "  if (designation.kind === 'unmeasured') return { kind: 'refuse', word: 'unmeasured', detail: 'the designation could not be read' };\n", new: '' },
  ]),
};
