// Landing order wave 5e: the landing line's entry has ONE writer. Keyed on symbols and call sites (`scan/symbols.ts`),
// never a literal source pin, so the store's growth ceiling is not touched. A later sub-wave that adds a writer of
// `landing_entries` adds it here by name.
// Wave 5f (task 1) adds ONE named exception: the live, genuine no-run creation INSERT in `writeLandingAuthority`'s apply
// step. `advanceLanding` stays the owner of pin, repin, ejection and the verified-pin witness; replay writes none of
// them; the journal-derived overlay (subjects, authority, cursor) has one SQL writer, the private
// `applyLandingRecord`; and one allocator (`nextId`, in `landingEntry.ts`) names every new entry id.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { identifierReferences, parseSource, ts, type ImportEdge, type ParsedFile } from './scan/parse.js';
import { callsIn, inlinedSourceOf, parsedFile, sqlStatementsInFile, symbolOf, REPO_ROOT } from './scan/symbols.js';
import { walkSrc } from './rings/walkSrc.js';

const STORE = 'server/src/coord/store.ts';
const ROUTES = 'server/src/coord/routes.ts';
const WRITER = 'CoordStore.advanceLanding';
const ADVANCE_ACT = 'registerCoordRoutes.advanceAct';
const FILES = walkSrc({ roots: ['server/src'], min: 150 });
const inWriter = (q: { file: string; start: number }) => {
  const s = symbolOf(STORE, WRITER);
  return q.file.endsWith(STORE) && q.start >= s.start && q.start < s.end;
};
const AUTHORITY = 'CoordStore.writeLandingAuthority';
const REPLAY = 'CoordStore.replayLandingJournal';
const APPLY = 'CoordStore.applyLandingRecord';
const inSymbol = (name: string) => (q: { file: string; start: number }) => {
  const s = symbolOf(STORE, name);
  return q.file.endsWith(STORE) && q.start >= s.start && q.start < s.end;
};
/** Migration 39 (and any later one) is DDL and the overlay's one seed row, in `schema.ts` template text that the
 *  statement scanner splits into several rows: it is not a runtime writer. The scan leaves that ONE file out, and a
 *  test below pins what it may hold, so the exclusion is narrow and checked rather than a weakened writer query. */
const SCHEMA = 'server/src/coord/schema.ts';
const isSchema = (q: { file: string }) => q.file.endsWith(SCHEMA);
const writes = (re: RegExp) => FILES.flatMap((f) => sqlStatementsInFile(f))
  .filter((q) => !isSchema(q) && ['INSERT', 'UPDATE', 'REPLACE'].includes(q.verb) && re.test(q.source));
const allWrites = (tableRe: RegExp) => FILES.flatMap((f) => sqlStatementsInFile(f))
  .filter((q) => !isSchema(q) && ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb) && tableRe.test(q.table ?? ''));

// ---- wave 5i Task 7: the callers of advanceLanding, read as AST spans and resolved through their bindings -------------
const LANDING_CALLERS: Record<string, { symbol: string; shape: 'run arm' | 'land object' | 'closeLandingOf value' }> = {
  'routes.ts': { symbol: 'advanceAct', shape: 'run arm' },
  'landedLane.ts': { symbol: 'landedPass', shape: 'land object' },
  'close.ts': { symbol: 'landOnClose', shape: 'closeLandingOf value' },
};

/** Parentheses, `as`, `satisfies`, `<T>x` and a non-null, taken off: the node the value actually is. */
function unwrapExpr(n: ts.Expression): ts.Expression {
  let e = n;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}
/** True when `e` sits under an `as` (or `<T>x`) cast anywhere between itself and the value it returns. A cast hides the
 *  shape; `satisfies` and parentheses do not. */
function castOf(n: ts.Expression): boolean {
  let e = n;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isTypeAssertionExpression(e) || ts.isNonNullExpression(e)) {
    if (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e)) return true;
    e = e.expression;
  }
  return false;
}
const propName = (m: ts.ObjectLiteralElementLike): string | null =>
  m.name !== undefined && (ts.isIdentifier(m.name) || ts.isStringLiteralLike(m.name)) ? m.name.text : null;
const isLandKind = (m: ts.ObjectLiteralElementLike): boolean =>
  ts.isPropertyAssignment(m) && propName(m) === 'kind' && ts.isStringLiteralLike(m.initializer) && m.initializer.text === 'land';

/** The scope container of a declaration: the nearest block, case block, loop, function or file holding it. */
function scopeOf(n: ts.Node): ts.Node {
  let p = n.parent;
  while (!(ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p) || ts.isCaseBlock(p) || ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isFunctionLike(p))) p = p.parent;
  return p;
}

/**
 * The binding-aware caller check (wave 5i Task 7). It finds the ONE `advanceLanding` call in the caller symbol the file
 * names, takes its argument as a whole AST node (never a character window), and holds the argument to the caller's shape:
 * `advanceAct` passes a run arm (an object literal with `runId`, no `kind`, no spread, no cast); `landedPass` passes a land
 * object (an object literal with `kind: 'land'` and `expect`, no spread, no cast); `landOnClose` passes an identifier whose
 * innermost lexical binding is a `const` initialised by `closeLandingOf(…)`, through parentheses, `satisfies`, a non-null
 * and immutable `const` aliases, and refuses a parameter shadow, a `let`/`var`, a reassignment, a second declaration of
 * the name, a cast, a computed or unresolved expression. Throws a message naming what failed.
 */
