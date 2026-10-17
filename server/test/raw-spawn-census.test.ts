// raw-spawn-census.test.ts — every spawn of the real ccd or ccrc script in server/test and agent/test, in the
// spellings THE RULE below lists, hands it a CONTAINED env, or is named here with its reason (centralised update
// management, wave 18, R14(b); D-5250, D-5251, D-5256). The listed rules and the blind spots after them are the
// contract: a spelling in neither is not seen.
//
// WHY. HOME is the only isolation boundary ccd and ccrc have, and the second boundary — no real gh, systemctl,
// systemd-run, launchctl, tmux, curl, ssh or scp, and no real user bus — is what `ghContainedEnv` (with its options)
// and `ccrcContainedEnv` build. A spawn that skips both inherits all of it from vitest. Wave 9's census
// (`ccrc-containment.test.ts`, 3c) reads five builder files for two shapes; it cannot see a spawn in any other file,
// and review 265 (F5) named the three shapes it misses. This file is that census, over both test trees.
//
// THE RULE, decided per call, never per file:
//   * A SPAWN is a call of a spawn-family function as the file's imports spell it: `spawnSync`, `spawn`,
//     `execFileSync`, `execFile` and `execSync` by their bare names; `exec` and every `as` alias when imported from
//     child_process; `<ns>.<member>` for a namespace or default import of child_process; and node-pty's `spawn` by
//     any of those spellings (comments, strings and regex literals skipped; the call's extent found by matching its
//     parentheses). A member call on anything else (`re.exec(…)`) is never one.
//   * It EXECUTES a script when its argument text names one: a literal path ending in the scripts' directory and
//     name; a script name joined onto a binding of the scripts' directory inline (`join(SCRIPTS_DIR, 'ccrc')`); an
//     identifier bound to one in that file (a `const`/`let` whose initialiser names the path, joins a script name onto
//     a binding of the scripts' directory, or builds a command line naming one as an array `.join(…)`ed or a `+`
//     concatenation, and READS nothing); one imported under that name or an `as` alias, or reached as `<ns>.<name>`
//     through a namespace import, from a module that exports one; or a `for … of` variable over a list naming one
//     (inline, or bound to an identifier), inside that loop's body. A name resolves PER BINDING: to its nearest
//     earlier binding in the file, else the first one (a function declared above a module-level `const`), else an
//     import, so a second binding that reuses a script binding's name is judged on its own initialiser (D-5256).
//   * It runs SLICED text when it executes no script file but its argument text names a binding derived from a READ
//     of a script (its text read, then sliced, matched or handed to a helper). Those are counted on their own
//     (D-5251): a BARE one is listed in `SLICED_ALLOWED` with its reason and exact count.
//   * Its env is BARE when it has no `env` at all (no options, or only a trailing callback), `env: process.env` or
//     `env: undefined` (a trailing `as`/`satisfies` cast and wrapping parentheses ignored), or an object literal or
//     `Object.assign` that takes the parent's env with no builder call AFTER it — directly, through a top-level spread
//     of an identifier after the last builder call, through the binding an identifier names, through a spread options
//     object, or through a parameter's default. A spread in the options that cannot be followed keeps a verdict an
//     `env` key, the `env` shorthand or a followed spread already gave, and otherwise leaves the env undecided
//     (D-5256). Anything else (a builder call after the parent's env, a member such as `b.env`, an env built from
//     scratch, a parameter with no default, a helper function's return) is not one of the three shapes, and is the
//     builder's own file's to pin.
//   * The PROGRAM (the first argument; for `exec`/`execSync`, the command line's first word) of every script-naming
//     spawn is a runner, a reader or the script itself, or the census reds until it is placed. The corpus pins the
//     unplaced list itself, so the "script itself" arm, which no real spawn uses, reds when it is deleted.
//   * A BARE spawn that EXECUTES a script is a HIT. Every hit is fixed, or listed in `ALLOWED` with its reason and its
//     exact count. Both lists are pinned both ways: an unlisted hit reds, and so does a listed file whose count no
//     longer matches (a stale entry).
//
// What this does NOT see (by design, D-5253): a builder that is itself thin (a `ghContainedEnv(process.env)` with no
// net poisons), which is the builder file's own pin; and an env a helper function CALL returns, in this file or
// another (`memEnv()` in `ccrc-memory.test.ts` and `phEnv()` in `projected-home.test.ts`: each file's own
// `assertNoRealTool` row is what pins it). The fixture corpus at the end decides every spelling above on inline
// sources, so a detector that stops seeing one reds there, not only when a real file regresses.
//
// Nor does it see (D-5255): a script whose path is bound through a call it does not follow (`fileURLToPath(new
// URL('…'))`), or one handed to a helper as a parameter that the helper then spawns; and its NAMES are the ccd and
// ccrc scripts only, as R14(b) scoped it. A bare spawn of a sibling script in that directory (the doctor checks,
// the session hook, the skill installers) is outside this file, and some of those scripts call a contained tool.
//
// And (D-5256, named after review 535, none of them in the tree today): a script path followed by its arguments
// inside one string (`` `bash ${ROOT}/ccd/ccrc version` ``, `` `. ${ROOT}/ccd/ccrc; fn` ``), which a looser match
// would confuse with the sibling scripts sharing that prefix; a directory binding joined in a template
// (`` `${SCRIPTS_DIR}/ccrc` ``); a joined array concatenated further (`[…].join('\n') + '\n'`); the namespace
// spellings `require('node:child_process')`, `await import(…)` and a combined default-and-named import (`import cp,
// { spawnSync as s }`); and scope. A name resolves by text, not by lexical scope, and a destructured binding (`const
// { env } = setup(…)`) is never seen, so a contained destructured env read after an unrelated bare `const env` in
// another function is a false hit, and the mirror case, a bare destructured env read after an unrelated contained
// `const env`, is missed.
//
// The script names are built from fragments below, never written as two quoted adjacent segments:
// `single-definition.test.ts`'s scan allows exactly one file to spell the ccd script's path that way.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const ROOTS = ['server/test', 'agent/test'] as const;
const SELF = 'server/test/raw-spawn-census.test.ts';

/** Files whose BARE spawns of a script are known and reasoned, with their exact count. Claimed files cannot be edited
 *  by this wave; each entry says what it reaches and when it is to be fixed. */
const ALLOWED = new Map<string, { count: number; reason: string }>([
  ['server/test/ccrc-doctor.test.ts', {
    count: 1,
    reason: '`_box_role never asserts a state it did not measure`: sources ccrc and calls `_box_role`, which reads only '
      + 'the preset BOX_UNITS array, with HOME a path that does not exist; no tool runs. The file is under another '
      + 'run\'s claim in wave 18: fix it (ccrcContainedEnv) in the first wave that may write the file.',
  }],
]);

