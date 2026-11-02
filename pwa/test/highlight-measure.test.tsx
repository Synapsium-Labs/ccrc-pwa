// R19's measurement page (native Docs reader, W5h-a Task 9; base spec 2026-10-01 section 7.8 R19, M7.12's behavioural
// half). The driver runs on fakes: a one-project corpus through injected loaders, the parse in-thread, in-thread
// highlighters (and, for the shipped deadline, one that times out at once), a counting clock and a frame that yields one
// task (so React commits and the store's debounce timers fire), so it measures nothing real; the cases pin its shape, that it reads only, and that its result names nothing
// private. The page is opened once, on the operator's phone, after W5h-a is deployed.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Highlighter } from '../src/lib/highlightProtocol';
import { HIGHLIGHT_BLOCK_DEADLINE_MS, HIGHLIGHT_BOOT_BUDGET_MS, HIGHLIGHT_PAGE_MAX_TIMEOUTS, HIGHLIGHT_PAGE_WORKER_MS } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import { HighlightMeasure } from '../src/screens/HighlightMeasure';
import {
  MEASURE_CANDIDATE_DEBOUNCES, MEASURE_SETTLE_CADENCES_MS, MEASURE_TEXT, formatMeasureResult, runHighlightMeasure, type MeasureDeps,
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

function fakes(over: Partial<MeasureDeps> = {}) {
  const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'secret-plan.md'), entry('plans', 'b.md'), entry('specs', 'c.ts')] })), file: { s: 'ok', value: fileResponse(DOC) } });
  f.projects.mockResolvedValue({ s: 'ok', value: { ok: true, cacheAgeMs: null, index: { v: 1, verb: 'docs-index', ok: true, elapsedMs: 1, unlisted: 0, duplicates: [], projects: [{ project: 'demo', state: 'ready', github: null }] } } } as never);
  let t = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const deps: MeasureDeps = {
    loaders: f.loaders,
    parse: async (src) => parseMarkdown(src, 'docs'),
    highlighter: (deadlineMs) => (deadlineMs === HIGHLIGHT_BLOCK_DEADLINE_MS ? timingOut() : inThreadHighlighter()),
    now: () => (t += 1),
    frame: () => new Promise<number>((resolve) => { setTimeout(() => resolve(t), 0); }),
    sleep: async () => undefined,
    host,
    signal: new AbortController().signal,
    hardwareConcurrency: 8,
    ...over,
  };
  return { f, deps };
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
