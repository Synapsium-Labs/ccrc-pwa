// `deploy/measure-codex-watch.py`, the Codex bridge watch's instrument (plan 2026-11-10 codex-bridge Stage 4, Task 0;
// the Stage 2 runbook's step 5). Every reading is pinned on a constructed fixture HOME with a known answer: a lane
// directory with `lane.json` and the bridge's stats file (version 1, the shape `ccd/codexbridge/stats.py` documents),
// the auth library's status file (WRITTEN BY THE LIBRARY ITSELF, over a placeholder credential, so the instrument reads
// the bytes the writer writes), a LiteLLM log, the lane's model files (its advance history and its measured windows),
// and transcripts under the lane's config directory and another one.
// "Unmeasured is never pass" and "nothing but counts leaves" are each pinned: the second by sentinels planted in a
// prompt, a path, a session id, a request id, a row's uuid, a message id, a version field and an advance reason.
// Every statistic the instrument prints is re-computed HERE by another method (exact rationals, a recurrence, a
// closed form), never by calling the instrument's own arithmetic.
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
const SENTINEL_UUID = 'SENTINEL-ROW-UUID-71aa';
const SENTINEL_MESSAGE = 'SENTINEL-MESSAGE-ID-0f3c';
const SENTINEL_VERSION = 'SENTINEL-VERSION-6e21';
const SENTINEL_REASON = 'SENTINEL-ADVANCE-REASON-3b9d';
const SENTINELS = [SENTINEL_TEXT, SENTINEL_SESSION, SENTINEL_PROJECT, SENTINEL_REQUEST, SENTINEL_CREDENTIAL,
  SENTINEL_UUID, SENTINEL_MESSAGE, SENTINEL_VERSION, SENTINEL_REASON];
const NOTE = 'sessions cluster: p is indicative';

let home: string;
let seq = 0;

const laneDir = (): string => path.join(home, '.ccrc', 'codex', LANE);
const authDir = (): string => path.join(home, '.local', 'share', 'ccrc', 'codex', `${LANE}-abc123`);
const logFile = (): string => path.join(home, '.ccrc', 'logs', 'codex', LANE, 'litellm.log');
const modelsFile = (kind: 'advance' | 'windows'): string => path.join(home, '.ccrc', 'models', `${LANE}.${kind}.json`);
const write = (file: string, body: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

type Stats = Record<string, unknown>;
const OUTCOMES = { '2xx': 990, '4xx': 6, '5xx': 4, 'client-gone': 3, 'drain-cut': 1, compactionRequests: 7, countTokens: 40 };
const stats = (over: Stats = {}): Stats => ({
  version: 1, lane: LANE, since: '2026-10-27T06:26:05.000Z', startedAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-11-03T06:59:00.000Z',
  routes: { 'backend/gpt-model-a': { requests: 900, bytesPerToken: 3.5, promptTokensMax: 300000, promptTokensLast: 1200 },
            'backend/gpt-model-b': { requests: 100, bytesPerToken: 3.5, promptTokensMax: 90000, promptTokensLast: 800 } },
  refusals: {},
  outcomes: OUTCOMES,
  names: { errorCode: { server_is_overloaded: 3 } },
  unexplained: { errorCode: [], responseHeader: [] },
  usageHeaders: null, lastUpstreamRequestId: SENTINEL_REQUEST,
  store: { state: 'ok', reason: null, at: null, setAside: null },
  ...over,
});
const writeStats = (over: Stats = {}): void => write(path.join(laneDir(), 'bridge.stats.json'), JSON.stringify(stats(over)));

/** The lane's status file, written by the auth library's own `write_status` under its lock, over a placeholder
 *  credential whose bytes are a sentinel: the status is current only while its identity is that file's. With
 *  `credential: false` no credential file is made, so the status is measured on none (identity null). */
function writeStatus(over: Record<string, unknown> = {}, opts: { credential?: boolean } = {}): void {
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
    'unsaved = fields.pop("unsaved", False)',
    'p = lib.paths_for(d)',
    'if sys.argv[5] == "1" and not os.path.exists(p.credential):',
    '    fd = os.open(p.credential, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)',
    '    os.write(fd, sys.argv[4].encode()); os.close(fd)',
    'with lib.held(d):',
    '    ok = lib.write_status(d, identity=lib._current_identity(p.credential), unsaved=unsaved, **fields)',
    'sys.exit(0 if ok else 1)',
  ].join('\n'), AUTH_LIB, authDir(), JSON.stringify(fields), SENTINEL_CREDENTIAL, opts.credential === false ? '0' : '1'],
  { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
}
/** The status file the library wrote, found by its content (its name is the library's to spell). */
const statusFile = (): string => {
  const f = fs.readdirSync(authDir()).map((n) => path.join(authDir(), n))
    .find((p) => fs.statSync(p).isFile() && fs.readFileSync(p, 'utf8').includes('"configHash"'));
  expect(f, 'the library wrote no status file').toBeTruthy();
  return f!;
};
/** The library's own incident sets, read from the library: this suite spells no code list either. */
const libraryCodes = (): string[] => {
  const r = spawnSync('python3', ['-I', '-c', [
    'import importlib.util, sys', 'sys.dont_write_bytecode = True',
    'spec = importlib.util.spec_from_file_location("ccgpt_auth", sys.argv[1])',
    'lib = importlib.util.module_from_spec(spec)', 'sys.modules["ccgpt_auth"] = lib', 'spec.loader.exec_module(lib)',
    'print("\\n".join(sorted(lib.NEEDS_SIGNIN_CODES | lib.CONFIG_ERROR_CODES)))',
  ].join('\n'), AUTH_LIB], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.split('\n').filter(Boolean);
};

const lane = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: LANE, configDir: '.claude-lane-a', authDir: `.local/share/ccrc/codex/${LANE}-abc123`, proxyPort: 14100,
  litellmPort: 14101, bridge: 'direct', upstream: 'backend',
  bridgeFiles: { stats: 'bridge.stats.json', store: 'reasoning.sqlite', recordings: 'recordings' }, ...over,
});

/** A LiteLLM log: `ok` message POSTs answered 200 (every other one with a query string, as Claude Code sends them),
 *  `bad` answered 500, `refused` answered 400, `countTokens` count_tokens POSTs answered 200, and lines the reader
 *  must not count. */
const litellmLog = (ok: number, bad: number, more: { refused?: number; countTokens?: number } = {}): string => [
  'INFO:     Started server process [1234]',
  'INFO:     127.0.0.1:50001 - "GET /health/liveliness HTTP/1.1" 200 OK',
  'INFO:     127.0.0.1:50001 - "GET /v1/models HTTP/1.1" 200 OK',
  ...Array.from({ length: ok }, (_, i) =>
    `INFO:     127.0.0.1:${50002 + i} - "POST /v1/messages${i % 2 ? '?beta=true' : ''} HTTP/1.1" 200 OK`),
  ...Array.from({ length: bad }, (_, i) => `INFO:     127.0.0.1:${60000 + i} - "POST /v1/messages HTTP/1.1" 500 Internal Server Error`),
  ...Array.from({ length: more.refused ?? 0 }, () => 'INFO:     127.0.0.1:61000 - "POST /v1/messages?beta=true HTTP/1.1" 400 Bad Request'),
  ...Array.from({ length: more.countTokens ?? 0 }, () =>
    'INFO:     127.0.0.1:62000 - "POST /v1/messages/count_tokens?beta=true HTTP/1.1" 200 OK'),
  `a line of text that is not an access line: ${SENTINEL_TEXT}`,
].join('\n') + '\n';

type Extra = Record<string, unknown>;
const assistant = (at: string, model: string, id?: string, extra: Extra = {}): string =>
  JSON.stringify({ type: 'assistant', uuid: `row-${++seq}`, sessionId: SENTINEL_SESSION, timestamp: at, version: '2.1.300',
    message: { id: id ?? `msg-${seq}`, model, role: 'assistant', content: [{ type: 'text', text: SENTINEL_TEXT }] },
    ...extra });
const user = (at: string): string =>
  JSON.stringify({ type: 'user', uuid: `row-${++seq}`, sessionId: SENTINEL_SESSION, timestamp: at,
    message: { role: 'user', content: SENTINEL_TEXT } });
const boundary = (at: string, trigger: 'auto' | 'manual', uuid?: string, extra: Extra = {}, preTokens: number | null = 380000): string =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: uuid ?? `row-${++seq}`, sessionId: SENTINEL_SESSION,
    timestamp: at, content: 'Conversation compacted', compactMetadata: { trigger, preTokens }, ...extra });
const transcript = (configDir: string, name: string, rows: string[]): void =>
  write(path.join(home, configDir, 'projects', SENTINEL_PROJECT, `${name}.jsonl`), rows.join('\n') + '\n');
const plus = (from: string, minutes: number): string => new Date(Date.parse(from) + minutes * 60_000).toISOString();

/** `n` GPT calls spread inside a window that starts at `from` (one a minute). */
const calls = (from: string, n: number, model = 'gpt-model-a', extra: Extra = {}): string[] =>
  Array.from({ length: n }, (_, i) => assistant(plus(from, i + 1), model, undefined, extra));

interface SessionOpts { model?: string; preTokens?: number | null; extra?: Extra; config?: string }
/** One transcript file: `n` calls of a model from `from`, one a minute, then `autos` automatic boundaries. */
const session = (name: string, from: string, n: number, autos: number, o: SessionOpts = {}): void =>
  transcript(o.config ?? '.claude-lane-a', name, [user(from), ...calls(from, n, o.model, o.extra),
    ...Array.from({ length: autos }, (_, i) => boundary(plus(from, n + 1 + i), 'auto', undefined, o.extra, o.preTokens))]);

/** The passing fixture. Baseline: five sessions, 400 GPT calls and 20 automatic compactions (rate 0.05); watch: 400
 *  calls and 4 (rate 0.01). The 5xx: 4 of 994 against 10 of 1000. */
