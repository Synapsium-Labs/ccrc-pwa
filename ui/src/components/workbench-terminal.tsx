// WorkbenchTerminal — the session's pane as a tab of its own.
//
// THREE PARTS. The BAR names the pane (`terminal · <id>`), says whether it is
// attached in a word beside a matte dot, and holds the view switch (Terminal ·
// Chat · Split; Split leaves under 560px by a container query on the tab). The
// PANE is whatever the app hands in — its xterm host, the bytes as they arrive —
// on the well, edge to edge. On a phone the DOCK sits under it, above the soft
// keyboard: one scrolling row of the keys a soft keyboard does not have, a row
// of typed shortcut chips, and the input line.
//
// IT DRAWS; IT DOES NOT DECIDE. Which keys exist and in what order, the bytes a
// key sends (`KEY_SEQ`), the Ctrl latch shared with typed letters, the exit
// guard, Esc-to-interrupt on the pane host: all the app's. Every sentence that
// states app behaviour arrives as a prop — the attach word, the read-only
// reason and its way back, the placeholder, the desktop hint. The words owned
// here are this component's own controls: `Terminal`/`Chat`/`Split`, the
// toolbar names, `Type to the pane`, `Send to the pane`.
//
// A TAP NEVER TAKES FOCUS. Every key, chip and Send `preventDefault`s its
// pointerdown (the app's `keepFocus`), so the input line keeps focus and the
// soft keyboard stays up while the operator reaches for `esc` or `^C`.
//
// ON THE WELL, ON-WELL INK. Two primitives bring a page ink with them, and a
// `@layer components` sheet cannot out-rank a utility, so the override goes in
// as a utility at the call site:
//   - Keycap hovers to `text-ink-primary` (D-5101), which is the page's ink —
//     dark in a light palette, on a well that is dark in every palette. The
//     keys hover to `text-ink-on-well`; the latched key, inverted, to
//     `text-well`.
//   - Button's ghost is `text-ink-primary` with the page's hover and press
//     grounds. The read-only way back takes on-well ink and the bar's grounds.
//
// GLOW MEANS LIFE. Nothing here glows: the attach dot is matte, and the latch
// inverts rather than lights up — it is a held key, not a live thing.
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import { Button } from '../primitives/button';
import { Chip } from '../primitives/chip';
import { Icon } from '../primitives/icon';
import { Keycap } from '../primitives/keycap';
import './workbench-terminal.css';

export type WorkbenchTerminalView = 'terminal' | 'chat' | 'split';

/** One key of the phone row. `legend` is the picture on the cap (`^C`), hidden
 *  from assistive technology; `label` is its name in words ("Control C").
 *  `latch` marks the Ctrl latch, which sends no byte of its own. */
export interface WorkbenchKey { id: string; legend: string; label: string; latch?: boolean }

export interface WorkbenchTerminalProps {
  /** The bar reads `terminal · <paneId>`. */
  paneId: string;
  attached: boolean;
  /** The app's word for the attach state: "attached", "not running". */
  attachWord: string;
  view: WorkbenchTerminalView;
  onViewChange: (view: WorkbenchTerminalView) => void;
  /** The pane itself — the app's terminal host. */
  children: ReactNode;
  layout: 'desktop' | 'phone';
  /** Desktop only: the line under the pane, in the app's words. */
  hint?: ReactNode;
  /** Phone: the key row, in the app's order. */
  keys?: readonly WorkbenchKey[];
  /** The Ctrl latch's state, owned by the app (it is shared with typed letters). */
  latched?: boolean;
  onLatchChange?: (latched: boolean) => void;
  /** Every key but the latch: the app sends the key's bytes. */
  onKey?: (id: string) => void;
  /** Typed shortcut chips: '/compact', 'y', '1'. */
  shortcuts?: readonly string[];
  onShortcut?: (text: string) => void;
  draft?: string;
  onDraftChange?: (text: string) => void;
  onSend?: () => void;
  placeholder?: string;
  /** A session that cannot take input: no keys, the reason, a disabled line,
   *  and the one way back in Send's place. */
  readOnly?: { reason: string; action?: { label: string; onClick: () => void } } | null;
}

const VIEWS: readonly { id: WorkbenchTerminalView; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'chat', label: 'Chat' },
  { id: 'split', label: 'Split' },
];

/** The app's `keepFocus`: a tap on a key never moves focus off the line. */
const keepFocus = (e: PointerEvent): void => e.preventDefault();

/** The hover ink a key keeps on the well (see the header). */
const KEY_HOVER = 'enabled:hover:text-ink-on-well';
const LATCHED_HOVER = 'enabled:hover:text-well';

/** The read-only way back, drawn on the well rather than the page. */
const ON_WELL_GHOST =
  'flex-none text-ink-on-well enabled:hover:bg-well-bar-bg enabled:active:bg-well-bar-hair';

/** The roving target for a toolbar key, or null when the key is not a move.
 *  Arrows wrap; Home and End jump. */
