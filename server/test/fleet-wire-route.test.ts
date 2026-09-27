// Routing slice 6, Task 4 — `FleetSession.route` rides the fleet wire beside
// the live read-back. Two halves: `reviveFleetSession`'s persistence
// contract (additive, absence-permits — S6-R4/constraints.md), and
// `assembleFleet`'s production read off the registry's seven routing files
// (`server/src/registry.ts`'s `buildRecord`, whose census this task raised
// from twenty-three reads to thirty; later waves raised it again, and today it
// is 31 [registry-read-census:fields] — see registry.test.ts's own census
// suite for that half).
//
// Fix round 2, finding 1 (controller ruling S6-R5): the seven reads are now
// MEASURED (`fieldMeasured`, not the collapsing `field()`), so `route` is
// `null` ONLY when all seven measure ABSENT, and an UNREADABLE field is
// named in `route.unreadable` rather than folded into "never routed" or
// "never set". `degradedReadIO`/`unreadableField` below (`ioDoubles.ts`)
// model that failure the same way every other migrated registry field's
// suite does.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { reviveFleetSession, ROUTE_READ_FIELDS, ROUTE_WRITABLE_FIELDS, type FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { degradedReadIO, unreadableField } from './ioDoubles.js';

const session = (id: string): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
  workspace: null, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, boardProject: null, route: null, child: { kind: 'none' },
});

const seedSession = (home: string, id: string, wrapper: string, extra: Record<string, string> = {}) => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1', ...extra };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const noopRun: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

describe('reviveFleetSession — route (routing slice 6, Task 4)', () => {
  it('an older snapshot, predating this task, revives route: null — ADDITIVE, absence-permits', () => {
    const base = JSON.parse(JSON.stringify(session('demo-a'))) as Record<string, unknown>;
    delete base['route'];
    expect(reviveFleetSession(base)?.route).toBeNull();
  });

  it('revives a full route object — fields present, degraded, inert, unreadable', () => {
    const base = session('demo-a');
    const route = {
      fields: { class: 'opus', effort: 'high' }, degraded: 'ceiling', inert: ['effort'], unreadable: ['subagent'],
    };
    expect(reviveFleetSession({ ...base, route })?.route).toEqual(route);
  });

  it('revives fields absent, degraded null, inert empty, unreadable empty', () => {
    const base = session('demo-a');
    const route = { fields: {}, degraded: null, inert: [], unreadable: [] };
    expect(reviveFleetSession({ ...base, route })?.route).toEqual(route);
  });

  it('fix round 2, finding 1: an older route object with no `unreadable` key at all revives it as [] — optional on the wire', () => {
    const base = session('demo-a');
    const route: Record<string, unknown> = { fields: { effort: 'high' }, degraded: null, inert: [] };
    expect('unreadable' in route).toBe(false);
    expect(reviveFleetSession({ ...base, route })?.route).toEqual({ ...route, unreadable: [] });
  });

  it('rejects the WHOLE session when route.fields names a field outside ROUTE_WRITABLE_FIELDS', () => {
    const base = session('demo-a');
    const route = { fields: { degraded: 'x' }, degraded: null, inert: [], unreadable: [] };
    expect(reviveFleetSession({ ...base, route })).toBeNull();
  });

  it('rejects the WHOLE session when a route.fields value is not a string', () => {
    const base = session('demo-a');
    const route = { fields: { class: 7 }, degraded: null, inert: [], unreadable: [] };
    expect(reviveFleetSession({ ...base, route })).toBeNull();
  });

  it('rejects the WHOLE session when route.inert carries a word outside ROUTE_WRITABLE_FIELDS', () => {
    const base = session('demo-a');
    const route = { fields: {}, degraded: null, inert: ['degraded'], unreadable: [] };
    expect(reviveFleetSession({ ...base, route })).toBeNull();
  });

  it('rejects the WHOLE session when route.unreadable is present but not an array', () => {
    const base = session('demo-a');
    const route = { fields: {}, degraded: null, inert: [], unreadable: 'effort' };
    expect(reviveFleetSession({ ...base, route })).toBeNull();
  });

  it('rejects the WHOLE session when route.unreadable carries a word outside ROUTE_READ_FIELDS', () => {
    const base = session('demo-a');
    const route = { fields: {}, degraded: null, inert: [], unreadable: ['not-a-field'] };
    expect(reviveFleetSession({ ...base, route })).toBeNull();
  });

  it('accepts every ROUTE_WRITABLE_FIELDS member plus degraded/inert in route.unreadable', () => {
    const base = session('demo-a');
    const unreadable = [...ROUTE_WRITABLE_FIELDS, 'degraded', 'inert'];
    const route = { fields: {}, degraded: null, inert: [], unreadable };
    expect(reviveFleetSession({ ...base, route })?.route).toEqual(route);
  });
});

