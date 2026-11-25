# Wave 170: chat history, two read slices that nothing consumes yet

Task note for desktop-polish wave 170 (run 3531): load older chat turns as the reader scrolls. This pull request
carries two building blocks. **Nothing consumes either result yet, and nothing a person can see changes**: no socket,
parser, store or screen changed, and no paging exists. The identity slice does change what runs today (§3.1). Each claim
below is labelled **measured** (the worker's own run on the fleet box) or **inferred** (read from the code). No review
replayed the counts, and the raw evidence is not in the tree; it went to the coordinator as a private handoff packet.

## 1. In short

- **Framing slice** (`server/src/transcript/olderRange.ts`): reads one bounded page of complete transcript records
  backward from a cursor, through the FleetIO port and the shared back-reader (`backread.ts#walkBack`, unchanged).
  Nothing imports it outside its test.
- **Identity slice** (`agent/src/fileops.ts`, `server/src/io.ts`, `server/src/remote/io.ts`, plus a two-line change to
  the agent's read reply): a bounded byte read that returns bytes may also carry an opaque token naming the file it read,
  measured on the same open handle that read the bytes. **This is live:**
  - every bounded agent read that returns bytes now takes one extra stat; when the file's facts are usable and the bytes
    came back in full it also takes one hash and sends one extra reply field;
  - the local bytes read was replaced for every local-mode caller.

  Nothing reads the token yet.
- **Not done here:** the backlog anchor, the older-turns request, the parser, the store and the screen. They are the next
  slice, and separate work.

## 2. The framing slice

`readOlderRange(io, file, cursor, limits?)` answers at most `chunks` range reads of at most `chunkBytes` each, and at
most `records` records. Production caps: four reads of the agent link's 256 KiB read cap (1 MiB), and 50 records. A
fixture may lower a cap but never raise it.

- **What it frames:** bytes only. No decoding, parsing, events or file identity.
- **Cursor:**
  - `line-start`: the first byte of a record. The byte before it must be a newline, checked inside the page's first
    read.
  - `skip-record`: inside a record too long for one page. Its bytes are walked, never framed, so no suffix of an
    oversized record is ever answered as a record.
  - **A file whose last bytes have no trailing newline** has no record there. A `line-start` cursor at its size refuses
    `invalid-boundary`. A caller starts such a file with `skip-record` at its size, which drops the unterminated tail
    and answers the whole records before it.
- **Continuation:** `start` (reached offset 0), `more` (a strictly lower cursor), or `gap`.
  - A `gap` means a page that read its whole window from a line start framed no record, because the record ending at
    the cursor is at least as long as the window. A record exactly one window long, its newline included, is a gap too:
    every byte was read, but the page cannot prove the window's lowest byte starts a line. The caller marks exactly one
    gap for it.
  - Each next cursor is strictly lower, so repeated pages always progress.
- **Refusals:**
  - A range read that answers fewer bytes than asked is `invalid-boundary`, never a short page.
  - A file that shrank **below** a read's offset is answered `unreadable` by the adapter itself, and that word passes
    through unchanged. So a file that changed under a page reads as either word, depending on where and when it was
    cut: a cut below a read's offset, or a cut above it that lands between an adapter's path stat and its handle stat or
    during its read, answers the adapter's own `unreadable`; only a cut made before a read's path stat reaches the
    framing's wrapper, as a short successful read. Neither is ever a page.
  - Any failure discards every record the page had framed. The failure words are `ReadFailure` (imported from its one
    home) plus `invalid-boundary`.

## 3. The identity slice

**The token:** sha256 hex of `read-ident-v1\0<dev>\0<ino>\0<birthtimeNs>`, from a bigint stat of the handle that read
the bytes.

- **When it is issued:** only for a regular file with a non-zero inode and `0 < birthtimeNs < ctimeNs`.
- **Absent means unmeasured.** There is no device-and-inode fallback. Equal birth and change times stay unmeasured.
- **Where it goes:** only on an answer that carries the full bytes it promised, never on EOF. It is server-internal and
  never reaches a browser.

**By component:**
- **Agent (`readFromMeasured`):** the bounded read stats its own handle. A failed stat gives the same bytes with no
  token. A file that shrank after the open answers its short or empty bytes as before, but never with a token. The
  unbounded read and EOF keep their exact old keys.
- **Agent reply:** passes `ident` through when present. This is the two-line change the holder of that file consented
  to, applied byte for byte. Nothing else in that file changed, and `shared/agent-protocol.ts` is untouched.
- **Local adapter (`readFileFromBytesMeasured`):** the EOF arm is unchanged and still opens nothing, from the path
  stat. The bytes arm opens the file read-only and nonblocking, and takes its size, its type and the token from that one
  handle.
- **Remote adapter:** keeps a token only when it is 64 lowercase hex and the answer carries bytes. It drops even a
  well-formed token on an empty success. An older agent that sends no token gives the exact old answer.

### 3.1 What runs today

**Every bounded agent read that returns bytes takes one extra bigint fstat. When the file's facts are usable and the
bytes came back in full, it also takes one sha256, and its reply carries one extra field** (`ident`, 64 hex). The change
is additive: `FLEET_PROTO` is unchanged, and `server/src/remote/io.ts` is the field's one reader. An existing remote
caller's result carries the token when the agent issued one; none reads it.

**The local bytes read was replaced for every local-mode caller.** Measured by a grep of `server/src`:
- delegation ingest (`coord/delegation-ingest.ts`);
- the gitref log read (`coord/gitref.ts`);
- the slash-command walk (`commands.ts`);
- workflow reads (`workflows/read.ts`), and the helper scan through the shared back-reader
  (`workflows/helperScan.ts`).

It keeps the same contract, `bytes.length === min(maxBytes, size − offset)`, with these
changes (measured, each pinned by a test):
1. A file that grew between the path stat and the open answers the handle's size and bytes.
2. A handle that is not a regular file is unreadable before any byte is read.
3. A failed stat of the open handle is unreadable on the local adapter, while the agent answers the bytes with no token.

**Kept:** R99. A file that has fewer bytes than the path stat promised is unreadable, never short bytes. Its guarantee
now rests on two checks on the one handle: the handle's size against what the path stat promised, and the bytes
actually read against what was due. Also kept: EOF without an open (a regular file, one without read permission, a
directory at its exact size, a FIFO), the exact length, the distinct failures, the unbounded replies and the
older-agent shape.

**Cost** (measured).
- An **end-of-file read** pays nothing extra: the agent returns before the stat, and the local EOF arm opens nothing.
- On a **read that returns bytes**, the added step (one bigint fstat of the open handle plus `readIdentOf`, the real
  function) took a median of **6.9 µs**: about 5.3 µs for the stat and 0.6 µs for the hash.
  - For scale: a whole bounded 4 KiB `readFromMeasured`, which already includes that step, took about 31 µs.
  - Method: a simple loop on a 1 MiB fixture that gets a token; 5 rounds of 20,000 calls, the median shown.
  - Conditions: the fleet box, Node 24.22.1, load average about 4.3 on 16 cores.
- No counter or log was added.

## 4. Measured

- **Red first.** The identity cases failed before the implementation: agent 10, local 7, remote 3. Stat facts are
  controlled per handle by a test-only wrapper of `open`, R99's existing pattern; there is no production seam. A
  rename-over after the open runs deterministically: old bytes with the old token, then new bytes with a new token. It
  is covered on the agent function, the local adapter and the real wire.
- **Green on the first run after the implementation:** local and remote 289/289, agent file ops 94/94.
- **Whole agent suite.** The first run had 1 failure: the new tests made temp dirs outside the shared registry. They
  were switched to `mkTmp`, and file ops plus the registry guard then passed 99/99.
- **Wide server run** (the readers of this call and the guards): 72 of 73 files and 2860 tests passed. The other file
  had only 20 s timeouts, under memory-cap kills in the shared test slice; see §5.
- **Deletion mutants.** 17 identity mutants were killed in the build (one was first invalid, made unique and killed).
  That set did not cover the nonblocking flag on the local open; review 3586 found it.
- **Review 3586's fix round** added a pin for each guard that had none, and each new guard was deletion-checked (3 of 3
  killed, sources restored and hash-checked after each):
  - the local open's flags (read-only, nonblocking);
  - a negative birth time;
  - no token on bytes the agent did not return in full.

  It also added framing fixtures:
  - a later read of a page shortened after an earlier read succeeded, both above and below the read's offset;
  - a file with no trailing newline, for both cursor kinds;
  - a record exactly one window long.

  The framing file, the local and remote adapter files and the back-reader's file now pass 329/329; agent file ops plus
  the registry guard pass 102/102. The framing slice's own mutants were killed in the build.
- **Compiler checks.** Server source and agent source: clean. Scoped configs over the changed test files and everything
  they import: 0 errors, on the server and the agent side.
- **Birth time on this box** (ext4, Linux 7.0, Node 24.22.1): non-zero and stable across an append. A file created
  and written in one call has birth equal to change, so it gets no token.

## 5. Unmeasured

- The whole server test-project compiler check, locally: the shared slice's memory cap killed it twice. The pull
  request's own checks are the arbiter.
- `delegation-watch.test.ts` on a quiet box. It passes straight through the replaced local read. Under load it timed out
  on different cases each run, and its four timed-out cases passed when run alone. A timed-out file is not green, and
  that does not establish the cause. The pull request's test selection, or a run of that file alone on the base and on
  the tip, answers it; the wave-done carries the answer.
- Birth time on other filesystems and kernels, and macOS.
- Identity availability for the real backlog anchor and for older byte reads. This is proof of the primitive only. It
  is not evidence that paging can be offered.

## 6. Follow-up

- **`shared/agent-protocol.ts`:** its description of the bounded `readFrom` reply (`{data, dataB64, size}`) now omits
  the `ident` field the agent sends. This branch leaves that file alone. The paging slice should correct the description
  with the consent of that file's holder.
