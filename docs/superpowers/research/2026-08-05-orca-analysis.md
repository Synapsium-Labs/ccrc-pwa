# Orca (stablyai/orca) — comparative analysis for ccrc

Analyzed 2026-08-05 from a clone of `stablyai/orca` @ `2ec36a9` (v1.4.169-rc.0) by
three parallel investigators (product/architecture, workspace/session mechanics,
UX/remote surfaces). Every claim below was verified against Orca's source with
file paths; this doc keeps only the conclusions and the paths that matter.

## What Orca is

An MIT-licensed (© Lovecast Inc.) Electron desktop IDE for running ~40 CLI
coding agents in parallel git worktrees — PTY-wrapped real terminals, never
SDKs — with an Expo/React-Native store-app companion, a headless server mode,
an SSH relay it deploys onto remotes, and an SQLite-backed multi-agent
orchestration bus. ~2.35M LOC, ~4,600 test files, 221 Playwright E2E specs,
25–40 merged PRs/day from a funded team. It is ccrc's problem space at two
orders of magnitude more surface — which is exactly why the comparison is
informative in both directions.

## Where ccrc is ahead (keep, and say no to "parity")

1. **The consent fingerprint is genuinely novel.** Orca has NO echo-the-state
   token anywhere: its only fingerprint (`workspace-cleanup.ts`) merely expires
   a "don't ask again" dismissal, and its nearest CAS is `update-ref -d <ref>
   <expectedHead>` on branch deletes. ccd's audit-token → `ws-reap --expect`
   handshake, the 14-input fingerprint, and the resume comparator are a
   stronger consent model than anything in a 2.35M-LOC funded product.
2. **The agent-facing destructive path is guarded here, unguarded there.**
   `orca worktree rm --force` collapses dirty-work consent AND process-stop
   waiver into one flag with no dialog, no dry-run, no ladder — from an agent.
   ccd's no-force rule (pinned by test) and refusal ladder are the moat.
3. **No checkpointing exists in Orca at all.** Their whole answer to dirty
   trees is refuse-or-force. ccrc's planned `ws-checkpoint` (future-work in the
   worktree-ownership spec) would leapfrog them, not catch up.
4. **Merge-gated automation.** Orca's merge detection (GitHub/GitLab, commit
   membership, TTL caches) is elaborate and purely decorative — bulk cleanup
   keys on 7/30-day inactivity only. ccrc's prphase-gated auto-archive and
   merge-proof-gated reap actually act on merge truth.
5. **Push reachability.** Orca mobile has NO push at all (verified: no
   FCM/APNs/push-token anywhere) — local notifications only, dead when the app
   is closed. ccrc's swap-hook push wins on reachability.
6. **Footprint.** Two boxes, systemd, a PWA, one bash script as the authority
   on deletion. Their equivalent is an Electron app + daemon + relay + store
   apps. ccrc should not compete on breadth; its edge is fleet-ops honesty.

## What to steal — Tier 1 (small, concrete, mapped)

1. **Hook-based agent status; demote pane scraping to a ranked fallback.**
   The headline. Orca's thesis comment: *"status comes from hooks — never
   inferred from terminal titles."* They install managed hooks into each
   harness's own config POSTing to a loopback endpoint, normalize to four
   states (`working|blocked|waiting|done`), and rank conversation sources
   `transcript(3) > hook(2) > scrape(1)` — the scrape file opens with an
   apology. ccrc's pane parser is our known fragility (README's own
   "re-capture after Claude Code upgrades" section). Claude Code's hook set
   (`UserPromptSubmit`, `Stop`, `PreToolUse` w/ AskUserQuestion detection,
   `PermissionRequest`, `PostToolUse`) + the existing notify.sh mechanism can
   carry status and the structured ask envelope (`{questions}` / `{approval:
   {tool, summary}}`) to the agent, keeping the scrape as rank-1 fallback.
   Key subtleties they already paid for: AskUserQuestion arrives as
   auto-allowed `PreToolUse`, not `PermissionRequest`; `/compact` emits no
   Stop (PreCompact/PostCompact bracket it); a rehydrated non-done status with
   no live hook since is stale immediately (`restoredUnconfirmed`).
   Files: `src/shared/agent-hook-listener.ts`, `agent-status-types.ts`,
   `src/main/claude/hook-settings.ts`, `native-chat-types.ts`.
2. **The `unseen` ack watermark.** One app-wide map
   `acknowledged[paneKey] < stateStartedAt` drives "needs your eyes" on every
   surface in lockstep. Directly applicable to ccrc's attention feed and
   session cards. File: `build-dashboard-snapshot.ts`.
3. **Notification seq+epoch watermark as ONE atomic JSON value.** Their torn-
   write reasoning is airtight: a seq is meaningless without the counter's
   lifetime (epoch); written separately, a death between writes forges a
   valid-looking pair that silently drops real notifications. ccrc's PWA
   reconnect catch-up should adopt this shape alongside push.
   File: `mobile/src/notifications/notification-reconnect-catchup.ts`.
