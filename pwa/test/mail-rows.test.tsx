// The mail lane's rows, compact (desktop polish wave 176; goals modification 106, "Can mail receipt blocks also be
// nicely wrapped up?"). What a reader of a coordinator's chat scrolled past on every wake was the same paragraph (the
// lane's prompt) and the same card (the fetched mail), each drawn whole. Pinned here: which turns are the lane's prompt
// (the shared head, and nothing looser); a fetched card closed by default and whole when open, with the one exception
// (the newest, asking the session shown); a card inside its fetch's tool stretch; runs of prompts; the open state kept;
// the keyboard and the spoken names. The heights and the reader's place are `browser/mail-rows.browser.test.ts`'.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatEvent, MailEnvelope } from '../../shared/api';
import { MAIL_ENVELOPE_FENCE } from '../../shared/api';
import { INJECTED_PROMPTS } from '../../shared/injected-prompts.mjs';
import { ChatListInner, shapeOf } from '../src/session/ChatList';
import { buildChatItems, type ChatItem } from '../src/session/chatItems';
import { MailRow } from '../src/session/MailRow';
import {
  NO_CHOICE, SAYS_NOTHING, asksOf, foldMailRows, hiddenAsks, isMailPrompt, opensByDefault, openOf, promptWords, promptsOf,
  underKey, underRow,
} from '../src/session/mailRows';
import { SkinSetProvider } from '../src/skins/frame';
import { INSTRUMENT_SET } from '../src/skins/instrument/parts';
import { REFINED_SET } from '../src/skins/refined/parts';
import type { SkinSet } from '../src/skins/types';
import { activityWords, foldToolActivity, type ToolActivityItem } from '../src/session/toolActivity';
import { expansionMemo } from '../src/session/transcriptRow';
import { NO_PAGING, type OlderPaging } from '../src/session/olderPages';
import { sameTranscriptItem } from '../src/session/sameRow';
import { namesWithoutTheirLabel } from './labelInName';

afterEach(cleanup);

/** Every form of the lane's prompt the server types today, rendered by its own renderers and held equal to them by
 *  `server/test/mail-prompt-forms.test.ts` (a console test reads `server/test/fixtures/`, never server source). */
const FORMS = JSON.parse(readFileSync(
  path.join(import.meta.dirname, '..', '..', 'server', 'test', 'fixtures', 'mail-prompt-forms.json'), 'utf8',
)) as { self: string; forms: Record<'generic' | 'operatorMessage' | 'inboxWake' | 'inboxWakeLapsed' | 'inboxWakeUnreadable' | 'spotProbe', string> };
const SELF = FORMS.self;
/** The generic nudge to this session. */
const renderMailNudge = (_self: string): string => FORMS.forms.generic;
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
/** The envelope in the grammar a transcript holds it in (written out, as `mail-card.test.tsx` does, so this suite reads
 *  the grammar as it appears; the round trip with the server's renderer is `server/test/mail-envelope-parse.test.ts`'s). */
const envelopeOf = (over: Partial<MailEnvelope> = {}): string => {
  const e: MailEnvelope = {
    id: 17, fromId: 'coordinator', toId: SELF, runId: 5, program: 'demo', wave: 2, waveOf: 4,
    kind: 'status', subject: 'wave-brief', artifacts: [], body: 'Do the wave.', ...over,
  };
  const lines = [`id: ${e.id}`, `from: ${e.fromId}`, `to: ${e.toId}`];
  if (e.runId !== null) lines.push(`run: ${e.runId} (program:${e.program} wave ${e.wave}/${e.waveOf})`);
  lines.push(`kind: ${e.kind}`, `subject: ${e.subject}`);
  if (e.artifacts.length > 0) lines.push('artifacts:', ...e.artifacts.map((p) => `  ${p}`));
  lines.push(`ack: ccrc-api mail ack ${e.id} --json -   (${e.id} is this DELIVERY id, not the`, '--');
  return '```' + MAIL_ENVELOPE_FENCE + '\n' + lines.join('\n') + '\n' + e.body + '\n```';
};
/** The live lane: the session's own fetch, whose result is the envelope. */
const fetchMail = (over: Partial<MailEnvelope> = {}, min = 0): ChatEvent[] =>
  call('Bash', '~/.local/bin/ccrc-api mail fetch 17', envelopeOf(over), min);
