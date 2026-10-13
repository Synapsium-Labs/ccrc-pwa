// Child reclamation wave 10 (path-identity spec 2026-10-12 §5.2, §5.3): the collector switch's generation journal
// adapter, against real files under a fixture HOME (mkTmp). Every path is built from a fixture, never the real HOME.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECT_LANE_JOURNAL_BASENAME, COLLECT_LANE_JOURNAL_MAX_BYTES, collectLaneJournalAt, defaultCollectLaneJournalPath,
} from '../src/coord/collectLaneJournal.js';
import { parseCollectLaneJournal, type CollectLaneJournalRead } from '../src/collectLane.js';
import { codeOnly } from './sourceScan.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const LINUX = process.platform === 'linux';
const ROOT_USER = process.getuid?.() === 0;
const ADAPTER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'coord', 'collectLaneJournal.ts');

interface Fixture { readonly home: string; readonly ccrcDir: string; readonly p: string }
/** A fixture HOME whose `.ccrc` does not exist yet, and the journal path inside it. */
const fixture = (): Fixture => {
  const home = mkTmp('ccrc-collect-journal-');
  const ccrcDir = path.join(home, '.ccrc');
  return { home, ccrcDir, p: defaultCollectLaneJournalPath(ccrcDir) };
};
/** A fixture whose journal holds exactly `text`. */
const planted = (text: string): Fixture => {
  const f = fixture();
  mkdirSync(f.ccrcDir, { recursive: true });
  writeFileSync(f.p, text);
  return f;
};
/** The `code` a call throws, or `no throw`. */
const thrownCode = (fn: () => void): unknown => {
  try { fn(); } catch (e) { return (e as { code?: unknown }).code; }
  return 'no throw';
};
/** The child that would end a BLOCKING open of a FIFO: after 3 s it opens it for writing, non-blocking. */
const UNBLOCK = "const fs = require('node:fs'); setTimeout(() => { try { fs.closeSync(fs.openSync(process.argv[1], " +
  'fs.constants.O_WRONLY | fs.constants.O_NONBLOCK)); } catch {} }, 3000);';

