# Wave 170: chat history, two dormant read slices

Task note for desktop-polish wave 170 (run 3531): load older chat turns as the reader scrolls. This pull request
carries two building blocks only. **Nothing calls either of them yet**: no socket, wire protocol, parser, store or
screen changed, and no paging exists. Each claim below is labelled **measured** (the worker's own run on the fleet
box) or **inferred** (read from the code). No review replayed the counts, and the raw evidence is not in the tree. It
went to the coordinator as a private handoff packet.

## 1. In short

- **Framing slice** (`server/src/transcript/olderRange.ts`): reads one bounded page of complete transcript records
  backward from a cursor, through the FleetIO port and the shared back-reader (`backread.ts#walkBack`, unchanged).
- **Identity slice** (`agent/src/fileops.ts`, `server/src/io.ts`, `server/src/remote/io.ts`, plus a two-line change to
  the agent's read reply): a bounded byte read that returns bytes may also carry an opaque token naming the file it read.
  The token is measured on the same open handle that read the bytes.
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
- **Continuation:** `start` (reached offset 0), `more` (a strictly lower cursor), or `gap` (one record could not be
  framed within a whole window, and the caller marks exactly one gap). Each next cursor is strictly lower, so repeated
  pages always progress.
- **Refusals:** a range read that answers fewer bytes than asked is `invalid-boundary`, never a short page, because the
  file no longer reaches the cursor. A failure discards every record the page had framed. The failure words are
  `ReadFailure` (imported from its one home) plus `invalid-boundary`.

## 3. The identity slice

**The token:** sha256 hex of `read-ident-v1\0<dev>\0<ino>\0<birthtimeNs>`, from a bigint stat of the handle that read
the bytes.

- **When it is issued:** only for a regular file with a non-zero inode and `0 < birthtimeNs < ctimeNs`.
- **Absent means unmeasured.** There is no device-and-inode fallback. Equal birth and change times stay unmeasured.
- **Where it goes:** only on an answer that carries bytes, never on EOF. It is server-internal and never reaches a
  browser.

**By component:**
- **Agent (`readFromMeasured`):** the bounded read stats its own handle. A failed stat gives the same bytes with no
  token. The unbounded read and EOF keep their exact old keys.
- **Agent reply:** passes `ident` through when present. This is the two-line change the holder of that file consented
  to, applied byte for byte. Nothing else in that file changed, and `shared/agent-protocol.ts` is untouched.
- **Local adapter (`readFileFromBytesMeasured`):** the EOF arm is unchanged and still opens nothing, from the path
  stat. The bytes arm reads through one open handle and takes its size, its type and the token from that handle.
- **Remote adapter:** keeps a token only when it is 64 lowercase hex and the answer carries bytes. It drops even a
  well-formed token on an empty success. An older agent that sends no token gives the exact old answer.

**Changes in behaviour, local bytes arm only** (measured, each pinned by a test):
1. A file that grew between the path stat and the open answers the handle's size and bytes.
2. A handle that is not a regular file is unreadable before any byte is read.
3. A failed stat of the open handle is unreadable on the local adapter, while the agent answers the bytes with no token.

**Kept:** R99. A file that has fewer bytes than the path stat promised is unreadable, never short bytes. Also kept:
EOF without an open (a regular file, one without read permission, a directory at its exact size, a FIFO), the exact
length, the distinct failures, the unbounded replies and the older-agent shape.

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
- **Deletion mutants.** All 17 identity mutants were killed (one was first invalid, made unique and killed). The
  framing slice's mutants were killed too, and its own file passed 26/26. Every source was restored and hash-checked
  after each mutant.
- **Compiler checks.** Server source and agent source: clean. Scoped configs over the changed test files and everything
  they import: 0 errors, on the server and the agent side.
- **Birth time on this box** (ext4, Linux 7.0, Node 24.22.1): non-zero and stable across an append. A file created
  and written in one call has birth equal to change, so it gets no token.

## 5. Unmeasured

- The whole server test-project compiler check: the shared slice's memory cap killed it twice.
- `delegation-watch.test.ts` on a quiet box. Under load it timed out on different cases each run. Its four timed-out
  cases passed when run alone, but a timed-out file is not green and that does not establish the cause.
- The full server suite and CI, on this branch.
- Birth time on other filesystems and kernels, and macOS.
- Identity availability for the real backlog anchor and for older byte reads. This is proof of the primitive only. It
  is not evidence that paging can be offered.
