// W3 Task Q3b's characterization pin (D-7026; ARCH-56 (#791), first PR; plan 2026-10-26-consolidation-w3-questions.md,
// Task Q3b Step 1). The question tables' READ side as each of today's readers answers it: the fleet frame's ask chip,
// `withCoordinator` and held-approval field (`fleet.ts#readCurrentAsks`, `#readHeldApprovals`), the digest's totals
// over a fixture day (`coord/digest.ts#buildDigest`), `correctDigestRow`'s answers, the drift lane's held-question rows
// (`coord/driftLane.ts`), and the bodies of `GET /api/asks` and `GET /api/approvals/:id`. Every reader is also driven
// over a store that REFUSES (`{ok:false, detail}`) and one that THROWS, and each keeps its own direction: the fleet
// degrades the whole frame and warns its sentence, the digest and the correction refuse, the drift lane records
// nothing and warns, a route answers its refusal, and a throw still reaches the caller that catches it today.
//
// This file is green on the code before the move and runs UNEDITED through every Q3b move commit (each changes only
// imports); Q3b's mutation table turns rows here red.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { buildDigest, correctDigestRow, digestWindow, DIGEST_HOUR_UTC } from '../src/coord/digest.js';
import { runDriftPass, type DriftLaneDeps } from '../src/coord/driftLane.js';
import type { NoticeRecord } from '../src/notice.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster } from './helpers.js';
import { approvalsFixture, PARENT as FX_PARENT, CHILD as FX_CHILD, TOK, uuidOf, type Approvals } from './approvalsHarness.js';

const CHILD = 'project-a-quiet-basin';
const CHILD2 = 'project-a-still-cove';
const PARENT = 'project-a-calm-mesa';
const PARENT2 = 'project-b-far-ridge';

afterEach(() => { vi.restoreAllMocks(); });

const mkCoord = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-q3b-pin-'), '.ccrc', 'coord.db')));
/** `store` with `overrides` laid over it: every other method is the real store's. */
const over = (store: CoordStore, overrides: Record<string, () => unknown>): CoordStore =>
  Object.assign(Object.create(store) as CoordStore, overrides);
const refuses = (): { ok: false; detail: string } => ({ ok: false, detail: 'the fixture store refuses' });
const throws = (): never => { throw new Error('the fixture store throws'); };

// ── the fleet frame ──────────────────────────────────────────────────────────────────────────────────────────────

