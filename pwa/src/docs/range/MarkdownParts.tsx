// Markdown in parts (X2 P1 Task P1.5; spec 4.3, "Markdown in parts", amended by the coordinator's render-gate carry of
// 2026-11-19): a Markdown text above the render gate is cut into parts of at most the gate (`splitMarkdownParts`), and
// the page shows one part at a time under a bar, "Part k of n", with Previous and Next. Each part mounts rich in the
// reader frame through `renderPart`, the leaf's own Markdown body, so no reader host file changes.
//
// The pre-pass: when the page opens with a fragment, the parts are rendered through the render job (`pre`, the reader's
// own), in order, each under its parse budget, until one's heading ids hold the fragment (as written or decoded once):
// that part opens, at it. A part the budget refuses keeps its ids unknown, and a fragment no known part holds opens part
// 1, with a note when some part's ids are unknown. With no fragment there is no pre-pass, and part 1 shows at once. Ids
// are de-duplicated within each part (spec 4.3), so a heading repeated in another part has that part's own id there.
// Unmounting aborts the pre-pass.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { utf8Bytes } from '../../../../shared/utf8';
import { DOCS_PARSE_BUDGET_MS, DOCS_RENDER_GATE_BYTES } from '../../lib/markdownLimits';
import type { ReaderRenderOutcome } from '../../lib/readerRenderJob';
import { DOCS_RANGE_TEXT, fillSentence } from '../docsText';
import { partForFragment, partHolds, partText, splitMarkdownParts } from './mdParts';

/** The render job the pre-pass asks, the reader's (`ReaderDeps['render']`). */
export type PartsPrePass = (src: string, o: { budgetMs: number; signal?: AbortSignal }) => Promise<ReaderRenderOutcome>;

/** One part as the leaf mounts it: its text, its index, and the fragment it should open at (null: none). */
export interface PartToMount { readonly text: string; readonly index: number; readonly fragment: string | null }

type Ids = readonly (ReadonlySet<string> | null)[];

export function MarkdownParts(p: {
  readonly text: string;
  readonly renderPart: (part: PartToMount) => ReactNode;
  /** The pre-pass's render job; `null`, no pre-pass (a fragment then opens part 1). */
  readonly pre: PartsPrePass | null;
  readonly fragment: string | null;
}): ReactNode {
  const parts = useMemo(() => splitMarkdownParts(p.text, DOCS_RENDER_GATE_BYTES).parts, [p.text]);
  const [done, setDone] = useState(0);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState(false);
  // The fragment this page was opened with is placed once, at the first part whose ids hold it.
  const [placed, setPlaced] = useState<string | null>(null);
  const { pre } = p;
  const fragment = p.fragment;
  // The pre-pass runs only while a fragment waits to be placed, and stops at the first part that holds it (the first
  // match wins, as the whole document would name it); with no fragment it costs nothing.
  const pending = fragment !== null && fragment !== placed ? fragment : null;

  useEffect(() => {
    if (pending === null) return undefined;
    if (pre === null || parts.length < 2) {
      setIndex(0);
      setNote(false);
      setPlaced(pending);
      return undefined;
    }
    const ac = new AbortController();
    void (async () => {
      const got: (ReadonlySet<string> | null)[] = [];
      for (let k = 0; k < parts.length; k += 1) {
        if (ac.signal.aborted) return;
        const src = partText(p.text, parts[k]!);
        let outcome: ReaderRenderOutcome | null = null;
        try {
          outcome = await pre(src, { budgetMs: DOCS_PARSE_BUDGET_MS(utf8Bytes(src)), signal: ac.signal });
        } catch {
          outcome = null;
        }
        if (ac.signal.aborted) return;
        const ids = outcome !== null && outcome.kind === 'rendered' ? new Set(outcome.result.meta.headings.map((h) => h.id)) : null;
        got.push(ids);
        setDone(k + 1);
        if (partHolds(ids, pending)) {
          setIndex(k);
          setNote(false);
          setPlaced(pending);
          return;
        }
      }
      const at = partForFragment(got as Ids, pending);
      setIndex(at.part);
      setNote(at.note);
      setPlaced(pending);
    })();
    return () => ac.abort();
  }, [pending, pre, parts, p.text]);

  // Until the fragment is placed, no part mounts: a part mounted and then replaced would cost a frame for nothing.
  const waiting = pending !== null && pre !== null && parts.length > 1;

  if (waiting) {
    return <p className="docs-loading">{fillSentence(DOCS_RANGE_TEXT.partPreparing, { k: done, n: parts.length })}</p>;
  }
  const part = parts[index]!;
  const bar = parts.length < 2 ? null : (
    <nav className="docs-parts" aria-label={fillSentence(DOCS_RANGE_TEXT.partBar, { k: index + 1, n: parts.length })}>
      <Button variant="ghost" className="docs-part-prev" disabled={index === 0}
        onClick={() => { setIndex(index - 1); setNote(false); }}>{DOCS_RANGE_TEXT.partPrevious}</Button>
      <span className="docs-part-at">{fillSentence(DOCS_RANGE_TEXT.partBar, { k: index + 1, n: parts.length })}</span>
      <Button variant="ghost" className="docs-part-next" disabled={index === parts.length - 1}
        onClick={() => { setIndex(index + 1); setNote(false); }}>{DOCS_RANGE_TEXT.partNext}</Button>
    </nav>
  );
  return (
    <div className="docs-in-parts" data-part={index + 1} data-parts={parts.length}>
      {bar}
      {note && <p className="docs-note" role="status">{DOCS_RANGE_TEXT.fragmentUnknown}</p>}
      {part.continued && index > 0 && <p className="docs-note">{DOCS_RANGE_TEXT.partContinued}</p>}
      {p.renderPart({ text: partText(p.text, part), index, fragment: placed !== null && placed === fragment ? fragment : null })}
    </div>
  );
}
