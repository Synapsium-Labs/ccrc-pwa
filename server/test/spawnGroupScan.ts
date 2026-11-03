// The census behind `spawn-group-pin.test.ts` (#896): every TIMED `spawnSync`/`execFileSync` in server/test, and
// what its command is. `spawnSync(…, { timeout })` signals only its direct child, so a timed spawn of a shell, or of
// a script that forks, strands a grandchild when it times out; `spawnSyncGroup` (`spawnGroup.ts`) runs the child in a
// process group of its own and kills the whole group. This module finds the sites that still bypass it.
//
// It reads sources only through the repo's one parser module, `scan/parse.ts` (ARCH-06): a call is a parsed
// `CallSite`, an options object passed by name resolves through the file's parsed `bindings`.
//
// A call is TIMED when an argument after the command is an object literal with a `timeout` property, or a name or
// spread (`opts`, `{ ...opts, stdio }`, `opts as never`) whose innermost binding is one, followed up to three hops.
// Its command is one of:
//   * `shell`   — a shell (`bash`, `sh`, `/bin/sh`, `BASH` bound to one, `real('bash')`, `join(bin, 'bash')`);
//   * `wrapper` — a program that runs another command (`prlimit`, `unshare`, `env`, `timeout`, …);
//   * `script`  — any other expression: a script path, a parameter, a binding the scan cannot resolve to a literal;
//   * `plain`   — a program named by a literal that is none of the above (`'git'`, `'python3'`, `'ps'`),
//                 `process.execPath`, or a python interpreter found by a lookup (`const PY = pythonOrSkip()`).
// `plain` sites are not counted. Every other site is a row of `SPAWN_GROUP_ALLOWLIST` until it moves to
// `spawnSyncGroup`.
// KNOWN WIDTH: an options object built by assignment after its binding (`opts.timeout = ms`), passed through a
// parameter, or a `timeout` read from a spread more than three hops away is not seen as timed; a call through a
// renamed import (`import { spawnSync as run }`) or a destructured `child_process` is not seen; an interpreter given
// inline code or a script that forks (`python3 -c 'subprocess.run(…)'`) is `plain`, because what forks is the
// program's own code, not its command.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseFile, parseSource, type Binding, type CallSite, type ParsedFile } from './scan/parse.js';

export type SpawnCommandKind = 'shell' | 'wrapper' | 'script' | 'plain';

export interface TimedSpawn {
  /** Repository-relative (`server/test/foo.test.ts`). */
  file: string;
  line: number;
  /** `spawnSync` or `execFileSync`. */
  name: string;
  /** The command argument's source text, line breaks removed. */
  command: string;
  kind: SpawnCommandKind;
}

