// QuickConfirm's opt-in `defaultFocus` (D-5507, settings spec §6.3). A danger confirm puts the focus on Cancel, so
// an Enter or a Space pressed out of habit answers "no", and closing it hands the focus back to the control that
// opened it. The default is today's behaviour: the sheet takes no focus on open (vaul's `autoFocus` is false), so
// the opener keeps it, and every untouched caller (Archive all, the swap, abandon, resume and session-action sheets)
// is unchanged.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
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
});
