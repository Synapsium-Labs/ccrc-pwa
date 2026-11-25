// The provider-failure ladder, wave 1 (plan docs/superpowers/plans/2026-11-25-provider-retry.md): the pure half. What a marker says
// is owed, when a nudge falls due, what stops one, the arming rule, the mail's words and how the mail lane types it, and the
// deciders the ladder shares with the stall watch (the `failed` arm it leaves, the quiet ladder's hold, the send-failure table).
// The lane itself is driven in `provider-retry-lane.test.ts`.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import {
  PROVIDER_RETRY_BODY, PROVIDER_RETRY_PREFIX, isProviderRetryMail, providerRetryDueOf, providerRetrySubject, renderProviderRetryLine,
} from '../../shared/provider-retry.js';
import { MAIL_TURN_HOLD_MS, decideSendFailure } from '../src/coord/delivery.js';
import { mailNudgeOf, renderMailNudge, resumeRuleOf } from '../src/coord/envelope.js';
import { PROVIDER_FAILURE_ERRORS, STOP_FAILURE_ERRORS, stallFailedVerdict } from '../src/coord/stopFailure.js';
import {
  PROVIDER_RETRY_DELAYS_MS, PROVIDER_RETRY_REPEAT_MS, providerRetryArmed, providerRetryFirstDue, providerRetryHoldsQuiet,
  providerRetryMailSince, providerRetryOwed, providerRetryVerdict, type ProviderRetryInput, type ProviderRetryVerdict,
} from '../src/coord/providerRetry.js';
import {
  BACKLOG_HORIZON_MS, type StallArming, type StallDeliveryRow, type StallMailRow, type StallSessionInput, type StallWorker, type TurnMark,
  type TurnMarkRead,
} from '../src/coord/stall.js';

const MIN = 60_000;
const H = 60 * MIN;
const NOW = 1_800_000_000_000;
const SID = 'lane-a-project-a';
const T = NOW - MIN;                         // the newest failure: one minute ago, so the first nudge is due now
type Present = Extract<StallWorker, { present: true }>;

const worker = (word = 'idle', over: Partial<Present> = {}): Present => ({
  present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 }, dialogPending: false, stranded: false,
  swapBlocked: false, live: { ok: true, word, since: T + 1_000 }, hookAsk: { kind: 'unmeasured' }, askRow: { kind: 'none' },
  autoContinueHeldAt: null, ...over,
});
const mark = (over: Partial<TurnMark> = {}): Extract<TurnMarkRead, { ok: true }> => ({
  ok: true, crons: null, sessionId: 'uuid-1', state: 'failed', event: 'StopFailure', at: T, turnAt: T - MIN, stopAt: T, bg: 0, bgKinds: [],
  bgIds: [], err: 'server_error', restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], failAts: [T], graceUntil: null, ...over,
});
const LIVE: StallArming = { disabled: false, live: true, escalate: true, w2Live: false, mailDisabled: false };
const session = (over: Partial<StallSessionInput> = {}): StallSessionInput => ({
  sessionId: SID, role: 'other', run: null, worker: worker(), mark: mark(), liveStartedAt: NOW - 30 * H, markUnreadableSince: null,
  mail: [], deliveries: [], notices: [], arming: LIVE, coordinationPaused: false, ...over,
});
const input = (over: Partial<StallSessionInput> = {}, rest: Partial<ProviderRetryInput> = {}): ProviderRetryInput =>
  ({ session: session(over), archived: false, hibernated: false, armed: true, ...rest });
const verdict = (i: ProviderRetryInput, now = NOW): ProviderRetryVerdict => providerRetryVerdict(i, now);
const NONE: ProviderRetryVerdict = { act: 'none' };
const nudge = (dueAt: number): ProviderRetryVerdict => ({ act: 'nudge', dueAt });
const mail = (id: number, dueAt: number, over: Partial<StallMailRow> = {}): StallMailRow =>
  ({ id, at: dueAt, runId: null, fromId: 'operator', toId: SID, kind: 'status', subject: providerRetrySubject(dueAt), ...over });
