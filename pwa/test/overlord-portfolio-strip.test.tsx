// The portfolio strip (Overlord W1 home B, Task 6; spec §5.6 H38): rank order, the rank control and the write's body, the
// refusals, and the failure contract. Plan cases: rank order with `seen` carrying every drawn slug; `rank-changed` re-reads and
// never retries; the 404 sentence; a measure with `n: 0` reads "no data", never 0; `rankUnreadable` is "rank unreadable".
// The merge case (a rank row of a drawn programme the operator never moved) is the one a `seen` of only the moved rows breaks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PortfolioEntry, PortfolioView } from '../../shared/portfolio';
import { api, ApiError } from '../src/lib/api';
import { PortfolioStrip } from '../src/overlord/PortfolioStrip';
import {
  PORTFOLIO_WORDS, canMove, cycleText, draftOf, moveRow, rankWriteOf, setClass, setFixedDate, stripView,
} from '../src/overlord/portfolioWords';

const AT = 1_800_000_000_000;
const HOUR = 3_600_000;

const entry = (slug: string, over: Partial<PortfolioEntry> = {}): PortfolioEntry => ({
  slug, title: `Programme ${slug}`, rank: null, cls: 'standard',
  wip: { working: 1, waiting: 0, queued: 2 }, closedWaves: { days7: 1, days28: 3 },
  cycle: { n: 4, medianMs: 5 * HOUR, p85Ms: 9 * HOUR }, cycleUnmeasured: 0, oldestOpenMs: null,
  reviewRounds: { rounds: 0, waves: 0 }, ended28: { done: 0, failed: 0, neverStarted: 0 },
  waitingOnOperatorMs28: 0, itemsUnmeasured: 0, asksUnmeasured: 0, blocking: { items: [], asks: 0 }, ...over,
});
const ranked = (slug: string, position: number, cls: PortfolioEntry['cls'] = 'standard', fixedDate: string | null = null, over: Partial<PortfolioEntry> = {}) =>
  entry(slug, { rank: { position, cls, fixedDate }, cls, ...over });
const view = (programmes: PortfolioEntry[], revision = 7): PortfolioView => ({ at: AT, revision, programmes });
const answered = (v: PortfolioView) => ({ ok: true as const, portfolio: v });

// prog-a (expedite, ranked 1), prog-b and prog-c (standard, ranked 1 and 2), prog-d (standard, unranked).
const BASE = (): PortfolioView => view([
  ranked('prog-a', 1, 'expedite'), ranked('prog-b', 1), ranked('prog-c', 2), entry('prog-d'),
]);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rowsShown = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[data-portfolio-row]')].map((r) => r.getAttribute('data-portfolio-row')!);
const rowsOfView = (v: PortfolioView) => {
  const s = stripView({ state: 'answered', at: AT, value: v });
  if (s.kind !== 'rows') throw new Error('the strip has no rows');
  return s.rows;
};
const rowOfSlug = (container: HTMLElement, slug: string): HTMLElement => container.querySelector<HTMLElement>(`[data-portfolio-row="${slug}"]`)!;

