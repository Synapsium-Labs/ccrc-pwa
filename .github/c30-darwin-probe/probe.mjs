// THROWAWAY (Task C30, D-8381): repeat spawnSyncGroup (server/test/spawnGroup.ts, loaded through node's type
// stripping) with an `input` on macOS, and count the runs that time out. `ctl` is a plain detached spawnSync with
// `input`, the shape C29 measured, as a same-runner control. Removed before the wave-done. Run from server/.
//   node --experimental-strip-types ../.github/c30-darwin-probe/probe.mjs <iterations> <label> <bytes> [group|ctl]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSyncGroup } from '../../server/test/spawnGroup.ts';

const [, , itersArg = '100', label = 'plain', bytesArg = '131072', how = 'group'] = process.argv;
const ITERS = Number(itersArg);
const BYTES = Number(bytesArg);
const input = 'x'.repeat(BYTES);
const script = 'n=$(wc -c); s=$?; echo "$n"; times >&2; exit $s';
let timeouts = 0, other = 0, maxWall = 0;
const walls = [];
const before = new Set(fs.readdirSync(os.tmpdir()));
for (let i = 1; i <= ITERS; i++) {
  const t0 = Date.now();
  const opts = { input, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 20_000, env: { ...process.env, LC_ALL: 'C' } };
  let r;
  try {
    r = how === 'ctl' ? spawnSync('bash', ['-c', script], { ...opts, detached: true }) : spawnSyncGroup('bash', ['-c', script], opts);
  } catch (e) {
    other++; console.log(`=== ${label} iter ${i} THROW ${String(e).slice(0, 300)}`); continue;
  }
  if (how === 'ctl' && r.pid) { try { process.kill(-r.pid, 'SIGKILL'); } catch { /* gone */ } }
  const wall = Date.now() - t0;
  walls.push(wall); maxWall = Math.max(maxWall, wall);
  if (r.error && r.error.code === 'ETIMEDOUT') {
    timeouts++;
    console.log(`=== ${label} iter ${i} TIMEOUT pid=${r.pid} wall=${wall} stdout=${JSON.stringify((r.stdout ?? '').slice(0, 200))} stderr=${JSON.stringify((r.stderr ?? '').slice(0, 200))}`);
  } else if (r.status !== 0 || (r.stdout ?? '').trim() !== String(BYTES)) {
    other++;
    console.log(`=== ${label} iter ${i} BAD status=${r.status} signal=${r.signal} err=${r.error} wall=${wall} stdout=${JSON.stringify((r.stdout ?? '').slice(0, 100))} stderr=${JSON.stringify((r.stderr ?? '').slice(0, 300))}`);
  }
}
const left = fs.readdirSync(os.tmpdir()).filter((e) => !before.has(e) && /spawn/i.test(e));
walls.sort((a, b) => a - b);
console.log(`PROBE ${label} ${how} ${BYTES}B: n=${ITERS} timeouts=${timeouts} other=${other} tmp-left=${left.length} wall p50=${walls[Math.floor(walls.length / 2)]} p99=${walls[Math.floor(walls.length * 0.99)]} max=${maxWall}`);
