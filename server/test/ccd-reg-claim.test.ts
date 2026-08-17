// server/test/ccd-reg-claim.test.ts
//
// `started` is what §4.3's ladder reads to tell `orphan` from `never-started`,
// and after Wave 1 it is also what tells `unclaimed` from `running`. Eight
// writers across two processes is a fact nobody owns. The FIELD gets one
// writer; the CALLERS stay authoritative about when — which is why this is a
// substitution, not a relocation of the decision into _spawn_start.
//
// A TEXT SCAN over the shipped script, the idiom ownership.test.ts and
// wsaudit.test.ts already use: the mutant is a second `_reg_set … started`
// line anywhere in the file, and it must go red.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

const ccd = readFileSync(CCD, 'utf8');

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-claim-'); });
afterEach(() => { h.cleanup(); });

describe('_reg_claim is the ONE writer of the started field', () => {
  it('has exactly one `_reg_set … started` line in the whole script', () => {
    const hits = ccd.split('\n').filter((l) => /_reg_set\s+"\$\w+"\s+started\b/.test(l));
    expect(hits, 'a second writer of `started` — route it through _reg_claim').toHaveLength(1);
  });

  it('and that line is inside _reg_claim', () => {
    expect(ccd).toMatch(/_reg_claim\(\)\s*\{[^}]*_reg_set\s+"\$1"\s+started\s+1;?\s*\}/);
  });

  it('every former write site now calls _reg_claim — eight of them', () => {
    const calls = ccd.split('\n').filter((l) => /^\s*_reg_claim\s+"\$id"/.test(l));
    expect(calls).toHaveLength(8);
  });

  it('actually writes the field', () => {
    h.sh('_reg_claim demo-quiet-basin');
    expect(h.reg('demo-quiet-basin', 'started')).toBe('1');
  });

  it('is monotone WITHIN A ROW — the only eraser is _reg_purge, which drops the whole identity', () => {
    // The reason _spawn_start owes a --resume -> --session-id fallback
    // (Task 9): `started` is written at session-creation time and nothing
    // removes it INDEPENDENTLY, so a spawn that never came up resumes a uuid
    // with no transcript behind it forever.
    //
    // The one exception, named rather than silently asserted away: `_reg_purge`
    // (`# id -> rm -f every "$REG/$id.<field>" registry file for id`) unlinks
    // every field at once, from `forget` / reap / dead-reg. That is not
    // "clearing started" — it is destroying the row. Pinning its existence
    // keeps the exception documented instead of letting a future reader find
    // the comment above false.
    expect(ccd).not.toMatch(/_reg_(del|unset)\b/);
    expect(ccd).not.toMatch(/rm -f "\$REG\/\$?\{?id\}?\.started"/);
    expect(ccd).toMatch(/^_reg_purge\(\)/m);
  });
});
