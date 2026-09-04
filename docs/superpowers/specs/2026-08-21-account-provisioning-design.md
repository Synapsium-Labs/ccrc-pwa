# Account provisioning — design

**Date:** 2026-08-21
**Status:** design approved in conversation; this document awaits operator review before any plan is written.
**Depends on:** the `~/.local/bin/claude`-is-not-a-wrapper invariant fix currently in flight on
`ws/ccrc-adopt-and-wrappers-upstream-account`. That branch must land on `main` first — see §11.4.

---

## 1. Why

Adding an account to the fleet is today an undocumented manual procedure: hand-write a wrapper in
`~/.local/bin`, hand-write a secrets file, hand-edit `~/.ccrc/accounts.json`, hope the three agree.
The evidence that this does not hold is a standing `ccrc doctor` FAIL on both boxes and two orphan
warnings that have been tolerated long enough to become scenery.

The roster is already data and `ccrc wrappers` already converges it. What is missing is the vocabulary
to describe **what authenticates an account** — so nothing can converge a credential, nothing can
measure whether an account actually works, and there is no verb to create one.

This design adds that vocabulary, then builds the verb on it.

## 2. Scope and slices

| slice | deliverable |
|---|---|
| **A** | the roster learns providers and credentials; the three hand-written wrappers are described honestly; `cck3` becomes generated and proves the api-key template. **§3.6 grew this from two commits to five** — the migration mechanism, the shape validator and the equivalence triple are all prerequisites that do not exist yet |
| **A2** | credential *health*: a dead account becomes nameable instead of silently routed around |
| **B1** | `ccrc account add` for api-key providers — CLI verb plus a PWA form |
| **B2** | the OAuth pane flow, shared by `account add` and a new `account reauth` |
| **B3** | `ccrc account remove`, with automated rehoming of every session the account was home to |

Every slice has a UI surface, and they all land on one screen — **§9 gathers them in one place** so the
PWA work is not scattered across four sections.

Deferred, to be decided with evidence rather than now:

- **C** — kind-aware limits. An API-key account has *spend*, not a weekly *pool*; today it opts out of
  scoring entirely via `telemetry: 'none'`. §7.5 names the seam; this design does not build it.
- **D** — proxy lifecycle. Promoting `handoff-proxy` to a managed unit. The lazy `nohup` bootstrap in
  the existing wrappers works; nothing yet demands better.

## 3. Evidence base

Every claim below was measured on 2026-08-21 against the installed Claude Code 2.1.238 and the live
fleet, or read from the shipped source. Claims that could not be evidenced are in §13, not here.

### 3.1 Long-lived tokens

1. `claude setup-token` is current and carries **no deprecation marker**. This is an evidenced
   negative, not an absence of information: the same binary carries explicit deprecation strings for
   other surfaces (`--max-thinking-tokens`, `includeCoAuthoredBy`), and no deprecation wording appears
   near any auth/token/setup string.
2. The documented horizon is **one year**, the token **prints once and is saved nowhere**, and there
   is no refresh. Nothing in the CLI will warn before the cliff; the `/login` three-day expiry warning
   explicitly does not cover env credentials.
3. Anthropic is actively *repairing* long-lived token handling (changelog v2.1.219–v2.1.234) and still
   recommends `setup-token` as the subscription credential for CI. This is investment, not withdrawal.
4. **A version floor follows from that repair work.** v2.1.225/228 fixed a transient 401 replacing a
   long-lived `CLAUDE_CODE_OAUTH_TOKEN` with a stored login's short-lived token, wedging headless
   sessions until restart. Any box relying on the env token needs **>= 2.1.228**.
5. Long-lived tokens are scoped **inference-only and cannot establish Remote Control**. Verbatim from
   the binary: *"Remote Control requires a full-scope login token. Long-lived tokens (from
   `claude setup-token` or CLAUDE_CODE_OAUTH_TOKEN) are limited to inference-only for security
   reasons."* The docs corroborate. The refusal is a hard exit, not a degraded session.
6. **The forward risk is not deprecation — it is a default change that bypasses the token.** `--bare`
   never reads `CLAUDE_CODE_OAUTH_TOKEN` and is documented to become the default for `-p` in a future
   release. When that lands, every non-interactive subscription-token invocation silently loses its
   credential.
7. An undocumented refreshable-env path already ships in the binary: `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`
   with a mandatory `CLAUDE_CODE_OAUTH_SCOPES`, plus client-id and file-descriptor variants, all absent
   from the documented env-var table. **Do not build on it.** It is recorded here only as evidence that
   a successor mechanism exists, which is why §5.4 records *how* a credential was minted.

### 3.2 How a dead credential presents

8. Measured: an invalid token exits **1** with the message on **stdout** and **stderr completely
   empty**. Any supervisor classifying health by scraping stderr sees nothing at all.
9. The docs state the rule generally: stderr means the invocation was malformed; stdout means the run
   started and failed. A credential problem is always the second kind, so it is indistinguishable from
   a normal answer by stream alone. Parse it; do not sniff it.
10. `--output-format json` is the robust path: `is_error: true`, `api_error_status: 401`,
    `terminal_reason: "api_error"`. **`subtype` is `"success"` even on a hard auth failure** — it is not
    a health signal.
11. `claude auth status --json` answers `loggedIn: true` for deliberate garbage. It reports which
    source was *selected*, not whether it works. **Not usable as a health probe.**
12. **No on-disk field distinguishes alive from dead.** The credential serving a live session today
    carries `expiresAt: 0` and a `refreshTokenExpiresAt` eight days in the past. Health cannot be read
    from a file; it costs one inference request.
13. There are **two** credential artifacts per lane — the env token and a rotating `.credentials.json`
    — and revoking either produces the same unnamed login screen. A check that tests only the env token
    reports green on a lane whose refresh token was revoked.

### 3.3 What the fleet does today when a credential dies

14. **Placement ranking is correct and needs no fix.** `_avail` is deliberately permissive because it
    answers eligibility, not rank; `_ws_least_loaded` *skips* an unmeasured account (with a fallback for
    an all-unmeasured fleet); `_swap_target` ranks unmeasured at **100** against `SWAP_CEILING` **98**,
    so a measured candidate always outranks an unmeasured one while a rescue can still land. The shipped
    rule, stated in `ccd`'s own comment: *unmeasured never OUTRANKS measured, and never becomes
    INELIGIBLE.* An earlier draft of this design claimed a self-amplifying routing bug here. It was
    wrong; the defect it described was fixed in a prior review round and the source documents it.
15. **The rescue works; the naming does not.** `ccd` states it plainly: *"auth loss writes NO telemetry
    (nothing marks cc-limits on a 401)"* — which is precisely why the `force`/`hard_blocked` path exists
    to bypass the "home is fine, stay" shortcut. So a session does get rescued off a dead account.
