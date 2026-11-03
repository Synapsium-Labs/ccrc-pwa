// R19's measurement page (native Docs reader, W5h-a Task 9; base spec 2026-10-01 section 7.8 R19, M7.12's behavioural
// half). The driver runs on fakes: a one-project corpus through injected loaders, the parse in-thread, in-thread
// highlighters (and, for the shipped deadline, one that times out at once), a counting clock and a frame that yields one
// task (so React commits and the store's debounce timers fire), so it measures nothing real; the cases pin its shape, that it reads only, and that its result names nothing
// private. The page is opened once, on the operator's phone, after W5h-a is deployed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createHighlightAnswerer } from '../src/lib/highlightJob';
import type { HighlightJob, HighlightOutcome, Highlighter } from '../src/lib/highlightProtocol';
import { HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS, HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { WorkerLike } from '../src/lib/markdownRunner';
import { HighlightMeasure } from '../src/screens/HighlightMeasure';
import {
  CRAFTED_SHAPES, MEASURE_CANDIDATE_DEBOUNCES, MEASURE_DEADLINE_MS, MEASURE_SETTLE_CADENCES_MS, MEASURE_TEXT, formatMeasureResult, runHighlightMeasure, type MeasureDeps,
} from '../src/screens/highlightMeasureRun';
import { entry, fakeLoaders, fileResponse, okTree, treeOk } from './docsFixtures';
import { inThreadHighlighter } from './highlightTestStore';

afterEach(cleanup);

const SECRET = 'const secretValue = 1;';
const DOC = `# Notes\n\n\`\`\`ts\n${SECRET}\n\`\`\`\n\n\`\`\`json\n{"a": 1}\n\`\`\`\n`;

/** A highlighter that answers every job `timeout` as soon as it is posted (the shipped deadline, on a slow phone). */
const timingOut = (): Highlighter => ({
  highlight: async (_r, o) => { o.onPosted?.(); return { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }; },
  status: () => 'live',
  prewarm: () => undefined,
});

/** `h`, except that `answer` may replace its answer to a job (a `null` leaves the job to `h`). */
const overriding = (h: Highlighter, answer: (r: { lang: string; code: string }) => HighlightOutcome | null): Highlighter => ({
  highlight: async (r, o) => {
    const a = answer(r);
    if (a === null) return h.highlight(r, o);
    o.onPosted?.();
    return a;
  },
  status: () => h.status(),
  prewarm: () => h.prewarm(),
});

function fakes(over: Partial<MeasureDeps> = {}) {
  const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'secret-plan.md'), entry('plans', 'b.md'), entry('specs', 'c.ts')] })), file: { s: 'ok', value: fileResponse(DOC) } });
  f.projects.mockResolvedValue({ s: 'ok', value: { ok: true, cacheAgeMs: null, index: { v: 1, verb: 'docs-index', ok: true, elapsedMs: 1, unlisted: 0, duplicates: [], projects: [{ project: 'demo', state: 'ready', github: null }] } } } as never);
  let t = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const deps: MeasureDeps = {
    loaders: f.loaders,
    parse: async (src) => parseMarkdown(src, 'docs'),
    highlighter: (deadlineMs) => (deadlineMs === HIGHLIGHT_BLOCK_DEADLINE_MS
      ? timingOut()
      // A crafted shape (longer than 2000 characters) is answered in kind, not run through highlight.js in-thread.
      : overriding(inThreadHighlighter(), (r) => (r.code.length > 2000 ? { kind: 'html', mode: 'block', html: 'x'.repeat(2 * r.code.length) } : null))),
    now: () => (t += 1),
    frame: () => new Promise<number>((resolve) => { setTimeout(() => resolve(t), 0); }),
    sleep: async () => undefined,
    host,
    signal: new AbortController().signal,
    hardwareConcurrency: 8,
    ...over,
  };
  return { f, deps, advance: (n: number): void => { t += n; }, clock: (): number => t };
}

