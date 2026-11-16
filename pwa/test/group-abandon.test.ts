// Abandon a stuck group: the loop and the words (D-8074; spec 2026-11-04 §9.2, A12, A33, A34, A40, A41, A49, A61; wave B4 Task 14).
import { describe, expect, it, vi } from 'vitest';
import type { RunStuck, RunSummary, StuckReason } from '../../shared/api';
import { ApiError, ApiTimeout } from '../src/lib/api';
import {
  ABANDON_CALL_MS, groupControlWords, groupRunSentence, groupSheetLines, groupStanding, groupSummary, groupToast, groupToastHasLink,
  runGroupAbandon, type GroupDeps, type GroupResult, type GroupStanding,
} from '../src/fleet/groupAbandon';

const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 1, program: 'p', programTitle: 'P', wave: 2, waveOf: 4, project: 'a', homeProject: null,
  sessionId: null, workspace: null, branch: null, state: 'planned', kind: 'work', reviews: null,
  claimedBy: 'a-coordinator', resumed: false, clearedAt: null, openedAt: 0, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 }, unreadMail: 0,
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null, briefQueued: false,
            clearError: null, coordKickoffPendingSince: null }, childReclaim: null, reviewCap: null, hadChild: false, ...over,
});
const stuck = (reason: StuckReason): RunStuck => ({ reason, cause: null, since: 0, closes: null });
const stuckRun = (reason: StuckReason, over: Partial<RunSummary> = {}): RunSummary => run({ stuck: stuck(reason), ...over });

/** A result from counts or id lists. Ids count up from 100 so a count never collides with a named id. */
function res(over: Partial<Record<keyof GroupResult, number | number[] | { id: number; sentence: string }[]>>): GroupResult {
  let next = 100;
  const ids = (v: unknown): number[] => (Array.isArray(v) ? (v as number[]) : Array.from({ length: (v as number | undefined) ?? 0 }, () => next++));
  const refused = over.refused;
  return {
    abandoned: ids(over.abandoned), alreadyClosed: ids(over.alreadyClosed), leftAlone: ids(over.leftAlone),
    refused: Array.isArray(refused) ? (refused as { id: number; sentence: string }[])
      : Array.from({ length: (refused as number | undefined) ?? 0 }, () => ({ id: next++, sentence: 'refused' })),
    noAnswer: ids(over.noAnswer), notReached: ids(over.notReached),
  };
}

describe('the words', () => {
  it('the group control counts what may go in bulk', () => {
    expect(groupControlWords(12, 12)).toBe('Abandon all 12…');
    expect(groupControlWords(2, 5)).toBe('Abandon 2…');
    expect(groupControlWords(2, 2)).toBe('Abandon 2…');
    expect(groupControlWords(3, 3)).toBe('Abandon all 3…');
    expect(groupControlWords(1, 1)).toBe('Abandon 1…');
    expect(groupControlWords(1, 3)).toBe('Abandon 1…');
    expect(groupControlWords(0, 2)).toBeNull();
  });

  it('the toast adds each result that happened, and is null when the sheet must stay', () => {
    expect(groupToast(res({ abandoned: 11, leftAlone: 1 }))).toBe('11 runs abandoned. 1 started moving and was left alone.');
    expect(groupToast(res({ abandoned: 1 }))).toBe('1 run abandoned.');
    expect(groupToast(res({ abandoned: 9, alreadyClosed: 2, refused: 1 }))).toBeNull();
    expect(groupToast(res({ abandoned: 10, alreadyClosed: 2 }))).toBe('10 runs abandoned. 2 had already closed.');
    expect(groupToast(res({ abandoned: 10, leftAlone: 2 }))).toBe('10 runs abandoned. 2 started moving and were left alone.');
    expect(groupToast(res({ leftAlone: 3 }))).toBe('No runs abandoned. 3 started moving and were left alone.');
    expect(groupToast(res({ alreadyClosed: 1 }))).toBe('No runs abandoned. 1 had already closed.');
    expect(groupToast(res({ abandoned: 3, noAnswer: 1 }))).toBeNull();
    expect(groupToast(res({ abandoned: 3, notReached: 2 }))).toBeNull();
  });

  it('See them only with something abandoned', () => {
    expect(groupToastHasLink(res({ leftAlone: 3 }))).toBe(false);
    expect(groupToastHasLink(res({ abandoned: 1 }))).toBe(true);
  });

  it('the part-done line counts refused, no answer and not reached as not', () => {
    expect(groupSummary(res({ abandoned: 9, alreadyClosed: 2, refused: 1 }))).toBe('9 abandoned, 2 had already closed, 1 not:');
    expect(groupSummary(res({ abandoned: 3, noAnswer: 1, notReached: 2 }))).toBe('3 abandoned, 3 not:');
  });

  it('each listed run has its sentence', () => {
    expect(groupRunSentence(res({ noAnswer: [7] }), 7)).toBe('No answer. It may have closed.');
    expect(groupRunSentence(res({ notReached: [7] }), 7)).toBe('Not reached.');
    expect(groupRunSentence(res({ alreadyClosed: [7] }), 7)).toBe('This run already closed.');
    expect(groupRunSentence(res({ refused: [{ id: 7, sentence: 'The release failed.' }] }), 7)).toBe('The release failed.');
  });

  it('where a run stands tells absent from null, and a gone run from a moved one', () => {
    expect(groupStanding(undefined, 'overtaken')).toBe('closed');
    expect(groupStanding(stuckRun('never-started'), 'overtaken')).toBe('moved');
    expect(groupStanding(run({ stuck: null }), 'overtaken')).toBe('moved');
    expect(groupStanding(run({ stuck: undefined }), 'overtaken')).toBe('unread');
    expect(groupStanding(stuckRun('overtaken', { workspace: 'w' }), 'overtaken')).toBe('moved');
    expect(groupStanding(stuckRun('overtaken', { sessionId: 's' }), 'overtaken')).toBe('moved');
    expect(groupStanding(stuckRun('overtaken'), 'overtaken')).toBe('in-group');
  });
});

