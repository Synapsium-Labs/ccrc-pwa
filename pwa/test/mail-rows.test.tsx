// The mail lane's rows, compact (desktop polish wave 176; goals modification 106, "Can mail receipt blocks also be
// nicely wrapped up?"). What a reader of a coordinator's chat scrolled past on every wake was the same paragraph (the
// lane's prompt) and the same card (the fetched mail), each drawn whole. Pinned here: which turns are the lane's prompt
// (the shared head, and nothing looser); a fetched card closed by default and whole when open, with the one exception
// (the newest, asking the session shown); a card inside its fetch's tool stretch; runs of prompts; the open state kept;
// the keyboard and the spoken names. The heights and the reader's place are `browser/mail-rows.browser.test.ts`'.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChatEvent, MailEnvelope } from '../../shared/api';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { renderInboxWakeLine, renderSpotProbeLine } from '../../shared/overlordInbox';
import { renderEnvelope, renderMailNudge, renderOperatorMessageNudge } from '../../server/src/coord/envelope';
import { ChatListInner, shapeOf } from '../src/session/ChatList';
import { buildChatItems, type ChatItem } from '../src/session/chatItems';
import { MailRow } from '../src/session/MailRow';
import {
  SAYS_NOTHING, asksOf, foldMailRows, isMailPrompt, opensByDefault, openOf, promptWords, promptsOf,
} from '../src/session/mailRows';
import { SkinSetProvider } from '../src/skins/frame';
import { INSTRUMENT_SET } from '../src/skins/instrument/parts';
import { REFINED_SET } from '../src/skins/refined/parts';
import type { SkinSet } from '../src/skins/types';
import { activityWords, foldToolActivity, type ToolActivityItem } from '../src/session/toolActivity';
import { expansionMemo } from '../src/session/transcriptRow';
import { sameTranscriptItem } from '../src/session/sameRow';

afterEach(cleanup);

const SELF = 'lane-a-project-a';
const TS = (min: number): string => new Date(Date.UTC(2026, 10, 24, 10, min)).toISOString();
const SETS: [string, SkinSet][] = [['Refined', REFINED_SET], ['Instrument', INSTRUMENT_SET]];
const NONE = { kind: 'none' } as const;

let n = 0;
const user = (text: string, min = 0): ChatEvent => { n += 1; return { kind: 'user', uuid: `q${n}`, ts: TS(min), text }; };
const say = (text: string, min = 0): ChatEvent => { n += 1; return { kind: 'assistant', uuid: `a${n}`, ts: TS(min), text }; };
/** A tool call and its result. */
const call = (name: string, input: string, result = 'ok', min = 0): ChatEvent[] => {
  n += 1;
  return [
    { kind: 'tool_use', uuid: `u${n}`, ts: TS(min), toolId: `t${n}`, name, input },
    { kind: 'tool_result', ts: TS(min), toolId: `t${n}`, text: result, isError: false },
  ];
};
/** The envelope as the server renders it today (`renderEnvelope`), with a delivery id. */
const envelopeOf = (over: Partial<MailEnvelope> = {}): string => renderEnvelope({
  id: 17, fromId: 'coordinator', toId: SELF, runId: 5, program: 'demo', wave: 2, waveOf: 4,
  kind: 'status', subject: 'wave-brief', artifacts: [], body: 'Do the wave.', ...over,
});
/** The live lane: the session's own fetch, whose result is the envelope. */
const fetchMail = (over: Partial<MailEnvelope> = {}, min = 0): ChatEvent[] =>
  call('Bash', '~/.local/bin/ccrc-api mail fetch 17', envelopeOf(over), min);
const kinds = (items: readonly { kind: string }[]): string[] => items.map((i) => i.kind);

// ---- 1. the head match ----------------------------------------------------------------------------------------------
/** Every form the server types today, from its own renderers: the generic nudge, the operator-message nudge, the
 *  inbox wake (with a count, a lapse, and the codec's refusal) and the spot-probe notice. */
