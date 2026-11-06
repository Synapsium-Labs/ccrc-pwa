// THE DELEGATION ROWS' WORDS (delegation broker wave 4, spec §5.8; D-6999, D-7002; delegation visibility). L1:
// one module for every label a delegation row, group, chip, the session header's entry list or the fleet foot's region
// draws, so no component spells one. The server decides every word on the wire
// (`server/src/coord/delegation-projection.ts`): liveness, the group, an activity's placement, and which worktree is
// `inferred`. This module names those words and tolerates a word this build has never heard of.
//
// THE WORDS SAY WHAT THE BROKER RECORDED (delegation visibility, spec §4). The wire's `live` means only that an entry's
// session is live in the run that started it: nothing measures the helper itself. So no word here says "running", and
// none claims recency. Each liveness has a short visible word and a title (`LIVENESS_QUALIFIER`); a count of entries
// keeps the noun "delegated", which claims no execution.
//
// THE OPERATOR'S WORD IS "worktree". The wire's lease is never called that on the page.
//
// D-6999: a rung-4 (`raw`) worktree rests on negative evidence (no other session's listing window overlapped the Bash
// call that made it), so it ALWAYS wears the "inferred" chip and a chip naming that call, wherever it is drawn, and
// nothing on the page acts on it. `inferredChip` keys on `sourceKind === 'raw'` as well as on `inferred`, so a raw row
// whose marker went missing still says so.
//
// Imports only `shared/api` and `lib/wire` (never `./fleetTree` or `./nestFleet`, which import from here: a cycle).
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

/** A delegation row's words. `nameAt` is the index of its one free-text part (a delegated agent's name, a worktree's
 *  admin record), the only part a narrow row may cut short; every other part, its condition word and its `from` part
 *  among them, is always drawn whole (D-7783: a phone shows no titles). `null` when the row has no such part. */
export interface WorkWords { readonly parts: readonly string[]; readonly title: string; readonly nameAt: number | null }

