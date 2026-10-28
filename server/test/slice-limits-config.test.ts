// The session slice's aggregate limits come from the box's own config (D-7296).
//
// `deploy/systemd/app-claude-session.slice.d/limits.conf` is a TEMPLATE whose `MemoryMax=` and `MemorySwapMax=` are
// the defaults. Both lanes that place it on a box — `ccrc install`/`ccrc update` (`_inst_units`) and `deploy.sh agent`
// (AGENT_BUILD_CMD) — render it through ONE function in ccd/ccrc, `_inst_slice_limits`, which reads
// CCRC_SESSION_SLICE_MEMORY_MAX and CCRC_SESSION_SLICE_SWAP_MAX through ccrc's one settings reader (`_ccrc_knob`: the
// box's environment, else the box's ~/.ccrc/ccrc.env, else the default). A box that sets neither key renders the
// template's bytes exactly, so every box installed before this change keeps a byte-identical drop-in.
//
// Every bash run here is a FIXED driver: the code under test is read out of the repository and written to a driver
// file, and every path or value reaches it as an argument or through the environment, never spliced into a `-c` string.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, statSync, readdirSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';
import { describeLinux } from './platformFixtures.js';
import { freshBox, runInstall, unitDir, placed, SLICE_DIR as INSTALL_SLICE_DIR } from './ccrc-installFixture.js';

removeTmpFixturesEachTest();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_REL = 'deploy/systemd/app-claude-session.slice.d/limits.conf';
const TEMPLATE = join(REPO, TEMPLATE_REL);
const CCRC = join(REPO, 'ccd', 'ccrc');
const DEPLOY = readFileSync(join(REPO, 'deploy', 'deploy.sh'), 'utf8');
const SLICE_DIR = 'app-claude\\x2dsession.slice.d';
const KEYS = ['CCRC_SESSION_SLICE_MEMORY_MAX', 'CCRC_SESSION_SLICE_SWAP_MAX'] as const;

/** The template's bytes on origin/main when this file was written: the bytes every existing box carries. */
const TODAY_SHA256 = '7418950ae4aec4ef89f1b23eede2d3def9280f15d255f7ce67d43b3d45748771';

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** A clean environment: no setting leaks in from the developer's shell. */
function cleanEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, LC_ALL: 'C' };
  for (const k of KEYS) delete env[k];
  return { ...env, ...extra };
}

/** A box HOME whose `~/ccrc` is this repository (the rsynced tree deploy.sh's box-side half reads), and whose
 *  `~/.ccrc/ccrc.env` holds `envLines` when given. */
function box(envLines?: string[]): string {
  const home = mkTmp('slice-limits-');
  symlinkSync(REPO, join(home, 'ccrc'));
  if (envLines !== undefined) {
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), envLines.map((l) => `${l}\n`).join(''));
  }
  return home;
}

