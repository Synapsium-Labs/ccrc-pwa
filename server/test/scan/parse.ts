/**
 * D-5853 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0f; ARCH-00 (#525); spec
 * 2026-10-19-ccrc-consolidation-wave-design.md §8, rev 2.2). The ONE TypeScript parser the server's test scanners use.
 *
 * The server builds with TypeScript 7, whose package exports no `createSourceFile` (only `typescript/unstable/*`). The
 * operator chose (2026-10-20, OA-C1, option (a)) the stable, documented TypeScript 6 compiler API, installed as the
 * dev-only alias `typescript-api` and pinned EXACTLY in `server/package.json`: the server's TypeScript bumps
 * cannot change what a scanner sees, and a new parser version needs a reviewed PR. Tests only: nothing under
 * `server/src` imports it, and this file is its one importer (`single-definition.test.ts`, the ARCH-40 describe). A
 * later swap of the parser touches this file alone.
 *
 * Syntax only, except ONE typed walk: import-edge and symbol rules need no type checker, but the store census
 * (`storeReach`, D-7578) does, because a value's type, not its text, decides whether it is the store, a port of it or
 * a carrier of it, and which implementation a call through a function-typed value reaches; it builds its own program
 * from a tsconfig (memoized, one per process) or from fixture sources.
 * D-5854 (Task C0g; ARCH-06 (#554)) adds `calls` and `bindings`, which `scan/symbols.ts` (`callsIn`) and the literal
 * source-pin ratchet (`single-definition.test.ts`, the ARCH-40 describe) read, so neither imports the parser.
 * KNOWN WIDTH: a file that does not parse yields what the parser recovered (no throw); a computed member name, an
 * object-literal method and a function bound through `as`, a call or parentheses are not symbols; an alias exported
 * by a later `export { X }` is not an exported type alias; `require(…)` calls are not import edges; a `Record<X, true>`
 * counts only as a variable's annotation or a `satisfies` type, and only with `X` named bare (D-6048).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript-api';

/** One module edge: an `import`, an `export … from`, an `import x = require(…)`, a literal `import(…)` or a type
 *  query `import('…').T` / `typeof import('…')`, always type-only (D-6045: ARCH-04's ring rules see a type reached
 *  that way as they see an `import type`). */
export interface ImportEdge {
  specifier: string;
  kind: 'import' | 'export-from' | 'import-equals' | 'dynamic' | 'type-query';
  /** `import type …`, `export type … from`, `import type x = require(…)`. A per-name `type` leaves this false. */
  typeOnly: boolean;
  /** The bound names: `default` as its local name, a namespace as `* as x`, named ones by their imported name. */
  names: string[];
  /** The named ones bound with a per-name `type` (`import { type A, b }` → `['A']`), for an `import` or an
   *  `export … from`; absent on the other kinds. An edge whose every name is here binds no value (D-6045, stage 2). */
  typeNames?: string[];
  /** 1-based. */
  line: number;
}

/** An exported top-level `type X = …`. `literals` holds a literal union's members (string, number or boolean, as
 *  text), and is `null` for any other type. */
export interface TypeAlias {
  name: string;
  literals: string[] | null;
  line: number;
}

export type SymbolKind = 'function' | 'class' | 'method' | 'constructor' | 'getter' | 'setter' | 'arrow-property'
  | 'variable-function';

/** A named code unit, keyed by its qualified name (`Class.method`, `outer.inner`). `start`/`end` are offsets into the
 *  text, from its first token to its last; `line`/`endLine` are 1-based. */
export interface SymbolSpan {
  name: string;
  kind: SymbolKind;
  start: number;
  end: number;
  line: number;
  endLine: number;
}

/** One argument of a call: a string (a plain or no-substitution template literal, by its value), a regex literal (by
 *  its source text, slashes and flags included), or anything else (by its source text). */
export interface CallArg {
  kind: 'string' | 'regex' | 'other';
  text: string;
}

/** A call expression (`f(…)`, `a.b(…)`, `expect(x).not.toContain(…)`; not `new`, not `import(…)`), in source order.
 *  `callee` is the callee's text with each line break and its indentation removed; `name` its rightmost identifier
 *  (`null` for an element access or a call of a call); `head` the leftmost identifier of its chain (`src` for
 *  `src.slice(1).indexOf`, `expect` for `expect(a).not.toContain`); `headArgs` the argument texts when that head is
 *  itself called (`expect(a, 'm')` → `['a', "'m'"]`), else `null`. `boundTo` is the `const|let|var` the call
 *  initialises, through any wrapping expression but never through a function, block or statement. */
export interface CallSite {
  callee: string;
  name: string | null;
  head: string | null;
  headArgs: string[] | null;
  args: CallArg[];
  boundTo: string | null;
  start: number;
  end: number;
  line: number;
}

/** A `const|let|var` with a plain identifier name and an initialiser (`init` its source text, starting at offset
 *  `initStart`), in source order. `scopeStart`/`scopeEnd` span the block, loop, function or file it is declared in, so
 *  a name used at an offset resolves to the innermost binding whose scope holds it. */
export interface Binding {
  name: string;
  init: string;
  initStart: number;
  start: number;
  end: number;
  line: number;
  scopeStart: number;
  scopeEnd: number;
}

/** An equality comparison (`===`, `!==`, `==`, `!=`), in source order. `leftLeaf`/`rightLeaf` are each operand's last name
 *  (`a.b.sessionId`, `a!.sessionId`, `o['sessionId']` and `sessionId` all read `sessionId`; `null` for any other shape);
 *  `absent` is true when an operand is `null`, `undefined` or `void …`, so a presence check is told from a comparison
 *  of two values. `text` is the comparison's source with line breaks and their indentation removed. */
export interface Comparison {
  leftLeaf: string | null;
  rightLeaf: string | null;
  absent: boolean;
  text: string;
  start: number;
  line: number;
}

export interface ParsedFile {
  path: string;
  text: string;
  imports: ImportEdge[];
  exportedTypeAliases: TypeAlias[];
  symbols: SymbolSpan[];
  calls: CallSite[];
  bindings: Binding[];
  comparisons: Comparison[];
}

const scriptKindOf = (file: string): ts.ScriptKind =>
  /\.tsx$/.test(file) ? ts.ScriptKind.TSX
    : /\.jsx$/.test(file) ? ts.ScriptKind.JSX
      : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

/** A member or declaration name the scanners can key on; `null` for a computed one. */
const nameText = (n: ts.PropertyName | ts.BindingName | undefined): string | null =>
  n && (ts.isIdentifier(n) || ts.isPrivateIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n))
    ? n.text : null;

/** The last name of an operand, through parentheses, `!` and `as`; `null` when it has none. */
const leafNameOf = (e: ts.Expression): string | null => {
  let n: ts.Expression = e;
  while (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n)) n = n.expression;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  return null;
};

const isAbsentValue = (e: ts.Expression): boolean =>
  e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined') || ts.isVoidExpression(e);

const isFunctionValue = (e: ts.Expression | undefined): e is ts.ArrowFunction | ts.FunctionExpression =>
  !!e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e));

