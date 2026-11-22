// The `mailhold` route field in ccd (mid-turn mail plan 2026-11-19, Task 3.2; spec §3.3): a lane-only field, written by
// the projection lane through `ccd route --session`, whose grammar is `shared/mailHold.ts`'s. Fixture HOMEs only; every
// bash spawn goes through the three poisons (`ghContainedEnv` with systemd and tmux), as `ccd-workspaces.test.ts` requires.
// The mint verbs' refusal of `--route mailhold=…` is pinned beside the pool set's in `ccd-route-argv.test.ts`, and the
// grammar's parity with `parseMailHold` in `mailhold-parity.test.ts`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSyncGroup } from './spawnGroup.js';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';
import { MAILHOLD_LEASE_S, MAILHOLD_REACH_S } from '../../shared/mailHold.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-mailhold-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-a';
const seed = (): void => { h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`); };
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', `${ID}.${f}`);
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const nowS = (): number => Math.floor(Date.now() / 1000);

/** `cmd_route`, observed through its exit status (it refuses through `die`): `ccd-route-fields.test.ts`'s shape. */
const route = (args: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  const r = spawnSyncGroup('bash', ['-c', `source "${CCD}"; exec 2>&1; cmd_route ${args}`],
    { encoding: 'utf8', cwd: h.home, timeout: 60_000, killSignal: 'SIGKILL',
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }) });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

describe('ccd route --set mailhold=… (Task 3.2)', () => {
  it('writes the marker, with one journal row and one swap.log line', () => {
    seed();
    const v = `${nowS() + MAILHOLD_LEASE_S}:coordinator.7`;
    const r = route(`--session ${ID} --set mailhold=${v}`);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`set ${ID} mailhold=${v}`);
    expect(h.reg(ID, 'mailhold')).toBe(v);
    const rows = eventsOf(h.home, 'route');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).toContain(`mailhold: ∅ -> ${v}`);
    expect(swapLog()).toContain(`route ${ID}: mailhold ∅ -> ${v}`);
  });

  it('the empty value removes it, past the grammar (the empty-value clear)', () => {
    seed();
    h.sh(`_reg_set ${ID} mailhold ${nowS() + 60}:overlord.3`);
    const r = route(`--session ${ID} --set mailhold=`);
    expect(r.status, r.out).toBe(0);
    expect(fs.existsSync(regFile('mailhold'))).toBe(false);
    expect(swapLog()).toMatch(new RegExp(`route ${ID}: mailhold \\d+:overlord\\.3 -> ∅`));
  });

  it.each([
    ['an unknown role', 'worker.1'], ['nine pairs', Array.from({ length: 9 }, (_, i) => `coordinator.${i + 1}`).join(',')],
    ['a leading zero', 'coordinator.07'], ['a trailing comma', 'coordinator.1,'],
  ])('a value outside the grammar is refused and writes nothing: %s', (_n, pairs) => {
    seed();
    const r = route(`--session ${ID} --set 'mailhold=${nowS() + 60}:${pairs}'`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('bad value for mailhold');
    expect(fs.existsSync(regFile('mailhold'))).toBe(false);
    expect(swapLog()).toBe('');
  });

  it(`a value whose until is more than ${MAILHOLD_REACH_S} s past ccd's clock is refused; one inside the reach is written`, () => {
    seed();
    const far = route(`--session ${ID} --set mailhold=${nowS() + 3600}:coordinator.1`);
    expect(far.status).not.toBe(0);
    expect(far.out).toContain('mailhold-far');
    expect(fs.existsSync(regFile('mailhold'))).toBe(false);
    expect(swapLog()).toBe('');
    // 30 s inside the reach, so a second boundary between the read of the clock and ccd's own cannot fail it.
    const near = route(`--session ${ID} --set mailhold=${nowS() + MAILHOLD_REACH_S - 30}:coordinator.1`);
    expect(near.status, near.out).toBe(0);
  });

  it('a stored marker whose until has passed still reads valid through _route_get (the bound is at the write site only)', () => {
    seed();
    h.sh(`_reg_set ${ID} mailhold 1000:coordinator.1`);
    expect(h.sh(`_route_get ${ID} mailhold; echo "|rc=$?"`)).toBe('1000:coordinator.1|rc=0');
    // ...and so does one far in the future: a clock step must never make a standing value unreadable.
    h.sh(`_reg_set ${ID} mailhold 99999999999:overlord.2`);
    expect(h.sh(`_route_get ${ID} mailhold; echo "|rc=$?"`)).toBe('99999999999:overlord.2|rc=0');
    expect(swapLog()).not.toContain('route-reject');
  });

  describe('a session\'s shell may not write it (mailhold-lane-only)', () => {
    const shell = { CCRC_TEST_CLAUDECODE: '1' };
    it('a write is refused and writes nothing', () => {
      seed();
      const r = route(`--session ${ID} --set mailhold=${nowS() + 60}:coordinator.1`, shell);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('mailhold-lane-only: a Claude Code session may not write mailhold');
      expect(fs.existsSync(regFile('mailhold'))).toBe(false);
    });
    it('a clear is refused too, and the standing marker stays', () => {
      seed();
      h.sh(`_reg_set ${ID} mailhold ${nowS() + 60}:coordinator.1`);
      const r = route(`--session ${ID} --set mailhold=`, shell);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('mailhold-lane-only');
      expect(fs.existsSync(regFile('mailhold'))).toBe(true);
    });
  });

  it('a standing marker does not make _route_any true', () => {
    seed();
    h.sh(`_reg_set ${ID} mailhold ${nowS() + 60}:coordinator.1`);
    expect(h.sh(`_route_any ${ID} && echo yes || echo no`)).toBe('no');
  });

  describe('the retry budget (plan P13)', () => {
    const tries = (): string => path.join(h.home, '.cc-sessions', `${ID}.routetries`);
    it('a mailhold-only write leaves .routetries in place', () => {
      seed();
      fs.writeFileSync(tries(), '2 1790000000\n');
      expect(route(`--session ${ID} --set mailhold=${nowS() + 60}:coordinator.1`).status).toBe(0);
      expect(fs.existsSync(tries())).toBe(true);
      expect(route(`--session ${ID} --set mailhold=`).status).toBe(0);
      expect(fs.existsSync(tries())).toBe(true);
    });
    it('a class write still clears it, and so does a write of mailhold with another field', () => {
      seed();
      fs.writeFileSync(tries(), '2 1790000000\n');
      expect(route(`--session ${ID} --set class=opus`).status).toBe(0);
      expect(fs.existsSync(tries())).toBe(false);
      fs.writeFileSync(tries(), '2 1790000000\n');
      expect(route(`--session ${ID} --set mailhold=${nowS() + 60}:coordinator.1 --set effort=high`).status).toBe(0);
      expect(fs.existsSync(tries())).toBe(false);
    });
  });

  it('an absent session dies no such session', () => {
    const r = route(`--session ${ID} --set mailhold=${nowS() + 60}:coordinator.1`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain(`no such session: ${ID}`);
    expect(fs.existsSync(regFile('mailhold'))).toBe(false);
  });

  it('ccd caps prints route-mailhold-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('route-mailhold-v1');
  });
});

