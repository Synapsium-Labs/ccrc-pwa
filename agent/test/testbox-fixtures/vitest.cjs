#!/usr/bin/env node
// The test service's fixture command head (agent/test/testbox-service.test.ts copies it to a fixture package's
// node_modules/.bin/vitest): its --mode= word picks what the run does. It stands in for vitest; no real test runs.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const args = process.argv.slice(2);
const opt = (name) => { const a = args.find((x) => x.startsWith('--' + name + '=')); return a === undefined ? null : a.slice(name.length + 3); };
const mode = opt('mode') ?? 'pass';
const reportPath = opt('outputFile.json');
const report = (failed) => {
  if (reportPath === null) return;
  const file = path.join(process.cwd(), 'test', failed ? 'b.test.ts' : 'a.test.ts');
  fs.writeFileSync(reportPath, JSON.stringify({ testResults: [{ name: file, status: failed ? 'failed' : 'passed',
    assertionResults: [{ fullName: failed ? 'b fails' : 'a passes', status: failed ? 'failed' : 'passed' }] }] }));
};
console.log('workers=' + opt('maxWorkers') + ' env=' + process.env.VITEST_MAX_WORKERS + ',' + process.env.VITEST_MAX_THREADS + ',' + process.env.VITEST_MAX_FORKS);
if (mode === 'pass') { report(false); process.exit(0); }
if (mode === 'fail') { console.error('b fails'); report(true); process.exit(1); }
if (mode === 'env') { console.log('ENV ' + JSON.stringify(Object.keys(process.env).sort())); console.log('HOME ' + JSON.stringify(fs.readdirSync(process.env.HOME))); report(false); process.exit(0); }
if (mode === 'sleep') { console.log('started'); setInterval(() => {}, 1 << 30); return; }
if (mode === 'report-big') { fs.writeFileSync(reportPath, 'x'.repeat(4096)); process.exit(0); }
if (mode === 'report-link') { fs.symlinkSync('/etc/hosts', reportPath); process.exit(0); }
if (mode === 'report-dir') { fs.mkdirSync(reportPath); process.exit(0); }
if (mode === 'report-none') { process.exit(0); }
if (mode === 'socket') {
  // The longest names the suites build (spec §5 row 1): the run-tmp parent's live.sock under realpath(TMPDIR), and a
  // delegation-rig-shaped tmux socket under a literal /tmp.
  const tmp = fs.realpathSync(process.env.TMPDIR);
  const runTmp = fs.mkdtempSync(path.join(tmp, 'ccrc-testrun-'));
  const dlgt = fs.mkdtempSync('/tmp/dlgt-');
  fs.mkdirSync(path.join(dlgt, 'tmux-' + process.getuid()));
  // Each socket is labelled by the directory it was built under, never by a prefix test: where TMPDIR itself lies
  // under /tmp (Linux's default), a prefix test would give both sockets one label.
  const socks = [['TMPDIR', path.join(runTmp, 'live.sock')], ['/tmp', path.join(dlgt, 'tmux-' + process.getuid(), 'default')]];
  let left = socks.length;
  for (const [label, s] of socks) {
    const bytes = Buffer.byteLength(s);
    const srv = net.createServer();
    srv.on('error', (e) => { console.log('refused ' + label + ' ' + bytes + ' ' + e.code); if (--left === 0) done(); });
    srv.listen(s, () => { console.log('bound ' + label + ' ' + bytes); srv.close(() => { if (--left === 0) done(); }); });
  }
  function done() { fs.rmSync(runTmp, { recursive: true, force: true }); fs.rmSync(dlgt, { recursive: true, force: true }); report(false); process.exit(0); }
  return;
}
if (mode === 'carry') {
  // Spec §2.3's carry-over fixture, against the seam: every place a run can write, then a sibling of run/.
  const run = path.resolve(process.cwd(), '..', '..');
  fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'carry.txt'), 'left');
  fs.mkdirSync(path.join(process.cwd(), 'node_modules', '.vite'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'node_modules', '.vite', 'carry.txt'), 'left');
  const tmpCarry = path.join(process.env.TMPDIR, 'ccrc-tb-carry-' + process.pid); fs.writeFileSync(tmpCarry, 'left'); console.log('TMPCARRY ' + tmpCarry);
  fs.mkdirSync(path.join(run, 'checkout', '.git', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(run, 'checkout', '.git', 'hooks', 'pre-commit'), 'left');
  fs.appendFileSync(path.join(run, 'checkout', '.git', 'config'), '[carry]\n\tleft = 1\n');
  const ro = path.join(run, 'ro');
  fs.mkdirSync(ro); fs.writeFileSync(path.join(ro, 'f'), 'left'); fs.chmodSync(ro, 0o500);
  try { fs.writeFileSync(path.join(run, '..', 'sibling'), 'left'); console.log('sibling written'); } catch (e) { console.log('sibling refused ' + e.code); }
  report(false); process.exit(0);
}
if (mode === 'look') {
  const run = path.resolve(process.cwd(), '..', '..');
  const seen = [path.join(process.cwd(), 'node_modules', 'carry.txt'), path.join(process.cwd(), 'node_modules', '.vite'),
    path.join(run, 'checkout', '.git', 'hooks', 'pre-commit'), path.join(run, 'ro'), path.join(run, '..', 'sibling')].filter((p) => fs.existsSync(p));
  const cfg = path.join(run, 'checkout', '.git', 'config');
  if (fs.existsSync(cfg) && fs.readFileSync(cfg, 'utf8').includes('[carry]')) seen.push(cfg);
  console.log('SEEN ' + JSON.stringify(seen));
  report(false); process.exit(0);
}
console.error('unknown mode ' + mode); process.exit(9);
