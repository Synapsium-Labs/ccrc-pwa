// The Windows arm of spawnSyncGroup's bound (spawnGroup.ts): `node winTreeKill.cjs <ms> <cmd> [args…]` runs the command
// with this process's stdio and, if it outlives <ms>, kills its whole process tree (`taskkill /T /F`) and exits
// TIMED_OUT. Node's own spawnSync timeout kills the direct child only, and on Windows a child's children keep the pipes
// open, so a hung hook (an MSYS2 bash and its subshells) stalled a run for 40 minutes (measured, Go core wave 2 Task 9b).
const { spawn, execFileSync } = require('node:child_process');

const TIMED_OUT = 3221;
const [ms, cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true });
const timer = setTimeout(() => {
  try { execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' }); } catch { /* gone already */ }
  process.exit(TIMED_OUT);
}, Number(ms));
child.on('error', (e) => { clearTimeout(timer); process.stderr.write(`winTreeKill: ${e.message}\n`); process.exit(127); });
child.on('exit', (code) => { clearTimeout(timer); process.exit(code ?? 1); });