describe('R19: the driver', () => {
  it('reads the corpus through projects, tree and file only, and never asks for a refresh', async () => {
    const { f, deps } = fakes();
    const r = await runHighlightMeasure(deps, () => undefined);
    expect(f.projects).toHaveBeenCalledTimes(1);
    expect(f.tree).toHaveBeenCalledWith('demo', null);
    expect(f.file).toHaveBeenCalledTimes(2);
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.raster).not.toHaveBeenCalled();
    expect(r.corpus).toEqual({ projects: 1, docs: 2, unreadDocs: 0, blocks: 4 });
  });

  it('answers every item, by grammar, with the shipped values and section 4.10\'s sum for Export\'s wait', async () => {
    const { deps } = fakes();
    const r = await runHighlightMeasure(deps, () => undefined);
    expect(r.r19).toBe(1);
    expect(r.item1.byGrammar.map((g) => g.grammar).sort()).toEqual(['json', 'typescript']);
    expect(r.item1.byGrammar.find((g) => g.grammar === 'typescript')).toMatchObject({ blocks: 2, cold: { chars: SECRET.length } });
    expect(r.item2.coldMs).not.toBeNull();
    expect(r.item4.blocks).toBeGreaterThan(0);
    // Items 5 and 8 need React to commit and the store's timers to fire: measured values, not nulls.
    expect(r.item5.blocks).toBeGreaterThan(0);
    expect(r.item5.firstFrameToColouredMs).not.toBeNull();
    for (const c of r.item8.byCadence) {
      for (const d of c.byDebounce) {
        expect(d.closeToColouredMs, `cadence ${c.settleMs}, debounce ${d.debounceMs}`).not.toBeNull();
        expect(d.requests, `cadence ${c.settleMs}, debounce ${d.debounceMs}`).toBeGreaterThan(0);
      }
    }
    expect(r.item6.map((s) => s.outcome).every((o) => o === 'timeout')).toBe(true);
    expect(r.item7.sumMs).toBe(HIGHLIGHT_PAGE_WORKER_MS + HIGHLIGHT_BLOCK_DEADLINE_MS + (HIGHLIGHT_PAGE_MAX_TIMEOUTS + 1) * HIGHLIGHT_BOOT_BUDGET_MS);
    expect(r.item7.entries.length).toBe(8);
    expect(Object.keys(r.item8)).toEqual(['byCadence']);
    expect(r.item8.byCadence.map((c) => c.settleMs)).toEqual([...MEASURE_SETTLE_CADENCES_MS]);
    for (const c of r.item8.byCadence) expect(c.byDebounce.map((d) => d.debounceMs)).toEqual([...MEASURE_CANDIDATE_DEBOUNCES]);
    expect(r.shipped).toMatchObject({ HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS });
  }, 60_000);

  it('its text is JSON that names no project, path, file or code', async () => {
    const { deps } = fakes();
    const text = formatMeasureResult(await runHighlightMeasure(deps, () => undefined));
    expect(JSON.parse(text)).toMatchObject({ r19: 1 });
    for (const word of ['demo', 'secret-plan', 'b.md', 'secretValue', 'Notes', 'specs', 'plans']) expect(text, word).not.toContain(word);
  }, 60_000);

  it('an abort stops the run', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { deps } = fakes({ signal: ctl.signal });
    await expect(runHighlightMeasure(deps, () => undefined)).rejects.toBeDefined();
  });
});

// A fix round of the whole-branch review (Task 10): R19's figures keep what the worker measured.
describe('R19: what the figures keep', () => {
  it('an answer over the HTML cap still gives its ratio, so the maximum is not censored at the cap, and the grammar says how many', async () => {
    const { deps } = fakes({
      highlighter: (ms) => overriding(
        ms === HIGHLIGHT_BLOCK_DEADLINE_MS ? timingOut() : inThreadHighlighter(),
        (r) => (r.code === SECRET ? { kind: 'too-large', htmlChars: 10 * r.code.length } : null),
      ),
    });
    const r = await runHighlightMeasure(deps, () => undefined);
    const ts = r.item1.byGrammar.find((g) => g.grammar === 'typescript')!;
    expect(ts.htmlRatio.max).toBeGreaterThanOrEqual(10);
    expect(ts).toMatchObject({ notHtml: 2, overCap: 2 });
    expect(r.item1.byGrammar.find((g) => g.grammar === 'json')).toMatchObject({ overCap: 0 });
  }, 60_000);

  it('a crafted shape answered over the cap gives its ratio and is marked over the cap', async () => {
    const over = (r: { lang: string; code: string }): HighlightOutcome | null => (r.code.length > 2000
      ? (r.lang === 'rust' ? { kind: 'too-large', htmlChars: 8 * r.code.length } : { kind: 'html', mode: 'block', html: 'x'.repeat(2 * r.code.length) })
      : null);
    const { deps } = fakes({ highlighter: () => overriding(inThreadHighlighter(), over) });
    const r = await runHighlightMeasure(deps, () => undefined);
    const rust = r.item3.crafted.find((c) => c.shape === 'rust-raw-string')!;
    expect(rust.ratio).toBeGreaterThanOrEqual(8);
    expect(rust.overCap).toBe(true);
    expect(r.item3.crafted.filter((c) => c.overCap).length).toBe(1);
  }, 60_000);
});

