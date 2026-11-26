// Native Docs HTML artifacts X5, plan Task A2.1: a session's liveness asked by its id. A capability keeps only its minting
// session's id hash, never the token, and asks the session store whether that session still verifies, by the same row
// compare, generation and TTL rules the gate's `verifyMeasured` applies, with no side effect: it never refreshes
// `lastSeenAt`, so an open artifact never keeps its session awake. Every fixture is a fresh file under the run's temp root.
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ABSOLUTE_TTL_MS, IDLE_TTL_MS, SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { mkTmp } from './tmpHelpers.js';

function freshStore(): { store: SessionStore; file: string } {
  const dir = mkTmp('ccrc-auth-liveness-');
  const file = path.join(dir, 'sessions.json');
  return { store: new SessionStore(file), file };
}

const T0 = 1_800_000_000_000;

describe('liveness: by id (X5 A2.1)', () => {
  it('liveness: a fresh session is live', async () => {
    const { store } = freshStore();
    const { token } = await store.create('phone', 1, T0);
    expect(store.livenessOf(sessionIdHash(token), 1, T0)).toBe('live');
    expect(store.livenessOf(sessionIdHash(token), 1, T0 + IDLE_TTL_MS)).toBe('live');
  });

  it('liveness: a revoked session is ended', async () => {
    const { store } = freshStore();
    const { token } = await store.create('phone', 1, T0);
    const other = await store.create('laptop', 1, T0);
    await store.revokeThis(token);
    expect(store.livenessOf(sessionIdHash(token), 1, T0)).toBe('ended');
    expect(store.livenessOf(sessionIdHash(other.token), 1, T0), 'only the revoked one').toBe('live');
  });

  it('liveness: past the idle TTL is ended', async () => {
    const { store } = freshStore();
    const { token } = await store.create('phone', 1, T0);
    expect(store.livenessOf(sessionIdHash(token), 1, T0 + IDLE_TTL_MS + 1)).toBe('ended');
  });

  it('liveness: past the absolute TTL is ended, however recently it was seen', async () => {
    const { store } = freshStore();
    const { token } = await store.create('phone', 1, T0);
    // Keep the idle clock fresh through the gate's own verify, so only the absolute TTL can end it.
    for (let t = T0 + IDLE_TTL_MS / 2; t < T0 + ABSOLUTE_TTL_MS; t += IDLE_TTL_MS / 2) expect(store.verify(token, 1, t)).toBe('ok');
    expect(store.verify(token, 1, T0 + ABSOLUTE_TTL_MS - 1)).toBe('ok');
    expect(store.livenessOf(sessionIdHash(token), 1, T0 + ABSOLUTE_TTL_MS - 1)).toBe('live');
    expect(store.livenessOf(sessionIdHash(token), 1, T0 + ABSOLUTE_TTL_MS + 1)).toBe('ended');
  });

  it('liveness: a generation bump ends it', async () => {
    const { store } = freshStore();
    const { token } = await store.create('phone', 1, T0);
    expect(store.livenessOf(sessionIdHash(token), 2, T0)).toBe('ended');
    expect(store.livenessOf(sessionIdHash(token), 0, T0)).toBe('ended');
  });

  it('liveness: a malformed or unknown id is ended', async () => {
    const { store } = freshStore();
    const { token } = await store.create('phone', 1, T0);
    const id = sessionIdHash(token);
    for (const bad of ['', 'zz', id.slice(0, 63), id + '0', id.slice(0, 62) + 'zz', 'not hex at all', token]) {
      expect(store.livenessOf(bad, 1, T0), JSON.stringify(bad)).toBe('ended');
    }
    expect(store.livenessOf(sessionIdHash('another token'), 1, T0)).toBe('ended');
  });

  it('liveness: asking leaves lastSeenAt unchanged', async () => {
    const { store, file } = freshStore();
    const { token } = await store.create('phone', 1, T0);
    const id = sessionIdHash(token);
    // Asked again and again near the idle edge: had any ask refreshed the idle clock, the session would outlive it.
    const before = statSync(file).ino;
    for (let i = 1; i <= 5; i++) expect(store.livenessOf(id, 1, T0 + IDLE_TTL_MS - i)).toBe('live');
    expect(store.livenessOf(id, 1, T0 + IDLE_TTL_MS + 1)).toBe('ended');
    // Nothing was marked to be written: the periodic unit writes only when something is pending, and a write replaces the
    // file by rename, so the same inode means no write happened.
    await store.sweepAndFlush(T0 + 1);
    expect(statSync(file).ino, 'an ask marked the store dirty').toBe(before);
    // And the row still holds the time `create` stamped.
    await store.flush();
    const rows = JSON.parse(readFileSync(file, 'utf8')) as { lastSeenAt: number }[];
    expect(rows.map((r) => r.lastSeenAt)).toEqual([T0]);
  });

  it('liveness: an id is lower-case hex only, as the store writes it', async () => {
    const { store } = freshStore();
    const { token } = await store.create('phone', 1, T0);
    expect(store.livenessOf(sessionIdHash(token).toUpperCase(), 1, T0)).toBe('ended');
  });
});
