// The review store (L3): the commit point, the removal order, the write failures and boot. Task R1.3 of the
// draft-review plan. Every test opens the store in a directory under a `mkTmp` fixture, through a `ReviewFs` that can
// record the order of its calls or fail any one of them.

import {
  chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, truncateSync, unlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DOCS_EXPORT_MAX_BYTES } from '../../shared/docs.js';
import {
  isReviewToken, REVIEW_IDLE_MS, REVIEW_MAX_LIVE, REVIEW_MAX_STORE_BYTES, REVIEW_RETENTION_MS, REVIEW_TOMBSTONE_MS,
  type ReviewSource,
} from '../../shared/docsReview.js';
import { matchesShape } from '../src/accounts/shapes.js';
import { projectList } from '../src/review/policy.js';
import {
  nodeReviewFs, openReviewStore, type ReviewFs, type ReviewStore,
} from '../src/review/store.js';
import { mkTmp } from './tmpHelpers.js';

const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 20);
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

// Every failed disk act is logged once; a test that fails a call on purpose would otherwise print it. The spy is
// restored after each test, and the N9 row reads its calls.
let warn: MockInstance<typeof console.warn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

const sha256 = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex');
const html = (n: number | string): Uint8Array => Buffer.from(`<!doctype html><p>draft ${n}</p>`);

function src(n = 0): ReviewSource {
  return {
    project: 'project-a', section: 'specs', path: `x${n}.md`, branch: 'feature-a', head: 'a'.repeat(40),
    servedRef: 'refs/heads/feature-a', baseCommit: 'b'.repeat(40), fp: 'd'.repeat(64), committedBlob: null,
  };
}

/** The fixture store directory: it does not exist yet, so `open` creates it. */
const freshDir = (): string => path.join(mkTmp('ccrc-review-store-'), 'review-shares');

type Op = 'mkdir' | 'open' | 'write' | 'fsync' | 'rename' | 'unlink' | 'readdir' | 'readFile' | 'stat';

/** A `ReviewFs` over the real one that records every call as `<op> <label>` and fails or pauses the ones a test says
 *  (`fail` and `gate` receive that same `<op> <label>` string).
 *  A label drops the directory, shows the share's hash as `H` and a removal's id as `ID`, and a temporary file's random
 *  part is cut, so a test names a call without knowing either. A directory is `DIR`. */
class FaultFs implements ReviewFs {
  readonly log: string[] = [];
  fail: (label: string, op: Op) => boolean = () => false;
  gate: ((label: string, op: Op) => Promise<void>) | null = null;
  /** Called after an `open` has succeeded (the descriptor exists), so a test can pause between an open and what follows. */
  afterOpen: ((call: string) => Promise<void>) | null = null;
  private readonly paths = new WeakMap<FileHandle, string>();

  constructor(private readonly dir: string) {}

  label(p: string): string {
    if (p === this.dir) return 'DIR';
    return path.basename(p).replace(/[0-9a-f]{64}/g, 'H').replace(/[0-9a-f]{32}(?=\.removed)/g, 'ID')
      .replace(/\.[0-9a-f]{12}\.tmp$/, '.tmp');
  }

  private async hit(op: Op, label: string): Promise<void> {
    const call = `${op} ${label}`;
    this.log.push(call);
    if (this.gate !== null) await this.gate(call, op);
    if (this.fail(call, op)) throw Object.assign(new Error(`injected failure: ${call}`), { code: 'EIO' });
  }

  /** The recorded calls from `from` on, less the ones that only read or open. */
  acts(from = 0): string[] {
    return this.log.slice(from).filter((l) => /^(write|fsync|rename|unlink) /.test(l));
  }

  async mkdir(dir: string, mode: number): Promise<void> { await this.hit('mkdir', this.label(dir)); return nodeReviewFs.mkdir(dir, mode); }
  async open(p: string, flags: string, mode?: number): Promise<FileHandle> {
    await this.hit('open', this.label(p));
    const h = await nodeReviewFs.open(p, flags, mode);
    this.paths.set(h, p);
    if (this.afterOpen !== null) await this.afterOpen(`open ${this.label(p)}`);
    return h;
  }
  async write(h: FileHandle, data: Uint8Array): Promise<void> { await this.hit('write', this.label(this.paths.get(h) ?? '?')); return nodeReviewFs.write(h, data); }
  async fsync(h: FileHandle): Promise<void> { await this.hit('fsync', this.label(this.paths.get(h) ?? '?')); return nodeReviewFs.fsync(h); }
  async rename(from: string, to: string): Promise<void> { await this.hit('rename', `${this.label(from)} -> ${this.label(to)}`); return nodeReviewFs.rename(from, to); }
  async unlink(p: string): Promise<void> { await this.hit('unlink', this.label(p)); return nodeReviewFs.unlink(p); }
  async readdir(dir: string): Promise<string[]> { await this.hit('readdir', this.label(dir)); return nodeReviewFs.readdir(dir); }
  async readFile(p: string): Promise<Uint8Array> { await this.hit('readFile', this.label(p)); return nodeReviewFs.readFile(p); }
  async stat(p: string): ReturnType<ReviewFs['stat']> { await this.hit('stat', this.label(p)); return nodeReviewFs.stat(p); }
}

async function openStore(dir: string, io?: ReviewFs, draw?: () => Uint8Array): Promise<ReviewStore> {
  const r = await openReviewStore(dir, io, draw);
  if (!r.ok) throw new Error(`the store did not open: ${r.why}`);
  return r.store;
}

/** A share through `put`, as the one call a test makes to seed one. */
async function share(store: ReviewStore, n = 0, now = T0, body: Uint8Array = html(n)) {
  const a = await store.put(src(n), body, 0, now);
  if (!a.ok) throw new Error(`put refused: ${a.why}`);
  return { entry: a.entry, token: a.entry.token, h: a.entry.tokenHash, rev: a.entry.rev };
}

const live = (store: ReviewStore, token: string) => {
  const e = store.byToken(token);
  if (e === null) throw new Error('the share is not live');
  return e;
};

const files = (dir: string): string[] => readdirSync(dir).sort();
const indexFiles = (dir: string): string[] => files(dir).filter((n) => /^[0-9a-f]{64}\.json$/.test(n));
const tombFiles = (dir: string): string[] => files(dir).filter((n) => n.endsWith('.removed.json'));

function jsonStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(jsonStrings);
  if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(jsonStrings);
  return [];
}

// ---- the happy path ----------------------------------------------------------------------------------------------

