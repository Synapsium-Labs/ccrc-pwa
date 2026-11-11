#!/usr/bin/env node
// statusline-capture.mjs — a status line for the W0 rig (W0-18): reads one JSON payload on stdin and appends to
// $RIG_STATUS_LOG one object of key path to value, for number, boolean and null leaves, key path to "<string>" for
// every string leaf except `model.id`, and `_t` (the epoch ms it ran). No string value but the model id ever leaves the
// payload. Prints one line for the status bar.
import { logLine, readPayload } from './log.mjs';

const out = { _t: Date.now() };
function walk(v, p) {
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
    return;
  }
  if (typeof v === 'string') out[p] = p === 'model.id' ? v : '<string>';
  else out[p] = v;
}
walk(readPayload(), '');
logLine('RIG_STATUS_LOG', out);
process.stdout.write('w0 status\n');
