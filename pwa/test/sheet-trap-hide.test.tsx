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
import { CommandPalette, QuickConfirm, Sheet } from '@ccrc/ui';

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
  // effects (Radix's undo runs, so this sheet's own marks are gone), re-attaches the ref (the second call), then reconnects
  // the effects (review 2343 F5). So the second call sees only other layers' marks: here the menu's, still closing, which
  // a read of every hidden node would take for what the page hid (C40's mutant M7). The menu's hand-off, in both tree
  // orders.
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
  // `aria-hidden` off). The page then removes X's `aria-hidden` while A is mounted, and layer B mounts while A still is.
  // B must not take X in from A's record as the page's own: B's Radix hides X again, so a B that keeps X would leave it
  // hidden after every dialog has gone. Two models of the page's un-hide (a direct DOM removal, and a portal whose
  // `aria-hidden` prop a state change un-sets), three shapes (the hand-off in both tree orders, and B over A with A closed
  // by code before B closes), and the control where the page never un-hides X (it stays hidden, as C40 pinned).
  type Unhide = 'dom' | 'portal';
  type Shape = 'hand-off, closing sheet first' | 'hand-off, opening sheet first' | 'over A, A closed by code';
  const SHAPES: readonly Shape[] = ['hand-off, closing sheet first', 'hand-off, opening sheet first', 'over A, A closed by code'];
  /** X, the page's own body-level node, as a portal the page renders and un-hides by state (the `portal` model). */
  function PortalDecoration({ hidden }: { hidden: boolean }): ReactNode {
    return createPortal(<div data-testid="x" aria-hidden={hidden ? 'true' : undefined}>decoration</div>, document.body);
  }
  function TwoLayers({ shape, unhide }: { shape: Shape; unhide: Unhide }): ReactNode {
    const [first, setFirst] = useState(false);
    const [second, setSecond] = useState(false);
    const [xHidden, setXHidden] = useState(true);
    const handOff = shape !== 'over A, A closed by code';
    const a = (
      <Sheet open={first} onClose={() => setFirst(false)} title="Menu">
        <button type="button" onClick={() => setXHidden(false)}>Show it</button>
        <button type="button" onClick={() => { if (handOff) setFirst(false); setSecond(true); }}>Next</button>
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
        {unhide === 'portal' && <PortalDecoration hidden={xHidden} />}
        {shape === 'hand-off, opening sheet first' ? <>{b}{a}</> : <>{a}{b}</>}
      </main>
    );
  }
  const runTwoLayers = async (shape: Shape, unhide: Unhide | 'never'): Promise<Element> => {
    let x: Element;
    if (unhide === 'portal') {
      render(<TwoLayers shape={shape} unhide="portal" />);
      x = screen.getByTestId('x');
    } else {
      x = document.createElement('div');
      x.setAttribute('aria-hidden', 'true');
      x.textContent = 'decoration';
      document.body.appendChild(x);
      render(<TwoLayers shape={shape} unhide="dom" />);
    }
    expect(x.getAttribute('aria-hidden'), 'CONTROL: the page hid X').toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await settle();
    expect(x.hasAttribute('data-aria-hidden'), 'CONTROL: A\'s Radix marked X as already hidden').toBe(true);
    if (unhide === 'portal') fireEvent.click(screen.getByRole('button', { name: 'Show it', hidden: true }));
    if (unhide === 'dom') x.removeAttribute('aria-hidden');
    await settle();
    if (unhide !== 'never') expect(x.getAttribute('aria-hidden'), 'CONTROL: the page un-hid X while A is open').toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await settle();
    expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: A is still mounted as B mounts').toBe(2);
    expect(x.getAttribute('aria-hidden'), 'CONTROL: B hides X').toBe('true');
    if (shape === 'over A, A closed by code') {
      fireEvent.click(screen.getByRole('button', { name: 'Close the menu' }));
      await settle();
      expect([...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute('data-state')).sort(),
        'CONTROL: A closed by code under B').toEqual(['closed', 'open']);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await settle();
    expect(pageHidden(), 'the page is still aria-hidden while B closes').toBe(false);
    return x;
  };
  for (const unhide of ['dom', 'portal'] as const) {
    for (const shape of SHAPES) {
      it(`a node the page un-hid while a layer was open is not kept hidden by the next layer (${unhide}, ${shape})`, async () => {
        const release = holdClosingContent();
        let x: Element | undefined;
        try {
          x = await runTwoLayers(shape, unhide);
          expect.soft(x.getAttribute('aria-hidden'), 'B kept X hidden through its exit as the page\'s own').toBeNull();
          for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
          expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: every dialog has unmounted').toBe(0);
          expect(x.getAttribute('aria-hidden'), 'X, which the page un-hid, stayed hidden after every dialog left').toBeNull();
          expect(pageHidden(), 'the page stayed hidden after every dialog left').toBe(false);
        } finally { if (unhide === 'dom') x?.remove(); release(); }
      });
    }
  }
  for (const shape of SHAPES) {
    it(`CONTROL: a node the page hid and never un-hid stays hidden through both layers (${shape})`, async () => {
      const release = holdClosingContent();
      let x: Element | undefined;
      try {
        x = await runTwoLayers(shape, 'never');
        expect(x.getAttribute('aria-hidden'), 'the closing sheet lifted an element the page hid itself').toBe('true');
        for (const dialog of [...document.querySelectorAll('[role="dialog"]')]) await finishExit(dialog);
        expect(document.querySelectorAll('[role="dialog"]').length, 'CONTROL: every dialog has unmounted').toBe(0);
        expect(x.getAttribute('aria-hidden'), 'an element the page hid itself was left announced for good').toBe('true');
      } finally { x?.remove(); release(); }
    });
  }

  // Review 2343 F2 (Task C42, D-8714): the record forgets a layer whose panel has left the document. Sheet A comes and goes
  // while the page has X hidden, so A's record holds X. The page then un-hides X, and the palette (whose hiding marks X,
  // and which never lifts its own marks) hands off to sheet B. At B's record X is hidden by the palette's mark, so only a
  // record still holding the gone A would take X for the page's own; B must lift X as it closes, like every other mark.
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
