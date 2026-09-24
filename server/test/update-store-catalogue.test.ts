// Design 2026-09-20 §6/§7, W2 Task 4 — the release catalogue's ONE writer
// (`applyReleaseListing`, D-3180) and a node's
// refusal rows (decision 16). Store-level only: no poller, no GitHub, no
// clock — every `now` is a literal so each case reads as the rule it pins.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type ReleaseListingRow } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;
const NODE_A = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const NODE_B = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
const NODE_C = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';

const fresh = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('update-store-catalogue-'), 'coord.db')));

const url = (tag: string): string => `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`;

/** One listing element in the shape the poller (Task 10) hands over. */
const rel = (tag: string, publishedAt: number, over: Partial<ReleaseListingRow> = {}): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: url(tag),
  bundleListed: true, notes: null, draft: false, ...over,
});

/** A `nodes` row planted directly: Task 5's writers do not exist yet, and a
 *  refusal's only precondition is that its node IS a row. */
const plantNode = (store: CoordStore, nodeId: string, supersededBy: string | null = null): void => {
  store.db.prepare(
    'INSERT INTO nodes (nodeId, role, label, stampRead, installState, provenance, caps, floorRead, previousRead, os, reachable, supersededBy) ' +
    "VALUES (?, 'fleet', 'fleet', 'ok', 'complete', 'verified', '', 'absent', 'absent', 'linux', 1, ?)",
  ).run(nodeId, supersededBy);
};

const yankedOf = (store: CoordStore, tag: string): boolean | undefined =>
  store.releases().find((r) => r.tag === tag)?.yanked;

const refusalCount = (store: CoordStore): number =>
  (store.db.prepare('SELECT COUNT(*) AS n FROM node_release_refusals').get() as { n: number }).n;