describe('assembleFleet — route (routing slice 6, Task 4)', () => {
  it('answers route: null for a session with none of the seven routing files', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude');
    const now = 1784600000;
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    expect(fleet.find((s) => s.id === 'claude-quiet-basin')?.route).toBeNull();
  });

  it('answers the fields present, degraded and inert as written — absent fields absent', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', {
      class: 'opus', effort: 'high', degraded: 'ceiling', inert: 'effort,workflow',
    });
    const now = 1784600000;
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).toEqual({
      fields: { class: 'opus', effort: 'high' },
      degraded: 'ceiling',
      inert: ['effort', 'workflow'],
      unreadable: [],
    });
  });

  it('drops an inert word outside ROUTE_WRITABLE_FIELDS rather than laundering it onto the wire', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', { inert: 'effort,not-a-field' });
    const now = 1784600000;
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).toEqual({ fields: {}, degraded: null, inert: ['effort'], unreadable: [] });
  });

  it('a session with ONLY a .degraded file (no class/effort/etc, no .inert) still answers route non-null', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', { degraded: 'floor' });
    const now = 1784600000;
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).toEqual({ fields: {}, degraded: 'floor', inert: [], unreadable: [] });
  });

  // Controller ruling S6-R5 (fix round 2, finding 1): promote the seven
  // reads to the MEASURED ladder — `route: null` only when all seven measure
  // ABSENT, never when one merely fails to read. Whole-branch review,
  // finding #1: "measured unreadable" is resolved against the registry
  // LISTING first, exactly as `branchEvidence`/`held`/`substrate` already
  // are (registry.test.ts's "THE GOVERNING RULE" suite) — so every fixture
  // below SEEDS the file it degrades, which is what makes it listed and
  // therefore genuinely unreadable rather than evidenced-absent.
  it('all seven LISTED files measured unreadable (a transient agent-link failure): route is non-null, all seven named in unreadable, never route: null', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', {
      class: 'opus', effort: 'high', subagent: 'sonnet', workflow: 'sonnet',
      compact: '80', degraded: 'ceiling', inert: 'effort',
    });
    const now = 1784600000;
    const cfg = loadConfig({ CCRC_HOME: home });
    const io = degradedReadIO((p) => /\.(class|effort|subagent|workflow|compact|degraded|inert)$/.test(p));
    const fleet = await assembleFleet(io, cfg, new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).not.toBeNull();
    expect(s?.route).toEqual({
      fields: {},
      degraded: null,
      inert: [],
      unreadable: ['class', 'effort', 'subagent', 'workflow', 'compact', 'degraded', 'inert'],
    });
  });

  it('.class readable, a LISTED .effort measured unreadable: fields.class present, unreadable names only effort, no silent "never set"', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', { class: 'opus', effort: 'high' });
    const now = 1784600000;
    const io = unreadableField('claude-quiet-basin', 'effort');
    const fleet = await assembleFleet(io, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).toEqual({ fields: { class: 'opus' }, degraded: null, inert: [], unreadable: ['effort'] });
  });

  it('a LISTED .effort measured unreadable while every other one of the seven measures absent: still route non-null, not route: null', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', { effort: 'high' });
    const now = 1784600000;
    const io = unreadableField('claude-quiet-basin', 'effort');
    const fleet = await assembleFleet(io, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).not.toBeNull();
    expect(s?.route).toEqual({ fields: {}, degraded: null, inert: [], unreadable: ['effort'] });
  });

  // Whole-branch review, finding #1 — THE LISTING RUNG, per field. The
  // shape registry.test.ts states as the governing rule for every other
  // migrated field ("a NOT-LISTED .branch, measured unreadable, keeps
  // today's answer: absent"): the file was never written, so `names` never
  // names it, while the double still forces `unreadable`. The listing
  // settles it — measured ABSENT, not unmeasured — so a session ccd has
  // never routed keeps answering `route: null` even on an agent whose read
  // response carries no `absent` marker at all.
  for (const f of ROUTE_READ_FIELDS) {
    it(`a NOT-LISTED .${f}, measured unreadable, keeps today's answer: absent — route stays null`, async () => {
      const home = mkTmp('ccrc-');
      seedRoster(home);
      seedSession(home, 'claude-quiet-basin', 'claude');
      const now = 1784600000;
      const io = unreadableField('claude-quiet-basin', f);
      const fleet = await assembleFleet(io, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
      const s = fleet.find((r) => r.id === 'claude-quiet-basin');
      expect(s?.route).toBeNull();
    });
  }

  it('an OLD-AGENT-shaped io (every read unreadable, no `absent` marker) leaves a never-routed session at route: null', async () => {
    // The compatibility case the rung exists for: `remote/io.ts`'s `absent`
    // is the only proof of absence on that wire, so an agent predating it
    // (or rolled back to one) answers `unreadable` for every missing file.
    // Before the rung all seven names landed in `unreadable`, `route` went
    // non-null, and the PWA — which reads a named-unreadable field as
    // UNKNOWN — dropped the class/effort highlight on every never-routed
    // session on the fleet, permanently.
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude');
    const now = 1784600000;
    const io = degradedReadIO(() => true);
    const fleet = await assembleFleet(io, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).toBeNull();
  });

  it('mixes the two rungs in ONE record: a LISTED .class unreadable is named, a NOT-LISTED .effort unreadable is not', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', { class: 'opus' }); // .effort never written
    const now = 1784600000;
    const io = degradedReadIO((p) => /\.(class|effort)$/.test(p));
    const fleet = await assembleFleet(io, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).toEqual({ fields: {}, degraded: null, inert: [], unreadable: ['class'] });
  });
});
