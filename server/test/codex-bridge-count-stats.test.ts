// codex-bridge-count-stats.test.ts — D24's count estimator (`ccd/codexbridge/count.py`), the stats file
// (`ccd/codexbridge/stats.py`) and the known names (`ccd/codexbridge/known.py`); codex-bridge Stage 2 plan 2026-10-22,
// Task 5; spec 2026-10-15 §2.7 ("It records every request's real prompt size and every context refusal, per route and
// model, in a non-secret stats file"), §2.9 D3 ("Names only, never content"), D24 ("seeded at 3.5 bytes per token,
// rounded up"), and the plan's D-6418 (D3's names go to the stats file).
//
// Every case runs the package through `runBridgeDriver`'s `count`, `known` and `stats-*` ops in a mkTmp HOME, with the
// stats file in a lane directory this file makes 0700 (as the tier's start does), and both endpoint variables at a
// closed loopback URL: nothing here makes a request. Model ids are neutral, lanes are `lane-a`/`lane-b`, and the
// `x-codex-` headers used here are fixture names under that prefix, never the usage poller's own names, except in the
// one case that lists the header names the live probe measured (D-7083): names only, never their values.
import { describe, it, expect } from 'vitest';
import {
  mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, lstatSync, symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import { driverLines, runBridgeDriver } from './codexBridgeFixture.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Line = Record<string, any>;

const MODEL = 'model-6.1-alpha';
const ROUTE_KEY = `backend/${MODEL}`;
const STATS = 'bridge.stats.json';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A fixture HOME with a 0700 lane directory; the stats file's path inside it. */
function lane(prefix: string): { home: string; dir: string; file: string } {
  const home = mkTmp(prefix);
  const dir = path.join(home, 'lane');
  mkdirSync(dir, { mode: 0o700 });
  return { home, dir, file: path.join(dir, STATS) };
}

async function run(home: string, ops: object[], o: { consts?: Record<string, unknown> } = {}): Promise<Line[]> {
  const r = await runBridgeDriver(home, { ops, ...(o.consts ? { consts: o.consts } : {}) }, {}, { timeoutMs: 60_000 });
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines.map((l) => l.op), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => (o as { op: string }).op));
  for (const l of lines) expect(l.raised, JSON.stringify(l)).toBeUndefined();
  return lines;
}

/** One Stats method call through the driver's single Stats object. */
const call = (method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): object =>
  ({ op: 'stats-call', method, args, kwargs });
const open = (file: string, laneId = 'lane-a', extra: Record<string, unknown> = {}): object =>
  ({ op: 'stats-open', path: file, lane: laneId, ...extra });
const readDoc = (file: string): Line => JSON.parse(readFileSync(file, 'utf8')) as Line;

describe.skipIf(!PY)('D24, the count estimator (codex-bridge spec §2.7, D24)', () => {
  it('a fresh route estimates at 3.5 bytes per token, rounded up', async () => {
    const { home, file } = lane('cb-count-fresh-');
    const [c, , ratio] = await run(home, [
      { op: 'count', estimate: [[7001, 3.5], [7000, 3.5], [1, 3.5], [0, 3.5]] },
      open(file),
      call('ratio', ['backend', MODEL]),
    ]);
    expect(c.consts.SEED_BYTES_PER_TOKEN).toBe(3.5);
    expect(c.estimate).toEqual([2001, 2000, 1, 1]);
    expect(ratio.result).toBe(3.5);
  });

  it('the ratio follows measured usage and stays clamped', async () => {
    const { home, file } = lane('cb-count-ratio-');
    const [c, , , ratio] = await run(home, [
      { op: 'count', ratio: [[3.5, 40_000, 10_000], [3.5, 40_000, 999], [8.0, 1_000_000, 1000], [1.0, 100, 10_000]] },
      open(file),
      call('usage', ['backend', MODEL, 40_000, 10_000], { image_count: 0 }),
      call('ratio', ['backend', MODEL]),
    ]);
    expect(c.consts).toMatchObject({ ALPHA: 0.2, RATIO_MIN: 1.0, RATIO_MAX: 8.0, CALIBRATE_MIN_TOKENS: 1000 });
    expect(c.ratio[0]).toBeCloseTo(3.6, 12); // 3.5 + 0.2 × (4.0 − 3.5)
    expect(c.ratio[1]).toBe(3.5); // under 1,000 input tokens: unchanged
    expect(c.ratio[2]).toBe(8.0); // a sample of 1,000 bytes per token stays at the ceiling
    expect(c.ratio[3]).toBe(1.0); // a sample of 0.01 stays at the floor
    expect(ratio.result).toBeCloseTo(3.6, 12);
    // And iterated, 40 extreme samples each way (100 and 0.01 bytes per token): the average reaches the bound and
    // stays on it, never past it.
    const [walk] = await run(home, [{ op: 'count', ratioWalk: [[3.5, 100_000, 1000, 40], [3.5, 100, 10_000, 40]] }]);
    expect(walk.ratioWalk[0]).toBe(8.0);
    expect(walk.ratioWalk[1]).toBe(1.0);
  });

  it('the estimate errs high after calibration on a skewed sample', async () => {
    const { home } = lane('cb-count-ceil-');
    // One sample of 5 bytes per token moves the seed to 3.8; 7001 / 3.8 = 1842.37…, so the estimate is 1843.
    const [c] = await run(home, [{ op: 'count', ratio: [[3.5, 50_000, 10_000]] }]);
    const r = c.ratio[0] as number;
    expect(r).toBeCloseTo(3.8, 12);
    const bytes = [7001, 12_345, 99_999, 3];
    const [e] = await run(home, [{ op: 'count', estimate: bytes.map((b) => [b, r]) }]);
    bytes.forEach((b, i) => {
      expect(e.estimate[i]).toBe(Math.ceil(b / r));
      expect(e.estimate[i]).toBeGreaterThan(b / r);
    });
    expect(e.estimate[0]).toBe(1843);
  });

  it('an image adds IMAGE_TOKENS to the estimate', async () => {
    const { home } = lane('cb-count-image-');
    const [c] = await run(home, [{ op: 'count', estimate: [[7001, 3.5, 2], [0, 3.5, 1]] }]);
    expect(c.consts.IMAGE_TOKENS).toBe(1600);
    expect(c.estimate).toEqual([2001 + 2 * 1600, 1600]);
  });
});

