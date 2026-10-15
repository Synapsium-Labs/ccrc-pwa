// The Settings screen's Temp root collector section (path-identity spec 2026-10-12 §5.7; child-reclamation wave 10).
// It shows what arms the temp-root collector's deletion, and the one choice that moves it. It reads its OWN endpoint,
// GET /api/coord/collect-lane, through `useCollectLaneView`, and is mounted after Stall watch.
//
// Five rules this file keeps, each pinned in collect-lane-section.test.tsx:
//   * NOT AVAILABLE WINS. A 501 not-configured, or the 404 not-found an older server answers, replaces the whole
//     body with "Not available on this server." and nothing else, even over a view that landed before: after a
//     rollback to a build without the route, a Live radio must not stay checked.
//   * AN UNMEASURABLE STATE IS A STOP, NEVER A CHOICE. A read answered 503 state-unmeasurable (no stored row) draws
//     `collectUnmeasurableLines`: the Safety-stopped Now line and the server's detail. It offers no radio.
//   * THE SERVER'S ANSWER IS WHAT IS SHOWN. The checked radio is the stored choice the server read, never the tap,
//     and only while control is coherent: a stored token this build does not know, or a row the journal disagrees
//     with, checks neither, so Off stays a tap that can repair a mismatch once the latch is set (spec §5.6). A write
//     settles its reply; a refused, unconfirmed or unreadable write re-reads.
//   * THE SERVER DECIDES THE CONFIRM. Live goes out as {choice:'live'} with no key. A 409 confirm-required or
//     confirm-stale opens the sheet from the facts the server measured, and Set sends the server's key. Off before
//     the legacy file's retirement is disabled, with `collectOffNote`'s note, because the server refuses it.
//   * THE PWA COUNTS NOTHING. The Now lines, the counts line and every warn line come from the view through
//     `collectLaneWords.ts`. Nothing here switches on an attention word or names the legacy file, and nothing
//     branches on the viewer's screen or pointer.
//
// "Pause all cleanup" raises the one cleanup pause (POST /api/coord/reclaim-pause), the way ChildReclaimBanner does.
// It renders nothing before a coord frame, is never optimistic, and settles on a later frame. It offers Pause only:
// Resume stays on the cleanup row on Runs, so the switch keeps one resume door. Nothing here announces the stored
// choice anywhere else.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  COLLECT_LANE_CHOICES, type CollectLaneChoice, type CollectLaneConfirmRequired, type CollectLaneRequest,
  type CollectLaneView,
} from '../../../shared/api';
import { Button, QuickConfirm, RADIO_FIELDSET, RADIO_LEGEND, Radio, Skeleton, toast, useNow } from '@ccrc/ui';
import { api, apiErrorText } from '../lib/api';
import { SETTINGS_AMBER_NOTE, SETTINGS_NOW_CLASS, UNCONFIRMED_TEXT } from '../screens/settingsText';
import { useFleetStore } from '../stores/fleet';
import { childReclaimMarker } from './childReclaimWords';
import { inlinePauseError } from './CoordBanner';
import { COORD_CONFIRM_MS } from './coordWords';
import {
  COLLECT_PAUSE_TEXT, COLLECT_REFUSAL_TEXT, COLLECT_SECTION_TEXT, collectConfirmLines, collectCountLine,
  collectNowLines, collectOffNote, collectOffersReconfirm, collectUnmeasurableLines,
} from './collectLaneWords';
import { asCollectLaneView, collectLanePostRefusal, useCollectLaneView, type CollectLanePoll } from './useCollectLaneView';
import './fleet.css';

// This file has no words of its own. Every line it renders, the legend, the radio labels, the read and write lines
// and the pause control's passing labels included, is `collectLaneWords.ts`'s (`COLLECT_SECTION_TEXT`,
// `COLLECT_PAUSE_TEXT` and the line builders), read by its exported name and never retyped.

const NOW_CLASS: Readonly<Record<'head' | 'note' | 'warn', string>> = SETTINGS_NOW_CLASS;

type CleanupPause = (state: 'on' | 'off') => Promise<void>;

/** The section: its heading, then one of five bodies. Not-available comes FIRST, before any landed view; an
 *  unmeasurable state comes next and is a stop; "don't know yet" never borrows "nothing there". */
