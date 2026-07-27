// Composer — the prompt line. Auto-growing textarea (1→6 lines, ≥16px so iOS
// never zoom-jumps), image attach lane, phosphor send button. Enter is newline
// (touch-first); Cmd/Ctrl+Enter sends on desktop. When a send bounces off a
// half-typed server-side draft (409 draft-present), a small sheet shows that
// draft and offers: Append anyway (draft precedes your text — both send
// together), Replace draft (replaceDraft: true), or Cancel (the failed bubble
// keeps its Retry/Discard).
import { useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, ReactNode } from 'react';
import { Sheet } from '../components/Sheet';
import type { PendingAttachment, PendingSend } from '../stores/session';
import { AttachButton } from './AttachButton';
import { AttachTray } from './AttachTray';
import { clipboardImages, useStagedImages } from './useAttachImage';
import { api } from '../lib/api';
import type { SlashCommand } from '../../../shared/api';
import { slashQuery, filterCommands } from './slashComplete';
import './chat.css';

export interface ComposerProps {
  onSend: (
    text: string,
    opts?: { replaceDraft?: boolean; attachments?: PendingAttachment[] },
  ) => void;
  pending: PendingSend[];
  /** Session id — enables the image-attach lane; without it the lane hides. */
  id?: string;
  /** Dead session: input and send are disabled (read-only chat). */
  disabled?: boolean;
  placeholder?: string;
  /** Store resolve — re-sends a draft-conflicted pending in place, same
   *  record, so its attachments and preview URLs survive. */
  onResolve?: (key: string, text: string, opts: { replaceDraft: boolean }) => void;
}

interface DraftConflict {
  key: string;
  text: string;
  draft: string;
}

export function Composer({
  onSend,
  pending,
  id,
  disabled = false,
  placeholder = 'Message this session',
  onResolve,
}: ComposerProps): ReactNode {
  const [value, setValue] = useState('');
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [commands, setCommands] = useState<SlashCommand[] | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Paste is the main way a screenshot gets here on desktop — ⌘⇧4 then ⌘V,
  // without a round trip through the filesystem and the file picker. Drop and
  // the file picker feed the same staged-images tray.
  const staged = useStagedImages(id ?? '');
  const [dropping, setDropping] = useState(false);

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (id === undefined || disabled) return;
    const files = clipboardImages(e.clipboardData);
    if (files.length === 0) return; // an ordinary text paste — leave it alone
    e.preventDefault();
    staged.add(files);
  };

  // Lazily fetch the session's slash commands (built-ins + skills) the first
  // time the user starts a `/` command; cache for the rest of the session.
  const query = slashQuery(value);
  useEffect(() => {
    if (query === null || commands !== null || id === undefined) return;
    let live = true;
    void api
      .commands(id)
      .then((r) => { if (live) setCommands([...r.builtins, ...r.skills]); })
      .catch(() => { if (live) setCommands([]); });
    return () => { live = false; };
  }, [query, commands, id]);

  const matches = query !== null && commands ? filterCommands(commands, query) : [];

  const pickCommand = (name: string): void => {
    setValue(`/${name} `);
    box.current?.focus();
  };
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

  // Carries previewUrl, not just the path: the optimistic bubble renders the
  // same thumbnails the chips did, so chip -> pending -> confirmed never
  // flickers empty. Ownership of those URLs passes to the store on send.
  const attachments = staged.images
    .filter((i) => i.state === 'staged')
    .map((i) => ({ path: i.path!, previewUrl: i.previewUrl }));
  const canSend = !disabled && !staged.hasFailed && !staged.uploading
    && (value.trim() !== '' || attachments.length > 0);

  const send = (): void => {
    if (!canSend) return;
    const text = value.trim();
    // An explicit `undefined` second argument still counts as a 2-arg call to
    // a caller matching on arity — only pass opts when there is one.
    if (attachments.length > 0) onSend(text, { attachments });
    else onSend(text);
    setValue('');
    staged.release();
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
    onResolve?.(conflict.key, text, { replaceDraft: true });
    setConflict(null);
  };

  return (
    <div
      className="composer"
      data-disabled={disabled || undefined}
      data-drop={dropping || undefined}
      onDragOver={(e) => {
        if (id !== undefined && !disabled) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        // dragleave bubbles from every child the pointer crosses on its way
        // out — only clear the overlay once it has actually left .composer,
        // not when it lands on a child (the textarea, the attach button…).
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={(e) => {
        // A drop always ends the drag, no matter what it carried or which
        // gate below bails out — a real `drop` is never preceded by a
        // `dragleave` on the same target (the spec fires `drop` instead), so
        // any return path that skipped this would stick the dashed overlay
        // on until an unrelated later drag happened to leave .composer
        // cleanly. Unconditional (ahead of the id/disabled check too): those
        // props are read fresh on every render, so a re-render mid-drag
        // (e.g. the session dying) could otherwise leave `dropping` armed
        // from an earlier dragover with no drop handler branch left to clear it.
        setDropping(false);
        if (id === undefined || disabled) return;
        if (e.dataTransfer.files.length === 0) return; // a text/URL drop — leave it to the browser
        e.preventDefault();
        staged.add(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')));
      }}
    >
      {matches.length > 0 && (
        <ul className="slash-menu" role="listbox" aria-label="Slash commands">
          {matches.map((c) => (
            <li key={`${c.kind}:${c.name}`}>
              <button type="button" className="slash-item" onClick={() => pickCommand(c.name)}>
                <span className="slash-name">
                  /{c.name}
                  {c.kind === 'skill' && <span className="slash-badge">skill</span>}
                </span>
                <span className="slash-desc">{c.desc}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AttachTray images={staged.images} onRemove={staged.remove} onRetry={staged.retry} />
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
          onPaste={onPaste}
        />
        {id !== undefined && (
          <AttachButton disabled={disabled} onPick={(files) => staged.add(files)} />
        )}
        <button
          type="button"
          className="send-btn"
          aria-label="Send"
          disabled={!canSend}
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