const SPAWNS = new Set(['spawnSync', 'execFileSync']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const WRAPPERS = new Set(['prlimit', 'unshare', 'env', 'nice', 'timeout', 'setsid', 'stdbuf', 'xargs', 'sudo',
  'systemd-run', 'flock', 'script', 'cgexec']);
const SYSTEM_DIRS = ['/bin/', '/usr/bin/', '/usr/local/bin/', '/sbin/', '/usr/sbin/'];
const RANK: Record<SpawnCommandKind, number> = { plain: 0, script: 1, wrapper: 2, shell: 3 };
// A name costs two hops (the name, then its binding's init), so this follows three names.
const MAX_HOPS = 6;

const IDENT = /^[A-Za-z_$][\w$]*$/;
const STRING = /^(['"`])((?:(?!\1)[^\\$]|\\.)*)\1$/;

/** The expression without a trailing `!`, a trailing `as T` and enclosing parentheses. */
const bare = (text: string): string => {
  let t = text.trim();
  for (;;) {
    const next = t.replace(/!$/, '').replace(/\s+as\s+[\w.$<>[\]| ]+$/, '').trim();
    const paren = /^\((.*)\)$/s.exec(next);
    const out = paren ? paren[1]!.trim() : next;
    if (out === t) return t;
    t = out;
  }
};

/** The innermost binding of `name` whose scope holds offset `at`. */
const bindingAt = (p: ParsedFile, name: string, at: number): Binding | undefined => {
  let best: Binding | undefined;
  for (const b of p.bindings) {
    if (b.name !== name || at < b.scopeStart || at > b.scopeEnd) continue;
    if (!best || b.scopeEnd - b.scopeStart < best.scopeEnd - best.scopeStart) best = b;
  }
  return best;
};

/** Does the options expression `text` (at offset `at` of `p`) carry a `timeout`? */
export function timedOptions(p: ParsedFile, text: string, at: number, hops = 0): boolean {
  if (hops > MAX_HOPS) return false;
  const t = bare(text);
  if (IDENT.test(t)) {
    const b = bindingAt(p, t, at);
    return b !== undefined && b.initStart !== at && timedOptions(p, b.init, b.initStart, hops + 1);
  }
  if (!t.startsWith('{')) return false;
  if (/(?:^\{|,)\s*timeout\s*(?::|,|\})/.test(t)) return true;
  for (const m of t.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) {
    if (timedOptions(p, m[1]!, at, hops + 1)) return true;
  }
  return false;
}

const literalKind = (value: string): SpawnCommandKind => {
  const base = path.posix.basename(value);
  if (SHELLS.has(base)) return 'shell';
  if (WRAPPERS.has(base)) return 'wrapper';
  if (!value.includes('/') || SYSTEM_DIRS.some((d) => value === d + base)) return 'plain';
  return 'script';
};

const worst = (a: SpawnCommandKind, b: SpawnCommandKind): SpawnCommandKind => (RANK[a] >= RANK[b] ? a : b);

/** What the command expression `text` (at offset `at` of `p`) runs. */
export function commandKind(p: ParsedFile, text: string, at: number, hops = 0): SpawnCommandKind {
  const t = bare(text);
  const lit = STRING.exec(t);
  if (lit) return literalKind(lit[2]!);
  if (t === 'process.execPath') return 'plain';
  if (IDENT.test(t)) {
    if (hops >= MAX_HOPS) return 'script';
    const b = bindingAt(p, t, at);
    if (b && b.initStart !== at) return commandKind(p, b.init, b.initStart, hops + 1);
    const from = importedBinding(p, t);
    return from ? commandKind(from.p, from.b.init, from.b.initStart, hops + 1) : 'script';
  }
  const alt = /^(.+?)\s*(?:\?\?|\|\|)\s*(.+)$/s.exec(t);
  if (alt) return worst(commandKind(p, alt[1]!, at, hops), commandKind(p, alt[2]!, at, hops));
  // `argv[0]` of an argv bound to an array literal: its first element.
  const head = /^([A-Za-z_$][\w$]*)\[0\]$/.exec(t);
  if (head && hops < MAX_HOPS) {
    const b = bindingAt(p, head[1]!, at);
    const first = b && /^\[\s*([^,\]]+)/.exec(b.init);
    return first ? commandKind(p, first[1]!, b.initStart, hops + 1) : 'script';
  }
  return callKind(t);
}

/** A program found by a call: a python lookup is an interpreter; `command -v X` inside it names X (`spawnSync('sh', ['-c', 'command -v bash'])…`); a
 *  lookup of one literal (`which('bash')`, `realPath('python3')`) names that literal; a path join is a shell when its
 *  last literal names one (`join(bin, 'bash')`) and a script otherwise; anything else is a script. */
const callKind = (t: string): SpawnCommandKind => {
  // A python interpreter found by a lookup (`pythonOrSkip()`, `canonicalPython3()`): an interpreter, like node.
  if (/^[\w$.]*python\w*\(\s*\)$/i.test(t)) return 'plain';
  const lits = [...t.matchAll(/(['"`])((?:(?!\1)[^\\$]|\\.)*)\1/g)].map((m) => m[2]!);
  const lookup = lits.map((l) => /\bcommand -v (\S+)/.exec(l)?.[1]).find((x) => x !== undefined);
  if (lookup !== undefined) return literalKind(lookup);
  const last = lits.at(-1);
  if (/^(?:path\.)?(?:join|resolve)\(/.test(t)) return last !== undefined && SHELLS.has(last) ? 'shell' : 'script';
  const one = /^[\w$.]+\(\s*(['"`])((?:(?!\1)[^\\$]|\\.)*)\1\s*\)$/.exec(t);
  return one ? literalKind(one[2]!) : 'script';
};

/** `name`'s top-level binding in the module a relative import of `p` names it from. */
const importedBinding = (p: ParsedFile, name: string): { p: ParsedFile; b: Binding } | undefined => {
  const edge = p.imports.find((i) => i.kind === 'import' && i.specifier.startsWith('.') && i.names.includes(name));
  if (!edge) return undefined;
  const target = path.resolve(path.dirname(p.path), edge.specifier.replace(/\.js$/, '.ts'));
  let q: ParsedFile;
  try { q = parseFile(target); } catch { return undefined; }
  // The file's own scope ends at its text's end; it starts at its first token, after any leading comment.
  const top = q.bindings.filter((x) => x.name === name && x.scopeEnd === q.text.length)
    .sort((a, b) => a.scopeStart - b.scopeStart)[0];
  return top ? { p: q, b: top } : undefined;
};

const isSpawn = (c: CallSite): boolean => c.name !== null && SPAWNS.has(c.name)
  && (c.callee === c.name || c.callee.endsWith(`.${c.name}`));

/** The timed spawns of one parsed file, `file` its repository-relative name. */
export function timedSpawnsIn(p: ParsedFile, file: string): TimedSpawn[] {
  const out: TimedSpawn[] = [];
  for (const c of p.calls) {
    if (!isSpawn(c) || c.args.length < 2) continue;
    const timed = c.args.slice(1).some((a) => a.kind === 'other' && timedOptions(p, a.text, c.start));
    if (!timed) continue;
    const cmd = c.args[0]!;
    const command = cmd.kind === 'string' ? `'${cmd.text}'` : cmd.text;
    const kind = cmd.kind === 'string' ? literalKind(cmd.text) : commandKind(p, cmd.text, c.start);
    out.push({ file, line: c.line, name: c.name!, command, kind });
  }
  return out;
}

/** The timed spawns of a source text (a fixture). */
export const timedSpawnsInSource = (text: string, file = 'probe.ts'): TimedSpawn[] =>
  timedSpawnsIn(parseSource(text, file), file);

/** The files the census reads: every tracked or new `.ts` under server/test that names a spawn, except
 *  `spawnGroup.ts` (the helper itself) and this scan's own files. */
export const SCAN_EXEMPT = ['server/test/spawnGroup.ts', 'server/test/spawnGroupScan.ts',
  'server/test/spawnGroupAllowlist.ts', 'server/test/spawn-group-pin.test.ts'];

export function censusFiles(repoRoot: string): string[] {
  const r = execFileSync('git', ['grep', '-l', '--untracked', '-E', 'spawnSync|execFileSync', '--',
    'server/test/*.ts', 'server/test/**/*.ts'], { cwd: repoRoot, encoding: 'utf8' });
  return [...new Set(r.split('\n').filter(Boolean))].filter((f) => !SCAN_EXEMPT.includes(f)).sort();
}

/** Every timed spawn under server/test whose command is not `plain`, in file then line order. */
export function timedSpawnCensus(repoRoot: string): TimedSpawn[] {
  return censusFiles(repoRoot).flatMap((f) => timedSpawnsIn(parseFile(path.join(repoRoot, f)), f))
    .filter((s) => s.kind !== 'plain');
}
