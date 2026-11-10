// `deploy/measure-codex-watch.py`, the Codex bridge watch's instrument (plan 2026-11-10 codex-bridge Stage 4, Task 0;
// the Stage 2 runbook's step 5). Every reading is pinned on a constructed fixture HOME with a known answer: a lane
// directory with `lane.json` and the bridge's stats file (version 1, the shape `ccd/codexbridge/stats.py` documents),
// the auth library's status file (WRITTEN BY THE LIBRARY ITSELF, over a placeholder credential, so the instrument reads
// the bytes the writer writes), a LiteLLM log, and transcripts under the lane's config directory and another one.
// "Unmeasured is never pass" and "nothing but counts leaves" are each pinned: the second by sentinels planted in a
// prompt, a path, a session id and a request id.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'deploy', 'measure-codex-watch.py');
const AUTH_LIB = path.join(ROOT, 'ccd', 'ccgpt-auth.py');

const LANE = 'lane-a';
const FLIP = '2026-10-27T06:26:03Z';
const BASE = '2026-10-22T10:48:00Z';
const UNTIL = '2026-11-03T06:26:03Z';
const NOW_S = Date.parse('2026-11-03T07:00:00Z') / 1000;

const SENTINEL_TEXT = 'SENTINEL-PROMPT-TEXT-4c1e';
const SENTINEL_SESSION = 'SENTINEL-SESSION-ID-9b7d';
const SENTINEL_PROJECT = '-SENTINEL-PROJECT-PATH-2a6f';
const SENTINEL_REQUEST = 'SENTINEL-REQUEST-ID-83e0';
const SENTINEL_CREDENTIAL = 'SENTINEL-CREDENTIAL-BYTES-5d19';
const SENTINELS = [SENTINEL_TEXT, SENTINEL_SESSION, SENTINEL_PROJECT, SENTINEL_REQUEST, SENTINEL_CREDENTIAL];

let home: string;
let seq = 0;

const laneDir = (): string => path.join(home, '.ccrc', 'codex', LANE);
const authDir = (): string => path.join(home, '.local', 'share', 'ccrc', 'codex', `${LANE}-abc123`);
const logFile = (): string => path.join(home, '.ccrc', 'logs', 'codex', LANE, 'litellm.log');
const write = (file: string, body: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

type Stats = Record<string, unknown>;
const stats = (over: Stats = {}): Stats => ({
  version: 1, lane: LANE, since: '2026-10-27T06:26:05.000Z', startedAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-11-03T06:59:00.000Z',
  routes: { 'backend/gpt-model-a': { requests: 900, bytesPerToken: 3.5, promptTokensMax: 300000, promptTokensLast: 1200 },
            'backend/gpt-model-b': { requests: 100, bytesPerToken: 3.5, promptTokensMax: 90000, promptTokensLast: 800 } },
  refusals: {},
  outcomes: { '2xx': 990, '4xx': 6, '5xx': 4, 'client-gone': 3, 'drain-cut': 1, compactionRequests: 7, countTokens: 40 },
  names: { errorCode: { server_is_overloaded: 3 } },
  unexplained: { errorCode: [], responseHeader: [] },
  usageHeaders: null, lastUpstreamRequestId: SENTINEL_REQUEST,
  store: { state: 'ok', reason: null, at: null, setAside: null },
  ...over,
});
/** The lane's status file, written by the auth library's own `write_status` under its lock, over a placeholder
 *  credential whose bytes are a sentinel: the status is current only while its identity is that file's. */
function writeStatus(over: Record<string, unknown> = {}): void {
  fs.mkdirSync(authDir(), { recursive: true, mode: 0o700 });
  const fields = { state: 'ok', expiresAt: NOW_S + 1800, lastRefreshAt: NOW_S - 1500, lastErrorCode: null,
    lastRequestId: SENTINEL_REQUEST, ...over };
  const r = spawnSync('python3', ['-I', '-c', [
    'import importlib.util, json, os, sys',
    'sys.dont_write_bytecode = True',
    'spec = importlib.util.spec_from_file_location("ccgpt_auth", sys.argv[1])',
    'lib = importlib.util.module_from_spec(spec)',
    'sys.modules["ccgpt_auth"] = lib',
    'spec.loader.exec_module(lib)',
    'd, fields = sys.argv[2], json.loads(sys.argv[3])',
    'p = lib.paths_for(d)',
    'if not os.path.exists(p.credential):',
    '    fd = os.open(p.credential, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)',
    '    os.write(fd, sys.argv[4].encode()); os.close(fd)',
    'with lib.held(d):',
    '    ok = lib.write_status(d, identity=lib._current_identity(p.credential), unsaved=False, **fields)',
    'sys.exit(0 if ok else 1)',
  ].join('\n'), AUTH_LIB, authDir(), JSON.stringify(fields), SENTINEL_CREDENTIAL], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
}
const lane = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: LANE, configDir: '.claude-lane-a', authDir: `.local/share/ccrc/codex/${LANE}-abc123`, proxyPort: 14100,
  litellmPort: 14101, bridge: 'direct', upstream: 'backend',
  bridgeFiles: { stats: 'bridge.stats.json', store: 'reasoning.sqlite', recordings: 'recordings' }, ...over,
});

