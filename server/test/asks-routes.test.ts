// `POST /api/asks/:id/answer` — the parent presses the digit into its
// child's live menu (Task 9, the ask pre-emption lane). The most
// safety-sensitive route in the lane: box token, then registry attribution
// (the box token proves only "a process on this box", never "this ask's
// parent"), then `ask.parentId === fromId`, then the instance guard
// (D-2170) and the row-CAS (D-2171) — both BEFORE `answerAsk` ever touches
// the pane.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import type { Runner } from '../src/exec.js';
import { askKey } from '../src/askkey.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'f'.repeat(64);
const TOK = { 'x-ccrc-mail-token': TOKEN };

const CHILD = 'demo-quiet-mesa';
const PARENT = 'demo-coordinator';
const OTHER = 'demo-someone-else';
const CHILD_UUID = 'c'.repeat(36);
const PARENT_UUID = 'p'.repeat(36);
const OTHER_UUID = 'o'.repeat(36);

const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
// Non-null: a single-question envelope always has a key (askKey.ts's own
// contract — only an approval envelope or an empty questions array has none).
const ASK_KEY = askKey({ questions: [QUESTION] })!;
const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';

const seed = (home: string, id: string, uuid: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A fresh, waiting hookstate for the child, carrying `QUESTION` — the real
 *  wiring `freshAskAt` reads, not a stub (`routes.test.ts`'s `seedAsk` is the
 *  proven shape). `updatedAt` is the row this route re-measures against the
 *  stored `askAt` (D-2170). */
const seedHookstate = (home: string, id: string, uuid: string, updatedAt: number): void => {
  const reg = path.join(home, '.cc-sessions');
  writeFileSync(path.join(reg, `${id}.hookstate.json`), JSON.stringify({
    v: 1, state: 'waiting', event: 'Notification', sessionId: uuid, pid: 4242,
    updatedAt, ask: { questions: [QUESTION] }, subagents: [],
  }));
};

/** `capture-pane` answers the scripted pane (last repeats); every other tmux
 *  verb (`send-keys` included) succeeds with an empty stdout — the same
 *  shape `routes.test.ts`'s `makeApp` and `claims-routes.test.ts`'s
 *  `tmuxRunner` use. */
const tmuxRunner = (panes: (string | null)[]): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  let i = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(i, panes.length - 1)] ?? null;
      i++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

const sendKeysCalls = (calls: string[][]) => calls.filter((c) => c[1] === 'send-keys');