/** Files whose BARE spawns of text SLICED from a script are known and reasoned, with their exact count (D-5251). A
 *  slice runs whatever its functions call, so each reason names the functions and what they reach. */
const SLICED_ALLOWED = new Map<string, { count: number; reason: string }>([
  ['server/test/ccrc-doctor.test.ts', {
    count: 1,
    reason: '`_exp_env_write` with PROG=, _upd_redact and _ccrc_die, sliced from ccrc and run once per exposure arm with '
      + 'the parent\'s env and a fixture HOME; it writes the exposure file under that HOME. Under another run\'s claim in '
      + 'wave 18: give it ccrcContainedEnv in the first wave that may write the file.',
  }],
  ['server/test/ccrc-install.test.ts', {
    count: 2,
    reason: '`_ver_newer` (version arithmetic) and the `_inst_installed` harness R14(b) named (it reads '
      + 'CCRC_UPDATE_VERIFIED and CCRC_UPDATE_SPINE from the inherited env and writes BOX_INSTALLED_FILE under a fixture '
      + 'HOME), each sliced from ccrc and run with no env. Under another run\'s claim in wave 18: give each a builder in '
      + 'the first wave that may write the file.',
  }],
  ['server/test/continued-in-parity.test.ts', {
    count: 1,
    reason: 'ccd\'s CONTINUED_IN_JQ program, sliced from ccd and handed in the env (P) to every jq binary the box has, '
      + 'over fixture files with `tail`; jq and tail are the only tools it runs.',
  }],
  ['server/test/deploy-env-guard.test.ts', {
    count: 1,
    reason: '`_box_env_value`, sliced from ccrc and run with no env against a fixture env file: it reads one key and '
      + 'calls no contained tool.',
  }],
  ['server/test/macos-platform.test.ts', {
    count: 5,
    reason: 'ccd\'s platform block (`platformBlock(ccd)`) run on its own: `runBlock` and the forced-Darwin `darwinBlock` '
      + '(clock and stat arms), `swap` (`_plat_ln_swap`, ln and mv on a stub PATH), the manager payload (its own '
      + 'containment preamble refuses unless systemctl is the stub, and its bus is a fixture under HOME), and the '
      + 'Darwin-only `inBlock`. Run-only in wave 18 by choice: give each a builder in a later wave.',
  }],
  ['server/test/update-semver.test.ts', {
    count: 2,
    reason: '`_ver_newer`, sliced from ccrc and run with no env over a fixture list of tags: version arithmetic, no '
      + 'tool beyond the shell.',
  }],
]);

const D = 'ccd';
const NAMES = `(?:${D}|ccrc)`;
const Q = `['"\`]`;
/** A script path in source text: path segments `…, <D>, <name>)`, or a literal ending `<D>/<name>` and a quote. */
const SCRIPT_PATH = new RegExp(`${Q}${D}${Q}\\s*,\\s*${Q}${NAMES}${Q}\\s*\\)|\\b${D}/${NAMES}${Q}`);
/** The scripts' DIRECTORY in an initialiser's text: a join/resolve whose last segment is `<D>`, or a literal ending
 *  `/<D>` (`updateRealBox.ts` builds `CCRC_SRC` as `join(CCD_DIR, 'ccrc')`). */
const SCRIPT_DIR = new RegExp(`${Q}${D}${Q}\\s*\\)\\s*$|/${D}${Q}\\s*$`);
const READS = /\b(?:readFileSync|readFile|read|execFileSync|spawnSync|execSync|spawn)\s*\(/;
/** A READ of a file's text: what makes a binding SLICED when it also names a script (D-5251). */
const READS_TEXT = /\b(?:readFileSync|readFile|read)\s*\(/;
/** A binding that can only BE a path: a `join`/`resolve` call, a template, another name, or an arrow returning one.
 *  Read on the masked code (strings blanked), so it judges shape, never content. */
const PATHLIKE = new RegExp('^(?:(?:path\\.)?(?:join|resolve)\\s*\\(|`|[A-Za-z_$][\\w$]*\\s*$'
  + '|\\([^)]*\\)\\s*(?::\\s*[\\w.]+\\s*)?=>\\s*(?:(?:path\\.)?(?:join|resolve)\\s*\\(|`))');
const IDENT = /^[A-Za-z_$][\w$]*$/;
/** A name as a regex: `$` escaped, and a dotted name (`ns.CCD`) matched across optional spaces around its dots. */
const pat = (name: string): string => name.split('.').map((x) => x.replace(/\$/g, '\\$')).join('\\s*\\.\\s*');
const word = (name: string): RegExp => new RegExp(`(?<![\\w$.])${pat(name)}(?![\\w$])`);
/** A script named as a segment under a directory binding: `join(<dir>, '<name>')`. */
const under = (dir: string): RegExp => new RegExp(`\\(\\s*${pat(dir)}\\s*,\\s*${Q}${NAMES}${Q}\\s*\\)`);
/** The identifiers a stretch of code USES: a member name (`.x`) and an object-literal key (`{ x: …`) are not uses
 *  (`harness({ run: hang })` names no binding called `run`). */
function idents(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
    let j = m.index! - 1;
    while (j >= 0 && /\s/.test(code[j]!)) j--;
    let k = m.index! + m[0].length;
    while (k < code.length && /\s/.test(code[k]!)) k++;
    if ((code[j] === '{' || code[j] === ',') && code[k] === ':' && code[k + 1] !== ':') continue;
    out.add(m[0]);
  }
  return [...out];
}

/** `src` with comments blanked (`text`), and with string, template-literal text and regex bodies blanked as well
 *  (`code`): same length, same line breaks, so an offset means the same place in all three. */
function mask(src: string): { text: string; code: string } {
  const text = src.split('');
  const code = src.split('');
  const blank = (i: number, both: boolean): void => {
    if (src[i] === '\n') return;
    code[i] = ' ';
    if (both) text[i] = ' ';
  };
  const stack: number[] = []; // template nesting: brace depth at each `${`
  let i = 0;
  let depth = 0;
  let prev = ''; // last non-space code character
  const scanString = (quote: string): void => {
    i++;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') { blank(i, false); i++; }
      if (i < src.length) blank(i, false);
      i++;
    }
    i++;
  };
  const scanTemplate = (): void => {
    // Called at the char after a backtick, or after the `}` that closes a `${`.
    while (i < src.length) {
      if (src[i] === '\\') { blank(i, false); blank(i + 1, false); i += 2; continue; }
      if (src[i] === '`') { i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') { stack.push(depth); depth++; i += 2; return; }
      blank(i, false);
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { blank(i, true); i++; } continue; }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) blank(i, true);
      continue;
    }
    if (c === '\'' || c === '"') { scanString(c); prev = c; continue; }
    if (c === '`') { i++; scanTemplate(); prev = '`'; continue; }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      i++;
      let cls = false;
      while (i < src.length && src[i] !== '\n' && (cls || src[i] !== '/')) {
        if (src[i] === '\\') { blank(i, false); i++; } else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
        if (i < src.length) blank(i, false);
        i++;
      }
      i++;
      prev = '/';
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (stack.length > 0 && depth === stack[stack.length - 1]) { stack.pop(); i++; scanTemplate(); prev = '`'; continue; }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { text: text.join(''), code: code.join('') };
}

