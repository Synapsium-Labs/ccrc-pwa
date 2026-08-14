// Wire protocol between ccrc-server (RemoteFleet client, T3) and ccrc-agent
// (T2) — a small authenticated WS surface exposing a whitelisted
// exec/file/tail/pty API on a REMOTE fleet host. Single source of truth for
// both sides; copied verbatim per the plan's pinned interfaces.

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
 *  has no per-capability negotiation to fall back on the way this one does. */
export interface AgentReady { t: 'ready'; v: 1; ccdVerbs?: string[] }

/** `ccd caps` output -> the list both readers keep: one token per non-empty
 *  line shaped like a bash identifier (`/^[a-z][a-z-]*$/`) — verbs AND
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
  return stdout.split('\n').map((l) => l.trim()).filter((l) => /^[a-z][a-z-]*$/.test(l));
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
// exec → {code, stdout, stderr}; read → {data: string|null}; readFrom → {data: string, size: number}|{data: null};
// readB64 → {dataB64: string|null}; readdir → {names: string[]|null}; stat → {mtimeMs, size}|{missing: true};
// writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}; caps → {verbs: string[]}
export interface TailData  { t: 'tail'; tailId: number; dataB64: string }       // appended bytes
export interface TailReset { t: 'tail'; tailId: number; reset: true; size: number } // file truncated/rotated
export interface PtyData   { t: 'pty'; ptyId: number; ev: 'data'; dataB64: string }
export interface PtyExit   { t: 'pty'; ptyId: number; ev: 'exit' }
export interface Ping { t: 'ping' }  export interface Pong { t: 'pong' }
