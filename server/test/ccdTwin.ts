import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, HARNESS_BASH, type CcdHarness } from './ccdWsHelpers.js';
import { coreBinary } from './coreBuild.js';
import { assertFencedEnv } from './pathFence.js';

export type Impl = 'bash' | 'go';
export const IMPLS: readonly Impl[] = ['bash', 'go'];

/** The built core laid out as installed: `<dir>/core/ccrc-core` with the repo's body at `<dir>/ccd`, so a verb that
 *  reads ../ccd reads the body bash runs. */
function installedCore(): string {
  const exe = coreBinary();
  const body = path.join(path.dirname(path.dirname(exe)), 'ccd');
  if (!fs.existsSync(body)) fs.copyFileSync(CCD, body);
  return exe;
}

/** Run ccd's bash body or the Go core, the same way, on one fixture: what a parity test compares. */
export function runImpl(h: CcdHarness, impl: Impl, argv: string[], extra: NodeJS.ProcessEnv = {}) {
  const [cmd, pre] = impl === 'bash' ? [HARNESS_BASH, [CCD]] : [installedCore(), ['ccd']];
  const env = h.env(extra);
  assertFencedEnv(env); // the Windows guard (pathFence.ts): a harness env outside its fixture throws before the start
  const r = spawnSync(cmd, [...pre, ...argv], { cwd: h.home, env, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