const delivery = (mailId: number, over: Partial<StallDeliveryRow> = {}): StallDeliveryRow =>
  ({ id: mailId * 10, mailId, toId: SID, state: 'acked', deliveredAt: null, ackedAt: null, lastGate: null, gateSince: null, replayCount: 0, ...over });

describe('what a marker says is owed', () => {
  it('a counted failure with no turn since: its epoch and its place in the count', () => {
    expect(providerRetryOwed(mark())).toEqual({ at: T, count: 1 });
    expect(providerRetryOwed(mark({ failAts: [T - 9 * MIN, T - 4 * MIN, T] }))).toEqual({ at: T, count: 3 });
    expect(providerRetryOwed(mark({ turnAt: null }))).toEqual({ at: T, count: 1 });
  });
  it('a turn since, or at the very instant, owes nothing', () => {
    expect(providerRetryOwed(mark({ state: 'working', turnAt: T + 1 }))).toBeNull();
    expect(providerRetryOwed(mark({ state: 'working', turnAt: T }))).toBeNull();
  });
  it('a restart relabels the failed line done, and the retry is still owed', () => {
    expect(providerRetryOwed(mark({ state: 'done', event: 'SessionStart', restartAt: T + 5_000 }))).toEqual({ at: T, count: 1 });
  });
  it('a finished turn owes nothing: the hook emptied the count', () => {
    expect(providerRetryOwed(mark({ state: 'done', event: 'Stop', err: 'server_error', failAts: [] }))).toBeNull();
  });
  it('an older hook counts none: its failed line with a provider token owes one, any other token none', () => {
    for (const err of PROVIDER_FAILURE_ERRORS) expect(providerRetryOwed(mark({ failAts: [], err })), err).toEqual({ at: T, count: 1 });
    for (const err of ['unknown', 'max_output_tokens', 'rate_limit', 'invalid_request', null, 'new_error']) {
      expect(providerRetryOwed(mark({ failAts: [], err })), String(err)).toBeNull();
    }
    const { failAts: _none, ...older } = mark();
    expect(providerRetryOwed(older)).toEqual({ at: T, count: 1 });
    expect(providerRetryOwed(mark({ failAts: [], stopAt: null }))).toBeNull();
  });
  it('a later failure of another kind ends the owing: the turn that ended on it ran', () => {
    expect(providerRetryOwed(mark({ failAts: [T - 5 * MIN], turnAt: T - MIN, err: 'rate_limit' }))).toBeNull();
  });
});

