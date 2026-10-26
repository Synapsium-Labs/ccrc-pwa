// #1170: the agent's memory protection chain. Under the kernel's memory_recursiveprot a cgroup's effective memory.min
// and memory.low are capped by its parent's, so `ccrc-agent.service`'s own MemoryMin protected nothing while
// user.slice, user-<uid>.slice and app.slice declared 0: under a host thrash (memory PSI full over 50%) the agent's
// main thread refaulted its own node text in D-state, its accept queue backed up and the controller read every
// registry-dependent verb as unmeasurable.
//
// Three halves, all pure and on fixtures; nothing here reads the real /sys/fs/cgroup or runs systemctl:
//  1. THE DROP-INS the deploy installs (and the root-owned ones it prints) declare, at every ancestor from user.slice
//     down to the agent, at least the agent's MemoryMin and MemoryLow.
//  2. THE AGENT UNIT keeps its anon resident and wins I/O, and keeps CPUWeight=5000; no file in the chain sets
//     MemoryHigh (#72, #84).
//  3. THE GATE (`deploy/assert-protect-chain.sh`) reads memory.min along a FIXTURE cgroup chain: green on full
//     protection, red on a chain missing any one ancestor, and deploy.sh runs it after the restart.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const deployDir = path.resolve(here, '..', '..', 'deploy');
const GATE = path.join(deployDir, 'assert-protect-chain.sh');
const AGENT_DROPIN = 'systemd/ccrc-agent.service.d/protect.conf';

/** Every ancestor of the agent's cgroup, top first, with the drop-in that protects it and who places it. */
const CHAIN: readonly { unit: string; file: string; owner: 'root' | 'user' }[] = [
  { unit: 'user.slice', file: 'systemd-root/user.slice.d/50-ccrc-agent-protect.conf', owner: 'root' },
  { unit: 'user-<uid>.slice', file: 'systemd-root/user-UID.slice.d/50-ccrc-agent-protect.conf', owner: 'root' },
  { unit: 'user@<uid>.service', file: 'systemd-root/user@UID.service.d/50-ccrc-agent-protect.conf', owner: 'root' },
  { unit: 'app.slice', file: 'systemd/app.slice.d/50-ccrc-agent-protect.conf', owner: 'user' },
];

/** A systemd size (`512M`, `1G`, `1024K`, bare bytes) in bytes; `infinity` is unbounded; anything else is NaN. */
function sizeBytes(v: string): number {
  if (v === 'infinity') return Number.POSITIVE_INFINITY;
  const m = /^(\d+)([KMGT]?)$/.exec(v);
  if (m === null) return Number.NaN;
  const mult = { '': 1, K: 2 ** 10, M: 2 ** 20, G: 2 ** 30, T: 2 ** 40 }[m[2] as '' | 'K' | 'M' | 'G' | 'T'];
  return Number(m[1]) * mult;
}

/** The last assignment of `key` in a drop-in (systemd: the last one wins), or null. */
function directive(rel: string, key: string): string | null {
  const p = path.join(deployDir, rel);
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith(`${key}=`));
  return lines.length === 0 ? null : lines[lines.length - 1]!.slice(key.length + 1);
}

