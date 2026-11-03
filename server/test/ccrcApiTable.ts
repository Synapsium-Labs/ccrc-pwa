// The one reader of `ccd/ccrc-api`'s `ROUTES` table (D-7320; K5 tail, Task Q3h; plan
// 2026-10-29-consolidation-k5-claimant-doors.md, §The census files). Every suite that needs the client's rows reads
// them here, so a table change (a row, a column) is read one way: `ccrc-api.test.ts` and `ccrc-api-closed.test.ts`
// take their row keys from `clientRoutes()`, and `census-w3/claimant.ts` counts the claimant rows from it.
//
// THE GRAMMAR, as the client's own header states it: `[<key>]='METHOD|path|needs-id|query keys (or -)'`, one row per
// line, between the `declare -A ROUTES=(` line and the first line that is a lone `)`. Blank lines and `#` comment lines
// are skipped. Any other line is not a row this reader can read, and it throws rather than skipping it: a row it could
// not see would be a row no census counts. A fifth field, when a row carries one, is the row's question-door family
// path (Q3j adds it); `-` or no fifth field reads as `null`.
import { readFileSync } from 'node:fs';
import { CCRC_API } from './ccdWsHelpers.js';

export interface ClientRoute {
  /** The verb pair, `group.verb` (`asks.answer`). */
  readonly key: string;
  readonly method: string;
  /** The path template, `{id}` where the row takes one. */
  readonly path: string;
  readonly needsId: boolean;
  /** The query keys the row accepts, in the table's order; empty for `-`. */
  readonly query: readonly string[];
  /** The family path the row sends instead of `path` when the server advertises the family; null on a four-field row. */
  readonly family: string | null;
  /** The 1-based line of the row in the client. */
  readonly line: number;
}

const OPEN = 'declare -A ROUTES=(';
const ROW = /^\s*\[([a-z][a-z0-9.-]*)\]='([^']*)'\s*$/;

/** One entry per `ROUTES` row of `src` (the client by default), in table order. */
export function clientRoutes(src: string = readFileSync(CCRC_API, 'utf8')): ClientRoute[] {
  const start = src.indexOf(`${OPEN}\n`);
  if (start < 0) throw new Error(`ccrcApiTable: no \`${OPEN}\` line in the client`);
  const end = src.indexOf('\n)', start);
  if (end < 0) throw new Error('ccrcApiTable: the ROUTES table never closes');
  const firstLine = src.slice(0, start).split('\n').length + 1;
  const lines = src.slice(start + OPEN.length + 1, end).split('\n');
  const out: ClientRoute[] = [];
  lines.forEach((text, i) => {
    if (text.trim() === '' || /^\s*#/.test(text)) return;
    const m = ROW.exec(text);
    if (m === null) throw new Error(`ccrcApiTable: not a ROUTES row, line ${firstLine + i}: ${text}`);
    const fields = m[2]!.split('|');
    if (fields.length < 4 || fields.length > 5) {
      throw new Error(`ccrcApiTable: ${m[1]} has ${fields.length} fields, not 4 or 5`);
    }
    const [method, path, needs, query, family] = fields as [string, string, string, string, string | undefined];
    out.push({
      key: m[1]!, method, path, needsId: needs === 'yes',
      query: query === '-' ? [] : query.split(','),
      family: family === undefined || family === '-' ? null : family,
      line: firstLine + i,
    });
  });
  return out;
}