describe('when a nudge falls due: 1, 4, then 15 minutes after the n-th failure, staying at 15', () => {
  it('the ladder', () => {
    expect(PROVIDER_RETRY_DELAYS_MS).toEqual([MIN, 4 * MIN, 15 * MIN]);
    const waits = [1, 2, 3, 4, 8].map((count) => providerRetryFirstDue({ at: T, count }) - T);
    expect(waits).toEqual([MIN, 4 * MIN, 15 * MIN, 15 * MIN, 15 * MIN]);
  });
  it('a nudge at its due time, none a millisecond before', () => {
    expect(verdict(input())).toEqual(nudge(T + MIN));
    expect(verdict(input(), NOW - 1)).toEqual(NONE);
  });
  it('the second failure waits 4 minutes and the third 15', () => {
    const two = input({ mark: mark({ failAts: [T - 2 * MIN, T] }) });
    expect(verdict(two, T + 4 * MIN - 1)).toEqual(NONE);
    expect(verdict(two, T + 4 * MIN)).toEqual(nudge(T + 4 * MIN));
    const three = input({ mark: mark({ failAts: [T - 9 * MIN, T - 5 * MIN, T] }) });
    expect(verdict(three, T + 15 * MIN - 1)).toEqual(NONE);
    expect(verdict(three, T + 15 * MIN)).toEqual(nudge(T + 15 * MIN));
  });
  it('a nudge that started no turn is repeated 15 minutes after it landed, under its own due time', () => {
    const landed = T + MIN + 20_000;
    const sent = { mail: [mail(1, T + MIN)], deliveries: [delivery(1, { deliveredAt: landed, ackedAt: landed })] };
    expect(verdict(input(sent), landed + PROVIDER_RETRY_REPEAT_MS - 1)).toEqual(NONE);
    expect(verdict(input(sent), landed + PROVIDER_RETRY_REPEAT_MS)).toEqual(nudge(landed + PROVIDER_RETRY_REPEAT_MS));
    const second = { mail: [...sent.mail, mail(2, landed + 15 * MIN)], deliveries: [...sent.deliveries, delivery(2, { ackedAt: landed + 15 * MIN })] };
    expect(verdict(input(second), landed + 30 * MIN - 1)).toEqual(NONE);
    expect(verdict(input(second), landed + 30 * MIN)).toEqual(nudge(landed + 30 * MIN));
  });
  it('a nudge whose delivery ended without landing still spaces the next one', () => {
    const sent = { mail: [mail(1, T + MIN)], deliveries: [delivery(1, { state: 'rejected' })] };
    expect(verdict(input(sent), T + 16 * MIN - 1)).toEqual(NONE);
    expect(verdict(input(sent), T + 16 * MIN)).toEqual(nudge(T + 16 * MIN));
  });
  it('never two outstanding: none while one is queued or delivered and unacked, however late', () => {
    for (const state of ['queued', 'delivered']) {
      const sent = { mail: [mail(1, T + MIN)], deliveries: [delivery(1, { state })] };
      expect(verdict(input(sent), T + 5 * H), state).toEqual(NONE);
    }
  });
  it('a nudge of an earlier failure never spaces this one', () => {
    const sent = { mail: [mail(1, T - 10 * MIN)], deliveries: [delivery(1, { ackedAt: T - 9 * MIN })] };
    expect(verdict(input(sent))).toEqual(nudge(T + MIN));
  });
  it('the 22 h cutoff of the failed arm does not apply: a failure days old is still nudged', () => {
    const old = NOW - 4 * 24 * H;
    expect(verdict(input({ mark: mark({ at: old, stopAt: old, turnAt: old - MIN, failAts: [old] }), worker: worker('idle', { live: { ok: true, word: 'idle', since: old } }), liveStartedAt: old - H })))
      .toEqual(nudge(old + MIN));
  });
  it('the mail read reaches back to the failure when that is older than the watch\'s horizon', () => {
    const old = NOW - 4 * 24 * H;
    expect(providerRetryMailSince(mark({ failAts: [old], turnAt: old - MIN }), NOW)).toBe(old);
    expect(providerRetryMailSince(mark(), NOW)).toBe(NOW - BACKLOG_HORIZON_MS);
    expect(providerRetryMailSince({ ok: false, reason: 'unmeasured' }, NOW)).toBe(NOW - BACKLOG_HORIZON_MS);
  });
  it('another sender, another recipient or another subject is no nudge of ours', () => {
    const deliveries = [delivery(1, { state: 'queued' })];
    for (const m of [mail(1, T + MIN, { fromId: 'lane-b-project-b' }), mail(1, T + MIN, { toId: 'other' }), mail(1, T + MIN, { subject: 'failed: x' })]) {
      expect(verdict(input({ mail: [m], deliveries }))).toEqual(nudge(T + MIN));
    }
  });
});

describe('who is nudged: every live session, whatever its role', () => {
  it('a worker, a coordinator and any other row alike', () => {
    for (const role of ['worker', 'coordinator', 'other'] as const) expect(verdict(input({ role })), role).toEqual(nudge(T + MIN));
  });
  it('a worker on a run that reads unknown is nudged: its silence is the reason', () => {
    const run = { id: 67, kind: 'work', state: 'unknown', sessionId: SID, claimedBy: 'c', dispatchedAt: NOW - H, program: 'p', wave: 1, waveOf: 1,
      project: 'project-a', workspace: 'ws' };
    expect(verdict(input({ role: 'worker', run }))).toEqual(nudge(T + MIN));
  });
  it('shell is at rest too', () => {
    expect(verdict(input({ worker: worker('shell') }))).toEqual(nudge(T + MIN));
  });
});

