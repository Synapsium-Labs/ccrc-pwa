/**
 * D-8641 (the large-file pilot, Task 1). A file's PROGRAM: the file plus the modules a large-file split moves its code
 * to. The TypeScript analogue of `ccdSource()`. A scanner that reads a split file's text through this view keeps reading
 * the same code after each pure move (`.github/ci/file-split.mjs`, D-8636), so it neither goes red because code moved
 * nor stays green while reading less of it.
 *
 * Reads with `node:fs` and parses with `scan/parse.ts`'s `ts`, so it adds no second parser. Paths are repository
 * relative (`server/src/coord/…`), the form `scan/symbols.ts` takes; `root` exists for the view's own fixture rows.
 * KNOWN WIDTH: `declaringFile` sees top-level statements only (variable, function, class, interface, type, enum), the
 * same kinds the split tool moves.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ts } from './parse.js';
import { REPO_ROOT } from './symbols.js';

/** Each split file, by its source path, and its destinations in the order the plan moves them in. A later file in the
 *  programme adds its own row. */
export const PROGRAM_VIEWS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'server/src/coord/delegation-checkpoint.ts': Object.freeze([
    'server/src/coord/delegation-recovery.ts',
    'server/src/coord/delegation-durability.ts',
    'server/src/coord/delegation-db-projection.ts',
  ]),
});

/** The source and its destinations, whether or not they exist. Throws for a source that has no row. */
export function programMembers(source: string): string[] {
  const dests = Object.hasOwn(PROGRAM_VIEWS, source) ? PROGRAM_VIEWS[source] : undefined;
  if (dests === undefined) throw new Error(`no program view for ${source}: add its row to PROGRAM_VIEWS`);
  return [source, ...dests];
}

/** The members that exist, in row order, with their text. */
export function programTexts(source: string, root: string = REPO_ROOT): Array<{ file: string; text: string }> {
  return programMembers(source)
    .filter((file) => existsSync(path.join(root, file)))
    .map((file) => ({ file, text: readFileSync(path.join(root, file), 'utf8') }));
}

/** The members that exist, in row order. */
export function programFiles(source: string, root: string = REPO_ROOT): string[] {
  return programTexts(source, root).map((t) => t.file);
}

/** The members' texts joined, each ending in exactly one `\n`. */
export function programSource(source: string, root: string = REPO_ROOT): string {
  return programTexts(source, root).map((t) => `${t.text.replace(/\n+$/, '')}\n`).join('');
}

const declaredCache = new Map<string, ReadonlySet<string>>();

/** The names `text`'s top-level statements declare. */
function topLevelNames(file: string, text: string): ReadonlySet<string> {
  const key = `${file}\0${text}`;
  const hit = declaredCache.get(key);
  if (hit !== undefined) return hit;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  const bind = (n: ts.BindingName): void => {
    if (ts.isIdentifier(n)) { names.add(n.text); return; }
    for (const e of n.elements) if (!ts.isOmittedExpression(e)) bind(e.name);
  };
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) bind(d.name);
    else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) names.add(s.name.text);
    else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) names.add(s.name.text);
  }
  declaredCache.set(key, names);
  return names;
}

/** The one existing member whose top-level statements declare `name`. Throws when none does, or two or more do. */
export function declaringFile(source: string, name: string, root: string = REPO_ROOT): string {
  const homes = programTexts(source, root).filter((t) => topLevelNames(t.file, t.text).has(name)).map((t) => t.file);
  if (homes.length !== 1) {
    throw new Error(`${homes.length} members declare ${name} in ${source}'s program${homes.length ? `: ${homes.join(', ')}` : ''}`);
  }
  return homes[0]!;
}