export function assertLandingCallerBindings(text: string, file: string): void {
  const spec = LANDING_CALLERS[path.basename(file)];
  if (spec === undefined) throw new Error(`${file}: no landing caller is declared for this file`);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const parsed = parseSource(text, file);
  const syms = parsed.symbols.filter((s) => s.name === spec.symbol || s.name.endsWith(`.${spec.symbol}`));
  if (syms.length !== 1) throw new Error(`${file}: expected one symbol ${spec.symbol}, found ${syms.length}`);
  const sym = syms[0]!;
  const calls: ts.CallExpression[] = [];
  const find = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.getStart(sf) >= sym.start && n.end <= sym.end
      && ((ts.isIdentifier(n.expression) && n.expression.text === 'advanceLanding')
        || (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'advanceLanding'))) calls.push(n);
    ts.forEachChild(n, find);
  };
  find(sf);
  if (calls.length !== 1) throw new Error(`${file}#${spec.symbol}: expected exactly one advanceLanding call, found ${calls.length}`);
  const call = calls[0]!;
  if (call.arguments.length !== 1) throw new Error(`${file}#${spec.symbol}: advanceLanding takes one argument, got ${call.arguments.length}`);
  const arg = call.arguments[0]!;
  const fail = (why: string): never => { throw new Error(`${file}#${spec.symbol}: ${why}`); };

  if (spec.shape === 'run arm' || spec.shape === 'land object') {
    const obj = unwrapExpr(arg);
    if (!ts.isObjectLiteralExpression(obj) || castOf(arg)) return fail(`the ${spec.shape} must be an object literal at the call, uncast`);
    const props = obj.properties;
    if (props.some((m) => ts.isSpreadAssignment(m) || propName(m) === null)) return fail(`the ${spec.shape} has a spread or computed member`);
    const names = props.map((m) => propName(m));
    if (spec.shape === 'run arm') {
      if (!names.includes('runId') || names.includes('kind') || props.some(isLandKind)) fail("the run arm must carry runId and no 'kind' member");
    } else if (!props.some(isLandKind) || !names.includes('expect')) fail("the land object must carry kind: 'land' and expect");
    return;
  }

  // landOnClose: the value produced by closeLandingOf, resolved through its innermost lexical binding.
  const producer = (name: string, from: ts.Node, depth: number): void => {
    if (depth > 4) fail(`closeLandingOf: the alias chain of '${name}' is too long`);
    const decls: ts.VariableDeclaration[] = [];
    const params: ts.ParameterDeclaration[] = [];
    const assigns: ts.Node[] = [];
    const collect = (n: ts.Node): void => {
      if (n.getStart(sf) >= sym.start && n.end <= sym.end) {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) decls.push(n);
        if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.name.text === name) params.push(n);
        if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          && ts.isIdentifier(unwrapExpr(n.left)) && (unwrapExpr(n.left) as ts.Identifier).text === name) assigns.push(n);
        if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)
          && ts.isIdentifier(n.operand) && n.operand.text === name) assigns.push(n);
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);
    // the parameters of the symbol itself count: the scan over the symbol's span includes its own signature
    if (params.length > 0) fail(`closeLandingOf: '${name}' is a parameter, which shadows the binding`);
    if (assigns.length > 0) fail(`closeLandingOf: '${name}' is reassigned`);
    if (decls.length !== 1) fail(`closeLandingOf: '${name}' has ${decls.length} declarations; exactly one producer is allowed`);
    const decl = decls[0]!;
    // innermost lexical binding: the declaration's scope must enclose the use, and it must precede it
    const scope = scopeOf(decl);
    if (!(scope.getStart(sf) <= from.getStart(sf) && from.end <= scope.end) || decl.getStart(sf) > from.getStart(sf)) fail(`closeLandingOf: '${name}' does not resolve to a binding visible at the call`);
    const list = decl.parent;
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) fail(`closeLandingOf: '${name}' is not a const`);
    if (decl.initializer === undefined) fail(`closeLandingOf: '${name}' has no initialiser`);
    const init = decl.initializer!;
    if (castOf(init)) fail(`closeLandingOf: '${name}' is cast, which hides what it holds`);
    const value = unwrapExpr(init);
    if (ts.isIdentifier(value)) return producer(value.text, decl, depth + 1);
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'closeLandingOf') return;
    fail(`closeLandingOf: '${name}' is not bound from closeLandingOf(...)`);
  };
  const value = unwrapExpr(arg);
  if (castOf(arg)) fail('closeLandingOf: the argument is cast');
  if (!ts.isIdentifier(value)) fail('closeLandingOf: the argument is not an identifier bound from closeLandingOf(...)');
  producer((value as ts.Identifier).text, call, 0);
}

