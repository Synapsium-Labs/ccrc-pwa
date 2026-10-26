// The TypeScript walker the string censuses share (D-6325): ONE copy, imported by `literal-census.test.ts` (which sentences
// are written twice) and `plain-words.test.ts` (which words an operator reads). A helper module, not a test file, so
// importing it registers no tests in the importer.
import { readFileSync } from 'node:fs';
import ts from 'typescript-api';

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

/** Parse one source file the way every walker here reads it (TSX, parent pointers set). `text` overrides the file's
 *  contents (a probe snippet). */
export function parseTs(file: string, text: string = readFileSync(file, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
