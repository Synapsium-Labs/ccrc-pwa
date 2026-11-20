// D-8808: the evidence clause for every kind of team evidence, including the two wave 8 added.
import { describe, it, expect } from 'vitest';
import { evidenceWords, candidateWhy } from '../src/fleet/linkingWords';

describe('evidenceWords', () => {
  it('words each kind of evidence', () => {
    expect(evidenceWords({ kind: 'ticket-ids', ids: 9, of: 10 }, 'AAA')).toBe('9 of 10 ticket ids in its branches, pull requests and commits use AAA');
    expect(evidenceWords({ kind: 'name-match', matched: 'repo', on: 'key' }, 'AAA')).toBe('the repository name matches the team key');
    expect(evidenceWords({ kind: 'pr-attachments', ids: 4, of: 5 }, 'AAA')).toBe("4 of 5 issues attached to this repository's merged pull requests are AAA issues");
    expect(evidenceWords({ kind: 'suggested', by: 'lane-a', why: 'the branches name it' }, 'AAA')).toBe('suggested by lane-a — the branches name it');
  });
  it('a suggested candidate reads as the team name, then who suggested it and why', () => {
    expect(candidateWhy({ key: 'AAA', name: 'Alpha', evidence: { kind: 'suggested', by: 'lane-a', why: 'a reason' } })).toBe('Alpha: suggested by lane-a — a reason');
  });
});

// D-8808 (wave 8, Task 8.6): the workspace picker's and the candidate rows' words.
import {
  candidateAriaLabel, candidateKeyOf, candidateTap, candidateWorkspaceLine, keyWriteText, teamLinkLine, workspaceToWrite, workspacesHoldingKey,
  OVERLORD_LINK_WORDS, PICKER_WORDS,
} from '../src/fleet/linkingWords';
import { ApiError } from '../src/lib/apiError';
import { LINKING_REFUSAL_TEXT } from '../src/lib/refusalWords';
import type { LinearWorkspaceShown } from '../../shared/linear';
import type { ProjectLinkingWire } from '../../shared/linking';

const ws = (id: string, name: string | null, keys: string[]): LinearWorkspaceShown =>
  ({ id, name, urlKey: null, user: null, teams: keys.map((key) => ({ key, name: key })), keyTail: null, checkedAt: null });

describe('the workspace picker', () => {
  const read = [ws('id-a', 'ws-a', ['AAA', 'BBB']), ws('id-b', 'ws-b', ['AAA']), ws('id-c', null, ['CCC'])];
  it('lists the connected workspaces that hold the typed key, whatever its case, by name', () => {
    expect(workspacesHoldingKey(read, 'aaa')).toEqual([{ id: 'id-a', name: 'ws-a' }, { id: 'id-b', name: 'ws-b' }]);
    expect(workspacesHoldingKey(read, 'CCC')).toEqual([{ id: 'id-c', name: PICKER_WORDS.unnamed }]);
    expect(workspacesHoldingKey(read, 'ZZZ')).toEqual([]);
    expect(workspacesHoldingKey(null, 'AAA')).toEqual([]);
  });
  it('a key held by one workspace writes it, by none writes nothing, by two writes the choice (or nothing before one is made)', () => {
    const one = [{ id: 'id-a', name: 'ws-a' }];
    expect(workspaceToWrite(one, '')).toBe('id-a');
    expect(workspaceToWrite([], 'id-a')).toBeUndefined();
    const two = [{ id: 'id-a', name: 'ws-a' }, { id: 'id-b', name: 'ws-b' }];
    expect(workspaceToWrite(two, 'id-b')).toBe('id-b');
    expect(workspaceToWrite(two, '')).toBeUndefined();
    expect(workspaceToWrite(two, 'id-gone')).toBeUndefined();
  });
});

