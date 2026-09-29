import { spawn, type IPty } from 'node-pty';
import { tmuxTarget } from '../../shared/tmux-target.js';

/**
 * Subset of node-pty's IPty the WS drawer bridge uses. Typing the injected
 * `spawnPty` dep against this lets tests stub the pty without pulling in the
 * native module; the real `attachPty` returns a full IPty, which satisfies it.
 */
export interface PtyLike {
  onData(listener: (data: string) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnPty = (id: string, cols: number, rows: number) => PtyLike;

/** Attach a real pty to the session's tmux window for the terminal drawer.
 *  EXACTLY that session (D-3525): a bare `cc-<id>` is a tmux prefix search, and
 *  with `cc-<id>` gone it attached the drawer to a live `cc-<id>-…` sibling. */
export function attachPty(id: string, cols: number, rows: number): IPty {
  return spawn('tmux', ['attach', '-t', tmuxTarget(id)], {
    name: 'xterm-256color',
    cols,
    rows,
    env: process.env,
  });
}