16. But for a **home-able** account the rescue writes no durable marker, and all four Anthropic
    accounts are home-able. A successful rescue never tells the operator an account died. The only trace
    is one line in `~/.cc-sessions/swap.log`, which has zero consumers in `server/`, `agent/` or `pwa/`.
17. At **spawn**, a dead token does land in a durable named state (rc 2 -> `login`, rc 5 -> `blocked`,
    stamped into the registry, rendered as a PWA chip). Mid-run, it lands in **no** named state: the
    spawn field describes only the last spawn (its own docstring says so), and `_session_state`'s
    seven-word vocabulary has no auth member. A pane sitting at an auth banner with a fresh heartbeat
    reads exactly `running`.
18. No read-only `ccd` verb can name it. `ccd ls` prints the lifecycle; `ccd ws-audit` prints
    alive/started/unit. An operator on the box cannot ask "which sessions cannot authenticate?" while
    the PWA can — which inverts the normal degrade direction, since the CLI is the fallback when the
    server is down.
19. `_pane_hard_blocked` collapses "rate-limited" and "auth lost" into one boolean and the log line
    says only `(blocked)`. Two conditions an operator handles differently — wait out a window versus
    re-authenticate — reduced to one word. **An overloaded value at a seam by this repo's own
    definition.**
20. Detection is tmux pane-text scraping for literal vendor banners, pinned in tests against *fixture*
    strings rather than the real binary's output. A Claude Code release that rewords its auth banner
    silently deletes the entire detection lane and **no test goes red**.
21. The mid-run detector reads `tail -8`; the spawn-time detector reads the whole pane. The narrow
    window is the one that could catch a mid-run revocation. Widening it re-opens a documented
    false-positive on restored scrollback, so this is a real trade, not an oversight.
22. **The mail delivery gate will hand work to a session that cannot authenticate.** A login-screened
    session runs no tools, so it fires no hooks, so its hookstate freezes at the last value — and
    `SessionStart` writes `done`, the exact word the gate reads as "safe to inject". A wave brief
    delivered to a dead-token worker is consumed by the durable store, acked by nobody, and the
    coordinator re-measures `stale-tip` forever.

### 3.4 The roster against the disk

23. All four subscription secrets files hold **exactly one** variable, `CLAUDE_CODE_OAUTH_TOKEN`.
    Uniform, with no second key anywhere.
24. `secretsFile` is a path that is **deliberately never opened** — stated as an invariant in three file
    headers and pinned by a canary-token test. Doctor compares the roster's path string to the wrapper's
    path string and stops, so a declared-but-missing secrets file is structurally invisible. Existence
    and mode (`test -r`) can be checked without violating the never-print-a-secret invariant.
25. Doctor's 19-entry check table probes GitHub credential validity *and scope* (`gh_auth`) but has no
    check of any kind for a Claude Code account token. **The cold path already accepts one network
    round-trip to prove a credential**, and the timeout constant and FAIL/WARN vocabulary are in place.
26. The `claude-corp` drift is an **un-applied migration**, not a model defect:
    `deploy/accounts.migration.json:26` already declares its `secretsFile`; the live
    `~/.ccrc/accounts.json` is simply stale against it.
27. The `claude` drift is **not reportable at all**. Its secrets file exists and is sourced but is
    undeclared, and the upstream wrapper is unauditable by construction — it must not match the
    predicate that makes a file visible to the wrapper classifier, or every `ccrc install` fails. **Any
    credential check must therefore be driven off the roster, never off the classifier.**
28. **CORRECTED 2026-08-21 (this claim was stale when first written).** `~/.ccrc/accounts.sh` *does*
    carry telemetry: `shared/generate.mjs:210` emits `CCRC_MEASURED` derived from
    `telemetry === 'anthropic'`, shipped 2026-08-13 in `a6a6a01` and pinned by
    `roster-generate.test.ts:130-134`. What is missing is the **consumer**: `_ws_least_loaded`'s loop
    (`ccd:1688-1694`) never reads it, and its own comment (`ccd:1651-1656`) still asserts accounts.sh
    has "no telemetry field at all". So the work is a consumer change plus deleting a stale comment —
    **not** a first emission, and adding a second projection would trip `single-definition.test.ts`.
    This is the second time in this design a source comment proved staler than the source
    (cf. item 14); trust the code, then fix the comment.

### 3.5 The three hand-written wrappers

29. `cck3` is **single-provider**: OpenRouter only, one model map, no runtime switch. Losslessly
    templatable.
30. `claude-glm` is **two-provider**: `case "${HANDOFF_PROVIDER:-cortecs}"` selects Cortecs direct
    (`https://api.cortecs.ai`, `CORTECS_API_KEY`, `glm-5.2`) or OpenRouter via the whitelist proxy
    (`OPENROUTER_API_KEY`, `z-ai/glm-5.2`) — different model names per branch.
31. `gpt` is a program, not a wrapper: a LiteLLM venv, a second home-grown system-folding shim on :4000
    in front of LiteLLM on :4001, a device-code OAuth `login` subcommand, a `_sync_gpt_config` that
    copies plugins and settings out of `~/.claude`, and a `pkill` teardown verb.
32. `handoff-proxy` is a **pass-through**, not a translator: it forwards to `https://openrouter.ai`,
    normalising `/v1/...` to `/api/v1/...`, and injects `provider.only` from
    `~/.handoff/providers-whitelist.json`. So OpenRouter serves the Anthropic wire format natively; the
    proxy exists for the **ownership whitelist**, not for translation.
33. Cortecs needs no proxy at all — `ANTHROPIC_BASE_URL` points straight at it.
34. `litellm-config.yaml`'s own header states it presents the **ChatGPT subscription** (flat-rate, not
    the per-token OpenAI API) as an Anthropic `/v1/messages` endpoint. `LITELLM_MASTER_KEY` is the local
    proxy's own bearer, **not a provider credential**.

### 3.6 What the current pipeline cannot do yet

Measured 2026-08-21 while gathering anchors for the implementation plan. These are not design choices;
they are gates that must be moved before slice A can land, and none of them was known when §11 was
first written.

35. **An api-key wrapper body cannot be installed, and the failure is all-or-nothing.**
    `_wrap_parse_shape` (`ccd/ccrc-wrapper-shape:163-166`) accepts a body of exactly **2 or 3
    significant lines** and hard-matches the first as the `CLAUDE_CONFIG_DIR` export;
    `cmd_wrappers:1458-1460` runs every staged file through it and `_ccrc_die`s the **entire run**
    ("nothing was written") on a `no`. §11.2's body is ~12–15 significant lines. Commit 2 must widen
    that validator — with its own pins — before it can write anything at all.
