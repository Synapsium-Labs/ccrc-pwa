// The reader lab's gate-sized page (native Docs reader, X2 P6.1 Step 0b): a dense page of exactly the render gate's bytes,
// timed five times in the lab after the door's last read (render, then render and mount), and the one result line that says
// it. The page is not one of `LAB_PAGES`, so the nine pages' mounts and the pinned outputs stay as they were.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAB_MOUNT_WAIT_MS, LAB_PROBE_NAMES, type LabProbeName, type LabProbeTally, type LabRunView } from '../../shared/readerLab';
import { utf8Bytes } from '../../shared/utf8';
import type { ReaderMount } from '../src/docs/reader/bridge';
import { DOCS_PARSE_BUDGET_MS, DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { READER_HTML_MAX_BYTES } from '../src/lib/readerLimits';
import { answerRenderJob, type ReaderRenderOutcome, type ReaderRenderReply } from '../src/lib/readerRenderJob';
import { LAB_CHECKS } from '../src/readerLab/checks';
import { deviceOf } from '../src/readerLab/device';
import { LAB_GATE_PAGE, LAB_PAGES } from '../src/readerLab/fixtures';
import { LAB_GATE_RUNS, defaultLabDeps, runReaderLab, type LabDeps, type LabResult } from '../src/readerLab/run';
import { formatLabResult } from '../src/readerLab/result';
import { gateReading, type LabGateRun, type LabLocal } from '../src/readerLab/verdicts';

afterEach(() => {
  document.body.replaceChildren();
});

describe('the reader lab gate page (X2 P6.1 Step 0b)', () => {
  it('lab gate page: exactly 524 288 bytes, with headings, tables, lists, code and quotes', () => {
    expect(LAB_GATE_PAGE.label).toBe('gate');
    expect(DOCS_RENDER_GATE_BYTES).toBe(524288);
    expect(utf8Bytes(LAB_GATE_PAGE.text)).toBe(524288);
    // The job production runs (prescan, render, scan), not the library's render alone.
    const replies: ReaderRenderReply[] = [];
    answerRenderJob({ id: 1, src: LAB_GATE_PAGE.text }, (r) => { replies.push(r); });
    expect(replies).toHaveLength(1);
    const out = replies[0]!.outcome;
    expect(out.kind).toBe('rendered');
    if (out.kind !== 'rendered') return;
    for (const tag of ['<table', '<ul', '<ol', '<pre', '<blockquote', '<h1', '<h2', '<h3']) expect(out.result.html, tag).toContain(tag);
    expect(out.result.html).not.toContain('mermaid');
    expect(out.mermaid.fences).toBe(0);
    expect(out.result.html.length, 'the reader accepts the html').toBeLessThan(READER_HTML_MAX_BYTES);
    // Every fence is closed: an even count of fence lines, and the page does not end inside one.
    const fences = LAB_GATE_PAGE.text.split('\n').filter((l) => l.startsWith('```'));
    expect(fences.length % 2).toBe(0);
    expect(fences.some((l) => l.startsWith('```mermaid'))).toBe(false);
    // The closing prose ends on a whole sentence.
    expect(LAB_GATE_PAGE.text.slice(-200)).toMatch(/\. [A-Z][a-z]+(?: [a-z]+)*\.\n$/);
  });

  it('lab gate page: not one of LAB_PAGES, whose labels and texts are unchanged', () => {
    expect(LAB_PAGES.map((p) => p.label)).toEqual(['none', 'trivial', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'all']);
    expect(LAB_PAGES.some((p) => p.text === LAB_GATE_PAGE.text || p.label === LAB_GATE_PAGE.label)).toBe(false);
    expect(LAB_GATE_RUNS).toBe(5);
  });

  it('lab gate page: the real dependencies carry it', () => {
    const ctl = new AbortController();
    const deps = defaultLabDeps({ stage: document.createElement('div'), signal: ctl.signal });
    expect(deps.gatePage).toBe(LAB_GATE_PAGE);
  });
});

const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
const ZERO: LabProbeTally = {
  hits: 0, cookie: 0, upgrade: 0,
  site: { 'same-origin': 0, 'same-site': 0, 'cross-site': 0, none: 0, absent: 0, other: 0 },
  origin: { null: 0, absent: 0, present: 0 },
};
const VIEW: LabRunView = {
  openedAt: 0, expiresAt: 600_000, counted: 0, ignored: 0, saturated: false,
  probes: Object.fromEntries(LAB_PROBE_NAMES.map((n) => [n, { ...ZERO }])) as Record<LabProbeName, LabProbeTally>,
};
const RENDER_MS = 7;
const MOUNT_MS = 11;

interface RigOptions {
  withGate?: boolean;
  /** The render outcome of the n-th gate render (1-based); undefined: rendered. */
  renderOutcome?: (n: number) => ReaderRenderOutcome | undefined;
  onGateRender?: (n: number, abort: AbortController) => void;
  /** What a gate mount does: throws, falls back, or never comes ready (the cap). The other mounts are ready. */
  mount?: 'throws' | 'fallback' | 'cap';
}

/** The minimal fakes: every frame mounts and goes, every render answers `rendered` after RENDER_MS on the fake clock, every
 *  reader mount is ready after MOUNT_MS. `withGate` (the default) hands the run the gate page, as the real dependencies do. */
function rig(o: RigOptions = {}) {
  const abort = new AbortController();
  const stage = document.createElement('div');
  document.body.append(stage);
  let clock = 0;
  let gateRenders = 0;
  let gatePhase = false;
  const events: string[] = [];
  const renders: { bytes: number; budgetMs: number }[] = [];
  const inputs: { bytes: number }[] = [];
  const gateHosts: HTMLElement[] = [];
  const gateDestroys: ReturnType<typeof vi.fn>[] = [];
  const rendered = {
    kind: 'rendered', result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } },
    mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 }, images: [],
  } as unknown as ReaderRenderOutcome;
  const deps: LabDeps = {
    door: {
      open: async () => ({ nonce: NONCE }),
      read: async () => { events.push('read'); return VIEW; },
      close: async () => { events.push('close'); },
      probe: async () => undefined,
    },
    origin: 'https://box.example',
    stage,
    mountFrame: (s) => { const el = document.createElement('i'); s.append(el); return { loads: () => 1, remove: () => el.remove() }; },
    render: async (src, b) => {
      renders.push({ bytes: utf8Bytes(src), budgetMs: b.budgetMs });
      clock += RENDER_MS;
      if (src === LAB_GATE_PAGE.text) {
        gatePhase = true;
        gateRenders += 1;
        events.push('gate-render');
        o.onGateRender?.(gateRenders, abort);
        return o.renderOutcome?.(gateRenders) ?? rendered;
      }
      return rendered;
    },
    mountReader: async (el, input) => {
      inputs.push({ bytes: input.bytes });
      clock += MOUNT_MS;
      if (gatePhase) gateHosts.push(el);
      if (gatePhase && o.mount === 'throws') throw new Error('mount failed');
      const destroy = vi.fn();
      if (gatePhase) gateDestroys.push(destroy);
      if (gatePhase && o.mount === 'fallback') queueMicrotask(() => input.onFallback('assets'));
      else if (!(gatePhase && o.mount === 'cap')) queueMicrotask(() => input.onReady());
      return { seed: { hosted: false }, follow: vi.fn(), destroy, setPrefs: vi.fn() } satisfies ReaderMount;
    },
    frame: () => Promise.resolve((clock += 16)),
    now: () => clock,
    sleep: (ms) => {
      if (ms >= LAB_MOUNT_WAIT_MS) {
        // The cap's own timer: it fires only for a gate mount that is meant to hit it (elsewhere it never does).
        return gatePhase && o.mount === 'cap' ? ((clock += ms), Promise.resolve()) : new Promise<void>(() => undefined);
      }
      clock += ms;
      return Promise.resolve();
    },
    address: () => 'https://box.example/settings/reader-lab',
    gapWindow: 'ready',
    signal: abort.signal,
    ...(o.withGate === false ? {} : { gatePage: LAB_GATE_PAGE }),
  };
  return { deps, renders, inputs, abort, stage, events, gateHosts, gateDestroys };
}

