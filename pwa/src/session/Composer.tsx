// Composer — the prompt line. Auto-growing textarea (1→6 lines, ≥16px so iOS
// never zoom-jumps), image attach lane, phosphor send button. Enter is newline
// (touch-first); Cmd/Ctrl+Enter sends on desktop. When a send bounces off a
// half-typed server-side draft (409 draft-present), a small sheet shows that
// draft and offers: Append anyway (draft precedes your text — both send
// together), Replace draft (replaceDraft: true), or Cancel (the failed bubble
// keeps its Retry/Discard). A long text paste enters the draft as a chip label (desktop-polish wave 169): the decisions
// are pasteChips.ts (L1), the row that acts on chips is PasteChipBar, every edit the composer makes is the browser's
// own (`execCommand`), and a send expands every chip to its full text before today's send rules run, unchanged.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, ReactNode } from 'react';
import { AttachButton, AttachTray, Button, Icon, KeyHint, Sheet, Well } from '@ccrc/ui';
import { PALETTE_KEYS } from '../command/CommandLayer';
import type { PendingAttachment, PendingSend } from '../stores/session';
import { ATTACH_ACCEPT, clipboardFiles, isAttachable, useStagedImages } from './useAttachImage';
import { api, sendErrorText } from '../lib/api';
import { DESK_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import type { SlashCommand } from '../../../shared/api';
import { slashQuery, filterCommands } from './slashComplete';
import {
  applyChange, canStep, emptyChips, emptyDraft, expandChip, expandDraft, liveChips, logChange, logDraft, logStep,
  normalizePaste, planInput, planPaste, planWordDelete, removeChip, selectionText, startLog, type ChangeHow, type Draft,
  type DraftLog, type Occurrence, type PasteChips, type Plan,
} from './pasteChips';
import { PasteChipBar } from './PasteChipBar';
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
  /** The LIVE status is `busy` (W2 Task S7b, D-5471): the send slot carries Stop. */
  busy?: boolean;
  /** Stop in the send slot. It reports `keycap`, the word the server already records for the on-screen control:
   *  W2 changes no wire (D-5471), so the type admits no new source. */
  onInterrupt?: (source: 'keycap') => void;
  /** D-6326: an inline ask card is mounted, so Send is deferred LOCALLY for as long as it is: the button is DISABLED
   *  before any click, the `dialog-open` sentence shows ABOVE the field (R93) the whole time (with a draft or without one), and
   *  the text stays in the field. `send()`'s own guard is defence behind that, because Enter in the field calls it
   *  directly: it makes no request either. This is the client's own rule, not the server's predicate: the server refuses
   *  with `dialog-open` only while the pane has a menu, so an approval with no pane menu (fixture 7) would not be refused
   *  there, yet the card still holds the send while it is mounted. It also holds through the reconnect gap, while
   *  `DialogSheet`'s held, read-only card is up (`askInline` stays true then), so Send is held and Escape does not
   *  interrupt until the new connection decides. Stop is unaffected: it stays enabled beside a disabled Send. */
  askUp?: boolean;
}

/** After a send empties the draft during a busy turn, the danger Stop takes Send's spot at once; it ignores taps for
 *  this long so an impatient double-tap on Send never stops the turn it just added to (W2 Task S7b, D-5471). */
export const STOP_SETTLE_MS = 600;

interface DraftConflict {
  key: string;
  text: string;
  draft: string;
}

/** Where the key hints show: a desk-width pane with a physical keyboard. */
const KEY_HINTS_QUERY = `${DESK_QUERY} and (pointer: fine)`;

/** The hints, in the order a reader reaches for them. Esc is the session screen's interrupt (`useEscapeInterrupt`);
 *  ⌘K the command palette's. */
const KEY_HINTS: readonly { keys: readonly string[]; word: string }[] = [
  { keys: ['⏎'], word: 'send' },
  { keys: ['⇧', '⏎'], word: 'newline' },
  { keys: ['Esc'], word: 'stop' },
  { keys: PALETTE_KEYS, word: 'commands' },
];

/** The hints line in words, for a screen reader. */
const KEY_HINTS_SPOKEN = 'Keys: Enter sends, Shift Enter adds a newline, Escape stops the turn, Command K opens commands.';

/** The range a word delete from a collapsed caret would remove, as the browser itself measures a word: its selection is
 *  extended by one word and read back, then put back as it was. A textarea's `beforeinput` exposes no target range
 *  (`getTargetRanges()` is empty in Chrome), so this asks the browser rather than splitting words here. Null where the
 *  browser cannot say (no `Selection.modify`, as in jsdom): the delete then lands, and a label it broke is repaired. */
