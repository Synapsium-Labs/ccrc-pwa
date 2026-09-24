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
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthStatus, AutoMode, CatalogueErrorReason, CatalogueState, NodeWire, NotifyMode, ReleaseWire, UpdateChannel, UpdateRouteError, UpdateRouteRefusal, UpdatesView } from '../../../shared/api';
import { AUTO_MODES, FLEET_SCOPE, NOTIFY_MODES, SETTLED_UPDATE_STATES, UPDATE_CHANNELS, UPDATE_GATE_CAP, isNotifyMode, isReleaseTag, isStampRead, isUpdateChannel } from '../../../shared/api';
import { LOOPBACK_HOSTS } from '../../../shared/base-url';
import { compareReleaseTags, isNewerTag } from '../../../shared/semver';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { NotificationBell } from '../fleet/NotificationBell';
import { nodeVersion, pendingTag, useUpdatesView, type UpdatesPoll } from '../fleet/useUpdatesView';
import { ApiError, MOVE_DISABLED_TEXT, api, updateErrorText } from '../lib/api';
import { readAuthStatus } from '../lib/auth';
import { elapsedWords } from '../lib/elapsed';
import { pushSupported } from '../lib/push';
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
export const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";
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

/** THE ONE invalid-Date predicate (fix round 1): a `lastOkAt`/`lastError.at`/`publishedAt` magnitude this
 *  build's `Date` cannot place — `asUpdatesView` only guards `Number.isFinite`, and 1e20 is finite but
 *  `new Date(1e20)` is Invalid Date (review R-b). Used by `catalogueLine`'s classification of `lastOkAt`
 *  AND by every renderer that prints a clock or a date off a wire instant — `clockTime`, `dayClock`,
 *  `releaseDate` — so there is exactly one place that decides "this build's Date cannot place it". */
const isPlaceableInstant = (ms: number): boolean => !Number.isNaN(new Date(ms).getTime());

