# Desktop polish wave 172: attach any type of file

The operator's goal of 2026-11-24: the session composer attaches any file, not only pictures and the text and PDF
list, uploaded unchanged, with its path given to the session. 12 MB per file is enough (operator, 2026-11-24). Each
claim below is labelled **measured** (a command was run and its result seen), **sourced** (read from the code) or
**inferred**.

## What changed

- **Sourced.** `shared/api.ts`, the clip block. The extension list stops being a gate. The gate is now the
  extension's SHAPE: the file's own extension after its last dot, ASCII letters and digits, 1 to `CLIP_EXT_MAX` (12)
  characters, stored lower-cased. `CLIP_EXT_ALT` is that shape as a pattern fragment (`[a-z0-9]{1,12}`); it keeps its
  old name because the upload gate in `server/src/server.ts` imports it under that name. `clipExtOf` is the one reader
  of a name's extension, and `hasClipExt` and `isImageClip` derive from it. `CLIP_DOC_EXTS` and `CLIP_EXTS` are gone:
  nothing reads a document list any more. `CLIP_IMAGE_EXTS` stays, and still decides thumbnail or chip and whether the
  composer may downscale. `CLIP_MAX_BYTES` (12 MiB) and `CLIP_MAX_PER_MESSAGE` (4) are new, for the composer.
  `CLIP_PATH_RE` gains a closing look-ahead, so a longer run of letters is not read as a path with half an extension.
- **Sourced.** `server/src/clip.ts`. `CLIP_NAME_RE` is unchanged text and derives from the new shape, so the stored
  name rule, the path pattern and the upload gate all follow one definition. `CLIP_MIME` keeps exactly its fourteen
  entries and becomes a frozen null-prototype table (below, "What an uploader can do").
- **Sourced.** `pwa/src/session/useAttachImage.ts`. `ATTACH_ACCEPT` is `undefined`, so the picker's input has no
  `accept` attribute. `isAttachable` admits every file. `namedUpload` keeps any name with a usable extension, names a
  nameless clipboard picture `pasted-<ms>.<png|jpg|webp>` as before, and gives any other name with no usable extension
  `.noext` (`NEUTRAL_EXT`). `add()` refuses a non-picture over 12 MB before any request, with a toast saying the name,
  the size and the limit (`tooLargeText`); a picture is measured after its downscale, and one still over the limit fails
  its chip with the same sentence and is never sent. The "images, text, PDF and RTF only" refusal is gone.
- **Sourced.** `pwa/src/lib/refusalWords.ts`: the server's `unsupported-type` now reads "Can't attach that — its name
  has no extension the server can store." The composer never causes it (it adds `.noext`); another client can.
- **Sourced.** `ui/src/components/attach-tray.tsx`: one comment, which named the retired document list. The badge code
  is unchanged; a long extension is clipped by the badge's existing `overflow: hidden`, and the strip below shows the
  full name.

## Co-edit by ruling

`shared/api.ts` was claimed by the chat-paging worker (claim 6852, run 3609) when this wave began, so the claim for it
could not be taken. I sent the holder the clip block's unified diff against `main` 01dce5c853 before touching the file
(mail 33733), and asked the coordinator (mail 33758). The coordinator ruled on 2026-11-24 (mail 33763), both runs being
its own: edit only the clip block, from `StagedClip` to `CLIP_PATH_RE`, with no line outside it, no reformatting, no
import reordering and no moved declarations; show that nothing reads the two removed list exports; the holder's
objection, if any arrives before the push, wins inside its own block; whichever pull request lands second absorbs
`main` once by its own merge probe. The edit is exactly the packet. **Measured** (`git grep` on `origin/main` at
01dce5c853): `CLIP_DOC_EXTS` and `CLIP_EXTS` were read only by `pwa/src/session/useAttachImage.ts`, `server/test/clip.test.ts`,
`pwa/test/attach.test.tsx` and `pwa/test/compose.test.ts`, all converted here, and named in comments in
`server/src/clip.ts`, `ui/src/components/attach-tray.tsx` (both rewritten) and `server/src/server.ts` (a comment only, left
for the follow-up). None of the holder's fifteen claimed paths reads either.

