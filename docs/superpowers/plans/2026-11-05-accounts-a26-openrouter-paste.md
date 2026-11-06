# Accounts connect A26: OpenRouter by paste on the box

**Goal:** plan Task A26 of `2026-10-18-accounts-connect.md` (spec §3.4, §8.3–§8.6; D-5520, D-5521, D-5556, N4; G7, G8, G28). An OpenRouter key is checked on the fleet box before anything is written, a management key can never become a lane's key, an OpenRouter lane carries its own telemetry and placement, and it starts on suggested models. No screen changes: A27 is the first that shows any of it.

**Before this change:** `add --provider openrouter` wrote whatever it was handed, with `telemetry: "anthropic"`, `homeAble: true` and no models unless the operator typed them. Nothing read the key's credit. `--placement` was an unknown argument, although the agent's argv table has carried it since A8.

**Gates:** #565, #435 and #410 are merged. A26a (#763, 06f4ccab6) is first in v0.0.369, and the fleet runs v0.0.993, which `git tag --contains` lists, so both parsers on the box take `telemetry: "openrouter"`. A16 is merged.

**Change:**
- `ccd/ccrc`:
  - `add --provider openrouter`: the catalogue, then the byte check, then `_acct_or_validate`, and only then the writes. Without `--models`, `_acct_or_suggest` reads the catalogue into the lane's probe directory and `check-add` judges the map exactly as it judges a typed one. After the converge, `_acct_or_registry` moves that catalogue into `~/.ccrc/models/` and runs `init openrouter --suggested`.
  - `_acct_or_read_key`: `GET https://openrouter.ai/api/v1/key` with `curl -sS -H @- --proto =https --max-redirs 0 --max-time 10`, stdin exactly one header line, stderr dropped. The answer goes to `or-key`.
  - `credential` on an OpenRouter lane validates first, so the old file and the old facts stand until the new key passes. `check` reads the credit again on a lane ccrc wrote, in a subshell the sourced key dies with; an external launcher's secrets file is never read.
  - `add --placement overflow|full`; `models <id> init openrouter --suggested`, which reads the catalogue itself, because `refresh` serves only a lane that has a registry.
- `deploy/account-op.mjs`: `PROVIDER_TELEMETRY` (`openrouter`, and `none` for compatible lanes); `homeAble` from the plan's `placement`; `check-add` takes `--placement`, overflow by default on an OpenRouter lane, and refuses `placement-not-supported` elsewhere; `or-key` reads the status and the body into a verdict and facts; `lane-state` takes `--key-hint`, `--key-source`, `--key-facts` and `--validated-at`, and keeps `keyLabel`.
- `deploy/models-op.mjs`: `suggest --catalogue <path>` answers the roster's map, and `init --suggested true`, on the openrouter probe only, seeds the classes, the subagent class and the discovery list from the lane's catalogue. A bare `init openrouter` stays unseeded.
- `shared/model-suggest.mjs` (new, pure): `suggestedClasses` and `suggestedModelMap`, the one rule both callers read.
- `ccd/ccrc-models-probe`: `--max-redirs 0` on both OpenRouter calls.
- `ccd/ccd`: `cmd_caps` prints `account-openrouter-v2`.
- `README.md` documents all of it.

**Tests:**
- New: `server/test/ccrc-account-openrouter-v2.test.ts`.
- Extended: `server/test/account-canary.test.ts` (an OpenRouter paste-add, a refused key and a Replace key through the route and both arms, with a `curl` that echoes its stdin on stderr), `server/test/ccrc-account.test.ts`, `server/test/ccdCapTokens.ts`, `server/test/laneStateFixture.ts`.

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| `curl --config -` | ccrc-account-openrouter-v2 | "the hostile key … curl reads a header, never a config" |
| the key on `-H "Authorization: …"` argv | ccrc-account-openrouter-v2 | "…on no argv" |
| ignore `is_provisioning_key` | ccrc-account-openrouter-v2 | "a management key (is_provisioning_key) refuses…" |
| write the key before the catalogue | ccrc-account-openrouter-v2 | "an unreadable catalogue writes nothing…", and the two other broken catalogues |
| drop `--max-redirs 0`, from the key call and from the catalogue call | ccrc-account-openrouter-v2 | "every OpenRouter call uses…" |
| keep curl's stderr | ccrc-account-openrouter-v2 | "…on no argv", the verb's own stderr |
| a compatible lane writes `anthropic` | ccrc-account-openrouter-v2 | "openrouter and compatible rows carry their own telemetry" |
| overflow not the default | ccrc-account-openrouter-v2 | "`--placement` defaults to overflow…" |
| `credential` skips the validation | ccrc-account-openrouter-v2 | "…keeps the old file and the old facts", all three |
| `check` skips the credit | ccrc-account-openrouter-v2 | "a good read moves the credit…" |
| the first listed id wins | ccrc-account-openrouter-v2 | "takes the newest of each class…" |
| a `:batch` id admitted | ccrc-account-openrouter-v2 | "never suggests a variant…" |
| the registry step's subshell removed | ccrc-account-openrouter-v2 | "a models lock it cannot open…" |
| the scratch left on a refusal | ccrc-account-openrouter-v2 | "a refused key leaves no catalogue behind" |
| the old facts kept through a new key | ccrc-account-openrouter-v2 | "a new key whose answer leaves a fact out…" |