describe('never nudged', () => {
  const holds: [string, Partial<StallSessionInput>, string, Partial<ProviderRetryInput>?][] = [
    ['a running turn', { worker: worker('busy') }, 'busy'],
    ['a word this build does not know', { worker: worker('compacting') }, 'busy'],
    ['an open dialog (the live word)', { worker: worker('waiting') }, 'dialog'],
    ['an open dialog (the pane)', { worker: worker('idle', { dialogPending: true }) }, 'dialog'],
    ['a held ask', { worker: worker('idle', { askRow: { kind: 'row', state: 'held', at: T } }) }, 'ask'],
    ['an ask being answered', { worker: worker('idle', { askRow: { kind: 'row', state: 'answering', at: T } }) }, 'ask'],
    ['a hook ask', { worker: worker('idle', { hookAsk: { kind: 'ask', at: T } }) }, 'ask'],
    ['a hook approval', { worker: worker('idle', { hookAsk: { kind: 'approval', at: T } }) }, 'ask'],
    ['an ask row that could not be read', { worker: worker('idle', { askRow: { kind: 'unmeasured' } }) }, 'unmeasured'],
    ['no pane', { worker: worker('idle', { live: { ok: false, reason: 'no-pane' } }) }, 'unmeasured'],
    ['an unmeasured live word', { worker: worker('idle', { live: { ok: false, reason: 'unmeasured' } }) }, 'unmeasured'],
    ['a live word with no stamp', { worker: worker('idle', { live: { ok: true, word: 'idle', since: null } }) }, 'unmeasured'],
    ['an unmeasured fleet row', { worker: worker('idle', { unmeasured: true }) }, 'unmeasured'],
    ['an unmeasurable lifecycle', { worker: worker('idle', { lifecycle: 'unmeasurable' }) }, 'unmeasured'],
    ['a stopped session', { worker: worker('idle', { lifecycle: 'stopped' }) }, 'lifecycle'],
    ['a restarting session', { worker: worker('idle', { lifecycle: 'restarting' }) }, 'lifecycle'],
    ['an orphan pane', { worker: worker('idle', { lifecycle: 'orphan' }) }, 'lifecycle'],
    ['a pane that never started', { worker: worker('idle', { lifecycle: 'never-started' }) }, 'lifecycle'],
    ['an archived session', {}, 'lifecycle', { archived: true }],
    ['a hibernated session', {}, 'lifecycle', { hibernated: true }],
    ['a session gone from the tick', { worker: { present: false } }, 'absent'],
    ['a refused id', { worker: { present: 'refused' } }, 'unmeasured'],
    ['an account at its ceiling', { worker: worker('idle', { limits: { five: 100, seven: 1 } }) }, 'limit'],
    ['a stranded session', { worker: worker('idle', { stranded: true }) }, 'limit'],
    ['a blocked swap', { worker: worker('idle', { swapBlocked: true }) }, 'limit'],
    ['a recent auto-continue hold', { worker: worker('idle', { autoContinueHeldAt: NOW - MIN }) }, 'limit'],
    ['a marker that could not be read', { mark: { ok: false, reason: 'unmeasured' } }, 'unmeasured'],
  ];
  it.each(holds)('%s holds', (_name, over, why, rest) => {
    expect(verdict(input(over, rest ?? {}))).toEqual({ act: 'hold', why });
  });
  it('a marker that is absent, foreign, stale or malformed, or older than the live process, owes nothing', () => {
    for (const reason of ['absent', 'foreign', 'stale', 'malformed'] as const) expect(verdict(input({ mark: { ok: false, reason } })), reason).toEqual(NONE);
    expect(verdict(input({ liveStartedAt: NOW - 1 }))).toEqual(NONE);
    expect(verdict(input({ liveStartedAt: null }))).toEqual(NONE);
  });
  it('an unarmed ladder nudges nobody', () => {
    expect(verdict(input({}, { armed: false }))).toEqual(NONE);
  });
});

