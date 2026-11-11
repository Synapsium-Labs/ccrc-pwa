// Advanced, "What ccrc closes on its own" (the runs rebuild, Task 26, D-8077; spec 2026-11-04 §8.6 item 2, §12.3, o7, o12). Pure
// (L1): the wire guard for `GET /api/coord/run-close`, the state words, the count sentence a row and the Turn on sheet share, the
// controls a row offers, the reason and hold words. The clock is an argument, so nothing here reads the time or the network.
import {
  RUN_CLOSE_CHOICES, RUN_CLOSE_GROUPS, RUN_CLOSE_HELD, RUN_CLOSE_WHY, runCloseListOf,
  type RunCloseChoice, type RunCloseGroup, type RunCloseGroupView, type RunCloseHeld, type RunCloseNamed, type RunCloseState,
  type RunCloseView, type RunCloseWhy, type RunCloseWould,
} from '../../../shared/run-close';
import { isRecord } from '../lib/wire';
import { closeWhen } from '../fleet/stuckWords';

/** The screen's words (§8.6 item 2). */
export const RUN_CLOSE_WORDS = {
  heading: 'What ccrc closes on its own',
  loading: 'Reading the lanes…',
  failed: 'Could not read what ccrc closes on its own. Try again.',
  tryAgain: 'Try again',
  turnOn: 'Turn on',
  turnOff: 'Turn off',
  backToShadow: 'Back to shadow',
  sheetTitle: 'Let ccrc close these on its own?',
  keepShadow: 'Keep it in shadow',
  notClosing: 'Not in this list',
  noneWould: 'No run would close.',
  noList: 'This group closes the runs of a coordinator that crashed, one coordinator at a time. The Feed records each one it would end.',
  noListYet: 'ccrc has not read this group yet. Try again in a minute.',
  writeFailed: 'Could not change this. Try again.',
  pausedWhy: 'Turning on is disabled while the lanes are held.',
  offWhy: 'Put it back in shadow first, to see what would close.',
  markerNote: 'A marker on the box arms this group. It overrides this control.',
} as const;

/** Each group's heading. */
export const RUN_CLOSE_GROUP_TITLE: Readonly<Record<RunCloseGroup, string>> = {
  'never-started': 'Planned waves that never started',
  'claimant-crashed': 'Runs of a coordinator that crashed',
  'claimant-gone': 'Runs of a coordinator that was removed or stopped',
};

/** The state word a row shows. */
export const RUN_CLOSE_STATE_WORD: Readonly<Record<RunCloseState, string>> = {
  off: 'Off', shadow: 'Shadow', on: 'On', held: 'Held',
};

/** What each state means, in one sentence. */
export const RUN_CLOSE_STATE_NOTE: Readonly<Record<RunCloseState, string>> = {
  off: 'ccrc reads nothing and closes nothing here.',
  shadow: 'ccrc records what it would close and closes nothing.',
  on: 'ccrc warns the coordinator where it should, and closes these runs on its own.',
  held: 'Nothing is read or closed while the lanes are held.',
};

/** Why a row is held (o12). */
export const RUN_CLOSE_HELD_WORD: Readonly<Record<RunCloseHeld, string>> = {
  [RUN_CLOSE_HELD.coordination]: 'Held while coordination is paused.',
  [RUN_CLOSE_HELD.reclaim]: 'Held while cleanup is paused.',
  [RUN_CLOSE_HELD.registry]: 'Held: the box registry could not be read.',
};

/** Why a run would close, by the lane's own reasons. */
export const RUN_CLOSE_WHY_WORD: Readonly<Record<RunCloseWhy, string>> = {
  [RUN_CLOSE_WHY.neverStarted]: 'Planned, nothing started, and the programme is quiet',
  [RUN_CLOSE_WHY.reviewOfClosed]: 'A review of work that is already closed',
  [RUN_CLOSE_WHY.laterReview]: 'A review overtaken by a later review',
  [RUN_CLOSE_WHY.claimantCrashed]: 'Its coordinator crashed',
  [RUN_CLOSE_WHY.claimantGone]: 'Its coordinator was removed',
  [RUN_CLOSE_WHY.claimantStopped]: 'Its coordinator was stopped by a person',
  [RUN_CLOSE_WHY.nameReused]: 'Its session now belongs to a later run',
};

/** Why the lane would not close a run the row fits (its words), as a clause after the run's name. */
const NAMED_WORD: Readonly<Record<string, string>> = {
  'live-session': 'it has a live session, so check it before you turn this on',
  'open-pr': 'its branch has an open pull request',
  'unpushed-commits': 'its branch has commits that are not pushed',
  'unmeasured': 'ccrc could not measure it',
  'busy-worker': 'its worker is still running, so it comes to you as Open the worker',
  'breaker-held': 'its coordinator went away together with another, so ccrc leaves it for you',
  'child-marker-unreadable': 'its workspace marker could not be read',
  'coordinator-not-reached': 'its coordinator cannot be reached, so the warning is never delivered, and it comes to you as Open the coordinator',
  'warning-undelivered': 'its warning has gone 24 hours undelivered, so it comes to you as Open the coordinator',
};
export const namedWord = (why: string): string => NAMED_WORD[why] ?? 'ccrc would not close it';

