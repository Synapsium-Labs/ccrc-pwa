// D-8274 (worktree economy spec 2026-10-28 R-6): Settings › Automation › Shadow lanes, the one card the operator arms a
// shadow lane from, instead of touching a `$REG/<name>` marker at a terminal on the fleet box. This file is its L0 half:
// the lanes the card has a row for, the two choices, the marker each row imports once and then retires, the wire view
// of `GET`/`POST /api/coord/lane-arm`, and the card's words. L0: the PWA bundles `shared/`, so this file takes no `node:`
// module; its one value import is the marker's name from the switchboard, which is L0 too. It sits outside `shared/api.ts`
// for `dispatch-abandon.ts`'s reason: other programmes append at that file's foot.
//
// ONE ROW PER SWITCH, ONE STORE, ONE ROUTE (R-6). A lane is live when, and only when, its row's stored choice is exactly
// `live` and the row's gate is open (`laneArmLive`; review 2006 N1). The row a lane gets lives in `lane_arm_settings` (coord.db), seeded `shadow`, written only by
// `POST /api/coord/lane-arm`. A switch that has a marker today imports it ONCE: the first server pass that can list the
// registry after the upgrade sets a never-written row Live when the marker stands, journals it in the feed naming the file,
// and from then on the marker is not read. A later lane joins by adding its name here and its seed row in a migration.
import type { ReadFailure } from './agent-protocol.js';
import { COORDINATOR_ROSTER_CARD_LIVE_MARKER } from './switches.js';

/** The roster card's row (durability D4, #757): the first lane on the card. */
export const ROSTER_CARD_LANE = 'roster-card';
/** The renewal lane's row (Overlord W1a, the generations piece): long-lived sessions renewed through their generations.
 *  In shadow the lane records each generation's would-be states in `shadowState`; live, it moves `state`. */
export const CONTINUITY_LANE = 'continuity';
/** The launch-profile lane's row (Overlord W1a, launch profiles PR B; spec §3.6 H1, §3.3.7 H14): each session's route names
 *  its role's launch profile. In shadow the lane counts the route writes it would make; live, it writes them, and from each
 *  session's next launch auto memory is off for every role but `plain` (whose Settings row decides). */
export const LAUNCH_PROFILE_LANE = 'launch-profile';
/** The anchor's row (Overlord W1a, the anchor piece; spec §3.3.3 C38): the card door's `part=anchor`. In shadow the door
 *  renders each anchor and logs its size, and answers `dark`, so the hook prints today's role card; live, it serves the
 *  anchor, which the hook prints in its first slot at every start of a session that is not a child, a fork's one refusal
 *  line, and the anchor once after an automatic compaction that brought no start. */
export const ANCHOR_SLOT_LANE = 'anchor-slot';
/** The dispatch cap's row (D-8792; waiting workers spec 2026-11-19, Part 3): a run holds a concurrency slot only while its
 *  worker works. In shadow the cap counts every active run as before and the caps view reports how many have a worker
 *  measured waiting; live, the cap leaves those out, hands the slots they free out at the wake budget's rate, and a
 *  resume or send-back to a live or sleeping worker is not charged a slot. Shadow is its off switch. */
export const CAP_COUNTS_WORKING_LANE = 'cap-counts-working';
/** The lanes the Shadow lanes card has a row for, in the card's order. */
export const LANE_ARM_LANES = [ROSTER_CARD_LANE, CONTINUITY_LANE, LAUNCH_PROFILE_LANE, ANCHOR_SLOT_LANE, CAP_COUNTS_WORKING_LANE] as const;
export type LaneArmLane = (typeof LANE_ARM_LANES)[number];
export function isLaneArmLane(v: unknown): v is LaneArmLane {
  return typeof v === 'string' && (LANE_ARM_LANES as readonly string[]).includes(v);
}

/** A row's two stored choices (`lane_arm_settings.choice`). Only an exact `live` arms the lane: a token a newer build
 *  writes reads here as not armed, never as live. The seed is `shadow`. */
export const LANE_ARM_CHOICES = ['shadow', 'live'] as const;
export type LaneArmChoice = (typeof LANE_ARM_CHOICES)[number];
export function isLaneArmChoice(v: unknown): v is LaneArmChoice {
  return typeof v === 'string' && (LANE_ARM_CHOICES as readonly string[]).includes(v);
}

/** The marker each row imports once at upgrade and then retires (spec R-6's table). A lane with no marker today is
 *  absent here, and its row imports nothing. */