const kinds = (items: readonly { kind: string }[]): string[] => items.map((i) => i.kind);

// ---- 1. the head match ----------------------------------------------------------------------------------------------
/** Every form the server types today, from its own renderers: the generic nudge, the operator-message nudge, the
 *  inbox wake (with a count, a lapse, and the codec's refusal) and the spot-probe notice. */
const SERVER_FORMS: [string, string][] = [
  ['the generic nudge', FORMS.forms.generic],
  ['the operator-message nudge', FORMS.forms.operatorMessage],
  ['the inbox wake', FORMS.forms.inboxWake],
  ['the inbox wake, lapsed', FORMS.forms.inboxWakeLapsed],
  ['the inbox wake, unreadable body', FORMS.forms.inboxWakeUnreadable],
  ['the spot-probe notice', FORMS.forms.spotProbe],
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

  it('a limit, ruled (review 3737 A2): the lane\'s whole head and then words of the person\'s own is folded too, its words one tap away', () => {
    const text = `${HEAD} Then stop wave 3 before it merges.`;
    const e = user(text);
    expect(isMailPrompt(e as Extract<ChatEvent, { kind: 'user' }>)).toBe(true);
    expect(kinds(buildChatItems([e], []))).toEqual(['divider', 'mail-prompt']);
    render(<ChatListInner id={SELF} events={[e]} pending={[]} />);
    expect(document.querySelector('.msg-user')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Mail arrived/ }));
    expect(document.querySelector('.mail-prompt-text')?.textContent).toBe(text);
  });

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
    expect(head.textContent).toBe('▸coordinator wave-brief status 10:07');
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
  it('the rule: a question to the session shown, and the newest card that asks', () => {
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

  it('a question followed by ordinary mail is still open: the newest card that asks, not the newest card (review 3737 F2)', () => {
    render(<ChatListInner id={SELF} events={[...fetchMail({ kind: 'question', subject: 'which base?' }), ...fetchMail({ subject: 'later' })]} pending={[]} />);
    expect(screen.getByRole('button', { name: /^Mail from coordinator: which base\?/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Mail from coordinator: later/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('an older question, once a newer one asks, opens closed', () => {
    const items = foldMailRows(buildChatItems(
      [...fetchMail({ kind: 'question', subject: 'q' }), ...fetchMail({ subject: 's' }), ...fetchMail({ kind: 'question', subject: 'newer' })], []), SELF);
    const cards = items.filter((i): i is Extract<ChatItem, { kind: 'mail' }> => i.kind === 'mail');
    expect(cards.map((c) => [c.envelope.subject, c.opens, c.asks])).toEqual([['q', false, true], ['s', false, false], ['newer', true, true]]);
  });

  it('closed: a question to another session, a status', () => {
    const cases: [string, ChatEvent[]][] = [
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

  it('a question drawn open stays open when a newer question arrives below it, so nothing above the reader shrinks', () => {
    const asked = fetchMail({ kind: 'question', subject: 'which base?' });
    const { rerender } = render(<ChatListInner id={SELF} events={asked} pending={[]} />);
    rerender(<ChatListInner id={SELF} events={[...asked, ...fetchMail({ kind: 'question', subject: 'later' })]} pending={[]} />);
    expect(screen.getByRole('button', { name: /^Mail from coordinator: which base\?/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Mail from coordinator: later/ })).toHaveAttribute('aria-expanded', 'true');
  });

  for (const [skin, set] of SETS) {
    it(`${skin}: under a closed row, a question drawn there stays there when a newer question arrives`, () => {
      const asked = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'which?' })];
      const view = (events: ChatEvent[]) => (
        <SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>
      );
      const { rerender } = render(view(asked));
      rerender(view([...asked, say('Asking the operator.'), ...fetchMail({ kind: 'question', subject: 'later' })]));
      const under = [...document.querySelectorAll('.tool-activity-first[data-attention="mail"] .mail-card-head')];
      expect(under.map((h) => [h.getAttribute('aria-label')?.split(',')[0], h.getAttribute('aria-expanded')])).toEqual([
        ['Mail from coordinator: which?', 'true'], ['Mail from coordinator: later', 'true'],
      ]);
    });

    it(`${skin}: in one stretch, a newer question joins the one drawn under the row, both shown in order (review 3737 F1)`, () => {
      // One wake, no prose between the calls: inbox, fetch A, then (live) fetch B. A was drawn open under the closed row;
      // B is now the card that opens by default, and A stays where it was drawn.
      const asked = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'first?' })];
      const view = (events: ChatEvent[]) => (
        <SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>
      );
      const { rerender } = render(view(asked));
      rerender(view([...asked, ...fetchMail({ kind: 'question', subject: 'second?' }), ...call('Bash', 'mail ack 17')]));
      expect(document.querySelectorAll('.tool-activity-row')).toHaveLength(1);
      const under = [...document.querySelectorAll('.tool-activity-first[data-attention="mail"] .mail-card-head')];
      expect(under.map((h) => h.getAttribute('aria-label')?.split(',')[0])).toEqual([
        'Mail from coordinator: first?', 'Mail from coordinator: second?',
      ]);
      expect(under.map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'true']);
      // Both are drawn, so the row names no question as hidden.
      expect(document.querySelector('.tool-activity-messages')?.textContent).toBe('2 messages');
    });

    it(`${skin}: a card only opened and closed inside the body never appears under the row (review 3737 A4)`, () => {
      const events = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ subject: 'status' }), ...fetchMail({ kind: 'question', subject: 'asks?' })];
      render(<SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>);
      const row = document.querySelector('.tool-activity-row')!;
      fireEvent.click(row); // open the stretch
      const status = screen.getByRole('button', { name: /^Mail from coordinator: status/ });
      fireEvent.click(status);
      fireEvent.click(status);
      fireEvent.click(row); // close it again
      const under = [...document.querySelectorAll('.tool-activity-first[data-attention="mail"] .mail-card-head')];
      expect(under.map((h) => h.getAttribute('aria-label')?.split(',')[0])).toEqual(['Mail from coordinator: asks?']);
    });

    it(`${skin}: a closed stretch names the questions it holds that are not drawn under it (review 3737 F2)`, () => {
      const events = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'older?' }),
        ...fetchMail({ kind: 'question', subject: 'newer?' })];
      render(<SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>);
      expect(document.querySelector('.tool-activity-messages')?.textContent).toBe('2 messages,');
      expect(document.querySelector('.tool-activity-asks')?.textContent).toBe('1 question');
      expect(document.querySelector('.tool-activity-row')?.textContent).toContain('2 messages, 1 question');
      const under = [...document.querySelectorAll('.tool-activity-first[data-attention="mail"] .mail-card-head')];
      expect(under.map((h) => h.getAttribute('aria-label')?.split(',')[0])).toEqual(['Mail from coordinator: newer?']);
    });

    it(`${skin}: an open stretch names no question, since its body draws every card (desktop polish wave 179, B3)`, () => {
      const events = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'older?' }),
        ...fetchMail({ kind: 'question', subject: 'newer?' })];
      render(<SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>);
      const row = document.querySelector<HTMLElement>('.tool-activity-row')!;
      expect(row.textContent).toContain('1 question');
      fireEvent.click(row);
      expect(row.getAttribute('aria-expanded')).toBe('true');
      expect(document.querySelector('.tool-activity-messages')?.textContent).toBe('2 messages');
      expect(document.querySelector('.tool-activity-asks'), 'an open stretch still names a question').toBeNull();
      expect(row.textContent).not.toContain('question');
      fireEvent.click(row);
      expect(row.textContent, 'closed again, the sign comes back').toContain('2 messages, 1 question');
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

