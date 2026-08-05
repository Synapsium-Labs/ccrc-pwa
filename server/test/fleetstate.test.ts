import { describe, it, expect } from 'vitest';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultCachePath, loadSnapshot, saveSnapshot } from '../src/fleetstate.js';
import type { FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const tmpDir = (): string => mkTmp('ccrc-cache-');

// A COMPLETE FleetSession. It was missing eight fields while claiming the type —
// harmless until loadSnapshot started validating what it reads, and invisible
// because server/tsconfig.json does not include test/.
const session = (id: string): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
  workspace: null, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null,
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

  it('round-trips a populated hookState/askSummary/subagents', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    const populated: FleetSession = {
      ...session('claude-quiet-basin'),
      hookState: 'waiting',
      askSummary: 'Which approach?',
      subagents: [{ name: 'reviewer', startedAt: 5 }],
    };
    await saveSnapshot([populated], cachePath);
    const s = (await loadSnapshot(cachePath))?.sessions[0];
    expect(s).toEqual(populated);
  });
});

/**
 * `state-cache.json` outlives the build that wrote it: an upgraded server reads
 * back a file from the previous one, and there is no version key here to bump —
 * the path is fixed. So the read is what has to negotiate versions.
 */
const v1Session = (id: string): Record<string, unknown> => ({
  id, wrapper: 'claude', home: '/home/rc', project: 'OpenClawHetzner',
  workdir: '/home/rc/worktrees/OpenClawHetzner/quiet-basin', workspace: 'quiet-basin',
  name: null, status: 'busy', statusUpdatedAt: 1785300000000,
  limits: { five: 10, seven: 40 }, dialogPending: false, version: '2.1.0',
  model: null, effort: null, ultracode: false, branch: 'ws/quiet-basin',
});

/** Write the cache the way an older build did — bypassing saveSnapshot, which
 *  can only ever write TODAY's shape. */
const writeRaw = (cachePath: string, sessions: unknown[]): void =>
  writeFileSync(cachePath, JSON.stringify({ sessions, savedAt: 1785300000001 }));

describe('loadSnapshot revives a cache written by an older build', () => {
  it('revives absent pr/archivedAt/tasks as null, not undefined', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [v1Session('claude-quiet-basin')]);

    const s = (await loadSnapshot(cachePath))?.sessions[0];
    // This snapshot is what degraded mode SERVES (server.ts /api/fleet), so an
    // absent archivedAt does not stay a server-side detail: it reaches the PWA,
    // where `archivedAt !== null` is true for undefined and the whole fleet
    // reads as archived.
    expect(s?.archivedAt).toBeNull();
    expect(s?.pr).toBeNull();
    expect(s?.tasks).toBeNull();
    // Task 5's own additions: an older-build snapshot predates all three, so
    // they must degrade to null exactly like pr/archivedAt/tasks above —
    // never `undefined`, which `Object.keys` would silently omit.
    expect(s?.hookState).toBeNull();
    expect(s?.askSummary).toBeNull();
    expect(s?.subagents).toBeNull();
    expect(Object.keys(s ?? {})).toEqual(expect.arrayContaining(
      ['pr', 'archivedAt', 'tasks', 'hookState', 'askSummary', 'subagents'],
    ));
    // Not a discard: what the old build did know is still here.
    expect(s?.id).toBe('claude-quiet-basin');
    expect(s?.status).toBe('busy');
    expect(s?.branch).toBe('ws/quiet-basin');
    expect(s?.limits).toEqual({ five: 10, seven: 40 });
  });

  it('revives archivedBytes independently of archivedAt — no key-swap, no shared fallback', async () => {
    // DEVIATION from the brief's given test text — added while closing a
    // mutation-sweep gap; see task-19-report.md. Same shape as the pwa-side
    // proof in offline.test.ts, but through THIS build's own consumer of
    // shared/api.ts's revival logic (loadSnapshot, the degraded-mode cache
    // read) — a key-swap in reviveFleetSession would pass every other test
    // in this file, since they all leave the two fields equal (both absent).
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), archivedAt: 100, archivedBytes: 5_000_000 }]);
    const s = (await loadSnapshot(cachePath))?.sessions[0];
    expect(s?.archivedAt).toBe(100);
    expect(s?.archivedBytes).toBe(5_000_000);
  });

  it('degrades a pr phase this build does not know to unchecked', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), pr: { phase: 'teleported', ahead: 2 } }]);
    expect((await loadSnapshot(cachePath))?.sessions[0]?.pr?.phase).toBe('unchecked');
  });

  it('rejects a hookState token this build does not recognise — no synonym for "unknown" to degrade to', async () => {
    // Unlike pr.phase, hookState is already nullable, and null already means
    // something specific ("no fresh hook data"). Landing an unrecognised
    // token there would claim NOTHING was recorded about a file that in fact
    // recorded something this build cannot parse — so the whole snapshot is
    // rejected instead, the same stance revivePr takes for `checks`.
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), hookState: 'sleeping' }]);
    expect(await loadSnapshot(cachePath)).toBeNull();
  });

  it('rejects a malformed subagents entry rather than laundering it', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), subagents: [{ name: 'reviewer' }] }]);
    expect(await loadSnapshot(cachePath)).toBeNull();
  });

  it('returns null for a malformed session rather than laundering it', async () => {
    // Degraded mode then falls through to a live assemble, which is the same
    // "no cache yet" path the route already has — visibly empty beats plausible
    // and wrong.
    const cases: [string, unknown][] = [
      ['archivedAt of the wrong type', { ...v1Session('a'), archivedAt: 'yesterday' }],
      ['pr that is not an object', { ...v1Session('a'), pr: 7 }],
      ['status outside busy|idle|dead', { ...v1Session('a'), status: 'exploded' }],
      ['no id at all', { ...v1Session('a'), id: undefined }],
      ['not an object at all', 42],
    ];
    for (const [label, bad] of cases) {
      const cachePath = path.join(tmpDir(), 'state-cache.json');
      writeRaw(cachePath, [bad]);
      expect(await loadSnapshot(cachePath), label).toBeNull();
    }
  });

  it('returns null when sessions is not an array at all', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeFileSync(cachePath, JSON.stringify({ sessions: { a: 1 }, savedAt: 1 }));
    expect(await loadSnapshot(cachePath)).toBeNull();
  });
});
