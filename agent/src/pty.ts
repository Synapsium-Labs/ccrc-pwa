import { spawn } from 'node-pty';

/**
 * ptyOpen backing implementation — spawns a real node-pty attached to the
 * session's tmux window, mirroring `server/src/pty.ts`'s `attachPty` (same
 * command/args/spawn options): ccrc-agent runs directly on the fleet host
 * that owns the tmux sessions, so `tmux attach -t cc-<sessionId>` here is
 * the REMOTE half of the same terminal-drawer bridge `attachPty` serves
 * locally. Wrapped in a small `PtyProcess` shape (rather than exposing the
 * real `IPty` directly) so tests can inject a fake spawn with no native
 * dependency or real tmux session required.
 */
export interface PtyProcess {
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: () => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type PtySpawn = (sessionId: string, cols: number, rows: number) => PtyProcess;

const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * ptyOpen's `sessionId` arrives over the wire from ccrc-server — it must be
 * restricted to the same charset `ccd`/tmux window names use before it's
 * ever interpolated into a `tmux attach -t cc-<sessionId>` argv, or a
 * crafted id could target an arbitrary tmux session name on the fleet host.
 */
export function isSessionIdAllowed(sessionId: string): boolean {
  return typeof sessionId === 'string' && SESSION_ID_RE.test(sessionId);
}

export const spawnFleetPty: PtySpawn = (sessionId, cols, rows) => {
  const p = spawn('tmux', ['attach', '-t', `cc-${sessionId}`], {
    name: 'xterm-256color',
    cols,
    rows,
    env: process.env as { [key: string]: string },
  });
  return {
    onData: (listener) => p.onData(listener),
    onExit: (listener) => p.onExit(() => listener()),
    write: (data) => p.write(data),
    resize: (c, r) => p.resize(c, r),
    kill: () => p.kill(),
  };
};
