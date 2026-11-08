// #1170. L3 adapter: the agent's `pressure` op reads the host's pressure stall information and answers WHAT IT READ.
// It decides nothing: the level and the link's classification are `server/src/pressure.ts`'s.
//
// The op takes no argument, so no path from a caller is ever read: the two files are fixed. They are kernel text,
// never on a disk, so a stalled volume cannot hang this read. A file that cannot be read or parsed (no PSI in this
// kernel, not a Linux box) throws, and the op answers an error: the server reads that as unmeasured, never as calm.
import { readFileSync } from 'node:fs';
import type { PressureOpReply } from '../../shared/agent-protocol.js';
import { parsePressureText } from '../../shared/pressure.js';

/** The two files read, by resource. */
export const PRESSURE_FILES = { memory: '/proc/pressure/memory', io: '/proc/pressure/io' } as const;

/** Every read this op makes, so a test injects the answer. */
export interface PressureSeams { readFile(p: string): string }

const realSeams: PressureSeams = { readFile: (p) => readFileSync(p, 'utf8') };

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
// whatever this box's user manager made it. With the slice found: `memory.max` minus `memory.current`, no more than the
// host's `MemAvailable` (a cap above the box's own memory is not room); `memory.max` reading `max` (no cap) is
// `MemAvailable` alone. With no slice (no systemd, no cgroup v2, a box with no session ever started) it is
// `MemAvailable` alone too. Anything unreadable is `null`, which the server reads as unmeasured (it admits, and says so).

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

/** The slice's directory under the cgroup root, or null when no ancestor of this process's cgroup holds one. */
function findSlice(read: (p: string) => string): string | null {
  let own: string;
  try { own = read(HEADROOM_FILES.selfCgroup); } catch { return null; }
  const m = /^0::(\/[^\n]*)$/m.exec(own);
  if (m === null) return null;
  const parts = m[1]!.split('/').filter((x) => x !== '');
  for (let i = parts.length; i >= 0; i--) {
    const dir = `${HEADROOM_FILES.cgroupRoot}/${[...parts.slice(0, i), SESSION_SLICE_DIR].join('/')}`;
    try { read(`${dir}/memory.max`); return dir; } catch { /* not here: look one level up */ }
  }
  return null;
}

/** The session slice's headroom in bytes, or null when it could not be read. Never throws. */
export function measureHeadroom(given: Partial<PressureSeams> = {}): number | null {
  const read = { ...realSeams, ...given }.readFile;
  const avail = memAvailable(read);
  const slice = findSlice(read);
  if (slice === null) return avail;
  let max: string; let cur: number | null;
  try { max = read(`${slice}/memory.max`).trim(); cur = nonNeg(read(`${slice}/memory.current`).trim()); } catch { return null; }
  if (max === 'max') return avail;
  const cap = nonNeg(max);
  if (cap === null || cur === null) return null;
  const room = Math.max(0, cap - cur);
  return avail === null ? room : Math.min(room, avail);
}
