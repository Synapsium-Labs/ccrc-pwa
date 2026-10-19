// The ONE Ack (centralised-update design 2026-09-20 §13; programme wave 14, R15(a)). Two surfaces offer it, the
// node's row in Settings and the home screen's halt banner. Both take the button's gate (`canAck`) and the tap
// (`sendAck`) from this file. A second copy of either could let the two buttons disagree about one row. Both moved
// here from `screens/SettingsScreen.tsx` (D-4267). The screen re-exports `canAck` and `ACK_UNREADABLE_TEXT`, not the
// tap, so a fleet component never imports a screen.
//
// Ack is offered only on a SETTLED lease, because W2's ackNode acks from nothing else (D-3183; D-3310). The route
// stays the authority: a row that went busy between the poll and the tap comes back as a 409 `busy`, rendered as
// updateErrorText's sentence. The caller re-polls either way.
import { createElement, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { NodeWire, ReleaseWire } from '../../../shared/api';
import { SETTLED_UPDATE_STATES } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';
import { QuickConfirm, toast } from '@ccrc/ui';
import { ApiError, api, updateErrorText } from '../lib/api';

export const ACK_UNREADABLE_TEXT = "Acknowledged — the server's answer could not be read; the screen will re-check.";

/** Which Ack a node is offered (D-5507, settings spec §6.3), in today's first-match order: a busy or unnamed lease
 *  offers none; a failed or reverted move is `failed`; then a standing request is `request`; then a refusal this
 *  node made is `refusal`. The ONE rule: `canAck` is this `!== null`, and `AckConfirm`'s copy is chosen by it, so the
 *  button's gate and the confirm's words cannot disagree about one row (`update-ack.test.ts`). */
export type AckBranch = 'failed' | 'request' | 'refusal';

export function ackBranch(n: NodeWire, releases: readonly ReleaseWire[]): AckBranch | null {
  const state = n.update?.state;
  // A busy lease (pending, applying, unknown), an absent state or a word this build cannot name: ackNode answers busy.
  if (typeof state !== 'string' || !(SETTLED_UPDATE_STATES as readonly string[]).includes(state)) return null;
  if (state === 'failed' || state === 'reverted') return 'failed';
  if (typeof n.request === 'object' && n.request !== null) return 'request';
  return refusedTags(n, releases).length > 0 ? 'refusal' : null;
}

export function canAck(n: NodeWire, releases: readonly ReleaseWire[]): boolean {
  return ackBranch(n, releases) !== null;
}

/** The tags this node refused, newest first: what an Ack forgets, because `ackNode` clears every refusal the node
 *  holds, whichever branch the Ack was offered for. */
export function refusedTags(n: NodeWire, releases: readonly ReleaseWire[]): string[] {
  return releases
    .filter((r) => Array.isArray(r.refused) && r.refused.some((x: unknown) =>
      typeof x === 'object' && x !== null && (x as { by?: unknown }).by === n.nodeId))
    .map((r) => r.tag)
    .sort((a, b) => compareReleaseTags(b, a));
}

/** `a`, `a and b`, `a, b and c`. */
function listWords(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What `AckConfirm` says (settings spec §6.3's three Ack rows): the title is the question, the lines name what
 *  changes, and the button is the verb. WHATEVER THE BRANCH, a node that holds a refusal gets the line that Ack
 *  forgets it and that auto-install may try it again (Review focus item 4): a request-only node with refusals never
 *  reads "nothing moves" alone. `null` for a node with no Ack. */
export interface AckConfirmCopy { title: string; lines: string[]; confirmLabel: string }

export function ackConfirmCopy(n: NodeWire, releases: readonly ReleaseWire[]): AckConfirmCopy | null {
  const branch = ackBranch(n, releases);
  if (branch === null) return null;
  const tags = refusedTags(n, releases);
  const them = tags.length === 1 ? 'it' : 'them';
  const forgets = (also: boolean): string =>
    `It ${also ? 'also ' : ''}forgets that it refused ${listWords(tags)}. `
    + `With auto-install on, the server may try ${them} again on its next check.`;
  if (branch === 'failed') {
    const target = typeof n.update?.target === 'string' && n.update.target !== '' ? n.update.target : null;
    return {
      title: `Ack ${n.label}'s failed move?`,
      lines: [
        'It returns to idle.',
        ...(tags.length > 0 ? [forgets(true)] : []),
        // The failed target, unless the refusal line already named it.
        ...(target !== null && !tags.includes(target)
          ? [`With auto-install on, the server may try ${target} again on its next check.`] : []),
      ],
      confirmLabel: 'Ack',
    };
  }
  if (branch === 'request') {
    const q = n.request as { tag?: unknown; kind?: unknown };
    const tag = typeof q.tag === 'string' && q.tag !== '' ? q.tag : 'its release';
    const verb = q.kind === 'rollback' ? 'roll back' : typeof q.kind === 'string' && q.kind !== '' ? q.kind : 'move';
    return {
      title: `Withdraw the request on ${n.label}?`,
      lines: [`The request to ${verb} to ${tag} is cleared, and nothing moves.`, ...(tags.length > 0 ? [forgets(true)] : [])],
      confirmLabel: 'Withdraw the request',
    };
  }
  return { title: `Clear ${n.label}'s refusals?`, lines: [forgets(false)], confirmLabel: 'Ack' };
}

/** How one Ack ended (D-4272):
 *  - `acked`: a clean 200;
 *  - `unreadable`: a 2xx whose body would not parse, which may still have cleared the row;
 *  - `refused`: an `ApiError` whose status is 4xx, the server's own answer, said as its sentence;
 *  - `unanswered`: any other rejection (a fetch TypeError, an `ApiError` 5xx such as a proxy's 502/504, a timeout or
 *    an abort). The server gave no answer, so the Ack may have landed. */
export type AckOutcome = 'acked' | 'unreadable' | 'refused' | 'unanswered';

/** `POST /api/updates/ack` for one node, said as a toast: nothing on a clean 200, ACK_UNREADABLE_TEXT when the
 *  answer could not be read, and the error's sentence on a rejection. It never rejects, so the caller's `.finally`
 *  (clear its busy flag, re-poll) always runs; it answers the outcome, so a caller can hold its button down until
 *  a poll shows the row changed (ackNode acks ANY settled row, idle included, and clears its request). A rejection
 *  ends `refused` only for a 4xx `ApiError`; every other rejection ends `unanswered`. */
export function sendAck(nodeId: string): Promise<AckOutcome> {
  return api.ackUpdateNode(nodeId).then(
    (answer): AckOutcome => {
      if (answer === 'unreadable') { toast(ACK_UNREADABLE_TEXT); return 'unreadable'; }
      return 'acked';
    },
    (err: unknown): AckOutcome => {
      toast(updateErrorText(err), 'error');
      return err instanceof ApiError && err.status >= 400 && err.status < 500 ? 'refused' : 'unanswered';
    },
  );
}

/** The ONE Ack confirm (D-5507, settings spec §6.3; Review focus item 4). The node row in Settings and the home
 *  screen's halt banner both open it, so no surface keeps a one-tap Ack and the two cannot word one row apart. A
 *  danger `QuickConfirm` with Cancel focused; its copy comes from `ackConfirmCopy`, so from `ackBranch`.
 *
 *  FOCUS (D-5610), wave 19's R26(a) carried through the confirm (it was `keepFocusInRow`, called on the tap; the tap now only
 *  opens this, and focus is inside the confirm when the commit lands). The commit disables the Ack that opened it, so the focus the
 *  confirm gives back would land on a disabled button and drop to <body>. When the Ack was opened from inside its
 *  row, the row (focusable from script, `tabIndex={-1}`) takes the focus once the confirm has closed; this effect is
 *  the parent's, so it runs after `useCancelFirst`'s give-back. Opened from elsewhere, the focus goes back there. A
 *  Cancel gives it back to the Ack itself. */
export function AckConfirm({ node, releases, open, onClose, onConfirm, rowRef }: {
  node: NodeWire; releases: readonly ReleaseWire[]; open: boolean; onClose: () => void; onConfirm: () => void;
  rowRef: RefObject<HTMLElement | null>;
}): ReactNode {
  const fromRow = useRef(false);
  const committed = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    const row = rowRef.current;
    fromRow.current = row !== null && row.contains(document.activeElement);
    committed.current = false;
  }, [open, rowRef]);
  useEffect(() => {
    if (open || !committed.current) return;
    committed.current = false;
    if (fromRow.current) rowRef.current?.focus();
  }, [open, rowRef]);
  const copy = ackConfirmCopy(node, releases);
  // A poll that leaves the node with no Ack while this is open (it went busy, or another tap cleared it) closes it, so
  // the caller's open flag cannot linger and reopen the confirm when a later Ack appears.
  const gone = open && copy === null;
  useEffect(() => { if (gone) onClose(); }, [gone, onClose]);
  return createElement(QuickConfirm, {
    open: open && copy !== null,
    onClose,
    title: copy?.title ?? '',
    consequence: copy?.lines ?? [],
    confirmLabel: copy?.confirmLabel ?? 'Ack',
    tone: 'danger',
    defaultFocus: 'cancel',
    onConfirm: () => { committed.current = true; onConfirm(); },
  });
}
