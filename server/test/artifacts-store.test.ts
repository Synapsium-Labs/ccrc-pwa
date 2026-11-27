// Native Docs HTML artifacts X5, plan Task A2.2: the in-memory capability store (spec section 3.3, "the capability's life").
// A fake clock and a fake liveness (a set of ended session hashes) drive every decision, because the store decides expiry
// only where it is asked: there is no timer to wait for. The token is kept as its sha256 hex and nowhere in plaintext.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_HOURLY_BYTES, ARTIFACT_IDLE_MS, ARTIFACT_MAX_AGE_DRAFT_MS, ARTIFACT_MAX_AGE_MS, ARTIFACT_MAX_LIVE,
  ARTIFACT_MAX_LIVE_PER_SESSION, ARTIFACT_MAX_INFLIGHT, ARTIFACT_MAX_INFLIGHT_BOX, ARTIFACT_QUEUE_PER_CAPABILITY,
} from '../../shared/artifacts.js';
import { isCapabilityToken } from '../../shared/capabilityToken.js';
import type { DocPin } from '../../shared/docs.js';
import type { SessionLiveness } from '../src/artifacts/ports.js';
import {
  ARTIFACT_MINT_DRAWS, createArtifactStore, expiresAt, type ArtifactManifestEntry, type CapabilityInput,
} from '../src/artifacts/store.js';

const T0 = 1_800_000_000_000;
const COMMIT = 'a'.repeat(40);
const SHA = 'b'.repeat(64);
const S1 = '1'.repeat(64);
const S2 = '2'.repeat(64);
const S3 = '3'.repeat(64);

const sha256hex = (s: string): string => createHash('sha256').update(s).digest('hex');
/** A well-formed token for draw number `n`: 43 characters of the base64url alphabet, never a repeat. */
const tok = (n: number): string => String(n).padStart(43, 'a');

function rig(opts: { draw?: () => string; drawId?: () => string } = {}) {
  let now = T0;
  const ended = new Set<string>();
  const liveness: SessionLiveness = { of: (h) => (ended.has(h) ? 'ended' : 'live') };
  let n = 0;
  let k = 0;
  const draw = opts.draw ?? (() => tok(++n));
  const drawId = opts.drawId ?? (() => `id${++k}`);
  const store = createArtifactStore(() => now, liveness, draw, drawId);
  return {
    store, ended,
    set: (t: number): void => { now = t; },
    advance: (ms: number): void => { now += ms; },
  };
}

const entry = (rel: string): ArtifactManifestEntry => ({
  rel, pin: { kind: 'blob', sha: SHA }, size: 10, mime: 'text/html', committed: true,
});

function input(over: Partial<CapabilityInput> = {}): CapabilityInput {
  const pin: DocPin = { kind: 'committed', commit: COMMIT, servedRef: 'main', section: 'specs', path: 'x/page.html' };
  return {
    sessionIdHash: S1, project: 'project-a', pin, ref: { commit: COMMIT, served: 'main' }, section: 'specs', dir: 'x',
    page: 'x/page.html', manifest: new Map([['x/page.html', entry('x/page.html')]]), origins: ['https://a.test'],
    windows: false, ...over,
  };
}

/** The page's own committed entry plus `n` uncommitted ones: the store counts its `drafts` from these. */
function draftsManifest(n: number): Map<string, ArtifactManifestEntry> {
  const m = new Map([['x/page.html', entry('x/page.html')]]);
  for (let i = 0; i < n; i++) {
    m.set(`x/d${i}.js`, { rel: `x/d${i}.js`, pin: { kind: 'fp', sha: SHA }, size: 5, mime: 'text/javascript', committed: false });
  }
  return m;
}

function mintOk(r: ReturnType<typeof rig>, over: Partial<CapabilityInput> = {}) {
  const m = r.store.mint(input(over));
  if (!m.ok) throw new Error(`mint refused: ${m.error}`);
  return m;
}

/** Every string reachable from `v`, through objects, arrays, Maps and Sets, keys included. */
function stringsIn(v: unknown, seen = new Set<unknown>()): string[] {
  if (typeof v === 'string') return [v];
  if (v === null || typeof v !== 'object' || seen.has(v)) return [];
  seen.add(v);
  const out: string[] = [];
  if (v instanceof Map) {
    for (const [k, x] of v) out.push(...stringsIn(k, seen), ...stringsIn(x, seen));
  } else if (v instanceof Set || Array.isArray(v)) {
    for (const x of v) out.push(...stringsIn(x, seen));
  } else {
    for (const [k, x] of Object.entries(v)) out.push(k, ...stringsIn(x, seen));
  }
  return out;
}