export const LANE_ARM_MARKER: Readonly<Partial<Record<LaneArmLane, string>>> = {
  [ROSTER_CARD_LANE]: COORDINATOR_ROSTER_CARD_LIVE_MARKER,
};

/** Where the roster card's shadow record lives on the fleet box, `~`-relative: the session hook appends the card it
 *  would have injected there while the row is Shadow (`ccd/session-hook.sh`'s `_hook_roster_card`). The card names it,
 *  so the operator knows what to read before going live. */
export const ROSTER_CARD_SHADOW_LOG = '~/.ccrc/roster-card-shadow.log';

/** The field of the `GET /api/runs` reply that carries the roster card's switch to the session hook (R-6's "Readers"):
 *  `live` or `shadow`, absent when the server could not read the row. The hook arms the card on an exact `live` only. */
export const RUNS_ROSTER_CARD_FIELD = 'rosterCard';

/** How the one-time import of a row's marker went, once it ran. `stood`: the marker stood and the row was set Live;
 *  `stood-kept`: the marker stood but the operator had already set the row, so the row was left as it was; `absent`: no
 *  marker stood. */
export const LANE_ARM_IMPORTS = ['stood', 'stood-kept', 'absent'] as const;
export type LaneArmImport = (typeof LANE_ARM_IMPORTS)[number];
export function isLaneArmImport(v: unknown): v is LaneArmImport {
  return typeof v === 'string' && (LANE_ARM_IMPORTS as readonly string[]).includes(v);
}

/** One row of the card, as the server read it.
 *  - `stored`: the row's choice as this build reads it; `unknown` is a token this build does not know, `absent` a lost
 *    row, `unreadable` a read that failed (`detail` says why). None of the three arms the lane.
 *  - `live`: whether the lane is armed: `stored === 'live'` while the row's gate is open (`laneArmLive`). The card works it
 *    out again from the same rule and its own bundle's gate table, so it can differ from this field only across a PWA and
 *    server build skew, and the two ship together.
 *  - `updatedAt`: the row's last write (epoch ms; 0 is the seed), or null when there is no row to read.
 *  - `imported`: the one-time import of the row's marker, or null while it has not run (or the lane has no marker).
 *  - `marker`: the retired marker's name, or null for a lane that never had one. */
export interface LaneArmRowView {
  lane: LaneArmLane;
  stored: LaneArmChoice | 'unknown' | ReadFailure;
  detail: string | null;
  live: boolean;
  updatedAt: number | null;
  imported: { result: LaneArmImport; at: number } | null;
  marker: string | null;
}

/** The replay quiz's bootstrap as the server checks a single-arm report's interval against it (plan
 *  `2026-11-17-overlord-quiz-record.md` §5 rule 6): a frozen copy of three of `deploy/history-gate.mjs#BOOTSTRAP`'s values,
 *  which `continuity-quiz-route.test.ts` compares with the driver's own. L0 because the server may not import the driver. */
export const QUIZ_BOOTSTRAP = Object.freeze({ ci: 95, method: 'percentile', B: 10000 } as const);

/** How many hex characters of a pending run's report sha the card shows, and `ccrc quiz-record` prints (review 2442 F1). */
export const QUIZ_SHA_PREFIX = 12;
/** One pending replay quiz run, as the card shows it (plan §6): which run (its id, when it was recorded, the start of its
 *  report's sha and the verb's trace), when the arms ran, the score and its interval, the questions, families and counts. The
 *  operator matches the sha prefix with what `report` and `ccrc quiz-record` printed, then confirms or discards it there. */
export interface LaneArmQuizPending {
  id: number;
  recordedAt: number;
  reportShaPrefix: string;
  recordedBy: string;
  measuredAt: number;
  score: number;
  lo: number;
  hi: number;
  questions: number;
  families: number;
  answered: number;
  runFailed: number;
  absent: number;
}

/** The quiz baseline's three states on the card, a view word each, never a refusal. */
export const LANE_ARM_QUIZ_STATES = ['recorded', 'not-yet', 'unreadable'] as const;
export type LaneArmQuizState = (typeof LANE_ARM_QUIZ_STATES)[number];
export function isLaneArmQuizState(v: unknown): v is LaneArmQuizState {
  return typeof v === 'string' && (LANE_ARM_QUIZ_STATES as readonly string[]).includes(v);
}

/** The card's quiz block: the baseline (recorded with its date, not yet, or a read that failed, never folded into "not yet")
 *  and the pending runs, oldest first (or why they could not be read). */