Not changed, as the brief asked: `server/src/server.ts` (held by another programme) and `pwa/src/session/Composer.tsx`
(held by the paste-chips worker). The change reaches both through the shared definition and `useAttachImage.ts`. No
conversion, no new route, credential or agent verb, no change to where files are stored, and no change to the text
paste path or to `composePrompt`.

## Choices left to me

| Choice | Ruling | Why |
|---|---|---|
| Extension length | 1 to 12 | Holds every common extension (`webmanifest` is 11, `parquet` 7); a longer tail is treated as no extension. |
| Character set | ASCII letters and digits | The brief's rule. Tested on the raw name BEFORE lower-casing: `toLowerCase` folds the Kelvin sign to `k`, which the server's case-insensitive gate does not admit, so testing after would stage a chip the server refuses. |
| Neutral extension | `noext` | It claims no format, as `.bin` or `.txt` would, and tells the reader on the far end what happened: `README` arrives as `clip-…-README.noext`. The chip shows that name too. |
| Picker filter | none | An `accept` with no value is what makes iOS offer the photo library, the camera and Files in one sheet. |
| Where the size refusal happens | in the composer, for a non-picture before upload; for a picture after its downscale | A non-picture's size now is its size at the server; a picture's downscale may bring it under. |
| Limit constants | `CLIP_MAX_BYTES` and `CLIP_MAX_PER_MESSAGE` in `shared/api.ts` | The composer needs them to say the limit. The server's own `MAX_UPLOAD_BYTES` and `MAX_ATTACHMENTS` in `server.ts` are a second copy I could not remove (the file is held); `clip-any-file.test.ts` pins the route's behaviour to the shared values (12 MiB accepted, one byte more refused, a fifth file refused). Follow-up below. |

## The limits

- **Sourced, measured by test.** 12 MiB per file (`CLIP_MAX_BYTES`), enforced by the upload route's own check
  (`413 too-large`), and by the composer before upload. The multipart plugin's 25 MiB limit is the outer bound behind it.
- **Sourced, measured by test.** Four files per message, enforced by the prompt route (`400 bad-attachment` on a fifth)
  and by the tray ("Four attachments per message — send these first").
- No streamed transfer: a file is buffered whole, as before.

## What an uploader can and cannot make the console or the fleet box do

The upload route takes untrusted names and bytes. Since this wave an uploader holding a session (the auth gate is
unchanged) can:

