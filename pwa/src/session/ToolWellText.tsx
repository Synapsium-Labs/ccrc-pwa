// How a tool card's wells are drawn on the code palette (T4a, D-6387): `renderToolWell(use)` is the `renderWell` that
// `ChatList` hands `ToolCard` (`@ccrc/ui`, which cannot import this). It reads each well through `toolWellPlan` and draws
// the plan: a `plain` well keeps today's single text node; `code` and `diff` go through `lib/markdown.tsx#boundedHighlight`,
// the ONE highlighter (never `hljs` here), into the same `<code className="hljs">` a fenced block renders; `ansi` draws
// `lib/ansi.ts`'s runs as hue classes.
//
// Colour lives only in the wells, which are dark in every palette (spec section 3.1): every hue is a class that paints a
// palette token, and no run writes a `style` attribute. A block that is over a highlight bound (`html` null) renders as the
// original text, exactly as a fenced block over its bound renders plain.
import type { ReactNode } from 'react';
import { ansiClass, ansiRuns } from '../lib/ansi';
import { boundedHighlight, isRegisteredGrammar } from '../lib/markdown';
import { toolWellPlan, type ToolWellPart } from './toolWell';

/** A highlighted well: the Write's path as a leading comment when the plan has one, then the highlighted code. */
function HighlightedWell({ html, head }: { html: string; head?: string }): ReactNode {
  return (
    <>
      {head !== undefined && <span className="hljs-comment">{head}</span>}
      {head !== undefined && '\n'}
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

/** The well's content: `text` for a plain well (and for one over a highlight bound), a highlighted code element for
 *  code or a diff, hue spans for ANSI. */
export function ToolWellText({ use, part, text }: { use: { name: string; input: string }; part: ToolWellPart; text: string }): ReactNode {
  const plan = toolWellPlan(use, part, text, isRegisteredGrammar);
  switch (plan.kind) {
    case 'plain':
      return text;
    case 'code':
    case 'diff': {
      const { html } = boundedHighlight(plan.text, plan.kind === 'diff' ? 'diff' : plan.lang);
      if (html === null) return text;
      return <HighlightedWell html={html} head={plan.kind === 'code' ? plan.head : undefined} />;
    }
    case 'ansi':
      return (
        <>
          {ansiRuns(text).map((run, i) =>
            run.hue === null ? run.text : <span key={i} className={ansiClass(run.hue)}>{run.text}</span>,
          )}
        </>
      );
  }
}

/** The `renderWell` for one call: what `ToolCard` draws in its input and result wells. */
export function renderToolWell(use: { name: string; input: string }): (part: ToolWellPart, text: string) => ReactNode {
  return (part, text) => <ToolWellText use={use} part={part} text={text} />;
}
