// "Since you were last here" (Overlord W1 home B, Task 6; spec §4.1, Table 4.1b; plan question 8): the L1 decider and the
// device's stamp. A failed read says "unmeasured", never "quiet" and never 0; the block holds Table 4.1b's order and its cap of
// seven; a device with no stamp reads the last 24 hours; a storage that throws is "no stamp".
import { createElement } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgrammesAnswer } from '../../shared/api';
import type { ParkedApprovalView } from '../../shared/approval-park';
import type { ItemView } from '../../shared/ledgers';
import { api, ApiError } from '../src/lib/api';
import { LAST_HERE_KEY, readLastHere, writeLastHere } from '../src/overlord/lastHere';
import { SincePart } from '../src/overlord/SincePart';
import {
  SINCE_DEFAULT_WINDOW_MS, SINCE_MAX_LINES, SINCE_ORDER, SINCE_WINDOW_WORDS, UNMEASURED_TEXT, sinceLines, sinceOf,
  type SinceFacts, type SinceProgrammes, type SinceRead,
} from '../src/overlord/sinceWords';
import { memoryStorage } from '../src/lib/storage';
import { itemView, waitingView } from './ledgersFixture';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

const ok = <T,>(value: T): SinceRead<T> => ({ state: 'answered', value });
const FAILED: SinceRead<never> = { state: 'failed' };
const waves = { working: 0, waiting: 0, queued: 0 };
const programmes = (over: Partial<SinceProgrammes> = {}): SinceProgrammes => ({
  closedToday: { operator: 0, sweep: 0, coordinator: 0 }, programmes: [], ...over,
});
const facts = (over: Partial<SinceFacts> = {}): SinceFacts => ({ waiting: ok({ items: [] }), programmes: ok(programmes()), ...over });
const openItems = (n: number): ItemView[] => Array.from({ length: n }, (_, i) => itemView({ id: i + 1 }));
const stalled = (slug: string, stuck: number, title = `Programme ${slug}`) => ({ slug, title, stuck, waves });

