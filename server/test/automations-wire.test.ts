// Task 2 — the automations vocabulary lands on the wire, derived and never
// hand-written.
//
// `docs/superpowers/specs/2026-08-31-automations-design.md` §5, §8, §10, §11
// are BINDING. `.superpowers/sdd/2026-08-31-automations/task-2-brief.md` calls
// this "seven closed vocabularies" and then enumerates EIGHT — it is eight:
// `AutomationState`, `AutomationOutcome`, `AutomationRefusal`,
// `AutomationStep`, `AutomationTrigger`, `CadenceKind`, `ScheduleError`,
// `AutomationRouteRefusal`.
//
// Same shape as `auth-wire.test.ts` (Stage 3a Task 1), the file this one is
// modelled on: the COMPILE-TIME half of the guarantee — `Record<Union, true>`
// making a member added to a union and not to its map a TS2739 — is a gate
// `typecheck-tests.test.ts` enforces, not a case here. This file is the
// RUNTIME half tsc cannot do: the derived list really came from the map, the
// guard answers for every member (including `'unknown'`) and rejects a
// foreign token, and the vocabulary was not restated somewhere the compiler
// is not watching (`single-definition.test.ts` owns that last scan).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLEET_PROTO, FLEET_PROTO_MIN,
  AUTOMATION_STATES, isAutomationState, type AutomationState,
  AUTOMATION_OUTCOMES, isAutomationOutcome, type AutomationOutcome,
  AUTOMATION_REFUSALS, isAutomationRefusal, type AutomationRefusal,
  AUTOMATION_STEPS, isAutomationStep, type AutomationStep,
  AUTOMATION_TRIGGERS, isAutomationTrigger, type AutomationTrigger,
  CADENCE_KINDS, isCadenceKind, type CadenceKind,
  SCHEDULE_ERRORS, isScheduleError, type ScheduleError,
  AUTOMATION_ROUTE_REFUSALS, isAutomationRouteRefusal, type AutomationRouteRefusal,
  AUTOMATION_PROMPT_MAX_BYTES, AUTOMATION_DETAIL_MAX_BYTES, AUTOMATION_RUN_RETENTION,
  AUTOMATION_MAX_CONCURRENT, AUTOMATION_FAILURE_CEILING, AUTOMATION_PRESSURE_CEILING,
  AUTOMATION_GRACE_MS_DEFAULT, AUTOMATION_MIN_INTERVAL_MINUTES,
  type AutomationSummary, type AutomationRunSummary, type AutomationStepWire,
  type AutomationStats, type FleetMsg,
} from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const API_TS = path.resolve(here, '..', '..', 'shared', 'api.ts');
const src = (): string => readFileSync(API_TS, 'utf8');

/** One table drives every vocabulary's runtime assertions below, so adding a
 *  ninth vocabulary later is one row here, not eight repeated `it` blocks. */
interface VocabCase<T extends string> {
  name: string;
  mapName: string;
  members: readonly T[];
  isGuard: (v: unknown) => v is T;
  expectSorted: readonly string[];
}

