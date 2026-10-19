// The Temp root collector section's words (path-identity spec 2026-10-12 §5.7). These are pure tables and line
// builders over the server's view, with no state of their own:
// - Each table is a `Record` over its whole union, so a state the server learns is a compile error here until it has
//   words (`collect-lane-words.test-d.ts` pins that).
// - The section shows what the server measured and decided. Nothing here counts or reads attention items: the
//   server's counts arrive on the view.
// - The spec's own sentences are copied exactly; the rest are this wave's.
// - No sentence names a device, and none names the fleet box's legacy file by its file name.
import {
  isCollectLaneChoice,
  type CollectArmedBy, type CollectLaneConfirmRequired, type CollectLaneRefusal, type CollectLaneView,
} from '../../../shared/api';
import { elapsedWords } from '@ccrc/ui';
import { COORD_UNCONFIRMED_TEXT } from './coordWords';

export type CollectEffectiveState = CollectLaneView['effective']['state'];
type MarkerListing = CollectLaneView['marker']['listing'];
type StoredFault = Exclude<CollectLaneView['stored'], { read: 'row' }>['read'];
type Line = { text: string; tone: 'head' | 'note' | 'warn' };

/** The section's frame, controls and write lines. `notAvailable` is the spec's exact sentence for an older server.
 *  `unanswered` is a write whose answer never arrived, or carried no refusal code this build knows: either may have
 *  stored the choice. The section appends the answer's detail when there was one. */
export const COLLECT_SECTION_TEXT = {
  title: 'Temp root collector',
  notAvailable: 'Not available on this server.',
  unread: "The collector's state could not be read; the section will re-check.",
  stale: 'The latest read did not arrive; this is the last answer that did.',
  // Settings Task R1c (D-5503; settings spec §5.4, §11.2): the legend "Choice" became "Collector", each choice carries
  // a note, and the section opens with its purpose. Off's note is the `shadowed` state the server runs it as.
  purpose: "Each session gets its own temporary directory. When the session's workspace is gone, the directory is left "
    + 'behind. The collector finds these leftovers on the fleet box. Live lets it delete one, only after two audits, at '
    + 'least an idle period apart, have found it unused.',
  legend: 'Collector',
  off: 'Off',
  offNote: 'Watches and reports what it would remove, and removes nothing.',
  live: 'Live',
  liveNote: 'Removes a leftover temporary directory only after two idle audits have found it unused.',
  when: 'Turn it Live once its reports look right. Turn it Off if a removal surprised you.',
  reconfirm: 'Confirm Live again',
  reconfirmWhen: "When the collector's node changed and you still want Live.",
  confirmTitle: 'Set the temp root collector to Live?',
  confirmLabel: 'Set Live',
  unanswered: "The server's answer did not arrive, or was not one this section knows, so the choice may or may not have been saved; the section re-read it.",
} as const;

/** The six Now lines, the spec's exact labels and lines (§5.7). */
export const COLLECT_STATE_TEXT: Readonly<Record<CollectEffectiveState, { readonly label: string; readonly line: string }>> = {
  live: { label: 'Live', line: 'removes an orphaned temp root only after two licensed observations.' },
  shadowed: { label: 'Shadowed', line: 'reports what it would remove and removes nothing.' },
  paused: { label: 'Stopped - cleanup paused', line: 'the broad cleanup pause stands.' },
  'safety-stopped': { label: 'Safety-stopped', line: 'collector control state cannot be proved coherent; removes nothing.' },
  'not-running': { label: 'Not running', line: 'the fleet box lacks collect-v1 or reclaim-pause-v1.' },
  'unknown-fleet': { label: 'Unknown fleet', line: 'the registry, connection epoch or current node cannot be measured.' },
};

/** The Armed by line (§5.7): Settings, the fleet box's legacy file, both during handoff, or neither. */
export const COLLECT_ARMED_BY_TEXT: Readonly<Record<CollectArmedBy, string>> = {
  settings: 'Armed by: Settings.',
  'legacy-marker': "Armed by: the fleet box's legacy file.",
  both: "Armed by: both Settings and the fleet box's legacy file, during the handoff.",
  neither: 'Armed by: neither.',
};

/** The warn lines. `recreated` is the spec's exact sentence; `mismatch` is its sentence, as a sentence. */
export const COLLECT_WARN_TEXT = {
  recreated: "The fleet box's legacy file was re-created; this server no longer honours it.",
  otherNode: 'Live was confirmed for another fleet node; it needs confirming again for this one.',
  mismatch: 'The collector is safety-stopped because its database and monotonic journal disagree.',
  unknownChoice: 'The stored choice is not one this build knows, so it arms nothing.',
} as const;