describe('a queued nudge the session has moved past is taken back', () => {
  const queued = { mail: [mail(1, T + MIN)], deliveries: [delivery(1, { state: 'queued' })] };
  it('a turn ran since', () => {
    expect(verdict(input({ ...queued, mark: mark({ state: 'working', turnAt: T + 2 * MIN, at: T + 2 * MIN }) }))).toEqual({ act: 'withdraw', deliveryId: 10 });
  });
  it('a newer failure: the old nudge would jump its wait', () => {
    const t2 = T + 3 * MIN;
    expect(verdict(input({ ...queued, mark: mark({ turnAt: T + 2 * MIN, at: t2, stopAt: t2, failAts: [T, t2] }) }), t2 + 1)).toEqual({ act: 'withdraw', deliveryId: 10 });
  });
  it('a delivered one is never taken back, and a queued one still owed stands', () => {
    const done = mark({ state: 'working', turnAt: T + 2 * MIN, at: T + 2 * MIN });
    expect(verdict(input({ mail: queued.mail, deliveries: [delivery(1, { state: 'delivered' })], mark: done }))).toEqual(NONE);
    expect(verdict(input(queued))).toEqual(NONE);
  });
});

describe('the arming rule: its own, never the wave-2 level', () => {
  const a = (over: Partial<StallArming>): StallArming => ({ disabled: false, live: false, escalate: false, w2Live: false, mailDisabled: false, ...over });
  it('ships armed: a box that follows its files with no marker touched, and every chosen level that sends', () => {
    expect(providerRetryArmed(a({}), 'files')).toBe(true);
    for (const w2Live of [false, true]) for (const escalate of [false, true]) {
      expect(providerRetryArmed(a({ live: true, escalate, w2Live }), 'chosen')).toBe(true);
      expect(providerRetryArmed(a({ live: true, escalate, w2Live }), 'held')).toBe(true);
    }
  });
  it('stopped by the kill switch and a chosen Off (both disabled), by a chosen Log only, and by mail-disabled', () => {
    for (const source of ['files', 'chosen', 'held'] as const) {
      expect(providerRetryArmed(a({ disabled: true, live: true }), source), `disabled, ${source}`).toBe(false);
      expect(providerRetryArmed(a({ mailDisabled: true, live: true }), source), `mail-disabled, ${source}`).toBe(false);
    }
    expect(providerRetryArmed(a({}), 'chosen'), 'Log only').toBe(false);
    expect(providerRetryArmed(a({}), 'held'), 'Log only, held').toBe(false);
  });
  it('the quiet ladder is held only for a session that owes a retry, and only while the ladder is armed', () => {
    expect(providerRetryHoldsQuiet(mark(), true)).toBe(true);
    expect(providerRetryHoldsQuiet(mark(), false)).toBe(false);
    expect(providerRetryHoldsQuiet(mark({ state: 'done', failAts: [] }), true)).toBe(false);
    expect(providerRetryHoldsQuiet({ ok: false, reason: 'unmeasured' }, true)).toBe(false);
  });
});

describe('the failed arm leaves a provider failure alone', () => {
  const failed = (err: string): StallSessionInput => session({ role: 'worker', arming: { ...LIVE, w2Live: true },
    run: { id: 67, kind: 'work', state: 'working', sessionId: SID, claimedBy: 'lane-c-project-a', dispatchedAt: NOW - 30 * H, program: 'p', wave: 1, waveOf: 1, project: 'project-a', workspace: 'ws' },
    mark: mark({ err, at: NOW - 20 * MIN, stopAt: NOW - 20 * MIN, turnAt: NOW - 25 * MIN }), worker: worker('idle', { live: { ok: true, word: 'idle', since: NOW - 20 * MIN } }) });
  it('the classes: the two provider tokens are their own', () => {
    expect(PROVIDER_FAILURE_ERRORS).toEqual(['server_error', 'overloaded']);
    expect(Object.entries(STOP_FAILURE_ERRORS).filter(([, c]) => c === 'retry').map(([e]) => e)).toEqual(['max_output_tokens', 'unknown']);
  });
  it('no self-mail, and no repeat report to a coordinator, for a provider token', () => {
    for (const err of PROVIDER_FAILURE_ERRORS) {
      expect(stallFailedVerdict(failed(err), NOW), err).toEqual({ act: 'none' });
      const prior = { mode: 'live' as const, arm: 'failed' as const, rung: 1 as const, key: NOW - H, at: NOW - H };
      expect(stallFailedVerdict({ ...failed(err), notices: [prior] }, NOW), `${err}, a second in the window`).toEqual({ act: 'none' });
    }
  });
  it('max_output_tokens keeps its path and a request error still reaches the coordinator', () => {
    expect(stallFailedVerdict(failed('max_output_tokens'), NOW)).toMatchObject({ act: 'notify', arm: 'failed', rung: 1 });
    expect(stallFailedVerdict(failed('invalid_request'), NOW)).toMatchObject({ act: 'notify', arm: 'failed', rung: 2, to: 'coordinator' });
  });
});

