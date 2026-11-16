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
         LEDGER_ALLOCATOR_ERA, type Definition } from '../src/coord/ledger.js';
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
 *  211 is the first allocator-era number. EMPTY since D-8562: the 16 it held
 *  (72, 128–135, 137–141, 145, 171) were resolved by keeping the earlier merged
 *  definition, moving every later one to an issued number with a `was D-<old>`
 *  alias, and rewording the citations written in the definition shape
 *  (docs/superpowers/plans/2026-11-13-dnumber-collisions.md). Kept as a set so
 *  the rules below still read it; it may not grow back. */
const GRANDFATHERED: ReadonlySet<number> = new Set<number>([]);

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
    expect(es.length, `only ${es.length} ledger entries scanned`).toBeGreaterThanOrEqual(100);
    expect(new Set(es.map((e) => e.file)).size,
      `only ${new Set(es.map((e) => e.file)).size} plans scanned`).toBeGreaterThanOrEqual(8);
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
    expect(highWater,
      `the definition-derived high-water is ${highWater} — too low to be this tree's ledger`)
      .toBeGreaterThanOrEqual(215);
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
    // The floor has margin so ordinary growth or pruning never touches it, while
    // a broken walk (a wrong cwd, a filter eating everything) reds loudly and
    // specifically instead of letting the tree scan above pass over nothing. The
    // count that used to sit in this comment — "707 tracked files measured at
    // reconciliation" — is now in the message, where it is derived rather than
    // remembered: the walk read 824 on 2026-09-04, so a reader checking "the
    // floor has margin" against 707 was computing 15% where the true figure was
    // 27%.
    const c = await load();
    expect(c.files, `only ${c.files} tracked files walked — the corpus walk is broken`)
      .toBeGreaterThan(600);
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
  // D-2732: `'main'` was the third candidate, and on the fleet host local `main`
  // is a FOSSIL — measured 356 commits behind `origin/main`, parked by another
  // worktree that never moves it. With ~10 worktrees on one `.git`, a concurrent
  // fetch rewrites `packed-refs`, so `rev-parse --verify origin/main` can fail
  // TRANSIENTLY, which is how the chain reached that third candidate at all. The
  // fallback was silent, so the gate would compare this branch against a tree
  // hundreds of commits old and say nothing about which tree it read. An
  // unresolvable `origin/main` must reach the null-base refusal below instead:
  // "I could not measure" is an answer, "I measured a fossil" is not.
  const candidates = [process.env['CCRC_LEDGER_BASE'], 'origin/main']
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
      'no $CCRC_LEDGER_BASE or origin/main resolved (D-2732 removed the local-main fallback, which ' +
      'was a fossil): a shallow checkout cannot see the other ' +
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
    // D-2732: `>= 50` was the ONLY thing standing between a stale base and a
    // silently wrong comparison, and it is a hand-kept cardinal that passed at
    // 49-on-stale purely by arithmetic — the day the fossil also exceeds 50 it
    // stops catching anything. The property actually wanted is that the base is
    // an ANCESTOR of nothing this branch has not seen: a base the working tree
    // cannot reach is not a base. Kept alongside the counts, which still catch
    // the empty-list vacuity this pair was written for.
    const baseSha = execFileSync('git', ['rev-parse', '--short', LEDGER_BASE!],
      { cwd: ROOT, encoding: 'utf8' }).trim();
    // The property is NOT "the base is reachable from HEAD" — the fossil is
    // reachable, it is old main. It is "the base is not BEHIND `origin/main`":
    // `origin/main` must be an ancestor of whatever we are comparing against.
    // That admits `origin/main` itself and anything built on it, and refuses a
    // ref that predates it — which is the only way an explicit
    // `CCRC_LEDGER_BASE` can now hand this gate a stale tree, the silent
    // fallback having been removed above.
    const stale = ((): string | null => {
      try {
        execFileSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main^{commit}'],
          { cwd: ROOT, stdio: 'pipe' });
      } catch { return null; }   // no origin/main to compare against: not this test's call
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', 'origin/main', LEDGER_BASE!],
          { cwd: ROOT, stdio: 'pipe' });
        return null;
      } catch {
        const behind = execFileSync('git', ['rev-list', '--count', `${LEDGER_BASE!}..origin/main`],
          { cwd: ROOT, encoding: 'utf8' }).trim();
        return behind;
      }
    })();
    expect(stale,
      `the ledger base ${LEDGER_BASE} (${baseSha}) is ${stale ?? '?'} commits BEHIND origin/main — `
      + 'a collision report against it is about a tree nobody is merging into').toBeNull();
    expect(here.length, `only ${here.length} plans read from HEAD`).toBeGreaterThanOrEqual(50);
    expect(there.length,
      `only ${there.length} plans read from ${LEDGER_BASE} (${baseSha})`).toBeGreaterThanOrEqual(50);
    expect(definitionsIn(here).length,
      `HEAD holds only ${definitionsIn(here).length} ledger entries`).toBeGreaterThanOrEqual(300);
    expect(definitionsIn(there).length,
      `the base holds only ${definitionsIn(there).length} ledger entries`).toBeGreaterThanOrEqual(300);
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
    // The premise, established rather than assumed: a derivation that READ
    // nothing would be satisfied by any claim that named nothing. Until D-8562
    // the premise was a non-empty derived set; D-8562 resolved every sub-211
    // collision, so the derived set and the marker are both EMPTY, and the
    // premise is now that the derivation saw the pre-allocator era at all: it
    // read well over a hundred distinct sub-211 definitions (measured: 124 at
    // D-8562), so an empty answer is a measurement, not a blind scan.
    const sub211 = [...byN.keys()].filter((n) => n < LEDGER_ALLOCATOR_ERA).length;
    expect(sub211,
      `the derivation read only ${sub211} distinct sub-211 definitions — a scan that reads none ` +
      'asserts nothing').toBeGreaterThanOrEqual(100);
    expect(derived,
      'a sub-211 collision is back: GRANDFATHERED is empty since D-8562, and the era it protected is ' +
      'resolved — renumber the later definition to an issued number').toEqual([]);
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

  // D-1434. A messaged floor assertion whose message says the
  // scan read nothing, while the floor is 50, reds for 1..49 as well as for 0 —
  // so in 49 of its 50 failing states the message is a false statement about
  // what happened, and the reader of a CI log has only the message.
  //
  // NO EXAMPLE CALL IS SPELLED IN THIS COMMENT, deliberately: this scan reads its
  // own file, and an illustrative `expect(…).toBeGreaterThanOrEqual(50)` written
  // out here would be matched by the regex below and would keep the guard red
  // forever. Measured — the first draft of this comment did exactly that.
  //
  // The rule is scoped so it never asks for churn where the message is already
  // exact: when the floor is an integer literal >= 2 the failing set is wide, so
  // the message must carry the measured value. A floor of 0 reds only on
  // emptiness, and a comparison against another measured quantity states its own
  // condition; both are left alone.
  //
  // KNOWN LIMIT, stated where a CI reader sees it rather than only in a plan: the
  // regex requires the message to sit on ONE line, so an assertion whose message
  // is built by concatenation across lines is invisible to this scan. REQUIRED
  // below is what stops that from degrading silently — it names the assertions
  // this rule was measured against, so losing one reds by name instead of just
  // lowering a count.
  it('every wide floor assertion in this file reports the value it measured', () => {
    const SELF = readFileSync(path.join(here, 'deviation-refs.test.ts'), 'utf8');
    const FLOOR = /expect\(\s*([^,\n]+?),\s*(['"`])([^\n]*?)\2\s*\)\s*\.toBeGreaterThan(?:OrEqual)?\(\s*(\d+)\s*\)/g;
    const wide = [...SELF.matchAll(FLOOR)].filter((m) => Number(m[4]) >= 2);
    const seen = wide.map((m) => `${m[1]!.trim()} >= ${m[4]}`);
    const REQUIRED = [
      'es.length >= 100',
      'new Set(es.map((e) => e.file)).size >= 8',
      'highWater >= 215',
      'here.length >= 50',
      'there.length >= 50',
      'definitionsIn(here).length >= 300',
      'definitionsIn(there).length >= 300',
    ];
    // The premise, established rather than assumed: a scan that had drifted off
    // its own file would find nothing and every assertion below it would hold.
    expect(REQUIRED.filter((r) => !seen.includes(r)),
      `this scan no longer sees assertions it was written for; it found: ${seen.join(' | ')}`)
      .toEqual([]);
    const mute = wide
      .filter((m) => !m[3]!.includes('${' + m[1]!.trim() + '}'))
      .map((m) => `${m[1]!.trim()} >= ${m[4]} :: ${m[3]}`);
    expect(mute,
      'a floor assertion states a condition it does not isolate — put the measured value in the message')
      .toEqual([]);
  });
});


/* ── Task C33: a definition the ledger cannot read is not a definition ────── */

// `DEFINITION` (server/src/coord/ledger.ts) reads an entry only when the bold
// number is followed by an em dash, a parenthesis or a colon. An entry written
// any other way, `- **D-N** - slug` (the hyphen form) or a backtick slug straight
// after the bold number, is invisible to the cross-tree scan above AND to the
// server's reconcile sweep, so its number never lands and a second definition of
// it is never caught. The desktop-polish plan held 112 hyphen entries; Task C33
// converted 108 of them to the em-dash form, and its follow-up C33b converts the
// last four (see UNREAD_BASELINE). DEFINITION's grammar stays as it is.
//
// THE SHAPE is a bullet whose bold closes right after the number, at column 0:
// `- **D-N**`. It is narrower than `DEFINED`'s prefix on purpose: `- **D-149
// sweep:**` and `- **D-1039..D-1045**` are bolded citations the corpus rows
// above pin, and they stay out of it.
//
// FENCE-AWARE through the one owner of the fence rule. A quoted line inside a
// fenced block is not an entry (D-1323), and the only code that knows which
// lines are fenced is `definitionsIn`. So each candidate line is replaced by the
// em-dash spelling of its own number and the file is read again: if that adds a
// definition, the line sits where the reader looks, and it is flagged. No second
// fence parser is written here.
const DEFINITION_SHAPE = /^- \*\*D-(\d+)\*\*/;

/** Definition-shaped lines `DEFINITION` does not read, as `file -> numbers`, one
 *  number per line (so a number unreadable on two lines appears twice). */
function unreadDefinitionShapes(
  files: readonly { readonly path: string; readonly text: string }[],
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const f of files) {
    const lines = f.text.split('\n');
    let before: Definition[] | null = null;   // the file as written, read once per file
    for (let i = 0; i < lines.length; i++) {
      const m = DEFINITION_SHAPE.exec(lines[i]!);
      if (!m) continue;
      // A shortcut, not a rule: the probe below gives a readable line the same answer,
      // but it re-reads the whole file, and most shaped lines are readable.
      if (definitionsIn([{ path: f.path, text: lines[i]! }]).length > 0) continue;
      const n = Number(m[1]);
      const count = (ds: readonly Definition[]): number => ds.filter((d) => d.n === n).length;
      before ??= definitionsIn([f]);
      const probe = [...lines];
      probe[i] = `- **D-${n}** — probe`;
      if (count(definitionsIn([{ path: f.path, text: probe.join('\n') }])) <= count(before)) {
        continue;   // fenced: a quotation
      }
      out.set(f.path, [...(out.get(f.path) ?? []), n]);
    }
  }
  return out;
}

