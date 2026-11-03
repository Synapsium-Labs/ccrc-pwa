// D-7411, D-7444, D-7445 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB9; spec 2026-10-28 §2.7). The
// server's test box decider (`server/src/testbox.ts`) and its poll (`server/src/testboxLane.ts`):
//  - every state and every reason, each decided once with the switch marker present and once without: the state is
//    equal both times and only the switch changes, and `off` appears only for an unconfigured box (D-7444);
//  - the 24-hour counts over a runs log spanning two day files, a line older than 24 hours left out and a malformed
//    line counted `unreadable` (D-7445);
//  - an agent without the op is `unreachable (agent has no testbox op)`, never `ok`;
//  - the poll's interval is the one the op's answer carries.
import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestboxHostTools, TestboxOpReply } from '../../shared/agent-protocol.js';
import { TESTBOX_REMOTE_LIVE_MARKER } from '../../shared/switches.js';
import { TESTBOX_PROTO, TESTBOX_STATE_MAP, type StatusAnswer, type TestboxState } from '../../shared/testbox.js';
import { runsCounts, runsLogDates, testboxBlock, testboxSwitch, type TestboxAnswer } from '../src/testbox.js';
import { TESTBOX_POLL_DEFAULT_MS, TestboxLane } from '../src/testboxLane.js';
import { localIOFor, type FleetIO, type MeasuredTestbox } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import { seedRoster } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = Date.parse('2026-10-30T12:00:00Z');
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const HOST = { tools: TOOLS as TestboxHostTools, release: 'v0.0.900', measuredAt: '2026-10-30T11:59:59Z' };
const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900', tools: TOOLS,
  sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 2 }, queueDepth: 0, pristine: [],
  failedKeys: [], heldRunUsers: [], repositories: [],
};
const reply = (box: TestboxOpReply['box'], host = HOST): TestboxAnswer => ({ ok: true, reply: { host, pollMs: 30_000, box } });
const status = (over: Partial<StatusAnswer>): TestboxAnswer => reply({ ok: true, status: { ...STATUS, ...over } });

/** Every state and reason the decider has, each with the answer that produces it. */
const CASES: readonly { name: string; answer: TestboxAnswer; state: TestboxState; reasons: readonly string[] }[] = [
  { name: 'unconfigured', answer: reply({ ok: false, failure: 'unconfigured', detail: null }), state: 'off', reasons: [] },
  { name: 'healthy', answer: status({}), state: 'ok', reasons: [] },
  { name: 'a version cell differs', answer: status({ tools: { ...TOOLS, node: '22.12.0' } }), state: 'degraded', reasons: ['tools differ (node 22.11.0 vs 22.12.0)'] },
  { name: 'a host tool unmeasured', answer: reply({ ok: true, status: STATUS }, { ...HOST, tools: { ...TOOLS, git: null } as TestboxHostTools }), state: 'degraded', reasons: ['tools differ (git unmeasured vs 2.43.0)'] },
  { name: 'the release differs', answer: status({ release: 'v0.0.899' }), state: 'degraded', reasons: ['tools differ (release v0.0.900 vs v0.0.899)'] },
  { name: 'a sync in progress', answer: status({ state: 'degraded', reason: 'tool sync in progress', sync: { state: 'syncing', detail: 'node', at: null } }), state: 'degraded', reasons: ['tool sync in progress (node)'] },
  { name: 'a sync failed', answer: status({ state: 'degraded', reason: 'x', sync: { state: 'failed', detail: 'chrome: 404', at: '2026-10-30T11:00:00Z' } }), state: 'degraded', reasons: ['tool sync failed (chrome: 404)'] },
  { name: 'a failed pristine key', answer: status({ state: 'degraded', reason: 'x', failedKeys: [{ repository: 'project-a', package: 'server', key: 'k1', exit: 1, attempts: 2, nextAttempt: '2026-10-30T13:00:00Z' }] }), state: 'degraded', reasons: ['pristine install failed (server k1, exit 1)'] },
  { name: 'a held run user', answer: status({ state: 'degraded', reason: 'x', heldRunUsers: ['ccrc-tb-3'] }), state: 'degraded', reasons: ['run user held out (ccrc-tb-3)'] },
  { name: 'the box\'s own degraded reason', answer: status({ state: 'degraded', reason: 'tool versions not measured' }), state: 'degraded', reasons: ['tool versions not measured'] },
  { name: 'down', answer: status({ state: 'down', reason: 'no reflink on the run root (EOPNOTSUPP); missing mirror project-a' }), state: 'down', reasons: ['no reflink on the run root (EOPNOTSUPP)', 'missing mirror project-a'] },
  { name: 'unreachable', answer: reply({ ok: false, failure: 'unreachable', detail: 'no status answer within 3000 ms' }), state: 'unreachable', reasons: ['no status answer within 3000 ms'] },
  { name: 'a bad answer', answer: reply({ ok: false, failure: 'bad-answer', detail: 'state: not one of ok, degraded, down' }), state: 'unreachable', reasons: ['bad answer: state: not one of ok, degraded, down'] },
  { name: 'an agent without the op', answer: { ok: false, reason: 'no-op' }, state: 'unreachable', reasons: ['agent has no testbox op'] },
  { name: 'an agent that did not answer', answer: { ok: false, reason: 'unanswered' }, state: 'unreachable', reasons: ['the fleet agent did not answer the testbox op'] },
];