const SERVER_FORMS: [string, string][] = [
  ['the generic nudge', renderMailNudge(SELF)],
  ['the operator-message nudge', renderOperatorMessageNudge(42)],
  ['the inbox wake', renderInboxWakeLine({ ok: true, body: { keys: [], waiting: 2, firstDue: { kind: 'by', at: 90_000 } } }, 0)],
  ['the inbox wake, lapsed', renderInboxWakeLine({ ok: true, body: { keys: [], waiting: 1, firstDue: { kind: 'by', at: 0 } } }, 5)],
  ['the inbox wake, unreadable body', renderInboxWakeLine({ ok: false }, 0)],
  ['the spot-probe notice', renderSpotProbeLine()],
];
const HEAD = INJECTED_PROMPTS['mail-nudge'].text;
/** What a person might type: it mentions the prompt, quotes it lower down, pastes it after other words, or starts with
 *  nearly the same words. None of these is the lane's prompt. */
const PERSON_FORMS: [string, string][] = [
  ['mentions mail', 'Did you get the mail I sent about wave 3?'],
  ['names the head mid-sentence', `I keep seeing "${HEAD}" in the chat, what is it?`],
  ['quotes it lower down', `Look at this:\n${renderMailNudge(SELF)}`],
  ['pastes it after other words', `fyi ${renderMailNudge(SELF)}`],
  ['a leading space', ` ${renderMailNudge(SELF)}`],
  ['without the full stop', 'ccrc-mail: you have new mail'],
  ['plural', 'ccrc-mail: you have new mails.'],
  ['another case', 'ccrc-mail: You have new mail.'],
  ['run on past the head', 'ccrc-mail: you have new mail.Now read it.'],
  ['a different tag', 'ccrc-mails: you have new mail. Use the client.'],
];

describe('the mail prompt: the shared head at the start of the turn, and nothing looser', () => {
  for (const [name, text] of SERVER_FORMS) {
    it(`${name} is the lane's prompt, one quiet line, never a bubble`, () => {
      const e = user(text);
      expect(isMailPrompt(e as Extract<ChatEvent, { kind: 'user' }>)).toBe(true);
      expect(kinds(buildChatItems([e], []))).toEqual(['divider', 'mail-prompt']);
      render(<ChatListInner id={SELF} events={[e]} pending={[]} />);
      expect(document.querySelector('.msg-user')).toBeNull();
      expect(screen.getByRole('button', { name: /^Mail arrived, 10:00$/ })).toHaveAttribute('aria-expanded', 'false');
    });
  }

  for (const [name, text] of PERSON_FORMS) {
    it(`a person's message that ${name} stays an ordinary bubble`, () => {
      const e = user(text);
      expect(isMailPrompt(e as Extract<ChatEvent, { kind: 'user' }>)).toBe(false);
      expect(kinds(buildChatItems([e], []))).toEqual(['divider', 'message']);
      render(<ChatListInner id={SELF} events={[e]} pending={[]} />);
      expect(document.querySelector('.msg-user')).not.toBeNull();
      expect(document.querySelector('.mail-prompt')).toBeNull();
    });
  }

  it('only a user turn: the session quoting the prompt in its own reply is its own words', () => {
    expect(isMailPrompt(say(renderMailNudge(SELF)) as Extract<ChatEvent, { kind: 'assistant' }>)).toBe(false);
    expect(isMailPrompt({ kind: 'system', uuid: 's', ts: TS(0), text: renderMailNudge(SELF) })).toBe(false);
    expect(kinds(buildChatItems([say(renderMailNudge(SELF))], []))).toEqual(['divider', 'message']);
  });

  it('opens on a tap to the prompt\'s full text, verbatim, and closes again', () => {
    const text = renderMailNudge(SELF);
    render(<ChatListInner id={SELF} events={[user(text)]} pending={[]} />);
    const line = screen.getByRole('button', { name: /Mail arrived/ });
    expect(document.querySelector('.mail-prompt-text')).toBeNull();
    fireEvent.click(line);
    expect(line).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.mail-prompt-text')?.textContent).toBe(text);
    expect(line.getAttribute('aria-controls')).toBe(document.querySelector('.mail-prompt-body')?.id);
    fireEvent.click(line);
    expect(line).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.mail-prompt-text')).toBeNull();
  });

  it('still starts a turn: the tool fold reads a prompt as the start of the current turn', () => {
    const events = [user('Go.'), ...call('Read', 'a'), user(renderMailNudge(SELF)), ...call('Read', 'b')];
    const rows = foldToolActivity(foldMailRows(buildChatItems(events, []), SELF), { runs: 'none', wait: NONE, busy: true })
      .filter((r): r is ToolActivityItem => r.kind === 'tool-activity');
    expect(rows.map((r) => r.past)).toEqual([true, false]);
  });
});

