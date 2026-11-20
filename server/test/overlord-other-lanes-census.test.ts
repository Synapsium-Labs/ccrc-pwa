// The other write lanes' census (Overlord W1, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-other-lanes.md`
// Task 4; spec §3.5 C48, §3.8 H10, §15 A5). Every assertion reads the sources in both directions:
//   1-2. every `attribution` and `landing-write` lane passes its key, once, at its own door;
//   3.   no key sits at the wrong door, in any route file or a claimant lane's own file, and only the six files that
//        ask today call the decider or its sender;
//   4.   the mail ingress asks once, between check 6 and check 7;
//   5.   the Linear rows are exactly the proxy's write verbs, and the plan rows exactly the plan file's write doors;
//   6.   run open and reclaim ask once each, at their places in the order;
//   7.   every write door the server registers is in exactly one class (the plan's Table 2), so a new door is red until
//        it is placed.
// It slices handlers with the box-token census's slicer (`routeRegistrations.ts`, slug `route-slicer-shared`).
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OTHER_LANES, OTHER_LANE_KEYS, OVERLORD_PROFILE, linearLaneOf, type OtherLane, type OtherLaneVia,
} from '../src/coord/otherLanes.js';
import { OPEN_RUN_GATES } from '../src/coord/openRun.js';
import { EXEMPT } from '../src/auth/gate.js';
import { LINEAR_OPS } from '../src/linear/ops.js';
import { LINEAR_PROXY_ROUTES } from '../src/linear/proxyRoutes.js';
import {
  COORD_SRC, CONTINUITY_SRC, LEDGER_SRC, LINEAR_PROXY_SRC, PLAN_SRC, REPO, handlerBody, lanesIn, read, registrationsIn,
} from './routeRegistrations.js';

const OPEN_RUN_SRC = read('server/src/coord/openRun.ts');
const RECLAIM_SRC = read('server/src/coord/reclaim.ts');

/** Every server source file, repository-relative. */
const srcFiles = (): string[] => (readdirSync(path.join(REPO, 'server', 'src'), { recursive: true }) as string[])
  .filter((f) => f.endsWith('.ts')).map((f) => `server/src/${f.split(path.sep).join('/')}`).sort();
/** Every server source file that registers a route. */
const routeFiles = (): string[] => srcFiles().filter((f) => registrationsIn(read(f)).length > 0);
/** Comment lines stripped: a slice runs into the next route's docblock, and a comment is no call. */
const codeOf = (body: string): string => body.split('\n').filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');

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

/** Where a lane's key is quoted, among the given sources: `file xN` for each file that quotes it. A key belongs once in
 *  its own handler (attribution, ingress, landing and plan lanes), once in its claimant lane's own file (run open,
 *  reclaim), or nowhere (the Linear lanes: the proxy passes `linearLaneOf(verb)`'s result, assertion 5). */
function wrongDoors(lane: OtherLane, sources: Readonly<Record<string, string>>): string[] {
  const { route, via } = OTHER_LANES[lane];
  const quoted = `'${lane}'`;
  const hits = Object.entries(sources).filter(([, src]) => count(src, quoted) > 0);
  const where = hits.map(([f, src]) => `${f} x${count(src, quoted)}`);
  const home = via === 'open-run-gate' ? 'server/src/coord/openRun.ts' : via === 'reclaim-heir' ? 'server/src/coord/reclaim.ts'
    : via === 'linear-proxy' ? null : hits.find(([, src]) => keysOf(src).includes(route))?.[0] ?? '(no registrar)';
  const expected = home === null ? [] : [`${home} x1`];
  const misplaced = where.filter((w) => !expected.includes(w));
  if (home !== null && via !== 'open-run-gate' && via !== 'reclaim-heir' && Object.hasOwn(sources, home)
    && count(handlerBody(sources[home]!, route), quoted) !== 1) misplaced.push(`${home}: not once in ${route}'s handler`);
  if (home !== null && !where.includes(`${home} x1`)) misplaced.push(`${home}: missing`);
  return misplaced;
}

