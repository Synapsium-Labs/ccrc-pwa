# Account connections — design (2026-09-05)

**Status:** draft for operator review. Architecture drafted 2026-09-05; the UI (§12), the
DIRECTION amendments (§13) and the six rulings they forced were added 2026-09-06 after a
three-concept design panel and two rounds of adversarial verification against a rendered canvas.
Operator review 2026-09-07 reopened decisions 7, 9 and 12: ccrc now DRIVES the Anthropic sign-in
and it needs no pty (§6), macOS is supported rather than deferred (§6, §15.9), and the OpenRouter
lane carries a model allowlist (§4.1, §4.3).
Anchors are against `origin/main` @ `2b15144e`, the sha the live server box reports from `/health` (this worktree was fast-forwarded to it on 2026-09-05). Supersedes the unimplemented
`2026-08-21-account-provisioning-design.md` where the two disagree (§16 lists every
supersession). Nothing here is implemented; no D-numbers are allocated (they come from
`POST /api/ledger/deviations` at plan time).

**Scope, as ruled in chat on 2026-09-05:** a UI in the PWA that ADDS, RE-AUTHENTICATES,
HEALTH-CHECKS, ENABLES/DISABLES and REMOVES accounts for three providers — Anthropic
(subscription only, long-lived token pasted or minted in a pane), OpenRouter (API key,
PKCE when the box is exposed), OpenAI (ChatGPT subscription through an EXTERNAL launcher
ccrc does not own). The design may amend `pwa/design/DIRECTION.md`.

## 1. What the tree says today (measured 2026-09-05, live fleet box + this worktree)

The eight-reader understand pass and its verifications are the evidence; every anchor
below was read or measured this week, not carried from the August spec.

1. **The server cannot reach any of the files this feature mutates.** The agent's only
   write op is `writeB64` fenced to `~/.cc-clips` (`agent/src/whitelist.ts:79-80`), with
   no mode field (`shared/agent-protocol.ts:95`) and umask-default writes
   (`agent/src/fileops.ts:104-113`). `~/.cc-secrets`, `~/.ccrc`, `~/.local/bin` and
   `~/.handoff` are on neither the read nor the write root (`whitelist.ts:60-92`). Exec
   frames carry argv only — no stdin, no env (`agent-protocol.ts:88`, `agent/src/server.ts:249`)
   — and `EXEC_COMMANDS` is exactly `['tmux','ccd']` (`whitelist.ts:134`); `bash`, `node`,
   `env`, `chmod` and `systemctl` are FORBIDDEN by type and boot audit. `ccrc` is therefore
   unreachable from the server, and a secret on argv would land in world-readable
   `/proc/<pid>/cmdline` (the hazard `ccd/ccrc:2898-2915` documents for `passwd`).
2. **Two rosters, one loaded once.** Each box holds its own seed-once
   `~/.ccrc/accounts.json` (`deploy/deploy.sh:468-474`, `ccd/ccrc:3931-3943`,
   `ccd/ccrc-adopt:616-618`); nothing in the tree edits an entry in place. The server
   parses ITS box's copy synchronously at module top level (`server/src/index.ts:22`,
   `config.ts:212-254`) and never reloads (`server.ts:1025-1028`); every reader goes
   through `deps.cfg.roster` by reference (`limits.ts:183`, `server.ts:1162,1185-1186`,
   `sessionws.ts:742`, `config.ts:187`, `fleet.ts:406`, `watch.ts:2041`) — none captures
   it at import time. The fleet box's `ccd` sources the GENERATED `~/.ccrc/accounts.sh` on
   every invocation (`ccd/ccd:961-972`); long-lived `ccd supervise` processes hold what
   they sourced at start. `rosterFp` is the agent's digest of that installed projection,
   read on every `ready` (`agent/src/server.ts:510`, sent at :643); the server's `ownRosterFp` is a
   boot-time const (`server.ts:1028`). Any mutation on one side reads `divergent` until
   the other side catches up.
3. **The generated wrapper is three significant lines and one reader with four
   consumers.** `export CLAUDE_CONFIG_DIR`, optional `[ -r secrets ] && . secrets`,
   `exec "$HOME/.local/bin/<upstream>" "$@"` (`shared/wrapper.mjs:140-148`);
   `_wrap_parse_shape` (`ccd/ccrc-wrapper-shape:209-277`) accepts exactly 2 or 3
   significant lines and prints a positional 4-field TSV consumed by `cmd_wrappers` (three
   sites), `ccrc-adopt`, doctor's `_check_wrappers` and `wrapper-roundtrip.test.ts`. The
   hand-written api-key lanes on the box (`cck3`, `claude-glm`) are 12-15 lines and are
   refused by that reader by design.
4. **Roster model.** `ExecSpec = upstream | generated{secretsFile?} | external`
   (`shared/roster.ts:65-68`); `secretsFile` validated only in the generated arm and
   WARNED-and-dropped elsewhere (`:247,:294,:321-322`); `telemetry: 'anthropic'|'none'`;
   `hidden` (additive, `=== true`); six hues auto-dealt (`:487-533`); version pinned at 1
   by two parsers (`roster.ts:559`, `roster-json.mjs:266`). The bare-node mirror
   `shared/roster-json.mjs` is LAXER than `parseRoster` in two measured places — it never
   reads `hidden`, and it passes `secretsFile` through for every kind (`:224`) while its
   `.d.mts` claims otherwise — both fixed by this design (§4.6).
5. **Wire.** `RosterWire = {id,label,hue,homeAble,hidden}` (`shared/api.ts:2581-2607`),
   pinned EXACTLY by `server/test/accounts-route.test.ts:183`; `AccountUsage` rows come
   only from `.cc-limits/*.json` plus markered lanes (`server.ts:1150-1171`,
   `limits.ts:115-124`), so a rostered account that never ran has no usage row at all.
   `telemetry` and `exec` never reach the browser. The PWA has **five** independent
   `/api/accounts` pollers across four files, each on its own 20 s timer, and no exported
   refresh (`stores/fleet.ts:261-277`, `AccountsScreen.tsx:36-76`, `AccountsStrip.tsx:72-98`,
   and BOTH hooks in `useProjectedHome.ts` — `useProjectedHome` at `:54-68` and
   `useDisabledWrappers` at `:86-103`; re-measured 2026-09-06, the count of four this spec
   first carried missed the second hook in that file).
6. **Panes.** ccd has ONE spawn site, gated on a complete registry row
   (`ccd/ccd:11720-11753`), and no verb creates a non-Claude pane; `_tmux_new_session`
   (`:11547-11665`) is the only creator that lands the tmux server in
   `ccrc-tmux-server.scope` (D-514). `/ws/pty/:id` attaches by name `cc-<id>` with a
   charset gate on the agent (`agent/src/pty.ts:23-41`) and no registry check
   (`server.ts:1354-1377`). No render path redacts pane text: pty frames, `Dialog.raw`,
   `/prompt` refusal tails, FleetWatcher captures and the push payload
   (`watch.ts:3227`) all carry it raw. ccd's own typers (`_accept_first_run_prompts`,
   `_inject_spawn_effort`, `_auto_compact_check`) press keys into every pane that goes
   through `_spawn`/`_spawn_settle` — a helper pane must not.
7. **Live lanes.** `claude` is a 9 KB launcher script (untracked) that sources
   `~/.cc-secrets/claude-oauth.env` only for the default config dir; three generated
   Anthropic wrappers with 0600 `<id>-oauth.env` files each holding exactly one
   `CLAUDE_CODE_OAUTH_TOKEN`; `gpt -> ccgpt` (LiteLLM 1.93.0 + a system-folding shim,
   device-code login writing `~/.handoff/chatgpt-auth/auth.json`, refresh automatic,
   a FAILED refresh falls into a fresh 15-minute device-code prompt inside whatever
   process called it); `cck3`/`claude-glm` undeclared OpenRouter/Cortecs lanes sourcing a
   shared `~/.handoff/env`. `gpt` is kill-switched by `~/.cc-sessions/gpt-disabled` since
   2026-07-28. Every Anthropic lane exports the env token (scope `user:inference`) while
   ccd launches with `--remote-control`; Remote Control cannot be promised for
   token-minted lanes.
8. **External facts that moved since August.** Claude Code is 2.1.258-2.1.261 here;
   `setup-token` is current, one-year, print-once, inference-only, never read in bare
   mode; `--bare` is still NOT the `-p` default. `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` /
   `_SCOPES` are now documented ("provisioning in automated environments") but nothing
   documents how the refresh token is minted. Console accounts gained a browser OAuth path
   (2.1.242) — out of scope (subscription only). OpenRouter: PKCE from any client with no
   secret and no registration, a headless variant that shows the code on screen,
   `POST /api/v1/auth/keys` exchange, an Anthropic-format `/api/v1/messages` that accepts
   `provider.only`, and an official Claude Code recipe needing no local proxy
   (`ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=<key>`,
   `ANTHROPIC_API_KEY=""`). OpenAI: the subscription is reachable only through Codex/LiteLLM
   OAuth; no Anthropic-format endpoint; the Codex backend still rejects system messages.
   Anthropic's legal page says developers "may not collect, store, or intermediate Claude.ai
   credentials or session tokens"; the operator provisioning their own token on their own
   box is the defensible reading and this spec says so out loud (§15).
9. **Gating doctrine.** Operator PWA writes are SESSION-gated, not box-token gated
   (D-1240, `coord/routes.ts:1304-1316`); the PWA sends no `x-ccrc-mail-token`
   (`pwa/src/lib/api.ts:242-300`). HTTPS cannot be measured from a request (no
   `trustProxy`, no forwarded-header reader, pinned by `auth-routes.test.ts:678-703`);
   the only feasible check is config-stated on `cfg.origin` (`cookie.ts:183-204` pattern).
   TLS is Caddy + DuckDNS via `ccrc expose`, never tailscale.
10. **The server box (measured 2026-09-05 from the fleet box, read-only, nothing secret
    printed).** `/health` reports sha `2b15144e` (origin/main); `/api/auth/status` answers
    `mode: passphrase` with three passkeys enrolled and an https `rpId` on the DuckDNS
    name — the session gate IS armed and the origin IS https; `/api/fleet/health`
    refuses cookieless with `401 no-session`. The agent's `CCRC_SERVER_URL` scheme is
    `https`. Unmeasured: the server→agent link's own scheme (`CCRC_AGENT_URL` lives on
    the server box); a secret in an agent frame is encrypted in transit only if that link
    is `wss` or the network is private — the plan's first deploy step records it.
11. **Two pre-existing exposures this design must not widen.** The agent's read glob
    admits every `$HOME/.claude*` first segment (`agent/src/whitelist.ts:47-53`), so each
    lane's 0600 `.credentials.json` and `.claude.json` are already readable over the
    link; nothing in this design reads a config dir, and excluding those two names from
    the glob is recommended as a separate hardening (a whitelist change with its own
    mutation row). And `auth-gate.test.ts:309-335` diffs Fastify's real route table
    against its scan — a route registered in a THIRD file is refused outright, so the new
    routes live in `server.ts`.
12. **Provisioning a home is more than a wrapper.** `install-session-hooks.sh`,
    `install-coordinator-skill.sh`, `install-worker-skill.sh`, `install-graphify-skill.sh`
    and `ccrc-doctor-checks`' graphify check all iterate `CCRC_ACCOUNTS` homes; the hooks
    installer skips a home whose directory does not exist and refuses to create a
    `settings.json` on remove. Only the install spine runs them (`ccd/ccrc:3800-3822`),
    and `ccrc install --role fleet` restarts `ccrc-agent.service`. Without the statusline
    hook a lane never writes `~/.cc-limits/<id>.json`.

## 2. Approaches considered

Three transports were on the table; the choice is the architectural decision of this
spec.

**A — "the pane does everything".** No new agent op. Every mutation is a new ccd verb
that opens a tmux pane running `ccrc account …` interactively; the operator types into
the terminal drawer. Zero secrets ever cross the server. Rejected as the primary path:
pasting a token into an xterm on a phone is the worst possible input surface, the
server can only learn outcomes by scraping panes or reading status files, and it still
needs a new ccd grant. Kept as the shape of the AUTH PANE (§6), which genuinely needs a
detached process.

**B — one fleet verb, one typed agent op (chosen).** A single fleet-side verb family,
`ccrc account`, owns every mutation on the fleet box and reads secrets from STDIN only.
The agent gains ONE purpose-built op, `account`, whose payload is validated by shape
(closed subcommand list, id charset, base64 stdin) and whose handler runs that verb —
the same relationship `ptyOpen` has to `tmux attach`: an op, not an exec grant.
`EXEC_COMMANDS` stays `['tmux','ccd']`; `EXEC_WHITELIST` gains nothing; an older agent
answers `bad-request` to the unknown op, which is FAIL CLOSED. The server keeps a
mirror of the roster and hot-reloads it. Local mode runs the same verb directly.

**C — widen the generic file and exec surfaces.** Add `mode` to `writeB64`, widen the
write root to `~/.cc-secrets` and `~/.ccrc`, add `stdinB64` to exec, and let the server
orchestrate each step (write secret, edit roster, regenerate, converge). Rejected: it
opens a generic secret-writing file op on the wire, it is non-atomic across five fleet
steps the server cannot roll back, and an OLDER agent silently drops the new `mode`
field and lands the secret at 0644 — the wrong polarity for a secret write.

Why B over A and C in one sentence: the fleet box owns its files, so the fleet box
should own the transaction, and the wire should carry one typed intent rather than a
shell session or a file write.

## 3. Architecture (approach B)

```
PWA ── session-gated POST /api/accounts/* ──► server (L4 route → L1 decision)
                                                │  AccountOps port (L2)
                          local mode ───────────┼─────────── remote mode
                          spawn ccrc account …  │           agent op {op:'account', argv, stdinB64?}
                          stdin = secret        ▼           agent runs ~/.local/bin/ccrc account … with stdin
                                    fleet box: ccrc account <sub> (bash + node)
                                    • edits ~/.ccrc/accounts.json (one entry, atomic)
                                    • writes ~/.cc-secrets/<id>-<provider>.env 0600 (stdin)
                                    • regenerates ~/.ccrc/accounts.sh (_inst_accounts_sh)
                                    • converges the wrapper (cmd_wrappers path)
                                    • provisions the home (config dir, settings.json env, hooks, skills)
                                    • prints ONE JSON result on stdout, never a secret
                                                │
                                    server: writes the returned roster JSON to ITS ~/.ccrc/accounts.json,
                                            reloads cfg.roster + ownRosterFp in place, answers the PWA,
                                            PWA calls refreshAccounts()
```

