// The tree scanners, as a full run SAW them (D-7455). A server test that lists a source tree itself (a ratchet, a
// census, a "nowhere else in server/src" rule) reads every file under it as text, so vitest's import graph relates it
// to no change, and a red there first shows in the merge queue. Finding those tests from their source by shape kept
// missing shapes, so the full run records them instead.
//
// How: in a full-suite run (ci.yml's server shards when `tests == full`, the same runs that keep `times-<shard>`),
// vitest.select.config.ts adds server/test/tree-scans.setup.mjs to the setup files when `CCRC_TREE_SCANS_OUT` names a
// file. That setup file wraps fs's directory listers — readdirSync / readdir / opendirSync / opendir / globSync / glob
// and the fs/promises readdir / opendir / glob — once per worker, and records, per test file, the source roots it
// listed: a listed path that resolves at or under the repository's server/src, shared, pwa/src, agent/src or ccd
// (`rootOf`), never one in the temp tree, where every fixture lives. Each test file that listed one appends a line
// `{ "file": "server/test/x.test.ts", "roots": ["ccd"] }` to that file. times-build merges every shard's lines
// (`node .github/ci/tree-scanners.mjs merge --out FILE <scans.jsonl>...`) into tree-scanners.json — `{ file: roots }`
// — and publishes it as the `tree-scanners` artifact next to `testtimes`; fast-plan.mjs fetches the newest trusted one
// the way it fetches `testtimes` (main-artifact.mjs) and reads it with `readTreeScanners`.
//
// What it cannot see: a listing made in a child process the test spawned (a script it runs), a listing through a
// module a test mocked, and a listing of an ANCESTOR of the roots — the repository root, `server/`, a `readdirSync(REPO, { recursive: true })` or a `glob('**/*.ts', { cwd: REPO })` that walks into them — is matched against the path listed, which sits above every root, so it is not recorded (a root's own path, or one under it, is
// what `rootOf` matches; recording every ancestor listing would record every test that lists the repository for
// any reason). fast-plan.mjs therefore takes the UNION of this record and its static detector, never the record
// alone. The wrapping costs one path check per lister call.
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The source roots a scan is recorded for, repository-relative. */
export const SOURCE_ROOTS = ['server/src', 'shared', 'pwa/src', 'agent/src', 'ccd'];

/** The fs listers that are wrapped; the first argument is the listed path (glob: the pattern, under `cwd`). */
export const FS_LISTERS = ['readdirSync', 'readdir', 'opendirSync', 'opendir', 'globSync', 'glob'];
export const FSP_LISTERS = ['readdir', 'opendir', 'glob'];

const both = (p) => {
  const out = new Set([path.resolve(p)]);
  try { out.add(realpathSync(p)); } catch { /* a path that does not exist is matched as written */ }
  return [...out];
};
const under = (p, dir) => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/**
 * A matcher for one repository: `(listed) => root | null`, the source root (one of SOURCE_ROOTS) a listed path sits
 * at or under, or null. A path in the temp tree is never a root (a fixture's `ccd/` is not the tree), unless the
 * repository itself sits in the temp tree, when only the repository's own roots count. A relative path resolves
 * against `base` (the process's working directory, as fs resolves it, unless a caller names another).
 * @param {string} repo the repository's root @param {string} [tmp] the temp root @param {string} [base]
 * @returns {(listed: unknown, cwd?: string) => string | null}
 */
export function rootOf(repo, tmp = os.tmpdir(), base = undefined) {
  const roots = both(repo).flatMap((b) => SOURCE_ROOTS.map((r) => /** @type {[string, string]} */ ([path.join(b, ...r.split('/')), r])));
  const repos = both(repo);
  const tmps = both(tmp).filter((t) => !repos.some((r) => under(r, t)));
  return (listed, cwd) => {
    let p = listed;
    if (p instanceof URL) p = p.protocol === 'file:' ? fileURLToPath(p) : null;
    else if (Buffer.isBuffer(p)) p = p.toString();
    if (typeof p !== 'string' || p === '') return null;
    const abs = path.resolve(base ?? process.cwd(), cwd ?? '.', p);
    if (tmps.some((t) => under(abs, t))) return null;
    for (const [dir, name] of roots) if (under(abs, dir)) return name;
    return null;
  };
}

/** The directory a glob pattern lists: its leading segments up to the first one with a glob character. */
export function globBase(pattern) {
  const segs = String(pattern).split('/');
  const keep = [];
  for (const s of segs) {
    if (/[*?[\]{}()!+@]/.test(s)) break;
    keep.push(s);
  }
  return keep.length === 0 ? '.' : keep.join('/') || '/';
}

