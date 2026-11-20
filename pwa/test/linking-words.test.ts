// D-8808: the evidence clause for every kind of team evidence, including the two wave 8 added.
import { describe, it, expect } from 'vitest';
import { evidenceWords, candidateWhy } from '../src/fleet/linkingWords';

describe('evidenceWords', () => {
  it('words each kind of evidence', () => {
    expect(evidenceWords({ kind: 'ticket-ids', ids: 9, of: 10 }, 'AAA')).toBe('9 of 10 ticket ids in its branches, pull requests and commits use AAA');
    expect(evidenceWords({ kind: 'name-match', matched: 'repo', on: 'key' }, 'AAA')).toBe('the repository name matches the team key');
    expect(evidenceWords({ kind: 'pr-attachments', ids: 4, of: 5 }, 'AAA')).toBe("4 of 5 issues attached to this repository's merged pull requests are AAA issues");
    expect(evidenceWords({ kind: 'suggested', by: 'lane-a', why: 'the branches name it' }, 'AAA')).toBe('suggested by lane-a: the branches name it');
  });
  it('a suggested candidate reads as the team name, then who suggested it and why', () => {
    expect(candidateWhy({ key: 'AAA', name: 'Alpha', evidence: { kind: 'suggested', by: 'lane-a', why: 'a reason' } })).toBe('Alpha: suggested by lane-a: a reason');
  });
});

// D-8808 (wave 8, Task 8.6): the workspace picker's and the candidate rows' words.
import {
  candidateAriaLabel, candidateKeyOf, candidateWorkspaceLine, teamLinkLine, workspaceToWrite, workspacesHoldingKey,
  OVERLORD_LINK_WORDS, PICKER_WORDS,
} from '../src/fleet/linkingWords';
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
