// The guard seam (delegation broker wave 4, PR4 Task 4.1): one definition for `delegation-spool.test.ts` and
// `session-hook.test.ts`.
//
// A two-read guard such as `[[ ! -L "$f" && ( -f "$f" || ! -e "$f" ) ]]` refuses a plain append when a sibling creates or
// removes the file between two of its reads (D-5434's race). Bash expands each operand of `[[ ]]` only when that operand is
// evaluated, left to right with short-circuit, so a guard line whose operands are each `"$(_w4_seam "$f")"` runs the seam once
// per read, in order, and the seam's side effect lands between two reads. No sleep, no race, and nothing in the shipped hook
// changes: the rows run a COPY of the hook with that one line rewritten.
import fs from 'node:fs';
import path from 'node:path';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The guard line of `fn` in the hook's text: the first code line after `${fn}() {` that tests `-L "$${v}"`. Throws if the
 *  function or the line is not found, so a refactor that moves the guard turns its rows red, never vacuously green. */
export function guardLine(src: string[], fn: string, v: string): { open: number; at: number } {
  const open = src.findIndex((l) => l.startsWith(`${fn}() {`));
  if (open < 0) throw new Error(`hookGuardSeam: no \`${fn}() {\` in the hook`);
  const test = new RegExp(`-L "\\$${escapeRe(v)}"`);
  for (let i = open + 1; i < src.length && !/^\}/.test(src[i]!); i += 1) {
    if (/^\s*#/.test(src[i]!)) continue;
    if (test.test(src[i]!)) return { open, at: i };
  }
  throw new Error(`hookGuardSeam: no line in ${fn} tests -L "$${v}"`);
}

/** A copy of the session hook in `dir`, with ONE line changed: the first code line after `${fn}() {` that tests
 *  `-L "$${v}"`. Every `"$${v}"` operand on that line becomes `"$(_w4_seam "$${v}")"`. `reads` is the number of
 *  operands rewritten. Throws if the line is not found, or if `reads < 2` (the seam would prove nothing). */
export function seamHook(dir: string, fn: string, v: string): { file: string; reads: number } {
  const hook = path.resolve(__dirname, '../../ccd/session-hook.sh');
  const src = fs.readFileSync(hook, 'utf8').split('\n');
  const { at } = guardLine(src, fn, v);
  let reads = 0;
  src[at] = src[at]!.replace(new RegExp(`"\\$${escapeRe(v)}"`, 'g'), () => { reads += 1; return `"$(_w4_seam "$${v}")"`; });
  if (reads < 2) throw new Error(`hookGuardSeam: ${fn}'s guard reads "$${v}" ${reads} time(s); the seam needs two or more`);
  const file = path.join(dir, `w4-seam-${fn}.sh`);
  fs.writeFileSync(file, src.join('\n'), { mode: 0o755 });
  return { file, reads };
}

/** A BASH_ENV file that defines `_w4_seam`. Each call counts itself in `$HOME/w4-seam-n`. On call number `at` it
 *  creates (`: >> "$1"`) or removes (`rm -f -- "$1"`) the path, then prints the path. */
export function seamEnv(home: string, at: number, move: 'create' | 'remove'): Record<string, string> {
  const file = path.join(home, `w4-seam-env-${move}-${at}.bash`);
  const act = move === 'create' ? ': >> "$1"' : 'rm -f -- "$1"';
  fs.writeFileSync(file, [
    '_w4_seam() {',
    '  local n=0',
    '  { read -r n < "$HOME/w4-seam-n"; } 2>/dev/null',
    '  n=$(( ${n:-0} + 1 ))',
    '  printf \'%s\\n\' "$n" > "$HOME/w4-seam-n"',
    `  if (( n == ${at} )); then ${act}; fi`,
    '  printf \'%s\' "$1"',
    '}',
    '',
  ].join('\n'));
  return { BASH_ENV: file };
}

