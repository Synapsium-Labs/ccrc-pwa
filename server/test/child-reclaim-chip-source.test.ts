// Child-reclamation wave 5: spec §5.9's rule as a red suite. "Refusal sentences
// come from a lookup keyed by the refusal token, never respelled at the surface
// — and the lookup is the server's." The PWA renders the server's word and
// sentence, spells no ws-reclaim token, and imports no server sentence table.
// `RunSummary.childReclaim` has ONE reader in pwa/src.
//
// ONE scan list covers every PWA file that renders a server reclaim sentence:
// the run row's chip (`runWords.ts`, `RunsScreen.tsx`), wave 4's reclaim row and
// banner (`childReclaimWords.ts`, `ChildReclaimBanner.tsx`), and the abandon
// sheet. Each is addressed by path, never by index, so a file added to or
// removed from the list cannot shift another file's assertion.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHILD_RECLAIM_TOKEN_KIND } from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_WORDS } from '../../shared/api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = [
  'pwa/src/fleet/runWords.ts',
  'pwa/src/screens/RunsScreen.tsx',
  'pwa/src/fleet/SessionLine.tsx',
  'pwa/src/fleet/childReclaimWords.ts',
  'pwa/src/fleet/ChildReclaimBanner.tsx',
  'pwa/src/fleet/AbandonSheet.tsx',
] as const;
/** Every scanned file but SessionLine.tsx: it renders no chip and no reclaim
 *  sentence, and it already spells `'held'` as an ASK state, which is not a
 *  ws-reclaim refusal. Its child label is read in runWords.ts, which is
 *  scanned. */
const TOKEN_FILES = FILES.filter((f) => f !== 'pwa/src/fleet/SessionLine.tsx');
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
/** Code only: a sentence ABOUT a field is not a read of it. */
const codeOnly = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Every `.ts`/`.tsx` under pwa/src, recursively. */
const pwaSources = (dir = path.join(root, 'pwa', 'src')): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return pwaSources(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });

describe('the PWA maps no ws-reclaim token — the sentence is the server’s (spec §5.9)', () => {
  // A token that is also a `ChildReclaimWord` (`paused`, today) is excluded: the
  // server hands the PWA WORDS, so the PWA's glyph table and its unsettled set
  // must be allowed to spell them, and a token that coincides with a word is
  // that word.
  const words: readonly string[] = CHILD_RECLAIM_WORDS;
  const tokens = Object.keys(CHILD_RECLAIM_TOKEN_KIND).filter((t) => !words.includes(t));

  it('has a token list to scan — an empty one would pass vacuously', () => {
    expect(tokens.length).toBeGreaterThanOrEqual(10);
  });

  it('reads the files that render the chip, and they do render it', () => {
    expect(read('pwa/src/fleet/runWords.ts')).toContain('export const childReclaimChip');
    expect(read('pwa/src/screens/RunsScreen.tsx')).toContain('run-child-reclaim');
    expect(read('pwa/src/fleet/childReclaimWords.ts')).toContain('export function childReclaimAttentionOf');
    expect(read('pwa/src/fleet/ChildReclaimBanner.tsx')).toContain('export function ChildReclaimBanner');
    expect(read('pwa/src/fleet/AbandonSheet.tsx')).toContain('export function AbandonSheet');
  });

  /** The tokens `src` spells as a quoted string literal. */
  const spelled = (src: string, ts: readonly string[]): string[] =>
    ts.filter((t) => new RegExp(`['"\`]${t.replace(/-/g, '\\-')}['"\`]`).test(src));

  it.each(TOKEN_FILES)('%s spells no ws-reclaim refusal token as a string literal', (f) => {
    expect(spelled(read(f), tokens)).toEqual([]);
  });

  // SessionLine.tsx is out of TOKEN_FILES only for `'held'`, an ASK state it
  // spells; every other token stays barred from it.
  it("pwa/src/fleet/SessionLine.tsx spells no ws-reclaim refusal token but 'held' as a string literal", () => {
    expect(spelled(read('pwa/src/fleet/SessionLine.tsx'), tokens.filter((t) => t !== 'held'))).toEqual([]);
  });

  it.each(FILES)('%s imports no server sentence table', (f) => {
    expect(read(f)).not.toMatch(/wsaudit|refusalSentence|SENTENCES/);
  });

  // Counts code-only reads, not files: a comment naming the field is no read,
  // and a destructured or bracketed read is one.
  it('has ONE reader of RunSummary.childReclaim in pwa/src — runWords.ts', () => {
    const reads = Object.fromEntries(
      pwaSources()
        .map((f) => [path.relative(root, f), (codeOnly(readFileSync(f, 'utf8')).match(/\bchildReclaim\b/g) ?? []).length] as const)
        .filter(([, n]) => n > 0),
    );
    // runWords.ts: childReclaimChip's parameter type and its one read.
    expect(reads).toEqual({ 'pwa/src/fleet/runWords.ts': 2 });
  });
});
