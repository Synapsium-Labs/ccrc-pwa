// The restart manifest's program (session-continuity 6b, Task 2; D-8368..D-8373, D-8376) and `agent_end` (ccd/lib/transcript.jq).
//
// `ccd/lib/inflight-manifest.py` reads the launch record (`$REG/<id>.deleg`) and the session's sidecars and prints the items a
// restart must name: in-flight, holed, stopped-agent, diverged, deferred-until-reset, abandoned. It writes nothing; ccd compacts
// the record from its `row` lines (Task 3). These rows build sidecar trees in fixture directories (D-5561's shapes: journal lines
// `{type, key: 'v1:<64 hex>', agentId}`, summaries `{status}`, rate-limit rows, end_turn rows, mid-tool rows), run the program for
// real as `python3 -I`, and read its stdout. Every name here is neutral: lane-a, project-a, run ids of the measured shape.
//
// Mutation rows (the brief's MP-* table) each go red on a named case below; the case titles carry the words the table cites.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';

const REPO = path.resolve(__dirname, '../..');
const PROG = path.join(REPO, 'ccd', 'lib', 'inflight-manifest.py');
const JQ_LIB = path.join(REPO, 'ccd', 'lib');
const HOOK = path.join(REPO, 'ccd', 'session-hook.sh');
const progSrc = fs.readFileSync(PROG, 'utf8');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf8');

const SID = 'demo-quiet-basin';
const UUID = '6350faa0-a1be-4e78-939c-57485268f6fc';
const OTHER_UUID = '11111111-2222-4333-8444-555555555555';
const PDIR = '-p';
const RUN = 'wf_0123abcd-0ab';
const RUN2 = 'wf_0123abcd-0ac';
const RUN3 = 'wf_0123abcd-0ad';
const NOW = 1_800_000_000;
const DAY = 86_400;
const SENTINEL = 'SENTINEL-PROMPT-TEXT-7731';
const key = (n: number): string => `v1:${n.toString(16).padStart(64, '0')}`;

let home: string;
let reg: string;
let cfg: string;
const outputs: string[] = [];
beforeEach(() => {
  home = mkTmp('ccrc-manifest-');
  reg = path.join(home, '.cc-sessions');
  cfg = path.join(home, 'cfg');
  fs.mkdirSync(reg, { recursive: true });
  fs.mkdirSync(path.join(cfg, 'projects'), { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const side = (pdir = PDIR): string => path.join(cfg, 'projects', pdir, UUID);
const put = (p: string, body: string, mtime = NOW - 60): string => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  fs.utimesSync(p, mtime, mtime);
  return p;
};
const jl = (xs: unknown[]): string => xs.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') + '\n';

// ── transcript rows ──
const RATE = (resetsAt?: number): object => ({ type: 'assistant', isApiErrorMessage: true, error: 'rate_limit', ...(resetsAt === undefined ? {} : { quotaLimits: { resetsAt, rateLimitType: 'five_hour' } }) });
const FIN = { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: SENTINEL }] } };
const TOOLUSE = { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash', input: { command: SENTINEL } }] } };
const TOOLRES = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: SENTINEL }] } };
const CHATTER = { type: 'user', message: { content: '<local-command-stdout>x</local-command-stdout>' } };

// ── rows of the launch record ──
const T = (NOW - 100) * 1000;
const wfRow = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ v: 1, t: T, k: 'workflow', w: 'lane-a', uuid: UUID, run: RUN, task: 't1', script: `/old/root/projects/${PDIR}/${UUID}/workflows/scripts/x-${RUN}.js`, ...over });
const resumeRow = (over: Record<string, unknown> = {}): Record<string, unknown> => wfRow({ k: 'resume', task: 't2', ...over });
const agentRow = (agent: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ v: 1, t: T, k: 'agent', w: 'lane-a', uuid: UUID, agent, ...over });
const sendRow = (agent: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ v: 1, t: T + 1000, k: 'send', w: 'lane-a', uuid: UUID, agent, ...over });
const dropRow = (why: string): Record<string, unknown> => ({ v: 1, t: T, k: 'drop', why });
const plantRecord = (rows: unknown[]): void => { fs.writeFileSync(path.join(reg, `${SID}.deleg`), jl(rows)); };

// ── sidecar builders ──
const script = (run: string, pdir = PDIR): string => put(path.join(side(pdir), 'workflows', 'scripts', `x-${run}.js`), `// ${SENTINEL}\n`);
type RunOpts = { journal?: unknown[]; jm?: number; summary?: string | object | null; sm?: number; agents?: Record<string, { lines?: string; mtime?: number; meta?: number }>; pdir?: string };
/** A run directory: its journal, an optional summary, and its agents (a transcript and a meta file each). */
const mkRun = (run: string, o: RunOpts = {}): void => {
  const d = side(o.pdir);
  put(path.join(d, 'subagents', 'workflows', run, 'journal.jsonl'), jl(o.journal ?? [{ type: 'launched', label: SENTINEL }]), o.jm ?? NOW - 60);
  if (o.summary !== undefined && o.summary !== null) {
    put(path.join(d, 'workflows', `${run}.json`), typeof o.summary === 'string' ? o.summary : JSON.stringify(o.summary), o.sm ?? NOW - 30);
  }
  for (const [id, a] of Object.entries(o.agents ?? {})) {
    put(path.join(d, 'subagents', 'workflows', run, `agent-${id}.jsonl`), a.lines ?? '', a.mtime ?? NOW - 60);
    put(path.join(d, 'subagents', 'workflows', run, `agent-${id}.meta.json`), `{"description":"${SENTINEL}"}`, a.meta ?? NOW - 3000);
  }
};
const mkAgent = (id: string, lines: string, mtime = NOW - 60, pdir = PDIR): void => { put(path.join(side(pdir), 'subagents', `agent-${id}.jsonl`), lines, mtime); };

