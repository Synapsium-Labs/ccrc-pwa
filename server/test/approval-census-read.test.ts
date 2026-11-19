/**
 * The approval census's read and its facts (approvals plan 2026-11-18, §3.1 and Task 1.4): the two facts each minted row
 * keeps from mint (the command words and `literalInRoot`, F7), the L1 read `approvalCensusOf` (the counts, the authority
 * column N3, M38, the read prompts PR 6's gate counts, and never an unredacted input), the session-gated door, and the
 * approval push's source on its outbox row.
 */
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import Fastify from 'fastify';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { approvalCommandWords, literalInRoot, type ApprovalCtx } from '../src/coord/approvalguard.js';
import {
  approvalCensusOf, censusPathOfApproval, censusWindow, isReadPrompt, programmeDaysOf, CENSUS_SUMMARY_MAX, type CensusApprovalRow, type CensusOwnRow,
} from '../src/coord/approvalCensus.js';
import { registerApprovalCensusRoutes } from '../src/coord/approvalCensusRoutes.js';
import { heldFor } from '../src/coord/heldFor.js';
import { rulingsAllowedHere } from '../src/coord/approvalsign.js';
import { SHAPE_ONLY_MASKER } from '../src/accounts/mask.js';
import { createQuestions } from '../src/coord/questions.js';
import type { ApprovalCensusRowWire, ApprovalCensusWire } from '../../shared/approval-census.js';
import { CHILD, hookInput, requestBody, standardFixture, workdirOf, type Approvals } from './approvalsHarness.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const WT = '/w/project-a/lane-a-child';
const CTX: ApprovalCtx = { worktree: WT, tmpRoot: '/home/u/.cc-tmp/lane-a-child', scratch: null, home: '/home/u', cwd: WT };
const bash = (command: string): Record<string, unknown> => ({ command });

describe('literalInRoot: every argument a literal path inside a root (F7)', () => {
  const yes = ['cat src/a.ts', 'head -n 5 src/a.ts', 'ls', 'ls .', `stat ${WT}/README.md`, 'wc -l src/a.ts src/b.ts', 'cat src/a.ts; ls docs'];
  const no = [
    'cat ~/x', 'cat $X', 'cat "$X"', 'cat *', 'cat src/*.ts', 'cat ../other/x', 'cat /etc/hosts', 'cat src/a.ts | head',
    'cat src/a.ts > out.txt', 'cat src/a.ts 2>/dev/null', 'X=1 && cat src/a.ts', 'cat $(echo a)', 'cat ~/.ssh/id_rsa', 'cat \'\'',
  ];
  it.each(yes)('%s: true', (c) => { expect(literalInRoot('Bash', bash(c), CTX)).toBe(true); });
  it.each(no)('%s: false', (c) => { expect(literalInRoot('Bash', bash(c), CTX)).toBe(false); });
  it('a relative path with no trusted cwd, and any other tool, is false', () => {
    expect(literalInRoot('Bash', bash('cat src/a.ts'), { ...CTX, cwd: null })).toBe(false);
    expect(literalInRoot('Read', { file_path: `${WT}/a.ts` }, CTX)).toBe(false);
  });
});

describe('approvalCommandWords: the statement list\'s command words', () => {
  it('lists each simple command\'s name, `=` for an assignment, and null when the grammar cannot list them', () => {
    expect(approvalCommandWords('Bash', bash('cat a; ls b && wc -l c'))).toEqual(['cat', 'ls', 'wc']);
    expect(approvalCommandWords('Bash', bash('X=build && rm -rf "$X"'))).toEqual(['=', 'rm']);
    expect(approvalCommandWords('Bash', bash('cat a | head'))).toBeNull();
    expect(approvalCommandWords('Bash', bash('/bin/cat a'))).toEqual(['/bin/cat']);   // a word, not one of the six
    expect(approvalCommandWords('Bash', bash("'cat' a"))).toBeNull();
    expect(approvalCommandWords('Read', { file_path: '/x' })).toBeNull();
  });
});