/** The paths one lister call lists, from its arguments. */
function listedBy(name, args) {
  if (name !== 'globSync' && name !== 'glob') return [[args[0], undefined]];
  const opts = typeof args[1] === 'object' && args[1] !== null ? args[1] : {};
  const cwd = opts.cwd instanceof URL ? fileURLToPath(opts.cwd) : typeof opts.cwd === 'string' ? opts.cwd : undefined;
  return (Array.isArray(args[0]) ? args[0] : [args[0]]).map((p) => [globBase(p), cwd]);
}

/**
 * Wraps the listers of `fs` (and `fs.promises`) so each call reports what it lists to `onList(path, cwd)` before it
 * runs; the call itself, its result and its errors are unchanged. Wrappers layer: wrapping a wrapped lister reports to
 * both (a test of the capture running under the full run's own capture records too), and each restore puts back what
 * it replaced. The setup file wraps once per worker (its own state guards that). Returns the restore. ESM named imports of `node:fs` see the change only after
 * `module.syncBuiltinESMExports()`; the setup file and the tests call it.
 * @param {typeof import('node:fs')} fs @param {(listed: unknown, cwd: string | undefined) => void} onList
 * @returns {() => void}
 */
export function wrapListers(fs, onList) {
  /** @type {Array<[Record<string, unknown>, string, Function]>} */
  const orig = [];
  const wrap = (obj, name) => {
    const f = obj?.[name];
    if (typeof f !== 'function') return;
    const w = function (...args) {
      try { for (const [p, cwd] of listedBy(name, args)) onList(p, cwd); } catch { /* recording never breaks a listing */ }
      return f.apply(this, args);
    };
    Object.defineProperty(w, 'name', { value: f.name });
    obj[name] = w;
    orig.push([obj, name, f]);
  };
  for (const n of FS_LISTERS) wrap(fs, n);
  for (const n of FSP_LISTERS) wrap(fs.promises, n);
  return () => { for (const [obj, name, f] of orig.reverse()) obj[name] = f; };
}

/** One shard's lines, `{ file, roots }` each; a malformed line is skipped. @param {string} text */
export function parseScanLines(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v.file === 'string' && Array.isArray(v.roots) && v.roots.every((r) => SOURCE_ROOTS.includes(r))) out.push(v);
    } catch { /* a torn line */ }
  }
  return out;
}

/** Every shard's lines merged into `{ file: roots }`, keys and roots sorted.
 *  @param {Array<{ file: string, roots: string[] }>} lines @returns {Record<string, string[]>} */
export function mergeScans(lines) {
  /** @type {Map<string, Set<string>>} */
  const by = new Map();
  for (const { file, roots } of lines) {
    if (roots.length === 0) continue;
    const s = by.get(file) ?? new Set();
    for (const r of roots) s.add(r);
    by.set(file, s);
  }
  return Object.fromEntries([...by.keys()].sort().map((f) => [f, [...(by.get(f) ?? [])].sort()]));
}

/**
 * The published tree-scanners.json, or null when it is missing or not that shape (fast-plan.mjs then falls back to
 * the static detector). @param {string | undefined | null} file @returns {Record<string, string[]> | null}
 */
export function readTreeScanners(file) {
  if (!file) return null;
  let v;
  try { v = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  for (const [f, roots] of Object.entries(v)) {
    if (!f.startsWith('server/') || !Array.isArray(roots) || !roots.every((r) => SOURCE_ROOTS.includes(r))) return null;
  }
  return /** @type {Record<string, string[]>} */ (v);
}

/** Appends one test file's line (the setup file's write; small enough for one atomic append). */
export function appendScan(out, file, roots) {
  mkdirSync(path.dirname(out), { recursive: true });
  appendFileSync(out, JSON.stringify({ file, roots: [...roots].sort() }) + '\n');
}

function main(argv) {
  if (argv[0] !== 'merge') throw new Error('usage: node tree-scanners.mjs merge --out FILE <scans.jsonl>...');
  const oi = argv.indexOf('--out');
  const out = oi === -1 ? undefined : argv[oi + 1];
  const reports = argv.slice(1).filter((_, i, a) => a[i] !== '--out' && a[i - 1] !== '--out');
  if (!out || reports.length === 0) throw new Error('usage: node tree-scanners.mjs merge --out FILE <scans.jsonl>...');
  const merged = mergeScans(reports.flatMap((f) => parseScanLines(readFileSync(f, 'utf8'))));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(merged, null, 2) + '\n');
  console.log(`tree-scanners: ${Object.keys(merged).length} scanner file(s) from ${reports.length} report(s)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(process.argv.slice(2)); } catch (e) {
    process.stderr.write(`tree-scanners.mjs: ${e instanceof Error ? e.message : e}\n`);
    process.exitCode = 2;
  }
}
