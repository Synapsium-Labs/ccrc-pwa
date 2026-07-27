// Tool card — the machine's work, filed neatly. Collapsed: one 44px row with
// a result dot (green ok / red error / breathing while running), mono tool
// name, truncated input summary and a duration readout (a live elapsed clock
// while running). Tap expands (animated height, reduced-motion aware) to
// input/result wells capped at --well-max with inner scroll.
//
// AskUserQuestion is the one exception: a question Claude put to the reader is
// not machine work, and the generic row filed it as a line of raw JSON. It
// renders instead as the question itself, with the chosen answer once it lands.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ChatEvent } from '../../../shared/api';
import { useNow } from '../lib/useNow';
import './chat.css';

export type ToolUseEvent = Extract<ChatEvent, { kind: 'tool_use' }>;
export type ToolResultEvent = Extract<ChatEvent, { kind: 'tool_result' }>;

/** '0.4s' | '12s' | '1m 4s' between two ISO timestamps; null if unparsable. */
function durationLabel(from: string, to: string): string | null {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** 'm:ss' elapsed clock for the running state. */
function elapsedLabel(from: string, now: number): string | null {
  const ms = now - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The first question's text, or null if the input is unusable — it is capped at
 *  TOOL_INPUT_MAX upstream, so a big ask arrives truncated and unparseable.
 *  A blank question counts as unusable: nothing validates it beyond being a
 *  string, and an empty one would leave a card with no question on it. */
function askSummary(input: string): string | null {
  try {
    const q = (JSON.parse(input) as { questions?: { question?: unknown }[] }).questions?.[0];
    if (typeof q?.question !== 'string') return null;
    const question = q.question.trim();
    return question === '' ? null : question;
  } catch {
    return null;
  }
}

/** An answered ask's result text comes in two shapes — an option was picked,
 *  or the reader typed their own reply:
 *
 *    …answered: "<question>"="<label>". You can now continue…
 *    …answered: "<question>"=(no option selected) notes: <reply>. You can now…
 *
 *  Both are anchored on the `"=` join, never on the quotes around the question:
 *  real questions quote things themselves. Only the first question's answer is
 *  read, to match the first question `askSummary` shows. */
const ANSWER =
  /"=(?:"([^"]*)"|\(no option selected\) notes: ([\s\S]*?)(?:\. You can now continue|$))/;

/** The answer to show, or the raw text when the result is neither shape — an
 *  error, an interrupt, a decline. The raw text says what happened. */
function answerOf(text: string): string {
  const m = ANSWER.exec(text);
  const answer = (m?.[1] ?? m?.[2] ?? '').trim();
  return answer === '' ? text : answer;
}

/** An asked question, read as one: the question, then the answer once it lands.
 *  No expander — unlike a tool call there is no hidden payload worth a tap; the
 *  question and its answer are the whole event. */
function AskCard({ question, result }: { question: string; result?: ToolResultEvent }): ReactNode {
  return (
    <div className="tool-ask">
      <span className="tool-ask-glyph" aria-hidden="true">❓</span>
      <span className="tool-ask-q">{question}</span>
      {result && <span className="tool-ask-a">{answerOf(result.text)}</span>}
    </div>
  );
}

export function ToolCard({
  use,
  result,
}: {
  use: ToolUseEvent;
  result?: ToolResultEvent;
}): ReactNode {
  if (use.name === 'AskUserQuestion') {
    const question = askSummary(use.input);
    if (question !== null) return <AskCard question={question} result={result} />;
  }
  return <GenericToolCard use={use} result={result} />;
}

function GenericToolCard({
  use,
  result,
}: {
  use: ToolUseEvent;
  result?: ToolResultEvent;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const running = result === undefined;
  const now = useNow(1_000, running);

  const dot = running ? 'tool-dot--run' : result.isError ? 'tool-dot--err' : 'tool-dot--ok';
  const summary = use.input.split('\n', 1)[0] ?? '';
  const dur = running ? elapsedLabel(use.ts, now) : durationLabel(use.ts, result.ts);

  return (
    <div className="toolcard">
      <button
        type="button"
        className="tool-row"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <span className={`tool-dot ${dot}`} aria-hidden="true" />
        <span className="tool-name">{use.name}</span>
        <span className="tool-sum">{summary}</span>
        {dur !== null && <span className="tool-dur">{dur}</span>}
        <span className="tool-chev" aria-hidden="true">
          ▸
        </span>
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="tool-body-wrap"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            // 0.24s / [0.2,0,0,1] mirror --dur-base / --ease-swift (tokens.css)
            transition={reduced ? { duration: 0 } : { duration: 0.24, ease: [0.2, 0, 0, 1] }}
          >
            <div className="tool-body">
              <p className="tool-eyebrow">input</p>
              <pre className="well">{use.input}</pre>
              {result !== undefined && (
                <>
                  <p className="tool-eyebrow">result</p>
                  <pre className="well">{result.text === '' ? '(no output)' : result.text}</pre>
                </>
              )}
              <p className="tool-meta">
                {result === undefined ? (
                  <span>running…</span>
                ) : (
                  <>
                    {result.isError && <span className="exit-badge">ERROR</span>}
                    {dur !== null && <span>{dur}</span>}
                    {!result.isError && <span>done</span>}
                  </>
                )}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
