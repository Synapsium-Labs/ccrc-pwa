// WorkbenchTabs — the desk shell's strip of open tabs over one working surface,
// and its phone form, the header's switcher. These pin BEHAVIOUR and the a11y
// contract (roles, aria, roving focus, keys), never pixels: the pixels are the
// contrast gate's and the blind ui-verifier's.
//
// THE ONE DEPARTURE FROM THE CARD, pinned here so it cannot drift back. The card
// asks for a close BUTTON named "Close <title>". axe 4.13 reds that in both places
// it can sit (inside the tab: `nested-interactive`; beside it in the tablist:
// `aria-required-children`), so the close control is pointer-only — `aria-hidden`,
// `tabIndex -1`, titled — and keyboard and assistive-technology users close with
// `Delete` on the focused tab, which every closable tab declares in
// `aria-keyshortcuts`.
//
// MUTATION TABLE (measured 2026-10-20: 28/28 green before; each mutation applied
// alone, the reds below observed, then restored and 28/28 green again):
//   - `nextAfterClose` tries `tabs[i - 1]` before `tabs[i + 1]`   → 3 red (right neighbour, Delete, focus after close)
//   - roving `tabIndex={on ? 0 : -1}` → `tabIndex={0}`             → 1 red ("exactly one tab is in the tab order")
//   - the `Delete` branch of the key handler made unreachable      → 2 red (Delete closes, focus after close)
//   - the overflow measure forced to `false`                       → 2 red ("present when it overflows", re-measure)
//   - `draggable` ignoring `pinned`                                → 1 red (the pinned Fleet tab)
//   - focus not restored after a keyboard close                    → 1 red ("focus lands on the tab that became active")
//   - `scrollIntoView` always `smooth`                             → 1 red (reduced motion)
//
// SECOND ROUND (measured 2026-10-20: 31/31 green before and after; each alone):
//   - keep-in-view ignores the overflow flip (deps `[activeId]`)   → 1 red ("scrolls again once all tabs…")
//   - scrolls the tab button, not its item (close cut off)         → 2 red (both keep-in-view cases)
//   - `scrollIntoView` always `smooth`                             → 2 red (both keep-in-view cases)
//   - the end fade shown whenever the strip overflows              → 1 red ("at the start only the end…")
//   - no start fade                                                → 2 red (both fade cases)
//   - a scroll does not re-measure the edges                       → 1 red ("at the start only the end…")
//   - the start fade ignores the pinned tab                        → 1 red ("…after the pinned Fleet tab…")
// Neutral fixtures only (feature-x, feature-y): this repository is public.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { WorkbenchTabs, nextAfterClose, type WorkbenchTabItem } from '@ccrc/ui';

afterEach(cleanup);

const SHEET = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workbench-tabs.css'),
  'utf8',
);

const TABS: WorkbenchTabItem[] = [
  { id: 'fleet', title: 'Fleet', lead: { icon: 'folder-code' }, pinned: true },
  { id: 'x', title: 'feature-x', lead: { status: 'working' } },
  { id: 'y', title: 'feature-y', lead: { status: 'attention' } },
  { id: 'p', title: 'feature-y', lead: { icon: 'folder-code' }, tag: 'preview' },
];

function strip(over: Partial<Parameters<typeof WorkbenchTabs>[0]> = {}) {
  const onActivate = vi.fn();
  const onClose = vi.fn();
  const onReorder = vi.fn();
  const onShowAll = vi.fn();
  const view = render(
    <WorkbenchTabs
      tabs={TABS}
      activeId="x"
      onActivate={onActivate}
      onClose={onClose}
      onReorder={onReorder}
      onShowAll={onShowAll}
      {...over}
    />,
  );
  return { ...view, onActivate, onClose, onReorder, onShowAll };
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name });

describe('nextAfterClose — which tab is active after a close', () => {
  it('closing the active tab activates its right neighbour', () => {
    expect(nextAfterClose(TABS, 'x', 'x')).toBe('y');
  });
  it('at the end, its left neighbour', () => {
    expect(nextAfterClose(TABS, 'p', 'p')).toBe('y');
  });
  it('null when the closed tab was the only one', () => {
    expect(nextAfterClose([TABS[1]!], 'x', 'x')).toBeNull();
  });
  it('unchanged when the closed tab is not the active one', () => {
    expect(nextAfterClose(TABS, 'y', 'x')).toBe('x');
  });
});

