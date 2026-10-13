/**
 * The merge-queue WORDS, pinned across the two languages (landing-order wave 2, review 241 F5, D-3882).
 *
 * `_pr_queue_py` in ccd/ccd (embedded python) is the only thing that SAYS a queue word; `queueFor` in
 * `server/src/prstate.ts` is the only thing that READS one, and it reads a word it does not know as
 * `unmeasured` — which the landing lane treats as "no evidence", so it says nothing. A word renamed in ccd,
 * together with ccd's own test, therefore reds nothing on the server side and silently mutes the dequeue
 * notice (review 241's X1: `return 'dequeued', at` → `return 'removed', at`, re-stamped, left `pr-queue-lane`
 * at 18 passed because its fixture lines spell the words by hand).
 *
 * This case reads the words the embedded program can emit OUT OF ccd's TEXT (never runs ccd, never touches a
 * HOME) and compares them, as a set, with `PR_QUEUE_WORDS` — the one list `PR_QUEUE_MAP` derives. The program
 * is python, so what is read is the `return '<word>'` literals of its `word()` function, and the one place the
 * result reaches the wire. Each extraction step fails LOUDLY when it finds nothing, so a reshaped function
 * cannot pass by being unreadable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD } from './ccdWsHelpers.js';
import { PR_QUEUE_WORDS } from '../src/prstate.js';

/** The embedded python program of `_pr_queue_py`: from its `python3 /dev/fd/3 3<<'PY'` line to the terminator. */
const queueProgram = (src: string): string => {
  const head = src.indexOf('\n_pr_queue_py() {');
  if (head < 0) throw new Error('ccd no longer defines _pr_queue_py as a function at column 0');
  const open = src.indexOf("python3 /dev/fd/3 3<<'PY'\n", head);
  if (open < 0) throw new Error("_pr_queue_py no longer carries its program as a quoted 'PY' heredoc on fd 3");
  const body = src.indexOf('\n', open) + 1;
  const end = src.indexOf('\nPY\n', body);
  if (end < 0) throw new Error("_pr_queue_py's PY heredoc has no terminator line");
  return src.slice(body, end);
};

/** The body of the program's `def word(line):` — to the next line that is not indented. */
const wordBody = (program: string): string => {
  const m = /^def word\(line\):\n((?:[ \t]+.*\n|\n)+)/m.exec(program);
  if (m === null) throw new Error('_pr_queue_py no longer defines `def word(line):` at column 0');
  return m[1]!;
};

/** Every word `word()` can return: each `return '<word>'` literal, first element of the pair. */
const emittedWords = (src: string): string[] => {
  const words = [...wordBody(queueProgram(src)).matchAll(/\breturn\s+'([^']*)'/g)].map((m) => m[1]!);
  if (words.length === 0) throw new Error('word() has no `return \'<word>\'` literal: the extractor reads nothing');
  return [...new Set(words)].sort();
};

describe('ccd\'s merge-queue words are the server\'s (D-3882)', () => {
  const src = readFileSync(CCD, 'utf8');

  it('every word `_pr_queue_py` can emit is a PR_QUEUE_MAP word, and every PR_QUEUE_MAP word is emitted', () => {
    expect(emittedWords(src)).toEqual([...PR_QUEUE_WORDS].sort());
  });

  it('the program writes the line\'s queue field from word() and from nowhere else', () => {
    const program = queueProgram(src);
    expect([...program.matchAll(/\[\s*'queue'\s*\]\s*=([^\n]*)/g)].map((m) => m[1]!.trim())).toEqual(['w']);
    expect(program).toMatch(/\bw, at = word\(v\)/);
  });

  it('the extractor refuses a program it cannot read, rather than passing on nothing', () => {
    expect(() => emittedWords('no queue function here')).toThrow(/_pr_queue_py as a function/);
    const reshaped = src.replace('def word(line):', 'def verdict(line):');
    expect(() => emittedWords(reshaped)).toThrow(/def word/);
    const noReturns = src.replace(/return '[a-z]+'/g, 'return w');
    expect(() => emittedWords(noReturns)).toThrow(/extractor reads nothing/);
  });
});
