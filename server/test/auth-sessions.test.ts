// sessions.ts is the flat-file session store whose loss is FREE — the deliberate
// inverse of secret.ts. secret.ts THROWS (boot refusal) on a present-but-garbled
// secret, because an unreadable passphrase file must never read as "no passphrase"
// and fail OPEN. Sessions take the OPPOSITE stance: a corrupt or unreadable
// sessions.json refuses exactly ONE caller ('no-session', one warn) and never
// crashes boot, because a lost session just means "log in again". These tests pin
// both the security core (sha256 stored, NEVER the token; generation-bump
// invalidation; absolute + idle TTL) and that degrade-not-crash contrast, and they
// drive the NotifyLog concurrent-write hazard the flush chain exists to close.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  SessionStore, ABSOLUTE_TTL_MS, IDLE_TTL_MS, SWEEP_INTERVAL_MS,
} from '../src/auth/sessions.js';
import { mkTmp } from './tmpHelpers.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A store over a fresh (never-created) file in an isolated tmp dir. NEVER the
 *  live ~/.ccrc — every fixture is under `os.tmpdir()` via `mkTmp`. */
function freshStore(): { store: SessionStore; file: string } {
  const dir = mkTmp('ccrc-auth-sessions-');
  const file = path.join(dir, 'sessions.json');
  return { store: new SessionStore(file), file };
}

afterEach(() => vi.restoreAllMocks());

describe('create → verify roundtrip', () => {
  it('a freshly minted token verifies "ok" at the same generation', async () => {
    const { store } = freshStore();
    const now = Date.now();
    const { token } = await store.create('phone', 1, now);
    expect(store.verify(token, 1, now)).toBe('ok');
  });

  it('an unknown token is "no-session" (not "expired": nothing was ever valid)', async () => {
    const { store } = freshStore();
    const now = Date.now();
    await store.create('phone', 1, now);
    expect(store.verify('not-a-real-token', 1, now)).toBe('no-session');
  });

  it('the persisted writes survive a reload from disk, not just memory', async () => {
    const { store, file } = freshStore();
    const now = Date.now();
    const { token } = await store.create('phone', 1, now);
    const reloaded = new SessionStore(file);
    await reloaded.load();
    expect(reloaded.verify(token, 1, now)).toBe('ok');
  });
});