/** A LiteLLM log: `ok` POSTs answered 200, `bad` answered 500, and lines the reader must not count. */
const litellmLog = (ok: number, bad: number): string => [
  'INFO:     Started server process [1234]',
  'INFO:     127.0.0.1:50001 - "GET /health/liveliness HTTP/1.1" 200 OK',
  ...Array.from({ length: ok }, (_, i) => `INFO:     127.0.0.1:${50002 + i} - "POST /v1/messages HTTP/1.1" 200 OK`),
  ...Array.from({ length: bad }, (_, i) => `INFO:     127.0.0.1:${60000 + i} - "POST /v1/messages HTTP/1.1" 500 Internal Server Error`),
  `a line of text that is not an access line: ${SENTINEL_TEXT}`,
].join('\n') + '\n';

const assistant = (at: string, model: string, id?: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: 'assistant', uuid: `row-${++seq}`, sessionId: SENTINEL_SESSION, timestamp: at,
    message: { id: id ?? `msg-${seq}`, model, role: 'assistant', content: [{ type: 'text', text: SENTINEL_TEXT }] },
    ...extra });
const user = (at: string): string =>
  JSON.stringify({ type: 'user', uuid: `row-${++seq}`, sessionId: SENTINEL_SESSION, timestamp: at,
    message: { role: 'user', content: SENTINEL_TEXT } });
const boundary = (at: string, trigger: 'auto' | 'manual', uuid?: string): string =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: uuid ?? `row-${++seq}`, sessionId: SENTINEL_SESSION,
    timestamp: at, content: 'Conversation compacted', compactMetadata: { trigger, preTokens: 380000 } });
const transcript = (configDir: string, name: string, rows: string[]): void =>
  write(path.join(home, configDir, 'projects', SENTINEL_PROJECT, `${name}.jsonl`), rows.join('\n') + '\n');

/** `n` GPT calls spread inside a window that starts at `from` (one a minute). */
const calls = (from: string, n: number, model = 'gpt-model-a'): string[] => {
  const t0 = Date.parse(from);
  return Array.from({ length: n }, (_, i) => assistant(new Date(t0 + (i + 1) * 60_000).toISOString(), model));
};

/** The passing fixture: 200 GPT calls and 4 automatic compactions before the flip, 400 and 4 after it. */
function passing(): void {
  write(path.join(laneDir(), 'lane.json'), JSON.stringify(lane()));
  write(path.join(laneDir(), 'bridge.stats.json'), JSON.stringify(stats()));
  writeStatus();
  write(logFile(), litellmLog(990, 10));
  transcript('.claude-lane-a', 'before', [
    user('2026-10-23T00:00:00.000Z'), ...calls('2026-10-23T00:00:00.000Z', 200),
    boundary('2026-10-23T04:00:00.000Z', 'auto'), boundary('2026-10-23T05:00:00.000Z', 'auto'),
    boundary('2026-10-23T06:00:00.000Z', 'auto'), boundary('2026-10-23T07:00:00.000Z', 'auto'),
  ]);
  transcript('.claude-lane-a', 'after', [
    user('2026-10-28T00:00:00.000Z'), ...calls('2026-10-28T00:00:00.000Z', 400),
    boundary('2026-10-28T08:00:00.000Z', 'auto'), boundary('2026-10-28T09:00:00.000Z', 'auto'),
    boundary('2026-10-28T10:00:00.000Z', 'auto'), boundary('2026-10-28T11:00:00.000Z', 'auto'),
  ]);
}

