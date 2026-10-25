// D-5855 (ARCH-70 (#805); consolidation spec 2026-10-19 K12, §2.3): the switchboard. Every operator switch is ONE
// row of `SWITCHES`: its storage (a `$REG` marker file, or a settings table and column), what its absence means, the
// spec's context that owns it, one operator sentence and the route or ccd verb that writes it ('hand-only' when
// nothing in the tree does). `readSwitches(listing)` is the one reader of the marker rows.
//
// L0: this file imports nothing outside `shared/`, and nothing that can write a file, so a marker spelled here alone
// still has no writer in the tree (`single-definition.test.ts` pins both). Each marker name is spelled ONCE, in its
// `*_MARKER` constant below; the modules that exported it before re-export it, so their callers are unchanged.
//
// Storage stays as it is: a marker file is what ccd and the session hook can read with the server down, a settings row
// carries the operator's audit trail. This table describes both and changes neither. ccd keeps reading its markers
// itself.
import type { MarkerState } from './api.js';

/** `$REG/mail-disabled`: the fleet's mail kill switch. Hand-only ("removable only by a human at a terminal"). */
export const MAIL_DISABLED_MARKER = 'mail-disabled';
/** `$REG/coordinator-paused`: the fleet-wide pause of coordination. Not `-disabled`-suffixed, because `limits.ts`
 *  reads `<name>-disabled` as a wrapper's lane switch. */
export const COORDINATOR_PAUSE_MARKER = 'coordinator-paused';
/** `$REG/reclaim-paused`: the fleet-wide pause of automatic reclamation. Written only by `ccd reclaim-pause`. */
export const RECLAIM_PAUSE_MARKER = 'reclaim-paused';
/** `$REG/asks-disabled`: the ask hold's kill switch. */
export const ASKS_DISABLED_MARKER = 'asks-disabled';
/** `$REG/stop-done-disabled`: the stop-done lane's kill switch. */
export const STOP_DONE_DISABLED_MARKER = 'stop-done-disabled';
/** `$REG/hibernate-disabled`: hibernation's kill switch; it wins over the live switch. */
export const HIBERNATE_DISABLED_MARKER = 'hibernate-disabled';
/** `$REG/hibernate-live`: arms hibernation's act. */
export const HIBERNATE_LIVE_MARKER = 'hibernate-live';
/** `$REG/expire-lane-live`: arms the expiry lane's act. */
export const EXPIRE_LANE_LIVE_MARKER = 'expire-lane-live';
/** `$REG/expire-child-live`: arms the expiry lane's child arm (an archived child, spec 2026-10-23 section 2.7.4). */
export const EXPIRE_CHILD_LIVE_MARKER = 'expire-child-live';
/** `$REG/stale-archive-live`: arms the stale-archive arm's act (D-6643). */
export const STALE_ARCHIVE_LIVE_MARKER = 'stale-archive-live';
/** `$REG/collect-lane-live`: the LEGACY arm of the collector's switch (Settings is the other arm). Kept: it still
 *  arms the lane while it stands and its latch is unset (spec K12). */
export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live';
/** `$REG/orphan-tree-live`: arms the orphan-worktree lane's act (fleet disk retention spec 2026-10-23 section 2.3). */
export const ORPHAN_TREE_LIVE_MARKER = 'orphan-tree-live';
/** `$REG/orphan-tree-rescue-live`: arms the lane's rescue arm, for a tree whose HEAD is on no remote; it means nothing
 *  unless `orphan-tree-live` also stands. */
export const ORPHAN_TREE_RESCUE_LIVE_MARKER = 'orphan-tree-rescue-live';
/** `$REG/collect-loose-live`: arms the collector's LOOSE arm (fleet disk retention spec 2026-10-23 section 2.4, D-6627):
 *  a loose `~/.cc-tmp` entry is removed only while it stands AND the lane itself is effectively live. No writer in the
 *  tree. */
