# Accounts connect A24: the Codex lane's add arm

**Goal:** plan Task A24 of `2026-10-18-accounts-connect.md` (spec §7.2, §9 row 5, §11, G2, G20; D-5519, N4). A ChatGPT lane stops being a hand edit of the roster. `ccrc account add --provider openai` makes it, `remove` deletes its sign-in folder, and Sign in again keeps the old sign-in until the new one has passed its check. No screen changes: A25 is the sheet.

**Before this change:** `add --provider openai` refused `external-provider-use-declare`, so a Codex lane was a roster edit with two ports and a folder chosen by hand. `remove` kept `exec.authDir`, so a re-added id could inherit the old sign-in (G20). An attempt on a Codex lane ran `ccrc codex login <id>` over the lane's own folder, which answers `already-signed-in` for a present credential, so Sign in again did nothing on a lane whose token was still there.

**Change:**
- `ccd/ccrc`:
  - `_acct_codex_pick`, under the placement lock: `codex-runtime-absent` unless `ccgpt-runtime python` resolves; two ports from `CCRC_ACCOUNT_CODEX_PORT_BASE` (14100) that no roster row names and nothing answers on, `no-free-port` otherwise; a folder `.local/share/ccrc/codex/<id>-<rand6>`.
  - `_acct_add` hands those to `check-add` and runs `ccrc models <id> init codex` after the lane state. `--credential` refuses `credential-not-managed` before it is read.
  - `_acct_install_codex`, reached by `set --method openai-login --attempt <a>`: the check, the library's `install`, and a first sign-in's `ccrc models refresh`.
  - `ccrc codex login <id> --scratch`, an attempt's: the sign-in goes to `~/.ccrc/auth-scratch/<id>/codex`.
  - `remove` deletes the lane's `exec.authDir`, unless `--keep-codex-auth` or `--keep-credential`. `--delete-codex-auth` is accepted beside them, as the agent's builder spells it, and the two opposite flags refuse `bad-argument`.
- `deploy/account-op.mjs`: `check-add` takes `--proxy-port`, `--litellm-port` and `--auth-dir`, refuses `authdir-occupied`, and its closing `rosterAdmits` judges the codex row; `addedEntry` assembles it.
- `ccd/ccgpt-auth.py`: `install --from <dir> --auth-dir <dir> --lane <id>` (`install_signin`), through `_commit_signin`, which is `sign_in_device`'s step 5 moved out whole.
- `ccd/ccd-account-auth`: an attempt's Codex sign-in runs `--scratch` and then `_auth_install openai-login`.
- `ccd/ccd`: `cmd_caps` prints `account-codex-v1`.
- `README.md` documents the verb, the install and the removal.

**Tests:**
- New: `server/test/ccrc-account-codex-add.test.ts` (the add, its refusals, the removal, and Sign in again end to end through `fakeAuthServer`).
- Extended: `server/test/codex-auth-cli.test.ts` (`install`), `server/test/ccdCapTokens.ts`.
- Changed: `server/test/ccrc-account.test.ts`. The refusal row that pinned `external-provider-use-declare` now pins `codex-runtime-absent`, the same input's answer on that fixture, and the two removal cases that kept the OAuth pass `--keep-codex-auth`. Both follow from the plan's ruling that the folder goes by default; no assertion was dropped.

**Mutation table (run):**

| Mutant | Suite | Red |
|---|---|---|
| `authDir` without the random suffix | ccrc-account-codex-add | "a re-add of the same id gets a different authDir" |
| a port taken by a listener accepted | ccrc-account-codex-add | "an add writes a codex row with a free port pair…" |
| the roster's ports not read | ccrc-account-codex-add | "two lanes never share a port…" |
| build the venv when absent | ccrc-account-codex-add | "no venv refuses `codex-runtime-absent` and writes nothing…" |
| `authdir-occupied` not refused | ccrc-account-codex-add | "an existing authDir refuses `authdir-occupied`…" |
| remove keeps the authDir by default | ccrc-account-codex-add | "remove from the UI path deletes the authDir", both rows |
| a folder outside ccrc's home deleted | ccrc-account-codex-add | "a folder ccrc did not make is kept and named…" |
| a folder another lane names deleted | ccrc-account-codex-add | "a folder ccrc did not make is kept and named…" |
| Codex re-auth writes into `authDir` directly | ccrc-account-codex-add | "a Codex Sign in again keeps the old `authDir` contents…" |
| the install skips the check | ccrc-account-codex-add | "a scratch credential that fails its check…: the backend does not answer it" |
| a first sign-in renders nothing | ccrc-account-codex-add | "a first sign-in renders the lane's LiteLLM config…" |
| every sign-in refreshes | ccrc-account-codex-add | "Sign in again renders nothing on a lane that has its config…" |

