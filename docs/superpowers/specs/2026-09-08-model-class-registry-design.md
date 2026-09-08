# Model-class registry — design (2026-09-08)

Every model any lane can run is classified into one of four **classes** —
Haiku-class, Sonnet-class, Opus-class, Fable-class — and every place that
chooses a model (the routing policy, project settings, the in-session `/model`
picker, a ccd account swap) names a class, never a concrete id. Concrete ids
live in exactly one place per account. Provider catalogues are refreshed on a
timer; a model the operator has not classified is **surfaced, never
auto-classed**.

Builds on the account-connections design
(`2026-09-05-account-connections-ui-design.md`, branch
`ws/gemini-subscription-account-connection`): §4.1's `ModelMap`, §4.3's
settings-block writer, §5's `ccrc account` verb and §12's Accounts screen are
the shape this design extends. Nothing here lands before that wave merges; §14
says what changes under each ruling outcome (ruling requested by mail 272).

## 0. The operator's ask, and the decisions already taken

Asked 2026-09-08: "dynamically up to date model names", "switcher works
correctly across those models", "a class-based mapping … all models we ever
use get classified into one of those buckets … a universal way of using the
right type of model for the right kind of job regardless of whether we're on
Anthropic or something else", "a UI to do the model class mapping".

Decided in the brainstorm (each was a question with options):

| Decision | Ruling |
|---|---|
| Which switcher | **Both**: the in-session `/model` picker on any lane, AND a ccd swap carries the class across lanes |
| A newly advertised model | **Surfaced, never auto-classed**: reachable by its concrete name, flagged, joins a class only when the operator assigns one |
| Approach | **A with a discovery-scope layer** (§2) |
| Stopgap on the gpt lane meanwhile | **No** — ship the real thing |
| Effort on non-Anthropic lanes (asked after spec review) | **Both levels**: a lane default per class, editable in the Models section; and the session's own `/effort` honoured per request |

## 1. What the tree says today (measured 2026-09-08)

- **Claude Code resolves the four class aliases through four env vars.** With
  `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS,FABLE}_MODEL=probe-x`, `--model
  <alias>` leaves the client as `probe-x` (the 404 names it) — all four probed.
  A **settings-file `env` block beats the shell env** for the same variable
  (probed: project settings `probe-settings` vs exported `probe-shell-env` →
  request left as `probe-settings`).
- **`ccgpt`'s `_sync_gpt_config` mirrors an allow-list of keys** and never
  removes the lane's own, so an `env` block in `~/.claude-gpt/settings.json`
  survives every launch.
- **The gpt wrapper hardcodes three classes and no Fable** (`infra/handoff/ccgpt`
  126–138: `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` = luna/terra/sol,
  `CLAUDE_CODE_SUBAGENT_MODEL`=terra). `claude-glm` maps every alias to one
  model (49–58). A `--model fable` on the gpt lane resolves to
  `claude-fable-5-1` and LiteLLM 404s.
- **The Codex catalogue moved.** `GET chatgpt.com/backend-api/codex/models`
  now lists `gpt-6-astra` ("our most capable model"), `gpt-5.6-sol/terra/luna`,
  `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.3-codex-spark` (128k), plus hidden
  `gpt-reserve` and `codex-auto-review`. `~/.handoff/litellm-config.yaml`
  still lists `gpt-5.5-mini` and `gpt-5.4` (gone) and lacks four of the nine.
- **The PWA picker is a hardcoded table** keyed on the wrapper string
  (`pwa/src/lib/models.ts` 21–40; gpt rows 26–32, no Fable). Its only consumers
  are `SessionScreen.tsx` and `PickSheet.tsx`.
- **ccd keeps no model per session.** The registry field set has no `model`
  or `class`; `_spawn_start` (`ccd/ccd` 12545–12546) execs the wrapper with
  `$rcflag $sidflag --dangerously-skip-permissions` and nothing else. A swap or
  restart lands on the destination wrapper's default — a Fable session swapped
  to gpt runs as Sol and comes back as Opus.
- **The model is scraped for display only**: `ccd/statusline-command.sh` 133
  reads `.model.display_name` from Claude Code's statusline input;
  `server/src/pane/statusline.ts` 19 parses the pane; `server/src/fleet.ts` 420
  puts it on `FleetSession.model`. Claude Code's statusline input also carries
  `model.id` and `session_id`, neither used today.
- **The account-connections spec already has a per-account model map** (§4.1):
  `ModelMap { opus, sonnet, haiku, subagent }` on a generated account's `exec`,
  `ApiKeyModels.selectable?: ModelChoice[]` for the picker, `MODEL_ID_RE`, and
  §4.3 writes the map into `~/<configDirSuffix>/settings.json` as the four env
  vars. No Fable slot, no discovery, no unclassified state, map set at creation
  only. Its `PROVIDERS` table (§4.2) is `anthropic | openrouter | compatible |
  openai`.
