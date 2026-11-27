// Desktop polish Task C38 (D-8670): three of the Sheet's focus and hiding rules, each carried from the delegation broker
// programme's reviews, at the owner (`ui/src/primitives/sheet.tsx`), so every `QuickConfirm` and every other sheet has them,
// a sheet stacked on one or two others included (only the topmost sheet under a closing one is announced; review 2287).
//
// 1. THE PAGE IS NOT HIDDEN WHILE THE SHEET CLOSES. Radix hides everything outside an open modal (`hideOthers`, aria-hidden)
//    from the content's mount to its unmount, and the content stays mounted through the exit animation, so a refusal's live
//    region, or a focus a row places as the sheet leaves, sat inside an `aria-hidden` page and might not be announced. The
//    trap already follows `open` (`trapFocus={open}`); the hiding now does too. A reopen during the exit hides it again; a
//    sheet that opens again after it has left leaves the hiding to Radix (`browser/confirm-focus.browser.test.ts` holds
//    that row: jsdom does not order Radix's hiding after the Sheet's effect as Chrome does).
// 2. SHIFT+TAB PRESSED FIRST STAYS IN THE SHEET. The Sheet focuses its panel before Radix's trap listens, so the trap has no
//    last-focused element to pull the focus back to, and its keydown handler only wraps from the first tabbable: from the
//    panel itself the browser's own Shift+Tab left the dialog for the page.
// 3. THE OPENER A DISABLE DROPPED. A switch card disables its fieldset while it waits on a write or while its confirm is
//    open, and Chrome drops the focus of a control that becomes disabled without moving it anywhere: the Sheet found the
//    body where the opener should be, and Cancel, Escape or the scrim left the focus on the page. When the focus is on the
//    page as the sheet opens, the opener is the control that held it last, if that control is now disabled (it lost the
//    focus to that, not to the operator going elsewhere). A radio opener left unchecked (the choice was declined) gives the
//    focus to its group's checked radio, where a keyboard enters the group: a card's keyboard preview then describes the
//    choice that stands (`settings-screen.test.tsx`'s Stall watch row), and Space does not reopen the confirm. jsdom never
//    drops the focus of a disabled control, so these rows
//    drop it the way Chrome does (`dropLikeChrome`); `browser/confirm-focus.browser.test.ts` holds the same rows in Chrome.
//
// RED FIRST, measured 2026-11-16 against origin/main 0c573d7f3: see the task note `c38.md` for each row's red and its
// mutant.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { heldNodeCount, recordModalLayer } from '../../ui/src/lib/modal-layers';
import { CommandPalette, QuickConfirm, Sheet, SheetPortalContext, hideAsPage, releaseAsPage, type PageHiding } from '@ccrc/ui';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

/** Keeps a closed dialog mounted, as a browser's exit animation does (sheet-focus.test.tsx's device). */
const holdClosingContent = (): (() => void) => {
  const real = window.getComputedStyle.bind(window);
  const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const style = real(el, pseudo);
    if (el.getAttribute('role') !== 'dialog') return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === 'animationName') return el.getAttribute('data-state') === 'closed' ? 'sheet-out' : 'sheet-in';
        const v: unknown = Reflect.get(target, key, target);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  });
  return () => { spy.mockRestore(); };
};

/** Ends a closing dialog's exit, as the browser's `animationend` does, so Radix unmounts it and runs its own undo. */
const finishExit = async (dialog: Element): Promise<void> => {
  const end = new Event('animationend', { bubbles: true });
  Object.defineProperty(end, 'animationName', { value: 'sheet-out' });
  await act(async () => { dialog.dispatchEvent(end); });
  await settle();
};

/** Whether this element or an ancestor of it is hidden from assistive technology. */
const hiddenUp = (el: Element): boolean => {
  for (let at: Element | null = el; at !== null; at = at.parentElement) if (at.getAttribute('aria-hidden') === 'true') return true;
  return false;
};

/** A page with a live region and a confirm opened from a button. */
function Page(): ReactNode {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <p role="alert">{said}</p>
      <QuickConfirm open={open} onClose={() => setOpen(false)} title="Do it?" consequence="It does it."
        confirmLabel="Do it" onConfirm={() => setSaid('Refused.')} />
    </main>
  );
}

/** The elements outside the dialog that are hidden from assistive technology, as an ancestor of the page's own content. */
const pageHidden = (): boolean => {
  for (let el: Element | null = screen.getByRole('button', { name: 'Open it', hidden: true }); el !== null; el = el.parentElement) {
    if (el.getAttribute('aria-hidden') === 'true') return true;
  }
  return false;
};