describe('the fleet frame reads the question tables (fleet.ts#readCurrentAsks, #readHeldApprovals)', () => {
  const dead = new Tmux(async () => ({ ran: true, code: 1, stdout: '', stderr: '' }));
  const NOW_S = 1784600000;
  const NOW_MS = NOW_S * 1000;
  const seedSession = (home: string, id: string): void => {
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields = { wrapper: 'claude', project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
    for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
  };
  const mint = (coord: CoordStore, at: number, childId = CHILD): number => coord.insertAsk({
    childId, parentId: PARENT, runId: null, askKey: `k-${childId}-${at}`, askAt: 1000, dialogId: `d-${childId}-${at}`,
    question: 'q', options: ['a', 'b'], now: at,
  });
  const mintApproval = (coord: CoordStore, askAt: number, childId = CHILD): number => coord.insertApproval({
    childId, parentId: PARENT, runId: null, digest: 'd'.repeat(64), nonce: `${childId}`.padEnd(32, 'e').slice(0, 32),
    agentId: '', tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'ordinary', askAt, notifyAt: askAt + 60_000,
  });
  const frame = async (coord: CoordStore | undefined) => {
    const home = mkTmp('ccrc-q3b-fleet-');
    seedRoster(home);
    for (const id of [CHILD, CHILD2, PARENT]) seedSession(home, id);
    const fleet = await assembleFleet(
      localIO, loadConfig({ CCRC_HOME: home }), dead, NOW_S,
      undefined, undefined, undefined, undefined, undefined, undefined, coord,
    );
    return [CHILD, CHILD2, PARENT].map((id) => {
      const r = fleet.find((x) => x.id === id)!;
      return { id, ask: r.ask, withCoordinator: r.withCoordinator };
    });
  };
  /** CHILD: a held ask (chip held, with-coordinator question). CHILD2: an answered ask and a held approval (chip
   *  answered, with-coordinator approval). PARENT: nothing. */
  const seeded = (): CoordStore => {
    const coord = mkCoord();
    mint(coord, NOW_MS - 10_000);
    const id2 = mint(coord, NOW_MS - 20_000, CHILD2);
    expect(coord.takeAskForAnswer(id2, 1000).ok).toBe(true);
    coord.settleAsk(id2, PARENT, 'a', NOW_MS - 5000);
    mintApproval(coord, NOW_MS - 4000, CHILD2);
    return coord;
  };
  const DEGRADED = [
    { id: CHILD, ask: null, withCoordinator: null },
    { id: CHILD2, ask: null, withCoordinator: null },
    { id: PARENT, ask: null, withCoordinator: null },
  ];

  it('the ask chip states, withCoordinator and the held-approval field, per row', async () => {
    expect(await frame(seeded())).toEqual([
      { id: CHILD, ask: { state: 'held', parentId: PARENT, answeredBy: null },
        withCoordinator: { kind: 'question', parentId: PARENT, since: NOW_MS - 10_000, notifyAt: NOW_MS - 10_000 + 180_000 } },
      { id: CHILD2, ask: { state: 'answered', parentId: PARENT, answeredBy: PARENT },
        withCoordinator: { kind: 'approval', parentId: PARENT, since: NOW_MS - 4000, notifyAt: NOW_MS - 4000 + 60_000 } },
      { id: PARENT, ask: null, withCoordinator: null },
    ]);
  });

  it('no store, and an empty store, give no chip and no field on any row', async () => {
    expect(await frame(undefined)).toEqual(DEGRADED);
    expect(await frame(mkCoord())).toEqual(DEGRADED);
  });

  it('a broken store degrades every row: an ask read that refuses, then one that throws, each warned once in its sentence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = seeded();
    const refusing = await frame(over(coord, { currentAsksFor: refuses }));
    expect(refusing.map((r) => r.ask)).toEqual([null, null, null]);
    // The approval source still reads: CHILD2's held approval keeps its field.
    expect(refusing.map((r) => r.withCoordinator?.kind ?? null)).toEqual([null, 'approval', null]);
    const throwing = await frame(over(coord, { currentAsksFor: throws }));
    expect(throwing.map((r) => r.ask)).toEqual([null, null, null]);
    expect(throwing.map((r) => r.withCoordinator?.kind ?? null)).toEqual([null, 'approval', null]);
    const lines = warn.mock.calls.map(([l]) => String(l)).filter((l) => l.includes('currentAsksFor'));
    expect(lines).toEqual([
      'ccrc-server: currentAsksFor refused for 3 session(s) — the fixture store refuses — one bad read must not kill the poll',
      `ccrc-server: currentAsksFor failed for 3 session(s) (${PARENT}, ${CHILD}, ${CHILD2}) — the fixture store throws — one bad read must not kill the poll`,
    ]);
  });

  it('a broken store degrades every row: a held-approval read that refuses, then one that throws, each warned once in its sentence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const coord = seeded();
    for (const broken of [over(coord, { heldApprovalsFor: refuses }), over(coord, { heldApprovalsFor: throws })]) {
      const rows = await frame(broken);
      // The ask source still reads: CHILD's question keeps its field, CHILD2's approval field is gone.
      expect(rows.map((r) => r.ask?.state ?? null)).toEqual(['held', 'answered', null]);
      expect(rows.map((r) => r.withCoordinator?.kind ?? null)).toEqual(['question', null, null]);
    }
    const lines = warn.mock.calls.map(([l]) => String(l)).filter((l) => l.includes('heldApprovalsFor'));
    expect(lines).toEqual([
      'ccrc-server: heldApprovalsFor refused — the fixture store refuses — one bad read must not kill the poll',
      'ccrc-server: heldApprovalsFor failed — the fixture store throws — one bad read must not kill the poll',
    ]);
  });

  it('both reads broken at once: the whole frame has no chip and no field', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await frame(over(seeded(), { currentAsksFor: refuses, heldApprovalsFor: throws }))).toEqual(DEGRADED);
  });
});

