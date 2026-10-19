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
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  CatalogueErrorReason, CatalogueState, NodeWire, ReleaseSourceWire, ReleaseWire, UpdateChannel,
} from '../../../shared/api';
import {
  SETTLED_UPDATE_STATES, isReleaseTag, isStampRead, isUpdateChannel,
  rollbackTargetRefusal, settledDoneDetail,
} from '../../../shared/api';
import { compareReleaseTags, isNewerTag } from '../../../shared/semver';
import { Button, RESET_LIST, elapsedWords } from '@ccrc/ui';

// Re-exported for `SettingsScreen`'s box-token card, which reads the same two
// clocks this surface does. One import of the clock vocabulary per screen,
// rather than two screens reaching separately into `@ccrc/ui` and `./updates`.
export { elapsedWords };
import {
  isManagedNode, rollbackBlockers, type MoveIntent,
} from '../fleet/movePlan';
import { ACK_UNREADABLE_TEXT, AckConfirm, canAck, sendAck } from '../fleet/updateAck';
import { WITHDRAWN_KEPT_CLAUSE, rollbackBlockedText } from '../fleet/UpdateMoveSheet';
import { haltingNodes, updateAllHaltedText } from '../fleet/updateHalt';
import { isPlaceableInstant, newestPending, nodeVersion, pendingTag } from '../fleet/useUpdatesView';
import { NO_NOTES_TEXT, NoteText, ReleaseNotes, hasReleaseNotes } from '../fleet/ReleaseNotes';
import { RELEASE_NOTE_GROUPS, parseReleaseNotes } from '../../../shared/release-notes';
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
//   * NOTES ARE TEXT. Same-user-writable, capped by the poller (W2), and rendered
//     only through `ReleaseNotes` and its `NoteText` (D-5549): text children, no
//     markdown pass, no HTML, and one link, a `#NNN` number built into a URL by
//     `pullUrl`. No raw-HTML prop and no element of its own here (a source scan
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

// ── The release window of three (D-5505; settings spec §7) ──────────────────
// The catalogue carries every release; the list shows at most three in any group, in every fleet state. A window,
// not a filter: what is left out is COUNTED (newerHidden, olderHidden) and named with the way to reach it (the
// What's-new sheet for newer changes, the CLI for an older release), so no release is hidden without a word.
// Built only from sortReleases, releaseDirection's managed set, pendingTag (through newestPending, the banner's own
// rule), nodeVersion, previousVersion, highestVersion with floorRead, each row's channel and yanked, and the fleet
// channel, so the window, the banner and a row's button cannot disagree. The server and the wire carry every row
// (spec §15.3's residue): the cap is the PWA's slice.

/** The most rows any group of the window holds (spec §7, ruling D1). Both groups read it. */
export const RELEASE_WINDOW_MAX = 3;

/** One row of the window. `ranBefore`: the fleet's shared previousVersion (spec §7.2 item 3). `floored`: the managed
 *  nodes whose floor (highestVersion) is at or above this Newer row's tag, so dispatch answers `not-newer` there;
 *  `installBlocked` when that is every managed node, so an Install would take nothing forward. */
export interface WindowRow { release: ReleaseWire; ranBefore: boolean; floored: string[]; installBlocked: boolean }

export interface ReleaseWindow {
  /** Measured: every managed node's version is a release tag and the channel was read. Unmeasured: a managed node
   *  is unmeasured or unversioned, or the channel is unread. Unmanaged: no managed node (every node is macOS). */
  state: 'measured' | 'unmeasured' | 'unmanaged';
  /** Measured: the Newer group. Unmeasured and unmanaged: the one "Releases" group (the newest three). */
  newer: WindowRow[];
  /** Newer releases on the fleet's channel not shown (withdrawn ones are never Newer, so never counted here). */
  newerHidden: number;
  /** A uniform measured fleet's running tag and its catalogue row (null when the catalogue no longer lists it). */
  running: { tag: string; release: ReleaseWire | null } | null;
  /** A mixed measured fleet's oldest and newest managed versions. */
  mixed: { lo: string; hi: string } | null;
  /** Roll back to. Empty outside the measured state: nothing is rolled back from a guess. */
  rollback: WindowRow[];
  /** Release-tag rows older than the window's last group that it does not show, of any channel. */
  olderHidden: number;
  /** Which lead line the Roll back group states: Stable releases only, or every release. */
  rule: 'stable' | 'dev';
  /** The waiting release (newestPending's tag), or null. */
  pending: string | null;
  /** The managed nodes that have not reported a version (nodeVersion null): one of the unmeasured state's reasons. */
  unreported: string[];
  /** The managed nodes that reported a version but carry no measurement (measuredAt missing): the other reason. */
  notMeasured: string[];
  /** The catalogue holds no row, so ReleaseList draws nothing; the one predicate both it and the halt line read. */
  empty: boolean;
}

