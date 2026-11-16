// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.2, §5.6): the composition root builds the collector
// switch's ONE generation journal and this process's ONE boot nonce, and hands both, as one `collectLane` object, to
// BOTH deps literals. `Deps.collectLane` is optional, so an arm without it is no type error, and no suite boots
// index.ts in remote mode: the route would answer 501 and the lane read its control state as not configured, with
// nothing red. A text pin over code only, `update-routes.test.ts`'s idiom for `updateIntentLog`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { codeOnly } from './sourceScan.js';

const INDEX = codeOnly(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'));

describe('the collector switch is composed once, in index.ts (path-identity spec 2026-10-12 §5.2)', () => {
  it('index.ts builds one journal from cfg.ccrcDir and one randomUUID nonce', () => {
    expect(INDEX.match(/\bcollectLaneJournalAt\(/g) ?? []).toHaveLength(1);
    expect(INDEX).toMatch(/\bcollectLaneJournalAt\(defaultCollectLaneJournalPath\(cfg\.ccrcDir\)\)/);
    expect(INDEX.match(/\brandomUUID\(\)/g) ?? []).toHaveLength(1);
    expect(INDEX).toMatch(/\bbootNonce: randomUUID\(\)/);
  });

  it('both deps literals carry collectLane', () => {
    const depsLiterals = INDEX.match(/^  deps = \{\n[\s\S]*?^  \};$/gm) ?? [];
    expect(depsLiterals).toHaveLength(2);
    expect(depsLiterals[0]).toContain('io: fleet.io');
    expect(depsLiterals[1]).toContain('io: localIO');
    for (const lit of depsLiterals) expect(lit).toMatch(/^\s+collectLane,$/m);
  });
});