describe('the reader lab run, gate page', () => {
  it('lab run: the gate page is rendered and mounted five times after the Mermaid pages', async () => {
    const r = rig();
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.local.mounts.map((m) => m.label)).toEqual(['none', 'trivial', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'all']);
    // Two renders for the hostile and benign pages, nine for the pages, then the five of the gate page, in that order.
    expect(r.renders).toHaveLength(2 + LAB_PAGES.length + LAB_GATE_RUNS);
    expect(r.renders.slice(-LAB_GATE_RUNS).map((x) => x.bytes)).toEqual(Array(LAB_GATE_RUNS).fill(524288));
    expect(r.renders.slice(-LAB_GATE_RUNS).map((x) => x.budgetMs)).toEqual(Array(LAB_GATE_RUNS).fill(DOCS_PARSE_BUDGET_MS(524288)));
    expect(r.inputs).toHaveLength(2 + LAB_PAGES.length + LAB_GATE_RUNS);
    expect(r.inputs.slice(-LAB_GATE_RUNS).map((x) => x.bytes)).toEqual(Array(LAB_GATE_RUNS).fill(524288));
    expect(result.local.gate).toEqual({
      bytes: 524288, budgetMs: DOCS_PARSE_BUDGET_MS(524288),
      runs: Array.from({ length: LAB_GATE_RUNS }, () => ({ renderMs: RENDER_MS, mountMs: MOUNT_MS, render: 'rendered', mount: 'ready' })),
    });
    expect(r.stage.childElementCount, 'every host is gone').toBe(0);
  });

  it('lab run: the gate runs happen after the final door read, and the door is closed after them', async () => {
    const r = rig();
    await runReaderLab(r.deps, () => undefined);
    const lastRead = r.events.lastIndexOf('read');
    const firstGate = r.events.indexOf('gate-render');
    expect(firstGate).toBeGreaterThan(lastRead);
    expect(r.events.filter((e) => e === 'gate-render')).toHaveLength(LAB_GATE_RUNS);
    expect(r.events.slice(lastRead + 1)).toEqual([...Array(LAB_GATE_RUNS).fill('gate-render'), 'close']);
  });

  it('lab run: the progress line while the gate page is timed has its own words, not the Mermaid word', async () => {
    const r = rig();
    const lines: string[] = [];
    await runReaderLab(r.deps, (p) => { lines.push(p.line); });
    const gate = lines.filter((l) => l.startsWith('Timing the gate-sized page'));
    expect(gate).toHaveLength(LAB_GATE_RUNS);
    expect(gate.some((l) => l.includes('Mermaid'))).toBe(false);
    expect(lines.slice(-LAB_GATE_RUNS)).toEqual(gate);
  });

  it('lab run: no gate page handed, no gate runs and no gate field; a render that does not render names its kind and mounts nothing', async () => {
    const none = rig({ withGate: false });
    const a = await runReaderLab(none.deps, () => undefined);
    expect(a.local.gate).toBeUndefined();
    expect(none.inputs).toHaveLength(2 + LAB_PAGES.length);

    const refused = rig({ renderOutcome: (n) => (n === 2 ? { kind: 'not-rendered', why: 'over-limit' } : undefined) });
    const b = await runReaderLab(refused.deps, () => undefined);
    expect(b.local.gate?.runs.map((x) => [x.render, x.mount])).toEqual([
      ['rendered', 'ready'], ['not-rendered', null], ['rendered', 'ready'], ['rendered', 'ready'], ['rendered', 'ready'],
    ]);
    expect(b.local.gate?.runs[1]).toEqual({ renderMs: RENDER_MS, mountMs: 0, render: 'not-rendered', mount: null });
    expect(refused.inputs).toHaveLength(2 + LAB_PAGES.length + LAB_GATE_RUNS - 1);
  });

  it('lab run: stop between gate runs ends the run with stopped, mounting nothing more, and closes the door run', async () => {
    const r = rig({ onGateRender: (n, abort) => { if (n === 2) abort.abort(); } });
    await expect(runReaderLab(r.deps, () => undefined)).rejects.toThrow('stopped');
    // The abort came during the second run, which finishes; the third never starts.
    expect(r.inputs).toHaveLength(2 + LAB_PAGES.length + 2);
    expect(r.stage.childElementCount).toBe(0);
    expect(r.events.at(-1)).toBe('close');
  });

  it.each([
    ['a mount that throws', 'throws', 'fallback', 0],
    ['a mount that falls back', 'fallback', 'fallback', LAB_GATE_RUNS],
    ['a mount that hits the cap', 'cap', 'timeout', LAB_GATE_RUNS],
  ] as const)('lab run: %s is not measured, its mount destroyed where there is one and its host removed', async (_name, mode, word, destroyed) => {
    const r = rig({ mount: mode });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.local.gate?.runs.map((x) => [x.render, x.mount])).toEqual(Array(LAB_GATE_RUNS).fill(['rendered', word]));
    expect(r.gateHosts).toHaveLength(LAB_GATE_RUNS);
    expect(r.gateHosts.every((h) => !h.isConnected), 'every host is removed').toBe(true);
    expect(r.gateDestroys).toHaveLength(destroyed);
    for (const d of r.gateDestroys) expect(d).toHaveBeenCalledTimes(1);
    expect(r.stage.childElementCount).toBe(0);
    expect(gateReading(result.local.gate!).verdict).toBe('not-measured');
  });

  it('lab run: a render that times out is over, mounts nothing, and is not a not-measured line', async () => {
    const r = rig({ renderOutcome: (n) => (n === 3 ? { kind: 'timeout', budgetMs: 10000 } : undefined) });
    const result = await runReaderLab(r.deps, () => undefined);
    expect(result.local.gate?.runs[2]).toEqual({ renderMs: RENDER_MS, mountMs: 0, render: 'timeout', mount: null });
    expect(r.inputs).toHaveLength(2 + LAB_PAGES.length + LAB_GATE_RUNS - 1);
    expect(gateReading(result.local.gate!).verdict).toBe('over');
  });
});