const isExported = (n: ts.Node): boolean =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const literalText = (t: ts.TypeNode): string | null => {
  if (!ts.isLiteralTypeNode(t)) return null;
  const l = t.literal;
  if (ts.isStringLiteral(l) || ts.isNumericLiteral(l)) return l.text;
  if (l.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (l.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  return null;
};

/** The bare `X` of a `Record<X, true>` inside `t` (or `Readonly<Record<X, true>>`), else `null`. */
const recordTrueKey = (t: ts.TypeNode): string | null => {
  if (!ts.isTypeReferenceNode(t) || !ts.isIdentifier(t.typeName)) return null;
  const args = t.typeArguments ?? [];
  if (t.typeName.text === 'Readonly' && args.length === 1) return recordTrueKey(args[0]!);
  if (t.typeName.text !== 'Record' || args.length !== 2) return null;
  const [k, v] = [args[0]!, args[1]!];
  return ts.isTypeReferenceNode(k) && ts.isIdentifier(k.typeName) && !k.typeArguments
    && ts.isLiteralTypeNode(v) && v.literal.kind === ts.SyntaxKind.TrueKeyword ? k.typeName.text : null;
};

/** D-6048 (ARCH-12): the wire-totality facts of one parsed file, read by a walk of their own (kept out of
 *  `ParsedFile` so the shared walk stays one owner's). Runtime-bearing forms only. */
export interface WireFacts {
  /** The `X` of every `Record<X, true>` (bare or inside `Readonly<…>`) typing a non-`declare` variable or a
   *  `satisfies` expression: a map that fails to compile when `X` gains a member. Bare type names only. */
  recordTrueKeys: string[];
  /** The `X` of every `v is X` predicate on a function, method or arrow WITH a body; not `asserts v is X`, not a
   *  type-only signature. Bare type names only. */
  guardedTypes: string[];
  /** Every string literal the file compares against by hand: an operand of `===`, `!==`, `==` or `!=`, or a `case`
   *  label. In source order, repeats kept. */
  comparedLiterals: string[];
}

const EQUALITY = new Set<ts.SyntaxKind>([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);

const isDeclared = (d: ts.VariableDeclaration): boolean => {
  const stmt = d.parent?.parent;
  return !!stmt && ts.isVariableStatement(stmt)
    && !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
};

const hasBody = (n: ts.Node): boolean =>
  (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n))
  && n.body !== undefined;

/** The wire-totality facts of `p` (D-6048). */
export function wireFacts(p: ParsedFile): WireFacts {
  const sf = ts.createSourceFile(p.path, p.text, ts.ScriptTarget.Latest, true, scriptKindOf(p.path));
  const out: WireFacts = { recordTrueKeys: [], guardedTypes: [], comparedLiterals: [] };
  const visit = (node: ts.Node): void => {
    const rk = ts.isVariableDeclaration(node) && node.type && !isDeclared(node) ? recordTrueKey(node.type)
      : ts.isSatisfiesExpression(node) ? recordTrueKey(node.type) : null;
    if (rk !== null) out.recordTrueKeys.push(rk);
    if (ts.isTypePredicateNode(node) && !node.assertsModifier && node.type && ts.isTypeReferenceNode(node.type)
      && ts.isIdentifier(node.type.typeName) && !node.type.typeArguments && hasBody(node.parent)) {
      out.guardedTypes.push(node.type.typeName.text);
    }
    const operands = ts.isBinaryExpression(node) && EQUALITY.has(node.operatorToken.kind) ? [node.left, node.right]
      : ts.isCaseClause(node) ? [node.expression] : [];
    for (const o of operands) if (ts.isStringLiteralLike(o)) out.comparedLiterals.push(o.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** D-5862 (ARCH-68): the lane-schedule facts of one parsed file, read by a walk of their own (as `wireFacts` is), so the
 *  census module imports no parser. Syntax only. */
export interface ScheduleFacts {
  /** Every property declaration of every class: the class, the name, whether it is numeric (a numeric literal or
   *  `-Infinity` initialiser, or a `number` type, bare or nullable), and its 1-based line. */
  fields: Array<{ cls: string; name: string; numeric: boolean; line: number }>;
  /** Every relational comparison (`<`, `<=`, `>`, `>=`) one side of which is `<anything> - this.F`: the enclosing class
   *  (`null` outside one), the field `F`, what the other side is (`name` an UPPER_CASE identifier, `literal` a numeric
   *  literal, `product` a product of those, `other` anything else), and whether that other side is a bare millisecond literal
   *  (a numeric literal of 1000 or more, or a product with one). */
  comparisons: Array<{ cls: string | null; field: string; other: 'name' | 'literal' | 'product' | 'other'; literalMs: boolean; line: number }>;
  /** Every top-level `const NAME = <initialiser>;`: whether the initialiser is a bare identifier (a reference). */
  constants: Array<{ name: string; reference: boolean; line: number }>;
}

const RELATIONAL = new Set<ts.SyntaxKind>([ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken]);

/** The lane-schedule facts of `p` (D-5862). */
export function scheduleFacts(p: ParsedFile): ScheduleFacts {
  const sf = ts.createSourceFile(p.path, p.text, ts.ScriptTarget.Latest, true, scriptKindOf(p.path));
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const out: ScheduleFacts = { fields: [], comparisons: [], constants: [] };
  const strip = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? strip(e.expression) : e);
  const num = (e: ts.Expression): number | null => (ts.isNumericLiteral(e) ? Number(e.text.replace(/_/g, '')) : null);
  const classify = (raw: ts.Expression): { other: 'name' | 'literal' | 'product' | 'other'; literalMs: boolean } => {
    const e = strip(raw);
    if (ts.isNumericLiteral(e)) return { other: 'literal', literalMs: (num(e) ?? 0) >= 1000 };
    if (ts.isIdentifier(e) && /^[A-Z][A-Z0-9_]*$/.test(e.text)) return { other: 'name', literalMs: false };
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
      const l = classify(e.left); const r = classify(e.right);
      if (l.other !== 'other' && r.other !== 'other') return { other: 'product', literalMs: l.literalMs || r.literalMs };
    }
    return { other: 'other', literalMs: false };
  };
  const clockField = (raw: ts.Expression): string | null => {
    const b = strip(raw);
    if (!ts.isBinaryExpression(b) || b.operatorToken.kind !== ts.SyntaxKind.MinusToken) return null;
    const r = strip(b.right);
    return ts.isPropertyAccessExpression(r) && r.expression.kind === ts.SyntaxKind.ThisKeyword ? r.name.text : null;
  };
  const visit = (node: ts.Node, cls: string | null): void => {
    const here = ts.isClassDeclaration(node) ? node.name?.text ?? null : cls;
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && here !== null) {
      const init = node.initializer;
      const numericInit = init !== undefined && (ts.isNumericLiteral(init) || (ts.isPrefixUnaryExpression(init)
        && (ts.isNumericLiteral(init.operand) || (ts.isIdentifier(init.operand) && init.operand.text === 'Infinity'))));
      const type = node.type?.getText(sf) ?? '';
      const numericType = /(^|\|)\s*number\s*(\||$)/.test(type);
      out.fields.push({ cls: here, name: node.name.text, numeric: numericInit || numericType, line: lineOf(node) });
    }
    if (ts.isBinaryExpression(node) && RELATIONAL.has(node.operatorToken.kind)) {
      for (const [a, b] of [[node.left, node.right], [node.right, node.left]] as const) {
        const f = clockField(a);
        if (f !== null) { out.comparisons.push({ cls: here, field: f, ...classify(b), line: lineOf(node) }); break; }
      }
    }
    ts.forEachChild(node, (c) => visit(c, here));
  };
  visit(sf, null);
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer !== undefined) {
        out.constants.push({ name: d.name.text, reference: ts.isIdentifier(d.initializer), line: lineOf(d) });
      }
    }
  }
  return out;
}

/** D-7227 (ARCH-44; plan 2026-10-27-consolidation-arch44-retire.md, C4h): the retire censuses' facts of one parsed file,
 *  read by a walk of their own (as `wireFacts` and `scheduleFacts` are), kept out of `ParsedFile` so the shared walk
 *  stays unchanged. Syntax only. Offsets are into `ParsedFile.text`. */
export interface RetireArrayElement {
  /** The element's source text, as written. */
  text: string;
  start: number;
  end: number;
  /** The element's object literal (through `as`, `satisfies` and parentheses), else `null`. */
  literal: RetireLiteral | null;
}

/** One member of an object literal. `name` is `null` for a computed name or a spread. `kind`: `method` for a method
 *  (or accessor) declaration, `shorthand` for `{ a }`, `arrow` for a value that is an arrow or a function expression,
 *  `property` for anything else (a spread included). `async` is true when its value (or the method) is an `async`
 *  function. `elements` lists an array value's elements, else `null`; `literal` is an object-literal value (through
 *  `as`, `satisfies` and parentheses), else `null`. */
export interface RetireLiteralProperty {
  name: string | null;
  kind: 'property' | 'arrow' | 'method' | 'shorthand';
  async: boolean;
  start: number;
  end: number;
  elements: RetireArrayElement[] | null;
  literal: RetireLiteral | null;
}

