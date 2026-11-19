// `mailKeyVerdict`'s oracle and mutant set (Overlord wave 164, the mail idempotency key). Its cases are written ONCE here, as
// suite cases over a module: `mail-client-key.test.ts` runs them against the real module, and `mutation-floors.test.ts` runs
// them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { KeyedMail, KeyedSend } from '../../src/coord/mailKey.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type MailKeyModule = typeof import('../../src/coord/mailKey.js');

const REQ: KeyedSend = { toId: 'coordinator', runId: 7, kind: 'status', subject: 's', body: 'b', artifacts: ['/a', '/b'], inReplyTo: 5 };
const PRIOR: KeyedMail = { ...REQ, id: 41 };

/** One change per field, and the field the conflict must name. Literal on purpose: a new compared field is a choice. */
const CHANGED: readonly [string, Partial<KeyedSend>][] = [
  ['toId', { toId: 'worker' }],
  ['runId', { runId: 8 }],
  ['runId', { runId: null }],
  ['kind', { kind: 'answer' }],
  ['subject', { subject: 's2' }],
  ['body', { body: 'b2' }],
  ['artifacts', { artifacts: ['/a'] }],
  ['artifacts', { artifacts: ['/b', '/a'] }],
  ['artifacts', { artifacts: ['/a', '/b', '/c'] }],
  ['artifacts', { artifacts: [] }],
  ['inReplyTo', { inReplyTo: 6 }],
  ['inReplyTo', { inReplyTo: null }],
];

export function mailKeyVerdictCases(m: MailKeyModule): Record<string, SuiteCase> {
  return {
    'no prior mail under the key is new': () => {
      expect(m.mailKeyVerdict(REQ, null)).toEqual({ verdict: 'new' });
    },
    'the same fields answer the prior id': () => {
      expect(m.mailKeyVerdict(REQ, PRIOR)).toEqual({ verdict: 'same', id: 41 });
      expect(m.mailKeyVerdict({ ...REQ, artifacts: [...REQ.artifacts] }, PRIOR)).toEqual({ verdict: 'same', id: 41 });
      expect(m.mailKeyVerdict({ ...REQ, runId: null, artifacts: [], inReplyTo: null },
        { ...PRIOR, runId: null, artifacts: [], inReplyTo: null })).toEqual({ verdict: 'same', id: 41 });
    },
    'a different field is a conflict naming that field and the prior mail': () => {
      for (const [field, change] of CHANGED) {
        const v = m.mailKeyVerdict({ ...REQ, ...change }, PRIOR);
        expect(v, field).toMatchObject({ verdict: 'conflict', id: 41, fields: [field] });
        expect(v.verdict === 'conflict' && v.detail, field).toContain('mail 41');
        expect(v.verdict === 'conflict' && v.detail, field).toContain(field);
      }
    },
    'every differing field is named, in the fixed order': () => {
      expect(m.mailKeyVerdict({ ...REQ, body: 'x', toId: 'y' }, PRIOR)).toMatchObject({ verdict: 'conflict', fields: ['toId', 'body'] });
      expect(m.KEYED_FIELDS).toEqual(['toId', 'runId', 'kind', 'subject', 'body', 'artifacts', 'inReplyTo']);
    },
    // Review 2725 F4: the store reads a lone surrogate back as U+FFFD, so a retry of such text is the same mail.
    'text compares as the store keeps it: a lone surrogate matches U+FFFD, and nothing else is folded': () => {
      const stored = { ...PRIOR, subject: 's\ufffd', body: 'a\ufffdb\ufffd', artifacts: ['/a\ufffd', '/b'] };
      expect(m.mailKeyVerdict({ ...REQ, subject: 's\udc00', body: 'a\ud800b\udbff', artifacts: ['/a\ud83d', '/b'] }, stored))
        .toEqual({ verdict: 'same', id: 41 });
      expect(m.mailKeyVerdict({ ...REQ, toId: 'c\ud800' }, { ...PRIOR, toId: 'c\ufffd' })).toEqual({ verdict: 'same', id: 41 });
      // A well-formed pair is text, never folded; a different character is a different mail.
      expect(m.mailKeyVerdict({ ...REQ, body: '\ud83d\ude00' }, { ...PRIOR, body: '\ufffd\ufffd' })).toMatchObject({ fields: ['body'] });
      expect(m.mailKeyVerdict({ ...REQ, body: '\ud83d\ude00' }, { ...PRIOR, body: '\ud83d\ude00' })).toEqual({ verdict: 'same', id: 41 });
      expect(m.mailKeyVerdict({ ...REQ, body: 'a\ud800b' }, { ...PRIOR, body: 'a?b' })).toMatchObject({ fields: ['body'] });
      expect(m.mailKeyVerdict({ ...REQ, artifacts: ['/a\ud800', '/b'] }, { ...PRIOR, artifacts: ['/a?', '/b'] }))
        .toMatchObject({ fields: ['artifacts'] });
      expect(m.storedText('x\ud800y')).toBe('x\ufffdy');
      expect(m.storedText('ok')).toBe('ok');
    },
  };
}

const MAIL_KEY_SET: MutantSet<MailKeyModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/mailKey.ts'),
  mutants: [
    { id: 'K1 no prior is same', old: "if (prior === null) return { verdict: 'new' };", new: "if (prior === null) return { verdict: 'same', id: 0 } as never;" },
    { id: 'K2 artifacts never compared', old: 'return !sameArtifacts(request.artifacts, prior.artifacts);', new: 'return false;' },
    { id: 'K3 scalars never compared', old: "return typeof a === 'string' && typeof b === 'string' ? !sameText(a, b) : a !== b;", new: 'return false;' },
    { id: 'K3b numbers never compared', old: '? !sameText(a, b) : a !== b;', new: '? !sameText(a, b) : false;' },
    { id: 'K4 a prefix is the same list', old: 'a.length === b.length && ', new: '' },
    { id: 'K5 order ignored', old: 'a.every((p, i) => sameText(p, b[i]!))', new: 'a.every((p) => b.includes(p))' },
    { id: 'K6 a conflict reads as same', old: 'if (fields.length === 0) return', new: 'if (fields.length <= 1) return' },
    { id: 'K7 the new id, not the prior', old: "return { verdict: 'same', id: prior.id };", new: "return { verdict: 'same', id: 0 };" },
    { id: 'K8 a field left out', old: "'toId', 'runId', 'kind', 'subject', 'body', 'artifacts', 'inReplyTo'", new: "'toId', 'kind', 'subject', 'body', 'artifacts', 'inReplyTo'" },
    { id: 'K9 inReplyTo left out', old: "'artifacts', 'inReplyTo'] as const", new: "'artifacts'] as const" },
    { id: 'K10 text compared raw', old: '? !sameText(a, b) : a !== b;', new: '? a !== b : a !== b;' },
    { id: 'K11 artifacts compared raw', old: 'a.every((p, i) => sameText(p, b[i]!))', new: 'a.every((p, i) => p === b[i])' },
    { id: 'K12 nothing folded', old: "s.replace(LONE_SURROGATES, '\\ufffd')", new: 's' },
    { id: 'K13 every surrogate folded', old: "new RegExp(LONE_SURROGATE.source, 'g')", new: "/[\\ud800-\\udfff]/g" },
  ],
  suite: mailKeyVerdictCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const MAIL_KEY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/mailKey.ts#mailKeyVerdict': MAIL_KEY_SET as MutantSet<never>,
};
