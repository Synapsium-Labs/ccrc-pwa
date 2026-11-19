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

const REQ: KeyedSend = { toId: 'coordinator', runId: 7, kind: 'status', subject: 's', body: 'b', artifacts: ['/a', '/b'] };
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
];

export function mailKeyVerdictCases(m: MailKeyModule): Record<string, SuiteCase> {
  return {
    'no prior mail under the key is new': () => {
      expect(m.mailKeyVerdict(REQ, null)).toEqual({ verdict: 'new' });
    },
    'the same fields answer the prior id': () => {
      expect(m.mailKeyVerdict(REQ, PRIOR)).toEqual({ verdict: 'same', id: 41 });
      expect(m.mailKeyVerdict({ ...REQ, artifacts: [...REQ.artifacts] }, PRIOR)).toEqual({ verdict: 'same', id: 41 });
      expect(m.mailKeyVerdict({ ...REQ, runId: null, artifacts: [] }, { ...PRIOR, runId: null, artifacts: [] }))
        .toEqual({ verdict: 'same', id: 41 });
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
      expect(m.KEYED_FIELDS).toEqual(['toId', 'runId', 'kind', 'subject', 'body', 'artifacts']);
    },
  };
}

const MAIL_KEY_SET: MutantSet<MailKeyModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/mailKey.ts'),
  mutants: [
    { id: 'K1 no prior is same', old: "if (prior === null) return { verdict: 'new' };", new: "if (prior === null) return { verdict: 'same', id: 0 } as never;" },
    { id: 'K2 artifacts never compared', old: "? !sameArtifacts(request.artifacts, prior.artifacts)", new: '? false' },
    { id: 'K3 scalars never compared', old: ': request[f] !== prior[f]);', new: ': false);' },
    { id: 'K4 a prefix is the same list', old: 'a.length === b.length && ', new: '' },
    { id: 'K5 order ignored', old: 'a.every((p, i) => p === b[i])', new: 'a.every((p) => b.includes(p))' },
    { id: 'K6 a conflict reads as same', old: 'if (fields.length === 0) return', new: 'if (fields.length <= 1) return' },
    { id: 'K7 the new id, not the prior', old: "return { verdict: 'same', id: prior.id };", new: "return { verdict: 'same', id: 0 };" },
    { id: 'K8 a field left out', old: "'toId', 'runId', 'kind', 'subject', 'body', 'artifacts'", new: "'toId', 'kind', 'subject', 'body', 'artifacts'" },
  ],
  suite: mailKeyVerdictCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const MAIL_KEY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/mailKey.ts#mailKeyVerdict': MAIL_KEY_SET as MutantSet<never>,
};
