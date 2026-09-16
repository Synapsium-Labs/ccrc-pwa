import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardPlacement, foldCoordPlacements, type CoordPlacementStamp, type CoordStamp }
  from '../src/coord/placement.js';

/** The walk is SESSION-keyed (D-2921), so a fixture states a table of session
 *  id -> that session's own newest stamp. `stamp(project, coordinatorSession)`
 *  keeps the two facts that ride together in one place. */
const stamp = (coordProject: string, claimedBy: string | null = null): CoordStamp =>
  ({ coordProject, claimedBy });

const tableOf = (t: Record<string, CoordStamp>) =>
  (id: string): CoordStamp | null => t[id] ?? null;

const base = {
  sessionId: 'custom-tools-amber-delta',
  ownProject: 'custom-tools',
  held: true,
  stampOf: (_id: string): CoordStamp | null => null,
};

describe('boardPlacement', () => {
  it('places a held worker on its run\u2019s stamped coordinator project', () => {
    expect(boardPlacement({
      ...base,
      stampOf: tableOf({ 'custom-tools-amber-delta': stamp('intake-platform', 'intake-coord') }),
    })).toBe('intake-platform');
  });

  it('falls back to its own project when the run carries no stamp', () => {
    expect(boardPlacement({ ...base })).toBe('custom-tools');
  });

  it('falls back to its own project when the workspace is NOT held', () => {
    expect(boardPlacement({
      ...base, held: false,
      stampOf: tableOf({ 'custom-tools-amber-delta': stamp('intake-platform', 'intake-coord') }),
    })).toBe('custom-tools');
  });

  it('never places a session under a run it coordinates ITSELF', () => {
    // Exact, not approximate (D-2921): the claimant IS this session id. The
    // old project-keyed form could only notice "the stamped PROJECT equals my
    // own", which is a different and weaker question — and it answered
    // `ownProject` for a session legitimately coordinated from its own project
    // by SOMEONE ELSE, which is the common case, not the degenerate one.
    //
    // The CALL COUNT is the pin on the `new Set([input.sessionId])` seed, and
    // it is the only pin available: session-keyed, the seed cannot change the
    // RETURN value at all. Drop it and the walk merely takes one more lookup —
    // `at` is already `sessionId`, so the next iteration adds it to `seen` and
    // the general revisit check catches the same cycle one hop later, still
    // answering `ownProject`. What the seed buys is an IMMEDIATE, exact answer
    // on the one shape that is not a cycle at all: a session that coordinates
    // itself. Stated here rather than asserted twice.
    let calls = 0;
    const stampOf = (id: string): CoordStamp | null => {
      calls++;
      return id === 'custom-tools-amber-delta'
        ? stamp('somewhere-else', 'custom-tools-amber-delta') : null;
    };
    expect(boardPlacement({ ...base, stampOf })).toBe('custom-tools');
    expect(calls).toBe(1);          // 2 if the `seen` seed goes
  });

  // ------------------------------------------------------------------
  // FINAL WHOLE-BRANCH REVIEW, Critical 1 (D-2921). The two shapes no fixture
  // in this file could express while the hop was PROJECT-keyed: the stamped
  // coordinator's project is also a project that hosts an ordinary same-repo
  // programme. Session-keyed, the presence of that other programme is inert,
  // which is exactly the claim.
  // ------------------------------------------------------------------

  it('is unmoved by an ordinary programme running INSIDE the coordinator\u2019s own project', () => {
    expect(boardPlacement({
      ...base,
      stampOf: tableOf({
        'custom-tools-amber-delta': stamp('ccrc-pwa', 'ccrc-pwa-amber-summit'),
        // an ordinary ccrc-pwa programme: a ccrc-pwa worker, a ccrc-pwa
        // coordinator. Under a project-keyed hop this said "ccrc-pwa
        // coordinates ccrc-pwa" and sent the row home.
        'ccrc-pwa-worker': stamp('ccrc-pwa', 'ccrc-pwa-swift-mesa'),
      }),
    })).toBe('ccrc-pwa');
  });

  it('is never lifted onto a card that never coordinated it', () => {
    expect(boardPlacement({
      ...base,
      stampOf: tableOf({
        'custom-tools-amber-delta': stamp('intake-platform', 'intake-platform-keen-meadow'),
        // an unrelated programme whose WORK is in intake-platform and whose
        // coordinator is in ccrc-pwa. Project-keyed, this read as "ccrc-pwa
        // coordinates intake-platform" and walked the row one card too far.
        'intake-worker': stamp('ccrc-pwa', 'ccrc-pwa-amber-summit'),
      }),
    })).toBe('intake-platform');
  });

  it('walks a chain to the ROOT coordinator', () => {
    // W is coordinated by `mid-session` (project `mid`), and `mid-session` is
    // itself a worker coordinated by `root-session` (project `root`).
    expect(boardPlacement({
      ...base,
      stampOf: tableOf({
        'custom-tools-amber-delta': stamp('mid', 'mid-session'),
        'mid-session': stamp('root', 'root-session'),
      }),
    })).toBe('root');
  });

  it('settles on the measured project when the stamp names no claimant', () => {
    // A stamped project with a NULL `claimedBy` — the answer is known, the next
    // question is not askable. Settling beats both guessing and going home.
    expect(boardPlacement({
      ...base,
      stampOf: tableOf({ 'custom-tools-amber-delta': stamp('intake-platform', null) }),
    })).toBe('intake-platform');
  });

  it('a CYCLE falls back to its own project rather than looping', () => {
    // Same fixture as 'stops ON REVISIT rather than walking to the cap' below,
    // minus the call-count assertion — this pins only the return value (a
    // totality check), not the cycle guard's mechanism. Read this file as ONE
    // pin on the cycle guard, not two.
    expect(boardPlacement({
      ...base,
      stampOf: tableOf({
        'custom-tools-amber-delta': stamp('pa', 'a'),
        a: stamp('pb', 'b'),
        b: stamp('pa', 'a'),
      }),
    })).toBe('custom-tools');
  });

  it('a chain longer than the hop cap falls back rather than walking forever', () => {
    expect(boardPlacement({
      ...base,
      stampOf: (id: string): CoordStamp => stamp(`p-${id}`, `${id}+`),
    })).toBe('custom-tools');
  });

  it('resolves a chain exactly as long as the hop cap', () => {
    // FIVE stampOf calls: the session's own, then a, b, c — and the fifth
    // (`d`) answers null, settling on `d`'s project as the root.
    const chain: Record<string, CoordStamp> = {
      'custom-tools-amber-delta': stamp('pa', 'a'),
      a: stamp('pb', 'b'),
      b: stamp('pc', 'c'),
      c: stamp('pd', 'd'),
    };
    expect(boardPlacement({ ...base, stampOf: tableOf(chain) })).toBe('pd');
  });

  it('falls back on a chain one hop past the cap', () => {
    const chain: Record<string, CoordStamp> = {
      'custom-tools-amber-delta': stamp('pa', 'a'),
      a: stamp('pb', 'b'),
      b: stamp('pc', 'c'),
      c: stamp('pd', 'd'),
      d: stamp('pe', 'e'),
    };
    expect(boardPlacement({ ...base, stampOf: tableOf(chain) })).toBe('custom-tools');
  });

  it('stops ON REVISIT rather than walking to the cap', () => {
    const table: Record<string, CoordStamp> = {
      'custom-tools-amber-delta': stamp('pa', 'a'),
      a: stamp('pb', 'b'),
      b: stamp('pa', 'a'),
    };
    let calls = 0;
    const stampOf = (id: string): CoordStamp | null => { calls++; return table[id] ?? null; };
    expect(boardPlacement({ ...base, stampOf })).toBe('custom-tools');
    // 3, not MAX_HOPS: own -> a -> b, and b naming `a` is caught without a
    // fourth lookup.
    expect(calls).toBe(3);
  });

  it('refuses a chain that walks BACK to the session being placed', () => {
    // A transitive self-placement. Same seed, same call-count pin as the
    // self-claimed case above: the return value is `ownProject` either way.
    const table: Record<string, CoordStamp> = {
      'custom-tools-amber-delta': stamp('px', 'x'),
      x: stamp('custom-tools', 'custom-tools-amber-delta'),
    };
    let calls = 0;
    const stampOf = (id: string): CoordStamp | null => { calls++; return table[id] ?? null; };
    expect(boardPlacement({ ...base, stampOf })).toBe('custom-tools');
    expect(calls).toBe(2);          // 3 if the `seen` seed goes
  });
});

