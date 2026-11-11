// The ambient time-and-chance census (Overlord spec §11.5): every read of a clock, a timer or chance that does not come
// through the clock kernel's ports (`server/src/time/ports.ts`). `single-definition/time-ports.test.ts` holds the new
// Overlord and continuity modules to zero; today's code is outside that scope and is not rewritten.
import { identifierReferences, parseSource } from './parse.js';

export interface AmbientUse { line: number; what: string }

const NAMES: ReadonlySet<string> = new Set(['Date', 'performance', 'process', 'Math', 'AbortSignal', 'setTimeout', 'setInterval',
  'randomUUID', 'randomBytes', 'randomInt', 'randomFill', 'randomFillSync', 'getRandomValues']);

const TIMER_MODULES = /^(?:node:)?timers(?:\/promises)?$/;

/** What a reference to `Date` is, from its parent's text, or null when it reads no clock. */
function dateUse(context: string): string | null {
  if (context === 'Date') return null;                                   // a type
  if (/^Date\s*\.\s*(?:parse|UTC)\b/.test(context)) return null;
  if (/\binstanceof\s+Date$/.test(context)) return null;                 // a type test
  if (/^Date\s*\.\s*now\b/.test(context)) return 'Date.now';
  if (/^new\s+Date\s*(?:\(\s*\))?$/.test(context)) return 'new Date()';
  if (/^new\s+Date\s*\(/.test(context)) return null;                     // new Date(x): a stored time, not a reading
  if (/^Date\s*\(/.test(context)) return 'Date()';                       // a call answers now, whatever its arguments
  return context;
}

/** Every ambient read of time or chance in `text`: `Date.now` (called or passed), `new Date()` and `Date()` with no
 *  argument, any `performance` reference, `process.hrtime` and `process.uptime`, `setTimeout` and `setInterval` (any
 *  reference, an import from `node:timers` or `node:timers/promises` included), `Math.random`, and any reference to
 *  `randomUUID`, `randomBytes`, `randomInt`, `randomFill`, `randomFillSync` or `getRandomValues`, plus
 *  `AbortSignal.timeout` and any value import of `node:timers` or `node:timers/promises` by its specifier. Not ambient:
 *  `new Date(x)`, `Date.parse`, `Date.UTC`, `Date` as a type, and `setImmediate` (a yield, not a timer). */
export function ambientUses(fileName: string, text: string): AmbientUse[] {
  const refs = identifierReferences(text, fileName, NAMES);
  // `import { setTimeout as wait }`: a later `wait(…)` is reported by the name it imports.
  const aliasOf = new Map<string, string>();
  for (const r of refs) if (r.role === 'import' && r.imported !== null && r.imported !== r.name) aliasOf.set(r.name, r.imported);
  const out: AmbientUse[] = [];
  for (const r of refs) {
    const name = NAMES.has(r.name) ? r.name : aliasOf.get(r.name) ?? r.name;
    let what: string | null;
    if (name === 'Date') what = dateUse(r.context);
    else if (name === 'process') what = /^process\s*\.\s*(hrtime|uptime)\b/.exec(r.context)?.[0].replace(/\s+/g, '') ?? null;
    else if (name === 'Math') what = /^Math\s*\.\s*random\b/.test(r.context) ? 'Math.random' : null;
    else if (name === 'AbortSignal') what = /^AbortSignal\s*\.\s*timeout\b/.test(r.context) ? 'AbortSignal.timeout' : null;
    else what = name;
    if (what !== null) out.push({ line: r.line, what });
  }
  // The timers modules by their specifier: `scheduler.wait` from node:timers/promises shares its name with the port,
  // so no name list can catch it.
  for (const e of parseSource(text, fileName).imports) {
    if (!e.typeOnly && TIMER_MODULES.test(e.specifier)) out.push({ line: e.line, what: e.specifier });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** SQL that reads the clock or chance. SQLite's date functions read the clock when given no time value
 *  (`datetime()`, `date()`, `time()`, `julianday()`, `unixepoch()`, and `strftime` with a format alone). */
export const SQL_CLOCK = new RegExp(String.raw`\bCURRENT_(?:TIMESTAMP|DATE|TIME)\b|'now'`
  + String.raw`|\b(?:date|time|datetime|julianday|unixepoch)\s*\(\s*\)|\bstrftime\s*\(\s*'[^']*'\s*\)`
  + String.raw`|\brandom\s*\(\s*\)|\brandomblob\s*\(`, 'i');