**Per width × skin × mode:** no UI, so "no UI" in all sixteen cells. A25 shows it.

## Decisions

- **D-8016 (2026-11-04)** — `codex-add-as-built` (accounts plan Task A24; spec §7.2, §9 row 5, §11; D-5519, N4): the as-built decisions of A24, and where it departs from the plan's wording.
  1. **`ccrc models litellm <id>` moves from `add` to the first sign-in.** Spec §7.2 step 3 runs it in `add`. Measured, it refuses there: `never-probed`, because it renders from the lane's model catalogue, and only a signed-in lane can fetch one. So `add` runs `models <id> init codex` alone, and `_acct_install_codex` runs `ccrc models refresh <id>` once the credential is in, when `litellm.yaml` is absent. Without it the `check` of §7.2 step 7 would stop at `litellm-unrendered` until the hourly refresh. A refresh that fails refuses nothing: the credential is in, the hourly refresh renders it, and `check` names it until then. A lane that has its config is not refreshed, so Sign in again restarts no tier (§9 row 5).
  2. **The check of a scratch sign-in is the lane's model catalogue, fetched on that credential.** It is the model probe's own fetch, a real answer from the backend. The fetch is told the scratch folder and writes into scratch, so a refusal changes nothing of the lane's, its catalogue included. Any failure refuses `token-unverified`. The probe's words do not separate a rejected credential from an unreachable backend, so no `key-rejected` is claimed.
  3. **The move is the auth library's.** The plan's Files list has no `ccd/ccgpt-auth.py`, but it predates the codex-bridge spec's §2.6, and the library is now the one writer of `auth.json`. A bash copy would be a second writer that holds neither the library's lock nor its checkpoint. `install_signin` holds its own offline checks too (present, unexpired, not barred, 0600 or tighter, this user's), since it is a verb of its own, and refuses `signin-unusable`, which the verb answers as `no-credential`.
  4. **Every attempt on a Codex lane signs in to scratch, a first sign-in too.** The plan names Sign in again. The helper never reads the authDir, so it cannot tell the two apart, and it need not: one path, and a device flow that always runs. `ccrc codex login <id>` with no attempt stays as it was.
  5. **`remove`'s default is delete** (spec §11 step 4, Q11; the plan's mutant "remove keeps the authDir by default"). The route sends no field today and deletes, which is the UI's default. `--keep-codex-auth` is the CLI's, and `--keep-credential` implies it, because a Codex lane's credential is that folder. A25's unticked line needs a way to say keep: it adds a `keepCodexAuth` field to `shared/account-argv.ts` and takes `deleteCodexAuth` on the route. That is agent-side, so that PR is agent-first.
  6. **Two folders stay whatever was asked.** One outside `.local/share/ccrc/codex/`, which only a hand-written row can name and ccrc did not make, and one another lane's row still names, which the roster does not refuse. Each is reported in `kept` and named in `operator-steps`.
  7. **`account-codex-v1` is in `ccd caps` and not yet in `ACCOUNT_CAPS`.** N4 lists it for A24. As with `account-auth-v1` (D-7849 (1)), the word joins `ACCOUNT_CAPS` with the screen that uses it, A25, so `connect.caps` does not offer a sheet that does not exist.
  8. **The usage timer waits.** `_inst_codex_usage` is the one converger of `ccrc-codex-usage@<id>.timer`, and it needs the install spine. `add` does not enable it, and says so in `operator-steps`. The next `ccrc install` or `ccrc update` does.
  9. **`external-provider-use-declare` is retired.** `openai` was the one provider `add` could not generate, so the refusal has no input left. `declare --provider openai` is unchanged.
  10. **The growth check.** `ccd/ccrc` grows past the 40-line limit, so this PR adds the waiver `server/test/growth-waivers/D-8016-ccd-ccrc.json`.
  11. **Deploying this restarts each `litellm`-mode Codex tier once.** A tier's `.started` record hashes the placed auth library, so a new library reads as stale and `_inst_codex_tiers` restarts it, as for any change to that file. In-flight turns fail once and retry.
