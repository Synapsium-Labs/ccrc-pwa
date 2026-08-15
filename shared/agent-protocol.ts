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
/** `rosterFp` is `bodyDigest` (shared/mark.mjs) of the fleet host's INSTALLED
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
 *  absent must read as "no evidence either way", never as "divergent". */
export interface AgentReady { t: 'ready'; v: 1; ccdVerbs?: string[]; rosterFp?: string }
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
