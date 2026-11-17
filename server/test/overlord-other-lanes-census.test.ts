// The other write lanes' census (Overlord W1, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md`
// Task 4; spec §3.5 C48, §3.8 H10, §15 A5). Every assertion reads the sources in both directions:
//   1-2. every `attribution` and `landing-write` lane passes its key, once, at its own door;
//   3.   no key sits at the wrong door;
//   4.   the mail ingress asks once, between check 6 and check 7;
//   5.   the Linear rows are exactly the proxy's write verbs, and the plan rows exactly the plan file's write doors;
//   6.   run open and reclaim ask once each, at their places in the order;
//   7.   every write door the server registers is in exactly one class (the plan's Table 2), so a new door is red until
//        it is placed.
// It slices handlers with the box-token census's slicer (`routeRegistrations.ts`, slug `route-slicer-shared`).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OTHER_LANES, OTHER_LANE_KEYS, linearLaneOf, type OtherLane, type OtherLaneVia } from '../src/coord/otherLanes.js';
import { OPEN_RUN_GATES } from '../src/coord/openRun.js';
import { EXEMPT } from '../src/auth/gate.js';
import { LINEAR_OPS } from '../src/linear/ops.js';
import { LINEAR_PROXY_ROUTES } from '../src/linear/proxyRoutes.js';
import {
  COORD_SRC, CONTINUITY_SRC, LEDGER_SRC, LINEAR_PROXY_SRC, PLAN_SRC, REPO, handlerBody, lanesIn, read, registrationsIn,
} from './routeRegistrations.js';

const OPEN_RUN_SRC = read('server/src/coord/openRun.ts');
const RECLAIM_SRC = read('server/src/coord/reclaim.ts');

const rowsVia = (via: OtherLaneVia): OtherLane[] => OTHER_LANE_KEYS.filter((k) => OTHER_LANES[k].via === via);
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
const keysOf = (src: string): string[] => registrationsIn(src).map((r) => r.key);
/** The source that registers a route among `srcs`, by key; exactly one must. */
const registrar = (key: string, srcs: readonly string[]): string => {
  const hits = srcs.filter((s) => keysOf(s).includes(key));
  expect(hits.length, `${key} is registered by ${hits.length} of the scanned files`).toBe(1);
  return hits[0]!;
};
/** A function's text, from its declaration to the next top-level-ish marker. */
const between = (src: string, from: string, to: string): string => {
  const i = src.indexOf(from);
  expect(i, `${from} not found`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf(to, i + from.length);
  expect(j, `${to} not found after ${from}`).toBeGreaterThan(i);
  return src.slice(i, j);
};
const before = (hay: string, a: string, b: string): boolean => {
  const i = hay.indexOf(a); const j = hay.indexOf(b);
  return i >= 0 && j >= 0 && i < j;
};

describe('1-2. the attributed and landing lanes pass their keys at their own doors', () => {
  it.each(rowsVia('attribution'))('%s: its handler calls requireAttribution with the key last, exactly once', (lane) => {
    const route = OTHER_LANES[lane].route;
    const body = handlerBody(registrar(route, [COORD_SRC, LEDGER_SRC]), route);
    const calls = [...body.matchAll(/(?:deps\.)?requireAttribution\(([^;]*?)\)\)\) return/g)].map((m) => m[1]!);
    expect(calls.filter((args) => args.trimEnd().endsWith(`'${lane}'`)), route).toHaveLength(1);
    expect(calls, `${route} attributes more than once`).toHaveLength(1);
  });

  it('requireAttribution hands its lane to refuseOtherLane after the verdict passes, and only then', () => {
    const def = between(COORD_SRC, 'const requireAttribution = async (', '};');
    expect(def).toMatch(/lane\?: OtherLane/);
    expect(count(def, 'refuseOtherLane(reply, lane, whoId, otherLaneReads)')).toBe(1);
    expect(before(def, 'attributionVerdict(', 'refuseOtherLane(')).toBe(true);
    expect(def).toMatch(/v\.ok && \(lane === undefined \|\| await refuseOtherLane/);
  });

  it.each(rowsVia('landing-write'))('%s: its registration passes its key to landingWrite, once', (lane) => {
    const route = OTHER_LANES[lane].route;
    const body = handlerBody(COORD_SRC, route);
    expect(count(body, `, '${lane}')`)).toBe(1);
    expect(body).toMatch(new RegExp(`landingWrite\\(req, reply, '(entry|order)', '${lane}'\\)`));
  });

  it('landingWrite passes its lane to requireAttribution', () => {
    const def = between(COORD_SRC, 'const landingWrite = async (', "app.post('/api/landing/entries'");
    expect(def).toMatch(/lane: OtherLane\)/);
    expect(count(def, "'byUuid', lane)")).toBe(1);
  });
});

