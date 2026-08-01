// Wire protocol between ccrc-server (RemoteFleet client, T3) and ccrc-agent
// (T2) — a small authenticated WS surface exposing a whitelisted
// exec/file/tail/pty API on a REMOTE fleet host. Single source of truth for
// both sides; copied verbatim per the plan's pinned interfaces.

export interface AgentHello { t: 'hello'; token: string }
/** `ccdVerbs` is what `ccd caps` printed on the AGENT's box at start —
 *  ~/.local/bin/ccd is a copy, not a symlink to the repo, so passing the
 *  whitelist is not evidence a verb exists there. Optional: an older agent
 *  omits it, and the server treats absent as "no evidence either way". */
export interface AgentReady { t: 'ready'; v: 1; ccdVerbs?: string[] }
export interface ExecReq   { t: 'req'; id: number; op: 'exec'; cmd: string; args: string[]; timeoutMs?: number }
export interface ReadReq   { t: 'req'; id: number; op: 'read'; path: string }
export interface ReadFromReq { t: 'req'; id: number; op: 'readFrom'; path: string; offset: number }
export interface ReadB64Req { t: 'req'; id: number; op: 'readB64'; path: string }
export interface ReaddirReq{ t: 'req'; id: number; op: 'readdir'; path: string }
export interface StatReq   { t: 'req'; id: number; op: 'stat'; path: string }
export interface WriteB64Req { t: 'req'; id: number; op: 'writeB64'; path: string; dataB64: string }
export interface TailOpenReq { t: 'req'; id: number; op: 'tailOpen'; path: string; offset: number }
export interface TailCloseReq{ t: 'req'; id: number; op: 'tailClose'; tailId: number }
export interface PtyOpenReq  { t: 'req'; id: number; op: 'ptyOpen'; sessionId: string; cols: number; rows: number }
export interface PtyInput    { t: 'pty'; ptyId: number; ev: 'input'; dataB64: string }
export interface PtyResize   { t: 'pty'; ptyId: number; ev: 'resize'; cols: number; rows: number }
export interface PtyClose    { t: 'pty'; ptyId: number; ev: 'close' }
export type AgentReq = ExecReq|ReadReq|ReadFromReq|ReadB64Req|ReaddirReq|StatReq|WriteB64Req|TailOpenReq|TailCloseReq|PtyOpenReq;
export interface ResOk  { t: 'res'; id: number; ok: true;  [k: string]: unknown } // op-specific payload fields below
export interface ResErr { t: 'res'; id: number; ok: false; err: string }
// exec → {code, stdout, stderr}; read → {data: string|null}; readFrom → {data: string, size: number}|{data: null};
// readB64 → {dataB64: string|null}; readdir → {names: string[]|null}; stat → {mtimeMs, size}|{missing: true};
// writeB64 → {}; tailOpen → {tailId}; ptyOpen → {ptyId}
export interface TailData  { t: 'tail'; tailId: number; dataB64: string }       // appended bytes
export interface TailReset { t: 'tail'; tailId: number; reset: true; size: number } // file truncated/rotated
export interface PtyData   { t: 'pty'; ptyId: number; ev: 'data'; dataB64: string }
export interface PtyExit   { t: 'pty'; ptyId: number; ev: 'exit' }
export interface Ping { t: 'ping' }  export interface Pong { t: 'pong' }
