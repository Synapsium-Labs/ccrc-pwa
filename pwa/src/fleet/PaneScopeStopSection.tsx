// D-7902: Settings › Automation › "Stop leftovers", the switch that arms a deliberate stop's pane-scope stop. It ships in
// shadow; nothing here arms it but an operator's tap.
//
// Its read is the coord frame (`paneScopeStopMarker`), so the card keeps Cleanup pause's conventions: a skeleton until the
// first frame; a server older than the switch reads not available; the checked radio is the frame's reading, never the
// tap, and `unmeasurable` checks neither. Its write is `POST /api/coord/pane-scope-stop`, which answers `requested`, so a
// tap settles only on a later frame reading what it asked, and `COORD_CONFIRM_MS` bounds the wait. The radios are
// `DispatchAbandonSection`'s, with the write's answer on a line under them. Nothing branches on the viewer's screen.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Section, Skeleton } from '@ccrc/ui';
import type { MarkerState } from '../../../shared/api';
import { ApiError, api, apiErrorText } from '../lib/api';
import { COORD_UNSUPPORTED_TEXT } from '../lib/refusalWords';
import { isRecord } from '../lib/wire';
import { useFleetStore } from '../stores/fleet';
import { COLLECT_SECTION_TEXT } from './collectLaneWords';
import { COORD_CONFIRM_MS } from './coordWords';
import {
  PANE_SCOPE_STOP_TEXT, isPaneScopeStopRefusal, paneScopeStopChecked, paneScopeStopMarker, type PaneScopeStopState,
} from './paneScopeStopWords';
import {
  NotedRadioSet, ResultLine, SETTINGS_AMBER_NOTE, SETTINGS_CARDS, SETTINGS_WHEN, UNCONFIRMED_TEXT, useResultLine,
} from './settingsText';

const T = PANE_SCOPE_STOP_TEXT;

export function PaneScopeStopSection({ store = useFleetStore }: { store?: typeof useFleetStore }): ReactNode {
  const coord = store((s) => s.coord);
  const coordFrameSeen = store((s) => s.coordFrameSeen);
  const marker = paneScopeStopMarker(coord);
  const card = SETTINGS_CARDS.automation.paneScopeStop;
  return (
    <Section level={3} scope={card.scope} title={card.title} purpose={card.purpose}>
      {!coordFrameSeen ? (
        <Skeleton lines={2} />
      ) : marker === null ? (
        <p className="settings-note">{COLLECT_SECTION_TEXT.notAvailable}</p>
      ) : (
        <PaneScopeStopBody marker={marker} />
      )}
    </Section>
  );
}

/** A write's rejection, as its line: the route's own refusal moved nothing; anything else proves nothing about the write. */
function failureLine(err: unknown): { text: string; tone: 'refusal' | 'answer' } {
  if (!(err instanceof ApiError)) return { text: T.unanswered, tone: 'answer' };
  const body = isRecord(err.body) ? err.body : {};
  const said = typeof body.detail === 'string' && body.detail.trim() !== '' ? body.detail.trim() : apiErrorText(err);
  const detail = err.status === 501 ? COORD_UNSUPPORTED_TEXT : said;
  return isPaneScopeStopRefusal(body.error)
    ? { text: `${T.refused} (${detail})`, tone: 'refusal' }
    : { text: `${T.unanswered} (${detail})`, tone: 'answer' };
}

function PaneScopeStopBody({ marker }: { marker: MarkerState }): ReactNode {
  const [asked, setAsked] = useState<PaneScopeStopState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const line = useResultLine();

  const clearTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  // A NEW reading retires any line about the old one; only the reading a tap asked for settles that tap.
  useEffect(() => {
    line.clear();
    if (paneScopeStopChecked(marker) === asked) {
      clearTimer();
      setAsked(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker]);

  useEffect(() => clearTimer, []);

  const choose = (state: PaneScopeStopState): void => {
    if (asked !== null) return;   // the disabled fieldset stops a finger; this stops a second call
    line.clear();
    setAsked(state);
    timer.current = setTimeout(() => {
      timer.current = null;
      setAsked(null);
      line.say(T.unconfirmed);
    }, COORD_CONFIRM_MS);
    void api.setPaneScopeStop(state).then(
      (answer) => { if (answer === 'unreadable') line.say(UNCONFIRMED_TEXT); },
      (err: unknown) => {
        clearTimer();
        setAsked(null);
        const failed = failureLine(err);
        line.say(failed.text, failed.tone);
      },
    );
  };

  return (
    <>
      {marker === 'unmeasurable' && <p className={SETTINGS_AMBER_NOTE}>{T.unmeasurable}</p>}
      <NotedRadioSet<PaneScopeStopState>
        legend={T.legend}
        name="settings-pane-scope-stop"
        value={paneScopeStopChecked(marker)}
        disabled={asked !== null}
        onPick={choose}
        options={[
          { value: 'shadow', label: T.shadow, note: T.shadowNote },
          { value: 'live', label: T.live, note: T.liveNote },
        ]}
      />
      {asked !== null && <p className="settings-note" role="status">{T.asked}</p>}
      <ResultLine line={line.line} />
      <p className={SETTINGS_WHEN}>{T.when}</p>
    </>
  );
}
