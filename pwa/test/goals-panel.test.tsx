// Programme ledgers, PL5b phase A: the Goals panel (spec section 4, D3). Props only: it takes a `GoalsView` and the
// programme's home project and draws "In short" with its date, the deep link to the pinned spec, and the dated list
// "Changed since approval". The link is built through `docsPageUrl(docsLocation(...))` and only from a path that
// passes `isSpecPath` in a project that passes the project grammar (plan Review Focus 5, PWA side): an unchecked
// path never becomes a link. Placeholders only: programme `prog-a`, project `project-a`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GoalsView } from '../../shared/ledgers';
import { docsPageUrl } from '../../shared/docs';
import { docsLocation } from '../src/docs/docsLinks';
import { GoalsPanel } from '../src/ledgers/GoalsPanel';

const SPEC = 'docs/superpowers/specs/2026-10-31-prog-a-design.md';
const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 10, 1, 9, 30); // 2026-11-01

const goals = (over: Partial<GoalsView> = {}): GoalsView => ({
  program: 'prog-a', specPath: SPEC, inShort: 'A console view of what the programme is building.',
  inShortAt: T0, modifications: [], ...over,
});

const mod = (id: number, over: Partial<GoalsView['modifications'][number]> = {}): GoalsView['modifications'][number] => ({
  id, at: T0 + id * DAY, text: `change ${id}`, ruling: null, itemId: null, pr: null, merged: true, ...over,
});

/** The URL the plan's Interfaces block builds for a pinned spec in a home project. */
const deepLink = (project: string, specPath: string): string => docsPageUrl(docsLocation(
  { kind: 'project', project, ref: null },
  { kind: 'path', section: 'specs', path: specPath.slice('docs/superpowers/specs/'.length), dirSlash: false },
));

beforeEach(() => { history.replaceState(null, '', '/'); });
afterEach(() => { cleanup(); });