describe('foldCoordPlacements', () => {
  // `coordPlacementStamps`'s `ORDER BY id` means a real read can never arrive
  // out of order, so the only way to prove the fold does not LEAN on that order
  // (rather than merely working under it) is to feed it one list twice.
  it('yields the identical answer whether the newest-id stamp arrives first, last, or in the middle', () => {
    const stamps: CoordPlacementStamp[] = [
      { id: 5, sessionId: 'worker-a', claimedBy: 'coord-oldest', coordProject: 'oldest' },
      { id: 9, sessionId: 'worker-a', claimedBy: 'coord-newest', coordProject: 'newest' },
      { id: 7, sessionId: 'worker-a', claimedBy: 'coord-middle', coordProject: 'middle' },
    ];
    const forward = foldCoordPlacements(stamps);
    const reversed = foldCoordPlacements([...stamps].reverse());
    expect(forward('worker-a')).toEqual({ coordProject: 'newest', claimedBy: 'coord-newest' });
    expect(reversed('worker-a')).toEqual({ coordProject: 'newest', claimedBy: 'coord-newest' });
  });

  it('answers null for a session nothing stamps, and folds away a run bound to no session', () => {
    const fold = foldCoordPlacements([
      { id: 1, sessionId: null, claimedBy: 'coord', coordProject: 'somewhere' },
    ]);
    expect(fold('anyone')).toBeNull();
  });

  // The two halves of one stamp never separate: a fold that carried the project
  // and dropped the claimant would make every chain one hop long and every
  // self-claim invisible.
  it('carries claimedBy alongside coordProject, from the same row', () => {
    const fold = foldCoordPlacements([
      { id: 3, sessionId: 'w', claimedBy: 'c', coordProject: 'p' },
    ]);
    expect(fold('w')).toEqual({ coordProject: 'p', claimedBy: 'c' });
  });
});