// ── the digest ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('the digest reads the question tables (coord/digest.ts#buildDigest, #correctDigestRow)', () => {
  const DAY = '2026-10-18';
  const T0 = Date.parse('2026-10-17T08:00:00Z');
  const at = (min: number): number => T0 + min * 60_000;
  let seq = 0;
  const ask = (coord: CoordStore, t: number, parent = PARENT, child = CHILD): number => {
    seq += 1;
    return coord.insertAsk({ childId: child, parentId: parent, runId: null, askKey: `k${seq}`, askAt: t, dialogId: `d${seq}`,
      question: `Which colour, ${seq}?`, options: ['Red', 'Blue'], now: t });
  };
  const answer = (coord: CoordStore, id: number, by: string, t: number): void => {
    const r = coord.askById(id);
    if (!r.ok || r.ask === null) throw new Error('fixture: the ask must read back');
    if (!coord.takeAskForAnswer(id, r.ask.askAt).ok) throw new Error('fixture: the take was refused');
    coord.settleAsk(id, by, 'Red', t);
  };
  const approval = (coord: CoordStore, t: number, cls = 'ordinary', releaseReason?: 'forbidden'): number => {
    seq += 1;
    return coord.insertApproval({ childId: CHILD, parentId: PARENT, runId: null, digest: 'a'.repeat(64),
      nonce: String(seq).padStart(32, '0'), agentId: '', tool: 'Bash', inputRedacted: `rm -rf build-${seq}`, truncated: false,
      class: cls, askAt: t, notifyAt: t + 60_000, ...(releaseReason ? { releaseReason } : {}) });
  };
  const rule = (coord: CoordStore, id: number, verdict: 'allow' | 'deny', t: number): void => {
    const r = coord.takeApprovalForRule(id, { by: PARENT, verdict, reason: `${verdict}: inside the worktree`, ruling: '{}', now: t });
    if (!r.ok) throw new Error(`fixture: the rule was refused (${r.why})`);
  };
  /** The fixture day: two answers, an allow, a deny, a hand-over and a lapse; around them the operator's own answer,
   *  a forbidden request (the guard's) and an answer outside the window. */
  const seedDay = (coord: CoordStore) => {
    const a1 = ask(coord, at(0));
    answer(coord, a1, PARENT, at(1));
    const allow = approval(coord, at(2));
    rule(coord, allow, 'allow', at(3));
    const a2 = ask(coord, at(4), PARENT2, CHILD2);
    answer(coord, a2, PARENT2, at(5));
    const deny = approval(coord, at(6), 'escalate');
    rule(coord, deny, 'deny', at(7));
    const hand = ask(coord, at(8));
    coord.declineAsk(hand, at(9));
    const lapse = approval(coord, at(10));
    coord.lapseApproval(lapse);
    const mine = ask(coord, at(20));
    answer(coord, mine, 'operator', at(21));
    approval(coord, at(23), 'forbidden', 'forbidden');
    const early = ask(coord, T0 - 3 * 3_600_000);
    answer(coord, early, PARENT, T0 - 2 * 3_600_000);
    return { a1, allow, a2, deny, hand, lapse, mine, early };
  };
  const w = digestWindow(DAY, DIGEST_HOUR_UTC);

  it("the digest's totals, lines and coordinators over the fixture day", () => {
    const coord = mkCoord();
    const ids = seedDay(coord);
    const built = buildDigest(coord, w.fromMs, w.toMs);
    if (!built.ok) throw new Error(built.detail);
    expect(built.digest.totals).toEqual({ decisions: 6, answers: 2, allows: 1, denies: 1, handOvers: 1, lapses: 1, guardForbidden: 1 });
    expect(built.digest.byCoordinator).toEqual([{ coordinator: PARENT, decisions: 5 }, { coordinator: PARENT2, decisions: 1 }]);
    expect(built.digest.lines.map((l) => [l.rowKind, l.id, l.kind, l.coordinator, l.at])).toEqual([
      ['ask', ids.a1, 'answer', PARENT, at(1)],
      ['approval', ids.allow, 'allow', PARENT, at(3)],
      ['ask', ids.a2, 'answer', PARENT2, at(5)],
      ['approval', ids.deny, 'deny', PARENT, at(7)],
      ['ask', ids.hand, 'hand-over', PARENT, at(9)],
      ['approval', ids.lapse, 'lapse', PARENT, at(10) + 60_000],
    ]);
  });

  it('an ask read that refuses is the refusal; an approval read that refuses is the refusal; a throw throws', () => {
    const coord = mkCoord();
    seedDay(coord);
    expect(buildDigest(over(coord, { digestAsks: refuses }), w.fromMs, w.toMs)).toEqual(refuses());
    expect(buildDigest(over(coord, { digestApprovals: refuses }), w.fromMs, w.toMs)).toEqual(refuses());
    // The ask read goes first: a refusing ask read is answered without reading the approvals.
    let approvalsRead = 0;
    expect(buildDigest(over(coord, { digestAsks: refuses, digestApprovals: () => { approvalsRead += 1; return refuses(); } }), w.fromMs, w.toMs))
      .toEqual(refuses());
    expect(approvalsRead).toBe(0);
    expect(() => buildDigest(over(coord, { digestAsks: throws }), w.fromMs, w.toMs)).toThrow('the fixture store throws');
    expect(() => buildDigest(over(coord, { digestApprovals: throws }), w.fromMs, w.toMs)).toThrow('the fixture store throws');
  });

  it("correctDigestRow: an ask line and an approval line mail the row's coordinator; an unknown id; an unreadable store", () => {
    const coord = mkCoord();
    const ids = seedDay(coord);
    const a = correctDigestRow(coord, { rowKind: 'ask', id: ids.a2, text: 'that was the wrong colour' });
    expect(a).toMatchObject({ ok: true, to: PARENT2 });
    const p = correctDigestRow(coord, { rowKind: 'approval', id: ids.deny, text: 'that was fine to allow' });
    expect(p).toMatchObject({ ok: true, to: PARENT });
    expect(correctDigestRow(coord, { rowKind: 'ask', id: ids.a2, text: 'again' })).toEqual({ ok: false, why: 'duplicate' });
    expect(correctDigestRow(coord, { rowKind: 'ask', id: ids.mine, text: 'x' })).toEqual({ ok: false, why: 'not-coordinator' });
    expect(correctDigestRow(coord, { rowKind: 'ask', id: 99_999, text: 'x' })).toEqual({ ok: false, why: 'unknown-ask' });
    expect(correctDigestRow(coord, { rowKind: 'approval', id: 99_999, text: 'x' })).toEqual({ ok: false, why: 'unknown-approval' });
    expect(correctDigestRow(over(coord, { askForCorrection: refuses }), { rowKind: 'ask', id: ids.a1, text: 'x' }))
      .toEqual({ ok: false, why: 'digest-unreadable' });
    expect(correctDigestRow(over(coord, { approvalById: refuses }), { rowKind: 'approval', id: ids.allow, text: 'x' }))
      .toEqual({ ok: false, why: 'digest-unreadable' });
    expect(() => correctDigestRow(over(coord, { askForCorrection: throws }), { rowKind: 'ask', id: ids.a1, text: 'x' }))
      .toThrow('the fixture store throws');
    expect(() => correctDigestRow(over(coord, { approvalById: throws }), { rowKind: 'approval', id: ids.allow, text: 'x' }))
      .toThrow('the fixture store throws');
  });
});

