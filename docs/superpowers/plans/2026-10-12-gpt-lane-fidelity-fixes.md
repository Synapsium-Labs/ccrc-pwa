# GPT lane fidelity fixes — Implementation Plan

> Executed in one controller session on 2026-10-12, on the operator's go: "shim fixes - yes", "let's not pin, ship real fix instead". Task A and Task B were dispatched to native subagents in sequence, and every diff was reviewed by the controller. This file records what each task did, and it is the home of the two deviation numbers the fixes needed.

**Goal:** make a Codex ("GPT") lane's sessions, subagents included, see Claude Code's system prompt as their system prompt, and receive every parallel tool call with its arguments.

**Architecture:** two independent defects on the request and response paths of the same lane.
- **Request path.** The shim (`ccd/ccgpt-proxy.py`) keeps the top-level `system` as a plain string behind one lead line, so LiteLLM carries it in Codex's `instructions`.
- **Response path.** The runtime (`ccd/ccgpt-runtime`) installs one ccrc patch into each LiteLLM generation, so a finished tool call or message whose fields were never streamed still reaches Claude Code. The behaviour probe is the acceptance test of both.

**Spec:** `docs/superpowers/specs/2026-09-20-gpt-lane-ownership-design.md` §22 (this PR's amendment), §5.2, §6.1.

## Evidence (measured 2026-10-12, before any change)

- **Instructions.** LiteLLM's chatgpt provider sets `instructions` to its own Codex CLI prompt, about 7,500 characters starting "You are Codex". The shim folded Claude Code's system prompt into the first user turn. This was reproduced offline by passing a synthetic body through the real shim and LiteLLM code, with no network. The behavioural fingerprint comes from transcripts, counts only:
  - GPT subagents ran `rg` far more often than `grep`: 6,818 to 502 on one model tier and 4,416 to 177 on another.
  - Subagents on one tier tried `apply_patch` through Bash 54 times.
- **Parallel tool calls.** GPT responses with two or more tool calls arrived all-empty in 70-91% of cases on Claude Code ≥ 2.1.292, against 0% at ≤ 2.1.284. Single-call responses were essentially never affected: 13 of 21,588.
  - On the same Claude Code 2.1.292, one lane measured 55% before its flip and 91% after.
  - A live recording on one lane (operator-approved, one request) showed two Read calls arriving with input `{}` and no `input_json_delta` events.
  - Offline, an unpatched LiteLLM fed a no-delta Codex stream reproduces that shape exactly, on 1.101.0 and 1.104.0.
- **Not yet explained.** Why newer Claude Code versions draw no-delta responses from Codex more often is unknown. The fix does not depend on it.

## Task A: the shim keeps the system prompt (D-4858)

Commit `4e758058f`. Files: `ccd/ccgpt-proxy.py`, `server/test/ccgpt-proxy.test.ts`, `README.md`.

- **The code.** `SYSTEM_LEAD` is one module-level ASCII line. `_system_as_instructions` replaces `_fold_system`. It pops `system`, flattens it with the existing `_system_to_text` (a string as is, text blocks joined by a blank line, anything else to nothing), and writes back `SYSTEM_LEAD`, a blank line, then the text. A `system` that flattens to nothing is dropped, never sent as the lead line alone. `messages` is not read. The call site keeps its shape: `_fold_midturn_system`, then `if "system" in data:` `_system_as_instructions`, then `_apply_effort`. Every comment that argued the fold's order (D-3152) or its `tool_result` prepend (D-3156) now says what superseded it.
- **The tests.** The describe "ccgpt-proxy: the top-level system door" is rewritten. Each case asserts the lead-lined `system` and a `messages` identical to what was sent, mid-turn roles aside. New cases cover a multi-block system, four no-text shapes, and the call site. The test spells `SYSTEM_LEAD` as its own literal, so drift in the shim's constant reds it. The chunked case's expected body is recomputed by hand, 275 bytes with `system` as the last key, and is now compared whole. Six "no `system` key" assertions in the gzip, deflate and transport cases now assert the lead-lined value. The task-9 I-1 measurement is now a regression pin: the system prompt never touches a leading `tool_result`.
- **Red first.** Against the unchanged shim, 16 of the rewritten cases failed, every one because the old fold popped `system`.
- **Mutations, measured.** With the call line deleted, "the call site runs" goes red (`expected 'object' to be 'string'`), and 20 cases fail across the file. With `_system_as_instructions` returning its input unchanged, 20 cases fail. Both were restored, checked byte-equal by sha256.
- **README.** The lane paragraph now says only mid-conversation entries become user turns. The top-level prompt is kept as the system prompt behind a lead line, which LiteLLM carries in Codex's `instructions`.
- **Runs.** `ccgpt-proxy.test.ts` 89/89, `dtbd.test.ts` 1/1, `typecheck-tests.test.ts` 12/12. `single-definition.test.ts` went 535/537 at load 78, with two 20-second timeouts in cases unrelated to this change, then 537/537 run alone.

## Task B: the runtime ships the LiteLLM stream patch, and the probe proves both fixes (D-4859)

Commit `4f90b5f5f`. Files: `ccd/ccgpt-runtime`, `server/test/ccgpt-runtime.test.ts`, `server/test/codexLaneFixture.ts`, `server/test/ccrc-install.test.ts`.

- **The patch stage.** `_rt_patch_source` prints the module verbatim from a `PATCH` heredoc, and the new `patch-source` verb exposes it. A new `patch` stage runs after pip and before the probe. It finds the generation's site-packages by the glob `lib/python3*/site-packages` and requires exactly one. It writes `ccrc_litellm_patch.py` and a one-line `ccrc_litellm_patch.pth` there with redirects alone, and any failure is the `patch` stage's one line. The module is the one validated offline before the task began, embedded byte for byte (checked with `cmp`).
- **The rebuild trigger.** `check`'s expected `probeSha256` hashes `probe-source` followed by `patch-source`. The build stamps the hash of the bytes that ran: the generation's `.ccrc-probe.py`, then its installed patch file. A patch file that is gone by then hashes to nothing, so the build fails at `stamp`, never stamping the probe's hash alone. The stamp's keys, doctor's words, the PASS line and the built line are unchanged.
- **The probe.** `SHIM_OUT` is the shipped shim's output: the lead-lined top-level `system`, and an untouched first turn. `top-system-in-leading-turn` becomes `top-system-in-instructions`. Two scripted Codex streams follow, carrying two parallel tool calls and a text, one with every delta event and one with none. The Anthropic events are folded per block, and both streams must give exactly the two calls' arguments and the text: `stream-tool-args-kept` for the no-delta stream, `stream-deltas-not-duplicated` for the streamed one. A harness error is `translate-stream`.
- **Ruling: the gate carries the whole lead-lined string.** The brief's literal gate, the top-level text inside `instructions`, passes on LiteLLM 1.104.0 even for a body the shim never rewrote. That version maps the raw shape's own system to `instructions`, so the "the gate fed the unrewritten body" mutation stayed green. The probe now requires the shim's whole `system` string, lead line included, which implies the brief's condition. Ruled by the controller. Cost if wrong: none to behaviour, since the gate is strictly stronger.
- **The tests.** The fake `python3 -m venv` makes a site-packages directory and can be told to make none or two. The fake probe records the site-packages listing and the `.pth` bytes at probe time, which proves the patch was written first. A real `python3 -m venv --without-pip` case proves the `.pth` claim: the module loads under `-I -c`, `-I -` and `-I -m`, not under `-I -S`, and importing it imports no LiteLLM. A hook-mechanics case runs against a minimal fake bridge module written into a temporary directory, never into the shared Python stub. The opt-in layer supplies the patch through `PYTHONPATH` to a borrowed interpreter and adds M6 to M9. `plantFakeRuntime` and the install suite's runtime template follow the new hash and the site-packages directory.
- **Red first.** Against the unchanged script, 11 cases failed. The fixture change was red in `ccrc-codex.test.ts` (1 case), and the install suite's runtime describe was red in 3 cases ("build failed at patch: the new venv has no site-packages"), before each was fixed.
- **Mutations, measured.** Each was applied alone, its named test run, and the file restored and checked with `cmp`. There are 13 in the default suite: the two site-packages checks, the stage order, the stamp hash, the empty-hash fallback, `check`'s hash, the `.pth` line, the usage line, the probe's fold, a top-level `import litellm`, the hook disabled, the fallback firing after deltas, and the idempotency mark. Two more ran on a real LiteLLM 1.104.0: the stream gate disabled and the system gate reduced to the brief's form. Each one's red line is in spec §22.3.

## Verification

Every run was in the foreground, against fixture HOMEs only. The box was loaded throughout (load average 35 to 99), so the larger files were run in groups, and a timeout was re-run alone.

| Suite | Result |
|---|---|
| `ccgpt-proxy.test.ts` | 89 passed |
| `ccgpt-runtime.test.ts` | 75 passed, 9 skipped (the opt-in layer) |
| `ccgpt-runtime.test.ts`, opt-in layer, LiteLLM 1.104.0 | 9 passed: control PASS, M2 to M9 red |
| `ccgpt-runtime.test.ts`, opt-in layer, LiteLLM 1.101.0 | 9 passed: control PASS, M2 to M9 red |
| `ccrc-install.test.ts`, in six describe groups covering all 298 cases | 300 passed (two cases match two groups), 0 failed |
| `ccrc-doctor.test.ts`, in six chunks | 878 passed. One case timed out at 20 s under load and passed alone |
| `ccrc-uninstall.test.ts` | 93 passed, 4 skipped. A first run had two 20 s timeouts under load; both passed alone and in a second whole run |
| `ccrc-codex.test.ts`, `ccrc-models.test.ts`, `models-op.test.ts`, `models-probe.test.ts`, `ccrc-codex-launcher.test.ts`, `ccgpt-usage.test.ts` | 203, 177, 124, 61, 30 and 37 passed |
| `single-definition.test.ts` | 537 passed |
| `macos-platform.test.ts` | 101 passed, 11 skipped |
| `dtbd.test.ts`, `typecheck-tests.test.ts` | 1 and 12 passed |
| `deviation-refs.test.ts`, against `origin/main` | 31 passed (D-4858 and D-4859 each defined once, here) |

## Deviations found

Each number below was issued by the allocator (`POST /api/ledger/deviations`, through `ccrc-api ledger allocate`) on 2026-10-12, in one issue of two, and each is defined once, here.

- **D-4858** — `system-door-kept-as-instructions`: spec §6.1 item 2 is reversed. The shim keeps Claude Code's top-level `system` top-level, as a plain string behind `SYSTEM_LEAD`, instead of folding it into the leading user turn. So LiteLLM carries it in Codex's `instructions`, after LiteLLM's own Codex CLI base. Folded, the system prompt reached GPT models as user text below the Codex CLI prompt and lost every conflict with it; the operator relayed the complaint on 2026-10-12, that GPT-lane subagents ignore their briefs. §6.1's premise for the top-level door no longer holds: a plain-string top-level `system` maps to `instructions` on LiteLLM 1.101.0 and 1.104.0, measured offline. The mid-conversation door is unchanged. D-3152's order argument is retired, since the two steps touch disjoint fields, and D-3156's accepted prepend no longer happens. The probe's `top-system-in-leading-turn` becomes `top-system-in-instructions`. Spec §22.1.
- **D-4859** — `runtime-carries-litellm-stream-patch`: §5.2's runtime is no longer plain upstream LiteLLM. Each generation carries `ccrc_litellm_patch`, which ccgpt-runtime's new `patch` stage writes and a `.pth` loads. When Codex streamed no delta for a finished tool call or message, the patch makes LiteLLM's chat-bridge stream iterator forward that item's arguments or text. The probe gains `stream-tool-args-kept` and `stream-deltas-not-duplicated`, and `probeSha256` now hashes the probe's bytes followed by the patch's. No LiteLLM release in range carries a fix: 1.101.0, 1.104.0 and 1.106.0-rc.1 were read. The patch substitutes only for a done event whose item streamed nothing, so an upstream fix makes it inert. Remove it then, in a reviewed commit that keeps both stream assertions. Spec §22.2.