const CASES: VocabCase<string>[] = [
  {
    name: 'AutomationState', mapName: 'AUTOMATION_STATE_MAP',
    members: AUTOMATION_STATES, isGuard: isAutomationState,
    expectSorted: ['armed', 'paused', 'retired', 'unknown'],
  },
  {
    name: 'AutomationOutcome', mapName: 'AUTOMATION_OUTCOME_MAP',
    members: AUTOMATION_OUTCOMES, isGuard: isAutomationOutcome,
    expectSorted: ['failed', 'lost', 'missed', 'ok', 'refused', 'running', 'skipped', 'unknown'],
  },
  {
    name: 'AutomationRefusal', mapName: 'AUTOMATION_REFUSAL_MAP',
    members: AUTOMATION_REFUSALS, isGuard: isAutomationRefusal,
    expectSorted: [
      'account-pressed', 'automations-paused', 'cap-concurrency', 'coordinator-paused',
      'failure-ceiling', 'no-placeable-account', 'overlap', 'prompt-refused',
      'registry-unmeasurable', 'spawn-ambiguous', 'spawn-cut-short', 'spawn-refused',
      'spawn-unmeasured', 'unknown', 'unknown-project',
    ],
  },
  {
    name: 'AutomationStep', mapName: 'AUTOMATION_STEP_MAP',
    members: AUTOMATION_STEPS, isGuard: isAutomationStep,
    expectSorted: ['close', 'identify', 'lease', 'precheck', 'prompt', 'spawn', 'unknown'],
  },
  {
    name: 'AutomationTrigger', mapName: 'AUTOMATION_TRIGGER_MAP',
    members: AUTOMATION_TRIGGERS, isGuard: isAutomationTrigger,
    expectSorted: ['catchup', 'manual', 'schedule', 'unknown'],
  },
  {
    name: 'CadenceKind', mapName: 'CADENCE_KIND_MAP',
    members: CADENCE_KINDS, isGuard: isCadenceKind,
    expectSorted: ['interval', 'unknown', 'wall-clock'],
  },
  {
    name: 'ScheduleError', mapName: 'SCHEDULE_ERROR_MAP',
    members: SCHEDULE_ERRORS, isGuard: isScheduleError,
    expectSorted: ['bad-cadence', 'failure-ceiling', 'no-future-occurrence', 'unknown', 'unknown-timezone'],
  },
  {
    name: 'AutomationRouteRefusal', mapName: 'AUTOMATION_ROUTE_REFUSAL_MAP',
    members: AUTOMATION_ROUTE_REFUSALS, isGuard: isAutomationRouteRefusal,
    expectSorted: ['bad-schedule', 'bad-transition', 'never-run-by-hand', 'oversize', 'unknown'],
  },
];

describe('the eight automations vocabularies — each derived, never restated', () => {
  it('is really eight, not the brief’s miscounted seven', () => {
    expect(CASES).toHaveLength(8);
    expect(new Set(CASES.map((c) => c.name)).size).toBe(8);
  });

  for (const c of CASES) {
    describe(c.name, () => {
      it('has no duplicate members and every member is recognised by its own guard', () => {
        expect(new Set(c.members).size).toBe(c.members.length);
        for (const m of c.members) expect(c.isGuard(m), m).toBe(true);
      });

      it('is exactly the expected sorted set', () => {
        expect([...c.members].sort()).toEqual(c.expectSorted);
      });

      it('includes \'unknown\' as a member — the reader degrade a producer never writes', () => {
        expect(c.members).toContain('unknown');
      });

      it('the guard rejects a foreign token and every non-string, without smuggling', () => {
        expect(c.isGuard('not-a-member')).toBe(false);
        expect(c.isGuard('')).toBe(false);
        expect(c.isGuard(null)).toBe(false);
        expect(c.isGuard(undefined)).toBe(false);
        expect(c.isGuard(7)).toBe(false);
        expect(c.isGuard({})).toBe(false);
      });

      it('the exported list is spelled once, as Object.keys over its map — not restated', () => {
        const re = new RegExp(`Object\\.keys\\(${c.mapName}\\)`);
        expect(src()).toMatch(re);
      });
    });
  }
});

describe('FLEET_PROTO is untouched by this task', () => {
  it('both constants stay 1', () => {
    expect(FLEET_PROTO).toBe(1);
    expect(FLEET_PROTO_MIN).toBe(1);
  });
});

describe('the caps (spec §5/§7/§9, plus task-2 decisions for the five left open)', () => {
  it('carries the spec-exact values', () => {
    expect(AUTOMATION_DETAIL_MAX_BYTES).toBe(2048);
    expect(AUTOMATION_RUN_RETENTION).toBe(200);
  });

  it('carries the five task-2 decisions verbatim', () => {
    expect(AUTOMATION_MAX_CONCURRENT).toBe(2);
    expect(AUTOMATION_FAILURE_CEILING).toBe(3);
    expect(AUTOMATION_PRESSURE_CEILING).toBe(90);
    expect(AUTOMATION_GRACE_MS_DEFAULT).toBe(30 * 60_000);
    expect(AUTOMATION_PROMPT_MAX_BYTES).toBe(4096);
    expect(AUTOMATION_MIN_INTERVAL_MINUTES).toBe(60);
  });
});

