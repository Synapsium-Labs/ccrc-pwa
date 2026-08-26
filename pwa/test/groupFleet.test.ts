import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { groupFleet } from '../src/fleet/groupFleet';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: null, name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null, ...over,
});

describe('groupFleet', () => {
  it('orders groups by their most urgent member, not alphabetically', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', bucket: 'working' }),
      s({ id: 'z', project: 'zeta', bucket: 'attention' }),
    ]);
    expect(g.map((x) => x.project)).toEqual(['zeta', 'alpha']);
  });

  it('surfaces attention on the group, so collapsing cannot hide it', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha' }),
      s({ id: 'b', project: 'alpha', bucket: 'attention' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.attention).toBe(true);
  });

  it('counts from the server bucket, so the head cannot contradict its rows', () => {
    const g = groupFleet([
      s({ id: 'a', bucket: 'attention' }), s({ id: 'b', bucket: 'working' }),
    ])[0]!;
    expect(g.attention).toBe(true);
    expect(g.busy).toBe(1);
  });

  it('counts busy members for the collapsed header', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', bucket: 'working' }),
      s({ id: 'b', project: 'alpha', bucket: 'working' }),
      s({ id: 'c', project: 'alpha', bucket: 'idle' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.busy).toBe(2);
  });

  it('does not count a member the row itself calls waiting', () => {
    // Before Task 6, `busy` counted `status === 'busy' && !dialogPending` — a
    // client-side re-derivation of SessionLine's own attention-first
    // arbitration, kept in sync with it by a comment rather than by the
    // compiler. Both derivations are gone: a session is in exactly ONE
    // bucket now, so a `working`-bucket session and an `attention`-bucket one
    // are, by construction, never the same row — there is no exclusion left
    // to prove, only that `busy` reads the field SessionLine's own word reads.
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', bucket: 'attention' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.busy).toBe(0);
    expect(g[0]!.attention).toBe(true);
  });

  it('counts the merely-busy members alongside a waiting one', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', bucket: 'attention' }),
      s({ id: 'b', project: 'alpha', bucket: 'working' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.busy).toBe(1);
  });

  it('reports how many members are unseen', () => {
    const g = groupFleet([s({ id: 'a', bucket: 'attention', bucketSince: 10 })], { a: 5 })[0]!;
    expect(g.unseen).toBe(1);
  });

  it('does not count a member as unseen once acked, or one outside the badged buckets at all', () => {
    const g = groupFleet(
      [
        s({ id: 'a', project: 'alpha', bucket: 'attention', bucketSince: 10 }), // acked after
        s({ id: 'b', project: 'alpha', bucket: 'working', bucketSince: 999 }),  // never badged
      ],
      { a: 20 },
    )[0]!;
    expect(g.unseen).toBe(0);
  });

  it('sorts within a group by the fleet rule', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', bucket: 'working' }),
      s({ id: 'b', project: 'alpha', bucket: 'attention' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.sessions.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('is pure — it does not reorder its argument', () => {
    const input = [s({ id: 'a', project: 'zeta' }), s({ id: 'b', project: 'alpha' })];
    const copy = [...input];
    groupFleet(input);
    expect(input).toEqual(copy);
  });

  it('preserves insertion order under integer-like project names', () => {
    // This test would fail under Object.keys() iteration (which sorts integer-like keys numerically),
    // but passes under Map insertion-order. sortFleet puts '99' first (attention),
    // '1' second (working), so group order must be ['99', '1'] or Map order is lost.
    const g = groupFleet([
      s({ id: 'a', project: '99', bucket: 'attention' }),
      s({ id: 'b', project: '1', bucket: 'working' }),
    ]);
    expect(g.map((x) => x.project)).toEqual(['99', '1']);
  });

  it('excludes dead sessions from attention, even if they are dialogPending', () => {
    // Server-side, `sessionBucket` (shared/api.ts) checks `status === 'dead'`
    // before it ever looks at `dialogPending`, so a dead session's bucket can
    // never be `attention` — pinned there (server/test/bucket.test.ts), not
    // here. A group whose only dialogPending member is dead must report
    // attention: false, so the screen does not highlight an already-closed
    // session.
    //
    // This fixture proves only THAT, and says so: being dead, it also scores
    // false under a GUARDED re-derivation (`status !== 'dead' && dialogPending`),
    // so it cannot see a second writer coming back. The live fixture below is
    // the one that can.
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'dead', dialogPending: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.attention).toBe(false);
  });

  it('does not re-derive attention from a LIVE member\'s dialogPending', () => {
    // The shape a restored client-side derivation would light up, and the one
    // no other fixture in this repo had: not dead, not archived, dialogPending
    // true — and filed `working` by the server, which had the same field in
    // hand and a whole ladder of evidence this function does not (shared/
    // api.ts's `sessionBucket`). `busy` counts it for the same reason: the
    // bucket is the entire answer, so a session cannot be both.
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy', dialogPending: true, bucket: 'working' }),
    ])[0]!;
    expect(g.attention).toBe(false);
    expect(g.busy).toBe(1);
  });
});

