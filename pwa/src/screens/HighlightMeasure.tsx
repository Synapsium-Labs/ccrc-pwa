// R19's measurement page (native Docs reader, W5h-a Task 9; base spec 2026-10-01 section 7.8 R19; the route
// `/settings/measure-highlighting`, the W5h-a plan's refinement (i)). Reached only inside the signed-in console:
// every read goes through `api.docs`, whose 401 raises the login overlay. Start runs `runHighlightMeasure` once;
// Stop aborts it, and so does leaving the page. The result is shown as text in one `<pre>`, which the Select result
// button selects whole, so the page draws no hand-drawn control. It stores and sends nothing and writes no clipboard
// (M7.12, `docs-scans.test.ts`). It ends what it starts: every highlight worker a run spawns (through
// `spawnHighlightWorker`, the one literal, recorded here) is terminated when the run ends, however it ends, and when
// the page unmounts; each React root the run mounts is unmounted in a `finally`. While a stopped run winds down the
// page offers no Start, so two runs never share the host.
//
// Ring L4: a screen.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, PageScaffold } from '@ccrc/ui';
import { api } from '../lib/api';
import type { HighlightJob } from '../lib/highlightProtocol';
import { createHighlighter, docsRunner, spawnHighlightWorker, type WorkerLike } from '../lib/markdownRunner';
import { MEASURE_TEXT, formatMeasureResult, runHighlightMeasure, type MeasureDeps, type MeasureResult } from './highlightMeasureRun';

type State =
  | { readonly s: 'idle' }
  | { readonly s: 'running'; readonly line: string }
  | { readonly s: 'stopping' }
  | { readonly s: 'done'; readonly text: string }
  | { readonly s: 'failed'; readonly why: string };

export function HighlightMeasure(p: {
  readonly deps?: Partial<MeasureDeps>;
  /** Where a worker comes from: `spawnHighlightWorker` unless a test hands in a fake. */
  readonly spawn?: () => WorkerLike<HighlightJob>;
}): ReactNode {
  const host = useRef<HTMLDivElement | null>(null);
  const running = useRef<AbortController | null>(null);
  const result = useRef<HTMLPreElement | null>(null);
  const [state, setState] = useState<State>({ s: 'idle' });
  // One terminating closure per run still alive; the unmount runs them all (terminate twice is harmless).
  const ends = useRef(new Set<() => void>());
  useEffect(() => () => {
    running.current?.abort();
    for (const end of [...ends.current]) end();
  }, []);
  const start = (): void => {
    const ctl = new AbortController();
    running.current = ctl;
    setState({ s: 'running', line: MEASURE_TEXT.starting });
    const workers: WorkerLike<HighlightJob>[] = [];
    const end = (): void => { for (const w of workers) w.terminate(); };
    ends.current.add(end);
    const spawn = (): WorkerLike<HighlightJob> => {
      const w = (p.spawn ?? spawnHighlightWorker)();
      workers.push(w);
      return w;
    };
    const deps: MeasureDeps = {
      loaders: api.docs,
      parse: (src, o) => docsRunner.parse(src, o),
      highlighter: (deadlineMs) => createHighlighter({ deadlineMs, spawn }),
      now: () => performance.now(),
      frame: () => new Promise((resolve) => { requestAnimationFrame(resolve); }),
      sleep: (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); }),
      host: host.current!,
      signal: ctl.signal,
      hardwareConcurrency: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null,
      ...p.deps,
    };
    const run = async (): Promise<MeasureResult> => {
      try {
        return await runHighlightMeasure(deps, (line) => { if (!ctl.signal.aborted) setState({ s: 'running', line }); });
      } finally {
        end();
        ends.current.delete(end);
      }
    };
    run().then(
      (r) => setState({ s: 'done', text: formatMeasureResult(r) }),
      (e: unknown) => setState(ctl.signal.aborted ? { s: 'idle' } : { s: 'failed', why: e instanceof Error ? e.message : String(e) }),
    );
  };
  const stop = (): void => {
    running.current?.abort();
    setState({ s: 'stopping' });
  };
  return (
    <PageScaffold title={MEASURE_TEXT.title}>
      <p>{MEASURE_TEXT.intro}</p>
      {state.s === 'running'
        ? <Button onClick={stop}>{MEASURE_TEXT.stop}</Button>
        : state.s === 'stopping'
          ? <Button disabled>{MEASURE_TEXT.stop}</Button>
          : <Button onClick={start}>{MEASURE_TEXT.start}</Button>}
      <p aria-live="polite">{state.s === 'running' ? state.line : state.s === 'stopping' ? MEASURE_TEXT.stopping : state.s === 'failed' ? state.why : state.s === 'done' ? MEASURE_TEXT.done : ''}</p>
      {state.s === 'done' && (
        <>
          <Button onClick={() => { if (result.current !== null) window.getSelection()?.selectAllChildren(result.current); }}>{MEASURE_TEXT.select}</Button>
          <figure>
            <figcaption>{MEASURE_TEXT.result}</figcaption>
            <pre ref={result}>{state.text}</pre>
          </figure>
        </>
      )}
      <div ref={host} aria-hidden="true" className="sr-only" />
    </PageScaffold>
  );
}
