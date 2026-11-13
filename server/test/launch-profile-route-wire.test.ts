// server/test/launch-profile-route-wire.test.ts
//
// Overlord W1a launch profiles, Task 3, the server's half: the route fields `profile`, `automem` and `compactwindow`
// ride the existing route vocabulary (`ROUTE_WRITABLE_FIELDS`), so `parseRouteFields`, `CCD_ARGV.routeSet`, the
// registry's route read and the fleet frame's revival take them with no second list (`ccd-launch-profile.test.ts` is
// ccd's half). Nothing in PR A writes them: PR B's lane is their one writer. So every door refuses them
// (`ROUTE_LANE_ONLY_FIELDS`, through `parseRouteFields`; each door's 400 is pinned in its own suite:
// `sessions-route-route`, `sessions-route-body`, `dispatch-route`, `run-route-route`, `route-decide`), while the lane's
// own write, `CCD_ARGV.routeSet`, passes no door and stays open.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { readSessionRecord, type SessionRecord } from '../src/registry.js';
import { assembleFleet } from '../src/fleet.js';
import { liveStateReaderOver } from '../src/livestate.js';
import { Tmux, type Runner } from '../src/exec.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { ROUTE_LANE_ONLY_FIELDS, ROUTE_READ_FIELDS, ROUTE_WRITABLE_FIELDS, parseRouteFields, reviveFleetSession } from '../../shared/api.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-launch-profile-wire-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'project-a', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});

const cfg = () => loadConfig({ CCRC_HOME: home });
const field = (f: string, v: string): void => writeFileSync(path.join(reg, `${ID}.${f}`), v);
const record = async (): Promise<SessionRecord> => {
  const r = await readSessionRecord(localIO, cfg(), ID);
  if (r.kind !== 'found') throw new Error(`fixture row not found: ${r.kind}`);
  return r.record;
};
const LAUNCH = { profile: 'coordinator', automem: 'off', compactwindow: '350000' } as const;

describe('the launch profile route fields on the server (H1)', () => {
  it('are writable route fields, last, and so read fields too; the lane-only ones, which the door parse refuses', () => {
    expect(ROUTE_WRITABLE_FIELDS.slice(-3)).toStrictEqual(Object.keys(LAUNCH));
    expect(ROUTE_LANE_ONLY_FIELDS).toStrictEqual(Object.keys(LAUNCH));
    for (const f of Object.keys(LAUNCH)) expect(ROUTE_READ_FIELDS, f).toContain(f);
    expect(parseRouteFields({ ...LAUNCH })).toStrictEqual({ ok: false, why: 'lane-only', field: 'profile' });
    expect(parseRouteFields({ class: 'opus', compactwindow: '350000' })).toStrictEqual({ ok: false, why: 'lane-only', field: 'compactwindow' });
  });
  it('the lane stays open: routeSet builds one `route` argv with the three pairs, in list order, past no door', () => {
    expect([...CCD_ARGV.routeSet(ID, { compactwindow: '350000', profile: 'coordinator', automem: 'off' })])
      .toStrictEqual(['route', '--session', ID, '--set', 'profile=coordinator', '--set', 'automem=off', '--set', 'compactwindow=350000']);
  });
  it('the registry reads them back with the rest of the record', async () => {
    for (const [f, v] of Object.entries(LAUNCH)) field(f, v);
    expect((await record()).route?.fields).toStrictEqual({ ...LAUNCH });
  });
  it('the fleet frame carries them, and a cached frame naming them revives', async () => {
    for (const [f, v] of Object.entries(LAUNCH)) field(f, v);
    const noopRun: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const s = (await assembleFleet(localIO, cfg(), new Tmux(noopRun), liveStateReaderOver(localIO), 1784600000)).find((x) => x.id === ID)!;
    expect(s.route?.fields).toStrictEqual({ ...LAUNCH });
    expect(reviveFleetSession(JSON.parse(JSON.stringify(s)))?.route?.fields).toStrictEqual({ ...LAUNCH });
  });
});