describe('the sheet lines', () => {
  const live = (): 'alive' => 'alive';
  it('each of the five reasons has its sentence, in both numbers', () => {
    const several: Record<StuckReason, string> = {
      'review-of-closed': 'These reviews have nothing left to review: the work closed or a later review took over.',
      'overtaken': 'A later wave moved on without these.',
      'owner-gone': 'The coordinator or worker behind these is gone.',
      'start-never-landed': 'These started and never landed.',
      'never-started': 'These were opened and never started.',
    };
    const one: Record<StuckReason, string> = {
      'review-of-closed': 'This review has nothing left to review: the work closed or a later review took over.',
      'overtaken': 'A later wave moved on without this one.',
      'owner-gone': 'The coordinator or worker behind this is gone.',
      'start-never-landed': 'This started and never landed.',
      'never-started': 'This was opened and never started.',
    };
    for (const reason of Object.keys(several) as StuckReason[]) {
      expect(groupSheetLines(reason, [run({ id: 1 }), run({ id: 2 })], live).lines).toContain(several[reason]);
      expect(groupSheetLines(reason, [run({ id: 1 })], live).lines).toContain(one[reason]);
    }
  });

  it('the title and confirm follow the ticked count', () => {
    const two = groupSheetLines('overtaken', [run({ id: 1 }), run({ id: 2 })], live);
    expect(two.title).toBe('Abandon 2 runs?');
    expect(two.confirm).toBe('Abandon 2 runs');
    expect(two.lines).toContain('None holds a workspace. Each is recorded as closed by you.');
    const one = groupSheetLines('overtaken', [run({ id: 1 })], live);
    expect(one.title).toBe('Abandon 1 run?');
    expect(one.confirm).toBe('Abandon 1 run');
    expect(one.lines).toContain('It holds no workspace. It is recorded as closed by you.');
    const none = groupSheetLines('overtaken', [], live);
    expect(none.title).toBe('Choose a run to abandon.');
    expect(none.confirm).toBeNull();
  });

  it('the coordinator sentence follows who is gone', () => {
    const a = run({ id: 1 }), b = run({ id: 2 });
    const presence = (gone: number[]) => (r: RunSummary) => (gone.includes(r.id) ? 'dead' as const : 'alive' as const);
    expect(groupSheetLines('owner-gone', [a, b], presence([])).lines).toContain('Their coordinators are told.');
    expect(groupSheetLines('owner-gone', [a, b], presence([2])).lines).toContain('Live coordinators are told.');
    const allGone = groupSheetLines('owner-gone', [a, b], presence([1, 2])).lines;
    expect(allGone.some((l) => /told/.test(l))).toBe(false);
    expect(groupSheetLines('owner-gone', [a], presence([])).lines).toContain('Its coordinator is told.');
    expect(groupSheetLines('owner-gone', [a], presence([1])).lines.some((l) => /told/.test(l))).toBe(false);
  });

  it('the server verdict decides over the board reading', () => {
    const gone = run({ id: 1, coordinatorGone: true });
    expect(groupSheetLines('owner-gone', [gone], live).lines.some((l) => /told/.test(l))).toBe(false);
  });
});

