// The reader lab page (native Docs reader, the reader lab plan of 2026-11-03, Task 10; the rich-docs spec's row M10.12):
// its states with a fake run module, and `api.readerLab`'s requests. Before, running, stopping, done and failed; the result
// is selected, never copied; leaving the page stops the run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LAB_MOUNT_WAIT_MS, LAB_PROBE_NAMES, type LabProbeName, type LabProbeTally, type LabRunView } from '../../shared/readerLab';
import { createApi } from '../src/lib/api';
import * as realRun from '../src/readerLab/run';
import { LAB_CHECKS } from '../src/readerLab/checks';
import { LAB_TEXT } from '../src/readerLab/labText';
import type { LabDeps, LabProgress, LabResult } from '../src/readerLab/run';
import { ReaderLab } from '../src/screens/ReaderLab';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type RunModule = typeof import('../src/readerLab/run');

class FakeFailure extends Error {
  readonly word: string;
  constructor(word: string) {
    super(word);
    this.word = word;
  }
}

const HOLDS = Object.fromEntries(LAB_CHECKS.map((k) => [k, { verdict: 'holds', detail: '' }])) as unknown as LabResult['outcomes'];
const RESULT = { outcomes: HOLDS, local: { selfNavLoads: 2, busy: null, mounts: [], hostile: null, strays: null }, run: null, finalRead: 'read' } as LabResult;

/** A run module whose run is `run`; it records the deps it was handed. */
function fakeModule(run: (deps: LabDeps, progress: (p: LabProgress) => void) => Promise<LabResult>): { mod: RunModule; handed: LabDeps[] } {
  const handed: LabDeps[] = [];
  const mod = {
    runReaderLab: vi.fn(async (deps: LabDeps, progress: (p: LabProgress) => void) => { handed.push(deps); return run(deps, progress); }),
    defaultLabDeps: vi.fn((p: { stage: HTMLElement; signal: AbortSignal }) => ({ stage: p.stage, signal: p.signal }) as unknown as LabDeps),
    labResultText: vi.fn(() => 'reader-lab 1 · a fake block'),
    LabFailure: FakeFailure,
  } as unknown as RunModule;
  return { mod, handed };
}

