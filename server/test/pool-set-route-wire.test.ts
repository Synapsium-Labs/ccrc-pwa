// server/test/pool-set-route-wire.test.ts
//
// The Overlord W1 pool set, PR A1, Task 2, the server's half: the route fields `poolset` (the session's set, in
// `shared/poolset.ts`'s spelling) and `acctorder` (the Overlord's ordered account list) ride the existing route vocabulary
// (`ROUTE_WRITABLE_FIELDS`), last, so `parseRouteFields`, `CCD_ARGV.routeSet` and the registry's route read take them with
// no second list (`ccd-route-fields.test.ts` and `ccd-route-argv.test.ts` are ccd's half). Their writers are the
// designation's doors and the renewal lane, so every door refuses them (`ROUTE_LANE_ONLY_FIELDS`) while the lane's own
// write, `CCD_ARGV.routeSet`, passes no door. Nothing reads a set yet: this PR changes no placement.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { localIO } from '../src/io.js';
import { readSessionRecord, type SessionRecord } from '../src/registry.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { ROUTE_LANE_ONLY_FIELDS, ROUTE_READ_FIELDS, ROUTE_WRITABLE_FIELDS, parseRouteFields } from '../../shared/api.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'claude-overlord';
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-pool-set-wire-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'overlord', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});

const cfg = () => loadConfig({ CCRC_HOME: home });
const record = async (): Promise<SessionRecord> => {
  const r = await readSessionRecord(localIO, cfg(), ID);
  if (r.kind !== 'found') throw new Error(`fixture row not found: ${r.kind}`);
  return r.record;
};
const POOL = { poolset: 'pool-a,pool-b+untagged', acctorder: 'claude-a,claude-b' } as const;

describe('the pool set route fields on the server (W1, PR A1)', () => {
  it('are the last two writable fields, read fields too, and lane-only, which every door parse refuses by name', () => {
    expect(ROUTE_WRITABLE_FIELDS.slice(-2)).toStrictEqual(['poolset', 'acctorder']);
    expect(ROUTE_LANE_ONLY_FIELDS.slice(-2)).toStrictEqual(['poolset', 'acctorder']);
    for (const f of Object.keys(POOL)) expect(ROUTE_READ_FIELDS, f).toContain(f);
    expect(parseRouteFields({ poolset: POOL.poolset })).toStrictEqual({ ok: false, why: 'lane-only', field: 'poolset' });
    expect(parseRouteFields({ class: 'opus', acctorder: POOL.acctorder })).toStrictEqual({ ok: false, why: 'lane-only', field: 'acctorder' });
  });
  it('the lane stays open: routeSet composes both last, in list order, and an empty value (the clear) as `field=`', () => {
    expect([...CCD_ARGV.routeSet(ID, { acctorder: POOL.acctorder, class: 'opus', poolset: POOL.poolset })]).toStrictEqual(
      ['route', '--session', ID, '--set', 'class=opus', '--set', `poolset=${POOL.poolset}`, '--set', `acctorder=${POOL.acctorder}`]);
    expect([...CCD_ARGV.routeSet(ID, { poolset: '', acctorder: '' })]).toStrictEqual(
      ['route', '--session', ID, '--set', 'poolset=', '--set', 'acctorder=']);
  });
  it('the registry reads both back from a listing, with the rest of the record', async () => {
    for (const [f, v] of Object.entries(POOL)) writeFileSync(path.join(reg, `${ID}.${f}`), v);
    writeFileSync(path.join(reg, `${ID}.class`), 'opus');
    expect((await record()).route?.fields).toStrictEqual({ class: 'opus', ...POOL });
  });
});
