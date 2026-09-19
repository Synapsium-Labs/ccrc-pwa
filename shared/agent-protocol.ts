// Wire protocol between ccrc-server (RemoteFleet client, T3) and ccrc-agent
// (T2) — a small authenticated WS surface exposing a whitelisted
// exec/file/tail/pty API on a REMOTE fleet host. Single source of truth for
// both sides; copied verbatim per the plan's pinned interfaces.
//
// L0: this file imports nothing but its `shared/` siblings — not even `node:*`.
// The RULE is `shared/`-wide, and it is stated as the rule rather than as a
// fact about this file: `shared/` is the tree the PWA bundles from, so a
// `node:*` import here is a defect the day a PWA module first imports this one.
// Nothing under `pwa/src` imports this file TODAY (it reaches for `shared/api`
// and `shared/roster`), and saying otherwise would be a false fact sitting next
// to a true rule — this repo reads its comments as history.
import type { BuildInfo } from './buildinfo.js';

export interface AgentHello { t: 'hello'; token: string }
/** `ccdVerbs` is what `ccd caps` printed on the AGENT's box at start —
 *  ~/.local/bin/ccd is a copy, not a symlink to the repo, so passing the
 *  whitelist is not evidence a verb exists there. Optional: an older agent
 *  omits it, and the server treats absent as "no evidence either way".
 *
 *  `v` is deliberately UNREAD, declined rather than forgotten: this pair
 *  already negotiates by CAPABILITY (`ccdVerbs` + `verbSupported`), which is
 *  finer-grained than one generation number and answers the question `v`
 *  would only gesture at. It stays reserved for the day the envelope's own
 *  SHAPE breaks (not a verb gained or lost, but these fields changing) and
 *  gets a reader only then. `shared/api.ts`'s `FLEET_PROTO`/`FLEET_PROTO_MIN`
 *  is the sibling mechanism for the PWA↔server pair, wired because that pair
 *  has no per-capability negotiation to fall back on the way this one does.
 *
 *  `rosterFp` is `bodyDigest` (shared/mark.mjs) of the fleet host's INSTALLED
 *  `~/.ccrc/accounts.sh` — the projection ccd actually sources, not the
 *  `accounts.json` it was generated from. The server compares it against the
 *  digest of the projection ITS roster produces; a mismatch means the two
 *  boxes disagree about which accounts exist, which is silent today and shows
 *  up as sessions attributed to the wrong account or a swap target ccd
 *  rejects.
 *
 *  Comparing the installed projection rather than the two JSON files is the
 *  stricter of the two and catches a case the JSON comparison cannot: a fleet
 *  host whose `accounts.json` was hand-edited but never redeployed, where both
 *  files agree and `ccd`'s behaviour still doesn't.
 *
 *  Optional for the same reason `ccdVerbs` is: an older agent omits it, and
 *  absent must read as "no evidence either way", never as "divergent".
 *
 *  `build` is the FLEET HOST's own build stamp — `~/.ccrc/build.json` as
 *  `deploy/deploy.sh`'s `stamp_build` wrote it on the agent lane, parsed by
 *  `shared/buildinfo.ts`'s `parseBuildInfo` (the same validator the server
 *  applies to its own stamp, imported rather than restated). Until this field
 *  existed the two boxes' builds could diverge indefinitely with nothing able
 *  to say so: `/health` reports the SERVER's sha, and the fleet host's was
 *  legible only by ssh'ing there. The skew is not hypothetical — the agent
 *  lane and the server lane are separate deploys, and an AGENT-FIRST change
 *  (`ccd/`, `session-hook.sh`) ships to one box on purpose.
 *
 *  Optional, and omitted rather than sent empty, for the third time on this
 *  interface: an older agent, an unstamped dev box and an unreadable stamp are
 *  one condition on the wire — "no evidence" — and none of them is "the boxes
 *  disagree". A stamp that fails validation is omitted too, never forwarded as
 *  a partial: a `build` whose `sha` is absent compares unequal to the server's
 *  sha and would manufacture a skew alarm out of a file the fleet host could
 *  not read.
 *
 *  `observedEpoch` is the epoch of the pool projection this node has actually
 *  got, or `null` when it has none. ABSENT from an older agent, which is NOT
 *  the same as `null`: absent means "this build cannot tell you", null means
 *  "I have never synced". The reader keeps them apart
 *  (`observedEpoch === undefined` -> unknown).
 *
 *  THIS VALUE HAS HANDSHAKE CADENCE, not `ccd-pool-sync`'s 60s cadence — it is
 *  sampled once, when the WS connects, and the connection lives for days
 *  while nothing re-samples it (the heartbeat is a bare ping/pong). A server
 *  that treated it as a continuously-refreshing fact would show "in sync"
 *  forever from the first `ready` frame onward, including for a node that
 *  synced once and then stopped. Item 1 (wave-1 fix round A) is exactly that
 *  bug: the server no longer reads this field as the pools wire's
 *  `observedEpoch` authority — `server/src/pools.ts`'s own tick-based reader
 *  of `$REG/pool-epoch` (via `FleetIO.readFileMeasured`, sharing
 *  {@link parseObservedEpochDoc} with this frame's own producer) is. This
 *  field still rides the wire — additive-only forbids removing a field an
 *  older server reads — and `remote/client.ts`'s `onReady` still parses it
 *  into `FleetState.observedEpoch`, but that field is no longer consumed by
 *  the pools wire; see that handler's own comment for what, if anything,
 *  still reads it. */
