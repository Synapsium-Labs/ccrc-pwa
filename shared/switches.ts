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
/** `$REG/collect-lane-live`: the LEGACY arm of the collector's switch (Settings is the other arm). Kept: it still
 *  arms the lane while it stands and its latch is unset (spec K12). */
export const COLLECT_LANE_LIVE_MARKER = 'collect-lane-live';
/** `$REG/dead-coordinator-lane-live`: arms the dead-coordinator lane's act. */
export const DEAD_COORDINATOR_LANE_LIVE_MARKER = 'dead-coordinator-lane-live';
/** `$REG/child-stale-reclaim-live`: arms the child reclaim's stale arm (D-6639): a kept child idle for seven days is
 *  reclaimed. Absent, the lane records "child would be reclaimed (stale)" and acts on nothing. */
export const CHILD_STALE_RECLAIM_LIVE_MARKER = 'child-stale-reclaim-live';
/** `$REG/idle-compact-nudge-disabled`: the idle-compaction nudge's kill switch. */
export const IDLE_NUDGE_DISABLED_MARKER = 'idle-compact-nudge-disabled';
/** `$REG/mail-gate-strict`: the mail gate's pre-wave-1 rule. */
export const MAIL_GATE_STRICT_MARKER = 'mail-gate-strict';
/** `$REG/mail-gate-busy`: the mail gate's second hand-armed step. */
export const MAIL_GATE_BUSY_MARKER = 'mail-gate-busy';
/** `$REG/mail-gate-busy-shadow`: the mail gate's first hand-armed step. */
export const MAIL_GATE_BUSY_SHADOW_MARKER = 'mail-gate-busy-shadow';

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
  [COLLECT_LANE_LIVE_MARKER]: {
    storage: { marker: COLLECT_LANE_LIVE_MARKER }, default: 'absent: the Settings arm alone decides', owner: 'C4',
    meaning: 'The legacy arm of the collector: it arms the lane while it stands and its latch is unset.',
    writer: 'hand-only',
  },
  [DEAD_COORDINATOR_LANE_LIVE_MARKER]: {
    storage: { marker: DEAD_COORDINATOR_LANE_LIVE_MARKER }, default: 'absent: shadow, the lane records what it would end',
    owner: 'C5', meaning: 'The dead-coordinator lane acts: a programme whose coordinator is gone is ended.',
    writer: 'hand-only',
  },
  [CHILD_STALE_RECLAIM_LIVE_MARKER]: {
    storage: { marker: CHILD_STALE_RECLAIM_LIVE_MARKER }, default: 'absent: shadow, the lane records what it would reclaim',
    owner: 'C4', meaning: 'The stale arm acts: a kept child idle for seven days is reclaimed, its work pinned to the attic.',
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