- **The roster is user-owned** (`shared/roster.ts` 71–129; seeded once, never
  overwritten by a deploy). `shared/wrapper.mjs` 144–148 emits only
  `CLAUDE_CONFIG_DIR` into a generated wrapper — model selection is absent
  from that mechanism.
- **The ownership whitelist is a proxy**, not a setting: `handoff-proxy` on
  `127.0.0.1:8642` injects `provider.only` from
  `~/.handoff/providers-whitelist.json` into every OpenRouter request.
- **Telemetry refresh is a timer**: `ccgpt-usage.timer` every 20 min.
- **Claude Code sends its effort with every request.** Captured 2026-09-08 with
  a listener as the base URL: the body carries `output_config: {"effort":
  "high"}` and `thinking: {"type": "adaptive"}`, under the
  `effort-2025-11-24` beta header. The wrapper's premise ("Claude Code can't
  express it") is stale: LiteLLM's `drop_params` discards the field and the
  static `reasoning` in each `litellm_params` decides, so a `/effort` in a
  gpt session — and the PWA's effort picker, which already offers the five
  levels on gpt — changes nothing today.

## 2. Approaches considered

- **A — a class registry beside the account-connections map, with a
  discovery-scope layer.** One source of truth, PWA-editable, covers every
  lane kind through the one client mechanism, fixes swaps. Chosen.
- **B — a standalone `~/.ccrc/models.json` plus CLI, PWA read-only.** Cheapest,
  no collision with the in-flight wave; but two files describe one account and
  the operator asked for a UI. Rejected.
- **C — alias in the proxy layer** (LiteLLM exposes `opus/sonnet/haiku/fable`
  as model names). No wrapper or roster change; cannot cover Anthropic lanes
  or swaps; classification means editing YAML; OpenRouter is not behind
  LiteLLM here. Rejected.

Why a discovery scope: Codex advertises nine models, OpenRouter several
hundred. An "unclassified" badge over an unfiltered OpenRouter catalogue is
noise; a per-account `discovery` list is what discovery and classification
operate on. It is NOT the account-connections `selectable`, which is a picker
permission (ruling 280): narrowing what an operator may pick must never narrow
what the prober classifies.

## 3. Architecture — five units

| Unit | Does | Depends on |
|---|---|---|
| **Registry** (`shared/models.ts`, `~/.ccrc/models/<id>.classes.json`) | the per-account registry file; validation; derived states | §4 |
| **Probes** (`ccd/ccrc-models-probe`, per provider) | fetch a provider's catalogue into a generated per-account file | provider credentials the lane already holds |
| **Materialiser** (`ccrc models`, `shared/modelenv.mjs`) | project `classes` into the lane's settings `env` block; generate LiteLLM's model list for the Codex lane | registry, catalogue |
| **Class carry** (`ccd/ccd`, `ccd/statusline-command.sh`) | record each session's class; spawn with `--model <class>`; keep rotation class-aware | registry, materialiser |
| **Surfaces** (`pwa/`, `server/`, `ccd ls`, `ccrc doctor`) | Models section on the account; the class-driven session picker; badges; refresh button | server routes (§9) |

Each unit is testable on fixture HOMEs alone; the agreement tests in §12 pin
that the two readers of the same files (server, ccd) compute the same derived
states.

## 4. Data model

### 4.1 The registry file (user-owned, per account)

`~/.ccrc/models/<accountId>.classes.json`, created by `ccrc models <id> init
<probe>` and changed only through the verbs (§10; the PWA drives them). It is
**not in the roster today, by ruling**: `exec.models`' shape belongs to the
account-connections spec (its `ApiKeyModels` — `opus`/`sonnet`/`haiku`/`subagent`
plus `selectable` — is landed on that branch, not on `main`), and its owner
ruled (mail 280, 2026-09-08) that any change there is additive and lands after
that branch merges. Once it is on `main`, `classes` may fold into `exec.models`
as an OPTIONAL sibling of the four aliases, this file becoming a generated
mirror; that fold-in is a separate decision (§14). Nothing here restates that
spec's shape; this document references it.

```json
{ "probe": "codex",
  "classes": { "haiku": "gpt-5.6-luna", "sonnet": "gpt-5.6-terra", "opus": "gpt-5.6-sol", "fable": null },
  "subagent": "sonnet",
  "discovery": "catalogue",
  "effort": { "haiku": "high", "sonnet": "high", "opus": "max", "fable": "max" } }
```

- `probe` — which catalogue probe runs: `codex | openrouter | compatible`. It
  names the DISCOVERY mechanism, not the account-connections `provider` (auth
  and connection); once `exec.provider` exists on `main`, `probe` defaults from
  it and a mismatch is a doctor finding. A `compatible` probe also needs
  `baseUrl` in this file until `exec.baseUrl` exists on `main`.
- `classes` — four slots, always all four keys, each a concrete model id or
  `null`. `null` means *this class is unavailable on this lane by nature*,
  never "use a default" and never "retired" (§4.3 carries retirement as its
  own marker). Ids satisfy the account-connections `MODEL_ID_RE`.
