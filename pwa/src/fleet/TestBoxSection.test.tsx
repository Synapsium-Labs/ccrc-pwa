// Test box plan TB10 (D-7412; spec 2026-10-28 §2.7 "The card"): Settings › Automation › Test box in jsdom. The card is
// handed a poll, as the Settings frame hands it one; the width band is the desk and wide queries, stubbed per case, and
// the two writes are read at the fetch, so the bytes a write sends are what is held. `browser/testbox-card.browser.test.ts`
// holds what only an engine can say: the three widths' geometry and that nothing overflows sideways.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DESK_QUERY } from '@ccrc/ui';
import type { TestboxHostMeasure } from '../../../shared/agent-protocol';
import { TESTBOX_FALLBACK, TESTBOX_PROTO, TESTBOX_STATE_MAP, type StatusAnswer, type TestboxState } from '../../../shared/testbox';
import { SETTINGS_CARDS } from './settingsText';
import { TESTBOX_TEXT, TESTBOX_WIDE_QUERY, TestBoxSection, fallbackLabel } from './TestBoxSection';
import { asTestboxRead, type TestboxBlock, type TestboxPoll } from './useTestboxView';

const T = TESTBOX_TEXT;
const NOW = Date.parse('2026-10-30T12:00:00Z');
const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const HOST: TestboxHostMeasure = { tools: TOOLS, release: 'v0.0.900', measuredAt: '2026-10-30T11:59:59Z' };
const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900', tools: TOOLS,
  sync: { state: 'idle', detail: null, at: '2026-10-30T10:00:00Z' }, runs: { inProgress: 1, limit: 4 }, queueDepth: 2,
  pristine: [
    { repository: 'project-a', package: 'server', key: 'aaaaaaaaaaaaaaaa' },
    { repository: 'project-a', package: 'server', key: 'bbbbbbbbbbbbbbbb' },
    { repository: 'project-a', package: 'pwa', key: 'cccccccccccccccc' },
  ],
  failedKeys: [{ repository: 'project-a', package: 'agent', key: 'dddddddddddddddddddd', exit: 1, attempts: 3, nextAttempt: '2026-10-30T13:00:00Z' }],
  heldRunUsers: [], repositories: [{ name: 'project-a', mirrorPath: '/srv/mirrors/project-a.git' }],
};

const block = (over: Partial<TestboxBlock> = {}): TestboxBlock => ({
  state: 'ok', reasons: [], summary: 'ok', switch: 'off', at: NOW - 60_000, host: HOST, box: STATUS,
  counts: { remote: 7, fallback: 3, refused: 1, unreadable: 0, byReason: { 'queue-full': 2, unreachable: 1, 'unmerged-paths': 1 } },
  ...over,
});

/** One block per state, each as the server's decider answers it (`server/src/testbox.ts`). */
const STATES: Readonly<Record<TestboxState, TestboxBlock>> = {
  off: block({ state: 'off', summary: 'off', box: null }),
  ok: block(),
  degraded: block({
    state: 'degraded', reasons: ['tools differ (node 22.11.0 vs 22.12.0)'], summary: 'degraded (tools differ (node 22.11.0 vs 22.12.0))',
    box: { ...STATUS, tools: { ...TOOLS, node: '22.12.0' } },
  }),
  down: block({ state: 'down', reasons: ['missing mirror project-a'], summary: 'down (missing mirror project-a)', box: { ...STATUS, state: 'down', reason: 'missing mirror project-a' } }),
  unreachable: block({ state: 'unreachable', reasons: ['no status answer within 3000 ms'], summary: 'unreachable (no status answer within 3000 ms)', box: null }),
};

const poll = (b: TestboxBlock | null, reload = vi.fn()): TestboxPoll => ({ view: { block: b }, failure: null, reload });

type Band = 'phone' | 'laptop' | 'wide';
/** The desk and wide queries answer as the band's viewport would. */
const atBand = (band: Band): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: (q === DESK_QUERY && band !== 'phone') || (q === TESTBOX_WIDE_QUERY && band === 'wide'),
    media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => false,
  }));
};

/** A fetch that answers 200 with `answer`, recording each call. */
const stubFetch = (answer: unknown) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
};