interface Ran { code: number; stdout: string; stderr: string }
const ran = (r: ReturnType<typeof spawnSync>): Ran =>
  ({ code: r.status ?? -1, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') });

/** deploy.sh's AGENT_BUILD_CMD, split the way deploy-verify.test.ts splits it. */
function agentBuildLinks(): { defs: string; links: string[] } {
  const m = /AGENT_BUILD_CMD='([\s\S]*?)'/.exec(DEPLOY);
  if (!m) throw new Error('deploy.sh has no single-quoted AGENT_BUILD_CMD');
  const body = m[1]!;
  const cut = body.indexOf('\ncd ~/ccrc/agent');
  if (cut < 0) throw new Error('AGENT_BUILD_CMD no longer starts its chain with `cd ~/ccrc/agent`');
  const links = body.slice(cut + 1).split('&&').map((s) => s.replace(/\\\s*$/, '').trim());
  return { defs: body.slice(0, cut), links };
}

/** The box-side half of `deploy.sh agent` that places the slice drop-in: its helper definitions, the two mkdir
 *  links and the one link that writes the slice's limits.conf, run ON THIS MACHINE with HOME = the fixture box. */
function runDeployLane(home: string, extra: Record<string, string> = {}): Ran {
  const { defs, links } = agentBuildLinks();
  const placing = links.filter((l) => l.includes(`${SLICE_DIR}/limits.conf`));
  if (placing.length !== 1) throw new Error(`expected one AGENT_BUILD_CMD link placing the slice limits.conf, found ${placing.length}`);
  const mkdirs = links.filter((l) => l.startsWith('mkdir -p ~/.config/systemd/user'));
  const driver = join(home, 'deploy-lane.sh');
  writeFileSync(driver, `${defs}\n${[...mkdirs, placing[0]!].join(' \\\n  && ')}\n`);
  return ran(spawnSync('bash', [driver], { encoding: 'utf8', cwd: home, env: cleanEnv(home, extra) }));
}

const deployed = (home: string): string => join(home, '.config', 'systemd', 'user', SLICE_DIR, 'limits.conf');

describe('characterization: what every box carries today', () => {
  it('the template is today\'s bytes: MemoryMax=24G, MemorySwapMax=6G, MemoryHigh=infinity, one [Slice]', () => {
    const b = readFileSync(TEMPLATE);
    expect(sha(b), 'the template changed: every existing box would render a different limits.conf').toBe(TODAY_SHA256);
    const directives = b.toString('utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    expect(directives).toEqual(['[Slice]', 'MemoryHigh=infinity', 'MemoryMax=24G', 'MemorySwapMax=6G']);
  });

  it('the deploy lane, with no ccrc.env on the box, places the template byte for byte at 644', () => {
    const home = box();
    const r = runDeployLane(home);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(readFileSync(deployed(home)))).toBe(TODAY_SHA256);
    expect(statSync(deployed(home)).mode & 0o777).toBe(0o644);
    expect(readdirSync(path.dirname(deployed(home))), 'no staging file is left beside it').toEqual(['limits.conf']);
  });

  it('the deploy lane, with a ccrc.env that sets neither key, places the template byte for byte', () => {
    const home = box(['CCRC_HOST=127.0.0.1', 'CCRC_ROLE=fleet']);
    const r = runDeployLane(home);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(readFileSync(deployed(home)))).toBe(TODAY_SHA256);
  });
});

// ── the new behaviour: the two keys, read on the box, rendered by one function ──────────────────────────────────────

/** The fixed driver for the ccrc lane's function: source ccd/ccrc (its dispatch is guarded by BASH_SOURCE, so sourcing
 *  runs nothing else), then call `_inst_slice_limits <template> <dest>`. Paths arrive as arguments. */
function runFunction(home: string, extra: Record<string, string> = {}, installed?: string): Ran & { dest: string } {
  const driver = join(home, 'fn-driver.sh');
  writeFileSync(driver, '. "$1" || exit 97\nshift\n_inst_slice_limits "$@"\n');
  const dir = join(home, '.config', 'systemd', 'user', SLICE_DIR);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, 'limits.conf');
  if (installed !== undefined) writeFileSync(dest, installed, { mode: 0o644 });
  return { ...ran(spawnSync('bash', [driver, CCRC, TEMPLATE, dest], { encoding: 'utf8', cwd: home, env: cleanEnv(home, extra) })), dest };
}

/** The template with its two values replaced: what a box that sets them must carry, every other byte unchanged. */
function expected(memoryMax: string, swapMax: string): string {
  const t = readFileSync(TEMPLATE, 'utf8');
  const out = t.replace(/^MemoryMax=24G$/m, `MemoryMax=${memoryMax}`).replace(/^MemorySwapMax=6G$/m, `MemorySwapMax=${swapMax}`);
  if (memoryMax !== '24G' && out === t) throw new Error('the template no longer carries MemoryMax=24G');
  return out;
}

