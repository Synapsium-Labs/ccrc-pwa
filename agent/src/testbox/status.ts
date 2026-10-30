// D-7406, D-7501 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB4; spec §2.2 "XFS, settled", §2.7). L1,
// pure: the box's status answer. `down` when the service answers but cannot run (no reflink on the run root, a
// repository row's mirror missing); `degraded` for a tool sync in progress or failed, a failed pristine key, a run
// user held out by a failed cleanup, a tool whose version differs from the fleet host's last measured one, or tools
// and release the box has not measured yet (TB6 fills them); `ok` otherwise. The reasons are joined in that order.
import {
  TESTBOX_PROTO, TESTBOX_TOOLS, versionCellsDiffer,
  type StatusAnswer, type TestboxFailedKey, type TestboxPristine, type TestboxRepoName, type TestboxSync, type TestboxToolVersions,
} from '../../../shared/testbox.js';

export type ProbeResult = { readonly ok: true } | { readonly ok: false; readonly detail: string };

export interface MirrorSeen extends TestboxRepoName { readonly present: boolean }

export interface StatusFacts {
  readonly reflink: ProbeResult;
  readonly mirrors: readonly MirrorSeen[];
  /** The release tag the box's tree came from; `null` when it cannot be read. */
  readonly release: string | null;
  readonly serviceVersion: string;
  /** The box's measured tool versions; `null` until the tool sync has measured them (TB6). */
  readonly tools: TestboxToolVersions | null;
  /** The fleet host's versions from the last `tools.sync`; `null` before one. */
  readonly fleetTools: TestboxToolVersions | null;
  readonly sync: TestboxSync;
  readonly inProgress: number;
  readonly limit: number;
  readonly queueDepth: number;
  readonly pristine: readonly TestboxPristine[];
  readonly failedKeys: readonly TestboxFailedKey[];
  readonly heldRunUsers: readonly string[];
}

/** The status answer's placeholder for an unknown release tag (never `ok`: the reason names it). */
export const UNKNOWN_RELEASE = 'v0.0.0';
const UNKNOWN_VERSION = '0';
const unknownTools = (): TestboxToolVersions =>
  Object.fromEntries(TESTBOX_TOOLS.map((t) => [t, UNKNOWN_VERSION])) as unknown as TestboxToolVersions;

export function downReasons(f: StatusFacts): string[] {
  const out: string[] = [];
  if (!f.reflink.ok) out.push(`no reflink on the run root (${f.reflink.detail})`);
  for (const m of f.mirrors) if (!m.present) out.push(`missing mirror ${m.name}`);
  return out;
}

export function degradedReasons(f: StatusFacts): string[] {
  const out: string[] = [];
  if (f.sync.state === 'syncing') out.push(`tool sync in progress${f.sync.detail === null ? '' : ` (${f.sync.detail})`}`);
  if (f.sync.state === 'failed') out.push(`tool sync failed${f.sync.detail === null ? '' : ` (${f.sync.detail})`}`);
  for (const k of f.failedKeys) out.push(`pristine install failed (${k.package} ${k.key}, exit ${k.exit})`);
  for (const u of f.heldRunUsers) out.push(`run user held out (${u})`);
  if (f.tools === null) out.push('tool versions not measured');
  else if (f.fleetTools !== null) for (const t of versionCellsDiffer(f.fleetTools, f.tools)) out.push(`tool version differs (${t})`);
  if (f.release === null) out.push('release not known');
  return out;
}

export function statusAnswer(f: StatusFacts): StatusAnswer {
  const down = downReasons(f);
  const degraded = degradedReasons(f);
  const state = down.length > 0 ? 'down' : degraded.length > 0 ? 'degraded' : 'ok';
  const reason = state === 'down' ? down.join('; ') : state === 'degraded' ? degraded.join('; ') : null;
  return {
    t: 'status', state, reason, serviceVersion: f.serviceVersion, proto: TESTBOX_PROTO,
    release: f.release ?? UNKNOWN_RELEASE, tools: f.tools ?? unknownTools(), sync: f.sync,
    runs: { inProgress: f.inProgress, limit: f.limit }, queueDepth: f.queueDepth,
    pristine: f.pristine, failedKeys: f.failedKeys, heldRunUsers: f.heldRunUsers,
    repositories: f.mirrors.map((m) => ({ name: m.name, mirrorPath: m.mirrorPath })),
  };
}
