import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { runImpl } from './ccdTwin.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-core-caps-'); });
afterEach(() => h.cleanup());

const timer = () => path.join(h.home, '.config', 'systemd', 'user', 'ccd-pool-sync.timer');
const platform = ({ win32: 'windows', linux: 'linux', darwin: 'darwin' } as Record<string, string>)[process.platform];
const table = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../core/entries.json'), 'utf8')).entries as
  Record<string, { mode?: Record<string, string> }>;
const goVerbs = Object.keys(table).filter((v) => v !== 'hook' && table[v].mode?.[platform] === 'go');   // the hook row is a mode, never go:hook
// Where a verb is in go mode the core adds one go:<verb> line per such verb after the body's list; elsewhere it is bash's, byte for byte.
const expectedOut = (bashOut: string) => bashOut + goVerbs.map((v) => `go:${v}\n`).join('');

describe.skipIf(process.platform === 'darwin')('ccd caps: the Go core answers as the bash body does', () => {
  it('pool-sync absent: byte-identical stdout, status 0', () => {
    const b = runImpl(h, 'bash', ['caps']);
    const n = runImpl(h, 'go', ['caps']);
    expect(b.status).toBe(0);
    expect(n.status).toBe(0);
    expect(n.stderr).toBe(b.stderr);
    expect(n.stdout).toBe(expectedOut(b.stdout));
    expect(n.stdout).toContain('\npool-sync-absent\n');
  });
  it('pool-sync installed: byte-identical stdout, status 0', () => {
    fs.mkdirSync(path.dirname(timer()), { recursive: true });
    fs.writeFileSync(timer(), '');
    const b = runImpl(h, 'bash', ['caps']);
    const n = runImpl(h, 'go', ['caps']);
    expect(n.status).toBe(0);
    expect(n.stderr).toBe(b.stderr);
    expect(n.stdout).toBe(expectedOut(b.stdout));
    expect(b.stdout).toContain('\npool-sync-installed\n');
  });
  it('a directory at the timer path is not an installed timer, as bash\'s [ -f ] reads it', () => {
    fs.mkdirSync(timer(), { recursive: true });
    const b = runImpl(h, 'bash', ['caps']);
    const n = runImpl(h, 'go', ['caps']);
    expect(b.stdout).toContain('\npool-sync-absent\n');
    expect(n.status).toBe(0);
    expect(n.stdout).toBe(expectedOut(b.stdout));
  });
  // Bash dies at its module top level when the roster is not there, before any verb runs: the core refuses the same
  // way, the same line on stderr and the same status. Each rung of bash's ladder, and the order against the verb's usage.
  const roster = () => path.join(h.home, '.ccrc', 'accounts.sh');
  const sameRefusal = (argv: string[], says: RegExp) => {
    const b = runImpl(h, 'bash', argv);
    expect(b.status, b.stderr).toBe(1);
    expect(b.stderr).toMatch(says);
    expect(runImpl(h, 'go', argv)).toEqual(b);
  };
  it('no roster: refused as bash refuses it, before the verb\'s own usage check', () => {
    fs.rmSync(roster());
    sameRefusal(['caps'], /^ccd: no account roster at .*\.ccrc\/accounts\.sh — /);
    sameRefusal(['caps', '--json'], /^ccd: no account roster at /);
  });
  it('a directory at the roster\'s path: refused as not a regular file', () => {
    fs.rmSync(roster());
    fs.mkdirSync(roster());
    sameRefusal(['caps'], /^ccd: account roster .* exists but is not a regular file — /);
  });
  // chmod 000 denies nothing on Windows or to root, so the rung is measured only where it bites.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('an unreadable roster: refused as not readable, naming the user', () => {
    fs.chmodSync(roster(), 0o000);
    try {
      sameRefusal(['caps'], /^ccd: account roster .* exists but is not readable by \S+ — /);
    } finally { fs.chmodSync(roster(), 0o644); }
  });
  it('an argument is refused the same way', () => {
    const b = runImpl(h, 'bash', ['caps', '--json']);
    expect(b.status).toBe(1);
    expect(runImpl(h, 'go', ['caps', '--json'])).toEqual(b);
  });
});
