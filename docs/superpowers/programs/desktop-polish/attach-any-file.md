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
  `accept` attribute. `isAttachable` admits every file. `namedUpload` keeps any name with a usable extension, whatever
  type the file declares. A name with no usable extension gains one: a DECLARED picture (`image/png`, `image/jpeg`,
  `image/webp`) gains that picture's (`png`, `jpg`, `webp`), so it still thumbnails and downscales as on main, and any
  other file gains `.noext` (`NEUTRAL_EXT`). A nameless file's stem is `pasted-<ms>`; any other keeps its own name
  whole as the stem (`shot` typed `image/png` becomes `shot.png`, `README` becomes `README.noext`). `add()` names each
  file first, then refuses a non-picture over 12 MB before any request, with a toast saying the name, the size rounded
  up to a tenth of a MB and the limit (`tooLargeText`); a picture is measured after its downscale, and one still over the
  limit fails its chip with the same sentence and is never sent. The tray's count refusal reads its number from
  `CLIP_MAX_PER_MESSAGE`. The "images, text, PDF and RTF only" refusal is gone.
- **Sourced.** `pwa/src/lib/refusalWords.ts`: the server's `unsupported-type` now reads "Can't attach that — its name
  has no extension the server can store." The composer gives every name an extension of the admitted shape before upload
  (a declared picture's, or `.noext`), reading its type table with no prototype to inherit from, so another client or an
  older build can cause that refusal and this composer does not.
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
| Neutral extension | `noext`, for a file that is not a declared picture | It claims no format, as `.bin` or `.txt` would, and tells the reader on the far end what happened: `README` arrives as `clip-…-README.noext`. The chip shows that name too. |
| Picker filter | none | An `accept` with no value is what makes iOS offer the photo library, the camera and Files in one sheet. |
| Where the size refusal happens | in the composer, decided on the name the file will carry: for a non-picture before upload; for a picture after its downscale | A non-picture's size now is its size at the server; a picture's downscale may bring it under. A nameless clipboard picture is a picture by its named form, so it waits for its downscale as on main (review 3647 F1). |
| Declared picture type (ruled, review 3647 F1) | names a picture whose name has no usable extension, nothing else | See "What the declared type is trusted with" below. |
| Size in the refusal | one decimal of MB, rounded up | So a file one byte over reads `12.1 MB`, never the limit itself (review 3647 F9). |
| Limit constants | `CLIP_MAX_BYTES` and `CLIP_MAX_PER_MESSAGE` in `shared/api.ts` | The composer needs them to say the limit. The server's own `MAX_UPLOAD_BYTES` and `MAX_ATTACHMENTS` in `server.ts` are a second copy I could not remove (the file is held); `clip-any-file.test.ts` pins the route's behaviour to the shared values (12 MiB accepted, one byte more refused, a fifth file refused). Follow-up below. |

## The limits

- **Sourced, measured by test.** 12 MiB per file (`CLIP_MAX_BYTES`), enforced by the upload route's own check
  (`413 too-large`), and by the composer before upload. The multipart plugin's 25 MiB limit is the outer bound behind it.
- **Sourced, measured by test.** Four files per message, enforced by the prompt route (`400 bad-attachment` on a fifth)
  and by the tray ("4 attachments per message — send these first", its number read from `CLIP_MAX_PER_MESSAGE`).
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
- **make the console run it as script in the page.** The clip route serves with its own type only the fourteen types in
  `CLIP_MIME`: four pictures, nine text and data types, and `application/pdf`. None of them is a type a browser runs
  as script in the page. A PDF is served inline, as on main, and opens in the browser's own PDF viewer. Every other
  extension is served as `application/octet-stream` with `nosniff`, which a browser does not render. Pinned for
  `.html`, `.htm`, `.xhtml`, `.svg`, `.js`, `.mjs` and `.xml`: each comes back as an opaque download with its bytes
  intact; and each of the fourteen inline types is pinned on the wire with its own type.
- **reach `Object.prototype` through the type table.** Admitting any extension made `constructor` a storable one, and
  on a plain object literal `CLIP_MIME['constructor']` is `Object` itself, which the route would have handed to the
  reply as its type. `CLIP_MIME` is now a frozen table with no prototype. Pinned by serving `x.constructor`.

What is still true and not new: a session that is told the path may do whatever it chooses with the file, as it may
with any file it can read. That is the session's sandbox, not the clip store's.

### What the declared type is trusted with

**Sourced.** A file's declared type (`File.type`, set by the browser from the OS or the clipboard source, and so as
untrusted as the name) decides one thing in the composer: when the name has no usable extension and the type is
`image/png`, `image/jpeg` or `image/webp`, the name gains `png`, `jpg` or `webp`. It never overrides a usable extension,
and it decides nothing on the server, which sees only the name. That trusts the declared type to say the bytes are a
picture, as main did. It is safe on the serving side because the outcome is the same as an uploader naming a non-image
file `x.png` by hand, which was always possible: the bytes are served back as `image/png`, `image/jpeg` or `image/webp`
with `nosniff`, a browser can only try to decode them as an image (a failed decode is a broken thumbnail, which the
bubble already shows as the file's name), and none of the three types runs script. In the composer a mislabelled file
fails its decode (`createImageBitmap`) and its chip fails, as on main. The table is frozen and has no prototype, so a
type declared as `constructor` or `__proto__` finds nothing in it and the file takes `.noext` (review 3647 F7).

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
- Added in the fix round for review 3647: a declared picture with an unshaped name and with none (named for its
  picture, keeping its name); the same names with a non-picture type (`.noext`); a usable extension the type never
  overrides; types named like object members; a nameless picture over 12 MiB that downscales under it, and one that
  stays over (refused, with a name in the words); a batch with one file over the limit beside one that fits; the size
  never said as the limit; twelve and thirteen pinned as numbers, and four files a message pinned as a number, on both
  sides; the whole inline type table pinned entry by entry, and each of its fourteen types pinned on the wire.
  **Measured.** Eleven of them were red on 3fa18201b8 before the fix (every composer case). The pinned numbers, the
  table and the inline types were green there: they pin values that already stood, and the mutants below are their
  proof.

## Mutant table (review 3647 F2)

**Measured** on the code after the fix round: each mutant applied in place to the file named, the test file named run
through the fleet test runner, and the file restored afterwards. Every row was killed. An equivalent mutant the review
named (`[^./]` to `[^.]` in `clipExtOf`) is left out: both forms answer the same on every input, because a name whose
last dot is followed by a slash has no extension either way.

| # | Mutant | File | Killed by |
|---|---|---|---|
| 1 | serve table given a prototype | `server/src/clip.ts` | `clip-any-file`: serving `x.constructor` as an opaque download; the table has no prototype |
| 2 | serve table left unfrozen | `server/src/clip.ts` | `clip-any-file`: the table has no prototype and is frozen |
| 3 | shape put back to a list | `shared/api.ts` | `clip-any-file`: 25 cases, from storing an archive byte for byte on |
| 4 | path pattern without its look-ahead | `shared/api.ts` | `compose`: recognises any extension of the stored shape, and nothing else |
| 5 | raw name tested after lower-casing | `shared/api.ts` | `attach-any-file`: no non-ASCII extension (the Kelvin sign); `.noext` for a name with none |
| 6 | raw-name test given the Unicode flag | `shared/api.ts` | `attach-any-file`: the same two cases |
| 7 | no neutral extension | `useAttachImage.ts` | `attach-any-file`: five cases, `.noext` for a name with none first |
| 8 | picker filter put back | `useAttachImage.ts` | `attach-any-file`: the composer picker has no filter at all |
| 9 | no size refusal before upload | `useAttachImage.ts` | `attach-any-file`: one byte over refused with no request; the batch case |
| 10 | size refusal at the limit itself | `useAttachImage.ts` | `attach-any-file`: a non-picture of exactly the limit is staged |
| 11 | no size check after the downscale | `useAttachImage.ts` | `attach-any-file`: a picture, named and nameless, still over the limit after its downscale |
| 12 | the doors refuse non-pictures | `useAttachImage.ts` | `attach-any-file`: any file is attachable; a pasted file of any type becomes a chip |
| 13 | the server's writer makes files executable | `server/src/io.ts` | `clip-any-file`: a script and a program have no execute bit |
| 14 | the fleet box's writer makes files executable | `agent/src/fileops.ts` | `clip-write-mode`: no execute bit, bytes intact |
| 15 | five files a message | `shared/api.ts` | `attach-any-file`: the count pinned as 4, and the tray's words |
| 16 | five files a message | `shared/api.ts` | `clip-any-file`: the count pinned as 4 |
| 17 | the size arm ends the batch | `useAttachImage.ts` | `attach-any-file`: the batch case, the file beside it still staged |
| 18 | extension length thirteen | `shared/api.ts` | `attach-any-file`: twelve and not thirteen, as numbers |
| 19 | extension length thirteen | `shared/api.ts` | `clip-any-file`: twelve stored, thirteen refused, as numbers |
| 20 | PDF dropped from the inline table | `server/src/clip.ts` | `clip`: the table is exactly the fourteen inline types |
| 21 | size decided on the raw name | `useAttachImage.ts` | `attach-any-file`: both nameless clipboard picture cases |
| 22 | declared picture type used only for a nameless file | `useAttachImage.ts` | `attach-any-file`: a declared picture with an unusable name keeps its picture extension |
| 23 | the composer's type table given a prototype | `useAttachImage.ts` | `attach-any-file`: a type named like an object member finds nothing |
| 24 | size rounded to the nearest tenth, not up | `useAttachImage.ts` | `attach-any-file`: six cases, the size never said as the limit among them |
| 25 | the tray's count words not derived | `useAttachImage.ts` | `attach-any-file`: past the fourth file, the words name the limit |

The first round's eleven mutants (worker-only evidence in the review's reading, since they were not in the tree) are
rows 1, 3, 4, 5, 7, 8, 9, 11, 12, 13 and 14 here, re-run against this round's code.

