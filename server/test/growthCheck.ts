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
// entry never exempts that PR. The PR number comes from `GITHUB_REF`, paired
// with its event (`prNumberFromEnv`). An entry waives its own file for its own
// PR while the measured delta stays at or below its cap, and only when the diff
// the run measures (merge-base(origin/main, HEAD)..HEAD) leaves the check's own
// files (`GROWTH_MACHINERY`) untouched (`matchExemptions`).
// `armedGrowth` is the armed rows' whole read and decision, and `growthVerdicts`
// the pure decision inside it.
//
// D-6223: a fourth waiver, the reviewed ledger. `growth-waivers/` holds one JSON
// file per waiver, `<D-number>-<slug>.json`, each `{file, maxDelta, d, reason,
// added}` (so two PRs that each add one touch two files, never the same lines).
// A PR that must grow a listed file past the limit adds one file for it in its
// own diff, where review sees it; the entry waives that file while the
// measured delta stays at or below `maxDelta`. The ledger is read at the
// merge-base and at HEAD, and only an entry whose file and D-number the
// merge-base does not hold counts (`waiversAdded`: a file added in this diff): an entry on main waives
// nothing for a later PR, and raising one waives nothing. A malformed ledger
// at either sha waives nothing. The entries are debt that consolidation W5
// (ccd in place) pays down, every entry; none is ever edited, only added by the PR
// that needs it or removed once paid.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { parseSource } from './scan/parse.js';
import { malformedEntries } from './rings/exemptions.js';

/** A listed file may grow by this many net code lines before it is named. */
export const GROWTH_LIMIT = 40;

const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n}`;

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

/** One git read, with replace objects off: a `refs/replace/` ref written in the
 *  checkout (a `git replace` of origin/main's list blob, say) never changes
 *  what the check reads (D-6211). Every git read below goes through it. */
export function gitRead(args: readonly string[], cwd: string): string {
  return execFileSync('git', ['--no-replace-objects', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
}

/** `file`'s blob at `sha`, or null when the file does not exist there. */
export function fileAt(file: string, sha: string, cwd: string): string | null {
  try {
    return gitRead(['show', `${sha}:${file}`], cwd);
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

/** Paths the diff `baseSha..headSha` touches: added, modified and deleted, and
 *  both sides of a rename. */
export function changedFiles(baseSha: string, headSha: string, cwd: string): string[] {
  return gitRead(['diff', '--name-only', '--no-renames', '-z', baseSha, headSha], cwd).split('\0').filter((p) => p !== '');
}

/** Paths the diff `baseSha..headSha` adds. */
export function addedFiles(baseSha: string, headSha: string, cwd: string): string[] {
  return gitRead(['diff', '--name-only', '--diff-filter=A', '-z', baseSha, headSha], cwd).split('\0').filter((p) => p !== '');
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

/** The PR this CI run tests, from `GITHUB_REF` read with its event: a
 *  `pull_request` run's `refs/pull/<n>/merge`, or a `merge_group` run's
 *  `refs/heads/gh-readonly-queue/<base>/pr-<n>-<sha>`. Null for anything else
 *  (a push, a schedule, a workflow_dispatch on any branch, a ref under the
 *  other event, no env). */
export function prNumberFromEnv(env: NodeJS.ProcessEnv): number | null {
  const ref = env['GITHUB_REF'] ?? '';
  const event = env['GITHUB_EVENT_NAME'];
  const m = event === 'pull_request' ? PR_REF_RE.exec(ref) : event === 'merge_group' ? QUEUE_REF_RE.exec(ref) : null;
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

/** The exemption list as `origin/main` holds it in `cwd`, never HEAD's or the
 *  working tree's: a PR's own edit never exempts that PR. Absent there, it
 *  holds no entries; malformed there, it exempts nothing and says why. */
export function exemptionsOnMain(files: readonly string[], cwd: string, today: Date = new Date()):
  { entries: GrowthExemption[]; problems: string[] } {
  const text = fileAt(GROWTH_EXEMPTIONS_FILE, 'origin/main', cwd);
  return text === null ? { entries: [], problems: [] } : parseExemptions(text, files, today);
}

/** The growth check's own files: this module and every module it imports, the
 *  rows that decide, the list, and the list's stamp and its test. When the diff
 *  the run measures (merge-base(origin/main, HEAD)..HEAD) touches any of them,
 *  no exemption applies, its own entry included, so a PR cannot reach the code
 *  that judges it and keep its exemption. */
export const GROWTH_MACHINERY: readonly string[] = [
  'server/test/growthCheck.ts',
  'server/test/growth-check.test.ts',
  GROWTH_EXEMPTIONS_FILE,
  'server/test/rings/exemption-age.test.ts',
  'server/test/rings/exemption-age.data.ts',
  'server/test/rings/exemptions.ts',
  'server/test/scan/parse.ts',
];

/** One ledger entry: `file` may grow by up to `maxDelta` net code lines in the PR whose diff adds it. */
export interface GrowthWaiver { file: string; maxDelta: number; d: string; reason: string; added: string }

const WAIVER_KEYS: readonly (keyof GrowthWaiver)[] = ['file', 'maxDelta', 'd', 'reason', 'added'];

/** Every problem in one waiver object, pushed onto `problems` under `at`; the object when it is one, else null. */
function checkWaiverEntry(e: unknown, at: string, files: readonly string[], today: Date, problems: string[]):
  Record<string, unknown> | null {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) { problems.push(`${at}: not an object`); return null; }
  const o = e as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(WAIVER_KEYS as readonly string[]).includes(k)) problems.push(`${at}: unknown key \`${k}\``);
  for (const k of WAIVER_KEYS) if (!(k in o)) problems.push(`${at}: missing \`${k}\``);
  if (typeof o['file'] !== 'string' || !files.includes(o['file'])) problems.push(`${at}: file must be one of the listed files`);
  if (!Number.isInteger(o['maxDelta']) || (o['maxDelta'] as number) <= GROWTH_LIMIT) {
    problems.push(`${at}: maxDelta must be an integer above ${GROWTH_LIMIT}`);
  }
  if (typeof o['d'] !== 'string' || !/^D-[1-9]\d*$/.test(o['d'])) problems.push(`${at}: d must be a D-number, D-<n>`);
  if (typeof o['reason'] !== 'string' || typeof o['added'] !== 'string') {
    problems.push(`${at}: reason and added must be strings`);
  } else {
    problems.push(...malformedEntries({ [at]: { reason: o['reason'], since: o['added'] } }, today));
  }
  return o;
}