function onChannel(r: ReleaseWire, channel: UpdateChannel | null): boolean {
  // Dev sees every release, a channel this build cannot name included; Stable sees Stable only. An unread channel
  // narrows nothing (the unmeasured state's "any channel when it is unread").
  return channel === 'stable' ? r.channel === 'stable' : true;
}

const row = (release: ReleaseWire, ranBefore = false, floored: string[] = [], installBlocked = false): WindowRow =>
  ({ release, ranBefore, floored, installBlocked });

export function releaseWindow(
  releases: readonly ReleaseWire[], nodes: readonly NodeWire[], channel: UpdateChannel | null | undefined,
): ReleaseWindow {
  const fleetChannel = isUpdateChannel(channel) ? channel : null;
  const rule: 'stable' | 'dev' = fleetChannel === 'stable' ? 'stable' : 'dev';
  const tagged = sortReleases(releases).filter((r) => isReleaseTag(r.tag));
  const managed = nodes.filter(isManagedNode);
  const pending = newestPending(nodes)?.tag ?? null;
  const unreported = managed.filter((n) => nodeVersion(n) === null).map((n) => n.label);
  const notMeasured = managed.filter((n) => nodeVersion(n) !== null && typeof n.measuredAt !== 'number').map((n) => n.label);
  const base = {
    newerHidden: 0, running: null, mixed: null, rollback: [], rule, pending, unreported, notMeasured,
    empty: releases.length === 0,
  };

  // Unmanaged and unmeasured: the newest three on the channel, and a count of the older rows below them.
  if (managed.length === 0 || unreported.length > 0 || notMeasured.length > 0 || fleetChannel === null) {
    // D-5608: the unmeasured group offers a button on every row, so a withdrawn release (which the server refuses to
    // install, `unknown-tag`) takes no slot there, as it takes none in Newer. The unmanaged group draws no button and
    // keeps them, marked.
    const unmanaged = managed.length === 0;
    const shown = tagged.filter((r) => onChannel(r, fleetChannel) && (unmanaged || r.yanked !== true))
      .slice(0, RELEASE_WINDOW_MAX);
    const last = shown[shown.length - 1];
    const olderHidden = last === undefined
      ? tagged.length
      : tagged.filter((r) => compareReleaseTags(r.tag, last.tag) === -1 && !shown.includes(r)).length;
    return { ...base, state: unmanaged ? 'unmanaged' : 'unmeasured', newer: shown.map((r) => row(r)), olderHidden };
  }

  const versions = managed.map((n) => nodeVersion(n) as string).sort(compareReleaseTags);
  const lo = versions[0] as string;
  const hi = versions[versions.length - 1] as string;

  // 1. Newer: strictly newer than hi, on the channel, never withdrawn (the server refuses to install one), the
  //    waiting release first even when it is not the newest.
  const candidates = tagged.filter((r) => isNewerTag(r.tag, hi) && onChannel(r, fleetChannel) && r.yanked !== true);
  const waiting = candidates.find((r) => r.tag === pending);
  const ordered = waiting === undefined ? candidates : [waiting, ...candidates.filter((r) => r !== waiting)];
  const newer = ordered.slice(0, RELEASE_WINDOW_MAX).map((r) => {
    const floored = managed
      .filter((n) => isReleaseTag(n.highestVersion) && !isNewerTag(r.tag, n.highestVersion))
      .map((n) => n.label);
    return row(r, false, floored, floored.length === managed.length);
  });

  // 2. Running, or the mixed line: no row between lo and hi on a mixed fleet.
  const mixed = lo === hi ? null : { lo, hi };
  const running = mixed === null ? { tag: hi, release: tagged.find((r) => r.tag === hi) ?? null } : null;

  // 3. Roll back to: strictly older than lo, newest first, Stable only on a Stable fleet; withdrawn rows count
  //    inside the three and blocked rows keep their place. The fleet's shared previous version takes the third slot.
  const older = tagged.filter((r) => isNewerTag(lo, r.tag));
  const picked = older.filter((r) => onChannel(r, fleetChannel)).slice(0, RELEASE_WINDOW_MAX);
  const prevs = new Set(managed.map((n) => n.previousVersion));
  const shared = prevs.size === 1 ? [...prevs][0] : null;
  const prevRow = isReleaseTag(shared) ? older.find((r) => r.tag === shared) : undefined;
  if (prevRow !== undefined && !picked.includes(prevRow)) {
    if (picked.length >= RELEASE_WINDOW_MAX) picked[RELEASE_WINDOW_MAX - 1] = prevRow; else picked.push(prevRow);
    picked.sort((a, b) => compareReleaseTags(b.tag, a.tag));
  }
  const rollback = picked.map((r) => row(r, r === prevRow));
  const olderHidden = older.length - rollback.length;

  return {
    ...base, state: 'measured', newer, newerHidden: candidates.length - newer.length, running, mixed, rollback, olderHidden,
  };
}