export interface AgentReady {
  t: 'ready'; v: 1; ccdVerbs?: string[]; rosterFp?: string; build?: BuildInfo;
  observedEpoch?: number | null;
}

/**
 * The pool-epoch projection's own FILENAME — `$REG/pool-epoch` on the fleet
 * box, `~/.cc-sessions/pool-epoch` read from `$HOME`. `POOLS_DIR_NAME`
 * (`server/src/pools.ts`) is this constant's DIRECTORY sibling, created the
 * same way for the same reason; this one names the single FILE the
 * projection is published as, sitting beside that directory in the same
 * registry root.
 *
 * Item 17 (final fix round): five shipped files across three languages held
 * this literal with no single source — `ccd/ccd-pool-sync` (the WRITER, bash
 * and python), `ccd/ccd` (the placement reader, `_acct_pool_state`),
 * `ccd/ccrc-doctor-checks` (the doctor, `_check_pool-sync`), and this
 * constant's own two TypeScript readers (`server/src/pools.ts`'s
 * `readObservedEpochFromRegistry`, `agent/src/server.ts`'s
 * `readObservedEpoch`). `shared/agent-protocol.ts` is the home rather than
 * either package's own `src/`, for the same reason `OBSERVED_EPOCH_NUM` and
 * `ReadFailure` are here: neither package's tsconfig `include`s the other's
 * `src/`, so a production import across that boundary is not the supported
 * shape, and this constant is read by both. The three bash/python spellings
 * cannot import it — bash cannot import a TypeScript constant —
 * `pool-name-parity.test.ts` holds them byte-equal to this value by text
 * scan instead, exactly as it already does for `POOL_NAME_RE` and
 * `POOLS_DIR_NAME`. The WRITER's spelling matters most: a rename there alone
 * leaves every reader answering "never synced" forever — fail-shut, so not
 * dangerous, but the whole feature silently stops with no red anywhere.
 */
export const POOL_EPOCH_FILE_NAME = 'pool-epoch';

/**
 * The `$REG/pool-epoch` document's numeric sub-grammar — `_acct_pool_state`'s
 * own `numRe` (`ccd/ccd:2157`, shared by `epoch`/`issued`/`lease`) and
 * `ccd-pool-sync`'s own `NUM` (`ccd/ccd-pool-sync:156`): zero, or a non-zero
 * digit followed by any digits — no leading zero, because the control
 * plane's `%d` can never produce one.
 *
 * D-TBD-pool-epoch-parser-shared (item 1, wave-1 fix round A): this constant
 * and {@link parseObservedEpochDoc} moved here from `agent/src/server.ts`,
 * where task 8/9 first wrote them as a LOCAL, unexported grammar for the
 * agent's own handshake reader (`readObservedEpoch`). Item 1 gives the
 * SERVER its own reader of the identical file (`server/src/pools.ts`,
 * `FleetIO.readFileMeasured` in place of `readFileSync`) and the brief that
 * ordered it is explicit that there must be exactly one parser, not two
 * hand-typed copies of one grammar — `shared/` is this repo's established
 * home for a grammar both `agent/` and `server/` need (D-1438 moved
 * `ReadFailure` here for the identical reason, and its own comment records
 * why: neither side's tsconfig `include`s the other's `src/`, so a
 * production import across that boundary is not the supported shape here).
 * `agent/src/server.ts` re-exports this constant so
 * `pool-epoch-numeric-parity.test.ts`'s existing import keeps resolving
 * unchanged.
 *
 * Exported as a non-capturing group (the same shape as the python spelling)
 * rather than inlined into {@link parseObservedEpochDoc}'s own line regex, so
 * `pool-epoch-numeric-parity.test.ts` can hold all three spellings
 * byte-equal instead of trusting a comment that CLAIMS agreement — which is
 * exactly what the previous version of this file did (review T8-R1, F5): the
 * leading-zero fix tightened this reader to agree with bash's `numRe` on the
 * strength of prose, and nothing checked that the prose was still true.
 */
