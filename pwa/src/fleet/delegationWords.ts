// THE DELEGATION WORDS (delegation broker wave 4, spec §5.8; D-6999, D-7002; delegation visibility). L1:
// one module for every label a worktree row, its controls and the Archive's section draw, so no component spells one.
// The server decides every word on the wire (`server/src/coord/delegation-projection.ts`): liveness, the group, an
// activity's placement, and which worktree is `inferred`. This module reads those words and tolerates a word this build
// has never heard of.
//
// NO PAGE SAYS A LIVENESS (session helpers H3, D-8875; spec 2026-11-19 §4.4). The wire's `live` means only that an entry's
// session is live in the run that started it: nothing measures the helper itself, so its words are not a fact the operator
// can act on. The fleet list draws no delegation row (D-8782), the session panel no recorded entry and no count of them
// (its Helpers section is the one list), and a worktree row says its path, its disposition and its controls. So no word
// here says "running" or claims recency, and `LIVENESS_QUALIFIER` is what the words WOULD say, kept as the census's list
// of what no page may draw.
//
// THE OPERATOR'S WORD IS "worktree". The wire's lease is never called that on the page.
//
// D-6999: a rung-4 (`raw`) worktree rests on negative evidence (no other session's listing window overlapped the Bash
// call that made it), so it ALWAYS wears the "inferred" chip and a chip naming that call, wherever it is drawn, and
// nothing acts on it automatically: only the operator's own tap (wave 5's "Attach to…", below) does. `inferredChip`
// keys on `sourceKind === 'raw'` as well as on `inferred`, so a raw row whose marker went missing still says so.
//
// Imports only `shared/api`, `lib/wire` and the design system's elapsed ladder (never `./fleetTree` or `./nestFleet`, which
// import from here: a cycle).
import {
  DELEGATION_ACTIVITY_PLACEMENTS, DELEGATION_LIVENESS, DELEGATION_ROW_GROUPS, delegationLeaseDispositionOf,
  delegationLeaseExpiresAtOf, inArchivedFold, isArchivedRow, type DelegationActivityWire, type DelegationCarrierState, type LeaseDoorRefusal,
  type SessionBucket, type DelegationLeaseSourceKind, type DelegationLeaseWire, type DelegationLiveness,
  type DelegationProjectionWire, type DelegationUnownedWire, type FleetSession,
} from '../../../shared/api';
import { elapsedShort } from '@ccrc/ui';
import { isRecord } from '../lib/wire';

/** The chip every raw worktree wears (D-6999). */
export const INFERRED_WORD = 'inferred';
/** The word for a value this build cannot name: drawn, never dropped and never read as a known word. */
export const UNRECOGNISED_WORD = 'unrecognised';

export interface Chip { readonly text: string; readonly title: string }

/** A worktree row's words. `nameAt` is the index of its one free-text part, its path (`null` when the row has none). Every
 *  part is drawn whole (D-7783: a phone shows no titles), the path too since H3 (D-8875): it wraps, at the break points
 *  `pathBreaks` names, and below the desk on a line of its own (session helpers HF2, D-8877; review 3123 F3 and F8). */
export interface WorkWords { readonly parts: readonly string[]; readonly title: string; readonly nameAt: number | null }

/** A path cut after each `/`: the row draws each piece as a box of its own, so it breaks between pieces, after a `/`, and inside
 *  one only when it is wider than its line (review 3123 F3: a hyphen inside a segment is a break a browser takes first when the
 *  line is filled greedily, so a `<wbr>` alone was not enough, measured). The pieces joined are the path, character for
 *  character. */
export function pathBreaks(path: string): readonly string[] {
  return path.split(/(?<=\/)/).filter((p) => p !== '');
}

export const WORKTREE_WORD: Readonly<Record<DelegationLeaseSourceKind, string>> = {
  agent: 'agent worktree',
  workflow: 'workflow worktree',
  raw: 'worktree',
  attached: 'attached worktree',
};

