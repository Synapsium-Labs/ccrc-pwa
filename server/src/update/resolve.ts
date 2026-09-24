// L1 — THE RESOLVER (design 2026-09-20 §9). Pure decisions over values the
// caller measured: no fs, no store, no fastify, no clock. `project.ts` (L3,
// D-3187) reads the store, calls these and writes the one
// file; the update routes (Task 13) call the same functions and decide
// nothing these do not. Ring membership is a property of the import block
// below — two shared/ modules and nothing else — and update-resolve.test.ts
// pins it by reading it.
//
// THE CANONICAL FORM IS THE TAG (decision 2). Every value in and out is
// `vX.Y.Z`; the `v` is stripped only inside shared/semver.ts. A value that
// fails `isReleaseTag` is never ordered: it is not a floor, not a
// catalogue entry and not a pin that can resolve.
import {
  FLEET_SCOPE, UNIX_SECONDS_MAX, UPDATE_GATE_CAP, isReleaseTag, type AutoMode, type TagFileRead, type UpdateChannel,
} from '../../../shared/api.js';
import { compareReleaseTags, isNewerTag } from '../../../shared/semver.js';

/** The ccrc-caps word a node needs before `auto ≠ off` may reach it (§9; written by W4's spine). Declared in
 *  shared/api.ts since W3 (D-3305), because the settings screen disables its auto-install
 *  control on the same word; re-exported here, so every importer of this module keeps its import path. */
export { UPDATE_GATE_CAP };
/** pool_epoch's lease, in SECONDS: the projection is re-rendered every sweep, so a live server keeps it fresh. */
export const PROJECTION_LEASE_S = 15 * 60;

export interface EligibilityRow { tag: string; channel: UpdateChannel | null; bundleListed: boolean; yanked: boolean }
export interface IntentView { channel: UpdateChannel | null; pinnedTag: string | null; auto: AutoMode }
export interface ResolveInput {
  currentVersion: string | null; highestVersion: string | null;
  /** fix round 1, D-3213 (corrected by its own review): how the STORED
   *  `highestVersion` was arrived at, this sweep or carried forward. A NULL
   *  `highestVersion` is unconstrained when this is `absent` (measured,
   *  this sweep or carried, that there is no floor); `unmeasured` means
   *  NOTHING has ever been measured for this node, so `highestVersion` is
   *  always NULL alongside it — nothing resolves then, never the
   *  `currentVersion` fallback an absent floor would license. */
  floorRead: TagFileRead;
  /** update_intent[nodeId]; null = no row → the fleet row decides. */
  nodeIntent: IntentView | null;
  /** update_intent['*']; null = the seed row is gone → nothing resolves. */
  fleetIntent: IntentView | null;
  /** The eligibility columns only — never the refusal roll-up, which is display. */
  releases: readonly EligibilityRow[];
  /** node_release_refusals for THIS node (decision 16); another node's refusal is not an input. */
  refusedByThisNode: ReadonlySet<string>;
}
export interface Resolution {
  /** The first three are NodeResolvedColumns, structurally — what resolveNode stores. */
  channel: UpdateChannel | null; desiredTag: string | null; resolveDetail: string | null;
  desiredStable: string | null; desiredDev: string | null; auto: AutoMode;
}

export type PinnedIneligibleWhy =
  | 'not-in-catalogue' | 'no-bundle-listed' | 'yanked' | 'refused-by-this-node' | 'not-on-stable' | 'unknown-release-channel';
const PINNED_WHY_TEXT: Record<PinnedIneligibleWhy, string> = {
  'not-in-catalogue': 'it is not in the release catalogue',
  'no-bundle-listed': 'it lists no provenance bundle, so no node could verify it',
  yanked: 'it was yanked from the catalogue',
  'refused-by-this-node': 'it failed provenance verification on this node; ack the node to clear the refusal',
  'not-on-stable': 'it is a prerelease and this node follows stable',
  'unknown-release-channel': 'its release channel is one this build does not know',
};
/** Derived from the record, never hand-kept (the PR_REASONS idiom). */
export const PINNED_INELIGIBLE_WHYS = Object.keys(PINNED_WHY_TEXT) as readonly PinnedIneligibleWhy[];

