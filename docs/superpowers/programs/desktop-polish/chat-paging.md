# Wave 171: the session stream serves older chat pages

Task note for desktop-polish wave 171 (run 3609): scroll back much farther in a session's chat (goals modification 98,
second half). **Server side only.** The stream now offers older pages, one bounded page at a time; no chat list, store
behaviour or screen asks for one yet, so nothing a person can see changes except the backlog's seam (§2). Each claim
below is labelled **measured** (the worker's own run on the fleet box) or **inferred** (read from the code).

## 1. In short

- **The backlog begins at a record start** (§2). Its window is read as four bounded byte reads and framed in bytes. The
  record holding the oldest of the last fifty events is sent whole. An unterminated last line is not a record.
- **The backlog frame gains `older`**, an opaque continuation, only when paging can be offered (§3).
- **A new client frame, `older-page`,** carries that continuation and nothing else. The answer is one frame shape with
  nine distinct end words (§5).
- **The continuation is a security boundary** (§4): HMAC-protected under a key this server process makes at start and
  keeps only in memory, checked before any file I/O, and it never names a file the stream does not already serve.
- **Not offered:** anything across a context reset into an earlier transcript file, beyond retention, or from the
  separate history store (§7).

## 2. The backlog's seam

`readBacklog` (`server/src/transcript/tail.ts`) reads `[size − 1 MiB, size)` as up to four bounded byte reads
(`readFileFromBytesMeasured`, 256 KiB each, the agent link's read cap), not one decoded range read. Bytes are framed into
records; text is decoded per record, so a multibyte character across a read boundary decodes whole.

- **The head:** the partial line the window starts inside is dropped and handed to the helper scan as `cut`, as before.
  Walking back from the newest record, the record that holds the oldest of the last fifty events is emitted **whole**:
  the backlog may exceed fifty events by the rest of that one record. The oldest emitted record's start is the
  **anchor**.
- **The tail (a behaviour change, the coordinator's ruling on this run's question):** an unterminated last line is not a
  record. It is not parsed, and the backlog's `offset` is held at the end of the last whole record, so the tailer
  delivers that line whole once its newline lands. **A final record whose newline never arrives is now shown only when
  it does.** Before, a complete-JSON unterminated line was shown at once, and a half-written one was lost from the live
  view for good (both halves failed to parse). **Measured:** the tailer already had this rule (it holds a partial line in
  its carry until the newline; its existing test pins it), so the backlog and the tailer now agree.
- **What else reads the end position:** the helper scan reads `scanEnd` (the window's first byte) and `cut`, neither of
  which moved; the tailer starts at `offset` and so reads the held line's bytes once (pinned, §8).
- A window with no newline at all after a non-zero start lies inside one record. It frames nothing, and its offset stays
  the file's size, as before.

Commits: characterization (green on main), then the multi-event seam, then the unterminated tail, each its own commit.

## 3. Binding: when paging is offered

A page may be served only when all of these were measured on the backlog's read (`BacklogRead.older`):

| Fact | What it is |
|---|---|
| identity token | the one token **every** window read carried (`MeasuredByteRangeRead.ident`, wave 170). A read with none, or two reads with different ones, means no binding. |
| anchor | the oldest emitted record's start: offset 0, or a byte after a newline the window read. |
| boundary witness | sha256 of the first `min(4096, …)` bytes at the anchor, never reaching into an unterminated last line. |

So an agent that sends no token (older than wave 170), a file with no usable birth time, or a window inside one record
offers no paging: the backlog frame carries no `older`, and is otherwise the same frame (pinned).

Every read a page makes must carry the same token (checked by keyed tag, §4) before its bytes are used, and the witness is
re-read and compared in the same request, first. A read with no token is `unmeasured`; another token is `changed`; a
changed witness is `changed`.

## 4. The continuation (a security boundary)

**Format:** `c1.<key id, 16 hex>.<payload, hex of JSON>.<HMAC-SHA256, 64 hex>`, lowercase hex and dots only, at most 2048
characters (`server/src/transcript/continuation.ts`). Hex because base64url of a JSON object begins `eyJ`, the JWT shape
the stream's masker replaces.

**Bound fields, all under the MAC:** the socket's session id (in clear); keyed tags (HMAC, 128 bits, domain-separated) of
the transcript path and of the identity token, so neither the token nor anything comparable across files reaches the
browser; the cursor (`line-start` or `skip-record`, and its byte offset); the witness (its offset, length and hash).

**The key:** 32 random bytes made when the module loads, in memory only, never stored, logged or sent. A restart makes a
new key and key id, so an earlier continuation is `expired` (its own word), not `invalid`.

**Checks, in order, all before any file I/O:** one page in flight (`busy`); grammar and length (`invalid`); key id
(`expired`); MAC, compared in constant time (`invalid`); field bounds (`invalid`); session id equals this socket's
(`invalid`); what this stream serves now (§6; its own word); the path tag equals the tag of the file THIS stream resolved,
and, when the stream's backlog measured a token, the identity tag equals its tag (`changed`). Then the page reads only the
stream's own file, never a path, size or generation derived from the continuation.

**What an attacker holding a valid continuation can do:** ask for the same page again (a replay answers the same page
over an unchanged or appended file, or a refusal; pinned), or ask on another socket of the same session after a reconnect,
which is the intended use. Every answer is display text the same viewer is already sent by the backlog's stream.

**What it cannot do:** read another session (the session id is bound); read another file, or this file after a rotation
or a replacement (the path and identity tags are bound, and each read re-checks the identity); choose an offset, a size,
a byte count or a file (only the server's own cursor, under the MAC); outlive a restart (`expired`); learn the identity
token or the key; run more than one page at a time per socket (`busy`, no I/O); or make a page larger than its caps (§5).
A forger can make any token read as `expired` by naming another key id, which reads nothing.

## 5. Bounds and the reply

**Per page:** the framing caps already pinned (`readOlderRange`: four reads of at most 256 KiB, 1 MiB scanned, fifty
records), one witness read of at most 4 KiB, and two caps of this wave that hold independently:

| Cap | Value | Measured basis |
|---|---|---|
| parsed events | 400 | Real transcripts on the fleet box (39 files over 1 MiB, 65,372 records, 1,323 framed pages): at most 42 events a page (p99 29), at most 2 events a record. 400 leaves room for wide parallel tool calls (8 a record across 50 records). |
| serialized events | 1 MiB | The same corpus: at most 156 KB a page (p99 96 KB), at most 77 KB a record. 1 MiB equals the bytes a page may scan, about 6.7 times the largest real page. |

The byte cap is counted after the stream's masker, on what is sent. The whole reply frame is at most the byte cap plus
2048 + 128 bytes (the continuation and the frame's own keys; pinned).

**When a cap cuts a page,** the records nearest the boundary are kept, and the next cursor is the start of the oldest
record kept: progress is committed only at a record start. A record that alone exceeds a cap is a **gap**: skipped whole,
never sent in part (pinned). A record too long to frame is the framing's gap, never parsed from its middle.

**The reply** (`OlderPageAnswer`, in `shared/olderPage.ts` with the request and the end words, so `shared/api.ts` stays within its growth cap): the page's events in chronological order, `gap`, and exactly one of
nine end words: `more` (with the next continuation), `start` (offset 0 measured), `changed`, `absent`, `unreadable`,
`unmeasured`, `invalid`, `expired`, `busy`. Only `start` is the end; an empty page never is. Events come from
`parseTranscriptLine`, the parser the backlog and the tailer use (pinned equal).

## 6. Lifecycle

- One page in flight per stream; a second request is `busy` and reads nothing.
- A backlog (a rotation, a re-point, a reconnect) and a tailer opening each bump the stream's generation. A page checks it
  after its awaits and before sending, and a late page is dropped (pinned: a rotation while a page waits, and a page that
  ends while the new backlog is being read).
- A resumed stream (`since`) reads no backlog, so it has no token of its own: its pages check every read's token against
  the continuation's tag.
- A stream whose backlog could not measure the file answers that word (`absent`, `unreadable`, `unmeasured`) with no I/O.
- Pages are display only: no helper facts, pending question, approval state, notification or status. The forward
  offset, `since` handling and the tailer are untouched by a page.

## 7. Not offered, and why

- **Across a context reset** (`/clear`, compaction, a swap): the stream serves one transcript file; an older file is
  another identity, and the brief keeps it out.
- **Beyond retention** and **from the separate history store**: out of scope by the brief.
- **A backlog with no record start in its window** (the newest record is over 1 MiB): no anchor, so no paging.
- **No identity token** (an older agent, a filesystem without a usable birth time): no paging (§3).

## 8. Measured

- **Commits, each run at its own tree:** the characterization passed on main's source (8 cases, including today's
  half-line loss in the backlog, from the tailer and across a resume). The multi-event seam, then the unterminated tail,
  then paging, each passed its own files and the backlog's readers (the tail, helper-fact and helper-scan suites).
- **Exactly once:** the held line arrives once from the tailer in the complete-JSON and half-written cases, a held
  helper fact once from the tailer and never from the backlog, and once across a resume that presents the held offset.
  The helper scan's seam (`scanEnd`, `cut`) did not move.
- **Paging to the start** of a synthetic 9.0 MiB transcript (6,000 records: multi-event records, blank lines, multibyte
  text, six records of 300 KiB): every event exactly once, in order, with no overlap against the backlog.
  - In memory (the test): 120 pages, about 170 ms.
  - Through the real local adapter (a scratch script, run twice): 120 pages to the start in about 106 ms, the slowest
    page 4 ms, the largest reply 366 KB.
- **Every end word** is reached and distinct: `more`, `start`, `changed`, `absent`, `unreadable` and `unmeasured`
  through both the local adapter and the remote adapter over a real agent on a loopback socket; `invalid`, `expired` and
  `busy` at the stream, with no file read.
- **Deletion mutants:** 38 in the first round; 35 were killed. Of the 3 that survived, 1 was equivalent and its check
  was removed (a witness length check, which the hash comparison already covers). The other 2 lacked a pin, which was
  added: the framing's boundary refusal as `changed`, and the backlog's refusal of a short successful read. A second
  round of 4 (those 2, and 2 on the socket parser's new arm) were all killed. Each mutant ran its named test files
  through the test slice, and the source was restored and hash-checked after each.
- **The two caps** were measured as in §5. Neither is reached by any real page in that corpus.
- **Identity on this box** (ext4, Linux 7.0, Node 24.22.1): a file created and written in one call gets **no** token
  (birth time equals change time), so it offers no paging until it is appended to. A transcript Claude Code appends to
  gets one. Measured by the local-adapter script: no token on its first run, a token after the file was rewritten.
- **Wider server run** (the readers of the changed modules and the whole-tree guards: single-definition, rings, growth,
  anchors, citations, census, deviation refs and more), on the final tree: 90 files, 2,973 passed, 3 skipped. **The first
  such run failed 4 cases**:
  - `shared/api.ts` over its growth cap: the older-page types moved to `shared/olderPage.ts`;
  - the end words respelled the absent and unreadable pair: they derive from `ReadFailure` now, as do two server types;
  - a helper-scan case still stubbed the decoded read: it now fails only the backlog's first byte read;
  - one heavy git case in the deviation-refs suite timed out at 20 s under load, and passed alone.
- **Compiler checks:** server source clean.

## 9. Unmeasured

- **Real depth in a live session:** measured later, through the product (the brief).
- **The remote adapter's time per page:** a page makes at most five reads over the agent link. Each read costs a
  round trip that was not measured here.
- **The PWA's compiler check:** this checkout has no PWA dependencies installed. The store's new arm is a no-op beside
  the switch's `satisfies never`, and the pull request's own checks are the arbiter.
- **The whole test project's compiler check**, and every server suite outside the wider run above: left to the pull
  request's selection and the merge queue.
- **Birth time on other filesystems and kernels, and macOS:** as in wave 170's note.
- **`shared/agent-protocol.ts`** still describes the bounded read's reply without `ident` (wave 170's follow-up). The
  brief keeps that file out of this wave.

## 10. Carried from review 3594 (wording only)

The back-read helper's comment, the older-range header and this programme's chat-history note (the refusal paragraph,
the cost wording and a list's formatting), two older-range test names and one comment, the no-trailing-newline test (now
asserts no gap entry), and one identity test's name. No behaviour changed.
