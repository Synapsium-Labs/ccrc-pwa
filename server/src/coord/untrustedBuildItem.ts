// THE UNTRUSTED-BUILD ITEM (approvals plan 2026-11-18, §3.2.2 and Task 2.2). Ring L1, context C6: pure, no I/O, no clock.
//
// A child whose live Claude Code build is not trusted (`buildTrustOf`, D-8289) has its permission prompt refused at mint,
// `version-unverified` (Table 2a, path 2), so the prompt reaches the operator with no coordinator in the loop. The census
// counts each one (PR 1); this raises ONE Waiting on you item per untrusted build, keyed by the build (the item's
// `untrusted-build` action), so the operator learns why and what ends it: the build's capture (D-8289's queue). A second
// refusal for the same build while its item is open raises nothing. When the record says the build passed its capture,
// ccrc settles the item (`untrustedBuildItemsToSettle`, asked once a minute by the capture lane's pass).
//
// The questions owner raises (`raiseApproval`'s refusal arm) and the capture lane settles; both act on these answers only.
import { buildTrustOf, buildUntrustedSentence, type BuildUntrustedReason, type ClaudeBuildRecord } from '../../../shared/claudeBuildTrust.js';
import { isClaudeVersion } from '../../../shared/claudeVersion.js';
import { isUntrustedBuildAction, UNTRUSTED_BUILD_SETTINGS_PATH, UNTRUSTED_BUILD_VERB, type ItemAction } from '../../../shared/ledgers.js';
import { OVERLORD_PROJECT } from '../../../shared/overlord-designation.js';
import type { RaiseItemInput } from './ledgersStore.js';

/** The programme the item is raised on: the Overlord's, the approvals plan's home (the quiz lane's precedent). */
export const UNTRUSTED_BUILD_ITEM_PROGRAMME = OVERLORD_PROJECT;

/** The reasons that are a fact about the BUILD. `unread` (the child's build could not be read) and `record-unreadable` (the
 *  record could not be read) are read failures with no build to key an item by, so they raise none. */
const BUILD_FACT_REASONS: ReadonlySet<BuildUntrustedReason> = new Set<BuildUntrustedReason>(['not-captured', 'capture-queued', 'capture-failed']);

/** The open untrusted-build items, by their build, from the programme's open items (any other item is left out). */
export function openUntrustedBuildItems(open: readonly { readonly id: number; readonly action?: ItemAction | null }[]): { id: number; build: string }[] {
  return open.flatMap((i) => {
    const a = i.action ?? null;
    return isUntrustedBuildAction(a) ? [{ id: i.id, build: a.build }] : [];
  });
}

/** The item to raise for a `version-unverified` refusal, or null: none for a reason that is no fact about the build, for a
 *  version that is not a Claude Code version, or for a build whose item is already open (`openBuilds`, the key). */
export function untrustedBuildItemOf(
  openBuilds: ReadonlySet<string>, version: string | null, reason: BuildUntrustedReason,
): RaiseItemInput | null {
  if (!isClaudeVersion(version) || !BUILD_FACT_REASONS.has(reason) || openBuilds.has(version)) return null;
  return {
    program: UNTRUSTED_BUILD_ITEM_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do',
    title: `Children on Claude Code ${version} cannot route permission prompts until it is captured`,
    why: `A child's permission prompt was refused because ${buildUntrustedSentence(reason, version)}. Until the build passes its `
      + 'capture, every prompt of a child on it comes straight to you, with no coordinator to rule on it first.',
    how: [
      `Open ${UNTRUSTED_BUILD_SETTINGS_PATH} and find Claude Code ${version} in the Test box's build list.`,
      'If its capture failed, read the output and choose Capture again.',
      'A build waiting for its capture stays waiting while no test box can capture it: none is reachable, or the box has no '
        + 'capture runner. It is captured on its own once one can.',
      'ccrc closes this item once the build passes its capture.',
    ],
    options: null,
    // `soon` with no label: nothing pushes (the capture lane's own failure notice already does); never blocking.
    neededBy: 'soon', soonLabel: null, secretSlot: null,
    action: { verb: UNTRUSTED_BUILD_VERB, build: version },
  };
}

/** The open items whose build the record now trusts (it passed its capture): the ones to settle. A record that could not be
 *  read settles nothing. */
export function untrustedBuildItemsToSettle(
  open: readonly { readonly id: number; readonly build: string }[], records: readonly ClaudeBuildRecord[] | null,
): { id: number; build: string }[] {
  if (records === null) return [];
  return open.filter((i) => buildTrustOf(records, i.build).kind === 'trusted');
}

/** The note an item settles with. */
export const UNTRUSTED_BUILD_SETTLED_NOTE = 'The build passed its capture, so its children route permission prompts again.';
