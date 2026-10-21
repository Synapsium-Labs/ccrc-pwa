// path-identity W3 (P18): the test-local names this wave's suites share, each defined by the first task that uses
// it. Task 1 defines `FAKE_PROC_SELF` and stubs `writeField`, which Task 4 (the entry field) fills. Later tasks append
// `DARWIN_IDENT_SHIMS` (Task 2), `BIND_STANDIN` and `walkSpy` (Task 3), `PANE_EXEC` and `paneFragment` (Task 5), and
// `DARWIN_LSOF_STUB` (Task 9). FIXTURE HOME ONLY: every string here is bash that a harness snippet runs after ccd is
// sourced, and every write lands under the harness's HOME.
import type { PrHarness } from './ccdPrHelpers.js';

/** A fake process root for the expiry's working-directory probe, read through `_ws_expire_proc_root`. Its one entry
 *  is ccd's own process (`$$`): its cwd is a link to the fixture HOME, and its parent is pid 1. So an expiry ladder,
 *  audit or tail asks its probe without walking the host's /proc, and the listing still holds ccd's own pid (a listing
 *  without it measured nothing). Linux shape: a case that forces Darwin takes the lsof arm instead. */
export const FAKE_PROC_SELF =
  'mkdir -p "$HOME/fp/$$"; ln -sfn "$HOME" "$HOME/fp/$$/cwd";'
  + ' printf \'%s (b) S 1 1 1 0\\n\' "$$" > "$HOME/fp/$$/stat";'
  + ' _ws_expire_proc_root() { printf %s "$HOME/fp"; };';

/** Writes `$REG/<id>.workdirid` with exactly `body`, with no newline added. Until Task 4 builds the field it throws,
 *  so no earlier case can plant one. */
export function writeField(h: Pick<PrHarness, 'home'>, id: string, body: string): void {
  void h;
  throw new Error(`writeField(${id}, ${body.length} bytes): the entry field arrives in path-identity W3 Task 4`);
}

/** Forced Darwin on a LINUX host (path-identity W3). `_plat_devino`'s and `_plat_btime`'s Darwin arms run BSD
 *  `stat -f`. GNU `stat` reads `-f` as "file-system status" and takes the format as a FILE name, so both exit 1 there
 *  (measured). This shims both with GNU's spelling. On a Darwin host the real BSD spellings run, and it is empty. A
 *  snippet puts it after `CCD_OS=darwin;`. `_ws_reclaim_idwalk` carries `_plat_btime` into its bounded child by
 *  `declare -f`, so it carries this shim too. Tasks 8, 10 and 11 read it by name. */
export const DARWIN_IDENT_SHIMS = process.platform === 'darwin' ? ''
  : '_plat_devino() { stat -c \'%d:%i\' "$@"; }; _plat_btime() { stat -c %W "$@"; };';
