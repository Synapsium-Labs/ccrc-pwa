// Markdown in parts (X2 P1 Task P1.5; spec 4.3, "Markdown in parts", amended by the coordinator's render-gate carry of
// 2026-11-19): a Markdown text above the render gate is cut into parts of at most the gate, and the page shows one part at
// a time under a bar, "Part k of n", with Previous and Next. Each part mounts rich in the reader frame through `renderPart`,
// the leaf's own Markdown body, so no reader host file changes.
//
// The cut (X2 P6.1 Step 0b2): with the render job (`pre`, the reader's own) the text is read for the shared library's own block
// boundaries, window by window, and cut at them as it is read (`cutMarkdownText`, `mdParts.ts`, which holds every decision: what a
// window's answer is, what a refusal or a throw does, what the line cutter takes). A part is mounted as soon as it is final, while
// the rest is read: the bar then reads "Part k" with Next for a final part only, and "Part k of n" once the cut is whole. A cutter
// that throws (`onFallback`), or a cut that rejects with anything but an abort, is answered by the line cutter's whole cut, from part
// 1 and with its own words (the bar and its "continues" note): the page never stays on the preparing line with no answer. Until
// the first part is final the page says "Preparing the parts of this document (k of n)", k and n in render gates (the blocks read's
// coverage, and then the pre-pass's, so one unit throughout). A pending fragment waits for the whole cut. With no render job
// (`pre === null`) the line cutter cuts at once. A new text, or unmounting, aborts the read.
//
// The pre-pass: when the page opens with a fragment, the parts are rendered through the render job, in order, each under its
// parse budget, until one's heading ids hold the fragment (as written or decoded once): that part opens, at it. A part the
// budget refuses keeps its ids unknown, and a fragment no known part holds opens part 1, with a note when some part's ids are
// unknown. With no fragment there is no pre-pass, and part 1 shows at once. Ids are de-duplicated within each part (spec 4.3),
// so a heading repeated in another part has that part's own id there. Unmounting aborts the pre-pass.
//
// Each part mounts inside `PartContext` (the whole text, the part's cut, its place), which the reader frame reads for Changes
// since on the part (`reader/partChanges.ts`). A text above 2 MiB was read by range, so Changes since and Export act on the part
// on screen, and a note under the bar says so (`PARTS_WORDS.actsOnPart`); the frame cannot show ccrc's words.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { utf8Bytes } from '../../../../shared/utf8';
import { DOCS_PARSE_BUDGET_MS, DOCS_RENDER_GATE_BYTES } from '../../lib/markdownLimits';
import type { ReaderRenderOutcome } from '../../lib/readerRenderJob';
import { DOCS_RANGE_TEXT, fillSentence } from '../docsText';
import { PartExportBody } from '../exportBody';
import { NoPrintSource, usePublishPrintSource, type PrintSource } from '../print/printSource';
import { cutMarkdownText, partForFragment, partHolds, partText, splitMarkdownParts, type MdPart } from './mdParts';
import { PartContext } from './partContext';
import { PARTS_WORDS } from './partsWords';
import { actsOnPart } from './rangePolicy';

/** The last cut of one text, and the part it was showing (X2 P6.1 Step 0c, review 3): the reader's tap on Export's plain view
 *  turns the reader off and mounts the plain branch's `MarkdownParts` for the same text, which must show the same part of the same
 *  parts, not part 1 of the line cutter's. One entry, keyed by the body key and the text: a new text or key cuts afresh. Only a
 *  whole cut is kept for reuse (`complete`), so a plain branch never lands on a part of a cut the reader had not finished. */
interface PartsSlot { readonly key: string; readonly text: string; readonly parts: readonly MdPart[]; readonly complete: boolean; readonly index: number }
let slot: PartsSlot | null = null;
const heldCut = (key: string | undefined, text: string): PartsSlot | null =>
  key !== undefined && slot !== null && slot.key === key && slot.text === text && slot.complete ? slot : null;

/** The render job the pre-pass and the blocks read ask, the reader's (`ReaderDeps['render']`). */
export type PartsPrePass = (src: string, o: { budgetMs: number; signal?: AbortSignal; blocks?: true }) => Promise<ReaderRenderOutcome>;

/** One part as the leaf mounts it: its text, its index, and the fragment it should open at (null: none). */
export interface PartToMount { readonly text: string; readonly index: number; readonly fragment: string | null }

type Ids = readonly (ReadonlySet<string> | null)[];

/** The part bar, one for every document read in parts (Markdown here, source in `SourceParts`): "Part k of n" with
 *  Previous and Next. `index` is 0-based; `onGo` is told the part to show. Nothing for a single part. `more`: the rest of the
 *  text is still being cut, so `count` is the parts final so far: the bar reads "Part k" and Next is for a final part only. */
