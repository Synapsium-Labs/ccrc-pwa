// A worktree's controls, now drawn in the session's own details (D-8782: the fleet list's worktree rows are gone, and this moved
// with the row's view, not copied). Keep, Attach and Not delegated are `WorktreeControls`; the words module (`delegationWords.ts`)
// decides which a row offers and spells every word; the leaf asks first where the words say so, calls the door, and says a
// refusal on the row in one sentence of its own. Nothing is retried, and no control writes storage.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QuickConfirm, toast } from '@ccrc/ui';
import {
  ACT_VERB, ACT_WORD, ANSWER_UNREAD_WORD, actDoneWord, confirmFor, controlName, controlsName, offersControl, refusalWord,
  type WorktreeControl,
} from './delegationWords';
import { api, failedTo } from '../lib/api';

/** A worktree row's controls (delegation broker wave 5, PR10). `controls` is the words module's answer for the row (none
 *  for now while it moves to a run), and `leaseId` the worktree the doors act on; an attach carries its one choice, the
 *  worktree's own session. Keep acts at once; Attach and Not delegated ask first, and one confirm posts once (review
 *  1623 F1). A refusal is said in worktree words in an alert region, an accepted act whose answer could not be read in a
 *  status region, both mounted empty for as long as the row has controls at all, so neither is lost while the row
 *  offers none (D-1230, D-8097, F3). Nothing is retried. Focus: an act takes it to this row's box, which can hold it
 *  while the buttons are disabled; when the row's controls fall to none, or the row leaves, while the box holds it, it
 *  goes to the heading still drawn (`getHeading`: the details' worktree section's own). Every focus the row moves passes
 *  `preventScroll`, as the sheet's do (D-5610, review 1624 F1). `offer` is what the row offers (`offerOf`): when it
 *  changes, a refusal sentence is cleared, its region kept (review 1624 F5), and that includes a replaced record (review
 *  1626 F4): a late answer for the old one draws nothing (a lease row remounts with its record). */
