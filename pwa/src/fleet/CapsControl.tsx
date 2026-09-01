// The operator's dial on the two coordination caps (spec §8, D-1209). Before it
// there was no door at all: `CoordStore.setCaps` had no caller in `server/src`
// and the caps changed by hand-editing `coord.db`.
//
// It sits beside `CoordBanner` on `/runs` and copies that component's shape —
// injectable props defaulting to the `api` singleton, and a render gate that
// shows NOTHING rather than a guess. The gate matters for the same reason it
// does there: "the caps could not be read" and "the caps are zero" are
// different facts, and rendering a number for the first would be a guess
// wearing a measurement's typeface.
//
// ONE DELIBERATE DEPARTURE from the pause toggle. That toggle refuses to be
// optimistic and settles only when a later `{type:'coord'}` frame reports the
// value it asked for. No frame carries caps — deliberately, because `emitCoord`
// touches no `node:sqlite` and `dispatchedIn24h` moves with the clock — so this
// control settles on the RESPONSE BODY, which is the stored value re-read by the
// route. It still never settles on what was TYPED: the server is the authority
// on what it stored, and a request for 9 answered with 4 renders 4.
//
// NO TIMERS OF ANY KIND. `runs-screen.test.tsx`'s cadence pin measures
// `useNow` as the only `setInterval` in this screen's whole tree and names each
// sibling that runs none — this component among them (D-1217: that sentence was
// written here BEFORE the list over there had been re-measured to include it,
// which is the shape of claim this wave keeps finding). A polling readout here
// would silently corrupt the dispatch-window cadence assertions, and note that
// the instrument would not catch one armed after the caps read resolves: it
// reads its spy straight after a synchronous mount, when this component still
// renders `null`.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { CoordCaps, CoordCapsView } from '../../../shared/api';
import { ApiError, api, apiErrorText } from '../lib/api';
import './fleet.css';

/** What the operator has typed but not yet saved, per field. `null` means
 *  untouched — distinct from `''` (cleared) and from a number, so a save can
 *  send ONLY the dials that were actually moved and cannot clobber the other
 *  with a value the operator never chose. */
type Draft = { workers: string | null; perDay: string | null };

/** The three things the strip can be saying, kept apart on purpose. `saved` is
 *  not a state here — a successful write simply re-renders the new numbers,
 *  which is the confirmation. */
type Note =
  | { kind: 'none' }
  | { kind: 'refused'; text: string }
  /** The write may HAVE landed; the answer could not be read (D-1150). Saying
   *  "failed" here would be a lie the operator acts on by retrying. */
  | { kind: 'unconfirmed' };

/** What a click on `save` turns out to mean. Three OUTCOMES, not a partial plus
 *  a convention (D-1220/D-1221): "send this", "the operator moved nothing" and
 *  "one of the boxes does not hold a number" are three different things a caller
 *  handles three different ways, and an empty `Partial<CoordCaps>` collapsed the
 *  first two while `Number('')` silently turned the third into a request to
 *  store 0. That is the overloaded seam this tree bans by name, in a component. */
type SaveIntent =
  | { kind: 'send'; body: Partial<CoordCaps> }
  | { kind: 'nothing' }
  | { kind: 'unparsed'; text: string };

/** WHERE THE LINE FALLS between this control and the route, because the
 *  temptation is to move it. The control decides what the operator ASKED FOR;
 *  the route decides whether the ask is allowed. "Is this box a number at all"
 *  is the first question — a blank box is not an ask for zero, and reading it as
 *  one invents a value nobody typed. Bounds and integer-ness are the second, and
 *  they stay server-side: 99 and 1.5 are SENT, and the refusal that comes back
 *  names the field and the bounds in the route's own words rather than in a
 *  second copy of the policy kept here. */
const readDraft = (draft: Draft, caps: CoordCaps): SaveIntent => {
  const body: Partial<CoordCaps> = {};
  const fields: [label: string, typed: string | null, stored: number, key: keyof CoordCaps][] = [
    ['workers', draft.workers, caps.maxConcurrentWorkers, 'maxConcurrentWorkers'],
    ['per day', draft.perDay, caps.maxSessionsPerDay, 'maxSessionsPerDay'],
  ];
  for (const [label, typed, stored, key] of fields) {
    if (typed === null) continue;                       // untouched — not an ask
    const n = Number(typed);
    if (typed.trim() === '' || !Number.isFinite(n)) {
      return { kind: 'unparsed', text: `${label} is not a number — nothing was sent` };
    }
    if (n !== stored) body[key] = n;
  }
  return Object.keys(body).length === 0 ? { kind: 'nothing' } : { kind: 'send', body };
};