function passing(): void {
  write(path.join(laneDir(), 'lane.json'), JSON.stringify(lane()));
  writeStats();
  writeStatus();
  write(logFile(), litellmLog(990, 10));
  transcript('.claude-lane-a', 'before', [
    user('2026-10-23T00:00:00.000Z'), ...calls('2026-10-23T00:00:00.000Z', 200),
    boundary('2026-10-23T04:00:00.000Z', 'auto'), boundary('2026-10-23T05:00:00.000Z', 'auto'),
    boundary('2026-10-23T06:00:00.000Z', 'auto'), boundary('2026-10-23T07:00:00.000Z', 'auto'),
  ]);
  session('before-2', '2026-10-24T01:00:00.000Z', 50, 4);
  session('before-3', '2026-10-25T01:00:00.000Z', 50, 4);
  session('before-4', '2026-10-25T12:00:00.000Z', 50, 4);
  session('before-5', '2026-10-26T01:00:00.000Z', 50, 4);
  transcript('.claude-lane-a', 'after', [
    user('2026-10-28T00:00:00.000Z'), ...calls('2026-10-28T00:00:00.000Z', 400),
    boundary('2026-10-28T08:00:00.000Z', 'auto'), boundary('2026-10-28T09:00:00.000Z', 'auto'),
    boundary('2026-10-28T10:00:00.000Z', 'auto'), boundary('2026-10-28T11:00:00.000Z', 'auto'),
  ]);
}
const removeTranscript = (name: string, config = '.claude-lane-a'): void =>
  fs.rmSync(path.join(home, config, 'projects', SENTINEL_PROJECT, `${name}.jsonl`));

type HistoryEntry = Record<string, unknown>;
/** The lane's advance file, in the shape `shared/model-advance.mjs`'s `parseAdvance` reads. */
const writeAdvance = (history: Record<string, HistoryEntry[]>): void => {
  const classes: Record<string, unknown> = {};
  for (const c of ['haiku', 'sonnet', 'opus', 'fable']) {
    classes[c] = { family: null, hold: null, previous: null, history: history[c] ?? [] };
  }
  write(modelsFile('advance'), JSON.stringify({ v: 1, classes, pending: null }));
};
const move = (at: string, from: string, to: string): HistoryEntry =>
  ({ at, how: 'advance', from, to, ok: true, canary: 'passed', reason: SENTINEL_REASON });
/** The lane's measured windows, in the shape `deploy/models-op.mjs` writes. */
const writeWindows = (windows: Record<string, Record<string, unknown>>): void =>
  write(modelsFile('windows'), JSON.stringify({ windows }));

const CUT = '2026-10-24T00:00:00Z';
/** An advance at CUT cuts the baseline, and the comparable baseline after it keeps its power. Before the cut: one
 *  session of 200 gpt-model-a calls and 40 automatic boundaries at `prePre`. After it: five sessions of 60 calls and 4
 *  boundaries each (300 and 20) at `postPre`. The watch: 400 calls and `watchAutos` boundaries at 168k. */
function cutFixture(prePre: number, postPre: number, watchAutos: number): void {
  write(path.join(laneDir(), 'lane.json'), JSON.stringify(lane()));
  writeStats();
  writeStatus();
  write(logFile(), litellmLog(990, 10));
  writeAdvance({ sonnet: [move(CUT, 'gpt-model-old', 'gpt-model-a')] });
  session('old', '2026-10-23T00:00:00.000Z', 200, 40, { preTokens: prePre });
  for (let i = 0; i < 5; i++) session(`new-${i}`, `2026-10-2${4 + (i % 3)}T0${i + 1}:00:00.000Z`, 60, 4, { preTokens: postPre });
  session('w', '2026-10-28T00:00:00.000Z', 400, watchAutos, { preTokens: 168000 });
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

// ── independent arithmetic (never the instrument's) ─────────────────────────────────────────────────────────────
const choose = (n: number, k: number): bigint => {
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
};
/** P(X >= x), X ~ Binomial(n, a / (a + b)), in exact rationals. */
const exactBinomSf = (x: number, n: number, a: number, b: number): number => {
  const A = BigInt(a);
  const B = BigInt(b);
  let num = 0n;
  for (let k = x; k <= n; k++) num += choose(n, k) * A ** BigInt(k) * B ** BigInt(n - k);
  const den = (A + B) ** BigInt(n);
  return Number((num * 10n ** 30n) / den) / 1e30;
};
/** P(X <= x), X ~ Binomial(n, p), by the pmf's recurrence from (1 - p)^n. */
const recurrenceCdf = (x: number, n: number, p: number): number => {
  let pmf = Math.exp(n * Math.log1p(-p));
  let sum = pmf;
  for (let k = 0; k < x; k++) {
    pmf *= ((n - k) / (k + 1)) * (p / (1 - p));
    sum += pmf;
  }
  return sum;
};
/** P(X >= x), X ~ Poisson(lambda), by the pmf's recurrence. */
const poissonSf = (x: number, lambda: number): number => {
  let term = Math.exp(-lambda);
  let below = 0;
  for (let k = 0; k < x; k++) {
    below += term;
    term *= lambda / (k + 1);
  }
  return 1 - below;
};
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

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
    expect(rep.windows).toEqual({ baseline: [BASE, FLIP], comparable: [BASE, FLIP], watch: [FLIP, UNTIL] });
    expect(rep.criteria.map((c: { name: string; verdict: string }) => [c.name, c.verdict])).toEqual([
      ['empty-tool-calls', 'pass'], ['5xx-rate', 'pass'], ['compaction-rate', 'pass'], ['credential', 'pass'],
      ['drift', 'pass'],
    ]);
    expect(rep.verdict).toBe('pass');
    expect(criterion(rep, 'empty-tool-calls').emptyArguments).toBe(0);
    // 4 of 994 (2xx + 5xx) against 10 of 1000 message POSTs; 4xx, client-gone and drain-cut shown, never in the rate.
    expect(criterion(rep, '5xx-rate')).toMatchObject({
      watch: { fiveXx: 4, twoXx: 990, fourXx: 6, n: 994 }, baseline: { fiveXx: 10, twoXx: 990, fourXx: 0, n: 1000, rate: 0.01 },
      clientGone: 3, drainCut: 1,
    });
    // 20 automatic compactions over 400 calls in five sessions before; 4 over 400 after.
    expect(criterion(rep, 'compaction-rate')).toMatchObject({
      baseline: { calls: 400, automatic: 20, rate: 0.05, sessions: 5 },
      comparable: { calls: 400, automatic: 20, rate: 0.05, sessions: 5 },
      watch: { calls: 400, automatic: 4, rate: 0.01, sessions: 1 },
      standardised: { expected: 20, observed: 4, note: NOTE },
    });
    expect(criterion(rep, 'credential')).toMatchObject({ state: 'ok', lastErrorCode: null, sinceRefreshSeconds: 1500 });
    expect(rep.bridge.requests).toBe(1000);
    expect(rep.events).toEqual([]);
  });

  it('one empty tool call fails the first criterion, and the lane', () => {
    passing();
    writeStats({ outcomes: { '2xx': 990, '4xx': 6, '5xx': 4, emptyArguments: 1 } });
    const rep = report();
    expect(criterion(rep, 'empty-tool-calls')).toMatchObject({ verdict: 'fail', emptyArguments: 1 });
    expect(rep.verdict).toBe('fail');
  });

  it('an unexplained name fails the drift criterion and is printed, as the doctor prints it', () => {
    passing();
    writeStats({ unexplained: { errorCode: ['a_new_code'], responseHeader: [] } });
    const rep = report();
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'fail', unexplained: { errorCode: ['a_new_code'] } });
  });

  // A substitution from a request without Claude Code's claude-code beta is counted under foreignSubstitution
  // (ccd/codexbridge/known.py), whose explained set is empty on purpose: it fails drift as any unexplained name does,
  // printed under its own family and never folded into modelSubstitution.
  it('a foreignSubstitution name fails the drift criterion and is printed under its own family', () => {
    passing();
    writeStats({ unexplained: { errorCode: [], foreignSubstitution: ['claude-opus-5-5'], modelSubstitution: ['claude-fallback-x'] } });
    const rep = report();
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'fail' });
    expect(criterion(rep, 'drift').unexplained).toEqual({ foreignSubstitution: ['claude-opus-5-5'], modelSubstitution: ['claude-fallback-x'] });
    expect(rep.verdict).toBe('fail');
    const text = run();
    expect(text.stdout).toMatch(/^drift: fail\b/m);
    expect(text.stdout).toContain('foreignSubstitution');
    expect(text.stdout).toContain('claude-opus-5-5');
    writeStats({ unexplained: { errorCode: [], foreignSubstitution: ['claude-opus-5-5'] } });
    expect(criterion(report(), 'drift')).toMatchObject({ verdict: 'fail', unexplained: { foreignSubstitution: ['claude-opus-5-5'] } });
    expect(criterion(report(), 'drift').unexplained).not.toHaveProperty('modelSubstitution');
  });
});

// The bridge carries an unexplained name until a reviewed change to known.py explains it, so the list is cumulative.
// With `--drift-baseline <a previous --json reading>`, drift reads GROWTH since that reading: a carried name passes
// only while its count holds; a new name, or a carried one still growing, fails; a counter that went backwards means
// the file is not the one the baseline read, so unmeasured. Without the flag drift is exactly what it was.
const SENTINEL_BASELINE = 'SENTINEL-BASELINE-PATH-7c42';
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-4-6';
/** The stats file's two substitution families: `model` and `foreign` map a name to its count in `names`, and every
 *  one of them is listed as unexplained. */
const substitutions = (model: Record<string, number>, foreign: Record<string, number> = {}, over: Stats = {}): Stats => ({
  names: { errorCode: { server_is_overloaded: 3 }, modelSubstitution: model, foreignSubstitution: foreign },
  unexplained: { errorCode: [], modelSubstitution: Object.keys(model), foreignSubstitution: Object.keys(foreign) },
  ...over,
});
const baselineFile = (): string => path.join(home, 'readings', SENTINEL_BASELINE, 'drift-baseline.json');
/** Take a --json reading now and keep it where the operator keeps one; `edit` changes it first. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const keepBaseline = (edit?: (rep: any) => void): string => {
  const rep = report();
  if (edit) edit(rep);
  write(baselineFile(), JSON.stringify(rep, null, 1) + '\n');
  return baselineFile();
};
// the second reading, ten minutes after the baseline (inside the fixture credential's life, so only drift moves)
const LATER = ['--now', String(NOW_S + 600)];
const withBaseline = (file: string = baselineFile()): string[] => ['--drift-baseline', file, ...LATER];
const TAKEN = '2026-11-03T07:00:00Z';
/** The lane answered 100 more requests between the baseline and the later reading (2xx 990 -> 1090). */
const TRAFFIC: Stats = { outcomes: { ...OUTCOMES, '2xx': 1090 } };
const SINCE = '2026-10-27T06:26:05.000Z';

