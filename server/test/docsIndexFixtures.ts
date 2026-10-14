// The canned `docs-index` answers, and the fixture HOMEs the real verb emits them on (spec 2026-10-01 §7.2,
// "Fixtures"). ONE module, so a stub that answers for ccd elsewhere (`ccrc doctor`'s `healthy()`, the install
// and update suites' python3 stubs) cannot drift from the verb: `ccd-docs-index.test.ts` runs the real
// `docs-index` on `plantIndexHome(h, which)` and asserts that `normaliseDocsIndex` of its answer deep-equals the
// canned object. The canned objects carry placeholders that are themselves valid wire values (a repoKey of 32
// zeros, commits of 40 zeros), so a stub that prints one prints a line that parses as a real answer.
//
// This module imports `node:*` and types only. The doctor, install and update suites import it, and none of
// them should load the docs runners (`ccdDocsHelpers.ts` resolves host binaries when it is imported). So the
// stamp path is computed here from the same two rules ccd's helper follows, and `ccd-docs-index.test.ts` checks
// this copy against the helper's own `stamp_path`.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DocsIndexOk } from '../../shared/docs.js';
import type { CcdHarness } from './ccdWsHelpers.js';

const ZERO_KEY = '0'.repeat(32);
const ZERO_SHA = '0'.repeat(40);
const SHA_TEXT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const AGE_KEY = /^(?:ageMs|[A-Za-z]+AgeMs)$/;

/** The docs `plantIndexHome(h, 'ready')` commits to `demo`: two specs, one plan, and one file outside every
 *  section, which no count may include. */
export const INDEX_READY_DOCS: Readonly<Record<string, string>> = {
  'docs/superpowers/specs/one.md': '# one\n',
  'docs/superpowers/specs/two.md': '# two\n',
  'docs/superpowers/plans/plan.md': '# plan\n',
  'src/not-docs.md': '# outside every section\n',
};

/** `plantIndexHome(h, 'ready')`, normalised: a GitHub-shaped repository with docs and a fresh ok stamp, beside
 *  a directory that is not a git repository and holds one section. No row is unreadable. */
export const DOCS_INDEX_READY: DocsIndexOk = {
  v: 1, verb: 'docs-index', ok: true, elapsedMs: 0, unlisted: 0, duplicates: [],
  projects: [
    {
      project: 'demo', state: 'ready', github: { state: 'named', slug: 'example-org/example-repo' }, repoKey: ZERO_KEY,
      default: { name: 'main', via: 'default:origin-head', commit: ZERO_SHA },
      sections: { specs: 2, plans: 1, 'product-design': null, conventions: null },
      fetch: { okAgeMs: 0, lastOutcome: 'ok' },
    },
    { project: 'nongit', state: 'not-a-git-repo', github: { state: 'none' }, sectionsOnDisk: ['specs'] },
  ],
};

/** `plantIndexHome(h, 'unreadable')`, normalised: one repository whose `.git` is corrupt beside one served
 *  repository with no docs and no stamp. */
export const DOCS_INDEX_UNREADABLE: DocsIndexOk = {
  v: 1, verb: 'docs-index', ok: true, elapsedMs: 0, unlisted: 0, duplicates: [],
  projects: [
    { project: 'broken', state: 'repo-unreadable', github: { state: 'none' } },
    {
      project: 'demo', state: 'ready', github: { state: 'none' }, repoKey: ZERO_KEY,
      default: { name: 'main', via: 'default:origin-head', commit: ZERO_SHA },
      sections: { specs: null, plans: null, 'product-design': null, conventions: null },
    },
  ],
};

/** The one fixed line ccd's docs front prints for `docs-index` when `python3` cannot run at all (spec §2 (a),
 *  "Shape", step 2): the line's text, without its newline. */
export const DOCS_HELPER_UNAVAILABLE_MISSING_LINE: string =
  '{"v":1,"verb":"docs-index","ok":false,"elapsedMs":0,"failure":"helper-unavailable","detail":"python-missing"}';

