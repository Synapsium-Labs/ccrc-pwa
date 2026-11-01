// W3 Q3f's door family (D-7030; ARCH-57 (#792), server half; plan 2026-10-26-consolidation-w3-questions.md, Task Q3f;
// OA-C7 ruled (a), 2026-10-26). `POST /api/questions/:id/answer` is the operator's, `/rule` and `/release` the claimant's,
// all three in `coord/routes.ts` behind its one gate, and the PATH picks the principal, never a body field or a header.
//
// HOW A ROW READS. A PAIR row runs one scenario twice, on two fresh fixtures: once through the old door and once through
// the new path with the same answer, and the two outcomes (status, body bytes, row state, keys pressed, feed rows, pushes,
// the door-ins the `Questions` instance was called with, mail to the parent) must be EQUAL. `question-doors-pin` holds the
// old doors' rows byte for byte, so equality here is "the new path answers Q3a's rows". The other rows are the new
// family's own: the id grammar, the kind check, the session gate, and the gate's posture. A refusal that names its own
// route (the box token's `no box token presented — <route> …`) names the new door, so it is a row of its own, not a pair.
//
// RETIRED ROWS (W7 C7p, D-7194; plan 2026-10-27-consolidation-w7-pwa.md, Task C7p). The operator's old doors
// (`/api/sessions/:id/ask`, `/dialog`, `/dialog/text`, `/dialog/multi`) are retired one per commit. A pair whose old door
// is gone moves from PAIRS to RETIRED_PAIRS, unchanged, and reads differently: the old door answers 404 on its own
// fixture and nothing moves (no key, no row change, no door-in, no feed row, no push), and the new path, on a fresh
// fixture, answers the old door's outcome as RECORDED on the base before the retirement (RETIRED_OUTCOMES, every field
// the pair compared). The equality the pair held, new == old, is held against the old door's recorded bytes.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { askKey } from '../src/askkey.js';
import { buildServer, type Deps } from '../src/server.js';
import { Tmux } from '../src/exec.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { parseDialog } from '../src/pane/dialog.js';
import type { PtyLike } from '../src/pty.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Questions } from '../src/coord/questions.js';
import { SERVER_CAPS } from '../../shared/api.js';
import {
  CHILD, CHILD2, hookInput, PARENT, requestBody, standardFixture, TOK, TOKEN, uuidOf, type Approvals,
} from './approvalsHarness.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const panesDir = path.join(__dirname, 'fixtures', 'panes');
const paneFixture = (name: string): string => readFileSync(path.join(panesDir, `${name}.txt`), 'utf8');

interface Outcome { status: number; body: string; effects: Record<string, unknown> }
const bodyOf = (res: LightMyRequestResponse): string =>
  res.body.length > 400 ? `sha256:${createHash('sha256').update(res.body, 'utf8').digest('hex')}` : res.body;

let KEYS: string[] = [];
beforeEach(() => {
  KEYS = [];
  vi.spyOn(Tmux.prototype, 'sendKey').mockImplementation(async (id: string, k: string) => { KEYS.push(`${id} ${k}`); return true; });
  vi.spyOn(Tmux.prototype, 'sendLiteral').mockImplementation(async (id: string, t: string) => { KEYS.push(`${id} -l ${t}`); return true; });
});
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const c of cleanup.splice(0)) await c();
});

/** The four door-ins on the composition's `Questions` instance, spied (calling through), each recorded with the
 *  arguments the route's door-in had: the child, and the late answer's row and parent, or the ruling's agent, parent and
 *  verdict. */
const DOOR_INS: ReadonlyArray<readonly [keyof Questions, number]> = [['released', 1], ['answeredLate', 3], ['approvalReleased', 1], ['approvalRuled', 4]];
const spyDoorIns = (q: Questions): (() => string[]) => {
  const calls: string[] = [];
  for (const [m, n] of DOOR_INS) {
    const real = (q[m] as (...a: unknown[]) => unknown).bind(q);
    vi.spyOn(q, m).mockImplementation(((...a: unknown[]) => {
      calls.push(`${m}(${a.slice(0, n).map((x) => JSON.stringify(x)).join(',')})`);
      return real(...a);
    }) as never);
  }
  return () => [...calls];
};

const script = (f: Approvals, id: string, panes: string[]): void => {
  let i = 0;
  const real = f.panes.get.bind(f.panes);
  f.panes.get = ((k: string) => (k === id ? panes[Math.min(i++, panes.length - 1)] : real(k))) as typeof f.panes.get;
  f.panes.set(id, panes[0]!);
};

const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
const ASK_KEY = askKey({ questions: [QUESTION] })!;
const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';
const P = { fromId: PARENT, fromUuid: uuidOf(PARENT) };
const ORDINARY = hookInput({ command: 'rm -rf build' });

const hookstate = (f: Approvals, id: string, updatedAt: number, ask: unknown = { questions: [QUESTION] }): void => {
  writeFileSync(path.join(f.home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuidOf(id), pid: 4242, updatedAt, ask, subagents: [],
  }));
};

/** One composition for one side of a pair: the standard family, its watcher's door-ins spied. */
interface Side { f: Approvals; id: number; now: number; doorIns: () => string[]; feed0: number; pushes0: number }

const family = async (): Promise<Approvals & { runId: number }> => {
  const f = await standardFixture();
  cleanup.push(async () => { await f.close(); });
  return f;
};