const row = (over: Partial<CensusApprovalRow>): CensusApprovalRow => ({
  id: 1, childId: 'lane-a-child', agentId: '', tool: 'Bash', inputRedacted: 'cat src/a.ts', class: 'escalate', state: 'released',
  releaseReason: null, askAt: Date.UTC(2026, 10, 18, 12), notifyAt: Date.UTC(2026, 10, 18, 12, 1), ruledAt: null, programme: 'overlord',
  denyCurrent: null, commandWords: ['cat'], literalInRoot: true, ...over,
});
const own = (over: Partial<CensusOwnRow>): CensusOwnRow => ({
  id: 1, sessionId: 'lane-a-child', path: 'hook-skipped', why: null, route: 'deny-unknown', thread: 'main', tool: 'Bash', summary: 'rm -rf build',
  programme: 'overlord', seenAt: Date.UTC(2026, 10, 18, 13), ...over,
});
const facts = (state: string, over: Partial<{ releaseReason: string | null; class: string; notifyAt: number | null; ruledAt: number | null }> = {}) =>
  ({ state, releaseReason: null, class: 'ordinary', notifyAt: 60_000, ruledAt: null, ...over });

describe('censusPathOfApproval: where a minted row went (Table 2a, and the ruling on review 2638 F3)', () => {
  it('ruled, held, released at mint, and a lapse (escalate or lapsed by class), with their authority', () => {
    expect(censusPathOfApproval(facts('allowed'))).toEqual({ path: 'ruled', authority: 'coordinator', reachedOperator: false });
    expect(censusPathOfApproval(facts('denied', { class: 'escalate' }))).toEqual({ path: 'ruled', authority: 'coordinator', reachedOperator: false });
    expect(censusPathOfApproval(facts('held', { class: 'escalate' }))).toEqual({ path: 'held', authority: 'none', reachedOperator: false });
    expect(censusPathOfApproval(facts('released', { releaseReason: 'run-unclaimed', class: 'escalate' }))).toMatchObject({ path: 'released-at-mint', reachedOperator: true });
    expect(censusPathOfApproval(facts('released'))).toEqual({ path: 'lapsed', authority: 'operator', reachedOperator: true });
    expect(censusPathOfApproval(facts('released', { class: 'escalate' }))).toMatchObject({ path: 'escalate', authority: 'operator' });
    // Answered by the operator after the window: a lapse.
    expect(censusPathOfApproval(facts('operator', { ruledAt: 90_000 }))).toMatchObject({ path: 'lapsed', reachedOperator: true });
  });
  it('`declined` and `stale` are their own words and reached the operator; an answer inside the window is `operator-first`', () => {
    expect(censusPathOfApproval(facts('declined', { ruledAt: 10_000 }))).toEqual({ path: 'declined', authority: 'operator', reachedOperator: true });
    expect(censusPathOfApproval(facts('stale'))).toEqual({ path: 'stale', authority: 'operator', reachedOperator: true });
    expect(censusPathOfApproval(facts('operator', { ruledAt: 10_000 }))).toEqual({ path: 'operator-first', authority: 'operator', reachedOperator: true });
  });
  it('a state this build does not know is unmeasured: it reached nobody the census can name', () => {
    expect(censusPathOfApproval(facts('unknown'))).toEqual({ path: 'unmeasured', authority: 'none', reachedOperator: false });
    expect(censusPathOfApproval(facts('weird'))).toEqual({ path: 'unmeasured', authority: 'none', reachedOperator: false });
  });
});

