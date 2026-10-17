// L3 — the server's own writer of ~/.ccrc/server-caps (D-5232's mechanism; plan 2026-10-16, Task 9b; spec §6.1).
//
// ON A `server` OR `both` NODE THE SERVER PROCESS IS THE WRITER of the file the fleet's hook gates on: the words this
// server advertises (`SERVER_CAPS`, shared/api.ts), stamped with this process's clock, rewritten on the watcher's own
// minute beat (`SERVER_CAPS_WRITE_MS`) and at its first tick after boot. On a `fleet` node `ccd/ccd-update-sync` writes
// the same file from the server's `GET /health`, and this module never runs there.
//
// The beat is deliberately NOT the inventory lane's: that lane runs only with a coordination database
// (`watch.ts`'s `this.deps.coord` gate), so a write tied to it would let a coord-less server's file lapse after boot,
// and its fleet would never engage the arms. An older server never rewrites the file, which is what turns a rolled-back
// server's arms off within `SERVER_CAPS_LEASE_S`.
//
// The write discipline is `writeOwnProjection`'s exactly (`./project.ts`): a dot-leading tmp, `wx`, an explicit mode,
// ONE rename(2) (a symlink at the path is replaced, never followed; a directory there refuses), the tmp removed on
// every failure arm, never throws.
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SERVER_CAPS_FILE, renderServerCaps } from '../../../shared/api.js';
import type { WriteProjectionResult } from './project.js';

/** The file's mode: the update-intent projection's, beside it in ~/.ccrc. */
export const SERVER_CAPS_FILE_MODE = 0o600;

/** The server's own beat: once a minute, a third of `SERVER_CAPS_LEASE_S`, so one missed write never turns an arm
 *  off. The fleet node's writer (`ccd-update-sync.timer`, `OnUnitActiveSec=60s`) keeps the same period. */
export const SERVER_CAPS_WRITE_MS = 60_000;

/** `writeOwnProjection`'s result shape: `code` is the fs errno when the failure carries one, the stable half a caller
 *  dedupes warnings on (never `detail`, whose tmp path is unique per attempt). A word the grammar refuses is
 *  `unwritable` with `code: null`: nothing the reader would refuse is ever written. */
export type WriteServerCapsResult = WriteProjectionResult;

/** Render `words` at `nowS` (unix seconds) and install them at `<ccrcDir>/server-caps`. Never throws. */
export async function writeServerCaps(ccrcDir: string, words: readonly string[], nowS: number): Promise<WriteServerCapsResult> {
  const dest = path.join(ccrcDir, SERVER_CAPS_FILE);
  const tmp = path.join(ccrcDir, `.${SERVER_CAPS_FILE}.${process.pid}.${Date.now()}.tmp`);
  try {
    const text = renderServerCaps(words, nowS);
    await mkdir(ccrcDir, { recursive: true });
    await writeFile(tmp, text, { mode: SERVER_CAPS_FILE_MODE, flag: 'wx' });
    // Explicit, so a permissive umask cannot widen it and a narrow one cannot make it unreadable to us.
    await chmod(tmp, SERVER_CAPS_FILE_MODE);
    await rename(tmp, dest);
    return { ok: true, path: dest };
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => { /* the refusal below is the answer */ });
    return {
      ok: false, why: 'unwritable', detail: e instanceof Error ? e.message : String(e),
      code: e instanceof Error ? (e as NodeJS.ErrnoException).code ?? null : null,
    };
  }
}
