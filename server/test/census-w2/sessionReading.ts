// W2's census (D-8049; consolidation spec 2026-10-19 §5.5 exit, §5.1 rule 3: a GATE is a count from a committed census).
// W2 landed before it had one: `readSession` (ARCH-47, ARCH-48) and `turnWordOf` with its named policies (ARCH-50) were
// held by truth tables and characterization rows, which pin the answers and not how many places derive them. These two
// queries count the places, read from parsed symbols, never a line regex. The pins are in the sibling test.
import path from 'node:path';
import type { Comparison, ParsedFile } from '../scan/parse.js';
import { parsedFile } from '../scan/symbols.js';
import { REPO, sourceFiles } from '../consolidationCensus.js';

/** One site a query counted, as `file#function text`. A function holding two sites has two rows, so a new site inside a
 *  function already listed is a new row: a list of functions could not see it, and `buildServer` alone holds the routes. */
export type CensusSite = string;

const FUNCTION_KINDS = new Set(['function', 'variable-function', 'method', 'arrow-property']);
const relOf = (root: string, f: string): string => path.relative(root, f).split(path.sep).join('/');

/** The innermost named function holding `start`, or `(module)`. */
function functionAt(p: ParsedFile, start: number): string {
  return p.symbols.filter((s) => FUNCTION_KINDS.has(s.kind) && s.start <= start && start <= s.end)
    .sort((a, b) => b.start - a.start)[0]?.name ?? '(module)';
}

const rowOf = (root: string, f: string, at: string, text: string): CensusSite => `${relOf(root, f)}#${at} ${text}`;

const COMPARED = '(?:===|!==|==|!=)';
const against = (words: string): RegExp => new RegExp(`(?:${COMPARED}\\s*'(?:${words})'$)|(?:^'(?:${words})'\\s*${COMPARED})`);
const PANE_WORD = against('gone|live|unknown');
const TURN_WORD = against('idle|busy|shell');
const leafIn = (c: Comparison, names: ReadonlySet<string>): boolean =>
  (c.leftLeaf !== null && names.has(c.leftLeaf)) || (c.rightLeaf !== null && names.has(c.rightLeaf));

const PANE_LEAVES: ReadonlySet<string> = new Set(['verdict', 'pane']);
const LIFECYCLE_LEAVES: ReadonlySet<string> = new Set(['lifecycle', 'lc']);

/**
 * The status-derivation ladders: each function under `server/src` that weighs tmux's pane word and the session's lifecycle
 * together, the shape of "is it alive" (`verdict` or `pane` compared with `gone`, `live` or `unknown`, and in the same
 * function `lifecycle` or `lc` compared or `lifecycleIsDead` called). Every fact such a function weighs is a row. A function
 * that reads one fact alone is a reader of a fact, not a ladder.
 * KNOWN WIDTH: the two facts must meet in one function, so a ladder split across two helpers is not seen, and a fact under
 * another name is not seen. A row has no line number, so a site moved within its function, or swapped for an identical
 * one, reads the same; the count does not grow in either case.
 */
export function statusLadders(root: string = REPO): CensusSite[] {
  const out: CensusSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const p = parsedFile(f);
    const pane = p.comparisons.filter((c) => leafIn(c, PANE_LEAVES) && PANE_WORD.test(c.text))
      .map((c) => ({ at: functionAt(p, c.start), text: c.text }));
    const life = [
      ...p.comparisons.filter((c) => leafIn(c, LIFECYCLE_LEAVES)).map((c) => ({ at: functionAt(p, c.start), text: c.text })),
      ...p.calls.filter((c) => c.name === 'lifecycleIsDead')
        .map((c) => ({ at: functionAt(p, c.start), text: p.text.slice(c.start, c.end).replace(/\s*\n\s*/g, ' ') })),
    ];
    const weighsPane = new Set(pane.map((s) => s.at));
    const weighsLife = new Set(life.map((s) => s.at));
    for (const s of [...pane, ...life]) {
      if (weighsPane.has(s.at) && weighsLife.has(s.at) && s.at !== '(module)') out.push(rowOf(root, f, s.at, s.text));
    }
  }
  return out.sort();
}

const WORD_LEAVES: ReadonlySet<string> = new Set(['word', 'raw']);
const LIVE_STATUS = /\b(?:live|liveFile)\.status\b/;
const THE_READING = /\bturnWordOf\(|\.turn\.word\b/;

const BARE_WORD = /^word\s|\sword$/;

/** Whether a bare `word` in this comparison is the reading's: its binding was made by `turnWordOf` or read off a
 *  `SessionReading`, so the comparison is a caller's policy over a `Turn`, not a second read of the raw word. Only the bare
 *  word is excused: a `live.status` or a `.word` leaf beside that binding is still a raw read. */
function readsTheReading(p: ParsedFile, c: Comparison): boolean {
  if (!BARE_WORD.test(c.text)) return false;
  return p.bindings.some((b) => b.name === 'word' && b.scopeStart <= c.start && c.start < b.scopeEnd && b.start < c.start && THE_READING.test(b.init));
}

/**
 * The idle readers: each comparison under `server/src` of the live file's status word with `idle`, `busy` or `shell` made
 * directly (a `word` or `raw` leaf, `live.status`, `liveFile.status`) rather than through `turnWordOf`. A `word` bound from
 * `turnWordOf(…)` or from a reading's `.turn.word` is a `Turn` already and is not counted.
 * KNOWN WIDTH: a raw word under another name is not seen: a plain `status`, which is `SessionStatus` far more often than
 * the raw word, is left out on purpose. A `switch` on the word is no comparison and is not seen. A row has no line number,
 * so a site moved within its function, or swapped for an identical one, reads the same; the count does not grow in either
 * case.
 */
export function rawTurnWordReaders(root: string = REPO): CensusSite[] {
  const out: CensusSite[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const p = parsedFile(f);
    for (const c of p.comparisons) {
      if (!TURN_WORD.test(c.text) || !(leafIn(c, WORD_LEAVES) || LIVE_STATUS.test(c.text)) || readsTheReading(p, c)) continue;
      out.push(rowOf(root, f, functionAt(p, c.start), c.text));
    }
  }
  return out.sort();
}
