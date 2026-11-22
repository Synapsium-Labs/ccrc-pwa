// #1170. L3 adapter: the agent's `pressure` op reads the host's pressure stall information and answers WHAT IT READ.
// It decides nothing: the level and the link's classification are `server/src/pressure.ts`'s.
//
// The op takes no argument, so no path from a caller is ever read: the two files are fixed. They are kernel text,
// never on a disk, so a stalled volume cannot hang this read. A file that cannot be read or parsed (no PSI in this
// kernel, not a Linux box) throws, and the op answers an error: the server reads that as unmeasured, never as calm.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import type { PressureOpReply, ReadFailure } from '../../shared/agent-protocol.js';
import { parsePressureText, readHostMachine, type HostMachine, type SessionMemLimit } from '../../shared/pressure.js';

/** The two files read, by resource. */
export const PRESSURE_FILES = { memory: '/proc/pressure/memory', io: '/proc/pressure/io' } as const;

/** Every read this op makes, so a test injects the answer. `totalmem` and `cores` are the machine's size
 *  (D-8920): the box's memory in bytes and the cores this process may run on. */
export interface PressureSeams { readFile(p: string): string; totalmem(): number; cores(): number }

const realSeams: PressureSeams = {
  readFile: (p) => readFileSync(p, 'utf8'),
  totalmem: () => os.totalmem(),
  cores: () => os.availableParallelism(),
};

/** Both resources' PSI, or a throw naming the one that could not be read. */
export function measurePressure(given: Partial<PressureSeams> = {}): PressureOpReply {
  const seams = { ...realSeams, ...given };
  const one = (res: keyof typeof PRESSURE_FILES) => {
    const parsed = parsePressureText(seams.readFile(PRESSURE_FILES[res]));
    if (parsed === null) throw new Error(`pressure: ${PRESSURE_FILES[res]} has no some/full lines`);
    return parsed;
  };
  return { memory: one('memory'), io: one('io') };
}

// ── the session slice's headroom (D-8122) ───────────────────────────────────────────────────────────────────────────
// The server's memory gate for automatic wakes reads this beside the PSI: how much the session slice can still take.
// The slice is FOUND, never built: its directory (`SESSION_SLICE_DIR`, the cgroup name systemd gives the session
// template's slice) is looked for beside each ancestor of this process's own cgroup, nearest first, so the path is
// whatever this box's user manager made it. With the slice found: `memory.max` minus the slice's `memory.stat` `anon`,
// no more than the host's `MemAvailable` (a cap above the box's own memory is not room). `memory.current` is never
// read: it counts the file page cache charged to the slice, which the kernel reclaims before it fails a charge, so a
// fleet of sessions reading git trees and node_modules would read near the cap on a box with plenty of memory and hold
// every automatic wake. `anon` is the rule the 2026-10-16 plan's stop rule and `ccd`'s `_mem_headroom` already use.
// `memory.max` reading `max` (no cap) is `MemAvailable` alone. With no slice (no systemd, no cgroup v2, a box with no
// session ever started) it is `MemAvailable` alone too. Anything unreadable is `null`, which the server reads as
// unmeasured (it admits, and says so).

/** The session slice's cgroup directory name (`app-claude\x2dsession.slice`, with the backslash systemd writes). */
export const SESSION_SLICE_DIR = 'app-claude\\x2dsession.slice';
/** The fixed reads, so a test plants a tree. */
export const HEADROOM_FILES = { selfCgroup: '/proc/self/cgroup', meminfo: '/proc/meminfo', cgroupRoot: '/sys/fs/cgroup' } as const;

const nonNeg = (t: string): number | null => (/^[0-9]{1,19}$/.test(t) ? Number(t) : null);

function memAvailable(read: (p: string) => string): number | null {
  try {
    const m = /^MemAvailable:\s+([0-9]{1,16}) kB$/m.exec(read(HEADROOM_FILES.meminfo));
    return m === null ? null : Number(m[1]) * 1024;
  } catch { return null; }
}

/** Where the sessions live in the cgroup tree: the slice's directory under the cgroup root (null when no ancestor of
 *  this process's cgroup holds one), and the directories ABOVE the sessions, nearest first and ending at the cgroup
 *  root: the ones that hold the slice, or, with no slice, the ancestors of this process's own cgroup. This process's own
 *  leaf is never one of them: a limit on the agent's service is not a limit on the sessions. A cgroup that cannot be
 *  read (no cgroup v2, not Linux) has neither. */
interface SessionTree { slice: string | null; above: readonly string[] }

function findSessionTree(read: (p: string) => string): SessionTree {
  let own: string;
  try { own = read(HEADROOM_FILES.selfCgroup); } catch { return { slice: null, above: [] }; }
  const m = /^0::(\/[^\n]*)$/m.exec(own);
  if (m === null) return { slice: null, above: [] };
  const parts = m[1]!.split('/').filter((x) => x !== '');
  const dirOf = (n: number): string => [HEADROOM_FILES.cgroupRoot, ...parts.slice(0, n)].join('/');
  /** The directories from depth `n` up to the root, nearest first. */
  const upFrom = (n: number): string[] => Array.from({ length: n + 1 }, (_, k) => dirOf(n - k));
  for (let i = parts.length; i >= 0; i--) {
    const dir = `${dirOf(i)}/${SESSION_SLICE_DIR}`;
    try { read(`${dir}/memory.max`); return { slice: dir, above: upFrom(i) }; } catch { /* not here: look one level up */ }
  }
  return { slice: null, above: upFrom(Math.max(0, parts.length - 1)) };
}