/** The Roll back group's lead line (spec §7.2 item 3, §7.5). */
export function rollbackLead(w: Pick<ReleaseWindow, 'rollback' | 'olderHidden' | 'rule'>): string {
  const n = w.rollback.length;
  if (n === 0) {
    return w.rule === 'stable' && w.olderHidden > 0
      ? 'No earlier Stable release to roll back to.'
      : 'No earlier release to roll back to.';
  }
  if (n < RELEASE_WINDOW_MAX) {
    const lead = n === 1
      ? 'The most recent earlier release on this channel.'
      : `The ${n} most recent earlier releases on this channel.`;
    return w.olderHidden === 0 ? `${lead} That is every one on record here.` : lead;
  }
  return w.rule === 'stable'
    ? 'The three most recent earlier Stable releases. Rolling back moves every managed node, one at a time.'
    : 'The three most recent earlier releases, Stable and Dev. Rolling back moves every managed node, one at a time.';
}

/** The closing line under Roll back to, present whenever older releases exist (spec §7.2): the count and the CLI.
 *  The facts are cmd_rollback's `--to`, ccrc rollout's `--to` and `--downgrade`, and CCRC_VERSIONS_KEEP's default. */
export function olderClosingLine(n: number): string {
  const count = n === 1 ? '1 older release is not offered here.' : `${n} older releases are not offered here.`;
  return `${count} To move to one of them, run \`ccrc rollback --to <tag>\` on each node, the fleet box first, or `
    + '`ccrc rollout --to <tag> --downgrade` from your own machine, which moves both boxes in order. A node keeps its '
    + 'newest installed versions on disk (three by default), so a rollback to one of those needs no download.';
}

/** The Newer count line (spec §7.2 item 1); the link under it opens the What's-new sheet. */
export function newerHiddenLine(n: number): string {
  return `${n} more newer ${n === 1 ? 'release' : 'releases'} on this channel ${n === 1 ? 'is' : 'are'} not shown. `
    + 'Installing the newest brings in every change they made.';
}

/** The unmeasured state's lead (spec §7.1, D-5609): what the window is missing, said as it is, then that no rollback
 *  is offered, which the group keeps true by drawing no Roll back. */
export function unmeasuredLead(w: Pick<ReleaseWindow, 'unreported' | 'notMeasured'>): string {
  const clause = (labels: readonly string[], one: string, many: string): string =>
    `${labels.join(', ')} ${labels.length === 1 ? one : many}`;
  const parts = [
    ...(w.unreported.length > 0 ? [clause(w.unreported, 'has not reported a version yet', 'have not reported a version yet')] : []),
    ...(w.notMeasured.length > 0 ? [clause(w.notMeasured, 'has not been measured yet', 'have not been measured yet')] : []),
  ];
  return parts.length > 0
    ? `${parts.join(' and ')}, so no rollback is offered.`
    : 'The channel could not be read, so no rollback is offered.';
}

