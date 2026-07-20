import { describe, it, expect } from 'vitest';
import { Tmux, type Runner, type ExecResult } from '../src/exec.js';

const fake = (responses: Record<string, ExecResult>): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return responses[args[0]] ?? { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

describe('Tmux', () => {
  it('hasSession true on code 0, false otherwise', async () => {
    const ok = new Tmux(fake({ 'has-session': { code: 0, stdout: '', stderr: '' } }).run);
    expect(await ok.hasSession('claude2-MekWarLive')).toBe(true);
    const no = new Tmux(fake({ 'has-session': { code: 1, stdout: '', stderr: '' } }).run);
    expect(await no.hasSession('claude2-MekWarLive')).toBe(false);
  });
  it('panePid parses first pane pid', async () => {
    const t = new Tmux(fake({ 'list-panes': { code: 0, stdout: '40613\n', stderr: '' } }).run);
    expect(await t.panePid('x')).toBe(40613);
  });
  it('targets cc-<id> and sends literals with -l', async () => {
    const f = fake({});
    await new Tmux(f.run).sendLiteral('myid', 'hello');
    expect(f.calls[0]).toEqual(['tmux', 'send-keys', '-t', 'cc-myid', '-l', 'hello']);
  });
});