// ---- 2b. an older page never takes the default (desktop polish wave 179, B1) -----------------------------------------
describe('an older page\'s question is not the question waiting now (desktop polish wave 179, B1)', () => {
  const older = (rows: number): OlderPaging => ({ ...NO_PAGING, edge: 'more', next: 'c', rows });

  it('the fold takes the boundary in: only a card on the live side opens by default', () => {
    const events = [...fetchMail({ kind: 'question', subject: 'old?' }), ...fetchMail({ subject: 'live status' })];
    const built = buildChatItems(events, []);
    const cardsOf = (items: ChatItem[]) => items.filter((i): i is Extract<ChatItem, { kind: 'mail' }> => i.kind === 'mail')
      .map((c) => [c.envelope.subject, c.opens]);
    // No boundary: the question is the newest that asks, and opens.
    expect(cardsOf(foldMailRows(built, SELF))).toEqual([['old?', true], ['live status', false]]);
    // The question is an older page's (the boundary after it): nothing opens.
    const live = built.findIndex((i) => i.kind === 'mail' && i.envelope.subject === 'live status');
    expect(cardsOf(foldMailRows(built, SELF, live))).toEqual([['old?', false], ['live status', false]]);
  });

  for (const [skin, set] of SETS) {
    const view = (events: ChatEvent[], o?: OlderPaging) => (
      <SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} older={o} onLoadOlder={() => {}} /></SkinSetProvider>
    );
    const opened = (): string[] => [...document.querySelectorAll('.mail-card-head')]
      .filter((h) => h.getAttribute('aria-expanded') === 'true').map((h) => h.getAttribute('aria-label')!.split(',')[0]!);
    const under = (): string[] => [...document.querySelectorAll('.tool-activity-first[data-attention="mail"] .mail-card-head')]
      .map((h) => h.getAttribute('aria-label')!.split(',')[0]!);

    it(`${skin}: an older page holding a question changes nothing that is open, and draws nothing under a row`, () => {
      const page = [user('Earlier.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'old?' })];
      const live = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ subject: 'live status' })];
      const { rerender } = render(view(live, older(0)));
      expect(opened()).toEqual([]);
      expect(under()).toEqual([]);
      rerender(view([...page, ...live], older(page.length)));
      expect(opened(), 'the older page\'s question took the default').toEqual([]);
      expect(under(), 'the older page\'s question was drawn under its row').toEqual([]);
    });

    it(`${skin}: a live question still opens, under its row, with an older page's question above it`, () => {
      const page = [user('Earlier.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'old?' })];
      const live = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question', subject: 'now?' })];
      const { rerender } = render(view(live, older(0)));
      expect(under()).toEqual(['Mail from coordinator: now?']);
      rerender(view([...page, ...live], older(page.length)));
      expect(opened()).toEqual(['Mail from coordinator: now?']);
      expect(under()).toEqual(['Mail from coordinator: now?']);
      // Opened with no older rows held, the same transcript opens the newest question, the live one.
      cleanup();
      render(view([...page, ...live]));
      expect(opened()).toEqual(['Mail from coordinator: now?']);
    });
  }
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

  it('the list prices what the row draws, from the one function (`underRow`)', () => {
    const items = foldToolActivity(foldMailRows(buildChatItems([user('Go.'), ...fetchMail({ kind: 'question', subject: 'a', body: 'one\ntwo' }),
      ...fetchMail({ subject: 'b' }), ...fetchMail({ kind: 'question', subject: 'c', body: 'x' })], []), SELF), { runs: 'none', wait: NONE, busy: false });
    const row = items.find((r): r is ToolActivityItem => r.kind === 'tool-activity')!;
    const [a, b, c] = row.mail;
    // No choice: the default card alone.
    expect(underRow(row.mail, NO_CHOICE)).toEqual([c]);
    expect(shapeOf(row).lines).toBe(1 + shapeOf(c!).lines);
    // A and B drawn here earlier, A kept open and B closed by the reader: all three, in order, each as it is drawn.
    const memo = expansionMemo();
    memo.set(underKey(a!.key), true);
    memo.set(a!.key, true);
    memo.set(underKey(b!.key), true);
    memo.set(b!.key, false);
    expect(underRow(row.mail, memo.choice).map((m) => m.envelope.subject)).toEqual(['a', 'b', 'c']);
    expect(shapeOf(row, undefined, memo.choice).lines)
      .toBe(1 + shapeOf(a!, undefined, memo.choice).lines + 1 + shapeOf(c!, undefined, memo.choice).lines);
    expect(shapeOf(a!, undefined, memo.choice).bucket).toBe('mail');
    // An open or closed choice alone, with no mark of being drawn there, does not bring a card under the row (A4).
    const inside = expansionMemo();
    inside.set(a!.key, false);
    expect(underRow(row.mail, inside.choice)).toEqual([c]);
  });

  it('the hidden questions: the asking cards not drawn under the row, counted in the words', () => {
    const items = foldToolActivity(foldMailRows(buildChatItems([user('Go.'), ...fetchMail({ kind: 'question', subject: 'a' }),
      ...fetchMail({ kind: 'question', subject: 'b' }), ...fetchMail({ kind: 'question', subject: 'c' })], []), SELF), { runs: 'none', wait: NONE, busy: false });
    const row = items.find((r): r is ToolActivityItem => r.kind === 'tool-activity')!;
    expect(hiddenAsks(row.mail, NO_CHOICE)).toBe(2);
    expect(activityWords(row)).toMatchObject({ messages: '3 messages', asks: '2 questions' });
    const memo = expansionMemo();
    memo.set(underKey(row.mail[0]!.key), true);
    expect(activityWords(row, memo.choice)).toMatchObject({ messages: '3 messages', asks: '1 question' });
    // B3 (desktop polish wave 179): an open row names none.
    expect(activityWords(row, memo.choice, true)).toMatchObject({ messages: '3 messages', asks: null });
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
      title: 'Mail arrived', count: '3 times', time: '10:01 to 10:04', label: 'Mail arrived 3 times, 10:01 to 10:04',
    });
    expect(shapeOf(run)).toEqual({ bucket: 'mail-line', lines: 1 });
  });

  it('a quiet gap\'s divider between two prompts stays inside the run', () => {
    const items = fold([user(NUDGE, 0), user(NUDGE, 30)]);
    expect(kinds(items)).toEqual(['divider', 'mail-prompts']);
    expect(kinds((items[1] as Extract<ChatItem, { kind: 'mail-prompts' }>).members)).toEqual(['mail-prompt', 'divider', 'mail-prompt']);
  });

  it('opened, a run draws its members\' divider as the chat does, between the two lines', () => {
    render(<ChatListInner id={SELF} events={[user(NUDGE, 0), user(NUDGE, 30)]} pending={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Mail arrived 2 times/ }));
    const parts = [...document.querySelector('.mail-prompt-body')!.children];
    expect(parts.map((c) => (c.matches('p.ts-divider') ? 'divider' : c.classList.contains('mail-prompt') ? 'line' : c.outerHTML)))
      .toEqual(['line', 'divider', 'line']);
    expect(parts[1]!.textContent).toMatch(/ · 10:30$/);
  });

  it('a run never spans two days: a prompt on the next day starts its own line, the day\'s divider between (review 3737 A3)', () => {
    const items = fold([user(NUDGE, 0), user(NUDGE, 5), user(NUDGE, 24 * 60)]);
    expect(kinds(items)).toEqual(['divider', 'mail-prompts', 'divider', 'mail-prompt']);
    // Even with no quiet gap (so no divider) between them, the local midnight ends the run.
    const local = (h: number, m: number, d: number): ChatEvent => ({ ...user(NUDGE), ts: new Date(2026, 10, d, h, m).toISOString() });
    expect(kinds(fold([local(23, 59, 24), local(0, 1, 25)]))).toEqual(['divider', 'mail-prompt', 'mail-prompt']);
    expect(kinds(fold([local(23, 57, 24), local(23, 59, 24)]))).toEqual(['divider', 'mail-prompts']);
  });

  it('a run\'s time is one time when its first and last are the same minute', () => {
    const run = fold([user(NUDGE, 1), user(NUDGE, 1)])[1] as Extract<ChatItem, { kind: 'mail-prompts' }>;
    expect(promptWords(promptsOf(run))).toEqual({ title: 'Mail arrived', count: '2 times', time: '10:01', label: 'Mail arrived 2 times, 10:01' });
  });

  it('a run starts a turn as a single prompt does: the stretch before it is past', () => {
    const NUDGE2 = renderMailNudge(SELF);
    const events = [user('Go.'), ...call('Read', 'a'), user(NUDGE2), user(NUDGE2), ...call('Read', 'b')];
    const folded = foldToolActivity(foldMailRows(buildChatItems(events, []), SELF), { runs: 'none', wait: NONE, busy: true });
    expect(kinds(folded).filter((k) => k !== 'divider')).toEqual(['message', 'tool-activity', 'mail-prompts', 'tool-activity']);
    expect(folded.filter((r): r is ToolActivityItem => r.kind === 'tool-activity').map((r) => r.past)).toEqual([true, false]);
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

  it('a card names the body it opens (aria-controls), and only while it is open', () => {
    render(<ChatListInner id={SELF} events={fetchMail({}, 4)} pending={[]} />);
    const head = screen.getByRole('button', { name: /^Mail from coordinator/ });
    expect(head.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(head);
    const open = document.querySelector('.mail-card-open');
    expect(open?.id).toBeTruthy();
    expect(head.getAttribute('aria-controls')).toBe(open!.id);
  });

  it('a card whose record carries no readable time says no time: its line and its name end at its kind', () => {
    const fetched = fetchMail({}, 4).map((e) => ({ ...e, ts: 'not a time' }) as ChatEvent);
    render(<ChatListInner id={SELF} events={fetched} pending={[]} />);
    const head = screen.getByRole('button', { name: /^Mail from coordinator/ });
    expect(head.getAttribute('aria-label')).toBe('Mail from coordinator: wave-brief, status');
    expect(head.querySelector('.mail-card-time')).toBeNull();
  });

  // WCAG 2.5.3 as storybook-a11y's axe measures it (label-content-name-mismatch): the words a line shows are an
  // unbroken run of its spoken name, so a voice user who says what they see reaches it. Adjacent spans with no space
  // between them read as one word, and a run's range must say the same word ("to") it speaks. The card's subject ends in
  // a word, not a question mark (desktop polish wave 179, B6): after a "?" the measure reads the subject and the kind word
  // as apart with or without the space between them, so a lost space there was not caught.
  it.each(SETS)('%s: every mail line, closed and open, single and a run, holds the words it shows in its name', (_n, set) => {
    const NUDGE = renderMailNudge(SELF);
    const events = [
      user(NUDGE, 1), user(NUDGE, 2), user(NUDGE, 4), say('Reading.', 5),
      user(NUDGE, 6), say('Fetching.', 7), ...fetchMail({ subject: 'the base for wave 3' }, 8),
    ];
    const { container } = render(<SkinSetProvider set={set}><ChatListInner id={SELF} events={events} pending={[]} /></SkinSetProvider>);
    expect(screen.getAllByRole('button', { name: /^Mail / })).toHaveLength(2); // the run and the single prompt
    expect(namesWithoutTheirLabel(container), 'closed').toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Tool activity/ })); // the fetch's stretch: its card, closed
    const lines = screen.getAllByRole('button', { name: /^Mail / });
    expect(lines).toHaveLength(3);
    expect(namesWithoutTheirLabel(container), 'the card closed').toEqual([]);
    for (const b of lines) fireEvent.click(b);
    expect(lines.map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'true', 'true']);
    expect(namesWithoutTheirLabel(container), 'open').toEqual([]);
  });
});

