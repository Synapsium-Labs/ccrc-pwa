/**
 * D-8636 (plan docs/superpowers/plans/2026-11-14-large-file-step0-split-tool.md; spec
 * docs/superpowers/specs/2026-11-13-large-file-programme-design.md §2 items 2 and 4, §4, D-8615). The decisions of the
 * TypeScript and `.mjs` slice tool, pure over file texts: the top-level model of a file, the move of named top-level
 * declarations into a destination module (`planMove`), the pure-move verdict (`pureMoveVerdict`), the preflight verdict
 * (`preflightVerdict`) and `moveBase`. `.github/ci/file-split.mjs` only reads arguments, files and git, and writes.
 *
 * It shares the ccd plan's vocabulary (Task 1 of docs/superpowers/plans/2026-11-06-ccd-file-split.md, D-8048: a region,
 * a pure move, `pureMoveVerdict`, `duplicateDefinitions`, `moveBase`, `preflight`), not its code: bash is judged by
 * `bash -n` and a program dump, TypeScript by the repo's one parser (`scan/parse.ts`).
 *
 * A REGION is a top-level statement with every comment between it and the statement before (blank lines in front
 * skipped) and a comment on its last line; the file's first statement leaves a header (its leading comments up to the
 * first blank line) to the file. Names are bound with a syntax-only program per file, so a parameter or a local that
 * shadows a top-level name is not a reference to it.
 *
 * A diff is a MOVE only when it adds a marker line (`destHeader`), which the tool writes at the top of a new destination
 * and in front of the regions it appends to an existing one: a shared private name across two changed files is not a
 * move signal (a feature PR has them all the time).
 *
 * KNOWN WIDTH: a hand move without the marker is not judged; a new file's header is set aside only when a blank line
 * follows it; `export *` satisfies any name when imports are resolved; a mention of the source outside an import
 * (`vi.mock`, a dynamic `import()`, a path a test reads) and a namespace object passed on as a value are reported, never
 * repointed; a change in the order two already-loaded modules evaluate is not judged; an `import x = require(…)` binding
 * the moved code uses is refused.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ts } from './scan/parse.js';
import { changedFiles, fileAt, gitRead } from './growthCheck.js';
import { assignContexts, type ContextRow, type Pkg } from './rings/ringContextMap.js';

/** Repo-relative path (with `/`) to file text. */
export type Tree = ReadonlyMap<string, string>;

/** The source files the tool reads and writes: TypeScript and ES modules, not declarations. */
export const isCodeFile = (f: string): boolean => /\.(?:ts|tsx|mts|mjs)$/.test(f) && !/\.d\.[cm]?ts$/.test(f);

/** The marker the tool writes at the top of a destination it creates, and in front of the regions it appends to one
 *  that exists. A diff that adds a marker line is a move the verdict judges; one that adds none is not (a feature PR
 *  shares private names such as `TOKEN` across files all the time). */
export const destHeader = (source: string): string =>
  `/** Moved out of \`${source}\` by \`.github/ci/file-split.mjs\`: a pure move (D-8636). */`;

/** A marker line, `destHeader`'s shape for any source, alone on its line. */
const MARK = String.raw`\/\*\* Moved out of \`[^\`\n]+\` by \`\.github\/ci\/file-split\.mjs\``;
const MARK_LINE = new RegExp(String.raw`^[ \t]*${MARK}[^\n]*$`, 'gm');
/** A marker line with the blank lines after it, as a region carries it in front of its own lead comment. */
const MARK_LEAD = new RegExp(String.raw`^[ \t]*${MARK}[^\n]*\n(?:[ \t]*\n)*`, 'gm');
/** An added line of a `git diff` that is a marker line. */
const MARK_ADDED = new RegExp(String.raw`^\+[ \t]*${MARK}`, 'm');

/** How many marker lines a file text holds. */
export const moveMarks = (text: string | undefined): number => (text === undefined ? 0 : text.match(MARK_LINE)?.length ?? 0);

// ---- The top-level model of a file ----

type EntryKind = 'decl' | 'module' | 'other';

interface Entry {
  stmt: ts.Statement;
  kind: EntryKind;
  /** The names a `decl` declares. */
  names: string[];
  exported: boolean;
  isDefault: boolean;
  /** Where a removal of the region starts: the end of the region before. */
  cut: number;
  /** The region's first character: its first comment or token. */
  start: number;
  /** The region's end, a comment on its last line included. */
  end: number;
}

interface FileModel {
  file: string;
  text: string;
  sf: ts.SourceFile;
  entries: Entry[];
  decls: Map<string, Entry[]>;
  /** The first statement's leading comments up to the first blank line: the file's, not the statement's. */
  header: string;
  /** Comments after the last statement. */
  eof: string;
}

const scriptKind = (f: string): ts.ScriptKind =>
  /\.tsx$/.test(f) ? ts.ScriptKind.TSX : /\.m?js$/.test(f) ? ts.ScriptKind.JS : ts.ScriptKind.TS;

const parse = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));

const modifiersOf = (s: ts.Node): readonly ts.Modifier[] => (ts.canHaveModifiers(s) ? ts.getModifiers(s) ?? [] : []);
const hasModifier = (s: ts.Node, k: ts.SyntaxKind): boolean => modifiersOf(s).some((m) => m.kind === k);

function bindingNames(n: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(n)) { out.push(n.text); return; }
  for (const e of n.elements) if (!ts.isOmittedExpression(e)) bindingNames(e.name, out);
}

function classify(stmt: ts.Statement): { kind: EntryKind; names: string[] } {
  if (ts.isImportDeclaration(stmt)) return { kind: stmt.importClause ? 'module' : 'other', names: [] };
  if (ts.isImportEqualsDeclaration(stmt) || ts.isExportDeclaration(stmt)) return { kind: 'module', names: [] };
  if (ts.isVariableStatement(stmt)) {
    const names: string[] = [];
    for (const d of stmt.declarationList.declarations) bindingNames(d.name, names);
    return { kind: 'decl', names };
  }
  if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) return { kind: 'decl', names: [stmt.name.text] };
  if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
    return { kind: 'decl', names: [stmt.name.text] };
  }
  if (ts.isModuleDeclaration(stmt) && ts.isIdentifier(stmt.name)) return { kind: 'decl', names: [stmt.name.text] };
  return { kind: 'other', names: [] };
}

const skipSpace = (text: string, i: number, limit: number): number => {
  while (i < limit && /\s/.test(text[i]!)) i++;
  return i;
};

