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

/** A name that reads as a wire deadline or bound: `DRAIN` or `TIMEOUT`, upper case (so `drainTimer` is not one). */
const WIRE_NAME = /DRAIN|TIMEOUT/;
/** A plain numeric literal (`2000`, `2_000`, `0.5`). */
const NUMERIC = /^\d[\d_]*(?:\.\d+)?$/;

/** Every wire-constant copy in the kernel: each definition in `shared/spawn.mjs` of a name containing `DRAIN` or
 *  `TIMEOUT` (a binding or a named symbol), and each numeric literal passed as `setTimeout`'s delay there. A drain or
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
