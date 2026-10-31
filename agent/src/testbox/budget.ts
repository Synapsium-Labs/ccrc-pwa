// D-7410, D-7421 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB8; spec §2.5 "The budget"). L1, pure: the
// wrapper's estimate of a command's time on the box, which `client.ts` compares with `CCRC_TESTBOX_BUDGET`. The caller
// reads the durations file (`CCRC_TESTBOX_TIMES`, D-7421: the CI `testtimes` artifact a daily fleet-host timer writes)
// and the package's test files; this file only decides.
//
// THE ESTIMATE. A vitest run's named test files, each at its duration in the file, a file the file does not know at the
// median of the package's known files; a wide run (no file named, a directory, a glob or a name filter) at every
// duration the package has plus each test file on disk the durations do not name at the median, or, with no
// durations, at the package's test files on disk. The sum is divided by the run's worker count: the session's own
// `--maxWorkers=<n>` or `VITEST_MAX_WORKERS`, else one, since the box's count is a box setting the fleet host cannot
// read (D-7558). A whole suite through the package manager (`npm test`, `npm run test…`) is a wide run. Any other
// command (a typecheck) names no test file and estimates zero: the budget is about test file sets (spec §2.5).
//
// NO DURATIONS. With no durations file, one that does not parse, or one that names no file of the run's package,
// every file counts at `DEFAULT_FILE_SECONDS`, the per-file default spec §2.5 and D-7421 give the repository row. The
// row (`shared/testbox.ts#TestboxRepoRow`) has no such field and the fleet host holds no row, so the default is
// spelled here, once (D-7558), and the summary says `estimate: no durations (<why>)`.
//
// THE DURATIONS FILE. `.github/ci/shards.mjs times` writes `{ "<repo-relative path>": <ms>, … }`. A file of
// several repositories nests that map under each repository's name (`{ "<repository>": { … } }`); both are read.

/** The per-file default, in seconds, when there are no durations (D-7421, D-7558). Neutral: CI's full server suite,
 *  about 16,000 file-seconds over about 1,100 files (spec §1.1), rounded up. */
export const DEFAULT_FILE_SECONDS = 15;

/** Milliseconds in a second. */
const SECOND_MS = 1000;

export type Durations = ReadonlyMap<string, number>;

export type DurationsRead = { readonly ok: true; readonly durations: Durations } | { readonly ok: false; readonly why: string };

const isMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** The durations file's text (or `null` with why it could not be read) to its map for `repository`. */
export function readDurations(text: string | null, why: string, repository: string): DurationsRead {
  if (text === null) return { ok: false, why };
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return { ok: false, why: 'the durations file is not JSON' }; }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { ok: false, why: 'the durations file is not an object' };
  let map = doc as Record<string, unknown>;
  const nested = map[repository];
  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) map = nested as Record<string, unknown>;
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(map)) if (isMs(v)) out.set(k, v);
  if (out.size === 0) return { ok: false, why: `the durations file names no file of ${repository}` };
  return { ok: true, durations: out };
}

/** The vitest and jest flags that take the next word as their value: ccd/ccrc-test's `_tvalflag`, the same list, pinned
 *  to it by server/test/testbox-wrapper.test.ts's parity row (a flag added to one side only reds it). */
export const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-c', '--config', '-r', '--root', '--dir', '--project', '--reporter', '--reporters', '--outputFile', '--environment', '--env',
  '--testNamePattern', '--testPathPattern', '--testPathIgnorePatterns', '--shard', '--pool', '--maxWorkers', '--minWorkers',
  '--exclude', '--mode', '--selectProjects', '--rootDir', '--testRegex', '--testTimeout', '--workspace',
  // `-t` stays last with no comma after it: server/test/ccd-tmux-anchor.test.ts's census reads a quoted `-t` followed
  // by a comma and another word as a tmux `-t` target.
  '-t']);
/** The vitest subcommands the wrapper's argv reading skips as the first word (ccd/ccrc-test's `_targv_heavy`), pinned
 *  the same way. */