describe('store: the minted token', () => {
  it('store: minted token length', () => {
    // The default draws: no injected token or id source.
    const store = createArtifactStore(() => T0, { of: () => 'live' });
    const m = store.mint(input());
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(m.token, 'base64url').length).toBe(32);
    expect(m.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(m.expiresAt).toBe(T0 + ARTIFACT_IDLE_MS);
    expect(store.lookup(m.token)?.id).toBe(m.id);
  });

  it('a minted token looks up, a malformed, unknown or revoked one is null', () => {
    const r = rig();
    const m = mintOk(r);
    expect(r.store.lookup(m.token)?.id).toBe(m.id);
    expect(r.store.lookup('')).toBeNull();
    expect(r.store.lookup('short')).toBeNull();
    expect(r.store.lookup(m.token + 'a')).toBeNull();
    expect(r.store.lookup(tok(999))).toBeNull();
    expect(r.store.revoke(m.id)).toBe(true);
    expect(r.store.lookup(m.token)).toBeNull();
    expect(r.store.revoke(m.id)).toBe(false);
  });

  it('lookup answers a frozen view of the record, with the fields the mint stored', () => {
    const r = rig();
    const m = mintOk(r, { manifest: draftsManifest(2), windows: true });
    const c = r.store.lookup(m.token)!;
    expect(Object.isFrozen(c)).toBe(true);
    expect(c).toMatchObject({
      id: m.id, tokenHash: sha256hex(m.token), sessionIdHash: S1, project: 'project-a', section: 'specs', dir: 'x',
      page: 'x/page.html', drafts: 2, windows: true, mintedAt: T0, lastAt: T0, origins: ['https://a.test'],
    });
    expect(c.manifest.get('x/page.html')?.committed).toBe(true);
    expect(c.manifest.size).toBe(3);
    expect([...c.manifest.keys()].sort()).toEqual(['x/d0.js', 'x/d1.js', 'x/page.html']);
  });

  it('store: no write reaches a record through a view or the mint\'s own objects', () => {
    const r = rig();
    const asked = input();
    const m = r.store.mint(asked);
    if (!m.ok) throw new Error('mint refused');
    const c = r.store.lookup(m.token)!;
    // The view's manifest has no write method, and the face is frozen.
    const asMap = c.manifest as unknown as Partial<Map<string, ArtifactManifestEntry>>;
    expect(asMap.set).toBeUndefined();
    expect(asMap.delete).toBeUndefined();
    expect(asMap.clear).toBeUndefined();
    expect(Object.isFrozen(c.manifest)).toBe(true);
    // Each entry, its pin, the ref, the pin and the origins are frozen.
    const page = c.manifest.get('x/page.html')!;
    for (const o of [page, page.pin, c.ref, c.pin, c.origins]) expect(Object.isFrozen(o)).toBe(true);
    // Changing what the mint door handed in changes nothing stored.
    (asked.manifest as Map<string, ArtifactManifestEntry>).set('y/evil.js', entry('y/evil.js'));
    const handed = (asked.manifest as Map<string, ArtifactManifestEntry>).get('x/page.html')!;
    handed.size = 999;
    handed.committed = false;
    (asked.origins as string[]).push('https://evil.test');
    const again = r.store.lookup(m.token)!;
    expect(again.manifest.has('y/evil.js')).toBe(false);
    expect(again.manifest.get('x/page.html')).toMatchObject({ size: 10, committed: true });
    expect(again.drafts).toBe(0);
    expect(again.origins).toEqual(['https://a.test']);
  });
});