describe('the protection chain the deploy declares (#1170)', () => {
  const agentMin = sizeBytes(directive(AGENT_DROPIN, 'MemoryMin') ?? '');
  const agentLow = sizeBytes(directive(AGENT_DROPIN, 'MemoryLow') ?? '');

  it('the agent declares a MemoryMin that covers its working set, and a MemoryLow at least as large', () => {
    // Measured: about 233M anon. The working set is anon plus the file pages it maps, so the floor is well above the
    // anon figure and nowhere near memory.current (page-cache inflated, 2.1G).
    expect(agentMin, 'protect.conf MemoryMin').toBeGreaterThanOrEqual(512 * 2 ** 20);
    expect(agentMin, 'protect.conf MemoryMin must not be sized from memory.current').toBeLessThan(2 * 2 ** 30);
    expect(agentLow, 'protect.conf MemoryLow').toBeGreaterThanOrEqual(agentMin);
  });

  for (const a of CHAIN) {
    it(`${a.unit} declares MemoryMin and MemoryLow of at least the agent's (${a.owner}-owned)`, () => {
      const min = directive(a.file, 'MemoryMin');
      const low = directive(a.file, 'MemoryLow');
      expect(min, `${a.file}: no MemoryMin, so the agent's effective protection is capped at 0`).not.toBeNull();
      expect(sizeBytes(min!), `${a.file}: MemoryMin`).toBeGreaterThanOrEqual(agentMin);
      expect(low, `${a.file}: no MemoryLow`).not.toBeNull();
      expect(sizeBytes(low!), `${a.file}: MemoryLow`).toBeGreaterThanOrEqual(agentLow);
      const section = a.unit.endsWith('.slice') ? '[Slice]' : '[Service]';
      expect(readFileSync(path.join(deployDir, a.file), 'utf8'), `${a.file}: section`).toContain(section);
    });
  }

  it('no file in the chain sets MemoryHigh (#72, #84)', () => {
    for (const f of [AGENT_DROPIN, ...CHAIN.map((a) => a.file)]) {
      expect(directive(f, 'MemoryHigh'), `${f} sets MemoryHigh`).toBeNull();
    }
  });

  it('the agent keeps its anon resident, wins I/O, and keeps CPUWeight=5000', () => {
    expect(directive(AGENT_DROPIN, 'MemorySwapMax')).toBe('0');
    expect(directive(AGENT_DROPIN, 'IOWeight')).toBe('1000');
    expect(directive(AGENT_DROPIN, 'CPUWeight')).toBe('5000');
  });

  it('deploy.sh installs the user-manager half, and the gate prints an install for every root-owned file', () => {
    const deploySh = readFileSync(path.join(deployDir, 'deploy.sh'), 'utf8');
    const buildCmd = /AGENT_BUILD_CMD='([\s\S]*?)'/.exec(deploySh)![1]!;
    expect(buildCmd).toContain(
      '_unit_atomic ~/ccrc/deploy/systemd/app.slice.d/50-ccrc-agent-protect.conf ~/.config/systemd/user/app.slice.d/50-ccrc-agent-protect.conf');
    expect(buildCmd).toContain(
      '_unit_atomic ~/ccrc/deploy/systemd/ccrc-agent.service.d/protect.conf ~/.config/systemd/user/ccrc-agent.service.d/protect.conf');
    const gate = readFileSync(GATE, 'utf8');
    for (const a of CHAIN.filter((c) => c.owner === 'root')) {
      expect(gate, `the gate's root step does not install ${a.file}`).toContain(`$src/${a.file.slice('systemd-root/'.length)}`);
    }
    // It never escalates: every `sudo` in the script is inside a printed line.
    const sudoLines = gate.split('\n').filter((l) => /\bsudo\b/.test(l) && !l.trim().startsWith('#'));
    expect(sudoLines.length).toBeGreaterThan(0);
    for (const l of sudoLines) expect(l.trim(), 'the gate must print the root step, never run it').toMatch(/^echo /);
  });

  it('AGENT_CMD runs the gate after the restart and before verify-service.sh, and tolerates only the pending-root exit', () => {
    const deploySh = readFileSync(path.join(deployDir, 'deploy.sh'), 'utf8');
    const agentCmd = /AGENT_CMD='([\s\S]*?)'/.exec(deploySh)![1]!;
    const links = agentCmd.split('&&').map((s) => s.replace(/\\\s*$/, '').trim());
    const restartAt = links.findIndex((l) => l.includes('restart ccrc-agent.service'));
    const gateAt = links.findIndex((l) => l.includes('assert-protect-chain.sh'));
    const verifyAt = links.findIndex((l) => l.includes('verify-service.sh ccrc-agent.service'));
    expect(gateAt, 'assert-protect-chain.sh is not wired into AGENT_CMD').toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(restartAt);
    expect(gateAt).toBeLessThan(verifyAt);
    expect(links[gateAt]).toBe('{ bash ~/ccrc/deploy/assert-protect-chain.sh || [ $? -eq 2 ]; }');
  });
});