describe('applyReleaseListing — the one writer of the catalogue columns', () => {
  it('upserts every listed row: version is the tag, a draft is yanked, observedAt is this listing, newest first', () => {
    const store = fresh();
    const r = store.applyReleaseListing([
      rel('v0.0.10', T0 + 2000, { channel: 'dev', commitSha: 'c'.repeat(40), notes: 'two fixes' }),
      rel('v0.0.9', T0 + 1000, { bundleListed: false }),
      rel('v0.0.11', T0 + 3000, { draft: true }),
    ], T0 + 5000, 'complete');
    expect(r).toEqual({ ok: true, upserted: 3, yanked: 0, unyanked: 0 });
    expect(store.releases()).toEqual([
      { tag: 'v0.0.11', version: 'v0.0.11', channel: 'stable', publishedAt: T0 + 3000, commitSha: null,
        tarballUrl: url('v0.0.11'), bundleListed: true, notes: null, yanked: true, observedAt: T0 + 5000,
        notifiedAt: null, refused: [] },
      { tag: 'v0.0.10', version: 'v0.0.10', channel: 'dev', publishedAt: T0 + 2000, commitSha: 'c'.repeat(40),
        tarballUrl: url('v0.0.10'), bundleListed: true, notes: 'two fixes', yanked: false, observedAt: T0 + 5000,
        notifiedAt: null, refused: [] },
      { tag: 'v0.0.9', version: 'v0.0.9', channel: 'stable', publishedAt: T0 + 1000, commitSha: null,
        tarballUrl: url('v0.0.9'), bundleListed: false, notes: null, yanked: false, observedAt: T0 + 5000,
        notifiedAt: null, refused: [] },
    ]);
  });

  it('never touches notifiedAt — the notifier\'s column (W3) survives a re-listing', () => {
    const store = fresh();
    expect(store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 1, 'complete').ok).toBe(true);
    store.db.prepare('UPDATE releases SET notifiedAt = ? WHERE tag = ?').run(T0 + 2, 'v0.0.9');
    expect(store.applyReleaseListing([rel('v0.0.9', T0, { notes: 'edited' })], T0 + 3, 'complete').ok).toBe(true);
    expect(store.releases()[0]).toMatchObject({ notes: 'edited', observedAt: T0 + 3, notifiedAt: T0 + 2 });
  });

  it('a release that vanishes from a complete listing is yanked and KEPT, never deleted (§18 "a yanked release is kept")', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.10', T0 + 2000), rel('v0.0.9', T0 + 1000)], T0 + 5000, 'complete');
    expect(store.applyReleaseListing([rel('v0.0.10', T0 + 2000)], T0 + 6000, 'complete'))
      .toEqual({ ok: true, upserted: 1, yanked: 1, unyanked: 0 });
    // Still a row — a node may be running it — and its observedAt is the last
    // listing that CONFIRMED it, not the one that missed it.
    expect(store.releases().map((x) => x.tag)).toEqual(['v0.0.10', 'v0.0.9']);
    expect(store.releases()[1]).toMatchObject({ tag: 'v0.0.9', yanked: true, observedAt: T0 + 5000 });
    // The mark is idempotent: the same listing again yanks nothing more.
    expect(store.applyReleaseListing([rel('v0.0.10', T0 + 2000)], T0 + 7000, 'complete'))
      .toEqual({ ok: true, upserted: 1, yanked: 0, unyanked: 0 });
  });

  // D2 (final fix wave): the previous title, "a yanked release listed again
  // comes back, and so does a draft that is published", read as two claims;
  // this case tests exactly one — a release inserted as a draft is marked
  // yanked AT BIRTH (`yanked = r.draft ? 1 : 0` on the upsert, never a real
  // vanish-then-reappear), and un-yanks the moment it is re-listed without
  // `draft`, i.e. once it is published.
  it('a release that starts as a draft (yanked at birth) is un-yanked once it is listed as published', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.10', T0 + 2000), rel('v0.0.9', T0 + 1000, { draft: true })], T0 + 5000, 'complete');
    store.applyReleaseListing([rel('v0.0.10', T0 + 2000)], T0 + 6000, 'complete');
    expect(yankedOf(store, 'v0.0.9')).toBe(true);
    expect(store.applyReleaseListing([rel('v0.0.10', T0 + 2000), rel('v0.0.9', T0 + 1000)], T0 + 7000, 'complete'))
      .toEqual({ ok: true, upserted: 2, yanked: 0, unyanked: 1 });
    expect(yankedOf(store, 'v0.0.9')).toBe(false);
  });

  // D2: the store's unyank count guards `&& !r.draft` — a release RE-LISTED
  // AS A DRAFT must never count as coming back, even though its tag was
  // previously yanked. Mutation: delete `&& !r.draft` in store.ts's unyank
  // count → this reds (unyanked becomes 1).
  it('a yanked release re-listed as a draft does not count as unyanked', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.10', T0 + 2000), rel('v0.0.9', T0 + 1000)], T0 + 5000, 'complete');
    store.applyReleaseListing([rel('v0.0.10', T0 + 2000)], T0 + 6000, 'complete');   // v0.0.9 vanishes -> yanked
    expect(yankedOf(store, 'v0.0.9')).toBe(true);
    expect(store.applyReleaseListing(
      [rel('v0.0.10', T0 + 2000), rel('v0.0.9', T0 + 1000, { draft: true })], T0 + 7000, 'complete',
    )).toEqual({ ok: true, upserted: 2, yanked: 0, unyanked: 0 });
    // Still yanked: the draft upsert writes `yanked = 1` directly (birth rule).
    expect(yankedOf(store, 'v0.0.9')).toBe(true);
  });

  it('under newest-page only rows inside the listed window are yank candidates (D-3185)', () => {
    const tags = Array.from({ length: 32 }, (_, i) => `v0.0.${i + 1}`);   // v0.0.1 is the oldest
    const at = (tag: string): number => T0 + Number(tag.split('.')[2]) * 1000;
    const seed = (s: CoordStore): void => {
      expect(s.applyReleaseListing(tags.map((t) => rel(t, at(t))), T0, 'complete').ok).toBe(true);
    };
    // The next poll: GitHub's newest page of 30, with v0.0.20 deleted upstream,
    // so the page now reaches down to v0.0.2 and v0.0.1 has fallen off it.
    const page = tags.filter((t) => t !== 'v0.0.1' && t !== 'v0.0.20').map((t) => rel(t, at(t)));
    expect(page).toHaveLength(30);

    const windowed = fresh();
    seed(windowed);
    expect(windowed.applyReleaseListing(page, T0 + 1, 'newest-page'))
      .toEqual({ ok: true, upserted: 30, yanked: 1, unyanked: 0 });
    expect(yankedOf(windowed, 'v0.0.20')).toBe(true);    // deleted INSIDE the window: observed, marked
    expect(yankedOf(windowed, 'v0.0.1')).toBe(false);    // older than the window: not observed, not marked

    // The control: the SAME page read as complete yanks both — so the case
    // above is green because of the coverage argument, not because v0.0.1
    // was never a candidate.
    const complete = fresh();
    seed(complete);
    expect(complete.applyReleaseListing(page, T0 + 1, 'complete'))
      .toEqual({ ok: true, upserted: 30, yanked: 2, unyanked: 0 });
    expect(yankedOf(complete, 'v0.0.1')).toBe(true);
  });

  it('an empty listing while releases are known is refused and writes nothing — a transient [] never yanks the catalogue', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.10', T0 + 2), rel('v0.0.9', T0 + 1)], T0 + 5, 'complete');
    expect(store.applyReleaseListing([], T0 + 6, 'complete')).toEqual({ ok: false, why: 'empty-listing', known: 2 });
    expect(store.applyReleaseListing([], T0 + 6, 'newest-page')).toEqual({ ok: false, why: 'empty-listing', known: 2 });
    expect(store.releases().map((r) => [r.tag, r.yanked, r.observedAt]))
      .toEqual([['v0.0.10', false, T0 + 5], ['v0.0.9', false, T0 + 5]]);
    // …and on an empty catalogue there is simply nothing to do.
    expect(fresh().applyReleaseListing([], T0, 'complete')).toEqual({ ok: true, upserted: 0, yanked: 0, unyanked: 0 });
  });

  it('refuses a whole listing over one bad tag, a duplicate, or a row the table cannot store — before the transaction', () => {
    const store = fresh();
    expect(store.applyReleaseListing([rel('v0.0.9', T0), rel('0.0.10', T0 + 1)], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'bad-tag', tag: '0.0.10' });
    expect(store.applyReleaseListing([rel('v0.0.9', T0), rel('v0.0.9', T0 + 1)], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'duplicate-tag', tag: 'v0.0.9' });
    expect(store.applyReleaseListing([rel('v0.0.9', Number.NaN)], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'bad-row', tag: 'v0.0.9', field: 'publishedAt' });
    expect(store.applyReleaseListing([rel('v0.0.9', T0, { tarballUrl: '' })], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'bad-row', tag: 'v0.0.9', field: 'tarballUrl' });
    expect(store.applyReleaseListing([rel('v0.0.9', T0, { channel: 'nightly' as unknown as 'dev' })], T0 + 5, 'complete'))
      .toEqual({ ok: false, why: 'bad-row', tag: 'v0.0.9', field: 'channel' });
    // The valid FIRST row of each refused listing was not written either.
    expect(store.releases()).toEqual([]);
  });

  // D-3215 (fix round 1): the latest-release probe's coverage — ONE release,
  // no absence judgment at all. The control below is exactly D-3185's own
  // "the store may mark absent now as yanked" mechanism: passing 'single'
  // must never run it, even where 'newest-page'/'complete' unambiguously would.
  describe('applyReleaseListing under \'single\' coverage (D-3215) — one release, no absence judgment', () => {
    it('upserts the one row and yanks NOTHING else, however many other releases are known', () => {
      const store = fresh();
      store.applyReleaseListing(
        [rel('v0.1.1', T0 + 1000), rel('v0.1.2', T0 + 2000), rel('v0.1.3', T0 + 3000)], T0 + 5, 'complete',
      );
      // The latest probe answers a release OLDER than all three known dev
      // releases, and names none of them — exactly the off-page-stable shape.
      expect(store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 10, 'single'))
        .toEqual({ ok: true, upserted: 1, yanked: 0, unyanked: 0 });
      expect(store.releases().map((r) => [r.tag, r.yanked])).toEqual([
        ['v0.1.3', false], ['v0.1.2', false], ['v0.1.1', false], ['v0.0.1', false],
      ]);
    });

    // The control: the SAME single-row listing under 'complete' (never what
    // the latest probe passes) yanks every other known release — proving the
    // pin above is 'single' doing the work, not an accident of small numbers.
    it('control: the identical single-row listing under \'complete\' DOES yank the others', () => {
      const store = fresh();
      store.applyReleaseListing(
        [rel('v0.1.1', T0 + 1000), rel('v0.1.2', T0 + 2000), rel('v0.1.3', T0 + 3000)], T0 + 5, 'complete',
      );
      expect(store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 10, 'complete'))
        .toEqual({ ok: true, upserted: 1, yanked: 3, unyanked: 0 });
    });

    it('un-yanks a previously-yanked release the same as any other coverage', () => {
      const store = fresh();
      store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 1, 'complete');
      // Seed a yank directly — the shape a 'complete'/'newest-page' listing
      // would leave behind; 'single' never produces one on its own.
      store.db.prepare("UPDATE releases SET yanked = 1 WHERE tag = 'v0.0.1'").run();
      expect(yankedOf(store, 'v0.0.1')).toBe(true);
      expect(store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 3, 'single'))
        .toEqual({ ok: true, upserted: 1, yanked: 0, unyanked: 1 });
      expect(yankedOf(store, 'v0.0.1')).toBe(false);
    });

    // Fix round 1, review round 2 (minor): 'single' is a promise about its
    // own argument, not just about what happens next — a listing of any
    // length but 1 is refused outright, before the transaction opens.
    // Mutation (measured by hand): dropping this check reds both cases (a
    // multi-row 'single' call would upsert every row with no yank at all).
    it("'single' coverage refuses a listing whose length is not exactly 1", () => {
      const store = fresh();
      expect(store.applyReleaseListing([], T0, 'single')).toEqual({ ok: false, why: 'single-not-one', count: 0 });
      expect(store.applyReleaseListing([rel('v0.1.1', T0), rel('v0.1.2', T0 + 1)], T0, 'single'))
        .toEqual({ ok: false, why: 'single-not-one', count: 2 });
      expect(store.releases()).toEqual([]);
    });
  });

  // I3 (fix round 1, review round 2): `keepTags` is the LISTING's own yank
  // exclusion — never itself upserted, never counted in `upserted`.
  describe('applyReleaseListing keepTags (D-3215, I3) — the listing never yanks a kept tag', () => {
    it('excludes a keptTag from the yank even though it is absent from the listing and inside the window', () => {
      const store = fresh();
      store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 1, 'complete');
      // A 'complete' listing that omits v0.0.1 would ordinarily yank it —
      // the control below proves that; keepTags stops it.
      expect(store.applyReleaseListing([rel('v0.1.1', T0 + 500)], T0 + 2, 'complete', ['v0.0.1']))
        .toEqual({ ok: true, upserted: 1, yanked: 0, unyanked: 0 });
      expect(yankedOf(store, 'v0.0.1')).toBe(false);
    });

    it('control: the identical listing with NO keepTags DOES yank it', () => {
      const store = fresh();
      store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 1, 'complete');
      expect(store.applyReleaseListing([rel('v0.1.1', T0 + 500)], T0 + 2, 'complete'))
        .toEqual({ ok: true, upserted: 1, yanked: 1, unyanked: 0 });
    });

    it('a keptTag that is not a real release tag, or that duplicates a listed one, is silently dropped — never a refusal', () => {
      const store = fresh();
      store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 1, 'complete');
      expect(store.applyReleaseListing([rel('v0.1.1', T0 + 500)], T0 + 2, 'complete', ['not-a-tag', 'v0.1.1']).ok)
        .toBe(true);
      // 'not-a-tag' dropped (not a release tag); 'v0.1.1' dropped as a
      // duplicate of the listing's own — v0.0.1 was never named, so it is
      // still yanked here (this call carries no real keepTag for it).
      expect(yankedOf(store, 'v0.0.1')).toBe(true);
    });
  });

  // F10 (fix round 1, D-3216): a null tarballUrl is the caller's honest "no
  // usable url" — never the on-disk `''` sentinel a caller may not hand in.
  describe('tarballUrl: null (D-3216, F10) — the release stays listed, only this field withheld', () => {
    it('a null tarballUrl is accepted, stored, and read back as null (never the "" sentinel)', () => {
      const store = fresh();
      expect(store.applyReleaseListing([rel('v0.0.9', T0, { tarballUrl: null })], T0 + 1, 'complete'))
        .toEqual({ ok: true, upserted: 1, yanked: 0, unyanked: 0 });
      expect(store.releases()[0]).toMatchObject({ tag: 'v0.0.9', tarballUrl: null, yanked: false });
      // The raw column really does hold the sentinel, never SQL NULL (the
      // column is NOT NULL, untouched this wave) — this is what makes the
      // read-side fold-back in `releases()` load-bearing.
      const raw = store.db.prepare("SELECT tarballUrl FROM releases WHERE tag = 'v0.0.9'").get() as { tarballUrl: string };
      expect(raw.tarballUrl).toBe('');
    });

    it('a null tarballUrl survives a re-listing that supplies a real one, and vice versa', () => {
      const store = fresh();
      store.applyReleaseListing([rel('v0.0.9', T0, { tarballUrl: null })], T0 + 1, 'complete');
      expect(store.releases()[0]!.tarballUrl).toBeNull();
      store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 2, 'complete');   // now a real url
      expect(store.releases()[0]!.tarballUrl).toBe(url('v0.0.9'));
      store.applyReleaseListing([rel('v0.0.9', T0, { tarballUrl: null })], T0 + 3, 'complete');
      expect(store.releases()[0]!.tarballUrl).toBeNull();
    });
  });

  it('a stored channel outside the vocabulary reads null, never the fleet default (D-3181)', () => {
    const store = fresh();
    store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 1, 'complete');
    store.db.prepare("UPDATE releases SET channel = 'nightly' WHERE tag = 'v0.0.9'").run();
    expect(store.releases()[0]!.channel).toBeNull();
  });

  // Fix round 1, item 5 (ruling A): the poller's targeted `GET
  // /releases/tags/{K}` answered 404, confirming K itself is gone — this
  // coverage yanks EXACTLY that tag, never the general since/window judgment.
  describe("applyReleaseListing under 'withdrawn' coverage (fix round 1, item 5, ruling A)", () => {
    it('yanks EXACTLY the named tag, however many other releases are known, and none of them', () => {
      const store = fresh();
      store.applyReleaseListing(
        [rel('v0.1.1', T0 + 1000), rel('v0.1.2', T0 + 2000), rel('v0.0.1', T0 + 500)], T0 + 5, 'complete',
      );
      expect(store.applyReleaseListing([], T0 + 10, 'withdrawn', [], 'v0.0.1'))
        .toEqual({ ok: true, upserted: 0, yanked: 1, unyanked: 0 });
      expect(store.releases().map((r) => [r.tag, r.yanked])).toEqual([
        ['v0.1.2', false], ['v0.1.1', false], ['v0.0.1', true],
      ]);
    });

    it('is idempotent: withdrawing an already-yanked tag yanks nothing more', () => {
      const store = fresh();
      store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 1, 'complete');
      expect(store.applyReleaseListing([], T0 + 2, 'withdrawn', [], 'v0.0.1'))
        .toEqual({ ok: true, upserted: 0, yanked: 1, unyanked: 0 });
      expect(store.applyReleaseListing([], T0 + 3, 'withdrawn', [], 'v0.0.1'))
        .toEqual({ ok: true, upserted: 0, yanked: 0, unyanked: 0 });
    });

    it('a tag that names no known row yanks nothing, and is still ok (there is nothing to withdraw)', () => {
      const store = fresh();
      expect(store.applyReleaseListing([], T0, 'withdrawn', [], 'v0.0.1'))
        .toEqual({ ok: true, upserted: 0, yanked: 0, unyanked: 0 });
      expect(store.releases()).toEqual([]);
    });

    it('a non-empty listing is refused before anything else runs', () => {
      const store = fresh();
      expect(store.applyReleaseListing([rel('v0.0.1', T0)], T0, 'withdrawn', [], 'v0.0.1'))
        .toEqual({ ok: false, why: 'withdrawn-not-empty', count: 1 });
      expect(store.releases()).toEqual([]);
    });

    it('a bad or missing withdrawTag is refused, writing nothing', () => {
      const store = fresh();
      store.applyReleaseListing([rel('v0.0.1', T0)], T0 + 1, 'complete');
      expect(store.applyReleaseListing([], T0 + 2, 'withdrawn', [], 'not-a-tag'))
        .toEqual({ ok: false, why: 'bad-tag', tag: 'not-a-tag' });
      expect(store.applyReleaseListing([], T0 + 2, 'withdrawn')).toEqual({ ok: false, why: 'bad-tag', tag: '' });
      expect(store.releases()[0]).toMatchObject({ yanked: false });
    });
  });

  // Fix round 1, item 5 (ruling A): K's home is DERIVED, never stored — the
  // poller reads this whenever its own remembered tag has gone null.
  describe('newestUnyankedStable — the read the poller derives K from (fix round 1, item 5, ruling A)', () => {
    it('null on an empty catalogue, or when every stable release is yanked or dev', () => {
      const store = fresh();
      expect(store.newestUnyankedStable()).toBeNull();
      store.applyReleaseListing([rel('v0.0.1', T0, { channel: 'dev' })], T0 + 1, 'complete');
      expect(store.newestUnyankedStable()).toBeNull();
      store.applyReleaseListing([rel('v0.0.2', T0 + 1)], T0 + 2, 'complete');
      store.db.prepare("UPDATE releases SET yanked = 1 WHERE tag = 'v0.0.2'").run();
      expect(store.newestUnyankedStable()).toBeNull();
    });

    it('the newest by TAG, never by publishedAt — a backdated newer tag still wins', () => {
      const store = fresh();
      store.applyReleaseListing([
        rel('v0.0.9', T0 + 5000), rel('v0.0.10', T0 + 1000), rel('v0.1.2', T0 + 2000, { channel: 'dev' }),
      ], T0 + 6000, 'complete');
      expect(store.newestUnyankedStable()).toBe('v0.0.10');
    });
  });
});