describe('the landing line has one writer (landing order wave 5e, D-7614)', () => {
  it('pinnedSha has one writer, advanceLanding, but for the genuine no-run creation INSERT (5f)', () => {
    expect(writes(/\bpinnedSha\b/i).length).toBeGreaterThanOrEqual(2);
    const outside = writes(/\bpinnedSha\b/i).filter((q) => !inWriter(q));
    expect(outside.map((q) => `${q.verb} ${q.table}`)).toEqual(['INSERT landing_entries']);
    expect(outside.every(inSymbol(AUTHORITY))).toBe(true);
  });

  it('ejections has one writer, advanceLanding', () => {
    expect(writes(/\bejections\b/i).length).toBeGreaterThanOrEqual(1);
    expect(writes(/\bejections\b/i).filter((q) => !inWriter(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
  });

  it('every write of landing_entries is advanceLanding\'s, but for the narrow live no-run creation INSERT in writeLandingAuthority (5e, 5f)', () => {
    const all = allWrites(/^landing_entries$/);
    expect(all.length).toBeGreaterThanOrEqual(4);
    const outside = all.filter((q) => !inWriter(q));
    // walked in sorted path order: `landingDoorsTx.ts` sorts before `store.ts`
    expect(outside.map((q) => `${q.verb}:${inSymbol(AUTHORITY)(q)}`)).toEqual(['UPDATE:false', 'INSERT:true']);
    // the exception creates a no-run projection only: a NULL runId, state 'pinned', and nothing else
    const creation = outside.filter((q) => q.verb === 'INSERT');
    expect(creation).toHaveLength(1);
    expect(creation[0]!.source.replace(/\s+/g, ' ')).toMatch(/VALUES \(\?, \?, \?, \?, \?, NULL, 'pinned', \?, \?\)/);
    // wave 5j-a (D-9046): the operator's withdrawal, the one other writer, in `landingDoorsTx.ts#applyLandingDoorRecordTx`
    const withdraw = outside.filter((q) => q.verb === 'UPDATE');
    expect(withdraw.map((q) => path.basename(q.file))).toEqual(['landingDoorsTx.ts']);
    expect(withdraw[0]!.source.replace(/\s+/g, ' ')).toMatch(
      /UPDATE landing_entries SET state = 'withdrawn', quarantineKind = NULL, detail = \? WHERE id = \? AND project = \? AND pr = \? AND state NOT IN \(\$\{TERMINAL_SQL\}\)/);
  });

  it('every write of landing_intents is an INSERT inside holdLandingIntent, the one writer (5g; D-6096: dispatchRun and bindInPlace both call it)', () => {
    const all = allWrites(/^landing_intents$/);
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.filter((q) => !inSymbol('CoordStore.holdLandingIntent')(q)).map((q) => `${q.verb} ${q.file}:${q.text}`)).toEqual([]);
    expect(all.map((q) => q.verb)).toEqual(['INSERT']);
  });

  it('quarantineKind has one marking writer, advanceLanding: the quarantine UPDATE marks it, the verified re-pin clears it, and the operator\'s withdrawal only clears it (5f Task 3, 5j-a)', () => {
    const marks = writes(/\bquarantineKind\b/i);
    expect(marks.map((q) => q.verb), 'the withdrawal UPDATE, the quarantine UPDATE and the re-pin UPDATE').toEqual(['UPDATE', 'UPDATE', 'UPDATE']);
    // wave 5j-a (D-9046): the one other writer is the withdraw statement, which only clears the marker
    const outside = marks.filter((q) => !inWriter(q));
    expect(outside.map((q) => path.basename(q.file))).toEqual(['landingDoorsTx.ts']);
    expect(outside[0]!.source.replace(/\s+/g, ' ')).toMatch(/SET state = 'withdrawn', quarantineKind = NULL,/);
    expect(outside[0]!.source).not.toMatch(/stale-episode-head/);
    const flat = marks.filter(inWriter).map((q) => q.source.replace(/\s+/g, ' '));
    expect(flat.filter((t) => /quarantineKind = 'stale-episode-head'/.test(t))).toHaveLength(1);
    expect(flat.filter((t) => /quarantineKind = NULL/.test(t))).toHaveLength(1);
    // the decision is made in the pure decider and acted on inside the one writer: nothing else calls it
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'decideLandingWrite').map((c) => ({ file: f, start: c.start })));
    expect(calls).toHaveLength(1);
    expect(calls.every(inWriter)).toBe(true);
  });

  it('advanceLanding owns pin, repin, ejection and quarantine on landing_entries and the one witness write; replay reaches only the withdrawal', () => {
    expect(allWrites(/^landing_entries$/).filter(inWriter).map((q) => q.verb).sort()).toEqual(['INSERT', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE']);
    const witness = allWrites(/^landing_projection_witness$/);
    expect(witness.length).toBe(1);
    expect(witness.every(inWriter)).toBe(true);
    // replay: no landing_entries write and no witness write of its own, and it never calls the creation or the witness
    // writer. Wave 5j-a (D-9046): it reaches exactly one landing_entries statement, the operator's withdrawal, through
    // applyLandingRecord and its companion, and the applier's own SQL writes neither table.
    const replaySql = FILES.flatMap((f) => sqlStatementsInFile(f)).filter((q) => !isSchema(q) && inSymbol(REPLAY)(q));
    expect(replaySql.filter((q) => ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb) && /landing_(entries|projection_witness)/.test(q.source)).map((q) => q.text)).toEqual([]);
    const applySql = FILES.flatMap((f) => sqlStatementsInFile(f)).filter((q) => !isSchema(q) && inSymbol(APPLY)(q));
    expect(applySql.filter((q) => /landing_(entries|projection_witness)/.test(q.source)).map((q) => q.text)).toEqual([]);
    expect(callsIn(symbolOf(STORE, APPLY)).map((c) => c.name)).toContain('applyLandingDoorRecordTx');
    const doors = FILES.filter((f) => f.endsWith('/landingDoorsTx.ts')).flatMap((f) => sqlStatementsInFile(f))
      .filter((q) => ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb) && /landing_(entries|projection_witness)/.test(q.source));
    expect(doors.map((q) => `${q.verb} ${q.table}`)).toEqual(['UPDATE landing_entries']);
    const replayCalls = callsIn(symbolOf(STORE, REPLAY)).map((c) => c.name);
    expect(replayCalls).toContain('applyLandingRecord');
    expect(replayCalls).not.toContain('advanceLanding');
    expect(replayCalls).not.toContain('writeLandingAuthority');
    expect(replayCalls).not.toContain('appendThenApply');
  });

  it('the overlay has one SQL writer, the private applyLandingRecord, called only by writeLandingAuthority and replay', () => {
    const overlay = allWrites(/^landing_(subjects|authority|journal_cursor)$/);
    expect(overlay.map((q) => q.table).sort()).toEqual(['landing_authority', 'landing_journal_cursor', 'landing_subjects']);
    expect(overlay.filter((q) => !inSymbol(APPLY)(q)).map((q) => `${q.file}:${q.text}`)).toEqual([]);
    const callers = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'applyLandingRecord').map((c) => ({ file: f, start: c.start })));
    expect(callers.length).toBe(2);
    expect(callers.filter((c) => !inSymbol(AUTHORITY)(c) && !inSymbol(REPLAY)(c))).toEqual([]);
  });

  it('migration DDL is not a runtime writer: schema.ts holds only DDL on the landing tables and the cursor\'s one seed', () => {
    const inSchema = FILES.flatMap((f) => sqlStatementsInFile(f)).filter((q) => isSchema(q) && /landing_/.test(q.source));
    expect(inSchema.length).toBeGreaterThan(0);
    const dml = inSchema.filter((q) => ['INSERT', 'UPDATE', 'REPLACE', 'DELETE'].includes(q.verb)).map((q) => `${q.verb} ${q.table}`);
    expect(dml.every((d) => d === 'INSERT landing_journal_cursor')).toBe(true);
  });

  it('one allocator: the entry id is the facts\' nextId, produced in landingEntry.ts and consumed by landingWrites.ts and the store', () => {
    const NAMES = new Set(['nextId']);
    // other contexts keep an unrelated `nextId` (the remote client's request counter): the question is the coordination one
    const holders = FILES.filter((f) => /\/coord\/[^/]+$/.test(f) && identifierReferences(parsedFile(f).text, f, NAMES).length > 0)
      .map((f) => path.basename(f)).sort();
    expect(holders).toEqual(['landingEntry.ts', 'landingWrites.ts', 'store.ts']);
    // and no second allocator under another name: every landing_entries INSERT binds its id first, from the reserved
    // id (advanceLanding) or the decided mutation's id (writeLandingAuthority), and no landing SQL takes a MAX itself
    const store = parsedFile('server/src/coord/store.ts').text;
    const inserts = [...store.matchAll(/INSERT INTO landing_entries \(([^)]*)\)[\s\S]*?\.run\(([^,]+),/g)];
    expect(inserts.length).toBe(2);
    for (const m of inserts) {
      expect(m[1]!.split(',')[0]!.trim()).toBe('id');
      expect(['reserved', 'mutation.id']).toContain(m[2]!.trim());
    }
    expect(store.match(/MAX\([^)]*\)[^'"`]*FROM landing_/g) ?? []).toEqual([]);
  });

  it("landingFactsInner reads its own project's rows whole and every other project's rows as id, project and pr only", () => {
    const inner = symbolOf(STORE, 'CoordStore.landingFactsInner');
    const reads = FILES.flatMap((f) => sqlStatementsInFile(f))
      .filter((q) => !isSchema(q) && q.verb === 'SELECT' && q.table === 'landing_entries' && q.file.endsWith(STORE) && q.start >= inner.start && q.start < inner.end);
    const flat = reads.map((q) => q.source.replace(/\s+/g, ' ').trim());
    expect(flat).toHaveLength(2);
    const own = flat.filter((x) => /WHERE project = \?/.test(x));
    const foreign = flat.filter((x) => /WHERE project <> \?/.test(x));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatch(/SELECT id, project, pr, pinnedSha, /);
    expect(foreign).toHaveLength(1);
    expect(foreign[0]).toMatch(/SELECT id, project, pr FROM landing_entries WHERE project <> \?/);
  });

  it('the merging-at detail is built only inside advanceLanding', () => {
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'mergingAtDetail').map((c) => ({ file: f, start: c.start })));
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((q) => !inWriter(q))).toEqual([]);
  });

  it('advanceAct reaches the store through advanceLanding only', () => {
    const names = callsIn(symbolOf(ROUTES, ADVANCE_ACT)).map((c) => c.name);
    expect(names).toContain('advanceLanding');
    expect(names).not.toContain('advance');
  });

  it('detail has two statements inside advanceLanding, the land UPDATE writing state and detail and nothing else and the re-pin UPDATE clearing it, and one outside, the operator\'s withdrawal (5j-a)', () => {
    const marks = writes(/\bdetail\b/i).filter((q) => /^landing_entries$/.test(q.table ?? ''));
    expect(marks.map((q) => q.verb)).toEqual(['UPDATE', 'UPDATE', 'UPDATE']);
    // wave 5j-a (D-9046): the one statement outside is the withdraw statement in landingDoorsTx.ts
    const outside = marks.filter((q) => !inWriter(q));
    expect(outside.map((q) => path.basename(q.file))).toEqual(['landingDoorsTx.ts']);
    expect(outside[0]!.source.replace(/\s+/g, ' ')).toMatch(/SET state = 'withdrawn', quarantineKind = NULL, detail = \? WHERE/);
    const flat = marks.filter(inWriter).map((q) => q.source.replace(/\s+/g, ' '));
    expect(flat.filter((t) => /SET state = \?, detail = \? WHERE id = \?/.test(t))).toHaveLength(1);
    expect(flat.filter((t) => /\bdetail = NULL\b/.test(t))).toHaveLength(1);
  });

  it('advanceLanding is declared once', () => {
    expect(() => symbolOf(STORE, WRITER)).not.toThrow();
    const text = parsedFile(STORE).text;
    expect(text.match(/^\s*advanceLanding[<(]/gm) ?? []).toHaveLength(1);
  });

  it('decideLandingLand has one call, inside advanceLanding', () => {
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'decideLandingLand').map((c) => ({ file: f, start: c.start })));
    expect(calls).toHaveLength(1);
    expect(calls.every(inWriter)).toBe(true);
  });

  const CLOSE = 'server/src/coord/close.ts';
  const LANE = 'server/src/coord/landedLane.ts';
  const CLOSE_LAND = 'landOnClose';
  const LANE_PASS = 'landedPass';

  it('advanceLanding has three callers, each named by symbol: advanceAct, the close\'s landOnClose and the lane\'s landedPass; only advanceAct passes a run arm', () => {
    const calls = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'advanceLanding')
      .map((c) => ({ file: f, start: c.start })));
    expect(calls).toHaveLength(3);
    const within = (file: string, name: string) => {
      const s = symbolOf(file, name);
      return calls.filter((c) => c.file.endsWith(file) && c.start >= s.start && c.start < s.end);
    };
    expect(within(ROUTES, ADVANCE_ACT), 'advanceAct').toHaveLength(1);
    expect(within(CLOSE, CLOSE_LAND), 'close.ts#landOnClose').toHaveLength(1);
    expect(within(LANE, LANE_PASS), 'landedLane.ts#landedPass').toHaveLength(1);
    // wave 5i Task 7: the argument is read as a whole AST span and resolved through its binding, never a 400-character window.
    for (const file of [ROUTES, LANE, CLOSE]) {
      expect(() => assertLandingCallerBindings(parsedFile(file).text, file), file).not.toThrow();
    }
  });

  describe('assertLandingCallerBindings reads the argument, not its spelling (wave 5i Task 7)', () => {
    const closeText = (): string => parsedFile(CLOSE).text;
    const routesText = (): string => parsedFile(ROUTES).text;
    const laneText = (): string => parsedFile(LANE).text;
    const swap = (text: string, from: string, to: string): string => {
      expect(text.split(from).length - 1, `the probe's anchor is gone: ${from}`).toBe(1);
      return text.replace(from, to);
    };
    const PRODUCER = 'const land = closeLandingOf({ state, facts, project: run.project, at });';
    /** A one-function probe for the close arm: `body` replaces the binding line of `landOnClose`. */
    const closeProbe = (body: string, param = 'line: CcdPrLine'): string =>
      `function landOnClose(deps: D, run: RunRow, state: 'done', ${param}, at: number): void {\n${body}\n  deps.coord.advanceLanding(land);\n}\n`;

    it('the real close, route and lane pass; a producer rebound to a cast run arm throws, and so does a padded run arm', () => {
      expect(() => assertLandingCallerBindings(closeText(), CLOSE)).not.toThrow();
      const rebound = swap(closeText(), PRODUCER, "const land = { runId: 1, to: 'done', causedBy: 'coordinator' } as unknown as LandingLand;");
      expect(() => assertLandingCallerBindings(rebound, CLOSE)).toThrow(/closeLandingOf/);
      const padded = swap(routesText(), "causedBy: 'coordinator', landing })", `causedBy: 'coordinator', landing,${' '.repeat(600)}kind: 'land' })`);
      expect(() => assertLandingCallerBindings(padded, ROUTES)).toThrow(/run arm/);
      const pastTheWindow = swap(laneText(), "kind: 'land', project: cand.project", `project: cand.project, ${'/* pad */ '.repeat(60)}kind: 'land'`);
      expect(() => assertLandingCallerBindings(pastTheWindow, LANE), 'a land object whose kind moves past 400 characters is still read').not.toThrow();
    });

    it('the lane must pass a land object and the route a run arm: each refuses the other\'s shape', () => {
      expect(() => assertLandingCallerBindings(swap(laneText(), "kind: 'land', project: cand.project", "kind: 'run', project: cand.project"), LANE)).toThrow(/land object/);
      expect(() => assertLandingCallerBindings(swap(routesText(), 'runId: id, to, causedBy', 'to, causedBy'), ROUTES)).toThrow(/run arm/);
      expect(() => assertLandingCallerBindings(swap(routesText(), 'coord.advanceLanding({ runId: id', 'coord.advanceLanding({ ...extra, runId: id'), ROUTES)).toThrow(/run arm/);
    });

    it('the close accepts the immutable forms: parentheses, satisfies, a non-null and a const alias', () => {
      expect(() => assertLandingCallerBindings(closeProbe(`  ${PRODUCER}`), CLOSE)).not.toThrow();
      expect(() => assertLandingCallerBindings(closeProbe('  const land = (closeLandingOf({ state }) satisfies LandingLand);'), CLOSE)).not.toThrow();
      expect(() => assertLandingCallerBindings(closeProbe('  const made = closeLandingOf({ state });\n  const land = made;'), CLOSE)).not.toThrow();
      expect(() => assertLandingCallerBindings(closeProbe('  const land = closeLandingOf({ state })!;'), CLOSE)).not.toThrow();
    });

    it('the close refuses a parameter shadow, a reassignment, a second producer, a computed or unresolved expression', () => {
      for (const [what, text, phrase] of [
        ['a parameter named land', closeProbe(`  ${PRODUCER}`, 'land: LandingLand'), /parameter/],
        ['a let binding', closeProbe('  let land = closeLandingOf({ state });'), /not a const/],
        ['a reassignment', closeProbe(`  ${PRODUCER}\n  (land as unknown) = other;`), /reassigned/],
        ['a second producer', closeProbe(`  ${PRODUCER}\n  { const land = makeOther(); void land; }`), /declarations/],
        ['an inner shadow', closeProbe(`  ${PRODUCER}\n  if (state) { const land = other; void land; }`), /declarations/],
        ['an alias of a cast', closeProbe('  const made = other as LandingLand;\n  const land = made;'), /cast/],
        ['no binding', closeProbe('  void 0;'), /declarations/],
      ] as const) expect(() => assertLandingCallerBindings(text, CLOSE), what).toThrow(phrase);
      const computed = `function landOnClose(deps: D): void {\n  deps.coord.advanceLanding(pick());\n}\n`;
      expect(() => assertLandingCallerBindings(computed, CLOSE), 'a computed argument').toThrow(/closeLandingOf/);
      const element = `function landOnClose(deps: D): void {\n  const lands = [closeLandingOf({})];\n  deps.coord.advanceLanding(lands[0]);\n}\n`;
      expect(() => assertLandingCallerBindings(element, CLOSE), 'an element access').toThrow(/closeLandingOf/);
    });

    it('a file with no caller, two callers, or a file the census does not know is a refusal', () => {
      expect(() => assertLandingCallerBindings('function landOnClose(): void {}', CLOSE)).toThrow(/advanceLanding/);
      expect(() => assertLandingCallerBindings(closeProbe(`  ${PRODUCER}\n  deps.coord.advanceLanding(land);`), CLOSE)).toThrow(/advanceLanding/);
      expect(() => assertLandingCallerBindings('', 'server/src/coord/other.ts')).toThrow(/no landing caller/);
    });
  });

  it('advanceLanding decides the edge before it writes, in one tx', () => {
    const src = inlinedSourceOf(symbolOf(STORE, WRITER));
    const at = (n: string) => { const i = src.indexOf(n); expect(i, n).toBeGreaterThan(-1); return i; };
    expect(at('transitionsFor(')).toBeLessThan(at('this.advanceInner('));
    expect(at('this.advanceInner(')).toBeLessThan(at('INSERT INTO landing_entries'));
    expect(src.split('tx(this.db').length - 1).toBe(1);
  });
});