// ── the gate, on a fixture cgroup tree ───────────────────────────────────────────────────────────────────────────

const AGENT_CG = '/user.slice/user-1000.slice/user@1000.service/app.slice/ccrc-agent.service';
const MIN = 512 * 2 ** 20;

/** A fixture cgroup tree holding the agent's chain, with `memory.min` per level (`over` replaces a level's value). */
function fixtureTree(over: Record<string, string> = {}): string {
  const root = mkTmp('ccrc-protect-chain-');
  let p = '';
  for (const seg of AGENT_CG.split('/').slice(1)) {
    p = `${p}/${seg}`;
    mkdirSync(path.join(root, p), { recursive: true });
    writeFileSync(path.join(root, p, 'memory.min'), `${over[seg] ?? String(MIN)}\n`);
  }
  writeFileSync(path.join(root, AGENT_CG, 'memory.events'), 'low 3\nhigh 0\nmax 0\noom 0\noom_kill 0\n');
  return root;
}

function runGate(root: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('bash', [GATE], {
    encoding: 'utf8',
    env: { ...process.env, CCRC_CGROUP_ROOT: root, CCRC_AGENT_CGROUP: AGENT_CG, HOME: '/home/fixture' },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('assert-protect-chain.sh on a fixture tree (#1170)', () => {
  it('green when every ancestor protects at least the agent, and it reports the agent\'s memory.events', () => {
    const r = runGate(fixtureTree());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('every ancestor protects at least 536870912');
    expect(r.stdout).toContain('low 3');
    expect(r.stdout).toContain('oom_kill 0');
  });

  it('`max` on an ancestor counts as protecting everything', () => {
    expect(runGate(fixtureTree({ 'user.slice': 'max' })).status).toBe(0);
  });

  // The live layout before the root step: the three root-owned levels at 0.
  for (const unit of ['user.slice', 'user-1000.slice', 'user@1000.service']) {
    it(`red (pending root step, exit 2) when ${unit} is missing its protection, and it prints the exact step`, () => {
      const r = runGate(fixtureTree({ [unit]: '0' }));
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`PENDING ROOT STEP`);
      expect(r.stderr).toContain(`${unit}=0`);
      expect(r.stderr).toContain('sudo install -D -m 644 /home/fixture/ccrc/deploy/systemd-root/user-UID.slice.d/50-ccrc-agent-protect.conf /etc/systemd/system/user-1000.slice.d/50-ccrc-agent-protect.conf');
      expect(r.stderr).toContain('/etc/systemd/system/user@1000.service.d/50-ccrc-agent-protect.conf');
      expect(r.stderr).toContain('sudo systemctl daemon-reload');
    });
  }

  it('red (exit 1) when app.slice, the half this deploy installs, is missing its protection', () => {
    const r = runGate(fixtureTree({ 'app.slice': String(MIN - 1) }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`app.slice=${MIN - 1}`);
    expect(r.stderr).toContain('app.slice.d/50-ccrc-agent-protect.conf');
  });

  it('the live box as measured (every ancestor 0) is red, and a user-manager gap outranks the root step', () => {
    const r = runGate(fixtureTree({ 'user.slice': '0', 'user-1000.slice': '0', 'user@1000.service': '0', 'app.slice': '0' }));
    expect(r.status).toBe(1);
  });

  it('red (exit 1) when the agent itself declares no protection, or its cgroup cannot be read', () => {
    expect(runGate(fixtureTree({ 'ccrc-agent.service': '0' })).status).toBe(1);
    const r = spawnSync('bash', [GATE], {
      encoding: 'utf8', env: { ...process.env, CCRC_CGROUP_ROOT: mkTmp('ccrc-protect-empty-'), CCRC_AGENT_CGROUP: AGENT_CG },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cannot read ccrc-agent.service');
  });
});
