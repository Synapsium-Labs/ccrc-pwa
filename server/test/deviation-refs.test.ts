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
import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crossTreeCollisions, definitionsIn, floorFromScan,
         LEDGER_ALLOCATOR_ERA } from '../src/coord/ledger.js';
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
// live FLOOR: one contiguous ref seeds it thousands of numbers high, and it
// only rises).
describe('the floor seed reads THIS tree (D13 — fixtures must not poison it)', () => {
  const trackedFiles = (): { path: string; text: string }[] =>
    execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 1 << 22 })
      .toString('utf8').split('\0').filter(Boolean).sort()
      .map((f) => ({ path: f, text: readFileSync(path.join(ROOT, f), 'utf8') }));

  // Definition-SHAPED line prefixes, deliberately looser than ENTRY: this repo's
  // ledgers hold entries spelled `- **D-190** (Task 1): the session-id
  // pattern shipped …` — colon, no em-dash — which ENTRY cannot see. For a MAX
  // the prefix alone is enough: it reads the number a heading/bullet line
  // DEFINES, whatever its subject punctuation.
  //
  // THE EXEMPLAR THIS COMMENT FIRST GAVE WAS REFUTED (D-1329, whose retraction
  // reached `server/src/coord/ledger.ts` and not this file). It named build 9b;
  // measured, that plan's D-211 entry is the EM-DASH form and the plan holds zero
  // ENTRY-blind entries — a claim the corpus table below already refuted, and
  // passed while refuting. The line break in the quoted spelling above is
  // deliberate: the contiguous string is a needle in that table, and this repo's
  // own plans are part of the corpus it scans.
  // COLON-FORM EXEMPLAR: 2026-08-23-stage5-oss-polish.md
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

/* ── F7: the same collision, one merge EARLIER ─────────────────────────────── */

/** The base this branch's ledger is measured against — `topology-clean.test.ts`'s
 *  own `resolveBase`, for its own reason. Returns null rather than guessing, and
 *  the first row below turns that null RED: a shallow `actions/checkout` (depth 1,
 *  where `origin/main` does not exist) is exactly how this guard would come to
 *  measure nothing while reporting green. CI carries `fetch-depth: 0` already. */
function resolveLedgerBase(cwd: string): string | null {
  const candidates = [process.env['CCRC_LEDGER_BASE'], 'origin/main', 'main']
    .filter((r): r is string => Boolean(r));
  for (const ref of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
        { cwd, stdio: 'pipe' });
      return ref;
    } catch { /* try the next candidate */ }
  }
  return null;
}

const LEDGER_BASE = resolveLedgerBase(ROOT);

/** `docs/superpowers/plans/*.md` as a given REF holds them, without checking it
 *  out and without merging it. One `ls-tree` plus one `cat-file` per plan;
 *  measured at ~0.4 s for 67 files, against the 163 ms this file's floor scan
 *  already spends walking the whole tracked tree. */
const plansCache = new Map<string, { path: string; text: string }[]>();
const plansAt = (ref: string): { path: string; text: string }[] => {
  // Memoised per ref. A ref does not move during a run, and the corpus
  // classification table below asks for HEAD once per row — nine `ls-tree` walks
  // for one answer, on a suite that already sits next to the known load flakes.
  const hit = plansCache.get(ref);
  if (hit !== undefined) return hit;
  const out = readPlansAt(ref);
  plansCache.set(ref, out);
  return out;
};

const readPlansAt = (ref: string): { path: string; text: string }[] => {
  const listing = execFileSync('git',
    ['ls-tree', '-r', '--format=%(objectname) %(path)', ref, 'docs/superpowers/plans/'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 22 });
  const out: { path: string; text: string }[] = [];
  for (const line of listing.split('\n').filter(Boolean)) {
    const sp = line.indexOf(' ');
    const sha = line.slice(0, sp);
    const file = line.slice(sp + 1).split('/').pop()!;
    if (!file.endsWith('.md') || LEGACY_PER_PLAN_LEDGERS.has(file)) continue;
    out.push({ path: file,
      text: execFileSync('git', ['cat-file', 'blob', sha],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 }) });
  }
  return out;
};