// ── the program ──
type Over = Partial<{ now: number; budget: number; maxBytes: number; tail: number; recent: number; abandon: number; reset: string; log: string; logFrom: string; recordMax: number; site: string; id: string }>;
type Got = { rc: number | null; out: string; err: string; timedOut: boolean; summary: Record<string, string>; items: Array<Record<string, string>>; rows: any[] };
const run = (o: Over = {}, timeout = 60_000): Got => {
  const args = [reg, o.id ?? SID, cfg, UUID, o.site ?? 'swap', String(o.now ?? NOW), String(o.budget ?? 64 * 2 ** 20), String(o.maxBytes ?? 16384), String(o.tail ?? 65536),
    String(o.recent ?? 3600), String(o.abandon ?? 7 * DAY), o.reset ?? '-', JQ_LIB, o.log ?? '-', o.logFrom ?? '-', String(o.recordMax ?? 1048576 + 4096)];
  const r = spawnSyncGroup('python3', ['-I', PROG, ...args], { encoding: 'utf8', timeout });
  const out = String(r.stdout ?? '');
  outputs.push(out);
  const lines = out.split('\n').filter(Boolean);
  const kv = (s: string): Record<string, string> => Object.fromEntries(s.split(' ').slice(1).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
  const sl = lines.find((l) => l.startsWith('summary '));
  return {
    rc: r.status, out, err: String(r.stderr ?? ''), timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
    summary: sl === undefined ? {} : kv(sl), items: lines.filter((l) => l.startsWith('item ')).map(kv),
    rows: lines.filter((l) => l.startsWith('row ')).map((l) => JSON.parse(l.slice(4))),
  };
};
const n = (g: Got, k: string): number => Number(g.summary[k]);
/** Write the program's kept rows back as the record, as ccd will. */
const compact = (g: Got): void => { plantRecord(g.rows); };
const classes = (g: Got): string[] => g.items.map((i) => `${i['kind']}:${i['run'] !== '-' ? i['run'] : i['agent']}=${i['class']}`);

describe('the manifest program: workflow items', () => {
  it('an in-flight run: a launch row and a journal with no summary is one in-flight item with its script re-rooted at the current root', () => {
    plantRecord([wfRow()]);
    mkRun(RUN);
    script(RUN);
    const g = run();
    expect(g.rc).toBe(0);
    expect(g.out.split('\n').filter((l) => l.startsWith('item '))).toEqual([
      `item class=in-flight kind=workflow run=${RUN} task=t1 agent=- script=${side()}/workflows/scripts/x-${RUN}.js attempts=0 since=${NOW - 60} reset=- longer=- src=record`,
    ]);
    expect(g.summary['verdict']).toBe('listed');
    expect(g.summary['items']).toBe('1');
    expect(g.rows).toHaveLength(1);
  });

  it('a killed summary reads in flight and counts in killed; a non-final or unparseable summary reads in flight; a completed one retires the run and its rows; a failed one retires too', () => {
    const cases: Array<[string, string, string]> = [[RUN, 'killed', JSON.stringify({ status: 'killed' })], [RUN2, 'running', JSON.stringify({ status: 'running' })], [RUN3, 'garbage', '{not json']];
    plantRecord([...cases.map(([r]) => wfRow({ run: r })), wfRow({ run: 'wf_aaaaaaaa-001' }), wfRow({ run: 'wf_aaaaaaaa-002' })]);
    for (const [r, , body] of cases) mkRun(r, { summary: body });
    mkRun('wf_aaaaaaaa-001', { summary: { status: 'completed' } });
    mkRun('wf_aaaaaaaa-002', { summary: { status: 'failed' } });
    const g = run();
    expect(classes(g).sort()).toEqual([RUN, RUN2, RUN3].sort().map((r) => `workflow:${r}=in-flight`));
    expect(n(g, 'killed')).toBe(1);
    expect(n(g, 'in-flight')).toBe(3);
    expect(n(g, 'retired'), 'the completed and the failed run retire their rows').toBe(2);
    expect(g.rows.map((r) => r.run).sort()).toEqual([RUN, RUN2, RUN3].sort());
  });

  it('a journal newer than its summary (resumed in place) reads in flight', () => {
    plantRecord([wfRow()]);
    mkRun(RUN, { summary: { status: 'completed' }, sm: NOW - 500, jm: NOW - 100 });
    expect(classes(run())).toEqual([`workflow:${RUN}=in-flight`]);
    mkRun(RUN, { summary: { status: 'completed' }, sm: NOW - 100, jm: NOW - 100 });
    expect(run().items, 'a journal no newer than the summary is finished').toEqual([]);
  });

  it('holed: a completed run whose latest attempt for a key ends on a rate-limit row; a key whose limited attempt was retried under a new agent id does not hole it', () => {
    plantRecord([wfRow(), wfRow({ run: RUN2, task: 't2' })]);
    mkRun(RUN, {
      summary: { status: 'completed' }, journal: [{ type: 'started', key: key(1), agentId: 'a1' }, { type: 'failed', key: key(1), agentId: 'a1' }],
      agents: { a1: { lines: jl([RATE(1790000000)]) } },
    });
    mkRun(RUN2, {
      summary: { status: 'completed' },
      journal: [{ type: 'started', key: key(1), agentId: 'b1' }, { type: 'started', key: key(1), agentId: 'b2' }, { type: 'result', key: key(1), agentId: 'b2' }],
      agents: { b1: { lines: jl([RATE()]) }, b2: { lines: jl([FIN]) } },
    });
    const g = run();
    expect(classes(g)).toEqual([`workflow:${RUN}=holed`]);
    expect(n(g, 'holed')).toBe(1);
    expect(n(g, 'retired'), 'the retried run retires its row').toBe(1);
  });

  it('deferred-until-reset: a resume row, then an agent whose meta is newer than it ends on the limit: attempts=1 reset=<the row\'s resetsAt>; with no resetsAt on the row, reset=<reset>; an agent older than the resume does not count; resumed counts it', () => {
    const resumeAt = NOW - 2000;
    const rows = (run_: string): unknown[] => [wfRow({ run: run_, t: (NOW - 5000) * 1000 }), resumeRow({ run: run_, t: resumeAt * 1000 })];
    plantRecord([...rows(RUN), ...rows(RUN2), ...rows(RUN3)]);
    const journal = [{ type: 'started', key: key(1), agentId: 'x1' }, { type: 'failed', key: key(1), agentId: 'x1' }];
    mkRun(RUN, { journal, agents: { x1: { lines: jl([RATE(1800003600)]), meta: resumeAt + 50 } } });
    mkRun(RUN2, { journal, agents: { x1: { lines: jl([RATE()]), meta: resumeAt + 50 } } });
    mkRun(RUN3, { journal, agents: { x1: { lines: jl([RATE(1800003600)]), meta: resumeAt - 50 } } });
    const g = run({ reset: '1800009999' });
    const by = Object.fromEntries(g.items.map((i) => [i['run'], i]));
    expect(by[RUN]).toMatchObject({ class: 'deferred-until-reset', attempts: '1', reset: '1800003600' });
    expect(by[RUN2]).toMatchObject({ class: 'deferred-until-reset', attempts: '1', reset: '1800009999' });
    expect(by[RUN3], 'an agent older than the resume does not count').toMatchObject({ class: 'in-flight', attempts: '1', reset: '-' });
    expect(n(g, 'resumed')).toBe(3);
    expect(run({}).items.find((i) => i['run'] === RUN2)?.['reset'], 'with no reset argument it is -').toBe('-');
  });

  it('abandoned: an item whose last activity is older than abandon-s is listed once, and its rows are gone from the kept rows', () => {
    plantRecord([wfRow({ t: (NOW - 10 * DAY) * 1000 })]);
    mkRun(RUN, { jm: NOW - 9 * DAY });
    const g = run();
    expect(classes(g)).toEqual([`workflow:${RUN}=abandoned`]);
    expect(g.rows).toEqual([]);
    expect(n(g, 'retired')).toBe(1);
    compact(g);
    expect(run().summary['verdict'], 'reported once').toBe('none');
  });

  it('not abandoned across a weekly wait: a run launched nine days ago whose journal last changed six and a half days ago, at a limit-resume, is in-flight', () => {
    plantRecord([wfRow({ t: (NOW - 9 * DAY) * 1000 })]);
    mkRun(RUN, { jm: NOW - Math.floor(6.5 * DAY) });
    expect(classes(run({ site: 'limit-resume' }))).toEqual([`workflow:${RUN}=in-flight`]);
  });

  it('diverged: a diverged line after log-from that names the run\'s journal; one before log-from is not read', () => {
    plantRecord([wfRow(), wfRow({ run: RUN2 })]);
    mkRun(RUN);
    mkRun(RUN2);
    const log = path.join(reg, 'swap.log');
    const l1 = `2026-11-12 10:00:00 sidecar ${UUID} diverged ${side()}/subagents/workflows/${RUN}/journal.jsonl longer /other/cfg/projects/${PDIR}/${UUID}/subagents/workflows/${RUN}/journal.jsonl\n`;
    const l2 = `2026-11-12 10:05:00 sidecar ${UUID} diverged ${side()}/workflows/${RUN2}.json longer /with space/x\n`;
    fs.writeFileSync(log, l1);
    const from = fs.statSync(log).size;
    fs.appendFileSync(log, l2);
    fs.appendFileSync(log, `2026-11-12 10:06:00 sidecar ${OTHER_UUID} diverged ${side()}/subagents/workflows/${RUN}/journal.jsonl longer /x\n`);
    const g = run({ log, logFrom: String(from) });
    expect(g.items.map((i) => [i['run'], i['class'], i['longer']])).toEqual([[RUN, 'in-flight', '-'], [RUN2, 'diverged', '-']].sort());
    const g0 = run({ log, logFrom: '0' });
    expect(g0.items.find((i) => i['run'] === RUN)).toMatchObject({ class: 'diverged', longer: `/other/cfg/projects/${PDIR}/${UUID}/subagents/workflows/${RUN}/journal.jsonl` });
  });

  it('the swap log is read from log-from on: a log far larger than the process may map, below log-from, still answers rc 0 and reads the diverged line in the tail', () => {
    plantRecord([wfRow()]);
    mkRun(RUN);
    const log = path.join(reg, 'swap.log');
    const HEAD = 4 * 2 ** 30;                       // a sparse head, never written: 4 GiB of nothing
    const fd = fs.openSync(log, 'w');
    fs.ftruncateSync(fd, HEAD);
    fs.writeSync(fd, `2026-11-12 10:05:00 sidecar ${UUID} diverged ${side()}/subagents/workflows/${RUN}/journal.jsonl longer /x/y\n`, HEAD);
    fs.closeSync(fd);
    // A 1 GiB address-space limit: a reader that takes the head into memory dies of it.
    const args = [reg, SID, cfg, UUID, 'swap', String(NOW), String(2 ** 20), '16384', '65536', '3600', String(7 * DAY), '-', JQ_LIB, log, String(HEAD), String(1048576 + 4096)];
    const r = spawnSyncGroup('bash', ['-c', 'ulimit -v 1048576; exec python3 -I "$@"', 'x', PROG, ...args], { encoding: 'utf8', timeout: 60_000 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^item class=diverged kind=workflow run=wf_0123abcd-0ab /m);
  });

  it('a sidecar-only run changed within recent-s is listed with src=sidecar; an older one is not', () => {
    mkRun(RUN, { jm: NOW - 100 });
    script(RUN);
    mkRun(RUN2, { jm: NOW - 7200 });
    const g = run();
    expect(g.items).toHaveLength(1);
    expect(g.items[0]).toMatchObject({ run: RUN, src: 'sidecar', class: 'in-flight', script: `${side()}/workflows/scripts/x-${RUN}.js`, attempts: '0', since: String(NOW - 100) });
    expect(g.rows).toEqual([]);
    expect(run({ recent: 100000 }).items).toHaveLength(2);
  });
});

describe('the manifest program: agent items', () => {
  const lines = (...xs: unknown[]): string => jl(xs);
  it('stopped-agent: an agent ending on a rate-limit row, one ending on a tool result, and one whose newest row is an assistant tool_use with no result after it; one ending on an end_turn retires', () => {
    plantRecord([agentRow('a1'), agentRow('a2'), agentRow('a3'), agentRow('a4')]);
    mkAgent('a1', lines(FIN, RATE()));
    mkAgent('a2', lines(TOOLUSE, TOOLRES));
    mkAgent('a3', lines(FIN, TOOLUSE));
    mkAgent('a4', lines(TOOLUSE, TOOLRES, FIN));
    const g = run();
    expect(classes(g).sort()).toEqual(['agent:a1=stopped-agent', 'agent:a2=stopped-agent', 'agent:a3=stopped-agent']);
    expect(n(g, 'retired')).toBe(1);
    expect(g.rows.map((r) => r.agent).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('a torn last line reads open: after a rate-limit row, after a tool result and after an end_turn, the agent is stopped-agent, never retired', () => {
    plantRecord([agentRow('a1'), agentRow('a2'), agentRow('a3')]);
    const torn = '{"type":"assistant","message":{"stop_re';
    mkAgent('a1', lines(RATE()) + torn);
    mkAgent('a2', lines(TOOLRES) + torn);
    mkAgent('a3', lines(FIN) + torn);
    const g = run();
    expect(classes(g).sort()).toEqual(['agent:a1=stopped-agent', 'agent:a2=stopped-agent', 'agent:a3=stopped-agent']);
    expect(n(g, 'retired')).toBe(0);
  });

  it('a window read from mid-file drops its cut first line: with only chatter after it, agent_end answers none', () => {
    plantRecord([agentRow('a1')]);
    const first = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn' }, pad: 'p'.repeat(400) });
    mkAgent('a1', `${first}\n${lines(CHATTER, CHATTER)}`);
    const g = run({ tail: 250 });
    expect(g.items, 'none is unread, never an item').toEqual([]);
    expect(n(g, 'unread')).toBe(1);
    expect(g.summary['verdict']).toBe('unread');
  });

  it('deferred-until-reset for an agent: a send after its launch and a transcript on a rate-limit row, with its row\'s reset', () => {
    plantRecord([agentRow('a1'), sendRow('a1'), agentRow('a2')]);
    mkAgent('a1', lines(RATE(1800003600)));
    mkAgent('a2', lines(RATE(1800003600)));
    const g = run();
    expect(g.items.map((i) => [i['agent'], i['class'], i['attempts'], i['reset']]).sort()).toEqual([['a1', 'deferred-until-reset', '1', '1800003600'], ['a2', 'stopped-agent', '0', '-']]);
    expect(n(g, 'resumed')).toBe(1);
  });
});

describe('the manifest program: the record, validation at read, compaction', () => {
  it('validation at read: a malformed line and a bad id each add one to drop-read, a script symlinked out of the sidecar adds one to drop-readpath; the item stays, with script=-, and a second write over the kept rows counts none of them again', () => {
    fs.writeFileSync(path.join(reg, `${SID}.deleg`), `${JSON.stringify(wfRow())}\nnot json at all\n${JSON.stringify(wfRow({ run: 'bad id', task: 't9' }))}\n`);
    mkRun(RUN);
    // `workflows/scripts` is a link to a directory outside the sidecar: the file's own lstat is regular, only the realpath check sees it.
    const outside = path.join(home, 'outside');
    put(path.join(outside, `x-${RUN}.js`), '// x');
    fs.mkdirSync(path.join(side(), 'workflows'), { recursive: true });
    fs.symlinkSync(outside, path.join(side(), 'workflows', 'scripts'));
    const g = run();
    expect(g.rc).toBe(0);
    expect(n(g, 'drop-read')).toBe(2);
    expect(n(g, 'drop-readpath')).toBe(1);
    expect(g.items).toHaveLength(1);
    expect(g.items[0]).toMatchObject({ run: RUN, script: '-' });
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0].script, 'the kept row is rewritten').toBeNull();
    compact(g);
    const g2 = run();
    expect([n(g2, 'drop-read'), n(g2, 'drop-readpath'), n(g2, 'items')]).toEqual([0, 0, 1]);
  });

  it('a record longer than record-max is read to record-max: the overflow counts once in drop-budget, not drop-read, and is not kept', () => {
    const rowsIn = [RUN, RUN2, RUN3].map((r) => wfRow({ run: r }));
    plantRecord(rowsIn);
    for (const r of [RUN, RUN2, RUN3]) mkRun(r, { jm: NOW - 7200 });
    const two = rowsIn.slice(0, 2).map((r) => JSON.stringify(r) + '\n').join('').length;
    const g = run({ recordMax: two + 20 });
    expect(g.rc).toBe(0);
    expect(n(g, 'drop-budget')).toBe(1);
    expect(n(g, 'drop-read')).toBe(0);
    expect(n(g, 'items')).toBe(2);
    expect(g.rows.map((r) => r.run)).toEqual([RUN, RUN2]);
    expect(run({ recordMax: fs.statSync(path.join(reg, `${SID}.deleg`)).size }).summary['drop-budget'], 'a record exactly at record-max is no overflow').toBe('0');
    expect(run().summary['drop-budget']).toBe('0');
  });

  it('a script path is re-rooted at its last /projects/: a config root under a directory named projects re-roots right; a tail that is not <pdir>/<uuid>/workflows/scripts/<name> is script=-', () => {
    // The configured root itself lies under a directory named `projects`.
    const nested = path.join(home, 'projects', 'cfgroot');
    fs.mkdirSync(path.join(nested, 'projects'), { recursive: true });
    cfg = nested;
    plantRecord([wfRow({ script: `/old/projects/cfg/projects/${PDIR}/${UUID}/workflows/scripts/x-${RUN}.js` }), wfRow({ run: RUN2, script: `/old/projects/${PDIR}/${UUID}/workflows/x-${RUN2}.js` })]);
    mkRun(RUN);
    mkRun(RUN2);
    script(RUN);
    const g = run();
    expect(g.items.find((i) => i['run'] === RUN)?.['script']).toBe(`${nested}/projects/${PDIR}/${UUID}/workflows/scripts/x-${RUN}.js`);
    expect(g.items.find((i) => i['run'] === RUN2)?.['script']).toBe('-');
    expect(n(g, 'drop-readpath')).toBe(1);
  });

  it('a row whose uuid fails isid counts in drop-read, not retired', () => {
    plantRecord([wfRow({ uuid: 'bad uuid' }), wfRow({ uuid: 'x'.repeat(65), run: RUN2 })]);
    const g = run();
    expect([n(g, 'drop-read'), n(g, 'retired')]).toEqual([2, 0]);
  });

  it('other-uuid rows and unjoined sends are removed and counted in retired; drop rows are summed by why into drop-id, drop-path, drop-budget and drop-shape', () => {
    plantRecord([wfRow({ uuid: OTHER_UUID }), sendRow('nobody'), agentRow('a1'), sendRow('a1'), dropRow('id'), dropRow('path'), dropRow('path'), dropRow('budget'), dropRow('shape'), dropRow('zzz')]);
    mkAgent('a1', jl([RATE()]));
    const g = run();
    expect(n(g, 'retired')).toBe(2);
    expect([n(g, 'drop-id'), n(g, 'drop-path'), n(g, 'drop-budget'), n(g, 'drop-shape'), n(g, 'drop-read')]).toEqual([1, 2, 1, 1, 1]);
    expect(g.rows.map((r) => r.k)).toEqual(['agent', 'send']);
    expect(g.items).toHaveLength(1);
    expect(g.items[0]).toMatchObject({ agent: 'a1', attempts: '1' });
  });

  it('a FIFO at the record is rc 4 "record fifo"; a FIFO at a journal or an agent transcript makes that item unread; neither blocks', () => {
    execFileSync('mkfifo', [path.join(reg, `${SID}.deleg`)]);
    const g = run({}, 20_000);
    expect(g.timedOut).toBe(false);
    expect([g.rc, g.out.trim()]).toEqual([4, 'record fifo']);
    fs.rmSync(path.join(reg, `${SID}.deleg`));
    plantRecord([wfRow(), agentRow('a1')]);
    fs.mkdirSync(path.join(side(), 'subagents', 'workflows', RUN), { recursive: true });
    execFileSync('mkfifo', [path.join(side(), 'subagents', 'workflows', RUN, 'journal.jsonl')]);
    execFileSync('mkfifo', [path.join(side(), 'subagents', `agent-a1.jsonl`)]);
    const g2 = run({}, 20_000);
    expect(g2.timedOut).toBe(false);
    expect(g2.rc).toBe(0);
    expect([n(g2, 'unread'), n(g2, 'items')]).toEqual([2, 0]);
    expect(g2.summary['verdict']).toBe('unread');
    expect(g2.rows).toHaveLength(2);
  });

  it('over the scan budget: rc 3, "budget <n>", and no summary line', () => {
    plantRecord([wfRow()]);
    mkRun(RUN, { journal: Array.from({ length: 40 }, (_, i) => ({ type: 'started', key: key(i), agentId: `a${i}` })) });
    const need = fs.statSync(path.join(reg, `${SID}.deleg`)).size + fs.statSync(path.join(side(), 'subagents', 'workflows', RUN, 'journal.jsonl')).size;
    const g = run({ budget: need - 1 });
    expect(g.rc).toBe(3);
    expect(g.out).toBe(`budget ${need}\n`);
    expect(run({ budget: need }).rc, 'at the budget exactly it runs').toBe(0);
  });

  it('the item budget: items past max-bytes are counted in drop-over, no line is cut, and their rows are kept', () => {
    plantRecord([RUN, RUN2, RUN3].map((r) => wfRow({ run: r })));
    for (const r of [RUN, RUN2, RUN3]) mkRun(r);
    const one = run();
    const len = one.out.split('\n').find((l) => l.startsWith('item '))!.length + 1;
    const g = run({ maxBytes: len + 5 });
    expect(g.items).toHaveLength(1);
    expect(n(g, 'drop-over')).toBe(2);
    expect(n(g, 'items'), 'items counts every one found').toBe(3);
    expect(g.rows).toHaveLength(3);
    for (const l of g.out.split('\n').filter((x) => x.startsWith('item '))) expect(l).toMatch(/ src=record$/);
  });

  it('unread: a launch row whose run directory is absent is not listed and is counted; its rows are kept; with no other item the verdict is unread, never none', () => {
    plantRecord([wfRow()]);
    const g = run();
    expect(g.items).toEqual([]);
    expect([n(g, 'unread'), n(g, 'items'), g.summary['verdict']]).toEqual([1, 0, 'unread']);
    expect(g.rows).toHaveLength(1);
  });

  it('unread is decided before any class: a workflow item with no journal and a launch nine days old is unread, never in-flight or abandoned', () => {
    plantRecord([wfRow({ t: (NOW - 9 * DAY) * 1000 })]);
    const g = run({ abandon: 14 * DAY });
    expect([n(g, 'unread'), n(g, 'in-flight'), n(g, 'abandoned'), g.summary['verdict']]).toEqual([1, 0, 0, 'unread']);
    const g2 = run();
    expect([n(g2, 'abandoned'), n(g2, 'in-flight'), n(g2, 'unread-expired')], 'past abandon-s it expires, it is never abandoned').toEqual([0, 0, 1]);
  });

  it('an unread item past abandon-s retires into unread-expired, is never listed as abandoned, and its rows go; the next write is none', () => {
    plantRecord([wfRow({ t: (NOW - 9 * DAY) * 1000 }), agentRow('a1', { t: (NOW - 9 * DAY) * 1000 })]);
    const g = run();
    expect([n(g, 'unread-expired'), n(g, 'unread'), n(g, 'items'), g.summary['verdict']]).toEqual([2, 0, 0, 'none']);
    expect(g.rows).toEqual([]);
    compact(g);
    expect(run().summary['verdict']).toBe('none');
  });

  it('unread: a sidecar-only run whose journal is a FIFO, or whose summary is a directory, counts in unread and the verdict reads unread, never none; it leaves once its journal is older than recent-s', () => {
    const runDir = path.join(side(), 'subagents', 'workflows', RUN);
    fs.mkdirSync(runDir, { recursive: true });
    execFileSync('mkfifo', [path.join(runDir, 'journal.jsonl')]);
    fs.utimesSync(path.join(runDir, 'journal.jsonl'), NOW - 100, NOW - 100);
    const g = run({}, 20_000);
    expect(g.timedOut).toBe(false);
    expect([n(g, 'unread'), n(g, 'items'), g.summary['verdict']]).toEqual([1, 0, 'unread']);
    expect(g.rows).toEqual([]);
    expect(run({ recent: 50 }).summary['verdict'], 'a FIFO journal older than recent-s leaves on its own').toBe('none');
    fs.rmSync(runDir, { recursive: true });
    mkRun(RUN2, { jm: NOW - 100 });
    fs.mkdirSync(path.join(side(), 'workflows', `${RUN2}.json`), { recursive: true });
    const g2 = run();
    expect([n(g2, 'unread'), n(g2, 'items'), g2.summary['verdict']]).toEqual([1, 0, 'unread']);
  });

  it.skipIf(process.getuid?.() === 0)('unread: a run directory that cannot be listed is unread before any class, so a holed run is never retired and its rows are kept; an unlistable subagents/workflows base counts one unread', () => {
    plantRecord([wfRow()]);
    mkRun(RUN, { summary: { status: 'completed' }, journal: [{ type: 'started', key: key(1), agentId: 'a1' }, { type: 'failed', key: key(1), agentId: 'a1' }], agents: { a1: { lines: jl([RATE(1790000000)]) } } });
    const runDir = path.join(side(), 'subagents', 'workflows', RUN);
    expect(classes(run())).toEqual([`workflow:${RUN}=holed`]);
    fs.chmodSync(runDir, 0o300);
    try {
      const g = run();
      expect([n(g, 'unread'), n(g, 'items'), n(g, 'retired'), g.summary['verdict']]).toEqual([1, 0, 0, 'unread']);
      expect(g.rows).toHaveLength(1);
    } finally { fs.chmodSync(runDir, 0o700); }
    fs.rmSync(path.join(reg, `${SID}.deleg`));
    const base = path.join(side(), 'subagents', 'workflows');
    fs.chmodSync(base, 0o300);
    try {
      const g = run();
      expect([n(g, 'unread'), g.summary['verdict']]).toEqual([1, 'unread']);
    } finally { fs.chmodSync(base, 0o700); }
  });

  it('a deeply nested JSON line (a record line, a journal line, a summary) is an invalid line or an unparseable one, never a traceback', () => {
    const deep = '['.repeat(200_000);
    fs.writeFileSync(path.join(reg, `${SID}.deleg`), `${deep}\n${JSON.stringify(wfRow())}\n`);
    mkRun(RUN, { journal: [deep, { type: 'started', key: key(1), agentId: 'a1' }], summary: deep });
    const g = run();
    expect(g.rc, g.err).toBe(0);
    expect(g.err).toBe('');
    expect([n(g, 'drop-read'), n(g, 'in-flight')]).toEqual([1, 1]);
  });

  it('none: an empty record and no recent sidecar run', () => {
    fs.writeFileSync(path.join(reg, `${SID}.deleg`), '');
    const g = run();
    expect(g.out.split('\n')[0]).toBe('summary verdict=none items=0 in-flight=0 holed=0 stopped-agent=0 diverged=0 deferred-until-reset=0 abandoned=0 unread=0 unread-expired=0 killed=0 resumed=0 drop-id=0 drop-path=0 drop-budget=0 drop-shape=0 drop-read=0 drop-readpath=0 drop-over=0 retired=0');
    fs.rmSync(path.join(reg, `${SID}.deleg`));
    expect(run().summary['verdict'], 'no record at all').toBe('none');
  });

  it('malformed arguments are rc 2, and so is a site outside MANIFEST_SITES', () => {
    for (const o of [{ site: 'elsewhere' }, { id: 'bad id' }]) expect(run(o).rc, JSON.stringify(o)).toBe(2);
    expect(run({ reset: 'tomorrow' }).rc).toBe(2);
    const r = spawnSyncGroup('python3', ['-I', PROG, reg], { encoding: 'utf8', timeout: 20_000 });
    expect(r.status).toBe(2);
  });
});

describe('the launch record round trip: every row the hook writes reads clean', () => {
  const OWNER = SID;
  const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
  const CONFIGDIR = '/rig/cfg/projects/-rig-repo';
  const hsrc = fs.readFileSync(HOOK, 'utf8');
  const constant = (name: string): number => Number(hsrc.match(new RegExp(`${name}=(\\d+)`))![1]);
  const MAX = constant('LRC_MAX_BYTES');
  const RESERVE = constant('LRC_DROP_RESERVE');
  const hook = (payload: object): void => {
    fs.writeFileSync(path.join(reg, `${OWNER}.generation`), GENERATION);
    fs.writeFileSync(path.join(reg, `${OWNER}.wrapper`), 'lane-a');
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\ntrap '' TERM\necho "cc-${OWNER}"\nprintf '%s\\n' answered >> '${home}/tmux-answered'\n`, { mode: 0o755 });
    const e: NodeJS.ProcessEnv = { ...process.env };
    delete e['OSTYPE'];
    const env = { ...e, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`, TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, CLAUDE_CODE_EXECPATH: '' };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = fs.existsSync(`${home}/tmux-answered`) ? fs.readFileSync(`${home}/tmux-answered`, 'utf8').length : 0;
      const r = spawnSyncGroup('bash', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 120_000 });
      expect(r.status).toBe(0);
      const after = fs.existsSync(`${home}/tmux-answered`) ? fs.readFileSync(`${home}/tmux-answered`, 'utf8').length : 0;
      if (after > before) return;
    }
  };
  const post = (tool: string, input: Record<string, unknown>, resp: unknown): object =>
    ({ session_id: UUID, transcript_path: `${CONFIGDIR}/${UUID}.jsonl`, cwd: '/rig/repo', hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: resp, tool_use_id: 'toolu_01AAAA' });
  const wfResp = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    status: 'async_launched', taskId: 't1', runId: RUN, taskType: 'local_workflow', workflowName: 'demo', transcriptDir: `${CONFIGDIR}/${UUID}/workflows/${RUN}`,
    scriptPath: `${CONFIGDIR}/${UUID}/workflows/scripts/x-${RUN}.js`, ...over });

  it('every row the hook writes reads clean: drop-read 0', () => {
    hook(post('Workflow', { script: 'return 1' }, wfResp()));
    hook(post('Workflow', { resumeFromRunId: RUN, script: 'return 1' }, wfResp({ taskId: 't2' })));
    hook(post('Agent', { prompt: 'p' }, { status: 'async_launched', isAsync: true, agentId: 'aef14f3b6908dc0a9' }));
    hook(post('SendMessage', { to: 'aef14f3b6908dc0a9', message: 'm' }, { success: true }));
    hook(post('Workflow', { script: 'x' }, wfResp({ scriptPath: '/elsewhere/x.js', runId: RUN2 })));            // a path failure: two lines
    hook(post('Workflow', { script: 'x' }, wfResp({ runId: 'bad id' })));                                          // a bad id
    hook(post('Workflow', { resumeFromRunId: RUN }, wfResp({ status: 'completed' })));                             // a shape drop
    const rec = path.join(reg, `${OWNER}.deleg`);
    expect(fs.readFileSync(rec, 'utf8').split('\n').filter(Boolean).length, 'the hook wrote 8 lines').toBe(8);
    const g = run({ recordMax: MAX + RESERVE, now: Math.floor(Date.now() / 1000) });
    expect(g.rc).toBe(0);
    expect([n(g, 'drop-id'), n(g, 'drop-path'), n(g, 'drop-budget'), n(g, 'drop-shape'), n(g, 'drop-read')]).toEqual([1, 1, 0, 1, 0]);
    expect(n(g, 'unread'), 'the two runs and the agent have no sidecar here').toBe(3);
    // A budget drop: a record planted near LRC_MAX_BYTES (valid rows of another uuid), then one more launch.
    const filler = (i: number): string => JSON.stringify({ v: 1, t: 1, k: 'send', w: null, uuid: OTHER_UUID, agent: `f${i}`.padEnd(64, 'x') }) + '\n';
    let body = '';
    for (let i = 0; Buffer.byteLength(body) + Buffer.byteLength(filler(i)) <= MAX - 100; i += 1) body += filler(i);
    fs.writeFileSync(rec, body);
    const planted = (body.match(/\n/g) ?? []).length;
    hook(post('Workflow', { script: 'return 1' }, wfResp({ runId: RUN3 })));
    expect(fs.statSync(rec).size, 'a drop row, no launch row').toBeGreaterThan(Buffer.byteLength(body));
    const g2 = run({ recordMax: MAX + RESERVE, now: Math.floor(Date.now() / 1000) });
    expect([n(g2, 'drop-budget'), n(g2, 'drop-read'), n(g2, 'retired'), n(g2, 'unread')]).toEqual([1, 0, planted, 0]);
  });
});

