// Path-identity spec 2026-10-12 §5.2: "The current fleet identity is not the persisted update-inventory row. The
// server keeps {connectionEpoch, nodeIdState} in memory. Every accepted ready and every close invalidates it
// synchronously. An inventory read may publish a directly measured node id only while the epoch it captured still
// stands; a result from an earlier connection is discarded." This file pins the cell alone: no socket, no store.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CollectCurrentNode } from '../src/collectLane.js';
import {
  FleetIdentityCell, NO_FLEET_IDENTITY, type CurrentFleetIdentity, type FleetNodeMeasured,
} from '../src/fleetidentity.js';
import { codeOnly } from './sourceScan.js';

const U1 = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
const U2 = '11111111-2222-4333-8444-555555555555';
const KNOWN_U1: FleetNodeMeasured = { kind: 'known', nodeId: U1, measuredAt: 1_000 };
const KNOWN_U2: FleetNodeMeasured = { kind: 'known', nodeId: U2, measuredAt: 2_000 };

describe('the identity cell (path-identity spec §5.2)', () => {
  it('starts unmeasured at epoch 0, no-ready', () => {
    const cell = new FleetIdentityCell();
    expect(cell.epochNow()).toBe(0);
    expect(cell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 0, why: 'no-ready' });
  });

  it('invalidate strictly increases the epoch and resets known to unmeasured', () => {
    const cell = new FleetIdentityCell();
    expect(cell.invalidate('awaiting-inventory')).toBe(1);
    expect(cell.publish(1, KNOWN_U1)).toEqual({ kind: 'published' });
    expect(cell.current()).toEqual({ kind: 'known', connectionEpoch: 1, nodeId: U1, measuredAt: 1_000 });
    expect(cell.invalidate('link-down')).toBe(2);
    expect(cell.epochNow()).toBe(2);
    expect(cell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 2, why: 'link-down' });
    expect(cell.invalidate('awaiting-inventory')).toBe(3);
    expect(cell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 3, why: 'awaiting-inventory' });
  });

  it('publish under the current epoch is known', () => {
    const cell = new FleetIdentityCell();
    const e = cell.invalidate('awaiting-inventory');
    expect(cell.publish(e, KNOWN_U1)).toEqual({ kind: 'published' });
    expect(cell.current()).toEqual({ kind: 'known', connectionEpoch: e, nodeId: U1, measuredAt: 1_000 });
    expect(cell.epochNow(), 'publishing never moves the epoch').toBe(e);
  });

  it('publish under a stale epoch changes nothing', () => {
    // §5.9: "An old-epoch inventory completion cannot repopulate current identity."
    const cell = new FleetIdentityCell();
    const captured = cell.invalidate('awaiting-inventory');
    cell.invalidate('link-down');
    cell.invalidate('awaiting-inventory');
    const before = cell.current();
    expect(cell.publish(captured, KNOWN_U1)).toEqual({ kind: 'stale-epoch', captured: 1, current: 3 });
    expect(cell.current()).toBe(before);
    expect(cell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 3, why: 'awaiting-inventory' });
    // A capture from no connection at all is no better than one from an earlier connection.
    expect(cell.publish(4, KNOWN_U1)).toEqual({ kind: 'stale-epoch', captured: 4, current: 3 });
    expect(cell.current()).toBe(before);
  });

  it('the latest same-epoch measurement wins, fail-closed', () => {
    const cell = new FleetIdentityCell();
    const e = cell.invalidate('awaiting-inventory');
    cell.publish(e, KNOWN_U1);
    cell.publish(e, { kind: 'unmeasured', why: 'node-id-unreadable' });
    expect(cell.current()).toEqual({ kind: 'unmeasured', connectionEpoch: e, why: 'node-id-unreadable' });
    cell.publish(e, KNOWN_U2);
    expect(cell.current()).toEqual({ kind: 'known', connectionEpoch: e, nodeId: U2, measuredAt: 2_000 });
  });

  it('current().connectionEpoch === epochNow() over a random sequence', () => {
    const cell = new FleetIdentityCell();
    const MEASURED: readonly FleetNodeMeasured[] = [
      KNOWN_U1, KNOWN_U2, { kind: 'unmeasured', why: 'node-id-absent' },
      { kind: 'collision', why: 'node-id-keys-another-live-row' },
    ];
    let seed = 0x5eed;
    const next = (n: number): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
    let last = 0;
    const seen = new Set<string>();
    for (let step = 0; step < 500; step++) {
      const op = next(3);
      if (op === 0) {
        const e = cell.invalidate(next(2) === 0 ? 'awaiting-inventory' : 'link-down');
        expect(e, `step ${step}: invalidate moves the epoch by exactly one`).toBe(last + 1);
        last = e;
      } else if (op === 1) {
        expect(cell.publish(cell.epochNow(), MEASURED[next(MEASURED.length)]!)).toEqual({ kind: 'published' });
      } else {
        const before = cell.current();
        const stale = cell.epochNow() - 1 - next(3);
        expect(cell.publish(stale, MEASURED[next(MEASURED.length)]!)).toMatchObject({ kind: 'stale-epoch' });
        expect(cell.current(), `step ${step}: a stale publish changed the answer`).toBe(before);
      }
      seen.add(cell.current().kind);
      expect(cell.epochNow(), `step ${step}`).toBe(last);
      expect(cell.current().connectionEpoch, `step ${step}`).toBe(cell.epochNow());
    }
    // CONTROL: the sequence reached every kind, so the invariant was checked against each.
    expect([...seen].sort()).toEqual(['collision', 'known', 'unmeasured']);
  });

  it('collision carries no nodeId', () => {
    const cell = new FleetIdentityCell();
    const e = cell.invalidate('awaiting-inventory');
    // A caller's object that DID carry one (a cast, a spread from a row): the cell stamps field by field.
    const smuggled = { kind: 'collision', why: 'node-id-keys-another-live-row', nodeId: U1 } as unknown as FleetNodeMeasured;
    expect(cell.publish(e, smuggled)).toEqual({ kind: 'published' });
    expect(cell.current()).toEqual({ kind: 'collision', connectionEpoch: e, why: 'node-id-keys-another-live-row' });
    expect('nodeId' in cell.current()).toBe(false);
    expect(Object.keys(cell.current()).sort()).toEqual(['connectionEpoch', 'kind', 'why']);
    expect(Object.isFrozen(cell.current()), 'an answer a reader could edit in place').toBe(true);
  });

  it('CurrentFleetIdentity is assignable to CollectCurrentNode', () => {
    // TYPE-LEVEL: typecheck-tests compiles this file. An arm of CurrentFleetIdentity that the resolver's input
    // (collectLane.ts, which may not import this file) lacks is a TS2322 on the next line.
    const asNode = (c: CurrentFleetIdentity): CollectCurrentNode => c;
    const node: CollectCurrentNode = new FleetIdentityCell().current();
    expect(asNode(new FleetIdentityCell().current())).toEqual(node);
  });

  it('NO_FLEET_IDENTITY is epoch 0 and never known', () => {
    expect(NO_FLEET_IDENTITY.epochNow()).toBe(0);
    expect(NO_FLEET_IDENTITY.current()).toEqual({ kind: 'unmeasured', connectionEpoch: 0, why: 'no-identity-source' });
    expect(Object.isFrozen(NO_FLEET_IDENTITY)).toBe(true);
    expect('publish' in NO_FLEET_IDENTITY, 'a no-source reader that can be published into').toBe(false);
    expect('invalidate' in NO_FLEET_IDENTITY).toBe(false);
  });

  it('the module imports nothing and reads no clock', () => {
    const IMPORT = /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m;
    const CLOCK = /\bDate\b|\bperformance\b|\bsetTimeout\b|\bsetInterval\b/;
    expect(IMPORT.test("import { x } from './y.js';"), 'CONTROL: an import is seen').toBe(true);
    expect(CLOCK.test('const t = Date.now();'), 'CONTROL: a clock is seen').toBe(true);
    const code = codeOnly(readFileSync(new URL('../src/fleetidentity.ts', import.meta.url), 'utf8'));
    expect(code, 'fleetidentity.ts imports something').not.toMatch(IMPORT);
    expect(code, 'fleetidentity.ts reads a clock: measuredAt arrives in the measurement').not.toMatch(CLOCK);
  });
});