describe('testboxBlock: the state and the switch are two fields (D-7444)', () => {
  it.each(CASES)('$name: the same state with the marker present and absent; only the switch changes', ({ answer, state, reasons }) => {
    const on = testboxBlock({ answer, listing: [TESTBOX_REMOTE_LIVE_MARKER, 'other'], logs: ['', ''], now: NOW });
    const off = testboxBlock({ answer, listing: ['other'], logs: ['', ''], now: NOW });
    expect([on.state, on.reasons]).toEqual([state, reasons]);
    expect([off.state, off.reasons]).toEqual([state, reasons]);
    expect([on.switch, off.switch]).toEqual(['on', 'off']);
    expect({ ...on, switch: 'x' }).toEqual({ ...off, switch: 'x' });
  });

  it('the cases reach every state', () => {
    expect([...new Set(CASES.map((c) => c.state))].sort()).toEqual(Object.keys(TESTBOX_STATE_MAP).sort());
  });

  it('off appears only for an unconfigured box', () => {
    expect(CASES.filter((c) => c.state === 'off').map((c) => c.name)).toEqual(['unconfigured']);
  });

  it('an agent without the op is unreachable (agent has no testbox op), never ok', () => {
    const b = testboxBlock({ answer: { ok: false, reason: 'no-op' }, listing: [], logs: ['', ''], now: NOW });
    expect(b.summary).toBe('unreachable (agent has no testbox op)');
    expect(b.state).not.toBe('ok');
  });

  it('an unlistable registry is an unknown switch, and the state does not move', () => {
    const b = testboxBlock({ answer: status({}), listing: null, logs: ['', ''], now: NOW });
    expect([b.state, b.switch]).toEqual(['ok', 'unknown']);
    expect(testboxSwitch(null)).toBe('unknown');
  });

  it('the cells mark each differing tool and the release', () => {
    const b = testboxBlock({ answer: status({ tools: { ...TOOLS, chrome: '131.0.6778.86' } }), listing: [], logs: ['', ''], now: NOW });
    expect(b.cells.filter((c) => c.differs).map((c) => c.tool)).toEqual(['chrome']);
    expect(b.cells.map((c) => c.tool)).toEqual(['node', 'npm', 'tmux', 'git', 'python3', 'chrome', 'release']);
  });
});

