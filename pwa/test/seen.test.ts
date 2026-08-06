import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadAcks, isUnseen, ack, prune, ackAll, acksSnapshot, resetAcks, subscribeAcks } from '../src/lib/seen';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession =>
  ({ id: 'cc-a', bucket: 'attention', bucketSince: 1000, ...over } as FleetSession);

// BOTH, and the second one is not belt-and-braces. The module's map is
// document-lifetime on purpose (seen.ts's `acksSnapshot`: nothing re-reads
// storage after the first load, so a write storage refuses cannot be rolled
// back by the next tick), which means clearing the key does NOT clear the
// module — without `resetAcks` each case here inherits the previous case's
// acks.
beforeEach(() => {
  localStorage.clear();
  resetAcks();
});

describe('seen watermark', () => {
  it('is unseen when the bucket started after the ack', () => {
    expect(isUnseen(s({}), { 'cc-a': 999 })).toBe(true);
  });

  it('is seen when the ack is at or after the bucket start', () => {
    expect(isUnseen(s({}), { 'cc-a': 1000 })).toBe(false);
    expect(isUnseen(s({}), { 'cc-a': 1001 })).toBe(false);
  });

  it('is unseen with no ack at all', () => {
    expect(isUnseen(s({}), {})).toBe(true);
  });

  it('never badges working or idle — nothing is being asked of you', () => {
    expect(isUnseen(s({ bucket: 'working' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'idle' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'dead' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'archived' }), {})).toBe(false);
  });

  it('badges attention, done and cleanup', () => {
    for (const bucket of ['attention', 'done', 'cleanup'] as const) {
      expect(isUnseen(s({ bucket }), {})).toBe(true);
    }
  });

  it('is seen when there is no evidence of when the bucket began', () => {
    // A null bucketSince cannot prove anything is new; badging it would fire on
    // every render forever.
    expect(isUnseen(s({ bucketSince: null }), {})).toBe(false);
  });

  it('round-trips through localStorage', () => {
    ack('cc-a', 4242);
    expect(loadAcks()).toEqual({ 'cc-a': 4242 });
  });

  it('survives a corrupt store by starting empty', () => {
    localStorage.setItem('ccrc:seen:v1', 'not json');
    expect(loadAcks()).toEqual({});
  });

  it('prune drops ids that are no longer in the fleet — and persists the drop', () => {
    ack('cc-a', 1); ack('cc-gone', 1);
    expect(prune(new Set(['cc-a']))).toEqual({ 'cc-a': 1 });
    // Re-read, not the returned object: the returned map is right even in a
    // build where the save was dropped or inverted, and a watermark that is
    // only correct in memory is gone at the next reload.
    expect(loadAcks()).toEqual({ 'cc-a': 1 });
  });

  it('prune keeps everything when the fleet reads empty — that is not proof the fleet is', () => {
    // readRegistry returns [] both for "no sessions" and for "readdir failed"
    // (server/src/registry.ts), and watch.ts broadcasts that [] unguarded. If
    // the empty set pruned, one unreadable-registry second would delete the
    // whole persisted watermark and re-badge every acked session in the fleet.
    ack('cc-a', 1); ack('cc-b', 2);
    expect(prune(new Set())).toEqual({ 'cc-a': 1, 'cc-b': 2 });
    expect(loadAcks()).toEqual({ 'cc-a': 1, 'cc-b': 2 });
  });

  it('ackAll marks every given session seen at the given time — and persists it', () => {
    const acks = ackAll([s({ id: 'cc-a' }), s({ id: 'cc-b' })], 5000);
    expect(acks).toEqual({ 'cc-a': 5000, 'cc-b': 5000 });
    // Same reason as prune above: "mark all seen" that never reaches storage
    // clears every badge until the reload that brings them all back.
    expect(loadAcks()).toEqual({ 'cc-a': 5000, 'cc-b': 5000 });
  });
});

// Whole-branch review, finding 4. `bucketSince` is minted on the FLEET HOST's
// clock; both writers of this map stamp the DEVICE's. Nothing mixed the two in
// a test, so a device running behind the host — a laptop just resumed, a phone
// with no NTP — could not clear a badge at all.
describe('the two clocks', () => {
  const SERVER_NOW = 1_800_000_000_000;
  const BEHIND = SERVER_NOW - 90_000; // this device, 90s slow

  it('cannot be left unseen by acking on a device clock behind the host', () => {
    const session = s({ bucketSince: SERVER_NOW });
    expect(isUnseen(session, ack('cc-a', BEHIND, session.bucketSince))).toBe(false);
  });

  it('does the same through ackAll — the chip\'s "Mark all seen" is the same skew', () => {
    const fleet = [s({ id: 'cc-a', bucketSince: SERVER_NOW }), s({ id: 'cc-b', bucketSince: SERVER_NOW })];
    const acks = ackAll(fleet, BEHIND);
    for (const session of fleet) expect(isUnseen(session, acks)).toBe(false);
  });

  it('still takes the device clock when it is AHEAD of the episode', () => {
    // The floor must not become a ceiling: acking at the episode's own start
    // would leave the NEXT episode — whose bucketSince is later than this ack
    // but earlier than `now` — arriving pre-acked on a fast device.
    expect(ack('cc-a', SERVER_NOW + 60_000, SERVER_NOW)).toEqual({ 'cc-a': SERVER_NOW + 60_000 });
  });

  it('acks at the given instant when there is no episode start to floor to', () => {
    // The deep-link case: SessionScreen mounts before /ws/fleet lands, so
    // there is no bucketSince yet. Nothing to floor against, nothing invented.
    expect(ack('cc-a', 4242)).toEqual({ 'cc-a': 4242 });
  });
});

