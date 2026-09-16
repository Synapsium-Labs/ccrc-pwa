// Routing spec 2026-09-14 §5.3, slice 4 — global constraint: "the record is
// the arbiter; ccd is the ONE typer. No server or PWA code types `/effort` or
// `/model` after this slice." Task 5 is the last caller that ever typed one
// of those two commands directly (`SessionScreen.tsx`'s old `pick(command)`),
// so this is the census that keeps it from creeping back in ANYWHERE under
// `pwa/src` or `server/src` — not a pin on one file, a scan of every file.
//
// TEXT scan, deliberately, `single-definition.test.ts`'s own admission: it
// catches the copy that looks like the original — a string or template
// literal beginning `/effort` or `/model`, a quote or backtick immediately
// before the slash — which is exactly the shape `api.prompt(id, '/effort
// high')` or a template `` `/model ${alias}` `` takes. It does not parse the
// language, so a sufficiently determined author could still evade it (build
// the string from concatenated parts); the bar is "a reasonable person typing
// the command back in the ordinary way is stopped before review".
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ccrcRoot = path.resolve(here, '..', '..');

const ROOTS = [
  path.join(ccrcRoot, 'pwa', 'src'),
  path.join(ccrcRoot, 'server', 'src'),
];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    // Transient mutant files a parallel suite writes (`boot.test.ts`'s
    // `__boot_control_mutant__.ts`) — the same exclusion
    // `single-definition.test.ts`'s own `sources()` uses, for the same reason:
    // a file that can vanish mid-walk must not be read.
    if (e.startsWith('__')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
    if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** A quote or backtick immediately before `/effort` or `/model` — the shape a
 *  string or template literal opening with the slash command takes, whether
 *  the rest of the literal is a plain suffix (`'/effort high'`) or a
 *  template's own interpolation (`` `/model ${alias}` ``). */
const KEYSTROKE_RE = /['"`]\/(effort|model)\b/;

/** A comment line — the only exempt survivor. Matches this file's own header
 *  above and any `//`/`*`/`/*` line elsewhere (a docstring quoting the old
 *  command for history, as this file's own header just did). */
const isCommentLine = (line: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(line);

interface Hit { file: string; line: number; text: string }

function scan(files: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (isCommentLine(text)) return;
      if (KEYSTROKE_RE.test(text)) {
        hits.push({ file: path.relative(ccrcRoot, file), line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

describe('no /effort or /model keystroke literal under pwa/src or server/src', () => {
  it('finds nothing — the record is the arbiter, ccd is the one typer', () => {
    const hits = scan(ROOTS.flatMap(sources));
    expect(hits, JSON.stringify(hits, null, 2)).toEqual([]);
  });

  // The mutation this guard exists for, measured rather than merely claimed:
  // a `pick` that fell back to typing the command directly is exactly what
  // this scan is built to catch, and it must red on the shape, not just on
  // knowing where to look.
  it('reds on the mutant shape this task removed', () => {
    const mutant = "await api.prompt(id, '/effort high');";
    expect(KEYSTROKE_RE.test(mutant)).toBe(true);
    expect(isCommentLine(mutant)).toBe(false);
  });

  it('does not red on a comment that mentions the old command for history', () => {
    const comment = "  // used to send '/effort high' directly";
    expect(isCommentLine(comment)).toBe(true);
  });
});
