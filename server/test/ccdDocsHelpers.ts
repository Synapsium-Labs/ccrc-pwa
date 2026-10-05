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

// ---- Task 7: the PATH git recorder, and a contained shell run for an argv a JS string cannot carry ----
// Spec 2026-10-01 section 2 (j), "Git calls are recorded at PATH level": the helper's git is a python
// subprocess that finds `git` on PATH, so a bash-function stub (the NOGIT idiom) never sees it. A wrapper FILE
// in `harnessBin(home)`, the first PATH entry of every contained env, does. The imports are aliased: this block
// sits below the file's own imports and binds no name they may already bind.
import fsRec from 'node:fs';
import pathRec from 'node:path';
import { harnessBin as recorderBin } from './ccdWsHelpers.js';

/** One git call the recorder saw: the argv after `git`, and every `GIT_*` and `LC_ALL` variable it ran under. */
export interface RecordedGitCall { argv: string[]; env: Record<string, string> }

/** The recorder's separator bytes. No argv token or environment value a docs test plants carries one. */
const GITREC_FIELD = '\x1f';
const GITREC_PART = '\x1e';
const GITREC_END = '\x1d';

/** A single-quoted sh word. */
const gitrecQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Plant `harnessBin(home)/git`: it appends one record per call (the argv, then the `GIT_*`/`LC_ALL`
 * environment) to `<home>/docs-git-calls`, then `exec`s `REAL_GIT` by absolute path. Planting again replaces
 * the wrapper and empties the log.
 *
 * `failWhen` and `sleepWhen` are argv substrings, matched against the space-joined argv as sh `case` arms: a
 * `sleepWhen` match sleeps `sleepS` seconds (default 30) before the real git runs; a `failWhen` match prints
 * `git recorder: planted failure` to stderr and exits 128 without running it. Both record the call first. The
 * fixture's own git (`h.git`, `makeRepo`) runs under the host PATH, so it is never recorded.
 */
export function plantGitRecorder(
  home: string, opts: { failWhen?: string[]; sleepWhen?: string[]; sleepS?: number } = {},
): { calls(): RecordedGitCall[]; reset(): void } {
  const log = pathRec.join(home, 'docs-git-calls');
  const arms = (patterns: readonly string[], action: string): string[] => (patterns.length === 0 ? [] : [
    'case " $* " in',
    ...patterns.map((p) => `  *${gitrecQuote(p)}*) ${action} ;;`),
    'esac',
  ]);
  const wrapper = pathRec.join(recorderBin(home), 'git');
  fsRec.writeFileSync(wrapper, [
    '#!/bin/sh',
    '# The docs PATH git recorder (server/test/ccdDocsHelpers.ts). Each argv token and each NAME=value is ended',
    '# by 0x1f, the two parts are split by 0x1e, and the record is ended by 0x1d.',
    '{',
    `  for a in "$@"; do printf '%s\\037' "$a"; done`,
    `  printf '\\036'`,
    `  awk 'BEGIN { for (k in ENVIRON) if (k ~ /^GIT_/ || k == "LC_ALL") printf "%s=%s\\037", k, ENVIRON[k] }'`,
    `  printf '\\035'`,
    `} >> ${gitrecQuote(log)}`,
    ...arms(opts.sleepWhen ?? [], `sleep ${opts.sleepS ?? 30}`),
    ...arms(opts.failWhen ?? [], `echo 'git recorder: planted failure' >&2; exit 128`),
    `exec ${gitrecQuote(REAL_GIT)} "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  fsRec.chmodSync(wrapper, 0o755);
  fsRec.rmSync(log, { force: true });
  const tokens = (s: string): string[] => s.split(GITREC_FIELD).slice(0, -1);
  return {
    calls: () => {
      if (!fsRec.existsSync(log)) return [];
      return fsRec.readFileSync(log, 'utf8').split(GITREC_END).slice(0, -1).map((rec) => {
        const cut = rec.indexOf(GITREC_PART);
        if (cut < 0) throw new Error(`git recorder: a record with no environment part: ${JSON.stringify(rec)}`);
        const env: Record<string, string> = {};
        for (const kv of tokens(rec.slice(cut + 1))) {
          const eq = kv.indexOf('=');
          env[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
        return { argv: tokens(rec.slice(0, cut)), env };
      });
    },
    reset: () => fsRec.rmSync(log, { force: true }),
  };
}

/** `bash -c <script> <CCD>`, contained exactly as `runCcdDocs` is, for an argv a JS string cannot carry (bytes
 *  that are not UTF-8): the script builds it inside the contained shell, for example as a
 *  `--path "$(printf '\377.md')"` token, and reaches ccd as "$0". Never throws; stdout is not trimmed. The
 *  `timeout` bounds a hang, which no vitest test timeout can interrupt in a synchronous spawn. */
export function runCcdDocsShell(h: CcdHarness, script: string, cwd: string = h.home): DocsRun {
  const r = spawnSync('bash', ['-c', script, CCD], {
    encoding: 'utf8', cwd, timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  });
  if (r.error) return { code: -1, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}spawn error: ${String(r.error)}` };
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ---- Docs fixture repositories (docs W1a, the runner and discovery task) ----
// This block imports under names of its own: an appended block cannot assume the
// file head's import list, and binding one name twice is a SyntaxError.
import * as docsRepoFs from 'node:fs';
import * as docsRepoPath from 'node:path';
import type { CcdHarness as DocsRepoHarness } from './ccdWsHelpers.js';

/** Writes each of `files` under `dir` (parents created; a Buffer as raw bytes),
 *  commits exactly those paths, and returns the new commit's sha. */
export function commitDocs(
  h: DocsRepoHarness, dir: string, files: Record<string, string | Buffer>, msg = 'docs',
): string {
  const rels = Object.keys(files);
  if (rels.length === 0) throw new Error('commitDocs: no files to commit');
  for (const [rel, body] of Object.entries(files)) {
    const p = docsRepoPath.join(dir, rel);
    docsRepoFs.mkdirSync(docsRepoPath.dirname(p), { recursive: true });
    docsRepoFs.writeFileSync(p, body);
  }
  h.git(dir, 'add', '--', ...rels);
  h.git(dir, 'commit', '-q', '-m', msg);
  return h.git(dir, 'rev-parse', 'HEAD');
}

/** `h.makeRepo(name)` plus one docs commit, pushed to its origin, so the main
 *  checkout and `origin/main` agree. Returns the main checkout's path. */
export function docsRepo(
  h: DocsRepoHarness, name: string,
  files: Record<string, string | Buffer> = { 'docs/superpowers/specs/a.md': '# A\n' },
): string {
  const main = h.makeRepo(name);
  commitDocs(h, main, files);
  h.git(main, 'push', '-q', 'origin', 'main');
  return main;
}
