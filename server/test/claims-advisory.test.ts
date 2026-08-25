// Claims are ADVISORY, never enforcing — and that is a red suite, not a
// sentence (build 9 D12). An ENFORCING claim on ccd/ccd (15 concurrent
// branches measured) or shared/api.ts (18) is the permanent wedge, so the
// EXECUTABLE substrate must carry zero claim references: the skills teach the
// protocol; the substrate must not enforce it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');

// The claims API's names, not the word "claim": ccd legitimately says `claim`
// (`_reg_claim`, the `claim` lifecycle act). What it may never do is call the
// claims API or read its tables.
const FORBIDDEN = ['/api/claims', '/api/ledger', 'activeClaims', 'claim_one_owner', 'ledger_alloc'];

describe('claims are advisory (D12)', () => {
  it('ccd/ccd and session-hook.sh carry ZERO claims-API references', () => {
    const floors: Record<string, number> = { 'ccd/ccd': 11_000, 'ccd/session-hook.sh': 50 };
    for (const [file, floor] of Object.entries(floors)) {
      const src = readFileSync(path.join(REPO, file), 'utf8');
      // Coverage: an empty or truncated read must not pass by having nothing
      // in it to match.
      expect(src.split('\n').length, `${file} shrank out from under the scan`)
        .toBeGreaterThan(floor);
      for (const tok of FORBIDDEN) {
        expect(src.includes(tok),
          `${file} references ${tok} — an enforcing claim on the substrate is the permanent wedge`)
          .toBe(false);
      }
    }
  });

  it('the only server files that touch activeClaims are the store, the routes, the tick-rider and their L1s', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    const srcRoot = path.join(REPO, 'server', 'src');
    const ALLOWED = new Set([
      'coord/store.ts',      // the definition
      'coord/routes.ts',     // GET /api/peers and GET /api/claims read it
      'coord/peers.ts',      // the L1 decision, when it reads rows at all
      'divergence.ts',       // divergence.claim-orphan
      'watch.ts',            // the D12 tick-rider: renewClaims/lapseClaims ARE the
                             // no-session-side-heartbeat mechanism, and
                             // sweepDivergences feeds divergence.claim-orphan.
                             // Whole-file admission would blind the scan to a NEW
                             // call site, so the count pin below carries the load.
    ]);
    const holders = walk(srcRoot)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('activeClaims'))
      .map((f) => path.relative(srcRoot, f))
      .filter((f) => !ALLOWED.has(f));
    expect(holders, 'a new reader of activeClaims is a new place a claim can become ' +
      'enforcement — add it to ALLOWED only with a D12-shaped argument').toEqual([]);
    // Coverage: the scan really found the readers that must exist, so an
    // emptied tree (or a renamed method) cannot pass by matching nothing.
    const found = walk(srcRoot).filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('activeClaims'))
      .map((f) => path.relative(srcRoot, f));
    expect(found).toContain('coord/store.ts');
    expect(found).toContain('coord/routes.ts');
    // The tick-rider exception, held by COUNT because the file itself cannot be
    // forbidden: the landed four occurrences are sweepDivergences' read + its
    // degrade warning, renewClaims's, and lapseClaims's — each a D12-blessed
    // reader (lease-on-the-tick, claim-orphan). A FIFTH occurrence is a new
    // place a claim can become enforcement (the "just skip claimed rows in a
    // sweep" mutant lands exactly here), so it must be argued and re-pinned,
    // never absorbed.
    const watchSrc = readFileSync(path.join(srcRoot, 'watch.ts'), 'utf8');
    expect(watchSrc.split('activeClaims').length - 1,
      'watch.ts gained or lost an activeClaims call site — argue the D12 shape here before re-pinning')
      .toBe(4);
  });
});
