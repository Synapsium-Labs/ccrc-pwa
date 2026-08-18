// VACUUM: nothing in `pwa/test` renders the draft-conflict sheet at all.
//
// The sheet showed ONE row — `draftOf`'s marker row — as though it were the
// whole draft, and "Append anyway" retyped that row plus the new text over a
// cleared box. Every row below the first was destroyed, under a button whose
// label says it is appending to them. Task 405 made the 409 carry every row
// the box holds; this pins that the sheet RENDERS them and says how many,
// because the count is what tells the operator the two buttons are about to
// act on more than they can see at a glance.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../src/session/Composer';
import type { PendingSend } from '../src/stores/session';

afterEach(cleanup);

const TWO_ROWS = 'the human’s real first line\nand a second line';

const conflicted = (draft: string): PendingSend[] => ([{
  key: 'p1', text: 'my message', state: 'failed',
  error: 'draft-present', code: 'draft-present', draft,
}]);

// `onSend` is a REQUIRED prop of the real component (ComposerProps), so it is
// passed rather than the sheet-only props the plan's snippet listed. Nothing
// here calls it: the sheet resolves through `onResolve`, which is the whole
// point of the in-place re-send.
const sheet = (draft: string, onResolve = vi.fn()) => {
  const r = render(
    <Composer id="s" onSend={vi.fn()} pending={conflicted(draft)} onResolve={onResolve} />,
  );
  return { ...r, onResolve };
};

describe('the draft-conflict sheet', () => {
  it('renders EVERY row the box holds, not just the first', async () => {
    sheet(TWO_ROWS);
    const well = await screen.findByTestId('draft-well');
    expect(well.textContent).toBe(TWO_ROWS);
  });

  it('says how many rows it is about to replace', async () => {
    sheet(TWO_ROWS);
    expect(await screen.findByText(/2 lines/)).toBeInTheDocument();
  });

  it('says "1 line" for a single-row draft — never "1 lines"', async () => {
    sheet('just the one');
    expect(await screen.findByText(/1 line\b/)).toBeInTheDocument();
  });

  // `failureOf` coerces a 409 that carried no `draft` to `''` (session.ts:316),
  // so "no rows" is a REACHABLE state and not a hypothetical — an older server,
  // or one that refused without saying what it read. A count is the one thing
  // the sheet must not print there: "0 lines of unsent text" contradicts the
  // refusal that opened the sheet. It says it does not know instead.
  it('never claims a count it does not have — an empty draft says so', async () => {
    sheet('');
    expect(await screen.findByText(/didn’t say what/)).toBeInTheDocument();
    expect(screen.queryByText(/0 lines/)).toBeNull();
  });

  // `fireEvent`, not `userEvent`, and deliberately: this sheet is a vaul
  // Drawer, whose pointerup handler reads a transform off a node jsdom never
  // laid out — a full pointer sequence throws inside the library, unhandled,
  // and reds the file around an assertion that passed. Every other sheet suite
  // here (abandon-sheet, swap-sheet, archive-conflict-sheet) clicks the same
  // way for the same reason.
  it('Append anyway carries EVERY row, not the first plus the new text', async () => {
    const { onResolve } = sheet(TWO_ROWS);
    fireEvent.click(await screen.findByRole('button', { name: 'Append anyway' }));
    expect(onResolve).toHaveBeenCalledWith(
      'p1', `${TWO_ROWS}\nmy message`, { replaceDraft: true },
    );
  });

  it('Replace draft still sends only the new text', async () => {
    const { onResolve } = sheet(TWO_ROWS);
    fireEvent.click(await screen.findByRole('button', { name: 'Replace draft' }));
    expect(onResolve).toHaveBeenCalledWith('p1', 'my message', { replaceDraft: true });
  });
});
