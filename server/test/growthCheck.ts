// D-5848 (ARCH-01, #526): the measuring half of the god-file growth check.
// One comment-and-blank stripper per language, and `netGrowth`, which reads a
// file's blob at two shas with `git show` and answers its net code lines at
// each. The suite that reports is `growth-check.test.ts`.
//
// TypeScript: `//` and `/* … */` comments are stripped, string-, template- and
// regex-literal aware, then blank lines are dropped. Bash: `#` comment lines
// and blank lines are dropped, and heredoc bodies (`<<EOF`, `<<'EOF'`,
// `<<"EOF"`, `<<-EOF`) are counted separately, so a `#` line inside one is
// content, not a comment. A file's code lines are its code plus its heredoc
// lines: an embedded script grows the file as much as the shell around it.
//
// D-6119 (ARCH-01 (#526) acceptance 3): the absolute numbers go to the CI job
// summary only, never into an assertion: each listed file's code lines at the
// merge-base and at HEAD, and FleetWatcher's method count by ARCH-00's parser
// (`scan/parse.ts`). `growthSummary` renders them; `appendJobSummary` appends
// to `$GITHUB_STEP_SUMMARY` when the runner sets it.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parseSource } from './scan/parse.js';

/** A listed file may grow by this many net code lines before it is named. */
export const GROWTH_LIMIT = 40;

/** The waiver list: growth over the limit is waived when the same diff adds a
 *  new file under one of these (the 08-10 architecture spec's ring table: the
 *  `coord/` deciders and the L0 kernel), until ARCH-04 stage 1 replaces this
 *  list with its classifier. */
export const L1_L2_NEW_FILE_DIRS: readonly string[] = ['server/src/coord/', 'shared/'];

const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'else', 'do', 'void',
  'delete', 'throw', 'new', 'yield', 'await', 'instanceof']);

/** `src` with every TS comment removed; newlines are kept, so line numbers hold. */
export function stripTs(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  // One entry per open `{`: 'brace' for a code block, 'tmpl' for a `${` inside a template.
  const braces: ('brace' | 'tmpl')[] = [];
  /** The last significant (non-space) token emitted outside comments. */
  const prevSignificant = (): string => {
    let j = out.length - 1;
    while (j >= 0 && /\s/.test(out[j]!)) j--;
    if (j < 0) return '';
    if (/[A-Za-z0-9_$]/.test(out[j]!)) {
      let k = j;
      while (k > 0 && /[A-Za-z0-9_$]/.test(out[k - 1]!)) k--;
      return out.slice(k, j + 1);
    }
    return out[j]!;
  };
  const regexAllowed = (): boolean => {
    const p = prevSignificant();
    if (p === '') return true;
    if (p.length === 1 && REGEX_AFTER.has(p)) return true;
    return REGEX_AFTER_WORDS.has(p);
  };
  /** Copies a template body from `i` (just after its opening backtick or a closing `}`). */
  const template = (): void => {
    while (i < n) {
      const c = src[i]!;
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { out += c; i++; return; }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; braces.push('tmpl'); return; }
      out += c; i++;
    }
  };
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, '');
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') { out += c; i++; template(); continue; }
    if (c === '{') { braces.push('brace'); out += c; i++; continue; }
    if (c === '}') {
      const top = braces.pop();
      out += c; i++;
      if (top === 'tmpl') template();
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        const r = src[j]!;
        if (r === '\\') { j += 2; continue; }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c; i++;
  }
  return out;
}

const HEREDOC_RE = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;

/** Bash code lines and heredoc-body lines; `#` comment lines and blank lines in neither. */
export function measureBash(src: string): { code: number; heredoc: number } {
  let code = 0;
  let heredoc = 0;
  /** Heredocs opened on earlier lines, in the order their bodies follow. */
  const pending: { delim: string; tabs: boolean }[] = [];
  for (const line of src.split('\n')) {
    const open = pending[0];
    if (open) {
      const probe = open.tabs ? line.replace(/^\t+/, '') : line;
      if (probe === open.delim) { pending.shift(); continue; }
      if (line.trim() !== '') heredoc++;
      continue;
    }
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    code++;
    for (const m of line.matchAll(HEREDOC_RE)) {
      // `<<<` is a here-string, not a heredoc.
      if (m.index !== undefined && m.index > 0 && line[m.index - 1] === '<') continue;
      pending.push({ delim: m[3]!, tabs: m[1] === '-' });
    }
  }
  return { code, heredoc };
}

