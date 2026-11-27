// Native Docs HTML artifacts X5, plan Task A2.2: the `SessionLiveness` adapter over a real `SessionStore` and a real secret file.
// A capability keeps no generation of its own: every lookup reads the CURRENT secret (`measureSecret`, the gate's own reader), so a
// passphrase change, a missing secret or an unusable one ends every capability with no other act. Fixtures are fresh files under
// the run's temp root.
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DocPin } from '../../shared/docs.js';
import { measureSecret } from '../src/auth/gate.js';
import { hashLine } from '../src/auth/secret.js';
import { SessionStore, sessionIdHash } from '../src/auth/sessions.js';
import { sessionLiveness } from '../src/artifacts/liveness.js';
import { createArtifactStore, type CapabilityInput } from '../src/artifacts/store.js';
import { mkTmp } from './tmpHelpers.js';

const PARAMS = { n: 1024, r: 8, p: 1, keylen: 32 };
const COMMIT = 'c'.repeat(40);

function input(sessionIdHash: string): CapabilityInput {
  const pin: DocPin = { kind: 'committed', commit: COMMIT, servedRef: 'main', section: 'specs', path: 'page.html' };
  return {
    sessionIdHash, project: 'project-a', pin, ref: { commit: COMMIT, served: 'main' }, section: 'specs', dir: '', page: 'page.html',
    manifest: new Map(), origins: [], windows: false,
  };
}

async function writeSecret(file: string, generation: number): Promise<void> {
  writeFileSync(file, `${await hashLine('correct horse', PARAMS, generation)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

async function rig() {
  const dir = mkTmp('ccrc-artifact-liveness-');
  const secretFile = path.join(dir, 'auth.secret');
  await writeSecret(secretFile, 1);
  const now = Date.now();
  const sessions = new SessionStore(path.join(dir, 'sessions.json'));
  const { token: session } = await sessions.create('phone', 1, now);
  const store = createArtifactStore(() => now, sessionLiveness(sessions, () => measureSecret(secretFile)));
  const m = store.mint(input(sessionIdHash(session)));
  if (!m.ok) throw new Error(`mint refused: ${m.error}`);
  return { store, token: m.token, secretFile };
}

describe('store: a capability follows the secret', () => {
  it('a live session at the current generation looks up', async () => {
    const r = await rig();
    expect(r.store.lookup(r.token)).not.toBeNull();
  });

  it('store: a passphrase change ends it', async () => {
    const r = await rig();
    expect(r.store.lookup(r.token)).not.toBeNull();
    await writeSecret(r.secretFile, 2);
    expect(r.store.lookup(r.token)).toBeNull();
  });

  it('store: a missing secret ends it', async () => {
    const r = await rig();
    expect(r.store.lookup(r.token)).not.toBeNull();
    rmSync(r.secretFile);
    expect(r.store.lookup(r.token)).toBeNull();
  });

  it('store: an unusable secret ends it', async () => {
    const r = await rig();
    expect(r.store.lookup(r.token)).not.toBeNull();
    writeFileSync(r.secretFile, 'this is not a secret line\n', { mode: 0o600 });
    expect(measureSecret(r.secretFile).kind).toBe('unusable');
    expect(r.store.lookup(r.token)).toBeNull();
  });
});

describe('liveness: the adapter', () => {
  const live = { livenessOf: () => 'live' as const };

  it('liveness: the adapter never throws', () => {
    expect(sessionLiveness(live, () => { throw new Error('secret read blew up'); }).of('a'.repeat(64), 1)).toBe('ended');
    const secret = { kind: 'ok' as const, secret: { generation: 1 } };
    expect(sessionLiveness({ livenessOf: () => { throw new Error('store blew up'); } }, () => secret).of('a'.repeat(64), 1)).toBe('ended');
  });

  it('only an ok reading reaches the store, which is asked with the measured generation and the time', () => {
    const asked: unknown[][] = [];
    const sessions = { livenessOf: (...a: [string, number, number]) => { asked.push(a); return 'live' as const; } };
    expect(sessionLiveness(sessions, () => ({ kind: 'ok', secret: { generation: 7 } })).of('h', 42)).toBe('live');
    expect(asked).toEqual([['h', 7, 42]]);
    for (const reading of [{ kind: 'unread' }, { kind: 'absent' }, { kind: 'unusable' }] as const) {
      expect(sessionLiveness(sessions, () => reading).of('h', 42), reading.kind).toBe('ended');
    }
    expect(asked).toHaveLength(1);
  });

  it('it reads the secret on every call, never caching a generation', () => {
    let generation = 1;
    const sessions = { livenessOf: (_h: string, g: number) => (g === 1 ? 'live' as const : 'ended' as const) };
    const l = sessionLiveness(sessions, () => ({ kind: 'ok', secret: { generation } }));
    expect(l.of('h', 0)).toBe('live');
    generation = 2;
    expect(l.of('h', 0)).toBe('ended');
  });
});
