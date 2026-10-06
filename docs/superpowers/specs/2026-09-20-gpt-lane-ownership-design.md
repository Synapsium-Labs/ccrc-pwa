# The GPT lane becomes ccrc's — design

**Date:** 2026-09-20. **Status:** approved in dialogue with the operator; this document is the written form
for review before a plan is cut. **Amends:** `2026-09-08-model-class-registry-design.md` (which placed the
shim in the other repository) and `2026-09-05-account-connections-ui-design.md` (which calls OpenAI an
external launcher ccrc does not own). **Lane names here are PLACEHOLDERS** — `<lane>`, `codex-a`,
`codex-b` — never the live roster's ids; real ids, ports and OAuth paths are runtime data in
`~/.ccrc/accounts.json` and appear in no tracked byte of this public repository.

## 0. In one paragraph

A ChatGPT/Codex subscription lane is a two-tier local gateway: Claude Code talks Anthropic to a rewriting
shim, the shim talks to a lane-private LiteLLM, and LiteLLM talks Codex over the lane's own OAuth. ccrc
already owns everything that DECIDES for such a lane — the roster row, the config directory, the model
catalogue, the class registry, the effort policy, the LiteLLM rendering, placement, telemetry, install,
release, doctor and uninstall — while the thing that RUNS is four executables and four unit-shaped
processes in another repository, whose tracked copy no longer matches what the box executes. The split is
not theoretical: ccrc's own source hard-codes the other repository's directory in four places, and one of
those makes `ccrc models refresh` on the second lane authenticate as the first. This design moves the
entire lane — launcher, shim, usage publisher, LiteLLM runtime and configuration, OAuth entry, process
lifecycle, health and removal — into ccrc behind a **fourth roster execution kind**, `codex`, whose row
carries the topology the lane cannot guess. It lands additively, is verified on the live box under a
separate authorisation, and only then is the other repository's copy deleted.

## 1. What the tree says today (measured 2026-09-20)

`ccrc-pwa` at `7d78b376`; `OpenClawHetzner` at `fix/ccgpt-midturn-system-messages`; live box as noted.

| Fact | Measurement |
|---|---|
| ccrc already runs LiteLLM code for a Codex lane — the dependency is ccrc's, only its declaration is missing | `ccd/ccrc-models-probe`'s codex arm authenticates with `from litellm.llms.chatgpt.authenticator import Authenticator` (`:167-171`) and picks its interpreter as `dirname(readlink -f $(command -v litellm))/python` with a `python3` fallback (`:160-161`) — the same two lines `infra/handoff/ccgpt:15-19` uses, and its own header says `ccgpt-usage` "is the model this arm copies" (`:14-16`). |
| That probe reads the WRONG lane's OAuth whenever a lane declares no secrets file | `ccd/ccrc-models-probe:162` defaults `CHATGPT_TOKEN_DIR` to `$HOME/.handoff/chatgpt-auth` — one directory, no lane in it. `_models_run_probe` (`ccd/ccrc:8468-8481`) deliberately SCRUBS that variable and re-supplies it only from the lane's `exec.secretsFile`. Both live Codex rows carry `exec: {kind, provider}` and nothing else. So `ccrc models refresh` on the second lane falls back to the first lane's token directory. |
| The roster holds no runtime topology for a Codex lane | `~/.ccrc/accounts.json`, 17 accounts, kinds `{upstream: 1, generated: 14, external: 2}`. The two `external` rows are the Codex lanes: keys `id, label, configDirSuffix, exec, homeAble, hue, telemetry`, `exec.provider: "openai"`, `telemetry: "codex"`, no ports, no auth path, no secrets file. |
| The LiteLLM verb takes a lane id and writes one box-global file | `_models_litellm <accountId>` (`ccd/ccrc:8716`) renders with `--out "$(_models_litellm_path)"`; that helper is `${CCGPT_CONFIG:-$HOME/.handoff/litellm-config.yaml}` (`:8686`), lane-free. `_models_litellm_running` pgreps the same single path (`:8697`). Its restart is a bare `ccgpt stop` (`:8726`). |
| …and the box runs two lanes against two configs the verb cannot name | The two live LiteLLM tiers carry two different `--config` paths under `~/.handoff`, distinguished by an ad-hoc convention in which the first lane's file is unsuffixed and every later lane's carries its id. Only the unsuffixed one is `_models_litellm_path`'s answer; the other is reachable through no ccrc verb. |
| ccrc source cites the other repository by file and line | `ccd/ccrc:8684` cites `infra/handoff/ccgpt:20`; `shared/litellm.mjs:2,5` and `deploy/litellm-config.template.yaml:2,6` name `~/.handoff/litellm-config.yaml` as the destination; `deploy/models-op.mjs:447` reads `$HOME/.handoff/providers-whitelist.json`. |
| The tiers are TRANSIENT services — no unit file exists to install | All four live units show `Transient=yes`, `FragmentPath=/run/user/<uid>/systemd/transient/…`, `Slice=app.slice`, `Restart=always`, `RestartUSec=3s`, `StandardOutput=append:…`. Unit names are `ccgpt-<lane>-litellm.service` and `ccgpt-<lane>-shim.service`. |
| `app.slice` is a deliberate choice, and slice policy is already gated in this repo | `deploy/systemd/app-claude-session.slice.d/zz-no-memoryhigh.conf` caps every ccd session in aggregate (`MemoryMax=24G`, `MemoryHigh=infinity`) and `deploy/assert-slice-policy.sh` refuses a deploy that reinstates an aggregate `MemoryHigh`, after a measured 2026-09-09/10 fleet freeze. A shared gateway placed inside the session slice becomes a casualty of another session's overshoot. |
| The tracked launcher is NOT what the box runs | Tracked `infra/handoff/ccgpt` starts both tiers with `nohup` (`:190`, `:198`). The installed `~/.local/bin/ccgpt` starts them with `systemd-run --user --collect --unit=… --slice=app.slice -p Restart=always -p RestartSec=3` and keeps `nohup` only for a box with no user manager (`_start_tier`, `:274`). That behaviour appears in no commit of that repository. |
| Installed launchers already disagree with each other | One lane's launcher is a symlink to `ccgpt`; the other is a 15-line hand-written `755` file carrying no ownership marker. The common executables are regular files — `ccgpt` 366 lines, `ccgpt-proxy` 317, `ccgpt-usage` 146 — and `litellm` is a symlink into a venv. |
| The runtime is one symlink away from wrong, and nothing declares it | Ambient `python3` is 3.12.3 and has **no `litellm` at all**. The lane's interpreter is whatever `~/.local/bin/litellm` resolves to: today a venv holding litellm 1.101.0, openai 2.54.0, httpx 0.28.1, fastapi 0.141.1, uvicorn 0.53.0, pydantic 2.13.5. A sibling backup venv holds litellm 1.93.0 — the last upgrade was a hand-made swap with a hand-made rollback. |
| The behaviour the lane leans on is upstream's EXPERIMENTAL surface | In the live venv, the mid-conversation system translator is `litellm/llms/anthropic/experimental_pass_through/adapters/transformation.py`. Version tolerance therefore has to be measured, not assumed from a version string. *(Amended 2026-09-28, D-3481: this row also said `chatgpt` is not a member of `litellm.provider_list`. Measured twice on litellm 1.101.0, it is, so the argument stands on the experimental surface alone.)* |
| The shim's ports default SILENTLY | `infra/handoff/ccgpt-proxy:55-56` gives both `CCGPT_PROXY_PORT` and `CCGPT_LITELLM_PORT` hard-coded fallbacks, and those fallbacks are the first lane's live pair. A lane started without both bound therefore binds another lane's ports — a collision that routes one account's traffic through another account's OAuth, silently. (The values are this box's topology and are deliberately not written here.) |
| Two relay defects are measured and still open | `_relay` reads `Content-Length` only, so a `Transfer-Encoding: chunked` request forwards with no body at all (measured: the sink received 0 bytes). `_rewrite_messages_body`'s `except ValueError: return body` arm forwards a gzip-encoded body unrewritten, `system` intact. |
| ccd already treats a Codex lane as first-class | `CCRC_CODEX_BACKEND` is emitted from `telemetry === 'codex'` (`shared/generate.mjs:233`); `_codex_lane_status` reads `$WRAPPER_DIR/<lane>` and the kill-switch file (`ccd/ccd:1906-1912`); both lanes have been home-able placement targets since 2026-09-11 (`ccd/ccd:1051-1058`). A rostered Codex lane with no installed wrapper already reports `not installed` rather than being skipped (`ccd/ccd:22986-22990`). |
| Usage scheduling is two mechanisms at once | `ccgpt-usage.timer` (enabled, fixed, one lane) and `ccgpt-usage@<lane>.timer` (indirect, instance) are both active on the live box. Two writers, one `~/.cc-limits/<id>.json`. |
| The limits row's shape is already pinned by its consumers | `server/src/limits.ts:483-485` keeps `fiveWindowMinutes` only when present; `:147-150` reads an explicit `0` as "no 5h window at all"; `pwa/src/fleet/SwapSheet.tsx:237` reads the same. Absent and zero are different answers and must stay so. |
| Adding an execution kind is a compile error by design | `EXEC_KEYS` is `Readonly<Record<ExecSpec['kind'], ReadonlySet<string>>>`, keyed "so a fourth `ExecSpec` kind would be a compile error here before it was a silent fall-through to the wrong set" (`shared/roster.ts:424-431`). |
| ccrc already ships a unit that depends on `ccgpt` being on `PATH` | `deploy/systemd/ccrc-models.service` sets `Environment=PATH=%h/.local/bin:…` with the comment "user units carry no `~/.local/bin` on PATH (measured on the fleet host); ccgpt and litellm live only there", and `agent/test/deploy-verify.test.ts:579-584` pins it by name. The dependency is declared; only the artifact is not. |
| **ccrc already owns the process-lifecycle abstraction this needs** | `_svc_run_detached` (`ccd/ccd:957-971`) is already `systemd-run --user --collect` on Linux with a *probed* `nohup` fallback on Darwin. It sits in a region measured byte-identical between `ccd/ccd:11-972` and `ccd/ccrc:70-1031`, whose closing sentinel says a new `_plat_*`/`_svc_*` helper must be added **above it in BOTH files** or `macos-platform.test.ts` reds. The installed launcher's `_start_tier`/`_have_user_systemd` is a fourth spelling of this. |
| ccd reads the usage row with two bash predicates that constrain the publisher's **language** | `_limit_json_num` (`ccd/ccd:15639-15647`) tolerates whitespace after the colon *only because* the row is written by Python's `json.dump`, and names `infra/handoff/ccgpt-usage` as the producer; a compact writer "read the one account it can't get telemetry for any other way as entirely unknown". `_limit_has_key` (`:15650-15656`) asks whether `fiveResetAt`/`sevenResetAt` are **present, whatever their value** — the only way to tell the publisher's row from the compact three-key 429 exclusion ccd writes itself, and `_codex_lane_status` depends on it. |
| `ccrc uninstall --purge` empties `~/.ccrc` except `memory` | `_uninst_purge` iterates `"$HOME/.ccrc"/*` under `nullglob dotglob`, skipping only `memory` (and `rm -rf ~/.ccrc` outright with `--memory`). Nothing that must survive an uninstall may live under `~/.ccrc`. |
| `_check_services` cannot name a per-lane unit | its `known` list is a flat array of seven fixed unit names, deliberately not a glob over the directory, with no template precedent (`ccd/ccrc-doctor-checks:836`). |
| `~/.handoff/env` is a `0600` file **shared** with tooling that stays behind | the other repository's GLM, K3 and handoff-runner scripts read the same file for their own API keys, and the installed launcher hands its path to every transient unit as `EnvironmentFile=-`. It is not the GPT lane's to move, and ccrc must never read it. |
| ccrc already has an OpenAI login path arguing the opposite of this design | `_auth_openai_login` (`ccd/ccd-account-auth:801-830`) runs `$WRAPPER_DIR/<id> login` under a pty and states in comment that no config dir is minted, no secrets file is written, "the credential lands wherever that launcher puts it", and that there is deliberately **no credential assertion**. Every sentence there becomes false once ccrc owns the lane. |
| `ccd/` already ships standalone helpers of every shape this needs | `ccd/ccrc-models-probe` (bash, credentialed), `ccd/ccd-usage-sweep.py` (python), `ccd/ccrc-wrapper-shape` (sourced contract), `ccd/claude-session@.service` (instance template), `deploy/systemd/*.{service,timer}` (installed templates). Nothing here needs a new kind of artifact. |

## 2. Decisions

1. **ccrc owns the ENTIRE lane** — launcher, shim, usage publisher, LiteLLM runtime and configuration,
   OAuth entry point, process lifecycle, health and removal. The operator's words were "ENTIRE GPT LANE";
   nothing is left behind as "the launcher's business".
