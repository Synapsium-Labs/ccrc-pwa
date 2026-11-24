// `coord/ledger.ts` after the deviation allocator's retirement (docs/superpowers/plans/2026-11-24-deviation-allocator-removal-pr2.md):
// numbers are self-assigned (`npm run next-deviation`), so the allocator's decision (`decideAllocation`), its floor scan
// (`floorFromScan`) and the reconcile sweep's orphan audit (`projectEra`, `unallocatedDefinitions`) are gone. What stays
// is the definition reader, the two collision checks and the helper's count bound (`ledger-crosstree.test.ts`,
// `next-deviation.test.ts`).
import { describe, it, expect } from 'vitest';
import * as ledger from '../src/coord/ledger.js';

describe('coord/ledger.ts after the allocator', () => {
  it('exports none of the retired allocator\'s decisions', () => {
    const mod: Record<string, unknown> = ledger;
    for (const name of ['decideAllocation', 'floorFromScan', 'projectEra', 'unallocatedDefinitions']) {
      expect(mod[name], name).toBeUndefined();
    }
  });

  it('keeps the helper\'s count bound', () => {
    expect(ledger.LEDGER_ALLOC_MAX).toBe(100);
  });
});
