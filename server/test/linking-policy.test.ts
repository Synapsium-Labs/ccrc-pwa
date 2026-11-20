// D-8147: the linking standard's deciders (server/src/linking/policy.ts) and vocabulary (shared/linking.ts).
// Neutral examples only: KEY-123, project-a.
import { describe, it, expect } from 'vitest';
import {
  withoutTrackerIds, slugForTicket,
  VISIBILITY_MAX_AGE_MS, VISIBILITY_RETRY_MS, linkingMode, ticketRefOfBranch, trackerIdsIn, parseLinkingWrite, visibilityDue, workspaceAfterWrite,
  parseTeamConfirm, confirmedCandidate, overlordLinkCallBody,
} from '../src/linking/policy.js';
import { WS_SLUG_MAX } from '../../shared/slug.js';
import type { ProjectLinkingWire, TeamCandidateWire } from '../../shared/linking.js';

type Measured = ProjectLinkingWire['measured'];
const measured = (visibility: 'public' | 'private' | 'internal'): Measured =>
  ({ state: 'measured', visibility, slug: 'owner/repo', template: 'absent', at: 1 });

describe('withoutTrackerIds', () => {
  it('takes the team ids out and tidies what they leave', () => {
    expect(withoutTrackerIds('- [x] fix KEY-123 login', 'KEY')).toBe('- [x] fix login');
    expect(withoutTrackerIds('fix (key-123) login', 'KEY')).toBe('fix login');
    expect(withoutTrackerIds('- abc1234 KEY-123: fix login\nplain', 'KEY')).toBe('- abc1234 fix login\nplain');
    expect(withoutTrackerIds('see OTHER-9 and KEY-7.', 'KEY')).toBe('see OTHER-9 and.');
  });
  it('is the text itself with no key or no id', () => {
    expect(withoutTrackerIds('fix KEY-123', null)).toBe('fix KEY-123');
    expect(withoutTrackerIds('fix  it', 'KEY')).toBe('fix  it');
  });
});

describe('linkingMode', () => {
  it('an override wins over any reading, except that a measured public repository is never private', () => {
    expect(linkingMode('public', measured('private'))).toBe('public');
    expect(linkingMode('private', measured('public'))).toBe('public');
    expect(linkingMode('private', measured('internal'))).toBe('private');
    expect(linkingMode('private', { state: 'unmeasured' })).toBe('private');
    expect(linkingMode('public', { state: 'failed', reason: 'x', at: 1 })).toBe('public');
  });
  it('private and internal read private, public reads public', () => {
    expect(linkingMode(null, measured('private'))).toBe('private');
    expect(linkingMode(null, measured('internal'))).toBe('private');
    expect(linkingMode(null, measured('public'))).toBe('public');
  });
  it('unmeasured and failed read unknown', () => {
    expect(linkingMode(null, { state: 'unmeasured' })).toBe('unknown');
    expect(linkingMode(null, { state: 'failed', reason: 'x', at: 1 })).toBe('unknown');
  });
});

describe('ticketRefOfBranch', () => {
  it("names the team's ticket at the slug's start, in either case", () => {
    expect(ticketRefOfBranch('ws/key-123-fix-thing', 'KEY')).toBe('KEY-123');
    expect(ticketRefOfBranch('ws/KEY-123-fix', 'KEY')).toBe('KEY-123');
    expect(ticketRefOfBranch('ws/key-7', 'key')).toBe('KEY-7');
    expect(ticketRefOfBranch('key-45-x', 'KEY')).toBe('KEY-45');
  });
  it('null with no team key, another team\'s key, or the key mid-word', () => {
    expect(ticketRefOfBranch('ws/key-123-x', null)).toBeNull();
    expect(ticketRefOfBranch('ws/other-123-x', 'KEY')).toBeNull();
    expect(ticketRefOfBranch('ws/monkey-123-x', 'KEY')).toBeNull();
    expect(ticketRefOfBranch('ws/fix-key-123', 'KEY')).toBeNull();
    expect(ticketRefOfBranch('ws/key-123x', 'KEY')).toBeNull();
  });
});

describe('trackerIdsIn', () => {
  it('finds KEY-123 as a whole token and ignores UTF-8 and SHA-256 when the key is KEY', () => {
    expect(trackerIdsIn('Closes KEY-123 and refs key-9; UTF-8, SHA-256, MONKEY-5, KEY-12x', 'KEY')).toEqual(['KEY-123', 'KEY-9']);
    expect(trackerIdsIn('(KEY-1) and KEY-1 again', 'KEY')).toEqual(['KEY-1']);
  });
  it('empty with no team key', () => {
    expect(trackerIdsIn('KEY-123', null)).toEqual([]);
  });
});

