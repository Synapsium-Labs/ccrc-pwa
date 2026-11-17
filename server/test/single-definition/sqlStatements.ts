// THE ONE SCAN of coord.db's SQL writes (Overlord W2 row revisions, plan w2-revisions.md Task 2, F12: no second scanner).
// `writers-map.test.ts#tableWriters` names each table's writers from it, and the row revisions census
// (`row-revisions.test.ts` here) classifies each write of `asks` and `operator_items` from it, so both read one scan.
//
// A write is an INSERT or UPDATE (each with any `OR` arm), DELETE FROM or REPLACE INTO naming the table, in any letter
// case, bare, schema-qualified (`main.asks`) or quoted (`"asks"`, `` `asks` ``, `[asks]`), in a file's text with its
// comment lines blanked to spaces (prose naming a statement is no write, and offsets still hold). Its writer is the
// innermost enclosing symbol (`scan/parse.ts`), `file#Class.method`. Its `sql` is ONE statement: the string expression
// the verb sits in, its `+`-joined literal pieces joined first (`settleAsk` and `staleAsk` build theirs that way) with any
// piece that is not a literal read as `${…}`, then split on its top-level `;` (outside quotes, brackets and SQL
// comments), so each statement of a multi-statement `exec` is its own write, keyed by its own place. KNOWN WIDTH: a
// statement whose table name is built at run time, or split from its verb across string pieces, is not seen.
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

/** A table reference as a statement may spell it: bare, schema-qualified, or quoted; `name` is a regex alternation. */
export const tableRefSource = (name: string): string => `(?:(?:\\w+|"\\w+")\\.)?["\`\\[]?(${name})["\`\\]]?(?!\\w)`;
/** The write verbs before a table reference, any letter case (`gi`). */
const verbPattern = (tables: readonly string[]): RegExp =>
  new RegExp(`\\b(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|UPDATE(?:\\s+OR\\s+\\w+)?|DELETE\\s+FROM|REPLACE\\s+INTO)\\s+${tableRefSource(tables.join('|'))}`, 'gi');

/** A joined SQL text split on its top-level `;`: outside quotes, brackets and SQL comments (whose text is dropped). */
export const statementsOf = (sql: string): string[] => {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]!;
    if (ch === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e - 1; continue; }
    if (ch === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 1; continue; }
    const close = ch === "'" ? "'" : ch === '"' ? '"' : ch === '`' ? '`' : ch === '[' ? ']' : null;
    if (close !== null) { const e = sql.indexOf(close, i + 1); const end = e < 0 ? sql.length : e + 1; cur += sql.slice(i, end); i = end - 1; continue; }
    if (ch === ';') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  return [...out, cur].filter((s) => s.trim() !== '');
};

/** Every SQL write naming one of `tables`, in `files`, in file then text order; one entry per statement and table. */
export const sqlWrites = (files: readonly string[], tables: readonly string[]): SqlWrite[] => {
  const verb = verbPattern(tables);
  const canonical = new Map(tables.map((t) => [t.toLowerCase(), t]));
  const tableOf = (m: RegExpMatchArray): string => canonical.get(m[1]!.toLowerCase())!;
  const lower = tables.map((t) => t.toLowerCase());
  const out: SqlWrite[] = [];
  for (const f of files) {
    const raw = readFileSync(f, 'utf8');
    const folded = raw.toLowerCase();
    if (!lower.some((t) => folded.includes(t))) continue;
    const text = raw.replace(/^\s*(?:\*|\/\*|\/\/).*$/gm, (l) => ' '.repeat(l.length));
    const hits = [...text.matchAll(verb)];
    if (hits.length === 0) continue;
    const syms = parseFile(f).symbols;
    const sf = ts.createSourceFile(f, raw, ts.ScriptTarget.Latest, true);
    const seen = new Set<string>();
    for (const m of hits) {
      const at = m.index!;
      const inner = syms.filter((s) => s.start <= at && at < s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      const writer = `${rel(f)}#${inner?.name ?? '(module)'}`;
      const node = statementAt(sf, at);
      if (node === null) {
        const key = `${tableOf(m)}@${at}`;
        if (!seen.has(key)) { seen.add(key); out.push({ table: tableOf(m), writer, sql: text.slice(at, text.indexOf('\n', at)) }); }
        continue;
      }
      // One write per statement of the string and table it writes, keyed by the statement's place: never by the
      // string's start, which would fold a second statement of one `exec` into the first.
      const start = node.getStart(sf);
      if (seen.has(`@${start}`)) continue;
      seen.add(`@${start}`);
      for (const sql of statementsOf(joined(node))) {
        for (const t of new Set([...sql.matchAll(verb)].map(tableOf))) out.push({ table: t, writer, sql: sql.trim() });
      }
    }
  }
  return out;
};
