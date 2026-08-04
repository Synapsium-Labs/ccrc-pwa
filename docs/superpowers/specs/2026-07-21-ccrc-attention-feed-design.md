# ccrc Attention Feed — cross-project central chat

**Date:** 2026-07-21
**Status:** Approved design, pending implementation plan (Plan 4 — executes after the PWA build and box deploy land)
**Parent spec:** `2026-07-20-ccrc-remote-control-app-design.md` — all of its Design ambition, Usability principles, and Native-like bar criteria bind here too.

## Why

With 6+ sessions across 4 accounts, the fleet screen answers "what's running?" but the daily question is "what needs *me*?" Today that means tab-switching through sessions. The Attention Feed is a single chat-like stream that surfaces every decision point across all projects and lets the user act inline — answer a dialog, send the next instruction, revive a dead session — without leaving the feed. It complements, never replaces, the per-session screens (every card deep-links).

## Decisions taken during brainstorm

- **Scope: decisions + completions.** Blocking items (dialogs, unparsed menus, dead sessions, limit trouble) plus every "turn finished" with a preview of Claude's conclusion — because "agent finished, what next?" is itself a decision. Mid-turn activity stays out.
- **Placement: the feed is home.** Opening the app lands on the feed; bottom tab bar `Feed | Fleet`; session screens deep-link from both.
- **Lifecycle: self-clearing + synced dismiss.** Items clear when the world moves on; explicit dismissals are stored server-side so all devices agree.
- **Architecture: server-side aggregator** (over client-side aggregation and event-log approaches) — smallest diff on the existing detection machinery, phone-friendly (one socket), cross-device by construction.
- **Scope cut:** no broadcast-to-all-sessions composer in v1; replies are always contextual to a card's session.

## Item model (`shared/api.ts`)

```ts
export interface AttentionItem {
  id: string;            // stable derivation key — see per-kind rules
  sessionId: string;
  project: string; wrapper: string; name: string | null;   // denormalized for card headers
  kind: 'dialog' | 'unparsed_menu' | 'turn_complete' | 'dead' | 'limit' | 'notice';
  ts: number;            // epoch ms, when the condition arose
  dismissible: boolean;  // true only for turn_complete / notice / limit
  payload:
    | { dialog: Dialog }                   // dialog, unparsed_menu
    | { preview: string; truncated: boolean }  // turn_complete (final assistant text, ~600 chars)
    | { message: string };                 // dead, limit, notice
}
```

## Derivation (AttentionWatcher in ccrc-server)

Rides the existing 2 s watcher tick + bus; holds items in memory; recomputes incrementally.

- **dialog / unparsed_menu** — mirror of the pane watcher's dialog state. `id = dialog:<sessionId>:<dialogId>`. Clears when the pane watcher reports `dialog_cleared` (answered from anywhere: feed, session screen, terminal, another device).
- **turn_complete** — on a busy→idle transition, one-shot read of the session's transcript tail (existing resolve + parse); preview = last assistant text event. `id = done:<sessionId>:<lastEventUuid>`. Clears when the session goes busy again or a newer completion supersedes it. Suppressed while that session has an active dialog item (the dialog is the real ask).
- **dead** — registry entry with no tmux session. `id = dead:<sessionId>` (not dismissible, so no uniqueness-over-time needed). Clears on revival; reappears if the session dies again.
- **limit** — account limit score ≥ the ceiling (reuse ccd's max(5h,7d) ≥ 98 semantics) affecting a session's current wrapper. Clears when the score drops.
- **notice** — from `POST /api/notify` (swaps etc.). Only ephemeral kind: auto-expires 24 h after `ts`.
- **Dismissals** — `~/.ccrc/attention-dismissed.json` (`{ [itemId]: epochMs }`, atomic tmp+rename write like the limits file). Dismissed ids are filtered at derivation; ids that no longer derive are pruned on write. Corrupt/missing file ⇒ empty (worst case dismissed items reappear — nothing lost). Non-dismissible kinds reject dismissal.

## API

- `GET /api/attention` → `{ items: AttentionItem[] }` (initial paint)
- `POST /api/attention/:id/dismiss` → 200 / 409 (non-dismissible) / 404
- `GET /ws/attention` → pushes `{ type: 'attention', items }` (full small array) on every change
- Inline actions reuse existing endpoints unchanged: `POST /api/sessions/:id/dialog`, `/prompt`, `/ensure`, `/swap` — already queue-serialized, already verified.

## Feed screen (PWA)

- New home screen; bottom tab bar `Feed | Fleet` (badge = item count on Feed).
- Chronological stream, newest first. Card anatomy: project + account chip + relative time, then kind-specific body:
  - **dialog** — question + the same tappable option rows as the session dialog sheet (shared component), answered in place with identical optimistic/stale-409 handling; unparsed → raw block + "Open terminal".
  - **turn_complete** — markdown-rendered preview; inline reply box expanding on focus (send → that session's `/prompt`); "Open session →".
  - **dead** — "Session isn't running" + one-tap Restart (`ensure`).
  - **limit** — plain-language state + "Move to another account" (opens the existing SwapSheet).
  - **notice** — informational, dismissible.
- Swipe-left dismisses (dismissible kinds only). Blocking items are visually distinct (attention accent from tokens).
- Empty state is a feature: "All quiet — N sessions working" with mini status dots.
- All parent-spec bars apply: tokens-only styling, 44 px targets, offline banner with dimmed last-known items, reduced-motion, jargon-free copy.

## Error handling

Same degrade-to-raw policy as the parent spec: stale dialog answers → 409 → card refreshes from the stream; unreadable transcript at completion time → item ships with "finished (preview unavailable)"; feed socket down → last-known items dimmed + reconnecting banner; state-file corruption → treated as empty.

## Testing

- **Unit (fixture-driven):** derivation rules — busy→idle yields a turn_complete with correct preview; re-busy clears it; newer completion supersedes; dialog item lifecycle mirrors pane watcher; dismiss filters + prunes; suppression of completion-under-dialog; limit threshold edges.
- **Component:** feed cards per kind incl. inline answer/reply flows and swipe-dismiss.
- **E2E (extends Plan 3 suite):** drive cctest to ask a question → item appears on `/ws/attention` → answer via feed API → self-clears; finish a turn → completion item carries the reply; dismiss syncs across two concurrent clients.
