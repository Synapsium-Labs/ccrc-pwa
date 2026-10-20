// D-6118 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0p; ARCH-04 (#545), stage 3).
// RING RULES for the PWA. (1) A `pwa/src` L1 module (a `*Words.ts` file, a policy module, a pure lib module) loads
// no `.tsx` file, no store and not `lib/api.ts` at runtime: an L1 decision that drags in a component, a store or the
// fetch adapter cannot be tested without a DOM, a store or the network, and its words stop being one reader's.
// (2) `ui/src` never imports from `pwa/`, in any form: `@ccrc/ui` is the package the app consumes, and an edge back
// makes the two one package with a cycle in it.
//
// Each file's ring is `ring.ts`'s `pwaRing`, the 08-10 spec's PWA rules (ARCH-02a, D-6000) from the file's own
// facts and header. An edge lands where the PWA's bundler puts it (`resolveVite.ts`). Rule (1) counts runtime edges
// only: a type-only edge is erased and moves nothing (the 08-10 spec, as stage 2 reads it). Rule (2) counts every
// edge, a type one included: `ui/` must compile without `pwa/`. The debt on the tree the day the rules landed is
// `pwa-rings.data.ts`, held exactly; an exemption is a file pair.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseFile, parseSource, type ParsedFile } from '../scan/parse.js';
import { malformedEntries } from './exemptions.js';
import { PWA_L1_EXEMPTIONS, UI_PWA_EXEMPTIONS } from './pwa-rings.data.js';
import { pwaRing, runtimeEdges } from './ring.js';
import { resolveVite } from './resolveVite.js';
import { REPO, rel, walkSrc } from './walkSrc.js';

const pwaFiles = (): string[] => walkSrc({ roots: ['pwa/src'], min: 230 });
const uiFiles = (): string[] => walkSrc({ roots: ['ui/src'], min: 40 });

/** The repo-relative file an edge of `file` lands on, or null for a package or an unresolved specifier. */
const landing = (file: string, spec: string): string | null => {
  const to = resolveVite(path.join(REPO, file), spec);
  return to === null || to === 'external' ? null : rel(to);
};

/** Why an L1 module may not load `to`, or null when it may. */
const forbiddenToL1 = (to: string): string | null => {
  if (to.endsWith('.tsx')) return 'a .tsx file';
  if (to.startsWith('pwa/src/stores/')) return 'a store';
  if (to === 'pwa/src/lib/api.ts') return 'the fetch adapter';
  return null;
};

/** The forbidden runtime edges of one `pwa/src` file, keyed `<from> -> <to>`; none unless the file is L1. */
function l1Violations(file: string, p: ParsedFile): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (pwaRing(file, p).ring !== 'L1') return out;
  for (const e of runtimeEdges(p)) {
    const to = landing(file, e.specifier);
    const what = to === null ? null : forbiddenToL1(to);
    if (what !== null) {
      const key = `${file} -> ${to}`;
      out.set(key, [...(out.get(key) ?? []), `${what} :${e.line} {${e.names.join(', ')}}`]);
    }
  }
  return out;
}

/** The edges, in any form, by which a `ui/src` file names `pwa/`. */
const uiToPwa = (file: string, p: ParsedFile): string[] => p.imports
  .filter((e) => /^ccrc-pwa(?:\/|$)/.test(e.specifier) || (landing(file, e.specifier) ?? '').startsWith('pwa/'))
  .map((e) => `${file}:${e.line} '${e.specifier}'${e.typeOnly ? ' (type)' : ''}`);

const ringOfSource = (file: string, lines: string[]): string => pwaRing(file, parseSource(lines.join('\n'), file)).ring;