4. **"Force is not a scalar" (#11960).** Each distinct hazard needs its own
   named waiver, and the hint that tells a user to use an affordance must be
   co-located with the classifier that decides to show it ("a message that
   tells the user to force-delete while the UI hides the button is the same
   dead end"). ccd has no force by design — but the co-location rule applies
   today to ccrc's sentences vs the sheet's affordances (the ws-pull remedy
   sentence from the worktree-ownership build is exactly this class).
5. **Tri-state process-stop proof.** "Observed still live" vs "could not
   confirm" are different human decisions and get different consents. ccd
   already distinguishes `session-busy` from `status-unknown` — parity
   confirmed; keep it, and mirror the language when the sheet renders them.
6. **Session auto-naming rejection ladder.** manual > semantic label >
   generated title > live title, with live titles rejected when they're pure
   status/identity/spinner noise. Slots straight into the smart-branch-naming
   work (ported, unbuilt). File: `agent-row-conversation-name.ts`.
7. **Board-hosted (not card-hosted) dialogs.** Answering flips the card's
   bucket and would unmount a card-owned dialog mid-conversation. ccrc's
   FleetScreen already hosts sheets at screen level — validated; pin it as a
   rule so a refactor never regresses it.
8. **`.worktreeinclude` + shared-directory symlinks.** Validates ccrc's
   spec'd-but-unbuilt env-seeding rider; their hardening checklist (literal
   paths only, size caps, `..`/`.git` rejected, copy budget) is the spec to
   crib. Files: `worktree-include-file.ts`, `worktree-shared-directories.ts`.
9. **Protocol-version handshake, pre-wired but inert.** Both sides exchange
   versions on connect; a kill-switch constant can hard-block a genuinely
   incompatible combo with a dedicated block screen. ccrc has verbSupported
   for ccd-skew; the PWA↔server pair deserves the same dormant wire.

## What to steal — Tier 2 (bigger bets, when their moment comes)

- **Trash-rename deferred delete + restore + crash sweep**
  (`worktree-trash.ts`): rename-aside makes a multi-GB delete a metadata op,
  restorable on failed registration, swept on startup. Would compose well
  under ccd's reap tail (rename, then remove in the background) — but the
  tombstone/attic already covers the consent story; this is a latency/crash-
  safety upgrade, not a safety one.
- **Removal fence**: while a removal is in flight, terminal/watcher installs
  are actively rejected with a shared error string the UI recognizes. ccrc
  equivalent: refuse session-start/attach on a workspace mid-reap (the
  breadcrumb already exists to key on).
- **Pane-identity lifecycle authority + replay-until-ack delivery** (the
  orchestration bus): 11 typed rejection codes so a stale `worker_done` can
  never settle a task; batches replayed verbatim until acked. Relevant the
  day ccrc grows agent-to-agent orchestration; the authority-check shape is
  also a good model for hardening notify.sh's POSTs (pane identity, not just
  session id).
- **Reliability-gates manifest** (`config/reliability-gates.jsonc`): formal
  invariant+oracle+commands per gate, soak promotion policy (100 runs / 14
  days / 0 unexplained flakes). A lightweight version would suit ccrc's CI
  as the suite count grows.