/** A stored row that did not read: two answers, never folded (§5.6). */
export const COLLECT_STORED_FAULT_TEXT: Readonly<Record<StoredFault, string>> = {
  malformed: 'The stored choice could not be read whole.',
  unreadable: 'The stored choice could not be read.',
};

/** Why Off is disabled before the latch, by what the latest listing showed. `stands` is the spec's exact sentence. */
export const COLLECT_OFF_NOTE_TEXT: Readonly<Record<MarkerListing, string>> = {
  stands: "The fleet box's legacy file still controls this lane. Remove it by hand before Settings can turn the collector off.",
  absent: "The fleet box's legacy file is gone; Settings can turn the collector off once the collector's next check records that.",
  unmeasured: "Whether the fleet box's legacy file still controls this lane cannot be measured now, so Settings cannot turn the collector off yet.",
};

/** A refused write, by the server's code. The detail the server sent is the section's to show beside it. */
export const COLLECT_REFUSAL_TEXT: Readonly<Record<CollectLaneRefusal, string>> = {
  'bad-request': 'The server could not read that choice. Nothing was changed.',
  'not-configured': COLLECT_SECTION_TEXT.notAvailable,
  'sign-in-unarmed': 'Live needs sign-in to be armed on this server. Nothing was changed.',
  'confirm-required': 'Live needs a fresh confirmation of what the server measured. Nothing was changed.',
  'confirm-stale': 'What the server measured changed before the confirmation arrived. Nothing was changed.',
  'marker-still-controls': COLLECT_OFF_NOTE_TEXT.stands,
  conflict: 'The stored choice changed while this one was on its way. Nothing was changed; the section re-reads it.',
  'state-unmeasurable': "The collector's state cannot be measured safely now. Nothing was changed.",
  'write-failed': 'The server could not prove the choice was stored; the section re-reads what stands.',
};

/** The adjacent "Pause all cleanup" action (§5.4, §5.7). It names every lane the switch stops, and offers Pause only:
 *  resuming stays on Runs, so the switch keeps one resume door. */
export const COLLECT_PAUSE_TEXT = {
  label: 'Pause all cleanup',
  stops: 'Pauses all cleanup: child reclamation, archived-workspace expiry, the dead-coordinator lane and this collector. Resume it from the cleanup row on Runs.',
  paused: 'All cleanup is paused. Resume it from the cleanup row on Runs.',
  pausing: 'pausing…',
  unconfirmed: COORD_UNCONFIRMED_TEXT,
} as const;

/** The Live confirm sheet's fixed lines (§5.7). The node and freshness line is composed in `collectConfirmLines`. The
 *  checklist restates README's "Before arming it" list. */
export const COLLECT_CONFIRM_TEXT = {
  staleLead: 'What the server measured changed since the sheet opened; these are the fresh facts.',
  capsBoth: "The fleet box's ccd lists collect-v1 and reclaim-pause-v1.",
  capsNoCollect: "The fleet box's ccd does not list collect-v1: the collector will not run until it does.",
  capsNoReclaimPause: "The fleet box's ccd does not list reclaim-pause-v1: the collector will not run until it does.",
  capsNeither: "The fleet box's ccd lists neither collect-v1 nor reclaim-pause-v1: the collector will not run until it does.",
  paused: 'All cleanup is paused now: the collector removes nothing until the pause is lifted on Runs.',
  markerStands: "The fleet box's legacy file stands. Until this server records its removal it also arms the lane; once that is recorded, only this setting does, and a re-created file is ignored.",
  markerAbsent: "The fleet box's legacy file is gone, so this setting alone arms the lane.",
  repair: "This also repairs the collector's control state: its database and monotonic journal disagree.",
  checklist: [
    "Read the collector's shadow rows in the feed before arming it.",
    'Every would-collect should name an orphan whose run is closed.',
    'No box-wide line should stand in the cleanup row on Runs, except the one for temp roots the coordination database cannot vouch for.',
  ],
} as const;

export const COLLECT_COUNT_TEXT = {
  unmeasured: 'Counts are not measured yet.',
} as const;

/** One state's Now line, as the spec writes it: "Label: line". */
export function collectStateHead(state: CollectEffectiveState): string {
  const t = COLLECT_STATE_TEXT[state];
  return `${t.label}: ${t.line}`;
}

/** The Now block, top to bottom. First the state's head and the Armed by line. Then each warn line whose condition
 *  the view states:
 *  - a re-created file after the latch;
 *  - a stored Live for another node;
 *  - a stored token this build does not know, or a stored row that did not read;
 *  - a mismatch;
 *  - the server's remedy. */