/** The waiver directory, repo-relative: one JSON file per waiver, `<D-number>-<slug>.json`, so two PRs that each add a
 *  waiver touch two files and never the same lines. */
export const GROWTH_WAIVERS_DIR = 'server/test/growth-waivers';

/** The waiver directory's files as the ledger: each file holds ONE waiver object (the keys of `GrowthWaiver`), named
 *  `<its D-number>-<slug>.json`. Any problem in any file (the name, the JSON, a wrong shape, a second waiver for one
 *  file and D-number) is named with the file, and then no entry is answered: a malformed ledger waives nothing. */
export function parseWaiverFiles(items: readonly { name: string; text: string }[], files: readonly string[],
  today: Date = new Date()): { entries: GrowthWaiver[]; problems: string[] } {
  const problems: string[] = [];
  const entries: GrowthWaiver[] = [];
  const seen = new Set<string>();
  for (const { name, text } of [...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const at = name;
    if (!/^D-[1-9]\d*-[a-z0-9][a-z0-9-]*\.json$/.test(name)) { problems.push(`${at}: the name must be <D-number>-<slug>.json`); continue; }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      problems.push(`${at}: not JSON: ${(e as Error).message}`);
      continue;
    }
    const o = checkWaiverEntry(raw, at, files, today, problems);
    if (o === null) continue;
    if (typeof o['d'] === 'string' && !name.startsWith(`${o['d']}-`)) problems.push(`${at}: the name must start with its d, ${o['d']}`);
    const key = `${String(o['file'])} and ${String(o['d'])}`;
    if (seen.has(key)) problems.push(`${at}: a second waiver for ${key}`);
    seen.add(key);
    entries.push(raw as GrowthWaiver);
  }
  return problems.length ? { entries: [], problems } : { entries, problems };
}

/** The entries of `head` whose file and D-number `base` does not hold: the ones
 *  the diff adds. An entry on the base, raised or not, is never added. */
export function waiversAdded(base: readonly GrowthWaiver[], head: readonly GrowthWaiver[]): GrowthWaiver[] {
  return head.filter((h) => !base.some((b) => b.file === h.file && b.d === h.d));
}

/** The single-file ledger the directory replaced (D-6925): a merge-base from before the migration still holds it.
 *  Delete this, `parseLegacyWaivers` and its fallback in `waiversAt` once the merge queue has drained. */
export const GROWTH_WAIVERS_LEGACY_FILE = 'server/test/growth-waivers.json';