36. **Equivalence is judged on a three-field triple that cannot see an api-key wrapper's identity.**
    `cmd_wrappers:1509-1512` compares only (target, suffix, secrets). Base URL, the auth-token variable
    and the six model names are invisible, so once api-key wrappers exist, two accounts differing only
    in their model map compare **equivalent** — and `--adopt`/`--force` would rewrite one as the other.
    Widening the reader's output belongs to the same commit.
37. **The wrapper manifest's fields are positional and non-empty by construction (D-71).**
    `IFS=$'\t' read -r kind a b c d` is safe only because every field is always populated. Adding an
    *optional* field silently shifts every later column left with **no parse error** — which here means
    reading a wrapper's `classify` out of the `equal` column and overwriting a file on the strength of
    it. Append, never insert, and widen the reader in the same change.
38. **`parseExec` validates `secretsFile` only inside the `generated` branch.** `shared/roster.ts:299-300`
    return bare `{ kind: 'upstream' }` / `{ kind: 'external' }`, dropping a declared `secretsFile`
    **un-validated**. §5.2 puts it on all three arms, so the path gate must be hoisted out of the
    branch — otherwise `claude`'s newly-declared secrets file (§11.1's first row) reaches
    `shared/wrapper.mjs`'s double-quoted bash embedding without ever passing it.
39. **`warnUnknownKeys`' exec key sets are split by kind on purpose** (`EXEC_KEYS_BASE` /
    `EXEC_KEYS_GENERATED`, `roster.ts:225-226`) so a typo'd `secretFile` warns instead of vanishing —
    the comment records that the account then "launches with no OAuth token and no diagnostic
    anywhere". Adding `provider`/`auth`/`models`/`providers` without splitting into **three** per-arm
    key sets reopens exactly that hole.
40. **`single-definition.test.ts` is blind to the file where a second `PROVIDERS` copy would land.** It
    scans `/\.tsx?$/` only, across four roots, and its bash scanner skips dotted extensions — so
    `shared/generate.mjs`, `shared/roster-json.mjs` and `deploy/gen-wrappers.mjs` are invisible to
    **both** scanners. Its `oneDefinition` helper additionally hardcodes `shared/api.ts` as the sole
    legal home, so it cannot be reused for a table living in `shared/roster.ts`. §11.1's mutation 3
    therefore needs a new describe with its own fingerprint and its own positive control.
41. **`shared/roster-json.mjs` is a bare-`node` mirror that may be stricter than `parseRoster`, never
    laxer** — enforced by `gen-accounts.test.ts`, which runs `deploy/gen-accounts.mjs` as a subprocess
    and compares stdout **byte-for-byte** against the TypeScript path over four rosters. Every new
    validation rule lands in both, and `assignHues` must stay byte-identical across the two.
42. **Tightening `ExecSpec` produces ZERO compile errors and breaks ~18 fixtures at runtime.** Every
    fixture roster enters through `parseRoster(json: unknown)` or `seedRoster(roster: unknown)`, so
    §5.3's derived-union safety does not reach them. The highest-leverage single object is
    `server/test/helpers.ts`'s `DEFAULT_TEST_ROSTER`, whose `claude-corp` is `generated` with no
    `secretsFile`: requiring it breaks nearly every server test at `loadConfig` until that one literal
    is fixed, and `server/test/fixtures/ccdMirror.ts` throws at import on disagreement with it.
43. **Doctor's `wrappers` check is already four buckets with pinned order and pinned remedy strings.**
    Verdict order is asserted by index (`failIdx[0]`/`failIdx[1]`), so a new line inserted anywhere but
    the end shifts what every `lineFor`-based test compares, and each bucket's remedy prefix is its
    pin. Adding a table entry costs four separate green-suite constraints: the bijection test, "runs
    every check in the table", the output-shape arithmetic over two fixtures, and the summary total.
44. **The PWA has no local typecheck gate.** `pwa`'s vitest run does not typecheck; the gate is
    `npm run build` in CI's separate `build-pwa` job. A PWA change that compiles nowhere locally passes
    `cd pwa && npm run test` and fails CI.
45. **The agent's `rosterFp` is `bodyDigest(generateAccountsSh(roster))`**, compared by
    `rosterAgreement`. Any change to what `accounts.sh` contains makes server and agent report
    disagreement until **both** boxes ship — which is why §11.3's agent-first ordering is mandatory
    rather than stylistic.

## 4. The provider whitelist

The line between "a roster row" and "a program" is not Anthropic-versus-not. It is **whether the
provider serves the Anthropic `/v1/messages` wire format** (§3.5, items 32–34).

| provider | wire | auth | endpoint | ccrc can generate |
|---|---|---|---|---|
| `anthropic` | native | `oauth`, `api-key` | default | **yes** |
| `openrouter` | native | `api-key` | local proxy :8642 (whitelist) | **yes** |
| `cortecs` | native | `api-key` | direct `https://api.cortecs.ai` | **yes** |
| `openai` | needs translation | `oauth` (ChatGPT sub) | LiteLLM + folding shim | **no** |

```ts
export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic', wire: 'anthropic-native',
    endpoint: { kind: 'default' },
    auth: {
      oauth:     { envVar: 'CLAUDE_CODE_OAUTH_TOKEN', scope: 'inference-only' },
      'api-key': { envVar: 'ANTHROPIC_API_KEY',       scope: 'full' },
    },
  },
  openrouter: {
    label: 'OpenRouter', wire: 'anthropic-native',
    endpoint: { kind: 'local-proxy', port: 8642, bin: '.local/bin/handoff-proxy' },
    auth: { 'api-key': { envVar: 'OPENROUTER_API_KEY', scope: 'full' } },
  },
  cortecs: {
    label: 'Cortecs', wire: 'anthropic-native',
    endpoint: { kind: 'direct', baseUrl: 'https://api.cortecs.ai' },
    auth: { 'api-key': { envVar: 'CORTECS_API_KEY', scope: 'full' } },
  },
  openai: {
    label: 'OpenAI', wire: 'needs-translation',
    endpoint: { kind: 'external-stack' },
    auth: { oauth: { envVar: 'LITELLM_MASTER_KEY', scope: 'full' } },
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

// Generatability derives from `wire` at BOTH the value and the type level, so the
// runtime menu and the compile-time constraint cannot disagree.
export const GENERATABLE = PROVIDER_IDS.filter((p) => PROVIDERS[p].wire === 'anthropic-native');
export type GeneratableId = {
  [P in ProviderId]: (typeof PROVIDERS)[P]['wire'] extends 'anthropic-native' ? P : never;
}[ProviderId];
```

**The credential variable hangs off the `(provider, auth)` pair, not off the provider**, because
Anthropic's two methods read different variables — `CLAUDE_CODE_OAUTH_TOKEN` for a subscription,
`ANTHROPIC_API_KEY` for a key. Putting `envVar` on the auth entry is also what lets §5.4 *derive*
credential scope from the same place instead of storing it separately.

