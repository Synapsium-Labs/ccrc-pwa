// T4a (D-6387): `toolWellPlan` (session/toolWell.ts) decides how a tool call's input or result well is read: as code in
// a grammar, as a diff, as ANSI, or as plain text. It is pure; the grammar predicate is handed in, because an L1 module
// may not load markdown.tsx. The unit cases give it a stub registry; one case gives it the real one.
import { describe, expect, it } from 'vitest';
import { toolWellPlan } from '../src/session/toolWell';
import { isRegisteredGrammar } from '../src/lib/markdown';

const REGISTERED = new Set(['ts', 'py', 'json', 'bash']);
const stub = (lang: string): boolean => REGISTERED.has(lang);
const input = (name: string, obj: unknown): { use: { name: string; input: string }; text: string } => {
  const text = JSON.stringify(obj);
  return { use: { name, input: text }, text };
};
const planOf = (name: string, obj: unknown) => {
  const { use, text } = input(name, obj);
  return toolWellPlan(use, 'input', text, stub);
};

describe('toolWellPlan', () => {
  it('preserves non-string Bash descriptions', () => {
    for (const value of [null, false, 12, { reason: 'inspect' }, ['a', 'b']]) {
      expect(planOf('Bash', { command: 'pwd', description: value })).toEqual({
        kind: 'code', lang: 'bash', text: `# description: ${JSON.stringify(value)}\npwd`,
      });
    }
    expect(planOf('Bash', { command: 'pwd', extra: 'one\ntwo' })).toEqual({ kind: 'code', lang: 'bash', text: '# extra: one\n# two\npwd' });
    const empty = { file_path: 'a', edits: [] };
    expect(planOf('MultiEdit', empty)).toEqual({ kind: 'code', lang: 'json', text: JSON.stringify(empty, null, 2) });
  });

  it('keeps Edit and MultiEdit metadata on the header line', () => {
    for (const name of ['Edit', 'MultiEdit']) {
      const edit = { old_string: 'old\nmore', new_string: 'new\nmore', ['key\n+fake']: 'value\r\n-fake\t\x1b ' };
      const fields = name === 'Edit' ? { file_path: 'a\n+path', ...edit } : { file_path: 'a\n+path', ['top\n+fake']: 'top\n-fake', edits: [edit] };
      const plan = planOf(name, fields);
      expect(plan.kind).toBe('diff');
      if (plan.kind !== 'diff') throw new Error('expected diff');
      const lines = plan.text.split('\n');
      expect(lines.slice(1)).toEqual(['-old', '-more', '+new', '+more']);
      expect(lines[0]).toContain('a\\n+path');
      expect(lines[0]).toContain('key\\n+fake');
      expect(lines[0]).toContain('value\\r\\n-fake\\t\\u001b\\u2028');
      if (name === 'MultiEdit') expect(lines[0]).toContain('top\\n+fake: top\\n-fake');
    }
  });

  it('routes all escape-bearing results to the existing ANSI reader before diff', () => {
    const use = { name: 'Bash', input: '{}' };
    for (const text of ['before\x1b[2Kafter', '\x1b]0;title\x07ok', 'ok\x1b', '@@ -1 +1 @@\n-old\n+new\x1b[2K']) {
      expect(toolWellPlan(use, 'result', text, stub)).toEqual({ kind: 'ansi' });
    }
  });
  it('a Bash input reads as its description as a comment, then its command', () => {
    expect(planOf('Bash', { command: 'ls -la', description: 'List the files' }))
      .toEqual({ kind: 'code', lang: 'bash', text: '# List the files\nls -la' });
    // a multi-line description gets the comment mark on every line
    expect(planOf('Bash', { command: 'make', description: 'one\ntwo' }))
      .toEqual({ kind: 'code', lang: 'bash', text: '# one\n# two\nmake' });
    // no description: the command alone
    expect(planOf('Bash', { command: 'pwd' })).toEqual({ kind: 'code', lang: 'bash', text: 'pwd' });
  });

  it('every field of a parseable input is shown', () => {
    expect(planOf('Bash', { command: 'sleep 1', description: 'Wait', timeout: 5000, run_in_background: true, cwd: '/x' }))
      .toEqual({
        kind: 'code', lang: 'bash',
        text: '# Wait\n# timeout: 5000\n# run_in_background: true\n# cwd: /x\nsleep 1',
      });
    const unknown = planOf('Frobnicate', { alpha: 1, beta: { gamma: 'x' } });
    expect(unknown).toEqual({ kind: 'code', lang: 'json', text: JSON.stringify({ alpha: 1, beta: { gamma: 'x' } }, null, 2) });
    // a known tool of the wrong shape shows every field as JSON too
    expect(planOf('Bash', { cmd: 'ls', extra: 2 }))
      .toEqual({ kind: 'code', lang: 'json', text: JSON.stringify({ cmd: 'ls', extra: 2 }, null, 2) });
    expect(planOf('Edit', { file_path: 'a.ts', old_string: 'x' }))
      .toEqual({ kind: 'code', lang: 'json', text: JSON.stringify({ file_path: 'a.ts', old_string: 'x' }, null, 2) });
  });

  it('an Edit input is one hunk; MultiEdit one per edit', () => {
    expect(planOf('Edit', { file_path: 'src/a.ts', old_string: 'a\nb', new_string: 'c' }))
      .toEqual({ kind: 'diff', text: '@@ src/a.ts @@\n-a\n-b\n+c' });
    expect(planOf('Edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b', replace_all: true }))
      .toEqual({ kind: 'diff', text: '@@ src/a.ts, replace_all: true @@\n-a\n+b' });
    expect(planOf('MultiEdit', {
      file_path: 'f.ts',
      edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c\nd', new_string: 'e', replace_all: true }],
    })).toEqual({
      kind: 'diff',
      text: '@@ f.ts (edit 1/2) @@\n-a\n+b\n@@ f.ts (edit 2/2), replace_all: true @@\n-c\n-d\n+e',
    });
    // another top-level field rides the first hunk's header
    expect(planOf('MultiEdit', { file_path: 'f.ts', note: 'n', edits: [{ old_string: 'a', new_string: 'b' }] }))
      .toEqual({ kind: 'diff', text: '@@ f.ts (edit 1/1), note: n @@\n-a\n+b' });
  });

  it('a Write input is its path comment and content in its grammar; an unregistered extension is plain', () => {
    expect(planOf('Write', { file_path: '/w/src/Mod.TS', content: 'const x = 1;' }))
      .toEqual({ kind: 'code', lang: 'ts', text: 'const x = 1;', head: '/w/src/Mod.TS' });
    expect(planOf('Write', { file_path: 'a.py', content: 'x = 1', mode: '644' }))
      .toEqual({ kind: 'code', lang: 'py', text: 'x = 1', head: 'a.py, mode: 644' });
    expect(planOf('Write', { file_path: 'notes.zzz', content: 'hello' })).toEqual({ kind: 'plain' });
    expect(planOf('Write', { file_path: 'Makefile', content: 'all:' })).toEqual({ kind: 'plain' });
    // the extension is the basename's, not a dotted directory's
    expect(planOf('Write', { file_path: '/a.ts/Makefile', content: 'all:' })).toEqual({ kind: 'plain' });
    // the real registry accepts a real grammar and refuses an unknown one
    expect(isRegisteredGrammar('ts')).toBe(true);
    expect(isRegisteredGrammar('zzz')).toBe(false);
    expect(isRegisteredGrammar('')).toBe(false);
    const w = input('Write', { file_path: 'a.ts', content: 'let y = 2' });
    expect(toolWellPlan(w.use, 'input', w.text, isRegisteredGrammar))
      .toEqual({ kind: 'code', lang: 'ts', text: 'let y = 2', head: 'a.ts' });
  });

  it('an input that does not parse is plain', () => {
    const full = JSON.stringify({ command: 'echo ' + 'x'.repeat(50), description: 'Say something long' });
    const cut = full.slice(0, 40); // the server's cut lands mid-string
    expect(() => JSON.parse(cut)).toThrow();
    expect(toolWellPlan({ name: 'Bash', input: cut }, 'input', cut, stub)).toEqual({ kind: 'plain' });
    expect(toolWellPlan({ name: 'Frobnicate', input: '{"a":' }, 'input', '{"a":', stub)).toEqual({ kind: 'plain' });
    expect(toolWellPlan({ name: 'Bash', input: '' }, 'input', '', stub)).toEqual({ kind: 'plain' });
    // a cut that happens to end where a repair would close it is still not repaired
    const open = '{"command":"ls","description":"abc';
    expect(toolWellPlan({ name: 'Bash', input: open }, 'input', open, stub)).toEqual({ kind: 'plain' });
  });

  it('a result with SGR is ansi; one headed by a unified diff is diff; any other is plain', () => {
    const use = { name: 'Bash', input: '{}' };
    const run = (t: string) => toolWellPlan(use, 'result', t, stub);
    expect(run('\u001b[31mred\u001b[0m')).toEqual({ kind: 'ansi' });
    // SGR wins over a diff head
    expect(run('\u001b[32m+x\u001b[0m\n--- a\n+++ b')).toEqual({ kind: 'ansi' });
    expect(run('diff --git a/x b/x\nindex 1..2\n')).toEqual({ kind: 'diff', text: 'diff --git a/x b/x\nindex 1..2\n' });
    expect(run('\n\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toEqual({ kind: 'diff', text: '\n\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b' });
    expect(run('@@ -1,2 +1,2 @@\n a')).toEqual({ kind: 'diff', text: '@@ -1,2 +1,2 @@\n a' });
    // `---` without a `+++` next line is not a diff head (a markdown rule, a YAML fence)
    expect(run('--- title\nbody')).toEqual({ kind: 'plain' });
    expect(run('hello\ndiff --git later')).toEqual({ kind: 'plain' });
    expect(run('ok')).toEqual({ kind: 'plain' });
    expect(run('')).toEqual({ kind: 'plain' });
  });
});