/** The unmeasured and unmanaged groups' count line (spec §7.1). */
export function olderNotShownLine(n: number): string {
  return `${n} older ${n === 1 ? 'release' : 'releases'} not shown`;
}

/** A Newer row at or below a node's floor (spec §7.2 item 1): dispatch refuses it there (`not-newer`). */
export function floorLine(label: string, tag: string): string {
  return `${label} was rolled back from this release. The server will not reinstall it there and waits for a newer one. `
    + `\`ccrc update --to ${tag}\` on the node moves it by hand.`;
}

/** A withdrawn row's note (spec §7.3), its second clause as cmd_rollback was measured to behave (D-5505's "As
 *  planned"): a complete kept version flips with no release-host question (D-3442); any other tag asks for its
 *  SHA256SUMS first and refuses a withdrawn one. */
export const WITHDRAWN_NOTE = `Its publisher withdrew it from GitHub. ${WITHDRAWN_KEPT_CLAUSE}, and the sheet will say so.`;
/** The word a withdrawn running row adds (spec §7.2 item 2). */
export const WITHDRAWN_RUNNING_TEXT = 'Withdrawn by its publisher';
/** The role word on the fleet's shared previous version (spec §7.2 item 3). */
export const RAN_BEFORE_TEXT = 'Ran before the last update';

/** The words that replaced the badges, with their glossary (spec §7.4). */
export const RELEASE_WORDS = {
  bundle: { word: 'Signed bundle', title: 'The release publishes a signature file, so a node can check what it downloads.' },
  verified: { word: 'Checked on a node', title: 'A node installed it and verified its signature.' },
  withdrawn: { word: 'Withdrawn', title: 'Its publisher withdrew it from GitHub.' },
} as const;

/** A row's one-line summary of what it was (spec §7.4): the first item of the first non-empty group, in
 *  RELEASE_NOTE_GROUPS order; "No changes." for a grouped body with no items; a plain body's first non-empty line;
 *  NO_NOTES_TEXT when there is none. Never the "Changes since …" or "First release" header. */
export function releaseSummary(notes: string | null | undefined): string {
  const read = parseReleaseNotes(notes);
  if (read.kind === 'none') return NO_NOTES_TEXT;
  if (read.kind === 'plain') return read.text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? NO_NOTES_TEXT;
  for (const g of RELEASE_NOTE_GROUPS) {
    const items = read.groups.find((x) => x.name === g)?.items ?? [];
    if (items.length > 0) return items[0] as string;
  }
  return 'No changes.';
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
  return `Refused by ${by.size} of ${m} node${m === 1 ? '' : 's'}`;
}

export function releaseDate(ms: number): string {
  return typeof ms === 'number' && isPlaceableInstant(ms) ? new Date(ms).toISOString().slice(0, 10) : '—';
}

/** One move control — Install, Update, Roll back, Ack. FOUR CALL SITES, and what they
 *  share is the styling triple (`size="fit"` on `.settings-move`, in one of two
 *  variants), not the decision: each carries its own label, its own disabled
 *  condition and its own intent. Named so the triple is written once and a fifth
 *  control cannot style itself differently by accident.
 *
 *  `tone` splits it by intent (D-5507, settings spec §6.1, §6.3): `move`, the
 *  default, is the ghost of Install and Update; `danger` is the red hairline
 *  (`danger-ghost`) of Roll back and Ack, each of which opens a confirm. Both
 *  tones pass `size="fit"`: the old `.btn-ghost.settings-move` sizing rule is
 *  gone, and an app rule for either tone would be a reach-in
 *  (`ui-package-boundary.test.ts`), so the size comes from `Button`. Within a
 *  row the danger control comes after the safe one. `.settings-move` stays on
 *  both as a hook class only. */
function MoveButton({ disabled, onClick, children, describedBy, tone = 'move' }: {
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
  describedBy?: string;
  tone?: 'move' | 'danger';
}): ReactNode {
  return (
    <Button variant={tone === 'danger' ? 'danger-ghost' : 'ghost'} size="fit" className="settings-move"
            disabled={disabled} aria-describedby={describedBy} onClick={onClick}>
      {children}
    </Button>
  );
}

