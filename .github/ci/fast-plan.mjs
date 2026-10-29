// The server tests a FAST pull request runs (operator ruling 2026-10-28). An ordinary pull request
// (reach.mjs `fastRun`) runs only the fast checks; for the server suite that is the union of:
//   1. the tests vitest relates to the change: `vitest list --filesOnly --changed <merge base> --json`, run by the
//      `fast-plan` job in server/ and handed here as a file. vitest follows imports from the merge base, and reruns
//      every test when one of its own rerun triggers (a manifest, a vitest config) changed;
//   2. the map's selection for every changed path vitest cannot follow (select-tests.mjs `vitestFollows`: a ccd
//      script, Python, a JSON or SQL fixture, another package's file a server test reads as text). select computes
//      it from the same map it selects from and hands it over as its `untraced` output; `full` there (no usable map,
//      or a path the map cannot bound) makes this plan fall back to select's own selection;
//   3. the guard suites, whatever changed: they scan the whole tree or the diff rather than import what they check,
//      so vitest can never relate them to a change. `guardTests` derives them: the GUARD_TESTS patterns (the
//      censuses, single-definition, deviation-refs, growth-check, ownership, the rings, ccd-contexts, dtbd, the
//      tests-inclusive typecheck, the oss metadata, the pin suites of TypeScript code) and every test whose source
//      lists the tracked tree or reads the diff itself (TREE_READER: a direct `git ls-files`, `git diff` or
//      `git merge-base`, the shape of topology-clean, gitignore-secrets and consolidation-path-guard), and every test
//      that lists a source tree itself (a ratchet, a census, a "nowhere else in server/src" rule) whose file measured
//      at most SCANNER_MAX_MS on the last full run. Which tests those are, the last full run RECORDED (the
//      `tree-scanners` artifact, tree-scanners.mjs); without a readable artifact, the static detector
//      `scansSourceTree` stands in;
//   4. the session-hook suites when ccd/ccd, ccd/session-hook.sh or shared/api.ts changed (SESSION_HOOK_TRIGGERS):
//      the hook is bash, so no import reaches it.
// What this leaves out — a test the map has no entry for or does not trust, a TypeScript file a test reads as text
// without importing it — the merge queue's full run catches before anything lands; the builder ran the scoped
// tests before pushing.
//
// The plan is packed by measured duration (shards.mjs planShards, PROFILES.linuxFast) from the durations the daily
// run publishes. Every failure — an unreadable vitest list, an `untraced` of `full`, a path no list can carry —
// answers the FALLBACK the caller passes (select's own matrix and count): never "nothing", and never a green over
// tests that did not run. Like select.mjs, this is a CLI that writes $GITHUB_OUTPUT and $GITHUB_STEP_SUMMARY; the
// rules are pure exports.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { liveTestFiles, unsafeTestPaths } from './select-tests.mjs';
import { readTreeScanners } from './tree-scanners.mjs';
import { planShards, toMatrix, PROFILES } from './shards.mjs';

/** Repo-relative patterns of the server suites that read the whole tree, so they run on every fast pull request. */
export const GUARD_TESTS = [
  /^server\/test\/census-w[^/]*\/.+\.test\.ts$/,
  /^server\/test\/[^/]*census[^/]*\.test\.ts$/,
  /^server\/test\/single-definition\/.+\.test\.ts$/,
  /^server\/test\/deviation-refs\.test\.ts$/,
  /^server\/test\/growth-check\.test\.ts$/,
  /^server\/test\/ownership\.test\.ts$/,
  /^server\/test\/rings\/.+\.test\.ts$/,
  /^server\/test\/[^/]*-rings\.test\.ts$/,
  /^server\/test\/ccd-contexts\.test\.ts$/,
  /^server\/test\/dtbd\.test\.ts$/,
  /^server\/test\/typecheck-tests\.test\.ts$/,
  // Reads the workflows, the README and the package metadata by name (no import, no listing).
  /^server\/test\/oss-metadata\.test\.ts$/,
  // The pin suites: a pin reads its subject's source as text as often as it imports it. PIN_MAP_CARRIED leaves out
  // the ones whose subject is a script.
  /^server\/test\/[^/]*-pin\.test\.ts$/,
];