/** The route's own `detail` is the message: it names the field and the bounds,
 *  and re-deriving that sentence here would be a second copy of the policy. */
function refusalText(err: unknown): string {
  if (err instanceof ApiError && err.status === 400) {
    const body = err.body as { detail?: unknown } | null;
    if (typeof body?.detail === 'string') return body.detail;
  }
  return apiErrorText(err);
}

export function CapsControl({
  coordCaps = api.coordCaps,
  setCoordCaps = api.setCoordCaps,
}: {
  /** Injectable so a test can drive the control without a server — the same
   *  shape `CoordBanner`'s own `coordPause` prop uses. */
  coordCaps?: () => Promise<CoordCapsView>;
  setCoordCaps?: (next: Partial<CoordCaps>) => Promise<CoordCapsView | 'unreadable'>;
} = {}): ReactNode {
  const [view, setView] = useState<CoordCapsView | null>(null);
  const [draft, setDraft] = useState<Draft>({ workers: null, perDay: null });
  const [note, setNote] = useState<Note>({ kind: 'none' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    // A FAILED read renders nothing — 501 on a box with no coordination
    // database, and anything else too. There is no honest number to show.
    coordCaps().then((v) => { if (live) setView(v); }, () => { /* stays null */ });
    return () => { live = false; };
  }, [coordCaps]);

  if (view === null) return null;

  const onSave = (): void => {
    const intent = readDraft(draft, view.caps);
    // A BOX THAT HOLDS NO NUMBER (D-1221). Said here rather than sent, because
    // the alternative is to send a value the operator never chose.
    if (intent.kind === 'unparsed') { setNote({ kind: 'refused', text: intent.text }); return; }
    // Nothing moved: the route would refuse an empty body, and spending a round
    // trip to be told so would be the control's bug, not the operator's.
    //
    // THE NOTE IS CLEARED FIRST (D-1220). This return used to sit ABOVE the
    // clear, and the draft is deliberately not reset on a refusal — so an
    // operator correcting a rejected field back to its stored value got no
    // request (right) and kept the refusal on screen (wrong), told their input
    // was invalid at the moment it became valid again.
    if (intent.kind === 'nothing') { setNote({ kind: 'none' }); return; }
    setBusy(true);
    setNote({ kind: 'none' });
    setCoordCaps(intent.body).then(
      (answer) => {
        setBusy(false);
        if (answer === 'unreadable') { setNote({ kind: 'unconfirmed' }); return; }
        setView(answer);
        setDraft({ workers: null, perDay: null });
      },
      (err: unknown) => { setBusy(false); setNote({ kind: 'refused', text: refusalText(err) }); },
    );
  };

  const field = (
    label: string, id: string, value: string, used: number, cap: number,
    onChange: (v: string) => void,
  ): ReactNode => (
    <span className="caps-field">
      <label className="caps-label" htmlFor={id}>{label}</label>
      <input
        id={id} className="caps-input" type="number" inputMode="numeric"
        value={value} disabled={busy} onChange={(e) => onChange(e.target.value)}
      />
      {/* Usage against the cap, as one reading — the number an operator acts
          on is the pair, never either half alone. */}
      <span className="caps-usage">{used} / {cap}</span>
    </span>
  );

  return (
    <div className="caps-control" role="group" aria-label="coordination caps">
      {field('workers', 'caps-workers',
        draft.workers ?? String(view.caps.maxConcurrentWorkers),
        view.usage.running, view.caps.maxConcurrentWorkers,
        (v) => setDraft((d) => ({ ...d, workers: v })))}
      {field('per day', 'caps-per-day',
        draft.perDay ?? String(view.caps.maxSessionsPerDay),
        view.usage.dispatchedIn24h, view.caps.maxSessionsPerDay,
        (v) => setDraft((d) => ({ ...d, perDay: v })))}
      <button type="button" className="caps-save" disabled={busy} onClick={onSave}>
        {busy ? 'saving…' : 'save'}
      </button>
      {/* ONE note element, ALWAYS mounted, and it is the live region (D-1222).
          Always mounted because a `role="status"` inserted at the same moment its
          text appears is announced unreliably; the region has to exist first and
          have its contents change. `.caps-note:empty` collapses it to nothing
          visually WITHOUT `display: none`, which would take it back out of the
          accessibility tree and undo the point. This is the whole of the
          control's feedback — no toast, no banner, and a successful write just
          re-renders numbers — so outside a live region a screen-reader user
          learns nothing at the one moment they have just committed to a save. */}
      <p className="caps-note" role="status">
        {note.kind === 'refused' ? note.text
          : note.kind === 'unconfirmed'
            ? 'unconfirmed — the answer could not be read; reload to see what was stored'
            : ''}
      </p>
    </div>
  );
}
