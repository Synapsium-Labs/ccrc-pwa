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
  hookState: null, askSummary: null, subagents: null, bucket: 'idle', bucketSince: null,
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

  // — whole-branch review, Important 3: an absent bucket is DERIVED —
  //
  // It used to land flat on `idle`, which contradicted the very record it sat
  // on: `bucket` is THE authority for the fleet's sections, counts and state
  // words (spec §1), while `ArchiveScreen` keys off `archivedAt` — so a
  // revived snapshot could list archived rows while the bucket called them
  // idle and the attention and cleanup sections read empty, in exactly the
  // degraded mode this cache exists for. The ladder's bucket needs nothing a
  // revived record lacks; only `bucketSince` needed `hookUpdatedAt`, so only
  // `bucketSince` still degrades.
  describe('an absent bucket is derived from the record, not flattened to idle', () => {
    const revive = async (over: Record<string, unknown>): Promise<FleetSession | undefined> => {
      const cachePath = path.join(tmpDir(), 'state-cache.json');
      writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), ...over }]);
      return (await loadSnapshot(cachePath))?.sessions[0];
    };

    it('a merged, archived snapshot revives as cleanup — the row ArchiveScreen already shows', async () => {
      const s = await revive({ archivedAt: 1700, pr: { phase: 'merged', ahead: 0 } });
      // bucketSince stays null even though the archived rung HAS a datable
      // timestamp: this record was never recorded as entering the bucket, and
      // the branch that derives is the branch that refuses to date it.
      expect(s?.bucket).toBe('cleanup');
      expect(s?.bucketSince).toBeNull();
    });

    it('an archived snapshot with no merged PR revives as archived', async () => {
      expect((await revive({ archivedAt: 1700 }))?.bucket).toBe('archived');
    });

    it('a waiting snapshot revives as attention — the section that must not read empty', async () => {
      expect((await revive({ hookState: 'waiting' }))?.bucket).toBe('attention');
    });

    it('a dead snapshot revives as dead', async () => {
      expect((await revive({ status: 'dead' }))?.bucket).toBe('dead');
    });

    it('a busy snapshot revives as working — v1Session IS busy, which is why idle was a lie', async () => {
      expect((await revive({}))?.bucket).toBe('working');
    });

    it('forces bucketSince to null even when the file carries one', async () => {
      // A stray `bucketSince` alongside a missing `bucket` must not survive as
      // a timestamp for a bucket this session was never recorded entering
      // (final review, Important 2) — unchanged by the derivation above.
      expect((await revive({ bucketSince: 1785300123000 }))?.bucketSince).toBeNull();
    });

    it('a RECORDED bucket is taken as recorded, ladder not run', async () => {
      // Derivation is the ABSENT case only. A snapshot that carries a bucket
      // was written by a server that had the hook timestamps this one does
      // not, so its answer — and its `bucketSince` — win outright.
      const s = await revive({ bucket: 'idle', bucketSince: 1785300123000 });
      expect(s?.bucket).toBe('idle');            // NOT 'working', though the ladder would say so
      expect(s?.bucketSince).toBe(1785300123000);
    });
  });

  it('rejects a bucket token this build does not recognise — unlike absence, idle is an affirmative claim', async () => {
    // The opposite stance from the absent case above (final review, Important
    // 3): a PRESENT-but-unrecognised bucket (a future build's retired or
    // renamed value) is not an admission of ignorance the way an absent field
    // is — landing it on 'idle' would claim nothing is pending, silently
    // emptying the attention section. Reject the whole snapshot instead, the
    // same stance the hookState test right below takes.
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), bucket: 'blocked', bucketSince: 100 }]);
    expect(await loadSnapshot(cachePath)).toBeNull();
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
