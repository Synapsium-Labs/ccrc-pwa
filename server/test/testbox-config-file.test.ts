// D-7451, D-7456, D-7457 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB7; plan item 18 and item 19): the
// box's four readers of its one config file agree. A fixture box file under TB_FIXTURE_ROOT sets every box key and
// CCRC_RELEASE_BASE_URL to a second value (the default being the first); root's and the service user's fixture
// ~/.ccrc/ccrc.env each set every one of them to a third, and the caller's environment to a fourth. Then:
//   (a) the installer, run into the fixture root, renders drop-ins whose MemoryMax=, MemorySwapMax=, CPUQuota=,
//       IPAddressAllow=, User= and RuntimeMaxSec= are the box file's;
//   (b) `ccrc-test --testbox-knobs box` under the service user's fixture HOME, as agent/src/testbox/config.ts runs it,
//       prints the box file's value of every box key with `from` `file`, and config.ts's read gives the same values
//       while process.env holds the fourth;
//   (c) the specs/<k> that spec.ts writes from (b)'s read holds the box file's worker count, TMPDIR and report cap;
//   (d) the tools unit's sync, run with root's fixture HOME, resolves the release base through `_tb_release_base`
//       (`_ccrc_knob CCRC_RELEASE_BASE_URL <default> file` against the same box file): the box file's release host is
//       asked, while the release hosts root's home file and the environment name are never asked.
// One mutation per shell reader reds its row here, measured in the test: (a) an installer that reads the caller's
// home file, (d) a release base read in environment mode and a skipped assignment. (b)'s and (c)'s mutations (a
// config.ts that reads process.env, a spec.ts with a literal default) are TypeScript and are measured in the PR body.
// With the box file edited and the installer re-run, the drop-ins, the printer and the spec show the new value and
// the fixture system manager's log shows one reload and one restart; an unchanged re-run logs neither. The censuses:
// no EnvironmentFile= under deploy/testbox/; no code line under deploy/testbox/, agent/src/testbox/ or
// ccd/testbox-* names .ccrc/ccrc.env or assigns BOX_ENV_FILE beyond ccd/testbox-knobs's two per-call bindings; every
// _upd_release_base call there passes `file`. Every reader runs as the test user with TB_FIXTURE_OWNER_UID=$(id -u).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configFromLines, parseKnobLines, readTestboxConfig, type KnobRunner, type TestboxConfig } from '../../agent/src/testbox/config.js';
import { buildRunSpec, writeSpec } from '../../agent/src/testbox/spec.js';
import { encodeToolsSpec, toolsSettings } from '../../agent/src/testbox/tools.js';
import { durationMs } from '../../agent/src/testbox/config.js';
import type { RunSubmit, TestboxRepoRow } from '../../shared/testbox.js';
import {
  BOOT_TAG, boxPaths, exec, httpHost, install, makeBox, makeWorld, REPO, sysLog, UID, unitProps, writeManifest,
  type Box, type Host, type World,
} from './testboxBoxFixture.js';
import { mkTmp } from './tmpHelpers.js';

const US = '\x1f';