describe('put and read', () => {
  it('stores a share that byToken finds, and readBytes gives identical bytes (SHA-256 compared)', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const body = html('one');
    const a = await store.put(src(), body, 2, T0);
    expect(a).toMatchObject({ ok: true, replacedExpired: false });
    if (!a.ok) return;
    const e = store.byToken(a.entry.token);
    expect(e).toEqual(a.entry);
    expect(e).toMatchObject({ version: 1, sharedAt: T0, firstSharedAt: T0, idleSince: T0, lastViewedAt: null, pinned: false, size: body.byteLength, credentialShapes: 2, revoking: false });
    expect(isReviewToken(a.entry.token)).toBe(true);
    expect(a.entry.tokenHash).toBe(sha256(a.entry.token));
    const read = await store.readBytes(a.entry.tokenHash, 1);
    expect(read).not.toBeNull();
    expect(sha256(read!)).toBe(sha256(body));
    expect(a.entry.sha256).toBe(sha256(body));
    expect(store.byId(a.entry.id)).toEqual(a.entry);
    expect(store.bySource('project-a', 'specs', 'x0.md', 'feature-a')).toEqual(a.entry);
    expect(store.all()).toEqual([a.entry]);
    expect(store.bytesUsed()).toBe(body.byteLength);
  });

  it('writes files 0600 in a directory 0700, and no file name holds the token', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const names = files(dir);
    expect(names).toEqual([`${s.h}.json`, `${s.h}.v1.html`].sort());
    for (const n of names) {
      expect(statSync(path.join(dir, n)).mode & 0o777).toBe(0o600);
      expect(n).not.toContain(s.token);
    }
  });

  it('refuses a snapshot past the export cap, and writes nothing', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const a = await store.put(src(), new Uint8Array(DOCS_EXPORT_MAX_BYTES + 1), 0, T0);
    expect(a).toEqual({ ok: false, why: 'too-large' });
    expect(files(dir)).toEqual([]);
  });

  it('keeps the same entries across a reopen', async () => {
    const dir = freshDir();
    const a = await openStore(dir);
    const s = await share(a, 0, T0);
    await a.markViewed(s.h, s.rev, T0 + 1000);
    const b = await openStore(dir);
    expect(b.byToken(s.token)).toEqual(a.byToken(s.token));
    expect(b.all()).toHaveLength(1);
  });
});

describe('re-share and the clocks (N3)', () => {
  it('keeps the token on a second put, sets version 2, sharedAt and idleSince to its now, and keeps firstSharedAt', async () => {
    const store = await openStore(freshDir());
    const first = await share(store, 0, T0);
    const a = await store.put(src(), html('two'), 0, T0 + 3 * DAY);
    expect(a).toMatchObject({ ok: true, replacedExpired: false });
    if (!a.ok) return;
    expect(a.entry.token).toBe(first.token);
    expect(a.entry).toMatchObject({ version: 2, sharedAt: T0 + 3 * DAY, idleSince: T0 + 3 * DAY, firstSharedAt: T0 });
    expect(await store.readBytes(first.h, 2)).toEqual(Buffer.from(html('two')));
    expect(store.all()).toHaveLength(1);
  });

  it('re-share keeps the pin', async () => {
    const store = await openStore(freshDir());
    const s = await share(store);
    expect(await store.setPinned(s.h, s.rev, true, T0 + 1000)).toMatchObject({ ok: true });
    const a = await store.put(src(), html('two'), 0, T0 + 2000);
    expect(a.ok && a.entry.pinned).toBe(true);
    expect(live(store, s.token).pinned).toBe(true);
  });

  it('a view moves the idle clock once a minute; a pin leaves it; an unpin restarts it; firstSharedAt never moves', async () => {
    const store = await openStore(freshDir());
    const s = await share(store, 0, T0);
    const v1 = await store.markViewed(s.h, s.rev, T0 + DAY);
    expect(v1).toMatchObject({ ok: true, durable: true });
    let e = live(store, s.token);
    expect([e.lastViewedAt, e.idleSince]).toEqual([T0 + DAY, T0 + DAY]);

    const v2 = await store.markViewed(s.h, e.rev, T0 + DAY + 30000);
    expect(v2).toMatchObject({ ok: true });
    e = live(store, s.token);
    expect([e.lastViewedAt, e.idleSince]).toEqual([T0 + DAY, T0 + DAY]);

    expect(await store.setPinned(s.h, e.rev, true, T0 + 2 * DAY)).toMatchObject({ ok: true });
    e = live(store, s.token);
    expect([e.pinned, e.idleSince]).toEqual([true, T0 + DAY]);

    expect(await store.setPinned(s.h, e.rev, false, T0 + 3 * DAY)).toMatchObject({ ok: true });
    e = live(store, s.token);
    expect([e.pinned, e.idleSince]).toEqual([false, T0 + 3 * DAY]);

    expect(await store.markViewed(s.h, e.rev, T0 + 4 * DAY)).toMatchObject({ ok: true });
    e = live(store, s.token);
    expect(e.firstSharedAt).toBe(T0);
    expect(e.idleSince).toBe(T0 + 4 * DAY);
  });

  it('concurrent re-share: two puts started together end at version 3, the index naming v3 and v3 holding the second call', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store);
    const [a, b] = await Promise.all([store.put(src(), html('second'), 0, T0 + 1), store.put(src(), html('third'), 0, T0 + 2)]);
    expect(a.ok && a.entry.version).toBe(2);
    expect(b.ok && b.entry.version).toBe(3);
    const idx = JSON.parse(readFileSync(path.join(dir, `${s.h}.json`), 'utf8')) as { version: number };
    expect(idx.version).toBe(3);
    expect(files(dir)).toEqual([`${s.h}.json`, `${s.h}.v3.html`].sort());
    expect(await store.readBytes(s.h, 3)).toEqual(Buffer.from(html('third')));
    expect(live(store, s.token).version).toBe(3);
  });

  it('after a re-share only v2 has a bytes file (the superseded copy is purged)', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store);
    await store.put(src(), html('two'), 0, T0 + 1);
    expect(files(dir).filter((n) => n.endsWith('.html'))).toEqual([`${s.h}.v2.html`]);
  });
});

// ---- the commit point --------------------------------------------------------------------------------------------

describe('the commit point', () => {
  it('a recording ReviewFs sees put rename the bytes before it writes the index, then sync the directory', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const from = io.log.length;
    await share(store);
    expect(io.acts(from)).toEqual([
      'write H.v1.html.tmp', 'fsync H.v1.html.tmp', 'rename H.v1.html.tmp -> H.v1.html',
      'write H.json.tmp', 'fsync H.json.tmp', 'rename H.json.tmp -> H.json',
      'fsync DIR',
    ]);
  });

  it('crash before the index rename: the old version stays live, and a fresh open serves it and deletes the unreferenced bytes', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0, html('one'));
    io.fail = (l) => l === 'rename H.json.tmp -> H.json';
    const a = await store.put(src(), html('two'), 0, T0 + 1);
    expect(a).toEqual({ ok: false, why: 'not-durable' });
    expect(live(store, s.token).version).toBe(1);
    expect(files(dir)).toEqual([`${s.h}.json`, `${s.h}.v1.html`, `${s.h}.v2.html`].sort());
    const idx = JSON.parse(readFileSync(path.join(dir, `${s.h}.json`), 'utf8')) as { version: number };
    expect(idx.version).toBe(1);

    const fresh = await openStore(dir);
    expect(live(fresh, s.token).version).toBe(1);
    expect(await fresh.readBytes(s.h, 1)).toEqual(Buffer.from(html('one')));
    expect(files(dir)).toEqual([`${s.h}.json`, `${s.h}.v1.html`].sort());
  });

  it('put with a failing bytes write answers not-durable and the previous version stays served', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0, html('one'));
    io.fail = (l, op) => op === 'write' && l === 'write H.v2.html.tmp';
    expect(await store.put(src(), html('two'), 0, T0 + 1)).toEqual({ ok: false, why: 'not-durable' });
    expect(live(store, s.token)).toMatchObject({ version: 1, rev: s.rev });
    expect(await store.readBytes(s.h, 1)).toEqual(Buffer.from(html('one')));
    expect(files(dir)).toEqual([`${s.h}.json`, `${s.h}.v1.html`].sort());
  });

  it('a draw that matches a credential shape is re-drawn (A2)', async () => {
    const bad = Buffer.from(`sk-${'A'.repeat(40)}`, 'base64url');
    expect(bad.byteLength).toBe(32);
    const badToken = bad.toString('base64url');
    expect(matchesShape(badToken)).toBe(true);
    const good = Buffer.alloc(32, 7);
    let calls = 0;
    const store = await openStore(freshDir(), undefined, () => (calls++ === 0 ? bad : good));
    const s = await share(store);
    expect(calls).toBe(2);
    expect(s.token).toBe(good.toString('base64url'));
    expect(store.byToken(badToken)).toBeNull();
  });
});