describe('node_release_refusals — a node\'s verdict on a release, never fleet-wide (decision 16)', () => {
  it('one row per (node, tag); a second verdict keeps the first; another node and the catalogue row are untouched', () => {
    const store = fresh();
    plantNode(store, NODE_A);
    plantNode(store, NODE_B);
    store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 1, 'complete');
    expect(store.refuseRelease(NODE_A, 'v0.0.9', T0 + 10, 'provenance: signature does not verify'))
      .toEqual({ ok: true, inserted: true });
    expect(store.refuseRelease(NODE_A, 'v0.0.9', T0 + 20, 'provenance: a second attempt'))
      .toEqual({ ok: true, inserted: false });
    expect(store.refusalsFor(NODE_A))
      .toEqual([{ nodeId: NODE_A, tag: 'v0.0.9', at: T0 + 10, detail: 'provenance: signature does not verify' }]);
    // §18 "a provenance failure refuses the release FOR THAT NODE": node B's
    // eligibility inputs are unchanged — no row of its own, the release not yanked.
    expect(store.refusalsFor(NODE_B)).toEqual([]);
    expect(store.releases()[0]).toMatchObject({ yanked: false, refused: [{ by: NODE_A, at: T0 + 10 }] });
  });

  it('refuses a bad tag and an unknown node, writing nothing', () => {
    const store = fresh();
    plantNode(store, NODE_A);
    expect(store.refuseRelease(NODE_A, 'v0.0', T0, 'provenance: x')).toEqual({ ok: false, why: 'bad-tag' });
    expect(store.refuseRelease(NODE_C, 'v0.0.9', T0, 'provenance: x')).toEqual({ ok: false, why: 'unknown-node' });
    expect(refusalCount(store)).toBe(0);
  });

  it('clearRefusals clears this node\'s rows only, and says how many', () => {
    const store = fresh();
    plantNode(store, NODE_A);
    plantNode(store, NODE_B);
    store.refuseRelease(NODE_A, 'v0.0.9', T0, 'provenance: x');
    store.refuseRelease(NODE_A, 'v0.0.10', T0 + 1, 'provenance: y');
    store.refuseRelease(NODE_B, 'v0.0.9', T0 + 2, 'provenance: z');
    expect(store.clearRefusals(NODE_A)).toEqual({ ok: true, cleared: 2 });
    expect(store.refusalsFor(NODE_A)).toEqual([]);
    expect(store.refusalsFor(NODE_B)).toHaveLength(1);
    expect(store.clearRefusals(NODE_A)).toEqual({ ok: true, cleared: 0 });
    expect(store.clearRefusals(NODE_C)).toEqual({ ok: false, why: 'unknown-node' });
  });

  it('the roll-up on releases() leaves out a superseded node\'s verdicts; refusalsFor still names them', () => {
    const store = fresh();
    plantNode(store, NODE_A);
    plantNode(store, 'fleet', NODE_A);                 // a label row a node-id row replaced
    store.applyReleaseListing([rel('v0.0.9', T0)], T0 + 1, 'complete');
    store.refuseRelease('fleet', 'v0.0.9', T0 + 5, 'provenance: before the re-key');
    store.refuseRelease(NODE_A, 'v0.0.9', T0 + 9, 'provenance: after it');
    expect(store.releases()[0]!.refused).toEqual([{ by: NODE_A, at: T0 + 9 }]);
    expect(store.refusalsFor('fleet')).toHaveLength(1);
  });
});
