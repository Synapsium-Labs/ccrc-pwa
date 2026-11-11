// The ambient time-and-chance census (Overlord spec §11.5): every read of a clock, a timer or chance that does not come
// through the clock kernel's ports (`server/src/time/ports.ts`). `single-definition/time-ports.test.ts` holds the new
// Overlord and continuity modules to zero; today's code is outside that scope and is not rewritten.
import { identifierReferences } from './parse.js';

export interface AmbientUse { line: number; what: string }

const NAMES: ReadonlySet<string> = new Set(['Date', 'performance', 'process', 'Math', 'setTimeout', 'setInterval',
  'randomUUID', 'randomBytes', 'randomInt', 'randomFill', 'randomFillSync', 'getRandomValues']);

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
 *  `randomUUID`, `randomBytes`, `randomInt`, `randomFill`, `randomFillSync` or `getRandomValues`. Not ambient:
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
    else what = name;
    if (what !== null) out.push({ line: r.line, what });
  }
  return out;
}

/** SQL that reads the clock or chance. */
export const SQL_CLOCK = /\bCURRENT_(?:TIMESTAMP|DATE|TIME)\b|'now'|\bunixepoch\s*\(\s*\)|\brandom\s*\(\s*\)|\brandomblob\s*\(/i;