2. **A fourth execution kind, `codex`.** Not an overload of `generated` (whose contract is a Claude wrapper
   in front of an API credential) and not a relaxation of `external` (whose contract is *ccrc records this
   launcher and never writes it* — the rule that stops ccrc overwriting somebody else's program).
3. **The roster carries the topology.** Two ports and an OAuth directory are machine facts a public
   source file may not hold and a convention may not guess. They become required fields on the new kind.
4. **`configDirSuffix` stays authoritative.** The launcher stops deriving `~/.claude-<id>`; there is one
   mapping from account to config directory and `ccd` already reads it.
5. **Adoption never touches the credential.** An existing lane is adopted BY PATH: ccrc records where the
   OAuth directory is and never opens, moves, copies or re-authenticates it.
6. **The dependency is declared and isolated, not pinned.** ccrc owns a runtime it builds and probes for
   the behaviour the lane needs, inside a supported range — the standing preference is tolerance, and the
   surface in question is upstream's experimental one, so a version string alone is not evidence.
7. **The two measured transport holes are closed in this migration**, not carried across. Importing a
   silent-passthrough arm into the repository that is about to own it is how a known defect becomes a
   permanent one.
8. **The gateway does not live in the session slice.** Lifecycle is per-lane transient user services on a
   box with a user manager and `nohup` where there is none; both are supported paths with tests.
9. **No secret reaches unit metadata.** The gateway key moves out of `systemd-run --setenv` into a ccrc
   owned `0600` environment file.
10. **ccrc first, deletion second, cutover in between and separately authorised.** The additive PR lands
    and releases; the box is cut over as its own act; the other repository's copy is deleted only after
    that is verified. At no point does neither repository hold a usable source.
11. **This design does not deploy anything.** The operator authorised the ccrc PR and the eventual removal
    from the other repository. A production rollout is a separate request.

## 3. Approaches considered

**A — a fourth execution kind, `codex` (recommended, and the one designed below).** The roster gains a
kind whose launcher ccrc writes, whose ports and OAuth path it validates, and whose runtime it installs.
Every existing invariant survives: `generated` still means an API-credential wrapper, `external` still
means *recorded, never written*, and `shared/roster.ts:424-431` makes the addition a compile error at
every site that switches on the kind rather than a silent fall-through. Cost: the schema change is real
work in two languages plus every consumer of `exec.kind`.

**B — overload `generated` with Codex fields.** Smallest schema diff. Rejected: `generated`'s whole
contract is one wrapper that sources a secrets file and execs Claude Code, and its removal, doctor and
credential verbs all read that way. A two-process OAuth gateway hiding behind that kind would be
mis-described by every one of them, and `shared/wrapper.mjs`'s generator would have to grow a second
shape behind the same name — exactly the drift `ccd/ccrc-wrapper-shape` exists to prevent.

**C — keep `external`, let ccrc install sidecars.** Least initial churn, and closest to today. Rejected
because it preserves the ambiguity that caused this migration: ccrc would own the runtime, the config,
the health and the removal of a lane whose launcher it still calls somebody else's. `_acct_credential`'s
refusal and `_acct_remove`'s keep-the-launcher branch would both be lying, and doctor could never say
which artifacts are ccrc's to fix.

## 4. The roster contract — a fourth execution kind

### 4.1 The schema

```ts
| {
    kind: 'codex';
    provider: 'openai';       // required; the only accepted value
    proxyPort: number;        // what Claude Code talks to
    litellmPort: number;      // the lane-private LiteLLM behind the shim
    authDir: string;          // $HOME-relative directory holding the lane's OAuth
    secretsFile?: string;     // permitted, as on every kind
  }
```

A roster row, with **illustrative** values — never defaults, and never the live fleet's:

```json
{
  "id": "codex-a",
  "label": "team·codex",
  "configDirSuffix": ".claude-codex-a",
  "homeAble": true,
  "hue": 3,
  "telemetry": "codex",
  "exec": {
    "kind": "codex",
    "provider": "openai",
    "proxyPort": 45010,
    "litellmPort": 45011,
    "authDir": ".local/share/ccrc/codex/codex-a"
  }
}
```

Validation, in `parseExec`'s existing `RosterError(message, remedy)` idiom:

- `provider` is **required** and must be exactly `"openai"`. Every other kind treats `provider` as optional; this one does not, because the kind's whole meaning is the backend it speaks to.
- Each port is an integer in `1024…65535`. Non-integer, out-of-range and privileged values are each refused by name so the remedy can say which happened.
- `proxyPort !== litellmPort` **within** a lane: the shim and LiteLLM need two.
- **No port value appears twice across the whole roster**, in either field, on any lane. The whole-roster gate goes where the duplicate-`configDirSuffix` gate already lives (`shared/roster.ts:983-989`) and reads the same way: a named pair of accounts and which value they share.
- `authDir` is validated exactly as `secretsFile` is (`shared/roster.ts:566-596`): non-empty, no leading `/`, no trailing `/`, no `..`, and the same safe charset. It names a **directory**; nothing in ccrc opens what is inside it. It is additionally refused **under `.ccrc/`**: `_uninst_purge` empties that tree except `memory`, and a credential ccrc never obtained must not be destroyable by ccrc's own uninstall — a refusal makes that structural rather than documented. A lane being adopted keeps the directory it already has; only a lane created from nothing defaults to the shape shown above.
- `EXEC_KEYS_CODEX` joins `EXEC_KEYS`. Because that map is `Readonly<Record<ExecSpec['kind'], ReadonlySet<string>>>` "so a fourth `ExecSpec` kind would be a compile error here before it was a silent fall-through" (`shared/roster.ts:424-431`), omission cannot be silent.
- The union arm and `EXEC_KINDS` land **in the same commit**. `EXEC_KEYS[kind as ExecSpec['kind']]` yields
  `undefined` for a kind the union does not carry, and `warnUnknownKeys` then calls `.has()` on it — the server
  refuses to boot with a stack trace instead of a `RosterError` naming a fix, which is the opposite of
  `loadConfig`'s whole posture.
- `EXEC_KINDS` gains the member in **both** `shared/roster.ts` and `shared/roster-json.mjs`. These are hand-kept mirrors, and `single-definition.test.ts` scans `/\.tsx?$/` only — so today a kind added to the TypeScript set and forgotten in the `.mjs` one yields a validator that accepts in-process and a bare-`node` validator (the one `gen-wrappers`, `account-op` and `gen-accounts` all run) that refuses, and the failure surfaces on a box at deploy time. **A parity test derives one set from the other** and is part of this work.
  The asymmetry also fixes the commit order: a kind in the parser but not the mirror makes `ccrc install`
  refuse a roster the server boots on — loud, recoverable; a kind in the mirror but not the parser hands `ccd`
  a projection from a roster `loadConfig` refuses, and `ccrc.service` crash-loops behind a green deploy.
  **Parser first.**

Fields deliberately NOT added, each because something already answers:

| Not added | Because |
|---|---|
| `baseUrl` | the lane's upstream is its own LiteLLM at `litellmPort`; a second spelling is a second thing to disagree. |
| unit names | derived from the id (§7.1). |
| a LiteLLM config path | derived (§8). |
| an effort/classes path | `~/.ccrc/models/<id>.*` already is per-account by filename (`deploy/models-op.mjs`). |
| `models` | the class registry owns model policy; `exec.models` belongs to `generated`'s API-key story. |
| a log path | derived (§7.1). |

### 4.2 Which verb mints one — none, deliberately

`ccrc account add` writes `generated`; `ccrc account declare` writes `external`; **no third subcommand is
added here.** A `codex` row is written into `~/.ccrc/accounts.json` by hand, which is what the roster is for —
it is runtime data, and the two ports and the OAuth path are facts only the operator holds. `parseRoster` is
the gate that makes a hand edit safe (§4.1), and `ccrc wrappers` plus `ccrc models litellm <id>` are what
converge it (amended: §20.6). A minting verb would have to prompt for a free port pair and an OAuth directory, which is a
usability feature with its own design, not a prerequisite for owning the lane.

### 4.3 What the kind resolves, and from where

| Thing | Source |
|---|---|
| account id | the roster row |
| Claude config directory | `configDirSuffix`, joined to `$HOME` — the launcher never derives `~/.claude-<id>` |
| OAuth directory | `exec.authDir` |
| shim port, LiteLLM port | `exec.proxyPort`, `exec.litellmPort` |
| LiteLLM config | `~/.ccrc/codex/<id>/litellm.yaml` (generated) |
| lane manifest | `~/.ccrc/codex/<id>/lane.json` (generated, no secrets) |
| gateway key | `~/.ccrc/codex/<id>/runtime.env`, mode `0600` |
| effort / classes | `~/.ccrc/models/<id>.effort.json`, `<id>.classes.tsv` (already per-account) |
| logs | `~/.ccrc/logs/codex/<id>/{litellm,shim}.log` |
| tier units | `ccgpt-<id>-litellm.service`, `ccgpt-<id>-shim.service` |
| usage timer | `ccgpt-usage@<id>.timer` (amended: §20.4, D-3717) |
| usage row | `~/.cc-limits/<id>.json` (already) |

### 4.4 The lane's identity IS its config directory

The generated launcher exports `CLAUDE_CONFIG_DIR` and execs the common `ccrc-codex`, adding no argument of its own (§5.3). `ccrc-codex` recovers which lane it is by reverse-mapping that directory through the roster: it sources `accounts.sh` and asks its `_ccrc_dir_id`, the same mapping `ccd` already generates there (`shared/generate.mjs`'s `dirIdArms`). *(Amended 2026-09-28, D-3478: the launcher was `ccgpt`, a path another repository's live launcher occupies on the fleet box.)*

That reverse map is **total and injective by an invariant this repo already enforces**: `parseRoster` refuses a roster in which two accounts share a `configDirSuffix` (`shared/roster.ts:983-989`). So the launcher cannot disagree with `ccd` about which account it is, because it does not hold a second opinion — it holds no opinion at all.

### 4.5 What an OLDER build does with the new kind, and why that fixes the cutover order

Three measured behaviours, none of them graceful, and together they decide the sequence in §15:

- **`parseRoster` refuses an unknown `exec.kind` outright.** Not the row — the roster. A box whose ccrc predates this change, handed a roster carrying a `codex` row, loses *every* account.
- **Inside `parseExec`, a forgotten branch falls through to `generated`, not to `external`.** The function
  returns early for `upstream` and again for `external`, and its tail constructs a `generated` literal. A new
  arm whose branch is missed therefore does not read as somebody else's launcher — it reads as the one kind
  ccrc *writes*. §17 enumerates every site that switches on the kind for exactly this reason, and §18's
  control is written against this direction.
- **Two silent `'anthropic'` provider defaults sit in `deploy/account-op.mjs`** — the same
  `exec.provider ?? (exec.kind === 'external' ? null : 'anthropic')` ternary spelled twice, once in the
  doctor's settings-env drift measurement and once in the `lane` op behind every `ccrc account` verb. Nothing
  pins the two copies against each other, and a `codex` lane reads as an Anthropic lane in both until each is
  told otherwise.
- **Doctor answers three different ways for the same unknown kind** — the shape arm refuses by name, the
  counting arm silently counts nothing, and `_dr_wr_note`'s b-only arm says nothing at all. The named one:
  `_check_wrappers`' `*)` arm appends: `_check_wrappers`' `*)` arm appends `"<id>'s roster entry declares no exec.kind this check understands"` to its hard list (`ccd/ccrc-doctor-checks:2644-2646`). A grep across `server/test/*.test.ts` finds no test asserting that sentence, so that arm is currently a green mutation; this work pins it.
- **`gen-wrappers`' summary line is three kinds wide and two bash gates depend on it.** `summary\t<total>\t<generated>\t<upstream>\t<external>` (`deploy/gen-wrappers.mjs:427`) feeds `[ "${#w_id[@]}" -eq "$sum_gen" ]` and `[ "${#protected[@]}" -eq "$((sum_up + sum_ext))" ]` (`ccd/ccrc:2929-2940`). A fourth kind counted by neither silently deletes the protected-truncation lock — and, as that gate's own sentence puts it, a lock a truncation can delete is not a lock.

Therefore: **the code lands on every box before any roster names the new kind.** The roster edit is the last step of the cutover, not the first.

The summary line gains a fifth count, `<codex>`, and the `${#w_id[@]}` gate becomes `sum_gen + sum_codex`. A count is never empty, so the `IFS=$'\t' read` idiom the manifest grammar depends on is unaffected.

### Pins

- `parseRoster` refuses: a missing/duplicate port, a port out of range, `proxyPort === litellmPort`, a port already used by another lane, a missing or malformed `authDir`, `provider` absent or not `"openai"`.
- TS/MJS `EXEC_KINDS` parity, derived — red when one set gains a member the other lacks.
- `EXEC_KEYS` omission is a type error (control: add the kind without the key set, observe the compile failure).
- `_check_wrappers`' unknown-kind sentence gains its first test, so widening or deleting that arm goes red.
- The manifest's five-count summary and both `cmd_wrappers` gates, with a codex account present.

## 5. What ccrc installs

### 5.1 Four common executables, all under `ccd/`

The release tarball carries exactly `install.sh shared ccd deploy` plus the three package manifests and their tracked `scripts/` (`deploy/build-release.sh:104-116`). A shipped file outside that pathspec is present in a checkout install and **absent from every `ccrc update`** — which is what made `v0.0.2` unusable (D-3105). So everything new lives under `ccd/`, `shared/` or `deploy/`, and `ccd/` is where every comparable helper already lives (`ccrc-models-probe`, `ccrc-wrapper-shape`, `ccd-usage-sweep.py`, `claude-session@.service`).

| File | What it is |
|---|---|
| `ccd/ccrc-codex` | the common launcher: it starts its lane, then execs Claude Code with its argv untouched, and interprets no argument. The lifecycle verbs are `ccrc codex start\|stop\|status\|login <id>`, in `ccd/ccrc` *(amended 2026-09-28, D-3478, D-3479: this row was `ccd/ccgpt`, "the common launcher and lifecycle verb — start, stop, status, login, run")* |
| `ccd/ccgpt-proxy.py` | the Anthropic→Codex request adapter |
| `ccd/ccgpt-usage.py` | the usage-window publisher |
| `ccd/ccgpt-runtime` | builds and probes the isolated LiteLLM runtime (§5.2) |
| `deploy/systemd/ccgpt-usage@.service`, `@.timer` | the per-lane usage instance pair (amended: §20.4, D-3717) |

**The two Python files keep their `.py` extension, deliberately.** A dotless name in `~/.local/bin` is id-shaped, and an id-shaped name needs three declarations that a dotted one needs none of: `TOOLCHAIN_EXECUTABLES` (`deploy/gen-wrappers.mjs:201`), `_uninst_wrappers`' exclusion `case` (`ccd/ccrc:12203`) and `_inst_bins`' placement list. `ccd-usage-sweep.py` is the shipped precedent and its dotted name is documented as exactly this choice. `ccrc-codex` and `ccgpt-runtime` ARE dotless — commands on `PATH` — so both take all three declarations (and `ccgpt` stays a reserved roster id, D-3478), and `gen-wrappers.test.ts` already derives the `_inst_bins` and `TOOLCHAIN_EXECUTABLES` lists from source and reds when one has an entry the other lacks.

`_uninst_tree_bins`' `rm -f` census and `_uninst_units`' two lists are hand-kept, have gone stale three separate times (D-1347, D-2594, and a routing-slice recurrence), and until then no test derived them. **This work adds that derivation**, in `server/test/install-census.test.ts`: the same shape `gen-wrappers.test.ts` already uses for the install side. *(Amended 2026-09-28, bookkeeping: this said "no test derives them", which was already false when Plan 2b-2 began.)* It is in scope because four new names and a unit template pair are exactly the payload those lists go stale on.

### 5.2 The isolated runtime

ccrc stops depending on whatever `~/.local/bin/litellm` happens to point at — today that is one symlink, and
the launcher's own fallback when it is missing is bare `python3`, which has no LiteLLM at all.

The tree has exactly one venv precedent to follow, and one thing about it to **not** follow.
`_inst_graphify_engine` builds `~/.ccrc/graphify-venv` with `python3 -m venv`, installs an exact pin whose
single declared home is `GRAPHIFY_PIN`, and re-measures the installed version against it. ccrc copies the
shape — one home for the version constraint, a re-measurement after install — and departs on one point,
deliberately: **that installer is fatal, and this one degrades.** A LiteLLM environment is orders of
magnitude heavier than a single wheel, and an unreachable package index must not brick `ccrc update` on a
box whose Anthropic lanes are perfectly healthy. A failed build leaves the previous runtime current, the
install continues, and doctor FAILs the lane. That is `_inst_enable`'s own doctrine applied honestly: a
guardrail is fatal, a per-lane capability degrades.

`ccd/ccgpt-runtime` owns `~/.ccrc/runtime/codex/`:

- It builds each runtime as a new **generation**, `gen-<UTC>-<pid>` under `~/.ccrc/runtime/codex/`, at its final path, never over the live one *(amended 2026-09-28, D-3480: this said "into a staging directory", but a renamed venv's console scripts exit 127)*.
- It installs LiteLLM within a declared, supported **range** — the standing preference is tolerance over freezing, and freezing is the wrong instrument here anyway (see below). The range is `litellm[proxy]>=1.101.0,<1.110`, declared once, as `LITELLM_REQUIREMENT` in `ccd/ccgpt-runtime` *(amended 2026-09-28, D-3487: this section named no range)*.
- It then **probes behaviour, not version strings**: that `litellm.llms.chatgpt.authenticator.Authenticator` imports; that the chat and responses transformations import; and that an Anthropic-shaped request with a top-level `system`, a mid-conversation `system` turn and a `reasoning` effort survives translation to the Codex request shape. This is measured offline, with no network and no credential. The request the gate asserts on is the one the shim forwards, with both system doors already folded (§6.1). Claude Code's raw shape is translated too, as a canary that reports and never gates (amended: §19.3, D-3481, D-3484).
- Only a generation that passes becomes current, by an atomic swap of the `current` symlink, and tiers start from the RESOLVED generation, never through `current` (amended: §19.3, D-3480; this said "by rename"). The previous one stays until the swap succeeds and is kept for one generation, so a failed upgrade is a rollback rather than an outage.
- A box rebuilds only when `check` fails: no runtime, the requirement or the probe bytes moved, or the installed litellm no longer matches its stamp *(amended 2026-09-28, D-3487, ruling PF-6: this said "only when the declared range or the probe set changes", but the builder also rebuilds an absent or mutated runtime)*.

Version strings are insufficient evidence here because the behaviour the lane leans on is upstream's **experimental** surface: the mid-conversation system translator measured in the live venv lives at `litellm/llms/anthropic/experimental_pass_through/adapters/transformation.py`. A range plus a behavioural probe says what a pin only asserts. *(Amended 2026-09-28, D-3481: this sentence also said `chatgpt` is not even a member of `litellm.provider_list`. Measured twice on litellm 1.101.0, it is, so the argument stands on the experimental surface alone.)*

The measured live runtime — python 3.12.3, litellm 1.101.0, openai 2.54.0, httpx 0.28.1, fastapi 0.141.1, uvicorn 0.53.0, pydantic 2.13.5 — is the reference point the initial range is drawn around, not a floor to freeze at.

### 5.3 The per-account launcher rides the EXISTING wrapper grammar

This is the single most consequential measurement in this design. `_wrap_parse_shape` (`ccd/ccrc-wrapper-shape`) accepts a shebang, then exactly two or three significant lines in a fixed order, and its exec line must be literally `exec "$HOME/.local/bin/<target>" "$@"` with `<target>` matching the account-id regex — and it says so in its own comment: *target not judged here*.

So a Codex launcher is (amended: §19.2, D-3478; the exec target was `ccgpt`):

```bash
#!/usr/bin/env bash
# Generated from ~/.ccrc/accounts.json. Do not edit — `ccrc wrappers` rewrites it.
export CLAUDE_CONFIG_DIR="$HOME/.claude-codex-a"
exec "$HOME/.local/bin/ccrc-codex" "$@"
```

Two significant lines, same order, differing from a `generated` wrapper only in its exec target — and `ccrc-codex` is an id-shaped name *(amended, D-3478)*. Consequences, every one of them measured rather than hoped for:

- `cmd_wrappers`' staged read-back through the same reader passes unchanged (`ccd/ccrc:2968-2970`).
- **Lock 4** (a wrapper that would exec itself) is unaffected; an account literally named `ccrc-codex` is refused there with a clear message, and the roster gains an explicit refusal for an account id that collides with a toolchain executable so the refusal arrives earlier and says why. `ccgpt` stays one of those reserved ids: a wrapper written at that path would shadow the other repository's live launcher. *(Amended 2026-09-28, D-3478.)*
- **Lock 5**, the witness index, keeps working: the file parses as the full generated shape, so it still casts a vote, and a box whose only launchers are Codex lanes does not go silent.
- The disk-versus-staged comparison is on the `(target, suffix, secrets)` triple and *deliberately* not against roster fields (`ccd/ccrc:3140-3152`), so `--adopt` and `--force` keep their exact meanings.
- `markGenerated`/`verifyMarker` stamp and check it like any other generated file.

What must change is small and nameable:

- `generateWrapperBody` accepts `codex` and chooses `ccrc-codex` as the exec target *(amended, D-3478)* instead of the upstream id. Its refusal for `upstream`/`external` stays verbatim.
- `_check_wrappers`' target comparison — `[ -n "$upstream_id" ] && [ "$target" != "$upstream_id" ]` (`ccd/ccrc-doctor-checks:2640`) — learns that a `codex` account's expected target is `ccrc-codex` *(amended, D-3478)*. Without this, every Codex lane FAILs doctor for executing the right file.
- `gen-wrappers.mjs` counts the kind (§4.5) **and stops protecting it**: its `protected` list is
  `execKind !== 'generated'`, so a Codex account would otherwise be classified as one ccrc must never write —
  and the `ccd/ccrc` assertion that would catch the mismatch reports it as a truncated manifest, naming a
  cause it does not detect.

**Two things about `~/.local/bin` this replaces.** Today one lane's launcher is not a file but an *alias* of
`ccgpt`, and two pieces of ccrc exist for that pair by name: `ccrc-adopt`'s alias pass and `_check_wrappers`'
`-ef` drop. After cutover a migrated lane has a real generated file, so neither fires for it. Both **stay** —
they still answer for a box that has not cut over, and for any other alias an operator makes — but this spec
says plainly that they stop being how a Codex lane is recognised, so nobody later reads their silence as a
regression. And the four common executables are **bin-arm artifacts, never marker-stamped**: a marker on
`ccrc-codex` would make it an orphan account-wrapper report *and* a `_uninst_wrappers` deletion candidate, since
that function's skip `case` does not name it. They are declared in §5.1's three lists instead. *(Amended 2026-09-28, D-3478: the launcher named in this paragraph's last sentence was `ccgpt`.)*

**The marker is binary across shapes**: `verifyMarker` says which tool wrote a file, never which *kind* it was written for. So if an id is reclassified between `generated` and `codex`, the file at that path is ccrc's either way and is rewritten by the next `ccrc wrappers` run — which is the correct outcome, and the spec states it so nobody has to rediscover it.

### 5.4 Generated lane state

```
~/.ccrc/codex/<id>/lane.json      # non-secret: id, config dir, ports, auth dir, unit names, probe model
~/.ccrc/codex/<id>/litellm.yaml   # rendered from the lane's catalogue (§8)
~/.ccrc/codex/<id>/runtime.env    # 0600: the lane's LiteLLM gateway key, and nothing else
~/.ccrc/logs/codex/<id>/litellm.log
~/.ccrc/logs/codex/<id>/shim.log
```

`lane.json` holds no credential and is the one thing `ccgpt`, the shim and the publisher read, so none of them re-derives a path from a naming convention. It is written by the same materialiser that writes the lane's model files, atomically, tmp-then-rename. *(Amended 2026-09-28, D-3478: the launcher that reads it is `ccrc-codex`. The sentence stays as written because `ccd/ccgpt-usage.py` and `server/test/models-op.test.ts` quote it. The lifecycle writes four more kinds of file beside it: amended: §19.1.)*

`runtime.env` exists because **`_inst_env` is seed-once**: `~/.ccrc/ccrc.env` is user-owned and never rewritten, so a new key there could never reach an already-installed box. A second, ccrc-owned environment file is the shipped precedent (`ccrc expose`'s `$CCRC_EXPOSURE_FILE`, carried as a second `EnvironmentFile=`), and it is also how the gateway key stops appearing in `systemd-run --setenv` metadata.

### Pins

- A generated Codex launcher round-trips through `_wrap_parse_shape` (extend `wrapper-roundtrip.test.ts`).
- `_check_wrappers` PASSes a Codex lane whose launcher execs `ccrc-codex`, and FAILs one that execs anything else *(amended 2026-09-28, D-3478)*.
- The witness index still counts a box whose only launchers are Codex lanes.
- `TOOLCHAIN_EXECUTABLES`, `_uninst_wrappers`' case and `_inst_bins` agree on the dotless names — derived, both directions.
- A derived guard over `_uninst_tree_bins` and `_uninst_units`, red when a shipped name or unit is missing from either.
- The runtime probe fails on a runtime missing the `chatgpt` authenticator, and the failed generation never becomes current (D-3480).
- `runtime.env` is `0600`, and no process argv or unit property carries the key. This is asserted over the recorded `systemd-run` argv: no `--setenv` pair carries the key, and it reaches LiteLLM only through `-p EnvironmentFile=`. It is not asserted over `systemctl show` output, because a planted `show` answer proves only what the test typed *(amended 2026-09-28, D-3491: this said "assert over `systemctl show` output in a fixture, and over the launcher's own `systemd-run` argv")*.

## 6. The proxy

### 6.1 Both system doors, folded on every request

Claude Code sends system instructions two ways, and Codex refuses both: the top-level Anthropic `system` field, and `role: "system"` entries inside `messages` under the `mid-conversation-system-2026-04-07` beta. LiteLLM's Anthropic adapter forwards an in-sequence system entry unchanged by design, and its Responses translation folds one into `instructions` **only when the content is a plain string** — a content-block one becomes a `{"role":"system"}` input item, which Codex answers with `400 {"detail":"System messages are not allowed"}`. It is sticky rather than flaky: the entry is replayed with the history, so one injection fails every later turn.

The migrated shim folds both, on every request, in this order:

1. every `messages[*].role === "system"` becomes `"user"`, **in place** — the beta exists because the position carries meaning, so hoisting would change what was said;
2. then the top-level `system` folds into the leading user turn, so a top-level instruction still lands above a converted first turn.

Both content shapes are converted, not only the block shape that 400s today: the sender drew no distinction between them, and the string arm survives only because a layer below happens to hoist it.

### 6.2 Effort

Precedence is unchanged: an explicit client `output_config.effort`, else ccrc's per-model lane default from `~/.ccrc/models/<id>.effort.json`, else the provider default. The shim removes both `output_config` and `thinking` before forwarding, so nothing below it reinterprets effort independently.

The effort map is reloaded by `(path, mtime)` in a **single-slot** cache whose atomicity its own comment argues for. The migrated shim keeps one-key-one-value; the materialiser's tmp-then-rename write is what makes that sound.

### 6.3 The two transport holes this closes

Both are measured, both are open today, and both are closed here rather than carried into the repository that is about to own them:

- **A chunked request loses its body.** `_relay` reads `Content-Length` only, so a request with `Transfer-Encoding: chunked` forwards with no body at all — measured: the sink received 0 bytes. The migrated relay decodes the chunked framing, rewrites, and forwards with a correct length.
- **A gzip body is forwarded unrewritten.** `json.loads` raises `UnicodeDecodeError`, a `ValueError`, and the `except ValueError: return body` arm passes the body through with `system` intact. The migrated relay decodes `Content-Encoding: gzip`/`deflate`, rewrites, and re-encodes.

The hazard in both is the **silent** arm, not the encoding. An encoding the shim cannot decode is answered with an explicit error; a body carrying a system message is never forwarded unexamined.

### 6.4 What does not change

Streaming SSE relay, tool definitions and tool results, the `/ccgpt/lane` identity endpoint, byte-identical forwarding of non-`/messages` paths, and the hop-by-hop header set.

### Pins

Every case in the existing Python suite that covers the above moves with the code (§14), plus new cases for chunked and gzip bodies in both directions, an unsupported encoding's explicit refusal, and a mutation control on the call site — not only on the helper — since a correct fold that nothing calls is the failure this pair of doors already produced once.

## 7. Lifecycle

### 7.1 One transient service per tier, per lane

The tiers are started through ccrc's **existing platform layer**, not through a launcher-local starter.
`_svc_run_detached` is already `systemd-run --user --collect` with a probed Darwin `nohup` fallback, and it
lives in the region measured byte-identical between `ccd/ccd` and `ccd/ccrc`. What it does not take is a unit
name, a slice, a restart policy or a log destination, so this work adds one sibling — `_svc_run_supervised` —
**above the closing sentinel in BOTH files**, which is that region's own stated rule and what
`macos-platform.test.ts` asserts. Writing a fifth spelling of `systemd-run` inside the launcher (`ccrc-codex`, D-3478) is precisely the
drift the sentinel exists to refuse. The helper's signature and its secret-name rule: amended: §19.4.

On a box with a usable user manager it produces, per tier:

```
ccgpt-<id>-litellm.service    ccgpt-<id>-shim.service
Slice=app.slice   Restart=always   RestartSec=3   (bounded start limits)
StandardOutput/StandardError=append:$HOME/.ccrc/logs/codex/<id>/<tier>.log
```

These are **transient** — `systemd-run`, `FragmentPath` under `/run` — exactly as the live box runs them today. Nothing static is installed for them, because a lane is lazy: a rostered Codex lane with no session on it should have no processes, and `ccd` already reports such a lane as `not installed` rather than as broken.

### 7.2 The slice is policy, and this repo already says so

The tiers do **not** run in `app-claude-session.slice`. That slice carries an aggregate `MemoryMax=24G` for every ccd session, and `deploy/assert-slice-policy.sh` exists — with a measured 2026-09-09/10 fleet freeze behind it — to refuse a deploy that reinstates an aggregate `MemoryHigh` there. A shared gateway inside that slice is a casualty of another session's overshoot; worse, a `nohup` child started from a session pane inherits that pane's transient scope and dies with it. `app.slice` decouples the lane from the pane that happened to start it, and that is the production behaviour this migration recovers — it exists only in the installed launcher and in no commit of the repository that nominally owns it.

### 7.3 The portable fallback

Where there is no user manager — macOS, a container, a box without lingering — the same helper falls back to
`nohup` with the same log paths, **probing that the command exists first**, because a bare `nohup … &`
answers 0 for a command that is not there and the caller checks that status. That probe is `_svc_run_detached`'s
existing argument, inherited rather than re-derived. This is a supported path with its own tests: `_inst_bins`
already has a non-Darwin block, every `_svc_*` helper already has a launchd arm, and `macos-platform.test.ts`
already exists to hold them. `_svc_have_user_manager` is how a box without a usable user manager is detected: `command -v systemd-run` and `systemctl --user show-environment` must both succeed, and on Darwin it never answers yes *(amended 2026-09-28, D-3483: this section said nothing on detection)*.

### 7.4 Adoption, stopping, and restart-after-update

**Starting is idempotent and identity-checked.** Before starting a tier, `ccrc codex start <id>` asks whether one is already running: `GET /ccgpt/lane` must answer this lane's id for the shim, and the LiteLLM tier's process must hold this lane's config path and itself hold the listening socket on the lane's port (amended: §19.5, D-3479, D-3528). That probe is the only thing standing between a second lane and another lane's gateway — the failure it prevents (a lane silently attaching to another lane's proxy and billing the wrong account) is a real, dated incident, not a hypothetical, and any reimplementation without it reintroduces it exactly.

**Stopping is identity-gated, then by exact unit or verified pid.** `ccrc codex stop <id>` stops a tier only when `_codex_tier_ours` proves it this lane's, running or starting. Only then does it stop `ccgpt-<id>-litellm.service` or `ccgpt-<id>-shim.service` by name, or a `nohup` tier's verified pid. A foreign or unmeasurable tier is left running and named, because another program's live tiers use these same unit names (amended: §19.5, D-3488, D-3479; this said "by exact unit, then by verified identity", through `ccgpt stop <id>`). Killing a service-owned PID without stopping its unit lets `Restart=always` race whatever comes next.

**Restart after an update is its own spine step, `_inst_codex_tiers`, right after `_inst_enable`.** `_upd_sweep` is the only sanctioned toucher of `claude-session@*` units and only behind its mandatory `KillMode=process` preflight; nothing else may go there. `_inst_codex_tiers` runs on install and on update (update re-runs the spine), is visible in the pinned step list, and is platform-neutral. It restarts **only** tiers that are running, proven this lane's and stale, by stop then start (a `systemctl restart` of a transient unit re-runs the old generation's argv), re-measures after each stop (D-3531), leaves inactive lanes lazy, and reports a restart it could not perform as its own result rather than leaving doctor to infer it later — a running Python process keeps its old code after the file under it is replaced, so "updated" and "running the update" are two claims. *(Amended 2026-09-28, D-3485: this said the step "belongs in `_inst_enable`"; see §19.5.)*

Two ordering rules that `cmd_install`'s own pins make non-negotiable: nothing is added **after** `_inst_installed` (`cmd_update` deletes that record before the staged install and uses its presence to tell "spine died" from "spine completed, doctor failed" — the exit-3 semantics `ccrc rollout` relays), and `cmd_install` still **ends** with `cmd_doctor`, whose exit code it is.

### Pins

- Two lanes start, run and stop independently; stopping one leaves the other's units active.
- A tier whose unit name exists but whose listener answers another lane's id is refused, not adopted.
- The unit properties are asserted over the recorded `systemd-run` argv: `--slice=app.slice`, `Restart=always`, a transient `--unit`, the log paths, and no key in any `--setenv` pair *(amended 2026-09-28, D-3491: no fixture models a transient unit's properties)*.
- The `nohup` arm is exercised on a fixture with no user manager.
- `_inst_codex_tiers` restarts a running, stale tier of this lane after the binaries change, and reports a failed restart distinctly; an inactive lane is left alone *(amended 2026-09-28, D-3485: this named `_inst_enable`)*.
- The `cmd_install` step-list `toEqual` and the ends-with-`cmd_doctor` pin both stay green.

## 8. LiteLLM configuration, per lane

`shared/litellm.mjs` and `deploy/litellm-config.template.yaml` stay the canonical renderer and template.
`deploy/models-op.mjs`'s litellm op already takes its destination as a plain caller-supplied argument and
computes no box-global path of its own, so **the whole per-lane fix is in `ccd/ccrc`**. Plan 2b-2 lands it for `codex`-kind lanes only (amended: §19.6, D-3482):

- `_models_litellm_path` becomes a function of the account id already in scope at its call site (for a `codex`-kind lane, its optional id argument), answering
  `~/.ccrc/codex/<id>/litellm.yaml`. Both the check-phase and commit-phase calls pass the id through.
- `_models_litellm_running` stops being `pgrep -f "litellm .*<path>"`. That pattern interpolates a
  filesystem path into a regex unescaped, matches a process ccrc does not own, and can match a waiter's own
  command line — and it is the sole guard on the stop-then-write decision. It is replaced by the exact
  question: is `ccgpt-<id>-litellm.service` active, and does the listener on the lane's `litellmPort` hold
  this lane's config? For a `codex`-kind lane that question is `_codex_tier_ours <id> litellm`, which also proves that the lane's own pid holds the socket (D-3528). An `external` lane keeps the `pgrep` until Plan 3 retires that arm.
- For a `codex`-kind lane, the bare `ccgpt stop` becomes `_codex_stop_tier <id> litellm`, under the lane's lock and identity-gated (§7.4), and the restart goes through `_codex_start_tier`. An `external` lane keeps the bare `ccgpt stop`, byte for byte, until Plan 3's cutover (amended: §20.2, D-3753) *(amended 2026-09-28, D-3482, D-3488: this said `ccgpt stop <id>`, "which stops that lane's two units by name")*.

**The STOP-THEN-WRITE doctrine is preserved verbatim**, because it is right and was argued once already:
phase 1 renders and compares without writing; if the bytes changed and a tier holds the old ones, the stop
must succeed *before* phase 2 writes, and a stop that cannot be had **refuses with nothing written**, so the
next run sees the same difference and retries rather than reporting "unchanged" forever over a stale
rendering. What changes is only that all three of "the bytes", "the tier" and "the stop" are now named per
lane.

Two things the rendered config must continue **not** to contain:

- **No static reasoning/effort settings** — the shim owns effort selection (§6.2), and a second decider
  below it is a second answer to a question the client already asked.
- **No `[1m]`-suffixed context-window alias.** Claude Code sizing its auto-compaction against an advertised
  but unusable window produced a hard, unrecoverable session stall (measured 2026-07-26). Reintroducing one
  needs a fresh accepted-ceiling measurement, not an inherited catalogue number.

## 9. OAuth, and how an existing lane is adopted

`exec.authDir` makes the lane's OAuth directory a declared fact rather than a convention. Three consequences:

1. **The probe stops guessing.** `ccd/ccrc-models-probe:162`'s `${CHATGPT_TOKEN_DIR:-$HOME/.handoff/chatgpt-auth}`
   loses its default outright. For a `codex` lane the directory comes from the lane, and a lane that cannot
   supply one is **refused** — silently probing another account's OAuth is the failure this replaces, and a
   default is what made it silent. `_models_run_probe`'s scrub stays exactly as it is; what changes is that
   the value it re-supplies comes from the roster row rather than only from a secrets file the live rows do
   not carry. (amended: §20.1, D-3706)
2. **Adoption is by path, never by copy.** An existing lane keeps its current directory: the operator writes
   the path it already has into `exec.authDir`. ccrc records it, passes it, checks that it exists, and never
   opens it, moves it, copies it or re-authenticates it.
3. **Login becomes a ccrc verb over ccrc's runtime — and one existing function's whole argument is
   retired.** `_auth_openai_login` today runs `$WRAPPER_DIR/<id> login` under a pty and argues in comment
   that no config dir is minted, no secrets file is written, the credential "lands wherever that launcher
   puts it", and that there is deliberately **no credential assertion** because the lane is not ccrc's. Under
   this design ccrc *is* the launcher, so that function is rewritten rather than reused as-is: it still drives
   a pty (the device flow needs one), it still asserts no credential *content*, and its
   `pane-unsupported-here` refusal stays — but for a `codex` lane it now invokes `ccrc codex login <id>`, which runs the **isolated
   runtime's** `Authenticator` with that lane's `authDir` exported, and it can say so. The route named here, `ccrc account
   auth-start`, does not exist (measured), so the pane's existing door is routed instead (amended: §19.7, D-3489, D-3530).

`_acct_credential`'s refusal currently gates on `external` **only**, so every other kind is rotatable by
default — and the comment beside it records that this exact hole was once measured as a live token written
into a `0600` file ccrc had promised never to write. **`codex` is added to that refusal explicitly**: its
credential is an OAuth directory a browser flow owns, not a file ccrc writes. `_acct_remove`'s
keep-the-launcher branch and its mirrored secrets branch both test the same `external` literal; both are
decided explicitly for `codex` (the launcher IS removed, marker-verified; the OAuth directory is **kept**).

Nothing in ccrc — doctor, installer, publisher, probe or test — ever reads the contents of an OAuth file. (amended: §21.7)
Existence and mode only.

## 10. Usage publication

One mechanism, not two:

```
ccgpt-usage@<id>.timer → ccgpt-usage@<id>.service → lane.json → ~/.cc-limits/<id>.json
```

The fixed `ccgpt-usage.timer` is retired at cutover. Today it and an instance timer are both active, which
is two writers over one limits row; and the two units are not even symmetrical — the fixed one sets no
`Environment=` at all and leans on the publisher's own `CCGPT_ACCOUNT_ID:-<first lane>` shell default, while
the template sets the id and `PATH` explicitly. A template that always names its instance removes both the
race and the asymmetry, and the publisher loses its lane default: an unnamed lane is an error, not lane one. The instance's `ExecStart` runs the isolated runtime's interpreter, `%h/.ccrc/runtime/codex/current/bin/python -I`, with `LITELLM_LOCAL_MODEL_COST_MAP=True`; a oneshot resolves `current` afresh on every run. The pair itself stays unplaced until Plan 3 arms it (D-3172). *(Amended 2026-09-28, D-3486.)* (amended: §20.4, D-3717, D-3718)

What the publisher keeps, because its consumers already depend on it:

- **A 429 carrying `x-codex-*` headers is a valid measurement**, not a failure. The publisher reads the
  headers off the error response and publishes.
- **Absent and zero are different answers** for `x-codex-secondary-window-minutes`. `server/src/limits.ts`
  keeps `fiveWindowMinutes` only when it was present and reads an explicit `0` as "no 5h window at all";
  `pwa/src/fleet/SwapSheet.tsx` reads the same. Folding one into the other changes what the fleet believes
  about a lane's capacity.
- **The write is atomic**, tmp-then-rename into `~/.cc-limits/<id>.json`.
- **The publisher stays Python, and keeps `json.dump`'s default separators.** *(Reason corrected 2026-09-21,
  D-3159 — the sentence this replaces was measurably false.)* No shipped reader distinguishes the two
  spellings today: both `_limit_json_num` and `_limit_has_key` match with `[[:space:]]*`, zero or more, so a
  compact row reads key-for-key identically, and `server/src/limits.ts` parses JSON and is separator-agnostic
  by construction. The historical defect ccd's own comment records ran the other way — a compact *pattern*
  against a spaced *file*. The rule is kept because it holds the producer stable for a stricter future reader
  and matches the reference byte-for-byte, not because anything would break today.
- **`fiveResetAt` and `sevenResetAt` are emitted on every poll, null included.** `_limit_has_key` asks
  whether the keys are *present*, whatever their value, and that presence is the only thing separating this
  publisher's row from the compact three-key 429 exclusion `ccd` writes itself — `_codex_lane_status` reads
  the lane's whole story off that distinction. Omitting a null would make a weekly cap render as a five-hour
  cooldown.
- **Two readers, one rule.** `server/src/limits.ts` and `ccd`'s `_limit_score` read `fiveWindowMinutes` by the
  same predicate, and `limits.ts` says in comment that the two must not drift. A change to what the publisher
  emits is a change to both.
- **`telemetry: "codex"` keeps the Anthropic statusline writer out of that row**, which is the field's
  documented reason for existing.

What changes: the probe **model** comes from `lane.json`, derived from that lane's own catalogue and class
registry, instead of being a hard-coded id in the publisher. A model id frozen into a publisher is a second
model policy.

## 11. Install, role, release, and the fallback deploy

**Placement.** The four executables go through `_inst_bins`; the unit template pair through `_inst_units`
and `_inst_enable`, once Plan 3 places the pair: until then nothing places it (D-3172) (amended: §20.4). `cmd_install`'s step list is pinned by an exact `toEqual` over the `_inst_*` lines in
its body, so any new step is a deliberate, visible edit — and nothing is added after `_inst_installed`,
and the verb still ends with `cmd_doctor` (§7.4).

**Role.** The gate is `!= server`, stated explicitly rather than copied from a sibling. `_inst_bins` today
places its executables on *every* role including `server`, so this is a departure and the plan says so: the
precondition for this runtime is a converged per-account launcher, and a server-role box converges nothing
per account (D-3111). Within a fleet/both box the *runtime build* is further conditioned on at least one
rostered `codex` lane — a box with none does the cheap part and skips the expensive one. Role gating here is
neither one predicate nor imitation: `_inst_units`/`_inst_enable` carry three different spellings today and
the file's own doctrine is to derive the gate from what writes the artifact's precondition.

**Release.** `deploy/build-release.sh`'s pathspec is `install.sh shared ccd deploy` plus the three package
manifests, so every new file is carried by construction — which is exactly why they all live under `ccd/`
and `deploy/`. A release assertion names them anyway, because a file present in a checkout install and
absent from `ccrc update` is what made `v0.0.2` unusable.

**Fallback deploy.** `deploy/deploy.sh` gains the matching `install_atomic`/unit lines on its agent arm (amended: §20.7). Two
mechanical hazards the plan must respect: several `*-ship.test.ts` suites locate their subject by scanning
`deploy.sh` for an **exact, un-shadowed** spelling — a comment repeating the same `install_atomic` spelling
above the real call shadows it — and `graph-noise-ship.test.ts` asserts a three-code-line drift budget that
constrains where a new line may be inserted relative to its pinned neighbours.

**Fixtures.** `server/test/installTreeFixture.ts`'s `TREE_FILES` gains each new `ccd/` and `deploy/systemd/`
file. Omission fails loudly — `_inst_atomic` dies naming the missing source and cascades — which is a good
signal, but the plan adds the files in one commit so the cascade names one cause.

## 12. Doctor, and `doctor --fix`

Mechanics first, because they are unforgiving: checks are sourced into a shell running `set -uo pipefail`
and **not** `-e`, so a check signals by returning; the return code must equal the worst class it printed
(1 FAIL, 2 WARN, 0 PASS); a SKIP is exactly one SKIP line, no verdict line, and `return 3`; every
`$BOX_ENV_FILE` read is `[ -f ] && [ -r ]` in that order; and every reference tolerates `${BOX_ENV_FILE:-}`
because the file is sourced bare by tests.

`_check_codex` distinguishes, each as its own sentence with its own remedy:

| Condition | Class |
|---|---|
| role is `server` | SKIP |
| `CCRC_ROLE` unreadable or unset | treated as **not** server, matching `cmd_update`'s own reading — and a box with no recorded role is already refused by `ccrc rollout` (D-3106), so this is not a silent population |
| no `codex` lane in the roster | SKIP — a scan over an empty set must never PASS (`_check_models`' ruling) (amended: §20.3, D-3710) |
| a ccrc-owned executable missing or drifted from the shipped tree | FAIL |
| the isolated runtime absent, out of range, or failing its behaviour probe (amended: §20.3, D-3711) | FAIL |
| `lane.json` or the rendered LiteLLM config absent or stale against the catalogue (amended: §20.3, D-3712) | FAIL |
| `exec.authDir` absent or unreadable (existence and mode only) | FAIL |
| ports invalid or colliding — belt and braces behind the roster refusal, for a hand-edited file | FAIL |
| a listener on a lane's port that answers another lane's id, or no id | FAIL |
| one tier active and the other not | FAIL |
| an active tier running code older than the installed bytes (amended: §20.3) | WARN |
| `ccgpt-usage@<id>.timer` missing or disabled (amended: §20.4, D-3720) | WARN |
| the lane's usage row stale, or its probe model absent from the current catalogue | WARN |
| every lane healthy, no tier running (a lane is lazy) | PASS (amended: §20.3) |

The per-lane usage timer is checked **here**, not in `_check_services`: that check's `known` list is a flat
array of fixed unit names, deliberately not a glob over the unit directory, and it has no template precedent.
`_check_codex` enumerates lanes from the roster and asks about `ccgpt-usage@<id>.timer` (amended: §20.4) per lane, which is
the only place the lane set is known.

`_check_wrappers` gains the `codex` case in **all three** of its arms — the shape arm that refuses an
unrecognised kind by name, the counting arm that silently counts nothing, and `_dr_wr_note`'s b-only arm
that says nothing. A spec that assumes "doctor refuses an unknown kind" is right about one of three paths.

`--fix` may: restore a ccrc-owned executable from the shipped tree, rebuild and re-probe a staged runtime,
regenerate a marker-verified launcher (amended: §20.5, D-3730), re-render `lane.json` and the LiteLLM config, enable a missing usage
timer, and restart a verified ccrc-owned active tier (amended: §20.5, D-3721). It may **not**: choose a port, perform OAuth, read a
credential, kill a listener it cannot identify, overwrite an unverified launcher, or delete user state. Its
only precedent is `_fix_skills`, whose rule is that the fixer re-runs the shipped tree's own installer and
the verdict that counts is doctor's **re-measurement**, never the fixer's word.

## 13. Uninstall

Removed: the four executables (by the `_uninst_tree_bins` census, which gains its derived guard — §5.1), the
usage unit template pair and every enabled instance of it once Plan 3 places them (until then nothing placed the pair, D-3172, so there is nothing to remove) (amended: §20.4), marker-verified per-account launchers, the
isolated runtime under `~/.ccrc/runtime/codex/`, and any transient tier still running that `_codex_tier_ours` proves this lane's, stopped by exact unit
name or verified pid under the lane's lock; a foreign or unmeasurable tier is left running and named (amended: §19.8, D-3488, D-3490).

Kept, deliberately and stated so nobody has to infer it: **OAuth directories**, Claude config directories and
transcripts, `~/.ccrc/models/*`, `~/.cc-limits/*`, `~/.ccrc/logs/codex/*`, and `~/.ccrc/codex/<id>/` itself.
The generated lane state is kept because it is diagnosis material and costs nothing; the credential is kept
because ccrc never obtained it and removing it would end a subscription session it did not start.

On `--purge`, `~/.ccrc/codex/<id>/` and `~/.ccrc/runtime/codex/` go with the rest of `~/.ccrc`, which is
correct: every byte there is regenerable from the roster and the catalogue, including the gateway key. The
OAuth directory is **not** reachable by that path — the §4.1 refusal keeps `authDir` out of `~/.ccrc` in the
first place, which is the whole reason that refusal exists.

## 14. Tests that move, tests that stay

**The Python suite does not move as a Python suite.** ccrc has no Python leg in CI and does not need one:
`ccd/ccd-usage-sweep.py` is shipped Python already, and it is tested from vitest by spawning `python3`
against the shipped file over a fixture HOME (`server/test/usage-sweep.test.ts`, `usage-sweep-runner.test.ts`).
The shim's and publisher's cases become vitest suites in `server/test/` in exactly that idiom, so they ride
the one gate every other guard in this repo rides.

**The split is per-method, not per-class.** `test_ccgpt_proxy.py` is not cleanly divided: `TestWrappersStoppedDecidingModels`
and `TestLaneModelGate` each mix GPT-lane assertions with assertions about an unrelated OpenClaw wrapper.
Moving whole classes would either drag that wrapper's coverage into ccrc or drop the lane's. The plan moves
methods, and states the count on both sides before and after — a smaller green suite is still green.

**One pin will fight the move**: that file asserts the publisher's exact bytes by SHA-256, inside one of the
mixed classes. Any edit to the publisher — whitespace included — reds it unless the digest moves in the same
change. The plan sequences that deliberately rather than discovering it.

**One new repo-wide guard ships with this work.** `server/test/topology-clean.test.ts` scans every blob a
commit range introduces against seven classes — public IPv4, claude.ai session id, CGNAT tailnet IP, tailnet
name, fleet account label, duckdns subdomain, operator residue — and **there is no email class**. The other
repository has two real account email addresses committed in plaintext in three of the files this migration
reads from, so a careless copy would ship green through the ratchet. An email class is added, red-first
against a fixture address, before any GPT-lane file is created.

**Nothing OpenClaw-specific is deleted**: its GLM/K3 wrapper cases, its provider-policy cases and its
ownership-allow-list case stay in that repository.

**Stale source-shape assertions are replaced, not copied.** The existing suite positively pins the `nohup`
launch lines — i.e. it pins the behaviour production already replaced. The migrated coverage asserts
lifecycle behaviour (§7) instead.

## 15. Cutover: ccrc first, the roster last, deletion after

The order is forced by §4.5: an older ccrc handed a roster with an unknown kind refuses **the whole roster**,
and a mirror laxer than the parser gives `ccd` a projection from a roster the server refuses to boot on.

1. **Land the ccrc PR.** Additive: new kind, new files, new checks, migrated tests. No roster on any box is
   edited, nothing is deployed, and every existing account behaves exactly as before. Within the PR, the
   parser side (`shared/roster.ts`) and its mirror land together, parser-first in the commit order.
2. **Release and roll out both boxes.** `ccrc rollout` as usual (amended: §20.9, D-3705). Both boxes now *understand* `codex`; none
   uses it. The other repository's runtime is still what serves traffic, and is still the rollback.
3. **Cut over, as a separately authorised act.** Per lane: park sessions; stop the old tiers with the
   currently installed lane-aware launcher; write the lane's `exec` block — kind, provider, the two ports it
   already uses, and its existing `authDir`; move an unowned launcher aside rather than overwriting it;
   `ccrc wrappers`, `ccrc models litellm <id>`, start; verify unit names and slice, listener identity on both
   ports, `/ccgpt/lane`, a streamed turn, a tool call, and a published usage row — none of it by reading a
   secret. Retire the fixed usage timer (amended: §20.9). Then the next lane.
4. **Delete the OpenClaw copy.** `ccgpt`, `ccgpt-proxy`, `ccgpt-usage`, the four usage units, the static
   LiteLLM config, the machine-specific per-lane launchers, the install runbook, and the GPT-only tests.
   Its docs stop pointing operators at deleted files; historical design records stay, marked superseded.

At no point does neither repository hold a usable source, and at no point does a roster name a kind the box
does not understand.

**`~/.handoff/env` stays exactly where it is, and ccrc never reads it.** It is a `0600` file shared with the
other repository's GLM, K3 and handoff-runner scripts, which are not part of this migration and keep their
keys there; the installed launcher hands its path to every transient unit as `EnvironmentFile=-`. A migrated
lane stops referencing it — its only ccrc-side need is the gateway key, which lives in the lane's own
`runtime.env` — and nothing in this work moves, reads, rewrites or removes that file. Deleting the GPT-lane
sources in step 4 does not touch it either.

**One thing the cutover must not carry across.** The other repository has two real account email addresses
committed in plaintext, in its launcher, its test file and one per-lane launcher. Nothing bearing them is
copied into ccrc; the lane's identity in ccrc is its roster id and its `authDir`. What is already in that
repository's history is that repository's to decide about, and this design does not pretend otherwise.

## 16. Out of scope

- Deploying or rolling out this migration (amended: §20.9, D-3705). The operator authorised the ccrc PR and the eventual deletion;
  a production rollout is a separate request.
- Scrubbing the other repository's git history.
- Any second ChatGPT/Codex backend, any provider beyond `openai` on this kind.
- Showing the execution kind in the PWA. `RosterWire` carries no kind today and nothing in `pwa/src` reads
  one, so there is nothing to degrade; adding it is additive, absence-permitting, single-reader work with
  its own justification, and this design does not smuggle it in.
- Teaching `ccd` the kind. It does not need it: `CCRC_CODEX_BACKEND` is already emitted from `telemetry`,
  the launcher is invoked by path, and `accounts.sh` carries no `exec` information at all. Emitting a new
  value would change `bodyDigest(accounts.sh)` and move the two-box roster-agreement verdict to `divergent`
  for the length of any non-simultaneous rollout — a cost with nothing to buy.
- A verb that mints a `codex` account (§4.2).
- Teaching `ccrc-adopt` the kind. It adopts an unknown Codex launcher as `external` — the safe direction,
  since ccrc then never writes it — and doctor says so. Adopt reads a box it did not write, and neither a
  port pair nor an OAuth directory is recoverable from a launcher's bytes without trusting them.
- Retiring `deploy/deploy.sh`.

## 17. Files

**New**

| Path | What |
|---|---|
| `ccd/ccrc-codex` | common launcher; the lifecycle verb is `ccrc codex …`, in `ccd/ccrc` *(amended 2026-09-28, D-3478, D-3479: this row was `ccd/ccgpt`)* |
| `ccd/ccgpt-proxy.py` | request adapter |
| `ccd/ccgpt-usage.py` | usage publisher |
| `ccd/ccgpt-runtime` | isolated LiteLLM runtime builder and behaviour probe |
| `deploy/systemd/ccgpt-usage@.service`, `ccgpt-usage@.timer` | per-lane usage instance pair (amended: §20.4, D-3717) |
| `server/test/ccgpt-proxy.test.ts` | the shim's cases, vitest-over-python3 |
| `server/test/ccgpt-usage.test.ts` | the publisher's cases |
| `server/test/ccrc-codex.test.ts` | the lane library and start/stop/status/adopt, both platforms' arms, beside `ccrc-codex-launcher.test.ts` and `ccgpt-runtime.test.ts` (amended: §19.9; this row named `ccgpt-lifecycle.test.ts`) |
| `server/test/roster-exec-parity.test.ts` | TS/MJS `EXEC_KINDS` derived parity |

**Edited**

`shared/roster.ts` · `shared/roster-json.mjs` · `shared/roster-json.d.mts` (its `telemetry` union is missing
`'codex'` today, which both implementations admit — fixed here) · `shared/providers.ts` (the openai row
stops calling itself an external launcher) · `shared/wrapper.mjs` · `deploy/gen-wrappers.mjs` (the
`protected` split, `TOOLCHAIN_EXECUTABLES`, the five-count summary) · `deploy/account-op.mjs` (both silent
`'anthropic'` provider defaults, at the doctor's drift measurement and at the `lane` op) ·
`deploy/models-op.mjs` (`lane.json`, the probe model) · `deploy/build-release.sh` · `deploy/deploy.sh` ·
`ccd/ccrc` (`_inst_bins`, `_inst_units`, `_inst_enable`, `_uninst_tree_bins`, `_uninst_units`,
`_acct_credential`, `_acct_remove`, `_models_litellm*`) · `ccd/ccrc-models-probe` (the default that guesses a lane) and `server/test/ccrc-models.test.ts` (its scrub cases) · `ccd/ccrc-doctor-checks` (`_check_wrappers`' three arms, the new `_check_codex`) · **`ccd/ccd` and `ccd/ccrc`
together** — `_svc_run_supervised` joins the byte-identical platform layer above its sentinel, in both files
or neither · `ccd/ccd-account-auth` (`_auth_openai_login`) · `server/test/topology-clean.test.ts` (a new email
class) · `server/test/macos-platform.test.ts` (the new helper's sentinel membership) ·
`server/test/installTreeFixture.ts` and the install/uninstall/doctor/gen-wrappers/build-release/wrapper-roundtrip
suites · `docs/superpowers/specs/2026-09-08-model-class-registry-design.md` and
`2026-09-05-account-connections-ui-design.md` (amended where they record the old ownership). Plan 2b-2's edits beyond this list: amended: §19.9.

**Deleted, in the other repository, in step 4 only** — `infra/handoff/{ccgpt,ccgpt-proxy,ccgpt-usage}`, its
four usage units, `litellm-config.yaml`, `lanes/*`, `INSTALL-model-class-registry.md`, and the GPT-only test
methods.

## 18. The mutation table this design owes

Every row is a guard that must go **red** when it is deleted or mutated, measured before and after. For each row Plan 2b-2 owns, the task and the case that hold it: amended: §19.10.

| Guard | Red when |
|---|---|
| `exec.kind: "codex"` accepted | the union arm is removed — and the control matters: the forgotten-branch fall-through in `parseExec` is **`generated`**, not `external`, so a missing branch makes a Codex lane look like an Anthropic lane ccrc writes |
| port pair required, in range, distinct, unique fleet-wide | any one of the four refusals is removed |
| `authDir` path validation | the `..`/absolute/trailing-slash gate is relaxed |
| TS/MJS `EXEC_KINDS` parity | a member is added to one set only |
| `EXEC_KEYS` completeness | the `codex` key set is removed (compile error) |
| launcher round-trips `_wrap_parse_shape` | the emitted body gains a line or reorders |
| `_check_wrappers` expects `ccrc-codex` for a codex lane *(amended, D-3478)* | the expected-target branch is removed |
| `_check_wrappers`' unknown-kind sentence | the `*)` arm is widened or deleted — today nothing pins it |
| manifest five-count summary and both `cmd_wrappers` gates | a count is dropped or a gate loosened |
| `TOOLCHAIN_EXECUTABLES` / `_uninst_wrappers` / `_inst_bins` agreement | a name is added to one list only |
| `_uninst_tree_bins` and `_uninst_units` completeness | a shipped name or unit is missing from either |
| `_acct_credential` refuses a codex lane | the refusal is removed (it becomes rotatable by default) |
| `_acct_remove` keeps the OAuth directory | the keep branch is removed |
| both system doors folded | either fold, **or its call site**, is neutered |
| chunked and gzip bodies rewritten | either decode arm is removed |
| an unsupported encoding refuses | the explicit error becomes a passthrough |
| effort precedence and the single-slot cache | a level is reordered or the cache key loses `mtime` |
| stop-before-write, per lane | the refusal path is removed, or the stop stops the wrong lane |
| listener identity before adoption | the `/ccgpt/lane` (or config-path, or LISTEN-socket ownership) check is removed *(amended, D-3528)* |
| unit properties: `app.slice`, `Restart=always`, transient | the slice or restart policy changes |
| no secret in argv or unit properties | the key moves back into `--setenv` |
| `_inst_codex_tiers` restarts only running, proven, stale tiers, and reports a failure *(amended, D-3485: this named `_inst_enable`)* | the restart or its distinct failure result is removed |
| role gate `!= server` | the gate is removed (a server box converges per-account state) |
| runtime behaviour probe | the probe is skipped, or a failing staged runtime becomes current |
| doctor SKIPs an empty population | the empty case returns PASS |
| doctor's return code equals its worst printed class | a FAIL prints without returning 1 |
| `fiveWindowMinutes` absent ≠ zero | the two are folded |
| `_svc_run_supervised` sits inside the platform sentinels in both files | it is appended below a sentinel, or added to one file only (`macos-platform.test.ts`) |
| the Darwin arm probes before backgrounding | the `command -v` probe is removed and a missing binary reports success |
| the publisher is Python and writes `json.dump` defaults | the row is written compactly — `_limit_json_num` then reads the lane as unknown |
| `fiveResetAt`/`sevenResetAt` are present on every poll, null included | a null key is omitted — `_limit_has_key` then reads the row as ccd's own 429 exclusion |
| `authDir` is refused under `.ccrc/` | the refusal is removed, and `--purge` can reach a credential |
| the runtime build degrades rather than dying | a failed build aborts the install |
| topology-clean has an email class | the class is removed, or an address ships green |
| release and fixture manifests carry every new file | a file is dropped from either |

## 19. Amendments (Plan 2b-2)

Plan 2b-2 (`docs/superpowers/plans/2026-09-23-gpt-lane-ownership-2b2-the-lane-runs.md`) made the lane run. Where its tree departs from a sentence above and the correction does not fit on that sentence's own line, the sentence carries a same-line pointer, `(amended: §19.N, D-NNNN)`, and the item here says what the tree does. **No line above this section moved.** The tree cites this document by line number (`ccd/ccgpt-usage.py` cites §5.4 line 333, and the Plan 2a plan cites lines 497 and 698), so every amendment above rewrites its own line and nothing more. Each D-number is defined in that plan's Deviations found. *(Added 2026-09-28. The final-review fix wave amended §19.2, §19.3, §19.5, §19.6, §19.7, §19.8 and §19.9 the same day, all inside this section.)*

### 19.1 The lane state the lifecycle writes (§5.4)

§5.4's list is what the materialiser writes. The lifecycle writes these beside it:

```
~/.ccrc/codex/<id>/litellm.yaml.prev   # the rendering the litellm op replaced, 0600
~/.ccrc/codex/<id>/litellm.started     # {"generation","code"} the tier was started from
~/.ccrc/codex/<id>/shim.started
~/.ccrc/codex/<id>/litellm.pid         # the nohup arm only
~/.ccrc/codex/<id>/shim.pid
~/.ccrc/codex/<id>/.lock               # the per-lane flock every start and stop takes
```

- `runtime.env` is exactly one line, `LITELLM_MASTER_KEY=sk-<48 lowercase hex>`, at mode 0600. It is minted through `mktemp` in the same directory, so its temp file is owner-only from its first byte, and a symlink planted at a predictable name is never followed (D-3529).
- Account removal reaps these files plus `lane.json`, `runtime.env`, `litellm.yaml` and any `runtime.env.tmp.*` leftover. It never touches the logs or `authDir`.

### 19.2 The launcher and the lifecycle verbs (§4.4, §5.1, §5.3, §7, §8, §9.3, §17)

- **The launcher.** The common launcher is `ccd/ccrc-codex`, placed at `~/.local/bin/ccrc-codex` on every role but `server` (D-3478).
  - On the fleet box, `~/.local/bin/ccgpt` is another repository's live launcher, so ccrc never writes that path. `ccgpt` stays a reserved roster id.
  - `ccgpt-runtime`, `ccgpt-proxy.py` and `ccgpt-usage.py` keep their names, because nothing of the other repository's occupies those paths.
- **What the launcher does.** It interprets no argument (D-3479). It needs `CLAUDE_CONFIG_DIR`, and reverse-maps it through `accounts.sh`'s `_ccrc_dir_id`. It runs `ccrc codex start <id>`, and requires the lane's `settings.json` to name `env.ANTHROPIC_MODEL`. Then it execs Claude Code against the lane's shim, with its argv untouched.
- **What the launcher refuses first** (final review B3, E6). Before it asks ccrc anything, it refuses `no-home` (`HOME` unset or not a directory) and `no-node` (`node` is not on the pane's `PATH`, which `ccrc codex start` needs). A pane's `PATH` is the tmux server's, inherited from the user manager, not the login shell's. A config directory `accounts.sh` does not map refuses `unmapped`, and its remedy is `ccrc install`: that regenerates the projection from the roster and rewrites every lane's wrapper, where `ccrc wrappers` alone leaves `accounts.sh` as it was.
- **The lifecycle verbs** are `ccrc codex start|stop|status|login <id>`, in `ccd/ccrc` (`cmd_codex`), rather than in the launcher.
  - Why there: `_svc_run_supervised` lives in the platform region that only `ccd/ccd` and `ccd/ccrc` carry (D-3479).
  - `start` is an idempotent ensure, and `status --json` is one object.
  - Every refusal is one line, `ccrc codex: <code>: <sentence naming the remedy>`: exit 2 for usage, 1 otherwise.
- **The tier unit names** stay `ccgpt-<id>-litellm.service` and `ccgpt-<id>-shim.service`. §19.5 is what makes a same-named foreign unit safe.

### 19.3 The isolated runtime (§5.2)

- **Generations** (D-3480). `~/.ccrc/runtime/codex/` holds venv generations, `gen-<YYYYmmddTHHMMSSZ>-<pid>/`, and a relative `current` symlink.
  - A generation is built at its final path, because a renamed venv's console scripts exit 127.
  - `current` is swapped by an `ln -s` to a temp name, then one `os.replace` onto `current`, because a bare `mv -f` onto a symlink to a directory follows it.
  - Tiers start from the RESOLVED generation, which `ccgpt-runtime python` answers. A process started through the symlink keeps the unresolved path as `sys.prefix`, so after a swap it would lazily import the next generation's files.
  - The builder keeps the current generation and the one it replaced. It also keeps any generation a lane's tier was started from (named by that tier's `<tier>.started`, so a venv is never deleted under a running tier) and any generation another build is still writing (the pid in its name is alive).
- **The requirement** is `litellm[proxy]>=1.101.0,<1.110`, declared once in `ccd/ccgpt-runtime` (D-3487). A box rebuilds only when `check` fails: no runtime, the requirement or the probe bytes moved, or the installed litellm no longer matches its stamp. Installing it needs pip 22.2 or later (`pip install --report`), which a fresh venv on an older python does not have, so the build brings its own (see **The build**, D-3554).
- **The behaviour probe** gates on the shim's folded output: the request it translates is the one the shim forwards, with both system doors already folded (D-3481).
  - Claude Code's raw shape is translated too, as a canary. The stamp records it (`raw-shape-leaks-system-role=<yes|no|unknown>`, where `unknown` means the raw-shape call failed or captured something other than one request), and it never gates.
  - On litellm 1.101.0 a block-list mid-turn system entry still leaks a `{"role":"system"}` input item in the raw shape, so gating on the raw shape would refuse the runtime the box runs today.
  - `chatgpt` IS a member of `litellm.provider_list` there (measured twice), so §1's and §5.2's argument stands on the experimental translation surface alone.
- **The cost map.** Every litellm import this plan adds (both tiers, the probe, `ccrc codex login`, the usage unit) runs with the cost map local; `ccd/ccrc-models-probe`'s import is Plan 3's (carry-forward 7) (D-3484). Without it, `import litellm` fetches a mutable remote JSON on every start, with three retries.
- **The build** (D-3554, the final-review fix wave's hardening of the plan's build procedure; review B1, B2, B4):
  - **pip first.** The build measures the new venv's pip (`-m pip --version`). A pip older than `_RT_PIP_FLOOR` (`22.2`, one spelling in `ccd/ccgpt-runtime`) is upgraded INSIDE the venv, bounded and non-interactive, before litellm is installed. A pip still too old afterwards (the upgrade failed, timed out, or left it old: an offline box) fails the `pip` stage as `pip-too-old`, remedy first, with nothing installed. A pip whose version cannot be read is left alone, and the install's own error, if any, is the line.
  - **pip is isolated.** Every pip call runs from the generation's own directory, with every `PYTHON*` variable unset, so a `PYTHONPATH` that carries a litellm can no longer make pip install nothing. It is not `-I`, which the review suggested: measured equivalent offline, and the install suite's builder fixture now answers `-I -m pip` as well, so that switch is one line.
  - **Deadlines.** Both pip calls and the probe run under a deadline, through `_rt_timeout`, a byte-for-byte copy of the platform region's `_plat_timeout` (this file sources nothing). The probe's bounded child shell owns its `< probe.py` redirection, so the pure-Bash fallback cannot replace caller-fed stdin with `/dev/null`. The knobs are whole seconds: `CCRC_RUNTIME_PIP_S` (default 1200) and `CCRC_RUNTIME_PROBE_S` (default 300), and a malformed value falls back to the default. A deadline hit fails its stage as `timed-out`, naming the knob. The probe's bytes did not change, so no box rebuilds for this.
  - **What it reads.** No roster and no credential, and of a lane only each `<tier>.started` record, to keep the generation a tier runs from.
- **A failed build degrades, and never kills the install.** The previous generation stays current and the install continues. The one line the build prints names the stage that failed: `venv`, `pip`, `probe`, `stamp` or `swap`. A `pip` stage's line says `pip-too-old`, `timed-out`, or `pip could not install <requirement> (exit <n>): <pip's last line>`, and a probe's may say `timed-out`.

### 19.4 The two platform helpers (§7.1, §7.3)

Both sit above the platform region's closing sentinel, byte-identical in `ccd/ccd` and `ccd/ccrc`.

- **`_svc_have_user_manager`** answers 0 only off Darwin, when `command -v systemd-run` succeeds and `systemctl --user show-environment` answers (D-3483). That is how a box without a usable user manager is detected. On a box whose user manager is wedged, the probe waits for systemd's own D-Bus timeout.
- **`_svc_run_supervised <unit> <log> <envfile|-> [NAME=value ...] -- <cmd> [args...]`**:
  - **Refusals.** It refuses (rc 64, one line, never echoing a value) any `NAME` whose last `_`-separated segment ends with `KEY`, `TOKEN`, `SECRET`, `PASSWORD` or `PASSWD`, in any case. It also refuses a malformed argv. Secrets travel only through `<envfile>`.
  - **The systemd arm** runs one transient unit. It takes `--collect`, `--slice=app.slice` and `--working-directory=$HOME`, plus these properties:
    - `Restart=always` and `RestartSec=3`;
    - bounded start limits;
    - `StandardOutput` and `StandardError` set to `append:<log>`;
    - `EnvironmentFile=<envfile>`.

    Each pair travels as a `--setenv`.
  - **The `nohup` arm** probes that the command exists before it backgrounds anything. It starts from a scrubbed environment: `env -i`, then `HOME`, `PATH`, `LANG` (when set), the envfile's assignments and the pairs. So it matches the systemd arm's clean unit environment.

### 19.5 Identity, stopping and restart (§7.4)

- **Identity.** `_codex_tier_ours <id> <tier>` answers one of five codes:
  - 0: ours, running;
  - 1: not running;
  - 2: foreign;
  - 3: cannot ask;
  - 4: ours, starting. A live handle proves the lane, but the port does not answer yet.
- **The shim's identity** is `GET /ccgpt/lane` answering `{"lane":"<id>"}`. The shim also carries the inert argv word `--ccrc-lane=<id>`, so its pid is provable by its `ps` args.
- **LiteLLM's identity** is a pid, the unit's `MainPID` or the pidfile's on the `nohup` arm. The pid's args must hold `--config $HOME/.ccrc/codex/<id>/litellm.yaml`, AND the pid itself must hold the LISTEN socket on the lane's port (D-3528).
  - A pid proven by its args while another process holds the port answers 2, `listener-other-process`. The shim answers the same word for its own argv-proven pid (`--ccrc-lane=<id>`) while another process holds its port (the fix wave's shim twin, D-3528).
  - Ownership that cannot be measured answers 3. That includes a `readlink` that reads none of the pid's fds. On Darwin, a pid that appears in the port-wide `lsof` list holds the port.
- **Stale handles.** A live pidfile pid whose args do not prove the lane is a stale pidfile, and it is read past. An active unit whose `MainPID` does not prove the lane answers 2.
- **Stopping** (D-3488, D-3528). Every ccrc path that stops a tier stops it only when `_codex_tier_is_our_handle` reads the answer as this lane's own, and only then by its exact unit name or its verified pid. This lane's own means 0, 4, or the 2 `listener-other-process` on either tier: that tier's proven process is stopped, and the port's holder is left running and named. Every other 2, and a 3, is left running and named.
  - The `nohup` arm's SIGKILL, after its TERM, goes only to a pid that still proves the tier (`_codex_pid_is_tier`), never on liveness alone.
  - A crash-looping ccrc tier reads 2 in its own `RestartSec` window, `unit-unproven`, because its unit is live with `MainPID=0`.
  - That sentence says the identity is unproven, and suggests a retry. `ccrc codex status` prints the tier `UNPROVEN` with it (its `--json` state stays `foreign`). Account removal refuses on it, and uninstall leaves it running with the by-hand clause (§19.8).
- **Naming a holder.** Every consumer of a 2 takes its words from `_codex_foreign_what` (the sentence, and its remedy), never a "not this lane" sentence of its own: `status`, `start`, the spine, `ccrc models`, account removal and uninstall.
- **Account removal** of a codex lane stops the lane, then re-measures each tier. This lane's own tier (the handle predicate above), a `unit-unproven` 2 and a 3 each refuse the removal (`codex-reap-failed`, with the roster standing), so the files a live tier restarts from, its pidfile included, are never reaped under it. Only a foreign 2 is left running, as an operator step in `_codex_foreign_what`'s words (D-3528).
- **The lane lock.** Every start and stop takes the lane's `flock` on `~/.ccrc/codex/<id>/.lock`. The lock is re-entrant in the shell that holds it.
- **Restart after an update** is the bare spine step `_inst_codex_tiers`, right after `_inst_enable` (D-3485).
  - It restarts only tiers that are running, proven this lane's, and stale against the resolved generation and the shim's bytes.
  - It restarts by stop then start, because a `systemctl restart` of a transient unit re-runs the OLD generation's argv.
  - A tier still starting (4) is never restarted.
- **Re-measure after every stop** (D-3531). Every stop-then-start re-measures after the stop, and starts only on a fresh 1. That covers the spine step, the per-lane config write (§19.6) and `start`'s own restart of LiteLLM after a new gateway key. A holder that arrived after the stop is named by `_codex_foreign_what`. `start` refuses with that helper's code (`port-foreign` or `unit-foreign`), `ccrc models` refuses `tier-foreign` with the sentence in its detail, and the spine prints no code and counts the tier not restarted. Each says the lane's own tier is now DOWN.
  - In `ccrc models`, both questions (the first one, and the re-check before the restart) run in a subshell whose verdict is read from its last line, a `CX-VERDICT rc=<n>` marker, never from its exit status, and the naming runs nested in a subshell of its own. A missing or malformed marker reads 3, `tier-unmeasured`, so a fault inside the lane library can never read as free and write or start anything (D-3531).

### 19.6 Per-lane LiteLLM configuration (§8)

- **`codex`-kind lanes.** §8's rework lands in Plan 2b-2 for these lanes (D-3482):
  - `_models_litellm_path <id>` answers `~/.ccrc/codex/<id>/litellm.yaml`;
  - the running question is `_codex_tier_ours <id> litellm`;
  - the stop is `_codex_stop_tier`, under the lane lock and identity-gated;
  - the restart is `_codex_start_tier`.
- **The doctrine holds.** STOP-THEN-WRITE holds exactly as §8 argues it, and the restart re-measures after the stop (D-3531; its refusal codes, and the verdict marker, are in §19.5). A write that fails after the stop starts the tier again on the previous bytes.
- **`ccrc codex start`** renders an absent config through the same arm.
- **`external` lanes** keep today's box-global path, the `pgrep` and the bare `ccgpt stop`, byte for byte, until Plan 3's cutover retires that arm. (amended: §20.2, D-3753)

### 19.7 Login (§9.3)

- **The door.** `ccrc account auth-start` does not exist (measured). A codex lane therefore logs in through the pane's existing door: `ccd account-pane --method openai-login` → `_auth_openai_login` → `ccrc codex login <id>` (D-3489).
- **What the login does.** `ccrc codex login` runs the isolated runtime's `Authenticator`, with the lane's `authDir` as `CHATGPT_TOKEN_DIR` and the cost map local. Then it asserts that `auth.json` exists. It checks only that the file exists, never what it holds.
- **The pane's gate** reads the lane's wrapper as well as the roster (D-3530). A lane whose wrapper execs `ccrc-codex` never takes the external arm, whatever the roster answers. The roster read, `_auth_exec_kind`, answers exactly one word: `absent`, `dangling`, `undecidable`, `no-row`, `no-kind`, or `kind:<the roster's own exec.kind>` (the tag keeps a kind spelled like a state word from reading as that state). For a `ccrc-codex` wrapper these are refused by name:
  - a roster that is absent (`roster-absent`). The remedy puts a copy back and retries; otherwise it notes which accounts `accounts.sh` lists, runs `ccrc install` (which seeds a one-account default and drops every other account from `accounts.sh`), declares the lane, and runs `ccrc install` again;
  - a roster that is a symlink to nothing (`roster-dangling`). It names the link's target and says to restore the roster there, or re-point the link, and not to run `ccrc install` first, which replaces the link;
  - a roster that is unreadable or unparseable (`roster-unreadable`);
  - a roster that lacks the row, or names a `generated`, `external` or `upstream` kind for it (`roster-not-codex`). For a missing row it says to restore the row and retry before any install, and names `ccrc wrappers` to see the orphan;
  - a row with no usable kind, or a kind outside `EXEC_KINDS` (`roster-kind-invalid`: fix `exec.kind`, because `ccrc wrappers` and `ccrc install` refuse the whole roster).

  A wrapper that cannot be read, under an undecided roster word, refuses as `launcher-unreadable` (grep exit 2), `dependency-missing` (grep could not run: exit 126 or 127) or `launcher-unmeasured` (any other exit). Decided kinds are unchanged, and external lanes are byte-identical.

### 19.8 Uninstall (§13)

- **When it runs.** `_uninst_codex` runs right after `_uninst_units`. The uninstall half lands with the runtime it removes (D-3490).
- **What it stops.** For each rostered codex lane, under its lock, it stops only tiers `_codex_tier_is_our_handle` reads as this lane's own (0, 4, or a proven process whose port another holds), through `_codex_stop_tier`, which is identity-gated itself. The front tier goes first, by exact unit or verified pid. A foreign or unmeasurable tier is left running and named in `_codex_foreign_what`'s words (D-3488, D-3528).
- **What it skips.** On a box whose `ccrc.env` records `CCRC_ROLE=server` it reads, locks and probes nothing, and says so in one line, as install's two codex steps do nothing there. A rostered lane with no lane directory (`~/.ccrc/codex/<id>/`, which every ccrc start of its tiers writes first) never ran on this box: it prints "nothing to stop", and is not locked, so no `.lock` is created there.
- **What it removes.** It then removes `~/.ccrc/runtime/codex/`, unconditionally.
- **What it leaves.** The usage unit template pair is not removed, because nothing places it yet (D-3172). Plan 3 arms the pair and owns its removal. (amended: §20.4)
- **Finishing by hand** (D-3532). Five lines say how to finish once ccrc is gone: a lane whose lock could not be taken, a tier whose identity could not be measured, a tier proven this lane's that could not be stopped, a unit whose identity is only unproven, and a roster that could not be read. Each carries the same clause, spelled once (`_uninst_codex_by_hand`): run `systemctl --user status ccgpt-<id>-<tier>` (or, where no user manager runs, read the pid in `~/.ccrc/codex/<id>/<tier>.pid`), confirm that the `MainPID`'s or pid's argv names this lane (`--ccrc-lane=<id>`, or a path under `~/.ccrc/runtime/codex`), and only then stop it, because a same-named unit may belong to another tool on this box.
- **What it keeps**, as §13 says: OAuth directories, `~/.ccrc/codex/<id>/`, `~/.ccrc/logs/codex/*`, `~/.ccrc/models/*` and `~/.cc-limits/*`.

### 19.9 Files (§17)

New, as Plan 2b-2 leaves them:

| Path | What |
|---|---|
| `ccd/ccrc-codex` | the common launcher (§19.2) |
| `ccd/ccgpt-runtime` | the isolated runtime builder and its behaviour probe (§19.3) |
| `server/test/ccrc-codex.test.ts` | the lane library and `ccrc codex start\|stop\|status\|login`, both platforms' arms |
| `server/test/ccrc-codex-launcher.test.ts` | the launcher |
| `server/test/ccgpt-runtime.test.ts` | the runtime builder and the probe |
| `server/test/codexLaneFixture.ts` | the shared lane fixture (no `describe`) |
| `server/test/laneReaper.ts` | observation-only `psArgs` assertion helper; it has no numeric-PID signal authority. Fixture teardown is scoped to in-memory current-run product-stop callbacks and directly held child/supervisor handles: a callback can request only a named manager stop, never signal an observed PID. Each fake-manager unit has a per-unit Python supervisor/control channel: fake `systemd-run` writes `starting`, PID zero and `spawned` before it backgrounds the supervisor, which alone then writes state and PID (`active` and the PID as soon as its one `subprocess.Popen` tier exists, before any wait); fake `systemctl`, which carries no signal vocabulary at all, validates the unit directory, creates its request and awaits completion. Once fake `systemd-run` marks a unit spawned, even a still-starting supervisor remains manager-owned and receives only that request; it never falls back to the seeded-unit path. The supervisor's child control never depends on evidence files: every event, state, PID and completion write is best-effort, and a stop request, a vanished unit directory (a fixture HOME that `afterAll` deleted under a live unit), a TERM/HUP/INT to the supervisor, and its finite 120-second default expiry (above the normal 90-second readiness bound, overridable by focused tests, and working with the HOME gone) all take one stop path, so an ordinary passing run leaves no fixture process and no later run gains PID authority. The same direct Python-supervisor shape covers reparented stand-ins. Account HOMEs register before starts so ordinary setup rejection proves process disappearance/process-row absence and port closure; a supervisor records TERM, waits six seconds, records TIMEOUT then requests KILL only on `TimeoutExpired`, performs the final exact wait unconditionally, and emits `WAIT:<returncode>` only from each completed `Popen.wait(...)`. Thus the responsive and resistant protocols pin final exact-child waiting/reaping before manager completion/cleanup returns, and a manager supervisor lingers three seconds after completion without reaping more, so a skipped wait stays visible as a zombie; responsive teardown never requests KILL, while resistant teardown requests KILL and emits `WAIT:-9` only after its final wait returns. Persisted PIDs and request/completion/event protocol files are observation/control data only; the supervisor is never generically killed mid-reap. No descendant-tree ownership, cross-run recovery, or ambient authority is claimed. The accepted residual is manual cleanup of a child orphaned by a SIGKILLed supervisor, or of one left by an interrupted run in which its supervisor died or a directly spawned fixture child carried no expiry (D-3533) |

**Edited beyond §17's list:**
- `ccd/ccrc`: `cmd_codex` and the `_codex_*` lane library, `_inst_codex_runtime`, `_inst_codex_tiers` and `_uninst_codex`;
- `ccd/ccd-account-auth`: the pane's codex arm;
- `deploy/deploy.sh`: the fallback installer places the two new executables;
- `deploy/systemd/ccgpt-usage@.service` (D-3486) (amended: §20.4);
- the install, update, uninstall, models, account, doctor, wrappers and census suites;
- `server/vitest.config.ts`: no lane reaper `globalSetup`; fixture cleanup takes current-run product-stop callbacks while state exists, then directly held child/supervisor handles. Persisted PIDs remain observations only (D-3533).

`ccgpt-lifecycle.test.ts` was never created: `ccrc-codex.test.ts` holds its cases. The other test files §17 names are earlier plans' own.

### 19.10 Who holds each mutation-table row (§18)

Each §18 row Plan 2b-2 owns, with the task and the cases that hold it. Rows not listed are earlier plans'.

| §18 row | Task | Held by |
|---|---|---|
| launcher round-trips `_wrap_parse_shape` | 1 (the target's rename) | `wrapper-roundtrip.test.ts`: "round-trips codex-a unmarked" and "round-trips codex-a once the provenance marker is stamped on" (one pair per fixture row) |
| `_check_wrappers` expects `ccrc-codex` for a codex lane | 1 | `ccrc-doctor.test.ts`: "a Codex launcher execing the upstream account instead of ccrc-codex fails and names both", and "a Codex launcher execing ccgpt — another repository's launcher on the fleet box — fails and names ccrc-codex (D-3478)" |
| `TOOLCHAIN_EXECUTABLES` / `_uninst_wrappers` / `_inst_bins` agreement | 9 | `install-census.test.ts`: the "the id-shaped executables: TOOLCHAIN_EXECUTABLES, _inst_bins and _uninst_wrappers' case are one list" describe |
| `_uninst_tree_bins` and `_uninst_units` completeness | 9 | `install-census.test.ts`: the "ccd/ccrc: the install census and the uninstall census cannot drift apart" describe |
| `_acct_remove` keeps the OAuth directory | 8 | `ccrc-account.test.ts`: "C1: reaps a codex lane's generated state and reports it, keeping its logs and its OAuth" |
| stop-before-write, per lane | 6 | `ccrc-models.test.ts`: "a tier holding the previous rendering is STOPPED, then the bytes land, then it is STARTED on them", "a stop that fails writes NOTHING and starts nothing — restart-failed — and the next run retries", and "rendering one lane stops and starts THAT lane's tier only …" |
| listener identity before adoption | 4, 5 | `ccrc-codex.test.ts`: L5, L17, L29, L30, and the `_codex_tier_ours` describe (D-3528's cases) |
| unit properties: `app.slice`, `Restart=always`, transient | 2, 5 | `macos-platform.test.ts`: "the systemd arm: one transient unit, its whole argv in order, and no key material anywhere"; `ccrc-codex.test.ts`: L11 |
| no secret in argv or unit properties | 2, 5 | `macos-platform.test.ts`: "refuses a NAME whose last _-segment ends with a secret word, in any case …"; `ccrc-codex.test.ts`: L11 (D-3491) |
| `_inst_codex_tiers` restarts only running, proven, stale tiers, and reports a failure | 10 | `ccrc-install.test.ts`: the "ccrc install: the codex tier restart step, measured in isolation (_inst_codex_tiers)" describe, and on a real spine "a restart the user manager refuses is its own FAILED line, and the closing line names codex-tiers" |
| role gate `!= server` | 9, 10 | `install-census.test.ts`: "the name every generated Codex launcher execs is placed by _inst_bins behind its `!= server` gate"; `ccrc-install.test.ts`: "--role server builds nothing and restarts nothing, and says nothing about either" |
| runtime behaviour probe | 3 | `ccgpt-runtime.test.ts`, by default: the two "the behaviour probe over … copies of the litellm stub" describes (for example "without the authenticator FAILS authenticator-import") and "the install suite's own venv python — exit 0 for anything, no stdout — fails the probe (H5)". The translation assertions themselves (M2–M5, for example "M3: the gate fed the unfolded body FAILS a system-door assertion") run only against a real litellm, opt-in through `CCRC_TEST_LITELLM_PY` |
| `_svc_run_supervised` sits inside the platform sentinels in both files | 2 | `macos-platform.test.ts`: "holds every _plat_/_svc_ definition INSIDE the sentinels, in both files" |
| the Darwin arm probes before backgrounding | 2 | `macos-platform.test.ts`: "forced Darwin: a missing command answers 1 and backgrounds NOTHING — probed before the `&`" |
| the runtime build degrades rather than dying | 10 | `ccrc-install.test.ts`: "a runtime whose probe FAILS degrades the install, never fails it, and the previous runtime stays current" |
| release and fixture manifests carry every new file | 9 | `install-census.test.ts`: the "every file `ccrc install` copies out of the tree rides the release tarball (spec §11)" describe |

## 20. Amendments (Plan 3a)

Plan 3a (`docs/superpowers/plans/2026-09-30-gpt-lane-ownership-3a-before-the-flip.md`) lands what the tree must do before any roster row is flipped to `codex`, inert on a roster with none and on the fleet box's live shape: by operator ruling Z (2026-10-01), its merge changes nothing an external lane does. §19's rules hold here: a sentence above that the tree now contradicts carries a same-line pointer, `(amended: §20.N, D-NNNN)`, and the item below says what the tree does. **No line above this section moved:** Plan 3a's close-out proves that every hunk above this heading is a same-line pointer and the rest is this append. Each D-number is defined in that plan's Deviations found. *(Added 2026-09-30.)*

### 20.1 The model probe (§9.1)

- **A codex lane's probe has no default.** `_models_run_probe`'s scrub is unchanged. After it, and after any secrets file, `_models_probe_codex_env` exports for an `exec.kind: "codex"` row `CHATGPT_TOKEN_DIR="$HOME/<exec.authDir>"` (read through `_codex_row`), the lane's runtime interpreter as `CCRC_CODEX_PYTHON` (empty when none resolves), and `CCRC_PROBE_LANE_KIND=codex`, the one marker that sends the probe down its codex path, `_fetch_codex_lane`. That path reads exactly the first two and has no default for either. For every other row the function unsets only the marker and the interpreter. (amended: §21.1, D-4046)
- **The interpreter.** A codex row's probe runs `ccgpt-runtime python` under `-I`, with `LITELLM_LOCAL_MODEL_COST_MAP=True` and every `CHATGPT_*`, `LITELLM_*` and `OPENAI_*` name scrubbed first. This is the probe half that Plan 2b-2 carried forward.
- **Refusals** on the codex path, one line each, with a remedy:
  - `no-token-dir`;
  - `runtime-absent` (run `ccrc install`);
  - `not-logged-in` (run `ccrc codex login <id>`): the `authDir` holds no `auth.json`, tested for existence only, before any interpreter runs;
  - `runtime-api-moved` (run `ccrc update`): the runtime's `Authenticator` lacks a name the unattended guard overrides;
  - `login-required` (run `ccrc codex login <id>`).
  Nothing opens `auth.json` to decide.
- **An external lane keeps today's probe path until its flip (D-3706).** For any row that is not codex-kind, the probe runs exactly as before this plan, through `_fetch_codex`: the token-directory default, the interpreter beside the `litellm` on PATH, and no `-I`. So the hourly refresh keeps probing, refreshing and rendering for an external lane that has a codex registry, and `_check_models` is unchanged. The device-flow guard below is the codex path's alone, because the external path is its own function with today's bytes (ruling Z2's one-program allowance is not taken). Plan 3b's flip moves a lane onto the codex path with no other act.
- **An external lane cannot gain a codex registry (D-3706).** A codex class registry is created only on an `exec.kind: "codex"` row. `ccrc models <id> init codex` on any other row, the `external` rows included, is refused `codex-registry-needs-codex-lane` by `deploy/models-op.mjs`' `init` op, the one creator of a registry, so every caller of the op is covered. It writes nothing and names the remedy: flip the lane to `codex` first (Plan 3b). A registry that already exists is untouched, and every other probe kind is created on any row as before. So on today's shape the default probes only the lane whose directory it is: a lane with no registry is never probed, and none can gain one before its flip. A lane that is flipped back keeps the registry it had as a codex lane, and Plan 3b's rollback says what becomes of it.
- **No device flow outside `ccrc codex login`.** (amended: §21.8)
  - On the probe's codex path and in `ccd/ccgpt-usage.py`, the `Authenticator`'s device-code path is replaced in-process by a `login-required` refusal, which fires before anything writes `auth.json`.
  - So a codex lane whose token cannot be refreshed answers within the probe's bound and never leaves a cooldown marker behind.
  - `ccrc-codex-usage@.service` carries `TimeoutStartSec=300` (D-3707).
- **The account id (closes D-3161 for every codex lane).** The probe's codex path takes `ChatGPT-Account-Id` from `Authenticator().get_account_id()` and opens no `auth.json`. When `auth.json` carries no `account_id`, that call derives one from the token's claims and writes it back: a library write, the same class as its `expires_at` write. The external path's direct `auth.json` read stays, byte for byte, until the final plan deletes that path, so §9's closing sentence is true of every codex lane and not yet of the external path.

### 20.2 The external LiteLLM arm, until each lane's flip (§8, §19.6)

- **It keeps its bytes on a roster with no codex row.** `_models_litellm`'s external arm still renders the other repository's box-global config, still asks the `pgrep`, and still runs the bare `ccgpt stop` when a changed render meets a running proxy. §19.6 stands as written: Plan 3a does not retire the arm before the flip (D-3708 records the retirement ruling Z withdrew).
- **It never runs the other repository's stop once a codex lane exists (D-3753).** A bare `ccgpt stop` stops units by name, and after a flip those names are ccrc's own tiers. So while the roster carries any `exec.kind: "codex"` row, or while the lane library cannot say which rows are, a stop the external arm would owe is refused through its existing `restart-failed` path, before any write, with a sentence that names why and never sends the operator to `ccgpt stop`. On a roster with no codex row this changes nothing, and with nothing to stop the arm still renders as before.
- **A lane leaves the arm at its own flip,** when `_models_litellm_codex` starts answering yes for it. The final plan's ccrc half deletes the arm and this guard together, once no external lane has a codex registry (§20.9).

### 20.3 `_check_codex` (§12)

- **Placement and skips.** The check sits after `models` in the check table. It SKIPs on role `server` and on an empty codex population: one line, then `return 3`. An absent roster file SKIPs too, because the `wrappers` check already FAILs it (D-3723). (amended: §21.5, D-4048, D-4052)
- **An unreadable roster is not an empty population.** `_codex_lanes`' roster-invalid answer and its missing-jq answer are FAILs, naming `ccrc wrappers` and jq (D-3710).
- **The runtime row trusts the stamp.** It asks `ccgpt-runtime check`, which compares the stamp. Doctor never re-runs the behaviour probe; `--fix`'s rebuild is what re-probes (D-3711).
- **`lane.json` staleness is measured two ways.**
  - Against the roster row, by `_codex_lane_json_state`.
  - Against the registry and catalogue, by `deploy/models-op.mjs materialise --check true`, which writes nothing and answers `changed`. Without `--check` it writes, as every caller before it expects (D-3712).
- **A running tier not proven to run the installed bytes is a WARN, and its sentence names every cause it cannot tell apart.** §12's row says "running code older than the installed bytes"; the tree measures something wider. `_codex_tier_stale` compares the tier's start record, `<lane dir>/<tier>.started`, with what a start would write now, so the WARN says the tier "is not proven to run the installed bytes": its start record is absent, unreadable or unparseable, or it names another runtime generation, or another placed shim, than a start would use now. Its remedy is `ccrc update`, whose install step restarts a running, proven, stale ccrc tier, or the lane's own `ccrc codex stop` and `start`. A tier whose staleness cannot be told at all (no current runtime generation, or a code file that cannot be hashed) is its own WARN, "unmeasured, not current": never current, never stale.
- **Rows beyond the table above**, each its own sentence with its own remedy:
  - lane state left for an id that is no longer codex (a flip back);
  - a non-codex registry on a codex lane (FAIL);
  - a tier that cannot be asked at all (a WARN, unmeasured, never PASS, never read as running or as stopped);
  - a stopped `litellm` tier on a lane with live sessions (WARN), and, where the manager gives no word for a lane's session, a WARN that the session is unmeasured, never idle and never live;
  - a unit whose identity is not yet proven inside `RestartSec`, worded as a retry.

  Tier identity is `_codex_tier_ours`, every connect is bounded by `CCRC_CODEX_PROBE_S`, and anything foreign is worded by `_codex_foreign_what`. Nothing is signalled (D-3713, D-3714, D-3715, D-3716). An `authDir` holding no `auth.json` is a FAIL in `ccrc codex start`'s own words (D-3724).
- **Registry facts** are read through `deploy/models-op.mjs`'s check-only ops, never by a second reader of `<id>.classes.json`.
- **The settings-env drift check.** `deploy/account-op.mjs`'s `effectiveBaseUrl` answers `http://127.0.0.1:<proxyPort>` for a codex lane. The rule is absent-or-equal: no ccrc writer puts `ANTHROPIC_BASE_URL` in a codex home's `settings.json` (the launcher exports it instead), so absent is healthy and present-but-different is the WARN (D-3709).
- **Every lane file `deploy/models-op.mjs` reads is type-tested first**, as `_check_models` does (F2, D-2380's class): the catalogue, the class registry, the lane's `settings.json`, each file `materialise --check true` compares, and the previous LiteLLM rendering. A non-regular file, a FIFO above all, gets that read's existing unreadable answer (`catalogue-unreadable`, `registry-unreadable`, `materialise-unreadable`, every settings key missing, no previous rendering), never a block, so no read `_check_codex` makes through models-op, and no check-only read `_fix_codex` makes before it re-renders, can hang on one. This is a failure-path-only difference for every lane, external lanes included, and the live shape cannot reach it. The writer path is unchanged: `materialise`'s settings merge and `rm`'s clear (`shared/modelenv.mjs`'s `mergeSettingsEnv` and `clearSettingsEnv`) still open the lane's `settings.json` by name, so a FIFO there can still block `_fix_codex`'s re-render; that is a carried follow-up, not a claim of this bullet. (amended: §21.6)

### 20.4 Usage publication, under ccrc's own name (§4.3, §10, §11, §12, §13, §19.8)

- **The name.** ccrc's pair is `ccrc-codex-usage@.service` / `ccrc-codex-usage@.timer`, in `deploy/systemd/`.
  - `ccgpt-usage@` stays the other repository's name. ccrc never places, enables, disables or removes a unit under it, and `install-census.test.ts` still refuses that prefix.
  - Wherever a sentence above names `ccgpt-usage@<id>.timer` as ccrc's unit, read `ccrc-codex-usage@<id>.timer` (D-3717).
- **Placement and convergence.**
  - `_inst_units` places the pair on roles `fleet` and `both`, on Linux.
  - `_inst_enable` converges the enabled instance set to exactly the roster's codex lanes, through `_inst_codex_usage`: it withdraws first, disabling any enabled instance whose id is no longer a codex lane, so a flip back converges, and then enables `ccrc-codex-usage@<id>.timer` for each codex lane (D-3718).
  - An unreadable roster, a missing jq, or a shape contract that cannot be read converges nothing, enabling none and withdrawing none, because a set nobody read is not an empty set. Each is its own `NOT CONVERGED` line, and the install continues degraded.
- **Beside a foreign instance.** While the other repository's `ccgpt-usage@<id>.timer` is enabled for the same id, the converge withholds ccrc's enable, withdraws a ccrc instance this box already had for that id, and degrades, and `_check_codex` WARNs with the operator's own disable as the remedy (amended: §21.2, D-4048). Two publishers over one `~/.cc-limits/<id>.json` is the race §10 retires. The other repository's flat, id-less timer cannot be attributed to any lane, so no code refuses on it: the converge prints a note naming the operator's own disable and blocks nothing, retiring it is the runbook's act, and doctor names it as unattributable (D-3719). "Enabled" is read from `timers.target.wants/` links, by one set of helpers that the converge, uninstall, account removal and doctor share (D-3726).
- **The converge's transcript claims only what the run did.**
  - `install: codex-usage: none — no codex lane in the roster` is printed only when the roster has no codex lane and the run neither withdrew a ccrc timer nor failed to.
  - When the roster has a codex lane, or the run withdrew a timer, one line names the lanes the run enabled, withheld from and withdrawn from. Each withheld lane also gets its own `NOT ENABLED` line, which says whether ccrc's own timer for it was withdrawn or could not be.
  - A withdrawal systemd refuses leaves ccrc's timer enabled. It gets its own stderr line with the command, and the run ends with a `NOT CONVERGED` line naming every lane whose timer is still enabled. (amended: §21.2, D-4047, D-4048)
  - A withheld lane or a refused withdrawal makes `codex-usage` one degraded step, however many lanes are involved. A refused enable is named in the closing line by its unit.
- **Degraded timer enables are counted.** Every timer enable in `_inst_enable` that degrades now also joins `INST_DEGRADED`, so the closing line never claims convergence over a failed enable (bookkeeping: Plan 2b-2's carry-forward item 10).
- **Uninstall and account removal.** Uninstall runs `disable --now` on every enabled instance of ccrc's template, then removes the pair, so §13's sentence is now true. Account removal disables ccrc's instance for that id, whatever the row's kind, and keeps its OAuth directory and logs (D-3727). It reports the link removed only when a re-read finds it gone; a disable the manager refuses, or answers while the link stays, is reported as an operator step, and the removal still completes (amended: §21.3, D-4049, D-4050). §19.8's "the usage unit template pair is not removed" no longer holds.

### 20.5 `doctor --fix` (§12)

- **What `_fix_codex` does.**
  - It restores ccrc-owned executables from the shipped tree through `_inst_atomic`, the primitive `_inst_bins` places them with. A file that is missing, not executable, or whose bytes `cmp` does not find equal to the shipped tree's is placed again. With no `cmp` on PATH, only a missing or non-executable file is placed, and every other is named "not compared".
  - It runs `ccgpt-runtime build` (which re-probes) when `ccgpt-runtime check` refuses.
  - Per lane, under the lane lock, it re-materialises `lane.json` when it is stale against the roster or the registry, and re-renders the lane's LiteLLM config through the codex arm (`_models_litellm_lane_held`). Its compare makes a converged file a no-op. When the render changed and the lane's own LiteLLM tier is proven running (or starting), it stops that tier, writes, and starts it on the new bytes; it stops and starts nothing it cannot prove this lane's.
  - Doctor's re-measurement is the verdict.
- **When `--fix` restarts a tier (D-3721).** Through two paths, and no other.
  - **The codex arm's render restart (step 3 above).** A changed `litellm.yaml` under the lane's own proven running LiteLLM tier stops and restarts that tier, on that lane only. This is the arm's stop-before-write, the same act `ccrc models litellm <id>` performs, and it can run on any `--fix`, whatever FAIL called the fixer.
  - **The byte-replacement trigger.** It asks for a tier restart only when one of two things happened. Either it placed the shim (`ccgpt-proxy.py`) or the runtime CLI (`ccgpt-runtime`) again where `cmp` ran and did not answer "same": the bytes differed, or the installed file was absent, or `cmp` could not read it (exit 2), which counts as a difference. Or it rebuilt the runtime and the rebuild left a current one.
  - These are the two files a running tier's identity is computed from. A mode-only fix, a replaced `ccgpt-usage.py` or `ccrc-codex` (code no tier runs), and a placement with no `cmp` on PATH, the one compare that is not made, never ask.
  - That restart is `_inst_codex_tiers`, the same install step `ccrc install` and `ccrc update` run. It restarts only a tier that is ccrc's own, running and measured stale, but it asks every codex lane. So once a fix asks for it, any other stale ccrc-owned tier, on any lane and stale for any reason, is restarted too: exactly what `ccrc update` would do. This is ruled residue, recorded in D-3721.
- **What `_fix_wrappers` does.** A launcher is the `wrappers` check's measurement, so its cure rides that check. `_fix_wrappers` runs the shipped `ccrc wrappers` with no flag, which overwrites only a launcher whose ccrc marker still verifies, writes an absent one, and refuses every other file. It reaches generated launchers too (D-3730).
- **What it never does:** choose a port, run OAuth, read a credential, signal an unproven process, enable or disable a unit, overwrite an unverified launcher, or delete state.
- **Fixers run on a FAIL only.** `cmd_doctor` runs a fixer only on a FAIL, for every check, as `_fix_skills` established.
  - A missing or disabled usage timer is a WARN, so `--fix` does not enable it. That row's remedy is `ccrc install`, whose converge enables the timer.
  - A tier not proven to run the installed bytes is a WARN too (§20.3), so `--fix` never restarts a tier on that finding alone. Its remedy names `ccrc update`, whose install step restarts a proven, stale ccrc tier, or the lane's own `ccrc codex stop` and `start`.
  - So `--fix`, which runs only after the `codex` check FAILed, restarts a tier only through the two paths above: the codex arm's render restart, or the byte-replacement trigger with its any-lane residue (D-3721).
- **The publisher's remedy.** The publisher's refusal for an absent `lane.json` names a remedy that works on this tree.

### 20.6 What converges `lane.json` (§4.2)

- Besides `ccrc wrappers` and `ccrc models litellm <id>`, `lane.json` converges through `ccrc codex start <id>`, which renders whatever is absent, and through `ccrc doctor --fix` (bookkeeping: §4.2 named two of the four paths).

### 20.7 The fallback deploy (§11)

- `deploy/deploy.sh`'s agent arm places ccrc's usage pair, and `agent/test/deploy-verify.test.ts` derives its landed list from the agent chain's own `_unit_atomic` operands rather than keeping a hand-typed one (D-3729).
- `deploy.sh` no longer places `~/.local/bin/ccrc-models-probe`. ccrc never runs that copy; it runs its own tree's copy through `$CCRC_HERE`. Removing a stale PATH copy from a box is Plan 4's job (bookkeeping: ruling R-C11).
- `ccrc-uninstall.test.ts`' absence list is what its fixture planted, and the fixture must plant every `_inst_units` destination (D-3728).

### 20.8 macOS (§10, §12)

- `_inst_units_darwin` places no timer at all (decision 17: macOS is not centrally managed, and `ccrc-models.timer` has no Darwin arm either). So the usage pair and its converge are Linux-only: on Darwin, a box with a codex lane is told once that its usage row is not published there, and that is not a degraded step. On Darwin, `_check_codex`'s usage rows answer a stated not-applicable rather than WARN forever (D-3720).

### 20.9 The cutover's order, as the release lane runs it (§15, §16)

- **The merge is the rollout.** Every merge to `main` becomes a prerelease that both boxes follow automatically, so §15 step 1's "nothing is deployed" and step 2's `ccrc rollout` no longer describe how this work lands.
  - By operator ruling Z (2026-10-01), Plan 3a's merge changes nothing an external lane does. On the fleet box's live shape it places ccrc's inert usage pair and adds doctor's `codex` row, which answers one SKIP. Every other check keeps its class, `models` included, and the external lane's hourly refresh probes, renders and stops exactly as before (D-3705).
  - Its rehearsal (`ccrc-install.test.ts`, "Plan 3a Task 10") is the evidence: it measures the base on the same fixture and asserts that the tip's answer equals it.
- **§15 step 3 is Plan 3b**, one authorisation per lane.
  - Each lane leaves the external path at its own flip, with no other act: from the roster edit on, its probe takes the codex path and its LiteLLM step the lane's own arm.
  - There, "retire the fixed usage timer" means disabling each of that lane's timers from the other repository, the flat one and any template instance, before ccrc's instance is enabled. The converge refuses the out-of-order case for an instance.
  - A lane with no registry gains one only after its flip (§20.1).
- **§15 step 4 is Plan 4**, and its ccrc half is now code and docs: once no external lane has a codex registry, it deletes `_models_litellm`'s external arm, the probe's token-directory default, the external probe path's direct `auth.json` read, and the two guards §20.1 and §20.2 add.

### 20.10 Who holds each mutation-table row Plan 3a added (§18)

| Guard | Task | Held by (the case title, read from the suite at execution) |
|---|---|---|
| a codex lane's probe gets its own `authDir` and runtime, never another lane's | 1 | `ccrc-models.test.ts`: "two codex lanes: each probe is handed its own authDir and the resolved runtime — never the other lane's, an ambient one, or a secrets file's", and "_models_run_probe hands a codex row its own authDir, runtime and marker; every other row gets neither marker nor runtime, and today's CHATGPT_TOKEN_DIR" |
| no token-directory default on the codex path; its refusals | 1 | `models-probe.test.ts`: "handed no CHATGPT_TOKEN_DIR it refuses no-token-dir — there is no default directory — and no interpreter runs", "handed no interpreter it refuses runtime-absent, naming ccrc install — and never falls back to the python beside a litellm on PATH", "with no auth.json in the handed directory it refuses not-logged-in, naming ccrc codex login — existence only, before any interpreter runs", "a runtime whose Authenticator lacks a name the guard overrides is refused runtime-api-moved, before any token is asked", "a runtime whose Authenticator has no get_account_id is refused runtime-api-moved, before any token is asked", and "the codex-lane arm spells no default token directory and no PATH-derived interpreter" |
| the device flow never writes `auth.json` (the probe's codex path and the publisher) | 1 | `models-probe.test.ts`: "a token the runtime can neither use nor refresh is login-required AT ONCE: the device flow never starts, and auth.json is never written", "another sign-in's cooldown is login-required too: the probe never waits on it", and "the unattended guard is ONE text, in the probe and in the usage publisher"; `ccgpt-usage.test.ts`: "Plan 3a Task 1: a token the runtime can neither use nor refresh is login-required at once — no device flow, no auth.json write, nothing published" |
| an external lane keeps today's probe path and hourly refresh, and every doctor check keeps its class, `models` included | 1, 10 | `ccrc-models.test.ts`: "_models_run_probe hands a codex row its own authDir, runtime and marker; every other row gets neither marker nor runtime, and today's CHATGPT_TOKEN_DIR"; `models-probe.test.ts`: "without the codex-lane marker the arm is today's: the python beside the PATH litellm, run as `-`, on the directory it was handed; a handed CCRC_CODEX_PYTHON never runs", and "without the codex-lane marker and handed no directory, the arm still falls back to its own default, and nothing runs where that holds no auth.json"; `ccrc-install.test.ts`: "the base tree: …", "live shape: …" |
| a codex registry is created on a codex-kind row only | 2, 10 | `models-op.test.ts`: "refuses to CREATE a codex registry on %s, a row that is not exec.kind codex, by name, and writes nothing (Z3)" (one case each for `ext-a`, `ext-b` and `gen-a`), "seeds today's codex registry, byte for byte, on a codex-kind lane", and "every other probe kind is still created on an external row (Z3 refuses codex alone)"; `ccrc-models.test.ts`: "refuses to CREATE a codex registry on an external lane, by name, and writes nothing (Z3)", and "an external lane whose codex registry predates this build keeps it: init answers created:false, byte for byte (Z3)"; `ccrc-install.test.ts`: "live shape: …" |
| the external arm keeps its bytes on a roster with no codex row, and refuses the stop it owes once one exists | 2, 10 | `ccrc-models.test.ts`, the describe "once a codex-kind lane exists, the bare stop is never run (Z4)": "on today's shape (no codex-kind row) the bare stop still runs, byte for byte (Z1)", "after a flip, a running proxy on a changed render is REFUSED restart-failed, naming why: nothing stopped, nothing written", "after two flips, the refusal names BOTH codex-kind lanes, in roster order, joined by ", "", "after a flip, with nothing running, the render lands exactly as before: the guard binds the stop alone", "after a flip, an unchanged render asks nothing, even with a proxy running", "a roster whose codex lanes cannot be told refuses the stop too: undecidable is never "no codex lane"", and "the hourly refresh carries the refusal as a FAILED row, exits 1, and still stops nothing"; `ccrc-install.test.ts`: "live shape: …", "ruling Z4: …" (its row of record is the mutation the plan calls M2b) |
| a models case reaches no real `pgrep` or `ccgpt`, and inherits no `CCGPT_CONFIG` | 2 | `ccrc-models.test.ts`: "drops an inherited CCGPT_CONFIG, and poisons pgrep and ccgpt wherever a case planted no stand-in of its own (Plan 3a Task 2)" |
| settings env absent or equal for a codex lane | 3 | `ccrc-doctor.test.ts`: "a codex lane whose env block has no ANTHROPIC_BASE_URL passes, and is counted — its launcher exports the endpoint", "a codex lane whose settings.json has no env block at all passes too", "a codex lane whose env names its own loopback shim passes", "a codex lane whose env names any other endpoint WARNS settings-env-drift, naming both and the hand remedy", "a codex row with no usable proxyPort is not this check's to judge: no finding, and no endpoint invented", and "an external row in the live Codex lanes' shape is judged exactly as before: the arm keys on exec.kind, never provider or telemetry" |
| `_check_codex`: SKIPs, FAILs, rc equals the worst class | 4 | `ccrc-doctor.test.ts`: "SKIPs on a box that records CCRC_ROLE=server — exactly one SKIP line, no verdict, no runner-bug line", "CCRC_ROLE unset is NOT server: the lane is measured, not skipped", "SKIPs a roster with no Codex lane — never a PASS naming no lane", "SKIPs a box with no roster file at all — absent is an answer; the wrappers check owns it", "FAILs — never SKIPs — a roster that cannot be read, naming ccrc wrappers (ruling R-C6)", "FAILs — never SKIPs — a box with no jq, naming jq (ruling R-C6)", and "one lane FAILing and another WARNing: FAIL lines, then WARN lines, each with its own remedy, and the check returns the worst" |
| tier identity, a half-up lane, stale code, a down gateway under live sessions | 5 | `ccrc-doctor.test.ts`: "a listener on the shim port answering as ANOTHER lane FAILs in _codex_foreign_what's words, and is left running", "a listener answering with NO id — the other repository's shim shape, or anything on the LiteLLM port — FAILs as unidentified", "this lane's own LiteLLM while another process holds its port FAILs in _codex_foreign_what's words alone — never "cannot identify"", "one tier running and the other not is FAIL — the shim up, LiteLLM down", "a tier whose identity cannot be measured WARNs "unmeasured" — never half up, never read as running or as stopped", "a live unit of the shim's name whose MainPID is 0 — a restart window — WARNs with the retry wording, never as foreign, and doctor starts nothing", "a running shim whose start record is not current WARNs "not proven to run the installed bytes", naming the record; the current record does not", "a running shim whose bytes cannot be told right now WARNs "unmeasured, not current" — never current, never stale", "a LiteLLM tier down under a LIVE session on the lane WARNs; a session on another lane, or a stopped one, does not", and "a LiteLLM tier down while the manager gives no word for a lane session WARNs "unmeasured, not idle" — never idle, never live" |
| the pair under ccrc's name, one instance per codex lane, the flip-back disable, the degrade beside a foreign instance | 6, 10 | `ccrc-install.test.ts`: "places ccrc's OWN usage pair on both and fleet, and still writes no ccgpt-usage@ name on any role (Plan 3a Task 6)", "one timer per codex lane, in roster order, and none for any other id", "a ccrc timer whose id is no longer a codex lane is DISABLED first — a flip-back converges on the next install", "ANOTHER repository's timer enabled for a codex lane: ccrc's is withheld and withdrawn, the step degrades, and the foreign unit is never named to the manager (R6)", and "a withdrawal refused on the foreign arm: the lane's line says both publishers are armed, a NOT CONVERGED line names what is still on, and codex-usage is ONE step (fix round 1)"; "the flip …", "the flip back …", "out of order: …"; `install-census.test.ts`: "ccrc's usage pair is placed under its OWN name, and nothing else of a usage family is (Plan 3a Task 6)"; `ccrc-doctor.test.ts`: "ANOTHER repository's timer enabled for the same lane: one WARN naming it, remedy the operator's own disable, and a stale row is not judged — ccrc is not its writer (R6)" |
| every timer-enable degrade joins `INST_DEGRADED` | 6 | `ccrc-install.test.ts`: "every timer enable systemd refuses is NAMED in the closing line — derived from what the run asked, nine across both and fleet", and "every timer `_inst_enable` arms after ccd-cap-scopes goes through `_inst_enable_timer`, which counts its refusal" |
| uninstall and account removal disable instances; derived lists | 7 | `ccrc-uninstall.test.ts`: "every ENABLED instance of ccrc's usage template is stopped and disabled while its template is still on disk, whatever the roster says (Plan 3a Task 7; spec §13, ruling R-C9)", and "units: every unit file the box had goes — read off the fixture, which must plant all of _inst_units — disable --now, daemon-reload last, recording stub only (Plan 3a Task 7; 2b-1 item 19)"; `ccrc-account.test.ts`: "C12: removing a codex account disables ccrc's own usage timer for it, reports the link removed, keeps its OAuth and logs, and never names another repository's (Plan 3a Task 7)", "C13: a usage timer the manager will not disable is an operator step, and the removal still completes", "C14: an EXTERNAL account still carrying the ccrc usage timer its codex days enabled has it disabled too — and asks the manager nothing else (C4 stands)", and "C15: a disable the manager answers 0 while the link stays is NOT reported removed — it is an operator step, measured and not assumed (Plan 3a Task 7)" (C15, a case beyond the plan's list that binds the re-read guard, is conformance and carries no number); `agent/test/deploy-verify.test.ts`: "the agent deploy installs every systemd artifact the fleet host actually runs", and "the unit files install ATOMICALLY — a copy that dies mid-write cannot leave a truncated unit live (D-1982)" |
| `_fix_codex` cures FAILs; the re-measurement is the verdict | 8 | `ccrc-doctor.test.ts`: "a fixer runs on a FAIL only: a WARN keeps its verdict and its fixer never runs (R-C8)", "a remedy that names `ccrc doctor --fix` is a FAIL of a check that has a fixer — never a WARN (R-C8)", "a drifted GPT-lane executable is placed again from the shipped tree, and the re-measurement — not the FIX line — is the verdict", "an absent lane.json is rendered by --fix: the remedy the usage publisher names works on this tree", "a byte-drifted shim or runtime CLI is placed again, and only then are the tiers asked: once, last, with the box's own role", "a drifted ccgpt-usage.py is placed again, and no tier is asked: no tier runs it (D-3721)", "a mode-only ccgpt-proxy.py is made executable, and no tier is asked: the bytes a shim tier runs did not change (D-3721)", "with no cmp on PATH, only a missing or non-executable file is placed, every other is named "not compared", and no tier is asked", "never OAuth, never a credential, never a unit: every arm at once touches none of them", "a launcher whose ccrc marker still verifies, written for an older roster, is regenerated, and the one it replaced is kept", and "a launcher ccrc did not write is never overwritten: its FAIL stands, byte for byte, with no backup" |
| a `--force` backup keeps a symlink a symlink | 9 | `ccrc-wrappers.test.ts`: "a symlinked launcher rewritten under --force is backed up as the same symlink, and one mv restores it exactly", and "a regular-file launcher is still backed up as a regular file, with its bytes and its mtime" |
| the live shape is inert through update | 10 | `ccrc-update.test.ts`: "a real update leaves every foreign byte …" |
| the GPT-lane labels in the residue class | 11 | `topology-clean.test.ts`: "forbidden class: fleet account label > nothing in the tree speaks it", the case Task 11's red-first proof turned red on a synthetic plant; the entry itself is a ratchet, and deleting it reds nothing |
| a lane file models-op opens by name is type-tested first: a FIFO is that read's unreadable answer, never a block | final fix wave (MF-2) | `models-op.test.ts`, the describe "a FIFO at a lane file's path is that read's unreadable answer, never a block (MF-2, F2)": "show with a FIFO catalogue answers catalogue-unreadable", "show with a FIFO registry answers registry-unreadable", "show with a FIFO settings.json keeps today's answer for an unreadable one: every key missing", "materialise --check true with a FIFO <id>.classes.tsv answers materialise-unreadable, and writes nothing", and "litellm without --commit, with a FIFO --out, reads no previous rendering: changed:true, and writes nothing"; `ccrc-doctor.test.ts`: "a FIFO at the lane's catalogue is a prompt FAIL naming catalogue-unreadable — never a hang" |
| a rehearsal run that can reach the external arm stands behind `assertForeignFront`: no `CCGPT_CONFIG`, `ccgpt` and `litellm` resolving in the fixture HOME, `ccgpt` this shape's recorder | final fix wave (MF-3) | `ccrc-install.test.ts`, the describe "Plan 3a final fix wave — assertForeignFront refuses every front it was written to refuse (MF-3)": "control: the live shape's front, with no CCGPT_CONFIG, passes", "refuses an env that still carries CCGPT_CONFIG, whatever the names resolve to", "refuses a ccgpt that resolves outside <home>/.local/bin, naming where it resolved", "refuses a <home>/.local/bin/ccgpt that is not this shape's recorder", and "refuses a litellm that resolves outside <home>/.local/bin, naming where it resolved" |

## 21. Amendments (Plan 3b)

Plan 3b (`docs/superpowers/plans/2026-10-05-gpt-lane-ownership-3b-the-cutover.md`) has two parts. Part A is one code PR that lands before any roster row is flipped to `codex`, inert on a roster with none and on the fleet box's live shape. Part B is the per-lane live runbook: each lane's flip is its own operator authorisation, and Part B changes no tracked byte except its close-out's docs PR to that plan. §19's and §20's rules hold here: a sentence above that the tree now contradicts, or that claims more than the tree does, carries a same-line pointer, `(amended: §21.N, D-NNNN)`, and the item below says what is true. **No line above this section moved:** Plan 3b's Task A7 proves that every hunk above this heading is a same-line pointer and the rest is this append. Each D-number is defined in that plan's Deviations found. §21.1-§21.6 are Part A's code, §21.7 and §21.8 correct two sentences Part B relies on, and §21.9-§21.11 say how Part B runs §15 step 3. Part B records its own execution-time departures in that plan's ledger as it reaches them. *(Added 2026-10-05.)*

### 21.1 Every reader of "is this row codex-kind" fails closed (§20.1, §20.2)

- **Three answers, not two.** `_models_litellm_codex` answers 0 for a row that is `exec.kind: "codex"`, 1 for a row that is not, and 2 when the roster cannot say which rows are: `_codex_lanes`' rc 1 (`roster-invalid`) or rc 2 (`missing-dependency`). Any other non-zero `_codex_lanes` rc reads as `roster-invalid`, the library's word for a roster it could not read. On 2 the function forwards `_codex_lanes`' own `ccrc codex: <word>:` line to stderr instead of discarding it. An undecidable roster no longer answers "not codex" (D-4046). An ABSENT roster file is not undecidable: with no roster no row is codex, so it answers 1 without asking `_codex_lanes`, and the external arm's own read refuses `roster-absent` with its remedy, `ccrc install`, as the base did. A roster path that is a dangling link is there and cannot be read, so it stays undecidable.
- **Both readers refuse on 2, in the forwarded word.** The answer has exactly two readers, and Plan 3b's grep names no third. `_models_probe_codex_env` returns the library's own rc, and the probe never runs, so a row that may be codex-kind never reaches the external fetch and its token-directory default, the class D-3706 names. `_models_litellm`'s dispatcher refuses (exit 1) rather than falling through to the external arm, so neither arm acts on a row nobody read. Each refusal carries `roster-invalid` or `missing-dependency`, as `_codex_row`'s propagation already does: the probe seam in the library's own line, the dispatcher in its refusal's word. No new word is minted.
- `_models_litellm_stop_blocked` (§20.2, D-3753) already failed closed on the same input, and is unchanged.
- On a readable roster with jq on PATH the answers are the base's, 0 and 1, so a roster with no codex row, the live shape included, behaves exactly as before.

### 21.2 The usage converge re-measures a withdrawal, and doctor names a ccrc timer with no codex lane (§20.3, §20.4)

- **A withdrawal counts only when the link is gone.** After each `systemctl --user disable --now` in `_inst_codex_usage` (the withdrawal of an id that is no longer a codex lane, and the withdrawal beside another repository's instance) and in `_uninst_codex_usage`, ccrc re-measures `_codex_usage_enabled`. The instance is counted withdrawn, or stopped, only when that re-measure agrees. A disable the manager answers 0 while the link stays is the refusal §20.4 already describes: its own stderr line with the command, and the run's `NOT CONVERGED` line names that lane too (uninstall's own `failed` line, for `_uninst_codex_usage`). It is the re-read account removal already made (§20.4, C15) (D-4047).
- **Doctor names a surplus ccrc timer.** `_check_codex`'s usage rows gain one WARN line of their own for every enabled `ccrc-codex-usage@<id>.timer` whose id is not a codex lane now: a flip back whose withdrawal did not take, or a roster edit no install has converged yet. Such a timer runs ccrc's usage publisher for that id whenever the manager starts it. While the lane's `lane.json` remains (a flip back keeps it), that publisher writes `~/.cc-limits/<id>.json` and refreshes a token in the authDir the file names; with no `lane.json` it refuses and writes nothing, so a timer left with no lane state at all still fails on every start. So it is a finding of its own, never folded into the left-state row, and the WARN says only what the link measures. Its remedy is the exact `systemctl --user disable --now ccrc-codex-usage@<id>.timer`, because no ccrc fixer withdraws a unit, and it names the next update's converge as the automatic cure. That is ccrc's own unit, so naming it breaks nothing §20.4 forbids. On Darwin ccrc places no timer (§20.8), so the measure answers not-applicable and records no row, even over a ccrc link for an id that is no longer a lane (D-4048).
- **Doctor says what the links say.** Such an id is a subject on its own, so the empty-population SKIP never stands over it, and a set ccrc cannot list, because the wrapper shape contract cannot be read, is its own WARN, unmeasured, never read as none. On Linux the left-lane-state WARN's last clause follows the listing: it says "nothing of ccrc's reads it" only when the set was listed and no such timer is enabled for that id; it names ccrc's own timer when one is; and when the set cannot be listed it says whether ccrc's own usage timer still reads the state is unmeasured. On Darwin ccrc places no timer and the set is never listed, so the clause says "nothing of ccrc's reads it" there, which is true. The second-writer WARN says ccrc withholds its own timer only when that timer is not enabled; when both are enabled, it says both publishers are armed and names ccrc's withdrawal first, so §20.4's "with the operator's own disable as the remedy" is the withheld case's remedy. The withdrawal re-measure and the surplus listing presume a `timers.target.wants` directory this user can list: one it cannot reads as empty, with rc 0 (systemd owns that directory; recorded, not guarded).

### 21.3 Account removal waits for an in-flight usage refresh (§13, §20.4)

- After it disables the timer, `_acct_remove_usage` waits for `ccrc-codex-usage@<id>.service` to read `inactive` or `failed` before the limits row, `~/.cc-limits/<id>.json`, is removed. A poll whose last run ended `failed` has ended, so it is done, never in flight. It never stops that service: a oneshot mid-refresh may be writing the lane's `auth.json` through the library (§21.7), and a stop could cut that write short.
- The wait prints one waiting line and is bounded by `CCRC_ACCT_USAGE_WAIT_S`, in whole seconds, default 300, the unit's own `TimeoutStartSec` (D-3707).
- When the bound expires, the removal refuses by name, `usage-refresh-in-flight`, with a sentence telling the operator to retry, before the roster drop and before any limits-row deletion. Every step before the wait is idempotent, so the retry is safe, and Plan 3b pins that. So §20.4's "the removal still completes" holds for a disable the manager refuses or answers while the link stays, and not for a refresh still running when the bound expires (D-4049, D-4050).
- `ccrc account remove` runs this half after its liveness census and before the codex tier stop, the registry rehome, the home sweep and the roster drop, where Plan 3a ran it after the drop. A refusal after the drop could not be retried, because a second run refuses `unknown-id` for an id the roster no longer names (D-4050). The wait holds the placement lock the removal already holds, for at most the bound, and that lock blocks only the other `ccrc account` writing verbs: ccd's placements do not take it and go on (ccd's "A RE-READ, NOT A LOCK"), so a session can be placed on the lane during the wait. A removal that waited therefore takes its liveness census again before it stops a tier or moves anything, and refuses `live-sessions` or `live-unmeasured` as the first census does, saying that the timer this run disabled is all it wrote.
- **What the refusal says about the timer.** The caller's what-still-stands clause reads "all account artifacts still stand", which is false of a timer link that is gone. So at the bound the refusal measures the link: still enabled, it says new polls go on starting and gives the exact `systemctl --user disable --now` first; not enabled, it adds one sentence saying whose doing that is, "this run disabled it" or "it is not enabled, and this run did not disable it" (a retry finds the link its first run took), and that `ccrc install` enables it again for a lane that is still codex. When this run took the link, every refusal after the disable carries the same fact in one sentence: the second census's, the tier stop's, the rehome's, the home sweep's, the drop's and the projection's. They report this run's own disable only: a retry's does not repeat a disable an earlier run made.
- It asks the manager only on Linux, with ccrc's template `ccrc-codex-usage@.service` placed, whether or not the timer is still enabled. A retry finds the timer already disabled. A box without the template, and macOS, ask nothing.
- A manager that does not say whether the poll runs is unmeasured, never done. The removal completes, with an operator step naming the row to remove by hand once the poll reads inactive. A removal that finds no poll running completes as before.

### 21.4 A LiteLLM render that fails with no answer is a failed row (§8, §20.2)

- In `ccrc models refresh`, once a lane's catalogue probe and `materialise` have succeeded and its probe is `codex`, the LiteLLM step runs. When `_models_litellm` exits non-zero and its body carries no non-empty `.detail` (nothing on stdout, as from a killed subshell or any exit that does not pass through `_models_refuse`; a body with no `.detail` or a `null` one; or bytes that are not JSON), the row is `ok: false` with a non-empty `reason` naming that exit, as a `materialise` failure two steps earlier already is. It is never `ok: true` with `litellm: "skipped"`. `litellm: "failed"` stays retired from the row's vocabulary, and the same block reads `.detail // empty`, as the `materialise` block does (D-4051).
- **The reading rule.** On a `probe: "codex"` row, only `ok: true` with `litellm` set to `rendered` or `unchanged` says the LiteLLM step ran and succeeded. `skipped` on such a row is a failure signal on every build, this fix or not. Plan 3b's soak gate counts a refresh as having taken a codex lane's arm only on such a row, for an id the roster names `exec.kind: "codex"`.

### 21.5 Doctor's codex check reads "unmeasured" where it cannot tell (§12, §20.3)

- **A missing `cmp` skips only the byte compare.** `_dr_cx_bins` no longer returns at its cmp-absent WARN. A GPT-lane executable that is missing or not executable, or that has no shipped tree to compare against, is still found and FAILs in its own words. Only the drift compare is unmeasured: one WARN names the files left uncompared ("could not be compared with the shipped tree — unmeasured, not current"), and a file that is missing or has no shipped tree is not on that list, because it FAILs.
- **An unlistable lane-state root is unmeasured, never "no Codex lane".** When `~/.ccrc/codex` exists but cannot be listed, `_check_codex` WARNs that the lane state there is unmeasured, instead of SKIPping as if it were empty.
- **An unreadable `.wrapper` is unmeasured.** `_dr_cx_sessions` counts a session whose `.wrapper` file cannot be read as one that may be on the lane, the "unmeasured, not idle" count of §20.3, never as another lane's session.
- The `cmp` and `.wrapper` changes are codex-lane-only paths. The lane-state root's test is not: it runs on any box, so the SKIP changes there too. A box with no codex lane and no lane state is still one SKIP, the live shape included, provided `~/.ccrc/codex` is absent or can be listed and, on Linux, no ccrc usage timer is enabled for any id and ccrc could list the set of enabled ones (the wrapper shape contract reads) (on Darwin ccrc places no timer, the set is not listed, and the SKIP does not depend on it). Each of those three conditions failing is its own WARN, never a SKIP: an unlistable lane-state root (here, D-4052), a ccrc usage timer enabled for an id that is no longer a codex lane (§21.2, D-4048), and a usage-timer set ccrc cannot list because the wrapper shape contract cannot be read (§21.2, D-4048).

### 21.6 The models writer path is type-tested too (§20.3)

- `shared/modelenv.mjs` exports `readRegular`, the one type-tested read: a path that is not a regular file throws `ENOTREG` before anything is read, so a FIFO never blocks. `deploy/models-op.mjs` imports it and keeps no copy of its own.
- It now guards the lane's `settings.json` read in `mergeSettingsEnv` and in `clearSettingsEnv`, where a non-regular file gets their existing could-not-be-read refusal and nothing is written. It also guards `readRoster`, the read every `deploy/models-op.mjs` op makes first, where a non-regular file answers `roster-unreadable` and an absent file still answers `roster-absent`.
- The tmp-and-rename write is unchanged, so the rename failures `models-op.test.ts` pins (an `EISDIR` target) keep their meaning.
- So no `deploy/models-op.mjs` op that `_fix_codex`'s re-render or a `ccrc models` verb runs can hang on a FIFO at the roster or at a lane's `settings.json`. The bash library's own roster reads (`_codex_lanes`, `_codex_row`, `cmd_models`' reserved-word check, and so `_check_codex` and `_fix_codex`) still hand the roster's path to `jq` by name, and `jq` blocks on a FIFO; this item does not claim them, and the plan lists them as a follow-up that predates Plan 3b. This closes the follow-up §20.3's last bullet names (bookkeeping: conformance to that bullet's own class, D-2380's; it mints nothing).

### 21.7 Who reads an OAuth file, per lane kind (§9)

- **For every codex lane, §9's closing sentence is true of ccrc's own code.** Nothing ccrc ships, whether doctor, installer, publisher, probe or test, opens a real codex lane's `auth.json`; a test reads only the placeholder file its own fixture planted. It checks existence and mode only.
- **The library does read and write it.** LiteLLM's `Authenticator`, inside ccrc's isolated runtime, reads the lane's `auth.json`, and writes it back when it refreshes the token: its `expires_at`, and an `account_id` it derives when the file has none (§20.1). It runs in the probe's codex path, the usage publisher, `ccrc codex login` and the lane's own LiteLLM tier, each against that lane's own `exec.authDir` and never another lane's.
- **For an `external` lane, until its flip,** the probe's external fetch reads `auth.json` directly for `account_id`: the base's bytes, the breach D-3161 records. The other repository's own processes read and write that lane's file as they always have. Plan 4's ccrc PR deletes the external fetch (§20.9).
- That library write is why account removal waits for a running refresh and never stops one (§21.3).

### 21.8 The device flow a lane's own LiteLLM tier can still start (§20.1)

- §20.1's "No device flow outside `ccrc codex login`" holds for the two programs its sub-bullets name: the probe's codex path and the usage publisher replace the `Authenticator`'s device-code path in-process with a `login-required` refusal.
- It does not hold for a codex lane's own LiteLLM tier. The tier runs the runtime's `Authenticator` inside its own process, which that guard does not reach, so a tier that needs a token while the lane's refresh token is dead can still begin a device flow.
- Plan 3b contains it. At each lane's flip, before any session returns to the lane, one refresh, `ccrc models refresh <id>`, runs through the guarded codex path and proves the lane's token refreshes. A `login-required` answer there stops the window for `ccrc codex login <id>`, run with the operator present. Nothing in the tree changes for this.

### 21.9 The lane's entry file, never the shared launcher (§15 step 3)

- §15 step 3's "move an unowned launcher aside" is, for each lane, exactly that lane's own entry file, `~/.local/bin/<id>`: the path `ccrc wrappers` writes for a codex row. It is renamed beside itself with a `.pre-ccrc-<UTC>` suffix before `ccrc wrappers` runs. Where the entry file is a symlink, the link is moved and its target is never touched.
- The other repository's shared launcher, `~/.local/bin/ccgpt`, is never moved, edited or deleted in Plan 3b, because every still-external lane's entry file execs it until that lane's own flip. Plan 4 removes it, with the rest of §15 step 4.
- A rollback moves the entry file back with one `mv`, after ccrc's tiers for the lane are stopped and ccrc's marker-verified launcher is removed.
- The move comes before the roster row turns codex-kind, the reverse of §15 step 3's listed order, so no claimer (`ccrc wrappers`, `_fix_wrappers`, an install) ever meets a codex row over a foreign launcher (D-4053).

### 21.10 The other repository's stop names its lane, and runs only before that lane's flip (§15 step 3, §20.2)

- The shared launcher's `stop` stops one lane's two units: the lane its `CCGPT_ACCOUNT_ID` selects, which defaults to the first lane when unset. So §15 step 3's "stop the old tiers with the currently installed lane-aware launcher" is the lane's own entry file run with `CCGPT_ACCOUNT_ID=<id>` set and `stop`. For any lane but the first, the shared launcher alone refuses without both port variables, which only that entry file exports. It is never a bare `ccgpt stop`, which in any other lane's window stops the first lane's tiers.
- It runs only before that lane's roster flip. From the flip on, the lane's unit names, `ccgpt-<id>-{litellm,shim}.service` (§19.2), are ccrc's own tiers, so no `ccgpt stop` that names a codex lane ever runs. That is the same reason the external arm's bare stop is refused once any codex row exists (D-3753).
- After the stop, the runbook waits longer than those units' `RestartSec` (3 s), then re-checks that the lane's transient units are gone and its two ports are free, by listing units and listening sockets only and connecting to nothing. Only then does `ccrc codex start <id>` run. A `unit-foreign` or `port-foreign` refusal that remains (§20.3's `_codex_foreign_what`) stops the window, and is never overridden.
- **Between two lanes' flips.** While a still-external lane's LiteLLM reads the box-global config and its proxy runs, any refresh that would change that render is refused `restart-failed` (D-3753). `ccrc models refresh --all` then exits 1, and `ccrc-models.service` reads failed on each such run until that lane flips. The lane keeps serving on its unchanged config. Which lane flips first is an operator ruling in Plan 3b, and Part B monitors this bounded degradation read-only until the second flip.

### 21.11 Pausing auto-update for a lane window (§15 step 3, §20.9)

- Unattended updates pause through intent, never through a file. An intent row with `auto: "off"` makes `autoPermits` refuse every unattended dispatch in its scope.
- A per-box pause is an intent row scoped to that node: `POST /api/updates/intent` with `{scope: <nodeId>, auto: "off"}`, a session-gated write only the operator can make. A node's own row overrides the fleet default for exactly that node. The PWA's Settings screen writes only the fleet scope, `*`, so a per-box pause is API-only; a per-node control in the PWA is a follow-up ticket, not Plan 3b.
- `auto: "off"` stops the scheduler, not a `ccrc update` someone runs by hand. `~/.ccrc/update.lock` is the one-update-at-a-time lock, not a pause. A fleet box learns its intent through `ccd-update-sync.timer`'s pull, so a change reaches it within about a minute.
- Plan 3b recommends a fleet-wide pause from the PWA for each lane window, with the prior `auto` and `channel` recorded and restored after verification. The controller reads the state read-only, through `ccrc update --check` and `ccrc channel`.

### 21.12 Who holds each mutation-table row Plan 3b added (§18)

| Guard | Task | Held by (the case title, read from the suite at execution) |
|---|---|---|
| an undecidable roster is never "not codex": every reader refuses in the forwarded word | A1 | `ccrc-models.test.ts`: "a roster whose codex lanes cannot be told (the lane library answers rc 1) is refused at the probe-input seam with its own roster-invalid line and rc — never "not codex", and the probe never runs (Plan 3b Task A1)", "a roster whose codex lanes cannot be told (the lane library answers rc 2) is refused at the probe-input seam with its own missing-dependency line and rc — never "not codex", and the probe never runs (Plan 3b Task A1)", "the REAL lane library over a roster it cannot read: its own roster-invalid sentence reaches the caller, rc 1, and the probe never runs (Plan 3b Task A1)", "a roster whose codex lanes cannot be told refuses the stop too: undecidable is never "no codex lane"", "a roster whose codex lanes cannot be told (the lane library answers rc 1) is refused roster-invalid before either arm — never the box-global file, pgrep, ccgpt or systemd-run (Plan 3b Task A1)", "a roster whose codex lanes cannot be told (the lane library answers rc 2) is refused missing-dependency before either arm — never the box-global file, pgrep, ccgpt or systemd-run (Plan 3b Task A1)", "refresh over a roster whose codex lanes cannot be told: the row is ok:false with the lane library's roster-invalid line as its reason, exit 1, and no pgrep, ccgpt or systemd-run call (Plan 3b Task A1)", and, since the final review, an absent roster keeps `roster-absent` while a dangling one stays undecidable: "an ABSENT roster is not undecidable: the dispatcher answers the external arm's roster-absent, never roster-invalid (Plan 3b Task A1)" and "a roster that is a dangling link is still undecidable: refused roster-invalid before either arm, never read as absent (Plan 3b Task A1)" |
| a withdrawal is counted only when the re-measured link is gone | A2 | `ccrc-install.test.ts`: "a withdrawal the manager answers 0 while its link stays is NOT withdrawn: the could-not-disable line, NOT CONVERGED, and one degraded step — measured, never read off the exit code (Plan 3b Task A2)", and "on the foreign arm too: a disable answered 0 with the link still there says both publishers are armed, never "this run disabled it" (Plan 3b Task A2)"; `ccrc-uninstall.test.ts`: "an instance whose disable the manager answers 0 while its link stays is NOT counted stopped: its failed line names it and the count is the measured one (Plan 3b Task A2, usage template)" |
| an enabled ccrc usage timer with no codex lane is its own WARN, with ccrc's own remedy | A2 | `ccrc-doctor.test.ts`: "WARNs lane state left for an id that is no longer a Codex lane — a flip back keeps it — and never deletes it", "a flip back whose usage timer is still enabled: the left-state WARN no longer says nothing of ccrc's reads it, and the timer is its own WARN (Plan 3b Task A2)", "lane state left behind while the usage-timer set cannot be listed: the left-state WARN says whether ccrc's timer reads it is unmeasured — never "nothing of ccrc's reads it" (Plan 3b Task A2, fix round 1)", "a ccrc usage timer left enabled with no Codex lane and no lane state at all is a WARN — never the empty-population SKIP (Plan 3b Task A2)", "a box whose usage-timer set cannot be listed is a WARN, unmeasured — never the empty-population SKIP (Plan 3b Task A2)", "ANOTHER repository's timer enabled for the same lane: one WARN naming it, remedy the operator's own disable, and a stale row is not judged — ccrc is not its writer (R6)", "ANOTHER repository's timer enabled and ccrc's own withheld, as the converge leaves it: the WARN says ccrc withholds its own — true only now (Plan 3b Task A2)", "every enabled ccrc usage timer belongs to a Codex lane: no surplus, nothing recorded, the manager never asked (Plan 3b Task A2)", "a ccrc usage timer enabled for an id that is no longer a Codex lane WARNs by name — read off the manager's links, never the roster — remedy the exact disable, with the next update's converge as its automatic cure (Plan 3b Task A2)", "ccrc's enabled usage timers that cannot be listed are their own WARN, unmeasured — never "no surplus" (Plan 3b Task A2)", "forced Darwin: the surplus row is not applicable — rc 3 and nothing recorded, even over a ccrc link for a non-codex id (Plan 3b Task A2)", and "_codex_usage_enabled_ids not loaded: _check_codex FAILs in its loaded guard, before any finding is recorded (fix round 1)" |
| account removal waits for a running refresh, never stops it, and refuses `usage-refresh-in-flight` at the bound before any limits-row deletion; a retry completes | A3 | `ccrc-account.test.ts`: "Plan 3b Task A3: a usage poll already running is WAITED for — one waiting line, is-active only, never a stop — before the roster drop and the limits row", "Plan 3b Task A3: a poll still running at the bound REFUSES usage-refresh-in-flight before the roster drop and before any limits-row deletion — never a stop", "Plan 3b Task A3: a retry into the same still-running poll finds the timer already disabled — it refuses again, says it did not disable it, and asks for no second disable", "Plan 3b Task A3: a disable the manager answers 0 while the link stays leaves the timer enabled at the bound — the refusal says new polls go on starting and claims no disable", "Plan 3b Task A3: the refusal is retryable — every step before the wait repeats as a no-op, and the retry completes the removal", "Plan 3b Task A3: a manager that does not say whether the poll runs is UNMEASURED — an operator step, never read as done — and the removal completes", "Plan 3b Task A3: a poll whose last run ended `failed` is DONE — the removal completes at once, with no waiting line and no operator step for the poll", "Plan 3b Task A3: a roster drop that cannot write, after this run disabled the usage timer, says so — the drop's own clause names the withdrawn timer", "Plan 3b Task A3: a projection that cannot be regenerated, after this run disabled the usage timer, says so — the projection clause names the withdrawn timer too", "Plan 3b Task A3: on macOS no manager is asked about a usage poll — ccrc places no usage unit there (decision 17)", "Plan 3b Task A3: CCRC_ACCT_USAGE_WAIT_S is the bound, in whole seconds, default 300, falling back exactly as CCRC_CODEX_READY_S does", "Plan 3b Task A3: a poll reading deactivating is in flight — refused usage-refresh-in-flight at the bound", "Plan 3b Task A3: a poll reading reloading is in flight — refused usage-refresh-in-flight at the bound", "Plan 3b Task A3: a poll reading refreshing is in flight — refused usage-refresh-in-flight at the bound", "Plan 3b Task A3: a usage template that is a dangling link is still asked about — one is-active read", and (`inactive` is done, through its operator-steps filter) "C14: an EXTERNAL account still carrying the ccrc usage timer its codex days enabled has it disabled too — and asks the manager nothing else (C4 stands)" |
| a removal that waited takes its liveness census again before any tier stop, rehome or home sweep, and every refusal after the timer disable says so | A3 (final review, D-4050) | `ccrc-account.test.ts`: "Plan 3b Task A3: a session placed on the lane during the wait refuses the removal after the wait, before any tier stop, rehome or home sweep", "Plan 3b Task A3: a re-census after the wait that cannot tell refuses live-unmeasured, and its clause says what was written (this run disabled the timer)", "Plan 3b Task A3: a re-census after the wait that cannot tell refuses live-unmeasured, and its clause says what was written (the timer was already disabled)", "Plan 3b Task A3: a refusal at the lane lock, after this run disabled the usage timer, says so in its own clause", "Plan 3b Task A3: a refusal at the tier stop, after this run disabled the usage timer, says so in its own clause", "Plan 3b Task A3: a refusal at a registry field that changed, after this run disabled the usage timer, says so in its own clause", "Plan 3b Task A3: a refusal at a rehome that fails, after this run disabled the usage timer, says so in its own clause", and "Plan 3b Task A3: a refusal at the home sweep, after this run disabled the usage timer, says so in its own clause" |
| a LiteLLM render that fails with no answer is an `ok: false` row, never `ok: true` with `skipped` | A4 | `ccrc-models.test.ts`: "Plan 3b Task A4: a render that fails with no stdout at all is a FAILED row naming its exit, never ok:true with litellm "skipped"", "Plan 3b Task A4: a render that fails with an envelope with no detail is a FAILED row naming its exit, never ok:true with litellm "skipped"", "Plan 3b Task A4: a render that fails with bytes that are not JSON is a FAILED row naming its exit, never ok:true with litellm "skipped"", and "Plan 3b Task A4: refresh — a codex lane whose render dies with no answer is a FAILED row naming its exit, and its tier is never asked" |
| doctor's codex check: a missing `cmp`, an unlistable lane-state root and an unreadable `.wrapper` each read unmeasured | A5 | `ccrc-doctor.test.ts`: "with no cmp on PATH, a GPT-lane executable missing from ~/.local/bin still FAILs by name, and only the compare is unmeasured (Plan 3b A-5)", "with no cmp on PATH, a shipped tree that lacks one still FAILs by name (Plan 3b A-5)", "with no cmp on PATH and all four placed, the one codex verdict is the WARN naming all four — never a PASS claiming they match (Plan 3b A-5)", "an unlistable ~/.ccrc/codex is unmeasured — a WARN, never the empty-population SKIP (Plan 3b A-5)", "a regular file where ~/.ccrc/codex belongs is unmeasured too — a WARN, never the SKIP, at any uid (Plan 3b A-5)", "a dangling symlink where ~/.ccrc/codex belongs is unmeasured — a WARN, never read as an absent root (Plan 3b A-5)", "a regular file with every mode bit a directory needs is still unmeasured — it fails `-d` alone (Plan 3b A-5)", "a ~/.ccrc/codex directory this user can search but not read (mode 0300) is unmeasured — it fails `-r` alone (Plan 3b A-5)", "a ~/.ccrc/codex directory this user can read but not search (mode 0600) is unmeasured — it fails `-x` alone (Plan 3b A-5)", "a lane session whose .wrapper cannot be read is unanswered — never another lane's, never idle (Plan 3b A-5)", and "a .wrapper in ccd's own shape — no trailing newline — still reads as this lane's: one live session (Plan 3b A-5)"; its absent-root controls, which must stay a SKIP, are `ccrc-doctor.test.ts`: "SKIPs a roster with no Codex lane — never a PASS naming no lane", and "SKIPs a box with no roster file at all — absent is an answer; the wrappers check owns it" |
| the roster read and the settings merge and clear are type-tested through the one exported `readRegular`: a FIFO is that read's unreadable answer, never a block | A6 | `models-op.test.ts`: "materialise with a FIFO settings.json answers settings-unwritable, and writes nothing after the refused merge (Plan 3b A-6)", "rm with a FIFO settings.json reaps the lane files, then answers settings-unwritable — never a block (Plan 3b A-6)", "every op with a FIFO roster answers roster-unreadable — never a block (Plan 3b A-6)", and "materialise with a DIRECTORY at settings.json still answers settings-unwritable (Plan 3b A-6)"; `single-definition.test.ts`: "a lane file's type-tested read is DEFINED once, in shared/modelenv.mjs, and deploy/models-op.mjs imports it (Plan 3b A-6)" |
