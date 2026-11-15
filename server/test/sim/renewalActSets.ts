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
  const base = { isCoordinator: true, cls: 'hard' as const, canRenew: true, overlord: 'none' as const, soft: SOFT_WAIT };
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
    'the Overlord wait comes before the soft answer': () => {
      expect(m.renewalPermit({ ...base, cls: 'soft', overlord: 'carded', soft: SOFT_START })).toEqual({ feed: false, waitFor: 'overlord-first' });
      expect(m.renewalPermit({ ...base, cls: 'soft', overlord: 'carded', soft: SOFT_WAIT })).toEqual({ feed: false, waitFor: 'overlord-first' });
    },
  };
}

// ------------------------------------------------------------------------------------------------------------- renewalFeed

const T0 = 1_000_000;
const feed = (m: FeedModule, over: Partial<Parameters<FeedModule['renewalFeed']>[0]>) => m.renewalFeed({
  state: 'active', deadlineAt: null, now: T0, due: null, drained: false, handoverAt: null, renudged: false, ...over,
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
      expect(feed(m, { state: 'carded', deadlineAt: T0 })).toEqual([{ kind: 'nudge-due' }, { kind: 'deadline' }]);
      expect(m.nudgeAtOf(deadlineAt)).toBe(T0);
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
        'wake-failed': { kind: 'host-failed', afterEnd: true }, 'wake-unrestored': { kind: 'host-failed', afterEnd: true },
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
        .toEqual([{ kind: 'raise-item', why: m.degradeWhy('carded', { kind: 'deadline' }) }]);
    },
    'the degraded item says why, by the state left and the event': () => {
      expect(m.degradeWhy('probing', { kind: 'probes', passed: false })).toMatch(/second probe round failed/);
      expect(m.degradeWhy('clearing', { kind: 'deadline' })).toMatch(/clearing deadline/);
      expect(m.degradeWhy('carded', { kind: 'deadline' })).toMatch(/card/);
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
  };
}

// ------------------------------------------------------------------------------------------------------------- drainVerdict

const NOW = 50_000_000;
const ROW: HibernateRow = {
  id: 'lane-a-project-a', status: 'idle', archivedAt: null, bucket: 'idle', held: null, unmeasured: [], statusUnmeasured: false,
  dialogPending: false, background: null, subagents: null, stranded: null, swapBlocked: null, substrate: null,
};
const MARK: HibernateMark = { ok: true, state: 'done', bg: 0, crons: 0, turnAt: NOW - 2_000, stopAt: NOW - 1_000, restartAt: null };
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
      expect(m.drainVerdict({ ...ROW, background: 'shell' } as HibernateRow, LIVE(), NOW)).toEqual({ held: true, reason: 'background' });
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
    'compact is refused while continuity is live, with the reason; any other field, or shadow, passes': () => {
      expect(m.compactRefusal('compact', true)).toBe(m.COMPACT_OWNED_DETAIL);
      expect(m.compactRefusal('compact', false)).toBeNull();
      for (const f of ['class', 'effort', 'subagent', 'workflow', 'browser']) expect(m.compactRefusal(f, true), f).toBeNull();
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
    { id: 'F11 the seal window a lane period short', old: 'return handoverAt >= episode - (STATE_DEADLINE_S.checkpointed * 1_000 + RENEWAL_LANE_PERIOD_MS);', new: 'return handoverAt >= episode - STATE_DEADLINE_S.checkpointed * 1_000;' },
  ],
  suite: allFeed,
};

const ANSWER_SET: MutantSet<FeedModule> = {
  modulePath: FEED_TS,
  mutants: [
    { id: 'A1 unreachable read as before the first half', old: "case 'wake-failed': case 'wake-unrestored': case 'unproven': case 'unreachable': return { kind: 'host-failed', afterEnd: true };",
      new: "case 'unreachable': return { kind: 'host-failed', afterEnd: false };\n    case 'wake-failed': case 'wake-unrestored': case 'unproven': return { kind: 'host-failed', afterEnd: true };" },
    { id: 'A2 unproven read as before', old: "case 'wake-failed': case 'wake-unrestored': case 'unproven': case 'unreachable':", new: "case 'unproven': return { kind: 'host-failed', afterEnd: false };\n    case 'wake-failed': case 'wake-unrestored': case 'unreachable':" },
    { id: 'A3 a kill failure read as after', old: "case 'refused': case 'kill-failed': case 'capability-missing':", new: "case 'kill-failed': return { kind: 'host-failed', afterEnd: true };\n    case 'refused': case 'capability-missing':" },
    { id: 'O1 a claimed try owed again', old: 'return claimedTries.includes(attempts) ? null : attempts;', new: 'return attempts;' },
    { id: 'O2 owed outside clearing', old: "if (state !== 'clearing' || attempts < 1) return null;", new: 'if (attempts < 1) return null;' },
    { id: 'S1 a renew run straight off a step', old: "if (a === 'assemble-checkpoint' || a === 'ask-handover' || a === 'renudge-card' || a === 'set-hold-off') out.push({ kind: a });",
      new: "if (a === 'assemble-checkpoint' || a === 'ask-handover' || a === 'renudge-card' || a === 'set-hold-off') out.push({ kind: a });\n    else if (a === 'renew') out.push({ kind: 'renew', try: 1 });" },
    { id: 'S2 the hold-off dropped', old: "a === 'renudge-card' || a === 'set-hold-off')", new: "a === 'renudge-card')" },
  ],
  suite: allFeed,
};

const HOLDS_MAIL_SET: MutantSet<FeedModule> = {
  modulePath: FEED_TS,
  mutants: [
    { id: 'H1 the handover ask held', old: "  return !(origin !== null && origin.fromId === 'operator' && origin.subject === RENEWAL_HANDOVER_SUBJECT);", new: '  return true;' },
    { id: 'H2 any sender\'s handover passes', old: "origin.fromId === 'operator' && origin.subject", new: 'origin.subject' },
    { id: 'H3 an unread origin passes', old: '!(origin !== null && origin.fromId', new: '!(origin === null || origin.fromId' },
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
    { id: 'C1 refused in shadow too', old: "return continuityLive && field === 'compact'", new: "return field === 'compact'" },
    { id: 'C2 never refused', old: "return continuityLive && field === 'compact' ? COMPACT_OWNED_DETAIL : null;", new: 'return null;' },
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
