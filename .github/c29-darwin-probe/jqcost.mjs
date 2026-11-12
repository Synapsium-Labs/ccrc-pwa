// THROWAWAY (Task C29, D-8354): repeat the prune-deny cost case's exact jq invocation on macOS and catch a hang.
// Each run is `bash -c '"$@"; s=$?; times >&2; exit $s' bash jq -r --arg q ' --arg mode <mode> <program>`, the input
// on stdin, in a process group of its own (detached), exactly as childCpu runs it. A run past WATCH_MS is diagnosed
// (ps of its group, `sample` of the jq) and then killed. Removed before the wave-done. Run from server/.
//   node ../.github/c29-darwin-probe/jqcost.mjs <iterations> <label>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [, , itersArg = '20', label = 'plain'] = process.argv;
const ITERS = Number(itersArg);
const WATCH_MS = 20_000;
const HOOK = path.resolve('../ccd/session-hook.sh');
const REF = path.resolve('test/fixtures/prune-deny/forbidden-jq-33e521e07.jq');
const cur = (/^APPROVAL_FORBIDDEN_JQ='([^']*)'$/m.exec(fs.readFileSync(HOOK, 'utf8')) ?? [])[1] ?? '';
const ref = fs.readFileSync(REF, 'utf8');
const input = (unit, quoted, kb) => {
  const dense = unit.repeat(Math.floor((kb * 1024) / unit.length));
  const command = `git worktree list --porcelain; echo prune ${quoted ? `"${dense}"` : dense}`;
  return JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
};
const CASES = [];
for (const [prog, pn] of [[ref, 'ref'], [cur, 'cur']]) {
  for (const kb of [64, 128]) CASES.push({ name: `dqsub/deny/${pn}/${kb}`, prog, mode: 'deny', input: input('$(x) `y` ', true, kb) });
}

const one = (c) => new Promise((resolve) => {
  const t0 = Date.now();
  const ch = spawn('bash', ['-c', '"$@"; s=$?; times >&2; exit $s', 'bash', 'jq', '-r', '--arg', 'q', "'", '--arg', 'mode', c.mode, c.prog],
    { detached: true, env: { ...process.env, LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '', diag = '';
  ch.stdout.on('data', (d) => { out += d; });
  ch.stderr.on('data', (d) => { err += d; });
  ch.stdin.on('error', (e) => { diag += `stdin error ${e.code}\n`; });
  ch.stdin.end(c.input);
  const watch = setTimeout(() => {
    const ps = spawnSync('ps', ['-o', 'pid,ppid,pgid,stat,time,rss,wchan,command', '-g', String(ch.pid)], { encoding: 'utf8' });
    diag += `--- ps of group ${ch.pid} at ${Date.now() - t0} ms\n${ps.stdout}${ps.stderr}`;
    const all = spawnSync('ps', ['-axo', 'pid,pgid,stat,time,rss,command'], { encoding: 'utf8' });
    const jqs = all.stdout.split('\n').filter((l) => / jq /.test(l) || /^\s*PID/.test(l));
    diag += `--- every jq on the box\n${jqs.map((l) => l.slice(0, 160)).join('\n')}\n`;
    const jqPid = all.stdout.split('\n').map((l) => l.trim().split(/\s+/)).find((f) => f[1] === String(ch.pid) && / jq /.test(` ${f.slice(5).join(' ')} `))?.[0];
    if (jqPid) {
      const s = spawnSync('sample', [jqPid, '3'], { encoding: 'utf8', timeout: 30_000 });
      diag += `--- sample ${jqPid}\n${(s.stdout ?? '').split('\n').slice(0, 80).join('\n')}\n${s.stderr ?? ''}`;
    }
    const vm = spawnSync('vm_stat', [], { encoding: 'utf8' });
    diag += `--- vm_stat\n${vm.stdout}`;
    const up = spawnSync('uptime', [], { encoding: 'utf8' });
    diag += `--- uptime ${up.stdout}`;
    try { process.kill(-ch.pid, 'SIGKILL'); } catch { /* gone */ }
  }, WATCH_MS);
  ch.on('close', (status, signal) => {
    clearTimeout(watch);
    const wall = Date.now() - t0;
    const lines = err.replace(/\n$/, '').split('\n');
    const m = /^(\d+)m(\d+(?:\.\d+)?)s (\d+)m(\d+(?:\.\d+)?)s$/.exec(lines.at(-1) ?? '');
    const cpu = m ? Math.round((Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) * 60 + Number(m[4])) * 1000) : null;
    resolve({ status, signal, wall, cpu, out, err, diag });
  });
});

const stats = new Map();
let hung = 0;
for (let i = 1; i <= ITERS; i++) {
  for (const c of CASES) {
    const r = await one(c);
    const s = stats.get(c.name) ?? { n: 0, walls: [], cpus: [], bad: 0 };
    s.n++; s.walls.push(r.wall); if (r.cpu !== null) s.cpus.push(r.cpu);
    const bad = r.status !== 0 || r.cpu === null || r.out.trim() !== '' || r.diag !== '';
    if (bad) {
      s.bad++;
      if (r.diag !== '') hung++;
      console.log(`=== ${label} ${c.name} iter ${i} BAD status=${r.status} signal=${r.signal} wall=${r.wall} cpu=${r.cpu}\nstderr: ${JSON.stringify(r.err.slice(0, 400))}\n${r.diag}`);
    }
    stats.set(c.name, s);
  }
}
const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(q * b.length))] : null; };
for (const [name, s] of stats) {
  console.log(`JQCOST ${label} ${name}: n=${s.n} bad=${s.bad} wall p50=${pct(s.walls, 0.5)} p99=${pct(s.walls, 0.99)} max=${Math.max(...s.walls)} cpu p50=${pct(s.cpus, 0.5)} max=${Math.max(...s.cpus)}`);
}
console.log(`JQCOST ${label}: hung=${hung}`);
