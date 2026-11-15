// The renewal act's L1 deciders, their oracles and their mutant sets (Overlord W1a renewal act, Task 4; the floors rule is
// D-8217's): `renewalPermit`, `renewalFeed`, `renewAnswerEvent`, `renewOwed`, `actsOfStep` and `renewalHoldsMail`
// (`renewalFeed.ts`), `overlordFirst` (`renewalOrder.ts`), `drainVerdict` (`renewalDrain.ts`) and `compactRefusal`
// (`compactOwner.ts`). Each decider's cases are written ONCE here: `continuity-renewal-feed.test.ts` runs them against the
// real modules, and `mutation-floors.test.ts` runs them against each textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { GENERATION_STATES, RENEWAL_LANE_PERIOD_MS, STATE_DEADLINE_S, type GenerationState } from '../../../shared/continuity.js';
import type { HibernateLive, HibernateMark, HibernateRow } from '../../src/coord/hibernate.js';
import type { RenewKind, RenewResult } from '../../src/continuity/sessionHost.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/continuity');
type FeedModule = typeof import('../../src/continuity/renewalFeed.js');
type OrderModule = typeof import('../../src/continuity/renewalOrder.js');
type DrainModule = typeof import('../../src/continuity/renewalDrain.js');
type CompactModule = typeof import('../../src/continuity/compactOwner.js');

// ------------------------------------------------------------------------------------------------------------ overlordFirst