describe('portfolioWords: the rows and the failure contract', () => {
  it('draws each programme in the read\'s order with its class and fixed date, and no health word or 85% date', () => {
    const v = stripView({ state: 'answered', at: AT, value: view([
      ranked('prog-a', 1, 'fixed-date', '2026-12-01', { health: { word: 'on-track', evidence: 'unreadable', at: AT } as never, forecast: { kind: 'unreadable', sealedAt: AT } }),
      entry('prog-b'),
    ]) });
    if (v.kind !== 'rows') throw new Error('rows');
    expect(v.rows.map((r) => [r.slug, r.cls, r.fixedDate, r.ranked])).toEqual([['prog-a', 'fixed-date', '2026-12-01', true], ['prog-b', 'standard', null, false]]);
    expect(JSON.stringify(v.rows)).not.toMatch(/on-track|p85|health|forecast/);
  });
  it('a measure with no samples is "no data", never 0; waves the read could not measure are counted', () => {
    expect(cycleText({ n: 0, medianMs: null, p85Ms: null }, 0)).toBe(PORTFOLIO_WORDS.noData);
    expect(cycleText({ n: 0, medianMs: null, p85Ms: null }, 2)).toBe('no data (2 not measured)');
    expect(cycleText({ n: 1, medianMs: 3 * HOUR, p85Ms: 3 * HOUR }, 0)).toBe('median 3 h over 1 wave');
    expect(cycleText({ n: 4, medianMs: 5 * HOUR, p85Ms: 9 * HOUR }, 0)).toBe('median 5 h over 4 waves');
  });
  it('the read states: absent, unmeasured with its detail, loading; a stale read keeps its rows', () => {
    expect(stripView({ state: 'loading' })).toEqual({ kind: 'loading' });
    expect(stripView({ state: 'absent' })).toEqual({ kind: 'absent', text: 'no portfolio on this server' });
    expect(stripView({ state: 'unmeasured', error: 'the runs could not be read' })).toEqual({ kind: 'unmeasured', text: 'Portfolio unmeasured (the runs could not be read)' });
    const stale = stripView({ state: 'stale', value: BASE(), at: AT, error: 'timeout' });
    expect(stale).toMatchObject({ kind: 'rows', revision: 7, stale: PORTFOLIO_WORDS.stale });
  });
});

describe('portfolioWords: the draft and the rank door\'s body', () => {
  const rows = () => rowsOfView(BASE());

  it('a row moves inside its band only, and the swap touches both rows', () => {
    const d = draftOf(rows());
    expect(canMove(d, 'prog-a', 1)).toBe(false);      // the next row is another class
    expect(canMove(d, 'prog-b', -1)).toBe(false);
    expect(canMove(d, 'prog-b', 1)).toBe(true);
    const moved = moveRow(d, 'prog-c', -1);
    expect(moved.rows.map((r) => r.slug)).toEqual(['prog-a', 'prog-c', 'prog-b', 'prog-d']);
    expect([...moved.touched].sort()).toEqual(['prog-b', 'prog-c']);
    expect(moveRow(d, 'prog-a', 1)).toBe(d);
  });
  it('a class change takes the row to the end of its new band; a date only stays on fixed-date', () => {
    const d = setClass(draftOf(rows()), 'prog-b', 'expedite');
    expect(d.rows.map((r) => [r.slug, r.cls])).toEqual([['prog-a', 'expedite'], ['prog-b', 'expedite'], ['prog-c', 'standard'], ['prog-d', 'standard']]);
    const dated = setFixedDate(setClass(d, 'prog-c', 'fixed-date'), 'prog-c', '2026-12-31');
    expect(dated.rows.find((r) => r.slug === 'prog-c')).toMatchObject({ cls: 'fixed-date', fixedDate: '2026-12-31' });
    expect(setClass(dated, 'prog-c', 'background').rows.find((r) => r.slug === 'prog-c')).toMatchObject({ cls: 'background', fixedDate: null });
    expect(setFixedDate(d, 'prog-a', '2026-01-01')).toBe(d);   // not fixed-date: no date
  });
  it('`seen` is every drawn slug, `order` is the ranked and the touched rows in strip order', () => {
    const d = moveRow(draftOf(rows()), 'prog-c', -1);
    const a = rankWriteOf(7, d);
    expect(a).toEqual({ ok: true, write: {
      basedOn: 7, seen: ['prog-a', 'prog-c', 'prog-b', 'prog-d'],
      order: [
        { slug: 'prog-a', cls: 'expedite', fixedDate: null }, { slug: 'prog-c', cls: 'standard', fixedDate: null }, { slug: 'prog-b', cls: 'standard', fixedDate: null },
      ],
    } });
  });
  it('an unranked row the operator did not touch is not ranked by a save', () => {
    const a = rankWriteOf(7, moveRow(draftOf(rows()), 'prog-c', -1));
    expect(a.ok && a.write.order.map((e) => e.slug)).not.toContain('prog-d');
    const touched = rankWriteOf(7, setClass(draftOf(rows()), 'prog-d', 'background'));
    expect(touched.ok && touched.write.order.map((e) => e.slug)).toContain('prog-d');
  });
  it('a row whose rank is unreadable is written as drawn; a fixed-date row with no date is not written', () => {
    const v = view([entry('prog-a', { rankUnreadable: true }), entry('prog-b')]);
    const d = draftOf(rowsOfView(v));
    expect(rankWriteOf(1, moveRow(d, 'prog-b', -1))).toMatchObject({ ok: true, write: { order: [{ slug: 'prog-b' }, { slug: 'prog-a', cls: 'standard' }] } });
    const undated = setClass(draftOf(rows()), 'prog-d', 'fixed-date');
    expect(rankWriteOf(7, undated)).toEqual({ ok: false, why: 'needs-date', slug: 'prog-d' });
    expect(rankWriteOf(7, setFixedDate(undated, 'prog-d', '2026-02-30'))).toMatchObject({ ok: false, why: 'needs-date' });
  });
});

