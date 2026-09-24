// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Two sections and no more — Updates (the channel,
// auto-install, *Check now*, the catalogue line, the release list, the node
// inventory) and Notifications (the bell, release notifications, the
// unarmed-exposure banner) — which Tasks 7–10 of the W3 plan add below the
// header. This task lands the shell alone, because the route's pin
// (app.test.tsx) needs the screen's own heading.
//
// The AccountsScreen skeleton, class for class (`.settings-screen/-head/-back/
// -title`, fleet.css): a back chevron that returns to the fleet, then the <h1>.
// It adds no scroll logic of its own — the D-161 pane reset in app.tsx puts
// `.shell-detail` back at the top on every route change, this one included.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { AutoMode, CatalogueErrorReason, CatalogueState, NodeWire, UpdateChannel, UpdateRouteError, UpdateRouteRefusal, UpdatesView } from '../../../shared/api';
import { AUTO_MODES, FLEET_SCOPE, UPDATE_CHANNELS, UPDATE_GATE_CAP } from '../../../shared/api';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { useUpdatesView, type UpdatesPoll } from '../fleet/useUpdatesView';
import { ApiError, api, updateErrorText } from '../lib/api';
import { elapsedWords } from '../lib/elapsed';
import { navigate } from '../lib/router';
import { useNow } from '../lib/useNow';
import '../fleet/fleet.css';

// ── The Updates section (spec §13; programme wave 3 Task 7) ──────────────────
// Channel, auto-install, Check now and the catalogue line, over the screen's
// ONE /api/updates poll. Three rules this block keeps, each pinned in
// settings-screen.test.tsx:
//   * THE SERVER'S ROW IS WHAT IS SHOWN. A radio is checked from the fleet
//     intent row (`scope === FLEET_SCOPE`) the last poll returned, never from
//     the tap: a change writes a partial through api.setUpdateIntent and
//     re-polls, so a refused or lost write cannot leave a choice on screen
//     that the server does not hold.
//   * UNREACHABLE IS NOT CURRENT (§18). The line says "checked" only off a
//     non-null lastOkAt; a failed check is amber and says only what it can
//     measure (D-3306); nothing here says "up to date".
//   * THE AUTO GATE IS ADVISORY HERE. The auto-install fieldset is disabled
//     from the nodes' measured caps before a tap (D-3297);
//     the intent route's 409 stays the authority, and when it answers, its
//     node list is rendered by label in the same note.
// The selectors are native radios in a fieldset (D-3299):
// the platform supplies the group's role, its name (the legend), arrow-key
// movement and the checked state.

/** Spec §13's two channel sentences, verbatim — one radio row each. */
export const CHANNEL_SENTENCES: Record<UpdateChannel, string> = {
  stable: "Stable — releases promoted after they've baked",
  dev: 'Dev — every merge, minutes after it lands',
};

/** The auto-install choices (`AutoMode`, W2) in the operator's words. */
export const AUTO_LABELS: Record<AutoMode, string> = {
  off: 'Off',
  stable: 'Stable releases only',
  channel: 'Every release on my channel',
};

/** The auto-install note's lead; the node labels follow, in `nodes()` order. */
const AUTO_GATE_NOTE = 'Auto-install needs the rollback gate on every node — not yet on: ';
/** A write that answered 2xx but unreadably (`postJsonOr`'s `unreadable`, D-1150): it may have landed. */
const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";
/** The first poll never landed and was not a 501 — a read that failed, said as one, not a skeleton forever. */
const UNREAD_TEXT = 'The update plane could not be read — the screen tries again every minute.';
/** A later poll failed: what is shown is the last answer that landed, and it says so. */
const STALE_TEXT = 'The latest read failed — this is the last answer that landed.';
/** The update surface's own sentence for a box with no control plane — Task 5's table, read through its one
 *  translator, so this file holds no second copy of it. */
const NOT_CONFIGURED_TEXT = updateErrorText(new ApiError(501, { ok: false, error: 'not-configured' }));
/** The one intent refusal rendered in place (by node label) instead of toasted (W2 Task 13). */
const AUTO_GATE_REFUSAL = 'auto-needs-rollback-gate' satisfies UpdateRouteError;

