import type { Frame, Page } from 'playwright-core';

const MARK = 'ccrc-test-redraw-';
export const REDRAW_FIGURE = 'figure.mermaid-figure';
const PAINTED_NODE = 'svg g.node rect';

export interface RedrawEvent { readonly figure: number; readonly at: number; readonly paint: string }
export interface RedrawLog {
  readonly starts: readonly number[];
  readonly writes: readonly RedrawEvent[];
  readonly held: number;
  readonly paints: readonly string[];
}
interface RedrawWatch {
  read(): RedrawLog;
  drained(): boolean;
  holdAfterNextWrite(): void;
  release(): void;
}

export async function watchRedraws(frame: Frame, tracing: boolean): Promise<readonly { figure: number; distance: number }[]> {
  return frame.evaluate(({ figureSelector, paintedNode, mark, tracing }) => {
    const figures = [...document.querySelectorAll(figureSelector)];
    const homes = figures.map((figure) => {
      const drawing = figure.querySelector('pre.mermaid:has(> svg[data-docreader-hosted-figure])');
      if (!drawing) throw new Error('the fixture has no initial hosted drawing');
      return drawing;
    });
    const paint = (drawing: Element): string => {
      const node = drawing.querySelector(paintedNode);
      if (!node) throw new Error('the fixture has no painted flowchart node');
      const fill = getComputedStyle(node).fill;
      const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(fill);
      if (!rgb) throw new Error(`the fixture node does not have an opaque sRGB fill: ${fill}`);
      return `#${rgb.slice(1).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
    };
    const starts: number[] = [];
    const writes: RedrawEvent[] = [];
    const timers = new Map<number, () => void>();
    const pending = new Set<number>();
    let holding = false;
    let holdAfterNextWrite = false;

    const insert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (node, before) {
      const result = Reflect.apply(insert, this, [node, before]);
      if (node instanceof Element && node.matches('pre[data-docreader-redraw]')) {
        const figure = figures.indexOf(this as Element);
        if (figure >= 0) {
          if (tracing) performance.mark(`${mark}start-${starts.length}`);
          starts.push(figure);
        }
      }
      return result;
    };
    const replace = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...nodes) {
      const figure = homes.indexOf(this);
      const old = figure >= 0 ? this.querySelector(':scope > svg') : null;
      Reflect.apply(replace, this, nodes);
      if (old && this.querySelector(':scope > svg') !== old && this.querySelector(':scope > svg') !== null) {
        const at = performance.now();
        if (tracing) performance.mark(`${mark}write-${writes.length}`);
        writes.push({ figure, at, paint: paint(this) });
        if (holdAfterNextWrite) { holdAfterNextWrite = false; holding = true; }
      }
    };

    // Give the real bridge time to apply a newer appearance while old work is demonstrably queued. The
    // natural order/task trace and gap measurement both run before arming this gate. No library seam is added.
    const timeout = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    const schedule = (run: () => void): number => {
      const id = timeout(() => {
        pending.delete(id);
        if (holding) timers.set(id, run);
        else run();
      }, 0);
      pending.add(id);
      return id;
    };
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (typeof callback !== 'function' || delay !== 0) return timeout(callback, delay, ...args);
      return schedule(() => Reflect.apply(callback, window, args));
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined) { pending.delete(id); timers.delete(id); }
      clear(id);
    }) as typeof window.clearTimeout;

    (window as unknown as { __redrawWatch: RedrawWatch }).__redrawWatch = {
      read: () => ({ starts, writes, held: timers.size, paints: homes.map(paint) }),
      drained: () => pending.size === 0 && timers.size === 0 && document.querySelector('pre[data-docreader-redraw]') === null,
      holdAfterNextWrite: () => { holdAfterNextWrite = true; },
      release: () => {
        holding = false;
        for (const callback of timers.values()) schedule(callback);
        timers.clear();
      },
    };
    return homes.map((drawing, figure) => {
      const rect = drawing.getBoundingClientRect();
      return { figure, distance: Math.max(0, -rect.bottom, rect.top - innerHeight) };
    });
  }, { figureSelector: REDRAW_FIGURE, paintedNode: PAINTED_NODE, mark: MARK, tracing });
}

export function readRedraws(frame: Frame): Promise<RedrawLog> {
  return frame.evaluate(() => (window as unknown as { __redrawWatch: RedrawWatch }).__redrawWatch.read());
}

export async function waitForRedraws(frame: Frame, writes: number, held = false): Promise<void> {
  await frame.waitForFunction(({ count, held }) => {
    const got = (window as unknown as { __redrawWatch: RedrawWatch }).__redrawWatch.read();
    return got.writes.length >= count && (!held || got.held > 0);
  }, { count: writes, held }, { timeout: 90_000 });
}

export async function waitForRedrawDrain(frame: Frame): Promise<void> {
  // The count only proves enough writes arrived. Also allow their continuations to run and wait until
  // no held/scheduled redraw timer or temporary stage remains before reading the final paints.
  await frame.evaluate(() => new Promise<void>((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(done, 0)));
  }));
  await frame.waitForFunction(() => (window as unknown as { __redrawWatch: RedrawWatch }).__redrawWatch.drained(),
    undefined, { timeout: 90_000 });
}

export function setRedrawGate(frame: Frame, command: 'holdAfterNextWrite' | 'release'): Promise<void> {
  return frame.evaluate((action) => (window as unknown as { __redrawWatch: RedrawWatch }).__redrawWatch[action](), command);
}

interface TracePoint { name: string; ts: number; pid: number; tid: number; dur?: number; ph?: string }

/** Locate real redraw starts and SVG replacements in Chromium tasks, not DOM observer deliveries. */
export async function traceRedrawTasks(page: Page, run: () => Promise<void>): Promise<{ starts: readonly string[]; writes: readonly string[] }> {
  const cdp = await page.context().newCDPSession(page);
  const points: TracePoint[] = [];
  try {
    cdp.on('Tracing.dataCollected', ({ value }) => {
      for (const row of value) {
        const { name, ts, pid, tid, dur, ph } = row;
        if (typeof name !== 'string' || typeof ts !== 'number' || typeof pid !== 'number' || typeof tid !== 'number') continue;
        if (name.startsWith(MARK) || name === 'RunTask' || name === 'ThreadControllerImpl::RunTask') {
          points.push({ name, ts, pid, tid, ...(typeof dur === 'number' ? { dur } : {}), ...(typeof ph === 'string' ? { ph } : {}) });
        }
      }
    });
    await cdp.send('Tracing.start', { categories: 'toplevel,devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing' });
    try {
      await run();
    } finally {
      const ended = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()));
      await cdp.send('Tracing.end');
      await ended;
    }
  } finally {
    await cdp.detach();
  }
  const marks = points.filter(({ name }) => name.startsWith(MARK)).sort((a, b) => a.ts - b.ts);
  const starts: string[] = [];
  const writes: string[] = [];
  for (const mark of marks) {
    const task = points.filter((point) => point.pid === mark.pid && point.tid === mark.tid && point.ph === 'X'
      && !point.name.startsWith(MARK) && point.dur !== undefined && point.ts <= mark.ts && mark.ts < point.ts + point.dur)
      .sort((a, b) => b.dur! - a.dur!)[0];
    if (!task) throw new Error(`Chromium did not expose the task containing ${mark.name}`);
    const bucket = mark.name.startsWith(`${MARK}start-`) ? starts : writes;
    bucket.push(`${task.pid}:${task.tid}:${task.ts}`);
  }
  return { starts, writes };
}