export const COLLECT_LOOSE_LIVE_MARKER = 'collect-loose-live';
/** `$REG/nested-rescue-live`: arms rung 9's rescue of a nested repository (D-6632); the server only shows what the arm would do. */
export const NESTED_RESCUE_LIVE_MARKER = 'nested-rescue-live';
/** `$REG/dead-coordinator-lane-live`: arms the dead-coordinator lane's act. */
export const DEAD_COORDINATOR_LANE_LIVE_MARKER = 'dead-coordinator-lane-live';
/** `$REG/idle-compact-nudge-disabled`: the idle-compaction nudge's kill switch. */
export const IDLE_NUDGE_DISABLED_MARKER = 'idle-compact-nudge-disabled';
/** `$REG/mail-gate-strict`: the mail gate's pre-wave-1 rule. */
export const MAIL_GATE_STRICT_MARKER = 'mail-gate-strict';
/** `$REG/mail-gate-busy`: the mail gate's second hand-armed step. */
export const MAIL_GATE_BUSY_MARKER = 'mail-gate-busy';
/** `$REG/mail-gate-busy-shadow`: the mail gate's first hand-armed step. */
export const MAIL_GATE_BUSY_SHADOW_MARKER = 'mail-gate-busy-shadow';
/** `$REG/landing-disabled`: the PR-landing checks lane's kill switch; it wins over the live marker. */
export const LANDING_DISABLED_MARKER = 'landing-disabled';
/** `$REG/landing-checks-live`: arms NEW episodes of the checks lane live (otherwise they run in shadow). */
export const LANDING_CHECKS_LIVE_MARKER = 'landing-checks-live';

/** `$REG/drift-push-live`: arms the drift reconciler's operator pushes. Absent, the lane records what is out of step and
 *  a single shadow notice per finding names what it would have pushed. No writer in the tree. Arm it only after the
 *  digest's drift section has landed: the summary push (and an item with no run or session) opens the day's digest. */
export const DRIFT_PUSH_LIVE_MARKER = 'drift-push-live';

/** `$REG/child-reclaim-disabled` (ARCH-77, #812): child reclaim's own off switch. Absent, child reclaim runs as it does
 *  today. Stood, it is meant to stop the child-spent reason alone, where `reclaim-paused` also stops expiry, collect and
 *  the coordinator reclaim. Touched only by hand: no writer in the tree. The child-spent reader lands with that reason's change. */
export const CHILD_RECLAIM_DISABLED_MARKER = 'child-reclaim-disabled';

/** The spec's bounded contexts (consolidation spec 2026-10-19 §2), the `owner` of a row. */
export const SWITCH_OWNER_MAP = {
  C1: 'Fleet Registry & Accounts',
  C2: 'Fleet Mutation',
  C3: 'Session Conversation',
  C4: 'Workspace Lifecycle',
  C5: 'Coordination',
  C6: 'Attention & Notification',
  C7: 'Update control plane',
  C8: 'Auth & box token',
  C9: 'Docs',
} as const;
export type SwitchOwner = keyof typeof SWITCH_OWNER_MAP;

/** A switch stored as a whole file name in the registry listing (`$REG/<marker>`). */
export interface MarkerStorage { readonly marker: string }
/** A switch stored in a coord.db settings table, as `<table>.<column>`. */
export interface SettingStorage { readonly setting: string }

/** One switch. `default` is what its absence (or the seeded row) means; `writer` is the route or ccd verb that writes
 *  it, or `'hand-only'`. There is no "unlistable" column: what an unlistable registry means is each reader's own
 *  mapping, because they differ (spec K12). */
export interface SwitchRow {
  readonly storage: MarkerStorage | SettingStorage;
  readonly default: string;
  readonly owner: SwitchOwner;
  readonly meaning: string;
  readonly writer: string;
}

