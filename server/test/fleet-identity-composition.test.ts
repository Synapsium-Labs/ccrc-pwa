// Path-identity spec 2026-10-12 §5.2: production carries the identity cell. `Deps.fleetIdentity`, `fleet.identity`
// and `ownIdentity` are all optional, so a deleted line is no type error and fails closed in silence: Settings Live
// would never arm, with every other suite green. No test imports index.ts (`refreshcaps.test.ts` says why), so these
// are text pins over the composition root and the inventory's deps builder, in the idiom of
// `update-inventory.test.ts`'s "index.ts composes the update lanes", each beside the behaviour it stands for.
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_FILES } from '../../shared/agent-protocol.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { FleetIdentityCell } from '../src/fleetidentity.js';
import { localIO, type FleetIO } from '../src/io.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { codeOnly } from './sourceScan.js';
import { mkTmp } from './tmpHelpers.js';

const U1 = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
const U2 = '11111111-2222-4333-8444-555555555555';
const indexTs = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const watchTs = readFileSync(new URL('../src/watch.ts', import.meta.url), 'utf8');
/** The two `deps = { … };` object literals, remote arm first (the `if`). */
const depsLiterals = indexTs.match(/^  deps = \{\n[\s\S]*?^  \};$/gm) ?? [];
const runInventory = /^  private async runInventory\(\): Promise<SweepOutcome\[\]> \{\n[\s\S]*?^  \}$/m.exec(watchTs)?.[0] ?? '';
const plantNodeId = (ccrcDir: string, id: string): void => {
  mkdirSync(ccrcDir, { recursive: true });
  writeFileSync(path.join(ccrcDir, NODE_FILES.nodeId), `${id}\n`);
};

describe('the composition root wires the identity cell (path-identity spec §5.2)', () => {
  it('both deps literals carry fleetIdentity; the remote one is fleet.identity', () => {
    expect(depsLiterals).toHaveLength(2);
    expect(depsLiterals[0]).toContain('io: fleet.io');
    expect(depsLiterals[1]).toContain('io: localIO');
    expect(depsLiterals[0]).toMatch(/^    fleetIdentity: fleet\.identity,$/m);
    expect(depsLiterals[1]).toMatch(/^    fleetIdentity: localFleetIdentity,$/m);
    // The local arm's cell is the one cell index.ts builds, and nothing there invalidates it: epoch 0 for ever.
    expect(indexTs).toMatch(/^  const localFleetIdentity = new FleetIdentityCell\(\);$/m);
    expect(codeOnly(indexTs).match(/\bnew FleetIdentityCell\s*\(/g) ?? []).toHaveLength(1);
    expect(codeOnly(indexTs)).not.toMatch(/\.invalidate\s*\(/);
  });

  it('runInventory hands the cell to fleet and to ownIdentity by mode', async () => {
    expect(runInventory, 'runInventory was not found in watch.ts').not.toBe('');
    expect(runInventory).toMatch(/\{ io: this\.deps\.io, state: fleetState, identity: this\.deps\.fleetIdentity \}/);
    expect(runInventory).toMatch(/^\s+ownIdentity: cfg\.fleetMode === 'remote' \? undefined : this\.deps\.fleetIdentity,$/m);

    // Local: this box is the fleet node, so the server row's own sweep publishes into the cell, under epoch 0.
    const localHome = mkTmp('ccrc-ident-watch-local-');
    const local = testDeps(localHome);
    plantNodeId(local.cfg.ccrcDir, U1);
    const localCell = new FleetIdentityCell();
    const localPublish = vi.spyOn(localCell, 'publish');
    const lw = new FleetWatcher({ ...local, coord: new CoordStore(openCoordDb(local.cfg.coordDbPath)), fleetIdentity: localCell },
      new Bus(), 60_000, path.join(localHome, 'state-cache.json'));
    await lw.inventoryNow();
    expect(localPublish).toHaveBeenCalledTimes(1);
    expect(localCell.current()).toMatchObject({ kind: 'known', connectionEpoch: 0, nodeId: U1 });

    // Remote, two boxes: the server row reads this home (node U1), and the fleet io serves another directory at the
    // same absolute path (node U2). Exactly one publish is made, by the fleet sweep, and it names U2.
    const remoteHome = mkTmp('ccrc-ident-watch-remote-');
    const remote = testDeps(remoteHome);
    const serverCcrc = remote.cfg.ccrcDir;
    const fleetCcrc = path.join(mkTmp('ccrc-ident-watch-fleetbox-'), '.ccrc');
    plantNodeId(serverCcrc, U1);
    plantNodeId(fleetCcrc, U2);
    const onFleet = (p: string): string =>
      (p.startsWith(`${serverCcrc}${path.sep}`) ? path.join(fleetCcrc, path.relative(serverCcrc, p)) : p);
    const fleetIo: FleetIO = {
      ...localIO,
      lstatMeasured: (p) => localIO.lstatMeasured(onFleet(p)),
      statMeasured: (p) => localIO.statMeasured(onFleet(p)),
      readFileMeasured: (p, timeoutMs, signal) => localIO.readFileMeasured(onFleet(p), timeoutMs, signal),
    };
    const remoteCell = new FleetIdentityCell();
    remoteCell.invalidate('awaiting-inventory');
    const remotePublish = vi.spyOn(remoteCell, 'publish');
    const rw = new FleetWatcher({
      ...remote, cfg: { ...remote.cfg, fleetMode: 'remote', role: 'server' }, io: fleetIo,
      fleetState: { connected: true, downSince: null, ccdVerbs: null, rosterFp: null, build: null },
      coord: new CoordStore(openCoordDb(remote.cfg.coordDbPath)), fleetIdentity: remoteCell,
    }, new Bus(), 60_000, path.join(remoteHome, 'state-cache.json'));
    await rw.inventoryNow();
    expect(remotePublish.mock.calls.map(([, m]) => m)).toEqual([{ kind: 'known', nodeId: U2, measuredAt: expect.any(Number) }]);
    expect(remoteCell.current()).toMatchObject({ kind: 'known', connectionEpoch: 1, nodeId: U2 });
  });

  it('only the inventory publishes into the cell, and only the fleet client invalidates it', () => {
    // fleetidentity.ts's header and client.ts's field docstring say so; this case is the mechanism. Code only, every
    // server/src .ts file; `__`-prefixed transients are skipped (boot.test.ts's mutant copy of index.ts).
    const SRC = fileURLToPath(new URL('../src/', import.meta.url));
    const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !path.basename(f).startsWith('__'));
    const holders = (re: RegExp): string[] => files.flatMap((f) => {
      const n = (codeOnly(readFileSync(path.join(SRC, f), 'utf8')).match(re) ?? []).length;
      return n === 0 ? [] : [`${f.split(path.sep).join('/')}:${n}`];
    }).sort();
    expect('identity.cell.publish(identity.captured, m);'.match(/\.publish\s*\(/g), 'CONTROL: a publish call is seen').toHaveLength(1);
    expect(holders(/\.publish\s*\(/g), 'a second publisher of the fleet identity').toEqual(['update/inventory.ts:2']);
    expect(holders(/\.invalidate\s*\(/g), 'a second invalidator of the fleet identity').toEqual(['remote/client.ts:3']);
  });

  it('refreshCaps is built with fleet.identity', () => {
    expect(depsLiterals[0]).toMatch(/^    refreshCaps: makeRefreshCaps\(fleet\.client, fleet\.state, fleet\.identity\),$/m);
    expect(codeOnly(indexTs).match(/\bmakeRefreshCaps\s*\(/g) ?? []).toHaveLength(1);
  });
});
