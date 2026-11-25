// The build capture recorder as production runs it (spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md
// §2.5, Table 5; review 3226: the compiled recorder was exercised by no test). Every other recorder test runs its SOURCE
// under Node's type-stripping flag (departure recorder-runs-from-source-in-tests). Here the agent package is emitted by its
// own `tsc` and its own tsconfig, as `npm run build` does (`module-format.test.ts` emits the same way), into a tree laid out
// as a release (`<tree>/agent/package.json` beside `<tree>/agent/dist`), and the emitted recorder is run by plain `node`
// with no flag: where it lands, beside the service's `main.js`; that `recorderPath()` names that file; that it records a
// PermissionRequest with the answer it printed, which the replay's reader reads; and that it answers the statusline.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readCaptureRecords } from '../../shared/claudeBuildCapture.js';
import { ALLOW_REPLY, STATUSLINE_REPLY } from '../src/testbox/captureRecord.js';
import { compiledRecorder } from '../src/testbox/main.js';
import { mkTmp } from './tmpHelpers.js';

const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Where the release keeps the compiled testbox modules: `agent/tsconfig.json`'s `rootDir` is the repository root. */
const TESTBOX_DIST = ['agent', 'dist', 'agent', 'src', 'testbox'];

let tree = '';
let recorder = '';

beforeAll(() => {
  tree = mkTmp('ccrc-caprec-dist-');
  const agent = path.join(tree, 'agent');
  mkdirSync(agent, { recursive: true });
  // The release's agent package marks its emitted `.js` as ES modules, as `agent/package.json` does.
  writeFileSync(path.join(agent, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
  const r = spawnSync(
    process.execPath, [path.join(agentRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '--outDir', path.join(agent, 'dist')],
    { cwd: agentRoot, encoding: 'utf8', timeout: 170_000 },
  );
  expect(r.stdout + r.stderr, 'the real build does not compile').toBe('');
  recorder = path.join(tree, ...TESTBOX_DIST, 'captureRecord.js');
}, 180_000);

/** Runs the compiled recorder as the build would: plain `node`, the caller's word as its one argument, a payload on stdin. */
function runRecorder(arg: string, stdin: string, env: Record<string, string>): { status: number | null; stdout: string } {
  const r = spawnSync(process.execPath, [recorder, arg], { input: stdin, env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 20_000 });
  return { status: r.status, stdout: r.stdout };
}

function scratch(): { config: string; file: string } {
  const dir = mkTmp('ccrc-caprec-run-');
  const config = path.join(dir, 'config');
  mkdirSync(path.join(config, 'sessions'), { recursive: true });
  return { config, file: path.join(dir, 'recording.jsonl') };
}

describe('the compiled recorder, as the box runs it', () => {
  it('lands beside the service\'s main.js', () => {
    expect(existsSync(recorder)).toBe(true);
    expect(existsSync(path.join(path.dirname(recorder), 'main.js'))).toBe(true);
  });

  it('the entry point names it as its own sibling by the compiled name, which is where it lands (capture runner PR 3b)', () => {
    expect(compiledRecorder()).toBe(path.join(agentRoot, 'src', 'testbox', path.basename(recorder)));
  });

  it('recorderPath() of the compiled module names the compiled file itself', () => {
    const r = spawnSync(process.execPath, [
      '--input-type=module', '-e', 'const m = await import(process.argv.at(-1)); process.stdout.write(m.recorderPath());', pathToFileURL(recorder).href,
    ], { encoding: 'utf8', timeout: 20_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(recorder);
  });

  it('answers a PermissionRequest allow and records it with that answer, under plain node with no flag', () => {
    const t = scratch();
    writeFileSync(path.join(t.config, 'sessions', '7.json'), JSON.stringify({ pid: 7, version: '2.1.100' }));
    const payload = { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'touch x' } };
    const r = runRecorder('PermissionRequest', JSON.stringify(payload), { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: t.file });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${ALLOW_REPLY}\n`);
    expect(readCaptureRecords(readFileSync(t.file, 'utf8'))).toEqual({
      records: [{ kind: 'hook', event: 'PermissionRequest', payload, status: { pid: 7, version: '2.1.100' }, answer: 'allow' }], unreadable: 0,
    });
  });

  it('answers the statusline with its text and records the statusline JSON', () => {
    const t = scratch();
    const r = runRecorder('statusline', '{"session_id":"s"}', { CLAUDE_CONFIG_DIR: t.config, CCRC_CAPTURE_RECORDING: t.file });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${STATUSLINE_REPLY}\n`);
    expect(readCaptureRecords(readFileSync(t.file, 'utf8')).records).toEqual([{ kind: 'statusline', payload: { session_id: 's' }, status: null }]);
  });
});
