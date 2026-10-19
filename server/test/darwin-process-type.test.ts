// macOS: the launchd class (`ProcessType`) the server job carries — the first word of ~/.ccrc/launchd-class, Background by default.
//
// Background is launchd's lowest CPU and I/O class, and on a box busy with other
// work it starves rather than slows: measured on a busy fleet box, the server's
// own job took minutes to reach `listen` while a hand-started copy answered
// /health in seconds, so every `ccrc update` health gate failed and restored.
// The helper and the three plist writers are portable bash, so every case below
// runs on every leg with CCD_OS forced to darwin; only `plutil` needs a Mac.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghContainedEnv, seedAccountsSh } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CCRC = join(REPO, 'ccd', 'ccrc');
const IS_DARWIN = process.platform === 'darwin';

/** A fixture HOME with a roster (ccd will not load without one) and, when
 *  given, a ~/.ccrc/launchd-class holding exactly `cls`. */
const box = (cls: string | null): string => {
  const home = mkTmp('ccrc-ptype-');
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  seedAccountsSh(home);
  if (cls !== null) writeFileSync(join(home, '.ccrc', 'launchd-class'), cls);
  return home;
};

/** Source `file` under `home` (contained: no real gh, systemd, tmux or network) and run `expr`. */
const run = (file: string, home: string, expr: string) => {
  // A constant script: the file and the expression arrive as arguments, never spliced into the command.
  const r = spawnSync('bash', ['-c', 'f=$1; e=$2; set --; source "$f" >/dev/null 2>&1; eval "$e"', 'x', file, expr], {
    encoding: 'utf8', env: ghContainedEnv(home, { PATH: process.env.PATH ?? '', HOME: home }, { systemd: true, tmux: true, net: true }),
  });
  return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
};

describe.each([['ccrc', CCRC]])('_launchd_class in %s', (_name, file) => {
  it.each([
    ['no file', null, 'Background'],
    ['an empty file', '', 'Background'],
    ['Standard', 'Standard\n', 'Standard'],
    ['Adaptive, no newline', 'Adaptive', 'Adaptive'],
    ['Interactive with CRLF', 'Interactive\r\n', 'Interactive'],
    ['a padded word and a trailing note', '  Standard   # chosen for the busy box\n', 'Standard'],
    ['only the first line counts', 'Standard\nInteractive\n', 'Standard'],
  ] as const)('%s -> its class', (_label, cls, want) => {
    expect(run(file, box(cls), '_launchd_class').stdout).toBe(want);
  });

  it('an unknown word is named on stderr and reads as Background', () => {
    const r = run(file, box('Turbo\n'), '_launchd_class');
    expect(r.stdout).toBe('Background');
    expect(r.stderr).toContain("names 'Turbo'");
  });

  it('nothing from the file can reach the output: a markup payload reads as Background', () => {
    expect(run(file, box('X</string><key>Y</key><string>Z\n'), '_launchd_class').stdout).toBe('Background');
  });
});

describe('the jobs carry the chosen class', () => {
  const procType = (plist: string): string | null =>
    /<key>ProcessType<\/key><string>([A-Za-z]+)<\/string>/.exec(plist)?.[1] ?? null;
  const lint = (p: string): void => {
    if (IS_DARWIN) expect(spawnSync('plutil', ['-lint', p]).status, `plutil rejects ${p}`).toBe(0);
  };

  it('the server plist', () => {
    for (const [cls, want] of [[null, 'Background'], ['Standard\n', 'Standard']] as const) {
      const home = box(cls);
      const r = run(CCRC, home, 'CCD_OS=darwin; _inst_plist_server app.ccrc.ccrc "$HOME/.ccrc/logs/app.ccrc.ccrc.log"');
      expect(r.code, r.stderr).toBe(0);
      expect(procType(r.stdout)).toBe(want);
    }
  });
});
