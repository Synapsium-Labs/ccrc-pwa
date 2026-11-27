// D-9167, D-9170 (plan docs/superpowers/plans/2026-11-27-delegation-events-retention.md, PR-1): the kept-classes rule, pure. Every row
// below holds one rule of `server/src/coord/delegation-event-projection.ts` exactly; the plan's PR1-M1..M5 are measured red against them.
import { describe, expect, it } from 'vitest';
import type { DelegationEventEnvelopeV1 } from '../../shared/api.js';
import {
  DELEGATION_EVENT_CLASSES, DELEGATION_EVENT_CLASS_KEPT, DELEGATION_EVENTS_ALL, DELEGATION_EVENTS_STOP_REASONS,
  DELEGATION_EVENTS_SWEEP_BATCHES_PER_PASS, DELEGATION_EVENTS_SWEEP_FIRST_BATCH, DELEGATION_EVENTS_SWEEP_MIN_BATCH, DELEGATION_EVENTS_SWEEP_SLOW_MS,
  alignDelegationEvents, decodeDelegationEventsRow, delegationEventClassOf, delegationEventHeld, delegationEventsLine, delegationEventsNoticeKey,
  delegationEventsStopOf, delegationEventsWant, encodeDelegationEventsRow, isDelegationEventProjectionKebab, nextDelegationSweepBatch,
  noticedDelegationEvents, planDelegationEventSweep, stopDelegationEvents, type DelegationEventsContract, type DelegationEventsRow,
} from '../src/coord/delegation-event-projection.js';

const common = { v: 1 as const, observedAt: '2026-11-27T00:00:00.000Z', sessionId: 'lane-a-project-a', parentIncarnation: 'g1',
  claudeSessionId: '11111111-2222-3333-4444-555555555555', eventId: 'e'.repeat(64), bucket: '2026112700', startOffset: 0, endOffset: 99 };
const ev = (e: Record<string, unknown>): DelegationEventEnvelopeV1 => ({ ...common, ...e }) as unknown as DelegationEventEnvelopeV1;

const FIXTURES: ReadonlyArray<readonly [string, DelegationEventEnvelopeV1, string]> = [
  ['a Bash Pre with neither', ev({ eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: 't1' }), 'bash-plain'],
  ['a Bash Post with neither', ev({ eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 't1', outcome: 'completed' }), 'bash-plain'],
  ['a Bash Pre with a listing', ev({ eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: 't2', listing: ['wt-1'] }), 'bash-listed'],
  ['a Bash Post with an empty listing', ev({ eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 't2', outcome: 'completed', listing: [] }), 'bash-listed'],
  ['a truncated Bash Post with a listing', ev({ eventKind: 'PostToolUse', toolName: 'Bash', toolUseId: 't2', outcome: 'completed', listing: ['a'], truncated: true }), 'bash-listed'],
  ['a truncated Bash Pre with no listing', ev({ eventKind: 'PreToolUse', toolName: 'Bash', toolUseId: 't3', truncated: true }), 'bash-shed'],
  ['an Agent Pre', ev({ eventKind: 'PreToolUse', toolName: 'Agent', toolUseId: 't4', isolation: null }), 'agentic'],
  ['a Task Post', ev({ eventKind: 'PostToolUse', toolName: 'Task', toolUseId: 't5', outcome: 'completed', launch: null }), 'agentic'],
  ['a truncated Workflow Post', ev({ eventKind: 'PostToolUse', toolName: 'Workflow', toolUseId: 't6', outcome: 'unknown', launch: null, truncated: true }), 'agentic'],
  ['a SubagentStart', ev({ eventKind: 'SubagentStart', agentId: 'agent-a', agentType: null }), 'subagent'],
  ['a SubagentStop', ev({ eventKind: 'SubagentStop', agentId: 'agent-a', agentType: null, agentTranscriptPath: null }), 'subagent'],
  ['a SessionStart', ev({ eventKind: 'SessionStart', source: 'startup' }), 'session'],
  ['a SessionEnd', ev({ eventKind: 'SessionEnd', reason: 'exit' }), 'session'],
  ['a task notification', ev({ eventKind: 'UserPromptSubmit', notification: { taskId: 'k', toolUseId: 't7', status: 'completed' } }), 'prompt'],
];

const thin = (legacyBelow: number, sweptBelow: number): DelegationEventsContract => ({ mode: 'thin', legacyBelow, sweptBelow });

describe('the record classes (D-9167)', () => {
  it.each(FIXTURES)('%s is %s', (_name, e, cls) => {
    expect(delegationEventClassOf(e)).toBe(cls);
  });

  it('every class is reached by a fixture, and the kept table names exactly the classes', () => {
    expect(new Set(FIXTURES.map(([, , c]) => c))).toEqual(new Set(DELEGATION_EVENT_CLASSES));
    expect(Object.keys(DELEGATION_EVENT_CLASS_KEPT).sort()).toEqual([...DELEGATION_EVENT_CLASSES].sort());
  });

  it('PR1-M1: D1 (a): every class is kept except the three Bash classes', () => {
    expect(DELEGATION_EVENT_CLASSES.filter((c) => !DELEGATION_EVENT_CLASS_KEPT[c])).toEqual(['bash-plain', 'bash-listed', 'bash-shed']);
  });
});

