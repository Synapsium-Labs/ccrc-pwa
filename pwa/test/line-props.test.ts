// C9 / D-6441: the fleet list's two memo gates (`lineProps.ts`). `SessionLine` and `ProjectCard` are `memo`'d, and
// each has ONE prop its parent builds afresh on every render: `childRun` (`childRunContext`) and `placement`
// (`placementOfRow`). Those compare by `sameJson`, the one equality; every other prop by identity, as React's own
// shallow compare does, so a new callback or a new row object is still a change.
import { describe, it, expect } from 'vitest';
import type { ChildRunContext } from '../src/fleet/runWords';
import type { ProjectPlacementRead } from '../src/fleet/placementWords';
import { sameCardProps, sameLineProps } from '../src/fleet/lineProps';
import { fleetSession } from './fleetFixture';

const run = (over: Partial<NonNullable<ChildRunContext['run']>> = {}): ChildRunContext['run'] => ({
  program: 'port-api', programTitle: 'Port the API', wave: 2, waveOf: 3, ...over,
});
const child = (over: Partial<ChildRunContext> = {}): ChildRunContext => ({ run: run(), coordinator: 'the coordinator', ...over });

const measured = (pool: string, kind: 'projected' | 'unplaceable' = 'projected'): ProjectPlacementRead => ({
  kind: 'measured',
  pool: { state: 'named', name: pool },
  placement: kind === 'projected' ? { kind: 'projected', wrapper: 'lane-a', pct: 10 } : { kind: 'unplaceable' },
} as unknown as ProjectPlacementRead);

describe('sameLineProps', () => {
  const session = fleetSession({ id: 'ws-a' });
  const onOpen = (): void => {};
  const onActions = (): void => {};
  const base = { session, onOpen, onActions, selected: false };

  it('an equal childRun is the same props; another run or coordinator is not', () => {
    expect(sameLineProps({ ...base, childRun: child() }, { ...base, childRun: child() })).toBe(true);
    expect(sameLineProps({ ...base, childRun: child() }, { ...base, childRun: child({ run: run({ wave: 3 }) }) })).toBe(false);
    expect(sameLineProps({ ...base, childRun: child() }, { ...base, childRun: child({ run: null }) })).toBe(false);
    expect(sameLineProps({ ...base, childRun: child() }, { ...base, childRun: child({ coordinator: 'another' }) })).toBe(false);
    // A prop present on one side only is a change, as React's own compare counts keys.
    expect(sameLineProps({ ...base, childRun: child() }, { ...base })).toBe(false);
    expect(sameLineProps({ ...base }, { ...base, childRun: child() })).toBe(false);
  });

  it('any other prop compares by identity', () => {
    expect(sameLineProps({ ...base }, { ...base })).toBe(true);
    // An equal row that is another object is a change: `keepRows` hands an unchanged row back as the same object.
    expect(sameLineProps({ ...base }, { ...base, session: { ...session } })).toBe(false);
    expect(sameLineProps({ ...base }, { ...base, onOpen: (): void => {} })).toBe(false);
    expect(sameLineProps({ ...base }, { ...base, selected: true })).toBe(false);
    // `placement` is the card's gate, not the line's: here it compares by identity like any other prop.
    expect(sameLineProps({ ...base, placement: measured('pool-a') }, { ...base, placement: measured('pool-a') })).toBe(false);
  });
});

describe('sameCardProps', () => {
  const onOpen = (): void => {};
  const base = { onOpen, selectedId: null, adding: false };

  it('an equal placement is the same; another pool or kind is not', () => {
    expect(sameCardProps({ ...base, placement: measured('pool-a') }, { ...base, placement: measured('pool-a') })).toBe(true);
    expect(sameCardProps({ ...base, placement: { kind: 'missing' } }, { ...base, placement: { kind: 'missing' } })).toBe(true);
    expect(sameCardProps({ ...base, placement: measured('pool-a') }, { ...base, placement: measured('pool-b') })).toBe(false);
    expect(sameCardProps({ ...base, placement: measured('pool-a') }, { ...base, placement: measured('pool-a', 'unplaceable') })).toBe(false);
    expect(sameCardProps({ ...base, placement: { kind: 'missing' } }, { ...base, placement: { kind: 'legacy' } })).toBe(false);
  });

  it('any other prop compares by identity', () => {
    expect(sameCardProps({ ...base }, { ...base })).toBe(true);
    expect(sameCardProps({ ...base }, { ...base, onOpen: (): void => {} })).toBe(false);
    expect(sameCardProps({ ...base, runs: [] }, { ...base, runs: [] })).toBe(false);
    // `childRun` is the line's gate, not the card's.
    expect(sameCardProps({ ...base, childRun: child() }, { ...base, childRun: child() })).toBe(false);
  });
});