/** Every operator switch, keyed by its name (a marker row by its file name). */
export const SWITCHES = {
  [MAIL_DISABLED_MARKER]: {
    storage: { marker: MAIL_DISABLED_MARKER }, default: 'absent: mail is delivered', owner: 'C5',
    meaning: 'No mail is delivered and no run is dispatched while it stands; queued mail waits.', writer: 'hand-only',
  },
  [COORDINATOR_PAUSE_MARKER]: {
    storage: { marker: COORDINATOR_PAUSE_MARKER }, default: 'absent: coordination runs', owner: 'C5',
    meaning: 'Coordination is paused fleet-wide: no run is dispatched, and no coordinator can lift it itself.',
    writer: 'ccd coord-pause, through POST /api/coord/pause',
  },
  [RECLAIM_PAUSE_MARKER]: {
    storage: { marker: RECLAIM_PAUSE_MARKER }, default: 'absent: reclamation runs', owner: 'C4',
    meaning: 'Cleanup is paused fleet-wide: no workspace is reclaimed, expired or collected while it stands.',
    writer: 'ccd reclaim-pause, through POST /api/coord/reclaim-pause',
  },
  [ASKS_DISABLED_MARKER]: {
    storage: { marker: ASKS_DISABLED_MARKER }, default: 'absent: asks may be held', owner: 'C6',
    meaning: 'No new ask is held back; an ask already held still waits out its own time.', writer: 'hand-only',
  },
  [STOP_DONE_DISABLED_MARKER]: {
    storage: { marker: STOP_DONE_DISABLED_MARKER }, default: 'absent: the lane runs (it ships live)', owner: 'C4',
    meaning: 'The lane that stops a worker whose run is done does nothing at all.', writer: 'hand-only',
  },
  [HIBERNATE_DISABLED_MARKER]: {
    storage: { marker: HIBERNATE_DISABLED_MARKER }, default: 'absent: the sweep runs', owner: 'C4',
    meaning: 'The hibernation sweep does nothing at all; it wins over the live switch.', writer: 'hand-only',
  },
  [HIBERNATE_LIVE_MARKER]: {
    storage: { marker: HIBERNATE_LIVE_MARKER }, default: 'absent: shadow, nothing is put to sleep', owner: 'C4',
    meaning: 'Hibernation acts: a long-idle session is put to sleep.', writer: 'hand-only',
  },
  [EXPIRE_LANE_LIVE_MARKER]: {
    storage: { marker: EXPIRE_LANE_LIVE_MARKER }, default: 'absent: shadow, the lane records what it would expire',
    owner: 'C4', meaning: 'The expiry lane acts: an archived workspace past its time is expired.', writer: 'hand-only',
  },
  [EXPIRE_CHILD_LIVE_MARKER]: {
    storage: { marker: EXPIRE_CHILD_LIVE_MARKER }, default: 'absent: shadow, the lane records which archived children it would expire',
    owner: 'C4', meaning: 'The expiry lane takes an archived child too, once the lane itself acts.', writer: 'hand-only',
  },
  [STALE_ARCHIVE_LIVE_MARKER]: {
    storage: { marker: STALE_ARCHIVE_LIVE_MARKER }, default: 'absent: shadow, the arm records what it would archive',
    owner: 'C4', meaning: 'The stale-archive arm acts: a workspace with no pane for 14 days is archived.', writer: 'hand-only',
  },
  [COLLECT_LANE_LIVE_MARKER]: {
    storage: { marker: COLLECT_LANE_LIVE_MARKER }, default: 'absent: the Settings arm alone decides', owner: 'C4',
    meaning: 'The legacy arm of the collector: it arms the lane while it stands and its latch is unset.',
    writer: 'hand-only',
  },
  [ORPHAN_TREE_LIVE_MARKER]: {
    storage: { marker: ORPHAN_TREE_LIVE_MARKER }, default: 'absent: shadow, the lane records what it would remove',
    owner: 'C4', meaning: 'The orphan-worktree lane acts: a clean tree no registry row names, whose commits are all on a remote, is removed.',
    writer: 'hand-only',
  },
  [ORPHAN_TREE_RESCUE_LIVE_MARKER]: {
    storage: { marker: ORPHAN_TREE_RESCUE_LIVE_MARKER }, default: 'absent: a tree with commits on no remote is left',
    owner: 'C4', meaning: 'With the orphan lane live, a tree whose HEAD is on no remote is pinned into the attic and then removed.',
    writer: 'hand-only',
  },
  [COLLECT_LOOSE_LIVE_MARKER]: {
    storage: { marker: COLLECT_LOOSE_LIVE_MARKER }, default: 'absent: shadow, the lane records what loose entries it would remove',
    owner: 'C4', meaning: 'The collector\'s loose arm acts: an idle entry under the fleet temp directory that no session '
      + 'witnessed is removed, once the lane itself is live.', writer: 'hand-only',
  },
  [DEAD_COORDINATOR_LANE_LIVE_MARKER]: {
    storage: { marker: DEAD_COORDINATOR_LANE_LIVE_MARKER }, default: 'absent: shadow, the lane records what it would end',
    owner: 'C5', meaning: 'The dead-coordinator lane acts: a programme whose coordinator is gone is ended.',
    writer: 'hand-only',
  },
  [NESTED_RESCUE_LIVE_MARKER]: {
    storage: { marker: NESTED_RESCUE_LIVE_MARKER }, default: 'absent: shadow, a nested repository is refused and the audit names what the arm would rescue',
    owner: 'C4', meaning: 'Rung 9 rescues a nested repository into the attic instead of refusing a tree that holds one.',
    writer: 'hand-only',
  },
  [DRIFT_PUSH_LIVE_MARKER]: {
    storage: { marker: DRIFT_PUSH_LIVE_MARKER }, default: 'absent: shadow, the reconciler records what it would push',
    owner: 'C5', meaning: 'The drift reconciler pushes the operator once about a finding that stands past 24 hours. ' +
      "Arm it only once the digest lists drift findings: its summary push opens the day's digest.",
    writer: 'hand-only',
  },
  [CHILD_RECLAIM_DISABLED_MARKER]: {
    storage: { marker: CHILD_RECLAIM_DISABLED_MARKER }, default: 'absent: child reclaim runs', owner: 'C4',
    meaning: 'Meant to switch off child reclaim alone, leaving expiry, collect and the coordinator reclaim running. Nothing reads it yet: touching it stops nothing until the child-spent reason moves (ARCH-44).',
    writer: 'hand-only',
  },
  [IDLE_NUDGE_DISABLED_MARKER]: {
    storage: { marker: IDLE_NUDGE_DISABLED_MARKER }, default: 'absent: the nudge runs', owner: 'C3',
    meaning: 'A session left idle after compaction with work open is not nudged.', writer: 'hand-only',
  },
  [MAIL_GATE_STRICT_MARKER]: {
    storage: { marker: MAIL_GATE_STRICT_MARKER }, default: 'absent: the shell mode', owner: 'C5',
    meaning: 'Mail is delivered only to an idle session, the rule before the gate\'s first wave, whatever else stands.',
    writer: 'hand-only',
  },
  [MAIL_GATE_BUSY_MARKER]: {
    storage: { marker: MAIL_GATE_BUSY_MARKER }, default: 'absent: the shell mode', owner: 'C5',
    meaning: 'Mail is delivered to a busy session whose main turn has ended.', writer: 'hand-only',
  },
  [MAIL_GATE_BUSY_SHADOW_MARKER]: {
    storage: { marker: MAIL_GATE_BUSY_SHADOW_MARKER }, default: 'absent: the shell mode', owner: 'C5',
    meaning: 'The gate decides busy as the busy mode would, delivers nothing more, and logs what it would have sent.',
    writer: 'hand-only',
  },
  [LANDING_DISABLED_MARKER]: {
    storage: { marker: LANDING_DISABLED_MARKER }, default: 'absent: the checks lane reads and writes its rows', owner: 'C4',
    meaning: 'The PR-landing checks lane makes no read and writes no edge or mail; it wins over the live marker, and a live episode keeps only its stuck bound.',
    writer: 'hand-only',
  },
  [LANDING_CHECKS_LIVE_MARKER]: {
    storage: { marker: LANDING_CHECKS_LIVE_MARKER }, default: 'absent: new episodes run in shadow, nothing is mailed', owner: 'C4',
    meaning: 'New PR-landing episodes are live: the checks lane mails the coordinator when the required checks settle.',
    writer: 'hand-only',
  },
  'stall-watch-level': {
    storage: { setting: 'stall_settings.level' }, default: 'follow', owner: 'C5',
    meaning: 'How far the worker stall watch acts, chosen in Settings.', writer: 'POST /api/coord/stall-watch',
  },
  'collect-lane-choice': {
    storage: { setting: 'collect_lane_settings.choice' }, default: 'off', owner: 'C4',
    meaning: 'The Settings arm of the collector: only an exact live choice arms it.',
    writer: 'POST /api/coord/collect-lane',
  },
} as const satisfies Readonly<Record<string, SwitchRow>>;