// ---- expiry and admission ----------------------------------------------------------------------------------------

describe('expiry is terminal and admission is decided in the queue', () => {
  it('expiry is terminal: a pin on an expired, unswept share answers expired and removes it; a put for its source mints a new share', async () => {
    const store = await openStore(freshDir());
    const s = await share(store, 0, T0);
    const late = T0 + REVIEW_IDLE_MS;
    expect(await store.setPinned(s.h, s.rev, true, late)).toEqual({ ok: false, why: 'expired' });
    expect(store.byToken(s.token)).toBeNull();
    expect(store.tombstones()[0]).toMatchObject({ removed: { why: 'expired', at: late } });

    const a = await store.put(src(), html('again'), 0, late);
    expect(a).toMatchObject({ ok: true, replacedExpired: true });
    if (!a.ok) return;
    expect(a.entry.token).not.toBe(s.token);
    expect(a.entry.version).toBe(1);
    expect(store.byToken(s.token)).toBeNull();
  });

  it('a put whose old share is expired and still live in the index removes it in the queue and says replacedExpired', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store, 0, T0);
    const late = T0 + REVIEW_IDLE_MS;
    const a = await store.put(src(), html('again'), 0, late);
    expect(a).toMatchObject({ ok: true, replacedExpired: true });
    if (!a.ok) return;
    expect(a.entry.token).not.toBe(s.token);
    expect(store.byToken(s.token)).toBeNull();
    expect(files(dir).filter((n) => n.startsWith(s.h))).toEqual([]);
    expect(store.tombstones()).toHaveLength(1);
    expect(store.tombstones()[0]!.removed.why).toBe('expired');
  });

  it('a share past retention that a write meets is removed with retention, pinned or not (N10b)', async () => {
    const store = await openStore(freshDir());
    const s = await share(store, 0, T0);
    expect(await store.setPinned(s.h, s.rev, true, T0 + 1)).toMatchObject({ ok: true });
    const e = live(store, s.token);
    expect(await store.markViewed(s.h, e.rev, T0 + REVIEW_RETENTION_MS)).toEqual({ ok: false, why: 'expired' });
    expect(store.byToken(s.token)).toBeNull();
    expect(store.tombstones()[0]).toMatchObject({ removed: { why: 'retention', at: T0 + REVIEW_RETENTION_MS } });
  });

  it('a write with a stale revision on an age-dead entry answers expired, not stale (N10d)', async () => {
    const store = await openStore(freshDir());
    const s = await share(store, 0, T0);
    expect(await store.setPinned(s.h, s.rev + 5, true, T0 + REVIEW_IDLE_MS)).toEqual({ ok: false, why: 'expired' });
    expect(store.byToken(s.token)).toBeNull();
    const t = await share(store, 1, T0);
    expect(await store.markViewed(t.h, t.rev + 5, T0 + REVIEW_IDLE_MS)).toEqual({ ok: false, why: 'expired' });
  });

  it('a write at an old revision answers stale and leaves the index at its own revision, version and pin (I4)', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store, 0, T0);
    const again = await store.put(src(), html('two'), 0, T0 + 1);
    expect(again.ok && again.entry.rev).toBe(s.rev + 1);
    expect(await store.markViewed(s.h, s.rev, T0 + 2)).toEqual({ ok: false, why: 'stale' });
    expect(await store.setPinned(s.h, s.rev, true, T0 + 2)).toEqual({ ok: false, why: 'stale' });
    const idx = JSON.parse(readFileSync(path.join(dir, `${s.h}.json`), 'utf8')) as Record<string, unknown>;
    expect(idx).toMatchObject({ rev: s.rev + 1, version: 2, pinned: false, lastViewedAt: null });
    expect(live(store, s.token)).toMatchObject({ rev: s.rev + 1, pinned: false, lastViewedAt: null });
  });

  it('a kept expiry for the same source says replacedExpired, even when a later revoke is also kept', async () => {
    const store = await openStore(freshDir());
    const a = await share(store, 0, T0);
    expect(await store.remove(a.h, a.rev, 'expired', T0 + 1)).toMatchObject({ ok: true, why: 'expired' });
    const b = await store.put(src(), html('b'), 0, T0 + 2);
    expect(b).toMatchObject({ ok: true, replacedExpired: true });
    if (!b.ok) return;
    expect(await store.remove(b.entry.tokenHash, b.entry.rev, 'revoked', T0 + 3)).toMatchObject({ ok: true, why: 'revoked' });
    expect(await store.put(src(), html('c'), 0, T0 + 4)).toMatchObject({ ok: true, replacedExpired: true });
    const other = await share(store, 1, T0 + 5);
    expect(await store.remove(other.h, other.rev, 'revoked', T0 + 6)).toMatchObject({ ok: true, why: 'revoked' });
    expect(await store.put(src(1), html('d'), 0, T0 + 7)).toMatchObject({ ok: true, replacedExpired: false });
  });

  it('concurrent create at the cap: with 63 live shares, two puts for new sources admit exactly one', async () => {
    const store = await openStore(freshDir());
    for (let i = 0; i < REVIEW_MAX_LIVE - 1; i++) await share(store, i, T0 + i);
    expect(store.all()).toHaveLength(REVIEW_MAX_LIVE - 1);
    const [a, b] = await Promise.all([store.put(src(100), html('a'), 0, T0), store.put(src(101), html('b'), 0, T0)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const refused = a.ok ? b : a;
    expect(refused).toEqual({ ok: false, why: 'store-full' });
    expect(store.all()).toHaveLength(REVIEW_MAX_LIVE);
  });
});

