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
  return {
    'no message answered: no inReplyTo, on the record': () => {
      expect(m.replyLinks([])).toEqual({ inReplyTo: null, offRecord: false });
    },
    'inReplyTo is the newest id answered, whatever the order': () => {
      expect(m.replyLinks([{ id: 9, offRecord: false }, { id: 4, offRecord: false }, { id: 12, offRecord: false }]).inReplyTo).toBe(12);
    },
    'one message sent off the record makes the reply off the record, wherever it sits': () => {
      expect(m.replyLinks([{ id: 1, offRecord: false }, { id: 2, offRecord: true }, { id: 3, offRecord: false }])).toEqual({ inReplyTo: 3, offRecord: true });
      expect(m.replyLinks([{ id: 5, offRecord: true }])).toEqual({ inReplyTo: 5, offRecord: true });
      expect(m.replyLinks([{ id: 1, offRecord: false }, { id: 2, offRecord: false }]).offRecord).toBe(false);
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
    { id: 'L1 offRecord ignored', old: '    if (m.offRecord) offRecord = true;\n', new: '' },
    { id: 'L2 the oldest id answered', old: 'if (inReplyTo === null || m.id > inReplyTo) inReplyTo = m.id;', new: 'if (inReplyTo === null || m.id < inReplyTo) inReplyTo = m.id;' },
    { id: 'L3 the last message decides offRecord', old: '    if (m.offRecord) offRecord = true;\n', new: '    offRecord = m.offRecord;\n' },
  ]),
  'server/src/operatorModel/replies.ts#replyTargetVerdict': set<ReplyTargetModule>('server/src/operatorModel/replies.ts', replyTargetCases, [
    { id: 'V1 any session records', old: "designation.kind === 'designated' && designation.sessionId === sessionId", new: "designation.kind === 'designated'" },
    { id: 'V2 unmeasured records', old: "  if (designation.kind === 'unmeasured') return { kind: 'refuse', word: 'unmeasured', detail: 'the designation could not be read' };\n", new: '' },
  ]),
};