describe('store: expiry and the session', () => {
  it('store: idle 3600000 is null', () => {
    const r = rig();
    const m = mintOk(r);
    r.advance(ARTIFACT_IDLE_MS - 1);
    expect(r.store.lookup(m.token)).not.toBeNull();
    r.advance(1);
    expect(r.store.lookup(m.token)).toBeNull();
  });

  it('touch moves the idle clock, and only for a live capability', () => {
    const r = rig();
    const m = mintOk(r);
    r.advance(ARTIFACT_IDLE_MS - 1);
    r.store.touch(m.id);
    const touchedAt = T0 + ARTIFACT_IDLE_MS - 1;
    r.advance(ARTIFACT_IDLE_MS - 1);
    expect(r.store.lookup(m.token)?.lastAt).toBe(touchedAt);
    r.advance(1);
    expect(r.store.lookup(m.token)).toBeNull();
    expect(() => r.store.touch(m.id)).not.toThrow();
    expect(() => r.store.touch('unknown')).not.toThrow();
  });

  it('store: touch does not revive an idle-dead one', () => {
    const r = rig();
    const m = mintOk(r);
    // Dead by the idle clock, and not yet dropped: no lookup, list or mint has asked since.
    r.advance(ARTIFACT_IDLE_MS);
    r.store.touch(m.id);
    expect(r.store.lookup(m.token)).toBeNull();
  });

  it('store: 43200000 after mint is null when touched', () => {
    const r = rig();
    const m = mintOk(r);
    for (let t = 1800000; t < ARTIFACT_MAX_AGE_MS; t += 1800000) {
      r.set(T0 + t);
      expect(r.store.lookup(m.token)).not.toBeNull();
      r.store.touch(m.id);
    }
    r.set(T0 + ARTIFACT_MAX_AGE_MS - 1);
    expect(r.store.lookup(m.token)).not.toBeNull();
    r.store.touch(m.id);
    r.set(T0 + ARTIFACT_MAX_AGE_MS);
    expect(r.store.lookup(m.token)).toBeNull();
  });

  it('store: with drafts, 7200000 is null', () => {
    const r = rig();
    const m = mintOk(r, { manifest: draftsManifest(1) });
    for (let t = 1800000; t < ARTIFACT_MAX_AGE_DRAFT_MS; t += 1800000) {
      r.set(T0 + t);
      expect(r.store.lookup(m.token)).not.toBeNull();
      r.store.touch(m.id);
    }
    r.set(T0 + ARTIFACT_MAX_AGE_DRAFT_MS - 1);
    expect(r.store.lookup(m.token)).not.toBeNull();
    r.store.touch(m.id);
    r.set(T0 + ARTIFACT_MAX_AGE_DRAFT_MS);
    expect(r.store.lookup(m.token)).toBeNull();
  });

  it('expiresAt is the earlier of the idle and the absolute end', () => {
    expect(expiresAt({ mintedAt: 0, lastAt: 0, drafts: 0 })).toBe(ARTIFACT_IDLE_MS);
    expect(expiresAt({ mintedAt: 0, lastAt: ARTIFACT_MAX_AGE_MS, drafts: 0 })).toBe(ARTIFACT_MAX_AGE_MS);
    expect(expiresAt({ mintedAt: 0, lastAt: ARTIFACT_MAX_AGE_MS, drafts: 1 })).toBe(ARTIFACT_MAX_AGE_DRAFT_MS);
    expect(expiresAt({ mintedAt: 5, lastAt: 10, drafts: 3 })).toBe(10 + ARTIFACT_IDLE_MS);
  });

  it('store: an ended session makes it null', () => {
    const r = rig();
    const a = mintOk(r);
    const b = mintOk(r, { sessionIdHash: S2 });
    expect(r.store.lookup(a.token)).not.toBeNull();
    r.ended.add(S1);
    expect(r.store.lookup(a.token)).toBeNull();
    expect(r.store.lookup(b.token), 'another session is unaffected').not.toBeNull();
  });
});

describe('store: the limits', () => {
  it('store: the 33rd mint refuses', () => {
    const r = rig();
    const sessions = [S1, S2, S3];
    for (let i = 0; i < ARTIFACT_MAX_LIVE; i++) mintOk(r, { sessionIdHash: sessions[Math.floor(i / ARTIFACT_MAX_LIVE_PER_SESSION)]! });
    expect(r.store.list()).toHaveLength(ARTIFACT_MAX_LIVE);
    const m = r.store.mint(input({ sessionIdHash: S3 }));
    expect(m).toEqual({ ok: false, error: 'too-many' });
    expect(r.store.list()).toHaveLength(ARTIFACT_MAX_LIVE);
  });

  it('store: the 17th mint for one session refuses', () => {
    const r = rig();
    for (let i = 0; i < ARTIFACT_MAX_LIVE_PER_SESSION; i++) mintOk(r);
    expect(r.store.mint(input())).toEqual({ ok: false, error: 'too-many' });
    expect(r.store.mint(input({ sessionIdHash: S2 })).ok, 'another session still mints').toBe(true);
  });

  it('store: expired ones do not count', () => {
    const r = rig();
    for (let i = 0; i < ARTIFACT_MAX_LIVE; i++) mintOk(r, { sessionIdHash: i < ARTIFACT_MAX_LIVE_PER_SESSION ? S1 : S2 });
    r.advance(ARTIFACT_IDLE_MS);
    const m = r.store.mint(input());
    expect(m.ok).toBe(true);
    const rows = r.store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(m.ok ? m.id : '');
  });

  it('an ended session\'s capabilities do not count either', () => {
    const r = rig();
    for (let i = 0; i < ARTIFACT_MAX_LIVE_PER_SESSION; i++) mintOk(r);
    expect(r.store.mint(input()).ok).toBe(false);
    r.ended.add(S1);
    // The session ended: its capabilities are dead, so they are dropped and do not count against a mint for it.
    expect(r.store.mint(input()).ok).toBe(true);
    expect(r.store.list()).toEqual([]);
  });
});

