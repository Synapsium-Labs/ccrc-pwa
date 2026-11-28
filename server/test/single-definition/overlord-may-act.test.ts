// THE DECIDER'S ONE DOOR AND ITS ONE MINTER (Overlord W2, the act catalogue B; plan
// `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md` Tasks B3 and B4, F5, F9; the coordinator's items 3 and 4).
//
// - The importer census: no `server/src` file but `overlordMayActW2.ts` imports the decider, `grantCovers`, `GrantFact` or
//   `CommandFact`, or re-exports the module whole; no file, the wrapper included, re-exports anything of it, whether from the
//   decider's file (`export … from`) or as a local export of a binding it imported from there (review 4224 F1); the decider's
//   file is imported by exactly the files `MAY_ACT_IMPORTERS` names, each for the names its row allows; and `overlordMayActW2.ts` is imported by exactly `W2_IMPORTERS` (none yet: its callers
//   come with later pieces, each adding its row in its own pull request). W3 lifts the census when it replaces the wrapper.
// - The allow's census: a `MayActAllow` is made only by `mintMayActAllow` in the decider's file. Outside that function no
//   `server/src` file casts to it, asserts it, `satisfies` it, writes a literal annotated with it, spreads an allow, copies one
//   with `Object.assign` or `structuredClone`, names the brand or adds to the registry. A forgery that slips past this text census
//   still fails `isMayActAllow` at run time, which the decider's suite holds.
// - The strengths' order has one home: `CALLER_STRENGTH_RANK` in `shared/overlord-identity.ts`, derived from its one list; no
//   source file writes a strength's rank by hand.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL, ccrcRoot, rel } from './helpers.js';
import { parseSource, ts, type ImportEdge } from '../scan/parse.js';

const DECIDER = 'server/src/coord/overlordMayAct.ts';
const W2 = 'server/src/coord/overlordMayActW2.ts';
/** The decider's importers, each with the names it may import (`'any'` for the W2 wrapper alone). */
export const MAY_ACT_IMPORTERS: Readonly<Record<string, 'any' | readonly string[]>> = {
  [W2]: 'any',
  'server/src/coord/overlordPolicy.ts': ['MayActAllow'],
};
/** `overlordMayActW2.ts`'s importers: none until a door calls it. */
export const W2_IMPORTERS: readonly string[] = [];
const ONLY_W2 = new Set(['overlordMayAct', 'grantCovers', 'GrantFact', 'CommandFact', '*']);

/** The repository path an import's relative specifier names, `.js` read as `.ts`; `null` for a package. */
function target(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)).replace(/\.js$/, '.ts');
}

/** Every problem with one file's imports of the decider and of the wrapper. */
export function importerProblems(file: string, imports: readonly ImportEdge[]): { problems: string[]; decider: boolean; w2: boolean } {
  const problems: string[] = [];
  let decider = false;
  let w2 = false;
  for (const e of imports) {
    const t = target(file, e.specifier);
    if (t === W2) w2 = true;
    if (t !== DECIDER) continue;
    decider = true;
    // No file re-exports the decider, the wrapper included: a door importing the wrapper (matched by file) would otherwise reach
    // the decider through it (review 4213 F8).
    if (e.kind === 'export-from') problems.push(`${file} re-exports ${e.names.length === 0 ? 'the whole module' : e.names.join(', ')} from the decider; no file may`);
    const row = MAY_ACT_IMPORTERS[file];
    if (row === 'any') continue;
    const names = e.names.length === 0 || e.kind === 'dynamic' || e.kind === 'type-query' ? ['*'] : e.names;
    for (const n of names) {
      if (ONLY_W2.has(n)) problems.push(`${file} imports ${n === '*' ? 'the whole module' : n} from the decider; only ${W2} may`);
      else if (row === undefined) problems.push(`${file} imports ${n} from the decider and has no MAY_ACT_IMPORTERS row`);
      else if (!row.includes(n)) problems.push(`${file} imports ${n} from the decider; its row allows [${row.join(', ')}]`);
    }
  }
  return { problems, decider, w2 };
}

/** Every local re-export, in one file, of a binding it imported from the decider (review 4224 F1): a named export of the
 *  binding (under its name or another), a default export of it, an exported constant whose value is it (through parentheses,
 *  a cast or a namespace member), a local alias of it exported later, and an exported type that is it. A function that calls
 *  the decider, or a type built from its facts, is not one. Read from the syntax tree here, so the shared parser is unchanged. */
