// The digest's two routes (coordinator-first routing plan Task 17, spec §10, D-5300): `GET /api/digest?day=` reads any
// day's digest from the durable tables, and `POST /api/digest/correct` queues durable system mail from `operator` to
// the row's coordinator (kind `finding`, the subject naming the row, the text verbatim) and marks the row corrected.
// Both are session-gated when armed and carry no box token. The fixture is the approvals lane's (a fixture HOME, a
// real store, the real server); neutral ids only.
import { describe, it, expect, afterEach } from 'vitest';
import { approvalsFixture, CHILD, PARENT, type Approvals } from './approvalsHarness.js';
import { DIGEST_CORRECTION_MAX_CHARS, type DigestAnswer } from '../../shared/api.js';

let f: Approvals | undefined;
afterEach(async () => { if (f) await f.close(); f = undefined; });

const DAY = '2026-10-18';
const at = (min: number): number => Date.parse('2026-10-17T08:00:00Z') + min * 60_000;
let seq = 0;

function ask(fx: Approvals, t: number, parent = PARENT): number {
  seq += 1;
  return fx.coord.insertAsk({ childId: CHILD, parentId: parent, runId: null, askKey: `k${seq}`, askAt: t, dialogId: `d${seq}`,
    question: 'Which colour?', options: ['Red', 'Blue'], now: t });
}
function answer(fx: Approvals, id: number, by: string, t: number): void {
  const r = fx.coord.askById(id);
  if (!r.ok || r.ask === null) throw new Error('fixture');
  if (!fx.coord.takeAskForAnswer(id, r.ask.askAt).ok) throw new Error('fixture: take refused');
  fx.coord.settleAsk(id, by, 'Red', t);
}
function approval(fx: Approvals, t: number): number {
  seq += 1;
  return fx.coord.insertApproval({ childId: CHILD, parentId: PARENT, runId: null, digest: 'a'.repeat(64),
    nonce: String(seq).padStart(32, '0'), agentId: '', tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false,
    class: 'ordinary', askAt: t, notifyAt: t + 60_000 });
}

const mails = (fx: Approvals): { fromId: string; toId: string; kind: string; subject: string; body: string }[] =>
  fx.coord.db.prepare('SELECT m.fromId, d.toId, m.kind, m.subject, m.body FROM mail m JOIN mail_deliveries d ON d.mailId = m.id ORDER BY m.id')
    .all() as { fromId: string; toId: string; kind: string; subject: string; body: string }[];
const correct = (fx: Approvals, payload: unknown) => fx.app.inject({ method: 'POST', url: '/api/digest/correct', payload: payload as object });
const corrected = (fx: Approvals, table: 'asks' | 'approvals', id: number): number =>
  (fx.coord.db.prepare(`SELECT corrected FROM ${table} WHERE id = ?`).get(id) as { corrected: number }).corrected;