describe('PortfolioStrip', () => {
  it('draws each programme in rank order with its class, its fixed date and its facts', async () => {
    vi.spyOn(api, 'portfolio').mockResolvedValue(answered(view([ranked('prog-a', 1, 'fixed-date', '2026-12-01'), ranked('prog-b', 1), entry('prog-c')])));
    const { container } = render(<PortfolioStrip />);
    await screen.findByText('Programme prog-a');
    expect(rowsShown(container)).toEqual(['prog-a', 'prog-b', 'prog-c']);
    expect(rowOfSlug(container, 'prog-a')).toHaveTextContent('Fixed date · 2026-12-01');
    expect(rowOfSlug(container, 'prog-c')).toHaveTextContent('not ranked');
    expect(rowOfSlug(container, 'prog-b')).toHaveTextContent('1 working, 0 waiting, 2 queued');
    expect(rowOfSlug(container, 'prog-b')).toHaveTextContent('median 5 h over 4 waves');
  });

  it('a titled programme is plain text, never markup', async () => {
    vi.spyOn(api, 'portfolio').mockResolvedValue(answered(view([entry('prog-a', { title: '<img src=x onerror=alert(1)>' })])));
    const { container } = render(<PortfolioStrip />);
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('n: 0 reads "no data", never 0; rankUnreadable reads "rank unreadable"', async () => {
    vi.spyOn(api, 'portfolio').mockResolvedValue(answered(view([
      entry('prog-a', { cycle: { n: 0, medianMs: null, p85Ms: null }, rankUnreadable: true }),
    ])));
    const { container } = render(<PortfolioStrip />);
    await screen.findByText('rank unreadable');
    const facts = rowOfSlug(container, 'prog-a').querySelector('[data-fact="cycle"]')!;
    expect(facts).toHaveTextContent('no data');
    expect(facts.textContent).not.toMatch(/\b0\b/);
  });

  it('a 404 says "no portfolio on this server"; a 503 says unmeasured with its detail', async () => {
    vi.spyOn(api, 'portfolio').mockResolvedValue({ absent: true });
    const first = render(<PortfolioStrip />);
    expect(await screen.findByText('no portfolio on this server')).toBeInTheDocument();
    first.unmount();
    vi.spyOn(api, 'portfolio').mockRejectedValue(new ApiError(503, { ok: false, error: 'runs-unreadable', detail: 'database is locked' }));
    render(<PortfolioStrip />);
    expect(await screen.findByText('Portfolio unmeasured (database is locked)')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('every control is a button or a field a keyboard reaches, named for its row', async () => {
    vi.spyOn(api, 'portfolio').mockResolvedValue(answered(BASE()));
    render(<PortfolioStrip />);
    await screen.findByText('Programme prog-a');
    for (const name of ['Move Programme prog-b up', 'Move Programme prog-b down', 'Move Programme prog-c up']) {
      const el = screen.getByRole('button', { name });
      expect(el).toHaveProperty('tagName', 'BUTTON');
      expect(el).toHaveProperty('tabIndex', 0);
    }
    expect(screen.getByRole('button', { name: 'Move Programme prog-b up' })).toBeDisabled();   // top of its band
    expect(screen.getByRole('combobox', { name: 'Class of Programme prog-b' })).toHaveValue('standard');
    expect(screen.queryByRole('button', { name: 'Save order' })).toBeNull();                   // nothing changed yet
  });

  it('Move up reorders the strip; Save writes {basedOn, seen: every drawn slug, order} and draws the answer', async () => {
    vi.spyOn(api, 'portfolio').mockResolvedValue(answered(BASE()));
    const after = view([ranked('prog-a', 1, 'expedite'), ranked('prog-c', 1), ranked('prog-b', 2), entry('prog-d')], 8);
    const rank = vi.spyOn(api, 'rankPortfolio').mockResolvedValue({ revision: 8, portfolio: after });
    const { container } = render(<PortfolioStrip />);
    await screen.findByText('Programme prog-a');
    fireEvent.click(screen.getByRole('button', { name: 'Move Programme prog-c up' }));
    expect(rowsShown(container)).toEqual(['prog-a', 'prog-c', 'prog-b', 'prog-d']);
    expect(rank).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    await screen.findByText('Order saved.');
    expect(rank).toHaveBeenCalledTimes(1);
    const body = rank.mock.calls[0]![0];
    expect(body.basedOn).toBe(7);
    // The merge case: the strip drew four programmes and the operator moved two of them; `seen` is all four.
    expect(body.seen).toEqual(['prog-a', 'prog-c', 'prog-b', 'prog-d']);
    expect(body.order.map((e) => e.slug)).toEqual(['prog-a', 'prog-c', 'prog-b']);
    expect(rowsShown(container)).toEqual(['prog-a', 'prog-c', 'prog-b', 'prog-d']);
    expect(screen.queryByRole('button', { name: 'Save order' })).toBeNull();
  });

  it('a class change writes the class; fixed-date asks for its date, and Save waits for it', async () => {
    vi.spyOn(api, 'portfolio').mockResolvedValue(answered(BASE()));
    const rank = vi.spyOn(api, 'rankPortfolio').mockResolvedValue({ revision: 8, portfolio: BASE() });
    render(<PortfolioStrip />);
    await screen.findByText('Programme prog-a');
    fireEvent.change(screen.getByRole('combobox', { name: 'Class of Programme prog-d' }), { target: { value: 'fixed-date' } });
    expect(screen.getByRole('button', { name: 'Save order' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Fixed date of Programme prog-d'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(rank).toHaveBeenCalledTimes(1));
    expect(rank.mock.calls[0]![0].order.find((e) => e.slug === 'prog-d')).toEqual({ slug: 'prog-d', cls: 'fixed-date', fixedDate: '2026-12-31' });
  });

  it('`rank-changed` reads the portfolio again, says the order moved, shows the new order, and never retries', async () => {
    const read = vi.spyOn(api, 'portfolio')
      .mockResolvedValueOnce(answered(BASE()))
      .mockResolvedValue(answered(view([ranked('prog-d', 1, 'expedite'), ranked('prog-a', 1), ranked('prog-b', 2), ranked('prog-c', 3)], 9)));
    const rank = vi.spyOn(api, 'rankPortfolio').mockRejectedValue(new ApiError(409, { ok: false, error: 'rank-changed', revision: 9 }));
    const { container } = render(<PortfolioStrip />);
    await screen.findByText('Programme prog-a');
    fireEvent.click(screen.getByRole('button', { name: 'Move Programme prog-c up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    await screen.findByText(PORTFOLIO_WORDS.rankMoved);
    await waitFor(() => expect(rowsShown(container)).toEqual(['prog-d', 'prog-a', 'prog-b', 'prog-c']));
    expect(rank).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Save order' })).toBeNull();   // the draft was dropped with its revision
    await Promise.resolve();
    expect(rank).toHaveBeenCalledTimes(1);
  });

  it('another refusal is drawn by its word and keeps the draft', async () => {
    vi.spyOn(api, 'portfolio').mockResolvedValue(answered(BASE()));
    vi.spyOn(api, 'rankPortfolio').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found', detail: 'no programme prog-c' }));
    const { container } = render(<PortfolioStrip />);
    await screen.findByText('Programme prog-a');
    fireEvent.click(screen.getByRole('button', { name: 'Move Programme prog-c up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save order' }));
    await waitFor(() => expect(within(container).getByRole('status')).toBeInTheDocument());
    expect(rowsShown(container)).toEqual(['prog-a', 'prog-c', 'prog-b', 'prog-d']);
    expect(screen.getByRole('button', { name: 'Save order' })).toBeEnabled();
  });
});
