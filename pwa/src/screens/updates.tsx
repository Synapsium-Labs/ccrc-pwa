// The update plane's reading surface — releases, nodes, and the sentences
// that describe them.
//
// WHY IT IS ITS OWN FILE. `SettingsScreen.tsx` was 1007 lines holding four
// unrelated sections and thirty-four named declarations. It was not tangled —
// every piece already had a name — but half the file was this one subject:
// twenty pure helpers that turn a `NodeWire`/`ReleaseWire` into a sentence,
// and the four components that render them.
//
// IT IS THE HALF WITH THE TESTS. Eighteen of the names here are exported for
// `pwa/test/settings-screen.test.tsx`, which asserts their sentences directly
// — `currentText`, `requestLine`, `finishedLine`, `refusedLine`,
// `reachabilityLine`, `resolveDetailLine` and the rest. A file whose exports
// exist for a test is a file with a subject, and this is it.
//
// WHAT STAYED BEHIND: the appearance picker, the notification toggle, the
// exposure banner, the radio-group helper they share, and `SettingsScreen`
// itself with the `UpdatesSection` that composes what is here.
//
// `ACK_UNREADABLE_TEXT` and `canAck` CAME WITH IT, re-exported as they were:
// `NodeItem` is their consumer, and `pwa/test/halt-banner.test.tsx` asserts
// the re-export is the SAME binding as the one in `fleet/updateAck` — the
// point of that assertion is the identity, not which file carries it.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CatalogueErrorReason, CatalogueState, NodeWire, ReleaseWire, UpdateChannel,
} from '../../../shared/api';
import {
  SETTLED_UPDATE_STATES, isReleaseTag, isStampRead, isUpdateChannel,
  rollbackTargetRefusal, settledDoneDetail,
} from '../../../shared/api';
import { compareReleaseTags, isNewerTag } from '../../../shared/semver';
import { Button, elapsedWords } from '@ccrc/ui';
import {
  isManagedNode, rollbackBlockers, type MoveIntent, type RollbackBlocker,
} from '../fleet/movePlan';
import { ACK_UNREADABLE_TEXT, canAck, sendAck } from '../fleet/updateAck';
import { isPlaceableInstant, nodeVersion, pendingTag } from '../fleet/useUpdatesView';
import { moveSkipText, noBundleRollbackText } from '../lib/api';
import '../fleet/fleet.css';

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

/** One move control — Install, Roll back, Ack. FOUR CALL SITES, and what they
 *  share is the styling triple (`variant="ghost" size="fit"` on
 *  `.settings-move`), not the decision: each carries its own label, its own
 *  disabled condition and its own intent. Named so the triple is written once
 *  and a fifth control cannot style itself differently by accident. */
function MoveButton({ disabled, onClick, children }: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <Button variant="ghost" size="fit" className="settings-move"
            disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
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
            <MoveButton disabled={blockers.length > 0} onClick={() => onMove(intent as MoveIntent)}>
              {direction === 'rollback' ? 'Roll back' : 'Install'}
            </MoveButton>
          )}
      </div>
    </li>
  );
}

export function ReleaseList({ releases, nodes, onMove }: {
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
            <MoveButton
              disabled={next === null}
              onClick={() => { if (next !== null) onMove({ scope: 'node', direction: 'update', nodeId: n.nodeId, tag: next }); }}
            >
              Update
            </MoveButton>
            <MoveButton
              disabled={previous === null || previousRefusal !== null}
              onClick={() => { if (previous !== null && previousRefusal === null) onMove({ scope: 'node', direction: 'rollback', nodeId: n.nodeId, to: previous }); }}
            >
              Roll back
            </MoveButton>
          </>
        )}
        <MoveButton disabled={!ackable || acking} onClick={ack}>Ack</MoveButton>
      </div>
    </li>
  );
}

export function NodeList({ nodes, releases, now, catalogueLastOkAt, onAcked, onMove }: {
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
