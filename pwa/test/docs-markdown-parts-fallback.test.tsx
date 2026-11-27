// X2 P6.1 review F2: the page never stays on "Preparing the parts of this document" with no answer. A cut that rejects with
// anything but an abort takes the line cutter's whole cut as a complete one, and a cut that tells the fallback (`onFallback`, the
// block cutter threw) replaces the parts streamed so far with the line cutter's whole cut and goes back to part 1. An abort is the
// effect's own cleanup and changes nothing. The cut itself (`cutMarkdownText`) is replaced here by a test double, so each case
// drives exactly what the page is told; the real cutter's side is in `docs-md-parts-blocks.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { MarkdownParts } from '../src/docs/range/MarkdownParts';
import { splitMarkdownParts, type MdPart } from '../src/docs/range/mdParts';

const double = vi.hoisted(() => ({
  cut: null as null | ((text: string, job: unknown, signal: AbortSignal, opts: unknown) => Promise<unknown>),
  /** True: the line cutter throws (a stand-in for a cutter that fails on the text too). */
  splitThrows: false,
}));
vi.mock('../src/docs/range/mdParts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/docs/range/mdParts')>();
  return {
    ...real,
    cutMarkdownText: (text: string, job: unknown, signal: AbortSignal, opts: unknown) => double.cut!(text, job, signal, opts),
    splitMarkdownParts: (...args: Parameters<typeof real.splitMarkdownParts>) => {
      if (double.splitThrows) throw new RangeError('the line cutter threw');
      return real.splitMarkdownParts(...args);
    },
  };
});

afterEach(() => { cleanup(); double.cut = null; double.splitThrows = false; });

/** Three parts by the line cutter: three sections each a little under the gate, each with its own heading. */
const section = (n: number): string => `## Part ${n}\n\n` + 'word '.repeat(Math.floor((DOCS_RENDER_GATE_BYTES - 64) / 5)) + '\n\n';
const TEXT = section(1) + section(2) + section(3);
const pre = (): Promise<ReaderRenderOutcome> => Promise.resolve({ kind: 'not-rendered', why: 'over-limit' });
const PREPARING = /Preparing the parts of this document/;

const view = (text: string): ReactElement => (
  <MarkdownParts text={text} pre={pre} fragment={null} renderPart={(part) => <p>mounted {part.index + 1}: {part.text.slice(0, 9)}</p>} />
);

/** A part of `TEXT` that is not the line cutter's: a stand-in for what a cutter that has since failed had streamed. */
const streamed = (start: number, end: number): MdPart => ({ start, end, continued: false, reopen: null, close: null });

