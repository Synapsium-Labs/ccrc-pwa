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
 *  not read. */
export interface AgentReady { t: 'ready'; v: 1; ccdVerbs?: string[]; rosterFp?: string; build?: BuildInfo }

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
export interface CapsReq   { t: 'req'; id: number; op: 'caps' }
export interface WriteB64Req { t: 'req'; id: number; op: 'writeB64'; path: string; dataB64: string }
export interface TailOpenReq { t: 'req'; id: number; op: 'tailOpen'; path: string; offset: number }
export interface TailCloseReq{ t: 'req'; id: number; op: 'tailClose'; tailId: number }
export interface PtyOpenReq  { t: 'req'; id: number; op: 'ptyOpen'; sessionId: string; cols: number; rows: number }
export interface PtyInput    { t: 'pty'; ptyId: number; ev: 'input'; dataB64: string }
export interface PtyResize   { t: 'pty'; ptyId: number; ev: 'resize'; cols: number; rows: number }
export interface PtyClose    { t: 'pty'; ptyId: number; ev: 'close' }
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq|CapsReq;
export interface ResOk  { t: 'res'; id: number; ok: true;  [k: string]: unknown } // op-specific payload fields below
export interface ResErr { t: 'res'; id: number; ok: false; err: string }
// exec → {code, stdout, stderr}; read → {data: string|null, absent?: true}; readFrom → {data: string, size: number}|{data: null};
// readB64 → {dataB64: string|null}; readdir → {names: string[]|null}; stat → {mtimeMs, size}|{missing: true, absent?: true};
// writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}; caps → {verbs: string[]}
export interface TailData  { t: 'tail'; tailId: number; dataB64: string }       // appended bytes
export interface TailReset { t: 'tail'; tailId: number; reset: true; size: number } // file truncated/rotated
export interface PtyData   { t: 'pty'; ptyId: number; ev: 'data'; dataB64: string }
export interface PtyExit   { t: 'pty'; ptyId: number; ev: 'exit' }
export interface Ping { t: 'ping' }  export interface Pong { t: 'pong' }