export interface LaneArmQuizView {
  baseline:
    | { state: Extract<LaneArmQuizState, 'recorded'>; at: number }
    | { state: Extract<LaneArmQuizState, 'not-yet'> }
    | { state: Extract<LaneArmQuizState, 'unreadable'>; detail: string };
  pending: { ok: true; runs: LaneArmQuizPending[] } | { ok: false; detail: string };
}

/** `GET /api/coord/lane-arm`'s answer (and a POST's, read after the write): every row, in `LANE_ARM_LANES` order, and the
 *  replay quiz's block. `quizBaseline` is additive: an older server sends none, and the card then shows no block. */
export interface LaneArmView { lanes: LaneArmRowView[]; quizBaseline?: LaneArmQuizView }

/** `POST /api/coord/lane-arm`'s body: one row's choice, plus `confirm` only as the key a 409 `confirm-required` answered
 *  with. Shadow never needs one. */
export interface LaneArmRequest { lane: LaneArmLane; choice: LaneArmChoice; confirm?: string }

/** The 409 the POST answers to a Live with no key, or with a key the row no longer matches: the facts the server read
 *  and the key that binds them. The PWA opens its confirm sheet from these and sends the key back. */
export interface LaneArmConfirmRequired {
  ok: false;
  error: 'confirm-required';
  lane: LaneArmLane;
  confirmKey: string;
  facts: { stored: LaneArmRowView['stored']; updatedAt: number | null; shadowLog: string | null };
}

/** The words the POST refuses with (each a word of `REFUSAL_STATUS`), spelled once for the PWA's reader. `lane-gated` is the
 *  card's own (review 2003 F3): Live refused while the row's gate stands (`laneArmGate`). `baseline-missing` is the replay
 *  quiz's (W1a, W0-28): Live refused on a W1a row until the quiz's baseline is recorded. */
export const LANE_ARM_REFUSALS = ['bad-request', 'not-configured', 'sign-in-unarmed', 'state-unreadable', 'lane-gated', 'baseline-missing'] as const;
export type LaneArmRefusal = (typeof LANE_ARM_REFUSALS)[number];
export function isLaneArmRefusal(v: unknown): v is LaneArmRefusal {
  return typeof v === 'string' && (LANE_ARM_REFUSALS as readonly string[]).includes(v);
}

/** A row's GATE (review 2003 F3): while it stands, Live is refused at the door (`lane-gated`) and the card says why. Null
 *  for a row that can go live. The words are the gate: a row is gated exactly when it has them. */
export function laneArmGate(lane: LaneArmLane): string | null {
  return LANE_ARM_TEXT.rows[lane].gate;
}

/** Is a row live? Only on an exact stored `live` while its gate is open (review 2006 N1): a row stored `live` before its
 *  gate stood is not. The one rule the lanes, the server's view and the card read. */
export function laneArmLive(stored: string, gate: string | null): boolean {
  return stored === 'live' && gate === null;
}

/** The feed row's title when a row changes, and when the import sets a row Live. */
export const LANE_ARM_FEED_TITLE = { changed: 'shadow lane changed', imported: 'shadow lane marker imported' } as const;

