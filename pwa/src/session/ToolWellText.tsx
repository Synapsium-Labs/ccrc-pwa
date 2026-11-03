// How a tool card's wells are drawn on the code palette (T4a, D-6387): `renderToolWell(use)` is the `renderWell` that
// `ChatList` hands `ToolCard` (`@ccrc/ui`, which cannot import this). It reads each well through `toolWellPlan` and draws
// the plan: a `plain` well keeps today's single text node; `code` and `diff` are coloured by the highlight worker through a one-block
// store per well on chat's highlighter, plain first, and drawn by `lib/markdown.tsx#HighlightedCode`, the one sink (W5h-a,
// the plan's refinement (a)); `ansi` draws `lib/ansi.ts`'s runs as hue classes.
//
// Colour lives only in the wells, which are dark in every palette (spec section 3.1): every hue is a class that paints a
// palette token, and no run writes a `style` attribute. A block that is over a highlight bound (`html` null) renders as the
// original text, exactly as a fenced block over its bound renders plain.
import { useMemo, type ReactNode } from 'react';
import { ansiClass, ansiRuns, stripAnsi } from '../lib/ansi';
import { HighlightedCode, useHighlightEntry, useHighlightRequest } from '../lib/markdown';
import { isRegisteredGrammar } from '../lib/highlightNames';
import { useChatHighlightStore } from '../lib/highlighterContext';
import { toolWellPlan, type ToolWellPart } from './toolWell';

/** A code or diff well: the Write's path as a leading comment when the plan has one, then the code, on a one-block
 *  highlight store on chat's highlighter, plain until the worker answers. A well over a highlight bound shows
 *  `fallback`, the original text, exactly as a fenced block over its bound renders plain. */
function CodeWell({ lang, text, head, fallback }: { lang: string; text: string; head?: string; fallback: string }): ReactNode {
  const store = useChatHighlightStore();
  const answer = useMemo(() => store.keyOf(lang, text), [store, lang, text]);
  const key = answer.kind === 'key' ? answer.key : null;
  const entry = useHighlightEntry(store, key);
  useHighlightRequest(store, key);
  if (key === null) return fallback;
  return (
    <>
      {head !== undefined && <span className="hljs-comment">{head}</span>}
      {head !== undefined && '\n'}
      <HighlightedCode entry={entry} raw={text} />
    </>
  );
}

/** The well's content: `text` for a plain well (and for one over a highlight bound), a highlighted code element for
 *  code or a diff, hue spans for ANSI. */
export function ToolWellText({ use, part, text }: { use: { name: string; input: string }; part: ToolWellPart; text: string }): ReactNode {
  const { name } = use;
  return useMemo(() => {
    const plan = toolWellPlan({ name, input: text }, part, text, isRegisteredGrammar);
    switch (plan.kind) {
      case 'plain':
        return part === 'input' ? stripAnsi(text) : text;
      case 'code':
      case 'diff': {
        // Over its bound the well shows the original text. An input reaches `code` or `diff` only when `JSON.parse`
        // took it, and JSON refuses a raw ESC, so there is nothing here to strip (an escape is the six characters
        // `\u001b`); a result reaches `diff` only without an escape (`toolWellPlan`).
        return <CodeWell lang={plan.kind === 'diff' ? 'diff' : plan.lang} text={plan.text} head={plan.kind === 'code' ? plan.head : undefined} fallback={text} />;
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
  }, [name, part, text]);
}

/** The `renderWell` for one call: what `ToolCard` draws in its input and result wells. */
export function renderToolWell(use: { name: string; input: string }): (part: ToolWellPart, text: string) => ReactNode {
  return (part, text) => <ToolWellText use={use} part={part} text={text} />;
}
