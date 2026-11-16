// The renewal hand-offs' oracles and mutant sets (Overlord W1a, plan `w1a-renewal-handoffs.md` Tasks 5 and 7; its Global
// Constraints' "Mutation floors"). Each widening registers one floor: `rollTargetVerdict` (the roll's hand-off to the renewal
// lane) and `stallRestartedVerdict` (the D5 arm widened to long-lived sessions). Their cases are written ONCE here, as suite
// cases over a module: `roll-target.test.ts` and `stall-restarted.test.ts` run them against the real modules, and
// `mutation-floors.test.ts` runs them against each textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';
import type { StallArming, StallSessionInput, StallVerdict, TurnMark } from '../../src/coord/stall.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type RollTargetModule = typeof import('../../src/coord/rollTarget.js');
export type StallModule = typeof import('../../src/coord/stall.js');

const TARGETS = ['all', 'coordinators', 'off'] as const;
const ROLES = ['coordinator', 'child', null] as const;
const LONG = [true, false, null] as const;

/** `rollTargetVerdict`'s hand-off cases: shadow answers as before, live hands a long-lived session to the renewal lane. */
export function rollHandoffCases(m: RollTargetModule): Record<string, SuiteCase> {
  const before = (t: (typeof TARGETS)[number], r: (typeof ROLES)[number]) => (t === 'off' ? { take: false, skip: 'setting-off' }
    : t === 'all' ? { take: true } : r === null ? { take: false, skip: 'role-unknown' } : r !== 'coordinator' ? { take: false, skip: 'not-coordinator' }
      : { take: true });
  return {
    'CHARACTERIZATION: with continuity shadow every case answers as before the hand-off, whatever longLived reads': () => {
      for (const t of TARGETS) for (const r of ROLES) for (const l of LONG) {
        expect(m.rollTargetVerdict(t, r, l, false), `${t} ${r} ${l}`).toEqual(before(t, r));
      }
    },
    'live: a long-lived session is renewal-owns under every setting but off, and an unread one is role-unknown': () => {
      for (const t of ['all', 'coordinators'] as const) for (const r of ROLES) {
        expect(m.rollTargetVerdict(t, r, true, true), `${t} ${r}`).toEqual({ take: false, skip: 'renewal-owns' });
        expect(m.rollTargetVerdict(t, r, null, true), `${t} ${r}`).toEqual({ take: false, skip: 'role-unknown' });
      }
      for (const l of LONG) expect(m.rollTargetVerdict('off', 'coordinator', l, true)).toEqual({ take: false, skip: 'setting-off' });
    },
    'live: a session that is not long-lived is judged as before': () => {
      for (const t of TARGETS) for (const r of ROLES) expect(m.rollTargetVerdict(t, r, false, true), `${t} ${r}`).toEqual(before(t, r));
    },
  };
}

const ROLL_TARGET_SET: MutantSet<RollTargetModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/rollTarget.ts'),
  mutants: [
    { id: 'H1 renewal-owns dropped', old: "  if (continuityLive && longLived) return { take: false, skip: 'renewal-owns' };\n", new: '' },
    { id: 'H2 renewal-owns while shadow', old: "if (continuityLive && longLived) return", new: 'if (longLived) return' },
    { id: 'H3 an unread long-life rolled', old: "  if (continuityLive && longLived === null) return { take: false, skip: 'role-unknown' };\n", new: '' },
    { id: 'H4 renewal-owns wins over off', old: "  if (targets === 'off') return { take: false, skip: 'setting-off' };\n  if (continuityLive && longLived === null)",
      new: "  if (continuityLive && longLived) return { take: false, skip: 'renewal-owns' };\n  if (targets === 'off') return { take: false, skip: 'setting-off' };\n  if (continuityLive && longLived === null)" },
  ],
  suite: rollHandoffCases,
};

// ── the D5 arm, widened ──────────────────────────────────────────────────────────────────────────────────────────────

const H = 3_600_000;
const MIN = 60_000;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const R = NOW - 2 * MIN;
const COORD = 'demo-calm-mesa';
const WORKER = 'demo-worker';
const W2: StallArming = { disabled: false, live: true, escalate: true, w2Live: true };
const NONE: StallVerdict = { act: 'none' };

function mark(restartAt: number, over: Partial<TurnMark> = {}): TurnMark & { ok: true } {
  const stopAt = restartAt - H;
  return {
    ok: true, crons: null, sessionId: 'uuid-1', state: 'done', event: 'SessionStart', at: restartAt, turnAt: stopAt - 20 * MIN,
    stopAt, bg: 0, bgKinds: [], bgIds: [], err: null, restartAt, lostBg: 1, lostKinds: ['shell'], lostIds: ['b1'], graceUntil: null, ...over,
  } as TurnMark & { ok: true };
}
/** A session resumed at `restartAt`, idle since a minute after it, its process started 5 s before: a coordinator, run-less,
 *  unless `over` says otherwise. */