describe('_inst_slice_limits renders the template from the box\'s config (D-7296)', () => {
  it('unset keys: today\'s bytes, at 644, no staging file left', () => {
    const home = box(['CCRC_ROLE=fleet']);
    const r = runFunction(home);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(readFileSync(r.dest))).toBe(TODAY_SHA256);
    expect(statSync(r.dest).mode & 0o777).toBe(0o644);
    expect(readdirSync(path.dirname(r.dest))).toEqual(['limits.conf']);
    expect(r.stderr).toBe('');
  });

  it('no ccrc.env at all: today\'s bytes', () => {
    const home = box();
    const r = runFunction(home);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(readFileSync(r.dest))).toBe(TODAY_SHA256);
  });

  it('empty values (`KEY=`) read the default: today\'s bytes', () => {
    const home = box(['CCRC_SESSION_SLICE_MEMORY_MAX=', 'CCRC_SESSION_SLICE_SWAP_MAX=']);
    const r = runFunction(home);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(readFileSync(r.dest))).toBe(TODAY_SHA256);
  });

  // The floors' own edges are taken: MemoryMax at least 1G however it is spelled, MemorySwapMax 0 or at least 1M.
  for (const [mm, sm] of [['48G', '8G'], ['90%', '0'], ['49152M', '12G'], ['100%', '16384M'], ['64G', '6G'], ['24G', '2T'],
    ['1G', '1M'], ['1048576K', '1024K'], ['1073741824', '1048576'], ['1%', '0']] as const) {
    it(`ccrc.env sets MemoryMax=${mm}, MemorySwapMax=${sm}: those values, every other byte the template's`, () => {
      const home = box(['CCRC_ROLE=fleet', `CCRC_SESSION_SLICE_MEMORY_MAX=${mm}`, `CCRC_SESSION_SLICE_SWAP_MAX=${sm}`]);
      const r = runFunction(home);
      expect(r.code, r.stderr).toBe(0);
      expect(readFileSync(r.dest, 'utf8')).toBe(expected(mm, sm));
      expect(r.stderr).toBe('');
    });
  }

  it('one key set, the other unset: the set one changes, the other keeps its default', () => {
    const home = box(['CCRC_SESSION_SLICE_MEMORY_MAX=40G']);
    const r = runFunction(home);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(r.dest, 'utf8')).toBe(expected('40G', '6G'));
  });

  it('the environment wins over ccrc.env, as for every ccrc setting', () => {
    const home = box(['CCRC_SESSION_SLICE_MEMORY_MAX=40G', 'CCRC_SESSION_SLICE_SWAP_MAX=4G']);
    const r = runFunction(home, { CCRC_SESSION_SLICE_MEMORY_MAX: '56G' });
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(r.dest, 'utf8')).toBe(expected('56G', '4G'));
  });

  // With nothing installed yet, garbage keeps the default and WARNs, naming the key, the value and the default; the run still succeeds, so a
  // typo never stops an install or a deploy, and never reaches systemd.
  // A suffix-less whole number is BYTES to systemd, so `24` or `90` (a typo for 90%) is a ceiling of a few bytes: the
  // next install, update or deploy would OOM-kill every pane, exactly what refusing 0 is for. MemoryMax is at least 1G.
  const MEMORY_GARBAGE = ['lots', '24GB', '24g', '-1G', '0', '0G', '24 G', 'infinity', '1.5G', '0%', '101%', '24G;', '1Z', '0024G',
    '24', '90', '1', '512M', '1048575K', '1073741823'];
  for (const bad of MEMORY_GARBAGE) {
    it(`CCRC_SESSION_SLICE_MEMORY_MAX=${JSON.stringify(bad)} keeps MemoryMax=24G and warns`, () => {
      // The other key through the environment: on macOS a line bash would read differently (`24 G`) makes the
      // settings reader refuse the whole file (model-wide, by design), and this row is about the one key.
      const home = box([`CCRC_SESSION_SLICE_MEMORY_MAX=${bad}`]);
      const r = runFunction(home, { CCRC_SESSION_SLICE_SWAP_MAX: '8G' });
      expect(r.code, r.stderr).toBe(0);
      expect(readFileSync(r.dest, 'utf8')).toBe(expected('24G', '8G'));
      const warn = r.stderr.split('\n').filter((l) => l.includes('CCRC_SESSION_SLICE_MEMORY_MAX'));
      expect(warn, r.stderr).toHaveLength(1);
      expect(warn[0]).toMatch(/WARN/);
      expect(warn[0]).toContain('MemoryMax=24G');
    });
  }
  // The swap ceiling's floor is lower (a small swap allowance is a real choice) but a bare `6` is six bytes, not 6G.
  const SWAP_GARBAGE = ['none', '6GB', '-6G', '50%', 'infinity', '6 G', '0.5G', '6', '1', '1023K', '1048575'];
  for (const bad of SWAP_GARBAGE) {
    it(`CCRC_SESSION_SLICE_SWAP_MAX=${JSON.stringify(bad)} keeps MemorySwapMax=6G and warns`, () => {
      const home = box([`CCRC_SESSION_SLICE_SWAP_MAX=${bad}`]);
      const r = runFunction(home, { CCRC_SESSION_SLICE_MEMORY_MAX: '48G' });
      expect(r.code, r.stderr).toBe(0);
      expect(readFileSync(r.dest, 'utf8')).toBe(expected('48G', '6G'));
      const warn = r.stderr.split('\n').filter((l) => l.includes('CCRC_SESSION_SLICE_SWAP_MAX'));
      expect(warn, r.stderr).toHaveLength(1);
      expect(warn[0]).toMatch(/WARN/);
      expect(warn[0]).toContain('MemorySwapMax=6G');
    });
  }

  it('garbage from the environment keeps the default and the WARN says where it came from', () => {
    const home = box(['CCRC_SESSION_SLICE_SWAP_MAX=8G']);
    const r = runFunction(home, { CCRC_SESSION_SLICE_MEMORY_MAX: '24GiB' });
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(r.dest, 'utf8')).toBe(expected('24G', '8G'));
    expect(r.stderr).toMatch(/WARN: CCRC_SESSION_SLICE_MEMORY_MAX='24GiB' \(from the environment\)/);
  });

  it('garbage from ccrc.env says the file, never the environment', () => {
    const home = box(['CCRC_SESSION_SLICE_SWAP_MAX=6GB']);
    const r = runFunction(home);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/WARN: CCRC_SESSION_SLICE_SWAP_MAX='6GB' \(from ~\/\.ccrc\/ccrc\.env\)/);
  });

  it('a ccrc.env line the settings reader refuses keeps the default and warns with the reader\'s own reason', () => {
    const home = box(['export CCRC_SESSION_SLICE_MEMORY_MAX=48G']);
    const r = runFunction(home);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(readFileSync(r.dest))).toBe(TODAY_SHA256);
    expect(r.stderr).toMatch(/WARN.*CCRC_SESSION_SLICE_MEMORY_MAX cannot be measured/);
  });

  it('a template without exactly one of each line is refused, and nothing is written', () => {
    const home = box();
    const bad = join(home, 'bad.conf');
    writeFileSync(bad, '[Slice]\nMemoryHigh=infinity\nMemoryMax=24G\n');
    const driver = join(home, 'fn-driver.sh');
    writeFileSync(driver, '. "$1" || exit 97\nshift\n_inst_slice_limits "$@"\n');
    const dest = join(home, 'out.conf');
    const r = ran(spawnSync('bash', [driver, CCRC, bad, dest], { encoding: 'utf8', cwd: home, env: cleanEnv(home) }));
    expect(r.code).not.toBe(0);
    expect(existsSync(dest)).toBe(false);
    expect(readdirSync(home).filter((n) => n.startsWith('out.conf'))).toEqual([]);
  });

  it('the defaults it reads with are the template\'s own values, so unset renders the template', () => {
    const code = readFileSync(CCRC, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const knob = (k: string): string[] => [...code.matchAll(new RegExp(`_ccrc_knob ${k} ([^\\s;]+)`, 'g'))].map((m) => m[1]!);
    expect(knob('CCRC_SESSION_SLICE_MEMORY_MAX')).toEqual(['24G']);
    expect(knob('CCRC_SESSION_SLICE_SWAP_MAX')).toEqual(['6G']);
  });
});