/** The child's ask painted, its hookstate waiting, and (unless `none`) one ask row held for the parent. */
const askSide = async (o: { mint?: 'held' | 'none'; releaseReason?: 'parent-not-live' } = {}): Promise<Side> => {
  const f = await family();
  const now = Date.now();
  hookstate(f, CHILD, now);
  f.panes.set(CHILD, ASK_PANE);
  const doorIns = spyDoorIns(f.watcher.questions);
  const id = o.mint === 'none' ? -1 : f.coord.insertAsk({
    childId: CHILD, parentId: PARENT, runId: f.runId, askKey: ASK_KEY, askAt: now, dialogId: 'dlg-1',
    question: QUESTION.question, options: QUESTION.options.map((x) => x.label), now,
    ...(o.releaseReason === undefined ? {} : { releaseReason: o.releaseReason }),
  });
  return { f, id, now, doorIns, feed0: f.coord.feedEvents(50).length, pushes0: f.sent.length };
};

/** One held approvals row minted through the raise. */
const approvalSide = async (): Promise<Side> => {
  const f = await family();
  const doorIns = spyDoorIns(f.watcher.questions);
  const res = await f.request(requestBody(ORDINARY));
  const id = (res.json() as { id: number }).id;
  return { f, id, now: Date.now(), doorIns, feed0: f.coord.feedEvents(50).length, pushes0: f.sent.length };
};

/** A painted dialog scripted through `panes`, no ask row. */
const dialogSide = async (panes: string[]): Promise<Side> => {
  const s = await askSide({ mint: 'none' });
  script(s.f, CHILD, panes);
  return s;
};

const outcome = (s: Side, res: LightMyRequestResponse): Outcome => {
  const ask = s.id === -1 ? null : s.f.coord.askById(s.id);
  const approval = s.id === -1 ? null : s.f.coord.approvalById(s.id);
  return {
    status: res.statusCode, body: bodyOf(res),
    effects: {
      ask: ask?.ok && ask.ask !== null ? { state: ask.ask.state, answeredBy: ask.ask.answeredBy, answer: ask.ask.answer } : null,
      approval: approval?.ok && approval.row !== null
        ? { state: approval.row.state, answeredBy: approval.row.answeredBy, releaseReason: approval.row.releaseReason } : null,
      doorIns: s.doorIns(), keys: [...KEYS],
      feed: s.f.coord.feedEvents(50).slice(0, s.f.coord.feedEvents(50).length - s.feed0).map((e) => e.title),
      pushes: s.f.sent.slice(s.pushes0).map((p) => `${p.tag ?? ''} ${p.title} ${p.body}`),
    },
  };
};

const post = (s: Side, url: string, payload: unknown, headers: Record<string, string> = {}) =>
  s.f.app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> });

/** A pair: the same scenario through the old door and the new path. */
type Pair = readonly [name: string, setup: () => Promise<Side>, old: (s: Side) => Promise<LightMyRequestResponse>, nu: (s: Side) => Promise<LightMyRequestResponse>, before?: (s: Side) => void | Promise<void>];

const runPair = async ([, setup, old, nu, before]: Pair): Promise<{ old: Outcome; nu: Outcome }> => {
  const a = await setup();
  await before?.(a);
  const oldOut = outcome(a, await old(a));
  KEYS = [];
  const b = await setup();
  await before?.(b);
  return { old: oldOut, nu: outcome(b, await nu(b)) };
};

const ruleAsk = (body: Record<string, unknown>, headers: Record<string, string> = TOK) => [
  (s: Side) => post(s, `/api/asks/${s.id}/answer`, body, headers),
  (s: Side) => post(s, `/api/questions/ask-${s.id}/rule`, { kind: 'ask', ...body }, headers),
] as const;
const releaseAsk = (body: Record<string, unknown>, id?: number) => [
  (s: Side) => post(s, `/api/asks/${id ?? s.id}/release`, body, TOK),
  (s: Side) => post(s, `/api/questions/ask-${id ?? s.id}/release`, { kind: 'ask', ...body }, TOK),
] as const;
const ruleApproval = (body: Record<string, unknown>, id?: number) => [
  (s: Side) => post(s, `/api/approvals/${id ?? s.id}/rule`, body, TOK),
  (s: Side) => post(s, `/api/questions/approval-${id ?? s.id}/rule`, { kind: 'approval', ...body }, TOK),
] as const;
const releaseApproval = (body: Record<string, unknown>, id?: number) => [
  (s: Side) => post(s, `/api/approvals/${id ?? s.id}/release`, body, TOK),
  (s: Side) => post(s, `/api/questions/approval-${id ?? s.id}/release`, { kind: 'approval', ...body }, TOK),
] as const;
const opAsk = (body: Record<string, unknown>, sid = CHILD) => [
  (s: Side) => post(s, `/api/sessions/${sid}/ask`, body),
  (s: Side) => post(s, `/api/questions/session-${sid}/answer`, { kind: 'ask', ...body }),
] as const;
const opDialog = (route: 'dialog' | 'dialog/text' | 'dialog/multi', body: Record<string, unknown>, sid = CHILD) => [
  (s: Side) => post(s, `/api/sessions/${sid}/${route}`, body),
  (s: Side) => post(s, `/api/questions/session-${sid}/answer`, { kind: 'dialog', ...(route === 'dialog/multi' ? { multi: true } : {}), ...body }),
] as const;

const RULE = { ...P, verdict: 'allow', reason: 'a cleanup inside your worktree' };
const DENY = { ...P, verdict: 'deny', reason: 'not this one' };
const PERMISSION_PANE = 'Bash command\n\n  rm -rf build\n\n  Do you want to proceed?\n'
  + "❯ 1. Yes\n  2. Yes, and don't ask again for rm commands\n  3. No, and tell Claude what to do differently\n\nEnter to confirm\n";
