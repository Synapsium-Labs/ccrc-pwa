// The hold item's Clear (Overlord W1 home C, Task 9, plan F17): an open Overlord hold item names its lane in its title, so its
// detail carries the same Clear as Settings › Overlord's account facts, with the item's other acts after History (call 1684).
// Clear only for such an item, sent once, with no step-up.
// Neutral names only: the repository is public.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { READINESS_ITEM_TEXT } from '../../shared/overlord-readiness';
import { OVERLORD_ITEM_PROGRAMME } from '../../shared/overlord-sequence';
import { ApiError, OVERLORD_SETTINGS_REFUSAL_TEXT, api } from '../src/lib/api';
import { ItemView } from '../src/ledgers/ItemView';
import { FACT_WORDS } from '../src/overlord/overlordSettingsWords';
import { NOW, itemView } from './ledgersFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const holdItem = (over: Partial<ReturnType<typeof itemView>> = {}) => itemView({
  program: OVERLORD_ITEM_PROGRAMME, kind: 'do', title: `${READINESS_ITEM_TEXT.hold.title}: lane-a`,
  why: READINESS_ITEM_TEXT.hold.why, how: [...READINESS_ITEM_TEXT.hold.how], ...over,
});
const show = (item: ReturnType<typeof itemView>): void => {
  render(<ItemView item={item} onTick={vi.fn()} onDismiss={vi.fn()} programmeLive={true} now={NOW} />);
};
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

describe('the hold item draws the Clear for the lane it names', () => {
  it('an open hold item carries Clear for its lane, and Clear calls the door once', async () => {
    let resolve!: (v: unknown) => void;
    const clear = vi.spyOn(api, 'clearAccountHold').mockImplementation(() => new Promise((r) => { resolve = r; }));
    show(holdItem());
    const button = screen.getByRole('button', { name: FACT_WORDS.clear });
    expect(document.querySelector('[data-item-hold="lane-a"]')).not.toBeNull();
    // Ruled call 1684: with the item's other acts, after everything there is to read, History included.
    const history = screen.getByRole('heading', { name: 'History' });
    expect(history.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.closest('[aria-label="Your move"]')).not.toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith('lane-a');
    await act(async () => { resolve({ ok: true, lane: 'lane-a' }); });
    await settle();
    expect(screen.queryByRole('button', { name: FACT_WORDS.clear })).toBeNull();
    expect(screen.getByText(FACT_WORDS.cleared)).toBeTruthy();
  });

  it.each([
    ['a closed hold item', holdItem({ state: 'done' })],
    ['another programme\'s item with the same title', holdItem({ program: 'prog-a' })],
    ['an Overlord item that is not a hold', holdItem({ title: READINESS_ITEM_TEXT.count.title })],
    ['an ordinary item', itemView()],
  ])('%s draws no Clear', (_name, item) => {
    show(item);
    expect(document.querySelector('[data-item-hold]')).toBeNull();
    expect(screen.queryByRole('button', { name: FACT_WORDS.clear })).toBeNull();
  });

  it('a hold that no longer stands says so, and the button goes', async () => {
    vi.spyOn(api, 'clearAccountHold').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    show(holdItem());
    fireEvent.click(screen.getByRole('button', { name: FACT_WORDS.clear }));
    expect(await screen.findByText(OVERLORD_SETTINGS_REFUSAL_TEXT['no-hold'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: FACT_WORDS.clear })).toBeNull();
  });
});