describe('GET /api/digest?day= (spec §10)', () => {
  it('answers the day\'s lines, totals and window, with sentAt null until the beat runs, then the beat\'s mark', async () => {
    f = await approvalsFixture();
    const q = ask(f, at(0));
    answer(f, q, PARENT, at(1));
    const a = approval(f, at(2));
    f.coord.takeApprovalForRule(a, { by: PARENT, verdict: 'deny', reason: 'outside the worktree', ruling: '{}', now: at(3) });
    const res = await f.app.inject({ method: 'GET', url: `/api/digest?day=${DAY}` });
    expect(res.statusCode).toBe(200);
    const d = res.json() as DigestAnswer;
    expect({ v: d.v, day: d.day, hourUtc: d.hourUtc, fromMs: d.fromMs, toMs: d.toMs, sentAt: d.sentAt, pushed: d.pushed }).toEqual({
      v: 1, day: DAY, hourUtc: 7, fromMs: Date.parse('2026-10-17T07:00:00Z'), toMs: Date.parse('2026-10-18T07:00:00Z'),
      sentAt: null, pushed: false,
    });
    expect(d.lines.map((l) => [l.rowKind, l.id, l.kind])).toEqual([['ask', q, 'answer'], ['approval', a, 'deny']]);
    expect(d.totals).toMatchObject({ decisions: 2, answers: 1, denies: 1 });
    f.watcher.sweepDigest(Date.parse('2026-10-18T07:00:30Z'));
    const after = (await f.app.inject({ method: 'GET', url: `/api/digest?day=${DAY}` })).json() as DigestAnswer;
    expect(after.sentAt).toBe(Date.parse('2026-10-18T07:00:30Z'));
    expect(after.pushed).toBe(true);
  });

  it('a day that is not a UTC date is 400 bad-request', async () => {
    f = await approvalsFixture();
    for (const bad of ['2026-13-01', 'yesterday', '2026-10-18%27']) {
      const res = await f.app.inject({ method: 'GET', url: `/api/digest?day=${bad}` });
      expect(res.statusCode, bad).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
  });

  it('no day reads the newest day whose window has closed', async () => {
    f = await approvalsFixture();
    const d = (await f.app.inject({ method: 'GET', url: '/api/digest' })).json() as DigestAnswer;
    expect(d.toMs).toBeLessThanOrEqual(Date.now());
    expect(d.toMs).toBeGreaterThan(Date.now() - 86_400_000);
  });
});

describe('POST /api/digest/correct (spec §10)', () => {
  it('queues one finding mail from operator to the coordinator, the text verbatim, and marks the ask corrected', async () => {
    f = await approvalsFixture();
    const q = ask(f, at(0));
    answer(f, q, PARENT, at(1));
    const text = "Blue was right: the child's branch is the release one.";
    const res = await correct(f, { rowKind: 'ask', id: q, text });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, mailId: expect.any(Number), deliveryId: expect.any(Number) });
    expect(mails(f)).toEqual([{ fromId: 'operator', toId: PARENT, kind: 'finding', subject: `Operator correction on ask ${q}`, body: text }]);
    expect(corrected(f, 'asks', q)).toBe(1);
    const d = (await f.app.inject({ method: 'GET', url: `/api/digest?day=${DAY}` })).json() as DigestAnswer;
    expect(d.lines[0]).toMatchObject({ id: q, corrected: true });
  });

  it('an approval\'s correction goes to its coordinator, never to the child, and marks the approval', async () => {
    f = await approvalsFixture();
    const a = approval(f, at(0));
    f.coord.takeApprovalForRule(a, { by: PARENT, verdict: 'allow', reason: 'inside the worktree', ruling: '{}', now: at(1) });
    const res = await correct(f, { rowKind: 'approval', id: a, text: 'Deny deletes outside build/ next time.' });
    expect(res.statusCode).toBe(200);
    expect(mails(f).map((m) => [m.toId, m.subject])).toEqual([[PARENT, `Operator correction on approval ${a}`]]);
    expect(mails(f).some((m) => m.toId === CHILD)).toBe(false);
    expect(corrected(f, 'approvals', a)).toBe(1);
  });

  it('a row the operator answered themselves is 409 not-coordinator, and nothing is mailed or marked', async () => {
    f = await approvalsFixture();
    const q = ask(f, at(0));
    answer(f, q, 'operator', at(1));
    const res = await correct(f, { rowKind: 'ask', id: q, text: 'No.' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-coordinator' });
    expect(mails(f)).toEqual([]);
    expect(corrected(f, 'asks', q)).toBe(0);
  });

  it('a second correction while the first is undelivered is 409 duplicate', async () => {
    f = await approvalsFixture();
    const q = ask(f, at(0));
    answer(f, q, PARENT, at(1));
    expect((await correct(f, { rowKind: 'ask', id: q, text: 'One.' })).statusCode).toBe(200);
    const again = await correct(f, { rowKind: 'ask', id: q, text: 'Two.' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ ok: false, error: 'duplicate' });
    expect(mails(f)).toHaveLength(1);
  });

  it('no such row is 404; a malformed body 400; an over-long text 413', async () => {
    f = await approvalsFixture();
    expect((await correct(f, { rowKind: 'ask', id: 999, text: 'x' })).json()).toEqual({ ok: false, error: 'unknown-ask' });
    expect((await correct(f, { rowKind: 'approval', id: 999, text: 'x' })).statusCode).toBe(404);
    for (const bad of [{}, { rowKind: 'run', id: 1, text: 'x' }, { rowKind: 'ask', id: '1', text: 'x' }, { rowKind: 'ask', id: 0, text: 'x' },
      { rowKind: 'ask', id: 1, text: '   ' }, { rowKind: 'ask', id: 1 }]) {
      expect((await correct(f, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    const long = await correct(f, { rowKind: 'ask', id: 1, text: 'x'.repeat(DIGEST_CORRECTION_MAX_CHARS + 1) });
    expect(long.statusCode).toBe(413);
    expect(mails(f)).toEqual([]);
  });
});
