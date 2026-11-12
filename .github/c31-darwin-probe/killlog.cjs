// THROWAWAY (Task C31, D-8391): a NODE_OPTIONS preload that logs every
// process.kill and ChildProcess#kill that sends a signal, with the sender.
'use strict';
const fs = require('node:fs');
const cp = require('node:child_process');
const log = process.env.C31_KILL_LOG;
if (log) {
  const note = (how, pid, sig) => {
    if (sig === 0 || sig === '0') return;
    const where = (new Error().stack || '').split('\n').slice(2, 6).map((l) => l.trim()).join(' | ');
    try { fs.appendFileSync(log, `${Date.now() / 1000} node sender=${process.pid} ppid=${process.ppid} src=${process.argv[1] || ''} ${how} ${pid} ${sig ?? 'SIGTERM'} @ ${where}\n`); } catch {}
  };
  const pk = process.kill.bind(process);
  process.kill = (pid, sig) => { note('process.kill', pid, sig); return pk(pid, sig); };
  const ck = cp.ChildProcess.prototype.kill;
  cp.ChildProcess.prototype.kill = function (sig) { note('child.kill', this.pid, sig); return ck.call(this, sig); };
}