describe('wave 5i ownership: one writer of mainRedHold, terminal repair inside advanceLanding, pure policy modules (Task 7)', () => {
  const CONTROL_TX = 'server/src/coord/landingControlTx.ts';
  const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
  const isNodeBuiltin = (specifier: string): boolean => specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/')[0]!);
  const valueEdges = (p: ParsedFile): ImportEdge[] => p.imports.filter((e) => {
    if (e.kind === 'type-query' || e.typeOnly) return false;
    return e.names.length === 0 || !e.names.every((n) => (e.typeNames ?? []).includes(n));
  });
  const CLOCK_AND_FS = new Set(['Date', 'performance', 'fs', 'require', 'readFileSync', 'writeFileSync', 'readFile', 'writeFile', 'setTimeout', 'setInterval']);
  /** `Date.parse(text)` is a pure parse of a given string, not a clock read (`landed.ts#landedNoticeModeOf` parses a PR's mergedAt).
   *  Only the `Date` that is the receiver of `.parse(` is exempt: any other `Date` on the same line (`Date.now`, `new Date`) still counts. */
  const dateParseReceiverLines = (p: ParsedFile): Map<number, number> => {
    const sf = ts.createSourceFile(p.path, p.text, ts.ScriptTarget.Latest, true);
    const out = new Map<number, number>();
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === 'Date' && ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n
        && n.parent.name.text === 'parse' && ts.isCallExpression(n.parent.parent) && n.parent.parent.expression === n.parent) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        out.set(line, (out.get(line) ?? 0) + 1);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  };
  const clockAndFs = (p: ParsedFile): string[] => {
    const exempt = dateParseReceiverLines(p);
    return identifierReferences(p.text, p.path, CLOCK_AND_FS)
      .filter((x) => {
        if (x.name !== 'Date') return true;
        const left = exempt.get(x.line) ?? 0;
        if (left === 0) return true;
        exempt.set(x.line, left - 1);
        return false;
      })
      .map((x) => `${x.line} ${x.name}`);
  };
  const STORE_NAMES = new Set(['CoordStore', 'db']);
  const storeReaches = (p: ParsedFile): string[] => [
    ...identifierReferences(p.text, p.path, STORE_NAMES).map((x) => `${x.line} ${x.name}`),
    ...p.imports.filter((x) => /(^|\/)(store|db|schema)(\.js)?$/.test(x.specifier) && !x.typeOnly && x.kind !== 'type-query'
      && !(x.names.length > 0 && x.names.every((n) => (x.typeNames ?? []).includes(n)))).map((x) => `${x.line} ${x.specifier}`),
  ];

  it('mainRedHold is written by ONE statement, the UPSERT in landingControlTx.ts, and operatorPaused is not in its SET', () => {
    const marks = writes(/\bmainRedHold\b/i);
    expect(marks.map((q) => `${q.verb} ${q.table} ${path.basename(q.file)}`)).toEqual(['INSERT landing_projects landingControlTx.ts']);
    const flat = marks[0]!.source.replace(/\s+/g, ' ');
    expect(flat).toMatch(/ON CONFLICT\(project\) DO UPDATE SET mainRedHold = excluded\.mainRedHold['"`]?$/);
    expect(flat).not.toMatch(/operatorPaused/);
    // and the table has two runtime writers, one per flag: this one, and since wave 5j-a the operator's pause statement
    expect(allWrites(/^landing_projects$/).map((q) => `${q.verb} ${path.basename(q.file)}`)).toEqual(['INSERT landingControlTx.ts', 'INSERT landingDoorsTx.ts']);
  });

  it('operatorPaused is written by ONE statement, the pause UPSERT in landingDoorsTx.ts, which names no mainRedHold, called only by applyLandingRecord (5j-a, D-9046)', () => {
    const marks = writes(/\boperatorPaused\b/i);
    expect(marks.map((q) => `${q.verb} ${q.table} ${path.basename(q.file)}`)).toEqual(['INSERT landing_projects landingDoorsTx.ts']);
    const flat = marks[0]!.source.replace(/\s+/g, ' ');
    expect(flat).toMatch(/INSERT INTO landing_projects \(project, operatorPaused\) VALUES \(\?, \?\) ON CONFLICT\(project\) DO UPDATE SET operatorPaused = excluded\.operatorPaused['"`]?$/);
    expect(flat).not.toMatch(/mainRedHold/);
    const callers = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'applyLandingDoorRecordTx').map((c) => ({ file: f, start: c.start })));
    expect(callers).toHaveLength(1);
    expect(callers.every(inSymbol(APPLY))).toBe(true);
  });

  it('the transaction body is called only by CoordStore.applyLandingControl, inside its tx', () => {
    const callers = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'applyLandingControlTx').map((c) => ({ file: f, start: c.start })));
    expect(callers).toHaveLength(1);
    expect(callers.every(inSymbol('CoordStore.applyLandingControl'))).toBe(true);
    const src = inlinedSourceOf(symbolOf(STORE, 'CoordStore.applyLandingControl'));
    expect(src.indexOf('tx(this.db')).toBeGreaterThan(-1);
    expect(src.indexOf('tx(this.db')).toBeLessThan(src.indexOf('applyLandingControlTx('));
    // the sibling of nothing: the INSERT sits in the one body function
    const body = symbolOf(CONTROL_TX, 'applyLandingControlTx');
    expect(sqlStatementsInFile(CONTROL_TX).filter((q) => q.verb === 'INSERT' && q.start >= body.start && q.start < body.end)).toHaveLength(1);
  });

  /** The file's code with its comments cut out, so a word in a header cannot satisfy or trip a scan. */
  const codeOf = (file: string): string => parsedFile(file).text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

  it('the transaction body holds the database handle once, in applyLandingControlTx, opens no transaction of its own, and only store.ts imports it', () => {
    const code = codeOf(CONTROL_TX);
    expect(code.match(/\bcoord\.db\b/g) ?? [], 'the handle is named exactly once').toHaveLength(1);
    const body = symbolOf(CONTROL_TX, 'applyLandingControlTx');
    const handle = identifierReferences(parsedFile(CONTROL_TX).text, CONTROL_TX, new Set(['db']));
    expect(handle, 'one reference to db').toHaveLength(1);
    const at = parsedFile(CONTROL_TX).text.indexOf('coord.db');
    expect(at >= body.start && at < body.end, 'the one reference sits inside applyLandingControlTx').toBe(true);
    expect(code.match(/\b(async|await|Promise|BEGIN|COMMIT|ROLLBACK)\b|\btx\(/g) ?? [], 'no async, promise or transaction keyword').toEqual([]);
    const importers = FILES.filter((f) => f !== CONTROL_TX && parsedFile(f).imports.some((e) => /(^|\/)landingControlTx(\.js)?$/.test(e.specifier)));
    expect(importers).toEqual([STORE]);
  });

  it('terminal repair rides advanceLanding: its verdict is read inside the land arm before the one state/detail UPDATE, and its token is built once, in the facts', () => {
    const src = inlinedSourceOf(symbolOf(STORE, WRITER));
    const at = (n: string): number => { const i = src.indexOf(n); expect(i, n).toBeGreaterThan(-1); return i; };
    expect(src.split('terminalRepairs.find(').length - 1).toBe(1);
    expect(at('terminalRepairs.find(')).toBeLessThan(at('decideLandingLand('));
    expect(at('decideLandingLand(')).toBeLessThan(at("UPDATE landing_entries SET state = ?, detail = ? WHERE id = ?"));
    // the repair adds no writer: the state/detail UPDATE is still the one statement (the census above) and no other symbol holds it
    const marks = writes(/\bdetail\b/i).filter((q) => /^landing_entries$/.test(q.table ?? '')).filter((q) => /SET state = \?, detail = \?/.test(q.source.replace(/\s+/g, ' ')));
    expect(marks).toHaveLength(1);
    expect(marks.every(inWriter)).toBe(true);
    // the token builder: declared once and called once, by the facts reader, and nothing else names it
    const builders = FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'terminalRepairTokens').map((c) => ({ file: f, start: c.start })));
    expect(builders).toHaveLength(1);
    expect(builders.every(inSymbol('CoordStore.landingFactsInner'))).toBe(true);
    expect(() => symbolOf(STORE, 'CoordStore.terminalRepairTokens')).not.toThrow();
    // a repair is no fourth caller of the writer: the census of callers above stays three
    expect(FILES.flatMap((f) => parsedFile(f).calls.filter((c) => c.name === 'advanceLanding')).length).toBe(3);
  });

  const POLICY_VALUE_IMPORTS: Record<string, string[]> = {
    'server/src/coord/landingNext.ts': ['./landingLine.js'],
    'server/src/coord/landingReadView.ts': ['./landingLine.js'],
    'server/src/coord/landed.ts': ['../laneSchedule.js', './landingEntry.js'],
    'server/src/coord/landingLine.ts': ['../../../shared/landingLine.js', '../../../shared/api.js'],
  };

  it('the new policy modules read no clock and no filesystem, import no node builtin and reach no store', () => {
    for (const [file, values] of Object.entries(POLICY_VALUE_IMPORTS)) {
      const p = parsedFile(file);
      expect(p.calls.length, `${file} parses to nothing`).toBeGreaterThan(0);
      expect(clockAndFs(p), `${file} reads the clock or reaches for a filesystem`).toEqual([]);
      expect(p.imports.map((x) => x.specifier).filter(isNodeBuiltin), `${file} imports a node builtin`).toEqual([]);
      expect(storeReaches(p), `${file} reaches the store`).toEqual([]);
      expect(valueEdges(p).map((x) => x.specifier), `${file}'s value imports`).toEqual(values);
      expect(p.imports.filter((x) => x.kind === 'dynamic' || x.kind === 'export-from' || (x.kind === 'import' && !x.typeOnly && x.names.length === 0)), `${file}: a side-effect, dynamic or re-export edge`).toEqual([]);
    }
  });

  it('landingLine.ts takes only freshWithin and RADAR_PROBE_FRESH_S from shared/api.js', () => {
    const edge = parsedFile('server/src/coord/landingLine.ts').imports.find((x) => x.specifier === '../../../shared/api.js')!;
    expect([...edge.names].sort()).toEqual(['RADAR_PROBE_FRESH_S', 'freshWithin']);
  });

  it('CONTROL: the policy scan sees a clock, a builtin, a store reach and a value edge', () => {
    const probe = (t: string): ParsedFile => parseSource(t, 'probe.ts');
    expect(clockAndFs(probe('const t = Date.now();'))).toEqual(['1 Date']);
    expect(clockAndFs(probe('const t = Date.parse(x);'))).toEqual([]);
    // the Date.parse exemption is the receiver of `.parse(` only: any other clock read on the same line still counts
    expect(clockAndFs(probe('const age = Date.now() - Date.parse(at);'))).toEqual(['1 Date']);
    expect(clockAndFs(probe('const s = new Date(x).getTime() + Date.parse(y);'))).toEqual(['1 Date']);
    expect(clockAndFs(probe('const age = Date.parse(at);'))).toEqual([]);
    expect(clockAndFs(probe('const age = Date.now();'))).toEqual(['1 Date']);
    expect(clockAndFs(probe('const t = new Date(1);'))).toEqual(['1 Date']);
    expect(probe("import { x } from 'node:crypto';").imports.map((x) => x.specifier).filter(isNodeBuiltin)).toEqual(['node:crypto']);
    expect(storeReaches(probe("import { CoordStore } from './store.js';")).length).toBeGreaterThan(0);
    expect(storeReaches(probe("import type { CoordStore } from './store.js';"))).toEqual(['1 CoordStore']);
    expect(valueEdges(probe("import { type A, b } from './x.js';\nimport type { C } from './y.js';")).map((x) => x.specifier)).toEqual(['./x.js']);
  });
});