export function CollectLaneSection({
  store = useFleetStore,
  childReclaimPause = api.childReclaimPause,
  pollMs,
}: {
  store?: typeof useFleetStore;
  /** Injectable so a test drives "Pause all cleanup" without a server: ChildReclaimBanner's seam. */
  childReclaimPause?: CleanupPause;
  /** The read's cadence: `useCollectLaneView`'s default when absent, its injected mode at `<= 0`. */
  pollMs?: number;
} = {}): ReactNode {
  const titleId = useId();
  const poll = useCollectLaneView(pollMs);
  const { view, failure } = poll;
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">{COLLECT_SECTION_TEXT.title}</h2>
      {failure !== null && failure.kind === 'not-configured' ? (
        <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : failure !== null && failure.kind === 'state-unmeasurable' ? (
        <>
          {collectUnmeasurableLines(failure.detail).map((line, i) => <p key={i} className={NOW_CLASS[line.tone]}>{line.text}</p>)}
          <PauseAllCleanup store={store} childReclaimPause={childReclaimPause} />
        </>
      ) : view !== null ? (
        <CollectLaneBody view={view} stale={failure !== null} poll={poll} store={store} childReclaimPause={childReclaimPause} />
      ) : failure !== null ? (
        <p className="settings-note">{COLLECT_SECTION_TEXT.unread}</p>
      ) : (
        <Skeleton lines={3} />
      )}
    </section>
  );
}

function CollectLaneBody({ view, stale, poll, store, childReclaimPause }: {
  view: CollectLaneView; stale: boolean; poll: CollectLanePoll; store: typeof useFleetStore; childReclaimPause: CleanupPause;
}): ReactNode {
  const { reload, settle } = poll;
  const offNoteId = useId();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<CollectLaneConfirmRequired | null>(null);
  const [inline, setInline] = useState<string | null>(null);
  const now = useNow(30_000, pending !== null);   // the sheet's freshness, live only while it is open
  const locked = busy || pending !== null;

  // A NEWER view retires an inline refusal about the older one: a poll's answer or the re-read after the refusal is
  // what the server now says, and its Off note speaks for the latch. A refusal is set in a render whose view has not
  // changed, so this never clears it in the render that first shows it; a read that did not land keeps the view, and
  // with it the refusal.
  useEffect(() => {
    setInline(null);
  }, [view]);

  // `confirm` only as the key the server sent. Every answer is the server's:
  // - A reply that reads is settled.
  // - A 2xx the guard cannot read was answered and may have landed: UNCONFIRMED_TEXT, then a re-read.
  // - A 409 the reader takes as a confirm opens the sheet.
  // - Off refused before the latch is shown inline under the choice, until a newer view lands.
  // - Any other refusal, one carrying a code this build knows, is toasted, its words with the server's detail beside
  //   them, then re-read.
  // - A rejection that never reached an answer, or an answer with no code this build knows, may have stored the
  //   choice, so it gets its own line, with the answer's detail when there was one, then the same re-read.
  const write = (request: CollectLaneRequest): void => {
    setBusy(true);
    setInline(null);
    void api.setCollectLane(request)
      .then(
        (answer) => {
          const reply = answer === 'unreadable' ? null : asCollectLaneView(answer);
          if (reply !== null) {
            settle(reply);
            return;
          }
          toast(UNCONFIRMED_TEXT);
          reload();
        },
        (err: unknown) => {
          const refusal = collectLanePostRefusal(err);
          if (refusal.kind === 'confirm') {
            setPending(refusal.confirm);
            return;
          }
          if (refusal.kind === 'unconfirmed') {
            toast(refusal.detail === null
              ? COLLECT_SECTION_TEXT.unanswered
              : `${COLLECT_SECTION_TEXT.unanswered} (${refusal.detail})`);
          } else if (refusal.code === 'marker-still-controls') {
            setInline(COLLECT_REFUSAL_TEXT['marker-still-controls']);
          } else {
            toast(`${COLLECT_REFUSAL_TEXT[refusal.code]} (${refusal.detail})`, 'error');
          }
          reload();
        },
      )
      .finally(() => { setBusy(false); });
  };
  const choose = (choice: CollectLaneChoice): void => {
    if (!locked) write({ choice });   // the disabled fieldset stops a finger; this stops a second call
  };

  // A radio is checked only under coherent control. A mismatch's stored choice is not what the lane runs on, and a
  // radio already checked fires no change: with `off` stored, Off could never be sent to repair the mismatch
  // (path-identity spec §5.6: Off may repair it once the latch permits Off).
  const stored = view.stored.read === 'row' && view.control.state === 'coherent' ? view.stored.choice : null;
  const offHeld = view.marker.latch !== 'set';   // Off is refused before the latch, whatever the listing says
  const offNote = collectOffNote(view);

  return (
    <>
      {stale && <p className={SETTINGS_AMBER_NOTE}>{COLLECT_SECTION_TEXT.stale}</p>}
      {collectNowLines(view).map((line, i) => <p key={i} className={NOW_CLASS[line.tone]}>{line.text}</p>)}
      {view.notice !== null && <p className="settings-note" role="status">{view.notice}</p>}
      <p className="settings-note">{collectCountLine(view.attention)}</p>
      <fieldset className={RADIO_FIELDSET} disabled={locked}>
        <legend className={RADIO_LEGEND}>{COLLECT_SECTION_TEXT.legend}</legend>
        {COLLECT_LANE_CHOICES.map((c) => {
          const held = c === 'off' && offHeld;
          return (
            <Radio
              key={c}
              name="settings-collect-lane"
              value={c}
              checked={stored === c}
              disabled={held}
              aria-describedby={held && offNote !== null ? offNoteId : undefined}
              onChange={() => choose(c)}
            >
              {COLLECT_SECTION_TEXT[c]}
            </Radio>
          );
        })}
      </fieldset>
      {offHeld && offNote !== null && <p id={offNoteId} className="settings-note">{offNote}</p>}
      {inline !== null && <p className={SETTINGS_AMBER_NOTE} role="alert">{inline}</p>}
      {collectOffersReconfirm(view) && (
        <Button
          variant="ghost"
          className="settings-check"
          disabled={locked}
          onClick={() => { if (!locked) write({ choice: 'live' }); }}
        >
          {COLLECT_SECTION_TEXT.reconfirm}
        </Button>
      )}
      <PauseAllCleanup store={store} childReclaimPause={childReclaimPause} />
      <QuickConfirm
        open={pending !== null}
        title={COLLECT_SECTION_TEXT.confirmTitle}
        consequence={pending === null ? [] : collectConfirmLines(pending.facts, pending.error === 'confirm-stale', now)}
        confirmLabel={COLLECT_SECTION_TEXT.confirmLabel}
        onConfirm={() => { if (pending !== null) write({ choice: 'live', confirm: pending.confirmKey }); }}
        onClose={() => setPending(null)}
      />
    </>
  );
}

