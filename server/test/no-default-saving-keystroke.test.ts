// server/test/no-default-saving-keystroke.test.ts
// D-8149 census — nothing in ccd, the server or the PWA types the plain `/effort <level>` or
// `/model <name>` form.
//
// Claude Code 2.1.321 saves the plain form as the ACCOUNT's default for new sessions (the model's
// `effortLevel` / the `model` setting in the config dir's user settings), so a keystroke built that
// way rewrites an account setting. The session-only spellings are the bare `/effort` slider (move to
// a stop, then `s`), the bare `/model` picker, and the `--effort` / `--model` argv flags; only those
// may appear. The one named exception is `/effort ultracode`, which is not a stored level: it was
// measured NOT to persist a per-model pin (D-2810) and its apply path confirms it by ack.
// That exemption rests on D-2810's measurement on an older Claude Code, not on 2.1.321, and is owed a
// re-measure; only the quoted token is exempt, never the rest of its line.
//
// TEXT scan, `no-routing-keystroke-from-server.test.ts`'s admission: it catches the ordinary shape
// (a quoted or backticked slash command followed by an argument), not a string built from parts.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/** A quote or backtick, the slash command, then an ARGUMENT (a space and a word or an expansion). */
export const PLAIN_FORM_RE = /['"`]\/(effort|model)\s+[\w$@{]/;
/** The one measured non-persisting spelling. */
/** Where a keystroke is BUILT: a tmux send-keys, the server's inject/prompt, or a literal `-l` text. Prose that merely quotes the command is not. */
const TYPER_RE = /send-keys|inject|prompt|sendText|\s-l\s/;
const ALLOWED_RE = /['"`]\/effort ultracode['"`]/;
const ALLOWED_G = new RegExp(ALLOWED_RE.source, 'g');
const isCommentLine = (line: string): boolean => /^\s*(#|\/\/|\*|\/\*)/.test(line);

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('__') || e === '.git') continue;
    const p = path.join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, keep, out);
    else if (st.size < 4_000_000 && keep(p)) out.push(p);
  }
  return out;
}

const ccdFiles = walk(path.join(root, 'ccd'), (p) => !/\.(tsv|list|service|md|png|svg|json)$/.test(p) && !/\/(ccd-carry|history-skill)\//.test(p));
const srcFiles = ['pwa/src', 'server/src', 'shared'].flatMap((d) => walk(path.join(root, d), (p) => /\.(tsx?|mjs|js)$/.test(p)));

function scan(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
      if (isCommentLine(text)) return;
      const rest = text.replace(ALLOWED_G, '');
      if (PLAIN_FORM_RE.test(rest) && TYPER_RE.test(rest)) hits.push(`${path.relative(root, file)}:${i + 1}: ${text.trim()}`);
    });
  }
  return hits;
}

describe('no default-saving /effort <level> or /model <name> keystroke anywhere (D-8149)', () => {
  it('the census reads ccd and the sources (anti-vacuity)', () => {
    expect(ccdFiles.map((f) => path.basename(f))).toContain('ccd');
    expect(srcFiles.length).toBeGreaterThan(50);
  });
  it('ccd (the script, its lib and its sibling tools) types only the picker/slider forms', () => {
    expect(scan(ccdFiles)).toEqual([]);
  });
  it('the server, the PWA and shared never type either', () => {
    expect(scan(srcFiles)).toEqual([]);
  });
  it('reds on the shapes this fix removed', () => {
    for (const mutant of [
      'tmux send-keys -t "$t" -l "/effort $level"; sleep 1; tmux send-keys -t "$t" Enter',
      "tmux send-keys -t \"$t\" -l '/model opus'",
      'await inject(id, `/effort ${level}`);',
      "api.prompt(id, '/model sonnet')",
    ]) expect(PLAIN_FORM_RE.test(mutant), mutant).toBe(true);
  });
  it('allows the slider/picker forms and the named ultracode exception', () => {
    for (const ok of [
      'tmux send-keys -t "$t" -l "/effort"; sleep 1',
      'tmux send-keys -t "$t" -l "/model"; sleep 1',
      'tmux send-keys -t "$t" -l "s"',
    ]) expect(PLAIN_FORM_RE.test(ok), ok).toBe(false);
    expect(ALLOWED_RE.test('tmux send-keys -t "$t" -l "/effort ultracode"; sleep 1')).toBe(true);
    // the exemption is the token, not the line: a plain form beside it still reds
    const mixed = 'tmux send-keys -t "$t" -l "/effort ultracode" -l "/effort high"';
    expect(PLAIN_FORM_RE.test(mixed.replace(ALLOWED_G, ''))).toBe(true);
  });
});