describe('R19: item 3\'s crafted shapes run under the measurement-only deadline', () => {
  it('a shape the shipped deadline cuts off still gives its ratio, and item 6 still reports the cut', async () => {
    const asked: number[] = [];
    const { deps } = fakes({ highlighter: (ms) => { asked.push(ms); return fakes().deps.highlighter(ms); } });
    const r = await runHighlightMeasure(deps, () => undefined);
    // The fake answers every shape in kind under the measurement deadline and `timeout` under the shipped one.
    expect(r.item3.crafted.map((c) => c.ratio)).toEqual(CRAFTED_SHAPES.map(() => 2));
    expect(r.item6.map((s) => s.outcome)).toEqual(CRAFTED_SHAPES.map(() => 'timeout'));
    expect(asked).toContain(MEASURE_DEADLINE_MS);
  }, 60_000);
});

describe('R19: the measurement highlighters time a boot, the shipped ones keep the shipped budget', () => {
  it('items 1 to 5 and 8 ask for the measurement deadline as the boot budget; items 6 and 7 ask for the shipped deadline and no budget', async () => {
    const asked: { deadline: number; boot: number | undefined }[] = [];
    const { deps } = fakes({ highlighter: (deadline, boot) => { asked.push({ deadline, boot }); return fakes().deps.highlighter(deadline); } });
    await runHighlightMeasure(deps, () => undefined);
    expect(asked.length).toBeGreaterThan(15);
    for (const a of asked) {
      if (a.deadline === HIGHLIGHT_BLOCK_DEADLINE_MS) expect(a.boot).toBeUndefined();
      else expect(a).toEqual({ deadline: MEASURE_DEADLINE_MS, boot: MEASURE_DEADLINE_MS });
    }
    expect(asked.filter((a) => a.deadline === HIGHLIGHT_BLOCK_DEADLINE_MS).length).toBe(2);
  }, 60_000);

  it('a first boot slower than the shipped boot budget is timed by item 2, not turned into a failed run', async () => {
    const { spawn } = spawner(HIGHLIGHT_BOOT_BUDGET_MS + 300);
    render(<HighlightMeasure deps={{ ...pageDeps(), now: () => performance.now() }} spawn={spawn} />);
    fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.start }));
    const caption = await waitFor(() => screen.getByText(MEASURE_TEXT.result), { timeout: 40_000 });
    const result = JSON.parse(caption.closest('figure')?.querySelector('pre')?.textContent ?? '{}') as { item2: { coldMs: number | null } };
    expect(result.item2.coldMs).toBeGreaterThanOrEqual(HIGHLIGHT_BOOT_BUDGET_MS);
  }, 60_000);
});

describe('R19: item 5 and a page that never rendered', () => {
  it('does not wait a second time for colours when the first wait found no article', async () => {
    let parses = 0;
    const { deps: base, advance, clock } = fakes();
    // The corpus parses its two documents; item 5's DocMarkdown then gets a parse past its budget and shows plain text.
    // A frame lets React and the timers run, and moves the counting clock on 5 s, so a 60 s wait ends in a dozen frames.
    const deps: MeasureDeps = {
      ...base,
      parse: async (src, o) => ((parses += 1) <= 2 ? base.parse(src, o) : { kind: 'timeout', budgetMs: 1 }),
      frame: () => new Promise<number>((resolve) => { setTimeout(() => { advance(5000); resolve(clock()); }, 0); }),
    };
    const at: number[] = [];
    const lines: string[] = [];
    const r = await runHighlightMeasure(deps, (line) => { lines.push(line); at.push(clock()); });
    expect(r.item5.firstFrameToColouredMs).toBeNull();
    const from = lines.indexOf('Item 5');
    const waited = at[from + 1]! - at[from]!;
    expect(lines[from + 1]).toMatch(/^Item 3/);
    expect(waited, 'the first wait is 60 s; a second would add 240 s').toBeLessThan(100_000);
  }, 60_000);
});