/** The legacy `{payer, waivers: [...]}` ledger's `waivers` array as the base entries, so a PR whose merge-base predates
 *  the directory does not count every migrated waiver as newly added. Delete once the queue has drained (D-6925). */
export function parseLegacyWaivers(text: string, files: readonly string[], today: Date = new Date()):
  { entries: GrowthWaiver[]; problems: string[] } {
  const at = GROWTH_WAIVERS_LEGACY_FILE;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { entries: [], problems: [`${at}: not JSON: ${(e as Error).message}`] };
  }
  const list = (raw as { waivers?: unknown } | null)?.waivers;
  if (!Array.isArray(list)) return { entries: [], problems: [`${at}: no \`waivers\` array`] };
  const problems: string[] = [];
  for (const [i, e] of list.entries()) checkWaiverEntry(e, `${at}#${i}`, files, today, problems);
  return problems.length ? { entries: [], problems } : { entries: list as GrowthWaiver[], problems };
}

/** The waiver directory's ledger at `sha`: absent there, it is the legacy single file when that sha holds one, else
 *  nothing; a file in it that is not a `.json` waiver
 *  is a problem, as is any malformed one (and then nothing is answered). */
export function waiversAt(files: readonly string[], sha: string, cwd: string, today: Date = new Date()):
  { entries: GrowthWaiver[]; problems: string[] } {
  let listing = '';
  try {
    listing = gitRead(['ls-tree', '--name-only', '-r', sha, '--', `${GROWTH_WAIVERS_DIR}/`], cwd);
  } catch { /* no such directory at this sha */ }
  const names = listing.split('\n').filter((l) => l !== '').map((l) => l.slice(GROWTH_WAIVERS_DIR.length + 1));
  if (names.length === 0) {
    const legacy = fileAt(GROWTH_WAIVERS_LEGACY_FILE, sha, cwd);
    if (legacy !== null) return parseLegacyWaivers(legacy, files, today);
  }
  const items = names.map((name) => ({ name, text: fileAt(`${GROWTH_WAIVERS_DIR}/${name}`, sha, cwd) ?? '' }));
  return parseWaiverFiles(items, files, today);
}

/** The ledger entries the diff `baseSha..headSha` adds: the waiver files the diff adds. Absent at a sha, the
 *  ledger holds nothing there; malformed at either, nothing is added and the problems say which side. */
export function waiversInDiff(files: readonly string[], baseSha: string, headSha: string, cwd: string,
  today: Date = new Date()): { added: GrowthWaiver[]; problems: string[] } {
  const base = waiversAt(files, baseSha, cwd, today);
  const head = waiversAt(files, headSha, cwd, today);
  const problems = [...base.problems.map((p) => `base: ${p}`), ...head.problems.map((p) => `head: ${p}`)];
  return { added: problems.length ? [] : waiversAdded(base.entries, head.entries), problems };
}

/** The added entry that best covers one over file: the largest `maxDelta` for it. */
export interface WaiverMatch { file: string; entry: GrowthWaiver; applies: boolean }
function matchWaiver(row: GrowthRow, added: readonly GrowthWaiver[]): WaiverMatch | undefined {
  const mine = added.filter((w) => w.file === row.file);
  if (!mine.length) return undefined;
  const entry = mine.reduce((a, b) => (b.maxDelta > a.maxDelta ? b : a));
  return { file: row.file, entry, applies: row.delta <= entry.maxDelta };
}

const waiverNote = (w: WaiverMatch): string => (w.applies
  ? `waived: ${w.entry.d}, max ${w.entry.maxDelta}`
  : `over its ledger max of ${w.entry.maxDelta} under ${w.entry.d}`);

/** For each file in `over`, the entry naming it for PR `pr`, and whether it
 *  applies: the measured delta is at or below the entry's cap, and the measured
 *  diff touched none of `GROWTH_MACHINERY` (`touched` names what it did touch).
 *  No PR number, no match. */
export interface ExemptionMatch { file: string; entry: GrowthExemption; applies: boolean; touched: readonly string[] }
export function matchExemptions(over: readonly string[], rows: readonly GrowthRow[],
  entries: readonly GrowthExemption[], pr: number | null, touched: readonly string[] = []): ExemptionMatch[] {
  if (pr === null) return [];
  const out: ExemptionMatch[] = [];
  for (const file of over) {
    const entry = entries.find((e) => e.pr === pr && e.file === file);
    const row = rows.find((r) => r.file === file);
    if (entry === undefined || row === undefined) continue;
    out.push({ file, entry, applies: row.delta <= entry.cap && touched.length === 0, touched });
  }
  return out;
}