export function localReexportProblems(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bound = new Set<string>();
  const spaces = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || target(file, st.moduleSpecifier.text) !== DECIDER) continue;
    const c = st.importClause;
    if (c === undefined) continue;
    if (c.name !== undefined) bound.add(c.name.text);
    const nb = c.namedBindings;
    if (nb !== undefined && ts.isNamespaceImport(nb)) spaces.add(nb.name.text);
    else if (nb !== undefined) for (const el of nb.elements) bound.add(el.name.text);
  }
  if (bound.size === 0 && spaces.size === 0) return [];
  const unwrap = (e: ts.Expression): ts.Expression => {
    let x = e;
    while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isNonNullExpression(x)
      || ts.isTypeAssertionExpression(x)) x = x.expression;
    return x;
  };
  /** The decider's binding an expression is, or `null`. */
  const named = (e: ts.Expression): string | null => {
    const x = unwrap(e);
    if (ts.isIdentifier(x) && (bound.has(x.text) || spaces.has(x.text))) return x.text;
    if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && spaces.has(x.expression.text)) return x.getText(sf);
    return null;
  };
  const isExported = (n: ts.Node): boolean =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword);
  // A local alias (`const d = overlordMayAct`) is a binding of the decider too.
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer !== undefined && named(d.initializer) !== null) bound.add(d.name.text);
    }
  }
  const problems: string[] = [];
  const at = (n: ts.Node): string => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const say = (n: ts.Node, what: string): void => { problems.push(`${at(n)}: exports ${what} from the decider; no file may`); };
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && st.moduleSpecifier === undefined && st.exportClause !== undefined && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const local = (el.propertyName ?? el.name).getText(sf);
        if (bound.has(local) || spaces.has(local)) say(el, local);
      }
    } else if (ts.isExportAssignment(st) && named(st.expression) !== null) {
      say(st, named(st.expression)!);
    } else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        const n = d.initializer === undefined ? null : named(d.initializer);
        if (n !== null) say(d, n);
      }
    } else if (ts.isTypeAliasDeclaration(st) && isExported(st) && ts.isTypeReferenceNode(st.type)) {
      const t = st.type.typeName;
      const name = ts.isIdentifier(t) ? t.text : ts.isIdentifier(t.left) && spaces.has(t.left.text) ? t.getText(sf) : null;
      if (name !== null && (bound.has(name) || name.includes('.'))) say(st, name);
    }
  }
  return problems;
}