export function PartBar(p: { readonly index: number; readonly count: number; readonly onGo: (to: number) => void; readonly more?: boolean }): ReactNode {
  if (p.count < 2 && p.more !== true) return null;
  const at = p.more === true ? fillSentence(PARTS_WORDS.partOpen, { k: p.index + 1 }) : fillSentence(DOCS_RANGE_TEXT.partBar, { k: p.index + 1, n: p.count });
  return (
    <nav className="docs-parts" aria-label={at}>
      <Button variant="ghost" className="docs-part-prev" disabled={p.index === 0}
        onClick={() => p.onGo(p.index - 1)}>{DOCS_RANGE_TEXT.partPrevious}</Button>
      <span className="docs-part-at">{at}</span>
      <Button variant="ghost" className="docs-part-next" disabled={p.index === p.count - 1}
        onClick={() => p.onGo(p.index + 1)}>{DOCS_RANGE_TEXT.partNext}</Button>
    </nav>
  );
}

export function MarkdownParts(p: {
  readonly text: string;
  readonly renderPart: (part: PartToMount) => ReactNode;
  /** The pre-pass's render job; `null`, no pre-pass (a fragment then opens part 1). */
  readonly pre: PartsPrePass | null;
  readonly fragment: string | null;
  /** What the text is the body of (the leaf's body key): with it, the last cut of this text and its part are kept for the next
   *  `MarkdownParts` of the same text and key (the reader's plain view). Absent, nothing is kept or reused. */
  readonly bodyKey?: string;
}): ReactNode {
  const { pre, bodyKey } = p;
  const fragment = p.fragment;
  // With no render job the line cutter cuts at once; with one, `cutMarkdownText` (`mdParts.ts`) reads the blocks window by window
  // and hands over each part as it becomes final (`cut`, for one text and one render job; `complete` once the cut is whole), and
  // `reading` says how far the read got.
  // With none, a whole cut of this very text the reader made is shown as it was cut (`slot`), else the line cutter cuts.
  const lineParts = useMemo(
    () => (pre === null ? heldCut(bodyKey, p.text)?.parts ?? splitMarkdownParts(p.text, DOCS_RENDER_GATE_BYTES).parts : null),
    [p.text, pre, bodyKey]);
  const [cut, setCut] = useState<{ readonly text: string; readonly pre: PartsPrePass; readonly parts: readonly MdPart[]; readonly complete: boolean } | null>(null);
  const [reading, setReading] = useState<{ readonly covered: number; readonly total: number }>(() => ({ covered: 0, total: utf8Bytes(p.text) }));
  const now = cut !== null && cut.text === p.text && cut.pre === pre ? cut : null;
  const parts: readonly MdPart[] | null = lineParts ?? (now !== null && now.parts.length > 0 ? now.parts : null);
  const complete = lineParts !== null || (now !== null && now.complete);
  // The bytes of the text each part ends at, once the cut is whole: what the preparing line counts the pre-pass in.
  const ends = useMemo(() => {
    if (!complete || parts === null) return [] as number[];
    let sum = 0;
    return parts.map((q) => (sum += utf8Bytes(p.text.slice(q.start, q.end))));
  }, [complete, parts, p.text]);
  // Above 2 MiB the text was read by range, and Changes since and Export act on the part on screen (spec 4.3): the bar says so.
  const overWhole = useMemo(() => actsOnPart(p.text), [p.text]);
  const [done, setDone] = useState(0);
  const [index, setIndex] = useState(() => heldCut(bodyKey, p.text)?.index ?? 0);
  // What Print draws from (X2 P6.1 Step 1): every part as it mounts (held across a page turn, so turning prepares nothing again),
  // whether the cut is whole, and the part on screen (`at`: what a document too long to print whole prints). The parts' own bodies
  // publish nothing (`NoPrintSource` below), so this is the one writer for the document.
  const printParts = useMemo(() => (parts === null ? null : parts.map((q) => partText(p.text, q))), [parts, p.text]);
  const printAt = parts === null ? 0 : Math.min(index, parts.length - 1);
  usePublishPrintSource(useMemo<PrintSource | null>(
    () => (printParts === null ? null : { kind: 'markdown-parts', parts: printParts, complete, at: printAt }),
    [printParts, complete, printAt]));
  const [note, setNote] = useState(false);
  // The fragment this page was opened with is placed once, at the first part whose ids hold it.
  const [placed, setPlaced] = useState<string | null>(null);

  // The blocks read: windows of the text through the render job, then the cut at the library's own block boundaries. Whatever
  // the worker cannot read the line cutter cuts; a new text or an unmount aborts it.
  useEffect(() => {
    if (pre === null) return undefined;
    const ac = new AbortController();
    const text = p.text;
    setReading({ covered: 0, total: utf8Bytes(text) });
    setCut({ text, pre, parts: [], complete: false });
    cutMarkdownText(text, pre, ac.signal, {
      onProgress: (covered, total) => { if (!ac.signal.aborted) setReading({ covered, total }); },
      onParts: (more) => {
        if (ac.signal.aborted) return;
        setCut((prev) => (prev !== null && prev.text === text && prev.pre === pre ? { ...prev, parts: [...prev.parts, ...more] } : prev));
      },
      // The block cutter threw: the parts it streamed are void, and the line cutter's whole cut (told whole) replaces them, from part 1.
      onFallback: (whole) => {
        if (ac.signal.aborted) return;
        setCut({ text, pre, parts: whole, complete: true });
        setIndex(0);
        setNote(false);
      },
    }).then(
      (all) => { if (!ac.signal.aborted) setCut({ text, pre, parts: all, complete: true }); },
      () => {
        // An abort is the effect's own cleanup: nothing to show. Anything else is a cut that failed: the page takes the line cutter's
        // whole cut as a complete one, so it never stays on "Preparing the parts" with no answer.
        if (ac.signal.aborted) return;
        let whole: MdPart[];
        try {
          whole = splitMarkdownParts(text, DOCS_RENDER_GATE_BYTES).parts;
        } catch {
          // The line cutter threw too: there is nothing left to cut with, so the state stays as it is (whatever parts were streamed,
          // or the preparing line), and no rejection is left unhandled.
          return;
        }
        setCut({ text, pre, parts: whole, complete: true });
        setIndex(0);
        setNote(false);
      },
    );
    return () => ac.abort();
  }, [p.text, pre]);

  // Keep the cut and the place for the next `MarkdownParts` of this text and key.
  useEffect(() => {
    if (bodyKey === undefined || parts === null) return;
    slot = { key: bodyKey, text: p.text, parts, complete, index: Math.min(index, parts.length - 1) };
  }, [bodyKey, p.text, parts, complete, index]);

  // The pre-pass runs only while a fragment waits to be placed, and stops at the first part that holds it (the first
  // match wins, as the whole document would name it); with no fragment it costs nothing.
  const pending = fragment !== null && fragment !== placed ? fragment : null;

  useEffect(() => {
    if (pending === null || parts === null || !complete) return undefined;
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
  }, [pending, pre, parts, complete, p.text]);

  // The preparing line counts one unit throughout, render gates of the text: how many the blocks read has covered, then how many
  // the parts the pre-pass has rendered end at, of how many the text holds.
  const gates = Math.max(1, Math.ceil(reading.total / DOCS_RENDER_GATE_BYTES));
  const preparing = (coveredBytes: number): ReactNode => (
    <p className="docs-loading">{fillSentence(DOCS_RANGE_TEXT.partPreparing, { k: Math.min(gates, Math.floor(coveredBytes / DOCS_RENDER_GATE_BYTES)), n: gates })}</p>
  );
  // No part yet: the first is not final until the blocks read has passed it.
  if (parts === null) return preparing(reading.covered);
  // Until the fragment is placed, no part mounts (a part mounted and then replaced would cost a frame for nothing), and a
  // fragment waits for the whole cut, as the first part holding its heading is the first of the whole.
  if (pending !== null && pre !== null && (!complete || parts.length > 1)) return preparing(complete ? (done > 0 ? ends[done - 1] ?? 0 : 0) : reading.covered);
  const at = Math.min(index, parts.length - 1);
  const part = parts[at]!;
  const shown = p.renderPart({ text: partText(p.text, part), index, fragment: placed !== null && placed === fragment ? fragment : null });
  // Above 2 MiB Export acts on the part on screen (spec 4.3), whatever draws it: the reader frame, or the plain view or tree it falls
  // back to (review 4116, F1), so every body under it is marked as a part here, where the parts are.
  return (
    <div className="docs-in-parts" data-part={index + 1} data-parts={complete ? parts.length : undefined}>
      <PartBar index={index} count={parts.length} more={!complete} onGo={(to) => { setIndex(to); setNote(false); }} />
      {overWhole && <p className="docs-note">{PARTS_WORDS.actsOnPart}</p>}
      {note && <p className="docs-note" role="status">{DOCS_RANGE_TEXT.fragmentUnknown}</p>}
      {part.continued && index > 0 && <p className="docs-note">{DOCS_RANGE_TEXT.partContinued}</p>}
      <PartContext.Provider value={{ whole: p.text, part }}>
        <NoPrintSource>
          {overWhole ? <PartExportBody>{shown}</PartExportBody> : shown}
        </NoPrintSource>
      </PartContext.Provider>
    </div>
  );
}
