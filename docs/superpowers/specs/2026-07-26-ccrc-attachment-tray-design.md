# ccrc — composer attachment tray (stage-then-send screenshots)

**Status:** approved design, 2026-07-26. Supersedes the fire-and-forget attach
lane shipped in `01207ec` / Plan 2 Task 11. Revised after an adversarial review
pass (25 confirmed findings); the security and data-loss items below came out of
it and are load-bearing, not polish.

**Ordering:** implement this spec **before**
[structured questions](2026-07-26-ccrc-structured-ask-design.md). They are not
parallel-safe — see that spec's status note.

## The problem

Attaching a screenshot in the PWA is a side-channel poke at the remote terminal,
not a composer action. `POST /api/sessions/:id/upload` saves the file and then
runs `ccd clip`, which **types the saved path into the live tmux input box**
(`server/src/clip.ts:23`; `infra/ccrc-portability/ccd:600`, in `cmd_clip`,
which starts at `:586` — that file is the canonical copy, `~/.local/bin/ccd` is
the deployed one). The PWA keeps no state about it. Seven consequences, all
user-visible:

1. **The confirmation covers the input it points at.** `.toast-host` sits at
   `bottom: calc(var(--sp-6) + var(--safe-bottom))` (`primitives.css:262`) — the
   composer's own band. "Image attached to the prompt — add your text and send"
   lands on top of the placeholder.
2. **No preview.** No thumbnail, no name, no count. Two accidental attaches look
   exactly like one.
3. **No remove.** The path is already in the remote box; the PWA has nothing to
   undo.
4. **Sending trips a false alarm — the worst of the seven.** The typed path *is*
   a draft, so the next send fails `draft-present` (`inject/send.ts:99`) and the
   Composer opens a sheet titled *"There's already a draft in this session"*
   reading *"Someone left unsent text in the session's input box"* — your own
   screenshot, described as a stranger's leftover. **"Replace draft" fires `C-u`
   and silently destroys the attachment.** The only correct answer is "Append
   anyway", which is not what it sounds like.
5. **Paste reports nothing.** `Composer.tsx:52` builds `useAttachImage` and never
   renders its `busy`. Only `AttachButton` has a spinner, on its own instance. A
   phone photo is several seconds of silence.
6. **The sent turn shows a raw absolute path.** Not a scheme problem — user turns
   never go through markdown at all. The user branch renders
   `linkify(event.text)` (`MessageBubble.tsx:280`), and `linkify` (`:212`) makes
   bare URLs tappable but never produces an image. The markdown renderers that
   *can* show an image (`mdComponents`, `:160-206`) are reached only by assistant
   turns and by `CompactionCard` (`:252`), and the image branch there is gated on
   `isImageUrl` (`:30`, extension-based) inside the `a` renderer (`:162`). So the
   transcript reads
   `…is Poor /home/you/.cc-clips/claude2-OpenClawHetzner/clip-20260726-150340.png`.
7. **Two latent bugs in `ccd clip`.** Every destination is named `.png` regardless
   of the real type (`ccd:598`), so a downscaled JPEG lies about its format; and
   `clip-$(date +%Y%m%d-%H%M%S)` at one-second resolution `mv -f`s over a clip
   filed in the same second.

2–6 share one root cause: **attach commits to the remote input box before the
message exists.** Fixing the toast alone leaves 3, 4 and 6 standing.

## The design

Move the commit point. The PWA owns an attachment as a **staged** file with a
local preview until you press send; the path enters the session's input box once,
atomically, as part of the prompt.

```
today   pick/paste ─▶ upload ─▶ ccd clip types path into live box ─▶ toast
                                         │
                                         └─▶ next send sees a "draft" ─▶ scary sheet

new     pick/paste ─▶ chip (object URL, instant) ─▶ upload ─▶ chip "staged"
                                                                   │
        send ─▶ POST /prompt {text, attachments:[path]} ─▶ one injection ─▶ echo clears the tray
```

The remote input box is empty until send, so the draft-conflict sheet reverts to
meaning what it says: someone else typed in the terminal.

### Shared contract

