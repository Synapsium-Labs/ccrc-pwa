// THE MESSAGE YOU HAVE NOT SENT YET — the optimistic bubble, its
// thumbnails, and the one button that re-submits a message the server proved
// is sitting in the box.
//
// WHY IT IS ITS OWN FILE. `ChatList.tsx` is a virtual list over a derived
// model; this is a three-component cluster about a different subject
// entirely — what the app does with a send that has not landed. The
// `Send it` gate carries the longest argument in that file and it is about
// the SERVER's proof, not about rendering a list.
//
// The classes stay `msg-*`/`pending-*`: chat.css grounds them and these are
// their only consumers. The shape moves, the ground stays.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from '@ccrc/ui';
import { api, ApiError, apiErrorText, clipUrl, submitErrorText } from '../lib/api';
import type { PendingAttachment, PendingSend } from '../stores/session';
import './chat.css';

/** Optimistic-send thumbnails: rendered straight from the object URL the
 *  attach tray already created, so chip → pending never flickers empty
 *  waiting on a server round trip. Falls back to `clipUrl` if a pending ever
 *  arrives without one (e.g. rehydrated across a reload, where blob URLs
 *  don't survive). */
function PendingClipThumbs({ id, attachments }: { id: string; attachments: PendingAttachment[] }): ReactNode {
  return (
    <div className="msg-attach" data-count={Math.min(attachments.length, 2)}>
      {attachments.map((a) => {
        const name = a.path.slice(a.path.lastIndexOf('/') + 1);
        return (
          <img
            key={a.path}
            src={a.previewUrl ?? clipUrl(id, name)}
            alt={name}
            className="msg-attach-img"
          />
        );
      })}
    </div>
  );
}

/**
 * The rescue for a refusal the server marked `submittable`: it proved our text
 * reached the input box and then watched two Enters get swallowed, so it left
 * the text there rather than risk a misplaced keystroke. One more Enter is the
 * whole fix, and before this button the only way to press it was to open a
 * terminal. (`enter-ignored` is the only arm that earns the flag today; the
 * caller gates on the flag rather than the code — see the gate's own comment.)
 *
 * `expect` is what makes the outcome attributable to THIS bubble. `POST
 * /submit` presses Enter on whatever the box holds, and the box is shared
 * mutable state: a second send that resolved the draft conflict with "Replace
 * draft" clears this text and types its own over it, and a second
 * `enter-ignored` leaves a DIFFERENT message sitting there — in both cases
 * this bubble is still on screen still offering its button. So the row the
 * server read at failure time is sent back with the tap, and the server
 * refuses `box-mismatch` unless the box still reads exactly that. The button
 * is not rendered at all when there is no such row to send.
 *
 * On success the pending is DISCARDED, not retried: the server proved OUR text
 * was in the box and then proved it left, so the message is in flight for real
 * and the transcript will carry it. Every refusal keeps the bubble — none of
 * them proves this message was sent, `nothing-to-submit` least of all (a box
 * emptied by someone else's `C-u` looks identical).
 */
function SendItButton({
  id,
  sendKey,
  expect,
  onSent,
}: {
  id: string;
  sendKey: string;
  /** The box row the failed send left behind — the correspondence claim. */
  expect: string;
  onSent?: (key: string) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const press = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.submit(id, expect);
      onSent?.(sendKey);
    } catch (e) {
      // A coded refusal gets its own sentence; anything else (the network, a
      // restarting server) gets `apiErrorText`'s floor — `submitErrorText('')`
      // is the empty string, which ToastHost renders as a wordless red box
      // that leaves the tap's outcome entirely unstated.
      toast(e instanceof ApiError ? submitErrorText(e.message) : apiErrorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="pending-send-it" disabled={busy} onClick={() => void press()}>
      Send it
    </button>
  );
}

/** Optimistic send bubble: sending `◌` → (confirmed events replace it) →
 *  failed red `!` with the error and Retry/Discard. */
export function PendingBubble({
  id,
  send,
  onRetry,
  onDiscard,
}: {
  id: string;
  send: PendingSend;
  onRetry?: (key: string) => void;
  onDiscard?: (key: string) => void;
}): ReactNode {
  const attachments = send.attachments;
  if (send.state === 'sending') {
    return (
      <>
        {attachments && attachments.length > 0 && (
          <PendingClipThumbs id={id} attachments={attachments} />
        )}
        <div className="msg-user">{send.text}</div>
        <p className="msg-receipt">
          <span aria-hidden="true">◌</span> sending
        </p>
      </>
    );
  }
  return (
    <>
      {attachments && attachments.length > 0 && (
        <PendingClipThumbs id={id} attachments={attachments} />
      )}
      <div className="msg-user msg-user--failed">{send.text}</div>
      <p className="msg-receipt msg-receipt--failed">
        <span aria-hidden="true">!</span> not sent
      </p>
      {send.error !== undefined && send.error !== 'draft-present' && (
        <p className="pending-error">{send.error}</p>
      )}
      <div className="pending-actions">
        {/* Gated on the server's PROOF, not on the code — and that distinction
            is the whole design.

            The rule this comment used to state was "only `enter-ignored`,
            because it is the one refusal where the server has PROVEN the text
            is in the box", and it warned that a button submitting an unproven
            box is the hazard this route exists to be gated against. That
            warning is still exactly right, and it is why the condition below
            is NOT widened on `code`: the attachment path's `verify-failed`
            also carries a `draft`, but that draft is what a FAILED clear left
            behind — a FRAGMENT of the message. `POST /submit`'s correspondence
            gate cannot catch it, because the fragment IS what the box reads,
            so it matches and Enter submits the fragment.

            `submittable` is the server's answer to that objection: it is set
            only where the server watched the text echo into the box and then
            fail to leave, so the row is the whole message and one Enter would
            send exactly it. An older server never sends it — no button,
            today's behaviour, the safe direction.

            THE `verify-failed` LIMB IS DORMANT ON TODAY'S SERVER, deliberately
            and not by oversight: `SendResult.submittable` sets the flag on
            `enter-ignored` alone, and states why neither `verify-failed` arm
            can honestly claim it (an empty box, somebody else's words, or a
            partial render of our own text — all three fragments or foreign).
            It is written here anyway because the gate belongs on the proof: a
            server arm that ever earns the flag needs no client change, and
            until one does, this limb renders nothing. A downstream gate
            patching an upstream lie is the shape this build removes.

            `draft` is still required and still non-blank: it is the
            correspondence claim, and the row is blank when the BOX's marker
            row is empty. After Task 402 that can no longer come from our own
            message — `composePrompt` strips leading blank lines before
            anything is typed — so a human pressing Enter in the box first, or
            a pre-402 client, is what produces it now. `blank-first-row` is the
            server's name for that pane. */}
        {(send.code === 'enter-ignored' || send.code === 'verify-failed')
          && send.submittable === true
          && send.draft !== undefined && send.draft.trim() !== '' && (
          <SendItButton id={id} sendKey={send.key} expect={send.draft} onSent={onDiscard} />
        )}
        <button type="button" className="pending-retry" onClick={() => onRetry?.(send.key)}>
          Retry
        </button>
        <button type="button" onClick={() => onDiscard?.(send.key)}>
          Discard
        </button>
      </div>
    </>
  );
}