const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const card = (): HTMLElement => screen.getByRole('region', { name: SETTINGS_CARDS.automation.testbox.title });
const q = <E extends Element = HTMLElement>(sel: string, root: ParentNode = card()): E | null => root.querySelector<E>(sel);
const tablesIn = (root: Element | null): string[] =>
  root === null ? [] : [...root.querySelectorAll('[data-table]')].map((t) => t.getAttribute('data-table') ?? '');

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('spec §2.7 width table, row by row (D-7412)', () => {
  it('phone: one column, the state on top, the button full-width, and one disclosure holding the versions, counts, pristine installs and failed keys', () => {
    atBand('phone');
    render(<TestBoxSection poll={poll(STATES.degraded)} />);
    expect(card().getAttribute('data-band')).toBe('phone');
    const head = q('[data-testbox="head"]')!;
    const cells = q('[data-testbox="cells"]')!;
    // The switch and the state sit above everything else in the card's body.
    expect(head.compareDocumentPosition(cells) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(q('[data-testbox="state-line"]')!).getByText(T.state(STATES.degraded.summary))).toBeInTheDocument();
    const button = screen.getByRole('button', { name: T.sync });
    expect(button).toHaveClass('w-full');
    // The two-row summary: runs and queue only.
    expect([...cells.querySelectorAll('[data-cell]')].map((c) => c.getAttribute('data-cell'))).toEqual(['runs', 'queue']);
    const disclosure = q<HTMLDetailsElement>('details[data-testbox="disclosure"]')!;
    expect(disclosure.open).toBe(false);
    expect(tablesIn(disclosure).sort()).toEqual(['counts', 'failed', 'pristine', 'versions']);
    expect(q('[data-testbox="open"]')).toBeNull();
    expect(card().querySelectorAll('details')).toHaveLength(1);
  });

  it('laptop: the state line ends with the button, a three-cell row, and the versions table open under it', () => {
    atBand('laptop');
    render(<TestBoxSection poll={poll(STATES.degraded)} />);
    expect(card().getAttribute('data-band')).toBe('laptop');
    const line = q('[data-testbox="state-line"]')!;
    expect(line.lastElementChild).toBe(screen.getByRole('button', { name: T.sync }));
    expect(line.lastElementChild).not.toHaveClass('w-full');
    expect([...q('[data-testbox="cells"]')!.querySelectorAll('[data-cell]')].map((c) => c.getAttribute('data-cell')))
      .toEqual(['runs', 'queue', 'fallbacks']);
    const open = q('[data-testbox="open"]')!;
    expect(tablesIn(open)).toEqual(['versions']);
    expect(open).not.toHaveClass('testbox-tables--side');
    expect(tablesIn(q('details[data-testbox="disclosure"]')).sort()).toEqual(['counts', 'failed', 'pristine']);
  });

  it('wide: the versions and pristine-installs tables open side by side', () => {
    atBand('wide');
    render(<TestBoxSection poll={poll(STATES.degraded)} />);
    expect(card().getAttribute('data-band')).toBe('wide');
    const open = q('[data-testbox="open"]')!;
    expect(open).toHaveClass('testbox-tables--side');
    expect(tablesIn(open)).toEqual(['versions', 'pristine']);
    expect(tablesIn(q('details[data-testbox="disclosure"]')).sort()).toEqual(['counts', 'failed']);
    expect([...q('[data-testbox="cells"]')!.querySelectorAll('[data-cell]')]).toHaveLength(3);
  });
});