export function WorktreeControls({ leaseId, worktree, controls, offer, nowMs, getHeading }: {
  leaseId: string; worktree: string; controls: readonly WorktreeControl[]; offer: string; nowMs: number;
  getHeading: () => HTMLElement | null;
}): ReactNode {
  // The confirm asked, and on which worktree's record, kept after it closes so its words and tone hold while it animates
  // out (F9 (a), F4). A record replaced on the same worktree while it is open is no longer the one asked about (F11 (a)).
  const [asking, setAsking] = useState<{ control: WorktreeControl; open: boolean; leaseId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; polite: boolean }>({ text: '', polite: false });
  const box = useRef<HTMLSpanElement>(null);
  // After a confirmed or closed-by-the-row ask: place the focus in the commit that closes the ask.
  const settle = useRef<'act' | 'dropped' | null>(null);
  // F1: what the open confirm may post, set at commit, and whether an act is in flight; never read from a render's closure.
  const confirmable = useRef<WorktreeControl | null>(null);
  const inFlight = useRef(false);
  // Review 1626 F4: the record the row acts on now, so an answer for one it has since replaced draws nothing.
  const current = useRef(leaseId);
  // F3: whether the focus was in the box when it last moved, for a focused button the row has just removed.
  const focusIn = useRef(false);
  const offered = asking !== null && asking.leaseId === leaseId && offersControl(controls, asking.control);
  const open = asking !== null && asking.open && offered;
  useLayoutEffect(() => { confirmable.current = open && asking !== null ? asking.control : null; current.current = leaseId; });
  // F4: an ask whose act or session the row no longer offers closes with its words kept, and never reopens by itself.
  useEffect(() => {
    if (asking === null || !asking.open || offered) return;
    settle.current = 'dropped';
    setAsking({ ...asking, open: false });
  }, [asking, offered]);
  // The heading the focus goes to when this row leaves or loses its controls while its box holds it: the section's own
  // (`getHeading`), which the session's details draw above the rows (D-8782: it was the card's toggle on the fleet list).
  const headingOf = (): HTMLElement | null => getHeading();
  const handOff = (): void => {
    // Review 1624 F1: the box no longer holds the focus, whether or not a blur said so (a removed element fires none).
    focusIn.current = false;
    headingOf()?.focus({ preventScroll: true });
  };
  const holdsFocus = (): boolean => {
    const el = box.current;
    const active = document.activeElement;
    return el !== null && (el.contains(active) || (focusIn.current && (active === null || active === document.body)));
  };
  // F2: the focus is placed in the commit that closes the ask, while the closing panel still holds it (review 1626 F10):
  // after a confirmed act the sheet has given it back to its opener, which the act has disabled. A row left with no
  // controls hands it to its heading (review 1626 F1). Otherwise a dropped ask leaves the focus where the sheet gave it
  // back only when that is in the box: when its opener has left, the panel holds it (review 1624 F3, measured in the browser).
  useEffect(() => {
    const why = settle.current;
    if (asking === null || asking.open || why === null) return;
    settle.current = null;
    if (controls.length === 0) handOff();
    else if (why !== 'dropped' || box.current?.contains(document.activeElement) !== true) box.current?.focus({ preventScroll: true });
  }, [asking]);
  // F3: the row's controls fall to none while the box holds the focus.
  const none = controls.length === 0;
  useLayoutEffect(() => { if (none && holdsFocus()) handOff(); }, [none]);
  // F2: the row leaves holding the focus. The box is read now, as React removes it, not once at mount. The focus inside
  // this row's own open confirm (a modal: while it is open the focus is in it) counts as the box holding it (review 1626 F2),
  // and goes to the heading found now once the confirm's focus trap has gone, which would pull it back into the leaving
  // panel; only if that heading is still drawn and the focus is then on the page or in that panel (review 1628 F1).
  useLayoutEffect(() => () => {
    if (holdsFocus()) { handOff(); return; }
    if (confirmable.current === null || !focusIn.current) return;
    const to = headingOf();
    const panel = document.activeElement?.closest('[role="dialog"]') ?? null;
    setTimeout(() => {
      const a = document.activeElement;
      if (to?.isConnected === true && (a === null || a === document.body || panel?.contains(a) === true)) to.focus({ preventScroll: true });
    }, 0);
  }, []);
  // Review 1624 F5: a refusal answers the act it was given; once the row offers something else, it is no longer true.
  useEffect(() => { setNote((n) => (n.polite || n.text === '' ? n : { text: '', polite: false })); }, [offer]);
  const send = (c: WorktreeControl): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    box.current?.focus({ preventScroll: true });
    setBusy(true);
    setNote({ text: '', polite: false });
    const call = c.act === 'keep' ? api.operatorRetainLease(leaseId)
      : api.resolveLease(leaseId, c.act === 'attach' ? { action: 'attach', parent: c.parent } : { action: 'foreign' });
    void call
      .then((a) => {
        if (current.current !== leaseId) return;
        if (a === 'unreadable') setNote({ text: ANSWER_UNREAD_WORD, polite: true });
        else if (a.ok) toast(actDoneWord(c, a.expiresAt, nowMs));
        else setNote({ text: refusalWord(a.error), polite: false });
      }, (err: unknown) => { if (current.current === leaseId) setNote({ text: failedTo(ACT_VERB[c.act], err), polite: false }); })
      .finally(() => { inFlight.current = false; setBusy(false); });
  };
  const words = asking === null ? null : confirmFor(asking.control);
  // F8: `title=""` keeps the row's tooltip off the controls; the box is a named group, focused by script only. It says
  // `aria-busy` while its act is in flight and draws the page's focus ring after a keyboard action (Task C38, review 1624).
  return (
    <span className="proj-work-controls" ref={box} tabIndex={-1} role="group" aria-label={controlsName(worktree)} title=""
      aria-busy={busy || undefined}
      onFocus={() => { focusIn.current = true; }}
      onBlur={(e) => {
        const to = e.relatedTarget;
        if ((to instanceof Node && !e.currentTarget.contains(to)) || (to === null && e.target.isConnected)) focusIn.current = false;
      }}>
      {controls.map((c) => (
        <Button key={c.act} variant="quiet" size="fit" disabled={busy} aria-label={controlName(c.act, worktree)}
          onClick={() => (c.act === 'keep' ? send(c) : setAsking({ control: c, open: true, leaseId }))}>{ACT_WORD[c.act]}</Button>
      ))}
      <span role="alert">{note.polite ? '' : note.text}</span>
      <span role="status">{note.polite ? note.text : ''}</span>
      <QuickConfirm
        open={open}
        onClose={() => {
          // Review 1626 F3 (b): the sheet leaves with no blur; an opener it gives the focus back to sets the flag again.
          focusIn.current = false;
          setAsking((a) => (a === null ? null : { ...a, open: false }));
        }}
        title={words?.title ?? ''}
        consequence={words?.consequence ?? ''}
        confirmLabel={words?.confirmLabel ?? ''}
        tone={asking?.control.act === 'foreign' ? 'danger' : 'commit'}
        defaultFocus={asking?.control.act === 'foreign' ? 'cancel' : 'confirm'}
        onConfirm={() => {
          const c = confirmable.current;
          if (c === null || inFlight.current) return;
          confirmable.current = null;
          settle.current = 'act';
          send(c);
        }}
      />
    </span>
  );
}
