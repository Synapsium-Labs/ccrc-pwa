// The per-tool summariser and the tool-run fold (D-5475, W2 plan Task S13a).
//
// WHAT IT IS. A pure model over the items `buildChatItems` already produces:
// `toolSummary` says one tool entry in plain language ("Read chat.css",
// "Ran npm"), and `groupToolRun` folds each run of consecutive tool entries
// into one group whose sentence counts them ("Read 3 files · Edited chat.css ·
// Ran npm"). Its readers are the skins' transcript rows — Refined's grouped
// row (S13b) and Instrument's log line (S14) — and both render THIS function's
// words, so a tool reads the same in either skin ("one derived value, one
// function").
//
// WHAT IT NEVER DOES (D-5475):
//  - carry a path's directories: an object is a file name only, cut to
//    `SUMMARY_OBJECT_MAX` code points with an ellipsis, and a path-like word
//    in an Agent description goes to its file name too. A Grep pattern is the
//    one exception: it is a regex, where a slash is a character, so it stays
//    whole. The full input stays in the `ToolCard`, one tap away;
//  - count by the words it shows: a group's clause counts distinct calls by
//    their full input (the whole path, the whole command), so two different
//    `index.ts` files are two files and `git status` and `git diff` are two
//    commands;
//  - fold an ask, a failed entry or a live entry: each ends the run it would
//    have joined and stays its own `tool` item, so nothing that wants the
//    reader's eye is hidden inside a fold.
//
// The tool names live in `VERBS` and nowhere else; any tool not in it is its
// own name, verbatim.
import type { ToolResultEvent, ToolUseEvent } from '@ccrc/ui';
import type { ChatItem } from './chatItems';

type ToolItem = Extract<ChatItem, { kind: 'tool' }>;

/** An object (a file name, a pattern, a description) longer than this is cut,
 *  the last of these characters being the ellipsis. */
export const SUMMARY_OBJECT_MAX = 40;

/** One tool entry, as the summariser reads it. `result` is absent (or null)
 *  while the call is still running. */
export interface ToolEntry {
  use: ToolUseEvent;
  result?: ToolResultEvent | null;
}

export interface ToolSummary {
  /** The plain verb ("Read", "Edited", "Ran", …), or the tool's own name. */
  verb: string;
  /** What it acted on, cut and directory-free; '' when there is nothing to say. */
  object: string;
  failed: boolean;
  live: boolean;
  /** The one-line sentence a row shows. */
  sentence: string;
}

/** How an object is lifted out of the input and how it is cut. */
type Shape = 'file' | 'word' | 'text' | 'none';

interface Verb {
  verb: string;
  /** The input field the object comes from. */
  field?: string;
  shape: Shape;
  /** The sentence for one entry with this object. */
  one: (object: string) => string;
  /** The sentence for several entries with distinct objects. */
  many: (count: number) => string;
  /** When the object cannot be read (an input cut upstream, a missing field). */
  bare: string;
  /** A 'text' object that is prose, whose path-like words go to file names. */
  prose?: boolean;
}

const READ: Verb = {
  verb: 'Read', field: 'file_path', shape: 'file',
  one: (o) => `Read ${o}`, many: (c) => `Read ${c} files`, bare: 'Read a file',
};
const edited = (field: string): Verb => ({
  verb: 'Edited', field, shape: 'file',
  one: (o) => `Edited ${o}`, many: (c) => `Edited ${c} files`, bare: 'Edited a file',
});
const RAN: Verb = {
  verb: 'Ran', field: 'command', shape: 'word',
  one: (o) => `Ran ${o}`, many: (c) => `Ran ${c} commands`, bare: 'Ran a command',
};
const searched = (shape: Shape): Verb => ({
  verb: 'Searched', field: 'pattern', shape,
  one: (o) => `Searched for ${o}`, many: (c) => `Searched for ${c} patterns`, bare: 'Searched',
});
const DELEGATED: Verb = {
  verb: 'Delegated', field: 'description', shape: 'text', prose: true,
  one: (o) => `Delegated: ${o}`, many: (c) => `Delegated ${c} tasks`, bare: 'Delegated a task',
};
const TASK_LIST: Verb = {
  verb: 'Updated', shape: 'none',
  one: () => 'Updated the task list', many: () => 'Updated the task list', bare: 'Updated the task list',
};

/** The summariser's table — the one list of tool names this module keeps. */
const VERBS: Readonly<Record<string, Verb>> = {
  Read: READ,
  Edit: edited('file_path'),
  MultiEdit: edited('file_path'),
  Write: edited('file_path'),
  NotebookEdit: edited('notebook_path'),
  Bash: RAN,
  // Grep's pattern is a regex, where a slash is a character, not a directory.
  Grep: searched('text'),
  // Glob's pattern is a path pattern: its directories go like a file's do.
  Glob: searched('file'),
  // The sub-agent: `Agent` today, `Task` in older transcripts.
  Agent: DELEGATED,
  Task: DELEGATED,
  TodoWrite: TASK_LIST,
  TaskCreate: TASK_LIST,
  TaskUpdate: TASK_LIST,
};

/** A string field of the tool's input. The input is compact JSON, but cut at
 *  TOOL_INPUT_MAX upstream, so a long call arrives unparseable: the field is
 *  then read off the text, the way it was written. */
