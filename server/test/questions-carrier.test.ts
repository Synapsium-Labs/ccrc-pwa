// W3 Task Q3d (D-7028; ARCH-56 (#791), third PR; OA-C6 ruled (a), 2026-10-26): the hold carrier and `raise` as members
// of a `Questions` instance (`coord/questions.ts#createQuestions`), over a real `CoordStore`, a fixture hookstate and a
// fixture claimant rule. Each row asks the module for the verdict the watcher acted on in Step 1's sequences
// (`questions-sequence-pin.test.ts`) and Q3a's lifecycle rows (`questions-pin.test.ts`): what `raise` answers and
// leaves held, what a lapse half hands its push sink and in what order, what a door-in answers, and what a settle writes.
// Red before the move (the members do not exist), green after it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { createQuestions, questionsTestView, type QuestionPush, type QuestionRules } from '../src/coord/questions.js';
import { askActions } from '../src/askkey.js';
import type { HookState } from '../src/hookstate.js';
import { parseDialog } from '../src/pane/dialog.js';
import type { SessionRecord } from '../src/registry.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_786_000_000_000;
const A = 'project-a-quiet-basin';
const B = 'project-a-still-cove';
const PARENT = 'project-a-calm-mesa';
const COLOUR = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }] };
const SIZE = { questions: [{ question: 'Which size?', header: 'Size', multiSelect: false, options: [{ label: 'Small' }, { label: 'Large' }] }] };
const MULTI = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: true, options: [{ label: 'Red' }, { label: 'Blue' }] }] };
const COLOUR_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';
const SIZE_PANE = 'Which size?\n❯ 1. Small\n  2. Large\n  3. Other\nEnter to select\n';
const RULE = '─'.repeat(60);
const PERMISSION_PANE = ['  ⎿  $ rm -rf build', RULE, ' Bash command', '   rm -rf build', '   Remove the build directory',
  ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and always allow access to this project', '   3. No',
  ' Esc to cancel · Tab to amend'].join('\n');
const APPROVAL_ASK = { approval: { tool: 'Bash', summary: 'rm -rf build' } };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const at = (ms: number): void => { vi.setSystemTime(T0 + ms); };

const hook = (ask: unknown, updatedAt = Date.now()): HookState => ({ state: 'waiting', updatedAt, ask } as unknown as HookState);
const rec = (id: string, runId = 1): SessionRecord => ({ id, project: 'project-a', child: { kind: 'child', runId } } as unknown as SessionRecord);
const dialogOf = (pane: string) => parseDialog(pane)!;