// ---- 7. the row barrier ---------------------------------------------------------------------------------------------
describe('the row barrier: a build over the same events is the same row', () => {
  it('a run is another row when one member differs, and when any other field of it does (review 3737 A6)', () => {
    const NUDGE = renderMailNudge(SELF);
    const lead = user(NUDGE);
    const build = (second: ChatEvent) => foldMailRows(buildChatItems([lead, second], []), SELF)
      .find((i): i is Extract<ChatItem, { kind: 'mail-prompts' }> => i.kind === 'mail-prompts')!;
    const second = user(NUDGE);
    const a = build(second);
    expect(sameTranscriptItem(a, build(second))).toBe(true);
    // A member replaced under the same key: the lists differ.
    const other = build({ ...second, text: `${NUDGE} again` } as ChatEvent);
    expect(other.key).toBe(a.key);
    expect(sameTranscriptItem(a, other)).toBe(false);
    // A field beside the members (none today, so a run's own fields are compared once one is added).
    expect(sameTranscriptItem(a, { ...a, members: [...a.members], extra: 1 } as typeof a)).toBe(false);
  });

  it('a run of prompts, and a stretch holding a card, compared by their lists', () => {
    const NUDGE = renderMailNudge(SELF);
    const events = [user(NUDGE), user(NUDGE), user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question' })];
    const build = () => foldToolActivity(foldMailRows(buildChatItems(events, []), SELF), { runs: 'none', wait: NONE, busy: false });
    const [a, b] = [build(), build()];
    const run = a.findIndex((i) => i.kind === 'mail-prompts');
    const row = a.findIndex((i) => i.kind === 'tool-activity');
    expect(sameTranscriptItem(a[run]!, b[run]!)).toBe(true);
    expect(sameTranscriptItem(a[row]!, b[row]!)).toBe(true);
    // A newer card in the stretch is a new row: its list of cards differs (this alone pins nothing about a card's own
    // fields; the case below does).
    const later = foldToolActivity(foldMailRows(buildChatItems([...events, ...fetchMail()], []), SELF), { runs: 'none', wait: NONE, busy: false });
    expect(sameTranscriptItem(a[row]!, later[row]!)).toBe(false);
  });

  const stretchWithQuestion = () => {
    const events = [user('Go.'), ...call('Bash', 'mail inbox'), ...fetchMail({ kind: 'question' })];
    const built = foldToolActivity(foldMailRows(buildChatItems(events, []), SELF), { runs: 'none', wait: NONE, busy: false });
    const row = built.find((i): i is ToolActivityItem => i.kind === 'tool-activity')!;
    const card = row.mail[0]!;
    const withCard = (c: typeof card): ToolActivityItem => ({ ...row, mail: [c] });
    expect(sameTranscriptItem(card, { ...card })).toBe(true);
    expect(sameTranscriptItem(row, withCard({ ...card }))).toBe(true);
    return { row, card, withCard };
  };

  it('desktop polish wave 179, B4: a card whose default alone (opens) differs is another row, alone and in its stretch', () => {
    const { row, card, withCard } = stretchWithQuestion();
    expect(sameTranscriptItem(card, { ...card, opens: !card.opens }), 'a card whose opens alone flipped').toBe(false);
    expect(sameTranscriptItem(row, withCard({ ...card, opens: !card.opens })), 'a stretch whose card\'s opens alone flipped').toBe(false);
  });

  it('desktop polish wave 179, B4: a card whose asking alone (asks) differs is another row, alone and in its stretch', () => {
    const { row, card, withCard } = stretchWithQuestion();
    expect(sameTranscriptItem(card, { ...card, asks: !card.asks }), 'a card whose asks alone flipped').toBe(false);
    expect(sameTranscriptItem(row, withCard({ ...card, asks: !card.asks })), 'a stretch whose card\'s asks alone flipped').toBe(false);
  });
});