describe('agent_end (ccd/lib/transcript.jq)', () => {
  const jq = (input: string, prog: string): string => spawnSyncGroup('jq', ['-R', '-s', '-r', '-L', JQ_LIB, `include "transcript"; ${prog}`], { input, encoding: 'utf8', timeout: 30_000 }).stdout.trim();
  const end = (input: string): string => jq(input, 'agent_end');
  it('agent_end: rate-limit (with and without its resetsAt), finished, open and none; a tool_use row is open; a torn final line is open; a chatter user row after a rate-limit row is stepped over; a user row with isApiErrorMessage and rate_limit is not a rate-limit row, for agent_end and limit_banner alike', () => {
    expect(end(jl([FIN, RATE(1790000000)]))).toBe('rate-limit 1790000000');
    expect(end(jl([FIN, RATE()]))).toBe('rate-limit');
    expect(end(jl([RATE(1.5 as unknown as number)]))).toBe('rate-limit');
    expect(end(jl([TOOLUSE, TOOLRES, FIN]))).toBe('finished');
    expect(end(jl([FIN, TOOLRES]))).toBe('open');
    expect(end(jl([FIN, TOOLUSE])), 'a tool_use row is not finished').toBe('open');
    expect(end(jl([FIN, { type: 'assistant', isApiErrorMessage: true, error: 'overloaded' }]))).toBe('open');
    expect(end(jl([{ type: 'assistant', message: { stop_reason: 'max_tokens' } }]))).toBe('open');
    expect(end(jl([{ type: 'assistant', isApiErrorMessage: true, message: { stop_reason: 'end_turn' } }])), 'an API error is never finished').toBe('open');
    expect(end(jl([{ type: 'summary' }, { type: 'system' }]))).toBe('none');
    expect(end('')).toBe('none');
    expect(end(jl([RATE(), CHATTER, CHATTER]))).toBe('rate-limit');
    expect(end(jl([FIN]) + '{"type":"assis')).toBe('open');
    expect(end(jl([RATE(), FIN, 'not json', RATE(1790000001)]))).toBe('rate-limit 1790000001');
    expect(end(jl([FIN, 'not json']) )).toBe('open');
    expect(end(jl([FIN, 'not json', FIN])), 'a later whole row replaces the open').toBe('finished');
    const userLimit = { type: 'user', isApiErrorMessage: true, error: 'rate_limit', message: { content: 'plain words' } };
    expect(end(jl([FIN, userLimit]))).toBe('open');
    expect(end(jl([userLimit]))).not.toMatch(/^rate-limit/);
    expect(jq(jl([userLimit]), 'limit_banner("stuck"; "")'), 'limit_banner reads the same row the same way').toMatch(/^1/);
    expect(jq(jl([RATE(1790000000)]), 'limit_banner("stuck"; "")')).toMatch(/^0\n1790000000/);
  });
  it('agent_end uses lb_ratelimit and lb_reset, which limit_banner shares', () => {
    const jqSrc = read('ccd/lib/transcript.jq');
    expect(jqSrc).toMatch(/^def lb_ratelimit: /m);
    expect(jqSrc).toMatch(/^def lb_reset: /m);
    expect(jqSrc.match(/\$row \| lb_ratelimit/g)).toHaveLength(2);
    expect(jqSrc.match(/error == "rate_limit"/g), 'the row test is spelled once').toHaveLength(1);
    expect(jqSrc).toMatch(/^def agent_end:/m);
    expect(jqSrc).toMatch(/`agent_end`/);
  });
});

