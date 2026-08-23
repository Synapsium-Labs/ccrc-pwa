# ccrc — self-hosted remote-control app for Claude Code sessions

**Date:** 2026-07-20
**Status:** Approved design, pending implementation plan

## Why

The official claude.ai remote-control experience fails the ccd fleet in four ways:

1. **Account-swap breaks discovery.** ccd auto-swaps sessions between the three
   accounts; the official app loses the session and requires logging out/in to
   the other account to find it.
2. **No fleet view.** The official app shows one account's sessions; we run 6+
   sessions across 3 accounts and want status, limits, and last-activity in one
   dashboard.
3. **Mobile UX ceiling.** Termux/Haven give a raw TUI; the official app is
   limited. We want a purpose-built chat UI with rendered markdown, tool
   traces, and tappable dialogs.
4. **Relay dependency.** All remote driving today routes through Anthropic's
   first-party relay. We want self-hosted end-to-end over Tailscale.

### Why we cannot use official surfaces (researched 2026-07-20)

- `--remote-control` has **no local API** — outbound HTTPS to Anthropic's
  relay, consumable by first-party clients only.
- The **IDE WebSocket protocol** is localhost-bound and IDE-centric (diagnostics,
  diff viewer) — not a session-driving surface.
- The **Agent SDK** can `--resume` an *ended* session but cannot attach to a
  live interactive one, and bills API credits, not subscription.
- **Headless `claude -p stream-json`** is stateless per invocation and bills
  the separate $200/mo `claude -p` credit pool.

Decisive constraint: the fleet is only economical while sessions remain
**interactive TUI processes on Max subscription billing**. Therefore the app
drives the existing tmux sessions from the outside — the pattern the OpenClaw
Discord bridge already validated (JSONL tailing + tmux keystroke injection).

## Chosen approach

**Structured hybrid with terminal escape hatch** (chosen over a pure structured
app and over a terminal-mirror-first build):

- The product is a chat-style PWA built on JSONL transcripts + tmux injection.
- Every session also has a raw xterm.js **terminal drawer** (WebSocket PTY to
  `tmux attach`). Anything the structured layer cannot parse degrades to the
  drawer instead of blocking.

## V1 scope

- Fleet dashboard: all sessions across all 3 accounts — status, account,
  limits, last activity.
- Drive any session: send prompts, answer dialogs (permission prompts,
  AskUserQuestion menus, `/model` picker), interrupt, run slash commands.
- Image/screenshot upload from phone into a session prompt.
- Full lifecycle: start new sessions (wrapper + project), stop/restart,
  trigger `ccd swap`.
- Mobile-first PWA; desktop is the same layout with more air.

**Out of scope for v1:** push notifications (in-app "waiting on you" badges
instead; ntfy/web-push is a later bolt-on), multi-user/auth accounts, any
changes to the Discord bridge.

## Architecture

Working name **ccrc**, repo home `infra/ccrc/`, deployed to the <server-host> box.

Two pieces:

1. **ccrc-server** — one Node 22 + TypeScript process, systemd user unit
   `ccrc.service` (lingering already enabled on the box). Serves on one port:
   - the static PWA bundle,
   - REST (fleet, lifecycle, uploads),
   - WebSockets (transcript stream per session; raw PTY stream for the drawer).

   It shells out to existing tools — `ccd` for lifecycle/swap/clip, `tmux` for
   capture and injection — and holds no database: the filesystem is the state
   (`~/.cc-sessions/`, `~/.cc-limits/`, `<config>/sessions/`, transcript
   JSONLs). Server is stateless across restarts; stream offsets live
   client-side.

2. **ccrc-pwa** — React + Vite installable PWA served by the same process;
   xterm.js only inside the terminal drawer.

**Security:** binds the Tailscale address (203.0.113.7) only, never
0.0.0.0. Tailscale is the auth perimeter — the same trust model as `cc`/mosh.
Optional static bearer token as later hardening.