export function overlordFirstCases(m: OrderModule): Record<string, SuiteCase> {
  return {
    'a coordinator renews only while the Overlord is active or has no live generation': () => {
      for (const s of GENERATION_STATES) expect(m.overlordFirst(s), s).toBe(s === 'active');
      expect(m.overlordFirst('none')).toBe(true);
      expect(m.overlordFirst('unmeasured')).toBe(false);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ renewalPermit

const SOFT_START = { start: true } as const;
const SOFT_WAIT = { start: false, waitFor: 'no-break' } as const;

export function permitCases(m: FeedModule): Record<string, SuiteCase> {
  const base = { isCoordinator: true, cls: 'hard' as const, canRenew: true, roleChanged: false, holdOff: false, overlord: 'none' as const, soft: SOFT_WAIT };
  return {
    'a hard trigger starts whatever the soft answer, and keeps its class': () => {
      expect(m.renewalPermit(base)).toEqual({ feed: true, cls: 'hard' });
    },
    'without hibernate-fresh nothing starts, before any other wait': () => {
      expect(m.renewalPermit({ ...base, canRenew: false, overlord: 'draining' })).toEqual({ feed: false, waitFor: 'capability-missing' });
    },
    'a coordinator waits for the Overlord, hard included; an unmeasured Overlord waits too': () => {
      expect(m.renewalPermit({ ...base, overlord: 'draining' })).toEqual({ feed: false, waitFor: 'overlord-first' });
      expect(m.renewalPermit({ ...base, overlord: 'unmeasured' })).toEqual({ feed: false, waitFor: 'overlord-first' });
      expect(m.renewalPermit({ ...base, overlord: 'active' })).toEqual({ feed: true, cls: 'hard' });
    },
    'a session that is not a coordinator never waits for the Overlord': () => {
      expect(m.renewalPermit({ ...base, isCoordinator: false, overlord: 'draining' })).toEqual({ feed: true, cls: 'hard' });
    },
    'a soft trigger takes the soft answer: its wait, or a start': () => {
      expect(m.renewalPermit({ ...base, cls: 'soft', soft: SOFT_WAIT })).toEqual({ feed: false, waitFor: 'no-break' });
      expect(m.renewalPermit({ ...base, cls: 'soft', soft: { start: false, waitFor: 'unmeasured' } })).toEqual({ feed: false, waitFor: 'unmeasured' });
      expect(m.renewalPermit({ ...base, cls: 'soft', soft: SOFT_START })).toEqual({ feed: true, cls: 'soft' });
    },
    'a hold-off that stands holds a hard trigger too, after the host and before the Overlord (review 2149 F1)': () => {
      expect(m.renewalPermit({ ...base, holdOff: true })).toEqual({ feed: false, waitFor: 'hold-off' });
      expect(m.renewalPermit({ ...base, holdOff: true, cls: 'soft', soft: SOFT_START })).toEqual({ feed: false, waitFor: 'hold-off' });
      expect(m.renewalPermit({ ...base, holdOff: true, overlord: 'draining' })).toEqual({ feed: false, waitFor: 'hold-off' });
      expect(m.renewalPermit({ ...base, holdOff: true, canRenew: false })).toEqual({ feed: false, waitFor: 'capability-missing' });
    },
    'a coordinator whose role no longer reads as one waits, before the hold-off (review 2149 F12)': () => {
      expect(m.renewalPermit({ ...base, roleChanged: true })).toEqual({ feed: false, waitFor: 'role-changed' });
      expect(m.renewalPermit({ ...base, roleChanged: true, holdOff: true })).toEqual({ feed: false, waitFor: 'role-changed' });
      expect(m.renewalPermit({ ...base, roleChanged: true, canRenew: false })).toEqual({ feed: false, waitFor: 'capability-missing' });
    },
    'holdOffStands: a hold-off stands until the generation\'s age reaches its end': () => {
      expect(m.holdOffStands({ generationAgeObservedMs: 9, holdOffUntilObservedMs: 10 })).toBe(true);
      expect(m.holdOffStands({ generationAgeObservedMs: 10, holdOffUntilObservedMs: 10 })).toBe(false);
      expect(m.holdOffStands({ generationAgeObservedMs: 0, holdOffUntilObservedMs: null })).toBe(false);
    },
    'the Overlord wait comes before the soft answer': () => {
      expect(m.renewalPermit({ ...base, cls: 'soft', overlord: 'carded', soft: SOFT_START })).toEqual({ feed: false, waitFor: 'overlord-first' });
      expect(m.renewalPermit({ ...base, cls: 'soft', overlord: 'carded', soft: SOFT_WAIT })).toEqual({ feed: false, waitFor: 'overlord-first' });
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- renewalFeed

const T0 = 1_000_000;
const feed = (m: FeedModule, over: Partial<Parameters<FeedModule['renewalFeed']>[0]>) => m.renewalFeed({
  state: 'active', deadlineAt: null, now: T0, due: null, drained: false, handoverAt: null, renudged: false, unansweredClaimAt: null,
  disarmed: false, ...over,
});

export function feedCases(m: FeedModule): Record<string, SuiteCase> {
  return {
    'active: a permitted due is fed; nothing else is': () => {
      expect(feed(m, { due: { cls: 'soft' } })).toEqual([{ kind: 'due', cls: 'soft' }]);
      expect(feed(m, { drained: true, handoverAt: T0 - 1 })).toEqual([]);
    },
    'degraded: only a hard due is fed': () => {
      expect(feed(m, { state: 'degraded', due: { cls: 'hard' } })).toEqual([{ kind: 'due', cls: 'hard' }]);
      expect(feed(m, { state: 'degraded', due: { cls: 'soft' } })).toEqual([]);
    },
    'a due is fed only from rest': () => {
      for (const s of GENERATION_STATES.filter((x) => x !== 'active' && x !== 'degraded')) {
        expect(feed(m, { state: s, due: { cls: 'hard' } }).some((e) => e.kind === 'due'), s).toBe(false);
      }
    },
    'draining: drained is fed when measured, then the deadline when it has passed': () => {
      expect(feed(m, { state: 'draining', deadlineAt: T0 + 1, drained: true })).toEqual([{ kind: 'drained' }]);
      expect(feed(m, { state: 'draining', deadlineAt: T0 + 1, drained: false })).toEqual([]);
      // Drained is measured now: at or after the deadline it is too late, and the deadline is fed alone.
      expect(feed(m, { state: 'draining', deadlineAt: T0, drained: true })).toEqual([{ kind: 'deadline' }]);
    },
    'checkpointed: a handover written before the deadline is fed before it (m6); one written at or after it is not': () => {
      expect(feed(m, { state: 'checkpointed', deadlineAt: T0 - 5, handoverAt: T0 - 6 })).toEqual([{ kind: 'handover' }, { kind: 'deadline' }]);
      expect(feed(m, { state: 'checkpointed', deadlineAt: T0 - 5, handoverAt: T0 - 5 })).toEqual([{ kind: 'deadline' }]);
      expect(feed(m, { state: 'checkpointed', deadlineAt: T0 + 5, handoverAt: T0 - 1 })).toEqual([{ kind: 'handover' }]);
      expect(feed(m, { state: 'checkpointed', deadlineAt: T0 + 5 })).toEqual([]);
    },
    'carded: nudge-due once its nudge point (the deadline less the lane period) has passed, never twice': () => {
      const deadlineAt = T0 + RENEWAL_LANE_PERIOD_MS;
      expect(feed(m, { state: 'carded', deadlineAt })).toEqual([{ kind: 'nudge-due' }]);
      expect(feed(m, { state: 'carded', deadlineAt: deadlineAt + 1 })).toEqual([]);
      expect(feed(m, { state: 'carded', deadlineAt, renudged: true })).toEqual([]);
      // At or after the deadline no nudge is fed: the card is not asked of a generation that degrades now (review 2149 F15).
      expect(feed(m, { state: 'carded', deadlineAt: T0 })).toEqual([{ kind: 'deadline' }]);
      expect(feed(m, { state: 'carded', deadlineAt: T0 + 1 })).toEqual([{ kind: 'nudge-due' }]);
      expect(m.nudgeAtOf(deadlineAt)).toBe(T0);
    },
    'clearing: a try claimed and never answered is fed as after the first half at the deadline, before it (review 2149 F6)': () => {
      expect(feed(m, { state: 'clearing', deadlineAt: T0, unansweredClaimAt: T0 - 50 })).toEqual([{ kind: 'host-failed', afterEnd: true }, { kind: 'deadline' }]);
      expect(feed(m, { state: 'clearing', deadlineAt: T0 + 1, unansweredClaimAt: T0 - 50 })).toEqual([]);
      expect(feed(m, { state: 'carded', deadlineAt: T0 + RENEWAL_LANE_PERIOD_MS + 1, unansweredClaimAt: T0 - 50 })).toEqual([]);
    },
    'a disarmed live walk is fed disarmed alone in every renewing state, and nothing at rest (review 2149 F13)': () => {
      for (const s of GENERATION_STATES) {
        const renewing = ['draining', 'checkpointed', 'clearing', 'carded', 'probing'].includes(s);
        expect(feed(m, { state: s, deadlineAt: renewing ? T0 : null, drained: true, disarmed: true, due: { cls: 'hard' } }), s)
          .toEqual(renewing ? [{ kind: 'disarmed' }] : s === 'active' || s === 'degraded' ? [{ kind: 'due', cls: 'hard' }] : []);
      }
    },
    'every state with a deadline gets one when it has passed, and only then': () => {
      for (const s of ['draining', 'checkpointed', 'clearing', 'carded', 'probing'] as GenerationState[]) {
        expect(feed(m, { state: s, deadlineAt: T0 }).at(-1), s).toEqual({ kind: 'deadline' });
        expect(feed(m, { state: s, deadlineAt: T0 + 1 }).some((e) => e.kind === 'deadline'), s).toBe(false);
      }
    },
    'a handover counts for the walk only when written since checkpointed began, and for a seal only inside its renewal': () => {
      expect(m.handoverSince(T0, T0)).toBe(T0);
      expect(m.handoverSince(T0 - 1, T0)).toBeNull();
      expect(m.handoverSince(null, T0)).toBeNull();
      const longest = STATE_DEADLINE_S.checkpointed * 1_000 + RENEWAL_LANE_PERIOD_MS;
      expect(m.handoverInRenewal(T0 - longest, T0)).toBe(true);
      expect(m.handoverInRenewal(T0 - longest - 1, T0)).toBe(false);
    },
    'beforeDeadline: strictly before, and a state with no deadline takes every fact': () => {
      expect(m.beforeDeadline(T0 - 1, T0)).toBe(true);
      expect(m.beforeDeadline(T0, T0)).toBe(false);
      expect(m.beforeDeadline(T0 + 1, null)).toBe(true);
    },
  };
}

// --------------------------------------------------------------------------------------------- renewAnswerEvent / renewOwed

const ANSWERS: Record<RenewKind, RenewResult> = {
  started: { kind: 'started' }, refused: { kind: 'refused', reason: 'busy' }, 'kill-failed': { kind: 'kill-failed' },
  'capability-missing': { kind: 'capability-missing' }, 'wake-failed': { kind: 'wake-failed' },
  'wake-unrestored': { kind: 'wake-unrestored' }, unproven: { kind: 'unproven' }, unreachable: { kind: 'unreachable', detail: 'x' },
};

export function answerCases(m: FeedModule): Record<string, SuiteCase> {
  return {
    'each renew answer lands on its side of the receipt\'s first half; unknown and unproven count as after it': () => {
      expect(Object.fromEntries(Object.entries(ANSWERS).map(([k, r]) => [k, m.renewAnswerEvent(r)]))).toEqual({
        started: { kind: 'host-ended' },
        refused: { kind: 'host-failed', afterEnd: false }, 'kill-failed': { kind: 'host-failed', afterEnd: false },
        'capability-missing': { kind: 'host-failed', afterEnd: false },
        'wake-failed': { kind: 'host-gave-up' }, 'wake-unrestored': { kind: 'host-failed', afterEnd: true },
        unproven: { kind: 'host-failed', afterEnd: true }, unreachable: { kind: 'host-failed', afterEnd: true },
      });
    },
    'a clearing generation owes its current try once, and nothing outside clearing': () => {
      expect(m.renewOwed('clearing', 1, [])).toBe(1);
      expect(m.renewOwed('clearing', 1, [1])).toBeNull();
      expect(m.renewOwed('clearing', 2, [1])).toBe(2);
      expect(m.renewOwed('clearing', 0, [])).toBeNull();
      for (const s of GENERATION_STATES.filter((x) => x !== 'clearing')) expect(m.renewOwed(s, 1, []), s).toBeNull();
    },
    'a step\'s acts: the checkpoint, the ask, the nudge, the hold-off and the item; never a renew, a hold or a mint': () => {
      expect(m.actsOfStep(['hold-deliveries', 'release-deliveries', 'start-probes', 'mint-next', 'end-this', 'renew'], 'clearing', { kind: 'deadline' })).toEqual([]);
      expect(m.actsOfStep(['assemble-checkpoint', 'ask-handover'], 'draining', { kind: 'drained' }))
        .toEqual([{ kind: 'assemble-checkpoint' }, { kind: 'ask-handover' }]);
      expect(m.actsOfStep(['release-deliveries', 'set-hold-off'], 'clearing', { kind: 'host-failed', afterEnd: false })).toEqual([{ kind: 'set-hold-off' }]);
      expect(m.actsOfStep(['renudge-card', 'start-probes'], 'probing', { kind: 'probes', passed: false })).toEqual([{ kind: 'renudge-card' }]);
      expect(m.actsOfStep(['release-deliveries', 'raise-item'], 'carded', { kind: 'deadline' }))
        .toEqual([{ kind: 'raise-item', why: m.degradeWhy('carded', { kind: 'deadline' }) }, { kind: 'set-hold-off' }]);
    },
    'every step into degraded sets the hold-off too; the item follows the renewal\'s last answer (review 2149 F1, F5)': () => {
      const refused = { kind: 'host-failed', afterEnd: false } as const;
      expect(m.actsOfStep(['release-deliveries', 'raise-item'], 'clearing', refused))
        .toEqual([{ kind: 'raise-item', why: m.degradeWhy('clearing', refused) }, { kind: 'set-hold-off' }]);
      expect(m.actsOfStep(['release-deliveries', 'raise-item'], 'clearing', { kind: 'host-gave-up' }))
        .toEqual([{ kind: 'raise-item', why: m.degradeWhy('clearing', { kind: 'host-gave-up' }) }, { kind: 'set-hold-off' }]);
      expect(m.actsOfStep(['release-deliveries', 'raise-item'], 'clearing', { kind: 'deadline' }, 'unproven'))
        .toEqual([{ kind: 'raise-item', why: m.degradeWhy('clearing', { kind: 'deadline' }), about: 'unproven' }, { kind: 'set-hold-off' }]);
      expect(m.actsOfStep(['release-deliveries', 'set-hold-off'], 'draining', { kind: 'deadline' })).toEqual([{ kind: 'set-hold-off' }]);
    },
    'exit 6 raises its own item whatever the step; no other answer does (review 2149 F4)': () => {
      for (const [k, r] of Object.entries(ANSWERS)) {
        expect(m.answerActs(r), k).toEqual(k === 'kill-failed' ? [{ kind: 'raise-item', why: expect.any(String), about: 'kill-failed' }] : []);
      }
    },
    'a degraded generation re-plans its item on every pass while none stands open on its programme; no other state does (review 2149 F3)': () => {
      for (const s of GENERATION_STATES) {
        expect(m.standingActs(s, 'none'), s).toEqual(s === 'degraded' ? [{ kind: 'raise-item', why: expect.any(String) }] : []);
      }
      expect(m.standingActs('degraded', 'open')).toEqual([]);
      expect(m.standingActs('degraded', 'no-programme')).toEqual([]);
      expect(m.renewalItemPrefix('a', 2)).toBe('Renewal of a (generation 2) degraded');
      expect(m.renewalItemPrefix('a', 2, 'kill-failed')).toBe('Renewal of a (generation 2) stopped its unit');
    },
    'the item\'s words are true for each answer (review 2149 F5): asleep on 4, nothing proven on 5, the old conversation on 7': () => {
      expect(m.itemStandsWords('wake-failed')).toMatch(/sleep/);
      expect(m.itemStandsWords('wake-unrestored')).toMatch(/no conversation running/);
      expect(m.itemStandsWords('unproven')).toMatch(/old conversation/);
      expect(m.itemStandsWords('kill-failed')).toMatch(/unsupervised/);
      expect(m.itemStandsWords(undefined)).toMatch(/current conversation/);
      for (const a of ['wake-failed', 'wake-unrestored', 'unproven', 'unreachable', 'kill-failed']) expect(m.itemAboutOf(a), a).toBe(a);
      for (const a of ['started', 'refused', 'capability-missing', null]) expect(m.itemAboutOf(a), String(a)).toBeUndefined();
    },
    'the degraded item says why, by the state left and the event': () => {
      expect(m.degradeWhy('probing', { kind: 'probes', passed: false })).toMatch(/second probe round failed/);
      expect(m.degradeWhy('clearing', { kind: 'deadline' })).toMatch(/clearing deadline/);
      expect(m.degradeWhy('carded', { kind: 'deadline' })).toMatch(/card/);
      expect(m.degradeWhy('clearing', { kind: 'host-gave-up' })).toMatch(/could not wake/);
      expect(m.degradeWhy('carded', { kind: 'disarmed' })).toMatch(/switched off/);
    },
  };
}

// --------------------------------------------------------------------------------------------------------- renewalHoldsMail

export function holdsMailCases(m: FeedModule): Record<string, SuiteCase> {
  const peer = { fromId: 'lane-a-project-a', subject: 'hello' };
  const ask = { fromId: 'operator', subject: m.RENEWAL_HANDOVER_SUBJECT };
  return {
    'deliveries are held from draining to probing, and released at rest': () => {
      for (const s of GENERATION_STATES) {
        expect(m.renewalHoldsMail(s, peer), s).toBe(['draining', 'checkpointed', 'clearing', 'carded', 'probing'].includes(s));
      }
      expect(m.renewalHoldsMail(undefined, peer)).toBe(false);
    },
    'the handover ask passes the gate; the same subject from anyone else does not; an unread origin is held': () => {
      expect(m.renewalHoldsMail('checkpointed', ask)).toBe(false);
      expect(m.renewalHoldsMail('checkpointed', { fromId: 'coordinator', subject: m.RENEWAL_HANDOVER_SUBJECT })).toBe(true);
      expect(m.renewalHoldsMail('checkpointed', { fromId: 'operator', subject: 'stall-check' })).toBe(true);
      expect(m.renewalHoldsMail('checkpointed', null)).toBe(true);
    },
    'the handover ask passes only while the note is asked for: draining and checkpointed (review 2149 F10)': () => {
      for (const s of ['draining', 'checkpointed', 'clearing', 'carded', 'probing'] as GenerationState[]) {
        expect(m.renewalHoldsMail(s, ask), s).toBe(s !== 'draining' && s !== 'checkpointed');
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- drainVerdict

const NOW = 50_000_000;
const ROW: HibernateRow = {
  id: 'lane-a-project-a', status: 'idle', archivedAt: null, bucket: 'idle', held: null, unmeasured: [], statusUnmeasured: false,
  dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null, substrate: null,
};
const MARK: Extract<HibernateMark, { ok: true }> = { ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 2_000, stopAt: NOW - 1_000, restartAt: null };
const LIVE = (word = 'idle', mark: HibernateMark = MARK): HibernateLive => ({ kind: 'read', word: { ok: true, word }, mark });

export function drainCases(m: DrainModule): Record<string, SuiteCase> {
  return {
    'a finished turn of an idle pane is drained at once: no quiet window': () => {
      expect(m.drainVerdict(ROW, LIVE(), NOW)).toEqual({ held: false });
    },
    'the facts a renewal sets aside do not hold: a done badge, a programme hold': () => {
      expect(m.drainVerdict({ ...ROW, bucket: 'done', held: 'program:a wave:1/2' }, LIVE(), NOW)).toEqual({ held: false });
    },
    'the facts it keeps hold: a running turn, a menu, background work, subagents, scheduled work, an unfinished marker': () => {
      expect(m.drainVerdict(ROW, LIVE('busy'), NOW)).toEqual({ held: true, reason: 'live-word' });
      expect(m.drainVerdict({ ...ROW, dialogPending: true }, LIVE(), NOW)).toMatchObject({ held: true });
      expect(m.drainVerdict({ ...ROW, background: 'shell' } as unknown as HibernateRow, LIVE(), NOW)).toEqual({ held: true, reason: 'background' });
      expect(m.drainVerdict({ ...ROW, subagents: [{ id: 'x' }] } as unknown as HibernateRow, LIVE(), NOW)).toEqual({ held: true, reason: 'roster' });
      expect(m.drainVerdict(ROW, LIVE('idle', { ...MARK, crons: 1 }), NOW)).toEqual({ held: true, reason: 'scheduled' });
      expect(m.drainVerdict(ROW, LIVE('idle', { ...MARK, bg: 1 }), NOW)).toEqual({ held: true, reason: 'marker-background' });
      expect(m.drainVerdict(ROW, LIVE('idle', { ...MARK, state: 'working' }), NOW)).toEqual({ held: true, reason: 'marker' });
    },
    'an unread live state and an unmeasured pane hold, never drain': () => {
      expect(m.drainVerdict(ROW, { kind: 'unread' }, NOW)).toEqual({ held: true, reason: 'unmeasured' });
      expect(m.drainVerdict(ROW, { kind: 'read', word: { ok: false, reason: 'unmeasured' }, mark: MARK }, NOW)).toEqual({ held: true, reason: 'unmeasured' });
      expect(m.drainVerdict(ROW, LIVE('idle', { ok: false, reason: 'unreadable' }), NOW)).toEqual({ held: true, reason: 'marker' });
    },
  };
}

// ----------------------------------------------------------------------------------------------------------- compactRefusal

export function compactCases(m: CompactModule): Record<string, SuiteCase> {
  return {
    'compact is refused while continuity and launch-profile are both live, with the reason; any other field passes': () => {
      const rows = (...on: string[]) => (lane: string): boolean => on.includes(lane);
      expect(m.compactRefusal('compact', rows('continuity', 'launch-profile'))).toBe(m.COMPACT_OWNED_DETAIL);
      for (const f of ['class', 'effort', 'subagent', 'workflow', 'browser']) expect(m.compactRefusal(f, rows('continuity', 'launch-profile')), f).toBeNull();
    },
    'one row in shadow, or both, and the doors write compact as before (review 2149 F11)': () => {
      const rows = (...on: string[]) => (lane: string): boolean => on.includes(lane);
      expect(m.compactRefusal('compact', rows('continuity'))).toBeNull();
      expect(m.compactRefusal('compact', rows('launch-profile'))).toBeNull();
      expect(m.compactRefusal('compact', rows())).toBeNull();
    },
  };
}

// --------------------------------------------------------------------------------------------------------------- the sets

const FEED_TS = path.join(SRC, 'renewalFeed.ts');
const allFeed = (m: FeedModule): Record<string, SuiteCase> =>
  ({ ...permitCases(m), ...feedCases(m), ...answerCases(m), ...holdsMailCases(m) });

const PERMIT_SET: MutantSet<FeedModule> = {
  modulePath: FEED_TS,
  mutants: [
    { id: 'P1 the host unchecked', old: "  if (!i.canRenew) return { feed: false, waitFor: 'capability-missing' };\n", new: '' },
    { id: 'P2 a hard coordinator skips the Overlord', old: "if (i.isCoordinator && !overlordFirst(i.overlord))", new: "if (i.isCoordinator && i.cls === 'soft' && !overlordFirst(i.overlord))" },
    { id: 'P3 a hard trigger takes the soft answer', old: "if (i.cls === 'soft' && !i.soft.start)", new: 'if (!i.soft.start)' },
    { id: 'P4 the soft answer before the Overlord', old: "  if (i.isCoordinator && !overlordFirst(i.overlord)) return { feed: false, waitFor: 'overlord-first' };\n  if (i.cls === 'soft' && !i.soft.start) return { feed: false, waitFor: i.soft.waitFor };",
      new: "  if (i.cls === 'soft' && !i.soft.start) return { feed: false, waitFor: i.soft.waitFor };\n  if (i.isCoordinator && !overlordFirst(i.overlord)) return { feed: false, waitFor: 'overlord-first' };" },
    { id: 'P5 a hard trigger ignores the hold-off', old: "  if (i.holdOff) return { feed: false, waitFor: 'hold-off' };\n", new: '' },
    { id: 'P6 the role not re-read', old: "  if (i.roleChanged) return { feed: false, waitFor: 'role-changed' };\n", new: '' },
    { id: 'P7 a hold-off that ended still stands', old: 't.generationAgeObservedMs < t.holdOffUntilObservedMs', new: 't.generationAgeObservedMs <= t.holdOffUntilObservedMs' },
  ],
  suite: allFeed,
};

const FEED_SET: MutantSet<FeedModule> = {
  modulePath: FEED_TS,
  mutants: [
    { id: 'F1 the deadline fed first', old: '  const events = stamped.filter((s) => beforeDeadline(s.at, f.deadlineAt)).sort((a, b) => a.at - b.at).map((s) => s.event);\n  if (f.deadlineAt !== null && f.now >= f.deadlineAt) events.push({ kind: \'deadline\' });',
      new: '  const events: GenEvent[] = [];\n  if (f.deadlineAt !== null && f.now >= f.deadlineAt) events.push({ kind: \'deadline\' });\n  events.push(...stamped.filter((s) => beforeDeadline(s.at, f.deadlineAt)).sort((a, b) => a.at - b.at).map((s) => s.event));' },
    { id: 'F2 a late fact fed', old: 'const events = stamped.filter((s) => beforeDeadline(s.at, f.deadlineAt))', new: 'const events = stamped.filter(() => true)' },
    { id: 'F3 the boundary inclusive', old: 'return deadlineAt === null || at < deadlineAt;', new: 'return deadlineAt === null || at <= deadlineAt;' },
    { id: 'F4 a soft due from degraded', old: "(f.state === 'degraded' && f.due.cls === 'hard')", new: "f.state === 'degraded'" },
    { id: 'F5 the nudge every pass', old: "if (f.state === 'carded' && !f.renudged && f.deadlineAt !== null", new: "if (f.state === 'carded' && f.deadlineAt !== null" },
    { id: 'F6 the nudge point at the deadline', old: 'return deadlineAt - RENEWAL_LANE_PERIOD_MS;', new: 'return deadlineAt;' },
    { id: 'F7 the deadline one tick late', old: 'if (f.deadlineAt !== null && f.now >= f.deadlineAt) events.push', new: 'if (f.deadlineAt !== null && f.now > f.deadlineAt) events.push' },
    { id: 'F8 drained outside draining', old: "if (f.state === 'draining' && f.drained)", new: 'if (f.drained)' },
    { id: 'F9 an earlier renewal\'s handover counts', old: 'return handoverAt !== null && handoverAt >= checkpointedSince ? handoverAt : null;', new: 'return handoverAt;' },
    { id: 'F10 the seal takes any note', old: 'return handoverAt >= episode - (STATE_DEADLINE_S.checkpointed * 1_000 + RENEWAL_LANE_PERIOD_MS);', new: 'return true;' },
    { id: 'F12 a nudge at the deadline', old: ' && f.now < f.deadlineAt) {', new: ') {' },
    { id: 'F13 an unanswered try read as before the first half', old: "event: { kind: 'host-failed', afterEnd: true } });", new: "event: { kind: 'host-failed', afterEnd: false } });" },
    { id: 'F14 an unanswered try ignored', old: "  if (f.state === 'clearing' && f.unansweredClaimAt !== null", new: "  if (false && f.state === 'clearing' && f.unansweredClaimAt !== null" },
    { id: 'F15 a disarmed walk walks on', old: "  if (f.disarmed && RENEWING_STATES.has(f.state)) return [{ kind: 'disarmed' }];\n", new: '' },
    { id: 'F11 the seal window a lane period short', old: 'return handoverAt >= episode - (STATE_DEADLINE_S.checkpointed * 1_000 + RENEWAL_LANE_PERIOD_MS);', new: 'return handoverAt >= episode - STATE_DEADLINE_S.checkpointed * 1_000;' },
  ],
  suite: allFeed,
};

const ANSWER_SET: MutantSet<FeedModule> = {
  modulePath: FEED_TS,
  mutants: [
    { id: 'A1 unreachable read as before the first half', old: "case 'wake-unrestored': case 'unproven': case 'unreachable': return { kind: 'host-failed', afterEnd: true };",
      new: "case 'unreachable': return { kind: 'host-failed', afterEnd: false };\n    case 'wake-unrestored': case 'unproven': return { kind: 'host-failed', afterEnd: true };" },
    { id: 'A2 unproven read as before', old: "case 'wake-unrestored': case 'unproven': case 'unreachable':", new: "case 'unproven': return { kind: 'host-failed', afterEnd: false };\n    case 'wake-unrestored': case 'unreachable':" },
    { id: 'A4 wake-failed retried', old: "case 'wake-failed': return { kind: 'host-gave-up' };", new: "case 'wake-failed': return { kind: 'host-failed', afterEnd: true };" },
    { id: 'A5 exit 6 raises no item', old: "return answer.kind === 'kill-failed' ? [", new: "return answer.kind === 'never' as string ? [" },
    { id: 'A6 the degraded item not re-planned', old: "return state === 'degraded' && item === 'none' ? [", new: "return state === 'never' as string && item === 'none' ? [" },
    { id: 'A8 re-planned over an open item', old: "return state === 'degraded' && item === 'none' ? [", new: "return state === 'degraded' && item !== 'no-programme' ? [" },
    { id: 'A7 every item says the session works on', old: '  switch (about) {\n', new: '  switch (undefined as ItemAbout | undefined) {\n' },
    { id: 'A3 a kill failure read as after', old: "case 'refused': case 'kill-failed': case 'capability-missing':", new: "case 'kill-failed': return { kind: 'host-failed', afterEnd: true };\n    case 'refused': case 'capability-missing':" },
    { id: 'O1 a claimed try owed again', old: 'return claimedTries.includes(attempts) ? null : attempts;', new: 'return attempts;' },
    { id: 'O2 owed outside clearing', old: "if (state !== 'clearing' || attempts < 1) return null;", new: 'if (attempts < 1) return null;' },
    { id: 'S1 a renew run straight off a step', old: "if (a === 'assemble-checkpoint' || a === 'ask-handover' || a === 'renudge-card' || a === 'set-hold-off') out.push({ kind: a });",
      new: "if (a === 'assemble-checkpoint' || a === 'ask-handover' || a === 'renudge-card' || a === 'set-hold-off') out.push({ kind: a });\n    else if (a === 'renew') out.push({ kind: 'renew', try: 1 });" },
    { id: 'S2 the hold-off dropped', old: "a === 'renudge-card' || a === 'set-hold-off')", new: "a === 'renudge-card')" },
    { id: 'S3 a degraded generation sets no hold-off', old: "  if (actions.includes('raise-item') && !actions.includes('set-hold-off'))", new: "  if (false && actions.includes('raise-item') && !actions.includes('set-hold-off'))" },
    { id: 'S4 the item forgets the last answer', old: "out.push(about === undefined ? { kind: 'raise-item', why: degradeWhy(from, event) } :", new: "out.push(true ? { kind: 'raise-item', why: degradeWhy(from, event) } :" },
  ],
  suite: allFeed,
};

const HOLDS_MAIL_SET: MutantSet<FeedModule> = {
  modulePath: FEED_TS,
  mutants: [
    { id: 'H1 the handover ask held', old: "  return !(HANDOVER_STATES.has(state) && origin !== null && origin.fromId === 'operator' && origin.subject === RENEWAL_HANDOVER_SUBJECT);", new: '  return true;' },
    { id: 'H2 any sender\'s handover passes', old: "origin.fromId === 'operator' && origin.subject", new: 'origin.subject' },
    { id: 'H3 an unread origin passes', old: '!(HANDOVER_STATES.has(state) && origin !== null && origin.fromId', new: '!(origin === null || HANDOVER_STATES.has(state) && origin.fromId' },
    { id: 'H5 the handover ask passes in every renewing state', old: '!(HANDOVER_STATES.has(state) && origin', new: '!(origin' },
    { id: 'H4 probing released early', old: "'clearing', 'carded', 'probing']);", new: "'clearing', 'carded']);" },
  ],
  suite: allFeed,
};

const ORDER_SET: MutantSet<OrderModule> = {
  modulePath: path.join(SRC, 'renewalOrder.ts'),
  mutants: [
    { id: 'R1 an unmeasured Overlord lets a coordinator renew', old: "return overlord === 'none' || overlord === 'active';", new: "return overlord === 'none' || overlord === 'active' || overlord === 'unmeasured';" },
    { id: 'R2 a degraded Overlord lets a coordinator renew', old: "return overlord === 'none' || overlord === 'active';", new: "return overlord === 'none' || overlord === 'active' || overlord === 'degraded';" },
    { id: 'R3 no Overlord holds every coordinator', old: "return overlord === 'none' || overlord === 'active';", new: "return overlord === 'active';" },
  ],
  suite: overlordFirstCases,
};

const DRAIN_SET: MutantSet<DrainModule> = {
  modulePath: path.join(SRC, 'renewalDrain.ts'),
  mutants: [
    { id: 'D1 the done badge holds', old: "row: { ...row, bucket: 'idle', held: null },", new: "row: { ...row, held: null }," },
    { id: 'D2 a programme hold holds', old: "row: { ...row, bucket: 'idle', held: null },", new: "row: { ...row, bucket: 'idle' }," },
    { id: 'D3 a quiet window of an hour', old: '  }, now, 0);', new: '  }, now, 3_600_000);' },
    { id: 'D4 measure read as drained', old: "  if (v.act === 'hibernate') return { held: false };", new: "  if (v.act !== 'hold') return { held: false };" },
  ],
  suite: drainCases,
};

const COMPACT_SET: MutantSet<CompactModule> = {
  modulePath: path.join(SRC, 'compactOwner.ts'),
  mutants: [
    { id: 'C1 refused in shadow too', old: "return field === 'compact' && live(CONTINUITY_LANE) && live(LAUNCH_PROFILE_LANE)", new: "return field === 'compact'" },
    { id: 'C2 never refused', old: "return field === 'compact' && live(CONTINUITY_LANE) && live(LAUNCH_PROFILE_LANE) ? COMPACT_OWNED_DETAIL : null;", new: 'return null;' },
    { id: 'C3 continuity alone refuses', old: ' && live(LAUNCH_PROFILE_LANE)', new: '' },
    { id: 'C4 launch-profile alone refuses', old: ' && live(CONTINUITY_LANE)', new: '' },
  ],
  suite: compactCases,
};

export const RENEWAL_ACT_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/renewalFeed.ts#renewalPermit': PERMIT_SET as MutantSet<never>,
  'server/src/continuity/renewalFeed.ts#renewalFeed': FEED_SET as MutantSet<never>,
  'server/src/continuity/renewalFeed.ts#renewAnswerEvent': ANSWER_SET as MutantSet<never>,
  'server/src/continuity/renewalFeed.ts#renewalHoldsMail': HOLDS_MAIL_SET as MutantSet<never>,
  'server/src/continuity/renewalOrder.ts#overlordFirst': ORDER_SET as MutantSet<never>,
  'server/src/continuity/renewalDrain.ts#drainVerdict': DRAIN_SET as MutantSet<never>,
  'server/src/continuity/compactOwner.ts#compactRefusal': COMPACT_SET as MutantSet<never>,
};