describe('a PWA L1 module loads no .tsx, no store and not lib/api.ts (ARCH-04 stage 3, D-6118)', () => {
  it('CONTROL: the PWA ring rules, clause by clause, from a file\'s own facts', () => {
    expect(ringOfSource('pwa/src/main.tsx', ['export const x = 1;'])).toBe('L5');
    expect(ringOfSource('pwa/src/fleet/Card.tsx', ['export const x = 1;'])).toBe('L4');
    expect(ringOfSource('pwa/src/stores/fleet.ts', ['export const x = 1;'])).toBe('L4');
    expect(ringOfSource('pwa/src/lib/a.ts', ['export function useThing() { return 1; }'])).toBe('L4');
    expect(ringOfSource('pwa/src/lib/a.ts', ['export const useThing = () => 1;'])).toBe('L4');
    expect(ringOfSource('pwa/src/lib/a.ts', ['const useThing = () => 1;', 'export { useThing };'])).toBe('L4');
    expect(ringOfSource('pwa/src/lib/a.ts', ['class W { timer: unknown; go() { this.timer = setTimeout(() => 1, 5); } }'])).toBe('L4');
    expect(ringOfSource('pwa/src/lib/api.ts', ['export const x = 1;'])).toBe('L3');
    for (const io of ["fetch('/x')", 'new WebSocket(u)', 'navigator.onLine', "localStorage.getItem('k')",
      "sessionStorage.getItem('k')", "indexedDB.open('d')", 'new Worker(u)', "caches.open('c')", 'document.title',
      'window.innerWidth', 'location.href', 'history.back()']) {
      expect(ringOfSource('pwa/src/lib/a.ts', [`export const f = (u: string) => ${io};`]), io).toBe('L3');
    }
    expect(ringOfSource('pwa/src/lib/a.ts', ['export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));'])).toBe('L3');
    expect(ringOfSource('pwa/src/lib/a.ts', ["import type { A } from './b';", 'export interface P { a: A }'])).toBe('L2');
    expect(ringOfSource('pwa/src/fleet/aWords.ts', ['export const WORD = 1;'])).toBe('L1');
    // A name inside a longer one, a member of another object, or a comment is not the global.
    expect(ringOfSource('pwa/src/lib/a.ts', ['// reads document.title', 'export const f = (s: { location: { x: 1 } }) => s.location.x;',
      'export const myWindow = 1;', 'export const refetch = (g: () => 1) => g();'])).toBe('L1');
    // Prose in a string or a template is not code; an expression inside a template is.
    expect(ringOfSource('pwa/src/session/aWords.ts', ["export const HINT = 'Open it in a new window.';",
      'export const TIP = "Check the browser history.";', 'export const T = (n: number) => `${n} items in this document.`;']))
      .toBe('L1');
    expect(ringOfSource('pwa/src/lib/a.ts', ['export const t = () => `width ${window.innerWidth}px`;'])).toBe('L3');
    // A header declaration moves a file outward only.
    expect(ringOfSource('pwa/src/lib/a.ts', ['// The poller: L4, it schedules.', 'export const f = () => 1;'])).toBe('L4');
    expect(ringOfSource('pwa/src/lib/a.ts', ['// L1 policy.', 'export const f = () => document.title;'])).toBe('L3');
  });

  it('CONTROL: a planted runtime import of a component, a store or the fetch adapter from an L1 module is red', () => {
    const file = 'pwa/src/session/plantedWords.ts';
    const planted = (src: string): string[] => [...l1Violations(file, parseSource(src, file)).keys()];
    expect(planted("import { MessageBubble } from './MessageBubble';\nexport const f = () => MessageBubble;"))
      .toEqual(['pwa/src/session/plantedWords.ts -> pwa/src/session/MessageBubble.tsx']);
    expect(planted("import { useFleet } from '../stores/fleet';\nexport const f = () => useFleet;"))
      .toEqual(['pwa/src/session/plantedWords.ts -> pwa/src/stores/fleet.ts']);
    expect(planted("import { ApiError } from '../lib/api';\nexport const f = (e: unknown) => e instanceof ApiError;"))
      .toEqual(['pwa/src/session/plantedWords.ts -> pwa/src/lib/api.ts']);
    // A Words file whose prose names a browser global is still L1, so its .tsx import is still red.
    expect(planted("import { MessageBubble } from './MessageBubble';\nexport const HINT = 'Open it in a new window.';\nexport const f = () => MessageBubble;"))
      .toEqual(['pwa/src/session/plantedWords.ts -> pwa/src/session/MessageBubble.tsx']);
    // Type-only edges are erased and move nothing; a pure sibling is allowed.
    for (const src of ["import type { ApiError } from '../lib/api';", "import { type ApiError } from '../lib/api';",
      "import { journalWord } from './journalWords';"]) {
      expect(planted(`${src}\nexport const f = (e: unknown) => e;`), src).toEqual([]);
    }
  });

  it('CONTROL: the walks have floors', () => {
    expect(() => walkSrc({ roots: ['pwa/src'], min: 1_000_000 })).toThrow(/below the floor/);
    expect(pwaFiles()).toContain('pwa/src/lib/api.ts');
    expect(uiFiles()).toContain('ui/src/index.ts');
  });

  it('every exemption has a reason and a date', () => {
    expect(malformedEntries(PWA_L1_EXEMPTIONS)).toEqual([]);
    expect(malformedEntries(UI_PWA_EXEMPTIONS)).toEqual([]);
  });

  it('the L1 modules\' forbidden runtime edges are exactly the exemptions', () => {
    const found = new Map<string, string[]>();
    for (const f of pwaFiles()) {
      for (const [k, v] of l1Violations(f, parseFile(path.join(REPO, f)))) found.set(k, v);
    }
    const allowed = new Set(Object.keys(PWA_L1_EXEMPTIONS));
    const fresh = [...found].filter(([k]) => !allowed.has(k)).map(([k, v]) => `${k} ${v.join('; ')}`);
    const stale = [...allowed].filter((k) => !found.has(k));
    expect(fresh, 'an L1 module loads a .tsx file, a store or lib/api.ts: move the value inward (a pure .ts module '
      + 'or shared/), take it as an argument, or make the import type-only').toEqual([]);
    expect(stale, 'an exemption no longer occurs: delete it from pwa-rings.data.ts').toEqual([]);
  });
});

describe('ui/ never imports pwa/ (ARCH-04 stage 3, D-6118)', () => {
  it('CONTROL: a relative path into pwa/ and the app\'s package name are seen, a type import included', () => {
    const file = 'ui/src/components/Planted.tsx';
    expect(uiToPwa(file, parseSource("import type { Session } from '../../../pwa/src/stores/session';", file)))
      .toEqual([`${file}:1 '../../../pwa/src/stores/session' (type)`]);
    expect(uiToPwa(file, parseSource("import { x } from 'ccrc-pwa/src/lib/api';", file)))
      .toEqual([`${file}:1 'ccrc-pwa/src/lib/api'`]);
    expect(uiToPwa(file, parseSource("import { cn } from '@/lib/cn';", file))).toEqual([]);
  });

  it('the ui/src files that name pwa/ are exactly the exemptions', () => {
    const found = new Map<string, string[]>();
    for (const f of uiFiles()) {
      const edges = uiToPwa(f, parseFile(path.join(REPO, f)));
      if (edges.length > 0) found.set(f, edges);
    }
    const allowed = new Set(Object.keys(UI_PWA_EXEMPTIONS));
    expect([...found].filter(([k]) => !allowed.has(k)).flatMap(([, v]) => v), 'ui/ imports pwa/: the package the '
      + 'app consumes cannot depend on the app; move the piece into ui/, or pass it in').toEqual([]);
    expect([...allowed].filter((k) => !found.has(k)), 'an exemption no longer occurs: delete it').toEqual([]);
  });
});