describe('R19: Stop during item 8', () => {
  it('is seen at the next frame of the streamed message, not after the rest of it', async () => {
    const ctl = new AbortController();
    let sleeps = 0;
    const { deps } = fakes({ signal: ctl.signal, sleep: async () => { sleeps += 1; if (sleeps === 1) ctl.abort(); } });
    await expect(runHighlightMeasure(deps, () => undefined)).rejects.toBeDefined();
    // The streamed message has 40 frames per combination; the first sleep is the first frame of the first one.
    expect(sleeps).toBe(1);
    expect(document.querySelector('code.hljs')).toBeNull();
  }, 60_000);
});

describe('R19: item 1 times each distinct block once', () => {
  it('a block the corpus repeats is counted as a repeat and left out of the warm times and the slowest list', async () => {
    // DOC is read twice, so its two blocks are each seen twice. The first sight costs 10 ticks, a later one 500.
    const seen: string[] = [];
    const { deps, advance } = fakes();
    // The cost lands between the post and the answer, where `timed` measures it.
    const run: MeasureDeps = {
      ...deps,
      highlighter: (ms, boot) => {
        const h = deps.highlighter(ms, boot);
        return {
          ...h,
          highlight: async (r, o) => {
            const out = await h.highlight(r, o);
            if (r.code === SECRET) { seen.push(r.code); advance(seen.length === 1 ? 10 : 500); }
            return out;
          },
        };
      },
    };
    const r = await runHighlightMeasure(run, () => undefined);
    const ts = r.item1.byGrammar.find((g) => g.grammar === 'typescript')!;
    expect(ts).toMatchObject({ blocks: 2, repeats: 1 });
    expect(ts.warmMs.max).toBeLessThan(100);
    expect(r.item1.byGrammar.find((g) => g.grammar === 'json')).toMatchObject({ blocks: 2, repeats: 1 });
    expect(r.item1.slowest.filter((s) => s.grammar === 'typescript').length).toBe(1);
    expect(r.item1.slowest.every((s) => s.ms < 100)).toBe(true);
  }, 60_000);
});