`shared/api.ts` gains the composition rule, so the server that types the prompt
and the PWA that recognises its echo can never disagree. Note this turns a
pure-type module into one carrying runtime code.

```ts
export interface StagedClip { path: string; name: string; bytes: number }

/** Attachment paths first, each on its own line, then the user's text. */
export function composePrompt(text: string, attachments: readonly string[]): string

/**
 * Inverse, for rendering. Every clip-shaped path token is extracted wherever it
 * appears: on its own line (composePrompt's output), leading a line
 * (`<path> <text>`), or trailing/mid-line (`<text> <path>`). Paths come back in
 * document order, deduplicated; the prose has the removed tokens' surrounding
 * whitespace collapsed and is trimmed. Only tokens matching
 * `…/.cc-clips/<session>/clip-<stem>.<ext>` are extracted — any other path stays
 * prose.
 */
export function splitClipPaths(text: string): { paths: string[]; rest: string }
```

`StagedClip` carries **no dimensions** — the server has no image decoder
(`server/package.json` has no `sharp`/`image-size`) and `stageUpload` receives an
opaque `Buffer`. Dimensions are the PWA's, measured client-side (below).

**Trailing/mid-line extraction is the common case, not an edge case.** `ccd clip`
types the path with no Enter, so prose lands before *or* after it depending on
when the hotkey fires. The message that prompted this whole spec is, verbatim from
the transcript, `"…what's there now is Poor /home/…/clip-20260726-150340.png"` —
path last. A `splitClipPaths` that only handled leading paths would return that
entire string as `rest` and render no thumbnail. `ccd` also types a trailing space
(`ccd:600`), so the extractor must not leave a dangling or doubled space in `rest`.

Paths lead in `composePrompt` because that renders as image-above-caption, the
universal chat shape.

### Server

1. **`clip.ts`** — `saveUploadAndClip` becomes
   `stageUpload(io, cfg, id, data, ext): Promise<StagedClip>`: write to
   `<clipsDir>/<id>/clip-<YYYYmmdd-HHMMSS>-<rand8>.<ext>` and return it. No
   `ccd`, no typing, so no `Runner` dependency. The `clip-` prefix stays (existing
   globs keep working); the random suffix ends the same-second collision and the
   real extension ends the "everything is a .png" lie — problem 7, fixed in the
   lane the PWA uses.

   **The containment assertion lives here, at the write site, not only in the
   route.** `stageUpload` builds its path through a helper that asserts the id
   charset *and* that `path.resolve(clipsDir, id, name)` stays inside
   `path.resolve(clipsDir) + path.sep`, throwing otherwise. Same rule as
   `attachments` in item 3, but it protects every future caller of the shared
   function rather than one handler.

