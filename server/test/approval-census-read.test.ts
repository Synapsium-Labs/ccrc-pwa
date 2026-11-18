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
import { approvalCensusOf, censusPathOfApproval, isReadPrompt, CENSUS_SUMMARY_MAX, type CensusApprovalRow, type CensusOwnRow } from '../src/coord/approvalCensus.js';
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
  releaseReason: null, askAt: Date.UTC(2026, 10, 18, 12), programme: 'overlord', denyCurrent: null, commandWords: ['cat'], literalInRoot: true,
  ...over,
});
const own = (over: Partial<CensusOwnRow>): CensusOwnRow => ({
  id: 1, sessionId: 'lane-a-child', path: 'hook-skipped', route: 'deny-unknown', thread: 'main', tool: 'Bash', summary: 'rm -rf build',
  programme: 'overlord', seenAt: Date.UTC(2026, 10, 18, 13), ...over,
});

describe('censusPathOfApproval: where a minted row went (Table 2a)', () => {
  it('ruled, held, released at mint, escalate and lapsed, with their authority', () => {
    expect(censusPathOfApproval({ state: 'allowed', releaseReason: null, class: 'ordinary' })).toEqual({ path: 'ruled', authority: 'coordinator', reachedOperator: false });
    expect(censusPathOfApproval({ state: 'denied', releaseReason: null, class: 'escalate' })).toEqual({ path: 'ruled', authority: 'coordinator', reachedOperator: false });
    expect(censusPathOfApproval({ state: 'held', releaseReason: null, class: 'escalate' })).toEqual({ path: 'held', authority: 'none', reachedOperator: false });
    expect(censusPathOfApproval({ state: 'released', releaseReason: 'run-unclaimed', class: 'escalate' })).toMatchObject({ path: 'released-at-mint', reachedOperator: true });
    expect(censusPathOfApproval({ state: 'operator', releaseReason: null, class: 'escalate' })).toMatchObject({ path: 'escalate', authority: 'operator' });
    expect(censusPathOfApproval({ state: 'stale', releaseReason: null, class: 'ordinary' })).toMatchObject({ path: 'lapsed', authority: 'operator' });
    expect(censusPathOfApproval({ state: 'declined', releaseReason: null, class: 'ordinary' })).toMatchObject({ path: 'lapsed', reachedOperator: true });
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
    expect(isReadPrompt(row({ commandWords: ['cat', 'rm'] }))).toBe(false);
    expect(isReadPrompt(row({ commandWords: null }))).toBe(false);
  });
  it('a census row of paths 1, 2 or 7 never counts', () => {
    const w = approvalCensusOf({ days: 14, fromMs: 0, toMs: 1, approvals: [],
      census: [own({ path: 'hook-skipped' }), own({ id: 2, path: 'refused-at-mint' }), own({ id: 3, path: 'not-a-child' })], pushesBySource: {} });
    expect(w.readPrompts).toBe(0);
  });
});

describe('approvalCensusOf: the counts, M38 and the rows', () => {
  const w: ApprovalCensusWire = approvalCensusOf({
    days: 14, fromMs: 0, toMs: 1,
    approvals: [
      row({ id: 1 }),
      row({ id: 2, state: 'allowed', class: 'ordinary', commandWords: ['rm'], literalInRoot: false }),
      row({ id: 3, state: 'released', releaseReason: 'run-unclaimed', agentId: 'agent-1', programme: null, askAt: Date.UTC(2026, 10, 17, 9) }),
      row({ id: 4, state: 'held' }),
    ],
    census: [own({ id: 9, thread: null, path: 'envelope-erased', route: null, tool: null, summary: null })],
    pushesBySource: { approval: 3, census: 1 },
  });
  it('counts every row by its words', () => {
    expect(w.total).toBe(5);
    expect(w.reachedOperator).toBe(3);
    expect(w.byPath).toEqual({ escalate: 1, ruled: 1, 'released-at-mint': 1, held: 1, 'envelope-erased': 1 });
    expect(w.byAuthority).toEqual({ operator: 3, coordinator: 1, none: 1 });
    expect(w.byThread).toEqual({ main: 3, subagent: 1, unknown: 1 });
    expect(w.byDenyCurrent).toEqual({ unmeasured: 5 });
    expect(w.byProgramme).toEqual({ overlord: 4, '(none)': 1 });
    expect(w.byReleaseReason).toEqual({ 'run-unclaimed': 1 });
    expect(w.readPrompts).toBe(1);
    expect(w.pushesBySource).toEqual({ approval: 3, census: 1 });
  });
  it('M38: the prompts that reached the operator, per programme-day, by day and path', () => {
    expect(w.m38.programmeDays).toBe(2);
    expect(w.m38.perProgrammeDay).toBe(1.5);
    expect(w.m38.byDay).toEqual([
      { day: '2026-11-17', reachedOperator: 1, byPath: { 'released-at-mint': 1 } },
      { day: '2026-11-18', reachedOperator: 2, byPath: { escalate: 1, 'envelope-erased': 1 } },
    ]);
  });
  it('M38 with nothing in the window is null, never zero', () => {
    expect(approvalCensusOf({ days: 14, fromMs: 0, toMs: 1, approvals: [], census: [], pushesBySource: {} }).m38.perProgrammeDay).toBeNull();
  });
  it('never an input: each row carries exactly the wire\'s fields, and a summary is the redacted one, cut to 200 characters', () => {
    const keys: Array<keyof ApprovalCensusRowWire> = ['source', 'id', 'at', 'day', 'sessionId', 'programme', 'thread', 'tool', 'summary', 'path',
      'route', 'state', 'releaseReason', 'class', 'denyCurrent', 'authority', 'reachedOperator', 'readPrompt'];
    for (const r of w.rows) expect(Object.keys(r).sort()).toEqual([...keys].sort());
    const long = approvalCensusOf({ days: 1, fromMs: 0, toMs: 1, approvals: [row({ inputRedacted: `cat ${'a'.repeat(400)}` })], census: [], pushesBySource: {} });
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
    c.insertCensusRow({ sessionId: 'lane-a-child', sightingKey: 'env:1', path: 'hook-skipped', route: 'no-key', thread: 'main', tool: 'Bash',
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
    expect((await a.inject({ method: 'GET', url: '/api/approvals/census' })).json()).toMatchObject({ days: 14 });
    for (const bad of ['0', '91', 'x', '1.5', '-1']) {
      expect((await a.inject({ method: 'GET', url: `/api/approvals/census?days=${bad}` })).statusCode, bad).toBe(400);
    }
    expect((await (await app(undefined)).inject({ method: 'GET', url: '/api/approvals/census' })).statusCode).toBe(501);
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
      rulingsAllowedHere, heldFor, denyEngaged: async () => true, liveVersionOf: async () => '2.1.302', journalDigestMismatch: () => {},
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
