import { describe, it, expect } from 'vitest';
import { groupFleet } from '../src/fleet/groupFleet';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: null, name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, ...over,
});

describe('groupFleet', () => {
  it('orders groups by their most urgent member, not alphabetically', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'z', project: 'zeta', dialogPending: true }),
    ]);
    expect(g.map((x) => x.project)).toEqual(['zeta', 'alpha']);
  });

  it('surfaces attention on the group, so collapsing cannot hide it', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha' }),
      s({ id: 'b', project: 'alpha', dialogPending: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.attention).toBe(true);
  });

  it('counts busy members for the collapsed header', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'b', project: 'alpha', status: 'busy' }),
      s({ id: 'c', project: 'alpha', status: 'idle' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.busy).toBe(2);
  });

  it('does not count a member the row itself calls waiting', () => {
    // SessionLine ranks attention above busy (`busy = !attention && status ===
    // 'busy'`), so a busy session holding a pending dialog renders the word
    // `waiting`. `busy` feeds the folded card's WORD, and a word that counts
    // rows the rows themselves count differently is simply wrong: this group
    // would have said `working` over one row saying `waiting`.
    // `dialogPending` is derived server-side from a separate pending-dialog set
    // (server/src/fleet.ts) with no coupling to `status`, so this is reachable.
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy', dialogPending: true }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.busy).toBe(0);
    // The MARK is unaffected — attention still fires. Different form, different
    // predicate, both true of this session.
    expect(g[0]!.attention).toBe(true);
  });

  it('counts the merely-busy members alongside a waiting one', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy', dialogPending: true }),
      s({ id: 'b', project: 'alpha', status: 'busy' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.busy).toBe(1);
  });

  it('sorts within a group by the fleet rule', () => {
    const g = groupFleet([
      s({ id: 'a', project: 'alpha', status: 'busy' }),
      s({ id: 'b', project: 'alpha', dialogPending: true }),
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
    // but passes under Map insertion-order. sortFleet puts '99' first (has dialogPending),
    // '1' second (merely busy), so group order must be ['99', '1'] or Map order is lost.
    const g = groupFleet([
      s({ id: 'a', project: '99', dialogPending: true }),
      s({ id: 'b', project: '1', status: 'busy' }),
    ]);
    expect(g.map((x) => x.project)).toEqual(['99', '1']);
  });

  it('excludes dead sessions from attention, even if they are dialogPending', () => {
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
