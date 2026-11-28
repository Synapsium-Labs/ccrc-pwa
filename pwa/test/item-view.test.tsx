// The item view (desktop-polish PL5a, D-7712; spec §2 and §3, view 3 of the prototype, minus the secret panel, which is
// PL6). `ItemView` takes `{item, onTick, onDismiss, programmeLive}`; a refused tick comes back as an `ApiError` the
// panel puts in the operator's words, and the button stays enabled so the operator can try again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ITEM_MOVE_REFUSALS, ANSWER_MAX, WAITS_ON_WORDS, endRunAction, releaseReviewAction } from '../../shared/ledgers';
import { api } from '../src/lib/api';
import { run as runFixture } from './rollupFixture';
import { LEDGER_ROUTE_REFUSALS } from '../../shared/refusal';
import { ApiError } from '../src/lib/apiError';
import { LEDGER_REFUSAL_TEXT } from '../src/lib/refusalWords';
import { ItemView } from '../src/ledgers/ItemView';
import { MIN, NOW, itemView } from './ledgersFixture';
import { READINESS_ITEM_TEXT } from '../../shared/overlord-readiness';
import { OVERLORD_ITEM_PROGRAMME } from '../../shared/overlord-sequence';
import { FACT_WORDS } from '../src/overlord/overlordSettingsWords';
import { EARLIER_HISTORY_WORD } from '../src/ledgers/ledgerWords';

afterEach(cleanup);

/** The hint under a Do item's optional note (D-8931). */
const DO_NOTE_HINT = 'Some items ask for one, such as who did each step and when. The coordinator checks the result itself and either closes the item or sends it back with what it found.';

const show = (item = itemView(), over: Partial<React.ComponentProps<typeof ItemView>> = {}) => {
  const onTick = vi.fn(async () => {});
  const onDismiss = vi.fn(async () => {});
  render(<ItemView item={item} onTick={onTick} onDismiss={onDismiss} programmeLive={true} now={NOW} {...over} />);
  return { onTick, onDismiss };
};

