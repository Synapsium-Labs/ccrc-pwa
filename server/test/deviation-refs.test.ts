// The allocator prevents; this scanner detects (build 9 D13). The bb47c9e
// shape: one D-<n> carrying two different subject lines in two different
// plans — the exact wreck the ledger allocator exists to make impossible. It
// ALSO already exists in history: the pre-allocator era minted collisions
// (parallel branches, one number), and three early plans reset numbering per
// plan. Both are grandfathered by MEASUREMENT — the sets below were copied
// from this suite's own first red run, they may only SHRINK (wave 10's D14
// reconciliation is what shrinks them), and every member must still actually
// collide, so a stale entry cannot quietly mask a new one.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { floorFromScan } from '../src/coord/ledger.js';
import { LEDGER_SEED_GAP } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const PLANS = path.resolve(here, '..', '..', 'docs', 'superpowers', 'plans');

/** Plans that predate the one-global-namespace rule and numbered per plan —
 *  excluded from the scan wholesale. May only shrink. */
const LEGACY_PER_PLAN_LEDGERS: ReadonlySet<string> = new Set([
  '2026-08-07-smart-branch-naming.md',
  '2026-08-08-build7-core.md',
  '2026-08-08-build7-surfaces.md',
]);

/** Numbers already collided on main when this suite was written (the
 *  pre-allocator wreckage). May only shrink; nothing >= 211 may ever join —
 *  211 is the first allocator-era number. */
const GRANDFATHERED: ReadonlySet<number> = new Set([
  72, 128, 129, 130, 131, 132, 133, 134, 135, 137, 138, 139, 140, 141, 145, 171,
]);