## Unmeasured

- Which file types a session can actually open on the fleet box is not promised here: Claude Code's own tools decide
  that. A `.noext` file, an archive or an office document reaches the session as a path; whether it reads, unpacks or
  converts it is the session's.
- The phone pickers with no `accept`: iOS is documented to offer the photo library, camera and Files; Android's system
  chooser offers its image and file sources. Neither was measured on a device in this wave.
- A dragged FOLDER arrives as a `File` the browser cannot read; it now stages a chip whose upload fails, where before it
  was ignored (it had no extension). Not measured in a browser.

## Follow-ups (the coordinator opens them; each sits in a file another programme holds)

- **A private mode on the stored file and its folder** (review 3647 F3). No code sets either mode: both writers call
  `writeFile` and `mkdir -p` with Node's defaults, so the execute bits are off under any umask, but the read bits are
  whatever the unit's umask leaves. Under 022 a clip and its folder are group- and world-readable, which matters more now
  that any file (a key, an environment file) can be attached. Whether other local users can reach the folder depends on
  the home directory's permissions, unmeasured. The repair is 0o600 on the file and 0o700 on the folder in both
  writers (`server/src/io.ts`, `agent/src/fileops.ts`).
- **The server reads the shared limits** (review 3647 F6). `server/src/server.ts` enforces its own `MAX_UPLOAD_BYTES`
  and `MAX_ATTACHMENTS`, equal today to `CLIP_MAX_BYTES` and `CLIP_MAX_PER_MESSAGE` but not derived from them, so the
  two can drift with only this wave's pins to notice; the comment above its `UPLOAD_EXT_RE` still names `CLIP_EXTS`.
  The repair is to import the shared pair there, rename the `CLIP_EXT_ALT` import if wanted, and correct that comment.
- **A sandbox policy and a download disposition on the clip reply** (review 3647, the serving lens). The opaque type
  plus `nosniff` is the one mechanism keeping an uploaded page or vector image from rendering; there is no
  `content-security-policy` on the reply and no `content-disposition`. A PDF is served inline from the console's own
  address, as on main. The repair is `content-security-policy: sandbox` on every clip reply and
  `content-disposition: attachment` on the opaque fallback, in the serve route.
- The upload route's 413 body carries no size; the composer says the size itself.

## Known limits, equal to main

- **Disk fill** (review 3647 F4): an uploader holding a session can fill the disk with 12 MiB uploads; there is no
  quota, free-space check or rate limit on the route, as on main.
- **Multipart bounds** (review 3647 F5): the multipart plugin's own limits (25 MiB a file, its default part and field
  counts) apply before the route's 12 MiB check refuses, as on main; the limit is enforced on the real bytes either way.
