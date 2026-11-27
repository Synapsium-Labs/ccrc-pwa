// The launcher hands a verb in go mode to the Go core (spec 2026-11-24 §4). The installer renders only this platform's
// go-mode verbs, and only `windows` has one today, so off Windows the tree is installed as windows through the
// installer's test seam (CCRC_CORE_PLATFORM, honoured only from a tree holding `.ccrc-test-fixture`), with a `#!/bin/sh`
// stub standing in for the Windows binary. On Windows the real binary is installed, and its `caps` adds `go:caps`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkTmp } from './tmpHelpers.js';
import { plantEntryTree, runEntryInstall, spawnEntry } from './entryFixture.js';
import { CORE_GOARCH, coreExe } from './coreBuild.js';

const WIN = process.platform === 'win32';
let home: string;
const entry = () => path.join(home, '.local', 'bin', 'ccd');
const coreBin = () => path.join(home, '.local', 'libexec', 'ccrc', 'core', coreExe('windows'));
const sha = (p: string): string => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const off = () => path.join(home, '.cc-sessions', 'ccd-go-off');
/** The stub's own words off Windows; the real core's go:caps line on it. */
const viaCore = (out: string): boolean => (WIN ? out.includes('\ngo:caps\n') : out.startsWith('core-stub ccd '));
const viaBash = (out: string): boolean => out.includes('account-pane\n') && !viaCore(out);
beforeEach(() => {
  home = mkTmp('ccrc-core-entry-');
  plantEntryTree(home);
  if (!WIN) {
    const tree = path.join(home, 'ccrc');
    fs.writeFileSync(path.join(tree, '.ccrc-test-fixture'), '');
    const bin = path.join(tree, 'core', 'bin', `windows-${CORE_GOARCH}`);
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, coreExe('windows')), '#!/bin/sh\necho "core-stub $* x=${CCRC_X-unset}"\n', { mode: 0o755 });
  }
  runEntryInstall(home, WIN ? {} : { CCRC_CORE_PLATFORM: 'windows' });
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ccd = (argv: string[], env: NodeJS.ProcessEnv = {}, timeout?: number) =>
  spawnEntry(entry(), argv, { timeout, env: { ...process.env, HOME: home, ...env } });
/** The installed launcher's rendered core table. */
const table = (): { verbs: string[]; files: Record<string, string> } =>
  JSON.parse(/^CORE_JSON = '(.*)'$/m.exec(fs.readFileSync(entry(), 'utf8'))![1]!) as { verbs: string[]; files: Record<string, string> };
/** The installed launcher with its rendered core table line rewritten. */
const editTable = (line: string) => {
  const text = fs.readFileSync(entry(), 'utf8');
  const next = text.replace(/^CORE_JSON = '.*'$/m, () => line);
  expect(next, 'the launcher carries one rendered table line').not.toBe(text);
  fs.writeFileSync(entry(), next);
};