export function clockTime(ms: number): string {
  if (!isPlaceableInstant(ms)) return '—';
  const d = new Date(ms);
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The amber line's clock (D-3306): bare on the viewer's own local day, dated off it, because
 *  lastOkAt freezes at the last success while a failure may recur for days — "since 14:02" alone would read as
 *  today's 14:02 and shrink the outage. The dated shape is the one lib/clock.ts's resetClock and HistoryTab
 *  already print ("14:02 · 22 Sep"); resetClock itself is not reused because it reads epoch SECONDS and has no
 *  '—' arm for an instant Date cannot place. */
export function dayClock(ms: number, now: number): string {
  if (!isPlaceableInstant(ms)) return '—';
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? clockTime(ms) : `${clockTime(ms)} · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

export interface CatalogueLine { text: string; tone: 'calm' | 'amber' | 'muted' }

export function catalogueLine(c: CatalogueState, now: number): CatalogueLine {
  // review R-b: a lastOkAt this build's Date cannot place is UNMEASURED, not a
  // "checked" instant — treated exactly as a null lastOkAt from here down, so
  // the failure arm's "since" form and the success arm both fall back
  // correctly (never "since —", never "checked moments ago" off a value that
  // was never really placeable).
  const lastOkAt = c.lastOkAt !== null && isPlaceableInstant(c.lastOkAt) ? c.lastOkAt : null;
  // The failure arm FIRST: a catalogue that answered an hour ago and has failed
  // since is amber, never the calm "checked 1h ago" it would read as if
  // lastOkAt were consulted first (W2 clears lastError on the next success).
  if (c.lastError !== null) {
    const reason = catalogueReasonText(c.lastError.reason);
    return lastOkAt !== null
      ? { text: `couldn't reach GitHub since ${dayClock(lastOkAt, now)} — ${reason}`, tone: 'amber' }
      : { text: `couldn't reach GitHub (tried ${dayClock(c.lastError.at, now)}) — ${reason}`, tone: 'amber' };
  }
  if (lastOkAt !== null) return { text: `checked ${elapsedWords(now - lastOkAt)} ago`, tone: 'calm' };
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

// ── The release list (spec §13; programme wave 3 Task 8) ─────────────────────
// One row per catalogue release, newest first. Three rules this block exists
// to keep, each pinned in settings-screen.test.tsx:
//   * ORDER IS SEMVER. `v0.0.10` sorts below `v0.0.9` as a string; every tag
//     comparison here goes through shared/semver.ts behind isReleaseTag (the
//     comparator throws RangeError on a non-tag, so nothing unvalidated reaches it).
//   * "verified" IS A MEASUREMENT. It appears only when some node's measured
//     provenance is `verified` while that node runs this tag. `bundleListed` is
//     the catalogue's claim that a bundle FILE is listed, and renders as
//     `bundle listed` — verifiedAt takes no release, so it cannot read it (§18).
//   * NOTES ARE TEXT. Same-user-writable, capped by the poller (W2), and handed
//     to React as one text child of a <pre>: no markdown pass, no HTML, no link
//     detection, and no raw-HTML prop anywhere in this file (a source scan
//     holds that literally).
// The move button is rendered and DISABLED in this wave: its routes are
// programme wave 5's, and MOVE_DISABLED_TEXT is the one sentence every
// disabled move control carries (Task 5).

export function sortReleases(releases: readonly ReleaseWire[]): ReleaseWire[] {
  const tagged = releases.filter((r) => isReleaseTag(r.tag));
  const rest = releases.filter((r) => !isReleaseTag(r.tag));
  // `filter` returned a fresh array, so the stable in-place sort never reorders
  // the poll's view; equal versions (v0.0.10 / v0.0.010) keep wire order.
  tagged.sort((a, b) => compareReleaseTags(b.tag, a.tag));
  return [...tagged, ...rest];
}

export function verifiedAt(tag: string, nodes: readonly NodeWire[]): boolean {
  return nodes.some((n) => n.provenance === 'verified' && nodeVersion(n) === tag);
}

export function releaseDirection(tag: string, nodes: readonly NodeWire[]): 'install' | 'rollback' {
  if (!isReleaseTag(tag) || nodes.length === 0) return 'install';
  return nodes.every((n) => {
    const v = nodeVersion(n);
    return v !== null && isNewerTag(v, tag);
  }) ? 'rollback' : 'install';
}

export function refusedLine(r: ReleaseWire, nodes: readonly NodeWire[]): string | null {
  const refused: readonly unknown[] = Array.isArray(r.refused) ? r.refused : [];
  const by = new Set<string>();
  for (const x of refused) {
    if (typeof x === 'object' && x !== null && typeof (x as { by?: unknown }).by === 'string') {
      by.add((x as { by: string }).by);
    }
  }
  if (by.size === 0) return null;
  const m = nodes.length;
  return `refused by ${by.size} of ${m} node${m === 1 ? '' : 's'}`;
}

export function releaseDate(ms: number): string {
  return typeof ms === 'number' && isPlaceableInstant(ms) ? new Date(ms).toISOString().slice(0, 10) : '—';
}

function ReleaseItem({ release: r, nodes }: { release: ReleaseWire; nodes: readonly NodeWire[] }): ReactNode {
  const noteId = useId();
  const refused = refusedLine(r, nodes);
  const direction = releaseDirection(r.tag, nodes);
  return (
    <li className="settings-release" data-tag={r.tag}>
      <div className="settings-release-head">
        <span className="settings-release-tag">{r.tag}</span>
        <span className="settings-release-date">{releaseDate(r.publishedAt)}</span>
        {isUpdateChannel(r.channel) && (
          <span className={`settings-badge settings-badge--${r.channel}`}>{r.channel}</span>
        )}
        {verifiedAt(r.tag, nodes) && <span className="settings-badge settings-badge--verified">verified</span>}
        {r.bundleListed === true && <span className="settings-badge">bundle listed</span>}
        {r.yanked === true && <span className="settings-badge">yanked</span>}
      </div>
      {refused !== null && <p className="settings-release-refused">{refused}</p>}
      {typeof r.notes === 'string' && r.notes !== '' && <pre className="settings-release-notes">{r.notes}</pre>}
      <div className="settings-release-actions">
        <button type="button" className="btn-ghost settings-move" disabled aria-describedby={noteId}>
          {direction === 'rollback' ? 'Roll back' : 'Install'}
        </button>
        <span id={noteId} className="settings-move-note">{MOVE_DISABLED_TEXT}</span>
      </div>
    </li>
  );
}

function ReleaseList({ releases, nodes }: { releases: readonly ReleaseWire[]; nodes: readonly NodeWire[] }): ReactNode {
  if (releases.length === 0) return null;
  return (
    <ul className="settings-releases" aria-label="Releases">
      {sortReleases(releases).map((r) => <ReleaseItem key={r.tag} release={r} nodes={nodes} />)}
    </ul>
  );
}

// ── The node inventory (spec §13; programme wave 3 Task 9) ───────────────────
// One row per LIVE node (W2 excludes superseded rows), in the server's order.
// The rules this block keeps, each pinned in settings-screen.test.tsx:
//   * THE ARROW IS pendingTag's. A desired tag renders as `→ vX` only when
//     pendingTag (fleet/useUpdatesView.ts) returns it — measured, on a resolved
//     channel, with a stamp that was READ, not macOS, and newer by semver. This
//     row adds no clause of its own, so it cannot disagree with the banner or
//     BuildLine, which read the same predicate. When the node
//     has no desired tag or no channel, the resolver's own sentence
//     (resolveDetail) stands in: no badge, no arrow (§13). Nothing here says
//     "up to date": a node on its desired tag simply shows no desired.
//   * CURRENT SAYS WHAT WAS MEASURED. A node never measured reads `not
//     measured`, a stamp the sweep could not read reads `stamp <word>`, and
//     only a stamp that was read and carries no tag reads `unversioned` —
//     §18 "`stampRead` keeps EACCES from unversioned", on the screen. Anything
//     the row cannot vouch for is amber, and an unreachable node says so,
//     because W2 keeps its last measurement.
//   * TEXT IS TEXT. label, resolveDetail and report.detail are same-user-
//     writable; each reaches the DOM as a React text child and nothing else.
//   * macOS IS NOT MANAGED (decision 17). A Darwin row says so in place of its
//     desired and offers no move (D-3308); its arrow is
//     already null in pendingTag (D-3309).
// Update and Roll back are rendered DISABLED beside MOVE_DISABLED_TEXT (their
// routes are programme wave 5's). Ack is live — its route is W2's — and is
// offered only on a SETTLED lease, because W2's ackNode acks from nothing
// else (D-3183; D-3310). The route stays the
// authority: a row that went busy between the poll and the tap comes back as
// a 409 `busy`, rendered as updateErrorText's sentence, and the view is
// re-polled either way.

export const MACOS_UNMANAGED_TEXT = 'macOS: not centrally managed';
export const ACK_UNREADABLE_TEXT = "Acknowledged — the server's answer could not be read; the screen will re-check.";

export function currentText(n: NodeWire): string {
  if (typeof n.measuredAt !== 'number') return 'not measured';
  if (n.stampRead !== 'ok') return `stamp ${isStampRead(n.stampRead) ? n.stampRead : 'unreadable'}`;
  return nodeVersion(n) ?? 'unversioned';
}

export function currentIsAmber(n: NodeWire): boolean {
  return typeof n.measuredAt !== 'number'
    || n.stampRead !== 'ok'
    || nodeVersion(n) === null
    || n.provenance !== 'verified'
    || n.installState !== 'complete';
}

export function canAck(n: NodeWire, releases: readonly ReleaseWire[]): boolean {
  const state = n.update?.state;
  // A busy lease (pending, applying, unknown), an absent state or a word this build cannot name: ackNode answers busy.
  if (typeof state !== 'string' || !(SETTLED_UPDATE_STATES as readonly string[]).includes(state)) return false;
  if (state === 'failed' || state === 'reverted') return true;
  if (typeof n.request === 'object' && n.request !== null) return true;
  return releases.some((r) => Array.isArray(r.refused) && r.refused.some((x: unknown) =>
    typeof x === 'object' && x !== null && (x as { by?: unknown }).by === n.nodeId));
}

export function requestLine(n: NodeWire, now: number): string | null {
  const q: unknown = n.request;
  if (typeof q !== 'object' || q === null) return null;
  const { tag, kind, at } = q as { tag?: unknown; kind?: unknown; at?: unknown };
  if (typeof tag !== 'string' || typeof kind !== 'string' || typeof at !== 'number' || !isPlaceableInstant(at)) return null;
  return `${kind} ${tag} requested ${elapsedWords(now - at)} ago`;
}

export function nodeStateLine(n: NodeWire): string {
  const state = typeof n.update?.state === 'string' ? n.update.state : 'unknown';
  const r: unknown = n.report;
  if (typeof r !== 'object' || r === null) return state;
  const { phase, detail } = r as { phase?: unknown; detail?: unknown };
  if (typeof phase !== 'string') return state;
  return typeof detail === 'string' && detail !== '' ? `${state} — ${phase}: ${detail}` : `${state} — ${phase}`;
}

export function reachabilityLine(n: NodeWire, now: number): string | null {
  if (n.reachable !== false) return null;
  return typeof n.unreachableSince === 'number' && isPlaceableInstant(n.unreachableSince)
    ? `unreachable since ${elapsedWords(now - n.unreachableSince)} ago`
    : 'unreachable';
}

function NodeItem({ node: n, releases, now, onAcked }: {
  node: NodeWire; releases: readonly ReleaseWire[]; now: number; onAcked: () => void;
}): ReactNode {
  const noteId = useId();
  const [acking, setAcking] = useState(false);
  const darwin = n.os === 'darwin';
  const next = pendingTag(n);   // null for a Darwin node too — the predicate's own guard
  const reach = reachabilityLine(n, now);
  const request = requestLine(n, now);
  const ackable = canAck(n, releases);

  const ack = (): void => {
    setAcking(true);
    void api.ackUpdateNode(n.nodeId).then(
      (answer) => { if (answer === 'unreadable') toast(ACK_UNREADABLE_TEXT); },
      (err: unknown) => { toast(updateErrorText(err), 'error'); },
    ).finally(() => {
      setAcking(false);
      onAcked();
    });
  };

  let desired: ReactNode = null;
  if (darwin) {
    desired = <span className="settings-node-detail">{MACOS_UNMANAGED_TEXT}</span>;
  } else if (next !== null) {
    // pendingTag returns a tag only for a node whose channel passed
    // isUpdateChannel; restating that test here would be a SECOND arrow
    // predicate, so the type is asserted, not re-derived (Task 11's argument).
    const channel = n.channel as UpdateChannel;
    desired = (
      <span className="settings-node-desired">
        {`→ ${next}`}
        <span className={`settings-badge settings-badge--${channel}`}>{channel}</span>
      </span>
    );
  } else if (!isReleaseTag(n.desiredTag) || !isUpdateChannel(n.channel)) {
    desired = typeof n.resolveDetail === 'string' && n.resolveDetail !== ''
      ? <span className="settings-node-detail">{n.resolveDetail}</span>
      : null;
  }

  return (
    <li className="settings-node" data-node-id={n.nodeId}>
      <div className="settings-node-head">
        <span className="settings-node-label">{n.label}</span>
        <span className="settings-node-detail">{`${n.role ?? 'unknown role'} · ${typeof n.os === 'string' ? n.os : 'unknown'}`}</span>
      </div>
      <p className="settings-node-versions">
        <span className={currentIsAmber(n) ? 'settings-node-current settings-node-current--amber' : 'settings-node-current'}>
          {currentText(n)}
        </span>
        {desired}
      </p>
      {reach !== null && <p className="settings-node-detail">{reach}</p>}
      {request !== null && <p className="settings-node-detail">{request}</p>}
      <p className="settings-node-detail">{nodeStateLine(n)}</p>
      <div className="settings-node-actions">
        {!darwin && (
          <>
            <button type="button" className="btn-ghost settings-move" disabled aria-describedby={noteId}>Update</button>
            <button type="button" className="btn-ghost settings-move" disabled aria-describedby={noteId}>Roll back</button>
            <span id={noteId} className="settings-move-note">{MOVE_DISABLED_TEXT}</span>
          </>
        )}
        <button type="button" className="btn-ghost settings-move" disabled={!ackable || acking} onClick={ack}>Ack</button>
      </div>
    </li>
  );
}

function NodeList({ nodes, releases, now, onAcked }: {
  nodes: readonly NodeWire[]; releases: readonly ReleaseWire[]; now: number; onAcked: () => void;
}): ReactNode {
  if (nodes.length === 0) return null;
  return (
    <ul className="settings-nodes" aria-label="Nodes">
      {nodes.map((n) => <NodeItem key={n.nodeId} node={n} releases={releases} now={now} onAcked={onAcked} />)}
    </ul>
  );
}

// ── Notifications (spec §13 item 2, §12's unarmed banner; programme wave 3 Task 10) ──
// Two things live here, and one thing deliberately does not:
//   * The PHONE-PUSH toggle is the literal <NotificationBell/> — the same
//     component the fleet header mounts, with its four subscribe outcomes
//     (NotificationBell.tsx:29-47). This file imports none of lib/push's
//     lifecycle calls and spells none of those outcomes; a second copy of the
//     toggle is how two surfaces would come to disagree about whether this
//     browser is subscribed. `pushSupported()` is read here only to say why the
//     bell is absent (it renders nothing where Web Push cannot work).
//   * RELEASE NOTIFICATIONS are `update_intent['*'].notify` (W2's NotifyMode
//     column): one native radio per NOTIFY_MODES member
//     (D-3299), written through the one intent route.
//     The server's notifier (Task 3) reads the '*' row alone, so a per-node
//     scope is never offered here.
//   * NOT HERE: the release push itself. A tap on one of these radios changes
//     which tags the server will announce from the next sweep on; it sends
//     nothing and marks nothing.
//
// THE UNARMED-EXPOSURE BANNER (spec §12) sits above both sections. Its trigger
// is `AuthStatus.mode === 'off'` from the unauthenticated GET /api/auth/status
// (D-3298 — /health reports no gate state), AND a
// page origin whose hostname is not one of shared/base-url.ts's
// LOOPBACK_HOSTS: the one list of loopback spellings, reused rather than
// re-spelled (single-definition.test.ts's LOOP_SET scan holds that). Every
// non-answer draws NOTHING — a failed read, an older server with no route, a
// body without `mode` — because a red banner is a claim about this box, and a
// status read that told us nothing is not evidence of an open gate.

export const NOTIFY_LABELS: Record<NotifyMode, string> = { channel: 'on my channel', stable: 'stable only', off: 'off' };

/** The ONE spelling of the §12 sentence (the W4 doctor check will name the same route). */
export const UNARMED_EXPOSURE_TEXT =
  "The sign-in gate is off and this page was reached over a non-loopback address — anyone who can reach it can "
  + 'change what the fleet installs, and POST /api/updates/apply will let them install it. Arm the gate: '
  + 'CCRC_AUTH=on with CCRC_RP_ID and CCRC_ORIGIN, together (ccrc expose writes all three).';

/** (D-3298) true iff status?.mode === 'off' exactly AND !LOOPBACK_HOSTS.includes(hostname). */
export function unarmedExposure(status: Partial<AuthStatus> | null, hostname: string): boolean {
  return status?.mode === 'off' && !LOOPBACK_HOSTS.includes(hostname);
}

/** One status read per mount — the AccountsScreen `AuthSection` shape, whose
 *  argument (one extra anonymous GET on a rarely-visited screen, and a reader
 *  that never raises auth-lost) carries over unchanged. */
function UnarmedExposureBanner(): ReactNode {
  const [status, setStatus] = useState<Partial<AuthStatus> | null>(null);
  useEffect(() => {
    let live = true;
    void readAuthStatus()
      .then((s) => { if (live) setStatus(s); })
      .catch(() => { /* an older server, a proxy's 404, no network: this box told us nothing — draw nothing */ });
    return () => { live = false; };
  }, []);
  if (!unarmedExposure(status, location.hostname)) return null;
  return <div className="settings-unarmed" role="alert">{UNARMED_EXPOSURE_TEXT}</div>;
}

/** What the release-notifications radios show. `setAt: null` = a write in
 *  flight; a number = the route's own answer, shown until the poll's '*' row is
 *  at least that new — a controlled radio would otherwise snap back to the old
 *  choice for the length of one poll. */
interface ShownNotify { notify: NotifyMode; setAt: number | null }

function NotificationsSection({ view, reload }: { view: UpdatesView | null; reload: () => void }): ReactNode {
  const titleId = useId();
  const [supported] = useState(() => pushSupported());
  const [shown, setShown] = useState<ShownNotify | null>(null);
  const row = view === null ? null : (view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null);
  const caughtUp = shown !== null && shown.setAt !== null && row !== null && row.setAt >= shown.setAt;
  const checked = shown !== null && !caughtUp ? shown.notify : (row?.notify ?? null);
  const saving = shown !== null && shown.setAt === null;

  const choose = async (notify: NotifyMode): Promise<void> => {
    if (saving) return;   // the disabled fieldset stops a finger; this stops a second call
    setShown({ notify, setAt: null });
    try {
      const answer = await api.setUpdateIntent({ scope: FLEET_SCOPE, notify });
      const stored = answer === 'unreadable' ? null : (answer?.intent ?? null);
      if (stored === null || !isNotifyMode(stored.notify) || typeof stored.setAt !== 'number') {
        // The write may have landed: say so, and let the poll decide what is checked.
        setShown(null);
        toast(UNCONFIRMED_TEXT);
      } else {
        setShown({ notify: stored.notify, setAt: stored.setAt });
      }
    } catch (err) {
      setShown(null);
      toast(updateErrorText(err), 'error');
    }
    reload();
  };

  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Notifications</h2>
      {supported ? (
        <div className="settings-bell-row">
          <NotificationBell />
          <span>Phone notifications for this browser</span>
        </div>
      ) : (
        <p className="settings-note">This browser cannot receive Web Push.</p>
      )}
      {view !== null && (
        <fieldset className="settings-fieldset" disabled={saving}>
          <legend className="settings-legend">Release notifications</legend>
          {NOTIFY_MODES.map((m) => (
            <label key={m} className="settings-option">
              <input
                type="radio"
                name="settings-notify"
                value={m}
                checked={checked === m}
                onChange={() => void choose(m)}
              />
              <span className="settings-option-sentence">{NOTIFY_LABELS[m]}</span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
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
      <UnarmedExposureBanner />
      <UpdatesSection poll={poll} now={now} />
      <NotificationsSection view={poll.view} reload={poll.reload} />
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
        // `REFRESH_MIN_INTERVAL_MS`, derived, D-3218), not a failure: GitHub
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
        disabled={busy}
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
              // D-3315: only the non-'off' choices are gated on the node caps — the
              // route accepts `auto: 'off'` unconditionally (server/src/update/routes.ts),
              // so disabling the whole fieldset would remove the one safe action
              // exactly when the gate is incomplete.
              disabled={m !== 'off' && missing.length > 0}
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
      {view !== null && <ReleaseList releases={view.releases} nodes={view.nodes} />}
      {view !== null && <NodeList nodes={view.nodes} releases={view.releases} now={now} onAcked={reload} />}
    </>
  );
}
