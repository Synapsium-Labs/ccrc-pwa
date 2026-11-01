// Workspace routing (#1444, D-7668; spec 2026-10-31 §4.1 to §4.3, §14 row 3; plan task LK3).
//
// The router (`linear/route.ts`, L1, pure): every row of spec §4.2's table, team keys compared uppercased, and never
// the first of two matches. Its input is what the store read (`readLinearStore`) makes routable: every file slot, and
// the legacy slot only once its Check again has learned its workspace and no file slot holds that workspace (§3.4).
// Nothing here reaches the network.
import { describe, expect, it } from 'vitest';
import type { LinearStoreRecord } from '../../shared/linear.js';
import { routableSlots, routeLinear, type LinearRoute, type LinearRouteAsk, type LinearRouteSlot } from '../src/linear/route.js';
import type { LinearFileSlot, LinearLegacySlot, LinearStoreRead } from '../src/linear/store.js';

const WS_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const WS_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const WS_L = 'cccccccc-0000-4000-8000-000000000003';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const team = (key: string, n: number): { id: string; key: string; name: string } =>
  ({ id: `dddddddd-0000-4000-8000-00000000000${n}`, key, name: `Team ${key}` });

/** A routable slot as the router reads it. */
const slot = (id: string, urlKey: string | null, teamKeys: string[]): LinearRouteSlot =>
  ({ ref: { source: 'file', id }, workspaceId: id, urlKey, teamKeys });
const A = slot(WS_A, 'ws-a', ['AAA']);
const B = slot(WS_B, 'ws-b', ['BBB']);

const issue = (prefix: string, workspace: string | null = null): LinearRouteAsk => ({ kind: 'issue', prefix, workspace });
const byTeam = (t: string, workspace: string | null = null): LinearRouteAsk => ({ kind: 'team', team: t, workspace });
const byWorkspace = (workspace: string | null): LinearRouteAsk => ({ kind: 'workspace', workspace });
const routedTo = (r: LinearRoute): string => (r.kind === 'slot' ? r.slot.workspaceId ?? 'legacy' : `refused:${r.word}`);

describe('the routing rule (spec §4.2), row by row', () => {
  it('an issue reference and a workspace: that workspace\'s slot, whatever the prefix', () => {
    expect(routedTo(routeLinear([A, B], issue('BBB', 'ws-a')))).toBe(WS_A);
    expect(routedTo(routeLinear([A, B], issue('ZZZ', 'ws-b')))).toBe(WS_B);
    // A prefix two workspaces share is reached through the workspace.
    expect(routedTo(routeLinear([A, slot(WS_B, 'ws-b', ['AAA'])], issue('AAA', 'ws-b')))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], issue('AAA', 'ws-zz')))).toBe('refused:workspace-unknown');
  });

  it('a team, or an issue prefix, held by exactly one slot: that slot, compared uppercased', () => {
    expect(routedTo(routeLinear([A, B], byTeam('BBB')))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], byTeam('bbb')))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], issue('aaa')))).toBe(WS_A);
    expect(routedTo(routeLinear([slot(WS_A, 'ws-a', ['Aaa'])], byTeam('aAA')))).toBe(WS_A);
  });

  it('a team and a workspace: the slot when it holds the team, team-unknown when it lacks it', () => {
    expect(routedTo(routeLinear([A, B], byTeam('aaa', 'ws-a')))).toBe(WS_A);
    expect(routedTo(routeLinear([A, B], byTeam('BBB', 'ws-a')))).toBe('refused:team-unknown');
    expect(routedTo(routeLinear([A, B], byTeam('AAA', 'ws-zz')))).toBe('refused:workspace-unknown');
  });

  it('a team two slots hold: team-ambiguous with both URL keys, never the first match, in any order', () => {
    const B2 = slot(WS_B, 'ws-b', ['BBB', 'AAA']);
    for (const slots of [[A, B2], [B2, A]]) {
      for (const ask of [byTeam('AAA'), issue('aaa')]) {
        expect(routeLinear(slots, ask)).toEqual({ kind: 'refused', word: 'team-ambiguous', candidates: ['ws-a', 'ws-b'] });
      }
      // `--workspace` is the remedy, for a team and for an issue reference alike.
      expect(routedTo(routeLinear(slots, byTeam('AAA', 'ws-b')))).toBe(WS_B);
      expect(routedTo(routeLinear(slots, issue('AAA', 'ws-a')))).toBe(WS_A);
    }
  });

  it('a team no slot holds: team-unknown at once', () => {
    expect(routeLinear([A, B], byTeam('ZZZ'))).toEqual({ kind: 'refused', word: 'team-unknown' });
    expect(routeLinear([A, B], issue('ZZZ'))).toEqual({ kind: 'refused', word: 'team-unknown' });
  });

  it('a workspace only: its slot, or workspace-unknown', () => {
    expect(routedTo(routeLinear([A, B], byWorkspace('ws-b')))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], byWorkspace('ws-zz')))).toBe('refused:workspace-unknown');
    // A slot whose URL key is not known is reached by no workspace name.
    expect(routedTo(routeLinear([slot(WS_A, null, [])], byWorkspace('ws-a')))).toBe('refused:workspace-unknown');
  });

  it('two slots claiming one URL key are never chosen between', () => {
    const twin = slot(WS_B, 'ws-a', ['BBB']);
    expect(routedTo(routeLinear([A, twin], byWorkspace('ws-a')))).toBe('refused:workspace-required');
    expect(routedTo(routeLinear([twin, A], issue('AAA', 'ws-a')))).toBe('refused:workspace-required');
  });

  it('neither a team nor a workspace: the one slot, or workspace-required when there are several', () => {
    expect(routedTo(routeLinear([B], byWorkspace(null)))).toBe(WS_B);
    expect(routedTo(routeLinear([A, B], byWorkspace(null)))).toBe('refused:workspace-required');
  });

  it('a store with nothing routable: not-configured, whatever the call names', () => {
    for (const ask of [issue('AAA'), issue('AAA', 'ws-a'), byTeam('AAA'), byTeam('AAA', 'ws-a'), byWorkspace('ws-a'), byWorkspace(null)]) {
      expect(routeLinear([], ask), JSON.stringify(ask)).toEqual({ kind: 'refused', word: 'not-configured' });
    }
  });
});