describe('the loop', () => {
  const answered = { released: true };
  function deps(over: Partial<GroupDeps> = {}): GroupDeps {
    return { abandon: vi.fn().mockResolvedValue(answered), standing: () => 'in-group', stopped: () => false, onStep: vi.fn(), ...over };
  }
  const refusal = (status: number, body: unknown = {}): ApiError => new ApiError(status, body);
  const total = (r: GroupResult): number =>
    r.abandoned.length + r.alreadyClosed.length + r.leftAlone.length + r.refused.length + r.noAnswer.length + r.notReached.length;

  it('calls one at a time, in order, and every confirmed id ends in exactly one result', async () => {
    let open = 0, peak = 0;
    const order: number[] = [];
    const abandon = vi.fn(async (id: number) => { order.push(id); open++; peak = Math.max(peak, open); await Promise.resolve(); open--; return answered; });
    const r = await runGroupAbandon([3, 1, 2], deps({ abandon }));
    expect(peak).toBe(1);
    expect(order).toEqual([3, 1, 2]);
    expect(r.abandoned).toEqual([3, 1, 2]);
    expect(total(r)).toBe(3);
  });

  it('reports each step done', async () => {
    const onStep = vi.fn();
    await runGroupAbandon([1, 2], deps({ onStep }));
    expect(onStep.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
  });

  it('a run that moved is left alone, and a run gone from the frame counts as already closed', async () => {
    const standing = (id: number): GroupStanding => (id === 2 ? 'moved' : id === 3 ? 'closed' : 'in-group');
    const abandon = vi.fn().mockResolvedValue(answered);
    const r = await runGroupAbandon([1, 2, 3, 4], deps({ abandon, standing }));
    expect(r).toMatchObject({ abandoned: [1, 4], leftAlone: [2], alreadyClosed: [3] });
    expect(abandon).toHaveBeenCalledTimes(2);
  });

  it('a 409 bad-transition counts as already closed and continues', async () => {
    const abandon = vi.fn().mockRejectedValueOnce(refusal(409, { error: 'bad-transition', from: 'done' })).mockResolvedValue(answered);
    const r = await runGroupAbandon([1, 2], deps({ abandon }));
    expect(r).toMatchObject({ alreadyClosed: [1], abandoned: [2] });
  });

  it('a 409 unknown-run, a refused 409 and a 404 are that run\'s refusal, and the loop continues', async () => {
    const abandon = vi.fn()
      .mockRejectedValueOnce(refusal(409, { error: 'unknown-run' }))
      .mockRejectedValueOnce(refusal(409, { refused: 'whatever' }))
      .mockRejectedValueOnce(refusal(404))
      .mockResolvedValue(answered);
    const r = await runGroupAbandon([1, 2, 3, 4], deps({ abandon }));
    expect(r.refused.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(r.refused.every((x) => x.sentence.length > 0)).toBe(true);
    expect(r.abandoned).toEqual([4]);
  });

  it.each([
    ['501', refusal(501)],
    ['502', refusal(502, { stderr: 'ccd failed' })],
    ['registry-unmeasurable', refusal(503, { error: 'registry-unmeasurable' })],
  ])('%s stops the loop, that run refused and the rest not reached', async (_n, err) => {
    const abandon = vi.fn().mockResolvedValueOnce(answered).mockRejectedValueOnce(err).mockResolvedValue(answered);
    const r = await runGroupAbandon([1, 2, 3, 4], deps({ abandon }));
    expect(r.abandoned).toEqual([1]);
    expect(r.refused.map((x) => x.id)).toEqual([2]);
    expect(r.notReached).toEqual([3, 4]);
    expect(abandon).toHaveBeenCalledTimes(2);
  });

  it('a 502 keeps the release lead and the server\'s words', async () => {
    const abandon = vi.fn().mockRejectedValue(refusal(502, { stderr: 'boom' }));
    const r = await runGroupAbandon([1], deps({ abandon }));
    expect(r.refused[0]!.sentence).toBe('The release failed. boom');
  });

  it('an unread run stops the loop: it and the rest are not reached, never left alone', async () => {
    const standing = (id: number): GroupStanding => (id === 2 ? 'unread' : 'in-group');
    const r = await runGroupAbandon([1, 2, 3], deps({ standing }));
    expect(r).toMatchObject({ abandoned: [1], notReached: [2, 3], leftAlone: [] });
  });

  it.each([
    ['a timeout', new ApiTimeout('/api/runs/2/abandon', ABANDON_CALL_MS)],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('%s stops the loop: that run has no answer, the rest are not reached, with no retry', async (_n, err) => {
    const abandon = vi.fn().mockResolvedValueOnce(answered).mockRejectedValueOnce(err);
    const r = await runGroupAbandon([1, 2, 3], deps({ abandon }));
    expect(r).toMatchObject({ abandoned: [1], noAnswer: [2], notReached: [3] });
    expect(abandon).toHaveBeenCalledTimes(2);
  });

  it('Stop finishes the run in flight and leaves the rest not reached', async () => {
    let stop = false;
    const abandon = vi.fn(async () => { stop = true; return answered; });
    const r = await runGroupAbandon([1, 2, 3], deps({ abandon, stopped: () => stop }));
    expect(r).toMatchObject({ abandoned: [1], notReached: [2, 3] });
  });

  it('acts on the confirmed list: a run that joined the group later is not in it', async () => {
    const abandon = vi.fn().mockResolvedValue(answered);
    await runGroupAbandon([1, 2], deps({ abandon, standing: () => 'in-group' }));
    expect(abandon.mock.calls.map((c) => c[0])).toEqual([1, 2]);
  });
});
