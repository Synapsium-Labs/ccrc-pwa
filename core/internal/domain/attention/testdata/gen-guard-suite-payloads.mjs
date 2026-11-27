// Regenerates guard-suite-payloads.jsonl from a CCRC_GUARD_CORPUS recording (server/test/hookTwin.ts#recordGuard): run
// the guard suites once with CCRC_GUARD_CORPUS=<file> (merge, account, approval, quiz and prune deny, mail hold, mailhold-parity,
// mail-hold-module, ccd-keep-awake), then `node gen-guard-suite-payloads.mjs <file> guard-suite-payloads.jsonl`. Every
// payload over 16 KB is dropped: each came through hookBoth (compared there) and the cost shapes are TestGuardCostBound's.
import fs from 'node:fs';
const [, , src, dst] = process.argv;
const seen = new Set();
const out = [];
let big = 0;
for (const l of fs.readFileSync(src, 'utf8').split('\n')) {
  if (l === '') continue;
  if (l.length > 16384) { big++; continue; }
  const p = JSON.parse(l).replace(/\/tmp\/ccrc-testrun-[A-Za-z0-9]+\/tmp\//g, '/tmp/run/')
    .replace(/\/tmp\/run\/(ccrc-[a-z-]+?-)[A-Za-z0-9]{6}(?=[/"'\s]|$)/g, '/tmp/run/$1fixture');
  const k = JSON.stringify(p);
  if (!seen.has(k)) { seen.add(k); out.push(k); }
}
out.sort();
fs.writeFileSync(dst, out.map((x) => x + '\n').join(''));
const s = out.join('\n');
console.log(`${out.length} distinct, ${big} over 16 KB dropped`);
const tmp = {};
for (const m of s.matchAll(/\/tmp\/[^"'\s\\]*/g)) { const k = m[0].split('/').slice(0, 4).join('/'); tmp[k] = (tmp[k] || 0) + 1; }
console.log(Object.entries(tmp).sort((a, b) => b[1] - a[1]).slice(0, 12));
