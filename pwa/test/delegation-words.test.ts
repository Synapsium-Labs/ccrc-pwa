// Delegation broker wave 4, PR2 Task 2.2, and delegation visibility Task 1: the delegation entries' words
// (`fleet/delegationWords.ts`): member tolerance, words that never say running (spec §4), and a chip that counts every
// attached entry (D-7781). The worktree and unowned words, and the worktree controls' words, went with the fleet list's
// worktree and unowned rows (D-8782).
import { describe, expect, it } from 'vitest';
import { DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LIVENESS, type DelegationActivityWire } from '../../shared/api';
import * as words from '../src/fleet/delegationWords';
import {
  ACTIVITY_WORD, ENTRIES_NOTE, LIVENESS_QUALIFIER, activitiesStartedBy, activityLine, delegatedChip,
  fromPart, readDelegation, unlistedToggle,
} from '../src/fleet/delegationWords';
import { activity, frame } from './delegationFixture';

describe('delegationWords (delegation broker wave 4, PR2)', () => {
  it('W4-U7: readDelegation re-files a newer server\'s words and drops no member', () => {
    const w = frame({
      activities: [
        activity({ activityId: 'a1', group: 'future-word' as never }),
        activity({ activityId: 'a2', placement: 'future-word' as never }),
        activity({ activityId: 'a3', liveness: 'future-word' as never }),
      ],
    });
    const r = readDelegation(w);
    expect(r.activities.length).toBe(3);
    const act = new Map(r.activities.map((a) => [a.activityId, a] as const));
    expect(act.get('a1')!.group).toBe('offline-coordinator');
    expect(act.get('a2')!.placement).toBe('row');
    expect(act.get('a3')!.liveness).toBe('unmeasured');
    // Never "running": an unknown liveness is never read as live, whatever else the member carries.
    expect(activityLine(act.get('a3')!).parts).not.toContain('running');
    // D-8782: the reader files the activities only; a frame's worktrees and unowned trees pass through as they came.
    expect(readDelegation({ ...w, leases: [{ leaseId: 'l1' } as never] }).leases).toEqual([{ leaseId: 'l1' }]);
  });

  it('W4-U8 (D-7781): the chip counts every entry of every liveness, says none is confirmed, and is null with none', () => {
    const three = [
      activity({ activityId: 'a3', displayName: 'check the build', liveness: 'unmeasured', openedAt: '2026-10-26T10:02:00.000Z' }),
      activity({ activityId: 'a1', displayName: 'map the tree' }),
      activity({ activityId: 'a2', displayName: null, liveness: 'stale', openedAt: '2026-10-26T10:01:00.000Z' }),
    ];
    const chip = delegatedChip(three)!;
    expect(chip.text).toBe('3 delegated');
    expect(chip, 'D-8771: no count field survives').not.toHaveProperty('count');
    expect(chip.title).toBe('3 recorded delegation entries, not a current agent count; execution not confirmed');
    expect(chip.note).toBe(ENTRIES_NOTE);
    expect(chip.rows.map((r) => r.key)).toEqual(['a1', 'a2', 'a3']);
    expect(chip.rows.map((r) => r.parts)).toEqual([
      ['agent', 'map the tree', 'not confirmed'], ['agent', 'stop not seen'], ['agent', 'check the build', 'unmeasured'],
    ]);
    expect(delegatedChip([activity({ liveness: 'stale' })])!.title)
      .toBe('1 recorded delegation entry, not a current agent count; execution not confirmed');
    expect(delegatedChip([])).toBeNull();
  });

  it('W4-U10: no exported word says lease, adopt, retain, clean or spool, and every table is total over its L0 list', () => {
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) collect(x);
    };
    collect(Object.fromEntries(Object.entries(words).filter(([, v]) => typeof v !== 'function')));
    for (const out of [words.activityLine(activity()), delegatedChip([activity()])]) collect(out);
    expect(strings.length).toBeGreaterThan(10);
    for (const s of strings) expect(s, s).not.toMatch(/lease|adopt|retain|clean|spool/i);

    expect(Object.keys(LIVENESS_QUALIFIER).sort()).toEqual([...DELEGATION_LIVENESS].sort());
    expect(Object.keys(ACTIVITY_WORD).sort()).toEqual(['agent', 'workflow']);
    expect(DELEGATION_ACTIVITY_PLACEMENTS).toEqual(['row', 'chip']);
  });

  it('C48 (D-8782): the session\'s details still list every activity, an agent and a workflow, each with its word and title', () => {
    const agent = activity({ activityId: 'a-agent', parentId: 'coord-a', sourceKind: 'agent', displayName: 'map the tree' });
    const flow = activity({ activityId: 'a-flow', parentId: 'coord-a', sourceKind: 'workflow', displayName: 'nightly sweep',
      openedAt: '2026-10-26T10:00:30.000Z' });
    const entries = activitiesStartedBy('coord-a', readDelegation(frame({ activities: [agent, flow, activity({ activityId: 'a-other', parentId: 'worker-a' })] })));
    expect(entries.map((a) => a.activityId)).toEqual(['a-agent', 'a-flow']);
    const chip = delegatedChip(entries);
    expect(chip?.text).toBe('2 delegated');
    expect(chip?.rows.map((r) => r.parts)).toEqual([['agent', 'map the tree', 'not confirmed'], ['workflow', 'nightly sweep', 'not confirmed']]);
    expect(chip?.rows.every((r) => r.title.length > 0)).toBe(true);
  });

  it('VIS-W3: activitiesStartedBy selects every entry a session started, whatever its placement or liveness', () => {
    const w = frame({ activities: [activity({ activityId: 'a1', parentId: 'worker-a', placement: 'chip' }),
      activity({ activityId: 'a2', parentId: 'worker-a', placement: 'row', liveness: 'stale' }),
      activity({ activityId: 'a3', parentId: 'coord-a' })] });
    expect(activitiesStartedBy('worker-a', w).map((a) => a.activityId)).toEqual(['a1', 'a2']);
  });

  it('VIS-W1: no delegation word says running; live, stale and unmeasured read apart; the qualifier is total', () => {
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) collect(x);
    };
    collect(Object.fromEntries(Object.entries(words).filter(([, v]) => typeof v !== 'function')));
    for (const liveness of DELEGATION_LIVENESS) {
      if (liveness !== 'ended') collect(activityLine(activity({ liveness }), 'coord-a'));
    }
    collect(delegatedChip([activity(), activity({ activityId: 'a2', liveness: 'stale' })]));
    collect(unlistedToggle(3));
    expect(strings.length).toBeGreaterThan(30);
    // Spec §9's "No running claim", and §4's forbidden totals and phrases.
    for (const s of strings) expect(s, s).not.toMatch(/running|\bactive\b|recent|couldn't check|check deferred/i);
    expect(Object.keys(LIVENESS_QUALIFIER).sort()).toEqual([...DELEGATION_LIVENESS].sort());
    for (const l of DELEGATION_LIVENESS) {
      expect(LIVENESS_QUALIFIER[l].word.length, l).toBeGreaterThan(0);
      expect(LIVENESS_QUALIFIER[l].title.length, l).toBeGreaterThan(20);
    }
    const word = (liveness: DelegationActivityWire['liveness']): string =>
      activityLine(activity({ liveness, displayName: null })).parts[1]!;
    expect((['live', 'stale', 'asleep', 'unmeasured'] as const).map(word))
      .toEqual(['not confirmed', 'stop not seen', 'session asleep', 'unmeasured']);
    expect(LIVENESS_QUALIFIER.ended.word).toBe('end recorded');
    // A newer server's liveness word is re-filed unmeasured by the reader, never drawn as live.
    const future = readDelegation(frame({ activities: [activity({ liveness: 'future-word' as never })] })).activities[0]!;
    expect(activityLine(future).parts).toContain('unmeasured');
    expect(activityLine(future).parts).not.toContain('not confirmed');
    // The line's own fallback, with no reader in front of it (`qualifierOf`; VIS-M10): still unmeasured, never live.
    const direct = activityLine(activity({ liveness: 'future-word' as never, displayName: null }));
    expect(direct.parts).toEqual(['agent', 'unmeasured']);
    expect(direct.title).toContain(LIVENESS_QUALIFIER.unmeasured.title);
  });

  it('VIS-W2: titles name the qualifier and hook events; a from part names the session, last', () => {
    const a = activityLine(activity());
    expect(a.title).toBe(`agent agent-a1: ${LIVENESS_QUALIFIER.live.title}; opened 2026-10-26T10:00:00.000Z, `
      + 'last recorded hook event 2026-10-26T10:05:00.000Z');
    expect(a.title).not.toMatch(/last event/);
    expect(a.parts).toEqual(['agent', 'explore the tree', 'not confirmed']);
    expect(activityLine(activity(), 'coord-a').parts).toEqual(['agent', 'explore the tree', 'not confirmed', 'from coord-a']);
    expect(fromPart('coord-a')).toBe('from coord-a');
    expect(unlistedToggle(2)).toBe('Delegated work, session not listed (2)');
  });

  it('VIS-W4 (review 1424 f): a member with no string openedAt or activityId sorts first and never throws', () => {
    const bad = activity({ activityId: 'a-bad', openedAt: undefined as never });
    const noId = activity({ activityId: 42 as never, openedAt: '2026-10-26T10:01:00.000Z' });
    const good = activity({ activityId: 'a1' });
    const w = readDelegation(frame({ activities: [good, noId, bad] }));
    expect(() => delegatedChip(w.activities)).not.toThrow();
    expect(delegatedChip(w.activities)!.rows.map((r) => r.key)).toEqual(['a-bad', 'a1', 42]);
    expect([...w.activities].sort(words.byOpened).map((a) => a.activityId)).toEqual(['a-bad', 'a1', 42]);
  });

  it('VIS-W5 (review 1431 F3): nameAt points at the one free-text part of the line, and only there', () => {
    const named = activityLine(activity({ displayName: 'map the tree' }), 'coord-a');
    expect(named.nameAt).toBe(1);
    expect(named.parts[named.nameAt!]).toBe('map the tree');
    expect(activityLine(activity({ displayName: null })).nameAt).toBeNull();
    expect(activityLine(activity({ displayName: '' })).nameAt).toBeNull();
    // The session header's rows carry it through.
    expect(delegatedChip([activity({ displayName: 'read the plan' })])!.rows[0]!.nameAt).toBe(1);
  });
});
