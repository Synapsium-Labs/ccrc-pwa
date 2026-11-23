// One collapsed row per stretch of a turn's tool activity (desktop polish wave 168, chat readability part 1).
//
// WHAT IT IS. A pure fold over the items `buildChatItems` produces, ABOVE `groupToolRun`: each maximal stretch of
// consecutive tool entries becomes one `tool-activity` item, a disclosure row that reads "Tool activity · N calls" with
// the stretch's running state and its latest call's one-line summary (`toolSummary`). Inside it, the skin's own grouping
// runs unchanged (`groupToolRun` for a set that folds tool runs, the plain entries otherwise), so an expanded stretch
// shows exactly what the transcript showed before.
//
// PER STRETCH, NOT PER TURN (`docs/superpowers/programs/desktop-polish/chat-readability.md`). A turn's prose stays
// visible, in order, outside every disclosure, so one disclosure for a whole turn would have to stand either above
// prose that followed some of its calls or below prose that preceded them: either reorders the chronology. A stretch
// ends at anything that is not a tool entry (assistant prose, a user prompt, a mail or task card, a divider, a pending
// send, the working pulse), so every item keeps its place.
//
// NOTHING THAT WANTS THE READER IS HIDDEN. Unlike `groupToolRun`, a failed call, an open question or a call waiting on
// the reader's approval does not end a stretch: it sits inside it in order, and it is listed on the item's `attention`,
// which the row surfaces while collapsed (a count, and the first such entry drawn as its own actionable card).
//
// L1: pure, no I/O, no React.
import type { ChatItem } from './chatItems';
import { groupToolRun, toolSummary, type RunItem } from './toolSummary';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** Why an entry of a stretch wants the reader: its call failed, or it is the question the session is asking now. */
export type AttentionKind = 'failed' | 'question';

export interface Attention {
  readonly kind: AttentionKind;
  readonly entry: ToolItem;
}

/** One stretch of a turn's tool activity, folded into one transcript row. */
export interface ToolActivityItem {
  kind: 'tool-activity';
  /** `activity-<first entry's key>`: stable while the stretch grows, so a row's expansion is kept as calls arrive. */
  key: string;
  /** Every tool entry of the stretch, in transcript order. */
  entries: ToolItem[];
  /** What the row shows expanded: the entries under the skin's own grouping, in order. */
  inner: RunItem[];
  /** The session is working, this stretch is in the CURRENT turn (after the last user prompt), and one of its calls has
   *  no result yet, whichever of them it is (parallel calls finish out of order). A resultless call of an earlier turn
   *  is never running. */
  live: boolean;
  /** The newest entry's one-line summary (`toolSummary`). */
  latest: string;
  /** The entries that want the reader: the question the session is asking now first, then the failures, each in
   *  transcript order. */
  attention: Attention[];
  /** The session holds a live ask or dialog that no card is identified as (an approval, a dialog, or a question this
   *  turn does not single out). Set on the newest stretch of the current turn only, which draws it as a line of its own
   *  with the transcript's answer control. */
  waiting: boolean;
}

/** What a transcript renders: plain items, folded runs, and stretches of a turn's tool activity folded into one row,
 *  whose expansion holds the first two. Declared here, not in `toolSummary.ts`, so the two L1 modules import one way. */
export type TranscriptItem = RunItem | ToolActivityItem;

/** What the fold reads besides the items: the set's inner grouping, whether the session holds a live ask or dialog
 *  (`askSource`, the one decider; the screen's `askPending`), and whether it is working a turn (the list's `busy`). */
export interface ActivityFold {
  readonly runs: 'tool-runs' | 'none';
  readonly askPending: boolean;
  readonly busy: boolean;
}

const ASK = 'AskUserQuestion';

/** A user prompt: what starts a turn. A user message, or mail typed into the pane as one (the legacy mail lane). */
function isPrompt(item: ChatItem): boolean {
  return (item.kind === 'message' || item.kind === 'mail') && item.event.kind === 'user';
}

const failed = (e: ToolItem): boolean => e.result != null && e.result.isError === true;

/** Fold each stretch of consecutive tool entries into one `tool-activity` item. Every other item passes through
 *  untouched, in order.
 *
 *  WHAT IS LIVE IS THE CURRENT TURN'S. The turn the session is in starts after the last user prompt; nothing before it
 *  runs, waits or holds a live control, whatever its calls lack.
 *
 *  A LIVE ASK OR DIALOG IS TIED TO A CARD ONLY WHEN THE TRANSCRIPT SINGLES ONE OUT. The live state (`askPending`) says
 *  that the session waits, not on which call: an approval names a tool, never a call, so no card is inferred for it.
 *  The one card it singles out is a question: the current turn's only AskUserQuestion with no result, whose own card
 *  carries Answer into the same sheet. Every other wait is the current turn's newest row's `waiting` line, and with no
 *  row in the current turn yet (a new prompt before its first call) the transcript draws none: the session's own
 *  surfaces carry it. So one live wait is drawn once, never twice. */
