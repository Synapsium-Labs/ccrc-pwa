// Test helpers for ccd's docs verbs (spec 2026-10-01 section 2 (j), "Test harness"): run the REAL dispatcher
// contained, read its one answer line, and plant the python3 stubs the probe rows need. The name starts with `ccd`
// on purpose: `ccd-workspaces.test.ts`'s containment scan reads every bash spawn in a `ccd*.ts` file, this one's
// included. APPEND ONLY: Tasks 7, 8 and 9 add the PATH git recorder and the repository fixtures below, each
// importing under names of its own.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, harnessBin, type CcdHarness } from './ccdWsHelpers.js';

/** One ccd (or helper) run: its exit code and both streams, never trimmed. */
export interface DocsRun { code: number; stdout: string; stderr: string }

/** `bin`'s absolute path on THIS process's PATH, resolved once, at import. Stubs planted in a fixture HOME `exec` it
 *  by that path, so a stub can never find itself again on the contained PATH. A host without it fails the import,
 *  loudly: every docs suite needs a real python3 and a real git, and a skip would read as green. */
function hostBin(bin: string): string {
  const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  const found = (r.stdout ?? '').trim();
  if (r.status !== 0 || !path.isAbsolute(found)) {
    throw new Error(`ccdDocsHelpers: no ${bin} on this process's PATH (command -v said ${JSON.stringify(found)})`);
  }
  return found;
}

export const REAL_PYTHON3: string = hostBin('python3');
export const REAL_GIT: string = hostBin('git');

/** A single-quoted sh word. */
const shWord = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * `bash ccd/ccd <args...>` through the dispatcher, exactly as the agent runs it, in the fixture HOME and contained
 * (`gh`, systemd and tmux poisoned). Both streams come back on EVERY exit code, untrimmed, because the exit contract
 * is about bytes: rc 0 with exactly one newline-terminated line, or rc != 0 with an EMPTY stdout. Never throws; a
 * spawn that could not run at all answers code -1 with the reason on stderr.
 */
export function runCcdDocs(
  h: CcdHarness, args: readonly string[], env: NodeJS.ProcessEnv = {}, cwd: string = h.home,
): DocsRun {
  const r = spawnSync('bash', [CCD, ...args], {
    cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }),
  });
  const failed = r.error === undefined ? '' : `\n[runCcdDocs] ${String(r.error)}`;
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}${failed}` };
}

/** The run's one answer: stdout must be exactly one `\n`-terminated line holding one JSON object. Throws, naming
 *  the run, on anything else; it asserts nothing about the exit code, which each caller states itself. */
export function parseOneLine(r: DocsRun): Record<string, unknown> {
  const where = `rc ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;
  if (!r.stdout.endsWith('\n') || r.stdout.indexOf('\n') !== r.stdout.length - 1) {
    throw new Error(`parseOneLine: stdout is not exactly one newline-terminated line: ${where}`);
  }
  let o: unknown;
  try {
    o = JSON.parse(r.stdout.slice(0, -1));
  } catch (e) {
    throw new Error(`parseOneLine: the line is not JSON (${String(e)}): ${where}`);
  }
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    throw new Error(`parseOneLine: the line is not a JSON object: ${where}`);
  }
  return o as Record<string, unknown>;
}

/**
 * Plant `harnessBin(home)/python3`, which is first on every contained PATH, so ccd's front and helper both meet it:
 * - `missing`: every call exits 127, as bash's "command not found" does.
 * - `too-old`: a `-c` program that reads `version_info` (the front's probe) exits 3; every other call `exec`s the
 *   real python3.
 * - `raises`: the real python3 under `PYTHONPATH=<home>/docs-py-raises`, whose `sitecustomize` replaces
 *   `time.monotonic` with a function that raises `RuntimeError('planted https://u:tok@example.invalid/x')`. The
 *   probe never reads that clock and passes; the helper's first clock read is the start of `run()`, so every verb,
 *   at every task, answers rc 0 `helper-failed` through the real dispatcher.
 * A HOME keeps its stub until the file is removed, so each case plants into a harness of its own.
 */
export function plantPython3(home: string, mode: 'missing' | 'too-old' | 'raises'): void {
  let body: string[];
  if (mode === 'missing') {
    body = ['exit 127'];
  } else if (mode === 'too-old') {
    body = [
      'if [ "$1" = -c ]; then',
      '  case "$2" in *version_info*) exit 3 ;; esac',
      'fi',
      `exec ${shWord(REAL_PYTHON3)} "$@"`,
    ];
  } else {
    const site = path.join(home, 'docs-py-raises');
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'sitecustomize.py'), [
      '# Planted by ccdDocsHelpers.plantPython3(home, "raises"): the first clock read raises.',
      'import time',
      '',
      '',
      'def _docs_planted_clock():',
      "    raise RuntimeError('planted https://u:tok@example.invalid/x')",
      '',
      '',
      'time.monotonic = _docs_planted_clock',
      '',
    ].join('\n'));
    body = [`PYTHONPATH=${shWord(site)}`, 'export PYTHONPATH', `exec ${shWord(REAL_PYTHON3)} "$@"`];
  }
  const stub = path.join(harnessBin(home), 'python3');
  fs.writeFileSync(stub, ['#!/bin/sh', ...body, ''].join('\n'), { mode: 0o755 });
  fs.chmodSync(stub, 0o755);
}