/** The card's words. One sentence each; nothing in the PWA retypes one. */
export const LANE_ARM_TEXT = {
  title: 'Shadow lanes',
  purpose: 'Lanes that ship in shadow: each records what it would do until you set it live here, after reading its record.',
  shadow: 'Shadow',
  live: 'Live',
  rows: {
    [ROSTER_CARD_LANE]: {
      legend: 'Roster card',
      shadowNote: 'After a compaction, resume or clear, and on its first wake after an idle compaction, a coordinator '
        + 'gets no roster; the card it would have had is appended to the shadow log on the fleet box.',
      liveNote: 'After a compaction, resume or clear, and on its first wake after an idle compaction, a coordinator\'s '
        + 'context lists the open runs it claims and what is awaiting you.',
      gate: null,
    },
    [CONTINUITY_LANE]: {
      legend: 'Renew long-lived sessions',
      shadowNote: 'Each start of a coordinator mints a generation and every pass records whether a renewal would be due; '
        + 'nothing is held, refused or renewed.',
      liveNote: 'A coordinator that is due renews: its mail is held, it writes a handover note, ccd starts it fresh in the '
        + 'same session, and it reads its card and answers its probes before its mail is released. One that cannot is '
        + 'left working and raises an item.',
      gate: null,
    },
    [LAUNCH_PROFILE_LANE]: {
      legend: 'Launch profiles',
      shadowNote: 'Each pass counts the route writes that would give each session its role\'s launch profile, and the server '
        + 'logs them; no route is written and no launch changes.',
      liveNote: 'Each session\'s route names its role\'s launch profile: from its next launch, auto memory is off for every '
        + 'role but plain sessions, which follow their Settings row. Nothing is deleted, and no compaction setting moves '
        + 'until the renewal lane is live too.',
      gate: null,
    },
    [ANCHOR_SLOT_LANE]: {
      legend: 'Anchor at every start',
      shadowNote: 'The server renders the anchor each start would get and logs its size to the server journal, as lines '
        + 'beginning "ccrc-server: anchor-slot shadow:"; every session still starts with today\'s role card, a fork '
        + 'included, and nothing is added after a compaction.',
      liveNote: 'Each start of a session that is not a child begins with its anchor (its role, its canaries and counts, '
        + 'and to read its card) in place of the role card; a fork gets one line saying it has no card, and the first '
        + 'prompt after an automatic compaction carries the anchor once.',
      gate: null,
    },
    [CAP_COUNTS_WORKING_LANE]: {
      legend: 'Count only working workers',
      shadowNote: 'The workers cap counts every active run, as before. The caps control also says how many of them have a '
        + 'worker waiting (quiet 30 minutes with nothing running) or asleep, and a dispatch the cap refuses that those would '
        + 'have let through is logged to the server journal, as lines beginning "ccrc-server: cap-counts-working shadow:".',
      liveNote: 'A run whose worker is waiting or asleep holds no slot under the workers cap; the slots this frees are handed '
        + 'out a few at a time, and a send-back or resume to a live or sleeping worker is never refused at the cap. A worker '
        + 'that wakes counts again at once.',
      gate: null,
    },
  },
  shadowLog: (path: string): string => `Shadow record: ${path} on the fleet box. Read it before going live.`,
  importedLive: (marker: string): string => `Set Live at the upgrade because the ${marker} file stood; that file is no longer read and can be removed.`,
  importedKept: (marker: string): string => `The ${marker} file stood at the upgrade, but this row had already been set here, so it was kept; that file is no longer read and can be removed.`,
  unknown: 'The server holds a value this build does not know, so the lane stays in shadow. Choose one to set it.',
  absent: 'The server has no row for this lane, so it stays in shadow. Choose one to set it.',
  unreadable: 'The server could not read this row, so the lane stays in shadow.',
  stale: 'This card could not be refreshed; it shows the last answer it had.',
  unread: 'The server did not answer, so this card cannot say which lanes are live.',
  confirmTitle: 'Set this lane live?',
  confirmLabel: 'Go live',
  confirmLines: (legend: string, shadowLog: string | null): string[] => [
    `${legend} stops recording in shadow and acts from its next event.`,
    ...(shadowLog === null ? [] : [`Its shadow record is ${shadowLog} on the fleet box; read it first if you have not.`]),
    'Shadow sets it back at any time.',
  ],
  refused: 'The server refused the change',
  unanswered: 'The server did not answer; the change may or may not have been made',
  signInUnarmed: 'Going live needs a signed-in operator, and sign-in is not armed on this server.',
  baselineMissing: 'This lane goes live only after the replay quiz\'s baseline is recorded, so a later change can be compared '
    + 'with it; the baseline is the first quiz run recorded while every one of these lanes is in shadow.',
  baselineUnreadable: 'The server could not read whether the replay quiz\'s baseline is recorded',
  quizBaseline: {
    recorded: (date: string): string => `Replay quiz baseline: recorded ${date}`,
    notYet: 'Replay quiz baseline: not yet',
    unreadable: 'Replay quiz baseline: could not be read',
  },
  quizPending: (measured: string, recorded: string, r: LaneArmQuizPending): string => `Replay quiz run ${r.id}, report sha `
    + `${r.reportShaPrefix}, recorded ${recorded} by ${r.recordedBy}; the arms ran ${measured}: score ${r.score.toFixed(2)} `
    + `(${r.lo.toFixed(2)} to ${r.hi.toFixed(2)}), ${r.questions} questions over ${r.families} families, ${r.answered} answered, `
    + `${r.runFailed} failed to run, ${r.absent} absent`,
  quizPendingUnreadable: 'The server could not read the replay quiz runs waiting for you',
  quizConfirm: 'Confirm',
  quizDiscard: 'Discard',
  quizRuleNote: 'Before you confirm, match the run\'s report sha with the one report and ccrc quiz-record printed, and '
    + 'discard any run you did not record. Confirm counts the run; the first one confirmed while every W1a lane is in shadow '
    + 'becomes the baseline. Discard keeps the row and never counts it.',
} as const;
