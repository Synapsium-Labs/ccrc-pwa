// The export sheet (spec 2026-10-01 4.17 "Save", "Failures and limits", "Loading"; decision 7; native Docs reader W5,
// Export; refinement (u)). Ring L4 delivery over @ccrc/ui's `Sheet`. Two phases. The sheet builds as soon as it opens
// ("Building…"), from the request the header captured at the tap, the time, and the exporter's palette, through the
// builder's chunk, which the one dynamic `import()` of `./export/buildExport` in `pwa/src` loads (M4.EX16): so
// `react-dom/server` stays out of the main chunk. Then it shows the provenance and every note, which leave with the
// file, and its one Save button calls `downloadExport` synchronously in the click, with nothing before it that spends a
// microtask, so an installed app keeps the click's user activation (M4.EX13). It never renders the file, never reads its
// bytes, and holds no sink. A chunk that does not load is "Export could not start" with Retry; a build that throws is
// "Export failed"; a body alone over the limit is "use Download". Every word is docsText.ts's.
import { useEffect, useState, type ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet } from '@ccrc/ui';
import { mib } from './DocMarkdown';
import { EXPORT_TEXT, fillSentence, kib, pluralS } from './docsText';
import type { ExportInput, ExportResult } from './export/buildExport';
import { exportInputOf, type ExportRequest } from './export/exportInput';
import type { ExportFact } from './export/provenance';
import { downloadExport } from './objectUrls';

/** The builder's chunk, as the sheet calls it. A test injects one. */
export interface ExportBuilder { readonly buildExport: (input: ExportInput) => Promise<ExportResult> }

const loadBuilder = (): Promise<ExportBuilder> => import('./export/buildExport');

type SheetState =
  | { readonly s: 'building' }
  | { readonly s: 'no-start'; readonly error: string }
  | { readonly s: 'failed'; readonly error: string }
  | { readonly s: 'too-large' }
  | { readonly s: 'ready'; readonly result: Extract<ExportResult, { ok: true }>; readonly facts: readonly ExportFact[] };

/** An error's `name`, read without assuming its realm; `Error` when it has none. */
function errorName(e: unknown): string {
  if (typeof e !== 'object' || e === null) return 'Error';
  const name: unknown = (e as { name?: unknown }).name;
  return typeof name === 'string' && name !== '' ? name : 'Error';
}

/** A file's size as Save says it: KiB under 1 MiB, else MiB. */
const sizeOf = (bytes: number): string => (bytes < 1048576 ? kib(bytes) : mib(bytes));

export function ExportSheet(p: {
  readonly request: ExportRequest; readonly onClose: () => void; readonly load?: () => Promise<ExportBuilder>;
}): ReactNode {
  const { request } = p;
  const load = p.load ?? loadBuilder;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SheetState>({ s: 'building' });
  useEffect(() => {
    let live = true;
    setState({ s: 'building' });
    void (async () => {
      let builder: ExportBuilder;
      try {
        builder = await load();
      } catch (e) {
        if (live) setState({ s: 'no-start', error: errorName(e) });
        return;
      }
      try {
        const input = exportInputOf(request, { exportedAt: Date.now(), theme: document.documentElement.getAttribute('data-theme') });
        const result = await builder.buildExport(input);
        if (live) setState(result.ok ? { s: 'ready', result, facts: input.provenance.facts } : { s: 'too-large' });
      } catch (e) {
        if (live) setState({ s: 'failed', error: errorName(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [request, load, attempt]);
  const ready = state.s === 'ready' ? state : null;
  const footer = ready !== null || state.s === 'no-start'
    ? (
      <div className={QC_ACTIONS}>
        {ready !== null && (
          // Nothing before `downloadExport` in this handler: the click's activation must still be live (M4.EX13).
          <Button variant="primary" onClick={() => downloadExport(ready.result)}>
            {fillSentence(EXPORT_TEXT.save, { name: ready.result.name, size: sizeOf(ready.result.size) })}
          </Button>
        )}
        {state.s === 'no-start' && <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>{EXPORT_TEXT.retry}</Button>}
      </div>
    )
    : undefined;
  return (
    <Sheet open onClose={p.onClose} title={EXPORT_TEXT.title} footer={footer}>
      <div className="docs-export-sheet">
        {state.s === 'building' && <p className="docs-export-note" role="status">{EXPORT_TEXT.building}</p>}
        {state.s === 'no-start' && <p className="docs-export-note" role="alert">{fillSentence(EXPORT_TEXT.couldNotStart, { error: state.error })}</p>}
        {state.s === 'failed' && <p className="docs-export-note" role="alert">{fillSentence(EXPORT_TEXT.failed, { error: state.error })}</p>}
        {state.s === 'too-large' && <p className="docs-export-note" role="alert">{EXPORT_TEXT.tooLarge}</p>}
        {ready !== null && (
          <>
            <dl className="docs-export-facts">
              {ready.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
            </dl>
            {ready.result.notes.map((n, i) => <p key={i} className="docs-export-note">{n}</p>)}
            {ready.result.deferred > 0 && (
              <p className="docs-export-note" role="status">
                {fillSentence(EXPORT_TEXT.deferred, { k: ready.result.deferred, s: pluralS(ready.result.deferred) })}
              </p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