// ---- 2. a fetched card ----------------------------------------------------------------------------------------------
describe('a fetched card: closed by default, today\'s card whole when open', () => {
  it('closed, one line: who it is from, its subject and its kind, with the time', () => {
    render(<ChatListInner id={SELF} events={fetchMail({ artifacts: ['/x/a.md'] }, 7)} pending={[]} />);
    const head = screen.getByRole('button', { name: 'Mail from coordinator: wave-brief, status, 10:07' });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(head.textContent).toBe('▸coordinatorwave-briefstatus10:07');
    // Nothing of the card's inside is drawn while it is closed.
    for (const sel of ['.mail-card-from', '.mail-card-meta', '.mail-card-artifact', '.mail-card-body']) {
      expect(document.querySelector(sel), sel).toBeNull();
    }
  });

  it('open, the card is whole: sender and recipient, kind, subject, run, artifacts and body', () => {
    render(<ChatListInner id={SELF} events={fetchMail({ artifacts: ['/x/a.md'] })} pending={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Mail from coordinator/ }));
    expect(document.querySelector('.mail-card-from')?.textContent).toContain(SELF);
    expect(document.querySelector('.mail-card-meta .mail-card-kind')?.textContent).toBe('status');
    expect(document.querySelector('.mail-card-meta .mail-card-subject')?.textContent).toBe('wave-brief');
    expect(document.querySelector('.mail-card-run')?.textContent).toBe('run 5 · demo wave 2/4');
    expect(document.querySelector('.mail-card-artifact')?.textContent).toBe('/x/a.md');
    expect(document.querySelector('.mail-card-body')?.textContent).toBe('Do the wave.');
  });

  it('a legacy typed envelope (a user turn) is a closed card too, and opens whole', () => {
    const legacy = user(envelopeOf({ subject: 'typed' }));
    expect(kinds(buildChatItems([legacy], []))).toEqual(['divider', 'mail']);
    render(<ChatListInner id={SELF} events={[legacy]} pending={[]} />);
    const head = screen.getByRole('button', { name: /^Mail from coordinator: typed, status/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(head);
    expect(document.querySelector('.mail-card-body')?.textContent).toBe('Do the wave.');
  });
});

describe('the exception: the newest card that asks the session shown something stays open', () => {
  it('the rule: a question to the session shown, and the newest mail row', () => {
    const q = { kind: 'question', toId: SELF } as MailEnvelope;
    expect(asksOf(q, SELF)).toBe(true);
    expect(asksOf({ ...q, kind: 'status' }, SELF)).toBe(false);
    expect(asksOf({ ...q, kind: 'answer' }, SELF)).toBe(false);
    expect(asksOf({ ...q, toId: 'lane-b-project-a' }, SELF)).toBe(false);
    expect(opensByDefault(q, SELF, true)).toBe(true);
    expect(opensByDefault(q, SELF, false)).toBe(false);
  });

  it('a question to this session as the newest mail row is open by default', () => {
    render(<ChatListInner id={SELF} events={fetchMail({ kind: 'question', subject: 'which base?' })} pending={[]} />);
    expect(screen.getByRole('button', { name: /^Mail from coordinator: which base\?, question/ }))
      .toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.mail-card-body')?.textContent).toBe('Do the wave.');
  });

  it('closed: a question that is no longer the newest mail row, a question to another session, a status', () => {
    const cases: [string, ChatEvent[]][] = [
      ['older question', [...fetchMail({ kind: 'question', subject: 'q' }), ...fetchMail({ subject: 'later' })]],
      ['to another session', fetchMail({ kind: 'question', subject: 'q', toId: 'lane-b-project-a' })],
      ['a status', fetchMail({ subject: 'q' })],
    ];
    for (const [name, events] of cases) {
      const { unmount } = render(<ChatListInner id={SELF} events={events} pending={[]} />);
      const heads = screen.getAllByRole('button', { name: /^Mail from/ });
      expect(heads.map((h) => h.getAttribute('aria-expanded')), name).toEqual(heads.map(() => 'false'));
      unmount();
    }
  });

  it('the item carries it, so the list prices it open, and every other card as one line', () => {
    const items = foldMailRows(buildChatItems([...fetchMail({ subject: 'a' }), ...fetchMail({ kind: 'question' })], []), SELF);
    const cards = items.filter((i): i is Extract<ChatItem, { kind: 'mail' }> => i.kind === 'mail');
    expect(cards.map((c) => c.opens)).toEqual([false, true]);
    expect(shapeOf(cards[0]!)).toEqual({ bucket: 'mail-line', lines: 1 });
    expect(shapeOf(cards[1]!).bucket).toBe('mail');
  });

  it('a question drawn open stays open when newer mail arrives below it, so nothing above the reader shrinks', () => {
    const asked = fetchMail({ kind: 'question', subject: 'which base?' });
    const { rerender } = render(<ChatListInner id={SELF} events={asked} pending={[]} />);
    rerender(<ChatListInner id={SELF} events={[...asked, ...fetchMail({ subject: 'later' })]} pending={[]} />);
    expect(screen.getByRole('button', { name: /^Mail from coordinator: which base\?/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Mail from coordinator: later/ })).toHaveAttribute('aria-expanded', 'false');
  });

  for (const [skin, set] of SETS) {
    it(`${skin}: under a closed row, a question drawn there stays there when newer mail arrives`, () => {
      const asked = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'which?' })];
      const view = (events: ChatEvent[]) => (
        <SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>
      );
      const { rerender } = render(view(asked));
      rerender(view([...asked, say('Asking the operator.'), ...fetchMail({ subject: 'later' })]));
      const under = document.querySelectorAll('.tool-activity-first[data-attention="mail"] .mail-card-head');
      expect(under).toHaveLength(1);
      expect(under[0]).toHaveAttribute('aria-expanded', 'true');
      expect(under[0]!.getAttribute('aria-label')).toMatch(/^Mail from coordinator: which\?/);
    });
  }

  it('a card the reader closed stays closed, though it opens by default', () => {
    const memo = expansionMemo();
    const items = foldMailRows(buildChatItems(fetchMail({ kind: 'question' }), []), SELF);
    const card = items.find((i) => i.kind === 'mail')!;
    expect(openOf(memo.choice, card as Extract<ChatItem, { kind: 'mail' }>)).toBe(true);
    memo.set(card.key, false);
    expect(openOf(memo.choice, card as Extract<ChatItem, { kind: 'mail' }>)).toBe(false);
  });
});

