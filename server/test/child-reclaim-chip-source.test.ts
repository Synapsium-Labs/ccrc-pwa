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
//
// THE TOKENS are every refusal and skip token the server keeps a sentence for:
// the ws-reclaim refusals (`CHILD_RECLAIM_TOKEN_KIND`), the sweep's skip words
// (`CHILD_RECLAIM_SKIP`) and the lifecycle journal's refusals
// (`LC_REFUSAL_WORD`). NOT SCANNED: pwa/src/session/HistoryTab.tsx, the
// session History tab (Build 9 spec §2), which renders a journal refusal
// through `lcRefusalWord` by design — it renders no reclaim sentence and is not
// a reclaim surface, so its lookup is not this rule's to forbid.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHILD_RECLAIM_TOKEN_KIND } from '../src/coord/childReclaim.js';
import { CHILD_RECLAIM_SKIP } from '../src/childReclaimSweep.js';
import { CHILD_RECLAIM_WORDS, LC_REFUSAL_WORD } from '../../shared/api.js';
import { codeOnly } from './sourceScan.js';

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
  const tokens = [...new Set([
    ...Object.keys(CHILD_RECLAIM_TOKEN_KIND), ...Object.keys(CHILD_RECLAIM_SKIP), ...Object.keys(LC_REFUSAL_WORD),
  ])].filter((t) => !words.includes(t));

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

  /** The tokens `src` spells: as a quoted string literal (read off the raw
   *  text), or, for a token that is a valid identifier, as a BARE object key —
   *  `{ held: … }` — read off `codeOnly` text so a comment naming it is no
   *  spelling. A key position is `{` or `,` (or a line start) before the
   *  token and `:` after it on the same line (`[ \t]*`; `\??` takes an
   *  optional member `held?:`). A hyphenated token cannot be a bare key, so the
   *  quoted arm already sees every spelling it has. A property ACCESS (`x.held`),
   *  a `case held:` and a ternary's `? held` followed by `: x` on the next line
   *  are not keys and do not match. A TS type member or a typed parameter named
   *  like a token IS a hit — it names the token as a field, which is what this
   *  rule bars — and so is prose such as `, held: x` inside a quoted string,
   *  since `codeOnly` keeps string literals, and a ternary whose `held` opens
   *  its own line (`c ?\n  held : other`): false reds. Known misses: a
   *  shorthand property (`{ held, attached }`), an enum member
   *  (`enum E { held = 1 }`) and a class field (`held = 1;`) carry no `:` and
   *  are not seen. None of the scanned files holds any of these today. */
  const spelled = (src: string, ts: readonly string[]): string[] => {
    const code = codeOnly(src);
    return ts.filter((t) => new RegExp(`['"\`]${t.replace(/-/g, '\\-')}['"\`]`).test(src)
      || (/^[A-Za-z_]\w*$/.test(t) && new RegExp(`(?:^|[{,])\\s*${t}[ \\t]*\\??:`, 'm').test(code)));
  };

  it.each(TOKEN_FILES)('%s spells no ws-reclaim refusal token as a string literal or a bare key', (f) => {
    expect(spelled(read(f), tokens)).toEqual([]);
  });

  // `spelled` itself, on the shapes it must and must not see: a bare key is one
  // spelling, and every look-alike that is not a key is not.
  it('spelled: sees a quoted token and a bare object key, each in its own right', () => {
    expect(spelled("const a = 'tree-busy';", ['tree-busy', 'held'])).toEqual(['tree-busy']);
    expect(spelled("const a = { coordinating: 'x', held: 'y' };", ['coordinating', 'held', 'attached'])).toEqual(['coordinating', 'held']);
    expect(spelled('const a = {\n  attached: 1,\n  held?: 2,\n};', ['attached', 'held'])).toEqual(['attached', 'held']);
    expect(spelled('const a = { x: 1 , held : 2 };', ['held'])).toEqual(['held']);
  });

  it('spelled: a property access, a ternary, a case label and a comment are no spelling', () => {
    const src = [
      'const a = x.held ? y.attached : z;',
      'const b = c ? held : attached;',
      'const d = c\n  ? held\n  : attached;',
      // A comma before the token, but its `:` is on the NEXT line: the ternary's own.
      'const e = c ? (a, held\n  : b);',
      'switch (k) { case held: break; }',
      '// { held: 1 }',
      '/* , attached: 2 */',
    ].join('\n');
    expect(spelled(src, ['held', 'attached'])).toEqual([]);
  });

  // SessionLine.tsx is out of TOKEN_FILES only for `'held'`, an ASK state it
  // spells; every other token stays barred from it.
  it("pwa/src/fleet/SessionLine.tsx spells no ws-reclaim refusal token but 'held' as a string literal", () => {
    expect(spelled(read('pwa/src/fleet/SessionLine.tsx'), tokens.filter((t) => t !== 'held'))).toEqual([]);
  });

  it.each(FILES)('%s imports no server sentence table', (f) => {
    expect(read(f)).not.toMatch(/wsaudit|refusalSentence|SENTENCES|lcRefusalWord|LC_REFUSAL_WORD/);
  });

  // Counts code-only reads, not files: a comment naming the field is no read,
  // and a destructured or bracketed read is one. `childReclaim` is distinctive
  // enough to count bare, so `const { childReclaim } = run` and `run['childReclaim']`
  // (a string literal, which `codeOnly` keeps) each add one.
  const childReclaimReads = (src: string): number => (codeOnly(src).match(/\bchildReclaim\b/g) ?? []).length;

  it('counts a destructured and a bracketed read of childReclaim, and not a comment', () => {
    expect(childReclaimReads('const { childReclaim } = run;')).toBe(1);
    expect(childReclaimReads("const c = run['childReclaim'];")).toBe(1);
    expect(childReclaimReads('const c = run.childReclaim;')).toBe(1);
    expect(childReclaimReads("// run['childReclaim'] and run.childReclaim\nconst c = 1;")).toBe(0);
  });

  it('has ONE reader of RunSummary.childReclaim in pwa/src — runWords.ts', () => {
    const reads = Object.fromEntries(
      pwaSources()
        .map((f) => [path.relative(root, f), childReclaimReads(readFileSync(f, 'utf8'))] as const)
        .filter(([, n]) => n > 0),
    );
    // runWords.ts: childReclaimChip's parameter type and its one read.
    expect(reads).toEqual({ 'pwa/src/fleet/runWords.ts': 2 });
  });
});