describe('every state, once with the switch on and once with it off (D-7444)', () => {
  const cases = (Object.keys(TESTBOX_STATE_MAP) as TestboxState[]).flatMap((s) => (['on', 'off'] as const).map((sw) => ({ s, sw })));
  it.each(cases)('$s with the switch $sw: the state reads the same, only the switch moves', ({ s, sw }) => {
    atBand('laptop');
    render(<TestBoxSection poll={poll({ ...STATES[s], switch: sw })} />);
    const state = q('[data-testbox="state"]')!;
    expect(state.textContent).toBe(T.state(STATES[s].summary));
    expect(state.getAttribute('data-state')).toBe(s);
    expect(screen.getByRole('radio', { name: T.on })).toHaveProperty('checked', sw === 'on');
    expect(screen.getByRole('radio', { name: T.off })).toHaveProperty('checked', sw === 'off');
  });

  it('an ok box with the switch off reads ok, with Off checked', () => {
    atBand('phone');
    render(<TestBoxSection poll={poll(block({ switch: 'off' }))} />);
    expect(q('[data-testbox="state"]')!.textContent).toBe(T.state('ok'));
    expect(screen.getByRole('radio', { name: T.off })).toBeChecked();
    expect(screen.getByRole('radio', { name: T.on })).not.toBeChecked();
  });

  it('an unknown switch checks neither position and says why', () => {
    atBand('phone');
    render(<TestBoxSection poll={poll(block({ switch: 'unknown' }))} />);
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(screen.getByText(T.switchUnknown)).toBeInTheDocument();
  });
});

describe('Bring tools up to date', () => {
  it('is hidden when nothing differs and no sync failed', () => {
    atBand('laptop');
    render(<TestBoxSection poll={poll(STATES.ok)} />);
    expect(screen.queryByRole('button', { name: T.sync })).toBeNull();
    expect(q('[data-differs]')).toBeNull();
    expect(q('[data-testbox="last-sync"]')).toBeNull();
  });

  it('shows when a tool differs, with that cell marked through versionCellsDiffer', () => {
    atBand('laptop');
    render(<TestBoxSection poll={poll(STATES.degraded)} />);
    const marked = [...card().querySelectorAll('[data-table="versions"] [data-differs="true"]')];
    expect(marked.map((td) => td.closest('tr')!.firstElementChild!.textContent)).toEqual(['node']);
    expect(screen.getByRole('button', { name: T.sync })).toBeEnabled();
    expect(q('[data-testbox="last-sync"]')!.textContent).toBe(T.lastSync('2026-10-30 10:00 UTC', T.syncDone));
  });

  it('shows when the last sync failed, with its time and result under it', () => {
    atBand('laptop');
    render(<TestBoxSection poll={poll(block({ box: { ...STATUS, sync: { state: 'failed', detail: 'chrome: 404', at: '2026-10-30T11:00:00Z' } } }))} />);
    expect(screen.getByRole('button', { name: T.sync })).toBeEnabled();
    expect(q('[data-testbox="last-sync"]')!.textContent).toBe(T.lastSync('2026-10-30 11:00 UTC', T.syncFailed('chrome: 404')));
  });

  it('reads syncing <tool> and is disabled while the box syncs', () => {
    atBand('phone');
    render(<TestBoxSection poll={poll(block({ box: { ...STATUS, sync: { state: 'syncing', detail: 'node', at: null } } }))} />);
    const b = screen.getByRole('button', { name: T.syncing('node') });
    expect(b).toBeDisabled();
  });

  it('posts no body, is disabled until the sync ends, and re-reads the block', async () => {
    atBand('laptop');
    let finish: (r: Response) => void = () => {};
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Promise<Response>((r) => { finish = r; });
    }));
    const reload = vi.fn();
    render(<TestBoxSection poll={poll(STATES.degraded, reload)} />);
    fireEvent.click(screen.getByRole('button', { name: T.sync }));
    await settle();
    expect(screen.getByRole('button', { name: T.syncing(T.syncingAll) })).toBeDisabled();
    const sent = calls.filter((c) => c.url.endsWith('/api/testbox/tools-sync'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.init?.method).toBe('POST');
    expect(sent[0]!.init?.body).toBeUndefined();
    await act(async () => { finish(new Response(JSON.stringify({ ok: true, outcome: 'sent', detail: null, frame: null }), { status: 200 })); });
    await settle();
    expect(screen.getByRole('button', { name: T.sync })).toBeEnabled();
    expect(screen.getByText(T.syncSent)).toBeInTheDocument();
    expect(reload).toHaveBeenCalled();
  });
});