export const SUBCOMMANDS: ReadonlySet<string> = new Set(['run', 'watch', 'dev', 'related', 'bench']);
const TEST_FILE = /\.(test|spec)\.[^/]+$/;
const GLOB = /[*?[]/;

/** What a command's argv asks to run: the named test files, a wide run, or no test file set at all. */
export type FileSet = { readonly t: 'files'; readonly files: readonly string[] } | { readonly t: 'wide' } | { readonly t: 'none' };

const base = (w: string): string => (w.split('/').pop() ?? '').replace(/\.(m|c)?js$/, '');

/** The file set of a command (paths as the argv names them, relative to the package directory). */
export function fileSet(argv: readonly string[]): FileSet {
  const head = base(argv[0] ?? '');
  if (head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun') {
    const sub = argv.slice(1).filter((w) => !w.startsWith('-'));
    if (sub[0] === 'test' || sub[0] === 't' || (sub[0] === 'run' && /^(t|test.*)$/.test(sub[1] ?? ''))) return { t: 'wide' };
    return { t: 'none' };
  }
  if (head !== 'vitest' && head !== 'jest') return { t: 'none' };
  const files: string[] = [];
  let wide = false;
  let first = true;
  for (let i = 1; i < argv.length; i++) {
    const w = argv[i]!;
    if (w === '--' || /^--[^=]+=/.test(w)) continue;
    if (w.startsWith('-')) { if (VALUE_FLAGS.has(w)) i++; continue; }
    if (first) { first = false; if (SUBCOMMANDS.has(w)) continue; }
    if (GLOB.test(w) || !TEST_FILE.test(w)) wide = true;
    else files.push(w);
  }
  return wide || files.length === 0 ? { t: 'wide' } : { t: 'files', files };
}

/** The run's worker count, for the division: the session's own numeric `--maxWorkers`, else `VITEST_MAX_WORKERS`, else
 *  one (D-7558). */
export function workerCount(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): number {
  let n: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i]!;
    const v = w.startsWith('--maxWorkers=') ? w.slice('--maxWorkers='.length) : w === '--maxWorkers' ? (argv[i + 1] ?? '') : null;
    if (v !== null && /^[1-9][0-9]*$/.test(v)) n = n === null ? Number(v) : Math.min(n, Number(v));
  }
  if (n !== null) return n;
  const e = env['VITEST_MAX_WORKERS'] ?? '';
  return /^[1-9][0-9]*$/.test(e) ? Number(e) : 1;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** One normalised repo-relative path: `<package>/<file>`, `./` and repeated slashes dropped. */
const repoPath = (pkg: string, file: string): string =>
  [pkg, ...file.split('/')].filter((seg) => seg !== '' && seg !== '.').join('/');

export interface EstimateInput {
  readonly argv: readonly string[];
  /** The package directory's name under the repository root (`server`). */
  readonly pkg: string;
  readonly durations: DurationsRead;
  readonly workers: number;
  /** The package's test files on disk, repo-relative; read only for a wide run. */
  readonly packageTestFiles: () => readonly string[];
}

export interface Estimate {
  /** The estimated time on the box, in milliseconds. */
  readonly ms: number;
  readonly files: number;
  /** `estimate: no durations (<why>)`, or `null` when the durations were read. */
  readonly note: string | null;
}

/** The estimate of one command (see the header). */
export function estimate(i: EstimateInput): Estimate {
  const set = fileSet(i.argv);
  const prefix = `${i.pkg}/`;
  const d = i.durations.ok ? i.durations.durations : null;
  const known = d === null ? [] : [...d].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
  // A durations file that names no file of this package is no durations for it (spec §2.5): every file at the default.
  const why = !i.durations.ok ? i.durations.why : known.length === 0 ? `the durations file names no file of ${i.pkg}` : null;
  const note = why === null ? null : `estimate: no durations (${why})`;
  if (set.t === 'none') return { ms: 0, files: 0, note };
  const fallbackMs = DEFAULT_FILE_SECONDS * SECOND_MS;
  let costs: number[];
  if (d !== null && known.length > 0) {
    const mid = median(known);
    // A wide run: every duration the package has, and each test file on disk the durations do not name at the median.
    costs = set.t === 'wide'
      ? [...known, ...i.packageTestFiles().filter((f) => !d.has(f)).map(() => mid)]
      : set.files.map((f) => d.get(repoPath(i.pkg, f)) ?? mid);
  } else {
    const n = set.t === 'wide' ? i.packageTestFiles().length : set.files.length;
    costs = Array.from({ length: n }, () => fallbackMs);
  }
  const total = costs.reduce((a, b) => a + b, 0);
  return { ms: Math.ceil(total / Math.max(1, i.workers)), files: costs.length, note };
}

/** `<m> min <s> s`, the estimate as the reason prints it. */
export function minutes(ms: number): string {
  const s = Math.ceil(ms / SECOND_MS);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}
