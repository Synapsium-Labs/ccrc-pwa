#!/usr/bin/env node
// transcript-snap.mjs — a hook for the W0 rig's sandbox scenarios (plan 2026-11-14-overlord-w1/w1-sandbox.md, Task 1, M4
// and M6): `--dir <dir> --event <name>`. Reads one hook payload on stdin and, when it names a readable `transcript_path`,
// copies that transcript as it stands to `<dir>/<NNNN>-<event>.jsonl` (NNNN counts this stub's runs in the dir), so a
// run shows which hook event first finds each start attachment. Appends one line to `<dir>/index.ndjson`: the event,
// the payload's `source` and `permission_mode`, the payload's key names, the copy's size in bytes and the attachment
// types it holds in order, and the NAMES (never the values) of the environment's variables that start CLAUDE, CCRC or
// ANTHROPIC or name remote control. Prints nothing and exits 0, so it never changes what the session does.
import fs from 'node:fs';
import path from 'node:path';
import { readPayload } from './log.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
}
const dir = arg('--dir');
const event = arg('--event') || 'unknown';
if (dir === '') process.exit(0);
fs.mkdirSync(dir, { recursive: true });
const payload = readPayload();
const n = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length + 1;
const rec = { event, n, source: payload.source ?? null, permission_mode: payload.permission_mode ?? null,
  keys: Object.keys(payload).sort(), size: null, attachments: [],
  env: Object.keys(process.env).filter((k) => /^(CLAUDE|CCRC|ANTHROPIC)|REMOTE|_RC(_|$)/.test(k)).sort() };
const t = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
let text = null;
try { text = t === '' ? null : fs.readFileSync(t, 'utf8'); } catch { text = null; }
if (text !== null) {
  fs.writeFileSync(path.join(dir, `${String(n).padStart(4, '0')}-${event}.jsonl`), text);
  rec.size = Buffer.byteLength(text);
  for (const line of text.split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o && o.type === 'attachment' && o.attachment && typeof o.attachment.type === 'string') rec.attachments.push(o.attachment.type);
  }
}
fs.appendFileSync(path.join(dir, 'index.ndjson'), `${JSON.stringify(rec)}\n`);
