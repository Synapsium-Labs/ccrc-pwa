// The mail lane's rows in a session's chat, compact (desktop polish wave 176; goals modification 106, the operator's
// "Can mail receipt blocks also be nicely wrapped up?").
//
// WHAT IT DECIDES, AND NOTHING ELSE. Which user turn is the mail lane's own prompt (`isMailPrompt`); which fetched card
// opens by default (`opensByDefault`); and which prompts read as one run (`foldMailRows`, by `SAYS_NOTHING`). What the
// rows say is `promptWords` and `cardTime`. Drawing them is `MailRow.tsx`'s, and the design system's `MailCard` and
// `MailPromptLine`. Nothing here changes what the server types, what makes a card, or the order of anything.
//
// L1: pure, no I/O, no React.
import type { MailEnvelope } from '../../../shared/api';
import { injectedPromptOf } from '../../../shared/injected-prompts.mjs';
import { timeOf } from '../lib/format';
import type { ChatItem } from './chatItems';
import type { MessageEvent } from './MessageBubble';

type MailItem = Extract<ChatItem, { kind: 'mail' }>;
export type MailPromptItem = Extract<ChatItem, { kind: 'mail-prompt' }>;
export type MailPromptsItem = Extract<ChatItem, { kind: 'mail-prompts' }>;

/** Whether a turn is the mail lane's prompt: a user turn whose text BEGINS with the mail prompt's fixed head, read from
 *  the one shared list (`INJECTED_PROMPTS`' `mail-nudge` row, matched as that row says: the head at the start of the
 *  turn, at a word boundary), and nothing looser. A person's message that mentions mail, quotes the prompt lower down,
 *  pastes it after other words or starts with nearly the same words stays an ordinary bubble. Every form the server
 *  types today opens with that head: the generic nudge, the operator-message nudge, the inbox wake and the spot-probe
 *  notice. */
export function isMailPrompt(event: MessageEvent): boolean {
  return event.kind === 'user' && injectedPromptOf(event.text) === 'mail-nudge';
}

/** Whether a fetched card asks something of the session being shown: a `question` mail addressed to that session. The
 *  envelope's `kind` is the sender's own word for what the mail is, and `question` is the one that asks for an answer;
 *  `toId` is the session the delivery was made to, so a card the session read about another session asks nothing of
 *  it. */
export function asksOf(envelope: MailEnvelope, self: string): boolean {
  return envelope.kind === 'question' && envelope.toId === self;
}

/** Whether a mail card opens by default: it asks something of the session shown (`asksOf`) AND it is the newest mail
 *  row of the chat, so the question waiting now is never hidden behind a tap, and an older one (answered or
 *  superseded by later mail) opens closed like every other card. One the reader has already seen open by default stays
 *  open for the view (`MailRow.tsx#useOpen`). */
export function opensByDefault(envelope: MailEnvelope, self: string, newest: boolean): boolean {
  return newest && asksOf(envelope, self);
}

/** THE ONE RULE OF A RUN: what an item between two mail prompts is to a person reading the chat, by its kind. `true`:
 *  nothing they would read, so the prompts either side read as one run. A timestamp divider is a time, which the run's
 *  line carries itself, and a prompt is the run's own member. Everything else is something a person reads or acts on,
 *  and ends the run: a message (theirs, the session's or a system row), a mail card, a tool call (folded or not, it is
 *  the session's own act, and a run that swallowed it would move it out of its place), a background-task card, a
 *  pending send and the working pulse. A record over every kind, so a new kind is a compile error until it is placed. */
export const SAYS_NOTHING: Readonly<Record<ChatItem['kind'], boolean>> = {
  divider: true,
  'mail-prompt': true,
  'mail-prompts': true,
  message: false,
  tool: false,
  mail: false,
  task: false,
  pending: false,
  working: false,
};

/** The pass over the built items that the chat draws from (after `buildChatItems`, before the tool fold): each mail
 *  card's `opens` (`opensByDefault`, the newest mail row only), and each maximal run of two or more mail prompts with
 *  nothing between them but what `SAYS_NOTHING` lets through folded into one `mail-prompts` item. A divider between
 *  two members goes inside the run; a divider after the last member stays where it is. Every other item passes through
 *  in order. Pure: `items` is not changed. */