describe('3. no key at the wrong door', () => {
  const SRCS: Record<string, string> = {
    'coord/routes.ts': COORD_SRC, 'coord/ledgersRoutes.ts': LEDGER_SRC, 'coord/planRoutes.ts': PLAN_SRC,
  };
  it.each(OTHER_LANE_KEYS.filter((k) => !['linear-proxy', 'open-run-gate', 'reclaim-heir'].includes(OTHER_LANES[k].via)))(
    '%s is quoted only in the handler of its own route', (lane) => {
      const route = OTHER_LANES[lane].route;
      const quoted = `'${lane}'`;
      let inHandlers = 0; let inFiles = 0;
      for (const src of Object.values(SRCS)) {
        inFiles += count(src, quoted);
        if (keysOf(src).includes(route)) inHandlers += count(handlerBody(src, route), quoted);
      }
      expect([inFiles, inHandlers], `${quoted} outside ${route}`).toEqual([1, 1]);
    });

  it('every lane key quoted in those files is a row of the table', () => {
    for (const src of Object.values(SRCS)) {
      for (const m of src.matchAll(/(?:requireAttribution\([^;]*?, |landingWrite\([^;]*?, )'([A-Za-z]+)'\)|(?:door\(|refuseOtherLane\(reply, )'([A-Za-z]+)'/g)) {
        const key = m[1] ?? m[2]!;
        if (['byUuid', 'fromUuid', 'sessionUuid'].includes(key)) continue; // the uuid field, not a lane
        expect(OTHER_LANE_KEYS as string[], m[0]).toContain(key);
      }
    }
  });
});

describe('4. the mail ingress', () => {
  it('asks once, after check 6 (stale-uuid) and before check 7 (unknown-recipient)', () => {
    const body = handlerBody(COORD_SRC, OTHER_LANES.peerMail.route);
    const call = "refuseOtherLane(reply, 'peerMail', fromId, otherLaneReads)";
    expect(count(body, call)).toBe(1);
    expect(count(body, 'refuseOtherLane(')).toBe(1);
    expect(before(body, "refuse(reply, 'stale-uuid'", call)).toBe(true);
    expect(before(body, call, "refuse(reply, 'unknown-recipient'")).toBe(true);
  });
});

describe('5. the Linear and plan lanes', () => {
  it('the linear-proxy rows are exactly the write verbs of LINEAR_OPS, each at its proxy route', () => {
    const writes = Object.entries(LINEAR_OPS).filter(([, op]) => op.class === 'write').map(([v]) => v);
    const fromVerbs = writes.map((v) => linearLaneOf(v)).sort();
    expect(fromVerbs).toEqual([...rowsVia('linear-proxy')].sort());
    for (const v of writes) {
      const lane = linearLaneOf(v)!;
      expect(OTHER_LANES[lane].route, v).toBe(LINEAR_PROXY_ROUTES[v as keyof typeof LINEAR_PROXY_ROUTES]);
      expect(keysOf(LINEAR_PROXY_SRC), v).toContain(OTHER_LANES[lane].route);
    }
  });

  it('handle asks linearLaneOf and refuseOtherLane once, after attribution and before the validator', () => {
    const handle = between(LINEAR_PROXY_SRC, 'async function handle(', '\n  }\n');
    expect(count(handle, 'linearLaneOf(verb)')).toBe(1);
    expect(count(handle, 'refuseOtherLane(')).toBe(1);
    expect(before(handle, 'deps.attribute(', 'refuseOtherLane(')).toBe(true);
    expect(before(handle, 'refuseOtherLane(', 'validateLinearCall(')).toBe(true);
  });

  it('the plan-door rows are exactly the write doors planRoutes.ts registers, each its own key through door', () => {
    const writes = keysOf(PLAN_SRC).filter((k) => !/^(GET|HEAD) /.test(k)).sort();
    expect(writes).toEqual(rowsVia('plan-door').map((k) => OTHER_LANES[k].route).sort());
    for (const lane of rowsVia('plan-door')) {
      const body = handlerBody(PLAN_SRC, OTHER_LANES[lane].route);
      expect(count(body, 'door('), lane).toBe(1);
      expect(count(body, `door('${lane}', `), lane).toBe(1);
    }
  });

  it('door asks refuseOtherLane once, after attribution, before the reserved programme, the store read and serial', () => {
    const door = between(PLAN_SRC, 'const door = (lane: OtherLane, work: Work)', 'const ownerVerdict');
    expect(count(door, 'refuseOtherLane(reply, lane, id, opts.otherLaneReads)')).toBe(1);
    expect(before(door, 'opts.attribute(', 'refuseOtherLane(')).toBe(true);
    expect(before(door, 'refuseOtherLane(', 'LINEAR_SYNC_PROGRAMME')).toBe(true);
    expect(before(door, 'refuseOtherLane(', 'await workspaces(')).toBe(true);
    expect(before(door, 'refuseOtherLane(', 'opts.serial(')).toBe(true);
  });
});

describe('6. the claimant lanes', () => {
  it('OPEN_RUN_GATES holds overlordClaimant directly after attribution, and before reviewRead', () => {
    const names = OPEN_RUN_GATES.map(([g]) => g as string);
    expect(names.indexOf('overlordClaimant')).toBe(names.indexOf('attribution') + 1);
    expect(names.indexOf('overlordClaimant')).toBeLessThan(names.indexOf('reviewRead'));
    expect(count(OPEN_RUN_SRC, "decideOtherLane('runOpen'")).toBe(1);
    expect(count(OPEN_RUN_SRC, 'decideOtherLane(')).toBe(1);
  });

  it('reclaimRun asks once, after the heir\'s registry read and before the worker rung and the claimant\'s measurement', () => {
    const fn = between(RECLAIM_SRC, 'export async function reclaimRun(', '\n}\n');
    const call = "decideOtherLane('runReclaim', to,";
    expect(count(RECLAIM_SRC, 'decideOtherLane(')).toBe(1);
    expect(count(fn, call)).toBe(1);
    expect(before(fn, "case 'bad-id':", call)).toBe(true);
    expect(before(fn, call, "kind: 'heir-is-a-worker'")).toBe(true);
    expect(before(fn, call, 'measureClaimant(')).toBe(true);
  });
});

// ── 7. every write door is classified (the plan's question 8, Table 2) ────────────────────────────────────────────

type DoorClass = 'run-ownership' | 'programme-ownership' | 'lease-ownership' | 'launch-profile' | 'stays-open'
  | 'operator-sign-in';

/** The write doors outside Table 1 that a session's identity can reach (every one is in `gate.ts`' EXEMPT), by what
 *  stops the Overlord's body there. Hand-kept: a new such door is red until it has a row. */
const NOT_REFUSED: Readonly<Record<string, readonly [DoorClass, string]>> = {
  'POST /api/runs/:id/end-request': ['run-ownership', 'attribution, then the run\'s coordinator or worker (`not-yours`)'],
  'POST /api/runs/:id/review-rounds': ['run-ownership', 'attribution, then the run\'s claimant or a claimant of its programme'],
  'POST /api/items/:id/confirm': ['programme-ownership', 'attribution, then `claimsProgramme`'],
  'POST /api/items/:id/return': ['programme-ownership', 'attribution, then `claimsProgramme`'],
  'POST /api/items/:id/withdraw': ['programme-ownership', 'attribution, then `claimsProgramme`'],
  'POST /api/items/:id/blocking': ['programme-ownership', 'attribution, then `claimsProgramme`'],
  'POST /api/programmes/:slug/spec': ['programme-ownership', 'attribution, then `claimsProgramme`'],
  'POST /api/programmes/:slug/modifications': ['programme-ownership', 'attribution, then `claimsProgramme`'],
  'POST /api/programmes/:slug/modifications/merged': ['programme-ownership', 'attribution, then `claimsProgramme`'],
  'POST /api/coord/programmes/:slug/calls': ['programme-ownership', 'attribution, then `claimsProgramme`'],
  'POST /api/coord/programmes/:slug/remaining': ['programme-ownership', 'attribution, then `claimsProgramme` (measured; after the plan)'],
  'POST /api/leases/:lease/retain': ['lease-ownership', '`decideRetain` refuses `not-lease-parent`'],
  'POST /api/runs/:id/dispatch': ['launch-profile', 'box token only; the body carries no caller identity (residual, question 8)'],
  'POST /api/runs/:id/close': ['launch-profile', 'box token only; no caller identity (residual)'],
  'POST /api/runs/:id/advance': ['launch-profile', 'box token only; no caller identity (residual)'],
  'POST /api/runs/:id/route': ['launch-profile', 'box token only; no caller identity (residual)'],
  'POST /api/runs/:id/items': ['launch-profile', 'box token only; no caller identity (residual)'],
  'POST /api/ledger/deviations': ['launch-profile', 'an optional unattributed `byId`; a refusal by id is bypassed by leaving it out (residual)'],
  'POST /api/notify': ['launch-profile', 'ccd notify.sh on the fleet host, box token only, no caller identity'],
  'POST /api/testbox/tools-sync': ['launch-profile', 'no body, box token or a session; it sends the box only the fleet host\'s own versions'],
  'POST /api/token/claim': ['launch-profile', 'a single-use code sent over the agent link; no session holds one'],
  'POST /api/reader-lab/probe/:nonce/:name': ['launch-profile', 'a counter that never reads its body; no caller identity'],
  'POST /api/mail/:id/ack': ['stays-open', 'the Overlord acks its own deliveries: its timer mail reaches it as mail (question 5)'],
  'POST /api/linear/proxy/search': ['stays-open', 'a read sent as a POST (question 7)'],
  'POST /api/auth/login': ['operator-sign-in', 'the operator\'s sign-in door; no session identity rides it'],
  'POST /api/auth/passkey/assert/start': ['operator-sign-in', 'the operator\'s passkey door'],
  'POST /api/auth/passkey/assert/finish': ['operator-sign-in', 'the operator\'s passkey door'],
};

/** Every server source file that registers a route. */
const routeFiles = (): string[] => (readdirSync(path.join(REPO, 'server', 'src'), { recursive: true }) as string[])
  .filter((f) => f.endsWith('.ts')).map((f) => `server/src/${f.split(path.sep).join('/')}`)
  .filter((f) => registrationsIn(read(f)).length > 0).sort();
/** The auth gate's own table: a door it does not exempt is session-gated when sign-in is armed. */
const EXEMPT_KEYS: ReadonlySet<string> = new Set(EXEMPT.keys());
/** The child-only door (Table 2), read from the gate's approvals-lane entries, never spelled here (the coordinator's ruling,
 *  slug `approval-surface-refusals-reported`): the one write entry whose reason says a dispatched child's hook asks. */
const CHILD_ONLY: ReadonlySet<string> = new Set([...EXEMPT].filter(([k, why]) => !/^(GET|HEAD) /.test(k)
  && why.startsWith('a dispatched child\'s permission hook')).map(([k]) => k));
/** A handler that reads a caller's identity: attribution, or a uuid read off the request (a field name followed by `:` is
 *  an object key it writes, not a read). Comment lines are stripped first: a slice runs into the next route's docblock. */
const IDENTITY_READS = /requireAttribution\(|\.attribute\(|attributionVerdict\(|\b(?:byUuid|fromUuid|sessionUuid)\b(?!\s*:)/;
const codeOf = (body: string): string => body.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');

interface Placed { readonly key: string; readonly file: string; readonly cls: string }

/** Places every write door of the given sources, or names the ones it cannot place. Pure over its inputs, so a planted
 *  copy of a source can be read by it (the red checks below). */
function classify(sources: readonly { file: string; src: string }[], exempt: ReadonlySet<string> = EXEMPT_KEYS)
  : { placed: Placed[]; unplaced: string[] } {
  const table1 = new Set<string>(OTHER_LANE_KEYS.map((k) => OTHER_LANES[k].route));
  const hookGroup = new Set(lanesIn(CONTINUITY_SRC));
  const placed: Placed[] = []; const unplaced: string[] = [];
  for (const { file, src } of sources) {
    const starts = registrationsIn(src);
    starts.forEach(({ key, at }, i) => {
      if (/^(GET|HEAD) /.test(key)) return;
      const body = src.slice(at, starts[i + 1]?.at ?? src.length);
      const classes: string[] = [];
      if (table1.has(key)) classes.push('table-1');
      if (Object.hasOwn(NOT_REFUSED, key)) classes.push(NOT_REFUSED[key]![0]);
      if (file === 'server/src/continuity/routes.ts' && hookGroup.has(key)) classes.push('hook-group');
      // The child-only door (Table 2): refused `not-a-child` for any session with no child marker, which the Overlord's
      // body is. Read from the gate's table (`CHILD_ONLY`); its handler must be the one that raises an approval.
      if (CHILD_ONLY.has(key) && body.includes('raiseApproval(')) classes.push('child-only');
      // operator-gated: every door the auth gate does NOT exempt is session-gated when sign-in is armed, and the sign-in
      // is the operator's. No session identity may ride one: a door that reads one must be placed by hand.
      if (!exempt.has(key) && !IDENTITY_READS.test(codeOf(body)) && !table1.has(key)) classes.push('operator-gated');
      if (classes.length === 1) placed.push({ key, file, cls: classes[0]! });
      else unplaced.push(`${file} ${key}: ${classes.length === 0 ? 'no class' : classes.join(' and ')}`);
    });
  }
  return { placed, unplaced };
}

describe('7. every write door is classified', () => {
  const sources = routeFiles().map((file) => ({ file, src: read(file) }));

  it('reads the route files it should (a census over nothing cannot pass)', () => {
    const files = sources.map((s) => s.file);
    for (const f of ['server/src/coord/routes.ts', 'server/src/server.ts', 'server/src/coord/planRoutes.ts',
      'server/src/linear/proxyRoutes.ts', 'server/src/coord/ledgersRoutes.ts', 'server/src/continuity/routes.ts']) {
      expect(files).toContain(f);
    }
  });

  it('every write door is in exactly one class', () => {
    const { placed, unplaced } = classify(sources);
    expect(unplaced).toEqual([]);
    expect(placed.length).toBeGreaterThan(50);
    expect(new Set(placed.filter((p) => p.cls === 'child-only').map((p) => p.file))).toEqual(new Set(['server/src/coord/routes.ts']));
    expect(placed.filter((p) => p.cls === 'child-only')).toHaveLength(1);
    expect(CHILD_ONLY.size).toBe(1);
  });

  it('every Table 1 route and every NOT_REFUSED row names a registered write door (both directions)', () => {
    const registered = new Set(sources.flatMap(({ src }) => keysOf(src)));
    for (const lane of OTHER_LANE_KEYS) expect(registered, lane).toContain(OTHER_LANES[lane].route);
    for (const key of Object.keys(NOT_REFUSED)) expect(registered, key).toContain(key);
  });

  it('the hook group is the continuity file\'s box-token write lanes, as the box-token census computes them', () => {
    const hook = classify([{ file: 'server/src/continuity/routes.ts', src: CONTINUITY_SRC }]).placed
      .filter((p) => p.cls === 'hook-group').map((p) => p.key);
    expect(hook).toEqual(lanesIn(CONTINUITY_SRC).filter((k) => !/^(GET|HEAD) /.test(k)));
    expect(hook.length).toBeGreaterThan(0);
  });

  it('RED CHECK: a new box-token write door, and a new session-gated door that reads an identity, are unplaced', () => {
    const plantBox = `${COORD_SRC}\n  app.post('/api/zz/planted', async (req, reply) => { if (!requireMailToken(req, reply, 'x')) return; });\n`;
    const plantSession = `${COORD_SRC}\n  app.post('/api/zz/planted-two', async (req, reply) => { await requireAttribution(reply, a, b, 'byUuid'); });\n`;
    const others = sources.filter((s) => s.file !== 'server/src/coord/routes.ts');
    expect(classify([...others, { file: 'server/src/coord/routes.ts', src: plantBox }], new Set([...EXEMPT_KEYS, 'POST /api/zz/planted']))
      .unplaced.join('\n'))
      .toContain('POST /api/zz/planted');
    expect(classify([...others, { file: 'server/src/coord/routes.ts', src: plantSession }]).unplaced.join('\n'))
      .toContain('POST /api/zz/planted-two');
  });
});