/** Wave 19, R24(a): while a node halts the fleet the dispatcher refuses every move but the Ack (spec §10;
 *  `moveRefusal`'s first clause), so the release window's Install and Update all (`{all: true}`) and every node's
 *  Update wait, and say why with Update all's own reason line, verbatim (`updateAllHaltedText`; who halts is
 *  `haltingNodes`, the dispatcher's own rule from L0). Null when nothing halts. Roll back is not gated here (the
 *  residue item names Install and Update; the route still refuses it with the `halted` sentence). */
function haltedReason(nodes: readonly NodeWire[]): string | null {
  const halting = haltingNodes(nodes);
  return halting.length > 0 ? updateAllHaltedText(halting) : null;
}

/** Whether the window draws a control a halt gates: an Install on a Newer or Releases row, or the mixed fleet's
 *  Update all. The unmanaged state draws no button at all. */
function windowGates(w: ReleaseWindow, nodes: readonly NodeWire[]): boolean {
  // ReleaseList draws nothing for an empty catalogue (the same `empty`), so nothing in it is gated.
  if (w.empty || w.state === 'unmanaged') return false;
  if (w.mixed !== null) return true;
  return w.newer.some((r) => releaseDirection(r.release.tag, nodes) === 'install');
}

/** THE ONE HALT LINE (settings spec §5.1, §11.1; Wave 19 UI-4). Today's two lines, one above the release list and
 *  one above the nodes, are one: first on the page, said only while a control it gates is on screen (an Install,
 *  Update all, or a node's pending Update), and the `aria-describedby` target of each of them. Its added sentence
 *  says where the remedy is on this screen. Null when nothing halts or nothing it gates is drawn. */
export function haltLineText(nodes: readonly NodeWire[], w: ReleaseWindow): string | null {
  const halted = haltedReason(nodes);
  if (halted === null) return null;
  if (!windowGates(w, nodes) && !nodes.some((n) => pendingTag(n) !== null)) return null;
  const which = haltingNodes(nodes).length === 1 ? 'on that node' : 'on each of them';
  return `${halted} Clear it with Ack ${which}, under Nodes, after you have fixed what made it fail.`;
}

export function HaltLine({ id, text }: { id: string; text: string }): ReactNode {
  return <p className="settings-release-refused" id={id}>{text}</p>;
}

/** Wave 8 item C's blocked line. Defined beside the rollback sheet since D-5611, which says it too; re-exported so this
 *  screen's callers and tests keep their import. */
export { rollbackBlockedText };

/** "Refused by 1 of 3 nodes", a sentence that opens the refusals (spec §7.4): which node, and when. */
function RefusedFold({ release: r, nodes }: { release: ReleaseWire; nodes: readonly NodeWire[] }): ReactNode {
  const said = refusedLine(r, nodes);
  if (said === null) return null;
  const refused: readonly unknown[] = Array.isArray(r.refused) ? r.refused : [];
  const lines = refused.flatMap((x) => {
    if (typeof x !== 'object' || x === null || typeof (x as { by?: unknown }).by !== 'string') return [];
    const { by, at } = x as { by: string; at?: unknown };
    const label = nodes.find((n) => n.nodeId === by)?.label ?? by;
    return [`${label} refused it${typeof at === 'number' && isPlaceableInstant(at) ? ` on ${releaseDate(at)}` : ''}`];
  });
  return (
    <details className="settings-release-fold">
      <summary className="settings-release-refused">{said}</summary>
      {lines.map((l, i) => <p key={i} className="settings-note">{l}</p>)}
    </details>
  );
}

/** One release row (spec §7.4): the facts on the left, the row's one action on the right of their first line, and
 *  under both the row's notes, folds and refusal lines. The summary and the meta line are the date's tertiary ink;
 *  withdrawn and refusal words the refusal line's amber; role words the running line's quiet ink. */
