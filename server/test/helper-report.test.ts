// Session helpers H2 (D-8872; spec 2026-11-19-session-helpers-design §4.3, §8 Table 11, J10): a finished helper's report
// travels on request, never on the frame. The PWA asks `{ type: 'helper-report', id }` over the session socket; the server
// answers `{ type: 'helper-report', id, report, cut }` from the reports it HOLDS, which are the reports of the fold's own
// end facts (`model.ts#holdReports`): masked, then cut with `cutAt`'s back-off, at 16 KiB, at parse time (reviews 2900 F7
// and F15). It holds at most `HELPER_KEPT_MAX`, the newest by end time, the same order the finished fold keeps rows by, and
// answers a report only for a row the last reading drew with `hasReport` (`model.ts#reportAnswer`): an unknown or evicted
// id is answered `report: null`, never a stale or another helper's text. An older server's parser reads the request as
// null and ignores it: the request carries no `visible`, so it can never be mistaken for one.
//
// RED FIRST: committed before the code, against origin/main, where nothing holds a report and nothing answers a request.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as model from '../src/workflows/model.js';
import { decideAgentHelpers, emptyHelperMemory, foldHelperFacts, type AgentArm, type HelperMeta, type RosterInput } from '../src/workflows/model.js';
import { helperFactsOf, type HelperFact } from '../src/transcript/parse.js';
import { SessionHelpers } from '../src/workflows/read.js';
import * as server from '../src/server.js';
import type { Deps } from '../src/server.js';
import { NO_TICK, SessionStream } from '../src/sessionws.js';
import { Bus } from '../src/bus.js';
import { loadConfig } from '../src/config.js';
import { ccdRunner } from '../src/lifecycle.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { KeyedQueue } from '../src/inject/queue.js';
import type { SessionStreamMsg } from '../../shared/api.js';
import { HELPER_FINISHED_KEEP_MS, HELPER_KEPT_MAX, HELPER_REPORT_MAX_BYTES } from '../../shared/workflows.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { fakeTime } from './fakeTime.js';

interface HeldReport { text: string; cut: boolean }
type Answer = { type: 'helper-report'; id: string; report: string | null; cut: boolean };
const M = model as unknown as {
  holdReports(prev: ReadonlyMap<string, HeldReport>, facts: readonly HelperFact[], folded: ReturnType<typeof foldHelperFacts>): Map<string, HeldReport>;
  reportAnswer(held: ReadonlyMap<string, HeldReport>, agents: AgentArm['agents'], id: string): Answer;
};

