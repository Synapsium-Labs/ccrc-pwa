// D-8181, Task 2.1: the plan vocabulary (`shared/plan.ts`, L0) and the words it adds to the shared lists.
import { describe, it, expect } from 'vitest';
import {
  PLAN_REFUSALS, isPlanKebab, isPlanKey, PLAN_BOUNDS, EPIC_STATES, TICKET_STATES, HIERARCHY_STATES, PHASE_REF_KINDS, PHASE_REF_OPS,
  LINEAR_SYNC_PROGRAMME, UPKEEP_EPIC_KEY, UPKEEP_EPIC_TITLE, INBOUND_STATES, MAP_CLASSES,
} from '../../shared/plan.js';
import { REFUSAL_STATUS, ROUTE_REFUSALS, RUN_REFUSAL_STATUS } from '../../shared/refusal.js';
import { RUN_REFUSE_CODES, isRunRefuseCode, SERVER_CAPS } from '../../shared/api.js';
import { parseItemAction, actAbandons, isLinearItemAction, LINEAR_ITEM_ACTS } from '../../shared/ledgers.js';

describe('the plan vocabulary (D-8181)', () => {
  it('every PLAN_REFUSALS word has a status', () => {
    const want: Record<string, number> = {
      'not-plan-owner': 403, 'not-linear-owner': 403, 'unknown-epic': 404, 'unknown-checkpoint': 404, 'unknown-ticket': 404,
      'plan-too-large': 400, 'plan-bad-body': 400, 'waves-not-contiguous': 400, 'dropped-needs-reason': 400,
      // programme work map WM0 (D-8715): an absent or dropped reference reads like the other absent objects
      'unknown-ref': 404,
    };
    for (const w of PLAN_REFUSALS) {
      expect(ROUTE_REFUSALS as readonly string[], w).toContain(w);
      expect(REFUSAL_STATUS[w as keyof typeof REFUSAL_STATUS], w).toBe(want[w] ?? 409);
    }
    expect(PLAN_REFUSALS).toHaveLength(24);
  });

  it('isPlanKebab admits the plan words and refuses run-unreadable', () => {
    for (const w of [...PLAN_REFUSALS, ...EPIC_STATES, ...TICKET_STATES, ...HIERARCHY_STATES, 'operator-act', 'follow-up', 'put-back',
      ...PHASE_REF_KINDS, ...PHASE_REF_OPS]) {
      expect(isPlanKebab(w), w).toBe(true);
    }
    // D-8186, Task 7.1: the migration map's classes.
    for (const w of MAP_CLASSES) expect(isPlanKebab(w), w).toBe(true);
    expect(isPlanKebab('run-unreadable')).toBe(false);
    expect(isPlanKebab('plan-bogus')).toBe(false);
  });

  it('isPlanKey reads the programme slug grammar', () => {
    expect(isPlanKey('upkeep')).toBe(true);
    expect(isPlanKey('a_b-9')).toBe(true);
    expect(isPlanKey('has space')).toBe(false);
    expect(isPlanKey('')).toBe(false);
    expect(isPlanKey(3)).toBe(false);
  });

  it('the bounds and reserved words are what the plan names', () => {
    expect(PLAN_BOUNDS).toEqual({
      epics: 24, checkpointsPerEpic: 16, ticketsPerBody: 200, titleChars: 255, summaryChars: 500, bodyBytes: 65_536, reasonChars: 500,
      phases: 24, refsPerPhase: 200,
    });
    expect([LINEAR_SYNC_PROGRAMME, UPKEEP_EPIC_KEY, UPKEEP_EPIC_TITLE]).toEqual(['linear-sync', 'upkeep', 'Upkeep']);
  });

  it('parseItemAction reads each linear verb and refuses one with a missing field', () => {
    const ok = (a: object) => parseItemAction(JSON.stringify(a));
    expect(ok({ verb: 'linear-map', migrationId: 3 })).toEqual({ verb: 'linear-map', migrationId: 3 });
    expect(ok({ verb: 'linear-report', migrationId: 3 })).toEqual({ verb: 'linear-report', migrationId: 3 });
    expect(ok({ verb: 'linear-drift', bindingId: 9 })).toEqual({ verb: 'linear-drift', bindingId: 9 });
    expect(ok({ verb: 'linear-initiatives', workspaceId: 'ws-a' })).toEqual({ verb: 'linear-initiatives', workspaceId: 'ws-a' });
    expect(ok({ verb: 'linear-owner', project: 'project-a' })).toEqual({ verb: 'linear-owner', project: 'project-a' });
    expect(ok({ verb: 'linear-map' })).toBeNull();
    expect(ok({ verb: 'linear-report', migrationId: 'x' })).toBeNull();
    expect(ok({ verb: 'linear-drift' })).toBeNull();
    expect(ok({ verb: 'linear-initiatives', workspaceId: '' })).toBeNull();
    expect(ok({ verb: 'linear-owner', project: 4 })).toBeNull();
    // D-8808: the shared-key item's verb, and its key required
    expect(ok({ verb: 'linear-team-workspace', teamKey: 'AAA' })).toEqual({ verb: 'linear-team-workspace', teamKey: 'AAA' });
    expect(ok({ verb: 'linear-team-workspace' })).toBeNull();
    expect(ok({ verb: 'linear-team-workspace', teamKey: '' })).toBeNull();
    // a verb this build does not know reads as no action, so an older reader of a newer row draws a plain item
    expect(ok({ verb: 'linear-not-yet', teamKey: 'AAA' })).toBeNull();
    // a run action still needs its runId
    expect(ok({ verb: 'end-run', stuckReason: null })).toBeNull();
    expect(ok({ verb: 'end-run', runId: 1, stuckReason: null })).toEqual({ verb: 'end-run', runId: 1, stuckReason: null });
  });

  it('a linear action never abandons, and each verb has its acts', () => {
    for (const a of [
      { verb: 'linear-map', migrationId: 1 }, { verb: 'linear-report', migrationId: 1 }, { verb: 'linear-drift', bindingId: 1 },
      { verb: 'linear-initiatives', workspaceId: 'ws-a' }, { verb: 'linear-owner', project: 'project-a' },
      { verb: 'linear-team-workspace', teamKey: 'AAA' },
    ] as const) {
      expect(actAbandons(a)).toBe(false);
      expect(isLinearItemAction(a)).toBe(true);
    }
    expect(isLinearItemAction(null)).toBe(false);
    expect(isLinearItemAction({ verb: 'end-run', runId: 1, stuckReason: null })).toBe(false);
    expect(LINEAR_ITEM_ACTS).toEqual({
      'linear-map': ['approve', 'return'], 'linear-report': ['put-back', 'done'], 'linear-drift': ['hand', 'keep'],
      'linear-initiatives': ['check-again'], 'linear-owner': ['name'], 'linear-team-workspace': [],
    });
  });

  it('the five new run refusals are RunRefuseCodes with statuses', () => {
    for (const c of ['wave-epic-mismatch', 'plan-missing', 'reserved-programme', 'ticket-unavailable', 'plan-closed'] as const) {
      expect(isRunRefuseCode(c), c).toBe(true);
      expect(RUN_REFUSE_CODES as readonly string[]).toContain(c);
      expect(RUN_REFUSAL_STATUS[c], c).toBe(409);
    }
    expect(REFUSAL_STATUS['plan-closed']).toBe(409);
    expect(SERVER_CAPS as readonly string[]).toContain('plan-v1');
  });

  it('the phase vocabulary (programme work map WM0, D-8715): its lists, its two refusals and its capability word', () => {
    expect([PHASE_REF_KINDS, PHASE_REF_OPS]).toEqual([['epic', 'ticket'], ['add', 'remove', 'carry']]);
    expect([REFUSAL_STATUS['unknown-ref'], REFUSAL_STATUS['bad-carry']]).toEqual([404, 409]);
    expect(SERVER_CAPS as readonly string[]).toContain('plan-phases-v1');
    expect(SERVER_CAPS as readonly string[]).toContain('plan-inbound-v1');   // D-8736
  });

  it('the inbound states carry retired (D-8735): a stored row whose issue completed, was canceled or is ccrc\'s own', () => {
    expect(INBOUND_STATES).toEqual(['waiting', 'mailed', 'handed', 'taken', 'placed', 'closed', 'raised', 'retired']);
    expect(isPlanKebab('retired')).toBe(true);
  });

  it('the done vocabulary (programme work map WM1, D-8727): its refusal, its run refusal and its capability word', () => {
    expect(PLAN_REFUSALS).toContain('evidence-unverified');
    expect(REFUSAL_STATUS['evidence-unverified']).toBe(409);
    expect(isRunRefuseCode('ticket-required')).toBe(true);
    expect(RUN_REFUSE_CODES as readonly string[]).toContain('ticket-required');
    expect(RUN_REFUSAL_STATUS['ticket-required']).toBe(409);
    expect(SERVER_CAPS as readonly string[]).toContain('plan-ticket-done-v1');
    // no ticket-not-open word: plan ticket-done reuses plan ticket-move's (review 2268 F21)
    expect(ROUTE_REFUSALS as readonly string[]).not.toContain('ticket-not-open');
  });
});
