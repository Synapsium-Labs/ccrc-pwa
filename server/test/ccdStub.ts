/**
 * D-6051 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0k; ARCH-23 (#527)). The ccd test
 * harness's one stub writer for a ccd FUNCTION.
 *
 * A test that sources ccd and then defines `_x() { … }` replaces `_x`. When `_x` is later renamed or deleted in ccd,
 * the override silently becomes a new, unused function and the test keeps passing while measuring nothing. Two such
 * stubs were in the tree (`_dispatch_compact`, `_ws_idle_ok`), defined nowhere in ccd. `stubFn` makes that state
 * loud: the snippet it returns first asks bash whether `name` is a defined function (`declare -F`), and exits 97 when
 * it is not, before the override can create it.
 *
 * Use it only AFTER ccd is sourced (every `makeCcdHarness` `sh()` snippet is). It is for ccd's own functions, not for
 * external commands such as `tmux` or `systemctl`, which `declare -F` does not see.
 */

/** The exit status of a snippet whose stub names a function the sourced ccd does not define. */
export const STUB_SEAM_GONE = 97;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A bash snippet that overrides the ccd function `name` with `body`, and exits {@link STUB_SEAM_GONE} first when ccd
 * defines no function of that name. `body` is one or more bash commands; a trailing `;` is optional.
 */
export function stubFn(name: string, body: string): string {
  if (!NAME.test(name)) throw new Error(`stubFn: not a bash function name: ${JSON.stringify(name)}`);
  const cmds = body.trim().replace(/;+\s*$/, '');
  if (cmds === '') throw new Error(`stubFn(${name}): an empty body is not a bash function; use ':'`);
  return `declare -F ${name} >/dev/null || { echo "stubFn: ccd defines no function ${name}" >&2; exit ${STUB_SEAM_GONE}; }; `
    + `${name}() { ${cmds}; };`;
}