- **AI Vault** (16 harnesses' transcript formats scanned + resumable):
  the model for a future "read the Claude transcript, not the pane" ccrc
  feature — their Claude parser already handles the transcript-UUID ≠
  hook-session-id trap.
- **Relay/E2EE topology** (director/cell, pinned Curve25519, LAN-upgrade
  hysteresis): a validated design IF ccrc ever needs beyond-tailnet access.
  Tailscale currently makes all of it unnecessary — that's a feature.
- **`docs/mobile-relay-ux-findings.md`** in their repo is a free, verified
  catalog of remote-agent mobile failure modes (deep-link param loss, focus
  handlers suspending healthy sessions, invisible connection phases) with the
  timeout constants they landed on. Read it before any ccrc mobile rework.

## UI/UX — where Orca is ahead, and the match/leapfrog moves

Honest scoring of the surfaces themselves, not the plumbing. Orca's UX edge
is concentrated in four places; each has a match move and most have a
leapfrog that exploits assets Orca structurally lacks (merge truth, consent
ceremony, push, instant deploy — no store-review lag).

1. **Attention triage: the four-bucket kanban.** Their dashboard buckets
   every agent `attention | working | done | idle`, cards carry `askSummary`,
   last user/agent message, review state, subagent rows, and the `unseen`
   flag; sidebar counts come from the same builder "so the numbers always
   agree." ccrc's fleet list groups live/archived and leans on the attention
   feed. **Match:** once hook-based status lands, bucket the fleet screen by
   the same four states, counts derived from one snapshot builder.
   **Leapfrog:** add the bucket Orca cannot build — "ready to clean up",
   driven by the real merge-gated audit (their merge detection is decorative;
   ours gates automation). A card that says *merged #157, 1.2 GB reclaimable,
   audit clean* is triage they can't ship.
2. **The conversation surface.** Their native chat renders the transcript
   (rank-3 source) as structured turns with tappable approve/deny cards,
   agent-authored numbered options, and ask cards that clear when the tool
   result lands; the mobile permission heuristic double-gates on a
   hook-reported paused state and refuses to offer "always allow" unless the
   agent's own text offered it. ccrc renders the pane and a scraped dialog
   sheet. **Match:** transcript-first conversation rendering — the agent's
   read whitelist already covers `~/.claude*`, so the JSONL transcripts are
   reachable today; keep the pane as the degraded source (their explicit
   priority: transcript > hook > scrape). **Leapfrog:** make the ask card
   *push-actionable* — answer an AskUserQuestion or approve a permission from
   the notification itself. Orca cannot follow: they have no push at all.
3. **Terminal fidelity under multiple viewers.** Their preview renders at the
   PTY's REAL cols/rows and scales down ("serialized ANSI replayed into
   different dimensions rewraps into garbage"), with grid-claim arbitration
   (claims keyed by target dims, never re-sent unchanged) so phone and
   desktop don't fight over resize. ccrc streams pane captures and will hit
   the tug-of-war the day two clients watch one session. **Match:** adopt
   both rules verbatim when the terminal drawer grows a second viewer;
   they're renderer-side patterns, no server change.
4. **State vocabulary and ambient signals.** Two glyphs per card — one for
   *who* (agent), one for *what state* — "scannable instead of fused";
   `done` gets a check so it can't be confused with grey `idle`; dialogs are
   hosted by the board, not the card, because answering flips the bucket and
   would unmount a card-owned dialog (ccrc's screen-hosted sheets already
   obey this — pin it as a rule). Notification copy is disciplined: repo
   context only when multiple repos are active, stale pane-reuse snapshots
   suppressed, nothing fires for a focused visible pane. **Match:** adopt
   the two-glyph rule and the title discipline in the PWA's cards and push
   copy. (Their desktop pet that animates off live agent state is silly and
   charming; noted, not proposed.)
5. **Accounts and limits on the remote surface.** Their phone shows per-
   provider session + weekly usage bars with reset countdowns, multi-account
   switching, and an idempotent "reset credits" where the phone owns the
   attempt key so a lost response can't spend twice. ccrc shows a limit note
   at 75% on the card. **Match:** a small accounts screen in the PWA fed
   from `~/.cc-limits/*.json` (ccd already parses them for `_ws_least_loaded`)
   — cheap, and this fleet is swap-heavy so it pays immediately. The
   idempotency-key-owned-by-the-client pattern transfers to any retryable
   PWA mutation.
6. **Subagent visibility.** Indented child rows with their own
   working/blocked/waiting state (capped, no PTY of their own). Falls out
   nearly free once Claude's `SubagentStart/Stop` hooks feed the agent —
   worth carrying as an explicit line in the hooks import.
7. **Review-notes on diffs** (annotate the AI's diff, send annotations back
   as the next prompt). ccrc has PR lifecycle but no annotate-to-prompt
   loop. Real feature, bigger lift — tier-2, after the hooks work.

Where ccrc's UX already leads, for the record: the reap consent ceremony
(named children, bytes, clips, sentences — their delete dialog is a checkbox
with "don't ask again"); the degraded-mode banner + offline snapshot; and
the PWA itself — they built a protocol kill-switch and block screen because
store review lags their desktop by 24–48h, while ccrc deploys both halves in
one push with no third party in the loop.

## Design lessons (process, not features)

- **`// Why:` as the comment convention** and comments treated as the design
  record — same culture as ccrc; validating.
- **Skill stub vs guide split**: the discovery stub says "the full reference
  is served by the binary itself — kept out of this file so it can never
  drift from the binary that runs your commands." A clean answer to doc-drift
  that ccrc's ccd could adopt (`ccd help <verb>` as the served truth).
- **Provenance-gated cleanup**: Orca only recursively deletes unregistered
  directories when ITS OWN persisted creation evidence exists — "path shape
  alone is not authority." Same instinct as ccd's ownership pair; parity.
- **The handoff-vs-supervision boundary** in their orchestration guide, incl.
  the honesty rule: "do not retroactively describe the external worker as
  orchestrated." Worth quoting in any future ccrc multi-agent spec.

## Bottom line

Orca validates ccrc's architecture choices at 100x the code: worktree-per-
agent, hooks-over-scraping (they're ahead here — the one place to move),
consent before destruction (ccrc is ahead), merge-truth automation (ccrc is
ahead), remote control of a fleet (different topology, same problems). The
three highest-leverage imports, in order: **(1) hook-based status + structured
ask envelope with scrape demoted to ranked fallback, (2) the unseen ack
watermark, (3) the seq+epoch notification watermark.** All three are small,
none disturb ccd's safety model, and each removes a known ccrc fragility.