2. **`POST /api/sessions/:id/upload`** — returns `{ ok: true, clip: StagedClip }`.
   Keeps the extension allowlist; adds a 12 MB post-downscale cap → `413`.

   **This route is the one session write route with no `knownId` guard**
   (`server.ts:286-298`; contrast `:214`, `:225`, `:236`, `:242`). That is
   currently harmless because `id` is only ever argv to `ccd clip`, which dies at
   `_alive`. This redesign makes `id` **a path component of a write**, which turns
   the omission into a directory traversal:

   - Fastify percent-decodes the param, so `POST /api/sessions/..%2F..%2F.ssh/upload`
     yields `id === '../../.ssh'`.
   - In the default `fleetMode: 'local'` (`config.ts:46`) there is no whitelist at
     all — `localIO.writeFileB64` just does `mkdir -p` + `writeFile`
     (`io.ts:67-70`). The agent's write whitelist (`agent/src/whitelist.ts:79-81`)
     only applies in `remote` mode.
   - `multipart/form-data` is a CORS-*simple* request and the server has no
     origin or CSRF check, so any page open on the tailnet can reach it.

   So: **404 `unknown-session` via `knownId` (`server.ts:210`), and reject any id
   containing `/`, `\` or `..` → `400 bad-session-id`, both before any filesystem
   work.** The charset check is *not* redundant with `knownId`: `readRegistry`
   derives ids from `.uuid` filenames, so a file named `...uuid` yields the id `..`,
   which `knownId` would accept.

   One ordering detail: the id checks must precede `req.file()`, but replying
   before the multipart body is consumed can cost the client the JSON response —
   the route already knows this, hence `part.file.resume()` on its 415 path. Drain
   with `req.raw.resume()` before sending the 404/400.

3. **`POST /api/sessions/:id/prompt`** — accepts `attachments?: string[]`. Each
   must `path.resolve` **inside** `<clipsDir>/<id>` and match the clip filename
   shape; anything else is `400 bad-attachment`. Maximum four.

4. **`inject/send.ts`** — `sendPrompt(d, id, text, { replaceDraft, attachments })`
   injects `composePrompt(text, attachments)`. The echo check needs care, and the
   obvious change is wrong:

   - **Keep** `needle = first 24 chars of the composed prompt's first non-blank
     line` (with paths-first, that is the first attachment path). Do *not* switch
     to the path's tail: a logical line starts at column 2, so its first 24 chars
     cannot be split at any realistic width, and that is exactly the invariant
     `send.ts:120-121` documents. The tail is the part wrapping *does* split.
   - **Fix the comparison instead:** capture with `captureAnsi` and require
     `draftOf(pane).startsWith(needle)`. `draftOf` already returns the input box's
     `❯` row, trimmed and dim-stripped, and `submitted()` already trusts it for the
     harder half of this protocol. This is what answers the non-uniqueness worry —
     every clip path shares the prefix `/home/you/.cc-cli`, but the box was
     verified empty ~15 lines earlier, so that prefix *on the box row* can only be
     the path just typed. A whole-pane `includes` would instead match an identical
     path sitting in scrollback from an earlier turn and pass a send that never
     echoed.
   - Keep a whitespace-normalised whole-pane `includes` only as the fallback when
     no `❯` row can be read, so a very narrow pane or a scrolled multi-line box
     still cannot fail on a row break.
   - **On `verify-failed` with `attachments` injected, fire `C-u` before
     returning.** Otherwise a failed verify strands the paths in the live box —
     precisely the state this whole design exists to eliminate, and nothing clears
     it today.

5. **`GET /api/sessions/:id/clip/:name`** — serves the bytes for transcript
   thumbnails. Same `knownId` + id-charset gate as the upload route (safe:
   `ccd stop` leaves the registry entry, so a stopped session's thumbnails still
   resolve). `name` must match `^clip-[A-Za-z0-9._-]+\.(png|jpe?g|webp)$` (no
   slash, no `..`) or `400`. `content-type` from the extension;
   `cache-control: private, max-age=31536000, immutable` — names are unique, so
   the bytes never change.

6. **`FleetIO.readFileB64(path): Promise<string | null>`** — new op behind the fs
   facade, because the clip route must work in remote-fleet mode too. `localIO`
   reads and base64s; `remote/io.ts` calls a new `op: 'readB64'`;
   `agent-protocol.ts` gains `ReadB64Req`; `agent/src/server.ts` and `fileops.ts`
   gain the case. `.cc-clips/` is already read-whitelisted
   (`agent/src/whitelist.ts:86`), so no policy change. 12 MB cap agent-side.

7. **`ccd clip`** keeps typing the path — correct for the terminal hotkey. Its two
   bugs are fixed in place: preserve the source extension, add a `$RANDOM` suffix.
   To make that testable, **extract the destination into a `_clip_dest <dir> <src>`
   helper**: `cmd_clip` `die`s at `_alive "$id"` long before it computes `dest`, so
   the naming cannot be asserted by sourcing and calling `cmd_clip` the way
   `_swap_target` is tested.

### PWA

1. **`useAttachImage.ts` → `useStagedImages(id)`.** The canvas downscale,
   clipboard naming and clipboard sniffing are good and stay (`downscaleImage`,
   `namedClipboardImage`; `clipboardImage` becomes `clipboardImages` for
   multi-image paste). The hook now holds a list:

   ```ts
   interface StagedImage {
     key: string;
     file: File;                 // kept for retry
     previewUrl: string;         // object URL — the thumbnail is instant, no round trip
     state: 'uploading' | 'staged' | 'failed';
     path?: string;              // server path once staged
     width?: number; height?: number;   // set at add-time; present unless 'failed'
     error?: string;
   }
   // { images, add(files), remove(key), retry(key), clear(), uploading, hasFailed }
   ```

   **Dimensions are measured on both branches.** `useAttachImage.ts:88`
   short-circuits — `keepOriginal = file.type === 'image/png' && file.size < SMALL_PNG_MAX`
   — and on that branch `downscale` is never called, so no bitmap exists. That is
   exactly the small-lossless-PNG path this design is proudest of, so reusing only
   the existing decode leaves its caption blank. **The hook runs one
   `createImageBitmap` on the payload it is about to upload**, on both branches —
   rather than widening `downscaleImage`'s return type, which is exported and
   re-exported through `AttachButton.tsx:11` and would ripple through its callers
   and tests for no gain. Measure the **payload**, not the source file: the
   caption's job is to answer "did the downscale ruin my screenshot".

   `remove` and `clear` revoke object URLs.

2. **`AttachButton`** gains `multiple`, hands files to `add`, and drops its own
   state — the hook lives in `Composer` so the picker and paste share one tray.
   The `+` no longer spins; the chips carry progress.

3. **`AttachTray.tsx`** (new) — the chips. Renders nothing when empty.

4. **`Composer.tsx`** — owns the hook, renders the tray above `.inputbar`, passes
   `{ text, attachments }` to `onSend`. Send is enabled by text **or** at least one
   staged image (an image alone is a legitimate prompt). While any chip is
   uploading the send button wears the busy arc and the click **waits** for the
   uploads instead of dropping them. Drag-and-drop handlers on `.composer`; paste
   handles several images.

   **Send is refused while any chip is `failed`.** A failed chip has no `path`, so
   the alternatives are to silently send without it or to send a broken path —
   both lose the user's image without saying so. Refusing also keeps tray-clearing
   trivial: no send can ever carry a failed chip, so `clear()` on echo stays a
   plain list clear.

5. **`stores/session.ts`** — `send(text, opts?: { replaceDraft?, attachments? })`;
   `PendingSend` gains `attachments?: { path: string; previewUrl?: string }[]`;
   `clearConfirmed` matches the echo against `composePrompt(p.text, p.attachments)`
   — without this the optimistic bubble never matches and lingers its full 5 s
   grace beside the real one.

   **One rule governs attachment lifetime: a staged image's identity and its
   object URL live with the `PendingSend` from send until that pending is confirmed
   or explicitly abandoned, and every re-dispatch reuses that record in place.**
   Two concrete holes this closes, both of which orphan uploaded files and drop the
   user's images with no error:

   - **`retry` re-dispatches text only** (`session.ts:258-269`; `dispatch`'s
     signature at `:187`). Stage three images, send while Claude has a question
     open → `sendPrompt` returns `dialog-open` (`inject/send.ts:95`) → 409 → failed
     pending, tray now empty. Retry is the only way back, and it injects the text
     alone. Fix the *cause*: `retry` must flip state by spreading
     (`{ ...x, state: 'sending', error: undefined, draft: undefined }`) rather than
     re-listing fields as the literal at `:264` does — the literal is why the field
     vanishes, and spreading also protects every field added later. Then thread
     `attachments` through `dispatch` and `api.prompt`.
   - **The draft-conflict sheet discards and re-sends, carrying neither.**
     `DraftConflict` is `{key, text, draft}` (`Composer.tsx:32-36`) and
     `resolveConflict` does `onDiscard?.(conflict.key); onSend(text, true)`
     (`:129-134`). With a genuine foreign draft plus two staged images: 409 →
     "Append anyway" → `discard(key)` revokes both preview URLs, then the re-send
     posts with `attachments` undefined. Add
     `resolve(key, text, { replaceDraft })` to the store, mutating the existing
     pending in place — same key, same `attachments`, same `previewUrl`s — and have
     the sheet call that instead of discard-then-send.

6. **`ChatList.tsx`** — `PendingBubble` shows the staged thumbnails from the object
   URLs, so the chip → pending → confirmed hand-off never flickers empty.
   `ChatList` / `ChatListInner` take `id` and thread it to `MessageBubble`.

7. **`MessageBubble.tsx`** — the user branch runs `splitClipPaths`, renders each
   path as `<img src={clipUrl(id, name)}>` above the prose, and keeps the rest of
   the text in the bubble. `onError` degrades to a mono filename chip (a clip
   deleted off disk must not leave a broken-image box). Assistant rendering is
   untouched.

### Visual design — Phosphor & Ink

- **Tray:** a row inside the composer's padding, above the input bar, `--sp-2`
  gap and `--sp-2` below. More than two chips scroll horizontally
  (`overflow-x: auto` + scroll snap); the page never scrolls sideways.
- **Chip:** 72×72, radius `--r-md`, 1px `--edge-subtle`, `object-fit: cover`, on
  `--bg-well` — a transparent PNG then reads as a well, the same material as code
  blocks and the terminal drawer.
- **Caption:** a bottom scrim strip (`linear-gradient(transparent, rgba(4,6,5,.72))`)
  carrying `W×H` in mono 11px tabular-nums — the machine's voice, and the one fact
  that answers "did the downscale ruin my screenshot". Byte count is dropped as
  noise (a refinement on the approved mockup, which carried `2788×442 · 240 KB`).
- **Uploading:** thumbnail at 0.55 opacity behind the existing `attach-spin`
  phosphor arc at `--caret-period`, strip reads `uploading…`. Under
  `prefers-reduced-motion` the arc holds at mid-intensity — the codebase's
  established freeze, never a zeroed loop period.
- **Failed:** border → `--status-dead`, strip reads `failed`, the chip itself is
  the Retry target, `×` still removes.
- **Remove:** a 20px `×` at the chip's top-right on a `--bg-sheet` disc with a
  hairline, mono glyph, hit area padded to 44px the way `.toast-action` already
  does it. `aria-label="Remove <name>"`.
- **Drop target** (`@media (hover: hover)`): dragging over the composer draws a
  1px dashed `--accent` inset ring on `--accent-tint` with a centred mono 11px
  `drop to attach`, fading in over `--dur-fast`. Nothing else moves.
- **Send button:** `aria-busy` plus the same arc while uploads are in flight.
- **Transcript thumbnails:** `max-height: 220px`, `max-width: 100%`, radius
  `--r-md`, right-aligned with the user bubble; several images in a two-column
  grid at `--sp-1`.

  **Tap must origin-absolutise the href.** `openExternal` runs it through
  `absolute()` (`MessageBubble.tsx:34-38`), which matches neither `^https?://` nor
  `^[a-z][\w+.-]*:` for a root-relative path and so returns `https:///api/…` — an
  empty-host URL, i.e. a broken tap. **`clipUrl(id, name)` is therefore defined in
  `lib/api.ts` and returns an origin-qualified URL** (`new URL(path, location.origin).href`),
  rather than patching the call site or `absolute()`: one definition serves both
  `MessageBubble` and `PendingBubble`, and it sidesteps `openExternal` being
  module-private — which otherwise blocks `PendingBubble` from reusing it at all.
  (`/api/` is in `navigateFallbackDenylist`, so the SPA shell does not hijack it.)

