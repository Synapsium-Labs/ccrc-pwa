// The Claude Code version lexicon — D-5695 (`claude-version-lexicon`).
//
// Claude Code builds are bare `x.y.z` with channels `latest | stable`; the
// update plane's `RELEASE_TAG` (`vX.Y.Z`), `UpdateChannel`, `AutoMode` and
// `compareReleaseTags` (`shared/semver.ts`) are ccrc-release-shaped. This file
// is the PARALLEL vocabulary, never mixed with that one (spec §10.2): the
// grammar and its comparator, the channels, the roll modes, the lane kinds,
// the closed `why` enum of the installer, the numbers of spec §12 and the one
// parser of the tenth node file, `~/.ccrc/claude.json` (spec §6.2). Each is
// defined here once.
//
// L0, and it imports NOTHING: the PWA bundles `shared/`.

/** A Claude Code build: three decimal components, no leading zeros, no
 *  prefix, no suffix, nothing after the last digit (JavaScript's `$` without
 *  the `m` flag matches only at the end of input, so `2.1.3\n` is refused). */
export const CLAUDE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Whether `v` is a Claude Code build string. The one shape guard. */
export function isClaudeVersion(v: unknown): v is string {
  return typeof v === 'string' && CLAUDE_VERSION.test(v);
}

/** -1 when `a` is older than `b`, 1 when newer, 0 when the same build.
 *  Numeric per component (2.1.302 > 2.1.99, the lexical trap of spec §2.5),
 *  compared as digit strings by length then lexically — exact at any length,
 *  which the grammar's no-leading-zero rule makes sound. Throws RangeError on
 *  a non-version, as `compareReleaseTags` does on a non-tag: a non-version is
 *  never ordered. */
export function compareClaudeVersions(a: string, b: string): -1 | 0 | 1 {
  if (!isClaudeVersion(a)) refuse(a);
  if (!isClaudeVersion(b)) refuse(b);
  const x = a.split('.');
  const y = b.split('.');
  for (let i = 0; i < 3; i++) {
    const p = x[i]!;
    const q = y[i]!;
    if (p.length !== q.length) return p.length > q.length ? 1 : -1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

function refuse(v: unknown): never {
  throw new RangeError(`compareClaudeVersions: not a Claude Code version: ${JSON.stringify(v)}`);
}

/** The installer's channel (decision 1: `latest` by default). */
export const CLAUDE_CHANNELS = ['latest', 'stable'] as const;
export type ClaudeChannel = (typeof CLAUDE_CHANNELS)[number];
export const CLAUDE_CHANNEL_DEFAULT: ClaudeChannel = 'latest';

/** The roll mode per node or fleet-wide (decision 3: `manual` by default;
 *  `auto` only after a passed manual canary and a reviewed shadow week). */
export const CLAUDE_ROLL_MODES = ['off', 'manual', 'auto'] as const;
export type ClaudeRollMode = (typeof CLAUDE_ROLL_MODES)[number];
export const CLAUDE_ROLL_MODE_DEFAULT: ClaudeRollMode = 'manual';

/** The lane kinds a (node, lane kind) target is kept for (spec §10.1). */
export const CLAUDE_LANE_KINDS = ['anthropic', 'codex'] as const;
export type ClaudeLaneKind = (typeof CLAUDE_LANE_KINDS)[number];

/** The installer's closed reason enum, in spec §6.2's order. Installer stderr
 *  never stands in for one of these (spec §9 trap 9). */
export const CLAUDE_INSTALL_WHY = [
  'ok',
  'no-op',
  'measure-only',
  'disabled',
  'intent-stale',
  'pointer-unreachable',
  'manifest-unreachable',
  'below-floor',
  'halted',
  'no-space',
  'install-failed',
  'checksum-mismatch',
  'signature-failed',
  'smoke-failed',
  'pin-unavailable',
  'upstream-retreat',
] as const;
export type ClaudeInstallWhy = (typeof CLAUDE_INSTALL_WHY)[number];

/** The build floor (`minBuild`, spec §12, §9 trap 5). Its source is
 *  `liveStatusCoversDelegation` (`server/src/livestate.ts`): from 2.1.277 the
 *  live `status` writer covers delegated work; below it the status is
 *  unmeasured. Raise both together. */
export const CLAUDE_MIN_BUILD = '2.1.277';

/** The roll quiet window in minutes (decision 2: 90 by default, operator
 *  settable from 15 min to 24 h through `$REG/claude-roll-after-minutes`). */
export const CLAUDE_ROLL_AFTER_MINUTES = { default: 90, min: 15, max: 1440 } as const;

/** The memory headroom a roll needs (decision 6): 3 GiB of `_mem_headroom`,
 *  the minimum over the slice and each ancestor of `memory.max` minus that
 *  level's own `anon`. Swap is shown, never a hold. */
export const CLAUDE_HEADROOM_GATE_BYTES = 3 * 2 ** 30;

// ─── the tenth node file, `~/.ccrc/claude.json` (spec §6.2, version 1) ───

export interface ClaudeNodeFileBuild {
  v: string;
  bytes: number;
  sha256ok: boolean | null;
  sigok: boolean | null;
  smoke: 'ok' | 'failed' | null;
  running: number;
  halted: boolean;
}

export interface ClaudeNodeFile {
  v: 1;
  at: number;
  mode: 'measure' | 'install';
  channel: ClaudeChannel;
  pin: string | null;
  pointer: { latest: string; stable: string; at: number } | null;
  candidate: string | null;
  target: Record<ClaudeLaneKind, string | null>;
  prevTarget: Record<ClaudeLaneKind, string | null>;
  builds: ClaudeNodeFileBuild[];
  running: { pid: number; build: string }[];
  placeholders: number;
  staging: number;
  selfUpdateOff: boolean;
  intentAt: number | null;
  localHalts: string[];
  last: { at: number; result: 'ok' | 'no-op' | 'failed'; why: ClaudeInstallWhy; failures: number };
  switches: {
    installDisabled: boolean;
    rollDisabled: boolean;
    rollLive: boolean;
    selfUpdateKept: boolean;
    adopted: boolean;
    hibernateShadowAt: number | null;
    hibernateLiveAt: number | null;
  };
  rollAfterMinutes: number;
  memory: {
    anonBytes: number;
    ceilingBytes: number;
    ceiling: string;
    swapUsedBytes: number | null;
    swapTotalBytes: number | null;
  } | null;
}

/** Thrown inside the parser only; `parseClaudeNodeFile` turns it into null. */
class Refused extends Error {}
function no(): never {
  throw new Refused();
}

type Obj = Record<string, unknown>;
function obj(x: unknown): Obj {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) no();
  return x as Obj;
}
function arr(x: unknown): unknown[] {
  if (!Array.isArray(x)) no();
  return x;
}
function count(x: unknown): number {
  if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0) no();
  return x;
}
function bool(x: unknown): boolean {
  if (typeof x !== 'boolean') no();
  return x;
}
function boolOrNull(x: unknown): boolean | null {
  return x === null ? null : bool(x);
}
function countOrNull(x: unknown): number | null {
  return x === null ? null : count(x);
}
function version(x: unknown): string {
  if (!isClaudeVersion(x)) no();
  return x;
}
function versionOrNull(x: unknown): string | null {
  return x === null ? null : version(x);
}
function oneOf<T extends string>(set: readonly T[], x: unknown): T {
  if (typeof x !== 'string' || !(set as readonly string[]).includes(x)) no();
  return x as T;
}
function byKind(x: unknown): Record<ClaudeLaneKind, string | null> {
  const o = obj(x);
  return { anthropic: versionOrNull(o.anthropic), codex: versionOrNull(o.codex) };
}
/** A cgroup level's name: `slice`, `user` or a unit name — a bounded token. */
const CEILING_NAME = /^[A-Za-z0-9@._:-]{1,128}$/;