describe('the wire shapes (spec §10/§11)', () => {
  it('AutomationSummary flattens the cadence into primitive columns, never a Cadence object', () => {
    const wallClock: AutomationSummary = {
      id: 1, name: 'nightly build', state: 'armed', project: 'ccrc-pwa', prompt: 'go',
      cadenceKind: 'wall-clock', cadenceDays: 0b0111110, cadenceMinute: 540, cadenceEvery: null,
      tz: 'Europe/Warsaw',
      graceMs: AUTOMATION_GRACE_MS_DEFAULT, createdAt: 1, updatedAt: 1,
      provedAt: null, nextRunAt: null, scheduleError: null,
      lastFireAt: null, lastOutcome: null, lastRefusal: null,
      consecutiveFailures: 0, runsEvicted: 0,
    };
    expect(wallClock.tz).toBe('Europe/Warsaw');

    const interval: AutomationSummary = {
      ...wallClock, cadenceKind: 'interval', cadenceDays: null, cadenceMinute: null,
      cadenceEvery: 240, tz: null,
    };
    expect(interval.tz).toBeNull();

    // A cadence never rides as an object — this is a structural (compile-time)
    // property, asserted here by the source scan below rather than by a type
    // gymnastic no runtime test can express.
    expect(src()).not.toMatch(/cadence\s*:\s*Cadence\b/);
  });

  it('AutomationSummary’s three-way split is three independently nullable facts', () => {
    // Never proved by hand: the clock may not fire it.
    const unproved: AutomationSummary = {
      id: 2, name: 'x', state: 'paused', project: 'p', prompt: 'go',
      cadenceKind: 'interval', cadenceDays: null, cadenceMinute: null, cadenceEvery: 60, tz: null,
      graceMs: 60_000, createdAt: 1, updatedAt: 1,
      provedAt: null, nextRunAt: null, scheduleError: null,
      lastFireAt: null, lastOutcome: null, lastRefusal: null,
      consecutiveFailures: 0, runsEvicted: 0,
    };
    expect(unproved.provedAt).toBeNull();

    // Unschedulable: nextRunAt stays null WITH a named reason, distinct from
    // "armed and due" (nextRunAt set, scheduleError null).
    const unschedulable: AutomationSummary = {
      ...unproved, provedAt: 5, nextRunAt: null, scheduleError: 'unknown-timezone',
    };
    expect(unschedulable.nextRunAt).toBeNull();
    expect(unschedulable.scheduleError).not.toBeNull();

    // Due at T: both the opposite of the row above.
    const due: AutomationSummary = { ...unproved, provedAt: 5, nextRunAt: 999, scheduleError: null };
    expect(due.nextRunAt).not.toBeNull();
    expect(due.scheduleError).toBeNull();
  });

  it('AutomationRunSummary keeps spawnRc/homeScore null distinct from a measured zero', () => {
    const unmeasured: AutomationRunSummary = {
      id: 1, automationId: 1, scheduledFor: 1, startedAt: 1, endedAt: null, lateMs: 0,
      outcome: 'running', refusal: null, trigger: 'schedule', dstShifted: false, adopted: false,
      sessionId: null, workspace: null, branch: null, wrapper: null,
      homeScore: null, spawnRc: null,
    };
    expect(unmeasured.spawnRc).toBeNull();
    expect(unmeasured.homeScore).toBeNull();

    const measuredZero: AutomationRunSummary = { ...unmeasured, spawnRc: 0, homeScore: 0 };
    expect(measuredZero.spawnRc).toBe(0);
    expect(measuredZero.homeScore).toBe(0);
    // The two are distinguishable values, not the same falsy thing.
    expect(measuredZero.spawnRc === unmeasured.spawnRc).toBe(false);
  });

  it('AutomationStepWire always carries truncatedBytes, including 0', () => {
    const clean: AutomationStepWire = {
      id: 1, runId: 1, at: 1, step: 'spawn', ok: true, detail: 'ok', truncatedBytes: 0,
    };
    expect(clean.truncatedBytes).toBe(0);
    expect(Object.keys(clean)).toContain('truncatedBytes');
  });

  it('AutomationStats reports totals and the growth, never a silence', () => {
    const stats: AutomationStats = {
      total: 3, armed: 1, paused: 1, retired: 1,
      runsTotal: 50, runsEvictedTotal: 12, oldestRunAt: 1, newestRunAt: 2,
    };
    expect(stats.runsEvictedTotal).toBe(12);
  });

  it('FleetMsg gains an additive {type:\'automations\'} arm', () => {
    const frame: FleetMsg = { type: 'automations', automations: [] };
    expect(frame.type).toBe('automations');
  });
});