Nothing here emits light: glow stays reserved for living states. New token
pairings run through `design/contrast-check.mjs`.

### Errors

| Case | Surface |
|---|---|
| Unsupported type (pick or paste) | toast, `error`; no chip |
| Fifth image | toast `Four images per message — send these first` |
| Upload failed | chip `failed`, tap to retry; **send refused while present** |
| Over 12 MB after downscale | chip `failed`, strip reads `too large` |
| `bad-attachment` / `bad-session-id` on send | the existing pending-bubble error path |
| Thumbnail 404 | mono filename chip, no toast |

The success toast is deleted outright — the chip is the confirmation, and it
doesn't sit on the input box.

`.toast-host` still needs to clear the composer for the toasts that remain, and
the obvious wiring silently does nothing: **`ToastHost` mounts outside the session
subtree** (`app.tsx:63`, a sibling of `.app-shell` opened at `:36`), while `.chat`
is `SessionScreen`'s root (`SessionScreen.tsx:141`) nested at
`.app-shell > .shell-detail > .chat`. Custom properties inherit downward only, so
a `--composer-h` set on `.chat` can never reach `.toast-host`. Instead:

- a `ResizeObserver` in `SessionScreen` publishes `--composer-h` on
  `document.documentElement`, and removes it on unmount so the fleet screen and
  the desktop placeholder pane are unaffected. Only one `SessionScreen` is mounted
  at a time (`app.tsx:52` keys it per session), so one global is sufficient —
  clear on unmount, re-measure on mount.
