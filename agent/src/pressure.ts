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