/** What the broker RECORDED about an entry, as delegation visibility (spec §4) worded it: a short word and its sentence.
 *  Since H3 (D-8875) no page draws either: the session panel's word census (`session-panel-sheds.test.tsx`) and the real
 *  browser's (`delegation-rows.browser.test.ts`) read this table as the words and sentences that must not appear. Keyed by
 *  `DelegationLiveness`, so the totality rows (W4-U10, VIS-W1) cover it and a new liveness joins the census. */
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

/** A table's word for `key`, or the unrecognised word when the table has none (a newer server's word). */
const wordOf = (table: Readonly<Record<string, string>>, key: string): string =>
  Object.hasOwn(table, key) ? table[key]! : UNRECOGNISED_WORD;

const groupOf = (g: unknown): DelegationActivityWire['group'] =>
  (DELEGATION_ROW_GROUPS as readonly unknown[]).includes(g) ? g as DelegationActivityWire['group'] : 'offline-coordinator';
const placementOf = (p: unknown): DelegationActivityWire['placement'] =>
  (DELEGATION_ACTIVITY_PLACEMENTS as readonly unknown[]).includes(p) ? p as DelegationActivityWire['placement'] : 'row';
const livenessOf = (l: unknown): DelegationLiveness =>
  (DELEGATION_LIVENESS as readonly unknown[]).includes(l) ? l as DelegationLiveness : 'unmeasured';
/** Only `present` is a measured presence; anything else (`unmeasured`, a newer server's word) is not measured. */
const workspaceOf = (w: unknown): DelegationLeaseWire['workspace'] => (w === 'present' ? 'present' : 'unmeasured');
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

/** A worktree's row (session helpers H3, D-8875; spec §4.4): what made it, its path and, on a coordinator's page, the worker
 *  whose worktree it is; the caller adds its disposition (`worktreeStateParts`) and its controls. No liveness word and no
 *  presence word: the presence on disk not measured is said once, in the section's head (`presenceWord`). `viaLabel` is the
 *  worker the server's R9 names (already resolved to a label by the caller); `sourceProject` is `workingOnCard`'s answer for
 *  the row's own project, handed back for the caller's folder icon. The path is the row's one free-text part, its title. */
export function worktreeLine(
  l: DelegationLeaseWire, viaLabel: string | null, sourceProject: string | null,
): WorkWords & { sourceProject: string | null } {
  const parts = [wordOf(WORKTREE_WORD, l.sourceKind), l.canonicalPath];
  if (viaLabel !== null) parts.push(`via ${viaLabel}`);
  return { parts, title: l.canonicalPath, nameAt: 1, sourceProject };
}

/** Every worktree a session holds, whatever its liveness or group: the session's own details list them (D-8782: the fleet
 *  list draws no worktree row). The ONE reader of the frame for leases. A lease is the
 *  session's when it is the display parent (`parentId`, the coordinator under R9) or the worker whose lease it is (`via`);
 *  an offline coordinator's leases are the ones its own page lists. So a lease shows on its coordinator's page AND on its
 *  worker's, where the fleet list had drawn one row (an activity is its parent's only). `workdirs` are the listed sessions'
 *  working directories: a lease whose path is one of them is not drawn, that session's own row being the honest one (the old
 *  rule 7, W4-U14). A re-check beside the server's own precedence, legitimately different: the `fleet` and `delegation`
 *  frames arrive separately, so the session can be listed before the next frame drops the lease. In `firstObservedAt` order. */
export function leasesStartedBy(
  id: string, w: DelegationProjectionWire, workdirs: ReadonlySet<string> = NO_WORKDIRS,
): readonly DelegationLeaseWire[] {
  return w.leases.filter((l) => (l.parentId === id || l.via === id) && !atASessionWorkdir(l, workdirs))
    .sort((a, b) => a.firstObservedAt.localeCompare(b.firstObservedAt) || a.leaseId.localeCompare(b.leaseId));
}