const idOf = (pane: string): string => parseDialog(pane)!.id;
const SAME_LABELS_Q2 = paneFixture('cc300-ask-same-labels-q2');
const FOCUSED = paneFixture('cc300-ask-freetext-walk-2-focused');
const TYPED = paneFixture('cc300-ask-freetext-walk-3-typed');
const TOOLS_OPEN = paneFixture('cc300-ask-multiselect-tools-open');
const TOOLS_2_1 = paneFixture('cc300-ask-multiselect-tools-revisit-digit2-1');
const SIZES_OPEN = paneFixture('cc300-ask-multiselect-sizes-open');
const TEXT = '- only in staging, sampled 10%';

const PAIRS: Pair[] = [
  // The claimant's approval hand-over.
  ['release approval | a bad body', approvalSide, ...releaseApproval({ fromId: PARENT })],
  ['release approval | no such approval', approvalSide, ...releaseApproval(P, 99)],
  ['release approval | not the stored parent', approvalSide, ...releaseApproval({ fromId: CHILD2, fromUuid: uuidOf(CHILD2) })],
  ['release approval | not held', approvalSide, ...releaseApproval(P), async (s) => { await s.f.rule(s.id, PARENT, 'deny'); }],
  ['release approval | success: declined, the door-in fires', approvalSide, ...releaseApproval(P)],
];

/** The pairs whose old door W7 C7p (the operator's) or K5 Q3l (the claimant's, D-7324) retired, each unchanged from its
 *  PAIRS row. */