describe('parseLinkingWrite', () => {
  it('takes a team key in LINEAR_TEAM_KEY_SHAPE, uppercased, and null clears it', () => {
    expect(parseLinkingWrite({ teamKey: 'key', override: null })).toEqual({ ok: true, write: { teamKey: 'KEY', override: null } });
    expect(parseLinkingWrite({ teamKey: null, override: 'public' })).toEqual({ ok: true, write: { teamKey: null, override: 'public' } });
    expect(parseLinkingWrite({ teamKey: 'A_1', override: 'private' })).toEqual({ ok: true, write: { teamKey: 'A_1', override: 'private' } });
  });
  it('refuses a bad key, an override outside the two words, and extra fields', () => {
    expect(parseLinkingWrite({ teamKey: '1KEY', override: null })).toEqual({ ok: false, error: 'bad-team-key' });
    expect(parseLinkingWrite({ teamKey: '', override: null })).toEqual({ ok: false, error: 'bad-team-key' });
    expect(parseLinkingWrite({ teamKey: 'K'.repeat(17), override: null })).toEqual({ ok: false, error: 'bad-team-key' });
    expect(parseLinkingWrite({ teamKey: 7, override: null })).toEqual({ ok: false, error: 'bad-team-key' });
    expect(parseLinkingWrite({ teamKey: 'KEY', override: 'internal' })).toEqual({ ok: false, error: 'bad-override' });
    expect(parseLinkingWrite({ teamKey: 'KEY', override: 3 })).toEqual({ ok: false, error: 'bad-override' });
    expect(parseLinkingWrite({ teamKey: 'KEY', override: null, extra: 1 })).toEqual({ ok: false, error: 'bad-request' });
    expect(parseLinkingWrite(null)).toEqual({ ok: false, error: 'bad-request' });
    expect(parseLinkingWrite([])).toEqual({ ok: false, error: 'bad-request' });
    expect(parseLinkingWrite({ teamKey: 'KEY' })).toEqual({ ok: false, error: 'bad-request' });
  });
});

describe('visibilityDue', () => {
  const now = 10 * VISIBILITY_MAX_AGE_MS;
  it('a never-measured project first, then the oldest reading past 24 h, else null', () => {
    expect(visibilityDue([], now)).toBeNull();
    expect(visibilityDue([{ project: 'a', at: now - 1000 }], now)).toBeNull();
    expect(visibilityDue([{ project: 'a', at: now - VISIBILITY_MAX_AGE_MS }], now)).toBe('a');
    expect(visibilityDue([
      { project: 'a', at: now - VISIBILITY_MAX_AGE_MS - 5 },
      { project: 'b', at: now - 3 * VISIBILITY_MAX_AGE_MS },
      { project: 'c', at: now - 1 },
    ], now)).toBe('b');
    expect(visibilityDue([
      { project: 'b', at: now - 3 * VISIBILITY_MAX_AGE_MS },
      { project: 'n', at: null },
    ], now)).toBe('n');
  });

  it('a failed reading is due again after minutes, not a day', () => {
    expect(visibilityDue([{ project: 'a', at: now - VISIBILITY_RETRY_MS + 1, failed: true }], now)).toBeNull();
    expect(visibilityDue([{ project: 'a', at: now - VISIBILITY_RETRY_MS, failed: true }], now)).toBe('a');
    expect(VISIBILITY_RETRY_MS).toBeLessThan(3_600_000);
    // a good reading of the same age is not due
    expect(visibilityDue([{ project: 'a', at: now - VISIBILITY_RETRY_MS }], now)).toBeNull();
  });
});

describe('slugForTicket (D-8182)', () => {
  it('names the workspace key-123-<words>, lowercase, from the given slug else the title', () => {
    expect(slugForTicket('KEY-123', 'fix-login', 'Ignored')).toBe('key-123-fix-login');
    expect(slugForTicket('KEY-123', undefined, 'Fix the Login!')).toBe('key-123-fix-the-login');
    expect(slugForTicket('KEY-123', '  ', '')).toBe('key-123');
  });
  it('keeps a given slug that already starts with the identifier', () => {
    expect(slugForTicket('KEY-123', 'key-123-fix-login', 't')).toBe('key-123-fix-login');
    expect(slugForTicket('KEY-123', 'key-123', 't')).toBe('key-123');
    expect(slugForTicket('KEY-12', 'key-123-x', 't')).toBe('key-12-key-123-x');   // a longer id is not the same ticket
  });
  it('fits 31 characters, at a word boundary, never with a trailing dash', () => {
    const s = slugForTicket('KEY-123', undefined, 'A very long ticket title that overflows the budget of a slug');
    expect(s.length).toBeLessThanOrEqual(WS_SLUG_MAX);
    expect(s.startsWith('key-123-')).toBe(true);
    expect(s.endsWith('-')).toBe(false);
    expect(WS_SLUG_MAX).toBe(31);
    expect(slugForTicket('KEY-123', 'x'.repeat(80), 't').length).toBe(WS_SLUG_MAX);
  });
});