/** Net code lines of `src`, by the stripper `file`'s extension picks. */
export function codeLines(file: string, src: string): number {
  if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(file)) {
    return stripTs(src).split('\n').filter((l) => l.trim() !== '').length;
  }
  const b = measureBash(src);
  return b.code + b.heredoc;
}

/** `atBoth`: the file exists at both shas, so a negative delta is a real shrink. */
export interface GrowthRow { file: string; base: number; head: number; delta: number; atBoth: boolean }

/** `file`'s blob at `sha`, or null when the file does not exist there. */
export function fileAt(file: string, sha: string, cwd: string): string | null {
  try {
    return execFileSync('git', ['show', `${sha}:${file}`],
      { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** Net code lines of `file` at `baseSha` and `headSha` (0 where it is absent). */
export function netGrowth(file: string, baseSha: string, headSha: string, cwd: string): GrowthRow {
  const at = (sha: string): number | null => {
    const text = fileAt(file, sha, cwd);
    return text === null ? null : codeLines(file, text);
  };
  const base = at(baseSha);
  const head = headSha === baseSha ? base : at(headSha);
  const b = base ?? 0;
  const h = head ?? 0;
  return { file, base: b, head: h, delta: h - b, atBoth: base !== null && head !== null };
}

/** Paths the diff `baseSha..headSha` adds. */
export function addedFiles(baseSha: string, headSha: string, cwd: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', '-z', baseSha, headSha],
    { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter((p) => p !== '');
}

/** The listed files that grew by more than GROWTH_LIMIT, minus the waived: the
 *  same diff adds a file under L1_L2_NEW_FILE_DIRS, or shrinks another listed
 *  file by at least as much as this one grew. A listed file absent at either
 *  sha (deleted, renamed, new) is no shrink and waives nothing. */
export function growthOver(rows: readonly GrowthRow[], added: readonly string[]): string[] {
  const newRingFile = added.some((p) => L1_L2_NEW_FILE_DIRS.some((d) => p.startsWith(d)));
  return rows
    .filter((r) => r.delta > GROWTH_LIMIT)
    .filter((r) => !newRingFile)
    .filter((r) => !rows.some((o) => o.file !== r.file && o.atBoth && -o.delta >= r.delta))
    .map((r) => r.file);
}

/** The class whose method count the summary reports, and the file that declares it. */
export const METHOD_COUNT_CLASS = 'FleetWatcher';
export const METHOD_COUNT_FILE = 'server/src/watch.ts';

/** `cls`'s own methods in `src`, by ARCH-00's parser: kind `method` keyed
 *  `cls.name` (static ones included). A getter, setter, arrow property, the
 *  constructor and a function nested inside a method are not counted. */
export function classMethodCount(src: string, cls: string): number {
  const prefix = `${cls}.`;
  return parseSource(src, 'source.ts').symbols
    .filter((s) => s.kind === 'method' && s.name.startsWith(prefix) && !s.name.slice(prefix.length).includes('.'))
    .length;
}

export interface GrowthSummaryInput {
  base: string;
  rows: readonly GrowthRow[];
  over: readonly string[];
  methods: { base: number; head: number };
  armed: boolean;
}

const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n}`;

/** The CI job summary: one row per listed file with its absolute code lines,
 *  the method count, and GROWTH_OVER. Markdown. */
export function growthSummary(i: GrowthSummaryInput): string {
  return [
    '### God-file growth check (D-5848, D-6119)',
    '',
    `Net code lines against the merge-base \`${i.base.slice(0, 7)}\`${i.armed ? '' : '; reporting only until OA-C2'}.`,
    '',
    '| File | Base | Head | Delta |',
    '| --- | ---: | ---: | ---: |',
    ...i.rows.map((r) => `| \`${r.file}\` | ${r.base} | ${r.head} | ${signed(r.delta)} |`),
    '',
    `${METHOD_COUNT_CLASS} methods (\`${METHOD_COUNT_FILE}\`): base ${i.methods.base}, head ${i.methods.head}, delta ${signed(i.methods.head - i.methods.base)}`,
    '',
    `GROWTH_OVER: ${i.over.length ? i.over.map((f) => `\`${f}\``).join(', ') : '(none)'}`,
    '',
  ].join('\n');
}

/** Appends `md` to the job summary file the runner names; false (and nothing
 *  written) when `GITHUB_STEP_SUMMARY` is unset or empty. */
export function appendJobSummary(md: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = env['GITHUB_STEP_SUMMARY'];
  if (!file) return false;
  appendFileSync(file, md);
  return true;
}
