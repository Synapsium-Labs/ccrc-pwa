// ccd owns worktree lifecycle beside the tmux and systemd lifecycle it already
// owns. These tests source ccd under an isolated HOME, exactly as
// ccd-limits.test.ts does, so nothing here can touch the real registry.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const CCD = path.resolve(__dirname, '../../../ccrc-portability/ccd');
let home: string;

const sh = (snippet: string): string =>
  execFileSync('bash', ['-c', `source "${CCD}"; ${snippet}`],
    { encoding: 'utf8', env: { ...process.env, HOME: home } }).trim();

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-ccd-ws-'));
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
  const bin = path.join(home, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const w of ['claude', 'claude2', 'claude-corp']) {
    fs.writeFileSync(path.join(bin, w), '#!/bin/sh\n', { mode: 0o755 });
  }
});

afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const reg = (id: string, field: string): string | null => {
  const p = path.join(home, '.cc-sessions', `${id}.${field}`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
};

describe('home is explicit at creation', () => {
  it('writes home when cmd_start registers a new session', () => {
    fs.mkdirSync(path.join(home, 'projects', 'demo'), { recursive: true });
    // _spawn needs tmux; register only, then assert the field.
    sh(`_reg_set claude2-demo wrapper claude2
        _reg_set claude2-demo project demo
        _ws_seed_home claude2-demo claude2`);
    expect(reg('claude2-demo', 'home')).toBe('claude2');
  });

  it('does not overwrite a home that was already chosen', () => {
    sh(`_reg_set claude2-demo home claude-corp
        _ws_seed_home claude2-demo claude2`);
    expect(reg('claude2-demo', 'home')).toBe('claude-corp');
  });
});

describe('slug rules', () => {
  const ok = (s: string): boolean =>
    sh(`_ws_slug_valid '${s}' && echo yes || echo no`) === 'yes';

  it('accepts lowercase alphanumeric and hyphens', () => {
    expect(ok('quiet-mesa')).toBe(true);
    expect(ok('a1')).toBe(true);
  });

  it('rejects dots, because tmux -t reads session:window.pane', () => {
    expect(ok('quiet.mesa')).toBe(false);
  });

  it('rejects slashes, because systemd instance names escape them', () => {
    expect(ok('feat/thing')).toBe(false);
  });

  it('rejects a leading hyphen, uppercase, and over-length', () => {
    expect(ok('-mesa')).toBe(false);
    expect(ok('Quiet-Mesa')).toBe(false);
    expect(ok('a'.repeat(32))).toBe(false);
  });

  it('generates a slug that is itself valid', () => {
    const slug = sh(`_ws_slug_new demo`);
    expect(sh(`_ws_slug_valid '${slug}' && echo yes || echo no`)).toBe('yes');
  });

  it('never collides with an existing registry entry', () => {
    // Pin the generator to one candidate, then occupy it.
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-mesa.uuid'), 'x');
    const slug = sh(`CCD_WS_SLUG=quiet-mesa _ws_slug_new demo || echo EXHAUSTED`);
    expect(slug).toBe('EXHAUSTED');
  });

  it('honours CCD_WS_SLUG when the name is free', () => {
    expect(sh(`CCD_WS_SLUG=quiet-mesa _ws_slug_new demo`)).toBe('quiet-mesa');
  });
});
