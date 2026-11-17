// THE ONE SCAN of coord.db's SQL writes (Overlord W2 row revisions, plan w2-revisions.md Task 2, F12: no second scanner).
// `writers-map.test.ts#tableWriters` names each table's writers from it, and the row revisions census
// (`row-revisions.test.ts` here) classifies each write of `asks` and `operator_items` from it, so both read one scan.
//
// A write is an INSERT (any `OR` arm), UPDATE, DELETE FROM or REPLACE INTO naming the table, in a file's text with its
// comment lines blanked to spaces (prose naming a statement is no write, and offsets still hold). Its writer is the
// innermost enclosing symbol (`scan/parse.ts`), `file#Class.method`. Its `sql` is the whole string expression the verb
// sits in, its `+`-joined literal pieces joined first (`settleAsk` and `staleAsk` build theirs that way), with any piece
// that is not a literal read as `${…}`. KNOWN WIDTH: a statement whose table name is built at run time, or split from its
// verb across string pieces, is not seen.
import { readFileSync } from 'node:fs';
import { parseFile, ts } from '../scan/parse.js';
import { rel } from './helpers.js';

export interface SqlWrite {
  table: string;
  /** `file#Class.method`, by the innermost enclosing symbol, or `file#(module)`. */
  writer: string;
  /** The statement's joined text. */
  sql: string;
}

/** A string expression's text: literal pieces joined, a template's substitutions and any other piece as `${…}`. */
const joined = (n: ts.Node): string => {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) return n.head.text + n.templateSpans.map((s) => '${…}' + s.literal.text).join('');
  if (ts.isParenthesizedExpression(n)) return joined(n.expression);
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) return joined(n.left) + joined(n.right);
  return '${…}';
};
const isStringPiece = (n: ts.Node): boolean =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
/** The deepest string piece holding `at`, climbed through `+` and parentheses to the whole statement expression. */
const statementAt = (sf: ts.SourceFile, at: number): ts.Node | null => {
  const deepest = (n: ts.Node): ts.Node | null => {
    if (at < n.getStart(sf) || at >= n.getEnd()) return null;
    return n.forEachChild(deepest) ?? (isStringPiece(n) ? n : null);
  };
  let n: ts.Node | null = deepest(sf);
  while (n !== null && n.parent !== undefined
    && ((ts.isBinaryExpression(n.parent) && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken) || ts.isParenthesizedExpression(n.parent))) {
    n = n.parent;
  }
  return n;
};

/** Every SQL write naming one of `tables`, in `files`, in file then text order; one entry per statement and table. */
export const sqlWrites = (files: readonly string[], tables: readonly string[]): SqlWrite[] => {
  const verb = new RegExp(`(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO)\\s+(${tables.join('|')})\\b`, 'g');
  const out: SqlWrite[] = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    if (!tables.some((t) => raw.includes(t))) continue;
    const text = raw.replace(/^\s*(?:\*|\/\*|\/\/).*$/gm, (l) => ' '.repeat(l.length));
    const hits = [...text.matchAll(verb)];
    if (hits.length === 0) continue;
    const syms = parseFile(f).symbols;
    const sf = ts.createSourceFile(f, raw, ts.ScriptTarget.Latest, true);
    const seen = new Set<string>();
    for (const m of hits) {
      const at = m.index!;
      const inner = syms.filter((s) => s.start <= at && at < s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      const node = statementAt(sf, at);
      const key = `${m[1]}@${node === null ? at : node.getStart(sf)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ table: m[1]!, writer: `${rel(f)}#${inner?.name ?? '(module)'}`, sql: node === null ? text.slice(at, text.indexOf('\n', at)) : joined(node) });
    }
  }
  return out;
};