Ring placement follows `2026-08-10-architecture-ddd-clean-solid.md`: the decision of
what an add/remove is allowed to do is L1 (`server/src/accounts/decide.ts`, pure,
returns a refusal code or an `AccountPlan`); the port is L2 (`AccountOps`, declared by
the consumer in `server/src/accounts/ops.ts`); the two adapters are L3
(`localAccountOps` spawning `ccrc`, `remoteAccountOps` sending the op); the routes are
L4 in `server/src/server.ts` (so `auth-gate.test.ts`'s scanner sees them); no L5 change
but `index.ts` wires the adapter.

## 4. Roster model changes

### 4.1 Provider, auth and models on `AccountDef`

```ts
export type ProviderId = 'anthropic' | 'openrouter' | 'compatible' | 'openai';
export type ExecSpec =
  | { kind: 'upstream';  secretsFile?: string }
  | { kind: 'generated'; secretsFile?: string; provider: ProviderId; baseUrl?: string;
      models?: ApiKeyModels }
  | { kind: 'external';  secretsFile?: string; provider?: ProviderId; baseUrl?: string };
export interface ModelMap { opus: string; sonnet: string; haiku: string; subagent: string }
export interface ModelChoice { id: string; label?: string }
export interface ApiKeyModels extends ModelMap { selectable?: ModelChoice[] }
```

- `secretsFile` becomes legal on ALL three kinds, validated by one hoisted gate
  (`SECRETS_SAFE_RE`, no `/` prefix, no `..`, no trailing `/`). On `upstream` it is
  DECLARATIVE: it names the file the launcher sources so doctor and the UI can point at
  it; ccrc never writes the upstream launcher. This closes the "claude has a credential
  nobody can see" hole (`§1.7`) by declaration, the only way it can be closed.
- `provider` is REQUIRED on `generated` and OPTIONAL on `external`; on `upstream` it is
  always `anthropic` and not spelled. Absence-permitting migration: a `generated` entry
  with no `provider` parses as `anthropic` (every generated wrapper ever written by ccrc
  is one) and `parseRoster` WARNS once naming the field it assumed. An `external` entry
  with no `provider` is `undeclared` on the wire — the UI shows it, offers no provider
  operation but enable/disable and remove.
- `models` is legal on the two api-key providers, `openrouter` and `compatible` (a typed key set per arm,
  three sets not two — gate 39 of the August spec still holds). Values are model ids
  matched by `MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/` — a distinct gate
  from `ID_RE` because OpenRouter ids carry `/`, `.` and `:`.
- **`models.selectable` is the operator's model allowlist**, and it is what the session model
  picker offers on that lane. The four alias keys stay and are not optional: ccd and Claude Code
  route on `opus` / `sonnet` / `haiku`, and `subagent` is what a dispatched worker gets, so those
  four are the lane's *routing* map. `selectable` is a different question — *which models may I
  choose from the picker* — and without it an OpenRouter lane inherits Claude's hardcoded list,
  which is wrong for every lane that is not Anthropic-served. Each entry is a `MODEL_ID_RE`-valid
  id plus an optional human label; absent means "the four aliases and nothing else", which is the
  behaviour a roster written before this field already gets. Every alias value must itself appear
  in `selectable` when `selectable` is present — a routing target the operator cannot select is a
  lane that answers `/model opus` with something the picker never showed. (The interface was
  called `OpenRouterModels` until the base URL generalised, §15.22; the SHAPE did not change,
  only the name's claim about who may carry it.)
- **`baseUrl` is the endpoint the lane talks to, and it is the whole of the generalisation**
  (operator ruling 2026-09-07, §15.22). It is legal on `generated` and, declaratively, on
  `external` — where it records where a hand-written launcher points without ccrc ever writing
  that launcher, exactly as `secretsFile` does for its credential. It is REQUIRED when
  `provider === 'compatible'` and otherwise optional, defaulting to `PROVIDERS[p].baseUrl`.
  One gate, `BASE_URL_OK`: it must parse as a URL; the scheme must be `https:`, **or** `http:`
  when the host is a loopback literal (`127.0.0.1`, `[::1]`, `localhost`); no userinfo
  (`user:pass@` is refused outright, because a URL is not a place to keep a key); no query and
  no fragment; the path is kept verbatim, since an Anthropic-compatible endpoint may legitimately
  live under one (`https://openrouter.ai/api/v1`). The loopback exception is not a courtesy — it
  is how this fleet's existing api-key lanes already run (§4.3), and a plain-`http:` endpoint
  anywhere else would carry the lane's key across a network in clear.
- **The endpoint is shown, never hidden.** `baseUrl` is roster data: it rides the wire (§7), the
  card shows its host, and it is never written into `~/.cc-secrets`. An endpoint that lived only
  in a 0600 file would be one doctor could not check, the operator could not see, and `ccrc
  wrappers` would report as converged while the lane talked to somewhere else entirely.
- Version stays 1. Every new field is absence-permitting; a roster written before this
  spec parses unchanged (pinned by keeping `deploy/accounts.default.json` and
  `DEFAULT_TEST_ROSTER` byte-identical and green).

### 4.2 `PROVIDERS` — one table, one home

`shared/providers.ts` (L0, imports nothing; a new per-file no-import pin modelled on
`lifecycle.test.ts:841-844`):

| id | label | credential | env var the lane exports | connect methods | probe |
|---|---|---|---|---|---|
| anthropic | Claude subscription | a signed-in config dir, or a long-lived OAuth token | `CLAUDE_CODE_OAUTH_TOKEN` (token lanes only) | `login` (default), `paste`, `pane:setup-token` | `auth status` + inference |
| openrouter | OpenRouter | API key | `ANTHROPIC_AUTH_TOKEN` (+ `ANTHROPIC_API_KEY=""`) | `pkce`, `paste` | inference |
| compatible | any Anthropic-compatible endpoint | API key | `ANTHROPIC_AUTH_TOKEN` (+ `ANTHROPIC_API_KEY=""`) | `paste` | inference |
| openai | ChatGPT subscription (external launcher) | launcher-owned | — | `pane:login` | inference |

Each row also carries a default `baseUrl`: `openrouter` is `https://openrouter.ai/api/v1`,
`compatible` has NONE (the operator states it, and `add` refuses without it), `anthropic` has
none because Claude Code's own default is the endpoint, and `openai` has none because the lane
is somebody else's launcher.

`openrouter` and `compatible` are the same lane mechanically — the same `settings.json` env
block, the same secrets file, the same probe, the same removal order, the same UI — and differ
in exactly two things: `openrouter` carries a default endpoint and a public catalogue, and
`compatible` requires the endpoint and has neither. It stays its own id rather than folding into
`compatible` **because those two differences are what its screens are made of**: PKCE, and a
model picker with real context windows in it. A provider whose only distinguishing content is a
constant would not have earned a row; this one has two.

`PROVIDER_IDS = Object.keys(PROVIDERS)` and `GENERATABLE = PROVIDER_IDS.filter(p =>
PROVIDERS[p].generatable)` are DERIVED. `single-definition.test.ts` gains a describe
with its own fingerprint (`/^\s*export const PROVIDERS\s*=/` → exactly one holder) and a
no-free-standing-list scan; `roster-json.mjs` stays provider-agnostic (it validates
`provider` against a list it receives from `PROVIDER_IDS` via a generated constant
checked byte-for-byte by `gen-accounts.test.ts`, the pattern already used for the hue
table) so no `.mjs` copy of the table exists.

### 4.3 Provider config rides Claude Code's own `settings.json`, not the wrapper

The wrapper shape does NOT change. An OpenRouter lane's base URL, empty API key and
model map are written by `ccrc account` into `~/<configDirSuffix>/settings.json` under
an `env` block, merged with jq exactly as `install-session-hooks.sh` merges hooks
(managed keys, byte-level converge, backup before rewrite).

**MEASURED 2026-09-05 on the fleet box (Claude Code 2.1.261):** a throwaway config dir
whose `settings.json` carried only `{"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:18631",
"ANTHROPIC_AUTH_TOKEN":"probe-not-a-secret","ANTHROPIC_API_KEY":""}}` and NO shell env
sent `HEAD /api/hello` then `POST /v1/messages?beta=true` with
`Authorization: Bearer probe-not-a-secret` to a loopback stub; the debug log's line 5
lists exactly those keys as `settingsEnv keys`. The settings block routes the lane on
its own. (A fallback — a fourth wrapper line sourcing `~/.ccrc/lanes/<id>.env` and an
appended fifth TSV field — is therefore NOT needed and is not designed.)

What this buys: `_wrap_parse_shape`, the equivalence triple, `cmd_wrappers`' locks,
doctor's `wrappers` check, adopt and uninstall are all untouched; an OpenRouter wrapper
is byte-identical in shape to an Anthropic one and differs only in which 0600 file it
sources and what its config dir's `settings.json` says. The secret stays in
`~/.cc-secrets/<id>-openrouter.env` (one line: `export ANTHROPIC_AUTH_TOKEN=…`); the
config lives beside the transcripts, where the operator can read it and doctor can
check it without ever opening a secret.

**The picker is a real picker, because the catalogue is public.** MEASURED 2026-09-07:
`GET https://openrouter.ai/api/v1/models` answers 200 unauthenticated with 430 models, each
carrying `id`, `canonical_slug`, `context_length`, `architecture`, `default_parameters` and
pricing. So the allowlist step can list live models with their context windows instead of asking
the operator to type ids from memory, and an id can be validated by EXISTENCE rather than only by
regex. Three constraints on how that is done: the fetch is **server-side** (the PWA must not call
a third party — the artifact/CSP rules aside, it would leak the operator's browser to OpenRouter,
and the server already holds the lane's key), it is **cached** with its fetch time shown like
every other measurement on these screens, and it **degrades** — a catalogue that will not load
leaves a `MODEL_ID_RE`-validated text field and says which of the two the operator is looking at.
The catalogue is a convenience over the roster, never a source of truth: the roster is what the
lane runs on. **It is OpenRouter's, and only OpenRouter's.** A `compatible` lane has no
equivalent — an arbitrary Anthropic-compatible endpoint publishes no model list of a shape ccrc
could know — so that lane always gets the `MODEL_ID_RE`-validated field, which is the same
degraded arm the OpenRouter lane falls back to when the catalogue will not load. One code path,
one look, and the sentence that says which of the two you are reading is already required.

**The ownership whitelist is enforced by a PROXY on this fleet, not by an account setting —
MEASURED 2026-09-07.** `~/.local/bin/cck3` and `~/.local/bin/claude-glm` both point
`ANTHROPIC_BASE_URL` at `http://127.0.0.1:$HANDOFF_PROXY_PORT` (8642), both start
`handoff-proxy` if it is not already listening, and both **refuse to run** when
`~/.handoff/providers-whitelist.json` is absent; the proxy injects that list as `provider.only`
on every request. So a generated OpenRouter lane pointing straight at
`https://openrouter.ai/api/v1` would be the first OpenRouter path on this box that does not pass
the whitelist — worth saying plainly rather than leaving as a footnote about an account setting.

The generalisation is what closes that, and it needs no new mechanism: **the proxy is an
Anthropic-compatible endpoint.** An operator who wants the whitelist enforced gives the lane a
`baseUrl` of `http://127.0.0.1:8642` and has it — which is exactly the "the lane's
`ANTHROPIC_BASE_URL` points at the proxy and the plan adds one field" alternative this paragraph
used to name, arriving as the same field the operator asked for on other grounds. ccrc still
does not *require* the proxy, does not start it and never reads the whitelist file: it states
which endpoint the lane carries and leaves the judgement where it belongs (decision 3 stands,
now stated in terms of what is actually on the box).

**A correction the same measurement forces.** `cck3` is not a Moonshot-first-party lane: its key
is `OPENROUTER_API_KEY` and its endpoint is the loopback proxy. What is Moonshot is the
*upstream* OpenRouter would route to, and the ownership ban bites THERE, as `provider.only` —
the wrapper even warns on startup when `moonshotai` is missing from the whitelist. Generalising
the base URL therefore neither invokes nor weakens that ruling; they are different layers, and
an earlier note in this design's decision 12 said otherwise.

### 4.4 `configDirSuffix` default and the `.claude*` read glob

New accounts default to `.claude-<id>`, created by the verb on `$HOME`'s filesystem
(measured: every existing `~/.claude*` on the fleet box is its own bind-mount from a
second disk, and `$HOME` itself has 218 GB free — the memory note claiming 92 % is
stale). Moving a lane onto a mount stays an operator step; the UI states where the dir
was created. This is not cosmetic: the agent's read root
admits only `$HOME/.claude*` (`agent/src/whitelist.ts:47-52`), and every server read of
a lane's transcripts and statusline goes through `configDirFor`; a suffix outside that
glob is a lane the server can never read. The add flow REFUSES a suffix that does not
start with `.claude` (`suffix-outside-read-root`) rather than widening the glob. The id `auth` is refused
(`reserved-id`) because the pane helper's tmux name `cc-auth-<id>` would collide with a
session id of that wrapper.

### 4.5 Durable per-account state on the server box

`~/.ccrc/account-state.json` (server box, 0600 atomic write — the `sessions.ts:370-373`
pattern) keyed by id: `{ mintedAt?, lastChecks?: HealthRow[], connectMethod? }`. It is a
cache of measurements, never a source of truth: losing it loses freshness text and
nothing else.

`lastChecks` is newest-first and **capped at 3** (the writer truncates; the reader tolerates
any length, absence included). One slot was the first draft and the UI review falsified it: the
account fold's whole reason to exist at 2 a.m. is answering *when did this break?*, and a single
`lastCheck` cannot — it can say what the last probe found, never that the lane was `✓ ok` ninety
minutes earlier. A bounded array in a cache that is explicitly disposable costs one line and
answers the question; the UI quotes the cap and the file rather than asserting a number (§12.4). It is NOT in `coord.db` (ring-fenced to coordination) and NOT on the
roster (user-owned, declarative).

### 4.6 Mirror fixes folded in

`shared/roster-json.mjs` gains the `hidden` type gate it lacks and stops passing
`secretsFile` through un-validated for non-generated kinds; `gen-accounts.test.ts` gets
a CASES row for each so the byte-agreement pin actually covers them. `ccd`'s
`_ws_least_loaded` finally consumes `CCRC_MEASURED` (the August spec's undone item) so a
`telemetry: 'none'` lane is never auto-picked on a permanent zero — this is the one ccd
behaviour change and it ships agent-first with the rest.

## 5. The fleet verb: `ccrc account`

Bash in `ccd/ccrc` (dispatch case + usage line), node for JSON (`deploy/gen-*.mjs`
pattern), shipped agent-first by `deploy.sh agent` and `ccrc install`. Every subcommand
prints exactly one JSON object on stdout and exits 0/1/2 (`_ccrc_die` table); stderr
carries remedies; NOTHING it prints ever contains a secret (pinned by a canary test that
feeds a marked token on stdin and greps every output stream and every file outside
`~/.cc-secrets`).

| subcommand | stdin | what it does on the fleet box | result |
|---|---|---|---|
| `add --id X --provider P --label L --hue H [--suffix S] [--base-url URL] [--models JSON] [--method login\|paste\|setup-token] [--credential -]` | the secret, when a credential is pasted | `--method login` (the anthropic default) writes NO secrets file and NO `secretsFile` roster field: the credential is the config dir's own `.credentials.json`, so `add` provisions the home and hands off to `auth-start --method login`. `--method paste` is the token lane and keeps the 0600 file. Refuse on: bad id, duplicate id, suffix collision, suffix outside `.claude*`, unknown provider, external provider (declare instead), `base-url-required` (provider `compatible` with no `--base-url`), `base-url-insecure` (a scheme other than `https:` on a non-loopback host), `base-url-credentials` (userinfo in the URL); then: write `~/.cc-secrets/X-P.env` 0600 (dir 0700), append the roster entry, regenerate accounts.sh, run the wrapper converge for X only, create `~/S` if absent and merge `settings.json` (env block for openrouter; hooks + statusline; skills), **`touch $REG/X-disabled`** so a never-probed lane cannot take placement, and return `{ok, roster}` | roster JSON |
| `declare --id X [--provider P] [--base-url URL] --label L --hue H` | — | refuse unless `~/.local/bin/X` is an undeclared, id-shaped executable (the doctor `wr_cands` rule, `-ef` alias collapse — ids and launchers are the same name by construction); append an `external` entry with the optional provider (`openai` for the ChatGPT launcher, `openrouter` or `compatible` for the hand-written api-key lanes, absent = undeclared) and the optional `--base-url`, which is DECLARATIVE here — it records where somebody else's launcher points so the card can say so, and ccrc never writes that launcher; regenerate; **`touch $REG/X-disabled`**, the same rule `add` obeys | roster JSON |
| `credential --id X --credential -` | the secret | re-auth by paste, for TOKEN lanes only — a login lane has no secrets file to replace and re-auths by re-running `auth-start --method login`, which overwrites its `.credentials.json` in place (`not-managed` names the difference). Refuse unless X is generated or upstream-with-declared-secretsFile; write the file atomically (tmp + rename, 0600); no roster change. The answer lists the LIVE sessions on X (`live:[ids]`): a wrapper sources the file at exec time, so a rotated token reaches a pane only when that pane is recreated — the UI says so and offers the existing per-session restart (stop → ensure) one tap at a time, never a fleet-wide sweep | `{ok, live}` |
| `check --id X` | — | the probe: `timeout 60 "$WRAPPER_DIR/X" -p "Reply with the single word ok." --output-format json --max-turns 1` in a scratch cwd; classify on `api_error_status`/`terminal_reason` (never `subtype`), exit code and the timeout; for `openai` the probe goes through the launcher exactly the same way (it lazily starts the stack) | `HealthRow` |
| `enable --id X` / `disable --id X` | — | rm / touch `$REG/X-disabled` (the existing `_lane_enabled` file); refuse `disable` on the last enabled home-able lane | `{ok, disabled}` |
| `remove --id X [--keep-credential]` | — | refuse: upstream, last home-able, any live registry row whose current wrapper is X (`live-sessions`, listing ids). Then, IN THIS ORDER: (1) rehome every non-live registry row whose `wrapper` or `home` field is X onto the upstream (`_reg_set … wrapper/home`), reported as `rehomed:[ids]` — a supervised row left pointing at a gone wrapper would respawn into a Restart loop; (2) run the hooks/skills installers' remove sweep for X's home WHILE X is still in `accounts.sh` (the sweeps iterate `CCRC_ACCOUNTS`, so a roster edit first makes the home un-nameable to its own cleanup); (3) drop the roster entry and regenerate `accounts.sh`; (4) delete the wrapper only when `verifyMarker` says `ccrc-unmodified` (an edited one is left and named), the credential file unless `--keep-credential`, `~/.cc-limits/X.json`, `$REG/X-disabled`, `$REG/X.hookstate.json`; KEEP the config dir | `{ok, roster, rehomed:[…], kept:[…], removed:[…]}` |
| `auth-start --id X --method login\|setup-token\|openai-login` | — | §6. `login` runs in a pipe with no pane and no pty; the two pane methods spawn `cc-auth-X` | `{ok}` |
| `auth-status --id X` | — | reads the status file | `AuthStatus` |
| `auth-cancel --id X` | — | kills `cc-auth-X`, marks cancelled | `{ok}` |
| `candidates` | — | undeclared id-shaped executables in `~/.local/bin` with their sizes (never contents) — the pick list for `declare` | `[{name,bytes}]` |
| `roster` | — | the fleet box's `accounts.json` verbatim | roster JSON |

Per-home provisioning on `add` is done by the verb, not by the install spine: after
`accounts.sh` is regenerated it creates `~/<suffix>` if absent, then runs the four
standalone installers already on the box (`~/.cc-sessions/install-session-hooks.sh`,
`install-coordinator-skill.sh`, `install-worker-skill.sh`, `install-graphify-skill.sh`),
which converge EVERY rostered home idempotently and need no agent restart. The
out-of-tree operator plumbing (`claude-usage.timer`'s hook, `claude-prune-versions`'s
keep list) is named in the verb's stdout as `operator-steps:[…]`, never done.

**Both connect verbs leave the new lane SWITCHED OFF.** `add` and `declare` each write
`$REG/<id>-disabled`, so a lane whose credential nobody has measured cannot be picked by
`_ws_least_loaded` the moment it is rostered. The UI's done step says so and offers Enable
beside it, so the two connect flows leave the box in identical states. (Surfaced by the UI
review: the canvas had been drawing "the lane stays off until you enable it" against a verb
that wrote no marker.)

Rules every subcommand obeys: `--credential -` is the ONLY spelling that reads a secret
and it dies on empty stdin (fail closed against a caller that forgot the body); ids are
validated against `ID_RE` before any interpolation; every write is tmp + rename; the
whole `add`/`remove` is ordered so that the roster entry lands LAST on add and FIRST on
remove, and a failure after the secret write leaves a 0600 file a retry overwrites and
nothing else. The supervisor sweep is NOT run by this verb (only `_upd_sweep` may
try-restart units, ruling 2026-08-21): live supervisors keep their sourced roster, which
is fine because every ccd verb the PWA drives re-execs a fresh `ccd` that sources the
regenerated file, and the one consumer that matters for placement (`cmd_ensure` inside
`supervise`) ignores accounts it cannot place on anyway.

## 6. The auth pane (mint an Anthropic token; OpenAI login)

**MEASURED 2026-09-07 on the fleet box (Claude Code 2.1.263), and it moved this section's
foundations.** `claude` has an `auth` subcommand — `login [--claudeai|--console|--email|--sso]`,
`logout`, `status [--json]` — and the login flow is drivable without a terminal at all:

| command | needs a pty? | what it does |
|---|---|---|
| `claude auth login --claudeai` | **no** | prints `Opening browser to sign in…`, then the full authorize URL, then `Paste code here if prompted > ` and blocks on **stdin**. With `stdin=/dev/null` and stdout to a file it produced all of that and waited; no tty involved. |
| `claude setup-token` | **yes** | an Ink full-screen TUI. With no tty it produced **zero bytes** and hung. |

Both use the same OAuth shape — `code=true`, PKCE `S256`, and
`redirect_uri=https://platform.claude.com/oauth/code/callback`, a **hosted** page that shows the
operator a code. Neither needs a callback to reach the fleet box, which is what makes driving
either of them from a phone possible at all.

The scopes are where they differ, and it decides which is the default:

| | `setup-token` | `auth login --claudeai` |
|---|---|---|
| scope | `user:inference` — that is the whole list | `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload` |
| lands in | stdout, as the `CLAUDE_CODE_OAUTH_TOKEN=…` line → `~/.cc-secrets/<id>-oauth.env` 0600 | `~/<configDirSuffix>/.credentials.json`, 0600, written by Claude Code itself |
| lifetime | long-lived, self-described as 1 year | a session credential Claude Code refreshes |

`user:sessions:claude_code` is the scope Remote Control needs, so **a login lane is a
first-class lane and a setup-token lane is inference-only** — and every `~/.claude*` config dir
on this fleet already carries a 0600 `.credentials.json`, i.e. every lane the operator runs
today was made by logging in. A design that defaulted new lanes to `setup-token` would have made
every lane it created second-class against every lane that already exists. **`login` is
therefore the default method, `paste` is the portable alternative the operator asked to keep,
and mint-in-a-pane is a convenience on top.**

**What this deletes.** `login` and `paste` need no pty, so they need no `script(1)`, so they
carry no util-linux dependency and no BSD/GNU divergence: they run identically on Linux and
macOS. The helper spawns the command with a pipe on stdin, reads stdout line-buffered, and
writes the code back down the pipe. Only `setup-token` still needs a terminal, and it is now the
one optional path rather than the primary one (§13/§15.9).

The pane is still how a `setup-token` mint is run, because the only detached-process vehicle the
whitelist can create is a tmux pane, and only ccd may create one (§1.6). So
`ccrc account auth-start --method setup-token` calls `ccd account-pane --id X`
(a NEW ccd verb, flag-anchored, enrolled in `REQUIRED_VERB_FLAG`, advertised in `ccd
caps`, granted in `EXEC_WHITELIST.ccd` with a `CCD_ARGV` mint and a whitelist-subset
sample — this is the one exec-whitelist addition in the design, and it is not a
coordination verb, so CLAUDE.md's "zero new ccd verbs for coordination mutation" does
not bind it) which runs `_tmux_new_session -d -s cc-auth-X -x 120 -y 40 "exec
'$HOME/.local/bin/ccd-account-auth' 'X' '<method>'"` — through `_tmux_new_session` so the
pane lands in the capped scope, and NOT through `_spawn`, so no ccd typer ever presses
Enter into it.

`ccd/ccd-account-auth` (new executable, shipped beside `ccd-graph-sweep`) runs one of three
methods, and only one of them needs a terminal:

| method | vehicle | config dir it drives | credential lands |
|---|---|---|---|
| `login` | a plain pipe — **no pane, no pty, no `script`** | the lane's own `~/<suffix>` | `~/<suffix>/.credentials.json` (Claude Code writes it, 0600) |
| `setup-token` | a tmux pane under `script` | a throwaway `~/.ccrc/auth-scratch/<id>` | the captured line → `~/.cc-secrets/<id>-oauth.env` 0600 |
| `openai-login` | a tmux pane under `script` | n/a — the external launcher's own program | the launcher's, never ccrc's |

- for `login` it runs `claude auth login --claudeai` with `CLAUDE_CONFIG_DIR=~/<suffix>` (the
  lane's REAL config dir — the point is to sign that dir in) and `CLAUDE_CODE_OAUTH_TOKEN`
  unset, stdin on a pipe the helper owns, stdout read line by line. It needs no pane at all,
  so it also never risks a ccd typer pressing keys into it;
- for `setup-token` it runs under `script -qfc … /dev/null` with
  `CLAUDE_CONFIG_DIR=~/.ccrc/auth-scratch/<id>` (a throwaway dir: `setup-token` stores nothing
  and needs no account state, a scratch dir carries no `settings.json` so no ccrc hook can fire
  from the pane, and the launcher sources the upstream token only for the default dir) and
  `CLAUDE_CODE_OAUTH_TOKEN` unset; for OpenAI, `<launcher> login`, which runs the launcher's own
  program, not Claude Code;
- **the URL line is wrapped in an OSC-8 hyperlink**, so the raw URL appears TWICE on it (once
  as the escape's target, once as the visible text). The reader strips `\x1b]8;;…\x07`/`…\x1b\\`
  first and takes the first `https://` run, rather than regexing the raw bytes and capturing a
  doubled string — pinned by a fixture built from the captured bytes;
- forwards the inner output to the visible pane LINE-FILTERED: the line carrying
  `export CLAUDE_CODE_OAUTH_TOKEN=` (and any line matching the token's own shape) is
  captured to `~/.cc-secrets/X-oauth.env` (0600, tmp + rename) and replaced on screen by
  `[token captured to ~/.cc-secrets/X-oauth.env]`; the sign-in URL line and, for
  `login`, the user-code line are additionally written to the status file;
- publishes `~/.cc-sessions/.auth/X.json` — `{state: 'starting'|'url'|'waiting-code'|
  'exchanging'|'done'|'failed'|'expired'|'cancelled', url?, userCode?, error?, updatedAt}`
  — a dot-directory so the registry's `<id>.<field>` globs never see it, under the one
  read root the agent already has (`.cc-sessions`), tailable with `tailOpen` which waits
  for a not-yet-existing file;
- forwards the CODE typed by the operator: the server sends it with the already-granted
  `tmux send-keys -t cc-auth-X -l <code>` + `Enter` (`Tmux.target()` prefixes `cc-`, and
  the new route validates `X` with `ID_RE` first — the pty route's missing id check is
  not copied);
- bounds itself: `timeout 600` on the inner command, state `expired` on timeout; the
  verb is idempotent (`has-session cc-auth-X` → refuses with `auth-in-progress`, or
  `--cancel` kills it); on exit the pane self-destructs;
- **is portable for `login` and `paste`, and platform-gated only for the pane methods.**
  `login` and `paste` touch no `script(1)`, so macOS gets the DEFAULT path and the fallback path
  with no caveat at all. Only `setup-token` and `openai-login` need a terminal, and there the
  helper takes the tree's existing platform idiom rather than refusing: `CCD_OS` is already set
  from `$OSTYPE` first and `uname -s` as a fallback (`ccd/ccrc:110-113`, `ccd/ccrc-adopt:94-97`),
  so the spawn is one branch — util-linux `script -qfc "<cmd>" /dev/null` against BSD
  `script -q /dev/null <cmd> <args…>`, whose argument order differs. **The BSD arm is UNVERIFIED
  from this box** (it is Linux); it is written as a branch with a Darwin acceptance test rather
  than asserted, and if the arm turns out wrong on a real Mac, `auth-start --method setup-token`
  answers `pane-unsupported-here` THERE ONLY and login and paste are unaffected. That is the
  whole of the Darwin exposure now, and it costs a convenience rather than the feature — which
  is why the earlier "Linux-only in v1" ruling is withdrawn (§15.9).

The terminal drawer can attach to `cc-auth-X` today (no registry check) and stays
available behind a disclosure for the operator who wants to see the raw pane; the guided
view reads the status file. The token never reaches the pane, tmux scrollback, the
drawer, `Dialog.raw` or the push payload, because it never reaches the tty — pinned by a
mutation test that runs the helper against a fake `claude` printing a canary token and
asserts the canary appears in the 0600 file and nowhere else.

## 7. Server routes, ports and gating

| route | body | refusals (code) | answer |
|---|---|---|---|
| `POST /api/accounts` | `{id,label,hue?,provider,method:'login'\|'paste'\|'pkce'\|'pane'\|'declare',credential?,launcher?,baseUrl?,models?,suffix?}` | `bad-request`, `invalid-id`, `duplicate-id`, `suffix-collision`, `suffix-outside-read-root`, `unknown-provider`, `external-provider-use-declare`, `base-url-required`, `base-url-insecure`, `base-url-credentials`, `hue-taken` (soft: reassigns unless `--hue` explicit), `secret-over-plain-http`, `unsupported` (agent/verb absent), `fleet-disconnected` | `{ok, roster, health?}` — the route runs the smoke test before answering when a credential landed |
| `POST /api/accounts/:id/credential` | `{credential}` | as above + `not-managed` | `{ok, health}` |
| `POST /api/accounts/:id/check` | — | `unknown-account`, `unsupported` | `HealthRow` |
| `POST /api/accounts/:id/enable` / `disable` | — | `unknown-account`, `last-enabled-home` | `{ok, disabled}` |
| `POST /api/accounts/:id/remove` | `{confirmId, keepCredential?}` | `unknown-account`, `confirm-mismatch`, `upstream`, `last-home-able`, `live-sessions` (with `sessions:[ids]`) | `{ok, roster, removed, kept}` |
| `POST /api/accounts/:id/auth/start` | `{method}` | `auth-in-progress`, `unsupported` | `{ok}` |
| `GET  /api/accounts/:id/auth` | — | — | `AuthStatus` (poll; `/ws/fleet` later) |
| `POST /api/accounts/:id/auth/code` | `{code}` | `no-auth-pane`, `bad-code` | `{ok}` |
| `POST /api/accounts/:id/auth/cancel` | — | — | `{ok}` |
| `GET  /api/accounts/candidates` | — | — | `[{name,bytes}]` |
| `GET  /api/accounts/openrouter/models` | — | `unsupported`, `catalogue-unreachable` (soft: the UI falls back to a validated field) | `{models:[{id,label,contextLength}], fetchedAt}` — a SERVER-side, cached read of OpenRouter's public catalogue (§4.3). Never fetched from the browser, never a source of truth. OpenRouter-only by construction: there is no `compatible` equivalent to fetch, and the route is not generalised to take an arbitrary endpoint — that would make the server fetch a URL the request names |
| `POST /api/accounts/openrouter/exchange` | `{code, codeVerifier}` | `exchange-failed` | `{key}` is NOT returned; the route chains straight into `POST /api/accounts` semantics with the key and answers as that route does |
| `GET /api/accounts` | — | — | gains `connect: {openrouterPkce, secretsAllowed, secretsReason?}` (§10), `health?: Record<id,HealthRow>` and each `RosterWire` gains `provider`, `kind`, `telemetry`, `managed` (has a ccrc-writable credential) and `baseUrl?` (an endpoint, not a secret — the card shows its host) — all additive, absence-permitting, `FLEET_PROTO` untouched |

Gating: every route above is a session-gated PWA write (D-1240 class): NOT in `EXEMPT`,
not box-token, registered in `server.ts` so `auth-gate.test.ts`'s scanner sweeps it (its
two hand-pinned cardinals move; no census number word moves because no handler names
the box token). Secret-bearing routes (`POST /api/accounts` with a credential,
`/credential`, `/openrouter/exchange`, `/auth/code`) additionally refuse
`secret-over-plain-http` unless `cfg.authEnabled && new URL(cfg.origin).protocol ===
'https:'` OR `cfg.host` is loopback — config-stated, the `cookiePolicyProblem` pattern,
because the request cannot tell.

**The same condition must reach the UI as a STATEMENT, not as something the browser works
out.** `GET /api/accounts` therefore carries `connect: { openrouterPkce: boolean,
secretsAllowed: boolean, secretsReason?: 'plain-http' }` — additive, absence-permitting, an
older server simply omits it and the UI offers everything as it does today. The PWA renders
that field and never reasons from its own `location`: the page's origin and `cfg.origin` are
different quantities (a reverse proxy is the normal case), so a UI that greys a control because
`location.protocol === 'http:'` is inventing a fact the server alone holds. This was a UI-review
finding: the dark-box frames had been attributing the refusal to a read the browser did of
itself.

Ports: `AccountOps` (L2) is `{ run(sub: AccountSub, argv: readonly string[], stdin?:
Buffer): Promise<AccountResult> }` where `AccountSub` is the closed union from §5;
`remoteAccountOps` sends `{t:'req', op:'account', sub, argv, stdinB64?}` with a per-sub
timeout (`check` 90 s, everything else 120 s); `localAccountOps` spawns
`$HOME/.local/bin/ccrc account …` with `input`. The agent's handler spawns the SAME
absolute path — `resolveSpawnCmd` maps only bare `ccd`, and the unit's PATH lacks
`~/.local/bin` (`agent/src/server.ts:227-232`) — with the secret on stdin, an 8 MiB
output cap, and the sub's timeout; the stdin buffer is zeroed after the spawn. The
agent never inspects the payload beyond shape: the closed sub list, `ID_RE` on every
id, base64 on `stdinB64`, and NO free argv — the verb's flags are built by the agent
from typed fields, so a compromised server cannot pass `--force` or a path. Capability: `ccd caps` advertises the token `account-v1` when `~/ccrc/ccd/ccrc`
implements the verb (ccd and ccrc ship in one tree, so ccd can answer for it) — a caps
token because caps are RE-POLLED every 60 s over the `caps` op without a reconnect
(`server/src/watch.ts`, `refreshcaps.ts`), whereas a `ready`-frame field is read once
per connection; the spelling fits `parseCcdCaps`'s `^[a-z][a-z0-9-]*$`. The server gates
every account route on `capSupported(state, 'account-v1')` — the REFUSING no-evidence
polarity, because a wrong guess here is a silent secret write — and answers `501
unsupported` (the `coord-pause` pattern). An agent older than the op answers
`bad-request` to the unknown op, which the adapter also maps to `unsupported`; both
halves fail closed, and the UI greys every mutation with the `unsupported` sentence
until the fleet box is deployed.

Roster reload: every mutating sub returns the fleet box's roster JSON, and
`reloadRoster(json)` in `server/src/config.ts` re-parses it, replaces `cfg.roster` on
the shared config object (every reader dereferences it per call, §1.2), writes the
server box's `~/.ccrc/accounts.json` atomically (0644, tmp + rename) and recomputes
`ownRosterFp` (now a `let` behind a getter). The same code runs in both modes: in
remote mode the write makes the server box's copy a MIRROR of the fleet box's (the
fleet box is the source of truth from this spec on; `deploy.sh`'s seed-once rule is
unchanged, it only ever seeds an absent file); in local mode the verb already wrote
that very file and the write is byte-identical, so the mirror step is a no-op the test
suite can still observe. A `RosterError` from the returned JSON is a 502 that names the
fleet box, and the in-memory roster is left as it was.
`FleetHostBanner` flips to `agreed` on the agent's next `ready` — the route also asks
the agent for a fresh `rosterFp` through the existing `caps`-style re-poll by adding it
to that op's answer (additive), so the banner does not lie for a reconnect's duration.

## 8. Health

One probe for every provider: the lane's own wrapper answering one tiny `-p` request
with `--output-format json` under a hard timeout. Classification (server-side, L1,
`accounts/health.ts`, pure over the verb's JSON):

The verb runs `CLAUDE_CODE_MAX_RETRIES=0 timeout 60 "$WRAPPER_DIR/<id>" -p "Reply with the
single word ok." --output-format json --max-turns 1` from `~/.ccrc/probe/` (a dedicated
scratch cwd: `-p` writes a transcript under the lane's `projects/<cwd>/`, and that
transcript must land somewhere recognisable, never inside a real project's history).
`CLAUDE_CODE_MAX_RETRIES=0` is load-bearing and MEASURED: without it Claude Code retries a
401 on an exponential backoff (`attempt N/11`, eight requests in 40 s against a loopback
stub) and the probe cannot answer inside its bound; with it a 401 answers in 136 ms and
a refused connection in 167 ms, both at `total_cost_usd: 0`.

| verdict | evidence (measured shapes, 2.1.261) |
|---|---|
| `ok` | exit 0 and `is_error !== true` |
| `auth-dead` | `is_error: true`, `terminal_reason: 'api_error'`, `api_error_status: 401` (result text `Not logged in · Please run /login`); or the launcher's own `not logged in` on stderr |
| `unreachable` | `is_error: true`, `terminal_reason: 'api_error'`, `api_error_status: null`, result text beginning `API Error: Connection refused` / DNS / 5xx |
| `timeout` | the 60 s bound hit (for `openai` this is the honest answer to a refresh that fell into a device-code prompt) |
| `unknown` | anything else — never reported as ok |

`subtype` is `'success'` on every one of those failures and is never read. `--bare` and
`CLAUDE_CODE_SIMPLE` are never passed: bare mode does not read the settings env block or
the OAuth token, so a bare probe would measure nothing the lane actually uses.

**Two checks, not one, and only one of them costs anything.** `claude auth status --json` in the
lane's config dir answers `{loggedIn, authMethod, apiProvider, …}` — MEASURED on an
unauthenticated scratch dir as `{"loggedIn": false, "authMethod": "none", "apiProvider":
"firstParty", …}` — instantly, with no inference and no billing. It answers *is this lane's
credential alive*, which is the question `auth-dead` exists for. The `-p` probe answers a
strictly larger question — *can this lane actually do work through whatever base URL and model
map it carries* — and costs a real request.

**Its exit code is not the answer, and reading it as one is the trap.** MEASURED 2026-09-07 on
the same scratch dir: `auth status --json`, `auth status` and `auth status --text` all exit **1**
when `loggedIn` is false — the command SUCCEEDED and reported a fact, and an exit code read as
"the probe failed" would turn every signed-out lane into `unknown`. The reader parses stdout and
treats a non-zero exit with parseable JSON as an ANSWER; only unparseable output is a failure.
Two more shapes measured with it: with stdout not a tty, `--json` and the bare form are
**byte-identical** (so the flag is passed for intent, not for effect, and the reader must not
assume the flag is what makes it JSON), and `--text` gives the one human line
(`Not logged in. Run claude auth login to authenticate.`), which is what the card quotes.

So `check` runs `auth status` FIRST and short-circuits: `loggedIn: false` on an anthropic lane is
`auth-dead` with no inference spent. Only a lane that claims to be logged in goes on to the
probe. That makes the cheap answer cheap and leaves the expensive one for the case it is the
only thing that can settle. (`auth status` is Anthropic-only: an OpenRouter lane authenticates
through the settings env block, not through Claude Code's own credential store, and the
`openai` lane's credential is the launcher's — both go straight to the probe.)

Never automatic: no timer, no boot probe (a probe is an inference request billed to the
operator and, on `openai`, can start a stack). `HealthRow = {verdict, measuredAt,
detail?}`; `measuredAt` is server time at the verb's exit. `not-measured` is the wire's
absence, rendered as words.

## 9. Removal and rehoming

Refusals are measured on the fleet box at the moment of the call, never from the PWA's
snapshot: `upstream` (roster kind), `last-home-able` (the roster after removal would have no
lane that is both `homeAble` **and enabled** — the placer would have nowhere to land),
`live-sessions` (any
registry row whose `wrapper` field is X and whose tmux session exists; the answer lists
the ids so the UI can offer the existing swap flow per session and re-try). What is
deleted and kept is stated in the answer and repeated in the UI before the typed-id
confirmation; the config dir is kept unconditionally (transcripts are the operator's
history, and `~/.claude-gpt` is a separate mount here — `rm -rf` of a config dir is not
something this design ever does). An `external` lane's launcher is never touched and
its credential is not ccrc's to delete; the UI omits the checkbox for it.

**A login lane's credential is INSIDE the config dir this verb keeps unconditionally, and that
changes what the checkbox means.** A token lane's credential is `~/.cc-secrets/<id>-oauth.env`,
which removal can delete. A login lane's is `~/<suffix>/.credentials.json` — inside the dir kept
because it also holds the transcripts. Deleting the dir to get the credential is not something
this design does, and leaving a live subscription credential on disk under a lane nobody can see
any more is not acceptable either. So for a login lane the checkbox is **"sign this lane out"**,
and it runs `claude auth logout` in that config dir (falling back to unlinking
`.credentials.json` if the verb is absent), keeping every transcript. Three lanes, three honest
sentences: delete the token file, sign the lane out, or nothing to do because the credential was
never ccrc's.

**Why `last-home-able` reads the kill-switch markers as well as the roster.** The first draft
read the roster alone, while `disable`'s own refusal (`last-enabled-home`, §5) already read
both — and a home-able lane that is switched OFF is not a place the placer can land, so the
weaker predicate leaves exactly the hole it exists to prevent. Removal adopts disable's
predicate and keeps its own code; its refusal names the roster AND the markers, both re-read at
the moment of the call. (Operator decision §15.18 — leaving removal weaker than disable is
defensible if you would rather removal never consulted a marker.)

## 10. OpenRouter PKCE

When `cfg.authEnabled` and `cfg.origin` is https, `GET /api/accounts` carries
`connect: { openrouterPkce: true, callback: '<origin>/accounts/connect/openrouter' }`
(additive). The PWA generates `code_verifier` in the browser, keeps it in
`sessionStorage` keyed by a nonce, opens
`https://openrouter.ai/auth?callback_url=<callback>&code_challenge=<S256>&code_challenge_method=S256`,
and on return (an SPA route the router already handles by path) posts `{code,
codeVerifier}` to `/openrouter/exchange`, which exchanges at `POST
https://openrouter.ai/api/v1/auth/keys` (no secret, no registration) and continues as
an add with the key on stdin — the key is never returned to the browser. The paste path
is always offered beside it. Whether the exchange endpoint answers browser CORS is
unmeasured and irrelevant: the exchange is server-side by design so the key has one
transit path, the same one a pasted key takes.

## 11. OpenAI (ChatGPT subscription) scope

ccrc does not own the LiteLLM stack (operator ruling). What the UI does: DECLARE an
existing launcher as an OpenAI lane (`candidates` → `declare`), LOG IN through the pane
(`auth-start --method login`, the same helper; the user code is not a secret and is
shown), CHECK (the probe, which lazily starts the stack), ENABLE/DISABLE (the marker —
the live `gpt` lane's actual state), REMOVE (roster row and markers only). No API-key
path, no LiteLLM config writer, no `ccgpt-usage` timer management. The row says
"external launcher — ccrc does not manage its credential" and usage reads "no telemetry
for this lane" instead of bars.

## 12. The UI

### 12.1 How this design was chosen

Three complete UX concepts were built independently against the same brief and the same
shipped tree — **A "Ledger"** (operator-first, dense, everything folds in place), **B
"Stepper"** (guided, a step rail, progressive disclosure) and **C "Console"** (risk-first,
every account shown as *what was measured* against *what is merely declared*) — and scored
by three judges with fixed lenses, each verifying its claims against `tokens.css`,
`primitives.css`, `fleet.css`, `chat.css` and `audit.mjs` rather than against the concepts'
own rationales.

| lens | A — Ledger | B — Stepper | C — Console |
|---|---|---|---|
| one-thumb usability and accessibility | 7 | **7.5** | 6 |
| phosphor-and-ink fidelity, amendment discipline | 7 | 6 | **8** |
| state honesty and failure legibility | 6 | 7 | **9** |
| **total** | 20.0 | 20.5 | **23.0** |

**C is the base.** Its two-register account card — what the roster DECLARES above a rule,
what a probe MEASURED below it, with an age on every measured line — makes the distinction
this feature exists to protect the *structure* of the screen rather than a caption. It is
also the only concept that drew the unarmed remove state, a measured pre-check before
deletion, and a "token stored" that still reads `health — not measured`.

C lost exactly one lens, and for exactly one reason: every operation on a healthy lane cost
`tap card → navigate → operate → back, top-left`. **That route is demoted here.** Seventeen
merge decisions follow, each of them a judge's measured finding rather than a fresh opinion;
the ones that change the shape of the product are called out below and the whole set is
carried on the canvas.

> The canvas (**55 frames in 9 groups** — 54 at 390×844 and one at 1200px, both themes) is the
> visual authority for everything in this section. Link in the handoff; it is not a tracked
> artefact. The count is measured off the built file, not carried: `54` elements matching
> `class="phone"` plus the one `phone--desk`.

### 12.2 Where it lives

The `/accounts` screen already exists (`pwa/src/screens/AccountsScreen.tsx`) and already
renders every rostered lane with its two limit windows, its disabled reason and the passkey
block. **This design extends that screen; it does not add a second one.** Two additions to
the route table only:

- `/accounts/:id` — the *full record* (§12.4), reached from inside a fold, never required
  to operate;
- `/accounts/connect/openrouter` — the PKCE return path (§10), an SPA route the existing
  path router already handles.

**The connect affordance lives on this screen and nowhere else** (operator ruling 2026-09-07).
It is the last line of the accounts list — one door, inside the screen that owns accounts — and
it appears in no global surface: no bottom bar, no app-level action, nothing on the fleet screen
or in the sidebar. An earlier draft also pinned a second copy of the door in an
absolutely-positioned bottom `.dock`, argued from reach; a persistent bottom bar is app chrome by
construction, and it made a screen-scoped, rarely-taken action read as general PWA furniture.
That copy is gone. Measured, it cost ~96px of every visit to this screen plus the clearance rule
that stopped the last real row hiding under it — the list frame's content fell from 1504px to
1330px on its removal alone — and what it carried was a SHORTER statement of state the in-list
door already made in full (`13a`'s docked copy read "openai only here" beside an in-list door
reading "openai only — the server reports secrets off on this origin"). One fact said twice,
once lossily, is the defect this design refuses everywhere else. The desktop frame had already
reached the same conclusion from the other side: at 1200px the door moves into the header and
nothing is pinned, "because a second door would be furniture, not reach".

Ring placement is unchanged from §3: the screen is L4 delivery, it decides nothing, and
every refusal it renders is a code the server measured on the fleet box.

### 12.3 The four health readings

Health is a **measurement with a timestamp**, and the vocabulary has four members and no
fifth. `StatusDot`'s hues and glyphs mean *session* state and may not be applied to an
account (`DIRECTION.md`, hue governance), so health gets its own language, and that language
is ink — never a status hue on an account, never a glow.

| reading | when | treatment | example |
|---|---|---|---|
| `✓ ok` | exit 0, `is_error !== true` | `--ink-primary`, mono | `✓ ok · 14:04:12 · 4m ago · 1.4 s` |
| `— not measured` | the wire's absence: no probe has run | `--ink-tertiary` in a **dashed slot** | `— not measured · no probe yet` |
| `~ inconclusive` | `unreachable`, `timeout`, `unknown` | `--ink-secondary` on `--bg-raised`, evidence beside it | `~ unreachable · ECONNREFUSED · 0.2 s · 14:08:14` |
| `✕ auth dead` | `api_error_status: 401` | **reversed ink slab** — the shipped `.sess-line--active` idiom (`fleet.css:791`), reversing to the CARD's ground rather than the page's: `--bg-surface` on `--ink-primary`, 15.68 / 16.58, label semibold. Achromatic. | `✕ auth dead · HTTP 401 · 12:07:40 · 2h ago` |

Two rules make this vocabulary honest, and both were failures the panel measured:

1. **Only the 401 is loud, because only the 401 is a fact about the credential.** A probe
   that could not reach the provider learned nothing about the token; rendering it with the
   same weight as a dead credential is a lie the operator pays for at 2 a.m. Every
   inconclusive outcome carries the sentence *"Nothing was learned about the token — it may
   be fine."*
2. **A measurement that RAN is never written back as "not measured."** A probe that timed
   out at 14:09:02 reads `~ timed out · 60 s · 14:09:02`. Erasing a measurement to the
   never-probed state is the cardinal sin of this surface.

The slab carries one more borrowing, and it is the shipped rule's own correction rather than
a new idea: meta *inside* the slab steps to `--edge-strong` (9.27 / 9.91), not `--ink-tertiary`,
because `fleet.css:800-830` already records that `--status-*-text` and the account hues are
tuned for `--bg-surface` and die on the reversed ground — 1.47:1 for busy-text, 1.46:1 for an
account hue. A real ink step survives there; a pretence does not.

Loud is achromatic on purpose. A red badge standing on a list row is glanceable from across
the room — the property `DIRECTION` reserves for light, and light is reserved for living
things. The reversed slab is exactly as loud and carries no hue, so **this design proposes
no new colour token at all** (§13).

Health is never automatic. There is no timer, no boot probe, no probe-on-enable: a probe is
an inference request billed to the operator and, on the OpenAI lane, can start a stack
(§8). The screen says `— not measured` for as long as that is true.

### 12.4 The surfaces

**The list** is the screen. Its header carries a *measured* roll-up — `5 accounts · 1 off ·
1 auth dead` — never a declared word laid over measured state ("5 connected" over a dead
lane is a bug, not a summary). Its vocabulary is the health vocabulary: a lane reading
`~ inconclusive` is counted as such (`5 accounts · 1 off · 1 inconclusive`) and never folded
into either the healthy count or the dead one, because the whole point of that reading is that
nobody knows yet. A clause is omitted when its count is zero rather than printed as `0`. Each lane is one card in the shipped `.accounts-row` clothes
(`--r-md`, `--edge-subtle`, `--sp-3`) — not the session card's radius, shadow and padding,
whose right-aligned-status slot the eye has already learned to read as a session lamp.

Above the rule: what the roster declares — the account chip in its own hue with the id in
mono, the label, the kind and provider, `home-able` (attributed: *from the roster*), and the
kill switch's state. Below a 2px `--edge-strong` rule: what was measured — the health
reading with its absolute time, its age and its latency; the telemetry reading with *its own,
separate* age; and the custody line naming where the credential lives and that it is never
shown. **Custody varies by connect method and the card says which**: a signed-in lane reads
`credential · ~/.claude-c/.credentials.json · 0600 · written by Claude Code · never shown`, a
token lane reads `token · ~/.cc-secrets/claude-c-oauth.env · 0600 · fleet host · never shown`,
an external lane reads `held by the launcher · not ccrc's`. That is not decoration: it is the
difference between a lane ccrc can rotate and one it can only sign out, and it is what makes the
removal sheet's third sentence true (§12.9).

**An api-key lane's endpoint is a declared register too, and it is on the card.** A lane whose
`baseUrl` is not its provider's default reads its HOST in mono above the rule —
`endpoint · api.cortecs.ai`, `endpoint · 127.0.0.1:8642 · loopback` — beside the provider, where
the roster's other declarations live. It is not hidden behind the fold and not folded into the
custody line, because "which endpoint does this key go to" is a different question from "where
does the key live", and on a fleet where one lane can point at a vendor and the next at a
whitelist proxy on loopback it is the question the operator is actually asking. The default case
says nothing: an OpenRouter lane at `openrouter.ai/api/v1` and an Anthropic lane both draw no
endpoint line, because a register that is always the same value teaches the eye to skip it. The
full record shows the whole URL; the card shows the host, since the host is the part that
differs.

The two ages are kept apart everywhere. A lane whose credential is dead still shows its last
reported usage with the age of that reading (`8% / 29% · reported 2h ago`), because
"credential dead" and "no telemetry" are two different measurements. An empty bar reads as
0% at a glance; a lane whose launcher reports nothing says so in words — *"this launcher
reports no usage; bars are not drawn rather than drawn at 0%"* — and draws no track at all.

**The fold** is where every operation lives. The card expands in place (`--dur-base` 240ms,
`--ease-swift`) to the live sessions on the lane, the four operations as a row of 44px ghost
buttons with mono labels (`check · re-authenticate · move · remove`), and the kill switch with
its consequence stated beneath. Check is two taps. Flipping the switch is two taps and one tap
to reverse. Nothing navigates.

The operations are deliberately **not** keycaps. One of the losing concepts promoted the
terminal drawer's quick-key caps from keys to verbs, and the ink judge was right to call it
costume: those caps are literal keys a session answers to, and `DIRECTION`'s thesis is
*inherit, don't imitate* — "the `❯` is the one piece of terminal furniture that crosses into
the chrome; everything else stays modern." Keeping the caps in the drawer, where they are real
keys, costs this design one amendment it would otherwise have had to argue.

**The full record** (`/accounts/:id`) is the 2 a.m. screen: every register, the *previous*
health reading (`previous ✓ ok · 2026-09-04 18:02 · 1.9 s`) so "when did this break?" has an
answer on the surface, every path — wrapper, config dir, credential file, limits file,
kill-switch marker — and the settings-block keys the lane's `settings.json` carries. It is
reached from a `⌄ full record` line inside the fold and is never on the path of an
operation.

**Sheets** carry the connect, re-auth and remove flows. Each is a flex column capped at
`calc(100% - var(--sp-12) - var(--safe-top))` with a scrolling body, so a keyboard shrinks
the sheet rather than pushing its primary off-screen; each ends with its primary and offers a
*bottom* back affordance so the thumb never reaches the top; `--safe-bottom` is consumed by
every bottom-anchored rule. **No sheet ever closes itself on a timer** — a verdict that
removes itself before it is read is not a verdict, and `DIRECTION`'s reduced-motion clause is
"nothing vanishes".

**The terminal drawer** stays what it is: the raw pane behind a disclosure, for the operator
who wants to see it. The guided view reads the status file (§6); the drawer attaches to
`cc-auth-<id>` and shows the helper's substituted line where the token would have been.

### 12.5 Connecting a lane

One sheet per connect, reshaped by the provider chosen — not a wizard with a numbered rail.
The step rail that pane flows do need speaks in the machine's voice: mono words, each stamped
with its own clock, the identity collapsed to a chip line (`claude-c · team·c · green — tap
to edit`) while the pane runs.

| provider | the path | what the sheet says |
|---|---|---|
| **anthropic** | **sign in (default)**, paste a long-lived token, or mint one in a pane | the three are one radio group with their consequences on them, not a hidden default: sign-in reads *"a full lane — Remote Control works"*, the two token methods read *"inference-only token — Remote Control is not available on this lane"* (§15.8), said at the moment of choosing rather than discovered afterwards. At the validation moment, before anything is written, the sheet names what the choice will create: sign-in *"`claude-c` is free · will become the config dir `~/.claude-c` and the wrapper `~/.local/bin/claude-c`; the credential is Claude Code's own `.credentials.json` and there is no secrets file"*, the token methods *"…and `~/.cc-secrets/claude-c-oauth.env`"* |
| **openrouter** | PKCE when the origin is https and auth is armed; paste always; then the model step | when PKCE is not offered, the reason is a sentence, not a code — the server simply omits `connect.openrouterPkce` — and the paste path is right there. The model step does two jobs and says which is which: the four **routing** aliases (`opus` / `sonnet` / `haiku` / `subagent`) map what ccd and Claude Code ask for onto real ids, and the **allowlist** beneath is what the session picker will offer on this lane. The allowlist is a picker over OpenRouter's live catalogue with each model's context window beside it — served through the server, cached, with its fetch time shown like every other measurement on these screens — degrading to a validated text field with a sentence saying which of the two you are looking at. A note says provider filtering (which upstream may serve a request) is a different question and an OpenRouter account setting, not something ccrc enforces (§4.3) |
| **compatible** | paste a key, and state the endpoint | the same sheet as OpenRouter with the catalogue step degraded and one field added ahead of the key: **endpoint**, a URL field whose helper text is the gate itself — *"https, or http on loopback"* — and whose refusals are sentences (*"that endpoint is plain http and not loopback: the key would cross the network in clear"*, *"a URL is not a place to keep a key"*). The field is pre-filled with nothing and offers two one-tap fills drawn from what is already on this box: the whitelist proxy at `127.0.0.1:8642` and, when a `compatible` lane already exists, its endpoint. The model step is the OpenRouter step's degraded arm verbatim — the validated field, with the sentence that says so — because there is no catalogue to fetch (§4.3), so the two lanes look the same rather than nearly the same |
| **openai** | declare an existing launcher, then log in through the pane | the candidates list shows each undeclared, id-shaped executable's **name and size, never its contents**. The row says *"external launcher — ccrc does not manage its credential"*, and the done state carries the standing state: *"the lane stays off until you enable it"* |

**The smoke test runs inside the sheet, and the sheet stays open through it.** The probe is
the shipped tool card verbatim: `❯ probe claude-c · one inference · 60 s cap` in a
`--bg-well` well, a breathing dot while sending, and a mono footer — `EXIT 1 · 0.6 s ·
measured 14:08:02` — which becomes the `EXIT n` micro-badge on a non-zero exit. That badge is
the only red on these screens, and it lives inside a well, where `--diff-del` and
`--status-dead-tint` already live.

One measured correction came out of drawing it, and it is the kind this design exists to
catch. The shipped badge pairs `--status-dead-text` with the `--status-dead-tint` pill, and
`tokens.css:79-89` says in its own comment that the tint is priced over `--bg-surface` — where
the pair measures 5.89 dark / 4.81 light, exactly the 4.8–5.9 `DIRECTION` quotes. Inside a
**well**, whose ground stays dark in the light theme by design, that same pair measures 6.74
dark / **2.89 light**. Reusing the shipped badge verbatim would have shipped a sub-AA label to
every daylight user. The badge in the probe well uses `--diff-del` on the same pill instead
(7.34 / 6.80) — a well-only accent on a well-only surface.

Three things the running probe must say, all of them measured failures elsewhere:

- it can be **cancelled**, and the cancel names its consequence — *"Cancel the probe — the
  lane stays `— not measured`"*;
- the ambiguity is pre-stated *before* it happens — *"at 60 s the verdict is 'timed out',
  which is not 'dead'"*;
- every outcome names **the list state you leave behind** — *"the lane exists on the fleet
  host now, marked auth dead; closing this sheet leaves it that way."*

On a 401 the credential section re-presents itself inline **with the field empty** (a secret
is never echoed back), the rejected token is named as still being in the file until it is
replaced, and the retry that does not demand a new credential — *"probe again as-is"* — is
offered beside it.

### 12.6 The sign-in flow, and the pane flows

**The default Anthropic connect is a sign-in, and it has no pane at all.** `claude auth login
--claudeai` runs in a pipe on the fleet host (§6): it prints an authorize URL, blocks on stdin,
and takes back a code the operator carries from their browser. Four steps, each stamped, in the
same mono step ledger the pane flows use — *launched · URL ready · code sent · signed in* — and
the rhythm rule is unchanged, because it was never about panes: **glow lives on a living
process**, and a blocked `claude auth login` is one. It breathes while it works and pulses while
it waits on the operator, exactly as the pane does.

Three things separate the drawing of this flow from the mint pane's, and each is a fact about
the machine rather than a style choice:

- **There is nothing to attach a terminal drawer to.** The pane flows end in `show the pane`;
  this one ends in `show what the process printed` — the same disclosure affordance over the
  helper's captured stdout, line-filtered by the same rule. A drawer that offered to attach to a
  tmux session that does not exist would be the interface lying about the mechanism.
- **The scopes are named at the moment of granting.** The authorize URL requests six —
  `org:create_api_key`, `user:profile`, `user:inference`, `user:sessions:claude_code`,
  `user:mcp_servers`, `user:file_upload` (measured, §6) — and the sign-in step lists them in mono
  above the button, with the one that matters marked: *"`user:sessions:claude_code` — this is
  what Remote Control needs, and it is why this is the default method."* This is the only screen
  in the design where the operator authorises something on a page ccrc does not own, so it is the
  one screen that must say what is being authorised. The alternative — a button reading
  *Open the sign-in page* over silence — is exactly the pattern this design refuses everywhere
  else.
- **The custody sentence is shorter here, and it is stronger.** *"the code goes down a pipe to
  `claude` on the fleet host; the credential is written by Claude Code into
  `~/.claude-c/.credentials.json` · 0600. ccrc holds nothing — there is no secrets file for this
  lane."* A signed-in lane has no `~/.cc-secrets` entry at all, and saying so is what makes the
  removal sheet's "sign this lane out" checkbox legible when the operator reaches it (§12.9).

Its terminal states obey the same rule as the pane's: each says what did *not* happen. The
600 s bound expiring reads *"the sign-in expired · nothing was written · id, label and hue are
kept"*; a refused code reads its reason from the status file's own `state: failed` and quotes
that, never a CLI string nobody has captured. And the done state is a register, not a
celebration: it names the 0600 path, says the process exited, and still reads `health — not
measured · probe next`.

**The pane flows.** Mint-in-a-pane and the OpenAI device login run in a real tmux pane on the
fleet box (§6), and a tmux pane is a living thing in `DIRECTION`'s sense. That is the one place
on these screens where light is allowed, and the two rhythms stay apart:

- the pane **working** (waiting for the sign-in URL, exchanging the code) breathes phosphor
  at `--breathe-period`;
- the pane **waiting on the operator** (the URL is ready, the code is on screen in a browser)
  pulses amber at `--pulse-period`, exactly twice the tempo.

Never on the account card, never on a chip, in any state. The blinking caret is not used
here: `▍` means the machine is mid-sentence, and a pane waiting on a human is not.

The URL is a 52px button with its host in mono beside a copy control; the OpenAI user code is
set at 24px with `--tracking-caps` and marked *"not a secret — shown so you can type it"*.
Both are the two-app moments of this whole feature, so both clear 44px with room to spare.
Every terminal state says what did *not* happen: expired reads *"the sign-in expired; no
credential file was written"*; cancelled reads *"the pane was closed; nothing was stored —
id, label and hue are kept."* The stored state is a register, not a celebration: it names the
0600 path, says the pane closed and its scrollback was discarded, and still reads `health —
not measured · probe next`.

### 12.7 Refusals, and the dark box

Every refusal is three things in one block: a **sans sentence** a human reads, the **server's
refusal code in mono** (`duplicate-id`, `last-home-able`, `live-sessions`,
`secret-over-plain-http`, `unsupported`, …) so it can be searched and quoted, and **what was
read to decide it** — *"upstream = yes · from the roster, just now"*, *"kill-switch markers
read just now"*. A refusal that enumerates the lanes must enumerate **all** of them; one that
claims to name every lane and misses the upstream is not a re-measurement.

Every disabled control carries `aria-disabled` and a one-line reason directly beneath it, in
mono. A control never simply disappears: the connect door narrows its own scope in place
(*"needs the server"*, *"declare only — this origin is plain HTTP"*) rather than vanishing.

**The dark box** is the plain-HTTP, non-loopback origin, where the server refuses every
secret-bearing route with `secret-over-plain-http` (§7). The screen says what is off, what
still works, and the fix (`ccrc expose duckdns | byo | ip`, which writes the https origin and
`CCRC_AUTH=on` together — the pair the server actually tests).

It does **not** print an origin string. An earlier draft had it name the exact origin, and
drawing it made the problem visible: the only origin this page can read is its own, and under
RULING 5 that is precisely the quantity it must not reason from. The server sends
`connect.secretsAllowed` and `connect.secretsReason`, not `cfg.origin`, so the honest sentence
is *"the server says so: its own origin is plain HTTP and not loopback"* — a statement sourced
where the fact lives. If naming the origin turns out to matter in use, it is one more additive
field, not a thing the browser may infer.

**It renders what the server said, never what the browser saw.** §7's refusal is config-stated
precisely because the request cannot tell, so the page's own `location` and `cfg.origin` are
different quantities — behind a reverse proxy they routinely disagree. The UI reads
`connect.secretsAllowed` off `GET /api/accounts` (§7) and quotes it: `read: GET /api/accounts ·
connect.secretsAllowed false · 14:07:52`. A screen that greys a control because
`location.protocol === 'http:'` has invented a fact only the server holds — and the refusal code
`secret-over-plain-http` belongs only where a POST actually returned it. Two further rulings the
panel forced:

- **loopback HTTP is not the dark box.** `http://127.0.0.1:7788` is the development lane and
  is fine; the LAN origin is the one that would carry a token in the clear.
- **the OpenAI login pane stays available on that origin.** It surfaces a public URL and a
  user code that is not a secret; refusing it would be a refusal without a refusing fact —
  and a state-honest surface that refuses more than the fact requires is still lying, just in
  the safe direction.

### 12.8 Offline

The strip is the shipped `.offline-banner` (`fleet.css:191-213`), reproduced rather than
re-designed: `--bg-raised` ground, `--edge-subtle` hairline, `--ink-secondary` mono at
`--text-xs` with `--tracking-caps`, and its 6px `--status-attention` dot. Amber at dot scale
*is* this fleet's shipped offline signal, and it is the right hue for it — a server that has
stopped answering is a thing waiting on you. What this design refuses is a heavier amber for
the same fact (a full-width tinted rule) and amber for facts that are not waiting-on-you at
all: a plain-HTTP origin is a standing property, not a state, and it gets the neutral refusal
slab.

The banner says **since when** the server stopped answering, the retry cadence, and that every
age below counts from the snapshot rather than from now — and then every age on the screen
obeys that sentence. (Both of the losing concepts contradicted their own banner here; one
displayed a measurement timestamped *after* its own snapshot.) A tap on a refused operation
answers with a toast that names the refused act, the reason, and **restates the last
reading** — *"the last reading stands: auth dead, 2h ago"* — so the operator is left with no
less than they had before they tapped.

The standing-fact card in the fold names exactly which operations are refused while
disconnected, where the operator would otherwise tap them.

**An offline refusal quotes no code, and that is the point.** Every other refusal on these
screens carries the server's kebab-case code in mono, because a server measured something and
answered. Here nothing answered — so printing `fleet-disconnected` beside a sentence whose own
read-line says *"the server has not answered since 14:02:11"* would render an unmeasured verdict
as a measured one, which is the exact failure this surface exists to prevent, and it would put a
code in the operator's hands that no log will ever contain. A client-side refusal is a sentence
and a read-line: *"check, re-authenticate, move, remove and the kill switch need the server"* ·
`read: this browser's socket to the server · closed since 14:02:11 · retry 4, next in 8 s`. The
mono code slot appears only when a server filled it. (Caught by the canvas review, which found
the code printed four times on one frame.)

### 12.9 Removing a lane

Removal is the one flow where the UI's job is to slow the operator down without hiding
anything. Three refusals are measured on the fleet box at the moment of the call, never from
the PWA's snapshot (§9): `upstream`, `last-home-able` and `live-sessions`.

`live-sessions` is not a dead end: the answer lists the session ids, and the sheet offers the
existing swap flow per session plus a move-all-to-least-loaded, with the destructive primary
**disabled and carrying the live count that recounts as sessions move** — *"Remove `claude-b`
— 3 sessions still on it"*.

The typed-id gate shows its **unarmed** state, not just its armed one, and the difference is
chrome, not ink alone: unarmed is a ghost in `--ink-disabled` with `aria-disabled`; armed is
the reversed-ink primary. The `7 of 8 — not armed` readout carries `role="status"`. Above the
field sit two things:

- the **measured pre-check** — *"0 live sessions · not upstream · 2 other home-able lanes
  enabled · read just now"*;
- the **deleted-vs-kept ledger**, rendered as a diff inside a `--bg-well` well with
  `--diff-del` and `--diff-add` — the well-only accents doing exactly their job, keeping the
  red inside the glass instead of on the sheet. Every path in it comes from the server's
  answer (`removed[]`, `kept[]`, `rehomed[]`), never from the client's guess.

The config dir is kept unconditionally and the ledger says so — which is exactly why the
credential row has three forms rather than one (§9). A **token** lane offers *delete the stored
credential too*, and unticking keeps the 0600 file for a later reconnect. A **signed-in** lane's
credential is inside the dir being kept, so the row becomes *sign this lane out* — it runs
`claude auth logout` in that config dir and every transcript survives; leaving a live
subscription credential on disk under a lane the operator can no longer see is not a thing this
design does quietly. An **external** lane's launcher is never touched and its credential is not
ccrc's to delete, so the row is absent for it rather than disabled — and where it is present, it is a 44px row, not a 14px
glyph, because it is the most consequential optional choice in the flow.

### 12.10 The kill switch

The switch flips directly. There is no confirm sheet (three taps to disable and three to
reverse is a tax on a reversible act) and no auto-dismissing action toast (a confirmation
that can vanish before it is read is not one). The consequence is stated in the row beneath
it, and reversal is one tap.

Two truths are said in words on the surface, because both have bitten:

- **the knob does not move until the server acks** — the marker lives on the fleet box, and
  an optimistic knob would be the UI asserting a file it has not written;
- **enabling does not probe.** A lane can be enabled and `— not measured` at the same time,
  and the screen says so rather than implying a check happened.

`role="switch"` with `aria-checked`, 48×28 in a 52px row, and never the sole carrier: the row
always reads `Enabled on the fleet host` or `Disabled on the fleet host` in words.

### 12.11 One store, one refresh

`GET /api/accounts` is polled today by **five independent readers across four files**, each
on its own 20 s timer — `stores/fleet.ts:261`, `AccountsScreen.tsx:41`, `AccountsStrip.tsx:75`
and both hooks in `useProjectedHome.ts` (`useProjectedHome` at `:62`, `useDisabledWrappers` at
`:96`) — and there is **no exported refresh**. That duplication is defended in the code and is fine for a
read-only screen; it is not fine the moment a mutation lands, because after `POST
/api/accounts/:id/check` the operator would watch up to four different staleness windows
disagree on one card.

This design adds **one** thing: `refreshAccounts()` exported from the fleet store, called by
every mutating route's success path, which pushes a single fresh read into the store. No new
poller, no new route, no timer change; the five independent polls stay exactly as they are for
the steady state. Only the surfaces that must not lag a mutation — the list and the fold —
read the store's copy; the strip and the two placement hooks keep their own reads, which is
the duplication `useProjectedHome.ts:9-12` already defends and which this design has no reason
to disturb.

Health rows ride the same response (`health?: Record<id, HealthRow>`, additive), so a check
answers in the card the operator tapped, not on the next poll.

### 12.12 The accessibility contract

Every one of the three concepts failed this the same way, so it is stated as a contract
rather than left to the implementation:

- real `<button>` and `<input>` — no tappable `<span>`, no bare `<label>`;
- `type="password"` on every secret field; `autocomplete="off"`, `autocapitalize="off"`,
  `spellcheck="false"` on the id field, every token/key field and the typed-id confirm field
  (an iOS keyboard will otherwise generate the very charset refusal the id step exists to
  prevent);
- `aria-invalid` on a refused field, with the refusal referenced by `aria-describedby`;
- `role="switch"` + `aria-checked` on the kill switch; `aria-expanded` on the fold control;
- **live regions belong to PROCESSES, not to inventories** — and this clause replaces the one
  that used to stand here, which read *"`role="status"` + `aria-live="polite"` on every
  measurement line"*. That rule is what a careful designer writes and it does not survive
  contact with a list. MEASURED on the rendered canvas before the change: **82 live regions
  inside list contexts** (39 `.health-line`, 16 `.meters`, the rest card registers) against 30
  roll-ups — so a single 20-second poll could queue eighty-odd announcements at a screen-reader
  user who asked for one screen. The rule now:
  - the **roll-up is the list's one live region.** It is the summary, it is already the thing
    that changes when anything changes, and it is where "1 auth dead" becomes "2 auth dead";
  - a **card's readings arestatic text**, read by navigating to them. They are content, not
    events;
  - **a sheet or a pane keeps its live regions** — the current step, the elapsed rule, the
    outcome, the refusal — because a sheet is one process the operator is watching, which is the
    case the mechanism is for;
  - **an event stays live wherever it is**: the offline strip, a refusal, a toast, the kill
    switch's consequence line, the passkey count. Measured after the change: 3 live regions left
    in list contexts, all four of those kinds.
  The symmetry with `DIRECTION` is not a coincidence and is worth saying out loud: **glow lives
  on a living process, and so does the live region.** Two mechanisms, one rule, and the screen is
  quieter in both senses.
- **the focus ring is `base.css:123`'s, and the design owes an answer for each ground it adds**
  (§13.6). Measured: `--accent` is 10.37 dark / 4.92 light on `--bg-page` (fine), 1.63 / 3.10 on
  the reversed `✕ auth dead` slab, and 10.67 / **3.37** inside a well, which stays dark in both
  themes. WCAG 1.4.11 wants 3:1. So the ring keeps `--accent` everywhere except inside a well,
  where it takes `--accent-on-well` (9.61 light) exactly as `chat.css:1169` already does. The
  slab needs no rule at all — see §12.13, where the render refused the fix that looked obvious.
- **forced colours**: `✕ auth dead` is a reversed slab, and forced-colors flattens fill and ink
  alike, so the design's ONE loud state renders identically to `✓ ok` on the screen whose whole
  job is telling them apart. The glyph and the word survive — which is why "colour is never the
  sole carrier" was already the rule — and the slab takes the inset border `fleet.css` gives the
  same idiom;
- **one age vocabulary, and it is the app's.** Every relative age is `formatAge`'s output
  (`formatReset.ts:50-59`): `just now` under two minutes, then `Xm ago`, `Xh ago`, `Xd ago`. The
  canvas had been writing `2 min ago` and `1 h 54 min ago` — 59 strings the shipped formatter can
  never produce, which would have shipped either a second formatter or a UI that does not match
  its own design. Where second-level precision matters the line carries the **absolute clock**
  beside the age, which is the half that was doing the work anyway;
- **a group of choices and a list of actions are different things and take different roles.**
  Both had been bare `<div class="opts">`: a screen reader heard four unrelated buttons and no
  "1 of 4". Now the provider and launcher pickers are `role="radiogroup"` with `role="radio"` +
  `aria-checked` children (replacing an `aria-current` that was on three of the eight groups and
  missing from five), and the action lists — restart a session, move a session, the four routing
  aliases, the endpoint fills — are `role="group"` with a name. Collapsing the two into one role
  would be this repo's overloaded-seam defect, in ARIA;
- 44px on everything tappable, including hue chips, keycaps, copy controls and checkbox rows
  — `DIRECTION` sets the floor at 44 and `chat.css`'s shipped keycap is already 44;
- colour is never the sole carrier: every state travels with a glyph **and** a word.

### 12.13 Five defects only a render catches

The canvas was measured in a headless browser, not just read. Five defects survived every
review of the CSS and died the moment the DOM was measured. Each is a rule the implementation
must carry, and each is the kind that ships silently because the stylesheet *looks* correct.

- **A 52px row does not make a 28px button a 44px target.** The kill switch is a
  `<button role="switch">` whose visual pill is 48×28 — `DIRECTION`'s proportions, and the
  shape the operator reads. Its row has `min-height: 52px`, and the row is not what the thumb
  hits: the rendered button box measured 48×**28**. The fix is a transparent `::before`
  spanning `height: var(--tap-min)`, centred on the pill, so the hit area is 44px while the
  knob's geometry and travel are untouched — verified by `elementFromPoint` at ±21px (hits)
  and ±23px (misses). Padding would have grown the pill; this does not.
- **`display: flex` on a button breaks the voice split.** A primary reads
  *"Replace the token and `claude-c` and probe again"* — a sans sentence with the lane's id set
  in mono inside it. Under `display: flex; gap`, the text nodes and that `<span>` become
  separate flex items and wrap as three separately-centred boxes. Buttons whose labels mix the
  two voices must lay out as one inline run (`display: block; text-align: center`), which is
  the whole point of the mono/sans split: the machine's word belongs *inside* the human's
  sentence, not beside it.
- **A capped well collapses to nothing inside a scrolling parent.** `DIRECTION` caps wells at
  `--well-max` (240px) "with internal scroll so a long test log never swallows the column".
  Because a scroll container's automatic minimum size is `0`, the removal ledger's well was
  squeezed by its grid parent to **66px** against 362px of content — clipping the deleted/kept
  paths mid-string, on the one screen where the operator most needs to read them. `height:
  fit-content` beside the existing `max-height` restores the intent: the well takes its content
  height up to the cap, and the sheet body does the scrolling around it.
- **A consent list that scrolls has not been shown.** The sign-in frame's whole argument is that
  the six OAuth scopes are named *before* the operator grants them (§12.6). Drawn in the same
  capped well as every other machine quotation, the block measured **306px** against the 240px
  cap — so two of the six sat below an internal scrollbar, on the one screen in this design where
  the operator authorises something on a page ccrc does not own. The cap is right and stays; the
  content moved instead (the explanatory line came out of the well and became prose beneath it),
  and the block now measures 205px with no scroll. The rule the implementation carries is not
  "make the well bigger": it is that **a well holding a list the operator is agreeing to must fit
  the cap, and content that will not fit belongs outside the well** — a transcript may scroll, a
  consent list may not.
- **An inherited fix, applied to a different geometry, is a new defect.** The `✕ auth dead`
  reading wears `.sess-line--active`'s reversed slab, and `--accent` — the app's focus ring —
  measures **1.63 dark / 3.10 light** against it, below WCAG 1.4.11's 3:1. `fleet.css:891-896`
  had already met that exact number on that exact slab and answered it by swapping the ring to
  `--bg-page`, so copying the override looked like inheritance rather than invention. The audit
  failed it on the first render. fleet.css's selector is a **descendant** one: the focused thing
  is a control *inside* the slab, so its ring is painted **on** the slab, where `--bg-page`
  measures 16.94 / 15.26. The health reading is a static `<span>`, so a ring on the reading
  itself is painted **outside** it, on the card — where `--bg-page` on `--bg-surface` measures
  **1.08 / 1.09**. The fix would have shipped an invisible focus ring, for a control this design
  does not have, out of a correct rule for a case it does not share. The slab therefore takes no
  ring rule at all; the measurement stays in the kit for whoever adds a control to one later.
  The rule this generalises to: **a borrowed CSS answer carries its selector's geometry with it,
  and the ratio has to be re-measured against the ground the ring actually lands on** — not the
  ground the original was solving for.

### 12.14 Two shipped defects this work fixes

- `pwa/src/fleet/fleet.css:747` reads `var(--limit-crit, #f85149)`; the token is
  `--limit-critical` (`tokens.css:167` and `:365`). Every critical band on the accounts
  screen has therefore been painting the **fallback GitHub red**, not the theme's
  `--limit-critical`, in both themes — and the fallback is a raw hex the contrast gate never
  measured. One-character class of fix, with a red-first test that the fallback is gone.
- `pwa/src/lib/models.ts` decides which model and effort options a session picker offers by
  comparing the wrapper id against the literal `'gpt'` (`:26`, `:59`) — the last place in the
  PWA where an account NAME, rather than a property of the account, drives behaviour. The
  OpenRouter allowlist (§4.1) turns this from tidiness into a requirement: without the fix an
  OpenRouter lane's picker offers **Claude's** model list, which is wrong for every lane that is
  not Anthropic-served, and the allowlist the operator just configured would never reach the
  screen it exists to fill. It
  survives `single-definition.test.ts` only because it is one literal and not a list. With
  `provider` and `models` on the roster and `provider` on the wire (§4.1, §7) that becomes a
  roster read, and it is the natural moment to make it one: this design is what puts the
  field there. Not a blocker for the feature; named here so the plan can carry it rather than
  leave the tree with a fifth lane that would pick up Claude's model list by default.

## 13. Amendments to `pwa/design/DIRECTION.md`

The operator's brief permitted amending `DIRECTION.md` to make this experience exceptional.
The design uses that permission sparingly, and the shape of the amendment set is itself the
argument: **eleven component treatments that compose existing tokens, two motion rules that
RESTRICT the vocabulary, two non-colour tokens, and exactly one exception to a refusal.**

**Zero new colour tokens. Zero new hex. Zero new rgba.** Every pair below already exists in
`tokens.css` with its ratio annotated there, so the gate (`contrast-check.mjs` over
`audit.mjs`'s reading of every stylesheet under `src/`) measures no value this design
invented. Two candidate colour tokens from the concept round were considered and **dropped**:
a red health-fault pair (retired with the red badge, §12.3) and two aliases the ink judge
correctly named as decoration (`--measure-rule`, which named a 2px hairline "a decision", and
`--elapsed-fill`, which existed to prevent a habit rather than to name a meaning).

Ratios are quoted **dark / light** and come from `tokens.css`'s own per-token annotations,
not from a fresh claim.

### 13.1 Component treatments

| # | name | why it needs saying | pairs (dark / light) |
|---|---|---|---|
| A1 | **Account card — two registers** | Neither `.accounts-row` (a read-only card on the accounts screen) nor `AccountRow` (the picker button in `SwapSheet.tsx`, reused by `NewSessionSheet`, whose whole job is *choose this lane*) can hold a measurement register, a custody line, a switch and four operations. This EXTENDS `.accounts-row`'s shipped clothes (`--r-md`, `--edge-subtle`, `--sp-3`) rather than re-cutting accounts as session cards — a session card's radius, shadow and right-aligned status slot teach the eye to read a lamp where there is none. Declared register above a 2px `--edge-strong` rule; measured register below it, every line carrying its own age. | primary on surface 15.68 / 16.58 · secondary 8.67 / 7.41 · tertiary 5.77 / 5.70 |
| A2 | **Fold** | The operator's weekly job is four operations on five lanes; a detail route charges a top-left back on every one of them. The card expands in place, `--dur-base` `--ease-swift`, `aria-expanded` on the control. | as A1 |
| A3 | **Health reading (four members)** | `StatusDot`'s hues and glyphs mean *session* state and may not be applied to an account (hue governance). Health therefore gets its own language and that language is ink: `✓ ok` primary, `— not measured` tertiary in a dashed slot, `~ inconclusive` secondary on raised, `✕ auth dead` reversed. Urgency is carried by ink weight and ground, never by hue and never by glow. | ok 15.68 / 16.58 · not-measured 5.77 / 5.70 · inconclusive on raised 7.91 / 6.32 |
| A4 | **The loud state is the shipped reversed slab** | `.sess-line--active` (`fleet.css:791`) already reverses a row out of the fleet list. Reusing it for `✕ auth dead` gives the only state that is a fact about the credential the loudest treatment in the tree **without a hue**. One deliberate difference from the shipped rule: it reverses to `--bg-page` because it is a row in a page-ground list, while this slab sits on a card, so it reverses to `--bg-surface` — the same idiom against its own ground. The shipped rule's *comment* is borrowed unchanged: `--status-*-text` and account hues are tuned for `--bg-surface` and die on the reversed ground (1.47:1 busy-text, 1.46:1 an account hue), so everything inside the slab goes achromatic, and its meta steps to `--edge-strong` rather than faking a tertiary that would read 2.7:1. | slab 15.68 / 16.58 · meta on slab 9.27 / 9.91 |
| A5 | **Dashed slot for `— not measured`** | "Never probed" is a different KIND of thing from a reading, and the difference must not be a colour. A 1px dashed `--edge-strong` slot marks it in chrome. **Stated honestly: that border is decorative — `--edge-strong` on `--bg-surface` measures 1.69:1 dark / 1.67:1 light and cannot carry meaning alone.** The reading is carried by the glyph and the words in tertiary ink; the dash is a supporting cue only. This is the one row in this table that fails a 3:1 read, and it is declared as decorative rather than claimed as a UI boundary — the gate's first refusal is a rule whose pair it cannot resolve, not a hairline that admits what it is. | text 5.77 / 5.70; border decorative (1.69 / 1.67, declared) |
| A6 | **Cold chip for a dead credential** | `DIRECTION`'s own dead-card move — the chip drains to gray, identity survives in the mono name, a full-width ghost offers the fix — applied to the account whose credential is dead, with an inline ghost *Re-authenticate*. It reuses the already-gated `[data-acct='unknown']` rebinding (`tokens.css:409`), so no component learns a new colour path. Deliberately distinct from **off**, which KEEPS its hue: a switch is a decision, not a death. | chip 5.27 / 4.86 |
| A7 | **Kill switch** | No switch exists in the tree and this feature requires one. Off = outline pill in `--ink-tertiary`; on = `--accent` fill with an `--ink-on-accent` knob — the phosphor is the interactive accent, which is exactly what `DIRECTION` says it is for. Never the sole carrier: the row always reads *Enabled/Disabled on the fleet host* in words. `role="switch"`, `aria-checked`, 48×28 in a 52px row. | off 5.77 / 5.70 (non-text 3:1 floor) · knob on accent 8.87 / 5.35 · focus ring 10.37 / 4.92 |
| A8 | **Step ledger for pane flows** | Mint-in-a-pane and the OpenAI login run in a real tmux pane. The ledger stacks the tool-card row grammar — state glyph · sentence · its own clock — in the machine's voice (mono words, not a numbered wizard rail). `role="status"` on the current step. | busy word 10.21 / 6.34 · attention word 9.63 / 5.92 · dots ≥ 3.9 both themes |
| A9 | **Probe well** | The smoke test IS the shipped tool card: `❯ probe <id> · one inference · 60 s cap` in a `--bg-well` well, a breathing dot while sending, a mono footer that becomes the `EXIT n` micro-badge on a non-zero exit. The one place red appears on these screens is a transcript result inside a well, exactly where `--diff-del` and `--status-dead-tint` already live. **One measured correction, and it matters:** the shipped badge pairs `--status-dead-text` with the `--status-dead-tint` pill, which `tokens.css:79-89` explicitly prices over `--bg-surface` — 5.89 / 4.81 there. Inside a WELL, whose ground stays dark in the light theme, that same pair measures 6.74 dark / **2.89 light**, an AA failure a "reuse the shipped badge" instinct would have shipped. The badge in the well uses `--diff-del` on the same pill instead: 7.34 / 6.80. | well ink 15.52 / 13.98 · EXIT badge 7.34 / 6.80 (shipped pair REJECTED at 2.89 light) |
| A10 | **Refusal block** | Every refusal is a sans sentence, the server's refusal code in mono, and what was read to decide it. The code is `--ink-tertiary` mono and is selectable text, not an icon — an operator quoting `last-home-able` into a search is the point. | sentence 8.67 / 7.41 · code 5.77 / 5.70 |
| A11 | **Typed-id confirmation + deleted/kept ledger** | `QuickConfirm` (`components/QuickConfirm.tsx`) is a title, one consequence sentence and a single confirm tap — right for stop and move-account, insufficient for a removal that deletes a wrapper, a credential and four registry files. Sentence · measured pre-check · the deleted-vs-kept ledger as a **diff inside a `--bg-well` well** using `--diff-del`/`--diff-add` (the well-only accents doing their declared job) · a mono 16px field · a primary that is a ghost until the field equals the id, then the reversed-ink primary. Armed vs unarmed differs in chrome, not ink alone. | ledger 13.9–15.5 (well) · armed primary 16.94 / 15.26 |

### 13.2 Motion — two rules, both restrictions

| # | rule | why |
|---|---|---|
| M1 | **A health-verdict change fades (`--dur-fast` 180ms) and never pings.** | `DIRECTION`'s ping "radiates off the lamp in the new state's colour". A health reading is not a lamp and has no colour; a ring in ink off a word would be a new motion meaning. This narrows the vocabulary rather than extending it. |
| M2 | **Nothing on these screens glows except a pane step and an in-flight probe.** | The glow rule is *"the only things allowed to emit light are living states"*. A tmux pane running `claude setup-token` and an inference request in flight are living; an account is a roster entry. So the two rhythms apply to the STEP — working breathes at `--breathe-period`, waiting-on-you pulses at `--pulse-period`, exactly twice the tempo — and never to the account, the chip, or the health reading, in any state. This is an application of the existing rule to a newly-drawn living thing, not an exception to it. |

The blinking caret is explicitly **not** extended: `▍` means the machine is mid-sentence, and a
pane waiting on a human is not mid-sentence. One concept used it there; this design does not.

### 13.3 Tokens — two, both non-colour

`--switch-w: 48px` and `--switch-h: 28px`. Enumerate-once discipline for the one new
primitive, so the knob geometry has a single home rather than three call sites. Optional: if
the reviewer prefers the numbers inline in the one rule that uses them, drop both — nothing
else in this design depends on them.

### 13.4 The one refusal exception: a fourth `❯` placement

`DIRECTION` charters the `❯` in three places — the prompt input, the preselected dialog row,
and the streaming caret — and calls it *"the one piece of terminal furniture that crosses into
the chrome"*. This design claims **one** more: the connect door — the last line of the accounts
list, reading `❯ connect an account`.

**This claim got SMALLER on 2026-09-07, and the amendment is re-argued rather than re-labelled.**
The door used to be drawn twice on a phone: once ending the list, once pinned in a bottom `.dock`.
The operator ruled the connect affordance belongs inside the account-management screen and not in
the general PWA, and a persistent bottom bar is the definition of the second thing. With the dock
gone the door is no longer chrome at all — it is a row in a list, on one screen — so what this
section asks for is a fourth placement **in a list**, which is a weaker request than the one
originally written here.

**The count, measured rather than claimed — and re-measured after the first count was wrong.**
A DOM walk of the rendered canvas (text nodes plus generated content, excluding the canvas's
own annotation prose) finds **16** `❯` in the product, in three placements: the connect door
(`.door .g`, 7), the preselected dialog row (`.opt-cur`, 3 — DIRECTION's own), and the shell
prompt at the head of the probe's command line inside a `--bg-well` (`.probe-cmd::before`, 6).
The door's count fell from 12 to 5 when the dock came out — seven of those twelve were the pinned
duplicate — and rose to 7 when the UX pass added two more list frames (`1d`, `1f`), which is the
right behaviour: one door per list screen, counted. This paragraph has now been wrong twice and
re-measured three times, which is the point of keeping it. An earlier draft said 27 in a 12 / 5 / 10 split, taken from a reviewer's figure
rather than from a render — it counted the glyphs in the canvas's own commentary as though they
were product. Neither correction is worth applying quietly, because the paragraph's whole claim
is that the census is honest, and a census carried from a number nobody re-took is exactly what
it claims not to be.
The third is not a fourth claim. `DIRECTION` says the well *is* the terminal peeking through —
the structured layer and the escape hatch sharing one material — so reproducing a shell prompt
inside one is inheritance, which is the whole thesis, not promotion into the chrome. The
amendment is therefore **one new placement in the CHROME**, and the well is named here so the
census is honest rather than convenient.

The argument: the door is a prompt. It is the single line on this screen where the operator
addresses the machine to bring something into existence, which is what the glyph means in
ccd's own TUI and what it means in the composer — and "single" is now literal rather than
rhetorical: there is exactly one of it per screen. It is not decoration and it is not a fourth
habit — every other placement the concept round proposed (on a selected segment, on a
preselected hue chip, on a desktop side-nav item) is **refused here**, and so is the promotion
of the drawer's keycaps into operation verbs (§12.4), which would have been a second, larger
exception to the same thesis.

If the reviewer refuses this one too, the door reads `+ connect an account` and nothing else
in the design moves.

### 13.5 What the design refuses to add

Stated so the review has the negative space as well: no new colour token; no red on an
account row; no glow on an account in any state; no status hue borrowed onto health; no
account re-clothed as a session card; no wizard rail with numbered nodes; no element opacity
on content anywhere (`DIRECTION`'s gate refuses it and the tree has no such rule today); no
sheet that closes itself; no confirmation that can vanish on a timer; no reveal control on a
secret; and no character count beside one — metadata about a secret is still metadata about a
secret.

### 13.6 Focus, and the grounds this design adds

`DIRECTION` names the accent as the colour of *"actions, links, focus, `❯`"* and prices non-text
UI roles — *"dots, bar fills, focus ring"* — at 3:1 per WCAG 1.4.11. It does not say what happens
when the ring lands on a ground the accent was not priced against, and this design adds two such
grounds. So this is an amendment that ADDS no token, changes no ring, and writes down three
measurements plus one withdrawal:

| the ring's ground | `--accent` | verdict |
|---|---|---|
| `--bg-page` (the ordinary case) | 10.37 dark / 4.92 light | keep |
| `--bg-surface` (a card) | 9.61 / 5.35 | keep |
| `--bg-well` — **a well is dark in BOTH themes** | 10.67 / **3.37** | swap to `--accent-on-well` (10.67 / 9.61), which is what `chat.css:1169` already does |
| the reversed `✕ auth dead` slab | 1.63 / 3.10 | **no rule** — see below |

The slab entry is the one worth reading. `fleet.css:891-896` met that same 1.63 on that same
reversed slab and swapped the ring to `--bg-page`; inheriting it here failed the canvas audit on
the first render, because fleet.css's selector is a **descendant** one — its ring is painted on
the slab (16.94 / 15.26), while a ring on this design's health *reading* would be painted outside
it, on the card, where `--bg-page` measures **1.08**. The reading is static text and nothing
focusable lives inside the slab, so the correct amendment is none at all, and the measurement is
recorded in the kit for whoever later puts a control there (§12.13).

One more thing `DIRECTION` does not cover and this screen needs: **forced colours**. The design's
only loud state is a polarity swap, and forced-colors flattens fill and ink to Canvas/CanvasText
alike — `✕ auth dead` and `✓ ok` render identically. The glyph and the word carry it either way,
which is the existing "colour is never the sole carrier" rule doing its job, and the slab takes
the inset border `fleet.css` already gives the same idiom.

## 14. Testing and mutation discipline

Every guard ships with a test that reds when the guard is deleted (measured). The
plan's mutation table will name these at minimum:

- roster: new fields absence-permitting (default roster + fixtures untouched, green);
  `models` refused on a non-openrouter provider; `secretsFile` gate hoisted (a `..` path
  on `upstream` REFUSES, not warns); `.mjs` mirror agreement rows for `hidden`,
  `secretsFile`-on-external, `provider`, `models`.
- `PROVIDERS` single definition (new describe, positive control).
- wire: `accounts-route.test.ts:183` exact key set updated to the new set (never
  `toContain`); `isRosterWireLike` still admits a snapshot missing every new field.
- agent: `malformed.test.ts` rows for `account` (bad sub, bad id, non-base64 stdin,
  extra argv); an older-agent replay (drop the op) answers `bad-request`; the op never
  reaches `isExecAllowed` and `EXEC_COMMANDS` stays exactly two (existing pins hold).
- ccd: `account-pane` grant is flag-anchored (structural audit refuses a bare grant);
  `whitelist-subset` sample; `verb-gate` enrolment; the pane is created through
  `_tmux_new_session` and never via `_spawn` (harness asserts no send-keys into
  `cc-auth-*` from ccd's own typers).
- helper: canary token appears in the 0600 file and in no stream, no status file, no
  pane capture (mutation: comment out the filter → red).
- verb: `add` with empty stdin dies before any write; a failure after the secret write
  leaves no roster entry; `remove` refusals in all three shapes; `remove` never deletes a
  config dir (mutation: add an `rm -rf` → red on a fixture with a canary file);
  `disable` refuses the last enabled home; `check` classification table over recorded
  JSON fixtures incl. the 60 s timeout.
- server: every route session-gated (auth-gate sweep picks them up; cardinals bumped);
  `secret-over-plain-http` config table; `reloadRoster` replaces the object every reader
  sees (a test holds `deps.cfg`, reloads, and reads `/api/accounts`); `ownRosterFp`
  recomputed.
- pwa: every state in the design canvas has a render test; secrets never in a toast
  (a test posts a credential, fails the request, and greps the toast host); typed-id
  confirm refuses a mismatch; offline refusal; `refreshAccounts` called after every
  mutation; `models.ts` keyed on `provider`, not `wrapper === 'gpt'`.
- doctor: a new `accounts` check (its own table entry, PASS on `healthy()`) reports
  declared-but-absent credential FILES by existence only (never contents) and a
  `settings.json` env block that disagrees with the roster's models — the `wrappers`
  check's with/without-secrets identity pin stays untouched.
- mirror table: the plan carries one row per new roster field — `parseRoster` rule,
  `roster-json.mjs` mirror line, `gen-accounts.test.ts` CASES row — and proves the
  mechanism first by adding the missing `hidden:'false'` CASES row and measuring it
  red-then-green (the mirror is laxer than the parser today, §1.4).
- doctor `accounts` check vocabulary, defined once in `shared/providers.ts` and rendered
  by doctor and the PWA alike: `credential-declared-absent` (a roster `secretsFile` whose
  file does not exist — existence only), `settings-env-drift` (a lane's `settings.json`
  env block disagrees with the roster's provider config), `launcher-absent`
  (external id with no executable). PASS on `healthy()`; never a SKIP.
- `ccrc-api`: no fleet-host caller in v1, so no client row — and because
  `ccrc-api-closed.test.ts` greps the skill corpora for route mentions, the coordinator
  and worker skills must not mention `/api/accounts/*`.
- CSS: `fleet.css:747` paints the critical meter with `var(--limit-crit, #f85149)` but
  the token is `--limit-critical` (`tokens.css:167,365`), so every critical meter renders
  the hardcoded fallback in both themes today; the accounts work fixes the name and pins
  it with a `declValue` scrape.
- deviation refs: `git fetch origin main` + `deviation-refs.test.ts` before merge.

## 15. Decisions recorded for the operator (each has a default; say so if you want the other)

1. **Transport = approach B** (one typed agent op + `ccrc account`), with ONE new ccd
   exec grant (`account-pane --id`). Alternative: A or C (§2). Deploy order is
   AGENT-FIRST for the whole feature: the op, the verb, the pane verb and the helper all
   land on the fleet box in one `deploy.sh agent`, and the server ships second — until
   then every mutation greys with `unsupported`, never a 502.
2. **Provider config in `settings.json` env, wrapper unchanged** (§4.3); measured first
   in the plan, fallback named.
3. **The ownership whitelist stays out of ccrc's enforcement, and the operator can now reach it
   anyway.** ccrc does not start `handoff-proxy`, does not read
   `~/.handoff/providers-whitelist.json` and does not decide which upstream may serve a request.
   What changed on 2026-09-07 is the accuracy of this ruling's own premise: §4.3 MEASURES that
   the whitelist on this fleet is enforced by that loopback proxy, not by an OpenRouter account
   setting, and that both hand-written lanes refuse to run without it. Since the proxy is itself
   an Anthropic-compatible endpoint, an operator who wants a generated lane to pass the whitelist
   points its `baseUrl` at `http://127.0.0.1:8642` — the one field decision 22 adds, doing the
   job this ruling's old alternative described. The `handoff-proxy` lanes still stay `external`
   (decision 22c).
4. **OpenAI = manage an external launcher** (declare/login/check/enable/remove); no
   API-key lane, no LiteLLM ownership.
5. **Secret-bearing routes refuse over plain HTTP** unless auth is armed with an https
   origin or the server is loopback-bound.
6. **The `claude` upstream declares its secrets file** in the roster on both boxes
   (one JSON edit, no migration mechanism needed — the field is optional) so re-auth
   applies to it.
7. **ccrc DRIVES the sign-in, and still offers the long-lived token** — operator ruling
   2026-09-07, replacing "the design does not drive `claude auth login`". The original was
   written on the assumption that driving a login needed a browser callback nobody could reach
   from a phone. §6 measures otherwise: `claude auth login --claudeai` prints a hosted-callback
   authorize URL and reads a pasted code from **stdin**, with no pty at all. So the three
   Anthropic methods are **login (default)**, **paste a long-lived token**, and
   **mint a token in a pane**, and the operator picks. The policy note stays and is now more
   accurate rather than less: ccrc runs the operator's own `claude` binary against the
   operator's own config dir on the operator's own box, and never sees the credential — the
   sign-in is Anthropic's page, the code goes to `claude`, and the credential is written by
   Claude Code into `~/<suffix>/.credentials.json`. What ccrc holds is the same thing it held
   before: nothing.
8. **Remote Control depends on the connect METHOD, not on the lane being upstream** —
   corrected 2026-09-07 by the scope measurement in §6. `claude auth login` requests
   `user:sessions:claude_code` among six scopes; `setup-token` requests `user:inference` and
   nothing else. So a **login** lane is a first-class lane and the UI says nothing special about
   it, while a **setup-token** lane is the one that carries "inference-only token — Remote
   Control is not available on this lane", said at the moment the operator picks that method
   rather than discovered later. The original ruling assumed every generated lane was
   token-based, which the default-method change makes false.
9. **macOS is supported; the Linux-only ruling is WITHDRAWN** — operator ruling 2026-09-07.
   It rested on `script(1)`, and §6 measures that the DEFAULT path does not use it: `login`
   drives a plain pipe, `paste` touches no terminal either, so both run identically on Linux and
   macOS. A Mac therefore gets the full feature, not a degraded one. The residue is the two
   pane-bound methods (`setup-token`, `openai-login`), which do need a terminal and whose
   `script` argument order differs between util-linux and BSD; they take the tree's own
   `CCD_OS` branch (`ccd/ccrc:110-113`) rather than a refusal. **The BSD arm is unverified from
   this box** and is written as a branch plus a Darwin acceptance test, not as an assertion — if
   it is wrong on a real Mac, `setup-token` answers `pane-unsupported-here` there and nothing
   else moves. Default: ship the branch. Alternative: ship the pane methods Linux-only and let
   macOS use login and paste, which already cover every case.
10. **Re-auth does not restart sessions.** A rotated token takes effect per session at
    its next recreation; the UI lists the live sessions on the account with a one-tap
    restart each (the existing stop → ensure lifecycle, with the device actor). The old
    token keeps working until Anthropic's own revocation page is used — the re-auth
    sheet links to `claude.ai/settings/claude-code` and says that ccrc cannot revoke.
11. **A fourth transport was considered and rejected:** secrets ride only the
    operator-run deploy lane (`deploy.sh`'s `ship_secret`, already used for the mail
    token) and the UI merely measures. It makes "add" a runbook, which is the thing the
    operator asked to stop doing.
12. **OpenRouter is a first-class generated api-key lane, and it carries a model allowlist** —
    operator ruling 2026-09-07. The lane was already generated rather than external (§4.2); what
    is new is `models.selectable` (§4.1), the list of model ids the session picker offers on that
    lane, driven by a server-side cached read of OpenRouter's public catalogue (§4.3, measured:
    430 models, unauthenticated 200) and degrading to a validated text field. This is a
    DIFFERENT whitelist from decision 3's: decision 3 is *which upstream providers may serve a
    request*, which stays an OpenRouter account setting; this is *which models the operator may
    pick in ccrc*, which is ccrc's business because ccrc draws the picker.
    Two things it leaves open, deliberately, rather than assuming:
    (a) `pwa/src/lib/models.ts` must stop deciding the picker from `wrapper === 'gpt'` and read
        the roster instead — already named in §12.14 as a defect this work should fix, and the
        allowlist is what makes it necessary rather than merely tidy;
    (b) whether the generated api-key arm should widen beyond OpenRouter. **GRANTED 2026-09-07;
        it is now decision 22.** The policy worry attached to it here was mistaken and §4.3
        records the correction: `cck3` is not a Moonshot-endpoint lane, it is an OpenRouter lane
        behind the whitelist proxy, so the base-URL field neither invokes nor weakens the
        ownership ban.

13. **The loud health state is achromatic, not red.** Default: `✕ auth dead` wears the
    shipped `.sess-line--active` reversed slab (`--bg-page` on `--ink-primary`, 16.94 / 15.26)
    and every other outcome stays quiet, so the design ships **zero new colour tokens**.
    Alternative (the concept round's proposal): a red `--status-dead-text` on
    `--status-dead-tint` badge on the list row, which costs two colour aliases and puts a
    lamp-grade signal on a standing state — `DIRECTION` reserves glanceable-from-across-the-room
    for light, and light for living things.
14. **A fourth `❯` placement — the connect door** (§13.4). Default: granted, and it is the
    design's ONLY exception to a refusal. The claim SHRANK on 2026-09-07 (decision 23): with the
    bottom dock removed the door is a row in a list rather than chrome, so this asks for a fourth
    placement in a list, and the rendered census fell from 21 `❯` to 14. Alternative: the door
    reads `+ connect an account` and nothing else in the design moves. Every other placement the concept round proposed
    (selected segment, preselected hue chip, desktop side-nav) is refused either way, as is
    promoting the drawer's keycaps into operation verbs.
15. **Two non-colour tokens, `--switch-w: 48px` / `--switch-h: 28px`.** Default: added, for
    enumerate-once discipline on the one new primitive. Alternative: inline both numbers in
    the single rule that uses them; nothing else depends on them.
16. **`/accounts/:id` is a route, but never on the path of an operation** (§12.4). Default:
    the full record is a route so a push notification naming a lane can deep-link to it.
    Alternative: make it a full-height sheet and add no route — cheaper, and it costs exactly
    that deep link.
17. **The two shipped defects in §12.13 ride this plan.** Default: yes — the
    `--limit-crit` / `--limit-critical` fallback (every critical band on this very screen is
    painting an unmeasured GitHub red today) and the `wrapper === 'gpt'` literal in
    `models.ts` are each one line plus a red-first test, and both sit inside the surface this
    work is rebuilding. Alternative: split them into a separate PR ahead of the feature.
18. **`remove` refuses on home-able AND enabled** (§9). Default: yes — removal adopts `disable`'s
    predicate, keeps its own code `last-home-able`, and its refusal names both the roster and the
    kill-switch markers. Alternative: leave removal reading the roster alone, which is defensible
    if you would rather removal never consulted a marker — at the cost that removing the last
    *enabled* home-able lane leaves the placer with nowhere to land, which is the hole the
    refusal exists to close.
19. **The per-account cache keeps three health readings, not one** (§4.5). Default:
    `lastChecks?: HealthRow[]`, newest first, capped at 3, so the fold can answer "did this just
    break, or has it been broken?" Alternative: keep one slot and cut `previous` from the fold —
    cheaper, and it costs the 2 a.m. screen its reason to exist.
20. **`add` and `declare` leave the new lane switched off** (§5). Default: both write
    `$REG/<id>-disabled`, so a lane nobody has probed cannot take placement, and the done step
    says so with Enable beside it. Alternative: leave new lanes enabled, which makes connecting
    one step shorter and lets an unmeasured credential take real work.
21. **The dark box is a server statement on the wire** (§7). Default:
    `connect.secretsAllowed` / `secretsReason` ride `GET /api/accounts`, and the UI never reasons
    from its own `location` — the two disagree behind any reverse proxy. Alternative: let the
    browser infer from `location.protocol`, which is one fewer field and one more place the UI
    can be confidently wrong.

22. **The generated api-key lane takes any Anthropic-compatible base URL** — operator ruling
    2026-09-07, granting what decision 12 left open. `ProviderId` gains `compatible`, `ExecSpec`
    gains `baseUrl`, and that is the whole of it: the `settings.json` env block, the 0600 secrets
    file, the probe, the refusal set, the removal order and every screen are the OpenRouter
    lane's, unchanged (§4.1–4.3). It costs no wrapper-shape change, because §4.3 already measured
    that the base URL rides `settings.json` rather than the wrapper — which is also why the
    August spec's version of this idea was rejected and this one is not: **the objection was
    always the widened `_wrap_parse_shape`, never the provider** (§16). Three things ride the
    ruling, each stated so you can reverse one without the others:
    (a) **the endpoint is shown, not hidden** — `baseUrl` is roster data, on the wire, with its
        host on the card, and never in `~/.cc-secrets`. Alternative: keep it in the sourced env
        file, which builds in zero lines and costs doctor the ability to check it, the operator
        the ability to see it, and `ccrc wrappers` the ability to notice that a roster change
        never reached the disk.
    (b) **https, or loopback, and no userinfo** (`BASE_URL_OK`, §4.1). The loopback arm is not a
        loosening: it is the measured shape of every api-key lane already on this box, and it is
        what lets an operator point at the whitelist proxy. Alternative: accept any scheme with a
        warning, which puts the lane's key on a network in clear on the operator's say-so.
    (c) **the existing `cck3` / `claude-glm` wrappers are DECLARED, never adopted.** They each do
        things ccrc's four-line generated shape cannot — start the whitelist proxy, choose an arm
        from `HANDOFF_PROVIDER`, export six model variables, refuse without the whitelist file —
        and `ccrc wrappers` would rewrite an adopted one INTO that four-line shape, which is data
        loss, not adoption. So the ruling hands the operator an *equivalent new lane* (same
        endpoint, same key, ccrc-owned, ccrc-probed) and leaves the hand-written ones exactly
        where they are, `declare`-able as `external` with a `baseUrl` for the record.
        Alternative: widen the generated shape to carry a model env block, which reopens
        `_wrap_parse_shape`, the equivalence triple and every lock in `cmd_wrappers` — the exact
        cost §4.3 exists to avoid.
    One consequence worth naming rather than discovering: rostering a metered lane makes it
    visible to placement, which is the thing those wrappers' own headers say they were built to
    avoid ("isolated config dir keeps it invisible to ccswap/ccd account logic"). The guard
    already exists — such a lane is `telemetry: 'none'`, reads a permanent zero, and §4.6's
    `_ws_least_loaded` fix stops that zero from making it the least-loaded lane forever — and it
    is one more reason a new lane lands DISABLED (decision 20).

23. **The connect affordance is scoped to the accounts screen, and drawn once** — operator
    ruling 2026-09-07. The door is the last line of the accounts list. There is no bottom bar, no
    app-level connect action, and nothing on any other screen or in the sidebar: connecting an
    account is a rare, deliberate act belonging to the screen that owns accounts, not furniture
    the whole PWA carries. What this reverses is a second, PINNED copy of the same door in an
    absolutely-positioned `.dock`, which had been argued from reach — the phone list runs past the
    fold, so the docked copy was always visible. Three measurements decided it against that
    argument: the bar cost **~96px of every visit** plus a `.phone:has(.dock) .app` clearance rule,
    and removing both dropped the list frame's content from 1504px to 1330px; the fold's four
    operations went from "174px or more above the visible bottom" to **271px**; and the docked
    door was a *lossy duplicate* of state the in-list door already carried in full (`13a`: "openai
    only here" against "openai only — the server reports secrets off on this origin"). The desktop
    frame had reached the same answer independently — at 1200px the door sits in the header and
    nothing is pinned, "because a second door would be furniture, not reach".
    Alternative: keep a pinned door and accept the bar, which buys back the scroll on a list that
    runs 486px past the fold for an action taken about as often as an account is created. If you
    want it back it is one `.dock` block per list frame and one rule in the kit; the in-list door
    stays either way, since it is the one that states the full refusal.

24. **The UX pass of 2026-09-07 changed four things the design had already written down**, each
    because the rendered canvas measured its cost. None adds a token or a colour; three of them
    DELETE something.
    (a) **Live regions belong to processes, not inventories** (§12.12). The contract used to say
        `role="status"` on *every* measurement line; the render counted **82 live regions inside
        list contexts** against 30 roll-ups, i.e. one 20-second poll able to queue eighty
        announcements. Now the roll-up is the list's single live region, card readings are static
        text, and sheets, panes, refusals, toasts and the offline strip keep theirs — 3 left in
        list contexts, all of them events. Alternative: keep per-row regions and rely on screen
        readers to coalesce, which they do not.
    (b) **One age vocabulary, and it is `formatAge`'s** (`formatReset.ts:50-59`). 59 strings on
        the canvas — `2 min ago`, `1 h 54 min ago`, `22 s ago` — were forms the shipped formatter
        cannot produce, so the design was quietly specifying a second one. Where second-level
        precision matters the absolute clock is already on the line. Alternative: give `formatAge`
        a sub-minute arm, which is a third shipped-code fix for a cosmetic gain.
    (c) **A choice and a list of actions take different ARIA roles** (§12.12). Eight bare
        `.opts` groups became five `role="group"` and three `role="radiogroup"`, and `aria-current`
        — present on three, missing from five — became `aria-checked` on every radio.
    (d) **The focus ring gets an answer per ground** (§13.6), and the slab gets none, because the
        obvious inherited fix measured 1.08 (§12.13).
    Three frames were added to draw states the design asserted but had never shown: `1d` keyboard
    focus, `1e` a lane reading `~ inconclusive` **at card scale with the roll-up counting it** —
    §12.4 had specified that roll-up form while the canvas had only ever drawn the reading inside
    a probe sheet — and `1f` the first paint, whose `Skeleton` the accounts screen already ships
    (`AccountsScreen.tsx:190`) and which this design makes last longer by adding a health field to
    the same poll.

### Evidence to collect before the plan is written (each is one command or one pane)

- On the server box: the scheme of `CCRC_AGENT_URL` (names only; `sed -n 's#^CCRC_AGENT_URL=\([a-z]*\)://.*#\1#p'`), and `sha256sum ~/.ccrc/accounts.json` on both boxes (the fleet box's is `da6b3527…` today).
- A human runs `CLAUDE_CONFIG_DIR=$(mktemp -d) env -u CLAUDE_CODE_OAUTH_TOKEN ~/.local/bin/claude setup-token` once in a scratch tmux window, records every line and prompt verbatim, and cancels before completion; the helper's fake-`claude` replay fixture is written from that transcript.
- A human opens `/status` in one env-token lane and one upstream-lane pane and records whether Remote Control reports connected (spec-August Q4; does not change this design, but settles what the row may say).
- `claude auth login --claudeai` prints `Opening browser to sign in…` before the URL: on the fleet box there is no display, so the attempt falls through to printing and the flow works. The helper must not DEPEND on that being accidental — find whether the attempt can be suppressed explicitly (and record the answer, including "it cannot"), so a fleet box that ever grows a display does not open a browser nobody is sitting at.
- `claude auth status --json` on an AUTHENTICATED lane: the unauthenticated shape is measured (`{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty", "analyticsDisabled": false, "projectsDirectory": …}`, exit 1); what a signed-in lane adds — and whether it names an account, which would be a label this repo may not commit — is not. Capture it, redact it, and let it decide what the fold may quote.

## 16. Supersessions of the August spec

| August | now |
|---|---|
| §4 four providers incl. `cortecs`, api-key Anthropic | four provider ids — `cortecs` returns as an INSTANCE of the generic `compatible` lane rather than a name in the table (decision 22); Anthropic stays subscription-only |
| §5 api-key wrapper template, widened `_wrap_parse_shape` | wrapper unchanged; provider config in `settings.json` env — the base URL rides that block, so the generalisation this table's row above restores costs no shape change at all |
| §8.1 HTTPS via `tailscale serve`, box-token gating | Caddy/DuckDNS; session-gated; config-stated HTTPS refusal |
| §8 helper prints only a marker line | helper is a pty proxy with a status file; code delivered by `send-keys` |
| §10 remove deletes `.cc-limits` only | also markers and `.home` prefs; never the config dir |
| §11.1 migration table | no migration: every field absence-permitting; two JSON edits by hand |
| §12 "no new exec-whitelist entry" | one flag-anchored grant, `account-pane`, argued in §6 |