describe('the candidate rows', () => {
  const c = { key: 'AAA', name: 'Alpha', evidence: { kind: 'name-match', matched: 'repo', on: 'key' } as const };
  it('names the workspace, and keys a row by key and workspace', () => {
    expect(candidateWorkspaceLine({ ...c, workspaceId: 'id-a', workspaceName: 'ws-a' })).toBe('In workspace ws-a');
    expect(candidateWorkspaceLine({ ...c, workspaceId: 'id-a', workspaceName: null })).toBe(PICKER_WORDS.unnamedIn);
    expect(candidateWorkspaceLine(c)).toBeNull();
    expect(candidateAriaLabel({ ...c, workspaceId: 'id-a', workspaceName: 'ws-a' })).toBe('Link AAA in workspace ws-a');
    expect(candidateAriaLabel(c)).toBe('Link AAA');
    expect(candidateKeyOf({ ...c, workspaceId: 'id-a' })).not.toBe(candidateKeyOf({ ...c, workspaceId: 'id-b' }));
  });
  it("keys a row by its evidence kind and suggester too, so one pair offered twice is two rows (review 2971 A2)", () => {
    const pass = { ...c, workspaceId: 'id-a' };
    const byA = { ...pass, evidence: { kind: 'suggested' as const, by: 'lane-a', why: 'a reason' } };
    const byB = { ...pass, evidence: { kind: 'suggested' as const, by: 'lane-b', why: 'a reason' } };
    const keys = [pass, byA, byB].map(candidateKeyOf);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("a refused key write's words (review 2971 F4)", () => {
  const refused = (error: string) => new ApiError(409, { ok: false, error });
  it('team-ambiguous points at the picker when the card lists two holders, else says the list could not be read', () => {
    expect(keyWriteText(refused('team-ambiguous'), 2)).toBe(PICKER_WORDS.ambiguous);
    expect(keyWriteText(refused('team-ambiguous'), 1)).toBe(PICKER_WORDS.ambiguousUnlisted);
    expect(keyWriteText(refused('team-ambiguous'), 0)).toBe(PICKER_WORDS.ambiguousUnlisted);
    expect(PICKER_WORDS.ambiguous).toContain(PICKER_WORDS.label);
  });
  it('every other refusal is the write\'s own sentence', () => {
    expect(keyWriteText(refused('team-unknown'), 2)).toBe(LINKING_REFUSAL_TEXT['team-unknown']);
    expect(keyWriteText(refused('bad-team-key'), 0)).toBe(LINKING_REFUSAL_TEXT['bad-team-key']);
  });
});

describe('an Overlord link', () => {
  const l: ProjectLinkingWire = {
    teamKey: 'AAA', override: null, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
    measured: { state: 'unmeasured' },
    teamLink: { source: 'overlord', teamName: 'Alpha', evidence: { kind: 'ticket-ids', ids: 9, of: 10 }, at: 1, callId: 7 },
  };
  it('reads as a call made for the operator, and says how to overturn it', () => {
    expect(teamLinkLine(l)).toBe(`Linked by the Overlord for you to Alpha: 9 of 10 ticket ids in its branches, pull requests and commits use AAA. ${OVERLORD_LINK_WORDS.overturn}`);
    expect(OVERLORD_LINK_WORDS.call).toBe('See it in Calls made for you');
  });
});

// D-8808 (final review I2): a candidate's tap never writes a shared key with no workspace.
describe('a candidate\'s tap', () => {
  const read = [ws('id-a', 'ws-a', ['AAA', 'BBB']), ws('id-b', 'ws-b', ['AAA'])];
  const bare = { key: 'AAA', name: 'Alpha', evidence: { kind: 'suggested', by: 'lane-a', why: 'the branches' } } as const;
  it('a candidate with a workspace writes its pair', () => {
    expect(candidateTap({ ...bare, workspaceId: 'id-b', workspaceName: 'ws-b' }, read)).toEqual({ kind: 'write', workspace: 'id-b' });
  });
  it('one with no workspace whose key several workspaces hold asks for the workspace, writing nothing', () => {
    expect(candidateTap(bare, read)).toEqual({ kind: 'pick' });
  });
  it('one with no workspace whose key one workspace holds writes that workspace; none known writes the key alone', () => {
    expect(candidateTap({ ...bare, key: 'BBB' }, read)).toEqual({ kind: 'write', workspace: 'id-a' });
    expect(candidateTap(bare, null)).toEqual({ kind: 'write' });
    expect(candidateTap({ ...bare, key: 'ZZZ' }, read)).toEqual({ kind: 'write' });
  });
});