describe('store: no plaintext token', () => {
  it('store: no plaintext token', () => {
    const r = rig();
    const a = mintOk(r);
    const b = mintOk(r, { sessionIdHash: S2, manifest: draftsManifest(1) });
    for (const m of [a, b]) {
      const c = r.store.lookup(m.token)!;
      expect(c.tokenHash).toBe(sha256hex(m.token));
      for (const s of stringsIn(c)) expect(s, 'the view').not.toBe(m.token);
      // The manifest is a read-only face, not a Map, so its entries are walked through its own iterator.
      for (const s of stringsIn([...c.manifest.entries()])) expect(s, 'the manifest').not.toBe(m.token);
    }
    for (const row of r.store.list()) {
      for (const s of stringsIn(row)) expect(s, 'a list row').not.toBe(a.token);
      for (const s of stringsIn(row)) expect(s, 'a list row').not.toBe(b.token);
    }
    // The store's records live in its closure, out of a walk's reach; every field of a record reaches its view
    // (`lookup` copies the whole record), so the view walk above is the walk of what is stored.
  });

  it('list rows have no url or token key', () => {
    const r = rig();
    mintOk(r);
    mintOk(r, { manifest: draftsManifest(1), pin: { kind: 'draft', branch: 'ws/x', head: COMMIT, section: 'specs', path: 'x/page.html', fp: SHA } });
    for (const row of r.store.list()) {
      expect(Object.keys(row).sort()).toEqual(
        ['id', 'lastAt', 'mintedAt', 'expiresAt', 'origins', 'path', 'pinLabel', 'project', 'section', 'windows'].sort());
      expect(row).not.toHaveProperty('url');
      expect(row).not.toHaveProperty('token');
    }
  });

  it('a list row labels a committed pin by its first 12 characters and a draft pin by its branch', () => {
    const r = rig();
    const c = mintOk(r);
    const d = mintOk(r, {
      manifest: draftsManifest(1), windows: true, origins: ['https://b.test'],
      pin: { kind: 'draft', branch: 'ws/x', head: COMMIT, section: 'specs', path: 'x/page.html', fp: SHA },
    });
    const rows = r.store.list();
    expect(rows.find((x) => x.id === c.id)).toEqual({
      id: c.id, project: 'project-a', section: 'specs', path: 'x/page.html', pinLabel: COMMIT.slice(0, 12), mintedAt: T0, lastAt: T0,
      expiresAt: T0 + ARTIFACT_IDLE_MS, windows: false, origins: ['https://a.test'],
    });
    expect(rows.find((x) => x.id === d.id)).toMatchObject({ pinLabel: 'draft on ws/x', windows: true, origins: ['https://b.test'] });
  });
});

describe('store: revocation', () => {
  it('revokeAll(session) kills only that session\'s', () => {
    const r = rig();
    const a1 = mintOk(r);
    const a2 = mintOk(r);
    const b = mintOk(r, { sessionIdHash: S2 });
    expect(r.store.revokeAll(S1)).toBe(2);
    expect(r.store.lookup(a1.token)).toBeNull();
    expect(r.store.lookup(a2.token)).toBeNull();
    expect(r.store.lookup(b.token)).not.toBeNull();
    expect(r.store.revokeAll()).toBe(1);
    expect(r.store.lookup(b.token)).toBeNull();
    expect(r.store.list()).toEqual([]);
    expect(r.store.revokeAll()).toBe(0);
  });
});

describe('store: the draw', () => {
  it('an accept that refuses the first draw stores only the second token', () => {
    const r = rig();
    const first = tok(1);
    const m = r.store.mint(input(), (t) => t !== first);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.token).toBe(tok(2));
    expect(r.store.lookup(first)).toBeNull();
    expect(r.store.lookup(tok(2))).not.toBeNull();
    expect(r.store.list()).toHaveLength(1);
  });

  it('an accept that refuses all of them answers unmeasured with nothing stored', () => {
    const r = rig();
    let calls = 0;
    const m = r.store.mint(input(), () => { calls++; return false; });
    expect(m).toEqual({ ok: false, error: 'unmeasured' });
    expect(calls).toBe(ARTIFACT_MINT_DRAWS);
    expect(r.store.list()).toEqual([]);
    for (let i = 1; i <= ARTIFACT_MINT_DRAWS; i++) expect(r.store.lookup(tok(i))).toBeNull();
  });

  it('a malformed draw is redrawn, and a source that never draws a token answers unmeasured', () => {
    const bad = rig({ draw: () => 'not-a-token' });
    expect(bad.store.mint(input())).toEqual({ ok: false, error: 'unmeasured' });
    expect(bad.store.list()).toEqual([]);
    let i = 0;
    const seq = rig({ draw: () => (i++ < 3 ? 'short' : tok(7)) });
    const m = seq.store.mint(input());
    expect(m.ok && m.token).toBe(tok(7));
  });

  it('a token or an id already in the map is drawn again', () => {
    const tokens = [tok(1), tok(1), tok(2)];
    const ids = ['same', 'same', 'other'];
    const r = rig({ draw: () => tokens.shift() ?? tok(9), drawId: () => ids.shift() ?? 'x' });
    const a = mintOk(r);
    expect([a.token, a.id]).toEqual([tok(1), 'same']);
    const b = mintOk(r);
    expect([b.token, b.id]).toEqual([tok(2), 'other']);
    expect(isCapabilityToken(b.token)).toBe(true);
    expect(r.store.list()).toHaveLength(2);
  });
});