describe('the read-prompt count, PR 6\'s gate (F7)', () => {
  it('counts a held, deny-current, escalate read of literal paths in root that reached the operator, and nothing else', () => {
    expect(isReadPrompt(row({}))).toBe(true);
    expect(isReadPrompt(row({ commandWords: ['cat', 'ls', 'stat'] }))).toBe(true);
    expect(isReadPrompt(row({ literalInRoot: false }))).toBe(false);              // cat ~/x, cat $X, cat *
    expect(isReadPrompt(row({ literalInRoot: null }))).toBe(false);               // minted before the fact
    expect(isReadPrompt(row({ releaseReason: 'run-unclaimed' }))).toBe(false);    // released: never held
    expect(isReadPrompt(row({ denyCurrent: false }))).toBe(false);
    expect(isReadPrompt(row({ class: 'ordinary' }))).toBe(false);
    expect(isReadPrompt(row({ state: 'denied' }))).toBe(false);                   // the coordinator settled it
    expect(isReadPrompt(row({ state: 'held' }))).toBe(false);
    expect(isReadPrompt(row({ state: 'unknown' }))).toBe(false);                  // unmeasured
    expect(isReadPrompt(row({ commandWords: ['cat', 'rm'] }))).toBe(false);
    expect(isReadPrompt(row({ commandWords: null }))).toBe(false);
  });
  it('a census row of paths 1, 2 or 7 never counts', () => {
    const w = approvalCensusOf({ days: 14, fromMs: 0, toMs: 1, approvals: [], runs: [],
      census: [own({ path: 'hook-skipped' }), own({ id: 2, path: 'refused-at-mint' }), own({ id: 3, path: 'not-a-child' })], pushesBySource: {} });
    expect(w.readPrompts).toBe(0);
  });
});

