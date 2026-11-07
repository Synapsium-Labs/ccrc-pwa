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
// nothing acts on it automatically: only the operator's own tap (wave 5's "Attach to…", below) does. `inferredChip`
// keys on `sourceKind === 'raw'` as well as on `inferred`, so a raw row whose marker went missing still says so.
//
// Imports only `shared/api` and `lib/wire` (never `./fleetTree` or `./nestFleet`, which import from here: a cycle).
import {
  DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS, delegationLeaseDispositionOf,
  delegationLeaseExpiresAtOf, isArchivedRow, type DelegationActivityWire, type DelegationCarrierState, type LeaseDoorRefusal,
  type SessionBucket, type DelegationLeaseSourceKind, type DelegationLeaseWire, type DelegationLiveness,
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

// THE WORKTREE CONTROLS (delegation broker wave 5, PR10). The operator keeps a worktree, attaches an inferred one to its own
// session, or says one is not delegated work; each row reads its disposition and the date it is kept until. O5-6 (a)
// (D-7845): these words keep W4-U10's census closed, so none says lease, adopt, retain, clean or spool, and none says
// running; a refusal is said in these words too, never as the server's own text (D-8097). O5-8 (c) (D-7847): there are no
// tree doors, so an unowned row acts only through the lease the projection hid on its tree, and one with none offers
// nothing. A row from an older server (no `disposition`, no `leaseId`) offers nothing and says nothing new. No control
// implies the work is live or done; promotion is a run open, never a control here.

/** The operator's keep (`POST /api/leases/:lease/operator-retain`). */
export const KEEP_WORD = 'Keep worktree';
/** The operator's attach (`POST /api/leases/:lease/resolve`, `{action: 'attach'}`): the confirm names the one choice. */
export const ATTACH_WORD = 'Attach to…';
/** The operator's "not delegation's" (`POST /api/leases/:lease/resolve`, `{action: 'foreign'}`): it asks first. */
export const NOT_DELEGATED_WORD = 'Not delegated';

/** A worktree's disposition, as the row says it; `ephemeral` says nothing. Keyed by every carrier state but `released`
 *  (an unreleased worktree is never `released`), so W5-U3 holds it total. */
export const DISPOSITION_WORD: Readonly<Record<Exclude<DelegationCarrierState, 'released'>, string | null>> = {
  ephemeral: null, adopted: 'worktree kept', retained: 'worktree kept', transferring: 'moving to a run', promoted: 'moved to a run',
};

/** One control a row offers. Attach carries its one choice, the worktree's own session, so no attach can be drawn
 *  without a session to post (F10: no runtime guard stands in for the type). */
export type WorktreeControl =
  | { readonly act: 'keep' }
  | { readonly act: 'attach'; readonly parent: string; readonly parentLabel: string }
  | { readonly act: 'foreign' };
export type WorktreeAct = WorktreeControl['act'];

/** `disposition`'s reader on this page: the wire's one reader (`delegationLeaseDispositionOf`), so absence and a word this
 *  build cannot name both read null, and a null offers no control. Unlike a liveness or a group, an unknown disposition
 *  is not drawn as `unrecognised`: it says nothing and offers nothing, the side that acts on nothing it cannot name. */
export function dispositionOf(l: DelegationLeaseWire): keyof typeof DISPOSITION_WORD | null {
  return delegationLeaseDispositionOf(l);
}
/** `expiresAt`'s reader on this page: the wire's one reader (`delegationLeaseExpiresAtOf`); absent or null, no hold known. */
export function expiryOf(l: DelegationLeaseWire): string | null {
  return delegationLeaseExpiresAtOf(l);
}
/** `leaseId`'s one reader: the lease the projection hid for a conflict on an unowned row's tree, or null when it hid none,
 *  the row came from an older server, or the member is not a non-empty string. */
export function hiddenLeaseOf(u: DelegationUnownedWire): string | null {
  const id: unknown = u.leaseId;
  return typeof id === 'string' && id !== '' ? id : null;
}
/** The lease's OWN parent, the only attach choice (re-parenting is never offered). Under R9 the row's `parentId` is the
 *  display parent, the coordinator, and `via` is the worker whose lease it is. */
export function leaseParentOf(l: DelegationLeaseWire): string {
  return l.via ?? l.parentId;
}
/** F4: a session the PWA lists as live: present in the fleet list and not an archived row (`isArchivedRow`, the one
 *  reader of "archived", C7j). A session the list does not carry is not live here, so no attach to it is offered (the
 *  door would refuse `not-live-parent`). Legitimately different from `presenceOf` (presence.ts), which a door that acts
 *  on the live pane follows: Attach acts on a lease record, not on a pane, and the door refuses `not-live-parent` only
 *  when the session's registry row is absent, so a listed session that is dead or asleep is still a valid parent, and
 *  hiding Attach for it would hide an act the door accepts (review 1623 F5). */
export function listedLive(s: { readonly bucket: SessionBucket } | null | undefined): boolean {
  return s !== null && s !== undefined && !isArchivedRow(s);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** The UTC day and month a worktree is kept until, with the year only when it is not `now`'s year. Never "expires": the
 *  date is when the worktree stops being held back from the disk sweep, not when it is removed. */
const dateWord = (expiresAt: string, now: number): string | null => {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const year = d.getUTCFullYear() === new Date(now).getUTCFullYear() ? '' : ` ${d.getUTCFullYear()}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
};
/** 'kept until 17 Nov'. */
export function keptUntilWord(expiresAt: string, now: number): string {
  const d = dateWord(expiresAt, now);
  return d === null ? 'kept, until a date that could not be read' : `kept until ${d}`;
}
/** The note after a keep the server accepted, from its answer's `expiresAt`. */
export function keptWord(expiresAt: string | null, now: number): string {
  const d = expiresAt === null ? null : dateWord(expiresAt, now);
  return d === null ? 'Worktree kept' : `Worktree kept until ${d}`;
}

/** The words a worktree row adds after its own: its disposition, said once with the date while it is held ("worktree kept
 *  until 14 Nov", F9 (g)). An older server's row (no `disposition`) adds none, and so renders as before. */
export function worktreeStateParts(l: DelegationLeaseWire, now: number): readonly string[] {
  const d = dispositionOf(l);
  if (d === null) return [];
  const exp = expiryOf(l);
  const word = DISPOSITION_WORD[d];
  if (word === null) return [];
  return [(d === 'adopted' || d === 'retained') && exp !== null ? `worktree ${keptUntilWord(exp, now)}` : word];
}

/** The controls a worktree row offers (PR10's rules): Keep while `ephemeral`, `adopted` or `retained`; Attach on an
 *  inferred (raw) worktree in those states, only while its own session is listed live (`liveParentLabel` non-null, F4);
 *  Not delegated on every state but `transferring`, which offers none for now (`[]`). Null without a disposition (an
 *  older server's row, or a word this build cannot name): that row has no controls at all, so it draws exactly as
 *  before. Keep stays on a raw worktree whose tree is in conflict and on a box without the hold: the wire says neither,
 *  so the door's refusal says it (F1, D-8097). */
export function worktreeControls(l: DelegationLeaseWire, liveParentLabel: string | null): readonly WorktreeControl[] | null {
  const d = dispositionOf(l);
  if (d === null) return null;
  if (d === 'transferring') return [];
  const held = d === 'ephemeral' || d === 'adopted' || d === 'retained';
  const attach: readonly WorktreeControl[] = held && l.sourceKind === 'raw' && liveParentLabel !== null
    ? [{ act: 'attach', parent: leaseParentOf(l), parentLabel: liveParentLabel }] : [];
  return [...(held ? [{ act: 'keep' } as const] : []), ...attach, { act: 'foreign' }];
}
/** An unowned row's controls: only through the lease the projection hid on its tree (O5-8 (c)), and only Not delegated
 *  (D-8095: the wire names no parent for that lease). Null when it hid none. */
export function unownedControls(u: DelegationUnownedWire): { readonly leaseId: string; readonly controls: readonly WorktreeControl[] } | null {
  const leaseId = hiddenLeaseOf(u);
  return leaseId === null ? null : { leaseId, controls: [{ act: 'foreign' }] };
}

/** Whether `controls` still offers the asked control: the same act and, for an attach, the same session (F4 of review
 *  1623), so an ask whose act or parent the row no longer offers never posts. */
export function offersControl(controls: readonly WorktreeControl[], asked: WorktreeControl): boolean {
  return controls.some((c) => c.act === asked.act && (c.act !== 'attach' || (asked.act === 'attach' && c.parent === asked.parent)));
}
/** What a row offers, as one value to compare: the worktree's state on the wire (none for an unowned row) and each control,
 *  an attach with its session. A refusal is about the act it answered, so the row clears its sentence when this changes
 *  (review 1624 F5): a row whose controls go and come back, or whose state moves, no longer says the old refusal. */
export function offerOf(controls: readonly WorktreeControl[], l: DelegationLeaseWire | null = null): string {
  return [l === null ? '' : dispositionOf(l) ?? '', ...controls.map((c) => (c.act === 'attach' ? `attach ${c.parent}` : c.act))].join(' ');
}

/** Each control's label. */
export const ACT_WORD: Readonly<Record<WorktreeAct, string>> = { keep: KEEP_WORD, attach: ATTACH_WORD, foreign: NOT_DELEGATED_WORD };
/** A control's accessible name: its label and the row's worktree, so two rows' controls never share a name (F9 (f)). */
export function controlName(act: WorktreeAct, worktree: string): string {
  return `${ACT_WORD[act]} (${worktree})`;
}
/** The name of a row's group of controls: the row's worktree (F8 (d)). */
export function controlsName(worktree: string): string {
  return `Worktree ${worktree}`;
}
/** Each act as a verb, for the app's "Couldn't <verb> — <why>" when a request gets no door's answer (`failedTo`). */
export const ACT_VERB: Readonly<Record<WorktreeAct, string>> = {
  keep: 'keep the worktree', attach: 'attach the worktree', foreign: 'mark the worktree not delegated',
};
/** The note after a door accepted the act, with the date the worktree is kept until when the answer gives one. The row
 *  itself changes when the next frame carries it. */
export function actDoneWord(c: WorktreeControl, expiresAt: string | null, now: number): string {
  if (c.act === 'keep') return keptWord(expiresAt, now);
  if (c.act === 'foreign') return 'Worktree marked not delegated';
  const d = expiresAt === null ? null : dateWord(expiresAt, now);
  return d === null ? `Worktree attached to ${c.parentLabel}` : `Worktree attached to ${c.parentLabel}, kept until ${d}`;
}
/** A 2xx whose body could not be read: the act was accepted, and what it did shows with the next frame. */
export const ANSWER_UNREAD_WORD = 'The server accepted this, but its answer could not be read; the row updates with its next change.';

/** D-8097 (F5): each door refusal in the operator's words (worktree, session, run, kept), never the server's own text,
 *  which names the broker's internals. Keyed by the L0 type (`LEASE_DOOR_REFUSALS`), so a new refusal is a compile error
 *  here until it has a sentence. */
export const REFUSAL_WORD: Readonly<Record<LeaseDoorRefusal, string>> = {
  'lease-unknown': 'The server has no record of this worktree.',
  'lease-released': 'This worktree is no longer held: it was removed, moved to a run or marked not delegated.',
  'not-lease-parent': 'A worktree can only be attached to its own session.',
  'wrong-disposition': "This worktree's state does not allow that now.",
  'not-ready': 'The server is still reading its records. Try again shortly.',
  'incarnation-changed': 'The session restarted while this was done. Check the row before you try again.',
  'registry-unmeasurable': 'The list of sessions could not be read just now. Try again shortly.',
  'not-live-parent': "This worktree's session is not live, so it cannot be attached to it.",
  'tree-not-unowned': 'This worktree is not unowned work.',
  'bad-request': 'The server could not read this request.',
  'lease-conflicting': 'Two sessions claimed this worktree, so it cannot be kept until that is settled.',
  'carrier-behind': 'The fleet box has not caught up with this worktree yet. Try again shortly.',
  'box-unsupported': 'The fleet box cannot hold this worktree back from the disk sweep until its ccrc is updated.',
  'tree-unleased': 'No delegated work is recorded on this worktree.',
};
/** A refusal word this build does not know: one plain sentence, never the word or the server's detail. */
export const REFUSED_WORD = 'The server refused this.';
/** A refusal's sentence. */
export function refusalWord(error: unknown): string {
  return typeof error === 'string' && Object.hasOwn(REFUSAL_WORD, error) ? REFUSAL_WORD[error as LeaseDoorRefusal] : REFUSED_WORD;
}

/** A confirm's words. */
export interface ConfirmWords { readonly title: string; readonly consequence: string; readonly confirmLabel: string }
/** Attach asks first and names its one choice, the worktree's own session. It names no date: the server sets it. */
export function attachConfirm(parentLabel: string): ConfirmWords {
  return {
    title: `Attach this worktree to ${parentLabel}?`,
    consequence: `It is then kept for ${parentLabel}, and held back from the disk sweep. It is never moved to another session.`,
    confirmLabel: `Attach to ${parentLabel}`,
  };
}
/** Not delegated asks first: it is final for the worktree. */
export const notDelegatedConfirm: ConfirmWords = {
  title: 'Not delegated work?',
  consequence: 'This worktree is not delegated work. It will no longer be shown here, and it is not held back from the disk sweep.',
  confirmLabel: NOT_DELEGATED_WORD,
};
/** The confirm for a control (Keep asks nothing). */
export function confirmFor(c: WorktreeControl): ConfirmWords | null {
  return c.act === 'attach' ? attachConfirm(c.parentLabel) : c.act === 'foreign' ? notDelegatedConfirm : null;
}
