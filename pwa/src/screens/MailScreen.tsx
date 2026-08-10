// The fleet-wide feed — the first surface in this app to render what the
// server recorded rather than what the fleet currently is.
//
// Two sources, one list (lib/feed.ts): `GET /api/feed` is the durable read that
// survives a deploy, and the catch-up response on every socket open is the live
// tail, which is volatile by construction — notifymark.ts advances the mark
// one-way at receipt, so a caller that stores those events without rendering
// them has silently dropped them. This is the renderer that docstring was
// waiting for.
//
// Opening this screen IS the ack, the same rule SessionScreen's mount ack
// follows. One watermark for the whole feed (FEED_ACK_KEY), because "have I
// read my mail" is one question, not one per sender.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { NotifyEvent } from '../../../shared/api';
import { recordKey, reviveNotifyEvents } from '../lib/feed';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { ack, acksSnapshot, FEED_ACK_KEY, isUnseenAt, subscribeAcks } from '../lib/seen';
import { useNow } from '../lib/useNow';
import { formatAge } from '../fleet/formatReset';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import '../fleet/fleet.css';

/** The shipping default — `GET /api/feed?limit=100` — hoisted to MODULE
 *  scope rather than an inline arrow used as a default PARAMETER value. A
 *  default parameter is re-evaluated on every call to the function
 *  component, so an inline `() => api.feed(100)` is a fresh identity on
 *  every render, not a stable one. That identity used to sit in the effect
 *  below's own dependency array, and `mergeFeed` -> `mergeBySeq`
 *  (`lib/feed.ts`) allocates a fresh `feed` array even for a no-op merge —
 *  so every render re-minted this default, the effect's deps compared
 *  unequal, and it tore down and re-fired: an unbounded `GET /api/feed` loop
 *  for as long as this screen stayed mounted. (Fix round 1, Task 4, findings
 *  1 and 3 — reachable only on the real default path, which is why no
 *  shipped test caught it: every one supplied its own stable `loadFeed`.) */
const loadFeedDefault = (): Promise<{ events: NotifyEvent[] }> => api.feed(100);

/** The feed's own small vocabulary. Deliberately NOT NotifyEvent['kind']
 *  rendered raw: `merged` is a git word, `run` is a noun the board owns, and
 *  `unknown` has to read as an honest answer rather than as a bug. */
const KIND_WORD: Record<NotifyEvent['kind'], string> = {
  mail: 'mail', run: 'run', ask: 'asked', done: 'finished', merged: 'merged', unknown: 'unknown',
};
const KIND_GLYPH: Record<NotifyEvent['kind'], string> = {
  mail: '✉', run: '⟳', ask: '?', done: '✓', merged: '⑂', unknown: '·',
};

export function MailScreen({
  store = useFleetStore,
  loadFeed = loadFeedDefault,
}: {
  store?: FleetStore;
  loadFeed?: () => Promise<{ events: NotifyEvent[] }>;
}): ReactNode {
  const feed = store((s) => s.feed);
  const dropped = store((s) => s.feedDropped);
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  const now = useNow(30_000);

  // Held in a ref, not the effect's own dependency array below: "once per
  // mount" has to hold regardless of the CALLER's identity discipline, not
  // only the hoisted default's — a prop minted fresh on every render (an
  // inline arrow passed by a future caller, say) must not be able to restart
  // this either. The ref always reads the LATEST `loadFeed` without ever
  // being a reason for the effect to re-run.
  const loadFeedRef = useRef(loadFeed);
  loadFeedRef.current = loadFeed;

  // The durable read, once per mount — now actually once: keyed on `[store]`
  // alone, so a merge-induced re-render (mergeFeed -> mergeBySeq always
  // allocates a fresh `feed` array, even for a no-op merge) cannot restart
  // it. Revived rather than trusted: `CatchUp` has been consumed by a bare
  // getJson since it shipped, and a kind from a newer server reaching an old
  // client typed as one of three things it is not is exactly what that
  // bareness costs.
  useEffect(() => {
    let live = true;
    void loadFeedRef.current()
      .then((r) => {
        if (!live) return;
        const { events, dropped: d } = reviveNotifyEvents(r.events);
        store.getState().mergeFeed(events, d);
      })
      .catch(() => { /* offline, or an older server with no such route */ });
    return () => { live = false; };
  }, [store]);

  // Opening the screen is the ack. Floored to the newest record's own instant
  // (seen.ts's `stampFor`) so a device behind the fleet host's clock does not
  // ack into the past and leave the badge stuck.
  const newest = feed.length > 0 ? feed[feed.length - 1]!.at : null;
  useEffect(() => {
    if (newest !== null) ack(FEED_ACK_KEY, Date.now(), newest);
  }, [newest]);

  const rows = [...feed].reverse();   // newest first on screen; oldest-first in the store
  const nowSec = Math.floor(now / 1000);

  return (
    <div className="mail-screen">
      <header className="mail-head">
        <button type="button" className="mail-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="mail-title">Mail</h1>
      </header>

      {/* The presence-gate asymmetry, said once and permanently. A record is
          written whatever the operator was looking at; only the phone ping is
          held back for a session already on screen. Prose, so it is sans. */}
      <p className="mail-note">
        Records land here whether or not you were watching — only the phone ping is held back for a
        session you already have open.
      </p>

      {dropped > 0 && (
        <p className="mail-dropped" role="status">
          {dropped} records this build could not read — they are still on the server.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mail-empty">Nothing yet.</p>
      ) : (
        <ul className="mail-list">
          {rows.map((ev) => (
            <li
              key={recordKey(ev)}
              className="mail-row"
              data-unseen={isUnseenAt(FEED_ACK_KEY, ev.at, acks) ? 'true' : 'false'}
            >
              <span className="mail-kind">
                <span className="mail-kind-glyph" aria-hidden="true">{KIND_GLYPH[ev.kind]}</span>
                {KIND_WORD[ev.kind]}
              </span>
              <span className="mail-row-title">{ev.title}</span>
              <span className="mail-when">{formatAge(nowSec - Math.floor(ev.at / 1000))}</span>
              {ev.body !== '' && <p className="mail-body">{ev.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
