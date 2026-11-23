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

/** Why an entry of a stretch wants the reader: its call failed, it is a question still open, or it is the call the
 *  session is holding for the reader's approval. */
export type AttentionKind = 'failed' | 'question' | 'approval';

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
  /** The stretch is the newest one and holds a call with no result yet. */
  live: boolean;
  /** The newest entry's one-line summary (`toolSummary`). */
  latest: string;
  /** The entries that want the reader: those that block the session first, then the failures, each in transcript order. */
  attention: Attention[];
}

/** What the fold reads besides the items: the set's inner grouping, and whether the session holds a live ask or
 *  dialog (`askSource`, the one decider; the screen's `askPending`). */
export interface ActivityFold {
  readonly runs: 'tool-runs' | 'none';
  readonly askPending: boolean;
}

const ASK = 'AskUserQuestion';

/** Why an entry wants the reader, or null. `waiting` is the key of the call the session's live ask or dialog belongs
 *  to: the newest tool entry, while it has no result. */
function attentionOf(entry: ToolItem, waiting: string | null): AttentionKind | null {
  if (entry.result != null && entry.result.isError === true) return 'failed';
  if (entry.result != null) return null;
  if (entry.use.name === ASK) return 'question';
  return entry.key === waiting ? 'approval' : null;
}

/** Fold each stretch of consecutive tool entries into one `tool-activity` item. Every other item passes through
 *  untouched, in order. */
export function foldToolActivity(items: readonly ChatItem[], fold: ActivityFold): (ChatItem | ToolActivityItem)[] {
  // The newest tool entry overall: the only one a session-wide live ask or dialog can be about.
  let newest: ToolItem | null = null;
  for (const item of items) if (item.kind === 'tool') newest = item;
  const waiting = fold.askPending && newest !== null && newest.result == null ? newest.key : null;

  const out: (ChatItem | ToolActivityItem)[] = [];
  let stretch: ToolItem[] = [];
  const close = (): void => {
    const first = stretch[0];
    const last = stretch[stretch.length - 1];
    if (first === undefined || last === undefined) return;
    // What blocks the session (an open question, a call waiting on approval) leads, then the failures, each in
    // transcript order: the row draws the FIRST, so the one the reader must act on now is never behind an older failure.
    const blocking: Attention[] = [];
    const failed: Attention[] = [];
    for (const entry of stretch) {
      const kind = attentionOf(entry, waiting);
      if (kind === 'failed') failed.push({ kind, entry });
      else if (kind !== null) blocking.push({ kind, entry });
    }
    const attention = [...blocking, ...failed];
    out.push({
      kind: 'tool-activity',
      key: `activity-${first.key}`,
      entries: stretch,
      inner: fold.runs === 'tool-runs' ? groupToolRun(stretch) : [...stretch],
      live: last === newest ? stretch.some((e) => e.result == null) : false,
      latest: toolSummary(last).sentence,
      attention,
    });
    stretch = [];
  };
  for (const item of items) {
    if (item.kind === 'tool') {
      stretch.push(item);
      continue;
    }
    close();
    out.push(item);
  }
  close();
  return out;
}

/** The words of an attention count, by kind, in this order. */
const ATTENTION_WORDS: Readonly<Record<AttentionKind, (n: number) => string>> = {
  failed: (n) => `${n} failed`,
  question: (n) => (n === 1 ? '1 question' : `${n} questions`),
  approval: (n) => `${n} waiting on you`,
};
const ATTENTION_ORDER = Object.keys(ATTENTION_WORDS) as AttentionKind[];

/** The control beside a call waiting on the reader's approval: it raises the answer sheet, or with the answer surface
 *  mounted below the transcript (the desk) it takes the reader there. It answers nothing itself. */
export function approvalControlWord(askBelow: boolean, answerLabel: string | undefined): string {
  return askBelow ? 'Go to approval' : (answerLabel ?? 'Answer');
}

/** The word beside that control, as the ask card says its own. */
export const APPROVAL_WORD = 'waiting for you';

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
  /** One count per kind that wants the reader ("1 failed", "1 question"), in a fixed order. Empty when none does. */
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
    attention: ATTENTION_ORDER.flatMap((k) => {
      const c = counts.get(k);
      return c === undefined ? [] : [ATTENTION_WORDS[k](c)];
    }),
  };
}