function model(file: string, text: string, sf: ts.SourceFile = parse(file, text)): FileModel {
  const entries: Entry[] = [];
  const decls = new Map<string, Entry[]>();
  let header = '';
  let prev = 0;
  sf.statements.forEach((stmt, i) => {
    const tokenAt = stmt.getStart(sf);
    let cut = Math.max(prev, stmt.getFullStart());
    if (i === 0) {
      const lead = skipSpace(text, 0, tokenAt);
      const blank = /\n[ \t]*\n/.exec(text.slice(lead, tokenAt));
      if (blank !== null && lead < tokenAt) {
        header = text.slice(lead, lead + blank.index).trim();
        cut = lead + blank.index;
      }
    }
    const start = skipSpace(text, cut, tokenAt);
    let end = stmt.end;
    const trailing = ts.getTrailingCommentRanges(text, end);
    if (trailing && trailing.length > 0) end = trailing[trailing.length - 1]!.end;
    const { kind, names } = classify(stmt);
    const e: Entry = {
      stmt, kind, names, cut, start, end,
      exported: hasModifier(stmt, ts.SyntaxKind.ExportKeyword),
      isDefault: hasModifier(stmt, ts.SyntaxKind.DefaultKeyword),
    };
    entries.push(e);
    for (const n of names) decls.set(n, [...(decls.get(n) ?? []), e]);
    prev = end;
  });
  return { file, text, sf, entries, decls, header, eof: text.slice(prev).trim() };
}

/** A region's text with one `export ` modifier taken out, the comparison every rule makes. */
function norm(m: FileModel, e: Entry): string {
  let t = m.text.slice(e.start, e.end);
  const ex = modifiersOf(e.stmt).find((x) => x.kind === ts.SyntaxKind.ExportKeyword);
  if (ex !== undefined) {
    const a = ex.getStart(m.sf) - e.start;
    const b = skipSpace(m.text, ex.end, e.end) - e.start;
    t = t.slice(0, a) + t.slice(b);
  }
  return t.replace(MARK_LEAD, '').trimEnd();
}

/** The names a file exports, by declaration, by a local `export { … }` list and by a named `export … from`; `star`
 *  when it has an `export * from`; `twice`, a name exported more than once (Node refuses the module: TS2323). A
 *  declaration merged over several statements (overloads, an interface and a namespace) exports its name once. */
function exportedNames(m: FileModel): { names: Set<string>; star: boolean; twice: string[] } {
  const names = new Set<string>();
  const twice = new Set<string>();
  const byDecl = new Set<string>();
  let star = false;
  const add = (n: string): void => { if (names.has(n)) twice.add(n); names.add(n); };
  for (const e of m.entries) {
    if (e.kind === 'decl' && e.exported) {
      for (const n of e.names) {
        const x = e.isDefault ? 'default' : n;
        if (byDecl.has(x)) continue;
        byDecl.add(x);
        add(x);
      }
    }
    if (e.kind === 'other' && e.exported && e.isDefault) add('default');
    if (ts.isExportAssignment(e.stmt) && !e.stmt.isExportEquals) add('default');
    if (ts.isExportDeclaration(e.stmt)) {
      const c = e.stmt.exportClause;
      if (c === undefined) star = true;
      else if (ts.isNamedExports(c)) for (const el of c.elements) add(el.name.text);
      else add(c.name.text);
    }
  }
  return { names, star, twice: [...twice].sort() };
}

/** Local `export { a, b as c }` lists (no `from`): exported name to local name. */
function localExportLists(m: FileModel): { entry: Entry; elements: ts.ExportSpecifier[] }[] {
  const out: { entry: Entry; elements: ts.ExportSpecifier[] }[] = [];
  for (const e of m.entries) {
    const s = e.stmt;
    if (ts.isExportDeclaration(s) && !s.moduleSpecifier && s.exportClause && ts.isNamedExports(s.exportClause)) {
      out.push({ entry: e, elements: [...s.exportClause.elements] });
    }
  }
  return out;
}

// ---- Module specifiers ----

const posix = path.posix;

/** The changed or program file a relative specifier names, from `from`; null for a bare specifier or no match. */
export function resolveSpec(from: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!spec.startsWith('.')) return null;
  const j = posix.normalize(posix.join(posix.dirname(from), spec));
  const cands = /\.js$/.test(j) ? [j.replace(/\.js$/, '.ts'), j.replace(/\.js$/, '.tsx'), j]
    : /\.mjs$/.test(j) ? [j, j.replace(/\.mjs$/, '.mts')]
      : /\.(?:ts|tsx|mts)$/.test(j) ? [j] : [`${j}.ts`, `${j}.tsx`, `${j}/index.ts`, j];
  return cands.find((c) => files.has(c)) ?? null;
}

const dotted = (rel: string): string => (rel.startsWith('.') ? rel : `./${rel}`);

/** The specifier `from` writes for `target`, in the style of `like` (an existing specifier) or `.js` by default. */
function specFor(from: string, target: string, like?: string): string {
  const rel = dotted(posix.relative(posix.dirname(from), target));
  const stem = rel.replace(/\.(?:ts|tsx|mts|mjs)$/, '');
  if (like !== undefined && /\.(?:ts|tsx)$/.test(like)) return rel;
  if (like !== undefined && !/\.[cm]?[jt]sx?$/.test(like)) return stem;
  return /\.m(?:ts|js)$/.test(target) ? `${stem}.mjs` : `${stem}.js`;
}

/** A relative specifier written in `fromFile` re-based for `toFile`; a bare one is kept. */
function rebase(spec: string, fromFile: string, toFile: string): string {
  if (!spec.startsWith('.')) return spec;
  return dotted(posix.relative(posix.dirname(toFile), posix.join(posix.dirname(fromFile), spec)));
}

const specText = (s: ts.Expression): string => (ts.isStringLiteral(s) ? s.text : s.getText());

// ---- The pure-move verdict ----

export interface MoveVerdict {
  pure: boolean;
  moved: { name: string; from: string; to: string }[];
  /** Each rule a diff breaks: `text:<name>`, `rest:<file>`, `defined-twice:<name>`, `removed:<name>`,
   *  `added:<name>`, `surface:<file>#<name>`, `export-unused:<file>#<name>`, `exported-twice:<file>#<name>`,
   *  `unresolved:<importer>#<name>`, `no-move` (a marker added and no declaration moved). */
  differing: string[];
  /** Names exported only now, as `<file>#<name>`: a declaration the cut made another module import. */
  newlyExported: string[];
}

const uniq = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];
const regionsOf = (m: FileModel, name: string): string =>
  uniq(m.decls.get(name) ?? []).map((e) => norm(m, e)).join('\n');

