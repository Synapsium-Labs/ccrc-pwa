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

/* ---------------------------------------------------------------------------
 * PREFIX VALUES, not just the key set (verify round 2, P1).
 *
 * The gh-key pin above closed the reported instance and left the CLASS open:
 * every mechanism it added looks at `Object.keys(EXEC_WHITELIST)` and none of
 * them looks at what the prefix lists actually CONTAIN. Measured by the
 * verifier: changing `['ws-reap', '--expect']` to `['ws-reap']` — deleting the
 * confirmation token from the one verb whose own source comment says "no reap
 * without a confirmation token" — left `tsc -p agent` clean, left
 * `auditExecWhitelist()` silent, and left `server/test/whitelist-subset.test.ts`
 * at 37/37 (layer 3's reachability check passes, because `['ws-reap']` IS a
 * prefix of the legitimate argv the server builds). Exactly two agent test
 * files failed. `rm` them and a token-free reap crosses the wire with a green
 * suite — one file more than the original gh finding, in the same object the
 * gh fix had just restructured.
 *
 * So the same three-class treatment is applied one level down, to values:
 *   1. TYPE — `LawfulGrants` below turns an unlawful prefix into `never`, so
 *      the assignment on the proof line stops compiling (TS2322). Replayed by
 *      `test/types/bypasses/g5..g8` for all four unlawful shapes.
 *   2. RUNTIME — `auditExecWhitelist` walks the prefix lists at module load and
 *      refuses to boot, which survives a cast, an `any`, and a hand-edit of the
 *      compiled `dist/whitelist.js` that no type can see.
 *   3. TESTS — the behavioural pins in `test/exec.test.ts` /
 *      `test/whitelist-noghosts.test.ts` that the verifier could delete, plus a
 *      new cross-PACKAGE assertion in `server/test/whitelist-subset.test.ts`
 *      that reads this object (not its source text) and demands the flag.
 * ------------------------------------------------------------------------- */

/**
 * Verbs that are only ever grantable WITH a mandatory flag immediately after
 * them. One entry, and it is the destructive one: `ccd ws-reap` deletes a
 * workspace, its branch and its clips, and `--expect <fingerprint>` is the
 * token ccd re-proves against the world before it does. A grant of bare
 * `['ws-reap']` is not a smaller grant, it is a DIFFERENT one — it permits an
 * UNCONFIRMED reap, i.e. the exact thing §7 says can never cross the wire.
 *
 * Kept as data rather than a hardcoded `if` so the type below and the runtime
 * audit read the SAME source — the P2 failure mode (auditor and lookup asking
 * different questions) is the one to avoid while fixing P1.
 */
export const REQUIRED_VERB_FLAG = { 'ws-reap': '--expect' } as const;
type GatedVerb = keyof typeof REQUIRED_VERB_FLAG;

/**
 * Verbs no prefix may ever START with, whatever follows them. `ws-rm` is the
 * unguarded legacy delete (no audit, no token, no confirmation) and `ws-gc`
 * carries `--prune`, which a prefix of `['ws-gc']` would permit outright.
 * Re-admitting either is caught cross-package today only by layer 3's
 * reachability check; listing them here makes it a compile error and a boot
 * failure as well, in the same pass that closes `--expect`.
 */
export const UNGRANTABLE_VERBS = ['ws-rm', 'ws-gc'] as const;
type UngrantableVerb = (typeof UNGRANTABLE_VERBS)[number];

