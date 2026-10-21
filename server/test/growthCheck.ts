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
//
// D-6211: a third waiver, a PR the operator names exempt. `growth-exemptions.json`
// lists entries of `{pr, file, cap, reason, ruling, since}`, and the armed rows
// read it from `origin/main`'s copy only (`exemptionsOnMain`), so a PR's own
// entry never exempts that PR. The PR number comes from `GITHUB_REF` alone
// (`prNumberFromEnv`). An entry waives its own file for its own PR while the
// measured delta stays at or below its cap (`matchExemptions`).
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parseSource } from './scan/parse.js';
import { malformedEntries } from './rings/exemptions.js';

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

/** The exemption list, repo-relative; the armed rows read `origin/main`'s copy. */
export const GROWTH_EXEMPTIONS_FILE = 'server/test/growth-exemptions.json';

/** The list's id in `EXEMPTION_SET_STAMPS` (the 60-day rule, D-6045). */
export const GROWTH_EXEMPTIONS_STAMP = `${GROWTH_EXEMPTIONS_FILE}#exemptions`;

/** One operator-named exemption: PR `pr` may grow `file` by up to `cap` net code lines. */
export interface GrowthExemption { pr: number; file: string; cap: number; reason: string; ruling: string; since: string }

const EXEMPTION_KEYS: readonly (keyof GrowthExemption)[] = ['pr', 'file', 'cap', 'reason', 'ruling', 'since'];

const PR_REF_RE = /^refs\/pull\/([1-9]\d*)\/merge$/;
const QUEUE_REF_RE = /^refs\/heads\/gh-readonly-queue\/.+\/pr-([1-9]\d*)-[0-9a-f]{40,64}$/;

/** The PR this CI run tests, from `GITHUB_REF` alone: a pull request's
 *  `refs/pull/<n>/merge`, or a merge-queue run's
 *  `refs/heads/gh-readonly-queue/<base>/pr-<n>-<sha>`. Null for anything else
 *  (a push, a schedule, a workflow_dispatch, no env). */
export function prNumberFromEnv(env: NodeJS.ProcessEnv): number | null {
  const ref = env['GITHUB_REF'] ?? '';
  const m = PR_REF_RE.exec(ref) ?? QUEUE_REF_RE.exec(ref);
  return m === null ? null : Number(m[1]);
}

const isLine = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '' && !/\n/.test(v);

/** `text` as an exemption list. Any problem (not JSON, a wrong shape, a key
 *  missing or unknown, a value out of range, a duplicate `pr` and `file`) is
 *  named, and then no entry is answered: a malformed list exempts nothing. */
export function parseExemptions(text: string, files: readonly string[], today: Date = new Date()):
  { entries: GrowthExemption[]; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { entries: [], problems: [`not JSON: ${(e as Error).message}`] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)
    || Object.keys(raw).join() !== 'exemptions' || !Array.isArray((raw as { exemptions: unknown }).exemptions)) {
    return { entries: [], problems: ['the list must be an object whose one key, `exemptions`, is an array'] };
  }
  const list = (raw as { exemptions: unknown[] }).exemptions;
  const problems: string[] = [];
  const seen = new Set<string>();
  list.forEach((e, i) => {
    const at = `#${i}`;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) { problems.push(`${at}: not an object`); return; }
    const o = e as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!(EXEMPTION_KEYS as readonly string[]).includes(k)) problems.push(`${at}: unknown key \`${k}\``);
    for (const k of EXEMPTION_KEYS) if (!(k in o)) problems.push(`${at}: missing \`${k}\``);
    if (!Number.isInteger(o['pr']) || (o['pr'] as number) < 1) problems.push(`${at}: pr must be a positive integer`);
    if (typeof o['file'] !== 'string' || !files.includes(o['file'])) problems.push(`${at}: file must be one of the listed files`);
    if (!Number.isInteger(o['cap']) || (o['cap'] as number) <= GROWTH_LIMIT) problems.push(`${at}: cap must be an integer above ${GROWTH_LIMIT}`);
    if (!isLine(o['ruling'])) problems.push(`${at}: the ruling must be one non-empty line`);
    if (typeof o['reason'] !== 'string' || typeof o['since'] !== 'string') {
      problems.push(`${at}: reason and since must be strings`);
    } else {
      problems.push(...malformedEntries({ [at]: { reason: o['reason'], since: o['since'] } }, today));
    }
    const key = `${String(o['pr'])} ${String(o['file'])}`;
    if (seen.has(key)) problems.push(`${at}: a second entry for PR ${String(o['pr'])} and ${String(o['file'])}`);
    seen.add(key);
  });
  return problems.length ? { entries: [], problems } : { entries: list as GrowthExemption[], problems };
}

/** The exemption list as `ref` (by default `origin/main`) holds it, never the
 *  working tree's: a PR's own edit never exempts that PR. Absent at `ref`, it
 *  holds no entries; malformed there, it exempts nothing and says why. */
export function exemptionsOnMain(files: readonly string[], cwd: string, ref = 'origin/main', today: Date = new Date()):
  { entries: GrowthExemption[]; problems: string[] } {
  const text = fileAt(GROWTH_EXEMPTIONS_FILE, ref, cwd);
  return text === null ? { entries: [], problems: [] } : parseExemptions(text, files, today);
}

/** For each file in `over`, the entry naming it for PR `pr`, and whether it
 *  applies: the measured delta is at or below the entry's cap. No PR number,
 *  no match. */
export interface ExemptionMatch { file: string; entry: GrowthExemption; applies: boolean }
export function matchExemptions(over: readonly string[], rows: readonly GrowthRow[],
  entries: readonly GrowthExemption[], pr: number | null): ExemptionMatch[] {
  if (pr === null) return [];
  const out: ExemptionMatch[] = [];
  for (const file of over) {
    const entry = entries.find((e) => e.pr === pr && e.file === file);
    const row = rows.find((r) => r.file === file);
    if (entry === undefined || row === undefined) continue;
    out.push({ file, entry, applies: row.delta <= entry.cap });
  }
  return out;
}

/** `GROWTH_OVER`'s list: every file that grew over the limit, an exempted one
 *  annotated with its PR, cap and ruling, and one past its cap said so. */
export function overLine(over: readonly string[], exemptions: readonly ExemptionMatch[] = [],
  quote: (f: string) => string = (f) => f): string {
  if (!over.length) return '(none)';
  return over.map((f) => {
    const m = exemptions.find((x) => x.file === f);
    if (m === undefined) return quote(f);
    return m.applies
      ? `${quote(f)} (exempt: PR #${m.entry.pr}, cap ${m.entry.cap}, ruling: ${m.entry.ruling})`
      : `${quote(f)} (over its exemption cap of ${m.entry.cap} for PR #${m.entry.pr})`;
  }).join(', ');
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

/** `cls`'s method count in `file` at the merge-base and at HEAD; a file
 *  missing at a sha counts 0 (D-6119). */
export function methodCounts(file: string, cls: string, base: string, head: string, cwd: string): { base: number; head: number } {
  const at = (sha: string): number => {
    const src = fileAt(file, sha, cwd);
    return src === null ? 0 : classMethodCount(src, cls);
  };
  return { base: at(base), head: at(head) };
}

export interface GrowthSummaryInput {
  base: string;
  rows: readonly GrowthRow[];
  over: readonly string[];
  methods: { base: number; head: number };
  armed: boolean;
  exemptions?: readonly ExemptionMatch[];
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
    `GROWTH_OVER: ${overLine(i.over, i.exemptions, (f) => `\`${f}\``)}`,
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