describe('the cross-tree collision scan (F7 — before the merge, not after)', () => {
  // WHY THIS EXISTS, and why it is not the scan above with a wider net.
  //
  // `collisions()` reads ONE checkout. Branch A defines D-1157 in its plan and
  // branch B defines D-1157 in its own; each checkout holds exactly one of the
  // two, so the suite is green on BOTH branches simultaneously, and green on
  // whichever merges first. The pair co-resides only once the loser merges the
  // winner — one merge too late, when the only remedy left is renumbering.
  // That has now happened more than once (D-1157/1158 via PR #38, D-1159/1160/1161
  // via PR #41 — the tree counts the class differently in different places, so the
  // count is deliberately not restated here), and the detection procedure the
  // coordinator actually used both times was a human cloning the tip, merging
  // origin/main and running this file.
  //
  // MEASURED BEFORE IT WAS WRITTEN, against both real incidents, from the branch
  // alone and with no merge (D-1295):
  //   eee5fa1a vs 47ac50da -> 3 hits: D-1159, D-1160, D-1161
  //   d620abe8 vs d3de4ec7 -> 2 hits: D-1157 AND D-1158
  //   HEAD     vs origin/main -> 0
  // D-1158 is the one the existing scan can never report at all: its definition
  // line wraps its subject, which `ENTRY` cannot match (D-1294).
  it('resolved a base to measure against — a missing one is RED, never vacuous', () => {
    expect(LEDGER_BASE,
      'no $CCRC_LEDGER_BASE, origin/main or main resolved: a shallow checkout cannot see the other ' +
      'tree, and this refuses to report a comparison nobody made')
      .not.toBeNull();
  });

  it('names the base it actually measured, so a STALE one is visible', () => {
    // The guard's load-bearing precondition is the one thing it cannot enforce:
    // `resolveLedgerBase` proves a ref RESOLVES, never that it is current, and a
    // test may not fetch. Measured on this program's own incident: `eee5fa1a` vs
    // `47ac50da` reports three collisions; against `ff85c514` — ONE commit staler
    // — it reports zero. So a pass here means "no collision against the
    // origin/main THIS CHECKOUT HAS FETCHED", and the sha is what tells a reader
    // which claim they are getting.
    const sha = execFileSync('git', ['rev-parse', '--short', LEDGER_BASE!],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(sha, `the base ${LEDGER_BASE} resolved to nothing`).toMatch(/^[0-9a-f]{7,}$/);
  });

  it('is looking at two real trees, each with a real ledger in it', () => {
    // The anti-vacuity partner. `crossTreeCollisions` over two empty lists is
    // [], which satisfies the assertion below for entirely the wrong reason.
    const here = plansAt('HEAD');
    const there = plansAt(LEDGER_BASE!);
    expect(here.length, 'no plans read from HEAD').toBeGreaterThanOrEqual(50);
    expect(there.length, `no plans read from ${LEDGER_BASE}`).toBeGreaterThanOrEqual(50);
    expect(definitionsIn(here).length, 'HEAD holds no ledger entries').toBeGreaterThanOrEqual(300);
    expect(definitionsIn(there).length, 'the base holds no ledger entries').toBeGreaterThanOrEqual(300);
  });

  it('no allocator-era D-<n> is defined in two plans across this branch and its base', () => {
    const here = plansAt('HEAD');
    const there = plansAt(LEDGER_BASE!);
    const hits = crossTreeCollisions(here, there);
    // PROVENANCE, because the remedy depends on it and the first draft assumed
    // one. `crossTreeCollisions` unions the two trees and forgets which side each
    // file came from, so a collision living ENTIRELY on the base — the state this
    // program reached three times, kept off main only because each merge
    // renumbered first — read as "this branch defines...", a false claim with a
    // remedy the author cannot perform.
    const mine = new Set(definitionsIn(here).map((d) => d.file));
    const theirs = new Set(definitionsIn(there).map((d) => d.file));
    const described = hits.map((c) => {
      const onBranch = c.files.filter((f) => mine.has(f)).length;
      const onBase = c.files.filter((f) => theirs.has(f)).length;
      const where = onBranch === 0 ? 'BOTH ON THE BASE — not this branch to fix'
        : onBase === 0 ? 'both on this branch'
        : 'one each side';
      return `D-${c.n} (${where}): ${c.files.join(' / ')}`;
    });
    expect(described,
      `measured against ${LEDGER_BASE}. A number defined in two different plans across the two ` +
      'trees. If one side is this branch and the other the base: allocate fresh numbers through ' +
      'POST /api/ledger/deviations and renumber NOW, before the merge decides it for you. TWO ' +
      'KNOWN FALSE POSITIVES, check both before renumbering anything — (1) a plan RENAMED, or its ' +
      'entries MOVED between files, on this branch: file identity here is the basename, so the ' +
      'same entries under two names read as two definitions and the right action is to change ' +
      'nothing; (2) anything marked BOTH ON THE BASE, which is already on main and is not this ' +
      'branch to renumber.')
      .toEqual([]);
  });

  // THE GUARD ON THE GUARD, and the only row that proves this scan can FAIL.
  // Everything above asserts an empty list, which an implementation that always
  // returned [] would satisfy forever. These two pairs are this program's own
  // history — the exact branch/base tips of the two incidents — so the scan is
  // measured against collisions that really happened rather than against
  // fixtures, and it can never quietly become a no-op.
  //
  // The shas are permanent history on this repo: two are ancestors of this
  // branch, two are on main. A checkout that cannot resolve them is shallow, and
  // that reds here rather than silently skipping — the same polarity as the base
  // resolution above.
  describe.each([
    ['PR #41', 'eee5fa1a', '47ac50da', [1159, 1160, 1161]],
    ['PR #38', 'd620abe8', 'd3de4ec7', [1157, 1158]],
  ] as const)('fires on the %s incident, from the branch alone', (_name, branch, base, expected) => {
    it(`reports D-${expected.join('/D-')} without merging anything`, () => {
      for (const ref of [branch, base]) {
        expect(() => execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
          { cwd: ROOT, stdio: 'pipe' }), `${ref} is unreachable — this checkout is too shallow to ` +
          'prove the scan fires, and a guard that cannot be shown to fail is not a guard').not.toThrow();
      }
      const hits = crossTreeCollisions(plansAt(branch), plansAt(base));
      expect(hits.map((h) => h.n)).toEqual([...expected]);
      // Each hit names two DIFFERENT plans — the shape of the defect, not just
      // its number.
      for (const h of hits) expect(h.files.length).toBeGreaterThanOrEqual(2);
    });
  });

  // D-1322: the classification, checked against lines that are really in the
  // corpus rather than against fixtures a test author invented. Each row names a
  // substring; the row FAILS if no plan at HEAD contains a line holding it, which
  // is what keeps this from becoming an assertion about prose nobody writes any
  // more. The line is then classified on its own, as a one-line file, so a
  // number the same plan legitimately defines elsewhere cannot mask the answer.
  describe.each([
    ['citation', 'D-149 sweep:'],
    ['citation', 'D-172, D-173 and D-174 were re-used'],
    ['citation', 'D-171 was landed twice'],
    ['citation', 'D-1026 changes the shape the operator approved'],
    ['citation', 'D-1039..D-1045'],
    ['citation', 'D-1012 .. D-1019'],
    ['definition', 'D-297 — the `_spawn` split demoted'],
    ['definition', 'D-99 — the remote-control switch is a FILE'],
    ['definition', "D-211** (Task 3) — the plan's red-first step"],
    ['definition', 'D-190** (Task 1): the session-id pattern'],
    ['definition', 'D-301 (was D-B8-5)' + ' — four guards were decorated'],
    ['citation', "D-291's wait — `startedSessionFor`"],
  ] as const)('classifies the corpus line %s: %s', (kind, needle) => {
    it(`is read as a ${kind}`, () => {
      const found: string[] = [];
      for (const p of plansAt('HEAD')) {
        for (const line of p.text.split('\n')) if (line.includes(needle)) found.push(line);
      }
      // The premise, established rather than assumed: if the shape has left the
      // corpus this row is measuring nothing and must say so.
      expect(found.length, `no line at HEAD contains "${needle}" — this row asserts nothing`)
        .toBeGreaterThan(0);
      for (const line of found) {
        const got = definitionsIn([{ path: 'one-line.md', text: line }]);
        expect(got.length > 0, `${kind} expected, got ${got.length} definition(s) from: ${line.slice(0, 90)}`)
          .toBe(kind === 'definition');
      }
    });
  });

  // D-1431. The `auth-gate.test.ts` idiom — read the claim OUT of
  // the source file and check it against the thing it claims about — which is
  // the only mechanism in this area that has ever stopped a false claim from
  // re-entering. D-1329 retracted "build 9b spells its entries with a colon and
  // no em-dash"; the retraction reached ledger.ts only, so at 5e9f650d two
  // suites asserted the refuted exemplar while the corpus row for that very line
  // pinned the em-dash spelling and passed.
  //
  // THE NEEDLE IS SPELLED SPLIT, and that is not decoration: this scan reads its
  // OWN file, so a contiguous tag matches its own call site and the "one marker
  // per suite" check fires on a file that is perfectly correct. Measured — the
  // first draft of this test did exactly that, which is the same trap
  // `auth-gate.test.ts`'s own header records springing on all three of its
  // needles, first run.
  //
  // No cardinal is asserted: the counts move with the corpus. The PROPERTY is
  // that the plan each marker names holds at least one entry `DEFINITION` reads
  // and `ENTRY` cannot, and that at least one of those is the COLON spelling
  // rather than the WRAPPED em-dash — a different blindness with its own test.
  it('the colon-form exemplar these suites name really is colon-form, and really ENTRY-blind', () => {
    const TAG = 'COLON-FORM ' + 'EXEMPLAR: ';
    const MARKER = new RegExp(TAG + '(\\S+\\.md)');
    const SUITES = ['deviation-refs.test.ts', 'ledger-crosstree.test.ts'];
    const named = SUITES.flatMap((suite) =>
      readFileSync(path.join(here, suite), 'utf8').split('\n')
        .map((l) => MARKER.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [suite, m[1]!] as [string, string]));
    expect(named.map(([s]) => s),
      `expected one exemplar marker in each of ${SUITES.join(', ')}, found ` +
      `${named.length}: ${named.map(([s, p]) => `${s} -> ${p}`).join(', ')}`).toEqual(SUITES);

    const plans = plansAt('HEAD');
    for (const [suite, plan] of named) {
      const hit = plans.find((p) => p.path === plan);
      expect(hit, `${suite} names ${plan}, which the scanned corpus does not hold`).toBeDefined();
      // Fence-aware: a line only counts if the number it opens is also a real
      // definition of the whole file, so a quoted entry cannot stand in.
      const defined = new Set(definitionsIn([hit!]).map((d) => d.n));
      const blind = hit!.text.split('\n').filter((line) => {
        const one = definitionsIn([{ path: 'one-line.md', text: line }]);
        return one.length === 1 && defined.has(one[0]!.n) && ENTRY.exec(line) === null;
      });
      expect(blind.length,
        `${suite} names ${plan} as the exemplar of the form ENTRY cannot see, but that plan holds ` +
        `${blind.length} such entries out of ${defined.size} definitions`).toBeGreaterThan(0);
      const colon = blind.filter((line) => !line.includes('—'));
      expect(colon.length,
        `${suite} names ${plan} as the colon-spelling exemplar, but all ${blind.length} of its ` +
        'ENTRY-blind entries carry an em-dash — that is the WRAPPED form, a different blindness')
        .toBeGreaterThan(0);
    }
  });

  // D-1433. The era-scoping argument's own data points. D-1310 found
  // that two of the six sub-211 collisions cited for it (D-149, D-172) were
  // never collisions — they are line-initial bolded CITATIONS, and the shipped
  // DEFINITION drops both — so the argument rests on four. That correction
  // landed in D-1310's entry and in D-1320's, and never in the test file the
  // argument ships in. Derived here rather than remembered, in the
  // `auth-gate.test.ts` idiom: read the claim out of the source, check it
  // against the corpus. No split needle is needed — this scan reads the OTHER
  // file, never its own.
  it('the era-scoping comment names the sub-211 collision set this corpus derives', () => {
    const CROSSTREE = readFileSync(path.join(here, 'ledger-crosstree.test.ts'), 'utf8');
    const claim = CROSSTREE.split('\n').filter((l) => l.includes('SUB-211 COLLISIONS:'));
    expect(claim.length,
      'expected exactly one line marked SUB-211 COLLISIONS: in ledger-crosstree.test.ts, found ' +
      `${claim.length}`).toBe(1);
    const claimed = [...claim[0]!.matchAll(/D-(\d+)/g)].map((m) => Number(m[1]));

    const byN = new Map<number, Set<string>>();
    for (const d of definitionsIn(plansAt('HEAD'))) {
      byN.set(d.n, (byN.get(d.n) ?? new Set<string>()).add(d.file));
    }
    const derived = [...byN.entries()]
      .filter(([n, files]) => n < LEDGER_ALLOCATOR_ERA && files.size > 1 && !GRANDFATHERED.has(n))
      .map(([n]) => n).sort((a, b) => a - b);
    // The premise, established rather than assumed: a derivation that found
    // nothing would be satisfied by any claim that named nothing.
    expect(derived.length,
      `the derivation found ${derived.length} sub-211 collisions outside GRANDFATHERED — a scan that ` +
      'finds none asserts nothing').toBeGreaterThan(0);
    expect(claimed,
      'the comment names a sub-211 collision set this corpus does not derive').toEqual(derived);
  });

  it('sees MORE than the subject-based scan above — the two are not redundant', () => {
    // The proof that this arm is worth its runtime: the wrapped/colon forms
    // `ENTRY` cannot match are real and present in this very tree.
    const here = plansAt('HEAD');
    const loose = definitionsIn(here).length;
    const strict = entries().length;
    expect(loose, 'the loose scan sees no more than ENTRY — one of them has drifted')
      .toBeGreaterThan(strict);
  });
});