describe('CLAUDE.md names the landing line among what a lost coord.db loses (D-7620)', () => {
  const flat = (s: string): string => s.replace(/\s+/g, ' ');
  const passage = (name: string, text: string, from: string, to: string): string => {
    const a = text.indexOf(from);
    expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
    const b = text.indexOf(to, a + from.length);
    expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
    return flat(text.slice(a, b));
  };

  const claude = (): string => readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');

  it('landing-journal-prose: the recovery exception is stated, and the loss list and collector prose still stand', () => {
    const exception = passage('the recovery exception', claude(), 'The landing line has an authority-recovery exception', 'The switch\'s `collect-lane-generation.log`');
    for (const phrase of [
      '`~/.ccrc/landing.log` restores no-run creation evidence, order edges, `fixesMain` and setter attribution before service starts',
      'Replay never fabricates a measured pin, landed state or current run association',
      'remain visible as unmeasured and hold their project\'s line',
      'identity conflicts hold every affected project without deleting or rekeying either identity',
      'Only a verified pin may supply an exact DB-only witness',
      'replay never mints it',
      'This cannot detect a wholly unjournalled change lost with a snapshot',
      'Invalid or unreadable history refuses startup; missing projections or binding mismatches alone do not',
      'fences every landing read and mutation until durable replay succeeds at a clean transaction boundary; an uncertain rollback requires restart',
      'quarantines its pin as unknown, not ejected; only a verified repin with readable retained data clears that quarantine',
    ]) expect(exception, phrase).toContain(phrase);
    const collector = passage('the collector sentence', claude(), 'The switch\'s `collect-lane-generation.log`', 'collector');
    expect(collector).toContain('is never copied into a snapshot or restored with one: leave it in place, so a database restored alone never re-arms the');
  });

  it('landing-journal-left-in-place: the prose says so, and no backup set, restore pair or snapshot capture names landing.log', () => {
    const exception = passage('the leave-in-place rule', claude(), 'Leave it in place when restoring coord.db', 'Replay never fabricates');
    expect(exception).toContain('no backup copies it or restores an older copy over it');
    const ccrc = readFileSync(path.join(REPO_ROOT, 'ccd/ccrc'), 'utf8');
    const a = ccrc.indexOf('\n_upd_backup_set() {');
    expect(a, '_upd_backup_set is gone').toBeGreaterThan(-1);
    const set = ccrc.slice(a, ccrc.indexOf('\n}\n', a));
    expect(set).toContain('_upd_backup_copy');
    expect(set).not.toContain('landing.log');
    // arm 3's pairs are the same list (one list, two readers), so a restore copies nothing the backup set does not hold
    const b = ccrc.indexOf('\n_upd_backup_pairs() {');
    expect(b, '_upd_backup_pairs is gone').toBeGreaterThan(-1);
    const pairs = ccrc.slice(b, ccrc.indexOf('\n}\n', b));
    expect(pairs).toContain('_upd_backup_set');
    expect(pairs).not.toContain('landing.log');
    for (const f of ['deploy/backup-coord.mjs', 'deploy/coordination-snapshot.mjs']) {
      expect(existsSync(path.join(REPO_ROOT, f)), `${f} is gone: a moved file must turn this red`).toBe(true);
      expect(readFileSync(path.join(REPO_ROOT, f), 'utf8'), f).not.toContain('landing.log');
    }
  });

  it('the coord.db bullet lists the landing line first', () => {
    const bullet = passage('the coord.db bullet', readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8'),
      'what it adds on top', 'is gone without the snapshot');
    expect(bullet).toContain('what it adds on top — the landing line, mail, claims');
  });
});

