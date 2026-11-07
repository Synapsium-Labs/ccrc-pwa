// Delegation broker wave 4, PR2 Task 2.2, and delegation visibility Task 1: the delegation rows' words
// (`fleet/delegationWords.ts`). D-6999's inferred chip, member tolerance, words that never say running (spec §4),
// and a chip that counts every attached entry (D-7781).
import { describe, expect, it } from 'vitest';
import {
  DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LEASE_SOURCE_KINDS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS,
  DELEGATION_WORKSPACE_STATES, type DelegationActivityWire, type DelegationLeaseWire,
} from '../../shared/api';
import * as words from '../src/fleet/delegationWords';
import {
  ACTIVITY_WORD, ENTRIES_NOTE, GROUP_WORDS, LIVENESS_QUALIFIER, UNRECOGNISED_WORD, VERDICT_WORD, WORKSPACE_WORD,
  WORKTREE_WORD, activitiesStartedBy, activityLine, creatorChip, delegatedChip, delegationParts, fromPart, inferredChip,
  readDelegation, unlistedToggle, worktreeLine,
} from '../src/fleet/delegationWords';
import { TOOL_USE_ID, activity, frame, lease, unowned } from './delegationFixture';
import { DELEGATION_CARRIER_STATES } from '../../shared/api';

