// D-8382 (#1442): `GET /api/fleet/overrides`, Settings › Automation › Overrides in force and Settings › Security's
// approvals line. The rows are the switchboard's own (`overrideSwitchNames`), each with what the fleet host says of it:
// a registry marker through the one registry reading (`readSwitches`), a `~/.ccrc` file through one `statMeasured` of
// it, each where it lives. The approvals topology is the server box's own, from the function the ruling gate decides by.
// Fixture HOMEs only.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { FleetIO } from '../src/io.js';
import { approvalsTopologyOf, rulingsAllowedHere, APPROVALS_SINGLE_BOX_FILE } from '../src/coord/approvalsign.js';
import { readCcrcFileSwitches } from '../src/overridesRead.js';
import {
  AUTOCOMPACT_DISABLED_MARKER, CCRC_SWITCH_FILES, GRAPH_GATE_OFF_FILE, MAIL_DISABLED_MARKER, SWITCHES, ccrcFileSwitchNames,
  markerSwitchNames, overrideSwitchNames, overridesOf, readSwitches, switchPath, type SwitchName,
} from '../../shared/switches.js';
import { approvalsTopologyLine, overridesInForce, type OverridesView } from '../../shared/overrides.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const apps: FastifyInstance[] = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

const URL = '/api/fleet/overrides';
const serve = async (deps: Deps): Promise<FastifyInstance> => {
  const app = await buildServer(deps);
  apps.push(app);
  return app;
};
const read = async (app: FastifyInstance): Promise<OverridesView & { ok: boolean }> => {
  const res = await app.inject({ method: 'GET', url: URL });
  expect(res.statusCode).toBe(200);
  return res.json();
};

describe('the overrides are the switchboard\'s rows (D-8382)', () => {
  it('every override is a SWITCHES row a person places by hand, as a registry marker or a ~/.ccrc file, in SWITCHES order', () => {
    expect(overrideSwitchNames.length, 'CONTROL: the switchboard has overrides').toBeGreaterThan(10);
    const keys = Object.keys(SWITCHES) as SwitchName[];
    const expected = keys.filter((k) => SWITCHES[k].writer === 'hand-only' && !('setting' in SWITCHES[k].storage));
    expect(overrideSwitchNames).toEqual(expected);
    // A switch with a writer has its control elsewhere, and a setting row is no file: neither is an override.
    expect(overrideSwitchNames).not.toContain('coordinator-paused');
    expect(overrideSwitchNames).not.toContain('stall-watch-level');
  });

  it('the four markers this change registers carry their location and owner', () => {
    expect(SWITCHES[AUTOCOMPACT_DISABLED_MARKER].storage).toEqual({ marker: 'autocompact-disabled' });
    expect(SWITCHES[AUTOCOMPACT_DISABLED_MARKER].owner).toBe('C3');
    for (const [f, owner] of [['graph-gate-off', 'C3'], ['ccrc-card-off', 'C5'], ['compact-card-off', 'C3']] as const) {
      expect(SWITCHES[f].storage).toEqual({ ccrcFile: f });
      expect(SWITCHES[f].owner).toBe(owner);
      expect(SWITCHES[f].writer).toBe('hand-only');
      expect(SWITCHES[f].default).toMatch(/^absent: /);
    }
    expect(ccrcFileSwitchNames).toEqual(['graph-gate-off', 'ccrc-card-off', 'compact-card-off']);
    expect(CCRC_SWITCH_FILES).toEqual(['graph-gate-off', 'ccrc-card-off', 'compact-card-off']);
    // A ~/.ccrc file is never read off a registry listing.
    expect(markerSwitchNames as readonly string[]).not.toContain(GRAPH_GATE_OFF_FILE);
    expect(markerSwitchNames as readonly string[]).toContain(AUTOCOMPACT_DISABLED_MARKER);
    expect(switchPath(AUTOCOMPACT_DISABLED_MARKER)).toBe('~/.cc-sessions/autocompact-disabled');
    expect(switchPath(GRAPH_GATE_OFF_FILE)).toBe('~/.ccrc/graph-gate-off');
  });

  it('overridesOf keeps each reading\'s own state, never a verdict', () => {
    const files = { 'graph-gate-off': 'set', 'ccrc-card-off': 'unmeasurable', 'compact-card-off': 'clear' } as const;
    const rows = overridesOf(readSwitches(null), files);
    expect(rows.map((r) => r.name)).toEqual(overrideSwitchNames);
    for (const r of rows) {
      const want = r.name in files ? files[r.name as keyof typeof files] : 'unmeasurable';
      expect(r.state, r.name).toBe(want);
    }
    expect(overridesInForce(rows)).toEqual({ set: ['graph-gate-off'], unmeasured: overrideSwitchNames.length - 2 });
  });
});