describe('measure-codex-watch.py: drift reads growth since a baseline reading', () => {
  it('a plain reading carries each unexplained name\'s count, 0 for one the counters do not hold, and when it was taken', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 12 }, {}, {
      unexplained: { errorCode: [], modelSubstitution: [OPUS, SONNET], foreignSubstitution: ['a-name-not-counted'] },
    }));
    const rep = report();
    expect(rep.takenAt).toBe(TAKEN);
    expect(rep.bridge.unexplained).toEqual({ foreignSubstitution: ['a-name-not-counted'], modelSubstitution: [OPUS, SONNET] });
    expect(rep.bridge.unexplainedCounts).toEqual({
      foreignSubstitution: { 'a-name-not-counted': 0 }, modelSubstitution: { [OPUS]: 496, [SONNET]: 12 },
    });
    passing();
    expect(report().bridge.unexplainedCounts).toEqual({});
  });

  it('with no baseline, drift is exactly what it was: any unexplained name fails, and the text says how to take one', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    const rep = report();
    expect(criterion(rep, 'drift')).toEqual({ name: 'drift', verdict: 'fail', unexplained: { modelSubstitution: [OPUS] } });
    expect(rep.verdict).toBe('fail');
    const text = run();
    expect(text.stdout).toMatch(/^drift: fail\b/m);
    expect(text.stdout).toMatch(/^drift baseline: none\b.*--drift-baseline/m);
  });

  it('a carried name whose count held since the baseline passes, with both counts and the baseline\'s stamps', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 12 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 12 }, {}, TRAFFIC));
    const rep = report(withBaseline());
    expect(rep.takenAt).toBe('2026-11-03T07:10:00Z');
    expect(criterion(rep, 'drift')).toMatchObject({
      verdict: 'pass', unexplained: { modelSubstitution: [OPUS, SONNET] },
      baseline: { takenAt: TAKEN, since: SINCE }, answeredSince: 100,
      names: [
        { family: 'modelSubstitution', name: OPUS, baseline: 496, now: 496, state: 'held' },
        { family: 'modelSubstitution', name: SONNET, baseline: 12, now: 12, state: 'held' },
      ],
    });
    expect(rep.verdict).toBe('pass');
    const text = run(withBaseline());
    expect(text.stdout).toMatch(/^drift: pass\b/m);
    expect(text.stdout).toMatch(new RegExp(`^drift baseline: taken at ${TAKEN}, stats since ${SINCE}, 100 requests answered since$`, 'm'));
    expect(text.stdout).toMatch(new RegExp(`^ {2}modelSubstitution ${OPUS}: 496 then, 496 now: held$`, 'm'));
  });

  it('a carried name whose count grew since the baseline fails', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 12 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 497, [SONNET]: 12 }));
    const rep = report(withBaseline());
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'fail', names: [
      { family: 'modelSubstitution', name: OPUS, baseline: 496, now: 497, state: 'grew' },
      { family: 'modelSubstitution', name: SONNET, baseline: 12, now: 12, state: 'held' },
    ] });
    expect(rep.verdict).toBe('fail');
    expect(run(withBaseline()).stdout).toMatch(new RegExp(`^ {2}modelSubstitution ${OPUS}: 496 then, 497 now: grew$`, 'm'));
  });

  it('a name the baseline did not list fails, even at a count it could have had', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 1 }));
    const rep = report(withBaseline());
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'fail', names: [
      { family: 'modelSubstitution', name: OPUS, baseline: 496, now: 496, state: 'held' },
      { family: 'modelSubstitution', name: SONNET, baseline: null, now: 1, state: 'new' },
    ] });
    expect(run(withBaseline()).stdout).toMatch(new RegExp(`^ {2}modelSubstitution ${SONNET}: none then, 1 now: new$`, 'm'));
  });

  it('a counter that went backwards is unmeasured: the stats file is not the one the baseline read', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 400 }));
    const rep = report(withBaseline());
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'unmeasured', names: [
      { family: 'modelSubstitution', name: OPUS, baseline: 496, now: 400, state: 'fell' },
    ] });
    expect(criterion(rep, 'drift').reason).toMatch(/went backwards/);
    expect(rep.verdict).toBe('unmeasured');
  });

  it('a fail outranks a counter that went backwards', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 12 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 400, [SONNET]: 13 }));
    expect(criterion(report(withBaseline()), 'drift').verdict).toBe('fail');
  });

  it('a baseline name a reviewed change has explained since passes, reported as explained since', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 12 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 496 }, {}, {
      ...TRAFFIC,
      names: { modelSubstitution: { [OPUS]: 496, [SONNET]: 30 } },
      unexplained: { modelSubstitution: [OPUS] },
    }));
    const rep = report(withBaseline());
    // its count is read from the stats file's names, as every count is: it grew, and explained, that is no drift
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'pass', names: [
      { family: 'modelSubstitution', name: OPUS, baseline: 496, now: 496, state: 'held' },
      { family: 'modelSubstitution', name: SONNET, baseline: 12, now: 30, state: 'explained since' },
    ] });
    expect(run(withBaseline()).stdout).toMatch(new RegExp(`^ {2}modelSubstitution ${SONNET}: 12 then, 30 now: explained since$`, 'm'));
  });

  it('the foreignSubstitution family is read the same way, under its own family', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }, { [OPUS]: 7 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 496 }, { [OPUS]: 7 }, TRAFFIC));
    expect(criterion(report(withBaseline()), 'drift')).toMatchObject({ verdict: 'pass', names: [
      { family: 'foreignSubstitution', name: OPUS, baseline: 7, now: 7, state: 'held' },
      { family: 'modelSubstitution', name: OPUS, baseline: 496, now: 496, state: 'held' },
    ] });
    writeStats(substitutions({ [OPUS]: 496 }, { [OPUS]: 8 }));
    expect(criterion(report(withBaseline()), 'drift')).toMatchObject({ verdict: 'fail', names: [
      { family: 'foreignSubstitution', name: OPUS, baseline: 7, now: 8, state: 'grew' },
      { family: 'modelSubstitution', name: OPUS, baseline: 496, now: 496, state: 'held' },
    ] });
    // a name the baseline held under one family is new under the other
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 2 }, { [OPUS]: 7 }, { names: {
      modelSubstitution: { [OPUS]: 496 }, foreignSubstitution: { [OPUS]: 7, [SONNET]: 2 } },
    unexplained: { modelSubstitution: [OPUS], foreignSubstitution: [OPUS, SONNET] } }));
    expect(criterion(report(withBaseline()), 'drift')).toMatchObject({ verdict: 'fail', names: [
      { family: 'foreignSubstitution', name: OPUS, state: 'held' },
      { family: 'foreignSubstitution', name: SONNET, baseline: null, now: 2, state: 'new' },
      { family: 'modelSubstitution', name: OPUS, state: 'held' },
    ] });
  });

  it('a baseline reading of another lane is unmeasured, never compared', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline((rep) => { rep.lane = 'lane-b'; });
    const d = criterion(report(withBaseline()), 'drift');
    expect(d).toMatchObject({ verdict: 'unmeasured' });
    expect(d.reason).toMatch(/another lane/);
    expect(d).not.toHaveProperty('names');
  });

  it('a stats file replaced or reset since the baseline (its since differs) is unmeasured, saying so', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 496 }, {}, { since: '2026-11-02T00:00:00.000Z' }));
    const d = criterion(report(withBaseline()), 'drift');
    expect(d).toMatchObject({ verdict: 'unmeasured' });
    expect(d.reason).toMatch(/replaced or reset since the baseline/);
    expect(d.reason).toContain('2026-11-02T00:00:00.000Z');
    expect(d.reason).toContain(SINCE);
  });

  it('a baseline reading from before this build has no per-name counts: unmeasured, asking for a new reading', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline((rep) => { delete rep.bridge.unexplainedCounts; delete rep.takenAt; });
    const d = criterion(report(withBaseline()), 'drift');
    expect(d).toMatchObject({ verdict: 'unmeasured',
      reason: 'the baseline reading has no per-name counts; take a new reading with this build' });
  });

  it('a baseline reading whose counts are of another shape, or that measured no bridge, is unmeasured', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    for (const counts of [[], { modelSubstitution: [OPUS] }, { modelSubstitution: { [OPUS]: -1 } },
      { modelSubstitution: { [OPUS]: true } }, { modelSubstitution: { 'a name': 1 } }]) {
      keepBaseline((rep) => { rep.bridge.unexplainedCounts = counts; });
      const d = criterion(report(withBaseline()), 'drift');
      expect(d, JSON.stringify(counts)).toMatchObject({ verdict: 'unmeasured' });
      expect(d.reason, JSON.stringify(counts)).toMatch(/another shape/);
    }
    keepBaseline((rep) => { rep.bridge = { unmeasured: 'the stats file is absent' }; });
    expect(criterion(report(withBaseline()), 'drift').reason).toMatch(/measured no bridge/);
  });

  it('an absent, unreadable, non-JSON, foreign or oversized baseline is unmeasured with its reason', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    const cases: [string, () => void, RegExp][] = [
      ['absent', () => fs.rmSync(baselineFile(), { force: true }), /is absent/],
      ['a directory', () => fs.mkdirSync(baselineFile(), { recursive: true }), /not a regular file/],
      // root reads a mode-000 file, so the case is left out there
      ...(process.getuid?.() === 0 ? [] : [['unreadable (mode 000)', () => {
        write(baselineFile(), JSON.stringify(report()));
        fs.chmodSync(baselineFile(), 0o000);
      }, /is unreadable/] as [string, () => void, RegExp]]),
      ['not JSON', () => write(baselineFile(), '{"lane": '), /not JSON/],
      ['a list', () => write(baselineFile(), '[1]'), /not a --json reading of this instrument/],
      ['another object', () => write(baselineFile(), JSON.stringify({ lane: LANE })), /not a --json reading of this instrument/],
      // a valid reading padded past the cap: refused for its size, never parsed
      ['oversized', () => {
        const rep = report();
        write(baselineFile(), JSON.stringify(rep) + ' '.repeat(4 * 2 ** 20));
      }, /larger than \d+ bytes/],
    ];
    for (const [what, make, why] of cases) {
      fs.rmSync(path.join(home, 'readings'), { recursive: true, force: true });
      make();
      const rep = report(withBaseline());
      const d = criterion(rep, 'drift');
      expect(d, what).toMatchObject({ verdict: 'unmeasured' });
      expect(d.reason, what).toMatch(why);
      expect(rep.verdict, what).toBe('unmeasured');
    }
  });

  it('a marker is counted whether it is listed or not, since a restart drops it from the list and keeps its count', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 4 }, {}, {
      names: { modelSubstitution: { [OPUS]: 4, overflow: 10 }, responseHeader: { unrecognised: 2, 'x-a': 1 } },
      unexplained: { modelSubstitution: [OPUS] },
    }));
    const rep = report();
    expect(rep.bridge.unexplained).toEqual({ modelSubstitution: [OPUS] });
    expect(rep.bridge.unexplainedCounts).toEqual({
      modelSubstitution: { [OPUS]: 4, overflow: 10 }, responseHeader: { unrecognised: 2 },
    });
  });

  it('a marker whose count grew since the baseline fails, listed then and not now, or listed at neither reading', () => {
    passing();
    // listed at the baseline; a restart (any rollout) then drops it from the list while five more names arrive
    writeStats(substitutions({ [OPUS]: 496, overflow: 10 }));
    keepBaseline();
    const unlisted = (overflow: number, over: Stats = TRAFFIC): Stats => substitutions({ [OPUS]: 496 }, {}, {
      ...over, names: { modelSubstitution: { [OPUS]: 496, overflow } },
    });
    writeStats(unlisted(15));
    let rep = report(withBaseline());
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'fail', names: [
      { family: 'modelSubstitution', name: OPUS, state: 'held' },
      { family: 'modelSubstitution', name: 'overflow', baseline: 10, now: 15, state: 'grew' },
    ] });
    expect(rep.verdict).toBe('fail');
    // dropped from the list at both readings
    writeStats(unlisted(10, {}));
    keepBaseline();
    writeStats(unlisted(15));
    expect(criterion(report(withBaseline()), 'drift')).toMatchObject({ verdict: 'fail', names: [
      { name: OPUS, state: 'held' }, { name: 'overflow', baseline: 10, now: 15, state: 'grew' },
    ] });
    writeStats(unlisted(10));
    expect(criterion(report(withBaseline()), 'drift')).toMatchObject({ verdict: 'pass', names: [
      { name: OPUS, state: 'held' }, { name: 'overflow', baseline: 10, now: 10, state: 'held' },
    ] });
    // a marker never explained: gone from the counters, it went backwards, never `explained since`
    writeStats(substitutions({ [OPUS]: 496 }, {}, TRAFFIC));
    rep = report(withBaseline());
    expect(criterion(rep, 'drift')).toMatchObject({ verdict: 'unmeasured', names: [
      { name: OPUS, state: 'held' }, { name: 'overflow', baseline: 10, now: 0, state: 'fell' },
    ] });
  });

  it('a stats since unreadable now or in the baseline reading is unmeasured: whether it is the same file is unknown', () => {
    passing();
    const why = /since is unreadable now or in the baseline reading/;
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline((rep) => { delete rep.bridge.since; });
    writeStats(substitutions({ [OPUS]: 496 }, {}, { ...TRAFFIC, since: 'not a stamp' }));
    let d = criterion(report(withBaseline()), 'drift');
    expect(d).toMatchObject({ verdict: 'unmeasured' });
    expect(d.reason).toMatch(why);
    expect(d).not.toHaveProperty('names');
    writeStats(substitutions({ [OPUS]: 496 }, {}, TRAFFIC));   // unreadable in the baseline only
    expect(criterion(report(withBaseline()), 'drift').reason).toMatch(why);
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 496 }, {}, { ...TRAFFIC, since: 'not a stamp' }));   // unreadable now only
    d = criterion(report(withBaseline()), 'drift');
    expect(d.reason).toMatch(why);
    expect(d.verdict).toBe('unmeasured');
  });

  it('a lane that answered no request since the baseline is unmeasured: a hold over nothing observed is no pass', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline();
    let d = criterion(report(withBaseline()), 'drift');
    expect(d).toMatchObject({ verdict: 'unmeasured', answeredSince: 0, names: [{ name: OPUS, state: 'held' }] });
    expect(d.reason).toMatch(/answered no requests? since the baseline reading/);
    expect(run(withBaseline()).stdout).toMatch(/^drift baseline: taken at .*, 0 requests answered since$/m);
    // the answered count went backwards: not the file the baseline read
    writeStats(substitutions({ [OPUS]: 496 }, {}, { outcomes: { ...OUTCOMES, '2xx': 900 } }));
    d = criterion(report(withBaseline()), 'drift');
    expect(d).toMatchObject({ verdict: 'unmeasured', answeredSince: -90 });
    expect(d.reason).toMatch(/answered count went backwards/);
    // a new name still fails an idle lane
    writeStats(substitutions({ [OPUS]: 496, [SONNET]: 1 }));
    expect(criterion(report(withBaseline()), 'drift').verdict).toBe('fail');
    // a baseline reading with no answered count is not compared
    keepBaseline((rep) => { delete rep.bridge.answered; });
    writeStats(substitutions({ [OPUS]: 496 }, {}, TRAFFIC));
    d = criterion(report(withBaseline()), 'drift');
    expect(d).toMatchObject({ verdict: 'unmeasured' });
    expect(d.reason).toMatch(/no answered count/);
  });

  it('a baseline reading with no takenAt stamp, or not taken before this reading, is unmeasured', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    for (const edit of [(rep: { takenAt?: unknown }) => { delete rep.takenAt; }, (rep: { takenAt?: unknown }) => { rep.takenAt = 'yesterday'; }]) {
      keepBaseline(edit);
      writeStats(substitutions({ [OPUS]: 496 }, {}, TRAFFIC));
      const d = criterion(report(withBaseline()), 'drift');
      expect(d).toMatchObject({ verdict: 'unmeasured' });
      expect(d.reason).toMatch(/no takenAt stamp/);
      writeStats(substitutions({ [OPUS]: 496 }));
    }
    keepBaseline();
    writeStats(substitutions({ [OPUS]: 496 }, {}, TRAFFIC));
    const d = criterion(report(['--drift-baseline', baselineFile()]), 'drift');   // the same clock as the baseline
    expect(d).toMatchObject({ verdict: 'unmeasured', baseline: { takenAt: TAKEN } });
    expect(d.reason).toMatch(/not taken before this reading/);
  });

  it('a baseline read while the bridge is unmeasured keeps its stamps and says it was not compared', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    keepBaseline();
    fs.rmSync(path.join(laneDir(), 'bridge.stats.json'));
    const d = criterion(report(withBaseline()), 'drift');
    expect(d).toMatchObject({ verdict: 'unmeasured', baseline: { takenAt: TAKEN, since: SINCE } });
    expect(d.reason).toMatch(/stats file is absent/);
    expect(d).not.toHaveProperty('names');
    expect(run(withBaseline()).stdout).toMatch(
      new RegExp(`^drift baseline: taken at ${TAKEN}, stats since ${SINCE}, not compared \\(the reason is on the drift line\\)$`, 'm'));
  });

  it('the baseline\'s path never leaves, in either form, whatever the reading', () => {
    passing();
    writeStats(substitutions({ [OPUS]: 496 }));
    const variants: (() => void)[] = [
      () => keepBaseline(),
      () => keepBaseline((rep) => { rep.lane = 'lane-b'; }),
      () => write(baselineFile(), 'not json'),
      () => fs.rmSync(baselineFile(), { force: true }),
    ];
    for (const make of variants) {
      make();
      for (const r of [run(withBaseline()), run(['--json', ...withBaseline()])]) {
        expect(r.code, r.stderr).toBe(0);
        for (const out of [r.stdout, r.stderr]) {
          expect(out).not.toContain(SENTINEL_BASELINE);
          expect(out).not.toContain(home);
        }
      }
    }
  });
});