function session(restartAt = R, over: Partial<StallSessionInput> = {}): StallSessionInput {
  return {
    sessionId: COORD, role: 'coordinator', run: null,
    worker: { present: true, unmeasured: false, lifecycle: 'running', limits: { five: 12, seven: 34 }, dialogPending: false,
      stranded: false, swapBlocked: false, live: { ok: true, word: 'idle', since: restartAt + MIN }, hookAsk: { kind: 'none' },
      askRow: { kind: 'none' }, autoContinueHeldAt: null },
    mark: mark(restartAt), liveStartedAt: restartAt - 5_000, markUnreadableSince: null, mail: [], deliveries: [], notices: [],
    arming: W2, coordinationPaused: false, longLived: true, ...over,
  };
}
const r1 = (key = R): StallVerdict => ({ act: 'notify', arm: 'restarted', rung: 1, key, to: 'worker' });

/** `stallRestartedVerdicts`' widened cases (Task 7): one rung-1 notice to a resumed long-lived session, keyed on its subject. */
export function restartedHandoffCases(m: StallModule): Record<string, SuiteCase> {
  const sent = (subject: string): StallSessionInput['mail'] => [{ id: 9, at: R + MIN, runId: null, fromId: 'operator', toId: COORD, kind: 'status', subject }];
  return {
    'a resumed long-lived session that lost a task gets one rung-1 notice, run-less, and no heads-up': () => {
      expect(m.stallRestartedVerdicts(session(), NOW)).toEqual([r1()]);
      expect(m.stallRestartedVerdict(session(), NOW)).toEqual(r1());
    },
    'a second sweep sends nothing: the notice is keyed on its subject; a later restart is told again': () => {
      expect(m.stallRestartedVerdicts(session(R, { mail: sent(m.stallRestartedSubject(R)) }), NOW)).toEqual([NONE]);
      const later = R + 5 * MIN;
      expect(m.stallRestartedVerdicts(session(later, { mail: sent(m.stallRestartedSubject(R)) }), NOW)).toEqual([r1(later)]);
    },
    'a session that is not long-lived gets none': () => {
      expect(m.stallRestartedVerdicts(session(R, { longLived: false }), NOW)).toEqual([NONE]);
      const { longLived: _, ...plain } = session(R, { role: 'other' });
      expect(m.stallRestartedVerdicts(plain, NOW)).toEqual([NONE]);
    },
    'a worker with no run is never told run-less, so a child is never mailed twice': () => {
      expect(m.stallRestartedVerdicts(session(R, { role: 'worker', sessionId: WORKER }), NOW)).toEqual([NONE]);
    },
    'a marker that is not the candidate tells nothing': () => {
      expect(m.stallRestartedVerdicts(session(R, { mark: mark(R, { lostBg: 0 }) }), NOW)).toEqual([NONE]);
    },
  };
}

const STALL_RESTARTED_SET: MutantSet<StallModule> = {
  modulePath: path.join(ROOT, 'server/src/coord/stall.ts'),
  mutants: [
    { id: 'S1 the old short-lived-only arm', old: 'if (!stallRunBound(input)) return stallRestartedRunLess(input, now);',
      new: 'if (!stallRunBound(input)) return [VERDICT_NONE];' },
    { id: 'S2 widened past long-lived roles', old: "if (input.longLived !== true || input.role === 'worker') return [VERDICT_NONE];",
      new: "if (input.role === 'worker') return [VERDICT_NONE];" },
    { id: 'S3 a worker told run-less', old: "if (input.longLived !== true || input.role === 'worker') return [VERDICT_NONE];",
      new: 'if (input.longLived !== true) return [VERDICT_NONE];' },
    { id: 'S4 no subject key', old: "  if (stallSelfRungDone(input, 'restarted', key, stallRestartedSubject(key))) return [VERDICT_NONE];\n  return [{ act: 'notify', arm: 'restarted', rung: 1, key, to: 'worker' }];",
      new: "  return [{ act: 'notify', arm: 'restarted', rung: 1, key, to: 'worker' }];" },
  ],
  suite: restartedHandoffCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const HANDOFF_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/coord/rollTarget.ts#rollTargetVerdict': ROLL_TARGET_SET as MutantSet<never>,
  'server/src/coord/stall.ts#stallRestartedVerdict': STALL_RESTARTED_SET as MutantSet<never>,
};
