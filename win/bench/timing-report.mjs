// Summarise ccd's cost on a box: the launcher's timing log (spec 2026-11-22 §5) and, on a
// Windows box, the manager's unit journal. Usage: node win/bench/timing-report.mjs [sinceIso]
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarise(ms) {
  const a = [...ms].sort((x, y) => x - y);
  const at = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { n: a.length, median: at(0.5), p90: at(0.9), total: a.reduce((s, x) => s + x, 0) };
}

export function parseEntryLog(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const f = line.split('\t');
    if (f.length !== 4 || !/^\d+$/.test(f[2])) continue;
    (out.get(f[1]) ?? out.set(f[1], []).get(f[1])).push(Number(f[2]));
  }
  return out;
}

export function parseUnitJournal(text, sinceMs) {
  const open = new Map();
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^(\S+Z) (start|exit) (\S+?)\.service\b/);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (t < sinceMs) continue;
    if (m[2] === 'start') open.set(m[3], t);
    else if (open.has(m[3])) {
      (out.get(m[3]) ?? out.set(m[3], []).get(m[3])).push(t - open.get(m[3]));
      open.delete(m[3]);
    }
  }
  return out;
}

function table(title, map) {
  const rows = [...map].map(([k, v]) => ({ k, ...summarise(v) })).sort((a, b) => b.total - a.total);
  console.log(`\n${title}\n| what | runs | median | p90 | total |\n|---|---|---|---|---|`);
  for (const r of rows) {
    console.log(`| ${r.k} | ${r.n} | ${(r.median / 1000).toFixed(1)} s | ${(r.p90 / 1000).toFixed(1)} s | ${(r.total / 60000).toFixed(0)} min |`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const since = Date.parse(process.argv[2] ?? '1970-01-01T00:00:00Z');
  const log = path.join(os.homedir(), '.ccrc', 'ccd-entry-timing.log');
  if (existsSync(log)) table('ccd launcher', parseEntryLog(readFileSync(log, 'utf8')));
  const journal = path.join(os.homedir(), '.ccrc', 'supervisor', 'supervisor.log');
  if (existsSync(journal)) table('Windows manager units', parseUnitJournal(readFileSync(journal, 'utf8'), since));
}