function rovingTarget(key: string, at: number, count: number): number | null {
  if (key === 'ArrowRight') return (at + 1) % count;
  if (key === 'ArrowLeft') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** One toolbar, one tab stop: the WAI-ARIA toolbar pattern. Items are rendered
 *  by the caller from one JSX site each; this owns only which one is tabbable. */
function Toolbar({ label, hook, count, item }: {
  label: string;
  hook: string;
  count: number;
  item: (i: number, tabIndex: 0 | -1, onFocus: () => void) => ReactNode;
}): ReactNode {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const at = Math.min(active, count - 1);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next = rovingTarget(e.key, at, count);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    ref.current?.querySelectorAll<HTMLButtonElement>(':scope > button')[next]?.focus();
  };
  return (
    <div ref={ref} role="toolbar" aria-label={label} className={hook} onKeyDown={onKeyDown}>
      {Array.from({ length: count }, (_, i) => item(i, i === at ? 0 : -1, () => setActive(i)))}
    </div>
  );
}

export function WorkbenchTerminal({
  paneId, attached, attachWord, view, onViewChange, children, layout, hint,
  keys = [], latched = false, onLatchChange, onKey, shortcuts = [], onShortcut,
  draft = '', onDraftChange, onSend, placeholder, readOnly = null,
}: WorkbenchTerminalProps): ReactNode {
  const nameId = useId();
  const whyId = useId();
  const ro = readOnly ?? null;
  const roFlag = ro === null ? undefined : 'true';

  const onLineKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    onSend?.();
  };

  return (
    <section className="wb-term" aria-labelledby={nameId} data-readonly={roFlag} data-layout={layout}>
      <div className="wb-term-bar">
        <span id={nameId} className="wb-term-name">terminal · {paneId}</span>
        <span className="wb-term-attach" data-attached={String(attached)}>
          <span className="wb-term-dot" aria-hidden="true" />
          {attachWord}
        </span>
        <div role="group" aria-label="View" className="wb-term-views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              data-view={v.id}
              aria-pressed={view === v.id}
              className={cn('wb-term-view', FOCUS_RING)}
              onClick={() => onViewChange(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className={cn('wb-term-pane', FOCUS_RING)} tabIndex={0} data-readonly={roFlag}>{children}</div>

      {layout === 'desktop' && hint !== undefined && hint !== null && (
        <div className="wb-term-hint">{hint}</div>
      )}

      {layout === 'phone' && (
        <div className="wb-term-dock">
          {ro === null && keys.length > 0 && (
            <Toolbar
              label="Terminal keys"
              hook="wb-term-keys"
              count={keys.length}
              item={(i, tabIndex, onFocus) => {
                const k = keys[i]!;
                const isLatch = k.latch === true;
                return (
                  <Keycap
                    key={k.id}
                    tabIndex={tabIndex}
                    onFocus={onFocus}
                    aria-label={k.label}
                    aria-pressed={isLatch ? latched : undefined}
                    className={isLatch ? cn('wb-term-latch', latched ? LATCHED_HOVER : KEY_HOVER) : KEY_HOVER}
                    onPointerDown={keepFocus}
                    onClick={() => (isLatch ? onLatchChange?.(!latched) : onKey?.(k.id))}
                  >
                    <span aria-hidden="true">{k.legend}</span>
                  </Keycap>
                );
              }}
            />
          )}
          {ro === null && shortcuts.length > 0 && (
            <Toolbar
              label="Shortcuts"
              hook="wb-term-shortcuts"
              count={shortcuts.length}
              item={(i, tabIndex, onFocus) => {
                const s = shortcuts[i]!;
                return (
                  <button
                    key={s}
                    type="button"
                    tabIndex={tabIndex}
                    onFocus={onFocus}
                    aria-label={`Type ${s}`}
                    className={cn('wb-term-short', FOCUS_RING)}
                    onPointerDown={keepFocus}
                    onClick={() => onShortcut?.(s)}
                  >
                    <Chip>{s}</Chip>
                  </button>
                );
              }}
            />
          )}
          {ro !== null && <p id={whyId} className="wb-term-why">{ro.reason}</p>}
          <div className="wb-term-line">
            <span className="wb-term-caret" aria-hidden="true">❯</span>
            <input
              type="text"
              aria-label="Type to the pane"
              className={cn('wb-term-input', FOCUS_RING)}
              value={draft}
              placeholder={placeholder}
              disabled={ro !== null}
              aria-describedby={ro === null ? undefined : whyId}
              enterKeyHint="send"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onDraftChange?.(e.target.value)}
              onKeyDown={onLineKey}
            />
            {ro === null && (
              <button
                type="button"
                aria-label="Send to the pane"
                className={cn('wb-term-send', FOCUS_RING)}
                onPointerDown={keepFocus}
                onClick={onSend}
              >
                <Icon name="corner-down-left" size={20} />
              </button>
            )}
            {ro?.action && (
              <Button variant="ghost" size="fit" className={ON_WELL_GHOST} onClick={ro.action.onClick}>
                {ro.action.label}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
