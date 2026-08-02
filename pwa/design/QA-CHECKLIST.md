# ccrc-pwa — Polish gate (Task 14)

Binding pass against the spec's three acceptance sections
(`docs/superpowers/specs/2026-07-20-ccrc-remote-control-app-design.md`),
walked 2026-07-21 against a fixture-backed live stack: real ccrc-server
(`CCRC_HOME` → fixture tree, real tmux sessions + livestate + transcripts,
node-pty attached) proxied by the Vite dev server, driven in Chromium via
Playwright.

**Evidence conditions per item:** 390×844 and 1280×900 viewports; dark and
light (`prefers-color-scheme` emulation both ways); `prefers-reduced-motion`
on and off. Screenshot set from this pass lives in the session scratchpad
(`qa-shots/01…09`, presented for the user gate); numbers referenced below.

**Verdict legend:** PASS · PASS (fixed) — failed the initial walk, fixed in
this task, re-verified live · NOTE — passes with a recorded caveat.

---

## Native-like bar (spec: acceptance criteria, not aspirations)

The spec section carries six concrete bullets plus its framing bar
("indistinguishable from a native chat app in feel") — recorded here as item 7.
(The plan says "7 items"; the spec text has 6 bullets — the framing sentence is
counted to keep the tally honest.)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | **Standalone install** — `display: standalone`, maskable icons, theme-color, splash | PASS | `vite.config.ts` manifest (standalone, `background_color`/`theme_color` = `--bg-page`, 2× any + 2× maskable icons); `index.html` theme-color metas now cover **both** themes (dark + light `media` variant); apple-touch + status-bar metas present. Build emits `manifest.webmanifest` + `sw.js` into `server/dist-pwa` (verified this pass); Lighthouse installable pass recorded in Task 13. |
| 2 | **Instant cold start** — SW precache; last-known fleet renders, clearly stale-marked, no white flash | PASS (fixed) | Precache: 15 entries (build output). `lib/offline.ts` snapshot + fleet-store hydration verified live: server killed → reload → 4 stale-marked cards under "Reconnecting…" (shot 09). **Fixed this task:** `index.html` now paints `--bg-page` (both themes) via a pre-bundle inline style + pre-paint theme stamp — no white flash before CSS loads. |
| 3 | **Scroll feel** — virtualized chat at 60fps, `overscroll-behavior` containment, native momentum | PASS | react-virtuoso drives the list (verified `[data-virtuoso-scroller]` live); `overscroll-behavior: contain` computed on `.chat-scroller` (checked live), also set on wells, sheets, project list, quick-key bar; `overscroll-behavior: none` on body. 8k-row transcript scrolls without jank in the fixture (manual). |
| 4 | **Keyboard discipline** — visual-viewport input bar, ≥16px inputs, focus never scrolls the chat away | PASS | `lib/keyboard.ts` (visualViewport inset + iOS top-pin, consolidated this task from the two private hooks); composer + project search computed `font-size: 16px` live (`--text-input`); keyboard inset pads the shell so the list shrinks in place (jsdom tests in `header.test.tsx`). |
| 5 | **Touch discipline** — ≥44px targets, safe-area insets, spring sheets, swipe-dismiss | PASS | All interactive chrome ≥ `--tap-min` 44px (cards are one stretched target; option/account rows 52px; keycaps/send/attach/back/toast-action 44px — audited per rule). Safe-area tokens padded on header, composer, sheets, fab, toast. Vaul sheets spring per `--ease-spring`/`--dur-sheet`, swipe- and scrim-dismissible (dialog/terminal/menus verified live). |
| 6 | **Optimistic send** — instant pending tick → confirmed → visible failure, never a frozen input | PASS | Store lifecycle `sending → confirmed-by-echo / failed` with Retry/Discard (`stores.test.ts`, `chat.test.tsx`); receipts `◌ sending / ✓ / ! not sent` rendered in the transcript (shot 02 shows delivered ticks); input clears immediately on send. |
| 7 | **Overall native feel** (framing bar) | PASS | Judged over the full screenshot set — user gate below decides. |