- `tokens.css` declares `--composer-h: 0px` under `:root` beside `--safe-bottom`.
  This is not cosmetic: an unset `var()` inside `calc()` invalidates the whole
  declaration at computed-value time, so without the default the fleet screen
  loses the toast's baseline offset entirely. Write the consumer defensively too:
  `bottom: calc(var(--sp-6) + var(--safe-bottom) + var(--composer-h, 0px))`.

## Testing

- `pwa/test/attach.test.tsx` (rewritten) — chip on pick with a thumbnail; remove;
  retry re-uploads; four-image cap; unsupported type toasts; `send` carries
  `attachments`; a send during upload waits rather than dropping; **a send is
  refused while a chip is `failed`**; **the `W×H` caption is present on the
  small-PNG passthrough path** (the branch the obvious implementation misses).
- `pwa/test/paste.test.tsx` — multi-image paste; text paste still untouched.
- `pwa/test/chat.test.tsx` — pending bubble thumbnails; `MessageBubble` splits
  clip paths and emits the right `src`; a non-clip path stays prose; `onError`
  degrades to the filename chip.
- `pwa/test/stores.test.ts` — extend the existing
  `describe('session store optimistic send')` (`:200-272`); do **not** create a
  new store suite. It already contains the test this change breaks ("send() pushes
  a sending pending and clears it on echo"). Add: the echo match against
  `composePrompt`; `retry` preserves `attachments`; `resolve` preserves them
  across a draft conflict; object URLs are revoked on confirm and on discard.
- `pwa/test/compose.test.ts` (new) — `composePrompt` / `splitClipPaths` for all
  three path positions, using the verbatim transcript message for the trailing
  case (`"…what's there now is Poor /home/…/clip-20260726-150340.png"` → one path,
  prose without it), plus the round-trip, duplicate paths rendering once, and a
  non-clip absolute path staying prose.
- `server/test/clip.test.ts` — `stageUpload` naming, extension fidelity,
  same-second uniqueness, no `ccd` invocation, and the containment assertion
  throwing on a traversing id.
- `server/test/routes.test.ts` — upload returns `clip`; prompt rejects traversal,
  a foreign session's dir, and a fifth attachment; clip GET serves bytes.
  Traversal cases by name: a `..%2F..%2F`-encoded id, a `%2F`-prefixed
  absolute-looking id, `..` as the whole id (reachable via a `...uuid` registry
  file, which is why the charset check is not redundant with `knownId`), and an
  unknown-but-well-formed id.
- `server/test/send.test.ts` — injection order; a 40-column capture with the path
  wrapped mid-stem still verifies `ok`; **the identical path present only in
  scrollback with the box empty gives `verify-failed`** (the case a whole-pane
  `includes` would wrongly pass); needle taken from the first path line when text
  is also present; `C-u` fires on `verify-failed` with attachments.
- `server/test/io.test.ts`, `server/test/remote-io.test.ts`,
  `agent/test/fileops.test.ts` — `readFileB64` / `readB64`, including the cap and
  a forbidden path.
- `ccd` — assert `_clip_dest` preserves the source extension and returns distinct
  names for two calls in the same second.

## Risk and migration

- The upload route's response shape changes and its type-immediately behaviour is
  gone. Server and PWA ship from the same repo in one deploy, so there is no
  mixed-version window to design for.
- `ccd clip` from the Mac hotkey is unaffected and still types the path;
  `splitClipPaths` extracts it from any position, so those messages get thumbnails
  too.
- Removing a chip leaves its staged file on disk. Accepted: `~/.cc-clips/<id>/`
  is already an append-only scratch directory. No delete route (YAGNI).
- Line numbers in this spec are anchors, not contracts — `ccd` in particular
  churns. Citations name the enclosing function where one exists.