/** How many times the seam ran since the counter was last removed (0 when it never ran). */
export function seamCount(home: string): number {
  const f = path.join(home, 'w4-seam-n');
  return fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8').trim()) : 0;
}

/** W4-H3's source pin, for `fn`'s guard on `$${v}`: the guard line refuses with `ret`, applies each of `-L -d -p -S -b -c` to
 *  `"$${v}"`, holds no `-f`, no `! -e` and no negated type test, and no code line between the function's opening and its write
 *  (`${op} "$${v}"`) holds `-f "$${v}"` or `! -e "$${v}"`. Returns the failures, empty when the pin holds. Throws when it
 *  finds no guard line or no write line, as `seamHook` does, so it can never pass vacuously. */
export function guardPin(fn: string, v: string, ret: string, op: '>>' | '>'): string[] {
  const hook = path.resolve(__dirname, '../../ccd/session-hook.sh');
  const src = fs.readFileSync(hook, 'utf8').split('\n');
  const { open, at } = guardLine(src, fn, v);
  const q = `"\\$${escapeRe(v)}"`;
  const write = new RegExp(`(^|[^>])${escapeRe(op)} ${q}`);
  let end = -1;
  for (let i = open + 1; i < src.length && !/^\}/.test(src[i]!); i += 1) {
    if (!/^\s*#/.test(src[i]!) && write.test(src[i]!)) { end = i; break; }
  }
  if (end < 0) throw new Error(`hookGuardSeam: no \`${op} "$${v}"\` write in ${fn}`);
  const g = src[at]!;
  const bad: string[] = [];
  if (!g.includes(ret)) bad.push(`the guard line does not \`${ret}\`: ${g.trim()}`);
  for (const t of ['L', 'd', 'p', 'S', 'b', 'c']) {
    if (!new RegExp(`-${t} ${q}`).test(g)) bad.push(`the guard line does not test -${t} "$${v}"`);
  }
  if (new RegExp(`-f ${q}`).test(g)) bad.push(`the guard line tests -f "$${v}"`);
  if (new RegExp(`! -e ${q}`).test(g)) bad.push(`the guard line tests ! -e "$${v}"`);
  if (new RegExp(`! -[LdpSbc] ${q}`).test(g)) bad.push(`the guard line negates a type test: ${g.trim()}`);
  for (let i = open + 1; i <= end; i += 1) {
    if (/^\s*#/.test(src[i]!)) continue;
    if (new RegExp(`-f ${q}|! -e ${q}`).test(src[i]!)) bad.push(`a code line before the write reads the two-read shape: ${src[i]!.trim()}`);
  }
  return bad;
}

/** A BASH_ENV file whose top-level DEBUG trap (no functrace, so it fires only for top-level commands) appends
 *  "$W4_TAG" to $HOME/w4-reached when $BASH_COMMAND is exactly `_hook_spool_append`. $? is preserved. */
export function reachProbe(home: string): string {
  const file = path.join(home, 'w4-reach-probe.bash');
  fs.writeFileSync(file, [
    // Bash restores $? after a DEBUG trap (measured on 5.2: a trap running `false` leaves `$?` as the command left it), so the
    // probe never changes a branch the hook takes. Builtins only: the probe adds no fork.
    'trap \'if [[ "$BASH_COMMAND" == _hook_spool_append ]]; then { printf "%s\\n" "${W4_TAG-}" >> "$HOME/w4-reached"; } 2>/dev/null; fi\' DEBUG',
    '',
  ].join('\n'));
  return file;
}

export type AppendFate = 'appended' | 'lost-append' | 'identity-skip';
/** For each tag: 'appended' if a line carries it; else 'lost-append' if it reached the call; else 'identity-skip'
 *  (the event ended before the spool call: D-4662's silent exits, the bounded tmux lookup included). */
export function fates(tags: string[], present: Set<string>, reached: Set<string>): Map<string, AppendFate> {
  return new Map(tags.map((t): [string, AppendFate] => [t, present.has(t) ? 'appended' : reached.has(t) ? 'lost-append' : 'identity-skip']));
}
