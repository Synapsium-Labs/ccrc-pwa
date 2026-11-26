// The insecure-origin reason's copy line, run (desktop-polish wave 181; review run 3901 F3, A5, A8). The Add account
// door offers `ORIGIN_READ` (`pwa/src/fleet/accountWords.ts`) on a box whose origin is plain HTTP. It must show what a
// person needs to see there, the four keys that set the origin, arm the gate and loosen the cookie, from BOTH files the
// server unit reads (the later file, exposure.env, wins), each line with its file and an indented line included; and it
// must print no secret, change nothing, and stay quiet about a file that is not there. The literal is read from the
// source by its AST, so the command run here is the one the console offers, byte for byte. Fixture HOMEs only.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ts } from './scan/parse.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const ROOT = path.resolve(__dirname, '../..');
const WORDS = path.join(ROOT, 'pwa', 'src', 'fleet', 'accountWords.ts');

/** The `ORIGIN_READ` literal, read from the console's source. */
function originRead(): string {
  const sf = ts.createSourceFile(WORDS, readFileSync(WORDS, 'utf8'), ts.ScriptTarget.Latest, true);
  let out: string | null = null;
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'ORIGIN_READ' && n.initializer !== undefined
      && ts.isStringLiteral(n.initializer)) out = n.initializer.text;
    n.forEachChild(visit);
  };
  visit(sf);
  if (out === null) throw new Error('accountWords.ts has no ORIGIN_READ string literal');
  return out;
}
const CMD = originRead();

const md5 = (f: string): string => createHash('md5').update(readFileSync(f)).digest('hex');
const run = (home: string): { out: string; err: string; code: number | null } => {
  const r = spawnSync('bash', ['-c', CMD], { env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, encoding: 'utf8' });
  return { out: r.stdout, err: r.stderr, code: r.status };
};

// Canary values: a line that prints one is a leak.
const SECRET_LINES = [
  'CCRC_AUTH_SECRET_PATH=/home/op/.ccrc/auth.scrypt-canary-path',
  'CCRC_AGENT_TOKEN=agent-token-canary-0123456789',
  'CCRC_DDNS_TOKEN=ddns-token-canary-0123456789',
  'CCRC_AUTH_TOKEN=auth-token-canary-0123456789',
];

function box(env: string | null, exposure: string | null): { home: string; files: string[] } {
  const home = mkTmp('door-origin-read-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  const files: string[] = [];
  if (env !== null) { const f = path.join(home, '.ccrc', 'ccrc.env'); writeFileSync(f, env); files.push(f); }
  if (exposure !== null) { const f = path.join(home, '.ccrc', 'exposure.env'); writeFileSync(f, exposure); files.push(f); }
  return { home, files };
}

describe("the insecure-origin reason's copy line, run in a fixture HOME (wave 181)", () => {
  it('is a read: grep, the four keys and the two files, nothing that writes', () => {
    expect(CMD).toMatch(/^grep /);
    expect(CMD).toContain('~/.ccrc/ccrc.env');
    expect(CMD).toContain('~/.ccrc/exposure.env');
    for (const k of ['ORIGIN', 'RP_ID', 'AUTH', 'COOKIE_INSECURE']) expect(CMD).toContain(k);
    // Outside its one quoted pattern: no redirection, pipe, list, substitution or writer.
    const shell = CMD.replace(/'[^']*'/g, "''");
    expect(shell).not.toMatch(/[>|;&`$]|\bsed\b|\btee\b|\brm\b/);
    expect((CMD.match(/'/g) ?? []).length, 'one quoted pattern').toBe(2);
  });

  it('shows the four keys from both files with each line\'s file, an indented line too, and no secret; changes nothing', () => {
    const env = [
      '# my box', 'CCRC_HOST=0.0.0.0', 'CCRC_PORT=7788', 'CCRC_AUTH=on', 'CCRC_RP_ID=box.lan',
      '  CCRC_ORIGIN=http://box.lan:7788', 'CCRC_COOKIE_INSECURE=on', ...SECRET_LINES, '',
    ].join('\n');
    const exposure = ['CCRC_ORIGIN=http://10.0.0.9:7788', 'CCRC_DDNS_TOKEN=exp-ddns-canary-9876543210', ''].join('\n');
    const { home, files } = box(env, exposure);
    const before = files.map(md5);
    const r = run(home);
    const e = path.join(home, '.ccrc', 'ccrc.env');
    const x = path.join(home, '.ccrc', 'exposure.env');
    expect(r.code, r.err).toBe(0);
    expect(r.out.split('\n').filter(Boolean)).toEqual([
      `${e}:CCRC_AUTH=on`, `${e}:CCRC_RP_ID=box.lan`, `${e}:  CCRC_ORIGIN=http://box.lan:7788`, `${e}:CCRC_COOKIE_INSECURE=on`,
      `${x}:CCRC_ORIGIN=http://10.0.0.9:7788`,
    ]);
    for (const l of [...SECRET_LINES, 'exp-ddns-canary-9876543210']) expect(r.out).not.toContain(l.split('=')[1]!);
    expect(r.err).toBe('');
    expect(files.map(md5)).toEqual(before);
  });

  it('stays quiet about a file that is not there: no exposure file, or neither', () => {
    const one = box('CCRC_ORIGIN=http://box.lan:7788\n', null);
    const a = run(one.home);
    expect(a.out.trim()).toBe(`${path.join(one.home, '.ccrc', 'ccrc.env')}:CCRC_ORIGIN=http://box.lan:7788`);
    expect(a.err).toBe('');
    const none = box(null, null);
    const b = run(none.home);
    expect(b.out).toBe('');
    expect(b.err).toBe('');
    // An empty answer is grep's own "no line matched" or "no file read", never a crash of the shell.
    expect([1, 2]).toContain(b.code);
    execFileSync('test', ['!', '-e', path.join(none.home, '.ccrc', 'ccrc.env')]);
  });
});
