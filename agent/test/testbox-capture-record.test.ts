// The build capture recorder (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1): `record()` in
// process for each kind, the live status copy, and ONE case that runs the recorder's source as a process under Node's
// type-stripping flag (no compile step), as the runner's tests do.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCaptureRecords } from '../../shared/claudeBuildCapture.js';
import { ALLOW_REPLY, liveStatus, record, recorderPath, STATUSLINE_REPLY } from '../src/testbox/captureRecord.js';
import { mkTmp } from './tmpHelpers.js';

const fresh = (): { dir: string; config: string; file: string } => {
  const dir = realpathSync(mkTmp('ccrc-caprec-'));
  const config = path.join(dir, 'config');
  mkdirSync(path.join(config, 'sessions'), { recursive: true });
  return { dir, config, file: path.join(dir, 'recording.jsonl') };
};
const lines = (file: string): unknown[] => readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as unknown);

describe('record(): one line per call, and the reply the build needs', () => {
  it('a hook event appends one hook record carrying the parsed payload and the status copy', () => {
    const t = fresh();
    writeFileSync(path.join(t.config, 'sessions', '1.json'), JSON.stringify({ pid: 1, version: '2.1.1' }));
    const out = record('SessionStart', JSON.stringify({ hook_event_name: 'SessionStart' }), { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: t.file });
    expect(out).toBe('');
    expect(lines(t.file)).toEqual([{ kind: 'hook', event: 'SessionStart', payload: { hook_event_name: 'SessionStart' }, status: { pid: 1, version: '2.1.1' } }]);
  });
  it('the statusline appends a statusline record (no event name) and prints the statusline text', () => {
    const t = fresh();
    const out = record('statusline', '{"cwd":"/x"}', { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: t.file });
    expect(out).toBe(STATUSLINE_REPLY);
    expect(lines(t.file)).toEqual([{ kind: 'statusline', payload: { cwd: '/x' }, status: null }]);
  });
  it('PermissionRequest answers the allow reply, and records the event too', () => {
    const t = fresh();
    const out = record('PermissionRequest', '{}', { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: t.file });
    expect(out).toBe(ALLOW_REPLY);
    expect(JSON.parse(out)).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    expect((lines(t.file)[0] as { event: string }).event).toBe('PermissionRequest');
  });
  it('a stdin that is not JSON is kept as the raw string', () => {
    const t = fresh();
    record('Stop', 'not json {', { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: t.file });
    expect((lines(t.file)[0] as { payload: unknown }).payload).toBe('not json {');
  });
  it('lines append: two calls leave two lines, in order', () => {
    const t = fresh();
    const env = { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: t.file };
    record('PreCompact', '{}', env);
    record('PostCompact', '{}', env);
    expect(lines(t.file).map((l) => (l as { event: string }).event)).toEqual(['PreCompact', 'PostCompact']);
  });
  it('no recording variable (or an empty one) writes nothing and still answers', () => {
    const t = fresh();
    expect(record('PermissionRequest', '{}', { CLAUDE_CONFIG_DIR: t.config })).toBe(ALLOW_REPLY);
    expect(record('PermissionRequest', '{}', { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: '' })).toBe(ALLOW_REPLY);
    expect(record('statusline', '{}', {})).toBe(STATUSLINE_REPLY);
    expect(() => readFileSync(t.file, 'utf8')).toThrow();
  });
  it('a recording path that cannot be written still answers and never throws', () => {
    const t = fresh();
    const bad = path.join(t.dir, 'no-such-dir', 'recording.jsonl');
    expect(record('PermissionRequest', '{}', { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: bad })).toBe(ALLOW_REPLY);
  });
});

describe('liveStatus(): the newest sessions/*.json', () => {
  it('is the newest by modification time', () => {
    const t = fresh();
    const old = path.join(t.config, 'sessions', 'a.json');
    const recent = path.join(t.config, 'sessions', 'b.json');
    writeFileSync(old, JSON.stringify({ which: 'old' }));
    writeFileSync(recent, JSON.stringify({ which: 'recent' }));
    utimesSync(old, new Date(2_000_000_000_000), new Date(2_000_000_000_000));
    utimesSync(recent, new Date(2_000_000_100_000), new Date(2_000_000_100_000));
    expect(liveStatus(t.config)).toEqual({ which: 'recent' });
  });
  it('ignores files that are not .json', () => {
    const t = fresh();
    writeFileSync(path.join(t.config, 'sessions', 'x.txt'), '{"a":1}');
    expect(liveStatus(t.config)).toBeNull();
  });
  it('is null when there is no file, no sessions directory, or the newest is not JSON', () => {
    const t = fresh();
    expect(liveStatus(t.config)).toBeNull();
    expect(liveStatus(path.join(t.dir, 'absent'))).toBeNull();
    writeFileSync(path.join(t.config, 'sessions', 'bad.json'), 'not json');
    expect(liveStatus(t.config)).toBeNull();
  });
});

describe('the recorder\'s source run as a process, with nothing compiled', () => {
  const run = (arg: string, stdin: string, env: Record<string, string>): { status: number | null; stdout: string } => {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', recorderPath(), arg], {
      input: stdin, encoding: 'utf8', env, timeout: 30_000, killSignal: 'SIGKILL',
    });
    return { status: r.status, stdout: r.stdout };
  };
  it('appends a line readCaptureRecords reads back, and PermissionRequest prints the allow reply', () => {
    const t = fresh();
    expect(recorderPath().endsWith(path.join('src', 'testbox', 'captureRecord.ts'))).toBe(true);
    const env = { CCRC_CAPTURE_RECORDING: t.file, CLAUDE_CONFIG_DIR: t.config };
    const stop = run('Stop', JSON.stringify({ hook_event_name: 'Stop' }), env);
    expect(stop).toEqual({ status: 0, stdout: '' });
    const perm = run('PermissionRequest', '{"hook_event_name":"PermissionRequest"}', env);
    expect(perm.status).toBe(0);
    expect(perm.stdout.trim()).toBe(ALLOW_REPLY);
    const back = readCaptureRecords(readFileSync(t.file, 'utf8'));
    expect(back.unreadable).toBe(0);
    expect(back.records.map((r) => (r.kind === 'hook' ? r.event : r.kind))).toEqual(['Stop', 'PermissionRequest']);
  });
});