describe('Goals: In short', () => {
  it('shows the current In short and its date', () => {
    render(<GoalsPanel goals={goals()} homeProject="project-a" />);
    expect(screen.getByText('In short')).toBeTruthy();
    expect(screen.getByText('A console view of what the programme is building.')).toBeTruthy();
    expect(screen.getByText('As of 2026-11-01')).toBeTruthy();
  });

  it('says no spec is pinned yet when the programme has no In short, and draws no date', () => {
    render(<GoalsPanel goals={goals({ specPath: null, inShort: null, inShortAt: null })} homeProject="project-a" />);
    expect(screen.getByText('No spec is pinned yet.')).toBeTruthy();
    expect(screen.queryByText(/As of/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Goals: the spec link', () => {
  it('Open the spec in Docs links to the deep-link URL for the pinned path in the home project', () => {
    render(<GoalsPanel goals={goals()} homeProject="project-a" />);
    const link = screen.getByRole('link', { name: 'Open the spec in Docs' });
    expect(link.getAttribute('href')).toBe(deepLink('project-a', SPEC));
    expect(link.getAttribute('href')).toBe('/docs/project-a/specs/2026-10-31-prog-a-design.md');
  });

  it('a plain click moves within the app, a modified one is left to the browser', () => {
    render(<GoalsPanel goals={goals()} homeProject="project-a" />);
    const link = screen.getByRole('link', { name: 'Open the spec in Docs' });
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true); // not prevented
    expect(location.pathname).toBe('/');
    expect(fireEvent.click(link)).toBe(false); // prevented: the app navigates itself
    expect(location.pathname).toBe('/docs/project-a/specs/2026-10-31-prog-a-design.md');
  });

  it.each([
    ['a plans path', 'docs/superpowers/plans/x.md'],
    ['a parent hop', 'docs/superpowers/specs/../x.md'],
    ['an absolute path', '/docs/superpowers/specs/x.md'],
    ['a non-Markdown file', 'docs/superpowers/specs/x.html'],
    ['an empty segment', 'docs/superpowers/specs//x.md'],
  ])('builds no link when specPath is %s (Review Focus 5)', (_name, specPath) => {
    render(<GoalsPanel goals={goals({ specPath })} homeProject="project-a" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('A console view of what the programme is building.')).toBeTruthy();
  });

  it('builds no link when the home project is null, or fails the project grammar', () => {
    const a = render(<GoalsPanel goals={goals()} homeProject={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    a.unmount();
    const b = render(<GoalsPanel goals={goals()} homeProject="../project-a" />);
    expect(screen.queryByRole('link')).toBeNull();
    b.unmount();
  });

  it('builds no link when no spec is pinned', () => {
    render(<GoalsPanel goals={goals({ specPath: null })} homeProject="project-a" />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Goals: Changed since approval', () => {
  it('says nothing has changed when there are no modifications', () => {
    render(<GoalsPanel goals={goals()} homeProject="project-a" />);
    expect(screen.getByText('Changed since approval')).toBeTruthy();
    expect(screen.getByText('Nothing has changed since approval.')).toBeTruthy();
  });

  it('lists the modifications in the order given, newest first, each with its date, ruling and PR', () => {
    const view = goals({
      modifications: [
        mod(3, { text: 'the third change', ruling: 'ledger entry 41', pr: 120 }),
        mod(2, { text: 'the second change', ruling: 'ledger entry 38', pr: 118 }),
        mod(1, { text: 'the first change' }),
      ],
    });
    render(<GoalsPanel goals={view} homeProject="project-a" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => within(r).getByText(/change$/).textContent))
      .toEqual(['the third change', 'the second change', 'the first change']);
    expect(within(rows[0]!).getByText('2026-11-04')).toBeTruthy();
    expect(within(rows[0]!).getByText('Ruling: ledger entry 41')).toBeTruthy();
    expect(within(rows[0]!).getByText('PR #120')).toBeTruthy();
    expect(within(rows[1]!).getByText('Ruling: ledger entry 38')).toBeTruthy();
    expect(within(rows[1]!).getByText('PR #118')).toBeTruthy();
    expect(within(rows[2]!).queryByText(/Ruling/)).toBeNull();
    expect(within(rows[2]!).queryByText(/PR #/)).toBeNull();
  });

  it('an unmerged modification reads spec update pending with its PR number', () => {
    render(<GoalsPanel goals={goals({ modifications: [mod(2, { pr: 77, merged: false })] })} homeProject="project-a" />);
    expect(screen.getByText('spec update pending (PR #77)')).toBeTruthy();
  });

  it('an unmerged modification with no PR yet still reads spec update pending', () => {
    render(<GoalsPanel goals={goals({ modifications: [mod(2, { pr: null, merged: false })] })} homeProject="project-a" />);
    expect(screen.getByText('spec update pending')).toBeTruthy();
  });

  it('a merged modification never reads pending', () => {
    render(<GoalsPanel goals={goals({ modifications: [mod(2, { pr: 77, merged: true })] })} homeProject="project-a" />);
    expect(screen.queryByText(/pending/)).toBeNull();
    expect(screen.getByText('PR #77')).toBeTruthy();
  });

  it('when a change is pending, says the link opens the spec without it', () => {
    render(<GoalsPanel goals={goals({ modifications: [mod(2, { pr: 77, merged: false })] })} homeProject="project-a" />);
    expect(screen.getByText('Until it merges, the spec opens without it.')).toBeTruthy();
  });

  it('says nothing of a pending change when all have merged', () => {
    render(<GoalsPanel goals={goals({ modifications: [mod(2, { pr: 77 })] })} homeProject="project-a" />);
    expect(screen.queryByText(/Until it merges/)).toBeNull();
  });
});

describe('Goals: a change that came from an item (PL5b)', () => {
  const hrefOf = (id: number): string | null => (id === 7 ? '/waiting/7' : null);

  it('links the change to its item through the path the screen hands in, as a click within the app', () => {
    render(<GoalsPanel goals={goals({ modifications: [mod(2, { itemId: 7 })] })} homeProject="project-a" itemHref={hrefOf} />);
    const link = screen.getByRole('link', { name: 'Open the item' });
    expect(link.getAttribute('href')).toBe('/waiting/7');
    expect(fireEvent.click(link)).toBe(false);
    expect(location.pathname).toBe('/waiting/7');
  });

  it('draws no link when the change has no item, when no path is handed in, or when the screen has no page for it', () => {
    const view = goals({ modifications: [mod(3, { itemId: null }), mod(2, { itemId: 9 })] });
    render(<GoalsPanel goals={view} homeProject="project-a" itemHref={hrefOf} />);
    expect(screen.queryByRole('link', { name: 'Open the item' })).toBeNull();
    cleanup();
    render(<GoalsPanel goals={goals({ modifications: [mod(2, { itemId: 7 })] })} homeProject="project-a" />);
    expect(screen.queryByRole('link', { name: 'Open the item' })).toBeNull();
  });
});