describe('GET /api/fleet/overrides (D-8382)', () => {
  it('names each override that stands, a registry marker and a ~/.ccrc file alike; every other one reads clear', async () => {
    const home = mkTmp('ccrc-overrides-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', AUTOCOMPACT_DISABLED_MARKER), '');
    writeFileSync(path.join(home, '.cc-sessions', MAIL_DISABLED_MARKER), '');
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', GRAPH_GATE_OFF_FILE), '');
    const body = await read(await serve(testDeps(home)));
    expect(body.ok).toBe(true);
    expect(body.overrides.map((r) => r.name)).toEqual(overrideSwitchNames);
    expect(overridesInForce(body.overrides)).toEqual({
      set: overrideSwitchNames.filter((n) => [MAIL_DISABLED_MARKER, AUTOCOMPACT_DISABLED_MARKER, GRAPH_GATE_OFF_FILE].includes(n)),
      unmeasured: 0,
    });
  });

  it('an unlistable registry reads every registry row unmeasurable, never clear; the ~/.ccrc rows are still read', async () => {
    const home = mkTmp('ccrc-overrides-');
    const base = testDeps(home);
    const io: FleetIO = { ...base.io, readdirMeasured: async () => ({ ok: false, reason: 'unreadable' }) };
    const body = await read(await serve({ ...base, io }));
    for (const r of body.overrides) {
      expect(r.state, r.name).toBe((CCRC_SWITCH_FILES as readonly string[]).includes(r.name) ? 'clear' : 'unmeasurable');
    }
  });

  it('a ~/.ccrc file is asked where it lives, through the fleet io: an unreadable answer is unmeasurable, never clear', async () => {
    const base = testDeps(mkTmp('ccrc-overrides-'));
    const asked: string[] = [];
    const io: FleetIO = {
      ...base.io,
      statMeasured: async (p) => {
        asked.push(p);
        return p.endsWith(GRAPH_GATE_OFF_FILE) ? { ok: true, mtimeMs: 1, size: 0 } : { ok: false, reason: 'unreadable' };
      },
    };
    const files = await readCcrcFileSwitches(io, base.cfg.ccrcDir);
    expect(files).toEqual({ 'graph-gate-off': 'set', 'ccrc-card-off': 'unmeasurable', 'compact-card-off': 'unmeasurable' });
    expect(asked.sort()).toEqual(CCRC_SWITCH_FILES.map((f) => path.join(base.cfg.ccrcDir, f)).sort());
  });

  it('says the approvals topology: one box without the opt-in, one box with it, two boxes whatever the file says', async () => {
    const home = mkTmp('ccrc-overrides-');
    const deps = testDeps(home);
    let a = (await read(await serve(deps))).approvals;
    expect(a).toEqual({ boxes: 'one', marker: 'absent', file: APPROVALS_SINGLE_BOX_FILE });
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', APPROVALS_SINGLE_BOX_FILE), '');
    a = (await read(await serve(deps))).approvals;
    expect(a).toEqual({ boxes: 'one', marker: 'present', file: APPROVALS_SINGLE_BOX_FILE });
    const remote = loadConfig({ CCRC_HOME: home, CCRC_FLEET: 'remote', CCRC_ROLE: 'server' });
    a = (await read(await serve({ ...deps, cfg: remote }))).approvals;
    expect(a).toEqual({ boxes: 'two', marker: 'present', file: APPROVALS_SINGLE_BOX_FILE });
    expect(approvalsTopologyLine(a)).toContain('changes nothing on two boxes');
  });

  it('the topology agrees with the ruling gate for every role, mode and file', () => {
    for (const present of [false, true]) {
      const dir = mkTmp('ccrc-overrides-topo-');
      if (present) writeFileSync(path.join(dir, APPROVALS_SINGLE_BOX_FILE), '');
      for (const role of ['server', 'fleet', 'both'] as const) {
        for (const mode of ['local', 'remote'] as const) {
          const t = approvalsTopologyOf(role, mode, dir);
          expect(t.rulings, `${role} ${mode} ${present}`).toBe(rulingsAllowedHere(role, mode, dir));
          expect(t.marker).toBe(present ? 'present' : 'absent');
        }
      }
    }
  });
});
