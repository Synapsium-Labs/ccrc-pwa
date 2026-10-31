// W8's spawn-chain census module (the 2026-10-26 consolidation W8 plan, Task C8-0's census split).
// The spawn chain (the update spawn kernel and the spawner audits, ARCH-73)
// fills it with its census queries, in C8c, then C8d, then C8e.
// Each query returns `CensusSite` rows the way `consolidationCensus.ts`'s own do, and it imports what it needs from
// `consolidationCensus.ts`; it never re-exports this module, so no import cycle forms, and every count a W8 PR body
// quotes comes from a named query of this module. It reads no imported value at top level (only types, and functions
// called inside a query). Its fixture and real-tree rows live in the sibling `spawn.test.ts`, which the chain's
// first task creates. No other chain edits this file; a chain's first task that finds it non-empty stops and
// reports.
//
// C8c (D-7055; ARCH-73 (#808), its spawn half): the bounded update spawner's census. It imports `REPO`,
// `sourceFiles` and the `CensusSite` type from `consolidationCensus.ts`, and reads code through the scan parser
// (`scan/parse.ts#parseSource`), never by a line regex. KNOWN WIDTH: a `spawn` reached through an alias, a computed
// member or a spread options object is not seen; a kill is the literal call `process.kill(-child.pid, 'SIGKILL')`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseSource, type CallSite, type ParsedFile } from '../scan/parse.js';
import { REPO, sourceFiles, type CensusSite } from '../consolidationCensus.js';

/** The one file the bounded update spawner's body may live in (D-7055). */
export const SPAWN_KERNEL_FILE = 'shared/spawn.mjs';

/** The source trees an update-spawn body could be written in: both packages, the shared layer and the deploy tooling. */
export const SPAWN_CENSUS_DIRS: readonly string[] = ['agent/src', 'server/src', 'shared', 'deploy'];

const rel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/');
const siteOf = (p: ParsedFile, file: string, line: number): CensusSite => ({ file, line, text: p.text.split('\n')[line - 1] ?? '' });

/** The options text of a `spawn(…)` call carries the update spawner's shape: its own process group, no stdin. */
const UPDATE_SPAWN_OPTIONS = (text: string): boolean =>
  /\bdetached:\s*true\b/.test(text) && /\bstdio:\s*\[\s*'ignore',\s*'pipe',\s*'pipe'\s*\]/.test(text);

/** `process.kill(-child.pid, 'SIGKILL')`: the whole group killed at the bound. */
const isGroupKill = (c: CallSite): boolean =>
  c.callee === 'process.kill' && c.args[0]?.text === '-child.pid' && c.args[1]?.kind === 'string' && c.args[1].text === 'SIGKILL';

/** The innermost named symbol of `p` that holds offset `at`, or `null` (a call at module scope). */
function enclosing(p: ParsedFile, at: number): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const s of p.symbols) {
    if (s.start <= at && at < s.end && (best === null || s.end - s.start < best.end - best.start)) best = s;
  }
  return best;
}

/** Every `spawn(` call outside `shared/spawn.mjs` with the update spawner's options (`detached: true` and
 *  `stdio: ['ignore', 'pipe', 'pipe']`), with or without a group kill beside it: the wider net under
 *  `updateSpawnBodies`, so a second update spawner that kills differently is still seen. `agent/src/tokensync.ts` and
 *  the account-op spawners pipe stdin (D-4390), so they are not update spawners. 2 at the base, 0 at C8c's tip. */
export function updateSpawnCalls(root: string = REPO, dirs: readonly string[] = SPAWN_CENSUS_DIRS): CensusSite[] {
  const out: CensusSite[] = [];
  for (const dir of dirs) {
    for (const abs of sourceFiles(root, dir)) {
      const file = rel(root, abs);
      if (file === SPAWN_KERNEL_FILE) continue;
      const text = readFileSync(abs, 'utf8');
      if (!text.includes('spawn(')) continue;
      const p = parseSource(text, abs);
      for (const c of p.calls) if (c.name === 'spawn' && UPDATE_SPAWN_OPTIONS(c.args[2]?.text ?? '')) out.push(siteOf(p, file, c.line));
    }
  }
  return out;
}

/** Every update-spawn BODY outside `shared/spawn.mjs`: a `spawn(` call whose options carry `detached: true` and
 *  `stdio: ['ignore', 'pipe', 'pipe']`, inside a symbol whose body also sends `process.kill(-child.pid, 'SIGKILL')`.
 *  One site per such `spawn(` call. 2 at the base (`agent/src/server.ts#makeUpdateSpawn`,
 *  `server/src/update/spawn.ts#boundedUpdateSpawn`); 0 once both wrappers call `boundedSpawn` (C8c). */