export function foldToolActivity(items: readonly ChatItem[], fold: ActivityFold): (ChatItem | ToolActivityItem)[] {
  let turnStart = 0;
  items.forEach((item, i) => { if (isPrompt(item)) turnStart = i + 1; });
  const openAsks: ToolItem[] = [];
  let newestCurrent = -1; // the index of the current turn's newest tool entry
  for (let i = turnStart; i < items.length; i += 1) {
    const item = items[i]!;
    if (item.kind !== 'tool') continue;
    newestCurrent = i;
    if (item.use.name === ASK && item.result == null) openAsks.push(item);
  }
  const question = fold.askPending && openAsks.length === 1 ? openAsks[0]! : null;
  const waitingRow = fold.askPending && question === null;

  const out: (ChatItem | ToolActivityItem)[] = [];
  let stretch: ToolItem[] = [];
  let from = 0; // the index of the stretch's first entry
  const close = (to: number): void => {
    const first = stretch[0];
    const last = stretch[stretch.length - 1];
    if (first === undefined || last === undefined) return;
    const current = from >= turnStart;
    const attention: Attention[] = [
      ...stretch.filter((e) => e === question).map((entry) => ({ kind: 'question' as const, entry })),
      ...stretch.filter(failed).map((entry) => ({ kind: 'failed' as const, entry })),
    ];
    out.push({
      kind: 'tool-activity',
      key: `activity-${first.key}`,
      entries: stretch,
      inner: fold.runs === 'tool-runs' ? groupToolRun(stretch) : [...stretch],
      live: fold.busy && current && stretch.some((e) => e.result == null),
      latest: toolSummary(last).sentence,
      attention,
      // The stretch holding the current turn's newest call; no stretch spans a prompt, so it is in the current turn.
      waiting: waitingRow && newestCurrent >= from && newestCurrent < to,
    });
    stretch = [];
  };
  items.forEach((item, i) => {
    if (item.kind === 'tool') {
      if (stretch.length === 0) from = i;
      stretch.push(item);
      return;
    }
    close(i);
    out.push(item);
  });
  close(items.length);
  return out;
}

/** The words of an attention count, by kind, in this order: what the reader can act on now before the failures. */
const ATTENTION_WORDS: Readonly<Record<AttentionKind, (n: number) => string>> = {
  question: (n) => (n === 1 ? '1 question' : `${n} questions`),
  failed: (n) => `${n} failed`,
};
const ATTENTION_ORDER = Object.keys(ATTENTION_WORDS) as AttentionKind[];

/** The row's flag for a live wait no card is identified as. */
export const WAITING_FLAG = 'waiting on you';

/** The line a `waiting` row draws: the session waits on the reader, and the transcript says so without naming a call it
 *  cannot identify. With the answer surface mounted below the transcript (the desk), it says where. */
export function waitWord(askBelow: boolean): string {
  return askBelow ? 'waiting for you, below' : 'waiting for you';
}

/** The control on that line: it raises the answer sheet (the pending ask or dialog, whichever it is), or with the
 *  answer surface below the transcript it takes the reader there. It answers nothing itself. */
export function waitControlWord(askBelow: boolean, answerLabel: string | undefined): string {
  return askBelow ? 'Go to the prompt' : (answerLabel ?? 'Answer');
}

/** What a tool-activity row says, in words both skins draw. */
export interface ActivityWords {
  /** "Tool activity". */
  readonly title: string;
  /** "1 call", "5 calls". */
  readonly calls: string;
  /** "running" while the stretch is live, else null. */
  readonly state: string | null;
  /** The newest call's one-line summary. */
  readonly latest: string;
  /** A flag per thing that wants the reader, what can be acted on now first: the live wait no card is identified as
   *  ("waiting on you"), then one count per kind ("1 question", "1 failed"). Empty when nothing does. */
  readonly attention: readonly string[];
}

export function activityWords(item: ToolActivityItem): ActivityWords {
  const n = item.entries.length;
  const counts = new Map<AttentionKind, number>();
  for (const a of item.attention) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  return {
    title: 'Tool activity',
    calls: n === 1 ? '1 call' : `${n} calls`,
    state: item.live ? 'running' : null,
    latest: item.latest,
    attention: [
      ...(item.waiting ? [WAITING_FLAG] : []),
      ...ATTENTION_ORDER.flatMap((k) => {
        const c = counts.get(k);
        return c === undefined ? [] : [ATTENTION_WORDS[k](c)];
      }),
    ],
  };
}