describe('membership (D-9167)', () => {
  it('under `all` every record is held', () => {
    for (const c of DELEGATION_EVENT_CLASSES) expect(delegationEventHeld({ mode: 'all' }, 1, c)).toBe(true);
  });

  it('under `thin` a kept class is held at any sequence', () => {
    expect(delegationEventHeld(thin(10, 5), 1, 'agentic')).toBe(true);
    expect(delegationEventHeld(thin(10, 5), 99, 'session')).toBe(true);
  });

  it('PR1-M2: under `thin` an excluded record is held only inside [sweptBelow, legacyBelow)', () => {
    const c = thin(10, 5);
    expect([4, 5, 9, 10, 11].map((s) => delegationEventHeld(c, s, 'bash-plain'))).toEqual([false, true, true, false, false]);
  });
});

describe('the card row\'s choice and the stop (D-9170)', () => {
  const stop = { at: 50, reason: 'replay-from-start' as const, choiceAt: 7, noticedAt: null };

  it('Live with no stop wants thin; Off wants all', () => {
    expect(delegationEventsWant({ live: true, updatedAt: 7 }, null)).toBe('thin');
    expect(delegationEventsWant({ live: false, updatedAt: 7 }, null)).toBe('all');
  });

  it('PR1-M3: a stop made under the row\'s current write time keeps every class; a newer tap re-arms', () => {
    expect(delegationEventsWant({ live: true, updatedAt: 7 }, stop)).toBe('all');
    expect(delegationEventsWant({ live: true, updatedAt: 8 }, stop)).toBe('thin');
  });

  it('a stop made over the never-written seed (updatedAt 0) stands until the first tap', () => {
    const seeded = { ...stop, choiceAt: 0 };
    expect(delegationEventsWant({ live: true, updatedAt: 0 }, seeded)).toBe('all');
    expect(delegationEventsWant({ live: true, updatedAt: 1 }, seeded)).toBe('thin');
  });

  it('an unreadable row (live false, updatedAt null) wants all', () => {
    expect(delegationEventsWant({ live: false, updatedAt: null }, null)).toBe('all');
  });

  it('the stop decides only under thin', () => {
    expect(delegationEventsStopOf(thin(3, 0), 'rows-not-in-journal')).toBe('rows-not-in-journal');
    expect(delegationEventsStopOf(thin(3, 0), null)).toBeNull();
    expect(delegationEventsStopOf({ mode: 'all' }, 'replay-from-start')).toBeNull();
  });

  it('a stop is every class again, with its reason, time and choice, its notice not yet raised; marking it is once', () => {
    const r = stopDelegationEvents('replay-from-start', 50, 7);
    expect(r).toEqual({ contract: { mode: 'all' }, stop: { at: 50, reason: 'replay-from-start', choiceAt: 7, noticedAt: null } });
    const marked = noticedDelegationEvents(r, 60);
    expect(marked?.stop?.noticedAt).toBe(60);
    expect(noticedDelegationEvents(marked!, 70)).toBeNull();
    expect(noticedDelegationEvents(DELEGATION_EVENTS_ALL, 70)).toBeNull();
    expect(delegationEventsNoticeKey(50)).toBe('delegation-events-stopped:50');
  });
});

describe('contract moves (D-9167)', () => {
  it('arming makes everything held now legacy, from 0, and clears a stop', () => {
    const stopped: DelegationEventsRow = stopDelegationEvents('replay-from-start', 5, 1);
    expect(alignDelegationEvents(stopped, 'thin', 41)).toEqual({ contract: thin(42, 0), stop: null });
    expect(alignDelegationEvents(DELEGATION_EVENTS_ALL, 'thin', null)).toEqual({ contract: thin(1, 0), stop: null });
  });

  it('disarming keeps the stop\'s record; an aligned row changes nothing', () => {
    const r: DelegationEventsRow = { contract: thin(9, 3), stop: { at: 1, reason: 'rows-not-in-journal', choiceAt: 0, noticedAt: 2 } };
    expect(alignDelegationEvents(r, 'all', 50)).toEqual({ contract: { mode: 'all' }, stop: r.stop });
    expect(alignDelegationEvents(r, 'thin', 50)).toBeNull();
    expect(alignDelegationEvents(DELEGATION_EVENTS_ALL, 'all', 50)).toBeNull();
  });
});

