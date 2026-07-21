// Tool card — the machine's work, filed neatly. Collapsed: one 44px row with
// a result dot (green ok / red error / breathing while running), mono tool
// name, truncated input summary and a duration readout (a live elapsed clock
// while running). Tap expands (animated height, reduced-motion aware) to
// input/result wells capped at --well-max with inner scroll.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ChatEvent } from '../../../shared/api';
import './chat.css';

export type ToolUseEvent = Extract<ChatEvent, { kind: 'tool_use' }>;
export type ToolResultEvent = Extract<ChatEvent, { kind: 'tool_result' }>;

/** Re-render tick while a tool is running so its elapsed clock stays live. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

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

export function ToolCard({
  use,
  result,
}: {
  use: ToolUseEvent;
  result?: ToolResultEvent;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const running = result === undefined;
  const now = useNow(running);

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
