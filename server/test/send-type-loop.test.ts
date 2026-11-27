// The send's line loop, pinned before and after it moved out of `sendPrompt` (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 4.1): a CHARACTERIZATION case, green on `main` against the
// inline loop and green after the move against `typeComposedLines`, so the move changes no key. The keys a multiline
// message is typed with, up to its first Enter: each line as one literal, `M-Enter` between lines.
import { describe, expect, it } from 'vitest';
import { KeyedQueue } from '../src/inject/queue.js';
import { STASH_KEY, sendPrompt, typeComposedLines } from '../src/inject/send.js';
import { Tmux, type Runner } from '../src/exec.js';

const RULE = '─'.repeat(40);
const EMPTY = [RULE, '❯ ', RULE, '  ? for shortcuts'].join('\n') + '\n';
const TYPED = [RULE, '❯ alpha line one', '  beta line two', '  gamma line three', RULE, '  ? for shortcuts'].join('\n') + '\n';

function fake(panes: string[]): { tmux: Tmux; calls: string[][] } {
  const calls: string[][] = [];
  let at = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') { const p = panes[Math.min(at, panes.length - 1)]!; at++; return { ran: true, code: 0, stdout: p, stderr: '' }; }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  return { tmux: new Tmux(run), calls };
}

/** The keys sent up to the first Enter, each as `lit:<text>` or `key:<name>`. */
const typingKeys = (calls: string[][]): string[] => {
  const out: string[] = [];
  for (const c of calls) {
    if (c[1] !== 'send-keys') continue;
    const last = c[c.length - 1]!;
    if (c.includes('-l')) { out.push(`lit:${last}`); continue; }
    if (last === 'Enter') break;
    out.push(`key:${last}`);
  }
  return out;
};

describe('the send\'s line loop (characterization)', () => {
  it('a three-line message is typed as three literals with M-Enter between them, and nothing else before its Enter', async () => {
    const { tmux, calls } = fake([EMPTY, TYPED]);
    await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: async () => {} }, 'cc-x', 'alpha line one\nbeta line two\ngamma line three', { onDraft: 'refuse', attachments: [] });
    expect(typingKeys(calls)).toEqual(['lit:alpha line one', 'key:M-Enter', 'lit:beta line two', 'key:M-Enter', 'lit:gamma line three']);
  });
  it('a one-line message is one literal', async () => {
    const { tmux, calls } = fake([EMPTY, [RULE, '❯ only line', RULE].join('\n') + '\n']);
    await sendPrompt({ tmux, queue: new KeyedQueue(), sleep: async () => {} }, 'cc-x', 'only line', { onDraft: 'refuse', attachments: [] });
    expect(typingKeys(calls)).toEqual(['lit:only line']);
  });
});

describe('typeComposedLines: the loop, exported once (the box frames recipe types its drafts through it)', () => {
  it('types each line, M-Enter between, and presses no Enter', async () => {
    const { tmux, calls } = fake([EMPTY]);
    expect(await typeComposedLines(tmux, 'cc-x', ['a', 'b'])).toBe(true);
    expect(calls.filter((c) => c[1] === 'send-keys').map((c) => c[c.length - 1])).toEqual(['a', 'M-Enter', 'b']);
  });
  it('stops at the first line tmux refused, and answers false', async () => {
    const calls: string[][] = [];
    const run: Runner = async (cmd, args) => { calls.push([cmd, ...args]); return { ran: true, code: args.includes('b') ? 1 : 0, stdout: '', stderr: '' }; };
    expect(await typeComposedLines(new Tmux(run), 'cc-x', ['a', 'b', 'c'])).toBe(false);
    expect(calls.filter((c) => c[1] === 'send-keys').map((c) => c[c.length - 1])).toEqual(['a', 'M-Enter', 'b']);
  });
  it('the stash key is the one spelling', () => {
    expect(STASH_KEY).toBe('C-s');
  });
});
