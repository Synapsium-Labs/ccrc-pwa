#!/usr/bin/env node
// gen-settings-lib.mjs — ccd/lib/ccrc-settings.sh, ccrc's settings reader generated whole from ccd/ccrc (wave 29).
//
//   node deploy/gen-settings-lib.mjs [--check] [--ccrc <path>] [--out <path>]
//
// The ccd-* sweeps never source ccd/ccrc, so they read ~/.ccrc/ccrc.env through a library file. That file is a
// GENERATED COPY, never a move and never a hand-kept second reader: ccd/ccrc keeps `_ccrc_knob` and the byte-wise model
// it reads through exactly where they are (moving them would shift every line citation and slice that names them), and
// this script copies the `BOX_ENV_FILE=` line, the `CCRC_SETTINGS=` line and the eight functions of that closure out of
// it, in ccd/ccrc's order. server/test/ccrc-settings-lib.test.ts holds the committed file equal to what this writes.
// Run it after any edit to those two lines, to `_ccrc_knob` or to a `_box_*` function below. It reads no environment.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The reader's closure, in ccd/ccrc's order: what `_ccrc_knob` calls, and what they call. */
export const SETTINGS_LIB_FUNCTIONS = Object.freeze([
  '_box_env_value', '_box_env_shell_plain', '_box_env_has_nul', '_box_env_qopen', '_box_env_unit_whole',
  '_box_unit_env', '_box_unit_env_shell', '_ccrc_knob',
]);

const HEADER = [
  '# ccd/lib/ccrc-settings.sh — GENERATED from ccd/ccrc by deploy/gen-settings-lib.mjs; never edit it by hand.',
  '# ccrc\'s one reader of its settings (`_ccrc_knob`) and the byte-wise model it reads through, copied whole out of',
  '# ccd/ccrc, so the ccd-* sweeps, which never source ccd/ccrc, read ~/.ccrc/ccrc.env exactly as ccrc does. The argument',
  '# for every rule is in ccd/ccrc, above each function. server/test/ccrc-settings-lib.test.ts reds when the two differ.',
  '# Installed 0644 at ~/.local/libexec/ccrc/ccrc-settings.sh: sourced, never executed, and sourcing it runs nothing.',
];

/** The one column-0 line that matches `re`; throws when there is none or more than one. */
const oneLine = (lines, re, what) => {
  const hits = lines.filter((l) => re.test(l));
  if (hits.length !== 1) throw new Error(`gen-settings-lib: ccd/ccrc defines ${what} ${hits.length} times`);
  return hits[0];
};

/** A function's text, `name() {` through the first line that is exactly `}`. */
const bodyOf = (lines, name) => {
  const starts = lines.flatMap((l, i) => (l.startsWith(`${name}() {`) ? [i] : []));
  if (starts.length !== 1) throw new Error(`gen-settings-lib: ccd/ccrc defines ${name} ${starts.length} times`);
  const end = lines.indexOf('}', starts[0]);
  if (end < 0) throw new Error(`gen-settings-lib: ccd/ccrc's ${name}() never closes`);
  return lines.slice(starts[0], end + 1).join('\n');
};

/** The library's whole text, derived from ccd/ccrc's. */
export function settingsLibText(ccrcText) {
  const lines = ccrcText.split('\n');
  return [
    ...HEADER,
    oneLine(lines, /^BOX_ENV_FILE=/, 'BOX_ENV_FILE='),
    '',
    oneLine(lines, /^CCRC_SETTINGS=\(/, 'CCRC_SETTINGS=('),
    '',
    SETTINGS_LIB_FUNCTIONS.map((n) => bodyOf(lines, n)).join('\n\n'),
  ].join('\n') + '\n';
}

const main = (argv) => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let check = false;
  let ccrc = resolve(root, 'ccd/ccrc');
  let out = resolve(root, 'ccd/lib/ccrc-settings.sh');
  let outName = 'ccd/lib/ccrc-settings.sh';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') check = true;
    else if ((a === '--ccrc' || a === '--out') && i + 1 < argv.length) {
      if (a === '--ccrc') ccrc = resolve(argv[++i]);
      else { outName = argv[++i]; out = resolve(outName); }
    } else {
      process.stderr.write(`gen-settings-lib: unknown argument '${a}' — usage: node deploy/gen-settings-lib.mjs [--check] [--ccrc <path>] [--out <path>]\n`);
      return 2;
    }
  }
  const want = settingsLibText(readFileSync(ccrc, 'utf8'));
  if (check) {
    let have = null;
    try { have = readFileSync(out, 'utf8'); } catch { /* absent: line 1 differs */ }
    if (have === want) return 0;
    const a = (have ?? '').split('\n');
    const b = want.split('\n');
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    process.stdout.write(`gen-settings-lib: ${outName} is not ccd/ccrc's reader (first difference at line ${n + 1}) — run: node deploy/gen-settings-lib.mjs\n`);
    return 1;
  }
  const tmp = `${out}.tmp.${process.pid}`;
  writeFileSync(tmp, want, { mode: 0o644 });
  renameSync(tmp, out);
  return 0;
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