/** The one parser of spec §6.2's node file. Returns `null` for anything that
 *  is not the version-1 shape, and builds every object afresh from the named
 *  keys, so an unknown key — installer stderr, a URL, a path, an environ
 *  value — is dropped, never echoed (spec §9 trap 9). */
export function parseClaudeNodeFile(text: string): ClaudeNodeFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  try {
    return readDoc(raw);
  } catch (e) {
    if (e instanceof Refused) return null;
    throw e;
  }
}

function readDoc(raw: unknown): ClaudeNodeFile {
  const d = obj(raw);
  if (d.v !== 1) no();
  const pointer = d.pointer === null ? null : obj(d.pointer);
  const last = obj(d.last);
  const sw = obj(d.switches);
  const mem = d.memory === null ? null : obj(d.memory);
  const rollAfter = count(d.rollAfterMinutes);
  if (rollAfter < CLAUDE_ROLL_AFTER_MINUTES.min || rollAfter > CLAUDE_ROLL_AFTER_MINUTES.max) no();
  let memory: ClaudeNodeFile['memory'] = null;
  if (mem !== null) {
    if (typeof mem.ceiling !== 'string' || !CEILING_NAME.test(mem.ceiling)) no();
    memory = {
      anonBytes: count(mem.anonBytes),
      ceilingBytes: count(mem.ceilingBytes),
      ceiling: mem.ceiling,
      swapUsedBytes: countOrNull(mem.swapUsedBytes),
      swapTotalBytes: countOrNull(mem.swapTotalBytes),
    };
  }
  return {
    v: 1,
    at: count(d.at),
    mode: oneOf(['measure', 'install'] as const, d.mode),
    channel: oneOf(CLAUDE_CHANNELS, d.channel),
    pin: versionOrNull(d.pin),
    pointer:
      pointer === null
        ? null
        : { latest: version(pointer.latest), stable: version(pointer.stable), at: count(pointer.at) },
    candidate: versionOrNull(d.candidate),
    target: byKind(d.target),
    prevTarget: byKind(d.prevTarget),
    builds: arr(d.builds).map((x) => {
      const b = obj(x);
      return {
        v: version(b.v),
        bytes: count(b.bytes),
        sha256ok: boolOrNull(b.sha256ok),
        sigok: boolOrNull(b.sigok),
        smoke: b.smoke === null ? null : oneOf(['ok', 'failed'] as const, b.smoke),
        running: count(b.running),
        halted: bool(b.halted),
      };
    }),
    running: arr(d.running).map((x) => {
      const r = obj(x);
      const pid = count(r.pid);
      if (pid === 0) no();
      return { pid, build: version(r.build) };
    }),
    placeholders: count(d.placeholders),
    staging: count(d.staging),
    selfUpdateOff: bool(d.selfUpdateOff),
    intentAt: countOrNull(d.intentAt),
    localHalts: arr(d.localHalts).map(version),
    last: {
      at: count(last.at),
      result: oneOf(['ok', 'no-op', 'failed'] as const, last.result),
      why: oneOf(CLAUDE_INSTALL_WHY, last.why),
      failures: count(last.failures),
    },
    switches: {
      installDisabled: bool(sw.installDisabled),
      rollDisabled: bool(sw.rollDisabled),
      rollLive: bool(sw.rollLive),
      selfUpdateKept: bool(sw.selfUpdateKept),
      adopted: bool(sw.adopted),
      hibernateShadowAt: countOrNull(sw.hibernateShadowAt),
      hibernateLiveAt: countOrNull(sw.hibernateLiveAt),
    },
    rollAfterMinutes: rollAfter,
    memory,
  };
}
