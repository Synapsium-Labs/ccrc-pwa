// D-8290 (plan docs/superpowers/plans/2026-11-11-live-probe-budget.md). L1, pure and clock-free (the clock is an
// argument): the live probe rules. A probe is a live Claude Code test, a test box job kind (`probe.submit`), and the
// operator's ruling is that it runs on the rebuilt test box only, never on the fleet, under a scratch Claude account
// with its own config folder and tmux socket, one at a time through a queue, within a budget the harness programme
// owns. Each rule is decided here once; `probeDesk.ts` acts on them.
//
// THE ROLE comes from the node's install config, never a hostname: the test service reads its settings only from the
// box's root-owned config file, through `_testbox_knobs box` (D-7451). On a node without that file, every fleet node,
// and on one whose file the owner check refuses, every box key reads `from: default`; a test box's install config
// names its keys, so at least one line reads `from: file` (or `empty`, a key named with no value).
//
// THE GUARD keeps a probe off every fleet account's config directory: Claude Code's default `.claude` and every
// `.claude-<id>` a lane is given (`shared/roster.ts#newLaneConfigSuffix`) are refused by name wherever they are, and
// each directory the caller lists (the roster's `$HOME/<configDirSuffix>`, resolved) is refused with everything in it
// and around it. The socket name `default` is the fleet's own tmux server.
//
// THE BUDGET is `CCRC_TESTBOX_PROBES_PER_DAY` probes per UTC day, counted when a probe is accepted into the queue.
import path from 'node:path';
import type { ProbeRefusal, TestboxProbes } from '../../../shared/testbox.js';
import { absPath, ConfigRefusal, count, type KnobLine } from './config.js';
import type { QueueState } from './queue.js';
import { SYSTEM_PATH } from './spec.js';

/** The three box keys the probes read (D-8290), from `config.ts`'s kept lines. */
export const PROBE_KNOBS = ['CCRC_TESTBOX_PROBE_CONFIG_DIR', 'CCRC_TESTBOX_PROBE_SOCKET', 'CCRC_TESTBOX_PROBES_PER_DAY'] as const;

/** The ruling's "one test at a time": the probe queue's one slot. */
export const PROBE_SLOTS = 1;

/** The fleet's own tmux server's socket name (tmux's default; `ccd` asks it by path, never by `-L`). */
export const FLEET_TMUX_SOCKET = 'default';

/** Claude Code's default config directory's name, the upstream account's, and the prefix every added lane's has. */
const CLAUDE_DIR = '.claude';
const LANE_DIR_PREFIX = '.claude-';

/** The node's role for probes. */
export type ProbeRole = 'test-box' | 'not-test-box';

/** A test box is a node whose install config named a box key: one line read from the box file (see the header). */
export function probeRole(lines: ReadonlyMap<string, KnobLine>): ProbeRole {
  for (const l of lines.values()) if (l.from === 'file' || l.from === 'empty') return 'test-box';
  return 'not-test-box';
}

/** The probe settings, from the box file. */
export interface ProbeSettings {
  /** The scratch account's config directory, `CLAUDE_CONFIG_DIR`. */
  readonly configDir: string;
  /** The probe tmux server's `-L` name. */
  readonly socket: string;
  readonly perDay: number;
  /** `<CCRC_TESTBOX_ROOT>/probes`: the probe home, its tmux directory and the budget file. */
  readonly root: string;
}

export type ProbeSettingsRead = { readonly ok: true; readonly settings: ProbeSettings } | { readonly ok: false; readonly refusal: 'probes-off' };

const SOCKET_NAME = /^[a-z_][a-z0-9_-]*$/;

/** The lines to the probe settings. No config directory named is `probes-off`; a value off its shape refuses the
 *  start as every setting does (`config.ts`: the printer kept the default on a bad value, so this is a disagreement). */
export function probeSettings(lines: ReadonlyMap<string, KnobLine>, root: string, home: string): ProbeSettingsRead {
  const v = (k: (typeof PROBE_KNOBS)[number]): string => lines.get(k)?.value ?? '';
  const dir = v('CCRC_TESTBOX_PROBE_CONFIG_DIR');
  if (dir === '') return { ok: false, refusal: 'probes-off' };
  const socket = v('CCRC_TESTBOX_PROBE_SOCKET');
  if (!SOCKET_NAME.test(socket)) throw new ConfigRefusal(`CCRC_TESTBOX_PROBE_SOCKET=${JSON.stringify(socket)}: not a socket name`);
  return {
    ok: true,
    settings: {
      configDir: absPath('CCRC_TESTBOX_PROBE_CONFIG_DIR', dir, home), socket,
      perDay: count('CCRC_TESTBOX_PROBES_PER_DAY', v('CCRC_TESTBOX_PROBES_PER_DAY')), root,
    },
  };
}