describe('the strip — a tablist with roving focus', () => {
  it('is a tablist named "Open tabs" by default, or by its label', () => {
    strip();
    expect(screen.getByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument();
    cleanup();
    strip({ label: 'Desk tabs' });
    expect(screen.getByRole('tablist', { name: 'Desk tabs' })).toBeInTheDocument();
  });

  it('exactly one tab is in the tab order, the active one, and it alone is selected', () => {
    strip();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs.filter((t) => t.tabIndex === 0)).toEqual([tab(/feature-x/)]);
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toEqual([tab(/feature-x/)]);
  });

  it("a session tab's name carries its lamp's word, so state is never colour alone", () => {
    strip();
    expect(tab(/feature-x/)).toHaveAccessibleName('working feature-x');
    expect(within(tab(/waiting on you/)).getByText('feature-y')).toBeInTheDocument();
    expect(tab(/preview/)).toHaveAccessibleName('feature-y preview');
  });

  it('a click activates the tab', () => {
    const { onActivate } = strip();
    fireEvent.click(tab(/waiting on you/));
    expect(onActivate).toHaveBeenCalledWith('y');
  });

  it('→ and ← move with automatic activation, and wrap at both ends', () => {
    const { onActivate } = strip();
    fireEvent.keyDown(tab(/feature-x/), { key: 'ArrowRight' });
    expect(onActivate).toHaveBeenLastCalledWith('y');
    fireEvent.keyDown(tab(/preview/), { key: 'ArrowRight' });
    expect(onActivate).toHaveBeenLastCalledWith('fleet');
    fireEvent.keyDown(tab('Fleet'), { key: 'ArrowLeft' });
    expect(onActivate).toHaveBeenLastCalledWith('p');
  });

  it('the arrow moves focus with the activation', () => {
    strip();
    const from = tab(/feature-x/);
    from.focus();
    fireEvent.keyDown(from, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab(/waiting on you/));
  });

  it('Home and End jump to the first and last tab', () => {
    const { onActivate } = strip();
    fireEvent.keyDown(tab(/feature-x/), { key: 'End' });
    expect(onActivate).toHaveBeenLastCalledWith('p');
    fireEvent.keyDown(tab(/feature-x/), { key: 'Home' });
    expect(onActivate).toHaveBeenLastCalledWith('fleet');
  });

  it('Delete closes the focused tab and names the tab that becomes active', () => {
    const { onClose } = strip();
    fireEvent.keyDown(tab(/feature-x/), { key: 'Delete' });
    expect(onClose).toHaveBeenCalledWith('x', 'y');
  });

  it('after a keyboard close, focus lands on the tab that became active', () => {
    const { onClose, rerender, onActivate, onReorder, onShowAll } = strip();
    tab(/feature-x/).focus();
    fireEvent.keyDown(tab(/feature-x/), { key: 'Delete' });
    expect(onClose).toHaveBeenCalledWith('x', 'y');
    rerender(
      <WorkbenchTabs tabs={TABS.filter((t) => t.id !== 'x')} activeId="y" onActivate={onActivate}
        onClose={onClose} onReorder={onReorder} onShowAll={onShowAll} />,
    );
    expect(document.activeElement).toBe(tab(/waiting on you/));
  });

  it('every closable tab declares Delete and Alt+W; the pinned one declares nothing', () => {
    strip();
    expect(tab(/feature-x/)).toHaveAttribute('aria-keyshortcuts', 'Delete Alt+W');
    expect(tab('Fleet')).not.toHaveAttribute('aria-keyshortcuts');
  });
});

