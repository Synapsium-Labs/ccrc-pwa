// The shipped `.timer` files, planted into a fixture box's shipped tree (`<home>/ccrc`, ccrc's `$BOX_TREE_DIR`), as
// both deploy lanes place them: `_inst_tree` and deploy.sh rsync the whole tree, `deploy/systemd/` with it. The
// doctor reads each cadence from there (W8 Task C8b, D-7054; ARCH-69 (#804)), never from the installed copy, so a
// fixture box without them is a box whose tree is incomplete. `writeShippedTimer` is the per-row seam: one file
// replaced, or removed with `null`.
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIPPED = join(REPO, 'deploy', 'systemd');

/** `<tree>/deploy/systemd`, the directory the doctor reads a cadence from. */
export const shippedTimerDir = (tree: string): string => join(tree, 'deploy', 'systemd');

/** Every `.timer` the repository ships, copied into `<tree>/deploy/systemd/` (copies, so a row may edit one). */
export function plantShippedTimers(tree: string): void {
  const dir = shippedTimerDir(tree);
  mkdirSync(dir, { recursive: true });
  for (const n of readdirSync(SHIPPED).filter((f) => f.endsWith('.timer'))) copyFileSync(join(SHIPPED, n), join(dir, n));
}

/** One shipped timer replaced by `text`, or removed when `text` is null. */
export function writeShippedTimer(tree: string, unit: string, text: string | null): void {
  const f = join(shippedTimerDir(tree), unit);
  if (text === null) { rmSync(f, { force: true }); return; }
  mkdirSync(shippedTimerDir(tree), { recursive: true });
  writeFileSync(f, text);
}