/** The statements of a file that are not import or export lines and not moved, as one text: comments in front of an
 *  import line stay in it, blank lines are collapsed, and a new file's header is set aside. */
function rest(m: FileModel, moved: ReadonlySet<string>, isNew: boolean): string {
  const items: string[] = [];
  if (!isNew && m.header !== '') items.push(m.header);
  for (const e of m.entries) {
    if (e.kind === 'module') {
      const lead = m.text.slice(e.start, e.stmt.getStart(m.sf)).trim();
      if (lead !== '') items.push(lead);
    } else if (!(e.kind === 'decl' && e.names.some((n) => moved.has(n)))) {
      items.push(norm(m, e));
    }
  }
  if (m.eof !== '') items.push(m.eof);
  return items.join('\n').replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n');
}

interface ImportUse { importer: string; target: string; names: string[] }

/** Every named import and `export … from` of `importer` that resolves to one of `files`. */
function importUses(importer: string, sf: ts.SourceFile, files: ReadonlySet<string>): ImportUse[] {
  const out: ImportUse[] = [];
  for (const s of sf.statements) {
    if ((ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier) {
      const target = resolveSpec(importer, specText(s.moduleSpecifier), files);
      if (target === null) continue;
      const names: string[] = [];
      if (ts.isImportDeclaration(s)) {
        const c = s.importClause;
        if (c?.name) names.push('default');
        if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) {
          for (const el of c.namedBindings.elements) names.push((el.propertyName ?? el.name).text);
        }
      } else if (s.exportClause && ts.isNamedExports(s.exportClause)) {
        for (const el of s.exportClause.elements) names.push((el.propertyName ?? el.name).text);
      }
      out.push({ importer, target, names });
    }
  }
  return out;
}

/**
 * The pure-move verdict over the files a diff changes, `base` and `head` holding each side (a file absent on a side
 * is absent from that map). `importers` are other head files whose imports of a changed file must still resolve.
 * Null when the diff is not a move: no changed file gains a marker line (`destHeader`). A moved name is one newly
 * declared in one file that another changed file declared at the base.
 */
export function pureMoveVerdict(base: Tree, head: Tree, importers: Tree = new Map()): MoveVerdict | null {
  const files = uniq([...base.keys(), ...head.keys()]).filter(isCodeFile).sort();
  if (!files.some((f) => moveMarks(head.get(f)) > moveMarks(base.get(f)))) return null;
  const mb = new Map<string, FileModel>();
  const mh = new Map<string, FileModel>();
  for (const f of files) {
    const b = base.get(f);
    const h = head.get(f);
    if (b !== undefined) mb.set(f, model(f, b));
    if (h !== undefined) mh.set(f, model(f, h));
  }
  const declares = (m: FileModel | undefined, n: string): boolean => m?.decls.has(n) ?? false;
  const added = new Map<string, string[]>();
  const removed = new Map<string, string[]>();
  for (const f of files) {
    for (const n of mh.get(f)?.decls.keys() ?? []) if (!declares(mb.get(f), n)) added.set(n, [...(added.get(n) ?? []), f]);
    for (const n of mb.get(f)?.decls.keys() ?? []) if (!declares(mh.get(f), n)) removed.set(n, [...(removed.get(n) ?? []), f]);
  }
  const differing: string[] = [];
  const moved: MoveVerdict['moved'] = [];
  const candidates = new Set<string>();
  for (const [n, to] of added) {
    const from = files.filter((f) => f !== to[0] && declares(mb.get(f), n));
    if (from.length === 0) continue;
    candidates.add(n);
    if (to.length > 1 || from.length > 1 || from.some((f) => declares(mh.get(f), n))) {
      differing.push(`defined-twice:${n}`);
      continue;
    }
    moved.push({ name: n, from: from[0]!, to: to[0]! });
    if (regionsOf(mb.get(from[0]!)!, n) !== regionsOf(mh.get(to[0]!)!, n)) differing.push(`text:${n}`);
  }
  if (candidates.size === 0) differing.push('no-move');
  for (const n of added.keys()) if (!candidates.has(n)) differing.push(`added:${n}`);
  for (const n of removed.keys()) if (!moved.some((m) => m.name === n)) differing.push(`removed:${n}`);

  for (const f of files) {
    const b = mb.get(f);
    const h = mh.get(f);
    const was = b === undefined ? '' : rest(b, candidates, false);
    const now = h === undefined ? '' : rest(h, candidates, b === undefined);
    if (was !== now) differing.push(`rest:${f}`);
  }

  // The exported surface, and every import of a changed file.
  const headFiles = new Set(mh.keys());
  const exportsAt = new Map([...mh].map(([f, m]) => [f, exportedNames(m)]));
  const uses: ImportUse[] = [];
  for (const [f, m] of mh) uses.push(...importUses(f, m.sf, new Set(files)));
  for (const [f, t] of importers) if (!mh.has(f) && isCodeFile(f)) uses.push(...importUses(f, parse(f, t), new Set(files)));
  const newlyExported: string[] = [];
  for (const f of files) {
    const before = mb.has(f) ? exportedNames(mb.get(f)!).names : new Set<string>();
    const after = exportsAt.get(f)?.names ?? new Set<string>();
    for (const n of exportsAt.get(f)?.twice ?? []) differing.push(`exported-twice:${f}#${n}`);
    for (const e of before) {
      if (after.has(e)) continue;
      const mv = moved.find((m) => m.name === e && m.from === f);
      if (mv !== undefined && exportsAt.get(mv.to)?.names.has(e)) continue;
      differing.push(`surface:${f}#${e}`);
    }
    for (const e of after) {
      if (before.has(e)) continue;
      const mv = moved.find((m) => m.name === e && m.to === f);
      if (mv !== undefined && mb.has(mv.from) && exportedNames(mb.get(mv.from)!).names.has(e)) continue;
      newlyExported.push(`${f}#${e}`);
      if (!uses.some((u) => u.target === f && u.importer !== f && u.names.includes(e))) differing.push(`export-unused:${f}#${e}`);
    }
  }
  for (const u of uses) {
    const ex = headFiles.has(u.target) ? exportsAt.get(u.target)! : { names: new Set<string>(), star: false };
    for (const n of u.names) if (!ex.names.has(n) && !ex.star) differing.push(`unresolved:${u.importer}#${n}`);
  }
  const d = uniq(differing).sort();
  return { pure: d.length === 0, moved: moved.sort((a, b) => a.name.localeCompare(b.name)), differing: d, newlyExported: newlyExported.sort() };
}