describe.skipIf(!PY)('the stats file (codex-bridge spec §2.7, §2.9 D3; D-6418)', () => {
  it('the stats file is 0600, atomic and version 1', async () => {
    const { home, dir, file } = lane('cb-stats-file-');
    const [o, , first, before, , throttled, second, after] = await run(home, [
      open(file, 'lane-a', { umask: 0o277 }),
      call('name', ['requestField', 'metadata']),
      call('flush', [], { force: true }),
      { op: 'stats-file', path: file },
      call('outcome', ['2xx']),
      call('flush'),
      call('flush', [], { force: true }),
      { op: 'stats-file', path: file },
    ]);
    expect(first.result).toBe(true);
    // An unforced flush inside FLUSH_S (10 s) of the last one writes nothing; a forced one does.
    expect(throttled.result).toBe(false);
    expect(second.result).toBe(true);
    // Each write is a new file renamed over the old one (a new inode), with no tmp file left beside it.
    expect(before.mode).toBe(0o600);
    expect(after.mode).toBe(0o600);
    expect(after.ino).not.toBe(before.ino);
    expect(before.dir).toEqual([STATS]);
    expect(after.dir).toEqual([STATS]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual([STATS]);
    const doc = readDoc(file);
    expect(Object.keys(doc).sort()).toEqual([
      'lane', 'lastUpstreamRequestId', 'names', 'outcomes', 'refusals', 'routes', 'since', 'startedAt', 'unexplained',
      'updatedAt', 'usageHeaders', 'version',
    ]);
    expect(doc.version).toBe(1);
    expect(doc.lane).toBe('lane-a');
    expect(doc.since).toMatch(ISO);
    expect(doc.since).toBe(doc.startedAt); // an absent file starts fresh, since = startedAt
    expect(doc.startedAt).toBe(o.doc.startedAt);
    expect(doc.updatedAt).toMatch(ISO);
    expect(doc.names).toEqual({ requestField: { metadata: 1 } });
    expect(doc.outcomes).toEqual({ '2xx': 1 });
    expect(doc.lastUpstreamRequestId).toBeNull();
    expect(doc.usageHeaders).toBeNull();
  });

  it('the stats file throttles an unforced flush to FLUSH_S', async () => {
    const { home, file } = lane('cb-stats-throttle-');
    const [, , first, , early, , late] = await run(home, [
      open(file),
      call('outcome', ['2xx']),
      call('flush'),
      call('outcome', ['2xx']),
      call('flush'),
      { op: 'sleep', s: 0.3 },
      call('flush'),
    ], { consts: { 'stats.FLUSH_S': 0.2 } });
    expect(first.result).toBe(true);
    expect(early.result).toBe(false);
    expect(late.result).toBe(true);
    expect(readDoc(file).outcomes).toEqual({ '2xx': 2 });
  });

  it('a name is counted, never a value', async () => {
    const { home, file } = lane('cb-stats-novalue-');
    const SENTINEL = 'SENTINEL-VALUE-fx7';
    await run(home, [
      open(file),
      call('name', ['requestField', 'temperature']),
      call('name', ['requestField', 'temperature']),
      call('header_names', [{ 'X-Fx-Sentinel': SENTINEL, 'Content-Type': `text/event-stream; charset=${SENTINEL}` }]),
      call('usage_headers', [{ 'x-fx-other': SENTINEL, 'x-codex-fx-bad': `${SENTINEL}\u0001` }], { now: 1_000_000 }),
      call('request_id', [`req ${SENTINEL}`]),
      call('flush', [], { force: true }),
    ]);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(SENTINEL);
    const doc = readDoc(file);
    expect(doc.names.requestField).toEqual({ temperature: 2 });
    expect(doc.names.responseHeader).toEqual({ 'content-type': 1, 'x-fx-sentinel': 1 });
    expect(doc.lastUpstreamRequestId).toBeNull();
    expect(doc.usageHeaders).toBeNull();
  });

  it('a name outside NAME_RE is unrecognised', async () => {
    const { home, file } = lane('cb-stats-namere-');
    const [, , , , , snap] = await run(home, [
      open(file),
      call('name', ['eventType', 'has space']),
      call('name', ['eventType', 'x'.repeat(65)]),
      call('name', ['eventType', 'ok.name/1:2-3_4']),
      call('name', ['eventType', '']),
      { op: 'stats-snapshot' },
    ]);
    expect(snap.doc.names.eventType).toEqual({ unrecognised: 3, 'ok.name/1:2-3_4': 1 });
    expect(snap.doc.unexplained.eventType).toEqual(['ok.name/1:2-3_4', 'unrecognised']);
  });

  it('past 256 names a family counts overflow', async () => {
    const { home, file } = lane('cb-stats-overflow-');
    const ops: object[] = [open(file)];
    for (let i = 0; i < 300; i += 1) ops.push(call('name', ['eventType', `response.fx_event_${i}`]));
    ops.push(call('name', ['eventType', 'response.fx_event_0'])); // a name already held still counts as itself
    ops.push({ op: 'stats-snapshot' });
    const lines = await run(home, ops);
    const names = lines[lines.length - 1].doc.names.eventType as Record<string, number>;
    expect(Object.keys(names)).toHaveLength(257);
    expect(names.overflow).toBe(44);
    expect(names['response.fx_event_0']).toBe(2);
    expect(names['response.fx_event_255']).toBe(1);
    expect(names['response.fx_event_256']).toBeUndefined();
  });

  it('x-codex- headers are kept by prefix, others never', async () => {
    const { home, file } = lane('cb-stats-headers-');
    // A value longer than VALUE_MAX (64) is dropped, never cut: a cut number is a wrong number.
    const [, , snap] = await run(home, [
      open(file),
      call('usage_headers', [{
        'X-Codex-Fx-Alpha': '42.5', 'x-codex-fx-long': '1'.repeat(65), 'x-codex-fx-max': '1'.repeat(64),
        'x-codex-fx-flag': 'true', 'x-codex-fx-ctl': '4\u00072', 'x-other-fx': '7', 'retry-after': '30',
      }], { now: 1_700_000_000.25 }),
      { op: 'stats-snapshot' },
    ]);
    expect(snap.doc.usageHeaders).toEqual({
      at: '2023-11-14T22:13:20.250Z',
      values: { 'x-codex-fx-alpha': '42.5', 'x-codex-fx-max': '1'.repeat(64), 'x-codex-fx-flag': 'true' },
    });
  });

  it('a name outside KNOWN is listed in unexplained', async () => {
    const { home, file } = lane('cb-stats-unexplained-');
    const [k] = await run(home, [{ op: 'known' }]);
    const code = (k.known.errorCode as string[])[0];
    const [, , , , , , , snap] = await run(home, [
      open(file),
      call('name', ['eventType', 'response.fx_new_event']),
      call('name', ['eventType', 'response.metadata']),
      call('name', ['errorCode', code]),
      call('name', ['errorCode', 'fx_new_code']),
      call('name', ['responseHeader', 'x-codex-fx-anything']),
      call('name', ['contextEdit', 'clear_thinking_20251015']),
      { op: 'stats-snapshot' },
    ]);
    expect(snap.doc.unexplained).toEqual({ eventType: ['response.fx_new_event'], errorCode: ['fx_new_code'] });
    expect(snap.doc.names.eventType).toEqual({ 'response.fx_new_event': 1, 'response.metadata': 1 });
  });

  // The 33 response header names every answer of runbook step 2 carried (2026-10-27, measured on the live probe's
  // first step; D-7083), in the order the probe printed them, and the media-type name a 2xx stream with no content
  // type counts. Unlike this file's other x-codex- names these are the backend's own: the case pins that the
  // measured set is explained, so the doctor's drift row stays quiet on the backend's ordinary answers.
  const MEASURED_HEADERS = [
    'date', 'transfer-encoding', 'connection', 'server', 'x-codex-active-limit', 'x-codex-plan-type',
    'x-codex-primary-used-percent', 'x-codex-secondary-used-percent', 'x-codex-primary-window-minutes',
    'x-codex-primary-over-secondary-limit-percent', 'x-codex-secondary-window-minutes',
    'x-codex-primary-reset-after-seconds', 'x-codex-secondary-reset-after-seconds', 'x-codex-primary-reset-at',
    'x-codex-secondary-reset-at', 'x-codex-credits-has-credits', 'x-codex-credits-balance', 'x-codex-credits-unlimited',
    'x-models-etag', 'x-codex-turn-state', 'x-codex-safety-buffering-enabled', 'x-codex-safety-buffering-faster-model',
    'x-oai-request-id', 'x-openai-proxy-wasm', 'x-content-type-options', 'cf-cache-status', 'cross-origin-opener-policy',
    'strict-transport-security', 'nel', 'report-to', 'set-cookie', 'referrer-policy', 'cf-ray',
  ];
  it('every response header name the live probe measured (runbook step 2) is explained', async () => {
    expect(MEASURED_HEADERS).toHaveLength(33);
    const { home, file } = lane('cb-stats-measured-');
    const [, , , snap] = await run(home, [
      open(file),
      call('header_names', [Object.fromEntries(MEASURED_HEADERS.map((n) => [n, 'fx']))]),
      call('name', ['responseHeader', 'content-type:absent']),
      { op: 'stats-snapshot' },
    ]);
    // the control: every name was counted, so the empty unexplained list is about KNOWN, not a call that missed
    expect(Object.keys(snap.doc.names.responseHeader).sort()).toEqual([...MEASURED_HEADERS, 'content-type:absent'].sort());
    expect(snap.doc.unexplained.responseHeader).toBeUndefined();
  });

  // Claude Code 2.1.310's eight `anthropic-beta` values, measured on the live lane's first traffic after the flip
  // (runbook step 4, 2026-10-27; D-7093). Six gate shapes the bridge never sends or already counts by their own family,
  // and are explained; the two tool-change betas gate `tool_addition`/`tool_removal` blocks, which inbound drops
  // uncounted, so they stay unexplained and the doctor keeps naming them until the bridge honours those blocks.
  const EXPLAINED_BETAS = [
    'advanced-tool-use-2025-11-20', 'claude-code-20250219', 'context-management-2025-06-27',
    'interleaved-thinking-2025-05-14', 'thinking-display-updates-2026-08-18', 'thinking-token-count-2026-05-13',
  ];
  const OPEN_BETAS = ['inline-tools-2026-09-15', 'mid-conversation-tool-changes-2026-07-01'];
  it("Claude Code's measured betas: six are explained, and the two tool-change betas stay unexplained", async () => {
    const { home, file } = lane('cb-stats-betas-');
    const all = [...EXPLAINED_BETAS, ...OPEN_BETAS, 'effort-2025-11-24'];
    const out = await run(home, [open(file), ...all.map((b) => call('name', ['betaValue', b])), { op: 'stats-snapshot' }]);
    const snap = out[out.length - 1];
    // the control: every beta was counted, so the unexplained list is about KNOWN, not a call that missed
    expect(Object.keys(snap.doc.names.betaValue).sort()).toEqual([...all].sort());
    expect(snap.doc.unexplained.betaValue).toEqual([...OPEN_BETAS].sort());
  });

  it('KNOWN covers every family, and its errorCode family is errors.ALL_CODES', async () => {
    const { home } = lane('cb-stats-known-');
    const [k, sets] = await run(home, [{ op: 'known' }, { op: 'sets' }]);
    expect(k.families).toEqual([
      'requestField', 'eventType', 'itemType', 'errorCode', 'incompleteReason', 'responseHeader', 'unsupportedField',
      'modelSubstitution', 'betaValue', 'contextEdit',
    ]);
    expect(Object.keys(k.known).sort()).toEqual([...k.families].sort());
    expect(k.known.errorCode).toEqual(sets.ALL_CODES);
    expect(k.known.contextEdit).toEqual(['clear_thinking_20251015']);
    expect(k.known.eventType).toContain('response.metadata');
    expect(k.prefixes).toEqual({ responseHeader: ['x-codex-'] });
  });

  it('a flush that fails is retried, nothing lost', async () => {
    const { home, dir, file } = lane('cb-stats-enospc-');
    // A first good flush starts the FLUSH_S clock (10 s), so the retry below is inside it.
    const [, , ok, , , failed, snap, onDisk, retried] = await run(home, [
      open(file),
      call('name', ['requestField', 'metadata']),
      call('flush', [], { force: true }),
      call('name', ['requestField', 'max_tokens']),
      { op: 'stats-fault', call: 'fsync', errno: 'ENOSPC', times: 1 },
      call('flush', [], { force: true }),
      { op: 'stats-snapshot' },
      { op: 'stats-file', path: file },
      call('flush'),
    ]);
    expect(ok.result).toBe(true);
    expect(failed.result).toBe(false);
    expect(snap.doc.outcomes).toEqual({ 'stats:flush-failed': 1 });
    expect(snap.doc.names.requestField).toEqual({ metadata: 1, max_tokens: 1 });
    expect(onDisk.dir).toEqual([STATS]); // the failed attempt's tmp file was removed
    expect(retried.result).toBe(true); // the next flush retries at once, inside FLUSH_S
    expect(readdirSync(dir)).toEqual([STATS]);
    const doc = readDoc(file);
    expect(doc.names.requestField).toEqual({ metadata: 1, max_tokens: 1 });
    expect(doc.outcomes).toEqual({ 'stats:flush-failed': 1 });
  });

  it('a restart keeps unconsumed refusals, the ratio, the counters and the unexplained list', async () => {
    const { home, file } = lane('cb-stats-restart-');
    const [first] = await run(home, [
      open(file),
      call('request', ['backend', MODEL, 40_000]),
      call('usage', ['backend', MODEL, 40_000, 10_000], { image_count: 0 }),
      call('refusal', ['backend', MODEL, 450_000, 400_000], { now: 1_700_000_000 }),
      call('outcome', ['2xx']),
      call('name', ['eventType', 'response.fx_new_event']),
      call('flush', [], { force: true }),
    ]);
    const before = readDoc(file);
    const [second, ratio] = await run(home, [open(file), call('ratio', ['backend', MODEL])]);
    const doc = second.doc as Line;
    expect(doc.since).toBe(first.doc.since);
    expect(doc.startedAt).not.toBe(first.doc.startedAt);
    expect(Date.parse(doc.startedAt)).toBeGreaterThan(Date.parse(first.doc.startedAt));
    expect(doc.refusals).toEqual({
      [ROUTE_KEY]: { tokens: 450_000, window: 400_000, at: '2023-11-14T22:13:20.000Z', estimated: true },
    });
    expect(doc.routes[ROUTE_KEY]).toMatchObject({ requests: 1, promptTokensMax: 10_000 });
    expect(doc.routes[ROUTE_KEY].bytesPerToken).toBeCloseTo(3.6, 12);
    expect(ratio.result).toBeCloseTo(3.6, 12);
    expect(doc.outcomes).toEqual({ '2xx': 1 });
    expect(doc.names).toEqual(before.names);
    expect(doc.unexplained).toEqual({ eventType: ['response.fx_new_event'] });
    // Nothing the load changed, so the file is the first process's until a flush.
    expect(readDoc(file)).toEqual(before);
  });

  it('an other-lane or other-version file starts fresh and counts stats:reset', async () => {
    for (const [label, body] of [
      ['other lane', JSON.stringify({ version: 1, lane: 'lane-b', since: '2026-01-01T00:00:00.000Z', outcomes: { '2xx': 9 } })],
      ['other version', JSON.stringify({ version: 2, lane: 'lane-a', since: '2026-01-01T00:00:00.000Z', outcomes: { '2xx': 9 } })],
      ['unreadable', '{"version": 1, "lane": "lane-a", '],
    ] as const) {
      const { home, file } = lane('cb-stats-reset-');
      writeFileSync(file, body, { mode: 0o600 });
      const [o] = await run(home, [open(file)]);
      expect(o.doc.outcomes, label).toEqual({ 'stats:reset': 1 });
      expect(o.doc.since, label).toBe(o.doc.startedAt);
      // The reset reached the file at construction, with no request and no flush call.
      const doc = readDoc(file);
      expect(doc.lane, label).toBe('lane-a');
      expect(doc.version, label).toBe(1);
      expect(doc.outcomes, label).toEqual({ 'stats:reset': 1 });
    }
  });

  it('an image never moves the ratio', async () => {
    const { home, file } = lane('cb-stats-image-');
    const [, , snap] = await run(home, [
      open(file),
      call('usage', ['backend', MODEL, 80_000, 10_000], { image_count: 1 }),
      { op: 'stats-snapshot' },
    ]);
    expect(snap.doc.routes[ROUTE_KEY]).toMatchObject({ bytesPerToken: 3.5, promptTokensMax: 10_000, promptTokensLast: 10_000 });
  });

  it('a continued message never moves the ratio', async () => {
    const { home, file } = lane('cb-stats-continued-');
    const [, , , snap] = await run(home, [
      open(file),
      call('usage', ['backend', MODEL, 80_000, 10_000], { image_count: 0, continued: true }),
      call('usage', ['backend', MODEL, 10_000, 2000], { image_count: 0, continued: true }),
      { op: 'stats-snapshot' },
    ]);
    expect(snap.doc.routes[ROUTE_KEY]).toMatchObject({ bytesPerToken: 3.5, promptTokensMax: 10_000, promptTokensLast: 2000 });
  });

  it('a carried unexplained name that KNOWN now lists is dropped at load', async () => {
    const { home, file } = lane('cb-stats-dropknown-');
    const [k] = await run(home, [{ op: 'known' }]);
    expect(k.known.eventType).toContain('response.metadata');
    expect(k.known.eventType).not.toContain('response.fx_new_event');
    const planted = {
      version: 1, lane: 'lane-a', since: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', routes: {}, refusals: {}, outcomes: { '2xx': 3 },
      names: { eventType: { 'response.metadata': 1, 'response.fx_new_event': 1 } },
      unexplained: { eventType: ['response.fx_new_event', 'response.metadata'] },
      usageHeaders: null, lastUpstreamRequestId: null,
    };
    writeFileSync(file, JSON.stringify(planted), { mode: 0o600 });
    const [o] = await run(home, [open(file)]);
    expect(o.doc.unexplained).toEqual({ eventType: ['response.fx_new_event'] });
    expect(o.doc.since).toBe('2026-01-01T00:00:00.000Z');
    expect(o.doc.outcomes).toEqual({ '2xx': 3 });
    // Read back with no request and no flush call after construction: the file no longer lists the explained name.
    expect(existsSync(file)).toBe(true);
    const doc = readDoc(file);
    expect(doc.unexplained).toEqual({ eventType: ['response.fx_new_event'] });
    expect(doc.since).toBe('2026-01-01T00:00:00.000Z');
  });

  // The whole-wave fix round, Z1: `unrecognised` and `overflow` are markers, which no change to known.py can explain,
  // so the load carries neither in `unexplained`; each comes back only when the bridge meets such a name again. A real
  // unexplained name, and every `names` counter, is carried as before.
  it('a restart clears the unrecognised and overflow markers, and carries a real unexplained name', async () => {
    const { home, file } = lane('cb-stats-markers-');
    const planted = {
      version: 1, lane: 'lane-a', since: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z', routes: {}, refusals: {}, outcomes: {},
      names: { eventType: { unrecognised: 2, 'response.fx_new_event': 1 }, responseHeader: { overflow: 3 } },
      unexplained: { eventType: ['response.fx_new_event', 'unrecognised'], responseHeader: ['overflow'] },
      usageHeaders: null, lastUpstreamRequestId: null,
    };
    writeFileSync(file, JSON.stringify(planted), { mode: 0o600 });
    const [o, , snap] = await run(home, [open(file), call('name', ['eventType', 'x'.repeat(65)]), { op: 'stats-snapshot' }]);
    expect(o.doc.unexplained).toEqual({ eventType: ['response.fx_new_event'] });
    expect(o.doc.names).toEqual(planted.names);
    // The load changed what it carried, so the file the doctor reads changed at the restart, with no flush call.
    expect(readDoc(file).unexplained).toEqual({ eventType: ['response.fx_new_event'] });
    // Met again, the marker is listed again.
    expect(snap.doc.unexplained).toEqual({ eventType: ['response.fx_new_event', 'unrecognised'] });
  });
});

// Review fix round 1 (Task 5): a case for each guard the task added beyond the plan's list, each with a measured
// mutation row in the commit body.
describe.skipIf(!PY)('the stats file\'s added guards (codex-bridge Stage 2, Task 5 fix round 1)', () => {
  /** A valid lane-a version-1 file with one carried outcome, as raw text. */
  const plantedValid = (): string => JSON.stringify({
    version: 1, lane: 'lane-a', since: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', routes: {}, refusals: {}, outcomes: { '2xx': 9 }, names: {},
    unexplained: {}, usageHeaders: null, lastUpstreamRequestId: null,
  });

  it('a ratio that is not a finite positive number estimates at the seed', async () => {
    const { home } = lane('cb-count-badratio-');
    const [c] = await run(home, [{
      op: 'count',
      estimate: [[7, 3.5], [7, 0], [7, -2], [7, { float: 'nan' }], [7, { float: 'inf' }], [7, true]],
    }]);
    // ceil(7 / 3.5) = 2, the seed's estimate, for every row.
    expect(c.estimate).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('a carried field of the wrong type or range is not carried', async () => {
    const { home, file } = lane('cb-stats-badfield-');
    const at = '2026-01-02T00:00:00.000Z';
    // Raw text, so a NaN reaches the loader as Python's json reads it.
    const body = `{"version": 1, "lane": "lane-a", "since": "has space", "startedAt": "${at}", "updatedAt": "${at}",
      "routes": {
        "backend/model-fx-low": {"requests": "x", "bytesPerToken": 0.01, "promptTokensMax": -1, "promptTokensLast": 5},
        "backend/model-fx-high": {"requests": 3, "bytesPerToken": 50, "promptTokensMax": 7},
        "backend/model-fx-nan": {"requests": 2, "bytesPerToken": NaN, "promptTokensMax": 1},
        "backend/model-fx-ok": {"requests": 4, "bytesPerToken": 4.5, "promptTokensMax": 9},
        "has space/model-fx": {"requests": 1, "bytesPerToken": 4.5, "promptTokensMax": 1},
        "nokey": {"requests": 1, "bytesPerToken": 4.5, "promptTokensMax": 1}
      },
      "refusals": {
        "backend/model-fx-tokens": {"tokens": "x", "window": 1, "at": "${at}", "estimated": true},
        "backend/model-fx-window": {"tokens": 1, "window": -5, "at": "${at}", "estimated": true},
        "backend/model-fx-at": {"tokens": 1, "window": 1, "at": "has space", "estimated": true},
        "has space/model-fx": {"tokens": 1, "window": 1, "at": "${at}", "estimated": true},
        "backend/model-fx-ok": {"tokens": 5, "window": 6, "at": "${at}", "estimated": true}
      },
      "outcomes": {"2xx": "x", "has space": 1, "4xx": 2},
      "names": {"eventType": {"has space": 1, "response.fx_a": "x", "response.fx_b": 3}},
      "unexplained": {"eventType": ["response.fx_b", 7, "has space"]},
      "usageHeaders": null, "lastUpstreamRequestId": null}`;
    writeFileSync(file, body, { mode: 0o600 });
    const [o] = await run(home, [open(file)]);
    const doc = o.doc as Line;
    expect(doc.since).toBe(doc.startedAt); // a since outside NAME_RE is not carried
    expect(doc.routes).toEqual({
      'backend/model-fx-low': { requests: 0, bytesPerToken: 3.5, promptTokensMax: 0, promptTokensLast: 0 },
      'backend/model-fx-high': { requests: 3, bytesPerToken: 3.5, promptTokensMax: 7, promptTokensLast: 0 },
      'backend/model-fx-nan': { requests: 2, bytesPerToken: 3.5, promptTokensMax: 1, promptTokensLast: 0 },
      'backend/model-fx-ok': { requests: 4, bytesPerToken: 4.5, promptTokensMax: 9, promptTokensLast: 0 },
    });
    expect(doc.refusals).toEqual({ 'backend/model-fx-ok': { tokens: 5, window: 6, at, estimated: true } });
    expect(doc.outcomes).toEqual({ '4xx': 2 });
    expect(doc.names).toEqual({ eventType: { 'response.fx_b': 3 } });
    expect(doc.unexplained).toEqual({ eventType: ['response.fx_b'] });
  });

  it('a symlink at the stats path is replaced, never followed', async () => {
    const { home, file } = lane('cb-stats-symlink-');
    const decoy = path.join(home, 'decoy.json');
    writeFileSync(decoy, plantedValid(), { mode: 0o600 });
    symlinkSync(decoy, file);
    const [o] = await run(home, [open(file)]);
    expect(o.doc.outcomes).toEqual({ 'stats:reset': 1 });
    expect(readFileSync(decoy, 'utf8')).toBe(plantedValid());
    expect(lstatSync(file).isSymbolicLink()).toBe(false);
    expect(readDoc(file).outcomes).toEqual({ 'stats:reset': 1 });
  });

  it('a symlink at the tmp name is never written through', async () => {
    const { home, dir, file } = lane('cb-stats-tmplink-');
    const decoy = path.join(home, 'decoy.txt');
    writeFileSync(decoy, 'DECOY', { mode: 0o600 });
    symlinkSync(decoy, `${file}.tmp`);
    const [, , failed, snap, retried] = await run(home, [
      open(file),
      call('name', ['requestField', 'metadata']),
      call('flush', [], { force: true }),
      { op: 'stats-snapshot' },
      call('flush'),
    ]);
    expect(failed.result).toBe(false);
    expect(snap.doc.outcomes).toEqual({ 'stats:flush-failed': 1 });
    expect(retried.result).toBe(true);
    expect(readFileSync(decoy, 'utf8')).toBe('DECOY');
    expect(readdirSync(dir)).toEqual([STATS]);
    expect(lstatSync(file).isSymbolicLink()).toBe(false);
  });

  it('a killed writer\'s leftover tmp file is overwritten, never left', async () => {
    const { home, dir, file } = lane('cb-stats-staletmp-');
    writeFileSync(`${file}.tmp`, 'partial', { mode: 0o600 });
    await run(home, [open(file), call('outcome', ['2xx']), call('flush', [], { force: true })]);
    expect(readdirSync(dir)).toEqual([STATS]);
    expect(readDoc(file).outcomes).toEqual({ '2xx': 1 });
  });

  it('a stats file over READ_MAX starts fresh', async () => {
    const { home, file } = lane('cb-stats-readmax-');
    const size = Buffer.byteLength(plantedValid());
    writeFileSync(file, plantedValid(), { mode: 0o600 });
    const [at] = await run(home, [open(file)], { consts: { 'stats.READ_MAX': size } });
    expect(at.doc.outcomes).toEqual({ '2xx': 9 });
    writeFileSync(file, plantedValid(), { mode: 0o600 });
    const [over] = await run(home, [open(file)], { consts: { 'stats.READ_MAX': size - 1 } });
    expect(over.doc.outcomes).toEqual({ 'stats:reset': 1 });
  });

  it('a response keeps at most 64 x-codex- headers', async () => {
    const { home, file } = lane('cb-stats-headersmax-');
    const headers: Record<string, string> = {};
    for (let i = 0; i < 65; i += 1) headers[`x-codex-fx-h${i}`] = String(i);
    const [, , snap] = await run(home, [open(file), call('usage_headers', [headers], { now: 1_700_000_000 }),
      { op: 'stats-snapshot' }]);
    const values = snap.doc.usageHeaders.values as Record<string, string>;
    expect(Object.keys(values)).toHaveLength(64);
    expect(values['x-codex-fx-h63']).toBe('63');
    expect(values['x-codex-fx-h64']).toBeUndefined();
  });

  it('an x-codex- value that is not a number or a boolean is never kept', async () => {
    const { home, file } = lane('cb-stats-turnstate-');
    const SENTINEL = 'SENTINEL-tok_fx1';
    await run(home, [
      open(file),
      call('usage_headers', [{
        'x-codex-fx-state': `${SENTINEL}AbCdEf0123`, 'x-codex-fx-promo': `${SENTINEL} free text`,
        'x-codex-fx-percent': '12', 'x-codex-fx-flag': 'false',
      }], { now: 1_700_000_000 }),
      call('header_names', [{ 'x-codex-fx-state': `${SENTINEL}AbCdEf0123` }]),
      call('flush', [], { force: true }),
    ]);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain(SENTINEL);
    const doc = readDoc(file);
    expect(doc.usageHeaders.values).toEqual({ 'x-codex-fx-percent': '12', 'x-codex-fx-flag': 'false' });
    expect(doc.names.responseHeader).toEqual({ 'x-codex-fx-state': 1 }); // the name is still counted
  });

  it('a family outside FAMILIES counts stats:unknown-family and records nothing', async () => {
    const { home, file } = lane('cb-stats-family-');
    const [, , snap] = await run(home, [open(file), call('name', ['noSuchFamily', 'fx-name']),
      { op: 'stats-snapshot' }]);
    expect(snap.doc.outcomes).toEqual({ 'stats:unknown-family': 1 });
    expect(snap.doc.names).toEqual({});
    expect(snap.doc.unexplained).toEqual({});
  });

  it('a route key longer than 64 characters survives a restart', async () => {
    const { home, file } = lane('cb-stats-longkey-');
    const model = `model-${'x'.repeat(54)}`; // 60 characters, so `backend/<model>` is 68
    const key = `backend/${model}`;
    await run(home, [
      open(file),
      call('usage', ['backend', model, 40_000, 10_000], { image_count: 0 }),
      call('refusal', ['backend', model, 450_000, 400_000], { now: 1_700_000_000 }),
      call('flush', [], { force: true }),
    ]);
    const [second] = await run(home, [open(file)]);
    expect(second.doc.routes[key]).toMatchObject({ promptTokensMax: 10_000 });
    expect(second.doc.routes[key].bytesPerToken).toBeCloseTo(3.6, 12);
    expect(second.doc.refusals[key]).toEqual({ tokens: 450_000, window: 400_000, at: '2023-11-14T22:13:20.000Z',
      estimated: true });
  });

  it('a malformed argument is ignored, never raised into a request', async () => {
    const { home, file } = lane('cb-stats-badarg-');
    // `run` fails the case on any op that raised.
    const [, , , , , snap] = await run(home, [
      open(file),
      call('usage', ['backend', MODEL, 'x', 10_000], { image_count: 0 }),
      call('header_names', [null]),
      call('usage_headers', [[1, 2]], { now: 1_700_000_000 }),
      call('header_names', [[1, 2]]),
      { op: 'stats-snapshot' },
    ]);
    expect(snap.doc.routes[ROUTE_KEY]).toMatchObject({ bytesPerToken: 3.5, promptTokensMax: 10_000 });
    expect(snap.doc.usageHeaders).toBeNull();
    expect(snap.doc.names).toEqual({});
  });
});

// Review fix round 2 (Task 5): the flush's write lock, a malformed `now` and header item, and the x-codex- value rule.
// The `stats-race` op runs a flush whose fsync, once, lets a second thread make Stats calls while the write is in
// flight; `duringFinished` says whether that thread ended inside the write.
describe.skipIf(!PY)('the stats file\'s write lock and value rules (codex-bridge Stage 2, Task 5 fix round 2)', () => {
  const race = (flush: Record<string, unknown>, during: object[], waitS: number): object =>
    ({ op: 'stats-race', flush, during: during.map((c) => ({ args: [], kwargs: {}, ...c })), waitS });

  it('a counter call returns while a flush\'s write is in fsync, and its change goes out with the next flush', async () => {
    const { home, file } = lane('cb-stats-race-counter-');
    const [, , r, next] = await run(home, [
      open(file),
      call('outcome', ['2xx']),
      race({ force: true }, [{ method: 'outcome', args: ['fx-during'] }], 5),
      call('flush'),
    ], { consts: { 'stats.FLUSH_S': 0 } });
    expect(r.result).toBe(true);
    expect(r.duringFinished).toBe(true); // the counter never waited for the fsync
    expect(r.duringRaised).toEqual([]);
    expect(r.duringAlive).toBe(false);
    expect(next.result).toBe(true); // the change made during the write stayed dirty
    expect(readDoc(file).outcomes).toEqual({ '2xx': 1, 'fx-during': 1 });
  });

  it('an unforced flush while a write is in flight writes nothing, and its change goes out with the next one', async () => {
    const { home, file } = lane('cb-stats-race-unforced-');
    const [, , r, next] = await run(home, [
      open(file),
      call('outcome', ['2xx']),
      race({ force: true }, [{ method: 'outcome', args: ['fx-during'] }, { method: 'flush' }], 5),
      call('flush'),
    ], { consts: { 'stats.FLUSH_S': 0 } });
    expect(r.result).toBe(true);
    expect(r.duringFinished).toBe(true); // the unforced flush did not wait for the write in flight
    expect(r.duringResults).toEqual([null, false]);
    expect(r.duringRaised).toEqual([]);
    expect(next.result).toBe(true);
    expect(readDoc(file).outcomes).toEqual({ '2xx': 1, 'fx-during': 1 });
  });

  it('a forced flush while a write is in flight waits for it, then writes', async () => {
    const { home, dir, file } = lane('cb-stats-race-forced-');
    const [, , r] = await run(home, [
      open(file),
      call('outcome', ['2xx']),
      race({ force: true }, [{ method: 'outcome', args: ['fx-during'] }, { method: 'flush', kwargs: { force: true } }],
        0.5),
    ]);
    expect(r.result).toBe(true);
    expect(r.duringFinished).toBe(false); // it waited for the write in flight
    expect(r.duringAlive).toBe(false);
    expect(r.duringRaised).toEqual([]);
    expect(r.duringResults).toEqual([null, true]);
    expect(readDoc(file).outcomes).toEqual({ '2xx': 1, 'fx-during': 1 });
    expect(readdirSync(dir)).toEqual([STATS]);
  });

  it('a malformed now reads as the wall clock, and a header item that is not a pair is skipped', async () => {
    const { home, file } = lane('cb-stats-badnow-');
    const [o, , , , , clock, early, , , snap] = await run(home, [
      open(file),
      call('refusal', ['backend', 'model-fx-str', 5, 6], { now: 'x' }),
      call('refusal', ['backend', 'model-fx-nan', 5, 6], { now: { float: 'nan' } }),
      call('refusal', ['backend', 'model-fx-big', 5, 6], { now: 1e300 }),
      call('refusal', ['backend', 'model-fx-bool', 5, 6], { now: true }),
      call('usage_headers', [{ 'x-codex-fx-a': '1' }], { now: 'x' }),
      { op: 'stats-snapshot' }, // read before the next usage_headers call replaces the snapshot
      call('header_names', [{ itemsOf: [['x-codex-fx-b', '2'], 7, ['a', 'b', 'c'], 'xy'] }]),
      call('usage_headers', [{ itemsOf: [['x-codex-fx-c', '3'], 7, ['a', 'b', 'c'], 'xy'] }], { now: 1_700_000_000 }),
      { op: 'stats-snapshot' },
    ]);
    expect(clock.result).toBeNull();
    const started = Date.parse(o.doc.startedAt as string);
    const first = (early.doc as Line).usageHeaders as { at: string; values: Record<string, string> };
    expect(first.values).toEqual({ 'x-codex-fx-a': '1' });
    expect(first.at).toMatch(ISO);
    expect(Date.parse(first.at)).toBeGreaterThanOrEqual(started - 1000); // the wall clock, never 1970
    const doc = snap.doc as Line;
    for (const model of ['model-fx-str', 'model-fx-nan', 'model-fx-big', 'model-fx-bool']) {
      const at = doc.refusals[`backend/${model}`].at as string;
      expect(at, model).toMatch(ISO);
      expect(Date.parse(at), model).toBeGreaterThanOrEqual(started - 1000); // the wall clock, never 1970
    }
    expect(doc.names.responseHeader).toEqual({ 'x-codex-fx-b': 1 });
    expect(doc.usageHeaders).toEqual({ at: '2023-11-14T22:13:20.000Z', values: { 'x-codex-fx-c': '3' } });
  });

  it('a near-miss number and a token header are never kept as x-codex- values', async () => {
    const { home, file } = lane('cb-stats-nearmiss-');
    // `x-codex-turn-state` is Codex's sticky-routing token (upstream openai/codex @ 092d3ac,
    // codex-rs/core/src/client.rs:288-302); an all-digit value under it is still a token.
    const TOKEN = '9081726354453627';
    const headers = {
      'x-codex-fx-near': '1-2', 'x-codex-fx-dots': '1..5', 'x-codex-fx-exp': '9e+e-', 'x-codex-fx-trail': '1.',
      'x-codex-turn-state': TOKEN, 'x-codex-fx-ok': '1.5e-3', 'x-codex-fx-n': '-17',
    };
    await run(home, [
      open(file),
      call('usage_headers', [headers], { now: 1_700_000_000 }),
      call('header_names', [headers]),
      call('flush', [], { force: true }),
    ]);
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN);
    const doc = readDoc(file);
    expect(doc.usageHeaders.values).toEqual({ 'x-codex-fx-ok': '1.5e-3', 'x-codex-fx-n': '-17' });
    expect(doc.names.responseHeader['x-codex-turn-state']).toBe(1); // the name is still counted
  });
});
