# Rescue reads auth loss — Plan

> **For agentic workers:** a single-task fix, done in one commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a session stuck on lost auth under Claude Code 2.1.280 is rescued (or stranded, with no
destination) the way a rate-limited one is, without widening any reader that a `--resume` landing can
fool, and without a rescue that bounces back to the dead account.

**Background, measured 2026-09-23 and 2026-09-26** (private tmux, mock API, both renderers): every final
banner Claude Code 2.1.280 prints sits 4 rows above the prompt box's top border (5 when it wraps), so
the rescue's `tail -8` pane window never sees it. Rate-limit banners are rescued anyway, by D-2363's
transcript arm, which reads the newest real row's `error` field — including the API-key 429's new
wording (`API Error: Request rejected (429) · …`), whose field is `rate_limit`. Auth loss was rescued by
nothing: `⎿  Invalid API key · …`, `⎿  Not logged in · Please run /login` and
`● Please run /login · API Error: 401 …` all carry `error:"authentication_failed"`,
`apiErrorStatus:401`. The old pane alternation names the auth phrases, but only inside the window the
banner never reaches.

**Why not the pane:** `_pane_hard_blocked`'s text also drives `_spawn_settle`'s rc 5 over a FULL-pane
capture and `_redrive_after_spawn`'s stand-down, and `--resume` re-renders old API-error rows (measured
in #182: `● API Error: Request rejected (429) · …` re-rendered in both renderers). A wider pane reader
would read the old account's banner on the new one. The transcript cannot be fooled that way by a
re-render, nor by prose, since `isApiErrorMessage` is an envelope field.

## Task 1: the transcript arm reads a 401 its own process wrote

**Files:** `ccd/ccd` (`_transcript_limit_banner`, `_session_hard_blocked`, `_swap_target`),
`server/test/ccd-limit-banner.test.ts`, `server/test/ccd-authdead.test.ts`, `README.md`.

- [x] Red: `stuck` mode answers rc 0 for real 401 `authentication_failed` rows written at or after the
  pane's tmux `session_created`, and rc 1 for an earlier process's row, a 403, `billing_error`,
  `server_error`, the text on a plain row, a user row, and after a META resume prompt; the default mode
  is unchanged; `_auto_swap_check` rescues (`via=transcript`) and the strand half strands on a 401, and a
  draft still stands the arm down; `_swap_target` never returns a session to an auth-dead home.
- [x] Green: the `stuck` mode and its `since` gate (`_pane_born`); `_session_hard_blocked` passes both; the
  home-recovered arm of `_swap_target` asks `_authdead`; a rescue off a 401 writes the marker.
- [x] Re-stamp `ccd/ccd`; re-measure the citation census (S6-R11); mutation table.

## Deviations found

- **D-3522** — *Operator ruling 2026-09-26 widens limit detection; the widening lands on the transcript
  arm, reads a 401 its own process wrote, and D-2364 stands.* What shipped: `_transcript_limit_banner`
  gains a `stuck` mode that also accepts a newest real row carrying `isApiErrorMessage:true`,
  `error:"authentication_failed"` and `apiErrorStatus:401`, written at or after a `since` epoch;
  `_session_hard_blocked` — the rescue arm's and the strand half's one verdict — asks in that mode with the
  pane's tmux `session_created` as `since`; and `_swap_target`'s "home recovered: go back" arm refuses an
  auth-dead home. The default mode, its `rate_limit` literal pinned to `RATE_LIMIT_ERROR`, and the
  rate-limit behaviour are unchanged; the arm keeps its stand-downs (a running turn, a fresh stale press,
  a draft in the box) and its 30-second cache. Each narrowing is a loop a held-out review measured:
  - **An earlier process's row does not count.** A swap carries the transcript, and 2.1.280 will not
    re-drive a turn whose error is over six hours old (`tengu_resume_stale_turn_suppressed`), so the old
    account's 401 stayed the newest real row on the new account and swapped a healthy session every
    `SWAP_COOLDOWN`. ccd creates a fresh tmux session per spawn, so `session_created` bounds this process.
    No `since`, or an unreadable row timestamp, and the row does not count — main's behaviour.
  - **403 is out.** 2.1.280 files a model-permission refusal under the same `error`, and a swap cannot
    grant a model.
  - **Never back to an auth-dead home.** A 401 writes no usage telemetry, so `_avail` passed the home the
    session was rescued off. The home-recovered arm now refuses an auth-dead home (the candidate loop
    still ranks one last, never ineligible). Round 2 found the marker too often absent for that alone:
    `ccd-account-health` is systemd-only (none on macOS), silent for an account it cannot probe, and a
    clean spawn on the account wipes it. So a rescue off a 401 its own process wrote now writes the
    marker itself (`rescue-401`, the probe's format and rename), after a FRESH stuck-mode scan names the
    401; it never writes over a standing marker (the probe re-stamps its own on every pass, and every
    reader takes the file as a boolean). The marker's owners become four: the probe (writes
    on 401, clears on a live answer), the rescue (writes), a clean spawn and an operator `rm` (clear).
    CARRIED, not fixed: a clean spawn on the dead account still clears the marker — 2.1.280 brings up a
    working prompt on a dead credential — so each such spawn can cost one bounce until the next 401
    re-marks it. That rule predates this entry and is owner 2 of spec §A.6.

  What did NOT ship, and why: widening a PANE reader — D-2364 declined that because a `--resume` landing
  might re-render the previous account's banner where `_spawn_settle` reads for rc 5; that re-render is
  now measured, so its function stays untouched. And exhausted credit (`billing_error`, a 400): nothing
  marks a billing-dead account, so a rescue off one would be sent straight back; it needs a marker of its
  own first. Likewise `account_on_hold`, `oauth_org_not_allowed` and `verification_required`.