describe('store: an end is announced', () => {
  it('store: an end is announced', () => {
    const r = rig();
    const calls = { revoke: 0, all: 0, idle: 0, unknown: 0, unsub: 0, mint: 0, list: 0, ended: 0 };

    const a = mintOk(r);
    r.store.onEnd(a.id, () => { calls.revoke++; });
    r.store.revoke(a.id);
    r.store.revoke(a.id);
    expect(calls.revoke).toBe(1);

    const b = mintOk(r);
    r.store.onEnd(b.id, () => { calls.all++; });
    r.store.revokeAll();
    expect(calls.all).toBe(1);

    const c = mintOk(r);
    r.store.onEnd(c.id, () => { calls.idle++; });
    r.advance(ARTIFACT_IDLE_MS);
    expect(r.store.lookup(c.token)).toBeNull();
    expect(r.store.lookup(c.token)).toBeNull();
    expect(calls.idle).toBe(1);

    r.store.onEnd('never-minted', () => { calls.unknown++; });
    expect(calls.unknown).toBe(1);

    const d = mintOk(r);
    const off = r.store.onEnd(d.id, () => { calls.unsub++; });
    off();
    r.store.revoke(d.id);
    expect(calls.unsub).toBe(0);

    const e = mintOk(r);
    r.store.onEnd(e.id, () => { calls.mint++; });
    r.advance(ARTIFACT_IDLE_MS);
    mintOk(r);
    expect(calls.mint, 'a mint drops a dead one and announces it').toBe(1);

    const f = mintOk(r);
    r.store.onEnd(f.id, () => { calls.list++; });
    r.advance(ARTIFACT_IDLE_MS);
    r.store.list();
    r.store.list();
    expect(calls.list, 'a list drops a dead one and announces it').toBe(1);

    const g = mintOk(r);
    r.store.onEnd(g.id, () => { calls.ended++; });
    r.ended.add(S1);
    expect(r.store.lookup(g.token)).toBeNull();
    expect(calls.ended, 'an ended session is an end').toBe(1);
  });

  it('every subscriber of one capability runs once, and one that throws does not stop the others', () => {
    const r = rig();
    const m = mintOk(r);
    const ran: string[] = [];
    r.store.onEnd(m.id, () => { ran.push('a'); });
    r.store.onEnd(m.id, () => { throw new Error('boom'); });
    r.store.onEnd(m.id, () => { ran.push('c'); });
    expect(() => r.store.revoke(m.id)).not.toThrow();
    expect(ran).toEqual(['a', 'c']);
  });

  it('a dead capability\'s subscriber that subscribes after the end runs at once', () => {
    const r = rig();
    const m = mintOk(r);
    r.store.revoke(m.id);
    let n = 0;
    r.store.onEnd(m.id, () => { n++; });
    expect(n).toBe(1);
  });

  it('a subscriber to one dead by the clock but not yet dropped runs at once, and the earlier ones run once', () => {
    const r = rig();
    const m = mintOk(r);
    const ran: string[] = [];
    r.store.onEnd(m.id, () => { ran.push('early'); });
    r.advance(ARTIFACT_IDLE_MS);
    r.store.onEnd(m.id, () => { ran.push('late'); });
    expect(ran).toEqual(['early', 'late']);
    expect(r.store.lookup(m.token)).toBeNull();
    expect(ran).toEqual(['early', 'late']);
  });

  it('a subscriber that revokes another capability during revokeAll is counted once, and nothing ends twice', () => {
    const r = rig();
    const a = mintOk(r);
    const b = mintOk(r);
    let bEnds = 0;
    r.store.onEnd(b.id, () => { bEnds++; });
    r.store.onEnd(a.id, () => { r.store.revoke(b.id); });
    expect(r.store.revokeAll()).toBe(1);
    expect(bEnds).toBe(1);
    expect(r.store.list()).toEqual([]);
  });
});

// X5 A3.3 (D-9135): the store is the one writer of a capability's in-flight, queued and hourly counters and of the box-wide
// in-flight count; `admitLoad` and `admitQueued` (policy.ts) decide, the store only counts and hands out tickets.
type Admit = ReturnType<ReturnType<typeof rig>['store']['admit']>;

/** Admit `n` requests on one capability and answer each answer, in order. */
function admitN(r: ReturnType<typeof rig>, id: string, n: number): Admit[] {
  const out: Admit[] = [];
  for (let i = 0; i < n; i++) out.push(r.store.admit(id));
  return out;
}

