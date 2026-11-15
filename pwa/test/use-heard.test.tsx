import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ts } from '../../server/test/scan/parse';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useHeard, useHeardRuns, useHeardSessions } from '../src/fleet/useHeard';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';

describe('useHeard, the one reader of the frame-seen gate', () => {
  it('holds null for the rows and runs until their frames have landed', () => {
    const store = createFleetStore();
    store.setState({ sessions: [fleetSession({ id: 'lane-a-1' })], runs: [], fleetFrameSeen: false, runsFrameSeen: false });
    const { result } = renderHook(() => useHeard(store));
    expect(result.current).toEqual({ sessions: null, runs: null });
    act(() => store.setState({ fleetFrameSeen: true }));
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.runs).toBeNull();
    act(() => store.setState({ runsFrameSeen: true }));
    expect(result.current.runs).toEqual([]);
  });

  it('answers each half from one subscription: a runs reader is not rendered again by a fleet frame, nor a sessions reader by a runs frame', () => {
    const store = createFleetStore();
    store.setState({ sessions: [], runs: [], fleetFrameSeen: true, runsFrameSeen: true });
    let runsRenders = 0;
    let sessionsRenders = 0;
    const runs = renderHook(() => { runsRenders += 1; return useHeardRuns(store); });
    const sessions = renderHook(() => { sessionsRenders += 1; return useHeardSessions(store); });
    const [r0, s0] = [runsRenders, sessionsRenders];
    act(() => store.setState({ sessions: [fleetSession({ id: 'lane-a-1' })] }));
    expect(runsRenders).toBe(r0);
    expect(sessionsRenders).toBe(s0 + 1);
    act(() => store.setState({ runs: [] }));
    expect(sessionsRenders).toBe(s0 + 1);
    expect(runsRenders).toBe(r0 + 1);
    expect(runs.result.current).toEqual([]);
    expect(sessions.result.current).toHaveLength(1);
  });

  it('a half not heard stays null, whatever its rows, and its reader is not rendered by them', () => {
    const store = createFleetStore();
    store.setState({ runs: [], runsFrameSeen: false });
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return useHeardRuns(store); });
    const r0 = renders;
    act(() => store.setState({ runs: [] }));
    expect(result.current).toBeNull();
    expect(renders).toBe(r0);
  });

  // The census (the Overlord face follow-ups): a hand-written gate on `fleetFrameSeen` or `runsFrameSeen` is a second
  // spelling of the rule this hook owns, so one is refused anywhere in `src` but here, and no file is listed: every surface
  // asks the hook. The scan parses each file (TypeScript's own parser, not a pattern over text) and counts, per file:
  //   - a ternary whose condition is the flag, its negation, or a `&&`/`||`/`??`/comparison chain with the flag in it;
  //   - a `&&`/`||`/`??` chain with the flag as an operand, used as a VALUE (an initializer, an argument, a JSX child): one
  //     per outermost chain;
  // where "the flag" is a read of `.fleetFrameSeen`/`.runsFrameSeen`, an identifier of either name, or an ALIAS bound in the
  // same file. A read is also a selector over one, its body an expression or a block that returns it
  // (`store((s) => { return s.runsFrameSeen; })`), and `Boolean(…)` of one. An alias is a variable initialized from a read
  // (`const seen = store((s) => s.runsFrameSeen)`, or its negation `!runsFrameSeen`), a destructured field or parameter
  // (`const { runsFrameSeen: seen } = …`, `store(({ runsFrameSeen: seen, runs }) => …)`), a renamed import
  // (`import { runsFrameSeen as seen }`), a field of an object built with a read in it (`const flags = store((s) => ({ seen:
  // s.runsFrameSeen }))`, then `flags.seen` or `const { seen } = flags`), or an alias of any of these, in any order.
  // A chain in an `if`/`while`/`for` test is not a gate on rows (`if (!seen) return`), and a prop of another name
  // (`frameSeen?: boolean`, `props.frameSeen ?? false`) is not the heard fact. EXEMPT BY DESIGN: a boolean derived from the
  // hook's own answer (`const runsHeard = heard.runs !== null`, `noSignalYet = heard.runs === null`) is the hook's word, not
  // a second spelling of it, so the census does not count it, even where it gates the store's raw rows beside it. That is
  // what a surface that keeps its raw rows pays (RunsScreen's `live`, RunDetailScreen's `liveRuns`): once heard, the raw
  // rows ARE the heard rows, so the two spellings cannot disagree. KNOWN WIDTH: no scopes (an alias binds its name across
  // its file, which errs toward refusing); a read through an element access (`s['runsFrameSeen']`), an assignment
  // (`let x; x = s.runsFrameSeen`), a call other than `Boolean` around a read, a flag passed into a function and gated there
  // under another name, and a gate in a statement (`if (seen) rows = runs`, a `switch`) are not seen.
  const FLAGS = new Set(['fleetFrameSeen', 'runsFrameSeen']);
  const K = ts.SyntaxKind;
  const LOGICAL = new Set<ts.SyntaxKind>([K.AmpersandAmpersandToken, K.BarBarToken, K.QuestionQuestionToken]);
  const COMPARE = new Set<ts.SyntaxKind>([K.EqualsEqualsEqualsToken, K.ExclamationEqualsEqualsToken, K.EqualsEqualsToken, K.ExclamationEqualsToken]);
  const isNot = (n: ts.Node): n is ts.PrefixUnaryExpression => ts.isPrefixUnaryExpression(n) && n.operator === K.ExclamationToken;
  const isWrap = (n: ts.Node): n is ts.ParenthesizedExpression | ts.NonNullExpression | ts.AsExpression =>
    ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n);
  const isChain = (n: ts.Node, ops: ReadonlySet<ts.SyntaxKind>): n is ts.BinaryExpression => ts.isBinaryExpression(n) && ops.has(n.operatorToken.kind);
  const strip = (e: ts.Expression): ts.Expression => {
    let x = e;
    for (;;) {
      if (isWrap(x)) x = x.expression;
      else if (isNot(x)) x = x.operand;
      else return x;
    }
  };

  function heardHolders(text: string, file = 'probe.tsx'): number {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const aliases = new Set<string>();
    // An object variable's fields that hold a read: `flags` → `seen` for `const flags = store((s) => ({ seen: s.runsFrameSeen }))`.
    const fields = new Map<string, Set<string>>();
    // What a one-argument call's function answers: its expression body, or every `return` of its block (not of a function
    // nested in it). Empty for anything else.
    const answers = (e: ts.Expression): ts.Expression[] => {
      const x = strip(e);
      const [fn] = ts.isCallExpression(x) && x.arguments.length === 1 ? x.arguments : [];
      if (fn === undefined || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return [];
      if (!ts.isBlock(fn.body)) return [fn.body];
      const out: ts.Expression[] = [];
      const visit = (n: ts.Node): void => {
        if (ts.isFunctionLike(n)) return;
        if (ts.isReturnStatement(n) && n.expression !== undefined) out.push(n.expression);
        ts.forEachChild(n, visit);
      };
      ts.forEachChild(fn.body, visit);
      return out;
    };
    const isRead = (e: ts.Expression): boolean => {
      const x = strip(e);
      if (ts.isIdentifier(x)) return FLAGS.has(x.text) || aliases.has(x.text);
      if (ts.isPropertyAccessExpression(x)) {
        return FLAGS.has(x.name.text) || (ts.isIdentifier(x.expression) && fields.get(x.expression.text)?.has(x.name.text) === true);
      }
      if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === 'Boolean' && x.arguments.length === 1) {
        return isRead(x.arguments[0]!);
      }
      const answered = answers(x);
      return answered.length > 0 && answered.every(isRead);
    };
    // The object literal an initializer builds, directly or as a selector's one answer.
    const objectOf = (e: ts.Expression): ts.ObjectLiteralExpression | null => {
      const x = strip(e);
      if (ts.isObjectLiteralExpression(x)) return x;
      const answered = answers(x);
      const only = answered.length === 1 ? strip(answered[0]!) : null;
      return only !== null && ts.isObjectLiteralExpression(only) ? only : null;
    };
    const involves = (e: ts.Expression): boolean => {
      const x = strip(e);
      if (isRead(x)) return true;
      return (isChain(x, LOGICAL) || isChain(x, COMPARE)) && (involves(x.left) || involves(x.right));
    };
    // Aliases first, to a fixed point, so an alias of an alias is one too.
    for (let grew = true; grew;) {
      grew = false;
      const add = (name: string): void => { if (!FLAGS.has(name) && !aliases.has(name)) { aliases.add(name); grew = true; } };
      const addField = (owner: string, name: string): void => {
        const set = fields.get(owner) ?? new Set<string>();
        if (!set.has(name)) { set.add(name); fields.set(owner, set); grew = true; }
      };
      const visit = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
          if (isRead(n.initializer)) add(n.name.text);
          for (const p of objectOf(n.initializer)?.properties ?? []) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && isRead(p.initializer)) addField(n.name.text, p.name.text);
          }
        }
        // A destructured field or parameter: the flag's own key, or a field of an object that holds a read.
        if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && ts.isObjectBindingPattern(n.parent)) {
          const key = n.propertyName ?? n.name;
          const decl = n.parent.parent;
          const from = ts.isVariableDeclaration(decl) && decl.initializer !== undefined && ts.isIdentifier(strip(decl.initializer))
            ? fields.get((strip(decl.initializer) as ts.Identifier).text) : undefined;
          if (ts.isIdentifier(key) && (FLAGS.has(key.text) || from?.has(key.text) === true)) add(n.name.text);
        }
        if (ts.isImportSpecifier(n) && n.propertyName !== undefined && FLAGS.has(n.propertyName.text)) add(n.name.text);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    // The node above `n`, past parentheses and negations.
    const above = (n: ts.Node): ts.Node | undefined => {
      let p = n.parent;
      while (p !== undefined && (isWrap(p) || isNot(p))) p = p.parent;
      return p;
    };
    const inTest = (n: ts.Node): boolean => {
      let top = n;
      let p = n.parent;
      while (p !== undefined && (isWrap(p) || isNot(p) || isChain(p, LOGICAL) || isChain(p, COMPARE))) { top = p; p = p.parent; }
      if (p === undefined) return false;
      if (ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return p.expression === top;
      if (ts.isForStatement(p)) return p.condition === top;
      return ts.isConditionalExpression(p) && p.condition === top;
    };
    let count = 0;
    const visit = (n: ts.Node): void => {
      if (ts.isConditionalExpression(n) && involves(n.condition)) count += 1;
      else if (isChain(n, LOGICAL) && (involves(n.left) || involves(n.right))) {
        const parent = above(n);
        const outermost = parent === undefined || !isChain(parent, LOGICAL);
        if (outermost && !inTest(n)) count += 1;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return count;
  }

  it('refuses a hand-written heard gate anywhere in src but the hook, and lists no holder', () => {
    const src = path.resolve(__dirname, '../src');
    const found: Record<string, number> = {};
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const n = heardHolders(readFileSync(p, 'utf8'), e.name);
          if (n > 0) found[path.relative(src, p).split(path.sep).join('/')] = n;
        }
      }
    };
    walk(src);
    expect(found['fleet/useHeard.ts']).toBe(2);
    delete found['fleet/useHeard.ts'];
    expect(found).toEqual({});
  });

  it("the census sees the spellings it refuses, and not the ones it does not", () => {
    const hits = (text: string): number => heardHolders(text);
    // Ternaries, as before.
    expect(hits('const runs = runsFrameSeen ? live : null;')).toBe(1);
    expect(hits('useStore((s) => (s.runsFrameSeen ? s.runs : null))')).toBe(1);
    expect(hits('const x = !fleetFrameSeen ? [] : rows;')).toBe(1);
    expect(hits('const x = (fleetFrameSeen) ? a : b;')).toBe(1);
    expect(hits('const x = fleetFrameSeen\n    ? a\n    : b;')).toBe(1);
    expect(hits('const x = view === null || !fleetFrameSeen ? [] : rows;')).toBe(1);
    // Aliases: a selector read, its negation, a destructured field, a renamed import, an alias of an alias.
    expect(hits('const seen = store((s) => s.runsFrameSeen);\nconst r = seen ? runs : null;')).toBe(1);
    expect(hits('const waiting = !runsFrameSeen;\nconst r = waiting ? null : runs;')).toBe(1);
    expect(hits('const { runsFrameSeen: seen } = store.getState();\nconst r = seen ? runs : null;')).toBe(1);
    expect(hits("import { runsFrameSeen as heardRuns } from './x';\nconst r = heardRuns ? runs : null;")).toBe(1);
    expect(hits('const a = state.fleetFrameSeen;\nconst b = a;\nconst r = b ? rows : null;')).toBe(1);
    expect(hits('const r = () => (late ? rows : null);\nconst late = early;\nconst early = state.runsFrameSeen;')).toBe(1);
    // A block-bodied selector, `Boolean(…)`, a destructured or renamed parameter, an object-wrapped read (review 2107 F2).
    expect(hits('const seen = store((s) => { return s.runsFrameSeen; });\nconst r = seen ? runs : null;')).toBe(1);
    expect(hits('const seen = store(function (s) { return s.fleetFrameSeen; });\nconst r = seen && rows;')).toBe(1);
    expect(hits('const r = Boolean(store((s) => s.runsFrameSeen)) ? runs : null;')).toBe(1);
    expect(hits('const seen = Boolean(state.runsFrameSeen);\nconst r = seen && runs;')).toBe(1);
    expect(hits('const rows = store(({ runsFrameSeen: seen, runs }) => (seen ? runs : null));')).toBe(1);
    expect(hits('function Box({ fleetFrameSeen: heard }: P) { return heard ? rows : null; }')).toBe(1);
    expect(hits('const flags = store((s) => ({ seen: s.runsFrameSeen }));\nconst r = flags.seen ? runs : null;')).toBe(1);
    expect(hits('const flags = { seen: state.runsFrameSeen, n: 1 };\nconst { seen } = flags;\nconst r = seen ? runs : null;')).toBe(1);
    // Short-circuits used as a value: one per outermost chain.
    expect(hits('const r = runsFrameSeen && runs;')).toBe(1);
    expect(hits('const r = !fleetFrameSeen || rows.length === 0;')).toBe(1);
    expect(hits('const seen = state.runsFrameSeen ?? false;')).toBe(1);
    expect(hits('const el = <p>{!finding && !runsFrameSeen && <Loading />}</p>;')).toBe(1);
    expect(hits('const seen = store((s) => s.runsFrameSeen);\nf(seen && runs);')).toBe(1);
    // Not the heard fact, or not a gate on rows.
    expect(hits('if (!runsFrameSeen) return;')).toBe(0);
    expect(hits('if (again && runsFrameSeen && live !== shown) reread();')).toBe(0);
    expect(hits('while (!fleetFrameSeen) wait();')).toBe(0);
    expect(hits('const seen = obj?.runsFrameSeen?.x;')).toBe(0);
    expect(hits('const r = state?.runsFrameSeen ? runs : null;')).toBe(1);
    expect(hits('coordFrameSeen ? a : b')).toBe(0);
    expect(hits('const x = props.frameSeen ?? false;')).toBe(0);
    expect(hits('function F({ frameSeen }: { frameSeen?: boolean }) { return frameSeen ? a : b; }')).toBe(0);
    expect(hits('const seen = store((s) => s.runsFrameSeen);\nf(seen);\nconst p = presence(id, row, seen);')).toBe(0);
    expect(hits('const heard = useHeard(store);\nconst r = heard.runs ?? [];\nconst waiting = heard.runs === null;')).toBe(0);
    expect(hits('const heard = useHeard(store);\nconst runsHeard = heard.runs !== null;\nconst r = runsHeard ? live : [];')).toBe(0);
    expect(hits('const v = store((s) => { if (s.runsFrameSeen) return 1; return 2; });\nconst r = v ? a : b;')).toBe(0);
    expect(hits('const flags = store((s) => ({ seen: s.coordFrameSeen, n: s.runsFrameSeen }));\nconst r = flags.seen ? a : b;')).toBe(0);
    expect(hits('const label = String(runsFrameSeen) ? a : b;')).toBe(0);
    expect(hits('const v = store((s) => { list.forEach(function () { return s.runsFrameSeen; }); });\nconst r = v ? a : b;')).toBe(0);
  });
});
