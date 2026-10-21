// path-identity W3 (P18): the test-local names this wave's suites share, each defined by the first task that uses
// it. Task 1 defines `FAKE_PROC_SELF` and stubs `writeField`, which Task 4 (the entry field) fills. Later tasks append
// `DARWIN_IDENT_SHIMS` (Task 2), `BIND_STANDIN` and `walkSpy` (Task 3), `PANE_EXEC` and `paneFragment` (Task 5), and
// `DARWIN_LSOF_STUB` (Task 9). FIXTURE HOME ONLY: every string here is bash that a harness snippet runs after ccd is
// sourced, and every write lands under the harness's HOME.
import type { PrHarness } from './ccdPrHelpers.js';
import { writeFileSync as writeFieldFile } from 'node:fs';
import { join as joinFieldPath } from 'node:path';

/** A fake process root for the expiry's working-directory probe, read through `_ws_expire_proc_root`. Its one entry
 *  is ccd's own process (`$$`): its cwd is a link to the fixture HOME, and its parent is pid 1. So an expiry ladder,
 *  audit or tail asks its probe without walking the host's /proc, and the listing still holds ccd's own pid (a listing
 *  without it measured nothing). Linux shape: a case that forces Darwin takes the lsof arm instead. */
export const FAKE_PROC_SELF =
  'mkdir -p "$HOME/fp/$$"; ln -sfn "$HOME" "$HOME/fp/$$/cwd";'
  + ' printf \'%s (b) S 1 1 1 0\\n\' "$$" > "$HOME/fp/$$/stat";'
  + ' _ws_expire_proc_root() { printf %s "$HOME/fp"; };';

/** Writes `$REG/<id>.workdirid` exactly as given: no newline is added, so a test states every byte of the field
 *  (path-identity W3, Task 4). It is `fs.writeFileSync` at that path, nothing more. */
export function writeField(h: { readonly home: string }, id: string, body: string | Buffer): void {
  writeFieldFile(joinFieldPath(h.home, '.cc-sessions', `${id}.workdirid`), body);
}

/** Forced Darwin on a LINUX host (path-identity W3). `_plat_devino`'s and `_plat_btime`'s Darwin arms run BSD
 *  `stat -f`. GNU `stat` reads `-f` as "file-system status" and takes the format as a FILE name, so both exit 1 there
 *  (measured). This shims both with GNU's spelling. On a Darwin host the real BSD spellings run, and it is empty. A
 *  snippet puts it after `CCD_OS=darwin;`. `_ws_reclaim_idwalk` carries `_plat_btime` into its bounded child by
 *  `declare -f`, so it carries this shim too. Tasks 8, 10 and 11 read it by name. */
export const DARWIN_IDENT_SHIMS = process.platform === 'darwin' ? ''
  : '_plat_devino() { stat -c \'%d:%i\' "$@"; }; _plat_btime() { stat -c %W "$@"; };';

/** `_ws_reclaim_resolve`, wrapped (path-identity W3, Task 3; R10): a spelling AT or UNDER `prefix` answers itself,
 *  basis `complete`, as `pwd -P` answers on a real bind mount, and every other spelling asks the real resolver. With
 *  `prefix` a symbolic link into a tree, the identity walk's `stat`, which follows links, meets that tree's device and
 *  inode through it, as it would through a real bind. `prefix` is spelled for bash inside double quotes, so a
 *  `$HOME/…` prefix expands in the snippet. */
export const BIND_STANDIN = (prefix: string): string =>
  'eval "_t_bind_real()$(declare -f _ws_reclaim_resolve | tail -n +2)";'
  + ` _ws_reclaim_resolve() { case "$1" in "${prefix}"|"${prefix}"/*) _WS_RESOLVED="$1"; _WS_RESOLVE_BASIS=complete; return 0 ;; esac;`
  + ' _t_bind_real "$@"; };';

/** `_ws_reclaim_idwalk`, wrapped (path-identity W3, Task 3): each call appends ONE line to `$HOME/walk-calls`, `walk`
 *  and then one `<kind><index>` token per request it was given, in request order (`walk T0 M0 P0 A0`; a call given no
 *  request is `walk`), and hands the same requests to the real walk. A request carries a path; the line never does. */
export const walkSpy =
  'eval "_t_walk_real()$(declare -f _ws_reclaim_idwalk | tail -n +2)";'
  + ' _ws_reclaim_idwalk() { local _t_q _t_r _t_k="" _t_tab=$\'\\t\'; local -a _t_qs=();'
  + ' while IFS= read -r -d \'\' _t_q; do _t_qs+=("$_t_q"); _t_r="${_t_q#*"$_t_tab"}";'
  + ' _t_k+=" ${_t_q%%"$_t_tab"*}${_t_r%%"$_t_tab"*}"; done;'
  + ' printf \'walk%s\\n\' "$_t_k" >> "$HOME/walk-calls";'
  + ' _t_walk_real "$@" < <(for _t_q in ${_t_qs[@]+"${_t_qs[@]}"}; do printf \'%s\\0\' "$_t_q"; done); };';