/** The count a row and the sheet both say: "14 runs would close, 11 now and 3 when their time runs out." */
export function runCloseCountLine(would: number, now: number): string {
  if (would === 0) return RUN_CLOSE_WORDS.noneWould;
  const later = would - now;
  const runs = would === 1 ? '1 run would close' : `${would} runs would close`;
  if (later === 0) return `${runs} now.`;
  if (now === 0) return `${runs} when ${would === 1 ? 'its' : 'their'} time runs out.`;
  return `${runs}, ${now} now and ${later} when their time runs out.`;
}

/** "closes now" or "closes in 5 h": one run's clock, A36's form. */
export function runCloseWhen(at: number, nowMs: number): string {
  const when = closeWhen(at, nowMs);
  return when === null ? 'closes now' : `closes ${when}`;
}

/** The controls a row offers, from its choice and state. `enabled` false is a disabled button with `why`. The marker's note
 *  replaces them all: a marker overrides the row, so a control would promise what it cannot do. */
export interface RunCloseControl { readonly choice: RunCloseChoice; readonly label: string; readonly enabled: boolean; readonly why: string | null }
export function runCloseControls(g: RunCloseGroupView): readonly RunCloseControl[] {
  if (g.marker === 'set') return [];
  const held = g.state === 'held';
  const turnOn = (): RunCloseControl => ({
    choice: 'on', label: RUN_CLOSE_WORDS.turnOn, enabled: !held && g.choice !== 'off',
    why: held ? RUN_CLOSE_WORDS.pausedWhy : g.choice === 'off' ? RUN_CLOSE_WORDS.offWhy : null,
  });
  const turnOff: RunCloseControl = { choice: 'off', label: RUN_CLOSE_WORDS.turnOff, enabled: true, why: null };
  const shadow: RunCloseControl = { choice: 'shadow', label: RUN_CLOSE_WORDS.backToShadow, enabled: true, why: null };
  if (g.choice === 'on') return [turnOff, shadow];
  if (g.choice === 'off') return [turnOn(), shadow];
  return [turnOn(), turnOff];
}

/** The last 7 days, in one line. */
export const runCloseTally = (g: RunCloseGroupView): string =>
  `Last 7 days: ${g.closed7d} closed, ${g.refused7d} refused.`;

// ── the wire guard ───────────────────────────────────────────────────────────────────────────────────────────

const knownWhy = (why: unknown): boolean => (Object.values(RUN_CLOSE_WHY) as unknown[]).includes(why);
const isWould = (v: unknown): v is RunCloseWould => isRecord(v) && typeof v.runId === 'number' && typeof v.program === 'string'
  && typeof v.at === 'number' && typeof v.why === 'string';
const isNamed = (v: unknown): v is RunCloseNamed => isRecord(v) && typeof v.runId === 'number' && typeof v.program === 'string' && typeof v.why === 'string';

/** The server's view, or null when the answer is not one. Version skew (a newer server, an older cached build): a group or a `why`
 *  this build does not know is SKIPPED, never an error, so the groups it does know keep their controls. */
export function asRunCloseView(raw: unknown, nowMs: number): RunCloseView | null {
  if (!isRecord(raw) || !Array.isArray(raw.groups)) return null;
  const groups: RunCloseGroupView[] = [];
  for (const g of raw.groups as unknown[]) {
    if (!isRecord(g)) return null;
    if (typeof g.group === 'string' && !(RUN_CLOSE_GROUPS as readonly string[]).includes(g.group)) continue;
    if (!(RUN_CLOSE_GROUPS as readonly string[]).includes(g.group as string) || !(RUN_CLOSE_CHOICES as readonly string[]).includes(g.choice as string)) return null;
    if (!['off', 'shadow', 'on', 'held'].includes(g.state as string) || !['set', 'clear', 'unmeasurable'].includes(g.marker as string)) return null;
    if (typeof g.closed7d !== 'number' || typeof g.refused7d !== 'number') return null;
    let list: RunCloseGroupView['list'] = null;
    if (g.list !== null) {
      if (!isRecord(g.list) || !Array.isArray(g.list.would) || !Array.isArray(g.list.named)) return null;
      if (!g.list.would.every(isWould) || !g.list.named.every(isNamed)) return null;
      list = runCloseListOf(g.list.would.filter((w) => knownWhy(w.why)), g.list.named, nowMs);
    }
    groups.push({
      group: g.group as RunCloseGroup, choice: g.choice as RunCloseChoice, marker: g.marker as RunCloseGroupView['marker'],
      state: g.state as RunCloseState, held: (g.held ?? null) as RunCloseHeld | null, list,
      closed7d: g.closed7d, refused7d: g.refused7d, updatedAt: typeof g.updatedAt === 'number' ? g.updatedAt : null,
    });
  }
  return { groups };
}
