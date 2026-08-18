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
import { useMediaQuery } from '../lib/useMediaQuery';
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

  // A physical keyboard exists → Enter is the send key, as in every desktop
  // chat. On glass it stays a newline: phone keyboards carry no Alt or Cmd, so
  // a blanket flip would leave no way to type one on the device this app is
  // built for. Shift+Enter is a newline in BOTH modes — near-universal, present
  // on on-screen keyboards, and free to honour where Enter already means newline.
  const finePointer = useMediaQuery('(pointer: fine)');

  // Opening a session should put the cursor here, not leave the user to
  // click again — the exact friction reported: tapping a fleet row (or
  // picking one in the desktop sidebar) left focus on the row itself. Keyed
  // on `id` so switching sessions in the sidebar re-fires this even without
  // a remount; SessionScreen also happens to remount Composer per session
  // (`key={sessionId}`), which would fire it anyway, but the id dependency
  // is what actually earns that behaviour rather than borrowing it.
  // Fine-pointer only: a physical keyboard exists, so focusing costs nothing.
  // On glass, autofocusing a textarea pops the on-screen keyboard unprompted
  // and shoves the whole chat view up before the user has decided to type —
  // hostile on the phone-first case, so coarse pointers are left alone.
  useEffect(() => {
    if (!finePointer || disabled) return;
    // Deferred a tick: a Sheet already open the instant the screen appears
    // (a pending dialog waiting on arrival) mounts its own focus trap
    // through a portal whose effects settle asynchronously — whether ours
    // or its runs first within the same commit isn't guaranteed, so we wait
    // for that to resolve before looking at the DOM to decide.
    const timer = setTimeout(() => {
      const el = box.current;
      if (!el) return;
      // Don't fight the user. A Sheet already open over the chat (this
      // one's own draft-conflict sheet, or one of SessionScreen's) traps its
      // own focus and must keep it; a field the user is already mid-type in
      // elsewhere keeps it too. A stray button — the fleet row just
      // tapped/clicked to get here — isn't "in use" in that sense: taking
      // focus from it is the whole point of this fix.
      const active = document.activeElement;
      const editingElsewhere = active !== null && active !== el && (
        active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'
        || (active as HTMLElement).isContentEditable
      );
      if (editingElsewhere || document.querySelector('[role="dialog"]') !== null) return;
      el.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fire only on a session switch, per spec
  }, [id]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return;
    if (finePointer) {
      // Enter sends. Any held modifier reverts to a newline — the same
      // Shift+Enter convention touch already relies on, extended to the
      // modifiers that used to mean "send" so Enter's new job doesn't
      // strand a way to type a literal newline.
      if (!e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        send();
      }
      return;
    }
    // Touch: Enter is newline (phone keyboards carry no Alt/Cmd);
    // Cmd/Ctrl+Enter still sends, as it always has.
    if (e.metaKey || e.ctrlKey) {
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
        {conflict && (() => {
          // Every row the server said it is holding — Task 405 made the 409's
          // `draft` the WHOLE box rather than `draftOf`'s single marker row.
          // The count is not decoration: BOTH buttons act on all of them, and
          // the sheet used to show one row while "Append anyway" C-u'd the box
          // and retyped that row plus the new text, destroying rows 2..N under
          // a label that says it is keeping them.
          //
          // Zero rows is a real state, not a hypothetical: `failureOf` coerces
          // a 409 that carried no `draft` to `''` (an older server, or one that
          // refused without saying what it read). A count is then the one thing
          // this copy must not print — "0 lines of unsent text" contradicts the
          // refusal that opened the sheet — so it says it does not know.
          const rows = conflict.draft === '' ? [] : conflict.draft.split('\n');
          return (
            <>
              <p className="draft-copy">
                {rows.length === 0
                  ? "The session's input box already holds unsent text, and the server didn’t say"
                    + ' what. Send yours after it, or replace it.'
                  : `Someone left ${rows.length} ${rows.length === 1 ? 'line' : 'lines'} of unsent`
                    + " text in the session's input box. Send both together, or replace it with"
                    + ' your message.'}
              </p>
              <pre className="well draft-well" data-testid="draft-well">{conflict.draft}</pre>
              <div className="draft-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => resolveConflict(conflict.text)}
                >
                  Replace draft
                </button>
                {/* Byte-identical to what it always was, and correct ONLY
                    because `conflict.draft` is now the whole box. */}
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
          );
        })()}
      </Sheet>
    </div>
  );
}