// Whole-branch review, finding 3. Every mutator used to re-read localStorage
// as its base map, so a write storage REFUSED was rolled back by whatever ran
// next — and on the fleet screen `prune` runs on every snapshot, i.e. within
// seconds. `save` swallows the throw and publishes regardless (deliberately:
// the badge this document is showing is the in-memory one), which is exactly
// what made the rollback invisible.
describe('a store that refuses to be written', () => {
  const refuse = (): void => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
  };
  afterEach(() => vi.restoreAllMocks());

  it('keeps the ack when the very next fleet snapshot prunes', () => {
    const session = s({ bucketSince: 1000 });
    refuse();
    expect(isUnseen(session, ack('cc-a', 2000))).toBe(false);
    // The fleet screen's own prune effect, one tick later, against a fleet
    // that still holds the session. Nothing to drop — and nothing to undo.
    expect(isUnseen(session, prune(new Set(['cc-a'])))).toBe(false);
  });

  it('keeps every ack in a sequence, not just the last one', () => {
    refuse();
    ack('cc-a', 5000);
    expect(ack('cc-b', 5000)).toEqual({ 'cc-a': 5000, 'cc-b': 5000 });
    expect(acksSnapshot()).toEqual({ 'cc-a': 5000, 'cc-b': 5000 });
  });

  it('prune still drops what the fleet no longer has', () => {
    ack('cc-a', 1); ack('cc-gone', 1);
    refuse();
    expect(prune(new Set(['cc-a']))).toEqual({ 'cc-a': 1 });
  });
});

// The 'why' comment above loadAcks is load-bearing: it is where the next
// reader learns whether a server-side notion of a viewer exists. It said none
// did, while server/src/presence.ts is exactly that and already suppresses
// pushes across devices — the "comment asserts more than the code proves"
// defect this repo treats as real. A comment cannot be checked by rendering,
// so it is checked by reading, the same way fleet-css.test.ts checks CSS.
describe('the per-device rationale', () => {
  const src = readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'lib', 'seen.ts'), 'utf8');
  // Gutters stripped and whitespace collapsed, so a claim cannot slip past by
  // being re-wrapped across two comment lines — which is exactly how the
  // original wording ("the server has no\n * notion of a viewer") first
  // escaped a literal search.
  const doc = src.slice(0, src.indexOf('export function loadAcks'))
    .replace(/^[ \t]*\*[ \t]?/gm, '')
    .replace(/\s+/g, ' ');

  it('does not deny the server-side viewer notion that presence.ts is', () => {
    expect(doc).not.toMatch(/server has no notion of a viewer/);
  });

  it('names presence.ts and says what that other viewer notion actually decides', () => {
    expect(doc).toMatch(/presence\.ts/);
    expect(doc).toMatch(/push/i);
  });

  // Same class of defect, found by the whole-branch review: `acksSnapshot`'s
  // doc asserted "this module is the only writer in the document, so the
  // snapshot cannot go stale behind it" while `prune` re-read storage on every
  // fleet snapshot and republished it over the module's own map. Comments in
  // this repo ARE the contract, so the claim is checked against the code.
  it('does not claim a read-once snapshot while a mutator re-reads storage', () => {
    const whole = src.replace(/^[ \t]*\*[ \t]?/gm, '').replace(/\s+/g, ' ');
    expect(whole).toMatch(/read exactly ONCE|Reads storage exactly once/i);
    // The claim is only true if the three mutators base off the published
    // map. Their bodies, comments stripped so prose about `loadAcks` cannot
    // fail this — the CALL is what would make the docstring false.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const fn of ['ack', 'ackAll', 'prune']) {
      const body = new RegExp(`export function ${fn}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(code)?.[1];
      expect(body, `no body found for ${fn}`).toBeTruthy();
      expect(body).toContain('base()');
      expect(body).not.toContain('loadAcks(');
    }
  });
});

// localStorage is a write-through log, not a change feed: writing it notifies
// nobody. The fleet screen is mounted for the whole app lifetime while the
// OTHER writer is a different screen (SessionScreen acks on mount), so without
// a publish the fleet keeps drawing the map it read at boot.
describe('the map as a subscribable value', () => {
  it('wakes subscribers on every write, and stops on unsubscribe', () => {
    const seen: Array<Record<string, number>> = [];
    const off = subscribeAcks(() => seen.push({ ...acksSnapshot() }));

    ack('cc-a', 7);
    expect(seen).toEqual([{ 'cc-a': 7 }]);

    // 9, floored to the fixture's own bucketSince of 1000 — see the
    // clock-skew block below for why the stamp is never allowed to land
    // before the episode it acknowledges.
    ackAll([s({ id: 'cc-b' })], 9);
    expect(seen.at(-1)).toEqual({ 'cc-a': 7, 'cc-b': 1000 });

    off();
    ack('cc-c', 11);
    expect(seen).toHaveLength(2);
  });

  it('keeps ONE object identity while the map says the same thing', () => {
    // useSyncExternalStore compares identities. `prune` runs on every fleet
    // snapshot and usually drops nothing; re-publishing an equal map there
    // would re-render the whole fleet several times a second.
    ack('cc-a', 1);
    const before = acksSnapshot();
    let woken = 0;
    const off = subscribeAcks(() => { woken += 1; });
    expect(prune(new Set(['cc-a']))).toEqual({ 'cc-a': 1 });
    expect(acksSnapshot()).toBe(before);
    expect(woken).toBe(0);
    off();
  });

  it('reflects the acked value, not just a changed identity', () => {
    ack('cc-a', 1);
    expect(isUnseen(s({ bucketSince: 5 }), acksSnapshot())).toBe(true);
    ack('cc-a', 10);
    expect(isUnseen(s({ bucketSince: 5 }), acksSnapshot())).toBe(false);
  });
});