/** Names declared at the top level of more than one of `files` (a rebase that kept the old copy of a moved one). */
export function duplicateDefinitions(files: Tree): string[] {
  const seen = new Map<string, number>();
  for (const [f, t] of files) {
    if (!isCodeFile(f)) continue;
    for (const n of model(f, t).decls.keys()) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  return [...seen].filter(([, c]) => c > 1).map(([n]) => n).sort();
}

/** An `.mjs` module's namespace: each export's name and `String()` of its value (spec §2 item 4). Importing a module
 *  runs its top level, so a pin calls this on fixtures. */
export async function mjsNamespace(file: string): Promise<Record<string, string>> {
  const ns = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(ns).sort().map((k) => [k, String(ns[k])]));
}

// ---- The move ----

export interface MoveRequest { source: string; dest: string; names: readonly string[] }

export interface MovePlan {
  /** New text of every file the move changes. Empty when `problems` is not. */
  files: Map<string, string>;
  problems: string[];
  /** The names that move, in source order. */
  moved: string[];
  /** Source names the destination imports, and moved names the source imports back. */
  destUsesSource: string[];
  sourceUsesDest: string[];
  /** Importers whose imports were repointed. */
  repointed: string[];
  /** `<file>:<line>` of each mention of the source module outside an import or export line. */
  mentions: string[];
}

type Binding =
  | { kind: 'import'; local: string; stmt: ts.ImportDeclaration | ts.ImportEqualsDeclaration }
  | { kind: 'decl'; name: string; entry: Entry };

/** `value`: some use reads it as a value; `written`: some use assigns it. */
interface Use { binding: Binding; value: boolean; written: boolean }

/** A syntax-only program over one file, so names bind as the language binds them. */
function bind(file: string, text: string): { sf: ts.SourceFile; checker: ts.TypeChecker } {
  const sf = parse(file, text);
  const host: ts.CompilerHost = {
    getSourceFile: (n) => (n === file ? sf : undefined),
    writeFile: () => undefined,
    getDefaultLibFileName: () => 'lib.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => '',
    getNewLine: () => '\n',
    fileExists: (n) => n === file,
    readFile: (n) => (n === file ? text : undefined),
  };
  const program = ts.createProgram({ rootNames: [file], host,
    options: { noLib: true, noResolve: true, types: [], allowJs: true, noEmit: true } });
  return { sf: program.getSourceFile(file)!, checker: program.getTypeChecker() };
}

const CLIMB = new Set([ts.SyntaxKind.VariableDeclaration, ts.SyntaxKind.VariableDeclarationList,
  ts.SyntaxKind.VariableStatement, ts.SyntaxKind.BindingElement, ts.SyntaxKind.ObjectBindingPattern,
  ts.SyntaxKind.ArrayBindingPattern, ts.SyntaxKind.ImportSpecifier, ts.SyntaxKind.NamedImports,
  ts.SyntaxKind.NamespaceImport, ts.SyntaxKind.ImportClause, ts.SyntaxKind.ImportDeclaration]);

function topStatementOf(decl: ts.Node, sf: ts.SourceFile): ts.Statement | null {
  let n = decl;
  while (n.parent !== undefined && n.parent !== sf) {
    if (!CLIMB.has(n.parent.kind)) return null;
    n = n.parent;
  }
  return n.parent === sf ? (n as ts.Statement) : null;
}

/** True when an identifier stands where only a type is read (`typeof x` included; a class's `extends` is a value). */
function inTypePosition(id: ts.Node): boolean {
  for (let n = id; n.parent !== undefined; n = n.parent) {
    const p = n.parent;
    if (ts.isExpressionWithTypeArguments(p) && ts.isHeritageClause(p.parent)) {
      return !(p.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(p.parent.parent));
    }
    if (ts.isTypeNode(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) return true;
  }
  return false;
}

const TYPE_ONLY_DECL = (e: Entry): boolean => ts.isInterfaceDeclaration(e.stmt) || ts.isTypeAliasDeclaration(e.stmt);

const isAssignOp = (k: ts.SyntaxKind): boolean =>
  k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;

/** True when an identifier is assigned where it stands: the left of `=` or a compound assignment, `++`/`--`, a
 *  target inside a destructuring assignment, or a `for … in/of` target. */
function isWritten(id: ts.Identifier): boolean {
  let n: ts.Node = id;
  for (let p = n.parent; p !== undefined; n = p, p = p.parent) {
    if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)
      || ts.isTypeAssertionExpression(p)) continue;
    // The elements of a literal: assigned only when the literal is itself a target (climb on to see).
    if (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p)
      || ts.isShorthandPropertyAssignment(p) || (ts.isPropertyAssignment(p) && p.initializer === n)) continue;
    if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) {
      return p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken;
    }
    if (ts.isForInStatement(p) || ts.isForOfStatement(p)) return p.initializer === n;
    // `x = …`, `x += …`, and a default inside a target (`[x = 1] = …`), which assigns x as well.
    if (ts.isBinaryExpression(p)) return p.left === n && isAssignOp(p.operatorToken.kind);
    return false;
  }
  return false;
}

/** The top-level bindings the given statements reference, each with whether any use reads it as a value. */
function usesIn(stmts: readonly ts.Node[], sf: ts.SourceFile, checker: ts.TypeChecker, byStmt: Map<ts.Node, Entry>):
  Map<string, Use> {
  const out = new Map<string, Use>();
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const sym = p !== undefined && ts.isShorthandPropertyAssignment(p) && p.name === n
        ? checker.getShorthandAssignmentValueSymbol(p) : checker.getSymbolAtLocation(n);
      for (const d of sym?.declarations ?? []) {
        const top = topStatementOf(d, sf);
        if (top === null) continue;
        let binding: Binding | null = null;
        if (ts.isImportDeclaration(top) || ts.isImportEqualsDeclaration(top)) binding = { kind: 'import', local: sym!.name, stmt: top };
        else { const e = byStmt.get(top); if (e?.kind === 'decl') binding = { kind: 'decl', name: sym!.name, entry: e }; }
        if (binding === null) continue;
        const key = binding.kind === 'import' ? `import:${binding.local}` : `decl:${binding.name}`;
        const value = !inTypePosition(n);
        const written = isWritten(n);
        const had = out.get(key);
        out.set(key, { binding, value: value || (had?.value ?? false), written: written || (had?.written ?? false) });
        break;
      }
    }
    ts.forEachChild(n, visit);
  };
  for (const s of stmts) visit(s);
  return out;
}

interface Edit { start: number; end: number; text: string }