describe('the security core — sha256(token) is stored, never the token', () => {
  it('the persisted file contains no substring of the raw token', async () => {
    const { store, file } = freshStore();
    const now = Date.now();
    const { token } = await store.create('phone', 1, now);
    const bytes = readFileSync(file, 'utf8');
    expect(token.length).toBeGreaterThan(20);
    // The whole token, and a prefix of it — a mutation that stored the token
    // (or any truncation of it) instead of its hash reds here.
    expect(bytes).not.toContain(token);
    expect(bytes).not.toContain(token.slice(0, 16));
  });

  it('writes the file owner-only (0600)', async () => {
    const { store, file } = freshStore();
    await store.create('phone', 1, Date.now());
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('generation bump — how `ccrc passwd` invalidates everything without a restart', () => {
  it('a session stamped gen 1 reads "expired" the moment the current generation is 2', async () => {
    const { store } = freshStore();
    const now = Date.now();
    const { token } = await store.create('phone', 1, now);
    expect(store.verify(token, 1, now)).toBe('ok');
    // The mutation that skips the generation compare returns 'ok' here.
    expect(store.verify(token, 2, now)).toBe('expired');
  });
});

describe('TTLs — a phone PWA left open for days, and one abandoned', () => {
  it('past the idle TTL → "expired", though the absolute window has room', async () => {
    const { store } = freshStore();
    const t0 = Date.now();
    const { token } = await store.create('phone', 1, t0);
    const idleGap = t0 + IDLE_TTL_MS + HOUR;    // idle blown; far under the 30d absolute
    expect(idleGap - t0).toBeLessThan(ABSOLUTE_TTL_MS);
    expect(store.verify(token, 1, idleGap)).toBe('expired');
  });

  it('the absolute TTL fires even on a session kept warm — idle alone would never expire it', async () => {
    const { store } = freshStore();
    const t0 = Date.now();
    const { token } = await store.create('phone', 1, t0);
    // Warm it forward in idle-sized steps so the idle clock never lapses; every
    // step inside the absolute window is 'ok'.
    const step = IDLE_TTL_MS - HOUR;
    let t = t0;
    while (t - t0 <= ABSOLUTE_TTL_MS) {
      expect(store.verify(token, 1, t)).toBe('ok');
      t += step;
    }
    // t is now just past the absolute TTL, and lastSeenAt is the previous warm
    // step — WITHIN idle of t. So only the absolute cap can be the cause here.
    expect(t - t0).toBeGreaterThan(ABSOLUTE_TTL_MS);
    expect(store.verify(token, 1, t)).toBe('expired');
  });

  it('verify bumps lastSeenAt in memory, so continued use keeps a session alive across the idle window', async () => {
    const { store } = freshStore();
    const t0 = Date.now();
    const { token } = await store.create('phone', 1, t0);
    const mid = t0 + IDLE_TTL_MS - HOUR;         // still inside idle → 'ok', bumps lastSeen to mid
    expect(store.verify(token, 1, mid)).toBe('ok');
    const later = t0 + IDLE_TTL_MS + HOUR;       // > idle from t0, but < idle from mid
    // Without the in-memory lastSeenAt bump this reads 'expired'.
    expect(store.verify(token, 1, later)).toBe('ok');   // and this bumps lastSeen to `later`
    // …and a jump beyond idle from the LAST use (`later`) finally expires it.
    expect(store.verify(token, 1, later + IDLE_TTL_MS + HOUR)).toBe('expired');
  });
});

describe('revoke — logout one, and log out everywhere', () => {
  it('revokeThis removes exactly the one session', async () => {
    const { store } = freshStore();
    const now = Date.now();
    const { token: a } = await store.create('phone', 1, now);
    const { token: b } = await store.create('laptop', 1, now);
    await store.revokeThis(a);
    expect(store.verify(a, 1, now)).toBe('no-session');
    expect(store.verify(b, 1, now)).toBe('ok');
  });

  it('revokeAll clears every session (the explicit "log out everywhere")', async () => {
    const { store, file } = freshStore();
    const now = Date.now();
    const { token: a } = await store.create('phone', 1, now);
    const { token: b } = await store.create('laptop', 1, now);
    await store.revokeAll();
    expect(store.verify(a, 1, now)).toBe('no-session');
    expect(store.verify(b, 1, now)).toBe('no-session');
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk).toEqual([]);
  });
});

describe('a corrupt store DEGRADES — it never throws to boot (the inverse of secret.ts)', () => {
  it('garbled JSON: load() warns and starts empty; verify → "no-session", no throw', async () => {
    const dir = mkTmp('ccrc-auth-sessions-');
    const file = path.join(dir, 'sessions.json');
    writeFileSync(file, '{ this is not valid json ]');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new SessionStore(file);
    await expect(store.load()).resolves.toBeUndefined();   // the mutation "corrupt → throw" reds this
    expect(warn).toHaveBeenCalled();
    expect(store.verify('anything', 1, Date.now())).toBe('no-session');
  });

  it('well-formed JSON of the WRONG shape (an object, not an array) also degrades, not throws', async () => {
    const dir = mkTmp('ccrc-auth-sessions-');
    const file = path.join(dir, 'sessions.json');
    writeFileSync(file, '{"not":"an array"}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new SessionStore(file);
    await expect(store.load()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(store.verify('anything', 1, Date.now())).toBe('no-session');
  });

  it('an ABSENT file is the ordinary first run — empty, and SILENT (no warn)', async () => {
    const { store } = freshStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store.load();
    expect(warn).not.toHaveBeenCalled();
    expect(store.verify('anything', 1, Date.now())).toBe('no-session');
  });
});

describe('concurrent writes contend on ONE tmp path — the NotifyLog hazard the flush chain closes', () => {
  it('a fan of concurrent creates ALL persist — no write clobbers another', async () => {
    const { store, file } = freshStore();
    const now = Date.now();
    // Fire twelve creates without awaiting between them: every flush() writes the
    // SAME `${path}.${pid}.tmp` and races to rename it over the target. Without the
    // serializing flush chain, some renames clobber and the reloaded store is short
    // records. With it, all twelve land.
    const tokens = await Promise.all(
      Array.from({ length: 12 }, (_, i) => store.create(`dev${i}`, 1, now).then((r) => r.token)),
    );
    const reloaded = new SessionStore(file);
    await reloaded.load();
    for (const t of tokens) expect(reloaded.verify(t, 1, now)).toBe('ok');
  });

  it('interleaved create + create + revoke all land; the final file is valid JSON and correct', async () => {
    const { store, file } = freshStore();
    const now = Date.now();
    const [{ token: a }, { token: b }] = await Promise.all([
      store.create('a', 1, now), store.create('b', 1, now),
    ]);
    await store.revokeThis(a);
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(Array.isArray(parsed)).toBe(true);
    const reloaded = new SessionStore(file);
    await reloaded.load();
    expect(reloaded.verify(a, 1, now)).toBe('no-session');
    expect(reloaded.verify(b, 1, now)).toBe('ok');
  });
});

describe('sweep — dropping the dead on load, and pruning the file on the timer', () => {
  it('load sweeps out sessions already past their TTL (create-stamped in the past)', async () => {
    const { store, file } = freshStore();
    const past = Date.now() - (ABSOLUTE_TTL_MS + 10 * DAY);   // older than the absolute cap
    const { token } = await store.create('stale', 1, past);
    const reloaded = new SessionStore(file);
    await reloaded.load();
    expect(reloaded.verify(token, 1, Date.now())).toBe('no-session');
  });

  it('the periodic sweep prunes AND persists — only the live record is left on disk', async () => {
    const { store, file } = freshStore();
    const now = Date.now();
    await store.create('stale', 1, now - (ABSOLUTE_TTL_MS + 10 * DAY));
    const { token: live } = await store.create('fresh', 1, now);
    await store.sweepAndFlush(now);
    const onDisk: unknown = JSON.parse(readFileSync(file, 'utf8'));
    expect(Array.isArray(onDisk) && onDisk.length).toBe(1);
    expect(store.verify(live, 1, now)).toBe('ok');
  });

  it('startSweep schedules on the minutes cadence (not the mail lane\'s seconds), and stopSweep clears it', () => {
    const { store } = freshStore();
    const setI = vi.spyOn(globalThis, 'setInterval');
    const clearI = vi.spyOn(globalThis, 'clearInterval');
    store.startSweep();
    expect(setI).toHaveBeenCalledTimes(1);
    expect(setI.mock.calls[0][1]).toBe(SWEEP_INTERVAL_MS);
    expect(SWEEP_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);   // minutes, never seconds
    store.stopSweep();
    expect(clearI).toHaveBeenCalledTimes(1);
  });
});