describe('approvalCensusOf: the counts, M38 and the rows', () => {
  const FROM = Date.UTC(2026, 10, 17); const TO = Date.UTC(2026, 10, 19);
  const w: ApprovalCensusWire = approvalCensusOf({
    days: 2, fromMs: FROM, toMs: TO,
    approvals: [
      row({ id: 1 }),
      row({ id: 2, state: 'allowed', class: 'ordinary', commandWords: ['rm'], literalInRoot: false }),
      row({ id: 3, state: 'released', releaseReason: 'run-unclaimed', agentId: 'agent-1', programme: null, askAt: Date.UTC(2026, 10, 17, 9) }),
      row({ id: 4, state: 'held' }),
      row({ id: 5, state: 'unknown' }),
    ],
    census: [
      own({ id: 9, thread: null, path: 'envelope-erased', route: null, tool: null, summary: null }),
      own({ id: 10, thread: null, path: 'unmeasured', why: 'near-miss', route: null, tool: null, summary: null }),
    ],
    // The `overlord` programme had a run open on both days; `programme-b` on the 18th only, and raised no prompt.
    runs: [
      { programme: 'overlord', openedAt: Date.UTC(2026, 10, 10), closedAt: null },
      { programme: 'programme-b', openedAt: Date.UTC(2026, 10, 18, 8), closedAt: Date.UTC(2026, 10, 18, 9) },
      { programme: 'programme-c', openedAt: Date.UTC(2026, 10, 1), closedAt: Date.UTC(2026, 10, 2) },
    ],
    pushesBySource: { approval: 3, census: 1 },
  });
  it('counts every row by its words; the unmeasured on their own, never as reaching the operator', () => {
    expect(w.total).toBe(7);
    expect(w.reachedOperator).toBe(3);
    expect(w.unmeasured).toBe(2);
    expect(w.byUnmeasured).toEqual({ 'unknown-state': 1, 'near-miss': 1 });
    expect(w.byPath).toEqual({ escalate: 1, ruled: 1, 'released-at-mint': 1, held: 1, 'envelope-erased': 1, unmeasured: 2 });
    expect(w.byAuthority).toEqual({ operator: 3, coordinator: 1, none: 3 });
    expect(w.byThread).toEqual({ main: 4, subagent: 1, unknown: 2 });
    // Over the five minted rows only (review 2695 F5): a census row has no deny-current fact.
    expect(w.byDenyCurrent).toEqual({ unmeasured: 5 });
    expect(w.byProgramme).toEqual({ overlord: 6, '(none)': 1 });
    expect(w.byReleaseReason).toEqual({ 'run-unclaimed': 1 });
    expect(w.readPrompts).toBe(1);
    expect(w.pushesBySource).toEqual({ approval: 3, census: 1 });
  });
  it('M38 (ruling F4): a programme\'s prompts over the days it had a run open, prompt or none; root prompts beside it', () => {
    expect(w.m38.programmeDays).toBe(3);
    expect(w.m38.programmeReached).toBe(2);
    expect(w.m38.perProgrammeDay).toBeCloseTo(2 / 3);
    expect(w.m38.rootReached).toBe(1);
    expect(w.m38.byDay).toEqual([{ day: '2026-11-18', reachedOperator: 2, byPath: { escalate: 1, 'envelope-erased': 1 } }]);
  });
  it('M38 with no programme-days is null; with programme-days and nothing reaching the operator it is a measured zero', () => {
    expect(approvalCensusOf({ days: 1, fromMs: FROM, toMs: TO, approvals: [], census: [], runs: [], pushesBySource: {} }).m38.perProgrammeDay).toBeNull();
    const quiet = approvalCensusOf({ days: 1, fromMs: FROM, toMs: TO, approvals: [], census: [], pushesBySource: {},
      runs: [{ programme: 'overlord', openedAt: FROM, closedAt: null }] });
    expect(quiet.m38).toMatchObject({ programmeDays: 2, perProgrammeDay: 0 });
  });
  it('programmeDaysOf: a run counts each UTC day it was open inside the window, once per programme', () => {
    const D = 86_400_000;
    expect(programmeDaysOf([{ programme: 'p', openedAt: FROM + 3_600_000, closedAt: FROM + D + 60_000 }], FROM, TO)).toBe(2);
    expect(programmeDaysOf([{ programme: 'p', openedAt: FROM, closedAt: null }, { programme: 'p', openedAt: FROM, closedAt: FROM + 1 }], FROM, TO)).toBe(2);
    expect(programmeDaysOf([{ programme: 'p', openedAt: TO + 1, closedAt: null }], FROM, TO)).toBe(0);
  });
  it('F-H: a run closed exactly at 00:00 UTC does not count the day it closed into', () => {
    const D = 86_400_000;
    expect(programmeDaysOf([{ programme: 'p', openedAt: FROM + 3_600_000, closedAt: FROM + D }], FROM, TO)).toBe(1);
    // F9 (review 2695): an empty span inside the window (a run closed at the window's first midnight) counts no day.
    expect(programmeDaysOf([{ programme: 'p', openedAt: FROM - D, closedAt: FROM }], FROM, TO)).toBe(0);
  });
  it('F-D: the window is the last N whole UTC days, today\'s included, so N days are N programme-days', () => {
    const D = 86_400_000;
    const now = Date.UTC(2026, 10, 18, 0, 30);             // half an hour after midnight
    const win = censusWindow(now, 14);
    expect(win).toEqual({ fromMs: Date.UTC(2026, 10, 5), toMs: now });
    expect(programmeDaysOf([{ programme: 'p', openedAt: now - 60 * D, closedAt: null }], win.fromMs, win.toMs)).toBe(14);
    // A run across midnight inside the window is two programme-days.
    expect(programmeDaysOf([{ programme: 'p', openedAt: now - 3_600_000, closedAt: null }], win.fromMs, win.toMs)).toBe(2);
    expect(censusWindow(Date.UTC(2026, 10, 18, 23, 59), 1).fromMs).toBe(Date.UTC(2026, 10, 18));
  });
  it('never an input: each row carries exactly the wire\'s fields, and a summary is the redacted one, cut to 200 characters', () => {
    const keys: Array<keyof ApprovalCensusRowWire> = ['source', 'id', 'at', 'day', 'sessionId', 'programme', 'thread', 'tool', 'summary', 'path',
      'why', 'route', 'state', 'releaseReason', 'class', 'denyCurrent', 'authority', 'reachedOperator', 'readPrompt'];
    for (const r of w.rows) expect(Object.keys(r).sort()).toEqual([...keys].sort());
    const long = approvalCensusOf({ days: 1, fromMs: 0, toMs: 1, approvals: [row({ inputRedacted: `cat ${'a'.repeat(400)}` })], census: [], runs: [], pushesBySource: {} });
    expect(long.rows[0]!.summary).toHaveLength(CENSUS_SUMMARY_MAX);
  });
});

// ── the door ──────────────────────────────────────────────────────────────────────────────────────────────────────

afterEach(() => { removeTmpFixtures(); });
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-census-read-'), '.ccrc', 'coord.db')));
const NOW = Date.UTC(2026, 10, 18, 18);