describe('placement.ts is the pure module its own docstring says it is', () => {
  const SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'placement.ts'),
    'utf8');

  /** Comments blanked, positions preserved — `caps.ts`'s scan without which
   *  this file's own docstring, which NAMES fs, fastify and coord.db while
   *  promising not to use them, reds every assertion below. */
  const code = (): string => SRC
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));

  it('the scan is over real code, not an empty string', () => {
    // The floor every negative assertion below needs: `''` contains none of them.
    expect(code()).toContain('export function boardPlacement');
    // D-2921 moved the fold here from `fleet.ts` (L3). It is a pure decision
    // about the same question, so the purity scan must cover it too — and this
    // line is what makes that true rather than assumed.
    expect(code()).toContain('export function foldCoordPlacements');
    expect(code().replace(/\s/g, '').length).toBeGreaterThan(400);
  });

  it('has no clock', () => {
    expect(code(), 'placement.ts reads the clock — the decision is no longer pure')
      .not.toMatch(/\bDate\s*\.\s*now\s*\(|\bnew\s+Date\s*\(|performance\s*\.\s*now/);
  });

  it('has no fs and no other node builtin', () => {
    expect(code(), 'placement.ts imports a node builtin').not.toMatch(/from\s+'node:/);
    expect(code(), 'placement.ts reaches for a filesystem').not.toMatch(/\bfs\s*\.|require\s*\(/);
  });

  it('has no fastify, no reply, no store', () => {
    expect(code(), 'placement.ts names a reply — an L1 decision does not answer HTTP')
      .not.toMatch(/\breply\b|\bFastify|\bapp\s*\./);
    expect(code(), 'placement.ts reaches the store — an L1 decision does not read rows')
      .not.toMatch(/CoordStore|\bcoord\s*\.|\bstore\s*\./);
  });

  it('has NO imports at all — stronger than L1\'s "types only" allowance', () => {
    // `architecture:78-81` allows L1 to import L2 as types; this module never
    // needs even that, since every fact it needs arrives as a `PlacementInput`
    // field or the `stampOf` port. Zero imports is the strongest form of the
    // purity claim, not a gap in this scan — there is nothing here for a value
    // import to hide behind.
    const imports = [...code().matchAll(/^\s*import\b[^\n]*/gm)].map((m) => m[0]!);
    expect(imports, 'placement.ts has grown an import — re-check the purity claim').toEqual([]);
  });
});
