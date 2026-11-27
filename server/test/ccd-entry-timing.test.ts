import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { installEntryFixture, spawnEntry } from './entryFixture.js';

let home: string;
beforeEach(() => { home = mkTmp('ccrc-entry-timing-'); installEntryFixture(home); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const ccd = (...argv: string[]) => spawnEntry(path.join(home, '.local', 'bin', 'ccd'), argv,
  { env: { ...process.env, HOME: home } });
const log = () => path.join(home, '.ccrc', 'ccd-entry-timing.log');
const marker = () => path.join(home, '.cc-sessions', 'ccd-entry-timing');
const touchMarker = () => { fs.mkdirSync(path.dirname(marker()), { recursive: true }); fs.writeFileSync(marker(), ''); };

describe('the launcher timing log (wave 0)', () => {
  it('writes nothing without the marker', () => {
    expect(ccd('caps').status).toBe(0);
    expect(fs.existsSync(log())).toBe(false);
  });
  it('with the marker, appends verb, duration and status, and keeps the output', () => {
    touchMarker();
    const r = ccd('caps');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('account-pane\n');
    const [line] = fs.readFileSync(log(), 'utf8').trim().split('\n');
    expect(line).toMatch(/^\d{13}\tcaps\t\d+\t0$/);
  });
  it('records a failing verb with its status', () => {
    touchMarker();
    expect(ccd('caps', '--json').status).toBe(1);
    expect(fs.readFileSync(log(), 'utf8')).toMatch(/\tcaps\t\d+\t1\n$/);
  });
  it('never records an argument: a verb-shaped token only, else a dash', () => {
    touchMarker();
    ccd('/some/path');
    expect(fs.readFileSync(log(), 'utf8')).toMatch(/^\d{13}\t-\t\d+\t\d+\n$/);
  });
  it.skipIf(!fs.existsSync('/proc/self/status'))('the waited start leaves the payload the signals the exec start does (SIGPIPE ignored)', () => {
    // A stub body prints its own SigIgn mask. Python ignores SIGPIPE and SIGXFSZ at startup and execve keeps that;
    // a Popen with restore_signals=True would reset them, so a timed run would behave unlike the untimed one.
    const h = mkTmp('ccrc-entry-timing-sig-');
    try {
      installEntryFixture(h, { template: (t) => t.replace('    home = body[:-len(BODY_SUFFIX)]\n',
        "    home = body[:-len(BODY_SUFFIX)]\n    if argv[:1] == ['sigtest']:\n        body = home + '/stub-sig.sh'\n") });
      fs.writeFileSync(path.join(h, 'stub-sig.sh'), '#!/bin/bash\ngrep ^SigIgn: /proc/self/status\n', { mode: 0o755 });
      const run = () => spawnEntry(path.join(h, '.local', 'bin', 'ccd'), ['sigtest'], { env: { ...process.env, HOME: h } }).stdout;
      const untimed = run();
      fs.mkdirSync(path.join(h, '.cc-sessions'), { recursive: true });
      fs.writeFileSync(path.join(h, '.cc-sessions', 'ccd-entry-timing'), '');
      const timed = run();
      expect(fs.existsSync(path.join(h, '.ccrc', 'ccd-entry-timing.log'))).toBe(true); // the second run really was waited on
      expect(untimed).toMatch(/^SigIgn:\t[0-9a-f]{16}\n$/);
      expect(timed).toBe(untimed);
      expect(parseInt(timed.split('\t')[1]!, 16) & 0x1000).toBe(0x1000);
    } finally { fs.rmSync(h, { recursive: true, force: true }); }
  });
  it('never waits on supervise: it execs, and writes no line, even with the marker', () => {
    // A stub body stands in for the real supervisor, so `supervise` returns at once. The hook swaps it in after the
    // launcher has checked the real body's digest. exec leaves the stub as the process the caller started.
    const h = mkTmp('ccrc-entry-timing-sup-');
    try {
      installEntryFixture(h, { template: (t) => t.replace('    home = body[:-len(BODY_SUFFIX)]\n',
        "    home = body[:-len(BODY_SUFFIX)]\n    if argv[:1] == ['supervise']:\n        body = home + '/stub-supervise.sh'\n") });
      fs.writeFileSync(path.join(h, 'stub-supervise.sh'), '#!/bin/bash\necho "stub $$"\n', { mode: 0o755 });
      fs.mkdirSync(path.join(h, '.cc-sessions'), { recursive: true });
      fs.writeFileSync(path.join(h, '.cc-sessions', 'ccd-entry-timing'), '');
      const r = spawnEntry(path.join(h, '.local', 'bin', 'ccd'), ['supervise'], { env: { ...process.env, HOME: h } });
      expect(r.stdout).toMatch(/^stub \d+\n$/);
      expect(r.status).toBe(0);
      expect(r.pid).toBe(Number(/\d+/.exec(r.stdout)![0])); // exec, not a waited child
      expect(fs.existsSync(path.join(h, '.ccrc', 'ccd-entry-timing.log'))).toBe(false);
    } finally { fs.rmSync(h, { recursive: true, force: true }); }
  });
});