/** The unreadable lines plans hold, measured on origin/main at 649ac3f13 by Task
 *  C33 (docs/superpowers/plans/2026-10-22-desktop-polish/c33.md): 175 lines in 14
 *  plans, plus the four hyphen entries C33 leaves for C33b. Of the 175, 170 are a
 *  backtick slug straight after the bold number, and five are prose that opens with
 *  the bold number (`- **D-N** is the rule below`, `- **D-N** stays unused`).
 *  Bare numbers, not `D-` refs, so the floor scan reads nothing here.
 *  MAY ONLY SHRINK: a plan that converts a line removes its number here, and a
 *  number listed here that no longer stands unreadable reds below until it is
 *  removed. Nothing may join: a new unreadable line is written readable instead. */
const UNREAD_BASELINE: ReadonlyMap<string, readonly number[]> = new Map<string, readonly number[]>([
  ['2026-10-01-native-docs-reader-w1-ccd-reads-docs.md', [4150, 4151, 4152, 4153, 4154, 4155, 4156, 4157, 4158, 4159, 4160, 4161, 4162, 4163, 4164]],
  ['2026-10-01-workspace-lifecycle-wave2-one-archive.md', [3836, 3837, 3838, 3839, 3840, 3841, 3842, 3843, 3844, 3845, 3866, 3867, 3868, 3869, 3870, 3877, 3878, 3879, 3880, 3881]],
  ['2026-10-04-session-continuity-wave3-operator-choice.md', [3896, 3897, 3898, 3899, 3900, 3901, 3902, 3903, 3904, 3905, 3921, 3922, 3923, 3924, 3925, 3966, 3967, 3968, 3969]],
  ['2026-10-04-workspace-lifecycle-wave3-ws-expire.md', [3886, 3887, 3888, 3889, 3890, 3891, 3892, 3893, 3894, 3895, 3958, 3959, 3960, 3961, 3962, 3963, 3964, 3965]],
  ['2026-10-05-session-continuity-wave4-scope-sweep.md', [4012, 4013, 4014, 4015, 4016, 4017, 4018, 4019, 4020, 4021, 4088, 4089, 4090, 4091, 4092, 4093]],
  ['2026-10-06-child-reclamation-wave6-reclaim-repairs.md', [4126, 4127, 4128, 4129, 4130, 4131, 4132, 4133, 4134, 4135, 4136, 4137, 4138, 4139, 4140, 4141, 4142, 4143, 4144, 4145, 4146, 4147, 4148, 4149, 4455, 4456, 4457, 4458, 4459, 4460, 4461, 4462]],
  ['2026-10-06-workspace-lifecycle-wave3b-expiry-lane.md', [4114, 4115, 4116, 4117, 4118, 4119, 4120, 4121, 4122, 4123, 4124, 4125]],
  ['2026-10-07-workspace-lifecycle-wave4-dead-coordinator-lane.md', [4348, 4349, 4350, 4351, 4352, 4353, 4354, 4355, 4356, 4357, 4358, 4359, 4360, 4361, 4362, 4363, 4430, 4431, 4432, 4433, 4454]],
  ['2026-10-08-carry-link-via-mount.md', [4500, 4501]],
  ['2026-10-08-workspace-lifecycle-wave5-residue-and-expiry-follow-ups.md', [4480, 4481, 4482, 4483, 4484, 4485, 4486, 4487, 4488, 4489, 4490, 4491, 4492, 4493, 4494]],
  ['2026-10-20-ci-shards-nested-leak.md', [6112]],
  // 7153 and 7253 are prose. 8344, 8345, 8354 and 8381 are hyphen entries that C33 left
  // in place: on origin/main their task notes (c27.md to c30.md) still define them, so
  // converting them here reads as one definition each side of the cross-tree scan. The
  // follow-up C33b converts the four and removes them from this row once C33 has merged.
  ['2026-10-22-desktop-polish.md', [7153, 7253, 8344, 8345, 8354, 8381]],
  ['2026-10-23-centralised-update-w24-settings-live-in-ccrc-config.md', [6605]],
  ['2026-10-26-orphan-census-truncation.md', [7867]],
]);

