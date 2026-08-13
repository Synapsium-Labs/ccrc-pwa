// The ask card's third state — Build 4 Task 18, spec §2.3's table.
//
// Fact 3 of the spec: the pending ask is the one live thing the transcript
// renders as dead. While `result === undefined` the card fell through to
// `GenericToolCard`'s static "running…", so a question the agent is BLOCKED ON
// RIGHT NOW read as an ordinary tool call still crunching. Three states now,
// derived from two sources at once:
//
//   awaiting    no tool_result AND a live ask/dialog in the store
//   unanswered  no tool_result and NO live envelope (moved on, or died)
//   answered    tool_result landed — today's rendering, untouched
//
// ONE CONTROL, ONE MEANING. `Answer` does not answer: it raises
// `EnvelopeSheet`, the one hardened answer path (`inject/ask.ts`'s `askKey`
// correspondence, `send.ts`'s settle-before-submit). That is Build 7 D-2's
// rule applied where it would be easiest to break, and it has a second,
// mechanical justification: `ChatList` is virtualized, so a row owning an
// in-flight answer could be unmounted mid-send by an ordinary scroll. The
// `does not POST` test below is the pin on that.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatEvent, Dialog, HookAsk } from '../../shared/api';
import { api } from '../src/lib/api';
import { ChatListInner } from '../src/session/ChatList';
import { ASK_GLYPH, ASK_WORD, askState, type ToolResultEvent } from '../src/session/ToolCard';
import { DialogSheet } from '../src/session/DialogSheet';
import { createSessionStore, type SessionStore } from '../src/stores/session';
import { declValue, norm, ruleIn, stripComments } from './cssRule';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = '2026-08-13T10:00:00.000Z';
const chatCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8',
);

const askUse = (question = 'Which colour?'): ChatEvent => ({
  kind: 'tool_use', uuid: 'a1', ts: NOW, toolId: 't1', name: 'AskUserQuestion',
  input: JSON.stringify({ questions: [{ question, header: 'H', multiSelect: false,
    options: [{ label: 'Red' }, { label: 'Green' }] }] }),
});
const askResult = (text: string, isError = false): ChatEvent =>
  ({ kind: 'tool_result', ts: NOW, toolId: 't1', text, isError });

const ANSWERED = 'Your questions have been answered: "Which colour?"="Red".'
  + ' You can now continue with these answers in mind.';

const stateRow = (): HTMLElement | null => document.querySelector('.ask-state');
const answerBtn = (): HTMLElement | null =>
  document.querySelector('.ask-answer');