/** An object literal: its span and its members, in source order. */
export interface RetireLiteral {
  start: number;
  end: number;
  properties: RetireLiteralProperty[];
}

/** A top-level function's (or function-valued `const`'s) signature: each parameter's type annotation text (`null` when
 *  it has none), each parameter's name (`null` for a destructured one), the declared return type's text (`null` when
 *  none is declared), and its type parameters' text (`T extends A, U`; `null` when it has none). */
export interface RetireSignature {
  name: string;
  params: Array<string | null>;
  paramNames: Array<string | null>;
  returnType: string | null;
  typeParams: string | null;
  start: number;
  end: number;
}

/** A top-level `type X = …`, exported or not, with its right-hand side's text and its type parameters' text (`null`
 *  when it has none), so a constraint (`<T extends A>`) is read as the alias names it. */
export interface RetireAlias {
  name: string;
  exported: boolean;
  text: string;
  typeParams: string | null;
}

export interface RetireFacts {
  /** Every object literal that initialises a top-level `const` (through `as`, `satisfies`, parentheses or a type
   *  annotation), keyed `<const>`, or is the operand of a `return` in a top-level function (a declaration, or a `const`
   *  arrow or function expression, an expression body included), keyed `<function>#return`. KNOWN WIDTH: only a
   *  function's FIRST object-literal return is kept, and a return inside a nested function is not its own. */
  literals: Record<string, RetireLiteral>;
  /** Every top-level function declaration and function-valued `const`, by name. */
  signatures: Record<string, RetireSignature>;
  /** Every top-level type alias, by name. */
  aliases: Record<string, RetireAlias>;
}

/** The retire censuses' facts of `p` (D-7227). */
export function retireFacts(p: ParsedFile): RetireFacts {
  const sf = ts.createSourceFile(p.path, p.text, ts.ScriptTarget.Latest, true, scriptKindOf(p.path));
  const out: RetireFacts = { literals: {}, signatures: {}, aliases: {} };
  const unwrap = (e: ts.Expression): ts.Expression => {
    let n = e;
    while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n)
      || ts.isTypeAssertionExpression(n)) n = n.expression;
    return n;
  };
  const isAsync = (n: ts.Node): boolean =>
    ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
  const literalOf = (e: ts.Expression | undefined): RetireLiteral | null => {
    if (e === undefined) return null;
    const n = unwrap(e);
    return ts.isObjectLiteralExpression(n) ? readLiteral(n) : null;
  };
  const readLiteral = (o: ts.ObjectLiteralExpression): RetireLiteral => {
    const properties: RetireLiteralProperty[] = [];
    for (const m of o.properties) {
      const start = m.getStart(sf);
      const base = { start, end: m.end };
      if (ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
        properties.push({ ...base, name: nameText(m.name), kind: 'method', async: isAsync(m), elements: null, literal: null });
      } else if (ts.isShorthandPropertyAssignment(m)) {
        properties.push({ ...base, name: m.name.text, kind: 'shorthand', async: false, elements: null, literal: null });
      } else if (ts.isPropertyAssignment(m)) {
        const v = unwrap(m.initializer);
        const fn = isFunctionValue(v);
        const elements = ts.isArrayLiteralExpression(v)
          ? v.elements.map((el) => ({ text: el.getText(sf), start: el.getStart(sf), end: el.end, literal: literalOf(el) }))
          : null;
        properties.push({ ...base, name: nameText(m.name), kind: fn ? 'arrow' : 'property', async: fn && isAsync(v),
          elements, literal: literalOf(v) });
      } else {
        properties.push({ ...base, name: null, kind: 'property', async: false, elements: null, literal: null });
      }
    }
    return { start: o.getStart(sf), end: o.end, properties };
  };
  /** The first object-literal `return` operand of a function body, nested functions excluded. */
  const firstReturn = (body: ts.Node): RetireLiteral | null => {
    let found: RetireLiteral | null = null;
    const visit = (n: ts.Node): void => {
      if (found !== null || ts.isFunctionLike(n) || ts.isClassLike(n)) return;
      if (ts.isReturnStatement(n) && n.expression !== undefined) found = literalOf(n.expression);
      if (found === null) ts.forEachChild(n, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  };
  const typeParamsOf = (tps: ts.NodeArray<ts.TypeParameterDeclaration> | undefined): string | null =>
    tps === undefined || tps.length === 0 ? null : tps.map((t) => t.getText(sf)).join(', ');
  const signatureOf = (name: string, fn: ts.SignatureDeclarationBase, whole: ts.Node): RetireSignature => ({
    name,
    params: fn.parameters.map((x) => x.type?.getText(sf) ?? null),
    paramNames: fn.parameters.map((x) => (ts.isIdentifier(x.name) ? x.name.text : null)),
    returnType: fn.type?.getText(sf) ?? null,
    typeParams: typeParamsOf(fn.typeParameters),
    start: whole.getStart(sf),
    end: whole.end,
  });
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st)) {
      out.aliases[st.name.text] = { name: st.name.text, exported: isExported(st), text: st.type.getText(sf),
        typeParams: typeParamsOf(st.typeParameters) };
    } else if (ts.isFunctionDeclaration(st) && st.name !== undefined) {
      out.signatures[st.name.text] = signatureOf(st.name.text, st, st);
      const lit = st.body === undefined ? null : firstReturn(st.body);
      if (lit !== null) out.literals[`${st.name.text}#return`] = lit;
    } else if (ts.isVariableStatement(st)) {
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
        const name = d.name.text;
        const v = unwrap(d.initializer);
        if (isFunctionValue(v)) {
          out.signatures[name] = signatureOf(name, v, st.declarationList.declarations.length === 1 ? st : d);
          const lit = ts.isBlock(v.body) ? firstReturn(v.body) : literalOf(v.body);
          if (lit !== null) out.literals[`${name}#return`] = lit;
        } else if (isConst) {
          const lit = literalOf(d.initializer);
          if (lit !== null) out.literals[name] = lit;
        }
      }
    }
  }
  return out;
}

const unionLiterals = (t: ts.TypeNode): string[] | null => {
  const members = ts.isUnionTypeNode(t) ? [...t.types] : [t];
  const out = members.map(literalText);
  return out.every((x): x is string => x !== null) ? out : null;
};

/** Parse TypeScript (or JS/TSX, by `fileName`'s extension) text. Syntax only. */
/** One reference to a named identifier (`identifierReferences`). `role`: `import` for an import specifier (`imported` is
 *  the module's name for it, `name` the local one), `call` for the callee of a call (`f(…)`, or the property of
 *  `ns.f(…)`), `other` for anything else (an export specifier, a copy, a destructure, a value passed on). `context` is
 *  the parent node's source with line breaks removed, `line` 1-based. */
export interface IdentifierReference {
  name: string;
  role: 'import' | 'call' | 'other';
  imported: string | null;
  line: number;
  context: string;
}

/** Every identifier of `text` whose text is in `names` (and, transitively, the local alias of any import specifier that
 *  imports one of them, `import { a as b }` adding `b`), in source order. Property names count (`ns.a`, `{ a: x }`). */