describe('the switch', () => {
  it('posts {on} only, and its position stays the block\'s until the re-read moves it', async () => {
    atBand('phone');
    const calls = stubFetch({ ok: true, requested: true });
    const reload = vi.fn();
    render(<TestBoxSection poll={poll(block({ switch: 'off' }), reload)} />);
    fireEvent.click(screen.getByRole('radio', { name: T.on }));
    await settle();
    const sent = calls.filter((c) => c.url.endsWith('/api/testbox/switch'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(sent[0]!.init?.body))).toEqual({ on: true });
    expect(reload).toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: T.off })).toBeChecked();
  });

  it('turning it off posts {on: false}', async () => {
    atBand('laptop');
    const calls = stubFetch({ ok: true, requested: false });
    render(<TestBoxSection poll={poll(block({ switch: 'on' }))} />);
    fireEvent.click(screen.getByRole('radio', { name: T.off }));
    await settle();
    expect(calls.filter((c) => c.url.endsWith('/api/testbox/switch')).map((c) => JSON.parse(String(c.init?.body))))
      .toEqual([{ on: false }]);
  });
});

describe('the counts, the installs and the failed keys', () => {
  it('runs in progress of the limit and the queue depth', () => {
    atBand('laptop');
    render(<TestBoxSection poll={poll(STATES.ok)} />);
    const cells = q('[data-testbox="cells"]')!;
    expect(within(cells).getByText(T.runs(1, 4))).toBeInTheDocument();
    expect(within(cells).getByText(T.queue(2))).toBeInTheDocument();
    expect(within(cells).getByText('4')).toBeInTheDocument();   // fallbacks: 3 fell back, 1 refused
  });

  it('groups the 24-hour fallbacks by reason in TESTBOX_FALLBACK order', () => {
    atBand('wide');
    render(<TestBoxSection poll={poll(STATES.ok)} />);
    const rows = [...card().querySelectorAll('[data-table="counts"] tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent));
    const label = (id: string): string => fallbackLabel(TESTBOX_FALLBACK.find((r) => r.id === id)!.text);
    expect(rows).toEqual([[T.remote, '7'], [label('unreachable'), '1'], [label('queue-full'), '2'], [label('unmerged-paths'), '1'], [T.refused, '1']]);
    expect(label('unreachable')).toBe('unreachable');
    expect(label('runs-locally')).toBe('… runs locally');
  });

  it('the pristine installs per package, and each failed key with its exit, attempts and next attempt', () => {
    atBand('wide');
    render(<TestBoxSection poll={poll(STATES.ok)} />);
    const rows = (name: string): (string | null)[][] =>
      [...card().querySelectorAll(`[data-table="${name}"] tbody tr`)].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows('pristine')).toEqual([['project-a', 'server', '2'], ['project-a', 'pwa', '1']]);
    expect(rows('failed')).toEqual([['agent', 'dddddddddddd', '1', '3', '2026-10-30 13:00 UTC']]);
  });

  it('the last answer time and the service and protocol versions', () => {
    atBand('phone');
    render(<TestBoxSection poll={poll(STATES.ok)} />);
    expect(q('[data-testbox="answer"]')!.textContent).toContain(T.service('1.0.0', TESTBOX_PROTO));
    expect(q('[data-testbox="answer"]')!.textContent).toMatch(/^Last answer \S.* ago/);
  });
});

describe('the read', () => {
  it('a server that has not polled yet says so; a skeleton before the first read; an unread read says so', () => {
    atBand('phone');
    render(<TestBoxSection poll={poll(null)} />);
    expect(screen.getByText(T.unpolled)).toBeInTheDocument();
    cleanup();
    render(<TestBoxSection poll={{ view: null, failure: 'failed', reload: vi.fn() }} />);
    expect(screen.getByText(T.unread)).toBeInTheDocument();
  });

  it('the guard reads a block, null before the first pass, and refuses a block with a state it does not know', () => {
    expect(asTestboxRead({ ok: true, testbox: null })).toEqual({ block: null });
    expect(asTestboxRead({ ok: true, testbox: JSON.parse(JSON.stringify(STATES.degraded)) })?.block?.state).toBe('degraded');
    expect(asTestboxRead({ ok: true, testbox: { ...STATES.ok, state: 'armed' } })).toBeNull();
    expect(asTestboxRead({ ok: true, testbox: { ...STATES.ok, switch: 'maybe' } })).toBeNull();
    expect(asTestboxRead({ ok: true, testbox: { ...STATES.ok, box: { ...STATUS, proto: 'one' } } })).toBeNull();
  });
});