One honesty caveat on `openai`. Its declared `envVar` is the **local proxy's own bearer**, not an
upstream credential (§3.5 item 34); the real ChatGPT credential is a token *directory* this design does
not model. So availability for a `needs-translation` provider is partial by construction, and doctor
must report it as partial rather than a green it cannot justify.

`openai` is **in** the whitelist as a provider ccrc knows and cannot generate for — not omitted. That
keeps `gpt`'s credential measurable by doctor while `account add`'s menu filters itself. Generatability
**derives** from `wire` rather than being a second hand-maintained flag, per the house rule that
single-source values are enumerated once and derived (`PR_REASONS = Object.keys(PR_REASON_MAP)`).

`single-definition.test.ts` must see exactly one copy of this table.

## 5. Roster model

### 5.1 `external` is a destination, not a waypoint

`external` means: **a human owns this wrapper's body; ccrc records that the account exists, what config
dir it claims and what credential it needs, and never writes the file.** `claude-glm` and `gpt` are
`external` permanently. Templating them would mean either dropping real behaviour (`claude-glm`'s
runtime provider switch) or expressing a venv, two chained proxies, an OAuth subcommand and a
config-sync in JSON — which is a shell script with extra steps, not a data model.

### 5.2 The credential requirement lives inside `ExecSpec`

```ts
export type ExecSpec =
  | { kind: 'upstream'; provider: 'anthropic'; auth: 'oauth'; secretsFile?: string }
  | GeneratedExec
  | { kind: 'external'; providers: ProviderId[]; secretsFile?: string };

// One arm per generatable provider, so `auth` can only name a method THAT provider offers.
export type GeneratedExec = {
  [P in GeneratableId]: {
    kind: 'generated';
    provider: P;
    auth: keyof (typeof PROVIDERS)[P]['auth'];
    secretsFile: string;   // required — a generated account always carries its own credential
    models?: ModelMap;     // the emitter requires it for every non-anthropic provider (§11.2)
  };
}[GeneratableId];

export type ModelMap = {
  model: string; small: string; haiku: string;
  sonnet: string; opus: string; subagent: string;
};
```

Because the *shape* of the requirement differs by who owns the body. `external` takes a **list**:
`claude-glm` genuinely needs either `CORTECS_API_KEY` or `OPENROUTER_API_KEY` depending on
`HANDOFF_PROVIDER`, and declaring one would narrow a distinction we received. This is not speculative
generality — there is one real user today.

The union makes illegal states unrepresentable: a `generated` account cannot declare two providers, and
an `external` account cannot carry a model map ccrc would never write.

`secretsFile` survives on **all three** arms — optional on `upstream` (the real binary may authenticate
from a stored login instead), optional on `external` (a human's wrapper may source nothing ccrc can
name), required on `generated`. Dropping it from the union would make §11.1's very first row —
declaring `claude`'s undeclared secrets file — unrepresentable.

The operator still answers exactly one provider and one auth, because `account add` only ever creates
`generated` accounts. The list exists solely to describe hand-written wrappers honestly.

### 5.3 Auth is constrained by provider at compile time

```ts
export type AccountAuth =
  { [P in ProviderId]: { provider: P; auth: keyof (typeof PROVIDERS)[P]['auth'] } }[ProviderId];
```

Derived from the one table, so `{ provider: 'openrouter', auth: 'oauth' }` is a **compile error** rather
than a runtime validation. No second copy of the whitelist exists to drift.

### 5.4 Credential scope is derived, not stored

Per §3.1 item 5, a `setup-token` credential is inference-only and cannot establish Remote Control. The
operator has ruled that **Remote Control is not in use** (`~/.ccrc/remote-control` is `on` on the fleet
host and absent on the server box, but nothing depends on it establishing), so this design **records the
scope rather than chasing it**.

Scope is read from the `(provider, auth)` entry in §4 — `anthropic.auth.oauth.scope` is
`'inference-only'` — so it is **derived from the one table, not a fifth field to keep in sync**. The
rule it encodes:
*"has a credential" and "can be remote-controlled" are two different facts and must not collapse into
one field.*

### 5.5 The secrets file

Every account's credential is **one variable in one file** (§3.4 item 23), and *which* variable comes
from the `(provider, auth)` entry in §4 — never from a second list:

- subscription: `CLAUDE_CODE_OAUTH_TOKEN` in `~/.cc-secrets/<id>-oauth.env`
- api key: the provider's `envVar` in `~/.cc-secrets/<id>-<provider>.env`

Both 0600, one variable per file, matching the shape already on disk. The shared `~/.handoff/env` is
untouched: its accounts stay `external`, so nothing migrates.

`secretsFile` remains a path that is never opened **for content**. Existence and mode are fair game
(§7.1) and nothing checks them today.

## 6. What the operator provides

One name, one provider, one secret — plus model names when the provider is not Anthropic.

| account type | the secret | where they get it | models |
|---|---|---|---|
| Claude subscription | `CLAUDE_CODE_OAUTH_TOKEN` | ccrc runs `setup-token`; they approve in a browser | none |
| Anthropic API key | `sk-ant-…` | console.anthropic.com | none |
| OpenRouter API key | `sk-or-…` | openrouter.ai/keys | **required** |
| Cortecs API key | key | cortecs.ai | **required** |

Four flat menu items, not a nested provider-then-auth question: a subscription is **always** OAuth
(operator ruling, and it is what all four existing accounts already do), and an Anthropic API key is a
separate account *kind* rather than a second way to authenticate a subscription.

**Four questions, not nine.** The id answers five at once — the binary `~/.local/bin/<id>`, the config
dir `~/.claude-<id>`, the secrets filename, the session-id prefix, and the `ccd` case arm. It is
validated against the existing `^[a-z][a-z0-9-]{0,31}$` and refused on collision with any account or
binary.

Everything else **derives and is never asked**: `configDirSuffix` from the id, `hue` = next free in the
palette, `telemetry` = `anthropic` for a subscription and `none` otherwise, `exec.kind` = `generated`,
`homeAble` = true for subscriptions and false for api-key workers (overridable by flag).

The secret is read on **stdin, never argv, never echoed**. That discipline is inherited, not
re-derived: `ccrc passwd` leaked a passphrase into terminal scrollback because bash restarts an
interrupted `read` after a trapped handler, and then *accepted* it under a banner promising the
interrupt aborts.

Then ccrc acts: write the secret 0600 -> write the roster entry -> converge the wrapper -> **smoke-test
it**, running the new wrapper on one trivial prompt and requiring a real answer. That last step is the
acceptance gate and the reason this is a verb rather than a runbook: a typo'd key fails in the ten
seconds the operator is standing there, not three days later when a wave dispatches a worker into it.

**A generated OpenRouter account routes through `handoff-proxy`, not straight at `openrouter.ai`.** The
proxy exists so a provider absent from `providers-whitelist.json` cannot serve; a generated account
going direct would silently open the hole the proxy was built to close.

