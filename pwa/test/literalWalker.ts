// The TypeScript walker the string censuses share (D-6325): ONE copy, imported by `literal-census.test.ts` (which sentences
// are written twice) and `plain-words.test.ts` (which words an operator reads). A helper module, not a test file, so
// importing it registers no tests in the importer.
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** An import/export specifier, or a `import()` argument — the three positions
 *  where a string names a MODULE rather than saying something. Excluded by
 *  position, not by shape. */
export function isSpecifier(n: ts.Node): boolean {
  const p = n.parent as ts.Node | undefined;
  if (p === undefined) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return p.moduleSpecifier === n;
  if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isImportTypeNode(p) || (p.parent !== undefined && ts.isImportTypeNode(p.parent))) return true;
  return false;
}

/** Parse one source file the way every walker here reads it (parent pointers set): TSX for a `.tsx` file, TS for any
 *  other. The TSX grammar takes a generic arrow `async <T>(…)` in a `.ts` file for a JSX tag and reads the rest of the
 *  file only in part, as it did `lib/api.ts`. `text` overrides the file's contents (a probe snippet). */
export function parseTs(file: string, text: string = readFileSync(file, 'utf8')): ts.SourceFile {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}