describe('runsCounts: the last 24 hours over two day files (D-7445)', () => {
  const today = [
    '2026-10-30T11:00:00Z\tremote\t-\t0',
    '2026-10-30T10:00:00Z\tfallback\tunreachable\t1',
    '2026-10-30T09:00:00Z\trefused\tover-budget\t75',
    'garbled line',
    '',
  ].join('\n');
  const yesterday = [
    '2026-10-29T12:00:00Z\tremote\t-\t0', // exactly 24 hours old: left out
    '2026-10-29T11:00:00Z\tfallback\tdown\t0', // older: left out
    '2026-10-29T13:00:00Z\tfallback\tunreachable\t0',
    '2026-10-29T14:00:00Z\trefused\tover-budget\t3', // a refusal must exit 75: malformed
    '',
  ].join('\n');

  it('counts each outcome and each reason, leaves out the old lines and counts the malformed ones unreadable', () => {
    expect(runsCounts([today, yesterday], NOW)).toEqual({
      remote: 1, fallback: 2, refused: 1, unreadable: 2, byReason: { unreachable: 2, 'over-budget': 1 },
    });
  });

  it('an unreadable day file is no counts at all, never zero', () => {
    expect(runsCounts([today, null], NOW)).toBeNull();
    expect(runsCounts(['', ''], NOW)).toEqual({ remote: 0, fallback: 0, refused: 0, unreadable: 0, byReason: {} });
  });

  it('the day files are today\'s and yesterday\'s UTC dates', () => {
    expect(runsLogDates(NOW)).toEqual(['2026-10-30', '2026-10-29']);
    expect(runsLogDates(Date.parse('2026-11-01T00:30:00Z'))).toEqual(['2026-11-01', '2026-10-31']);
  });
});

describe('TestboxLane: the poll (D-7411)', () => {
  function lane(answers: MeasuredTestbox[]): { lane: TestboxLane; asked: () => number; clock: { t: number }; reg: string } {
    const home = mkTmp('ccrc-testbox-lane-');
    seedRoster(home);
    const cfg = loadConfig({ CCRC_HOME: home });
    const reg = cfg.registryDir;
    mkdirSync(path.join(reg, 'testbox-runs'), { recursive: true });
    writeFileSync(path.join(reg, 'testbox-runs', '2026-10-30.log'), '2026-10-30T11:00:00Z\tremote\t-\t0\n');
    let n = 0;
    const io: FleetIO = { ...localIOFor(home), testboxMeasured: async () => answers[Math.min(n++, answers.length - 1)]! };
    const clock = { t: NOW };
    return { lane: new TestboxLane(() => ({ io, cfg }), () => clock.t), asked: () => n, clock, reg };
  }
  const ok = (pollMs: number | null): MeasuredTestbox => ({ ok: true, reply: { host: HOST, pollMs, box: { ok: true, status: STATUS } } });

  it('holds nothing before its first pass, then the block with the runs log and the marker read', async () => {
    const l = lane([ok(45_000)]);
    expect(l.lane.block()).toBeNull();
    writeFileSync(path.join(l.reg, TESTBOX_REMOTE_LIVE_MARKER), '');
    await l.lane.sweep();
    expect(l.lane.block()).toMatchObject({ state: 'ok', switch: 'on', counts: { remote: 1 } });
  });

  it('polls at the interval the answer carries, and at the setting\'s default before one does', async () => {
    const l = lane([ok(null), ok(45_000)]);
    await l.lane.sweep();
    l.clock.t += TESTBOX_POLL_DEFAULT_MS - 1;
    await l.lane.sweep();
    expect(l.asked()).toBe(1);
    l.clock.t += 1;
    await l.lane.sweep();
    expect(l.asked()).toBe(2);
    l.clock.t += TESTBOX_POLL_DEFAULT_MS;
    await l.lane.sweep();
    expect(l.asked(), 'the answer carried 45 s').toBe(2);
    l.clock.t += 15_000;
    await l.lane.sweep();
    expect(l.asked()).toBe(3);
    await l.lane.sweep(true);
    expect(l.asked(), 'a forced pass ignores the clock').toBe(4);
  });
});
