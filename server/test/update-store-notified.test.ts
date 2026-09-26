// Design 2026-09-20 §6/§13 (W3 Task 1) — `releases.notifiedAt`, the
// notification group's ONE writer (`markReleaseNotified`). The dedup that makes
// a release push "once per tag, across restarts" is this column, persisted —
// never an in-memory latch (`mergedNotified`'s `Set`, watch.ts, forgets on
// restart by its own comment). Store-level only: no notifier, no push, no
// clock — every `at` is a literal so each case reads as the rule it pins.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  UPDATE_STORE_REFUSE_CODES, isUpdateStoreRefuseCode, type UpdateStoreRefuseCode,
} from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type MarkReleaseNotifiedResult, type ReleaseListingRow } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;

const dbFile = (): string => path.join(mkTmp('update-store-notified-'), 'coord.db');
const fresh = (): CoordStore => new CoordStore(openCoordDb(dbFile()));

const url = (tag: string): string => `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`;
/** One listing element in the shape the poller hands `applyReleaseListing` (W2 Task 4). */
const rel = (tag: string, publishedAt: number, over: Partial<ReleaseListingRow> = {}): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: url(tag),
  bundleListed: true, notes: null, draft: false, ...over,
});
/** The catalogue written by its own writer, so every row is one the notifier will really meet. */
const listed = (store: CoordStore, rows: readonly ReleaseListingRow[]): CoordStore => {
  expect(store.applyReleaseListing(rows, T0, 'complete').ok).toBe(true);
  return store;
};
const notifiedOf = (store: CoordStore, tag: string): number | null | undefined =>
  store.releases().find((r) => r.tag === tag)?.notifiedAt;

// The refusal words live in the ONE update-store vocabulary (W2 ruling R5:
// `UPDATE_STORE_REFUSE_CODES`, appended to — never a second array). Held equal
// to the result's arms BOTH ways at compile time (`typecheck-tests.test.ts`),
// asserted below so the lines are read.
type MarkWhy = Extract<MarkReleaseNotifiedResult, { ok: false }>['why'];
const MARK_WHYS = ['bad-tag', 'unknown-release', 'already-notified'] as const satisfies readonly MarkWhy[];
const everyWhyListed: [Exclude<MarkWhy, (typeof MARK_WHYS)[number]>] extends [never] ? true : never = true;
const everyWhyDeclared: [Exclude<MarkWhy, UpdateStoreRefuseCode>] extends [never] ? true : never = true;

describe('markReleaseNotified — the notification group\'s one writer (design 2026-09-20 §13)', () => {
  it('marks an unnotified release and answers the value it wrote; the other rows stay unmarked', () => {
    const store = listed(fresh(), [rel('v0.0.10', T0 + 2), rel('v0.0.9', T0 + 1)]);
    expect(store.markReleaseNotified('v0.0.10', T0 + 10)).toEqual({ ok: true, notifiedAt: T0 + 10 });
    expect(notifiedOf(store, 'v0.0.10')).toBe(T0 + 10);
    expect(notifiedOf(store, 'v0.0.9')).toBeNull();
  });

  it('a second mark of the same tag answers already-notified with the FIRST value and writes nothing (§18 "one push per tag")', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    expect(store.markReleaseNotified('v0.0.9', T0 + 10).ok).toBe(true);
    expect(store.markReleaseNotified('v0.0.9', T0 + 20))
      .toEqual({ ok: false, why: 'already-notified', notifiedAt: T0 + 10 });
    expect(notifiedOf(store, 'v0.0.9')).toBe(T0 + 10);
  });

  it('a restarted process reads the committed mark — a new store over the same coord.db is refused (§18 "across restarts")', () => {
    const file = dbFile();
    const before = listed(new CoordStore(openCoordDb(file)), [rel('v0.0.9', T0)]);
    expect(before.markReleaseNotified('v0.0.9', T0 + 10).ok).toBe(true);
    before.db.close();
    const after = new CoordStore(openCoordDb(file));
    expect(after.releases()[0]).toMatchObject({ tag: 'v0.0.9', notifiedAt: T0 + 10 });
    expect(after.markReleaseNotified('v0.0.9', T0 + 99))
      .toEqual({ ok: false, why: 'already-notified', notifiedAt: T0 + 10 });
  });

  it('a tag no catalogue row carries is unknown-release, and nothing is written', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    expect(store.markReleaseNotified('v0.0.10', T0 + 10)).toEqual({ ok: false, why: 'unknown-release', tag: 'v0.0.10' });
    expect(fresh().markReleaseNotified('v0.0.9', T0 + 10)).toEqual({ ok: false, why: 'unknown-release', tag: 'v0.0.9' });
    expect(notifiedOf(store, 'v0.0.9')).toBeNull();
  });

  it('a malformed tag is bad-tag — decided before any SQL, so never mistaken for an unknown release', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    for (const tag of ['0.0.9', 'v0.0', 'v0.0.9\n', '']) {
      expect(store.markReleaseNotified(tag, T0 + 10), JSON.stringify(tag)).toEqual({ ok: false, why: 'bad-tag', tag });
    }
    expect(notifiedOf(store, 'v0.0.9')).toBeNull();
  });

  it('an `at` that is not a non-negative integer throws, and marks nothing — SQLite would bind NaN as NULL', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    for (const at of [Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY]) {
      expect(() => store.markReleaseNotified('v0.0.9', at), String(at)).toThrow(RangeError);
    }
    expect(notifiedOf(store, 'v0.0.9')).toBeNull();
    // …and the tag is still markable afterwards: nothing half-wrote it.
    expect(store.markReleaseNotified('v0.0.9', T0 + 10)).toEqual({ ok: true, notifiedAt: T0 + 10 });
  });

  it('writes notifiedAt ONLY — every catalogue column, the yank mark and the refusal roll-up are as the listing left them', () => {
    // A draft is stored yanked = 1: a mark that also "cleaned" the yank would show here.
    const store = listed(fresh(), [rel('v0.0.10', T0 + 2, { draft: true, notes: 'n', channel: 'dev' }), rel('v0.0.9', T0 + 1)]);
    const before = store.releases();
    expect(store.markReleaseNotified('v0.0.10', T0 + 10).ok).toBe(true);
    expect(store.releases()).toEqual(before.map((r) => (r.tag === 'v0.0.10' ? { ...r, notifiedAt: T0 + 10 } : r)));
    expect(store.releases()[0]).toMatchObject({ tag: 'v0.0.10', yanked: true, observedAt: T0 });
  });

  it('a later listing of the same tag keeps the mark — the catalogue writer never names the column', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    expect(store.markReleaseNotified('v0.0.9', T0 + 10).ok).toBe(true);
    expect(store.applyReleaseListing([rel('v0.0.9', T0, { notes: 'edited' })], T0 + 20, 'complete').ok).toBe(true);
    expect(store.releases()[0]).toMatchObject({ notes: 'edited', observedAt: T0 + 20, notifiedAt: T0 + 10 });
  });

  it('its refusal words are declared, once each, in the ONE update-store vocabulary (W2 ruling R5)', () => {
    expect([everyWhyListed, everyWhyDeclared]).toEqual([true, true]);
    for (const c of MARK_WHYS) expect(isUpdateStoreRefuseCode(c), c).toBe(true);
    expect(new Set(UPDATE_STORE_REFUSE_CODES).size, 'a word is declared twice').toBe(UPDATE_STORE_REFUSE_CODES.length);
  });
});
