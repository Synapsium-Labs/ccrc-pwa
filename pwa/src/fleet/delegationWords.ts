// THE DELEGATION ROWS' WORDS (delegation broker wave 4, spec §5.8; D-6999, D-7002). L1: one module for every label a
// delegation row, group or chip draws, so no component spells one. The server decides every word on the wire
// (`server/src/coord/delegation-projection.ts`): liveness, the group, an activity's placement, and which worktree is
// `inferred`. This module names those words and tolerates a word this build has never heard of.
//
// THE OPERATOR'S WORD IS "worktree". The wire's lease is never called that on the page.
//
// D-6999: a rung-4 (`raw`) worktree rests on negative evidence (no other session's listing window overlapped the Bash
// call that made it), so it ALWAYS wears the "inferred" chip and a chip naming that call, wherever it is drawn, and
// nothing on the page acts on it. `inferredChip` keys on `sourceKind === 'raw'` as well as on `inferred`, so a raw row
// whose marker went missing still says so.
//
// Imports only `shared/api` and `lib/wire` (never `./fleetTree`, which imports `readDelegation` from here: that would be a cycle).
import {
  DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS,
  type DelegationActivityWire, type DelegationLeaseSourceKind, type DelegationLeaseWire, type DelegationLiveness,
  type DelegationProjectionWire, type DelegationUnownedWire,
} from '../../../shared/api';
import { isRecord } from '../lib/wire';

/** The chip every raw worktree wears (D-6999). */
export const INFERRED_WORD = 'inferred';
/** The word for a value this build cannot name: drawn, never dropped and never read as a known word. */
export const UNRECOGNISED_WORD = 'unrecognised';

export interface Chip { readonly text: string; readonly title: string }

/** The two group headers of a card (rules 9 and 10 of `nestFleet`). */
export const GROUP_WORDS: Readonly<Record<'offline-coordinator' | 'unowned', { label: string; title: string }>> = {
  'offline-coordinator': {
    label: 'Offline coordinator',
    title: 'work whose session is not running as the one that started it, or is not on this card',
  },
  unowned: {
    label: 'Unowned work',
    title: 'worktrees no session could be tied to; being listed here never makes one eligible for removal',
  },
};

export const ACTIVITY_WORD: Readonly<Record<DelegationActivityWire['sourceKind'], string>> = {
  agent: 'agent',
  workflow: 'workflow',
};

export const WORKTREE_WORD: Readonly<Record<DelegationLeaseSourceKind, string>> = {
  agent: 'agent worktree',
  workflow: 'workflow worktree',
  raw: 'worktree',
  attached: 'attached worktree',
};

/** Only `live` reads "running" (PR2: never label a row running unless the server measured it live). */
export const LIVENESS_WORD: Readonly<Record<DelegationLiveness, string>> = {
  live: 'running',
  stale: 'stale',
  ended: 'ended',
  unmeasured: 'unmeasured',
};

/** A present worktree says nothing; an unmeasured one says so. */
export const WORKSPACE_WORD: Readonly<Record<DelegationLeaseWire['workspace'], string | null>> = {
  present: null,
  unmeasured: 'unmeasured',
};

export const VERDICT_WORD: Readonly<Record<DelegationUnownedWire['verdict'], string>> = {
  unresolved: 'no owner found',
  conflicting: 'two owners claimed it',
};

/** A table's word for `key`, or the unrecognised word when the table has none (a newer server's word). */
const wordOf = (table: Readonly<Record<string, string>>, key: string): string =>
  Object.hasOwn(table, key) ? table[key]! : UNRECOGNISED_WORD;

const groupOf = (g: unknown): DelegationActivityWire['group'] =>
  (DELEGATION_ROW_GROUPS as readonly unknown[]).includes(g) ? g as DelegationActivityWire['group'] : 'offline-coordinator';
const placementOf = (p: unknown): DelegationActivityWire['placement'] =>
  (DELEGATION_ACTIVITY_PLACEMENTS as readonly unknown[]).includes(p) ? p as DelegationActivityWire['placement'] : 'row';
const livenessOf = (l: unknown): DelegationLiveness =>
  (DELEGATION_LIVENESS as readonly unknown[]).includes(l) ? l as DelegationLiveness : 'unmeasured';
const workspaceOf = (w: unknown): DelegationLeaseWire['workspace'] =>
  Object.hasOwn(WORKSPACE_WORD, String(w)) ? w as DelegationLeaseWire['workspace'] : 'unmeasured';
/** A marker this build cannot read is still a marker: it keeps the chip, with an unmeasured creator. */
const inferredOf = (i: unknown): DelegationLeaseWire['inferred'] => {
  if (i === null || i === undefined) return null;
  const c = isRecord(i) ? i.creator : undefined;
  if (isRecord(c) && c.kind === 'bash-call' && typeof c.toolUseId === 'string') return { creator: { kind: 'bash-call', toolUseId: c.toolUseId } };
  return { creator: { kind: 'unmeasured' } };
};

/**
 * Member tolerance: a member carrying a word this build cannot name is KEPT. An unknown group is re-filed
 * `offline-coordinator`, an unknown placement `row`, an unknown liveness or workspace `unmeasured`; any other unknown
 * word renders with the `unrecognised` word. Never dropped, never "running". (A member that is not an object at all
 * carries nothing to draw and no key, and is the one thing left out.)
 */