describe('the mail', () => {
  it('the subject carries its due time, and reads back only as this mail', () => {
    const s = providerRetrySubject(T);
    expect(s.startsWith(PROVIDER_RETRY_PREFIX)).toBe(true);
    expect(providerRetryDueOf(s)).toBe(T);
    for (const bad of ['', 'provider retry:', `${s} `, s.replace('due', 'x'), 'provider retry: your turn ended on a provider error (due 2026-13-45T00:00:00.000Z)']) {
      expect(providerRetryDueOf(bad), bad).toBeNull();
    }
  });
  it('only the server\'s own is one: a session cannot send the line', () => {
    expect(isProviderRetryMail({ fromId: 'operator', subject: providerRetrySubject(T) })).toBe(true);
    expect(isProviderRetryMail({ fromId: 'lane-b-project-b', subject: providerRetrySubject(T) })).toBe(false);
  });
  it('the body asks for no mail to anyone', () => {
    expect(PROVIDER_RETRY_BODY).toBe('Your turn ended on a provider error; continue where you stopped.');
    expect(renderProviderRetryLine()).toBe(`${INJECTED_PROMPTS['mail-nudge'].text} ${PROVIDER_RETRY_BODY}`);
    expect(renderProviderRetryLine()).not.toMatch(/coordinator|ccrc-api|report/i);
  });
  it('the lane types its line to any session, acks it as typed, and refuses a person\'s draft', () => {
    const n = mailNudgeOf(SID, { fromId: 'operator', subject: providerRetrySubject(T), body: PROVIDER_RETRY_BODY });
    expect(n).toEqual({ line: renderProviderRetryLine(), operatorMessageId: null, firstDelivery: 'none', draft: 'refuse' });
    expect(resumeRuleOf(n, null)).toEqual({ onDraft: 'refuse' });
    expect(resumeRuleOf(n, 'a person is writing')).toEqual({ onDraft: 'refuse' });
    expect(resumeRuleOf(n, n.line)).toEqual({ resumeIfOwn: 'whole', onDraft: 'refuse' });
  });
  it('no other mail refuses a draft: the generic nudge and the other fixed lines keep the stash', () => {
    const generic = mailNudgeOf(SID, { fromId: 'lane-b-project-b', subject: providerRetrySubject(T) });
    expect(generic).toEqual({ line: renderMailNudge(SID), operatorMessageId: null });
    expect(resumeRuleOf(generic, 'x')).toEqual({ resumeIfOwn: true });
    expect(resumeRuleOf({ line: 'l', operatorMessageId: 7 }, 'x')).toEqual({});
  });
  it('a refused draft is a hold: no attempt, no park, no notice, even past every ceiling', () => {
    for (const d of [{ attempts: 0, deliveredAt: null, parkedAt: null, lastError: null }, { attempts: 99, deliveredAt: null, parkedAt: 1, lastError: 'draft-present' }]) {
      expect(decideSendFailure(d, 'draft-present', NOW)).toEqual({ gate: null,
        action: { kind: 'hold', why: 'draft-present', until: NOW + MAIL_TURN_HOLD_MS, tellSender: false } });
    }
  });
});

describe('providerRetry.ts, providerOutage.ts and stopFailure.ts are the L1 modules they say they are', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = (f: string): string => readFileSync(path.join(here, '..', 'src', 'coord', f), 'utf8');
  it.each(['providerRetry.ts', 'providerOutage.ts', 'stopFailure.ts'])('%s reads no clock, imports no node builtin and no store', (f) => {
    const c = src(f);
    expect(c).not.toMatch(/Date\.now|setTimeout|setInterval|from 'node:|from '\.\/db|from '\.\/store|fastify/);
  });
});
