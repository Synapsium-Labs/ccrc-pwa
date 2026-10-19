// The daily digest (coordinator-first routing plan Task 17, spec §10, D-5300, D-5492): `buildDigest` over the durable
// `asks` and `approvals` tables, the digest hour and its override, and the once-a-day beat in `FleetWatcher`
// (`sweepDigest`): one `coord` push recorded in the feed, idempotent through the `digests` row, none at zero.
// Neutral ids only (the plan's Global constraints); a fixture HOME, a real `CoordStore`, a stubbed tmux.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import type { Runner } from '../src/exec.js';
import type { PushPayload } from '../src/push.js';
import {
  approvalDecision, askDecision, buildDigest, DIGEST_HOUR_UTC, digestDayFor, digestWindow, parseDigestDay,
  readDigestHour,
} from '../src/coord/digest.js';
import { DIGEST_HOUR_FILE } from '../../shared/api.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PARENT = 'project-a-calm-mesa';
const PARENT2 = 'project-b-far-ridge';
const CHILD = 'project-a-quiet-basin';
const CHILD2 = 'project-a-still-cove';
const TOKEN_HEX = '0123456789abcdef0123456789abcdef';
const BEARER = `curl -H 'Authorization: Bearer ${TOKEN_HEX}' https://example.invalid/x`;

/** The day the fixtures' decisions fall in: its digest window is 07:00 UTC the day before to 07:00 UTC on it. */
const DAY = '2026-10-18';
const T0 = Date.parse('2026-10-17T08:00:00Z');
const at = (min: number): number => T0 + min * 60_000;

function store(): { coord: CoordStore; home: string } {
  const home = mkTmp('ccrc-digest-');
  return { coord: new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))), home };
}

let seq = 0;
/** A question held for `parent`, minted at `t`. */
function ask(coord: CoordStore, o: { parent?: string; child?: string; t: number; question?: string; releaseReason?: 'parent-not-live' }): number {
  seq += 1;
  return coord.insertAsk({
    childId: o.child ?? CHILD, parentId: o.parent ?? PARENT, runId: null, askKey: `k${seq}`, askAt: o.t,
    dialogId: `d${seq}`, question: o.question ?? `Which colour, ${seq}?`, options: ['Red', 'Blue'], now: o.t,
    ...(o.releaseReason ? { releaseReason: o.releaseReason } : {}),
  });
}
function answerAsk(coord: CoordStore, id: number, by: string, label: string, t: number): void {
  const r = coord.askById(id);
  if (!r.ok || r.ask === null) throw new Error('fixture: the ask must read back');
  const take = coord.takeAskForAnswer(id, r.ask.askAt);
  if (!take.ok) throw new Error(`fixture: the take was refused (${take.why})`);
  coord.settleAsk(id, by, label, t);
}
/** An approval held for `parent` (or minted released with `releaseReason`), minted at `t`, window 60 s. */
function approval(coord: CoordStore, o: { parent?: string; t: number; input?: string; cls?: string; releaseReason?: 'forbidden' }): number {
  seq += 1;
  return coord.insertApproval({
    childId: CHILD, parentId: o.parent ?? PARENT, runId: null, digest: 'a'.repeat(64), nonce: String(seq).padStart(32, '0'),
    agentId: '', tool: 'Bash', inputRedacted: o.input ?? `rm -rf build-${seq}`, truncated: false, class: o.cls ?? 'ordinary',
    askAt: o.t, notifyAt: o.t + 60_000, ...(o.releaseReason ? { releaseReason: o.releaseReason } : {}),
  });
}
function rule(coord: CoordStore, id: number, verdict: 'allow' | 'deny', t: number, by = PARENT): void {
  const r = coord.takeApprovalForRule(id, { by, verdict, reason: `${verdict}: inside the worktree`, ruling: '{}', now: t });
  if (!r.ok) throw new Error(`fixture: the rule was refused (${r.why})`);
}

/** The plan's Step 1 day: two parent answers, one allow, one deny, one hand-over and one lapse — and, around them,
 *  the rows that are no coordinator's decision: the operator's own answer while held, a question minted released, a
 *  forbidden request (counted as the guard's), and a decision outside the window. */