const run = (renderMs: number, mountMs: number, mount: LabGateRun['mount'] = 'ready', render: LabGateRun['render'] = 'rendered'): LabGateRun =>
  ({ renderMs, mountMs, render, mount });
const gateOf = (runs: readonly LabGateRun[], budgetMs = 10000): NonNullable<LabLocal['gate']> => ({ bytes: 524288, budgetMs, runs });
const HOLDS = Object.fromEntries(LAB_CHECKS.map((k) => [k, { verdict: 'holds', detail: '' }])) as unknown as LabResult['outcomes'];
const localWith = (gate: NonNullable<LabLocal['gate']> | null): LabLocal => ({
  selfNavLoads: 2, busy: null, hostile: { ready: true }, strays: { ready: true, effects: 0, addressChanged: false },
  mounts: [{ label: 'none', outcome: 'ready', longestGapMs: 40, elapsedMs: 100 }],
  ...(gate === null ? {} : { gate }),
});
const textOf = (local: LabLocal): string[] =>
  formatLabResult(deviceOf('x', null, { worker: true, frameSandbox: true, cspAttribute: true }), 'build', HOLDS, local, null, 200, 'read').split('\n');
const gateLineOf = (gate: NonNullable<LabLocal['gate']>): string => textOf(localWith(gate)).find((l) => l.includes('gate-page'))!;

