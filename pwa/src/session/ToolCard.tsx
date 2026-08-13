// Tool card — the machine's work, filed neatly. Collapsed: one 44px row with
// a result dot (green ok / red error / breathing while running), mono tool
// name, truncated input summary and a duration readout (a live elapsed clock
// while running). Tap expands (animated height, reduced-motion aware) to
// input/result wells capped at --well-max with inner scroll.
//
// AskUserQuestion is the one exception: a question Claude put to the reader is
// not machine work, and the generic row filed it as a line of raw JSON. It
// renders instead as every question the ask put, each with its own answer once
// they land — or, when no answer came back, a tappable outcome row wearing the
// failure tokens rather than a chip that says a choice was made.
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

/** Every question in the ask, or null if the input is unusable — it is capped at
 *  TOOL_INPUT_MAX upstream, so a big ask arrives truncated and unparseable.
 *  A blank question counts as unusable: nothing validates it beyond being a
 *  string, and an empty one would leave a card with no question on it. One bad
 *  question spoils the card, because the answers are matched to the questions
 *  by position and a hole in the list would slide them onto the wrong ones. */
function askQuestions(input: string): string[] | null {
  try {
    const qs = (JSON.parse(input) as { questions?: { question?: unknown }[] }).questions;
    if (!Array.isArray(qs) || qs.length === 0) return null;
    const out = qs.map((q) => (typeof q?.question === 'string' ? q.question.trim() : ''));
    return out.some((q) => q === '') ? null : out;
  } catch {
    return null;
  }
}

/** What the harness appends after the last answer, in either of its two moods.
 *  Anchored at the end, so an answer that happens to contain the words keeps
 *  them. */
const ANSWER_TAIL = /\.\s*(?:You can now continue\b[\s\S]*|Read the answers carefully\b[\s\S]*)$/;

const NOTES = '(no option selected) notes: ';
const PREVIEW = '" selected preview:';

/** One answer, lifted out of the span between its question's `"…"=` join and the
 *  next question's. Either a quoted label — optionally trailed by the option's
 *  ` selected preview:` block, which only restates what the sheet already showed
 *  — or the reader's own typed reply. */
function answerFromSpan(span: string): string {
  const s = span.replace(/,\s*$/, '').trim();
  if (s.startsWith(NOTES)) return s.slice(NOTES.length).trim();
  if (s.startsWith('"')) {
    // The label's own quotes are not escaped, so the end is found by the preview
    // marker or by the *last* quote in the span — never by the next one along,
    // which cuts `Only "not an organiser"` down to `Only`.
    const p = s.indexOf(PREVIEW);
    if (p > 0) return s.slice(1, p).trim();
    const close = s.lastIndexOf('"');
    return close > 0 ? s.slice(1, close).trim() : s;
  }
  return s;
}

/** One answer per question, or null when the result is not an answered ask at
 *  all — a decline, a timeout, an interrupt.
 *
 *  The harness renders an answered ask as a comma-joined list, under either of
 *  two preambles:
 *
 *    Your questions have been answered: "<q1>"="<label>", "<q2>"=(no option
 *    selected) notes: <typed reply>. You can now continue with these answers…
 *    The user answered: "<q1>"="<label>". Read the answers carefully — …
 *
 *  Nothing here counts quotes and nothing scans for the join: questions and
 *  labels both quote things freely, and a lazy match for the join runs straight
 *  past question 1 into question 2's text. Instead each answer is bounded by the
 *  *next question's* marker, built from the question text the tool input already
 *  gave us. That resolves exactly on all 205 ask results in the author's
 *  transcripts, 41 of them multi-question. */
function askAnswers(text: string, questions: string[]): string[] | null {
  const body = text.replace(ANSWER_TAIL, '');
  const marks: { start: number; end: number }[] = [];
  for (const q of questions) {
    const mark = `"${q}"=`;
    // Searching on from the previous answer keeps the markers in question order
    // and survives a question whose text repeats.
    const start = body.indexOf(mark, marks[marks.length - 1]?.end ?? 0);
    if (start < 0) return null;
    marks.push({ start, end: start + mark.length });
  }
  return marks.map((m, i) => answerFromSpan(body.slice(m.end, marks[i + 1]?.start ?? body.length)));
}

/**
 * The truncation cue — ONE HOME for the sentence (Build 4 Task 16).
 *
 * Three states, and only one of them renders (spec §2.4): absent = *this
 * server did not report* → nothing; `0` = not truncated → nothing; `>0` →
 * this many bytes were cut. Absence must never render a completeness claim —
 * an old server can only ever produce absence, and a fragment announced as
 * whole is the exact lie this feature exists to remove.
 *
 * Still, deliberately: a truncation note is a RECORD, so `.tool-cut` carries
 * no glow, no animation and no box-shadow (the no-glow governance `/runs`
 * established, extended to the transcript).
 */
function TruncationCue({ bytes }: { bytes?: number }): ReactNode {
  if (bytes === undefined || bytes <= 0) return null;
  return <p className="tool-cut">+{bytes} bytes cut</p>;
}

/** An ask that produced no answer: declined, interrupted, or left to time out.
 *  The result text is the harness briefing the model — the decline preamble
 *  alone runs past 1 kB of it — so it goes behind a tap in the same capped,
 *  scrolling well the generic card used, and it never wears --accent-tint,
 *  which is the token for "this is what was chosen". */
function AskOutcome({ result }: { result: ToolResultEvent }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion() ?? false;
  return (
    <div className="tool-ask-out">
      <button
        type="button"
        className="tool-ask-outrow"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="tool-ask-outlabel">no answer</span>
        {result.isError && <span className="exit-badge">ERROR</span>}
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
            transition={reduced ? { duration: 0 } : { duration: 0.24, ease: [0.2, 0, 0, 1] }}
          >
            <pre className="well tool-ask-well">
              {result.text === '' ? '(no output)' : result.text}
            </pre>
            <TruncationCue bytes={result.truncatedBytes} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** An asked question, read as one: every question the ask put, each with its own
 *  answer once they land. No expander over the questions — unlike a tool call
 *  there is no hidden payload worth a tap; the questions and their answers are
 *  the whole event.
 *
 *  An errored result is never mined for an answer: whatever it holds, the ask
 *  did not come back cleanly, and painting it as a choice would say the reader
 *  picked something they never saw. */
function AskCard({
  questions,
  result,
}: {
  questions: string[];
  result?: ToolResultEvent;
}): ReactNode {
  const answers =
    result !== undefined && !result.isError ? askAnswers(result.text, questions) : null;
  return (
    <div className="tool-ask">
      {questions.map((question, i) => (
        <div className="tool-ask-qa" key={i}>
          <span className="tool-ask-glyph" aria-hidden="true">
            ❓
          </span>
          <span className="tool-ask-q">{question}</span>
          {(answers?.[i] ?? '') !== '' && <span className="tool-ask-a">{answers?.[i]}</span>}
        </div>
      ))}
      {result !== undefined && answers === null && <AskOutcome result={result} />}
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
    const questions = askQuestions(use.input);
    if (questions !== null) return <AskCard questions={questions} result={result} />;
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
              {/* One cue PER WELL — the input and the result are cut against
                  two different caps (TOOL_INPUT_MAX / TOOL_RESULT_MAX) and a
                  single shared cue would report one number for two cuts. */}
              <TruncationCue bytes={use.truncatedBytes} />
              {result !== undefined && (
                <>
                  <p className="tool-eyebrow">result</p>
                  <pre className="well">{result.text === '' ? '(no output)' : result.text}</pre>
                  <TruncationCue bytes={result.truncatedBytes} />
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