describe('sinceLines: the order, the cap and the failure contract', () => {
  it('Table 4.1b: Needs you first, then Changed that matters', () => {
    const lines = sinceLines(facts({ waiting: ok({ items: openItems(2) }), programmes: ok(programmes({ closedToday: { operator: 1, sweep: 0, coordinator: 2 } })) }), NOW - HOUR, NOW);
    expect(lines.map((l) => l.section)).toEqual(['needs-you', 'changed', 'changed']);
    expect(lines.map((l) => l.text)).toEqual(['2 items waiting on you', '3 runs closed since you were last here', 'no programme stalled']);
    const order = lines.map((l) => SINCE_ORDER[l.section]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(SINCE_ORDER).toEqual({ 'needs-you': 1, changed: 2, missed: 3, overturnable: 4, trust: 5, routine: 6 });
  });

  it('counts only open items, and the parked approvals beside them', () => {
    const items = [itemView({ id: 1 }), itemView({ id: 2, state: 'checking' }), itemView({ id: 3, state: 'done' })];
    expect(sinceLines(facts({ waiting: ok({ items }) }), NOW - HOUR, NOW)[0]!.text).toBe('1 item waiting on you');
    const approvals = [{}, {}] as unknown as ParkedApprovalView[];
    expect(sinceLines(facts({ waiting: ok({ items, approvals }) }), NOW - HOUR, NOW)[0]!.text).toBe('3 items waiting on you');
  });

  it('a measured zero says what is true, and is a measured line', () => {
    const lines = sinceLines(facts(), NOW - HOUR, NOW);
    expect(lines.every((l) => l.measured)).toBe(true);
    expect(lines.map((l) => l.text)).toEqual(['nothing waiting on you', 'no run closed since you were last here', 'no programme stalled']);
  });

  it('a failed read is "unmeasured" on every line it feeds, never "quiet" and never 0', () => {
    const both = sinceLines({ waiting: FAILED, programmes: FAILED }, NOW - HOUR, NOW);
    expect(both.map((l) => l.text)).toEqual([UNMEASURED_TEXT, UNMEASURED_TEXT, UNMEASURED_TEXT]);
    expect(both.every((l) => !l.measured)).toBe(true);
    for (const l of both) expect(l.text).not.toMatch(/quiet|\b0\b|nothing|no run|no programme/i);
    // One failure does not colour the other read's lines.
    const waitingOnly = sinceLines(facts({ waiting: FAILED, programmes: ok(programmes({ closedToday: { operator: 0, sweep: 2, coordinator: 0 } })) }), NOW - HOUR, NOW);
    expect(waitingOnly.map((l) => [l.key, l.text])).toEqual([
      ['needs-you', UNMEASURED_TEXT], ['closed', '2 runs closed since you were last here'], ['stalled', 'no programme stalled'],
    ]);
    const programmesOnly = sinceLines(facts({ programmes: FAILED }), NOW - HOUR, NOW);
    expect(programmesOnly.map((l) => [l.key, l.text])).toEqual([
      ['needs-you', 'nothing waiting on you'], ['closed', UNMEASURED_TEXT], ['stalled', UNMEASURED_TEXT],
    ]);
  });

  it('a stalled programme is its own line, titled as the session wrote it, in text', () => {
    const lines = sinceLines(facts({ programmes: ok(programmes({ programmes: [stalled('prog-a', 2, '<b>Prog A</b>'), stalled('prog-b', 1, '')] })) }), NOW - HOUR, NOW);
    expect(lines.filter((l) => l.key.startsWith('stalled')).map((l) => [l.key, l.text])).toEqual([
      ['stalled:prog-a', '<b>Prog A</b> stalled: 2 runs stuck'], ['stalled:prog-b', 'prog-b stalled: 1 run stuck'],
    ]);
  });

  it('a programme whose stuck pass has not run is unmeasured, never "not stalled"', () => {
    const open = { slug: 'prog-a', title: 'A', waves: { working: 1, waiting: 0, queued: 0 } };
    const ended = { slug: 'prog-b', title: 'B', waves };
    const lines = sinceLines(facts({ programmes: ok(programmes({ programmes: [open, ended] })) }), NOW - HOUR, NOW);
    expect(lines.map((l) => [l.key, l.text])).toContainEqual(['stalled-unmeasured', UNMEASURED_TEXT]);
    expect(lines.map((l) => l.text)).not.toContain('no programme stalled');
  });

  it('holds the cap of seven: the sixth line is kept, the rest are counted, never silently cut', () => {
    const many = Array.from({ length: 9 }, (_, i) => stalled(`prog-${i}`, 1));
    const lines = sinceLines(facts({ programmes: ok(programmes({ programmes: many })) }), NOW - HOUR, NOW);
    expect(SINCE_MAX_LINES).toBe(7);
    expect(lines).toHaveLength(SINCE_MAX_LINES);
    expect(lines[0]!.key).toBe('needs-you');
    // 1 needs-you + 1 closed + 9 stalled = 11 lines; six are kept and five are counted.
    expect(lines.slice(0, 6).map((l) => l.key)).toEqual(['needs-you', 'closed', 'stalled:prog-0', 'stalled:prog-1', 'stalled:prog-2', 'stalled:prog-3']);
    expect(lines[6]).toMatchObject({ key: 'more', text: '5 more not shown' });
    // Exactly seven fit with no count.
    const seven = Array.from({ length: 5 }, (_, i) => stalled(`prog-${i}`, 1));
    const fit = sinceLines(facts({ programmes: ok(programmes({ programmes: seven })) }), NOW - HOUR, NOW);
    expect(fit).toHaveLength(7);
    expect(fit.map((l) => l.key)).not.toContain('more');
  });
});

describe('the window: a device with no stamp reads the last 24 hours', () => {
  it('sinceOf: the stamp, or 24 hours back when there is none or the stamp is ahead of the clock', () => {
    expect(SINCE_DEFAULT_WINDOW_MS).toBe(24 * HOUR);
    expect(sinceOf(null, NOW)).toBe(NOW - 24 * HOUR);
    expect(sinceOf(NOW - 5 * HOUR, NOW)).toBe(NOW - 5 * HOUR);
    expect(sinceOf(NOW + HOUR, NOW)).toBe(NOW - 24 * HOUR);
  });
  it('the lines say which window they cover', () => {
    const closed = (stamp: number | null) => sinceLines(facts(), stamp, NOW).find((l) => l.key === 'closed')!.text;
    expect(closed(null)).toBe(`no run closed ${SINCE_WINDOW_WORDS.default}`);
    expect(closed(NOW - HOUR)).toBe(`no run closed ${SINCE_WINDOW_WORDS.stamped}`);
    expect(closed(NOW + HOUR)).toBe(`no run closed ${SINCE_WINDOW_WORDS.default}`);
  });
});

describe('lastHere: the one reader and writer of the stamp', () => {
  afterEach(() => { window.localStorage.clear(); });
  const throwing = () => ({
    getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); },
  });

  it('writes the stamp and reads it back; a key under the console namespace that avoids the letters "auth"', () => {
    expect(LAST_HERE_KEY.startsWith('ccrc:')).toBe(true);
    expect(LAST_HERE_KEY).not.toMatch(/auth/i);
    const store = memoryStorage();
    expect(readLastHere(() => store)).toBeNull();
    expect(writeLastHere(NOW, () => store)).toBe(true);
    expect(store.getItem(LAST_HERE_KEY)).toBe(String(NOW));
    expect(readLastHere(() => store)).toBe(NOW);
  });

  it('reads the page storage when none is handed', () => {
    expect(readLastHere()).toBeNull();
    writeLastHere(NOW);
    expect(window.localStorage.getItem(LAST_HERE_KEY)).toBe(String(NOW));
    expect(readLastHere()).toBe(NOW);
  });

  it('a throwing storage reads as no stamp, and a write to it changes nothing and says so', () => {
    expect(readLastHere(throwing)).toBeNull();
    expect(writeLastHere(NOW, throwing)).toBe(false);
    expect(readLastHere(() => { throw new Error('naming it throws'); })).toBeNull();
    expect(readLastHere(() => null)).toBeNull();
  });

  it('a stored value that is not a stamp reads as no stamp', () => {
    const store = memoryStorage();
    for (const bad of ['', 'yesterday', '-5', '1.5', '1e12', '12abc', '99999999999999999999', '{"at":1}']) {
      store.setItem(LAST_HERE_KEY, bad);
      expect(readLastHere(() => store), bad).toBeNull();
    }
  });
});