describe('admission counts retained snapshot files', () => {
  it('refuses at the cap when the boot orphan and a superseded copy both fail to unlink', async () => {
    const dir = freshDir();
    mkdirSync(dir);
    const orphan = path.join(dir, `${'f'.repeat(64)}.v9.html`);
    const four = Buffer.from('four');
    writeFileSync(orphan, '');
    // A sparse fixture fixes the apparent size without writing or reading a cap's worth of bytes.
    truncateSync(orphan, REVIEW_MAX_STORE_BYTES - 2 * four.byteLength);
    const io = new FaultFs(dir);
    io.fail = (l) => l === 'unlink H.v9.html' || l === 'unlink H.v1.html';
    const store = await openStore(dir, io);
    const first = await share(store, 0, T0, four);
    expect(await store.put(src(), four, 0, T0 + 1)).toMatchObject({ ok: true });
    expect(files(dir)).toContain(`${first.h}.v1.html`);
    const refused = await store.put(src(1), four, 0, T0 + 2);
    expect(refused.ok ? 'accepted' : refused.why).toBe('store-full');

    io.fail = (l) => l === 'unlink H.v9.html';
    await store.retryPending(T0 + 3);
    expect(files(dir)).not.toContain(`${first.h}.v1.html`);
    expect(await store.put(src(1), four, 0, T0 + 4)).toMatchObject({ ok: true });
    expect(store.bytesUsed()).toBe(REVIEW_MAX_STORE_BYTES);
    const again = await store.put(src(1), four, 0, T0 + 5);
    expect(again.ok && again.entry.version).toBe(2); // at the cap, credit only the version this call replaces
    expect(store.bytesUsed()).toBe(REVIEW_MAX_STORE_BYTES);
  });

  it('credits the measured disk length, not the size stated in a reopened index', async () => {
    const dir = freshDir();
    const s = await share(await openStore(dir), 0, T0, Buffer.from('four'));
    const index = path.join(dir, `${s.h}.json`);
    writeFileSync(index, JSON.stringify({ ...JSON.parse(readFileSync(index, 'utf8')), size: 10 }));
    const orphan = path.join(dir, `${'f'.repeat(64)}.v9.html`);
    writeFileSync(orphan, '');
    truncateSync(orphan, REVIEW_MAX_STORE_BYTES - 4);
    const io = new FaultFs(dir);
    io.fail = (l) => l === 'unlink H.v9.html';
    const store = await openStore(dir, io);
    const refused = await store.put(src(), Buffer.from('five!'), 0, T0 + 1);
    expect(refused.ok ? 'accepted' : refused.why).toBe('store-full');
  });

  it('keeps the bytes reserved until the directory sync following unlink succeeds', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0, Buffer.from('four'));
    io.fail = (l) => l === 'unlink H.v1.html';
    await store.remove(s.h, s.rev, 'revoked', T0 + 1);
    io.fail = (l) => l === 'fsync DIR';
    expect(await store.retryPending(T0 + 2)).toEqual({ remaining: 1 });
    expect(existsSync(path.join(dir, `${s.h}.v1.html`))).toBe(false);
    expect(store.bytesUsed()).toBe(4);
    io.fail = () => false;
    expect(await store.retryPending(T0 + 3)).toEqual({ remaining: 0 });
    expect(store.bytesUsed()).toBe(0);
  });

  it.each(['before index rename', 'after index rename'] as const)('accounts for failed re-share bytes %s', async (where) => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const first = await share(store, 0, T0, Buffer.from('old'));
    io.fail = (l) => l === (where === 'before index rename' ? 'rename H.json.tmp -> H.json' : 'fsync DIR');
    expect(await store.put(src(), Buffer.from('next'), 0, T0 + 1)).toEqual({ ok: false, why: 'not-durable' });
    expect(store.bytesUsed()).toBe(7);
    expect(statSync(path.join(dir, `${first.h}.v2.html`)).size).toBe(4);
  });

  it('accounts for a staged snapshot whose rename and cleanup both failed', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    io.fail = (l) => l === 'rename H.v1.html.tmp -> H.v1.html' || l === 'unlink H.v1.html.tmp';
    expect(await store.put(src(), Buffer.from('copy'), 0, T0)).toEqual({ ok: false, why: 'not-durable' });
    expect(store.bytesUsed()).toBe(4);
    io.fail = () => false;
    await store.retryPending(T0 + 1);
    expect(store.bytesUsed()).toBe(0);
    expect(files(dir)).toEqual([]);
  });

  it('accounts for a young staged snapshot at boot without purging it', async () => {
    const dir = freshDir();
    mkdirSync(dir);
    const young = `${'f'.repeat(64)}.v1.html.${'1'.repeat(12)}.tmp`;
    writeFileSync(path.join(dir, young), 'copy');
    const store = await openStore(dir);
    expect(store.bytesUsed()).toBe(4);
    expect(files(dir)).toEqual([young]);
  });

  it('retries a failed unlink of an aged staged snapshot found at boot', async () => {
    const dir = freshDir();
    mkdirSync(dir);
    const old = path.join(dir, `${'f'.repeat(64)}.v1.html.${'1'.repeat(12)}.tmp`);
    writeFileSync(old, 'copy');
    const oldTime = Date.now() / 1000 - 61;
    utimesSync(old, oldTime, oldTime);
    const io = new FaultFs(dir);
    io.fail = (l) => l === 'unlink H.v1.html.tmp';
    const store = await openStore(dir, io);
    expect(store.bytesUsed()).toBe(4);
    io.fail = () => false;
    await store.retryPending(T0);
    expect(store.bytesUsed()).toBe(0);
    expect(files(dir)).toEqual([]);
  });
});

// ---- removal -----------------------------------------------------------------------------------------------------

describe('remove', () => {
  it('revoke during an open read: a markViewed queued after remove answers stale, and a reopened store holds no entry', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store);
    const rm = store.remove(s.h, s.rev, 'revoked', T0 + 1);
    const view = store.markViewed(s.h, s.rev, T0 + 2);
    expect(await rm).toMatchObject({ ok: true, why: 'revoked' });
    expect(await view).toEqual({ ok: false, why: 'stale' });
    const again = await openStore(dir);
    expect(again.byToken(s.token)).toBeNull();
    expect(again.all()).toEqual([]);
    expect(files(dir).filter((n) => n.startsWith(s.h))).toEqual([]);
  });

  it('a pin advances the revision so a remove using the pre-pin revision is stale', async () => {
    const store = await openStore(freshDir());
    const s = await share(store);
    expect(await store.setPinned(s.h, s.rev, true, T0 + 1)).toMatchObject({ ok: true });
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 2)).toEqual({ ok: false, why: 'stale' });
    expect(live(store, s.token)).toMatchObject({ pinned: true, rev: s.rev + 1 });
  });

  it('a remove at another revision, or for an unknown share, answers stale', async () => {
    const store = await openStore(freshDir());
    const s = await share(store);
    expect(await store.remove(s.h, s.rev + 1, 'revoked', T0)).toEqual({ ok: false, why: 'stale' });
    expect(store.byToken(s.token)).not.toBeNull();
    expect(await store.remove('0'.repeat(64), 'any', 'revoked', T0)).toEqual({ ok: false, why: 'stale' });
  });

  it('a remove of a share already dead of age is removed for that reason, whatever the call asked', async () => {
    const store = await openStore(freshDir());
    const s = await share(store);
    expect(await store.remove(s.h, 'any', 'revoked', T0 + REVIEW_IDLE_MS)).toMatchObject({ ok: true, why: 'expired' });
  });

  it('open while a removal is held: byToken already answers null while the tombstone write is paused', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => { release = r; });
    let reached: () => void = () => undefined;
    const atTombstone = new Promise<void>((r) => { reached = r; });
    io.gate = async (l) => {
      if (l === 'write ID.removed.json.tmp') { reached(); await held; }
    };
    const rm = store.remove(s.h, s.rev, 'revoked', T0 + 1);
    await atTombstone;
    expect(store.byToken(s.token)).toBeNull();
    expect(store.bySource('project-a', 'specs', 'x0.md', 'feature-a')).toBeNull();
    release();
    expect(await rm).toMatchObject({ ok: true });
  });

  it('a recording ReviewFs sees remove write and sync the tombstone, unlink the index, sync, unlink the bytes, sync, in that order', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    const from = io.log.length;
    await store.remove(s.h, s.rev, 'revoked', T0 + 1);
    expect(io.acts(from)).toEqual([
      'write ID.removed.json.tmp', 'fsync ID.removed.json.tmp', 'rename ID.removed.json.tmp -> ID.removed.json', 'fsync DIR',
      'unlink H.json', 'fsync DIR',
      'unlink H.v1.html', 'fsync DIR',
    ]);
  });

  it('the tombstone holds no token and no bytes', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store);
    await store.remove(s.h, s.rev, 'revoked', T0 + 1);
    const [tomb] = tombFiles(dir);
    const text = readFileSync(path.join(dir, tomb!), 'utf8');
    expect(text).not.toContain(s.token);
    expect(text).not.toContain(s.h);
    expect(jsonStrings(JSON.parse(text)).filter((v) => isReviewToken(v))).toEqual([]);
    expect(JSON.parse(text)).toMatchObject({ removed: { why: 'revoked', at: T0 + 1 } });
  });

  it('openBytes streams from a descriptor opened while live: a send in flight finishes with the old bytes after a revoke, and a later open is null', async () => {
    const store = await openStore(freshDir());
    const s = await share(store, 0, T0, html('keep me'));
    const open = await store.openBytes(s.h, 1);
    expect(open).not.toBeNull();
    expect(open!.size).toBe(html('keep me').byteLength);
    await store.remove(s.h, s.rev, 'revoked', T0 + 1);
    const chunks: Buffer[] = [];
    for await (const c of open!.stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(html('keep me')));
    expect(await store.openBytes(s.h, 1)).toBeNull();
    expect(await store.openBytes(s.h, 2)).toBeNull();
  });
});

