// THE UNTRUSTED-BUILD ITEM (approvals plan 2026-11-18, §3.2.2 and Task 2.2; narrowed by the Overlord's "a new Claude Code
// release needs no operator", `docs/superpowers/programs/overlord/claude-release-unattended.md`, slug
// item-only-when-given-up). Ring L1, context C6: pure, no I/O, no clock.
//
// A build that is queued, being captured or being captured again after a failure is ccrc's own work: the Test box card shows
// where it stands, and nothing waits on the operator. So this raises ONE Waiting on you item per build only when ccrc has
// given up on it (`captureGivenUp`: its capture failed {@link BUILD_CAPTURE_FAIL_CEILING} times), keyed
// by the build (the item's `untrusted-build` action), and names the act only the operator can do: Capture again, the
// session-gated door, once the cause is fixed. The capture lane raises it on any pass that finds a build given up with no
// open item and a session still on it (`untrustedBuildItemsToRaise`), and settles every open one whose build is no longer
// given up (`untrustedBuildItemsToSettle`): trusted, or back in ccrc's hands.
//
// The capture lane raises and settles; it acts on these answers only.
import { BUILD_CAPTURE_FAIL_CEILING, captureGivenUp, captureStandingOf, givenUpToTell, type ClaudeBuildRecord } from '../../../shared/claudeBuildTrust.js';
import { isClaudeVersion } from '../../../shared/claudeVersion.js';
import { isUntrustedBuildAction, UNTRUSTED_BUILD_SETTINGS_PATH, UNTRUSTED_BUILD_VERB, type ItemAction } from '../../../shared/ledgers.js';
import { OVERLORD_PROJECT } from '../../../shared/overlord-designation.js';
import type { RaiseItemInput } from './ledgersStore.js';

/** The programme the item is raised on: the Overlord's, the approvals plan's home (the quiz lane's precedent). */
export const UNTRUSTED_BUILD_ITEM_PROGRAMME = OVERLORD_PROJECT;

/** The open untrusted-build items, by their build, from the programme's open items (any other item is left out). */
export function openUntrustedBuildItems(open: readonly { readonly id: number; readonly action?: ItemAction | null }[]): { id: number; build: string }[] {
  return open.flatMap((i) => {
    const a = i.action ?? null;
    return isUntrustedBuildAction(a) ? [{ id: i.id, build: a.build }] : [];
  });
}

const times = (n: number): string => (n === 1 ? 'once' : `${n} times`);

/** The item to raise for a build, or null: none unless ccrc has given up on it, none for a row whose build is not a Claude
 *  Code version, and none for a build whose item is already open (`openBuilds`, the key). */
export function untrustedBuildItemOf(openBuilds: ReadonlySet<string>, row: ClaudeBuildRecord): RaiseItemInput | null {
  const version = row.build;
  if (!isClaudeVersion(version) || !captureGivenUp(row) || openBuilds.has(version)) return null;
  return {
    program: UNTRUSTED_BUILD_ITEM_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do',
    title: `Claude Code ${version} failed its capture ${times(row.fails)}, and ccrc has stopped retrying`,
    why: `The test box captured ${version} and the replay tests failed ${times(row.fails)}, so ccrc no longer captures it by `
      + `itself (it stops after ${BUILD_CAPTURE_FAIL_CEILING} failed captures). Until a capture passes, ccrc refuses a child's `
      + 'permission prompt on it, so the prompt comes to you in the session.',
    how: [
      `Open ${UNTRUSTED_BUILD_SETTINGS_PATH} and find Claude Code ${version} in the Test box's build list: its replay output `
        + 'says what failed.',
      'Once the cause is fixed (the test box, the replay tests, or ccrc\'s readers for this build), choose Capture again. '
        + 'Only you can: it is a signed-in act.',
      'ccrc closes this item when the build is captured again, by your Capture again or once it passes.',
    ],
    options: null,
    // `soon` with no label: nothing pushes (the capture lane's give-up notice already does); never blocking.
    neededBy: 'soon', soonLabel: null, secretSlot: null,
    action: { verb: UNTRUSTED_BUILD_VERB, build: version },
  };
}

/** The note an item settles with: its build passed its capture, or it is back in ccrc's hands (or has no row). */
export const UNTRUSTED_BUILD_SETTLED_NOTES = {
  captured: 'The build passed its capture, so its children\'s prompts can be allowed again.',
  handled: 'ccrc captures this build itself once its capture runner is wired; until then a child\'s prompt on it comes to you in the pane.',
} as const;

/** The open items to settle, each with its note: every one whose build ccrc has not given up on (trusted, queued, being
 *  captured again, or with no row). A record that could not be read settles nothing. */
export function untrustedBuildItemsToSettle(
  open: readonly { readonly id: number; readonly build: string }[], records: readonly ClaudeBuildRecord[] | null,
): { id: number; build: string; note: string }[] {
  if (records === null) return [];
  return open.flatMap((i) => {
    const row = records.find((r) => r.build === i.build);
    if (row !== undefined && captureGivenUp(row)) return [];
    const captured = row !== undefined && captureStandingOf(row).kind === 'trusted';
    return [{ id: i.id, build: i.build, note: captured ? UNTRUSTED_BUILD_SETTLED_NOTES.captured : UNTRUSTED_BUILD_SETTLED_NOTES.handled }];
  });
}

/** The items to raise on a pass (review 3234 F11): one for each build ccrc has given up on, that a session still runs
 *  (`givenUpToTell`), and that has no open item, so a raise lost to a throw or a restart is raised on a later pass. */
export function untrustedBuildItemsToRaise(
  open: readonly { readonly build: string }[], records: readonly ClaudeBuildRecord[], versions: readonly (string | null)[],
): RaiseItemInput[] {
  const openBuilds = new Set(open.map((i) => i.build));
  return records.flatMap((r) => {
    const input = givenUpToTell(r, versions) ? untrustedBuildItemOf(openBuilds, r) : null;
    return input === null ? [] : [input];
  });
}