export function readDelegation(w: DelegationProjectionWire): DelegationProjectionWire {
  const activities = w.activities.filter(isRecord).map((a): DelegationActivityWire => {
    const liveness = livenessOf(a.liveness);
    return {
      ...a, group: groupOf(a.group), placement: placementOf(a.placement),
      // An `ended` activity is never on the wire; one that arrives anyway is not drawn as a known state.
      liveness: liveness === 'ended' ? 'unmeasured' : liveness,
    };
  });
  const leases = w.leases.filter(isRecord).map((l): DelegationLeaseWire => ({
    ...l, group: groupOf(l.group), liveness: livenessOf(l.liveness), workspace: workspaceOf(l.workspace),
    via: typeof l.via === 'string' ? l.via : null, inferred: inferredOf(l.inferred),
  }));
  const unowned = w.unowned.filter(isRecord).map((u): DelegationUnownedWire => ({ ...u, workspace: workspaceOf(u.workspace) }));
  return { ...w, activities, leases, unowned };
}

const creatorOf = (l: DelegationLeaseWire): string | null =>
  l.inferred !== null && l.inferred.creator.kind === 'bash-call' ? l.inferred.creator.toolUseId : null;

/** D-6999: non-null for every raw worktree and every worktree the server marked, whatever its group or fold. */
export function inferredChip(l: DelegationLeaseWire): Chip | null {
  if (l.sourceKind !== 'raw' && l.inferred === null) return null;
  const id = creatorOf(l);
  const call = id === null ? 'a Bash call whose id was not recorded' : `Bash call ${id}`;
  return {
    text: INFERRED_WORD,
    title: `linked by the worktree listing taken before and after ${call}, with no other session's listing overlapping it; `
      + 'no upstream id confirms it, and nothing acts on it automatically',
  };
}

/** The Bash call that created an inferred worktree: its id's last eight characters, the whole id in the title. */
export function creatorChip(l: DelegationLeaseWire): Chip | null {
  if (inferredChip(l) === null) return null;
  const id = creatorOf(l);
  if (id === null) {
    return { text: 'Bash call (id not recorded)', title: 'the Bash call that created this worktree was not recorded' };
  }
  return { text: `Bash call …${id.slice(-8)}`, title: `the Bash call that created this worktree: ${id}` };
}

/** A worktree's row. `viaLabel` is the worker the server's R9 names (already resolved to a label by the caller);
 *  `sourceProject` is `workingOnCard`'s answer for the row's own project, handed back for the caller's folder icon. */
export function worktreeLine(
  l: DelegationLeaseWire, viaLabel: string | null, sourceProject: string | null,
): { parts: readonly string[]; title: string; sourceProject: string | null } {
  const parts = [wordOf(WORKTREE_WORD, l.sourceKind), l.adminRecord, wordOf(LIVENESS_WORD, l.liveness)];
  if (viaLabel !== null) parts.push(`via ${viaLabel}`);
  const ws = Object.hasOwn(WORKSPACE_WORD, l.workspace) ? WORKSPACE_WORD[l.workspace] : UNRECOGNISED_WORD;
  if (ws !== null) parts.push(ws);
  return { parts, title: l.canonicalPath, sourceProject };
}

/** A delegated agent's or workflow's row. */
export function activityLine(a: DelegationActivityWire): { parts: readonly string[]; title: string } {
  const word = wordOf(ACTIVITY_WORD, a.sourceKind);
  const parts = [word, ...(a.displayName !== null && a.displayName !== '' ? [a.displayName] : []), wordOf(LIVENESS_WORD, a.liveness)];
  return { parts, title: `${word} ${a.upstreamId}, opened ${a.openedAt}, last event ${a.lastEventAt}` };
}

/** An unowned tree's row. */
export function unownedLine(u: DelegationUnownedWire): { parts: readonly string[]; title: string } {
  const parts = [u.adminRecord, wordOf(VERDICT_WORD, u.verdict)];
  const ws = Object.hasOwn(WORKSPACE_WORD, u.workspace) ? WORKSPACE_WORD[u.workspace] : UNRECOGNISED_WORD;
  if (ws !== null) parts.push(ws);
  return { parts, title: `${u.canonicalPath ?? u.adminRecord}: ${u.reason}` };
}

/** R9: a programme worker's live delegated work as ONE chip on its row. Only `live` members count. */
export function delegatedChip(activities: readonly DelegationActivityWire[]): Chip | null {
  const live = activities.filter((a) => a.liveness === 'live');
  if (live.length === 0) return null;
  const names = live.map((a) => a.displayName ?? wordOf(ACTIVITY_WORD, a.sourceKind));
  return { text: `${live.length} delegated`, title: `delegated work running: ${names.join(', ')}` };
}

/** Every activity a session started, whatever its placement: the session header's chip reads the card's list. */
export function liveActivitiesOf(id: string, w: DelegationProjectionWire): readonly DelegationActivityWire[] {
  return w.activities.filter((a) => a.parentId === id);
}

/** A coordinator's summary counts for its delegation children: `n delegated`, `n worktree(s)`; zero counts say nothing. */
export function delegationParts(rows: readonly { kind: 'activity' | 'lease' }[]): { readonly n: number; readonly word: string }[] {
  const acts = rows.filter((r) => r.kind === 'activity').length;
  const trees = rows.filter((r) => r.kind === 'lease').length;
  return [
    ...(acts > 0 ? [{ n: acts, word: 'delegated' }] : []),
    ...(trees > 0 ? [{ n: trees, word: trees === 1 ? 'worktree' : 'worktrees' }] : []),
  ];
}