## Design ambition (5 items)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | **Dedicated design phase** before the first screen | PASS | `design/DIRECTION.md` ("Phosphor & Ink", user-endorsed), `tokens.css` (contrast machine-verified — re-ran `node design/contrast-check.mjs` this pass: all pass; the gate now parses tokens.css and every stylesheet under `src/` rather than checking a hand-written pair list), `design/mockup.html`. Every component file cites its DIRECTION treatment. |
| 2 | **Motion as a design layer** — progressive streaming, breathing busy states, card→chat shared element, springing sheets, RM budget | PASS (fixed) | Breathing glow/dots/skeleton verified live (and frozen at mid-intensity under RM — computed `animation: none; opacity: 0.8`, durations 1ms). **Fixed this task:** card→chat navigation was an instant swap — `lib/router.ts` now wraps route changes in the View Transitions API with the tapped card title morphing into the chat header (`view-transition-name: session-title`), timed by `--dur-slow`/`--ease-swift`, skipped under RM and on engines without the API. Verified live both directions. NOTE: streamed text appears per transcript event behind the blinking block caret (verified live); there is no per-chunk fade — event-granularity is the JSONL tail's native rhythm and the caret carries the affordance. |
| 3 | **Micro-interaction inventory** — designed pressed/disabled/loading everywhere; sends tick; bars/dots animate | PASS (fixed) | Was incomplete: `btn-primary`/`btn-ghost` had **no disabled treatment** (the armed-green "Choose a project" read tappable — shot from initial walk), and card / back-chevron / notice-dismiss / toast-action / sheet-cancel rows had no pressed state. All fixed: disabled buttons stand down to `--ink-disabled`, every interactive element now has a 120ms press response (card compresses via `:has`), RM disables all of it. Limit fills glide (`--dur-bar`), lamp pops + one-shot ping on state change (pre-existing, verified). |
| 4 | **Every state designed** — loading, empty, error, offline, dead | PASS (fixed) | Fleet: skeletons / first-run block / notices / offline banner / dead card (shots 01, 09). Chat: skeletons, empty state, offline + missing-transcript banners, terminal attach/lost overlays. **Fixed this task:** the dead-session chat state was unreachable in practice — the stream only sends status on *change*, so `dead`/`busy` stayed null until then; `SessionScreen` now falls back to the fleet snapshot (read-only banner + disabled composer + caret verified live on the fixture's dead session). |
| 5 | **Quality gate** — wouldn't look out of place next to the best native chat apps | user gate | Screenshot set presented; this task's step 3 approval decides. |

## Usability principles (4 items)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | **Zero learning curve** — jargon-free, machinery invisible | PASS (fixed) | All account/wrapper naming flows through `lib/accounts.ts` (`team·max`…); "Move to another account" everywhere. **Fixed this task:** terminal drawer eyebrow leaked `tmux · <id>` → now `terminal · <id>`; attach input dropped the `capture` attribute that forced the camera and made gallery screenshots (the main lane) unreachable on Android. `/model` remains as a deliberate mono hint beside the plain "Change model" label (machine-voice by DIRECTION). |
| 2 | **Two taps to anything** | PASS | Fleet→session = 1 tap; dialog answer = card tap → sheet is already up (badge + auto-spring verified live); terminal, interrupt = 2 taps; new session = FAB → account → project (typing only for search/messages). |
| 3 | **Forgiving by default** — destructive confirms with consequence, verified/retryable sends, ensure-recoverable | PASS | Stop/move QuickConfirms carry consequence sentences (`lifecycle-ui.test.tsx`); failed sends keep Retry/Discard; dead recovery is one tap (banner + card + hold-to-restart); esc interrupt is deliberately confirm-free with a quiet 409 toast. |
| 4 | **Self-explanatory states** — every card/banner says what's happening and what to do next | PASS (fixed) | Status words travel with every dot ("waiting on you · 12m", "exited · just now", "Not running — tap to view, hold to restart", "Claude is asking you something — tap to answer" — shot 01). **Fixed this task:** DIRECTION's critical-limit narration was missing — cards now forecast "5h/7d limit near — will move to another account" when a window crosses 75% (routing-policy bands). |

---

## Fixes applied in this pass

1. **Light theme was unreachable** — tokens defined `[data-theme='light']` but nothing ever stamped it. `lib/theme.ts` (+ pre-paint `index.html` stamp) follows `prefers-color-scheme`, live changes included, and keeps the `theme-color` meta on `--bg-page`. Verified live both directions (shots 07, 08).
2. **Session status fallback** (`SessionScreen`) — dead/busy now fall back to the fleet snapshot until the stream's first status frame (read-only banner, disabled composer, streaming caret).
3. **Card→chat shared-element transition** (`lib/router.ts`, `SessionCard`, `chat.css`, `base.css`) — View Transitions API, RM-guarded.
4. **Disabled button treatment** (`primitives.css`) — `btn-primary`/`btn-ghost` visibly stand down.
5. **Pressed-state completion** (fleet/chat/primitives css) — card, back chevron, notice ×, toast action, sheet cancels, account-change; all RM-guarded.
6. **Critical-limit narration** (`SessionCard` + `fleet.css`) — mono forecast line per DIRECTION.
7. **Jargon leaks** — drawer eyebrow `tmux · id` → `terminal · id`; attach `capture` attribute removed (gallery access restored).
8. **Hook consolidation** flagged for Task 14 in code — `lib/useNow.ts`, `lib/keyboard.ts` replace three private copies.

New tests: `test/polish.test.tsx` (11) — theme stamping/following, view-transition wrapping + fallback, status fallback (dead banner + composer, stream-wins), limit narration (5h / 7d / quiet cases), capture-free attach input. Suite: **126 passed**, `npm run build` clean (tsc strict + vite → `server/dist-pwa`).

## Recorded caveats (out of this task's write scope)

- **Server** (`infra/ccrc/server`, Plan-1 surface): the initial `/ws/fleet` snapshot is assembled without the watcher's pending-dialog set, and `/ws/session/:id` never sends an initial `status` frame — the app now compensates client-side (status fallback), but a cold connect can show a card without its "waiting on you" badge until the next fleet change. Worth a two-line server fix in Plan 3.
- Streaming is event-granular (no per-chunk fade) — see Design ambition #2.
- `npm rebuild node-pty` on the dev Mac needed `npm approve-scripts node-pty` (local allow-scripts policy) **and** `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` (npm drops the exec bit) before `/ws/pty` worked locally — box deploys unaffected (Plan 1 verified there).