interface Run { code: number | null; stdout: string; stderr: string }
const run = (args: string[] = []): Run => {
  const r = spawnSync('python3', ['-I', SCRIPT, '--lane', LANE, '--home', home, '--flip', FLIP, '--baseline-since', BASE,
    '--until', UNTIL, '--now', String(NOW_S), ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const report = (args: string[] = []): any => {
  const r = run(['--json', ...args]);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const criterion = (rep: any, name: string): any => rep.criteria.find((c: { name: string }) => c.name === name);

beforeEach(() => {
  home = mkTmp('ccrc-mcw-');
  seq = 0;
});

describe('measure-codex-watch.py: the five criteria', () => {
  it('a lane that meets all five passes, each with its numbers', () => {
    passing();
    const rep = report();
    expect(rep.lane).toBe(LANE);
    expect(rep.mode).toBe('direct');
    expect(rep.windows).toEqual({ baseline: [BASE, FLIP], watch: [FLIP, UNTIL] });
    expect(rep.criteria.map((c: { name: string; verdict: string }) => [c.name, c.verdict])).toEqual([
      ['empty-tool-calls', 'pass'], ['5xx-rate', 'pass'], ['compaction-rate', 'pass'], ['credential', 'pass'],
      ['drift', 'pass'],
    ]);
    expect(rep.verdict).toBe('pass');
    expect(criterion(rep, 'empty-tool-calls').emptyArguments).toBe(0);
    // 4 of 1000 answered against 10 of 1000 POSTs in the log; client-gone and drain-cut shown, never in the rate.
    expect(criterion(rep, '5xx-rate')).toMatchObject({
      watch: { fiveXx: 4, answered: 1000, rate: 0.004 }, baseline: { fiveXx: 10, posts: 1000, rate: 0.01 },
      clientGone: 3, drainCut: 1,
    });
    // 4 automatic compactions over 200 calls before, 4 over 400 after.
    expect(criterion(rep, 'compaction-rate')).toMatchObject({
      baseline: { calls: 200, automatic: 4, rate: 0.02 }, watch: { calls: 400, automatic: 4, rate: 0.01 },
    });
    expect(criterion(rep, 'credential')).toMatchObject({ state: 'ok', lastErrorCode: null, sinceRefreshSeconds: 1500 });
    expect(rep.bridge.requests).toBe(1000);
  });

  it('one empty tool call fails the first criterion, and the lane', () => {
    passing();
    write(path.join(laneDir(), 'bridge.stats.json'),
      JSON.stringify(stats({ outcomes: { '2xx': 990, '4xx': 6, '5xx': 4, emptyArguments: 1 } })));
    const rep = report();
    expect(criterion(rep, 'empty-tool-calls')).toMatchObject({ verdict: 'fail', emptyArguments: 1 });
    expect(rep.verdict).toBe('fail');
  });

  it('a 5xx rate above the baseline fails', () => {
    passing();
    write(logFile(), litellmLog(999, 1));   // baseline 0.001 against the bridge's 0.004
    const rep = report();
    expect(criterion(rep, '5xx-rate').verdict).toBe('fail');
    expect(rep.verdict).toBe('fail');
  });

  it('a compaction rate above the baseline fails', () => {
    passing();
    transcript('.claude-lane-a', 'more', [assistant('2026-10-28T23:00:00.000Z', 'gpt-model-a'),
      ...Array.from({ length: 9 }, (_, i) => boundary(`2026-10-29T0${i}:00:00.000Z`, 'auto'))]);   // 13 over 401
    const rep = report();
    expect(criterion(rep, 'compaction-rate')).toMatchObject({ verdict: 'fail', watch: { calls: 401, automatic: 13 } });
  });

  it.each([
    ['a state that is not ok', { state: 'needs-signin' }],
    ['a last error code', { lastErrorCode: 'refresh_token_reused' }],
    ['a token that has expired', { expiresAt: NOW_S - 60 }],
  ])('the credential fails on %s', (_what, over) => {
    passing();
    writeStatus(over);
    expect(criterion(report(), 'credential').verdict).toBe('fail');
  });

  it('an unexplained name fails the drift criterion and is printed, as the doctor prints it', () => {
    passing();
    write(path.join(laneDir(), 'bridge.stats.json'),
      JSON.stringify(stats({ unexplained: { errorCode: ['a_new_code'], responseHeader: [] } })));
    const rep = report();
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'fail', unexplained: { errorCode: ['a_new_code'] } });
  });
});

describe('measure-codex-watch.py: unmeasured is never pass', () => {
  it('no stats file: the three criteria it feeds are unmeasured, with the reason', () => {
    passing();
    fs.rmSync(path.join(laneDir(), 'bridge.stats.json'));
    const rep = report();
    for (const name of ['empty-tool-calls', '5xx-rate', 'drift']) {
      expect(criterion(rep, name), name).toMatchObject({ verdict: 'unmeasured' });
      expect(criterion(rep, name).reason, name).toMatch(/stats file/);
    }
    expect(rep.verdict).toBe('unmeasured');
  });

  it.each([
    ['another version', { version: 2 }],
    ['another lane', { lane: 'lane-b' }],
  ])('a stats file of %s is not read', (_what, over) => {
    passing();
    write(path.join(laneDir(), 'bridge.stats.json'), JSON.stringify(stats(over)));
    expect(criterion(report(), 'empty-tool-calls').verdict).toBe('unmeasured');
  });

  it('a log with no access line leaves the 5xx criterion unmeasured and still shows the bridge\'s rate', () => {
    passing();
    write(logFile(), 'nothing a reader recognises\n');
    const c = criterion(report(), '5xx-rate');
    expect(c).toMatchObject({ verdict: 'unmeasured', watch: { fiveXx: 4, answered: 1000, rate: 0.004 } });
    expect(c.reason).toMatch(/litellm\.log/);
  });

  it('no log at all is unmeasured, never a baseline of zero', () => {
    passing();
    fs.rmSync(logFile());
    expect(criterion(report(), '5xx-rate').verdict).toBe('unmeasured');
  });

  it('a window with no GPT call leaves the compaction criterion unmeasured', () => {
    passing();
    fs.rmSync(path.join(home, '.claude-lane-a', 'projects', SENTINEL_PROJECT, 'before.jsonl'));
    const c = criterion(report(), 'compaction-rate');
    expect(c).toMatchObject({ verdict: 'unmeasured', baseline: { calls: 0 } });
  });

  it('no status file leaves the credential unmeasured', () => {
    passing();
    fs.rmSync(authDir(), { recursive: true });
    const c = criterion(report(), 'credential');
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toMatch(/no current status/);
  });

  it('a status measured on a credential that has changed since is not current, so unmeasured', () => {
    passing();
    // Every file in the auth directory but the status itself is rewritten: one of them is the credential.
    for (const f of fs.readdirSync(authDir())) {
      const file = path.join(authDir(), f);
      if (fs.readFileSync(file, 'utf8').includes(SENTINEL_CREDENTIAL)) fs.writeFileSync(file, `${SENTINEL_CREDENTIAL} changed`);
    }
    expect(criterion(report(), 'credential').verdict).toBe('unmeasured');
  });

  it('a lane.json that names no stats file leaves the bridge unmeasured, never a guessed name', () => {
    passing();
    write(path.join(laneDir(), 'lane.json'), JSON.stringify(lane({ bridgeFiles: {} })));
    const c = criterion(report(), 'empty-tool-calls');
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toMatch(/names no stats file/);
  });

  it('no lane.json is a refusal that names the file, exit 2', () => {
    const r = run(['--json']);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/lane\.json/);
  });
});

describe('measure-codex-watch.py: what a transcript row counts as', () => {
  it('a call a Claude model answered is not a GPT call, and a compaction after it is not the lane\'s', () => {
    passing();
    transcript('.claude-lane-a', 'claude', [
      ...calls('2026-10-28T12:00:00.000Z', 50, 'claude-model-x'), boundary('2026-10-28T13:30:00.000Z', 'auto'),
    ]);
    expect(criterion(report(), 'compaction-rate')).toMatchObject({ watch: { calls: 400, automatic: 4 } });
  });

  it('a call that appears in two files, or twice in one, is counted once', () => {
    passing();
    const twice = assistant('2026-10-28T15:00:00.000Z', 'gpt-model-a', 'msg-shared');
    transcript('.claude-lane-a', 'copy-1', [twice, twice]);
    transcript('.claude-lane-a', 'copy-2', [twice]);
    expect(criterion(report(), 'compaction-rate').watch.calls).toBe(401);
  });

  it('a boundary carried into a second file is counted once', () => {
    passing();
    const carried = boundary('2026-10-28T16:00:00.000Z', 'auto', 'row-carried');
    const before = assistant('2026-10-28T15:59:00.000Z', 'gpt-model-a', 'msg-before-carried');
    transcript('.claude-lane-a', 'carry-1', [before, carried]);
    transcript('.claude-lane-a', 'carry-2', [before, carried]);
    expect(criterion(report(), 'compaction-rate').watch).toMatchObject({ calls: 401, automatic: 5 });
  });

  it('a manual compaction is shown and is not in the rate', () => {
    passing();
    transcript('.claude-lane-a', 'manual', [
      assistant('2026-10-28T17:00:00.000Z', 'gpt-model-a'), boundary('2026-10-28T17:05:00.000Z', 'manual'),
    ]);
    expect(criterion(report(), 'compaction-rate').watch).toMatchObject({ calls: 401, automatic: 4, manual: 1 });
  });

  it('an API error row is not a call', () => {
    passing();
    transcript('.claude-lane-a', 'errors', [
      assistant('2026-10-28T17:59:00.000Z', 'gpt-model-a'),
      assistant('2026-10-28T18:00:00.000Z', '<synthetic>', undefined, { isApiErrorMessage: true }),
    ]);
    const c = criterion(report(), 'compaction-rate');
    expect(c.watch.calls).toBe(401);
    expect(c.watch.apiErrors).toBe(1);
  });

  it('a row outside both windows is not counted', () => {
    passing();
    transcript('.claude-lane-a', 'early', calls('2026-10-20T00:00:00.000Z', 30));
    transcript('.claude-lane-a', 'late', calls('2026-11-04T00:00:00.000Z', 30));
    expect(criterion(report(), 'compaction-rate')).toMatchObject({ baseline: { calls: 200 }, watch: { calls: 400 } });
  });

  it('another lane\'s config directory is in the box-wide figure and not in the lane\'s', () => {
    passing();
    transcript('.claude-lane-b', 'other', calls('2026-10-28T00:00:00.000Z', 25));
    const rep = report();
    expect(criterion(rep, 'compaction-rate').watch.calls).toBe(400);
    expect(rep.transcripts.box.watch.calls).toBe(425);
  });
});

describe('measure-codex-watch.py: read-only, and nothing but counts leaves', () => {
  it('prints no prompt text, session id, project path, request id or credential byte, in either form', () => {
    passing();
    const text = run();
    const json = run(['--json']);
    expect(text.code, text.stderr).toBe(0);
    expect(json.code, json.stderr).toBe(0);
    for (const s of SENTINELS) {
      for (const out of [text.stdout, text.stderr, json.stdout, json.stderr]) expect(out, s).not.toContain(s);
    }
  });

  it('the text form carries the verdict and each criterion on a line of its own', () => {
    passing();
    const r = run();
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^verdict: pass$/m);
    for (const name of ['empty-tool-calls', '5xx-rate', 'compaction-rate', 'credential', 'drift']) {
      expect(r.stdout, name).toMatch(new RegExp(`^${name}: pass\\b`, 'm'));
    }
  });

  it('writes nothing under the home it reads', () => {
    passing();
    const list = (): string => spawnSync('find', [home, '-type', 'f', '-newer', path.join(laneDir(), 'lane.json')],
      { encoding: 'utf8' }).stdout;
    const before = list();
    expect(run().code).toBe(0);
    expect(list()).toBe(before);
  });

  it('opens no file for writing and runs no subprocess', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/\bsubprocess\b|os\.system|os\.popen|os\.exec|os\.spawn/);
    expect(src).not.toMatch(/open\([^)]*["'][wax+]/);
    expect(src).not.toMatch(/\.(unlink|remove|rename|replace|mkdir|makedirs|rmdir|write_text|write_bytes|chmod)\(/);
  });

  it.each([
    ['a lane id that is not one', ['--lane', '../lane-a']],
    ['a stamp that is not UTC', ['--flip', '2026-10-27 06:26']],
    ['a watch window that ends before it starts', ['--until', '2026-10-01T00:00:00Z']],
  ])('refuses %s, exit 2', (_what, args) => {
    passing();
    const r = run(args);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
  });
});