const ALLOWISH = /(?:^|\.)\w*[aA]llow$/;
/** Every problem with how one file makes or copies an allow. In the decider's file, the one minter's body is exempt. */
export function allowProblems(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  let mintSpan: readonly [number, number] | null = null;
  const at = (n: ts.Node): string => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const inMint = (n: ts.Node): boolean => file === DECIDER && mintSpan !== null && n.getStart(sf) >= mintSpan[0] && n.getEnd() <= mintSpan[1];
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'mintMayActAllow' && file === DECIDER) mintSpan = [n.getStart(sf), n.getEnd()];
    if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n)) && /\bMayActAllow\b/.test(n.type.getText(sf)) && !inMint(n)) {
      problems.push(`${at(n)}: a cast to MayActAllow`);
    }
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isPropertyDeclaration(n)) && n.type !== undefined && /\bMayActAllow\b/.test(n.type.getText(sf))
      && n.initializer !== undefined && ts.isObjectLiteralExpression(n.initializer)) {
      problems.push(`${at(n)}: a literal of MayActAllow`);
    }
    if ((ts.isSpreadAssignment(n) || ts.isSpreadElement(n)) && ALLOWISH.test(n.expression.getText(sf)) && !inMint(n)) {
      problems.push(`${at(n)}: a spread of an allow`);
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if ((callee === 'Object.assign' || callee === 'structuredClone') && n.arguments.some((a) => ALLOWISH.test(a.getText(sf)))) {
        problems.push(`${at(n)}: ${callee} over an allow`);
      }
    }
    if (ts.isIdentifier(n) && (n.text === 'mayActAllowBrand' || n.text === 'mintedAllows') && file !== DECIDER) {
      problems.push(`${at(n)}: names the allow's ${n.text === 'mintedAllows' ? 'registry' : 'brand'}`);
    }
    if (ts.isCallExpression(n) && n.expression.getText(sf) === 'mintedAllows.add' && file === DECIDER && !inMint(n)) {
      problems.push(`${at(n)}: adds to the registry outside the one minter`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return problems;
}

const SERVER_SRC = ALL.filter((f) => rel(f).startsWith('server/src/'));
/** The weakest strength given a number: a rank written by hand (`operator: 2` alone is too common a key to scan for). */
const RANK_BY_HAND = /\battributed\s*:\s*\d/;

describe('overlordMayAct has one door (the coordinator\'s items 3 and 4)', () => {
  const scans = SERVER_SRC.map((f) => ({ file: rel(f), ...importerProblems(rel(f), parseSource(readFileSync(f, 'utf8'), f).imports) }));

  it('no server/src file but the wrapper imports the decider, grantCovers, GrantFact or CommandFact, and each importer keeps to its row', () => {
    expect(scans.flatMap((s) => s.problems)).toEqual([]);
  });
  it('the decider\'s importers are exactly MAY_ACT_IMPORTERS', () => {
    expect(scans.filter((s) => s.decider).map((s) => s.file).sort()).toEqual(Object.keys(MAY_ACT_IMPORTERS).sort());
  });
  it('the wrapper\'s importers are exactly W2_IMPORTERS: nothing calls it yet', () => {
    expect(scans.filter((s) => s.w2).map((s) => s.file).sort()).toEqual([...W2_IMPORTERS].sort());
  });

  const F = 'server/src/coord/planted.ts';
  const CONTROLS: readonly [string, string, RegExp | null][] = [
    ['a second importer of the decider', "import { overlordMayAct } from './overlordMayAct.js';", /imports overlordMayAct from the decider; only/],
    ['a second importer of a dormant type', "import type { GrantFact } from './overlordMayAct.js';", /imports GrantFact/],
    ['a whole-module re-export', "export * from './overlordMayAct.js';", /the whole module/],
    ['a dynamic import', "const m = await import('./overlordMayAct.js');", /the whole module/],
    ['a type name with no row', "import type { MayActAnswer } from './overlordMayAct.js';", /has no MAY_ACT_IMPORTERS row/],
    ['an import of another module', "import { actRow } from '../../../shared/overlord.js';", null],
  ];
  it.each(CONTROLS)('CONTROL: %s', (_name, src, red) => {
    const { problems, decider } = importerProblems(F, parseSource(src, 'planted.ts').imports);
    if (red === null) { expect(problems).toEqual([]); expect(decider).toBe(false); }
    else expect(problems.some((p) => red.test(p)), problems.join('\n')).toBe(true);
  });
  it('CONTROL: the wrapper re-exports nothing of the decider: a planted re-export in its own file is refused (review 4213 F8)', () => {
    for (const src of ["export { overlordMayAct } from './overlordMayAct.js';", "export type { GrantFact } from './overlordMayAct.js';",
      "export * from './overlordMayAct.js';"]) {
      const { problems } = importerProblems(W2, parseSource(src, 'overlordMayActW2.ts').imports);
      expect(problems.some((p) => /re-exports .* from the decider/.test(p)), `${src}\n${problems.join('\n')}`).toBe(true);
    }
  });
  const IMPORT = "import { overlordMayAct } from './overlordMayAct.js';\n";
  const LOCAL_REEXPORTS: readonly [string, string][] = [
    ['a named export of the imported binding', `${IMPORT}export { overlordMayAct };`],
    ['the binding exported under another name', `${IMPORT}export { overlordMayAct as decide };`],
    ['a constant assigned from it', `${IMPORT}export const decide = overlordMayAct;`],
    ['a constant assigned from it through a cast', `${IMPORT}export const decide = (overlordMayAct as typeof overlordMayAct);`],
    ['a default export of it', `${IMPORT}export default overlordMayAct;`],
    ['a local alias, then a named export', `${IMPORT}const d = overlordMayAct;\nexport { d };`],
    ['a member of a namespace import', "import * as m from './overlordMayAct.js';\nexport const decide = m.overlordMayAct;"],
    ['the namespace itself', "import * as m from './overlordMayAct.js';\nexport { m };"],
    ['a type exported under another name', "import type { GrantFact } from './overlordMayAct.js';\nexport type G = GrantFact;"],
    ['a type named in an export list', "import type { GrantFact } from './overlordMayAct.js';\nexport type { GrantFact };"],
  ];
  it.each(LOCAL_REEXPORTS)('CONTROL: a local re-export in the wrapper is refused, %s (review 4224 F1)', (_name, src) => {
    expect(localReexportProblems(W2, src).some((p) => /exports .* from the decider/.test(p)), src).toBe(true);
  });
  it('CONTROL: the wrapper\'s own shape, a function that calls the decider and a type built from its facts, is not a re-export', () => {
    const own = `${IMPORT}import type { MayActFacts } from './overlordMayAct.js';\n`
      + 'export interface G { readonly caller: MayActFacts[\'caller\'] }\n'
      + 'export function mayActW2(): string { return typeof overlordMayAct; }\nexport const N = 1;';
    expect(localReexportProblems(W2, own)).toEqual([]);
    expect(localReexportProblems(F, "import { actRow } from '../../../shared/overlord.js';\nexport { actRow };")).toEqual([]);
  });
  it('no server/src file re-exports a binding it imported from the decider (review 4224 F1)', () => {
    expect(SERVER_SRC.flatMap((f) => localReexportProblems(rel(f), readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('CONTROL: a planted importer of the wrapper is seen', () => {
    expect(importerProblems(F, parseSource("import { mayActW2 } from './overlordMayActW2.js';", 'planted.ts').imports).w2).toBe(true);
  });
  it('CONTROL: the policy port may import the allow\'s type, and nothing else', () => {
    const P = 'server/src/coord/overlordPolicy.ts';
    expect(importerProblems(P, parseSource("import type { MayActAllow } from './overlordMayAct.js';", 'p.ts').imports).problems).toEqual([]);
    expect(importerProblems(P, parseSource("import { isMayActAllow } from './overlordMayAct.js';", 'p.ts').imports).problems)
      .toEqual([`${P} imports isMayActAllow from the decider; its row allows [MayActAllow]`]);
  });
});

describe('a MayActAllow is made only by its one minter (F5, the coordinator\'s item 4)', () => {
  it('no server/src file casts, asserts, spreads, copies or writes a literal of an allow, or names its brand or registry', () => {
    expect(SERVER_SRC.flatMap((f) => allowProblems(rel(f), readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('the minter exists in the decider\'s file, holds the one cast and the one registry add', () => {
    const text = readFileSync(path.join(ccrcRoot, DECIDER), 'utf8');
    expect(text.match(/function mintMayActAllow\(/g)).toHaveLength(1);
    expect(text.match(/\bas MayActAllow\b/g)).toHaveLength(1);
    expect(text.match(/mintedAllows\.add\(/g)).toHaveLength(1);
  });

  const F = 'server/src/coord/planted.ts';
  const CONTROLS: readonly [string, string, string, RegExp][] = [
    ['a cast', F, 'const a = {} as MayActAllow;', /a cast to MayActAllow/],
    ['a double cast', F, 'const a = x as unknown as MayActAllow;', /a cast to MayActAllow/],
    ['an assertion', F, 'const a = <MayActAllow>x;', /a cast to MayActAllow/],
    ['a satisfies', F, 'const a = x satisfies MayActAllow;', /a cast to MayActAllow/],
    ['a literal', F, "const a: MayActAllow = { word: 'allow' };", /a literal of MayActAllow/],
    ['a spread', F, 'const b = { ...a.allow, naturalKey: "k" };', /a spread of an allow/],
    ['a spread of a named allow', F, 'const b = { ...theAllow };', /a spread of an allow/],
    ['an Object.assign', F, 'Object.assign(target, allow);', /Object.assign over an allow/],
    ['a structuredClone', F, 'const b = structuredClone(allow);', /structuredClone over an allow/],
    ['the brand named', F, 'type T = { [mayActAllowBrand]: true };', /names the allow's brand/],
    ['a second registry add', F, 'mintedAllows.add(x);', /names the allow's registry/],
    ['a cast in the decider outside the minter', DECIDER, 'function other() { return {} as MayActAllow; }', /a cast to MayActAllow/],
    ['a registry add in the decider outside the minter', DECIDER, 'function other(x: object) { mintedAllows.add(x); }', /adds to the registry outside/],
  ];
  it.each(CONTROLS)('CONTROL: %s is red', (_name, file, src, red) => {
    const problems = allowProblems(file, src);
    expect(problems.some((p) => red.test(p)), problems.join('\n')).toBe(true);
  });
  it('CONTROL: the minter\'s own cast and add are not red', () => {
    const src = 'function mintMayActAllow(f: F): MayActAllow { const allow = Object.freeze({ ...f }) as MayActAllow; mintedAllows.add(allow); return allow; }';
    expect(allowProblems(DECIDER, src)).toEqual([]);
  });
});

describe('the strengths\' order has one home', () => {
  it('CALLER_STRENGTH_RANK is defined only in shared/overlord-identity.ts, and no source file ranks a strength by hand', () => {
    const holders = ALL.filter((f) => /\bCALLER_STRENGTH_RANK\s*[:=]/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(holders).toEqual(['shared/overlord-identity.ts']);
    expect(ALL.filter((f) => RANK_BY_HAND.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });
  it('CONTROL: a rank written by hand is red', () => {
    expect(RANK_BY_HAND.test('const RANK = { attributed: 0, workload: 1, operator: 2 };')).toBe(true);
    expect(RANK_BY_HAND.test('const counts = { unattributed: 0 };')).toBe(false);
  });
});
