/**
 * D-6045, stage 2 (plan docs/superpowers/plans/2026-10-19-consolidation-w0-pins.md, Task C0n; ARCH-04 (#545)). The
 * server ring of a file, decided by the written rules (the 08-10 spec, "Deciding a file's ring and context",
 * ARCH-02a, D-6000) from the file's OWN imports, timers and header, and never from what imports it. The rules that
 * need a ring (`outward-edges`, `host-imports`) read it here, never with a classifier of their own; stage 4 turns
 * the same function into "every file has one ring".
 *
 * In order, each clause applying only to a file no earlier clause matched:
 * - L5: `index.ts`.
 * - L4: imports `fastify` or an `@fastify/*` package in any form, or holds a scheduler or poller (a timer whose
 *   handle is stored on an object field or at module scope).
 * - L3: a runtime import of a `node:*` builtin other than `node:path`, `node:url`, `node:util` and `node:crypto`,
 *   or of a server I/O package, or holds a deadline timer (a handle that is a local of one call, or is not kept).
 * - L2: every top-level statement is a type: no value is declared, called or imported.
 * - L1: every other file.
 * A header declaration, or a ring pin's role table, moves a file outward of its facts, never inward.
 *
 * D-6118 (Task C0p; ARCH-04 stage 3) adds `pwaRing`, the spec's PWA rules over the same facts and header grammar,
 * here beside `serverRing` so the two packages' rings have one owner.
 */
import { builtinModules } from 'node:module';
import path from 'node:path';
import { parseFile, type ImportEdge, type ParsedFile } from '../scan/parse.js';
import { REPO, rel } from './walkSrc.js';

export type Ring = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export interface RingVerdict {
  ring: Ring;
  /** The fact that decided it, in words, for a red message. */
  why: string;
}

const RANK: Record<Ring, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };
export const outward = (from: Ring, to: Ring): boolean => RANK[to] > RANK[from];

/** `node:*` modules that do no I/O, allowed in L1 (D-6000). */
const PURE_BUILTINS: ReadonlySet<string> = new Set(['path', 'url', 'util', 'crypto']);
/** The server I/O packages the spec names; a new I/O package joins this list (and the spec's). */
export const IO_PACKAGES: ReadonlySet<string> = new Set(['ws', 'web-push', 'node-pty']);
const BUILTINS: ReadonlySet<string> = new Set(builtinModules.filter((m) => !m.startsWith('_')));

/** A ring pin's role table counts as a declaration (the spec): single-definition's `DOCS_RING_ROLES`, copied here
 *  and held equal to it by `host-imports.test.ts`'s CONTROL. Keys are `server/src/docs/<file>`. */
export const DOCS_RING_ROLES: Readonly<Record<string, Ring>> = {
  'policy.ts': 'L1', 'ports.ts': 'L2', 'ccdsource.ts': 'L3',
  'routes.ts': 'L4', 'hooks.ts': 'L4', 'lane.ts': 'L4', 'cache.ts': 'L4',
};

/** True when an edge binds no value: `import type`, `export type … from`, a type query, or an `import`/`export …
 *  from` whose every bound name carries a per-name `type`. A bare `import './x'` and `export *` bind a value. */
export const typeOnlyEdge = (e: ImportEdge): boolean =>
  e.typeOnly || (e.names.length > 0 && e.typeNames !== undefined && e.names.every((n) => e.typeNames!.includes(n)));

/** The edges that load a module at runtime. */
export const runtimeEdges = (p: ParsedFile): ImportEdge[] => p.imports.filter((e) => !typeOnlyEdge(e));

/** The builtin a specifier names (`fs` for `node:fs`, `fs/promises` and `fs`), or null. */
const builtinOf = (spec: string): string | null => {
  const s = spec.replace(/^node:/, '');
  if (!spec.startsWith('node:') && !BUILTINS.has(s) && !BUILTINS.has(s.split('/')[0]!)) return null;
  return s.split('/')[0]!;
};

/** Comments blanked to spaces, so offsets and lines stay where they were. */
export const codeOnly = (s: string): string => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p: string) => p + ' '.repeat(m.length - p.length));

export type TimerKind = 'scheduler' | 'deadline';
export interface Timer { line: number; kind: TimerKind; held: string }

/** Every `setTimeout`/`setInterval` call (never `setImmediate`, a yield) with where its handle lives: an object field
 *  (`this.t = …`, `w.timer = …`) or a module-scope name is a scheduler or poller; a local of one call, or a handle
 *  that is not kept (`setTimeout(r, ms)`, `….unref()`), is a deadline. */