describe('a renewal leaves no record (PR 3 review F2, the coordinator\'s binding ruling)', () => {
  // The projection renews a matching marker every few minutes per held session: only a write that changes the held
  // set, and a clear, may leave a journal row and a swap.log line.
  it('ten renewals of one unchanged hold leave no new journal row or swap.log line, and each moves the lease', () => {
    seed();
    const base = nowS();
    expect(route(`--session ${ID} --set mailhold=${base + 100}:coordinator.7,overlord.9`).status).toBe(0);
    const rows = eventsOf(h.home, 'route').length;
    const log = swapLog();
    for (let i = 1; i <= 10; i += 1) {
      const v = `${base + 100 + i}:coordinator.7,overlord.9`;
      const r = route(`--session ${ID} --set mailhold=${v}`);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain(`set ${ID} mailhold=${v}`);
      expect(h.reg(ID, 'mailhold')).toBe(v);
    }
    expect(eventsOf(h.home, 'route')).toHaveLength(rows);
    expect(swapLog()).toBe(log);
  });

  it('a write that changes the held set is recorded, and so is a clear', () => {
    seed();
    const base = nowS();
    expect(route(`--session ${ID} --set mailhold=${base + 100}:coordinator.7`).status).toBe(0);
    expect(route(`--session ${ID} --set mailhold=${base + 100}:coordinator.7,overlord.9`).status).toBe(0);
    expect(route(`--session ${ID} --set mailhold=${base + 100}:overlord.9`).status).toBe(0);
    expect(route(`--session ${ID} --set mailhold=${base + 100}:coordinator.9`).status).toBe(0);
    expect(route(`--session ${ID} --set mailhold=`).status).toBe(0);
    expect(eventsOf(h.home, 'route')).toHaveLength(5);
    expect(swapLog().trim().split('\n')).toHaveLength(5);
  });

  it('only mailhold skips its record: a same-value rewrite of another field is still recorded each time', () => {
    seed();
    expect(route(`--session ${ID} --set compact=50`).status).toBe(0);
    expect(route(`--session ${ID} --set compact=50`).status).toBe(0);
    expect(eventsOf(h.home, 'route')).toHaveLength(2);
    expect(swapLog().trim().split('\n')).toHaveLength(2);
  });

  it('a write over a malformed standing value is recorded, never read as a renewal', () => {
    seed();
    h.sh(`_reg_set ${ID} mailhold junk:coordinator.7`);
    expect(route(`--session ${ID} --set mailhold=${nowS() + 100}:coordinator.7`).status).toBe(0);
    expect(eventsOf(h.home, 'route')).toHaveLength(1);
    expect(swapLog()).toContain('bytes, unrecognised>');
  });
});
