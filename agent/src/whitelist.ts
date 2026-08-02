import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * Everything a connection needs to evaluate the path/exec whitelists — the
 * agent's own $HOME (session/limits/clips/claude-config roots live under it)
 * and the fleet's projects root (a separate mount, not under $HOME).
 */
export interface WhitelistConfig { home: string; projectsRoot: string }

/**
 * Canonical-prefix check per the plan: resolve symlinks in whatever prefix of
 * `p` actually exists on disk (walking upward), then re-append any
 * not-yet-existing tail components literally — those can't be symlinks to
 * somewhere else because nothing is there yet. Always resolves to *something*
 * (worst case the filesystem root), so callers never need to handle failure.
 */
export async function canonicalize(p: string): Promise<string> {
  // Defense in depth: `p` is typed `string`, but the real caller chain
  // starts at an untrusted, JSON-parsed WS frame (`msg as AgentReq`, a
  // compile-time-only assertion) — a missing/wrong-typed field can hand a
  // `string`-typed parameter an actual `undefined`/number/etc at runtime.
  // node:path APIs throw synchronously on that, which — one layer up, in an
  // async fire-and-forget dispatch with no `.catch` — becomes an unhandled
  // promise rejection that crashes the whole process. Fail closed instead:
  // resolve to a sentinel no whitelist prefix will ever match.
  if (typeof p !== 'string' || p.length === 0) return path.sep;
  const abs = path.resolve(p);
  const parts = abs.split(path.sep);
  for (let i = parts.length; i >= 0; i--) {
    const prefix = parts.slice(0, i).join(path.sep) || path.sep;
    try {
      const real = await realpath(prefix);
      const rest = parts.slice(i);
      return rest.length ? path.join(real, ...rest) : real;
    } catch {
      continue;
    }
  }
  return abs;
}

const isUnder = (target: string, base: string): boolean =>
  target === base || target.startsWith(base + path.sep);

/** `$HOME/.claude*` is a glob in the spec — match any first path segment
 *  under home that literally starts with ".claude" (`.claude`, `.claude-gpt`, …). */
function underClaudeGlob(canonicalHome: string, canonicalTarget: string): boolean {
  if (!isUnder(canonicalTarget, canonicalHome)) return false;
  const rel = canonicalTarget.slice(canonicalHome.length + 1);
  const first = rel.split(path.sep)[0] ?? '';
  return first.startsWith('.claude');
}

export type PathMode = 'read' | 'write';

/**
 * Whitelist check for ALL file ops. Reads: `.cc-sessions/`, `.cc-limits/`,
 * `.cc-clips/`, `.claude*` (glob) under $HOME, plus the fleet projects root.
 * Writes: `.cc-clips/` under $HOME only. Returns the canonical path to operate on when
 * allowed, `null` otherwise — canonicalizing here means every downstream fs
 * call in fileops.ts/tail.ts already has symlink-escapes resolved.
 */
export async function checkPath(
  targetPath: string,
  cfg: WhitelistConfig,
  mode: PathMode,
): Promise<string | null> {
  // Same defense-in-depth guard as `canonicalize`: never let a
  // missing/wrong-typed `path` field reach a node:path call unchecked.
  if (typeof targetPath !== 'string' || targetPath.length === 0) return null;

  const [canonicalHome, canonicalRoot, canonicalTarget] = await Promise.all([
    canonicalize(cfg.home),
    canonicalize(cfg.projectsRoot),
    canonicalize(targetPath),
  ]);

  if (mode === 'write') {
    return isUnder(canonicalTarget, path.join(canonicalHome, '.cc-clips')) ? canonicalTarget : null;
  }

  const readAllowed =
    isUnder(canonicalTarget, path.join(canonicalHome, '.cc-sessions')) ||
    isUnder(canonicalTarget, path.join(canonicalHome, '.cc-limits')) ||
    isUnder(canonicalTarget, path.join(canonicalHome, '.cc-clips')) ||
    isUnder(canonicalTarget, canonicalRoot) ||
    underClaudeGlob(canonicalHome, canonicalTarget);

  return readAllowed ? canonicalTarget : null;
}

/** cmd -> allowed argv PREFIXES. `args` must begin with one of them; tokens
 *  after the prefix are unconstrained. One-token prefixes are exactly the old
 *  behaviour, so every pre-existing entry is bit-identical. */
