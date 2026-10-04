// ccrcContainment.ts — the env every ccrc test builder, and every raw spawn of the real `ccd/ccrc`, starts from
// (wave 9 R10d, D-3818). The poison list and the checker live in `containedTools.ts`; this file is the one place
// that composes them with `ghContainedEnv`. It imports `ccdWsHelpers.ts`, which reaches vitest, so the vitest-free
// `installTreeFixture.ts` may NOT import it (that file imports `containedTools.ts` only).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
import { plantPoison, loopbackCurlFront } from './containedTools.js';

/** The env every ccrc test builder, and every raw spawn of the real ccd/ccrc, starts from (wave 9 R10d): `base` with
 *  HOME the fixture, the user bus pointed at two paths under HOME that do not exist — SET, never deleted: ccrc's
 *  `: "${XDG_RUNTIME_DIR:=/run/user/$UID}"` (seven pairs in ccd/ccrc, :3037 first) would otherwise default to the REAL
 *  bus — then gh and tmux poisons from `ghContainedEnv`, and ssh, scp and launchctl poisons and the curl rule beside
 *  them, all create-if-absent in `harnessBin(home)`, first on PATH.
 *  `managers: true` also asks `ghContainedEnv` for its systemctl/systemd-run/launchctl poisons. A SPINE builder passes
 *  false: it fronts its own pair after `adoptPlantedSystemd`, which would rename an unmarked poison to a `.codex-*`
 *  delegate its fronts forward to (codexLaneFixture.ts's SPINE_DELEGATES) — every `--detach` systemd-run would answer
 *  97 and `_svc_have_user_manager` would fall back to nohup. `assertSpineFrontContained` pins those builders' managers. */
export function ccrcContainedEnv(home: string, base: NodeJS.ProcessEnv,
  opts: { managers: boolean; curl: 'poison' | 'loopback' }): NodeJS.ProcessEnv {
  const env = ghContainedEnv(home, {
    ...base, HOME: home,
    XDG_RUNTIME_DIR: path.join(home, 'no-runtime-dir'),
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(home, 'no-bus')}`,
  }, opts.managers ? { systemd: true, tmux: true } : { tmux: true });
  const bin = harnessBin(home);
  for (const n of ['ssh', 'scp', 'launchctl']) plantPoison(bin, n);
  if (opts.curl === 'poison') {
    plantPoison(bin, 'curl');
  } else if (!fs.existsSync(path.join(bin, 'curl'))) {
    // The REAL curl, resolved once through the parent's PATH — this process's own, never the case's env.
    const found = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'curl'), loopbackCurlFront(found === '' ? '/usr/bin/curl' : found), { mode: 0o755 });
  }
  return env;
}
