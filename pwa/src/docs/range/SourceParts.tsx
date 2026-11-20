// A text file as source in parts (X2 P1, review F1; spec 4.3): the text is cut into parts of at most `maxBytes`
// (`splitSourceParts`, which the leaf calls with the text class cap) and the page shows one part at a time under the same
// bar Markdown parts use (`PartBar`). The part itself is the leaf's own source body, handed in as `renderPart`, so each
// part meets the same source and highlight budgets a text file under the cap meets; this component only cuts, holds the
// part's index and says which part continues a line.
import { useMemo, useState, type ReactNode } from 'react';
import { DOCS_RANGE_TEXT, fillSentence, mib } from '../docsText';
import { PartBar } from './MarkdownParts';
import { splitSourceParts } from './sourceParts';

/** One part as the leaf mounts it: its text and its index (0-based). */
export interface SourcePartToMount { readonly text: string; readonly index: number }

export function SourceParts(p: {
  readonly text: string;
  readonly maxBytes: number;
  readonly renderPart: (part: SourcePartToMount) => ReactNode;
}): ReactNode {
  const { parts, bytes } = useMemo(() => splitSourceParts(p.text, p.maxBytes), [p.text, p.maxBytes]);
  const [index, setIndex] = useState(0);
  const part = parts[Math.min(index, parts.length - 1)]!;
  const at = Math.min(index, parts.length - 1);
  return (
    <div className="docs-in-parts docs-source-parts" data-part={at + 1} data-parts={parts.length}>
      <PartBar index={at} count={parts.length} onGo={setIndex} />
      {parts.length > 1 && <p className="docs-note">{fillSentence(DOCS_RANGE_TEXT.sourceParts, { size: mib(bytes), part: mib(p.maxBytes) })}</p>}
      {part.continued && <p className="docs-note">{DOCS_RANGE_TEXT.partContinued}</p>}
      {p.renderPart({ text: p.text.slice(part.start, part.end), index: at })}
    </div>
  );
}