export function foldMailRows(items: readonly ChatItem[], self: string): ChatItem[] {
  let newest = -1;
  items.forEach((item, i) => { if (item.kind === 'mail') newest = i; });
  const marked = items.map((item, i): ChatItem => {
    if (item.kind !== 'mail') return item;
    const opens = opensByDefault(item.envelope, self, i === newest);
    return opens === item.opens ? item : { ...item, opens };
  });

  const out: ChatItem[] = [];
  let i = 0;
  while (i < marked.length) {
    const item = marked[i]!;
    if (item.kind !== 'mail-prompt') {
      out.push(item);
      i += 1;
      continue;
    }
    // Extend the run over silent items, then cut it back to its last prompt.
    let end = i; // the index of the run's last prompt
    let j = i + 1;
    while (j < marked.length && SAYS_NOTHING[marked[j]!.kind]) {
      if (marked[j]!.kind === 'mail-prompt') end = j;
      j += 1;
    }
    if (end === i) {
      out.push(item);
      i += 1;
      continue;
    }
    const members = marked.slice(i, end + 1) as MailPromptsItem['members'];
    out.push({ kind: 'mail-prompts', key: `mail-prompts-${item.key}`, members });
    i = end + 1;
  }
  return out;
}

/** The prompts of a run, without its dividers. */
export function promptsOf(item: MailPromptsItem): MailPromptItem[] {
  return item.members.filter((m): m is MailPromptItem => m.kind === 'mail-prompt');
}

/** What a prompt line says, in words both skins draw. */
export interface PromptWords {
  /** "Mail arrived". */
  readonly title: string;
  /** "3 times" for a run, else null. */
  readonly count: string | null;
  /** "14:02", or "14:02–14:40" for a run whose ends differ. */
  readonly time: string;
  /** The spoken name: "Mail arrived, 14:02", "Mail arrived 3 times, 14:02 to 14:40". */
  readonly label: string;
}

export const PROMPT_TITLE = 'Mail arrived';

/** The words of one prompt, or of a run of them (in transcript order). */
export function promptWords(prompts: readonly MailPromptItem[]): PromptWords {
  const n = prompts.length;
  const first = prompts[0] === undefined ? '' : timeOf(prompts[0].event.ts);
  const last = prompts[n - 1] === undefined ? '' : timeOf(prompts[n - 1]!.event.ts);
  const span = n > 1 && first !== last;
  const time = span ? `${first}–${last}` : first;
  const count = n > 1 ? `${n} times` : null;
  const spokenTime = span ? `${first} to ${last}` : first;
  const label = [count === null ? PROMPT_TITLE : `${PROMPT_TITLE} ${count}`, spokenTime].filter((w) => w !== '').join(', ');
  return { title: PROMPT_TITLE, count, time, label };
}

/** When a card's mail reached the transcript (`14:02`): the time of the record it came from, the fetch's result or the
 *  legacy typed turn. Null when the record carries no readable time. */
export function cardTime(item: MailItem): string | null {
  const t = timeOf(item.event.ts);
  return t === '' ? null : t;
}

/** The card a closed tool-activity row draws under it, or none: the first of its cards that opens by default, or that
 *  has a recorded choice (the reader opened or closed it, or it was drawn open by default once, `MailRow.tsx`). A card
 *  stays where it was drawn for the rest of the view: when newer mail arrives below, the default moves on, and a card
 *  that left the space under its row then would move every row below it while the list cannot hold the reader's place
 *  (a change that comes with a new item at the end is the foot's, `footFollow.ts#heightMove`). With no choice recorded,
 *  this is what the list prices (`shapeOf`). */
export function surfacedOf(
  mail: readonly MailItem[], choice: (key: string) => boolean | undefined,
): MailItem | null {
  return mail.find((m) => m.opens || choice(m.key) !== undefined) ?? null;
}

/** No choice recorded: what the fold and the list's estimate read. */
export const NO_CHOICE = (): undefined => undefined;

/** Whether a row is open: the reader's own choice for it when they made one, else its default. A run takes the reader's
 *  choice for its first prompt when it has none of its own, so a prompt the reader opened stays open when a second
 *  prompt arrives and the two become a run. */
export function openOf(choice: (key: string) => boolean | undefined, item: MailItem | MailPromptItem | MailPromptsItem): boolean {
  const own = choice(item.key);
  if (own !== undefined) return own;
  if (item.kind === 'mail') return item.opens;
  if (item.kind === 'mail-prompts') return choice(item.members[0]!.key) ?? false;
  return false;
}
