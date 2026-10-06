// The Docs helper as a python MODULE, for units (spec 2026-10-01 section 2 (j), "Canned input"). `_docs_py`'s
// program is taken out of ccd/ccd between its two fixed marker lines, written once per fixture HOME, and imported by
// the host's real python3 as `H`. A unit calls the helper's functions directly, or swaps `H.SYS` for a subclass that
// overrides one method; nothing here adds a flag, an argv token or an environment variable to the helper itself.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';
import { REAL_PYTHON3, type DocsRun } from './ccdDocsHelpers.js';

/** The heredoc opener, a whole line of ccd/ccd: the program is on fd 3, so stdin stays the caller's. */
export const DOCS_PY_OPEN = `  python3 /dev/fd/3 "$@" 3<<'DOCS_PY'`;
/** The heredoc terminator, a whole line of ccd/ccd. */
export const DOCS_PY_CLOSE = 'DOCS_PY';

const shippedCcd = (): string => fs.readFileSync(CCD, 'utf8');

/**
 * The helper's python source: the lines strictly between the opener and the terminator, with a final newline.
 * Throws unless each marker is exactly one whole line of the text and a program sits between them. That is the
 * vacuity guard: an empty or a doubled extraction is an error here, never a silently green unit.
 */
export function docsHelperSource(ccdText?: string): string {
  const lines = (ccdText ?? shippedCcd()).split('\n');
  const at = (want: string): number[] => lines.flatMap((l, i) => (l === want ? [i] : []));
  const open = at(DOCS_PY_OPEN);
  const close = at(DOCS_PY_CLOSE);
  if (open.length !== 1) {
    throw new Error(`docsHelperSource: ${open.length} lines equal the opener ${JSON.stringify(DOCS_PY_OPEN)}; the contract is one`);
  }
  if (close.length !== 1) {
    throw new Error(`docsHelperSource: ${close.length} lines equal the terminator ${DOCS_PY_CLOSE}; the contract is one`);
  }
  const body = lines.slice(open[0]! + 1, close[0]!);
  if (body.every((l) => l.trim() === '')) {
    throw new Error('docsHelperSource: no program sits between the opener and the terminator');
  }
  return `${body.join('\n')}\n`;
}

/**
 * The text after `NAME=` on the helper's ONE binding of `name`, which must be the single-line, unindented
 * `NAME=<value>` form (no spaces around `=`). The count is taken first over ANY binding of the name, in any
 * spelling: indented, spaced, annotated, augmented (`+=`), or a `def`/`class` of that name. A scan that counted
 * only the canonical shape would find one canonical line beside a second, differently spelled binding and call that
 * "exactly one" (`pool-name-parity.test.ts`'s `exactlyOne`, for python). Throws on anything but one.
 */
export function pyLiteral(src: string, name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`pyLiteral: ${JSON.stringify(name)} is not a python name`);
  const broad = src.match(new RegExp(
    `^[ \\t]*(?:(?:def|class)[ \\t]+${name}\\b|${name}[ \\t]*(?::[^=\\n]*)?(?:\\*\\*|//|>>|<<|[-+*/%&|^@])?=(?!=))`,
    'gm',
  )) ?? [];
  if (broad.length !== 1) {
    throw new Error(`pyLiteral: ${name} is bound ${broad.length} times in the helper source; the contract is one`);
  }
  const canon = [...src.matchAll(new RegExp(`^${name}=(.*)$`, 'gm'))];
  if (canon.length !== 1) {
    throw new Error(`pyLiteral: the one binding of ${name} is not the single-line, unindented \`${name}=\` form`);
  }
  return canon[0]![1]!;
}

const PROBE = /python3 -c '([^'\n]*\bversion_info\b[^'\n]*)'/g;

/** The python program ccd's docs front hands `python3 -c` (spec section 2 (a) Shape, step 2): the argv[2] a python3
 *  stub sees. Throws unless ccd/ccd holds exactly one `python3 -c '...version_info...'`, the floor's one definition. */
export function docsProbeProgram(ccdText?: string): string {
  const hits = [...(ccdText ?? shippedCcd()).matchAll(PROBE)];
  if (hits.length !== 1) {
    throw new Error(`docsProbeProgram: ${hits.length} python3 -c version_info probes in ccd/ccd; the contract is one`);
  }
  return hits[0]![1]!;
}

/** The front's whole probe command, as ccd/ccd spells it: `python3 -c '<docsProbeProgram()>'`. */
export function docsProbeCommand(ccdText?: string): string {
  return `python3 -c '${docsProbeProgram(ccdText)}'`;
}

/** Homes whose `docs-unit/docs_helper.py` this process has written. */
const written = new Set<string>();

/** `<home>/docs-unit/docs_helper.py`, holding the shipped helper source, written once per HOME. */
function helperFile(home: string): string {
  const file = path.join(home, 'docs-unit', 'docs_helper.py');
  if (!written.has(home) || !fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, docsHelperSource());
    written.add(home);
  }
  return file;
}