export function timersOf(p: ParsedFile): Timer[] {
  const code = codeOnly(p.text);
  const moduleNames = new Set<string>();
  for (const m of code.matchAll(/^(?:export\s+)?(?:let|var|const)\s+([\w$]+)/gm)) moduleNames.add(m[1]!);
  const out: Timer[] = [];
  for (const c of p.calls) {
    if (c.callee !== 'setTimeout' && c.callee !== 'setInterval') continue;
    const before = code.slice(Math.max(0, c.start - 200), c.start);
    const assigned = /([\w$.[\]'"]+)\s*(?<![=!<>])=\s*$/.exec(before);
    const target = c.boundTo ?? assigned?.[1] ?? null;
    let kind: TimerKind = 'deadline';
    let held = 'not kept';
    if (target !== null && /[.[]/.test(target)) { kind = 'scheduler'; held = `field ${target}`; }
    else if (target !== null) {
      // Module scope: the name is declared at column 0 and no local of the same name holds this call.
      const local = p.bindings.some((b) => b.name === target && b.scopeStart > 0 && b.scopeStart <= c.start
        && c.start <= b.scopeEnd) || new RegExp(`^[ \\t]+(?:let|var|const)\\s+${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'm')
        .test(code.slice(0, c.start).split('\n').slice(-80).join('\n'));
      if (moduleNames.has(target) && !local) { kind = 'scheduler'; held = `module-scope ${target}`; }
      else held = `local ${target}`;
    }
    out.push({ line: c.line, kind, held });
  }
  return out;
}

const DECLARED = /(?:^\s*(?:\/\/|\/\*\*?|\*)\s*|: |\. |— |ring |is )(L[0-5])(?::|,|\.| —| \(| (?:policy|port|ports|adapter|adapters|delivery|composition|decision)\b)/i;

/** The first ring a file's header declares, or null. The header is the lines before the first top-level statement
 *  that is not an import (the spec's grammar; the same reading `host-imports.test.ts` used under ARCH-03). */
export function headerDeclaration(text: string): Ring | null {
  for (const line of text.split('\n')) {
    const comment = /^\s*(\/\/|\/\*|\*)/.test(line);
    const header = comment || /^\s*$/.test(line) || /^\s*import\b/.test(line)
      || /^\s+[\w{},\s]*(from\s.*)?;?\s*$/.test(line) || /^\s*\}\s*from\s/.test(line);
    if (!header) return null;
    if (comment) {
      const m = DECLARED.exec(line);
      if (m) return m[1]!.toUpperCase() as Ring;
    }
  }
  return null;
}

/** True when no top-level statement declares, calls or loads a value. */
function typesOnly(p: ParsedFile): boolean {
  if (p.symbols.length > 0 || p.bindings.length > 0 || p.calls.length > 0 || runtimeEdges(p).length > 0) return false;
  const code = codeOnly(p.text);
  return !/(^|[;}])\s*(?:export\s+)?(?:(?:const|let|var)\s|function\b|class\b|enum\b|default\b|declare\b)|\bexport\s*\{(?!\s*type\b)|^\s*export\s*=/m
    .test(code);
}

/** The ring a `server/src` file's facts give, before any declaration. */
function factRing(file: string, p: ParsedFile): RingVerdict {
  if (file === 'server/src/index.ts') return { ring: 'L5', why: 'index.ts' };
  const fastify = p.imports.find((e) => /^(?:fastify|@fastify\/.+)$/.test(e.specifier));
  if (fastify) return { ring: 'L4', why: `imports ${fastify.specifier} (:${fastify.line})` };
  const timers = timersOf(p);
  const sched = timers.find((t) => t.kind === 'scheduler');
  if (sched) return { ring: 'L4', why: `holds a scheduler or poller, its handle on a ${sched.held} (:${sched.line})` };
  for (const e of runtimeEdges(p)) {
    const b = builtinOf(e.specifier);
    if (b !== null && !PURE_BUILTINS.has(b)) return { ring: 'L3', why: `imports ${e.specifier} at runtime (:${e.line})` };
    if (IO_PACKAGES.has(e.specifier)) return { ring: 'L3', why: `imports ${e.specifier} at runtime (:${e.line})` };
  }
  const deadline = timers.find((t) => t.kind === 'deadline');
  if (deadline) return { ring: 'L3', why: `holds a deadline timer, ${deadline.held} (:${deadline.line})` };
  if (typesOnly(p)) return { ring: 'L2', why: 'every top-level statement is a type' };
  return { ring: 'L1', why: 'no outer-ring fact' };
}

/** The ring of a repo-relative `server/src` file (or `shared/`, which is L0), parsed from disk unless given. */
export function serverRing(file: string, parsed?: ParsedFile): RingVerdict {
  if (file.startsWith('shared/')) return { ring: 'L0', why: 'shared/' };
  const p = parsed ?? parseFile(path.join(REPO, file));
  const fact = factRing(file, p);
  const docs = /^server\/src\/docs\/([^/]+)$/.exec(file)?.[1];
  const pinned = docs !== undefined ? DOCS_RING_ROLES[docs] : undefined;
  const declared = pinned ?? headerDeclaration(p.text);
  if (declared !== null && outward(fact.ring, declared)) {
    return { ring: declared, why: pinned ? `the docs ring pin puts it in ${declared}` : `declares ${declared} in its header` };
  }
  return fact;
}

/** The browser I/O globals the 08-10 spec names for the PWA's L3 (D-6000), each as it is written in code. */
export const BROWSER_IO = ['fetch(', 'WebSocket', 'navigator.', 'localStorage', 'sessionStorage', 'indexedDB',
  'new Worker', 'caches.', 'document.', 'window.', 'location.', 'history.'] as const;

/** The first browser I/O global a file's code (comments blanked) names, or null. A name is a word of its own: a
 *  member access or a longer identifier that contains it (`fleet.location.`, `myWindow.`) is not the global. */
export function browserIoOf(text: string): string | null {
  const code = codeOnly(text);
  for (const g of BROWSER_IO) {
    const word = g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\w$.])${word}${/\w$/.test(g) ? '(?![\\w$])' : ''}`).test(code)) return g;
  }
  return null;
}

/** True when the file exports a hook: an exported function or const named `use` plus a capital letter, or one
 *  re-exported by name from an export list. */
const exportsHook = (text: string): boolean => {
  const code = codeOnly(text);
  return /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+)use[A-Z]/m.test(code)
    || /\bexport\s*\{[^}]*\buse[A-Z]\w*\s*(?:[,}]|\bas\b)/.test(code);
};

/** The ring of a repo-relative `pwa/src` file, by the 08-10 spec's PWA rules (D-6000), from the file's own facts and
 *  header, parsed from disk unless given. In order, each clause applying only to a file no earlier one matched:
 *  L5 `main.tsx`; L4 any other `.tsx` or `.css` file, a file under `stores/`, a file that exports a hook, or one that
 *  holds a scheduler or poller; L3 `lib/api.ts`, a file that names a browser I/O global, or one that holds a
 *  deadline timer; L2 types only; L1 the `*Words.ts` files, the policy modules and the pure lib modules. A header
 *  declaration moves a file outward of its facts, never inward (the spec: "in either package"). */
export function pwaRing(file: string, parsed?: ParsedFile): RingVerdict {
  const sub = file.replace(/^pwa\/src\//, '');
  if (sub === 'main.tsx') return { ring: 'L5', why: 'main.tsx' };
  if (/\.(?:tsx|css)$/.test(sub)) return { ring: 'L4', why: `a ${path.extname(sub)} file` };
  if (sub.startsWith('stores/')) return { ring: 'L4', why: 'a store' };
  const p = parsed ?? parseFile(path.join(REPO, file));
  const fact = ((): RingVerdict => {
    if (exportsHook(p.text)) return { ring: 'L4', why: 'exports a hook' };
    const timers = timersOf(p);
    const sched = timers.find((t) => t.kind === 'scheduler');
    if (sched) return { ring: 'L4', why: `holds a scheduler or poller, its handle on a ${sched.held} (:${sched.line})` };
    if (sub === 'lib/api.ts') return { ring: 'L3', why: 'lib/api.ts, the fetch adapter' };
    const io = browserIoOf(p.text);
    if (io !== null) return { ring: 'L3', why: `names the browser I/O global ${io}` };
    const deadline = timers.find((t) => t.kind === 'deadline');
    if (deadline) return { ring: 'L3', why: `holds a deadline timer, ${deadline.held} (:${deadline.line})` };
    if (typesOnly(p)) return { ring: 'L2', why: 'every top-level statement is a type' };
    return { ring: 'L1', why: 'no outer-ring fact' };
  })();
  const declared = headerDeclaration(p.text);
  if (declared !== null && outward(fact.ring, declared)) return { ring: declared, why: `declares ${declared} in its header` };
  return fact;
}

/** The repo-relative file a relative specifier names from `file`, or null for a package or builtin. A `.js` suffix
 *  names its `.ts` source; an extension-less one tries `.ts`, `.mjs` and `/index.ts`. */
export function resolveLocal(file: string, spec: string, exists: (repoRel: string) => boolean): string | null {
  if (!spec.startsWith('.')) return null;
  const base = rel(path.resolve(REPO, path.dirname(file), spec));
  const tries = /\.js$/.test(base) ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.mjs'), base]
    : /\.(?:ts|mjs)$/.test(base) ? [base] : [`${base}.ts`, `${base}.mjs`, `${base}/index.ts`];
  return tries.find(exists) ?? null;
}

export interface OutwardEdge { from: string; to: string; fromRing: Ring; toRing: Ring; line: number; names: string[] }

/** The runtime edges of one parsed file that point outward, to a local file whose ring `ringOf` gives. */
export function outwardRuntimeEdges(file: string, p: ParsedFile, ringOf: (repoRel: string) => Ring | null,
  exists: (repoRel: string) => boolean): OutwardEdge[] {
  const fromRing = serverRing(file, p).ring;
  const out: OutwardEdge[] = [];
  for (const e of runtimeEdges(p)) {
    const to = resolveLocal(file, e.specifier, exists);
    const toRing = to === null ? null : ringOf(to);
    if (to !== null && toRing !== null && outward(fromRing, toRing)) {
      out.push({ from: file, to, fromRing, toRing, line: e.line, names: e.names });
    }
  }
  return out;
}