// ── the drift lane ───────────────────────────────────────────────────────────────────────────────────────────────

describe("the drift lane reads the held questions (coord/driftLane.ts's pass)", () => {
  const H = 3_600_000;
  const DAY = 24 * H;
  const T0 = Date.now() + 200 * DAY;
  const rig = () => {
    const coord = mkCoord();
    const warns: string[] = [];
    const sent: NoticeRecord[] = [];
    const deps = (store: CoordStore): DriftLaneDeps => ({
      coord: store, names: [], childMarks: null, measure: () => Promise.resolve({ state: 'alive', why: 'pane live' }),
      notice: (event) => { sent.push(event); return { recorded: true, archived: 'none' }; },
      warn: (l) => { warns.push(l); },
    });
    coord.db.prepare("INSERT INTO asks (at, childId, parentId, askKey, askAt, dialogId, question, options, state) VALUES (?, 'worker-1', 'coord-a', 'k', 1, 'd', 'q', '[]', 'held')")
      .run(T0 - 3 * DAY);
    const kinds = (): string[] => {
      const r = coord.driftFindingRows();
      if (!r.ok) throw new Error(r.detail);
      return r.rows.map((x) => x.kind);
    };
    return { coord, warns, sent, deps, kinds };
  };

  it('a held question past its margin is a question-orphaned row', async () => {
    const r = rig();
    await runDriftPass(r.deps(r.coord), T0);
    expect(r.kinds()).toEqual(['question-orphaned']);
    expect(r.warns).toEqual([]);
  });

  it('a held-question read that refuses records nothing and warns the detail; one that throws records nothing and warns it', async () => {
    const r = rig();
    await runDriftPass(r.deps(over(r.coord, { driftHeldQuestions: refuses })), T0);
    await runDriftPass(r.deps(over(r.coord, { driftHeldQuestions: throws })), T0);
    expect(r.kinds()).toEqual([]);
    expect(r.warns).toEqual([
      'ccrc-server: sweepDrift could not read the coordination store (the fixture store refuses) — nothing recorded this pass',
      'ccrc-server: sweepDrift: the fixture store throws — nothing recorded this pass',
    ]);
  });
});