/**
 * `never` for a lawful prefix, and the prefix itself (i.e. something that is
 * NOT `never`) for an unlawful one. Four unlawful shapes, all of them real:
 *
 *   * `[]`            — an EMPTY prefix. `isExecAllowed`'s `p.every(...)` is
 *                       vacuously true on it, so one empty prefix in the `ccd`
 *                       list grants every ccd verb that exists, `ws-rm` and
 *                       `ws-gc --prune` included. The widest possible grant,
 *                       written as the smallest possible diff.
 *   * `['ws-rm', …]`  — an ungrantable verb at the head.
 *   * `['ws-reap']`   — a gated verb with nothing after it.
 *   * `['ws-reap', x]`— a gated verb with the WRONG token after it (the shape a
 *                       plausible-looking edit produces: `--session`).
 *
 * `P` is a naked type parameter, so this distributes over the union of every
 * prefix in the table and one bad entry anywhere poisons the whole result.
 */
export type IllegalGrant<P> =
  P extends readonly [infer H, ...infer R]
    ? H extends UngrantableVerb
      ? P
      : H extends GatedVerb
        ? R extends readonly [infer F, ...unknown[]]
          ? F extends (typeof REQUIRED_VERB_FLAG)[H & GatedVerb] ? never : P
          : P
        : never
    : P;

/**
 * Mechanism 1 for VALUES, the counterpart of `ProvenGrantable` for keys:
 * evaluates to `W` while every prefix in it is lawful, and to `never` the
 * instant one is not — so the proof line below stops typechecking (TS2322).
 * Exported so `test/types/bypasses/g5..g8` can replay each unlawful shape
 * against the same machinery the real table is checked against, rather than
 * against a lookalike.
 */
export type LawfulGrants<W extends Record<string, readonly (readonly string[])[]>> =
  [IllegalGrant<W[keyof W][number]>] extends [never] ? W : never;

/** cmd -> allowed argv PREFIXES. `args` must begin with one of them; tokens
 *  after the prefix are unconstrained. One-token prefixes are exactly the old
 *  behaviour, so every pre-existing entry is bit-identical.
 *
 *  `as const satisfies ExecWhitelist` rather than a `: ExecWhitelist`
 *  annotation: `satisfies` keeps every excess-property and missing-key error
 *  the annotation gave (measured — a `gh` key is still TS2353 above AND below
 *  `ccd:`, a missing `ccd` key is still TS2741), while `as const` preserves the
 *  literal TUPLE types that `LawfulGrants` needs to see. Under the old
 *  annotation every prefix widened to `readonly string[]` and no type could
 *  tell `['ws-reap','--expect']` from `['ws-reap']`. */
export const EXEC_WHITELIST = {
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
} as const satisfies ExecWhitelist;

/**
 * The proof line. Typed `LawfulGrants<…>`, so it is the real table's own type
 * while every prefix is lawful and `never` the moment one is not — which makes
 * `['ws-reap']`, `['ws-reap','--session']`, `['ws-rm', …]` and `[]` COMPILE
 * ERRORS on this line rather than green diffs (verify round 2, P1).
 *
 * Consumed as `auditExecWhitelist`'s default argument, exactly as
 * `GRANTABLE_COMMANDS` is consumed by its body — a live constant on the real
 * path, not an unused type test a tidy-up could delete without noticing.
 */
const LAWFUL_EXEC_WHITELIST: LawfulGrants<typeof EXEC_WHITELIST> = EXEC_WHITELIST;

// The list is exported so a different package can assert its keys; freezing it
// (outer object, each prefix list, each prefix) means "exported for reading"
// stays true at RUNTIME too. Same reasoning as the mint-site freeze in
// `server/src/ccdargv.ts`: the type already forbids `EXEC_WHITELIST.ccd.push`,
// and the freeze is what stops the untyped shapes — `as any`, a `JSON.parse`
// result, array covariance — from reaching in and widening the list in place.
//
// Driven off `EXEC_COMMANDS` rather than `Object.values`: with the literal
// (`as const`) type above, `Object.values` falls to its `(o: {}): any[]`
// overload and both loop variables become `any`, which would silently
// un-typecheck the freeze itself.
for (const cmd of EXEC_COMMANDS) {
  const prefixes: readonly (readonly string[])[] = EXEC_WHITELIST[cmd];
  for (const prefix of prefixes) Object.freeze(prefix);
  Object.freeze(prefixes);
}
Object.freeze(EXEC_WHITELIST);

