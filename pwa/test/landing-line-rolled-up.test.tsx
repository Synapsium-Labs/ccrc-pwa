// Desktop polish wave 192: the landing block on a card starts rolled up (`fleet/LandingLine.tsx`). Rolled up it draws its
// disclosure, the status sentence, the stale sentence when the last read failed and one summary line naming every open
// entry; open it draws what it always drew. Only the operator's tap opens or closes it, and the choice is kept per
// project for the page's life (`foldState.ts`). The doors are fakes passed as props; the card's section is a stand-in
// that holds the fallback ref, as in `landing-line.test.tsx`, whose cases read the open block.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { LandingEntry, LandingLineView } from '../../shared/landingLine';
import { ApiError } from '../src/lib/apiError';
import { resetLandingLineOpen, toggleLandingLineOpen } from '../src/fleet/foldState';
import { LandingLine, type LandingPauser } from '../src/fleet/LandingLine';
import type { LandingWithdrawer } from '../src/fleet/LandingWithdrawSheet';
import type { LandingCardState } from '../src/fleet/landingLineView';
import { LANDING_ROUTE_WORDS, LINE_TITLE, STALE_PREFIX } from '../src/fleet/landingWords';
import { E104, P, deferred, e, lineView, onlyView, pausedEmpty, stateOf, withdrawn } from './landingLineFixture';

beforeEach(resetLandingLineOpen);
afterEach(cleanup);
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };

function Card({ state, onReload, pause, withdraw }: {
  state: LandingCardState; onReload?: () => void; pause?: LandingPauser; withdraw?: LandingWithdrawer;
}): ReactNode {
  const ref = useRef<HTMLElement>(null);
  return (
    <section ref={ref} tabIndex={-1} data-testid="card" aria-label="the card">
      <LandingLine project={P} state={state} onReload={onReload} focusFallback={ref} pause={pause} withdraw={withdraw} />
      <button type="button">elsewhere</button>
    </section>
  );
}
const region = (): HTMLElement => screen.getByRole('region', { name: `Landing line of ${P}` });
const toggle = (): HTMLElement => within(region()).getByRole('button', { name: LINE_TITLE });
const summaryOf = (): string | null => region().querySelector('.landing-line-summary')?.textContent ?? null;
const pauseButton = (label: string): HTMLElement => screen.getByRole('button', { name: `${label} for ${P}` });
const withdrawButton = (pr: number): HTMLElement => screen.getByRole('button', { name: `Withdraw #${pr} from ${P}'s landing line` });
const never = (): Promise<never> => new Promise(() => {});
const fenced = (s: LandingCardState): LandingCardState => (s.kind === 'line'
  ? { ...s, stale: { text: LANDING_ROUTE_WORDS['landing-fenced'].text, scope: 'box', outcomeUnknown: false } } : s);
