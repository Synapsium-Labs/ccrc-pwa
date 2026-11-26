// "Since you were last here" (Overlord W1 home B, Task 6; spec 2026-11-09 §4.1, Table 4.1b; plan question 8, slug
// `since-block-reads-server-rows`): L1, pure (context C5, the `overlord/**` row). A decider in the console composes the block's lines from the
// server's own rows, so a quiet Overlord cannot make the operator's view quiet; W3's lines move the block to a server
// composition. `now` is an argument and nothing here reads a clock, a store or `lib/api.ts`.
//
// WHAT W1 FILLS, from the two reads the console already makes:
//   Needs you             what waits now: `GET /api/waiting`'s open items and its parked approvals. The Waiting door's own
//                         number also counts sessions' questions, which this read does not carry.
//   Changed that matters  the runs closed (`GET /api/programmes?since=`'s `closedToday`, counted from the `since` the server
//                         APPLIED, which it says in `appliedSince` and which may differ from the stamp asked: the line is worded
//                         by the window applied, and an answer without the field draws no count) and one line per programme that read shows stalled (`stuck`).
//
// AN UNMEASURED READER SAYS SO (§4.1): a read that failed is `unmeasured` on each line it feeds, never `quiet` and never 0.
// A measured zero says what is true ("nothing waiting on you"); the parked approvals are part of that zero, so an answer without
// its `approvals` field (their read failed) says "parked approvals not read" and never "nothing waiting". A programme whose stuck pass has not run (no `stuck` field while
// it has open waves) is one `unmeasured` line, never a programme that is not stalled.
//
// ORDER AND CAP: the lines sort by Table 4.1b's `SINCE_ORDER` (a stable sort, so a section keeps the order its lines were built
// in), and at most `SINCE_MAX_LINES` are answered. A block longer than that keeps its first six lines and says how many more
// there are, so the cap never hides a line without saying so.
import { waitingCount, type WaitingView } from '../../../shared/ledgers';

/** The cap on the block (§4.1). */
export const SINCE_MAX_LINES = 7;
/** A device with no stamp reads this far back (§4.1). */
export const SINCE_DEFAULT_WINDOW_MS = 24 * 3_600_000;
/** What a line says when its read failed. */
export const UNMEASURED_TEXT = 'unmeasured';

/** Table 4.1b's sections, named once. W1 fills `needs-you` and `changed`. */
export type SinceSection = 'needs-you' | 'changed' | 'missed' | 'overturnable' | 'trust' | 'routine';
/** Table 4.1b's order. */
export const SINCE_ORDER: Readonly<Record<SinceSection, number>> = {
  'needs-you': 1, changed: 2, missed: 3, overturnable: 4, trust: 5, routine: 6,
};
export const SINCE_LABEL: Readonly<Record<SinceSection, string>> = {
  'needs-you': 'Needs you',
  changed: 'Changed that matters',
  missed: 'Should have happened and did not',
  overturnable: 'Can still be overturned cheaply',
  trust: 'The trust line',
  routine: 'Routine',
};
/** Where the block's window comes from, in words. */
export const SINCE_WINDOW_WORDS = { stamped: 'since you were last here', default: 'in the last 24 hours' } as const;

/** One read's state for this block: an answer with its value, or a failure. Never a `null`. */
export type SinceRead<T> = { readonly state: 'answered'; readonly value: T } | { readonly state: 'failed' };

export type SinceWaiting = Pick<WaitingView, 'items' | 'approvals'>;
/** What `GET /api/programmes`'s answer is read for. `stuck` is the number of the programme's stuck runs; absent before the
 *  stuck pass has run. */
export interface SinceProgrammes {
  readonly closedToday: { readonly operator: number; readonly sweep: number; readonly coordinator: number };
  /** The `since` the server counted `closedToday` from, epoch ms; absent from an older server. */
  readonly appliedSince?: number;
  readonly programmes: readonly {
    readonly slug: string; readonly title: string; readonly stuck?: number;
    readonly waves: { readonly working: number; readonly waiting: number; readonly queued: number };
  }[];
}
export interface SinceFacts { readonly waiting: SinceRead<SinceWaiting>; readonly programmes: SinceRead<SinceProgrammes> }

export interface SinceLine {
  /** Unique in a block. */
  readonly key: string;
  readonly section: SinceSection;
  readonly label: string;
  /** Session-written text can be in it (a programme's title): draw it as text. */
  readonly text: string;
  /** False for a line whose read failed. */
  readonly measured: boolean;
}

/** Whether the device's stamp can be used: there is one, and it is not ahead of the clock (a stamp from the future is a
 *  clock that moved, and proves nothing about what the operator has seen). */
const usable = (lastHereMs: number | null, nowMs: number): lastHereMs is number => lastHereMs !== null && lastHereMs <= nowMs;

/** The instant the block reads from: the stamp, or the last 24 hours when the device has none. */
export function sinceOf(lastHereMs: number | null, nowMs: number): number {
  return usable(lastHereMs, nowMs) ? lastHereMs : nowMs - SINCE_DEFAULT_WINDOW_MS;
}

const APPROVALS_NOT_READ = 'parked approvals not read';
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const unmeasured = (section: SinceSection, key: string): SinceLine =>
  ({ key, section, label: SINCE_LABEL[section], text: UNMEASURED_TEXT, measured: false });