describe('R19: the page', () => {
  it('Start runs the measurement and shows its result as text, which Select result selects whole', async () => {
    const { deps } = fakes();
    render(<HighlightMeasure deps={deps} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Measure highlighting' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.start }));
    const caption = await waitFor(() => screen.getByText(MEASURE_TEXT.result), { timeout: 60_000 });
    const pre = caption.closest('figure')?.querySelector('pre') ?? null;
    expect(pre).not.toBeNull();
    expect(JSON.parse(pre!.textContent ?? '')).toMatchObject({ r19: 1 });
    expect(document.querySelector('textarea, input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.select }));
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(pre);
    expect(selection?.focusOffset).toBe(pre!.childNodes.length);
  }, 90_000);
});

// A fix round of the same task: the page ends what it starts (its workers, its roots, its rejections), and a run whose
// highlighter cannot answer ends with a line, not a "Done." over meaningless figures.

/** A worker over the real answerer, posting `{ready}` and each answer a microtask later; a block of more than 2000
 *  characters (the crafted shapes) is answered `unregistered` at once, so a pathological one is never highlighted
 *  in-thread. Counts its `terminate()` calls and answers nothing once terminated. */
class AnsweringWorker implements WorkerLike<HighlightJob> {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  terminated = 0;
  private readonly answer = createHighlightAnswerer();
  constructor(readyAfterMs = 0) {
    const ready = (): void => { if (this.terminated === 0) this.onmessage?.({ data: { ready: true } }); };
    if (readyAfterMs === 0) queueMicrotask(ready);
    else setTimeout(ready, readyAfterMs);
  }
  postMessage(job: HighlightJob): void {
    const reply = (data: unknown): void => queueMicrotask(() => { if (this.terminated === 0) this.onmessage?.({ data }); });
    if (job.code.length > 2000) reply({ id: job.id, result: { kind: 'unregistered' } });
    else this.answer(job, reply);
  }
  terminate(): void { this.terminated += 1; }
}

/** The page's own deps, from `fakes()`, less what the page supplies itself (host, signal, highlighter). */
function pageDeps() {
  const { host: _host, signal: _signal, highlighter: _highlighter, ...rest } = fakes().deps;
  return rest;
}

function spawner(firstReadyAfterMs = 0) {
  const spawned: AnsweringWorker[] = [];
  const spawn = (): AnsweringWorker => { const w = new AnsweringWorker(spawned.length === 0 ? firstReadyAfterMs : 0); spawned.push(w); return w; };
  return { spawned, spawn };
}

const runningLine = (): string => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
const pageHost = (): Element | null => document.querySelector('div.sr-only[aria-hidden="true"]');

describe('R19: the page ends what it starts', () => {
  it('terminates every worker it spawned once the run is done', async () => {
    const { spawned, spawn } = spawner();
    render(<HighlightMeasure deps={pageDeps()} spawn={spawn} />);
    fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.start }));
    await waitFor(() => screen.getByText(MEASURE_TEXT.result), { timeout: 60_000 });
    expect(spawned.length).toBeGreaterThan(15);
    expect(spawned.filter((w) => w.terminated === 0).length).toBe(0);
  }, 90_000);

  it('Stop mid-run terminates its workers and unmounts its roots; Start then completes with no root warning and a clean host', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { spawned, spawn } = spawner();
      render(<HighlightMeasure deps={pageDeps()} spawn={spawn} />);
      fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.start }));
      await waitFor(() => expect(runningLine()).toMatch(/^Item 8/), { timeout: 60_000 });
      fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.stop }));
      await waitFor(() => screen.getByRole('button', { name: MEASURE_TEXT.start }), { timeout: 60_000 });
      expect(spawned.filter((w) => w.terminated === 0).length).toBe(0);
      expect(pageHost()?.childElementCount).toBe(0);
      const first = spawned.length;
      fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.start }));
      await waitFor(() => screen.getByText(MEASURE_TEXT.result), { timeout: 60_000 });
      expect(spawned.length).toBeGreaterThan(first);
      expect(spawned.filter((w) => w.terminated === 0).length).toBe(0);
      expect(pageHost()?.childElementCount).toBe(0);
      const messages = errors.mock.calls.map((c) => String(c[0]));
      expect(messages.filter((m) => /createRoot|already been passed/.test(m))).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  }, 150_000);

  it('unmounting the page aborts the run and terminates its workers; nothing it spawned outlives it', async () => {
    const { spawned, spawn } = spawner();
    const view = render(<HighlightMeasure deps={pageDeps()} spawn={spawn} />);
    fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.start }));
    await waitFor(() => expect(runningLine()).toMatch(/^Item 8/), { timeout: 60_000 });
    view.unmount();
    const at = spawned.length;
    expect(spawned.filter((w) => w.terminated === 0).length).toBe(0);
    // Item 8 alone would spawn one highlighter per combination, twelve, over the next seconds.
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    expect(spawned.length - at, 'an aborted run spawns at most the worker its current step had begun').toBeLessThanOrEqual(1);
    expect(spawned.filter((w) => w.terminated === 0).length).toBe(0);
  }, 90_000);

  it('a highlighter that cannot answer ends the run with a line naming its answer, not "Done."', async () => {
    const dead: Highlighter = { highlight: async () => ({ kind: 'worker-unavailable' }), status: () => 'worker-unavailable', prewarm: () => undefined };
    const { deps } = fakes({ highlighter: () => dead });
    await expect(runHighlightMeasure(deps, () => undefined)).rejects.toThrow('worker-unavailable');
    const rest = pageDeps();
    render(<HighlightMeasure deps={{ ...rest, highlighter: () => dead }} />);
    fireEvent.click(screen.getByRole('button', { name: MEASURE_TEXT.start }));
    await waitFor(() => expect(runningLine()).toContain('worker-unavailable'), { timeout: 60_000 });
    expect(screen.queryByText(MEASURE_TEXT.done)).toBeNull();
    expect(screen.queryByText(MEASURE_TEXT.result)).toBeNull();
  }, 90_000);

  it('a rejection during item 6 raises no unhandled rejection of its own', async () => {
    const seen: unknown[] = [];
    const on = (e: unknown): void => { seen.push(e); };
    process.on('unhandledRejection', on);
    try {
      const failing: Highlighter = { highlight: async () => { throw new Error('stopped'); }, status: () => 'live', prewarm: () => undefined };
      const { deps } = fakes({ highlighter: (ms) => (ms === HIGHLIGHT_BLOCK_DEADLINE_MS ? failing : inThreadHighlighter()) });
      await expect(runHighlightMeasure(deps, () => undefined)).rejects.toThrow('stopped');
      await new Promise((resolve) => { setTimeout(resolve, 50); });
      expect(seen).toEqual([]);
    } finally {
      process.off('unhandledRejection', on);
    }
  }, 60_000);
});
