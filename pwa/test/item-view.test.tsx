// The item view (desktop-polish PL5a, D-7712; spec §2 and §3, view 3 of the prototype, minus the secret panel, which is
// PL6). `ItemView` takes `{item, onTick, onDismiss, programmeLive}`; a refused tick comes back as an `ApiError` the
// panel puts in the operator's words, and the button stays enabled so the operator can try again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ITEM_MOVE_REFUSALS, ANSWER_MAX, WAITS_ON_WORDS, endRunAction } from '../../shared/ledgers';
import { api } from '../src/lib/api';
import { run as runFixture } from './rollupFixture';
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
      // The goals routes' definition-of-done words (D-8126) are the coordinator's, never an operator door's.
      LEDGER_ROUTE_REFUSALS.badDoneWhen, LEDGER_ROUTE_REFUSALS.doneWhenNeedsRuling,
      'wrong-actor', // an operator's own tick and dismiss are never the wrong actor
    ];
    const operatorCodes = [...Object.values(LEDGER_ROUTE_REFUSALS), ...ITEM_MOVE_REFUSALS].filter((c) => !COORDINATOR_ONLY.includes(c));
    // …and the three the routes send with no word of their own: a refused body, a duplicate tick, a box without the store.
    const generic = ['bad-request', 'duplicate', 'not-configured'];
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
    expect(href('https://example.com/why')).toBe('https://example.com/why');
    // The words around them are drawn as they were.
    expect(document.querySelector('.wi-text')!.textContent).toBe('See https://example.com/page and /runs for the state.');
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
    expect(document.querySelector('.wi-history')!.textContent).toContain('sent back: see https://claude.ai/public/artifacts/abc');
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
