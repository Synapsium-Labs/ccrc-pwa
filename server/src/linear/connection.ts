/**
 * The Linear connection's one credential: `~/.ccrc/linear.key`.
 *
 * L3 ADAPTER over `readValueFile` (`token/files.ts`), the box token's own
 * measured reader, so the file is read by one mechanism and its first
 * non-comment line is the value by the same rule. The key has ONE source: this
 * file. It is never taken from the process environment, because a key that can
 * be set in two places can disagree with itself, and the Settings route (the
 * one writer, a later stage) could never tell which one a lookup used.
 *
 * EVERY KIND `readValueFile` returns survives here, because each has a
 * different remedy and the Settings section must say which: `absent` (paste a
 * key), `unusable` (the file has no value line), `placeholder` (an example
 * value was never replaced) and `unreadable` (the file is there and the read
 * failed, so fix permissions; it is NOT "not connected"). The file's metadata
 * is dropped, which is the only thing narrowed, and no caller here wants it.
 */
import path from 'node:path';
import { readValueFile } from '../token/files.js';

/** The file's name inside the ccrc dir. */
export const LINEAR_KEY_FILE = 'linear.key';

/** Where the key lives, under the config's ccrc dir (`cfg.ccrcDir`). */
export function linearKeyPath(ccrcDir: string): string {
  return path.join(ccrcDir, LINEAR_KEY_FILE);
}

export type LinearKeyRead =
  | { kind: 'key'; key: string }
  | { kind: 'absent' }
  | { kind: 'unusable' }
  | { kind: 'placeholder' }
  | { kind: 'unreadable'; code: string };

/** Never rejects: every outcome is a `LinearKeyRead`. */
export async function readLinearKey(ccrcDir: string): Promise<LinearKeyRead> {
  const r = await readValueFile(linearKeyPath(ccrcDir));
  switch (r.kind) {
    case 'value': return { kind: 'key', key: r.value };
    case 'absent': return { kind: 'absent' };
    case 'unusable': return { kind: 'unusable' };
    case 'placeholder': return { kind: 'placeholder' };
    case 'unreadable': return { kind: 'unreadable', code: r.code };
  }
}
