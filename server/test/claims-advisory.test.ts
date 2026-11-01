// Claims are ADVISORY, never enforcing — and that is a red suite, not a
// sentence (build 9 D12). An ENFORCING claim on ccd/ccd (15 concurrent
// branches measured) or shared/api.ts (18) is the permanent wedge, so the
// EXECUTABLE substrate must carry zero claim references: the skills teach the
// protocol; the substrate must not enforce it.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsedFile } from './scan/symbols.js';

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
      'sleepLane.ts',        // D-5370, D-5242 (one executor since D-7042): for both sleep
                             // lanes a live claim HOLDS the server's own unattended sleep
                             // of the claim's HOLDER awake (`claim`), and does nothing
                             // else. It never refuses, delays or redirects another
                             // party's work, so it cannot become enforcement: the only
                             // effect of a claim is that its holder's process is left
                             // running (hibernation's `claim` hold, spec §5.11). The
                             // count pin below keeps a second, differently-shaped use out.
      'depsShedPass.ts',     // D-7278: the deps-shed arm of the run-done row reads the live claims
                             // once per pass and passes one boolean per row, and a live claim
                             // only HOLDS the server's own removal of the HOLDER's ignored
                             // dependency directories (`claim`). It never refuses, delays or
                             // redirects another party's work, and it never enforces anything:
                             // the only effect of a claim is that the holder's node_modules
                             // stay on disk. A missing claim sheds nothing by itself. The call
                             // count pin below keeps a second use out.
      'depsShed.ts',         // D-7278: the arm's L1 verdict names the field in a docstring and
                             // only reads the boolean the pass hands it (`claim` → hold). It
                             // carries no call, which the pin below holds at zero.
      'coord/ports.ts',      // D-7579: the watcher's store port names the member once, as a
                             // string-literal member of the type-only `WatcherCoordMember` union
                             // that `WatcherCoordPort` Picks from `CoordStore`. tsc emits nothing
                             // for the file, so naming it there reads no claim and enforces
                             // nothing; the port only narrows what the watcher (already allowed
                             // above, count-pinned) may call. The pin below holds that single
                             // quoted occurrence, so a call landing here still fails.
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
    // The store port's exception (D-7579), held by SHAPE: exactly one occurrence, and it is the quoted union member.
    const portsSrc = readFileSync(path.join(srcRoot, 'coord', 'ports.ts'), 'utf8');
    expect(portsSrc.split('activeClaims').length - 1, 'coord/ports.ts names activeClaims once, as a type member').toBe(1);
    expect(portsSrc.split("'activeClaims'").length - 1, 'that one occurrence is the quoted union member').toBe(1);
    const watchSrc = readFileSync(path.join(srcRoot, 'watch.ts'), 'utf8');
    expect(watchSrc.split('activeClaims').length - 1,
      'watch.ts gained or lost an activeClaims call site — argue the D12 shape here before re-pinning')
      .toBe(4);
    // The sleep lanes' exception (D-5370, D-5242; D-7042), held by COUNT of CALLS over EVERY call scan/symbols.ts
    // parses in sleepLane.ts: one `coord.activeClaims()` call in each lane row's binding read (run-done's batched
    // `storeReads`, idle-hours' once-a-pass `claimantsOf`), each feeding the `claim` hold. The count is over the
    // whole file, not over its top-level symbols: RUN_DONE_LANE and IDLE_HOURS_LANE are object-literal consts with
    // no symbol of their own, and a lane row's arrows (`bindings`, `asks.*`, `notices`) are exactly where a new
    // lane-shaped claim use would land. The store ports' `Pick`s and the docstrings are not calls and are not counted.
    const SLEEP_LANE = path.join(srcRoot, 'sleepLane.ts');
    const claimCalls = parsedFile(SLEEP_LANE).calls.filter((c) => c.name === 'activeClaims');
    expect(claimCalls.map((c) => c.callee),
      'sleepLane.ts gained or lost an activeClaims call site — argue the D12 shape here before re-pinning')
      .toEqual(['coord.activeClaims', 'coord.activeClaims']);
    // The deps-shed arm's exception (D-7278), held by COUNT of CALLS the same way: ONE `deps.coord.activeClaims()` in
    // the pass's batched `storeReads`, feeding the `claim` hold, and NONE in the L1 verdict, which reads a boolean.
    const shedCalls = (f: string) => parsedFile(path.join(srcRoot, f)).calls.filter((c) => c.name === 'activeClaims')
      .map((c) => c.callee);
    expect(shedCalls('depsShedPass.ts'),
      'depsShedPass.ts gained or lost an activeClaims call site — argue the D12 shape here before re-pinning')
      .toEqual(['deps.coord.activeClaims']);
    expect(shedCalls('depsShed.ts'), 'the deps-shed verdict reads the store through the pass, never itself').toEqual([]);
  });
});