/** The index of the bracket that closes the one at `open`, read on `code`. */
function closeOf(code: string, open: number): number {
  let d = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') { d--; if (d === 0) return i; }
  }
  return code.length - 1;
}

/** The top-level comma-separated parts of the bracketed span [open, close] of `code`, as [start, end) offsets. */
function partsOf(code: string, open: number, close: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let d = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = code[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ',' && d === 0) { out.push([start, i]); start = i + 1; }
  }
  if (code.slice(start, close).trim() !== '') out.push([start, close]);
  return out;
}

interface Src { rel: string; raw: string; text: string; code: string }
interface Binding { name: string; at: number; init: [number, number] }

/** Every `const|let|var <name> [: type] = <init>` in a file, the initialiser running to a depth-0 `;` or line end. */
function bindingsOf(s: Src): Binding[] {
  const out: Binding[] = [];
  for (const m of s.code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=(?!=|>)/g)) {
    let i = m.index! + m[0].length;
    let d = 0;
    const start = i;
    for (; i < s.code.length; i++) {
      const c = s.code[i]!;
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; }
      else if (d === 0 && (c === ';' || (c === '\n' && !/[=,(&|?:+]\s*$/.test(s.code.slice(start, i))
        && !/^\s*[.?:&|+]/.test(s.code.slice(i + 1, i + 40))))) break;
    }
    out.push({ name: m[1]!, at: m.index!, init: [start, i] });
  }
  return out;
}
const nearest = (bs: Binding[], name: string, at: number): Binding | undefined =>
  bs.filter((x) => x.name === name && x.at < at).pop();

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
  return /\.(?:ts|mts|mjs|js)$/.test(e.name) ? [p] : [];
});
const toSrc = (rel: string, raw: string): Src => ({ rel, raw, ...mask(raw) });
const SOURCES: Src[] = ROOTS.flatMap((r) => walk(path.join(REPO, r)))
  .map((p) => path.relative(REPO, p))
  .filter((rel) => rel !== SELF)
  .map((rel) => toSrc(rel, fs.readFileSync(path.join(REPO, rel), 'utf8')));
const lineOf = (s: Src, at: number): number => s.raw.slice(0, at).split('\n').length;

interface Paths { scripts: Set<string>; dirs: Set<string> }
interface Names extends Paths {
  scoped: Array<{ name: string; from: number; to: number }>;
  /** Whether a name used at an offset is a script (or the scripts' directory): its binding decides (D-5256). */
  isScript: (name: string, at: number) => boolean;
  isDir: (name: string, at: number) => boolean;
  /** The bindings decided a script, by offset (`exportsOf` reads an exported binding's own verdict). */
  scriptAt: Set<number>;
  /** Whether a stretch of code at an offset names a script: a name that resolves to one there, or a script segment
   *  joined onto a directory binding inline (`join(SCRIPTS_DIR, 'ccrc')`, D-5256). */
  namesAt: (code: string, text: string, at: number) => boolean;
}

/** A command line built in two steps (D-5256): an array literal `.join(…)`ed, or a `+` concatenation of strings,
 *  templates and names. Read on the masked code, so it judges shape, never content. */
function joinLike(code: string): boolean {
  if (code.startsWith('[')) return /^\s*\.\s*join\s*\([^()]*\)\s*$/.test(code.slice(closeOf(code, 0) + 1));
  const ops: string[] = [];
  let d = 0;
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === '+' && d === 0 && code[i + 1] !== '+' && code[i + 1] !== '=' && code[i - 1] !== '+') {
      ops.push(code.slice(start, i).trim());
      start = i + 1;
    }
  }
  ops.push(code.slice(start).trim());
  const operand = /^(?:'[^']*'|"[^"]*"|`[\s\S]*`|[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)$/;
  return ops.length > 1 && ops.every((o) => operand.test(o));
}

/** The bindings a file decides are a script path or the scripts' directory, closed over aliases within the file, and
 *  the `for … of` variables over a list naming a script, each with its loop body's extent. A name resolves PER
 *  BINDING, as `slicedAt`'s do: to its nearest earlier binding, else an import, else (a function declared above a
 *  module-level `const`) the first binding of that name in the file (D-5256). So a second, unrelated binding that
 *  reuses a script binding's name is judged on its own initialiser. */