- store any bytes, up to 12 MiB a file, under `~/.cc-clips/<session>/` on the box that runs the session (server box in
  local mode, fleet box through the agent's `writeB64` in remote mode);
- choose the stored name's extension (1 to 12 lower-case letters and digits) and up to 40 characters of stem from
  `[A-Za-z0-9._-]`, never opening with a dot or a dash (`clipStem`, unchanged);
- have the path of that file typed into the session's input box at send, as today.

They cannot:

- **leave the session's folder or choose it.** `clipStem` keeps only `[A-Za-z0-9._-]` and strips leading dots and
  dashes; `clipPath` asserts the name rule and that the resolved path lies inside the clips directory. Pinned with
  traversal, separator, NUL, newline, shell-metacharacter and 400-character names.
- **put anything but the stored path into the prompt.** The stored path holds no whitespace, quote, `$`, backtick,
  `;`, `&`, `|`, `<`, `>` or parenthesis, and `splitClipPaths` finds it whole. Pinned.
- **make anything executable.** Both writers (`localIO.writeFileB64` and the agent's `writeB64`) create the file with
  Node's default mode 0o666 under the umask, which has no execute bit whatever the umask; every name is fresh (a 32-bit
  suffix), so no existing mode is inherited. Pinned for `.sh`, `.exe` and `.py` on both sides. Nothing in ccrc opens or
  runs a clip; the session is only told its path.
- **make the console render it.** The clip route serves inline only the fourteen types in `CLIP_MIME`, none of them
  script-capable; every other extension is served as `application/octet-stream` with `nosniff`, which no browser
  renders. Pinned for `.html`, `.htm`, `.xhtml`, `.svg`, `.js`, `.mjs` and `.xml`: each comes back as an opaque
  download with its bytes intact.
- **reach `Object.prototype` through the type table.** Admitting any extension made `constructor` a storable one, and
  on a plain object literal `CLIP_MIME['constructor']` is `Object` itself, which the route would have handed to the
  reply as its type. `CLIP_MIME` is now a frozen table with no prototype. Pinned by serving `x.constructor`.

What is still true and not new: a session that is told the path may do whatever it chooses with the file, as it may
with any file it can read. That is the session's sandbox, not the clip store's.

## The clean-up's listing

**Sourced.** The workspace clean-up does not filter by extension. `_ws_clip_manifest` (`ccd/ccd`) lists every entry of
`~/.cc-clips/<id>` with `find "$dir" -mindepth 1 -maxdepth 1 -print0`, and the reap, reclaim and expire paths remove the
whole directory (`rm -rf` on it, through `_ws_leaf_remove`). A `.zip` or `.noext` is listed and removed like a `.png`.

## What derived from the old list, and where it went

| Reader | Now |
|---|---|
| Upload gate (`server.ts` `UPLOAD_EXT_RE`, built from `CLIP_EXT_ALT`) | follows the shape, unchanged code; its comment still says "built ONCE from `CLIP_EXTS`" (follow-up) |
| Stored-name rule (`CLIP_NAME_RE`) | follows the shape |
| Path pattern (`CLIP_PATH_RE`) | follows the shape, plus the closing look-ahead |
| Clip route's type (`CLIP_MIME[ext] ?? octet-stream`) | still an allow-list; null prototype |
| Picker `accept` (`ATTACH_ACCEPT`) | none |
| Paste and drop (`isAttachable`) | every file |
| Thumbnail or chip (`isImageClip`, tray, `MessageBubble`, `PendingBubble`) | unchanged: the four pictures |
| Downscale (`useStagedImages`) | unchanged: pictures only |
| The tray badge comment | rewritten |
| Single-definition scans (`server/test/single-definition/`) | none names a clip list (grep for `CLIP` there finds nothing), so none needed converting |
| `ccd clip` (the operator's command-line clip verb) | not this lane; not changed |

## Tests

- `server/test/clip-any-file.test.ts` (new): an archive, office documents, source, audio, a script, a program and a GIF
  stored byte for byte; a double extension; upper case; exactly 12 characters; no extension, over-long, symbol-bearing,
  only dots and non-ASCII refused by the gate; the `.noext` names stored; 12 MiB stored and one byte more refused; a
  fifth file refused; hostile names; the prompt; the execute bit; the serve cases; the table's prototype.
- `agent/test/clip-write-mode.test.ts` (new): the fleet box's writer, no execute bit, bytes intact.
- `pwa/test/attach-any-file.test.tsx` (new): the shape from the one definition, `namedUpload`, the three doors each
  staging a non-picture as a chip, the picker's missing filter, the size refusal before a request, exactly 12 MiB
  staged, the fifth file, a picture that still downscales and one still over the limit after it.
- Converted: `server/test/clip.test.ts`, `server/test/routes.test.ts`, `pwa/test/compose.test.ts`,
  `pwa/test/attach.test.tsx`, `pwa/test/paste.test.tsx`, `pwa/test/staged-images.test.tsx`,
  `pwa/test/refusal-words.characterization.test.ts` (each case that pinned a refusal of a format now pins its staging).

## Unmeasured

- Which file types a session can actually open on the fleet box is not promised here: Claude Code's own tools decide
  that. A `.noext` file, an archive or an office document reaches the session as a path; whether it reads, unpacks or
  converts it is the session's.
- The phone pickers with no `accept`: iOS is documented to offer the photo library, camera and Files; Android's system
  chooser offers its image and file sources. Neither was measured on a device in this wave.
- A dragged FOLDER arrives as a `File` the browser cannot read; it now stages a chip whose upload fails, where before it
  was ignored (it had no extension). Not measured in a browser.

## Follow-ups

- When `server/src/server.ts` is free: import `CLIP_MAX_BYTES` and `CLIP_MAX_PER_MESSAGE` in place of its own
  `MAX_UPLOAD_BYTES` and `MAX_ATTACHMENTS`, rename the `CLIP_EXT_ALT` import if wanted, and correct the comment above
  `UPLOAD_EXT_RE` that still names `CLIP_EXTS`.
- The upload route's 413 body carries no size; the composer says the size itself.