- `subagent` — a CLASS NAME, default `sonnet`, settable to `haiku` or `opus`:
  what `CLAUDE_CODE_SUBAGENT_MODEL` resolves to on this lane. It is a routing
  destination the operator sets — a class-to-slot map — not a derivation
  (ruling: `subagent` is not a class). Naming a class whose slot is `null` is
  refused.
- `discovery` — the literal `"catalogue"` (the whole advertised set; the
  default for `codex` and `compatible`) or an explicit non-empty list of ids
  (required for `openrouter`): the set discovery and classification operate
  on. Every non-null class id must be in it. It is distinct, by name and
  meaning, from the account-connections `selectable` (a picker PERMISSION);
  the two never alias, and that spec's containment rule is untouched.
- `effort` — optional; the lane's **default reasoning effort per class**, used
  when a request names none. Each value must be one of the classed model's
  `efforts` from the catalogue (Luna has no `ultra`; Astra does) — validated
  when a catalogue exists, accepted unvalidated otherwise and flagged by
  doctor once one appears. Absent key or class → the provider's
  `default_effort` for that model. Meaningless on Anthropic lanes, which have
  no registry file.

Absent file on a non-Anthropic lane = "no registry" — every class unavailable,
and doctor says so. Anthropic lanes never have one: their four classes are the
client's own defaults, shown read-only.