describe('GET of the census: session-gated, counts only', () => {
  // The door reads through the questions owner, as `server.ts` wires it (W3's census keeps question-table reads there).
  const app = async (coord: CoordStore | undefined): Promise<ReturnType<typeof Fastify>> => {
    const a = Fastify({ logger: false });
    const q = createQuestions({ coord });
    registerApprovalCensusRoutes(a, { sources: (f, t) => q.censusSources(f, t), wall: () => NOW });
    await a.ready();
    return a;
  };
  it('answers the window\'s rows and counts; days out of range is bad-request; no store is not-configured', async () => {
    const c = store();
    c.insertApproval({ childId: 'lane-a-child', parentId: 'lane-a-coord', runId: null, digest: 'a'.repeat(64), nonce: 'b'.repeat(32), agentId: '',
      tool: 'Bash', inputRedacted: 'cat src/a.ts', truncated: false, class: 'escalate', askAt: NOW - 3_600_000, notifyAt: NOW - 3_540_000,
      releaseReason: 'run-unclaimed', commandWords: ['cat'], literalInRoot: true });
    c.insertApproval({ childId: 'lane-a-child', parentId: 'lane-a-coord', runId: null, digest: 'a'.repeat(64), nonce: 'c'.repeat(32), agentId: '',
      tool: 'Bash', inputRedacted: 'old', truncated: false, class: 'escalate', askAt: NOW - 30 * 86_400_000, notifyAt: NOW });
    c.insertCensusRow({ sessionId: 'lane-a-child', sightingKey: 'env:1', path: 'hook-skipped', why: null, route: 'no-key', thread: 'main', tool: 'Bash',
      summary: 'rm -rf build', runId: null, seenAt: NOW - 60_000 });
    const a = await app(c);
    const res = await a.inject({ method: 'GET', url: '/api/approvals/census?days=7' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    const body = res.json() as ApprovalCensusWire;
    expect(body.days).toBe(7);
    expect(body.total).toBe(2);
    expect(body.byPath).toEqual({ 'released-at-mint': 1, 'hook-skipped': 1 });
    expect(body.byRoute).toEqual({ 'no-key': 1 });
    // F5 (review 2695): the census row adds nothing to deny currency, so the card's "not measured" note stays off.
    expect(body.byDenyCurrent).toEqual({ current: 1 });
    expect((await a.inject({ method: 'GET', url: '/api/approvals/census' })).json()).toMatchObject({ days: 14 });
    for (const bad of ['0', '91', 'x', '1.5', '-1']) {
      expect((await a.inject({ method: 'GET', url: `/api/approvals/census?days=${bad}` })).statusCode, bad).toBe(400);
    }
    expect((await (await app(undefined)).inject({ method: 'GET', url: '/api/approvals/census' })).statusCode).toBe(501);
  });
  it('approvals PR 0\'s deny-current fact reaches the read from the row: a not-current row is counted so, and is never a read prompt', async () => {
    const c = store();
    c.insertApproval({ childId: 'lane-a-child', parentId: 'lane-a-coord', runId: null, digest: 'a'.repeat(64), nonce: 'd'.repeat(32), agentId: '',
      tool: 'Bash', inputRedacted: 'cat src/a.ts', truncated: false, class: 'escalate', askAt: NOW - 3_600_000, notifyAt: NOW - 3_540_000,
      denyCurrent: false, commandWords: ['cat'], literalInRoot: true });
    c.insertApproval({ childId: 'lane-a-child', parentId: 'lane-a-coord', runId: null, digest: 'a'.repeat(64), nonce: 'e'.repeat(32), agentId: '',
      tool: 'Bash', inputRedacted: 'cat src/b.ts', truncated: false, class: 'escalate', askAt: NOW - 3_000_000, notifyAt: NOW - 2_940_000,
      commandWords: ['cat'], literalInRoot: true });
    // Both held, then lapsed (released at notifyAt): each reached the operator.
    c.db.prepare("UPDATE approvals SET state = 'released'").run();
    const a = await app(c);
    const body = (await a.inject({ method: 'GET', url: '/api/approvals/census?days=1' })).json() as ApprovalCensusWire;
    expect(body.byDenyCurrent).toEqual({ 'not-current': 1, current: 1 });
    expect(body.readPrompts).toBe(1);
  });
  it('a store that cannot be read is unavailable, never an empty census', async () => {
    const broken = { censusRowsIn: () => { throw new Error('disk I/O error'); }, approvalRowsForCensus: () => ({ ok: true, rows: [] }), approvalPushSources: () => ({}) };
    const a = Fastify({ logger: false });
    const q = createQuestions({ coord: broken as never });
    registerApprovalCensusRoutes(a, { sources: (f, t) => q.censusSources(f, t), wall: () => NOW });
    const res = await a.inject({ method: 'GET', url: '/api/approvals/census' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'unavailable' });
  });
});

describe('the approvals\' retention clears the command words with the input (review 2638 F11b)', () => {
  it('a row past the retention loses its input and its command words; a newer row keeps both', () => {
    const c = store();
    const mintAt = (askAt: number, nonce: string): number => c.insertApproval({ childId: 'lane-a-child', parentId: 'lane-a-coord', runId: null,
      digest: 'a'.repeat(64), nonce: nonce.repeat(32), agentId: '', tool: 'Bash', inputRedacted: 'cat src/a.ts', truncated: false, class: 'escalate',
      askAt, notifyAt: askAt + 60_000, commandWords: ['/bin/cat'], literalInRoot: true });
    const old = mintAt(NOW - 40 * 86_400_000, 'b');
    const fresh = mintAt(NOW, 'c');
    c.pruneApprovalInputs(NOW);
    const read = (id: number): unknown => c.db.prepare('SELECT inputRedacted, commandWords FROM approvals WHERE id = ?').get(id);
    expect(read(old)).toEqual({ inputRedacted: null, commandWords: null });
    expect(read(fresh)).toEqual({ inputRedacted: 'cat src/a.ts', commandWords: '["/bin/cat"]' });
  });
});

describe('the approval push carries its source on its outbox row', () => {
  it('an unbound insert with a source keeps it, and the read counts pushes by its kind', () => {
    const c = store();
    const payload = { title: 't', body: 'b', tag: 'ask-x', url: '/s/x' } as never;
    expect(c.insertUnboundRow({ pushId: 'p1', payload, at: NOW - 10, pushSource: 'approval:4' }).ok).toBe(true);
    expect(c.insertUnboundRow({ pushId: 'p2', payload, at: NOW - 9, pushSource: 'census:2' }).ok).toBe(true);
    expect(c.insertUnboundRow({ pushId: 'p3', payload, at: NOW - 8 }).ok).toBe(true);
    expect(c.approvalPushSources(0, NOW)).toEqual({ approval: 1, census: 1 });
  });
});

describe('the two facts are kept at mint (raiseApproval)', () => {
  let f: Approvals | undefined;
  afterEach(async () => { if (f) await f.close(); f = undefined; });
  it('a read of a literal path in the worktree mints with its command words and literalInRoot; a glob mints false', async () => {
    f = await standardFixture();
    const q = createQuestions({ coord: f.coord });
    const deps = {
      coord: f.coord, io: f.deps.io, cfg: f.deps.cfg, tmux: f.deps.tmux, masker: SHAPE_ONLY_MASKER, signerFor: () => ({}) as never,
      rulingsAllowedHere, heldFor, denyStanding: async () => 'current' as const, liveVersionOf: async () => '2.1.302', journalDigestMismatch: () => {},
    };
    const mint = async (command: string): Promise<{ commandWords: string | null; literalInRoot: number | null }> => {
      const b = requestBody(hookInput({ command, cwd: workdirOf(CHILD) }));
      const v = await q.raiseApproval({ sessionId: CHILD, digest: b.digest, nonce: b.nonce, canonical: b.canonical }, deps, Date.now());
      expect(v.kind === 'minted' || v.kind === 'approval-released').toBe(true);
      const id = (v as { id: number }).id;
      return f!.coord.db.prepare('SELECT commandWords, literalInRoot FROM approvals WHERE id = ?').get(id) as { commandWords: string | null; literalInRoot: number | null };
    };
    expect(await mint('cat src/a.ts')).toEqual({ commandWords: '["cat"]', literalInRoot: 1 });
    expect(await mint('cat src/*.ts')).toEqual({ commandWords: '["cat"]', literalInRoot: 0 });
    expect(await mint('cat a | head')).toEqual({ commandWords: null, literalInRoot: 0 });
  });
});
