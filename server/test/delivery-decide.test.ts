// ARCH-19 (GitHub #539): the delivery deciders in `coord/delivery.ts`, driven with facts and no I/O. Every guard of
// `decideSendFailure` that one input can trip together with the next has a row naming the EARLIER guard as the answer,
// so a swapped pair goes red (the recorded reorder mutants are in the PR body). `mail-delivery-characterization.test.ts`
// holds the same choices through the real sweep, and `mail-sweep.test.ts` the behaviour around them.
//
// THE ACCEPTANCE PINS at the end: `watch.ts` carries no delivery-family `MailRejectCode` literal (`undeliverable`; the
// file still quotes `registry-unmeasurable` as a gate and `unauthenticated` in the PR sweep, neither a rejection) and
// writes a rejection only through the one executor. That every `DeliveryAction` kind reaches an executor is held by the
// compiler, not here: `actOnSendFailure`'s last arm hands the narrowed rest to `settleDelivery`, typed `SettleAction`,
// so a new kind fails the typecheck.
import { describe, it, expect } from 'vitest';
import { MAIL_MAX_ATTEMPTS } from '../../shared/api.js';
import { codeLines } from './growthCheck.js';
import { stringPieces } from './scan/parse.js';
import { callsIn, parsedFile, sourceOfSymbol, symbolOf } from './scan/symbols.js';
import {
  decideParked, decideRecipientAbsent, decideReplayCeiling, decideSendFailure, decideSessionDead, decideTmuxUnknown,
  MAIL_ARMED_HOLD_MS, MAIL_BACKOFF_BASE_MS, MAIL_BACKOFF_MAX_MS, MAIL_PARK_CEILING_MS, MAIL_PARK_ESCALATE_MS,
  MAIL_PARK_RETRY_MS, MAIL_REPLAY_CEILING_ERROR, MAIL_REPLAY_MAX_ATTEMPTS, MAIL_TURN_HOLD_MS, type DeliveryAction, type DueFacts,
} from '../src/coord/delivery.js';

const NOW = 1_800_000_000_000;
const fresh: DueFacts = { attempts: 0, deliveredAt: null, parkedAt: null, lastError: null };
const LAST = MAIL_MAX_ATTEMPTS - 1;   // one failure short of the ceiling: the next one reaches it
const step = (attempts: number): number => Math.min(MAIL_BACKOFF_BASE_MS * 2 ** (attempts - 1), MAIL_BACKOFF_MAX_MS);

