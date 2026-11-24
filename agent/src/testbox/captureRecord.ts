// The build capture runner (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.1, the recorder). L3:
// the one script every hook and the statusline of a captured build run (`capture.ts#captureSettings`), compiled to
// `agent/dist/agent/src/testbox/captureRecord.js` and run as `node <path> <event|statusline>`. It appends what it was given on stdin, with
// a copy of the live status file taken at that moment, as ONE line of the recording in the shape
// `shared/claudeBuildCapture.ts#readCaptureRecords` reads; as the PermissionRequest hook it answers `allow`, so no human
// and no dialog is needed, and that line records the answer it printed. It always exits 0: a recorder that could not write breaks nothing in the drive, and the replay
// then fails for the record that is missing.
//
// IT IMPORTS NO LOCAL MODULE, and uses only syntax Node's type stripping erases, so its tests run its source as a process
// under `--experimental-strip-types` on the Node floor (22.16.0) with nothing compiled. That is why it checks whether it
// was started as a program itself, with the same realpath comparison as `entry.ts#startedAsProgram`, instead of importing
// it: a legitimately different copy (a process boundary the import cannot cross without a build step).
import { appendFileSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** True iff this module is the program node was started with (`entry.ts#startedAsProgram`'s comparison). */
function startedAsProgram(argv1: string | undefined, moduleUrl: string): boolean {
  if (argv1 === undefined) return false;
  try { return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl)); } catch { return false; }
}

/** This script's own path, for the runner to put in the seeded config (compiled, it is `agent/dist/agent/src/testbox/captureRecord.js`, beside the service's `main.js`). */
export const recorderPath = (): string => fileURLToPath(import.meta.url);

/** The decision the recorder gives every PermissionRequest; its line in the recording carries it as `answer`, so the replay
 *  can tie the tool's run to it (`shared/claudeBuildCapture.ts#replayCapture`, spec §2.6). */
const ALLOW = 'allow';
/** What the recorder prints to answer a PermissionRequest. */
export const ALLOW_REPLY = `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"${ALLOW}"}}}`;
/** What it prints as the statusline. */
export const STATUSLINE_REPLY = 'ccrc capture';

/** The newest `*.json` in `<configDir>/sessions/`, parsed; null when none, or when it cannot be read as JSON. */
export function liveStatus(configDir: string): unknown {
  try {
    const dir = path.join(configDir, 'sessions');
    let best: { file: string; at: number } | null = null;
    for (const n of readdirSync(dir)) {
      if (!n.endsWith('.json')) continue;
      const at = statSync(path.join(dir, n)).mtimeMs;
      if (best === null || at > best.at || (at === best.at && n > path.basename(best.file))) best = { file: path.join(dir, n), at };
    }
    return best === null ? null : (JSON.parse(readFileSync(best.file, 'utf8')) as unknown);
  } catch {
    return null;
  }
}

/** One record: `arg` is `statusline` or a hook event's name; `stdin` is what the caller gave, parsed when it is JSON and
 *  kept as the raw string when it is not. Returns what to print. Never throws. */
export function record(arg: string, stdin: string, env: Readonly<Record<string, string | undefined>>): string {
  try {
    let payload: unknown = stdin;
    try { payload = JSON.parse(stdin) as unknown; } catch { /* kept as the raw string */ }
    const status = liveStatus(env['CLAUDE_CONFIG_DIR'] ?? '');
    const line = arg === 'statusline' ? { kind: 'statusline', payload, status }
      : { kind: 'hook', event: arg, payload, status, ...(arg === 'PermissionRequest' ? { answer: ALLOW } : {}) };
    const file = env['CCRC_CAPTURE_RECORDING'];
    if (file !== undefined && file !== '') appendFileSync(file, `${JSON.stringify(line)}\n`);
  } catch { /* the replay fails for the missing record; the drive goes on */ }
  return arg === 'PermissionRequest' ? ALLOW_REPLY : arg === 'statusline' ? STATUSLINE_REPLY : '';
}

if (startedAsProgram(process.argv[1], import.meta.url)) {
  let stdin = '';
  try { stdin = readFileSync(0, 'utf8'); } catch { /* no stdin: recorded as an empty string */ }
  const out = record(process.argv[2] ?? '', stdin, process.env);
  if (out !== '') process.stdout.write(`${out}\n`);
  process.exit(0);
}