// Linear hierarchy wave 8, D-8808: the workspace a write stores beside the key.
describe('parseLinkingWrite: the optional workspace', () => {
  const WS = '00000000-0000-4000-8000-0000000000a1';
  it('takes a workspace id or null as a third key', () => {
    expect(parseLinkingWrite({ teamKey: 'key', override: null, workspace: WS }))
      .toEqual({ ok: true, write: { teamKey: 'KEY', override: null, workspace: WS } });
    expect(parseLinkingWrite({ teamKey: 'key', override: null, workspace: null }))
      .toEqual({ ok: true, write: { teamKey: 'KEY', override: null, workspace: null } });
  });
  it('refuses a workspace that is not a slot id, and any other third key', () => {
    expect(parseLinkingWrite({ teamKey: 'KEY', override: null, workspace: 'ws-a' })).toEqual({ ok: false, error: 'bad-request' });
    expect(parseLinkingWrite({ teamKey: 'KEY', override: null, workspace: 7 })).toEqual({ ok: false, error: 'bad-request' });
    expect(parseLinkingWrite({ teamKey: 'KEY', override: null, other: WS })).toEqual({ ok: false, error: 'bad-request' });
  });
});

describe('workspaceAfterWrite', () => {
  const WS_A = '00000000-0000-4000-8000-0000000000a1';
  const WS_B = '00000000-0000-4000-8000-0000000000b2';
  const holdsOnly = (ws: string, key: string) => (w: string, k: string): boolean => w === ws && k === key;
  const none = () => { throw new Error('holds must not be asked'); };

  it('a named workspace that holds the key is stored', () => {
    expect(workspaceAfterWrite({ before: { teamKey: null, workspace: null }, written: { teamKey: 'AAA', workspace: WS_A }, holds: holdsOnly(WS_A, 'AAA') }))
      .toEqual({ ok: true, workspace: WS_A });
  });
  it('a named workspace that does not hold the key, or a named one with no key, is team-unknown', () => {
    expect(workspaceAfterWrite({ before: { teamKey: null, workspace: null }, written: { teamKey: 'AAA', workspace: WS_B }, holds: holdsOnly(WS_A, 'AAA') }))
      .toEqual({ ok: false, error: 'team-unknown' });
    expect(workspaceAfterWrite({ before: { teamKey: null, workspace: null }, written: { teamKey: null, workspace: WS_A }, holds: none }))
      .toEqual({ ok: false, error: 'team-unknown' });
  });
  it('a named workspace read from an unreadable store is unavailable, never team-unknown', () => {
    expect(workspaceAfterWrite({ before: { teamKey: null, workspace: null }, written: { teamKey: 'AAA', workspace: WS_A }, holds: () => 'unmeasured' }))
      .toEqual({ ok: false, error: 'unavailable' });
  });
  it('workspace null, or no key, stores no workspace', () => {
    expect(workspaceAfterWrite({ before: { teamKey: 'AAA', workspace: WS_A }, written: { teamKey: 'AAA', workspace: null }, holds: none }))
      .toEqual({ ok: true, workspace: null });
    expect(workspaceAfterWrite({ before: { teamKey: 'AAA', workspace: WS_A }, written: { teamKey: null }, holds: none }))
      .toEqual({ ok: true, workspace: null });
  });
  it('an omitted workspace with the key unchanged keeps the stored one, asking nothing', () => {
    expect(workspaceAfterWrite({ before: { teamKey: 'AAA', workspace: WS_A }, written: { teamKey: 'AAA' }, holds: none }))
      .toEqual({ ok: true, workspace: WS_A });
    expect(workspaceAfterWrite({ before: { teamKey: 'AAA', workspace: null }, written: { teamKey: 'BBB' }, holds: none }))
      .toEqual({ ok: true, workspace: null });
  });
  it('an omitted workspace with the key changed keeps the stored one only if it holds the new key', () => {
    expect(workspaceAfterWrite({ before: { teamKey: 'AAA', workspace: WS_A }, written: { teamKey: 'BBB' }, holds: holdsOnly(WS_A, 'BBB') }))
      .toEqual({ ok: true, workspace: WS_A });
    expect(workspaceAfterWrite({ before: { teamKey: 'AAA', workspace: WS_A }, written: { teamKey: 'BBB' }, holds: holdsOnly(WS_A, 'AAA') }))
      .toEqual({ ok: true, workspace: null });
    expect(workspaceAfterWrite({ before: { teamKey: 'AAA', workspace: WS_A }, written: { teamKey: 'BBB' }, holds: () => 'unmeasured' }))
      .toEqual({ ok: true, workspace: null });
  });
});

