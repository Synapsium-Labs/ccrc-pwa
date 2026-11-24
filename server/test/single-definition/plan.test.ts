// D-8181, Task 2.1: the plan's core words have one home, `shared/plan.ts`.
import { describe, it, expect } from 'vitest';
import { ALL, rel, stallCode } from './helpers.js';

describe('the plan vocabulary has one home (D-8181)', () => {
  const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
  // `re` must carry the `g` flag, or `match` returns the first hit only and the count is always 1.
  const occurrences = (re: RegExp): string[] => ALL.flatMap((f) => {
    const n = stallCode(f).match(re)?.length ?? 0;
    return n === 0 ? [] : [`${rel(f)}: ${n}`];
  }).sort();
  const decl = (c: string): RegExp => new RegExp(`\\b(?:const|let|var|function|class)\\s+${c}\\b|\\btype\\s+${c}\\s*=|\\binterface\\s+${c}\\b`);

  it('CONTROL: the pattern sees a declaration and passes over a use', () => {
    expect(decl('LINEAR_SYNC_PROGRAMME').test("export const LINEAR_SYNC_PROGRAMME = 'linear-sync';")).toBe(true);
    expect(decl('LINEAR_SYNC_PROGRAMME').test('if (slug === LINEAR_SYNC_PROGRAMME)')).toBe(false);
  });

  it('LINEAR_SYNC_PROGRAMME is spelled once', () => {
    expect(holders(decl('LINEAR_SYNC_PROGRAMME'))).toEqual(['shared/plan.ts']);
    // The one other spelling is migration 59's frozen SQL, which seeds the reserved row (a migration cannot import a constant).
    expect(holders(/'linear-sync'/)).toEqual(['server/src/coord/schema.ts', 'shared/plan.ts']);
  });

  it('the plan lists, bounds and reserved words are declared once, in shared/plan.ts', () => {
    for (const c of ['EPIC_STATES', 'CHECKPOINT_KINDS', 'CHECKPOINT_STATES', 'TICKET_KINDS', 'TICKET_SOURCES', 'TICKET_STATES',
      'PLAN_END_OUTCOMES', 'BINDING_KINDS', 'BINDING_STATES', 'MIGRATION_STATES', 'INBOUND_STATES', 'HIERARCHY_STATES', 'PLAN_BOUNDS',
      'UPKEEP_EPIC_KEY', 'UPKEEP_EPIC_TITLE', 'PLAN_REFUSALS', 'TRIAGE_DECISIONS', 'PHASE_REF_KINDS', 'PHASE_REF_OPS',
      'WORK_STATUSES', 'WORK_GROUPS', 'WORK_SOURCES', 'WORK_VERDICT_READS', 'WORK_READ_FAILED']) {
      expect(holders(decl(c)), c).toEqual(['shared/plan.ts']);
    }
  });

  // D-8808 (review 3196 F2): the page that holds every project's Linear row is spelled once. The server's item text and the
  // console's links (the item's, the name sheets' pointers, Security's own pointer) all read the shared constant.
  // D-8932: that page is Settings' Integrations section now, so its path is the literal counted, and
  // Security's path is left to the two sign-in links, which name that page for passkeys and stay literal.
  // Review 3199 F2: the row counts occurrences, so a second copy inside a listed file reds it too.
  it('the Linear projects settings path is declared once, in shared/ledgers.ts (D-8808)', () => {
    expect(holders(decl('LINEAR_PROJECTS_SETTINGS_PATH'))).toEqual(['shared/ledgers.ts']);
    expect(holders(/\bLINEAR_SETTINGS_PATH\s*=\s*['"`]/)).toEqual([]);
    expect(occurrences(/['"`]\/settings\/integrations\/?['"`]/g)).toEqual(['shared/ledgers.ts: 1']);
    expect(occurrences(/['"`]\/settings\/security\/?['"`]/g)).toEqual([
      'pwa/src/fleet/PasskeyNotice.tsx: 1', 'pwa/src/screens/settings/SignInGateCard.tsx: 2',
    ]);
  });

  it('the work map\'s status-to-group table is declared once, beside its one decider (programme work map WM2, D-8779)', () => {
    expect(holders(decl('WORK_STATUS_GROUP'))).toEqual(['server/src/coord/workMap.ts']);
    expect(holders(decl('workMapOf'))).toEqual(['server/src/coord/workMap.ts']);
  });

  it('the adopted fingerprint is spelled once, in the plan store (D-8183)', () => {
    expect(holders(decl('ADOPTED_FINGERPRINT'))).toEqual(['server/src/coord/planStore.ts']);
    expect(holders(/\bconst\s+ADOPTED\b/)).toEqual([]);
  });

  // Review 2753 F5 (plan Global Constraints: a row for each new list). Each stays where it is, for a recorded reason:
  // RETIRE_WHYS is a server-only stored word (`linear_inbound.retiredWhy`) that no wire or PWA file reads, in an L1 file of its
  // own so the plan store and the inbound policy both reach it without importing each other (`shared/plan.ts` is the vocabulary
  // the PWA bundles); DRIFT_KEEP_NOTE is a server-only note the drift pass writes and reads back; HIERARCHY_ITEM_REFUSALS is a
  // refusal word, whose home is the refusal table (`shared/refusal.ts`, with its status and the PWA's sentence).
  it('the inbound retire causes, the drift Keep note and the hierarchy item refusal are declared once, each at its home (review 2753 F5)', () => {
    for (const [c, home] of [['RETIRE_WHYS', 'server/src/linear/inboundRetire.ts'], ['RetireWhy', 'server/src/linear/inboundRetire.ts'],
      ['DRIFT_KEEP_NOTE', 'server/src/linear/driftPolicy.ts'], ['HIERARCHY_ITEM_REFUSALS', 'shared/refusal.ts'],
      ['HierarchyItemRefusal', 'shared/refusal.ts']] as const) {
      expect(holders(decl(c)), c).toEqual([home]);
    }
    expect(holders(/Keeping the plan; ccrc goes on restoring/)).toEqual(['server/src/linear/driftPolicy.ts']);
  });

  // Review 2918 A3 (plan Global Constraints: a row for each new list): the migration's waiting reasons and the `planBy` of the
  // rows its map declares are declared once, in shared/plan.ts; the planBy word itself is spelled there alone.
  it('the migration\'s waiting reasons and its planBy word are declared once, in shared/plan.ts (review 2918 A3)', () => {
    for (const c of ['MIGRATION_WAITING_WHY', 'MigrationWaitingWhy', 'MIGRATION_PLAN_BY']) expect(holders(decl(c)), c).toEqual(['shared/plan.ts']);
    expect(holders(/'ccrc-migration'/)).toEqual(['shared/plan.ts']);
  });
});
