// Programme ledgers (plan PL4, review 1336 F2): the ids the stale label's presence reading holds are the registry
// listing's own `*.uuid` names, so a listed row the registry could not assemble (no `wrapper`, no `workdir`) is a
// doubt (`unmeasured`), never an absence. Fixture homes only, through the registry-listing rig.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { primed, rig } from './fleetListingFixture.js';
import { coordinatorPresenceIn } from '../../shared/ledgers.js';
import { removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => { vi.restoreAllMocks(); removeTmpFixtures(); });

describe('the watcher\'s listed ids (review 1336 F2)', () => {
  it('hold a listed row that could not be assembled, which the fleet frame lacks, so its presence reads unmeasured', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    // A torn row: its uuid is listed, its wrapper and workdir are not there, so `buildRecord` answers null for it.
    writeFileSync(path.join(r.cfg.registryDir, 'demo-torn.uuid'), 'u-demo-torn');
    await primed(r);
    const ids = r.w.currentRegistryIds();
    expect(ids, 'a listing has landed').not.toBeNull();
    expect([...ids!].sort()).toEqual(['demo-a', 'demo-torn']);
    const fleet = r.w.currentFleet();
    expect(fleet, 'a fleet frame has been broadcast').not.toBeNull();
    expect(fleet!.some((s) => s.id === 'demo-torn'), 'the torn row is in no fleet row').toBe(false);
    expect(coordinatorPresenceIn(fleet, ids, 'demo-torn')).toBe('unmeasured');
    expect(coordinatorPresenceIn(fleet, ids, 'demo-gone')).toBe('absent');
  });

  // CHARACTERIZATION (desktop-polish carry, review 1338 F2, D-7950): pinned green on main before the listed ids moved onto
  // `RegistryRead`. The set is every `*.uuid` basename of the listing: a built row, a torn row and a refused id (one
  // `isRegistryId` refuses, a leading dash) alike, and no name that is not a `.uuid` (another field of a listed row, a field
  // of a row with no `.uuid`, a stray file).
  it('are every `*.uuid` basename of the listing, a refused id included, and no other name', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    writeFileSync(path.join(r.cfg.registryDir, 'demo-torn.uuid'), 'u-demo-torn');
    writeFileSync(path.join(r.cfg.registryDir, '-lead.uuid'), 'u-lead');
    writeFileSync(path.join(r.cfg.registryDir, 'demo-nouuid.hold'), 'program:p wave:1/2');
    writeFileSync(path.join(r.cfg.registryDir, 'stray.txt'), 'x');
    await primed(r);
    expect([...r.w.currentRegistryIds()!].sort()).toEqual(['-lead', 'demo-a', 'demo-torn']);
  });
});