/** A parsed `docs-index` answer with every volatile value replaced by its placeholder: `elapsedMs` 0, each
 *  `repoKey` 32 zeros, each 40- or 64-hex string 40 zeros, and each numeric age (`ageMs`, `*AgeMs`) 0. A null
 *  age stays null, because "never succeeded" is not volatile. Returns a copy and never mutates its input. */
export function normaliseDocsIndex(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(normaliseDocsIndex);
  if (typeof o === 'string') return SHA_TEXT.test(o) ? ZERO_SHA : o;
  if (o === null || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (k === 'elapsedMs' && typeof v === 'number') out[k] = 0;
    else if (k === 'repoKey' && typeof v === 'string') out[k] = ZERO_KEY;
    else if (AGE_KEY.test(k) && typeof v === 'number') out[k] = 0;
    else out[k] = normaliseDocsIndex(v);
  }
  return out;
}

/** A `#!/bin/sh` script that prints `line` and a newline with shell builtins only, so a doctor or install
 *  fixture can plant it as `ccd` on a PATH that holds nothing else. A line holding a single quote or a newline
 *  cannot be quoted by this shape, so it is refused rather than mangled. */
export function docsIndexStubScript(line: string): string {
  if (/['\n\r]/.test(line)) throw new Error('docsIndexStubScript: the line holds a single quote or a newline');
  return `#!/bin/sh\nprintf '%s\\n' '${line}'\n`;
}

const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Where `docs-fetch` keeps `branch`'s stamp for `projects/<project>`: `$REG/docs/fetch/<repoKey>/
 *  <sha256(branch)[:32]>.json`, where repoKey is 32 hex of sha256 over the real path of the project's `.git`
 *  (spec §2 (g) step 4). For a project whose `.git` is its own directory. */
export function indexStampPath(h: CcdHarness, project: string, branch: string): string {
  const key = sha256Hex(fs.realpathSync(path.join(h.home, 'projects', project, '.git'))).slice(0, 32);
  return path.join(h.home, '.cc-sessions', 'docs', 'fetch', key, `${sha256Hex(branch).slice(0, 32)}.json`);
}

/** Writes `stamp` where `docs-fetch` would keep `branch`'s stamp for `projects/<project>`, with the modes its
 *  writer uses (directories 0700, the file 0600). Answers the path. */
export function writeIndexStamp(
  h: CcdHarness, project: string, branch: string, stamp: Readonly<Record<string, unknown>>,
): string {
  const p = indexStampPath(h, project, branch);
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(stamp), { mode: 0o600 });
  return p;
}

/** Writes `files` into `main`, commits exactly those paths, and pushes `main` to origin. Answers the commit. */
function commitAndPush(h: CcdHarness, main: string, files: Readonly<Record<string, string>>): string {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(main, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  h.git(main, 'add', '--', ...Object.keys(files));
  h.git(main, 'commit', '-q', '-m', 'docs');
  h.git(main, 'push', '-q', 'origin', 'main');
  return h.git(main, 'rev-parse', 'HEAD');
}

/** Builds, inside `h`'s fixture HOME only, the projects root whose real `docs-index` answer normalises to
 *  `DOCS_INDEX_READY` ('ready') or to `DOCS_INDEX_UNREADABLE` ('unreadable'). */
export function plantIndexHome(h: CcdHarness, which: 'ready' | 'unreadable'): void {
  if (which === 'ready') {
    const main = h.makeGhRepo('demo', 'example-org/example-repo');
    const commit = commitAndPush(h, main, INDEX_READY_DOCS);
    // A success 5 s ago, as docs-fetch stamps one: okMs is that attempt's own time.
    const at = Date.now() - 5000;
    writeIndexStamp(h, 'demo', 'main', { v: 1, branch: 'main', attemptMs: at, lastOutcome: 'ok', okMs: at, okCommit: commit });
    fs.mkdirSync(path.join(h.home, 'projects', 'nongit', 'docs', 'superpowers', 'specs'), { recursive: true });
    return;
  }
  h.makeRepo('demo');
  const broken = h.makeRepo('broken');
  // A HEAD that names nothing: git no longer recognises the directory as a repository, so discovery's
  // rev-parse exits 128 ("not a git repository", measured on git 2.43.0).
  fs.writeFileSync(path.join(broken, '.git', 'HEAD'), 'not a ref\n');
}