describe('measure-codex-watch.py: the 5xx rate measures like for like', () => {
  it('count_tokens lines do not enter the baseline, and are printed beside it', () => {
    passing();
    write(logFile(), litellmLog(990, 10, { countTokens: 500 }));
    const c = criterion(report(), '5xx-rate');
    expect(c.baseline).toMatchObject({ twoXx: 990, fiveXx: 10, n: 1000, countTokens: { '2xx': 500 } });
    expect(c.countTokens).toBe(40);   // the bridge's own, answered locally: outside 2xx on its side too
    expect(c.baseline.span).toMatch(/no stamps/);
  });

  it('only POST message lines enter the baseline: a GET or OPTIONS of the same route is an access line, never a call', () => {
    passing();
    write(logFile(), litellmLog(990, 10) + [
      'INFO:     127.0.0.1:63000 - "GET /v1/messages HTTP/1.1" 500 Internal Server Error',
      'INFO:     127.0.0.1:63001 - "OPTIONS /v1/messages?beta=true HTTP/1.1" 200 OK',
      'INFO:     127.0.0.1:63002 - "GET /v1/messages HTTP/1.1" 200 OK',
    ].join('\n') + '\n');
    const rep = report();
    expect(criterion(rep, '5xx-rate').baseline).toMatchObject({ fiveXx: 10, twoXx: 990, n: 1000 });
    expect(rep.litellmLog).toMatchObject({ accessLines: 1005, posts: 1000 });
  });

  it('4xx is excluded on both sides, and printed with its share of each side\'s answers', () => {
    passing();
    writeStats({ outcomes: { ...OUTCOMES, '4xx': 500 } });
    write(logFile(), litellmLog(990, 10, { refused: 3000 }));
    const c = criterion(report(), '5xx-rate');
    // Every rate carries six significant figures, as every other statistic does.
    expect(c.watch).toMatchObject({ fourXx: 500, n: 994, rate: Number((4 / 994).toPrecision(6)) });
    expect(c.baseline).toMatchObject({ fourXx: 3000, n: 1000, rate: 0.01 });
    expect(c.watch.fourXxShare).toBe(Number((500 / 1494).toPrecision(6)));
    expect(c.baseline.fourXxShare).toBe(0.75);
  });

  it('a rise that is not significant passes, with its p', () => {
    passing();
    write(logFile(), litellmLog(999, 1));   // baseline 1 of 1000 against the bridge's 4 of 994
    const c = criterion(report(), '5xx-rate');
    expect(c.watch.rate).toBeGreaterThan(c.baseline.rate);
    expect(c.p).toBeCloseTo(exactBinomSf(4, 5, 994, 1000), 5);
    expect(c.p).toBeGreaterThan(0.05);
    expect(c.verdict).toBe('pass');
  });

  it('a large significant rise fails', () => {
    passing();
    writeStats({ outcomes: { ...OUTCOMES, '2xx': 960, '5xx': 40 } });   // 40 of 1000 against 10 of 1000
    const rep = report();
    const c = criterion(rep, '5xx-rate');
    expect(c.p).toBeCloseTo(exactBinomSf(40, 50, 1000, 1000), 8);
    expect(c.p).toBeLessThan(0.05);
    expect(c.verdict).toBe('fail');
    expect(rep.verdict).toBe('fail');
  });

  it('p, the ratio and both Clopper-Pearson intervals agree with values computed independently', () => {
    passing();
    const c = criterion(report(), '5xx-rate');
    expect(c.p).toBeCloseTo(exactBinomSf(4, 14, 994, 1000), 5);
    expect(c.ratio).toBeCloseTo((4 / 994) / (10 / 1000), 5);
    // An exact interval's ends are where the binomial tails reach 2.5%: P(X >= x | lo) and P(X <= x | hi).
    for (const [side, x, n] of [['watch', 4, 994], ['baseline', 10, 1000]] as const) {
      const [lo, hi] = c[side].interval;
      expect(1 - recurrenceCdf(x - 1, n, lo), `${side} lower`).toBeCloseTo(0.025, 5);
      expect(recurrenceCdf(x, n, hi), `${side} upper`).toBeCloseTo(0.025, 5);
      expect(lo).toBeLessThan(x / n);
      expect(hi).toBeGreaterThan(x / n);
    }
    // And the closed form at zero events: [0, 1 - 0.025^(1/n)].
    writeStats({ outcomes: { ...OUTCOMES, '5xx': 0 } });
    const zero = criterion(report(), '5xx-rate');
    expect(zero.watch.interval[0]).toBe(0);
    expect(zero.watch.interval[1]).toBeCloseTo(1 - 0.025 ** (1 / 990), 8);
  });
});