function ReleaseItem({ item, nodes, haltedBy, source, waiting, buttons, rollbackOffered, onMove }: {
  item: WindowRow; nodes: readonly NodeWire[]; haltedBy: string | null; source: ReleaseSourceWire | undefined;
  waiting: boolean; buttons: boolean; rollbackOffered: boolean;
  onMove: (intent: MoveIntent) => void;
}): ReactNode {
  const r = item.release;
  const direction = releaseDirection(r.tag, nodes);
  const halted = haltedReason(nodes) !== null;
  // Wave 8 item F2: a running row offers no move — nothing to refuse — so neither is computed for it.
  const blockers = direction === 'rollback' ? rollbackBlockers(nodes, r, r.tag) : [];
  const blocked = direction === 'running' ? null : rollbackBlockedText(blockers, r.tag);
  // By DIRECTION (§13): a release every node runs newer than is a rollback to
  // it, anything else an install of it — the same releaseDirection that
  // labels the button, so the label and the request cannot disagree.
  const intent: MoveIntent | null = direction === 'running' ? null : direction === 'rollback'
    ? { scope: 'fleet', direction: 'rollback', to: r.tag }
    : { scope: 'fleet', direction: 'update', tag: r.tag };
  const gated = direction === 'install' && halted;
  const hasNotes = hasReleaseNotes(r.notes);
  return (
    <li className="settings-release" data-tag={r.tag}>
      <div className="settings-release-facts">
        <p className="settings-release-head">
          <span className="settings-release-tag">{r.tag}</span>
          {isUpdateChannel(r.channel) && (
            <span className={`settings-badge settings-badge--${r.channel}`}>{r.channel}</span>
          )}
        </p>
        <p className="settings-release-date settings-release-summary"><NoteText text={releaseSummary(r.notes)} source={source} /></p>
        <p className="settings-release-meta">
          <span className="settings-release-date">{`Released ${releaseDate(r.publishedAt)}`}</span>
          {item.ranBefore && <span className="settings-release-running">{RAN_BEFORE_TEXT}</span>}
          {r.bundleListed === true && (
            <span className="settings-release-date" title={RELEASE_WORDS.bundle.title}>{RELEASE_WORDS.bundle.word}</span>
          )}
          {verifiedAt(r.tag, nodes) && (
            <span className="settings-release-date" title={RELEASE_WORDS.verified.title}>{RELEASE_WORDS.verified.word}</span>
          )}
          {r.yanked === true && direction !== 'running' && (
            <span className="settings-release-refused" title={RELEASE_WORDS.withdrawn.title}>{RELEASE_WORDS.withdrawn.word}</span>
          )}
        </p>
        {direction === 'running' && (
          <p className="settings-release-running">{releaseRunningText(r.tag, nodes)}</p>
        )}
        {direction === 'running' && r.yanked === true && (
          <p className="settings-release-refused">{WITHDRAWN_RUNNING_TEXT}</p>
        )}
      </div>
      {/* D-5609: the unmeasured group draws no Roll back — its lead says none is offered (nothing is rolled back
          from a guess, spec §7.1). */}
      {buttons && direction !== 'running' && (rollbackOffered || direction !== 'rollback') && (
        <div className="settings-release-actions">
          <MoveButton
            disabled={blockers.length > 0 || gated || (direction === 'install' && item.installBlocked)}
            describedBy={gated && haltedBy !== null ? haltedBy : undefined}
            tone={direction === 'rollback' ? 'danger' : 'move'}
            onClick={() => onMove(intent as MoveIntent)}
          >
            {direction === 'rollback' ? 'Roll back' : 'Install'}
          </MoveButton>
        </div>
      )}
      <RefusedFold release={r} nodes={nodes} />
      {r.yanked === true && direction !== 'running' && <p className="settings-release-refused">{WITHDRAWN_NOTE}</p>}
      {item.floored.map((label) => <p key={label} className="settings-note">{floorLine(label, r.tag)}</p>)}
      {blocked !== null && <p className="settings-release-refused" data-testid="settings-release-blocked">{blocked}</p>}
      {/* D-5549: the What's-new sheet's own rendering — plain text, grouped, `#NNN` linked from the number — behind
          "Notes", open for the waiting release (spec §4.1). A row with no notes draws no disclosure. */}
      {hasNotes && (
        <details className="settings-release-fold settings-release-notes-fold" open={waiting}>
          <summary className="settings-note">Notes</summary>
          <ReleaseNotes notes={r.notes} source={source} />
        </details>
      )}
    </li>
  );
}