const NO_WORKDIRS: ReadonlySet<string> = new Set();

/** The old rule 7 (W4-U14), the one reader of it: a lease whose path is a listed session's working directory is not drawn
 *  as a worktree, that session's own row being the honest one. `leasesStartedBy` (the session pages) and `unlistedLeases`
 *  (the Archive's section) both ask it, so the two cannot disagree about which leases exist. */
export function atASessionWorkdir(l: DelegationLeaseWire, workdirs: ReadonlySet<string>): boolean {
  return workdirs.has(l.canonicalPath);
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
/** Whether `controls` still offers the asked control: the same act and, for an attach, the same session (F4 of review
 *  1623), so an ask whose act or parent the row no longer offers never posts. */
export function offersControl(controls: readonly WorktreeControl[], asked: WorktreeControl): boolean {
  return controls.some((c) => c.act === asked.act && (c.act !== 'attach' || (asked.act === 'attach' && c.parent === asked.parent)));
}
/** What a row offers, as one value to compare: the record its controls act on, the worktree's state on the wire (none for
 *  an unowned row) and each control, an attach with its session. A refusal is about the act it answered, so the row clears
 *  its sentence when this changes (review 1624 F5): a row whose record is replaced (review 1626 F4), whose controls go and
 *  come back, or whose state moves, no longer says the old refusal. */
export function offerOf(leaseId: string, controls: readonly WorktreeControl[], l: DelegationLeaseWire | null = null): string {
  return [leaseId, l === null ? '' : dispositionOf(l) ?? '', ...controls.map((c) => (c.act === 'attach' ? `attach ${c.parent}` : c.act))].join(' ');
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
 *  itself changes when the next frame carries it. `expiresAt` is the answer's field as it came (`readDoorAnswer` hands it
 *  on unread), read here by the wire's one reader, which checks its type: only a string is a date, and absence or null
 *  is no date known (review 1623 F8 (a), review 1624 F7). */
export function actDoneWord(c: WorktreeControl, expiresAt: unknown, now: number): string {
  const at = delegationLeaseExpiresAtOf({ expiresAt: expiresAt as string | null });
  if (c.act === 'keep') return keptWord(at, now);
  if (c.act === 'foreign') return 'Worktree marked not delegated';
  const d = at === null ? null : dateWord(at, now);
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

// THE ARCHIVE'S SECTION, "Work no session owns" (session helpers design 2026-11-19 §6 and Table 8; desktop polish H4, D-8828).
// C48 took unowned trees and the leases of two unlisted sessions off the fleet list and gave them no home; the Archive screen
// is that home. One pure read of the frame builds both kinds of row, so the section draws what this says and decides nothing.
// The rows carry no liveness word and no bare `unmeasured` (§4.4): where presence on disk was not measured, `presenceWord`
// says it once, in the section's head. An unowned tree acts only through the lease the projection hid on it, and only by
// Not delegated (D-8095: the unowned wire names no parent and no disposition, so Attach and Keep wait for those fields).

/** An unowned tree's verdict, as its row says it. */
export const VERDICT_WORD: Readonly<Record<DelegationUnownedWire['verdict'], string>> = {
  unresolved: 'no owner found',
  conflicting: 'two owners claimed it',
};

/** `leaseId`'s one reader: the lease the projection hid for a conflict on an unowned row's tree, or null when it hid none,
 *  the row came from an older server, or the member is not a non-empty string. */
export function hiddenLeaseOf(u: DelegationUnownedWire): string | null {
  const id: unknown = u.leaseId;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** An unowned row's controls: only through the lease the projection hid on its tree, and only Not delegated (the wire names
 *  no parent and no disposition for that lease). Null when it hid none. */
export function unownedControls(u: DelegationUnownedWire): { readonly leaseId: string; readonly controls: readonly WorktreeControl[] } | null {
  const leaseId = hiddenLeaseOf(u);
  return leaseId === null ? null : { leaseId, controls: [{ act: 'foreign' }] };
}

/** The session fields "listed" reads: the fleet list's own fold (`inArchivedFold`) and the working directory. */
export type ListedSession = Pick<FleetSession, 'id' | 'bucket' | 'workspace' | 'status' | 'stoppedBy' | 'hibernatedAt' | 'workdir'>;

/** Whether the fleet list carries a session as a row of its live part: not in the Archived fold, by the fold's own
 *  predicate (`inArchivedFold`, never a copy of it). So a cleanup session, which the fleet list keeps at its top level, is
 *  listed; an archived workspace and a stopped main checkout, which it folds, are unlisted (an archived session is unlisted,
 *  not gone). Legitimately different from `listedLive`, which answers whether Attach may offer a session (the door refuses
 *  only a session whose registry row is absent). */
export function listedOnFleet(s: Pick<ListedSession, 'bucket' | 'workspace' | 'status' | 'stoppedBy' | 'hibernatedAt'> | null | undefined): boolean {
  return s !== null && s !== undefined && !inArchivedFold(s);
}

/** The leases whose parent AND worker are both unlisted (`listedOnFleet`), drawn nowhere else: either side listed gives the
 *  lease a session page (`leasesStartedBy`), and a lease at a listed session's working directory is that session's own row
 *  (`atASessionWorkdir`, the same rule the session pages apply). In `firstObservedAt` order. */
export function unlistedLeases(w: DelegationProjectionWire, sessions: readonly ListedSession[]): readonly DelegationLeaseWire[] {
  const listed = new Set(sessions.filter((s) => listedOnFleet(s)).map((s) => s.id));
  const workdirs = new Set(sessions.map((s) => s.workdir));
  return w.leases.filter((l) => !listed.has(l.parentId) && (l.via === null || !listed.has(l.via)) && !atASessionWorkdir(l, workdirs))
    .sort((a, b) => a.firstObservedAt.localeCompare(b.firstObservedAt) || a.leaseId.localeCompare(b.leaseId));
}

/** The section's own words, one place (L1) for the title, the note under it and the two subheads. The note says what the
 *  section holds in the subhead's words: an archived session is unlisted, not gone (review 2966 F1). */
export const UNOWNED_WORDS = {
  title: 'Work no session owns',
  purpose: 'Delegated worktrees the broker could not give one owner, and worktrees neither of whose sessions is listed.',
  trees: 'No single owner',
  leases: 'Neither session listed',
} as const;

/** How many of these trees' presence on disk the wire did not measure: only `present` is a measured presence (`workspaceOf`),
 *  so a newer server's word counts as not measured too. The ONE count the session's worktrees head and the Archive's section
 *  both say (session helpers HF2, D-8877; review 3123 F14). */
export function presenceUnmeasured(trees: readonly { readonly workspace: unknown }[]): number {
  return trees.filter((t) => t.workspace !== 'present').length;
}

/** The head's one sentence for trees whose presence on disk the wire did not measure; null for none. */
export function presenceWord(n: number): string | null {
  return n <= 0 ? null : `presence on disk not measured for ${n} tree${n === 1 ? '' : 's'}`;
}

/** An attempt's age, on the shared coarse ladder (`elapsedShort`) in whole words: `tried 3 days ago`, `tried just now`
 *  under a minute; null for a time that cannot be read, which is left out of the row, never guessed. */
export function triedWord(attemptedAt: string, now: number): string | null {
  const at = Date.parse(attemptedAt);
  if (Number.isNaN(at)) return null;
  const short = elapsedShort(now - at);
  if (short === null) return 'tried just now';
  const n = Number(short.slice(0, -1));
  const unit = { m: 'minute', h: 'hour', d: 'day' }[short.slice(-1) as 'm' | 'h' | 'd'];
  return `tried ${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** An unowned tree's row: where it is (its path, else its admin record), its verdict and age, and its one act. */
export interface UnownedTreeRow {
  readonly key: string;
  readonly project: string;
  readonly where: string;
  /** The admin record: the control's accessible name, the worktree the act is about. */
  readonly worktree: string;
  /** The row's one line of words: the verdict, then the attempt's age when its time could be read. */
  readonly meta: readonly string[];
  readonly act: { readonly leaseId: string; readonly controls: readonly WorktreeControl[] } | null;
}
/** A worktree row whose two sessions are both unlisted: its path, its disposition and its controls (never Attach: it needs
 *  a listed parent, which these rows do not have). */
export interface UnlistedLeaseRow {
  readonly key: string;
  readonly lease: DelegationLeaseWire;
  readonly project: string;
  readonly where: string;
  readonly worktree: string;
  readonly state: readonly string[];
  readonly controls: readonly WorktreeControl[] | null;
}
export interface UnownedWork {
  readonly trees: readonly UnownedTreeRow[];
  readonly leases: readonly UnlistedLeaseRow[];
  /** Rows of both kinds, and how many of their trees' presence on disk was not measured (the head says it once). */
  readonly total: number;
  readonly unmeasured: number;
}

const attemptTime = (u: DelegationUnownedWire): number => {
  const t = Date.parse(u.attemptedAt);
  return Number.isNaN(t) ? -Infinity : t;
};

/** What the Archive's section draws, from the frame as it arrived (`readDelegation` re-files an unknown word) and the fleet's
 *  sessions. An unavailable frame (null) holds no unowned work to draw. Unowned trees newest attempt first. */
export function unownedWork(
  frame: DelegationProjectionWire | null, sessions: readonly ListedSession[], now: number,
): UnownedWork {
  if (frame === null) return { trees: [], leases: [], total: 0, unmeasured: 0 };
  const w = readDelegation(frame);
  const trees = w.unowned.slice().sort((a, b) => attemptTime(b) - attemptTime(a) || a.adminRecord.localeCompare(b.adminRecord))
    .map((u): UnownedTreeRow => ({
      key: `${u.project}\u0000${u.adminRecord}\u0000${u.attemptedAt}`,
      project: u.project,
      where: u.canonicalPath ?? u.adminRecord,
      worktree: u.adminRecord,
      meta: [wordOf(VERDICT_WORD, u.verdict), ...[triedWord(u.attemptedAt, now)].filter((t): t is string => t !== null)],
      act: unownedControls(u),
    }));
  const leases = unlistedLeases(w, sessions).map((l): UnlistedLeaseRow => ({
    key: l.leaseId, lease: l, project: l.project, where: l.canonicalPath, worktree: l.adminRecord,
    state: worktreeStateParts(l, now), controls: worktreeControls(l, null),
  }));
  const unmeasured = presenceUnmeasured(w.unowned) + presenceUnmeasured(leases.map((r) => r.lease));
  return { trees, leases, total: trees.length + leases.length, unmeasured };
}

/** How many rows the Archive's section would draw: what the fleet foot's Archived row asks. The clock only feeds the rows'
 *  words, never their number. */
export function unownedTotal(frame: DelegationProjectionWire | null, sessions: readonly ListedSession[]): number {
  return unownedWork(frame, sessions, 0).total;
}

/** The fleet foot's one Archived row (review 2966 F5): the same row and the same door (`/archive`) say what is there. The
 *  archived half is the words the row always had (`archived`, null for none); the unowned half is the section's own title
 *  and its count. Its halves, in order, joined by ` · ` on the row; none when there is nothing of either, and then no row.
 *  The row draws each half as one box, so a narrow row breaks between them and never leaves a word of one alone on a line
 *  (session helpers HF2, review 2988 F8). */
export function archiveDoorParts(archived: string | null, unowned: number): readonly string[] {
  return [archived, unowned > 0 ? `${UNOWNED_WORDS.title} · ${unowned}` : null].filter((p): p is string => p !== null);
}