/** What every unit body follows: the helper imported as the module `docs_helper`, bound to `H`, and `out(o)`, which
 *  writes `o` as one JSON value (ASCII-escaped, so a lone surrogate survives the trip) to the unit's stdout. Call
 *  `out` once. Importing the helper runs nothing: its `main()` sits behind the `__main__` guard. */
const prelude = (file: string): string => [
  'import importlib.util as _docs_unit_iu',
  'import json as _docs_unit_json',
  'import sys as _docs_unit_sys',
  `_docs_unit_spec = _docs_unit_iu.spec_from_file_location('docs_helper', ${JSON.stringify(file)})`,
  'H = _docs_unit_iu.module_from_spec(_docs_unit_spec)',
  "_docs_unit_sys.modules['docs_helper'] = H",
  '_docs_unit_spec.loader.exec_module(H)',
  '',
  '',
  'def out(o):',
  '    _docs_unit_sys.stdout.write(_docs_unit_json.dumps(o))',
  '',
  '',
].join('\n');

/**
 * Run `body` (python, column 0) after the prelude, as `REAL_PYTHON3 -c`, with cwd = `home` and the env contained
 * exactly as a ccd run is (`HOME` = `home`, `harnessBin(home)` first on PATH, `gh`/systemd/tmux poisoned), so the PATH
 * git recorder and any python3 stub planted there also meet the helper's own subprocesses. `opts.env` is merged
 * over the process env before containment. A body travels in one argv string, so a large corpus goes in a file the
 * body opens. Never throws for a python failure: the code and both streams come back.
 */
export function runDocsUnit(
  home: string, body: string, opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): DocsRun {
  const r = spawnSync(REAL_PYTHON3, ['-c', `${prelude(helperFile(home))}${body}\n`], {
    cwd: home, encoding: 'utf8', timeout: opts.timeoutMs ?? 120_000, maxBuffer: 256 * 1024 * 1024,
    env: ghContainedEnv(home, { ...process.env, HOME: home, PYTHONDONTWRITEBYTECODE: '1', ...opts.env },
      { systemd: true, tmux: true }),
  });
  const failed = r.error === undefined ? '' : `\n[runDocsUnit] ${String(r.error)}`;
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}${failed}` };
}

/** `runDocsUnit`, then the unit's whole stdout parsed as ONE JSON value. Throws, with python's traceback, on a
 *  non-zero exit, and on a stdout that is not exactly one JSON value. */
export function unitJson<T>(home: string, body: string, opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }): T {
  const r = runDocsUnit(home, body, opts);
  if (r.code !== 0) {
    throw new Error(`docs helper unit exited ${r.code}:\n${r.stderr}\n--- stdout ---\n${r.stdout.slice(0, 2000)}`);
  }
  try {
    return JSON.parse(r.stdout) as T;
  } catch (e) {
    throw new Error(`docs helper unit wrote no single JSON value (${String(e)}):\n${r.stdout.slice(0, 2000)}\n--- stderr ---\n${r.stderr}`);
  }
}

/**
 * The `filters-bypassed` caveat the draft phase adds on THIS host before a fixture plants anything (spec 2026-10-01
 * section 2 (d): "Any neutralised filter adds the `filters-bypassed` caveat"). The helper deletes every GIT_* key, so
 * its filter probe reads the host's SYSTEM gitconfig too, and a runner image that configures a filter driver there
 * (GitHub's ubuntu image installs git-lfs's, filter.lfs.clean/smudge/process/required) truthfully earns the caveat on
 * every holder. So the baseline is MEASURED, never assumed: this runs the helper's own probe, `_draft_git` with
 * `DRAFT_FILTER_ARGS`, its rc read exactly as `_snapshot_once` reads it (rc 1 is no driver) and its output through
 * `filter_neutralisers`, under `runDocsUnit`'s contained env and `home` as HOME and cwd. `home` is not a repository,
 * so only the system and global (fixture HOME) layers answer; a case that plants a driver in a fixture repo's own
 * config carries that caveat itself. Returns a fresh array each call, to append to a case's own caveats.
 */
export function hostFilterCaveat(home: string): [] | ['filters-bypassed'] {
  const bypassed = unitJson<boolean>(home, [
    'import os',
    "dl = H.Deadline(H.HELPER_DEADLINE_S['docs-tree'])",
    "sp = H._draft_git('filter-config', os.environ['HOME'], H.DRAFT_FILTER_ARGS, dl, H.CALL_S['ref'])",
    'if sp.overflow or sp.rc not in (0, 1):',
    "    raise SystemExit('hostFilterCaveat: the filter probe answered rc %r: %r' % (sp.rc, sp.err[:400]))",
    'out(sp.rc == 0 and H.filter_neutralisers(sp.out)[1])',
  ].join('\n'));
  return bypassed ? ['filters-bypassed'] : [];
}