/** An absolute path with no empty, `.` or `..` segment and no control character. */
export function plainAbsolute(p: string): boolean {
  if (!p.startsWith('/') || /[\u0000-\u001f\u007f]/.test(p)) return false;
  if (p === '/') return true;
  return p.slice(1).split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** `p` is `dir` or lies inside it. */
const within = (p: string, dir: string): boolean => p === dir || p.startsWith(dir === '/' ? '/' : `${dir}/`);

/** A path segment named the way a fleet account's config directory is. */
const fleetNamed = (p: string): boolean => p.split('/').some((seg) => seg === CLAUDE_DIR || seg.startsWith(LANE_DIR_PREFIX));

/** Why `dir` (resolved, symlinks followed) may not be the probe's config directory, or `null`: not a plain absolute
 *  path; a fleet-named segment; or equal to, inside, or around one of the fleet's config directories. */
export function configDirRefusal(dir: string, fleet: readonly string[]): ProbeRefusal | null {
  if (!plainAbsolute(dir) || dir === '/') return 'config-dir-unsafe';
  if (fleetNamed(dir)) return 'config-dir-fleet';
  for (const f of fleet) if (within(dir, f) || within(f, dir)) return 'config-dir-fleet';
  return null;
}

/** Why the desk may not write `target` (resolved), or `null`: the guard every probe write passes. */
export function writeRefusal(target: string, fleet: readonly string[]): ProbeRefusal | null {
  if (!plainAbsolute(target) || target === '/') return 'config-dir-unsafe';
  if (fleetNamed(target)) return 'config-dir-fleet';
  for (const f of fleet) if (within(target, f)) return 'config-dir-fleet';
  return null;
}

/** Why the socket name may not be the probe's, or `null`. */
export function socketRefusal(socket: string): ProbeRefusal | null {
  return socket === FLEET_TMUX_SOCKET ? 'socket-fleet' : null;
}

/** What a probe runner is handed: the probe and its environment, built from empty. */
export interface ProbeSpec {
  readonly probeId: string;
  readonly name: string;
  readonly env: readonly (readonly [string, string])[];
  /** The `-L` name every tmux call of the probe passes. */
  readonly socket: string;
}

/** The probe home and the probe tmux directory, under the probe root. */
export const probeHome = (s: ProbeSettings): string => path.join(s.root, 'home');
export const probeTmuxDir = (s: ProbeSettings): string => path.join(s.root, 'tmux');

/** A probe's spec. Its environment is built from empty, so no fleet `HOME`, `TMUX` or `TMUX_PANE` reaches it: the
 *  scratch account's config directory, a probe-owned home and tmux directory, and the socket name. */
export function probeSpec(s: ProbeSettings, probeId: string, name: string): ProbeSpec {
  return {
    probeId, name, socket: s.socket,
    env: [
      ['PATH', SYSTEM_PATH], ['LANG', 'C.UTF-8'], ['HOME', probeHome(s)], ['CLAUDE_CONFIG_DIR', s.configDir],
      ['TMUX_TMPDIR', probeTmuxDir(s)], ['CCRC_PROBE_TMUX_SOCKET', s.socket],
    ],
  };
}

/** Today's count. */
export interface ProbeBudget { readonly day: string; readonly used: number }

/** The UTC day of a time, `YYYY-MM-DD`. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The count for the day `now` falls in: the kept one when it is that day's, else a new day's, at zero. */
export function budgetOn(kept: ProbeBudget | null, now: number): ProbeBudget {
  const day = utcDay(now);
  return kept !== null && kept.day === day ? kept : { day, used: 0 };
}

/** `budget-spent` when the day's count has reached the budget, else `null`. */
export function budgetRefusal(b: ProbeBudget, perDay: number): ProbeRefusal | null {
  return b.used < perDay ? null : 'budget-spent';
}

/** One more probe counted. */
export const spend = (b: ProbeBudget): ProbeBudget => ({ day: b.day, used: b.used + 1 });

/** The budget file's text, or `null` when it is not one. */
export function parseBudget(text: string | null): ProbeBudget | null {
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as { day?: unknown; used?: unknown };
    if (typeof o.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.day)) return null;
    if (typeof o.used !== 'number' || !Number.isInteger(o.used) || o.used < 0) return null;
    return { day: o.day, used: o.used };
  } catch {
    return null;
  }
}

/** The status answer's probe block. */
export function probesView(i: {
  readonly refusal: ProbeRefusal | null; readonly queue: QueueState; readonly names: ReadonlyMap<string, string>;
  readonly budget: ProbeBudget; readonly perDay: number;
}): TestboxProbes {
  const nameOf = (id: string): string => i.names.get(id) ?? id;
  return {
    enabled: i.refusal === null, refusal: i.refusal,
    running: i.queue.running.length === 0 ? null : nameOf(i.queue.running[0]!.id),
    waiting: i.queue.waiting.map((e) => nameOf(e.id)), day: i.budget.day, used: i.budget.used, perDay: i.perDay,
  };
}