describe('MarkdownParts: a failed cut never leaves the page on "Preparing the parts"', () => {
  it('md parts page: a cut that rejects with an error takes the line cutter\'s whole cut as a complete one', async () => {
    double.cut = () => Promise.reject(new Error('the cutter failed'));
    render(view(TEXT));
    expect(screen.getByText(PREPARING)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Part 1 of 3')).toBeTruthy(), { timeout: 3000 });
    expect(screen.queryByText(PREPARING)).toBeNull();
    expect(screen.getByText('mounted 1: ## Part 1')).toBeTruthy();
    // Complete: the bar reads "of 3", and Next reaches part 3 of the line cutter's cut.
    fireEvent.click(screen.getByText('Next part'));
    fireEvent.click(screen.getByText('Next part'));
    expect(screen.getByText('Part 3 of 3')).toBeTruthy();
    expect(screen.getByText('mounted 3: ## Part 3')).toBeTruthy();
    expect(splitMarkdownParts(TEXT, DOCS_RENDER_GATE_BYTES).parts.length).toBe(3);
  });

  it('md parts page: a fallback replaces the parts streamed so far with the line cutter\'s whole cut and goes back to part 1', async () => {
    let finish: ((all: MdPart[]) => void) | null = null;
    let told: ((whole: MdPart[]) => void) | null = null;
    double.cut = (_t, _j, _s, opts) => {
      const o = opts as { onParts: (p: MdPart[]) => void; onFallback: (p: MdPart[]) => void };
      o.onParts([streamed(0, 100), streamed(100, 200)]);
      told = o.onFallback;
      return new Promise<MdPart[]>((resolve) => { finish = resolve; });
    };
    render(view(TEXT));
    await waitFor(() => expect(screen.getByText('Part 1')).toBeTruthy());
    fireEvent.click(screen.getByText('Next part'));
    expect(screen.getByText('Part 2')).toBeTruthy();
    expect(screen.getByText(/^mounted 2:/).textContent, 'the streamed part 2 is on screen').toBe('mounted 2: ' + TEXT.slice(100, 109));
    const whole = splitMarkdownParts(TEXT, DOCS_RENDER_GATE_BYTES).parts;
    act(() => { told!(whole); finish!(whole); });
    await waitFor(() => expect(screen.getByText('Part 1 of 3')).toBeTruthy());
    expect(screen.getByText('mounted 1: ## Part 1'), 'back at part 1, of the line cutter\'s cut').toBeTruthy();
    expect(screen.queryByText(/^mounted 2:/)).toBeNull();
    // P1's own words only: the bar and, from part 2 on, its "continues" note.
    expect(screen.queryByText(PREPARING)).toBeNull();
  });

  it('md parts page: the fallback is a whole cut: the bar says "of 3" as soon as it is told, before the cut\'s own answer', async () => {
    let told: ((whole: MdPart[]) => void) | null = null;
    double.cut = (_t, _j, _s, opts) => {
      told = (opts as { onFallback: (p: MdPart[]) => void }).onFallback;
      return new Promise<MdPart[]>(() => undefined); // the cut's own answer has not come
    };
    render(view(TEXT));
    await waitFor(() => expect(told).not.toBeNull());
    act(() => { told!(splitMarkdownParts(TEXT, DOCS_RENDER_GATE_BYTES).parts); });
    await waitFor(() => expect(screen.getByText('Part 1 of 3')).toBeTruthy());
    expect(screen.queryByText('Part 1'), 'not the "Part k" of a cut still being read').toBeNull();
    expect(screen.queryByText(PREPARING)).toBeNull();
  });

  it('md parts page: a cut that rejects when the line cutter throws too leaves the state as it is and no rejection unhandled', async () => {
    double.splitThrows = true;
    double.cut = () => Promise.reject(new Error('the cutter failed'));
    const unhandled: unknown[] = [];
    const on = (e: unknown): void => { unhandled.push(e); };
    process.on('unhandledRejection', on);
    try {
      render(view(TEXT));
      await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
      expect(unhandled, 'the handler\'s own throw is caught').toEqual([]);
      // Nothing is left to cut with: the page stays on its preparing line, as it was.
      expect(screen.getByText(PREPARING)).toBeTruthy();
    } finally {
      process.off('unhandledRejection', on);
    }
  });

  it('md parts page: an abort changes nothing, even when its rejection arrives after the next text\'s cut is whole', async () => {
    const aborts: ((e: Error) => void)[] = [];
    let calls = 0;
    const TEXT2 = TEXT + 'tail\n';
    double.cut = (text, _j, signal) => {
      calls += 1;
      if (calls === 1) return new Promise<MdPart[]>((_, reject) => { aborts.push(reject); signal.addEventListener('abort', () => undefined); });
      return Promise.resolve([{ start: 0, end: text.length, continued: false, reopen: null, close: null }]);
    };
    const { rerender } = render(view(TEXT));
    rerender(view(TEXT2));
    await waitFor(() => expect(screen.getByText(/^mounted 1:/)).toBeTruthy());
    expect(screen.queryByText(/Part \d of/), 'the second text is one part').toBeNull();
    // The first read's rejection arrives late, after its effect was cleaned up: it is an abort and is not an answer for the page.
    await act(async () => { aborts[0]!(new DOMException('aborted', 'AbortError')); await Promise.resolve(); });
    expect(screen.getByText(/^mounted 1:/)).toBeTruthy();
    expect(screen.queryByText(PREPARING)).toBeNull();
    expect(screen.queryByText(/Part \d of/), 'still the second text\'s one part').toBeNull();
  });
});
