// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Two sections and no more — Updates (the channel,
// auto-install, *Check now*, the catalogue line, the release list, the node
// inventory) and Notifications (the bell, release notifications, the
// unarmed-exposure banner) — both shipped in this file, below the header
// (Tasks 7–10 of the W3 plan; fix rounds 1–2 widened several of their
// guards in place — see the plan's `## Deviations found`, D-3315/D-3316).
//
// The AccountsScreen skeleton, class for class (`.settings-screen/-head/-back/
// -title`, fleet.css): a back chevron that returns to the fleet, then the <h1>.
// It adds no scroll logic of its own — the D-161 pane reset in app.tsx puts
// `.shell-detail` back at the top on every route change, this one included.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AuthStatus, AutoMode, CatalogueErrorReason, CatalogueState, NodeWire, NotifyMode, ReleaseWire, UpdateChannel, UpdateRouteError, UpdateRouteRefusal, UpdatesView } from '../../../shared/api';
import { AUTO_MODES, FLEET_SCOPE, NOTIFY_MODES, SETTLED_UPDATE_STATES, UPDATE_CHANNELS, UPDATE_GATE_CAP, isNotifyMode, isReleaseTag, isStampRead, isUpdateChannel, rollbackTargetRefusal, settledDoneDetail } from '../../../shared/api';
import { LOOPBACK_HOSTS } from '../../../shared/base-url';
import { compareReleaseTags, isNewerTag } from '../../../shared/semver';
import { BackButton, Button, PHOSPHOR, SYSTEM, Skeleton, THEMES, elapsedWords, toast, useNow } from '@ccrc/ui';
import { NotificationBell } from '../fleet/NotificationBell';
import { isManagedNode, planMove, rollbackBlockers, type MoveIntent, type PlannedMove, type RollbackBlocker } from '../fleet/movePlan';
import { UpdateMoveSheet } from '../fleet/UpdateMoveSheet';
import { ACK_UNREADABLE_TEXT, canAck, sendAck } from '../fleet/updateAck';
import { isPlaceableInstant, nodeVersion, pendingTag, useUpdatesView, type UpdatesPoll } from '../fleet/useUpdatesView';
import { ApiError, api, moveSkipText, noBundleRollbackText, updateErrorText } from '../lib/api';
import { readAuthStatus } from '../lib/auth';
import { pushSupported } from '../lib/push';
import { setTheme, storedTheme } from '../lib/theme';
import { navigate } from '../lib/router';
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
//   * THE AUTO GATE IS ADVISORY HERE. Only the non-`'off'` auto-install radios
//     are disabled, from the nodes' measured caps alone (`autoGateMissing`,
//     D-3297, D-3315) — `off` stays enabled, since the route accepts it
//     unconditionally and it moves nothing. The fieldset itself carries no
//     `disabled` from the gate. The route's 409 disables nothing; it only
//     relabels the note, rendering its own node list by label in place of
//     the measured one (D-3315).
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
/** A radio group: a legend, then one labelled radio per choice.
 *
 *  THREE CALL SITES in this file — release notifications, update channel,
 *  auto-install — and the markup census named them. The classes stay
 *  `settings-*`: fleet.css grounds them there, the fieldset paints nothing,
 *  and this file is their only consumer, so moving them anywhere would cost
 *  three rules and buy nothing.
 *
 *  `value` IS NULLABLE because two of the three read it off a wire row that
 *  may not have arrived: `fleet !== null && fleet.channel === c` is the same
 *  question as `value={fleet?.channel ?? null}`, asked once instead of per
 *  option.
 *
 *  `disabled` on the FIELDSET and `disabled` on an OPTION are two different
 *  gates and both are needed — see D-3315 at the auto-install call site, where
 *  disabling the whole set would remove the one safe choice exactly when the
 *  node caps are incomplete. */