// ── the two GET routes ───────────────────────────────────────────────────────────────────────────────────────────

describe('GET /api/asks and GET /api/approvals/:id read the question tables (coord/routes.ts)', () => {
  let f: Approvals | undefined;
  afterEach(async () => { if (f) await f.close(); f = undefined; });
  const fixture = async (): Promise<Approvals> => {
    f = await approvalsFixture();
    f.seed(FX_PARENT, 'project-a');
    f.seed(FX_CHILD, 'project-a');
    return f;
  };
  const asks = (fx: Approvals) => fx.app.inject({ method: 'GET', url: `/api/asks?parent=${FX_PARENT}&fromUuid=${uuidOf(FX_PARENT)}`, headers: TOK });
  const approvalGet = (fx: Approvals, id: number) => fx.app.inject({
    method: 'GET', url: `/api/approvals/${id}?fromId=${FX_PARENT}&fromUuid=${uuidOf(FX_PARENT)}`, headers: TOK,
  });
  const mintAsk = (fx: Approvals): number => fx.coord.insertAsk({ childId: FX_CHILD, parentId: FX_PARENT, runId: null, askKey: 'k1',
    askAt: 1000, dialogId: 'd1', question: 'Which colour?', options: ['Red', 'Blue'], now: 5000 });
  const mintApproval = (fx: Approvals): number => fx.coord.insertApproval({ childId: FX_CHILD, parentId: FX_PARENT, runId: null,
    digest: 'a'.repeat(64), nonce: '0'.repeat(32), agentId: '', tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false,
    class: 'ordinary', askAt: 7000, notifyAt: 67_000 });

  it("GET /api/asks: the parent's rows; a refusing read is 503 ask-unreadable with its detail; a throwing one is a 500", async () => {
    const fx = await fixture();
    const id = mintAsk(fx);
    const ok = await asks(fx);
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { ok: boolean; asks: { id: number; childId: string; parentId: string; state: string; question: string }[] };
    expect(body.ok).toBe(true);
    expect(body.asks.map((a) => ({ id: a.id, childId: a.childId, parentId: a.parentId, state: a.state, question: a.question })))
      .toEqual([{ id, childId: FX_CHILD, parentId: FX_PARENT, state: 'held', question: 'Which colour?' }]);
    const real = fx.coord.asksForParent.bind(fx.coord);
    fx.coord.asksForParent = refuses as never;
    const refused = await asks(fx);
    expect({ status: refused.statusCode, body: refused.json() as unknown })
      .toEqual({ status: 503, body: { ok: false, error: 'ask-unreadable', detail: 'the fixture store refuses' } });
    fx.coord.asksForParent = throws as never;
    const thrown = await asks(fx);
    expect(thrown.statusCode).toBe(500);
    fx.coord.asksForParent = real;
  });

  it('GET /api/approvals/:id: the row as a view; a refusing read is approval-unreadable; a throwing one is a 500', async () => {
    const fx = await fixture();
    const id = mintApproval(fx);
    const ok = await approvalGet(fx, id);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, approval: {
      id, childId: FX_CHILD, parentId: FX_PARENT, runId: null, agentId: '', tool: 'Bash', input: 'rm -rf build', truncated: false,
      class: 'ordinary', state: 'held', releaseReason: null, askAt: 7000, notifyAt: 67_000, ruledAt: null, verdict: null,
      reason: null, answeredBy: null, toolUseId: null,
    } });
    const unknown = await approvalGet(fx, id + 1);
    expect(unknown.statusCode).toBe(404);
    const real = fx.coord.approvalById.bind(fx.coord);
    fx.coord.approvalById = refuses as never;
    const refused = await approvalGet(fx, id);
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toMatchObject({ ok: false, error: 'approval-unreadable', detail: 'the fixture store refuses' });
    fx.coord.approvalById = throws as never;
    const thrown = await approvalGet(fx, id);
    expect(thrown.statusCode).toBe(500);
    fx.coord.approvalById = real;
  });
});