// The abandon confirmation's pins: `FleetSession.child` has ONE reader, and the PWA
// renders no close word. Counts are code-only (`codeOnly`): a sentence ABOUT a
// field is not a read of it. A read is a property access (`session.child`) or a
// bracketed one with a literal key (`session['child']`, `session?.["child"]`,
// ``session[`child`]``). The bracket must follow an identifier character, `)` or
// `]` with nothing between, so an array literal (`['child']`, `return ['child']`)
// is not a read. Known limits, misses: a destructured read (`const { child } =
// session`), because `child` is too common a word to scan for bare; a computed
// key (`session[k]`); a spaced bracket (`session ['child']`), which cannot be told
// from `return ['child']` without parsing; and a TS non-null bracket read
// (`session!['child']`, counted 0). Known limit, a false red: an indexed-access
// type (`FleetSession['child']`) is counted as a read.
const FLEET_CHILD_READ = /\.child\b|[\w$)\]](?:\?\.)?\[\s*(['"`])child\1\s*\]/g;
const fleetChildReads = (src: string): number => (codeOnly(src).match(FLEET_CHILD_READ) ?? []).length;

it('counts a property and a bracketed read of FleetSession.child, and no look-alike', () => {
  expect(fleetChildReads('const c = session.child;')).toBe(1);
  expect(fleetChildReads("const c = session['child'];")).toBe(1);
  expect(fleetChildReads('const c = session["child"];')).toBe(1);
  expect(fleetChildReads('const c = session[`child`];')).toBe(1);
  expect(fleetChildReads("const c = session?.['child'];")).toBe(1);
  expect(fleetChildReads("const c = rows[0]['child'] ?? f()['child'];")).toBe(2);
  expect(fleetChildReads("const k = ['child'];\nconst m = ['child', 'x'];\nreturn ['child'];\nf(['child']);")).toBe(0);
  expect(fleetChildReads("const c = session['childReclaim'] ?? session['kid'];")).toBe(0);
  expect(fleetChildReads("// session['child'] and session.child\nconst c = 1;")).toBe(0);
});

it('has ONE reader of FleetSession.child in pwa/src — childMarkOf, in runWords.ts', () => {
  const reads = Object.fromEntries(pwaSources()
    .map((f) => [path.relative(root, f), fleetChildReads(readFileSync(f, 'utf8'))] as const)
    .filter(([, n]) => n > 0));
  // archiveReleased.ts reads `releasedFrom.child`, a DIFFERENT field; its own
  // docstring: "never `FleetSession.child`: one decision, one field".
  expect(reads).toEqual({ 'pwa/src/fleet/archiveReleased.ts': 1, 'pwa/src/fleet/runWords.ts': 1 });
});

it('no pwa/src file reads the close response’s why-word — the PWA renders no close word', () => {
  const readers = pwaSources()
    .filter((f) => /\bchildReclaimWhy\b/.test(codeOnly(readFileSync(f, 'utf8'))))
    .map((f) => path.relative(root, f));
  expect(readers).toEqual([]);
});

// `codeOnly` itself (`sourceScan.ts`), on the shapes a two-pass strip got wrong:
// a `/*` inside a `//` comment opened a block that blanked real code up to the
// next `*/`, and a `//` inside a string truncated its line.
describe('codeOnly — one string-aware pass', () => {
  it('a `/*` inside a `//` comment blanks no code', () => {
    const src = '// accept="image/*" multiple\nconst a = childReclaim;\n/** a later docstring */\nconst b = 1;\n';
    const out = codeOnly(src);
    expect(out).toContain('const a = childReclaim;');
    expect(out).toContain('const b = 1;');
    expect(out).not.toMatch(/image|docstring/);
  });

  it('a `//` inside a string truncates nothing, and the string is kept', () => {
    const out = codeOnly("const u = 'https://x'; const y = childReclaim; // a note\n");
    expect(out).toContain("const u = 'https://x'; const y = childReclaim;");
    expect(out).not.toContain('a note');
  });

  it('drops every comment, and keeps each line where it was', () => {
    const src = '/* childReclaim\n spans */ a;\n`tpl // kept\nstill kept` // childReclaim\nb; // childReclaim\n';
    const out = codeOnly(src);
    expect(out).not.toMatch(/childReclaim/);
    expect(out).toContain('`tpl // kept\nstill kept`');
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out.split('\n')[1]).toBe(' a;');
  });

  // The measured victims: each file's code line the two-pass strip lost.
  it.each([
    // Moved to @ccrc/ui with the component (`pwa/src/session/AttachButton.tsx`
    // no longer exists). The fixture's POINT survives the move intact: line 2
    // is still `// hidden <input type="file" accept="image/*" multiple>`, a
    // `/*` opened inside a `//` comment, which is precisely what a naive
    // two-pass strip swallows the rest of the file on.
    ['ui/src/components/attach-button.tsx', "import { useRef } from 'react';"],
    ['pwa/src/lib/push.ts', 'function urlBase64ToUint8Array(base64: string): Uint8Array {'],
    ['pwa/src/fleet/AccountsStrip.tsx', 'let placeholder: string | null = null;'],
  ])('%s keeps its code past a `/*` in a `//` comment', (f, line) => {
    expect(read(f)).toContain(line);
    expect(codeOnly(read(f))).toContain(line);
  });
});