export function autoGateMissing(nodes: readonly NodeWire[]): NodeWire[] {
  // Array.isArray, not a bare `.includes`: a caps field that arrived as a
  // STRING would answer by substring and read as gated.
  return nodes.filter((n) => !(Array.isArray(n.caps) && n.caps.includes(UPDATE_GATE_CAP)));
}

/** The node ids a `409 auto-needs-rollback-gate` names; null for any other failure, and for a 409 naming no id
 *  (the caller then toasts the route's own sentence rather than an empty "not yet on:"). */
function gateRefusalOf(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (typeof err.body !== 'object' || err.body === null) return null;
  const { error, nodes } = err.body as Partial<UpdateRouteRefusal>;
  if (error !== AUTO_GATE_REFUSAL || !Array.isArray(nodes)) return null;
  const ids = nodes.filter((id) => typeof id === 'string');
  return ids.length > 0 ? ids : null;
}

export function clockTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The amber line's clock (D-3306): bare on the viewer's own local day, dated off it, because
 *  lastOkAt freezes at the last success while a failure may recur for days — "since 14:02" alone would read as
 *  today's 14:02 and shrink the outage. The dated shape is the one lib/clock.ts's resetClock and HistoryTab
 *  already print ("14:02 · 22 Sep"); resetClock itself is not reused because it reads epoch SECONDS and has no
 *  '—' arm for an instant Date cannot place. */
export function dayClock(ms: number, now: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? clockTime(ms) : `${clockTime(ms)} · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

export interface CatalogueLine { text: string; tone: 'calm' | 'amber' | 'muted' }

export function catalogueLine(c: CatalogueState, now: number): CatalogueLine {
  // The failure arm FIRST: a catalogue that answered an hour ago and has failed
  // since is amber, never the calm "checked 1h ago" it would read as if
  // lastOkAt were consulted first (W2 clears lastError on the next success).
  if (c.lastError !== null) {
    const reason = catalogueReasonText(c.lastError.reason);
    return c.lastOkAt !== null
      ? { text: `couldn't reach GitHub since ${dayClock(c.lastOkAt, now)} — ${reason}`, tone: 'amber' }
      : { text: `couldn't reach GitHub (tried ${dayClock(c.lastError.at, now)}) — ${reason}`, tone: 'amber' };
  }
  if (c.lastOkAt !== null) return { text: `checked ${elapsedWords(now - c.lastOkAt)} ago`, tone: 'calm' };
  return { text: 'never checked', tone: 'muted' };
}

/** `CatalogueErrorReason` (W2) in words, keyed by the union less its `http-NNN` family, so a word W2 adds is a
 *  compile error here until it has one. */
const CATALOGUE_REASON_TEXT: Record<Exclude<CatalogueErrorReason, `http-${number}`>, string> = {
  'no-egress': 'no network route to GitHub',
  'rate-limited': 'rate limited',
  malformed: 'an answer this build could not read',
  'no-release-source': 'no release source configured',
  redirect: 'a redirect this build will not follow',
};

export function catalogueReasonText(reason: string): string {
  if (Object.hasOwn(CATALOGUE_REASON_TEXT, reason)) {
    return CATALOGUE_REASON_TEXT[reason as keyof typeof CATALOGUE_REASON_TEXT];
  }
  const http = /^http-(\d{3})$/.exec(reason);
  return http !== null ? `HTTP ${http[1]}` : reason;
}

export function SettingsScreen(): ReactNode {
  // ONE poll and ONE clock for the whole screen: every section reads the same
  // answer (Tasks 7–10), so two sections can never disagree about the fleet.
  const poll = useUpdatesView();
  const now = useNow(30_000);
  return (
    <div className="settings-screen">
      <header className="settings-head">
        <button type="button" className="settings-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="settings-title">Settings</h1>
      </header>
      <UpdatesSection poll={poll} now={now} />
    </div>
  );
}

/** The Updates section's frame: its heading, and the three states before any view exists — loading, a box with
 *  no control plane, a first read that failed — each its own render (AccountsScreen's three-state discipline),
 *  so "don't know yet" never borrows the rendering of "nothing there". */
function UpdatesSection({ poll, now }: { poll: UpdatesPoll; now: number }): ReactNode {
  const titleId = useId();
  const { view, failure, reload } = poll;
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Updates</h2>
      {view !== null ? (
        <UpdatesBody view={view} stale={failure !== null} now={now} reload={reload} />
      ) : failure === 'not-configured' ? (
        <p className="settings-note">{NOT_CONFIGURED_TEXT}</p>
      ) : failure === 'failed' ? (
        <p className="settings-note">{UNREAD_TEXT}</p>
      ) : (
        <Skeleton lines={3} />
      )}
    </section>
  );
}