// Both ledger-entry heading forms in use: `### D-12 (bug) — subject` (plan
// ledgers through build 7) and `- **D-108 (2026-08-20)** — subject` (the
// bullet form since). Prose REFS (`see D-108`) match neither — this scans
// entries, the lines that DEFINE a number. A dotted SUB-entry (`- **D-310.1**
// — finding`) cites its parent, it does not define it: excluded by the
// lookahead. The exclusion is pinned by the tree itself — the wave-10
// reconciliation gave the substrate plan's sub-findings a global parent, so
// deleting the lookahead reds the collision scan below against real docs.
const ENTRY = /^(?:#{2,4} |- \*\*)D-(\d+)\b(?!\.\d)[^—\n]*—\s*(.+)$/;

interface Entry { file: string; n: number; subject: string }

const entries = (): Entry[] => {
  const out: Entry[] = [];
  for (const f of readdirSync(PLANS).filter((f) => f.endsWith('.md'))) {
    if (LEGACY_PER_PLAN_LEDGERS.has(f)) continue;
    for (const line of readFileSync(path.join(PLANS, f), 'utf8').split('\n')) {
      const m = ENTRY.exec(line);
      if (m) out.push({ file: f, n: Number(m[1]), subject: m[2]!.trim() });
    }
  }
  return out;
};

const collisions = (): [number, Entry[]][] => {
  const byN = new Map<number, Entry[]>();
  for (const e of entries()) byN.set(e.n, [...(byN.get(e.n) ?? []), e]);
  return [...byN.entries()].filter(([, es]) =>
    new Set(es.map((e) => e.subject)).size > 1 && new Set(es.map((e) => e.file)).size > 1);
};

describe('the deviation-refs scanner (D13 — the bb47c9e shape)', () => {
  it('no NEW D-<n> carries two different subjects in two different plans', () => {
    const fresh = collisions().filter(([n]) => !GRANDFATHERED.has(n));
    expect(fresh.map(([n, es]) =>
      `D-${n}:\n${es.map((e) => `  ${e.file} :: ${e.subject}`).join('\n')}`),
      'one number, two deviations — allocate through POST /api/ledger/deviations').toEqual([]);
  });

  it('the scanner is looking at something', () => {
    const es = entries();
    expect(es.length, 'ledger entries scanned').toBeGreaterThanOrEqual(100);
    expect(new Set(es.map((e) => e.file)).size, 'plans scanned').toBeGreaterThanOrEqual(8);
  });

  it('every grandfathered number still collides — the set is re-derived, never nudged, and only shrinks', () => {
    const colliding = new Set(collisions().map(([n]) => n));
    for (const n of GRANDFATHERED) {
      expect(colliding.has(n), `D-${n} no longer collides — delete it from GRANDFATHERED`).toBe(true);
    }
    expect([...GRANDFATHERED].every((n) => n < 211),
      'an allocator-era number (>= 211) may NEVER be grandfathered').toBe(true);
  });

  it('every legacy per-plan ledger still exists — a removed file leaves the list', () => {
    const all = new Set(readdirSync(PLANS));
    for (const f of LEGACY_PER_PLAN_LEDGERS) {
      expect(all.has(f), `${f} is grandfathered but gone — remove its entry`).toBe(true);
    }
  });
});

// D13's other exposure: `sweepLedgerFloor` feeds docs/superpowers/{plans,specs}
// of each registry project to `floorFromScan`, and THIS repo is one of those
// projects — its own tracked docs are live seed input on the fleet. A fixture
// ref written contiguously (a 'D-' + '<n>' token with n far above the ledger)
// anywhere the scan can see would seed the first live floor thousands of
// numbers high, PERMANENTLY: the floor only ever rises. Fixture refs are
// therefore spelled split in tracked text — `D-${2611}` in test source,
// prefix-less numbers in plan prose — and this scan is the refusal that keeps
// it that way. It runs the REAL floorFromScan over the WHOLE tracked tree
// (163 ms measured, so no need to scope down to the sweep's own {plans,specs}
// classes — the wider net also guards test/source fixtures, which poison the
// hand-allocation grep the ledger convention prescribes).
describe('the floor seed reads THIS tree (D13 — fixtures must not poison it)', () => {
  const trackedFiles = (): { path: string; text: string }[] =>
    execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 1 << 22 })
      .toString('utf8').split('\0').filter(Boolean).sort()
      .map((f) => ({ path: f, text: readFileSync(path.join(ROOT, f), 'utf8') }));

  // Definition-SHAPED line prefixes, deliberately looser than ENTRY: the
  // build-9b ledger spells its entries `- **D-211** (Task 3): …` — colon, no
  // em-dash — which ENTRY cannot see (a collision-scan blindness noted where
  // this suite landed, not fixed here). For a MAX the prefix alone is enough:
  // it reads the number a heading/bullet line DEFINES, whatever its subject
  // punctuation.
  const DEFINED = /^(?:#{2,4} |- \*\*)D-(\d+)\b/;
  const definedMax = (): number => {
    let max = 0;
    for (const f of readdirSync(PLANS).filter((n) => n.endsWith('.md'))) {
      if (LEGACY_PER_PLAN_LEDGERS.has(f)) continue;
      for (const line of readFileSync(path.join(PLANS, f), 'utf8').split('\n')) {
        const m = DEFINED.exec(line);
        if (m) max = Math.max(max, Number(m[1]!));
      }
    }
    return max;
  };

  it('floorFromScan over the real tracked tree seeds from the ledger high-water, not a fixture', () => {
    // The expectation is DERIVED, not hand-kept: the high-water is the max n
    // across the plans' own Deviations definition lines (`definedMax`), so
    // this pin moves with each allocation on its own. The floor assertion
    // therefore also insists every tracked ref is LEDGERED — a source ref to
    // an allocated-but-unentered number reds here until its entry lands,
    // which is the direction the ledger discipline points anyway.
    const highWater = definedMax();
    expect(highWater, 'the definition-derived high-water went vacuous').toBeGreaterThanOrEqual(215);
    const scan = floorFromScan(trackedFiles());
    expect(scan, 'the tree seeds — an empty scan here means the docs moved').not.toBeNull();
    expect(scan!.floor,
      `a tracked file names a global D-ref above the ledger high-water D-${highWater} ` +
      `(${scan!.evidence}) — spell a fixture SPLIT ('D-' + '9876'), never contiguous, ` +
      `or the first live seed lands there forever`).toBe(highWater + LEDGER_SEED_GAP);
  });
});