/** Every resolveDetail sentence, in one place. The first four are §9's text verbatim. */
export const RESOLVE_DETAIL = {
  pinnedAtOrBelowFloor: (pin: string, floor: string): string =>
    `pinned ${pin} is at or below this node's floor ${floor} — pin a newer tag, or use rollback`,
  notNewerThanFloor: (newest: string, floor: string): string =>
    `newest eligible ${newest} is not newer than this node's floor ${floor} — a yank or demotion cannot move a node down; a newer release will`,
  rolledBack: (current: string, floor: string): string =>
    `this node was rolled back to ${current} and its floor is ${floor} — auto stays off this tag until a release above ${floor} exists (decision 8)`,
  noFloor: (): string => 'no floor and no measured version — nothing to compare against',
  // fix round 1's own review, m-2: worded to hold for a node that was never
  // reached at all (markUnreachable's placeholder, D-3213), not only one
  // whose floor file failed to read — both are "nothing has been measured".
  floorUnmeasured: (): string =>
    "this node's floor has not been measured — nothing resolves until it is",
  pinnedIneligible: (pin: string, why: PinnedIneligibleWhy): string =>
    `pinned ${pin} is not eligible on this node — ${PINNED_WHY_TEXT[why]}`,
  noEligible: (channel: UpdateChannel): string =>
    `no eligible release on ${channel} — nothing is listed with a bundle, un-yanked and unrefused by this node`,
  unknownChannel: (): string =>
    "this node's intent names a channel this build does not know — nothing resolves until it is set again",
  noIntent: (): string => "no intent row for this node and none for the fleet ('*') — nothing resolves",
};

/** The floor (§9): highestVersion, or currentVersion when that is NULL (unconstrained, never v0.0.0), or
 *  nothing when both are. D-3202: when both are tags the HIGHER one — `~/.ccrc/floor` is
 *  raised only by the install spine, so a tree placed by deploy.sh sits above a stale floor, and a floor below
 *  the running version would license a downgrade from it. When current ≤ highest this is highestVersion
 *  exactly, which is what keeps a rollback sticky. */
export function floorOf(highestVersion: string | null, currentVersion: string | null): string | null {
  const highest = isReleaseTag(highestVersion) ? highestVersion : null;
  const current = isReleaseTag(currentVersion) ? currentVersion : null;
  if (highest === null) return current;
  if (current === null) return highest;
  return isNewerTag(current, highest) ? current : highest;
}

/** F11 (fix round 1, D-3216) — ingress-only, on TOP of `isReleaseTag`
 *  (`shared/api.ts`, untouched: `update-states.test.ts` pins its `.source`
 *  byte-equal to `deploy/release-main.sh`'s SHAPE). GitHub's `tag_name` is
 *  untrusted text, and `[0-9]+` per component admits a leading zero
 *  (`v0.0.010`) that `compareReleaseTags` would then treat as a SECOND
 *  spelling of `v0.0.10` rather than the same release. Refuses a tag over
 *  `RELEASE_TAG_INGRESS_MAX_BYTES` bytes or carrying a leading zero in any
 *  component that is not itself the bare digit `0` — checked structurally
 *  (a split and a per-part scan), never by a second copy of the tag-shape
 *  regex `single-definition.test.ts` polices ("spells the tag shape once").
 *  A tag this refuses is SKIPPED at the catalogue's element parse exactly
 *  like any other malformed element (D-3206), and the SAME predicate gates
 *  `POST /api/updates/intent`'s `pinnedTag` (imported there, never a second
 *  copy) — see `update/routes.ts`.
 *
 *  R9 (fix round 2, D-3216, review 143): the byte cap alone does not bound a
 *  SINGLE component's digit count — `v9999999999999999999.0.0` is 25 bytes,
 *  well under the cap, but its first component is a 20-digit number `ccd`'s
 *  bash twin (`_ver_newer`'s `10#` arithmetic, 64-bit signed) overflows
 *  SILENTLY: `compareReleaseTags` (`shared/semver.ts`) orders arbitrary-
 *  precision digit strings and would agree with the twin on every tag this
 *  bound admits, but the two would order a tag ABOVE it in opposite
 *  directions. Refuses any component longer than
 *  `RELEASE_TAG_COMPONENT_MAX_DIGITS` (18) — every such value is safely
 *  under a 64-bit signed integer's range, with margin. NOTE: for `v`'s
 *  fixed three-component grammar this makes `RELEASE_TAG_INGRESS_MAX_BYTES`
 *  itself unreachable ON ITS OWN (three components at 18 digits each is 57
 *  bytes, under the 64-byte cap) — kept anyway as a defensive backstop
 *  against a future grammar with more or longer components, where the two
 *  bounds would again disagree. */