describe('3. no key at the wrong door', () => {
  /** Every route file (`server.ts` among them), plus the claimant lanes' own files, which register no route. */
  let memo: Record<string, string> | null = null;
  const scanned = (): Record<string, string> => memo ??= Object.fromEntries(
    [...new Set([...routeFiles(), 'server/src/coord/openRun.ts', 'server/src/coord/reclaim.ts'])].map((f) => [f, read(f)]));

  it('scans every route file, server.ts among them', () => {
    const files = Object.keys(scanned());
    for (const f of ['server/src/server.ts', 'server/src/coord/routes.ts', 'server/src/coord/ledgersRoutes.ts',
      'server/src/coord/planRoutes.ts', 'server/src/linear/proxyRoutes.ts', 'server/src/coord/openRun.ts',
      'server/src/coord/reclaim.ts']) expect(files).toContain(f);
  });

  it.each(OTHER_LANE_KEYS)('%s is quoted only where its lane asks', (lane) => {
    expect(wrongDoors(lane, scanned()), lane).toEqual([]);
  });

  it('every lane key quoted in those files is a row of the table', () => {
    for (const src of Object.values(scanned())) {
      for (const m of src.matchAll(/(?:requireAttribution\([^;]*?, |landingWrite\([^;]*?, )'([A-Za-z]+)'\)|(?:door\(|refuseOtherLane\(reply, |decideOtherLane\()'([A-Za-z]+)'/g)) {
        const key = m[1] ?? m[2]!;
        if (['byUuid', 'fromUuid', 'sessionUuid'].includes(key)) continue; // the uuid field, not a lane
        expect(OTHER_LANE_KEYS as string[], m[0]).toContain(key);
      }
    }
  });

  it('the files that call the decider or its sender are exactly the six that ask today', () => {
    const CALL = /(?<!function )\b(?:refuseOtherLane|decideOtherLane)\s*(?:<[^>()]*>)?\(/;
    expect(srcFiles().filter((f) => CALL.test(codeOf(read(f))))).toEqual([
      'server/src/coord/openRun.ts', 'server/src/coord/planRoutes.ts', 'server/src/coord/reclaim.ts',
      'server/src/coord/routes.ts', 'server/src/linear/proxyRoutes.ts', 'server/src/refuse.ts',
    ]);
  });

  it('RED CHECK: a key planted in server.ts ahead of the plan routes, and one at another door, are wrong doors', () => {
    const plantedServer = scanned()['server/src/server.ts']!.replace('registerPlanRoutes(',
      "await refuseOtherLane(reply, 'planMet', id, reads);\n  registerPlanRoutes(");
    expect(plantedServer).not.toBe(scanned()['server/src/server.ts']);
    expect(wrongDoors('planMet', { ...scanned(), 'server/src/server.ts': plantedServer }))
      .toContain('server/src/server.ts x1');
    const plantedOpen = `${scanned()['server/src/coord/openRun.ts']!}\nconst x = decideOtherLane('runReclaim', id, reads);\n`;
    expect(wrongDoors('runReclaim', { ...scanned(), 'server/src/coord/openRun.ts': plantedOpen }))
      .toContain('server/src/coord/openRun.ts x1');
    const plantedLinear = scanned()['server/src/linear/proxyRoutes.ts']!.replace('linearLaneOf(verb)', "'linearCreate' as const");
    expect(wrongDoors('linearCreate', { ...scanned(), 'server/src/linear/proxyRoutes.ts': plantedLinear }))
      .toContain('server/src/linear/proxyRoutes.ts x1');
  });

  it('the designate door writes the profile word the decider refuses (one word, two sides)', () => {
    const src = read('server/src/coord/overlordRoutes.ts');
    const words = [...src.matchAll(/\bprofile: (?:'([a-z-]+)'|(OVERLORD_PROFILE)\b)/g)].map((m) => m[1] ?? OVERLORD_PROFILE);
    expect(words, 'the route the designate door creates the body with').toEqual([OVERLORD_PROFILE]);
    expect(src).toMatch(new RegExp(`launchDigestOf\\((?:'${OVERLORD_PROFILE}'|OVERLORD_PROFILE)\\)`));
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
    // The lane it passes is linearLaneOf's result, never a literal (assertion 3 also finds no Linear key quoted there).
    expect(count(handle, 'const lane = linearLaneOf(verb);')).toBe(1);
    expect(count(handle, 'refuseOtherLane(reply, lane, ')).toBe(1);
    expect(before(handle, 'deps.attribute(', 'refuseOtherLane(')).toBe(true);
    expect(before(handle, 'refuseOtherLane(', 'validateLinearCall(')).toBe(true);
  });

  it('the plan-door rows are exactly the write doors planRoutes.ts registers, each its own key through door', () => {
    const writes = keysOf(PLAN_SRC).filter((k) => !/^(GET|HEAD) /.test(k)).sort();
    expect(writes).toEqual(rowsVia('plan-door').map((k) => OTHER_LANES[k].route).sort());
    // A programme door goes through `door`; the Linear hierarchy's team-keyed triage door (wave 4, #2982) through `teamDoor`,
    // which asks the same check (below). Either way: one door, with its own lane key.
    for (const lane of rowsVia('plan-door')) {
      const body = handlerBody(PLAN_SRC, OTHER_LANES[lane].route);
      expect(count(body, 'door(') + count(body, 'teamDoor('), lane).toBe(1);
      expect(count(body, `door('${lane}', `) + count(body, `teamDoor('${lane}', `), lane).toBe(1);
    }
  });

  it('door asks refuseOtherLane once, after attribution, before the reserved programme, the store read and serial', () => {
    const door = between(PLAN_SRC, 'const door = (lane: OtherLane, work: Work)', 'const teamDoor');
    expect(count(door, 'refuseOtherLane(reply, lane, id, opts.otherLaneReads)')).toBe(1);
    expect(before(door, 'callerOf(req, reply)', 'refuseOtherLane(')).toBe(true);
    expect(before(door, 'refuseOtherLane(', 'LINEAR_SYNC_PROGRAMME')).toBe(true);
    expect(before(door, 'refuseOtherLane(', 'await workspaces(')).toBe(true);
    expect(before(door, 'refuseOtherLane(', 'opts.serial(')).toBe(true);
  });

  it('callerOf, which door and teamDoor attribute through, asks opts.attribute once', () => {
    const callerOf = between(PLAN_SRC, 'const callerOf = async (', 'const door = (lane: OtherLane, work: Work)');
    expect(count(callerOf, 'await opts.attribute(')).toBe(1);
  });

  it('teamDoor asks refuseOtherLane once, after attribution, before the store reads and serial', () => {
    const teamDoor = between(PLAN_SRC, 'const teamDoor = (lane: OtherLane, work: TeamWork)', 'const ownerVerdict');
    expect(count(teamDoor, 'refuseOtherLane(reply, lane, id, opts.otherLaneReads)')).toBe(1);
    expect(before(teamDoor, 'callerOf(req, reply)', 'refuseOtherLane(')).toBe(true);
    expect(before(teamDoor, 'refuseOtherLane(', 'plan.planOf(')).toBe(true);
    expect(before(teamDoor, 'refuseOtherLane(', 'plan.hierarchyProjectsOf(')).toBe(true);
    expect(before(teamDoor, 'refuseOtherLane(', 'await workspaces(')).toBe(true);
    expect(before(teamDoor, 'refuseOtherLane(', 'opts.serial(')).toBe(true);
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
  | 'operator-sign-in' | 'overlord-door';

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
  'POST /api/continuity/quiz-runs': ['launch-profile', 'box token only, from the operator\'s `ccrc quiz-record` through `ccrc-api`; a session holding the token could post a pending run, but only the operator\'s session-gated Confirm makes it count'],
  'POST /api/mail/:id/ack': ['stays-open', 'the Overlord acks its own deliveries: its timer mail reaches it as mail (question 5)'],
  'POST /api/linear/proxy/search': ['stays-open', 'a read sent as a POST (question 7)'],
  'POST /api/linking/suggest': ['stays-open', 'a box-token write lane, attribution-checked, that the Overlord uses too: below the full rung it suggests a team instead of linking (D-8808, spec §3.1 step 5); it stores the caller\'s own suggestion only'],
  'POST /api/linking/confirm': ['overlord-door', 'an Overlord door (`link-team` in `OVERLORD_DOORS`, class `other`, others refused): it runs the Overlord gate, which refuses every caller that is not the designated Overlord and allows the act at `full` only (D-8809)'],
  'POST /api/auth/login': ['operator-sign-in', 'the operator\'s sign-in door; no session identity rides it'],
  'POST /api/auth/passkey/assert/start': ['operator-sign-in', 'the operator\'s passkey door'],
  'POST /api/auth/passkey/assert/finish': ['operator-sign-in', 'the operator\'s passkey door'],
};

/** The auth gate's own table: a door it does not exempt is session-gated when sign-in is armed. */
const EXEMPT_KEYS: ReadonlySet<string> = new Set(EXEMPT.keys());
/** The child-only door (Table 2), read from the gate's approvals-lane entries, never spelled here (the coordinator's ruling,
 *  slug `approval-surface-refusals-reported`): the one write entry whose reason says a dispatched child's hook asks. */
const CHILD_ONLY: ReadonlySet<string> = new Set([...EXEMPT].filter(([k, why]) => !/^(GET|HEAD) /.test(k)
  && why.startsWith('a dispatched child\'s permission hook')).map(([k]) => k));
/** A handler that reads a caller's identity: attribution, or a uuid read off the request (a field name followed by `:` is
 *  an object key it writes, not a read). Comment lines are stripped first: a slice runs into the next route's docblock. */
const IDENTITY_READS = /requireAttribution\(|\.attribute\(|attributionVerdict\(|\b(?:byUuid|fromUuid|sessionUuid)\b(?!\s*:)/;

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