export function identifierReferences(text: string, fileName: string, names: ReadonlySet<string>): IdentifierReference[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const wanted = new Set(names);
  const collectAliases = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n) && wanted.has((n.propertyName ?? n.name).text)) wanted.add(n.name.text);
    ts.forEachChild(n, collectAliases);
  };
  collectAliases(sf);
  const out: IdentifierReference[] = [];
  const isCallee = (id: ts.Node): boolean => {
    const p = id.parent;
    if (ts.isCallExpression(p) && p.expression === id) return true;
    return ts.isPropertyAccessExpression(p) && p.name === id && ts.isCallExpression(p.parent) && p.parent.expression === p;
  };
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && wanted.has(n.text)) {
      const p = n.parent;
      const imp = ts.isImportSpecifier(p);
      out.push({
        name: n.text,
        role: imp ? 'import' : isCallee(n) ? 'call' : 'other',
        imported: imp ? (p.propertyName ?? p.name).text : null,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        context: p.getText(sf).replace(/\s*\n\s*/g, ' '),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export function parseSource(text: string, fileName = 'source.ts'): ParsedFile {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const imports: ImportEdge[] = [];
  const exportedTypeAliases: TypeAlias[] = [];
  const symbols: SymbolSpan[] = [];
  const calls: CallSite[] = [];
  const bindings: Binding[] = [];
  const comparisons: Comparison[] = [];
  const flat = (n: ts.Node): string => n.getText(sf).replace(/\r?\n[ \t]*/g, '');

  const addCall = (node: ts.CallExpression): void => {
    const callee = node.expression;
    const name = ts.isIdentifier(callee) ? callee.text
      : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
    let h: ts.Expression = callee;
    let headArgs: string[] | null = null;
    for (;;) {
      if (ts.isPropertyAccessExpression(h) || ts.isElementAccessExpression(h) || ts.isNonNullExpression(h)
        || ts.isParenthesizedExpression(h)) { h = h.expression; continue; }
      if (ts.isCallExpression(h)) {
        if (ts.isIdentifier(h.expression)) headArgs = h.arguments.map(flat);
        h = h.expression; continue;
      }
      break;
    }
    const head = ts.isIdentifier(h) ? h.text : h.kind === ts.SyntaxKind.ThisKeyword ? 'this' : null;
    if (head === null) headArgs = null;
    let boundTo: string | null = null;
    for (let p: ts.Node = node.parent; ; p = p.parent) {
      if (ts.isVariableDeclaration(p)) { boundTo = nameText(p.name); break; }
      if (ts.isFunctionLike(p) || ts.isBlock(p) || ts.isSourceFile(p) || ts.isExpressionStatement(p)
        || ts.isReturnStatement(p) || ts.isClassLike(p) || ts.isPropertyDeclaration(p)) break;
    }
    const args: CallArg[] = node.arguments.map((a) => ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)
      ? { kind: 'string' as const, text: a.text }
      : ts.isRegularExpressionLiteral(a) ? { kind: 'regex' as const, text: a.text } : { kind: 'other' as const, text: flat(a) });
    const start = node.getStart(sf);
    calls.push({ callee: flat(callee), name, head, headArgs, args, boundTo, start, end: node.end, line: lineOf(start) });
  };

  const addSymbol = (name: string, kind: SymbolKind, node: ts.Node): void => {
    const start = node.getStart(sf);
    symbols.push({ name, kind, start, end: node.end, line: lineOf(start), endLine: lineOf(node.end) });
  };

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const c = st.importClause;
      const names: string[] = [];
      if (c?.name) names.push(c.name.text);
      const nb = c?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) names.push(`* as ${nb.name.text}`);
      const typeNames: string[] = [];
      if (nb && ts.isNamedImports(nb)) {
        for (const e of nb.elements) {
          names.push((e.propertyName ?? e.name).text);
          if (e.isTypeOnly) typeNames.push((e.propertyName ?? e.name).text);
        }
      }
      imports.push({ specifier: st.moduleSpecifier.text, kind: 'import',
        typeOnly: c?.phaseModifier === ts.SyntaxKind.TypeKeyword, names, typeNames, line: lineOf(st.getStart(sf)) });
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const ec = st.exportClause;
      const names = !ec ? ['*']
        : ts.isNamespaceExport(ec) ? [`* as ${nameText(ec.name) ?? ''}`]
          : ec.elements.map((e) => nameText(e.propertyName ?? e.name) ?? '');
      const typeNames = ec && ts.isNamedExports(ec)
        ? ec.elements.filter((e) => e.isTypeOnly).map((e) => nameText(e.propertyName ?? e.name) ?? '') : [];
      imports.push({ specifier: st.moduleSpecifier.text, kind: 'export-from', typeOnly: st.isTypeOnly, names, typeNames,
        line: lineOf(st.getStart(sf)) });
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)
      && ts.isStringLiteral(st.moduleReference.expression)) {
      imports.push({ specifier: st.moduleReference.expression.text, kind: 'import-equals', typeOnly: st.isTypeOnly,
        names: [st.name.text], line: lineOf(st.getStart(sf)) });
    } else if (ts.isTypeAliasDeclaration(st) && isExported(st)) {
      exportedTypeAliases.push({ name: st.name.text, literals: unionLiterals(st.type), line: lineOf(st.getStart(sf)) });
    }
  }

  const visit = (node: ts.Node, scope: readonly string[]): void => {
    const q = (n: string): string => [...scope, n].join('.');
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
      || node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken)) {
      const start = node.getStart(sf);
      comparisons.push({ leftLeaf: leafNameOf(node.left), rightLeaf: leafNameOf(node.right),
        absent: isAbsentValue(node.left) || isAbsentValue(node.right), text: flat(node), start, line: lineOf(start) });
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = node.arguments[0];
      if (a && ts.isStringLiteralLike(a)) {
        imports.push({ specifier: a.text, kind: 'dynamic', typeOnly: false, names: [], line: lineOf(node.getStart(sf)) });
      }
    } else if (ts.isCallExpression(node)) addCall(node);
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      const start = node.getStart(sf);
      let sc: ts.Node = node.parent;
      while (!(ts.isBlock(sc) || ts.isSourceFile(sc) || ts.isModuleBlock(sc) || ts.isCaseBlock(sc) || ts.isForStatement(sc)
        || ts.isForOfStatement(sc) || ts.isForInStatement(sc) || ts.isFunctionLike(sc))) sc = sc.parent;
      bindings.push({ name: node.name.text, init: node.initializer.getText(sf), initStart: node.initializer.getStart(sf),
        start, end: node.end, line: lineOf(start), scopeStart: sc.getStart(sf), scopeEnd: sc.end });
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      // The qualifier's first name (`FastifyReply` in `import('fastify').FastifyReply`); none for `typeof import(…)`.
      let q: ts.EntityName | undefined = node.qualifier;
      while (q && ts.isQualifiedName(q)) q = q.left;
      imports.push({ specifier: node.argument.literal.text, kind: 'type-query', typeOnly: true,
        names: q ? [q.text] : [], line: lineOf(node.getStart(sf)) });
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbol(q(node.name.text), 'function', node);
      ts.forEachChild(node, (c) => visit(c, [...scope, node.name!.text]));
      return;
    }
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
      const cls = node.name.text;
      addSymbol(q(cls), 'class', node);
      for (const m of node.members) {
        const own = [...scope, cls];
        const at = (n: string): string => [...own, n].join('.');
        if (ts.isConstructorDeclaration(m)) {
          addSymbol(at('constructor'), 'constructor', m);
          ts.forEachChild(m, (c) => visit(c, [...own, 'constructor']));
          continue;
        }
        const mn = nameText(m.name);
        if (mn === null) { ts.forEachChild(m, (c) => visit(c, own)); continue; }
        if (ts.isMethodDeclaration(m)) addSymbol(at(mn), 'method', m);
        else if (ts.isGetAccessorDeclaration(m)) addSymbol(at(mn), 'getter', m);
        else if (ts.isSetAccessorDeclaration(m)) addSymbol(at(mn), 'setter', m);
        else if (ts.isPropertyDeclaration(m) && isFunctionValue(m.initializer)) addSymbol(at(mn), 'arrow-property', m);
        else { ts.forEachChild(m, (c) => visit(c, own)); continue; }
        ts.forEachChild(m, (c) => visit(c, [...own, mn]));
      }
      return;
    }
    if (ts.isVariableDeclaration(node) && isFunctionValue(node.initializer)) {
      const vn = nameText(node.name);
      if (vn !== null) {
        // The span is the whole statement for a single declaration, so it starts at its `export`/`const`.
        const list = node.parent;
        const whole = ts.isVariableDeclarationList(list) && list.declarations.length === 1
          && ts.isVariableStatement(list.parent) ? list.parent : node;
        addSymbol(q(vn), 'variable-function', whole);
        ts.forEachChild(node, (c) => visit(c, [...scope, vn]));
        return;
      }
    }
    ts.forEachChild(node, (c) => visit(c, scope));
  };
  visit(sf, []);
  imports.sort((a, b) => a.line - b.line);
  calls.sort((a, b) => a.start - b.start);
  bindings.sort((a, b) => a.start - b.start);
  comparisons.sort((a, b) => a.start - b.start);

  return { path: fileName, text, imports, exportedTypeAliases, symbols, calls, bindings, comparisons };
}

