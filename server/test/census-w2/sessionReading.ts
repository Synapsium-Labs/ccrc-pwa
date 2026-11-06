// W2's census (D-8049; consolidation spec 2026-10-19 §5.5 exit, §5.1 rule 3: a GATE is a count from a committed census).
// W2 landed before it had one: `readSession` (ARCH-47, ARCH-48) and `turnWordOf` with its named policies (ARCH-50) were
// held by truth tables and characterization rows, which pin the answers and not how many places derive them. These two
// queries count the places, read from parsed symbols, never a line regex. The pins are in the sibling test.
import path from 'node:path';
import type { Comparison, ParsedFile } from '../scan/parse.js';
import { parsedFile } from '../scan/symbols.js';
import { REPO, sourceFiles } from '../consolidationCensus.js';

/** One function a query counted, as `file#name`. */
export type LadderSymbol = string;

const FUNCTION_KINDS = new Set(['function', 'variable-function', 'method', 'arrow-property']);
const relOf = (root: string, f: string): string => path.relative(root, f).split(path.sep).join('/');

/** The innermost named function holding `start`, or `(module)`. */
function functionAt(p: ParsedFile, start: number): string {
  return p.symbols.filter((s) => FUNCTION_KINDS.has(s.kind) && s.start <= start && start <= s.end)
    .sort((a, b) => b.start - a.start)[0]?.name ?? '(module)';
}

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
 * function `lifecycle` or `lc` compared or `lifecycleIsDead` called). A function that reads one fact alone is a reader of
 * a fact, not a ladder.
 * KNOWN WIDTH: the two facts must meet in one function, so a ladder split across two helpers is not seen, and a fact under
 * another name is not seen.
 */
export function statusLadders(root: string = REPO): LadderSymbol[] {
  const out: LadderSymbol[] = [];
  for (const f of sourceFiles(root, 'server/src')) {
    const p = parsedFile(f);
    const pane = new Set(p.comparisons.filter((c) => leafIn(c, PANE_LEAVES) && PANE_WORD.test(c.text)).map((c) => functionAt(p, c.start)));
    const life = new Set([
      ...p.comparisons.filter((c) => leafIn(c, LIFECYCLE_LEAVES)).map((c) => functionAt(p, c.start)),
      ...p.calls.filter((c) => c.name === 'lifecycleIsDead').map((c) => functionAt(p, c.start)),
    ]);
    for (const name of pane) if (life.has(name) && name !== '(module)') out.push(`${relOf(root, f)}#${name}`);
  }
  return out.sort();
}

const WORD_LEAVES: ReadonlySet<string> = new Set(['word', 'raw']);
const LIVE_STATUS = /\b(?:live|liveFile)\.status\b/;
const THE_READING = /\bturnWordOf\(|\.turn\.word\b/;

/** Whether a bare `word` in this comparison is the reading's: its binding was made by `turnWordOf` or read off a
 *  `SessionReading`, so the comparison is a caller's policy over a `Turn`, not a second read of the raw word. */
function readsTheReading(p: ParsedFile, c: Comparison): boolean {
  return p.bindings.some((b) => b.name === 'word' && b.scopeStart <= c.start && c.start < b.scopeEnd && b.start < c.start && THE_READING.test(b.init));
}

/**
 * The idle readers: each function under `server/src` that compares the live file's status word with `idle`, `busy` or
 * `shell` itself (a `word` or `raw` leaf, `live.status`, `liveFile.status`) rather than through `turnWordOf`. A `word`
 * bound from `turnWordOf(…)` or from a reading's `.turn.word` is a `Turn` already and is not counted.
 * KNOWN WIDTH: a raw word under another name is not seen: a plain `status`, which is `SessionStatus` far more often than
 * the raw word, is left out on purpose.
 */
export function rawTurnWordReaders(root: string = REPO): LadderSymbol[] {
  const out = new Set<LadderSymbol>();
  for (const f of sourceFiles(root, 'server/src')) {
    const p = parsedFile(f);
    for (const c of p.comparisons) {
      if (!TURN_WORD.test(c.text) || !(leafIn(c, WORD_LEAVES) || LIVE_STATUS.test(c.text)) || readsTheReading(p, c)) continue;
      out.add(`${relOf(root, f)}#${functionAt(p, c.start)}`);
    }
  }
  return [...out].sort();
}