**Lifecycle (ruled with the account-connections owner, mails 284/285).** The
file is keyed by account id and so has a roster row's lifecycle, but it is
**reaped only by its owner**: `ccrc models <id> rm` (§10) deletes the registry,
the catalogue, the `.classes.tsv`, the `.effort.json` and clears exactly the
seven env keys the materialiser owns from the lane's settings — nothing else
in that file. `ccrc account remove` (that spec's Task 32) never deletes under
`~/.ccrc/models/`; it measures and REPORTS a registry it left behind, naming
`ccrc models <id> rm` as the remedy, and doctor reports an **orphan** (a
registry whose id is in no roster row) the same way. **Disable and enable never
touch the registry**: the kill-switch is a brake on a lane that stays in the
rotation, and this file describes the lane, not its availability.

### 4.2 The catalogue (generated, per account)

`~/.ccrc/models/<accountId>.json`, written atomically by the probe (temp +
`mv -f`, the repo's rule for any file another process reads):

```json
{ "probe": "codex", "fetchedAt": 1789000000, "stale": false,
  "models": [ { "id": "gpt-6-astra", "label": "GPT-6-Astra", "context": 272000,
                "maxContext": 872000, "efforts": ["low","medium","high","xhigh","max","ultra"],
                "hidden": false, "priceIn": null, "priceOut": null } ] }
```

`probe` records which probe wrote it (the registry file's `probe`; the
account-connections `provider` is not on `main` and is not this file's
concern). Absent file = **never probed**, a distinct state from an empty
catalogue.
`stale: true` = the last probe failed and this is the previous catalogue
(§11). Hidden models (Codex `visibility: hide`) are kept with `hidden: true`
and excluded from `"catalogue"`-mode discovery lists.

### 4.3 Derived states

Defined once in `shared/models.ts` (server and PWA) and once in `ccd/ccd`
(bash), with an agreement test feeding both the same fixtures:

- **classified** — the non-null ids in `classes`.
- **unclassified** — the discovery list (resolved: the catalogue's visible ids
  when `"catalogue"`) minus classified. Codex today: `gpt-6-astra`, `gpt-5.5`,
  `gpt-5.4-mini`, `gpt-5.3-codex-spark`.
- **retired** — any discovery-listed or classified id absent from a catalogue
  that exists and is not stale. A retired class id empties nothing in the roster
  (the roster is the operator's); it is a warning on every surface and the
  class counts as **unavailable** for routing (§7) until the operator reassigns.
- **available classes** — for a lane that runs Claude Code's own aliases: all
  four; otherwise the slots that are non-null and not retired. "Runs the
  client's own aliases" is read from the roster's `telemetry === 'anthropic'`
  (the server) and `homeAble` (the browser) until `exec.provider` exists on
  `main` — the only fields that carry the distinction today, and both are
  named as proxies in the code that reads them.

## 5. Discovery

One probe per lane, selected by the registry file's `probe`:

| provider | probe | credential | notes |
|---|---|---|---|
| `codex` (ChatGPT/Codex) | `GET https://chatgpt.com/backend-api/codex/models?client_version=0.160.0` | the lane's OAuth (`$CHATGPT_TOKEN_DIR/auth.json`, refreshed by LiteLLM's `Authenticator`) + `ChatGPT-Account-Id` | the same call `ccgpt` documents; `client_version` is a constant in the probe, bumped deliberately |
| `openrouter` | `GET https://openrouter.ai/api/v1/models` | none for the list; the lane's key for `/models/{author}/{slug}/endpoints` | catalogue is NOT filtered by the ownership whitelist (that needs one endpoints call per model); the check happens at **discovery-add** (§8): the endpoints call runs once and the UI shows which whitelisted providers serve the model, refusing the add if none do |
| `compatible` | `GET <baseUrl>/v1/models` | the lane's token | best effort; a 404 leaves "never probed" and the discovery list must be explicit |
| (Anthropic lanes) | none | — | no registry file; classes are client defaults |

`ccrc models refresh [<id>|--all]` runs the probe(s), writes the catalogue,
then runs the materialiser's LiteLLM step for `codex` lanes if the visible
model set changed. `ccrc-models.timer` (systemd --user, `OnUnitActiveSec=60min`,
`OnBootSec=3min`) runs `--all`; the PWA's refresh button (§8) runs one lane.
`ccgpt-usage.timer` is untouched — telemetry and catalogue are different
questions on different cadences.

## 6. Materialisation

### 6.1 The env block

`shared/modelenv.mjs` (this design's; the account-connections writer, its
Task 25, calls it when it lands — one writer of these bytes, pinned by a test
because the single-definition scan is blind to `.mjs`) projects the registry
file into the lane's `~/<configDirSuffix>/settings.json` `env`:

```
ANTHROPIC_DEFAULT_HAIKU_MODEL  = classes.haiku  ?? "ccrc-unavailable-haiku"
ANTHROPIC_DEFAULT_SONNET_MODEL = classes.sonnet ?? "ccrc-unavailable-sonnet"
ANTHROPIC_DEFAULT_OPUS_MODEL   = classes.opus   ?? "ccrc-unavailable-opus"
ANTHROPIC_DEFAULT_FABLE_MODEL  = classes.fable  ?? "ccrc-unavailable-fable"
ANTHROPIC_MODEL                = classes.opus ?? classes.sonnet ?? classes.haiku   (the lane's default; refused if all null)
ANTHROPIC_SMALL_FAST_MODEL     = classes.haiku ?? classes.sonnet
CLAUDE_CODE_SUBAGENT_MODEL     = classes[subagent]                  (the registry's explicit class-to-slot choice; refused if that slot is null)
CLAUDE_CODE_MAX_CONTEXT_TOKENS = catalogue.context of ANTHROPIC_MODEL's model   (only when a non-stale catalogue names it; otherwise the key is left unset)
```

The eighth key exists because Claude Code 2.1.263 assumes a **200k window for
any model id it does not know** and compacts proactively at that window
(measured 2026-09-08: the startup warning "isn't described by this version's
model catalog … auto-compact keeps this session within 200k tokens"; docs:
`CLAUDE_CODE_MAX_CONTEXT_TOKENS` applies directly to an unresolved id without
`[1m]`). The catalogue knows the real window (272k for the GPT-5.6/6 tiers,
128k for Spark), so the lane default's window is written and a session on
Sol keeps 36% more context than it would by default.
`CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` is never set: the
proactive compaction is the behaviour that keeps a 272k lane from hitting the
provider's 400 ("input exceeds the context window", seen four times today).

A `null` slot is written as a **sentinel**, never left unset: unset, the alias
falls through to Anthropic's own id and the proxied backend answers with an
opaque 404 (today's Fable-on-gpt failure). The sentinel makes an in-session
`/model fable` on such a lane fail with a name that says what is missing.
`ccd` refuses earlier still (§7). The sentinel lives in a SINK, not at a seam:
Claude Code forwards the string and branches on nothing; every reader that
does branch — ccd, the API, the UI — takes availability from its own positive
marker (`available`, §4.3; the third column of the classes file's bash
projection, §7), never from an env value. A **retired** id (§4.3) stays in the
block as written — the roster is the operator's — so an in-session `/model` to that
class fails at the provider; ccd never routes to it, and doctor names it.

The writer is the single definition (`shared/modelenv.mjs`); every `ccrc
models` mutation calls it, and the account-connections writer will. It
re-materialises on every registry edit.

**Rule, enforced by a test over every `.claude/settings.json` and
`~/.claude*/settings.json` fixture in the repo**: settings files may name
aliases only (`haiku|sonnet|opus|fable|default`) in `model`,
`CLAUDE_CODE_SUBAGENT_MODEL` and any `ANTHROPIC_*MODEL` key **except** inside
the per-lane env block the materialiser owns. Concrete ids live in the roster.

### 6.2 Wrapper migration

`ccgpt` and `claude-glm` (monorepo `infra/handoff/`) drop their
`ANTHROPIC_DEFAULT_*`, `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL` and
`CLAUDE_CODE_SUBAGENT_MODEL` exports once the lane's settings carry the block
(the block wins anyway, §1; the exports become dead code that misleads).
`ccgpt` keeps `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CONFIG_DIR` and the LiteLLM lifecycle, and exports `CCGPT_ACCOUNT_ID=gpt`
for the shim. The gpt lane's registry file is seeded by `ccrc models gpt init
codex` from today's mapping — luna/terra/sol, `fable: null`, `subagent:
sonnet` — so behaviour is unchanged until the operator classifies Astra.

### 6.3 LiteLLM's model list is generated

`ccrc models litellm <id>` renders `~/.handoff/litellm-config.yaml` from the
Codex catalogue: one `chatgpt/<slug>` entry per **visible** model and its
`[1m]` alias — and **no `reasoning` key**: effort has exactly one owner, the
shim (below), so config-versus-request precedence inside LiteLLM never
matters.
`drop_params` and `general_settings` are carried verbatim from a template in
`deploy/`. If LiteLLM is running with a different rendered config, the
generator restarts it (the wrapper's own `stop` then lazy start); in-flight
gpt turns fail once and retry. It logs that it did.

### 6.4 Effort: lane default, per-request override

`ccgpt-proxy` (the shim that already rewrites every `/v1/messages` body to
fold `system`) sets Codex's `reasoning.effort` on every request:

- the client's `output_config.effort` when present and not `auto` —
  `low|medium|high|xhigh|max` are all Codex levels and pass through unchanged;
- otherwise the lane's `effort[class]` for the request's model (the shim reads
  the materialised map, §6.1, from a generated `~/.ccrc/models/<id>.effort.json`
  the materialiser writes beside the env block, so the shim never parses the
  roster);
- otherwise nothing, and the provider's default applies.

So `/effort xhigh` in a gpt session, or the PWA's effort picker, takes effect
for that session from the next turn, and a session that never chose one runs
at the lane default — today's `max` for Sol, `high` for Terra and Luna, which
the seeded map preserves. `ultra` (Codex only, above `max`) is reachable as a
lane default, not per session: the client's enum has no such level. The
`claude-glm` lane gets the same treatment only if its backend accepts a
reasoning field; otherwise the shim leaves the request alone (§15).

## 7. Class across swaps and restarts (ccd)

- **Recording.** `ccd/statusline-command.sh` already receives `model.id` and
  `session_id` on every render. It writes `~/.cc-sessions/model/<session_id>`
  (one line, the concrete id, atomic) when the value changes. ccd maps that
  Claude Code uuid to its own id through the registry's existing `uuid` field.
- **Deriving the class.** `_session_class <id>`: read the file; if the
  session's wrapper is Anthropic, the class is the family token in the id
  (`-fable-`, `-opus-`, `-sonnet-`, `-haiku-`); otherwise reverse-look the id
  up in the account's `classes`. Unknown → `""` (carry nothing, today's
  behaviour). The result is stored in the registry as `class` at every swap,
  `ensure` and `stop`, so a session that was last seen on Fable restarts on
  Fable. The field is **declared in the registry field inventory** that
  account-pools wave 2b (PR #62) introduces, not at its first write site; and
  it is **read with a measured read**, never through `_reg_get` (which is
  `cat "$REG/$1.$2" 2>/dev/null` and folds absent, unreadable and empty into
  one empty string): absent means no class recorded, a readable value is
  validated against the four classes, and present-but-unreadable refuses the
  operation naming the path. Routing never acts on a fold.
- **Spawning.** `_spawn_start` appends `--model <class>` when the registry's
  `class` is non-empty **and** the class is available on the destination lane
  (§4.3). Aliases only — the destination's env block resolves them.
- **Rotation is class-aware, as the THIRD predicate in a composed chain.**
  `_swap_target` already composes #61's overflow bracket (an enabled
  non-home-able lane is last resort) with account-pools wave 2b's pool
  predicate (PR #62; an untagged account is a member of every pool by
  construction, so the two can select a lane neither would alone — ruled to
  ship and be documented). The class filter is written into that chain, not
  as a standalone skip: a lane where the session's class C is unavailable is
  excluded in both brackets, after the pool predicate. Today's gpt lane (`fable: null`) therefore never receives
  a Fable-class session until Astra is classified — the "comes back as Opus"
  defect becomes impossible rather than merely rarer.
- **Manual swap may downgrade, explicitly.** `ccd swap <id> <wrapper>
  --as-class <c>` sets the class before spawning; the PWA's SwapSheet offers
  it when C is unavailable on the chosen lane, naming the substitute ("no
  Fable-class model on gpt — run as Opus-class (GPT-5.6 Sol)?"). Without the
  flag the swap refuses with the same sentence.
- **ccd reads classes from a bash projection**, `~/.ccrc/models/<id>.classes.tsv`
  (written by the materialiser beside the env block): four lines
  `class<TAB>modelId<TAB>state` with `state ∈ assigned | unassigned | retired`
  — availability as its own column, never inferred from an empty field.
- **`ccd ls`'s lane line** grows the available classes:
  `gpt overflow lane: enabled, available (classes: haiku sonnet opus; fable
  unassigned; 4 unclassified) — 0 session(s) currently on it`.

## 8. Surfaces

- **Accounts screen, per account — "Models" section** (in the
  account-connections §12.4 card, below health). One row per discovery-listed
  model: label, context window, price when known, and a class control
  (`Haiku · Sonnet · Opus · Fable · —`) that is a radio across the row's
  classes — assigning a class to a model clears it from the model that had it,
  and the UI says so before saving. Badges on the card: `N unclassified`,
  `retired: <id>`, `never probed`, `stale since <time>`. A **Refresh** button
  runs the lane's probe. For `openrouter`: an **Add model** search over the
  catalogue (id, label, context, price); adding runs the whitelist endpoints
  check (§5) and refuses with the reason when no allowed provider serves it.
  Anthropic accounts show the four classes as "client default", no controls.
- **Session picker** (`pwa/src/lib/models.ts`) becomes data: rows are the four
  classes, labelled with the lane's model label from `/api/accounts`
  (`Fable-class · GPT-6-Astra`), unavailable classes rendered disabled with
  the reason, plus `Default`. It still sends `/model <alias>`. For Anthropic
  lanes the labels are the client's defaults; that is the one place a
  concrete Anthropic display name remains hardcoded (`Opus 5`, `Sonnet 5`,
  `Fable 5`, `Haiku 4.5`), and the file's header says so.
- **SwapSheet**: lanes where the session's class is unavailable are listed
  with the downgrade sentence and require the explicit choice (§7). This one
  surface is sequenced behind account-pools wave 4, which rewrites
  `SwapSheet.tsx`, `NewSessionSheet.tsx`, `stores/fleet.ts` and `lib/api.ts`
  (mail 279); the rest of §8 is not.
- **Effort**: in the Models section, one control per classed model offering
  that model's `efforts` from the catalogue, writing `effort[class]`. The
  session picker's existing effort rows are unchanged and now take effect on
  gpt (§6.4).
- **`ccrc doctor`** gains one check per non-Anthropic lane: catalogue present
  and not stale, no retired class ids, sentinel-free env block matches the
  roster (re-materialise to fix).

## 9. Server routes and wire shape

- `GET /api/accounts` — each account gains
  `models: { probe, classes, subagent, discovery, effort,
  catalogue: {fetchedAt, stale, count} | null,
  unclassified: string[], retired: string[], available: Class[],
  labels: Record<id, label> }` computed by `shared/models.ts` from the registry
  file and the catalogue (read by a NEW `server/src/models.ts` on the same fleet
  poll — one readdir of `~/.ccrc/models/`; `limits.ts` is account-pools wave 3's
  and is not touched). The assembly adds one field per row and moves no
  existing line, so it composes with wave 3's untagged-forecast change.
  Accounts without a registry file: `models: null`.
- `PATCH /api/accounts/{id}/models` — body `{ classes?, subagent?, discovery?,
  effort? }`; the server validates with the shared validator, then execs `ccrc
  models <id> …` through the agent (whitelisted verbs). Errors come back as the
  verb's own sentence.
- `POST /api/accounts/{id}/models/refresh` — execs `ccrc models refresh <id>`;
  returns the new catalogue summary.
- `GET /api/accounts/{id}/models/catalogue?q=` — the searchable catalogue
  (OpenRouter's is large; paged, filtered server-side).
- All gated as the account-connections §7 gates account mutation.

## 10. Verbs

```
ccrc models <id> init <codex|openrouter|compatible>   # creates the registry file; codex seeds luna/terra/sol, fable null, subagent sonnet, effort defaults
ccrc models <id> show [--json]                        # file + derived states + catalogue summary
ccrc models <id> set-class <class> <modelId|none>
ccrc models <id> set-subagent <class>
ccrc models <id> set-effort <class> <level|default>
ccrc models <id> discovery add <modelId> | rm <modelId> | catalogue
ccrc models <id> rm                                   # reap: registry, catalogue, tsv, effort file, and the seven env keys; idempotent, exit 0 when nothing is there
ccrc models refresh [<id> | --all]                    # probe(s) + LiteLLM step; the timer's entry point
ccrc models litellm <id>                              # render + (re)start; idempotent
ccd swap <id> <wrapper> [--as-class <c>]              # existing verb, new flag (after PR #62, §14)
```

A top-level `models` group, not a subverb of `ccrc account`: that verb is the
account-connections branch's and is not on `main`. Every mutation
re-materialises (env block, `.classes.tsv`, `.effort.json`) on success and
refuses, with the field named, on any validation failure. Exit 2 = usage, the
contract `ccrc` states for its verbs.

## 11. Error handling

- **Probe failure** (network, 401, schema drift): keep the previous catalogue,
  set `stale: true` with the error text in `lastError`; surfaces show "stale
  since". Never delete a catalogue on failure. A Codex 401 also means the lane
  itself is broken — the account-connections health reading says so; the
  probe does not duplicate that.
- **Schema drift** in a provider's response: the probe validates the fields it
  uses and refuses the whole response on a missing `id`; partial catalogues
  are not written.
- **Retired class id**: warning everywhere; class unavailable for routing;
  roster untouched.
- **All four slots null**: `ANTHROPIC_MODEL` cannot be derived — the
  materialiser refuses the edit ("a lane needs at least one class"). A
  `subagent` naming a null slot is refused the same way.
- **OpenRouter whitelist file absent**: discovery-add refuses (the proxy would
  refuse every request anyway).
- **LiteLLM restart fails**: the generator reports it, keeps the previous
  config file in place (`.prev`), and `ccrc doctor` flags the mismatch.
- **Orphan registry** (`<id>.classes.json` whose id is in no roster row, e.g.
  after `ccrc account remove`): `ccrc models <id> show` says `orphan: no roster
  row`; doctor (Plan 2) names it with the remedy `ccrc models <id> rm`; nothing
  reaps it automatically.
- **Settings block drift** (someone edited the lane's settings by hand): doctor
  detects sentinel/value mismatch against the registry file; `ccrc models
  <id> show` names the differing keys; re-materialise fixes.

## 12. Testing and mutation discipline

The repo's rules apply unchanged: fixture HOMEs only (never the real `$HOME`
or a live ccd/systemctl); TDD red-first with measured mutation checks on every
guard; `deviation-refs` and `single-definition` scans; the ccd provenance
marker re-stamped after every `ccd/ccd` edit.

- **Registry**: validator cases — four keys present, `MODEL_ID_RE`, class id
  not in an explicit discovery list, `discovery: []`, `subagent` naming a null
  slot, unknown `probe`, `openrouter` with `discovery: "catalogue"` (refused).
- **Materialiser pin**: a test asserts `shared/modelenv.mjs` is the only file
  in the tree that writes `ANTHROPIC_DEFAULT_*_MODEL` keys into a settings
  file (the single-definition scan filters `.tsx?` only and would never see a
  second `.mjs` writer).
- **Derived-state agreement**: one fixture set (catalogue × classes × discovery,
  incl. stale, hidden, retired) run through `shared/models.ts` and through
  `ccd`'s bash reader; assert identical `unclassified`, `retired`, `available`.
- **Probes**: recorded provider responses (today's Codex nine; an OpenRouter
  page; a `compatible` 404); atomic write; failure keeps the previous file
  with `stale: true`.
- **Materialiser**: env block bytes for the seeded gpt mapping; sentinel for
  null; refusal when all null; the alias-only rule over the repo's settings
  fixtures (a mutant that writes `claude-sonnet-5` into a project settings
  fixture must fail).
- **Class carry** (`makeCcdHarness`): statusline file → registry `class` for an
  Anthropic id and a gpt id; `--model <class>` present in the spawn line iff
  the class is available on the destination; `_swap_target` skips a lane
  lacking the class in both brackets (extends `ccd-default-pool.test.ts`);
  `--as-class` downgrade; `ccd ls` lane line; `_reg_read_class` on absent,
  readable and unreadable files.
- **Server**: `/api/accounts` shape; PATCH validation; refresh route execs the
  verb through the whitelist; catalogue search paging.
- **PWA** (render tests, the repo's accessibility contract): the class radio
  moves a class between rows and announces it; badges; disabled picker rows
  with reason; SwapSheet downgrade sentence; Anthropic account read-only.
- **LiteLLM render**: today's catalogue → config with nine visible entries,
  their `[1m]` aliases and no `reasoning` key; hidden models absent.
- **Shim effort** (recorded request bodies through `ccgpt-proxy`):
  `output_config.effort: xhigh` → `reasoning.effort: xhigh`; `auto` and absent
  → the lane default for that model; no default → no field; the validator
  refuses `effort.haiku: ultra` when the catalogue says Luna lacks it.

## 13. Migration and rollout

1. `ccrc models gpt init codex` writes the gpt lane's registry file
   (luna/terra/sol, `fable: null`, `subagent: sonnet`, `discovery:
   "catalogue"`). A non-Anthropic lane without a file reads as "all classes
   unavailable" until then — doctor says so.
2. First refresh writes the catalogue; the Accounts screen shows Astra and
   three others unclassified. The operator assigns Fable-class to Astra there.
3. Materialise; `ccgpt` and `claude-glm` lose their exports in the same
   change set as the block lands on the boxes (monorepo `infra/handoff` + the
   deployed copies), never earlier.
4. `pwa/src/lib/models.ts`'s table is deleted, not kept as a fallback.
5. Deploy agent-first (ccd, statusline, verbs, timer), then the server lane
   (routes, PWA). `ccrc-models.timer` is enabled by the agent lane like
   `ccd-cap-scopes.timer`.

## 14. Dependencies, ordering and the rulings

Three programs touch the same tree; the rulings below (all 2026-09-08) fix the
order. The account-connections spec's owner is session `ccrc-pwa-plain-hollow`;
the account-pools coordinator is `ccrc-pwa-amber-summit`.

- **Plan 1 — registry, probes, materialiser, effort shim — starts now, from
  `origin/main`.** Ruling 280: do not stack on the account-connections branch
  (no PR open, 9 of 29 tasks, three-file conflict with `main` awaiting an
  operator decision, tip moving under review). Plan 1 therefore touches neither
  `shared/roster.ts` nor `ccrc account`; the registry is its own file (§4.1),
  the verbs are a top-level `ccrc models` group (§10), and `shared/modelenv.mjs`
  ships with its single-writer pin.
- **Plan 2 — class carried in ccd — starts after account-pools PR #62 is merged
  AND deployed.** Ruling 275: no per-session registry field and no edit to
  `_swap_target`, `cmd_swap`, `cmd_start`, `cmd_enable`, `cmd_prefer` or
  `cmd_ensure` before that; rebase onto its merge sha; declare `class` through
  wave 2b's registry field inventory; write the class filter as the third
  predicate in the composed chain (§7) after reading that wave's crossing
  section.
- **Plan 3a — routes, the Models section, the picker — starts after
  Plan 1, and BEFORE Plan 2** whenever #62 has not merged by then: both add
  rows to `server/test/single-definition.test.ts`'s exact-match lists, so they
  run in sequence on the one branch, never concurrently, and whichever lands
  second adds its rows on top. It adds a new `server/src/models.ts` reader and one field per
  `/api/accounts` row (composes with wave 3, mail 279), touches `shared/api.ts`
  only by adding one interface and one optional field, and leaves
  `SwapSheet.tsx`, `NewSessionSheet.tsx`, `stores/fleet.ts` and `lib/pools.ts`
  alone. **The doctor check is Plan 2's**, not 3a's: `ccd/ccrc-doctor-checks`
  is a `ccd/` file PR #62 edits, sourced by `ccrc` through `BASH_SOURCE`, and
  shipped in the one rsync with ccd on the agent lane (mail 286).
- **Plan 3b — the SwapSheet downgrade choice — starts after account-pools wave 4
  merges** (it rewrites `SwapSheet.tsx`).
- **Fold-in — `classes` into `exec.models` as an optional sibling — is decided
  after the account-connections branch merges**, with its owner (they will
  amend their §4.1 for the additive part). Until then this spec references that
  spec for `exec.models`' shape and restates nothing; `probe` is this design's
  field and defaults from `exec.provider` once that exists on `main`.

## 15. Decisions recorded for the operator (each has a default)

| # | Decision | Default |
|---|---|---|
| 1 | Effort on Codex | lane defaults fable/opus `max`, sonnet/haiku `high` (editable per lane); a session's own `/effort` overrides per request; `ultra` as a lane default only |
| 1b | Effort on `claude-glm` | shim-mapped only if the backend accepts a reasoning field; else untouched |
| 2 | Auto-swap for a session whose class is unavailable on a lane | skip the lane (never silently downgrade) |
| 3 | Refresh cadence | 60 min timer + on-demand button |
| 4 | Anthropic catalogue probe | none; no registry file; classes are client defaults |
| 5 | OpenRouter discovery list | explicit only; whitelist check at add time |
| 5b | Where the registry lives until account-connections merges | its own per-account file under `~/.ccrc/models/`; fold-in decided later, additively |
| 5c | `subagent` | an explicit class name per lane, default `sonnet`; never derived |
| 5d | An unseeded registry (`init openrouter`/`compatible`) | legal on disk with all four slots null and an empty discovery list; the materialiser refuses to project it until one class is set (Plan 1 deviation B-1) |
| 5e | `refresh` and `litellm` as account ids | refused in `ccrc models`' first slot, since the verb group would read them as verbs (Plan 1 deviation B-4) |
| 6 | Hidden Codex models | excluded from `"catalogue"` discovery lists; addable explicitly |
| 7 | Where classification happens | the Accounts screen; the verb exists for scripts and doctor's remedies |
| 8 | Mechanism for class → model on a lane | the four `ANTHROPIC_DEFAULT_*_MODEL` vars (documented, measured: the wire carries the lane's id, the statusline shows it, Plan 2's reverse lookup keys on it). Measured alternative, 2026-09-08: `modelOverrides` (`{"claude-opus-5": "gpt-5.6-sol"}`) is the ONLY setting that silences the unrecognized-model warning and keeps Claude Code's feature detection for the Claude model it stands in for — but the client then believes it is running that Claude model (its window, its name in the statusline and the PWA), so it is recorded here as a follow-up spike, not adopted. `modelPicker` rows relabel the in-session picker (user-scope settings, i.e. per lane) and are a candidate for §8's picker on the lane itself; `behavesAs`, named by the binary's warning, is undocumented and had no measurable effect in `-p` mode. |

## 16. Out of scope

Gemini as a provider (its own connection design); per-model effort controls
in the UI; cost accounting per class; changing what the four aliases mean on
Anthropic lanes; the Kimi K3 lane (suspended by the ownership rule).