function ReleaseGroup({ label, title, items, ...rest }: {
  label: string; title: string | null; items: readonly WindowRow[];
  nodes: readonly NodeWire[]; haltedBy: string | null; source: ReleaseSourceWire | undefined;
  pending: string | null; buttons: boolean; rollbackOffered?: boolean; onMove: (intent: MoveIntent) => void;
}): ReactNode {
  if (items.length === 0) return null;
  return (
    <>
      {title !== null && <h3 className="settings-section-title">{title}</h3>}
      <ul className={`settings-releases ${RESET_LIST}`} aria-label={label}>
        {items.map((it) => (
          <ReleaseItem
            key={it.release.tag} item={it} nodes={rest.nodes} haltedBy={rest.haltedBy} source={rest.source}
            waiting={it.release.tag === rest.pending} buttons={rest.buttons}
            rollbackOffered={rest.rollbackOffered ?? true} onMove={rest.onMove}
          />
        ))}
      </ul>
    </>
  );
}

/** The glossary for the row words, one line under the window's first lead, so a touch reader reaches what a
 *  pointer reader gets from each word's `title` (spec §7.4). */
function WordsGlossary(): ReactNode {
  return (
    <details className="settings-release-fold">
      <summary className="settings-note">What these mean</summary>
      {Object.values(RELEASE_WORDS).map((w) => <p key={w.word} className="settings-note">{`${w.word}: ${w.title}`}</p>)}
    </details>
  );
}

/** The one door to the What's-new sheet on this page, written once: the Fleet version status's "See what's new"
 *  and the Newer count line's "See every change since …" (settings spec §4.1, §7.2). A button, not a link: it opens
 *  a sheet in place, and the notes surfaces carry exactly one link, `NoteText`'s. */
export function WhatsNewButton({ onClick, children }: { onClick: () => void; children: ReactNode }): ReactNode {
  return <Button variant="ghost" size="fit" className="settings-move" onClick={onClick}>{children}</Button>;
}

/** The release window (D-5505): at most three rows in any group, in every fleet state, with what is left out
 *  counted. `channel` is the fleet's (the `'*'` intent's); `haltedBy` is the one halt line's id, when the page
 *  draws it; `onWhatsNew` and `whatsNewSince` open the What's-new sheet from the Newer count line. */