/** Every message this audit emits — fatal or not — carries the same prefix the
 *  rest of the agent logs with (`index.ts`), so whatever ends up printing it
 *  (node's uncaught-exception dump for the module-load throw, journald for the
 *  warning) shows up under `journalctl -u ccrc-agent | grep ccrc-agent:` next
 *  to every other line the agent ever wrote. See `refuseToBoot`. */
const LOG_PREFIX = 'ccrc-agent:';

/**
 * WHY THIS KILLS THE PROCESS, and where the line is drawn (verify round 2,
 * item 3 — the reviewer's availability objection, answered rather than waved
 * through).
 *
 * The objection is real and it is not theoretical: this box runs 11 live
 * sessions, and a module-load throw converts a class of future mistake from a
 * red test suite into a fleet-wide outage. So the audit no longer treats every
 * discrepancy the same way. The rule, stated once and applied below:
 *
 *   **Refuse to boot for OVER-permission. Never refuse to boot for UNDER-
 *   permission.**
 *
 * Over-permission (a forbidden key, an undeclared key, a prefix that grants
 * more than it names) is a control failure: the agent would be serving a
 * capability nobody in this file declared, and there is no second credential
 * behind it. A dead agent is loudly, obviously broken and takes one operator
 * minute to diagnose from the message below; a live agent with a `gh` grant or
 * a token-free `ws-reap` is silently, unrecoverably worse. That trade is worth
 * making, and it is the only trade this throw makes.
 *
 * Under-permission (a declared command with no entry; a value that is not a
 * prefix list at all) cannot escalate anything — the worst case is one route
 * answering 502 on the fleet. That is exactly the "dead agent" cost the
 * reviewer objected to, paid for a defect that CANNOT be a security failure, so
 * it is now a loud non-fatal error instead (see the `missing` branch). It is
 * also already caught three other ways before it could ever reach a host:
 * `Record<ExecCommand, …>` makes it TS2741 (fixture `g4-missing-declared-key`),
 * `whitelist-structural.test.ts` asserts it, and layer 3 of the server's
 * `whitelist-subset.test.ts` fails on the missing grant.
 *
 * DIAGNOSABILITY: the throw happens while this ESM module is being evaluated,
 * i.e. before `index.ts`'s body runs at all — so the `unhandledRejection`
 * backstop there cannot swallow it (a static import is evaluated before the
 * importing module's first statement), node prints the message and the stack to
 * stderr, and the process exits non-zero. The message names the offending key
 * or prefix, says what the rule is, and carries `LOG_PREFIX`. Disclosed
 * residual: if the static `import { startAgent } from './server.js'` in
 * `index.ts` were ever converted to a dynamic `await import()` inside a `try`,
 * that backstop COULD catch this and keep a widened agent alive. Nothing does
 * that today and nothing should.
 */
function refuseToBoot(message: string): never {
  throw new Error(`${LOG_PREFIX} ${message} Refusing to start.`);
}

/** The under-permission half: say it loudly, keep serving. */
function reportNonFatal(message: string): void {
  console.error(`${LOG_PREFIX} ${message} Continuing — this cannot grant anything.`);
}

/**
 * Mechanism 3 of the no-`gh` pin: a RUNTIME self-audit, run once at module
 * load (see the call directly below), which throws — so the agent refuses to
 * boot rather than serving a widened list.
 *
 * This is deliberately not a test and deliberately not a type. `ccdargv.ts`
 * discloses that a nominal brand cannot stop a deliberate cast, array
 * covariance, or an `any`-typed value; none of those help here, because this
 * reads the ACTUAL object at runtime, after every cast has already happened. It
 * also survives the case no type can reach at all: someone editing the compiled
 * `dist/whitelist.js` on the fleet host.
 *
 * Three separate questions, because they fail differently: a `gh` key is a
 * security failure; a key that is merely absent from `GRANTABLE_COMMANDS` is
 * drift that would otherwise ship as a silent 502; and — new in verify round 2,
 * P1 — a prefix VALUE that grants more than its name says is a security failure
 * that the old key-only audit could not see at all.
 *
 * Takes the object as a parameter, defaulted, so the pinning test can hand it a
 * real widened whitelist and observe the real throw — rather than asserting
 * only that today's list is fine, which would be a pin that cannot fail.
 */