const EXEC_WHITELIST: Record<string, readonly (readonly string[])[]> = {
  tmux: [['has-session'], ['list-panes'], ['capture-pane'], ['send-keys'], ['resize-window']],

  // NO `gh` KEY, DELIBERATELY. The host token carries the `repo` WRITE scope
  // (gh auth status: gist, read:org, repo, workflow) and there is no second
  // layer — no read-only credential, no cwd sandbox. Any `gh` entry makes this
  // list the sole control between the PWA and `gh pr merge`. `gh: [['api']]` is
  // strictly worse still: -X POST|PATCH|PUT creates, closes and merges PRs.
  // PR reads and the one PR write go through `ccd` verbs, whose args[0] has no
  // write sibling reachable by changing args[1]. See whitelist-noghosts.test.ts.
  //
  // `ws-rm` is GONE from this list: it is the unguarded legacy verb and the PWA
  // must not be able to emit it. `ws-reap` replaces it and is pinned to carry
  // `--expect`, so an UNCONFIRMED reap cannot cross the wire at all.
  // `clip` is GONE: dead grant, no server call site emits it.
  // `ws-gc` is absent and must stay absent: ['ws-gc'] would permit `--prune`.
  ccd: [
    ['start'], ['enable'], ['ensure'], ['stop'], ['swap'], ['ws-add'],
    ['pr-state', '--session'],
    ['pr-state', '--project'],
    ['pr-open',  '--session'],
    ['ws-archive', '--session'],
    ['ws-restore', '--session'],
    ['ws-audit', '--session'],
    ['ws-reap',  '--expect'],   // load-bearing: no reap without a confirmation token
    ['ws-attic', '--session'],
  ],
};

/**
 * Requires an EXACT match against the bare command name (`tmux`/`ccd`) —
 * NOT a basename match. Basename matching would let an absolute path like
 * `/tmp/x/tmux` or a fleet checkout's own `.../some-repo/ccd` whitelist the
 * same as the real binary, as long as the last path segment happened to
 * match and the subcommand was whitelisted — weaker than "whitelist"
 * implies. Any `cmd` containing `/` is rejected outright. Also guards
 * against non-string/non-array wire values (see `canonicalize`'s comment
 * for why: an untyped WS frame reaching a node:path call unchecked is a
 * process-crashing bug class, and `path.basename`/`args[0]` on the wrong
 * type throws synchronously).
 *
 * PROTOTYPE-NAMED COMMANDS (final review, gates finding 6 / destructive F7).
 * `EXEC_WHITELIST` is an object literal, so the old `EXEC_WHITELIST[cmd]`
 * returned an INHERITED value for `constructor`, `__proto__`, `toString`,
 * `valueOf`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable` and
 * `toLocaleString` — truthy, so `if (!prefixes) return false` did not fire, and
 * `prefixes.some(...)` threw `TypeError: prefixes.some is not a function`
 * (measured on all eight). It failed CLOSED — the throw is a rejection that
 * `server.ts`'s `handleReq(...).catch(...)` turns into a `fail` frame — so this
 * was never an escalation, and it is pre-existing: the pre-branch
 * `allowedSubs.includes(sub)` had the identical hazard. But a throw is the
 * wrong answer to "is this allowed?", and it is one tidy-up `try { … } catch`
 * away from becoming a real hole, in a function whose own siblings
 * (`canonicalize`, `checkPath`) were already hardened against exactly this
 * class. Two independent guards now answer it: `Object.hasOwn` (the
 * semantically correct question — is this a key we DECLARED?) and
 * `Array.isArray` (the structural one — an inherited function or prototype
 * object is not a prefix list). Either alone suffices; both are cheap.
 */
export function isExecAllowed(cmd: string, args: string[]): boolean {
  if (typeof cmd !== 'string' || cmd.length === 0 || cmd.includes('/')) return false;
  if (!Object.hasOwn(EXEC_WHITELIST, cmd)) return false;
  const entry = EXEC_WHITELIST[cmd];
  if (!Array.isArray(entry)) return false;
  // Re-annotated rather than cast: `Array.isArray` narrows a `readonly T[]` to
  // `any[]`, and letting that `any` flow into the callbacks below would silently
  // un-typecheck the prefix comparison itself (measured: TS7006 on `tok`/`i`).
  const prefixes: readonly (readonly string[])[] = entry;
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return false;
  // MUTATION SURVIVOR, disclosed: `p.length <= args.length &&` is removable
  // with the suite green, and provably always will be. It is a fast path, not a
  // guard — when `args` is shorter than `p`, `args[i]` reads `undefined` for the
  // overhanging indices, every `tok` is a string literal from EXEC_WHITELIST, and
  // `undefined === tok` is false, so `every` already answers false. The two
  // clauses cannot disagree: the line above rejects any `args` element that is
  // not a string, so no `undefined` can arrive as a VALUE and make the short
  // read compare equal. Kept because it states the prefix rule in the same
  // breath as it checks it, and because dropping it would make the widening
  // mutants (M13/M14, empty prefix) read as ordinary rather than as the
  // fleet-killing change they are.
  return prefixes.some((p) => p.length <= args.length && p.every((tok, i) => args[i] === tok));
}
