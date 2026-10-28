// The session slice's aggregate limits come from the box's own config (D-TBD-slice-limits-keys).
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