export function auditExecWhitelist(
  whitelist: Readonly<Record<string, unknown>> = LAWFUL_EXEC_WHITELIST,
): void {
  // `Reflect.ownKeys`, NOT `Object.keys` (verify round 2, P2). `Object.keys`
  // returns own ENUMERABLE keys; `isExecAllowed` looks a command up with
  // `Object.hasOwn`, which is own ENUMERABLE-OR-NOT. The verifier measured the
  // gap: one line —
  //   Object.defineProperty(EXEC_WHITELIST, 'gh', { value: [['pr','merge']], enumerable: false })
  // — and `isExecAllowed('gh', ['pr','merge','1'])` answered TRUE while this
  // audit, the server's cross-package `Object.keys` assertion and both type
  // mechanisms all reported a clean two-key list. An auditor must consult
  // EXACTLY what the lookup consults. Symbol keys are stringified rather than
  // dropped, so a symbol-keyed grant lands in the drift branch instead of
  // vanishing (and `String(sym)` is the one conversion that does not throw).
  const keys = Reflect.ownKeys(whitelist).map((k) => (typeof k === 'symbol' ? String(k) : k));

  const forbidden = keys.filter((k) => (FORBIDDEN_COMMANDS as readonly string[]).includes(k));
  if (forbidden.length > 0) {
    refuseToBoot(
      `EXEC_WHITELIST grants a forbidden command: ${forbidden.join(', ')}. ` +
      'The host gh token carries the repo WRITE scope and there is no second ' +
      'credential; a gh grant makes this list the sole control between the PWA ' +
      'and `gh pr merge`. See whitelist.ts.',
    );
  }

  const declared: string[] = [...GRANTABLE_COMMANDS].sort();
  const actual: string[] = [...keys].sort();
  const extra = actual.filter((k) => !declared.includes(k));
  const missing = declared.filter((k) => !actual.includes(k));
  if (extra.length > 0) {
    refuseToBoot(
      `EXEC_WHITELIST keys drifted from EXEC_COMMANDS: have [${actual.join(', ')}], ` +
      `declared [${declared.join(', ')}]. Undeclared grant(s): ${extra.join(', ')}.`,
    );
  }
  if (missing.length > 0) {
    reportNonFatal(
      `EXEC_WHITELIST keys drifted from EXEC_COMMANDS: have [${actual.join(', ')}], ` +
      `declared [${declared.join(', ')}]. Missing grant(s): ${missing.join(', ')} — ` +
      'every route that needs one will answer 502.',
    );
  }

  // THE VALUES (verify round 2, P1). Everything above this line reads the key
  // SET, which is why deleting `--expect` from the one grant whose comment
  // calls it load-bearing was invisible to every non-test mechanism.
  for (const key of actual) {
    const prefixes: unknown = whitelist[key];
    if (!Array.isArray(prefixes)) {
      // Under-permission: `isExecAllowed`'s own `Array.isArray` guard answers
      // false for this command, so it grants nothing. Loud, not fatal.
      reportNonFatal(`EXEC_WHITELIST['${key}'] is not a list of argv prefixes, so nothing is grantable under it.`);
      continue;
    }
    for (const prefix of prefixes as unknown[]) {
      if (!Array.isArray(prefix) || (prefix as unknown[]).some((t) => typeof t !== 'string')) {
        // Fatal, and this one IS over-permission-shaped: a non-array prefix
        // makes `p.every` THROW inside the lookup rather than answer, which is
        // the destructive-F7 bug class the prototype guards were added for.
        refuseToBoot(`EXEC_WHITELIST['${key}'] contains a prefix that is not a list of string tokens.`);
      }
      const tokens = prefix as string[];
      if (tokens.length === 0) {
        refuseToBoot(
          `EXEC_WHITELIST['${key}'] contains an EMPTY prefix, which grants every ` +
          `${key} subcommand that exists — ws-rm and ws-gc --prune included.`,
        );
      }
      const [verb, second] = tokens;
      if ((UNGRANTABLE_VERBS as readonly string[]).includes(verb!)) {
        refuseToBoot(
          `EXEC_WHITELIST['${key}'] grants the ungrantable verb '${verb!}' ` +
          `(${tokens.join(' ')}). ws-rm is the unguarded legacy delete and ws-gc carries --prune.`,
        );
      }
      const required = (REQUIRED_VERB_FLAG as Readonly<Record<string, string>>)[verb!];
      if (required !== undefined && second !== required) {
        refuseToBoot(
          `EXEC_WHITELIST['${key}'] grants '${tokens.join(' ')}', but '${verb!}' is only ` +
          `grantable with '${required}' immediately after it. A ${verb!} without ` +
          `'${required}' is an UNCONFIRMED destructive call, not a narrower grant.`,
        );
      }
    }
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
  // DECLARED, not merely present (verify round 2, P2). `Object.hasOwn` alone
  // asks "is there an own property?", which a single
  // `Object.defineProperty(EXEC_WHITELIST, 'gh', { enumerable: false, … })`
  // answers yes to while every key-set mechanism in this file reports a clean
  // two-key list. `GRANTABLE_COMMANDS` is the CLOSED declared set, so this line
  // asks the question the whole file is about — and it means the lookup and the
  // audit now consult the same thing, which was the substance of P2. `hasOwn`
  // stays as the second guard: it is the one that survives GRANTABLE_COMMANDS
  // being widened, and neither is expensive.
  //
  // THIS LINE IS NOT PINNED BY ANY TEST, AND CANNOT BE. Stated here because
  // round 2's report folded it into a measurement of the OTHER half of that
  // fix (the auditor's `Reflect.ownKeys`), which reads as coverage it does not
  // have; verify round 3, P3 caught that. Delete the line and the agent suite
  // is 191/12, `tsc -p agent` is clean and the server's cross-package check is
  // 39/39. The reason is structural, not an oversight: for the two guards to
  // disagree, `EXEC_WHITELIST` would need an OWN key that is not in
  // `GRANTABLE_COMMANDS`, and there is no reachable state in which it has one.
  // The literal's keys are `Record<ExecCommand, …>` (compile error otherwise),
  // `auditExecWhitelist()` runs at module load over `Reflect.ownKeys` and
  // refuses to boot on an undeclared key, and the object is `Object.freeze`d
  // before any test can run — so a distinguishing input cannot be constructed
  // from outside, and one constructed INSIDE the module (a
  // `Object.defineProperty(EXEC_WHITELIST,'gh',{enumerable:false})` inserted
  // above the freeze) makes the import throw before this function exists.
  //
  // It is kept as defence-in-depth for the one future where that changes: the
  // freeze removed, the audit weakened, or the table sourced from anywhere but
  // a literal. What it must NOT become is a parameter — `auditExecWhitelist`
  // takes its table as a defaulted argument and that is safe, because injecting
  // there can only cause a false THROW. Injecting into the LOOKUP would create
  // an allow-path that does not exist today. `whitelist-structural.test.ts`
  // pins the PREMISE (own-key set === declared set, and frozen) rather than
  // pretending to pin this line.
  if (!(GRANTABLE_COMMANDS as readonly string[]).includes(cmd)) return false;
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
