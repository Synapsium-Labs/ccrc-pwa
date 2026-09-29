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
import { isReleaseTag, isRequestKind, type InFlightReport, type RequestKind } from './api.js';

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
 *  still reads it.
 *
 *  `ops` names the request ops this agent answers beyond the closed set every
 *  agent has always had (design 2026-09-20 §8/§10) — `['update']` from W4's
 *  agent. ABSENT from every agent before that, and absence is tolerated and
 *  grants nothing: the server's one reader (`remote/client.ts`'s
 *  `readReadyOps`) reads an absent field, a non-array, and a list with any
 *  word off `CAP_WORD` or more than `MAX_CAP_WORDS` words as the same `[]` —
 *  "this link named no op I may send" — which the inventory stores as `''`
 *  and which is NOT the server row's `NULL` ("no agent at all", decision 11).
 *  Unlike `observedEpoch` above, handshake cadence is the RIGHT cadence for
 *  this field: the ops an agent process answers cannot change without that
 *  process restarting, and a restart is a new `ready`. */
export interface AgentReady {
  t: 'ready'; v: 1; ccdVerbs?: string[]; rosterFp?: string; build?: BuildInfo;
  observedEpoch?: number | null;
  /** The one op word defined for this list is `UPDATE_OP` (`'update'`), which programme wave 5's agent sends; `readReadyOps` reads it. */
  ops?: string[];   // ADDITIVE (design 2026-09-20 §8/§10): the ops this agent answers; absent from every agent before W4
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
 * The `~/.ccrc` NODE FILES — design 2026-09-20 §8's EXACT-BASENAME set, the
 * one agent read grant that is not a directory prefix. Declared here, and not
 * in either package's `src/`, for `POOL_EPOCH_FILE_NAME`'s reason above: the
 * agent's `checkPath` (`agent/src/whitelist.ts`) admits exactly these names
 * and the server's inventory sweep (`server/src/update/inventory.ts`) reads
 * exactly these names, and a name spelled twice is a sweep that reads a file
 * the agent refuses — `unreadable` forever, with no red anywhere.
 *
 * `~/.ccrc` ALSO holds `agent.env` (this agent's own bearer), `auth.scrypt`,
 * `coord.db`, `deploy.env` and every other secret-bearing file `ccd/ccrc`
 * writes. Nothing may ever be added to this object that names one of them —
 * the grant derives from it, so an entry here IS a read grant.
 * `projection` (`update-intent`) is in the set so the server can SHOW what a
 * fleet node last received; it is never read back as authority (§8).
 *
 * Writers: `ccd/ccrc` writes `build.json`, `installed`, `ccrc-caps`, `floor`
 * and `node-id` today (its `BOX_*_FILE` constants — bash cannot import this,
 * so those spellings are its own); `previous` and `update.json` are W4's; the
 * server process writes its OWN box's `update-intent` from W2, and W4's
 * `ccd-update-sync` writes a fleet node's. A name read before its writer
 * exists answers `absent`, which is the truth about that node.
 */
export const CCRC_DIR_NAME = '.ccrc';
export const NODE_FILES = {
  stamp: 'build.json', installed: 'installed', caps: 'ccrc-caps', floor: 'floor', previous: 'previous',
  nodeId: 'node-id', report: 'update.json', projection: 'update-intent',
} as const;
export type NodeFileKey = keyof typeof NODE_FILES;
/** The eight names as one list, DERIVED — the agent's admission set and every
 *  scan over it read this, never a restatement. */
export const NODE_FILE_BASENAMES: readonly string[] = Object.values(NODE_FILES);

/**
 * The `$REG/pool-epoch` document's numeric sub-grammar — `_acct_pool_state`'s
 * own `numRe` (`ccd/ccd:2157`, shared by `epoch`/`issued`/`lease`) and
 * `ccd-pool-sync`'s own `NUM` (`ccd/ccd-pool-sync:156`): zero, or a non-zero
 * digit followed by any digits — no leading zero, because the control
 * plane's `%d` can never produce one.
 *
 * D-3086 (item 1, wave-1 fix round A): this constant
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
/** Design 2026-09-20 §10: ONE member of the existing `req` envelope, not a new
 *  top-level frame. `kind` absent means `'update'` (the agent's `validateReq`
 *  fills it in). `tag` passes `isReleaseTag` before any case body sees it — a
 *  failure answers `bad-tag`, never `bad-request`, which from this op means
 *  exactly one thing: the agent predates it. */
export interface UpdateReq { t: 'req'; id: number; op: 'update'; tag: string; kind?: RequestKind }
export interface PtyInput    { t: 'pty'; ptyId: number; ev: 'input'; dataB64: string }
export interface PtyResize   { t: 'pty'; ptyId: number; ev: 'resize'; cols: number; rows: number }
export interface PtyClose    { t: 'pty'; ptyId: number; ev: 'close' }
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|LstatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq|UpdateReq;
export interface ResOk  { t: 'res'; id: number; ok: true;  [k: string]: unknown } // op-specific payload fields below
/** `detail` is ADDITIVE (design 2026-09-20 §10, D-3373): what an
 *  agent can say beyond the word — the `--detach` parent's first stderr line,
 *  what `update.json` said. Absence permits: every op but `update` sends none,
 *  and an agent from before the field sends none. Its ONE reader is
 *  `server/src/remote/client.ts`'s `AgentOpError`. No `FLEET_PROTO` bump. */
export interface ResErr { t: 'res'; id: number; ok: false; err: string; detail?: string }
// exec → {code, stdout, stderr}; read → {data: string|null, absent?: true}; readFrom → {data: string, size: number}|{data: null, absent?: true};
// readB64 → {dataB64: string|null, absent?: true, tooLarge?: true, size?: number}; readdir → {names: string[]|null}; stat → {mtimeMs, size}|{missing: true, absent?: true};
// lstat → {kind: 'regular'|'symlink'|'other'}|{missing: true, absent?: true}. TWO positive markers and no
//   silent third answer: an agent that does not implement this op fails the request outright
//   (`not-implemented`), so the server reads UNMEASURED rather than mistaking an older peer's
//   silence for `regular` — the D-114 shape, in the one direction that matters here, because
//   `regular` is the only answer that lets a caller condemn anything.
// writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}; caps → {verbs: string[]}; update → {accepted: true, detail?: string} (D-3413: `detail` only from the bound's arms B and D)

// ── the `update` op (design 2026-09-20 §10) ─────────────────────────────────
// Everything both ends of the op must agree on is declared here, once. The
// agent (`agent/src/server.ts`) spawns from these templates. The server's
// dispatcher spawns its OWN node from the same two calls
// (`server/src/update/converge.ts`) and maps the same words
// (`server/src/update/dispatch.ts`'s `classifyOpAnswer`). Bash cannot import this, so `ccd/ccrc`
// spells its side itself (`UPD_FROM_WORDS`, the `--detach`/`--to` parser), and
// wave 4's tests hold that side.

/** The op's name — and the one word an agent that answers it lists in `ready.ops`. */
export const UPDATE_OP = 'update';

/** D-3370 — the ONLY words the agent's `update` case
 *  answers with. `ResErr.err` has no closed vocabulary (every other op's words
 *  are free strings), so this op's own are declared here. The dispatcher's
 *  answer mapping switches over `UpdateOpError` with a `never` arm, so a word
 *  added on one side alone is a compile error. `bad-request` is deliberately
 *  NOT a member: it is the envelope's word for an op `validateReq` does not
 *  know, which from this op means the agent predates it.
 *
 *  `not-queued` (D-3413, fix round 1 item 2) is the one word the bound's arm A needs across the link: the `--detach`
 *  parent was stopped at `UPDATE_SPAWN_TIMEOUT_MS` BEFORE it queued anything (the box's `update.json` read the same
 *  before and after, and the parent's stdout, read to EOF, carried neither the `update.json` WARN nor the `detached`
 *  line), so nothing started and the server releases the row `idle` with the request standing. It is not `busy`
 *  (busy means ANOTHER actor is updating, and no one is) and not `spawn-failed` (which halts, and this is no fault).
 *  No skew hazard: only a wave-5 server ever sends the op, and this word ships inside wave 5. */
export const UPDATE_OP_ERRORS = ['bad-tag', 'bad-kind', 'busy', 'spawn-failed', 'not-queued'] as const;
export type UpdateOpError = (typeof UPDATE_OP_ERRORS)[number];
/** Use THIS, never `UPDATE_OP_ERRORS.includes(x as UpdateOpError)` — `isRunState`'s rule. */
export function isUpdateOpError(v: unknown): v is UpdateOpError {
  return typeof v === 'string' && (UPDATE_OP_ERRORS as readonly string[]).includes(v);
}

/** The `--from` word every console-driven move carries — a member of wave 4's
 *  `UPD_FROM_WORDS` (`ccd/ccrc`), which refuses any other at exit 2. */
export const UPDATE_OP_FROM = 'pwa';

/** `$HOME/.local/bin/ccrc` as parts: the installed shim, ABSOLUTE (§18 "the
 *  spawn argv is absolute"). A systemd user unit's PATH does not carry
 *  `~/.local/bin` (the reason `resolveSpawnCmd` exists for `ccd`), and a bare
 *  name would run whatever PATH found first. Spelled here once, and
 *  `single-definition.test.ts` holds it to this file. */
export const UPDATE_LAUNCHER_PARTS = ['.local', 'bin', 'ccrc'] as const;

/** `<home>/.local/bin/ccrc`. Throws `RangeError` unless `home` is absolute
 *  (`/`-led) with no trailing `/`: that is a caller bug (the agent's
 *  `cfg.home`, the server's own `cfg.home`), never something to spawn. Joined
 *  by hand because L0 imports no `node:path`. */
export function updateLauncherPath(home: string): string {
  if (!home.startsWith('/') || home.endsWith('/')) {
    throw new RangeError(`updateLauncherPath: home must be absolute with no trailing slash (got ${JSON.stringify(home)})`);
  }
  return [home, ...UPDATE_LAUNCHER_PARTS].join('/');
}

/** THE TWO TEMPLATES (spec §10): `[kind, '--to', tag, '--detach', '--from',
 *  UPDATE_OP_FROM]`. The spawn is therefore `ccrc update --to <tag> --detach
 *  --from pwa` or `ccrc rollback --to <tag> --detach --from pwa`, with `tag` the
 *  only variable token. Throws `RangeError` unless `isRequestKind(kind)` and
 *  `isReleaseTag(tag)`. The tag guard runs AGAIN here, though the agent's
 *  `validateReq` ran it first, so an edit that lets an unvalidated tag through
 *  the shape gate still never reaches `execFile`. Frozen: a caller cannot
 *  append a flag to a template. */
export function updateSpawnArgv(kind: RequestKind, tag: string): readonly string[] {
  if (!isRequestKind(kind)) {
    throw new RangeError(`updateSpawnArgv: kind must be update or rollback (got ${JSON.stringify(kind)})`);
  }
  if (!isReleaseTag(tag)) {
    throw new RangeError('updateSpawnArgv: tag is not a release tag (vX.Y.Z) — a caller bug; nothing was spawned');
  }
  return Object.freeze([kind, '--to', tag, '--detach', '--from', UPDATE_OP_FROM]);
}

/** D-3374 — the agent's bound on the `--detach` parent, and the
 *  server-role local spawn's. The parent is not instant: `ccrc rollback
 *  --detach` asks the release host whether the tag exists before it detaches
 *  (wave 4 Task 7), within `CCRC_RELEASE_PROBE_MAX_TIME` (`ccd/ccrc`, 15 s by
 *  default), which wave 4 sized to sit under this value, so a silent release host
 *  answers as that verb's own refusal, not as this bound's timeout. */
export const UPDATE_SPAWN_TIMEOUT_MS = 20_000;
/** The server's `FleetClient.request` deadline for THIS op only (the client's
 *  default is 15 s). Held strictly above `UPDATE_SPAWN_TIMEOUT_MS` by a test.
 *  The agent's answer, even "the parent timed out", therefore always arrives
 *  before the server gives up, so a timeout never releases a lease while a
 *  node is still starting a run. */
export const UPDATE_OP_TIMEOUT_MS = 30_000;
/** How long, after the `--detach` parent has EXITED, the bounded spawner still waits for its stdout to reach
 *  EOF before it answers with `stdout: null`. A grandchild that left the parent's process group (setsid) and
 *  still holds the pipe would otherwise keep `close` from ever firing. The whole answer therefore arrives within
 *  `UPDATE_SPAWN_TIMEOUT_MS + UPDATE_SPAWN_DRAIN_MS` of the spawn (the drain is ONE deadline, armed by the kill or by
 *  the exit, whichever comes first — never restarted), and that sum plus the op's bounded reads before and after it must
 *  stay below `UPDATE_OP_TIMEOUT_MS`, so the agent always answers before the server gives up on the op (a test pins
 *  the sum). */
export const UPDATE_SPAWN_DRAIN_MS = 2_000;

/** What the bounded update spawner answers, on both roles (the agent's `makeUpdateSpawn`, the server's
 *  `localUpdateSpawnFor`). `stdout` is the parent's WHOLE stdout read to EOF, or `null` when EOF was not reached
 *  within `UPDATE_SPAWN_DRAIN_MS` of the parent's exit, or the capture cap was hit: `null` is "not measured", never
 *  "empty". `pid` is the spawned parent's pid, null only when the spawn itself failed. `killed` is true when the
 *  bound fired and the whole process group was sent SIGKILL. */
export interface UpdateSpawnResult { code: number; stdout: string | null; stderr: string; killed: boolean; pid: number | null }
/** The bound on `ResErr.detail`. It is 200, the same as W2's
 *  `REPORT_DETAIL_MAX` for `update.json`'s own detail. */
export const UPDATE_OP_DETAIL_MAX = 200;

/** What a `spawn-failed` answer carries (spec §10, D-3372).
 *  Each line of the `--detach` parent's stderr is cleaned by W2's
 *  `printableDetail` rule: every run of characters outside printable ASCII
 *  (0x20–0x7E) becomes one space, then the ends are trimmed. The first line
 *  with anything left in it is the answer, cut to `UPDATE_OP_DETAIL_MAX`. With
 *  no such line the answer is `'no message'`, never an empty detail. */
export function firstStderrLine(stderr: string): string {
  for (const raw of stderr.split('\n')) {
    const line = raw.replace(/[^\x20-\x7e]+/g, ' ').trim();
    if (line !== '') return line.slice(0, UPDATE_OP_DETAIL_MAX);
  }
  return 'no message';
}

/** D-3411 — the sentence the `--detach` parent's lock probe dies with, as the PREFIX both roles match. Wave 4's
 *  `_upd_busy_die` (`ccd/ccrc`) prints `ccrc: update: another update holds ~/.ccrc/update.lock (<holder>)` to
 *  stderr through `_ccrc_die`, whose `$PROG: ` prefix is part of the line; the parenthesised holder varies. It is
 *  declared ONCE, here: a parent that exits non-zero with THIS as its first stderr line was refused by a lock
 *  somebody holds, with nothing on the box changed, so the node is BUSY, not faulted. Every other refusal keeps its
 *  mapping — `_upd_flock_die` (no `flock`) and the probe's unmeasured arm stay `spawn-failed`, because a box that
 *  cannot measure its own lock has a fault. `agent/test/update-busy-writer.test.ts` and `server/test/update-converge.test.ts`
 *  run the real `ccd/ccrc` under a held lock and pin this prefix to the line it prints. */
export const UPDATE_LOCK_HELD_PREFIX = 'ccrc: update: another update holds ~/.ccrc/update.lock';
/** True iff `line` — the parent's FIRST stderr line, as `firstStderrLine` cleans it — is the lock-held sentence. */
export function isUpdateLockHeldLine(line: string): boolean {
  return line.startsWith(UPDATE_LOCK_HELD_PREFIX);
}

/** What one `process.kill(pid, 0)` did: it returned, or it threw with this errno code (`null`: a throw without a
 *  string code). Each ROLE supplies the adapter that makes one — L0 imports nothing, not even `node:*`. */
export type KillProbeOutcome = { threw: false } | { threw: true; code: string | null };

/** D-3411 — THE liveness rule, over the outcome of `kill(pid, 0)`. A call that returns is a live writer, and so is
 *  `EPERM` (the process exists and is somebody else's). Only `ESRCH` is dead. Any OTHER failure proves nothing about
 *  the writer, so it reads alive: today's `busy`, the direction that never spawns a second updater onto a run this
 *  box could not measure. A report whose pid is absent or unreadable never reaches this function; its caller keeps
 *  `busy`. A pid the kernel has REUSED reads alive (D-3411 names the cost). */
export function updateWriterAlive(outcome: KillProbeOutcome): boolean {
  return !outcome.threw || outcome.code !== 'ESRCH';
}

/** D-3411 — the way out a `busy` detail ends with, on both roles: a live updater (or a lock holder that writes no
 *  report, a hung `versions --prune`) answers busy on every sweep, so the exit is to ack the row or mend the box
 *  (ruling (b)). ONE constant, ONE cutter (`withBusyAdvice`): a `busy` detail is never built without it. */
const BUSY_ADVICE = ' - a live updater that hangs answers busy on every sweep: ack the row or mend the box';
/** `head` cut to fit, then the advice: the FRONT is cut so the advice at the end is never the part that is lost, and
 *  the whole stays within `UPDATE_OP_DETAIL_MAX`. */
function withBusyAdvice(head: string): string {
  return head.slice(0, UPDATE_OP_DETAIL_MAX - BUSY_ADVICE.length) + BUSY_ADVICE;
}

/** D-3411 — the busy sentence for an in-flight report, built ONCE for both roles (the agent's `update` op and the
 *  server-role local spawn). It names the phase, target, start second and the WRITER's pid, then says what the
 *  operator can do (`withBusyAdvice`). A `target` has no length cap on its numeric parts, so the FRONT is cut. */
export function inFlightBusyDetail(r: InFlightReport): string {
  return withBusyAdvice(`update.json says ${r.phase} (target ${r.target ?? 'none'}, started ${r.startedAtS ?? 'unknown'}, writer pid ${r.pid ?? 'unknown'})`);
}

/** The busy sentence for a LOCK-held refusal: the parent's lock line (`isUpdateLockHeldLine` true) with the same way
 *  out. A holder that hangs without ever writing a report (a hung watchdog hold, `versions --prune`) answers busy on
 *  every sweep, so the line alone would leave the operator with no exit named. The line's tail is cut, never the advice. */
export function lockHeldBusyDetail(line: string): string {
  return withBusyAdvice(line);
}

/** D-3411 — whether an in-flight report's writer may still be running, the ONE composition both roles use: a `null`
 *  pid (absent or unreadable) is not dead, so it may, and a readable pid is asked through the role's own `kill(pid, 0)`
 *  adapter (`probe`) and judged by `updateWriterAlive`. L0 imports nothing, so the adapter is passed in. */
export function updateWriterMayLive(pid: number | null, probe: (pid: number) => KillProbeOutcome): boolean {
  return pid === null || updateWriterAlive(probe(pid));
}

// ── the bound's outcome, by attributed re-measurement (D-3400 amended, D-3413; fix round 1 item 2) ──────────
// A `--detach` parent that outlives `UPDATE_SPAWN_TIMEOUT_MS` is killed (its whole group), and neither role may then
// GUESS what it did. Each role reads `update.json` BEFORE the spawn and AFTER the kill and hands both reads, the
// parent's stdout (read to EOF, or `null`), its pid and the lease's tag to `decideKilledSpawn`, the ONE decision.

/** One bounded read of `update.json`, in three values that are never folded: its text, proven absent, or unreadable
 *  (any other failure, a non-regular file, over the cap, past the deadline). */
export type UpdateReportRead = { kind: 'bytes'; text: string } | { kind: 'absent' } | { kind: 'unreadable' };

/** The first words of the two stdout lines the `--detach` parent can print BEFORE it is stopped, declared once and
 *  tied to `ccd/ccrc` by a source scan (`server/test/update-killed-arms.test.ts`): `_upd_phase`'s WARN when it could
 *  not write `update.json`, and `_upd_detach`'s success line. Either one on stdout means the parent got further than
 *  arm A may assume (a queued write that WARNed, or a unit that was started), so the outcome cannot be arm A. */
export const UPDATE_PHASE_WARN_PREFIX = 'update: WARN: could not write ~/.ccrc/update.json';
export const UPDATE_DETACHED_PREFIX = 'update: detached';

/** The report's WRITER and TARGET, read by name from any one-line JSON object, or `null` when the text is not one.
 *  Not `inFlightReport`: the killed parent's own report may already be in a non-in-flight phase (`failed`), and it is
 *  still the parent's. `pid` follows `inFlightReport`'s rule (a positive safe integer, else `null`). */
function reportWriter(text: string): { pid: number | null; target: string | null } | null {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  return {
    pid: typeof d.pid === 'number' && Number.isSafeInteger(d.pid) && d.pid > 0 ? d.pid : null,
    target: isReleaseTag(d.target) ? d.target : null,
  };
}

/** The verdict on a KILLED spawn. `A` releases the lease `idle` (the request stands, nothing started): it travels as
 *  `not-queued`. `B` and `D` HOLD it (as `accepted`); the detail is what the row reads. */
export type KilledSpawnVerdict = { arm: 'A' | 'B' | 'D'; detail: string };

const stdoutHas = (stdout: string, prefix: string): boolean => stdout.split('\n').some((l) => l.startsWith(prefix));
const clip = (s: string): string => s.slice(0, UPDATE_OP_DETAIL_MAX);

/** D-3400 (amended), D-3413 — the arms, decided A, then B, then D, and only A ever releases:
 *  A. `before` and `after` are both READABLE and byte-identical (or absent at both), and `stdout`, read to EOF, has
 *     neither the WARN line nor the `detached` line. The parent was stopped before its `queued` write, which comes
 *     before `systemd-run`, so nothing was queued or started.
 *  B. `after` names the killed parent's own `pid` AND the lease's `tag`: it queued (the run may have started).
 *  D. anything else: unreadable, a change that is not the parent's, the WARN or `detached` line, no EOF. A change that
 *     is not the parent's cannot prove our unit never started (our own `queued` may be what was overwritten).
 *  Every detail is one line within `UPDATE_OP_DETAIL_MAX`, and says what happened. */
export function decideKilledSpawn(i: {
  before: UpdateReportRead; after: UpdateReportRead; stdout: string | null; pid: number | null; tag: string;
}): KilledSpawnVerdict {
  const { before, after, stdout, pid, tag } = i;
  const bound = `${UPDATE_SPAWN_TIMEOUT_MS} ms`;
  const warned = stdout !== null && stdoutHas(stdout, UPDATE_PHASE_WARN_PREFIX);
  const detached = stdout !== null && stdoutHas(stdout, UPDATE_DETACHED_PREFIX);
  const unchanged =
    (before.kind === 'absent' && after.kind === 'absent') ||
    (before.kind === 'bytes' && after.kind === 'bytes' && before.text === after.text);
  if (unchanged && stdout !== null && !warned && !detached) {
    return { arm: 'A', detail: `the --detach parent was stopped at the ${bound} bound before it queued anything; nothing started` };
  }
  const written = after.kind === 'bytes' ? reportWriter(after.text) : null;
  if (written !== null && pid !== null && written.pid === pid && written.target === tag) {
    return { arm: 'B', detail: clip(`the --detach parent was stopped at the ${bound} bound after it queued ${tag} (pid ${pid}); the run may have started, lease held`) };
  }
  const seen: string[] = [];
  if (before.kind === 'unreadable' && after.kind === 'unreadable') seen.push('update.json was unreadable before and after');
  else if (before.kind === 'unreadable') seen.push('update.json was unreadable before the spawn');
  else if (after.kind === 'unreadable') seen.push('update.json was unreadable after the stop');
  // "Changed" is only a fact when the snapshot was readable: an unreadable before compares with nothing.
  if (after.kind === 'bytes' && before.kind !== 'unreadable' && !unchanged) {
    // The parent's OWN pid with another target is the parent's report for another move (arm B took our tag), never
    // "not by the parent" — that sentence is for a pid that is not the parent's (or that could not be compared).
    seen.push(written === null ? 'update.json changed to something unparseable'
      : pid !== null && written.pid === pid
        ? `update.json changed to the parent's report for another target (${written.target ?? 'none'})`
        : `update.json changed, but not by the parent (pid ${written.pid ?? 'unknown'}, target ${written.target ?? 'none'})`);
  }
  if (after.kind === 'absent' && before.kind === 'bytes') seen.push('update.json was removed');
  if (warned) seen.push('the parent printed the update.json WARN');
  if (detached) seen.push("the parent printed 'detached'");
  if (stdout === null) seen.push('its stdout did not reach EOF');
  // One line within UPDATE_OP_DETAIL_MAX, and the ending (that it could not be attributed, and what happens to the lease, naming the move)
  // is never the part that is lost: reasons are taken whole, in order, while they fit, and the rest are counted. The head
  // is short so an ordinary tag and pid fit whole; a reason that still cannot fit (the longest tag the ingress admits,
  // twice) is cut only with `...`, never mid-token unmarked, and the count of those left out rides after it.
  const head = 'stopped at the bound; ';
  const tail = ` - it could not be attributed; lease for ${tag} held until the report or deadline`;
  const budget = Math.max(0, UPDATE_OP_DETAIL_MAX - head.length - tail.length);
  let taken = 0;
  let text = '';
  for (const reason of seen) {
    const next = taken === 0 ? reason : `${text}, ${reason}`;
    if (next.length + (taken + 1 < seen.length ? ` (+${seen.length - taken - 1} more)`.length : 0) > budget) break;
    text = next;
    taken += 1;
  }
  if (taken === 0) {
    const more = seen.length > 1 ? ` (+${seen.length - 1} more)` : '';
    text = `${seen[0]!.slice(0, Math.max(0, budget - more.length - 3))}...${more}`;
  } else if (taken < seen.length) text += ` (+${seen.length - taken} more)`;
  return { arm: 'D', detail: head + text + tail };
}

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
