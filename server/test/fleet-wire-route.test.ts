// Routing slice 6, Task 4 — `FleetSession.route` rides the fleet wire beside
// the live read-back. Two halves: `reviveFleetSession`'s persistence
// contract (additive, absence-permits — S6-R4/constraints.md), and
// `assembleFleet`'s production read off the registry's seven routing files
// (`server/src/registry.ts`'s `buildRecord`, the census this task raised
// from 23 to 30 [registry-read-census:fields] — see registry.test.ts's own
// census suite for that half).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { reviveFleetSession, type FleetSession } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';

const session = (id: string): FleetSession => ({
  id, wrapper: 'claude', home: '/home/rc', project: id, workdir: `/data/projects/${id}`,
  workspace: null, name: null, status: 'idle', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, ctxPct: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null,
  unmeasured: [], statusUnmeasured: false, lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null,
  started: true, spawnState: null, ask: null, usage: null, route: null,
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

  it('revives a full route object — fields present, degraded, inert', () => {
    const base = session('demo-a');
    const route = { fields: { class: 'opus', effort: 'high' }, degraded: 'ceiling', inert: ['effort'] };
    expect(reviveFleetSession({ ...base, route })?.route).toEqual(route);
  });

  it('revives fields absent, degraded null, inert empty', () => {
    const base = session('demo-a');
    const route = { fields: {}, degraded: null, inert: [] };
    expect(reviveFleetSession({ ...base, route })?.route).toEqual(route);
  });

  it('rejects the WHOLE session when route.fields names a field outside ROUTE_WRITABLE_FIELDS', () => {
    const base = session('demo-a');
    const route = { fields: { degraded: 'x' }, degraded: null, inert: [] };
    expect(reviveFleetSession({ ...base, route })).toBeNull();
  });

  it('rejects the WHOLE session when a route.fields value is not a string', () => {
    const base = session('demo-a');
    const route = { fields: { class: 7 }, degraded: null, inert: [] };
    expect(reviveFleetSession({ ...base, route })).toBeNull();
  });

  it('rejects the WHOLE session when route.inert carries a word outside ROUTE_WRITABLE_FIELDS', () => {
    const base = session('demo-a');
    const route = { fields: {}, degraded: null, inert: ['degraded'] };
    expect(reviveFleetSession({ ...base, route })).toBeNull();
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
    });
  });

  it('drops an inert word outside ROUTE_WRITABLE_FIELDS rather than laundering it onto the wire', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', { inert: 'effort,not-a-field' });
    const now = 1784600000;
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).toEqual({ fields: {}, degraded: null, inert: ['effort'] });
  });

  it('a session with ONLY a .degraded file (no class/effort/etc, no .inert) still answers route non-null', async () => {
    const home = mkTmp('ccrc-');
    seedRoster(home);
    seedSession(home, 'claude-quiet-basin', 'claude', { degraded: 'floor' });
    const now = 1784600000;
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(noopRun), now);
    const s = fleet.find((r) => r.id === 'claude-quiet-basin');
    expect(s?.route).toEqual({ fields: {}, degraded: 'floor', inert: [] });
  });
});