// ── a value it cannot use never SHRINKS a box: it keeps what is installed (D-7296) ───────────────────
// A box tuned above the default (the case the keys exist for: 90% on a box that runs nothing but the fleet) must not
// fall to 24G on one typo: daemon-reload would apply the lower memory.max to the live slice, and with more than 24G in
// use the kernel reclaims and OOM-kills panes across the fleet. So the fallback is the value the rendered drop-in at
// <dest> already carries, and the template's default only when nothing usable is installed yet. A key that is UNSET
// (or `KEY=`) is not a fallback: it is the box choosing the default, and it renders the default.
describe('_inst_slice_limits keeps the installed value when the configured one cannot be used', () => {
  const TUNED = (): string => expected('90%', '12G');

  for (const bad of ['90 %', '1.5G', '90g', '24', 'lots']) {
    it(`installed MemoryMax=90%, ccrc.env CCRC_SESSION_SLICE_MEMORY_MAX=${JSON.stringify(bad)}: the drop-in is unchanged, and it warns`, () => {
      const home = box([`CCRC_SESSION_SLICE_MEMORY_MAX=${bad}`]);
      const r = runFunction(home, { CCRC_SESSION_SLICE_SWAP_MAX: '12G' }, TUNED());
      expect(r.code, r.stderr).toBe(0);
      expect(readFileSync(r.dest, 'utf8')).toBe(TUNED());
      const warn = r.stderr.split('\n').filter((l) => l.includes('CCRC_SESSION_SLICE_MEMORY_MAX'));
      expect(warn, r.stderr).toHaveLength(1);
      expect(warn[0]).toMatch(/WARN/);
      expect(warn[0]).toContain('MemoryMax=90%');
      expect(warn[0]).not.toContain('MemoryMax=24G');
    });
  }

  it('installed MemorySwapMax=12G, garbage swap key: the swap line is unchanged, and it warns', () => {
    const home = box(['CCRC_SESSION_SLICE_SWAP_MAX=6GB']);
    const r = runFunction(home, { CCRC_SESSION_SLICE_MEMORY_MAX: '90%' }, TUNED());
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(r.dest, 'utf8')).toBe(TUNED());
    expect(r.stderr).toMatch(/WARN.*CCRC_SESSION_SLICE_SWAP_MAX.*MemorySwapMax=12G/);
  });

  it('a NUL byte anywhere in ccrc.env (the reader refuses the file): both installed lines are kept', () => {
    const home = box();
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), Buffer.from('CCRC_SESSION_SLICE_MEMORY_MAX=90%\nCCRC_SESSION_SLICE_SWAP_MAX=12G\nX=\0\n'));
    const r = runFunction(home, {}, TUNED());
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(r.dest, 'utf8')).toBe(TUNED());
    expect(r.stderr).toMatch(/WARN.*MemoryMax=90%/);
    expect(r.stderr).toMatch(/WARN.*MemorySwapMax=12G/);
  });

  it('a line the reader refuses (`export KEY=...`) keeps the installed value too', () => {
    const home = box(['export CCRC_SESSION_SLICE_MEMORY_MAX=90%']);
    const r = runFunction(home, { CCRC_SESSION_SLICE_SWAP_MAX: '12G' }, TUNED());
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(r.dest, 'utf8')).toBe(TUNED());
  });

  it('an UNSET key is the box choosing the default: installed 90% renders 24G, without a warning', () => {
    const home = box(['CCRC_ROLE=fleet']);
    const r = runFunction(home, {}, TUNED());
    expect(r.code, r.stderr).toBe(0);
    expect(sha(readFileSync(r.dest))).toBe(TODAY_SHA256);
    expect(r.stderr).toBe('');
  });

  it('an installed value this renderer would itself refuse is not kept: garbage falls to the default', () => {
    const home = box(['CCRC_SESSION_SLICE_MEMORY_MAX=lots']);
    const r = runFunction(home, { CCRC_SESSION_SLICE_SWAP_MAX: '12G' }, expected('24', '12G'));
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(r.dest, 'utf8')).toBe(expected('24G', '12G'));
    expect(r.stderr).toMatch(/WARN.*MemoryMax=24G/);
  });

  it('an installed drop-in with two MemoryMax lines is not read: garbage falls to the default', () => {
    const home = box(['CCRC_SESSION_SLICE_MEMORY_MAX=lots']);
    const r = runFunction(home, { CCRC_SESSION_SLICE_SWAP_MAX: '12G' }, `${TUNED()}MemoryMax=48G\n`);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(r.dest, 'utf8')).toBe(expected('24G', '12G'));
  });

  it('the deploy lane keeps the installed value on garbage, the same as the ccrc lane', () => {
    const home = box(['CCRC_SESSION_SLICE_MEMORY_MAX=90 %', 'CCRC_SESSION_SLICE_SWAP_MAX=12G']);
    mkdirSync(path.dirname(deployed(home)), { recursive: true });
    writeFileSync(deployed(home), TUNED(), { mode: 0o644 });
    const r = runDeployLane(home);
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(deployed(home), 'utf8')).toBe(TUNED());
    expect(r.stderr).toMatch(/WARN.*MemoryMax=90%/);
  });
});

