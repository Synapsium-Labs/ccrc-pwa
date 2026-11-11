// D-8181, Task 2.1: the plan's core words have one home, `shared/plan.ts`.
import { describe, it, expect } from 'vitest';
import { ALL, rel, stallCode } from './helpers.js';

describe('the plan vocabulary has one home (D-8181)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);

  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('LINEAR_SYNC_PROGRAMME').test("export const LINEAR_SYNC_PROGRAMME = 'linear-sync';")).toBe(true);
    expect(decl('LINEAR_SYNC_PROGRAMME').test('if (slug === LINEAR_SYNC_PROGRAMME)')).toBe(false);
  });

  it('LINEAR_SYNC_PROGRAMME is spelled once', () => {
    expect(holders(decl('LINEAR_SYNC_PROGRAMME'))).toEqual(['shared/plan.ts']);
    expect(holders(/'linear-sync'/)).toEqual(['shared/plan.ts']);
  });

  it('the plan lists, bounds and reserved words are declared once, in shared/plan.ts', () => {
    for (const c of ['EPIC_STATES', 'CHECKPOINT_KINDS', 'CHECKPOINT_STATES', 'TICKET_KINDS', 'TICKET_SOURCES', 'TICKET_STATES',
      'PLAN_END_OUTCOMES', 'BINDING_KINDS', 'BINDING_STATES', 'MIGRATION_STATES', 'HIERARCHY_STATES', 'PLAN_BOUNDS',
      'UPKEEP_EPIC_KEY', 'UPKEEP_EPIC_TITLE', 'PLAN_REFUSALS']) {
      expect(holders(decl(c)), c).toEqual(['shared/plan.ts']);
    }
  });
});
