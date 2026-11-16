// The `delegation` frame's builders (delegation broker wave 4, PR2). Neutral names only: project `project-a`, parents
// `coord-a` and `worker-a`. The defaults are what PR1's decider sends: an `agent` worktree with `inferred: null`, and a
// `raw` one (pass `sourceKind: 'raw'`) whose `inferred` names the creating Bash call, unless the caller overrides it.
import type {
  DelegationActivityWire, DelegationLeaseWire, DelegationProjectionWire, DelegationUnownedWire,
} from '../../shared/api';

export const TOOL_USE_ID = 'toolu_test_0001';

export const activity = (over: Partial<DelegationActivityWire> = {}): DelegationActivityWire => ({
  activityId: 'act-1', parentId: 'coord-a', group: 'parent', placement: 'row', sourceKind: 'agent',
  upstreamId: 'agent-a1', displayName: 'explore the tree', liveness: 'live',
  openedAt: '2026-10-26T10:00:00.000Z', lastEventAt: '2026-10-26T10:05:00.000Z',
  ...over,
});

export const lease = (over: Partial<DelegationLeaseWire> = {}): DelegationLeaseWire => {
  const sourceKind = over.sourceKind ?? 'agent';
  return {
    leaseId: 'lease-1', parentId: 'coord-a', via: null, group: 'parent', project: 'project-a',
    adminRecord: 'agent-a1', canonicalPath: '/work/project-a/.claude/worktrees/agent-a1',
    sourceKind, workspace: 'present', liveness: 'live',
    inferred: sourceKind === 'raw' ? { creator: { kind: 'bash-call', toolUseId: TOOL_USE_ID } } : null,
    firstObservedAt: '2026-10-26T10:01:00.000Z',
    ...over,
  };
};

export const unowned = (over: Partial<DelegationUnownedWire> = {}): DelegationUnownedWire => ({
  project: 'project-a', adminRecord: 'agent-u1', canonicalPath: '/work/project-a/.claude/worktrees/agent-u1',
  verdict: 'unresolved', reason: 'no-correlating-evidence', rung: null, workspace: 'present',
  attemptedAt: '2026-10-26T09:00:00.000Z',
  ...over,
});

export const frame = (over: Partial<DelegationProjectionWire> = {}): DelegationProjectionWire => ({
  asOf: '2026-10-26T10:10:00.000Z', activities: [], leases: [], unowned: [],
  ...over,
});
