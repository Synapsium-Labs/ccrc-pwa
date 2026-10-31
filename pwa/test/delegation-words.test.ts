// Delegation broker wave 4, PR2 Task 2.2: the delegation rows' words (`fleet/delegationWords.ts`). D-6999's inferred
// chip on every raw worktree, member tolerance for a newer server's words, and the R9 chip's live-only count.
import { describe, expect, it } from 'vitest';
import {
  DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LEASE_SOURCE_KINDS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS,
  DELEGATION_WORKSPACE_STATES, type DelegationLeaseWire,
} from '../../shared/api';
import * as words from '../src/fleet/delegationWords';
import {
  ACTIVITY_WORD, GROUP_WORDS, LIVENESS_WORD, UNRECOGNISED_WORD, VERDICT_WORD, WORKSPACE_WORD, WORKTREE_WORD,
  creatorChip, delegatedChip, delegationParts, inferredChip, liveActivitiesOf, readDelegation, worktreeLine,
} from '../src/fleet/delegationWords';
import { TOOL_USE_ID, activity, frame, lease, unowned } from './delegationFixture';

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

  it('W4-U8: the R9 chip counts live members only, and is null with none', () => {
    const two = [activity({ activityId: 'a1', displayName: 'map the tree' }), activity({ activityId: 'a2', displayName: null })];
    const chip = delegatedChip(two)!;
    expect(chip.text).toBe('2 delegated');
    expect(chip.title).toContain('map the tree');
    expect(chip.title).toContain('agent');
    expect(delegatedChip([...two, activity({ activityId: 'a3', liveness: 'stale' }), activity({ activityId: 'a4', liveness: 'unmeasured' })])!.text)
      .toBe('2 delegated');
    expect(delegatedChip([activity({ liveness: 'stale' }), activity({ liveness: 'unmeasured' })])).toBeNull();
    expect(delegatedChip([])).toBeNull();
  });

  it('W4-U9: the worktree line names via, hands sourceProject back, marks an unmeasured workspace, titles the path', () => {
    const l = lease();
    const plain = worktreeLine(l, null, null);
    expect(plain.parts.some((p) => p.startsWith('via '))).toBe(false);
    expect(plain.sourceProject).toBeNull();
    expect(plain.parts).not.toContain('unmeasured');
    expect(plain.title).toBe(l.canonicalPath);
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

    expect(Object.keys(LIVENESS_WORD).sort()).toEqual([...DELEGATION_LIVENESS].sort());
    expect(Object.keys(WORKTREE_WORD).sort()).toEqual([...DELEGATION_LEASE_SOURCE_KINDS].sort());
    expect(Object.keys(WORKSPACE_WORD).sort())
      .toEqual(DELEGATION_WORKSPACE_STATES.filter((s) => !['none', 'provisioning', 'absent'].includes(s)).sort());
    expect(Object.keys(GROUP_WORDS).sort()).toEqual([...DELEGATION_ROW_GROUPS.filter((g) => g !== 'parent'), 'unowned'].sort());
    expect(Object.keys(ACTIVITY_WORD).sort()).toEqual(['agent', 'workflow']);
    expect(Object.keys(VERDICT_WORD).sort()).toEqual(['conflicting', 'unresolved']);
    expect(DELEGATION_ACTIVITY_PLACEMENTS).toEqual(['row', 'chip']);
  });

  it('liveActivitiesOf selects every activity a session started, whatever its placement', () => {
    const w = frame({ activities: [activity({ activityId: 'a1', parentId: 'worker-a', placement: 'chip' }),
      activity({ activityId: 'a2', parentId: 'worker-a', placement: 'row' }), activity({ activityId: 'a3', parentId: 'coord-a' })] });
    expect(liveActivitiesOf('worker-a', w).map((a) => a.activityId)).toEqual(['a1', 'a2']);
  });
});