describe('the journal adapter (path-identity spec 2026-10-12 §5.2, §5.3)', () => {
  it('the default path is ccrcDir’s collect-lane-generation.log', () => {
    expect(COLLECT_LANE_JOURNAL_BASENAME).toBe('collect-lane-generation.log');
    expect(defaultCollectLaneJournalPath(path.join('/fixture-home', '.ccrc')))
      .toBe(path.join('/fixture-home', '.ccrc', 'collect-lane-generation.log'));
    expect(COLLECT_LANE_JOURNAL_MAX_BYTES).toBe(1048576);
  });

  it('missing is missing', () => {
    const f = fixture();
    expect(collectLaneJournalAt(f.p).read()).toEqual({ kind: 'missing' });
    expect(existsSync(f.ccrcDir), 'a read made the directory').toBe(false);
  });

  it('empty, whitespace, truncated and blank-middle files read malformed', () => {
    const cases: [string, string][] = [
      ['', 'empty'], [' ', 'blank'], ['{"generation":', 'json'], ['{"generation":1}\n\n{"generation":2}\n', 'blank'],
    ];
    for (const [text, fault] of cases) {
      const r = collectLaneJournalAt(planted(text).p).read();
      expect(r, JSON.stringify(text)).toEqual(parseCollectLaneJournal(text));
      expect(r, JSON.stringify(text)).toMatchObject({ kind: 'malformed', fault });
    }
  });

  it('a directory, a symlink to a valid file and a dangling symlink are not-regular', () => {
    const dir = fixture();
    mkdirSync(dir.p, { recursive: true });
    expect(collectLaneJournalAt(dir.p).read()).toEqual({ kind: 'not-regular', fileKind: 'directory' });
    const link = fixture();
    mkdirSync(link.ccrcDir, { recursive: true });
    const target = path.join(link.ccrcDir, 'elsewhere.log');
    writeFileSync(target, '{"generation":1}\n');
    symlinkSync(target, link.p);
    expect(collectLaneJournalAt(link.p).read()).toEqual({ kind: 'not-regular', fileKind: 'symlink' });
    const dangling = fixture();
    mkdirSync(dangling.ccrcDir, { recursive: true });
    symlinkSync(path.join(dangling.ccrcDir, 'gone.log'), dangling.p);
    expect(collectLaneJournalAt(dangling.p).read(), 'a dangling link is never missing')
      .toEqual({ kind: 'not-regular', fileKind: 'symlink' });
  });

  it.skipIf(!LINUX)('a FIFO is not-regular and does not hang', () => {
    const f = fixture();
    mkdirSync(f.ccrcDir, { recursive: true });
    execFileSync('mkfifo', [f.p]);
    // A blocking open would wait for a writer for ever, freezing this worker past vitest's own timeout. The child
    // ends such an open after 3 s, so the elapsed time is the red. A non-blocking open never waits for it, and the
    // child's own open then fails ENXIO and it exits. Its handle is recorded and killed here, and only it.
    const child = spawn(process.execPath, ['-e', UNBLOCK, f.p], { stdio: 'ignore' });
    try {
      const t0 = Date.now();
      expect(collectLaneJournalAt(f.p).read()).toEqual({ kind: 'not-regular', fileKind: 'other' });
      expect(Date.now() - t0, 'the read waited for a writer').toBeLessThan(1500);
    } finally {
      child.kill();
    }
  });

  it.skipIf(ROOT_USER)('chmod 000 is unreadable EACCES (skipped under root)', () => {
    const f = planted('{"generation":1}\n');
    chmodSync(f.p, 0o000);
    try {
      expect(collectLaneJournalAt(f.p).read()).toEqual({ kind: 'unreadable', code: 'EACCES' });
    } finally {
      chmodSync(f.p, 0o600);
    }
  });

  it('a file past 1 MiB is unreadable EFBIG', () => {
    expect(collectLaneJournalAt(planted('x'.repeat(COLLECT_LANE_JOURNAL_MAX_BYTES + 1)).p).read())
      .toEqual({ kind: 'unreadable', code: 'EFBIG' });
    // At the cap the file is read and parsed: the bound is the cap, not one byte under it.
    expect(collectLaneJournalAt(planted('x'.repeat(COLLECT_LANE_JOURNAL_MAX_BYTES)).p).read())
      .toMatchObject({ kind: 'malformed', fault: 'json' });
  });

  it('no read carries the path', () => {
    const answers: { home: string; read: CollectLaneJournalRead }[] = [];
    const add = (f: Fixture): void => { answers.push({ home: f.home, read: collectLaneJournalAt(f.p).read() }); };
    add(fixture());
    add(planted('{"generation":'));
    const dir = fixture();
    mkdirSync(dir.p, { recursive: true });
    add(dir);
    const link = fixture();
    mkdirSync(link.ccrcDir, { recursive: true });
    symlinkSync(path.join(link.ccrcDir, 'gone.log'), link.p);
    add(link);
    add(planted('x'.repeat(COLLECT_LANE_JOURNAL_MAX_BYTES + 1)));
    if (!ROOT_USER) {
      const ro = planted('{"generation":1}\n');
      chmodSync(ro.p, 0o000);
      try { add(ro); } finally { chmodSync(ro.p, 0o600); }
    }
    const kinds = ['missing', 'malformed', 'not-regular', 'not-regular', 'unreadable', ...(ROOT_USER ? [] : ['unreadable'])];
    expect(answers.map((a) => a.read.kind)).toEqual(kinds);
    for (const a of answers) {
      expect(JSON.stringify(a.read)).not.toContain(a.home);
      expect(JSON.stringify(a.read)).not.toContain(COLLECT_LANE_JOURNAL_BASENAME);
    }
  });

  it('appends from missing create one record; two read max 2', () => {
    const f = fixture();
    const j = collectLaneJournalAt(f.p);
    expect(j.logPath).toBe(f.p);
    j.appendGeneration(1);
    expect(readFileSync(f.p, 'utf8')).toBe('{"generation":1}\n');
    expect(statSync(f.p).mode & 0o777, 'created 0600').toBe(0o600);
    expect(j.read()).toEqual({ kind: 'ok', max: 1, records: 1 });
    j.appendGeneration(2);
    expect(readFileSync(f.p, 'utf8')).toBe('{"generation":1}\n{"generation":2}\n');
    expect(j.read()).toEqual({ kind: 'ok', max: 2, records: 2 });
  });

  it('an append after a file lacking its final newline still reads ok', () => {
    const f = planted('{"generation":1}');
    const j = collectLaneJournalAt(f.p);
    j.appendGeneration(2);
    expect(readFileSync(f.p, 'utf8')).toBe('{"generation":1}\n{"generation":2}\n');
    expect(j.read()).toEqual({ kind: 'ok', max: 2, records: 2 });
  });

  it('0, 1.5 and -1 throw and leave the file untouched', () => {
    const missing = fixture();
    const existing = planted('{"generation":1}\n');
    for (const f of [missing, existing]) {
      const j = collectLaneJournalAt(f.p);
      const before = existsSync(f.p) ? readFileSync(f.p) : null;
      for (const g of [0, 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => j.appendGeneration(g), String(g)).toThrow(RangeError);
        expect(thrownCode(() => j.appendGeneration(g)), String(g)).toBe('ERANGE');
      }
      expect(existsSync(f.p) ? readFileSync(f.p) : null).toEqual(before);
    }
    expect(existsSync(missing.ccrcDir), 'a refused append made the directory').toBe(false);
  });

  it('an append over a symlink or a directory throws, and nothing is written through it', () => {
    const link = fixture();
    mkdirSync(link.ccrcDir, { recursive: true });
    const target = path.join(link.ccrcDir, 'elsewhere.log');
    writeFileSync(target, '{"generation":1}\n');
    symlinkSync(target, link.p);
    expect(thrownCode(() => collectLaneJournalAt(link.p).appendGeneration(2))).toBe('ELOOP');
    expect(readFileSync(target, 'utf8')).toBe('{"generation":1}\n');
    const dir = fixture();
    mkdirSync(dir.p, { recursive: true });
    expect(thrownCode(() => collectLaneJournalAt(dir.p).appendGeneration(1))).toBe('EISDIR');
  });

  it('the adapter’s one parser is parseCollectLaneJournal', () => {
    expect(/\bJSON\.parse\(/.test('const v = JSON.parse(line);'), 'CONTROL: the pattern sees a parse').toBe(true);
    const code = codeOnly(readFileSync(ADAPTER, 'utf8'));
    expect(code).toMatch(/\bparseCollectLaneJournal\(/);
    expect(code).not.toMatch(/\bJSON\.parse\(/);
  });

  it('the durability acts stand in the code: the file fsync, the directory fsync on create, a reopen without O_CREAT', () => {
    // No test can intercept a direct `node:fs` sync call, so these are pinned by text (codeOnly: comments stripped,
    // strings kept). Deleting one, or adding `O_CREAT` to the reopen, reds this case.
    const code = codeOnly(readFileSync(ADAPTER, 'utf8'));
    expect(code.match(/\bfsyncSync\(fd\)/g) ?? [], 'the file fsync').toHaveLength(1);
    expect(code, 'the directory fsync on create').toMatch(/if \(created\) \{\s*const dfd = openSync\(dir, FS\.O_RDONLY\);\s*try \{ fsyncSync\(dfd\); \}/);
    expect(code, 'the reopen after EEXIST').toMatch(/^\s*fd = openSync\(logPath, FS\.O_RDWR \| FS\.O_APPEND \| FS\.O_NOFOLLOW\);$/m);
  });
});