describe('1. the page is not aria-hidden while the sheet closes', () => {
  it('open: the page is hidden; closing (the panel still mounted): it is not; a reopen during the exit hides it again', async () => {
    const release = holdClosingContent();
    try {
      render(<Page />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      expect(pageHidden(), 'CONTROL: an open modal hides the page').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await settle();
      expect(document.querySelector('[role="dialog"]'), 'CONTROL: the closing panel is still mounted').not.toBeNull();
      expect(pageHidden(), 'the page is still aria-hidden while the sheet closes').toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Open it', hidden: true }));
      await settle();
      expect(pageHidden(), 'a reopen during the exit left the page announced behind an open modal').toBe(true);
      // Review 2323 F6 (Task C40): the reopened sheet closes again, and the page is announced again as it does.
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await settle();
      expect(document.querySelector('[role="dialog"]'), 'CONTROL: the panel is still mounted, closing again').not.toBeNull();
      expect(pageHidden(), 'the page is still aria-hidden while the reopened sheet closes').toBe(false);
    } finally { release(); }
  });

  // Review 2323 F7 (Task C40): Radix's focus guards, which its own hiding marks, stay hidden while the sheet closes.
  it('the focus guards stay hidden while the sheet closes', async () => {
    const release = holdClosingContent();
    try {
      render(<Page />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      const guards = [...document.querySelectorAll('[data-radix-focus-guard]')];
      expect(guards.length, 'CONTROL: the open sheet placed its focus guards').toBeGreaterThan(0);
      expect(guards.every((g) => g.getAttribute('aria-hidden') === 'true'), 'CONTROL: the guards are hidden while it is open').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await settle();
      expect(pageHidden(), 'CONTROL: the page is announced while the sheet closes').toBe(false);
      expect(guards.filter((g) => g.isConnected).length, 'CONTROL: a focus guard is still in the page at this read').toBeGreaterThan(0);
      expect(guards.filter((g) => g.isConnected).map((g) => g.getAttribute('aria-hidden')), 'a focus guard was announced as the sheet closed')
        .not.toContain(null);
    } finally { release(); }
  });

  it('a refusal said as the confirm closes is in a region the page does not hide', async () => {
    const release = holdClosingContent();
    try {
      render(<Page />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
      await settle();
      const alert = screen.getByText('Refused.');
      for (let el: Element | null = alert; el !== null; el = el.parentElement) {
        expect(el.getAttribute('aria-hidden'), `${el.tagName} hides the refusal`).not.toBe('true');
      }
    } finally { release(); }
  });

  // Review 2272 F1, F2: a confirm stacked on a sheet still open (SessionActionsSheet, SwapSheet, PrSheet). As the confirm
  // closes, the sheet under it is announced at once, and the page stays hidden behind that sheet.
  it('a confirm closing over a sheet still open: that sheet is announced, and the page stays hidden behind it', async () => {
    function Stacked(): ReactNode {
      const [open, setOpen] = useState(false);
      const [asking, setAsking] = useState(false);
      return (
        <main>
          <button type="button" onClick={() => setOpen(true)}>Open it</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Actions">
            <button type="button" onClick={() => setAsking(true)}>Release</button>
          </Sheet>
          <QuickConfirm open={asking} onClose={() => setAsking(false)} title="Release?" consequence="It releases."
            confirmLabel="Yes, release" onConfirm={() => undefined} />
        </main>
      );
    }
    const release = holdClosingContent();
    try {
      render(<Stacked />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Release' }));
      await settle();
      const hiddenUp = (el: Element): boolean => {
        for (let at: Element | null = el; at !== null; at = at.parentElement) if (at.getAttribute('aria-hidden') === 'true') return true;
        return false;
      };
      const releaseButton = screen.getByRole('button', { name: 'Release', hidden: true });
      expect(hiddenUp(releaseButton), 'CONTROL: the confirm hides the sheet under it').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await settle();
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the confirm is closing, the sheet still open').toBe(2);
      expect(pageHidden(), 'the page behind the sheet still open was announced as the confirm closed').toBe(true);
      expect(hiddenUp(releaseButton), 'the sheet under the closing confirm stayed hidden').toBe(false);
    } finally { release(); }
  });

  // Review 2287 L1-1: three layers (Session actions, then Swap over it, then the swap's target confirm). As the confirm
  // closes, only the sheet directly under it is announced; the bottom sheet stays hidden behind the middle one, as on main.
  it('a confirm closing over two sheets still open: only the top one is announced, the bottom one and the page stay hidden', async () => {
    function ThreeDeep(): ReactNode {
      const [actions, setActions] = useState(false);
      const [swap, setSwap] = useState(false);
      const [asking, setAsking] = useState(false);
      return (
        <main>
          <button type="button" onClick={() => setActions(true)}>Open it</button>
          <Sheet open={actions} onClose={() => setActions(false)} title="Actions">
            <button type="button" onClick={() => setSwap(true)}>Swap</button>
          </Sheet>
          <Sheet open={swap} onClose={() => setSwap(false)} title="Swap to">
            <button type="button" onClick={() => setAsking(true)}>Pick lane-a</button>
          </Sheet>
          <QuickConfirm open={asking} onClose={() => setAsking(false)} title="Swap to lane-a?" consequence="It swaps."
            confirmLabel="Yes, swap" onConfirm={() => undefined} />
        </main>
      );
    }
    const release = holdClosingContent();
    try {
      render(<ThreeDeep />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Pick lane-a' }));
      await settle();
      const hiddenUp = (el: Element): boolean => {
        for (let at: Element | null = el; at !== null; at = at.parentElement) if (at.getAttribute('aria-hidden') === 'true') return true;
        return false;
      };
      const bottom = screen.getByRole('button', { name: 'Swap', hidden: true });
      const middle = screen.getByRole('button', { name: 'Pick lane-a', hidden: true });
      expect(hiddenUp(bottom) && hiddenUp(middle), 'CONTROL: the confirm hides both sheets under it').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await settle();
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the confirm is closing, both sheets still open').toBe(3);
      expect(hiddenUp(middle), 'the sheet directly under the closing confirm stayed hidden').toBe(false);
      expect(hiddenUp(bottom), 'the bottom sheet was announced while the middle sheet is open over it').toBe(true);
      expect(pageHidden(), 'the page was announced behind two open sheets').toBe(true);
      // Review 2310 F3 (Task C40): and once the confirm has gone, Radix's undo leaves the same picture.
      const confirm = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('data-state') === 'closed');
      expect(confirm, 'CONTROL: the closing confirm is the one closed dialog').toBeDefined();
      await finishExit(confirm!);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the confirm has unmounted, both sheets still open').toBe(2);
      expect(hiddenUp(middle), 'the middle sheet is hidden after the confirm unmounted').toBe(false);
      expect(hiddenUp(bottom), 'the bottom sheet was announced after the confirm unmounted').toBe(true);
      expect(pageHidden(), 'the page was announced behind two open sheets after the confirm unmounted').toBe(true);
    } finally { release(); }
  });

  // Review 2287 L1-2: a live region in the sheet under the confirm. Radix then keeps that region's ancestors visible and
  // marks the sheet's own children instead, so the marks to lift sit INSIDE the sheet, not over it.
  it('a confirm closing over a sheet with a live region: that sheet is announced', async () => {
    function Live(): ReactNode {
      const [open, setOpen] = useState(false);
      const [asking, setAsking] = useState(false);
      return (
        <main>
          <button type="button" onClick={() => setOpen(true)}>Open it</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Actions">
            <p aria-live="polite">Ready.</p>
            <button type="button" onClick={() => setAsking(true)}>Release</button>
          </Sheet>
          <QuickConfirm open={asking} onClose={() => setAsking(false)} title="Release?" consequence="It releases."
            confirmLabel="Yes, release" onConfirm={() => undefined} />
        </main>
      );
    }
    const release = holdClosingContent();
    try {
      render(<Live />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      // Read before the confirm opens: Radix then marks this button itself, and a hidden button has no name.
      const releaseButton = screen.getByRole('button', { name: 'Release' });
      fireEvent.click(releaseButton);
      await settle();
      const hiddenUp = (el: Element): boolean => {
        for (let at: Element | null = el; at !== null; at = at.parentElement) if (at.getAttribute('aria-hidden') === 'true') return true;
        return false;
      };
      const parent = releaseButton.closest('[role="dialog"]');
      expect(parent?.querySelector('[data-aria-hidden="true"][aria-hidden="true"]'),
        'CONTROL: the confirm marked nodes inside the sheet, around its live region').not.toBeNull();
      expect(hiddenUp(releaseButton), 'CONTROL: the confirm hides the sheet under it').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await settle();
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the confirm is closing, the sheet still open').toBe(2);
      expect(hiddenUp(releaseButton), 'the sheet under the closing confirm stayed hidden').toBe(false);
      expect(pageHidden(), 'the page behind the sheet still open was announced as the confirm closed').toBe(true);
    } finally { release(); }
  });

  it('an element the page hid itself stays hidden when the sheet closes', async () => {
    const release = holdClosingContent();
    try {
      const own = document.createElement('div');
      own.setAttribute('aria-hidden', 'true');
      own.textContent = 'decoration';
      document.body.appendChild(own);
      render(<Page />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await settle();
      expect(own.getAttribute('aria-hidden')).toBe('true');
      own.remove();
    } finally { release(); }
  });

  // Review 2310 F2 (Task C40, D-8698), no stack: a sheet that opens while the one before it is still closing (a menu
  // sheet whose row closes it and opens the next, in one commit). The first sheet's Radix marks an element the page hid
  // itself as already hidden (it never restores that one); the second must not take it for a mark of its own and lift it.
  it('a sheet opened while the previous one closes never lifts an element the page hid itself, and still announces the page', async () => {
    function Chain(): ReactNode {
      const [first, setFirst] = useState(false);
      const [second, setSecond] = useState(false);
      return (
        <main>
          <button type="button" onClick={() => setFirst(true)}>Open it</button>
          <Sheet open={first} onClose={() => setFirst(false)} title="Menu">
            <button type="button" onClick={() => { setFirst(false); setSecond(true); }}>Next</button>
          </Sheet>
          <Sheet open={second} onClose={() => setSecond(false)} title="Next sheet">
            <button type="button" onClick={() => setSecond(false)}>Done</button>
          </Sheet>
        </main>
      );
    }
    const release = holdClosingContent();
    const own = document.createElement('div');
    own.setAttribute('aria-hidden', 'true');
    own.textContent = 'decoration';
    document.body.appendChild(own);
    try {
      render(<Chain />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await settle();
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the menu is closing as the next sheet opens').toBe(2);
      expect(own.hasAttribute('data-aria-hidden'), 'CONTROL: Radix marked the page\'s own hidden element').toBe(true);
      expect(pageHidden(), 'CONTROL: the next sheet hides the page').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await settle();
      expect(own.getAttribute('aria-hidden'), 'the closing sheet lifted an element the page hid itself').toBe('true');
      expect(pageHidden(), 'the page is still aria-hidden while the second sheet closes').toBe(false);
      for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: both sheets have unmounted').toBe(0);
      expect(own.getAttribute('aria-hidden'), 'an element the page hid itself was left announced for good').toBe('true');
      expect(pageHidden(), 'the page stayed hidden after both sheets left').toBe(false);
    } finally { own.remove(); release(); }
  });

  // Review 2323 F1 (Task C40, D-8698): the same hand-off with the sheet that opens EARLIER in the tree than the one that
  // closes, as the session screen's follow-up sheets are rendered before its menu sheet. The opening sheet's own read must
  // come after the closing one has lifted its marks, so the page is announced as the follow-up closes, as on main.
  it('a sheet opened earlier in the tree than the one closing still announces the page as it closes, and lifts nothing the page hid', async () => {
    function Reversed(): ReactNode {
      const [first, setFirst] = useState(false);
      const [second, setSecond] = useState(false);
      return (
        <main>
          <button type="button" onClick={() => setFirst(true)}>Open it</button>
          <Sheet open={second} onClose={() => setSecond(false)} title="Next sheet">
            <button type="button" onClick={() => setSecond(false)}>Done</button>
          </Sheet>
          <Sheet open={first} onClose={() => setFirst(false)} title="Menu">
            <button type="button" onClick={() => { setFirst(false); setSecond(true); }}>Next</button>
          </Sheet>
        </main>
      );
    }
    const release = holdClosingContent();
    const own = document.createElement('div');
    own.setAttribute('aria-hidden', 'true');
    own.textContent = 'decoration';
    document.body.appendChild(own);
    try {
      render(<Reversed />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await settle();
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the menu is closing as the next sheet opens').toBe(2);
      expect(pageHidden(), 'CONTROL: the next sheet hides the page').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await settle();
      expect(pageHidden(), 'the page is still aria-hidden while the sheet opened earlier in the tree closes').toBe(false);
      expect(own.getAttribute('aria-hidden'), 'the closing sheet lifted an element the page hid itself').toBe('true');
      for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: both sheets have unmounted').toBe(0);
      expect(own.getAttribute('aria-hidden'), 'an element the page hid itself was left announced for good').toBe('true');
      expect(pageHidden(), 'the page stayed hidden after both sheets left').toBe(false);
    } finally { own.remove(); release(); }
  });

  // Review 2334 F1 (Task C40, D-8698): the command palette's hand-off (`CommandLayer.run`: the palette, a vaul drawer and
  // not a Sheet, closes and a sheet opens in one handler). The palette never lifts its marks, so they are still on the page
  // as the sheet's panel mounts; the sheet must still announce the page as it closes, as on main, and must never lift an
  // element the page hid itself that the palette marked. In both tree orders, with the palette still closing or gone.
  for (const order of ['palette first', 'sheet first'] as const) {
    for (const paletteGone of [false, true]) {
      it(`the palette's hand-off to a sheet (${order}, the palette ${paletteGone ? 'gone' : 'still closing'}): the page is announced as the sheet closes, and nothing the page hid is lifted`, async () => {
        function Handoff(): ReactNode {
          const [palette, setPalette] = useState(false);
          const [sheet, setSheet] = useState(false);
          const options = useMemo(() => [{ id: 'shortcuts', title: 'Keyboard shortcuts' }], []);
          const pal = (
            <CommandPalette open={palette} onClose={() => setPalette(false)} query="" onQueryChange={() => undefined}
              options={options} onRun={() => { setPalette(false); setSheet(true); }} />
          );
          const sh = (
            <Sheet open={sheet} onClose={() => setSheet(false)} title="Shortcuts">
              <button type="button" onClick={() => setSheet(false)}>Done</button>
            </Sheet>
          );
          return (
            <main>
              <button type="button" onClick={() => setPalette(true)}>Open it</button>
              {order === 'palette first' ? <>{pal}{sh}</> : <>{sh}{pal}</>}
            </main>
          );
        }
        const release = holdClosingContent();
        const own = document.createElement('div');
        own.setAttribute('aria-hidden', 'true');
        own.textContent = 'decoration';
        document.body.appendChild(own);
        try {
          render(<Handoff />);
          fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
          await settle();
          expect(own.hasAttribute('data-aria-hidden'), 'CONTROL: the palette marked the element the page hid itself').toBe(true);
          fireEvent.click(screen.getByRole('option', { name: /Keyboard shortcuts/ }));
          await settle();
          expect([...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('data-state')).sort(),
            'CONTROL: the palette is closing as the sheet opens').toEqual(['closed', 'open']);
          if (paletteGone) {
            const palette = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('data-state') === 'closed');
            await finishExit(palette!);
            expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the palette has unmounted').toBe(1);
          }
          expect(pageHidden(), 'CONTROL: the sheet hides the page').toBe(true);
          fireEvent.click(screen.getByRole('button', { name: 'Done' }));
          await settle();
          expect(pageHidden(), 'the page is still aria-hidden while the sheet the palette handed to closes').toBe(false);
          expect(own.getAttribute('aria-hidden'), 'the closing sheet lifted an element the page hid itself').toBe('true');
          for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
          expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: every dialog has unmounted').toBe(0);
          expect(own.getAttribute('aria-hidden'), 'an element the page hid itself was left announced for good').toBe('true');
          expect(pageHidden(), 'the page stayed hidden after every dialog left').toBe(false);
        } finally { own.remove(); release(); }
      });
    }
  }

  // Review 2334 F2 (Task C40, D-8698): review 2323's F5 shape, reached as the fleet's Session actions reaches it. The sheet
  // under a layer is closed by code (its session left the fleet), and an effect on its `open` closes the layer one commit
  // later (`SessionActionsSheet` clears its Swap sheet and its Release and Forget confirms so). The layer must announce
  // the page as it closes, as on main.
  it('a layer an effect closes one commit after the sheet under it announces the page as it closes, and lifts nothing the page hid', async () => {
    function Cleared(): ReactNode {
      const [open, setOpen] = useState(false);
      const [swap, setSwap] = useState(false);
      useEffect(() => { if (!open) setSwap(false); }, [open]);
      return (
        <main>
          <button type="button" onClick={() => setOpen(true)}>Open it</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Actions">
            <button type="button" onClick={() => setSwap(true)}>Swap</button>
          </Sheet>
          <Sheet open={swap} onClose={() => setSwap(false)} title="Swap to">
            <button type="button" onClick={() => setOpen(false)}>Leave the fleet</button>
          </Sheet>
        </main>
      );
    }
    const release = holdClosingContent();
    const own = document.createElement('div');
    own.setAttribute('aria-hidden', 'true');
    own.textContent = 'decoration';
    document.body.appendChild(own);
    try {
      render(<Cleared />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Swap' }));
      await settle();
      expect(pageHidden(), 'CONTROL: the two sheets hide the page').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Leave the fleet' }));
      await settle();
      expect([...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('data-state')),
        'CONTROL: both sheets are closing, the swap sheet by the effect').toEqual(['closed', 'closed']);
      expect(pageHidden(), 'the page is still aria-hidden while the layer the effect closed closes').toBe(false);
      expect(own.getAttribute('aria-hidden'), 'a closing sheet lifted an element the page hid itself').toBe('true');
      for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: both sheets have unmounted').toBe(0);
      expect(own.getAttribute('aria-hidden'), 'an element the page hid itself was left announced for good').toBe('true');
      expect(pageHidden(), 'the page stayed hidden after both sheets left').toBe(false);
    } finally { own.remove(); release(); }
  });

  // Review 2334 F3 (Task C40, D-8698): under React's StrictMode (`pwa/src/main.tsx` renders the app in it), React calls a
  // newly mounted element's ref callback a second time in development. React 19 detaches the ref, disconnects the passive
  // effects (Radix's undo runs), re-attaches the ref (the second call), then reconnects the effects (review 2343 F5). The
  // undo removes this sheet's `aria-hidden` only from nodes no other layer still counts (review 2353 F8), so at the second
  // call a node the menu, still closing, also marks reads hidden: the menu's marks, which a read of every hidden node would
  // take for what the page hid (C40's mutant M7). The menu's hand-off, in both tree orders.
  for (const order of ['closing sheet first', 'opening sheet first'] as const) {
    it(`under StrictMode, the hand-off (${order}) announces the page as the next sheet closes, and lifts nothing the page hid`, async () => {
      function Chain(): ReactNode {
        const [first, setFirst] = useState(false);
        const [second, setSecond] = useState(false);
        const menu = (
          <Sheet open={first} onClose={() => setFirst(false)} title="Menu">
            <button type="button" onClick={() => { setFirst(false); setSecond(true); }}>Next</button>
          </Sheet>
        );
        const next = (
          <Sheet open={second} onClose={() => setSecond(false)} title="Next sheet">
            <button type="button" onClick={() => setSecond(false)}>Done</button>
          </Sheet>
        );
        return (
          <main>
            <button type="button" onClick={() => setFirst(true)}>Open it</button>
            {order === 'closing sheet first' ? <>{menu}{next}</> : <>{next}{menu}</>}
          </main>
        );
      }
      const release = holdClosingContent();
      const own = document.createElement('div');
      own.setAttribute('aria-hidden', 'true');
      own.textContent = 'decoration';
      document.body.appendChild(own);
      try {
        render(<StrictMode><Chain /></StrictMode>);
        fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await settle();
        expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the menu is closing as the next sheet opens').toBe(2);
        expect(pageHidden(), 'CONTROL: the next sheet hides the page').toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        await settle();
        expect(pageHidden(), 'the page is still aria-hidden while the next sheet closes, under StrictMode').toBe(false);
        expect(own.getAttribute('aria-hidden'), 'the closing sheet lifted an element the page hid itself').toBe('true');
        for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
        expect(own.getAttribute('aria-hidden'), 'an element the page hid itself was left announced for good').toBe('true');
        expect(pageHidden(), 'the page stayed hidden after both sheets left').toBe(false);
      } finally { own.remove(); release(); }
    });
  }

  // Review 2310 F1 (Task C40, D-8698), stacked: two confirms overlap over a sheet that holds a live region (so Radix marks
  // that sheet's children, an element it hid itself among them). The first confirm's Radix marks that element as already
  // hidden; the second, closing, must not lift it through the topmost dialog's `contains` arm.
  it('a confirm opened while another closes, over a sheet with a live region, never lifts an element that sheet hid itself', async () => {
    function Overlap(): ReactNode {
      const [open, setOpen] = useState(false);
      const [first, setFirst] = useState(false);
      const [second, setSecond] = useState(false);
      return (
        <main>
          <button type="button" onClick={() => setOpen(true)}>Open it</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="Actions">
            <p aria-live="polite">Ready.</p>
            <span aria-hidden="true" data-testid="decoration">*</span>
            <button type="button" onClick={() => setFirst(true)}>Release</button>
          </Sheet>
          <Sheet open={first} onClose={() => setFirst(false)} title="Release how?">
            <button type="button" onClick={() => { setFirst(false); setSecond(true); }}>For good</button>
          </Sheet>
          <QuickConfirm open={second} onClose={() => setSecond(false)} title="Release for good?" consequence="It releases."
            confirmLabel="Yes, release" onConfirm={() => undefined} />
        </main>
      );
    }
    const release = holdClosingContent();
    try {
      render(<Overlap />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      const decoration = screen.getByTestId('decoration');
      // Read before the confirms open: Radix then marks this button itself, and a hidden button has no name.
      const releaseButton = screen.getByRole('button', { name: 'Release' });
      fireEvent.click(releaseButton);
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'For good' }));
      await settle();
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: the first confirm is closing as the second opens').toBe(3);
      expect(decoration.hasAttribute('data-aria-hidden'), 'CONTROL: Radix marked the sheet\'s own hidden element').toBe(true);
      expect(hiddenUp(releaseButton), 'CONTROL: the second confirm hides the sheet under it').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await settle();
      expect(decoration.getAttribute('aria-hidden'), 'the closing confirm lifted an element the sheet hid itself').toBe('true');
      expect(hiddenUp(releaseButton), 'the sheet under the closing confirm stayed hidden').toBe(false);
      expect(pageHidden(), 'the page behind the sheet still open was announced as the confirm closed').toBe(true);
      for (const dialog of [...document.querySelectorAll('[role="dialog"][data-state="closed"]')]) await finishExit(dialog);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: both confirms have unmounted, the sheet still open').toBe(1);
      expect(decoration.getAttribute('aria-hidden'), 'an element the sheet hid itself was left announced for good').toBe('true');
      expect(hiddenUp(releaseButton), 'the sheet is hidden after both confirms left').toBe(false);
    } finally { release(); }
  });

  // Review 2343 F1 (Task C42, D-8714): a node the page UN-hides while a layer is open. The page hides a body-level node X;
  // layer A records X as the page's own, and A's Radix marks X as already hidden (its undo will never take that
  // `aria-hidden` off). The page then un-hides X while A is mounted, and layer B mounts while A still is. Neither B nor A
  // may keep X as the page's own any more: B's Radix hides X again, and a layer that kept X would leave it hidden after
  // every dialog has gone. Three models of the page's un-hide (a direct DOM removal; a portal whose `aria-hidden` prop a
  // state change un-sets; and the same portal writing `aria-hidden={false}`, which React renders as "false" and the
  // `aria-hidden` package reads as not hidden: review 2353 F5), four shapes (the hand-off in both tree orders, B over A
  // with A closed by code before B closes, and B over A closing before A: review 2353 F1 and F2), and the control where
  // the page never un-hides X (it stays hidden, as C40 pinned).
  type Unhide = 'dom' | 'portal' | 'portal false';
  type Shape = 'hand-off, closing sheet first' | 'hand-off, opening sheet first' | 'over A, A closed by code'
    | 'over A, B closed first';
  const SHAPES: readonly Shape[] = ['hand-off, closing sheet first', 'hand-off, opening sheet first', 'over A, A closed by code',
    'over A, B closed first'];
  const HAND_OFFS: readonly Shape[] = ['hand-off, closing sheet first', 'hand-off, opening sheet first'];
  /** X, the page's own body-level node, as a portal the page renders and un-hides by state (the `portal` models). */
  function PortalDecoration({ hidden, shownAs }: { hidden: boolean; shownAs: false | undefined }): ReactNode {
    return createPortal(<div data-testid="x" aria-hidden={hidden ? 'true' : shownAs}>decoration</div>, document.body);
  }
  /** X as a node the page appends to the body itself (the `dom` model). */
  const plantX = (): Element => {
    const x = document.createElement('div');
    x.setAttribute('aria-hidden', 'true');
    x.textContent = 'decoration';
    document.body.appendChild(x);
    return x;
  };
  function TwoLayers({ shape, unhide }: { shape: Shape; unhide: Unhide }): ReactNode {
    const [first, setFirst] = useState(false);
    const [second, setSecond] = useState(false);
    const [xHidden, setXHidden] = useState(true);
    const handOff = HAND_OFFS.includes(shape);
    const a = (
      <Sheet open={first} onClose={() => setFirst(false)} title="Menu">
        <button type="button" onClick={() => setXHidden(false)}>Show it</button>
        <button type="button" onClick={() => { if (handOff) setFirst(false); setSecond(true); }}>Next</button>
        <button type="button" onClick={() => setFirst(false)}>Close it</button>
      </Sheet>
    );
    const b = (
      <Sheet open={second} onClose={() => setSecond(false)} title="Next sheet">
        <button type="button" onClick={() => setFirst(false)}>Close the menu</button>
        <button type="button" onClick={() => setSecond(false)}>Done</button>
      </Sheet>
    );
    return (
      <main>
        <button type="button" onClick={() => setFirst(true)}>Open it</button>
        {unhide !== 'dom' && <PortalDecoration hidden={xHidden} shownAs={unhide === 'portal false' ? false : undefined} />}
        {shape === 'hand-off, opening sheet first' ? <>{b}{a}</> : <>{a}{b}</>}
      </main>
    );
  }
  /** Runs one shape to the last layer's close, its panel still mounted, and answers X. With `rehide`, the page hides X
   *  again while B is open (review 2353 F3, the "hide during a layer" class). */
  const runTwoLayers = async (shape: Shape, unhide: Unhide | 'never',
    { strict = false, rehide = false }: { strict?: boolean; rehide?: boolean } = {}): Promise<Element> => {
    let x: Element;
    const model: Unhide = unhide === 'never' ? 'dom' : unhide;
    const tree = <TwoLayers shape={shape} unhide={model} />;
    if (model === 'dom') x = plantX();
    render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    if (model !== 'dom') x = screen.getByTestId('x');
    expect(x!.getAttribute('aria-hidden'), 'CONTROL: the page hid X').toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await settle();
    expect(x!.hasAttribute('data-aria-hidden'), 'CONTROL: A\'s Radix marked X as already hidden').toBe(true);
    if (unhide === 'portal' || unhide === 'portal false') fireEvent.click(screen.getByRole('button', { name: 'Show it', hidden: true }));
    if (unhide === 'dom') x!.removeAttribute('aria-hidden');
    await settle();
    if (unhide !== 'never') {
      expect(x!.getAttribute('aria-hidden'), 'CONTROL: the page un-hid X while A is open')
        .toBe(unhide === 'portal false' ? 'false' : null);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await settle();
    expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: A is still mounted as B mounts').toBe(2);
    expect(x!.getAttribute('aria-hidden'), 'CONTROL: B hides X').toBe('true');
    if (rehide) x!.setAttribute('aria-hidden', 'true');
    if (shape === 'over A, A closed by code') {
      fireEvent.click(screen.getByRole('button', { name: 'Close the menu' }));
      await settle();
      expect([...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('data-state')).sort(),
        'CONTROL: A closed by code under B').toEqual(['closed', 'open']);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    if (shape === 'over A, B closed first') {
      expect(pageHidden(), 'CONTROL: A, still open, keeps the page hidden as B closes').toBe(true);
      for (const dialog of [...document.querySelectorAll('[role="dialog"][data-state="closed"]')]) await finishExit(dialog);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: B has unmounted, A still open').toBe(1);
      fireEvent.click(screen.getByRole('button', { name: 'Close it' }));
      await settle();
      expect(pageHidden(), 'the page is still aria-hidden while A closes').toBe(false);
    } else {
      expect(pageHidden(), 'the page is still aria-hidden while B closes').toBe(false);
    }
    return x!;
  };
  /** The un-hide rows' end: X is announced through the last layer's exit and after every dialog has gone. */
  const expectXAnnounced = async (x: Element): Promise<void> => {
    expect.soft(x.getAttribute('aria-hidden'), 'the last layer kept X hidden through its exit as the page\'s own').not.toBe('true');
    for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
    expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: every dialog has unmounted').toBe(0);
    expect(x.getAttribute('aria-hidden'), 'X, which the page un-hid, stayed hidden after every dialog left').not.toBe('true');
    expect(pageHidden(), 'the page stayed hidden after every dialog left').toBe(false);
  };
  for (const unhide of ['dom', 'portal', 'portal false'] as const) {
    for (const shape of SHAPES) {
      it(`a node the page un-hid while a layer was open is not kept hidden by the next layer (${unhide}, ${shape})`, async () => {
        const release = holdClosingContent();
        let x: Element | undefined;
        try {
          x = await runTwoLayers(shape, unhide);
          await expectXAnnounced(x);
        } finally { if (unhide === 'dom') x?.remove(); release(); }
      });
    }
  }
  // Review 2353 F1: under React's StrictMode the second ref call of B's panel comes after B's Radix undo, but A still
  // counts X, so B's own `aria-hidden` on X survives that undo and X reads hidden at B's second record. Only a record that
  // took X out of A's set at B's first record (when X was not hidden) keeps B from taking X back in as the page's own.
  for (const unhide of ['dom', 'portal'] as const) {
    for (const shape of HAND_OFFS) {
      it(`under StrictMode, a node the page un-hid while a layer was open is not kept hidden by the next layer (${unhide}, ${shape})`, async () => {
        const release = holdClosingContent();
        let x: Element | undefined;
        try {
          x = await runTwoLayers(shape, unhide, { strict: true });
          await expectXAnnounced(x);
        } finally { if (unhide === 'dom') x?.remove(); release(); }
      });
    }
  }
  for (const shape of SHAPES) {
    for (const strict of [false, true]) {
      it(`CONTROL: a node the page hid and never un-hid stays hidden through both layers (${shape}${strict ? ', StrictMode' : ''})`, async () => {
        const release = holdClosingContent();
        let x: Element | undefined;
        try {
          x = await runTwoLayers(shape, 'never', { strict });
          expect(x.getAttribute('aria-hidden'), 'the closing sheet lifted an element the page hid itself').toBe('true');
          for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
          expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: every dialog has unmounted').toBe(0);
          expect(x.getAttribute('aria-hidden'), 'an element the page hid itself was left announced for good').toBe('true');
        } finally { x?.remove(); release(); }
      });
    }
  }

  // Review 2353 F3 and the variant's cost (Task C42, D-8714): THE "HIDE DURING A LAYER" CLASS. The page un-hides X while
  // A is open, B opens, and the page hides X again while B is open. The page's hide is a no-op on an attribute B's Radix
  // already set, so nothing tells it from B's mark, and the record takes the page's un-hide as the last word: X ends
  // announced. These rows assert TODAY's behaviour and name it, so a change to it is seen. Measured: at 6c2d705d2 the
  // second shape ends hidden, and before C40 (f8251a39d) both end announced.
  for (const shape of ['over A, A closed by code', 'over A, B closed first'] as const) {
    it(`the hide-during-a-layer class, as it stands: a node the page re-hid while a later layer was open ends announced (${shape})`, async () => {
      const release = holdClosingContent();
      let x: Element | undefined;
      try {
        x = await runTwoLayers(shape, 'dom', { rehide: true });
        for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
        expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: every dialog has unmounted').toBe(0);
        expect(x.getAttribute('aria-hidden'),
          'the hide-during-a-layer class changed: the page\'s re-hide during B now holds (update c42.md and D-8714)').toBeNull();
      } finally { x?.remove(); release(); }
    });
  }

  // Review 2353 F1 (lens 1's S2): three deep, with a layer held in its exit. The page un-hides X while A is open, B opens
  // over A, A is closed by code and is still in its exit as C opens over B, B is closed by code, and C closes last.
  it('a node the page un-hid is not kept hidden by a third layer while the first is still in its exit', async () => {
    function ThreeLayers(): ReactNode {
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      const [c, setC] = useState(false);
      return (
        <main>
          <button type="button" onClick={() => setA(true)}>Open it</button>
          <Sheet open={a} onClose={() => setA(false)} title="Menu">
            <button type="button" onClick={() => setB(true)}>Next</button>
          </Sheet>
          <Sheet open={b} onClose={() => setB(false)} title="Next sheet">
            <button type="button" onClick={() => setA(false)}>Close the menu</button>
            <button type="button" onClick={() => setC(true)}>Further</button>
          </Sheet>
          <Sheet open={c} onClose={() => setC(false)} title="Last sheet">
            <button type="button" onClick={() => setB(false)}>Close the next sheet</button>
            <button type="button" onClick={() => setC(false)}>Done</button>
          </Sheet>
        </main>
      );
    }
    const release = holdClosingContent();
    const x = plantX();
    try {
      render(<ThreeLayers />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      x.removeAttribute('aria-hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await settle();
      expect(x.getAttribute('aria-hidden'), 'CONTROL: B hides X').toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Close the menu' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Further' }));
      await settle();
      expect([...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('data-state')),
        'CONTROL: A is in its exit as C opens over B').toEqual(['closed', 'open', 'open']);
      fireEvent.click(screen.getByRole('button', { name: 'Close the next sheet' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await settle();
      expect(pageHidden(), 'the page is still aria-hidden while C closes').toBe(false);
      await expectXAnnounced(x);
    } finally { x.remove(); release(); }
  });

  // Review 2343 F2 (Task C42, D-8714): the record forgets a layer whose panel has left the document. Sheet A comes and goes
  // while the page has X hidden, so A's record holds X. The page then un-hides X, and the palette (whose hiding marks X,
  // and which never lifts its own marks) hands off to sheet B. At B's record X is hidden by the palette's mark, so only a
  // record still holding the gone A would take X for the page's own; B must lift X as it closes, like every other mark.
  // Since review 2353's variant the delete takes X out of A's set at the palette's record, so this row reds only with
  // both the prune and the delete removed (c42.md's MF2 and MF2+MF4).
  it('a layer whose panel has left is forgotten: the palette\'s mark on a node the page has since un-hid is lifted as the next sheet closes', async () => {
    function Later(): ReactNode {
      const [first, setFirst] = useState(false);
      const [palette, setPalette] = useState(false);
      const [sheet, setSheet] = useState(false);
      const options = useMemo(() => [{ id: 'shortcuts', title: 'Keyboard shortcuts' }], []);
      return (
        <main>
          <button type="button" onClick={() => setFirst(true)}>Open it</button>
          <button type="button" onClick={() => setPalette(true)}>Palette</button>
          <Sheet open={first} onClose={() => setFirst(false)} title="Menu">
            <button type="button" onClick={() => setFirst(false)}>Close</button>
          </Sheet>
          <CommandPalette open={palette} onClose={() => setPalette(false)} query="" onQueryChange={() => undefined}
            options={options} onRun={() => { setPalette(false); setSheet(true); }} />
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Shortcuts">
            <button type="button" onClick={() => setSheet(false)}>Done</button>
          </Sheet>
        </main>
      );
    }
    const release = holdClosingContent();
    const x = document.createElement('div');
    x.setAttribute('aria-hidden', 'true');
    x.textContent = 'decoration';
    document.body.appendChild(x);
    try {
      render(<Later />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      await settle();
      for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: sheet A has left the document').toBe(0);
      expect(x.getAttribute('aria-hidden'), 'CONTROL: X is still the page\'s hidden node').toBe('true');
      x.removeAttribute('aria-hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
      await settle();
      expect(x.getAttribute('aria-hidden'), 'CONTROL: the palette hides X').toBe('true');
      fireEvent.click(screen.getByRole('option', { name: /Keyboard shortcuts/ }));
      await settle();
      expect([...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('data-state')).sort(),
        'CONTROL: the palette is closing as the sheet opens').toEqual(['closed', 'open']);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await settle();
      expect(x.getAttribute('aria-hidden'), 'a forgotten layer\'s record kept X hidden through the sheet\'s exit').toBeNull();
      expect(pageHidden(), 'the page is still aria-hidden while the sheet closes').toBe(false);
      for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
      expect(x.getAttribute('aria-hidden'), 'X stayed hidden after every dialog left').toBeNull();
    } finally { x.remove(); release(); }
  });

  // Review 2353 F4 (lens 1's S15): the prune runs BEFORE the record takes in the layers' sets. The page un-hides X while
  // sheet A is open, the palette opens over A (its Radix hides X), A is closed by code and leaves the document while the
  // palette sits over it, and the palette hands off to sheet B. A record that took in the gone A's set before pruning it
  // would find X hidden (the palette's mark) in A's set and keep it as the page's own. Since the variant's delete, that
  // set has lost X at the palette's record, so this row reds only with the delete removed too (c42.md's ML1 and ML1+MF4).
  it('a layer that left under the palette is forgotten before the next sheet\'s record: X is lifted as that sheet closes', async () => {
    function UnderPalette(): ReactNode {
      const [first, setFirst] = useState(false);
      const [palette, setPalette] = useState(false);
      const [sheet, setSheet] = useState(false);
      const options = useMemo(() => [{ id: 'shortcuts', title: 'Keyboard shortcuts' }], []);
      return (
        <main>
          <button type="button" onClick={() => setFirst(true)}>Open it</button>
          <button type="button" data-testid="close-a" onClick={() => setFirst(false)}>Close A</button>
          <Sheet open={first} onClose={() => setFirst(false)} title="Menu">
            <button type="button" onClick={() => setPalette(true)}>Palette</button>
          </Sheet>
          <CommandPalette open={palette} onClose={() => setPalette(false)} query="" onQueryChange={() => undefined}
            options={options} onRun={() => { setPalette(false); setSheet(true); }} />
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Shortcuts">
            <button type="button" onClick={() => setSheet(false)}>Done</button>
          </Sheet>
        </main>
      );
    }
    const release = holdClosingContent();
    const x = plantX();
    try {
      render(<UnderPalette />);
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      x.removeAttribute('aria-hidden');
      fireEvent.click(screen.getByRole('button', { name: 'Palette' }));
      await settle();
      expect(x.getAttribute('aria-hidden'), 'CONTROL: the palette hides X').toBe('true');
      fireEvent.click(screen.getByTestId('close-a'));
      await settle();
      const sheetA = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('data-state') === 'closed');
      await finishExit(sheetA!);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: A has left; the palette is still open').toBe(1);
      fireEvent.click(screen.getByRole('option', { name: /Keyboard shortcuts/ }));
      await settle();
      expect([...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('data-state')).sort(),
        'CONTROL: the palette is closing as the sheet opens').toEqual(['closed', 'open']);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await settle();
      expect(pageHidden(), 'the page is still aria-hidden while the sheet closes').toBe(false);
      await expectXAnnounced(x);
    } finally { x.remove(); release(); }
  });

  // Review 2343 F3 (Task C42, D-8714): a reopen during the exit puts back only marks that still stand. A live region keeps
  // the palette's hiding on the children of the page (not the page), and the page drops it while the palette is open. The
  // palette hands off to a sheet, which hides the page and, as it closes, lifts the palette's marks on those children too.
  // The palette's exit then ends, and its undo takes its marks off. A reopen of the sheet during its own exit must not put
  // `aria-hidden` back on a child no modal marks any more: no close would lift it, and no undo would remove it.
  it('a reopen during the exit never re-hides a node whose mark has gone, so the sibling is not left hidden', async () => {
    function Dropped(): ReactNode {
      const [palette, setPalette] = useState(false);
      const [sheet, setSheet] = useState(false);
      const [live, setLive] = useState(true);
      const options = useMemo(() => [{ id: 'shortcuts', title: 'Keyboard shortcuts' }], []);
      return (
        <main>
          <button type="button" onClick={() => setPalette(true)}>Open it</button>
          <button type="button" data-testid="reopen" onClick={() => setSheet(true)}>Reopen</button>
          <button type="button" data-testid="drop" onClick={() => setLive(false)}>Drop the region</button>
          <p data-testid="sibling">Sibling</p>
          {live && <p aria-live="polite">Ready.</p>}
          <CommandPalette open={palette} onClose={() => setPalette(false)} query="" onQueryChange={() => undefined}
            options={options} onRun={() => { setPalette(false); setSheet(true); }} />
          <Sheet open={sheet} onClose={() => setSheet(false)} title="Shortcuts">
            <button type="button" onClick={() => setSheet(false)}>Done</button>
          </Sheet>
        </main>
      );
    }
    const release = holdClosingContent();
    try {
      render(<Dropped />);
      const sibling = screen.getByTestId('sibling');
      fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
      await settle();
      expect(sibling.hasAttribute('data-aria-hidden'), 'CONTROL: the live region keeps the palette\'s marks on the page\'s children').toBe(true);
      fireEvent.click(screen.getByTestId('drop'));
      await settle();
      fireEvent.click(screen.getByRole('option', { name: /Keyboard shortcuts/ }));
      await settle();
      expect([...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('data-state')).sort(),
        'CONTROL: the palette is closing as the sheet opens').toEqual(['closed', 'open']);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await settle();
      expect(hiddenUp(sibling), 'CONTROL: the sibling is announced as the sheet closes').toBe(false);
      const palette = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector('[role="option"]') !== null);
      await finishExit(palette!);
      expect(sibling.hasAttribute('data-aria-hidden'), 'CONTROL: the palette\'s undo took its mark off the sibling').toBe(false);
      fireEvent.click(screen.getByTestId('reopen'));
      await settle();
      expect(hiddenUp(sibling), 'CONTROL: the reopened sheet hides the page again').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      await settle();
      expect.soft(hiddenUp(sibling), 'the sibling is still hidden as the reopened sheet closes').toBe(false);
      for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
      expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: every dialog has unmounted').toBe(0);
      expect(sibling.getAttribute('aria-hidden'), 'a reopen left the sibling hidden with no mark, for good').toBeNull();
    } finally { release(); }
  });
});

/** A sheet with plain controls, opened from a button. */
function Host(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <button type="button">Behind</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="A sheet">
        <button type="button">First</button>
        <button type="button" onClick={() => setOpen(false)}>Last</button>
      </Sheet>
    </>
  );
}

describe('2. Shift+Tab pressed first stays in the sheet', () => {
  it('from the panel, Shift+Tab lands on the last control, and Tab on the first', async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    await settle();
    const panel = screen.getByRole('dialog');
    expect(document.activeElement, 'CONTROL: the panel has the focus on open').toBe(panel);
    await user.tab({ shift: true });
    expect(panel.contains(document.activeElement), 'Shift+Tab pressed first left the sheet').toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }));
    panel.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
  });
});

/** Chrome drops the focus of a control that becomes disabled, in the same task: it goes to the body, and nothing moves it
 *  anywhere else. jsdom keeps it, so a `disabled` set on the focused control or an ancestor of it drops it here, at once.
 *  The blur comes first: jsdom's `blur()` does nothing on an element that is already disabled. */
const dropLikeChrome = (): (() => void) => {
  const real = Element.prototype.setAttribute;
  const spy = vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name: string, value: string) {
    const active = document.activeElement;
    if (name === 'disabled' && active instanceof HTMLElement && this.contains(active)) active.blur();
    real.call(this, name, value);
  });
  return () => { spy.mockRestore(); };
};

/** A switch card's shape: a radio pair in a fieldset the card disables while its confirm is open (the Worktrees left behind
 *  card), or while its write waits and then on a 409 that opens the confirm (Shadow lanes, Cleanup, Stall watch). */
function Card({ shape }: { shape: 'opens-on-tap' | 'opens-on-answer' }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pick = (): void => {
    if (shape === 'opens-on-tap') { setConfirming(true); return; }
    setBusy(true);
    setTimeout(() => { act(() => { setBusy(false); setConfirming(true); }); }, 5);
  };
  return (
    <>
      <fieldset disabled={busy || confirming}>
        <legend>Keep</legend>
        <label><input type="radio" name="keep" value="off" checked onChange={() => undefined} />Off</label>
        <label><input type="radio" name="keep" value="on" checked={false} onChange={pick} />On</label>
      </fieldset>
      <QuickConfirm open={confirming} onClose={() => setConfirming(false)} title="Keep?" consequence="It keeps."
        confirmLabel="Keep" onConfirm={() => undefined} />
    </>
  );
}

describe('3. a sheet closed without a write gives the focus back to the radio group a disable dropped it from', () => {
  for (const shape of ['opens-on-tap', 'opens-on-answer'] as const) {
    for (const how of ['Cancel', 'Escape', 'scrim'] as const) {
      it(`${shape}, ${how}: the focus is back in the radio group, on its checked radio (the choice still standing)`, async () => {
        render(<Card shape={shape} />);
        const on = screen.getByRole('radio', { name: 'On' });
        on.focus();
        // A disable drops the focus: in the commit that opens the sheet, or when the write starts.
        const restore = dropLikeChrome();
        let dropped = false;
        on.addEventListener('blur', () => { dropped ||= document.activeElement === document.body || document.activeElement === null; });
        fireEvent.click(on);
        await settle();
        expect(dropped, 'CONTROL: the disable dropped the focus to the page, as Chrome does').toBe(true);
        const dialog = screen.getByRole('dialog');
        expect(dialog.contains(document.activeElement), 'CONTROL: the sheet took the focus').toBe(true);
        if (how === 'Cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        else if (how === 'Escape') fireEvent.keyDown(dialog, { key: 'Escape' });
        else fireEvent.click(screen.getByTestId('sheet-overlay'));
        await settle();
        restore();
        expect(document.activeElement, 'the focus is not back in the radio group, on its checked radio')
          .toBe(screen.getByRole('radio', { name: 'Off' }));
      });
    }
  }

  it('the focus the operator moved elsewhere (an enabled control) is never taken back', async () => {
    function Elsewhere(): ReactNode {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button">Elsewhere</button>
          <button type="button" onClick={() => setOpen(true)}>Open by state</button>
          <Sheet open={open} onClose={() => setOpen(false)} title="A sheet">
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </Sheet>
        </>
      );
    }
    render(<Elsewhere />);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    (document.activeElement as HTMLElement).blur();   // the operator taps the page: the focus goes to the body
    fireEvent.click(screen.getByRole('button', { name: 'Open by state' }));   // a click that moves no focus, as a script opens
    (document.activeElement as HTMLElement | null)?.blur?.();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settle();
    expect(document.activeElement, 'an enabled control the focus left by itself was focused again').toBe(document.body);
  });
});

// X6 XR1.2 (reader mode, spec 2026-11-20 §4.1): reader mode hides the console as the PAGE'S OWN hiding (`hideAsPage`, no
// `data-aria-hidden` mark), which the modal layers record as the page's and never lift, and a sheet on a Docs page portals
// into the reading container (`SheetPortalContext`). The console is a header and a nav standing beside the container, as ccrc's
// head and rail do.
describe('reader mode: the console hidden as the page\'s own, and sheets in the reading container (X6 XR1.2)', () => {
  /** The console (two siblings of the container), the container with its portal target and an announcement region, and a
   *  sheet whose portal target is the container's. The sheet is opened and closed through `open`, as `sheet.tsx` is used. */
  function ReadingHarness({ open }: { open: boolean }): ReactNode {
    const [portal, setPortal] = useState<HTMLElement | null>(null);
    return (
      <div data-testid="wrapper">
        <header data-testid="console-head"><button type="button">Console button</button></header>
        <nav data-testid="console-nav"><a href="#console">Console link</a></nav>
        <div data-testid="reading-container">
          <div className="docs-reading-portal" ref={setPortal} />
          <p aria-live="polite" data-testid="announce">Reading.</p>
        </div>
        <SheetPortalContext value={portal}>
          <Sheet open={open} onClose={() => undefined} title="A link">
            <button type="button">Inside the sheet</button>
          </Sheet>
        </SheetPortalContext>
      </div>
    );
  }
  const consoleNodes = (): [HTMLElement, HTMLElement] => [screen.getByTestId('console-head'), screen.getByTestId('console-nav')];
  const reading = (): HTMLElement => screen.getByTestId('reading-container');
  const isHidden = (el: Element): boolean => el.getAttribute('aria-hidden') === 'true';
  const isInert = (el: Element): boolean => el.hasAttribute('inert');
  const isMarked = (el: Element): boolean => el.hasAttribute('data-aria-hidden');
  /** Every hiding a case made: released after the case whatever it did, so a red never leaves body-level siblings inert for
   *  the next case, nor a live hiding that the next `hideAsPage` would answer. */
  const made: PageHiding[] = [];
  const hide = (keep: Element): PageHiding => {
    const h = hideAsPage(keep);
    made.push(h);
    return h;
  };
  afterEach(() => {
    for (const h of made.splice(0)) releaseAsPage(h);
  });

  it('modal layers: hideAsPage makes a node the page hid already inert without touching its aria-hidden, and releaseAsPage leaves it hidden', () => {
    render(<ReadingHarness open={false} />);
    const [head, nav] = consoleNodes();
    nav.setAttribute('aria-hidden', 'true');   // the page hid it itself, before reader mode
    const already = document.createElement('div');
    already.setAttribute('inert', '');          // inert before reader mode: not reader mode's to lift
    screen.getByTestId('wrapper').appendChild(already);

    const hiding = hide(reading());
    expect(isHidden(head) && isInert(head), 'CONTROL: a plain sibling is hidden and inert').toBe(true);
    expect(isInert(nav), 'a node the page hid already was not made inert').toBe(true);
    expect(isHidden(nav), 'its aria-hidden was touched').toBe(true);
    expect(isMarked(nav) || isMarked(head), 'a data-aria-hidden mark was written').toBe(false);
    expect(hiding.hidden, 'a node the page hid already is not reader mode\'s to un-hide').not.toContain(nav);
    expect(hiding.hidden).toContain(head);
    expect(hiding.inerted).toContain(nav);
    expect(hiding.inerted, 'a node already inert is not recorded').not.toContain(already);

    releaseAsPage(hiding);
    expect(isHidden(nav), 'releaseAsPage un-hid what the page hid').toBe(true);
    expect(isInert(nav), 'releaseAsPage left the node inert').toBe(false);
    expect(isHidden(head) || isInert(head), 'CONTROL: a plain sibling is restored').toBe(false);
    expect(isInert(already), 'a node inert before reader mode was made focusable').toBe(true);
  });

  it('modal layers: hideAsPage suspends every node outside keep, with no data-aria-hidden mark, leaves keep, its ancestors and non-content nodes untouched, and releaseAsPage restores them', () => {
    render(<ReadingHarness open={false} />);
    const outside = document.createElement('aside');   // a sibling of the render root, a child of body
    document.body.appendChild(outside);
    const wrapper = screen.getByTestId('wrapper');
    const style = document.createElement('style');
    const template = document.createElement('template');
    wrapper.append(style, template);
    try {
      const hiding = hide(reading());
      const suspended = [...consoleNodes(), outside];
      for (const node of suspended) {
        expect(isHidden(node), 'not aria-hidden while on').toBe(true);
        expect(isInert(node), 'not inert while on').toBe(true);
        expect(isMarked(node), 'a data-aria-hidden mark was written').toBe(false);
      }
      for (const node of [reading(), wrapper, screen.getByTestId('announce'), style, template]) {
        expect(isHidden(node) || isInert(node), 'the container, its ancestors and non-content nodes stay as they were').toBe(false);
      }
      releaseAsPage(hiding);
      for (const node of suspended) {
        expect(isHidden(node), 'still aria-hidden after').toBe(false);
        expect(isInert(node), 'still inert after').toBe(false);
        expect(isMarked(node)).toBe(false);
      }
    } finally { outside.remove(); }
  });

  it('sheet: a Sheet under SheetPortalContext portals into that element and stays mounted while the page is hidden and released', async () => {
    const view = render(<ReadingHarness open={false} />);
    view.rerender(<ReadingHarness open />);
    await settle();
    const dialog = screen.getByRole('dialog');
    const portal = reading().querySelector('.docs-reading-portal');
    expect(portal?.contains(dialog), 'the sheet is not drawn in the reading container (normal view)').toBe(true);
    const sameDialog = (): void => {
      const all = document.querySelectorAll('[role="dialog"]');
      expect(all.length).toBe(1);
      expect(all[0], 'the sheet was remounted').toBe(dialog);
      expect(portal?.contains(dialog)).toBe(true);
    };
    const hiding = hide(reading());
    await settle();
    sameDialog();
    releaseAsPage(hiding);
    await settle();
    sameDialog();
  });

  it('reader mode: a sheet opened and closed inside reader mode leaves the console hidden and inert', async () => {
    const release = holdClosingContent();
    try {
      const view = render(<ReadingHarness open={false} />);
      const hiding = hide(reading());
      view.rerender(<ReadingHarness open />);
      await settle();
      const dialog = screen.getByRole('dialog');
      view.rerender(<ReadingHarness open={false} />);
      await settle();
      expect(dialog.getAttribute('data-state'), 'CONTROL: the closing panel is still mounted').toBe('closed');
      for (const node of consoleNodes()) {
        expect(isHidden(node), 'the closing sheet lifted the console\'s hiding').toBe(true);
        expect(isInert(node)).toBe(true);
      }
      await finishExit(dialog);
      expect(document.querySelector('[role="dialog"]'), 'CONTROL: the sheet is gone').toBeNull();
      for (const node of consoleNodes()) {
        expect(isHidden(node), 'the console is announced after the sheet left, inside reader mode').toBe(true);
        expect(isInert(node), 'the console is focusable after the sheet left, inside reader mode').toBe(true);
        expect(isMarked(node), 'a mark is left on the console').toBe(false);
      }
      releaseAsPage(hiding);
      for (const node of consoleNodes()) expect(isHidden(node) || isInert(node), 'CONTROL: leaving restores it').toBe(false);
    } finally { release(); }
  });

  it('reader mode: leaving with a sheet open keeps the console hidden until the sheet closes, then announced', async () => {
    const release = holdClosingContent();
    try {
      const view = render(<ReadingHarness open={false} />);
      const hiding = hide(reading());
      view.rerender(<ReadingHarness open />);
      await settle();
      const dialog = screen.getByRole('dialog');
      releaseAsPage(hiding);
      for (const node of consoleNodes()) {
        expect(isInert(node), 'the console is not focusable again').toBe(false);
        expect(isHidden(node), 'the console is announced behind an open modal').toBe(true);
        expect(isMarked(node), 'CONTROL: the open modal marks it').toBe(true);
      }
      view.rerender(<ReadingHarness open={false} />);
      await settle();
      await finishExit(dialog);
      expect(document.querySelector('[role="dialog"]'), 'CONTROL: the sheet is gone').toBeNull();
      for (const node of consoleNodes()) {
        expect(isHidden(node), 'the console stayed hidden after the sheet closed').toBe(false);
        expect(isInert(node)).toBe(false);
        expect(isMarked(node)).toBe(false);
      }
    } finally { release(); }
  });

  it('reader mode: leaving during a sheet\'s exit animation announces the console at once and leaves it focusable', async () => {
    const release = holdClosingContent();
    try {
      const view = render(<ReadingHarness open={false} />);
      const hiding = hide(reading());
      view.rerender(<ReadingHarness open />);
      await settle();
      const dialog = screen.getByRole('dialog');
      view.rerender(<ReadingHarness open={false} />);
      await settle();
      expect(dialog.getAttribute('data-state'), 'CONTROL: the panel is mounted, closed').toBe('closed');
      for (const node of consoleNodes()) expect(isMarked(node), 'CONTROL: its marks are in place').toBe(true);
      releaseAsPage(hiding);
      for (const node of consoleNodes()) {
        expect(isHidden(node), 'the console is still hidden during the exit').toBe(false);
        expect(isInert(node), 'the console is still inert during the exit').toBe(false);
      }
      await finishExit(dialog);
      expect(document.querySelector('[role="dialog"]'), 'CONTROL: the sheet is gone').toBeNull();
      for (const node of consoleNodes()) {
        expect(isHidden(node), 'the console is hidden after the exit').toBe(false);
        expect(isInert(node), 'the console is inert after the exit').toBe(false);
      }
    } finally { release(); }
  });

  it('modal layers: hideAsPage leaves a live region inside keep announced', () => {
    render(<ReadingHarness open={false} />);
    const hiding = hide(reading());
    for (const node of consoleNodes()) expect(isHidden(node) && isInert(node), 'CONTROL: the console is suspended').toBe(true);
    for (let at: Element | null = screen.getByTestId('announce'); at !== null; at = at.parentElement) {
      expect(isHidden(at), `${at.tagName} is aria-hidden: the announcement is not read`).toBe(false);
      expect(isInert(at), `${at.tagName} is inert`).toBe(false);
    }
    releaseAsPage(hiding);
  });

  it('modal layers: a second hideAsPage before its release answers the live hiding, so one release restores everything', () => {
    render(<ReadingHarness open={false} />);
    const first = hide(reading());
    const second = hide(reading());
    expect(second, 'a second record that recorded nothing').toBe(first);
    releaseAsPage(second);
    for (const node of consoleNodes()) expect(isHidden(node) || isInert(node), 'the console stayed suspended').toBe(false);
    const third = hide(reading());
    expect(third, 'CONTROL: after the release a new hiding is made').not.toBe(first);
    expect(third.hidden, 'CONTROL: and it records the console').toEqual(expect.arrayContaining(consoleNodes()));
  });
});

// X6 XR fix round 2, review 4043 F1: a sheet that UNMOUNTS while open, after reader mode has ended behind it, must give the
// console back. `releaseAsPage` keeps `aria-hidden` on a node a modal marked, for that modal's close to lift; an unmount is no
// close, and Radix's own undo never removes an `aria-hidden` it found already set.
describe('reader mode: a sheet unmounted while open after reader mode ended gives the console back (X6 XR fix round 2, F1)', () => {
  function Unmount({ first, second }: { first: boolean | 'closed'; second: boolean | 'closed' }): ReactNode {
    const [portal, setPortal] = useState<HTMLElement | null>(null);
    return (
      <div data-testid="wrapper">
        <header data-testid="console-head"><button type="button">Console button</button></header>
        <nav data-testid="console-nav"><a href="#console">Console link</a></nav>
        <div data-testid="reading-container">
          <div className="docs-reading-portal" ref={setPortal} />
        </div>
        <SheetPortalContext value={portal}>
          {first !== false && <Sheet open={first === true} onClose={() => undefined} title="First"><button type="button">Inside the first</button></Sheet>}
          {second !== false && <Sheet open={second === true} onClose={() => undefined} title="Second"><button type="button">Inside the second</button></Sheet>}
        </SheetPortalContext>
      </div>
    );
  }
  const consoleNodes = (): HTMLElement[] => [screen.getByTestId('console-head'), screen.getByTestId('console-nav')];
  const hiddenNow = (): boolean[] => consoleNodes().map((n) => n.hasAttribute('aria-hidden'));
  const made: PageHiding[] = [];
  afterEach(() => {
    for (const h of made.splice(0)) releaseAsPage(h);
  });
  const hideConsole = (): PageHiding => {
    const h = hideAsPage(screen.getByTestId('reading-container'));
    made.push(h);
    return h;
  };

  it('reader mode: an open sheet unmounted after reader mode ended leaves no console node hidden', async () => {
    const view = render(<Unmount first={false} second={false} />);
    const hiding = hideConsole();
    view.rerender(<Unmount first second={false} />);
    await settle();
    expect(screen.getByRole('dialog').getAttribute('data-state'), 'CONTROL: the sheet is open').toBe('open');
    releaseAsPage(hiding);
    expect(hiddenNow(), 'CONTROL: the open modal keeps the console hidden after reader mode ends').toEqual([true, true]);
    view.rerender(<Unmount first={false} second={false} />);
    await settle();
    expect(document.querySelector('[role="dialog"]'), 'CONTROL: the sheet is gone').toBeNull();
    expect(hiddenNow(), 'the console stayed aria-hidden after the sheet unmounted').toEqual([false, false]);
    expect(consoleNodes().map((n) => n.hasAttribute('inert'))).toEqual([false, false]);
  });

  it('reader mode: with a second dialog still open, the console stays hidden until that one unmounts too', async () => {
    const view = render(<Unmount first={false} second={false} />);
    const hiding = hideConsole();
    view.rerender(<Unmount first second={false} />);
    await settle();
    releaseAsPage(hiding);
    view.rerender(<Unmount first second />);
    await settle();
    expect(document.querySelectorAll('[role="dialog"][data-state="open"]'), 'CONTROL: two dialogs are open').toHaveLength(2);
    view.rerender(<Unmount first={false} second />);
    await settle();
    expect(document.querySelectorAll('[role="dialog"][data-state="open"]'), 'CONTROL: one dialog is left').toHaveLength(1);
    expect(hiddenNow(), 'the first sheet\'s unmount lifted the console from behind the second one').toEqual([true, true]);
    view.rerender(<Unmount first={false} second={false} />);
    await settle();
    expect(document.querySelector('[role="dialog"]'), 'CONTROL: both are gone').toBeNull();
    expect(hiddenNow(), 'the console stayed aria-hidden after the last dialog unmounted').toEqual([false, false]);
  });

  it('reader mode: a closed sheet mounting in StrictMode (its effects torn down and set up again) lifts nothing from behind an open dialog', async () => {
    const view = render(<StrictMode><Unmount first={false} second={false} /></StrictMode>);
    const hiding = hideConsole();
    view.rerender(<StrictMode><Unmount first second={false} /></StrictMode>);
    await settle();
    releaseAsPage(hiding);
    expect(hiddenNow(), 'CONTROL: hidden behind the open sheet').toEqual([true, true]);
    view.rerender(<StrictMode><Unmount first second="closed" /></StrictMode>);
    await settle();
    expect(document.querySelectorAll('[role="dialog"]'), 'CONTROL: the second sheet drew no panel').toHaveLength(1);
    expect(hiddenNow(), 'a sheet\'s simulated unmount lifted the console from behind the open dialog').toEqual([true, true]);
  });

  it('reader mode: a node handed to a modal that then closed is the next reader mode\'s own, and a sheet unmounting there does not lift it', async () => {
    const view = render(<Unmount first={false} second={false} />);
    const hiding = hideConsole();
    view.rerender(<Unmount first second={false} />);
    await settle();
    releaseAsPage(hiding);
    view.rerender(<Unmount first="closed" second={false} />);
    await settle();
    expect(document.querySelector('[role="dialog"]'), 'CONTROL: the sheet is closed and gone').toBeNull();
    expect(hiddenNow(), 'CONTROL: the close lifted the console').toEqual([false, false]);
    hideConsole();
    expect(hiddenNow(), 'CONTROL: reader mode hides it again').toEqual([true, true]);
    view.rerender(<Unmount first="closed" second="closed" />);
    await settle();
    view.rerender(<Unmount first="closed" second={false} />);
    await settle();
    expect(hiddenNow(), 'a sheet\'s unmount lifted the hiding of the reader mode that stands').toEqual([true, true]);
  });

  // Review M1 of the round: the set outlives the modal's normal close. A node a sheet's close gave back stays in it until some later
  // unmount finds it visible; if another layer (the command palette, which lifts nothing of its own) hides the console by then, that
  // unmount would take the other layer's `aria-hidden` off early. A new layer's mount drops from the set what is visible by then.
  it('reader mode: a node handed to a sheet that then closed normally is not lifted later from under another layer\'s hiding (review M1)', async () => {
    const view = render(<Unmount first={false} second={false} />);
    const hiding = hideConsole();
    view.rerender(<Unmount first second={false} />);
    await settle();
    releaseAsPage(hiding);
    expect(hiddenNow(), 'CONTROL: the open sheet keeps the console hidden after reader mode ends').toEqual([true, true]);
    view.rerender(<Unmount first="closed" second={false} />);
    await settle();
    expect(document.querySelector('[role="dialog"]'), 'CONTROL: the sheet is closed and gone').toBeNull();
    expect(hiddenNow(), 'CONTROL: the sheet\'s close lifted the console').toEqual([false, false]);
    // A later layer mounts its panel (the palette's callback ref does this) and hides the console as Radix's `hideOthers` would.
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    try {
      recordModalLayer(panel);
      for (const node of consoleNodes()) {
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('data-aria-hidden', 'true');
      }
      expect(document.querySelector('[role="dialog"][data-state="open"]'), 'CONTROL: no dialog is open').toBeNull();
      view.rerender(<Unmount first={false} second="closed" />);
      await settle();
      view.rerender(<Unmount first={false} second={false} />);
      await settle();
      expect(hiddenNow(), 'a later sheet\'s unmount lifted the console from under the other layer\'s hiding').toEqual([true, true]);
    } finally {
      panel.remove();
      for (const node of consoleNodes()) {
        node.removeAttribute('aria-hidden');
        node.removeAttribute('data-aria-hidden');
      }
    }
  });

  // X6 follow-up, review 4052 A1. The held console is given back when the LAST dialog over it closes, whichever layer that is:
  // the command palette lifts none of its own marks, so its close gives back what reader mode held (the five steps through the
  // real Docs screen are `reader-mode.test.tsx`'s "Go to" row). And a node still held when the next reader mode starts (no
  // layer is in the document then) is adopted by that hiding, so its release gives it back instead of leaving it hidden for good.
  function WithPalette({ first, palette }: { first: boolean; palette: boolean | 'gone' }): ReactNode {
    return (
      <>
        <Unmount first={first} second={false} />
        {palette !== 'gone' && (
          <CommandPalette open={palette} onClose={() => undefined} query="" onQueryChange={() => undefined} options={[]} onRun={() => undefined} />
        )}
      </>
    );
  }

  it('reader mode: a node held for a sheet that unmounts under the open palette is given back when the palette closes, and not before (review 4052 A1)', async () => {
    const view = render(<WithPalette first={false} palette={false} />);
    const hiding = hideConsole();
    view.rerender(<WithPalette first palette={false} />);
    await settle();
    releaseAsPage(hiding);
    expect(hiddenNow(), 'CONTROL: the open sheet keeps the console hidden after reader mode ends').toEqual([true, true]);
    view.rerender(<WithPalette first palette />);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Command palette' }).getAttribute('data-state'), 'CONTROL: the palette is open').toBe('open');
    view.rerender(<WithPalette first={false} palette />);
    await settle();
    expect(screen.queryByRole('dialog', { name: 'First' }), 'CONTROL: the sheet unmounted').toBeNull();
    expect(hiddenNow(), 'the console was announced under the open palette').toEqual([true, true]);
    view.rerender(<WithPalette first={false} palette={false} />);
    await settle();
    expect(document.querySelector('[role="dialog"][data-state="open"]'), 'CONTROL: no dialog is open').toBeNull();
    expect(hiddenNow(), 'the console stayed aria-hidden after the palette, the last dialog over it, closed').toEqual([false, false]);
  });

  it('reader mode: a node held for a sheet that unmounts under the open palette is given back when the palette unmounts open (review 4052 A1)', async () => {
    const view = render(<WithPalette first={false} palette={false} />);
    const hiding = hideConsole();
    view.rerender(<WithPalette first palette={false} />);
    await settle();
    releaseAsPage(hiding);
    view.rerender(<WithPalette first palette />);
    await settle();
    view.rerender(<WithPalette first={false} palette />);
    await settle();
    expect(hiddenNow(), 'CONTROL: hidden under the open palette').toEqual([true, true]);
    const head = screen.getByTestId('console-head');
    view.rerender(<WithPalette first={false} palette="gone" />);
    await settle();
    expect(document.querySelector('[role="dialog"]'), 'CONTROL: the palette unmounted').toBeNull();
    expect(screen.getByTestId('console-head'), 'CONTROL: the console nodes are the same elements').toBe(head);
    expect(hiddenNow(), 'the console stayed aria-hidden after the palette unmounted open').toEqual([false, false]);
  });

  it('reader mode: a node still held when the next reader mode starts is adopted by it, so leaving gives it back (review 4052 A1)', async () => {
    const view = render(<Unmount first={false} second={false} />);
    const hiding = hideConsole();
    view.rerender(<Unmount first second={false} />);
    await settle();
    releaseAsPage(hiding);
    // A dialog no modal layer owns (no lift of its own) stands while the sheet unmounts, then goes: the console is still held.
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.setAttribute('data-state', 'open');
    document.body.appendChild(other);
    view.rerender(<Unmount first={false} second={false} />);
    await settle();
    other.remove();
    expect(document.querySelector('[role="dialog"]'), 'CONTROL: no dialog is left').toBeNull();
    expect(hiddenNow(), 'CONTROL: the console is still held hidden, with no modal left to lift it').toEqual([true, true]);
    expect(consoleNodes().map((n) => n.hasAttribute('data-aria-hidden')), 'CONTROL: no modal marks it').toEqual([false, false]);
    const second = hideConsole();
    expect(hiddenNow(), 'CONTROL: the second reader mode hides it').toEqual([true, true]);
    releaseAsPage(second);
    expect(hiddenNow(), 'the node held from before stayed hidden after the second reader mode ended').toEqual([false, false]);
    expect(consoleNodes().map((n) => n.hasAttribute('inert'))).toEqual([false, false]);
  });

  it('reader mode: a held node the next hiding does not reach stays held, so a later unmount with no dialog open gives it back (review 4052 A1)', async () => {
    const view = render(<Unmount first={false} second={false} />);
    const hiding = hideConsole();
    view.rerender(<Unmount first second={false} />);
    await settle();
    releaseAsPage(hiding);
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.setAttribute('data-state', 'open');
    document.body.appendChild(other);
    view.rerender(<Unmount first={false} second={false} />);
    await settle();
    other.remove();
    expect(hiddenNow(), 'CONTROL: the console is still held hidden').toEqual([true, true]);
    // A hiding kept inside the console head: the head contains `keep`, so this hiding does not reach it.
    const inner = hideAsPage(screen.getByRole('button', { name: 'Console button', hidden: true }));
    made.push(inner);
    releaseAsPage(inner);
    expect(hiddenNow(), 'CONTROL: the reached node is given back, the head is not reached').toEqual([true, false]);
    view.rerender(<Unmount first="closed" second={false} />);
    await settle();
    view.rerender(<Unmount first={false} second={false} />);
    await settle();
    expect(document.querySelector('[role="dialog"]'), 'CONTROL: no dialog is left').toBeNull();
    expect(hiddenNow(), 'a held node the hiding did not reach was not given back by the next unmount with no dialog open').toEqual([false, false]);
  });

  it('modal layers: with reader mode never used, the held set stays empty through every sheet\'s mount, close and unmount and the palette\'s, and a node the page hid stays hidden (review 4052 A1)', async () => {
    const pageOwn = document.createElement('aside');
    pageOwn.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pageOwn);
    try {
      const view = render(<WithPalette first={false} palette={false} />);
      expect(heldNodeCount(), 'CONTROL: nothing held at the start').toBe(0);
      view.rerender(<WithPalette first palette={false} />);
      await settle();
      view.rerender(<WithPalette first palette />);
      await settle();
      view.rerender(<WithPalette first={false} palette />);
      await settle();
      expect(heldNodeCount(), 'a sheet unmounting under the palette held a node').toBe(0);
      expect(consoleNodes().map(hiddenUp), 'CONTROL: the palette hides the console while open').toEqual([true, true]);
      view.rerender(<WithPalette first={false} palette={false} />);
      await settle();
      view.rerender(<WithPalette first palette={false} />);
      await settle();
      view.rerender(<WithPalette first={false} palette="gone" />);
      await settle();
      expect(heldNodeCount(), 'the palette\'s close or unmount or a sheet\'s unmount held a node').toBe(0);
      expect(document.querySelector('[role="dialog"]'), 'CONTROL: every layer is gone').toBeNull();
      expect(consoleNodes().map(hiddenUp), 'CONTROL: the console is announced as on main').toEqual([false, false]);
      expect(pageOwn.getAttribute('aria-hidden'), 'a lift took the page\'s own hiding').toBe('true');
    } finally {
      pageOwn.remove();
    }
  });
});
