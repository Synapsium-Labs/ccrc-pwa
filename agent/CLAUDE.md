# agent/ — the fleet-touching package

This is the WS service on the **fleet host** (BOX 2). Read the root `CLAUDE.md` SAFETY section first — the
whitelist here is the sole control between the PWA and the fleet's shell. The rules below are the ones you WILL
get wrong when editing `src/whitelist.ts`.

## The exec whitelist (`src/whitelist.ts`) — do not weaken
- Exactly **two** grantable exec commands: `tmux` and `ccd` (`EXEC_COMMANDS`). Matched on the EXACT bare command
  name (any `/` rejected — no basename/path match) plus an **argv PREFIX**; tokens after the prefix are
  unconstrained.
- **`gh` has NO entry, on purpose** — the host `gh` token carries `repo` WRITE scope, there's no read-only
  credential and no cwd sandbox, so one `gh` grant makes this list the only thing between the PWA and
  `gh pr merge`. The one PR write goes through a `ccd` verb instead. Also forbidden: `git`, `sh`, `node`, `curl`,
  `rm`, `systemctl`, … (`FORBIDDEN_COMMANDS`).
- The no-`gh` invariant is pinned by **four mechanisms in three classes**, all of which must keep passing:
  (1) TS union type — a `gh` key is a compile error; (2) `ProvenGrantable`/`LawfulGrants` — widening the union or
  an unlawful prefix is a *different-line* compile error; (3) **runtime `auditExecWhitelist()` runs at module load
  and THROWS (`refuseToBoot`)** — survives casts/`any`/`JSON.parse` and hand-edited compiled `dist/`; (4) tests,
  including the cross-package `server/test/whitelist-subset.test.ts`.
- **Boot-refusal asymmetry:** refuse to boot for OVER-permission (forbidden/undeclared key, over-granting or
  empty prefix, ungrantable verb, gated verb missing its flag). NEVER refuse for UNDER-permission (a declared
  command missing an entry → loud non-fatal; one route answers 502).
- **Gated verbs:** `ws-reap` requires `--expect` (confirmation token), `ws-rename` requires `--session` (its argv
  is built from model output with no human in the path). **Ungrantable verbs:** `ws-rm`, `ws-gc`. An empty prefix
  `[]` grants every subcommand and is fatal.
- `EXEC_WHITELIST` and its prefix lists are `Object.freeze`d at load; `isExecAllowed` uses `Object.hasOwn` +
  `GRANTABLE_COMMANDS.includes` + `Array.isArray` so prototype-named keys (`constructor`, `__proto__`) fail
  CLOSED (return false, not throw).

## Testing the whitelist — the non-obvious part
- The type-bypass tests (`test/whitelist-structural.test.ts`, `whitelist-prototype.test.ts`,
  `whitelist-noghosts.test.ts`) **spawn a real `tsc` over a tests-inclusive project** rather than using
  `@ts-expect-error` — because `agent/tsconfig.json` does NOT include `test/` and vitest here has no typecheck
  block, so an inline `@ts-expect-error` would be evaluated by no gate ("a pin that cannot fail").
- Regression on record: deleting `whitelist-noghosts.test.ts` and adding `gh:[['pr','view']]` left the suite
  99/99 PASS + `tsc` clean. One `rm` silently removed the branch's most dangerous invariant. **Treat these test
  files as safety hardware — never delete or skip one to make a change land.**

## Agent runtime facts
- Binds a **single interface, default `127.0.0.1`, NEVER `0.0.0.0`** (`CCRC_AGENT_HOST`), :7789. Every connection
  must send a valid `hello` bearer token within 3s or the socket closes (wrong token → close code `4401`).
- **Write whitelist:** the agent may write files only under `$HOME/.cc-clips/`. Every other fleet mutation crosses
  the WS as a whitelisted `ccd`/`tmux` verb, never a raw file write. Read whitelist is canonical-prefix,
  realpath-resolved (closes symlink escapes): `~/.cc-sessions/`, `~/.cc-limits/`, `~/.cc-clips/`, `~/.claude*`,
  and the fleet projects root.
- `ptyOpen` only ever spawns `tmux attach -t cc-<sessionId>` with `sessionId` sanitized to `[A-Za-z0-9_-]+` —
  never an arbitrary command.
- The agent has **no HTTP routes** (its `createServer` carries only a WS upgrade), so the deploy's
  `verify-service.sh` (MainPID stability across a window > `RestartSec`) is its only post-restart check — it
  catches the `refuseToBoot` crash-loop that a `systemctl restart` exit-0 would otherwise hide.
