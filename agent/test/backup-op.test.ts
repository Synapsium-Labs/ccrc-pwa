// D-7858, D-7859: the agent's `backup` op. Two layers, the `pressure` op's idiom:
//  - the read (`measureBackup` over a REAL fixture directory, the environment injected): unset is not-configured, a
//    missing directory and a relative setting are unreadable, a missing file is absent, a file the agent may not read
//    (chmod 000) is `denied`, and each of the five files is answered by its first line, bounded;
//  - the wire (a REAL agent over loopback): the op is in `ready.ops`, takes no field, and answers the read.
// No case reads a real backup directory: every path is under the suite's own temp parent.
import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { measureBackup } from '../src/backup.js';
import { BACKUP_OP, type AgentReady } from '../../shared/agent-protocol.js';
import { BACKUP_FILE_MAX_BYTES, BACKUP_FILES, readBackupRead } from '../../shared/backup.js';
import { makeFixture, boot, TestClient } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const LINE = '2026-11-03T03:34:00Z mode=backup';
const env = (dir: string | undefined) => ({ env: dir === undefined ? {} : { CCRC_BACKUP_STATE_DIR: dir } });
const stateDir = (files: Record<string, string> = {}): string => {
  const d = path.join(mkTmp('backup-op-'), 'state');
  mkdirSync(d);
  for (const [k, v] of Object.entries(files)) writeFileSync(path.join(d, k), v);
  return d;
};
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('measureBackup over a fixture directory', () => {
  it('unset or blank is not-configured, never an alarm', () => {
    expect(measureBackup(env(undefined))).toEqual({ state: 'not-configured' });
    expect(measureBackup(env('   '))).toEqual({ state: 'not-configured' });
  });

  it('a relative setting and a missing directory are unreadable, each with its word', () => {
    expect(measureBackup(env('relative/dir'))).toEqual({ state: 'unreadable', why: 'not-absolute' });
    expect(measureBackup(env(path.join(mkTmp('backup-op-'), 'absent')))).toEqual({ state: 'unreadable', why: 'no-directory' });
    const f = path.join(mkTmp('backup-op-'), 'a-file');
    writeFileSync(f, 'x');
    expect(measureBackup(env(f))).toEqual({ state: 'unreadable', why: 'failed' });
  });

  it('an empty directory is a read with no files (every file absent)', () => {
    expect(measureBackup(env(stateDir()))).toEqual({ state: 'read', files: {} });
  });

  it('each of the five files is answered by its first line, and an unknown file is never read', () => {
    const files = Object.fromEntries(BACKUP_FILES.map((f, i) => [f, `2026-11-0${i + 1}T00:00:00Z k=${f}\nsecond line\n`]));
    const d = stateDir({ ...files, 'last-other-success': LINE });
    const r = measureBackup(env(d));
    expect(r).toEqual({ state: 'read', files: Object.fromEntries(BACKUP_FILES.map((f, i) => [f, `2026-11-0${i + 1}T00:00:00Z k=${f}`])) });
    expect(readBackupRead(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  for (const f of BACKUP_FILES) {
    it(`${f} alone is read alone`, () => {
      expect(measureBackup(env(stateDir({ [f]: LINE })))).toEqual({ state: 'read', files: { [f]: LINE } });
    });
  }

  it('a file longer than the bound is cut at the bound, never read whole', () => {
    const r = measureBackup(env(stateDir({ 'last-success': 'x'.repeat(BACKUP_FILE_MAX_BYTES * 3) })));
    expect(r.state === 'read' && r.files['last-success']!.length).toBe(BACKUP_FILE_MAX_BYTES);
  });

  it.skipIf(asRoot)('a file the agent may not read (chmod 000) is unreadable: denied, never absent', () => {
    const d = stateDir({ 'last-success': LINE, 'last-failure': LINE });
    chmodSync(path.join(d, 'last-failure'), 0o000);
    try {
      expect(measureBackup(env(d))).toEqual({ state: 'unreadable', why: 'denied' });
    } finally {
      chmodSync(path.join(d, 'last-failure'), 0o644);
    }
  });

  it.skipIf(asRoot)('a directory the agent may not search (chmod 000) is unreadable: denied', () => {
    const d = stateDir({ 'last-success': LINE });
    chmodSync(d, 0o000);
    try {
      expect(measureBackup(env(d))).toEqual({ state: 'unreadable', why: 'denied' });
    } finally {
      chmodSync(d, 0o755);
    }
  });

  it('a symlink or a FIFO at a name is a fault, never its target and never a hang', () => {
    const d = stateDir();
    const target = path.join(mkTmp('backup-op-'), 'target');
    writeFileSync(target, LINE);
    symlinkSync(target, path.join(d, 'last-success'));
    expect(measureBackup(env(d))).toEqual({ state: 'unreadable', why: 'failed' });
    const d2 = stateDir();
    execFileSync('mkfifo', [path.join(d2, 'stale')]);
    expect(measureBackup(env(d2))).toEqual({ state: 'unreadable', why: 'failed' });
  });
});

describe('the backup op on the wire', () => {
  let agent: RunningAgent | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    await agent?.close();
    agent = undefined;
  });
  async function connect(dir: string | undefined): Promise<TestClient> {
    agent = await boot(makeFixture(), { backupSeams: env(dir) });
    const c = new TestClient(agent.port);
    clients.push(c);
    return c;
  }
  const res = (c: TestClient, id: number) =>
    c.waitFor((m) => (m as { t?: string; id?: number }).t === 'res' && (m as { id?: number }).id === id) as Promise<Record<string, unknown>>;

  it('the op is in ready.ops', async () => {
    const c = await connect(undefined);
    expect((await c.hello() as AgentReady).ops).toContain(BACKUP_OP);
  });

  it('answers the read, with no request field', async () => {
    const c = await connect(stateDir({ 'last-success': LINE }));
    await c.hello();
    c.send({ t: 'req', id: 7, op: 'backup' });
    const r = await res(c, 7);
    expect(r.ok).toBe(true);
    expect(readBackupRead(r)).toEqual({ state: 'read', files: { 'last-success': LINE } });
  });

  it('a request with any field is a bad request', async () => {
    const c = await connect(stateDir({ 'last-success': LINE }));
    await c.hello();
    for (const [id, extra] of [[8, { path: '/etc' }], [9, { dir: 'x' }]] as const) {
      c.send({ t: 'req', id, op: 'backup', ...extra });
      expect(await res(c, id)).toMatchObject({ ok: false, err: 'bad-request' });
    }
  });
});
