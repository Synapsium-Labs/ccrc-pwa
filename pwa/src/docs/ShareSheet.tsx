// The share sheet (spec 2026-10-01 4.16; native Docs reader W5, Share). Ring L4 delivery over @ccrc/ui's `Sheet`: it
// shows the `ShareTarget` it is given (`shareTargetFor`'s answer, worked out when the sheet opens) and runs the two
// ways a link leaves the page; it decides nothing about the link. Decision 1: Share always opens this sheet.
// - Share… shows only where Web Share can send the link (`navigator.share`, and `navigator.canShare` where the browser
//   has it). Its click calls `navigator.share` as the FIRST statement of a handler that is not async, on `navigator`,
//   so the reader's activation is still live when the browser checks it (M4.SH4). `AbortError` (the reader closed the
//   native sheet) does nothing; any other refusal, thrown or rejected, shows a notice and leaves Copy link.
// - Copy link goes through `copyText`, the one clipboard writer under `pwa/src/docs` (M4.SH7). When the clipboard
//   refuses, a read-only field holds the link, focused and selected, to copy by hand.
// - A refusal shows its sentence and its notes (the access note wherever the slug is usable) and offers neither button.
//   `exportOffered` is the seam Export takes (spec 4.16, 4.17): it adds Export's clause to the refusals that take it.
// Every word is docsText.ts's.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet } from '@ccrc/ui';
import { SHARE_SHEET_TEXT, shareNoteSentence, shareRefusalSentence } from './docsText';
import { copyText, type ShareNoteLine, type ShareTarget } from './share';

type ShareLink = Extract<ShareTarget, { ok: true }>;
interface SharePayload { readonly url: string; readonly title: string; readonly text: string }

/** A refusal's `name`, read without assuming its realm (a `DOMException` from another realm is not `instanceof` this
 *  one's); '' when it has none. */
function errorName(e: unknown): string {
  if (typeof e !== 'object' || e === null) return '';
  const name: unknown = (e as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

/** Whether Web Share can send `data` here: `navigator.share` is a function, and `navigator.canShare`, where the browser
 *  has it, says yes. A probe that throws says no. */
function webShareUsable(data: SharePayload): boolean {
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return true;
  try {
    return navigator.canShare(data) === true;
  } catch {
    return false;
  }
}

function Notes(p: { readonly notes: readonly ShareNoteLine[] }): ReactNode {
  return p.notes.map((n) => <p key={n.note} className="docs-share-note">{shareNoteSentence(n)}</p>);
}

function LinkSheet(p: { readonly link: ShareLink; readonly onClose: () => void }): ReactNode {
  const { link } = p;
  const data = useMemo<SharePayload>(() => ({ url: link.url, title: link.title, text: link.text }), [link]);
  const canShare = useMemo(() => webShareUsable(data), [data]);
  const [shareFailed, setShareFailed] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'refused'>('idle');
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (copy !== 'refused' || field.current === null) return;
    field.current.focus();
    field.current.select();
  }, [copy]);
  const refused = (e: unknown): void => {
    if (errorName(e) !== 'AbortError') setShareFailed(true);
  };
  // NOT async, and `navigator.share` its first statement: nothing that spends a microtask may come before it, or the
  // click's activation is gone and the browser refuses the call (M4.SH4). Called on `navigator`, never detached.
  const onShare = (): void => {
    let sent: Promise<void>;
    try {
      sent = navigator.share(data);
    } catch (e) {
      refused(e);
      return;
    }
    setShareFailed(false);
    sent.then(undefined, refused);
  };
  const onCopy = (): void => {
    copyText(link.url).then(() => setCopy('copied'), () => setCopy('refused'));
  };
  return (
    <Sheet
      open
      onClose={p.onClose}
      title={SHARE_SHEET_TEXT.title}
      footer={
        <div className={QC_ACTIONS}>
          {canShare && <Button variant="primary" onClick={onShare}>{SHARE_SHEET_TEXT.share}</Button>}
          <Button variant="ghost" onClick={onCopy}>{SHARE_SHEET_TEXT.copy}</Button>
        </div>
      }
    >
      <div className="docs-share-sheet">
        <p className="docs-share-url">{link.url}</p>
        <Notes notes={link.notes} />
        {shareFailed && <p className="docs-share-note" role="alert">{SHARE_SHEET_TEXT.shareFailed}</p>}
        {copy === 'copied' && <p className="docs-share-note" role="status">{SHARE_SHEET_TEXT.copied}</p>}
        {copy === 'refused' && <p className="docs-share-note" role="alert">{SHARE_SHEET_TEXT.copyRefused}</p>}
        {copy === 'refused' && (
          <input ref={field} className="docs-share-field" readOnly value={link.url} aria-label={SHARE_SHEET_TEXT.field} />
        )}
      </div>
    </Sheet>
  );
}

/** The share sheet (spec 4.16): the link with Share… and Copy link, or a refusal's sentence. `exportOffered`: whether
 *  this page offers Export (spec 4.17), whose clause the refusals that take it then carry; false on every page until
 *  Export ships (refinement (c)). */
export function ShareSheet(p: {
  readonly target: ShareTarget; readonly exportOffered: boolean; readonly onClose: () => void;
}): ReactNode {
  const { target } = p;
  if (target.ok) return <LinkSheet link={target} onClose={p.onClose} />;
  return (
    <Sheet open onClose={p.onClose} title={SHARE_SHEET_TEXT.title}>
      <div className="docs-share-sheet">
        <p className="docs-share-note" role="status">{shareRefusalSentence(target.why, target.fields, p.exportOffered)}</p>
        <Notes notes={target.notes} />
      </div>
    </Sheet>
  );
}