describe('the pinned Fleet tab', () => {
  it('is named "Fleet" by its title, its caret hidden, with no close and no drag', () => {
    const { onClose, container } = strip();
    const fleet = tab('Fleet');
    expect(fleet).toHaveAccessibleName('Fleet');
    expect(fleet.querySelector('.wb-tabs-caret')).toHaveAttribute('aria-hidden', 'true');
    expect(fleet).toHaveAttribute('draggable', 'false');
    const wrapper = fleet.closest('[role="none"]')!;
    expect(wrapper.querySelector('.wb-tabs-close')).toBeNull();
    fireEvent.keyDown(fleet, { key: 'Delete' });
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.wb-tabs-close')).toHaveLength(3);
  });

  it('every other tab drags only while the app can reorder', () => {
    strip();
    expect(tab(/feature-x/)).toHaveAttribute('draggable', 'true');
    cleanup();
    strip({ onReorder: undefined });
    expect(tab(/feature-x/)).toHaveAttribute('draggable', 'false');
  });

  // jsdom has no DragEvent, so `clientX` in an init dict is dropped: set it on the event itself.
  const dragAt = (kind: 'dragOver' | 'drop', el: HTMLElement, clientX: number): void => {
    const ev = createEvent[kind](el, { dataTransfer: { setData: vi.fn() } });
    Object.defineProperty(ev, 'clientX', { value: clientX });
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
    fireEvent(el, ev);
  };

  it('a drop reorders through onReorder, on the side it landed, never onto the pinned tab', () => {
    const { onReorder } = strip();
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(tab(/feature-x/), { dataTransfer });
    dragAt('dragOver', tab(/preview/), 80);
    expect(tab(/preview/).closest('[role="none"]')).toHaveAttribute('data-drop', 'after');
    dragAt('drop', tab(/preview/), 80);
    expect(onReorder).toHaveBeenCalledWith('x', 'p', true);
    fireEvent.dragStart(tab(/feature-x/), { dataTransfer });
    dragAt('drop', tab(/waiting on you/), 20);
    expect(onReorder).toHaveBeenLastCalledWith('x', 'y', false);
    onReorder.mockClear();
    fireEvent.dragStart(tab(/feature-x/), { dataTransfer });
    dragAt('drop', tab('Fleet'), 80);
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe('the close control — pointer-only, by the axe ruling', () => {
  it('is aria-hidden, out of the tab order, and titled "Close <title>"', () => {
    const { container } = strip();
    const close = container.querySelector<HTMLButtonElement>('[title="Close feature-x"]')!;
    expect(close).not.toBeNull();
    expect(close.tagName).toBe('BUTTON');
    expect(close).toHaveAttribute('aria-hidden', 'true');
    expect(close.tabIndex).toBe(-1);
    expect(close.closest('[role="tab"]')).toBeNull();
  });

  it('a click closes that tab with the next active id', () => {
    const { container, onClose, onActivate } = strip();
    fireEvent.click(container.querySelector('[title="Close feature-y"]')!);
    expect(onClose).toHaveBeenCalledWith('y', 'x');
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe('"All tabs" — only while the strip overflows', () => {
  let widths: { scroll: number; client: number };
  beforeEach(() => {
    widths = { scroll: 600, client: 600 };
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => widths.scroll);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => widths.client);
  });
  afterEach(() => vi.restoreAllMocks());

  it('is absent when every tab fits, and so are both fades', () => {
    const { container } = strip();
    expect(screen.queryByRole('button', { name: /All tabs/ })).toBeNull();
    expect(container.querySelector('.wb-tabs-fade')).toBeNull();
  });

  it('is present when it overflows, named with its count, outside the tablist', () => {
    widths.scroll = 1400;
    const { container, onShowAll } = strip();
    const all = screen.getByRole('button', { name: 'All tabs, 4 open' });
    expect(all.closest('[role="tablist"]')).toBeNull();
    expect(container.querySelector('.wb-tabs-fade[data-edge="end"]')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(all);
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('re-measures when the tabs change', () => {
    const { rerender, onActivate, onClose, onShowAll } = strip();
    expect(screen.queryByRole('button', { name: /All tabs/ })).toBeNull();
    widths.scroll = 1400;
    const more = [...TABS, { id: 'q', title: 'feature-z', lead: { status: 'idle' as const } }];
    rerender(<WorkbenchTabs tabs={more} activeId="x" onActivate={onActivate} onClose={onClose} onShowAll={onShowAll} />);
    expect(screen.getByRole('button', { name: 'All tabs, 5 open' })).toBeInTheDocument();
  });
});

describe('the fades mark only the edges that are cut', () => {
  let geo: { scroll: number; client: number; left: number };
  beforeEach(() => {
    geo = { scroll: 1400, client: 600, left: 0 };
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => geo.scroll);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => geo.client);
    vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockImplementation(() => geo.left);
  });
  afterEach(() => vi.restoreAllMocks());

  const edges = (c: HTMLElement): string[] =>
    [...c.querySelectorAll<HTMLElement>('.wb-tabs-fade')].map((f) => f.dataset['edge'] ?? '?');
  const scrollTo = (c: HTMLElement, left: number): void => {
    geo.left = left;
    fireEvent.scroll(c.querySelector('[role="tablist"]')!);
  };

  it('at the start only the end is cut; in the middle both; at the end only the start', () => {
    const { container } = strip();
    expect(edges(container)).toEqual(['end']);
    scrollTo(container, 400);
    expect(edges(container)).toEqual(['start', 'end']);
    scrollTo(container, 800);
    expect(edges(container)).toEqual(['start']);
  });

  it('the start fade sits after the pinned Fleet tab only when there is one', () => {
    geo.left = 800;
    const { container } = strip();
    expect(container.querySelector('.wb-tabs-fade[data-edge="start"]')).toHaveAttribute('data-pinned', 'true');
    cleanup();
    strip({ tabs: TABS.slice(1) });
    expect(document.querySelector('.wb-tabs-fade[data-edge="start"]')).not.toHaveAttribute('data-pinned');
  });
});

describe('the active tab is kept in view', () => {
  afterEach(() => vi.restoreAllMocks());

  // setup.ts gives jsdom a no-op `scrollIntoView` and a `matchMedia` that answers false.
  const record = (): Array<{ el: Element; arg: unknown; allShown: boolean }> => {
    const calls: Array<{ el: Element; arg: unknown; allShown: boolean }> = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: Element, arg?: unknown) {
      calls.push({ el: this, arg, allShown: document.querySelector('.wb-tabs-all') !== null });
    });
    return calls;
  };
  const itemOf = (t: HTMLElement): Element => t.closest('.wb-tabs-item')!;

  it('scrolls the whole tab, close control included: instantly on mount, smoothly on a change, instantly under reduced motion', () => {
    const calls = record();
    const { rerender, onActivate, onClose } = strip();
    expect(calls.at(-1)).toEqual({ el: itemOf(tab(/feature-x/)), arg: { block: 'nearest', inline: 'nearest', behavior: 'auto' }, allShown: false });

    act(() => {
      rerender(<WorkbenchTabs tabs={TABS} activeId="y" onActivate={onActivate} onClose={onClose} />);
    });
    expect(calls.at(-1)).toEqual({ el: itemOf(tab(/waiting on you/)), arg: { block: 'nearest', inline: 'nearest', behavior: 'smooth' }, allShown: false });

    const real = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ ...real(q), matches: q.includes('reduce') }));
    act(() => {
      rerender(<WorkbenchTabs tabs={TABS} activeId="p" onActivate={onActivate} onClose={onClose} />);
    });
    expect(calls.at(-1)).toEqual({ el: itemOf(tab(/preview/)), arg: { block: 'nearest', inline: 'nearest', behavior: 'auto' }, allShown: false });
  });

  it('on a mount that overflows, scrolls again once "all tabs" has taken its width', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => 1400);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 600);
    const calls = record();
    strip({ activeId: 'p' });
    expect(screen.getByRole('button', { name: /All tabs/ })).toBeInTheDocument();
    expect(calls.at(-1)).toEqual({ el: itemOf(tab(/preview/)), arg: { block: 'nearest', inline: 'nearest', behavior: 'auto' }, allShown: true });
  });
});

