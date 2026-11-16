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
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickConfirm, Sheet } from '@ccrc/ui';

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
