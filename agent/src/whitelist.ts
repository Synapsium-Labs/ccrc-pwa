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

/**
 * The CLOSED set of command names `EXEC_WHITELIST` may key on. `ExecWhitelist`
 * below is `Record<ExecCommand, …>`, so writing `gh: [['pr','view']]` into that
 * object literal is a COMPILE ERROR (TS2353 excess property / TS2561) — at any
 * position in the literal, because a type has no notion of "above `ccd:`".
 *
 * WHY THIS SHAPE (final review, gates finding 4). The no-`gh` invariant — the
 * branch's own stated most dangerous change — used to be pinned by exactly one
 * test in one file: deleting `test/whitelist-noghosts.test.ts` and adding a
 * `gh` key left the agent suite at 99/99 PASS and the server's cross-check at
 * 35/35 PASS (both measured on `4e8b689`). A safety invariant a single `rm`
 * silently removes is not enforced. The human partner's standing ruling on this
 * class is STRUCTURAL OVER TEXTUAL — the same ruling that replaced layer 2b's
 * source-text scan with the `CcdArgv` brand (`server/src/ccdargv.ts`) after
 * four different ways of naming a value defeated four regexes in a row.
 *
 * So the pin is now four independent mechanisms in three different classes,
 * only one of which is a test file:
 *
 *   1. TYPE (this union + `ExecWhitelist`) — the key fails to compile.
 *   2. TYPE (`GRANTABLE_COMMANDS` below) — widening THIS union to make (1)
 *      compile is itself a compile error, on a different line.
 *   3. RUNTIME (`auditExecWhitelist`, called at module load) — a forbidden key
 *      makes the agent process THROW ON IMPORT, i.e. refuse to boot. This one
 *      is not a test and not a type: it survives a cast, an `as any`, a
 *      `JSON.parse`, and a hand-edit of the compiled `dist/` JS — the exact
 *      residual class `ccdargv.ts` documents that a brand CANNOT close.
 *   4. TESTS — `test/whitelist-noghosts.test.ts` (agent, runtime),
 *      `test/types/bypasses/*` + `whitelist-structural.test.ts` (agent, asserts
 *      the compile errors of 1 and 2 actually occur), and layer 3 of
 *      `server/test/whitelist-subset.test.ts` (a DIFFERENT PACKAGE, asserting
 *      `Object.keys(EXEC_WHITELIST)` exactly — position-independent, unlike the
 *      old source-text slice, which only saw keys written below the `ccd` one).
 *
 * Honest limit, stated rather than implied: nothing in a repository the editor
 * fully controls can be un-removable. What changed is the cost and the
 * visibility — granting `gh` now takes edits to three separately named
 * constants in this file plus deletions in two packages, and every one of them
 * says in its own name what it is for. It can no longer happen by `rm`, by
 * accident, or by a diff that reads as ordinary.
 */
export const EXEC_COMMANDS = ['tmux', 'ccd'] as const;
export type ExecCommand = (typeof EXEC_COMMANDS)[number];

/**
 * Names that must NEVER become grantable, whatever a future route claims to
 * need. `gh` is the one that matters and the reason this list exists: the host
 * token carries the `repo` WRITE scope and there is no second credential, so a
 * single `gh` grant makes `EXEC_WHITELIST` the sole control between the PWA and
 * `gh pr merge`. The rest are the obvious shell-equivalent escapes — anything
 * here can spawn arbitrary commands, exfiltrate the token, or reach the network
 * directly, which would make every other control in this file decorative.
 */
export const FORBIDDEN_COMMANDS = [
  'gh', 'hub', 'git', 'glab',
  'sh', 'bash', 'zsh', 'dash', 'env', 'xargs', 'eval', 'exec',
  'node', 'npm', 'npx', 'tsx', 'python', 'python3', 'perl', 'ruby',
  'ssh', 'scp', 'sftp', 'rsync', 'curl', 'wget', 'nc',
  'sudo', 'doas', 'su', 'rm', 'dd', 'mkfs', 'chmod', 'chown',
  'systemctl', 'journalctl', 'docker', 'podman', 'kubectl', 'crontab',
] as const;
export type ForbiddenCommand = (typeof FORBIDDEN_COMMANDS)[number];

