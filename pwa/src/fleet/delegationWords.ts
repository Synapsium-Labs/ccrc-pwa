// THE DELEGATION WORDS (delegation broker wave 4, spec §5.8; D-6999, D-7002; delegation visibility). L1: one module for
// every label the session header's entry list and the fleet foot's region draw, so no component spells one. The fleet list
// draws no delegation row at all: a session's activities, worktrees and unowned items are not rows of it (D-8782), and the
// worktree and unowned words went with those rows. The server decides every word on the wire
// (`server/src/coord/delegation-projection.ts`): liveness, the group, an activity's placement. This module names those words
// and tolerates a word this build has never heard of.
//
// THE WORDS SAY WHAT THE BROKER RECORDED (delegation visibility, spec §4). The wire's `live` means only that an entry's
// session is live in the run that started it: nothing measures the helper itself. So no word here says "running", and
// none claims recency. Each liveness has a short visible word and a title (`LIVENESS_QUALIFIER`); a count of entries
// keeps the noun "delegated", which claims no execution.
//
// Imports only `shared/api` and `lib/wire` (never `./fleetTree` or `./nestFleet`, which import from here: a cycle).
import {
  DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS, type DelegationActivityWire,
  type DelegationLiveness, type DelegationProjectionWire,
} from '../../../shared/api';
import { isRecord } from '../lib/wire';

/** The word for a value this build cannot name: drawn, never dropped and never read as a known word. */
export const UNRECOGNISED_WORD = 'unrecognised';

export interface Chip { readonly text: string; readonly title: string }

/** A delegation entry's words. `nameAt` is the index of its one free-text part (a delegated agent's name), the only part
 *  a narrow row may cut short; every other part, its condition word and its `from` part among them, is always drawn
 *  whole (D-7783: a phone shows no titles). `null` when the row has no such part. */
export interface WorkWords { readonly parts: readonly string[]; readonly title: string; readonly nameAt: number | null }

export const ACTIVITY_WORD: Readonly<Record<DelegationActivityWire['sourceKind'], string>> = {
  agent: 'agent',
  workflow: 'workflow',
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
/**
 * Member tolerance: a member carrying a word this build cannot name is KEPT. An unknown group is re-filed
 * `offline-coordinator`, an unknown placement `row`, an unknown liveness `unmeasured`; any other unknown
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
  return { ...w, activities };
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

/** A sort key read from a member as it arrived: `readDelegation` keeps a member's other fields as they came, so one
 *  with no string here sorts first rather than throwing (review 1424 f). */
const sortKey = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Entries in the order they opened, then by id: the one order of every list of them (`nestFleet`'s rows, the
 *  fleet foot's region, the session header's list). A malformed member sorts first and never throws. */
export const byOpened = (a: DelegationActivityWire, b: DelegationActivityWire): number =>
  sortKey(a.openedAt).localeCompare(sortKey(b.openedAt)) || sortKey(a.activityId).localeCompare(sortKey(b.activityId));

/** One line of the session header's entry list, in an activity row's words. */
export interface EntryRow extends WorkWords { readonly key: string }

/** A session's recorded entries: the header's disclosure (`N delegated`), its description and its list. */
export interface DelegatedSummary extends Chip {
  readonly note: string;
  readonly rows: readonly EntryRow[];
}

/** D-7781: the header's `N delegated` disclosure counts EVERY entry it is handed, of every liveness: the session header
 *  hands it every entry the session started, so the count is of recorded entries, never of running helpers. The fleet
 *  list's row draws no such count and no chip (D-8771). `null` when handed none. */
export function delegatedChip(activities: readonly DelegationActivityWire[]): DelegatedSummary | null {
  if (activities.length === 0) return null;
  const n = activities.length;
  const rows = [...activities].sort(byOpened).map((a): EntryRow => ({ key: a.activityId, ...activityLine(a) }));
  return {
    text: `${n} delegated`,
    title: `${n} recorded delegation ${n === 1 ? 'entry' : 'entries'}, not a current agent count; execution not confirmed`,
    note: ENTRIES_NOTE, rows,
  };
}

/** Every entry a session started, whatever its placement or liveness: the session header lists them all. */
export function activitiesStartedBy(id: string, w: DelegationProjectionWire): readonly DelegationActivityWire[] {
  return w.activities.filter((a) => a.parentId === id);
}