/** Read and parse one file. */
export function parseFile(file: string): ParsedFile {
  return parseSource(readFileSync(file, 'utf8'), file);
}

/** One piece of string text in the source: a string literal, a no-substitution template, or one literal part of a
 *  template (its head or the text after a `${…}`). Pieces split at every `${…}`, so a word built across one is not
 *  in any piece. `text` is the cooked value; `line` is 1-based, where the piece starts. */
export interface StringPiece {
  text: string;
  line: number;
}

/** Every string piece in a source text, in source order (D-6051: the ccd stub scanner reads the bash a test holds).
 *  KNOWN WIDTH: pieces are cooked text, and a template nested inside a `${…}` yields pieces of its own. */
export function stringPieces(text: string, fileName = 'source.ts'): StringPiece[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const out: StringPiece[] = [];
  const add = (t: string, node: ts.Node): void => {
    out.push({ text: t, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, node);
    else if (ts.isTemplateExpression(node)) {
      add(node.head.text, node.head);
      for (const s of node.templateSpans) add(s.literal.text, s.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** A string-valued expression: a string literal, a template, or a `+` chain of them (how a long SQL statement is
 *  written across lines). `text` is the cooked value with each `${…}` replaced by `${}`; `start`/`end` span the
 *  whole expression in the source; `line` is 1-based, where it starts. `partial` is true when the expression is an
 *  operand of a larger `+` chain that is NOT wholly string text (`'UPDATE t SET a = ?, ' + cond + ' WHERE …'`): its
 *  `text` is then only a fragment of the statement, and `chainStart`/`chainEnd` span the whole chain (else the
 *  expression itself), so a census can read the raw source of the statement the fragment belongs to. */
export interface StringExpression {
  text: string;
  start: number;
  end: number;
  line: number;
  partial: boolean;
  chainStart: number;
  chainEnd: number;
}

/** The maximal string-valued expressions of a source text, in source order (ARCH-06: `sqlStatementsIn` reads the SQL a
 *  store holds). A chain counts only when every operand is a string literal, a template or a parenthesised chain, so
 *  `'a' + x` is two expressions, not one. KNOWN WIDTH: a substitution's own text is not read, and a template nested
 *  inside a `${…}` is an expression of its own. */
export function stringExpressions(text: string, fileName = 'source.ts'): StringExpression[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const out: StringExpression[] = [];
  /** The cooked value of `n` when it is wholly string text, else `null`. */
  const valueOf = (n: ts.Node): string | null => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => '${}' + s.literal.text).join('');
    if (ts.isParenthesizedExpression(n)) return valueOf(n.expression);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = valueOf(n.left);
      const r = l === null ? null : valueOf(n.right);
      return r === null ? null : l + r;
    }
    return null;
  };
  const visit = (node: ts.Node): void => {
    const v = valueOf(node);
    if (v !== null && !ts.isParenthesizedExpression(node)) {
      // The outermost `+` chain this operand sits in (parentheses looked through): its span is the statement's source.
      let top: ts.Node = node;
      while (top.parent && (ts.isParenthesizedExpression(top.parent)
        || (ts.isBinaryExpression(top.parent) && top.parent.operatorToken.kind === ts.SyntaxKind.PlusToken))) top = top.parent;
      out.push({ text: v, start: node.getStart(sf), end: node.getEnd(), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        partial: top !== node, chainStart: top.getStart(sf), chainEnd: top.getEnd() });
      // A template's substitutions can hold strings of their own.
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** One parse per (file name, text), kept for the last text of each file: `inlinedSourceOf` asks for many positions of one file. */
const sourceFiles = new Map<string, { text: string; sf: ts.SourceFile }>();
const sourceFileOf = (text: string, fileName: string): ts.SourceFile => {
  const hit = sourceFiles.get(fileName);
  if (hit && hit.text === text) return hit.sf;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  sourceFiles.set(fileName, { text, sf });
  return sf;
};

/** The offset where the statement holding `pos` starts: the innermost statement that sits in a block, a source file or a
 *  case clause (so `void this.x(…)`, `const a = this.x(…)` and `await this.x(…)` all start at their first keyword).
 *  `pos` outside every statement gives `pos`. */
export function statementStartAt(text: string, pos: number, fileName = 'source.ts'): number {
  const sf = sourceFileOf(text, fileName);
  let found = pos;
  const visit = (n: ts.Node): void => {
    if (pos < n.getStart(sf) || pos >= n.getEnd()) return;
    if (ts.isStatement(n) && (ts.isBlock(n.parent) || ts.isSourceFile(n.parent) || ts.isCaseOrDefaultClause(n.parent)
      || ts.isModuleBlock(n.parent))) found = n.getStart(sf);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** D-7578 (plan docs/superpowers/plans/2026-10-30-consolidation-increment7-watcher-store-port.md, Task WP1; increment
 *  7): what the census is asked. Every file name is relative to `base` (`server/src`), and so is every name it prints. */
export interface StoreReachOptions {
  /** The tsconfig whose program is walked (`server/tsconfig.json`). Unused with `files`. */
  tsconfig?: string;
  /** The directory names are relative to. Required with `tsconfig`; with `files` it is a fixed virtual root. */
  base?: string;
  /** The scope: a file name, or a one-level glob (`*Lane.ts`, `lane*.ts`) matched against `base`'s own listing, so a
   *  new file the glob names is in scope at birth. */
  scope: readonly string[];
  /** The store class (`CoordStore` in `coord/store.ts`). */
  store: { file: string; name: string };
  /** The port alias (`WatcherCoordPort` in `coord/ports.ts`); absent from the program is allowed (before WP2). */
  port: { file: string; name: string };
  /** Fixture sources by name under the virtual root: the program is built over these instead (the CONTROL rows). */
  files?: Readonly<Record<string, string>>;
}

/** The census, as plain data. `units` maps every walked unit in scope (`watch.ts#FleetWatcher.tick`) to the members
 *  it reaches; `reach` is every member reached, `wholeReach` and `portReach` those reached on a whole-store value and
 *  on a port value; `portMembers` the port alias's members ([] when it is absent); `wholeHandoffs` each whole hand-off
 *  key with its call-site count, and `chains` its chain of out-of-scope functions taking the whole store, bottom-up;
 *  `portEntries` each place a whole value enters the port, by call site; `bareAnnotations` the bare store-class type
 *  references in scope, by unit. */
export interface StoreReach {
  diagnostics: string[];
  files: string[];
  units: Record<string, string[]>;
  reach: string[];
  wholeReach: string[];
  portReach: string[];
  portMembers: string[];
  wholeHandoffs: Record<string, number>;
  chains: Record<string, string[]>;
  portEntries: Record<string, number>;
  bareAnnotations: Record<string, number>;
}

/** One typed program per tsconfig, per process. */
const reachPrograms = new Map<string, ts.Program>();
/** Library declaration files, parsed once and shared by every fixture program. */
const reachLibFiles = new Map<string, ts.SourceFile>();
/** The function-typed implementation index, built once per program. */
const reachImplIndexes = new WeakMap<ts.Program, Map<ts.Node, Set<ts.Node>>>();
const REACH_FIXTURE_ROOT = '/store-reach-fixture/src';
const REACH_WRAPPERS: ReadonlySet<string> = new Set(['Pick', 'Partial', 'Omit', 'Readonly']);

const reachRealProgram = (tsconfig: string): ts.Program => {
  const hit = reachPrograms.get(tsconfig);
  if (hit) return hit;
  const read = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (read.error) throw new Error(`storeReach: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
  const cfg = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(tsconfig));
  const program = ts.createProgram({ rootNames: cfg.fileNames, options: cfg.options,
    configFileParsingDiagnostics: cfg.errors });
  reachPrograms.set(tsconfig, program);
  return program;
};

const reachFixtureProgram = (files: Readonly<Record<string, string>>): ts.Program => {
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true, types: [],
    lib: ['lib.es2022.d.ts'] };
  const virtual = new Map(Object.entries(files).map(([n, t]) => [path.posix.join(REACH_FIXTURE_ROOT, n), t]));
  const host = ts.createCompilerHost(options, true);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (name, lang, onError, fresh) => {
    const text = virtual.get(name);
    if (text !== undefined) return ts.createSourceFile(name, text, lang, true, scriptKindOf(name));
    const lib = reachLibFiles.get(name);
    if (lib) return lib;
    const sf = getSourceFile.call(host, name, lang, onError, fresh);
    if (sf) reachLibFiles.set(name, sf);
    return sf;
  };
  const dirs = new Set([...virtual.keys()].flatMap((f) => {
    const out: string[] = [];
    for (let d = path.posix.dirname(f); d !== '/'; d = path.posix.dirname(d)) out.push(d);
    return out;
  }));
  const { directoryExists } = host;
  host.directoryExists = (d) => dirs.has(d) || (directoryExists?.call(host, d) ?? false);
  host.fileExists = (name) => virtual.has(name) || fileExists.call(host, name);
  host.readFile = (name) => virtual.get(name) ?? readFile.call(host, name);
  host.getCurrentDirectory = () => REACH_FIXTURE_ROOT;
  return ts.createProgram({ rootNames: [...virtual.keys()], options, host });
};

const reachGlob = (entry: string): RegExp =>
  new RegExp(`^${entry.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

const sortedRecord = <V>(m: ReadonlyMap<string, V>): Record<string, V> =>
  Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

type ReachClass = 'whole' | 'port' | 'narrow';
/** A store value's kind: the whole class, or a port or narrow type with its members. */
type ReachKind = { cls: 'whole' } | { cls: 'port' | 'narrow'; members: readonly string[] };
interface ReachAcc {
  members: Map<string, Set<ReachClass>>;
  handoffs: Map<string, number>;
  chains: Map<string, string[]>;
  portEntries: Map<string, number>;
  bare: number;
  /** Callee mode: the out-of-scope functions below it that take the whole store, bottom-up. */
  wholeChain: string[];
}
const reachAcc = (): ReachAcc =>
  ({ members: new Map(), handoffs: new Map(), chains: new Map(), portEntries: new Map(), bare: 0, wholeChain: [] });
const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1); };
const dedupe = (xs: readonly string[]): string[] => [...new Set(xs)];

/**
 * D-7578 (Task WP1; increment 7): the type-checked census of the store members a scope reaches (the watcher and its
 * lane files on the real tree). The rules, as the plan's §What the measurement found, item 3, states them:
 *  - a STORE VALUE is an expression whose static type, without `null` and `undefined`, is the store class (WHOLE), the
 *    port alias (PORT), or a `Pick`, `Partial`, `Omit` or `Readonly` of either (a Pick of the port is a port value; any
 *    other is NARROW);
 *  - (a) a member read on a store value is reached;
 *  - (b) a store value in a NARROW SLOT reaches the slot type's members, classified by the value's own type. A slot is a
 *    parameter, an annotated local, or an object-literal property (plain or shorthand) into a narrow field of a
 *    parameter's type, a declared return type or an annotated variable's type; narrow is a Pick/Partial/Omit/Readonly
 *    of the store, or an interface whose every property names a store member;
 *  - a CARRIER is a value whose object type has a property typed as a store value (an identifier, a property access,
 *    `this`, an object literal or a call); a THUNK is a function value whose return type carries one;
 *  - (c) a store value, carrier or thunk handed to a parameter that takes the whole store or the port is followed into
 *    the callee (a function, a method, or the class for `new`), memoized with cycles cut; never into the store's own
 *    file or a declaration file, and never into a function in scope (its body is walked as its own unit);
 *  - (d) a call whose signature has no body (an interface or type-literal method signature, a function-typed field,
 *    an indexed type of one) is followed into every implementation that flows into that signature, by an index built
 *    once over the program (a function whose contextual type has the signature, or a value whose own signature is
 *    assigned to it: an object-literal property, an assignment, an annotated initializer or an argument), recursively
 *    with cycles cut; the hand-off is keyed by the signature (`coord/routes.ts#CoordRoutesHandle.withSweepAbandon`), and
 *    one with no implementation is reported as the member and key `UNRESOLVED <signature>`, which no list holds;
 *  - a whole value whose contextual type is exactly the port is a PORT ENTRY and reaches nothing itself;
 *  - a WHOLE HAND-OFF is a call or `new` in scope passing a whole value, carrier or thunk to an out-of-scope parameter
 *    that takes the whole store, keyed `<scope file>#<Unit> -> <callee file>#<callee>`, counted per call site.
 * KNOWN WIDTH: a `Function.prototype.call` or `apply` thisArg is not followed (nor reported: its signature is in a
 * declaration file); a cast through `any` or `unknown` hides a store value; a computed element access on a store value
 * is reported as the member `[<expr>]`, which no list holds; a carrier is looked into three properties deep.
 */
export function storeReach(opts: StoreReachOptions): StoreReach {
  const fixture = opts.files !== undefined;
  if (!fixture && (opts.tsconfig === undefined || opts.base === undefined)) {
    throw new Error('storeReach: a real-tree census names its tsconfig and its base');
  }
  const program = fixture ? reachFixtureProgram(opts.files!) : reachRealProgram(path.resolve(opts.tsconfig!));
  const base = fixture ? REACH_FIXTURE_ROOT : path.resolve(opts.base!);
  const checker = program.getTypeChecker();
  const rel = (f: string): string => path.relative(base, f).split(path.sep).join('/');
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) =>
    `${d.file ? rel(d.file.fileName) : '<program>'}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);

  const listing = fixture ? Object.keys(opts.files!).filter((n) => !n.includes('/'))
    : readdirSync(base, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  const files = [...new Set(opts.scope.flatMap((entry) =>
    (entry.includes('*') ? listing.filter((n) => reachGlob(entry).test(n)) : [entry])))].sort();
  const scopeAbs = new Set(files.map((f) => path.join(base, f)));
  const storeAbs = path.join(base, opts.store.file);

  const storeDecl = program.getSourceFile(storeAbs)?.statements.find((s): s is ts.ClassDeclaration =>
    ts.isClassDeclaration(s) && s.name?.text === opts.store.name);
  if (!storeDecl?.name) throw new Error(`storeReach: no class ${opts.store.name} in ${opts.store.file}`);
  const storeSym = checker.getSymbolAtLocation(storeDecl.name)!;
  const storeType = checker.getDeclaredTypeOfSymbol(storeSym);
  const storeMembers = new Set(checker.getPropertiesOfType(storeType)
    .filter((p) => !p.name.startsWith('__#') && !(p.valueDeclaration
      && ts.getCombinedModifierFlags(p.valueDeclaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)))
    .map((p) => p.name));
  const portDecl = program.getSourceFile(path.join(base, opts.port.file))?.statements.find(
    (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === opts.port.name);
  const portSym = portDecl ? checker.getSymbolAtLocation(portDecl.name) : undefined;
  const portMembers = portSym ? checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(portSym)).map((p) => p.name).sort() : [];

  const ownedByStore = (d: ts.Declaration): boolean =>
    d.parent === storeDecl || (ts.isParameter(d) && d.parent.parent === storeDecl);
  const strip = (t: ts.Type | undefined): ts.Type | undefined => {
    if (!t || !t.isUnion()) return t;
    const rest = t.types.filter((x) => !(x.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
    return rest.length === 1 ? rest[0] : undefined;
  };
  const isExactPort = (t: ts.Type | undefined): boolean => !!portSym && strip(t)?.aliasSymbol === portSym;
  const portDerived = (t: ts.Type | undefined): boolean => {
    const a = t?.aliasSymbol;
    if (!t || !a || !portSym) return false;
    if (a === portSym) return true;
    return REACH_WRAPPERS.has(a.name) && portDerived(t.aliasTypeArguments?.[0]);
  };
  const kindMemo = new Map<ts.Type, ReachKind | null>();
  const kindOf = (t0: ts.Type | undefined): ReachKind | null => {
    const t = strip(t0);
    if (!t) return null;
    const hit = kindMemo.get(t);
    if (hit !== undefined) return hit;
    let k: ReachKind | null = null;
    if (t === storeType) k = { cls: 'whole' };
    else if (t.flags & ts.TypeFlags.Object) {
      const props = checker.getPropertiesOfType(t);
      if (props.length > 0 && props.every((p) => (p.declarations ?? []).some(ownedByStore))) {
        k = { cls: portDerived(t) ? 'port' : 'narrow', members: props.map((p) => p.name) };
      }
    }
    kindMemo.set(t, k);
    return k;
  };
  /** An interface (or type literal) whose every property names a store member: a structural narrow slot. */
  const structural = (t: ts.Type | undefined): string[] | null => {
    const s = strip(t);
    if (!s || !(s.flags & ts.TypeFlags.Object) || s.getCallSignatures().length > 0) return null;
    const names = checker.getPropertiesOfType(s).map((p) => p.name);
    return names.length > 0 && names.every((n) => storeMembers.has(n)) ? names : null;
  };
  type Leaf = (t: ts.Type) => boolean;
  const leafWhole: Leaf = (t) => kindOf(t)?.cls === 'whole';
  const leafPort: Leaf = (t) => isExactPort(t);
  const leafStore: Leaf = (t) => kindOf(t) !== null;
  const carryMemo = new Map<Leaf, Map<ts.Type, boolean>>([[leafWhole, new Map()], [leafPort, new Map()], [leafStore, new Map()]]);
  /** Whether `t` is, or carries (a property three deep, or a call signature's return: a thunk), what `leaf` accepts. */
  const carries = (t0: ts.Type | undefined, leaf: Leaf, depth = 0): boolean => {
    if (!t0 || depth > 3) return false;
    const t = strip(t0);
    if (!t) return t0.isUnion() ? t0.types.some((x) => carries(x, leaf, depth)) : false;
    if (leaf(t)) return true;
    if (kindOf(t) !== null || !(t.flags & ts.TypeFlags.Object)) return false;
    const memo = carryMemo.get(leaf)!;
    const hit = memo.get(t);
    if (hit !== undefined) return hit;
    memo.set(t, false);
    let r = t.getCallSignatures().some((s) => carries(s.getReturnType(), leaf, depth + 1));
    if (!r && depth < 3) {
      r = checker.getPropertiesOfType(t).some((p) => {
        const d = p.valueDeclaration ?? p.declarations?.[0];
        return !!d && !d.getSourceFile().isDeclarationFile && carries(checker.getTypeOfSymbol(p), leaf, depth + 1);
      });
    }
    memo.set(t, r);
    return r;
  };

  // ---- (d): the implementation index, once per program ----
  const sigDecl = (t: ts.Type | undefined): ts.Node | null => {
    const s = strip(t);
    const sigs = s ? s.getCallSignatures() : [];
    return sigs.length === 1 ? sigs[0]!.declaration ?? null : null;
  };
  const implIndex = ((): Map<ts.Node, Set<ts.Node>> => {
    const hit = reachImplIndexes.get(program);
    if (hit) return hit;
    const index = new Map<ts.Node, Set<ts.Node>>();
    const add = (target: ts.Node | null, source: ts.Node | null): void => {
      if (!target || !source || target === source) return;
      if (!index.has(target)) index.set(target, new Set());
      index.get(target)!.add(source);
    };
    for (const f of program.getSourceFiles()) {
      if (f.isDeclarationFile) continue;
      const visit = (n: ts.Node): void => {
        if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
          add(sigDecl(checker.getContextualType(n)), n);
        } else if (ts.isObjectLiteralExpression(n)) {
          const c = strip(checker.getContextualType(n));
          if (c) {
            for (const p of n.properties) {
              const nm = p.name !== undefined ? nameText(p.name) : null;
              const tp = nm === null ? undefined : c.getProperty(nm);
              if (!tp) continue;
              const target = sigDecl(checker.getTypeOfSymbolAtLocation(tp, n));
              if (ts.isMethodDeclaration(p)) add(target, p);
              else if (ts.isShorthandPropertyAssignment(p)) {
                const v = checker.getShorthandAssignmentValueSymbol(p);
                if (v) add(target, sigDecl(checker.getTypeOfSymbolAtLocation(v, p)));
              } else if (ts.isPropertyAssignment(p)) add(target, sigDecl(checker.getTypeAtLocation(p.initializer)));
            }
          }
        } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          add(sigDecl(checker.getTypeAtLocation(n.left)), sigDecl(checker.getTypeAtLocation(n.right)));
        } else if (ts.isVariableDeclaration(n) && n.type && n.initializer) {
          add(sigDecl(checker.getTypeFromTypeNode(n.type)), sigDecl(checker.getTypeAtLocation(n.initializer)));
        } else if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.arguments) {
          const sig = checker.getResolvedSignature(n);
          if (sig) {
            n.arguments.forEach((a, i) => {
              const p = sig.parameters[Math.min(i, sig.parameters.length - 1)];
              if (p) add(sigDecl(checker.getTypeOfSymbolAtLocation(p, n)), sigDecl(checker.getTypeAtLocation(a)));
            });
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(f);
    }
    reachImplIndexes.set(program, index);
    return index;
  })();
  const bodied = (d: ts.Node): boolean => 'body' in d && (d as { body?: ts.Node }).body !== undefined;
  /** Whether a call resolved to `d` goes through a function-typed value (a signature with no body of its own). */
  const viaSignature = (d: ts.Node): boolean =>
    !(bodied(d) || ts.isClassLike(d) || ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d) || ts.isConstructorDeclaration(d));
  const resolveImpls = (d: ts.Node, seen = new Set<ts.Node>()): ts.Node[] => {
    if (seen.has(d)) return [];
    seen.add(d);
    if (ts.isConstructorDeclaration(d)) return [d.parent];
    if (bodied(d) || ts.isClassLike(d)) return [d];
    if ((ts.isFunctionDeclaration(d) || ts.isMethodDeclaration(d)) && d.name) {
      const impl = checker.getSymbolAtLocation(d.name)?.declarations?.find(bodied);
      return impl ? [impl] : [];
    }
    return [...(implIndex.get(d) ?? [])].flatMap((s) => resolveImpls(s, seen));
  };

  const inScope = (n: ts.Node): boolean => scopeAbs.has(n.getSourceFile().fileName);
  const notFollowed = (n: ts.Node): boolean => n.getSourceFile().fileName === storeAbs || n.getSourceFile().isDeclarationFile;
  const declName = (d: ts.Node): string => {
    const parts: string[] = [];
    for (let n: ts.Node | undefined = d; n && !ts.isSourceFile(n); n = n.parent) {
      if (ts.isConstructorDeclaration(n)) parts.unshift('constructor');
      else if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n) || ts.isPropertyDeclaration(n)
        || ts.isVariableDeclaration(n) || ts.isGetAccessor(n) || ts.isMethodSignature(n) || ts.isPropertySignature(n)
        || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isPropertyAssignment(n))
        && n.name && ts.isIdentifier(n.name)) parts.unshift(n.name.text);
    }
    return `${rel(d.getSourceFile().fileName)}#${parts.join('.') || '<anon>'}`;
  };

  const record = (acc: ReachAcc, member: string, cls: ReachClass): void => {
    if (!acc.members.has(member)) acc.members.set(member, new Set());
    acc.members.get(member)!.add(cls);
  };
  const isTypePosition = (n: ts.Node): boolean => {
    let p = n.parent;
    while (p && ts.isQualifiedName(p)) p = p.parent;
    return !!p && p.kind >= ts.SyntaxKind.FirstTypeNode && p.kind <= ts.SyntaxKind.LastTypeNode;
  };
  const isCallArgument = (n: ts.Node): boolean => {
    const args: readonly ts.Node[] = ts.isCallExpression(n.parent) || ts.isNewExpression(n.parent) ? n.parent.arguments ?? [] : [];
    return args.includes(n);
  };
  const isBareStore = (n: ts.TypeReferenceNode): boolean => {
    if (ts.isIndexedAccessTypeNode(n.parent) && n.parent.objectType === n) return false;
    if (ts.isTypeReferenceNode(n.parent) || ts.isExpressionWithTypeArguments(n.parent)) return false;
    let s = checker.getSymbolAtLocation(n.typeName);
    if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
    return s === storeSym;
  };

  const calleeMemo = new Map<ts.Node, ReachAcc>();
  const calleeReach = (d: ts.Node): ReachAcc => {
    const hit = calleeMemo.get(d);
    if (hit) return hit;
    const acc = reachAcc();
    calleeMemo.set(d, acc);
    walk(d, acc, null);
    acc.wholeChain = dedupe(acc.wholeChain);
    return acc;
  };

  /** A store value in a slot: (b), or a port entry. */
  const slot = (n: ts.Expression, acc: ReachAcc, unit: string | null): void => {
    const k = kindOf(checker.getTypeAtLocation(n));
    if (!k) return;
    const p = n.parent;
    let c: ts.Type | undefined;
    if (ts.isShorthandPropertyAssignment(p) && p.name === n) {
      const ct = strip(checker.getContextualType(p.parent));
      const prop = ct?.getProperty(p.name.text);
      c = prop ? checker.getTypeOfSymbolAtLocation(prop, p.parent) : undefined;
    } else {
      c = checker.getContextualType(n);
    }
    if (!c) return;
    if (isExactPort(c)) {
      if (k.cls === 'whole' && unit !== null && !isCallArgument(n)) bump(acc.portEntries, `${unit} -> <slot>`);
      return;
    }
    const ck = kindOf(c);
    if (ck && ck.cls !== 'whole') { for (const m of ck.members) record(acc, m, k.cls); return; }
    if (!ck) for (const m of structural(c) ?? []) record(acc, m, k.cls);
  };

  /** (c) and (d): a call or `new` that hands a store value, carrier or thunk to the whole store or the port. */
  const handOff = (n: ts.CallExpression | ts.NewExpression, acc: ReachAcc, unit: string | null): void => {
    const sig = checker.getResolvedSignature(n);
    if (!sig) return;
    let whole = false;
    let port = false;
    let entry = false;
    (n.arguments ?? []).forEach((a, i) => {
      const ps = sig.parameters[Math.min(i, sig.parameters.length - 1)];
      if (!ps) return;
      const at = checker.getTypeAtLocation(a);
      const argWhole = carries(at, leafWhole);
      if (!argWhole && !carries(at, leafStore)) return;
      const pt = checker.getTypeOfSymbolAtLocation(ps, n);
      if (carries(pt, leafWhole)) { if (argWhole) whole = true; else port = true; }
      else if (carries(pt, leafPort)) { port = true; if (argWhole) entry = true; }
    });
    if (!whole && !port) return;
    let decl: ts.Node | undefined = sig.declaration;
    if (!decl && ts.isNewExpression(n)) {
      let s = checker.getSymbolAtLocation(n.expression);
      if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
      decl = s?.valueDeclaration;
    }
    if (!decl || notFollowed(decl)) return;
    const signature = viaSignature(decl);
    const impls = resolveImpls(decl).filter((d) => !notFollowed(d));
    if (impls.length === 0) {
      const unresolved = `UNRESOLVED ${declName(decl)}`;
      record(acc, unresolved, whole ? 'whole' : 'port');
      if (unit !== null && whole) {
        bump(acc.handoffs, `${unit} -> ${unresolved}`);
        acc.chains.set(`${unit} -> ${unresolved}`, acc.chains.get(`${unit} -> ${unresolved}`) ?? []);
      }
      if (unit !== null && entry) bump(acc.portEntries, `${unit} -> ${unresolved}`);
      return;
    }
    const target = signature ? declName(decl) : declName(impls[0]!);
    if (unit !== null && entry) bump(acc.portEntries, `${unit} -> ${target}`);
    const outside = impls.filter((d) => !inScope(d));
    if (outside.length === 0) return;
    const chain: string[] = [];
    for (const d of outside) {
      const sub = calleeReach(d);
      for (const [m, cls] of sub.members) for (const c of cls) record(acc, m, c);
      if (whole) chain.push(...sub.wholeChain, declName(d));
    }
    if (!whole) return;
    if (unit === null) { acc.wholeChain.push(...chain); return; }
    const key = `${unit} -> ${target}`;
    bump(acc.handoffs, key);
    acc.chains.set(key, dedupe([...(acc.chains.get(key) ?? []), ...chain]));
  };

  const walk = (root: ts.Node, acc: ReachAcc, unit: string | null): void => {
    const visit = (n: ts.Node): void => {
      if (unit !== null && ts.isTypeReferenceNode(n) && isBareStore(n)) acc.bare += 1;
      if (ts.isPropertyAccessExpression(n)) {
        const k = kindOf(checker.getTypeAtLocation(n.expression));
        if (k) record(acc, n.name.text, k.cls);
      } else if (ts.isElementAccessExpression(n)) {
        const k = kindOf(checker.getTypeAtLocation(n.expression));
        const a = n.argumentExpression;
        if (k) record(acc, ts.isStringLiteralLike(a) ? a.text : `[${a.getText()}]`, k.cls);
      }
      if ((ts.isIdentifier(n) || ts.isPropertyAccessExpression(n) || ts.isCallExpression(n) || ts.isNonNullExpression(n)
        || n.kind === ts.SyntaxKind.ThisKeyword) && !isTypePosition(n)) {
        const p = n.parent;
        const objectOfAccess = (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n;
        const aName = (ts.isPropertyAccessExpression(p) && p.name === n)
          || (!ts.isShorthandPropertyAssignment(p) && 'name' in p && (p as { name?: ts.Node }).name === n)
          || ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p);
        if (!objectOfAccess && !aName) slot(n as ts.Expression, acc, unit);
      }
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) handOff(n, acc, unit);
      ts.forEachChild(n, visit);
    };
    visit(root);
  };

  const units = new Map<string, ReachAcc>();
  const unitWalk = (name: string, node: ts.Node): void => {
    if (!units.has(name)) units.set(name, reachAcc());
    walk(node, units.get(name)!, name);
  };
  for (const f of files) {
    const sf = program.getSourceFile(path.join(base, f));
    if (!sf) throw new Error(`storeReach: ${f} is not in the program`);
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isImportEqualsDeclaration(st)) continue;
      if (ts.isClassDeclaration(st)) {
        const cls = st.name?.text ?? 'default';
        for (const m of st.members) {
          const nm = ts.isConstructorDeclaration(m) ? 'constructor' : (m.name !== undefined ? nameText(m.name) : null) ?? '<computed>';
          unitWalk(`${f}#${cls}.${nm}`, m);
        }
      } else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) unitWalk(`${f}#${nameText(d.name) ?? '<binding>'}`, d);
      } else {
        const nm = (ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)
          || ts.isEnumDeclaration(st)) && st.name ? st.name.text : '<top>';
        unitWalk(`${f}#${nm}`, st);
      }
    }
  }

  const all = new Map<string, Set<ReachClass>>();
  const handoffs = new Map<string, number>();
  const chains = new Map<string, string[]>();
  const portEntries = new Map<string, number>();
  const bare = new Map<string, number>();
  const unitMembers = new Map<string, string[]>();
  for (const [u, a] of units) {
    unitMembers.set(u, [...a.members.keys()].sort());
    for (const [m, cls] of a.members) {
      if (!all.has(m)) all.set(m, new Set());
      for (const c of cls) all.get(m)!.add(c);
    }
    for (const [k, v] of a.handoffs) handoffs.set(k, (handoffs.get(k) ?? 0) + v);
    for (const [k, v] of a.chains) chains.set(k, dedupe([...(chains.get(k) ?? []), ...v]));
    for (const [k, v] of a.portEntries) portEntries.set(k, (portEntries.get(k) ?? 0) + v);
    if (a.bare > 0) bare.set(u, a.bare);
  }
  const having = (cls: ReachClass): string[] => [...all].filter(([, c]) => c.has(cls)).map(([m]) => m).sort();
  return {
    diagnostics, files, units: sortedRecord(unitMembers), reach: [...all.keys()].sort(), wholeReach: having('whole'),
    portReach: having('port'), portMembers, wholeHandoffs: sortedRecord(handoffs), chains: sortedRecord(chains),
    portEntries: sortedRecord(portEntries), bareAnnotations: sortedRecord(bare),
  };
}