// D-8809 (Task 8.5): the Overlord's confirm, its body, its candidate and its call's words, all pure.
describe('parseTeamConfirm, confirmedCandidate and overlordLinkCallBody (D-8809)', () => {
  const WS_A = '00000000-0000-4000-8000-0000000000a1';
  const OK = { byId: 'lane-a', byUuid: 'u-1', project: 'project-a', team: 'aaa', workspace: WS_A };
  const A: TeamCandidateWire = { key: 'AAA', name: 'Alpha Team', evidence: { kind: 'ticket-ids', ids: 9, of: 10 }, workspaceId: WS_A, workspaceName: 'Workspace A' };
  const B: TeamCandidateWire = { key: 'BBB', name: 'Beta Team', evidence: { kind: 'suggested', by: 'lane-c', why: 'the branches say so' } };
  it('reads the closed body, uppercasing the team; workspace is required, a uuid or null', () => {
    expect(parseTeamConfirm(OK)).toEqual({ ok: true, value: { ...OK, team: 'AAA' } });
    expect(parseTeamConfirm({ ...OK, workspace: null })).toEqual({ ok: true, value: { ...OK, team: 'AAA', workspace: null } });
    const { workspace: _w, ...noWorkspace } = OK;
    for (const [body, field] of [[noWorkspace, 'workspace'], [{ ...OK, workspace: 'ws-a' }, 'workspace'], [{ ...OK, extra: 1 }, 'body'],
      [[], 'body'], [{ ...OK, team: 'a b' }, 'team'], [{ ...OK, project: '../x' }, 'project'], [{ ...OK, byId: '' }, 'byId'],
      [{ ...OK, byUuid: 'x y' }, 'byUuid']] as const) {
      expect(parseTeamConfirm(body), JSON.stringify(body)).toEqual({ ok: false, field });
    }
  });
  it('a candidate is named by its key and workspace; one stored without a workspace only by null', () => {
    expect(confirmedCandidate([A, B], 'AAA', WS_A)).toBe(A);
    expect(confirmedCandidate([A, B], 'AAA', null)).toBeNull();
    expect(confirmedCandidate([A, B], 'BBB', null)).toBe(B);
    expect(confirmedCandidate([A, B], 'BBB', WS_A)).toBeNull();
    expect(confirmedCandidate([], 'AAA', WS_A)).toBeNull();
  });
  it('the call names the project, the teams and the workspace by name and the evidence, never a key', () => {
    const body = overlordLinkCallBody('project-a', A, [A, B, A]);
    expect(body).toEqual({
      class: 'big', reversible: true, question: 'Which Linear team does project-a link to?',
      options: ['Alpha Team in Workspace A', 'Beta Team', 'Leave project-a unlinked'], chosen: 'Alpha Team in Workspace A',
      why: "The Overlord linked it on its evidence: 9 of 10 ticket ids in its branches, pull requests and commits use this team's key.",
    });
    expect(JSON.stringify(body)).not.toMatch(/\bAAA\b|\bBBB\b/);
    expect(overlordLinkCallBody('project-a', B, [B]).why).toBe('The Overlord linked it on its evidence: suggested by lane-c: the branches say so.');
    const unnamed = overlordLinkCallBody('project-a', { ...A, workspaceName: null }, [A]);
    expect(unnamed.chosen).toBe('Alpha Team in a workspace whose name is unknown');
  });
  it('each text stays within the call record\'s bounds, cut on one line', () => {
    const long = { ...B, name: `Team\n${'x'.repeat(400)}`, evidence: { kind: 'suggested' as const, by: 'lane-c', why: 'y'.repeat(280) } };
    const body = overlordLinkCallBody('project-a', long, [long]) as { chosen: string; why: string; options: string[] };
    expect(body.chosen.length).toBeLessThanOrEqual(300);
    expect(body.chosen).not.toMatch(/\n/);
    expect(body.why.length).toBeLessThanOrEqual(300);
    expect(body.why.endsWith('…')).toBe(true);
    expect(body.options).toHaveLength(2);
  });
});