function seedDay(coord: CoordStore): Record<string, number> {
  const a1 = ask(coord, { t: at(0) });
  answerAsk(coord, a1, PARENT, 'Red', at(1));
  const allow = approval(coord, { t: at(2) });
  rule(coord, allow, 'allow', at(3));
  const a2 = ask(coord, { t: at(4), parent: PARENT2, child: CHILD2 });
  answerAsk(coord, a2, PARENT2, 'Blue', at(5));
  const deny = approval(coord, { t: at(6), cls: 'escalate' });
  rule(coord, deny, 'deny', at(7));
  const hand = ask(coord, { t: at(8) });
  coord.declineAsk(hand, at(9));
  const lapse = approval(coord, { t: at(10) });
  coord.lapseApproval(lapse);
  // Not lines:
  const mine = ask(coord, { t: at(20) });
  answerAsk(coord, mine, 'operator', 'Red', at(21));
  ask(coord, { t: at(22), releaseReason: 'parent-not-live' });
  approval(coord, { t: at(23), releaseReason: 'forbidden', cls: 'forbidden' });
  const early = ask(coord, { t: T0 - 3 * 3_600_000 });
  answerAsk(coord, early, PARENT, 'Red', T0 - 2 * 3_600_000);
  return { a1, allow, a2, deny, hand, lapse, mine, early };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('buildDigest (spec §10)', () => {
  it('builds the six decisions in time order with the totals, and leaves out what no coordinator decided', () => {
    const { coord } = store();
    const ids = seedDay(coord);
    const w = digestWindow(DAY, DIGEST_HOUR_UTC);
    expect(w).toEqual({ fromMs: Date.parse('2026-10-17T07:00:00Z'), toMs: Date.parse('2026-10-18T07:00:00Z') });
    const built = buildDigest(coord, w.fromMs, w.toMs);
    if (!built.ok) throw new Error(built.detail);
    const d = built.digest;
    expect(d.lines.map((l) => [l.rowKind, l.id, l.kind, l.coordinator])).toEqual([
      ['ask', ids.a1, 'answer', PARENT],
      ['approval', ids.allow, 'allow', PARENT],
      ['ask', ids.a2, 'answer', PARENT2],
      ['approval', ids.deny, 'deny', PARENT],
      ['ask', ids.hand, 'hand-over', PARENT],
      ['approval', ids.lapse, 'lapse', PARENT],
    ]);
    expect(d.lines.map((l) => l.at)).toEqual([at(1), at(3), at(5), at(7), at(9), at(10) + 60_000]);
    expect(d.totals).toEqual({ decisions: 6, answers: 2, allows: 1, denies: 1, handOvers: 1, lapses: 1, guardForbidden: 1 });
    expect(d.byCoordinator).toEqual([{ coordinator: PARENT, decisions: 5 }, { coordinator: PARENT2, decisions: 1 }]);
    const allowLine = d.lines[1]!;
    expect(allowLine).toMatchObject({ tool: 'Bash', class: 'ordinary', reason: 'allow: inside the worktree', answer: null, corrected: false });
    expect(d.lines[0]).toMatchObject({ answer: 'Red', tool: null, class: null });
  });

  it('a question answered by its coordinator after the lapse is the coordinator\'s answer; the operator\'s after a lapse is a lapse', () => {
    const { coord } = store();
    const late = ask(coord, { t: at(0) });
    coord.releaseAsk(late, at(3));
    answerAsk(coord, late, PARENT, 'Blue', at(5));
    const op = ask(coord, { t: at(10) });
    coord.releaseAsk(op, at(13));
    answerAsk(coord, op, 'operator', 'Red', at(15));
    const w = digestWindow(DAY, DIGEST_HOUR_UTC);
    const built = buildDigest(coord, w.fromMs, w.toMs);
    if (!built.ok) throw new Error(built.detail);
    expect(built.digest.lines.map((l) => [l.id, l.kind, l.at])).toEqual([[late, 'answer', at(5)], [op, 'lapse', at(13)]]);
  });

  it('an approval the operator answered inside its window is the operator\'s; after the window it is a lapse', () => {
    const { coord } = store();
    const inside = approval(coord, { t: at(0) });
    coord.markApprovalOperator(CHILD, at(0) + 30_000);
    const after = approval(coord, { t: at(5) });
    coord.lapseApproval(after);
    coord.markApprovalOperator(CHILD, at(5) + 90_000);
    const r = coord.approvalById(inside);
    const s = coord.approvalById(after);
    if (!r.ok || !r.row || !s.ok || !s.row) throw new Error('fixture');
    expect(approvalDecision(r.row)).toBeNull();
    expect(approvalDecision(s.row)).toEqual({ kind: 'lapse', at: at(5) + 60_000 });
  });

  it('a line never carries an unredacted token: a question stored raw (an older row) and a command are both masked', () => {
    const { coord } = store();
    const q = ask(coord, { t: at(0), question: `Run ${BEARER}?` });
    answerAsk(coord, q, PARENT, 'Yes', at(1));
    const a = approval(coord, { t: at(2), input: BEARER });
    rule(coord, a, 'deny', at(3));
    const w = digestWindow(DAY, DIGEST_HOUR_UTC);
    const built = buildDigest(coord, w.fromMs, w.toMs);
    if (!built.ok) throw new Error(built.detail);
    expect(built.digest.lines).toHaveLength(2);
    const wire = JSON.stringify(built.digest);
    expect(wire).not.toContain(TOKEN_HEX);
    expect(built.digest.lines[0]!.text).toContain('Authorization');
  });

  it('the command is cut to its first 160 characters, after the redaction', () => {
    const { coord } = store();
    const a = approval(coord, { t: at(0), input: `echo ${'x'.repeat(400)}` });
    rule(coord, a, 'allow', at(1));
    const w = digestWindow(DAY, DIGEST_HOUR_UTC);
    const built = buildDigest(coord, w.fromMs, w.toMs);
    if (!built.ok) throw new Error(built.detail);
    expect(built.digest.lines[0]!.text).toHaveLength(160);
  });

  it('askDecision: a stale question, a released-at-mint one and one held for the operator are none', () => {
    const { coord } = store();
    const s = ask(coord, { t: at(0) });
    coord.staleAsk('d' + String(seq), CHILD, at(1));
    const m = ask(coord, { t: at(2), releaseReason: 'parent-not-live' });
    const o = ask(coord, { t: at(3), parent: 'operator' });
    coord.releaseAsk(o, at(4));
    for (const id of [s, m, o]) {
      const r = coord.askById(id);
      if (!r.ok || r.ask === null) throw new Error('fixture');
      expect(askDecision(r.ask), String(id)).toBeNull();
    }
  });
});

describe('the digest hour (spec §10: 07:00 UTC by default, ~/.ccrc/digest-hour overrides it)', () => {
  it('is 7 by default, the override moves it, and a file that is not an hour is the default, said', () => {
    const dir = mkTmp('ccrc-digest-hour-');
    const warn = vi.fn();
    expect(DIGEST_HOUR_UTC).toBe(7);
    expect(readDigestHour(dir, warn)).toBe(7);
    expect(warn).not.toHaveBeenCalled();
    writeFileSync(path.join(dir, DIGEST_HOUR_FILE), '9\n');
    expect(readDigestHour(dir, warn)).toBe(9);
    writeFileSync(path.join(dir, DIGEST_HOUR_FILE), '0');
    expect(readDigestHour(dir, warn)).toBe(0);
    for (const bad of ['24', 'seven', '-1', '7.5', '']) {
      writeFileSync(path.join(dir, DIGEST_HOUR_FILE), bad);
      expect(readDigestHour(dir, warn), bad).toBe(7);
    }
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it('the newest closed day turns over at the hour', () => {
    expect(digestDayFor(Date.parse('2026-10-18T06:59:59Z'), 7)).toBe('2026-10-17');
    expect(digestDayFor(Date.parse('2026-10-18T07:00:00Z'), 7)).toBe('2026-10-18');
    expect(digestDayFor(Date.parse('2026-10-18T08:59:59Z'), 9)).toBe('2026-10-17');
    expect(digestDayFor(Date.parse('2026-10-18T00:00:00Z'), 0)).toBe('2026-10-18');
  });

  it('parseDigestDay takes a real UTC date only', () => {
    expect(parseDigestDay('2026-10-18')).toBe('2026-10-18');
    for (const bad of ['2026-02-30', '2026-10-1', '20261018', '2026-10-18T00:00:00Z', 7, null, undefined]) {
      expect(parseDigestDay(bad), String(bad)).toBeNull();
    }
  });
});

describe('the digest beat (FleetWatcher.sweepDigest)', () => {
  interface Beat { coord: CoordStore; home: string; sent: PushPayload[]; log: NotifyLog; watcher: () => FleetWatcher }
  async function beat(): Promise<Beat> {
    const { coord, home } = store();
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const log = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await log.load();
    const sent: PushPayload[] = [];
    const runner: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const deps = { ...testDeps(home, runner), coord, notifyLog: log,
      push: { notify: async (p: PushPayload) => { sent.push(p); } } as never };
    return { coord, home, sent, log, watcher: () => new FleetWatcher(deps, new Bus(), 10_000) };
  }
  const feedCoord = (coord: CoordStore): { kind: string; title: string; body: string }[] =>
    coord.db.prepare("SELECT kind, title, body FROM feed_events WHERE kind = 'coord'").all() as { kind: string; title: string; body: string }[];

  it('sends one coord push at 07:00 UTC, recorded in the feed and deep-linked to the day; none before the hour', async () => {
    const b = await beat();
    seedDay(b.coord);
    const w = b.watcher();
    // Before the hour the newest closed day is the 17th, whose window holds only the early answer.
    w.sweepDigest(Date.parse('2026-10-18T06:59:00Z'));
    expect(b.sent.map((p) => [p.title, p.url])).toEqual([['Coordinators decided 1 thing in your name', '/digest?day=2026-10-17']]);
    expect(b.coord.digestDay('2026-10-17')).toMatchObject({ count: 1 });
    expect(b.coord.digestDay(DAY)).toBeNull();
    b.sent.length = 0;
    b.coord.db.exec("DELETE FROM feed_events");
    w.sweepDigest(Date.parse('2026-10-18T07:00:30Z'));
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0]).toMatchObject({
      title: 'Coordinators decided 6 things in your name',
      body: '2 answered · 1 allowed · 1 denied · 1 handed over · 1 lapsed — tap to review and correct',
      tag: `digest-${DAY}`, url: `/digest?day=${DAY}`,
    });
    expect(feedCoord(b.coord)).toEqual([{ kind: 'coord', title: 'Coordinators decided 6 things in your name', body: b.sent[0]!.body }]);
    expect(b.coord.digestDay(DAY)).toMatchObject({ day: DAY, count: 6 });
    w.sweepDigest(Date.parse('2026-10-18T09:00:00Z'));
    expect(b.sent).toHaveLength(1);
  });

  it('a restart at the digest hour sends no second push', async () => {
    const b = await beat();
    seedDay(b.coord);
    b.watcher().sweepDigest(Date.parse('2026-10-18T07:00:30Z'));
    expect(b.sent).toHaveLength(1);
    b.watcher().sweepDigest(Date.parse('2026-10-18T07:01:40Z'));
    b.watcher().sweepDigest(Date.parse('2026-10-18T07:03:00Z'));
    expect(b.sent).toHaveLength(1);
    expect(feedCoord(b.coord)).toHaveLength(1);
  });

  it('the override file moves the hour', async () => {
    const b = await beat();
    // One answer at 08:00 on the day itself: after the default window closes (07:00), inside the 09:00 one.
    const q = ask(b.coord, { t: Date.parse('2026-10-18T07:59:00Z') });
    answerAsk(b.coord, q, PARENT, 'Red', Date.parse('2026-10-18T08:00:00Z'));
    writeFileSync(path.join(b.home, '.ccrc', DIGEST_HOUR_FILE), '9');
    const w = b.watcher();
    w.sweepDigest(Date.parse('2026-10-18T07:30:00Z'));
    expect(b.sent).toEqual([]);
    expect(b.coord.digestDay(DAY)).toBeNull();
    w.sweepDigest(Date.parse('2026-10-18T09:00:30Z'));
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0]).toMatchObject({ title: 'Coordinators decided 1 thing in your name', url: `/digest?day=${DAY}` });
  });

  it('a day with nothing decided sends none, and is claimed so the beat does not rebuild it', async () => {
    const b = await beat();
    b.watcher().sweepDigest(Date.parse('2026-10-18T07:00:30Z'));
    expect(b.sent).toEqual([]);
    expect(feedCoord(b.coord)).toEqual([]);
    expect(b.coord.digestDay(DAY)).toMatchObject({ count: 0 });
  });
});