type PausePhase = 'idle' | 'pausing' | 'unconfirmed';

/** "Pause all cleanup": ChildReclaimBanner's toggle, Pause direction only. It renders nothing before a coord frame
 *  or for a server older than the switch (`childReclaimMarker` → null). While the pause stands it shows only the
 *  paused line. A tap asks 'on' once and settles only on a LATER frame reading `set`; `COORD_CONFIRM_MS` bounds the
 *  wait. A switch that reads `unmeasurable` still offers Pause: doubt fails toward stopping deletion. */
function PauseAllCleanup({ store, childReclaimPause }: { store: typeof useFleetStore; childReclaimPause: CleanupPause }): ReactNode {
  const coord = store((s) => s.coord);
  const coordFrameSeen = store((s) => s.coordFrameSeen);
  const marker = childReclaimMarker(coord);
  const [phase, setPhase] = useState<PausePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // A NEW reading of the cleanup switch retires an inline refusal about the old one. Only `set`, the value a tap here
  // asks for, settles the tap.
  useEffect(() => {
    setError(null);
    if (marker === 'set') {
      clearTimer();
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker]);

  useEffect(() => () => clearTimer(), []);

  if (!coordFrameSeen || coord === null || marker === null) return null;
  if (marker === 'set') return <p className="settings-note" role="status">{COLLECT_PAUSE_TEXT.paused}</p>;

  const onPause = (): void => {
    if (phase === 'pausing') return;
    setError(null);
    setPhase('pausing');
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setPhase('unconfirmed');
    }, COORD_CONFIRM_MS);
    childReclaimPause('on').catch((err: unknown) => {
      clearTimer();
      setPhase('idle');
      const shown = inlinePauseError(err);
      if (shown !== null) {
        setError(shown);
        return;
      }
      toast(apiErrorText(err), 'error');
    });
  };

  const label = phase === 'pausing' ? COLLECT_PAUSE_TEXT.pausing
    : phase === 'unconfirmed' ? COLLECT_PAUSE_TEXT.unconfirmed
    : COLLECT_PAUSE_TEXT.label;

  return (
    <>
      <p className="settings-note">{COLLECT_PAUSE_TEXT.stops}</p>
      <Button variant="ghost" className="settings-check" disabled={phase === 'pausing'} onClick={onPause}>
        {label}
      </Button>
      {error !== null && <p className={SETTINGS_AMBER_NOTE}>{error}</p>}
    </>
  );
}