function namesOf(s: Src, imported: Paths): Names {
  const bs = bindingsOf(s);
  const scriptAt = new Set<number>();
  const dirAt = new Set<number>();
  // With no earlier binding, an IMPORTED name is the import: an import and a module-level `const` of one name cannot
  // coexist, so a later binding of it sits in an inner scope and must not blind the uses before it.
  const bindingOf = (name: string, at: number): Binding | undefined => nearest(bs, name, at)
    ?? (imported.scripts.has(name) || imported.dirs.has(name) ? undefined : bs.find((x) => x.name === name));
  const isScript = (name: string, at: number): boolean => {
    const b = bindingOf(name, at);
    return b ? scriptAt.has(b.at) : imported.scripts.has(name);
  };
  const isDir = (name: string, at: number): boolean => {
    const b = bindingOf(name, at);
    return b ? dirAt.has(b.at) : imported.dirs.has(name);
  };
  // The dotted names (`ns.CCRC`) come only from a namespace import; `idents` sees `ns` alone, so they are matched
  // whole.
  const dotted = (set: Set<string>): string[] => [...set].filter((n) => n.includes('.'));
  const namesScript = (code: string, at: number): boolean =>
    idents(code).some((n) => isScript(n, at)) || dotted(imported.scripts).some((n) => word(n).test(code));
  const dirNames = (): string[] =>
    [...new Set([...bs.filter((x) => dirAt.has(x.at)).map((x) => x.name), ...imported.dirs])];
  const underDir = (text: string, at: number): boolean => dirNames().some((d) => under(d).test(text) && isDir(d, at));
  for (let changed = true; changed;) {
    changed = false;
    for (const b of bs) {
      if (scriptAt.has(b.at) || dirAt.has(b.at)) continue;
      const text = s.text.slice(...b.init).trim();
      const code = s.code.slice(...b.init).trim();
      if (READS.test(code)) continue;
      const pathLike = PATHLIKE.test(code);
      if (!pathLike && !joinLike(code)) continue;
      if (SCRIPT_PATH.test(text) || namesScript(code, b.at) || underDir(text, b.at)) {
        scriptAt.add(b.at);
        changed = true;
      } else if (pathLike && (SCRIPT_DIR.test(text)
        || (/^[A-Za-z_$][\w$.]*$/.test(code) && isDir(code.replace(/\s+/g, ''), b.at)))) {
        dirAt.add(b.at);
        changed = true;
      }
    }
  }
  const scripts = new Set([...imported.scripts, ...bs.filter((x) => scriptAt.has(x.at)).map((x) => x.name)]);
  const dirs = new Set(dirNames());
  const scoped: Names['scoped'] = [];
  for (const m of s.code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+/g)) {
    const head = s.code.indexOf('(', m.index!);
    const headEnd = closeOf(s.code, head);
    let [a, b] = [m.index! + m[0].length, headEnd];
    const iterName = s.code.slice(a, b).trim();
    if (IDENT.test(iterName)) {
      const bind = nearest(bs, iterName, m.index!);
      if (!bind) continue;
      [a, b] = bind.init;
    }
    const iterCode = s.code.slice(a, b).trim();
    if (!iterCode.startsWith('[')) continue;
    if (!SCRIPT_PATH.test(s.text.slice(a, b)) && !namesScript(iterCode, a)) continue;
    let from = headEnd + 1;
    while (from < s.code.length && /\s/.test(s.code[from]!)) from++;
    let to = from;
    if (s.code[from] === '{') to = closeOf(s.code, from);
    else {
      for (let d = 0; to < s.code.length; to++) {
        const c = s.code[to]!;
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') d--;
        else if (c === ';' && d === 0) break;
      }
    }
    scoped.push({ name: m[1]!, from, to });
  }
  const namesAt = (code: string, text: string, at: number): boolean => namesScript(code, at) || underDir(text, at);
  return { scripts, dirs, scoped, isScript, isDir, scriptAt, namesAt };
}

/** Every module's exported script and directory names (its own bindings only). */
function exportsOf(srcs: Src[]): Map<string, Paths> {
  const out = new Map<string, Paths>();
  for (const s of srcs) {
    const own = namesOf(s, { scripts: new Set(), dirs: new Set() });
    const ex = [...s.code.matchAll(/\bexport\s+(?:const|let)\s+([A-Za-z_$][\w$]*)/g)]
      .map((m) => ({ name: m[1]!, at: m.index! + m[0].length }));
    const p: Paths = {
      scripts: new Set(ex.filter((x) => own.isScript(x.name, x.at)).map((x) => x.name)),
      dirs: new Set(ex.filter((x) => own.isDir(x.name, x.at)).map((x) => x.name)),
    };
    if (p.scripts.size + p.dirs.size > 0) out.set(s.rel, p);
  }
  return out;
}

/** The script and directory names a file imports: by name (an `as` alias kept), or as `<ns>.<name>` through a
 *  namespace import. */
function importsOf(s: Src, exported: Map<string, Paths>): Paths {
  const out: Paths = { scripts: new Set(), dirs: new Set() };
  const target = (spec: string): string =>
    path.relative(REPO, path.resolve(REPO, path.dirname(s.rel), spec)).replace(/\.js$/, '.ts');
  for (const m of s.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const ex = exported.get(target(m[2]!));
    if (!ex) continue;
    for (const spec of m[1]!.split(',')) {
      const [orig, alias] = spec.replace(/\btype\s+/, '').trim().split(/\s+as\s+/);
      const o = (orig ?? '').trim();
      const as = (alias ?? o).trim();
      if (ex.scripts.has(o)) out.scripts.add(as);
      if (ex.dirs.has(o)) out.dirs.add(as);
    }
  }
  for (const m of s.text.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const ex = exported.get(target(m[2]!));
    if (!ex) continue;
    for (const n of ex.scripts) out.scripts.add(`${m[1]}.${n}`);
    for (const n of ex.dirs) out.dirs.add(`${m[1]}.${n}`);
  }
  return out;
}

const FAMILY = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec'] as const;
/** Their first argument is a command LINE, not a program. */
const SHELL = new Set<string>(['execSync', 'exec']);
const CP = String.raw`['"](?:node:)?child_process['"]`;
/** The spellings that call a spawn in a file, each mapped to the member it is: the bare names (`exec` only when
 *  imported), every `as` alias of a child_process import, `<ns>.<member>` for a namespace or default import of
 *  child_process, and node-pty's `spawn` by any of those spellings. */
