// ARCH-73's spawn ratchets (D-7055, W8 Task C8c; ARCH-73 (#808), its spawn half; spec K17 "Process spawn"): the
// bounded update spawner is ONE body, `shared/spawn.mjs#boundedSpawn`. Each count below was measured at the base and
// may only shrink: update-spawn bodies outside the kernel 2 -> 0 (the implementations 2 -> 1), and
// `UPDATE_SPAWN_MAX_BUFFER` definitions 2 -> 1. The wire constants the body reads stay single-defined in
// `shared/agent-protocol.ts`, and the kernel defines neither. The spawn chain's own area file (C8c creates it; C8d
// and C8e extend it); a repo-walking guard, so a `WALK_FLOOR` member (`.github/ci/testmap.mjs`).
import { describe, expect, it } from 'vitest';
import { REPO, sitesOf } from '../consolidationCensus.js';
import { processSpawnSites, spawnKernelWireLiterals, updateSpawnBodies, updateSpawnCalls } from '../census-w8/spawn.js';
import { malformedEntries } from '../rings/exemptions.js';
import { PROCESS_SPAWNERS } from './spawners.data.js';

/** Every tree a definition could be written in. */
const DIRS = ['agent/src', 'server/src', 'shared', 'deploy', 'pwa/src'];
/** The files holding a `const|let|var <name>` code line. */
const definedIn = (name: string): string[] =>
  [...new Set(sitesOf(REPO, DIRS, new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`, 'g')).map((s) => s.file))].sort();

describe('one bounded update spawner, shared/spawn.mjs (D-7055; ARCH-73)', () => {
  it('one bounded update spawner: no update-spawn body, and no spawn( with its options, outside shared/spawn.mjs', () => {
    expect(updateSpawnBodies()).toEqual([]);
    expect(updateSpawnCalls()).toEqual([]);
  });

  it('the kernel defines no drain or bound, and passes setTimeout no literal delay', () => {
    expect(spawnKernelWireLiterals()).toEqual([]);
  });

  it('UPDATE_SPAWN_MAX_BUFFER is defined once, in shared/spawn.mjs', () => {
    expect(definedIn('UPDATE_SPAWN_MAX_BUFFER')).toEqual(['shared/spawn.mjs']);
  });

  it('UPDATE_SPAWN_DRAIN_MS and UPDATE_SPAWN_TIMEOUT_MS are each defined once, in shared/agent-protocol.ts', () => {
    expect(definedIn('UPDATE_SPAWN_DRAIN_MS')).toEqual(['shared/agent-protocol.ts']);
    expect(definedIn('UPDATE_SPAWN_TIMEOUT_MS')).toEqual(['shared/agent-protocol.ts']);
  });
});

// D-7056 (W8 Task C8d; ARCH-73 (#808); spec K17 "Audited one at a time"): every process spawner has a row and a reason
// in `spawners.data.ts`, and the set may only shrink. Measured: 10 spawners at ccba6f9b6, 9 once C8c folded the update
// pair into `shared/spawn.mjs`. C8e folds the account-op pair and lowers the ceiling to its count.
const PROCESS_SPAWNERS_CEILING = 9;

describe('every process spawner is audited, with its reason (D-7056; ARCH-73)', () => {
  const sites = (): string[] => [...new Set(processSpawnSites().map((s) => s.key))].sort();
  const rows = (): string[] => Object.keys(PROCESS_SPAWNERS).sort();

  it('every spawner has a reason: each processSpawnSites() key has a PROCESS_SPAWNERS row', () => {
    expect(sites().filter((k) => !(k in PROCESS_SPAWNERS)), 'a new spawner needs a row and a reason in spawners.data.ts').toEqual([]);
  });

  it('no stale spawner row: each PROCESS_SPAWNERS row names a site processSpawnSites() finds', () => {
    const found = new Set(sites());
    expect(rows().filter((k) => !found.has(k)), 'a row whose site is gone must go').toEqual([]);
  });

  it('the set may only shrink, and every row is well formed', () => {
    expect(rows().length).toBeLessThanOrEqual(PROCESS_SPAWNERS_CEILING);
    expect(malformedEntries(PROCESS_SPAWNERS)).toEqual([]);
  });

  it('localcaps.ts#execCapped carries the audit\'s verdict: kept', () => {
    expect(PROCESS_SPAWNERS['server/src/localcaps.ts#execCapped']?.reason).toMatch(/^KEPT by the C8d audit \(D-7056\)/);
  });
});