export function ReleaseList({ releases, nodes, channel, source, haltedBy = null, onWhatsNew, whatsNewSince = null, onMove }: {
  releases: readonly ReleaseWire[]; nodes: readonly NodeWire[]; channel?: UpdateChannel | null; source?: ReleaseSourceWire;
  haltedBy?: string | null; onWhatsNew?: () => void; whatsNewSince?: string | null;
  onMove: (intent: MoveIntent) => void;
}): ReactNode {
  const w = releaseWindow(releases, nodes, channel);
  if (w.empty) return null;
  const halted = haltedReason(nodes) !== null;
  const shared = { nodes, haltedBy, source, pending: w.pending, onMove };
  if (w.state !== 'measured') {
    return (
      <section className="settings-window" aria-label="Releases">
        <p className="settings-note">
          {w.state === 'unmanaged' ? 'macOS nodes are updated on the Mac itself.' : unmeasuredLead(w)}
        </p>
        <WordsGlossary />
        <ReleaseGroup label="Releases" title="Releases" items={w.newer} buttons={w.state === 'unmeasured'} rollbackOffered={false} {...shared} />
        {w.olderHidden > 0 && <p className="settings-note">{olderNotShownLine(w.olderHidden)}</p>}
      </section>
    );
  }
  return (
    <section className="settings-window" aria-label="Releases">
      <WordsGlossary />
      <ReleaseGroup label="Newer releases" title="Newer" items={w.newer} buttons {...shared} />
      {w.newerHidden > 0 && (
        <>
          <p className="settings-note">{newerHiddenLine(w.newerHidden)}</p>
          {onWhatsNew !== undefined && (
            <WhatsNewButton onClick={onWhatsNew}>
              {whatsNewSince !== null ? `See every change since ${whatsNewSince}` : 'See every change'}
            </WhatsNewButton>
          )}
        </>
      )}
      {w.mixed !== null ? (
        <>
          <p className="settings-note">{`Nodes run ${w.mixed.lo} to ${w.mixed.hi}.`}</p>
          <div className="settings-release-actions">
            <MoveButton
              disabled={halted}
              describedBy={halted && haltedBy !== null ? haltedBy : undefined}
              onClick={() => onMove({ scope: 'fleet', direction: 'update', tag: (w.mixed as { hi: string }).hi })}
            >
              {`Update all to ${w.mixed.hi}`}
            </MoveButton>
          </div>
        </>
      ) : w.running !== null && w.running.release !== null ? (
        <ReleaseGroup label="Running" title="Running" items={[row(w.running.release)]} buttons {...shared} />
      ) : w.running !== null ? (
        <p className="settings-release-running">{`Every managed node runs ${w.running.tag}.`}</p>
      ) : null}
      {w.rollback.length > 0 && <h3 className="settings-section-title">Roll back to</h3>}
      <p className="settings-note">{rollbackLead(w)}</p>
      <ReleaseGroup label="Roll back to" title={null} items={w.rollback} buttons {...shared} />
      {w.olderHidden > 0 && <p className="settings-note">{olderClosingLine(w.olderHidden)}</p>}
    </section>
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
// wave 5): Update iff pendingTag names a tag and no node halts the fleet (wave
// 19, R24(a): `haltedReason`), Roll back iff previousVersion
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

function NodeItem({ node: n, releases, now, catalogueLastOkAt, halted, haltedBy, onAcked, onMove }: {
  node: NodeWire; releases: readonly ReleaseWire[]; now: number; catalogueLastOkAt: number | null;
  halted: boolean; haltedBy: string | null;
  onAcked: () => void;
  onMove: (intent: MoveIntent) => void;
}): ReactNode {
  const [acking, setAcking] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
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
  // D-5507: the Ack opens AckConfirm, the one confirm the halt banner opens too; only its commit sends. The confirm
  // hands the focus to this row when the Ack it disables was focused (wave 19, R26(a)).
  const [confirming, setConfirming] = useState(false);

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
    <li className="settings-node" data-node-id={n.nodeId} ref={rowRef} tabIndex={-1}>
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
              disabled={next === null || halted}
              describedBy={next !== null && halted && haltedBy !== null ? haltedBy : undefined}
              onClick={() => { if (next !== null) onMove({ scope: 'node', direction: 'update', nodeId: n.nodeId, tag: next }); }}
            >
              Update
            </MoveButton>
            <MoveButton
              disabled={previous === null || previousRefusal !== null}
              tone="danger"
              onClick={() => { if (previous !== null && previousRefusal === null) onMove({ scope: 'node', direction: 'rollback', nodeId: n.nodeId, to: previous }); }}
            >
              Roll back
            </MoveButton>
          </>
        )}
        <MoveButton disabled={!ackable || acking} tone="danger" onClick={() => setConfirming(true)}>Ack</MoveButton>
      </div>
      <AckConfirm node={n} releases={releases} open={confirming} onClose={() => setConfirming(false)} onConfirm={ack} rowRef={rowRef} />
    </li>
  );
}

export function NodeList({ nodes, releases, now, catalogueLastOkAt, haltedBy = null, onAcked, onMove }: {
  nodes: readonly NodeWire[]; releases: readonly ReleaseWire[]; now: number; catalogueLastOkAt: number | null;
  /** The one halt line's id (settings spec §5.1): the page draws the line, and each pending Update it gates names it. */
  haltedBy?: string | null;
  onAcked: () => void;
  onMove: (intent: MoveIntent) => void;
}): ReactNode {
  if (nodes.length === 0) return null;
  const halted = haltedReason(nodes) !== null;
  return (
    <ul className={`settings-nodes ${RESET_LIST}`} aria-label="Nodes">
      {nodes.map((n) => (
        <NodeItem
          key={n.nodeId} node={n} releases={releases} now={now} catalogueLastOkAt={catalogueLastOkAt}
          halted={halted} haltedBy={haltedBy} onAcked={onAcked} onMove={onMove}
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