// ---- 3. with the tool stretches -------------------------------------------------------------------------------------
describe('a fetched card belongs with its fetch: one stretch, and the row counts the messages', () => {
  const stretchOf = (events: ChatEvent[]) =>
    foldToolActivity(foldMailRows(buildChatItems(events, []), SELF), { runs: 'none', wait: NONE, busy: false });

  it('a card between calls of one stretch does not split it in two', () => {
    const events = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail(), ...call('Bash', 'mail ack 17')];
    const folded = stretchOf(events);
    expect(kinds(folded)).toEqual(['divider', 'message', 'tool-activity']);
    const row = folded[2] as ToolActivityItem;
    expect(row.entries).toHaveLength(3);
    expect(kinds(row.inner)).toEqual(['tool', 'tool', 'mail', 'tool']);
    expect(activityWords(row)).toMatchObject({ calls: '3 calls', messages: '1 message' });
  });

  it('two fetches: one row, "2 messages"', () => {
    const folded = stretchOf([user('Go.'), ...fetchMail(), ...fetchMail({ subject: 'two' })]);
    const rows = folded.filter((r): r is ToolActivityItem => r.kind === 'tool-activity');
    expect(rows).toHaveLength(1);
    expect(activityWords(rows[0]!).messages).toBe('2 messages');
  });

  it('a card with no stretch open before it stands alone; a legacy typed card still ends a stretch', () => {
    const orphan: ChatEvent = { kind: 'tool_result', ts: TS(0), toolId: 'gone', text: envelopeOf(), isError: false };
    expect(kinds(stretchOf([user('Go.'), say('Reading.'), orphan]))).toEqual(['divider', 'message', 'message', 'mail']);
    const legacy = stretchOf([user('Go.'), ...call('Read', 'a'), user(envelopeOf()), ...call('Read', 'b')]);
    expect(kinds(legacy)).toEqual(['divider', 'message', 'tool-activity', 'mail', 'tool-activity']);
  });

  for (const [skin, set] of SETS) {
    it(`${skin}: closed, the row says it, and an asking card is drawn under it, never hidden`, () => {
      const events = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'which?' })];
      render(<SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>);
      const rows = document.querySelectorAll('.tool-activity-row');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain('2 calls');
      expect(rows[0]!.textContent).toContain('1 message');
      expect(rows[0]).toHaveAttribute('aria-expanded', 'false');
      const surfaced = document.querySelector('.tool-activity-first[data-attention="mail"]');
      expect(surfaced?.querySelector('.mail-card-head')).toHaveAttribute('aria-expanded', 'true');
      // Opened, the card is in the body in order, once.
      fireEvent.click(rows[0]!);
      expect(document.querySelectorAll('.mail-card')).toHaveLength(1);
      expect(document.querySelector('.tool-activity-body .mail-card')).not.toBeNull();
    });

    it(`${skin}: a card that does not ask is only inside the closed row`, () => {
      const events = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail()];
      render(<SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>);
      expect(document.querySelectorAll('.mail-card')).toHaveLength(0);
    });
  }

  it('the row prices the surfaced card under it', () => {
    const items = foldToolActivity(foldMailRows(buildChatItems(
      [user('Go.'), ...fetchMail({ kind: 'question', body: 'one\ntwo' })], []), SELF), { runs: 'none', wait: NONE, busy: false });
    const row = items.find((r): r is ToolActivityItem => r.kind === 'tool-activity')!;
    expect(row.surfaced).not.toBeNull();
    expect(shapeOf(row).lines).toBe(1 + shapeOf(row.surfaced!).lines);
  });
});