/** The two group headers of a card (rules 9 and 10 of `nestFleet`). */
export const GROUP_WORDS: Readonly<Record<'offline-coordinator' | 'unowned', { label: string; title: string }>> = {
  'offline-coordinator': {
    label: 'Offline coordinator',
    title: 'work whose session is no longer the one that started it, or is not on this card',
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

/** What the broker RECORDED about an entry, never a claim that a helper is executing (delegation visibility, spec §4).
 *  The visible word is short for a 360 px row; the title adds the sentence, but is never the only carrier, because a
 *  phone shows no titles. Keyed by `DelegationLiveness`, so the totality rows (W4-U10, VIS-W1) cover it. */
export const LIVENESS_QUALIFIER: Readonly<Record<DelegationLiveness, { readonly word: string; readonly title: string }>> = {
  live: {
    word: 'not confirmed',
    title: 'Execution not confirmed: its session is live in the run that started it, but nothing shows the helper itself is still working',
  },
  stale: {
    word: 'stop not seen',
    title: "Its session is gone, dead or has restarted since, and the helper's stop was never recorded",
  },
  asleep: {
    word: 'session asleep',
    title: 'Its session is asleep and wakes for mail or when opened; nothing shows whether the helper stopped',
  },
  ended: { word: 'end recorded', title: 'The broker recorded its end; the worktree is still listed' },
  unmeasured: {
    word: 'unmeasured',
    title: "Its execution state, or whether its session is still there, could not be measured",
  },
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

/** The session header's description of its entry list (spec §5). */
export const ENTRIES_NOTE = 'Recorded entries, not a current agent count. Execution is not confirmed for any of them.';

/** The fleet foot's region: entries whose session the fleet list no longer carries (spec §5). */
export const UNLISTED_WORDS = {
  label: 'Delegated work, session not listed',
  title: 'recorded delegation entries whose session is not in the fleet list; not a current agent count, and execution is not confirmed',
} as const;

/** The region's toggle: its label and its count. */
export function unlistedToggle(n: number): string {
  return `${UNLISTED_WORDS.label} (${n})`;
}

/** The session an entry came from, on a row that is not under that session (an offline-group row, an unlisted row):
 *  its listed label, or its raw id when the fleet does not carry it. Display only: never a join key, never an
 *  ownership claim (spec §5). */
export function fromPart(label: string): string {
  return `from ${label}`;
}

/** A table's word for `key`, or the unrecognised word when the table has none (a newer server's word). */
const wordOf = (table: Readonly<Record<string, string>>, key: string): string =>
  Object.hasOwn(table, key) ? table[key]! : UNRECOGNISED_WORD;

/** A liveness's qualifier. A word this build cannot name reads `unmeasured`, as `readDelegation` re-files it: never live. */
const qualifierOf = (l: string): { readonly word: string; readonly title: string } =>
  Object.hasOwn(LIVENESS_QUALIFIER, l) ? LIVENESS_QUALIFIER[l as DelegationLiveness] : LIVENESS_QUALIFIER.unmeasured;

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
 * word renders with the `unrecognised` word. Never dropped, never drawn as live. (A member that is not an object at
 * all carries nothing to draw and no key, and is the one thing left out.)
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
 *  `sourceProject` is `workingOnCard`'s answer for the row's own project, handed back for the caller's folder icon;
 *  `fromLabel` names the session it came from, on a row that is not under that session. An ended worktree reads
 *  `end recorded`, and its workspace word alone says whether its presence was measured. */
export function worktreeLine(
  l: DelegationLeaseWire, viaLabel: string | null, sourceProject: string | null, fromLabel: string | null = null,
): WorkWords & { sourceProject: string | null } {
  const q = qualifierOf(l.liveness);
  const parts = [wordOf(WORKTREE_WORD, l.sourceKind), l.adminRecord, q.word];
  if (viaLabel !== null) parts.push(`via ${viaLabel}`);
  const ws = Object.hasOwn(WORKSPACE_WORD, l.workspace) ? WORKSPACE_WORD[l.workspace] : UNRECOGNISED_WORD;
  if (ws !== null) parts.push(ws);
  if (fromLabel !== null) parts.push(fromPart(fromLabel));
  return { parts, title: `${l.canonicalPath}; ${q.title}`, nameAt: 1, sourceProject };
}

/** A delegated agent's or workflow's row. Its times are the hook events the broker recorded, never helper activity. */
export function activityLine(a: DelegationActivityWire, fromLabel: string | null = null): WorkWords {
  const word = wordOf(ACTIVITY_WORD, a.sourceKind);
  const q = qualifierOf(a.liveness);
  const name = a.displayName !== null && a.displayName !== '' ? [a.displayName] : [];
  const parts = [word, ...name, q.word, ...(fromLabel === null ? [] : [fromPart(fromLabel)])];
  return {
    parts, nameAt: name.length > 0 ? 1 : null,
    title: `${word} ${a.upstreamId}: ${q.title}; opened ${a.openedAt}, last recorded hook event ${a.lastEventAt}`,
  };
}

/** An unowned tree's row. */
export function unownedLine(u: DelegationUnownedWire): WorkWords {
  const parts = [u.adminRecord, wordOf(VERDICT_WORD, u.verdict)];
  const ws = Object.hasOwn(WORKSPACE_WORD, u.workspace) ? WORKSPACE_WORD[u.workspace] : UNRECOGNISED_WORD;
  if (ws !== null) parts.push(ws);
  return { parts, title: `${u.canonicalPath ?? u.adminRecord}: ${u.reason}`, nameAt: 0 };
}

/** A sort key read from a member as it arrived: `readDelegation` keeps a member's other fields as they came, so one
 *  with no string here sorts first rather than throwing (review 1424 f). */
const sortKey = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Entries in the order they opened, then by id: the one order of every list of them (`nestFleet`'s rows, the
 *  fleet foot's region, the session header's list). A malformed member sorts first and never throws. */
export const byOpened = (a: DelegationActivityWire, b: DelegationActivityWire): number =>
  sortKey(a.openedAt).localeCompare(sortKey(b.openedAt)) || sortKey(a.activityId).localeCompare(sortKey(b.activityId));

/** One line of the session header's entry list, in an activity row's words. */
export interface EntryRow extends WorkWords { readonly key: string }

/** A session's recorded entries: the chip (`N delegated`), their count, the header's description and its list. */
export interface DelegatedSummary extends Chip {
  readonly count: number;
  readonly note: string;
  readonly rows: readonly EntryRow[];
}

/** D-7781: the chip counts EVERY entry it is handed, of every liveness. The card hands it a row's attached entries,
 *  and the header every entry the session started, so the count is of recorded entries, never of running helpers.
 *  `null` when handed none. */
export function delegatedChip(activities: readonly DelegationActivityWire[]): DelegatedSummary | null {
  if (activities.length === 0) return null;
  const n = activities.length;
  const rows = [...activities].sort(byOpened).map((a): EntryRow => ({ key: a.activityId, ...activityLine(a) }));
  return {
    text: `${n} delegated`,
    title: `${n} recorded delegation ${n === 1 ? 'entry' : 'entries'}, not a current agent count; execution not confirmed`,
    count: n, note: ENTRIES_NOTE, rows,
  };
}

/** Every entry a session started, whatever its placement or liveness: the session header lists them all. */
export function activitiesStartedBy(id: string, w: DelegationProjectionWire): readonly DelegationActivityWire[] {
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