describe('the item view\'s migration body', () => {
  it('is handed the structure and the report, and draws both', () => {
    show(itemView({ action: { verb: 'linear-report', migrationId: 3 } }), { migration: {
      counts: { created: 1, moved: 1, closed: 0, left: 0, skipped: 1 }, entries: [],
      structure: [{ programme: 'prog-a', title: null, backlog: false, declared: false, epics: [] }],
      report: { skipped: ['AAA-5'], waiting: ['AAA-6'], movedSince: [], milestonesLeft: [] },
    } });
    expect([...document.querySelectorAll('[data-report-list]')].map((l) => l.getAttribute('data-report-list'))).toEqual(['skipped', 'waiting']);
  });
  it('a map item draws the structure it is handed', () => {
    show(itemView({ action: { verb: 'linear-map', migrationId: 3 } }), { migration: {
      counts: { created: 1, moved: 1, closed: 0, left: 0, skipped: 0 }, entries: [],
      structure: [{ programme: 'prog-a', title: 'Programme A', backlog: true, declared: false, epics: [] }], report: null,
    } });
    expect(document.querySelector('[data-structure-programme="prog-a"]')).not.toBeNull();
  });
});

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

  // D-8931: a Do item's tick may carry an optional note, because a coordinator may ask for one in the item's steps.
  it('a Do item offers an optional note to the coordinator, with the hint that some items ask for one', () => {
    show(itemView({ kind: 'do' }));
    // The label wraps its hint, as the value field's does, so the name starts with the label's words.
    const note = screen.getByRole('textbox', { name: /^Note to the coordinator \(optional\)/ }) as HTMLInputElement;
    expect(note.maxLength).toBe(ANSWER_MAX);
    expect(note.value).toBe('');
    const panel = screen.getByRole('region', { name: 'Your move' });
    expect(within(panel).getAllByRole('textbox')).toEqual([note]);
    expect(panel.textContent).toContain(DO_NOTE_HINT);
    expect(panel.textContent).not.toContain('Nothing to fill in');
    // The note is optional: Mark done is on with the field empty, and no count is drawn for a note that is not there.
    expect((screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement).disabled).toBe(false);
    expect(panel.textContent).not.toContain(`of ${ANSWER_MAX} characters`);
  });

  it('Do posts no answer when the note is left empty, or holds only spaces', async () => {
    const { onTick } = show(itemView({ kind: 'do' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    expect(onTick.mock.calls[0]).toEqual([]);
    cleanup();
    const spaced = show(itemView({ kind: 'do' }));
    fireEvent.change(screen.getByRole('textbox', { name: /note to the coordinator/i }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(spaced.onTick).toHaveBeenCalledTimes(1));
    expect(spaced.onTick.mock.calls[0]).toEqual([]);
  });

  it('Do posts the note, trimmed, when one is typed, and nothing joined to it', async () => {
    const { onTick } = show(itemView({ kind: 'do' }));
    fireEvent.change(screen.getByRole('textbox', { name: /note to the coordinator/i }), { target: { value: '  An administrator did step 1 at 14:05 UTC.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    expect(onTick.mock.calls[0]).toEqual(['An administrator did step 1 at 14:05 UTC.']);
  });

  it('a Do note has the limit and the count too, and a note past the limit is not sent', () => {
    const { onTick } = show(itemView({ kind: 'do' }));
    const note = screen.getByRole('textbox', { name: /note to the coordinator/i }) as HTMLInputElement;
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    fireEvent.change(note, { target: { value: ' 1234 ' } });
    expect(screen.getByText(`4 of ${ANSWER_MAX} characters`)).toBeTruthy();
    expect(done.disabled).toBe(false);
    // a paste can outrun maxLength in some browsers
    fireEvent.change(note, { target: { value: 'x'.repeat(ANSWER_MAX + 1) } });
    expect(done.disabled).toBe(true);
    fireEvent.click(done);
    expect(onTick).not.toHaveBeenCalled();
    fireEvent.change(note, { target: { value: 'x'.repeat(ANSWER_MAX) } });
    expect(done.disabled).toBe(false);
  });

  it('a Do item that is being checked, or whose programme has ended, offers no note field', () => {
    show(itemView({ kind: 'do', state: 'checking', tickedAt: NOW - MIN, answer: 'Done at noon.' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    cleanup();
    show(itemView({ kind: 'do' }), { programmeLive: false });
    expect(screen.queryByRole('textbox')).toBeNull();
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
      // The goals routes' definition-of-done words (D-8126) are the coordinator's, never an operator door's.
      LEDGER_ROUTE_REFUSALS.badDoneWhen, LEDGER_ROUTE_REFUSALS.doneWhenNeedsRuling,
      'wrong-actor', // an operator's own tick and dismiss are never the wrong actor
    ];
    const operatorCodes = [...Object.values(LEDGER_ROUTE_REFUSALS), ...ITEM_MOVE_REFUSALS].filter((c) => !COORDINATOR_ONLY.includes(c));
    // …and the three the routes send with no word of their own: a refused body, a duplicate tick, a box without the store; and
    // the two asks' words the answer-mark door's ask arm sends (answer marks B), which are the question lane's, not the ledger's.
    const generic = ['bad-request', 'duplicate', 'not-configured', 'unknown-ask', 'ask-unreadable'];
    expect([...new Set([...operatorCodes, ...generic])].sort()).toEqual(Object.keys(LEDGER_REFUSAL_TEXT).sort());
  });

  // Review 1440 F2 (desktop-polish PL10): the sentence says what is stored, that nothing was saved, and the operator's own door.
  it('the secret-name-collides sentence says a secret is stored under another spelling, nothing was saved, and how to clear it', () => {
    const t = LEDGER_REFUSAL_TEXT['secret-name-collides'];
    expect(t).toMatch(/already stored under a name spelled differently/);
    expect(t).toMatch(/nothing was saved/);
    expect(t).toMatch(/Remove that stored secret/);
    expect(t).not.toMatch(/raise the item again/);
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

  it('a raise by ccrc is not credited to the coordinator', () => {
    show(itemView({ history: [{ at: 1, act: 'raise', note: null, actor: 'ccrc' }] }));
    const li = document.querySelector('.wi-history li') as HTMLElement;
    expect(li.textContent).toContain('Raised for you, its coordinator did not answer');
    expect(li.textContent).not.toContain('Raised by the coordinator');
    cleanup();
    show(itemView({ history: [{ at: 1, act: 'raise', note: null, actor: 'coordinator' }] }));
    expect((document.querySelector('.wi-history li') as HTMLElement).textContent).toContain('Raised by the coordinator');
  });

  it('shows a sent-back note as history, never as the current state', () => {
    show(itemView({
      note: 'A different line on the item.',
      history: [
        { at: NOW - 3 * 60 * MIN, act: 'raise', note: null }, { at: NOW - 2 * 60 * MIN, act: 'tick', note: null },
        { at: NOW - 60 * MIN, act: 'return', note: 'Settings still shows record only.' },
      ],
    }));
    // In the history (desktop-polish wave 186: the act, then its note under it), and read first under the title.
    const returned = [...document.querySelectorAll('.wi-history li')].at(-1) as HTMLElement;
    expect(returned.querySelector('.wi-act-line')?.textContent).toMatch(/^Sent back by the coordinator · /);
    expect(returned.querySelector('.wi-note')?.textContent).toBe('Settings still shows record only.');
    expect(document.querySelector('.wi-came-back')?.textContent).toBe('Why it came backSettings still shows record only.');
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

  it('a secret item has no text input and no tick: its one field is the secret panel\'s password field (plan PL6, item-secret.test.tsx)', () => {
    show(itemView({ kind: 'secret', title: 'Paste the publish token', secretSlot: 'npm-token' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('never renders the answer of a secret item', () => {
    show(itemView({ kind: 'secret', state: 'checking', answer: 'set 1800 ending ab12' }));
    expect(document.body.textContent).not.toMatch(/ending ab12/);
  });
});

describe('the recommendation on a decide item (plan PL9; spec §3.2, D24)', () => {
  const WHY = 'Keeping the order lands the reviewed waves first; the library first would hold two reviews for a week.';
  const decide = (over: Partial<ReturnType<typeof itemView>> = {}) =>
    itemView({ kind: 'decide', options: ['Library first', 'Keep the order', 'Split the wave'], recommended: 1, recommendedWhy: WHY, ...over });

  it('the item view marks the recommended option and shows its reasons beside the choices, before the pick', () => {
    show(decide());
    const marks = screen.getAllByText('Recommended');
    expect(marks).toHaveLength(1);
    // The mark is inside the recommended option's own row, so it names that option and no other.
    expect(marks[0]!.closest('label')?.textContent).toContain('Keep the order');
    expect(screen.getByRole('radio', { name: /Keep the order/ }).closest('label')?.querySelector('[data-recommended="true"]')).not.toBeNull();
    expect(screen.getByRole('radio', { name: /Library first/ }).closest('label')?.querySelector('[data-recommended]')).toBeNull();
    // The option's whole name, with a real space before the mark: a gap drawn by CSS alone would read "orderRecommended".
    expect(screen.getByRole('radio', { name: 'Keep the order Recommended' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Library first' })).toBeTruthy();
    // The choices name the reasons as their description, so a screen reader hears why beside them.
    const group = screen.getByRole('group', { name: 'Your decision' });
    expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toContain(WHY);
    // The reasons are on screen before anything is picked, in the decision's panel, and nothing is picked for the operator.
    const why = screen.getByRole('region', { name: 'Why it is recommended' });
    expect(why.textContent).toContain(WHY);
    expect(screen.getByRole('group', { name: 'Your decision' }).closest('section')?.contains(why)).toBe(true);
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect((screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the operator may still pick another option, and the answer is that option\'s words alone', async () => {
    const { onTick } = show(decide());
    fireEvent.click(screen.getByRole('radio', { name: /Split the wave/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('Split the wave'));
    cleanup();
    const second = show(decide());
    fireEvent.click(screen.getByRole('radio', { name: /Keep the order/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(second.onTick).toHaveBeenCalledWith('Keep the order')); // never "Keep the order Recommended"
  });

  it('or write their own', async () => {
    const { onTick } = show(decide());
    fireEvent.click(screen.getByRole('radio', { name: 'Your own answer' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Your own answer' }), { target: { value: 'Neither: wait a week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('Neither: wait a week'));
  });

  it('an item raised before the rule draws as before: no mark and no reasons', () => {
    show(decide({ recommended: null, recommendedWhy: null }));
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Why it is recommended' })).toBeNull();
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['Library first', 'Keep the order', 'Split the wave', 'Your own answer']);
  });

  it('an item from a server before PL9, which sends neither field, draws as before too', () => {
    const { recommended: _r, recommendedWhy: _w, ...older } = decide();
    show(older as ReturnType<typeof itemView>);
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Why it is recommended' })).toBeNull();
  });

  it('a long reason and six options all draw, the mark on the sixth', () => {
    const six = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    show(decide({ options: six, recommended: 5, recommendedWhy: 'x'.repeat(2000) }));
    expect(screen.getAllByRole('radio')).toHaveLength(7);
    expect(screen.getByText('Recommended').closest('label')?.textContent).toContain('Six');
    expect(screen.getByRole('region', { name: 'Why it is recommended' }).textContent).toContain('x'.repeat(2000));
  });
});

// Desktop-polish PL10 (D-7952; spec §2, D26 to D28): the band names the programme as a door to its view and links its pinned
// spec; links in the item's text are links (`linkRuns`), a document path opening in the Docs reader of the programme's home.
describe('the item view: the spec one tap away, and links that work (PL10)', () => {
  const SPEC_HREF = '/docs/project-a/specs/2026-10-31-prog-a-design.md';
  const PROG = { name: 'Programme A', hue: null, href: '/programmes/prog-a', specHref: SPEC_HREF, homeProject: 'project-a' };
  afterEach(() => { history.replaceState(null, '', '/'); });

  it('the item band links the pinned spec', () => {
    show(itemView(), { programme: PROG });
    const band = document.querySelector<HTMLElement>('.wi-band')!;
    const spec = within(band).getByRole('link', { name: 'Spec for Programme A' });
    expect(spec.getAttribute('href')).toBe(SPEC_HREF);
    fireEvent.click(spec);
    expect(location.pathname).toBe(SPEC_HREF);
  });

  it('no spec link is drawn without a pin', () => {
    show(itemView(), { programme: { ...PROG, specHref: null } });
    expect(within(document.querySelector<HTMLElement>('.wi-band')!).queryByRole('link', { name: /^Spec/ })).toBeNull();
    // Not even as words: a link with no address is no `link` role, so the words are what a dead "Spec" leaves (review 1466 F15).
    expect(within(document.querySelector<HTMLElement>('.wi-band')!).queryByText('Spec')).toBeNull();
  });

  it("the band's programme name opens the programme view", () => {
    show(itemView(), { programme: PROG });
    const name = within(document.querySelector<HTMLElement>('.wi-band')!).getByRole('link', { name: 'Programme A' });
    expect(name.getAttribute('href')).toBe('/programmes/prog-a');
    fireEvent.click(name);
    expect(location.pathname).toBe('/programmes/prog-a');
    cleanup();
    // A programme the console cannot open draws its name as words.
    show(itemView(), { programme: { ...PROG, href: null } });
    expect(within(document.querySelector<HTMLElement>('.wi-band')!).queryByRole('link', { name: 'Programme A' })).toBeNull();
    expect(document.querySelector('.wi-band')!.textContent).toContain('Programme A');
  });

  it('https, console paths and document paths in item text are links', () => {
    show(itemView({
      title: 'Read docs/superpowers/specs/a-design.md',
      why: 'See https://example.com/page and /runs for the state.',
      how: ['Open /programmes/prog-a', 'Then read docs/superpowers/plans/p.md'],
      history: [{ at: NOW - MIN, act: 'raise', note: null }, { at: NOW, act: 'return', note: 'see https://example.com/why' }],
    }), { programme: PROG });
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('docs/superpowers/specs/a-design.md')).toBe('/docs/project-a/specs/a-design.md');
    expect(href('https://example.com/page')).toBe('https://example.com/page');
    expect(href('/runs')).toBe('/runs');
    expect(href('/programmes/prog-a')).toBe('/programmes/prog-a');
    expect(href('docs/superpowers/plans/p.md')).toBe('/docs/project-a/plans/p.md');
    // The sent-back note links under the title (wave 186) and in the history alike.
    expect(screen.getAllByRole('link', { name: 'https://example.com/why' }).map((a) => a.getAttribute('href')))
      .toEqual(['https://example.com/why', 'https://example.com/why']);
    // The words around them are drawn as they were (the Why section's text: the came-back line above it is a `.wi-text` too).
    const why = [...document.querySelectorAll('.wi-card > section')].find((s) => s.querySelector('.wi-h')?.textContent === 'Why')!;
    expect(why.querySelector('.wi-text')!.textContent).toBe('See https://example.com/page and /runs for the state.');
  });

  // Review 1466 F5: a document link outside the console is text wherever the console draws item text, a return's note included,
  // as the routes refuse it (`linksDocumentOutside`, the one decider).
  it('an artifact page or an outside document server stays text, in the text and in a return note', () => {
    show(itemView({
      why: 'See https://claude.ai/artifact/abc and https://b.example/docs/p/specs/a.md.',
      history: [{ at: NOW - MIN, act: 'raise', note: null }, { at: NOW, act: 'return', note: 'see https://claude.ai/public/artifacts/abc' }],
    }), { programme: PROG });
    expect(document.querySelector('.wi-text')!.querySelectorAll('a')).toHaveLength(0);
    expect(document.querySelector('.wi-history')!.querySelectorAll('a')).toHaveLength(0);
    expect(document.querySelector('.wi-history .wi-note')!.textContent).toBe('see https://claude.ai/public/artifacts/abc');
    // The same note, read first under the title, is text there too.
    expect(document.querySelector('.wi-came-back')!.querySelectorAll('a')).toHaveLength(0);
  });

  it('a javascript or data address stays text', () => {
    show(itemView({ why: 'javascript:alert(1) and JavaScript:alert(2) and data:text/html,<b>x</b> and vbscript:msgbox(1)' }), { programme: PROG });
    expect(document.querySelector('.wi-text')!.querySelectorAll('a')).toHaveLength(0);
    expect(document.querySelector('.wi-text')!.textContent).toContain('javascript:alert(1)');
  });

  it('a document path opens in the Docs reader', () => {
    show(itemView({ why: 'Read docs/superpowers/specs/a-design.md.' }), { programme: PROG });
    const link = screen.getByRole('link', { name: 'docs/superpowers/specs/a-design.md' });
    fireEvent.click(link);
    expect(location.pathname).toBe('/docs/project-a/specs/a-design.md');
    cleanup();
    // With no home project to open it in, the path stays text.
    show(itemView({ why: 'Read docs/superpowers/specs/a-design.md.' }), { programme: { ...PROG, homeProject: null } });
    expect(screen.queryByRole('link', { name: 'docs/superpowers/specs/a-design.md' })).toBeNull();
  });

  it('an outside link opens with no opener', () => {
    show(itemView({ why: 'See https://example.com/page.' }), { programme: PROG });
    const link = screen.getByRole('link', { name: 'https://example.com/page' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')!.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
    // A tap opens a real new context through `openExternal`, so an installed app's own window never navigates (review 1466 F10).
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      fireEvent.click(link);
      expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer');
      expect(location.pathname).toBe('/');
    } finally {
      open.mockRestore();
    }
    // An in-console link stays in this tab: its click is the console's own navigation.
    cleanup();
    show(itemView({ why: 'Open /runs.' }), { programme: PROG });
    fireEvent.click(screen.getByRole('link', { name: '/runs' }));
    expect(location.pathname).toBe('/runs');
  });
});

describe('an end-request item in the item view (Task 24, spec 2026-11-04 §10; D-8076)', () => {
  const live = runFixture(7, 'coord', 'w-7');
  const endItem = (over: Partial<ReturnType<typeof itemView>> = {}) => itemView({
    id: 31, runId: 7, title: 'End run: Port the API, wave 1', why: 'It never started.\nIts coordinator is gone',
    action: endRunAction(7, null), ...over,
  });

  it('carries Abandon run and Keep the run, and neither Mark done nor Dismiss', () => {
    show(endItem(), { runs: [live] });
    expect(screen.getByRole('button', { name: 'Abandon run' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep the run' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
    cleanup();
    show(endItem(), { runs: [live], programmeLive: false });
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep the run' })).toBeTruthy();
  });

  it('Abandon run opens the single sheet and its confirm calls act; Keep the run calls decline; both step back', async () => {
    const act = vi.spyOn(api, 'actItem').mockResolvedValue({ released: true });
    const decline = vi.spyOn(api, 'declineItem').mockResolvedValue({ ok: true, item: endItem({ state: 'dismissed' }) });
    const onActed = vi.fn();
    show(endItem(), { runs: [live], onActed });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abandon run 7' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith(31));
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Keep the run' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep the run' }));
    await waitFor(() => expect(decline).toHaveBeenCalledWith(31));
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(2));
  });

  it('an ordinary item carries neither control, and an end-run item already closed carries none', () => {
    show(itemView(), { runs: [live] });
    expect(screen.queryByRole('button', { name: /Abandon run|Keep the run/ })).toBeNull();
    cleanup();
    show(endItem({ state: 'done', closedAt: NOW }), { runs: [live] });
    expect(screen.queryByRole('button', { name: /Abandon run|Keep the run/ })).toBeNull();
  });
});

describe('a release-review item in the item view (D-8293)', () => {
  const releaseItem = (over: Partial<ReturnType<typeof itemView>> = {}) => itemView({
    id: 51, runId: 7, title: 'Review workspace kept: Port the API · review of wave 1',
    why: 'This review\'s workspace (demo-rv) is kept.\nNo coordinator on record', action: releaseReviewAction(7, 9, 'demo-rv'), ...over,
  });

  it('carries Release workspace and no Mark done; its confirm calls act and steps back', async () => {
    const release = vi.spyOn(api, 'releaseReviewItem').mockResolvedValue({ ok: true, released: true, item: releaseItem({ state: 'done' }) });
    const onActed = vi.fn();
    show(releaseItem(), { runs: [], onActed });
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Release workspace' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Release workspace' }));
    await waitFor(() => expect(release).toHaveBeenCalledWith(51));
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
  });
});

// D-8194: the item's page carries its number, so a coordinator's "item 129" can be matched to it.
describe('the item\'s number (D-8194)', () => {
  it('the page shows the item\'s own id as #<id>', () => {
    show(itemView({ id: 129, title: 'Flip the lane' }));
    expect(screen.getByText('#129')).toBeTruthy();
  });
});

// D-8194: "item N" in an item's text is a link to that item's page when the page knows it is an item (`itemHref`), and a closed
// item opens read-only: it says it is closed and offers no act.
describe('item references and a closed item (D-8194)', () => {
  const KNOWN = new Set([12, 13, 40]);
  const itemHref = (id: number): string | null => (KNOWN.has(id) ? `/waiting/${id}` : null);

  it('"item N" in the why, a step and a sent-back note is a link to that item\'s page; a number no item has stays text', () => {
    show(itemView({
      id: 5, why: 'It waits on item 12, not item 99.', how: ['Do items 13 and 40 first.'],
      history: [{ at: NOW - MIN, act: 'raise', note: null }, { at: NOW, act: 'return', note: 'See item #12.' }],
    }), { itemHref });
    const hrefs = screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);
    // The sent-back note is read first under the title (wave 186) and kept in the history, so it links in both.
    expect(hrefs).toEqual([
      ['item #12', '/waiting/12'], ['item 12', '/waiting/12'], ['items 13', '/waiting/13'], ['40', '/waiting/40'], ['item #12', '/waiting/12'],
    ]);
    expect(screen.getByText(/not item 99\./)).toBeTruthy();
  });

  it('without an itemHref no number is a link', () => {
    show(itemView({ why: 'It waits on item 12.' }));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it.each([
    ['done', 'This item is done.'], ['withdrawn', 'The coordinator withdrew this item.'], ['dismissed', 'You dismissed this item.'],
  ] as const)('a %s item opens read-only: it says so, and offers neither Mark done nor Dismiss', (state, words) => {
    show(itemView({ state, closedAt: NOW - MIN }), { programmeLive: false });
    const panel = screen.getByRole('region', { name: 'Your move' });
    expect(panel.textContent).toContain(words);
    expect(within(panel).queryAllByRole('button')).toEqual([]);
  });

  it('a closed decide item draws no choices to make', () => {
    show(itemView({ kind: 'decide', options: ['A', 'B'], state: 'done', closedAt: NOW - MIN, answer: 'A' }));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('the answer marks on an item\'s page (Overlord W1)', () => {
  const MARKS = { couldAnswer: { state: 'marked' as const, id: 4, at: NOW - MIN, signedIn: true }, unsure: { state: 'never' as const } };
  it('draws both boxes in its panel when the item carries answerMarks, before and after the answer', () => {
    show(itemView({ kind: 'value', answerMarks: MARKS }));
    const panel = screen.getByRole('region', { name: 'Your move' });
    const boxes = within(panel).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, false], [false, false]]);
    cleanup();
    show(itemView({ kind: 'value', state: 'done', closedAt: NOW - MIN, answerMarks: MARKS }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
  it('draws none when the field is absent, and disables both on a saved copy', () => {
    show(itemView({ kind: 'decide' }));
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    cleanup();
    show(itemView({ kind: 'value', answerMarks: MARKS }), { current: false });
    for (const b of screen.getAllByRole('checkbox') as HTMLInputElement[]) expect(b.disabled).toBe(true);
  });
  // Answer marks C (#2900): a task's page draws one box, worded for a task, open and cleared.
  it('a do item draws one box, "The Overlord could handle this", open and done, and none for unsure', () => {
    for (const o of [{}, { state: 'done' as const, closedAt: NOW - MIN }]) {
      show(itemView({ kind: 'do', ...o, answerMarks: { couldAnswer: MARKS.couldAnswer } }));
      const panel = screen.getByRole('region', { name: 'Your move' });
      const boxes = within(panel).getAllByRole('checkbox') as HTMLInputElement[];
      expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([[true, false]]);
      expect(within(panel).getByLabelText('The Overlord could handle this')).toBe(boxes[0]);
      expect(within(panel).queryByLabelText("I'm not sure of my answer")).toBeNull();
      cleanup();
    }
  });
});

describe('the item read top to bottom, its text as Markdown (desktop-polish wave 186)', () => {
  const RETURNED = [
    { at: NOW - 50 * MIN, act: 'raise' as const, note: null }, { at: NOW - 40 * MIN, act: 'tick' as const, note: null },
    { at: NOW - 30 * MIN, act: 'return' as const, note: 'The first note.' }, { at: NOW - 20 * MIN, act: 'tick' as const, note: null },
    { at: NOW - 10 * MIN, act: 'return' as const, note: 'Run `ccrc doctor` on the **right** box.' },
  ];

  it('"Your move" is the last block, after the history; a decision\'s options stay inside it', () => {
    show(itemView({ kind: 'decide', options: ['Keep it', 'Drop it'], recommended: 0, recommendedWhy: 'It costs less.' }));
    const card = document.querySelector('.wi-detail > .wi-card')!;
    const move = document.querySelector('.wi-detail > .wi-act')!;
    expect(card.compareDocumentPosition(move) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('.wi-detail')!.lastElementChild).toBe(move);
    expect(card.querySelector('.wi-history')).not.toBeNull();
    expect(move.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(move.querySelector('.wi-why-rec')?.textContent).toContain('It costs less.');
  });

  it('why it came back is under the title, in full, as Markdown; the history keeps it too', () => {
    show(itemView({ history: RETURNED }));
    const back = document.querySelector('.wi-came-back') as HTMLElement;
    const title = document.querySelector('.wi-what')!;
    expect(title.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const why = [...document.querySelectorAll('.wi-card > section')].find((s) => s.querySelector('.wi-h')?.textContent === 'Why')!;
    expect(back.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(back).getByText('Why it came back')).toBeTruthy();
    expect(back.querySelector('code')?.textContent).toBe('ccrc doctor');
    expect(back.querySelector('strong')?.textContent).toBe('right');
    expect(document.querySelector('ul.wi-history[aria-label="History"]')!.textContent).toContain('Run ccrc doctor on the right box.');
  });

  it('an item that did not come back, or one being checked, has no came-back line', () => {
    show(itemView());
    expect(document.querySelector('.wi-came-back')).toBeNull();
    cleanup();
    show(itemView({ history: RETURNED, state: 'checking', tickedAt: NOW }));
    expect(document.querySelector('.wi-came-back')).toBeNull();
  });

  it('a history of five acts folds the two earlier ones behind one disclosure; the newest three stay open', () => {
    show(itemView({ history: RETURNED }));
    const fold = document.querySelector('details.wi-earlier') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')?.textContent).toBe('2 earlier');
    expect(fold.querySelectorAll('li')).toHaveLength(2);
    expect(document.querySelectorAll('ul.wi-history[aria-label="History"] > li')).toHaveLength(3);
  });

  it('a history of four acts is drawn whole', () => {
    show(itemView({ history: RETURNED.slice(0, 4) }));
    expect(document.querySelector('details.wi-earlier')).toBeNull();
    expect(document.querySelectorAll('ul.wi-history > li')).toHaveLength(4);
  });

  it('the title and the options take inline marks; why and a step take blocks, and a fenced command is a copy block', () => {
    show(itemView({
      kind: 'decide', title: 'Run `ccrc doctor` **now**', options: ['Keep `main`', 'Drop it'], recommended: 0,
      recommendedWhy: 'It is *cheaper*.', why: 'First line.\n\n- one\n- two', how: ['Paste this:\n\n```bash\nccrc doctor\n```'],
    }));
    const title = document.querySelector('.wi-what')!;
    expect(title.querySelector('p, ul, pre')).toBeNull();
    expect(title.querySelector('code')?.textContent).toBe('ccrc doctor');
    expect(title.textContent).toBe('Run ccrc doctor now');
    expect(screen.getByRole('radio', { name: /Keep main/ })).toBeTruthy();
    expect(document.querySelector('.wi-why-rec em')?.textContent).toBe('cheaper');
    expect(document.querySelectorAll('.wi-card .wi-text ul > li')).toHaveLength(2);
    expect(document.querySelector('.wi-steps .code-block pre')?.textContent).toBe('ccrc doctor');
  });

  it('a Markdown link or image links only what plain item text would: an http page and an outside document stay text', () => {
    show(itemView({
      why: '[a](http://example.com/a) ![b](http://example.com/b.png) [c](https://claude.ai/artifact/abc) ![d](https://claude.ai/artifact/d.png) [e](https://example.com/e)',
    }), { programme: { name: 'Programme A', hue: null, homeProject: 'project-a' } });
    const why = document.querySelector('.wi-text')!;
    expect(why.querySelector('img')).toBeNull();
    expect([...why.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com/e']);
    expect(why.textContent).toBe('a b c d e');
  });

  it('an item reference links in prose and never inside code', () => {
    show(itemView({ why: 'See item 7, not `item 7`.' }), { itemHref: (id) => `/waiting/${id}` });
    const why = document.querySelector('.wi-text')!;
    expect([...why.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/waiting/7']);
    expect(why.querySelector('code')?.textContent).toBe('item 7');
  });

  it('the account hold\'s Clear is drawn once, inside the last block ("Your move"), and nowhere in the reading part', () => {
    // The Overlord's hold item (#3489) carries its Clear with the item's other acts (call 1684); this wave's order puts every act
    // in the last block, after everything there is to read.
    show(itemView({ program: OVERLORD_ITEM_PROGRAMME, kind: 'do', title: `${READINESS_ITEM_TEXT.hold.title}: lane-a`,
      why: READINESS_ITEM_TEXT.hold.why, how: [...READINESS_ITEM_TEXT.hold.how] }));
    const detail = document.querySelector('.wi-detail')!;
    const last = detail.lastElementChild!;
    expect(last.getAttribute('aria-label')).toBe('Your move');
    expect(document.querySelectorAll('[data-item-hold]')).toHaveLength(1);
    expect(last.querySelector('[data-item-hold="lane-a"]')).not.toBeNull();
    expect(detail.querySelector('.wi-card:not(.wi-act) [data-item-hold]')).toBeNull();
    const clears = screen.getAllByRole('button', { name: FACT_WORDS.clear });
    expect(clears).toHaveLength(1);
    expect(last.contains(clears[0]!)).toBe(true);
  });
});

describe('wave 186 fix round 1 (review 4189): links, options, steps', () => {
  const PROG_A = { programme: { name: 'Programme A', hue: null, homeProject: 'project-a' } };

  it('F1: an autolink inside a refused link\'s words is no link (an http page, a mail address, a document outside the Docs reader)', () => {
    show(itemView({
      why: '[a <http://evil.example/x> b](http://y.example) [c <mailto:x@example.com> d](http://y.example) [e <https://github.com/o/r/blob/main/docs/superpowers/specs/x.md> f](http://y.example)',
    }), PROG_A);
    const why = document.querySelector('.wi-card .wi-text')!;
    expect(why.querySelectorAll('a')).toHaveLength(0);
    expect(why.textContent).toBe('a http://evil.example/x b c mailto:x@example.com d e https://github.com/o/r/blob/main/docs/superpowers/specs/x.md f');
  });

  it('F1: under a script link too', () => {
    show(itemView({ why: '[a <http://evil.example/x> b](javascript:alert(1))' }), PROG_A);
    expect(document.querySelectorAll('.wi-card .wi-text a')).toHaveLength(0);
  });

  it('F2: an option takes marks but no links, the recommended one too; the title keeps its links', () => {
    show(itemView({
      kind: 'decide', title: 'Close item 12', options: ['See https://example.com/x', 'Open [runs](/runs)', 'Close item 12 **now**'], recommended: 1,
      recommendedWhy: 'It is cheaper.',
    }), { ...PROG_A, itemHref: (id) => `/waiting/${id}` });
    const fieldset = document.querySelector('.wi-act fieldset')!;
    expect(fieldset.querySelectorAll('a, img')).toHaveLength(0);
    expect(fieldset.querySelector('strong')?.textContent).toBe('now');
    expect(screen.getByRole('radio', { name: 'See https://example.com/x' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Open runs Recommended' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Close item 12 now' })).toBeTruthy();
    expect(document.querySelector('.wi-what a')?.getAttribute('href')).toBe('/waiting/12');
  });

  it('A1: a How step that numbers itself is drawn once, by the list\'s own marker', () => {
    show(itemView({ how: ['1. Open the shell', '2) Run the check', 'Then 3. stays', '9. Not its own index'] }));
    expect([...document.querySelectorAll('ol.wi-steps > li')].map((l) => l.textContent)).toEqual(
      ['Open the shell', 'Run the check', 'Then 3. stays', '9. Not its own index']);
  });

  it('A8: the fold\'s list is named from the words file', () => {
    show(itemView({ history: [
      { at: NOW - 50 * MIN, act: 'raise' as const, note: null }, { at: NOW - 40 * MIN, act: 'tick' as const, note: null },
      { at: NOW - 30 * MIN, act: 'return' as const, note: 'One.' }, { at: NOW - 20 * MIN, act: 'tick' as const, note: null },
      { at: NOW - 10 * MIN, act: 'return' as const, note: 'Two.' },
    ] }));
    expect(EARLIER_HISTORY_WORD).toBe('Earlier history');
    expect(document.querySelector(`details.wi-earlier ul[aria-label="${EARLIER_HISTORY_WORD}"]`)).not.toBeNull();
  });
});