describe('the switcher — the phone header form', () => {
  it('is one button holding the active title and the open count, and opens all tabs', () => {
    const { container, onShowAll } = strip({ variant: 'switcher' });
    expect(screen.queryByRole('tablist')).toBeNull();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('feature-x');
    expect(buttons[0]).toHaveAccessibleName(/working.*feature-x.*All tabs, 4 open/);
    expect(container.querySelector('.wb-tabs-count')).toHaveTextContent('4');
    fireEvent.click(buttons[0]!);
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });
});

describe('the sheet', () => {
  it('floors the tab at the tap minimum, or the skin row, through tokens alone', () => {
    expect(SHEET).toMatch(/\.wb-tabs-tab\s*\{[^}]*min-height:\s*min\(var\(--tap-min\),\s*var\(--row-h\)\)/);
  });
  it('draws the active rail in the accent', () => {
    expect(SHEET).toMatch(/\.wb-tabs-item\[data-active='true'\]::after\s*\{[^}]*background:\s*var\(--accent\)/);
  });
  it('names no skin, writes no literal tap floor and no literal colour', () => {
    expect(SHEET).not.toMatch(/data-skin/);
    expect(SHEET).not.toMatch(/\b44px\b/);
    expect(SHEET).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
  });
  it('every :hover sits inside (hover: hover)', () => {
    const outside = SHEET.replace(/@media \(hover: hover\)\s*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
    expect(outside).not.toMatch(/:hover/);
  });
});
