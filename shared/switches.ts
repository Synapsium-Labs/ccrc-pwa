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
/** `$REG/runs-expire-never-started`: arms the run-close lane's never-started group (D-8077; spec 2026-11-04 §12): row E1, a
 *  planned programme quiet for 72 hours after a warning, and row E1r, a planned review of finished work. Absent, the lane
 *  records "would warn" and "would close" and acts on nothing. No writer in the tree: since Task 26 the operator arms the group from
 *  Advanced (`run-close-never-started-choice`), and this marker is only an emergency override that arms it whatever that row says. */
export const RUNS_EXPIRE_NEVER_STARTED_MARKER = 'runs-expire-never-started';
/** `$REG/runs-expire-coordinator-gone`: arms the run-close lane's claimant-gone group (D-8078; spec 2026-11-04 §12): row E3 (a
 *  coordinator removed), row E3s (a coordinator stopped by a person) and row E5 (a session name reused by a later run). Absent,
 *  the lane records "would close" and acts on nothing. No writer in the tree: the operator arms the group from Advanced
 *  (`run-close-claimant-gone-choice`), and this marker is only an emergency override that arms it whatever that row says. */
export const RUNS_EXPIRE_COORDINATOR_GONE_MARKER = 'runs-expire-coordinator-gone';
/** `$REG/child-stale-reclaim-live`: arms the child reclaim's stale arm (D-6639): a kept child idle for seven days is
 *  reclaimed. Absent, the lane records "child would be reclaimed (stale)" and acts on nothing. */
export const CHILD_STALE_RECLAIM_LIVE_MARKER = 'child-stale-reclaim-live';
/** `$REG/deps-shed-live`: arms the deps-shed arm of the run-done row (D-7278): a sleeping session's git-ignored,
 *  untracked dependency directories are removed once its work is finished past the age. Absent, the arm asks the box's
 *  dry run and records "dependencies would be removed" and removes nothing. No writer in the tree: the operator arms it. */
export const DEPS_SHED_LIVE_MARKER = 'deps-shed-live';
/** `$REG/child-superseded-reclaim-live`: arms the child reclaim's superseded-review release (D-6922):
 *  an earlier review child is reclaimed once a later review of the same run has closed, though the reviewed run is open.
 *  Absent, the lane records "review report would be reclaimed (superseded)" and acts on nothing. */
export const CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER = 'child-superseded-reclaim-live';
/** `$REG/idle-compact-nudge-disabled`: the idle-compaction nudge's kill switch. */
export const IDLE_NUDGE_DISABLED_MARKER = 'idle-compact-nudge-disabled';
/** `$REG/mail-gate-strict`: the mail gate's pre-wave-1 rule. */
export const MAIL_GATE_STRICT_MARKER = 'mail-gate-strict';
/** `$REG/mail-gate-busy`: the mail gate's second hand-armed step. */
export const MAIL_GATE_BUSY_MARKER = 'mail-gate-busy';
/** `$REG/mail-gate-busy-shadow`: the mail gate's first hand-armed step. */
export const MAIL_GATE_BUSY_SHADOW_MARKER = 'mail-gate-busy-shadow';
/** `$REG/stall-watch-disabled` (D-8339): the worker stall watch's kill switch. It wins over the level chosen in Settings, so
 *  it is an emergency override with no control: touched and removed by hand at a terminal, no writer in the tree. Its
 *  reader is the lane's arming (`server/src/coord/stall.ts`); the Stall watch card names it while it holds the watch. */
export const STALL_WATCH_DISABLED_MARKER = 'stall-watch-disabled';
/** `$REG/autocompact-disabled` (D-8382): ccd's proactive `/compact` of an idle session, off fleet-wide. ccd's tick reads it
 *  itself (`AUTOCOMPACT_DISABLE_FILE`, `ccd/ccd`). Touched and removed by hand: no writer in the tree. */
export const AUTOCOMPACT_DISABLED_MARKER = 'autocompact-disabled';
/** `$REG/coordinator-roster-card-live`: arms the session hook's roster card (durability D4, #757) and its wake arm (R-5a,
 *  D-8201). Unarmed, the card goes to a shadow log only. No writer in the tree. */
export const COORDINATOR_ROSTER_CARD_LIVE_MARKER = 'coordinator-roster-card-live';
/** `$REG/landing-disabled`: the PR-landing checks lane's kill switch; it wins over the live marker. */
export const LANDING_DISABLED_MARKER = 'landing-disabled';
/** `$REG/landing-checks-live`: arms NEW episodes of the checks lane live (otherwise they run in shadow). */
export const LANDING_CHECKS_LIVE_MARKER = 'landing-checks-live';

