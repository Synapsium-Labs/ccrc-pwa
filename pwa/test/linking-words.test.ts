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
