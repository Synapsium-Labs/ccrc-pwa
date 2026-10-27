// How a tool box's wells are read (T4a, D-6387): the PLAN for one well of a tool call, input or result, as one of
// four kinds. `code` is text in a highlight.js grammar (a Bash command, a Write's content, any other tool's input as
// JSON), `diff` is unified-diff text (an Edit's hunk, a result that starts like `git diff`), `ansi` is a result that
// carries terminal escapes (`lib/ansi.ts`), and `plain` is today's text node, unchanged. The renderer draws the plan; this
// module only decides it.
//
// Pure and L1: it imports nothing. Whether a grammar is registered is the caller's to say
// (`lib/markdown.tsx#isRegisteredGrammar`, handed in as `isRegistered`), because an L1 module may not load a `.tsx`.
//
// The input is the call's compact JSON as the server cut it (4000 characters, so a long input arrives TRUNCATED and
// does not parse). A text that does not parse is `plain`: it is never repaired and no prefix is retried, because a
// guessed closing would draw words the tool never took.

export type ToolWellPart = 'input' | 'result';

export type ToolWellPlan =
  | { kind: 'plain' }
  | { kind: 'code'; lang: string; text: string; head?: string }
  | { kind: 'diff'; text: string }
  | { kind: 'ansi' };

const PLAIN: ToolWellPlan = { kind: 'plain' };

type Fields = Record<string, unknown>;

const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const shown = (v: unknown): string => (isString(v) ? v : JSON.stringify(v));

/** `, <key>: <value>` for every field of `o` not in `skip`, in the object's order. */
function extras(o: Fields, skip: readonly string[]): string {
  return Object.keys(o).filter((k) => !skip.includes(k)).map((k) => `, ${k}: ${shown(o[k])}`).join('');
}

/** `text` as shell comment lines: the mark on every line, so a multi-line value never becomes a command. */
const commentLines = (text: string): string[] => text.split('\n').map((l) => `# ${l}`);

function bashPlan(o: Fields): ToolWellPlan | null {
  if (!isString(o.command)) return null;
  const lines: string[] = [];
  if (isString(o.description)) lines.push(...commentLines(o.description));
  for (const k of Object.keys(o)) {
    if (k === 'command' || (k === 'description' && isString(o.description))) continue;
    lines.push(...commentLines(`${k}: ${shown(o[k])}`));
  }
  lines.push(o.command);
  return { kind: 'code', lang: 'bash', text: lines.join('\n') };
}

/** One hunk: the header, every old line as `-`, every new line as `+`. */
const hunk = (header: string, oldS: string, newS: string): string =>
  [`@@ ${JSON.stringify(header).slice(1, -1).replace(/[\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)} @@`, ...oldS.split('\n').map((l) => `-${l}`), ...newS.split('\n').map((l) => `+${l}`)].join('\n');

function editPlan(o: Fields): ToolWellPlan | null {
  if (!isString(o.file_path) || !isString(o.old_string) || !isString(o.new_string)) return null;
  return { kind: 'diff', text: hunk(`${o.file_path}${extras(o, ['file_path', 'old_string', 'new_string'])}`, o.old_string, o.new_string) };
}

function multiEditPlan(o: Fields): ToolWellPlan | null {
  if (!isString(o.file_path) || !Array.isArray(o.edits) || o.edits.length === 0) return null;
  const n = o.edits.length;
  const hunks: string[] = [];
  for (let i = 0; i < n; i++) {
    const e: unknown = o.edits[i];
    if (!isObject(e) || !isString(e.old_string) || !isString(e.new_string)) return null;
    const top = i === 0 ? extras(o, ['file_path', 'edits']) : '';
    hunks.push(hunk(`${o.file_path} (edit ${i + 1}/${n})${top}${extras(e, ['old_string', 'new_string'])}`, e.old_string, e.new_string));
  }
  return { kind: 'diff', text: hunks.join('\n') };
}

/** The extension of a path's basename, lower-cased; `''` when it has none. */
function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function writePlan(o: Fields, isRegistered: (lang: string) => boolean): ToolWellPlan | null {
  if (!isString(o.file_path) || !isString(o.content)) return null;
  const ext = extensionOf(o.file_path);
  if (!ext || !isRegistered(ext)) return PLAIN;
  return { kind: 'code', lang: ext, text: o.content, head: `${o.file_path}${extras(o, ['file_path', 'content'])}` };
}

function inputPlan(use: { name: string }, text: string, isRegistered: (lang: string) => boolean): ToolWellPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return PLAIN;
  }
  let plan: ToolWellPlan | null = null;
  if (isObject(parsed)) {
    if (use.name === 'Bash') plan = bashPlan(parsed);
    else if (use.name === 'Edit') plan = editPlan(parsed);
    else if (use.name === 'MultiEdit') plan = multiEditPlan(parsed);
    else if (use.name === 'Write') plan = writePlan(parsed, isRegistered);
  }
  return plan ?? { kind: 'code', lang: 'json', text: JSON.stringify(parsed, null, 2) };
}

/** Whether the text is headed by a unified diff: its first non-blank line starts `diff --git `, or starts `--- ` with
 *  `+++ ` on the next line, or starts `@@ `. */
function diffHeaded(text: string): boolean {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() !== '');
  if (at < 0) return false;
  const first = lines[at]!;
  return first.startsWith('diff --git ') || first.startsWith('@@ ')
    || (first.startsWith('--- ') && (lines[at + 1] ?? '').startsWith('+++ '));
}

/** How the `part` well of the call `use` reads. `text` is the well's text: the call's input JSON for `'input'`, the
 *  result text for `'result'`; `isRegistered` says whether a grammar name is registered. */
export function toolWellPlan(
  use: { name: string; input: string },
  part: ToolWellPart,
  text: string,
  isRegistered: (lang: string) => boolean,
): ToolWellPlan {
  if (part === 'input') return inputPlan(use, text, isRegistered);
  if (text.includes('\x1b')) return { kind: 'ansi' };
  return diffHeaded(text) ? { kind: 'diff', text } : PLAIN;
}
