#!/usr/bin/env node
// #1170's synthetic thrash probe, for a THROWAWAY VM only (deploy/thrash-vm/run.sh starts it; never the fleet box).
// Once a second it opens a NEW connection to the agent (the accept queue and the WebSocket upgrade are what backed up
// in the incident), sends `hello`, waits for `ready`, then lists the registry directory (`readdir`, the read every
// registry-dependent verb starts from) and closes. A probe that has no answer within the request timeout is a MISS.
// Each line of output is one JSON record; the last one is the summary. Exit 0 only when there were 0 misses.
//
// Usage: CCRC_AGENT_TOKEN=… node probe.mjs <seconds> [url] [registryDir]
// Needs Node 22+ (the global WebSocket). Reads /proc/pressure itself so each record carries the PSI it ran under.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const seconds = Number(process.argv[2] ?? 600);
const url = process.argv[3] ?? `ws://127.0.0.1:${process.env.CCRC_AGENT_PORT ?? 7789}`;
const registry = process.argv[4] ?? path.join(os.homedir(), '.cc-sessions');
const token = process.env.CCRC_AGENT_TOKEN ?? '';
// The server's default request wait (FleetClient's `requestTimeoutMs`) plus the agent's 3 s hello deadline.
const TIMEOUT_MS = Number(process.env.CCRC_PROBE_TIMEOUT_MS ?? 15_000);
if (!token) { console.error('probe: CCRC_AGENT_TOKEN is required'); process.exit(64); }

function psiFull(res) {
  try {
    const m = /^full avg10=([\d.]+) avg60=([\d.]+)/m.exec(readFileSync(`/proc/pressure/${res}`, 'utf8'));
    return m ? { avg10: Number(m[1]), avg60: Number(m[2]) } : null;
  } catch { return null; }
}

function probeOnce() {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const ws = new WebSocket(url);
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* already closed */ }
      resolve({ ok, why, ms: Date.now() - t0 });
    };
    const timer = setTimeout(() => finish(false, 'timeout'), TIMEOUT_MS);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token })));
    ws.addEventListener('message', (ev) => {
      let f;
      try { f = JSON.parse(String(ev.data)); } catch { return; }
      if (f.t === 'ready') ws.send(JSON.stringify({ t: 'req', id: 1, op: 'readdir', path: registry }));
      else if (f.t === 'res' && f.id === 1) finish(f.ok === true, f.ok === true ? null : String(f.err));
    });
    ws.addEventListener('error', () => finish(false, 'error'));
    ws.addEventListener('close', () => finish(false, 'closed'));
  });
}

const until = Date.now() + seconds * 1000;
let n = 0; let misses = 0; let worst = 0; let pressured = 0;
const inflight = [];
while (Date.now() < until) {
  const at = Date.now();
  const mem = psiFull('memory');
  if (mem !== null && mem.avg10 > 50) pressured += 1;
  inflight.push(probeOnce().then((r) => {
    n += 1;
    worst = Math.max(worst, r.ms);
    if (!r.ok) misses += 1;
    console.log(JSON.stringify({ at, ...r, psiMemFull: mem, psiIoFull: psiFull('io') }));
  }));
  await new Promise((r) => setTimeout(r, Math.max(0, 1000 - (Date.now() - at))));
}
await Promise.all(inflight);
console.log(JSON.stringify({ summary: true, probes: n, misses, worstMs: worst, secondsUnderFullOver50: pressured, timeoutMs: TIMEOUT_MS }));
process.exit(misses === 0 ? 0 : 1);