const RETIRED_PAIRS: Pair[] = [
  // The operator's ask answer: `POST /api/sessions/:id/ask` and `POST /api/questions/session-<id>/answer {kind:'ask'}`.
  ['answer ask | an unknown session', askSide, ...opAsk({ askKey: ASK_KEY, optionIndexes: [0] }, 'project-a-nobody-here')],
  ['answer ask | no askKey', askSide, ...opAsk({ optionIndexes: [0] })],
  ['answer ask | optionIndexes not numbers', askSide, ...opAsk({ askKey: ASK_KEY, optionIndexes: [true] })],
  ['answer ask | nothing held: pressed, nothing recorded', () => askSide({ mint: 'none' }), ...opAsk({ askKey: ASK_KEY, optionIndexes: [1] })],
  ['answer ask | held and taken: answered by the operator', askSide, ...opAsk({ askKey: ASK_KEY, optionIndexes: [1] })],
  ['answer ask | held, the press refused: rolled back', askSide, ...opAsk({ askKey: ASK_KEY, optionIndexes: [5] })],
  ['answer ask | the CAS lost: pressed, the row untouched', askSide, ...opAsk({ askKey: ASK_KEY, optionIndexes: [1] }), (s) => { hookstate(s.f, CHILD, s.now + 5); }],
  ['answer ask | the store refuses: pressed unrecorded', askSide, ...opAsk({ askKey: ASK_KEY, optionIndexes: [1] }),
    (s) => { vi.spyOn(s.f.coord, 'heldAskFor').mockReturnValue({ ok: false, detail: 'fixture: the asks table is unreadable' } as never); }],
  ['answer ask | the store throws: pressed unrecorded', askSide, ...opAsk({ askKey: ASK_KEY, optionIndexes: [1] }),
    (s) => { vi.spyOn(s.f.coord, 'heldAskFor').mockImplementation(() => { throw new Error('fixture: disk I/O error'); }); }],
  ['answer ask | the take throws: pressed unrecorded', askSide, ...opAsk({ askKey: ASK_KEY, optionIndexes: [1] }),
    (s) => { vi.spyOn(s.f.coord, 'takeAskForAnswer').mockImplementation(() => { throw new Error('fixture: disk I/O error'); }); }],
  // The operator's dialog answers: the row, the own words and the multiSelect set.
  ['answer dialog multi | a bad body', () => dialogSide([TOOLS_OPEN]), ...opDialog('dialog/multi', { dialogId: idOf(TOOLS_OPEN), optionIndexes: ['1'] })],
  ['answer dialog multi | bad-indexes is a 400', () => dialogSide([TOOLS_OPEN]), ...opDialog('dialog/multi', { dialogId: idOf(TOOLS_OPEN), optionIndexes: [1, 1] })],
  ['answer dialog multi | another dialog id is a 409', () => dialogSide([TOOLS_OPEN]), ...opDialog('dialog/multi', { dialogId: 'not-this-one', optionIndexes: [3, 1] })],
  ['answer dialog multi | success: the next screen back', () => dialogSide([TOOLS_OPEN, TOOLS_2_1, SIZES_OPEN]), ...opDialog('dialog/multi', { dialogId: idOf(TOOLS_OPEN), optionIndexes: [3, 1] })],
  ['answer dialog text | a bad body (no text is the plain dialog; text not a string)', () => dialogSide([SAME_LABELS_Q2]),
    (s) => post(s, `/api/sessions/${CHILD}/dialog/text`, { dialogId: idOf(SAME_LABELS_Q2), optionIndex: 3, text: 7 }),
    (s) => post(s, `/api/questions/session-${CHILD}/answer`, { kind: 'dialog', dialogId: idOf(SAME_LABELS_Q2), optionIndex: 3, text: 7 })],
  ['answer dialog text | bad-text is a 400', () => dialogSide([SAME_LABELS_Q2]), ...opDialog('dialog/text', { dialogId: idOf(SAME_LABELS_Q2), optionIndex: 3, text: '   ' })],
  ['answer dialog text | another dialog id is a 409', () => dialogSide([SAME_LABELS_Q2]), ...opDialog('dialog/text', { dialogId: 'not-this-one', optionIndex: 3, text: TEXT })],
  ['answer dialog text | success', () => dialogSide([SAME_LABELS_Q2, FOCUSED, TYPED]), ...opDialog('dialog/text', { dialogId: idOf(SAME_LABELS_Q2), optionIndex: 3, text: TEXT })],
  ['answer dialog | an unknown session', () => dialogSide([PERMISSION_PANE]), ...opDialog('dialog', { dialogId: idOf(PERMISSION_PANE), optionIndex: 1 }, 'project-a-nobody-here')],
  ['answer dialog | a bad body', () => dialogSide([PERMISSION_PANE]), ...opDialog('dialog', { dialogId: 7, optionIndex: 1 })],
  ['answer dialog | another dialog id: 409', () => dialogSide([PERMISSION_PANE]), ...opDialog('dialog', { dialogId: 'not-this-one', optionIndex: 1 })],
  ['answer dialog | success', () => dialogSide([PERMISSION_PANE]), ...opDialog('dialog', { dialogId: idOf(PERMISSION_PANE), optionIndex: 1 })],
  ['answer dialog | a held approval row is marked operator before the key', () => dialogSide([PERMISSION_PANE]),
    ...opDialog('dialog', { dialogId: 'not-this-one', optionIndex: 1 }), async (s) => {
      const res = await s.f.request(requestBody(ORDINARY));
      expect(res.statusCode).toBe(201);
      s.id = (res.json() as { id: number }).id;
    }],
  ['answer dialog | the marking throws: answered anyway', () => dialogSide([PERMISSION_PANE]), ...opDialog('dialog', { dialogId: idOf(PERMISSION_PANE), optionIndex: 1 }),
    (s) => { vi.spyOn(s.f.coord, 'markApprovalOperator').mockImplementation(() => { throw new Error('fixture: disk I/O error'); }); }],
  // The claimant's ask ruling: `POST /api/asks/:id/answer` and `POST /api/questions/ask-<n>/rule {kind:'ask'}`.
  ['rule ask | a bad body', askSide, ...ruleAsk({ ...P, optionIndexes: ['0'] })],
  ['rule ask | a stale uuid', askSide, ...ruleAsk({ fromId: PARENT, fromUuid: 'stale', optionIndexes: [0] })],
  ['rule ask | the store refuses the read', askSide, ...ruleAsk({ ...P, optionIndexes: [0] }),
    (s) => { vi.spyOn(s.f.coord, 'askById').mockReturnValueOnce({ ok: false, detail: 'fixture: the asks table is unreadable' } as never); }],
  ['rule ask | not the stored parent', askSide, ...ruleAsk({ fromId: CHILD2, fromUuid: uuidOf(CHILD2), optionIndexes: [0] })],
  ['rule ask | a row minted released', () => askSide({ releaseReason: 'parent-not-live' }), ...ruleAsk({ ...P, optionIndexes: [0] })],
  ['rule ask | another askKey', askSide, ...ruleAsk({ ...P, optionIndexes: [0], askKey: 'deadbeefdeadbeef' })],
  ['rule ask | the child unmeasurable', askSide, ...ruleAsk({ ...P, optionIndexes: [0] }),
    (s) => { rmSync(path.join(s.f.home, '.cc-sessions', `${CHILD}.hookstate.json`)); }],
  ['rule ask | the CAS lost: the ask moved', askSide, ...ruleAsk({ ...P, optionIndexes: [0] }), (s) => { hookstate(s.f, CHILD, s.now + 5); }],
  ['rule ask | the CAS lost: declined', askSide, ...ruleAsk({ ...P, optionIndexes: [0] }), (s) => { s.f.coord.declineAsk(s.id, Date.now()); }],
  ['rule ask | the press refused: the take rolled back', askSide, ...ruleAsk({ ...P, optionIndexes: [5] })],
  ['rule ask | success: pressed, recorded, settled', askSide, ...ruleAsk({ ...P, optionIndexes: [1], askKey: ASK_KEY })],
  ['rule ask | success after the lapse: the late answer', askSide, ...ruleAsk({ ...P, optionIndexes: [0] }),
    (s) => { expect(s.f.coord.releaseAsk(s.id, Date.now())).toBe(true); }],
  // The claimant's ask hand-over.
  ['release ask | a bad body', askSide, ...releaseAsk({ fromId: PARENT })],
  ['release ask | the store refuses the read', askSide, ...releaseAsk(P),
    (s) => { vi.spyOn(s.f.coord, 'askById').mockReturnValueOnce({ ok: false, detail: 'fixture: the asks table is unreadable' } as never); }],
  ['release ask | no such ask', askSide, ...releaseAsk(P, 99)],
  ['release ask | not the stored parent', askSide, ...releaseAsk({ fromId: CHILD2, fromUuid: uuidOf(CHILD2) })],
  ['release ask | not held', askSide, ...releaseAsk(P), (s) => { s.f.coord.declineAsk(s.id, Date.now()); }],
  ['release ask | success: declined, the door-in fires', askSide, ...releaseAsk(P)],
  // The claimant's approval ruling.
  ['rule approval | a widening field', approvalSide, ...ruleApproval({ ...RULE, permanent: true })],
  ['rule approval | a bad body', approvalSide, ...ruleApproval({ ...RULE, verdict: 'maybe' })],
  ['rule approval | a stale uuid', approvalSide, ...ruleApproval({ ...RULE, fromUuid: 'stale' })],
  ['rule approval | the store refuses the read', approvalSide, ...ruleApproval(RULE),
    (s) => { vi.spyOn(s.f.coord, 'approvalById').mockReturnValueOnce({ ok: false, detail: 'fixture: the approvals table is unreadable' } as never); }],
  ['rule approval | no such approval', approvalSide, ...ruleApproval(RULE, 99)],
  ['rule approval | the kill switch', approvalSide, ...ruleApproval(RULE),
    (s) => { writeFileSync(path.join(s.f.home, '.cc-sessions', 'approvals-disabled'), ''); }],
  ['rule approval | not the stored parent', approvalSide, ...ruleApproval({ ...RULE, fromId: CHILD2, fromUuid: uuidOf(CHILD2) })],
  ['rule approval | declined', approvalSide, ...ruleApproval(RULE), (s) => { s.f.coord.declineApproval(s.id, PARENT, Date.now()); }],
  ['rule approval | already ruled', approvalSide, ...ruleApproval(RULE), async (s) => { await s.f.rule(s.id, PARENT, 'deny'); }],
  ['rule approval | allowed: signed, stored, recorded', approvalSide, ...ruleApproval(RULE)],
  ['rule approval | denied: signed, stored, recorded', approvalSide, ...ruleApproval(DENY)],
  // (a row moves here from PAIRS in the commit that retires its door)
];