export const RELEASE_TAG_INGRESS_MAX_BYTES = 64;
export const RELEASE_TAG_COMPONENT_MAX_DIGITS = 18;
export function isIngestibleReleaseTag(v: unknown): v is string {
  if (!isReleaseTag(v)) return false;
  if (Buffer.byteLength(v, 'utf8') > RELEASE_TAG_INGRESS_MAX_BYTES) return false;
  const parts = v.slice(1).split('.');
  return parts.every((p) => (p === '0' || p[0] !== '0') && p.length <= RELEASE_TAG_COMPONENT_MAX_DIGITS);
}

/** THE eligibility predicate — the unpinned list and the pin's reason are both this function, so the two can
 *  never disagree about what is eligible. null = eligible on `channel`. */
function ineligibleWhy(row: EligibilityRow | undefined, channel: UpdateChannel, refused: ReadonlySet<string>): PinnedIneligibleWhy | null {
  if (row === undefined || !isReleaseTag(row.tag)) return 'not-in-catalogue';
  if (row.yanked) return 'yanked';
  if (!row.bundleListed) return 'no-bundle-listed';
  if (refused.has(row.tag)) return 'refused-by-this-node';
  if (row.channel === null) return 'unknown-release-channel';
  // stable: stable releases only; dev: either channel — a stable release is also the newest thing on dev.
  if (channel === 'stable' && row.channel !== 'stable') return 'not-on-stable';
  return null;
}

export function eligibleTags(releases: readonly EligibilityRow[], channel: UpdateChannel, refused: ReadonlySet<string>): string[] {
  return releases
    .filter((r) => ineligibleWhy(r, channel, refused) === null)
    .map((r) => r.tag)
    .sort((a, b) => compareReleaseTags(b, a));
}

interface ChannelAnswer { desiredTag: string | null; resolveDetail: string | null }

function resolveOnChannel(channel: UpdateChannel, pin: string | null, input: ResolveInput): ChannelAnswer {
  // fix round 1, D-3213 (re-review N-1): a NULL floor that was NEVER
  // measured (floorRead 'unmeasured') is NOT the same fact as a NULL floor
  // the STORED row says is genuinely absent (floorRead 'absent' — measured
  // this sweep, or carried forward as a pair from an earlier one) — only
  // the latter is unconstrained (§9). Checked before `floorOf`, which
  // cannot itself tell the two apart: it would otherwise fall back to
  // `currentVersion` here exactly as it does for a genuinely absent floor.
  if (input.highestVersion === null && input.floorRead === 'unmeasured') {
    return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.floorUnmeasured() };
  }
  const floor = floorOf(input.highestVersion, input.currentVersion);
  if (floor === null) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.noFloor() };
  if (pin !== null) {
    const why = ineligibleWhy(input.releases.find((r) => r.tag === pin), channel, input.refusedByThisNode);
    if (why !== null) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.pinnedIneligible(pin, why) };
    // Strictly newer than the floor, pinned or not (§18): a pin never walks a node down — rollback does.
    if (!isNewerTag(pin, floor)) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.pinnedAtOrBelowFloor(pin, floor) };
    return { desiredTag: pin, resolveDetail: null };
  }
  const newest = eligibleTags(input.releases, channel, input.refusedByThisNode)[0];
  if (newest === undefined) return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.noEligible(channel) };
  if (isNewerTag(newest, floor)) return { desiredTag: newest, resolveDetail: null };
  // Nothing above the floor. Which sentence is decided by whether the node runs BELOW its own floor: a
  // rolled-back node is told why auto leaves it alone; a node at its floor is told a yank cannot move it.
  const current = isReleaseTag(input.currentVersion) ? input.currentVersion : null;
  if (current !== null && isNewerTag(floor, current)) {
    return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.rolledBack(current, floor) };
  }
  return { desiredTag: null, resolveDetail: RESOLVE_DETAIL.notNewerThanFloor(newest, floor) };
}

function nothing(resolveDetail: string, auto: AutoMode): Resolution {
  return { channel: null, desiredTag: null, resolveDetail, desiredStable: null, desiredDev: null, auto };
}