describe('measure-codex-watch.py: the credential, in the library\'s own vocabulary', () => {
  it('ok with an upstream overload code passes, and the code is printed as context with the status\'s stamp', () => {
    passing();
    writeStatus({ lastErrorCode: 'server_is_overloaded' });
    const c = criterion(report(), 'credential');
    expect(c).toMatchObject({ verdict: 'pass', state: 'ok', lastErrorCode: 'server_is_overloaded',
      lastErrorCodeRole: 'last upstream or refresh code (context only)' });
    expect(c.statusUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('ok with refresh_token_reused fails', () => {
    passing();
    writeStatus({ lastErrorCode: 'refresh_token_reused' });
    const c = criterion(report(), 'credential');
    expect(c).toMatchObject({ verdict: 'fail', lastErrorCodeRole: 'incident', checks: { incidentCode: 'fail' } });
  });

  it('every code in the library\'s incident sets fails, whatever the state', () => {
    passing();
    const codes = libraryCodes();
    expect(codes.length).toBeGreaterThanOrEqual(7);
    for (const code of codes) {
      writeStatus({ lastErrorCode: code });
      expect(criterion(report(), 'credential').verdict, code).toBe('fail');
    }
  });

  it('needs-signin fails, with no code beside it', () => {
    passing();
    writeStatus({ state: 'needs-signin' });
    expect(criterion(report(), 'credential')).toMatchObject({ verdict: 'fail', checks: { bars: 'fail' } });
  });

  it('a config-error fails when the library says it bars this configuration, and is context when it is stale', () => {
    passing();
    writeStatus({ state: 'config-error' });
    expect(criterion(report(), 'credential')).toMatchObject({ verdict: 'fail', checks: { bars: 'fail' } });
    const f = statusFile();
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/"configHash": "[0-9a-f]+"/, `"configHash": "${'0'.repeat(64)}"`));
    expect(criterion(report(), 'credential')).toMatchObject({ verdict: 'pass', state: 'config-error', checks: { bars: 'pass' } });
  });

  it('a credential the library measures as not present fails', () => {
    passing();
    fs.rmSync(authDir(), { recursive: true });
    writeStatus({}, { credential: false });
    expect(criterion(report(), 'credential')).toMatchObject({ verdict: 'fail', checks: { credentialPresent: 'fail' } });
  });

  it('a token that has expired fails, and one that expires at this very second has expired', () => {
    passing();
    writeStatus({ expiresAt: NOW_S - 60 });
    expect(criterion(report(), 'credential')).toMatchObject({ verdict: 'fail', checks: { expiry: 'fail' } });
    writeStatus({ expiresAt: NOW_S });
    expect(criterion(report(), 'credential')).toMatchObject({ verdict: 'fail', checks: { expiry: 'fail', cadence: 'pass' } });
  });

  it('a token life that is not positive leaves the cadence unmeasured', () => {
    passing();
    writeStatus({ expiresAt: NOW_S + 1800, lastRefreshAt: NOW_S + 1800 });
    const c = criterion(report(), 'credential');
    expect(c).toMatchObject({ verdict: 'unmeasured', checks: { cadence: 'unmeasured', expiry: 'pass' }, lifeSeconds: 0 });
    expect(c.reason).toContain('no positive token life');
  });

  it('prints the library\'s unsaved flag: a refreshed credential held only in memory shows', () => {
    passing();
    expect(criterion(report(), 'credential')).toMatchObject({ verdict: 'pass', unsaved: false });
    writeStatus({ unsaved: true });
    expect(criterion(report(), 'credential').unsaved).toBe(true);
  });

  it('a refresh older than half the life plus 900 s fails, and one just inside it passes', () => {
    passing();
    // expiresAt = now + 1800, lastRefreshAt = now - x: life 1800 + x, bound (1800 + x) / 2 + 900, late iff x > 3600.
    writeStatus({ lastRefreshAt: NOW_S - 3599 });
    expect(criterion(report(), 'credential')).toMatchObject({ verdict: 'pass', checks: { cadence: 'pass' } });
    writeStatus({ lastRefreshAt: NOW_S - 3601 });
    const c = criterion(report(), 'credential');
    expect(c).toMatchObject({ verdict: 'fail', checks: { cadence: 'fail' }, lifeSeconds: 5401 });
    expect(c.cadenceBoundSeconds).toBeCloseTo(5401 / 2 + 900, 6);
  });

  it.each([
    ['no lastRefreshAt', { lastRefreshAt: null }],
    ['no expiresAt', { expiresAt: null }],
  ])('%s reads unmeasured', (_what, over) => {
    passing();
    writeStatus(over);
    const c = criterion(report(), 'credential');
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toMatch(/lastRefreshAt|expiresAt/);
  });

  it('a failing check outranks a missing stamp', () => {
    passing();
    writeStatus({ state: 'needs-signin', lastRefreshAt: null });
    expect(criterion(report(), 'credential').verdict).toBe('fail');
  });
});

describe('measure-codex-watch.py: the compaction rate measures like for like', () => {
  it('an advance event inside the baseline cuts it, and is printed', () => {
    passing();
    writeAdvance({ sonnet: [move('2026-10-24T00:00:00Z', 'gpt-model-old', 'gpt-model-a')] });
    const rep = report();
    expect(rep.windows.comparable).toEqual(['2026-10-24T00:00:00Z', FLIP]);
    expect(rep.events).toEqual([{ at: '2026-10-24T00:00:00Z', kind: 'advance', class: 'sonnet', from: 'gpt-model-old',
      to: 'gpt-model-a', ok: true, where: 'baseline', cuts: true }]);
    const c = criterion(rep, 'compaction-rate');
    expect(c.baseline).toMatchObject({ calls: 400, automatic: 20, sessions: 5 });
    expect(c.comparable).toMatchObject({ calls: 200, automatic: 16, sessions: 4 });
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toMatch(/the comparable baseline holds 4 sessions and 16 boundaries \(needs 5 and 20\)/);
  });

  it('a window set inside the baseline cuts it too, and the last event before the flip wins', () => {
    passing();
    writeWindows({ 'gpt-model-a': { tokens: 200000, setAt: '2026-10-25T00:00:00.000Z' } });
    writeAdvance({ sonnet: [move('2026-10-24T00:00:00Z', 'gpt-model-old', 'gpt-model-a')] });
    const rep = report();
    expect(rep.windows.comparable).toEqual(['2026-10-25T00:00:00Z', FLIP]);
    expect(rep.events.map((e: { kind: string }) => e.kind)).toEqual(['advance', 'window']);
    expect(criterion(rep, 'compaction-rate').comparable).toMatchObject({ calls: 150, sessions: 3 });
  });

  it('an event inside the watch is a warning and cuts nothing', () => {
    passing();
    writeWindows({ 'gpt-model-a': { tokens: 180000, setAt: '2026-10-29T00:00:00.000Z', source: 'refusal',
      refusedTokensEstimate: 210000 } });
    const rep = report();
    expect(rep.windows.comparable).toEqual([BASE, FLIP]);
    const warn = { at: '2026-10-29T00:00:00Z', kind: 'lowering', model: 'gpt-model-a', from: null, to: 180000,
      where: 'watch', cuts: false };
    expect(rep.events).toEqual([warn]);
    const c = criterion(rep, 'compaction-rate');
    expect(c.warnings).toEqual([warn]);
    // The windows file keeps each model's latest entry only, so a set in the watch hides any earlier one: flagged.
    expect(rep.eventSources.hiddenEarlierSets).toEqual(['gpt-model-a']);
    expect(c.verdict).toBe('pass');
  });

  it('an absent model file is no event; one that cannot be read holds the criterion unmeasured, with its reason', () => {
    passing();
    expect(report().eventSources).toEqual({ advance: 'absent', windows: 'absent' });
    for (const [file, body, why] of [
      ['advance', 'not json', 'not JSON'],
      ['advance', JSON.stringify({ v: 2, classes: {} }), 'not an advance file of version 1'],
      ['advance', JSON.stringify([1]), 'not a JSON object'],
      ['windows', JSON.stringify({ windows: [] }), 'not a windows file'],
    ] as const) {
      fs.rmSync(path.join(home, '.ccrc', 'models'), { recursive: true, force: true });
      write(modelsFile(file), body);
      const rep = report();
      expect(rep.eventSources[file], body).toBe(why);
      const c = criterion(rep, 'compaction-rate');
      expect(c.verdict, body).toBe('unmeasured');
      expect(c.reason, body).toContain(`the ${file} file cannot be read (${why}): an event in the baseline may be unseen`);
      expect(c.box.reads, body).toBe('unmeasured');
    }
  });

  it('an entry with no readable stamp, or of another shape, holds the criterion unmeasured', () => {
    passing();
    writeAdvance({ sonnet: [{ ...move('2026-10-24T00:00:00Z', 'gpt-model-old', 'gpt-model-a'), at: 'yesterday' }] });
    let rep = report();
    expect(rep.eventSources.undated).toBe(1);
    expect(criterion(rep, 'compaction-rate').reason).toContain('1 event entries carry no readable stamp');
    fs.rmSync(modelsFile('advance'));
    writeWindows({ 'gpt-model-a': 'not an entry' } as unknown as Record<string, Record<string, unknown>>);
    rep = report();
    expect(rep.eventSources.unshaped).toBe(1);
    expect(criterion(rep, 'compaction-rate').reason).toContain('1 event entries are of another shape');
    fs.rmSync(modelsFile('windows'));
    write(modelsFile('advance'), JSON.stringify({ v: 1, classes: { sonnet: { history: 'none' } }, pending: null }));
    expect(criterion(report(), 'compaction-rate').verdict).toBe('unmeasured');
  });

  it('an advance history at its cap whose oldest entry is after the baseline\'s start may have lost a move: unmeasured', () => {
    passing();
    // recordMove keeps the newest HISTORY_CAP entries: ten, every one in the watch, is what eviction leaves behind.
    const ten = Array.from({ length: 10 }, (_, i) => move(`2026-10-${28 + (i % 3)}T0${i}:00:00Z`, 'gpt-model-a', 'gpt-model-a'));
    writeAdvance({ sonnet: ten });
    let rep = report();
    expect(rep.windows.comparable).toEqual([BASE, FLIP]);
    expect(rep.eventSources.capped).toEqual([{ class: 'sonnet', oldest: '2026-10-28T00:00:00Z' }]);
    let c = criterion(rep, 'compaction-rate');
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toContain('the sonnet advance history holds its cap of 10 entries, the oldest at 2026-10-28T00:00:00Z, '
      + 'after the baseline\'s start: an earlier move may be lost');
    // Nine entries, or ten whose oldest is before the baseline's start, lose nothing the baseline needs.
    writeAdvance({ sonnet: ten.slice(1) });
    expect(report().eventSources.capped).toBeUndefined();
    writeAdvance({ sonnet: [move('2026-10-20T00:00:00Z', 'gpt-model-old', 'gpt-model-a'), ...ten.slice(1)] });
    rep = report();
    expect(rep.eventSources.capped).toBeUndefined();
    c = criterion(rep, 'compaction-rate');
    expect(c.verdict).toBe('pass');
  });

  it('an event stamped at or after --until is in no list', () => {
    passing();
    writeAdvance({ sonnet: [move(UNTIL, 'gpt-model-a', 'gpt-model-b'), move('2026-11-05T00:00:00Z', 'gpt-model-b', 'gpt-model-c')] });
    writeWindows({ 'gpt-model-a': { tokens: 180000, setAt: '2026-11-04T00:00:00.000Z', source: 'refusal' } });
    const rep = report();
    expect(rep.events).toEqual([]);
    expect(criterion(rep, 'compaction-rate').warnings).toEqual([]);
  });

  it('a compaction point shift above 10% reads unmeasured, and one within it does not', () => {
    passing();
    transcript('.claude-lane-a', 'after', [
      user('2026-10-28T00:00:00.000Z'), ...calls('2026-10-28T00:00:00.000Z', 400),
      ...[8, 9, 10, 11].map((h) => boundary(`2026-10-28T${String(h).padStart(2, '0')}:00:00.000Z`, 'auto', undefined, {}, 168000)),
    ]);
    let c = criterion(report(), 'compaction-rate');
    expect(c.watch.point).toMatchObject({ n: 4, median: 168000 });
    expect(c.comparable.point).toMatchObject({ n: 20, median: 380000 });
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toMatch(/the compaction point moved \(baseline 380\.0k, watch 168\.0k\): the context window changed/);
    // 345,000 is 9.2% below 380,000: inside the 10%, so the criterion is measured. 330,000 is 13.2% below and
    // 425,000 11.8% above: outside it, either way.
    const watchAt = (pre: number): void => transcript('.claude-lane-a', 'after', [
      user('2026-10-28T00:00:00.000Z'), ...calls('2026-10-28T00:00:00.000Z', 400),
      ...[8, 9, 10, 11].map((h) => boundary(`2026-10-28T${String(h).padStart(2, '0')}:00:00.000Z`, 'auto', undefined, {}, pre)),
    ]);
    watchAt(345000);
    expect(criterion(report(), 'compaction-rate').verdict).toBe('pass');
    for (const [pre, shown] of [[330000, '330.0k'], [425000, '425.0k']] as const) {
      watchAt(pre);
      c = criterion(report(), 'compaction-rate');
      expect(c.verdict, String(pre)).toBe('unmeasured');
      expect(c.reason).toContain(`the compaction point moved (baseline 380.0k, watch ${shown})`);
    }
  });

  it('the compaction point is n, p10, median and p90 of the automatic preTokens', () => {
    passing();
    const pre = [150000, 160000, 170000, 180000, 190000, 400000];
    transcript('.claude-lane-a', 'after', [
      user('2026-10-28T00:00:00.000Z'), ...calls('2026-10-28T00:00:00.000Z', 400),
      ...pre.map((t, i) => boundary(plus('2026-10-28T08:00:00.000Z', i), 'auto', undefined, {}, t)),
      boundary('2026-10-28T09:00:00.000Z', 'manual', undefined, {}, 999999),
    ]);
    const point = criterion(report(), 'compaction-rate').watch.point;
    // p10 and p90 by linear interpolation between order statistics: h = (n - 1) q.
    expect(point).toEqual({ n: 6, p10: 155000, median: median(pre), p90: 295000 });
  });

  it('a side whose automatic boundaries carry no compaction point, or a baseline point on too few, reads unmeasured', () => {
    passing();
    // The four sessions after the first carry no preTokens: the comparable point rests on the first one's 4.
    for (const [name, from] of [['before-2', '2026-10-24T01:00:00.000Z'], ['before-3', '2026-10-25T01:00:00.000Z'],
      ['before-4', '2026-10-25T12:00:00.000Z'], ['before-5', '2026-10-26T01:00:00.000Z']] as const) {
      session(name, from, 50, 4, { preTokens: null });
    }
    let c = criterion(report(), 'compaction-rate');
    expect(c.comparable).toMatchObject({ automatic: 20, point: { n: 4, median: 380000 } });
    expect(c.pointShift).toMatchObject({ baseline: { median: 380000, n: 4 }, watch: { median: 380000, n: 4 }, shift: 0 });
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toContain('the comparable baseline\'s compaction point rests on 4 preTokens values (needs 20)');
    // None at all in the baseline: no point to compare the watch's with.
    transcript('.claude-lane-a', 'before', [user('2026-10-23T00:00:00.000Z'), ...calls('2026-10-23T00:00:00.000Z', 200),
      ...[4, 5, 6, 7].map((h) => boundary(`2026-10-23T0${h}:00:00.000Z`, 'auto', undefined, {}, null))]);
    c = criterion(report(), 'compaction-rate');
    expect(c.reason).toContain('the compaction point is unmeasured in the comparable baseline: none of its 20 automatic '
      + 'boundaries carries preTokens');
    // And none in the watch.
    passing();
    transcript('.claude-lane-a', 'after', [user('2026-10-28T00:00:00.000Z'), ...calls('2026-10-28T00:00:00.000Z', 400),
      ...[8, 9].map((h) => boundary(`2026-10-28T0${h}:00:00.000Z`, 'auto', undefined, {}, null))]);
    c = criterion(report(), 'compaction-rate');
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toContain('the compaction point is unmeasured in the watch: none of its 2 automatic boundaries carries preTokens');
  });

  it('sidechain rows are excluded on both sides, and counted as context', () => {
    passing();
    const side = { isSidechain: true };
    session('agent-before', '2026-10-26T02:00:00.000Z', 100, 30, { extra: side });
    session('agent-after', '2026-10-29T02:00:00.000Z', 100, 30, { extra: side });
    const c = criterion(report(), 'compaction-rate');
    expect(c.comparable).toMatchObject({ calls: 400, automatic: 20, sessions: 5, sidechain: { calls: 100, automatic: 30 } });
    expect(c.watch).toMatchObject({ calls: 400, automatic: 4, sidechain: { calls: 100, automatic: 30 } });
    expect(c.verdict).toBe('pass');
  });

  it('a main-thread boundary belongs to the last main-thread model, not to a sidechain row between', () => {
    passing();
    transcript('.claude-lane-a', 'mixed', [
      assistant('2026-10-29T00:00:00.000Z', 'gpt-model-a'),
      assistant('2026-10-29T00:01:00.000Z', 'claude-model-x', undefined, { isSidechain: true }),
      boundary('2026-10-29T00:02:00.000Z', 'auto'),
    ]);
    expect(criterion(report(), 'compaction-rate').watch).toMatchObject({ calls: 401, automatic: 5 });
  });

  it.each([
    ['fewer than 5 sessions', (): void => removeTranscript('before-5'), 4, 16],
    ['fewer than 20 boundaries', (): void => session('before-5', '2026-10-26T01:00:00.000Z', 50, 3), 5, 19],
  ])('a low-power baseline reads unmeasured: %s', (_what, change, sessions, automatic) => {
    passing();
    change();
    const c = criterion(report(), 'compaction-rate');
    expect(c.verdict).toBe('unmeasured');
    expect(c.power).toMatchObject({ sessions, automatic });
    expect(c.reason).toContain(`the comparable baseline holds ${sessions} sessions and ${automatic} boundaries (needs 5 and 20)`);
  });

  it('a file whose boundaries fall in the baseline but whose calls do not is no session of it', () => {
    passing();
    removeTranscript('before-5');
    transcript('.claude-lane-a', 'tail', [assistant('2026-10-22T09:00:00.000Z', 'gpt-model-a'),
      ...[1, 2, 3, 4].map((h) => boundary(`2026-10-23T1${h}:00:00.000Z`, 'auto'))]);
    const c = criterion(report(), 'compaction-rate');
    expect(c.comparable).toMatchObject({ automatic: 20, sessions: 4 });
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toContain('the comparable baseline holds 4 sessions and 20 boundaries (needs 5 and 20)');
  });

  it('the per-model standardisation weights each model\'s baseline rate by the watch\'s calls', () => {
    write(path.join(laneDir(), 'lane.json'), JSON.stringify(lane()));
    writeStats();
    writeStatus();
    write(logFile(), litellmLog(990, 10));
    // Baseline, each model with power of its own (5 sessions and 20 boundaries): gpt-model-a 300 calls and 20
    // boundaries (1/15), gpt-model-b 100 calls and 40 (0.4), in ten sessions.
    for (let i = 0; i < 5; i++) session(`a-${i}`, `2026-10-2${3 + (i % 3)}T0${i}:00:00.000Z`, 60, 4);
    for (let i = 0; i < 5; i++) session(`b-${i}`, `2026-10-26T0${i}:00:00.000Z`, 20, 8, { model: 'gpt-model-b' });
    // Watch: a 400 calls and 25 boundaries, b 50 and 20, and gpt-model-c, which has no baseline, 30 calls and no
    // boundary (so nothing of the watch's compaction goes unread).
    session('w-a', '2026-10-28T00:00:00.000Z', 400, 25);
    session('w-b', '2026-10-29T00:00:00.000Z', 50, 20, { model: 'gpt-model-b' });
    session('w-c', '2026-10-30T00:00:00.000Z', 30, 0, { model: 'gpt-model-c' });
    const c = criterion(report(), 'compaction-rate');
    const expected = 400 * 20 / 300 + 50 * 40 / 100;   // 46.67, where a pooled rate would say 450 * 60 / 400 = 67.5
    expect(c.standardised.expected).toBeCloseTo(expected, 3);
    expect(c.standardised).toMatchObject({ observed: 45, note: NOTE,
      noBaseline: { 'gpt-model-c': { watchCalls: 30, watchAutomatic: 0 } }, thin: {} });
    expect(c.standardised.cells['gpt-model-a']).toEqual({ baselineCalls: 300, baselineAutomatic: 20, baselineSessions: 5,
      watchCalls: 400, watchAutomatic: 25 });
    expect(c.standardised.p).toBeCloseTo(poissonSf(45, expected), 5);
    expect(c.verdict).toBe('pass');
  });

  it('the standardisation reads the COMPARABLE baseline: an advance cuts a high-rate stretch out of it', () => {
    // Before the cut: 200 calls and 40 boundaries (0.2) at 380k. After it: 300 calls and 20 (1/15) at 168k, the
    // watch's point. Against the comparable baseline 40 watch boundaries over 400 calls is a significant excess;
    // against the whole requested baseline (60 over 500, expected 48) it would not be.
    cutFixture(380000, 168000, 40);
    const rep = report();
    expect(rep.windows.comparable).toEqual([CUT, FLIP]);
    const c = criterion(rep, 'compaction-rate');
    expect(c.baseline).toMatchObject({ calls: 500, automatic: 60, sessions: 6 });
    expect(c.comparable).toMatchObject({ calls: 300, automatic: 20, sessions: 5, point: { n: 20, median: 168000 } });
    expect(c.standardised.cells['gpt-model-a']).toEqual({ baselineCalls: 300, baselineAutomatic: 20, baselineSessions: 5,
      watchCalls: 400, watchAutomatic: 40 });
    expect(c.standardised.expected).toBeCloseTo(400 * 20 / 300, 3);
    expect(c.standardised.observed).toBe(40);
    expect(c.standardised.p).toBeCloseTo(poissonSf(40, 400 * 20 / 300), 5);
    // The requested baseline's median point is 380k; the comparable one's is the watch's, so no shift is read.
    expect(c.pointShift).toMatchObject({ baseline: { median: 168000, n: 20 }, watch: { median: 168000, n: 40 } });
    expect(c.verdict).toBe('fail');
  });

  it('the compaction point is compared against the COMPARABLE baseline\'s: a shift after the cut is read', () => {
    cutFixture(168000, 380000, 40);   // the requested baseline's median is 168k, the comparable one's 380k
    const c = criterion(report(), 'compaction-rate');
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toContain('the compaction point moved (baseline 380.0k, watch 168.0k): the context window changed');
  });

  it('a file that began before the cut is not in the comparable baseline, and is counted apart', () => {
    passing();
    writeAdvance({ sonnet: [move('2026-10-24T00:00:00Z', 'gpt-model-old', 'gpt-model-a')] });
    // It starts at 23:00 the day before and runs 120 calls, one a minute: 60 of them after the cut, then 2 boundaries.
    transcript('.claude-lane-a', 'straddle', [...calls('2026-10-23T22:59:00.000Z', 120),
      boundary('2026-10-24T02:00:00.000Z', 'auto'), boundary('2026-10-24T02:01:00.000Z', 'auto')]);
    const c = criterion(report(), 'compaction-rate');
    expect(c.comparable).toMatchObject({ calls: 200, automatic: 16, sessions: 4,
      beganBeforeCut: { files: 1, calls: 60, automatic: 2 } });
    expect(c.baseline).toMatchObject({ calls: 520, automatic: 22, beganBeforeCut: null });
  });

  it('a no-baseline model that holds watch boundaries reads unmeasured: its compaction is unread', () => {
    passing();
    session('w-b', '2026-10-29T00:00:00.000Z', 5000, 30, { model: 'gpt-model-b' });
    const c = criterion(report(), 'compaction-rate');
    expect(c.standardised).toMatchObject({ observed: 4, noBaseline: { 'gpt-model-b': { watchCalls: 5000, watchAutomatic: 30 } } });
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toContain('30 of 34 automatic watch boundaries (5000 of 5400 calls) are on models whose comparable '
      + 'baseline is absent or under 5 sessions and 20 boundaries');
  });

  it('a model whose baseline is thin is folded out of the standardisation, and gated like a model with none', () => {
    passing();
    session('b-thin', '2026-10-26T03:00:00.000Z', 1, 1, { model: 'gpt-model-b' });
    session('w-b', '2026-10-29T00:00:00.000Z', 5000, 1000, { model: 'gpt-model-b' });
    const c = criterion(report(), 'compaction-rate');
    expect(c.standardised.thin).toEqual({ 'gpt-model-b': { baselineCalls: 1, baselineAutomatic: 1, baselineSessions: 1,
      watchCalls: 5000, watchAutomatic: 1000 } });
    expect(c.standardised).toMatchObject({ expected: 20, observed: 4 });
    expect(c.standardised.cells['gpt-model-b']).toBeUndefined();
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toContain('1000 of 1004 automatic watch boundaries');
  });

  it('a watch whose models have no powered baseline at all reads unmeasured, never pass', () => {
    passing();
    removeTranscript('after');
    transcript('.claude-lane-a', 'after', [user('2026-10-28T00:00:00.000Z'), ...calls('2026-10-28T00:00:00.000Z', 50, 'gpt-model-b')]);
    const c = criterion(report(), 'compaction-rate');
    expect(c.verdict).toBe('unmeasured');
    expect(c.reason).toContain('no model the watch called has a powered comparable baseline');
  });

  it('a significant excess fails, with its p; an excess that is not significant passes', () => {
    passing();
    transcript('.claude-lane-a', 'more', [assistant('2026-10-28T23:00:00.000Z', 'gpt-model-a'),
      ...Array.from({ length: 30 }, (_, i) => boundary(plus('2026-10-29T00:00:00.000Z', i), 'auto'))]);   // 34 over 401
    let c = criterion(report(), 'compaction-rate');
    expect(c.standardised).toMatchObject({ expected: 20.05, observed: 34 });
    expect(c.standardised.p).toBeCloseTo(poissonSf(34, 20.05), 6);
    expect(c.verdict).toBe('fail');
    transcript('.claude-lane-a', 'more', [assistant('2026-10-28T23:00:00.000Z', 'gpt-model-a'),
      ...Array.from({ length: 21 }, (_, i) => boundary(plus('2026-10-29T00:00:00.000Z', i), 'auto'))]);   // 25 over 401
    c = criterion(report(), 'compaction-rate');
    expect(c.standardised.observed).toBe(25);
    expect(c.standardised.p).toBeCloseTo(poissonSf(25, 20.05), 6);
    expect(c.standardised.p).toBeGreaterThan(0.05);
    expect(c.verdict).toBe('pass');
  });

  it('prints the box scope, a paired reading and the version mix as context', () => {
    passing();
    transcript('.claude-lane-a', 'long', [
      ...calls('2026-10-26T12:00:00.000Z', 25), boundary('2026-10-26T13:00:00.000Z', 'auto'),
      ...calls('2026-10-27T12:00:00.000Z', 30, 'gpt-model-a', { version: '2.1.322' }),
      boundary('2026-10-27T13:00:00.000Z', 'auto'), boundary('2026-10-27T13:01:00.000Z', 'auto'),
    ]);
    transcript('.claude-lane-b', 'other', calls('2026-10-28T00:00:00.000Z', 25));
    const c = criterion(report(), 'compaction-rate');
    expect(c.paired).toEqual({ files: 1, comparable: { calls: 25, automatic: 1, rate: 0.04 },
      watch: { calls: 30, automatic: 2, rate: Number((2 / 30).toPrecision(6)) } });
    expect(c.watch.versions).toEqual({ '2.1.300': 400, '2.1.322': 30 });
    expect(c.box).toMatchObject({ reads: expect.any(String), standardised: { observed: 6 },
      windowedBy: 'this lane\'s flip and events, for every config directory: not like for like for another lane' });
    expect(c.box.power).toMatchObject({ sessions: 6 });
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
    writeStats(over);
    expect(criterion(report(), 'empty-tool-calls').verdict).toBe('unmeasured');
  });

  it('a log with no message POST leaves the 5xx criterion unmeasured and still shows the bridge\'s rate', () => {
    passing();
    write(logFile(), 'nothing a reader recognises\n'
      + 'INFO:     127.0.0.1:1 - "POST /v1/messages/count_tokens HTTP/1.1" 200 OK\n');
    const c = criterion(report(), '5xx-rate');
    expect(c).toMatchObject({ verdict: 'unmeasured', watch: { fiveXx: 4, n: 994 } });
    expect(c.reason).toMatch(/litellm\.log/);
  });

  it('a log whose message POSTs were all refused has no baseline: unmeasured', () => {
    passing();
    write(logFile(), litellmLog(0, 0, { refused: 50 }));
    expect(criterion(report(), '5xx-rate').verdict).toBe('unmeasured');
  });

  it('a stats file with no 2xx or 5xx answer is unmeasured', () => {
    passing();
    writeStats({ outcomes: { '4xx': 6 } });
    expect(criterion(report(), '5xx-rate').verdict).toBe('unmeasured');
  });

  it('no log at all is unmeasured, never a baseline of zero', () => {
    passing();
    fs.rmSync(logFile());
    expect(criterion(report(), '5xx-rate').verdict).toBe('unmeasured');
  });

  it('a window with no GPT call leaves the compaction criterion unmeasured', () => {
    passing();
    for (const f of ['before', 'before-2', 'before-3', 'before-4', 'before-5']) removeTranscript(f);
    const c = criterion(report(), 'compaction-rate');
    expect(c).toMatchObject({ verdict: 'unmeasured', comparable: { calls: 0 } });
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

  // D-8619: `bridgeFiles.requests`, the per-request record, is optional in lane.json and the watch reads only the
  // stats file: a lane.json with the name and one without it (an older laneManifest's) give the same report.
  it('a lane.json with or without the request record\'s name gives the same report', () => {
    passing();
    const without = run(['--json']);
    expect(without.code, without.stderr).toBe(0);
    const files = (lane().bridgeFiles as Record<string, string>);
    write(path.join(laneDir(), 'lane.json'), JSON.stringify(lane({ bridgeFiles: { ...files, requests: 'bridge.requests.jsonl' } })));
    write(path.join(laneDir(), 'bridge.requests.jsonl'), '{"v":1}\n');
    const withIt = run(['--json']);
    expect(withIt.code, withIt.stderr).toBe(0);
    expect(withIt.stdout).toBe(without.stdout);
    expect(criterion(JSON.parse(withIt.stdout), 'empty-tool-calls').verdict).not.toBe('unmeasured');
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
    expect(criterion(report(), 'compaction-rate')).toMatchObject({ baseline: { calls: 400 }, watch: { calls: 400 } });
  });

  it('another lane\'s config directory is in the box-wide figure and not in the lane\'s', () => {
    passing();
    transcript('.claude-lane-b', 'other', calls('2026-10-28T00:00:00.000Z', 25));
    const rep = report();
    expect(criterion(rep, 'compaction-rate').watch.calls).toBe(400);
    expect(rep.transcripts.box.watch.calls).toBe(425);
  });
});

describe('measure-codex-watch.py: the store and the events are printed', () => {
  it('prints the cumulative store outcomes and the store entry\'s set-aside, while the state reads ok', () => {
    passing();
    writeStats({ outcomes: { ...OUTCOMES, 'store:DatabaseError': 1, 'store:set-aside': 1 },
      store: { state: 'ok', reason: null, at: null,
        setAside: { at: '2026-10-28T07:46:00.000Z', found: 'integrity-check', file: 'reasoning.sqlite.set-aside' } } });
    const rep = report();
    expect(rep.bridge.storeOutcomes).toEqual({ 'store:DatabaseError': 1, 'store:set-aside': 1 });
    expect(rep.bridge.store).toEqual({ state: 'ok', reason: null, at: null,
      setAside: { at: '2026-10-28T07:46:00.000Z', found: 'integrity-check', file: 'reasoning.sqlite.set-aside' } });
    const text = run();
    expect(text.stdout).toMatch(/store:DatabaseError=1/);
  });

  it('prints every event in the text form too, each on a line of its own', () => {
    passing();
    writeAdvance({ sonnet: [move('2026-10-24T00:00:00Z', 'gpt-model-old', 'gpt-model-a')] });
    writeWindows({ 'gpt-model-a': { tokens: 180000, setAt: '2026-10-29T00:00:00.000Z', source: 'refusal' } });
    const r = run();
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^event: 2026-10-24T00:00:00Z advance sonnet gpt-model-old -> gpt-model-a \(baseline, cuts the baseline\)$/m);
    expect(r.stdout).toMatch(/^event: 2026-10-29T00:00:00Z lowering gpt-model-a none -> 180000 \(watch, a warning\)$/m);
    expect(r.stdout).toMatch(/^comparable baseline: 2026-10-24T00:00:00Z to 2026-10-27T06:26:03Z$/m);
  });
});

// A Python reader cannot import an `.mjs`, so the model files' names, the advance file's version and the windows
// file's refusal word are spelled once more in the instrument; each is bound here to its one home, the
// `measure-working-state.test.ts` idiom.
describe('measure-codex-watch.py: its second spellings are bound to their homes', () => {
  const src = (): string => fs.readFileSync(SCRIPT, 'utf8');
  const op = (): string => fs.readFileSync(path.join(ROOT, 'deploy', 'models-op.mjs'), 'utf8');
  const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');   // every RegExp metacharacter

  it('ADVANCE_FILE and WINDOWS_FILE are models-op.mjs\'s advancePath and windowsPath', () => {
    for (const [name, fn] of [['ADVANCE_FILE', 'advancePath'], ['WINDOWS_FILE', 'windowsPath']] as const) {
      const def = new RegExp(`^const ${fn} = \\(id\\) => path\\.join\\(modelsDir\\(\\), \`\\$\\{id\\}([^\`]+)\`\\);$`, 'm').exec(op());
      expect(def, fn).not.toBeNull();
      expect(src(), name).toMatch(new RegExp(`^${name} = "%s${reEsc(def![1]!)}"$`, 'm'));
    }
  });

  it('ADVANCE_VERSION is model-advance.mjs\'s, and REFUSAL_SOURCE is the word lower-windows writes', () => {
    const adv = /^export const ADVANCE_VERSION = (\d+);$/m.exec(
      fs.readFileSync(path.join(ROOT, 'shared', 'model-advance.mjs'), 'utf8'));
    expect(adv).not.toBeNull();
    expect(src()).toMatch(new RegExp(`^ADVANCE_VERSION = ${adv![1]}\\b`, 'm'));
    const cap = /^export const HISTORY_CAP = (\d+);$/m.exec(fs.readFileSync(path.join(ROOT, 'shared', 'model-advance.mjs'), 'utf8'));
    expect(cap).not.toBeNull();
    expect(src()).toMatch(new RegExp(`^HISTORY_CAP = ${cap![1]}\\b`, 'm'));
    const word = /source: '([a-z-]+)', refusedTokensEstimate: ref\.tokens/.exec(op());
    expect(word).not.toBeNull();
    expect(src()).toMatch(new RegExp(`^REFUSAL_SOURCE = "${word![1]}"`, 'm'));
  });
});

describe('measure-codex-watch.py: read-only, and nothing but counts leaves', () => {
  it('prints no prompt text, session id, project path, request id, uuid, message id, version or reason, in either form', () => {
    passing();
    transcript('.claude-lane-a', 'planted', [
      assistant('2026-10-28T20:00:00.000Z', 'gpt-model-a', SENTINEL_MESSAGE, { version: SENTINEL_VERSION }),
      boundary('2026-10-28T20:05:00.000Z', 'auto', SENTINEL_UUID),
    ]);
    writeAdvance({ sonnet: [move('2026-10-24T00:00:00Z', 'gpt-model-old', 'gpt-model-a')] });
    const text = run();
    const json = run(['--json']);
    expect(text.code, text.stderr).toBe(0);
    expect(json.code, json.stderr).toBe(0);
    for (const s of SENTINELS) {
      for (const out of [text.stdout, text.stderr, json.stdout, json.stderr]) expect(out, s).not.toContain(s);
    }
    expect(criterion(JSON.parse(json.stdout), 'compaction-rate').watch.versions).toMatchObject({ other: 1 });
  });

  it('an event or store name outside the name grammar reads other, in either form: a path, a space, a newline, length', () => {
    passing();
    const odd = [`/var/tmp/${SENTINEL_TEXT}`, `a ${SENTINEL_TEXT}`, `a\n${SENTINEL_TEXT}`, `${SENTINEL_TEXT}-${'x'.repeat(64)}`];
    for (const v of odd) {
      fs.rmSync(path.join(home, '.ccrc', 'models'), { recursive: true, force: true });
      const classes = { [v]: { family: null, hold: null, previous: null,
        history: [{ at: '2026-10-29T00:00:00Z', how: v, from: v, to: v, ok: true }] } };
      write(modelsFile('advance'), JSON.stringify({ v: 1, classes, pending: null }));
      writeWindows({ [v]: { tokens: 180000, setAt: '2026-10-29T00:00:00.000Z' } });
      writeStats({ store: { state: v, reason: v, at: null, setAside: { at: null, found: v, file: v } } });
      const json = run(['--json']);
      const text = run();
      expect(json.code, json.stderr).toBe(0);
      for (const out of [json.stdout, text.stdout, json.stderr, text.stderr]) expect(out, JSON.stringify(v)).not.toContain(SENTINEL_TEXT);
      const rep = JSON.parse(json.stdout);
      const adv = rep.events.find((e: { class?: string }) => e.class !== undefined);
      expect(adv).toMatchObject({ kind: 'other', class: 'other', from: 'other', to: 'other' });
      expect(rep.events.find((e: { model?: string }) => e.model !== undefined).model).toBe('other');
      expect(rep.bridge.store).toEqual({ state: 'other', reason: 'other', at: null, setAside: { at: null, found: 'other', file: 'other' } });
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
    writeAdvance({ sonnet: [move('2026-10-24T00:00:00Z', 'gpt-model-old', 'gpt-model-a')] });
    writeWindows({ 'gpt-model-a': { tokens: 200000, setAt: '2026-10-25T00:00:00.000Z' } });
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