/** The section over a landed view. `view` is the LAST GOOD answer (useUpdatesView keeps it across a failed
 *  poll); `stale` says a later poll failed. Tasks 8 and 9 render the release list and the node inventory
 *  after the catalogue line, from these same props. */
function UpdatesBody({ view, stale, now, reload }: {
  view: UpdatesView; stale: boolean; now: number; reload: () => void;
}): ReactNode {
  const gateNoteId = useId();
  const [busy, setBusy] = useState(false);
  const [gateRefusal, setGateRefusal] = useState<string[] | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const fleet = view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null;
  const missing = autoGateMissing(view.nodes);
  const labelOf = (id: string): string => view.nodes.find((n) => n.nodeId === id)?.label ?? id;
  // The route's answer, when it gave one, is the authority over the poll's.
  const gateLabels = gateRefusal !== null ? gateRefusal.map(labelOf) : missing.map((n) => n.label);
  const gateNote = gateLabels.length > 0 ? `${AUTO_GATE_NOTE}${gateLabels.join(', ')}` : null;
  const line = catalogueLine(view.catalogue, now);

  const writeIntent = (patch: { channel: UpdateChannel } | { auto: AutoMode }): void => {
    setBusy(true);
    if ('auto' in patch) setGateRefusal(null);
    void api.setUpdateIntent({ scope: FLEET_SCOPE, ...patch })
      .then(
        (answer) => { if (answer === 'unreadable') toast(UNCONFIRMED_TEXT); },
        (err: unknown) => {
          const refused = gateRefusalOf(err);
          if (refused !== null) setGateRefusal(refused);
          else toast(updateErrorText(err), 'error');
        },
      )
      .finally(() => { setBusy(false); reload(); });
  };

  const checkNow = (): void => {
    setBusy(true);
    setRefreshNote(null);
    void api.refreshUpdates()
      .catch((err: unknown) => {
        // A 429 is the route's interval guard (W2 Task 13's
        // `REFRESH_MIN_INTERVAL_MS`, derived — 200 s today), not a failure: GitHub
        // was ASKED too recently — by a request that may itself have
        // failed (D-3203 counts every request), so the note claims the request
        // and never a "checked" (the catalogue line owns that word, and only
        // off a non-null lastOkAt).
        if (err instanceof ApiError && err.status === 429) setRefreshNote(updateErrorText(err));
        else toast(updateErrorText(err), 'error');
      })
      .finally(() => { setBusy(false); reload(); });
  };

  return (
    <>
      {stale && <p className="settings-note">{STALE_TEXT}</p>}
      <fieldset className="settings-fieldset" disabled={busy}>
        <legend className="settings-legend">Channel</legend>
        {UPDATE_CHANNELS.map((c) => (
          <label key={c} className="settings-option">
            <input
              type="radio"
              name="settings-channel"
              value={c}
              checked={fleet !== null && fleet.channel === c}
              onChange={() => writeIntent({ channel: c })}
            />
            <span className="settings-option-sentence">{CHANNEL_SENTENCES[c]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset
        className="settings-fieldset"
        disabled={busy || missing.length > 0}
        aria-describedby={gateNote !== null ? gateNoteId : undefined}
      >
        <legend className="settings-legend">Auto-install</legend>
        {AUTO_MODES.map((m) => (
          <label key={m} className="settings-option">
            <input
              type="radio"
              name="settings-auto"
              value={m}
              checked={fleet !== null && fleet.auto === m}
              onChange={() => writeIntent({ auto: m })}
            />
            <span className="settings-option-sentence">{AUTO_LABELS[m]}</span>
          </label>
        ))}
      </fieldset>
      {gateNote !== null && <p id={gateNoteId} className="settings-note">{gateNote}</p>}
      <button type="button" className="btn-ghost settings-check" disabled={busy} onClick={checkNow}>
        Check now
      </button>
      {refreshNote !== null && <p className="settings-note" aria-live="polite">{refreshNote}</p>}
      <p className={line.tone === 'calm' ? 'settings-catalogue' : `settings-catalogue settings-catalogue--${line.tone}`}>
        {line.text}
      </p>
    </>
  );
}