const measured = (section: SinceSection, key: string, text: string): SinceLine =>
  ({ key, section, label: SINCE_LABEL[section], text, measured: true });

function needsYouLines(read: SinceRead<SinceWaiting>): SinceLine[] {
  if (read.state === 'failed') return [unmeasured('needs-you', 'needs-you')];
  const { items, approvals } = read.value;
  const open = waitingCount(items);
  // The parked approvals are absent from the answer when their read failed, and the place draws only under `overlord-v1`, so no
  // older server explains the absence: it is unmeasured, never zero. The items count stays measured.
  if (approvals === undefined) {
    return [measured('needs-you', 'needs-you', open === 0 ? `no open items; ${APPROVALS_NOT_READ}` : `${plural(open, 'item', 'items')} waiting on you; ${APPROVALS_NOT_READ}`)];
  }
  const n = open + approvals.length;
  return [measured('needs-you', 'needs-you', n === 0 ? 'nothing waiting on you' : `${plural(n, 'item', 'items')} waiting on you`)];
}

/** The window the programmes read counted over, in words. The server holds the asked `since` to a window of its own and says which
 *  it applied (`appliedSince`): the one reader of that field. Same as the asked window, the words the block always used; a different
 *  one is worded by the window applied, its length read off the two numbers (the server's bound is never written here); a window
 *  with no length is `none`, and an answer without the field (an older server) is `unknown`: never the asked window, never zero. */
type CountedWindow = { readonly kind: 'words'; readonly words: string } | { readonly kind: 'none' } | { readonly kind: 'unknown' };

/** An applied window shorter than this has no length worth counting over: the server's own `now` is at most a clock's skew from ours. */
const NO_WINDOW_MS = 60_000;
const MINUTE_MS = 60_000;

function countedWindow(applied: number | undefined, asked: number, askedWords: string, nowMs: number): CountedWindow {
  if (applied === undefined || !Number.isFinite(applied)) return { kind: 'unknown' };
  if (applied === asked) return { kind: 'words', words: askedWords };
  const lengthMs = nowMs - applied;
  if (lengthMs < NO_WINDOW_MS) return { kind: 'none' };
  const minutes = Math.round(lengthMs / MINUTE_MS);
  return { kind: 'words', words: `in the last ${minutes % 60 === 0 || minutes >= 120 ? plural(Math.round(minutes / 60), 'hour', 'hours') : plural(minutes, 'minute', 'minutes')}` };
}

function closedLine(win: CountedWindow, closed: number): SinceLine {
  const label = SINCE_LABEL.changed;
  if (win.kind === 'unknown') return { key: 'closed', section: 'changed', label, text: 'runs closed: the window counted is unknown', measured: false };
  if (win.kind === 'none') return { key: 'closed', section: 'changed', label, text: 'no window to count runs closed in', measured: false };
  return measured('changed', 'closed', closed === 0 ? `no run closed ${win.words}` : `${plural(closed, 'run', 'runs')} closed ${win.words}`);
}

function changedLines(read: SinceRead<SinceProgrammes>, asked: number, askedWords: string, nowMs: number): SinceLine[] {
  if (read.state === 'failed') return [unmeasured('changed', 'closed'), unmeasured('changed', 'stalled')];
  const { closedToday: c, programmes } = read.value;
  const out: SinceLine[] = [
    closedLine(countedWindow(read.value.appliedSince, asked, askedWords, nowMs), c.operator + c.sweep + c.coordinator),
  ];
  const stalled = programmes.filter((p) => (p.stuck ?? 0) > 0);
  for (const p of stalled) {
    out.push(measured('changed', `stalled:${p.slug}`, `${p.title === '' ? p.slug : p.title} stalled: ${plural(p.stuck ?? 0, 'run', 'runs')} stuck`));
  }
  const unread = programmes.filter((p) => p.stuck === undefined && p.waves.working + p.waves.waiting + p.waves.queued > 0);
  if (unread.length > 0) out.push(unmeasured('changed', 'stalled-unmeasured'));
  else if (stalled.length === 0) out.push(measured('changed', 'stalled', 'no programme stalled'));
  return out;
}

/** The block: at most `SINCE_MAX_LINES` lines in Table 4.1b's order. `lastHereMs` is this device's stamp, `null` for none. */
export function sinceLines(facts: SinceFacts, lastHereMs: number | null, nowMs: number): readonly SinceLine[] {
  const askedWords = usable(lastHereMs, nowMs) ? SINCE_WINDOW_WORDS.stamped : SINCE_WINDOW_WORDS.default;
  // Built out of table order on purpose: the sort below, not the building, is what puts a line in Table 4.1b's place.
  const built = [...changedLines(facts.programmes, sinceOf(lastHereMs, nowMs), askedWords, nowMs), ...needsYouLines(facts.waiting)];
  const ordered = built.sort((a, b) => SINCE_ORDER[a.section] - SINCE_ORDER[b.section]);
  if (ordered.length <= SINCE_MAX_LINES) return ordered;
  const shown = ordered.slice(0, SINCE_MAX_LINES - 1);
  // The count stands for the lines it hides, so it takes the section of the first of them: the order above holds (the shown
  // lines sort at or before it) and it reads beside what it hides, never as a routine line.
  const hidden = ordered[shown.length]!;
  return [...shown, measured(hidden.section, 'more', `${ordered.length - shown.length} more not shown`)];
}