describe('the ask card is a three-state axis', () => {
  it('awaiting: no tool_result AND a live ask in the store → word, glyph and one Answer control', () => {
    const onAnswer = vi.fn();
    render(<ChatListInner id="s" events={[askUse()]} pending={[]} askPending onAnswer={onAnswer} />);

    const row = stateRow();
    expect(row).not.toBeNull();
    expect(row?.className).toContain('ask-live');
    expect(row?.textContent ?? '').toContain(ASK_WORD.awaiting);
    expect(row?.textContent ?? '').toContain(ASK_GLYPH.awaiting);

    // Exactly one control, and it is the raise.
    expect(answerBtn()).not.toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(answerBtn() as HTMLElement);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('unanswered: no tool_result and NO live envelope → word and glyph, and NO control', () => {
    render(<ChatListInner id="s" events={[askUse()]} pending={[]} askPending={false} onAnswer={vi.fn()} />);

    const row = stateRow();
    expect(row).not.toBeNull();
    expect(row?.className).toContain('ask-unanswered');
    expect(row?.textContent ?? '').toContain(ASK_WORD.unanswered);
    expect(row?.textContent ?? '').toContain(ASK_GLYPH.unanswered);
    expect(answerBtn()).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a dead session does not beg forever: the row reads unanswered, never "waiting for you"', () => {
    // The whole reason `unanswered` exists as its own member. A session that
    // moved past a question — or died holding one — must not render a
    // standing request to the operator that nothing will ever consume.
    render(<ChatListInner id="s" events={[askUse()]} pending={[]} askPending={false} />);
    const all = document.body.textContent ?? '';
    expect(all).toContain(ASK_WORD.unanswered);
    expect(all).not.toContain(ASK_WORD.awaiting);
    expect(ASK_WORD.awaiting).not.toBe(ASK_WORD.unanswered);
  });

  it('answered/declined renders exactly as it does today', () => {
    // An answered ask: the answer lands inline and NO state row appears —
    // the answers themselves are the cue (spec §2.3's third row, "today's
    // rendering").
    const { unmount } = render(
      <ChatListInner id="s" events={[askUse(), askResult(ANSWERED)]} pending={[]} askPending />,
    );
    expect(document.querySelector('.tool-ask-a')?.textContent).toBe('Red');
    expect(stateRow()).toBeNull();
    expect(answerBtn()).toBeNull();
    unmount();

    // A decline: the existing AskOutcome row, still, with no Answer control
    // bolted on — a result landed, so there is nothing live to answer.
    render(
      <ChatListInner id="s" events={[askUse(), askResult('rejected', true)]} pending={[]} askPending />,
    );
    expect(document.querySelector('.tool-ask-out')).not.toBeNull();
    expect(stateRow()).toBeNull();
    expect(answerBtn()).toBeNull();
  });

  it('askState itself is total and result-first, tested where it is written', () => {
    // The axis is exported and pinned DIRECTLY as well as through the card,
    // so a later refactor that moves the derivation cannot carry the coverage
    // away with it — the lesson D-B4-20 recorded, applied here pre-emptively.
    expect(askState(undefined, true)).toBe('awaiting');
    expect(askState(undefined, false)).toBe('unanswered');
    expect(askState(askResult(ANSWERED) as ToolResultEvent, true)).toBe('answered');
    expect(askState(askResult(ANSWERED) as ToolResultEvent, false)).toBe('answered');
  });

  it('a result landing beats a live envelope — the axis reads the result first', () => {
    // `askPending` is a SESSION-wide fact (the store holds an ask or a
    // dialog); it says nothing about WHICH question is live. A card whose own
    // result has landed is answered, whatever else the session is now asking.
    render(<ChatListInner id="s" events={[askUse(), askResult(ANSWERED)]} pending={[]} askPending />);
    expect(stateRow()).toBeNull();
  });
});

describe('Answer opens the one answer path, and does nothing else', () => {
  it('Answer does not POST anything — it raises the sheet', () => {
    // Negative pin. Every send path this could have reached is spied; the
    // control must touch none of them.
    const answerAsk = vi.spyOn(api, 'answerAsk').mockResolvedValue(undefined as never);
    const answerDialog = vi.spyOn(api, 'answerDialog').mockResolvedValue(undefined as never);
    const prompt = vi.spyOn(api, 'prompt').mockResolvedValue(undefined as never);
    const onAnswer = vi.fn();

    render(<ChatListInner id="s" events={[askUse()]} pending={[]} askPending onAnswer={onAnswer} />);
    fireEvent.click(answerBtn() as HTMLElement);

    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(answerAsk).not.toHaveBeenCalled();
    expect(answerDialog).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });

  it('renders no control at all when the screen gave it nothing to raise', () => {
    // `onAnswer` absent means no sheet is mounted to raise — a button that
    // does nothing is worse than no button.
    render(<ChatListInner id="s" events={[askUse()]} pending={[]} askPending />);
    expect(stateRow()?.className).toContain('ask-live');
    expect(answerBtn()).toBeNull();
  });

  it('Answer un-dismisses a sheet the reader had waved away', () => {
    // D-B4-13: `DialogSheet`'s `dismissedKey` is component-local, so without
    // the `raise` nonce a transcript control could not reopen a sheet the
    // reader had scrim-tapped away. One nonce, cleared into `dismissedKey:
    // null` by an effect — no store change, and no second answer path.
    const store: SessionStore = createSessionStore('s', {
      makeSocket: () => ({
        onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {},
      }) as unknown as WebSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    const dialog: Dialog = {
      id: 'd-1', title: 'Allow Bash?',
      options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }],
      selectedIndex: 1, parsed: true, raw: '❯ 1. Yes\n  2. No',
    };
    act(() => { store.setState({ dialog }); });

    const { rerender } = render(<DialogSheet id="s" store={store} raise={0} />);
    expect(screen.getByText('Allow Bash?')).toBeInTheDocument();

    // Wave it away.
    fireEvent.click(document.querySelector('.sheet-scrim') as HTMLElement);
    expect(screen.queryByText('Allow Bash?')).toBeNull();

    // The transcript control bumps the nonce; the same dialog comes back.
    rerender(<DialogSheet id="s" store={store} raise={1} />);
    expect(screen.getByText('Allow Bash?')).toBeInTheDocument();
  });

  it('the raise nonce at 0 does not itself open anything', () => {
    // The initial value must be inert, or every mount would un-dismiss.
    const store: SessionStore = createSessionStore('s', {
      makeSocket: () => ({
        onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {},
      }) as unknown as WebSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    const ask: HookAsk = { questions: [{ question: 'Which colour?', options: [{ label: 'Red' }] }] };
    act(() => { store.setState({ ask }); });

    render(<DialogSheet id="s" store={store} raise={0} />);
    fireEvent.click(document.querySelector('.sheet-scrim') as HTMLElement);
    expect(screen.queryByText('Which colour?')).toBeNull();
  });
});

describe('the live cue is governed', () => {
  it('the live cue is permitted ONLY in awaiting: .ask-live is the one glow-bearing rule', () => {
    // No-glow governance with ONE NAMED EXCEPTION — the
    // `MAIL_REJECT_CODES`-excludes-`undeliverable` idiom. Every rule whose
    // selector mentions `.ask-` is scanned; `.ask-live` is excluded BY NAME,
    // and the exclusion is asserted to be real so it cannot quietly become a
    // rule that no longer carries a cue.
    const rules = [...stripComments(chatCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => (m[1] ?? '').includes('.ask-'));
    expect(rules.length).toBeGreaterThanOrEqual(4);

    let sawLive = false;
    for (const m of rules) {
      const sel = norm(m[1] ?? '');
      const rule = norm(m[2] ?? '');
      if (sel.includes('.ask-live')) { sawLive = true; continue; }
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
    expect(sawLive).toBe(true);

    // The exception is REAL: `.ask-live` actually carries the cue. Without
    // this, deleting the cue would leave the exclusion above passing over a
    // rule that no longer needs it.
    const live = norm(stripComments(ruleIn(chatCss, '.ask-state.ask-live')));
    expect(live).toContain('--glow');

    // And it is the ONLY one: the unanswered arm goes still.
    const dead = norm(stripComments(ruleIn(chatCss, '.ask-state.ask-unanswered')));
    expect(dead).not.toContain('--glow');
    expect(dead).not.toContain('animation');
  });

  it('the control clears var(--tap-min)', () => {
    expect(declValue(ruleIn(chatCss, '.ask-answer'), 'min-height')).toBe('var(--tap-min)');
  });

  it('dialogs stay screen-hosted — no dialog control is rendered in the transcript', () => {
    // A live DIALOG makes the axis `awaiting` (the sheet hosts both shapes),
    // but the dialog itself never gets a row, an option list or a send in the
    // scrolling list. The transcript raises the sheet; it never becomes one.
    render(<ChatListInner id="s" events={[askUse()]} pending={[]} askPending onAnswer={vi.fn()} />);
    expect(document.querySelector('.dialog-sheet')).toBeNull();
    expect(document.querySelectorAll('.sheet-scrim')).toHaveLength(0);
    // The one button is the raise, and its accessible name says what it does.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute('title') ?? '').toMatch(/sheet/i);
  });
});