describe('decideSendFailure: the guard order (ARCH-19)', () => {
  const kind = (d: Partial<DueFacts>, error: string): DeliveryAction['kind'] =>
    decideSendFailure({ ...fresh, ...d }, error, NOW).action.kind;

  it('an armed auto-continue holds ahead of the attempts ceiling: a hold is not a failed send', () => {
    expect(decideSendFailure({ ...fresh, attempts: LAST }, 'auto-continue-armed', NOW).action)
      .toEqual({ kind: 'hold', why: 'auto-continue-armed', until: NOW + MAIL_ARMED_HOLD_MS, tellSender: true });
  });
  it('an armed auto-continue holds ahead of a row that is already parked past the park ceiling', () => {
    expect(kind({ parkedAt: NOW - MAIL_PARK_CEILING_MS - 1 }, 'auto-continue-armed')).toBe('hold');
  });
  it('the sender is told of an armed hold once: not when the row already carries it', () => {
    const r = decideSendFailure({ ...fresh, lastError: 'auto-continue-armed' }, 'auto-continue-armed', NOW).action;
    expect(r).toMatchObject({ kind: 'hold', tellSender: false });
  });
  it('a running turn holds ahead of the attempts ceiling, and tells nobody', () => {
    expect(decideSendFailure({ ...fresh, attempts: LAST }, 'turn-running', NOW).action)
      .toEqual({ kind: 'hold', why: 'turn-running', until: NOW + MAIL_TURN_HOLD_MS, tellSender: false });
  });
  it('a running turn holds ahead of a park ceiling already passed', () => {
    expect(kind({ parkedAt: NOW - MAIL_PARK_CEILING_MS - 1 }, 'turn-running')).toBe('hold');
  });
  it('enter-ignored parks at once, ahead of the back-off', () => {
    expect(decideSendFailure(fresh, 'enter-ignored', NOW).action)
      .toEqual({ kind: 'park', reason: 'enter-ignored', retryAt: NOW + MAIL_PARK_RETRY_MS, tellSender: true, escalate: false });
  });
  it('a delivered row never parks, ahead of every park trigger: it backs off and counts', () => {
    for (const error of ['enter-ignored', 'stash-failed']) {
      const a = decideSendFailure({ ...fresh, attempts: LAST, deliveredAt: NOW - 1, parkedAt: NOW - 5 }, error, NOW).action;
      expect(a, error).toEqual({ kind: 'backOff', why: error, until: NOW + step(MAIL_MAX_ATTEMPTS), countsAsAttempt: true });
    }
  });
  it('the park ceiling rejects ahead of re-parking, and names the failure to the sender', () => {
    expect(decideSendFailure({ ...fresh, parkedAt: NOW - MAIL_PARK_CEILING_MS }, 'stash-failed', NOW).action).toEqual({
      kind: 'reject', code: 'undeliverable', error: 'parked 24 h, never delivered: stash-failed', told: { reason: 'stash-failed' } });
  });
  it('an already parked row inside the ceiling re-parks and tells nobody again', () => {
    expect(decideSendFailure({ ...fresh, parkedAt: NOW - 1 }, 'stash-failed', NOW).action)
      .toMatchObject({ kind: 'park', tellSender: false, escalate: false });
  });
  it('the attempts ceiling parks a refusal other than enter-ignored, and asks for the operator escalation', () => {
    expect(decideSendFailure({ ...fresh, attempts: LAST }, 'verify-failed', NOW).action)
      .toMatchObject({ kind: 'park', tellSender: true, escalate: true });
  });
  it('one short of the ceiling it backs off on the schedule and counts', () => {
    expect(decideSendFailure({ ...fresh, attempts: LAST - 1 }, 'verify-failed', NOW).action)
      .toEqual({ kind: 'backOff', why: 'verify-failed', until: NOW + step(LAST), countsAsAttempt: true });
  });
  it('names the stash refusals as the gate, whatever the action', () => {
    expect(decideSendFailure(fresh, 'stash-failed', NOW).gate).toBe('stash-failed');
    expect(decideSendFailure({ ...fresh, attempts: LAST }, 'stash-occupied', NOW).gate).toBe('stash-occupied');
    expect(decideSendFailure(fresh, 'dialog-open', NOW).gate).toBeNull();
    expect(decideSendFailure(fresh, 'auto-continue-armed', NOW).gate).toBeNull();
  });
});

describe('the rungs before the send (ARCH-19)', () => {
  it('a proven-absent recipient rejects at the ceiling, with the purge sentence once the row was delivered', () => {
    expect(decideRecipientAbsent({ attempts: LAST, deliveredAt: null }, false, NOW))
      .toEqual({ kind: 'reject', code: 'undeliverable', error: 'recipient not in registry', told: null });
    expect(decideRecipientAbsent({ attempts: LAST, deliveredAt: 1 }, false, NOW))
      .toMatchObject({ kind: 'reject', error: 'recipient purged after this message was delivered, and never acked' });
  });
  it('an unmeasurable recipient never rejects, ahead of the ceiling, and counts no attempt', () => {
    expect(decideRecipientAbsent({ attempts: LAST, deliveredAt: null }, true, NOW)).toEqual({
      kind: 'backOff', why: 'registry row listed but unreadable (registry-unmeasurable)', until: NOW + step(MAIL_MAX_ATTEMPTS),
      countsAsAttempt: false });
  });
  it('an absent recipient below the ceiling backs off and counts', () => {
    expect(decideRecipientAbsent({ attempts: 2, deliveredAt: null }, false, NOW))
      .toEqual({ kind: 'backOff', why: 'recipient not in registry', until: NOW + step(3), countsAsAttempt: true });
  });
  it('a dead session rejects a never-delivered row at the ceiling, and never a delivered one', () => {
    expect(decideSessionDead({ attempts: LAST, deliveredAt: null }, 'stopped', NOW))
      .toEqual({ kind: 'reject', code: 'undeliverable', error: 'recipient session is stopped', told: null });
    expect(decideSessionDead({ attempts: LAST, deliveredAt: 1 }, 'stopped', NOW))
      .toEqual({ kind: 'backOff', why: 'recipient session is stopped', until: NOW + step(MAIL_MAX_ATTEMPTS), countsAsAttempt: true });
  });
  it('tmux not answering backs off without counting, on the attempts as they stand', () => {
    expect(decideTmuxUnknown({ attempts: 3 }, 'boom', NOW)).toEqual({
      kind: 'backOff', why: 'tmux did not answer (substrate-unknown): boom', until: NOW + MAIL_BACKOFF_BASE_MS * 8,
      countsAsAttempt: false });
  });
});