function RadioFieldset<T extends string>(
  { legend, name, options, value, onPick, disabled, describedBy }: {
    legend: string;
    /** The radio group's `name` — the thing that makes the set one choice. */
    name: string;
    options: { value: T; label: ReactNode; disabled?: boolean }[];
    value: T | null;
    onPick: (value: T) => void;
    disabled?: boolean;
    describedBy?: string;
  },
): ReactNode {
  return (
    <fieldset className="settings-fieldset" disabled={disabled} aria-describedby={describedBy}>
      <legend className="settings-legend">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="settings-option">
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={o.disabled}
            onChange={() => onPick(o.value)}
          />
          <span className="settings-option-sentence">{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function gateRefusalOf(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (typeof err.body !== 'object' || err.body === null) return null;
  const { error, nodes } = err.body as Partial<UpdateRouteRefusal>;
  if (error !== AUTO_GATE_REFUSAL || !Array.isArray(nodes)) return null;
  const ids = nodes.filter((id) => typeof id === 'string');
  return ids.length > 0 ? ids : null;
}

// THE ONE invalid-Date predicate (fix round 1) now lives in `fleet/useUpdatesView.ts` (imported above),
// moved there in fix round 1's second pass (F13, item 8) so `UpdateBanner`'s `bannerRelease` can share it —
// the banner used to decide "the catalogue was reached" with a bare `typeof … === 'number'`, which this
// screen's own `isPlaceableInstant` already refused (review F13). Used here by `catalogueLine`'s
// classification of `lastOkAt` AND by every renderer that prints a clock or a date off a wire instant —
// `clockTime`, `dayClock`, `releaseDate` — so there is exactly one place, shared by both surfaces, that
// decides "this build's Date cannot place it".

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
// The move button opens the one move sheet (UpdateMoveSheet, programme wave
// 5): Install asks for the tag on every node it takes forward, Roll back asks
// for it node by node, and the sheet names those nodes in dispatch order.

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

export function releaseDirection(tag: string, nodes: readonly NodeWire[]): 'install' | 'rollback' | 'running' {
  // D-3410: over the nodes a move can name — planMove's own filter (isManagedNode), so a Mac lagging behind
  // never turns a Roll back row into Install while the sheet would move the Linux nodes.
  const managed = nodes.filter(isManagedNode);
  if (!isReleaseTag(tag) || managed.length === 0) return 'install';
  // Wave 8 item F2, D-3591: the release every managed node runs (by last measurement) is a state, not a move.
  if (managed.every((n) => nodeVersion(n) === tag)) return 'running';
  return managed.every((n) => {
    const v = nodeVersion(n);
    return v !== null && isNewerTag(v, tag);
  }) ? 'rollback' : 'install';
}

/** Wave 8 item F2, D-3591: the running row's words, naming the set they measured: the managed nodes, how many of those are
 *  unreachable (their version is the last measurement), and a macOS node on another version (not moved from here). */
export function releaseRunningText(tag: string, nodes: readonly NodeWire[]): string {
  const managed = nodes.filter(isManagedNode);
  const away = managed.filter((n) => n.reachable === false).length;
  const macOther = nodes.some((n) => !isManagedNode(n) && nodeVersion(n) !== tag);
  let s = 'Running on every managed node';
  if (away > 0) s += ` — ${away} of them not reachable, as last measured`;
  if (macOther) s += ' · macOS nodes are not moved from here';
  return s;
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

/** Wave 8 item C: the reason a Roll back to `tag` is not offered, grouped by word. `no-bundle` is said with the tag
 *  (noBundleRollbackText); any other word through the route's own copy (`moveSkipText` reads `UPDATE_ERROR_TEXT`,
 *  and has a fallback for a word it does not know). */
export function rollbackBlockedText(blockers: readonly RollbackBlocker[], tag: string): string | null {
  if (blockers.length === 0) return null;
  const words = [...new Set(blockers.map((b) => b.word))];
  return words.map((w) => {
    const who = blockers.filter((b) => b.word === w).map((b) => b.label).join(', ');
    return `Roll back not offered for ${who}: ${w === 'no-bundle' ? noBundleRollbackText(tag) : moveSkipText(w)}`;
  }).join(' ');
}

function ReleaseItem({ release: r, nodes, onMove }: {
  release: ReleaseWire; nodes: readonly NodeWire[]; onMove: (intent: MoveIntent) => void;
}): ReactNode {
  const refused = refusedLine(r, nodes);
  const direction = releaseDirection(r.tag, nodes);
  // Wave 8 item F2: a running row offers no move — nothing to refuse — so neither is computed for it.
  const blockers = direction === 'rollback' ? rollbackBlockers(nodes, r, r.tag) : [];
  const blocked = direction === 'running' ? null : rollbackBlockedText(blockers, r.tag);
  // By DIRECTION (§13): a release every node runs newer than is a rollback to
  // it, anything else an install of it — the same releaseDirection that
  // labels the button, so the label and the request cannot disagree.
  const intent: MoveIntent | null = direction === 'running' ? null : direction === 'rollback'
    ? { scope: 'fleet', direction: 'rollback', to: r.tag }
    : { scope: 'fleet', direction: 'update', tag: r.tag };
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
      {blocked !== null && <p className="settings-release-refused" data-testid="settings-release-blocked">{blocked}</p>}
      <div className="settings-release-actions">
        {/* main added the `running` arm and the blockers guard; the branch
            had only swapped the primitive. Main's logic, the branch's Button. */}
        {direction === 'running'
          ? <span className="settings-release-running">{releaseRunningText(r.tag, nodes)}</span>
          : (
            <Button variant="ghost" size="fit" className="settings-move" disabled={blockers.length > 0} onClick={() => onMove(intent as MoveIntent)}>
              {direction === 'rollback' ? 'Roll back' : 'Install'}
            </Button>
          )}
      </div>
    </li>
  );
}

function ReleaseList({ releases, nodes, onMove }: {
  releases: readonly ReleaseWire[]; nodes: readonly NodeWire[]; onMove: (intent: MoveIntent) => void;
}): ReactNode {
  if (releases.length === 0) return null;
  return (
    <ul className="settings-releases" aria-label="Releases">
      {sortReleases(releases).map((r) => <ReleaseItem key={r.tag} release={r} nodes={nodes} onMove={onMove} />)}
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
//     "up to date": a node on the newest eligible tag shows the resolver's own `atNewest` sentence.
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
// Update and Roll back open the one move sheet (UpdateMoveSheet, programme
// wave 5): Update iff pendingTag names a tag, Roll back iff previousVersion
// is a tag the node runs newer than. Ack is live — its route is W2's — and is
// offered only on a SETTLED lease, because W2's ackNode acks from nothing
// else (D-3183; D-3310). The route stays the
// authority: a row that went busy between the poll and the tap comes back as
// a 409 `busy`, rendered as updateErrorText's sentence, and the view is
// re-polled either way.

export const MACOS_UNMANAGED_TEXT = 'macOS: not centrally managed';
// The Ack's gate and tap live in fleet/updateAck.ts since wave 14 (D-4267): the home screen's halt banner offers the
// same Ack. Re-exported so this screen's callers and tests keep their import.
export { ACK_UNREADABLE_TEXT, canAck };

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
  // Fix round 2 (review of d5aefc4a, item 5): spelled as the direct question
  // — "is this node reachable (or not yet known)? then say nothing" — rather
  // than `!== false`'s double negative, matching `statedOf`/`pendingTag`'s
  // `=== true` convention. NOT a bare `=== true`, deliberately: `reachable`
  // is tolerated ABSENT by wire discipline (`asUpdatesView` drops it only
  // when PRESENT but not a boolean, fix round 2 item 2), and an absent field
  // must keep claiming NOTHING — the same "absence is unknown, never a
  // specific claim" rule this codebase holds everywhere else. Only a
  // CONFIRMED `false` may proceed to say "unreachable"; `true` and `undefined`
  // both read as "not confirmed unreachable" and stay silent, exactly as
  // `!== false` always computed for the three values that can reach here.
  if (n.reachable === true || n.reachable === undefined) return null;
  return typeof n.unreachableSince === 'number' && isPlaceableInstant(n.unreachableSince)
    ? `unreachable since ${elapsedWords(now - n.unreachableSince)} ago`
    : 'unreachable';
}

/** Wave 8 item F1: a node's resolveDetail, qualified when it cannot be read as current (spec :1144): the catalogue
 *  has not answered since the server started (or its instant cannot be placed — the caller passes null then), or
 *  the node is unreachable. */
export function resolveDetailLine(detail: string, n: NodeWire, catalogueLastOkAt: number | null): string {
  if (catalogueLastOkAt === null) return `${detail} (the catalogue has not answered since the server started)`;
  if (n.reachable === false) return `${detail} (this node is not reachable; last measured)`;
  return detail;
}

/** Wave 8 item F4: ONE dated line for a finished move, or null (the row then keeps its two lines). Only when the
 *  lease is settled, the report is a finished phase of a tag that IS the lease's target (identity by tag, D-3405),
 *  and `update.detail` is exactly what the settle wrote for that report: settledDoneDetail(tag) for done,
 *  `report.detail ?? report.phase` for failed/reverted (inventory.ts). Anything else (an ack, a later refusal
 *  note, `met:`, a deadline) keeps its own line. The time is the NODE's clock (report.updatedAt). */
export function finishedLine(n: NodeWire, now: number): string | null {
  const state = n.update?.state;
  if (typeof state !== 'string' || !(SETTLED_UPDATE_STATES as readonly string[]).includes(state)) return null;
  const r: unknown = n.report;
  if (typeof r !== 'object' || r === null) return null;
  const { phase, target, detail, updatedAt } = r as { phase?: unknown; target?: unknown; detail?: unknown; updatedAt?: unknown };
  if (phase !== 'done' && phase !== 'failed' && phase !== 'reverted') return null;
  if (!isReleaseTag(target) || target !== n.update.target) return null;
  const settled = phase === 'done' ? settledDoneDetail(target) : (typeof detail === 'string' ? detail : phase);
  if (n.update.detail !== settled) return null;
  const when = typeof updatedAt === 'number' ? dayClock(updatedAt, now) : '—';
  const said = typeof detail === 'string' && detail !== '' ? ` — ${detail}` : '';
  const lead = state === phase ? '' : `${state} — `;
  return `${lead}${phase} ${target} · ${when}${said}`;
}

function NodeItem({ node: n, releases, now, catalogueLastOkAt, onAcked, onMove }: {
  node: NodeWire; releases: readonly ReleaseWire[]; now: number; catalogueLastOkAt: number | null; onAcked: () => void;
  onMove: (intent: MoveIntent) => void;
}): ReactNode {
  const [acking, setAcking] = useState(false);
  const darwin = n.os === 'darwin';
  const next = pendingTag(n);   // null for a Darwin node too — the predicate's own guard
  // Roll back needs somewhere to go: the stamp's previous version, when it is a tag this node runs NEWER than
  // (or the stamp carries no tag to compare it with). A rollback leaves `previous` in place (wave 4's D-3262),
  // so a node just rolled back reads previousVersion === its running tag: a tap there would be a 202 filed `met`.
  const v = nodeVersion(n);
  const previous = isReleaseTag(n.previousVersion) && (v === null || isNewerTag(v, n.previousVersion)) ? n.previousVersion : null;
  // Wave 8 item C: computed for a managed row only — a Darwin row offers no Roll back at all (decision 17), so a
  // reason line there would imply a one-tap exists for it.
  const previousRefusal = darwin || previous === null
    ? null : rollbackTargetRefusal(releases.find((r) => r.tag === previous), n.provenance);
  const previousBlocked = previousRefusal === null || previous === null
    ? null : rollbackBlockedText([{ label: n.label, word: previousRefusal }], previous);
  const reach = reachabilityLine(n, now);
  const request = requestLine(n, now);
  const ackable = canAck(n, releases);

  const ack = (): void => {
    setAcking(true);
    void sendAck(n.nodeId).finally(() => {
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
      ? <span className="settings-node-detail">{resolveDetailLine(n.resolveDetail, n, catalogueLastOkAt)}</span>
      : null;
  }
  // Wave 8 item F4: a finished move merges the state and detail lines into one, dated; anything else keeps them apart.
  const finished = finishedLine(n, now);

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
      {finished !== null ? (
        <p className="settings-node-detail" data-testid="settings-node-finished">{finished}</p>
      ) : (
        <>
          <p className="settings-node-detail">{nodeStateLine(n)}</p>
          {/* The dispatcher's own word for this row (`updateDetail` on the wire): halted, busy — …, a spawn's stderr
              line, deadline, met: … — one printable line the server already bounds, rendered as a text child. */}
          {typeof n.update?.detail === 'string' && n.update.detail !== '' && <p className="settings-node-detail">{n.update.detail}</p>}
        </>
      )}
      {previousBlocked !== null && <p className="settings-node-detail">{previousBlocked}</p>}
      <div className="settings-node-actions">
        {!darwin && (
          <>
            <Button
              variant="ghost" size="fit" className="settings-move"
              disabled={next === null}
              onClick={() => { if (next !== null) onMove({ scope: 'node', direction: 'update', nodeId: n.nodeId, tag: next }); }}
            >
              Update
            </Button>
            <Button
              variant="ghost" size="fit" className="settings-move"
              disabled={previous === null || previousRefusal !== null}
              onClick={() => { if (previous !== null && previousRefusal === null) onMove({ scope: 'node', direction: 'rollback', nodeId: n.nodeId, to: previous }); }}
            >
              Roll back
            </Button>
          </>
        )}
        <Button variant="ghost" size="fit" className="settings-move" disabled={!ackable || acking} onClick={ack}>Ack</Button>
      </div>
    </li>
  );
}

function NodeList({ nodes, releases, now, catalogueLastOkAt, onAcked, onMove }: {
  nodes: readonly NodeWire[]; releases: readonly ReleaseWire[]; now: number; catalogueLastOkAt: number | null; onAcked: () => void;
  onMove: (intent: MoveIntent) => void;
}): ReactNode {
  if (nodes.length === 0) return null;
  return (
    <ul className="settings-nodes" aria-label="Nodes">
      {nodes.map((n) => (
        <NodeItem
          key={n.nodeId} node={n} releases={releases} now={now} catalogueLastOkAt={catalogueLastOkAt} onAcked={onAcked} onMove={onMove}
        />
      ))}
    </ul>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────────
// THE PICKER ENUMERATES NOTHING. `THEMES` comes from @ccrc/ui, which is bound
// to the `[data-theme]` blocks in tokens.css by `theme-catalogue.test.ts` in
// both directions — so a palette cannot ship without a row here, and a row
// here cannot name a palette that does not exist.
//
// Applying is IMMEDIATE and there is no Save: the control's effect is the
// preview, and a theme you cannot see until you confirm it is a theme you
// chose blind. `setTheme` both stamps the document and remembers the choice.
//
// Each row carries its own swatches, and they are not decoration — they are
// the palette itself, drawn by stamping `data-theme` on the swatch element so
// the very tokens the row names resolve inside it. A row that lies about its
// colours is impossible: there is no second copy of them to drift.
function ThemeRow({ choice, current, onPick, swatch = true }: {
  /** Structural, not `ThemeChoice`: "Follow system" is not a palette and
   *  carries no `mode`, but it IS this row — same label over the same note,
   *  same radio, in the same group. It was written out a second time instead,
   *  and the markup census found it. */
  choice: { id: string; label: string; note: string };
  current: string;
  onPick: (id: string) => void;
  /** "Follow system" draws none: there is no single palette to preview, and
   *  five swatches of whichever one happens to be applied would be a preview
   *  of the wrong thing. */
  swatch?: boolean;
}): ReactNode {
  const active = current === choice.id;
  return (
    <label className="settings-option settings-theme" data-active={active}>
      <input
        type="radio"
        name="settings-theme"
        value={choice.id}
        checked={active}
        onChange={() => onPick(choice.id)}
      />
      <span className="settings-theme-body">
        <span className="settings-theme-name">{choice.label}</span>
        <span className="settings-note">{choice.note}</span>
      </span>
      {/* `data-theme` on the swatch itself: tokens.css's blocks are plain
          attribute selectors, so they resolve on ANY element, not just the
          root. The preview is therefore the real palette rather than a
          hand-copied approximation of it. `phosphor` carries no block — it is
          :root — so it deliberately stamps nothing and inherits the default. */}
      {swatch && (
        <span
          className="settings-theme-swatch"
          aria-hidden="true"
          {...(choice.id === PHOSPHOR ? {} : { 'data-theme': choice.id })}
        >
          <i style={{ background: 'var(--bg-surface)' }} />
          <i style={{ background: 'var(--ink-primary)' }} />
          <i style={{ background: 'var(--accent)' }} />
          <i style={{ background: 'var(--status-attention)' }} />
          <i style={{ background: 'var(--status-dead)' }} />
        </span>
      )}
    </label>
  );
}

/** Not a palette, and deliberately not in `THEMES`: the generator writes that
 *  list and `themes:check` rules on it. This is the row that says "whichever
 *  of those two the phone is in". */
const FOLLOW_SYSTEM = {
  id: SYSTEM,
  label: 'Follow system',
  note: 'Phosphor & Ink after dark, Phosphor Daylight otherwise.',
};

/** Exported for its test. The rest of this screen mounts a `/api/updates`
 *  poll, and a test of a radio group should not need a control plane. */
export function AppearanceSection(): ReactNode {
  const titleId = useId();
  // Seeded from storage rather than defaulted, so the control opens showing
  // what is actually applied — including on a reload into a pinned palette.
  const [current, setCurrent] = useState(() => storedTheme());
  const pick = (id: string): void => { setTheme(id); setCurrent(id); };

  const dark = THEMES.filter((t) => t.mode === 'dark');
  const light = THEMES.filter((t) => t.mode === 'light');

  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Appearance</h2>
      <fieldset className="settings-fieldset">
        <legend className="settings-legend">Theme</legend>
        <ThemeRow choice={FOLLOW_SYSTEM} current={current} onPick={pick} swatch={false} />
        {/* Grouped by how the palette reads, because that is the first thing
            anyone is choosing between — and the ask was light AND dark, not a
            dark list with one light apology. */}
        <p className="settings-legend settings-theme-group">Dark</p>
        {dark.map((t) => <ThemeRow key={t.id} choice={t} current={current} onPick={pick} />)}
        <p className="settings-legend settings-theme-group">Light</p>
        {light.map((t) => <ThemeRow key={t.id} choice={t} current={current} onPick={pick} />)}
      </fieldset>
    </section>
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
        <RadioFieldset
          legend="Release notifications"
          name="settings-notify"
          options={NOTIFY_MODES.map((m) => ({ value: m, label: NOTIFY_LABELS[m] }))}
          value={checked}
          onPick={(m) => void choose(m)}
          disabled={saving}
        />
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
        <BackButton className="settings-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </BackButton>
        <h1 className="settings-title">Settings</h1>
      </header>
      <UnarmedExposureBanner />
      <AppearanceSection />
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
  // Fix round 1 (F5, item 5): the refusal carries the VIEW that was current
  // when the route named these ids, alongside the ids themselves — not just
  // the ids — so a LATER poll can be told from the one already in hand at
  // 409-time by identity, never by content (every real poll answer is a
  // fresh object even when nothing about the fleet changed, so an identity
  // test, not a content one, is what "a later poll" means here).
  //
  // W5 review 161 (F-A, the coordinator's ruling; corrects this comment's
  // earlier text, which said the opposite): the write's OWN immediate reload
  // (`writeIntent`'s `.finally(reload)`) IS that later poll. The latest
  // measurement supersedes the route's node list, so the route's list is
  // what the note names only until that reload lands, and from then on the
  // note names the poll's own `missing`.
  //
  // W5 review 161 (F-A): "the view that was current when the route named
  // these ids" is the view live at 409-LANDING time, never the one closed
  // over at TAP time. `writeIntent` is redefined every render, so its own
  // `.then`/`.catch` closes over whatever `view` this function's PARAMETER
  // was on the render that DEFINED it — the render active when the radio was
  // tapped. A routine 60 s poll landing anywhere in that gap (before the 409
  // arrives, and so before this instance's own reload) re-renders the
  // component with a NEW `view` object; the closure does not see it. Stamping
  // `gateRefusal.view` from that stale closure would then compare unequal to
  // the CURRENT `view` prop on the very next render — superseding the note
  // immediately, before it was ever shown, off a poll that was never "later"
  // than the 409 it is compared against. `viewRef` below is written on every
  // render, so the catch handler reads the view genuinely current at the
  // instant the 409 lands; the write's OWN `.finally()` reload is then the
  // first poll that can ever supersede it, exactly as F5 intended.
  const viewRef = useRef(view);
  viewRef.current = view;
  const [gateRefusal, setGateRefusal] = useState<{ ids: string[]; view: UpdatesView } | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  // The move the operator is confirming — a plan taken at the tap, so a poll
  // landing while the sheet is open cannot change the list under a thumb.
  const [move, setMove] = useState<PlannedMove | null>(null);
  const openMove = (intent: MoveIntent): void => setMove(planMove(view, intent));

  const fleet = view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null;
  const missing = autoGateMissing(view.nodes);
  const labelOf = (id: string): string => view.nodes.find((n) => n.nodeId === id)?.label ?? id;
  // The route's answer, when it gave one, is the authority over the poll's —
  // but only until a LATER poll has landed (F5): while `gateRefusal.view` is
  // still the exact view active when the route named these ids, its list
  // stands unfiltered (the route may know something this same poll's own
  // measured caps do not yet). Once a poll strictly after that one lands, the
  // route's list is SUPERSEDED, not intersected with it: the note becomes
  // that poll's own `missing` in full, never `gateRefusal.ids ∩ missing`.
  // Fix round 2 (review of d5aefc4a, item 1): intersecting was itself a bug —
  // a 409 naming only node A while B is ALSO missing (the route reports one
  // culprit; the poll's own measured caps can show more) would, once A
  // cleared, filter the note down to the empty set and lose B entirely, even
  // though B's radios stay disabled (`missing.length > 0`, unaffected by this
  // note) with no reason given on screen. A 409's stale list must not outlive
  // the poll that answers it — and once it is superseded, the poll's full,
  // current `missing` is the one true answer, not a subset of the route's
  // now-stale one.
  const gateLabels = (gateRefusal !== null && gateRefusal.view === view)
    ? gateRefusal.ids.map(labelOf)
    : missing.map((n) => n.label);
  const gateNote = gateLabels.length > 0 ? `${AUTO_GATE_NOTE}${gateLabels.join(', ')}` : null;
  const line = catalogueLine(view.catalogue, now);
  // Wave 8 item F1: the same unplaceable-reads-as-null rule catalogueLine's own `lastOkAt` classification uses
  // (:136), so a node's resolveDetail is qualified on the same basis the catalogue line itself is.
  const catalogueLastOkAt = view.catalogue.lastOkAt !== null && isPlaceableInstant(view.catalogue.lastOkAt)
    ? view.catalogue.lastOkAt : null;

  const writeIntent = (patch: { channel: UpdateChannel } | { auto: AutoMode }): void => {
    setBusy(true);
    if ('auto' in patch) setGateRefusal(null);
    void api.setUpdateIntent({ scope: FLEET_SCOPE, ...patch })
      .then(
        (answer) => { if (answer === 'unreadable') toast(UNCONFIRMED_TEXT); },
        (err: unknown) => {
          const refused = gateRefusalOf(err);
          // viewRef.current, not the closed-over `view` param (W5 F-A): the
          // view genuinely current when this 409 lands, never the one active
          // at the tap that started the write.
          if (refused !== null) setGateRefusal({ ids: refused, view: viewRef.current });
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
      <RadioFieldset
        legend="Channel"
        name="settings-channel"
        options={UPDATE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_SENTENCES[c] }))}
        value={fleet?.channel ?? null}
        onPick={(c) => writeIntent({ channel: c })}
        disabled={busy}
      />
      <RadioFieldset
        legend="Auto-install"
        name="settings-auto"
        /* D-3315: only the non-'off' choices are gated on the node caps — the
           route accepts `auto: 'off'` unconditionally (server/src/update/routes.ts),
           so disabling the whole fieldset would remove the one safe action
           exactly when the gate is incomplete. */
        options={AUTO_MODES.map((m) => ({
          value: m,
          label: AUTO_LABELS[m],
          disabled: m !== 'off' && missing.length > 0,
        }))}
        value={fleet?.auto ?? null}
        onPick={(m) => writeIntent({ auto: m })}
        disabled={busy}
        describedBy={gateNote !== null ? gateNoteId : undefined}
      />
      {gateNote !== null && <p id={gateNoteId} className="settings-note">{gateNote}</p>}
      <Button variant="ghost" className="settings-check" disabled={busy} onClick={checkNow}>
        Check now
      </Button>
      {refreshNote !== null && <p className="settings-note" aria-live="polite">{refreshNote}</p>}
      <p className={line.tone === 'calm' ? 'settings-catalogue' : `settings-catalogue settings-catalogue--${line.tone}`}>
        {line.text}
      </p>
      {view !== null && <ReleaseList releases={view.releases} nodes={view.nodes} onMove={openMove} />}
      {view !== null && (
        <NodeList
          nodes={view.nodes} releases={view.releases} now={now} catalogueLastOkAt={catalogueLastOkAt} onAcked={reload} onMove={openMove}
        />
      )}
      <UpdateMoveSheet open={move !== null} plan={move} onClose={() => setMove(null)} onDone={reload} />
    </>
  );
}