export const OBSERVED_EPOCH_NUM = '(?:0|[1-9][0-9]*)';

/** Matches a well-formed `epoch <n>` line ANYWHERE in the document, not only
 *  the first line: `_acct_pool_state`'s own per-line parser is order-agnostic
 *  (`ccd/ccd:2271` onward — the `while` loop whose `case "$k" in` at `:2290`
 *  dispatches on each line's KEY, not a positional read; `:2270` — cited here
 *  in a previous round, review T8-R2 M2 — is the terminator check the line
 *  before, not the loop), so this reader must not be stricter than the
 *  format actually is. */
const EPOCH_LINE_RE = new RegExp(`^epoch (${OBSERVED_EPOCH_NUM})$`, 'm');

/** Matches ANY line KEYED `epoch` — the same first-token test
 *  `_acct_pool_state` makes (`k=${line%% *}`, `ccd/ccd:2287`), regardless of
 *  whether the rest of the line is a well-formed value. Used only to COUNT
 *  such lines (review T8-R2, I2, Ruling): bash refuses a document carrying
 *  two, and the reason (`ccd/ccd:2291-2297`, "nothing says which value is
 *  true") is a statement about the epoch ITSELF — the exact fact this field
 *  exists to report — not one of the placement-trust questions the rest of
 *  that grammar answers and this reader defers (a duplicate `issued`/
 *  `lease`/`acct` line, a second `end`, …). */
const EPOCH_KEYED_LINE_RE = /^epoch(?: .*)?$/gm;

/**
 * Parses the `$REG/pool-epoch` document's own epoch field out of BYTES the
 * caller already has — this function reads no file itself; `readObservedEpoch`
 * (`agent/src/server.ts`, `readFileSync`) and `readObservedEpochFromRegistry`
 * (`server/src/pools.ts`, `FleetIO.readFileMeasured`) each get the bytes
 * their own way and hand them here, so the two cannot drift on what counts as
 * a usable epoch.
 *
 * `null` means the document does not prove a usable epoch — a fact about the
 * DOCUMENT'S content, never about how the bytes were obtained:
 *
 * 1. THE TERMINATOR (review T8-R1, F1). The document must end, after
 *    stripping AT MOST one trailing newline, in a line that is exactly `end`
 *    — the same structural check `_acct_pool_state` makes
 *    (`ccd/ccd:2248-2270`) before it parses a single field, because a
 *    line-oriented reader has no other way to tell a torn final row from a
 *    complete one. This is a PROVENANCE check, not a usability one: an
 *    unterminated document may be a FRAGMENT of a PREVIOUS one, and a number
 *    reported off it UNDER-reports lag — the worse failure, because nobody
 *    goes looking for a silence.
 * 2. EXACTLY ONE `epoch`-KEYED LINE (review T8-R2, I2, Ruling). Zero is "no
 *    epoch line" (unreadable as a projection at all); two or more is a
 *    self-contradiction this parser cannot resolve — the same
 *    direction-of-error argument as the terminator.
 * 3. THAT ONE LINE'S OWN GRAMMAR AND PRECISION ({@link EPOCH_LINE_RE},
 *    {@link OBSERVED_EPOCH_NUM}, plus the round-trip check below — review
 *    T8-R2, M1). `Number(...)` on a digit run requiring ≥ 2^53 to represent
 *    exactly silently ROUNDS — forwarding the rounded value would let the
 *    server's own wire-level validator (`remote/client.ts`,
 *    `Number.isSafeInteger`) discard it as off-grammar and record
 *    `undefined` for a node that plainly has a real epoch. Refusing HERE,
 *    where the content is, means the caller gets `null` — a fact this
 *    document can prove — instead of a fabricated number a downstream reader
 *    takes for absence.
 *
 * Everything else in `_acct_pool_state`'s grammar — a duplicate `issued`/
 * `lease`/`acct` line, a second `end`, an off-grammar `acct` row, a NUL byte,
 * the 64 KiB cap, `issued`/`lease`'s own numeric validation, lease-staleness —
 * is NOT re-implemented here. Those exist to decide whether a TAG may be
 * trusted for PLACEMENT, a different question from the one this field
 * answers: "what epoch does this node have", true of a stale projection too —
 * staleness stays `_acct_pool_state`'s own concern.
 */
