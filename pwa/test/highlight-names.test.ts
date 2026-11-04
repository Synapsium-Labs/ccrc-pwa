// One registry (native Docs reader, W5h-a Task 2; base spec 2026-10-01 section 4.10 "One registry" and "The private
// instance", M4.H5 and M4.H6). The main thread knows grammars as data (`highlightNames.ts`); the highlight worker
// registers them on one private highlight.js instance (`highlightGrammars.ts#HLJS`). This file holds the two equal
// in both directions, holds `highlightNames.ts` to importing nothing (W5h-b), and pins the instance: one
// `hljs.newInstance()`, registrations only on it, and no `addPlugin`, `configure` or `debugMode` call in the worker's
// first-party closure, each clause with a planted control.
// The escaping scan reads calls through TypeScript's parser. NOT EXHAUSTIVE: a call through a variable holding the
// method (`const c = HLJS.configure; c({})`), an element access with a computed key, and anything reached through
// `any` or `eval` are not seen; review lens 1 reads for those.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CCRC_ALIASES, HLJS } from '../src/lib/highlightGrammars';
import {
  HIGHLIGHT_ALIASES, HIGHLIGHT_GRAMMARS, HIGHLIGHT_NAME_SET, grammarOf, isRegisteredGrammar,
} from '../src/lib/highlightNames';

const LIB = path.join(import.meta.dirname, '..', 'src', 'lib');

/** Every alias the worker's instance resolves: each grammar's own, and ccrc's three lists. */
function workerAliases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of HLJS.listLanguages()) for (const a of HLJS.getLanguage(g)?.aliases ?? []) out[a] = g;
  for (const [g, list] of Object.entries(CCRC_ALIASES)) for (const a of list) out[a] = g;
  return out;
}

describe('M4.H5: highlightNames.ts is the worker\'s registry, in both directions', () => {
  it('the grammar names are the worker instance\'s listLanguages(), sorted', () => {
    expect([...HIGHLIGHT_GRAMMARS]).toEqual([...HLJS.listLanguages()].sort());
    expect(HIGHLIGHT_GRAMMARS).toHaveLength(15);
  });

  it('the alias table is every alias the worker resolves, each to the same grammar', () => {
    expect({ ...HIGHLIGHT_ALIASES }).toEqual(workerAliases());
  });

  it('every name and alias resolves to the same grammar on both sides, in either case', () => {
    for (const n of HIGHLIGHT_NAME_SET) {
      const def = HLJS.getLanguage(n);
      expect(def, n).toBeDefined();
      expect(HLJS.getLanguage(grammarOf(n)!), n).toBe(def);
      expect(isRegisteredGrammar(n), n).toBe(true);
      expect(isRegisteredGrammar(n.toUpperCase()), n).toBe(true);
    }
    expect(HIGHLIGHT_NAME_SET.size).toBe(HIGHLIGHT_GRAMMARS.length + Object.keys(HIGHLIGHT_ALIASES).length);
  });

  it('no other name is registered: the empty name, an unknown one, and the object prototype\'s keys', () => {
    for (const n of ['', 'nope', 'text', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(isRegisteredGrammar(n), n).toBe(false);
      expect(grammarOf(n), n).toBeNull();
    }
  });
});

/** What the escaping pin finds in one module: each `hljs.newInstance()`, each registration's receiver, and each
 *  forbidden call (`addPlugin`, `configure`, `debugMode`), as `<what> <line>`. */
function escaping(source: string, file: string): { instances: number; receivers: string[]; forbidden: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let instances = 0;
  const receivers: string[] = [];
  const forbidden: string[] = [];
  const line = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const member = n.expression.name.text;
      const owner = n.expression.expression;
      const ownerText = ts.isIdentifier(owner) ? owner.text : '(expr)';
      if (member === 'newInstance' && ownerText === 'hljs') instances += 1;
      if (member === 'registerLanguage' || member === 'registerAliases') receivers.push(`${ownerText}.${member}`);
      if (member === 'addPlugin' || member === 'configure' || member === 'debugMode') forbidden.push(`${member} ${line(n)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { instances, receivers, forbidden };
}

const WORKER_FIRST_PARTY = ['highlightGrammars.ts', 'highlightJob.ts', 'markdownHighlightWorker.ts'];
/** The worker's first-party files that exist yet (Task 3 adds the last two). */
const present = (): string[] => WORKER_FIRST_PARTY.filter((f) => {
  try { readFileSync(path.join(LIB, f)); return true; } catch { return false; }
});
const read = (f: string): string => readFileSync(path.join(LIB, f), 'utf8');

describe('M4.H6: highlight.js\'s own escaping (one private instance, no plugin, no configuration)', () => {
  it('highlightGrammars.ts makes exactly one hljs.newInstance() and registers only on HLJS', () => {
    const found = escaping(read('highlightGrammars.ts'), 'highlightGrammars.ts');
    expect(found.instances).toBe(1);
    expect(found.receivers.length).toBeGreaterThanOrEqual(2);
    expect(found.receivers.every((r) => r.startsWith('HLJS.'))).toBe(true);
    expect(read('highlightGrammars.ts')).toMatch(/^export const HLJS: HighlightApi = hljs\.newInstance\(\);$/m);
  });

  it('no file of the worker\'s first-party closure calls addPlugin, configure or debugMode', () => {
    expect(present()).toContain('highlightGrammars.ts');
    for (const f of present()) expect(escaping(read(f), f).forbidden, f).toEqual([]);
  });

  it('planted: a registration on the core default instance is red', () => {
    const found = escaping(`${read('highlightGrammars.ts')}\nhljs.registerLanguage('planted', bash);\n`, 'planted.ts');
    expect(found.receivers).toContain('hljs.registerLanguage');
  });

  it('planted: configure, addPlugin and debugMode on HLJS are each red', () => {
    for (const call of ["HLJS.configure({ classPrefix: 'x-' });", 'HLJS.addPlugin({});', 'HLJS.debugMode();']) {
      expect(escaping(`${read('highlightGrammars.ts')}\n${call}\n`, 'planted.ts').forbidden, call).toHaveLength(1);
    }
  });
});

// W5h-b (base spec 4.10's Files table: `highlightNames.ts` imports "`markdownLimits.ts` only, until W5h-b; nothing
// after"). Read with TypeScript's parser: every import declaration and every `export … from`. NOT EXHAUSTIVE: a dynamic
// `import()` and a `require` are not seen.
/** The module specifiers one module imports or re-exports from. */
function specifiersOf(source: string): string[] {
  const sf = ts.createSourceFile('m.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return sf.statements.flatMap((s) => (
    (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier !== undefined && ts.isStringLiteral(s.moduleSpecifier)
      ? [s.moduleSpecifier.text] : []));
}

describe('W5h-b: highlightNames.ts imports nothing', () => {
  it('highlightNames.ts imports and re-exports from no module', () => {
    expect(specifiersOf(readFileSync(path.join(LIB, 'highlightNames.ts'), 'utf8'))).toEqual([]);
  });

  it('planted: an import of markdownLimits, a type import and a re-export are each seen', () => {
    expect(specifiersOf("import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from './markdownLimits';\nexport const c = MD_HIGHLIGHT_BLOCK_MAX_CHARS;"))
      .toEqual(['./markdownLimits']);
    expect(specifiersOf("import type { HighlightJob } from './highlightProtocol';\nexport type J = HighlightJob;"))
      .toEqual(['./highlightProtocol']);
    expect(specifiersOf("export { LANG_LABEL } from './other';")).toEqual(['./other']);
  });
});