/** One cgroup memory limit file (`memory.max`, `memory.high`): a number of bytes, `none` (the file says `max`), `absent`
 *  (it could not be read: the root cgroup has neither file, and a level with no memory controller has none), or
 *  `unreadable` (it was read and is no limit this reader knows); the last two are the wire's own `ReadFailure` words.
 *  THE ONE PARSER of these files: the headroom and the machine's size both read through it. */
function limitFile(read: (p: string) => string, file: string): number | 'none' | ReadFailure {
  let text: string;
  try { text = read(file).trim(); } catch { return 'absent'; }
  if (text === 'max') return 'none';
  return nonNeg(text) ?? 'unreadable';
}

/** The session slice's headroom in bytes, or null when it could not be read. Never throws. */
export function measureHeadroom(given: Partial<PressureSeams> = {}): number | null {
  const read = { ...realSeams, ...given }.readFile;
  return headroomOf(read, findSessionTree(read));
}

function headroomOf(read: (p: string) => string, tree: SessionTree): number | null {
  const avail = memAvailable(read);
  if (tree.slice === null) return avail;
  const cap = limitFile(read, `${tree.slice}/memory.max`);
  if (cap === 'none') return avail;
  if (cap === 'absent' || cap === 'unreadable') return null;
  let stat: string;
  try { stat = read(`${tree.slice}/memory.stat`); } catch { return null; }
  const anon = /^anon ([0-9]{1,19})$/m.exec(stat);
  if (anon === null) return null;
  const room = Math.max(0, cap - Number(anon[1]));
  return avail === null ? room : Math.min(room, avail);
}

// ── the machine's size (D-8920) ──────────────────────────────────────────────────────────────────────
// The server derives the automatic run cap from this (`server/src/coord/caps.ts#deriveCap`). It is THREE MEASURED FACTS
// and nothing decided: the box's total memory (`os.totalmem`), the cores this process may run on
// (`os.availableParallelism`, which follows CPU affinity; a cgroup CPU quota, `cpu.max`, is not read), and the
// sessions' memory limit. Which of them bounds the cap, and how, is the decider's: this adapter takes no minimum of the
// box and the limit, so the server can say which one set the cap.
//
// THE SESSIONS' MEMORY LIMIT is the smallest `memory.max` or `memory.high` on the session slice and on every cgroup
// above it, up to the root (`findSessionTree`): a limit on the user's slice, the user manager or a container's root
// cgroup holds the sessions as surely as the slice's own. `memory.high` counts because a slice at its `memory.high` is
// throttled to a standstill, not given more. With no slice (no systemd, a box where no session ever started, a
// container) the cgroups above THIS process are read instead, never its own leaf. No limit anywhere is `none`. A limit
// file that was read and could not be parsed is `unreadable`, and the server then derives nothing: the box's total
// could overstate what the sessions have. `process.constrainedMemory()` is NOT read: it is this process's own leaf,
// which may carry a service limit that is not the sessions'. The two `os` calls read no file.

/** The sessions' memory limit over `tree` (see above). */
function sessionMemLimitOf(read: (p: string) => string, tree: SessionTree): SessionMemLimit {
  const dirs = tree.slice === null ? tree.above : [tree.slice, ...tree.above];
  let least: number | null = null;
  for (const dir of dirs) {
    for (const name of ['memory.max', 'memory.high'] as const) {
      const v = limitFile(read, `${dir}/${name}`);
      // The slice's own `memory.max` was read a moment ago to find the slice: gone now, it is not "no limit".
      if (v === 'unreadable' || (v === 'absent' && dir === tree.slice && name === 'memory.max')) return 'unreadable';
      if (typeof v === 'number') least = least === null ? v : Math.min(least, v);
    }
  }
  return least ?? 'none';
}

function machineOf(seams: PressureSeams, tree: SessionTree): HostMachine | null {
  let memTotalBytes: number; let cores: number;
  try { memTotalBytes = seams.totalmem(); cores = seams.cores(); } catch { return null; }
  const read = readHostMachine({ machine: { memTotalBytes, cores, sessionMemLimit: sessionMemLimitOf(seams.readFile, tree) } });
  return read.kind === 'measured' ? read.machine : null;
}

/** The machine's size, or null when it could not be measured. Never throws. */
export function measureMachine(given: Partial<PressureSeams> = {}): HostMachine | null {
  const seams = { ...realSeams, ...given };
  return machineOf(seams, findSessionTree(seams.readFile));
}

/** What the `pressure` op answers about the sessions beside the PSI: the slice's headroom and the machine's size, over
 *  ONE walk of the cgroup tree. Never throws; each is `null` when it could not be read. */
export function measureSessions(given: Partial<PressureSeams> = {}): { headroomBytes: number | null; machine: HostMachine | null } {
  const seams = { ...realSeams, ...given };
  const tree = findSessionTree(seams.readFile);
  return { headroomBytes: headroomOf(seams.readFile, tree), machine: machineOf(seams, tree) };
}