const openApp = async (home: string, run: Runner, over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const answer = (app: FastifyInstance, id: number, body: Record<string, unknown>,
                headers: Record<string, string> = TOK) =>
  app.inject({ method: 'POST', url: `/api/asks/${id}/answer`, headers, payload: body });

describe('POST /api/asks/:id/answer', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** Registry (child + parent + a third, unrelated session), a fresh
   *  waiting hookstate for the child at `now`, and an ask row minted
   *  against that exact `askAt` — the ordinary, non-moved case every test
   *  below starts from unless it deliberately diverges. */
  const setup = async (now: number, panes: (string | null)[] = [ASK_PANE]) => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seed(home, OTHER, OTHER_UUID);
    seedHookstate(home, CHILD, CHILD_UUID, now);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const { run, calls } = tmuxRunner(panes);
    const w = await openApp(home, run, { notifyLog });
    app = w.app;
    const id = w.coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });
    return { coord: w.coord, id, now, calls };
  };

  it('401s without the box token', async () => {
    const { id } = await setup(Date.now());
    const res = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] }, {});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });

  it('403s a caller that is not this ask\'s derived parent', async () => {
    const { id } = await setup(Date.now());
    const res = await answer(app!, id, { fromId: OTHER, fromUuid: OTHER_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ ok: false, error: 'not-parent',
      detail: 'only this child\'s derived parent may pre-empt its question' });
  });

  it('409s ask-moved when the child has repainted an identical question (D-2170)', async () => {
    const now = Date.now();
    // Minted against an EARLIER hookstate read (`askAt: now`); the child has
    // since repainted an identical question (`askKey` hashes content only),
    // so the LIVE hookstate now reads `now + 5000` — a different instance of
    // the same key, which `freshAskAt` must catch.
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seedHookstate(home, CHILD, CHILD_UUID, now + 5000);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const { run, calls } = tmuxRunner([ASK_PANE]);
    const w = await openApp(home, run, { notifyLog });
    app = w.app;
    const id = w.coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });

    const res = await answer(app, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'ask-moved' });
    // Fails shut BEFORE the keystroke — nothing was pressed into the pane.
    expect(sendKeysCalls(calls)).toEqual([]);
    expect(w.coord.askById(id)!.state).toBe('held');
  });

  /**
   * `freshAskAt`'s fail-shut arm (fix round 1, item 2): an UNREADABLE
   * hookstate — no `.hookstate.json` at all, distinct from the "moved" case
   * above, which has a real, fresher one — must refuse rather than proceed.
   * `freshAskAt` returns `-1` for this arm, which can never equal a stored
   * `askAt`, so it rides the SAME `ask-moved` mismatch `takeAskForAnswer`
   * already has — no new error code, just the fail-shut direction proven for
   * "unmeasurable", not only "measured and different".
   */
  it('409s ask-moved when the child\'s hookstate is unreadable (freshAskAt fail-shut)', async () => {
    const now = Date.now();
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    // Deliberately NOT seeding a hookstate file for the child — `readHookState`
    // reads a proven-absent file as `null`, `freshAskAt`'s third fail-shut arm.
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const { run, calls } = tmuxRunner([ASK_PANE]);
    const w = await openApp(home, run, { notifyLog });
    app = w.app;
    const id = w.coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });

    const res = await answer(app, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'ask-moved' });
    expect(sendKeysCalls(calls)).toEqual([]);
    expect(w.coord.askById(id)!.state).toBe('held');
  });

  it('409s not-held when a second principal is already answering (D-2171)', async () => {
    const { coord, id, now } = await setup(Date.now());
    const taken = coord.takeAskForAnswer(id, now);
    expect(taken.ok).toBe(true);

    const res = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-held' });
    expect(coord.askById(id)!.state).toBe('answering');
  });

  it('presses the digit and records a second event on success', async () => {
    const { coord, id, calls } = await setup(Date.now());
    const res = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    // Single-select: the digit alone, no Enter — answerAsk's own contract.
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${CHILD}`, '2']]);

    const row = coord.askById(id)!;
    expect(row.state).toBe('answered');
    expect(row.answeredBy).toBe(PARENT);
    expect(row.answer).toBe('Blue');

    // D-2172: a SECOND durable record, distinct from the mint-time one —
    // naming who answered and what they chose.
    const ev = coord.feedEvents(10).at(-1)!;
    expect(ev.kind).toBe('ask');
    expect(ev.sessionId).toBe(CHILD);
    expect(ev.body).toContain(PARENT);
    expect(ev.body).toContain('Blue');
  });

  /**
   * THE DEFECT THE BRIEF SHIPPED WITH: its rollback was `releaseAsk`, whose
   * CAS source is `'held'` — it can never reach a row `takeAskForAnswer`
   * already moved to `'answering'`, so `releaseAsk` returns `false` and
   * every refused press strands the row forever. `untakeAsk` (`'answering'`
   * -> `'held'`) is the correct rollback: every one of `answerAsk`'s guards
   * returns BEFORE its `sendKey` loop, so a refusal here means no digit was
   * pressed and the question is still live. This proves the row survives a
   * refused press and is still pre-emptible afterwards.
   */
  it('a refused press leaves the row held, not stranded in answering', async () => {
    const { coord, id, calls } = await setup(Date.now());
    // Out of range for a 2-option question (indices 0/1 only) — `answerAsk`
    // refuses `range` before it ever reads the pane, well before any
    // `sendKey`.
    const bad = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [5] });
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toEqual({ ok: false, error: 'range' });
    expect(sendKeysCalls(calls)).toEqual([]);

    // Not stranded in 'answering' — back to 'held', exactly what the CAS
    // needs to be pre-emptible again.
    expect(coord.askById(id)!.state).toBe('held');

    // And genuinely pre-emptible: a second, well-formed attempt succeeds.
    const good = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ ok: true });
    expect(coord.askById(id)!.state).toBe('answered');
  });
});
