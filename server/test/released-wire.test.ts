// `FleetSession.releasedFrom`'s two read paths (workspace lifecycle spec §5.1): the accessor a cast live frame is
// read through, and the reviver a persisted snapshot goes through.
import { describe, it, expect } from 'vitest';
import { releasedFromOf, reviveFleetSession, type FleetSession, type ReleasedFrom } from '../../shared/api.js';

const REL: ReleasedFrom = {
  runId: 41, program: 'lifecycle', programTitle: 'Workspace lifecycle', claimedBy: 'demo-coordinator',
  closedAt: 1_790_000_000_000, child: false,
};

const session: FleetSession = {
  id: 'demo-amber', wrapper: 'claude', home: '/home/rc', project: 'demo', workdir: '/data/projects/demo',
  workspace: 'amber', name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' }, releasedFrom: null,
};

/** The session as a persisted snapshot holds it — JSON, with `releasedFrom` replaced or removed. */
const raw = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const o = JSON.parse(JSON.stringify(session)) as Record<string, unknown>;
  delete o['releasedFrom'];
  return { ...o, ...over };
};

it('CONTROL: the base snapshot revives at all — every case below would pass on a rejected session otherwise', () => {
  expect(reviveFleetSession(raw())).not.toBeNull();
});

describe('releasedFromOf — the one reader', () => {
  it('reads a present value', () => {
    expect(releasedFromOf({ releasedFrom: REL } as FleetSession)).toEqual(REL);
  });

  it('reads a key an older server never sent exactly as null', () => {
    expect(releasedFromOf({} as FleetSession)).toBeNull();
  });
});

describe('reviveFleetSession carries releasedFrom', () => {
  it('round-trips a well-formed value', () => {
    expect(reviveFleetSession(raw({ releasedFrom: REL }))!.releasedFrom).toEqual(REL);
  });

  it('revives an absent key as null — a snapshot from before the field describes nothing released', () => {
    expect(reviveFleetSession(raw())!.releasedFrom).toBeNull();
  });

  it.each([
    ['a string run id', { ...REL, runId: '41' }],
    ['a zero run id', { ...REL, runId: 0 }],
    ['a non-string programme', { ...REL, program: 7 }],
    ['a missing title key', (({ programTitle: _t, ...rest }) => rest)(REL)],
    ['a numeric claimant', { ...REL, claimedBy: 3 }],
    ['a null close time', { ...REL, closedAt: null }],
    ['a zero close time — the server only ever sends a positive safe integer', { ...REL, closedAt: 0 }],
    ['a string child flag', { ...REL, child: 'false' }],
    ['an array', [REL]],
  ] as const)('revives %s as null and KEEPS the session — null is the safe direction here', (_label, bad) => {
    const s = reviveFleetSession(raw({ releasedFrom: bad }));
    expect(s).not.toBeNull();
    expect(s!.releasedFrom).toBeNull();
  });
});