describe('the server boots the landing journal once, in both fleet modes, before anything consumes it (5f)', () => {
  const INDEX = 'server/src/index.ts';
  const calls = (): ReturnType<typeof parsedFile>['calls'] => parsedFile(INDEX).calls;

  it('boot-replay-before-consumers: the store is replayed before the server, the watcher and every timer', () => {
    const replay = calls().filter((c) => c.name === 'replayLandingJournal');
    expect(replay).toHaveLength(1);
    const consumers = calls().filter((c) => c.name !== null && ['buildServer', 'listen', 'setInterval', 'setTimeout', 'start', 'FleetWatcher'].includes(c.name));
    expect(consumers.length).toBeGreaterThan(3);
    expect(consumers.filter((c) => c.start < replay[0]!.start).map((c) => `${c.line} ${c.name}`)).toEqual([]);
  });

  it('local-mode-has-store-journal and remote-mode-has-store-journal: ONE CoordStore, built above the mode branch, with the journal', () => {
    // `new` is not a call to the scan library, so the construction is read from the parsed text: one `new CoordStore(`, whose
    // option object carries the journal and the fail-stop callback, and the first test of the fleet mode comes after it.
    const text = parsedFile(INDEX).text;
    const made = [...text.matchAll(/new CoordStore\(/g)];
    expect(made).toHaveLength(1);
    const at = made[0]!.index!;
    const replayAt = calls().find((c) => c.name === 'replayLandingJournal')!.start;
    // the constructor's own argument list, by paren depth, so a journal named anywhere else before the replay cannot satisfy it
    let depth = 0; let end = at;
    for (let i = text.indexOf('(', at); i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) { end = i + 1; break; }
    }
    expect(end).toBeLessThan(replayAt);
    const construction = text.slice(at, end);
    expect(construction).toContain('landingJournal: createLandingJournal(');
    expect(construction).toContain('onUnusableConnection');
    expect(text.indexOf('cfg.fleetMode ===')).toBeGreaterThan(at);
  });
});

