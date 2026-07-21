// Composer — the prompt line. Auto-growing textarea (1→6 lines, ≥16px so iOS
// never zoom-jumps), phosphor send button. Enter is newline (touch-first);
// Cmd/Ctrl+Enter sends on desktop. When a send bounces off a half-typed
// server-side draft (409 draft-present), a small sheet shows that draft and
// offers: Append anyway (draft precedes your text — both send together),
// Replace draft (replaceDraft: true), or Cancel (the failed bubble keeps its
// Retry/Discard).
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import type { PendingSend } from '../stores/session';
import './chat.css';

export interface ComposerProps {
  onSend: (text: string, replaceDraft?: boolean) => void;
  pending: PendingSend[];
  /** Dead session: input and send are disabled (read-only chat). */
  disabled?: boolean;
  placeholder?: string;
  /** Store discard — resolves a draft conflict by replacing the failed send. */
  onDiscard?: (key: string) => void;
}

interface DraftConflict {
  key: string;
  text: string;
  draft: string;
}

export function Composer({
  onSend,
  pending,
  disabled = false,
  placeholder = 'Message this session',
  onDiscard,
}: ComposerProps): ReactNode {
  const [value, setValue] = useState('');
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Draft conflicts already surfaced (or cancelled) — don't reopen the sheet
  // for the same failure; a retry (state flips to 'sending') re-arms it.
  const handled = useRef(new Set<string>());

  useEffect(() => {
    for (const p of pending) {
      if (p.state === 'sending') handled.current.delete(p.key);
    }
    const c = pending.find(
      (p) => p.state === 'failed' && p.error === 'draft-present' && !handled.current.has(p.key),
    );
    if (c) {
      handled.current.add(c.key);
      setConflict({ key: c.key, text: c.text, draft: c.draft ?? '' });
    }
  }, [pending]);

  // Auto-grow: measure content, let the CSS max-height cap it at 6 lines.
  const grow = (): void => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(grow, [value]);

  const send = (): void => {
    const text = value.trim();
    if (text === '' || disabled) return;
    onSend(text);
    setValue('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Touch keyboards: Enter is newline. Desktop: Cmd/Ctrl+Enter sends.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  const closeConflict = (): void => setConflict(null);
  const resolveConflict = (text: string): void => {
    if (!conflict) return;
    onDiscard?.(conflict.key);
    onSend(text, true);
    setConflict(null);
  };

  return (
    <div className="composer" data-disabled={disabled || undefined}>
      <div className="inputbar">
        <span className="prompt-glyph" aria-hidden="true">
          ❯
        </span>
        <textarea
          ref={box}
          className="composer-input"
          aria-label="Message"
          rows={1}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="send-btn"
          aria-label="Send"
          disabled={disabled || value.trim() === ''}
          onClick={send}
        >
          <span aria-hidden="true">↑</span>
        </button>
      </div>

      <Sheet
        open={conflict !== null}
        onClose={closeConflict}
        title="There's already a draft in this session"
      >
        {conflict && (
          <>
            <p className="draft-copy">
              Someone left unsent text in the session's input box. Send both together, or replace
              it with your message.
            </p>
            <pre className="well draft-well">{conflict.draft}</pre>
            <div className="draft-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => resolveConflict(conflict.text)}
              >
                Replace draft
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => resolveConflict(`${conflict.draft}\n${conflict.text}`)}
              >
                Append anyway
              </button>
              <button type="button" className="draft-cancel" onClick={closeConflict}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
