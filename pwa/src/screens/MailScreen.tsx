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
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { NotifyEvent, RunSummary } from '../../../shared/api';
import { eventRunId, recordKey, reviveNotifyEvents } from '../lib/feed';
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

/** The programme titles the headers are built from. `api.runs(true)` — WITH
 *  closed runs — because a feed record outlives its run: a wave that finished
 *  yesterday still has its records on this screen, and the active-only default
 *  would leave every one of them unresolved. Hoisted to module scope for
 *  `loadFeedDefault`'s own reason (a default parameter expression is re-minted
 *  on every render, and an effect keyed on that identity never stops firing). */
const loadRunsDefault = (): Promise<{ runs: RunSummary[] }> => api.runs(true);

/** The feed's own small vocabulary. Deliberately NOT NotifyEvent['kind']
 *  rendered raw: `merged` is a git word, `run` is a noun the board owns, and
 *  `unknown` has to read as an honest answer rather than as a bug. */
const KIND_WORD: Record<NotifyEvent['kind'], string> = {
  mail: 'mail', run: 'run', ask: 'asked', done: 'finished', merged: 'merged',
  coord: 'config', unknown: 'unknown',
};
const KIND_GLYPH: Record<NotifyEvent['kind'], string> = {
  mail: '✉', run: '⟳', ask: '?', done: '✓', merged: '⑂', coord: '⚙', unknown: '·',
};

export function MailScreen({
  store = useFleetStore,
  loadFeed = loadFeedDefault,
  loadRuns = loadRunsDefault,
}: {
  store?: FleetStore;
  loadFeed?: () => Promise<{ events: NotifyEvent[] }>;
  loadRuns?: () => Promise<{ runs: RunSummary[] }>;
}): ReactNode {
  const feed = store((s) => s.feed);
  const dropped = store((s) => s.feedDropped);
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  const now = useNow(30_000);
  // Review finding 19: this screen's own read failing must not render as
  // "Nothing yet." — a positive claim about the fleet's record — when the
  // truth is "could not read". `feed` itself can already be non-empty on
  // mount now (`stores/fleet.ts`'s own durable connect-time read, fix
  // finding 18), so the distinction only matters for the empty-list render
  // below; a non-empty `feed` always renders its rows regardless of this
  // screen's own read outcome.
  const [readState, setReadState] = useState<'loading' | 'ok' | 'error'>('loading');

  // `null` is All. Keyed on the GROUP KEY, never on the head text: two
  // programmes may share a title, and a title is prose that can change under a
  // filter that is already set.
  const [filter, setFilter] = useState<string | null>(null);

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
        setReadState('ok');
      })
      .catch(() => { if (live) setReadState('error'); });
    return () => { live = false; };
  }, [store]);

  // The programme titles. A SEPARATE read from the feed's, and a failure here is
  // not a failure of this screen: the records still render, under headers that
  // say the programme was not measured. Never merged into the feed's own
  // promise — one failing read must not take the other's data with it.
  const [runsById, setRunsById] = useState<ReadonlyMap<number, RunSummary>>(new Map());
  const loadRunsRef = useRef(loadRuns);
  loadRunsRef.current = loadRuns;
  useEffect(() => {
    let live = true;
    void loadRunsRef.current()
      .then((r) => {
        if (!live) return;
        setRunsById(new Map(r.runs.map((run) => [run.id, run] as const)));
      })
      .catch(() => { /* the headers degrade; the feed does not */ });
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

  // THREE kinds of key, because there are three facts (spec §4, and the
  // no-overloaded-null rule): a record that names a run this read resolved; a
  // record that names a run it did not; and a record that names no run at all.
  // The middle one is not the last one — it says "I could not measure", not
  // "there is nothing to measure" — and a reader who cannot tell them apart
  // cannot tell a rebuilt database from an ask.
  const groupOf = (ev: NotifyEvent): { key: string; head: string } => {
    const runId = eventRunId(ev);
    if (runId === null) return { key: 'none', head: 'Not part of a programme' };
    const run = runsById.get(runId);
    return run === undefined
      ? { key: `run:${runId}`, head: `run ${runId} — programme not measured` }
      : { key: `program:${run.program}`, head: run.programTitle };
  };
  // First-appearance order, so the groups read newest-first exactly as the flat
  // list did. A Map preserves insertion order; nothing is sorted here, because
  // any sort would be this screen inventing an order the feed does not have.
  const groups = new Map<string, { head: string; rows: NotifyEvent[] }>();
  for (const ev of rows) {
    const { key, head } = groupOf(ev);
    const g = groups.get(key);
    if (g) g.rows.push(ev);
    else groups.set(key, { head, rows: [ev] });
  }
  const shown = [...groups].filter(([key]) => filter === null || key === filter);

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

      {groups.size > 1 && (
        <div className="mail-filter" role="group" aria-label="filter by programme">
          <button
            type="button"
            className="mail-chip"
            data-on={filter === null || undefined}
            aria-pressed={filter === null}
            onClick={() => setFilter(null)}
          >
            All
          </button>
          {[...groups].map(([key, g]) => (
            <button
              key={key}
              type="button"
              className="mail-chip"
              data-on={filter === key || undefined}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {g.head}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 && readState !== 'ok' ? (
        // Review finding 19: "loading" and "every attempt has failed" get
        // their own honest render — `readState === 'error'` only fires once
        // this screen's own read has actually failed, never merely because
        // it has not resolved yet.
        <p className="mail-empty" data-state={readState === 'error' ? 'error' : 'loading'}>
          {readState === 'error' ? 'Could not reach the server — mail may exist that is not shown.' : 'Loading…'}
        </p>
      ) : rows.length === 0 ? (
        <p className="mail-empty" data-state="ok">Nothing yet.</p>
      ) : (
        <>
          {shown.map(([key, g]) => (
            <div key={key} className="mail-group">
              <p className="mail-group-head">{g.head}</p>
              <ul className="mail-list">
                {g.rows.map((ev) => (
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
            </div>
          ))}
        </>
      )}
    </div>
  );
}
