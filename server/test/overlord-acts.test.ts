// The act row's deciders (Overlord W2, act rows A, Tasks A2 and A3; plan w2-act-rows.md §4.3 and question 2). The cases live in
// `actCases.ts`, shared with the mutant sets; this file runs them against the real module and holds the kebab guard.
import { describe, expect, it } from 'vitest';
import * as acts from '../src/coord/overlordActs.js';
import * as ceiling from '../src/coord/overlordActCeiling.js';
import {
  actNaturalKeyCases, actSettleVerdictCases, actWriteVerdictCases, countReadableCases, nextActIdCases, writeCountGroupsCases,
} from './actCases.js';

const run = (name: string, cases: Record<string, () => void>): void => {
  describe(name, () => { for (const [title, fn] of Object.entries(cases)) it(title, fn); });
};
run('actNaturalKey', actNaturalKeyCases(acts));
run('nextActId', nextActIdCases(acts));
run('actWriteVerdict', actWriteVerdictCases(acts));
run('actSettleVerdict', actSettleVerdictCases(acts));
run('the count groups a write reads', writeCountGroupsCases(acts));
run('the wired count\'s guard (actCeilingStep)', countReadableCases(ceiling));

describe('the act words', () => {
  it('admits the states, movers, target kinds, record kinds and refusals, and nothing else', () => {
    for (const w of ['pending', 'shadow', 'lane', 'staging', 'delivery', 'programme', 'start', 'act-intent', 'act-settle',
      'act-open-request', 'natural-key-taken', 'op-key-taken', 'bad-row', 'not-found', 'allow-spent', 'cell-not-built']) {
      expect(acts.isActKebab(w), w).toBe(true);
    }
    for (const w of ['settled', 'act-key-taken', 'op-key-reused', 'hasOwnProperty', '']) expect(acts.isActKebab(w), w).toBe(false);
  });
  it('the journal records: a done write is one act-settle from null, a pending one act-intent, and opens adds act-open-request', () => {
    const body = { opKey: 'a'.repeat(32), actId: 5, act: 'open-request', effect: null, natural: { kind: 'row', target: 'request', id: 3, revision: 0 },
      targets: [], requestId: 3, authority: 'own', term: 1, generationId: 2, actor: { kind: 'session', subject: 'overlord-a' },
      identityStrength: 'attributed', isolation: 'shared-user' } as const;
    expect(acts.writeRecords(body, 'done', null)).toEqual([{ kind: 'act-settle', from: null, to: 'done', ...body }]);
    expect(acts.writeRecords(body, 'pending', null)).toEqual([{ kind: 'act-intent', ...body }]);
    expect(acts.writeRecords(body, 'done', 3)).toEqual([{ kind: 'act-settle', from: null, to: 'done', ...body },
      { kind: 'act-open-request', opKey: 'a'.repeat(32), requestId: 3, actId: 5 }]);
  });
  it('targets sort by kind, then id, then revision', () => {
    expect(acts.sortedTargets([{ kind: 'request', id: '9', revision: 1 }, { kind: 'programme', id: 'p', revision: 0 },
      { kind: 'request', id: '10', revision: 0 }, { kind: 'request', id: '9', revision: 0 }]))
      .toEqual([{ kind: 'programme', id: 'p', revision: 0 }, { kind: 'request', id: '10', revision: 0 },
        { kind: 'request', id: '9', revision: 0 }, { kind: 'request', id: '9', revision: 1 }]);
  });
});
