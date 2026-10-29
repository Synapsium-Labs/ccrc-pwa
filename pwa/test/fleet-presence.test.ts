// `fleet/presence.ts`, the PWA's one reader of the server's presence (D-7181; Task C7c Step 3; ARCH-49): each word, the
// absent key (the skew row: a server older than ARCH-48, or a snapshot written before D-7208), a word this build does
// not know, the coordinator's frame and claim rules, and the pane predicate the wording sites keep (OA-C15 (a), D-7265).
import { describe, expect, it } from 'vitest';
import type { FleetSession, Presence } from '../../shared/api';
import { coordinatorPresence, paneGone, presenceOf, type CoordinatorPresence } from '../src/fleet/presence';
import { deadSession, fleetSession, hibernatedSession } from './fleetFixture';
import { tableRows } from './presenceTable';

const WORDS: readonly Presence[] = ['alive', 'asleep', 'dead', 'unknown'];

describe('presenceOf reads the server\'s word', () => {
  it.each(WORDS)('a row carrying `%s` reads `%s`', (p) => {
    expect(presenceOf(fleetSession({ presence: p }))).toBe(p);
  });

  it('the skew row: no key reads `unknown`, never `alive` and never `dead`', () => {
    expect(presenceOf(fleetSession({ status: 'dead', presence: undefined }))).toBe('unknown');
    expect(presenceOf(fleetSession({ status: 'idle', presence: undefined }))).toBe('unknown');
    expect(presenceOf({})).toBe('unknown');
  });

  it('a word this build has never heard of reads `unknown` (the frame is cast, not revived)', () => {
    expect(presenceOf({ presence: 'zombie' as never })).toBe('unknown');
    expect(presenceOf({ presence: 7 as never })).toBe('unknown');
  });

  it('every row of the liveness table reads the server\'s presence, and the skew row `unknown`', () => {
    for (const r of tableRows()) {
      if (r.session === null) continue;
      const s = fleetSession({ ...r.session, ...(r.presence === undefined ? { presence: undefined } : { presence: r.presence }) });
      expect(presenceOf(s), r.name).toBe(r.presence ?? 'unknown');
    }
  });
});

describe('coordinatorPresence: coordPresence\'s frame and claim rules over the server\'s word', () => {
  const ID = 'session-a';
  const WORD: Record<Presence, CoordinatorPresence> = { alive: 'alive', asleep: 'hibernated', dead: 'dead', unknown: 'unknown' };

  it.each(WORDS)('a listed claimant whose presence is `%s` reads its four-word spelling', (p) => {
    expect(coordinatorPresence(ID, fleetSession({ id: ID, presence: p }), true)).toBe(WORD[p]);
  });

  it('the fixtures read as the server sends them: dead, hibernated, alive', () => {
    expect(coordinatorPresence(ID, deadSession({ id: ID }), true)).toBe('dead');
    expect(coordinatorPresence(ID, hibernatedSession(1_784_500_000_000, { id: ID }), true)).toBe('hibernated');
    expect(coordinatorPresence(ID, fleetSession({ id: ID }), true)).toBe('alive');
  });

  const UNKNOWN: readonly [string, string | null, FleetSession | null | undefined, boolean][] = [
    ['the run names no claimant', null, deadSession({ id: ID }), true],
    ['no fleet frame has landed', ID, deadSession({ id: ID }), false],
    ['the claimant is missing from the landed frame', ID, null, true],
    ['the lookup missed (undefined, not null)', ID, undefined, true],
    ['the row carries no presence (an older server)', ID, fleetSession({ id: ID, status: 'dead', presence: undefined }), true],
  ];
  it.each(UNKNOWN)('reads `unknown` when %s', (_why, claimedBy, session, frameSeen) => {
    expect(coordinatorPresence(claimedBy, session, frameSeen)).toBe('unknown');
  });

  // The two coordinator rulings within OA-C15 (a), over the server's `dead` only: every other word passes through.
  const STAMP = { at: 1, text: 'tmux: no server running' };
  it('D-7370: a substrate stamp over a pane the server reads `dead` reads `unknown` (D-309: it may be alive)', () => {
    expect(coordinatorPresence(ID, deadSession({ id: ID, substrate: STAMP }), true)).toBe('unknown');
    expect(coordinatorPresence(ID, fleetSession({ id: ID, presence: 'dead', substrate: STAMP }), true)).toBe('unknown');
  });

  it('D-7371: a hibernation stamp over a pane the server reads `dead` reads `hibernated` (D-5430), stamp or no stamp', () => {
    expect(coordinatorPresence(ID, deadSession({ id: ID, hibernatedAt: 1_784_500_000_000 }), true)).toBe('hibernated');
    expect(coordinatorPresence(ID, deadSession({ id: ID, lifecycle: 'never-started', hibernatedAt: 1_784_500_000_000 }), true)).toBe('hibernated');
    expect(coordinatorPresence(ID, deadSession({ id: ID, hibernatedAt: 1_784_500_000_000, substrate: STAMP }), true)).toBe('hibernated');
  });

  it.each(['alive', 'asleep', 'unknown'] as const)('neither rule touches the server\'s `%s`', (p) => {
    const row = fleetSession({ id: ID, status: 'dead', presence: p, substrate: STAMP, hibernatedAt: 1_784_500_000_000 });
    expect(coordinatorPresence(ID, row, true)).toBe(WORD[p]);
  });
});

describe('paneGone words the pane, not the session', () => {
  it('is the assembly\'s dead status, whatever the presence', () => {
    for (const p of [...WORDS, undefined]) {
      expect(paneGone(fleetSession({ status: 'dead', presence: p })), String(p)).toBe(true);
      expect(paneGone(fleetSession({ status: 'idle', presence: p })), String(p)).toBe(false);
      expect(paneGone(fleetSession({ status: 'busy', presence: p })), String(p)).toBe(false);
    }
  });
});