function applyEdits(text: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let floor = Infinity;
  for (const e of sorted) {
    if (e.end > floor) throw new Error(`overlapping edits at ${e.start}`);
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

/** The start of the line after `pos`'s line end (the whole statement line goes with a removal). */
const lineAfter = (text: string, pos: number): number => {
  const nl = text.indexOf('\n', pos);
  return nl < 0 ? text.length : nl + 1;
};

/** An import or export line with some bindings dropped, or null when none is left. */
function rewriteBindings(stmt: ts.ImportDeclaration | ts.ExportDeclaration, sf: ts.SourceFile,
  keep: (el: ts.ImportSpecifier | ts.ExportSpecifier | 'default' | 'namespace') => boolean): string | null {
  const text = sf.text;
  const pieces: string[] = [];
  let named: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[] = [];
  let namedNode: ts.NamedImports | ts.NamedExports | undefined;
  let typeOnly = false;
  if (ts.isImportDeclaration(stmt)) {
    const c = stmt.importClause!;
    typeOnly = c.isTypeOnly;
    if (c.name && keep('default')) pieces.push(c.name.text);
    if (c.namedBindings && ts.isNamespaceImport(c.namedBindings) && keep('namespace')) pieces.push(c.namedBindings.getText(sf));
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) { namedNode = c.namedBindings; named = c.namedBindings.elements; }
  } else if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
    typeOnly = stmt.isTypeOnly;
    namedNode = stmt.exportClause;
    named = stmt.exportClause.elements;
  }
  const kept = named.filter((el) => keep(el));
  if (namedNode !== undefined && kept.length > 0) {
    if (kept.length === named.length) pieces.push(namedNode.getText(sf));
    else if (namedNode.getText(sf).includes('\n')) {
      const indent = /\n([ \t]*)\S/.exec(namedNode.getText(sf))?.[1] ?? '  ';
      pieces.push(`{\n${kept.map((el) => `${indent}${el.getText(sf)},`).join('\n')}\n}`);
    } else pieces.push(`{ ${kept.map((el) => el.getText(sf)).join(', ')} }`);
  }
  if (pieces.length === 0) return null;
  const head = ts.isImportDeclaration(stmt) ? 'import' : 'export';
  const from = stmt.moduleSpecifier ? ` from ${stmt.moduleSpecifier.getText(sf)}` : '';
  const attrs = stmt.attributes ? ` ${stmt.attributes.getText(sf)}` : '';
  const semi = text.slice(stmt.getStart(sf), stmt.end).trimEnd().endsWith(';') ? ';' : '';
  return `${head} ${typeOnly ? 'type ' : ''}${pieces.join(', ')}${from}${attrs}${semi}`;
}

/** Plans the move of `req.names` from `req.source` to `req.dest` over `program` (every file that may import the
 *  source; the source itself, and the destination when it exists). Pure: the caller writes `files`. */