describe('the vocabularies, the grammar and the shipping', () => {
  const tuple = (name: string): string[] => {
    const m = new RegExp(`^${name} = \\(([^)]*)\\)$`, 'm').exec(progSrc);
    return m ? [...m[1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]!) : [];
  };
  it('MANIFEST_CLASSES, MANIFEST_VERDICTS, MANIFEST_WHY, MANIFEST_SITES and MANIFEST_DROP_WHY are spelled once, and the program names a class, verdict, site or drop word only through them; a site outside MANIFEST_SITES is rc 2', () => {
    const want: Record<string, string[]> = {
      MANIFEST_CLASSES: ['in-flight', 'holed', 'stopped-agent', 'diverged', 'deferred-until-reset', 'abandoned'],
      MANIFEST_VERDICTS: ['listed', 'none', 'unread', 'not-applicable', 'unmeasured'],
      MANIFEST_WHY: ['busy', 'budget', 'time', 'error'],
      MANIFEST_SITES: ['swap', 'limit-resume', 'revival'],
      MANIFEST_DROP_WHY: ['id', 'path', 'budget', 'shape'],
    };
    const rest = progSrc.split('\n').filter((l) => !/^MANIFEST_[A-Z_]+ = \(/.test(l)).filter((l) => !l.trimStart().startsWith('#')).join('\n');
    for (const [name, words] of Object.entries(want)) {
      expect(progSrc.match(new RegExp(`^${name} = `, 'gm')), name).toHaveLength(1);
      expect(tuple(name), name).toEqual(words);
      for (const w of words) {
        expect(rest.includes(`'${w}'`) || rest.includes(`"${w}"`), `${name}: '${w}' is named outside its tuple`).toBe(false);
      }
    }
    expect(run({ site: 'refuse' }).rc).toBe(2);
    for (const s of want['MANIFEST_SITES']!) expect(run({ site: s }).rc, s).toBe(0);
  });

  it('every line of every case fullmatches its grammar, and no output holds a planted sentinel', () => {
    expect(outputs.length, 'the cases above ran first, in this file').toBeGreaterThan(10);
    const id = '[A-Za-z0-9_-]{1,64}';
    const summary = /^summary verdict=(listed|none|unread) items=\d+ in-flight=\d+ holed=\d+ stopped-agent=\d+ diverged=\d+ deferred-until-reset=\d+ abandoned=\d+ unread=\d+ unread-expired=\d+ killed=\d+ resumed=\d+ drop-id=\d+ drop-path=\d+ drop-budget=\d+ drop-shape=\d+ drop-read=\d+ drop-readpath=\d+ drop-over=\d+ retired=\d+$/;
    const item = new RegExp(`^item class=(in-flight|holed|stopped-agent|diverged|deferred-until-reset|abandoned) kind=(workflow|agent) run=(${id}|-) task=(${id}|-) agent=(${id}|-) script=([A-Za-z0-9._/@+-]+|-) attempts=\\d+ since=\\d+ reset=(\\d+|-) longer=([A-Za-z0-9._/@+-]+|-) src=(record|sidecar)$`);
    const rowRe = /^row \{.*\}$/;
    let checked = 0;
    for (const out of outputs) {
      expect(out).not.toContain(SENTINEL);
      if (out === '') continue;
      const ls = out.split('\n');
      expect(ls.at(-1), 'ends in LF').toBe('');
      const body = ls.slice(0, -1);
      if (/^(budget \d+|record [a-z]+)$/.test(body[0]!)) { expect(body).toHaveLength(1); continue; }
      expect(body[0], body[0]).toMatch(summary);
      for (const l of body.slice(1)) { expect(item.test(l) || rowRe.test(l), l).toBe(true); checked += 1; }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('ships where ccd looks for it: deploy.sh and ccrc install it, back it up and remove it', () => {
    const DEST = '.cc-sessions/lib/inflight-manifest.py';
    expect(read('deploy/deploy.sh')).toContain(`install_atomic ccd/lib/inflight-manifest.py ${DEST} 644`);
    expect(read('deploy/deploy.sh')).toContain('~/.cc-sessions/lib/inflight-manifest.py ~/ccrc-backups/$TS/inflight-manifest.py');
    const ccrc = read('ccd/ccrc');
    expect(ccrc).toContain(`_inst_atomic "$tree/ccd/lib/inflight-manifest.py" "$HOME/${DEST}" 644`);
    expect(ccrc).toContain(`_upd_backup_copy "$HOME/${DEST}" inflight-manifest.py`);
    expect(ccrc).toContain('"$reg/lib/inflight-manifest.py"');
    expect(read('server/test/installTreeFixture.ts')).toContain("'ccd/lib/inflight-manifest.py'");
    expect(read('server/test/ccd-python-reader-census.test.ts')).toContain("name: 'lib/inflight-manifest.py', kind: 'no-read', d: 'D-8369'");
  });
});
