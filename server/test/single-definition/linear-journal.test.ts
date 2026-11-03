// D-7671, D-7672, D-7687 (#1444, Linear central key plan task LK7). The write journal and the policy point each have
// one home: `linear_events` is named only by its migration and its one writer; `LinearJournal` is declared once and
// constructed by the composition root alone (the one journal writer of the plan's "One of each"); the port's three
// types are declared once in `linear/policy.ts`; the deadline, the two refusal words, `askWithDeadline` and `allowAll`
// once in `linear/policyPoint.ts`. Test files are not sources here, so `linearServicesFake.ts` is no second home.
import { describe, it, expect } from 'vitest';
import { ALL, rel, stallCode } from './helpers.js';

describe('the Linear write journal and the policy point each have one home (D-7671, D-7672, D-7687)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);

  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('LinearJournal').test('export class LinearJournal {')).toBe(true);
    expect(decl('LinearJournal').test('const linearJournal = new LinearJournal(coord.db);')).toBe(false);
    expect(decl('allowAll').test('export const allowAll: LinearWritePolicy = async () => ALLOW;')).toBe(true);
    expect(decl('allowAll').test('deps.linearPolicy = allowAll;')).toBe(false);
  });

  it('the table is named only by its migration and its writer', () => {
    expect(holders(/\blinear_events\b/)).toEqual(['server/src/coord/schema.ts', 'server/src/linear/journal.ts']);
  });

  it('the journal is declared once and constructed by the composition root alone', () => {
    for (const c of ['LinearJournal', 'LinearPendingInput', 'LINEAR_JOURNAL_OPS', 'LINEAR_JOURNAL_OUTCOMES',
      'LINEAR_JOURNAL_FIELDS', 'LINEAR_JOURNAL_RETENTION_DAYS']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/journal.ts']);
    }
    expect(holders(/\bnew LinearJournal\(/)).toEqual(['server/src/index.ts']);
  });

  it('the composition root alone hands the journal and the default policy to Deps', () => {
    expect(holders(/\bdeps\.linearJournal\s*=(?!=)/)).toEqual(['server/src/index.ts']);
    expect(holders(/\bdeps\.linearPolicy\s*=\s*allowAll;/)).toEqual(['server/src/index.ts']);
    expect(holders(/\bdeps\.linearPolicy\s*=(?!=)/)).toEqual(['server/src/index.ts']);
  });

  it('the port is declared once, at L2; its deadline, words and default once, beside the point', () => {
    for (const c of ['LinearWriteAsk', 'LinearWriteDecision', 'LinearWritePolicy']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/policy.ts']);
    }
    for (const c of ['LINEAR_POLICY_DEADLINE_MS', 'LINEAR_POLICY_REFUSALS', 'askWithDeadline', 'allowAll']) {
      expect(holders(decl(c)), c).toEqual(['server/src/linear/policyPoint.ts']);
    }
  });
});