## 7. Credential health — slice A2

### 7.1 What health can and cannot be

It cannot be read from disk (§3.2 item 12) and it cannot be asked of `claude auth status` (item 11). It
costs **one inference request**, classified on `api_error_status == 401` together with
`terminal_reason == "api_error"` — never on `subtype`, which reports `"success"` even on a hard auth
failure, and never on the human-readable string.

Doctor already has the precedent: `gh_auth` spends a network round-trip to prove a credential inside the
19-entry table, with the timeout constant and FAIL/WARN vocabulary in place. A new
`_check_account_tokens` entry belongs in that table, driven **off the roster** (§3.4 item 27), with the
bijection test in `server/test/ccrc-doctor.test.ts` pinning it.

Two tiers, because they cost differently:

- **Free, and nothing does it today:** does the account have a credential *source* at all — a readable
  secrets file defining the expected variable, or a readable `.credentials.json`. Existence and mode
  only, never content, so the canary test still passes.
- **One round-trip, cold path only:** is the credential *accepted*.

### 7.2 A dead account must be nameable

The gap is mid-run, not at spawn (§3.3 items 17–18). "Cannot authenticate" is a fact about *now* that
only the spawn-time lane can currently express, and the spawn field's own docstring forbids reusing it.
So a mid-run auth verdict needs **its own registry field and its own wire member**, mirroring
`swapblocked` — the existing precedent for a durable, PWA-rendered, mid-run fault marker that reaches
the fleet wire within one tick. Additive only; `FLEET_PROTO` is not bumped.

It must also be answerable **on the box**: a read-only `ccd` verb has to be able to say which sessions
cannot authenticate, or the CLI stays worse-informed than the PWA it is meant to back up.

### 7.3 Un-collapse the classifier

`_pane_hard_blocked` must return **which** class it matched (§3.3 item 19). The rescue may still treat
both identically — that is a correct policy — but the log line and any durable marker must not, because
the operator's next action differs: wait out a window, or re-authenticate.

### 7.4 Make the detection lane load-bearing

The auth-banner regexes are pinned against fixture strings, so a vendor rewording deletes detection
with no test going red (§3.3 item 20). The fix is not a better regex — it is to stop depending on the
TUI's copy where a machine-readable signal exists. `--output-format json` gives one for any probe ccrc
initiates. Pane scraping remains necessary for a *human-driven* interactive session, so it stays, but it
must no longer be the **only** lane.

The `tail -8` versus whole-pane asymmetry (item 21) is a documented trade and is **not** resolved by
this design. It is recorded for the plan to weigh, with the false-positive it protects against stated.

### 7.5 Two consumers that must respect health, and one seam left open

- **The mail delivery gate** needs a conjunct beyond `hs.state === 'done'` — something meaning "and
  this session can actually take a turn" (§3.3 item 22). Coordination correctness depends on it.
- **`--bare`** (§3.1 item 6) is a dated external deadline. Wherever a subscription token is the intended
  credential, the non-bare mode must be explicit, with a test that goes red if a `-p` path stops
  carrying the token.
- **Left open, deliberately:** whether a health signal should feed placement *eligibility*. Placement
  ranking is already correct (§3.3 item 14) and `_avail`'s permissiveness is load-bearing for the
  rescue. Making a dead account ineligible is a behaviour change to a working mechanism and is slice C's
  question, not this design's.

## 8. The OAuth flow through the UI — slice B2

*(Where this renders: §9.5.)*

A headless box cannot complete a browser flow, so the URL must reach the operator's phone. The flow is
interactive and multi-round-trip: `setup-token` must stay alive between "here is the URL" and "here is
the code", which no one-shot exec frame can carry.

**The vehicle is a tmux pane** — the shape ccrc already exists to drive. Not a new interactive exec
surface across the agent link, which is precisely what `EXEC_COMMANDS = ['tmux','ccd']` and one-shot
`CcdArgv` exist to prevent, and which would own a lifecycle problem the pane gets for free.

**But the pane runs a ccrc-owned helper, not `setup-token` directly.** `setup-token` prints the token to
stdout, and pane output reaches the browser, the pane history and `.cc-clips`. The helper captures the
token straight into `~/.cc-secrets/<id>-oauth.env` at 0600 and prints only two things: the URL on a
known marker line, and a redacted confirmation. So the pane stays safe to render and clip, and the URL
is machine-detectable *because ccrc chose the format* — which is what makes it a tappable button rather
than text to select on a phone.

**Pinned by test: the token must never appear in anything renderable.**

`ccrc account reauth <id>` is `add` minus the roster write. So B2's deliverable is **the OAuth pane flow
as a reusable unit**, with two callers. That also sets its priority: with a one-year horizon and no
refresh (§3.1 item 2), re-authentication is a **recurring** operational chore across five wrapper HOMEs,
usually performed when something is already broken. It has to be pleasant on a phone.

Because nothing exposes a token's real expiry (§13), ccrc records the **mint date** at `add`/`reauth`
time and warns ahead of the one-year cliff. That is the only available pre-warning.

### 8.1 Transport

These routes carry a provider credential. `account add` over the plain HTTP listener would put an API
key on the wire in clear; inside the tailnet that is WireGuard-encrypted rather than naked, but the
secret-bearing route must **refuse unless reached over the HTTPS path** (`tailscale serve` :8443) and be
gated on the box token like every other coordination write. This is also the first genuine operational
reason to arm Stage 3a's auth on the live box, which so far has had none.

## 9. UI surfaces

Everything below lands on the **existing** `pwa/src/screens/AccountsScreen.tsx`. No new screen: it
already polls `GET /api/accounts`, merges roster against usage (`rowOrder`), renders a `Bar` per account
for the 5h and 7d windows with their reset times, and since Stage 3a hosts `AuthSection` (passkey list,
revoke, sign out). Provisioning belongs beside the accounts it provisions.

Primitives are reused rather than reinvented: `Sheet` (`open`/`onClose`/`title`/`eyebrow`/`full`),
`QuickConfirm`, `Toast`, `StatusDot`, `Skeleton`, and `lib/accounts.ts`, which already resolves an
account's label, hue, colour variable and home-ability from the roster.

### 9.1 The wire field, added once

`RosterWire` is `{ id, label, hue, homeAble }` today. It gains `provider`, `auth` and an availability
verdict — additively, with no `FLEET_PROTO` bump. The docstring immediately below it in `shared/api.ts`
records why this must go through the one shared interface: the same shape was once restated by hand in
the handler's return, the PWA's fetch generic and the route test's cast, and it names that as *"exactly
the shape of change where two get the new field and the third quietly drops it, with no compiler
anywhere to notice"*. One interface, three importers.

### 9.2 Slice A — the row tells the truth

Each row gains a **provider chip** and an **availability state**. Three states, never collapsed into a
boolean:

- **ok** — rostered, credential present here
- **unavailable here** — rostered, credential absent on this box (§11.1's per-box measurement)
- **undeclared** — a wrapper exists that no account describes

These are the same three verdicts `ccrc doctor` reports: one vocabulary, two renderers. A divergence
between what the CLI says and what the row shows is the drift this design exists to end.

**A `telemetry: 'none'` account must not render two 0% bars.** It has no weekly pool, so the `Bar` pair
is replaced by an explicit "no usage telemetry" state. Two empty bars read as *completely free* — which
is the PWA-side of the same unknown-is-not-zero rule §3.4 item 28 covers for bash, and the same mistake
`_ws_least_loaded`'s own comment records having already made once.

### 9.3 Slice A2 — a dead account is visible

The row carries a credential-health state, and a session that cannot authenticate gets a chip in the
**same slot `swapblocked` already uses** (§7.2) rather than a second chip system.

Health is a cold-path measurement that spends an inference request, so the UI shows **when it was last
measured** and offers a manual re-check. It never poll-probes: a screen refreshing health on an interval
would spend one request per account per interval, a cost the operator never asked for.

### 9.4 Slice B1 — Add account, api-key path

A `Sheet` from the Accounts screen: **+ Add account**. Fields in the order §6 establishes — id, provider
(menu filtered to `GENERATABLE`, so `openai` never appears), the secret as a single password field, and
the model map for non-Anthropic providers, pre-filled with the known-good default.

- **Submit is gated twice.** The route refuses unless reached over HTTPS carrying the box token (§8.1);
  the button is *also* disabled, with a stated reason, when the page was loaded over plain HTTP. The
  disabled button is a courtesy and the route is the mechanism — both, because either alone is wrong.
- **The sheet does not close on "created".** It stays open through the smoke test, because "account
  created" is not the signal the operator needs; "account works" is.
- **Failure states are named, not generic:** id collision, invalid credential (a 401 from the probe),
  provider unreachable, and the model's provider missing from `providers-whitelist.json`. Each implies a
  different next action, so each gets its own message.
- Offline is a refusal, never a half-submit — `lib/offline.ts` exists and the sheet must consult it.

### 9.5 Slice B2 — the OAuth flow, on a phone

The same sheet, subscription path. Once the roster entry and wrapper have converged, a pane runs the
ccrc-owned helper (§8) and the PWA reads its marker line to render the authorization URL as a **large
tappable button**, with one code field beneath it. Making that URL tappable *is* the feature: selecting
a URL out of terminal text on a phone is the failure the marker-line format exists to prevent.

The pane stays viewable behind a disclosure, using the existing session-pane render, so a stuck flow is
debuggable without leaving the sheet.

**`reauth` reuses this component unchanged**, minus the roster write, entered from the row's own
overflow rather than from `+ Add account`. With a one-year horizon, no refresh and five wrapper HOMEs
(§3.1 item 2), re-authentication is a recurring chore usually performed when something is already
broken — so it earns a first-class entry point on the row, not a buried one.

**The token never renders.** The helper prints only a redacted confirmation, and a test pins that no
rendered output carries it.

### 9.6 Not built

- **No new screen.** Accounts is the home.
- **No irreversible purge from the UI.** Removal *is* supported (§10), but only its reversible half:
  the config dir — which holds session transcripts — is purged only by a human at a terminal, in the
  same family as `ws-reap`.
- **No roster editor.** The roster is converged from data, not hand-edited through a UI. A UI that let
  you edit it directly would reintroduce precisely the drift this design removes.

### 9.7 Slice B3 — Remove account

Entered from the row's overflow, never a bare button. The sheet shows the **measured plan before
anything acts**: how many sessions get rehomed and to which account, how many live sessions get swapped
off, which files are removed, and — stated prominently — that the config dir is **kept** with its size
and transcript count, and that the credential is **not revoked at the provider** (§10.5).

Refusals render as refusals with their reason, not as a disabled button: upstream account, last
home-able account, external wrapper (§10.3).

Confirmation is **typing the account id**, not tapping. The blast radius is other sessions' homes, which
is precisely the case where a mis-tap must not be sufficient.

### 9.8 Mutation tests

1. Collapse the three availability states into a boolean -> red.
2. Render a `Bar` pair for a `telemetry: 'none'` account -> red.
3. Let the token reach rendered output -> red.
4. Close the add sheet before the smoke test answers -> red.
5. Drop `provider` from the shared `RosterWire` while the handler still sends it -> typecheck red in
   **all three** importers, not one. The PWA leg does **not** come from the fetch generic:
   `pwa/src/lib/api.ts:356` is `getJson<AccountsResponse>(…)`, which emits no diagnostic for a removed
   field. The provider chip component is what makes that third leg fail, so the mutation is measured
   against the component. Two further readers must be handled in the same change:
   `accounts-route.test.ts:178` pins the wire key set **exactly** (`['homeAble','hue','id','label']`)
   and is the only structural proof that `secretsFile` never reaches a browser — update it to the new
   exact set, never relax it to `toContain`; and `pwa/src/lib/offline.ts`'s `isRosterWireLike` is a
   *fourth* reader the `AccountsResponse` docstring does not name, which would start lying about every
   pre-upgrade `localStorage` snapshot if a new field were required.

## 10. Removal and rehoming — slice B3

Addition without removal is half a lifecycle. Removal is the harder half, because an account is not just
a wrapper and a key — it is the **home** of some set of sessions, and homes are load-bearing.

### 10.1 Two impact sets, two different failure modes

`_home_for` reads the registry's `home` file first and falls back to `_ccrc_id_wrapper`, the generated
`case` over id prefixes whose final arm is `*) echo "$CCRC_UPSTREAM"`. `ccd prefer <id> <wrapper>` writes
an explicit home — that is what "pinning" is — and `_ws_seed_home` seeds one once and **never clobbers a
deliberate choice**.

Measured on the live fleet: **22 sessions carry an explicit `home` file, and the id prefix routinely
disagrees with it.** `claude2-expoAI-assistant` is homed on `claude`; `claude-corp-acme-platform-ts`
is homed on `claude`; `claude-rp-llm` is homed on `claude2`. A session's home therefore cannot be
inferred from its id, and removal splits into two sets that fail differently:

1. **Sessions whose `home` file names the account.** After removal `_home_for` returns a wrapper that no
   longer exists. `cmd_prefer` validates against `CCRC_ACCOUNTS` **on write**, and nothing re-validates
   on read — so the session sits permanently away-from-home, with a home that can never recover.
2. **Sessions with no `home` file whose id prefix encoded the account.** These do **not** fall to the
   default arm. They fall to whichever *remaining* arm now matches: remove `claude2` while `claude`
   remains, and `claude2-*` matches `claude-*`, silently rehoming to **a sibling account nobody chose**.
   The generator emits arms longest-id-first precisely so prefixes disambiguate — which means deleting
   an arm changes what the *surviving* arms match.

Neither is a crash. Both are durable, silent, and unnameable by any read-only verb — the same shape as
the auth-loss hole in §7.2.

### 10.2 Rehoming is materialisation, not a new policy

One move fixes both: **before the arm disappears, write every affected session's home explicitly.** That
turns an implicit home into a recorded one, and `_ws_seed_home`'s seed-once guard then defends it exactly
as it defends a deliberate `ccd prefer`.

The destination comes from **the rule placement already uses** — `_ws_least_loaded` on the box,
`projectHome` on the server — so removal makes the choice the system would have made anyway instead of
inventing a second placement policy. Sessions running *on* the wrapper are swapped off through the
existing `cmd_swap` path **before** the binary is unlinked, because a respawn against a missing
executable is the one failure that cannot be recovered in place.

### 10.3 What removal refuses

- **The upstream account.** `CCRC_UPSTREAM` (`claude`) is the target of the default arm; removing it
  leaves every unmatched id resolving to nothing.
- **The last home-able account.** `CCRC_HOME_ABLE` is four of five today; emptying it breaks placement.
- **An account with live sessions**, unless rehoming is permitted to swap them off first.
  Refuse-and-explain, never half-act.
- **An `external` wrapper's body.** ccrc drops the roster entry and says plainly that the file belongs to
  a human and stays. Deleting what a human wrote is not ccrc's to do.

### 10.4 What it deletes, and what it deliberately keeps

| artifact | action |
|---|---|
| roster entry | removed |
| `~/.local/bin/<id>` | removed for `generated`; **never** for `external` or `upstream` |
| `~/.cc-secrets/<id>-*.env` | removed |
| `~/.cc-limits/<id>.json` | removed — a stale telemetry file for an account that no longer exists is a lie `_limit_score` would still read |
| `~/.claude-<id>` config dir | **kept by default** |

The config dir is kept because it holds the **session transcripts**
(`~/.claude-<id>/projects/<path>/<uuid>.jsonl`) — the forensic record of every session that ran on that
account. Deleting it is irreversible and destroys history that has nothing to do with the credential.

**The line that follows:** removing the roster entry, wrapper, secret and telemetry is fully
**reversible** — `account add` plus `reauth` reconstructs it. Purging the config dir is **not**. So the
reversible half is an ordinary operation available in the UI, and the purge is human-only at a terminal,
in the same family as `ws-reap`.

### 10.5 What ccrc cannot do, stated

**Removing the secrets file does not revoke the credential at the provider.** It stops *this box* using
it; the token stays valid until revoked upstream, and ccrc has no API for that. The verb must say so
plainly — and §13's open question 2, what the official revocation surface even is, matters here more
than anywhere else in this design.

### 10.6 Verification and mutation tests

Removal ends by **re-measuring** rather than trusting its own steps: no session's `home` names the
removed id, no session runs on it, no `_ccrc_id_wrapper` arm mentions it, the wrapper is absent or
declared external, and `ccrc doctor` is clean.

1. Remove an account while a session's `home` names it, without rehoming -> red.
2. Remove `claude2` with a `claude2-*` session carrying **no** `home` file; assert its home is the
   explicitly-written destination and **not** `claude` -> red if the arm-rematch stays implicit.
3. Remove the upstream account -> must refuse.
4. Remove the last home-able account -> must refuse.
5. Delete an `external` wrapper's file -> red.
6. Purge the config dir without the explicit human step -> red.
7. Leave `~/.cc-limits/<id>.json` behind -> red.
8. Unlink the wrapper before live sessions are swapped off -> red.

## 11. Slice A concretely

### 11.1 Commit 1 — the roster tells the truth

`shared/roster.ts` gains §4 and §5.

**The roster version stays at 1.** Every new field is additive and absence-permitting, so there is no
incompatible change to signal — and bumping would be a flag day across three readers that disagree:
`shared/roster-json.mjs:266` and `shared/roster.ts:523` both refuse `version !== 1`, while doctor's own
inline reader never inspects version at all. A v2 file would therefore kill `_inst_accounts_sh` and so
every `ccrc install`, kill `cmd_wrappers`, and stop the server booting — while `ccrc doctor`'s
`wrappers` check still reported PASS. That is the same rule the wire already follows
(`FLEET_PROTO` is not bumped for a new field), applied to the roster. It also avoids chasing the bare
literal `1` through six sites in three files, and avoids inverting `roster.test.ts:86`, which currently
uses `{ version: 2 }` as its *unknown-version refusal* fixture.

| account | change |
|---|---|
| `claude` | declare the `secretsFile` that exists and is sourced but was never declared (§3.4 item 27) |
| `claude-corp` | **apply the shipped migration** — `deploy/accounts.migration.json:26` already declares it |
| `claude2`, `claude-dev0` | provider/auth added; `secretsFile` unchanged |
| `cck3` | adopted `external`, `providers: ['openrouter']` |
| `claude-glm` | adopted `external`, `providers: ['cortecs', 'openrouter']` |
| `gpt` | adopted `external`, `providers: ['openai']` |

**A migration mechanism has to be built; there is none today.** Both writers of
`~/.ccrc/accounts.json` are create-if-missing — `_inst_roster` (`ccd/ccrc:2102-2105`) and `deploy.sh`'s
`ship_roster` (`deploy.sh:264-270`) — and `deploy/accounts.migration.json` is only ever a **seed for a
box that has no roster**. Nothing applies it to a box that already has one. *That is precisely why
`claude-corp`'s `secretsFile` has been stale since stage 2b (D-69) and why §11.1's second row exists at
all.* So "apply the shipped migration" is not a step; it is a feature.

The migration derives what it safely can — an entry with `upstream`/`generated` exec and an
`-oauth.env` secrets file becomes anthropic/oauth — and makes doctor **FAIL** for what it cannot
derive, the three external accounts, asking the operator to declare them. Fail loud, never guess. It
must be idempotent, and it must run before wrappers are generated from the roster.

**Also in commit 1, because slice A is already touching this seam:** make `_ws_least_loaded` *consume*
the `CCRC_MEASURED` array that `accounts.sh` has carried since 2026-08-13, and delete the comment
asserting it does not exist (§3.4 item 28). This closes the parity gap against `projectHome` that the
function documents against itself. `projected-home.test.ts` already runs both sides over the same
fixtures and is where it is proved.

**The doctor rule that makes the slice worth doing: converge owns files, doctor owns viability.**
`ccrc wrappers` makes the file match the roster; `ccrc doctor` reports whether the account can actually
work *here*. So the server box's missing `claude-dev0` wrapper gets written — that is drift — while its
absent credentials become **WARN: unavailable on this box**, not FAIL, and not roster drift. An
account's definition is fleet-wide; its availability is per-box and **measured, never declared**.

Mutation tests, each measured red before and after:

1. Delete the "generated implies `wire: 'anthropic-native'`" constraint -> a fixture declaring a
   generated `openai` account must go red.
2. Collapse the credential-absent-here state into the undeclared-wrapper state -> red. **Both are
   WARN classes in the shipped code, not WARN-vs-FAIL** (undeclared is `wr_soft`, exit 0, pinned at
   `ccrc-doctor.test.ts:2345-2356`); what must stay apart is two WARNs with *different remedies*,
   which `cmd_doctor` already counts separately. Note the pin this collides with:
   `ccrc-doctor.test.ts:3005-3026` asserts the `wrappers` verdict line is **byte-identical with and
   without the secrets file present**, with a comment stating the intent. Slice A's
   unavailable-here state is by definition a fact about a credential on this box, so that pin must be
   reconciled deliberately — not quietly relaxed.
3. Hand-maintain `PROVIDER_IDS` instead of deriving it -> `single-definition.test.ts` red.
4. Widen the derived `AccountAuth` union to `string` -> a fixture with
   `{ provider: 'openrouter', auth: 'oauth' }` must fail typecheck. **Not pinnable by
   `typecheck-tests`**, which asserts `server/test/` produces *empty* tsc output and exit 0
   (`typecheck-tests.test.ts:56-68`) — a must-fail fixture placed there breaks the gate itself. The
   mechanism is a dedicated `server/test/types/<name>/` directory with its own
   `tsconfig.<name>.json`, excluded from `test/tsconfig.tests.json`, asserted to fail.
5. Drop a `secretsFile` whose wrapper sources it -> doctor FAIL.
6. Remove `telemetry` from the emitted `accounts.sh` -> `projected-home.test.ts` red.

### 11.2 Commit 2 — the api-key template, proved against `cck3`

`gen-wrappers.mjs` learns to emit an api-key body: credential precondition, proxy bootstrap when the
endpoint is `local-proxy`, config dir, base URL, auth token, the six-variable model map, the whitelist
grep for the model's provider prefix, `exec claude "$@"`. It **drops** two things the hand-written
wrappers carry: the `case "${HANDOFF_PROVIDER}"` runtime switch (one provider per generated account) and
the `${HANDOFF_CLAUDE_MODEL:-…}` env overrides — with the roster owning the model map, the place you
change a model is the roster, not an env var that shadows it.

Then `cck3` flips to `generated`, and it is the **proof** rather than a beneficiary. Equivalence is
behavioural, not byte-identity. In a fixture HOME: shim a fake `~/.local/bin/claude` that dumps `env`
and exits, bind an ephemeral port and set `HANDOFF_PROXY_PORT` to it so the bootstrap short-circuits
without spawning python, run both wrappers, and assert

- the **set** of `ANTHROPIC_*` and `CLAUDE_*` variables is equal — so a dropped variable fails, not only
  a changed one
- every value is equal
- with the key unset, both refuse with the same exit status
- with the port closed, both attempt the bootstrap (asserted via a stub `python3` on PATH)

The hand-written body is snapshotted to `server/test/fixtures/cck3.reference.sh` as the contract.
Deleting a model-map line from the template turns the env-set diff red — the mutation test and the proof
in one mechanism. If the template cannot reproduce `cck3`, that is learned now against a reference
instead of later against an account that has none.

`claude-glm` and `gpt` stay untouched. The generator already emits `protected\t<id>` for every
non-generated account, so that path exists.

### 11.3 Deploy

Both commits touch `ccd/ccrc`, `ccd/ccrc-doctor-checks` and `deploy/gen-wrappers.mjs`, so both are
**agent-first**: fleet host before server.

### 11.4 Ordering against work in flight

`ws/ccrc-adopt-and-wrappers-upstream-account` is fixing the invariant that `~/.local/bin/claude` is the
binary and never a wrapper — the guards key on `exec.kind: 'upstream'` rather than on whether the file
is a symlink, and doctor reports nothing. **That fix is a precondition for this design**, because §7.1's
credential check is roster-driven precisely because the upstream wrapper is unauditable by construction
(§3.4 item 27). It must land on `main` first; slice A then builds on a fixed invariant rather than
designing around a broken one.

## 12. Non-goals

- **Managed LiteLLM.** OpenAI stays `external`. Taking on the config yaml, the venv, the folding shim,
  device-code login and teardown is a slice at least the size of A and B together, and nothing needs it.
- **Templating `claude-glm` or `gpt`.** §5.1.
- **A proxy registry.** There is one proxy; it is inlined on the endpoint and generalises when a second
  appears.
- **A `posture: 'orchestrator' | 'worker'` field.** It governs what goes *inside* the config dir and has
  no reader until `account add` exists. It lands in slice B with its consumer, not in the schema early.
- **Building on `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`.** Undocumented (§3.1 item 7).
- **Changing placement eligibility.** §7.5.
- **Any new `ccd` verb for coordination mutation**, any new exec-whitelist entry, any `FLEET_PROTO` bump.

## 13. Open questions

1. **Is the one-year figure an enforced TTL or a documented approximation?** No per-token expiry is
   exposed by `setup-token`, `auth status --json`, or any doc page found. ccrc therefore cannot read a
   token's real expiry and must infer it from the mint date it records itself (§8).
2. **What is the official revocation surface?** claude.ai -> Settings -> Claude Code appears only in
   community and issue text; no Anthropic doc states it. Needs a human to open that page. This matters
   for `reauth`'s documentation, not for its mechanism.
3. **Are the undocumented `CLAUDE_CODE_OAUTH_*` variables a public contract or internal plumbing?**
   Treated as internal here.
4. **Does `--remote-control` currently fail silently on the fleet host?** `rc` is `on` there and the
   Anthropic wrappers authenticate by env token, which the binary says cannot establish Remote Control —
   yet sessions run fine, implying the flag is passed but never establishes. The operator does not use
   Remote Control, so this design records scope rather than chasing it (§5.4). Worth confirming before
   anyone ever *does* rely on RC.
5. **Should a minimum Claude Code version be enforced?** §3.1 item 4 gives a floor of 2.1.228 for any box
   relying on the env token. Whether that becomes a doctor check or a documented note is a plan-time
   call.

## 14. Deviations

D-numbers are **not allocated in this document**. The ledger is global and monotonic across project
history, and four PRs merged onto `main` during this design conversation. Numbers are ISSUED by the
allocator at plan-writing time (`POST /api/ledger/deviations`) and defined in the same act — never
derived from this branch, from any checkout, or from Stage 3a's ceiling. The renumber that cost a full
descending-order rewrite of D-108..D-140 is the reason this paragraph exists; the procedure it
originally prescribed was itself the defect, and root `CLAUDE.md`'s deviation-ledger bullet is the
current rule.
