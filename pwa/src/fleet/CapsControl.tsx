// The operator's dial on the two coordination caps (spec §8, D-1158). Before it
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
// sibling that runs none; a polling readout here would silently corrupt the
// dispatch-window cadence assertions.
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

const asPartial = (draft: Draft, caps: CoordCaps): Partial<CoordCaps> => {
  const out: Partial<CoordCaps> = {};
  if (draft.workers !== null && Number(draft.workers) !== caps.maxConcurrentWorkers) {
    out.maxConcurrentWorkers = Number(draft.workers);
  }
  if (draft.perDay !== null && Number(draft.perDay) !== caps.maxSessionsPerDay) {
    out.maxSessionsPerDay = Number(draft.perDay);
  }
  return out;
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
    const next = asPartial(draft, view.caps);
    // Nothing moved: the route would refuse an empty body, and spending a round
    // trip to be told so would be the control's bug, not the operator's.
    if (Object.keys(next).length === 0) return;
    setBusy(true);
    setNote({ kind: 'none' });
    setCoordCaps(next).then(
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
      {note.kind === 'refused' && <p className="caps-note">{note.text}</p>}
      {note.kind === 'unconfirmed' && (
        <p className="caps-note">unconfirmed — the answer could not be read; reload to see what was stored</p>
      )}
    </div>
  );
}