describe('pin', () => {
  const at = (id: string, home: string): FleetSession =>
    ({ ...s({ id, project: 'demo' }), home });

  it('is the account all of a project\'s sessions call home', () => {
    const [g] = groupFleet([at('demo-a', 'claude'), at('demo-b', 'claude')]);
    expect(g!.pin).toBe('claude');
  });

  it('is null when they disagree — the card must not claim one of them', () => {
    const [g] = groupFleet([at('demo-a', 'claude'), at('demo-b', 'claude2')]);
    expect(g!.pin).toBeNull();
  });

  it('is the lone session\'s home for a single-session project', () => {
    const [g] = groupFleet([at('demo-a', 'claude-corp')]);
    expect(g!.pin).toBe('claude-corp');
  });
});

describe('the archived sub-fold is split on the BUCKET, not on archivedAt', () => {
  /** An archived-bucket row: the server's ladder files `archivedAt !== null`
   *  with no merged PR exactly here (shared/api.ts's `sessionBucket`). */
  const arch = (id: string, over: Partial<FleetSession> = {}): FleetSession =>
    s({ id, project: 'demo', archivedAt: 1785300000, bucket: 'archived', ...over });
  /** The same workspace once its PR merged — `cleanup`, the leapfrog bucket.
   *  `archivedAt` is set on BOTH, which is the whole point below. */
  const clean = (id: string, over: Partial<FleetSession> = {}): FleetSession =>
    s({ id, project: 'demo', archivedAt: 1785300000, bucket: 'cleanup', ...over });

  it('splits archived sessions out of the live list without dropping them', () => {
    const [g] = groupFleet([s({ id: 'demo-a', project: 'demo' }), arch('demo-b')]);
    expect(g!.sessions.map((x) => x.id)).toEqual(['demo-a']);
    expect(g!.archived.map((x) => x.id)).toEqual(['demo-b']);
  });

  // THE fix. Both predicates are true of a cleanup row, and the `archivedAt`
  // one swept it into a fold named after a DIFFERENT bucket: the bucket bar
  // counted `Cleanup 1` and offered "Mark all seen" for a row that rendered
  // nowhere on the screen, under a fold that read `Archived (2)`.
  it('leaves a cleanup row in the live list, where its own chip counts it', () => {
    const [g] = groupFleet([s({ id: 'demo-a', project: 'demo' }), clean('demo-merged')]);
    expect(g!.sessions.map((x) => x.id)).toContain('demo-merged');
    expect(g!.archived.map((x) => x.id)).toEqual([]);
  });

  // And the counts the two surfaces render therefore agree: the fold's own
  // `Archived (n)` is exactly the `Archived` chip's members, never the union.
  it('makes the fold the same set the Archived chip counts', () => {
    const fleet = [arch('demo-b'), clean('demo-merged'), s({ id: 'demo-a', project: 'demo' })];
    const [g] = groupFleet(fleet);
    expect(g!.archived).toHaveLength(fleet.filter((x) => x.bucket === 'archived').length);
  });

  it('keeps a project whose sessions are ALL archived', () => {
    // Dropping it would make the workspace reachable only by a URL nobody has.
    const [g] = groupFleet([arch('demo-b')]);
    expect(g!.sessions).toEqual([]);
    expect(g!.archived).toHaveLength(1);
  });

  it('excludes archived rows from the pin', () => {
    // demo-a and the archived row deliberately disagree on home: if pin were
    // computed over the whole membership (archived included), the mismatch
    // would read as disagreement (pin: null). Excluding the archived row
    // leaves demo-a as the pin's only voter. `attention`/`busy` cannot be
    // discriminated this way any more and the fixture no longer pretends to:
    // the split is now the bucket itself, so an archived-bucket row is
    // excluded from both by the bucket test alone, whatever the scoping.
    const [g] = groupFleet([
      s({ id: 'demo-a', project: 'demo', home: 'claude' }),
      arch('demo-b', { home: 'claude2' }),
    ]);
    expect(g!.busy).toBe(0);
    expect(g!.attention).toBe(false);
    expect(g!.pin).toBe('claude');
  });

  it('still computes a pin when every session is archived', () => {
    // The `live.length > 0 ? live : members` fallback (see the comment in
    // groupFleet.ts) exists so this branch never indexes an empty array —
    // dropping the `: members` half leaves `forPin` empty here, which is
    // exactly what the "ALL archived" test above does not check.
    const [g] = groupFleet([arch('demo-b', { home: 'claude-corp' })]);
    expect(g!.pin).toBe('claude-corp');
  });

  it('counts an unseen cleanup member in `unseen`, since it is a live row now', () => {
    // `cleanup` is a BADGED bucket (seen.ts). A per-project badge that
    // skipped it would undercount against the bucket bar's Cleanup chip —
    // the two would be describing the same rows and disagreeing.
    const [g] = groupFleet([clean('demo-merged', { bucketSince: 5000 })], {});
    expect(g!.unseen).toBe(1);
    const [seenGroup] = groupFleet([clean('demo-merged', { bucketSince: 5000 })],
      { 'demo-merged': 6000 });
    expect(seenGroup!.unseen).toBe(0);
  });
});

