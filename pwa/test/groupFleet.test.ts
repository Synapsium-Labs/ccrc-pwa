import { describe, it, expect } from 'vitest';
import { groupFleet } from '../src/fleet/groupFleet';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: null, name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, ...over,
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
    // here. `dialogPending: true` is left on this fixture on purpose, as the
    // thing a stale or buggy PRODUCER might still send: groupFleet must not
    // independently notice it and override the bucket the server sent.
    // A group whose only dialogPending member is dead must report attention: false,
    // so the screen does not highlight an already-closed session.
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'dead', dialogPending: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.attention).toBe(false);
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

describe('archived rows', () => {
  const at = (id: string, archivedAt: number | null): FleetSession =>
    ({ ...s({ id, project: 'demo' }), archivedAt });

  it('splits archived sessions out of the live list without dropping them', () => {
    const [g] = groupFleet([at('demo-a', null), at('demo-b', 1785300000)]);
    expect(g!.sessions.map((x) => x.id)).toEqual(['demo-a']);
    expect(g!.archived.map((x) => x.id)).toEqual(['demo-b']);
  });

  it('keeps a project whose sessions are ALL archived', () => {
    // Dropping it would make the workspace reachable only by a URL nobody has.
    const [g] = groupFleet([at('demo-b', 1785300000)]);
    expect(g!.sessions).toEqual([]);
    expect(g!.archived).toHaveLength(1);
  });

  it('excludes archived rows from attention, busy and the pin', () => {
    // demo-a and busyArchived deliberately disagree on home: if pin were
    // computed over the whole membership (archived included), the mismatch
    // would read as disagreement (pin: null). Excluding the archived row
    // leaves demo-a as the pin's only voter.
    const busyArchived = { ...at('demo-b', 1785300000), status: 'busy' as const, dialogPending: true, home: 'claude2' };
    const [g] = groupFleet([{ ...at('demo-a', null), home: 'claude' }, busyArchived]);
    expect(g!.busy).toBe(0);
    expect(g!.attention).toBe(false);
    expect(g!.pin).toBe('claude');
  });

  it('still computes a pin when every session is archived', () => {
    // The `live.length > 0 ? live : members` fallback (see the comment in
    // groupFleet.ts) exists so this branch never indexes an empty array —
    // dropping the `: members` half leaves `forPin` empty here, which is
    // exactly what the "ALL archived" test above does not check.
    const [g] = groupFleet([{ ...at('demo-b', 1785300000), home: 'claude-corp' }]);
    expect(g!.pin).toBe('claude-corp');
  });

  it('excludes a NOT-waiting busy archived row from the busy count', () => {
    // The test above uses an archived row with dialogPending: true, which
    // the `!m.dialogPending` clause excludes from `busy` regardless of
    // whether it is scoped to `live` or the whole membership — it cannot by
    // itself prove `busy` is scoped to `live`. This row is busy and NOT
    // dialogPending, so a `members.filter` regression would count it.
    const busyArchived = { ...at('demo-b', 1785300000), status: 'busy' as const };
    const [g] = groupFleet([at('demo-a', null), busyArchived]);
    expect(g!.busy).toBe(0);
  });
});
