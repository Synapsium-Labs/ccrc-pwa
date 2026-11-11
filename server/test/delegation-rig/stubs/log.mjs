// The stubs' one log writer: append one JSON line to the file named by env var `name`, making its directory.
// An unset or empty variable logs nothing. Dependency-free; test tooling for the Overlord's W0 rig scenarios.
import fs from 'node:fs';
import path from 'node:path';

export function logLine(name, obj) {
  const f = process.env[name];
  if (!f) return;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `${JSON.stringify(obj)}\n`);
}

/** All of stdin as text ('' when none). */
export function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

/** stdin parsed as JSON, or {} when it is empty or not JSON. */
export function readPayload() {
  try { return JSON.parse(readStdin() || '{}'); } catch { return {}; }
}