// The `unseen` doc named two readers of `isUnseen` that do not exist — a row
// badge (SessionLine has never imported seen.ts) and the bell (NotificationBell
// is a Web-Push on/off toggle with no watermark notion at all). A reader
// adding the row badge later would have believed it was already shipped. Same
// check style as seen.test.ts's rationale block: a comment cannot be verified
// by rendering, so it is verified by reading.
describe('the unseen field\'s doc', () => {
  const srcDir = path.join(import.meta.dirname, '..', 'src');
  const src = readFileSync(path.join(srcDir, 'fleet', 'groupFleet.ts'), 'utf8');
  // The doc block immediately above `unseen: number`, gutters stripped and
  // whitespace collapsed, so a claim cannot hide by being re-wrapped.
  const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*unseen: number;/
    .exec(src)![1]!
    .replace(/^[ \t]*\*[ \t]?/gm, '')
    .replace(/\s+/g, ' ');

  /** Surfaces the doc might claim, and the file each one would live in. The
   *  FIRST entry is the one that ships today — it is in the list precisely so
   *  the loop below has a live body. Without it both claims were tuned to a
   *  wording the doc no longer uses, `continue` fired twice, and the only
   *  assertion left standing was "the doc contains the phrase bucket bar". */
  const SURFACES = [
    { claim: /bucket bar/i, file: path.join('screens', 'FleetScreen.tsx'), ships: true },
    { claim: /row'?s own badge/, file: path.join('fleet', 'SessionLine.tsx'), ships: false },
    { claim: /the bell/, file: path.join('fleet', 'NotificationBell.tsx'), ships: false },
  ];

  it('names only surfaces that actually read isUnseen', () => {
    let checked = 0;
    for (const { claim, file } of SURFACES) {
      if (!claim.test(doc)) continue;
      // Claimed — then it had better be true. This passes the day the row
      // badge really lands and its file starts calling isUnseen.
      expect(readFileSync(path.join(srcDir, file), 'utf8')).toMatch(/isUnseen/);
      checked += 1;
    }
    // The loop is not allowed to be vacuous. The shipping surface must be
    // named AND must have been checked — which is what fails if either the
    // doc stops naming the bucket bar or FleetScreen stops calling isUnseen.
    expect(doc).toMatch(SURFACES[0]!.claim);
    expect(checked).toBeGreaterThanOrEqual(1);
  });

  it('keeps the not-yet-shipped surfaces in the future tense', () => {
    // The two below do NOT read isUnseen, so the doc may only name them as
    // work to come. A rewrite to the present tense — "the row badge reads
    // isUnseen" — would be the claim this block exists to catch, and the
    // loop above would then demand the file back it up.
    for (const { file, ships } of SURFACES) {
      if (ships) continue;
      expect(readFileSync(path.join(srcDir, file), 'utf8')).not.toMatch(/isUnseen/);
    }
    expect(doc).toMatch(/when a row badge or a bell counter arrives/i);
  });
});
