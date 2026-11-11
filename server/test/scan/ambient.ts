// The ambient time-and-chance census (Overlord spec §11.5): every read of a clock, a timer or chance that does not come
// through the clock kernel's ports (`server/src/time/ports.ts`). `single-definition/time-ports.test.ts` holds the new
// Overlord and continuity modules to zero; today's code is outside that scope and is not rewritten.
import { identifierReferences, parseSource } from './parse.js';

export interface AmbientUse { line: number; what: string }

const NAMES: ReadonlySet<string> = new Set(['Date', 'performance', 'process', 'Math', 'AbortSignal', 'setTimeout',
  'setInterval', 'randomUUID', 'randomBytes', 'randomInt', 'randomFill', 'randomFillSync', 'getRandomValues']);

const TIMER_MODULES = /^(?:node:)?timers(?:\/promises)?$/;
const PROCESS_MODULE = /^(?:node:)?process$/;

/** The members of a global that read a clock or chance. The global is read through its own name or through
 *  `globalThis` or `global`, inside parentheses and past a non-null `!`, and the member through `.` or `?.`; bracket
 *  access, a copy of the global and a comment inside the access are not followed. */
const GLOBAL_MEMBERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['process', new Set(['hrtime', 'uptime'])], ['Math', new Set(['random'])], ['AbortSignal', new Set(['timeout'])],
]);
const MEMBERS: ReadonlySet<string> = new Set([...GLOBAL_MEMBERS.values()].flatMap((m) => [...m]));
/** A member read's own access expression, as text (the member identifier's parent):
 *  `[(][globalThis|global[)][!](?).]<global>[)][!](?).<member>`. */
const MEMBER_READ = /^[(\s]*(?:(?:globalThis|global)[\s!)]*\??\.\s*)?(\w+)[\s!)]*\??\.\s*(\w+)$/;

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
 *  `AbortSignal.timeout`, any value import of `node:timers` or `node:timers/promises` by its specifier, and a value
 *  import of `node:process` other than a default bound as `process`. `process`, `Math` and `AbortSignal` members are
 *  read as `GLOBAL_MEMBERS` says. Not ambient:
 *  `new Date(x)`, `Date.parse`, `Date.UTC`, `Date` as a type, and `setImmediate` (a yield, not a timer). */
export function ambientUses(fileName: string, text: string): AmbientUse[] {
  const refs = identifierReferences(text, fileName, new Set([...NAMES, ...MEMBERS]));
  // `import { setTimeout as wait }`: a later `wait(…)` is reported by the name it imports. Only a global's own name is
  // followed: `import { timeout as t } from './x.js'` is some module's helper, and a member name is ambient only as a
  // global's member.
  const aliasOf = new Map<string, string>();
  for (const r of refs) {
    const imported = r.role === 'import' ? r.imported : null;
    if (imported !== null && imported !== r.name && NAMES.has(imported)) aliasOf.set(r.name, imported);
  }
  const out: AmbientUse[] = [];
  for (const r of refs) {
    let what: string | null;
    if (MEMBERS.has(r.name) && !NAMES.has(r.name)) {
      // Imported by name: node:process's import is reported by its specifier below, and any other module's is a helper.
      if (r.role === 'import') continue;
      // A member identifier: its parent is the whole access, so the global is read off that access's text.
      const m = MEMBER_READ.exec(r.context);
      what = m !== null && m[2] === r.name && GLOBAL_MEMBERS.get(m[1]!)?.has(r.name) ? `${m[1]}.${r.name}` : null;
      if (what !== null) out.push({ line: r.line, what });
      continue;
    }
    const name = NAMES.has(r.name) ? r.name : aliasOf.get(r.name);
    if (name === undefined) continue;                                     // an alias of a member name: no global
    if (name === 'Date') what = dateUse(r.context);
    else if (GLOBAL_MEMBERS.has(name)) what = null;                       // read through its member, above
    else what = name;
    if (what !== null) out.push({ line: r.line, what });
  }
  // The timers modules by their specifier: `scheduler.wait` from node:timers/promises shares its name with the port,
  // so no name list can catch it. `node:process` by its specifier too, unless the import binds only the global's own
  // name (`import process from …`), whose member reads the arm above sees.
  for (const e of parseSource(text, fileName).imports) {
    if (e.typeOnly) continue;
    const bindsValue = (e.typeNames?.length ?? 0) < e.names.length;
    if (TIMER_MODULES.test(e.specifier)) out.push({ line: e.line, what: e.specifier });
    else if (PROCESS_MODULE.test(e.specifier) && bindsValue && !(e.names.length === 1 && e.names[0] === 'process')) {
      out.push({ line: e.line, what: e.specifier });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** One trailing modifier argument of an SQLite date function: a string literal or a bound parameter. */
const SQL_MODIFIER = String.raw`\s*,\s*(?:'[^']*'|\?\d*|[:@$]\w+)`;
/** SQL that reads the clock or chance. SQLite's date functions read the clock when given no time value
 *  (`datetime()`, `date()`, `time()`, `julianday()`, `unixepoch()`, and `strftime` with a format alone), and when
 *  `'subsec'` or `'subsecond'` stands where the time value goes, with or without modifiers after it
 *  (`unixepoch('subsec')`, `datetime('subsec', 'localtime')`, `strftime('%s', 'subsec', 'utc')`). */
export const SQL_CLOCK = new RegExp(String.raw`\bCURRENT_(?:TIMESTAMP|DATE|TIME)\b|'now'`
  + String.raw`|\b(?:date|time|datetime|julianday|unixepoch)\s*\(\s*(?:'subsec(?:ond)?'(?:${SQL_MODIFIER})*\s*)?\)`
  + String.raw`|\bstrftime\s*\(\s*'[^']*'\s*(?:,\s*'subsec(?:ond)?'(?:${SQL_MODIFIER})*\s*)?\)`
  + String.raw`|\brandom\s*\(\s*\)|\brandomblob\s*\(`, 'i');
