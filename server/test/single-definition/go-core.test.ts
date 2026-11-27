// Single-definition scanners, one area of the guard that used to be one file (see ./helpers.ts for the doctrine and the shared walkers).
//
// The Go core (core/): a vocabulary the generator owns (`core/gen/vocab.mjs`, from its TypeScript owner) is spelled once, in
// `vocab_gen.go`. The scan is text over the Go sources that ship in the binary (no test, no fixture), as the TypeScript
// scanners are over theirs. Moved here from hook-core-text-guards.test.ts (Go core wave 2, Task 9a review N2).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HOOK_EVENTS } from '../../../shared/hook-events.js';
import { ccrcRoot } from './helpers.js';

const read = (f: string): string => fs.readFileSync(path.join(ccrcRoot, f), 'utf8');
/** Every Go source under core/ that is not a test or a fixture: what ships in the binary. */
function goSources(dir = 'core'): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ccrcRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'testdata' && e.name !== 'bin') out.push(...goSources(rel)); }
    else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) out.push(rel);
  }
  return out;
}
/** A Go line with its `//` tail dropped, so prose about a name never counts. */
const code = (t: string): string => t.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const VOCAB = 'core/internal/kernel/vocab/vocab_gen.go';

describe('single-definition over core/: a vocabulary the generator owns is spelled once, in vocab_gen.go', () => {
  /** The files whose code names every one of `words` as a quoted string: a restated list. */
  const enumerating = (words: readonly string[]): string[] =>
    goSources().filter((f) => { const c = code(read(f)); return words.every((w) => c.includes(`"${w}"`)); });
  it('the hook event names are listed in no Go file but the vocabulary', () => {
    expect(enumerating(HOOK_EVENTS)).toEqual([VOCAB]);
  });
  it('the socket file and its name rule are spelled in no Go file but the vocabulary', () => {
    const hits = goSources().filter((f) => /tmux-socket|\[A-Za-z0-9_\]\[A-Za-z0-9_-\]\{0,63\}/.test(code(read(f))));
    expect(hits).toEqual([VOCAB]);
  });
  it('CONTROL: the scan sees a restated list', () => {
    expect(['SessionStart', 'Stop'].every((w) => code('var x = []string{"SessionStart", "Stop"}').includes(`"${w}"`))).toBe(true);
    expect(/tmux-socket/.test(code('f := filepath.Join(home, ".ccrc", "tmux-socket")'))).toBe(true);
    expect(/tmux-socket/.test(code('// the file ~/.ccrc/tmux-socket'))).toBe(false);
  });
});

