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
  ccd: ['start', 'enable', 'ensure', 'stop', 'swap', 'clip'],
};

/** Matches by basename so an absolute binary path (e.g. `~/.local/bin/ccd`)
 *  whitelists the same as the bare command name. */
export function isExecAllowed(cmd: string, args: string[]): boolean {
  const allowedSubs = EXEC_WHITELIST[path.basename(cmd)];
  if (!allowedSubs) return false;
  const sub = args[0];
  return typeof sub === 'string' && allowedSubs.includes(sub);
}