describe('the launcher hands a verb in go mode to the Go core', () => {
  it('the installed table lists caps and the one binary, and caps starts it', () => {
    expect(table().verbs).toEqual(['caps']);
    expect(Object.keys(table().files)).toEqual([coreExe('windows')]);
    const r = ccd(['caps']);
    expect(r.status, r.stderr).toBe(0);
    expect(viaCore(r.stdout), r.stdout).toBe(true);
  });
  it.skipIf(WIN)('the core gets `ccd <argv>` and the caller\'s environment, unchanged', () => {
    expect(ccd(['caps'], { CCRC_X: 'kept' }).stdout).toBe('core-stub ccd caps x=kept\n');
  });
  it.skipIf(WIN)('a core that fails answers with its own status: nothing falls back to bash', () => {
    fs.writeFileSync(coreBin(), '#!/bin/sh\necho core-failed >&2\nexit 7\n');
    editTable(`CORE_JSON = '${JSON.stringify({ files: { [coreExe('windows')]: sha(coreBin()) }, verbs: ['caps'] })}'`);
    const r = ccd(['caps']);
    expect(r.status).toBe(7);
    expect(r.stderr).toBe('core-failed\n');
    expect(r.stdout).toBe('');
  });
  it('with the timing marker, a core start writes its timing line', () => {
    fs.writeFileSync(path.join(home, '.cc-sessions', 'ccd-entry-timing'), '');
    const r = ccd(['caps']);
    expect(viaCore(r.stdout), r.stdout).toBe(true);
    expect(fs.readFileSync(path.join(home, '.ccrc', 'ccd-entry-timing.log'), 'utf8')).toMatch(/\tcaps\t\d+\t0\n$/);
  });
  it('a verb outside the table starts bash', () => {
    expect(viaCore(ccd(['list']).stdout)).toBe(false);
  });
  it('a table with no verb starts bash', () => {
    editTable(`CORE_JSON = '{"files":{},"verbs":[]}'`);
    expect(viaBash(ccd(['caps']).stdout)).toBe(true);
  });
  it('an empty ccd-go-off sends every verb to bash', () => {
    fs.writeFileSync(off(), '');
    expect(viaBash(ccd(['caps']).stdout)).toBe(true);
  });
  it('a ccd-go-off naming caps sends caps to bash', () => {
    fs.writeFileSync(off(), 'list\ncaps\n');
    expect(viaBash(ccd(['caps']).stdout)).toBe(true);
  });
  it('a ccd-go-off naming other verbs only leaves caps on the core', () => {
    fs.writeFileSync(off(), 'list\n');
    expect(viaCore(ccd(['caps']).stdout)).toBe(true);
  });
  it('a protected verb never starts the core, even when the table lists it', () => {
    const t = table();
    editTable(`CORE_JSON = '${JSON.stringify({ files: t.files, verbs: ['caps', 'ws-gc', 'WS-RECLAIM'] })}'`);
    for (const verb of ['ws-gc', 'WS-RECLAIM']) expect(viaCore(ccd([verb]).stdout), verb).toBe(false);
    expect(viaCore(ccd(['caps']).stdout), 'the edited table still routes caps').toBe(true);
  });
  it('a FIFO at ccd-go-off sends caps to bash, never opening it', () => {
    expect(spawnSync('mkfifo', [off()]).status).toBe(0);
    const r = ccd(['caps'], {}, 10_000);
    expect(r.error, 'the launcher blocked on the FIFO').toBeUndefined();
    expect(viaBash(r.stdout)).toBe(true);
  });
  it('a link at ccd-go-off sends every verb to bash, even to a file that names none', () => {
    const named = path.join(home, 'off-target');
    fs.writeFileSync(named, 'list\n');
    fs.symlinkSync(named, off());
    expect(viaBash(ccd(['caps']).stdout)).toBe(true);
  });
  it('a ccd-go-off that cannot be read sends caps to bash', () => {
    fs.mkdirSync(off());
    expect(viaBash(ccd(['caps']).stdout)).toBe(true);
  });
  // Windows PowerShell 5.1 writes `Set-Content`/`Out-File` text as UTF-8 with a BOM or as UTF-16 by default.
  it('a ccd-go-off written with a UTF-8 BOM, naming caps, sends caps to bash', () => {
    fs.writeFileSync(off(), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('caps\r\n')]));
    expect(viaBash(ccd(['caps']).stdout)).toBe(true);
  });
  it('a ccd-go-off written as UTF-16, naming caps, sends caps to bash', () => {
    fs.writeFileSync(off(), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('caps\r\n', 'utf16le')]));
    expect(viaBash(ccd(['caps']).stdout)).toBe(true);
  });
  it('a ccd-go-off holding a line that is no verb word sends every verb to bash', () => {
    fs.writeFileSync(off(), 'list\nCaps please\n');
    expect(viaBash(ccd(['caps']).stdout)).toBe(true);
  });
  it('a link in place of the core binary refuses, even to the file it names', () => {
    const real = path.join(home, 'core.real');
    fs.renameSync(coreBin(), real);
    fs.symlinkSync(real, coreBin());
    const r = ccd(['caps']);
    expect(r.status).toBe(125);
    expect(r.stderr).toMatch(/^ccd: refused \(entry-core-digest\): .* is not a regular file/);
    expect(r.stdout).toBe('');
  });
  it('a FIFO in place of the core binary refuses at once, never opening it', () => {
    fs.rmSync(coreBin());
    expect(spawnSync('mkfifo', [coreBin()]).status).toBe(0);
    const t0 = Date.now();
    const r = ccd(['caps'], {}, 10_000);
    expect(r.error, 'the launcher blocked on the FIFO').toBeUndefined();
    expect(r.status).toBe(125);
    expect(r.stderr).toMatch(/^ccd: refused \(entry-core-(digest|unreadable)\): /);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
  it('a core binary that does not match its digest refuses, and nothing starts', () => {
    fs.appendFileSync(coreBin(), '\n# changed\n');
    const r = ccd(['caps']);
    expect(r.status).toBe(125);
    expect(r.stderr).toMatch(/^ccd: refused \(entry-core-digest\): /);
    expect(r.stdout).toBe('');
  });
  it('a core binary that is missing refuses as unreadable, and nothing starts', () => {
    fs.rmSync(coreBin());
    const r = ccd(['caps']);
    expect(r.status).toBe(125);
    expect(r.stderr).toMatch(/^ccd: refused \(entry-core-unreadable\): /);
    expect(r.stdout).toBe('');
  });
  it('a table that lists verbs but no binary refuses every start as entry-unrendered', () => {
    editTable(`CORE_JSON = '{"files":{},"verbs":["caps"]}'`);
    for (const argv of [['caps'], ['list']]) {
      const r = ccd(argv);
      expect(r.status, argv[0]).toBe(125);
      expect(r.stderr, argv[0]).toMatch(/^ccd: refused \(entry-unrendered\): .*not exactly one core binary/);
    }
  });
  it('a launcher whose core table is unrendered refuses every start as entry-unrendered', () => {
    editTable(`CORE_JSON = '@CCRC_' + 'CORE_JSON@'`);
    for (const argv of [['caps'], ['list']]) {
      const r = ccd(argv);
      expect(r.status, argv[0]).toBe(125);
      expect(r.stderr, argv[0]).toMatch(/^ccd: refused \(entry-unrendered\): /);
    }
  });
});