describe('both lanes render through the one function', () => {
  it('_inst_units places the slice limits.conf through _inst_slice_limits, never a verbatim _inst_atomic copy', () => {
    const src = readFileSync(CCRC, 'utf8');
    const body = /\n_inst_units\(\) \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
    const code = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code.match(/_inst_slice_limits "\$tree\/deploy\/systemd\/app-claude-session\.slice\.d\/limits\.conf" \\?\s*"\$slice\/limits\.conf"/g) ?? [])
      .toHaveLength(1);
    expect(code).not.toMatch(/_inst_atomic "\$tree\/deploy\/systemd\/app-claude-session\.slice\.d\/limits\.conf"/);
  });

  it('deploy.sh\'s box-side half sources the shipped ccd/ccrc and calls the same function; no _unit_atomic copy remains', () => {
    const { defs, links } = agentBuildLinks();
    expect(links.filter((l) => /^_unit_atomic \S*app-claude-session\.slice\.d\/limits\.conf/.test(l))).toEqual([]);
    expect(defs).toContain('_inst_slice_limits');
    expect(defs).toContain('~/ccrc/ccd/ccrc');
  });

  for (const [mm, sm] of [['48G', '8G'], ['90%', '0']] as const) {
    it(`the deploy lane and the function render the same bytes for MemoryMax=${mm}, MemorySwapMax=${sm}`, () => {
      const lines = [`CCRC_SESSION_SLICE_MEMORY_MAX=${mm}`, `CCRC_SESSION_SLICE_SWAP_MAX=${sm}`];
      const a = box(lines);
      const d = runDeployLane(a);
      expect(d.code, d.stderr).toBe(0);
      const b = box(lines);
      const f = runFunction(b);
      expect(f.code, f.stderr).toBe(0);
      expect(readFileSync(deployed(a), 'utf8')).toBe(expected(mm, sm));
      expect(readFileSync(deployed(a))).toEqual(readFileSync(f.dest));
    });
  }

  it('the deploy lane keeps the default and warns on garbage, and the deploy step still succeeds', () => {
    const home = box(['CCRC_SESSION_SLICE_MEMORY_MAX=lots']);
    const r = runDeployLane(home);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(readFileSync(deployed(home)))).toBe(TODAY_SHA256);
    expect(r.stderr).toMatch(/WARN.*CCRC_SESSION_SLICE_MEMORY_MAX/);
  });
});