/** Every box key at a second, third and fourth value, each its setting's shape and none its default. */
function values(root: string, n: 2 | 3 | 4): Record<string, string> {
  // Every path is under the fixture root, the third and fourth too: a mutant that reads one writes only there.
  const p = n === 2 ? boxPaths(root) : boxPaths(path.join(root, `v${n}`));
  return {
    CCRC_TESTBOX_RUNS: String(n + 1), CCRC_TESTBOX_WORKERS: String(n + 1), CCRC_TESTBOX_RUN_TMPDIR: `/tmp/r${n}`,
    CCRC_TESTBOX_RUN_MEMORY_MAX: `${n}G`, CCRC_TESTBOX_RUN_SWAP_MAX: `${n}M`, CCRC_TESTBOX_RUN_CPU_QUOTA: `${n}50%`,
    CCRC_TESTBOX_ROOT: p.tbRoot, CCRC_TESTBOX_REPOS: p.repos, CCRC_TESTBOX_FETCH_EVERY: `${n}m`, CCRC_TESTBOX_RETENTION: `${n}h`,
    CCRC_TESTBOX_PRISTINE_KEEP: `${n}d`, CCRC_TESTBOX_PRISTINE_RETRY: `${n}s ${n}m`, CCRC_TESTBOX_REPORT_MAX: `${n}M`,
    CCRC_TESTBOX_TOOLS_DIR: p.tools, CCRC_TESTBOX_OS_MIRROR: `http://mirror${n}.testbox.invalid/ubuntu`,
    CCRC_TESTBOX_EGRESS_ALLOW: n === 2 ? 'github.com nodejs.org' : 'github.com', CCRC_TESTBOX_PUSH_USER: `ccrc-tb-push${n}`,
    CCRC_TESTBOX_ENV_FORWARD: `CCRC_FORWARD_${n}`, CCRC_TESTBOX_RUN_USER_PREFIX: `ccrc-tb${n}-`,
    CCRC_TESTBOX_REGISTRY_PROXY: `127.0.0.${n + 1}:48${n}0`, CCRC_TESTBOX_REGISTRY_UPSTREAM: `https://registry${n}.testbox.invalid`,
    CCRC_TESTBOX_TMPFS: n === 2 ? 'on' : 'off', CCRC_TESTBOX_LOG_TAIL: `${n}${n}`, CCRC_TESTBOX_SESSION_RUNS: String(n),
    CCRC_TESTBOX_SERVICE_USER: `ccrc-tb-svc${n}`, CCRC_TESTBOX_LISTEN: `127.0.0.${n + 10}:74${n}0`,
    CCRC_TESTBOX_SERVICE_TOKEN_FILE: path.join(root, `tb${n}-token`), CCRC_TESTBOX_UNIT_MAX: `${n}h`,
  };
}
const envFile = (v: Record<string, string>): string => Object.entries(v).map(([k, x]) => `${k}="${x}"`).join('\n') + '\n';

interface Fx {
  readonly b: Box;
  readonly svcHome: string;
  readonly hosts: { a: Host; b: Host; c: Host };
  readonly env: NodeJS.ProcessEnv;
}

let W: World;
let F: Fx;
const V2 = (): Record<string, string> => values(F.b.root, 2);

