// The claimant client's census (D-7320; K5 tail, Task Q3h; plan 2026-10-29-consolidation-k5-claimant-doors.md, §The
// census files). This plan's own module, beside W3's `questions.ts`, as the retire and sleep plans keep theirs: only
// this plan's tasks edit it, and its FIXTURE and REAL rows live in the sibling `claimant.test.ts`. Every query
// REPORTS; each may-only-shrink pin lands in the commit that reaches its count (spec §5.1 rule 3), in Q3j and Q3l.
//
// The bash is read through the two readers the plan names, never a fresh `readFileSync` plus `match` over a table:
// `ccrcApiTable.ts#clientRoutes` (the client's `ROUTES` rows) and `hook-helpers.mjs#ccdFunctionDefinition` (a bash
// function's whole definition). The server half reads `questions.ts#questionDoors()`, imported, never copied.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO, type CensusSite } from '../consolidationCensus.js';
import { clientRoutes, type ClientRoute } from '../ccrcApiTable.js';
import { ccdFunctionDefinition, REGIONS } from '../../../shared/hook-helpers.mjs';
import { questionDoors, type QuestionDoorSite } from './questions.js';

const CLIENT = 'ccd/ccrc-api';
const HOOK = 'ccd/session-hook.sh';

/** The four old claimant doors, as the client's table spells them. The ask and approval READS (`asks.list`,
 *  `approvals.show`) and the hook's three calls (`approvals.request`, `.ruling`, `.key`) are not answer doors and are
 *  never counted (D-7327). */
export const OLD_CLAIMANT_DOORS: readonly string[] = [
  '/api/asks/{id}/answer', '/api/asks/{id}/release', '/api/approvals/{id}/rule', '/api/approvals/{id}/release',
];

export interface ClientRouteSite extends CensusSite { readonly key: string; readonly family: string | null }

const routeSite = (r: ClientRoute, src: string): ClientRouteSite =>
  ({ file: CLIENT, line: r.line, text: src.split('\n')[r.line - 1] ?? '', key: r.key, family: r.family });

const readClient = (root: string): string => readFileSync(path.join(root, CLIENT), 'utf8');

/** The client's rows whose path is one of the four old claimant doors. 4 at Q3h's base; 4 -> 0 at Q3l. */
export function clientClaimantRows(root: string = REPO): ClientRouteSite[] {
  const src = readClient(root);
  return clientRoutes(src).filter((r) => OLD_CLAIMANT_DOORS.includes(r.path)).map((r) => routeSite(r, src));
}

/** Of those, the rows with no family column: the rows whose only door is the old one. 4 at Q3h's base; 4 -> 0 at Q3j. */
export function clientOldOnlyRows(root: string = REPO): ClientRouteSite[] {
  return clientClaimantRows(root).filter((r) => r.family === null);
}

/** Every file under `root/ccd`, relative to `root`, sorted. */
const ccdFiles = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out.push(path.relative(root, abs));
    }
  };
  walk(path.join(root, 'ccd'));
  return out.sort();
};

/** The `[start, end)` offsets of every generated region `src` carries, by the engine's `REGIONS` rows. */
const regionSpans = (src: string): Array<readonly [number, number]> => {
  const spans: Array<readonly [number, number]> = [];
  for (const row of REGIONS) {
    let from = 0;
    for (;;) {
      const b = src.indexOf(`${row.begin}\n`, from);
      if (b < 0) break;
      const e = src.indexOf(`${row.end}\n`, b);
      if (e < 0) break;
      spans.push([b, e + row.end.length + 1]);
      from = e + row.end.length + 1;
    }
  }
  return spans;
};
const inside = (spans: ReadonlyArray<readonly [number, number]>, at: number): boolean => spans.some(([b, e]) => at >= b && at < e);
const lineAt = (src: string, at: number): number => src.slice(0, at).split('\n').length;
/** A definition without its name line: what a copy under another name must match byte for byte. */
const bodyOf = (def: string): string => def.slice(def.indexOf('\n') + 1);

export interface CapReaderDefinitionSite extends CensusSite { readonly name: string; readonly kind: 'hand' | 'generated' }

/** Every bash function definition under `ccd/` whose body (its whole definition by `ccdFunctionDefinition`, the name
 *  line dropped) is `_hook_server_cap`'s, split into `hand` (outside every generated region) and `generated`. At Q3h's
 *  base: hand 1 (`ccd/session-hook.sh#_hook_server_cap`), generated 0; generated 0 -> 1 at Q3i. */
export function capReaderDefinitions(root: string = REPO): CapReaderDefinitionSite[] {
  const ref = ccdFunctionDefinition(readFileSync(path.join(root, HOOK), 'utf8'), '_hook_server_cap');
  if (ref === null) throw new Error(`${HOOK} defines no _hook_server_cap`);
  const want = bodyOf(ref);
  const out: CapReaderDefinitionSite[] = [];
  for (const rel of ccdFiles(root)) {
    const src = readFileSync(path.join(root, rel), 'utf8');
    if (src.includes('\0')) continue;
    const spans = regionSpans(src);
    for (const m of src.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\(\) \{/gm)) {
      const def = ccdFunctionDefinition(src.slice(m.index), m[1]!);
      if (def === null || !def.includes('\n') || bodyOf(def) !== want) continue;
      const line = lineAt(src, m.index);
      out.push({ file: rel, line, text: src.split('\n')[line - 1] ?? '', name: m[1]!, kind: inside(spans, m.index) ? 'generated' : 'hand' });
    }
  }
  return out;
}

export interface CapReaderCallSite extends CensusSite { readonly guarded: boolean }

/** Every call of `_api_server_cap` in `ccd/ccrc-api` outside the generated regions (comment lines skipped, a definition
 *  line not a call), each `guarded` when the same line names `$claimant` BEFORE the call (the claimant-row test; it
 *  was `$family`, the row's fifth field, from Q3j until Q3l removed that field, D-7324). At Q3h's base: 0; 0 at Q3i,
 *  exactly 1 guarded and 0 unguarded at Q3j, and still at Q3l. This census, not a runtime probe, is the proof that no other row reads
 *  the cap file (D-7339). */
export function capReaderCalls(root: string = REPO): CapReaderCallSite[] {
  const src = readClient(root);
  const spans = regionSpans(src);
  const out: CapReaderCallSite[] = [];
  let at = 0;
  src.split('\n').forEach((text, i) => {
    const start = at;
    at += text.length + 1;
    if (/^\s*#/.test(text) || inside(spans, start)) return;
    const call = /\b_api_server_cap\b(?!\s*\(\))/.exec(text);
    if (call === null) return;
    const claimant = /\$\{?claimant\b/.exec(text);
    out.push({ file: CLIENT, line: i + 1, text, guarded: claimant !== null && claimant.index < call.index });
  });
  return out;
}

/** The server half: the question doors `questions.ts#questionDoors()` tags `claimant`. 6 at Q3h's base (the 4 old
 *  doors and the family's `/rule` and `/release`); 6 -> 2 at Q3l. */
export function serverClaimantDoors(root: string = REPO): QuestionDoorSite[] {
  return questionDoors(root).filter((d) => d.tag === 'claimant');
}