describe('openBytes', () => {
  it('answers null for an entry removed between its open and its re-check, and lets go of the descriptor (N10c)', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => { release = r; });
    let reached: () => void = () => undefined;
    const opened = new Promise<void>((r) => { reached = r; });
    io.afterOpen = async (call) => {
      if (call === 'open H.v1.html') { reached(); await held; }
    };
    const pending = store.openBytes(s.h, 1);
    await opened;
    io.afterOpen = null;
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 1)).toMatchObject({ ok: true });
    release();
    expect(await pending).toBeNull();
  });
});

describe('tombstone purge', () => {
  it('deletes a tombstone 7 days old and keeps one 6 days old', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const a = await share(store, 0, T0);
    const b = await share(store, 1, T0);
    await store.remove(a.h, a.rev, 'revoked', T0);
    await store.remove(b.h, b.rev, 'revoked', T0 + DAY);
    expect(tombFiles(dir)).toHaveLength(2);
    expect(await store.purgeTombstones(T0 + REVIEW_TOMBSTONE_MS)).toEqual({ purged: 1 });
    expect(tombFiles(dir)).toHaveLength(1);
    expect(store.tombstones()).toHaveLength(1);
    expect(store.tombstones()[0]!.removed.at).toBe(T0 + DAY);
    expect(await store.purgeTombstones(T0 + REVIEW_TOMBSTONE_MS)).toEqual({ purged: 0 });
  });

  it('purge keeps a guarded tombstone: 8 days old with its index entry still on disk, deleted on the pass after the index is gone', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l) => l === 'unlink H.json';
    expect(await store.remove(s.h, s.rev, 'revoked', T0)).toMatchObject({ ok: true });
    expect(existsSync(path.join(dir, `${s.h}.json`))).toBe(true);
    expect(await store.purgeTombstones(T0 + 8 * DAY)).toEqual({ purged: 0 });
    expect(tombFiles(dir)).toHaveLength(1);
    io.fail = () => false;
    expect(await store.retryPending(T0 + 8 * DAY)).toEqual({ remaining: 0 });
    expect(await store.purgeTombstones(T0 + 8 * DAY)).toEqual({ purged: 1 });
    expect(tombFiles(dir)).toEqual([]);
  });

  it('boot defers tombstone purge while it cannot unlink bytes with no index', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0);
    io.fail = (l) => l === 'unlink H.v1.html';
    expect(await store.remove(s.h, s.rev, 'revoked', T0)).toMatchObject({ ok: true });
    expect(indexFiles(dir)).toEqual([]);

    const retryFs = new FaultFs(dir);
    retryFs.fail = (l) => l === 'unlink H.v1.html';
    const reopened = await openStore(dir, retryFs);
    const later = T0 + REVIEW_TOMBSTONE_MS;
    expect(await reopened.purgeTombstones(later)).toEqual({ purged: 0 });
    expect(tombFiles(dir)).toHaveLength(1);
    retryFs.fail = () => false;
    expect(await reopened.retryPending(later)).toEqual({ remaining: 0 });
    expect(await reopened.purgeTombstones(later)).toEqual({ purged: 1 });
  });

  it('a purge that cannot unlink keeps the tombstone for the next pass', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    await store.remove(s.h, s.rev, 'revoked', T0);
    io.fail = (l, op) => op === 'unlink' && l === 'unlink ID.removed.json';
    expect(await store.purgeTombstones(T0 + 8 * DAY)).toEqual({ purged: 0 });
    expect(store.tombstones()).toHaveLength(1);
    io.fail = () => false;
    expect(await store.purgeTombstones(T0 + 8 * DAY)).toEqual({ purged: 1 });
  });
});

// ---- write failures (N2) -----------------------------------------------------------------------------------------

