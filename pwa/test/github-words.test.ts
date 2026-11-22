// Settings › Integrations › GitHub's words and the one decision behind its status line (D-8932).
// The card is read-only and reads nothing new: its status comes from the visibility readings the project list carries,
// each one GitHub call the fleet box made. Pure: readings in, words out.
import { describe, expect, it } from 'vitest';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';
import type { ProjectLinkingWire } from '../../shared/linking';
import { GITHUB_TEXT, githubSignIn, githubStatus } from '../src/fleet/githubWords';

type Reading = ProjectLinkingWire['measured'];
const ok = (at: number): Reading => ({ state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at });
const failed = (reason: string, at: number): Reading => ({ state: 'failed', reason, at });
const ago = (at: number): string => `${100 - at}m`;

describe('what the readings say about the fleet box GitHub sign-in', () => {
  it('a reading that succeeded says GitHub answered then; the newest one is the one said', () => {
    expect(githubSignIn([ok(10), ok(40), { state: 'unmeasured' }])).toEqual({ kind: 'answered', at: 40 });
  });
  it('a reading refused for the sign-in says so, when it is the newest that speaks to it', () => {
    expect(githubSignIn([ok(10), failed('unauthenticated', 40)])).toEqual({ kind: 'refused', at: 40 });
    expect(githubSignIn([failed('unauthenticated', 10), ok(40)]), 'a later success: the sign-in was mended').toEqual({ kind: 'answered', at: 40 });
    expect(githubSignIn([ok(40), failed('unauthenticated', 40)]), 'a tie goes to the refusal').toEqual({ kind: 'refused', at: 40 });
  });
  it('a failure that is not about the sign-in says nothing of it', () => {
    for (const reason of ['offline', 'rate-limit', 'unavailable', 'no-remote', 'not-ran', 'bad-answer']) {
      expect(githubSignIn([failed(reason, 90)]), reason).toEqual({ kind: 'unknown' });
      expect(githubSignIn([ok(10), failed(reason, 90)]), reason).toEqual({ kind: 'answered', at: 10 });
    }
  });
  it('no reading at all is unknown, never signed in', () => {
    expect(githubSignIn([])).toEqual({ kind: 'unknown' });
    expect(githubSignIn([{ state: 'unmeasured' }, { state: 'unmeasured' }])).toEqual({ kind: 'unknown' });
  });
});

describe("the card's status line", () => {
  it('each state has its own words, and only a refusal is amber', () => {
    expect(githubStatus('loading', ago)).toEqual({ state: 'loading', words: null, amber: false });
    expect(githubStatus('failed', ago)).toEqual({ state: 'unread', words: GITHUB_TEXT.unread, amber: false });
    expect(githubStatus([ok(40)], ago)).toEqual({ state: 'answered', words: 'GitHub answered the fleet box 60m ago, so its sign-in worked then.', amber: false });
    expect(githubStatus([failed('unauthenticated', 70)], ago)).toEqual({
      state: 'refused', amber: true,
      words: "GitHub refused the fleet box's sign-in 30m ago. Run gh auth login on the fleet box, then ccrc doctor to check it.",
    });
    expect(githubStatus([], ago)).toEqual({ state: 'unknown', words: GITHUB_TEXT.unknown, amber: false });
  });
  it('never claims more than a reading proves: no "signed in" now, no account, no scope, no token', () => {
    const said = [
      GITHUB_TEXT.uses, GITHUB_TEXT.coming, GITHUB_TEXT.unknown, GITHUB_TEXT.unread,
      GITHUB_TEXT.answered('3h'), GITHUB_TEXT.refused('3h'),
    ].join(' ');
    expect(said).not.toMatch(/\bsigned in as\b|\bscope|\btoken\b|\baccount\b/i);
    // A reading that succeeded proves the sign-in worked THEN; the line that says so never says it holds now.
    expect(GITHUB_TEXT.answered('3h')).not.toMatch(/\bis signed in\b|\bsigned in now\b/i);
    expect(GITHUB_TEXT.answered('3h')).toContain('then');
  });
  it('says what is used today and that a stored key is coming', () => {
    expect(GITHUB_TEXT.uses).toContain('ccrc holds no GitHub key');
    expect(GITHUB_TEXT.uses).toContain('fleet box');
    // What the sign-in is used for, merging included, and the two facts a stored key is about: it can write, and it is shared.
    // The write access is said as what follows from the uses, not as a reading: the card has none of the sign-in's permissions.
    expect(GITHUB_TEXT.uses).toBe('ccrc holds no GitHub key. It reaches GitHub through the GitHub CLI signed in on the fleet box. '
      + 'That sign-in reads pull requests, their checks and repository visibility, opens pull requests and merges them, '
      + 'so it has to be able to write to the repositories. Every session on the fleet box uses the same one.');
    // The card's purpose line is the short one: the body carries the facts, said once.
    expect(SETTINGS_CARDS.integrations.github.purpose).toBe('How ccrc reaches GitHub.');
    expect(GITHUB_TEXT.coming).toMatch(/is coming/);
  });
});