describe('delegationWords (delegation broker wave 4, PR2)', () => {
  it('W4-U6: the inferred chip holds exactly for a raw or marked worktree, in every group, workspace and via', () => {
    const creators: DelegationLeaseWire['inferred'][] = [
      { creator: { kind: 'bash-call', toolUseId: TOOL_USE_ID } }, { creator: { kind: 'unmeasured' } }, null,
    ];
    let cases = 0;
    for (const sourceKind of DELEGATION_LEASE_SOURCE_KINDS) {
      for (const group of DELEGATION_ROW_GROUPS) {
        for (const workspace of ['present', 'unmeasured'] as const) {
          for (const via of [null, 'worker-a']) {
            for (const inferred of creators) {
              const l = lease({ sourceKind, group, workspace, via, inferred });
              const should = sourceKind === 'raw' || inferred !== null;
              const tag = JSON.stringify({ sourceKind, group, workspace, via, inferred });
              expect(inferredChip(l)?.text ?? null, tag).toBe(should ? 'inferred' : null);
              expect(creatorChip(l) !== null, tag).toBe(should);
              if (should && inferred?.creator.kind === 'bash-call') {
                expect(creatorChip(l)!.title, tag).toContain(TOOL_USE_ID);
                expect(inferredChip(l)!.title, tag).toContain(TOOL_USE_ID);
              }
              cases += 1;
            }
          }
        }
      }
    }
    expect(cases).toBe(DELEGATION_LEASE_SOURCE_KINDS.length * DELEGATION_ROW_GROUPS.length * 2 * 2 * 3);
    expect(creatorChip(lease({ sourceKind: 'raw' }))!.text).toBe('Bash call …est_0001');
  });

  it('W4-U7: readDelegation re-files a newer server\'s words and drops no member', () => {
    const w = frame({
      activities: [
        activity({ activityId: 'a1', group: 'future-word' as never }),
        activity({ activityId: 'a2', placement: 'future-word' as never }),
        activity({ activityId: 'a3', liveness: 'future-word' as never }),
      ],
      leases: [
        lease({ leaseId: 'l1', group: 'future-word' as never }),
        lease({ leaseId: 'l2', liveness: 'future-word' as never }),
        lease({ leaseId: 'l3', workspace: 'future-word' as never }),
        lease({ leaseId: 'l4', sourceKind: 'future-kind' as never, inferred: null }),
        lease({ leaseId: 'l5', sourceKind: 'future-kind' as never, inferred: { creator: { kind: 'bash-call', toolUseId: TOOL_USE_ID } } }),
        lease({ leaseId: 'l6', sourceKind: 'raw', inferred: null, liveness: 'future-word' as never, group: 'future-word' as never }),
      ],
      unowned: [unowned({ verdict: 'future-word' as never, workspace: 'future-word' as never })],
    });
    const r = readDelegation(w);
    expect(r.activities.length).toBe(3);
    expect(r.leases.length).toBe(6);
    expect(r.unowned.length).toBe(1);
    const act = new Map(r.activities.map((a) => [a.activityId, a] as const));
    const tree = new Map(r.leases.map((l) => [l.leaseId, l] as const));
    expect(act.get('a1')!.group).toBe('offline-coordinator');
    expect(act.get('a2')!.placement).toBe('row');
    expect(act.get('a3')!.liveness).toBe('unmeasured');
    expect(tree.get('l1')!.group).toBe('offline-coordinator');
    expect(tree.get('l2')!.liveness).toBe('unmeasured');
    expect(tree.get('l3')!.workspace).toBe('unmeasured');
    expect(worktreeLine(tree.get('l4')!, null, null).parts[0]).toBe(UNRECOGNISED_WORD);
    expect(inferredChip(tree.get('l4')!)).toBeNull();
    expect(inferredChip(tree.get('l5')!)?.text).toBe('inferred');
    expect(inferredChip(tree.get('l6')!)?.text).toBe('inferred');
    expect(creatorChip(tree.get('l6')!)!.text).toBe('Bash call (id not recorded)');
    expect(r.unowned[0]!.workspace).toBe('unmeasured');
    // Never "running": an unknown liveness is never read as live, whatever else the member carries.
    expect(tree.get('l6')!.liveness).toBe('unmeasured');
    expect(tree.get('l6')!.group).toBe('offline-coordinator');
    expect(worktreeLine(tree.get('l2')!, null, null).parts).not.toContain('running');
  });

  it('W4-U8 (D-7781): the chip counts every entry of every liveness, says none is confirmed, and is null with none', () => {
    const three = [
      activity({ activityId: 'a3', displayName: 'check the build', liveness: 'unmeasured', openedAt: '2026-10-26T10:02:00.000Z' }),
      activity({ activityId: 'a1', displayName: 'map the tree' }),
      activity({ activityId: 'a2', displayName: null, liveness: 'stale', openedAt: '2026-10-26T10:01:00.000Z' }),
    ];
    const chip = delegatedChip(three)!;
    expect(chip.text).toBe('3 delegated');
    expect(chip.count).toBe(3);
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

  it('W4-U9: the worktree line names via, hands sourceProject back, marks an unmeasured workspace, titles the path', () => {
    const l = lease();
    const plain = worktreeLine(l, null, null);
    expect(plain.parts.some((p) => p.startsWith('via '))).toBe(false);
    expect(plain.sourceProject).toBeNull();
    expect(plain.parts).not.toContain('unmeasured');
    expect(plain.title).toBe(`${l.canonicalPath}; ${LIVENESS_QUALIFIER.live.title}`);
    expect(worktreeLine(l, 'worker-a', null).parts).toContain('via worker-a');
    expect(worktreeLine(l, null, 'project-b').sourceProject).toBe('project-b');
    expect(worktreeLine(lease({ workspace: 'unmeasured' }), null, null).parts).toContain('unmeasured');
  });

  it('W4-U10: no exported word says lease, adopt, retain, clean or spool, and every table is total over its L0 list', () => {
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) collect(x);
    };
    collect(Object.fromEntries(Object.entries(words).filter(([, v]) => typeof v !== 'function')));
    const l = lease({ sourceKind: 'raw' });
    for (const out of [inferredChip(l), creatorChip(l), creatorChip(lease({ sourceKind: 'raw', inferred: null })),
      worktreeLine(l, 'worker-a', 'project-b'), words.activityLine(activity()), words.unownedLine(unowned()),
      delegatedChip([activity()]), delegationParts([{ kind: 'activity' }, { kind: 'lease' }])]) collect(out);
    expect(strings.length).toBeGreaterThan(20);
    for (const s of strings) expect(s, s).not.toMatch(/lease|adopt|retain|clean|spool/i);

    expect(Object.keys(LIVENESS_QUALIFIER).sort()).toEqual([...DELEGATION_LIVENESS].sort());
    expect(Object.keys(WORKTREE_WORD).sort()).toEqual([...DELEGATION_LEASE_SOURCE_KINDS].sort());
    expect(Object.keys(WORKSPACE_WORD).sort())
      .toEqual(DELEGATION_WORKSPACE_STATES.filter((s) => !['none', 'provisioning', 'absent'].includes(s)).sort());
    expect(Object.keys(GROUP_WORDS).sort()).toEqual([...DELEGATION_ROW_GROUPS.filter((g) => g !== 'parent'), 'unowned'].sort());
    expect(Object.keys(ACTIVITY_WORD).sort()).toEqual(['agent', 'workflow']);
    expect(Object.keys(VERDICT_WORD).sort()).toEqual(['conflicting', 'unresolved']);
    expect(DELEGATION_ACTIVITY_PLACEMENTS).toEqual(['row', 'chip']);
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
      collect(worktreeLine(lease({ liveness }), 'worker-a', 'project-b', 'coord-a'));
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
    expect(worktreeLine(lease({ liveness: 'ended' }), null, null).parts[2]).toBe('end recorded');
    // A newer server's liveness word is re-filed unmeasured by the reader, never drawn as live.
    const future = readDelegation(frame({ activities: [activity({ liveness: 'future-word' as never })] })).activities[0]!;
    expect(activityLine(future).parts).toContain('unmeasured');
    expect(activityLine(future).parts).not.toContain('not confirmed');
    // The line's own fallback, with no reader in front of it (`qualifierOf`; VIS-M10): still unmeasured, never live.
    const direct = activityLine(activity({ liveness: 'future-word' as never, displayName: null }));
    expect(direct.parts).toEqual(['agent', 'unmeasured']);
    expect(direct.title).toContain(LIVENESS_QUALIFIER.unmeasured.title);
    const directTree = worktreeLine(lease({ liveness: 'future-word' as never }), null, null);
    expect(directTree.parts).toEqual(['agent worktree', 'agent-a1', 'unmeasured']);
    expect(directTree.title).toBe(`${lease().canonicalPath}; ${LIVENESS_QUALIFIER.unmeasured.title}`);
  });

  it('VIS-W2: titles name the qualifier and hook events; a from part names the session, last', () => {
    const a = activityLine(activity());
    expect(a.title).toBe(`agent agent-a1: ${LIVENESS_QUALIFIER.live.title}; opened 2026-10-26T10:00:00.000Z, `
      + 'last recorded hook event 2026-10-26T10:05:00.000Z');
    expect(a.title).not.toMatch(/last event/);
    expect(a.parts).toEqual(['agent', 'explore the tree', 'not confirmed']);
    expect(activityLine(activity(), 'coord-a').parts).toEqual(['agent', 'explore the tree', 'not confirmed', 'from coord-a']);
    expect(worktreeLine(lease({ workspace: 'unmeasured' }), 'worker-a', null, 'coord-gone').parts)
      .toEqual(['agent worktree', 'agent-a1', 'not confirmed', 'via worker-a', 'unmeasured', 'from coord-gone']);
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

  it('VIS-W5 (review 1431 F3): nameAt points at the one free-text part of each line, and only there', () => {
    const named = activityLine(activity({ displayName: 'map the tree' }), 'coord-a');
    expect(named.nameAt).toBe(1);
    expect(named.parts[named.nameAt!]).toBe('map the tree');
    expect(activityLine(activity({ displayName: null })).nameAt).toBeNull();
    expect(activityLine(activity({ displayName: '' })).nameAt).toBeNull();
    const tree = worktreeLine(lease({ adminRecord: 'agent-x9' }), 'worker-a', null, 'coord-gone');
    expect(tree.nameAt).toBe(1);
    expect(tree.parts[tree.nameAt!]).toBe('agent-x9');
    const u = words.unownedLine(unowned({ adminRecord: 'agent-u9' }));
    expect(u.nameAt).toBe(0);
    expect(u.parts[u.nameAt!]).toBe('agent-u9');
    // The session header's rows carry it through.
    expect(delegatedChip([activity({ displayName: 'read the plan' })])!.rows[0]!.nameAt).toBe(1);
  });
});

// Delegation broker wave 5, PR10 Task 5.10.1: a worktree's keep, attach and disposition words, and the readers of the wire
// fields PR7 and PR8 added. O5-6 (a) (D-7845): the census stays closed; O5-8 (c) (D-7847): no tree doors.
describe('worktree controls\' words (delegation broker wave 5, PR10)', () => {
  const strings = (vs: readonly unknown[]): string[] => {
    const out: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') out.push(v);
      else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) collect(x);
    };
    for (const v of vs) collect(v);
    return out;
  };

  it('W5-U1: every reader returns null for a wire without its field (an older server), and reads the field when present', () => {
    expect(words.dispositionOf(lease())).toBeNull();
    expect(words.expiryOf(lease())).toBeNull();
    expect(words.hiddenLeaseOf(unowned())).toBeNull();
    expect(words.worktreeActs(lease())).toEqual([]);
    expect(words.worktreeActs(lease({ sourceKind: 'raw' }))).toEqual([]);
    expect(words.unownedActs(unowned())).toEqual([]);
    expect(words.dispositionOf(lease({ disposition: 'adopted' }))).toBe('adopted');
    expect(words.dispositionOf(lease({ disposition: 'future-word' as never }))).toBeNull();
    expect(words.expiryOf(lease({ expiresAt: '2026-11-17T12:00:00.000Z' }))).toBe('2026-11-17T12:00:00.000Z');
    expect(words.expiryOf(lease({ expiresAt: null }))).toBeNull();
    expect(words.hiddenLeaseOf(unowned({ leaseId: 'lease-h' }))).toBe('lease-h');
    expect(words.hiddenLeaseOf(unowned({ leaseId: '' }))).toBeNull();
    expect(words.hiddenLeaseOf(unowned({ leaseId: 42 as never }))).toBeNull();
    // The reader keeps the field through `readDelegation`, which spreads every member as it came.
    const r = readDelegation(frame({ leases: [lease({ disposition: 'retained', expiresAt: '2026-11-17T12:00:00.000Z' })],
      unowned: [unowned({ leaseId: 'lease-h' })] }));
    expect(words.dispositionOf(r.leases[0]!)).toBe('retained');
    expect(words.hiddenLeaseOf(r.unowned[0]!)).toBe('lease-h');
  });

  it('W5-U2: keptUntilWord formats the UTC day and month, adds the year only when it differs, and never says expires', () => {
    const now = Date.parse('2026-11-07T09:00:00.000Z');
    expect(words.keptUntilWord('2026-11-17T12:00:00.000Z', now)).toBe('kept until 17 Nov');
    // UTC, not the reader's zone: 23:30 UTC on the 30th is the 30th.
    expect(words.keptUntilWord('2026-11-30T23:30:00.000Z', now)).toBe('kept until 30 Nov');
    expect(words.keptUntilWord('2027-01-03T00:00:00.000Z', now)).toBe('kept until 3 Jan 2027');
    expect(words.keptUntilWord('not a date', now)).toBe('kept, until a date that could not be read');
    for (const s of ['2026-11-17T12:00:00.000Z', '2027-01-03T00:00:00.000Z', 'not a date']) {
      expect(words.keptUntilWord(s, now)).not.toMatch(/expire/i);
    }
  });

  it('W5-U3: W4-U10\'s census and the running ban stay green with the control words; every disposition has its word', () => {
    const now = Date.parse('2026-11-07T09:00:00.000Z');
    const exported = Object.fromEntries(Object.entries(words).filter(([, v]) => typeof v !== 'function'));
    const all = strings([exported, words.keptUntilWord('2026-11-17T12:00:00.000Z', now), words.keptUntilWord('x', now),
      words.attachConfirm('coord-a'), words.notDelegatedConfirm, words.keptWord('2026-11-24T12:00:00.000Z', now)]);
    expect(all).toContain('Keep worktree');
    expect(all).toContain('Attach to…');
    expect(all).toContain('Not delegated');
    for (const s of all) {
      expect(s, s).not.toMatch(/lease|adopt|retain|clean|spool/i);
      expect(s, s).not.toMatch(/running|\bactive\b|recent/i);
    }
    expect(Object.keys(words.DISPOSITION_WORD).sort())
      .toEqual(DELEGATION_CARRIER_STATES.filter((s) => s !== 'released').sort());
    expect(words.DISPOSITION_WORD).toEqual({
      ephemeral: null, adopted: 'worktree kept', retained: 'worktree kept', transferring: 'moving to a run', promoted: 'moved to a run',
    });
    expect(words.notDelegatedConfirm.consequence).toBe(
      'This worktree is not delegated work. It will no longer be shown here, and it is not held back from the disk sweep.');
  });

  it('W5-U8 (words): which controls a worktree row offers, by disposition and source (O5-8 (c))', () => {
    const acts = (over: Parameters<typeof lease>[0]) => words.worktreeActs(lease(over));
    expect(acts({ disposition: 'ephemeral' })).toEqual(['keep', 'foreign']);
    expect(acts({ disposition: 'adopted' })).toEqual(['keep', 'foreign']);
    expect(acts({ disposition: 'retained' })).toEqual(['keep', 'foreign']);
    expect(acts({ disposition: 'transferring' })).toEqual([]);
    expect(acts({ disposition: 'promoted' })).toEqual(['foreign']);
    expect(acts({ disposition: 'ephemeral', sourceKind: 'raw' })).toEqual(['keep', 'attach', 'foreign']);
    expect(acts({ disposition: 'retained', sourceKind: 'raw' })).toEqual(['keep', 'attach', 'foreign']);
    expect(acts({ disposition: 'transferring', sourceKind: 'raw' })).toEqual([]);
    // An unowned row acts only through the lease the projection hid on its tree; with none it offers nothing.
    expect(words.unownedActs(unowned({ leaseId: 'lease-h' }))).toEqual(['foreign']);
    expect(words.unownedActs(unowned({ verdict: 'conflicting' }))).toEqual([]);
    // The lease's own parent is the only attach choice: under R9 the row's parentId is the coordinator and via is the parent.
    expect(words.leaseParentOf(lease({ parentId: 'coord-a', via: 'worker-a' }))).toBe('worker-a');
    expect(words.leaseParentOf(lease({ parentId: 'coord-a', via: null }))).toBe('coord-a');
  });

  it('the disposition words join a worktree line only on a newer server\'s row, and the kept date only with a hold', () => {
    const now = Date.parse('2026-11-07T09:00:00.000Z');
    expect(words.dispositionParts(lease(), now)).toEqual([]);
    expect(words.dispositionParts(lease({ disposition: 'ephemeral', expiresAt: null }), now)).toEqual([]);
    expect(words.dispositionParts(lease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }), now))
      .toEqual(['worktree kept', 'kept until 17 Nov']);
    expect(words.dispositionParts(lease({ disposition: 'retained', expiresAt: null }), now)).toEqual(['worktree kept']);
    expect(words.dispositionParts(lease({ disposition: 'transferring', expiresAt: '2026-11-17T12:00:00.000Z' }), now))
      .toEqual(['moving to a run']);
    expect(words.dispositionParts(lease({ disposition: 'promoted' }), now)).toEqual(['moved to a run']);
  });
});