describe('the reader lab page (reader lab plan, Task 10)', () => {
  it('before: the title, the intro, the journal note, the device line, ten lines not run, and Start', () => {
    render(<ReaderLab load={() => Promise.resolve(fakeModule(async () => RESULT).mod)} />);
    expect(screen.getByRole('heading', { level: 1, name: LAB_TEXT.title })).toBeInTheDocument();
    expect(screen.getByText(LAB_TEXT.intro)).toBeInTheDocument();
    expect(screen.getByText(LAB_TEXT.journal)).toBeInTheDocument();
    expect(screen.getByText(/ · worker (?:yes|no) · frame sandbox (?:yes|no) · csp attribute (?:yes|no)$/)).toBeInTheDocument();
    expect(LAB_CHECKS).toHaveLength(10);
    expect(screen.getAllByText(LAB_TEXT.notRun)).toHaveLength(LAB_CHECKS.length);
    for (const id of LAB_CHECKS) expect(screen.getByText(LAB_TEXT.checks[id])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: LAB_TEXT.start })).toBeInTheDocument();
  });

  it('Start loads the run once, and Done shows every outcome, the result block and Select result', async () => {
    const f = fakeModule(async () => RESULT);
    const load = vi.fn(() => Promise.resolve(f.mod));
    render(<ReaderLab load={load} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => screen.getByText(LAB_TEXT.result));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(LAB_TEXT.verdict.holds)).toHaveLength(LAB_CHECKS.length);
    expect(screen.getByText('reader-lab 1 · a fake block').tagName).toBe('PRE');
    expect(f.handed[0]!.stage).toBe(document.querySelector('.reader-lab-stage'));
  });

  it('Select result selects the whole block, and nothing writes the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ReaderLab load={() => Promise.resolve(fakeModule(async () => RESULT).mod)} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => screen.getByText(LAB_TEXT.result));
    const select = vi.fn();
    vi.spyOn(window, 'getSelection').mockReturnValue({ selectAllChildren: select } as unknown as Selection);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.select }));
    expect(select).toHaveBeenCalledWith(screen.getByText('reader-lab 1 · a fake block'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('Stop aborts the run and returns to Before; leaving the page aborts it too', async () => {
    const waitForAbort = (deps: LabDeps): Promise<LabResult> => new Promise((_, reject) => {
      deps.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    });
    const f = fakeModule(waitForAbort);
    render(<ReaderLab load={() => Promise.resolve(f.mod)} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => expect(f.handed).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.stop }));
    await waitFor(() => screen.getByRole('button', { name: LAB_TEXT.start }));
    expect(f.handed[0]!.signal.aborted).toBe(true);
    cleanup();
    const g = fakeModule(waitForAbort);
    const view = render(<ReaderLab load={() => Promise.resolve(g.mod)} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => expect(g.handed).toHaveLength(1));
    view.unmount();
    expect(g.handed[0]!.signal.aborted).toBe(true);
  });

  it('Stop during the real run final close returns to Before after close resolves', async () => {
    let releaseClose: () => void = () => undefined;
    const closing = new Promise<void>((resolve) => { releaseClose = resolve; });
    const close = vi.fn(() => closing);
    const tally: LabProbeTally = { hits: 0, cookie: 0, upgrade: 0,
      site: { 'same-origin': 0, 'same-site': 0, 'cross-site': 0, none: 0, absent: 0, other: 0 },
      origin: { null: 0, absent: 0, present: 0 } };
    const probes = Object.fromEntries(LAB_PROBE_NAMES.map((n) => [n, { ...tally, hits: n === 'popup-ran' ? 1 : 0 }])) as Record<LabProbeName, LabProbeTally>;
    const view: LabRunView = { openedAt: 0, expiresAt: 600_000, counted: 0, ignored: 0, saturated: false, probes };
    let clock = 0;
    const mod: RunModule = { ...realRun, defaultLabDeps: ({ stage, signal }) => ({
      stage, signal, origin: 'https://box.example', gapWindow: 'ready',
      door: { open: async () => ({ nonce: 'AAAAAAAAAAAAAAAAAAAAAA' }), read: async () => view, close, probe: async () => undefined },
      mountFrame: () => ({ loads: () => 1, remove: () => undefined }),
      render: async () => ({ kind: 'not-rendered' }) as Awaited<ReturnType<LabDeps['render']>>,
      mountReader: async () => { throw new Error('unexpected mount'); },
      frame: async () => (clock += 16), now: () => clock,
      sleep: (ms) => ms >= LAB_MOUNT_WAIT_MS ? new Promise<void>(() => undefined) : ((clock += ms), Promise.resolve()),
      address: () => 'https://box.example',
    }) };
    render(<ReaderLab load={async () => mod} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/^9 of 9:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.stop }));
    expect(screen.getByText(LAB_TEXT.stopping)).toBeInTheDocument();
    releaseClose();
    await waitFor(() => expect(screen.getByRole('button', { name: LAB_TEXT.start })).toBeInTheDocument());
    expect(screen.getAllByText(LAB_TEXT.notRun)).toHaveLength(LAB_CHECKS.length);
    expect(screen.queryByText(LAB_TEXT.stopping)).toBeNull();
    expect(screen.queryByText(LAB_TEXT.result)).toBeNull();
  });

  it('a check decided by the current step reads running, not its partial outcome', async () => {
    const f = fakeModule((deps, progress) => new Promise<LabResult>((_, reject) => {
      progress({ step: 1, of: 9, line: 'tap', tap: true, outcomes: { 'no-popup-top-nav': { verdict: 'not-measured', detail: '' } } });
      deps.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    }));
    render(<ReaderLab load={() => Promise.resolve(f.mod)} />);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
    await waitFor(() => screen.getByText(/^1 of 9/));
    expect(screen.queryByText(LAB_TEXT.verdict['not-measured'])).toBeNull();
    expect(screen.getAllByText(LAB_TEXT.running)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.stop }));
    await waitFor(() => screen.getByRole('button', { name: LAB_TEXT.start }));
  });

  it('a failed run says why in one sentence', async () => {
    for (const word of ['no-door', 'refused', 'unknown-run', 'unreadable'] as const) {
      const f = fakeModule(async () => { throw new FakeFailure(word); });
      render(<ReaderLab load={() => Promise.resolve(f.mod)} />);
      fireEvent.click(screen.getByRole('button', { name: LAB_TEXT.start }));
      await waitFor(() => screen.getByText(LAB_TEXT.failed[word]));
      cleanup();
    }
  });
});

describe('api.readerLab (reader lab plan, Task 10)', () => {
  it('opens, reads, closes and probes through the funnel, at the vocabulary\'s paths', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      const body = String(url).includes('/probe/') ? null : JSON.stringify({ ok: true });
      return new Response(body, { status: body === null ? 204 : 200, headers: { 'content-type': 'application/json' } });
    });
    const a = createApi(fetchImpl as unknown as typeof fetch);
    const n = 'AAAAAAAAAAAAAAAAAAAAAA';
    await a.readerLab.open();
    await a.readerLab.read(n);
    await a.readerLab.close(n);
    await a.readerLab.probe(n);
    expect(calls).toEqual([
      { url: '/api/reader-lab/runs', method: 'POST' },
      { url: `/api/reader-lab/runs/${n}`, method: 'GET' },
      { url: `/api/reader-lab/runs/${n}/close`, method: 'POST' },
      { url: `/api/reader-lab/probe/${n}/cookie-console`, method: 'GET' },
    ]);
  });
});
