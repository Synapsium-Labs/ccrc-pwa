import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultCachePath, loadSnapshot, saveSnapshot } from '../src/fleetstate.js';
import type { FleetSession } from '../../shared/api.js';

const tmpDir = (): string => mkdtempSync(path.join(tmpdir(), 'ccrc-cache-'));

const session = (id: string): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
  name: null, status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false, version: null,
});

describe('fleetstate', () => {
  it('defaultCachePath joins .ccrc/state-cache.json under the given home', () => {
    expect(defaultCachePath('/home/x')).toBe(path.join('/home/x', '.ccrc', 'state-cache.json'));
  });

  it('loadSnapshot returns null when the cache file does not exist', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    expect(await loadSnapshot(cachePath)).toBeNull();
  });

  it('loadSnapshot returns null for corrupt JSON', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeFileSync(cachePath, 'not json at all');
    expect(await loadSnapshot(cachePath)).toBeNull();
  });

  it('saveSnapshot writes atomically (mkdir -p, tmp+rename — no leftover tmp file) and loadSnapshot reads it back', async () => {
    const cachePath = path.join(tmpDir(), 'nested', 'dir', 'state-cache.json');
    const sessions = [session('claude-Foo'), session('claude2-Bar')];

    await saveSnapshot(sessions, cachePath);

    const entries = readdirSync(path.dirname(cachePath));
    expect(entries).toEqual(['state-cache.json']);

    const snap = await loadSnapshot(cachePath);
    expect(snap?.sessions).toEqual(sessions);
    expect(typeof snap?.savedAt).toBe('number');
  });

  it('saveSnapshot overwrites a previous snapshot in place', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    await saveSnapshot([session('claude-One')], cachePath);
    await saveSnapshot([session('claude-Two')], cachePath);

    const snap = await loadSnapshot(cachePath);
    expect(snap?.sessions).toEqual([session('claude-Two')]);
  });
});