export function collectNowLines(v: CollectLaneView): { text: string; tone: 'head' | 'note' | 'warn' }[] {
  const lines: Line[] = [
    { text: collectStateHead(v.effective.state), tone: 'head' },
    { text: COLLECT_ARMED_BY_TEXT[v.effective.armedBy], tone: 'note' },
  ];
  const warn = (text: string): void => { lines.push({ text, tone: 'warn' }); };
  if (v.marker.listing === 'stands' && v.marker.latch === 'set') warn(COLLECT_WARN_TEXT.recreated);
  const stored = v.stored;
  if (stored.read === 'row') {
    if (stored.choice === 'live' && v.node.state === 'known' && v.node.stored === 'other') warn(COLLECT_WARN_TEXT.otherNode);
    if (!isCollectLaneChoice(stored.choice)) warn(COLLECT_WARN_TEXT.unknownChoice);
  } else {
    warn(COLLECT_STORED_FAULT_TEXT[stored.read]);
  }
  if (v.control.state === 'mismatch') warn(COLLECT_WARN_TEXT.mismatch);
  if (v.remedy !== null) warn(v.remedy);
  return lines;
}

/** A GET that answered 503 `state-unmeasurable` (the switch's row is absent) reads as Safety-stopped, with the
 *  server's bounded detail: the section shows no choice it could write over. */
export function collectUnmeasurableLines(detail: string): { text: string; tone: 'head' | 'note' | 'warn' }[] {
  return [
    { text: collectStateHead('safety-stopped'), tone: 'head' },
    { text: `The server could not measure the collector's state: ${detail}`, tone: 'warn' },
  ];
}

/** Why Off is disabled, or null when it is enabled. Off is enabled only once the latch is SET; before that the note
 *  follows the latest listing: the spec's sentence while the file stands, a pending line once it is gone, and an
 *  unmeasured line otherwise (path-identity spec §5.4). */
export function collectOffNote(v: CollectLaneView): string | null {
  if (v.marker.latch === 'set') return null;
  // A latch that did not read is no proof that the legacy file controls anything: the row is unmeasurable and the lane
  // is safety-stopped, so the note says control cannot be measured, whatever the listing shows.
  if (v.marker.latch === 'unmeasured') return COLLECT_OFF_NOTE_TEXT.unmeasured;
  return COLLECT_OFF_NOTE_TEXT[v.marker.listing];
}

/** "Confirm Live again" is offered for a stored Live confirmed for another, measured node, and for a control mismatch
 *  (which a fresh confirmed Live repairs, §5.6). Never otherwise: an unmeasured node is the server's to measure. */
export function collectOffersReconfirm(v: CollectLaneView): boolean {
  if (v.control.state === 'mismatch') return true;
  return v.stored.read === 'row' && v.stored.choice === 'live' && v.node.state === 'known' && v.node.stored === 'other';
}

/** The would-collect, held and box-wide counts, as the server counted them, or the not-measured line. */
export function collectCountLine(a: CollectLaneView['attention']): string {
  if (a === null) return COLLECT_COUNT_TEXT.unmeasured;
  return `${a.wouldCollect} would be collected, ${a.held} held, ${a.boxLines} box-wide ${a.boxLines === 1 ? 'line' : 'lines'} on Runs.`;
}

/** The confirm sheet's lines, from the 409's facts, in this order:
 *  1. the stale lead (only when stale);
 *  2. the node and how fresh its measurement is;
 *  3. the capabilities;
 *  4. the pause (only when it stands);
 *  5. the counts;
 *  6. the before-arming checklist;
 *  7. the legacy file;
 *  8. the repair (only when there is one).
 *  `now` is the viewer's clock, for `elapsedWords`. */
export function collectConfirmLines(facts: CollectLaneConfirmRequired['facts'], stale: boolean, now: number): string[] {
  const t = COLLECT_CONFIRM_TEXT;
  const caps = facts.caps.collect
    ? (facts.caps.reclaimPause ? t.capsBoth : t.capsNoReclaimPause)
    : (facts.caps.reclaimPause ? t.capsNoCollect : t.capsNeither);
  return [
    ...(stale ? [t.staleLead] : []),
    `Fleet node ${facts.node.nodeId}, measured on this server's current connection ${elapsedWords(now - facts.node.measuredAt)} ago.`,
    caps,
    ...(facts.paused ? [t.paused] : []),
    collectCountLine(facts.attention),
    ...t.checklist,
    facts.marker === 'stands' ? t.markerStands : t.markerAbsent,
    ...(facts.repair !== null ? [t.repair] : []),
  ];
}