const ticketOf = (a: Admit): number => {
  if (a.kind !== 'run' && a.kind !== 'wait') throw new Error(`no ticket in ${a.kind}`);
  return a.ticket;
};

describe('X5 A3.3: admission, budget and snapshots (D-9135)', () => {
  it('store: admission runs four, then waits', () => {
    const r = rig();
    const m = mintOk(r);
    const answers = admitN(r, m.id, ARTIFACT_MAX_INFLIGHT + 2);
    expect(answers.map((a) => a.kind)).toEqual(['run', 'run', 'run', 'run', 'wait', 'wait']);
    expect(new Set(answers.map(ticketOf)).size, 'every ticket is its own').toBe(6);
    expect(r.store.boxInflight()).toBe(4);
    r.store.release(ticketOf(answers[0]!));
    expect(r.store.promote(ticketOf(answers[4]!))).toEqual({ kind: 'run' });
    expect(r.store.promote(ticketOf(answers[5]!))).toEqual({ kind: 'wait' });
    expect(r.store.boxInflight()).toBe(4);
    const view = r.store.lookup(m.token)!;
    expect(view.inflight).toBe(4);
    expect(view.queued).toBe(1);
    // a request that arrives behind a queue waits, even when a slot stands free
    r.store.release(ticketOf(answers[1]!));
    expect(r.store.admit(m.id).kind).toBe('wait');
  });

  it('store: the box holds sixteen', () => {
    const r = rig();
    const ids = [0, 1, 2, 3, 4].map(() => mintOk(r).id);
    const running: number[] = [];
    for (const id of ids.slice(0, 4)) {
      for (const a of admitN(r, id, ARTIFACT_MAX_INFLIGHT)) {
        expect(a.kind).toBe('run');
        running.push(ticketOf(a));
      }
    }
    expect(running).toHaveLength(ARTIFACT_MAX_INFLIGHT_BOX);
    expect(r.store.boxInflight()).toBe(16);
    const fifth = r.store.admit(ids[4]!);
    expect(fifth.kind).toBe('wait');
    expect(r.store.promote(ticketOf(fifth))).toEqual({ kind: 'wait' });
    r.store.release(running[9]!);
    expect(r.store.boxInflight()).toBe(15);
    expect(r.store.promote(ticketOf(fifth))).toEqual({ kind: 'run' });
    expect(r.store.boxInflight()).toBe(16);
  });

  it('store: a full queue refuses', () => {
    const r = rig();
    const m = mintOk(r);
    admitN(r, m.id, ARTIFACT_MAX_INFLIGHT);
    const waiting = admitN(r, m.id, ARTIFACT_QUEUE_PER_CAPABILITY);
    expect(waiting.every((a) => a.kind === 'wait')).toBe(true);
    expect(r.store.admit(m.id)).toEqual({ kind: 'full' });
    expect(r.store.lookup(m.token)!.queued).toBe(64);
    r.store.release(ticketOf(waiting[10]!));
    expect(r.store.lookup(m.token)!.queued).toBe(63);
    expect(r.store.admit(m.id).kind).toBe('wait');
    expect(r.store.admit(m.id)).toEqual({ kind: 'full' });
  });

  it('store: a slot is freed once', () => {
    const r = rig();
    const caps = [0, 1, 2, 3, 4].map(() => mintOk(r).id);
    for (const id of caps.slice(0, 3)) admitN(r, id, ARTIFACT_MAX_INFLIGHT);
    admitN(r, caps[3]!, 3);
    const mine = ticketOf(r.store.admit(caps[4]!));
    expect(r.store.boxInflight()).toBe(16);
    r.store.release(mine);
    r.store.release(mine);
    r.store.release(mine);
    expect(r.store.boxInflight()).toBe(15);
    expect(r.store.admit(caps[4]!).kind).toBe('run');
    expect(r.store.admit(caps[4]!).kind).toBe('wait');
    // an unknown ticket frees nothing
    r.store.release(987654);
    expect(r.store.boxInflight()).toBe(16);
  });

  it('store: a slot is freed once, a waiting ticket too, and a promoted ticket is a running one', () => {
    const r = rig();
    const m = mintOk(r);
    const held = admitN(r, m.id, ARTIFACT_MAX_INFLIGHT).map(ticketOf);
    const w = ticketOf(r.store.admit(m.id));
    r.store.release(w);
    r.store.release(w);
    expect(r.store.lookup(m.token)!.queued).toBe(0);
    expect(r.store.promote(w), 'a released ticket is gone').toEqual({ kind: 'gone' });
    expect(r.store.promote(987654)).toEqual({ kind: 'gone' });
    const w2 = ticketOf(r.store.admit(m.id));
    expect(r.store.lookup(m.token)!.queued).toBe(1);
    r.store.release(held[0]!);
    expect(r.store.promote(w2)).toEqual({ kind: 'run' });
    expect(r.store.promote(w2), 'it is running now, not waiting').toEqual({ kind: 'gone' });
    r.store.release(w2);
    r.store.release(w2);
    const v = r.store.lookup(m.token)!;
    expect(v.inflight).toBe(3);
    expect(v.queued).toBe(0);
    expect(r.store.boxInflight()).toBe(3);
  });

  it('store: a dead capability frees its box slots only by release', () => {
    const r = rig();
    const other = mintOk(r);
    const m = mintOk(r);
    const otherRun = ticketOf(r.store.admit(other.id));
    const running = admitN(r, m.id, ARTIFACT_MAX_INFLIGHT).map(ticketOf);
    const waiting = admitN(r, m.id, 2).map(ticketOf);
    expect(r.store.boxInflight()).toBe(5);
    expect(r.store.revoke(m.id)).toBe(true);
    expect(r.store.boxInflight(), 'running tickets still hold their box slots').toBe(5);
    for (const t of waiting) expect(r.store.promote(t)).toEqual({ kind: 'dead' });
    for (const t of waiting) expect(r.store.promote(t), 'the ended ticket is spent').toEqual({ kind: 'gone' });
    r.store.release(waiting[0]!);
    expect(r.store.boxInflight()).toBe(5);
    for (const t of running) r.store.release(t);
    expect(r.store.boxInflight()).toBe(1);
    for (const t of running) r.store.release(t);
    expect(r.store.boxInflight(), 'a second release frees nothing').toBe(1);
    r.store.release(otherRun);
    expect(r.store.boxInflight()).toBe(0);
  });

  it('store: a dead capability frees its box slots only by release, ended by the clock too', () => {
    const r = rig();
    const m = mintOk(r);
    const running = ticketOf(r.store.admit(m.id));
    const waiting = admitN(r, m.id, ARTIFACT_MAX_INFLIGHT + 1).map(ticketOf).slice(-1)[0]!;
    r.advance(ARTIFACT_IDLE_MS);
    expect(r.store.promote(waiting)).toEqual({ kind: 'dead' });
    expect(r.store.boxInflight()).toBe(ARTIFACT_MAX_INFLIGHT);
    r.store.release(running);
    expect(r.store.boxInflight()).toBe(ARTIFACT_MAX_INFLIGHT - 1);
  });

  it('store: admit after an end is dead', () => {
    const r = rig();
    const ends = { revoke: 0, idle: 0, session: 0 };
    const a = mintOk(r);
    r.store.onEnd(a.id, () => { ends.revoke++; });
    r.store.revoke(a.id);
    expect(r.store.admit(a.id)).toEqual({ kind: 'dead' });
    expect(r.store.admit(a.id)).toEqual({ kind: 'dead' });
    expect(ends.revoke).toBe(1);

    const b = mintOk(r);
    r.store.onEnd(b.id, () => { ends.idle++; });
    r.advance(ARTIFACT_IDLE_MS);
    expect(r.store.admit(b.id)).toEqual({ kind: 'dead' });
    expect(r.store.admit(b.id)).toEqual({ kind: 'dead' });
    expect(ends.idle).toBe(1);

    const c = mintOk(r);
    r.store.onEnd(c.id, () => { ends.session++; });
    r.ended.add(S1);
    expect(r.store.admit(c.id)).toEqual({ kind: 'dead' });
    expect(r.store.admit(c.id)).toEqual({ kind: 'dead' });
    expect(ends.session).toBe(1);

    expect(r.store.admit('never-minted')).toEqual({ kind: 'dead' });
    expect(r.store.boxInflight()).toBe(0);
  });

  it('store: the hour\'s budget', () => {
    const r = rig();
    const m = mintOk(r);
    const start = r.store.lookup(m.token)!;
    expect(start.servedThisHour).toBe(0);
    expect(start.hourStart).toBe(T0);
    expect(r.store.charge(m.id, ARTIFACT_HOURLY_BYTES - 10)).toBe('ok');
    expect(r.store.charge(m.id, 10)).toBe('ok');
    expect(r.store.lookup(m.token)!.servedThisHour).toBe(ARTIFACT_HOURLY_BYTES);
    expect(r.store.charge(m.id, 1)).toBe('over-budget');
    expect(r.store.lookup(m.token)!.servedThisHour, 'a refused charge charges nothing').toBe(ARTIFACT_HOURLY_BYTES);
    // the window is an hour from its start, not from the last request
    r.set(T0 + 3_000_000);
    r.store.touch(m.id); // keeps the capability from idling out across the hour
    r.set(T0 + 3_600_000 - 1);
    expect(r.store.charge(m.id, 1)).toBe('over-budget');
    r.set(T0 + 3_600_000);
    expect(r.store.charge(m.id, 5)).toBe('ok');
    expect(r.store.lookup(m.token)).toMatchObject({ hourStart: T0 + 3_600_000, servedThisHour: 5 });
  });

  it('store: the hour\'s budget restarts its window', () => {
    const r = rig();
    const m = mintOk(r);
    expect(r.store.charge(m.id, ARTIFACT_HOURLY_BYTES)).toBe('ok');
    expect(r.store.charge(m.id, 1)).toBe('over-budget');
    r.set(T0 + 3_000_000);
    r.store.touch(m.id);
    r.set(T0 + 3_600_000);
    expect(r.store.charge(m.id, 5)).toBe('ok');
    const v = r.store.lookup(m.token)!;
    expect(v.hourStart).toBe(T0 + 3_600_000);
    expect(v.servedThisHour).toBe(5);
    // a charge that is not a whole, non-negative count of bytes fails shut and charges nothing
    expect(r.store.charge(m.id, -1)).toBe('over-budget');
    expect(r.store.charge(m.id, Number.NaN)).toBe('over-budget');
    expect(r.store.lookup(m.token)!.servedThisHour).toBe(5);
  });

  it('store: the hour\'s budget fails shut for a dead capability', () => {
    const r = rig();
    const m = mintOk(r);
    r.store.revoke(m.id);
    expect(r.store.charge(m.id, 1)).toBe('over-budget');
    expect(r.store.charge('never-minted', 1)).toBe('over-budget');
  });

  it('store: snapshots per entry', () => {
    const r = rig();
    const m = mintOk(r, { manifest: new Map([['x/page.html', entry('x/page.html')], ['x/a.js', entry('x/a.js')]]) });
    expect(r.store.lookup(m.token)!.snapshots.size).toBe(0);
    r.store.recordSnapshot(m.id, 'x/a.js', 'snap-1');
    expect(r.store.lookup(m.token)!.snapshots.get('x/a.js')).toBe('snap-1');
    r.store.recordSnapshot(m.id, 'x/a.js', 'snap-2');
    expect(r.store.lookup(m.token)!.snapshots.get('x/a.js')).toBe('snap-2');
    r.store.recordSnapshot(m.id, 'x/page.html', 'snap-p');
    expect(r.store.lookup(m.token)!.snapshots.size).toBe(2);
    r.store.recordSnapshot(m.id, 'x/a.js', null);
    expect(r.store.lookup(m.token)!.snapshots.has('x/a.js')).toBe(false);
    expect(r.store.lookup(m.token)!.snapshots.get('x/page.html')).toBe('snap-p');
    // a key outside the manifest is left alone, and so is a dead or unknown id
    r.store.recordSnapshot(m.id, 'x/other.js', 'snap-x');
    expect(r.store.lookup(m.token)!.snapshots.has('x/other.js')).toBe(false);
    r.store.recordSnapshot('never-minted', 'x/a.js', 'snap-y');
    const ended = mintOk(r);
    r.store.revoke(ended.id);
    expect(() => r.store.recordSnapshot(ended.id, 'x/page.html', 'snap-z')).not.toThrow();
    // the face is read-only: no writer, frozen, and a cast write changes nothing the store reads
    const face = r.store.lookup(m.token)!.snapshots as unknown as Record<string, unknown>;
    expect(Object.isFrozen(face)).toBe(true);
    for (const w of ['set', 'delete', 'clear']) expect(face[w], w).toBeUndefined();
    expect(() => { face['set'] = () => {}; }).toThrow();
    expect(r.store.lookup(m.token)!.snapshots.size).toBe(1);
    expect([...r.store.lookup(m.token)!.snapshots]).toEqual([['x/page.html', 'snap-p']]);
  });

  it('store: the view\'s counters are read-only and the record\'s own', () => {
    const r = rig();
    const m = mintOk(r);
    admitN(r, m.id, ARTIFACT_MAX_INFLIGHT);
    const v = r.store.lookup(m.token)!;
    expect(Object.isFrozen(v)).toBe(true);
    const w = v as unknown as Record<string, unknown>;
    for (const k of ['inflight', 'queued', 'servedThisHour', 'hourStart']) {
      expect(() => { w[k] = 0; }, k).toThrow();
    }
    expect(v.inflight).toBe(ARTIFACT_MAX_INFLIGHT);
    // the view is the record at the moment of the lookup: a later admit moves the record, not the old view
    const t = ticketOf(r.store.admit(m.id));
    expect(t).toBeGreaterThan(0);
    expect(v.queued).toBe(0);
    expect(r.store.lookup(m.token)!.queued).toBe(1);
    expect(r.store.admit(m.id).kind).toBe('wait');
    // and a list row carries none of the counters
    expect(Object.keys(r.store.list()[0]!)).not.toContain('inflight');
    expect(Object.keys(r.store.list()[0]!)).not.toContain('snapshots');
  });
});
