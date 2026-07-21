import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import type { Deps } from '../src/server.js';

/** Deps against a throwaway fixture home; default runner fails every exec (all sessions dead). */
export function testDeps(
  home: string = mkdtempSync(path.join(tmpdir(), 'ccrc-')),
  run: Runner = async () => ({ code: 1, stdout: '', stderr: '' }),
): Deps {
  return { cfg: loadConfig({ CCRC_HOME: home }), run, tmux: new Tmux(run), io: localIO };
}