describe('the reader lab gate reading and result line', () => {
  it('lab result: the gate line names the median and worst of five, and the budget', () => {
    const lines = textOf(localWith(gateOf([run(100, 50), run(300, 70), run(200, 60), run(900, 80), run(400, 90)])));
    const at = lines.findIndex((l) => l.startsWith('    gate-page '));
    expect(lines[at]).toBe('    gate-page 524288 bytes: render median 300 ms, worst 900 ms; render and mount median 370 ms, worst 980 ms; budget 10000 ms; within');
    expect(lines[at - 1]).toMatch(/^ {4}gaps ms {10}none 40 ready$/);
    expect(lines[at + 1]).toMatch(/^draw on open: /);
    expect(lines.filter((l) => l.includes('gate-page'))).toHaveLength(1);
  });

  it('lab result: a render over its budget is over, with the figures of the runs that rendered and the run that went over', () => {
    expect(gateLineOf(gateOf([run(100, 50), run(300, 70), run(200, 60), run(10500, 80), run(400, 90)]))).toBe(
      '    gate-page 524288 bytes: render median 300 ms, worst 10500 ms; render and mount median 370 ms, worst 10580 ms; budget 10000 ms; over (run 4)');
    // A render that answered timeout: its run has no mount and no figure, the other four are the figures.
    expect(gateLineOf(gateOf([run(100, 50), run(300, 70), run(10000, 0, null, 'timeout'), run(900, 80), run(400, 90)]))).toBe(
      '    gate-page 524288 bytes: render median 400 ms, worst 900 ms; render and mount median 490 ms, worst 980 ms; budget 10000 ms; over (run 3)');
    expect(gateLineOf(gateOf([run(10000, 0, null, 'timeout'), run(10000, 0, null, 'timeout')]))).toBe(
      '    gate-page 524288 bytes: render median none, worst none; render and mount median none, worst none; budget 10000 ms; over (runs 1, 2)');
  });

  it('lab result: the budget edge: a render of exactly the budget is within, one more millisecond is over', () => {
    expect(gateReading(gateOf([run(10000, 5), run(1, 1), run(1, 1), run(1, 1), run(1, 1)])).verdict).toBe('within');
    expect(gateReading(gateOf([run(10001, 5), run(1, 1), run(1, 1), run(1, 1), run(1, 1)])).verdict).toBe('over');
  });

  it('lab result: not measured prints no median or worst: how many were ready, and the first failure by run, stage and word', () => {
    expect(gateLineOf(gateOf([run(100, 50), run(300, 70), run(200, 60, 'timeout'), run(900, 80, 'fallback'), run(400, 90)]))).toBe(
      '    gate-page 524288 bytes: 3 of 5 runs ready; first failure: run 3, mount, timeout; budget 10000 ms; not measured');
    expect(gateLineOf(gateOf([run(100, 50), run(1, 0, null, 'not-rendered'), run(200, 60), run(900, 80), run(400, 90)]))).toBe(
      '    gate-page 524288 bytes: 4 of 5 runs ready; first failure: run 2, render, not-rendered; budget 10000 ms; not measured');
    expect(gateLineOf(gateOf([run(100, 50, 'mermaid-dropped')]))).toBe(
      '    gate-page 524288 bytes: 0 of 1 runs ready; first failure: run 1, mount, mermaid-dropped; budget 10000 ms; not measured');
  });

  it('lab result: a render timeout is no word a mount also says: over, though another run is not ready, names the over run', () => {
    // The render budget was passed in one run, whatever another run's mount did; the over word stands and says which run.
    const g = gateOf([run(100, 50), run(10000, 0, null, 'timeout'), run(200, 60, 'fallback'), run(900, 80), run(400, 90)]);
    expect(gateReading(g)).toMatchObject({ verdict: 'over', overRuns: [2] });
    expect(gateLineOf(g)).toMatch(/; over \(run 2\)$/);
  });

  it('lab result: with no gate runs the block is the block it was, line for line', () => {
    const without = textOf(localWith(null));
    expect(without.some((l) => l.includes('gate-page'))).toBe(false);
    const withGate = textOf(localWith(gateOf([run(1, 1), run(1, 1), run(1, 1), run(1, 1), run(1, 1)])));
    expect(withGate.filter((l) => !l.includes('gate-page'))).toEqual(without);
  });
});