const NOW = Date.parse('2026-11-21T10:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();
const line = (o: unknown): string => JSON.stringify(o);
const notice = (id: string, at: number, result: string, status = 'completed'): string => line({
  type: 'user', uuid: `n-${id}-${at}`, timestamp: iso(at), origin: { kind: 'task-notification' },
  message: { role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>all done</summary>\n<result>${result}</result>\n</task-notification>` },
});
const factsOf = (...lines: string[]): HelperFact[] => lines.flatMap(helperFactsOf);
const meta = (o: Partial<HelperMeta> = {}): HelperMeta => ({
  path: 'agent', agentType: 'Explore', description: 'look around', model: 'model-a', effort: 'high', finished: false, lastWriteAt: null, tokens: null, ...o,
});
const listedNone: RosterInput = { kind: 'usable', at: NOW, entries: [] };

/** The fold, the held reports and the decision of one reading, as `SessionHelpers` composes them. */
const reading = (facts: HelperFact[], ids: string[], now = NOW, prevHeld: ReadonlyMap<string, HeldReport> = new Map()) => {
  const folded = foldHelperFacts(new Map(), facts);
  const held = M.holdReports(prevHeld, facts, folded);
  const arm = decideAgentHelpers({
    now, roster: listedNone, proc: { kind: 'live', startedAt: NOW - 3_600_000 }, facts: folded,
    metas: new Map(ids.map((id) => [id, meta()])), memory: emptyHelperMemory(),
  });
  return { held, arm };
};

describe('held reports: the fold\'s own end facts, capped at parse time', () => {
  it('a report past 16 KiB is answered cut, at most HELPER_REPORT_MAX_BYTES bytes, and says so', () => {
    const big = Array.from({ length: 3_000 }, (_, i) => `word${i}`).join(' '); // about 26 KiB, with delimiters to back off to
    const { held, arm } = reading(factsOf(notice('a1', NOW - 1_000, big)), ['a1']);
    const ans = M.reportAnswer(held, arm.agents, 'a1');
    expect(ans.type).toBe('helper-report');
    expect(ans.id).toBe('a1');
    expect(ans.cut).toBe(true);
    expect(ans.report).not.toBeNull();
    expect(Buffer.byteLength(ans.report!, 'utf8')).toBeLessThanOrEqual(HELPER_REPORT_MAX_BYTES);
    expect(big.startsWith(ans.report!), 'a prefix of the report, cut at a delimiter (cutAt\'s back-off)').toBe(true);
    expect(/\s$/.test(big.slice(0, ans.report!.length + 1)), 'the cut lands before a delimiter, never inside a word').toBe(true);
  });

  it('a short report is answered whole, not cut', () => {
    const { held, arm } = reading(factsOf(notice('a1', NOW - 1_000, 'line one\nline two')), ['a1']);
    expect(M.reportAnswer(held, arm.agents, 'a1')).toEqual({ type: 'helper-report', id: 'a1', report: 'line one\nline two', cut: false });
  });

  it('the report is shape-masked before it is held: a secret-shaped run never reaches the answer', () => {
    const secret = `sk-ant-api03-${'A'.repeat(40)}`;
    const { held, arm } = reading(factsOf(notice('a1', NOW - 1_000, `the key was ${secret} here`)), ['a1']);
    expect(M.reportAnswer(held, arm.agents, 'a1').report).not.toContain(secret);
  });

  it('an unknown id is answered report: null, never another helper\'s text', () => {
    const { held, arm } = reading(factsOf(notice('a1', NOW - 1_000, 'the report')), ['a1']);
    expect(M.reportAnswer(held, arm.agents, 'zz')).toEqual({ type: 'helper-report', id: 'zz', report: null, cut: false });
  });

  it('an evicted id (its row aged out of the ten-minute keep) is answered report: null', () => {
    const end = NOW - HELPER_FINISHED_KEEP_MS - 1;
    const { held, arm } = reading(factsOf(notice('a1', end, 'the report')), ['a1']);
    expect(arm.agents.map((a) => a.id), 'the row left the keep').toEqual([]);
    expect(M.reportAnswer(held, arm.agents, 'a1').report).toBeNull();
  });

  it('a row drawn without a report (a stopped helper) answers null, even when an earlier end of the same id held one', () => {
    const facts = factsOf(notice('a1', NOW - 5_000, 'first report'), notice('a1', NOW - 1_000, '', 'killed'));
    const { held, arm } = reading(facts, ['a1']);
    expect(arm.agents[0]).toMatchObject({ state: 'stopped', hasReport: false });
    expect(M.reportAnswer(held, arm.agents, 'a1').report).toBeNull();
  });

  it('the held report follows the fold\'s end: a later end\'s report replaces an earlier one\'s', () => {
    const facts = factsOf(notice('a1', NOW - 5_000, 'first report'), notice('a1', NOW - 1_000, 'second report'));
    const { held, arm } = reading(facts, ['a1']);
    expect(M.reportAnswer(held, arm.agents, 'a1').report).toBe('second report');
  });

  it('an earlier end arriving after a later one does not replace the later one\'s report (a backwards scan and a forward tail agree)', () => {
    const later = factsOf(notice('a1', NOW - 1_000, 'second report'));
    const earlier = factsOf(notice('a1', NOW - 5_000, 'first report'));
    const one = reading(later, ['a1']);
    const folded = foldHelperFacts(foldHelperFacts(new Map(), later), earlier);
    const held = M.holdReports(one.held, earlier, folded);
    expect(M.reportAnswer(held, one.arm.agents, 'a1').report).toBe('second report');
  });

  it(`at most HELPER_KEPT_MAX (${HELPER_KEPT_MAX}) reports are held, the newest by end time`, () => {
    const facts = factsOf(...Array.from({ length: HELPER_KEPT_MAX + 4 }, (_, i) => notice(`a${i}`, NOW - 100_000 + i * 1_000, `report ${i}`)));
    const held = M.holdReports(new Map(), facts, foldHelperFacts(new Map(), facts));
    expect(held.size).toBe(HELPER_KEPT_MAX);
    expect(held.has('a0'), 'the oldest end is not held').toBe(false);
    expect(held.has(`a${HELPER_KEPT_MAX + 3}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The reader holds them; the stream answers the request.

let home: string;
beforeEach(() => { home = mkTmp('ccrc-h2-report-'); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('SessionHelpers holds the reports of the rows it drew', () => {
  it('reportOf answers the drawn row\'s report, and null for an id it never drew', async () => {
    const S = path.join(home, '.claude-a', 'projects', '-work-project-a', 'session-uuid-a');
    const sub = path.join(S, 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look', model: 'model-a' }));
    writeFileSync(path.join(sub, 'agent-a1.jsonl'), `${line({ type: 'user', timestamp: iso(NOW - 3_000), message: { role: 'user', content: 'x' } })}\n`);
    const r = new SessionHelpers(localIO, S) as SessionHelpers & { reportOf(id: string): Answer };
    const roster: RosterInput = { kind: 'usable', at: NOW, entries: [{ id: 'a1', name: 'Explore', startedAt: NOW - 60_000 }] };
    await r.read({ roster, facts: [], proc: { kind: 'live', startedAt: NOW - 3_600_000 }, now: NOW });
    await r.read({ roster: listedNone, facts: factsOf(notice('a1', NOW - 1_000, 'the report')), proc: { kind: 'live', startedAt: NOW - 3_600_000 }, now: NOW });
    expect(r.reportOf('a1')).toEqual({ type: 'helper-report', id: 'a1', report: 'the report', cut: false });
    expect(r.reportOf('b2')).toEqual({ type: 'helper-report', id: 'b2', report: null, cut: false });
  });
});

const ID = 'claude-a-project-a';
const UUID = 'c'.repeat(36);
const WORKDIR = '/work/project-a';
const PID = 51516;

describe('the session stream answers a helper-report request', () => {
  it('a request for a drawn row is answered with its report; a request for any other id with report: null', async () => {
    const now = Date.now();
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'project-a', workdir: WORKDIR, uuid: UUID, started: '1' })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
    const sess = path.join(home, '.claude-a', 'sessions');
    mkdirSync(sess, { recursive: true });
    writeFileSync(path.join(sess, `${PID}.json`), JSON.stringify({ pid: PID, sessionId: UUID, cwd: WORKDIR, name: 'project-a', status: 'busy', statusUpdatedAt: now, version: '2.1.319', startedAt: now - 600_000 }));
    const tdir = path.join(home, '.claude-a', 'projects', '-work-project-a');
    mkdirSync(tdir, { recursive: true });
    const tfile = path.join(tdir, `${UUID}.jsonl`);
    writeFileSync(tfile, `${line({ type: 'user', uuid: 'u1', timestamp: iso(now - 60_000), message: { role: 'user', content: 'hi' } })}\n`);
    const S = path.join(tdir, UUID);
    mkdirSync(path.join(S, 'subagents'), { recursive: true });
    writeFileSync(path.join(S, 'subagents', 'agent-a2.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look at a2', model: 'model-a' }));
    writeFileSync(path.join(S, 'subagents', 'agent-a2.jsonl'), `${line({ type: 'user', timestamp: iso(now - 20_000), message: { role: 'user', content: 'x' } })}\n`);
    writeFileSync(path.join(reg, `${ID}.hookstate.json`), JSON.stringify({
      v: 1, state: 'working', event: 'SubagentStart', sessionId: UUID, pid: PID, updatedAt: now, ask: null,
      subagents: [{ id: 'a2', name: 'Explore', startedAt: now - 300_000 }], graphQueries: 0, graphGateDenials: 0,
    }));
    appendFileSync(tfile, `${notice('a2', now - 5_000, 'the whole report')}\n`);
    const cfg = loadConfig({ CCRC_HOME: home });
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${PID}\n`, stderr: '' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports };
    const frames: SessionStreamMsg[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m), undefined, NO_TICK) as SessionStream & { helperReport(id: string): void };
    try {
      await stream.start();
      expect(frames.filter((f) => f.type === 'workflows').at(-1)).toMatchObject({ agents: [{ id: 'a2', state: 'done', hasReport: true }] });
      stream.helperReport('a2');
      stream.helperReport('a9');
    } finally { stream.stop(); }
    const answers = frames.filter((f) => (f as { type: string }).type === 'helper-report');
    expect(answers).toEqual([
      { type: 'helper-report', id: 'a2', report: 'the whole report', cut: false },
      { type: 'helper-report', id: 'a9', report: null, cut: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The server's message parser (`server.ts#asSessionClientMsg`).

const parse = (raw: unknown): unknown => (server as unknown as { asSessionClientMsg(r: unknown): unknown }).asSessionClientMsg(raw);
/** The parser as main had it before H2 (an older server): `visible` only. A characterization copy, so this suite can say
 *  what an older server does with the new request. */
const olderParse = (raw: unknown): unknown => {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o['type'] !== 'visible' || typeof o['visible'] !== 'boolean') return null;
  return { type: 'visible', visible: o['visible'] };
};

describe('the session socket\'s message parser', () => {
  it('reads a helper-report request with an agent id', () => {
    expect(parse({ type: 'helper-report', id: 'a1b2' })).toEqual({ type: 'helper-report', id: 'a1b2' });
  });
  it('refuses an id that is not an agent id, or none', () => {
    for (const id of ['', 'a/b', '../x', 'x'.repeat(65), 7, null, undefined]) expect(parse({ type: 'helper-report', id }), String(id)).toBeNull();
  });
  it('still reads visible, and only visible with a boolean', () => {
    expect(parse({ type: 'visible', visible: true })).toEqual({ type: 'visible', visible: true });
    expect(parse({ type: 'visible', visible: 'yes' })).toBeNull();
  });
  it('an older server ignores the request: its parser answers null, and the request carries no `visible` to be mistaken for one (a characterization pin)', () => {
    const req = { type: 'helper-report', id: 'a1' };
    expect(olderParse(req)).toBeNull();
    expect('visible' in req).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The server's socket handler routes the request to the session stream (a real socket, `buildServer`).

describe('/ws/session/:id answers a helper-report request', () => {
  it('a request is answered on the same socket; a bad id is ignored and sets no visible claim', async () => {
    const { default: WebSocket } = await import('ws');
    const { Viewers } = await import('../src/viewer.js');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const run: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const viewers = new Viewers(() => Date.now());
    const deps: Deps = { cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue(), time: fakeTime().ports, viewers };
    const app = await server.buildServer(deps, new Bus());
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/session/${ID}`);
      const got: Array<{ type: string }> = [];
      ws.on('message', (raw) => { try { got.push(JSON.parse(String(raw)) as { type: string }); } catch { /* not JSON */ } });
      await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
      try {
        ws.send(JSON.stringify({ type: 'helper-report', id: '../etc' }));
        ws.send(JSON.stringify({ type: 'helper-report', id: 'a7' }));
        const end = Date.now() + 5_000;
        while (!got.some((m) => m.type === 'helper-report') && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
        expect(got.filter((m) => m.type === 'helper-report')).toEqual([{ type: 'helper-report', id: 'a7', report: null, cut: false }]);
        expect(viewers.isVisible(ID)).toBe(false);
      } finally {
        ws.close();
      }
    } finally {
      await app.close();
    }
  });
});