**Per width × skin × mode:** no UI in all sixteen cells. A27 is the first screen that shows an OpenRouter lane's key, credit or models.

## Deviations found

- **D-8023 (2026-11-05)** — Task A26 as built, eleven decisions its Files list and shape did not make.
  1. **`init` runs after the roster entry, and the catalogue is what runs first.** The plan has `add` run `ccrc models <id> init openrouter` before it writes the key, but `init` refuses `no-such-account` until the roster names the lane, and it merges into the lane's `settings.json`. What the plan's order is for, that an unreadable catalogue writes nothing, holds: the catalogue is fetched and the map chosen before the key is even read, and `init` follows the converge on that same file, which is spec §8.3 step 4's order.
  2. **What "suggested" means.** OpenRouter's catalogue names no suggested model, and `init openrouter` seeds nothing, so nothing on `main` answered the spec's sentence. The rule is `suggestedClasses`: per class, the newest visible `anthropic/claude-<class>-<version>`, by `compareVersions`, `:batch` and other variants excluded. Measured against the public catalogue on 2026-11-05: 30 Anthropic ids, all in this grammar. A catalogue with no id for opus, sonnet or haiku refuses `catalogue-unreachable`, because the screen's sentence is true of it too. `fable` fills when the catalogue lists one, as the spec allows.
  3. **The seed does not ask the ownership question.** `discovery add` on an openrouter lane checks `~/.handoff/providers-whitelist.json` against the model's endpoints. The seed does not: spec §8.5 names the public catalogue and no key, and a box with no whitelist file would refuse every add. Each later `discovery add` still passes through it. This is the one place a registry's discovery list skips that check, so it is named here for the reviewers.
  4. **The key source is `pasted`,** the word `LANE_KEY_SOURCES` and the reader use. The plan's `keySource: 'paste'` would be dropped by `laneStateOf`.
  5. **`account-openrouter-v2` stays out of `ACCOUNT_CAPS` until A27,** D-7793 (1)'s rule for `account-auth-v1`: `ccd caps` advertises it, and the server offers it once a sheet can run it.
  6. **The new refusal codes get no route word.** `wrong-key-kind`, `key-unverified` and `catalogue-unreachable` ride `lane-act-refused` with `verbCode`, the existing path for a code no screen words yet, so this task changes no server file. `key-rejected` is already a route word.
  7. **`check` reads the credit,** which the plan's shape leaves out and D-5521 and G8 name. A failed read keeps the last reading, whose time shows its age. A management key found on a lane adds a note to the check's answer and changes no verdict.
  8. **`selectable: true` is not a field.** The roster has no account-level `selectable`, and `ACCOUNT_KEYS` would warn on one: every lane is pickable. So `overflow` writes only `homeAble: false`.
  9. **`keyLabel` is a new lane-state field,** and `credit` keeps `usage` and `is_free_tier` beside the two figures the reader takes. `laneStateOf` and `LaneWire` are unchanged: the label and the usage line reach the wire with the screen that shows them, A27.
  10. **`ccrc-models-probe` changes,** though the Files list does not name it, because Step 1's "every OpenRouter call" includes its catalogue fetch.
  11. **A new key's facts replace the old key's whole.** The lane state merges, and a 200 may leave a fact out ("a fact off its grammar is left out"), so a Replace key would have kept the old key's credit beside the new key's hint, and a fresh key could read `credit used up`. `--key-source` marks a new key, and `lane-state` drops the hint and the four facts before it writes what the answer said. `check` passes no source, so a reading that leaves a fact out keeps the last one.

  Known limits: a lane removed and added again under its old id keeps the class registry `remove` left (`init` answers `created: false`), so the roster's fresh map and that registry can differ until `ccrc models <id> rm` has run first. A TERM between a Replace key's rename and its lane-state write leaves the old hint and credit beside the new key, with `check` already cleared. `--method pkce` with a pasted key, which `check-add` still admits, is validated like a paste and reads `pasted` until A28.