const wordRange = (el: HTMLTextAreaElement, backward: boolean): { start: number; end: number } | null => {
  const sel = document.getSelection();
  if (sel === null || typeof sel.modify !== 'function') return null;
  const [s0, s1, dir] = [el.selectionStart, el.selectionEnd, el.selectionDirection];
  try {
    sel.modify('extend', backward ? 'backward' : 'forward', 'word');
    return el.selectionStart === el.selectionEnd ? null : { start: el.selectionStart, end: el.selectionEnd };
  } catch {
    return null;
  } finally {
    el.setSelectionRange(s0, s1, dir);
  }
};

export function Composer({
  onSend,
  pending,
  id,
  disabled = false,
  placeholder = 'Message this session',
  onResolve,
  busy = false,
  onInterrupt,
  askUp = false,
}: ComposerProps): ReactNode {
  // Paste chips (wave 169). The draft is the field's value plus the chip occurrences in it (pasteChips.ts `Draft`):
  // identity is where the composer put a label, never the label's text. `draftNow` mirrors the state for handlers that
  // run inside one browser call (a paste's own `input` event reaches `onChange` before React re-renders). The table of
  // pasted texts lives beside the draft, so it survives exactly where the draft does. `log` is the drafts the field has
  // held, in the browser's undo order (pasteChips.ts `DraftLog`), so its undo and redo restore occurrences by position.
  // `attachNext` is the occurrence of the label the composer's next native edit inserts and `editNext` the range it
  // replaces, both read by that edit's own `input` event; `caretTo` places the caret after a change the browser did not
  // make itself.
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const value = draft.value;
  const draftNow = useRef<Draft>(emptyDraft());
  const chips = useRef<PasteChips>(emptyChips());
  const log = useRef<DraftLog>(startLog());
  /** The draft when an input method's composition began; while it is set, a label the composition breaks is not
   *  repaired until the composition ends, because a value written mid-composition leaves the input method's own text
   *  behind (measured in Chrome, review 3469 F4). */
  const composeBase = useRef<Draft | null>(null);
  const attachNext = useRef<Occurrence | null>(null);
  const editNext = useRef<{ start: number; end: number } | null>(null);
  const caretTo = useRef<number | null>(null);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [commands, setCommands] = useState<SlashCommand[] | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // Paste is the main way a screenshot gets here on desktop — ⌘⇧4 then ⌘V,
  // without a round trip through the filesystem and the file picker. Drop and
  // the file picker feed the same staged-images tray.
  const staged = useStagedImages(id ?? '');
  const [dropping, setDropping] = useState(false);

  const put = (next: Draft, caret: number | null = null): void => {
    draftNow.current = next;
    caretTo.current = caret;
    setDraft(next);
  };
  /** A value the composer writes itself (a send, a slash command): the drafts held before it are no undo target. */
  const reset = (next: Draft): void => {
    log.current = startLog(next);
    put(next);
  };

  /** Every change to the field goes through here. An undo or redo (`step`) returns to a draft the field has held, with
   *  its occurrences (`logStep`). Any other change goes through `applyChange`: occurrences move with the edit, and a
   *  label the edit broke anyway is repaired, the one change the composer writes without the browser's editing. */
  const change = (next: string, caret: number, how: ChangeHow, step: 'undo' | 'redo' | null = null): void => {
    if (step !== null) {
      const back = logStep(log.current, next, step === 'undo');
      if (back !== null) {
        log.current = back;
        put(logDraft(back));
        return;
      }
      // A step to a draft the composer never held: `beforeinput` cancels one it can see coming, so this is the defence
      // behind it. Nothing is placed by guess: an occurrence it broke is dropped, not rewritten.
      const r = applyChange(draftNow.current, next, caret, chips.current, { repair: false });
      log.current = startLog(r.draft);
      put(r.draft);
      return;
    }
    if (composeBase.current !== null) {
      // Mid-composition: occurrences move with it, and none is written back yet (`endComposition` does that).
      put(applyChange(draftNow.current, next, caret, chips.current, { repair: false }).draft);
      return;
    }
    const r = applyChange(draftNow.current, next, caret, chips.current, how);
    log.current = logChange(log.current, r.draft);
    put(r.draft, r.repair?.caret ?? null);
  };
  /** A composition ended: the whole of it is one change from the draft it began on, repaired now if it broke a label. */
  const endComposition = (): void => {
    const base = composeBase.current;
    const el = box.current;
    composeBase.current = null;
    if (base === null || !el) return;
    const r = applyChange(base, el.value, el.selectionEnd, chips.current);
    log.current = logChange(log.current, r.draft);
    put(r.draft, r.repair?.caret ?? null);
  };

  /** Perform a plan as the browser's own edit (`execCommand`), so its undo history holds it, with focus and the caret
   *  where the browser leaves them. Where the browser cannot (no `execCommand`, as in jsdom), the same change goes
   *  through `change` with the caret placed by hand. */
  const perform = (plan: Plan, attach: Occurrence | null = null): void => {
    const el = box.current;
    if (!el) return;
    const before = el.value;
    el.focus();
    el.setSelectionRange(plan.start, plan.end);
    attachNext.current = attach;
    editNext.current = { start: plan.start, end: plan.end };
    let done = false;
    try {
      done = typeof document.execCommand === 'function'
        && document.execCommand(plan.text === '' ? 'delete' : 'insertText', false, plan.text)
        && el.value !== before;
    } catch {
      done = false;
    }
    attachNext.current = null;
    editNext.current = null;
    if (done) return;
    const caret = plan.start + plan.text.length;
    change(before.slice(0, plan.start) + plan.text + before.slice(plan.end), caret, {
      attach, edit: { start: plan.start, end: plan.end },
    });
    caretTo.current = caret;
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (disabled) return;
    const files = id === undefined ? [] : clipboardFiles(e.clipboardData);
    if (files.length > 0) {
      e.preventDefault();
      staged.add(files);
      return;
    }
    const el = e.currentTarget;
    const text = normalizePaste(e.clipboardData?.getData('text/plain') ?? '');
    // A short paste that touches no label has no plan: the browser's own, as it always was.
    const p = planPaste(draftNow.current, el.selectionStart, el.selectionEnd, text, chips.current);
    chips.current = p.chips;
    if (p.plan === null) return;
    e.preventDefault();
    perform(p.plan, p.attach);
  };

  /** Copy and cut give the clipboard a chip's full text, never its label (pasteChips.ts `selectionText`). */
  const onCopy = (e: ClipboardEvent<HTMLTextAreaElement>, cut: boolean): void => {
    const el = e.currentTarget;
    const s0 = el.selectionStart;
    const s1 = el.selectionEnd;
    const text = selectionText(draftNow.current, s0, s1, chips.current);
    if (text === null) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    if (cut) perform(planInput(draftNow.current, s0, s1, 'deleteByCut', null, chips.current) ?? { start: s0, end: s1, text: '' });
  };

  // `beforeinput`, natively: React's synthetic one carries no `inputType`. An edit that would break a label is replaced,
  // before it lands, by the plan `planInput` makes (a Backspace after a label removes all of it, a key typed inside one
  // expands it). The listener reads the latest render's closure through a ref.
  const beforeInput = useRef<(e: InputEvent) => void>(() => undefined);
  beforeInput.current = (e: InputEvent): void => {
    const el = box.current;
    if (!el) return;
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      // An undo or redo to a draft the composer never held (one before a value it wrote itself, or older than the
      // log keeps) could only be placed by guessing, so it is cancelled while this draft has pasted texts.
      if (chips.current.size > 0 && !canStep(log.current, e.inputType === 'historyUndo')) e.preventDefault();
      return;
    }
    // An input method's composition cannot be cancelled, so it is never replaced by a scripted edit: it lands, and
    // `change` repairs a label it broke (review 3469 F4).
    if (e.isComposing || !e.cancelable || draftNow.current.occ.length === 0) return;
    const s0 = el.selectionStart;
    const s1 = el.selectionEnd;
    const word = e.inputType === 'deleteWordBackward' || e.inputType === 'deleteWordForward';
    const plan = word && s0 === s1
      ? planWordDelete(draftNow.current, s0, wordRange(el, e.inputType === 'deleteWordBackward'), e.inputType === 'deleteWordBackward', chips.current)
      : planInput(draftNow.current, s0, s1, e.inputType, e.data, chips.current);
    if (plan === null) return;
    e.preventDefault();
    perform(plan);
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const listen = (e: Event): void => beforeInput.current(e as InputEvent);
    el.addEventListener('beforeinput', listen);
    return () => el.removeEventListener('beforeinput', listen);
  }, []);

  const expandPaste = (n: number): void => {
    const plan = expandChip(draftNow.current, n, chips.current);
    if (plan !== null) perform(plan);
  };
  const removePaste = (n: number): void => {
    const plan = removeChip(draftNow.current, n);
    if (plan !== null) perform(plan);
  };

  // Lazily fetch the session's slash commands (built-ins + skills) the first
  // time the user starts a `/` command; cache for the rest of the session. A
  // failed read is not cached (an empty list would hide every command for the
  // composer's life, review 1464 F6): it stays unknown and is asked once more
  // when the next `/` command starts. What does the work is the dependency on
  // `slashOpen`, not on the query: the effect runs once as a `/` command opens,
  // so neither a pending read nor a failed one is asked again while it is
  // typed, and a failure costs at most one request per `/`, never a loop
  // (review 1473 F5).
  const query = slashQuery(value);
  const slashOpen = query !== null;
  useEffect(() => {
    if (!slashOpen || commands !== null || id === undefined) return;
    let live = true;
    void api
      .commands(id)
      .then((r) => { if (live) setCommands([...r.builtins, ...r.skills]); })
      .catch(() => {}); // stays unknown: asked again when the next `/` opens
    return () => { live = false; };
  }, [slashOpen, commands, id]);

  const matches = query !== null && commands ? filterCommands(commands, query) : [];

  const pickCommand = (name: string): void => {
    reset(emptyDraft(`/${name} `));
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
  // The caret after a change the composer made itself (a chip expanded, removed or recovered), once React has written
  // the value; the browser would otherwise leave it at the end.
  useLayoutEffect(() => {
    const at = caretTo.current;
    caretTo.current = null;
    if (at !== null && box.current && document.activeElement === box.current) box.current.setSelectionRange(at, at);
  }, [value]);

  // Carries previewUrl, not just the path: the optimistic bubble renders the
  // same thumbnails the chips did, so chip -> pending -> confirmed never
  // flickers empty. Ownership of those URLs passes to the store on send.
  const attachments = staged.images
    .filter((i) => i.state === 'staged')
    .map((i) => ({ path: i.path!, previewUrl: i.previewUrl }));
  // The draft as it will be sent: every chip token replaced by its full text, byte for byte. Every send rule below
  // reads this, never the tokens.
  const expanded = expandDraft(draft, chips.current);
  const pasted = liveChips(draft, chips.current);
  const canSend = !disabled && !staged.hasFailed && !staged.uploading
    && (expanded.trim() !== '' || attachments.length > 0);

  // Stop in the send slot (W2 Task S7b; D-5471, inside D-5099's "Later"). While a turn runs and nothing is drafted,
  // the slot IS Stop. Anything drafted (a word or a staged image) returns the slot to Send, since sending during a
  // turn is unchanged, and keeps a quieter Stop beside it, so Stop is never more than one tap away. Both skins render
  // this composer, so both get it; the Escape key's interrupt stays `useEscapeInterrupt`'s.
  const stopping = busy && onInterrupt !== undefined;
  const drafted = expanded.trim() !== '' || staged.images.length > 0;
  const sentAt = useRef(-Infinity);
  const stop = (): void => {
    if (Date.now() - sentAt.current < STOP_SETTLE_MS) return;
    onInterrupt?.('keycap');
  };

  const send = (): void => {
    if (!canSend) return;
    // A local deferral while the inline card is mounted, whatever the server would say about the pane: no request is made
    // and the text stays in the field. The Send button is disabled for the same reason (R77 F1), so this guard is the
    // defence for Enter, which calls `send()` directly. The sentence above the field (R93) is the surface's own and shows
    // while the card is up, not after a try.
    if (askUp) return;
    const text = expanded.trim();
    // An explicit `undefined` second argument still counts as a 2-arg call to
    // a caller matching on arity — only pass opts when there is one.
    if (attachments.length > 0) onSend(text, { attachments });
    else onSend(text);
    sentAt.current = Date.now();
    reset(emptyDraft());
    chips.current = emptyChips(); // a new draft numbers its chips from #1 again
    staged.release();
  };

  // A physical keyboard exists → Enter is the send key, as in every desktop
  // chat. On glass it stays a newline: phone keyboards carry no Alt or Cmd, so
  // a blanket flip would leave no way to type one on the device this app is
  // built for. Shift+Enter is a newline in BOTH modes — near-universal, present
  // on on-screen keyboards, and free to honour where Enter already means newline.
  const finePointer = useMediaQuery('(pointer: fine)');
  // W2 Task S7c (D-5471; spec §6): one quiet line of keys under the composer, where a keyboard exists and the pane
  // is wide enough for it. Refined shows key hints here only.
  const keyHints = useMediaQuery(KEY_HINTS_QUERY);

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
      // Any dialog but a CLOSING one (D-5457): the ⌘K palette that just ran
      // "Open session…" is still mounted while it animates out, at
      // `data-state="closed"`, and must not cost the arrival its focus. A
      // dialog with no state at all (the login cover) still holds it.
      if (editingElsewhere || document.querySelector('[role="dialog"]:not([data-state="closed"])') !== null) return;
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
    // D-6326 (R89): both resolving buttons are sends, held while the inline ask card is mounted. The buttons are disabled
    // for the same fact; this is the defence behind them. The conflict is NOT cleared when held, so the sheet stays open
    // with its draft and text, and nothing is queued to go when the card leaves.
    if (!conflict || askUp) return;
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
        // `isAttachable`, not a bare `image/` type test: a dragged .md reports
        // text/markdown on one OS and nothing at all on another, and the old
        // type test dropped it SILENTLY — the file vanished with no chip, no
        // toast and nothing in the box to say why.
        staged.add(Array.from(e.dataTransfer.files).filter(isAttachable));
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
      <PasteChipBar chips={pasted} onExpand={expandPaste} onRemove={removePaste} disabled={disabled} />
      {/* ABOVE the field (R93): the composer is at the foot of the pane, so a line here grows it upward and the field,
          Send and Stop stay where they were; below the field the same line pushed them up by its own height. */}
      {askUp && (
        <p className="composer-refusal" role="status">{sendErrorText('dialog-open')}</p>
      )}
      <div className="inputbar">
        <span className="prompt-glyph" aria-hidden="true">
          ❯
        </span>
        {/* `data-page-keys`: while empty, `[`, `]` and `?` reach the
            command layer (useShortcuts.ts, D-5457). */}
        <textarea
          ref={box}
          data-page-keys=""
          className="composer-input"
          aria-label="Message"
          rows={1}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            const inputType = (e.nativeEvent as InputEvent).inputType ?? '';
            change(e.target.value, e.target.selectionEnd, { attach: attachNext.current, edit: editNext.current },
              inputType === 'historyUndo' ? 'undo' : inputType === 'historyRedo' ? 'redo' : null);
          }}
          onCompositionStart={() => { composeBase.current = draftNow.current; }}
          onCompositionEnd={endComposition}
          onCopy={(e) => onCopy(e, false)}
          onDragStart={(e) => {
            // A selection holding any part of a chip is not dragged: a move would leave the chip's text at the source
            // and drop it again at the target. Copy and cut carry it instead.
            const el = e.currentTarget;
            if (selectionText(draftNow.current, el.selectionStart, el.selectionEnd, chips.current) !== null) e.preventDefault();
          }}
          onCut={(e) => onCopy(e, true)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {id !== undefined && (
          <AttachButton accept={ATTACH_ACCEPT} disabled={disabled} onPick={(files) => staged.add(files)} />
        )}
        {stopping && !drafted ? (
          <Button variant="danger" size="fit" className="stop-slot flex-none gap-2 rounded-full" onClick={stop}>
            <Icon name="square" />
            Stop
          </Button>
        ) : (
          <>
            {stopping && (
              <Button variant="danger-ghost" size="fit" className="stop-slot flex-none min-w-tap rounded-full"
                aria-label="Stop" onClick={stop}>
                <Icon name="square" />
              </Button>
            )}
            <button
              type="button"
              className="send-btn"
              aria-label="Send"
              disabled={!canSend || askUp}
              onClick={send}
            >
              <span aria-hidden="true">↑</span>
            </button>
          </>
        )}
      </div>

      {keyHints && (
        <>
          {/* The glyphs read badly aloud (⏎ as "return symbol"), so the line is for the eye and one plain sentence
              says the same to a screen reader. */}
          <p className="composer-hints" aria-hidden="true">
            {KEY_HINTS.map(({ keys, word }) => (
              <span key={word} className="composer-hint">
                <KeyHint keys={keys} />
                {word}
              </span>
            ))}
          </p>
          <p className="sr-only">{KEY_HINTS_SPOKEN}</p>
        </>
      )}

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
              <Well className="draft-well" data-testid="draft-well">{conflict.draft}</Well>
              <div className="draft-actions">
                <Button
                  variant="primary"
                  disabled={askUp}
                  onClick={() => resolveConflict(conflict.text)}
                >
                  Replace draft
                </Button>
                {/* Byte-identical to what it always was, and correct ONLY
                    because `conflict.draft` is now the whole box. */}
                <Button
                  variant="ghost"
                  disabled={askUp}
                  onClick={() => resolveConflict(`${conflict.draft}\n${conflict.text}`)}
                >
                  Append anyway
                </Button>
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
