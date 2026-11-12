// THROWAWAY (Task C29, D-8354): watch the processes under one parent pid, and dump the state of any that has lived
// past 8 s: ps of its group, lsof of every member (its pipes), and a `sample` of each. Runs until killed.
// Removed before the wave-done.   node watch.mjs <parent pid> <label>
import { spawnSync } from 'node:child_process';

const [, , parent, label = 'watch'] = process.argv;
const seen = new Set();
const etimeS = (e) => {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(e.trim());
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + Number(m[3]) * 60 + Number(m[4]);
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (;;) {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,etime=,stat=,command='], { encoding: 'utf8' }).stdout ?? '';
  for (const line of ps.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 5 || f[1] !== parent) continue;
    const [pid, , pgid, et] = f;
    if (etimeS(et) < 8 || seen.has(pid)) continue;
    seen.add(pid);
    let out = `=== WATCH ${label}: child ${pid} of ${parent} alive ${et}\n`;
    out += spawnSync('ps', ['-o', 'pid,ppid,pgid,etime,stat,time,wchan,command', '-g', pgid], { encoding: 'utf8' }).stdout;
    const members = spawnSync('pgrep', ['-g', pgid], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    for (const m of members) {
      out += `--- lsof -p ${m}\n` + (spawnSync('lsof', ['-p', m], { encoding: 'utf8', timeout: 20_000 }).stdout ?? '')
        .split('\n').filter((l) => /PIPE|FIFO|unix|COMMAND| [0-2][urw] /.test(l)).join('\n') + '\n';
    }
    out += `--- lsof -p ${parent} (pipes)\n` + (spawnSync('lsof', ['-p', parent], { encoding: 'utf8', timeout: 20_000 }).stdout ?? '')
      .split('\n').filter((l) => /PIPE|FIFO/.test(l)).join('\n') + '\n';
    for (const m of [parent, ...members]) {
      const s = spawnSync('sample', [m, '2'], { encoding: 'utf8', timeout: 30_000 });
      out += `--- sample ${m}\n${(s.stdout ?? '').split('\n').filter((l) => /\+|Call graph|Thread/.test(l)).slice(0, 60).join('\n')}\n`;
    }
    console.log(out);
  }
  sleep(1000);
}
