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

/** cmd -> allowed first-argument subcommands. Anything else is `forbidden`. */
const EXEC_WHITELIST: Record<string, readonly string[]> = {
  tmux: ['has-session', 'list-panes', 'capture-pane', 'send-keys', 'resize-window'],
  // ws-add/ws-rm are the workspace lifecycle (ccd cmd_ws_add / cmd_ws_rm). In
  // remote mode every `ccd` call the server makes crosses this list, so
  // omitting them left both of the PWA's workspace controls answering
  // `forbidden` on the live fleet. Not a widening in kind: `start` already
  // creates a session, a tmux server and a systemd unit and `stop` tears all
  // three down; ws-rm's extra reach is worktree and branch deletion, which ccd
  // itself refuses on a dirty tree, an unmerged branch, or a session carrying
  // no `workspace` field.
  ccd: ['start', 'enable', 'ensure', 'stop', 'swap', 'clip', 'ws-add', 'ws-rm'],
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
 */
export function isExecAllowed(cmd: string, args: string[]): boolean {
  if (typeof cmd !== 'string' || cmd.length === 0 || cmd.includes('/')) return false;
  const allowedSubs = EXEC_WHITELIST[cmd];
  if (!allowedSubs) return false;
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return false;
  const sub = args[0];
  return typeof sub === 'string' && allowedSubs.includes(sub);
}