// What the store read makes routable (§3.4: no migration, and the legacy slot only once it is learned).

const record = (id: string, digest: string, over: Partial<LinearStoreRecord> = {}): LinearStoreRecord => ({
  workspaceId: id, name: 'Workspace', urlKey: id === WS_A ? 'ws-a' : 'ws-b', user: 'user-a', teams: [team('aaa', 1)],
  teamsAt: 1, keyTail: 'tail', keyDigest: digest, checkedAt: 1, outcome: 'ok', ...over,
});
const fileSlot = (id: string, keyDigest: string | null, rec: LinearFileSlot['record']): LinearFileSlot => ({
  source: 'file', id, key: keyDigest === null ? { kind: 'unreadable', code: 'EACCES' } : { kind: 'key', digest: keyDigest }, record: rec,
});
const legacy = (over: Partial<LinearLegacySlot> = {}): LinearLegacySlot => ({
  source: 'legacy', key: { kind: 'key', digest: DIGEST_B }, details: { kind: 'absent' },
  view: { state: 'details-unknown', why: 'absent' }, teamsFile: 'matched',
  workspace: { keyDigest: DIGEST_B, workspaceId: WS_L, name: 'Legacy', urlKey: 'ws-l', teams: [team('BBB', 2)], teamsAt: 1 },
  superseded: false, ...over,
});
const listed = (slots: LinearFileSlot[], leg: LinearLegacySlot | null): Extract<LinearStoreRead, { kind: 'listed' }> =>
  ({ kind: 'listed', slots, legacy: leg });

describe('routableSlots: what the store read can route', () => {
  it('a file slot routes by the URL key and the teams of a record that describes its present key, team keys uppercased', () => {
    expect(routableSlots(listed([fileSlot(WS_A, DIGEST_A, { kind: 'details', details: record(WS_A, DIGEST_A) })], null)))
      .toEqual([{ ref: { source: 'file', id: WS_A }, workspaceId: WS_A, urlKey: 'ws-a', teamKeys: ['AAA'] }]);
  });

  it('a file slot whose record is absent, malformed, unreadable or of another key, or whose key cannot be read, is a slot with nothing learned', () => {
    const recs: LinearFileSlot['record'][] = [
      { kind: 'absent' }, { kind: 'malformed' }, { kind: 'unreadable', code: 'EACCES' }, { kind: 'details', details: record(WS_A, DIGEST_B) },
    ];
    for (const rec of recs) {
      expect(routableSlots(listed([fileSlot(WS_A, DIGEST_A, rec)], null)), rec.kind)
        .toEqual([{ ref: { source: 'file', id: WS_A }, workspaceId: WS_A, urlKey: null, teamKeys: [] }]);
    }
    expect(routableSlots(listed([fileSlot(WS_A, null, { kind: 'details', details: record(WS_A, DIGEST_A) })], null)))
      .toEqual([{ ref: { source: 'file', id: WS_A }, workspaceId: WS_A, urlKey: null, teamKeys: [] }]);
  });

  it('the legacy slot routes only once learned, and never while a file slot holds its workspace', () => {
    expect(routableSlots(listed([], legacy())))
      .toEqual([{ ref: { source: 'legacy' }, workspaceId: WS_L, urlKey: 'ws-l', teamKeys: ['BBB'] }]);
    expect(routableSlots(listed([], legacy({ teamsFile: 'stale', workspace: null })))).toEqual([]);
    expect(routableSlots(listed([], legacy({ teamsFile: 'absent', workspace: null })))).toEqual([]);
    expect(routableSlots(listed([], legacy({ superseded: true })))).toEqual([]);
    expect(routableSlots(listed([], null))).toEqual([]);
  });

  it('a store with only an unlearned legacy key routes nothing: not-configured', () => {
    const slots = routableSlots(listed([], legacy({ teamsFile: 'absent', workspace: null })));
    expect(routeLinear(slots, issue('BBB'))).toEqual({ kind: 'refused', word: 'not-configured' });
  });

  it('a learned legacy slot and a file slot route side by side, each by its own teams', () => {
    const slots = routableSlots(listed([fileSlot(WS_A, DIGEST_A, { kind: 'details', details: record(WS_A, DIGEST_A) })], legacy()));
    expect(routeLinear(slots, issue('BBB'))).toMatchObject({ kind: 'slot', slot: { ref: { source: 'legacy' } } });
    expect(routeLinear(slots, issue('AAA'))).toMatchObject({ kind: 'slot', slot: { ref: { source: 'file', id: WS_A } } });
    expect(routeLinear(slots, byWorkspace(null))).toEqual({ kind: 'refused', word: 'workspace-required' });
  });
});