export type SwitchName = keyof typeof SWITCHES;
/** The rows stored as a registry marker. */
export type MarkerSwitchName = {
  [K in SwitchName]: (typeof SWITCHES)[K]['storage'] extends MarkerStorage ? K : never
}[SwitchName];

const isMarkerRow = (k: SwitchName): k is MarkerSwitchName => 'marker' in SWITCHES[k].storage;

/** Every marker row's name, in `SWITCHES` order. */
export const markerSwitchNames: readonly MarkerSwitchName[] = (Object.keys(SWITCHES) as SwitchName[]).filter(isMarkerRow);

/** What one registry listing says of every marker row, in the wire's `MarkerState`. */
export type SwitchReading = { readonly [K in MarkerSwitchName]: MarkerState };

/** The one reader of the marker rows. A listed marker is `'set'`, an absent one `'clear'`; a `null` listing (the
 *  registry could not be listed) is `'unmeasurable'` for EVERY marker row, never `'clear'`. It never resolves
 *  `'unmeasurable'` to a verdict: each reader keeps its own mapping (the executors and the mail lanes fail shut).
 *  Settings rows are not in the answer: a listing says nothing about them. */
export function readSwitches(listing: readonly string[] | null): SwitchReading {
  const out = {} as Record<MarkerSwitchName, MarkerState>;
  for (const k of markerSwitchNames) {
    out[k] = listing === null ? 'unmeasurable' : listing.includes(SWITCHES[k].storage.marker) ? 'set' : 'clear';
  }
  return out;
}
