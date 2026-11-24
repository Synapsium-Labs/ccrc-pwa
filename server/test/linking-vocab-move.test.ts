// Characterization pins for the team-link vocabulary (linear-hierarchy wave 8, D-8635), written before it moved from
// `shared/api.ts` to `shared/linking.ts`: they import from `linking.js` only, so they hold on both sides of the move.
import { describe, it, expect } from 'vitest';
import {
  TEAM_EVIDENCE_KINDS, TEAM_LINK_SOURCES, isTeamEvidence, isTeamCandidate,
} from '../../shared/linking.js';
import { isLinearTeamKey } from '../../shared/linear.js';

describe('the team-link vocabulary (pinned across its move)', () => {
  it('lists the evidence kinds and link sources', () => {
    expect([...TEAM_EVIDENCE_KINDS]).toEqual(['ticket-ids', 'name-match', 'pr-attachments', 'suggested']);
    expect([...TEAM_LINK_SOURCES]).toEqual(['manual', 'auto', 'overlord']);   // D-8809: the Overlord's link, on the wire
  });

  it('isTeamEvidence accepts the two exact shapes', () => {
    expect(isTeamEvidence({ kind: 'ticket-ids', ids: 2, of: 3 })).toBe(true);
    expect(isTeamEvidence({ kind: 'ticket-ids', ids: 3, of: 3 })).toBe(true);
    expect(isTeamEvidence({ kind: 'name-match', matched: 'repo', on: 'key' })).toBe(true);
    expect(isTeamEvidence({ kind: 'name-match', matched: 'project', on: 'name' })).toBe(true);
  });

  it('isTeamEvidence accepts the suggested shape: a session and a reason of at most 280', () => {
    expect(isTeamEvidence({ kind: 'suggested', by: 'lane-a', why: 'a reason' })).toBe(true);
    expect(isTeamEvidence({ kind: 'suggested', by: 'lane-a', why: 'x'.repeat(280) })).toBe(true);
    for (const v of [{ kind: 'suggested', by: 'lane-a', why: 'x'.repeat(281) }, { kind: 'suggested', by: '', why: 'a' }, { kind: 'suggested', by: 'a', why: '' },
      { kind: 'suggested', by: 'a' }, { kind: 'suggested', by: 'a', why: 'b', extra: 1 }, { kind: 'suggested', by: 1, why: 'b' }]) {
      expect(isTeamEvidence(v), JSON.stringify(v)).toBe(false);
    }
  });

  it('isTeamEvidence refuses everything else', () => {
    const bad: unknown[] = [
      { kind: 'ticket-ids', ids: 2, of: 3, extra: 1 },
      { kind: 'name-match', matched: 'repo', on: 'key', extra: 1 },
      { kind: 'ticket-ids', ids: 4, of: 3 },
      { kind: 'ticket-ids', ids: -1, of: 3 },
      { kind: 'ticket-ids', ids: 1.5, of: 3 },
      { kind: 'ticket-ids', ids: 1, of: 3.5 },
      { kind: 'other', ids: 1, of: 2 },
      null, [], undefined, 'ticket-ids',
    ];
    for (const v of bad) expect(isTeamEvidence(v), JSON.stringify(v)).toBe(false);
  });

  it('isTeamCandidate accepts the one shape and refuses extra keys, a bad key and bad evidence', () => {
    const ok = { key: 'AAA', name: 'Team A', evidence: { kind: 'name-match', matched: 'repo', on: 'key' } };
    expect(isTeamCandidate(ok, isLinearTeamKey)).toBe(true);
    expect(isTeamCandidate({ ...ok, extra: 1 }, isLinearTeamKey)).toBe(false);
    expect(isTeamCandidate({ ...ok, key: 'not a key' }, isLinearTeamKey)).toBe(false);
    expect(isTeamCandidate({ ...ok, evidence: { kind: 'ticket-ids', ids: 5, of: 1 } }, isLinearTeamKey)).toBe(false);
    expect(isTeamCandidate(null, isLinearTeamKey)).toBe(false);
    // D-8808: the 5-key shape names its workspace; a 4-key one is refused.
    expect(isTeamCandidate({ ...ok, workspaceId: 'ws-a', workspaceName: 'Workspace A' }, isLinearTeamKey)).toBe(true);
    expect(isTeamCandidate({ ...ok, workspaceId: 'ws-a' }, isLinearTeamKey)).toBe(false);
  });
});