describe('SincePart: reads on mount, reads the stamp before it writes the new one', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });
  const programmesAnswer = (over: Partial<ProgrammesAnswer> = {}): ProgrammesAnswer =>
    ({ ok: true, programmes: [], closedToday: { operator: 0, sweep: 1, coordinator: 1 }, ...over });
  const mount = () => render(createElement(SincePart, { now: () => NOW }));

  it('asks the programmes read from the stamp it read, and then keeps this visit as the stamp', async () => {
    window.localStorage.setItem(LAST_HERE_KEY, String(NOW - 5 * HOUR));
    vi.spyOn(api, 'waiting').mockResolvedValue({ ok: true, waiting: waitingView({ items: openItems(1) }) });
    const programmes = vi.spyOn(api, 'programmes').mockResolvedValue(programmesAnswer());
    mount();
    await screen.findByText('1 item waiting on you');
    expect(programmes).toHaveBeenCalledWith(NOW - 5 * HOUR);
    expect(screen.getByText('2 runs closed since you were last here')).toBeInTheDocument();
    expect(window.localStorage.getItem(LAST_HERE_KEY)).toBe(String(NOW));
  });

  it('a device with no stamp reads the last 24 hours, and says so', async () => {
    vi.spyOn(api, 'waiting').mockResolvedValue({ ok: true, waiting: waitingView() });
    const programmes = vi.spyOn(api, 'programmes').mockResolvedValue(programmesAnswer());
    mount();
    await screen.findByText('2 runs closed in the last 24 hours');
    expect(programmes).toHaveBeenCalledWith(NOW - 24 * HOUR);
  });

  it('a read that failed says "unmeasured" on its lines and never "quiet"; the other read still answers', async () => {
    vi.spyOn(api, 'waiting').mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable' }));
    vi.spyOn(api, 'programmes').mockResolvedValue({ ok: true, nope: 1 } as unknown as ProgrammesAnswer);
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('[data-since-line]').length).toBe(3));
    const lines = [...container.querySelectorAll('[data-since-line]')];
    expect(lines.map((l) => [l.getAttribute('data-since-line'), l.querySelector('.ov-since-text')!.textContent, l.getAttribute('data-measured')])).toEqual([
      ['needs-you', 'unmeasured', 'false'], ['closed', 'unmeasured', 'false'], ['stalled', 'unmeasured', 'false'],
    ]);
    expect(container.textContent).not.toMatch(/quiet/i);
  });

  it('a storage that throws is no stamp: the block still draws, and the write is lost without a throw', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(api, 'waiting').mockResolvedValue({ ok: true, waiting: waitingView() });
    const programmes = vi.spyOn(api, 'programmes').mockResolvedValue(programmesAnswer());
    mount();
    await screen.findByText('nothing waiting on you');
    expect(programmes).toHaveBeenCalledWith(NOW - 24 * HOUR);
  });
});
