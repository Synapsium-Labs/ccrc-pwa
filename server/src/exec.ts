import { execFile } from 'node:child_process';

export interface ExecResult { code: number; stdout: string; stderr: string }
export type Runner = (cmd: string, args: string[]) => Promise<ExecResult>;

export const realRunner: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined ?? 1) : 0;
      resolve({ code: typeof code === 'number' ? code : 1, stdout: String(stdout), stderr: String(stderr) });
    });
  });

const target = (id: string) => `cc-${id}`;

export class Tmux {
  constructor(private run: Runner) {}
  async hasSession(id: string): Promise<boolean> {
    return (await this.run('tmux', ['has-session', '-t', target(id)])).code === 0;
  }
  async panePid(id: string): Promise<number | null> {
    const r = await this.run('tmux', ['list-panes', '-t', target(id), '-F', '#{pane_pid}']);
    if (r.code !== 0) return null;
    const pid = parseInt(r.stdout.trim().split('\n')[0] ?? '', 10);
    return Number.isFinite(pid) ? pid : null;
  }
  async capture(id: string): Promise<string | null> {
    const r = await this.run('tmux', ['capture-pane', '-t', target(id), '-p']);
    return r.code === 0 ? r.stdout : null;
  }
  /** Capture WITH escape sequences (`-e`) — needed to tell Claude Code's dim
   *  ghost-suggestion placeholder (`\e[2m…\e[0m`) apart from a real typed draft. */
  async captureAnsi(id: string): Promise<string | null> {
    const r = await this.run('tmux', ['capture-pane', '-t', target(id), '-p', '-e']);
    return r.code === 0 ? r.stdout : null;
  }
  async sendLiteral(id: string, text: string): Promise<boolean> {
    return (await this.run('tmux', ['send-keys', '-t', target(id), '-l', text])).code === 0;
  }
  async sendKey(id: string, key: string): Promise<boolean> {
    return (await this.run('tmux', ['send-keys', '-t', target(id), key])).code === 0;
  }
  /** Restore the canonical size ccd spawned with. Lived inline at
   *  server.ts:218 as a `void deps.run(...)` — so a `forbidden` there was
   *  swallowed in silence, which is the exact failure the argv enumeration
   *  exists to prevent. */
  async resizeWindow(id: string, cols: number, rows: number): Promise<boolean> {
    return (await this.run('tmux', ['resize-window', '-t', target(id), '-x', String(cols), '-y', String(rows)])).code === 0;
  }
}