/** Each retired pair's OLD-door outcome, recorded on the base before the commit that retired the door (the operator's
 *  at `origin/main` `b99070116`, W7 C7p; the claimant's at `c49e0e583`, K5 Q3l, the old doors live), through this file's
 *  own `outcome`. */
const RETIRED_OUTCOMES: Readonly<Record<string, Outcome>> = {
  "answer ask | an unknown session":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-session\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer ask | no askKey":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer ask | optionIndexes not numbers":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer ask | nothing held: pressed, nothing recorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "feed": [], "pushes": []}},
  "answer ask | held and taken: answered by the operator":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": {"state": "answered", "answeredBy": "operator", "answer": "Blue"}, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "feed": ["question answered"], "pushes": []}},
  "answer ask | held, the press refused: rolled back":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"range\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer ask | the CAS lost: pressed, the row untouched":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "feed": [], "pushes": []}},
  "answer ask | the store refuses: pressed unrecorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "feed": [], "pushes": []}},
  "answer ask | the store throws: pressed unrecorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "feed": [], "pushes": []}},
  "answer ask | the take throws: pressed unrecorded":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "feed": [], "pushes": []}},
  "answer dialog multi | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog multi | bad-indexes is a 400":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-indexes\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog multi | another dialog id is a 409":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog multi | success: the next screen back":
    {"status": 200, "body": "sha256:05b4c2c9db0d95cfe1ffc97b1d14591aafb55d90788baec75d7cfbdafef72289", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin 3", "project-a-quiet-basin 1", "project-a-quiet-basin Tab"], "feed": [], "pushes": []}},
  "answer dialog text | a bad body (no text is the plain dialog; text not a string)":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog text | bad-text is a 400":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-text\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog text | another dialog id is a 409":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog text | success":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin Down", "project-a-quiet-basin Down", "project-a-quiet-basin -l - only in staging, sampled 10%", "project-a-quiet-basin Enter"], "feed": [], "pushes": []}},
  "answer dialog | an unknown session":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-session\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog | another dialog id: 409":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog | success":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin Enter"], "feed": [], "pushes": []}},
  "answer dialog | a held approval row is marked operator before the key":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"stale-dialog\"}", "effects": {"ask": null, "approval": {"state": "operator", "answeredBy": "operator", "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "answer dialog | the marking throws: answered anyway":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": null, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin Enter"], "feed": [], "pushes": []}},
  "rule ask | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, optionIndexes an array of numbers, askKey a string when given\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | a stale uuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry \u2014 stale sender; re-read your own .uuid\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | the store refuses the read":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"ask-unreadable\",\"detail\":\"fixture: the asks table is unreadable\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | not the stored parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only this child's derived parent may pre-empt its question\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | a row minted released":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"ask": {"state": "released", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | another askKey":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"ask-mismatch\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | the child unmeasurable":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"child-unmeasurable\",\"detail\":\"this box could not read the child's live state \u2014 nothing was pressed, and the ask is unchanged\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | the CAS lost: the ask moved":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"ask-moved\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | the CAS lost: declined":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"declined\"}", "effects": {"ask": {"state": "declined", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | the press refused: the take rolled back":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"range\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule ask | success: pressed, recorded, settled":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": {"state": "answered", "answeredBy": "project-a-calm-mesa", "answer": "Blue"}, "approval": null, "doorIns": [], "keys": ["project-a-quiet-basin 2"], "feed": ["question answered"], "pushes": []}},
  "rule ask | success after the lapse: the late answer":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": {"state": "answered", "answeredBy": "project-a-calm-mesa", "answer": "Red"}, "approval": null, "doorIns": ["answeredLate(\"project-a-quiet-basin\",1,\"project-a-calm-mesa\")"], "keys": ["project-a-quiet-basin 1"], "feed": ["question answered"], "pushes": []}},
  "release ask | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "release ask | the store refuses the read":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"ask-unreadable\",\"detail\":\"fixture: the asks table is unreadable\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "release ask | no such ask":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-ask\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "release ask | not the stored parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only this child's derived parent may decline its question\"}", "effects": {"ask": {"state": "held", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "release ask | not held":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"not-held\"}", "effects": {"ask": {"state": "declined", "answeredBy": null, "answer": null}, "approval": null, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "release ask | success: declined, the door-in fires":
    {"status": 200, "body": "{\"ok\":true}", "effects": {"ask": {"state": "declined", "answeredBy": null, "answer": null}, "approval": null, "doorIns": ["released(\"project-a-quiet-basin\")"], "keys": [], "feed": [], "pushes": []}},
  "rule approval | a widening field":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"a ruling allows once only; permanent is never accepted\"}", "effects": {"ask": null, "approval": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule approval | a bad body":
    {"status": 400, "body": "{\"ok\":false,\"error\":\"bad-request\",\"detail\":\"fromId/fromUuid strings, verdict allow or deny, and a reason of 1 to 1000 characters\"}", "effects": {"ask": null, "approval": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule approval | a stale uuid":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"stale-uuid\",\"detail\":\"fromUuid does not match the registry \u2014 stale sender; re-read your own .uuid\"}", "effects": {"ask": null, "approval": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule approval | the store refuses the read":
    {"status": 503, "body": "{\"ok\":false,\"error\":\"approval-unreadable\",\"detail\":\"fixture: the approvals table is unreadable\"}", "effects": {"ask": null, "approval": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule approval | no such approval":
    {"status": 404, "body": "{\"ok\":false,\"error\":\"unknown-approval\"}", "effects": {"ask": null, "approval": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule approval | the kill switch":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"approvals-disabled\"}", "effects": {"ask": null, "approval": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule approval | not the stored parent":
    {"status": 403, "body": "{\"ok\":false,\"error\":\"not-parent\",\"detail\":\"only the claimant this prompt was held for may rule on it\"}", "effects": {"ask": null, "approval": {"state": "held", "answeredBy": null, "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule approval | declined":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"declined\"}", "effects": {"ask": null, "approval": {"state": "declined", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": [], "keys": [], "feed": [], "pushes": []}},
  "rule approval | already ruled":
    {"status": 409, "body": "{\"ok\":false,\"error\":\"already-ruled\"}", "effects": {"ask": null, "approval": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"deny\")"], "keys": [], "feed": ["permission ruled"], "pushes": []}},
  "rule approval | allowed: signed, stored, recorded":
    {"status": 200, "body": "{\"ok\":true,\"state\":\"allowed\"}", "effects": {"ask": null, "approval": {"state": "allowed", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"allow\")"], "keys": [], "feed": ["permission ruled"], "pushes": []}},
  "rule approval | denied: signed, stored, recorded":
    {"status": 200, "body": "{\"ok\":true,\"state\":\"denied\"}", "effects": {"ask": null, "approval": {"state": "denied", "answeredBy": "project-a-calm-mesa", "releaseReason": null}, "doorIns": ["approvalRuled(\"project-a-quiet-basin\",\"\",\"project-a-calm-mesa\",\"deny\")"], "keys": [], "feed": ["permission ruled"], "pushes": []}},
  // (each row's old-door outcome, recorded on the base before the commit that retired its door)
};

/** What a side's effects read before any request: the old door's 404 must leave them exactly so. */
const effectsNow = (s: Side): Record<string, unknown> => outcome(s, { statusCode: 0, body: '' } as LightMyRequestResponse).effects;

describe('the new paths answer the old doors\' rows (W3 Q3f, D-7030)', () => {
  it('the pairs are uniquely named', () => {
    expect(new Set(PAIRS.map(([n]) => n)).size).toBe(PAIRS.length);
  });
  it.each(PAIRS.map((p) => [p[0], p] as const))('%s', async (_n, pair) => {
    const { old, nu } = await runPair(pair);
    expect(nu).toEqual(old);
  });
});

describe('a retired door is gone, and the new path answers its recorded rows (W7 C7p, D-7194; K5 Q3l, D-7324)', () => {
  it('every retired pair has its recorded outcome, and every recorded outcome a pair; no name is in both lists', () => {
    expect(Object.keys(RETIRED_OUTCOMES).sort()).toEqual(RETIRED_PAIRS.map(([n]) => n).sort());
    const live = new Set(PAIRS.map(([n]) => n));
    expect(RETIRED_PAIRS.map(([n]) => n).filter((n) => live.has(n))).toEqual([]);
  });
  it.each(RETIRED_PAIRS.map((p) => [p[0], p] as const))('%s', async (name, [, setup, old, nu, before]) => {
    const a = await setup();
    await before?.(a);
    // A row's `before` may arm a one-shot store read (`mockReturnValueOnce`) for the door's own read; a retired door
    // reads nothing, so the first read here would take it. Read once to spend it, then take the snapshot (K5 Q3l).
    effectsNow(a);
    const untouched = effectsNow(a);
    const gone = await old(a);
    expect(gone.statusCode, 'the retired door is not a route').toBe(404);
    expect(gone.json(), 'fastify\'s own not-found, never a door\'s word').toMatchObject({ error: 'Not Found', statusCode: 404 });
    expect(outcome(a, gone).effects, 'nothing moved').toEqual(untouched);
    KEYS = [];
    const b = await setup();
    await before?.(b);
    expect(outcome(b, await nu(b))).toEqual(RETIRED_OUTCOMES[name]);
  });
});

/** A server with no coordination store (the PWA's box before a coordination database exists). */
const noCoordApp = async (): Promise<FastifyInstance> => {
  const home = mkTmp('ccrc-question-doors-nocoord-');
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
  cleanup.push(async () => { await app.close(); });
  return app;
};

describe('with no coordination store', () => {
  // K5 Q3l (D-7324): a claimant alias is retired one per commit. Its row held the new path equal to it; a retired
  // one's now holds the old door gone (fastify's 404) and the new path equal to what the old door answered on the base,
  // recorded (the same bytes as `question-doors-pin`'s `no coordination store` rows): 501 `not-configured`.
  const NOT_CONFIGURED = '{"ok":false,"error":"not-configured"}';
  const RETIRED_CLAIMANT = new Set<string>(['/api/asks/1/answer', '/api/asks/1/release', '/api/approvals/1/rule']);
  it('the claimant\'s doors answer not-configured, as the old ones did', async () => {
    const app = await noCoordApp();
    for (const [old, nu, body] of [
      ['/api/asks/1/answer', '/api/questions/ask-1/rule', { kind: 'ask', ...P, optionIndexes: [0] }],
      ['/api/asks/1/release', '/api/questions/ask-1/release', { kind: 'ask', ...P }],
      ['/api/approvals/1/rule', '/api/questions/approval-1/rule', { kind: 'approval', ...RULE }],
      ['/api/approvals/1/release', '/api/questions/approval-1/release', { kind: 'approval', ...P }],
    ] as const) {
      const a = await app.inject({ method: 'POST', url: old, headers: TOK, payload: body });
      const b = await app.inject({ method: 'POST', url: nu, headers: TOK, payload: body });
      if (RETIRED_CLAIMANT.has(old)) {
        expect([a.statusCode, (a.json() as { error: unknown }).error], `${old} is not a route`).toEqual([404, 'Not Found']);
        expect([b.statusCode, b.body], nu).toEqual([501, NOT_CONFIGURED]);
      } else {
        expect([b.statusCode, b.body], nu).toEqual([a.statusCode, a.body]);
      }
      expect(b.statusCode).toBe(501);
    }
  });

  // W7 C7p (D-7194): `/ask` is retired. The row held the new path equal to it; it now holds the old door gone (404,
  // nothing pressed) and the new path equal to what `/ask` answered on the base, recorded (the same bytes as
  // `question-doors-pin`'s `no coord` row): 200 `{"ok":true}`, the single digit.
  it('the operator\'s answer presses plain, as `/ask` did', async () => {
    const app = await noCoordApp();
    const a = await app.inject({ method: 'POST', url: `/api/sessions/${CHILD}/ask`, payload: { askKey: ASK_KEY, optionIndexes: [1] } });
    expect([a.statusCode, KEYS], 'the retired door is not a route, and presses nothing').toEqual([404, []]);
    KEYS = [];
    const b = await app.inject({ method: 'POST', url: `/api/questions/session-${CHILD}/answer`, payload: { kind: 'ask', askKey: ASK_KEY, optionIndexes: [1] } });
    expect([b.statusCode, b.body, KEYS]).toEqual([200, '{"ok":true}', [`${CHILD} 2`]]);
  });
});

describe('the new family\'s own front ladder', () => {
  const ladder = async () => {
    const f = await family();
    return { f, post: (url: string, payload: unknown, headers: Record<string, string> = {}) => f.app.inject({ method: 'POST', url, headers, payload: payload as Record<string, unknown> }) };
  };

  it('the operator\'s door: a claimant\'s id is kind-mismatch, a bad id is bad-request, an unknown session is 404', async () => {
    const { post: p } = await ladder();
    for (const [url, status, body] of [
      ['/api/questions/ask-1/answer', 400, '{"ok":false,"error":"kind-mismatch"}'],
      ['/api/questions/approval-1/answer', 400, '{"ok":false,"error":"kind-mismatch"}'],
      ['/api/questions/ask-01/answer', 400, '{"ok":false,"error":"bad-request"}'],
      ['/api/questions/session-/answer', 400, '{"ok":false,"error":"bad-request"}'],
      ['/api/questions/question-1/answer', 400, '{"ok":false,"error":"bad-request"}'],
      ['/api/questions/session-project-a-nobody-here/answer', 404, '{"ok":false,"error":"unknown-session"}'],
    ] as const) {
      const res = await p(url, { kind: 'ask', askKey: ASK_KEY, optionIndexes: [0] });
      expect([res.statusCode, res.body], url).toEqual([status, body]);
    }
    expect(KEYS).toEqual([]);
  });

  it('the operator\'s door: a body matching no shape is bad-request, and nothing is pressed', async () => {
    const { post: p } = await ladder();
    const url = `/api/questions/session-${CHILD}/answer`;
    for (const body of [
      {}, { kind: 'approval', dialogId: 'd', optionIndex: 0 }, { kind: 'ask', optionIndexes: [0] },
      { kind: 'ask', askKey: ASK_KEY, optionIndexes: [true] }, { kind: 'dialog', dialogId: 'd' },
      { kind: 'dialog', dialogId: 7, optionIndex: 0 }, { kind: 'dialog', dialogId: 'd', optionIndex: 0, text: 7 },
      { kind: 'dialog', dialogId: 'd', optionIndexes: [0] }, { kind: 'dialog', dialogId: 'd', optionIndexes: ['0'], multi: true },
      { kind: 'dialog', dialogId: 'd', optionIndexes: [0], multi: 'yes' },
    ]) {
      const res = await p(url, body);
      expect([res.statusCode, res.body], JSON.stringify(body)).toEqual([400, '{"ok":false,"error":"bad-request"}']);
    }
    expect(KEYS).toEqual([]);
  });

  it('the claimant\'s doors: a body kind that disagrees with the id is kind-mismatch, after the token and attribution', async () => {
    const { f, post: p } = await ladder();
    for (const [url, body] of [
      ['/api/questions/ask-1/rule', { kind: 'approval', ...RULE }],
      ['/api/questions/approval-1/rule', { kind: 'ask', ...P, optionIndexes: [0] }],
      [`/api/questions/session-${CHILD}/rule`, { kind: 'ask', ...P, optionIndexes: [0] }],
      ['/api/questions/ask-1/release', { kind: 'approval', ...P }],
      ['/api/questions/approval-1/release', { kind: 'ask', ...P }],
      [`/api/questions/session-${CHILD}/release`, { kind: 'approval', ...P }],
    ] as const) {
      const res = await p(url, body, TOK);
      expect([res.statusCode, res.body], url).toEqual([400, '{"ok":false,"error":"kind-mismatch"}']);
    }
    // The token first, then attribution: neither request names the question it would mis-kind.
    expect((await p('/api/questions/ask-1/rule', { kind: 'approval', ...RULE })).statusCode).toBe(401);
    expect((await p('/api/questions/ask-1/rule', { kind: 'approval', ...RULE, fromUuid: 'stale' }, TOK)).statusCode).toBe(403);
    expect(KEYS).toEqual([]);
    expect(f.coord.feedEvents(50).filter((e) => e.title === 'permission ruled')).toEqual([]);
  });

  it('the claimant\'s doors: no box token is the old doors\' 401, naming the door that was called', async () => {
    const { f, post: p } = await ladder();
    for (const [url, route, body] of [
      ['/api/questions/ask-1/rule', 'POST /api/questions/:id/rule', { kind: 'ask', ...P, optionIndexes: [0] }],
      ['/api/questions/approval-1/rule', 'POST /api/questions/:id/rule', { kind: 'approval', ...RULE }],
      ['/api/questions/ask-1/release', 'POST /api/questions/:id/release', { kind: 'ask', ...P }],
      ['/api/questions/approval-1/release', 'POST /api/questions/:id/release', { kind: 'approval', ...P }],
    ] as const) {
      const res = await p(url, body);
      expect([res.statusCode, res.body], url).toEqual([401,
        `{"ok":false,"error":"unauthenticated","detail":"no box token presented — ${route} grants no legacy tolerance"}`]);
    }
    expect(KEYS).toEqual([]);
    expect(f.coord.feedEvents(50).filter((e) => e.title === 'permission ruled' || e.title === 'question answered')).toEqual([]);
  });

  it('the claimant\'s doors: a body with no kind, or a kind of neither, is bad-request; a bad id is bad-request', async () => {
    const { post: p } = await ladder();
    for (const [url, body] of [
      ['/api/questions/ask-1/rule', { ...P, optionIndexes: [0] }],
      ['/api/questions/ask-1/rule', { kind: 'dialog', ...P, optionIndexes: [0] }],
      ['/api/questions/ask-1/release', { ...P }],
      ['/api/questions/ask-01/rule', { kind: 'ask', ...P, optionIndexes: [0] }],
      ['/api/questions/ask-+1/release', { kind: 'ask', ...P }],
      ['/api/questions/approval-1.0/rule', { kind: 'approval', ...RULE }],
    ] as const) {
      const res = await p(url, body, TOK);
      expect(res.statusCode, url).toBe(400);
      expect((res.json() as { error: string }).error, url).toBe('bad-request');
    }
  });
});

// ── through an armed gate ───────────────────────────────────────────────────────────────────────────────────────

const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';
const stubPty = (): PtyLike => ({ onData: () => ({ dispose: () => {} }), write: () => {}, resize: () => {}, kill: () => {} });

const armedApp = async (): Promise<FastifyInstance> => {
  const home = mkTmp('ccrc-question-doors-armed-');
  mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'), `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
  const base = testDeps(home);
  const deps: Deps = {
    ...base, cfg: { ...base.cfg, authEnabled: true, cookieSecure: false }, mailToken: TOKEN, spawnPty: stubPty,
    coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))),
  };
  const a = await buildServer(deps);
  await a.ready();
  cleanup.push(async () => { await a.close(); });
  return a;
};
const login = async (a: FastifyInstance): Promise<string> => {
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
  const set = res.headers['set-cookie'];
  const line = Array.isArray(set) ? set[0]! : String(set);
  return line.slice(0, line.indexOf(';'));
};
const gateRefused = (res: LightMyRequestResponse): boolean =>
  res.statusCode === 401 && typeof (JSON.parse(res.body) as { verdict?: unknown }).verdict === 'string';

describe('the principals do not cross (Review focus 3)', () => {
  it('a box-token request to the operator\'s door is refused by the gate as an unauthenticated operator write', async () => {
    const a = await armedApp();
    const res = await a.inject({ method: 'POST', url: `/api/questions/session-${CHILD}/answer`, headers: TOK,
      payload: { kind: 'ask', askKey: ASK_KEY, optionIndexes: [0] } });
    expect(gateRefused(res)).toBe(true);
    expect(KEYS).toEqual([]);
  });

  it('a session request to the claimant\'s doors without the box token is 401, from the door and not the gate', async () => {
    const a = await armedApp();
    const cookie = await login(a);
    for (const [url, body] of [
      ['/api/questions/ask-1/rule', { kind: 'ask', ...P, optionIndexes: [0] }],
      ['/api/questions/approval-1/rule', { kind: 'approval', ...RULE }],
      ['/api/questions/ask-1/release', { kind: 'ask', ...P }],
      ['/api/questions/approval-1/release', { kind: 'approval', ...P }],
    ] as const) {
      const res = await a.inject({ method: 'POST', url, headers: { cookie }, payload: body });
      expect(res.statusCode, url).toBe(401);
      expect(gateRefused(res), url).toBe(false);
    }
  });

  it('a session request to the operator\'s door reaches it: an unknown session is 404', async () => {
    const a = await armedApp();
    const cookie = await login(a);
    const res = await a.inject({ method: 'POST', url: `/api/questions/session-${CHILD}/answer`, headers: { cookie },
      payload: { kind: 'ask', askKey: ASK_KEY, optionIndexes: [0] } });
    expect([res.statusCode, res.body]).toEqual([404, '{"ok":false,"error":"unknown-session"}']);
  });
});

// Skew (rule 1c): a client of the family gates on the word, and an older server, which has neither the word nor the
// routes, answers every `/api/questions/*` request 404 (the old doors' rows are Q3a's pin, unchanged).
describe('the questions-v1 cap word (W3 Q3f, D-7030)', () => {
  it('SERVER_CAPS advertises questions-v1, and GET /health carries it', async () => {
    expect(SERVER_CAPS).toContain('questions-v1');
    const f = await family();
    const res = await f.app.inject({ method: 'GET', url: '/health' });
    expect((res.json() as { caps: string[] }).caps).toContain('questions-v1');
  });
});
