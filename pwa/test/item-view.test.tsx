// The item view (desktop-polish PL5a, D-7712; spec §2 and §3, view 3 of the prototype, minus the secret panel, which is
// PL6). `ItemView` takes `{item, onTick, onDismiss, programmeLive}`; a refused tick comes back as an `ApiError` the
// panel puts in the operator's words, and the button stays enabled so the operator can try again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ITEM_MOVE_REFUSALS, ANSWER_MAX, WAITS_ON_WORDS } from '../../shared/ledgers';
import { LEDGER_ROUTE_REFUSALS } from '../../shared/refusal';
import { ApiError } from '../src/lib/apiError';
import { LEDGER_REFUSAL_TEXT } from '../src/lib/refusalWords';
import { ItemView } from '../src/ledgers/ItemView';
import { MIN, NOW, itemView } from './ledgersFixture';

afterEach(cleanup);

const show = (item = itemView(), over: Partial<React.ComponentProps<typeof ItemView>> = {}) => {
  const onTick = vi.fn(async () => {});
  const onDismiss = vi.fn(async () => {});
  render(<ItemView item={item} onTick={onTick} onDismiss={onDismiss} programmeLive={true} now={NOW} {...over} />);
  return { onTick, onDismiss };
};

describe('the item view', () => {
  it('shows what, why and the how as numbered steps', () => {
    show(itemView({ title: 'Flip the lane', why: 'Old workspaces pile up.', how: ['Open Settings.', 'Set it to Live.'] }));
    expect(screen.getByRole('heading', { name: 'Flip the lane' })).toBeTruthy();
    expect(screen.getByText('Old workspaces pile up.')).toBeTruthy();
    const steps = within(screen.getByRole('list', { name: 'How' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['Open Settings.', 'Set it to Live.']);
  });

  it('the Decide panel posts the chosen option', async () => {
    const { onTick } = show(itemView({ kind: 'decide', options: ['Library first', 'Keep the order'] }));
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true); // nothing chosen yet: no accidental decision
    fireEvent.click(screen.getByRole('radio', { name: 'Keep the order' }));
    fireEvent.click(done);
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('Keep the order'));
  });

  it('the Decide panel offers the options and "Your own answer", and the own-answer field only once it is picked', async () => {
    const { onTick } = show(itemView({ kind: 'decide', options: ['Library first', 'Keep the order'] }));
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).labels?.[0]?.textContent))
      .toEqual(['Library first', 'Keep the order', 'Your own answer']);
    expect(screen.queryByRole('textbox', { name: /your own answer/i })).toBeNull();
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole('radio', { name: 'Your own answer' }));
    expect(done.disabled).toBe(true); // own answer picked but empty
    fireEvent.change(screen.getByRole('textbox', { name: /your own answer/i }), { target: { value: '  Neither: ship both  ' } });
    expect(done.disabled).toBe(false);
    fireEvent.click(done);
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('Neither: ship both'));
  });

  it('a note to the coordinator rides inside the answer: the choice, a blank line, then "Note: <note>"', async () => {
    const { onTick } = show(itemView({ kind: 'decide', options: ['Library first', 'Keep the order'] }));
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    fireEvent.change(screen.getByRole('textbox', { name: /note to the coordinator/i }), { target: { value: 'Mind the lane flag.' } });
    expect(done.disabled).toBe(true); // a note alone is not a decision
    fireEvent.click(screen.getByRole('radio', { name: 'Library first' }));
    fireEvent.click(done);
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('Library first\n\nNote: Mind the lane flag.'));
  });

  it('"Your own answer" left empty is no decision: a note alone does not enable Mark done', () => {
    const { onTick } = show(itemView({ kind: 'decide', options: ['Library first'] }));
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole('radio', { name: 'Your own answer' }));
    fireEvent.change(screen.getByRole('textbox', { name: /note to the coordinator/i }), { target: { value: 'just a note' } });
    expect(done.disabled).toBe(true);
    fireEvent.click(done);
    expect(onTick).not.toHaveBeenCalled();
    // …and blank own text, however many spaces, is still no decision.
    fireEvent.change(screen.getByRole('textbox', { name: /your own answer/i }), { target: { value: '   ' } });
    expect(done.disabled).toBe(true);
  });

  it('an own answer and a note go together, and a blank note adds nothing', async () => {
    const { onTick } = show(itemView({ kind: 'decide', options: ['Library first'] }));
    fireEvent.click(screen.getByRole('radio', { name: 'Your own answer' }));
    fireEvent.change(screen.getByRole('textbox', { name: /your own answer/i }), { target: { value: 'Both' } });
    fireEvent.change(screen.getByRole('textbox', { name: /note to the coordinator/i }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('Both'));
    cleanup();
    const second = show(itemView({ kind: 'decide', options: ['Library first'] }));
    fireEvent.click(screen.getByRole('radio', { name: 'Your own answer' }));
    fireEvent.change(screen.getByRole('textbox', { name: /your own answer/i }), { target: { value: 'Both' } });
    fireEvent.change(screen.getByRole('textbox', { name: /note to the coordinator/i }), { target: { value: 'Because.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(second.onTick).toHaveBeenCalledWith('Both\n\nNote: Because.'));
  });

  it('the whole answer, note included, is held to the server\'s limit by maxLength and a visible count', () => {
    const { onTick } = show(itemView({ kind: 'decide', options: ['Library first'] }));
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole('radio', { name: 'Library first' }));
    const note = screen.getByRole('textbox', { name: /note to the coordinator/i }) as HTMLInputElement;
    // room for the note = the limit less the choice and the "\n\nNote: " that joins them
    expect(note.maxLength).toBe(ANSWER_MAX - 'Library first'.length - '\n\nNote: '.length);
    expect(screen.getByText(`${'Library first'.length} of ${ANSWER_MAX} characters`)).toBeTruthy();
    fireEvent.change(note, { target: { value: 'x'.repeat(100) } });
    expect(screen.getByText(`${'Library first'.length + '\n\nNote: '.length + 100} of ${ANSWER_MAX} characters`)).toBeTruthy();
    // a value past the limit (a paste can outrun maxLength in some browsers) is not sent
    fireEvent.change(note, { target: { value: 'x'.repeat(ANSWER_MAX) } });
    expect(done.disabled).toBe(true);
    expect(onTick).not.toHaveBeenCalled();
    cleanup();
    show(itemView({ kind: 'decide', options: ['Library first'] }));
    fireEvent.click(screen.getByRole('radio', { name: 'Your own answer' }));
    expect((screen.getByRole('textbox', { name: /your own answer/i }) as HTMLInputElement).maxLength).toBe(ANSWER_MAX);
    fireEvent.change(screen.getByRole('textbox', { name: /note to the coordinator/i }), { target: { value: 'abc' } });
    expect((screen.getByRole('textbox', { name: /your own answer/i }) as HTMLInputElement).maxLength)
      .toBe(ANSWER_MAX - '\n\nNote: abc'.length);
  });

  it('a value field has the limit and the count too', () => {
    show(itemView({ kind: 'value', title: 'Review rounds' }));
    const field = screen.getByRole('textbox', { name: /your value/i }) as HTMLInputElement;
    expect(field.maxLength).toBe(ANSWER_MAX);
    fireEvent.change(field, { target: { value: '1234' } });
    expect(screen.getByText(`4 of ${ANSWER_MAX} characters`)).toBeTruthy();
    fireEvent.change(field, { target: { value: 'x'.repeat(ANSWER_MAX + 1) } });
    expect((screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Give a value posts the typed value', async () => {
    const { onTick } = show(itemView({ kind: 'value', title: 'Review rounds' }));
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: /your value/i }), { target: { value: '4' } });
    fireEvent.click(done);
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('4'));
  });

  it('Do posts no answer', async () => {
    const { onTick } = show(itemView({ kind: 'do' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    expect(onTick).toHaveBeenCalledWith();
  });

  it('a refused tick shows the refusal sentence and leaves the button enabled', async () => {
    const onTick = vi.fn(async () => { throw new ApiError(409, { ok: false, error: 'programme-ended' }); });
    show(itemView({ kind: 'do' }), { onTick });
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    fireEvent.click(done);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/no open run|dismiss/i);
    expect(done.disabled).toBe(false);
  });

  it('every refusal the tick, dismiss and list routes name has a sentence, not a bare slug', async () => {
    const codes = Object.keys(LEDGER_REFUSAL_TEXT);
    for (const code of codes) {
      const onTick = vi.fn(async () => { throw new ApiError(409, { ok: false, error: code }); });
      show(itemView({ kind: 'do' }), { onTick });
      fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent, code).toBe(LEDGER_REFUSAL_TEXT[code as keyof typeof LEDGER_REFUSAL_TEXT]);
      expect(alert.textContent!.length, code).toBeGreaterThan(20);
      cleanup();
    }
  });

  it('the sentence table is the routes\' own codes, so a new code cannot slip by without a sentence', () => {
    // The coordinator-only routes' words; the operator routes (tick, dismiss, the list) name every other one.
    const COORDINATOR_ONLY: readonly string[] = [
      LEDGER_ROUTE_REFUSALS.notYourProgramme, LEDGER_ROUTE_REFUSALS.badSpecPath, LEDGER_ROUTE_REFUSALS.badInShort,
      'wrong-actor', // an operator's own tick and dismiss are never the wrong actor
    ];
    const operatorCodes = [...Object.values(LEDGER_ROUTE_REFUSALS), ...ITEM_MOVE_REFUSALS].filter((c) => !COORDINATOR_ONLY.includes(c));
    // …and the three the routes send with no word of their own: a refused body, a duplicate tick, a box without the store.
    const generic = ['bad-request', 'duplicate', 'not-configured'];
    expect([...new Set([...operatorCodes, ...generic])].sort()).toEqual(Object.keys(LEDGER_REFUSAL_TEXT).sort());
  });

  it('the programme-unclaimed sentence never says to dismiss: a dismiss is refused while its run is open', () => {
    expect(LEDGER_REFUSAL_TEXT['programme-unclaimed']).not.toMatch(/dismiss/i);
    expect(LEDGER_REFUSAL_TEXT['programme-unclaimed']).toMatch(/abandon/i);
  });

  it('a checking item reads Checking… and offers no second tick', () => {
    show(itemView({ state: 'checking', tickedAt: NOW - 2 * MIN }));
    expect(screen.getByText(/Checking…/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('a stale checking item says the coordinator is not responding, whatever made it stale', () => {
    show(itemView({ state: 'checking', stale: true, tickedAt: NOW - 50 * MIN }));
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/the coordinator is not responding/);
    // Stale is also a coordinator that read the tick and went away: the sentence never says it did not pick it up.
    expect(status.textContent).not.toMatch(/picked it up/);
    expect(status.getAttribute('data-stale')).toBe('true');
  });

  it('a needed-by label is on the item whatever its state', () => {
    show(itemView({ state: 'checking', neededBy: 'blocking', tickedAt: NOW - 2 * MIN }));
    const band = document.querySelector('.wi-band') as HTMLElement;
    expect(within(band).getByText('Checking…')).toBeTruthy();
    expect(within(band).getByText('Blocking')).toBeTruthy();
    cleanup();
    show(itemView({ neededBy: 'blocking', history: [{ at: 1, act: 'raise', note: null }, { at: 2, act: 'return', note: 'no' }] }));
    const back = document.querySelector('.wi-band') as HTMLElement;
    expect(within(back).getByText('Came back')).toBeTruthy();
    expect(within(back).getByText('Blocking')).toBeTruthy();
  });

  it('shows a sent-back note as history, never as the current state', () => {
    show(itemView({
      note: 'A different line on the item.',
      history: [
        { at: NOW - 3 * 60 * MIN, act: 'raise', note: null }, { at: NOW - 2 * 60 * MIN, act: 'tick', note: null },
        { at: NOW - 60 * MIN, act: 'return', note: 'Settings still shows record only.' },
      ],
    }));
    expect(screen.getByText(/sent back: Settings still shows record only\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeTruthy(); // it is open again
  });

  it('an ended programme\'s item offers only Dismiss, with the one line that says why', async () => {
    const { onDismiss, onTick } = show(itemView({ kind: 'value' }), { programmeLive: false });
    expect(screen.getByText(WAITS_ON_WORDS.ended)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull(); // nothing to fill in for a tick that would be refused
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onTick).not.toHaveBeenCalled();
  });

  it('an ended programme\'s item being checked says the same and offers Dismiss', () => {
    show(itemView({ state: 'checking', tickedAt: NOW - MIN }), { programmeLive: false });
    expect(screen.getByText(WAITS_ON_WORDS.ended)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('a live programme never shows the ended line, offers no Dismiss, and offers Mark done', () => {
    for (const item of [itemView(), itemView({ state: 'checking', tickedAt: NOW - MIN })]) {
      show(item, { programmeLive: true });
      expect(screen.queryByText(WAITS_ON_WORDS.ended)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
      cleanup();
    }
    show(itemView(), { programmeLive: true });
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeTruthy();
  });

  it('a cleared item has neither a move nor the ended line', () => {
    show(itemView({ state: 'done', closedAt: NOW - MIN }), { programmeLive: false });
    expect(screen.queryByText(WAITS_ON_WORDS.ended)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a secret item has no input and no tick here (the paste panel is a later wave)', () => {
    show(itemView({ kind: 'secret', title: 'Paste the publish token', secretSlot: 'npm-token' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('never renders the answer of a secret item', () => {
    show(itemView({ kind: 'secret', state: 'checking', answer: 'set 1800 ending ab12' }));
    expect(document.body.textContent).not.toMatch(/ending ab12/);
  });
});