/**
 * Mechanism 2. Evaluates to `ExecCommand` while the grantable and forbidden
 * sets are disjoint, and to `never` the instant they overlap — so adding `'gh'`
 * to `EXEC_COMMANDS` (the only way to make a `gh` key compile) turns the
 * annotation below into `readonly never[]` and the initializer stops
 * typechecking, TS2322. `[…] extends […]` rather than a bare conditional so the
 * `Extract` result is checked as a whole and not distributed member-by-member.
 */
type ProvenGrantable = [Extract<ExecCommand, ForbiddenCommand>] extends [never] ? ExecCommand : never;

/** The value of `EXEC_COMMANDS`, but only assignable while the proof holds.
 *  Consumed by `auditExecWhitelist`, so this is a live constant and not an
 *  unused type-test that a tidy-up could delete without noticing. */
export const GRANTABLE_COMMANDS: readonly ProvenGrantable[] = EXEC_COMMANDS;

/** The annotation on the real object literal below — exported so the negative
 *  type fixtures in `test/types/bypasses/` can replay the exact mutation the
 *  final review performed (`gh: [['pr','view']]`, above AND below `ccd:`)
 *  against the same type the real site is checked against. */
export type ExecWhitelist = Record<ExecCommand, readonly (readonly string[])[]>;

/** cmd -> allowed argv PREFIXES. `args` must begin with one of them; tokens
 *  after the prefix are unconstrained. One-token prefixes are exactly the old
 *  behaviour, so every pre-existing entry is bit-identical. */
export const EXEC_WHITELIST: ExecWhitelist = {
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

// The list is exported so a different package can assert its keys; freezing it
// (outer object, each prefix list, each prefix) means "exported for reading"
// stays true at RUNTIME too. Same reasoning as the mint-site freeze in
// `server/src/ccdargv.ts`: the type already forbids `EXEC_WHITELIST.ccd.push`,
// and the freeze is what stops the untyped shapes — `as any`, a `JSON.parse`
// result, array covariance — from reaching in and widening the list in place.
for (const prefixes of Object.values(EXEC_WHITELIST)) {
  for (const prefix of prefixes) Object.freeze(prefix);
  Object.freeze(prefixes);
}
Object.freeze(EXEC_WHITELIST);

/**
 * Mechanism 3 of the no-`gh` pin: a RUNTIME self-audit, run once at module
 * load (see the call directly below), which throws — so the agent refuses to
 * boot rather than serving a widened list.
 *
 * This is deliberately not a test and deliberately not a type. `ccdargv.ts`
 * discloses that a nominal brand cannot stop a deliberate cast, array
 * covariance, or an `any`-typed value; none of those help here, because this
 * reads the ACTUAL object's own keys at runtime, after every cast has already
 * happened. It also survives the case no type can reach at all: someone editing
 * the compiled `dist/whitelist.js` on the fleet host.
 *
 * Two separate refusals, because "not forbidden" and "declared" are different
 * questions: a `gh` key is a security failure, and a key that is merely absent
 * from `GRANTABLE_COMMANDS` (or a declared command with no entry) is a drift
 * failure that would otherwise ship as a silent 502 on the live fleet.
 *
 * Takes the object as a parameter, defaulted, so the pinning test can hand it a
 * real widened whitelist and observe the real throw — rather than asserting
 * only that today's list is fine, which would be a pin that cannot fail.
 */
export function auditExecWhitelist(
  whitelist: Readonly<Record<string, unknown>> = EXEC_WHITELIST,
): void {
  const keys = Object.keys(whitelist);

  const forbidden = keys.filter((k) => (FORBIDDEN_COMMANDS as readonly string[]).includes(k));
  if (forbidden.length > 0) {
    throw new Error(
      `EXEC_WHITELIST grants a forbidden command: ${forbidden.join(', ')}. ` +
      'Refusing to start. The host gh token carries the repo WRITE scope and ' +
      'there is no second credential; a gh grant makes this list the sole ' +
      'control between the PWA and `gh pr merge`. See whitelist.ts.',
    );
  }

  const declared = [...GRANTABLE_COMMANDS].sort();
  const actual = [...keys].sort();
  if (actual.length !== declared.length || actual.some((k, i) => k !== declared[i])) {
    throw new Error(
      `EXEC_WHITELIST keys drifted from EXEC_COMMANDS: have [${actual.join(', ')}], ` +
      `declared [${declared.join(', ')}]. Refusing to start.`,
    );
  }
}

auditExecWhitelist();

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
  const entry = (EXEC_WHITELIST as Readonly<Record<string, readonly (readonly string[])[] | undefined>>)[cmd];
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
