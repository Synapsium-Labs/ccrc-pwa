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
converge it. A minting verb would have to prompt for a free port pair and an OAuth directory, which is a
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
| usage timer | `ccgpt-usage@<id>.timer` |
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
| `deploy/systemd/ccgpt-usage@.service`, `@.timer` | the per-lane usage instance pair |

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
- For a `codex`-kind lane, the bare `ccgpt stop` becomes `_codex_stop_tier <id> litellm`, under the lane's lock and identity-gated (§7.4), and the restart goes through `_codex_start_tier`. An `external` lane keeps the bare `ccgpt stop`, byte for byte, until Plan 3's cutover *(amended 2026-09-28, D-3482, D-3488: this said `ccgpt stop <id>`, "which stops that lane's two units by name")*.

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
   not carry.
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

Nothing in ccrc — doctor, installer, publisher, probe or test — ever reads the contents of an OAuth file.
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
race and the asymmetry, and the publisher loses its lane default: an unnamed lane is an error, not lane one. The instance's `ExecStart` runs the isolated runtime's interpreter, `%h/.ccrc/runtime/codex/current/bin/python -I`, with `LITELLM_LOCAL_MODEL_COST_MAP=True`; a oneshot resolves `current` afresh on every run. The pair itself stays unplaced until Plan 3 arms it (D-3172). *(Amended 2026-09-28, D-3486.)*

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
and `_inst_enable`, once Plan 3 places the pair: until then nothing places it (D-3172). `cmd_install`'s step list is pinned by an exact `toEqual` over the `_inst_*` lines in
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

**Fallback deploy.** `deploy/deploy.sh` gains the matching `install_atomic`/unit lines on its agent arm. Two
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
| no `codex` lane in the roster | SKIP — a scan over an empty set must never PASS (`_check_models`' ruling) |
| a ccrc-owned executable missing or drifted from the shipped tree | FAIL |
| the isolated runtime absent, out of range, or failing its behaviour probe | FAIL |
| `lane.json` or the rendered LiteLLM config absent or stale against the catalogue | FAIL |
| `exec.authDir` absent or unreadable (existence and mode only) | FAIL |
| ports invalid or colliding — belt and braces behind the roster refusal, for a hand-edited file | FAIL |
| a listener on a lane's port that answers another lane's id, or no id | FAIL |
| one tier active and the other not | FAIL |
| an active tier running code older than the installed bytes | WARN |
| `ccgpt-usage@<id>.timer` missing or disabled | WARN |
| the lane's usage row stale, or its probe model absent from the current catalogue | WARN |
| every lane healthy, no tier running (a lane is lazy) | PASS |

The per-lane usage timer is checked **here**, not in `_check_services`: that check's `known` list is a flat
array of fixed unit names, deliberately not a glob over the unit directory, and it has no template precedent.
`_check_codex` enumerates lanes from the roster and asks about `ccgpt-usage@<id>.timer` per lane, which is
the only place the lane set is known.

`_check_wrappers` gains the `codex` case in **all three** of its arms — the shape arm that refuses an
unrecognised kind by name, the counting arm that silently counts nothing, and `_dr_wr_note`'s b-only arm
that says nothing. A spec that assumes "doctor refuses an unknown kind" is right about one of three paths.

`--fix` may: restore a ccrc-owned executable from the shipped tree, rebuild and re-probe a staged runtime,
regenerate a marker-verified launcher, re-render `lane.json` and the LiteLLM config, enable a missing usage
timer, and restart a verified ccrc-owned active tier. It may **not**: choose a port, perform OAuth, read a
credential, kill a listener it cannot identify, overwrite an unverified launcher, or delete user state. Its
only precedent is `_fix_skills`, whose rule is that the fixer re-runs the shipped tree's own installer and
the verdict that counts is doctor's **re-measurement**, never the fixer's word.

## 13. Uninstall

Removed: the four executables (by the `_uninst_tree_bins` census, which gains its derived guard — §5.1), the
usage unit template pair and every enabled instance of it once Plan 3 places them (until then nothing placed the pair, D-3172, so there is nothing to remove), marker-verified per-account launchers, the
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
2. **Release and roll out both boxes.** `ccrc rollout` as usual. Both boxes now *understand* `codex`; none
   uses it. The other repository's runtime is still what serves traffic, and is still the rollback.
3. **Cut over, as a separately authorised act.** Per lane: park sessions; stop the old tiers with the
   currently installed lane-aware launcher; write the lane's `exec` block — kind, provider, the two ports it
   already uses, and its existing `authDir`; move an unowned launcher aside rather than overwriting it;
   `ccrc wrappers`, `ccrc models litellm <id>`, start; verify unit names and slice, listener identity on both
   ports, `/ccgpt/lane`, a streamed turn, a tool call, and a published usage row — none of it by reading a
   secret. Retire the fixed usage timer. Then the next lane.
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

- Deploying or rolling out this migration. The operator authorised the ccrc PR and the eventual deletion;
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
| `deploy/systemd/ccgpt-usage@.service`, `ccgpt-usage@.timer` | per-lane usage instance pair |
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
- **`external` lanes** keep today's box-global path, the `pgrep` and the bare `ccgpt stop`, byte for byte, until Plan 3's cutover retires that arm.

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
- **What it leaves.** The usage unit template pair is not removed, because nothing places it yet (D-3172). Plan 3 arms the pair and owns its removal.
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
- `deploy/systemd/ccgpt-usage@.service` (D-3486);
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