/** `a` less `b`, counting repeats: what `a` holds that `b` does not cover. */
function multisetLess(a: readonly number[], b: readonly number[]): number[] {
  const left = [...b];
  const out: number[] = [];
  for (const n of a) {
    const at = left.indexOf(n);
    if (at === -1) out.push(n); else left.splice(at, 1);
  }
  return out;
}

describe('every definition-shaped line is one the ledger reads (Task C33)', () => {
  it('no plan holds an unreadable `- **D-N**` line beyond the baseline', () => {
    const got = unreadDefinitionShapes(plansAt('HEAD'));
    const fresh = [...got.entries()]
      .map(([file, ns]) => [file, multisetLess(ns, UNREAD_BASELINE.get(file) ?? [])] as const)
      .filter(([, ns]) => ns.length > 0)
      .map(([file, ns]) => `${file}: ${ns.map((n) => `D-${n}`).join(', ')}`);
    expect(fresh,
      'a definition-shaped line DEFINITION (server/src/coord/ledger.ts) cannot read, so the ' +
      'ledger never sees the number. Write the entry as `- **D-N** — subject` (an em dash), or ' +
      '`- **D-N** (…)` or `- **D-N**: …`; a line that only cites the number must not open with it in bold')
      .toEqual([]);
  });

  it('every baseline number still stands unreadable — the baseline only shrinks', () => {
    const got = unreadDefinitionShapes(plansAt('HEAD'));
    const stale = [...UNREAD_BASELINE.entries()]
      .map(([file, ns]) => [file, multisetLess(ns, got.get(file) ?? [])] as const)
      .filter(([, ns]) => ns.length > 0)
      .map(([file, ns]) => `${file}: ${ns.join(', ')}`);
    expect(stale, 'these baseline lines are readable now, or gone: delete them from UNREAD_BASELINE')
      .toEqual([]);
  });

  it('the shape reader flags the forms it exists for, and only those', () => {
    const n = 7000 + 1;   // a fixture number, spelled so the floor scan never reads it
    const one = (text: string): number[] =>
      unreadDefinitionShapes([{ path: 'fixture.md', text }]).get('fixture.md') ?? [];
    expect(one(`- **D-${n}** - \`a-slug\`: the hyphen form`)).toEqual([n]);
    expect(one(`- **D-${n}** \`a-slug\` (Task 1) — the backtick form`)).toEqual([n]);
    expect(one(`- **D-${n}** — \`a-slug\`: the convention`)).toEqual([]);
    expect(one(`- **D-${n}** (issued to this task): a parenthesis`)).toEqual([]);
    expect(one(`- **D-${n}**: a colon`)).toEqual([]);
    expect(one(`- Issued to this task, **D-${n}**: a citation`)).toEqual([]);
    expect(one(`- **D-${n} sweep:** a bolded citation`)).toEqual([]);
    expect(one(['```', `- **D-${n}** - quoted inside a fence`, '```'].join('\n'))).toEqual([]);
    expect(one(['```', '```', `- **D-${n}** - after a closed fence`].join('\n'))).toEqual([n]);
    // A number unreadable on two lines counts twice, so a baseline that lists it once
    // still reds on the second line.
    expect(one([`- **D-${n}** - one`, `- **D-${n}** - two`].join('\n'))).toEqual([n, n]);
    expect(multisetLess([n, n], [n])).toEqual([n]);
    expect(multisetLess([n], [n, n])).toEqual([]);
  });
});