function field(input: string, key: string): string | null {
  try {
    const v = (JSON.parse(input) as Record<string, unknown> | null)?.[key];
    return typeof v === 'string' ? v : null;
  } catch {
    const m = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)`).exec(input);
    if (!m) return null;
    // A cut mid-escape leaves a lone backslash; drop it so the string decodes.
    const body = (m[1] ?? '').replace(/\\$/, '');
    try {
      return JSON.parse(`"${body}"`) as string;
    } catch {
      return null;
    }
  }
}

/** The last segment of a path, by either separator. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p !== '');
  return parts[parts.length - 1] ?? '';
}

/** Cut by code points, so an astral character (an emoji) is never split. */
function cut(s: string): string {
  const points = Array.from(s);
  return points.length > SUMMARY_OBJECT_MAX ? `${points.slice(0, SUMMARY_OBJECT_MAX - 1).join('')}…` : s;
}

/** One shell word: quoted, or up to the next space. */
const WORD = String.raw`(?:"[^"]*"|'[^']*'|[^\s;&|]+)`;
/** A leading `cd <dir> &&` or `cd <dir>;`, and a leading `VAR=value`. */
const CD_PREFIX = new RegExp(String.raw`^cd\s+${WORD}\s*(?:&&|;)\s*`);
const ENV_PREFIX = new RegExp(String.raw`^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+`);

/** The command a Bash call runs: its first word once any leading `cd <dir>`
 *  step and `VAR=value` words are gone. */
function commandWord(raw: string): string {
  let rest = raw;
  for (;;) {
    const next = rest.replace(CD_PREFIX, '').replace(ENV_PREFIX, '');
    if (next === rest) break;
    rest = next;
  }
  // The first word is often a path itself (./node_modules/.bin/vitest).
  return baseName(rest.split(/\s+/, 1)[0] ?? '');
}

/** A prose description with each path-like word reduced to its file name. */
function proseOf(raw: string): string {
  return raw
    .split(/\s+/)
    .map((w) => (/[\\/]/.test(w) ? baseName(w) : w))
    .filter((w) => w !== '')
    .join(' ');
}

/** The raw field an object comes from: '' when there is none or it is unreadable. */
function rawOf(v: Verb, input: string): string {
  if (v.shape === 'none' || v.field === undefined) return '';
  return field(input, v.field)?.trim() ?? '';
}

function objectOf(v: Verb, input: string): string {
  const raw = rawOf(v, input);
  if (raw === '') return '';
  const lifted =
    v.shape === 'file' ? baseName(raw)
    : v.shape === 'word' ? commandWord(raw)
    : v.prose === true ? proseOf(raw)
    : raw.replace(/\s+/g, ' ');
  return cut(lifted);
}

/** One tool entry in plain language. */
export function toolSummary(entry: ToolEntry): ToolSummary {
  const { use, result } = entry;
  // `== null`, not `=== undefined`: a null result is no result either.
  const live = result == null;
  const failed = !live && result.isError === true;
  const v = VERBS[use.name];
  if (v === undefined) {
    const base = use.name;
    return { verb: use.name, object: '', failed, live, sentence: failed ? `${base} — failed` : base };
  }
  const object = objectOf(v, use.input);
  const base = v.shape === 'none' ? v.one('') : object === '' ? v.bare : v.one(object);
  return { verb: v.verb, object, failed, live, sentence: failed ? `${base} — failed` : base };
}

/** A run of consecutive tool entries, folded into one transcript item. */
export interface ToolGroupItem {
  kind: 'tool-group';
  key: string;
  entries: ToolItem[];
  sentence: string;
}

/** What a transcript renders once runs are folded. */
export type TranscriptItem = ChatItem | ToolGroupItem;

/** Never folded: an ask (a question for the reader), a failed entry and a
 *  live one. Each ends the run it would join, and stands alone. */
function standsAlone(item: ToolItem): boolean {
  if (item.use.name === 'AskUserQuestion') return true;
  const s = toolSummary(item);
  return s.failed || s.live;
}

/** The counted sentence for a group: one clause per verb (per tool name, for a
 *  tool outside the table), in the order each first appears. A clause counts
 *  distinct calls by their full input — the whole path, the whole command —
 *  never by the cut object it shows (D-5475). */
function groupSentence(entries: ToolItem[]): string {
  const clauses = new Map<
    string,
    { verb: Verb | undefined; name: string; calls: Set<string>; object: string; count: number }
  >();
  for (const e of entries) {
    const v = VERBS[e.use.name];
    // Keyed on the clause the reader sees: Edit and Write both say "Edited".
    const key = v ? `v:${v.verb}:${v.many(2)}` : `n:${e.use.name}`;
    const c = clauses.get(key) ?? { verb: v, name: e.use.name, calls: new Set<string>(), object: '', count: 0 };
    c.count += 1;
    if (v) {
      c.calls.add(rawOf(v, e.use.input));
      c.object = objectOf(v, e.use.input);
    }
    clauses.set(key, c);
  }
  return [...clauses.values()]
    .map(({ verb, name, calls, object, count }) => {
      if (verb === undefined) return count > 1 ? `${name} ×${count}` : name;
      if (verb.shape === 'none') return verb.one('');
      if (calls.size > 1) return verb.many(calls.size);
      return object === '' ? verb.bare : verb.one(object);
    })
    .join(' · ');
}

/** Fold each run of consecutive foldable tool entries into one group. Every
 *  other item passes through untouched, in order. */
export function groupToolRun(items: readonly ChatItem[]): TranscriptItem[] {
  const out: TranscriptItem[] = [];
  let run: ToolItem[] = [];
  const close = (): void => {
    const first = run[0];
    if (first !== undefined) {
      out.push({ kind: 'tool-group', key: `group-${first.key}`, entries: run, sentence: groupSentence(run) });
      run = [];
    }
  };
  for (const item of items) {
    if (item.kind === 'tool' && !standsAlone(item)) {
      run.push(item);
      continue;
    }
    close();
    out.push(item);
  }
  close();
  return out;
}
