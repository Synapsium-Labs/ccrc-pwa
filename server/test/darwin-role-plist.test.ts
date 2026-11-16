// macOS: each role's launchd job carries its own label AND its own entry point (D-8388).
//
// `ccrc install`'s Darwin arm (`_inst_units_darwin`, `ccd/ccrc`) picks the job's label from the role
// (`app.ccrc.ccrc`, or `app.ccrc.ccrc-agent` on a fleet box) and asks `_inst_plist_server` for the bytes. The
// generator used to write the server's launch line whatever the role, so a fleet box got a job named for the agent
// that ran the server, and read ccrc.env rather than the agent's required agent.env. The Linux units are the
// reference: deploy/ccrc.service and deploy/ccrc-agent.service, read here for their ExecStart and EnvironmentFile.
//
// The generator and the units step are portable bash, so every case runs on every leg with CCD_OS forced to darwin;
// only `plutil -lint` needs a Mac.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghContainedEnv, seedAccountsSh } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const IS_DARWIN = process.platform === 'darwin';

const box = (): string => {
  const home = mkTmp('ccrc-role-plist-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  seedAccountsSh(home);
  return home;
};

/** Source ccrc under `home` (contained: no real gh, systemd, tmux or network) and run `expr`. */
const run = (home: string, expr: string) => {
  // A constant script: the file and the expression arrive as arguments, never spliced into the command.
  const r = spawnSync('bash', ['-c', 'f=$1; e=$2; set --; source "$f" >/dev/null 2>&1; eval "$e"', 'x', CCRC, expr], {
    encoding: 'utf8', env: ghContainedEnv(home, { PATH: process.env.PATH ?? '', HOME: home }, { systemd: true, tmux: true, net: true }),
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

/** The shipped Linux unit's ExecStart entry and its EnvironmentFile lines, `%h` read as `home`. */
const unit = (name: string, home: string): { entry: string; envFiles: { path: string; optional: boolean }[] } => {
  const src = readFileSync(join(REPO, 'deploy', name), 'utf8');
  const exec = /^ExecStart=\/usr\/bin\/env node (\S+)$/m.exec(src);
  if (exec === null) throw new Error(`deploy/${name} has no ExecStart in the shape this test reads`);
  const envFiles = [...src.matchAll(/^EnvironmentFile=(-?)(\S+)$/gm)]
    .map((m) => ({ path: m[2]!.replace('%h', home), optional: m[1] === '-' }));
  return { entry: exec[1]!.replace('%h', home), envFiles };
};

/** The `-c` command string of a generated plist: the third ProgramArguments string. */
const launchLine = (plist: string): string => {
  const m = /<key>ProgramArguments<\/key>\s*<array>\s*<string>\/bin\/bash<\/string>\s*<string>-c<\/string>\s*<string>([^<]*)<\/string>/.exec(plist);
  if (m === null) throw new Error(`the plist has no /bin/bash -c launch line:\n${plist}`);
  return m[1]!;
};

describe('the launchd job each role installs (D-8388)', () => {
  it.each([
    ['both', 'ccrc.service', 'app.ccrc.ccrc'],
    ['server', 'ccrc.service', 'app.ccrc.ccrc'],
    ['fleet', 'ccrc-agent.service', 'app.ccrc.ccrc-agent'],
  ] as const)('--role %s: the job is %s\'s, by label, entry point and env files', (role, unitName, label) => {
    const home = box();
    const r = run(home, `CCD_OS=darwin; BOX_UNIT_DIR="$HOME/Library/LaunchAgents"; INST_ROLE=${role}; _inst_units_darwin`);
    expect(r.code, r.stderr).toBe(0);
    const dir = join(home, 'Library', 'LaunchAgents');
    expect(readdirSync(dir)).toEqual([`${label}.plist`]);
    const plist = readFileSync(join(dir, `${label}.plist`), 'utf8');
    expect(plist).toContain(`<key>Label</key><string>${label}</string>`);
    if (IS_DARWIN) expect(spawnSync('plutil', ['-lint', join(dir, `${label}.plist`)]).status).toBe(0);

    const want = unit(unitName, home);
    const other = unit(unitName === 'ccrc.service' ? 'ccrc-agent.service' : 'ccrc.service', home);
    const line = launchLine(plist);
    expect(line, `the ${label} job does not exec its own entry point`).toMatch(new RegExp(`exec /usr/bin/env node '${want.entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`));
    expect(line, `the ${label} job names the other role's entry point`).not.toContain(other.entry);
    // Each EnvironmentFile, in order: an optional one is guarded by `[ -f ]`, a required one stops the job when absent.
    let at = -1;
    for (const f of want.envFiles) {
      const i = line.indexOf(`. '${f.path}'`);
      expect(i, `the ${label} job never reads ${f.path}`).toBeGreaterThan(at);
      at = i;
      if (f.optional) expect(line).toContain(`[ -f '${f.path}' ] &amp;&amp; . '${f.path}'`);
      else expect(line).toContain(`. '${f.path}' || exit 1`);
    }
    for (const f of other.envFiles.filter((o) => !want.envFiles.some((w) => w.path === o.path))) {
      expect(line, `the ${label} job reads the other role's ${f.path}`).not.toContain(f.path);
    }
  });

  it('a fleet job whose agent.env is gone exits instead of starting the agent unconfigured, as systemd refuses a missing required EnvironmentFile', () => {
    const home = box();
    const r = run(home, 'CCD_OS=darwin; _inst_plist_server app.ccrc.ccrc-agent "$HOME/agent.log" fleet');
    expect(r.code, r.stderr).toBe(0);
    // `&amp;` is the XML spelling the plist parser turns back into `&`; run the line as launchd would, with node
    // replaced by a marker so nothing starts.
    const cmd = launchLine(r.stdout).replaceAll('&amp;', '&').replace(/exec \/usr\/bin\/env node .*$/, 'echo started');
    const s = spawnSync('bash', ['-c', cmd], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: home } });
    expect(s.status).not.toBe(0);
    expect(s.stdout).not.toContain('started');
  });
});