/** `$REG/drift-push-live`: arms the drift reconciler's operator pushes. Absent, the lane records what is out of step and
 *  a single shadow notice per finding names what it would have pushed. No writer in the tree. Arm it only after the
 *  digest's drift section has landed: the summary push (and an item with no run or session) opens the day's digest. */
export const DRIFT_PUSH_LIVE_MARKER = 'drift-push-live';

/** `$REG/child-reclaim-disabled` (ARCH-77, #812): child reclaim's own off switch. Absent, child reclaim runs as it does
 *  today. Stood, it stops the child-spent reason alone (the sweep and the close hand-off queue none, and the executor
 *  refuses at decide and at the act), where `reclaim-paused` also stops expiry, collect and the coordinator reclaim.
 *  Touched only by hand: no writer in the tree. Its reader is `server/src/coord/childReclaimDisabled.ts`. */
export const CHILD_RECLAIM_DISABLED_MARKER = 'child-reclaim-disabled';

/** `$REG/testbox-remote-live` (D-7404; test box spec 2026-10-28 §2.7): the test box's remote switch. Absent, every
 *  `ccrc test` run is local; stood, a run goes to the test box when spec §2.4's checks pass. The wrapper reads it
 *  itself, so the switch works with the server down. Its writer, `ccd testbox-remote` behind the switch route, lands
 *  with the test box plan's TB9; its reader, the wrapper, with TB8. Until then nothing in the tree holds it. */
export const TESTBOX_REMOTE_LIVE_MARKER = 'testbox-remote-live';

/** `$REG/pane-scope-stop-live` (D-7902): arms the deliberate stop's pane-scope stop. Stood, `ccd stop` and `ccd hibernate`
 *  (the stop-done lane and the roll included) stop the session's own pane scope once its main process has exited;
 *  absent, they only log what they would stop. Its writer is `ccd pane-scope-stop`, behind Settings › Automation; its
 *  one reader is ccd's own act. */
export const PANE_SCOPE_STOP_LIVE_MARKER = 'pane-scope-stop-live';
/** `$REG/scope-sweep-live`: arms `ccd-scope-sweep`'s stop of an INERT dead pane scope. Absent, the sweep records
 *  `would-stop` and stops nothing. The sweep reads it itself. No writer in the tree: the operator touches it by hand,
 *  and the door over both only reads it (D-7994). */
export const SCOPE_SWEEP_LIVE_MARKER = 'scope-sweep-live';
/** `$REG/scope-sweep-busy-live` (D-7993): arms the sweep's busy arm, the stop of a busy dead scope whose session is
 *  provably dead. It means nothing unless `scope-sweep-live` also stands. Absent, the arm records `would-stop (busy)` with
 *  the process list. Its one writer is `ccd scope-sweep-busy`, behind `POST /api/coord/scope-sweep` (D-7994). */
export const SCOPE_SWEEP_BUSY_LIVE_MARKER = 'scope-sweep-busy-live';
/** `$REG/delegation-adopt`: arms the delegation lane's adoption (spec §5.6). Absent, the lane only records what it would adopt
 *  (O5-7 (a)). Its one writer is `ccd delegation-adopt`, behind `POST /api/coord/delegation-adopt` (D-8112): the operator's switch,
 *  past the door's refusal rule (D-8113); the door's GET serves what the lane would keep (D-8114). */
export const DELEGATION_ADOPT_MARKER = 'delegation-adopt';

/** `~/.ccrc/graph-gate-off` on the fleet host (D-8382): the graphify search gate's kill switch. The session hook reads it
 *  (`GRAPH_GATE_OFF`, `ccd/session-hook.sh`), and so does doctor's graphify line. No writer in the tree. A `*_FILE`, not a
 *  `*_MARKER`: it is not a registry marker, so `readSwitches` never reads it. */
export const GRAPH_GATE_OFF_FILE = 'graph-gate-off';
/** `~/.ccrc/ccrc-card-off` on the fleet host (D-8382): silences the session hook's two ccrc card subjects, the hold card
 *  and the ccrc card (`CCRC_CARD_OFF`, `ccd/session-hook.sh`); the graphify card is not its. No writer in the tree. */
export const CCRC_CARD_OFF_FILE = 'ccrc-card-off';
/** `~/.ccrc/compact-card-off` on the fleet host (D-8382): the compaction card's off switch, honoured by all three of its
 *  arms (`COMPACT_CARD_OFF`, `ccd/session-hook.sh`). No writer in the tree. */