// The ccrc lane end to end: `ccrc install` on a fixture box, its `_inst_units` systemd arm placing the slice drop-in.
// systemd's arm only (macOS has no slice), so Linux CI measures it; the unset-keys case is ccrc-install-units.test.ts's
// byte-for-byte row over every unit file.
describeLinux('ccrc install renders the slice drop-in from the box\'s config', () => {
  const rendered = (home: string): string => readFileSync(unitDir(home, INSTALL_SLICE_DIR, 'limits.conf'), 'utf8');
  const template = (home: string): string => readFileSync(placed(home, ...TEMPLATE_REL.split('/')), 'utf8');

  it('the keys in the box\'s ccrc.env reach the placed limits.conf', () => {
    const home = freshBox('slice-limits-install-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), [
      'CCRC_HOST=127.0.0.1', 'CCRC_PORT=7788', 'CCRC_FLEET=local', `CCRC_PROJECTS_ROOT=${home}/projects`, 'CCRC_ROLE=both',
      'CCRC_SESSION_SLICE_MEMORY_MAX=48G', 'CCRC_SESSION_SLICE_SWAP_MAX=8G', '',
    ].join('\n'));
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(rendered(home)).toBe(template(home).replace(/^MemoryMax=24G$/m, 'MemoryMax=48G').replace(/^MemorySwapMax=6G$/m, 'MemorySwapMax=8G'));
    expect(statSync(unitDir(home, INSTALL_SLICE_DIR, 'limits.conf')).mode & 0o777).toBe(0o644);
  });

  it('garbage in ccrc.env keeps the default, warns, and the install still succeeds', () => {
    const home = freshBox('slice-limits-install-bad-');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'ccrc.env'), [
      'CCRC_HOST=127.0.0.1', 'CCRC_PORT=7788', 'CCRC_FLEET=local', `CCRC_PROJECTS_ROOT=${home}/projects`, 'CCRC_ROLE=both',
      'CCRC_SESSION_SLICE_MEMORY_MAX=lots', '',
    ].join('\n'));
    const r = runInstall(home);
    expect(r.code, r.stderr).toBe(0);
    expect(sha(Buffer.from(rendered(home)))).toBe(TODAY_SHA256);
    expect(r.stderr).toMatch(/WARN: CCRC_SESSION_SLICE_MEMORY_MAX='lots'/);
  });
});
