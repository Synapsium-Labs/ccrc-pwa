// The reader lab (native Docs reader, the reader lab plan of 2026-11-03, Task 10; the reader lab design, section 2):
// `/settings/reader-lab`, a page under Settings that the palette offers as "Go to Settings › Reader lab". Start loads the
// run (`readerLab/run.ts`, with the frames and the library's frame policy) through one literal dynamic import, then walks
// the ten lines' checks in the stage below the lists; Stop aborts it, and so does leaving the page. The result is text in one
// `<pre>`, which Select result selects whole, so the page draws no copy control. It stores nothing, uploads no result and
// writes no clipboard; its only requests go to this console's own door (M10.12, `reader-lab-scans.test.ts`).
//
// Ring L4: a screen.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, PageScaffold } from '@ccrc/ui';
import { LAB_CHECK_STEP, LAB_E17, LAB_E18, type LabCheckId, type LabOutcome } from '../readerLab/checks';
import { deviceFacts, deviceOf, labFeaturesOf } from '../readerLab/device';
import { LAB_TEXT } from '../readerLab/labText';
import type { LabProgress } from '../readerLab/run';
import '../readerLab/readerLab.css';

type RunModule = typeof import('../readerLab/run');

type State =
  | { readonly s: 'before' }
  | { readonly s: 'running'; readonly p: LabProgress | null }
  | { readonly s: 'stopping' }
  | { readonly s: 'done'; readonly text: string; readonly outcomes: Readonly<Record<LabCheckId, LabOutcome>> }
  | { readonly s: 'failed'; readonly why: string };

/** The run's module, loaded on Start: its one literal dynamic import. */
const loadRun = (): Promise<RunModule> => import('../readerLab/run');

/** What one check's row says now: a verdict only once the step that decides it has passed. */
function rowOf(state: State, id: LabCheckId): { readonly word: string; readonly detail: string } {
  if (state.s === 'done') return { word: LAB_TEXT.verdict[state.outcomes[id].verdict], detail: state.outcomes[id].detail };
  if (state.s !== 'running' || state.p === null) return { word: state.s === 'running' ? LAB_TEXT.waiting : LAB_TEXT.notRun, detail: '' };
  const decidedAt = LAB_CHECK_STEP[id];
  if (state.p.step < decidedAt) return { word: LAB_TEXT.waiting, detail: '' };
  const o = state.p.outcomes[id];
  if (state.p.step === decidedAt || o === undefined) return { word: LAB_TEXT.running, detail: '' };
  return { word: LAB_TEXT.verdict[o.verdict], detail: o.detail };
}

export function ReaderLab(p: { readonly load?: () => Promise<RunModule> }): ReactNode {
  const stage = useRef<HTMLDivElement | null>(null);
  const result = useRef<HTMLPreElement | null>(null);
  const running = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ s: 'before' });
  const device = useMemo(() => deviceOf(navigator.userAgent, navigator.hardwareConcurrency, labFeaturesOf(window)), []);
  useEffect(() => () => { running.current?.abort(); }, []);

  const start = (): void => {
    const ctl = new AbortController();
    running.current = ctl;
    setState({ s: 'running', p: null });
    void (async () => {
      let mod: RunModule | null = null;
      try {
        mod = await (p.load ?? loadRun)();
        const r = await mod.runReaderLab(mod.defaultLabDeps({ stage: stage.current!, signal: ctl.signal }), (pr) => {
          if (!ctl.signal.aborted) setState({ s: 'running', p: pr });
        });
        if (ctl.signal.aborted) setState({ s: 'before' });
        else setState({ s: 'done', text: mod.labResultText(r, device), outcomes: r.outcomes });
      } catch (e) {
        if (ctl.signal.aborted) {
          setState({ s: 'before' });
          return;
        }
        const word = mod !== null && e instanceof mod.LabFailure ? e.word : null;
        setState({ s: 'failed', why: word !== null ? LAB_TEXT.failed[word] : `${LAB_TEXT.failed.other}${e instanceof Error ? e.message : String(e)}` });
      }
    })();
  };
  const stop = (): void => {
    running.current?.abort();
    setState({ s: 'stopping' });
  };

  const group = (title: string, ids: readonly LabCheckId[]): ReactNode => (
    <section className="reader-lab-group" aria-label={title}>
      <h2>{title}</h2>
      <ul>
        {ids.map((id) => {
          const row = rowOf(state, id);
          return (
            <li key={id} className="reader-lab-row">
              <span>{LAB_TEXT.checks[id]}</span>
              <span className="reader-lab-word">{row.word}</span>
              {row.detail !== '' && <small className="reader-lab-detail">{row.detail}</small>}
            </li>
          );
        })}
      </ul>
    </section>
  );
  const line = state.s === 'running' ? (state.p === null ? LAB_TEXT.starting : `${state.p.step} of ${state.p.of}: ${state.p.line}`)
    : state.s === 'stopping' ? LAB_TEXT.stopping : state.s === 'failed' ? state.why : state.s === 'done' ? LAB_TEXT.done : '';
  return (
    <PageScaffold title={LAB_TEXT.title}>
      <p>{LAB_TEXT.intro}</p>
      <p>{LAB_TEXT.journal}</p>
      <p>{deviceFacts(device).join(' · ')}</p>
      {state.s === 'running'
        ? <Button onClick={stop}>{LAB_TEXT.stop}</Button>
        : state.s === 'stopping'
          ? <Button disabled>{LAB_TEXT.stop}</Button>
          : <Button onClick={start}>{LAB_TEXT.start}</Button>}
      <p aria-live="polite">{line}</p>
      {group(LAB_TEXT.wallsGroup, LAB_E18)}
      {group(LAB_TEXT.responsiveGroup, LAB_E17)}
      {state.s === 'done' && (
        <>
          <Button onClick={() => { if (result.current !== null) window.getSelection()?.selectAllChildren(result.current); }}>{LAB_TEXT.select}</Button>
          <figure>
            <figcaption>{LAB_TEXT.result}</figcaption>
            <pre ref={result} className="reader-lab-result">{state.text}</pre>
          </figure>
        </>
      )}
      <div ref={stage} className="reader-lab-stage" role="group" aria-label={LAB_TEXT.stage} />
    </PageScaffold>
  );
}
