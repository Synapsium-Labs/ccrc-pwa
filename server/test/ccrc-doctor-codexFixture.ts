// The helpers the `ccrc-doctor-codex*.test.ts` parts share (D-6767), moved here unchanged from `ccrc-doctor-codex.test.ts` when
// that file, about 405 s on a CI runner and past the trace job's 1560 s budget under `strace -f`, was split by describe block.
// The fixtures the whole doctor family shares are in `ccrc-doctorFixture.ts`; nothing here is a case.
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKS_SRC } from './ccrc-doctorFixture.js';

/** The line after the first line `re` matches — its remedy, by `_dr_line`'s contract. */
export const remedyAfter = (out: string, re: RegExp): string => {
  const ls = out.split('\n');
  const i = ls.findIndex((l) => re.test(l));
  return i === -1 ? '' : (ls[i + 1] ?? '');
};
/** Every file under `roots`, by bytes AND mtime, and every directory by mtime:
 *  a rewrite of identical bytes still moves an mtime, and a tmp created and
 *  removed still moves its directory's. */
export function treeState(...roots: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    out[`${d}/`] = String(lstatSync(d).mtimeMs);
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out[p] = `${st.mtimeMs}:${st.isFile() ? readFileSync(p, 'utf8') : 'not-a-file'}`;
    }
  };
  for (const r of roots) walk(r);
  return out;
}

/** `s` as a RegExp source that matches it literally (a fixture path carries `.` and `-`). */
export const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One function out of ccd/ccrc-doctor-checks, column-0 signature to column-0 `}`. */
export function checksFunction(name: string): string {
  const m = new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?\\n\\}`, 'm').exec(readFileSync(CHECKS_SRC, 'utf8'));
  if (m === null) throw new Error(`ccd/ccrc-doctor-checks has no ${name}() { … } at column 0`);
  return m[0];
}