describe('write failures (N2)', () => {
  it('a failing tombstone write: an expiry still unlinks the index and the bytes, answers lost, and a reopened store holds nothing', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'write' && l === 'write ID.removed.json.tmp';
    expect(await store.remove(s.h, s.rev, 'expired', T0 + 1)).toMatchObject({ ok: true, why: 'lost' });
    expect(store.byToken(s.token)).toBeNull();
    expect(store.tombstones()[0]).toMatchObject({ removed: { why: 'lost' } });
    expect(store.hasPending()).toBe(false);
    const again = await openStore(dir);
    expect(again.all()).toEqual([]);
    expect(again.tombstones()).toEqual([]);
    expect(await again.readBytes(s.h, 1)).toBeNull();
    expect(files(dir)).toEqual([]);
  });

  it('the same failure under a revoke keeps revoked, never lost', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'write' && l === 'write ID.removed.json.tmp';
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 1)).toMatchObject({ ok: true, why: 'revoked' });
    expect(store.tombstones()[0]).toMatchObject({ removed: { why: 'revoked' } });
  });

  it('tombstone only: with both unlinks failing after the tombstone lands, remove answers ok, byToken is null, the removal stays pending and a reopened store finishes it keeping the reason', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'unlink' && (l === 'unlink H.json' || l === 'unlink H.v1.html');
    expect(await store.remove(s.h, s.rev, 'committed', T0 + 1)).toMatchObject({ ok: true, why: 'committed' });
    expect(store.byToken(s.token)).toBeNull();
    expect(store.hasPending()).toBe(true);
    expect(store.all()).toEqual([]);
    expect(store.tombstones()[0]).toMatchObject({ removed: { why: 'committed' } });

    const again = await openStore(dir);
    expect(again.byToken(s.token)).toBeNull();
    expect(again.tombstones()[0]).toMatchObject({ removed: { why: 'committed' } });
    expect(files(dir).filter((n) => n.startsWith(s.h))).toEqual([]);
    expect(again.hasPending()).toBe(false);
  });

  it('a failing index unlink: the tombstone and the bytes unlink land, the answer is ok, and a reopened store removes the index entry keeping revoked', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'unlink' && l === 'unlink H.json';
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 1)).toMatchObject({ ok: true, why: 'revoked' });
    expect(store.byToken(s.token)).toBeNull();
    expect(files(dir).some((n) => n.endsWith('.v1.html'))).toBe(false);
    expect(existsSync(path.join(dir, `${s.h}.json`))).toBe(true);

    const again = await openStore(dir);
    expect(again.byToken(s.token)).toBeNull();
    expect(again.all()).toEqual([]);
    expect(again.tombstones()[0]).toMatchObject({ removed: { why: 'revoked' } });
    expect(files(dir).filter((n) => n.startsWith(s.h))).toEqual([]);
  });

  it('every act failing: remove answers not-durable, byToken is null, all() shows the entry revoking, and one retryPending finishes it once the disk heals', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = () => true;
    const a = await store.remove(s.h, s.rev, 'revoked', T0 + 1);
    expect(a).toMatchObject({ ok: false, why: 'not-durable', entry: { revoking: true, tokenHash: s.h } });
    expect(store.byToken(s.token)).toBeNull();
    expect(store.all().map((e) => [e.tokenHash, e.revoking])).toEqual([[s.h, true]]);
    expect(store.byId(s.entry.id)).toMatchObject({ revoking: true });
    expect(store.hasPending()).toBe(true);
    expect(store.tombstones()).toEqual([]);

    const list = projectList(store.all(), store.tombstones(), { armed: true, signedIn: true, origin: 'https://h.example' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ link: null, revoking: true, removed: null });

    io.fail = () => false;
    expect(await store.retryPending(T0 + 2)).toEqual({ remaining: 0 });
    expect(store.hasPending()).toBe(false);
    expect(store.all()).toEqual([]);
    expect(store.tombstones()[0]).toMatchObject({ removed: { why: 'revoked' } });
    expect(files(dir).filter((n) => n.startsWith(s.h))).toEqual([]);
  });

  it('the residual, pinned: with every act failing, a stop before the disk heals brings the share back live at the next start', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = () => true;
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 1)).toMatchObject({ ok: false, why: 'not-durable' });
    // The close retry, refused too.
    expect(await store.retryPending(T0 + 2)).toEqual({ remaining: 1 });
    expect(store.byToken(s.token)).toBeNull();
    io.fail = () => false;
    const again = await openStore(dir);
    expect(again.byToken(s.token)).toMatchObject({ tokenHash: s.h, revoking: false });
  });

  // Only the OLD share's removal acts fail (every unlink, and anything on a tombstone file), so a new share's own writes
  // would succeed: a put that answers not-durable here answers it because of the pending-removal refusal, not because
  // its own writes failed.
  const failRemovalActs = (l: string, op: Op): boolean => op === 'unlink' || l.includes('.removed.json');

  it('pending removals and re-share (I1, I3): a put for a source with a pending removal answers not-durable though its own writes would succeed, and keeps one index entry; after the disk heals the same put mints a new token', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = failRemovalActs;
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 1)).toMatchObject({ ok: false, why: 'not-durable' });
    expect(await store.put(src(), html('again'), 0, T0 + 2)).toEqual({ ok: false, why: 'not-durable' });
    expect(indexFiles(dir)).toEqual([`${s.h}.json`]);

    io.fail = () => false;
    const a = await store.put(src(), html('again'), 0, T0 + 3);
    expect(a).toMatchObject({ ok: true });
    if (!a.ok) return;
    expect(a.entry.token).not.toBe(s.token);
    expect(a.entry.version).toBe(1);
    expect(store.byToken(s.token)).toBeNull();
    expect(indexFiles(dir)).toEqual([`${a.entry.tokenHash}.json`]);
  });

  it('a put that finds its expired share and cannot remove it answers not-durable and writes no second index entry (I3)', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0);
    io.fail = failRemovalActs;
    const late = T0 + REVIEW_IDLE_MS;
    expect(await store.put(src(), html('again'), 0, late)).toEqual({ ok: false, why: 'not-durable' });
    expect(indexFiles(dir)).toEqual([`${s.h}.json`]);
    expect(store.byToken(s.token)).toBeNull();

    io.fail = () => false;
    const a = await store.put(src(), html('again'), 0, late + 1);
    expect(a).toMatchObject({ ok: true, replacedExpired: true });
    if (!a.ok) return;
    expect(a.entry.token).not.toBe(s.token);
    expect(indexFiles(dir)).toEqual([`${a.entry.tokenHash}.json`]);
  });

  it('a stuck bytes file alone does not block a re-share: the tombstone and the index are gone, the new share gets a new token, the old bytes stay pending (N3)', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'unlink' && l === 'unlink H.v1.html';
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 1)).toMatchObject({ ok: true, why: 'revoked' });
    expect(store.hasPending()).toBe(true);
    const a = await store.put(src(), html('again'), 0, T0 + 2);
    expect(a).toMatchObject({ ok: true });
    if (!a.ok) return;
    expect(a.entry.token).not.toBe(s.token);
    expect(a.entry.version).toBe(1);
    expect(indexFiles(dir)).toEqual([`${a.entry.tokenHash}.json`]);
    expect(store.hasPending()).toBe(true);
    expect(existsSync(path.join(dir, `${s.h}.v1.html`))).toBe(true);

    io.fail = () => false;
    expect(await store.retryPending(T0 + 3)).toEqual({ remaining: 0 });
    expect(existsSync(path.join(dir, `${s.h}.v1.html`))).toBe(false);
    expect(await store.readBytes(a.entry.tokenHash, 1)).toEqual(Buffer.from(html('again')));
  });

  it('a pin with a failing index write answers not-durable and pinned is unchanged', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'write' && l === 'write H.json.tmp';
    const answer = await store.setPinned(s.h, s.rev, true, T0 + 1);
    expect(live(store, s.token)).toMatchObject({ pinned: false, rev: s.rev });
    expect(answer).toEqual({ ok: false, why: 'not-durable' });
  });

  it('a view with a failing index write answers durable: false and lastViewedAt moved in memory', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'write' && l === 'write H.json.tmp';
    const a = await store.markViewed(s.h, s.rev, T0 + 1000);
    expect(a).toMatchObject({ ok: true, durable: false });
    expect(live(store, s.token)).toMatchObject({ lastViewedAt: T0 + 1000, idleSince: T0 + 1000 });
  });

  it('a superseded copy whose unlink fails stays pending and is retried', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'unlink' && l === 'unlink H.v1.html';
    expect(await store.put(src(), html('two'), 0, T0 + 1)).toMatchObject({ ok: true });
    expect(store.hasPending()).toBe(true);
    expect(existsSync(path.join(dir, `${s.h}.v1.html`))).toBe(true);
    io.fail = () => false;
    expect(await store.retryPending(T0 + 2)).toEqual({ remaining: 0 });
    expect(existsSync(path.join(dir, `${s.h}.v1.html`))).toBe(false);
  });

  it('a stray recorded at boot is dropped when a put commits that very name, and a retry never unlinks the live copy (I1)', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const first = await openStore(dir, io);
    const s = await share(first, 0, T0, html('one'));
    // The crash: v2's bytes renamed, the index rename never happened.
    io.fail = (l) => l === 'rename H.json.tmp -> H.json';
    expect(await first.put(src(), html('two'), 0, T0 + 1)).toEqual({ ok: false, why: 'not-durable' });
    expect(existsSync(path.join(dir, `${s.h}.v2.html`))).toBe(true);

    // The next start cannot unlink that unreferenced file, so it is a stray.
    const io2 = new FaultFs(dir);
    io2.fail = (l, op) => op === 'unlink' && l === 'unlink H.v2.html';
    const again = await openStore(dir, io2);
    expect(again.hasPending()).toBe(true);
    io2.fail = () => false;

    // The owner re-shares: v2 is now the live copy.
    const a = await again.put(src(), html('three'), 0, T0 + 2);
    expect(a).toMatchObject({ ok: true });
    expect(a.ok && a.entry.version).toBe(2);
    expect(again.hasPending()).toBe(false);
    expect(await again.retryPending(T0 + 3)).toEqual({ remaining: 0 });
    expect(await again.readBytes(s.h, 2)).toEqual(Buffer.from(html('three')));
    const open = await again.openBytes(s.h, 2);
    expect(open).not.toBeNull();
    open!.stream.destroy();
    expect(existsSync(path.join(dir, `${s.h}.v2.html`))).toBe(true);
  });

  it('a retry skips a stray that names a live entry\'s current bytes, even if the set holds it (I1, belt and braces)', async () => {
    const store = await openStore(freshDir());
    const s = await share(store, 0, T0, html('one'));
    // Plant a stale bookkeeping label after commit to exercise the retry guard independently of put's cleanup.
    const strays: unknown = Reflect.get(store, 'strays');
    expect(strays).toBeInstanceOf(Set);
    if (!(strays instanceof Set)) return;
    strays.add(`${s.h}.v1.html`);
    expect(await store.retryPending(T0 + 1)).toEqual({ remaining: 0 });
    expect(await store.readBytes(s.h, 1)).toEqual(Buffer.from(html('one')));
  });

  it('a put that fails before its index rename leaves its bytes as a stray that a retry removes (N1)', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0, html('one'));
    io.fail = (l) => l === 'rename H.json.tmp -> H.json';
    expect(await store.put(src(), html('two'), 0, T0 + 1)).toEqual({ ok: false, why: 'not-durable' });
    expect(existsSync(path.join(dir, `${s.h}.v2.html`))).toBe(true);
    expect(store.hasPending()).toBe(true);
    io.fail = () => false;
    expect(await store.retryPending(T0 + 2)).toEqual({ remaining: 0 });
    expect(existsSync(path.join(dir, `${s.h}.v2.html`))).toBe(false);
    expect(live(store, s.token).version).toBe(1);
    expect(await store.readBytes(s.h, 1)).toEqual(Buffer.from(html('one')));
  });

  it('keeps an unissued create hidden and fences its source until the unproven index is gone', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    io.fail = (l) => l === 'fsync DIR' || l === 'unlink H.json' || l === 'unlink H.v1.html';
    expect(await store.put(src(), Buffer.from('one'), 0, T0)).toEqual({ ok: false, why: 'not-durable' });
    expect(store.all()).toHaveLength(0);
    expect(store.tombstones()).toHaveLength(0);
    expect(store.bytesUsed()).toBe(3);
    expect(indexFiles(dir)).toHaveLength(1);

    io.fail = (l) => l === 'unlink H.json';
    const refused = await store.put(src(), Buffer.from('two'), 0, T0 + 1);
    expect(refused.ok ? 'accepted' : refused.why).toBe('not-durable');
    expect(indexFiles(dir)).toHaveLength(1);
    io.fail = () => false;
    const accepted = await store.put(src(), Buffer.from('two'), 0, T0 + 2);
    expect(accepted.ok).toBe(true);
    expect(indexFiles(dir)).toHaveLength(1);
    expect((await openStore(dir)).all()).toHaveLength(1);
  });

  it('a put whose directory sync fails after the index rename leaves the new bytes alone: the disk index may name them (N1)', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0, html('one'));
    io.fail = (l) => l === 'fsync DIR';
    expect(await store.put(src(), html('two'), 0, T0 + 1)).toEqual({ ok: false, why: 'not-durable' });
    io.fail = () => false;
    await store.retryPending(T0 + 2);
    expect(existsSync(path.join(dir, `${s.h}.v2.html`))).toBe(true);
    const again = await openStore(dir);
    expect(again.byToken(s.token)).toMatchObject({ version: 2 });
    expect(await again.readBytes(s.h, 2)).toEqual(Buffer.from(html('two')));
  });

  it('a stray reused by a re-share whose index rename precedes a failed sync survives retry', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0, html('one'));
    io.fail = (l) => l === 'rename H.json.tmp -> H.json';
    expect(await store.put(src(), html('two'), 0, T0 + 1)).toEqual({ ok: false, why: 'not-durable' });
    expect(store.hasPending()).toBe(true);
    io.fail = (l) => l === 'fsync DIR';
    expect(await store.put(src(), html('three'), 0, T0 + 2)).toEqual({ ok: false, why: 'not-durable' });
    expect(live(store, s.token).version).toBe(1);
    expect(JSON.parse(readFileSync(path.join(dir, `${s.h}.json`), 'utf8')).version).toBe(2);
    io.fail = () => false;
    await store.retryPending(T0 + 3);
    expect(existsSync(path.join(dir, `${s.h}.v2.html`))).toBe(true);
    const again = await openStore(dir);
    expect(again.byToken(s.token)).toMatchObject({ version: 2 });
    expect(await again.readBytes(s.h, 2)).toEqual(Buffer.from(html('three')));
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 4)).toMatchObject({ ok: true });
    expect(files(dir).filter((n) => n.startsWith(s.h))).toEqual([]);
  });

  it('a failed retry cannot overwrite bytes an unsynced index already names', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0, html('one'));
    io.fail = (l) => l === 'fsync DIR';
    expect(await store.put(src(), html('two'), 0, T0 + 1)).toEqual({ ok: false, why: 'not-durable' });
    expect(live(store, s.token).version).toBe(1);

    io.fail = (l) => l === 'rename H.json.tmp -> H.json';
    expect(await store.put(src(), html('three'), 0, T0 + 2)).toEqual({ ok: false, why: 'not-durable' });
    const reopened = await openStore(dir);
    const e = live(reopened, s.token);
    expect(e.version).toBe(2);
    expect(await reopened.readBytes(s.h, e.version)).toEqual(Buffer.from(html('two')));
    expect(e.sha256).toBe(createHash('sha256').update(html('two')).digest('hex'));
  });

  it('logs each failed disk act once by file name, never a token or bytes (N9)', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store, 0, T0, html('secret body'));
    warn.mockClear();
    io.fail = (l, op) => op === 'unlink' && l === 'unlink H.json';
    await store.remove(s.h, s.rev, 'revoked', T0 + 1);
    expect(warn.mock.calls).toEqual([[`ccrc-server: review store: unlink failed for ${s.h}.json`]]);
    for (const c of warn.mock.calls) {
      expect(String(c[0])).not.toContain(s.token);
      expect(String(c[0])).not.toContain('secret body');
    }
    warn.mockClear();
    io.fail = (l, op) => op === 'write' && l === 'write H.json.tmp';
    expect(await store.put(src(1), html('x'), 0, T0 + 2)).toEqual({ ok: false, why: 'not-durable' });
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/^ccrc-server: review store: write failed for [0-9a-f]{64}\.json$/)]]);
    warn.mockClear();
    expect(await store.markViewed(s.h, s.rev, T0 + 3)).toEqual({ ok: false, why: 'stale' }); // removed: writes nothing
    expect(warn.mock.calls).toHaveLength(0);
  });
});