function calleesOf(s: Src): Map<string, string> {
  const out = new Map<string, string>(FAMILY.filter((f) => f !== 'exec').map((f) => [f, f]));
  const named = (list: string, keep: (orig: string) => string | null): void => {
    for (const spec of list.split(',')) {
      const [orig, alias] = spec.replace(/\btype\s+/, '').trim().split(/\s+as\s+/);
      const o = (orig ?? '').trim();
      const k = keep(o);
      if (k) out.set((alias ?? o).trim(), k);
    }
  };
  for (const m of s.text.matchAll(new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*${CP}`, 'g'))) {
    named(m[1]!, (o) => ((FAMILY as readonly string[]).includes(o) ? o : null));
  }
  for (const m of s.text.matchAll(new RegExp(String.raw`import\s+(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)\s+from\s*${CP}`, 'g'))) {
    for (const f of FAMILY) out.set(`${m[1]}.${f}`, f);
  }
  for (const m of s.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]node-pty['"]/g)) {
    named(m[1]!, (o) => (o === 'spawn' ? 'pty.spawn' : null));
  }
  for (const m of s.text.matchAll(/import\s+(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)\s+from\s*['"]node-pty['"]/g)) {
    out.set(`${m[1]}.spawn`, 'pty.spawn');
  }
  return out;
}
const spawnRe = (callees: Map<string, string>): RegExp => new RegExp(
  `(?<![\\w$.])(${[...callees.keys()].sort((a, b) => b.length - a.length).map(pat).join('|')})\\s*\\(`, 'g');

/** The program a spawn runs: its first argument's text, or for a command line the line's first word (`'bash'`) or
 *  the name it interpolates first (`${CCRC}`). */
function programOf(s: Src, open: number, close: number, member: string): string {
  const first = partsOf(s.code, open, close)[0];
  if (!first) return '';
  const t = s.text.slice(...first).trim();
  if (!SHELL.has(member)) return t;
  const m = /^[`'"]\s*(?:\$\{\s*([A-Za-z_$][\w$.]*)\s*\}|([^\s`'"$]+))/.exec(t);
  return m ? (m[1] ?? `'${m[2]}'`) : t;
}

/** Which bindings hold text SLICED from a script (D-5251): an initialiser that READS a script, or that names a
 *  binding already sliced. Decided per binding, an identifier resolving to its nearest earlier binding, so a later
 *  `src` that holds something else is not caught by an earlier one, and a script NAME bound elsewhere in the file
 *  under the same name (script names are per file, not per binding) does not hide a read. */
function slicedAt(s: Src, bs: Binding[], scripts: Set<string>): (name: string, at: number) => boolean {
  const byName = new Map<string, Binding[]>();
  for (const b of bs) byName.set(b.name, [...(byName.get(b.name) ?? []), b]);
  const sliced = new Set<number>();
  const is = (name: string, at: number): boolean => {
    const b = (byName.get(name) ?? []).filter((x) => x.at < at).pop();
    return b !== undefined && sliced.has(b.at);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const b of bs) {
      if (sliced.has(b.at)) continue;
      const text = s.text.slice(...b.init);
      const code = s.code.slice(...b.init);
      const reads = READS_TEXT.test(code) && (SCRIPT_PATH.test(text) || [...scripts].some((n) => word(n).test(code)));
      if (reads || idents(code).some((n) => is(n, b.at))) { sliced.add(b.at); changed = true; }
    }
  }
  return is;
}

type Shape = 'no env' | 'env: process.env' | '{ ...process.env } without a builder';
const LITERAL: Shape = '{ ...process.env } without a builder';
const BUILDER = /\b(?:ghContainedEnv|ccrcContainedEnv)\s*\(/;
const BUILDER_G = new RegExp(BUILDER.source, 'g');
const SPREAD_PARENT = /\.\.\.\s*process\.env\b/g;
const ARG_PARENT = /(?<=[(,])\s*process\.env\s*(?=[,)])/g;

/** An expression with a trailing `as`/`satisfies` cast and its wrapping parentheses removed. */
function stripCast(e: string): string {
  let x = e.trim();
  for (let i = 0; i < 4; i++) {
    const y = x.replace(/\s+(?:as|satisfies)\s+[\w$.<>[\],|&\s]+$/, '').trim();
    const z = /^\(([\s\S]*)\)$/.exec(y)?.[1]?.trim() ?? y;
    if (z === x) break;
    x = z;
  }
  return x;
}

/** True when the parent's env appears in `inner` AFTER every builder call ends: a later spread or argument wins, so
 *  `{ ...ghContainedEnv(h), ...process.env }` is the parent's env again, and a builder AFTER it contains it. */
function parentWins(inner: string, parent: RegExp): boolean {
  const at = [...inner.matchAll(parent)].map((m) => m.index!);
  if (at.length === 0) return false;
  let end = -1;
  for (const m of inner.matchAll(BUILDER_G)) end = Math.max(end, closeOf(inner, m.index! + m[0].length - 1));
  return at[at.length - 1]! > end;
}

/** The bare shape of an env EXPRESSION at [a, b), or null; an identifier is followed to its nearest earlier binding,
 *  or to its default when it is a parameter. */
function bareEnv(s: Src, a: number, b: number, bs: Binding[], hops = 0): Shape | null {
  const expr = stripCast(s.code.slice(a, b));
  if (expr === 'process.env') return 'env: process.env';
  if (/^Object\s*\.\s*assign\s*\(/.test(expr)) {
    const o = s.code.indexOf('(', s.code.indexOf('assign', a));
    const inner = s.code.slice(o, closeOf(s.code, o) + 1);
    return parentWins(inner, ARG_PARENT) || parentWins(inner, SPREAD_PARENT) ? LITERAL : null;
  }
  if (expr.startsWith('{')) {
    const open = s.code.indexOf('{', a);
    const close = closeOf(s.code, open);
    const inner = s.code.slice(open, close + 1);
    if (parentWins(inner, SPREAD_PARENT)) return LITERAL;
    // `{ ...env, X }`: a top-level spread identifier's own binding decides, but only one AFTER the last builder call
    // ends (D-5256): a later spread wins over the builder, and one before it, or inside its arguments, is contained.
    let end = -1;
    for (const m of inner.matchAll(BUILDER_G)) end = Math.max(end, closeOf(inner, m.index! + m[0].length - 1));
    for (const [pa, pb] of partsOf(s.code, open, close)) {
      if (pa - open <= end) continue;
      const m = /^\.\.\.\s*([A-Za-z_$][\w$]*)$/.exec(s.code.slice(pa, pb).trim());
      const r = m ? identEnv(s, m[1]!, a, bs, hops) : null;
      if (r) return r;
    }
    return null;
  }
  if (IDENT.test(expr)) return identEnv(s, expr, a, bs, hops);
  return null;
}
function identEnv(s: Src, name: string, at: number, bs: Binding[], hops: number): Shape | null {
  if (hops > 3) return null;
  const b = nearest(bs, name, at);
  if (b) return bareEnv(s, b.init[0], b.init[1], bs, hops + 1);
  // A parameter with a default (`(env = process.env) => …`): the default is what a call without it gets.
  let last: RegExpMatchArray | undefined;
  const param = new RegExp(`[(,]\\s*${pat(name)}\\s*(?::[^=,()]*)?=(?![=>])\\s*`, 'g');
  for (const m of s.code.slice(0, at).matchAll(param)) last = m;
  if (!last) return null; // a parameter with no default: its caller's to pin
  const start = last.index! + last[0].length;
  let i = start;
  for (let d = 0; i < s.code.length; i++) {
    const c = s.code[i]!;
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; }
    else if (c === ',' && d === 0) break;
  }
  return bareEnv(s, start, i, bs, hops + 1);
}

/** The env of an options object at [a, b): the LAST `env` key or spread decides, as it does in JS. A spread that
 *  cannot be followed leaves the env undecided here (null) only while nothing has decided it: it KEEPS a verdict an
 *  `env` key, the `env` shorthand or a followed spread already gave, so a trailing `...(cond ? {} : { timeout })`
 *  cannot erase a bare `env:` before it (D-5256). The initial `no env` is a default, not a verdict. A followed spread
 *  that names no env changes nothing. */
function optsEnv(s: Src, a: number, b: number, bs: Binding[], hops: number): Shape | null {
  return optsVerdict(s, a, b, bs, hops).shape;
}
/** `optsEnv` with whether the env was DECIDED (an `env` key or shorthand, at any depth of followed spreads) or is
 *  only the `no env` default or undecided, so a followed spread that decided nothing keeps an outer verdict too. */
function optsVerdict(
  s: Src, a: number, b: number, bs: Binding[], hops: number,
): { shape: Shape | null; decided: boolean } {
  if (hops > 3) return { shape: null, decided: false };
  const opt = stripCast(s.code.slice(a, b));
  if (IDENT.test(opt)) {
    const bind = nearest(bs, opt, a);
    // A parameter: its caller's to pin.
    return bind ? optsVerdict(s, bind.init[0], bind.init[1], bs, hops + 1) : { shape: null, decided: false };
  }
  if (!opt.startsWith('{')) {
    return { shape: opt.startsWith('[') || /^['"`]/.test(opt) ? 'no env' : null, decided: false };
  }
  const o = s.code.indexOf('{', a);
  let result: Shape | null = 'no env';
  let decided = false;
  for (const [pa, pb] of partsOf(s.code, o, closeOf(s.code, o))) {
    const p = s.code.slice(pa, pb).trim();
    if (/^env\s*:/.test(p)) {
      const v = pa + s.code.slice(pa, pb).indexOf(':') + 1;
      // node reads `env: undefined` as the parent's env (D-5256); only as the key's own value, never a spread's.
      result = stripCast(s.code.slice(v, pb)) === 'undefined' ? 'no env' : bareEnv(s, v, pb, bs);
      decided = true;
    } else if (p === 'env') { result = identEnv(s, 'env', pa, bs, 0); decided = true; }
    else if (p.startsWith('...')) {
      const name = p.slice(3).trim();
      const bind = IDENT.test(name) ? nearest(bs, name, pa) : undefined;
      const r = bind ? optsVerdict(s, bind.init[0], bind.init[1], bs, hops + 1) : { shape: null, decided: false };
      if (r.decided) { result = r.shape; decided = true; } else if (r.shape === null && !decided) result = null;
    }
  }
  return { shape: result, decided };
}
/** A callback argument: an arrow function or a `function` expression. */
const CALLBACK = /^(?:async\s+)?(?:function\b|(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>)/;
/** A callback, inline or named: an identifier bound to an arrow or `function` expression, or a declared function. */
function isCallback(s: Src, a: number, b: number, bs: Binding[]): boolean {
  const arg = s.code.slice(a, b).trim();
  if (CALLBACK.test(arg)) return true;
  if (!IDENT.test(arg)) return false;
  const bind = nearest(bs, arg, a);
  if (bind) return CALLBACK.test(s.code.slice(...bind.init).trim());
  return new RegExp(`\\bfunction\\s*\\*?\\s*${pat(arg)}\\s*\\(`).test(s.code);
}
/** The env of a spawn call: its last argument when it has two or more, else none. A trailing callback, inline or
 *  named, is not the options (`exec(cmd, cb)`, `execFile('bash', [s], cb)`): it is dropped first, so no options reads
 *  as no env (D-5256). */
function envOf(s: Src, open: number, close: number, bs: Binding[]): Shape | null {
  let parts = partsOf(s.code, open, close);
  if (parts.length >= 2 && isCallback(s, ...parts[parts.length - 1]!, bs)) parts = parts.slice(0, -1);
  if (parts.length < 2) return 'no env';
  const [a, b] = parts[parts.length - 1]!;
  return optsEnv(s, a, b, bs, 0);
}

/** The PROGRAM (a spawn's first argument) decides whether a script it names is run or only read. Every program a
 *  script-naming spawn uses is in one of these two sets, or the census reds until it is placed: a new spelling (a
 *  `'sh'`, a `'timeout'`) is a decision, never a default. */
// `bashPath` is `ccrc-token-sync.test.ts`'s `command -v bash`, read before PATH is narrowed (D-5256 made its joined
// command line a script spawn).
const RUNNERS = new Set(["'bash'", 'BASH', 'DEADLINE_BIN', 'DOCTOR_DEADLINE_BIN', 'bashPath']);
const READERS = new Set(["'git'"]); // `git show <rev>:<path>` and `git ls-files <path>` name the script as a path
interface Spawn {
  file: string; line: number; kind: 'script' | 'sliced' | null; prog: string; placed: boolean;
  shape: Shape | null; argText: string;
}
interface Hit { file: string; line: number; shape: Shape }
interface Census {
  spawns: Spawn[]; hits: Hit[]; slicedHits: Hit[]; unplaced: string[]; programs: Map<string, number>;
  exported: Map<string, Paths>;
}

/** Every spawn-family call in a set of sources, classified; the hits are the BARE ones that run a script, and the
 *  sliced hits the BARE ones that run text sliced from one. */
function analyse(srcs: Src[]): Census {
  const exported = exportsOf(srcs);
  const spawns: Spawn[] = [];
  for (const s of srcs) {
    const n = namesOf(s, importsOf(s, exported));
    const bs = bindingsOf(s);
    const sliced = slicedAt(s, bs, n.scripts);
    const callees = calleesOf(s);
    for (const m of s.code.matchAll(spawnRe(callees))) {
      const member = callees.get(m[1]!.replace(/\s+/g, '')) ?? m[1]!;
      const open = m.index! + m[0].length - 1;
      const close = closeOf(s.code, open);
      const code = s.code.slice(open, close + 1);
      const argText = s.text.slice(open, close + 1);
      const scoped = n.scoped.filter((x) => m.index! >= x.from && m.index! <= x.to).map((x) => x.name);
      const named = SCRIPT_PATH.test(argText) || n.namesAt(code, argText, m.index!)
        || scoped.some((x) => word(x).test(code));
      const prog = programOf(s, open, close, member);
      const reader = READERS.has(prog);
      const slice = !named && idents(code).some((x) => sliced(x, m.index!));
      spawns.push({
        file: s.rel, line: lineOf(s, m.index!),
        kind: named && !reader ? 'script' : slice && !reader ? 'sliced' : null,
        prog: named ? prog : '',
        placed: !named || RUNNERS.has(prog) || reader || n.isScript(prog, m.index!) || scoped.includes(prog),
        shape: envOf(s, open, close, bs), argText,
      });
    }
  }
  const programs = new Map<string, number>();
  for (const x of spawns) if (x.prog !== '') programs.set(x.prog, (programs.get(x.prog) ?? 0) + 1);
  const hits = (k: 'script' | 'sliced'): Hit[] => spawns.filter((x) => x.kind === k && x.shape !== null)
    .map((x) => ({ file: x.file, line: x.line, shape: x.shape! }));
  return {
    spawns, hits: hits('script'), slicedHits: hits('sliced'), programs, exported,
    unplaced: spawns.filter((x) => !x.placed).map((x) => `${x.file}:${x.line} (${x.prog})`),
  };
}

const fmt = (h: Hit): string => `${h.file}:${h.line} (${h.shape})`;
/** Every hit is listed with its exact count, and every listed file still holds that many: pinned both ways. */
function pinned(hs: Hit[], list: Map<string, { count: number }>, name: string, what: string): void {
  const counts = new Map<string, Hit[]>();
  for (const h of hs) counts.set(h.file, [...(counts.get(h.file) ?? []), h]);
  const unlisted = [...counts].filter(([f]) => !list.has(f)).flatMap(([, x]) => x).map(fmt);
  expect(unlisted, `${what}: ${unlisted.join(', ')}`).toEqual([]);
  for (const [f, a] of list) {
    const got = counts.get(f) ?? [];
    expect(got.length, `${name} says ${a.count} for ${f}; measured ${got.map((x) => x.line).join(', ') || 'none'}`)
      .toBe(a.count);
  }
}

/** Inline sources, one spelling per line, each line that must be a hit carrying its verdict in a trailing
 *  `// expect: <script|sliced> <shape>` comment; a line with no comment must be no hit. A line whose spawn's program
 *  must be UNPLACED ends its comment with `| unplaced` (`// expect: unplaced` when it is no hit), so the PROGRAM
 *  rule's arms are pinned too: every other line's program is placed. */
const fixture = (rel: string, lines: string[]): Src => toSrc(rel, `${lines.join('\n')}\n`);
const CORPUS: Src[] = [
  fixture('fixture/test/paths.ts', [
    "import path from 'node:path';",
    `export const CCRC = path.join(ROOT, '${D}', 'ccrc');`,
    `export const SCRIPTS_DIR = path.resolve(ROOT, '..', '${D}');`,
  ]),
  fixture('fixture/test/spellings.test.ts', [
    "import { spawnSync, execFileSync as run, exec } from 'node:child_process';",
    "import * as cp from 'node:child_process';",
    "import * as pty from 'node-pty';",
    "import * as P from './paths.js';",
    "import { CCRC, SCRIPTS_DIR } from './paths.js';",
    "import { CCRC as C } from './paths.js';",
    "const SRC = path.join(SCRIPTS_DIR, 'ccrc');",
    "const text = readFileSync(CCRC, 'utf8');",
    'const base = { env: process.env };',
    "spawnSync('bash', [CCRC]); // expect: script no env",
    "spawnSync('bash', [CCRC], { encoding: 'utf8' }); // expect: script no env",
    'execSync(`bash ${CCRC} y`); // expect: script no env',
    "spawnSync('bash', [CCRC], { env: process.env }); // expect: script env: process.env",
    "spawnSync('bash', [CCRC], { env: { ...process.env, HOME: d } }); // expect: script { ...process.env } without a builder",
    "const e = { ...process.env, HOME: d }; spawnSync('bash', [CCRC], { env: e }); // expect: script { ...process.env } without a builder",
    "spawnSync('bash', [CCRC], { env: process.env as Record<string, string> }); // expect: script env: process.env",
    "spawnSync('bash', [CCRC], { ...base, encoding: 'utf8' }); // expect: script env: process.env",
    "spawnSync('bash', [CCRC], { env: Object.assign({}, process.env, { HOME: d }) }); // expect: script { ...process.env } without a builder",
    "spawnSync('bash', [CCRC], { env: { ...ghContainedEnv(d), ...process.env } }); // expect: script { ...process.env } without a builder",
    "const f = (env = process.env) => spawnSync('bash', [CCRC], { env }); // expect: script env: process.env",
    "run('bash', [SRC], { env: process.env }); // expect: script env: process.env",
    "cp.spawnSync('bash', [P.CCRC], { env: process.env }); // expect: script env: process.env",
    "pty.spawn('bash', [CCRC], { env: process.env as Record<string, string> }); // expect: script env: process.env",
    'exec(`bash ${CCRC} x`, { env: process.env }); // expect: script env: process.env',
    "for (const s of [CCRC]) spawnSync('bash', [s], { env: process.env }); // expect: script env: process.env",
    "spawnSync('bash', ['-c', text], { env: process.env }); // expect: sliced env: process.env",
    "spawnSync('bash', [CCRC], { env: ghContainedEnv(d, { ...process.env }) });",
    "spawnSync('bash', [CCRC], { env: { ...process.env, ...ccrcContainedEnv(d) } });",
    "spawnSync('bash', [CCRC], { env: memEnv() });",
    "spawnSync('git', ['show', `HEAD:${CCRC}`]);",
    "spawnSync('bash', ['-c', 'command -v curl'], { env: process.env });",
    '/re/.exec(CCRC);',
    // D-5256, and the arms review 535 found unpinned (F2): each line below reds when its arm is deleted.
    "spawnSync('bash', [C], { env: process.env }); // expect: script env: process.env",
    "const L = [CCRC]; for (const s2 of L) spawnSync('bash', [s2], { env: process.env }); // expect: script env: process.env",
    "spawnSync('bash', [CCRC], { env: (process.env) }); // expect: script env: process.env",
    "// spawnSync('bash', [CCRC], { env: process.env });",
    `const note = "spawnSync('bash', [CCRC], { env: process.env })";`,
    "spawnSync(CCRC, [], { env: process.env }); // expect: script env: process.env",
    "spawnSync('sh', [CCRC], { env: ghContainedEnv(d) }); // expect: unplaced",
    "spawnSync('sh', [CCRC]); // expect: script no env | unplaced",
    "const j = ['set -u', `. ${CCRC}`, 'cmd_x'].join('\\n'); spawnSync('bash', ['-c', j], { env: process.env }); // expect: script env: process.env",
    "const k = '. ' + CCRC + '; cmd_x'; spawnSync('bash', ['-c', k], { env: process.env }); // expect: script env: process.env",
    "spawnSync('bash', [path.join(SCRIPTS_DIR, 'ccrc')], { env: process.env }); // expect: script env: process.env",
    "const e2 = { ...process.env, HOME: d }; spawnSync('bash', [CCRC], { env: { ...ghContainedEnv(d), ...e2 } }); // expect: script { ...process.env } without a builder",
    "spawnSync('bash', [CCRC], { env: { ...e2, ...ghContainedEnv(d) } });",
    "spawnSync('bash', [CCRC], { env: { ...ghContainedEnv(d, { ...e2 }) } });",
    "spawnSync('bash', [CCRC], { encoding: 'utf8', env: { ...process.env, HOME: d }, ...(o.timeout === undefined ? {} : { timeout: o.timeout }) }); // expect: script { ...process.env } without a builder",
    "spawnSync('bash', [CCRC], { encoding: 'utf8', ...(o.timeout === undefined ? {} : { timeout: o.timeout }) });",
    'exec(`bash ${CCRC}`, (e) => {}); // expect: script no env',
    "execFile('bash', [CCRC], (e) => {}); // expect: script no env",
    "spawnSync('bash', [CCRC], { env: undefined }); // expect: script no env",
    "const cb = (e) => {}; exec(`bash ${CCRC}`, cb); // expect: script no env",
    "function cb2() {} execFile('bash', [CCRC], cb2); // expect: script no env",
    "const o2 = { timeout: 5, ...(c ? {} : { x }) }; spawnSync('bash', [CCRC], { env: process.env, ...o2 }); // expect: script env: process.env",
    "let e3 = undefined; spawnSync('bash', [CCRC], { env: { ...ghContainedEnv(d), ...e3 } });",
  ]),
  // An imported script name stays the import before a later, inner binding of the same name (D-5256).
  fixture('fixture/test/shadow.test.ts', [
    "import { spawnSync } from 'node:child_process';",
    "import { CCRC } from './paths.js';",
    "spawnSync('bash', [CCRC], { env: process.env }); // expect: script env: process.env",
    "function later() { const CCRC = 'x'; return CCRC; }",
  ]),
  // Per binding, not per name (D-5256): the second `script` is not a script, so its bare spawn is no hit.
  fixture('fixture/test/rebind.test.ts', [
    "import { spawnSync } from 'node:child_process';",
    "import { CCRC } from './paths.js';",
    "function a() { const script = ['set -u', `. ${CCRC}`].join('\\n'); return spawnSync('bash', ['-c', script], { env: ghContainedEnv(d) }); }",
    "function b() { const script = ['set -u', 'echo hi'].join('\\n'); return spawnSync('bash', ['-c', script], { env: process.env }); }",
  ]),
];

describe('every spawn of the real ccd or ccrc script gets a contained env (wave 18, R14(b))', () => {
  const c = analyse(SOURCES);

  it('found the trees, the scripts and the spawns it is about', () => {
    // A census of nothing passes everything: each half must be measuring something, and the halves are named.
    expect([...ROOTS], 'both test trees, by name').toEqual(['server/test', 'agent/test']);
    for (const r of ROOTS) expect(SOURCES.filter((s) => s.rel.startsWith(`${r}/`)).length, r).toBeGreaterThan(5);
    expect([...(c.exported.get('server/test/ccdWsHelpers.ts')?.scripts ?? [])], 'the harness exports the ccd script path')
      .toContain('CCD');
    expect(c.spawns.filter((x) => x.kind === 'script').length, 'spawns that execute a script').toBeGreaterThan(100);
  });

  it('every BARE spawn of a script is in ALLOWED, with its exact count; no entry is stale', () => {
    pinned(c.hits, ALLOWED, 'ALLOWED', 'a script spawned with the parent\'s env');
  });

  it('every BARE spawn of text sliced from a script is in SLICED_ALLOWED, with its exact count; no entry is stale', () => {
    pinned(c.slicedHits, SLICED_ALLOWED, 'SLICED_ALLOWED', 'sliced script text spawned with the parent\'s env');
  });

  it('every program a script-naming spawn uses is placed: a runner, a reader, or the script itself', () => {
    expect(c.unplaced, `place each in RUNNERS or READERS: ${c.unplaced.join(', ')}`).toEqual([]);
    for (const p of [...RUNNERS, ...READERS]) expect(c.programs.get(p) ?? 0, `${p} is placed but no spawn uses it`).toBeGreaterThan(0);
  });

  it('every ALLOWED and SLICED_ALLOWED entry carries a reason', () => {
    for (const [f, a] of [...ALLOWED, ...SLICED_ALLOWED]) expect(a.reason.trim().length, f).toBeGreaterThan(40);
  });

  it('decides the function-extraction spawn R14(b) named by rule: no env, and it runs sliced text, not the script', () => {
    // `ccrc-install.test.ts`'s `_inst_installed` harness: `bash -c <harness>`, the harness text sliced out of the
    // script, with no env. Not an ALLOWED hit by the EXECUTES rule; counted in SLICED_ALLOWED (D-5251). A change
    // that made it spawn the script itself would turn it into an ALLOWED hit here.
    const src = SOURCES.find((s) => s.rel === 'server/test/ccrc-install.test.ts')!.raw.split('\n');
    const inst = c.spawns.filter((x) => x.file === 'server/test/ccrc-install.test.ts' && /\['-c', harness\]/.test(x.argText)
      && src.slice(x.line - 30, x.line).some((l) => l.includes('/^_inst_installed\\(\\) \\{')));
    expect(inst.length, 'the _inst_installed harness spawn').toBe(1);
    expect(inst[0]!.shape, 'it has no env').toBe('no env');
    expect(inst[0]!.kind, 'it runs text sliced from the script').toBe('sliced');
  });

  it('decides every spelling on a fixture corpus: each line gets the verdict its comment names, and no other line gets one', () => {
    const got = analyse(CORPUS);
    const want = (k: 'script' | 'sliced'): string[] => CORPUS.flatMap((s) => s.raw.split('\n').flatMap((l, i) => {
      const m = /\/\/ expect: (script|sliced) (.+?)(?: \| unplaced)?$/.exec(l);
      return m && m[1] === k ? [`${s.rel}:${i + 1} (${m[2]})`] : [];
    }));
    expect(got.hits.map(fmt).sort(), 'scripts').toEqual(want('script').sort());
    expect(got.slicedHits.map(fmt).sort(), 'sliced text').toEqual(want('sliced').sort());
    // The PROGRAM rule, pinned by its own list: a script used AS the program is placed, and an unplaced one is named.
    const unplaced = CORPUS.flatMap((s) => s.raw.split('\n').flatMap((l, i) =>
      (/\/\/ expect: (?:.* \| )?unplaced$/.test(l) ? [`${s.rel}:${i + 1}`] : [])));
    expect(got.unplaced.map((x) => x.replace(/ \(.*\)$/, '')).sort(), 'unplaced programs').toEqual(unplaced.sort());
  });
});
