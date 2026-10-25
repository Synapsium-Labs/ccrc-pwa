// ARCH-62 (#797), the W0 census of the consolidation wave (spec 2026-10-19 §5.9, §5.1 rule 3): the server's run/session
// equality sites, and the store's binding readers, as NAMED queries over the tree. `run-session-census.test.ts` pins
// each count and shows each query against a fixture, so a later slice can only lower them.
//
// WHAT COUNTS AS AN EQUALITY SITE. A comparison (`===`, `!==`, `==`, `!=`) one of whose operands is a field or a bare
// name `sessionId`, `claimedBy` or `coordinatorId` (the three words the server uses for "which session is this run's
// worker or claimant"), in a `.ts` file under `server/src`; plus a store query (`db.prepare(...)`) that selects `runs`
// rows by one of the first two columns (`sessionId = ?`, `sessionId IN (...)`, `claimedBy = ?`, `OR` of the two, and the
// `seriesRows` template whose column rides in `${where}`). An `.includes` or `Set.has` test is not a comparison here.
// KNOWN WIDTH: a comparison through a differently named local (`const sid = run.sessionId; sid === x`), a destructured
// name and a call assembled from pieces are not seen; the census is a floor on the sites a reader of the code would
// find by searching those three words, not a proof that no other site exists.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-api';
import { BINDING_WRITER_VERBS } from '../src/coord/runBinding.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface EqualitySite { readonly file: string; readonly line: number; readonly kind: 'comparison' | 'query'; readonly text: string }

const WORDS = new Set(['sessionId', 'claimedBy', 'coordinatorId']);
const EQ_OPS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
]);

/** Every `.ts` file under `dir` (relative to `root`), sorted; declaration files and `__`-prefixed mutants skipped. */
function tsFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d).sort()) {
      if (e.startsWith('__') || e === 'node_modules') continue;
      const p = path.join(d, e);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.ts$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
    }
  };
  walk(path.join(root, dir));
  return out;
}

/** The last name of an operand: `a.b.sessionId` and `a!.sessionId` and `sessionId` all read `sessionId`. */
function leafName(e: ts.Expression): string | null {
  let n: ts.Expression = e;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n)) { n = n.expression; continue; }
    break;
  }
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  return null;
}

const QUERY_COLUMN = /\b(?:r\.)?(?:sessionId|claimedBy)\s*(?:=|IN)\s*[?(]/;

/** A `prepare(...)` argument that selects `runs` rows by the session or claimant column. The one query whose column rides
 *  in a template (`seriesRows`' `WHERE ${where}`) is told by that token, and only the site census counts it. */
const isRunsQuery = (arg: string, templated = false): boolean =>
  /\bruns\b/.test(arg) && /\bSELECT\b/.test(arg) && (QUERY_COLUMN.test(arg) || (templated && /WHERE \$\{where\}/.test(arg)));

/** `null`, `undefined` and `void 0`: a comparison with one of them asks whether a field is set, not which session it is. */
const isAbsent = (e: ts.Expression): boolean =>
  e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined') || ts.isVoidExpression(e);

/** The equality sites of one source text, `file` being the label they carry. */
export function equalitySitesOf(text: string, file: string): EqualitySite[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: EqualitySite[] = [];
  const at = (n: ts.Node, kind: EqualitySite['kind']): void => {
    out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, kind, text: n.getText(sf).replace(/\s+/g, ' ').slice(0, 120) });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && EQ_OPS.has(n.operatorToken.kind)) {
      const l = leafName(n.left);
      const r = leafName(n.right);
      const named = (l !== null && WORDS.has(l)) || (r !== null && WORDS.has(r));
      if (named && !isAbsent(n.left) && !isAbsent(n.right)) at(n, 'comparison');
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'prepare'
      && n.arguments.length > 0 && isRunsQuery(n.arguments[0]!.getText(sf), true)) {
      at(n, 'query');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Every equality site under `server/src` of `root`, by file then line. */
export function equalitySites(root: string = REPO): EqualitySite[] {
  const out: EqualitySite[] = [];
  for (const f of tsFiles(root, 'server/src')) {
    const file = path.relative(root, f).split(path.sep).join('/');
    out.push(...equalitySitesOf(readFileSync(f, 'utf8'), file));
  }
  return out;
}

/** The count per file, files with no site left out. */
export function countsByFile(sites: readonly EqualitySite[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sites) out[s.file] = (out[s.file] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The store's BINDING READERS: the public methods of `CoordStore` that return runs, claimants or a parent selected by a
 * session or claimant id (a method whose body reads `seriesRows`, or holds a `runs` query on the columns above, and
 * whose answer is a run, a list of runs or the id of a coordinator). Not counted: a binding WRITER (`BINDING_WRITER_VERBS`,
 * whose own duplicate-run read is a decision inside its transaction) and a method that answers an attribute of the runs
 * (a project, a boolean), named in `ATTRIBUTE_READS`: it decides nothing about which run is a session's.
 */
export function storeBindingReaders(text: string, file = 'server/src/coord/store.ts'): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n) && n.name?.text === 'CoordStore') {
      for (const m of n.members) {
        if (!ts.isMethodDeclaration(m) || !ts.isIdentifier(m.name) || m.body === undefined) continue;
        const priv = m.modifiers?.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword);
        if (priv === true) continue;
        const body = m.body.getText(sf);
        let hit = /\bseriesRows\b/.test(body);
        const walk = (c: ts.Node): void => {
          if (ts.isCallExpression(c) && ts.isPropertyAccessExpression(c.expression) && c.expression.name.text === 'prepare'
            && c.arguments.length > 0 && isRunsQuery(c.arguments[0]!.getText(sf))) hit = true;
          ts.forEachChild(c, walk);
        };
        walk(m.body);
        if (hit && !ATTRIBUTE_READS.includes(m.name.text) && !BINDING_WRITER_VERBS.includes(m.name.text)) names.push(m.name.text);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return names.sort();
}

/** The store methods that read the runs by session or claimant for an ATTRIBUTE, not for a run (see above). Named, so a
 *  new one is a deliberate entry. */
export const ATTRIBUTE_READS: readonly string[] = ['sessionProject', 'strandedClear'];