export function planMove(req: MoveRequest, program: Tree): MovePlan {
  const { source, dest } = req;
  const plan: MovePlan = { files: new Map(), problems: [], moved: [], destUsesSource: [], sourceUsesDest: [], repointed: [], mentions: [] };
  const srcText = program.get(source);
  if (srcText === undefined) { plan.problems.push(`${source}: not in the program`); return plan; }
  if (source === dest) { plan.problems.push('the destination is the source'); return plan; }
  const { sf, checker } = bind(source, srcText);
  const m = model(source, srcText, sf);
  const byStmt = new Map(m.entries.map((e) => [e.stmt as ts.Node, e]));
  const lists = localExportLists(m);

  const movedEntries = new Set<Entry>();
  for (const name of req.names) {
    const es = m.decls.get(name);
    if (es === undefined) { plan.problems.push(`${name}: not a top-level declaration of ${source}`); continue; }
    for (const e of es) {
      if (e.isDefault) plan.problems.push(`${name}: a default export does not move`);
      else if (ts.isModuleDeclaration(e.stmt)) plan.problems.push(`${name}: a namespace does not move`);
      else if (ts.canHaveDecorators(e.stmt) && (ts.getDecorators(e.stmt)?.length ?? 0) > 0) plan.problems.push(`${name}: a decorated declaration does not move`);
      const others = e.names.filter((n) => !req.names.includes(n));
      if (others.length > 0) plan.problems.push(`${name}: its statement also declares ${others.join(', ')}; name every one`);
      movedEntries.add(e);
    }
    for (const l of lists) {
      for (const el of l.elements) {
        if ((el.propertyName ?? el.name).text === name && el.propertyName !== undefined) {
          plan.problems.push(`${name}: exported under another name (${el.name.text})`);
        }
      }
    }
  }
  if (plan.problems.length > 0) return plan;
  const moving = m.entries.filter((e) => movedEntries.has(e));
  const movedNames = new Set(moving.flatMap((e) => e.names));
  plan.moved = uniq(moving.flatMap((e) => e.names));
  const staying = m.entries.filter((e) => !movedEntries.has(e) && e.kind !== 'module');

  const destUses = usesIn(moving.map((e) => e.stmt), sf, checker, byStmt);
  const srcUses = usesIn(staying.map((e) => e.stmt), sf, checker, byStmt);
  const listed = new Set(lists.flatMap((l) => l.elements.map((el) => (el.propertyName ?? el.name).text)));
  const movedExported = plan.moved.filter((n) => (m.decls.get(n) ?? []).some((e) => e.exported) || listed.has(n));

  // What crosses the cut.
  const fromSource = [...destUses.values()].filter((u) => u.binding.kind === 'decl' && !movedNames.has(u.binding.name));
  const toSource = [...srcUses.values()].filter((u) => u.binding.kind === 'decl' && movedNames.has(u.binding.name));
  for (const u of destUses.values()) {
    if (u.binding.kind === 'import' && ts.isImportEqualsDeclaration(u.binding.stmt)) {
      plan.problems.push(`${u.binding.local}: an import-equals binding the moved code uses; move it by hand`);
    }
  }
  const nameOf = (u: Use): string => (u.binding.kind === 'decl' ? u.binding.name : u.binding.local);
  const destValue = fromSource.filter((u) => u.value && !TYPE_ONLY_DECL((u.binding as { entry: Entry }).entry)).map(nameOf);
  const srcValue = toSource.filter((u) => u.value && !TYPE_ONLY_DECL((u.binding as { entry: Entry }).entry)).map(nameOf);
  if (destValue.length > 0 && srcValue.length > 0) {
    plan.problems.push(`cycle: the destination uses ${destValue.join(', ')} from the source, and the source uses ${srcValue.join(', ')} from the destination`);
  }
  // An import is a read-only binding: a name assigned on the side that would import it cannot cross.
  for (const u of [...fromSource, ...toSource]) {
    if (u.written) plan.problems.push(`${nameOf(u)}: assigned on the other side of the cut, where it would be a read-only import; move it with the code that assigns it`);
  }
  plan.destUsesSource = fromSource.map(nameOf);
  plan.sourceUsesDest = toSource.map(nameOf);
  const needsExport = new Set([...toSource.map(nameOf), ...plan.moved.filter((n) => listed.has(n))]);

  // The destination.
  const destText = program.get(dest);
  const dm = destText === undefined ? null : model(dest, destText);
  const destBound = new Map<string, string>(); // local name -> `<resolved or bare spec>#<imported name>` or `decl`
  const allFiles = new Set(program.keys());
  if (dm !== null) {
    for (const n of dm.decls.keys()) destBound.set(n, 'decl');
    for (const e of dm.entries) {
      const s = e.stmt;
      if (!ts.isImportDeclaration(s) || !s.importClause) continue;
      const spec = specText(s.moduleSpecifier);
      const where = resolveSpec(dest, spec, allFiles) ?? spec;
      const c = s.importClause;
      if (c.name) destBound.set(c.name.text, `${where}#default`);
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) destBound.set(c.namedBindings.name.text, `${where}#*`);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const el of c.namedBindings.elements) destBound.set(el.name.text, `${where}#${(el.propertyName ?? el.name).text}`);
      }
    }
    for (const n of plan.moved) if (destBound.has(n)) plan.problems.push(`${n}: ${dest} already binds that name`);
  }
  const importLines: string[] = [];
  for (const e of m.entries) {
    const s = e.stmt;
    if (!ts.isImportDeclaration(s) || !s.importClause) continue;
    const spec = specText(s.moduleSpecifier);
    const where = resolveSpec(source, spec, allFiles) ?? spec;
    if (where === dest) continue; // the destination's own names: local there
    const used = (local: string): boolean => {
      if (!destUses.has(`import:${local}`)) return false;
      const had = destBound.get(local);
      if (had === undefined) return true;
      return false;
    };
    const clash = (local: string, imported: string): void => {
      const had = destBound.get(local);
      if (destUses.has(`import:${local}`) && had !== undefined && had !== `${where}#${imported}`) {
        plan.problems.push(`${local}: ${dest} binds it to something else`);
      }
    };
    const c = s.importClause;
    if (c.name) clash(c.name.text, 'default');
    if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) clash(c.namedBindings.name.text, '*');
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const el of c.namedBindings.elements) clash(el.name.text, (el.propertyName ?? el.name).text);
    const line = rewriteBindings(s, sf, (el) => (el === 'default' ? used(c.name!.text)
      : el === 'namespace' ? used((c.namedBindings as ts.NamespaceImport).name.text) : used(el.name.text)));
    if (line !== null) importLines.push(line.replace(s.moduleSpecifier.getText(sf), `'${rebase(spec, source, dest)}'`));
  }
  if (fromSource.length > 0) {
    const els = uniq(fromSource.map((u) => {
      const e = (u.binding as { entry: Entry }).entry;
      return `${!u.value || TYPE_ONLY_DECL(e) ? 'type ' : ''}${nameOf(u)}`;
    }));
    const allTypes = els.every((x) => x.startsWith('type '));
    importLines.push(allTypes ? `import type { ${els.map((x) => x.slice(5)).join(', ')} } from '${specFor(dest, source)}';`
      : `import { ${els.join(', ')} } from '${specFor(dest, source)}';`);
  }
  const regions = moving.map((e) => {
    let t = srcText.slice(e.start, e.end);
    if (!e.exported && e.names.some((n) => needsExport.has(n))) {
      const at = e.stmt.getStart(sf) - e.start;
      t = `${t.slice(0, at)}export ${t.slice(at)}`;
    }
    return t;
  });
  if (plan.problems.length > 0) return plan;
  let destOut: string;
  if (dm === null) {
    destOut = `${destHeader(source)}\n\n${importLines.length > 0 ? `${importLines.join('\n')}\n\n` : ''}${regions.join('\n\n')}\n`;
  } else {
    const edits: Edit[] = [];
    if (importLines.length > 0) {
      const imps = dm.entries.filter((e) => ts.isImportDeclaration(e.stmt) || ts.isImportEqualsDeclaration(e.stmt));
      const at = imps.length > 0 ? lineAfter(dm.text, imps[imps.length - 1]!.end) : (dm.entries[0]?.start ?? dm.text.length);
      edits.push({ start: at, end: at, text: `${importLines.join('\n')}\n${imps.length > 0 ? '' : '\n'}` });
    }
    // The marker in front of the appended regions makes the diff a move the verdict judges; it sets nothing else.
    destOut = `${applyEdits(dm.text, edits).trimEnd()}\n\n${destHeader(source)}\n\n${regions.join('\n\n')}\n`;
  }

  // The source.
  const srcEdits: Edit[] = moving.map((e) => ({ start: e.cut, end: e.end, text: '' }));
  // A declaration the destination now imports gains `export` where it stays, unless a local `export { … }` list already
  // exports it (a second export of one name is a module Node refuses).
  for (const e of uniq(fromSource.map((u) => (u.binding as { entry: Entry }).entry))) {
    if (e.exported) continue;
    const inList = e.names.filter((n) => listed.has(n));
    const needed = fromSource.filter((u) => (u.binding as { entry: Entry }).entry === e).map(nameOf);
    if (inList.length === 0) srcEdits.push({ start: e.stmt.getStart(sf), end: e.stmt.getStart(sf), text: 'export ' });
    else if (!needed.every((n) => listed.has(n))) {
      plan.problems.push(`${needed.join(', ')}: its statement is exported through a local export list in part; export it by hand first`);
    }
  }
  if (plan.problems.length > 0) return plan;
  let lastImportLine = -1;
  for (const e of m.entries) {
    const s = e.stmt;
    if (ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s)) lastImportLine = lineAfter(srcText, e.end);
    if (!ts.isImportDeclaration(s) || !s.importClause) continue;
    const c = s.importClause;
    const drop = (local: string): boolean => destUses.has(`import:${local}`) && !srcUses.has(`import:${local}`) && !listed.has(local);
    const locals = [c.name?.text, c.namedBindings && ts.isNamespaceImport(c.namedBindings) ? c.namedBindings.name.text : undefined,
      ...(c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.map((el) => el.name.text) : [])]
      .filter((x): x is string => x !== undefined);
    if (!locals.some(drop)) continue;
    const line = rewriteBindings(s, sf, (el) => (el === 'default' ? !drop(c.name!.text)
      : el === 'namespace' ? !drop((c.namedBindings as ts.NamespaceImport).name.text) : !drop(el.name.text)));
    srcEdits.push(line === null ? { start: s.getStart(sf), end: lineAfter(srcText, e.end), text: '' }
      : { start: s.getStart(sf), end: s.end, text: line });
  }
  for (const l of lists) {
    if (!l.elements.some((el) => movedNames.has(el.name.text))) continue;
    const s = l.entry.stmt as ts.ExportDeclaration;
    const line = rewriteBindings(s, sf, (el) => typeof el === 'string' || !movedNames.has(el.name.text));
    srcEdits.push(line === null ? { start: s.getStart(sf), end: lineAfter(srcText, s.end), text: '' } : { start: s.getStart(sf), end: s.end, text: line });
  }
  if (toSource.length > 0) {
    const els = uniq(toSource.map((u) => `${!u.value || TYPE_ONLY_DECL((u.binding as { entry: Entry }).entry) ? 'type ' : ''}${nameOf(u)}`));
    const allTypes = els.every((x) => x.startsWith('type '));
    const line = allTypes ? `import type { ${els.map((x) => x.slice(5)).join(', ')} } from '${specFor(source, dest)}';`
      : `import { ${els.join(', ')} } from '${specFor(source, dest)}';`;
    const at = lastImportLine >= 0 ? lastImportLine : (m.entries.find((e) => !movedEntries.has(e))?.start ?? srcText.length);
    srcEdits.push({ start: at, end: at, text: `${line}\n${lastImportLine >= 0 ? '' : '\n'}` });
  }
  const srcOut = applyEdits(srcText, srcEdits).replace(/^\n+/, '');

  // The importers.
  const stem = path.basename(source).replace(/\.(?:ts|tsx|mts|mjs)$/, '');
  const exportedMoved = new Set(movedExported);
  const out = new Map<string, string>([[source, srcOut], [dest, destOut]]);
  for (const [f, text] of [...program].sort(([a], [b]) => a.localeCompare(b))) {
    if (f === source || !isCodeFile(f) || !text.includes(stem)) continue;
    const isf = parse(f, text);
    const edits: Edit[] = [];
    const isSpecifier = new Set<ts.Node>();
    for (const s of isf.statements) {
      if (!((ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier)) continue;
      isSpecifier.add(s.moduleSpecifier);
      const spec = specText(s.moduleSpecifier);
      if (resolveSpec(f, spec, allFiles) !== source) continue;
      const destSpec = specFor(f, dest, spec);
      const after = lineAfter(text, s.end);
      if (ts.isImportDeclaration(s) && s.importClause?.namedBindings && ts.isNamespaceImport(s.importClause.namedBindings)) {
        const ns = s.importClause.namedBindings.name;
        const used = new Set<string>();
        const escapes: number[] = [];
        const strings = new Set<string>();
        const walk = (n: ts.Node): void => {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) strings.add(n.text);
          if (ts.isIdentifier(n) && n.text === ns.text && n !== ns) {
            const p = n.parent;
            if (ts.isPropertyAccessExpression(p) && p.expression === n) { if (exportedMoved.has(p.name.text)) used.add(p.name.text); }
            else if (ts.isQualifiedName(p) && p.left === n) { if (exportedMoved.has(p.right.text)) used.add(p.right.text); }
            else if (ts.isElementAccessExpression(p) && p.expression === n && ts.isStringLiteralLike(p.argumentExpression)) {
              if (exportedMoved.has(p.argumentExpression.text)) used.add(p.argumentExpression.text);
            } else escapes.push(isf.getLineAndCharacterOfPosition(n.getStart(isf)).line + 1);
          }
          ts.forEachChild(n, walk);
        };
        walk(isf);
        // The namespace object passed on as a value (`vi.spyOn(ns, 'f')`, `Object.keys(ns)`): a moved name the file
        // spells as a string is a use; otherwise the escape is reported.
        if (escapes.length > 0) for (const n of exportedMoved) if (strings.has(n)) used.add(n);
        if (used.size > 0) plan.problems.push(`${f}: a namespace import of ${source} uses ${[...used].sort().join(', ')}; repoint it by hand first`);
        else for (const l of uniq(escapes)) plan.mentions.push(`${f}:${l}`);
        continue;
      }
      if (ts.isExportDeclaration(s) && s.exportClause === undefined) {
        if (movedExported.length > 0) edits.push({ start: after, end: after, text: `export { ${movedExported.join(', ')} } from '${destSpec}';\n` });
        continue;
      }
      const els = ts.isImportDeclaration(s)
        ? (s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings) ? s.importClause.namedBindings.elements : [])
        : (s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements : []);
      const going = els.filter((el) => exportedMoved.has((el.propertyName ?? el.name).text));
      if (going.length === 0) continue;
      const line = rewriteBindings(s, isf, (el) => typeof el === 'string' || !going.includes(el));
      edits.push(line === null ? { start: s.getStart(isf), end: after, text: '' } : { start: s.getStart(isf), end: s.end, text: line });
      if (f !== dest) {
        const head = ts.isImportDeclaration(s) ? `import ${s.importClause!.isTypeOnly ? 'type ' : ''}` : `export ${s.isTypeOnly ? 'type ' : ''}`;
        edits.push({ start: after, end: after, text: `${head}{ ${going.map((el) => el.getText(isf)).join(', ')} } from '${destSpec}';\n` });
      }
    }
    const visit = (n: ts.Node): void => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !isSpecifier.has(n)) {
        const v = n.text;
        if (resolveSpec(f, v, allFiles) === source || v.endsWith(`/${path.basename(source)}`) || v === path.basename(source)) {
          plan.mentions.push(`${f}:${isf.getLineAndCharacterOfPosition(n.getStart(isf)).line + 1}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(isf);
    if (edits.length === 0) continue;
    if (f === dest) { plan.problems.push(`${dest}: imports moved names from ${source}; drop those imports first`); continue; }
    try {
      out.set(f, applyEdits(text, edits));
      plan.repointed.push(f);
    } catch (e) {
      plan.problems.push(`${f}: ${(e as Error).message}; repoint it by hand`);
    }
  }
  if (plan.problems.length === 0) plan.files = out;
  return plan;
}

// ---- Preflight ----

export interface Hunk { start: number; count: number }

/** The old side of each hunk of a `git diff -U0`: its first line and how many lines (0 for a pure insertion, which
 *  goes in after line `start`). */
export function parseHunks(diff: string): Hunk[] {
  return [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+/gm)].map((x) => ({ start: Number(x[1]), count: x[2] === undefined ? 1 : Number(x[2]) }));
}

/** The declarations of `text` that a hunk falls in: an edited line inside a region (its lead comments included), or an
 *  insertion after a line of a region that is not its last. */
export function touchedDeclarations(text: string, file: string, hunks: readonly Hunk[]): string[] {
  const m = model(file, text);
  const line = (pos: number): number => m.sf.getLineAndCharacterOfPosition(pos).line + 1;
  const out = new Set<string>();
  for (const e of m.entries) {
    if (e.kind !== 'decl') continue;
    const a = line(e.start);
    const b = line(Math.max(e.start, e.end - 1));
    for (const h of hunks) {
      const hit = h.count > 0 ? h.start <= b && h.start + h.count - 1 >= a : h.start >= a && h.start < b;
      if (hit) for (const n of e.names) out.add(n);
    }
  }
  return [...out].sort();
}

const RING_PACKAGE = /^(server|pwa)\/src\/(.+)$/;

/** A `server/src` or `pwa/src` file's context by the spec's ring-context-map table, or null when no row reaches it. */
export function contextOf(rows: readonly ContextRow[], file: string): string | null {
  const m = RING_PACKAGE.exec(file);
  if (m === null) return null;
  return assignContexts(m[1] as Pkg, [m[2]!], rows).context.get(m[2]!) ?? null;
}

/** One open pull request's head, as the caller writes it: a move PR names its source and destinations. */
export interface OpenHead { pr: number; head: string; move?: { source: string; dests: readonly string[] } }

export interface PreflightInput {
  source: string;
  dests: readonly string[];
  names: readonly string[];
  heads: readonly OpenHead[];
  /** The declarations of `source` each head's diff touches (`touchedDeclarations`). */
  touched: ReadonlyMap<number, readonly string[]>;
  contextOf: (file: string) => string | null;
  /** The slice's own pull request, skipped. */
  self?: number;
  /** Heads whose diff could not be read: refused, never assumed clear. */
  unreadable?: readonly number[];
}

export interface PreflightVerdict { ok: boolean; slots: string[]; refusals: string[] }

/** Spec §4: a slice takes the context slot of every destination module, and refuses while another file's open move PR
 *  holds one; a file has one open move PR at a time; a slice yields to any open PR with a hunk in a moved declaration. */
export function preflightVerdict(i: PreflightInput): PreflightVerdict {
  const refusals: string[] = [];
  const slots = new Set<string>();
  for (const d of i.dests) {
    const c = i.contextOf(d);
    if (c === null) refusals.push(`unmapped ${d}`);
    else slots.add(c);
  }
  for (const h of i.heads) {
    if (h.pr === i.self) continue;
    if (i.unreadable?.includes(h.pr)) { refusals.push(`unreadable #${h.pr}`); continue; }
    if (h.move !== undefined) {
      if (h.move.source === i.source) refusals.push(`file-has-open-move #${h.pr}`);
      else {
        const theirs = new Set(h.move.dests.map(i.contextOf));
        for (const s of [...slots].sort()) if (theirs.has(s)) refusals.push(`slot-held ${s} #${h.pr}`);
      }
    }
    const t = i.touched.get(h.pr) ?? [];
    for (const n of i.names) if (t.includes(n)) refusals.push(`touched #${h.pr} ${n}`);
  }
  return { ok: refusals.length === 0, slots: [...slots].sort(), refusals };
}

// ---- The base a run judges against, and a branch's verdict ----

/** The sha a run judges a move against: the merge queue's base in a `merge_group` run (the base `ci.yml` uses, so an
 *  entry ahead in the queue is not counted as part of the move), else `merge-base(origin/main, HEAD)`. Throws when
 *  neither can be read. */
export function moveBase(env: NodeJS.ProcessEnv, root: string): string {
  if (env.GITHUB_EVENT_NAME === 'merge_group' && env.GITHUB_EVENT_PATH) {
    const ev = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as { merge_group?: { base_sha?: unknown } };
    const sha = ev.merge_group?.base_sha;
    if (typeof sha === 'string' && sha !== '') return sha;
  }
  return gitRead(['merge-base', 'origin/main', 'HEAD'], root).trim();
}

const CODE_PATHS = ['*.ts', '*.tsx', '*.mts', '*.mjs'];

/** True when the diff `baseSha..headRef` adds a marker line to a code file: one `git diff`, so a pull request that
 *  moves nothing costs the pin one git call. */
export function addsMoveMarker(root: string, baseSha: string, headRef: string): boolean {
  return MARK_ADDED.test(gitRead(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', baseSha, headRef, '--', ...CODE_PATHS], root));
}

/** The pure-move verdict of `baseSha..headRef` in `root`; null when the diff adds no marker line (`destHeader`). The
 *  importers it resolves are the head files whose text names a file a declaration moved out of as a relative path. */
export function branchVerdict(root: string, baseSha: string, headRef: string): MoveVerdict | null {
  if (!addsMoveMarker(root, baseSha, headRef)) return null;
  const changed = changedFiles(baseSha, headRef, root).filter(isCodeFile);
  const base = new Map<string, string>();
  const head = new Map<string, string>();
  for (const f of changed) {
    const b = fileAt(f, baseSha, root);
    const h = fileAt(f, headRef, root);
    if (b !== null) base.set(f, b);
    if (h !== null) head.set(f, h);
  }
  const first = pureMoveVerdict(base, head);
  if (first === null) return null;
  const sources = uniq([...first.moved.map((m) => m.from),
    ...first.differing.filter((d) => d.startsWith('surface:')).map((d) => d.slice('surface:'.length).split('#')[0]!)]);
  if (sources.length === 0) return first;
  const stems = uniq(sources.map((f) => path.basename(f).replace(/\.(?:ts|tsx|mts|mjs)$/, '')));
  const importers = new Map<string, string>();
  let listed = '';
  try {
    listed = gitRead(['grep', '-l', '-F', ...stems.flatMap((s) => ['-e', `/${s}.`, '-e', `/${s}'`, '-e', `/${s}"`]),
      headRef, '--', ...CODE_PATHS], root);
  } catch { /* no match: git grep exits 1 */ }
  for (const row of listed.split('\n').filter(Boolean)) {
    const f = row.slice(headRef.length + 1);
    if (head.has(f) || !isCodeFile(f)) continue;
    const t = fileAt(f, headRef, root);
    if (t !== null) importers.set(f, t);
  }
  return pureMoveVerdict(base, head, importers);
}