/** Why an entry that names a file does not apply. */
const notExempt = (m: ExemptionMatch): string => (m.touched.length
  ? `not exempt: the diff for PR #${m.entry.pr} edits the growth check's own ${m.touched.join(', ')}`
  : `over its exemption cap of ${m.entry.cap} for PR #${m.entry.pr}`);

/** One listed file's verdict: its row's title, whether the row fails, and why. */
export interface GrowthVerdict {
  file: string; over: boolean; exemption: ExemptionMatch | undefined; waiver: WaiverMatch | undefined;
  fails: boolean; title: string; why: string;
}

/** The armed decision, pure: a row fails when its file grew over the limit,
 *  unwaived, and neither an exemption nor a ledger entry the diff adds
 *  (`waivers`, D-6223) applies to it. */
export function growthVerdicts(rows: readonly GrowthRow[], over: readonly string[],
  entries: readonly GrowthExemption[], pr: number | null, touched: readonly string[],
  waivers: readonly GrowthWaiver[] = []): GrowthVerdict[] {
  const matches = matchExemptions(over, rows, entries, pr, touched);
  return rows.map((r) => {
    const isOver = over.includes(r.file);
    const m = matches.find((x) => x.file === r.file);
    const w = isOver ? matchWaiver(r, waivers) : undefined;
    const notes = [
      ...(m === undefined ? [] : [m.applies ? `exempt: PR #${m.entry.pr}, cap ${m.entry.cap}` : notExempt(m)]),
      ...(w === undefined ? [] : [waiverNote(w)]),
    ];
    const reason = w !== undefined && !w.applies ? waiverNote(w)
      : m === undefined ? `over the limit of ${GROWTH_LIMIT}` : notExempt(m);
    return {
      file: r.file,
      over: isOver,
      exemption: m,
      waiver: w,
      fails: isOver && m?.applies !== true && w?.applies !== true,
      title: `${r.file}: delta ${signed(r.delta)}${isOver ? ` (GROWTH_OVER${notes.map((n) => `, ${n}`).join('')})` : ''}`,
      why: `${r.file} grew by ${r.delta} net code lines, ${reason}`,
    };
  });
}

/** The armed rows' whole read and decision between `base` and `head` in
 *  `root`: each file's growth, the two waivers, origin/main's exemption list,
 *  the PR number, the growth check's own files the measured diff touches, the
 *  ledger entries the diff adds (D-6223), and the verdict per file. */
export function armedGrowth(files: readonly string[], root: string, base: string, head: string,
  env: NodeJS.ProcessEnv, today: Date = new Date()) {
  const rows = files.map((f) => netGrowth(f, base, head, root));
  const over = growthOver(rows, addedFiles(base, head, root));
  const pr = prNumberFromEnv(env);
  const onMain = exemptionsOnMain(files, root, today);
  const touched = changedFiles(base, head, root).filter((p) => GROWTH_MACHINERY.includes(p));
  const ledger = waiversInDiff(files, base, head, root, today);
  const verdicts = growthVerdicts(rows, over, onMain.entries, pr, touched, ledger.added);
  const exemptions = verdicts.flatMap((v) => (v.exemption === undefined ? [] : [v.exemption]));
  const waivers = verdicts.flatMap((v) => (v.waiver === undefined ? [] : [v.waiver]));
  return { rows, over, pr, onMain, touched, ledger, verdicts, exemptions, waivers };
}

/** `GROWTH_OVER`'s list: every file that grew over the limit, an exempted one
 *  annotated with its PR, cap and ruling, and one whose entry does not apply
 *  said why: past its cap, or the measured diff edits the growth check's own files. */
export function overLine(over: readonly string[], exemptions: readonly ExemptionMatch[] = [],
  quote: (f: string) => string = (f) => f, waivers: readonly WaiverMatch[] = []): string {
  if (!over.length) return '(none)';
  return over.map((f) => {
    const m = exemptions.find((x) => x.file === f);
    const w = waivers.find((x) => x.file === f);
    const notes = [
      ...(m === undefined ? [] : [m.applies ? `exempt: PR #${m.entry.pr}, cap ${m.entry.cap}, ruling: ${m.entry.ruling}` : notExempt(m)]),
      ...(w === undefined ? [] : [`${waiverNote(w)}, ledger entry added ${w.entry.added}`]),
    ];
    return notes.length ? `${quote(f)} (${notes.join('; ')})` : quote(f);
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
  waivers?: readonly WaiverMatch[];
}

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
    `GROWTH_OVER: ${overLine(i.over, i.exemptions, (f) => `\`${f}\``, i.waivers)}`,
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