**Relationship to existing systems:** read-only consumer of ccd's files plus a
caller of its CLI. Zero ccd code changes. One config-surface addition: an
executable `~/.cc-sessions/notify.sh` (ccd's existing optional hook) POSTs
auto-swap events to ccrc-server.

## Data plane (reads)

**Fleet.** Polled ~2s, pushed over WebSocket. Sources:
- `~/.cc-sessions/<id>.*` — id, wrapper/account, project, workdir, live uuid
  (kept current by ccd's `_sync_uuid`);
- `<config>/sessions/<pid>.json` — busy/idle status, `statusUpdatedAt`,
  current sessionId, live cwd;
- `~/.cc-limits/<wrapper>.json` — 5h/7d per account, with ccd's staleness
  decay;
- `tmux has-session -t cc-<id>` — alive vs dead.

**Conversation.** Transcript path =
`<config>/projects/<munged-live-cwd>/<registry-uuid>.jsonl`. The munged dir is
derived from the **live cwd** in `sessions/<pid>.json`, not the registry
workdir — this bakes in the 2026-07-05 worktree-transcript lesson. The server
tails the file by offset (`fs.watch`), parses entries, and streams typed
events: user turns, assistant text, tool_use/tool_result pairs (collapsible
cards), thinking elided. Initial load = last 50 turns; infinite scroll-back.
Uuid rotation (at `/clear`/compaction) is followed by re-resolving whenever the
registry `.uuid` changes.

**Dialog detection** (the one genuinely new mechanism). When a session is idle
but the pane is not at the normal `❯` prompt, capture the pane and parse the
menu block: options plus the `Enter to confirm` footer family ccd already
matches. Push a structured event — title, body, options, preselected index.
Permission prompts, AskUserQuestion, trust/resume gates, and the `/model`
picker share this TUI shape; one parser covers all. Parse failure → `unparsed`
event with raw pane text; the UI's answer is the terminal drawer.

## Control plane (writes)

All writes per-session **serialized** (one queue) so concurrent taps cannot
interleave keystrokes. Injection reuses the bridge's `do_send_interactive`
patterns.

- **Prompts:** `tmux send-keys -l` literal text, then `Enter` separately.
  Pre-check the input box for a draft; if present, the UI asks append/replace
  rather than silently corrupting it. Sending while busy is allowed (queues as
  a steering message).
- **Dialog answers:** tapped option → exact arrow-key walk from the parsed
  preselected index, then Enter — never a blind Enter. If the pane changed
  since parse (stale dialog), re-capture, re-parse, reject the answer.
- **Interrupt:** sends `Escape`; button enabled only while busy, so an idle
  tap cannot clear a draft or trigger history rewind.
- **Slash commands / model:** the prompt box accepts any `/command` via the
  same path (box-must-be-empty guard for the draft-swallow gotcha). "Change
  model" quick-action sends `/model`; the picker arrives through the dialog
  parser.
- **Lifecycle:** REST endpoints exec `~/.local/bin/ccd start|ensure|stop|enable`
  and `ccd swap <id> <wrapper>`. ccrc-server lives outside the sessions'
  systemd units, so the 2026-07-05 cgroup half-kill trap structurally cannot
  recur. New-session form: wrapper picker + project path from configurable
  roots plus known registry projects.
- **Images:** multipart upload → server stores file → `ccd clip <png> <id>`.

## PWA UX (mobile-first)

Designed for a phone in one hand.

- **Home = fleet.** Vertical session cards (project big; account chip;
  busy/idle/dead dot; account limits bar; last-activity age). Tap → session.
  Pull-to-refresh. Floating "+" opens the new-session form (all tap targets).
- **Session = chat.** Input bar docked above the virtual keyboard
  (visual-viewport aware). Tool cards collapsed by default. Sticky header:
  name, account chip, busy spinner, stop (Esc) top-right, active only while
  busy. Dialogs render as **bottom sheets** with large tappable options,
  preselected marked. Attach button → photo picker/camera → `ccd clip`.
- **Terminal drawer.** Swipe-up sheet with xterm.js, phone-tuned: legible
  font, fit-to-width, quick-key row (Esc, arrows, Tab, Enter, Shift+Tab).
  Must be operable one-thumbed.
- **Mobile realities.** Streams resumable by offset; foregrounding resyncs
  silently — no manual refresh, no duplicate messages. "Waiting on you"
  badges on cards for pending dialogs.
- Primary manual test target: Android Chrome PWA (WebAPK install); iOS Safari
  supported second.

### Design ambition (first-class requirement)

Beauty is a stated goal of this project, on par with function. The app must
look and feel *designed* — a distinctive, intentional aesthetic — not a
component-library assembly.

- **Dedicated design phase** at the start of implementation, driven by the
  frontend-design skill: an explicit art direction (palette, typography,
  spatial system, voice of the UI) chosen and documented before the first
  screen is built. Candidate direction to explore: a refined
  terminal-heritage aesthetic — monospace accents, session-status glow,
  dark-first with a true light theme — but the direction is decided in that
  phase, not defaulted.
- **Motion as a design layer:** streaming assistant text renders progressively
  (as it does in first-party clients); busy states breathe rather than spin;
  card→chat navigation is a shared-element transition; sheets and drawer
  spring. Motion budget respects `prefers-reduced-motion`.
- **Micro-interaction inventory:** every interactive element has designed
  pressed/disabled/loading states; sends tick through
  pending→confirmed→failed visibly; limit bars and status dots animate on
  change rather than snapping.
- **Every state designed:** loading (skeletons), empty (first-run fleet, empty
  chat), error, offline, and dead-session states each get deliberate visual
  treatment — no unstyled fallbacks anywhere in the app.
- **Quality gate:** a screen ships only when it would not look out of place
  next to the best native chat apps; "works but looks default" fails review.

### Usability principles

Robust *and* effortless — the two goals reinforce, not trade off:

- **Zero learning curve.** If you can use a messaging app, you can use ccrc.
  All ccd/tmux machinery stays invisible; the user sees sessions, messages,
  and buttons. Jargon-free labels ("Move to another account", not "swap
  wrapper").
- **Two taps to anything.** Open app → tap session → you're driving. Every
  v1 capability is reachable within two taps of the fleet screen; nothing
  requires typing except messages themselves (and project search).
- **Forgiving by default.** Destructive actions (stop, swap) confirm with a
  clear consequence sentence; sends are verified and visibly retryable;
  nothing the app offers can wedge a session in a way `ensure` + the drawer
  can't recover.
- **Self-explanatory states.** Every card and banner says what's happening
  *and* what to do next ("Session hit its 5h limit — moving to claude-corp"
  / "Claude is asking you something — tap to answer"). No state the user has
  to interpret from a status dot alone.

### Native-like bar (acceptance criteria, not aspirations)

Installed from the home screen, ccrc must be indistinguishable from a native
chat app in feel:

- **Standalone install:** `display: standalone`, maskable icons, theme-color,
  splash — no browser chrome; appears in the Android app drawer via WebAPK.
- **Instant cold start:** service worker precaches the app shell; opening the
  installed app renders the fleet (last-known state + skeletons, clearly
  marked stale until the socket reconnects) with no white flash.
- **Scroll feel:** virtualized chat list (transcripts are huge) holding 60fps;
  `overscroll-behavior` kills rubber-band/pull-to-refresh hijacking inside
  the chat; momentum scrolling native.
- **Keyboard discipline:** visual-viewport-driven input bar; inputs ≥16px
  font so iOS never zoom-jumps; focus never scrolls the conversation away.
- **Touch discipline:** all targets ≥44px; safe-area insets respected
  (notch/gesture bar); bottom sheets and the terminal drawer animate with
  spring-feel transitions, dismissible by swipe.
- **Optimistic send:** a sent message appears instantly with a pending tick,
  confirmed when capture-verify passes, flipped to a visible error state if
  it fails — never a frozen input bar waiting on the server.

## Error handling

Policy: **degrade to raw, never silently drop.**

- Unparseable pane → `unparsed` event + "open terminal" CTA; logged
  server-side so parser gaps become a fixture backlog.
- Every injection is capture-verified; mismatch → explicit "send failed" with
  pane snapshot, no blind retry.
- Dead session → card flips dead; chat read-only over last-known transcript;
  one-tap `ensure`.
- Auto-swap mid-use → notify.sh event; watcher re-resolves config dir + uuid;
  chat continues under the new account (the app follows swaps — exactly what
  claude.ai cannot do).
- Unresolvable transcript path → diagnostic card with the attempted path;
  drawer still works.
- ccd/tmux failures → stderr as toast; destructive ops (stop/swap)
  confirm-before-fire, never auto-retried.

## Testing

- **Unit, fixture-driven:** JSONL parser on real transcript excerpts; dialog
  parser on captured pane text from the live box (permission prompt,
  AskUserQuestion, `/model` picker, trust/resume gates). Fixtures re-captured
  after CC version bumps — the known drift risk, made cheap to detect.
- **Integration on the box:** dedicated `cctest` session. Scripted e2e: send
  prompt → reply event streams; ask cctest's Claude to pose a multi-option
  question → dialog event → answer via API → selection lands; upload image →
  path appears in prompt; swap cctest → stream follows.
- **Manual mobile pass:** Android Chrome PWA — keyboard/viewport behavior,
  one-thumb reachability, background/foreground resync.

## Key risks

1. **Pane-parse drift across CC versions** — mitigated by fixtures, visible
   `unparsed` degradation, and the drawer.
2. **Transcript-format drift** — same mitigation shape; format has been stable
   in practice and the bridge already depends on it.
3. **Two drivers, one pane** (PWA + attached terminal/Discord intercept
   simultaneously) — serialized queue protects ccrc's own writes; cross-tool
   collisions remain possible exactly as they do today with the bridge, and
   are accepted.
