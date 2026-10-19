// QuickConfirm's opt-in `defaultFocus` (D-5507, settings spec §6.3). A danger confirm puts the focus on Cancel, so
// an Enter or a Space pressed out of habit answers "no", and closing it hands the focus back to the control that
// opened it. The default is today's behaviour: the sheet takes no focus on open (vaul's `autoFocus` is false), so
// the opener keeps it, and every untouched caller (Archive all, the swap, abandon, resume and session-action sheets)
// is unchanged.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickConfirm } from '@ccrc/ui';
import { fleetSession } from './fleetFixture';
import { ArchiveAllConfirm } from '../src/fleet/ArchiveAllPlane';

afterEach(() => { cleanup(); });

/** Lets Radix's portal mount and its focus scope settle (both are effects, one of them a timeout). */
const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

function Host({ defaultFocus }: { defaultFocus?: 'confirm' | 'cancel' }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open it</button>
      <QuickConfirm open={open} onClose={() => setOpen(false)} title="Roll back?" consequence="It moves back."
        confirmLabel="Roll back" tone="danger" onConfirm={() => {}}
        {...(defaultFocus === undefined ? {} : { defaultFocus })} />
    </>
  );
}

function ArchiveHost(): ReactNode {
  const [project, setProject] = useState<string | null>(null);
  const rel = { runId: 1, program: 'program-a', programTitle: null, claimedBy: 'coord', closedAt: 1, child: false };
  const sessions = [fleetSession({ id: 'project-a-lane-a', project: 'project-a', workspace: 'lane-a', releasedFrom: rel })];
  return (
    <>
      <button type="button" onClick={() => setProject('project-a')}>Archive all</button>
      <ArchiveAllConfirm project={project} sessions={sessions} onClose={() => setProject(null)} onConfirm={() => {}} />
    </>
  );
}

describe('QuickConfirm — defaultFocus', () => {
  it('an untouched caller (Archive all) focuses as today: the opener keeps the focus, Cancel does not take it', async () => {
    render(<ArchiveHost />);
    const opener = screen.getByRole('button', { name: 'Archive all' });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).not.toBe(cancel);
    expect(document.activeElement).toBe(opener);
  });

  it("a QuickConfirm with no defaultFocus is today's, the same as 'confirm'", async () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('defaultFocus="cancel" focuses Cancel', async () => {
    render(<Host defaultFocus="cancel" />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('defaultFocus="cancel": closing returns the focus to the control that opened it', async () => {
    render(<Host defaultFocus="cancel" />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  // D-5610: `autoFocus` fires only when Cancel MOUNTS. In a browser the sheet keeps its closing content mounted for
  // the close transition (Radix's Presence waits for the exit animation it reads from the computed style), so a
  // confirm reopened inside that window reuses the same Cancel node and `autoFocus` never runs again: measured, the
  // focus stayed on the opener behind an open modal on 10 of 12 reopens at 1280. jsdom has no animations, so this
  // case gives the dialog a computed exit animation that never ends, which keeps the closed content mounted exactly
  // as the browser's transition does.
  it('defaultFocus="cancel": reopened while the closing content is still mounted, Cancel takes the focus again', async () => {
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
    try {
      render(<Host defaultFocus="cancel" />);
      const opener = screen.getByRole('button', { name: 'Open it' });
      opener.focus();
      fireEvent.click(opener);
      await settle();
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(document.activeElement).toBe(cancel);
      fireEvent.click(cancel);
      await settle();
      expect(document.activeElement).toBe(opener);
      // The closing content is still in the document: the reopen reuses this very Cancel.
      expect(cancel.isConnected).toBe(true);
      const focusOpts: Array<FocusOptions | undefined> = [];
      const realFocus = HTMLElement.prototype.focus;
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
        if (this === cancel) focusOpts.push(opts);
        realFocus.call(this, opts);
      });
      try {
        fireEvent.click(opener);
        await settle();
      } finally {
        focusSpy.mockRestore();
      }
      const dialog = screen.getByRole('dialog');
      expect(screen.getByRole('button', { name: 'Cancel' })).toBe(cancel);
      expect(document.activeElement).toBe(cancel);
      expect(dialog.contains(document.activeElement)).toBe(true);
      // D-5610 (extended): the reopen's focus does not scroll the sheet either.
      expect(focusOpts.length).toBeGreaterThan(0);
      for (const o of focusOpts) expect(o?.preventScroll).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  // D-5610 (extended): Cancel is focused without scrolling. The danger sheet's body is its own scroller, and Cancel
  // sits at the foot of it, so a plain `focus()` (what `autoFocus` does) scrolls the question and the plan out of view
  // on a short phone: measured at 375x667, the rollback sheet opened 172 px down with its title above the top. Every
  // focus the confirm moves to Cancel passes `preventScroll`, on a first open and on a reopen.
  it('defaultFocus="cancel": every focus moved to Cancel passes preventScroll, so the sheet opens at its top', async () => {
    const calls: Array<{ el: HTMLElement; opts: FocusOptions | undefined }> = [];
    const real = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
      calls.push({ el: this, opts });
      real.call(this, opts);
    });
    try {
      render(<Host defaultFocus="cancel" />);
      const opener = screen.getByRole('button', { name: 'Open it' });
      opener.focus();
      fireEvent.click(opener);
      await settle();
      const cancel = screen.getByRole('button', { name: 'Cancel' });
      expect(document.activeElement).toBe(cancel);
      const onCancel = calls.filter((c) => c.el === cancel);
      expect(onCancel.length).toBeGreaterThan(0);
      for (const c of onCancel) expect(c.opts?.preventScroll).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