export function resolveNodeIntent(input: ResolveInput): Resolution {
  // The node's own row decides whenever it EXISTS — its channel included. A token outside the vocabulary on
  // that row reads null (the store's stance, D-3181) and resolves NOTHING: falling back to
  // '*' would move a node the operator scoped away from the fleet (§18 "an unknown channel token resolves
  // nothing").
  const row = input.nodeIntent ?? input.fleetIntent;
  if (row === null) return nothing(RESOLVE_DETAIL.noIntent(), 'off');
  if (row.channel === null) return nothing(RESOLVE_DETAIL.unknownChannel(), row.auto);
  const mine = resolveOnChannel(row.channel, row.pinnedTag, input);
  return {
    channel: row.channel,
    desiredTag: mine.desiredTag,
    resolveDetail: mine.resolveDetail,
    // The same resolution run per channel, pin included (§9), so `ccrc update --channel` selects the other
    // one with no local network resolution.
    desiredStable: resolveOnChannel('stable', row.pinnedTag, input).desiredTag,
    desiredDev: resolveOnChannel('dev', row.pinnedTag, input).desiredTag,
    auto: row.auto,
  };
}

/** §9's advisory refusal: the nodes in `scope` whose measured caps lack UPDATE_GATE_CAP — reachable or not,
 *  measured or not (no caps is no gate). The dispatcher (W4) is the enforcement; this is the route's 409. */
export function autoGateBlockers(scope: string, nodes: readonly { nodeId: string; caps: readonly string[] }[]): string[] {
  return nodes
    .filter((n) => (scope === FLEET_SCOPE || n.nodeId === scope) && !n.caps.includes(UPDATE_GATE_CAP))
    .map((n) => n.nodeId);
}

export interface ProjectionDoc {
  /** unix SECONDS; lease = issued + PROJECTION_LEASE_S. */
  epoch: number; issued: number; lease: number;
  channel: UpdateChannel; desired: string | null; desiredStable: string | null; desiredDev: string | null; auto: AutoMode;
}
export type RenderedProjection =
  | { ok: true; doc: ProjectionDoc; text: string }
  | { ok: false; why: 'no-channel'; detail: string };

/** The §9 document, `$REG/pool-epoch`'s grammar discipline: one field per line, `end` last. SECONDS, not ms —
 *  server.ts's GET /api/pools/epoch comment records the C1 defect where a ms lease made ccd's `stale` arm
 *  unreachable for ~56,700 years; a ms `issuedAtS` is a caller bug and throws here rather than render. A
 *  resolution with no channel has no document: the caller writes NOTHING (a stale document inside its lease
 *  is better than none, ccd-pool-sync's rule). */
export function renderProjection(r: Resolution, epoch: number, issuedAtS: number): RenderedProjection {
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new RangeError(`renderProjection: epoch must be a non-negative integer, got ${epoch}`);
  }
  if (!Number.isSafeInteger(issuedAtS) || issuedAtS < 0 || issuedAtS > UNIX_SECONDS_MAX) {
    throw new RangeError(`renderProjection: issuedAtS must be unix SECONDS, got ${issuedAtS}`);
  }
  for (const t of [r.desiredTag, r.desiredStable, r.desiredDev]) {
    if (t !== null && !isReleaseTag(t)) throw new RangeError(`renderProjection: not a release tag: ${t}`);
  }
  if (r.channel === null) return { ok: false, why: 'no-channel', detail: r.resolveDetail ?? RESOLVE_DETAIL.unknownChannel() };
  const doc: ProjectionDoc = {
    epoch, issued: issuedAtS, lease: issuedAtS + PROJECTION_LEASE_S,
    channel: r.channel, desired: r.desiredTag, desiredStable: r.desiredStable, desiredDev: r.desiredDev, auto: r.auto,
  };
  const tag = (t: string | null): string => t ?? 'none';
  const text = [
    `epoch ${doc.epoch}`,
    `issued ${doc.issued}`,
    `lease ${doc.lease}`,
    `channel ${doc.channel}`,
    `desired ${tag(doc.desired)}`,
    `desired-stable ${tag(doc.desiredStable)}`,
    `desired-dev ${tag(doc.desiredDev)}`,
    `auto ${doc.auto}`,
    'end',
  ].join('\n') + '\n';
  return { ok: true, doc, text };
}