/** Every element of the region a keyboard reaches by Tab. */
const tabbable = (): Element[] => [...region().querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
  .filter((el) => el.getAttribute('tabindex') !== '-1');
const pinned = (n: number): LandingEntry[] => Array.from({ length: n }, (_, i) => e(501 + i));
const held = (): LandingLineView => lineView({}, { head: null, held: { reason: 'landing-recovery-unresolved', subjectIds: [1] } });

describe('rolled up on first draw', () => {
  it('the disclosure is a button carrying the title, not expanded, controlling the body that is in the region', () => {
    render(<Card state={stateOf(lineView())} />);
    const t = toggle();
    expect(t.tagName).toBe('BUTTON');
    expect(t.getAttribute('type')).toBe('button');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    const body = document.getElementById(t.getAttribute('aria-controls') ?? '');
    expect(body).not.toBeNull();
    expect(region().contains(body)).toBe(true);
    expect(body!.contains(region().querySelector('.landing-line-summary'))).toBe(true);
  });

  it('no pause control, no pause error, no row and no Withdraw in the accessibility tree; the disclosure is the only stop on Tab', () => {
    render(<Card state={stateOf(lineView())} />);
    expect(screen.queryByRole('button', { name: `Pause line for ${P}` })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Withdraw #/ })).toEqual([]);
    expect(within(region()).queryByRole('list')).toBeNull();
    expect(within(region()).queryByRole('alert')).toBeNull();
    expect(region().querySelector('.landing-line-pause, .landing-line-rows, .landing-line-error')).toBeNull();
    expect(tabbable()).toEqual([toggle()]);
  });

  it('in the document: the title, the status, the stale sentence, then the summary', () => {
    render(<Card state={fenced(stateOf(lineView()))} />);
    const kinds = [...region().children].flatMap((el) => (el.classList.contains('landing-line-body') ? [...el.children] : [el])).map((el) => (
      el === toggle() ? 'title'
        : el.getAttribute('role') === 'status' ? 'status'
          : el.classList.contains('landing-line-stale') ? 'stale'
            : el.classList.contains('landing-line-summary') ? 'summary' : el.outerHTML));
    expect(kinds).toEqual(['title', 'status', 'stale', 'summary']);
    expect(within(region()).getByRole('status').textContent).toBe('Next to land: #101.');
  });
});

describe('the summary names every open entry in the read\'s order, with their count', () => {
  it('one entry', () => {
    render(<Card state={stateOf(onlyView(pinned(1)))} />);
    expect(summaryOf()).toBe('One in line: #501');
  });
  it('six entries', () => {
    render(<Card state={stateOf(onlyView(pinned(6)))} />);
    expect(summaryOf()).toBe('6 in line: #501, #502, #503, #504, #505, #506');
  });
  it('thirteen entries: the first twelve, then how many more', () => {
    render(<Card state={stateOf(onlyView(pinned(13)))} />);
    expect(summaryOf()).toBe('13 in line: #501, #502, #503, #504, #505, #506, #507, #508, #509, #510, #511, #512 and 1 more');
  });
  it('an ejected, a waiting and a set-aside entry each carry their word', () => {
    render(<Card state={stateOf(lineView())} />);
    expect(summaryOf()).toBe('5 in line: #101, #104, #107 (waiting on a withdrawn entry), #102 (sent back), #109 (set aside)');
  });
});

describe('the status and the stale sentence in both states', () => {
  it('the same two elements rolled up and open, so a change is announced once; the summary only rolled up', () => {
    render(<Card state={fenced(stateOf(lineView()))} />);
    const status = within(region()).getByRole('status');
    const stale = region().querySelector('.landing-line-stale');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(stale?.textContent).toBe(`${STALE_PREFIX}${LANDING_ROUTE_WORDS['landing-fenced'].text}`);
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(within(region()).getByRole('status')).toBe(status);
    expect(region().querySelector('.landing-line-stale')).toBe(stale);
    expect(summaryOf()).toBeNull();
    expect(pauseButton('Pause line')).toBeTruthy();
    expect(withdrawButton(104)).toBeTruthy();
    fireEvent.click(toggle());
    expect(within(region()).getByRole('status')).toBe(status);
    expect(region().querySelector('.landing-line-stale')).toBe(stale);
    expect(summaryOf()).not.toBeNull();
  });
});

describe('paused, held and main-red lines start rolled up', () => {
  it.each([
    ['paused by you', lineView({ operatorPaused: true }, { paused: true, by: ['operator'], head: undefined } as never), 'Paused by you. Nothing lands.'],
    ['held', held(), 'Held: some of this line\'s records are being recovered. Nothing lands until they are.'],
    ['main red, the head fixing it', lineView({ mainRedHold: true }), 'Main is red. Only #101, which fixes main, may land.'],
  ])('%s: its status, its summary, and no control but the disclosure', (_name, view, status) => {
    render(<Card state={stateOf(view)} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(within(region()).getByRole('status').textContent).toBe(status);
    expect(summaryOf()).toMatch(/^5 in line: #101, /);
    expect(tabbable()).toEqual([toggle()]);
  });
  it('a pause on an empty line still draws the block: rolled up the paused sentence and no summary; open, Resume line', () => {
    render(<Card state={stateOf(pausedEmpty())} />);
    expect(within(region()).getByRole('status').textContent).toBe('Paused by you. Nothing lands.');
    expect(summaryOf()).toBeNull();
    expect(screen.queryByRole('button', { name: `Resume line for ${P}` })).toBeNull();
    fireEvent.click(toggle());
    expect(pauseButton('Resume line').textContent).toBe('Resume line');
  });
});

describe('only the operator opens it', () => {
  it('a re-read, a status change and a failed read leave it rolled up', () => {
    const { rerender } = render(<Card state={stateOf(lineView())} />);
    rerender(<Card state={stateOf(lineView({ entries: lineView().entries.filter((x) => x.pr !== 109) }))} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    rerender(<Card state={stateOf(lineView({ operatorPaused: true }, { paused: true, by: ['operator'], head: undefined } as never))} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    rerender(<Card state={fenced(stateOf(lineView()))} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('button', { name: /^Withdraw #/ })).toEqual([]);
  });
  it('a refusal of the pause door leaves it open, and rolling up then opening again shows the same view', async () => {
    const pause = vi.fn<LandingPauser>(() => Promise.reject(new ApiError(404, { ok: false, error: 'landing-project-unknown' })));
    render(<Card state={stateOf(lineView())} pause={pause} onReload={() => {}} />);
    fireEvent.click(toggle());
    fireEvent.click(pauseButton('Pause line'));
    await flush();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-project-unknown'].text);
    fireEvent.click(toggle());
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByRole('alert').textContent).toBe(LANDING_ROUTE_WORDS['landing-project-unknown'].text);
  });
});

describe('focus (ruling 6)', () => {
  it('rolling up with focus on a row\'s Withdraw leaves focus on the disclosure', () => {
    render(<Card state={stateOf(lineView())} />);
    fireEvent.click(toggle());
    withdrawButton(104).focus();
    fireEvent.click(toggle());   // a click that does not move focus, as in an engine that focuses no button on click
    expect(document.activeElement).toBe(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });
  it('rolling up with focus on the pause button leaves focus on the disclosure', () => {
    render(<Card state={stateOf(lineView())} />);
    fireEvent.click(toggle());
    pauseButton('Pause line').focus();
    fireEvent.click(toggle());
    expect(document.activeElement).toBe(toggle());
  });
  it('rolling up with focus outside the block moves no focus', () => {
    render(<Card state={stateOf(lineView())} />);
    fireEvent.click(toggle());
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
    elsewhere.focus();
    fireEvent.click(toggle());
    expect(document.activeElement).toBe(elsewhere);
  });
  // The disclosure's place in the chains: after the pause button, before the card. With the sheet open the block can only
  // be rolled up from outside it, which is how these cases take the pause button and the rows away.
  it('after Done with the pause button gone: the disclosure', async () => {
    render(<Card state={stateOf(onlyView([E104]))} withdraw={() => Promise.resolve(withdrawn(E104))} onReload={() => {}} />);
    fireEvent.click(toggle());
    fireEvent.click(withdrawButton(104));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw #104' }));
    await flush();
    act(() => toggleLandingLineOpen(P));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await flush();
    expect(document.activeElement).toBe(toggle());
  });
  it('after Cancel with the row and the pause button gone: the disclosure', async () => {
    render(<Card state={stateOf(lineView())} withdraw={never} />);
    fireEvent.click(toggle());
    withdrawButton(104).focus();
    fireEvent.click(withdrawButton(104));
    act(() => toggleLandingLineOpen(P));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(document.activeElement).toBe(toggle());
  });
  it('after Cancel with the row drawn: still the row\'s Withdraw first', async () => {
    render(<Card state={stateOf(lineView())} withdraw={never} />);
    fireEvent.click(toggle());
    withdrawButton(107).focus();
    fireEvent.click(withdrawButton(107));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(document.activeElement).toBe(withdrawButton(107));
  });
  it('a read that removes the focused control with the pause button gone: the disclosure, as after Done', async () => {
    const { rerender } = render(<Card state={stateOf(lineView())} />);
    fireEvent.click(toggle());
    withdrawButton(104).focus();
    // Rolled up from outside the block: its controls go, focus falls to the page, and the block still holds the record.
    act(() => toggleLandingLineOpen(P));
    expect(document.activeElement).toBe(document.body);
    rerender(<Card state={stateOf(lineView({ entries: lineView().entries.filter((x) => x.pr !== 109) }))} />);
    await flush();
    expect(document.activeElement).toBe(toggle());
  });
  it('the block removing itself while rolled up: the card', async () => {
    const { rerender } = render(<Card state={stateOf(pausedEmpty())} onReload={() => {}} />);
    toggle().focus();
    rerender(<Card state={{ kind: 'none' }} onReload={() => {}} />);
    await flush();
    expect(document.activeElement).toBe(screen.getByTestId('card'));
  });
});

describe('the sheet whatever the block\'s state', () => {
  it('rolled up from outside while the sheet is open: the sheet stays, and its answer is drawn', async () => {
    const d = deferred<Awaited<ReturnType<LandingWithdrawer>>>();
    render(<Card state={stateOf(lineView())} withdraw={() => d.promise} onReload={() => {}} />);
    fireEvent.click(toggle());
    fireEvent.click(withdrawButton(104));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw #104' }));
    act(() => toggleLandingLineOpen(P));
    await act(async () => { d.resolve(withdrawn(E104)); });
    await flush();
    expect(screen.getByRole('dialog', { name: 'Withdraw #104?' }).textContent).toContain('Withdrawn: #104 is out of the line.');
  });
});