describe('one deviation namespace — no bare legacy ref survives (9b W10, D14)', () => {
  // The reconciliation record (docs/superpowers/specs/
  // 2026-08-21-deviation-namespace-reconciliation.md) renamed every legacy
  // build-scoped ref into the global sequence, preserving each original as
  // an alias: `D-<n> (was <legacy>)` on first occurrence per file, bare
  // `D-<n>` after. This scanner is the ratchet that keeps the old namespace
  // from growing back: a ref immediately preceded by `was ` is an alias and
  // is licensed; any other spelling is a defect, named file-by-file below.
  //
  // The corpus is `git ls-files` from the repo root — the topology-clean
  // idiom: every tracked file, nothing registered by hand, so a new file
  // needs no wiring to be scanned. The liveness fixtures are assembled by
  // concatenation so this suite's own bytes carry no bare legacy form and
  // need no self-exclusion.
  const BARE = /(?<!was )\bD-B\d+-\d+\b/g;
  const ALIAS = /\bwas (D-B\d+-\d+)\b/g;

  interface LegacyCorpus { files: number; bare: Map<string, string[]>; aliasIds: Set<string> }
  let corpus: LegacyCorpus | null = null;
  const load = async (): Promise<LegacyCorpus> => {
    if (corpus) return corpus;
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    const { fileURLToPath } = await import('node:url');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const binary = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
      '.woff', '.woff2', '.ttf', '.otf', '.db', '.sqlite', '.pdf', '.zip', '.gz', '.tgz', '.wasm']);
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8').split('\0').filter(Boolean)
      .filter((f) => !binary.has(path.extname(f)));
    const bare = new Map<string, string[]>();
    const aliasIds = new Set<string>();
    let files = 0;
    for (const f of tracked) {
      let text: string;
      try { text = readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
      if (text.includes('\0')) continue;
      files += 1;
      const hits = [...text.matchAll(BARE)].map((m) => m[0]);
      if (hits.length > 0) bare.set(f, hits);
      for (const m of text.matchAll(ALIAS)) aliasIds.add(m[1]);
    }
    corpus = { files, bare, aliasIds };
    return corpus;
  };

  it('finds zero bare legacy refs anywhere git ls-files reaches', async () => {
    const c = await load();
    expect(Object.fromEntries(c.bare)).toEqual({});
  });

  it('is looking at the real tree — guards the guard', async () => {
    // 707 tracked files measured at reconciliation; the floor has margin so
    // ordinary growth or pruning never touches it, while a broken walk (a
    // wrong cwd, a filter eating everything) reds loudly and specifically
    // instead of letting the tree scan above pass over nothing.
    const c = await load();
    expect(c.files).toBeGreaterThan(600);
  });

  it('sees the alias corpus the reconciliation left behind', async () => {
    // 37 distinct legacy ids were reconciled (23 in the build-4 family, 14
    // in the build-8 family); the mapping table alone pins every one in
    // `was `-guarded form, so this set can only grow — and only if a further
    // legacy family is ever reconciled. If this reds at a small number while
    // the tree scan stays green, ALIAS has drifted from BARE: the scan has
    // gone vacuous, the tree is not clean.
    const c = await load();
    expect(c.aliasIds.size).toBeGreaterThanOrEqual(37);
  });

  it('the predicates themselves are live — fixtures assembled to not self-trip', async () => {
    const legacy = ['D-B4', '9'].join('-'); // a real reconciled id, in two pieces
    expect([...`see ${legacy} for the ruling`.matchAll(BARE)].length).toBe(1);
    expect([...`see D-${999} (was ${legacy})`.matchAll(BARE)].length).toBe(0);
    expect([...`(was ${legacy})`.matchAll(ALIAS)][0]?.[1]).toBe(legacy);
  });
});