describe('landingEntry.ts is the pure L1 module its header says it is (no fs, no node:sqlite, no clock)', () => {
  // Keyed on the scan library (scan/parse.ts through scan/symbols.ts), never a literal source pin: the file is parsed, so a
  // comment that names what the header promises not to use cannot trip a check. KNOWN WIDTH: the parse is syntax only, so the
  // clock is read through `identifierReferences` (`new Date()` and `Date.now()` alike); a clock reached through an alias
  // bound from another module or a computed name is out of width. `coord-policy-rings` keeps the runtime path to node:sqlite.
  const FILE = 'server/src/coord/landingEntry.ts';
  const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));
  const isNodeBuiltin = (specifier: string): boolean =>
    specifier.startsWith('node:') || NODE_BUILTINS.has(specifier.split('/')[0]!);
  const bindsValue = (edge: ImportEdge): boolean => {
    if (edge.kind === 'type-query' || edge.typeOnly) return false;
    if (edge.names.length === 0) return true;
    return !edge.names.every((n) => (edge.typeNames ?? []).includes(n));
  };
  const valueSpecifiers = (p: ParsedFile): string[] => p.imports.filter(bindsValue).map((x) => x.specifier);
  const nodeBuiltinSpecifiers = (p: ParsedFile): string[] => p.imports.map((x) => x.specifier).filter(isNodeBuiltin);
  const CLOCK_AND_FS = new Set(['Date', 'performance', 'fs', 'require', 'readFileSync', 'writeFileSync', 'readFile', 'writeFile']);
  const clockAndFsReferences = (p: ParsedFile): string[] =>
    identifierReferences(p.text, p.path, CLOCK_AND_FS).map((x) => `${x.line} ${x.name}`);
  const probe = (src: string): ParsedFile => parseSource(src, 'probe.ts');

  it('the scan is over real code, not an empty string', () => {
    const p = parsedFile(FILE);
    const fns = p.symbols.filter((x) => x.kind === 'function' || x.kind === 'variable-function').map((x) => x.name);
    expect(fns).toContain('decideLandingWrite');
    expect(fns).toContain('landingEntryOfRow');
    expect(p.calls.length).toBeGreaterThan(5);
    expect(p.imports.length).toBeGreaterThan(0);
  });

  it('CONTROL: the scans see a builtin in either quote, a value import, a clock and an fs use', () => {
    expect(nodeBuiltinSpecifiers(probe('import { readFileSync } from "node:fs";'))).toEqual(['node:fs']);
    expect(nodeBuiltinSpecifiers(probe("import { DatabaseSync } from 'node:sqlite';"))).toEqual(['node:sqlite']);
    expect(nodeBuiltinSpecifiers(probe("import { join } from 'path';"))).toEqual(['path']);
    expect(nodeBuiltinSpecifiers(probe("import { x } from '../../../shared/landingLine.js';"))).toEqual([]);
    expect(valueSpecifiers(probe("import { a } from './store.js';\nimport type { B } from './db.js';"))).toEqual(['./store.js']);
    expect(clockAndFsReferences(probe('const t = Date.now();'))).toEqual(['1 Date']);
    expect(clockAndFsReferences(probe('const t = new Date(1);'))).toEqual(['1 Date']);
    expect(clockAndFsReferences(probe("const b = readFileSync('x');"))).toEqual(['1 readFileSync']);
    expect(clockAndFsReferences(probe('// Date.now() is not used\nconst t = 1;'))).toEqual([]);
  });

  it('reads no clock and no filesystem', () => {
    expect(clockAndFsReferences(parsedFile(FILE)), 'landingEntry.ts reads the clock or reaches for a filesystem').toEqual([]);
  });

  it('the 5f L1 siblings (the write decider and the journal parser) read no clock, no filesystem and import no node builtin', () => {
    for (const f of ['server/src/coord/landingWrites.ts', 'server/src/coord/landingJournalPolicy.ts']) {
      const p = parsedFile(f);
      expect(p.calls.length, `${f} parses to nothing`).toBeGreaterThan(0);
      expect(clockAndFsReferences(p), `${f} reads the clock or reaches for a filesystem`).toEqual([]);
      expect(nodeBuiltinSpecifiers(p), `${f} imports a node builtin`).toEqual([]);
    }
  });

  it('imports no node builtin, and values only from shared/ (L0)', () => {
    const p = parsedFile(FILE);
    expect(nodeBuiltinSpecifiers(p), 'landingEntry.ts imports a node builtin').toEqual([]);
    expect(valueSpecifiers(p)).toEqual(['../../../shared/landingLine.js']);
  });
});