export function parseObservedEpochDoc(text: string): number | null {
  // The SAME strip-then-check algorithm `_acct_pool_state` uses
  // (`ccd/ccd:2263-2270`): at most ONE trailing newline is stripped, so a
  // SECOND one (content after the terminator, even a blank line) leaves the
  // true last line empty, not `end`, and is refused.
  const stripped = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lastNewline = stripped.lastIndexOf('\n');
  const lastLine = lastNewline === -1 ? stripped : stripped.slice(lastNewline + 1);
  if (lastLine !== 'end') return null;
  const epochKeyedLines = text.match(EPOCH_KEYED_LINE_RE) ?? [];
  if (epochKeyedLines.length !== 1) return null;
  const m = EPOCH_LINE_RE.exec(epochKeyedLines[0]!);
  if (m === null) return null;
  const digits = m[1]!;
  const n = Number(digits);
  if (String(n) !== digits) return null;
  return n;
}

/** `ccd caps` output -> the list both readers keep: one token per non-empty
 *  line shaped like a bash identifier (`/^[a-z][a-z0-9-]*$/`) — verbs AND
 *  capability tokens alike (`stop-surface` is deliberately chosen to match
 *  this exact shape, task 14 fix round 2, so it needs no second parser).
 *  SINGLE DEFINITION (fix round 3, task 14, Important #3): the agent (which
 *  reads the DEPLOYED fleet-host ccd, `agent/src/server.ts`'s
 *  `readCcdVerbs`) and the server's own local-mode reader (which reads its
 *  own box's ccd, `server/src/localcaps.ts`) must never drift on what
 *  counts as a line worth keeping — two copies of this one regex is exactly
 *  the shape that drifts silently.
 *
 *  ACTUALLY POLICED, not merely asked nicely (fix round 4, task 14, Minor
 *  #4 — an earlier version of this comment claimed a scanner existed here,
 *  citing `SessionLifecycle` as precedent; neither the scanner nor that
 *  precedent existed in `single-definition.test.ts`, and a comment is a
 *  request, not a mechanism). `single-definition.test.ts`'s `describe('one
 *  parseCcdCaps — the ccd-caps-line filter')` scans `shared/`, `server/src`,
 *  `pwa/src` and `agent/src` for this exact regex used inside a
 *  `.filter(...)` call and fails if it appears anywhere but this file, or
 *  if either real reader stops importing it. */
export function parseCcdCaps(stdout: string): string[] {
  return stdout.split('\n').map((l) => l.trim()).filter((l) => /^[a-z][a-z0-9-]*$/.test(l));
}
export interface ExecReq   { t: 'req'; id: number; op: 'exec'; cmd: string; args: string[]; timeoutMs?: number }
export interface ReadReq   { t: 'req'; id: number; op: 'read'; path: string }
export interface ReadFromReq { t: 'req'; id: number; op: 'readFrom'; path: string; offset: number }
export interface ReadB64Req { t: 'req'; id: number; op: 'readB64'; path: string }
export interface ReaddirReq{ t: 'req'; id: number; op: 'readdir'; path: string }
export interface StatReq   { t: 'req'; id: number; op: 'stat'; path: string }
/** The PATH's own type, never its target's — the one question `stat` cannot
 *  answer because it follows. Its own op rather than a field on `stat` for
 *  the reason `agent/src/fileops.ts`'s `StatResult` records for declining an
 *  `lstat` ladder there: a second syscall on every field read, to separate a
 *  state no ccd verb produces. That argument is about the HOT path and holds;
 *  it says nothing about a caller that asks only where the answer decides
 *  something, which is the only caller this op has. */