/** A fixture box whose box file holds the second values, homes the third, the environment the fourth. */
async function fixture(hosts: { a: Host; b: Host; c: Host }): Promise<Fx> {
  const b = makeBox(W, { paths: false });
  const v2 = values(b.root, 2);
  writeFileSync(b.boxFile, envFile({ ...v2, CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${hosts.a.port}/releases` }), { mode: 0o600 });
  for (const home of [b.home, path.join(b.fx, 'svc-home')]) {
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), envFile({ ...values(b.root, 3), CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${hosts.b.port}/releases` }));
  }
  const env: NodeJS.ProcessEnv = { ...values(b.root, 4), CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${hosts.c.port}/releases` };
  return { b, svcHome: path.join(b.fx, 'svc-home'), hosts, env };
}

beforeAll(async () => {
  W = await makeWorld();
  F = await fixture({ a: await httpHost(), b: await httpHost(), c: await httpHost() });
  const r = await install(F.b, { staging: W.staging, env: F.env });
  if (r.code !== 0) throw new Error(`the fixture install failed: ${r.stderr}`);
}, 240_000);
afterAll(async () => {
  await W?.close();
  for (const h of [F?.hosts.a, F?.hosts.b, F?.hosts.c]) await h?.close();
});

const sysDir = (b: Box): string => path.join(b.root, 'etc', 'systemd', 'system');
const drop = (b: Box, u: string): string[] => unitProps(readFileSync(path.join(sysDir(b), `${u}.d`, '50-ccrc-testbox.conf'), 'utf8'));
/** The drop-ins' values (a). */
function dropIns(b: Box): Record<string, string[]> {
  return {
    service: drop(b, 'ccrc-testbox.service'), prepare: drop(b, 'ccrc-testbox-prepare@.service'), run: drop(b, 'ccrc-testbox-run@.service'),
    install: drop(b, 'ccrc-testbox-install.service'), slice: drop(b, 'ccrc-testbox-run-.slice'), islice: drop(b, 'ccrc-testbox-install.slice'),
  };
}
const expectedDropIns = (v: Record<string, string>): Record<string, string[]> => {
  const caps = [`[Slice] MemoryMax=${v.CCRC_TESTBOX_RUN_MEMORY_MAX}`, `[Slice] MemorySwapMax=${v.CCRC_TESTBOX_RUN_SWAP_MAX}`, `[Slice] CPUQuota=${v.CCRC_TESTBOX_RUN_CPU_QUOTA}`];
  const allow = `[Service] IPAddressAllow=${v.CCRC_TESTBOX_REGISTRY_PROXY!.split(':')[0]}/32`;
  const max = `[Service] RuntimeMaxSec=${v.CCRC_TESTBOX_UNIT_MAX}`;
  const p = v.CCRC_TESTBOX_RUN_USER_PREFIX!;
  return {
    service: [`[Service] User=${v.CCRC_TESTBOX_SERVICE_USER}`, `[Service] Group=${v.CCRC_TESTBOX_SERVICE_USER}`],
    prepare: [`[Service] User=${p}%i`, allow, max], run: [`[Service] User=${p}%i`, max], install: [`[Service] User=${p}install`, allow, max],
    slice: caps, islice: caps,
  };
};

/** The printer, as config.ts runs it, under the service user's fixture HOME; the fixture root reaches it, nothing else. */
const fixtureRunner = (b: Box): KnobRunner => async (file, args, env) => {
  const r = await exec(file, [...args], { ...env, TB_FIXTURE_ROOT: b.root, TB_FIXTURE_OWNER_UID: String(UID) });
  return { status: r.code, stdout: r.stdout, stderr: r.stderr };
};
const installedTree = (b: Box): string => path.join(V2().CCRC_TESTBOX_TOOLS_DIR!, 'release', 'installed');
async function printed(b: Box): Promise<Map<string, { value: string; from: string }>> {
  const r = await exec(path.join(installedTree(b), 'ccd', 'ccrc-test'), ['--testbox-knobs', 'box'], {
    HOME: F.svcHome, PATH: process.env.PATH, LANG: 'C', TB_FIXTURE_ROOT: b.root, TB_FIXTURE_OWNER_UID: String(UID), ...F.env,
  });
  expect(r.code, r.stderr).toBe(0);
  return new Map(r.stdout.split('\n').filter((l) => l !== '').map((l) => { const f = l.split(US); return [f[0]!, { value: f[2]!, from: f[3]! }]; }));
}
async function config(b: Box): Promise<TestboxConfig> {
  for (const [k, v] of Object.entries(F.env)) vi.stubEnv(k, v!);
  try { return await readTestboxConfig(installedTree(b), fixtureRunner(b), F.svcHome, process.env.PATH); } finally { vi.unstubAllEnvs(); }
}
const ROW: TestboxRepoRow = {
  name: 'project-a', fetchUrl: 'https://testbox.invalid/project-a.git', mirrorPath: '/nonexistent/project-a.git',
  packages: [{ name: 'server', installInputs: ['server/package.json'], commands: ['./node_modules/.bin/vitest'] }], buildOutputs: [], systemTools: [],
};
const SUBMIT: RunSubmit = {
  t: 'run.submit', runId: 'd'.repeat(32), repository: 'project-a', package: 'server', branch: 'main', refs: ['head'], outputs: [],
  argv: ['./node_modules/.bin/vitest', 'run'], forward: {}, ci: false, workers: 9, session: 'session-a',
};
function specRecords(cfg: TestboxConfig): string[] {
  const built = buildRunSpec(SUBMIT, ROW, 1, cfg, '/nonexistent/chrome');
  if (!built.ok) throw new Error(built.reason);
  return readFileSync(writeSpec(cfg.root, built.spec), 'utf8').split('\0');
}
const sizeOf = (v: string): string => String(Number(v.slice(0, -1)) * { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[v.slice(-1) as 'K' | 'M' | 'G']);

describe('(a) the installer renders the drop-ins from the box file, never a home file or the environment (D-7451)', () => {
  it('User=, IPAddressAllow=, RuntimeMaxSec=, MemoryMax=, MemorySwapMax= and CPUQuota= are the box file\'s', () => {
    expect(dropIns(F.b)).toEqual(expectedDropIns(V2()));
    expect(readFileSync(path.join(F.b.root, 'etc', 'polkit-1', 'rules.d', '50-ccrc-testbox.rules'), 'utf8')).toContain(`subject.user !== "${V2().CCRC_TESTBOX_SERVICE_USER}"`);
    const users = sysLog(F.b).filter((a) => a[0] === 'useradd').map((a) => a[a.length - 1]);
    expect(users).toEqual(['ccrc-tb-svc2', 'ccrc-tb-push2', 'ccrc-tb2-1', 'ccrc-tb2-2', 'ccrc-tb2-3', 'ccrc-tb2-install']);
    expect(readdirSync(path.join(V2().CCRC_TESTBOX_ROOT!, 'runs')).sort()).toEqual(['1', '2', '3']);
  });

  it('mutation: an installer that reads the caller\'s home ccrc.env (BOX_ENV_FILE) renders the third value, and the row reds', async () => {
    const st = path.join(mkTmp('ccrc-tb-mut-a-'), 'staging');
    cpSync(W.staging, st, { recursive: true });
    const f = path.join(st, 'deploy', 'testbox', 'install.sh');
    const from = `k() { printf '%s' "\${TBK[$1]}"; }`;
    const text = readFileSync(f, 'utf8');
    expect(text.split(from).length, 'the mutation applies once').toBe(2);
    writeFileSync(f, text.replace(from, `k() { _ccrc_knob "$1" "\${TBK[$1]}" file >/dev/null; printf '%s' "\${KNOB:-\${TBK[$1]}}"; }`));
    writeManifest(st);
    const m = await fixture(F.hosts);
    const r = await install(m.b, { staging: st, env: m.env });
    expect(r.code, r.stderr).toBe(0);
    expect(dropIns(m.b)).not.toEqual(expectedDropIns(values(m.b.root, 2)));
    expect(dropIns(m.b)).toEqual(expectedDropIns(values(m.b.root, 3)));
  });
});

describe('(b) the service reads the box file through ccrc-test --testbox-knobs box (D-7451)', () => {
  it('every box key is the box file\'s, from file, under the service user\'s HOME with a home file and an environment naming others', async () => {
    const p = await printed(F.b);
    const v2 = V2();
    for (const [k, v] of Object.entries(v2)) expect(p.get(k), k).toEqual({ value: v, from: 'file' });
    expect([...p.keys()].sort()).toEqual(Object.keys(v2).sort());
  });

  it('config.ts\'s one read gives the box file\'s values while process.env holds the fourth', async () => {
    const cfg = await config(F.b);
    const v2 = V2();
    expect([cfg.runs, cfg.workers, cfg.runTmpdir, cfg.root, cfg.toolsDir, cfg.serviceUser, cfg.runUserPrefix, cfg.reportMaxBytes, cfg.unitMaxMs]).toEqual([
      3, 3, v2.CCRC_TESTBOX_RUN_TMPDIR, v2.CCRC_TESTBOX_ROOT, v2.CCRC_TESTBOX_TOOLS_DIR, v2.CCRC_TESTBOX_SERVICE_USER, v2.CCRC_TESTBOX_RUN_USER_PREFIX,
      Number(sizeOf(v2.CCRC_TESTBOX_REPORT_MAX!)), 2 * 3_600_000,
    ]);
    expect(cfg.listen).toEqual({ host: '127.0.0.12', port: 7420 });
    for (const l of cfg.lines.values()) expect(l.from, l.key).toBe('file');
  });
});

describe('(c) the run\'s spec carries the box file\'s worker count, TMPDIR and report cap (D-7451)', () => {
  it('specs/1 holds VITEST_MAX_WORKERS, TMPDIR and M from the box file', async () => {
    const recs = specRecords(await config(F.b));
    const v2 = V2();
    expect(recs).toContain(`EVITEST_MAX_WORKERS=${v2.CCRC_TESTBOX_WORKERS}`);
    expect(recs).toContain(`ETMPDIR=${v2.CCRC_TESTBOX_RUN_TMPDIR}`);
    expect(recs).toContain(`M${sizeOf(v2.CCRC_TESTBOX_REPORT_MAX!)}`);
    expect(recs).toContain(`U${v2.CCRC_TESTBOX_RUN_USER_PREFIX}1`);
    expect(recs.filter((r) => r.startsWith('D'))).toEqual([`D${path.join(v2.CCRC_TESTBOX_ROOT!, 'runs', '1', 'run')}`]);
  });
});

describe('(d) the tools unit\'s release base is the box file\'s, through _tb_release_base in file mode (D-7457)', () => {
  const NEXT = 'v0.0.2';
  async function syncOnce(b: Box): Promise<{ code: number; stderr: string }> {
    for (const h of [F.hosts.a, F.hosts.b, F.hosts.c]) h.log.length = 0;
    const tools = V2().CCRC_TESTBOX_TOOLS_DIR!;
    const cfg = await config(b);
    const spec = path.join(V2().CCRC_TESTBOX_ROOT!, 'specs', 'tools');
    writeFileSync(spec, encodeToolsSpec({
      toolsDir: tools, settings: toolsSettings(cfg.lines, durationMs), keep: [],
      frame: { t: 'tools.sync', release: NEXT, versions: { node: '22.1.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' }, measuredAt: '2026-10-30T00:00:00Z' },
    }));
    return exec(path.join(tools, 'release', 'installed', 'deploy', 'testbox', 'bin', 'tools-sync'), [spec], {
      PATH: process.env.PATH, HOME: b.home, LANG: 'C', TMPDIR: process.env.TMPDIR ?? '/tmp', TB_FIXTURE_ROOT: b.root, TB_FIXTURE_OWNER_UID: String(UID), ...F.env,
    });
  }
  const asked = (): [number, number, number] => [F.hosts.a.log.length, F.hosts.b.log.length, F.hosts.c.log.length];

  it('the sync asks the box file\'s release host for the release, and never the home file\'s or the environment\'s', async () => {
    const r = await syncOnce(F.b);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toMatch(/tool sync failed \(release: /);
    expect(F.hosts.a.log.some((p) => p.startsWith(`/releases/download/${NEXT}/`)), F.hosts.a.log.join(' ')).toBe(true);
    expect(asked().slice(1)).toEqual([0, 0]);
  });

  it.each([
    ['a release base read in environment mode (_upd_release_base with no mode)', 'BOX_ENV_FILE="$TB_BOX_ENV_FILE" _upd_release_base file >/dev/null', 'BOX_ENV_FILE="$TB_BOX_ENV_FILE" _upd_release_base >/dev/null'],
    ['a skipped assignment, so _upd_resolve\'s own read takes the environment\'s value', '  CCRC_RELEASE_BASE_URL="$KNOB"\n}', '  :\n}'],
  ])('mutation: %s asks the environment\'s host, and the row reds', async (_n, from, to) => {
    const f = path.join(installedTree(F.b), 'ccd', 'testbox-knobs');
    const text = readFileSync(f, 'utf8');
    expect(text.split(from).length, 'the mutation applies once').toBe(2);
    try {
      writeFileSync(f, text.replace(from, to));
      await syncOnce(F.b);
      expect(asked()[2], 'the environment\'s host was asked').toBeGreaterThan(0);
    } finally { writeFileSync(f, text); }
  });
});

describe('a change to the box file is applied by a re-run: one reload and one restart; an unchanged re-run does neither (D-7451, D-7568)', () => {
  it('the edited value reaches the drop-ins, the printer and the spec, with one daemon-reload and one restart; then nothing', async () => {
    const v = { ...V2(), CCRC_TESTBOX_RUN_MEMORY_MAX: '5G', CCRC_TESTBOX_WORKERS: '7', CCRC_TESTBOX_RUN_TMPDIR: '/tmp/r5' };
    writeFileSync(F.b.boxFile, envFile({ ...v, CCRC_RELEASE_BASE_URL: `http://127.0.0.1:${F.hosts.a.port}/releases` }));
    const n = sysLog(F.b).length;
    const r = await install(F.b, { staging: W.staging, env: F.env });
    expect(r.code, r.stderr).toBe(0);
    const calls = sysLog(F.b).slice(n).map((a) => a.join(' ')).filter((l) => l.startsWith('systemctl '));
    // nftables.service runs already, so its enable --now starts nothing (no flush); the load step reloads the file and
    // re-adds the running units' cgroups (D-7568), and the service restarts once.
    expect(calls).toEqual([
      'systemctl daemon-reload', 'systemctl enable --now nftables.service',
      ...['tailscaled', 'systemd-resolved', 'systemd-timesyncd', 'ccrc-testbox', 'ccrc-testbox-tools'].map((u) => `systemctl show -P ControlGroup ${u}.service`),
      'systemctl start --no-block ccrc-testbox-egress.service',
      'systemctl restart ccrc-testbox.service', 'systemctl start ccrc-testbox-egress.service',
    ]);
    expect(sysLog(F.b).slice(n).map((a) => a.join(' ')).filter((l) => l.startsWith('[nftables.service]'))).toEqual([]);
    expect(dropIns(F.b)).toEqual(expectedDropIns(v));
    expect((await printed(F.b)).get('CCRC_TESTBOX_WORKERS')).toEqual({ value: '7', from: 'file' });
    const recs = specRecords(await config(F.b));
    expect(recs).toContain('EVITEST_MAX_WORKERS=7');
    expect(recs).toContain('ETMPDIR=/tmp/r5');
    const m = sysLog(F.b).length;
    const again = await install(F.b, { staging: W.staging, env: F.env });
    expect(again.code, again.stderr).toBe(0);
    expect(sysLog(F.b).slice(m).map((a) => a[0])).toEqual(['findmnt', 'xfs_info']);
    expect(readFileSync(path.join(F.b.root, 'etc', 'ccrc-testbox', 'installed'), 'utf8')).toContain(`release\t${BOOT_TAG}\n`);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The censuses (D-7451, D-7457).
// ---------------------------------------------------------------------------------------------------------------

/** The code lines (not a comment) of every file under the three roots, `path: line`. */
function codeLines(): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      for (const l of readFileSync(p, 'utf8').split('\n')) if (!/^\s*(#|\/\/|\*|\/\*)/.test(l)) out.push(`${path.relative(REPO, p)}: ${l.trim()}`);
    }
  };
  for (const d of ['deploy/testbox', 'agent/src/testbox']) if (existsSync(path.join(REPO, d))) walk(path.join(REPO, d));
  for (const n of readdirSync(path.join(REPO, 'ccd')).filter((x) => x.startsWith('testbox-'))) {
    for (const l of readFileSync(path.join(REPO, 'ccd', n), 'utf8').split('\n')) if (!/^\s*#/.test(l)) out.push(`ccd/${n}: ${l.trim()}`);
  }
  return out;
}

describe('the censuses (D-7451, D-7457)', () => {
  it('no file under deploy/testbox/ has an EnvironmentFile= line', () => {
    expect(codeLines().filter((l) => l.startsWith('deploy/testbox/') && /: EnvironmentFile\s*=/.test(l))).toEqual([]);
  });

  it('no code line names .ccrc/ccrc.env, and BOX_ENV_FILE is assigned only by ccd/testbox-knobs\'s two per-call bindings', () => {
    const lines = codeLines();
    expect(lines.filter((l) => l.includes('.ccrc/ccrc.env'))).toEqual([]);
    expect(lines.filter((l) => /(^|[^A-Z_])BOX_ENV_FILE=/.test(l.slice(l.indexOf(': ') + 2)))).toEqual([
      'ccd/testbox-knobs: BOX_ENV_FILE="$f" _tb_box_table ;;',
      'ccd/testbox-knobs: if ! BOX_ENV_FILE="$TB_BOX_ENV_FILE" _upd_release_base file >/dev/null 2>&1; then',
    ]);
  });

  it('every _upd_release_base call passes file', () => {
    const calls = codeLines().filter((l) => (l.startsWith('deploy/testbox/') || l.startsWith('ccd/testbox-')) && /_upd_release_base\b/.test(l));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((l) => !/_upd_release_base file\b/.test(l))).toEqual([]);
  });

  it('the census reaches: it reads the installer and the tools script', () => {
    const files = new Set(codeLines().map((l) => l.slice(0, l.indexOf(': '))));
    expect(files.has('deploy/testbox/install.sh')).toBe(true);
    expect(files.has('deploy/testbox/bin/tools-sync')).toBe(true);
  });
});
