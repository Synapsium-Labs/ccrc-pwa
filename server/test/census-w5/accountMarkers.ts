// W5's account-marker census (D-7048; ARCH-72, Task C5a; plan 2026-10-26-consolidation-arch43-arch72-accounts.md;
// spec K16). This plan's own module, as W3's (`census-w3/`) and W8's (`census-w8/`) keep theirs: no series appends to
// `consolidationCensus.ts`'s tail (D-7043). It imports that file's shared helpers and is never re-exported from it. Its
// FIXTURE and REAL rows live in the sibling `accountMarkers.test.ts`. Only ARCH-72's tasks (C5a to C5c) edit this file.
//
// THE QUERY REPORTS. C5a pins nothing on its count: C5b takes `authdead` 6 -> 4 and C5c takes `disabled` 3 -> 1, and
// each may-only-shrink pin lands in the commit that reaches its count (spec §5.1 rule 3), importing from here.
//
// KNOWN WIDTH. A body is a column-0 `name() {` (or `function name {`) through the line that closes its unquoted braces
// (or a column-0 `}`), heredoc lines not counted; a one-line definition is one line; every other line is the file's
// top-level body. An escaped byte (`\}`, `\;`) is a literal and masked like a quoted one. A write
// is read off one code line at a time: a write assembled across lines, through an alias, through a variable bound in
// ANOTHER body, or through `eval` is not seen. Quoted text is masked (`maskQuoted`), so a sentence naming a marker
// is never read as a write; a `$(…)` inside double quotes is code.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { bashCodeOf, codeOf, esc, REPO, type CensusSite } from '../consolidationCensus.js';

/** The two per-lane account markers ARCH-72 gives one write primitive each (spec K16). */
export type AccountMarker = 'authdead' | 'disabled';

/** The fleet-wide `*-disabled` switches that are not a lane's: the `disabled` query passes over each by name. */
export const NON_LANE_DISABLED_SWITCHES: readonly string[] = [
  'stop-done-disabled', 'hibernate-disabled', 'mail-disabled', 'asks-disabled', 'child-reclaim-disabled',
  'idle-compact-nudge-disabled', 'stall-watch-disabled', 'autocompact-disabled',
];

/** The commands that write or remove a path named by their operands. A `>`/`>>` redirection is the sixth form. */
export const MARKER_WRITE_VERBS: readonly string[] = ['mv', 'rm', 'mktemp', 'touch', '_plat_mv_notdir'];

/** One writer body: `name` is `<file>#<function>`, or `<file>#<top-level>` for the file's top-level code; `line` and
 *  `text` are its first writing line. */
export interface AccountMarkerWriter extends CensusSite { readonly name: string }

/** The token that names the marker on a code line: `-authdead`, or a `-disabled` that is no other switch's and no
 *  `--disabled` flag. A suffix followed by a word character (`-authdeadX`) is another name. */
export function markerSuffixRe(marker: AccountMarker): RegExp {
  if (marker === 'authdead') return /-authdead(?![A-Za-z0-9_])/;
  const others = NON_LANE_DISABLED_SWITCHES.map((s) => esc(s.slice(0, -'-disabled'.length))).join('|');
  return new RegExp(`(?<!-)(?<!(?:^|[^A-Za-z0-9_-])(?:${others}))-disabled(?![A-Za-z0-9_])`);
}

/** The shipped bash programs under `root/ccd`: every extensionless regular file there whose first line is a bash or
 *  sh shebang, sorted (ccd, ccrc, ccd-account-health and every sibling executable). */
export function shippedBashPrograms(root: string = REPO): string[] {
  const dir = path.join(root, 'ccd');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().filter((e) => {
    if (e.includes('.')) return false;
    const p = path.join(dir, e);
    if (!statSync(p).isFile()) return false;
    const first = readFileSync(p, 'utf8').split('\n', 1)[0] ?? '';
    return /^#!\s*\S*(?:\/env\s+)?(?:\S*\/)?(?:ba)?sh\b/.test(first);
  }).map((e) => `ccd/${e}`);
}

/** One body of a bash file: a function (with its full text, for the generated-region compare) or the top level. */
export interface BashBody {
  readonly name: string;
  readonly fn: boolean;
  readonly generated: boolean;
  readonly text: string;
  readonly lines: ReadonlyArray<{ readonly line: number; readonly raw: string; readonly code: string }>;
}