export interface LstatReq  { t: 'req'; id: number; op: 'lstat'; path: string }
export interface CapsReq   { t: 'req'; id: number; op: 'caps' }
export interface WriteB64Req { t: 'req'; id: number; op: 'writeB64'; path: string; dataB64: string }
export interface TailOpenReq { t: 'req'; id: number; op: 'tailOpen'; path: string; offset: number }
export interface TailCloseReq{ t: 'req'; id: number; op: 'tailClose'; tailId: number }
export interface PtyOpenReq  { t: 'req'; id: number; op: 'ptyOpen'; sessionId: string; cols: number; rows: number }
export interface PtyInput    { t: 'pty'; ptyId: number; ev: 'input'; dataB64: string }
export interface PtyResize   { t: 'pty'; ptyId: number; ev: 'resize'; cols: number; rows: number }
export interface PtyClose    { t: 'pty'; ptyId: number; ev: 'close' }
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|LstatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq;
export interface ResOk  { t: 'res'; id: number; ok: true;  [k: string]: unknown } // op-specific payload fields below
export interface ResErr { t: 'res'; id: number; ok: false; err: string }
// exec → {code, stdout, stderr}; read → {data: string|null, absent?: true}; readFrom → {data: string, size: number}|{data: null, absent?: true};
// readB64 → {dataB64: string|null, absent?: true, tooLarge?: true, size?: number}; readdir → {names: string[]|null}; stat → {mtimeMs, size}|{missing: true, absent?: true};
// lstat → {kind: 'regular'|'symlink'|'other'}|{missing: true, absent?: true}. TWO positive markers and no
//   silent third answer: an agent that does not implement this op fails the request outright
//   (`not-implemented`), so the server reads UNMEASURED rather than mistaking an older peer's
//   silence for `regular` — the D-114 shape, in the one direction that matters here, because
//   `regular` is the only answer that lets a caller condemn anything.
// writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}; caps → {verbs: string[]}

/** Why a `read`/`readB64`/`readFrom`/`stat` op couldn't produce its answer —
 *  the ONE vocabulary both ends of this wire fold the op's boolean
 *  `absent?: true` flag into once they have it. `absent` means a PROVEN
 *  ENOENT: the path genuinely does not exist. `unreadable` means everything
 *  else — EACCES, EISDIR, ENOTDIR, ELOOP, a non-errno failure, a rejected
 *  request (disconnected/timeout/forbidden/bad-request) — the path IS there
 *  (or this box can't even tell) and this box just can't read it. Fail-shut
 *  on purpose: only a proven ENOENT is allowed to answer `absent`.
 *
 *  Declared ONCE here (D-1438) rather than twice on the two sides of the
 *  pair: `agent/src/fileops.ts`'s `readB64Measured`/`readFromMeasured` derive
 *  from this instead of re-spelling the union locally, and
 *  `server/src/io.ts`'s `ReadFailure` re-exports this rather than declaring
 *  it. Before D-1438 the earlier plan (`docs/superpowers/plans/2026-08-20-
 *  fleetio-measured-read.md`, "the seam's shape") deliberately kept this
 *  union OUT of `shared/` — `agent/tsconfig.json` includes only `src/**` +
 *  `../shared/**`, so the agent side could not import `server/src/io.ts`,
 *  and the plan judged putting the union in `shared/` not worth also putting
 *  it on the PWA's bundle path. `single-definition.test.ts` caught the
 *  predicted drift instead: the pair got spelled twice anyway. Both ends
 *  already import this file (`agent/src/server.ts`, `server/src/remote/
 *  io.ts`), so this is the natural single home, and a type-only export adds
 *  nothing to the PWA's bundle unless the PWA starts importing this file. */
export type ReadFailure = 'absent' | 'unreadable';

export interface TailData  { t: 'tail'; tailId: number; dataB64: string }       // appended bytes
export interface TailReset { t: 'tail'; tailId: number; reset: true; size: number } // file truncated/rotated
export interface PtyData   { t: 'pty'; ptyId: number; ev: 'data'; dataB64: string }
export interface PtyExit   { t: 'pty'; ptyId: number; ev: 'exit' }
export interface Ping { t: 'ping' }  export interface Pong { t: 'pong' }