/** The pin suites whose subject is a ccd script (bash, spawned in a fixture): the map selects them for a change to
 *  that script (part 2 above), so they are not guards. Each is ~5-110 s; ccd-child-reclaim-pin alone is 108 s. */
export const PIN_MAP_CARRIED = [
  'server/test/account-markers-pin.test.ts',
  'server/test/ccd-child-reclaim-pin.test.ts',
  'server/test/ccd-helpers-pin.test.ts',
  'server/test/ccd-swap-pin.test.ts',
];

/** A test that lists the tracked tree or reads the diff ITSELF — a direct `git ls-files`, `git diff` or
 *  `git merge-base` call (execFileSync / spawnSync / execSync and friends), not one through a fixture helper such
 *  as `h.git(...)`. Such a test checks whatever the change touched, so vitest can never relate it. */
export const TREE_READER = /\b(?:execFileSync|spawnSync|execSync|execFile|spawn)\(\s*['"`]git(?:['"`]\s*,\s*\[[^\]]*?['"`]|\s+(?:-C\s+\S+\s+)?)(?:ls-files|merge-base|diff)\b/;

// ── The tree scanners (D-7455) ──────────────────────────────────────────────────────────────────────────────────────
// A test that LISTS a source tree itself (a ratchet, a census, a single-definition or ring rule, a "nowhere else in
// server/src" check) reads every file under it as text, so vitest relates it to no change, and a red there first
// shows in the merge queue. The full run RECORDS them (tree-scanners.mjs: a setup file wraps fs's listers), and the
// plan reads that record. The static detector below is the FALLBACK, used only when no `tree-scanners` artifact is
// readable; it is kept as it is, with no further shapes. `scansSourceTree` finds them from the source, by shape:
//   - a source root spelled as a literal: `'server/src'`, `'pwa/src'`, `'agent/src'`, `'shared'`, `'ccd'`, or the
//     segments `'server', 'src'` / `serverRoot, 'src'` / `'..', 'src'` (from server/test, server/src) — the directory itself, never a
//     file or subdirectory under it, never one joined onto a base that does not name the repository (a fixture's
//     `join(home, 'ccd')` is not the tree) or after another literal segment (`join(h, 'older-tree', 'ccd')`); a
//     leading `../` is allowed (`'../../pwa/src'`), and an array of roots is roots (`['deploy', 'ccd']`);
//   - a name bound to one: a `const` whose value spells a root (for the rest of its block), a name declared first and
//     assigned one later (a `beforeAll`; for its declaration's block), an alias of one (a default parameter
//     `dir = srcRoot`), `path.dirname(<a file directly in a root>)` (a helper's `CCD`, `ccd/ccd`), a package dir with
//     `'src'` joined on (`path.join(root, 'src')`, `root` the server package), and a loop or an array callback over
//     such a value (for its body);
//   - a LISTER: readdirSync / readdir / opendirSync / globSync / glob, or a function the module defines or imports
//     from a helper under server/test that calls a lister (the repo's walkers: `walk`, `sourceFiles`, `walkSrc`…),
//     however it is reached: `fs.readdirSync(`, `fsp.readdir(`, `io.readdir(`, `fs.promises.readdir(`, `[...walk(`;
//   - a SCANNER: a lister called on a root, or a function that calls a scanner (`sitesOf(REPO, ['server/src'], …)`,
//     the census helpers' `ccdCallGraph()`).
// A test file scans when its own code calls a scanner. Comments are blanked first. ci-fast-plan.test.ts's SELF-CHECK
// holds the capture to the fallback: every static positive fixture there, run under the capture, is recorded.

const ROOT_DIRS = String.raw`(?:server\/src|pwa\/src|agent\/src|shared|ccd)\/?`;
const Q = '[\'"`]';
/** A source root spelled as a literal; another segment may follow only when it is a root too. */
export const SOURCE_ROOT = new RegExp(String.raw`(?:${Q}(?:\.\.\/)*${ROOT_DIRS}${Q}|${Q}(?:server|pwa|agent|\.\.)${Q}\s*,\s*${Q}src${Q}|\b(?:server|pwa|agent)[\w$]*\s*,\s*${Q}src${Q}|${Q}\.\.\/src\/?${Q})(?!\s*,\s*${Q}(?!${ROOT_DIRS}${Q}))`, 'g');
/** A base a root may be joined onto: one that names the repository or the test's own directory. */
const REPO_BASE = /repo|root|here|dirname|import\.meta/i;
const FS_LISTERS = ['readdirSync', 'readdir', 'opendirSync', 'globSync', 'glob'];
const IDENT = '[A-Za-z_$][\\w$]*';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does `text` spell a source root (not one joined onto a non-repository base, nor under another literal segment)? */
function spellsRoot(text) {
  for (const m of text.matchAll(SOURCE_ROOT)) {
    // The literal segments written before it in the same call: only `'..'` may sit between a base and a root
    // (`join(home, '.local', 'bin', 'ccd')` and `join(h, 'older-tree', 'ccd')` are a fixture's files, not the tree).
    // An array or another call's arguments (`['deploy', 'ccd']`) is a list of roots, not a path.
    const before = text.slice(0, m.index);
    const segs = /(?:['"`][^'"`\n]*['"`]\s*,\s*)*$/.exec(before)[0];
    const head = before.slice(0, before.length - segs.length);
    const inJoin = /(?:join|resolve)\(\s*(?:[^,()]+?\s*,\s*)?$/.test(head);
    if (inJoin && [...segs.matchAll(/['"`]([^'"`\n]*)['"`]/g)].some((x) => x[1] !== '..')) continue;
    const base = /(?:join|resolve)\(\s*([^,()]+?)\s*,\s*$/.exec(head);
    if (!base || REPO_BASE.test(base[1])) return true;
  }
  return false;
}

/** Comments blanked, newlines kept. One left-to-right pass, so whichever opens first wins: a `/*` inside a string
 *  (a `'**' + '/*.ts'` glob) is the string's, a `//` inside a string stays (server/test/sourceScan.ts's reading). */
const CODE_OR_COMMENT = /('(?:\\.|[^\\'\n])*'|"(?:\\.|[^\\"\n])*"|`(?:\\[\s\S]|[^\\`])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
export const blankComments = (s) => s.replace(CODE_OR_COMMENT, (m, str) => (str !== undefined ? m : m.replace(/[^\n]/g, ' ')));

const indentAt = (src, idx) => src.slice(src.lastIndexOf('\n', idx - 1) + 1).match(/^[ \t]*/)[0].length;
/** Where the code that starts at `idx` ends: the first later line indented less than it (`block`: the rest of the
 *  enclosing block), or no deeper and not a closing bracket (its own body). */
function regionEnd(src, idx, block) {
  const ind = indentAt(src, idx);
  for (let p = src.indexOf('\n', idx); p !== -1;) {
    const next = src.indexOf('\n', p + 1);
    const line = src.slice(p + 1, next === -1 ? undefined : next);
    const li = line.length - line.trimStart().length;
    if (line.trim() !== '' && (block ? li < ind : li <= ind && !/^\s*[}\])]/.test(line))) return p;
    p = next;
  }
  return src.length;
}

/** The functions a module defines (declarations and arrow consts), with the span of their bodies. */
function definedFunctions(src) {
  const re = new RegExp(`(?:function\\s+(${IDENT})\\s*\\(|(?:const|let)\\s+(${IDENT})\\s*(?::[^=\\n]{0,80})?=\\s*(?:async\\s+)?(?:\\([^)]*\\)|${IDENT})\\s*(?::[^=\\n]{0,80})?=>)`, 'g');
  return [...src.matchAll(re)].map((m) => ({ name: m[1] ?? m[2], start: m.index + m[0].length, end: regionEnd(src, m.index, false) }));
}

/** A name used as itself (`NAME`, `...NAME`), never a member of something else (`x.NAME`) or a piece of a string. */
const usedName = (name, tail = String.raw`(?![\w$'"\x60])`) => new RegExp(String.raw`(?<![\w$'"\x60])(?<!(?:^|[^.])\.)${esc(name)}${tail}`);
/** A package directory's value (`path.join(here, '..')` from server/test, `path.join(REPO, 'server')`): one that
 *  would spell a source root with `'src'` joined on. Its first line only, ending in the call's closing paren. */
function spellsPackageDir(value) {
  const v = value.split('\n')[0].trim().replace(/;$/, '').trim();
  return v.endsWith(')') && !spellsRoot(v) && spellsRoot(`${v.slice(0, -1)}, 'src')`);
}
/** A file directly in a source root (`path.resolve(__dirname, '../../ccd/ccd')`, `path.join(REPO, 'ccd', 'ccd')`):
 *  the value spells a root once its last segment is dropped. `path.dirname(<it>)` is that root. */
function spellsFileInRoot(value) {
  const v = value.split('\n')[0].trim().replace(/;$/, '').trim();
  const last = /,\s*(['"`])([^'"`\n]+)\1\s*\)$/.exec(v);
  if (!last || last[2] === '..' || spellsRoot(v)) return false;
  const cut = last[2].includes('/') ? `${last[1]}${last[2].slice(0, last[2].lastIndexOf('/'))}${last[1]}` : '';
  return spellsRoot(`${v.slice(0, last.index)}${cut === '' ? '' : `, ${cut}`})`);
}

/** `covers(text, at)`: does `text`, at offset `at`, spell a root or name a binding to one in scope there? A binding
 *  is a `const`/`let` whose value spells a root, a name assigned one after its declaration (`let SRC_DIR = ''` then
 *  `SRC_DIR = path.resolve(…, 'agent', 'src')` in a `beforeAll`: bound for the declaration's block), `<package dir
 *  binding>, 'src'` (`path.join(root, 'src')` where `root` is the server package), and a loop or array callback over
 *  one (for its body). */
function rootCover(src, importedFiles = new Set()) {
  /** @type {Array<{ name: string, start: number, end: number, pkg?: boolean }>} */
  const bound = [];
  /** Names bound to a file directly in a root (`CCD`, a helper's `ccd/ccd`), and where. */
  const files = [];
  const fileIn = (name, at) => importedFiles.has(name) || files.some((b) => b.name === name && inScope(b, at));
  const inScope = (b, at) => at >= b.start && at < b.end;
  const covers = (text, at) => spellsRoot(text) || bound.some((b) => inScope(b, at) && (b.pkg
    ? usedName(b.name, String.raw`\s*,\s*${Q}src${Q}(?!\s*,\s*${Q})`).test(text)
    : usedName(b.name).test(text)));
  const seen = new Set();
  const bind = (name, at, value, declared) => {
    if (seen.has(`${name}@${at}`)) return;
    // A later assignment is bound from its declaration when one comes before it, else from the assignment.
    const span = () => {
      const decls = declared ? [] : [...src.slice(0, at).matchAll(new RegExp(String.raw`\b(?:let|var)\s+${esc(name)}\b`, 'g'))];
      const from = decls.length > 0 ? decls[decls.length - 1].index : at;
      seen.add(`${name}@${at}`);
      return { name, start: from, end: regionEnd(src, from, true) };
    };
    if (spellsFileInRoot(value)) { files.push(span()); return; }
    const dir = new RegExp(String.raw`^\s*(?:path\.)?dirname\(\s*(${IDENT})\s*\)\s*(?:[),;]|$)`).exec(value);
    // An alias of a root binding (`dir = srcRoot`, a default parameter), never of a package one.
    const alias = new RegExp(String.raw`^\s*(${IDENT})\s*(?:[),;:]|$)`).exec(value);
    const root = spellsRoot(value);
    const pkg = !root && spellsPackageDir(value);
    if (!(pkg || root || (dir && fileIn(dir[1], at)) || (alias && alias[1] !== name && bound.some((b) => !b.pkg && b.name === alias[1] && inScope(b, at))))) return;
    bound.push({ ...span(), pkg });
  };
  const DECL = new RegExp(`\\b(?:const|let)\\s+(${IDENT})\\s*(?::[^=\\n]{0,80})?=\\s*([^;]{0,300})`, 'g');
  // A later assignment: `NAME = value`, not `==`/`=>`, not a member (`x.NAME =`) and not a declaration (seen above).
  const ASSIGN = new RegExp(String.raw`(?<![\w$.])(${IDENT})[ \t]*=(?![=>])[ \t]*(?=([^;\n]{0,300}))`, 'g'); // the value is looked at, not consumed: `f = (dir = SRC)`
  const assigns = [...src.matchAll(ASSIGN)].filter((m) => !/[\w$.][ \t]*$/.test(src.slice(Math.max(0, m.index - 24), m.index))
    && !/^(?:const|let|var|null|undefined|true|false|this)$/.test(m[1]));
  const decls = [...src.matchAll(DECL)];
  for (let pass = 0; pass < 2; pass++) {
    for (const m of decls) bind(m[1], m.index, m[2], true);
    for (const m of assigns) bind(m[1], m.index, m[2], false);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const m of src.matchAll(new RegExp(`\\bfor\\s*\\(\\s*(?:const|let)\\s+(${IDENT})\\s+of\\s+([^)\\n]{0,300})\\)`, 'g'))) {
      if (covers(m[2], m.index)) bound.push({ name: m[1], start: m.index, end: regionEnd(src, m.index, false) });
    }
    for (const m of src.matchAll(new RegExp(`(\\[[^\\]\\n]{0,300}\\]|${IDENT})\\s*\\.(?:flatMap|map|forEach|filter)\\(\\s*\\(?\\s*(${IDENT})`, 'g'))) {
      if (covers(m[1], m.index)) bound.push({ name: m[2], start: m.index, end: regionEnd(src, m.index, false) });
    }
  }
  covers.files = files.map((b) => b.name);
  return covers;
}

/** The calls `name(args…` to any of `names` in `src` between `from` and `to` (args: the rest of that line). A call
 *  through a namespace or an object (`fs.readdirSync(`, `fsp.readdir(`, `io.readdir(`, `fs.promises.readdir(`) and a
 *  spread one (`[...walk('ccd')]`) count: the name is what lists, whatever it is reached through. */
function callsTo(src, names, from = 0, to = src.length) {
  if (names.size === 0) return [];
  const re = new RegExp(`(?<![\\w$])(${[...names].map(esc).join('|')})\\(([^;\\n]{0,300})`, 'g');
  return [...src.slice(from, to).matchAll(re)].map((m) => ({ name: m[1], args: m[2], at: from + m.index }));
}

/**
 * One module's listers, scanners and names bound to a file directly in a root, and the first call of its own that
 * scans a source root (`hit`, or null). `imported` carries what its helper imports bring, under the names this module
 * uses (a helper's `CCD = path.resolve(__dirname, '../../ccd/ccd')` makes `path.dirname(CCD)` the ccd root here).
 * @param {string} raw @param {{ listers: Set<string>, scanners: Set<string>, files?: Set<string> }} [imported]
 * @returns {{ listers: Set<string>, scanners: Set<string>, files: Set<string>, hit: string | null }}
 */
export function scanShape(raw, imported = { listers: new Set(), scanners: new Set(), files: new Set() }) {
  const src = blankComments(raw);
  const fns = definedFunctions(src);
  const covers = rootCover(src, imported.files ?? new Set());
  const listers = new Set([...FS_LISTERS, ...imported.listers]);
  const scanners = new Set(imported.scanners);
  const scans = (c) => scanners.has(c.name) || (listers.has(c.name) && covers(c.args, c.at));
  for (let changed = true; changed;) {
    changed = false;
    for (const f of fns) {
      const cs = callsTo(src, new Set([...listers, ...scanners]), f.start, f.end);
      if (!listers.has(f.name) && cs.some((c) => listers.has(c.name))) { listers.add(f.name); changed = true; }
      if (!scanners.has(f.name) && cs.some(scans)) { scanners.add(f.name); changed = true; }
    }
  }
  const hit = callsTo(src, new Set([...listers, ...scanners])).find(scans);
  const files = new Set(covers.files);
  if (hit) return { listers, scanners, files, hit: `${hit.name}(${hit.args}`.slice(0, 120) };
  // A lister handed to an iteration over roots: `ROOTS.flatMap(sources)`.
  const named = [...listers].map(esc).join('|');
  const passed = [...src.matchAll(new RegExp(`(\\[[^\\]\\n]{0,300}\\]|${IDENT})\\s*\\.(?:flatMap|map|forEach)\\(\\s*(${named})\\s*\\)`, 'g'))]
    .find((m) => covers(m[1], m.index));
  return { listers, scanners, files, hit: passed ? passed[0].slice(0, 120) : null };
}

/**
 * Does the test (or helper) at `file` list a source tree itself? Its helper imports under server/test are read with
 * `readSource` too, so a test that calls a census helper's scanner scans. Returns the scanning call, or null.
 * @param {string} file repo-relative @param {(file: string) => string} readSource
 * @param {Map<string, { exports: { listers: Set<string>, scanners: Set<string>, files: Set<string> }, hit: string | null }>} [memo]
 * @returns {string | null}
 */
export function scansSourceTree(file, readSource, memo = new Map()) {
  return moduleScan(file, readSource, memo, new Set()).hit;
}

function moduleScan(file, readSource, memo, stack) {
  const known = memo.get(file);
  if (known) return known;
  const none = { exports: { listers: new Set(), scanners: new Set(), files: new Set() }, hit: null };
  if (stack.has(file)) return none;
  stack.add(file);
  let src;
  try { src = readSource(file); } catch { return none; }
  const imported = { listers: new Set(), scanners: new Set(), files: new Set() };
  for (const m of src.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"](\.\.?\/[^'"]+)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[2])).replace(/\.[cm]?js$/, '.ts');
    if (!target.startsWith('server/test/') || /\.test\.ts$/.test(target)) continue;
    const helper = moduleScan(target, readSource, memo, stack);
    for (const spec of m[1].split(',')) {
      const [orig, alias] = spec.replace(/^\s*type\s+/, '').trim().split(/\s+as\s+/).map((s) => s.trim());
      if (!orig) continue;
      if (helper.exports.listers.has(orig)) imported.listers.add(alias ?? orig);
      if (helper.exports.scanners.has(orig)) imported.scanners.add(alias ?? orig);
      if (helper.exports.files.has(orig)) imported.files.add(alias ?? orig);
    }
  }
  const shape = scanShape(src, imported);
  const result = { exports: { listers: shape.listers, scanners: shape.scanners, files: shape.files }, hit: shape.hit };
  memo.set(file, result);
  return result;
}

/** A tree scanner whose whole file took longer than this on the last full run is left to the merge queue: the plan
 *  runs files, not cases, and a scan case inside a long fixture suite would cost the whole suite on every PR. */
export const SCANNER_MAX_MS = 10_000;

/**
 * The live tests that list a source tree themselves, less the map-carried pins, each with what shows it and its
 * measured duration (null when none was measured). With `recorded` (the `tree-scanners` artifact, `{ file: roots }`),
 * they are the files the last full run recorded; without it (null: missing or unreadable), the static detector's.
 * @param {string[]} live @param {(file: string) => string} readSource @param {Record<string, number> | null} [durations]
 * @param {Record<string, string[]> | null} [recorded]
 * @returns {Array<{ file: string, hit: string, ms: number | null }>}
 */
export function treeScanners(live, readSource, durations = null, recorded = null) {
  const memo = new Map();
  const out = [];
  const ms = (f) => (durations && typeof durations[f] === 'number' ? durations[f] : null);
  for (const f of live) {
    if (PIN_MAP_CARRIED.includes(f)) continue;
    const hit = recorded
      ? (Object.hasOwn(recorded, f) && recorded[f].length > 0 ? `listed ${recorded[f].join(', ')} on the last full run` : null)
      : scansSourceTree(f, readSource, memo);
    if (hit) out.push({ file: f, hit, ms: ms(f) });
  }
  return out;
}

/**
 * The guard suites among the live tests: a GUARD_TESTS pattern (less PIN_MAP_CARRIED), a TREE_READER source, or a
 * tree scanner (`treeScanners`: recorded, or the static fallback) whose file measured at most SCANNER_MAX_MS (or was
 * not measured: run it, the safe direction).
 * @param {string[]} live repo-relative test paths @param {(file: string) => string} readSource
 * @param {Record<string, number> | null} [durations] the full run's per-file durations, ms
 * @param {Record<string, string[]> | null} [recorded] the full run's recorded tree scanners, or null
 * @returns {string[]}
 */
export function guardTests(live, readSource, durations = null, recorded = null) {
  const scanners = new Set(treeScanners(live, readSource, durations, recorded).filter((s) => s.ms === null || s.ms <= SCANNER_MAX_MS).map((s) => s.file));
  return live.filter((f) => {
    if (GUARD_TESTS.some((re) => re.test(f)) && !PIN_MAP_CARRIED.includes(f)) return true;
    let src = '';
    try { src = readSource(f); } catch { return true; } // unreadable: run it, the safe direction
    return TREE_READER.test(src) || scanners.has(f);
  });
}

/** A change to one of these runs every session-hook suite. */
export const SESSION_HOOK_TRIGGERS = ['ccd/ccd', 'ccd/session-hook.sh', 'shared/api.ts'];
const SESSION_HOOK_TEST = /^server\/test\/session-hook[^/]*\.test\.ts$/;

/**
 * The fast selection: the related tests and the map's untraced selection that are live, every guard suite, and
 * the session-hook suites when a trigger changed. Sorted, without duplicates. Paths are repo-relative
 * (`server/test/x.test.ts`).
 * @param {{ live: string[], related: string[], untraced?: string[], guards: string[], changed: string[] }} args
 * @returns {{ files: string[], related: number, untraced: number, guards: number, hook: boolean }}
 */
export function fastSelection({ live, related, untraced = [], guards, changed }) {
  const liveSet = new Set(live);
  const relatedLive = related.filter((f) => liveSet.has(f));
  const untracedLive = untraced.filter((f) => liveSet.has(f));
  const chosen = new Set([...relatedLive, ...untracedLive]);
  const guardLive = guards.filter((f) => liveSet.has(f));
  for (const f of guardLive) chosen.add(f);
  const files = changed.map((f) => f.trim()).filter(Boolean);
  const hook = files.some((f) => SESSION_HOOK_TRIGGERS.includes(f));
  if (hook) for (const f of live) if (SESSION_HOOK_TEST.test(f)) chosen.add(f);
  return { files: [...chosen].sort(), related: new Set(relatedLive).size, untraced: new Set(untracedLive).size, guards: guardLive.length, hook };
}

/**
 * select's `untraced` output, as fast-plan reads it: a JSON array of repo-relative test paths. `full` (nothing
 * bounds what the change reaches), empty text or any other shape throws, and the caller falls back.
 * @param {string} text @returns {string[]}
 */
export function parseUntraced(text) {
  const t = text.trim();
  if (t === 'full') throw new Error('the map cannot bound a changed path vitest cannot follow (select answered untraced=full)');
  if (t === '') throw new Error('select handed no untraced selection');
  const v = JSON.parse(t);
  if (!Array.isArray(v) || v.some((f) => typeof f !== 'string')) throw new Error('the untraced selection is not an array of paths');
  return v;
}

/**
 * The repo-relative test files in a `vitest list --filesOnly --json` report: an array of `{ file }` with absolute
 * paths. A report that is not that shape throws (the caller falls back).
 * @param {unknown} report @param {string} repoDir @returns {string[]}
 */
export function relatedFromVitestList(report, repoDir) {
  if (!Array.isArray(report)) throw new Error('the vitest list report is not an array');
  const root = path.resolve(repoDir);
  return report.map((entry) => {
    const file = entry && typeof entry === 'object' ? /** @type {{ file?: unknown }} */ (entry).file : undefined;
    if (typeof file !== 'string') throw new Error('a vitest list entry carries no file');
    const rel = path.relative(root, path.resolve(root, 'server', file)).split(path.sep).join('/');
    if (rel.startsWith('..')) throw new Error(`a vitest list entry is outside the repository: ${file}`);
    return rel;
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (key && key.startsWith('--')) out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

/** @param {Record<string, string>} outputs */
function writeOutputs(outputs) {
  const text = Object.entries(outputs).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
  else process.stdout.write(text);
}

/** @param {string} md */
function writeSummary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

function main() {
  const opt = parseArgs(process.argv.slice(2));
  const repoDir = opt.repo ?? process.cwd();
  const fallbackMatrix = opt['fallback-matrix'] ?? '';
  const fallbackCount = opt['fallback-count'] ?? '';
  try {
    const live = liveTestFiles(repoDir);
    if (live.length === 0) throw new Error('no live server test files under server/test');
    const report = readFileSync(opt.related, 'utf8');
    // vitest prints `[]` when no test relates to the change; an empty report reads the same.
    const related = report.trim() === '' ? [] : relatedFromVitestList(JSON.parse(report), repoDir);
    if (!opt.untraced) throw new Error('no --untraced file was handed in');
    const untraced = parseUntraced(readFileSync(opt.untraced, 'utf8'));
    const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', opt.base, 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).split('\n');
    let durations = null;
    if (opt.times) {
      try { durations = JSON.parse(readFileSync(opt.times, 'utf8')); } catch { durations = null; }
    }
    const readSource = (f) => readFileSync(path.join(repoDir, f), 'utf8');
    // The full run's recorded scanners; null (no --scanners, or not readable) falls back to the static detector.
    const recorded = readTreeScanners(opt.scanners);
    const guards = guardTests(live, readSource, durations, recorded);
    const heavy = treeScanners(live, readSource, durations, recorded).filter((s) => s.ms !== null && s.ms > SCANNER_MAX_MS);
    const sel = fastSelection({ live, related, untraced, guards, changed });
    // Never an empty matrix: the guard suites always run, so an empty selection means the lists went blind.
    if (sel.files.length === 0) throw new Error('the fast selection is empty — no guard suite matched');
    const unsafe = unsafeTestPaths(sel.files);
    if (unsafe.length > 0) throw new Error(`a selected test path no shard list can carry: ${unsafe.map((f) => JSON.stringify(f)).join(', ')}`);
    // A heavy scanner the change relates to runs anyway; the summary names the ones that did not run.
    const left = heavy.filter((s) => !sel.files.includes(s.file));
    const plan = planShards(sel.files, durations, PROFILES.linuxFast);
    writeOutputs({ server_matrix: JSON.stringify(toMatrix(plan)), count: String(sel.files.length), fallback: '' });
    const lines = [
      '## Fast server tests (an ordinary pull request)',
      '',
      `${sel.files.length} test file(s) in ${plan.length} shard(s): ${sel.related} related to the change by vitest, ${sel.untraced} the map selects for paths vitest cannot follow, ${sel.guards} guard suite(s)${sel.hook ? ', and the session-hook suites (a hook trigger changed)' : ''}. The merge queue runs the full suite.`,
      '',
      ...sel.files.map((f) => `- \`${f}\``),
      '',
      recorded
        ? `The tree scanners are the ${Object.keys(recorded).length} file(s) the last full run recorded listing a source root (the \`tree-scanners\` artifact).`
        : 'No `tree-scanners` artifact was readable: the tree scanners are the static detector\'s (`scansSourceTree`).',
      '',
      ...(left.length === 0 ? [] : [
        `${left.length} tree scanner(s) over ${SCANNER_MAX_MS / 1000} s a file are left to the merge queue (the plan runs files, not cases):`,
        '',
        ...left.map((s) => `- \`${s.file}\` (${Math.round((s.ms ?? 0) / 1000)} s)`),
        '',
      ]),
    ];
    writeSummary(lines.join('\n'));
    console.log(`fast plan: ${sel.files.length} file(s), ${plan.length} shard(s) (${sel.related} related, ${sel.untraced} untraced, ${sel.guards} guards, session-hook ${sel.hook})`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (!fallbackMatrix || !fallbackCount) {
      console.error(`fast-plan.mjs: ${reason}, and no fallback was handed in`);
      process.exitCode = 1;
      return;
    }
    console.log(`::warning::the fast plan failed (${reason}); running select's selection instead`);
    writeOutputs({ server_matrix: fallbackMatrix, count: fallbackCount, fallback: reason.replace(/\n/g, ' ') });
    writeSummary(`## Fast server tests\n\nThe fast plan failed (${reason}); this run runs select's selection instead.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
