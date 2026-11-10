// D-8147: the linking standard's deciders (server/src/linking/policy.ts) and vocabulary (shared/linking.ts).
// Neutral examples only: KEY-123, project-a.
import { describe, it, expect } from 'vitest';
import {
  VISIBILITY_MAX_AGE_MS, VISIBILITY_RETRY_MS, linkingMode, ticketRefOfBranch, trackerIdsIn, parseLinkingWrite, visibilityDue,
} from '../src/linking/policy.js';
import type { ProjectLinkingWire } from '../../shared/linking.js';

type Measured = ProjectLinkingWire['measured'];
const measured = (visibility: 'public' | 'private' | 'internal'): Measured =>
  ({ state: 'measured', visibility, slug: 'owner/repo', template: 'absent', at: 1 });

describe('linkingMode', () => {
  it('an override wins over any reading', () => {
    expect(linkingMode('public', measured('private'))).toBe('public');
    expect(linkingMode('private', measured('public'))).toBe('private');
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