export const COMPACT_CARD_OFF_FILE = 'compact-card-off';

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
/** A switch stored as a file in the fleet host's `~/.ccrc` (`~/.ccrc/<ccrcFile>`, D-8382): the operator's own touch
 *  files the session hook reads. Never in a registry listing; the server asks the fleet host's agent whether one stands. */
export interface CcrcFileStorage { readonly ccrcFile: string }

/** One switch. `default` is what its absence (or the seeded row) means; `writer` is the route or ccd verb that writes
 *  it, or `'hand-only'`. There is no "unlistable" column: what an unlistable registry means is each reader's own
 *  mapping, because they differ (spec K12). */
export interface SwitchRow {
  readonly storage: MarkerStorage | SettingStorage | CcrcFileStorage;
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
  [RUNS_EXPIRE_NEVER_STARTED_MARKER]: {
    storage: { marker: RUNS_EXPIRE_NEVER_STARTED_MARKER }, default: 'absent: shadow, the lane records what it would warn and close',
    owner: 'C5', meaning: 'The run-close lane closes never-started waves in a quiet programme.',
    writer: 'hand-only',
  },
  [RUNS_EXPIRE_COORDINATOR_GONE_MARKER]: {
    storage: { marker: RUNS_EXPIRE_COORDINATOR_GONE_MARKER }, default: 'absent: shadow, the lane records what it would close',
    owner: 'C5', meaning: 'The run-close lane closes the runs of a coordinator that was removed or stopped by a person, and runs whose session name a later run reuses.',
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
    meaning: 'Switches off child reclaim alone: the sweep and the close hand-off queue none, and the executor refuses to act. Expiry, collect, the dead-coordinator lane and stop-done keep running; reclaim-paused stops those too.',
    writer: 'hand-only',
  },
  [CHILD_STALE_RECLAIM_LIVE_MARKER]: {
    storage: { marker: CHILD_STALE_RECLAIM_LIVE_MARKER }, default: 'absent: shadow, the lane records what it would reclaim',
    owner: 'C4', meaning: 'The stale arm acts: a kept child idle for seven days is reclaimed, its work pinned to the attic.',
    writer: 'hand-only',
  },
  [DEPS_SHED_LIVE_MARKER]: {
    storage: { marker: DEPS_SHED_LIVE_MARKER }, default: 'absent: shadow, the arm records what it would remove',
    owner: 'C4', meaning: 'The deps-shed arm acts: a sleeping worker or coordinator whose work finished past the age has its ignored dependency directories removed; its worktree and every git fact stay.',
    writer: 'hand-only',
  },
  [CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER]: {
    storage: { marker: CHILD_SUPERSEDED_RECLAIM_LIVE_MARKER }, default: 'absent: shadow, the lane records what it would reclaim',
    owner: 'C4', meaning: 'An earlier review child is reclaimed once a later review of the same run has closed, though the reviewed run is still open.',
    writer: 'hand-only',
  },
  [IDLE_NUDGE_DISABLED_MARKER]: {
    storage: { marker: IDLE_NUDGE_DISABLED_MARKER }, default: 'absent: the nudge runs', owner: 'C3',
    meaning: 'A session left idle after compaction with work open is not nudged.', writer: 'hand-only',
  },
  [AUTOCOMPACT_DISABLED_MARKER]: {
    storage: { marker: AUTOCOMPACT_DISABLED_MARKER }, default: 'absent: ccd compacts an idle session whose context reaches its threshold',
    owner: 'C3', meaning: 'ccd never types /compact into an idle session, fleet-wide, however full its context is.',
    writer: 'hand-only',
  },
  [GRAPH_GATE_OFF_FILE]: {
    storage: { ccrcFile: GRAPH_GATE_OFF_FILE }, default: 'absent: a search in a freshly graphed tree is turned back until the session queries the graph',
    owner: 'C3', meaning: 'The graph gate is open: no session is turned back to query its tree\'s code graph before it searches.',
    writer: 'hand-only',
  },
  [CCRC_CARD_OFF_FILE]: {
    storage: { ccrcFile: CCRC_CARD_OFF_FILE }, default: 'absent: a session\'s context carries the hold card and the ccrc card',
    owner: 'C5', meaning: 'The session hook prints neither the hold card nor the ccrc card; the graphify card is unaffected.',
    writer: 'hand-only',
  },
  [COMPACT_CARD_OFF_FILE]: {
    storage: { ccrcFile: COMPACT_CARD_OFF_FILE }, default: 'absent: the compaction card runs', owner: 'C3',
    meaning: 'The compaction card is off in all three of its arms: no card, no steering and no measurement around a compaction.',
    writer: 'hand-only',
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
  [STALL_WATCH_DISABLED_MARKER]: {
    storage: { marker: STALL_WATCH_DISABLED_MARKER }, default: 'absent: the watch runs at the level that applies', owner: 'C5',
    meaning: 'The worker stall watch does nothing at all: nothing is recorded or sent, whatever level is chosen in Settings.',
    writer: 'hand-only',
  },
  [COORDINATOR_ROSTER_CARD_LIVE_MARKER]: {
    storage: { marker: COORDINATOR_ROSTER_CARD_LIVE_MARKER }, default: 'absent: shadow, the card goes to ~/.ccrc/roster-card-shadow.log', owner: 'C5',
    meaning: 'A coordinator\'s first context after a compaction, resume or clear, and its first wake after an idle compaction, carries the open runs it claims.',
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
  'roll-idle-targets': {
    storage: { setting: 'roll_settings.targets' }, default: 'coordinators', owner: 'C4',
    meaning: 'Which idle sessions the automatic roll restarts onto the current release: coordinators, or off (D-7453).',
    writer: 'POST /api/coord/roll-idle',
  },
  'dispatch-abandon-choice': {
    storage: { setting: 'dispatch_abandon_settings.choice' }, default: 'on', owner: 'C5',
    meaning: 'The server abandons a run whose dispatch never came back and mails its coordinator: on, or off (D-7319).',
    writer: 'POST /api/coord/dispatch-abandon',
  },
  'run-close-never-started-choice': {
    storage: { setting: 'run_close_settings.neverStarted' }, default: 'shadow', owner: 'C5',
    meaning: 'The run-close lane\'s never-started group (rows E1 and E1r): off, shadow (it records what it would close) or on (D-8077). A standing runs-expire-never-started marker is an emergency override that arms it.',
    writer: 'POST /api/coord/run-close',
  },
  'run-close-claimant-crashed-choice': {
    storage: { setting: 'run_close_settings.claimantCrashed' }, default: 'shadow', owner: 'C5',
    meaning: 'The crash row of the run-close lane (a claimant that crashed): off, shadow or on (D-8077). A standing dead-coordinator-lane-live marker is an emergency override that arms it.',
    writer: 'POST /api/coord/run-close',
  },
  'run-close-claimant-gone-choice': {
    storage: { setting: 'run_close_settings.claimantGone' }, default: 'shadow', owner: 'C5',
    meaning: 'The claimant-gone group of the run-close lane (rows E3, E3s and E5): off, shadow (it records what it would close) or on (D-8078). A standing runs-expire-coordinator-gone marker is an emergency override that arms it.',
    writer: 'POST /api/coord/run-close',
  },
  'plain-auto-memory': {
    storage: { setting: 'plain_memory_settings.choice' }, default: 'off', owner: 'C3',
    meaning: 'Whether a plain session keeps Claude Code\'s auto memory from its next launch (Overlord H14, Table 11.1d); applied only while the launch-profile lane is live, and every other role has it off.',
    writer: 'POST /api/coord/plain-auto-memory',
  },
  [SCOPE_SWEEP_LIVE_MARKER]: {
    storage: { marker: SCOPE_SWEEP_LIVE_MARKER }, default: 'absent: shadow, the sweep records what it would stop',
    owner: 'C4', meaning: 'The pane-scope sweep acts: an inert scope of a dead pane is stopped, three a minute at most.',
    writer: 'hand-only',
  },
  [SCOPE_SWEEP_BUSY_LIVE_MARKER]: {
    storage: { marker: SCOPE_SWEEP_BUSY_LIVE_MARKER }, default: 'absent: shadow, the sweep records the busy scopes it would stop',
    owner: 'C4', meaning: 'With the sweep itself live, a busy scope whose session has been provably dead for six hours is stopped too, inside the same three a minute.',
    writer: 'ccd scope-sweep-busy, through POST /api/coord/scope-sweep',
  },
  [DELEGATION_ADOPT_MARKER]: {
    storage: { marker: DELEGATION_ADOPT_MARKER }, default: 'absent: shadow, the lane records what it would adopt', owner: 'C5',
    meaning: 'The delegation lane adopts a changed worktree whose delegated activity has terminal evidence, and mails its owner.',
    writer: 'ccd delegation-adopt, through POST /api/coord/delegation-adopt',
  },
  [PANE_SCOPE_STOP_LIVE_MARKER]: {
    storage: { marker: PANE_SCOPE_STOP_LIVE_MARKER }, default: 'absent: shadow, a stop only logs what it would stop',
    owner: 'C2', meaning: 'A session stopped on purpose (a stop, a finished worker, a sleep) also stops what it left '
      + 'running in its pane, once its main process has exited.',
    writer: 'ccd pane-scope-stop, through POST /api/coord/pane-scope-stop',
  },
  [TESTBOX_REMOTE_LIVE_MARKER]: {
    storage: { marker: TESTBOX_REMOTE_LIVE_MARKER }, default: 'absent: every run is local', owner: 'C2',
    meaning: 'Test runs go to the test box when its checks pass; any run that cannot falls back to the local tests slice and says why.',
    writer: 'ccd testbox-remote, through POST /api/testbox/switch',
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

// ── The `~/.ccrc` rows and Overrides in force (D-8382) ──────────────────────────────────────────────────────────────

/** The rows stored as a file in the fleet host's `~/.ccrc`. */
export type CcrcFileSwitchName = {
  [K in SwitchName]: (typeof SWITCHES)[K]['storage'] extends CcrcFileStorage ? K : never
}[SwitchName];

const isCcrcFileRow = (k: SwitchName): k is CcrcFileSwitchName => 'ccrcFile' in SWITCHES[k].storage;

/** Every `~/.ccrc` row's name, in `SWITCHES` order. */
export const ccrcFileSwitchNames: readonly CcrcFileSwitchName[] = (Object.keys(SWITCHES) as SwitchName[]).filter(isCcrcFileRow);

/** The `~/.ccrc` file names those rows store, DERIVED: the fleet host's agent admits a `stat` of exactly these
 *  (`agent/src/whitelist.ts`, `checkCcrcSwitchStat`), and the server asks of nothing else there. */
export const CCRC_SWITCH_FILES: readonly string[] = ccrcFileSwitchNames.map((k) => SWITCHES[k].storage.ccrcFile);

/** What the fleet host says of every `~/.ccrc` row, in the wire's `MarkerState`: a file that stands is `'set'`, a proven
 *  absence `'clear'`, any read that proved neither (an agent older than the admission, the link down) `'unmeasurable'`. */
export type CcrcFileReading = { readonly [K in CcrcFileSwitchName]: MarkerState };

/** A switch a person places by hand at a terminal and only there: a registry marker or a `~/.ccrc` file whose `writer` is
 *  `'hand-only'`. A switch with a writer has its own control elsewhere in the console; a settings row is not a file. */
export type OverrideSwitchName = {
  [K in MarkerSwitchName | CcrcFileSwitchName]: (typeof SWITCHES)[K]['writer'] extends 'hand-only' ? K : never
}[MarkerSwitchName | CcrcFileSwitchName];

const isOverrideRow = (k: SwitchName): k is OverrideSwitchName =>
  (isMarkerRow(k) || isCcrcFileRow(k)) && SWITCHES[k].writer === 'hand-only';

/** Overrides in force's rows, DERIVED from `SWITCHES` in its order: no second list is kept anywhere. */
export const overrideSwitchNames: readonly OverrideSwitchName[] = (Object.keys(SWITCHES) as SwitchName[]).filter(isOverrideRow);

/** One override and what was read of it. */
export interface OverrideReading { readonly name: OverrideSwitchName; readonly state: MarkerState }

/** Every override, in `overrideSwitchNames` order, from the one registry reading (`readSwitches`) and the one reading of
 *  the fleet host's `~/.ccrc`. Pure: each state is the reading's own, never resolved to a verdict. */
export function overridesOf(registry: SwitchReading, ccrcFiles: CcrcFileReading): OverrideReading[] {
  return overrideSwitchNames.map((name) => ({
    name, state: isMarkerRow(name) ? registry[name as MarkerSwitchName & OverrideSwitchName] : ccrcFiles[name as CcrcFileSwitchName & OverrideSwitchName],
  }));
}

/** Where a marker or a `~/.ccrc` file stands on the fleet host, spelled as a person types it at a terminal there. */
export function switchPath(name: MarkerSwitchName | CcrcFileSwitchName): string {
  const s: MarkerStorage | CcrcFileStorage = SWITCHES[name].storage;
  return 'marker' in s ? `~/.cc-sessions/${s.marker}` : `~/.ccrc/${s.ccrcFile}`;
}