describe('the ceilings (ARCH-19)', () => {
  const parked = { parkedAt: NOW - 1_000, parkReason: 'stash-failed', parkEscalatedAt: null, nextAttemptAt: NOW + 1_000 };
  it('a parked row inside the ceiling is kept; its escalation is due at 15 minutes and its timer decides waiting', () => {
    expect(decideParked(parked, NOW)).toEqual({ kind: 'keep', escalate: false, waiting: true });
    expect(decideParked({ ...parked, parkedAt: NOW - MAIL_PARK_ESCALATE_MS }, NOW)).toMatchObject({ escalate: true });
    expect(decideParked({ ...parked, parkedAt: NOW - MAIL_PARK_ESCALATE_MS, parkEscalatedAt: NOW - 1 }, NOW))
      .toMatchObject({ escalate: false });
    expect(decideParked({ ...parked, nextAttemptAt: NOW }, NOW)).toMatchObject({ waiting: false });
  });
  it('a parked row at the ceiling is rejected ahead of its escalation, the sender told with the reason (or none)', () => {
    const old = { ...parked, parkedAt: NOW - MAIL_PARK_CEILING_MS };
    expect(decideParked(old, NOW)).toEqual({
      kind: 'reject', code: 'undeliverable', error: 'parked 24 h, never delivered: stash-failed', told: { reason: 'stash-failed' } });
    expect(decideParked({ ...old, parkReason: null }, NOW))
      .toMatchObject({ error: 'parked 24 h, never delivered: unknown', told: { reason: null } });
  });
  it('the replay ceiling rejects at the twentieth counted replay and not before', () => {
    expect(decideReplayCeiling(MAIL_REPLAY_MAX_ATTEMPTS - 1)).toBeNull();
    expect(decideReplayCeiling(MAIL_REPLAY_MAX_ATTEMPTS))
      .toEqual({ kind: 'reject', code: 'undeliverable', error: MAIL_REPLAY_CEILING_ERROR, told: null });
  });
});

describe('the acceptance pins (ARCH-19)', () => {
  const WATCH = 'server/src/watch.ts';

  it('watch.ts names no delivery-family MailRejectCode literal: a rejection is written by the one executor, from a decider\'s action', () => {
    const rejects = parsedFile(WATCH).calls.filter((c) => c.name === 'rejectDelivery');
    expect(rejects, 'rejectDelivery is called from settleDelivery alone').toHaveLength(1);
    const settle = symbolOf(WATCH, 'FleetWatcher.settleDelivery');
    expect(rejects[0]!.start >= settle.start && rejects[0]!.end <= settle.end).toBe(true);
    expect(stringPieces(parsedFile(WATCH).text, WATCH).filter((x) => x.text === 'undeliverable')).toEqual([]);
  });
  it('the one executor writes both settling kinds, a back-off and a rejection', () => {
    const calls = callsIn(symbolOf(WATCH, 'FleetWatcher.settleDelivery')).map((c) => c.name);
    expect(calls).toContain('backOff');
    expect(calls).toContain('rejectDelivery');
  });
  it('mailPass is at most 150 code lines (#539 first acceptance criterion)', () => {
    expect(codeLines('watch.ts', sourceOfSymbol(WATCH, 'FleetWatcher.mailPass'))).toBeLessThanOrEqual(150);
  });
  it('the mail lane reaches every policy choice through a decider', () => {
    const names = ['mailPass', 'passParked', 'actOnSendFailure'].flatMap((m) => callsIn(symbolOf(WATCH, `FleetWatcher.${m}`)).map((c) => c.name));
    for (const d of ['decideRecipientAbsent', 'decideSessionDead', 'decideTmuxUnknown', 'decideSendFailure', 'decideParked',
      'decideReplayCeiling']) expect(names, d).toContain(d);
  });
});