/** A fixture store and an instance over it whose claimant rule answers `verdict` (held for the parent by default). */
function fixture(verdict: 'held' | 'released' | 'not-a-child' = 'held') {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(0);
  const home = mkTmp('ccrc-questions-carrier-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const runner = async () => ({ ran: true as const, code: 0, stdout: '', stderr: '' });
  const deps = { ...testDeps(home, runner), coord };
  const heldFor = vi.fn(async () => (verdict === 'held' ? { kind: 'held', parent: PARENT, runId: 1 }
    : verdict === 'released' ? { kind: 'released', parent: PARENT, runId: 1, reason: 'parent-not-live' } : { kind: 'not-a-child' }));
  const rules = { heldFor } as unknown as QuestionRules;
  const q = createQuestions(deps, rules);
  const pushes: QuestionPush[] = [];
  const sink = (ev: QuestionPush): void => { pushes.push(ev); };
  const askRows = () => coord.db.prepare('SELECT id, childId, state, releaseReason FROM asks ORDER BY id').all() as Array<{ id: number; childId: string; state: string; releaseReason: string | null }>;
  const approvalRows = () => coord.db.prepare('SELECT id, agentId, state FROM approvals ORDER BY id').all() as Array<{ id: number; agentId: string; state: string }>;
  const mail = () => (coord.db.prepare('SELECT m.subject AS subject FROM mail m ORDER BY m.id').all() as Array<{ subject: string }>).map((m) => m.subject);
  let nonces = 0;
  const approval = (child: string, agentId = ''): number => coord.insertApproval({
    childId: child, parentId: PARENT, runId: null, digest: 'd'.repeat(64), nonce: String(++nonces).padStart(32, 'n'), agentId,
    tool: 'Bash', inputRedacted: 'rm -rf build', truncated: false, class: 'ordinary', askAt: Date.now(), notifyAt: Date.now() + 60_000,
  });
  const raiseAsk = (child: string, ask: unknown, pane: string) => {
    const hs = hook(ask);
    return q.raise(rec(child), dialogOf(pane), hs, askActions(hs), [rec(child), rec(PARENT)]);
  };
  return { coord, deps, q, heldFor, pushes, sink, askRows, approvalRows, mail, approval, raiseAsk };
}

describe('the hold carrier and raise live in the Questions instance (D-7028)', () => {
  it('raise: an eligible ask held for its claimant is minted held, mailed, and answered `held` with the record; the carrier holds it', async () => {
    const f = fixture();
    const v = await f.raiseAsk(A, COLOUR, COLOUR_PANE);
    expect(v.kind).toBe('held');
    if (v.kind !== 'held') return;
    expect(v.parent).toBe(PARENT);
    expect(v.record).toMatchObject({ kind: 'ask', sessionId: A, title: '❓ Question', body: 'Which colour?', recordAlways: true, recordOnly: true });
    expect(f.askRows()).toEqual([{ id: 1, childId: A, state: 'held', releaseReason: null }]);
    expect(f.mail()).toEqual(['ask:1']);
    const held = questionsTestView(f.q).heldAsks().get(A);
    expect(held?.askId).toBe(1);
    expect(held?.answeringSince).toBeNull();
  });

  it('raise: a claimant rule that releases mints released, mails nobody, holds nothing, and answers the push to send now', async () => {
    const f = fixture('released');
    const v = await f.raiseAsk(A, COLOUR, COLOUR_PANE);
    expect(v.kind).toBe('released');
    if (v.kind === 'released') expect(v.push).toMatchObject({ sessionId: A, body: 'Which colour?' });
    expect(f.askRows()).toEqual([{ id: 1, childId: A, state: 'released', releaseReason: 'parent-not-live' }]);
    expect(f.mail()).toEqual([]);
    expect(questionsTestView(f.q).heldAsks().size).toBe(0);
  });

  it('raise: an ask askActions refuses (D-2173), the switch raised, or a child the rule denies answers none and mints nothing', async () => {
    const f = fixture();
    expect(await f.raiseAsk(A, MULTI, COLOUR_PANE)).toEqual({ kind: 'none' });
    f.q.noteAsksSwitch(true);
    expect(questionsTestView(f.q).asksDisabled()).toBe(true);
    expect(await f.raiseAsk(A, COLOUR, COLOUR_PANE)).toEqual({ kind: 'none' });
    f.q.noteAsksSwitch(false);
    expect(f.askRows()).toEqual([]);
    expect(f.heldFor).not.toHaveBeenCalled();
    const g = fixture('not-a-child');
    expect(await g.raiseAsk(A, COLOUR, COLOUR_PANE)).toEqual({ kind: 'none' });
    expect(g.askRows()).toEqual([]);
  });

  it('raise: a half-committed mint answers none and the compensation settles the row stale, nothing held', async () => {
    const f = fixture();
    const real = f.coord.insertAsk.bind(f.coord);
    vi.spyOn(f.coord, 'insertAsk').mockImplementationOnce((a) => { real(a); throw new Error('fixture: the mail insert failed'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await f.raiseAsk(A, COLOUR, COLOUR_PANE)).toEqual({ kind: 'none' });
    expect(f.askRows()).toEqual([{ id: 1, childId: A, state: 'stale', releaseReason: null }]);
    expect(questionsTestView(f.q).heldAsks().size).toBe(0);
  });

  it('raise: an instance made without the claimant rule answers none (a server never raises)', async () => {
    const f = fixture();
    const bare = createQuestions(f.deps);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hs = hook(COLOUR);
    expect(await bare.raise(rec(A), dialogOf(COLOUR_PANE), hs, askActions(hs), [])).toEqual({ kind: 'none' });
    expect(f.askRows()).toEqual([]);
  });

  it('raise, the approval arm: a held main-thread row defers the prompt (held, the record); a subagent\'s row alone does not (D-5491)', async () => {
    const f = fixture();
    f.approval(B, 'a0000000000000001');
    expect(await f.q.raise(rec(B), dialogOf(PERMISSION_PANE), hook(APPROVAL_ASK), null, [])).toEqual({ kind: 'none' });
    const id = f.approval(A);
    const v = await f.q.raise(rec(A), dialogOf(PERMISSION_PANE), hook(APPROVAL_ASK), null, []);
    expect(v.kind).toBe('held');
    if (v.kind === 'held') expect(v.record).toMatchObject({ sessionId: A, recordOnly: true, recordAlways: true });
    expect(questionsTestView(f.q).heldApprovals().get(A)?.rowIds).toEqual([id]);
    expect(questionsTestView(f.q).heldApprovals().has(B)).toBe(false);
  });

  it('lapseAsks: two lapses go to the sink in hold order; a late answer replaces only its own child\'s lapse, once (D-5289)', async () => {
    const f = fixture();
    await f.raiseAsk(A, COLOUR, COLOUR_PANE);
    at(1_000);
    await f.raiseAsk(B, SIZE, SIZE_PANE);
    f.q.lapseAsks(T0 + 100_000, f.sink);
    expect(f.pushes).toEqual([]);
    f.q.lapseAsks(T0 + 200_000, f.sink);
    expect(f.pushes.map((p) => p.sessionId)).toEqual([A, B]);
    expect(f.askRows().map((r) => r.state)).toEqual(['released', 'released']);
    expect(f.q.answeredLate(B, 1, PARENT)).toBeNull();
    expect(f.q.answeredLate(A, 1, PARENT)).toMatchObject({ sessionId: A, body: `Answered by ${PARENT}`, actions: undefined });
    expect(f.q.answeredLate(A, 1, PARENT)).toBeNull();
  });

  it('released: the decline door answers the held snapshot once, then null', async () => {
    const f = fixture();
    await f.raiseAsk(A, COLOUR, COLOUR_PANE);
    expect(f.q.released(A)).toMatchObject({ sessionId: A, body: 'Which colour?' });
    expect(f.q.released(A)).toBeNull();
    f.q.lapseAsks(T0 + 200_000, f.sink);
    expect(f.pushes).toEqual([]);
  });

  it('the re-seed (D-5925): held rows found at boot are re-seeded child by child, and lapse in re-seed order', async () => {
    const f = fixture();
    await f.raiseAsk(A, COLOUR, COLOUR_PANE);
    at(1_000);
    await f.raiseAsk(B, SIZE, SIZE_PANE);
    const after = createQuestions(f.deps, { heldFor: f.heldFor } as unknown as QuestionRules);
    after.loadReseed();
    at(20_000);
    expect(after.reseed(rec(A), null, null, null)).toBe('waiting');
    expect(after.reseed(rec(B), SIZE_PANE, dialogOf(SIZE_PANE), hook(SIZE))).toBe('reseeded');
    expect(after.reseed(rec(A), COLOUR_PANE, dialogOf(COLOUR_PANE), hook(COLOUR))).toBe('reseeded');
    expect(after.reseed(rec(A), COLOUR_PANE, dialogOf(COLOUR_PANE), hook(COLOUR))).toBe('none');
    after.lapseAsks(T0 + 200_000, f.sink);
    expect(f.pushes.map((p) => p.sessionId)).toEqual([B, A]);
  });

  it('the re-seed (D-5925): a different question under the same menu (another askKey) settles stale and re-seeds nothing', async () => {
    const f = fixture();
    await f.raiseAsk(A, COLOUR, COLOUR_PANE);
    const after = createQuestions(f.deps);
    after.loadReseed();
    expect(after.reseed(rec(A), COLOUR_PANE, dialogOf(COLOUR_PANE), hook(SIZE))).toBe('none');
    expect(f.askRows().map((r) => r.state)).toEqual(['stale']);
    after.lapseAsks(T0 + 200_000, f.sink);
    expect(f.pushes).toEqual([]);
  });

  it('settleCleared: the cleared prompt marks its covered main-thread rows operator and only those (D-5491); settleReplaced stales the orphaned ask', async () => {
    const f = fixture();
    const main = f.approval(A);
    const sub = f.approval(A, 'a0000000000000001');
    const dialog = dialogOf(PERMISSION_PANE);
    await f.q.raise(rec(A), dialog, hook(APPROVAL_ASK), null, []);
    f.q.settleCleared(A, dialog.id);
    expect(f.approvalRows()).toEqual([{ id: main, agentId: '', state: 'operator' }, { id: sub, agentId: 'a0000000000000001', state: 'held' }]);
    expect(questionsTestView(f.q).heldApprovals().size).toBe(0);
    await f.raiseAsk(B, COLOUR, COLOUR_PANE);
    f.q.settleReplaced(B, dialogOf(COLOUR_PANE).id);
    expect(f.askRows().map((r) => r.state)).toEqual(['stale']);
    expect(questionsTestView(f.q).heldAsks().size).toBe(0);
  });

  it('lapseApprovals: the window lapses the row and the deferred push goes to the sink while painted; a door-in after it answers null', async () => {
    const f = fixture();
    f.approval(A);
    const dialog = dialogOf(PERMISSION_PANE);
    await f.q.raise(rec(A), dialog, hook(APPROVAL_ASK), null, []);
    const input = (now: number) => ({ now, graceMs: 10_000, paintedDialogOf: () => dialog.id, push: f.sink });
    f.q.lapseApprovals(input(T0 + 30_000));
    expect(f.pushes).toEqual([]);
    f.q.lapseApprovals(input(T0 + 61_000));
    expect(f.approvalRows().map((r) => r.state)).toEqual(['released']);
    expect(f.pushes.map((p) => p.sessionId)).toEqual([A]);
    expect(f.q.approvalReleased(A, dialog.id)).toBeNull();
  });

  it('approvalRuled: a prompt pushed before any hold is replaced with who ruled; a held prompt, a subagent ruling or an unpainted one is not', async () => {
    const f = fixture();
    expect(f.q.approvalRuled(A, '', PARENT, 'deny', true, () => 'project-a')).toMatchObject({ sessionId: A, project: 'project-a' });
    expect(f.q.approvalRuled(A, 'a0000000000000001', PARENT, 'deny', true, () => 'project-a')).toBeNull();
    expect(f.q.approvalRuled(A, '', PARENT, 'deny', false, () => 'project-a')).toBeNull();
    f.approval(A);
    await f.q.raise(rec(A), dialogOf(PERMISSION_PANE), hook(APPROVAL_ASK), null, []);
    expect(f.q.approvalRuled(A, '', PARENT, 'allow', true, () => 'project-a')).toBeNull();
  });

  it('currentAskOf: the store\'s answer unchanged', async () => {
    const f = fixture();
    expect(f.q.currentAskOf(A)).toEqual(f.coord.currentAskFor(A));
    await f.raiseAsk(A, COLOUR, COLOUR_PANE);
    expect(f.q.currentAskOf(A)).toEqual(f.coord.currentAskFor(A));
  });
});