// ---- 4. runs --------------------------------------------------------------------------------------------------------
describe('runs: prompts with nothing a person would read between them are one line with a count', () => {
  const NUDGE = renderMailNudge(SELF);
  const fold = (events: ChatEvent[]) => foldMailRows(buildChatItems(events, []), SELF);

  it('the rule, by kind: a divider and a prompt say nothing; every other kind is read', () => {
    expect(Object.entries(SAYS_NOTHING).filter(([, v]) => v).map(([k]) => k).sort())
      .toEqual(['divider', 'mail-prompt', 'mail-prompts']);
  });

  it('three prompts in a row: one line, "3 times", the first and last time', () => {
    const items = fold([user(NUDGE, 1), user(NUDGE, 2), user(NUDGE, 4)]);
    expect(kinds(items)).toEqual(['divider', 'mail-prompts']);
    const run = items[1] as Extract<ChatItem, { kind: 'mail-prompts' }>;
    expect(promptsOf(run)).toHaveLength(3);
    expect(promptWords(promptsOf(run))).toEqual({
      title: 'Mail arrived', count: '3 times', time: '10:01–10:04', label: 'Mail arrived 3 times, 10:01 to 10:04',
    });
    expect(shapeOf(run)).toEqual({ bucket: 'mail-line', lines: 1 });
  });

  it('a quiet gap\'s divider between two prompts stays inside the run', () => {
    const items = fold([user(NUDGE, 0), user(NUDGE, 30)]);
    expect(kinds(items)).toEqual(['divider', 'mail-prompts']);
    expect(kinds((items[1] as Extract<ChatItem, { kind: 'mail-prompts' }>).members)).toEqual(['mail-prompt', 'divider', 'mail-prompt']);
  });

  it('broken by anything a person reads: a message, a reply, a card, a tool call', () => {
    expect(kinds(fold([user(NUDGE), user('Stop.'), user(NUDGE)]))).toEqual(['divider', 'mail-prompt', 'message', 'mail-prompt']);
    expect(kinds(fold([user(NUDGE), say('Reading.'), user(NUDGE)]))).toEqual(['divider', 'mail-prompt', 'message', 'mail-prompt']);
    expect(kinds(fold([user(NUDGE), ...fetchMail(), user(NUDGE)]))).toEqual(['divider', 'mail-prompt', 'tool', 'mail', 'mail-prompt']);
    expect(kinds(fold([user(NUDGE), ...call('Read', 'a'), user(NUDGE)]))).toEqual(['divider', 'mail-prompt', 'tool', 'mail-prompt']);
  });

  it('a run then a message then a run: two lines with their own counts', () => {
    const items = fold([user(NUDGE), user(NUDGE), user('Stop.'), user(NUDGE), user(NUDGE), user(NUDGE)]);
    expect(kinds(items)).toEqual(['divider', 'mail-prompts', 'message', 'mail-prompts']);
    expect(items.filter((i) => i.kind === 'mail-prompts')
      .map((r) => promptWords(promptsOf(r as Extract<ChatItem, { kind: 'mail-prompts' }>)).count)).toEqual(['2 times', '3 times']);
  });

  it('a divider after the run\'s last prompt stays outside it', () => {
    expect(kinds(fold([user(NUDGE, 0), user(NUDGE, 1), say('Reading.', 30)])))
      .toEqual(['divider', 'mail-prompts', 'divider', 'message']);
  });

  it('drawn: one line; open, its own lines, each opening to its text', () => {
    render(<ChatListInner id={SELF} events={[user(NUDGE, 1), user(NUDGE, 2)]} pending={[]} />);
    const line = screen.getByRole('button', { name: 'Mail arrived 2 times, 10:01 to 10:02' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(line);
    const inner = screen.getAllByRole('button', { name: /^Mail arrived, 10:0[12]$/ });
    expect(inner).toHaveLength(2);
    fireEvent.click(inner[1]!);
    expect(document.querySelector('.mail-prompt-text')?.textContent).toBe(NUDGE);
  });
});

// ---- 5. the open state ----------------------------------------------------------------------------------------------
describe('a row the reader opened stays open while the chat is open', () => {
  it('across live rows arriving', () => {
    const first = fetchMail({ subject: 'first' });
    const { rerender } = render(<ChatListInner id={SELF} events={first} pending={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Mail from coordinator: first/ }));
    rerender(<ChatListInner id={SELF} events={[...first, say('Acked.'), ...fetchMail({ subject: 'second' })]} pending={[]} />);
    expect(screen.getByRole('button', { name: /^Mail from coordinator: first/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Mail from coordinator: second/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('across the list recycling the row (unmounted, then mounted again from the list\'s memo)', () => {
    const memo = expansionMemo();
    const card = foldMailRows(buildChatItems(fetchMail(), []), SELF).find((i) => i.kind === 'mail') as Extract<ChatItem, { kind: 'mail' }>;
    const prompt = buildChatItems([user(renderMailNudge(SELF))], []).find((i) => i.kind === 'mail-prompt') as Extract<ChatItem, { kind: 'mail-prompt' }>;
    for (const item of [card, prompt]) {
      const a = render(<MailRow item={item} expansion={memo} />);
      fireEvent.click(screen.getByRole('button'));
      a.unmount();
      render(<MailRow item={item} expansion={memo} />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
      cleanup();
    }
  });

  it('a prompt the reader opened stays open when a second arrives and the two become a run', () => {
    const NUDGE = renderMailNudge(SELF);
    const one = [user(NUDGE, 1)];
    const { rerender } = render(<ChatListInner id={SELF} events={one} pending={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Mail arrived/ }));
    rerender(<ChatListInner id={SELF} events={[...one, user(NUDGE, 2)]} pending={[]} />);
    expect(screen.getByRole('button', { name: 'Mail arrived 2 times, 10:01 to 10:02' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Mail arrived, 10:01' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.mail-prompt-text')?.textContent).toBe(NUDGE);
  });

  it('a new session view starts fresh', () => {
    const events = fetchMail();
    const { rerender } = render(<ChatListInner id={SELF} events={events} pending={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Mail from/ }));
    rerender(<ChatListInner id="lane-b-project-a" events={events} pending={[]} />);
    expect(screen.getByRole('button', { name: /^Mail from/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

// ---- 6. the keyboard and the spoken names ---------------------------------------------------------------------------
describe('the keyboard and the spoken names', () => {
  it('each line is a native button: reached by Tab, operated by Enter and Space, named, with its open state', () => {
    render(<ChatListInner id={SELF} events={[user(renderMailNudge(SELF), 3), ...fetchMail({}, 4)]} pending={[]} />);
    const buttons = screen.getAllByRole('button', { name: /^Mail / }); // the fetch's own tool card has its own
    expect(buttons.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON']);
    expect(buttons.map((b) => b.getAttribute('type'))).toEqual(['button', 'button']);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Mail arrived, 10:03', 'Mail from coordinator: wave-brief, status, 10:04',
    ]);
    expect(buttons.map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
    for (const b of buttons) {
      b.focus();
      expect(document.activeElement).toBe(b);
      expect(b.tabIndex).toBe(0);
    }
  });
});

// ---- 7. the row barrier ---------------------------------------------------------------------------------------------
describe('the row barrier: a build over the same events is the same row', () => {
  it('a run of prompts, and a stretch holding a card, compared by their lists', () => {
    const NUDGE = renderMailNudge(SELF);
    const events = [user(NUDGE), user(NUDGE), user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question' })];
    const build = () => foldToolActivity(foldMailRows(buildChatItems(events, []), SELF), { runs: 'none', wait: NONE, busy: false });
    const [a, b] = [build(), build()];
    const run = a.findIndex((i) => i.kind === 'mail-prompts');
    const row = a.findIndex((i) => i.kind === 'tool-activity');
    expect(sameTranscriptItem(a[run]!, b[run]!)).toBe(true);
    expect(sameTranscriptItem(a[row]!, b[row]!)).toBe(true);
    // A card's default flipping is a new row, so the row draws it.
    const later = foldToolActivity(foldMailRows(buildChatItems([...events, ...fetchMail()], []), SELF), { runs: 'none', wait: NONE, busy: false });
    expect(sameTranscriptItem(a[row]!, later[row]!)).toBe(false);
  });
});
