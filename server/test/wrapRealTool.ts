import { chmodSync, rmSync, writeFileSync } from 'node:fs';

/** Places a real tool into a fixture bin as a small wrapper SCRIPT, never a symlink.
 *  A symlink to a user-owned binary (nvm's node/npm/npx, `process.execPath` under $HOME) is a hazard: a later
 *  fixture write to that name (`writeFileSync(<bin>/npm, recorder)`) follows the link and overwrites the operator's
 *  real file (the incident of 2026-10-26). A write to this wrapper overwrites only the wrapper. The destination is
 *  unlinked first, so an existing link is never written through either. */
export function wrapRealTool(realTarget: string, dest: string): void {
  rmSync(dest, { force: true });
  writeFileSync(dest, `#!/bin/sh\nexec '${realTarget.replace(/'/g, `'\\''`)}' "$@"\n`);
  chmodSync(dest, 0o755);
}