/** The unquoted `{` minus `}` of one code line (`${…}` pairs cancel; braces inside quotes are masked first). */
const braceDelta = (code: string): number => {
  let d = 0;
  for (const c of maskQuoted(code, /[{}]/)) { if (c === '{') d++; else if (c === '}') d--; }
  return d;
};

const FN_DEF = /^(?:function\s+)?([A-Za-z_][A-Za-z0-9_:-]*)\s*(?:\(\)\s*\{|\s+\{)(.*)$/;
const HEREDOC_OPEN = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;
const REGION_OPEN = /^# ccrc:generated /;
const REGION_CLOSE = /^# ── END GENERATED/;

/** `src` split into its bodies: each function, in order, then the top level (`<top-level>`), last. Heredoc bodies are
 *  code (a column-0 `}` in one ends nothing; its lines are read as written, never dropped as comments). A function that
 *  opens inside a `# ccrc:generated` … `# ── END GENERATED` region is marked `generated`. */
export function bashBodies(src: string): BashBody[] {
  const lines = src.split('\n');
  const fns: { name: string; generated: boolean; at: number; end: number }[] = [];
  const top: { line: number; raw: string; code: string }[] = [];
  const pending: { word: string; tabs: boolean }[] = [];
  let inRegion = false;
  let depth = 0;
  let cur: { name: string; generated: boolean; at: number; end: number; body: { line: number; raw: string; code: string }[] } | null = null;
  const bodiesOf: Map<number, { line: number; raw: string; code: string }[]> = new Map();
  lines.forEach((raw, i) => {
    let code: string;
    let heredoc = false;
    if (pending.length > 0) {
      heredoc = true;
      const h = pending[0]!;
      if ((h.tabs ? raw.replace(/^\t+/, '') : raw) === h.word) pending.shift();
      code = raw;
    } else {
      code = bashCodeOf(raw);
      for (const m of code.matchAll(HEREDOC_OPEN)) pending.push({ word: m[3]!, tabs: m[1] === '-' });
    }
    if (!heredoc && REGION_OPEN.test(raw)) inRegion = true;
    const row = { line: i + 1, raw, code };
    if (cur !== null) {
      cur.body.push(row);
      if (!heredoc) depth += braceDelta(code);
      if (!heredoc && (raw.startsWith('}') || depth <= 0)) { cur.end = i; cur = null; }
      return;
    }
    const m = heredoc ? null : FN_DEF.exec(raw);
    if (m) {
      const f = { name: m[1]!, generated: inRegion, at: i, end: i, body: [row] };
      fns.push(f);
      bodiesOf.set(fns.length - 1, f.body);
      depth = 1 + braceDelta(bashCodeOf(m[2]!));
      if (depth > 0) cur = f;
      return;
    }
    top.push(row);
    if (!heredoc && REGION_CLOSE.test(raw)) inRegion = false;
  });
  const out: BashBody[] = fns.map((f, k) => ({
    name: f.name, fn: true, generated: f.generated,
    text: lines.slice(f.at, (f.end > f.at ? f.end : f.at) + 1).join('\n'),
    lines: bodiesOf.get(k)!,
  }));
  out.push({ name: '<top-level>', fn: false, generated: false, text: '', lines: top });
  return out;
}

/** `code` with every shell-active byte inside a quoted string masked to `_` (`;`, `&`, `|`, `(`, `)`, `<`, `>`,
 *  backticks), so a sentence like `"… (rm $REG/<w>-disabled) …"` is never read as a command or a redirection. A
 *  `$(…)` inside double quotes is code again (`tmp="$(mktemp "…-authdead.tmp.XXXXXX")"`), to its matching `)`. */
export function maskQuoted(code: string, active: RegExp = /[;&|()<>`]/): string {
  const stack: Array<'sq' | 'dq' | 'sub'> = [];
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!;
    const top = stack[stack.length - 1];
    if (top === 'sq') { if (c === "'") stack.pop(); out += active.test(c) ? '_' : c; continue; }
    if (top === 'dq') {
      if (c === '\\') { const n = code[i + 1] ?? ''; out += c + (active.test(n) ? '_' : n); i++; continue; }
      if (c === '"') { stack.pop(); out += c; continue; }
      if (c === '$' && code[i + 1] === '(') { stack.push('sub'); out += '$('; i++; continue; }
      out += active.test(c) ? '_' : c;
      continue;
    }
    if (c === '\\') { const n = code[i + 1] ?? ''; out += c + (active.test(n) ? '_' : n); i++; continue; }
    if (c === "'") stack.push('sq');
    else if (c === '"') stack.push('dq');
    else if (c === '(') stack.push('sub');
    else if (c === ')' && top === 'sub') stack.pop();
    out += c;
  }
  return out;
}

/** The command segments of one code line, quoted text masked: split at `;`, `&&`, `||`, `|`, `(`, `)` and backticks. */
const segmentsOf = (code: string): string[] => maskQuoted(code).split(/;|&&|\|\||\||\$\(|\(|\)|`/);

/** The leading words a segment may carry before its command, dropped: keywords, `!`, `{`, `}` and assignments. */
const LEAD = /^(?:\s*(?:then|do|else|elif|if|while|until|!|\{|\}|command|builtin|exec|local|declare|readonly|export|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)))+\s*/;

/** The operands one segment WRITES: a verb's whole argument list, and each `>`/`>>` redirection's target. */
function writtenOperands(seg: string): string[] {
  const out: string[] = [];
  const s = seg.replace(LEAD, '');
  const w = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(.*))?$/.exec(s.trim());
  if (w && MARKER_WRITE_VERBS.includes(w[1]!)) out.push(w[2] ?? '');
  for (const r of seg.matchAll(/(?<![-=<>&])\d?>>?(?![&>=])\s*("[^"]*"|'[^']*'|[^\s;|&)]+)/g)) out.push(r[1]!);
  return out;
}

/** The variables `body` binds to a path ending in the marker's suffix: `x="…-authdead"` (`local`, `declare` or bare),
 *  and a `for x in …` list naming one. */
function boundToMarker(body: BashBody, suffix: RegExp): Set<string> {
  const ends = new RegExp(`${suffix.source}$`);
  const vars = new Set<string>();
  for (const { code } of body.lines) {
    for (const m of code.matchAll(/(?<![A-Za-z0-9_$])([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|([^\s;|&)]+))/g)) {
      const v = (m[3] ?? m[4] ?? m[5] ?? '');
      if (ends.test(v)) vars.add(m[1]!);
    }
    for (const m of code.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;]*)/g)) {
      const words = m[2]!.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
      if (words.some((w) => ends.test(w.replace(/^["']|["']$/g, '')))) vars.add(m[1]!);
    }
  }
  return vars;
}

/** The body's first line that writes or removes a `<lane>-<marker>` path, or null. */
function firstWrite(body: BashBody, suffix: RegExp): { line: number; raw: string } | null {
  const vars = boundToMarker(body, suffix);
  const namesVar = (op: string): boolean => [...op.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)].some((m) => vars.has(m[1]!));
  for (const row of body.lines) {
    for (const seg of segmentsOf(row.code)) {
      if (writtenOperands(seg).some((op) => suffix.test(op) || namesVar(op))) return { line: row.line, raw: row.raw };
    }
  }
  return null;
}

/** `ccd/ccd`'s function texts by name under `root` (the generated regions' source), first definition wins. */
function ccdFunctionTexts(root: string): Map<string, string> {
  const ccdPath = path.join(root, 'ccd', 'ccd');
  const out = new Map<string, string>();
  if (existsSync(ccdPath)) for (const b of bashBodies(readFileSync(ccdPath, 'utf8'))) if (b.fn && !out.has(b.name)) out.set(b.name, b.text);
  return out;
}

/** The writer bodies of one bash file (`file` repo-relative), generated copies of `ccd/ccd` functions passed over. */
function writerBodiesOf(file: string, src: string, marker: AccountMarker, ccdFns: ReadonlyMap<string, string>): AccountMarkerWriter[] {
  const suffix = markerSuffixRe(marker);
  const out: AccountMarkerWriter[] = [];
  for (const body of bashBodies(src)) {
    if (file !== 'ccd/ccd' && body.generated && ccdFns.get(body.name) === body.text) continue;
    const w = firstWrite(body, suffix);
    if (w) out.push({ name: `${file}#${body.name}`, file, line: w.line, text: w.raw });
  }
  return out;
}

/** ARCH-72's writer census (D-7048): every body of the shipped bash programs under `ccd/` that writes or removes a
 *  `<lane>-<marker>` path, one site each, named `<file>#<function>` (or `<file>#<top-level>`). A function inside a
 *  `# ccrc:generated` region whose text equals `ccd/ccd`'s function of the same name is that function's copy and counts
 *  zero sites (`ccd/ccd`'s own definition is the one reported); one that matches no `ccd/ccd` function counts as its
 *  own, so a hand-written writer cannot hide in a region. At base: `authdead` 6, `disabled` 3 (plan, Task C5a). */
export function accountMarkerWriters(marker: AccountMarker, root: string = REPO): AccountMarkerWriter[] {
  const ccdFns = ccdFunctionTexts(root);
  return shippedBashPrograms(root).flatMap((file) => writerBodiesOf(file, readFileSync(path.join(root, file), 'utf8'), marker, ccdFns));
}

/** The trees the "no roster projection" pin reads (spec K16): every shipped file that could derive a lane's switch. */
export const PROJECTION_ROOTS: readonly string[] = ['deploy', 'shared', 'ccd'];

/** An `fs` (or `fs/promises`) call that creates, replaces, links or removes a path, in a `.mjs`/`.ts`/`.js`/`.cjs`. */
const JS_FS_WRITE = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|openSync|createWriteStream|renameSync|rename|copyFileSync|copyFile|cpSync|symlinkSync|symlink|linkSync|link|mkdirSync|mkdir|rmSync|rm|unlinkSync|unlink|truncateSync|truncate|utimesSync|utimes)\s*\(/;
/** The same in Python: `open(` (any mode: the pin is at 0, so a reader naming the suffix would show at once), a
 *  rename, a removal, `Path.touch`/`write_*`, `mkdir`. */
const PY_FS_WRITE = /\b(?:open|os\.replace|os\.rename|os\.remove|os\.unlink|os\.mkdir|os\.symlink|shutil\.\w+)\s*\(|\.(?:touch|write_text|write_bytes|unlink|rename|replace|mkdir|symlink_to)\s*\(/;

/** Every shipped file under `root/<dir>` for `PROJECTION_ROOTS`, repo-relative and sorted; `node_modules` skipped. */
function projectionFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d).sort()) {
      if (e === 'node_modules') continue;
      const p = path.join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  for (const dir of PROJECTION_ROOTS) walk(path.join(root, dir));
  return out;
}

/** "No roster projection", statically (spec K16; D-7048): every writer of a `<lane>-disabled` path under `deploy/`,
 *  `shared/` or `ccd/` that is NOT one of the bodies `accountMarkerWriters('disabled')` names. A bash body (an
 *  extensionless shebang'd program or a `.sh`, by the census's own rule), a `.mjs`/`.ts`/`.js`/`.cjs` line whose `fs`
 *  write call names the suffix, or a `.py` line whose file write names it. 0 at base, and pinned there: the switch's
 *  writer set is already at its target, so no generator, converge or verb derives it from the roster's kind fields. */
export function disabledProjectionWriters(root: string = REPO): AccountMarkerWriter[] {
  const suffix = markerSuffixRe('disabled');
  const allowed = new Set(accountMarkerWriters('disabled', root).map((s) => s.name));
  const ccdFns = ccdFunctionTexts(root);
  const out: AccountMarkerWriter[] = [];
  for (const file of projectionFiles(root)) {
    const src = readFileSync(path.join(root, file), 'utf8');
    const base = file.slice(file.lastIndexOf('/') + 1);
    const first = src.split('\n', 1)[0] ?? '';
    const bash = base.endsWith('.sh') || (!base.includes('.') && /^#!\s*\S*(?:\/env\s+)?(?:\S*\/)?(?:ba)?sh\b/.test(first));
    if (bash) {
      for (const w of writerBodiesOf(file, src, 'disabled', ccdFns)) if (!allowed.has(w.name)) out.push(w);
      continue;
    }
    const js = /\.(?:mjs|cjs|js|tsx?)$/.test(base) && !/\.d\.[mc]?ts$/.test(base);
    const py = base.endsWith('.py');
    if (!js && !py) continue;
    src.split('\n').forEach((text, i) => {
      const code = js ? codeOf(text) : bashCodeOf(text);
      if (suffix.test(code) && (js ? JS_FS_WRITE : PY_FS_WRITE).test(code)) out.push({ name: `${file}:${i + 1}`, file, line: i + 1, text });
    });
  }
  return out;
}