// ---- boot --------------------------------------------------------------------------------------------------------

describe('boot', () => {
  it('removes a temporary file 61 s old and keeps one 10 s old', async () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const old = path.join(dir, 'a.json.0123456789ab.tmp');
    const young = path.join(dir, 'b.json.0123456789ab.tmp');
    writeFileSync(old, 'x');
    writeFileSync(young, 'x');
    const nowS = Date.now() / 1000;
    utimesSync(old, nowS - 61, nowS - 61);
    utimesSync(young, nowS - 10, nowS - 10);
    await openStore(dir);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(young)).toBe(true);
  });

  it('retries an already-aged boot temp on the first pending pass even if the wall clock moved back', async () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = path.join(dir, `${'f'.repeat(64)}.v1.html.0123456789ab.tmp`);
    writeFileSync(temp, 'copy');
    const modified = T0 / 1000 - 61;
    utimesSync(temp, modified, modified);
    const io = new FaultFs(dir);
    let tempUnlinked = false;
    io.fail = (call) => {
      if (call === 'unlink H.v1.html.tmp') tempUnlinked = true;
      return tempUnlinked && call === 'fsync DIR';
    };
    const bootClock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    let store: ReviewStore;
    try { store = await openStore(dir, io); }
    finally { bootClock.mockRestore(); }
    expect(existsSync(temp)).toBe(false);
    expect(store.bytesUsed()).toBe(4);
    expect(store.hasPending()).toBe(true);

    io.fail = () => false;
    // Boot already observed the grace period elapse. A backward wall step must not defer a failed sync.
    expect(await store.retryPending(T0 - 2_000)).toEqual({ remaining: 0 });
    expect(store.bytesUsed()).toBe(0);
    expect(store.hasPending()).toBe(false);
  });

  it.each(['unlink', 'directory sync'] as const)('retries a young boot temp after a due %s failure despite a backward clock', async failure => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temp = path.join(dir, `${'f'.repeat(64)}.v1.html.0123456789ab.tmp`);
    writeFileSync(temp, 'copy');
    utimesSync(temp, T0 / 1000, T0 / 1000);
    const io = new FaultFs(dir);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    let store: ReviewStore;
    try { store = await openStore(dir, io); } finally { clock.mockRestore(); }
    expect(existsSync(temp)).toBe(true);
    expect(store.bytesUsed()).toBe(4);
    io.fail = call => call === (failure === 'unlink' ? 'unlink H.v1.html.tmp' : 'fsync DIR');
    expect(await store.retryPending(T0 + 60_001)).toEqual({ remaining: 1 });
    expect(existsSync(temp)).toBe(failure === 'unlink');
    expect(store.bytesUsed()).toBe(4);
    io.fail = () => false;
    expect(await store.retryPending(T0 - 2_000)).toEqual({ remaining: 0 });
    expect(existsSync(temp)).toBe(false);
    expect(store.bytesUsed()).toBe(0);
    expect(store.hasPending()).toBe(false);
  });

  it('removes with lost an index entry whose bytes file is missing, and its link finds nothing', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store);
    unlinkSync(path.join(dir, `${s.h}.v1.html`));
    const again = await openStore(dir);
    expect(again.byToken(s.token)).toBeNull();
    expect(again.all()).toEqual([]);
    expect(again.tombstones()[0]).toMatchObject({ id: s.entry.id, removed: { why: 'lost' } });
    expect(indexFiles(dir)).toEqual([]);
  });

  it('removes bytes no index entry names', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store);
    const orphan = path.join(dir, `${'c'.repeat(64)}.v1.html`);
    writeFileSync(orphan, 'x');
    await openStore(dir);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(path.join(dir, `${s.h}.v1.html`))).toBe(true);
  });

  // A revoke answered ok (the tombstone landed, both unlinks failed) must never come back live because the tombstone is
  // damaged, or names a removal word this build does not know: any tombstone file beside an index entry finishes it.
  it.each([
    ['carries a removal word this build does not know', (t: Record<string, unknown>) => JSON.stringify({ ...t, removed: { why: 'frozen', at: T0 } })],
    ['is not JSON', () => '{"id": '],
    ['is empty', () => ''],
  ])('an index entry beside a tombstone that %s is finished as a removal and never served (I2)', async (_name, damage) => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    io.fail = (l, op) => op === 'unlink' && (l === 'unlink H.json' || l === 'unlink H.v1.html');
    expect(await store.remove(s.h, s.rev, 'revoked', T0 + 1)).toMatchObject({ ok: true, why: 'revoked' });
    const tomb = path.join(dir, tombFiles(dir)[0]!);
    writeFileSync(tomb, damage(JSON.parse(readFileSync(tomb, 'utf8')) as Record<string, unknown>));
    expect(existsSync(path.join(dir, `${s.h}.json`))).toBe(true);

    const again = await openStore(dir);
    expect(again.byToken(s.token)).toBeNull();
    expect(again.bySource('project-a', 'specs', 'x0.md', 'feature-a')).toBeNull();
    expect(again.all()).toEqual([]);
    expect(files(dir).filter((n) => n.startsWith(s.h))).toEqual([]);
    expect(await again.readBytes(s.h, 1)).toBeNull();
    // Fail closed, and never as unreadable: the reason it could not read is a revoke.
    expect(again.tombstones()[0]).toMatchObject({ id: s.entry.id, removed: { why: 'revoked' } });
    expect(JSON.parse(readFileSync(tomb, 'utf8'))).toMatchObject({ id: s.entry.id, removed: { why: 'revoked' } });
    expect(again.hasPending()).toBe(false);
    expect((await openStore(dir)).tombstones()[0]).toMatchObject({ id: s.entry.id, removed: { why: 'revoked' } });
  });

  it('refuses to open when a tombstone cannot be read', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    const store = await openStore(dir, io);
    const s = await share(store);
    await store.remove(s.h, s.rev, 'revoked', T0 + 1);
    io.fail = (l) => l === 'readFile ID.removed.json';
    expect(await openReviewStore(dir, io)).toEqual({ ok: false, why: 'store-unreadable' });
  });

  it('refuses an index file whose name is not its own token hash, and removes it', async () => {
    const dir = freshDir();
    const store = await openStore(dir);
    const s = await share(store);
    const other = `${'e'.repeat(64)}.json`;
    writeFileSync(path.join(dir, other), readFileSync(path.join(dir, `${s.h}.json`)));
    writeFileSync(path.join(dir, `${'e'.repeat(64)}.v1.html`), readFileSync(path.join(dir, `${s.h}.v1.html`)));
    const again = await openStore(dir);
    expect(again.all()).toHaveLength(1);
    expect(existsSync(path.join(dir, other))).toBe(false);
  });

  it.skipIf(IS_ROOT)('a directory at mode 000 opens store-unreadable', async () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o000);
    try {
      expect(await openReviewStore(dir)).toEqual({ ok: false, why: 'store-unreadable' });
    } finally { chmodSync(dir, 0o700); }
  });

  it.skipIf(IS_ROOT)('a directory at mode 0500 (readable, not writable) opens store-unreadable', async () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o500);
    try {
      expect(await openReviewStore(dir)).toEqual({ ok: false, why: 'store-unreadable' });
    } finally { chmodSync(dir, 0o700); }
  });

  it('a ReviewFs that fails only the probe write opens store-unreadable', async () => {
    const dir = freshDir();
    const io = new FaultFs(dir);
    io.fail = (l, op) => op === 'write' && l.startsWith('write probe-');
    expect(await openReviewStore(dir, io)).toEqual({ ok: false, why: 'store-unreadable' });
    expect(io.log.some((l) => l.startsWith('write probe-'))).toBe(true);
  });
});