describe('the sweep (D-9167; the batch limits itself, the operator\'s ruling of 2026-11-27)', () => {
  it('the constants are the ruled ones', () => {
    expect([DELEGATION_EVENTS_SWEEP_FIRST_BATCH, DELEGATION_EVENTS_SWEEP_SLOW_MS, DELEGATION_EVENTS_SWEEP_BATCHES_PER_PASS, DELEGATION_EVENTS_SWEEP_MIN_BATCH])
      .toEqual([1000, 100, 20, 1]);
  });

  it('PR1-M4: a batch over 100 ms halves the next, to the floor; at or under 100 ms it stays', () => {
    expect(nextDelegationSweepBatch(1000, 101)).toBe(500);
    expect(nextDelegationSweepBatch(1000, 100)).toBe(1000);
    expect(nextDelegationSweepBatch(3, 500)).toBe(1);
    expect(nextDelegationSweepBatch(1, 500)).toBe(1);
  });

  it('a batch takes the lowest legacy sequences, and its sweptBelow is the next one left, or legacyBelow when none is', () => {
    expect(planDelegationEventSweep(thin(20, 0), [2, 4, 6, 8], 2)).toEqual({ delete: [2, 4], sweptBelow: 6 });
    expect(planDelegationEventSweep(thin(20, 6), [6, 8], 5)).toEqual({ delete: [6, 8], sweptBelow: 20 });
    expect(planDelegationEventSweep(thin(20, 6), [], 5)).toEqual({ delete: [], sweptBelow: 20 });
  });

  it('nothing to do under all or once the window is closed', () => {
    expect(planDelegationEventSweep({ mode: 'all' }, [1], 5)).toBeNull();
    expect(planDelegationEventSweep(thin(20, 20), [], 5)).toBeNull();
  });
});

describe('the row codec (D-9167)', () => {
  const cols = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    mode: 'all', legacyBelow: null, sweptBelow: null, stoppedAt: null, stopReason: null, stopChoiceAt: null, stopNoticedAt: null, ...over,
  });

  it('round-trips every shape', () => {
    const rows: DelegationEventsRow[] = [
      DELEGATION_EVENTS_ALL,
      { contract: thin(9, 3), stop: null },
      { contract: { mode: 'all' }, stop: { at: 1, reason: 'rows-not-in-journal', choiceAt: null, noticedAt: null } },
      { contract: { mode: 'all' }, stop: { at: 1, reason: 'replay-from-start', choiceAt: 4, noticedAt: 9 } },
    ];
    for (const r of rows) expect(decodeDelegationEventsRow(encodeDelegationEventsRow(r) as unknown as Record<string, unknown>)).toEqual({ ok: true, row: r });
  });

  it('PR1-M5: a mode this build does not know, or a malformed thin row or stop, is refused, never read as thin', () => {
    expect(decodeDelegationEventsRow(cols({ mode: 'thinner' })).ok).toBe(false);
    expect(decodeDelegationEventsRow(cols({ mode: 'thin', legacyBelow: 3 })).ok).toBe(false);
    expect(decodeDelegationEventsRow(cols({ mode: 'thin', legacyBelow: -1, sweptBelow: 0 })).ok).toBe(false);
    expect(decodeDelegationEventsRow(cols({ stoppedAt: 1, stopReason: 'tired' })).ok).toBe(false);
    expect(decodeDelegationEventsRow(cols({ stoppedAt: 1.5, stopReason: 'replay-from-start' })).ok).toBe(false);
  });
});

describe('the daily counts line (D-9170)', () => {
  const byClass = { 'bash-plain': 70, 'bash-listed': 20, 'bash-shed': 1, agentic: 5, subagent: 2, session: 1, prompt: 1 };

  it('names the mode, the held and total counts, each class, the legacy left and the freelist', () => {
    expect(delegationEventsLine({ row: { contract: thin(9, 3), stop: null }, held: 30, total: 100, byClass, legacyLeft: 21, pages: { pageCount: 1000, freelistCount: 40, pageSize: 4096 } }))
      .toBe('ccrc-server: delegation events: mode thin; held 30 of 100 evidence records; by class bash-plain=70,bash-listed=20,bash-shed=1,agentic=5,subagent=2,session=1,prompt=1; legacy left 21; freelist 40 of 1000 pages of 4096 bytes');
  });

  it('a stop is named with its reason and time, and unmeasured pages say so', () => {
    const line = delegationEventsLine({ row: stopDelegationEvents('rows-not-in-journal', Date.UTC(2026, 10, 27), 0), held: 100, total: 100, byClass, legacyLeft: 0, pages: null });
    expect(line).toContain('mode all stopped rows-not-in-journal at 2026-11-27T00:00:00.000Z;');
    expect(line.endsWith('; pages unmeasured')).toBe(true);
  });
});

describe('the kebab guard (mail-routes.test.ts\'s scan)', () => {
  it('admits every word the file spells, and nothing else', () => {
    for (const w of [...DELEGATION_EVENT_CLASSES.filter((c) => c.includes('-')), ...DELEGATION_EVENTS_STOP_REASONS, 'delegation-events-stopped']) {
      expect(isDelegationEventProjectionKebab(w)).toBe(true);
    }
    expect(isDelegationEventProjectionKebab('bash-other')).toBe(false);
  });
});
