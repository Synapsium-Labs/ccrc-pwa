// #1170: the thrash harness has to reproduce the fleet box's layout, or a green run is a false green. File pages are
// charged to whichever cgroup first faulted them in. On the fleet box sessions run node all the time and every deploy
// restarts the agent under them, so node's text and the shared libraries the agent stalled refaulting are likely
// charged to a SESSION cgroup, where the agent's memory.min does not reach. On a fresh VM the agent is the only
// long-lived node, its text is charged to itself, and the protection chain covers it there: a run that never puts a
// sibling in front of the agent cannot show the failure that was measured.
//
// Two halves, both on fixtures; nothing here reads the real /sys/fs/cgroup, /proc or runs systemctl:
//  1. THE CHARGE CHECK (`deploy/thrash-vm/text-charge.sh`, read-only, also the after-deploy check for a real box)
//     compares the agent cgroup's memory.stat file_mapped with the file-backed Rss in the agent's smaps_rollup, and
//     says which cgroup the mapped text is charged to.
//  2. THE RUN SCRIPT (`deploy/thrash-vm/run.sh`) names its pass (red: the root step not applied; green: applied) and
//     refuses a layout that does not match it; it drops caches and starts node in the session slice BEFORE it starts
//     the agent, and the load only after; it records the charge before and after.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const vmDir = path.resolve(here, '..', '..', 'deploy', 'thrash-vm');
const CHARGE = path.join(vmDir, 'text-charge.sh');
const RUN = path.join(vmDir, 'run.sh');
const AGENT_CG = '/user.slice/user-1000.slice/user@1000.service/app.slice/ccrc-agent.service';
const MiB = 2 ** 20;

/** A fixture: the agent's memory.stat (file_mapped, file in bytes) and a smaps_rollup (Rss, Anonymous in kB). */
function fixture(fileMappedBytes: number, rssKb: number, anonKb: number): { root: string; smaps: string } {
  const root = mkTmp('ccrc-text-charge-');
  mkdirSync(path.join(root, AGENT_CG), { recursive: true });
  writeFileSync(path.join(root, AGENT_CG, 'memory.stat'),
    `anon ${anonKb * 1024}\nfile ${fileMappedBytes * 2}\nkernel 0\nfile_mapped ${fileMappedBytes}\nfile_dirty 0\n`);
  const smaps = path.join(root, 'smaps_rollup');
  writeFileSync(smaps, [
    '00400000-7ffd0000 ---p 00000000 00:00 0                          [rollup]',
    `Rss:              ${rssKb} kB`, `Pss:              ${rssKb} kB`, `Pss_Anon:         ${anonKb} kB`,
    `Pss_File:         ${rssKb - anonKb} kB`, 'Pss_Shmem:            0 kB', `Anonymous:        ${anonKb} kB`, '',
  ].join('\n'));
  return { root, smaps };
}

function charge(f: { root: string; smaps: string }): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('bash', [CHARGE], {
    encoding: 'utf8',
    env: { ...process.env, CCRC_CGROUP_ROOT: f.root, CCRC_AGENT_CGROUP: AGENT_CG, CCRC_AGENT_SMAPS: f.smaps },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('text-charge.sh on fixtures (#1170)', () => {
  it('own (exit 0) when the cgroup is charged for about all the file-backed pages the agent maps', () => {
    // 233M anon, 60M file-backed Rss, 58M of it charged here.
    const r = charge(fixture(58 * MiB, (233 + 60) * 1024, 233 * 1024));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('file_mapped=60817408');
    expect(r.stdout).toContain('smaps_file_rss=62914560');
    expect(r.stdout).toContain('verdict=own');
  });

  it('elsewhere (exit 3) when most of the mapped text is charged to another cgroup: memory.min cannot cover it', () => {
    const r = charge(fixture(4 * MiB, (233 + 60) * 1024, 233 * 1024));
    expect(r.status, r.stdout).toBe(3);
    expect(r.stdout).toContain('verdict=elsewhere');
    expect(r.stdout).toMatch(/mlock/);
  });

  it('exit 1 when either side cannot be read, and it writes nothing', () => {
    const f = fixture(4 * MiB, 1024, 0);
    expect(charge({ root: f.root, smaps: path.join(f.root, 'absent') }).status).toBe(1);
    expect(charge({ root: path.join(f.root, 'absent'), smaps: f.smaps }).status).toBe(1);
    const src = readFileSync(CHARGE, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#'));
    expect(src.join('\n'), 'a read-only check').not.toMatch(/>\s*\/(sys|proc)|\bsystemctl\s+(--user\s+)?(start|stop|restart)|\bsudo\b/);
  });
});

describe('run.sh, the thrash pass (#1170)', () => {
  const src = readFileSync(RUN, 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

  it('refuses without a named pass, before it touches anything', () => {
    const r = spawnSync('bash', [RUN], { encoding: 'utf8', env: { ...process.env, CCRC_THRASH_VM: 'yes', THRASH_VM_PASS: '' } });
    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(/THRASH_VM_PASS=red\|green/);
  });

  it('a red pass needs the root step NOT applied (gate exit 2), a green pass needs it applied (gate exit 0)', () => {
    expect(code).toMatch(/red\)\s*want=2/);
    expect(code).toMatch(/green\)\s*want=0/);
  });

  it('drops caches and starts node in the session slice before it starts the agent, and the load only after', () => {
    const stop = code.indexOf('systemctl --user stop ccrc-agent.service');
    const drop = code.indexOf('/proc/sys/vm/drop_caches');
    const sibling = code.indexOf("--slice='app-claude\\x2dsession.slice'");
    const start = code.indexOf('systemctl --user start ccrc-agent.service');
    const load = code.indexOf('stress-ng --vm');
    for (const [name, at] of Object.entries({ stop, drop, sibling, start, load })) expect(at, name).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(drop);
    expect(drop).toBeLessThan(sibling);
    expect(sibling).toBeLessThan(start);
    expect(start).toBeLessThan(load);
  });

  it('records the charge before the window and after it', () => {
    expect(code.match(/text-charge\.sh/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(code).toMatch(/before:[\s\S]*charge[\s\S]*probe\.mjs[\s\S]*after:[\s\S]*charge/);
  });
});
