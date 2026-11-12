// THROWAWAY (Task C29, D-8354): repeat a spawnSync with a large stdin on macOS, the way childCpu runs its jq
// (detached, input on stdin, a timeout), and count the runs that time out. A side watcher (watch.mjs) dumps the
// state of any child that lives past 8 s. Removed before the wave-done. Run from server/.
//   node ../.github/c29-darwin-probe/syncspawn.mjs <iterations> <label> <jq|cat> <detached|attached> [kb]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , itersArg = '100', label = 'plain', what = 'jq', att = 'detached', kbArg = '128'] = process.argv;
const ITERS = Number(itersArg);
const KB = Number(kbArg);
const HOOK = path.resolve('../ccd/session-hook.sh');
const prog = (/^APPROVAL_FORBIDDEN_JQ='([^']*)'$/m.exec(fs.readFileSync(HOOK, 'utf8')) ?? [])[1] ?? '';
const unit = '$(x) `y` ';
const dense = unit.repeat(Math.floor((KB * 1024) / unit.length));
const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: `git worktree list --porcelain; echo prune "${dense}"` } });
const argv = what === 'jq'
  ? ['-c', '"$@"; s=$?; times >&2; exit $s', 'bash', 'jq', '-r', '--arg', 'q', "'", '--arg', 'mode', 'deny', prog]
  : ['-c', 'cat >/dev/null; s=$?; times >&2; exit $s'];
let timeouts = 0, other = 0, maxWall = 0;
const walls = [];
for (let i = 1; i <= ITERS; i++) {
  const t0 = Date.now();
  const r = spawnSync('bash', argv, { input, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 20_000, detached: att === 'detached', env: { ...process.env, LC_ALL: 'C' } });
  const wall = Date.now() - t0;
  walls.push(wall); maxWall = Math.max(maxWall, wall);
  if (r.pid) { try { process.kill(-r.pid, 'SIGKILL'); } catch { /* gone */ } }
  const ok = r.status === 0 && /\d+m[\d.]+s \d+m[\d.]+s\n?$/.test(r.stderr ?? '');
  if (r.error && r.error.code === 'ETIMEDOUT') {
    timeouts++;
    console.log(`=== ${label} iter ${i} TIMEOUT pid=${r.pid} wall=${wall} stderr=${JSON.stringify((r.stderr ?? '').slice(0, 200))} stdout=${JSON.stringify((r.stdout ?? '').slice(0, 200))}`);
  } else if (!ok) {
    other++;
    console.log(`=== ${label} iter ${i} BAD status=${r.status} signal=${r.signal} err=${r.error} wall=${wall} stderr=${JSON.stringify((r.stderr ?? '').slice(0, 300))}`);
  }
}
walls.sort((a, b) => a - b);
console.log(`SYNCSPAWN ${label} ${what} ${att} ${KB}KB: n=${ITERS} timeouts=${timeouts} other=${other} wall p50=${walls[Math.floor(ITERS / 2)]} p99=${walls[Math.floor(ITERS * 0.99)]} max=${maxWall}`);