export function updateSpawnBodies(root: string = REPO, dirs: readonly string[] = SPAWN_CENSUS_DIRS): CensusSite[] {
  const out: CensusSite[] = [];
  for (const dir of dirs) {
    for (const abs of sourceFiles(root, dir)) {
      const file = rel(root, abs);
      if (file === SPAWN_KERNEL_FILE) continue;
      const text = readFileSync(abs, 'utf8');
      if (!text.includes('spawn(')) continue;
      const p = parseSource(text, abs);
      for (const c of p.calls) {
        if (c.name !== 'spawn' || !UPDATE_SPAWN_OPTIONS(c.args[2]?.text ?? '')) continue;
        const owner = enclosing(p, c.start);
        const span = owner ?? { start: 0, end: text.length };
        if (!p.calls.some((k) => k.start >= span.start && k.end <= span.end && isGroupKill(k))) continue;
        out.push(siteOf(p, file, c.line));
      }
    }
  }
  return out;
}

/** The options text of a `spawn(…)` call carries the account-op spawner's shape: its own group, stdin piped. */
const ACCOUNT_SPAWN_OPTIONS = (text: string): boolean =>
  /\bdetached:\s*true\b/.test(text) && /\bstdio:\s*\[\s*'pipe'\s*,/.test(text);

/** `process.kill(-child.pid, …)`: a signal to the whole group, any signal. */
const isGroupSignal = (c: CallSite): boolean => c.callee === 'process.kill' && c.args[0]?.text === '-child.pid';

/** The stdin-piped group spawners that are their OWN body by a ruling, never an account-op body:
 *  `agent/src/tokensync.ts` by D-4390 (`spawn-kernel.test.ts`'s "the token-sync spawn is not a third twin" holds it). */
export const ACCOUNT_SPAWN_OWN_BODIES: ReadonlyMap<string, string> = new Map([
  ['agent/src/tokensync.ts', 'D-4390: the token-sync port keeps its own bounded body'],
]);

/** Every account-op spawn BODY outside `shared/spawn.mjs` (D-7057, OA-C8a (a)): a `spawn(` call whose options carry
 *  `detached: true` and a piped stdin, inside a symbol whose body also sends `process.kill(-child.pid, …)`, in a file
 *  not in `ACCOUNT_SPAWN_OWN_BODIES`. One site per such `spawn(` call. 2 at the base
 *  (`server/src/accounts/ops.ts#localAccountOps`, `agent/src/accountop.ts#makeAccountOpSpawn`); 0 once both call
 *  `boundedStdinSpawn`, whose body in the kernel is the 1 (C8e). */
export function accountSpawnBodies(root: string = REPO, dirs: readonly string[] = SPAWN_CENSUS_DIRS): CensusSite[] {
  const out: CensusSite[] = [];
  for (const dir of dirs) {
    for (const abs of sourceFiles(root, dir)) {
      const file = rel(root, abs);
      if (file === SPAWN_KERNEL_FILE || ACCOUNT_SPAWN_OWN_BODIES.has(file)) continue;
      const text = readFileSync(abs, 'utf8');
      if (!text.includes('spawn(')) continue;
      const p = parseSource(text, abs);
      for (const c of p.calls) {
        if (c.name !== 'spawn' || !ACCOUNT_SPAWN_OPTIONS(c.args[2]?.text ?? '')) continue;
        const owner = enclosing(p, c.start);
        const span = owner ?? { start: 0, end: text.length };
        if (!p.calls.some((k) => k.start >= span.start && k.end <= span.end && isGroupSignal(k))) continue;
        out.push(siteOf(p, file, c.line));
      }
    }
  }
  return out;
}

/** A name that reads as a wire deadline or bound: `DRAIN`, `TIMEOUT`, `GRACE` or `MAX_BYTES`, upper case (so
 *  `drainTimer`, `killGraceMs` and `maxOutputBytes` are not one). `GRACE` and `MAX_BYTES` joined with C8e's
 *  `boundedStdinSpawn` (D-7057): `ACCOUNT_OP_KILL_GRACE_MS` and `ACCOUNT_OP_OUTPUT_MAX_BYTES` are defined once, in
 *  `shared/api.ts`. */
const WIRE_NAME = /DRAIN|TIMEOUT|GRACE|MAX_BYTES/;
/** A plain numeric literal (`2000`, `2_000`, `0.5`). */
const NUMERIC = /^\d[\d_]*(?:\.\d+)?$/;

/** Every wire-constant copy in the kernel: each definition in `shared/spawn.mjs` of a name containing `DRAIN`,
 *  `TIMEOUT`, `GRACE` or `MAX_BYTES` (a binding or a named symbol), and each numeric literal passed as `setTimeout`'s delay there. A drain or
 *  a bound written into the `.mjs` is a second definition of `UPDATE_SPAWN_DRAIN_MS` or `UPDATE_SPAWN_TIMEOUT_MS`,
 *  whose one home is `shared/agent-protocol.ts`. 0 at C8c's tip (an absent kernel answers none). */
export function spawnKernelWireLiterals(root: string = REPO): CensusSite[] {
  const abs = path.join(root, SPAWN_KERNEL_FILE);
  if (!existsSync(abs)) return [];
  const p = parseSource(readFileSync(abs, 'utf8'), abs);
  const lines = new Set<number>();
  for (const b of p.bindings) if (WIRE_NAME.test(b.name)) lines.add(b.line);
  for (const s of p.symbols) if (WIRE_NAME.test(s.name.split('.').pop() ?? '')) lines.add(s.line);
  for (const c of p.calls) if (c.name === 'setTimeout' && c.callee === 'setTimeout' && NUMERIC.test(c.args[1]?.text ?? '')) lines.add(c.line);
  return [...lines].sort((a, b) => a - b).map((line) => siteOf(p, SPAWN_KERNEL_FILE, line));
}

// C8d (D-7056; ARCH-73 (#808); spec K17 "Audited one at a time"): every process spawner in the source trees, so each
// one carries a row and a reason in `single-definition/spawners.data.ts#PROCESS_SPAWNERS`. KNOWN WIDTH: a call counts
// when its callee is a `node:child_process` process starter the file imports (by name, an alias, or `ns.<name>` over a
// namespace or default import), or, in the spawn kernel alone, the `spawn` its host injects (the `.mjs` carve-out lets
// it import no `node:child_process`, D-7055). A local binding that merely shares the name (`update/converge.ts`'s
// `const spawn = deps.runLocal`, the injected update spawner) is not a process start and is not counted; neither is a
// `require(…)`, which no source file uses.

/** The `node:child_process` functions that start a process. */
export const PROCESS_STARTERS: readonly string[] = ['spawn', 'execFile', 'spawnSync', 'execFileSync', 'execSync', 'fork', 'exec'];

/** The source trees a process spawner could be written in: both packages and the shared layer. */
export const PROCESS_SPAWN_DIRS: readonly string[] = ['server/src', 'agent/src', 'shared'];

/** One process-starting call: its census site and the `file#symbol` key its `PROCESS_SPAWNERS` row carries (the
 *  innermost named symbol holding the call, or `file#<module>` at module scope). */
export interface ProcessSpawnSite extends CensusSite {
  key: string;
  callee: string;
}

/** The modules whose functions start a process, and those functions: `node:child_process`'s starters, and
 *  `node-pty`'s `spawn` (the terminal drawer's `tmux attach`). */
const STARTER_MODULES: ReadonlyMap<string, readonly string[]> = new Map([
  ['node:child_process', PROCESS_STARTERS],
  ['child_process', PROCESS_STARTERS],
  ['node-pty', ['spawn']],
]);

/** The local callee texts that reach a process starter in `p`: `spawn`, an alias `sp` of it, or `cp.spawn`. */
function starterCallees(p: ParsedFile, file: string): Set<string> {
  const out = new Set<string>();
  for (const imp of p.imports) {
    const starters = STARTER_MODULES.get(imp.specifier);
    if (starters === undefined || imp.typeOnly || imp.kind !== 'import') continue;
    for (const n of imp.names) {
      if (imp.typeNames?.includes(n)) continue;
      if (n.startsWith('* as ')) { for (const s of starters) out.add(`${n.slice(5)}.${s}`); continue; }
      if (starters.includes(n)) {
        out.add(n);
        // `import { spawn as sp }`: the parser records the imported name; the alias is read from the text.
        const alias = new RegExp(`\\b${n}\\s+as\\s+([A-Za-z_$][\\w$]*)`).exec(p.text);
        if (alias !== null) out.add(alias[1]!);
        continue;
      }
      // Any other value name of a starter module's import is a default import: the module object.
      for (const s of starters) out.add(`${n}.${s}`);
    }
  }
  if (file === SPAWN_KERNEL_FILE) out.add('spawn');
  return out;
}

/** Every process-starting call in `server/src`, `agent/src` and `shared/`, in file then source order. A comment, a
 *  string and an import name no call; a call through a same-named local binding is not one (KNOWN WIDTH above). */
export function processSpawnSites(root: string = REPO, dirs: readonly string[] = PROCESS_SPAWN_DIRS): ProcessSpawnSite[] {
  const out: ProcessSpawnSite[] = [];
  for (const dir of dirs) {
    for (const abs of sourceFiles(root, dir)) {
      const file = rel(root, abs);
      const text = readFileSync(abs, 'utf8');
      if (file !== SPAWN_KERNEL_FILE && ![...STARTER_MODULES.keys()].some((m) => text.includes(m))) continue;
      const p = parseSource(text, abs);
      const callees = starterCallees(p, file);
      if (callees.size === 0) continue;
      for (const c of p.calls) {
        if (!callees.has(c.callee)) continue;
        // A `const|let|var` of the same name in scope is a local binding, not the import (KNOWN WIDTH above).
        if (p.bindings.some((b) => b.name === c.callee && b.scopeStart <= c.start && c.start < b.scopeEnd)) continue;
        const owner = innermostSymbol(p, c.start);
        out.push({ ...siteOf(p, file, c.line), key: `${file}#${owner ?? '<module>'}`, callee: c.callee });
      }
    }
  }
  return out;
}

/** The name of the innermost named symbol of `p` holding offset `at`, or `null`. */
function innermostSymbol(p: ParsedFile, at: number): string | null {
  let best: { name: string; start: number; end: number } | null = null;
  for (const s of p.symbols) {
    if (s.start <= at && at < s.end && (best === null || s.end - s.start < best.end - best.start)) best = s;
  }
  return best?.name ?? null;
}
